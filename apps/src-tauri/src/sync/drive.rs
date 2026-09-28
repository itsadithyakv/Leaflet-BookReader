//! Google Drive as the sync transport.
//!
//! The user's own Drive holds everything; there is no Leaflet server. The scope
//! is `drive.file`, which grants access only to files this app created — it is
//! a non-sensitive scope, so it needs no Google security assessment, and it
//! cannot read anything else in the user's Drive.
//!
//! Only the moving of bytes lives here. What the merged result *is* belongs to
//! [`crate::sync::merge`], which the folder transport shares.
//!
//! Layout, identical to the folder transport:
//!
//! ```text
//! Leaflet/state.json           the shared document
//! Leaflet/books/<sha256>.epub  the files, fetched on demand
//! ```

use crate::db::Database;
use crate::sync::folder::SyncReport;
use crate::sync::merge::{self, BookEntry, SyncDoc};
use crate::sync::store;
use crate::sync::{DriveState, PendingAuth};
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use oauth2::basic::BasicClient;
use oauth2::{
  AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
  RedirectUrl, TokenResponse, TokenUrl
};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::sync::oneshot;

const DRIVE_SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
/// Identity, so the account panel can name the connected Google account instead
/// of the placeholder the app used to invent. Both are non-sensitive scopes.
const IDENTITY_SCOPES: [&str; 2] = ["openid", "email"];
const DRIVE_API: &str = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3";

const STATE_FILE: &str = "state.json";
const ROOT_FOLDER: &str = "Leaflet";
const BOOKS_FOLDER: &str = "books";

/// Credentials baked in at build time.
///
/// `main` calls `dotenvy::dotenv()`, so a `.env` beside the crate does reach
/// `std::env` during development — but a packaged app is launched from wherever
/// the user's shortcut points, finds no `.env` there, and every Drive call then
/// failed at the first line. Compiling the values in is what makes a release
/// build work; the runtime lookup below is kept so `.env` still serves dev.
///
/// Google classes desktop clients as *public*: a secret cannot be kept inside a
/// binary the user holds, which is exactly why PKCE is mandatory below.
const BUILD_CLIENT_ID: Option<&str> = option_env!("LEAFLET_GOOGLE_CLIENT_ID");
const BUILD_CLIENT_SECRET: Option<&str> = option_env!("LEAFLET_GOOGLE_CLIENT_SECRET");

pub const CLIENT_ID_SETTING: &str = "drive_client_id";
pub const CLIENT_SECRET_SETTING: &str = "drive_client_secret";

/// The OAuth client Leaflet presents to Google.
#[derive(Debug, Clone)]
pub struct DriveCredentials {
  pub client_id: String,
  pub client_secret: String
}

/// Where a credential came from, so the UI can explain what the reader can change.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CredentialSource {
  /// Shipped with this build, or picked up from `.env` during development.
  BuiltIn,
  /// Entered by the reader, which is how Drive can be switched on without a
  /// rebuild.
  Custom,
  None
}

fn from_build_or_env(build: Option<&str>, key: &str) -> Option<String> {
  build
    .filter(|value| !value.is_empty())
    .map(str::to_string)
    .or_else(|| std::env::var(key).ok().filter(|value| !value.is_empty()))
}

fn stored(db: &Database, key: &str) -> Option<String> {
  db.get_setting(key).ok().flatten().filter(|value| !value.is_empty())
}

/// Resolves the OAuth client, preferring one the reader entered.
///
/// An explicit choice beats a default: someone who pasted their own client id
/// means to use it, and on a build that ships none it is the only way Drive can
/// work at all.
pub fn load_credentials(db: &Database) -> Option<DriveCredentials> {
  if let Some(client_id) = stored(db, CLIENT_ID_SETTING) {
    return Some(DriveCredentials {
      client_id,
      client_secret: stored(db, CLIENT_SECRET_SETTING).unwrap_or_default()
    });
  }
  from_build_or_env(BUILD_CLIENT_ID, "LEAFLET_GOOGLE_CLIENT_ID").map(|client_id| DriveCredentials {
    client_id,
    client_secret: from_build_or_env(BUILD_CLIENT_SECRET, "LEAFLET_GOOGLE_CLIENT_SECRET")
      .unwrap_or_default()
  })
}

pub fn credential_source(db: &Database) -> CredentialSource {
  if stored(db, CLIENT_ID_SETTING).is_some() {
    CredentialSource::Custom
  } else if from_build_or_env(BUILD_CLIENT_ID, "LEAFLET_GOOGLE_CLIENT_ID").is_some() {
    CredentialSource::BuiltIn
  } else {
    CredentialSource::None
  }
}

/// Stores an OAuth client entered by the reader.
///
/// Kept in the database rather than the keychain on purpose: this identifies the
/// *application* to Google, not the reader. Google classes desktop clients as
/// public and states their secret is not confidential — the protection that
/// matters is PKCE, which is always on. The reader's own credential, the refresh
/// token, does go to the keychain.
pub fn set_credentials(db: &Database, client_id: &str, client_secret: &str) -> Result<()> {
  db.set_setting(CLIENT_ID_SETTING, client_id.trim())?;
  db.set_setting(CLIENT_SECRET_SETTING, client_secret.trim())?;
  Ok(())
}

