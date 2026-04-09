use crate::db::{BookRecord, Database};
use crate::storage;
use crate::sync::{DriveState, PendingAuth};
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use oauth2::basic::BasicClient;
use oauth2::{
  AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
  PkceCodeVerifier, RedirectUrl, TokenResponse, TokenUrl
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use tokio::sync::oneshot;

const DRIVE_SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
const DRIVE_API: &str = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3";

#[derive(Debug, Serialize, Deserialize)]
struct DriveFile {
  id: String,
  name: String,
  #[serde(rename = "mimeType")]
  mime_type: String,
  #[serde(rename = "modifiedTime")]
  modified_time: Option<String>
}

#[derive(Debug, Serialize, Deserialize)]
struct FilesList {
  files: Vec<DriveFile>
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncMetadata {
  #[serde(rename = "lastUpdated")]
  pub last_updated: String,
  pub books: Vec<BookRecord>
}

pub struct AuthStart {
  pub url: String
}

pub struct AuthTokens {
  pub access_token: String,
  pub refresh_token: String,
  pub expires_at: String
}

pub fn auth_start(state: &mut DriveState) -> Result<AuthStart> {
  let client = oauth_client()?;
  let listener = TcpListener::bind("127.0.0.1:0")?;
  let port = listener.local_addr()?.port();
  let redirect = format!("http://127.0.0.1:{}/oauth2/callback", port);
  let redirect_url = RedirectUrl::new(redirect.clone())?;

  let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
  let (auth_url, csrf_state) = client
    .set_redirect_uri(redirect_url)
    .authorize_url(CsrfToken::new_random)
    .add_scope(oauth2::Scope::new(DRIVE_SCOPE.to_string()))
    .set_pkce_challenge(pkce_challenge)
    .url();

  let csrf_secret = csrf_state.secret().to_string();
  let (tx, rx) = oneshot::channel();
  std::thread::spawn(move || {
    if let Ok((mut stream, _)) = listener.accept() {
      let mut buffer = [0u8; 4096];
      if stream.read(&mut buffer).is_ok() {
        if let Some(code) = parse_code_from_request(&buffer, &csrf_secret) {
          let _ = tx.send(code);
          let _ = respond(&mut stream, "Leaflet authentication complete. You can close this tab.");
          return;
        }
      }
      let _ = respond(&mut stream, "Leaflet authentication failed. Please retry.");
    }
  });

  state.pending_code_rx = Some(rx);
  state.pkce_verifier = Some(pkce_verifier);
  state.csrf_state = Some(csrf_secret.clone());
  state.redirect_uri = Some(redirect);

  Ok(AuthStart {
    url: auth_url.to_string()
  })
}

pub async fn auth_wait(pending: PendingAuth) -> Result<AuthTokens> {
  let code = pending.code_rx.await.map_err(|_| anyhow!("auth cancelled"))?;
  let verifier = pending.pkce_verifier;
  let redirect = pending.redirect_uri;

  let client = oauth_client()?;
  let token = client
    .set_redirect_uri(RedirectUrl::new(redirect)?)
    .exchange_code(AuthorizationCode::new(code))
    .set_pkce_verifier(verifier)
    .request_async(oauth2::reqwest::async_http_client)
    .await?;

  let access_token = token.access_token().secret().to_string();
  let refresh_token = token
    .refresh_token()
    .map(|t| t.secret().to_string())
    .ok_or_else(|| anyhow!("missing refresh token"))?;
  let expires_at = token
    .expires_in()
    .map(|dur| (Utc::now() + chrono::Duration::from_std(dur).unwrap()).to_rfc3339())
    .unwrap_or_else(|| (Utc::now() + chrono::Duration::hours(1)).to_rfc3339());

  Ok(AuthTokens {
    access_token,
    refresh_token,
    expires_at
  })
}

pub async fn drive_sync(db_mutex: &std::sync::Mutex<Database>) -> Result<()> {
  let access_token = ensure_access_token(db_mutex).await?;
  let client = reqwest::Client::new();
  let root_id = ensure_folder(&client, &access_token, "Leaflet", "root").await?;
  let books_folder_id = ensure_folder(&client, &access_token, "books", &root_id).await?;

  let local_books = {
    let db = db_mutex.lock().unwrap();
    db.list_books()?
  };
  let local_metadata = SyncMetadata {
    last_updated: Utc::now().to_rfc3339(),
    books: local_books.clone()
  };
  let local_metadata_path = write_local_metadata(&local_metadata)?;

  let remote_metadata = download_metadata(&client, &access_token, &root_id).await?;
  let merged_metadata = merge_metadata(local_metadata, remote_metadata);
  let merged_path = write_local_metadata(&merged_metadata)?;

  upload_metadata(&client, &access_token, &root_id, &merged_path).await?;

  let downloaded = sync_books(
    &client,
    &access_token,
    &books_folder_id,
    &merged_metadata,
    &local_books
  )
  .await?;

  for book in downloaded {
    let mut db = db_mutex.lock().unwrap();
    db.upsert_book(&book)?;
  }

  Ok(())
}

fn oauth_client() -> Result<BasicClient> {
  let client_id = env::var("DUDEREADER_GOOGLE_CLIENT_ID")
    .map_err(|_| anyhow!("Missing DUDEREADER_GOOGLE_CLIENT_ID"))?;
  let client_secret = env::var("DUDEREADER_GOOGLE_CLIENT_SECRET")
    .map_err(|_| anyhow!("Missing DUDEREADER_GOOGLE_CLIENT_SECRET"))?;

  Ok(BasicClient::new(
    ClientId::new(client_id),
    Some(ClientSecret::new(client_secret)),
    AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())?,
    Some(TokenUrl::new("https://oauth2.googleapis.com/token".to_string())?)
  ))
}

fn parse_code_from_request(buffer: &[u8], expected_state: &str) -> Option<String> {
  let request = String::from_utf8_lossy(buffer);
  let line = request.lines().next()?;
  let parts: Vec<&str> = line.split(' ').collect();
  if parts.len() < 2 {
    return None;
  }
  let path = parts[1];
  let query = path.split('?').nth(1)?;
  let mut code = None;
  let mut state = None;
  for pair in query.split('&') {
    let mut iter = pair.split('=');
    let key = iter.next()?;
    let value = iter.next().unwrap_or("");
    if key == "code" {
      code = Some(urlencoding::decode(value).ok()?.to_string());
    }
    if key == "state" {
      state = Some(urlencoding::decode(value).ok()?.to_string());
    }
  }
  if state.as_deref() != Some(expected_state) {
    return None;
  }
  code
}

fn respond(stream: &mut impl Write, body: &str) -> Result<()> {
  let response = format!(
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{}",
    body.len(),
    body
  );
  stream.write_all(response.as_bytes())?;
  Ok(())
}

async fn ensure_access_token(db_mutex: &std::sync::Mutex<Database>) -> Result<String> {
  let (access_token, refresh_token, expires_at) = {
    let db = db_mutex.lock().unwrap();
    (
      db.get_setting("drive_access_token")?,
      db.get_setting("drive_refresh_token")?,
      db.get_setting("drive_expires_at")?
    )
  };

  match (access_token, refresh_token, expires_at) {
    (Some(access), Some(refresh), Some(expiry)) => {
      let expiry_time = DateTime::parse_from_rfc3339(&expiry)?.with_timezone(&Utc);
      if expiry_time > Utc::now() + chrono::Duration::minutes(2) {
        return Ok(access);
      }
      let token = refresh_access_token(&refresh).await?;
      let mut db = db_mutex.lock().unwrap();
      db.set_setting("drive_access_token", &token.access_token)?;
      db.set_setting("drive_expires_at", &token.expires_at)?;
      Ok(token.access_token)
    }
    _ => Err(anyhow!("Drive not authenticated"))
  }
}

struct TokenBundle {
  access_token: String,
  expires_at: String
}

async fn refresh_access_token(refresh_token: &str) -> Result<TokenBundle> {
  let client_id = env::var("DUDEREADER_GOOGLE_CLIENT_ID")
    .map_err(|_| anyhow!("Missing DUDEREADER_GOOGLE_CLIENT_ID"))?;
  let client_secret = env::var("DUDEREADER_GOOGLE_CLIENT_SECRET")
    .map_err(|_| anyhow!("Missing DUDEREADER_GOOGLE_CLIENT_SECRET"))?;

  let client = reqwest::Client::new();
  let params = [
    ("client_id", client_id),
    ("client_secret", client_secret),
    ("refresh_token", refresh_token.to_string()),
    ("grant_type", "refresh_token".to_string())
  ];
  let response: serde_json::Value = client
    .post("https://oauth2.googleapis.com/token")
    .form(&params)
    .send()
    .await?
    .json()
    .await?;

  let access_token = response
    .get("access_token")
    .and_then(|v| v.as_str())
    .ok_or_else(|| anyhow!("missing access token"))?
    .to_string();
  let expires_in = response
    .get("expires_in")
    .and_then(|v| v.as_i64())
    .unwrap_or(3600);
  let expires_at = (Utc::now() + chrono::Duration::seconds(expires_in)).to_rfc3339();
  Ok(TokenBundle {
    access_token,
    expires_at
  })
}

async fn ensure_folder(client: &reqwest::Client, access_token: &str, name: &str, parent: &str) -> Result<String> {
  if let Some(existing) = find_folder(client, access_token, name, parent).await? {
    return Ok(existing.id);
  }

  let metadata = serde_json::json!({
    "name": name,
    "mimeType": "application/vnd.google-apps.folder",
    "parents": [parent]
  });

  let resp: DriveFile = client
    .post(format!("{}/files", DRIVE_API))
    .bearer_auth(access_token)
    .json(&metadata)
    .send()
    .await?
    .json()
    .await?;

  Ok(resp.id)
}

async fn find_folder(client: &reqwest::Client, access_token: &str, name: &str, parent: &str) -> Result<Option<DriveFile>> {
  let q = format!("name = '{}' and mimeType = 'application/vnd.google-apps.folder' and '{}' in parents and trashed = false", name, parent);
  let resp: FilesList = client
    .get(format!("{}/files", DRIVE_API))
    .bearer_auth(access_token)
    .query(&[("q", q), ("fields", "files(id,name,mimeType,modifiedTime)".to_string())])
    .send()
    .await?
    .json()
    .await?;
  Ok(resp.files.into_iter().next())
}

fn write_local_metadata(metadata: &SyncMetadata) -> Result<PathBuf> {
  let dir = storage::app_data_dir()?;
  fs::create_dir_all(&dir)?;
  let path = dir.join("metadata.json");
  let contents = serde_json::to_string_pretty(metadata)?;
  fs::write(&path, contents)?;
  Ok(path)
}

async fn download_metadata(client: &reqwest::Client, access_token: &str, parent: &str) -> Result<Option<SyncMetadata>> {
  let q = format!("name = 'metadata.json' and '{}' in parents and trashed = false", parent);
  let resp: FilesList = client
    .get(format!("{}/files", DRIVE_API))
    .bearer_auth(access_token)
    .query(&[("q", q), ("fields", "files(id,name,mimeType,modifiedTime)".to_string())])
    .send()
    .await?
    .json()
    .await?;
  let file = match resp.files.into_iter().next() {
    Some(file) => file,
    None => return Ok(None)
  };

  let bytes = client
    .get(format!("{}/files/{}", DRIVE_API, file.id))
    .bearer_auth(access_token)
    .query(&[("alt", "media")])
    .send()
    .await?
    .bytes()
    .await?;

  let metadata: SyncMetadata = serde_json::from_slice(&bytes)?;
  Ok(Some(metadata))
}

fn merge_metadata(local: SyncMetadata, remote: Option<SyncMetadata>) -> SyncMetadata {
  if remote.is_none() {
    return local;
  }
  let remote = remote.unwrap();
  let mut merged: HashMap<String, BookRecord> = HashMap::new();

  for book in local.books {
    merged.insert(book.id.clone(), book);
  }

  for book in remote.books {
    match merged.get(&book.id) {
      Some(existing) => {
        if book_timestamp(&book) > book_timestamp(existing) {
          merged.insert(book.id.clone(), book);
        }
      }
      None => {
        merged.insert(book.id.clone(), book);
      }
    }
  }

  SyncMetadata {
    last_updated: Utc::now().to_rfc3339(),
    books: merged.into_values().collect()
  }
}

fn book_timestamp(book: &BookRecord) -> i64 {
  let fallback = DateTime::parse_from_rfc3339(&book.created_at)
    .map(|dt| dt.timestamp())
    .unwrap_or(0);
  book
    .last_opened
    .as_ref()
    .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
    .map(|dt| dt.timestamp())
    .unwrap_or(fallback)
}

async fn upload_metadata(client: &reqwest::Client, access_token: &str, parent: &str, path: &Path) -> Result<()> {
  let file_bytes = fs::read(path)?;
  let q = format!("name = 'metadata.json' and '{}' in parents and trashed = false", parent);
  let existing: FilesList = client
    .get(format!("{}/files", DRIVE_API))
    .bearer_auth(access_token)
    .query(&[("q", q), ("fields", "files(id,name)".to_string())])
    .send()
    .await?
    .json()
    .await?;

  let metadata = serde_json::json!({
    "name": "metadata.json",
    "parents": [parent]
  });

  let form = reqwest::multipart::Form::new()
    .part("metadata", reqwest::multipart::Part::text(metadata.to_string()).mime_str("application/json")?)
    .part("file", reqwest::multipart::Part::bytes(file_bytes).mime_str("application/json")?);

  if let Some(file) = existing.files.into_iter().next() {
    client
      .patch(format!("{}/files/{}?uploadType=multipart", DRIVE_UPLOAD, file.id))
      .bearer_auth(access_token)
      .multipart(form)
      .send()
      .await?;
  } else {
    client
      .post(format!("{}/files?uploadType=multipart", DRIVE_UPLOAD))
      .bearer_auth(access_token)
      .multipart(form)
      .send()
      .await?;
  }
  Ok(())
}

async fn sync_books(
  client: &reqwest::Client,
  access_token: &str,
  folder_id: &str,
  metadata: &SyncMetadata,
  local_books: &[BookRecord]
) -> Result<Vec<BookRecord>> {
  let resp: FilesList = client
    .get(format!("{}/files", DRIVE_API))
    .bearer_auth(access_token)
    .query(&[
      ("q", format!("'{}' in parents and trashed = false", folder_id)),
      ("fields", "files(id,name,mimeType,modifiedTime)")
    ])
    .send()
    .await?
    .json()
    .await?;

  let mut downloaded = Vec::new();
  let local_by_hash: HashMap<String, BookRecord> = local_books
    .iter()
    .cloned()
    .map(|book| (book.file_hash.clone(), book))
    .collect();

  for book in &metadata.books {
    let filename = Path::new(&book.local_path)
      .file_name()
      .and_then(|v| v.to_str())
      .unwrap_or(&book.id)
      .to_string();

    let remote_file = resp.files.iter().find(|f| f.name == filename);

    if local_by_hash.contains_key(&book.file_hash) {
      continue;
    }

    if let Some(remote) = remote_file {
      let bytes = client
        .get(format!("{}/files/{}", DRIVE_API, remote.id))
        .bearer_auth(access_token)
        .query(&[("alt", "media")])
        .send()
        .await?
        .bytes()
        .await?;

      let dir = storage::books_dir()?;
      fs::create_dir_all(&dir)?;
      let destination = dir.join(&remote.name);
      fs::write(&destination, bytes)?;

      let mut new_book = book.clone();
      new_book.local_path = destination.to_string_lossy().to_string();
      downloaded.push(new_book);
    }
  }

  for book in &metadata.books {
    let filename = Path::new(&book.local_path)
      .file_name()
      .and_then(|v| v.to_str())
      .unwrap_or(&book.id)
      .to_string();

    let existing = resp.files.iter().find(|f| f.name == filename);
    if existing.is_none() {
      upload_book(client, access_token, folder_id, &book.local_path, &filename).await?;
    }
  }

  Ok(downloaded)
}

async fn upload_book(client: &reqwest::Client, access_token: &str, parent: &str, path: &str, name: &str) -> Result<()> {
  let bytes = fs::read(path)?;
  let metadata = serde_json::json!({
    "name": name,
    "parents": [parent]
  });
  let form = reqwest::multipart::Form::new()
    .part("metadata", reqwest::multipart::Part::text(metadata.to_string()).mime_str("application/json")?)
    .part("file", reqwest::multipart::Part::bytes(bytes).mime_str("application/octet-stream")?);

  client
    .post(format!("{}/files?uploadType=multipart", DRIVE_UPLOAD))
    .bearer_auth(access_token)
    .multipart(form)
    .send()
    .await?;
  Ok(())
}
