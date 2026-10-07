//! Sync through Leaflet's own API, backed by MongoDB.
//!
//! The third transport, and the only one with a server behind it. It exists for
//! what the other two cannot do: compare readers to each other. A leaderboard is
//! not a peer-to-peer problem.
//!
//! It carries the **state document only** — never book files. Those stay in the
//! reader's own Drive or sync folder, where they cost the operator nothing. A
//! year of reading compresses to roughly 15 KB, so a free 512 MB cluster holds
//! several thousand readers; the same cluster would hold about three libraries.
//!
//! The server stores the document as an opaque blob and never looks inside it.
//! Merging stays here, in [`crate::sync::merge`], so all three transports agree
//! by construction rather than by three implementations happening to match.

use crate::db::Database;
use crate::sync::folder::SyncReport;
use crate::sync::merge::{self, SyncDoc};
use crate::sync::store;
use anyhow::{anyhow, Result};
use base64::Engine;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::time::Duration;
use crate::LockExt;

pub const API_BASE_SETTING: &str = "cloud_api_base";
pub const PROFILE_VISIBILITY_SETTING: &str = "cloud_profile_visibility";

/// Retries after losing a race for the document. Each one is a fresh merge, so
/// nothing the other device wrote is lost.
const MAX_CONFLICT_RETRIES: u32 = 3;

#[derive(Debug, Deserialize)]
struct StateResponse {
  version: i64,
  /// Base64 of the gzipped document. Absent for a reader who has never synced.
  state: Option<String>
}

#[derive(Debug, Serialize)]
struct StatePush<'a> {
  version: i64,
  state: &'a str
}

/// The default API base, baked in at build time (`LEAFLET_API_BASE`), mirroring
/// how the Google client id is shipped in `drive.rs`. `build.rs` declares it with
/// `rerun-if-env-changed` so changing it rebuilds the crate. A reader can still
/// point this device at another server in Settings.
const BUILD_API_BASE: Option<&str> = option_env!("LEAFLET_API_BASE");

fn build_default_api_base() -> Option<String> {
  BUILD_API_BASE
    .filter(|value| !value.trim().is_empty())
    .map(str::to_string)
    .or_else(|| std::env::var("LEAFLET_API_BASE").ok())
    .and_then(|value| normalise_api_base(&value).ok())
    .filter(|value| !value.is_empty())
}

/// Checks and tidies an API base. Empty means "none".
///
/// `https://` anywhere; plain `http://` only for this machine, because the
/// session token and password travel in these requests.
pub fn normalise_api_base(value: &str) -> Result<String> {
  let trimmed = value.trim().trim_end_matches('/');
  if trimmed.is_empty() {
    return Ok(String::new());
  }
  let url = reqwest::Url::parse(trimmed).map_err(|_| anyhow!("That does not look like a web address."))?;
  let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
  match url.scheme() {
    "https" => {}
    "http" if local => {}
    "http" => return Err(anyhow!("Use https:// — plain http:// is only allowed for localhost.")),
    _ => return Err(anyhow!("That should start with https://"))
  }
  if url.host_str().is_none_or(str::is_empty) || !url.username().is_empty() || url.password().is_some() {
    return Err(anyhow!("That does not look like a web address."));
  }
  // Every request is this address with a path put on the end. After a `?` or
  // a `#` that path is not a path any more, and each call went to the site's
  // front page instead, the sign-in form's email and password with it.
  if url.query().is_some() || url.fragment().is_some() {
    return Err(anyhow!("Leave out everything from the ? or # on: just the server's address."));
  }
  Ok(trimmed.to_string())
}

/// The API base, most specific first: this device's setting, then the last
/// signed config from GitHub Pages (see `remote_config`), then the build's
/// default.
pub fn api_base(db: &Database) -> Option<String> {
  db.get_setting(API_BASE_SETTING)
    .ok()
    .flatten()
    .and_then(|value| normalise_api_base(&value).ok())
    .filter(|value| !value.is_empty())
    .or_else(|| crate::sync::remote_config::cached(db))
    .or_else(build_default_api_base)
}

/// Whether this device names its own server, rather than using Leaflet's.
pub fn api_base_is_custom(db: &Database) -> bool {
  db.get_setting(API_BASE_SETTING)
    .ok()
    .flatten()
    .and_then(|value| normalise_api_base(&value).ok())
    .is_some_and(|value| !value.is_empty())
}

/// Saves this device's API base. Empty falls back to the build's default.
pub fn set_api_base(db: &Database, value: &str) -> Result<()> {
  let normalised = normalise_api_base(value)?;
  db.set_setting(API_BASE_SETTING, &normalised)?;
  Ok(())
}