/// Checks a pasted client ID before it can cost the reader a trip to a consent
/// screen that would fail with an opaque `invalid_client`.
pub fn validate_client_id(value: &str) -> Result<String> {
  let trimmed = value.trim();
  if trimmed.is_empty() {
    return Err(anyhow!("Paste the client ID from your Google Cloud console."));
  }
  if !trimmed.ends_with(".apps.googleusercontent.com") {
    return Err(anyhow!(
      "That does not look like a Google client ID — it should end in .apps.googleusercontent.com"
    ));
  }
  Ok(trimmed.to_string())
}

pub fn clear_credentials(db: &Database) -> Result<()> {
  db.set_setting(CLIENT_ID_SETTING, "")?;
  db.set_setting(CLIENT_SECRET_SETTING, "")?;
  Ok(())
}

const NO_CREDENTIALS: &str = "Drive sync needs a Google OAuth client. Add one in Settings, \
or use folder sync, which needs nothing at all.";

/// How long the loopback listener waits for the browser to come back before it
/// gives the port up. Without a bound, closing the consent tab left the UI
/// waiting for a callback that would never arrive.
const AUTH_TIMEOUT: Duration = Duration::from_secs(300);
/// Chunk size for resumable uploads. Bounds memory for a large book and gives
/// the progress reporting somewhere to hook in later.
const UPLOAD_CHUNK: usize = 8 * 1024 * 1024;
const MAX_RETRIES: u32 = 4;
/// How many times a losing race for `state.json` is re-merged before giving up.
const MAX_CONFLICT_RETRIES: u32 = 3;

// ---- wire types ------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct DriveFile {
  id: String,
  #[serde(default)]
  name: String,
  #[serde(rename = "headRevisionId", default)]
  head_revision_id: Option<String>
}

#[derive(Debug, Deserialize)]
struct FilesList {
  #[serde(default)]
  files: Vec<DriveFile>,
  /// Drive pages at 100 items. Ignoring this token silently truncated every
  /// library past the first page, and the missing books were then re-uploaded.
  #[serde(rename = "nextPageToken", default)]
  next_page_token: Option<String>
}

pub struct AuthStart {
  pub url: String
}

pub struct AuthTokens {
  pub access_token: String,
  pub refresh_token: String,
  pub expires_at: String
}

// ---- OAuth -----------------------------------------------------------------

fn oauth_client(credentials: &DriveCredentials) -> Result<BasicClient> {
  Ok(BasicClient::new(
    ClientId::new(credentials.client_id.clone()),
    Some(ClientSecret::new(credentials.client_secret.clone())),
    AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())?,
    Some(TokenUrl::new("https://oauth2.googleapis.com/token".to_string())?)
  ))
}

/// What arrived on the loopback listener.
#[derive(Debug, PartialEq)]
enum Callback {
  Code(String),
  /// The consent screen was dismissed. Distinguishing this from noise is what
  /// lets the UI say "you cancelled" rather than a generic failure.
  Denied(String),
  /// Not the callback: a favicon probe, a health check, a stale request. The
  /// listener must keep waiting rather than treat this as the answer.
  Ignored
}

fn parse_callback(buffer: &[u8], expected_state: &str) -> Callback {
  let request = String::from_utf8_lossy(buffer);
  let Some(line) = request.lines().next() else {
    return Callback::Ignored;
  };
  let parts: Vec<&str> = line.split(' ').collect();
  if parts.len() < 3 {
    // Fewer than three parts means the request line is incomplete, so this is a
    // truncated read rather than a request that can be judged.
    return Callback::Ignored;
  }
  let Some(query) = parts[1].split('?').nth(1) else {
    return Callback::Ignored;
  };

  let mut code = None;
  let mut state = None;
  let mut error = None;
  for pair in query.split('&') {
    let mut iter = pair.splitn(2, '=');
    let Some(key) = iter.next() else { continue };
    let value = iter.next().unwrap_or("");
    let decoded = urlencoding::decode(value)
      .map(|value| value.to_string())
      .unwrap_or_else(|_| value.to_string());
    match key {
      "code" => code = Some(decoded),
      "state" => state = Some(decoded),
      "error" => error = Some(decoded),
      _ => {}
    }
  }

  // The state check guards both outcomes: an unsolicited error is as forgeable
  // as an unsolicited code.
  if state.as_deref() != Some(expected_state) {
    return Callback::Ignored;
  }
  if let Some(error) = error {
    return Callback::Denied(error);
  }
  match code {
    Some(code) => Callback::Code(code),
    None => Callback::Ignored
  }
}

fn respond(stream: &mut TcpStream, body: &str) {
  let response = format!(
    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
    body.len(),
    body
  );
  let _ = stream.write_all(response.as_bytes());
  let _ = stream.flush();
}

/// Reads until the end of the request head, rather than taking whatever one
/// `read` happened to return. A request split across TCP segments used to parse
/// as garbage and fail the sign-in with no explanation.
fn read_request(stream: &mut TcpStream) -> Vec<u8> {
  let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
  let mut buffer = Vec::with_capacity(2048);
  let mut chunk = [0u8; 1024];
  loop {
    match stream.read(&mut chunk) {
      Ok(0) => break,
      Ok(n) => {
        buffer.extend_from_slice(&chunk[..n]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
          break;
        }
        // A callback URL is well under this; anything larger is not our request.
        if buffer.len() > 16 * 1024 {
          break;
        }
      }
      Err(_) => break
    }
  }
  buffer
}

