//! How much room Leaflet takes on this device, and giving some back: the
//! quiet tidy a little after startup (`storage::sweep`), and Settings →
//! Library's "Free up space", which does the same now and also empties the
//! web view's cache.

use super::*;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use storage::sweep::{self, Swept};
use tauri::{Manager, Runtime};

/// When the library was last tidied (RFC 3339), so the tidy runs at most
/// about once a day however often Leaflet is opened.
const SWEPT_AT_SETTING: &str = "storage_swept_at";
/// The version the web view's cache was last emptied for. Each update ships
/// its page under new names, so what the old one cached is never asked for
/// again; it is emptied once, on the first start of each version.
const WEB_CACHE_SETTING: &str = "web_cache_cleared_for";
const SWEEP_EVERY: Duration = Duration::from_secs(20 * 60 * 60);
/// After startup, so the tidy never competes with the library opening.
const SWEEP_AFTER: Duration = Duration::from_secs(45);
/// Android's copies of a picked or shared book go once the import is over.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
const IMPORT_COPIES_AFTER: Duration = Duration::from_secs(60 * 60);
/// "Free up space" is the reader asking: a file nobody lists is taken once
/// it is this old, rather than a day (an import takes minutes).
const FREE_UP_STALE: Duration = Duration::from_secs(60 * 60);

/// Bytes, for "Leaflet uses N MB on this device" and the (i) beside it.
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
  pub total: u64,
  /// Every library's books on this device, converted copies included.
  pub books: u64,
  pub covers: u64,
  /// The web view's cache: what "Free up space" empties.
  pub cache: u64
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreedSpace {
  pub freed: u64,
  pub usage: StorageUsage
}

/// The folders Leaflet's own things are in, none inside another. On a phone
/// it is one (the app's data folder holds its cache and the web view's); on
/// Windows the library is in Roaming and the web view in Local.
fn roots<R: Runtime>(app: &tauri::AppHandle<R>) -> Vec<PathBuf> {
  let path = app.path();
  let mut found: Vec<PathBuf> = [path.app_data_dir(), path.app_local_data_dir(), path.app_cache_dir()]
    .into_iter()
    .flatten()
    .collect();
  found.sort();
  found.dedup();
  let all = found.clone();
  found.retain(|dir| !all.iter().any(|other| other != dir && dir.starts_with(other)));
  found
}

/// The folders of the web view's cache, which can be emptied at any time.
fn web_cache_dirs<R: Runtime>(app: &tauri::AppHandle<R>) -> Vec<PathBuf> {
  #[cfg(windows)]
  {
    let Ok(local) = app.path().app_local_data_dir() else {
      return Vec::new();
    };
    let profile = local.join("EBWebView").join("Default");
    vec![profile.join("Cache"), profile.join("Code Cache")]
  }
  #[cfg(target_os = "android")]
  {
    app.path().app_cache_dir().into_iter().collect()
  }
  #[cfg(not(any(windows, target_os = "android")))]
  {
    let _ = app;
    Vec::new()
  }
}

/// Each library's folder: the first at the top, the others under `libraries/`.
fn library_dirs() -> Vec<PathBuf> {
  let Ok(root) = storage::app_data_dir() else {
    return Vec::new();
  };
  let mut dirs = vec![root.clone()];
  if let Ok(entries) = fs::read_dir(root.join("libraries")) {
    dirs.extend(entries.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()));
  }
  dirs
}

fn usage<R: Runtime>(app: &tauri::AppHandle<R>) -> StorageUsage {
  let libraries = library_dirs();
  let within = |folder: &str| libraries.iter().map(|dir| sweep::disk_usage(&dir.join(folder))).sum();
  StorageUsage {
    total: roots(app).iter().map(|dir| sweep::disk_usage(dir)).sum(),
    books: within("books"),
    covers: within("covers"),
    cache: web_cache_dirs(app).iter().map(|dir| sweep::disk_usage(dir)).sum()
  }
}

/// Empties the web view's HTTP and code cache: the page's own files, kept
/// again as they are next asked for. Nothing the reader made is in it (that
/// is in the library, and the page's settings are in local storage, which
/// stays). Waits up to `wait` for the web view to say it is done.
fn clear_web_cache<R: Runtime>(app: &tauri::AppHandle<R>, wait: Duration) -> bool {
  let Some(webview) = app.get_webview_window("main") else {
    return false;
  };
  let (done, finished) = std::sync::mpsc::channel::<bool>();
  #[cfg(windows)]
  let asked = webview
    .with_webview(move |platform| {
      if let Err(error) = clear_webview2_cache(&platform.controller(), done.clone()) {
        crate::diag::warn(&format!("the web view's cache could not be emptied: {error}"));
        let _ = done.send(false);
      }
    })
    .is_ok();
  #[cfg(target_os = "android")]
  let asked = webview
    .with_webview(move |platform| {
      platform.jni_handle().exec(move |env, _activity, webview| {
        // `WebView.clearCache(true)`: the HTTP cache and its files, for every
        // web view of the app. Local storage is not part of it.
        let cleared = env.call_method(webview, "clearCache", "(Z)V", &[jni::objects::JValue::Bool(1)]).is_ok();
        if !cleared {
          // A Java exception left pending would fail the next call made here.
          let _ = env.exception_clear();
        }
        let _ = done.send(cleared);
      });
    })
    .is_ok();
  #[cfg(not(any(windows, target_os = "android")))]
  let asked = {
    let _ = (webview, done);
    false
  };
  asked && finished.recv_timeout(wait).unwrap_or(false)
}

