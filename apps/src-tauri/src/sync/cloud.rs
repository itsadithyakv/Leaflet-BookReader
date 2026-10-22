//! Sync through Leaflet's own API, backed by MongoDB.
//!
//! The transport with a server behind it, and, signed in, the one that
//! carries a library's reading state: places, reading days, highlights,
//! notes, collections and Pip. Always on while a reader is signed in, for a
//! library that is the account's own (`owner::Standing::Mine`) or that it is
//! about to claim (`Adopting`); never for another account's library, which is
//! left as it is (`Other`). The server is also what compares readers to each
//! other for the board, which is not a peer-to-peer problem.
//!
//! It carries the **state document only**, never book files. Those stay in
//! the reader's own Drive or sync folder, and on their devices. A year of
//! reading compresses to some tens of kilobytes, under the server's 2 MB cap.
//!
//! The server stores the document as an opaque blob and never looks inside
//! it: not read, compressed, not encrypted. Merging stays here, in
//! [`crate::sync::merge`], so every transport agrees by construction rather
//! than by implementations happening to match. The copy carries the account's
//! owner tag for the record; nothing checks it but a fresh library's first
//! sync, which asks before taking in a copy from before owners
//! ([`CloudOutcome::AccountHolds`]).

use crate::db::Database;
use crate::sync::folder::SyncReport;
use crate::sync::merge::{self, has_news, Remote, SyncDoc};
use crate::sync::shared_doc::Pending;
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
/// What 1.5.1 and 1.5.2 kept when the reader chose to back their reading up to
/// the account by itself. The account now always carries the state while a
/// reader is signed in; the row is only cleared at sign-out.
const LEGACY_BACKUP_ALONE_SETTING: &str = "cloud_backup_alone";
/// The profile's figures as they were last sent, and by whom and when
/// (`commands::social::publish_profile`), so that the same few kilobytes do
/// not go up every few minutes of reading when nothing in them has moved.
pub const PROFILE_SENT_SETTING: &str = "cloud_profile_sent";
/// The account's copy of the state as this device last saw it: the document
/// exactly as the server holds it, its version, and whose it is. With it a
/// sync asks the server only whether the copy has moved on (`?have=`), and
/// the document itself (up to 2 MB, every sync) is not sent for nothing.
const STATE_COPY_SETTING: &str = "cloud_state_copy";
/// When this library last took the account's state in (`AccountMerged`): what
/// says whether its figures are the account's, before they are published.
pub const ACCOUNT_MERGED_SETTING: &str = "cloud_account_merged";

/// Retries after losing a race for the document. Each one is a fresh merge, so
/// nothing the other device wrote is lost.
const MAX_CONFLICT_RETRIES: u32 = 3;

/// The most the server keeps of the account's copy: gzipped bytes, as
/// `server/src/routes/state.js` (`MAX_STATE_BYTES`) counts them.
pub const STATE_MAX_BYTES: usize = 2 * 1024 * 1024;
/// From here the reader is told the account's copy is filling up (sync
/// audit D2): four fifths of the most there is.
pub const STATE_WARN_BYTES: usize = STATE_MAX_BYTES / 5 * 4;
/// How large the account's copy was when this device last sent or fetched it
/// (gzipped bytes), for the status (`state_usage`).
pub const STATE_BYTES_SETTING: &str = "cloud_state_bytes";

/// Said when the account's copy would be larger than the server keeps. The
/// run has still taken in what the account held; nothing here is lost.
pub fn too_large_message(bytes: usize) -> String {
  format!(
    "Your reading is too large for account sync ({} of {}). Everything stays on this device. Removing highlights you no longer need makes room.",
    megabytes(bytes),
    megabytes(STATE_MAX_BYTES)
  )
}

/// Bytes as megabytes, to one place ("1.7 MB").
pub fn megabytes(bytes: usize) -> String {
  format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
}

/// How full the account's copy is, when it is filling up: its bytes, and the
/// most there is. Nothing below `STATE_WARN_BYTES`, or before it is known.
pub fn state_usage(db: &Database) -> Option<(usize, usize)> {
  let bytes = db.get_setting(STATE_BYTES_SETTING).ok().flatten()?.parse::<usize>().ok()?;
  (bytes >= STATE_WARN_BYTES).then_some((bytes, STATE_MAX_BYTES))
}

fn note_state_bytes(db: &Database, bytes: usize) {
  let _ = db.set_setting(STATE_BYTES_SETTING, &bytes.to_string());
}

#[derive(Debug, Deserialize)]
struct StateResponse {
  version: i64,
  /// Base64 of the gzipped document. Absent for a reader who has never synced,
  /// and when `unchanged`.
  state: Option<String>,
  /// The server still holds the version the pull named (`?have=`). Never
  /// said by a server from before `have`, nor to a pull that named none.
  #[serde(default)]
  unchanged: bool
}

/// The server's answer as a pull's. "Unchanged" with a copy beside it is
/// taken at the copy's word: the document is what to merge with.
fn fetched_from(response: StateResponse) -> Fetched {
  match response {
    StateResponse { version, state: None, unchanged: true } => Fetched::Unchanged { version },
    StateResponse { version, state, .. } => Fetched::Full(Pulled { version, state })
  }
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

/// The document as the server stores it: gzipped JSON.
fn gzipped(doc: &SyncDoc) -> Result<Vec<u8>> {
  let json = serde_json::to_vec(doc)?;
  let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
  encoder.write_all(&json)?;
  Ok(encoder.finish()?)
}

/// And as it travels: base64 of that.
fn compress(doc: &SyncDoc) -> Result<String> {
  Ok(base64::engine::general_purpose::STANDARD.encode(gzipped(doc)?))
}

/// The gzipped bytes a base64 copy stands for, without decoding it.
fn decoded_len(encoded: &str) -> usize {
  let padding = encoded.bytes().rev().take_while(|byte| *byte == b'=').count();
  (encoded.len() / 4 * 3).saturating_sub(padding)
}

/// The document the server holds, or nothing for one that cannot be read.
/// What the server holds, its version read first (`merge::read_remote`): a
/// blob that will not decode is `Absent`, one a later version wrote is
/// `Newer` and is not written over.
fn decode_remote(encoded: &str) -> Remote {
  let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) else {
    return Remote::Absent;
  };
  let mut json = Vec::new();
  if GzDecoder::new(&bytes[..]).read_to_end(&mut json).is_err() {
    return Remote::Absent;
  }
  merge::read_remote(&json)
}

#[cfg(test)]
fn decode(encoded: &str) -> Option<SyncDoc> {
  match decode_remote(encoded) {
    Remote::Ours(doc) => Some(doc),
    _ => None
  }
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
    413 => anyhow!(too_large_message(STATE_MAX_BYTES + 1)),
    400..=499 => anyhow!("{message}"),
    _ => anyhow!("Leaflet server error ({status}): {message}")
  }
}

/// The one HTTP client every call to the Leaflet server goes through.
///
/// It used to be built anew for each call, and a client keeps its own
/// connections: so each of the four requests the app makes every few minutes
/// (and the three a minute with the board open) opened a connection of its
/// own and shook hands over TLS again, which is most of what a request costs
/// a small server. One client holds a connection open between requests, and
/// lets it go after a minute and a half idle. (A clone is a handle to the
/// same client, not another one.)
///
/// In tests each call still builds its own: a test has its own runtime, and
/// a connection kept from one that has ended is of no use to the next.
fn client() -> Result<reqwest::Client> {
  let build = || reqwest::Client::builder().timeout(Duration::from_secs(45)).build();
  if cfg!(test) {
    return Ok(build()?);
  }
  static SHARED: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
  if let Some(shared) = SHARED.get() {
    return Ok(shared.clone());
  }
  let built = build()?;
  Ok(SHARED.get_or_init(|| built).clone())
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
#[cfg(not(target_os = "android"))]
const KEYRING_SERVICE: &str = "app.leaflet.account";
#[cfg(not(target_os = "android"))]
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
  keep_session_token(token)
}

/// The keychain on a computer; Leaflet's private storage on a phone, where
/// `keyring` keeps nothing past the process (`device_secret`).
#[cfg(not(target_os = "android"))]
fn keep_session_token(token: &str) -> Result<()> {
  keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
    .and_then(|entry| entry.set_password(token))
    .map_err(|e| anyhow!("Could not save your sign-in to the system keychain: {e}"))
}

#[cfg(target_os = "android")]
fn keep_session_token(token: &str) -> Result<()> {
  crate::sync::device_secret::store(crate::sync::device_secret::SESSION, token)
    .map_err(|e| anyhow!("Could not save your sign-in on this phone: {e}"))
}

#[cfg(not(target_os = "android"))]
fn kept_session_token() -> Option<String> {
  keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
    .and_then(|entry| entry.get_password())
    .ok()
    .filter(|token| !token.is_empty())
}

#[cfg(target_os = "android")]
fn kept_session_token() -> Option<String> {
  crate::sync::device_secret::load(crate::sync::device_secret::SESSION)
}

#[cfg(not(target_os = "android"))]
fn forget_session_token() {
  if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
    let _ = entry.delete_credential();
  }
}

#[cfg(target_os = "android")]
fn forget_session_token() {
  crate::sync::device_secret::clear(crate::sync::device_secret::SESSION);
}