const SUCCESS_PAGE: &str =
  "<!doctype html><meta charset=utf-8><title>Leaflet</title>\
   <body style=\"font:16px system-ui;padding:3rem;text-align:center\">\
   <h1>Leaflet is connected</h1><p>You can close this tab and return to the app.</p>";
const FAILURE_PAGE: &str =
  "<!doctype html><meta charset=utf-8><title>Leaflet</title>\
   <body style=\"font:16px system-ui;padding:3rem;text-align:center\">\
   <h1>Connection cancelled</h1><p>Nothing was changed. You can close this tab.</p>";

/// Serves the loopback callback until the browser answers or the deadline passes.
///
/// Non-blocking accept with a deadline, rather than a thread parked forever in
/// `accept()`: the port is released when the user walks away, and repeatedly
/// pressing "Connect Drive" no longer strands a thread per attempt.
fn serve_callback(listener: TcpListener, expected_state: String, tx: oneshot::Sender<Result<String>>) {
  let _ = listener.set_nonblocking(true);
  let deadline = Instant::now() + AUTH_TIMEOUT;
  let mut outcome = Err(anyhow!("Drive connection timed out. Please try again."));

  while Instant::now() < deadline {
    match listener.accept() {
      Ok((mut stream, _)) => {
        let _ = stream.set_nonblocking(false);
        let request = read_request(&mut stream);
        match parse_callback(&request, &expected_state) {
          Callback::Code(code) => {
            respond(&mut stream, SUCCESS_PAGE);
            outcome = Ok(code);
            break;
          }
          Callback::Denied(reason) => {
            respond(&mut stream, FAILURE_PAGE);
            outcome = Err(if reason == "access_denied" {
              anyhow!("Drive connection was cancelled.")
            } else {
              anyhow!("Google refused the connection: {reason}")
            });
            break;
          }
          // The browser asks for a favicon on the callback page. Answering and
          // continuing keeps that from consuming the one real request.
          Callback::Ignored => respond(&mut stream, FAILURE_PAGE)
        }
      }
      Err(ref error) if error.kind() == std::io::ErrorKind::WouldBlock => {
        std::thread::sleep(Duration::from_millis(120));
      }
      Err(_) => break
    }
  }

  let _ = tx.send(outcome);
  // Dropping the listener here frees the port whatever the outcome was.
}

pub fn auth_start(state: &mut DriveState, credentials: &DriveCredentials) -> Result<AuthStart> {
  let client = oauth_client(credentials)?;
  let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))?;
  let port = listener.local_addr()?.port();
  let redirect = format!("http://127.0.0.1:{port}/oauth2/callback");

  let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
  let client = client.set_redirect_uri(RedirectUrl::new(redirect.clone())?);
  let mut request = client
    .authorize_url(CsrfToken::new_random)
    .add_scope(oauth2::Scope::new(DRIVE_SCOPE.to_string()))
    .set_pkce_challenge(pkce_challenge);
  for scope in IDENTITY_SCOPES {
    request = request.add_scope(oauth2::Scope::new(scope.to_string()));
  }
  // Google only returns a refresh token when consent is requested explicitly and
  // access is offline; without both, reconnecting would be needed every hour.
  let (auth_url, csrf_state) = request
    .add_extra_param("access_type", "offline")
    .add_extra_param("prompt", "consent")
    .url();

  let (tx, rx) = oneshot::channel();
  let expected_state = csrf_state.secret().to_string();
  std::thread::spawn(move || serve_callback(listener, expected_state, tx));

  // Abandoning a previous attempt drops its receiver, which ends that thread's
  // wait; the listener it holds is released with it.
  state.pending_code_rx = Some(rx);
  state.pkce_verifier = Some(pkce_verifier);
  state.redirect_uri = Some(redirect);

  Ok(AuthStart {
    url: auth_url.to_string()
  })
}

pub async fn auth_wait(pending: PendingAuth, credentials: &DriveCredentials) -> Result<AuthTokens> {
  let code = pending
    .code_rx
    .await
    .map_err(|_| anyhow!("Drive connection was cancelled."))??;

  let client = oauth_client(credentials)?;
  let token = client
    .set_redirect_uri(RedirectUrl::new(pending.redirect_uri)?)
    .exchange_code(AuthorizationCode::new(code))
    .set_pkce_verifier(pending.pkce_verifier)
    .request_async(oauth2::reqwest::async_http_client)
    .await
    .map_err(|error| anyhow!("Google rejected the sign-in: {error}"))?;

  let access_token = token.access_token().secret().to_string();
  let refresh_token = token
    .refresh_token()
    .map(|value| value.secret().to_string())
    .ok_or_else(|| {
      anyhow!("Google did not return a refresh token. Remove Leaflet from your Google account permissions and try again.")
    })?;
  let expires_at = token
    .expires_in()
    .and_then(|duration| chrono::Duration::from_std(duration).ok())
    .map(|duration| (Utc::now() + duration).to_rfc3339())
    .unwrap_or_else(|| (Utc::now() + chrono::Duration::hours(1)).to_rfc3339());

  Ok(AuthTokens {
    access_token,
    refresh_token,
    expires_at
  })
}

// ---- token storage ---------------------------------------------------------

