//! The app itself.
//!
//! This lives in a library rather than in `main.rs` because Android and iOS do
//! not start a Rust binary: the platform starts its own host activity, which
//! loads this crate as a `cdylib` and calls the entry point below. The desktop
//! binary is a three-line wrapper around the same function, so both platforms
//! run identical setup.

mod comic;
mod commands;
mod convert;
mod db;
mod desktop_pip;
mod diag;
mod formats;
mod habit;
mod http;
mod lookup;
mod metadata;
mod pip;
mod reminders;
mod storage;
mod sync;

use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};
use tauri::Manager;

/// `lock()` that survives a panic elsewhere.
///
/// A plain `lock().unwrap()` turns one panic while a lock is held into a panic
/// on every later use: the mutex is "poisoned" and every command touching the
/// library fails until the app restarts. The data behind these locks (a SQLite
/// connection, whose transactions roll back when dropped, and small caches) is
/// still usable after such a panic, so the guard is recovered instead.
pub trait LockExt<T> {
  fn guard(&self) -> MutexGuard<'_, T>;
}

impl<T> LockExt<T> for Mutex<T> {
  fn guard(&self) -> MutexGuard<'_, T> {
    self.lock().unwrap_or_else(PoisonError::into_inner)
  }
}

/// Opens the library database, or explains why it can't and offers a way on.
///
/// A locked, damaged or unreadable `library.db` used to end the app before its
/// window appeared, with nothing on screen and nothing logged. Now the reader
/// is told, and can set the broken file aside (it is renamed, never deleted)
/// and start with an empty library. Book files are not touched.
fn open_database() -> Result<db::Database, String> {
  let error = match db::Database::new() {
    Ok(database) => return Ok(database),
    Err(error) => error
  };
  diag::error(&format!("the library database did not open: {error:#}"));
  let path = db::database_path().map_err(|e| e.to_string())?;
  let set_aside = diag::ask(
    "Leaflet can't open your library",
    &format!(
      "Leaflet couldn't open its library database:\n\n{error}\n\nIf another copy of Leaflet is running, choose No, close it, and try again.\n\nChoose Yes to set the damaged database aside and start with an empty library. Your book files are kept, the old database is renamed (not deleted), and a Drive backup can restore your library.\n\nThe database is at:\n{}",
      path.display()
    )
  );
  if !set_aside {
    return Err(format!("library database did not open: {error}"));
  }
  let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
  for suffix in ["", "-wal", "-shm"] {
    let from = std::path::PathBuf::from(format!("{}{suffix}", path.display()));
    if from.exists() {
      let to = std::path::PathBuf::from(format!("{}.broken-{stamp}{suffix}", path.display()));
      if let Err(rename) = std::fs::rename(&from, &to) {
        diag::error(&format!("could not set {} aside: {rename}", from.display()));
      }
    }
  }
  diag::warn(&format!("set the damaged library database aside as {}.broken-{stamp}", path.display()));
  db::Database::new().map_err(|again| {
    diag::error(&format!("a fresh library database did not open either: {again:#}"));
    format!("a fresh library database did not open: {again}")
  })
}

pub struct AppState {
  pub db: std::sync::Mutex<db::Database>,
  pub drive: std::sync::Mutex<sync::DriveState>,
  pub pending_open_paths: std::sync::Mutex<Vec<String>>,
  /// Serialises `sync_now`. Async, because a run holds it across network calls.
  pub sync_lock: tokio::sync::Mutex<()>,
  /// Page entry names per open comic, so paging does not re-list the archive.
  pub comic_pages: std::sync::Mutex<std::collections::HashMap<String, OpenComic>>
}

/// A comic's page index and how many readers hold it. Counted, because React
/// may open a reader, close it and open it again before the first close lands;
/// that close must not pull the index out from under the second reader.
pub struct OpenComic {
  pub pages: Vec<String>,
  pub readers: usize
}