fn load_session_token() -> Option<String> {
  if let Some(token) = SESSION_CACHE.lock().ok().and_then(|cache| cache.clone()) {
    return Some(token);
  }
  let token = kept_session_token()?;
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
  forget_session_token();
  let _ = db.set_setting(ACCOUNT_API_SETTING, "");
  let _ = db.set_setting(ACCOUNT_CACHE_SETTING, "");
  // Whether the profile is shared belongs to the account that was signed in.
  // Kept, it made the next account on this computer publish (or not) by the
  // last one's choice.
  forget_visibility(db);
  let _ = db.set_setting(LEGACY_BACKUP_ALONE_SETTING, "");
  // What was last sent of the profile, and the account's copy of the state
  // as last seen, were that session's: the next sign-in, whoever's, sends
  // and fetches afresh.
  forget_profile_sent(db);
  forget_state_copy(db);
  let _ = db.set_setting(ACCOUNT_MERGED_SETTING, "");
  // The library's owner is kept: it is the library's, not the session's.
}

/// What was last sent of the profile (`PROFILE_SENT_SETTING`): the account it
/// went to, a fingerprint of the body, and when (Unix seconds).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProfileSent {
  pub account: String,
  pub print: String,
  pub at: i64
}

/// What was last sent of the profile, if it can be read.
pub fn profile_sent(db: &Database) -> Option<ProfileSent> {
  let value = db.get_setting(PROFILE_SENT_SETTING).ok().flatten()?;
  serde_json::from_str(&value).ok()
}

pub fn remember_profile_sent(db: &Database, sent: &ProfileSent) {
  if let Ok(value) = serde_json::to_string(sent) {
    let _ = db.set_setting(PROFILE_SENT_SETTING, &value);
  }
}

/// Forgets what was last sent of the profile, so the next publish sends.
pub fn forget_profile_sent(db: &Database) {
  let _ = db.set_setting(PROFILE_SENT_SETTING, "");
}

/// The last time this library merged the account's state in and applied it
/// (`sync_with`): whose account (its tag), when (Unix seconds, the run's
/// start), and how many minutes this device itself had read by then
/// (`Database::own_minutes`). A device's figures are the account's only as of
/// then, plus what it has read since (`commands::social::figures_current`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccountMerged {
  pub tag: String,
  pub at: i64,
  pub own: f64
}

/// When the account's state was last merged here, if it was and can be read.
pub fn account_merged(db: &Database) -> Option<AccountMerged> {
  let value = db.get_setting(ACCOUNT_MERGED_SETTING).ok().flatten()?;
  serde_json::from_str(&value).ok()
}

/// Notes that `tag`'s state has just been merged in and applied here.
pub fn remember_account_merged(db: &Database, tag: &str, at: i64) {
  let merged = AccountMerged { tag: tag.to_string(), at, own: db.own_minutes().unwrap_or(0.0) };
  if let Ok(value) = serde_json::to_string(&merged) {
    let _ = db.set_setting(ACCOUNT_MERGED_SETTING, &value);
  }
}

/// The rows that say who is signed in on this library, apart from the token
/// (which is the device's, in the keychain, and never moves).
const SESSION_MARKERS: [&str; 3] = [ACCOUNT_API_SETTING, ACCOUNT_CACHE_SETTING, PROFILE_VISIBILITY_SETTING];

/// Copies who is signed in from one library's database to another's, for a
/// switch between libraries on this device (per-account libraries).
pub fn copy_session_markers(from: &Database, to: &Database) -> Result<()> {
  for key in SESSION_MARKERS {
    let value = from.get_setting(key)?.unwrap_or_default();
    to.set_setting(key, &value)?;
  }
  Ok(())
}

/// Clears who is signed in from a library's database (one switched away
/// from), leaving the keychain's token alone.
pub fn clear_session_markers(db: &Database) -> Result<()> {
  for key in SESSION_MARKERS {
    db.set_setting(key, "")?;
  }
  Ok(())
}

/// Both: the session's rows go with the reader to the other library. (A
/// switch does the two halves apart, around writing the pointer, so a crash
/// between them leaves the reader signed in: `libraries::switch_in`.)
#[cfg(test)]
pub fn move_session_markers(from: &Database, to: &Database) -> Result<()> {
  copy_session_markers(from, to)?;
  clear_session_markers(from)
}

/// The signed-in account's id, as this device last heard it. `None` when
/// nobody is signed in on this library, or the account was never described.
pub fn signed_in_account_id(db: &Database) -> Option<String> {
  cached_account(db).map(|account| account.id).filter(|id| !id.trim().is_empty())
}

/// Whether a profile of this visibility is shown to anyone: to everyone
/// ("public") or to the readers it accepted ("followers"). Anything else the
/// server might say is private.
pub fn visibility_shown(visibility: &str) -> bool {
  matches!(visibility, "public" | "followers")
}

/// Whether the signed-in reader shares their profile, as this device last
/// heard it from the server: `Some(true)` public or followers-only,
/// `Some(false)` private, and `None` when it has not heard (a new sign-in,
/// another device made the choice, a fresh install).
///
/// A copy only. The server holds the truth; this is what lets the app decide
/// to publish nothing for a private reader without asking every time.
pub fn known_visibility(db: &Database) -> Option<bool> {
  match db.get_setting(PROFILE_VISIBILITY_SETTING).ok().flatten().as_deref() {
    Some("") | None => None,
    Some(value) => Some(visibility_shown(value))
  }
}

/// Keeps what the server said about the profile's visibility.
pub fn remember_visibility(db: &Database, visibility: &str) {
  let value = if visibility_shown(visibility) { visibility } else { "private" };
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
  /// Whether the address was confirmed with an emailed code. `None` when the
  /// server did not say: one from before confirmation existed (or with no
  /// mailer), or an account cached before then. The app then shows nothing
  /// about it, rather than nag for a code no server would take.
  #[serde(default)]
  pub email_confirmed: Option<bool>,
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
  patch_account(db_mutex, serde_json::json!({ "avatar": avatar })).await
}

/// The account's own name, which is what this app shows beside the reader's
/// avatar. An empty one removes it.
///
/// The profile has a copy (the one other readers see), and the two were set
/// together only at sign-up: a name changed on the profile left the old one
/// here for good. `save_social_profile` now sends both.
pub async fn set_display_name(db_mutex: &std::sync::Mutex<Database>, name: &str) -> Result<AccountStatus> {
  patch_account(db_mutex, account_name_body(name)).await
}

/// What changing the name sends: the name trimmed, or `null` for none.
fn account_name_body(name: &str) -> serde_json::Value {
  let name = name.trim();
  serde_json::json!({ "displayName": if name.is_empty() { None } else { Some(name) } })
}

/// Changes what the reader controls about the account itself. Only the fields
/// in `body` change; the answer is the account as the server now has it.
async fn patch_account(db_mutex: &std::sync::Mutex<Database>, body: serde_json::Value) -> Result<AccountStatus> {
  account_call(db_mutex, reqwest::Method::PATCH, "/v1/account", body).await
}

/// Asks the server to email a new code to the account's address. An address
/// already confirmed is sent nothing, and the answer says it is confirmed.
pub async fn request_email_code(db_mutex: &std::sync::Mutex<Database>) -> Result<AccountStatus> {
  account_call(db_mutex, reqwest::Method::POST, "/v1/account/email/code", serde_json::json!({})).await
}

/// Confirms the account's address with the emailed code.
pub async fn confirm_email(db_mutex: &std::sync::Mutex<Database>, code: &str) -> Result<AccountStatus> {
  account_call(db_mutex, reqwest::Method::POST, "/v1/account/email/confirm", email_code_body(code)).await
}

/// Changes the account's address, with the password. Every device stays
/// signed in; the new address starts unconfirmed and is sent a code.
pub async fn change_email(db_mutex: &std::sync::Mutex<Database>, password: &str, email: &str) -> Result<AccountStatus> {
  account_call(db_mutex, reqwest::Method::POST, "/v1/account/email", email_change_body(password, email)).await
}

/// What confirming sends: the code as typed, less the space around it. The
/// server reads past its case, dash and inner spaces.
fn email_code_body(code: &str) -> serde_json::Value {
  serde_json::json!({ "code": code.trim() })
}

/// What changing the address sends. The password goes exactly as typed (a
/// space can be part of one); the address trimmed.
fn email_change_body(password: &str, email: &str) -> serde_json::Value {
  serde_json::json!({ "password": password, "email": email.trim() })
}

/// A signed-in call that answers with the account as the server now has it,
/// which is kept here so the change shows offline too.
async fn account_call(
  db_mutex: &std::sync::Mutex<Database>,
  method: reqwest::Method,
  path: &str,
  body: serde_json::Value
) -> Result<AccountStatus> {
  let (base, token) = session_token(db_mutex)?;
  let response = client()?
    .request(method, format!("{base}{path}"))
    .bearer_auth(&token)
    .json(&body)
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
    // The server deleted the account's copy; the library here is nobody's now.
    if let Some(tag) = signed_in_account_id(&db).map(|id| crate::sync::owner::tag_for(&id)) {
      let _ = crate::sync::owner::release_if(&db, &tag);
      // And its tag is dead wherever it is still written (a Drive's or a
      // folder's copy and marker): no sync here takes the library back for it.
      let _ = crate::sync::owner::remember_released(&db, &tag);
    }
    clear_session(&db);
  }
  status(db_mutex, false).await
}

// ---- state ------------------------------------------------------------------

/// What the server holds: its version of the account's copy, and the copy
/// (base64 of the gzipped document), absent for an account that never synced.
#[derive(Debug, Clone, PartialEq)]
pub struct Pulled {
  pub version: i64,
  pub state: Option<String>
}