const KEYRING_SERVICE: &str = "app.leaflet.drive";
const KEYRING_USER: &str = "refresh-token";
pub const REFRESH_SETTING: &str = "drive_refresh_token";
pub const ACCESS_SETTING: &str = "drive_access_token";
pub const EXPIRES_SETTING: &str = "drive_expires_at";
pub const ACCOUNT_SETTING: &str = "drive_account_email";

/// A refresh token is a long-lived credential to the user's Drive, so it goes to
/// the OS keychain rather than a plaintext column in the library database.
///
/// The database remains the fallback: on a machine with no usable keychain,
/// refusing to sync would be worse than the previous behaviour.
pub fn store_refresh_token(db: &Database, token: &str) -> Result<()> {
  match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).and_then(|entry| entry.set_password(token)) {
    Ok(()) => {
      // Remove any copy an earlier version left in the database.
      let _ = db.set_setting(REFRESH_SETTING, "");
      Ok(())
    }
    Err(_) => db.set_setting(REFRESH_SETTING, token)
  }
}

pub fn load_refresh_token(db: &Database) -> Result<Option<String>> {
  if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
    if let Ok(token) = entry.get_password() {
      if !token.is_empty() {
        return Ok(Some(token));
      }
    }
  }
  let stored = db.get_setting(REFRESH_SETTING)?.filter(|value| !value.is_empty());
  // Move a legacy plaintext token into the keychain the first time it is read.
  if let Some(token) = &stored {
    let _ = store_refresh_token(db, token);
  }
  Ok(stored)
}

pub fn clear_tokens(db: &Database) -> Result<()> {
  if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
    let _ = entry.delete_credential();
  }
  db.set_setting(REFRESH_SETTING, "")?;
  db.set_setting(ACCESS_SETTING, "")?;
  db.set_setting(EXPIRES_SETTING, "")?;
  Ok(())
}

struct TokenBundle {
  access_token: String,
  expires_at: String
}

async fn refresh_access_token(
  refresh_token: &str,
  credentials: &DriveCredentials
) -> Result<TokenBundle> {
  let params = [
    ("client_id", credentials.client_id.clone()),
    ("client_secret", credentials.client_secret.clone()),
    ("refresh_token", refresh_token.to_string()),
    ("grant_type", "refresh_token".to_string())
  ];

  let response = reqwest::Client::new()
    .post("https://oauth2.googleapis.com/token")
    .form(&params)
    .send()
    .await?;
  let status = response.status();
  let body = response.text().await.unwrap_or_default();
  if !status.is_success() {
    // A revoked or expired grant is the one case worth naming: the user has to
    // reconnect, and no amount of retrying will help.
    if body.contains("invalid_grant") {
      return Err(anyhow!("Drive access was revoked. Reconnect Drive to continue syncing."));
    }
    return Err(anyhow!("Could not refresh Drive access ({status})."));
  }

  let json: serde_json::Value = serde_json::from_str(&body)?;
  let access_token = json
    .get("access_token")
    .and_then(|value| value.as_str())
    .ok_or_else(|| anyhow!("Google returned no access token."))?
    .to_string();
  let expires_in = json.get("expires_in").and_then(|value| value.as_i64()).unwrap_or(3600);

  Ok(TokenBundle {
    access_token,
    expires_at: (Utc::now() + chrono::Duration::seconds(expires_in)).to_rfc3339()
  })
}

pub(crate) async fn ensure_access_token(db_mutex: &std::sync::Mutex<Database>) -> Result<String> {
  let (access_token, refresh_token, expires_at, credentials) = {
    let db = db_mutex.lock().map_err(|_| anyhow!("library is busy"))?;
    (
      db.get_setting(ACCESS_SETTING)?.filter(|value| !value.is_empty()),
      load_refresh_token(&db)?,
      db.get_setting(EXPIRES_SETTING)?.filter(|value| !value.is_empty()),
      load_credentials(&db)
    )
  };
  let credentials = credentials.ok_or_else(|| anyhow!(NO_CREDENTIALS))?;

  let refresh_token = refresh_token.ok_or_else(|| anyhow!("Drive is not connected."))?;

  if let (Some(access), Some(expiry)) = (access_token, expires_at) {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(&expiry) {
      // Refresh a couple of minutes early so a sync cannot start on a token that
      // expires halfway through it.
      if parsed.with_timezone(&Utc) > Utc::now() + chrono::Duration::minutes(2) {
        return Ok(access);
      }
    }
  }

  let bundle = refresh_access_token(&refresh_token, &credentials).await?;
  {
    let db = db_mutex.lock().map_err(|_| anyhow!("library is busy"))?;
    db.set_setting(ACCESS_SETTING, &bundle.access_token)?;
    db.set_setting(EXPIRES_SETTING, &bundle.expires_at)?;
  }
  Ok(bundle.access_token)
}

// ---- HTTP ------------------------------------------------------------------

fn transient(status: reqwest::StatusCode) -> bool {
  status.as_u16() == 429 || status.is_server_error()
}

