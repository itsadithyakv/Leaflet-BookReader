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
mod formats;
mod habit;
mod metadata;
mod pip;
mod reminders;
mod storage;
mod sync;

use std::path::Path;
use tauri::Manager;

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
      state.pending_open_paths.lock().unwrap().extend(paths);
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
      _app.manage(AppState {
        db: std::sync::Mutex::new(db::Database::new().expect("db init failed")),
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
      }
    })
    .invoke_handler(tauri::generate_handler![
      reminders::runtime::reminders_get,
      reminders::runtime::reminders_set,
      reminders::runtime::reminders_context,
      reminders::runtime::reminders_take_activation,
      reminders::runtime::reminders_preview,
      commands::import_books,
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
      commands::social_leaderboard,
      commands::social_profile_by_handle,
      commands::community_leaderboard,
      commands::community_profile,
      commands::community_follow,
      commands::community_following,
      commands::community_kudos,
      commands::community_challenge,
      commands::community_respond_duel,
      commands::community_duels,
      commands::community_inbox,
      commands::community_search,
      commands::account_status,
      commands::account_signup,
      commands::account_login,
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
      commands::pip_plant,
      commands::pip_harvest
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