/// What a pull brought: the copy, or word that the server still holds the
/// version this device said it had (`have`), and so nothing more.
#[derive(Debug, Clone, PartialEq)]
pub enum Fetched {
  Full(Pulled),
  Unchanged { version: i64 }
}

/// How a write of the account's copy went.
#[derive(Debug, PartialEq)]
pub enum Pushed {
  Kept,
  /// Another device wrote since the version named.
  Conflict
}

/// Where the account's copy of the state lives: the server (`Server`), or a
/// fake in the tests, as `shared_doc::DocStore` is for Drive.
pub trait StateStore: Sync {
  /// The account's copy. `have` names a version this device already holds a
  /// copy of: a store that still holds that version may answer `Unchanged`
  /// instead of sending it again; one that does not (a server from before
  /// `have`) sends the copy, as it always did.
  fn pull(&self, have: Option<i64>) -> Pending<'_, Fetched>;
  /// Writes `payload` over `version`, only if that is still the server's.
  fn push<'a>(&'a self, version: i64, payload: &'a str) -> Pending<'a, Pushed>;
  /// How far the store's clock is from this device's, as its last answer
  /// said (`clock::offset_of`), where it said: what a run goes by.
  fn clock_offset(&self) -> Option<i64> {
    None
  }
}

/// The server's `/v1/state`, for the account signed in.
pub struct Server<'a> {
  db_mutex: &'a std::sync::Mutex<Database>,
  base: String,
  token: String,
  http: reqwest::Client,
  /// The time the server's last answer gave (`Date`).
  heard: crate::sync::clock::Heard
}

impl<'a> Server<'a> {
  /// The signed-in account's copy on the configured server.
  pub fn signed_in(db_mutex: &'a std::sync::Mutex<Database>) -> Result<Self> {
    let (base, token) = session_token(db_mutex)?;
    Ok(Server { db_mutex, base, token, http: client()?, heard: Default::default() })
  }

  /// A server and a session named outright, for the test against a server
  /// on this machine (`commands::e2e`): nothing is read from the keychain.
  #[cfg(test)]
  pub fn at(db_mutex: &'a std::sync::Mutex<Database>, base: &str, token: &str) -> Result<Self> {
    Ok(Server { db_mutex, base: base.to_string(), token: token.to_string(), http: client()?, heard: Default::default() })
  }
}

impl StateStore for Server<'_> {
  fn pull(&self, have: Option<i64>) -> Pending<'_, Fetched> {
    Box::pin(async move {
      let mut request = self.http.get(format!("{}/v1/state", self.base)).bearer_auth(&self.token);
      if let Some(have) = have.filter(|have| *have > 0) {
        request = request.query(&[("have", have.to_string())]);
      }
      let response = request.send().await.map_err(unreachable)?;
      self.heard.note(response.headers());
      if !response.status().is_success() {
        forget_if_unauthorised(self.db_mutex, response.status());
        return Err(describe_failure(response).await);
      }
      let pulled: StateResponse = response.json().await?;
      Ok(fetched_from(pulled))
    })
  }

  fn push<'a>(&'a self, version: i64, payload: &'a str) -> Pending<'a, Pushed> {
    Box::pin(async move {
      let push = self
        .http
        .put(format!("{}/v1/state", self.base))
        .bearer_auth(&self.token)
        .json(&StatePush { version, state: payload })
        .send()
        .await
        .map_err(unreachable)?;
      self.heard.note(push.headers());
      if push.status() == reqwest::StatusCode::CONFLICT {
        return Ok(Pushed::Conflict);
      }
      if !push.status().is_success() {
        forget_if_unauthorised(self.db_mutex, push.status());
        return Err(describe_failure(push).await);
      }
      Ok(Pushed::Kept)
    })
  }

  fn clock_offset(&self) -> Option<i64> {
    self.heard.offset()
  }
}

/// What an account sync came to.
#[derive(Debug)]
pub enum CloudOutcome {
  Synced(SyncReport),
  /// This library was started fresh, and the account holds a library from
  /// before it had an owner (and so perhaps another reader's, carried along
  /// by a device they shared): nothing was merged, and the reader is asked
  /// whether to take it in (`commands::backup::library_fresh_answer`).
  AccountHolds { books: usize }
}

/// Whether the account's copy is one a fresh library asks about first: it
/// has books or reading in it, and no owner (written before owners).
pub fn asks_before_taking(held: &SyncDoc) -> bool {
  held.owner.is_none() && (held.live_books().next().is_some() || !held.days.is_empty())
}

/// Merges this device's state with the account's (`store_of`: the server,
/// `Server::signed_in`, or a fake).
///
/// Signed in, this is where a library's reading state lives: always on, for
/// every library that is the account's own (or that it is about to claim).
/// Book files are untouched: this transport moves kilobytes, and Drive or a
/// folder carries the files themselves. `stamp` is the signed-in account's
/// tag, which the account's copy carries for the record.
pub async fn sync_with<S: StateStore + ?Sized>(
  db_mutex: &std::sync::Mutex<Database>,
  store_of: &S,
  now: &str,
  stamp: Option<&str>
) -> Result<CloudOutcome> {
  let at = unix_seconds(now);
  let started = now;
  let mut attempt = 0;
  // Larger than the server keeps: not sent (sync audit D2).
  let mut too_large: Option<usize> = None;
  let merged = loop {
    let (version, read) = pull_held(db_mutex, store_of, stamp, at).await?;
    // The server's time, where this device's clock is out (sync audit D3):
    // what the merge is made at, and what stamps from the future are read as.
    let reference = crate::sync::clock::reference(started, store_of.clock_offset());
    let now = reference.as_str();
    // What the server holds, where it holds a document that can be read. A
    // corrupt one must not take the library down: it is merged as an empty
    // one, and republishing this device's own state puts it right.
    let held = match read {
      Remote::Ours(doc) => Some(doc),
      Remote::Absent => None,
      // A later Leaflet wrote it: take what this one understands, write nothing.
      Remote::Newer(doc) => {
        let db = db_mutex.guard();
        let report = crate::sync::folder::take_from_newer(&db, doc, now)?;
        if let Some(stamp) = stamp {
          remember_account_merged(&db, stamp, at);
        }
        return Ok(CloudOutcome::Synced(report));
      }
    };
    let fresh = {
      let db = db_mutex.guard();
      crate::sync::owner::is_fresh(&db)
    };
    if let Some(held) = held.as_ref().filter(|held| fresh && asks_before_taking(held)) {
      return Ok(CloudOutcome::AccountHolds { books: held.live_books().count() });
    }
    let nothing;
    let remote = match &held {
      Some(remote) => remote,
      None => {
        nothing = SyncDoc::empty(now);
        &nothing
      }
    };

    let local = {
      let db = db_mutex.guard();
      store::snapshot(&db, now)?
    };
    let mut merged = merge::merge(&local, remote, now);
    if let Some(stamp) = stamp {
      merged.owner = Some(stamp.to_string());
    }
    // Nothing here the server's copy lacks: it is left as it is.
    if !has_news(&merged, held.as_ref()) {
      break merged;
    }
    let gzip = gzipped(&merged)?;
    note_state_bytes(&db_mutex.guard(), gzip.len());
    // Over what the server keeps, the push would only be refused (413), at
    // every sync and with megabytes sent each time. It is not sent; what the
    // account held is still taken in here, and the reader is told.
    if gzip.len() > STATE_MAX_BYTES {
      too_large = Some(gzip.len());
      break merged;
    }
    let payload = base64::engine::general_purpose::STANDARD.encode(&gzip);
    match store_of.push(version, &payload).await? {
      Pushed::Kept => {
        // What was sent is now the account's copy, at the version after.
        keep_state_copy(&db_mutex.guard(), stamp, version + 1, Some(&payload), at);
        break merged;
      }
      Pushed::Conflict => {
        // Another device wrote between the read and the write. Merge again
        // over what they wrote rather than overwriting it, fetched whole:
        // the copy kept here is not the server's any more.
        forget_state_copy(&db_mutex.guard());
        attempt += 1;
        if attempt > MAX_CONFLICT_RETRIES {
          return Err(anyhow!("Another device is syncing right now. Try again shortly."));
        }
      }
    }
  };

  let applied = {
    let db = db_mutex.guard();
    let applied = store::apply(&db, &merged)?;
    // The first account sync of a fresh library is behind it.
    crate::sync::owner::set_fresh(&db, false)?;
    // This library now holds everything the account held at the start of
    // the run: its figures may be published (`commands::social`).
    if let Some(stamp) = stamp {
      remember_account_merged(&db, stamp, at);
    }
    applied
  };
  if let Some(bytes) = too_large {
    return Err(anyhow!(too_large_message(bytes)));
  }

  Ok(CloudOutcome::Synced(SyncReport {
    entries_updated: applied.updated,
    books_removed: applied.removed.len(),
    books_pending: applied.missing.len(),
    ..SyncReport::default()
  }))
}

/// Replaces what the account holds with an empty library, stamped as the
/// signed-in account's: "Start empty", for a fresh library whose account
/// held one from before. Cannot be undone.
pub async fn replace_with_empty(db_mutex: &std::sync::Mutex<Database>, now: &str) -> Result<()> {
  let stamp = {
    let db = db_mutex.guard();
    crate::sync::owner::signed_in_tag(&db)
  }
  .ok_or_else(|| anyhow!(SIGN_IN_FIRST))?;
  replace_with_empty_on(db_mutex, &Server::signed_in(db_mutex)?, now, &stamp).await
}