/// Turns a failed response into a message a reader can act on.
///
/// Nothing used to check status at all, so an expired session reached the user
/// as `missing field 'files'` from the JSON decoder.
async fn describe_failure(response: reqwest::Response) -> anyhow::Error {
  let status = response.status();
  let body = response.text().await.unwrap_or_default();
  let message = serde_json::from_str::<serde_json::Value>(&body)
    .ok()
    .and_then(|json| {
      json
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
    })
    .unwrap_or_else(|| body.chars().take(200).collect());

  match status.as_u16() {
    401 => anyhow!("Drive session expired. Reconnect Drive."),
    403 if message.contains("storageQuota") || message.contains("quotaExceeded") => {
      anyhow!("Your Google Drive is full. Free some space and sync again.")
    }
    403 if message.to_lowercase().contains("rate") => {
      anyhow!("Drive is rate limiting this app. Try again shortly.")
    }
    403 => anyhow!("Drive refused the request: {message}"),
    404 => anyhow!("That file is no longer in Drive."),
    429 => anyhow!("Drive is rate limiting this app. Try again shortly."),
    _ => anyhow!("Drive error {status}: {message}")
  }
}

/// Sends a request, retrying only what is worth retrying.
///
/// Rate limits and server errors back off exponentially; a 401 or a 403 is
/// returned immediately, because repeating them cannot help.
async fn send(request: reqwest::RequestBuilder) -> Result<reqwest::Response> {
  let mut attempt: u32 = 0;
  loop {
    let attempt_request = request
      .try_clone()
      .ok_or_else(|| anyhow!("this Drive request cannot be retried"))?;
    match attempt_request.send().await {
      Ok(response) if response.status().is_success() => return Ok(response),
      Ok(response) if transient(response.status()) && attempt < MAX_RETRIES => {}
      Ok(response) => return Err(describe_failure(response).await),
      Err(error) if attempt < MAX_RETRIES && (error.is_timeout() || error.is_connect()) => {}
      Err(error) => return Err(anyhow!("Could not reach Drive: {error}"))
    }
    // 0.5s, 1s, 2s, 4s. Jittered so several devices retrying together do not
    // arrive in lockstep and re-trip the limit.
    let backoff = 500u64 << attempt;
    let jitter = (Utc::now().timestamp_subsec_millis() as u64) % 250;
    tokio::time::sleep(Duration::from_millis(backoff + jitter)).await;
    attempt += 1;
  }
}

async fn list_files(client: &reqwest::Client, token: &str, query: &str, fields: &str) -> Result<Vec<DriveFile>> {
  let mut files = Vec::new();
  let mut page_token: Option<String> = None;
  loop {
    let mut request = client
      .get(format!("{DRIVE_API}/files"))
      .bearer_auth(token)
      .query(&[
        ("q", query),
        ("fields", &format!("nextPageToken,files({fields})")),
        ("pageSize", "200"),
        ("spaces", "drive")
      ]);
    if let Some(cursor) = &page_token {
      request = request.query(&[("pageToken", cursor)]);
    }

    let page: FilesList = send(request).await?.json().await?;
    files.extend(page.files);
    match page.next_page_token {
      Some(next) => page_token = Some(next),
      None => break
    }
  }
  Ok(files)
}

/// Finds or creates a folder, converging when two devices race.
///
/// Both devices can find nothing and both create `Leaflet`; from then on they
/// would sync to different folders and silently diverge. Re-listing after the
/// create and keeping the lowest id makes every device pick the same winner.
async fn ensure_folder(client: &reqwest::Client, token: &str, name: &str, parent: &str) -> Result<String> {
  let query = format!(
    "name = '{name}' and mimeType = 'application/vnd.google-apps.folder' and '{parent}' in parents and trashed = false"
  );

  let existing = list_files(client, token, &query, "id,name").await?;
  if let Some(id) = existing.iter().map(|file| file.id.clone()).min() {
    return Ok(id);
  }

  let metadata = serde_json::json!({
    "name": name,
    "mimeType": "application/vnd.google-apps.folder",
    "parents": [parent]
  });
  let _created: DriveFile = send(
    client
      .post(format!("{DRIVE_API}/files"))
      .bearer_auth(token)
      .query(&[("fields", "id,name")])
      .json(&metadata)
  )
  .await?
  .json()
  .await?;

  let settled = list_files(client, token, &query, "id,name").await?;
  settled
    .iter()
    .map(|file| file.id.clone())
    .min()
    .ok_or_else(|| anyhow!("could not create the Leaflet folder in Drive"))
}

async fn find_file(client: &reqwest::Client, token: &str, name: &str, parent: &str) -> Result<Option<DriveFile>> {
  let query = format!("name = '{name}' and '{parent}' in parents and trashed = false");
  let files = list_files(client, token, &query, "id,name,headRevisionId").await?;
  Ok(files.into_iter().next())
}

/// Uploads a small body whole. `uploadType=media` takes the raw bytes, so there
/// is no multipart envelope to get wrong — the previous code sent
/// `multipart/form-data` where Drive requires `multipart/related`, and every
/// upload was rejected with a 400.
async fn upload_simple(
  client: &reqwest::Client,
  token: &str,
  existing: Option<&DriveFile>,
  name: &str,
  parent: &str,
  body: Vec<u8>,
  if_match: Option<&str>
) -> Result<DriveFile> {
  let response = match existing {
    Some(file) => {
      let mut request = client
        .patch(format!("{DRIVE_UPLOAD}/files/{}", file.id))
        .bearer_auth(token)
        .query(&[("uploadType", "media"), ("fields", "id,name,headRevisionId")])
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body);
      // Optimistic concurrency: if the other device wrote since we read, this
      // fails with 412 rather than silently discarding their work.
      if let Some(revision) = if_match {
        request = request.header(reqwest::header::IF_MATCH, revision);
      }
      request.send().await?
    }
    None => {
      // A create needs the name and parent, which `uploadType=media` cannot
      // carry, so the metadata goes in first and the bytes follow.
      let created: DriveFile = send(
        client
          .post(format!("{DRIVE_API}/files"))
          .bearer_auth(token)
          .query(&[("fields", "id,name,headRevisionId")])
          .json(&serde_json::json!({ "name": name, "parents": [parent] }))
      )
      .await?
      .json()
      .await?;

      client
        .patch(format!("{DRIVE_UPLOAD}/files/{}", created.id))
        .bearer_auth(token)
        .query(&[("uploadType", "media"), ("fields", "id,name,headRevisionId")])
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await?
    }
  };

  if response.status() == reqwest::StatusCode::PRECONDITION_FAILED {
    return Err(anyhow!("CONFLICT"));
  }
  if !response.status().is_success() {
    return Err(describe_failure(response).await);
  }
  Ok(response.json().await?)
}

