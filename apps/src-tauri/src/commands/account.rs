//! The optional Leaflet account, and links out of the app.

use super::*;

// ---- account ---------------------------------------------------------------
//
// Optional email + password accounts on the Leaflet server. The session token
// lives in the OS keychain (see `sync/cloud.rs`); nothing here returns it.

/// Who is signed in. `refresh` asks the server (and notices a revoked session);
/// without it the answer is local and instant.
#[tauri::command]
pub async fn account_status(
  refresh: Option<bool>,
  state: State<'_, AppState>
) -> Result<cloud::AccountStatus, String> {
  cloud::status(&state.db, refresh.unwrap_or(false))
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn account_signup(
  email: String,
  password: String,
  display_name: Option<String>,
  avatar: Option<String>,
  state: State<'_, AppState>
) -> Result<cloud::AccountStatus, String> {
  let display_name = display_name.filter(|name| !name.trim().is_empty());
  cloud::signup(&state.db, &email, &password, display_name.as_deref(), avatar.as_deref())
    .await
    .map_err(|e| e.to_string())
}

/// Picks a new avatar (`skin.move`), or clears it with `None`. The server
/// refuses ids that are not in its catalogue.
#[tauri::command]
pub async fn account_set_avatar(
  avatar: Option<String>,
  state: State<'_, AppState>
) -> Result<cloud::AccountStatus, String> {
  cloud::set_avatar(&state.db, avatar.as_deref())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn account_login(
  email: String,
  password: String,
  state: State<'_, AppState>
) -> Result<cloud::AccountStatus, String> {
  cloud::login(&state.db, &email, &password)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn account_logout(state: State<'_, AppState>) -> Result<cloud::AccountStatus, String> {
  cloud::logout(&state.db).await.map_err(|e| e.to_string())
}

/// Changes the password; the server signs out every other device.
#[tauri::command]
pub async fn account_change_password(
  current: String,
  next: String,
  state: State<'_, AppState>
) -> Result<(), String> {
  cloud::change_password(&state.db, &current, &next)
    .await
    .map_err(|e| e.to_string())
}

/// Deletes the account and everything the server holds for it. Books and
/// reading history on this device are not touched.
#[tauri::command]
pub async fn account_delete(
  password: String,
  state: State<'_, AppState>
) -> Result<cloud::AccountStatus, String> {
  cloud::delete_account(&state.db, &password)
    .await
    .map_err(|e| e.to_string())
}

/// Opens a public page (the privacy policy, the terms) in the system browser.
/// https only: the webview has no general URL-opening permission.
/// Leaflet's own listing in the Microsoft Store.
pub(crate) const STORE_REVIEW_URL: &str = "ms-windows-store://review/?ProductId=9PH0NLGJFF9W";

/// Opens the Microsoft Store's "rate and review" dialog for Leaflet. The
/// address is fixed here rather than taken from the page, so this command can
/// open nothing but Leaflet's own review.
#[tauri::command]
pub fn open_store_review(app: tauri::AppHandle) -> Result<(), String> {
  tauri_plugin_opener::OpenerExt::opener(&app)
    .open_url(STORE_REVIEW_URL, None::<&str>)
    .map_err(|error| format!("Could not open the Microsoft Store: {error}"))
}

#[tauri::command]
pub fn open_public_link(url: String, app: tauri::AppHandle) -> Result<(), String> {
  if !url.starts_with("https://") {
    return Err("Only https links can be opened.".to_string());
  }
  tauri_plugin_opener::OpenerExt::opener(&app)
    .open_url(&url, None::<&str>)
    .map_err(|error| format!("Could not open your browser: {error}"))
}
