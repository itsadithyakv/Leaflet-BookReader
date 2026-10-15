//! The Android side's own plugin, `leaflet-device`.
//!
//! The work is in Kotlin (`gen/android/app/src/main/java/com/leaflet/app/
//! DevicePlugin.kt`): the screen kept on, the rotation held, the system bars,
//! the picker and the share sheet, Google Play. The page calls those commands
//! directly (`invoke("plugin:leaflet-device|...")`, see `platform/android.ts`);
//! Tauri hands any command this plugin does not answer in Rust to Kotlin.
//!
//! Rust keeps two things: books arriving from other apps ("Open with",
//! "Share to Leaflet"), which Kotlin copies in and reports here so they join
//! the queue the desktop uses for a second launch (`take_pending_open_paths`
//! and the `open-book-files` event); and a nudge to Kotlin after each page
//! load to send the window insets again, since the page may load after them.
//!
//! Also: a startup failure shown on the page, as there is no message box.

use std::sync::Mutex;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::webview::PageLoadEvent;
use tauri::{Emitter, Manager, Runtime};

use crate::{AppState, LockExt};

/// Books that arrived before the library was open (a cold start by "Open with").
static ARRIVED_EARLY: Mutex<Vec<String>> = Mutex::new(Vec::new());

struct Device<R: Runtime>(PluginHandle<R>);

/// Why Leaflet could not start, to be shown on the page instead of the library.
pub struct StartupFailure(pub String);

#[derive(serde::Deserialize)]
struct Opened {
  #[serde(default)]
  paths: Vec<String>
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("leaflet-device")
    .setup(|app, api| {
      let handle = api.register_android_plugin("com.leaflet.app", "DevicePlugin")?;
      let app_handle = app.clone();
      let opened = Channel::<serde_json::Value>::new(move |body| {
        let paths = match body {
          InvokeResponseBody::Json(json) => serde_json::from_str::<Opened>(&json).map(|opened| opened.paths).unwrap_or_default(),
          InvokeResponseBody::Raw(_) => Vec::new()
        };
        arrived(&app_handle, paths);
        Ok(())
      });
      handle.run_mobile_plugin::<()>("registerListener", serde_json::json!({ "event": "opened", "handler": opened }))?;
      app.manage(Device(handle));
      Ok(())
    })
    .on_page_load(|webview, payload| {
      if payload.event() != PageLoadEvent::Finished {
        return;
      }
      if let Some(failure) = webview.try_state::<StartupFailure>() {
        let _ = webview.eval(failure_script(&failure.0));
      }
      if let Some(device) = webview.try_state::<Device<R>>() {
        // Not on this thread: Kotlin answers on the main thread, which may be this one.
        let handle = device.0.clone();
        tauri::async_runtime::spawn(async move {
          let _ = handle.run_mobile_plugin_async::<()>("resendInsets", ()).await;
        });
      }
    })
    .build()
}

/// Books copied in from another app: queued for the page, which is told.
fn arrived<R: Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
  if paths.is_empty() {
    return;
  }
  crate::diag::info(&format!("{} book(s) arrived from another app", paths.len()));
  match app.try_state::<AppState>() {
    Some(state) => state.pending_open_paths.guard().extend(paths),
    None => ARRIVED_EARLY.guard().extend(paths)
  }
  let _ = app.emit("open-book-files", ());
}

/// What arrived before the library's state existed; taken with the rest.
pub fn take_arrived_early() -> Vec<String> {
  std::mem::take(&mut *ARRIVED_EARLY.guard())
}

/// Replaces the page with the reason Leaflet could not start.
fn failure_script(message: &str) -> String {
  let text = serde_json::to_string(message).unwrap_or_else(|_| "\"\"".to_string());
  format!(
    "(function(m){{var d=document,b=d.body||d.documentElement;b.innerHTML='';\
     var box=d.createElement('div');box.style.cssText='font:16px/1.5 sans-serif;padding:calc(var(--inset-top,0px) + 32px) 24px 24px;color:#2b2620;background:#fbf7ee;min-height:100vh;box-sizing:border-box';\
     var h=d.createElement('h1');h.textContent=\"Leaflet can't start\";h.style.cssText='font-size:22px;margin:0 0 12px';\
     var p=d.createElement('p');p.style.whiteSpace='pre-wrap';p.textContent=m;\
     box.appendChild(h);box.appendChild(p);b.appendChild(box);}})({text})"
  )
}

