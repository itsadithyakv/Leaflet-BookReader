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

/// Emails a reset code (if the address has an account). Minutes it lasts.
#[tauri::command]
pub async fn account_reset_request(email: String, state: State<'_, AppState>) -> Result<u32, String> {
  cloud::request_password_reset(&state.db, email.trim())
    .await
    .map_err(|e| e.to_string())
}

/// A new password with the emailed code; signs this device in.
#[tauri::command]
pub async fn account_reset_confirm(
  email: String,
  code: String,
  password: String,
  state: State<'_, AppState>
) -> Result<cloud::AccountStatus, String> {
  cloud::reset_password(&state.db, email.trim(), &code, &password)
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

/// What may be handed to the system to open, as it will be handed over: an
/// https address, or `mailto:` and one plain mail address (a PDF's "write to
/// us" link). Everything else is refused: `http`, `file`, `javascript`, a
/// program's own scheme. A mail link's `?subject=...&body=...&attach=...` is
/// dropped, so a link in a book can start a letter but not write or load one.
fn openable_link(url: &str) -> Result<String, String> {
  let url = url.trim();
  if url.starts_with("https://") {
    return Ok(url.to_string());
  }
  let refused = || "Only https links and mail addresses can be opened.".to_string();
  let (scheme, rest) = url.split_once(':').ok_or_else(refused)?;
  if !scheme.eq_ignore_ascii_case("mailto") {
    return Err(refused());
  }
  let address = rest.split('?').next().unwrap_or("");
  let (name, host) = address.split_once('@').ok_or_else(refused)?;
  let plain = |part: &str, extra: &str| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_alphanumeric() || extra.contains(ch));
  let host_ok = host.contains('.') && host.split('.').all(|label| plain(label, "-") && !label.starts_with('-') && !label.ends_with('-'));
  if address.len() > 254 || !plain(name, "._%+-") || !host_ok {
    return Err(refused());
  }
  Ok(format!("mailto:{address}"))
}

#[tauri::command]
pub fn open_public_link(url: String, app: tauri::AppHandle) -> Result<(), String> {
  let url = openable_link(&url)?;
  tauri_plugin_opener::OpenerExt::opener(&app)
    .open_url(&url, None::<&str>)
    .map_err(|error| format!("Could not open that link: {error}"))
}

#[cfg(test)]
mod link_tests {
  use super::openable_link;

  /// The whole list of what the app will open from a link in a book or a page.
  #[test]
  fn only_https_and_a_plain_mail_address_are_opened() {
    assert_eq!(openable_link("https://example.org/a?b=c#d").as_deref(), Ok("https://example.org/a?b=c#d"));
    assert_eq!(openable_link("mailto:business@example.org").as_deref(), Ok("mailto:business@example.org"));
    assert_eq!(openable_link(" MAILTO:first.last+books@mail.example.co.uk ").as_deref(), Ok("mailto:first.last+books@mail.example.co.uk"));
    // What follows the address is not passed on.
    assert_eq!(openable_link("mailto:a@example.org?subject=Hi&body=x&attach=C:/secret.txt").as_deref(), Ok("mailto:a@example.org"));
    for refused in [
      "http://example.org/",
      "HTTPS://example.org/",
      "file:///C:/Windows/system32/calc.exe",
      "javascript:alert(1)",
      "ms-settings:privacy",
      "tel:+15551234567",
      "data:text/html,hi",
      "C:\\Windows\\notepad.exe",
      "example.org",
      "",
      "mailto:",
      "mailto:nobody",
      "mailto:a@b",
      "mailto:a@-example.org",
      "mailto:a b@example.org",
      "mailto:a@example.org,b@example.org",
      "mailto:a@example.org%0Abcc:x@example.org",
      "mailto:\"quoted\"@example.org",
      "mailto:?to=a@example.org",
      "mailto://example.org/a@b.c"
    ] {
      assert!(openable_link(refused).is_err(), "{refused}");
    }
  }
}