/// WebView2's own "clear browsing data", for its disk cache only (which
/// takes the code cache with it): cookies, local storage and the rest stay.
#[cfg(windows)]
fn clear_webview2_cache(
  controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
  done: std::sync::mpsc::Sender<bool>
) -> windows::core::Result<()> {
  use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Profile2, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE
  };
  use windows::core::Interface;
  // SAFETY: on the web view's own thread (`with_webview`), on interfaces
  // WebView2 handed over; the handler owns what it uses.
  unsafe {
    let profile = controller.CoreWebView2()?.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile2>()?;
    let handler = webview2_com::ClearBrowsingDataCompletedHandler::create(Box::new(move |result| {
      let _ = done.send(result.is_ok());
      Ok(())
    }));
    profile.ClearBrowsingData(COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE, &handler)
  }
}

/// The library in use, read with its database held: which it is, where its
/// folder is, and what it lists.
fn live_library(state: &AppState) -> Option<(u64, PathBuf, sweep::Live)> {
  let db = state.db.guard();
  let epoch = state.epoch();
  let books = db.list_books().ok()?;
  let dir = storage::library_dir().ok()?;
  Some((epoch, dir, sweep::Live::of(&books)))
}

/// The tidy itself: what nothing lists, the half-written, the replaced, the
/// covers too big, and (on a phone) the copies an import is done with.
fn tidy_now<R: Runtime>(app: &tauri::AppHandle<R>, state: &AppState, stale: Duration) -> Swept {
  let mut swept = Swept::default();
  let now = SystemTime::now();
  if let Some((epoch, dir, live)) = live_library(state) {
    let moved = || state.epoch() != epoch;
    swept.add(sweep::sweep_library(&dir, &live, now, stale, &moved));
    swept.add(sweep::shrink_covers(&dir.join("covers"), &live, &moved));
  }
  #[cfg(target_os = "android")]
  if let Ok(cache) = app.path().app_cache_dir() {
    swept.add(sweep::sweep_import_copies(&cache, now, IMPORT_COPIES_AFTER));
  }
  #[cfg(not(target_os = "android"))]
  let _ = app;
  swept
}

/// Whether the last tidy is far enough back for another.
fn tidy_due(last: Option<&str>, now: chrono::DateTime<chrono::Utc>) -> bool {
  let Some(at) = last.and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok()) else {
    return true;
  };
  let since = now.signed_duration_since(at.with_timezone(&chrono::Utc));
  // A clock set back makes the last tidy look ahead: tidy then too.
  since.num_seconds() < 0 || since.to_std().is_ok_and(|since| since >= SWEEP_EVERY)
}

/// A little after startup, on a thread of its own: the tidy, if a day has
/// passed since the last, and the web view's cache emptied on the first
/// start of a new version.
pub fn tidy_after_startup<R: Runtime>(app: &tauri::AppHandle<R>) {
  let app = app.clone();
  let spawned = std::thread::Builder::new().name("leaflet-tidy".into()).spawn(move || {
    std::thread::sleep(SWEEP_AFTER);
    let Some(state) = app.try_state::<AppState>() else {
      return;
    };
    let version = env!("CARGO_PKG_VERSION");
    let (due, new_version) = {
      let db = state.db.guard();
      let last = db.get_setting(SWEPT_AT_SETTING).ok().flatten();
      let cleared_for = db.get_setting(WEB_CACHE_SETTING).ok().flatten();
      (tidy_due(last.as_deref(), chrono::Utc::now()), cleared_for.as_deref() != Some(version))
    };
    if new_version && clear_web_cache(&app, Duration::from_secs(30)) {
      let _ = state.db.guard().set_setting(WEB_CACHE_SETTING, version);
    }
    if !due {
      return;
    }
    let swept = tidy_now(&app, &state, sweep::STALE);
    let db = state.db.guard();
    let _ = db.set_setting(SWEPT_AT_SETTING, &db::now_iso());
    if swept.files > 0 {
      crate::diag::info(&format!("tidied {} file(s), {} KB", swept.files, swept.bytes / 1024));
    }
  });
  if let Err(error) = spawned {
    crate::diag::warn(&format!("the tidy did not start: {error}"));
  }
}

/// "Leaflet uses N MB on this device".
#[tauri::command]
pub async fn storage_usage(app: AppHandle) -> Result<StorageUsage, String> {
  tauri::async_runtime::spawn_blocking(move || usage(&app))
    .await
    .map_err(|error| format!("Could not measure: {error}"))
}

/// "Free up space": the tidy now, the web view's cache emptied, and the
/// database's log folded in. Answers with what it gave back.
#[tauri::command]
pub async fn storage_free_up(app: AppHandle) -> Result<FreedSpace, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let before = usage(&app);
    if let Some(state) = app.try_state::<AppState>() {
      tidy_now(&app, &state, FREE_UP_STALE);
      let db = state.db.guard();
      db.checkpoint();
      let _ = db.set_setting(SWEPT_AT_SETTING, &db::now_iso());
    }
    clear_web_cache(&app, Duration::from_secs(20));
    let after = usage(&app);
    FreedSpace { freed: before.total.saturating_sub(after.total), usage: after }
  })
  .await
  .map_err(|error| format!("Could not free up space: {error}"))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_tidy_runs_about_once_a_day() {
    let now = chrono::DateTime::parse_from_rfc3339("2026-10-18T12:00:00+00:00").expect("now").with_timezone(&chrono::Utc);
    assert!(tidy_due(None, now), "never tidied");
    assert!(tidy_due(Some("not a date"), now));
    assert!(!tidy_due(Some("2026-10-18T09:00:00+00:00"), now), "three hours ago");
    assert!(tidy_due(Some("2026-10-17T12:00:00+00:00"), now), "a day ago");
    assert!(tidy_due(Some("2026-10-19T12:00:00+00:00"), now), "a clock set back");
  }
}