/// Books passed on the command line, for "Open with Leaflet".
///
/// A phone launches the app through an intent rather than with arguments, so
/// this is always empty there; it costs nothing and keeps one code path.
fn supported_book_paths(args: impl IntoIterator<Item = String>) -> Vec<String> {
  args
    .into_iter()
    .filter(|value| {
      let path = Path::new(value);
      path.is_file()
        && path
          .extension()
          .and_then(|extension| extension.to_str())
          .map(formats::is_supported)
          .unwrap_or(false)
    })
    .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Development only. A release build has its values compiled in (see
  // .env.example), and a packaged app should not pick up whatever `.env`
  // happens to sit in the directory it was launched from.
  #[cfg(debug_assertions)]
  dotenvy::dotenv().ok();
  let startup_paths = supported_book_paths(std::env::args().skip(1));

  let builder = tauri::Builder::default();

  // Single-instance is a desktop idea: it exists to focus an already-running
  // window when a second launch arrives with a file. Android and iOS manage app
  // lifecycle themselves and the plugin does not build for them.
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
    // A reminder toast clicked while Leaflet is already open.
    reminders::runtime::note_activation(app, &args);
    let paths = supported_book_paths(args.into_iter().skip(1));
    if !paths.is_empty() {
      let state = app.state::<AppState>();
      state.pending_open_paths.guard().extend(paths);
      let _ = tauri::Emitter::emit(app, "open-book-files", ());
    }

    if let Some(window) = app.get_webview_window("main") {
      let _ = window.unminimize();
      let _ = window.show();
      let _ = window.set_focus();
    }
  }));

  builder
    .plugin(tauri_plugin_dialog::init())
    // Opens the OAuth consent page in the system browser: Google refuses to
    // run its sign-in inside an embedded webview.
    .plugin(tauri_plugin_opener::init())
    .setup(move |_app| {
      // Must happen before the database is opened, which is why state is
      // managed here rather than on the builder.
      if let Ok(dir) = _app.path().app_data_dir() {
        storage::set_app_data_dir(dir);
      }
      diag::install_panic_hook();
      diag::info(&format!("Leaflet {} starting", env!("CARGO_PKG_VERSION")));
      let database = match open_database() {
        Ok(database) => database,
        Err(message) => {
          diag::tell(
            "Leaflet can't start",
            &format!("{message}\n\nDetails are in the log:\n{}", diag::log_path().map(|p| p.display().to_string()).unwrap_or_default())
          );
          return Err(message.into());
        }
      };
      _app.manage(AppState {
        db: std::sync::Mutex::new(database),
        drive: std::sync::Mutex::new(sync::DriveState::default()),
        pending_open_paths: std::sync::Mutex::new(startup_paths),
        sync_lock: tokio::sync::Mutex::new(()),
        comic_pages: std::sync::Mutex::new(std::collections::HashMap::new())
      });

      // Learn where Leaflet's server is from the signed config, in the
      // background: offline or a bad file just keeps the last good address.
      let handle = _app.handle().clone();
      tauri::async_runtime::spawn(async move {
        let state = handle.state::<AppState>();
        let _ = sync::remote_config::refresh(&state.db).await;
      });

      // Reading reminders: takes over from Windows' schedule while running.
      reminders::runtime::init(_app.handle());
      // Pip on the desktop: nothing starts until the reader has switched her on.
      desktop_pip::runtime::init(_app.handle());

      // A window icon is a desktop window-manager concept; a phone takes its
      // icon from the manifest instead.
      #[cfg(desktop)]
      if let Some(window) = _app.get_webview_window("main") {
        let bytes = include_bytes!("../../src/assets/pip/pip-256.png");
        if let Ok(decoded) = image::load_from_memory(bytes) {
          let rgba = decoded.to_rgba8();
          let (width, height) = rgba.dimensions();
          let icon = tauri::image::Image::new_owned(rgba.into_raw(), width, height);
          let _ = window.set_icon(icon);
        }
      }
      Ok(())
    })
    // Closing the main window is how Leaflet exits: the moment to leave the
    // next reminders with Windows.
    .on_window_event(|window, event| {
      if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "main" {
        reminders::runtime::schedule_for_exit(window.app_handle());
        // Desktop Pip's window goes too, or the process would stay for it.
        desktop_pip::runtime::shutdown(window.app_handle());
      }
    })
    .invoke_handler(tauri::generate_handler![
      reminders::runtime::reminders_get,
      reminders::runtime::reminders_set,
      reminders::runtime::reminders_context,
      reminders::runtime::reminders_take_activation,
      reminders::runtime::reminders_preview,
      desktop_pip::runtime::desktop_pip_set,
      desktop_pip::runtime::desktop_pip_status,
      desktop_pip::runtime::desktop_pip_attach,
      desktop_pip::runtime::desktop_pip_stroll,
      desktop_pip::runtime::desktop_pip_halt,
      desktop_pip::runtime::desktop_pip_hold,
      desktop_pip::runtime::desktop_pip_release,
      desktop_pip::runtime::desktop_pip_frame,
      desktop_pip::runtime::desktop_pip_act,
      commands::import_books,
      commands::import_books_report,
      commands::save_page_cover,
      commands::list_books,
      commands::refresh_metadata,
      commands::fetch_cover,
      commands::cover_data,
      commands::read_book_bytes,
      commands::update_progress,
      commands::reading_stats,
      commands::drive_auth_start,
      commands::drive_auth_wait,
      commands::drive_disconnect,
      commands::set_drive_credentials,
      commands::clear_drive_credentials,
      commands::sync_status,
      commands::sync_now,
      commands::set_sync_folder,
      commands::set_cloud_api,
      commands::social_profile,
      commands::save_social_profile,
      commands::publish_social_stats,
      commands::log_client_error,
      commands::diagnostics,
      commands::epub_sections,
      commands::annotations_list,
      commands::annotations_highlight_counts,
      commands::annotation_save,
      commands::annotation_delete,
      commands::people_list,
      commands::people_save,
      commands::people_delete,
      commands::people_export,
      commands::lookup_term,
      commands::diary_sources,
      commands::diary_save_picture,
      commands::words_list,
      commands::word_record,
      commands::words_review,
      commands::words_delete,
      commands::collections_list,
      commands::collection_save,
      commands::collection_delete,
      commands::reading_profile_get,
      commands::reading_profile_set,
      commands::book_set_series,
      commands::scan_series,
      commands::community_leaderboard,
      commands::community_profile,
      commands::community_follow,
      commands::community_kudos,
      commands::community_challenge,
      commands::community_respond_duel,
      commands::community_duels,
      commands::community_inbox,
      commands::community_search,
      commands::community_visitors,
      commands::account_status,
      commands::account_signup,
      commands::account_login,
      commands::account_reset_request,
      commands::account_reset_confirm,
      commands::account_set_avatar,
      commands::account_logout,
      commands::account_change_password,
      commands::account_delete,
      commands::open_public_link,
      commands::open_store_review,
      commands::download_book,
      commands::delete_book,
      commands::converter_status,
      commands::install_converter,
      commands::library_copy_status,
      commands::library_copy_set,
      commands::library_copy_run,
      commands::cloud_reachable,
      commands::take_pending_open_paths,
      commands::clear_all_data,
      commands::supported_formats,
      commands::needs_converter,
      commands::comic_open,
      commands::comic_page,
      commands::comic_close,
      commands::habit_snapshot,
      commands::credit_reading_minutes,
      commands::set_habit_goal,
      commands::record_focus_session,
      commands::add_focus_note,
      commands::import_legacy_habit,
      commands::pip_wallet,
      commands::pip_state_get,
      commands::pip_buy,
      commands::pip_state_set,
      commands::pip_feed,
      commands::pip_game_played,
      commands::pip_played,
      commands::pip_plant,
      commands::pip_harvest
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