fn compress(doc: &SyncDoc) -> Result<String> {
  let json = serde_json::to_vec(doc)?;
  let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
  encoder.write_all(&json)?;
  Ok(base64::engine::general_purpose::STANDARD.encode(encoder.finish()?))
}

fn decompress(encoded: &str, now: &str) -> SyncDoc {
  let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) else {
    return SyncDoc::empty(now);
  };
  let mut json = Vec::new();
  if GzDecoder::new(&bytes[..]).read_to_end(&mut json).is_err() {
    return SyncDoc::empty(now);
  }
  // A corrupt document must not take the library down; republishing this
  // device's own state is the recoverable outcome.
  serde_json::from_slice(&json).unwrap_or_else(|_| SyncDoc::empty(now))
}

async fn describe_failure(response: reqwest::Response) -> anyhow::Error {
  let status = response.status();
  let body = response.text().await.unwrap_or_default();
  let message = serde_json::from_str::<serde_json::Value>(&body)
    .ok()
    .and_then(|json| json.get("error").and_then(|e| e.as_str()).map(str::to_string))
    .unwrap_or_else(|| body.chars().take(200).collect());

  match status.as_u16() {
    401 => anyhow!("Your Leaflet sign-in has ended. Sign in again in Settings."),
    404 => anyhow!("That Leaflet server has no such endpoint — check the address."),
    413 => anyhow!("Your library is too large for cloud sync."),
    400..=499 => anyhow!("{message}"),
    _ => anyhow!("Leaflet server error ({status}): {message}")
  }
}

fn client() -> Result<reqwest::Client> {
  Ok(
    reqwest::Client::builder()
      .timeout(Duration::from_secs(45))
      .build()?
  )
}

/// A 401 on an authenticated call means the session is gone server-side
/// (expired, revoked by a password change, or the account was deleted).
fn forget_if_unauthorised(db_mutex: &std::sync::Mutex<Database>, status: reqwest::StatusCode) {
  if status == reqwest::StatusCode::UNAUTHORIZED {
    if let Ok(db) = db_mutex.lock() {
      clear_session(&db);
    }
  }
}

// ---- account ----------------------------------------------------------------

/// Where the session token lives: the OS keychain, never SQLite or the webview.
const KEYRING_SERVICE: &str = "app.leaflet.account";
const KEYRING_USER: &str = "session-token";
/// The server a stored session belongs to. A token is meaningless elsewhere.
pub const ACCOUNT_API_SETTING: &str = "account_api_base";
/// The last account the server described (email, display name). Not a secret;
/// kept so Settings can show who is signed in while offline.
pub const ACCOUNT_CACHE_SETTING: &str = "account_cached";
const SIGN_IN_FIRST: &str = "Sign in to your Leaflet account first.";

/// Also held in memory, so a platform whose keychain does not persist (the
/// keyring crate falls back to a mock there) still works for the process's life.
static SESSION_CACHE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn store_session_token(token: &str) -> Result<()> {
  *SESSION_CACHE.lock().map_err(|_| anyhow!("session store is busy"))? = Some(token.to_string());
  keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
    .and_then(|entry| entry.set_password(token))
    .map_err(|e| anyhow!("Could not save your sign-in to the system keychain: {e}"))
}

fn load_session_token() -> Option<String> {
  if let Some(token) = SESSION_CACHE.lock().ok().and_then(|cache| cache.clone()) {
    return Some(token);
  }
  let token = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
    .and_then(|entry| entry.get_password())
    .ok()
    .filter(|token| !token.is_empty())?;
  if let Ok(mut cache) = SESSION_CACHE.lock() {
    *cache = Some(token.clone());
  }
  Some(token)
}

/// Forgets the session on this device: keychain, memory and cached details.
pub fn clear_session(db: &Database) {
  if let Ok(mut cache) = SESSION_CACHE.lock() {
    *cache = None;
  }
  if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
    let _ = entry.delete_credential();
  }
  let _ = db.set_setting(ACCOUNT_API_SETTING, "");
  let _ = db.set_setting(ACCOUNT_CACHE_SETTING, "");
  // Whether the profile is shared belongs to the account that was signed in.
  // Kept, it made the next account on this computer publish (or not) by the
  // last one's choice.
  forget_visibility(db);
}

/// Whether the signed-in reader shares their profile, as this device last
/// heard it from the server: `Some(true)` public, `Some(false)` private, and
/// `None` when it has not heard (a new sign-in, another device made the
/// choice, a fresh install).
///
/// A copy only. The server holds the truth; this is what lets the app decide
/// to publish nothing for a private reader without asking every time.
pub fn known_visibility(db: &Database) -> Option<bool> {
  match db.get_setting(PROFILE_VISIBILITY_SETTING).ok().flatten().as_deref() {
    Some("public") => Some(true),
    Some("private") => Some(false),
    _ => None
  }
}

