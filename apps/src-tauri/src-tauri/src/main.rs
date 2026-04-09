mod commands;
mod db;
mod metadata;
mod storage;
mod sync;

use tauri::Manager;

pub struct AppState {
  pub db: std::sync::Mutex<db::Database>,
  pub drive: std::sync::Mutex<sync::DriveState>
}

fn main() {
  tauri::Builder::default()
    .manage(AppState {
      db: std::sync::Mutex::new(db::Database::new().expect("db init failed")),
      drive: std::sync::Mutex::new(sync::DriveState::default())
    })
    .invoke_handler(tauri::generate_handler![
      commands::import_books,
      commands::list_books,
      commands::refresh_metadata,
      commands::update_progress,
      commands::drive_auth_start,
      commands::drive_auth_wait,
      commands::drive_sync,
      commands::converter_status,
      commands::install_converter
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