/// Uploads a book in chunks through a resumable session.
///
/// Books run to hundreds of megabytes; a single request holds the whole file in
/// memory and restarts from zero on any hiccup. A resumable session bounds
/// memory to one chunk and survives a dropped connection.
async fn upload_book(
  client: &reqwest::Client,
  token: &str,
  parent: &str,
  path: &Path,
  name: &str
) -> Result<()> {
  let total = std::fs::metadata(path)?.len();
  let metadata = serde_json::json!({ "name": name, "parents": [parent] });

  let session = send(
    client
      .post(format!("{DRIVE_UPLOAD}/files"))
      .bearer_auth(token)
      .query(&[("uploadType", "resumable")])
      .header("X-Upload-Content-Type", "application/octet-stream")
      .header("X-Upload-Content-Length", total.to_string())
      .json(&metadata)
  )
  .await?;

  let location = session
    .headers()
    .get(reqwest::header::LOCATION)
    .and_then(|value| value.to_str().ok())
    .ok_or_else(|| anyhow!("Drive did not open an upload session"))?
    .to_string();

  if total == 0 {
    let response = client
      .put(&location)
      .bearer_auth(token)
      .header(reqwest::header::CONTENT_LENGTH, "0")
      .send()
      .await?;
    if !response.status().is_success() {
      return Err(describe_failure(response).await);
    }
    return Ok(());
  }

  let mut file = std::fs::File::open(path)?;
  let mut offset: u64 = 0;
  let mut buffer = vec![0u8; UPLOAD_CHUNK];

  while offset < total {
    let want = std::cmp::min(UPLOAD_CHUNK as u64, total - offset) as usize;
    file.read_exact(&mut buffer[..want])?;
    let end = offset + want as u64 - 1;

    let response = client
      .put(&location)
      .bearer_auth(token)
      .header(reqwest::header::CONTENT_LENGTH, want.to_string())
      .header(
        reqwest::header::CONTENT_RANGE,
        format!("bytes {offset}-{end}/{total}")
      )
      .body(buffer[..want].to_vec())
      .send()
      .await?;

    let status = response.status();
    // 308 is Drive asking for the next chunk; it is not an error and not a
    // success, so `is_success()` alone would reject a working upload.
    if status.as_u16() == 308 {
      offset += want as u64;
      continue;
    }
    if status.is_success() {
      return Ok(());
    }
    return Err(describe_failure(response).await);
  }

  Ok(())
}

async fn download(client: &reqwest::Client, token: &str, file_id: &str) -> Result<Vec<u8>> {
  let response = send(
    client
      .get(format!("{DRIVE_API}/files/{file_id}"))
      .bearer_auth(token)
      .query(&[("alt", "media")])
  )
  .await?;
  Ok(response.bytes().await?.to_vec())
}

// ---- sync ------------------------------------------------------------------

/// The connected Google account, so the UI can name it.
pub async fn fetch_account_email(client: &reqwest::Client, token: &str) -> Result<Option<String>> {
  let response = send(
    client
      .get(format!("{DRIVE_API}/about"))
      .bearer_auth(token)
      .query(&[("fields", "user(emailAddress)")])
  )
  .await?;
  let json: serde_json::Value = response.json().await?;
  Ok(
    json
      .get("user")
      .and_then(|user| user.get("emailAddress"))
      .and_then(|value| value.as_str())
      .map(str::to_string)
  )
}

async fn read_remote_state(
  client: &reqwest::Client,
  token: &str,
  root: &str,
  now: &str
) -> Result<(SyncDoc, Option<DriveFile>)> {
  let file = find_file(client, token, STATE_FILE, root).await?;
  let Some(file) = file else {
    return Ok((SyncDoc::empty(now), None));
  };
  let bytes = download(client, token, &file.id).await?;
  // A corrupt document must not take the library down. Treating it as empty
  // means this device republishes its own state, which is recoverable.
  let doc = serde_json::from_slice::<SyncDoc>(&bytes).unwrap_or_else(|_| SyncDoc::empty(now));
  Ok((doc, Some(file)))
}