/// Keeps what the server said about the profile's visibility.
pub fn remember_visibility(db: &Database, visibility: &str) {
  let value = if visibility == "public" { "public" } else { "private" };
  let _ = db.set_setting(PROFILE_VISIBILITY_SETTING, value);
}

pub fn forget_visibility(db: &Database) {
  let _ = db.set_setting(PROFILE_VISIBILITY_SETTING, "");
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
  pub id: String,
  pub email: String,
  #[serde(default)]
  pub display_name: Option<String>,
  /// The avatar the reader picked, `skin.move` (see `apps/src/pip/avatars.ts`).
  /// Absent on accounts cached before avatars existed, hence the default.
  #[serde(default)]
  pub avatar: Option<String>,
  #[serde(default)]
  pub created_at: Option<String>
}

/// What Settings needs to draw the Account card.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
  /// A server is configured, so accounts can be used at all.
  pub available: bool,
  pub api_base: Option<String>,
  pub signed_in: bool,
  pub account: Option<Account>,
  /// Signed in, but the server could not be reached to confirm it.
  pub offline: bool
}

#[derive(Deserialize)]
struct SessionResponse {
  token: String,
  account: Account
}

#[derive(Deserialize)]
struct MeResponse {
  account: Account
}

fn cached_account(db: &Database) -> Option<Account> {
  db.get_setting(ACCOUNT_CACHE_SETTING)
    .ok()
    .flatten()
    .and_then(|raw| serde_json::from_str(&raw).ok())
}

fn remember_account(db: &Database, base: &str, account: &Account) -> Result<()> {
  db.set_setting(ACCOUNT_API_SETTING, base)?;
  db.set_setting(ACCOUNT_CACHE_SETTING, &serde_json::to_string(account)?)?;
  Ok(())
}

fn configured_base(db_mutex: &std::sync::Mutex<Database>) -> Result<String> {
  let db = db_mutex.guard();
  api_base(&db).ok_or_else(|| anyhow!("No Leaflet server is configured."))
}

/// The configured server and this device's session for it. A token minted by
/// a different server is dropped rather than sent there.
fn session_token(db_mutex: &std::sync::Mutex<Database>) -> Result<(String, String)> {
  let db = db_mutex.guard();
  let base = api_base(&db).ok_or_else(|| anyhow!("No Leaflet server is configured."))?;
  let owner = db.get_setting(ACCOUNT_API_SETTING).ok().flatten().unwrap_or_default();
  match load_session_token() {
    Some(token) if owner == base => Ok((base, token)),
    Some(_) => {
      clear_session(&db);
      Err(anyhow!(SIGN_IN_FIRST))
    }
    None => Err(anyhow!(SIGN_IN_FIRST))
  }
}

/// Whether this device holds a session for the configured server.
pub fn signed_in(db: &Database) -> bool {
  let Some(base) = api_base(db) else {
    return false;
  };
  let owner = db.get_setting(ACCOUNT_API_SETTING).ok().flatten().unwrap_or_default();
  owner == base && load_session_token().is_some()
}

/// The server's own message for a failed account call. Its messages are
/// written for readers ("Email or password is incorrect."), so pass them on.
async fn account_failure(response: reqwest::Response) -> anyhow::Error {
  let status = response.status();
  let body = response.text().await.unwrap_or_default();
  let message = serde_json::from_str::<serde_json::Value>(&body)
    .ok()
    .and_then(|json| json.get("error").and_then(|e| e.as_str()).map(str::to_string));
  match (status.as_u16(), message) {
    (400..=499, Some(message)) => anyhow!(message),
    (404, None) => anyhow!("That Leaflet server has no such endpoint — check the address."),
    _ => anyhow!("The Leaflet server had a problem ({status}). Try again later.")
  }
}

fn unreachable(error: reqwest::Error) -> anyhow::Error {
  if error.is_timeout() || error.is_connect() {
    anyhow!("Could not reach the Leaflet server. Check your connection.")
  } else {
    anyhow!("Could not reach the Leaflet server: {error}")
  }
}

/// Asks the server whether it is there, for Settings to say "connected" or
/// why not. Nothing is sent but the request itself, and no account is needed.
pub async fn check_reachable(db_mutex: &std::sync::Mutex<Database>) -> Result<()> {
  let base = configured_base(db_mutex)?;
  let response = reqwest::Client::builder()
    .timeout(Duration::from_secs(10))
    .build()?
    .get(format!("{base}/health"))
    .send()
    .await
    .map_err(unreachable)?;
  if !response.status().is_success() {
    return Err(anyhow!("The Leaflet server had a problem ({}). Try again later.", response.status()));
  }
  if is_health_reply(&response.text().await.unwrap_or_default()) {
    Ok(())
  } else {
    Err(anyhow!("Something answers at that address, but it is not a Leaflet server."))
  }
}