/// `replace_with_empty` against any store. The copy kept of what the account
/// held goes first, whatever comes of the write: it is about to be wrong.
pub async fn replace_with_empty_on<S: StateStore + ?Sized>(
  db_mutex: &std::sync::Mutex<Database>,
  store_of: &S,
  now: &str,
  stamp: &str
) -> Result<()> {
  forget_state_copy(&db_mutex.guard());
  let empty = SyncDoc { owner: Some(stamp.to_string()), ..SyncDoc::empty(now) };
  let payload = compress(&empty)?;
  for _ in 0..=MAX_CONFLICT_RETRIES {
    let version = match store_of.pull(None).await? {
      Fetched::Full(pulled) => pulled.version,
      Fetched::Unchanged { .. } => return Err(anyhow!(ODD_ANSWER))
    };
    if store_of.push(version, &payload).await? == Pushed::Kept {
      keep_state_copy(&db_mutex.guard(), Some(stamp), version + 1, Some(&payload), unix_seconds(now));
      return Ok(());
    }
  }
  Err(anyhow!("Another device is syncing right now. Try again shortly."))
}

/// A server that says "unchanged" to a pull that named no version.
const ODD_ANSWER: &str = "The Leaflet server's answer made no sense. Try again shortly.";

/// How long a copy kept of the account's state is trusted without being
/// fetched whole again: a day. The server's version number is all that says
/// the copy is still the one it holds, and a server put back from a backup
/// counts versions again from an older one, so in time it could name the
/// version kept here for a different document. A day of syncs is still
/// nearly all of them spared the document; one a day fetches it.
const STATE_COPY_TRUSTED_SECS: i64 = 24 * 60 * 60;

/// The account's copy as this device last saw it (`STATE_COPY_SETTING`):
/// whose (the account's tag), its version, the document exactly as the server
/// holds it (base64 of the gzip), and when it was last known to be the
/// server's (Unix seconds).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct StateCopy {
  tag: String,
  version: i64,
  state: String,
  at: i64
}

/// `now` (RFC 3339, as a sync is handed it) in Unix seconds; the clock's own
/// when it will not read.
fn unix_seconds(now: &str) -> i64 {
  chrono::DateTime::parse_from_rfc3339(now)
    .map(|at| at.timestamp())
    .unwrap_or_else(|_| chrono::Utc::now().timestamp())
}

/// The copy kept of `tag`'s state, if there is one worth asking about: it
/// reads, it is that account's, and it is recent. One that is not is
/// forgotten here.
fn kept_state_copy(db: &Database, tag: &str, now: i64) -> Option<StateCopy> {
  let value = db.get_setting(STATE_COPY_SETTING).ok().flatten().filter(|value| !value.is_empty())?;
  let kept = serde_json::from_str::<StateCopy>(&value)
    .ok()
    .filter(|kept| kept.tag == tag && kept.version > 0 && (0..STATE_COPY_TRUSTED_SECS).contains(&(now - kept.at)));
  if kept.is_none() {
    forget_state_copy(db);
  }
  kept
}

/// Keeps `state` as `tag`'s copy at `version`; forgets the copy instead when
/// there is nothing to keep (no account, nothing held, no version yet).
fn keep_state_copy(db: &Database, tag: Option<&str>, version: i64, state: Option<&str>, now: i64) {
  let (Some(tag), Some(state)) = (tag, state) else {
    forget_state_copy(db);
    return;
  };
  if version <= 0 {
    forget_state_copy(db);
    return;
  }
  let kept = StateCopy { tag: tag.to_string(), version, state: state.to_string(), at: now };
  match serde_json::to_string(&kept) {
    Ok(value) => {
      let _ = db.set_setting(STATE_COPY_SETTING, &value);
    }
    Err(_) => forget_state_copy(db)
  }
}

/// Forgets the copy kept of the account's state: the next sync fetches it whole.
pub fn forget_state_copy(db: &Database) {
  let _ = db.set_setting(STATE_COPY_SETTING, "");
}

/// Reads the account's copy: its version, and what it holds.
///
/// A sync used to fetch the whole document every time (up to 2 MB, about ten
/// times a day), though nearly always nothing had changed since the last.
/// Where this device kept the copy it last saw, the server is now asked only
/// whether its version is still that one (`have`), and the kept copy is what
/// is merged with when it is. Whenever the two might not be the same
/// document (the server names another version, the kept copy will not read)
/// the copy is fetched whole: a merge is never made against a wrong one.
async fn pull_held<S: StateStore + ?Sized>(
  db_mutex: &std::sync::Mutex<Database>,
  store_of: &S,
  tag: Option<&str>,
  now: i64
) -> Result<(i64, Remote)> {
  let kept = tag.and_then(|tag| kept_state_copy(&db_mutex.guard(), tag, now));
  if let Some(kept) = kept {
    match store_of.pull(Some(kept.version)).await? {
      Fetched::Full(pulled) => return Ok(take_pulled(db_mutex, tag, pulled, now)),
      Fetched::Unchanged { version } if version == kept.version => match decode_remote(&kept.state) {
        // A kept copy that will not read is no copy at all.
        Remote::Absent => {}
        read => return Ok((version, read))
      },
      // Not the version kept, so not the document kept either.
      Fetched::Unchanged { .. } => {}
    }
    forget_state_copy(&db_mutex.guard());
  }
  match store_of.pull(None).await? {
    Fetched::Full(pulled) => Ok(take_pulled(db_mutex, tag, pulled, now)),
    Fetched::Unchanged { .. } => Err(anyhow!(ODD_ANSWER))
  }
}

