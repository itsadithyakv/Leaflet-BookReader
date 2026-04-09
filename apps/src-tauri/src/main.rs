#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod metadata;
mod storage;
mod sync;
use tauri::{image::Image, Manager};

pub struct AppState {
  pub db: std::sync::Mutex<db::Database>,
  pub drive: std::sync::Mutex<sync::DriveState>
}

fn main() {
  dotenvy::dotenv().ok();
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if let Some(window) = app.get_webview_window("main") {
        let bytes = include_bytes!("../../src/assets/LeafletLogo.png");
        if let Ok(decoded) = image::load_from_memory(bytes) {
          let rgba = decoded.to_rgba8();
          let (width, height) = rgba.dimensions();
          let icon = Image::new_owned(rgba.into_raw(), width, height);
          let _ = window.set_icon(icon);
        }
        let _ = window.maximize();
      }
      Ok(())
    })
    .manage(AppState {
      db: std::sync::Mutex::new(db::Database::new().expect("db init failed")),
      drive: std::sync::Mutex::new(sync::DriveState::default())
    })
    .invoke_handler(tauri::generate_handler![
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
      commands::drive_status,
      commands::drive_sync,
      commands::converter_status,
      commands::install_converter,
      commands::clear_all_data
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