/// Merges with Drive and applies the result locally.
///
/// Book files are *not* pulled here. The document is a few kilobytes and syncs
/// in one round trip; the files are fetched when a book is opened, so connecting
/// a new device is instant instead of a multi-gigabyte download.
pub async fn sync(db_mutex: &std::sync::Mutex<Database>, now: &str) -> Result<SyncReport> {
  let token = ensure_access_token(db_mutex).await?;
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(120))
    .build()?;

  let root = ensure_folder(&client, &token, ROOT_FOLDER, "root").await?;
  let books_folder = ensure_folder(&client, &token, BOOKS_FOLDER, &root).await?;

  if let Ok(Some(email)) = fetch_account_email(&client, &token).await {
    if let Ok(db) = db_mutex.lock() {
      let _ = db.set_setting(ACCOUNT_SETTING, &email);
    }
  }

  let mut attempt = 0;
  let merged = loop {
    let (remote, remote_file) = read_remote_state(&client, &token, &root, now).await?;
    let local = {
      let db = db_mutex.lock().map_err(|_| anyhow!("library is busy"))?;
      store::snapshot(&db, now)?
    };
    let merged = merge::merge(&local, &remote, now);
    let body = serde_json::to_vec_pretty(&merged)?;

    match upload_simple(
      &client,
      &token,
      remote_file.as_ref(),
      STATE_FILE,
      &root,
      body,
      remote_file.as_ref().and_then(|file| file.head_revision_id.as_deref())
    )
    .await
    {
      Ok(_) => break merged,
      Err(error) if error.to_string() == "CONFLICT" && attempt < MAX_CONFLICT_RETRIES => {
        // Another device wrote between our read and our write. Re-read and
        // re-merge rather than overwriting their work.
        attempt += 1;
        continue;
      }
      Err(error) if error.to_string() == "CONFLICT" => {
        return Err(anyhow!("Another device is syncing right now. Try again shortly."))
      }
      Err(error) => return Err(error)
    }
  };

  let applied = {
    let db = db_mutex.lock().map_err(|_| anyhow!("library is busy"))?;
    store::apply(&db, &merged)?
  };

  let mut report = SyncReport {
    entries_updated: applied.updated,
    books_removed: applied.removed.len(),
    books_pending: applied.missing.len(),
    ..SyncReport::default()
  };

  let remote_files: std::collections::HashMap<String, String> =
    list_files(&client, &token, &format!("'{books_folder}' in parents and trashed = false"), "id,name")
      .await?
      .into_iter()
      .map(|file| (file.name, file.id))
      .collect();

  // A book deleted on any device should stop occupying the user's Drive quota.
  for entry in merged.books.iter().filter(|entry| entry.is_deleted()) {
    if let Some(file_id) = remote_files.get(&entry.remote_name()) {
      let _ = send(
        client
          .delete(format!("{DRIVE_API}/files/{file_id}"))
          .bearer_auth(&token)
      )
      .await;
    }
  }

  // Publish anything this device holds that Drive does not. Downloads stay on
  // demand, so connecting a new device does not pull a whole library.
  for entry in merged.live_books() {
    let name = entry.remote_name();
    if remote_files.contains_key(&name) {
      continue;
    }
    let path = store::local_path_for(entry)?;
    if !path.exists() {
      continue;
    }
    upload_book(&client, &token, &books_folder, &path, &name).await?;
    report.books_uploaded += 1;
  }

  Ok(report)
}

/// Fetches one book's bytes, for a device that has the entry but not the file.
pub async fn fetch_book(db_mutex: &std::sync::Mutex<Database>, book_id: &str) -> Result<String> {
  let token = ensure_access_token(db_mutex).await?;
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(600))
    .build()?;

  let record = {
    let db = db_mutex.lock().map_err(|_| anyhow!("library is busy"))?;
    db.find_by_id(book_id)?.ok_or_else(|| anyhow!("unknown book"))?
  };
  let entry = BookEntry::from_record(&record);

  let root = ensure_folder(&client, &token, ROOT_FOLDER, "root").await?;
  let books_folder = ensure_folder(&client, &token, BOOKS_FOLDER, &root).await?;
  let file = find_file(&client, &token, &entry.remote_name(), &books_folder)
    .await?
    .ok_or_else(|| anyhow!("That book has not been uploaded from your other device yet."))?;

  let bytes = download(&client, &token, &file.id).await?;
  let destination = store::local_path_for(&entry)?;
  if let Some(parent) = destination.parent() {
    std::fs::create_dir_all(parent)?;
  }
  // Stage then rename, so an interrupted download cannot leave a truncated book
  // that later looks present.
  let staging = destination.with_extension("part");
  std::fs::write(&staging, &bytes)?;
  std::fs::rename(&staging, &destination)?;

  Ok(destination.to_string_lossy().to_string())
}

