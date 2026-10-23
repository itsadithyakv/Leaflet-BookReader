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
//!
//! `state.json` carries whose library it is twice: in the document
//! (`SyncDoc::owner`) and in its `appProperties` (`leafletOwner`), which
//! Drive keeps when an older Leaflet rewrites the document without it. A
//! sync is two halves run apart (`commands::backup::run_sync`): the state
//! (`sync_state`, through `shared_doc`, gated by owner) and the files
//! (`sync_files`, over this library as it is here).

use crate::db::Database;
use crate::sync::folder::SyncReport;
use crate::sync::large;
use crate::sync::merge::{self, BookEntry, Remote};
use crate::sync::shared_doc;
use crate::sync::store;
use crate::sync::PendingAuth;
use crate::sync::DriveState;
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use oauth2::basic::BasicClient;
use oauth2::{AuthUrl, ClientId, ClientSecret, RedirectUrl, TokenUrl};
use oauth2::{CsrfToken, PkceCodeChallenge};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::io::Write;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::time::Duration;
use std::time::Instant;
use tokio::sync::oneshot;
use crate::LockExt;

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

/// Why Google will not let Leaflet reach Drive, when no retry can help.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DriveUnavailable {
  /// Google has disabled (or no longer knows) Leaflet's OAuth client:
  /// `disabled_client`, `invalid_client`, `unauthorized_client`. Nothing the
  /// reader does fixes it; it lasts until the client is restored.
  ClientDisabled,
  /// The reader's grant is revoked or expired (`invalid_grant`): connecting
  /// Drive again fixes it.
  Reconnect
}

impl DriveUnavailable {
  pub fn message(self) -> &'static str {
    match self {
      DriveUnavailable::ClientDisabled => "Google Drive is unavailable right now.",
      DriveUnavailable::Reconnect => "Drive access was revoked. Reconnect Google Drive to keep syncing."
    }
  }

  fn key(self) -> &'static str {
    match self {
      DriveUnavailable::ClientDisabled => "client_disabled",
      DriveUnavailable::Reconnect => "reconnect"
    }
  }

  fn from_key(key: &str) -> Option<Self> {
    match key {
      "client_disabled" => Some(DriveUnavailable::ClientDisabled),
      "reconnect" => Some(DriveUnavailable::Reconnect),
      _ => None
    }
  }
}

/// A Drive failure that is Google refusing the client or the grant
/// (`unavailable` finds it in an `anyhow::Error`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DriveAuthError(pub DriveUnavailable);

impl std::fmt::Display for DriveAuthError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str(self.0.message())
  }
}

impl std::error::Error for DriveAuthError {}

/// What a failure from Drive says about the client or the grant, if anything.
pub fn unavailable(error: &anyhow::Error) -> Option<DriveUnavailable> {
  error.downcast_ref::<DriveAuthError>().map(|error| error.0)
}

/// The OAuth error codes that mean the client or the grant is unusable.
fn refusal_of(code: &str) -> Option<DriveUnavailable> {
  match code {
    "disabled_client" | "invalid_client" | "unauthorized_client" => Some(DriveUnavailable::ClientDisabled),
    "invalid_grant" => Some(DriveUnavailable::Reconnect),
    _ => None
  }
}

/// Google's OAuth error that means the client or the grant is unusable, from
/// a token endpoint's answer (`{"error":"disabled_client",...}`) or the
/// `error` parameter of a refused consent.
pub(crate) fn oauth_refusal(body: &str) -> Option<DriveUnavailable> {
  let code = serde_json::from_str::<serde_json::Value>(body)
    .ok()
    .and_then(|json| json.get("error").and_then(|value| value.as_str()).map(str::to_string))
    .unwrap_or_else(|| body.trim().to_string());
  refusal_of(&code).or_else(|| {
    // Not Google's JSON (a proxy's page, a changed format): the code by name.
    ["disabled_client", "invalid_client", "unauthorized_client", "invalid_grant"]
      .into_iter()
      .find(|code| body.contains(code))
      .and_then(refusal_of)
  })
}

/// Drive was found unavailable (`note_unavailable`), and why.
pub const UNAVAILABLE_SETTING: &str = "drive_unavailable";
/// Until when automatic syncs leave Drive alone after Google disabled the client.
pub const PAUSED_UNTIL_SETTING: &str = "drive_paused_until";
/// How long automatic syncs leave a disabled client alone. A sync the reader
/// asks for still tries.
pub const CLIENT_DISABLED_PAUSE_HOURS: i64 = 6;

/// Records why Drive is unavailable; a disabled client is left alone by
/// automatic syncs for `CLIENT_DISABLED_PAUSE_HOURS`.
pub fn note_unavailable(db: &Database, kind: DriveUnavailable, now: DateTime<Utc>) -> Result<()> {
  db.set_setting(UNAVAILABLE_SETTING, kind.key())?;
  let until = match kind {
    DriveUnavailable::ClientDisabled => (now + chrono::Duration::hours(CLIENT_DISABLED_PAUSE_HOURS)).to_rfc3339(),
    DriveUnavailable::Reconnect => String::new()
  };
  db.set_setting(PAUSED_UNTIL_SETTING, &until)?;
  Ok(())
}

/// Drive answered again, or was connected, disconnected or changed.
pub fn clear_unavailable(db: &Database) -> Result<()> {
  db.set_setting(UNAVAILABLE_SETTING, "")?;
  db.set_setting(PAUSED_UNTIL_SETTING, "")?;
  Ok(())
}

/// Why Drive was last found unavailable, if it was.
pub fn unavailable_noted(db: &Database) -> Option<DriveUnavailable> {
  db.get_setting(UNAVAILABLE_SETTING).ok().flatten().as_deref().and_then(DriveUnavailable::from_key)
}