/// Whether a body is the server's own `/health` answer, `{"ok":true}`.
///
/// Any site that answers every path with a page (a sign-in wall, a parked
/// domain, a web app that serves its front page for unknown paths) returned
/// 200 here, and Settings said "Connected" to a server that was not there.
fn is_health_reply(body: &str) -> bool {
  serde_json::from_str::<serde_json::Value>(body)
    .ok()
    .and_then(|json| json.get("ok").and_then(|ok| ok.as_bool()))
    .unwrap_or(false)
}

async fn start_session(
  db_mutex: &std::sync::Mutex<Database>,
  path: &str,
  body: serde_json::Value
) -> Result<AccountStatus> {
  let base = configured_base(db_mutex)?;
  let response = client()?
    .post(format!("{base}{path}"))
    .json(&body)
    .send()
    .await
    .map_err(unreachable)?;
  if !response.status().is_success() {
    return Err(account_failure(response).await);
  }
  let session: SessionResponse = response.json().await?;
  let db = db_mutex.guard();
  store_session_token(&session.token)?;
  remember_account(&db, &base, &session.account)?;
  // A different account may have just signed in: ask the server about its
  // profile rather than go by the last one's.
  forget_visibility(&db);
  Ok(AccountStatus {
    available: true,
    api_base: Some(base),
    signed_in: true,
    account: Some(session.account),
    offline: false
  })
}

pub async fn signup(
  db_mutex: &std::sync::Mutex<Database>,
  email: &str,
  password: &str,
  display_name: Option<&str>,
  avatar: Option<&str>
) -> Result<AccountStatus> {
  let body = serde_json::json!({
    "email": email,
    "password": password,
    "displayName": display_name,
    "avatar": avatar
  });
  start_session(db_mutex, "/v1/auth/signup", body).await
}

pub async fn login(db_mutex: &std::sync::Mutex<Database>, email: &str, password: &str) -> Result<AccountStatus> {
  let body = serde_json::json!({ "email": email, "password": password });
  start_session(db_mutex, "/v1/auth/login", body).await
}

/// Asks the server to email a password-reset code. It answers the same whether
/// or not the address has an account; returns how long the code lasts.
pub async fn request_password_reset(db_mutex: &std::sync::Mutex<Database>, email: &str) -> Result<u32> {
  let base = configured_base(db_mutex)?;
  let response = client()?
    .post(format!("{base}/v1/auth/reset/request"))
    .json(&serde_json::json!({ "email": email }))
    .send()
    .await
    .map_err(unreachable)?;
  if !response.status().is_success() {
    return Err(account_failure(response).await);
  }
  let reply: serde_json::Value = response.json().await.unwrap_or_default();
  Ok(reply.get("minutes").and_then(|value| value.as_u64()).unwrap_or(15) as u32)
}

/// Sets a new password with the emailed code. The server signs every device
/// out and this one in, so the answer is a session, like a login.
pub async fn reset_password(
  db_mutex: &std::sync::Mutex<Database>,
  email: &str,
  code: &str,
  password: &str
) -> Result<AccountStatus> {
  let body = serde_json::json!({ "email": email, "code": code, "password": password });
  start_session(db_mutex, "/v1/auth/reset/confirm", body).await
}

/// Who is signed in. With `refresh`, asks the server, which is also how an
/// expired or revoked session is noticed; offline, falls back to the cache.
pub async fn status(db_mutex: &std::sync::Mutex<Database>, refresh: bool) -> Result<AccountStatus> {
  let base = {
    let db = db_mutex.guard();
    api_base(&db)
  };
  let Some(base) = base else {
    return Ok(AccountStatus::default());
  };
  let signed_out = AccountStatus {
    available: true,
    api_base: Some(base.clone()),
    ..AccountStatus::default()
  };
  let Ok((_, token)) = session_token(db_mutex) else {
    return Ok(signed_out);
  };
  let cached = {
    let db = db_mutex.guard();
    cached_account(&db)
  };
  if !refresh {
    return Ok(AccountStatus { signed_in: true, account: cached, ..signed_out });
  }

  match client()?.get(format!("{base}/v1/auth/me")).bearer_auth(&token).send().await {
    Ok(response) if response.status().is_success() => {
      let me: MeResponse = response.json().await?;
      let db = db_mutex.guard();
      remember_account(&db, &base, &me.account)?;
      Ok(AccountStatus { signed_in: true, account: Some(me.account), ..signed_out })
    }
    Ok(response) if response.status() == reqwest::StatusCode::UNAUTHORIZED => {
      let db = db_mutex.guard();
      clear_session(&db);
      Ok(signed_out)
    }
    _ => Ok(AccountStatus { signed_in: true, account: cached, offline: true, ..signed_out })
  }
}

