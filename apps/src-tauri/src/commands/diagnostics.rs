//! Diagnostics: the interface's errors in the log, and the report for support.

use super::*;

// ---- diagnostics ----------------------------------------------------------------

/// Records an error from the webview (a crashed screen, an unhandled rejection)
/// in the log, so it survives past a devtools console the release build lacks.
#[tauri::command]
pub fn log_client_error(message: String) {
  crate::diag::write("WEB", &message);
}

/// A plain-text report for Settings → "Copy diagnostics": versions, where the
/// data lives, what is switched on, and the end of the log. No tokens, emails
/// or book contents; file paths and error messages may name book files.
#[tauri::command]
pub fn diagnostics(state: State<'_, AppState>) -> Result<String, String> {
  let db = state.db.guard();
  let books = db.list_books().map(|books| books.len()).unwrap_or(0);
  let sessions = db.focus_sessions().map(|sessions| sessions.len()).unwrap_or(0);
  let folder = db.get_setting(FOLDER_SETTING).ok().flatten().filter(|value| !value.is_empty()).is_some();
  let drive = drive::load_refresh_token(&db).ok().flatten().is_some();
  let account = crate::sync::cloud::signed_in(&db);
  let schema = db.schema_version();
  let data_dir = crate::storage::app_data_dir().map(|dir| dir.display().to_string()).unwrap_or_default();
  drop(db);
  let lines = [
    format!("Leaflet {}", env!("CARGO_PKG_VERSION")),
    format!("Build: {}", if cfg!(debug_assertions) { "debug" } else { "release" }),
    format!("System: {} {}", std::env::consts::OS, std::env::consts::ARCH),
    format!("Packaged (Microsoft Store/MSIX): {}", crate::reminders::packaged()),
    format!("Data folder: {data_dir}"),
    format!("Database schema: v{schema} (this build expects v{})", crate::db::SCHEMA_VERSION),
    format!("Books: {books}, focus sessions: {sessions}"),
    format!("Backup: Drive {}, folder {}, Leaflet account {}", on_off(drive), on_off(folder), on_off(account)),
    format!("Report made: {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S %z")),
    String::new(),
    "Recent log:".to_string(),
    crate::diag::tail(200)
  ];
  Ok(lines.join("
"))
}

pub(crate) fn on_off(value: bool) -> &'static str {
  if value {
    "on"
  } else {
    "off"
  }
}