/// An automatic sync leaves Drive alone: Google disabled the client less than
/// `CLIENT_DISABLED_PAUSE_HOURS` ago. Not when the grant is another client's:
/// a pause noted before the update to a new client would only hold back the
/// reconnect it needs.
pub fn paused(db: &Database, now: DateTime<Utc>) -> bool {
  unavailable_noted(db) == Some(DriveUnavailable::ClientDisabled)
    && !grant_from_another_client(db)
    && db
      .get_setting(PAUSED_UNTIL_SETTING)
      .ok()
      .flatten()
      .and_then(|until| DateTime::parse_from_rfc3339(&until).ok())
      .is_some_and(|until| until.with_timezone(&Utc) > now)
}

/// A Drive call answered 401: the access token is no longer honoured. `open`
/// refreshes once on it, which is where Google says why.
#[derive(Debug)]
struct SessionExpired;

impl std::fmt::Display for SessionExpired {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str("Drive session expired. Reconnect Drive.")
  }
}

impl std::error::Error for SessionExpired {}

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

// ---- wire types ------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct DriveFile {
  id: String,
  #[serde(default)]
  name: String,
  #[serde(rename = "headRevisionId", default)]
  head_revision_id: Option<String>,
  /// Private to this app: `leafletOwner` on `state.json` says whose library
  /// it is (`OWNER_PROPERTY`).
  #[serde(rename = "appProperties", default)]
  app_properties: Option<std::collections::HashMap<String, String>>
}

/// The `appProperties` key that marks whose library `state.json` is.
const OWNER_PROPERTY: &str = "leafletOwner";

impl DriveFile {
  /// The owner marked on the file, when it is a tag.
  fn owner_mark(&self) -> Option<String> {
    let props = self.app_properties.as_ref()?;
    crate::sync::owner::clean(props.get(OWNER_PROPERTY).map(String::as_str))
  }
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

#[cfg(not(target_os = "android"))]
const SUCCESS_PAGE: &str =
  "<!doctype html><meta charset=utf-8><title>Leaflet</title>\
   <body style=\"font:16px system-ui;padding:3rem;text-align:center\">\
   <h1>Leaflet is connected</h1><p>You can close this tab and return to the app.</p>";
#[cfg(not(target_os = "android"))]
const FAILURE_PAGE: &str =
  "<!doctype html><meta charset=utf-8><title>Leaflet</title>\
   <body style=\"font:16px system-ui;padding:3rem;text-align:center\">\
   <h1>Connection cancelled</h1><p>Nothing was changed. You can close this tab.</p>";

/// On a phone the browser is in front when Google answers, and Leaflet is
/// behind it. Android does not let an app in the background bring itself
/// forward, so the page Leaflet serves does it: a link (followed at once, and
/// a button in case the browser wants a tap) that opens Leaflet by its own
/// scheme (the BROWSABLE filter in AndroidManifest.xml).
#[cfg(target_os = "android")]
const SUCCESS_PAGE: &str =
  "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\">\
   <title>Leaflet</title><body style=\"font:17px system-ui;padding:3rem 1.5rem;text-align:center\">\
   <h1>Leaflet is connected</h1>\
   <p><a id=back href=\"intent://drive-connected#Intent;scheme=com.leaflet.app;package=com.leaflet.app;end\" \
   style=\"display:inline-block;padding:14px 28px;border-radius:999px;background:#2f6b4f;color:#fff;text-decoration:none\">\
   Back to Leaflet</a></p>\
   <script>setTimeout(function(){location.href=document.getElementById('back').href},250)</script>";
#[cfg(target_os = "android")]
const FAILURE_PAGE: &str =
  "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\">\
   <title>Leaflet</title><body style=\"font:17px system-ui;padding:3rem 1.5rem;text-align:center\">\
   <h1>Connection cancelled</h1><p>Nothing was changed.</p>\
   <p><a href=\"intent://drive-connected#Intent;scheme=com.leaflet.app;package=com.leaflet.app;end\">Back to Leaflet</a></p>";

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
            } else if oauth_refusal(&reason) == Some(DriveUnavailable::ClientDisabled) {
              DriveAuthError(DriveUnavailable::ClientDisabled).into()
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

  exchange_code(&code, &pending.redirect_uri, pending.pkce_verifier.secret(), credentials).await
}

/// Trades the code from the browser for tokens, through the same HTTP client
/// as everything else in Leaflet (`refresh_access_token` too).
///
/// It used to go through `oauth2`'s own client, an older `reqwest` with its
/// own TLS stack, which on Android never reached Google at all: every phone
/// sign-in got as far as "Leaflet is connected" and then failed here.
async fn exchange_code(
  code: &str,
  redirect_uri: &str,
  pkce_verifier: &str,
  credentials: &DriveCredentials
) -> Result<AuthTokens> {
  let params = [
    ("client_id", credentials.client_id.as_str()),
    ("client_secret", credentials.client_secret.as_str()),
    ("code", code),
    ("code_verifier", pkce_verifier),
    ("redirect_uri", redirect_uri),
    ("grant_type", "authorization_code")
  ];
  let response = reqwest::Client::builder()
    .timeout(Duration::from_secs(30))
    .build()?
    .post("https://oauth2.googleapis.com/token")
    .form(&params)
    .send()
    .await
    .map_err(|error| anyhow!("Could not reach Google to finish connecting Drive ({error}). Check the connection and try again."))?;
  let status = response.status();
  let body = response.text().await.unwrap_or_default();
  if !status.is_success() {
    // A disabled client is said as such; a code that expired or was used
    // already (`invalid_grant`, here) is the sign-in's own, said below.
    if oauth_refusal(&body) == Some(DriveUnavailable::ClientDisabled) {
      return Err(DriveAuthError(DriveUnavailable::ClientDisabled).into());
    }
    return Err(anyhow!("Google rejected the sign-in: {}", google_error(&body).unwrap_or_else(|| status.to_string())));
  }
  tokens_from(&body)
}