/// Whether Leaflet can talk to Google at all. The UI uses it to offer folder
/// sync instead of a Drive button that could only ever fail.
pub fn credentials_present(db: &Database) -> bool {
  load_credentials(db).is_some()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_a_well_formed_callback() {
    let request = b"GET /oauth2/callback?code=4%2F0AX4&state=abc123 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
    assert_eq!(parse_callback(request, "abc123"), Callback::Code("4/0AX4".to_string()));
  }

  #[test]
  fn rejects_a_mismatched_csrf_state() {
    let request = b"GET /oauth2/callback?code=4%2F0AX4&state=attacker HTTP/1.1\r\n\r\n";
    assert_eq!(parse_callback(request, "abc123"), Callback::Ignored);
  }

  /// A forged error is as unwelcome as a forged code, so the state is checked
  /// before the outcome is believed.
  #[test]
  fn rejects_an_unsolicited_error() {
    let request = b"GET /oauth2/callback?error=access_denied&state=attacker HTTP/1.1\r\n\r\n";
    assert_eq!(parse_callback(request, "abc123"), Callback::Ignored);
  }

  /// Cancelling consent is now distinguishable from noise, so the UI can say
  /// what happened instead of reporting a generic failure.
  #[test]
  fn reports_a_cancelled_consent_screen() {
    let request = b"GET /oauth2/callback?error=access_denied&state=abc123 HTTP/1.1\r\n\r\n";
    assert_eq!(
      parse_callback(request, "abc123"),
      Callback::Denied("access_denied".to_string())
    );
  }

  /// The favicon the browser requests on the callback page must not be mistaken
  /// for the callback, or it consumes the one chance to read the code.
  #[test]
  fn ignores_a_favicon_probe() {
    let request = b"GET /favicon.ico HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
    assert_eq!(parse_callback(request, "abc123"), Callback::Ignored);
  }

  /// A request line cut short by a segment boundary is ignored rather than
  /// parsed as a state mismatch; `read_request` keeps reading until the head is
  /// complete, so this input never reaches the parser in practice.
  #[test]
  fn ignores_a_truncated_request_line() {
    let request = b"GET /oauth2/callback?code=4%2F0AX4&sta";
    assert_eq!(parse_callback(request, "abc123"), Callback::Ignored);
  }

  /// An authorisation code containing an `=` must survive parsing; splitting the
  /// query on every `=` rather than the first would truncate it.
  #[test]
  fn keeps_padding_inside_a_parameter_value() {
    let request = b"GET /oauth2/callback?state=abc123&code=aa%3Dbb=cc HTTP/1.1\r\n\r\n";
    assert_eq!(
      parse_callback(request, "abc123"),
      Callback::Code("aa=bb=cc".to_string())
    );
  }

  /// Drive answers `files.list` with a page token. It is now part of the type,
  /// so pagination is possible at all.
  #[test]
  fn files_list_carries_the_page_token() {
    let page = br##"{"files":[{"id":"1","name":"a"}],"nextPageToken":"~!!~AI9F"}"##;
    let parsed: FilesList = serde_json::from_slice(page).unwrap();
    assert_eq!(parsed.files.len(), 1);
    assert_eq!(parsed.next_page_token.as_deref(), Some("~!!~AI9F"));
  }

  /// An error body no longer has to deserialise as a file listing; the status is
  /// checked first, and `files` defaults rather than failing the decode.
  #[test]
  fn an_error_body_no_longer_breaks_the_decoder() {
    let error = br##"{"error":{"code":403,"message":"Rate Limit Exceeded"}}"##;
    let parsed: FilesList = serde_json::from_slice(error).unwrap();
    assert!(parsed.files.is_empty());
  }

  // ---- credentials -------------------------------------------------------

  /// A build that ships no credentials is no longer a dead end: the reader can
  /// supply an OAuth client and Drive works without a rebuild.
  #[test]
  fn stored_credentials_make_drive_available() {
    let db = crate::db::tests::memory_db();
    assert_eq!(credential_source(&db), CredentialSource::None);

    set_credentials(&db, "abc.apps.googleusercontent.com", "shh").expect("store");

    assert_eq!(credential_source(&db), CredentialSource::Custom);
    let loaded = load_credentials(&db).expect("credentials");
    assert_eq!(loaded.client_id, "abc.apps.googleusercontent.com");
    assert_eq!(loaded.client_secret, "shh");
    assert!(credentials_present(&db));
  }

  /// Clearing them puts the build back where it started rather than leaving a
  /// half-configured client behind.
  #[test]
  fn clearing_credentials_restores_the_default() {
    let db = crate::db::tests::memory_db();
    set_credentials(&db, "abc.apps.googleusercontent.com", "shh").expect("store");
    clear_credentials(&db).expect("clear");

    assert_eq!(credential_source(&db), CredentialSource::None);
    assert!(load_credentials(&db).is_none());
  }

  /// A client with no secret is still usable. Google treats desktop clients as
  /// public, and PKCE — not the secret — is what protects the exchange.
  #[test]
  fn a_client_without_a_secret_is_still_usable() {
    let db = crate::db::tests::memory_db();
    set_credentials(&db, "abc.apps.googleusercontent.com", "").expect("store");

    let loaded = load_credentials(&db).expect("credentials");
    assert_eq!(loaded.client_secret, "");
    assert!(oauth_client(&loaded).is_ok());
  }

  #[test]
  fn a_client_id_must_look_like_googles() {
    assert!(validate_client_id("").is_err());
    assert!(validate_client_id("   ").is_err());
    // The mistake worth catching: pasting the project name, or the secret.
    assert!(validate_client_id("my-leaflet-project").is_err());
    assert!(validate_client_id("GOCSPX-abc123").is_err());

    let ok = validate_client_id("  123-abc.apps.googleusercontent.com 
").expect("valid");
    assert_eq!(ok, "123-abc.apps.googleusercontent.com");
  }

  /// Whitespace pasted from a console page must not become part of the id.
  #[test]
  fn pasted_credentials_are_trimmed() {
    let db = crate::db::tests::memory_db();
    set_credentials(&db, "  abc.apps.googleusercontent.com
", " shh ").expect("store");

    let loaded = load_credentials(&db).expect("credentials");
    assert_eq!(loaded.client_id, "abc.apps.googleusercontent.com");
    assert_eq!(loaded.client_secret, "shh");
  }
}