/// Signs out here. The server is told so the session dies there too, but
/// failing to reach it never keeps a reader signed in on this device.
pub async fn logout(db_mutex: &std::sync::Mutex<Database>) -> Result<AccountStatus> {
  if let Ok((base, token)) = session_token(db_mutex) {
    let _ = client()?
      .post(format!("{base}/v1/auth/logout"))
      .bearer_auth(&token)
      .send()
      .await;
  }
  {
    let db = db_mutex.guard();
    clear_session(&db);
  }
  status(db_mutex, false).await
}

/// Sets (or, with `None`, clears) the reader's avatar, and refreshes the cached
/// account so the change shows offline too. The server checks the id.
pub async fn set_avatar(db_mutex: &std::sync::Mutex<Database>, avatar: Option<&str>) -> Result<AccountStatus> {
  let (base, token) = session_token(db_mutex)?;
  let response = client()?
    .patch(format!("{base}/v1/account"))
    .bearer_auth(&token)
    .json(&serde_json::json!({ "avatar": avatar }))
    .send()
    .await
    .map_err(unreachable)?;
  if !response.status().is_success() {
    forget_if_unauthorised(db_mutex, response.status());
    return Err(account_failure(response).await);
  }
  let me: MeResponse = response.json().await?;
  let db = db_mutex.guard();
  remember_account(&db, &base, &me.account)?;
  Ok(AccountStatus {
    available: true,
    api_base: Some(base),
    signed_in: true,
    account: Some(me.account),
    offline: false
  })
}

/// Changes the password. The server signs out every other device.
pub async fn change_password(db_mutex: &std::sync::Mutex<Database>, current: &str, next: &str) -> Result<()> {
  let (base, token) = session_token(db_mutex)?;
  let response = client()?
    .post(format!("{base}/v1/auth/password"))
    .bearer_auth(&token)
    .json(&serde_json::json!({ "current": current, "next": next }))
    .send()
    .await
    .map_err(unreachable)?;
  if !response.status().is_success() {
    forget_if_unauthorised(db_mutex, response.status());
    return Err(account_failure(response).await);
  }
  Ok(())
}

/// Deletes the account and everything the server holds for it, then forgets
/// the session here. Local books and reading history are untouched.
pub async fn delete_account(db_mutex: &std::sync::Mutex<Database>, password: &str) -> Result<AccountStatus> {
  let (base, token) = session_token(db_mutex)?;
  let response = client()?
    .delete(format!("{base}/v1/account"))
    .bearer_auth(&token)
    .json(&serde_json::json!({ "password": password }))
    .send()
    .await
    .map_err(unreachable)?;
  if !response.status().is_success() {
    forget_if_unauthorised(db_mutex, response.status());
    return Err(account_failure(response).await);
  }
  {
    let db = db_mutex.guard();
    clear_session(&db);
  }
  status(db_mutex, false).await
}

// ---- state ------------------------------------------------------------------

/// Merges this device's state with the server's.
///
/// Book files are untouched: this transport moves kilobytes, and pairs with a
/// folder or Drive for the files themselves.
pub async fn sync(db_mutex: &std::sync::Mutex<Database>, now: &str) -> Result<SyncReport> {
  let (base, token) = session_token(db_mutex)?;
  let http = client()?;

  let mut attempt = 0;
  let merged = loop {
    let response = http
      .get(format!("{base}/v1/state"))
      .bearer_auth(&token)
      .send()
      .await?;
    if !response.status().is_success() {
      forget_if_unauthorised(db_mutex, response.status());
      return Err(describe_failure(response).await);
    }
    let pulled: StateResponse = response.json().await?;
    let remote = pulled
      .state
      .as_deref()
      .map(|encoded| decompress(encoded, now))
      .unwrap_or_else(|| SyncDoc::empty(now));

    let local = {
      let db = db_mutex.guard();
      store::snapshot(&db, now)?
    };
    let merged = merge::merge(&local, &remote, now);
    let payload = compress(&merged)?;

    let push = http
      .put(format!("{base}/v1/state"))
      .bearer_auth(&token)
      .json(&StatePush {
        version: pulled.version,
        state: &payload
      })
      .send()
      .await?;

    if push.status() == reqwest::StatusCode::CONFLICT {
      // Another device wrote between the read and the write. Merge again over
      // what they wrote rather than overwriting it.
      attempt += 1;
      if attempt > MAX_CONFLICT_RETRIES {
        return Err(anyhow!("Another device is syncing right now. Try again shortly."));
      }
      continue;
    }
    if !push.status().is_success() {
      forget_if_unauthorised(db_mutex, push.status());
      return Err(describe_failure(push).await);
    }
    break merged;
  };

  let applied = {
    let db = db_mutex.guard();
    store::apply(&db, &merged)?
  };

  Ok(SyncReport {
    entries_updated: applied.updated,
    books_removed: applied.removed.len(),
    books_pending: applied.missing.len(),
    ..SyncReport::default()
  })
}