/// Google's own words for a refused request: `error_description`, else `error`.
/// A code that expired or was used already (a page reloaded) says only "Bad
/// Request", so that one is put in words that say what to do.
fn google_error(body: &str) -> Option<String> {
  let json: serde_json::Value = serde_json::from_str(body).ok()?;
  if json.get("error").and_then(|value| value.as_str()) == Some("invalid_grant") {
    return Some("that sign-in expired or was used already. Connect Drive again.".to_string());
  }
  json
    .get("error_description")
    .or_else(|| json.get("error"))
    .and_then(|value| value.as_str())
    .map(str::to_string)
}

fn tokens_from(body: &str) -> Result<AuthTokens> {
  let json: serde_json::Value = serde_json::from_str(body)?;
  let text = |key: &str| json.get(key).and_then(|value| value.as_str()).filter(|value| !value.is_empty());
  let access_token = text("access_token")
    .ok_or_else(|| anyhow!("Google returned no access token."))?
    .to_string();
  // Google only sends one with access_type=offline and prompt=consent, both
  // asked for in `auth_start`; without it Drive would need reconnecting hourly.
  let refresh_token = text("refresh_token")
    .ok_or_else(|| {
      anyhow!("Google did not return a refresh token. Remove Leaflet from your Google account permissions and try again.")
    })?
    .to_string();
  let expires_in = json.get("expires_in").and_then(|value| value.as_i64()).unwrap_or(3600);
  Ok(AuthTokens {
    access_token,
    refresh_token,
    expires_at: (Utc::now() + chrono::Duration::seconds(expires_in)).to_rfc3339()
  })
}

// ---- token storage ---------------------------------------------------------

#[cfg(not(target_os = "android"))]
const KEYRING_SERVICE: &str = "app.leaflet.drive";
#[cfg(not(target_os = "android"))]
const KEYRING_USER: &str = "refresh-token";
pub const REFRESH_SETTING: &str = "drive_refresh_token";
pub const ACCESS_SETTING: &str = "drive_access_token";
pub const EXPIRES_SETTING: &str = "drive_expires_at";
pub const ACCOUNT_SETTING: &str = "drive_account_email";
/// Which OAuth client this library's grant was made with (kept since 1.5.12).
pub const GRANT_CLIENT_SETTING: &str = "drive_grant_client";

/// Notes the client a new grant was made with (`drive_auth_wait`).
pub fn note_grant_client(db: &Database, client_id: &str) -> Result<()> {
  db.set_setting(GRANT_CLIENT_SETTING, client_id)
}

/// Whether this library's grant was made with a client other than the one
/// presented now.
///
/// Every grant before 1.5.12 was made with the Drive client Google disabled
/// on 2026-10-22, and 1.5.12 ships another. Google answers a grant from
/// another client `unauthorized_client`, which reads as the client being
/// disabled, but connecting again fixes it. A grant with no note is from
/// before the note was kept, and so counts as another client's until the
/// client presented now is seen to honour it.
fn grant_from_another_client(db: &Database) -> bool {
  match load_credentials(db) {
    Some(credentials) => stored(db, GRANT_CLIENT_SETTING).as_deref() != Some(credentials.client_id.as_str()),
    None => false
  }
}

/// What Google refusing this library's grant means for the reader: a client
/// "disabled" for a grant another client made is a grant to make again.
fn refusal_for_grant(kind: DriveUnavailable, another_client: bool) -> DriveUnavailable {
  match kind {
    DriveUnavailable::ClientDisabled if another_client => DriveUnavailable::Reconnect,
    kind => kind
  }
}

/// A refresh token is a long-lived credential to the user's Drive, so it goes to
/// the OS keychain rather than a plaintext column in the library database.
///
/// The database remains the fallback: on a machine with no usable keychain,
/// refusing to sync would be worse than the previous behaviour.
///
/// Each library on the device keeps its own (per-account libraries): the
/// first under the name it always had, another account's under its tag
/// (`slot_name`), so connecting Drive in one never signs another in or out.
pub fn store_refresh_token(db: &Database, token: &str) -> Result<()> {
  match keep_refresh_token(slot(db).as_deref(), token) {
    Ok(()) => {
      // Remove any copy an earlier version left in the database.
      let _ = db.set_setting(REFRESH_SETTING, "");
      Ok(())
    }
    Err(_) => db.set_setting(REFRESH_SETTING, token)
  }
}

pub fn load_refresh_token(db: &Database) -> Result<Option<String>> {
  if let Some(token) = kept_refresh_token(slot(db).as_deref()) {
    return Ok(Some(token));
  }
  let stored = db.get_setting(REFRESH_SETTING)?.filter(|value| !value.is_empty());
  // Move a legacy plaintext token into the keychain the first time it is read.
  if let Some(token) = &stored {
    let _ = store_refresh_token(db, token);
  }
  Ok(stored)
}

/// Which library `db` is, for its token: `None` for the first one.
fn slot(db: &Database) -> Option<String> {
  crate::libraries::slot_of(db.path())
}

/// The name a library's token is kept under: `base` for the first library,
/// `base-<tag>` for another account's.
pub(crate) fn slot_name(base: &str, slot: Option<&str>) -> String {
  match slot {
    Some(tag) => format!("{base}-{tag}"),
    None => base.to_string()
  }
}