/// A copy fetched whole, read, and kept for next time where it reads.
fn take_pulled(db_mutex: &std::sync::Mutex<Database>, tag: Option<&str>, pulled: Pulled, now: i64) -> (i64, Remote) {
  let read = pulled.state.as_deref().map(decode_remote).unwrap_or(Remote::Absent);
  let db = db_mutex.guard();
  if let Some(state) = pulled.state.as_deref() {
    note_state_bytes(&db, decoded_len(state));
  }
  if matches!(read, Remote::Absent) {
    forget_state_copy(&db);
  } else {
    keep_state_copy(&db, tag, pulled.version, pulled.state.as_deref(), now);
  }
  (pulled.version, read)
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
  pub read_day: Option<String>,
  /// Whether the readers who follow this one may see its whole library.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub share_library: Option<bool>,
  /// Whether friends may raid the reader's camp in the Hollow. A server from
  /// before raids ignores it.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub raidable: Option<bool>,
  /// The book being read (`title`, `author`, `percent`); JSON `null` to say
  /// "none now". Left out, the server keeps what it has.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub reading: Option<serde_json::Value>,
  /// The level seeds ever earned have reached, the badges earned, and the
  /// arcade's best scores: what a profile shows off.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub level: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub badges: Option<Vec<String>>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub arcade: Option<serde_json::Value>,
  /// Pip's camp in the Hollow as a profile shows it: building levels,
  /// counts and where things stand (`commands::pip_shop::camp_summary`),
  /// never the camp itself. JSON `null` to say "none now"; left out, the
  /// server keeps what it has. A server from before the camp ignores it,
  /// and one from before the layout keeps the levels and counts alone.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub camp: Option<serde_json::Value>
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
  pub rank: Option<i64>,
  /// What a newer server adds; each is absent from an older one.
  #[serde(default)]
  pub shares_library: bool,
  /// Whether friends may raid the camp: no until the reader says yes (1.5.10;
  /// it was yes until they said no), so no from a server that does not say.
  #[serde(default)]
  pub raidable: bool,
  #[serde(default)]
  pub reading: Option<serde_json::Value>,
  #[serde(default)]
  pub level: Option<i64>,
  #[serde(default)]
  pub badges: Vec<String>,
  #[serde(default)]
  pub arcade: Option<serde_json::Value>,
  /// Pip's camp as the profile shows it, or nothing for none.
  #[serde(default)]
  pub camp: Option<serde_json::Value>,
  /// Whether the community guidelines were accepted; whether this is the
  /// owner's account; until when posting is suspended, if it is.
  #[serde(default)]
  pub rules_accepted: bool,
  #[serde(default)]
  pub is_admin: bool,
  #[serde(default)]
  pub suspended_until: Option<String>,
  /// How many different readers have sent this reader kudos, and how many
  /// they have sent kudos to, counted up to the badge's ten (the server
  /// keeps these; 0 from a server that does not).
  #[serde(default)]
  pub kudos_from: i64,
  #[serde(default)]
  pub kudos_to: i64
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

/// Sends a problem report (`POST /v1/problems`), signed in or not: with the
/// session when there is one, so the server knows whom to answer. The body
/// is `commands::diagnostics::problem_body`'s. Each failure says why in a
/// sentence, and the page then offers to send it by email instead.
pub async fn send_problem(
  db_mutex: &std::sync::Mutex<Database>,
  body: serde_json::Value
) -> Result<()> {
  let method = reqwest::Method::POST;
  let auth = CommunityAuth::Optional;
  let response = community_send(db_mutex, method, "/v1/problems", &[], Some(body), auth).await?;
  let status = response.status();
  if status.is_success() {
    return Ok(());
  }
  if status == reqwest::StatusCode::NOT_FOUND {
    return Err(anyhow!("This Leaflet server can't take problem reports yet."));
  }
  // The server's own words for a limit, a full list or a refused field.
  let said = response
    .json::<serde_json::Value>()
    .await
    .ok()
    .and_then(|json| json.get("error").and_then(|error| error.as_str()).map(str::to_string));
  let plain = status.is_client_error() || status == reqwest::StatusCode::SERVICE_UNAVAILABLE;
  Err(match said {
    Some(message) if plain => anyhow!(message),
    _ => anyhow!("The Leaflet server had a problem ({status}). Try again later.")
  })
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
pub(crate) mod fake {
  use super::*;
  use std::sync::Mutex;

  /// The server's `/v1/state` without the network: a version that counts
  /// writes, the copy, and a way to be down. It answers `have` as the server
  /// does, unless it is playing one from before `have` (`old`), and counts
  /// what it sends.
  #[derive(Default)]
  pub struct FakeCloud {
    inner: Mutex<Inner>
  }

  #[derive(Default)]
  struct Inner {
    version: i64,
    state: Option<String>,
    down: bool,
    pushes: u32,
    /// Written by "another device" just before the next push lands.
    interloper: Option<String>,
    /// A server from before `have`: it always sends the copy.
    ignores_have: bool,
    /// The `have` of each pull, in order.
    asked: Vec<Option<i64>>,
    /// How much of the document the pulls have carried, in bytes of base64.
    sent: usize,
    /// How far its clock is from the device's, as a `Date` header would say.
    clock: Option<i64>
  }

  impl FakeCloud {
    pub fn failing() -> Self {
      let cloud = FakeCloud::default();
      cloud.inner.lock().unwrap().down = true;
      cloud
    }

    /// A server from before `have`.
    pub fn old() -> Self {
      let cloud = FakeCloud::default();
      cloud.inner.lock().unwrap().ignores_have = true;
      cloud
    }

    pub fn doc(&self) -> Option<SyncDoc> {
      self.inner.lock().unwrap().state.as_deref().and_then(decode)
    }

    /// Puts a copy there as another device would have.
    pub fn put(&self, doc: &SyncDoc) {
      let mut inner = self.inner.lock().unwrap();
      inner.state = Some(compress(doc).expect("compress"));
      inner.version += 1;
    }

    /// Puts a copy there under the version it has now, as a server put back
    /// from a backup could come to: what no `have` can tell from the last.
    pub fn swap_in_place(&self, doc: &SyncDoc) {
      self.inner.lock().unwrap().state = Some(compress(doc).expect("compress"));
    }

    pub fn sneak_in(&self, doc: &SyncDoc) {
      self.inner.lock().unwrap().interloper = Some(compress(doc).expect("compress"));
    }

    pub fn pushes(&self) -> u32 {
      self.inner.lock().unwrap().pushes
    }

    /// A server whose clock is `offset_ms` from the device's.
    pub fn with_clock(self, offset_ms: i64) -> Self {
      self.inner.lock().unwrap().clock = Some(offset_ms);
      self
    }

    /// The `have` of each pull since the last call, and the bytes of the
    /// document they carried.
    pub fn pulls(&self) -> (Vec<Option<i64>>, usize) {
      let mut inner = self.inner.lock().unwrap();
      (std::mem::take(&mut inner.asked), std::mem::take(&mut inner.sent))
    }
  }

  impl StateStore for FakeCloud {
    fn pull(&self, have: Option<i64>) -> Pending<'_, Fetched> {
      Box::pin(async move {
        let mut inner = self.inner.lock().unwrap();
        if inner.down {
          return Err(anyhow!("Leaflet server error (503 Service Unavailable): down"));
        }
        inner.asked.push(have);
        if !inner.ignores_have && have.is_some_and(|have| have > 0 && have == inner.version) {
          return Ok(Fetched::Unchanged { version: inner.version });
        }
        inner.sent += inner.state.as_ref().map_or(0, String::len);
        Ok(Fetched::Full(Pulled { version: inner.version, state: inner.state.clone() }))
      })
    }

    fn push<'a>(&'a self, version: i64, payload: &'a str) -> Pending<'a, Pushed> {
      Box::pin(async move {
        let mut inner = self.inner.lock().unwrap();
        if let Some(theirs) = inner.interloper.take() {
          inner.state = Some(theirs);
          inner.version += 1;
        }
        if version != inner.version {
          return Ok(Pushed::Conflict);
        }
        inner.state = Some(payload.to_string());
        inner.version += 1;
        inner.pushes += 1;
        Ok(Pushed::Kept)
      })
    }

    fn clock_offset(&self) -> Option<i64> {
      self.inner.lock().unwrap().clock
    }
  }
}

#[cfg(test)]
mod tests {
  /// A name is sent trimmed, and an emptied one as `null`, which the server
  /// takes as "remove it" (a missing field would leave the old name).
  #[test]
  fn a_changed_name_is_sent_trimmed_and_an_emptied_one_as_null() {
    assert_eq!(super::account_name_body("  Ada Lovelace ").to_string(), r#"{"displayName":"Ada Lovelace"}"#);
    assert_eq!(super::account_name_body("   ").to_string(), r#"{"displayName":null}"#);
    assert_eq!(super::account_name_body("").to_string(), r#"{"displayName":null}"#);
  }

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

  /// "Not confirmed" and "the server did not say" are different answers: the
  /// second is an older server, and the app must not ask it for a code.
  #[test]
  fn an_account_without_the_confirmed_flag_is_unknown_not_unconfirmed() {
    let older: Account = serde_json::from_str(r#"{"id":"a1","email":"ada@example.com"}"#).unwrap();
    assert_eq!(older.email_confirmed, None);
    let unconfirmed: Account =
      serde_json::from_str(r#"{"id":"a1","email":"ada@example.com","emailConfirmed":false}"#).unwrap();
    assert_eq!(unconfirmed.email_confirmed, Some(false));
    let confirmed: Account =
      serde_json::from_str(r#"{"id":"a1","email":"ada@example.com","emailConfirmed":true,"createdAt":null}"#).unwrap();
    assert_eq!(confirmed.email_confirmed, Some(true));

    // The cache and the page get it under the server's own name, and an
    // unknown one survives being cached and read back as unknown.
    assert!(serde_json::to_string(&unconfirmed).unwrap().contains(r#""emailConfirmed":false"#));
    let cached: Account = serde_json::from_str(&serde_json::to_string(&older).unwrap()).unwrap();
    assert_eq!(cached.email_confirmed, None);
  }

  /// The answers to asking for a code and to changing the address carry more
  /// than the account (`sent`, `minutes`); only the account is read.
  #[test]
  fn the_confirmation_answers_are_read_for_their_account() {
    let asked: MeResponse = serde_json::from_str(
      r#"{"sent":true,"minutes":30,"account":{"id":"a1","email":"ada@example.com","emailConfirmed":false,"displayName":null,"avatar":null,"createdAt":"2026-10-07T09:00:00.000Z"}}"#
    )
    .unwrap();
    assert_eq!(asked.account.email_confirmed, Some(false));
    let confirmed: MeResponse =
      serde_json::from_str(r#"{"account":{"id":"a1","email":"ada@example.com","emailConfirmed":true}}"#).unwrap();
    assert_eq!(confirmed.account.email_confirmed, Some(true));
  }

  #[test]
  fn a_code_and_a_new_address_are_sent_trimmed_and_the_password_as_typed() {
    assert_eq!(email_code_body("  abcd-efgh ").to_string(), r#"{"code":"abcd-efgh"}"#);
    assert_eq!(
      email_change_body(" pass word ", "  Ada@Example.com ").to_string(),
      r#"{"email":"Ada@Example.com","password":" pass word "}"#
    );
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
    let back = decode(&encoded).expect("a document");

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
    assert!(decode("not base64 at all !!!").is_none());
    assert!(decode("aGVsbG8gd29ybGQ=").is_none());
    // And what is absent is replaced: this device's document is sent in its place.
    let db = memory_db();
    db.credit_minutes("2026-09-01", 25.0, 20).expect("credit");
    assert!(has_news(&synced(&db, None, NOW), decode("aGVsbG8gd29ybGQ=").as_ref()));
  }

  /// What a sync on this device comes to: its own state merged over what the
  /// server holds (`held`), or over nothing.
  fn synced(db: &Database, held: Option<&SyncDoc>, now: &str) -> SyncDoc {
    let local = store::snapshot(db, now).expect("snapshot");
    merge::merge(&local, held.unwrap_or(&SyncDoc::empty(now)), now)
  }

  const LATER: &str = "2026-09-04T18:30:00+00:00";

  #[test]
  fn the_first_document_is_always_sent() {
    // The server holds none: a new account, or backing up to it switched on
    // just now. Sent whatever is in it, and an empty library's as well.
    let db = memory_db();
    assert!(has_news(&synced(&db, None, NOW), None));
    db.credit_minutes("2026-09-01", 25.0, 20).expect("credit");
    assert!(has_news(&synced(&db, None, NOW), None));
  }

  #[test]
  fn a_sync_that_finds_nothing_new_sends_nothing() {
    let db = memory_db();
    db.credit_minutes("2026-09-01", 25.0, 20).expect("credit");
    db.credit_minutes("2026-09-02", 40.0, 20).expect("credit");
    // What the first sync sent, as the server hands it back.
    let held = decode(&compress(&synced(&db, None, NOW)).expect("compress")).expect("a document");

    // Hours later with nothing read since (the app opened again, a book
    // closed unread): the merge is the server's copy but for its date.
    let merged = synced(&db, Some(&held), LATER);
    assert_ne!(merged.updated_at, held.updated_at);
    assert!(!has_news(&merged, Some(&held)));

    // A device with nothing of its own (a new install signing in) takes the
    // document in and has nothing to send back.
    let fresh = memory_db();
    let taken = synced(&fresh, Some(&held), LATER);
    assert_eq!(taken.days.len(), 2);
    assert!(!has_news(&taken, Some(&held)));
  }

  #[test]
  fn a_device_with_anything_the_server_lacks_still_sends_it() {
    let db = memory_db();
    db.credit_minutes("2026-09-01", 25.0, 20).expect("credit");
    let held = synced(&db, None, NOW);

    // Another day read; or only a minute more on a day already there.
    db.credit_minutes("2026-09-03", 10.0, 20).expect("credit");
    let another_day = synced(&db, Some(&held), LATER);
    assert!(has_news(&another_day, Some(&held)));
    db.credit_minutes("2026-09-03", 1.0, 20).expect("credit");
    assert!(has_news(&synced(&db, Some(&another_day), LATER), Some(&another_day)));

    // A second device with reading of its own: what it sends holds both.
    let other = memory_db();
    other.credit_minutes("2026-08-30", 15.0, 20).expect("credit");
    let both = synced(&other, Some(&held), LATER);
    assert!(has_news(&both, Some(&held)));
    assert_eq!(both.days.len(), 2);
    // And once that is on the server, the first device has only to take it in.
    assert!(has_news(&synced(&db, Some(&both), LATER), Some(&both)), "the first device read on since");
    let all = synced(&db, Some(&both), LATER);
    assert!(!has_news(&synced(&other, Some(&all), LATER), Some(&all)));
  }

  #[test]
  fn a_document_from_an_older_format_is_sent_again_in_this_one() {
    let db = memory_db();
    db.credit_minutes("2026-09-01", 25.0, 20).expect("credit");
    let mut held = synced(&db, None, NOW);
    held.version -= 1;
    assert!(has_news(&synced(&db, Some(&held), LATER), Some(&held)));
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
    // Kept to followers is shared too: their board still shows the figures.
    remember_visibility(&db, "followers");
    assert_eq!(known_visibility(&db), Some(true));
    // Anything else the server might say is private.
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

  // ---- the account's copy ---------------------------------------------------

  use super::fake::FakeCloud;
  use std::sync::Mutex;
  use crate::LockExt;

  const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  fn library_with(ids: &[&str]) -> Mutex<Database> {
    let db = memory_db();
    for id in ids {
      db.upsert_book(&crate::db::BookRecord {
        finished_at: None,
        id: id.to_string(),
        title: format!("Book {id}"),
        author: None,
        genres: Vec::new(),
        cover_url: None,
        local_path: format!("/device/books/{id}.epub"),
        file_hash: id.to_string(),
        progress: 0.0,
        position: None,
        series: None,
        series_index: None,
        last_opened: None,
        created_at: NOW.to_string(),
        metadata_checked_at: None,
        metadata_updated_at: Some(NOW.to_string()),
        progress_updated_at: Some(NOW.to_string()),
        deleted_at: None,
        available: true
      })
      .expect("import");
    }
    Mutex::new(db)
  }

  fn ids(db: &Mutex<Database>) -> Vec<String> {
    let mut ids: Vec<String> = db.guard().list_books().expect("list").into_iter().map(|b| b.id).collect();
    ids.sort();
    ids
  }

  /// Sync audit D3 over the account: this device's clock is twenty minutes
  /// fast, and the server's `Date` says so. The run goes by the server's
  /// time; the stamps the fast clock wrote are read as it, sent so, and put
  /// right in the rows here.
  #[tokio::test]
  async fn a_sync_goes_by_the_servers_clock() {
    let fast_now = "2026-09-04T12:20:00+00:00";
    let library = library_with(&["aaa"]);
    {
      // Read a minute ago by its own clock.
      let db = library.guard();
      let mut row = db.find_by_id("aaa").expect("find").expect("there");
      row.progress = 0.4;
      row.progress_updated_at = Some("2026-09-04T12:19:00+00:00".to_string());
      db.upsert_book(&row).expect("read");
    }
    let cloud = FakeCloud::default().with_clock(-20 * 60 * 1000);

    assert!(matches!(sync_with(&library, &cloud, fast_now, Some(A)).await.expect("sync"), CloudOutcome::Synced(_)));

    let held = cloud.doc().expect("held");
    assert_eq!(held.updated_at, NOW, "made at the server's noon, not the device's twenty past");
    let book = held.books.iter().find(|book| book.id == "aaa").expect("aaa");
    assert_eq!(book.progress_updated_at, NOW);
    let row = library.guard().find_by_id("aaa").expect("find").expect("there");
    assert_eq!(row.progress_updated_at.as_deref(), Some(NOW));
    // And the next sync, with nothing read, sends nothing.
    assert!(matches!(sync_with(&library, &cloud, fast_now, Some(A)).await.expect("sync"), CloudOutcome::Synced(_)));
    assert_eq!(cloud.pushes(), 1);
  }

  /// Nothing changed, nothing sent: a library with a bit of everything in it
  /// (fractional progress and minutes, highlights and a removed one, a
  /// session, Pip, the camp, the reading pace, a collection) syncs, and the
  /// syncs after it find nothing to send, through the compression and the
  /// copy kept here as the server holds it.
  #[tokio::test]
  async fn a_library_with_everything_in_it_sends_once_and_then_nothing() {
    let library = library_with(&["aaa", "bbb"]);
    {
      let db = library.guard();
      db.update_progress("aaa", 0.123_456_7, Some(NOW.to_string()), Some("epubcfi(/6/14!/4/2/1:0)".to_string())).expect("read");
      db.credit_minutes("2026-09-03", 12.345_678_9, 20).expect("minutes");
      db.credit_minutes("2026-09-04", 0.1 + 0.2, 20).expect("minutes");
      for (id, deleted) in [("h1", None), ("h2", Some(NOW.to_string()))] {
        db.put_annotation(&crate::db::Annotation {
          id: id.into(),
          book_id: "aaa".into(),
          kind: "highlight".into(),
          cfi: "epubcfi(/6/2!/4/2,/1:0,/1:5)".into(),
          text: Some("A line".into()),
          note: Some("a note".into()),
          color: Some("yellow".into()),
          chapter: None,
          created_at: NOW.into(),
          updated_at: NOW.into(),
          deleted_at: deleted
        })
        .expect("mark");
      }
      db.put_collection(&crate::db::Collection {
        id: "c1".into(),
        name: "Shelf".into(),
        book_ids: vec!["aaa".into()],
        created_at: NOW.into(),
        updated_at: NOW.into(),
        deleted_at: None
      })
      .expect("shelf");
      db.put_pip_state(&crate::pip::PipState::fresh(NOW)).expect("pip");
      crate::sync::store::keep_camp(&db, &merge::CampEntry { state: r#"{"v":2,"camps":3}"#.into(), saved_at: NOW.into() }).expect("camp");
      crate::sync::reading::absorb(
        &db,
        &serde_json::from_str(r#"{"version":2,"core":{"updatedAt":"2026-09-04T11:00:00Z","base":{"wpm":251.75}},"books":{"aaa":{"updatedAt":"2026-09-04T11:00:00Z","wpm":210.3}}}"#).expect("profile")
      )
      .expect("pace");
    }
    let cloud = FakeCloud::default();
    for _ in 0..3 {
      assert!(matches!(sync_with(&library, &cloud, LATER, Some(A)).await.expect("sync"), CloudOutcome::Synced(_)));
    }
    assert_eq!(cloud.pushes(), 1, "only the first had anything to send");
    // A minute read is news again, once.
    library.guard().credit_minutes("2026-09-04", 1.0, 20).expect("minutes");
    for _ in 0..2 {
      sync_with(&library, &cloud, LATER, Some(A)).await.expect("sync");
    }
    assert_eq!(cloud.pushes(), 2);
  }

  /// Highlights made in an open book wait to go up (the app's
  /// services/pushHold), in the database. An app stopped while they wait
  /// loses none: the next run, at the next launch, finds them news and sends
  /// them, with nothing kept anywhere but the library itself.
  #[tokio::test]
  async fn highlights_that_waited_go_up_with_the_next_run_after_the_app_was_stopped() {
    let library = library_with(&["aaa"]);
    let cloud = FakeCloud::default();
    sync_with(&library, &cloud, NOW, Some(A)).await.expect("the launch's sync");
    for id in ["h1", "h2", "h3"] {
      library
        .guard()
        .put_annotation(&crate::db::Annotation {
          id: id.into(),
          book_id: "aaa".into(),
          kind: "highlight".into(),
          cfi: format!("epubcfi(/6/4!/4/2,/1:0,/1:{})", id.len()),
          text: Some("Marked while reading".into()),
          note: None,
          color: Some("yellow".into()),
          chapter: None,
          created_at: NOW.into(),
          updated_at: NOW.into(),
          deleted_at: None
        })
        .expect("mark");
    }
    // The app is stopped here, before any sync. At the next launch:
    assert!(matches!(sync_with(&library, &cloud, LATER, Some(A)).await.expect("sync"), CloudOutcome::Synced(_)));
    assert_eq!(cloud.doc().expect("held").annotations.len(), 3);
    assert_eq!(cloud.pushes(), 2);
  }

  /// Sync audit D2: a library whose copy would be larger than the server
  /// keeps is not sent (it would only be refused, at every sync). What the
  /// account holds still comes in, nothing here is lost, and the reader is
  /// told why and what to do. Below the most, from four fifths of it, the
  /// status says it is filling up.
  #[tokio::test]
  async fn a_library_too_large_for_the_account_is_not_sent_and_loses_nothing() {
    let library = library_with(&["aaa"]);
    {
      // Highlights of words that do not compress: some 3 MB of them.
      let db = library.guard();
      let mut seed: u64 = 0x2545_f491_4f6c_dd1d;
      let mut words = || {
        (0..1000)
          .map(|_| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            char::from(b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[(seed % 62) as usize])
          })
          .collect::<String>()
      };
      for index in 0..3000 {
        db.put_annotation(&crate::db::Annotation {
          id: format!("h{index}"),
          book_id: "aaa".into(),
          kind: "highlight".into(),
          cfi: format!("epubcfi(/6/{index}!/4/2,/1:0,/1:9)"),
          text: Some(words()),
          note: None,
          color: Some("yellow".into()),
          chapter: None,
          created_at: NOW.into(),
          updated_at: NOW.into(),
          deleted_at: None
        })
        .expect("mark");
      }
    }
    let cloud = FakeCloud::default();
    cloud.put(&store::snapshot(&library_with(&["phone"]).guard(), NOW).expect("the phone's"));

    let failed = sync_with(&library, &cloud, LATER, Some(A)).await.expect_err("too large");
    let message = failed.to_string();
    assert!(message.starts_with("Your reading is too large for account sync ("), "{message}");
    assert!(message.contains("of 2.0 MB") && message.contains("Removing highlights"), "{message}");
    assert_eq!(cloud.pushes(), 0, "nothing sent");
    assert_eq!(ids(&library), vec!["aaa".to_string(), "phone".to_string()], "what the account held came in");
    assert_eq!(library.guard().all_annotations().expect("marks").len(), 3000, "and nothing here is lost");
    let (bytes, limit) = state_usage(&library.guard()).expect("the status says so");
    assert!(bytes > limit && limit == STATE_MAX_BYTES);
  }

  #[test]
  fn the_status_says_the_account_is_filling_up_from_four_fifths() {
    let db = memory_db();
    assert_eq!(state_usage(&db), None, "not known yet");
    note_state_bytes(&db, STATE_WARN_BYTES - 1);
    assert_eq!(state_usage(&db), None);
    note_state_bytes(&db, STATE_WARN_BYTES);
    assert_eq!(state_usage(&db), Some((STATE_WARN_BYTES, STATE_MAX_BYTES)));
    db.set_setting(STATE_BYTES_SETTING, "lots").expect("odd");
    assert_eq!(state_usage(&db), None);
    assert_eq!(megabytes(STATE_WARN_BYTES), "1.6 MB");
    // A copy's size is known from its base64 without decoding it.
    for size in [0usize, 1, 2, 3, 4, 1000, 1001, 1002] {
      let encoded = base64::engine::general_purpose::STANDARD.encode(vec![7u8; size]);
      assert_eq!(decoded_len(&encoded), size);
    }
  }

  /// The size is kept from what is sent, and from what is fetched whole.
  #[tokio::test]
  async fn the_size_of_the_accounts_copy_is_kept_as_it_is_sent_and_fetched() {
    let library = library_with(&["aaa"]);
    let cloud = FakeCloud::default();
    sync_with(&library, &cloud, NOW, Some(A)).await.expect("sync");
    let sent: usize = library.guard().get_setting(STATE_BYTES_SETTING).expect("row").expect("kept").parse().expect("a number");
    assert_eq!(sent, gzipped(&cloud.doc().expect("held")).expect("gzip").len());
    let phone = library_with(&[]);
    sync_with(&phone, &cloud, NOW, Some(A)).await.expect("sync");
    assert_eq!(phone.guard().get_setting(STATE_BYTES_SETTING).expect("row").as_deref(), Some(sent.to_string().as_str()));
  }

  /// A fresh library asks about a copy from before owners, and only that:
  /// one stamped by the account's own devices, or one with nothing in it, is
  /// merged as always, and the question is behind it.
  #[tokio::test]
  async fn only_a_fresh_library_asks_and_only_about_a_copy_from_before_owners() {
    let legacy = library_with(&["old"]);
    let cloud = FakeCloud::default();
    cloud.put(&store::snapshot(&legacy.guard(), NOW).expect("snapshot"));

    let fresh = library_with(&["new"]);
    crate::sync::owner::set_fresh(&fresh.guard(), true).expect("fresh");
    match sync_with(&fresh, &cloud, LATER, Some(A)).await.expect("sync") {
      CloudOutcome::AccountHolds { books } => assert_eq!(books, 1),
      other => panic!("asked nothing: {other:?}")
    }
    assert_eq!(ids(&fresh), vec!["new".to_string()], "nothing merged");
    assert_eq!(cloud.pushes(), 0);

    // "Use it": the question answered, the copy merged in.
    crate::sync::owner::set_fresh(&fresh.guard(), false).expect("answered");
    assert!(matches!(sync_with(&fresh, &cloud, LATER, Some(A)).await.expect("sync"), CloudOutcome::Synced(_)));
    assert_eq!(ids(&fresh), vec!["new".to_string(), "old".to_string()]);
    assert_eq!(cloud.doc().expect("held").owner.as_deref(), Some(A), "and stamped from now on");

    // A fresh library meeting a stamped copy takes it without asking.
    let another = library_with(&[]);
    crate::sync::owner::set_fresh(&another.guard(), true).expect("fresh");
    assert!(matches!(sync_with(&another, &cloud, LATER, Some(A)).await.expect("sync"), CloudOutcome::Synced(_)));
    assert_eq!(ids(&another), vec!["new".to_string(), "old".to_string()]);
    assert!(!crate::sync::owner::is_fresh(&another.guard()), "asked once, at most");

    // Nor about one that holds nothing.
    let empty_cloud = FakeCloud::default();
    empty_cloud.put(&SyncDoc::empty(NOW));
    let third = library_with(&["x"]);
    crate::sync::owner::set_fresh(&third.guard(), true).expect("fresh");
    assert!(matches!(sync_with(&third, &empty_cloud, LATER, Some(A)).await.expect("sync"), CloudOutcome::Synced(_)));
  }

  /// "Start empty" replaces the account's copy with an empty one, stamped,
  /// over another device's write if one lands first.
  #[tokio::test]
  async fn starting_empty_replaces_what_the_account_holds() {
    let cloud = FakeCloud::default();
    cloud.put(&store::snapshot(&library_with(&["old"]).guard(), NOW).expect("snapshot"));
    cloud.sneak_in(&store::snapshot(&library_with(&["old", "older"]).guard(), NOW).expect("snapshot"));
    replace_with_empty_on(&library_with(&[]), &cloud, LATER, A).await.expect("replaced");
    let held = cloud.doc().expect("held");
    assert!(held.books.is_empty() && held.days.is_empty());
    assert_eq!(held.owner.as_deref(), Some(A));
  }

  /// A write that loses a race is merged again over the winner's.
  #[tokio::test]
  async fn a_lost_race_for_the_account_is_merged_again() {
    let cloud = FakeCloud::default();
    let laptop = library_with(&["aaa"]);
    sync_with(&laptop, &cloud, NOW, Some(A)).await.expect("first");
    let phone = library_with(&["bbb"]);
    let theirs = merge::merge(&store::snapshot(&phone.guard(), NOW).expect("snapshot"), &cloud.doc().expect("held"), NOW);
    cloud.sneak_in(&theirs);
    let laptop_more = library_with(&["aaa", "ccc"]);
    sync_with(&laptop_more, &cloud, LATER, Some(A)).await.expect("second");
    assert_eq!(ids(&laptop_more), vec!["aaa".to_string(), "bbb".to_string(), "ccc".to_string()]);
    let mut held: Vec<String> = cloud.doc().expect("held").books.into_iter().map(|b| b.id).collect();
    held.sort();
    assert_eq!(held, vec!["aaa".to_string(), "bbb".to_string(), "ccc".to_string()]);
  }

  /// Who is signed in moves with the reader between libraries; the token,
  /// the device's, never does.
  #[test]
  fn the_session_markers_move_between_libraries() {
    let (from, to) = (memory_db(), memory_db());
    from.set_setting(ACCOUNT_API_SETTING, "https://api.example.com").expect("set");
    from.set_setting(ACCOUNT_CACHE_SETTING, r#"{"id":"a1","email":"ada@example.com"}"#).expect("set");
    remember_visibility(&from, "public");
    assert_eq!(signed_in_account_id(&from).as_deref(), Some("a1"));
    move_session_markers(&from, &to).expect("move");
    assert_eq!(signed_in_account_id(&to).as_deref(), Some("a1"));
    assert_eq!(to.get_setting(ACCOUNT_API_SETTING).unwrap().as_deref(), Some("https://api.example.com"));
    assert_eq!(known_visibility(&to), Some(true));
    assert_eq!(signed_in_account_id(&from), None);
    assert_eq!(known_visibility(&from), None);
  }

  const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  /// A sync that finds the account's copy where it left it fetches none of
  /// it, and merges with the copy it kept.
  #[tokio::test]
  async fn an_unchanged_copy_is_not_fetched_again() {
    let cloud = FakeCloud::default();
    cloud.put(&store::snapshot(&library_with(&["old"]).guard(), NOW).expect("snapshot"));
    let laptop = library_with(&["aaa"]);
    sync_with(&laptop, &cloud, NOW, Some(A)).await.expect("first");
    let (asked, sent) = cloud.pulls();
    assert_eq!(asked, vec![None], "nothing kept yet, so nothing named");
    assert!(sent > 0);
    assert_eq!(cloud.pushes(), 1);

    // Hours later, nothing new on either side: asked, and nothing carried.
    sync_with(&laptop, &cloud, LATER, Some(A)).await.expect("second");
    assert_eq!(cloud.pulls(), (vec![Some(2)], 0));
    assert_eq!(cloud.pushes(), 1);

    // What is merged with is the copy kept: a document put under the same
    // version (no server does that) is not even seen.
    cloud.swap_in_place(&store::snapshot(&library_with(&["zzz"]).guard(), NOW).expect("snapshot"));
    sync_with(&laptop, &cloud, LATER, Some(A)).await.expect("third");
    assert_eq!(ids(&laptop), vec!["aaa".to_string(), "old".to_string()]);
    assert_eq!(cloud.pulls(), (vec![Some(2)], 0));
  }

  /// A copy another device has moved on is fetched whole, and merged.
  #[tokio::test]
  async fn a_changed_copy_is_fetched_whole() {
    let cloud = FakeCloud::default();
    let laptop = library_with(&["aaa"]);
    sync_with(&laptop, &cloud, NOW, Some(A)).await.expect("first");
    cloud.pulls();
    let phone = library_with(&["bbb"]);
    sync_with(&phone, &cloud, NOW, Some(A)).await.expect("phone");
    cloud.pulls();

    sync_with(&laptop, &cloud, LATER, Some(A)).await.expect("second");
    let (asked, sent) = cloud.pulls();
    assert_eq!(asked, vec![Some(1)], "the version kept, which is not the server's now");
    assert!(sent > 0);
    assert_eq!(ids(&laptop), vec!["aaa".to_string(), "bbb".to_string()]);
    // And what came is kept in its turn.
    sync_with(&laptop, &cloud, LATER, Some(A)).await.expect("third");
    assert_eq!(cloud.pulls(), (vec![Some(2)], 0));
  }

  /// A server from before `have` sends the copy every time, as it always
  /// did, and the sync goes on as it always did.
  #[tokio::test]
  async fn a_server_that_ignores_have_still_syncs() {
    let cloud = FakeCloud::old();
    cloud.put(&store::snapshot(&library_with(&["old"]).guard(), NOW).expect("snapshot"));
    let laptop = library_with(&["aaa"]);
    sync_with(&laptop, &cloud, NOW, Some(A)).await.expect("first");
    cloud.pulls();
    let phone = library_with(&["bbb"]);
    sync_with(&phone, &cloud, NOW, Some(A)).await.expect("phone");
    cloud.pulls();
    sync_with(&laptop, &cloud, LATER, Some(A)).await.expect("second");
    let (asked, sent) = cloud.pulls();
    assert_eq!(asked, vec![Some(2)]);
    assert!(sent > 0);
    assert_eq!(ids(&laptop), vec!["aaa".to_string(), "bbb".to_string(), "old".to_string()]);
  }

  /// The copy kept is one account's, and only for a day; one that will not
  /// read is no copy. Each time the next sync fetches the document whole.
  #[tokio::test]
  async fn a_copy_kept_is_dropped_for_another_account_a_day_or_a_bad_row() {
    let cloud = FakeCloud::default();
    let laptop = library_with(&["aaa"]);
    sync_with(&laptop, &cloud, NOW, Some(A)).await.expect("first");
    cloud.pulls();

    // Another account on this library: nothing named, and its copy is kept.
    sync_with(&laptop, &cloud, NOW, Some(B)).await.expect("other account");
    assert_eq!(cloud.pulls().0, vec![None]);
    sync_with(&laptop, &cloud, NOW, Some(A)).await.expect("back");
    assert_eq!(cloud.pulls().0, vec![None], "B's copy is not A's");
    sync_with(&laptop, &cloud, NOW, Some(A)).await.expect("again");
    assert!(cloud.pulls().0[0].is_some(), "named this time");

    // A day on, the copy is not trusted.
    sync_with(&laptop, &cloud, "2026-09-05T12:00:01+00:00", Some(A)).await.expect("a day on");
    assert_eq!(cloud.pulls().0, vec![None]);

    // A row that will not read.
    laptop.guard().set_setting(STATE_COPY_SETTING, "{not json").expect("set");
    sync_with(&laptop, &cloud, "2026-09-05T12:00:02+00:00", Some(A)).await.expect("bad row");
    assert_eq!(cloud.pulls().0, vec![None]);

    // A row that reads but holds a document that does not: the server says
    // "unchanged", and it is fetched whole after all.
    let kept = |db: &Mutex<Database>| -> StateCopy {
      serde_json::from_str(&db.guard().get_setting(STATE_COPY_SETTING).expect("row").expect("kept")).expect("a copy")
    };
    let bad = StateCopy { state: "aGVsbG8gd29ybGQ=".to_string(), ..kept(&laptop) };
    laptop.guard().set_setting(STATE_COPY_SETTING, &serde_json::to_string(&bad).expect("json")).expect("set");
    sync_with(&laptop, &cloud, "2026-09-05T12:00:03+00:00", Some(A)).await.expect("bad copy");
    let (asked, sent) = cloud.pulls();
    assert_eq!(asked, vec![Some(bad.version), None]);
    assert!(sent > 0);
    assert_eq!(ids(&laptop), vec!["aaa".to_string()]);

    // "Start empty" keeps the copy it wrote, which the next sync goes by.
    replace_with_empty_on(&laptop, &cloud, "2026-09-05T12:00:04+00:00", A).await.expect("replaced");
    cloud.pulls();
    let written = kept(&laptop).version;
    sync_with(&laptop, &cloud, "2026-09-05T12:00:05+00:00", Some(A)).await.expect("after");
    assert_eq!(cloud.pulls(), (vec![Some(written)], 0));
    // One forgotten (as at sign-out) is fetched whole.
    forget_state_copy(&laptop.guard());
    sync_with(&laptop, &cloud, "2026-09-05T12:00:06+00:00", Some(A)).await.expect("forgotten");
    assert_eq!(cloud.pulls().0, vec![None]);
  }

  /// A store that says "unchanged" whatever version it is told.
  struct Muddled(FakeCloud);

  impl StateStore for Muddled {
    fn pull(&self, have: Option<i64>) -> Pending<'_, Fetched> {
      match have {
        Some(_) => Box::pin(async { Ok(Fetched::Unchanged { version: 99 }) }),
        None => self.0.pull(None)
      }
    }

    fn push<'a>(&'a self, version: i64, payload: &'a str) -> Pending<'a, Pushed> {
      self.0.push(version, payload)
    }
  }

  /// "Unchanged" at a version other than the one kept is never merged with
  /// the copy kept: the document is fetched whole.
  #[tokio::test]
  async fn unchanged_at_another_version_is_fetched_whole() {
    let cloud = Muddled(FakeCloud::default());
    cloud.0.put(&store::snapshot(&library_with(&["old"]).guard(), NOW).expect("snapshot"));
    let laptop = library_with(&["aaa"]);
    sync_with(&laptop, &cloud, NOW, Some(A)).await.expect("first");
    cloud.0.pulls();
    let phone = library_with(&["bbb"]);
    sync_with(&phone, &cloud.0, NOW, Some(A)).await.expect("phone");
    cloud.0.pulls();
    sync_with(&laptop, &cloud, LATER, Some(A)).await.expect("second");
    assert_eq!(cloud.0.pulls().0, vec![None], "only the second pull reached the store");
    assert_eq!(ids(&laptop), vec!["aaa".to_string(), "bbb".to_string(), "old".to_string()]);
  }

  /// A lost race forgets the copy kept: the next pull is whole.
  #[tokio::test]
  async fn a_lost_race_fetches_the_winner_whole() {
    let cloud = FakeCloud::default();
    let laptop = library_with(&["aaa"]);
    sync_with(&laptop, &cloud, NOW, Some(A)).await.expect("first");
    let theirs = merge::merge(&store::snapshot(&library_with(&["bbb"]).guard(), NOW).expect("snapshot"), &cloud.doc().expect("held"), NOW);
    cloud.sneak_in(&theirs);
    laptop.guard().credit_minutes("2026-09-03", 10.0, 20).expect("credit");
    cloud.pulls();
    sync_with(&laptop, &cloud, LATER, Some(A)).await.expect("second");
    assert_eq!(cloud.pulls().0, vec![Some(1), None]);
    assert_eq!(ids(&laptop), vec!["aaa".to_string(), "bbb".to_string()]);
  }

  /// The server's answer, read: "unchanged" only without a copy beside it.
  #[test]
  fn the_servers_answer_says_unchanged_only_without_a_copy() {
    let read = |json: &str| fetched_from(serde_json::from_str(json).expect("an answer"));
    assert_eq!(read(r#"{"version":4,"unchanged":true}"#), Fetched::Unchanged { version: 4 });
    assert_eq!(read(r#"{"version":4,"state":"abc"}"#), Fetched::Full(Pulled { version: 4, state: Some("abc".to_string()) }));
    assert_eq!(read(r#"{"version":0,"state":null}"#), Fetched::Full(Pulled { version: 0, state: None }));
    assert_eq!(read(r#"{"version":4,"state":"abc","unchanged":true}"#), Fetched::Full(Pulled { version: 4, state: Some("abc".to_string()) }));
  }
}