// ---- social ---------------------------------------------------------------

/// The ISO week (`2026-W39`) containing a local date (`YYYY-MM-DD`).
///
/// The leaderboard ranks by this. The client names it because a reader's
/// minutes are summed over their own local week; the server only checks that
/// it is plausible, so a reader far from UTC is on the board for the week they
/// are actually living in.
pub fn iso_week_key(local_date: &str) -> String {
  let date = chrono::NaiveDate::parse_from_str(local_date, "%Y-%m-%d")
    .unwrap_or_else(|_| chrono::Local::now().date_naive());
  let week = chrono::Datelike::iso_week(&date);
  format!("{}-W{:02}", week.year(), week.week())
}

/// What a reader publishes to be ranked and to have a profile worth visiting.
///
/// Self-reported, necessarily: the server cannot read inside the state blob,
/// which is the same property that keeps it cheap and keeps reading history out
/// of the operator's hands. The alternative is a server that can read everyone's
/// library, which is a poor trade for a leaderboard.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileUpdate {
  #[serde(skip_serializing_if = "Option::is_none")]
  pub handle: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub display_name: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub visibility: Option<String>,
  /// The local ISO week the minutes were summed over, e.g. `2026-W39`.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub week_key: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub week_minutes: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub streak: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub books_finished: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub shelf: Option<Vec<ShelfBook>>,
  /// The local date the reader last read on, e.g. `2026-09-27`: sent only on
  /// a day with reading in it, so a friend's Pip can visit "on a day you both
  /// read". A server from before visitors ignores it.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub read_day: Option<String>
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfBook {
  pub title: String,
  pub author: Option<String>,
  /// The spine's look is derived from this, so no image is ever uploaded.
  pub style_seed: String
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
  #[serde(default)]
  pub handle: Option<String>,
  #[serde(default)]
  pub display_name: Option<String>,
  #[serde(default = "private_visibility")]
  pub visibility: String,
  #[serde(default)]
  pub week_minutes: f64,
  #[serde(default)]
  pub streak: i64,
  #[serde(default)]
  pub books_finished: i64,
  #[serde(default)]
  pub shelf: Vec<ShelfBook>,
  #[serde(default)]
  pub rank: Option<i64>
}

fn private_visibility() -> String {
  "private".to_string()
}

pub async fn get_profile(db_mutex: &std::sync::Mutex<Database>) -> Result<Profile> {
  let (base, token) = session_token(db_mutex)?;
  let response = client()?
    .get(format!("{base}/v1/profile/me"))
    .bearer_auth(&token)
    .send()
    .await
    .map_err(unreachable)?;
  if !response.status().is_success() {
    forget_if_unauthorised(db_mutex, response.status());
    return Err(describe_failure(response).await);
  }
  Ok(response.json().await?)
}

pub async fn put_profile(
  db_mutex: &std::sync::Mutex<Database>,
  update: &ProfileUpdate
) -> Result<serde_json::Value> {
  let (base, token) = session_token(db_mutex)?;
  let response = client()?
    .put(format!("{base}/v1/profile/me"))
    .bearer_auth(&token)
    .json(update)
    .send()
    .await
    .map_err(unreachable)?;
  if response.status() == reqwest::StatusCode::CONFLICT {
    return Err(anyhow!("That handle is taken."));
  }
  if !response.status().is_success() {
    forget_if_unauthorised(db_mutex, response.status());
    return Err(describe_failure(response).await);
  }
  Ok(response.json().await?)
}

// ---- community ---------------------------------------------------------------
//
// Follows, kudos, weekly duels, the inbox and reader search. The server's
// answers are passed to the webview as JSON: their shapes are defined once, in
// `socialService.ts`, rather than mirrored here field by field.

/// Whether a community call must, may or must not carry the session.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CommunityAuth {
  /// Fails with "Sign in…" when there is no session.
  Required,
  /// Sent when there is one, so a public answer can say "that's you".
  Optional
}

/// The server's own message for a failed community call; its messages are
/// written for readers ("You've already sent them kudos today.").
async fn community_failure(db_mutex: &std::sync::Mutex<Database>, response: reqwest::Response) -> anyhow::Error {
  let status = response.status();
  forget_if_unauthorised(db_mutex, status);
  if status == reqwest::StatusCode::UNAUTHORIZED {
    return anyhow!("Your Leaflet sign-in has ended. Sign in again in Settings.");
  }
  account_failure(response).await
}