/// The keychain on a computer; Leaflet's private storage on a phone, where
/// `keyring` keeps nothing at all (`device_secret`).
#[cfg(not(target_os = "android"))]
fn keep_refresh_token(slot: Option<&str>, token: &str) -> std::result::Result<(), String> {
  keyring::Entry::new(KEYRING_SERVICE, &slot_name(KEYRING_USER, slot))
    .and_then(|entry| entry.set_password(token))
    .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
fn keep_refresh_token(slot: Option<&str>, token: &str) -> std::result::Result<(), String> {
  crate::sync::device_secret::store(&slot_name(crate::sync::device_secret::DRIVE_REFRESH, slot), token).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
fn kept_refresh_token(slot: Option<&str>) -> Option<String> {
  keyring::Entry::new(KEYRING_SERVICE, &slot_name(KEYRING_USER, slot))
    .and_then(|entry| entry.get_password())
    .ok()
    .filter(|token| !token.is_empty())
}

#[cfg(target_os = "android")]
fn kept_refresh_token(slot: Option<&str>) -> Option<String> {
  crate::sync::device_secret::load(&slot_name(crate::sync::device_secret::DRIVE_REFRESH, slot))
}

#[cfg(not(target_os = "android"))]
fn forget_refresh_token(slot: Option<&str>) {
  if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &slot_name(KEYRING_USER, slot)) {
    let _ = entry.delete_credential();
  }
}

#[cfg(target_os = "android")]
fn forget_refresh_token(slot: Option<&str>) {
  crate::sync::device_secret::clear(&slot_name(crate::sync::device_secret::DRIVE_REFRESH, slot));
}

/// Disconnects Drive from this library (`db`'s) only.
pub fn clear_tokens(db: &Database) -> Result<()> {
  forget_refresh_token(slot(db).as_deref());
  db.set_setting(REFRESH_SETTING, "")?;
  db.set_setting(ACCESS_SETTING, "")?;
  db.set_setting(EXPIRES_SETTING, "")?;
  db.set_setting(GRANT_CLIENT_SETTING, "")?;
  clear_unavailable(db)?;
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
    // A disabled client and a revoked or expired grant are the cases worth
    // naming: no amount of retrying helps either (`DriveUnavailable`).
    if let Some(kind) = oauth_refusal(&body) {
      return Err(DriveAuthError(kind).into());
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
    let db = db_mutex.guard();
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

  let bundle = match refresh_access_token(&refresh_token, &credentials).await {
    Ok(bundle) => bundle,
    Err(error) => {
      let another_client = grant_from_another_client(&db_mutex.guard());
      return Err(match unavailable(&error) {
        Some(kind) => DriveAuthError(refusal_for_grant(kind, another_client)).into(),
        None => error
      });
    }
  };
  {
    let db = db_mutex.guard();
    db.set_setting(ACCESS_SETTING, &bundle.access_token)?;
    db.set_setting(EXPIRES_SETTING, &bundle.expires_at)?;
    // A grant from before the note was kept, honoured by this client.
    if grant_from_another_client(&db) {
      note_grant_client(&db, &credentials.client_id)?;
    }
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
    401 => SessionExpired.into(),
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

/// The file of that name; of several (two devices made `state.json` at the
/// same moment), the one with the lowest id, so every device picks the same.
async fn find_file(client: &reqwest::Client, token: &str, name: &str, parent: &str) -> Result<Option<DriveFile>> {
  let files = find_files(client, token, name, parent).await?;
  Ok(files.into_iter().min_by(|a, b| a.id.cmp(&b.id)))
}

async fn find_files(client: &reqwest::Client, token: &str, name: &str, parent: &str) -> Result<Vec<DriveFile>> {
  let query = format!("name = '{name}' and '{parent}' in parents and trashed = false");
  list_files(client, token, &query, "id,name,headRevisionId,appProperties").await
}

/// Uploads a small body whole. `uploadType=media` takes the raw bytes, so there
/// is no multipart envelope to get wrong — the previous code sent
/// `multipart/form-data` where Drive requires `multipart/related`, and every
/// upload was rejected with a 400. An `existing` file is written only over
/// the revision it names (`If-Match`).
async fn upload_simple(
  client: &reqwest::Client,
  token: &str,
  existing: Option<&DriveFile>,
  name: &str,
  parent: &str,
  body: Vec<u8>,
  owner: Option<&str>
) -> Result<DriveFile> {
  let response = match existing {
    Some(file) => write_over(client, token, file, body).send().await?,
    None => {
      // A create needs the name and parent, which `uploadType=media` cannot
      // carry, so the metadata goes in first and the bytes follow.
      let created: DriveFile = send(
        client
          .post(format!("{DRIVE_API}/files"))
          .bearer_auth(token)
          .query(&[("fields", "id,name,headRevisionId")])
          .json(&create_metadata(name, parent, owner))
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

/// The write of `body` over an existing small file, naming the revision read
/// (`If-Match`).
///
/// Optimistic concurrency: if another device wrote since it was read, this
/// should fail with 412 rather than discard their work. Whether Drive v3
/// honours `If-Match` on a media upload is not documented, and could not be
/// tried without a real Drive (sync audit W7). If it does not, the write
/// goes over the other device's, and `DocStore::written_between` finds what
/// it went over in the file's revisions and merges it back.
fn write_over(client: &reqwest::Client, token: &str, file: &DriveFile, body: Vec<u8>) -> reqwest::RequestBuilder {
  let request = client
    .patch(format!("{DRIVE_UPLOAD}/files/{}", file.id))
    .bearer_auth(token)
    .query(&[("uploadType", "media"), ("fields", "id,name,headRevisionId")])
    .header(reqwest::header::CONTENT_TYPE, "application/json")
    .body(body);
  match file.head_revision_id.as_deref() {
    Some(revision) => request.header(reqwest::header::IF_MATCH, revision),
    None => request
  }
}

/// What a new small file is made with: its name and folder, and, for
/// `state.json` with an owner, the marker.
fn create_metadata(name: &str, parent: &str, owner: Option<&str>) -> serde_json::Value {
  let mut metadata = serde_json::json!({ "name": name, "parents": [parent] });
  if let Some(owner) = owner {
    metadata["appProperties"] = serde_json::json!({ OWNER_PROPERTY: owner });
  }
  metadata
}

/// Marks an existing `state.json` as `owner`'s. Metadata only, so no
/// `If-Match`: the content was just written over the copy it named.
async fn mark_owner(client: &reqwest::Client, token: &str, file_id: &str, owner: &str) -> Result<()> {
  send(
    client
      .patch(format!("{DRIVE_API}/files/{file_id}"))
      .bearer_auth(token)
      .query(&[("fields", "id")])
      .json(&serde_json::json!({ "appProperties": { OWNER_PROPERTY: owner } }))
  )
  .await?;
  Ok(())
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

/// A file's bytes straight to `path`, a piece at a time.
async fn download_to(client: &reqwest::Client, token: &str, file_id: &str, path: &Path) -> Result<()> {
  let mut response = send(
    client
      .get(format!("{DRIVE_API}/files/{file_id}"))
      .bearer_auth(token)
      .query(&[("alt", "media")])
  )
  .await?;
  let mut out = std::fs::File::create(path)?;
  while let Some(piece) = response.chunk().await? {
    out.write_all(&piece)?;
  }
  out.sync_all()?;
  Ok(())
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

/// `state.json` in the Leaflet folder, as `shared_doc` reads and writes it.
struct DriveDoc<'a> {
  client: &'a reqwest::Client,
  token: &'a str,
  root: &'a str,
  /// The time Google's last answer gave (`Date`).
  heard: crate::sync::clock::Heard
}

impl shared_doc::DocStore for DriveDoc<'_> {
  fn read(&self) -> shared_doc::Pending<'_, (Remote, Option<shared_doc::Held>)> {
    Box::pin(async move {
      let Some(file) = find_file(self.client, self.token, STATE_FILE, self.root).await? else {
        return Ok((Remote::Absent, None));
      };
      let response = send(
        self
          .client
          .get(format!("{DRIVE_API}/files/{}", file.id))
          .bearer_auth(self.token)
          .query(&[("alt", "media")])
      )
      .await?;
      self.heard.note(response.headers());
      let bytes = response.bytes().await?.to_vec();
      // A corrupt document reads as absent, and this device republishes its
      // own state, which is recoverable. One a later version wrote is told
      // apart by its version first, and is not written over.
      let owner_mark = file.owner_mark();
      Ok((
        merge::read_remote(&bytes),
        Some(shared_doc::Held { id: file.id, revision: file.head_revision_id, owner_mark })
      ))
    })
  }

  fn write<'a>(
    &'a self,
    held: Option<&'a shared_doc::Held>,
    body: Vec<u8>,
    owner: Option<&'a str>
  ) -> shared_doc::Pending<'a, shared_doc::Written> {
    Box::pin(async move {
      let existing = held.map(|held| DriveFile {
        id: held.id.clone(),
        name: STATE_FILE.to_string(),
        head_revision_id: held.revision.clone(),
        app_properties: None
      });
      let written = match upload_simple(self.client, self.token, existing.as_ref(), STATE_FILE, self.root, body, owner).await {
          Ok(file) => file,
          Err(error) if error.to_string() == "CONFLICT" => return Ok(shared_doc::Written::Conflict),
          Err(error) => return Err(error)
        };
      if held.is_none() {
        // Made the first copy: if another device made one at the same moment,
        // the one with the lowest id is everyone's, and ours (when it is not
        // that one) goes; the round starts again over the keeper.
        let all = find_files(self.client, self.token, STATE_FILE, self.root).await?;
        if all.len() > 1 {
          let keeper = all.iter().map(|file| file.id.as_str()).min().unwrap_or_default();
          if keeper != written.id {
            let _ = send(
              self
                .client
                .delete(format!("{DRIVE_API}/files/{}", written.id))
                .bearer_auth(self.token)
            )
            .await;
          }
          return Ok(shared_doc::Written::Conflict);
        }
      } else if let Some(owner) = owner {
        // The content PATCH keeps the marker a file has; one without it (made
        // before owners, or by an older Leaflet) is marked now.
        if held.and_then(|held| held.owner_mark.as_deref()) != Some(owner) {
          mark_owner(self.client, self.token, &written.id, owner).await?;
        }
      }
      Ok(shared_doc::Written::Kept)
    })
  }

  fn clock_offset(&self) -> Option<i64> {
    self.heard.offset()
  }

  fn unmark<'a>(&'a self, held: &'a shared_doc::Held) -> shared_doc::Pending<'a, ()> {
    Box::pin(async move {
      // A property set to null is taken away (Drive v3 `appProperties`).
      send(
        self
          .client
          .patch(format!("{DRIVE_API}/files/{}", held.id))
          .bearer_auth(self.token)
          .query(&[("fields", "id")])
          .json(&serde_json::json!({ "appProperties": { OWNER_PROPERTY: serde_json::Value::Null } }))
      )
      .await?;
      Ok(())
    })
  }

  /// Drive keeps a file's earlier contents as revisions. The copies written
  /// between the one read and the one there is now are listed, and fetched:
  /// what a write that Drive took over a copy it did not name went over
  /// (sync audit W7). Never a reason to fail the run: the write itself went
  /// through, and a history that cannot be read is no history.
  fn written_between<'a>(&'a self, read: &'a shared_doc::Held, now: &'a shared_doc::Held) -> shared_doc::Pending<'a, Vec<Remote>> {
    Box::pin(async move {
      let (Some(from), Some(to)) = (read.revision.as_deref(), now.revision.as_deref()) else {
        return Ok(Vec::new());
      };
      if from == to || read.id != now.id {
        return Ok(Vec::new());
      }
      match copies_between(self.client, self.token, &now.id, from, to).await {
        Ok(copies) => Ok(copies),
        Err(error) => {
          crate::diag::warn(&format!("Drive's history of state.json could not be read: {error}"));
          Ok(Vec::new())
        }
      }
    })
  }
}

/// The most copies another device can have written between one read and one
/// write: a few seconds apart, so one or two at most. Anything past this is
/// left for the devices that wrote it, which put it back at their next sync.
const MOST_COPIES_BETWEEN: usize = 4;

#[derive(Deserialize)]
struct RevisionList {
  #[serde(default)]
  revisions: Vec<RevisionId>,
  #[serde(rename = "nextPageToken", default)]
  next_page_token: Option<String>
}

#[derive(Deserialize)]
struct RevisionId {
  id: String
}

/// The revisions strictly between `from` and `to` in `ids` (oldest first,
/// as Drive lists them); none when either is not there (Drive has let it go,
/// or another device's write came later still).
pub(crate) fn revisions_between(ids: &[String], from: &str, to: &str) -> Vec<String> {
  let (Some(start), Some(end)) = (ids.iter().position(|id| id == from), ids.iter().position(|id| id == to)) else {
    return Vec::new();
  };
  if end <= start + 1 {
    return Vec::new();
  }
  ids[start + 1..end].to_vec()
}

/// The contents of `file_id`'s revisions between `from` and `to`.
async fn copies_between(client: &reqwest::Client, token: &str, file_id: &str, from: &str, to: &str) -> Result<Vec<Remote>> {
  let mut ids: Vec<String> = Vec::new();
  let mut page: Option<String> = None;
  loop {
    let mut request = client
      .get(format!("{DRIVE_API}/files/{file_id}/revisions"))
      .bearer_auth(token)
      .query(&[("fields", "revisions(id),nextPageToken"), ("pageSize", "1000")]);
    if let Some(page) = &page {
      request = request.query(&[("pageToken", page.as_str())]);
    }
    let listed: RevisionList = send(request).await?.json().await?;
    ids.extend(listed.revisions.into_iter().map(|revision| revision.id));
    page = listed.next_page_token;
    if page.is_none() || ids.iter().any(|id| id == to) {
      break;
    }
  }
  let mut copies = Vec::new();
  for revision in revisions_between(&ids, from, to).into_iter().take(MOST_COPIES_BETWEEN) {
    let response = send(
      client
        .get(format!("{DRIVE_API}/files/{file_id}/revisions/{revision}"))
        .bearer_auth(token)
        .query(&[("alt", "media")])
    )
    .await?;
    copies.push(merge::read_remote(&response.bytes().await?));
  }
  Ok(copies)
}

/// A connection to the reader's Drive for one run: the folders found or
/// made, and whose library `state.json` is marked as (no document read yet).
pub struct DriveCtx {
  client: reqwest::Client,
  token: String,
  root: String,
  books_folder: String,
  pub doc_owner: Option<String>
}

/// Connects for a run: a token, the Leaflet folders, the Google account's
/// address for Settings, and the marker on `state.json`.
///
/// A 401 on a token not yet expired (Google stops honouring tokens when it
/// disables a client or a grant is revoked) drops the token and tries once
/// more: the refresh is where Google says which (`DriveAuthError`). A second
/// 401, on a fresh token, means connecting again.
pub async fn open(db_mutex: &std::sync::Mutex<Database>) -> Result<DriveCtx> {
  match connect(db_mutex).await {
    Err(error) if error.is::<SessionExpired>() => {
      {
        let db = db_mutex.guard();
        db.set_setting(ACCESS_SETTING, "")?;
        db.set_setting(EXPIRES_SETTING, "")?;
      }
      connect(db_mutex).await.map_err(|error| {
        if error.is::<SessionExpired>() {
          DriveAuthError(DriveUnavailable::Reconnect).into()
        } else {
          error
        }
      })
    }
    other => other
  }
}

async fn connect(db_mutex: &std::sync::Mutex<Database>) -> Result<DriveCtx> {
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
  let doc_owner = find_file(&client, &token, STATE_FILE, &root).await?.and_then(|file| file.owner_mark());
  Ok(DriveCtx { client, token, root, books_folder, doc_owner })
}

/// The state half: read, merge, write over the copy read and no other, check
/// it stuck (`shared_doc`), then apply here; or nothing at all, when the
/// Drive holds a library that is not this device's to merge with.
pub async fn sync_state(
  db_mutex: &std::sync::Mutex<Database>,
  ctx: &DriveCtx,
  now: &str,
  who: &shared_doc::Who
) -> Result<shared_doc::StateRun> {
  let doc_store = DriveDoc { client: &ctx.client, token: &ctx.token, root: &ctx.root, heard: Default::default() };
  shared_doc::sync(db_mutex, &doc_store, now, who).await
}

/// The files half, over this library as it is here. Publishes anything this
/// device holds that Drive does not; downloads stay on demand (`fetch_book`),
/// so connecting a new device does not pull a whole library. A large file
/// goes only with the reader's word (`sync::large`). With `may_delete`, the
/// files of books removed stop occupying the reader's quota; never in a
/// Drive that holds another account's library.
pub async fn sync_files(db_mutex: &std::sync::Mutex<Database>, ctx: &DriveCtx, may_delete: bool) -> Result<SyncReport> {
  let (client, token) = (&ctx.client, ctx.token.as_str());
  let remote_files: std::collections::HashMap<String, String> =
    list_files(client, token, &format!("'{}' in parents and trashed = false", ctx.books_folder), "id,name")
      .await?
      .into_iter()
      .map(|file| (file.name, file.id))
      .collect();
  let library = {
    let db = db_mutex.guard();
    store::library_files(&db)?
  };
  let mut report = SyncReport::default();

  if may_delete {
    for (entry, _) in library.iter().filter(|(entry, _)| entry.is_deleted()) {
      if let Some(file_id) = remote_files.get(&entry.remote_name()) {
        let _ = send(client.delete(format!("{DRIVE_API}/files/{file_id}")).bearer_auth(token)).await;
      }
    }
  }

  let mut answers = {
    let db = db_mutex.guard();
    large::Answers::load(&db)
  };
  // Whatever happens to an upload, the answers found on the way are kept.
  let mut failed = None;
  for (entry, path) in library.iter().filter(|(entry, _)| !entry.is_deleted()) {
    let name = entry.remote_name();
    if !path.exists() {
      // Fetched when it is opened.
      report.books_pending += 1;
      continue;
    }
    let bytes = large::file_bytes(path);
    if remote_files.contains_key(&name) {
      answers.found_backed_up(&entry.id, bytes);
      continue;
    }
    match large::decide(bytes, answers.get(&entry.id)) {
      large::Decision::Send => {
        if let Err(error) = upload_book(client, token, &ctx.books_folder, path, &name).await {
          failed = Some(error);
          break;
        }
        report.books_uploaded += 1;
      }
      large::Decision::Ask => report.books_held += 1,
      large::Decision::Skip => {}
    }
  }
  {
    let db = db_mutex.guard();
    answers.save(&db)?;
  }
  if let Some(error) = failed {
    return Err(error);
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
    let db = db_mutex.guard();
    db.find_by_id(book_id)?.ok_or_else(|| anyhow!("unknown book"))?
  };
  let entry = BookEntry::from_record(&record);

  let root = ensure_folder(&client, &token, ROOT_FOLDER, "root").await?;
  let books_folder = ensure_folder(&client, &token, BOOKS_FOLDER, &root).await?;
  let file = find_file(&client, &token, &entry.remote_name(), &books_folder)
    .await?
    // Not only "not uploaded yet": since 1.5.12's new Drive client, a book
    // whose file was only in the old backup is in no device's reach at all.
    .ok_or_else(|| anyhow!("That book isn't in your backup yet. Open it on a device that has it, or add the file again."))?;

  let destination = store::local_path_for(&entry)?;
  if let Some(parent) = destination.parent() {
    std::fs::create_dir_all(parent)?;
  }
  // Stage then rename, so an interrupted download cannot leave a truncated book
  // that later looks present. Written as it arrives: a phone has no room to
  // hold a 300 MB comic in memory first.
  let staging = destination.with_extension("part");
  if let Err(error) = download_to(&client, &token, &file.id, &staging).await {
    let _ = std::fs::remove_file(&staging);
    return Err(error);
  }
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

  /// Sync audit W7, as far as it goes without a real Drive: the write of
  /// `state.json` names the revision read (`If-Match`), as a media upload,
  /// and a file read with no revision is written without one.
  #[test]
  fn the_state_is_written_only_over_the_revision_read() {
    let client = reqwest::Client::new();
    let file = |revision: Option<&str>| DriveFile {
      id: "f1".to_string(),
      name: STATE_FILE.to_string(),
      head_revision_id: revision.map(str::to_string),
      app_properties: None
    };
    let request = write_over(&client, "token", &file(Some("0B7r")), b"{}".to_vec()).build().expect("a request");
    assert_eq!(request.method(), reqwest::Method::PATCH);
    assert!(request.url().as_str().starts_with(&format!("{DRIVE_UPLOAD}/files/f1?")));
    assert!(request.url().query().unwrap_or_default().contains("uploadType=media"));
    assert_eq!(request.headers().get(reqwest::header::IF_MATCH).and_then(|value| value.to_str().ok()), Some("0B7r"));
    let unnamed = write_over(&client, "token", &file(None), b"{}".to_vec()).build().expect("a request");
    assert!(unnamed.headers().get(reqwest::header::IF_MATCH).is_none());
  }

  /// What a write went over is found between the revision read and the one
  /// there after it, as Drive lists them (oldest first); nothing when Drive
  /// has let the revision read go, or the two are next to each other.
  #[test]
  fn the_copies_a_write_went_over_are_the_revisions_between() {
    let ids: Vec<String> = ["r1", "r2", "r3", "r4", "r5"].iter().map(|id| id.to_string()).collect();
    assert_eq!(revisions_between(&ids, "r2", "r5"), vec!["r3".to_string(), "r4".to_string()]);
    assert!(revisions_between(&ids, "r4", "r5").is_empty(), "nobody wrote in between");
    assert!(revisions_between(&ids, "r0", "r5").is_empty(), "the revision read is gone from the history");
    assert!(revisions_between(&ids, "r2", "r9").is_empty());
    assert!(revisions_between(&ids, "r5", "r2").is_empty());
  }

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

  #[test]
  fn google_refusals_are_read_in_googles_words() {
    let body = r#"{"error":"invalid_request","error_description":"Missing code verifier."}"#;
    assert_eq!(google_error(body).as_deref(), Some("Missing code verifier."));
    let used = r#"{"error":"invalid_grant","error_description":"Bad Request"}"#;
    assert!(google_error(used).expect("words").contains("Connect Drive again"));
    assert_eq!(google_error(r#"{"error":"invalid_client"}"#).as_deref(), Some("invalid_client"));
    assert_eq!(google_error("<html>bad gateway</html>"), None);
  }

  /// The owner's Drive client, 2026-10-22: "Error 401: disabled_client".
  /// Google's refusals of the client, and of the grant, are told apart from
  /// everything else, and carried as a typed error.
  #[test]
  fn googles_refusals_of_the_client_and_the_grant_are_recognised() {
    use DriveUnavailable::*;
    let disabled = r#"{"error":"disabled_client","error_description":"The OAuth client was disabled."}"#;
    assert_eq!(oauth_refusal(disabled), Some(ClientDisabled));
    assert_eq!(oauth_refusal(r#"{"error":"invalid_client","error_description":"The OAuth client was not found."}"#), Some(ClientDisabled));
    assert_eq!(oauth_refusal(r#"{"error":"unauthorized_client","error_description":"Unauthorized"}"#), Some(ClientDisabled));
    assert_eq!(oauth_refusal(r#"{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"#), Some(Reconnect));
    // A consent page's `error` parameter, and an answer that is not JSON.
    assert_eq!(oauth_refusal("disabled_client"), Some(ClientDisabled));
    assert_eq!(oauth_refusal("<html>Error 401: disabled_client</html>"), Some(ClientDisabled));
    // Everything else is no verdict on the client.
    assert_eq!(oauth_refusal(r#"{"error":"invalid_request","error_description":"Missing code verifier."}"#), None);
    assert_eq!(oauth_refusal(r#"{"error":"access_denied"}"#), None);
    assert_eq!(oauth_refusal("<html>bad gateway</html>"), None);
    assert_eq!(oauth_refusal(""), None);

    let error: anyhow::Error = DriveAuthError(ClientDisabled).into();
    assert_eq!(unavailable(&error), Some(ClientDisabled));
    assert_eq!(error.to_string(), "Google Drive is unavailable right now.");
    assert_eq!(unavailable(&anyhow!("Could not reach Drive: timed out")), None);
    assert_eq!(serde_json::to_string(&ClientDisabled).unwrap(), "\"client_disabled\"");
    assert_eq!(serde_json::to_string(&Reconnect).unwrap(), "\"reconnect\"");
  }

  /// After a disabled client, automatic syncs leave Drive alone for six
  /// hours; a grant to reconnect is never waited out.
  #[test]
  fn a_disabled_client_is_left_alone_for_six_hours() {
    let db = crate::db::tests::memory_db();
    let at = DateTime::parse_from_rfc3339("2026-10-22T09:00:00+00:00").unwrap().with_timezone(&Utc);
    // A grant this client made, whatever the build ships.
    db.set_setting(CLIENT_ID_SETTING, "leaflet.apps.googleusercontent.com").unwrap();
    note_grant_client(&db, "leaflet.apps.googleusercontent.com").unwrap();
    assert!(!paused(&db, at));
    note_unavailable(&db, DriveUnavailable::ClientDisabled, at).unwrap();
    assert_eq!(unavailable_noted(&db), Some(DriveUnavailable::ClientDisabled));
    assert!(paused(&db, at + chrono::Duration::hours(5) + chrono::Duration::minutes(59)));
    assert!(!paused(&db, at + chrono::Duration::hours(6)));

    note_unavailable(&db, DriveUnavailable::Reconnect, at).unwrap();
    assert_eq!(unavailable_noted(&db), Some(DriveUnavailable::Reconnect));
    assert!(!paused(&db, at));

    note_unavailable(&db, DriveUnavailable::ClientDisabled, at).unwrap();
    // (What `clear_tokens` does on a disconnect; not called here, as it
    // would clear this computer's real keychain entry.)
    clear_unavailable(&db).unwrap();
    assert_eq!(unavailable_noted(&db), None);
    assert!(!paused(&db, at));
  }

  /// 1.5.12 ships a new Drive client (the old one was disabled 2026-10-22).
  /// Google refuses a grant the old client made `unauthorized_client`; that
  /// is the reader's to fix by reconnecting, and is said so, at once.
  #[test]
  fn a_grant_from_the_old_client_asks_to_reconnect() {
    use DriveUnavailable::{ClientDisabled, Reconnect};
    let db = crate::db::tests::memory_db();
    let at = DateTime::parse_from_rfc3339("2026-10-24T09:00:00+00:00").unwrap().with_timezone(&Utc);
    db.set_setting(CLIENT_ID_SETTING, "new.apps.googleusercontent.com").unwrap();

    // A grant from before the note was kept, and one noted as the old client's.
    assert!(grant_from_another_client(&db));
    note_grant_client(&db, "old.apps.googleusercontent.com").unwrap();
    assert!(grant_from_another_client(&db));
    assert_eq!(refusal_for_grant(ClientDisabled, true), Reconnect);
    // The pause 1.5.11 noted for the disabled client does not hold it back.
    note_unavailable(&db, ClientDisabled, at).unwrap();
    assert!(!paused(&db, at));

    // Reconnected: the grant is this client's, and a disabled client is that again.
    note_grant_client(&db, "new.apps.googleusercontent.com").unwrap();
    assert!(!grant_from_another_client(&db));
    assert_eq!(refusal_for_grant(ClientDisabled, false), ClientDisabled);
    assert_eq!(refusal_for_grant(Reconnect, false), Reconnect);
    assert!(paused(&db, at));
  }

  #[test]
  fn tokens_are_read_from_googles_answer() {
    let body = r#"{"access_token":"ya29.a","expires_in":3599,"refresh_token":"1//r","scope":"x","token_type":"Bearer"}"#;
    let tokens = tokens_from(body).expect("tokens");
    assert_eq!(tokens.access_token, "ya29.a");
    assert_eq!(tokens.refresh_token, "1//r");
    let expires = chrono::DateTime::parse_from_rfc3339(&tokens.expires_at).expect("a time");
    let left = expires.with_timezone(&Utc) - Utc::now();
    assert!(left > chrono::Duration::minutes(58) && left <= chrono::Duration::minutes(60));
  }

  #[test]
  fn an_answer_without_a_refresh_token_is_refused() {
    let error = tokens_from(r#"{"access_token":"ya29.a","expires_in":3599}"#).err().expect("an error");
    assert!(error.to_string().contains("refresh token"));
    assert!(tokens_from(r#"{"refresh_token":"1//r"}"#).is_err());
  }

  /// The marker on `state.json` is read from its `appProperties`, and only a
  /// tag counts; a new file is made with it.
  #[test]
  fn the_owner_marker_is_read_from_app_properties() {
    let tag = "a".repeat(32);
    let listed: FilesList = serde_json::from_str(&format!(
      r#"{{"files":[{{"id":"1","name":"state.json","headRevisionId":"r1","appProperties":{{"leafletOwner":"{tag}"}}}},{{"id":"2","name":"state.json"}},{{"id":"3","name":"state.json","appProperties":{{"leafletOwner":"someone"}}}}]}}"#
    ))
    .expect("a listing");
    assert_eq!(listed.files[0].owner_mark().as_deref(), Some(tag.as_str()));
    assert_eq!(listed.files[1].owner_mark(), None, "made before owners");
    assert_eq!(listed.files[2].owner_mark(), None, "not a tag");

    let made = create_metadata(STATE_FILE, "root-id", Some(&tag));
    assert_eq!(made["appProperties"][OWNER_PROPERTY], serde_json::json!(tag));
    assert_eq!(made["parents"], serde_json::json!(["root-id"]));
    assert!(create_metadata(STATE_FILE, "root-id", None).get("appProperties").is_none());
  }
}