/// One call to a community endpoint. `path` starts with `/v1/`.
pub async fn community_call(
  db_mutex: &std::sync::Mutex<Database>,
  method: reqwest::Method,
  path: &str,
  query: &[(&str, &str)],
  body: Option<serde_json::Value>,
  auth: CommunityAuth
) -> Result<serde_json::Value> {
  let response = community_send(db_mutex, method, path, query, body, auth).await?;
  if !response.status().is_success() {
    return Err(community_failure(db_mutex, response).await);
  }
  Ok(response.json().await?)
}

/// A call to an endpoint a server may not have yet: `None` when it answers
/// "no such route" (a server deployed before the app that asks), so a newer
/// app on an older server goes without the feature instead of showing an error.
/// Only for routes that never answer 404 themselves.
pub async fn community_call_if_there(
  db_mutex: &std::sync::Mutex<Database>,
  method: reqwest::Method,
  path: &str,
  query: &[(&str, &str)],
  auth: CommunityAuth
) -> Result<Option<serde_json::Value>> {
  let response = community_send(db_mutex, method, path, query, None, auth).await?;
  if response.status() == reqwest::StatusCode::NOT_FOUND {
    return Ok(None);
  }
  if !response.status().is_success() {
    return Err(community_failure(db_mutex, response).await);
  }
  Ok(Some(response.json().await?))
}

async fn community_send(
  db_mutex: &std::sync::Mutex<Database>,
  method: reqwest::Method,
  path: &str,
  query: &[(&str, &str)],
  body: Option<serde_json::Value>,
  auth: CommunityAuth
) -> Result<reqwest::Response> {
  let (base, token) = match auth {
    CommunityAuth::Required => {
      let (base, token) = session_token(db_mutex)?;
      (base, Some(token))
    }
    CommunityAuth::Optional => match session_token(db_mutex) {
      Ok((base, token)) => (base, Some(token)),
      Err(_) => (configured_base(db_mutex)?, None)
    }
  };
  let mut request = client()?.request(method, format!("{base}{path}"));
  if !query.is_empty() {
    request = request.query(query);
  }
  if let Some(token) = token {
    request = request.bearer_auth(token);
  }
  if let Some(body) = body {
    request = request.json(&body);
  }
  request.send().await.map_err(unreachable)
}

/// A handle as a path segment: trimmed, lower-case, without a leading `@`.
pub fn handle_segment(handle: &str) -> String {
  let clean = handle.trim().trim_start_matches('@').to_lowercase();
  urlencoding::encode(&clean).into_owned()
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;

  const NOW: &str = "2026-09-04T12:00:00+00:00";

  #[test]
  fn accounts_cached_before_avatars_still_parse() {
    let old: Account = serde_json::from_str(r#"{"id":"a1","email":"ada@example.com","displayName":"Ada"}"#).unwrap();
    assert_eq!(old.avatar, None);
    let new: Account =
      serde_json::from_str(r#"{"id":"a1","email":"ada@example.com","avatar":"wizard.magic"}"#).unwrap();
    assert_eq!(new.avatar.as_deref(), Some("wizard.magic"));
    assert!(serde_json::to_string(&new).unwrap().contains(r#""avatar":"wizard.magic""#));
  }

  #[test]
  fn handles_become_safe_path_segments() {
    assert_eq!(handle_segment("  @Maya_Reads "), "maya_reads");
    assert_eq!(handle_segment("../admin"), "..%2Fadmin");
  }

  #[test]
  fn a_document_survives_a_compression_round_trip() {
    let db = memory_db();
    db.credit_minutes("2026-09-01", 25.0, 20).expect("credit");
    let doc = store::snapshot(&db, NOW).expect("snapshot");

    let encoded = compress(&doc).expect("compress");
    let back = decompress(&encoded, NOW);

    assert_eq!(back.days.len(), 1);
    assert_eq!(back.days[0].minutes, 25.0);
  }

  /// The whole reason for compressing: a free 512 MB cluster has to hold a few
  /// thousand readers, and raw JSON would not fit.
  #[test]
  fn compression_earns_its_place() {
    let db = memory_db();
    for day in 1..=28 {
      db.credit_minutes(&format!("2026-09-{day:02}"), 30.0, 20).expect("credit");
    }
    let doc = store::snapshot(&db, NOW).expect("snapshot");

    let raw = serde_json::to_vec(&doc).expect("json").len();
    let packed = base64::engine::general_purpose::STANDARD
      .decode(compress(&doc).expect("compress"))
      .expect("decode")
      .len();

    assert!(
      packed * 3 < raw,
      "expected better than 3:1, got {raw} -> {packed}"
    );
  }

  /// Anything unreadable is treated as absent, so this device republishes its
  /// own state instead of the library disappearing.
  #[test]
  fn a_corrupt_blob_is_survivable() {
    assert!(decompress("not base64 at all !!!", NOW).books.is_empty());
    assert!(decompress("aGVsbG8gd29ybGQ=", NOW).books.is_empty());
  }

  #[test]
  fn the_api_base_is_normalised_and_checked() {
    let db = memory_db();
    assert!(api_base(&db).is_none());

    set_api_base(&db, "https://leaflet.example.com/").expect("set");
    assert_eq!(api_base(&db).as_deref(), Some("https://leaflet.example.com"));

    assert!(set_api_base(&db, "leaflet.example.com").is_err());
    assert!(set_api_base(&db, "ftp://leaflet.example.com").is_err());

    // Clearing falls back to the build default, which test builds do not set.
    set_api_base(&db, "").expect("clear");
    if BUILD_API_BASE.is_none() && std::env::var("LEAFLET_API_BASE").is_err() {
      assert!(api_base(&db).is_none());
    }
  }

  /// The device's copy of "is my profile shared" is the server's word or
  /// nothing: an empty or unknown value is "not heard", never "private".
  #[test]
  fn the_remembered_visibility_is_the_servers_word_or_nothing() {
    let db = memory_db();
    assert_eq!(known_visibility(&db), None, "a fresh install has not heard");

    remember_visibility(&db, "public");
    assert_eq!(known_visibility(&db), Some(true));
    remember_visibility(&db, "private");
    assert_eq!(known_visibility(&db), Some(false));
    // Anything the server might say that is not "public" is private.
    remember_visibility(&db, "friends-only");
    assert_eq!(known_visibility(&db), Some(false));

    // Signing out or in forgets it, so the next account is asked about.
    remember_visibility(&db, "public");
    forget_visibility(&db);
    assert_eq!(known_visibility(&db), None);
  }

  #[test]
  fn iso_week_keys_follow_the_local_date() {
    let week = iso_week_key;
    // The turn of the year belongs to the year holding that week's Thursday.
    assert_eq!(week("2026-12-31"), "2026-W53");
    assert_eq!(week("2027-01-03"), "2026-W53");
    assert_eq!(week("2027-01-04"), "2027-W01");
  }

  /// The password and session token travel in these requests, so plain http
  /// is only acceptable to this machine.
  #[test]
  fn plain_http_is_only_for_localhost() {
    assert!(normalise_api_base("http://leaflet.example.com").is_err());
    assert!(normalise_api_base("http://192.168.1.5:8787").is_err());
    assert!(normalise_api_base("http://localhost.evil.com").is_err());
    assert_eq!(normalise_api_base("http://localhost:8787/").unwrap(), "http://localhost:8787");
    assert_eq!(normalise_api_base("http://127.0.0.1:8787").unwrap(), "http://127.0.0.1:8787");
    assert!(normalise_api_base("http://[::1]:8787").is_ok());
    assert!(normalise_api_base("https://user:pw@api.example.com").is_err());
    assert_eq!(normalise_api_base("  ").unwrap(), "");
  }

  /// Requests are made by putting a path on the end of the address, so the
  /// address has to be one a path can be put on the end of.
  #[test]
  fn an_address_ends_where_a_path_can_follow() {
    assert!(normalise_api_base("https://api.example.com?team=1").is_err());
    assert!(normalise_api_base("https://api.example.com/#/home").is_err());
    assert!(normalise_api_base("https://api.example.com/leaflet?x=1#y").is_err());
    // A server kept under a path is fine, with or without the last slash.
    assert_eq!(normalise_api_base("https://example.com/leaflet/").unwrap(), "https://example.com/leaflet");
    assert_eq!(normalise_api_base("https://example.com/leaflet").unwrap(), "https://example.com/leaflet");
    assert_eq!(normalise_api_base("https://api.example.com:8443//").unwrap(), "https://api.example.com:8443");
    // Not addresses at all.
    assert!(normalise_api_base("https://").is_err());
    assert!(normalise_api_base("https://exa mple.com").is_err());
    assert!(normalise_api_base("javascript:alert(1)").is_err());
  }

  #[test]
  fn only_the_servers_own_answer_counts_as_connected() {
    assert!(is_health_reply(r#"{"ok":true}"#));
    assert!(is_health_reply("{ \"ok\": true, \"version\": 2 }\n"));
    // A page served for every path, an empty body, or some other JSON.
    assert!(!is_health_reply("<!doctype html><title>Sign in to Wi-Fi</title>"));
    assert!(!is_health_reply(""));
    assert!(!is_health_reply(r#"{"ok":false}"#));
    assert!(!is_health_reply(r#"{"status":"up"}"#));
  }
}
