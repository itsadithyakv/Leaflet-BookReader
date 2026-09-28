use crate::comic;
use crate::db::{self, BookRecord, FocusSessionRecord};
use crate::habit;
use crate::pip;
use crate::formats::{self, Delivery};
use crate::metadata::{normalize, open_library, wikipedia};
use crate::storage;
use crate::sync::drive;
use crate::{AppState, OpenComic};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn import_books(
  paths: Vec<String>,
  state: State<'_, AppState>
) -> Result<Vec<BookRecord>, String> {
  let mut imported = Vec::new();

  for path in paths {
    let source = std::path::PathBuf::from(&path);
    // Importing a file the reader cannot open only defers the failure to the
    // moment the user tries to read it.
    if !formats::is_supported(&formats::extension_of(&source)) {
      continue;
    }
    let hash = {
      let source = source.clone();
      tauri::async_runtime::spawn_blocking(move || storage::hash_file(&source))
        .await
        .map_err(|e| format!("Import task failed: {e}"))?
        .map_err(|e| e.to_string())?
    };
    // A tombstoned row is a book the reader deleted, whose file is already
    // gone. Returning it would make re-importing a no-op for the 90 days the
    // tombstone lives, so it falls through and is imported afresh; the upsert
    // below clears `deleted_at`.
    if let Some(existing) = {
      let db = state.db.lock().unwrap();
      db.find_by_hash(&hash).map_err(|e| e.to_string())?
    } {
      if existing.deleted_at.is_none() {
        imported.push(existing);
        continue;
      }
    }

    let (stored, mut basic) = {
      let source = source.clone();
      let hash = hash.clone();
      tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<_> {
        let stored = storage::store_book_file(&source, &hash)?;
        let basic = storage::extract_basic_metadata(&stored)?;
        Ok((stored, basic))
      })
      .await
      .map_err(|e| format!("Import task failed: {e}"))?
      .map_err(|e| e.to_string())?
    };

    let filename = source
      .file_stem()
      .and_then(|v| v.to_str())
      .unwrap_or("Untitled")
      .to_string();

    let mut title = basic.title.take().unwrap_or_else(|| filename.clone());
    let mut author = basic.author.take();
    let genres = Vec::new();
    let cover_url = None;

    let normalized = normalize::normalize_query(&title, author.as_deref());
    if normalize::is_noisy_title(&title) && !normalized.title.trim().is_empty() {
      title = normalized.title.clone();
    }
    if author.is_none() {
      author = normalized.author.clone();
    }

    let book = BookRecord {
      id: hash.clone(),
      title,
      author,
      genres,
      cover_url,
      local_path: stored.to_string_lossy().to_string(),
      file_hash: hash,
      progress: 0.0,
      position: None,
      last_opened: None,
      created_at: db::now_iso(),
      metadata_checked_at: None,
      // A fresh import is the newest word on this book. Re-importing one that
      // was deleted elsewhere therefore wins the merge and brings it back,
      // rather than being undone on the next sync.
      metadata_updated_at: Some(db::now_iso()),
      progress_updated_at: Some(db::now_iso()),
      deleted_at: None,
      // The file was just written to disk, so it is here by construction.
      available: true
    };

    {
      let db = state.db.lock().unwrap();
      db.upsert_book(&book).map_err(|e| e.to_string())?;
    }

    imported.push(book);
  }

  Ok(imported)
}

#[tauri::command]
pub fn list_books(state: State<'_, AppState>) -> Result<Vec<BookRecord>, String> {
  let db = state.db.lock().unwrap();
  db.list_books().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn take_pending_open_paths(state: State<'_, AppState>) -> Vec<String> {
  std::mem::take(&mut *state.pending_open_paths.lock().unwrap())
}

#[tauri::command]
pub async fn refresh_metadata(book_id: String, state: State<'_, AppState>) -> Result<BookRecord, String> {
  let mut book = {
    let db = state.db.lock().unwrap();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };

  let normalized = normalize::normalize_query(&book.title, book.author.as_deref());
  if normalize::is_noisy_title(&book.title) && !normalized.title.trim().is_empty() {
    book.title = normalized.title.clone();
  }
  if book.author.is_none() {
    book.author = normalized.author.clone();
  }

  // Only a title that came from a file name (noisy) is replaced; a book's own
  // title and author, read from inside it, are the reader's and stay. A
  // match still fills in genres and the cover.
  let from_file_name = normalize::is_noisy_title(&book.title) || book.author.is_none();
  if let Ok(Some(meta)) = open_library::fetch_metadata(&normalized.title, normalized.author.as_deref(), normalized.isbn.as_deref()).await {
    if from_file_name {
      book.title = meta.title;
      if meta.author.is_some() {
        book.author = meta.author;
      }
    }
    book.genres = meta.subjects;
    if let Some(url) = meta.cover_url {
      if let Ok(path) = storage::store_cover(&url, &book.file_hash).await {
        book.cover_url = Some(path.to_string_lossy().to_string());
      }
    }
  }

  if book.author.is_none() {
    book.author = normalized.author.clone();
  }

  if book.cover_url.is_none() {
    if let Ok(Some(url)) = wikipedia::fetch_cover(&normalized.title, normalized.author.as_deref()).await {
      if let Ok(path) = storage::store_cover(&url, &book.file_hash).await {
        book.cover_url = Some(path.to_string_lossy().to_string());
      }
    }
  }

  book.metadata_checked_at = Some(db::now_iso());

  {
    let db = state.db.lock().unwrap();
    db.update_metadata(&book).map_err(|e| e.to_string())?;
  }

  Ok(book)
}

#[tauri::command]
pub async fn fetch_cover(book_id: String, state: State<'_, AppState>) -> Result<Option<BookRecord>, String> {
  let mut book = {
    let db = state.db.lock().unwrap();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };

  if book.cover_url.is_some() {
    return Ok(Some(book));
  }

  let normalized = normalize::normalize_query(&book.title, book.author.as_deref());
  if normalize::is_noisy_title(&book.title) && !normalized.title.trim().is_empty() {
    book.title = normalized.title.clone();
  }
  if book.author.is_none() {
    book.author = normalized.author.clone();
  }
  if let Ok(Some(meta)) = open_library::fetch_metadata(&normalized.title, normalized.author.as_deref(), normalized.isbn.as_deref()).await {
    if let Some(url) = meta.cover_url {
      if let Ok(path) = storage::store_cover(&url, &book.file_hash).await {
        book.cover_url = Some(path.to_string_lossy().to_string());
        let db = state.db.lock().unwrap();
        db.update_cover(&book.id, book.cover_url.clone())
          .map_err(|e| e.to_string())?;
        return Ok(Some(book));
      }
    }
  }

  if let Ok(Some(url)) = wikipedia::fetch_cover(&normalized.title, normalized.author.as_deref()).await {
    if let Ok(path) = storage::store_cover(&url, &book.file_hash).await {
      book.cover_url = Some(path.to_string_lossy().to_string());
      let db = state.db.lock().unwrap();
      db.update_cover(&book.id, book.cover_url.clone())
        .map_err(|e| e.to_string())?;
      return Ok(Some(book));
    }
  }

  Ok(None)
}

/// Async and off-thread: a sync command runs on the main thread, and reading
/// and encoding a large cover there stalls the window.
#[tauri::command]
pub async fn cover_data(
  book_id: String,
  state: State<'_, AppState>
) -> Result<Option<String>, String> {
  let book = {
    let db = state.db.lock().unwrap();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };

  let cover_url = match book.cover_url {
    Some(value) => value,
    None => return Ok(None)
  };

  tauri::async_runtime::spawn_blocking(move || {
    let bytes = std::fs::read(&cover_url).map_err(|e| e.to_string())?;
    // Covers are saved under a .jpg name whatever they actually are, so the
    // media type has to come from the bytes or PNG/WebP covers fail to decode.
    let mime = storage::sniff_image_mime(&bytes).unwrap_or("image/jpeg");
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!("data:{};base64,{}", mime, encoded)))
  })
  .await
  .map_err(|error| format!("Cover task failed: {error}"))?
}

/// Returns the file as a raw IPC body, which reaches JS as an ArrayBuffer.
/// Base64 through JSON cost four to five times the file in peak memory (the
/// encoded string, atob's binary string, then the byte copy), which put PDFs
/// of a few hundred megabytes out of reach.
#[tauri::command]
pub async fn read_book_bytes(
  book_id: String,
  state: State<'_, AppState>,
  app: AppHandle
) -> Result<tauri::ipc::Response, String> {
  let book = {
    let db = state.db.lock().unwrap();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };

  let source_path = std::path::PathBuf::from(&book.local_path);
  let ext = formats::extension_of(&source_path);

  let Some(format) = formats::lookup(&ext) else {
    return Err(format!(
      "Leaflet cannot open .{ext} files. Supported formats: {}.",
      formats::summary()
    ));
  };

  let file_hash = book.file_hash.clone();
  let app_handle = app.clone();
  let delivery = format.delivery;
  tauri::async_runtime::spawn_blocking(move || {
    // ensure_epub_version resolves a cached conversion before it looks for the
    // converter, so a book converted earlier still opens if Calibre was removed.
    let readable_path = match delivery {
      // A comic is far too large to hand over whole; it is paged through
      // comic_open / comic_page instead.
      Delivery::Comic => {
        return Err("Comics are read a page at a time, not loaded whole.".to_string())
      }
      Delivery::Pdf | Delivery::Epub => source_path,
      Delivery::Builtin | Delivery::Convert => {
        storage::ensure_epub_version(&source_path, &file_hash, Some(&app_handle))
          .map_err(|error| error.to_string())?
      }
    };

    let bytes = std::fs::read(&readable_path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
  })
  .await
  .map_err(|error| format!("Book reader task failed: {error}"))?
}

/// `position` is the exact place within the book (an EPUB CFI), `None` for
/// page-based books. Optional so a caller that only knows the percentage keeps
/// working.
#[tauri::command]
pub fn update_progress(
  book_id: String,
  progress: f32,
  last_opened: Option<String>,
  position: Option<String>,
  state: State<'_, AppState>
) -> Result<(), String> {
  let db = state.db.lock().unwrap();
  db.update_progress(&book_id, progress, last_opened, position)
    .map_err(|e| e.to_string())
}

/// Everything the UI needs to describe sync truthfully, including the cases the
/// old panel could not express: a build with no Google credentials, and a folder
/// transport that needs no account at all.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
  /// Drive is connected and has a usable refresh token.
  pub drive_connected: bool,
  /// Leaflet can talk to Google at all.
  pub drive_available: bool,
  /// Whether the OAuth client is shipped, entered by the reader, or absent — so
  /// the UI can offer to fix the absent case rather than only reporting it.
  pub drive_credential_source: drive::CredentialSource,
  pub expires_at: Option<String>,
  /// The real Google account, not the placeholder the app used to invent.
  pub account_email: Option<String>,
  /// The chosen sync folder, when folder sync is in use.
  pub folder_path: Option<String>,
  /// The Leaflet API, when cloud sync and the social features are in use.
  pub api_base: Option<String>,
  pub last_synced_at: Option<String>,
  /// Books in the library whose file is not on this device yet.
  pub books_pending: usize
}

pub const FOLDER_SETTING: &str = "sync_folder_path";
pub const LAST_SYNCED_SETTING: &str = "sync_last_synced_at";

fn read_sync_status(db: &db::Database) -> Result<SyncStatus, String> {
  let refresh = drive::load_refresh_token(db).map_err(|e| e.to_string())?;
  let pending = db
    .list_books()
    .map_err(|e| e.to_string())?
    .iter()
    .filter(|book| !crate::sync::store::is_available(&book.local_path))
    .count();
  Ok(SyncStatus {
    drive_connected: refresh.is_some(),
    drive_available: drive::credentials_present(db),
    drive_credential_source: drive::credential_source(db),
    expires_at: db
      .get_setting(drive::EXPIRES_SETTING)
      .map_err(|e| e.to_string())?
      .filter(|value| !value.is_empty()),
    account_email: db
      .get_setting(drive::ACCOUNT_SETTING)
      .map_err(|e| e.to_string())?
      .filter(|value| !value.is_empty()),
    folder_path: db
      .get_setting(FOLDER_SETTING)
      .map_err(|e| e.to_string())?
      .filter(|value| !value.is_empty()),
    api_base: crate::sync::cloud::api_base(db),
    last_synced_at: db
      .get_setting(LAST_SYNCED_SETTING)
      .map_err(|e| e.to_string())?
      .filter(|value| !value.is_empty()),
    books_pending: pending
  })
}

#[tauri::command]
pub fn sync_status(state: State<'_, AppState>) -> Result<SyncStatus, String> {
  let db = state.db.lock().unwrap();
  read_sync_status(&db)
}

#[tauri::command]
pub fn reading_stats(state: State<'_, AppState>) -> Result<db::ReadingStats, String> {
  let db = state.db.lock().unwrap();
  db.reading_stats().map_err(|e| e.to_string())
}

/// Opens the consent page in the *system* browser and returns the URL used.
///
/// The frontend used to call `window.open`, which at best lands in an embedded
/// webview — and Google refuses to run its sign-in there. Opening from the
/// backend is the only reliable path.
#[tauri::command]
pub fn drive_auth_start(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
  let credentials = {
    let db = state.db.lock().unwrap();
    drive::load_credentials(&db).ok_or_else(|| {
      "Drive sync needs a Google OAuth client. Add one in Settings, or use folder sync, \
       which needs nothing at all."
        .to_string()
    })?
  };
  let url = {
    let mut drive_state = state.drive.lock().unwrap();
    drive::auth_start(&mut drive_state, &credentials)
      .map_err(|e| e.to_string())?
      .url
  };
  tauri_plugin_opener::OpenerExt::opener(&app)
    .open_url(&url, None::<&str>)
    .map_err(|error| format!("Could not open your browser: {error}"))?;
  Ok(url)
}

#[tauri::command]
pub async fn drive_auth_wait(state: State<'_, AppState>) -> Result<(), String> {
  let pending = {
    let mut drive_state = state.drive.lock().unwrap();
    drive_state
      .take_pending()
      .ok_or_else(|| "Connect Drive was not started.".to_string())?
  };
  let credentials = {
    let db = state.db.lock().unwrap();
    drive::load_credentials(&db)
      .ok_or_else(|| "Drive credentials were removed mid-connection.".to_string())?
  };
  let tokens = drive::auth_wait(pending, &credentials)
    .await
    .map_err(|e| e.to_string())?;
  let db = state.db.lock().unwrap();
  db.set_setting(drive::ACCESS_SETTING, &tokens.access_token)
    .map_err(|e| e.to_string())?;
  db.set_setting(drive::EXPIRES_SETTING, &tokens.expires_at)
    .map_err(|e| e.to_string())?;
  // Goes to the OS keychain when one is available, not a plaintext column.
  drive::store_refresh_token(&db, &tokens.refresh_token).map_err(|e| e.to_string())?;
  Ok(())
}

/// Sets the Google OAuth client Leaflet presents.
///
/// Without this, Drive sync only works in a build that shipped credentials —
/// which left readers of every other build with a button that could only fail.
/// Anyone can create a free "Desktop app" client and paste it here.
#[tauri::command]
pub fn set_drive_credentials(
  client_id: String,
  client_secret: String,
  state: State<'_, AppState>
) -> Result<SyncStatus, String> {
  let trimmed_id = drive::validate_client_id(&client_id).map_err(|e| e.to_string())?;

  let db = state.db.lock().unwrap();
  drive::set_credentials(&db, &trimmed_id, client_secret.trim()).map_err(|e| e.to_string())?;
  // A different OAuth client cannot use tokens issued to the previous one.
  drive::clear_tokens(&db).map_err(|e| e.to_string())?;
  read_sync_status(&db)
}

#[tauri::command]
pub fn clear_drive_credentials(state: State<'_, AppState>) -> Result<SyncStatus, String> {
  let db = state.db.lock().unwrap();
  drive::clear_credentials(&db).map_err(|e| e.to_string())?;
  drive::clear_tokens(&db).map_err(|e| e.to_string())?;
  db.set_setting(drive::ACCOUNT_SETTING, "").map_err(|e| e.to_string())?;
  read_sync_status(&db)
}

#[tauri::command]
pub fn drive_disconnect(state: State<'_, AppState>) -> Result<SyncStatus, String> {
  let db = state.db.lock().unwrap();
  drive::clear_tokens(&db).map_err(|e| e.to_string())?;
  db.set_setting(drive::ACCOUNT_SETTING, "").map_err(|e| e.to_string())?;
  read_sync_status(&db)
}

/// Chooses the folder that carries sync, for readers whose own cloud client
/// already keeps a directory in step across their devices.
#[tauri::command]
pub fn set_sync_folder(path: Option<String>, state: State<'_, AppState>) -> Result<SyncStatus, String> {
  let db = state.db.lock().unwrap();
  let value = path.unwrap_or_default();
  if !value.is_empty() && !std::path::Path::new(&value).is_dir() {
    return Err("That folder does not exist.".to_string());
  }
  db.set_setting(FOLDER_SETTING, &value).map_err(|e| e.to_string())?;
  read_sync_status(&db)
}

/// Runs whichever transports are configured.
///
/// Both may be: a folder covers this machine's other desktops, Drive covers a
/// phone. They share the merge rules, so running both simply converges twice.
#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> Result<crate::sync::folder::SyncReport, String> {
  // One run at a time. Connecting Drive fires a sync from the auth flow and
  // another from the status change; run together, both found no `state.json`
  // and both created one, leaving devices to drift across two copies. A caller
  // that arrives mid-run waits and then converges against what the first wrote.
  let _running = state.sync_lock.lock().await;
  let now = db::now_iso();
  let (folder_path, drive_connected, cloud_signed_in) = {
    let db = state.db.lock().unwrap();
    (
      db.get_setting(FOLDER_SETTING)
        .map_err(|e| e.to_string())?
        .filter(|value| !value.is_empty()),
      drive::load_refresh_token(&db)
        .map_err(|e| e.to_string())?
        .is_some(),
      crate::sync::cloud::signed_in(&db)
    )
  };

  if folder_path.is_none() && !drive_connected {
    return Err("Sync is not set up yet. Connect Drive or choose a sync folder.".to_string());
  }

  let mut report = crate::sync::folder::SyncReport::default();

  if let Some(path) = folder_path {
    let db = state.db.lock().unwrap();
    let folder_report = crate::sync::folder::sync(&db, std::path::Path::new(&path), &now)
      .map_err(|e| e.to_string())?;
    report.merge_in(folder_report);
  }

  if drive_connected {
    let drive_report = drive::sync(&state.db, &now).await.map_err(|e| e.to_string())?;
    report.merge_in(drive_report);
  }

  // Runs last, for readers signed in to a Leaflet account. It carries no book
  // files, so it rides along with a folder or Drive rather than standing alone.
  // By this point the local state already holds everything the other
  // transports brought, so one round trip publishes the lot.
  if cloud_signed_in {
    let cloud_report = crate::sync::cloud::sync(&state.db, &now)
      .await
      .map_err(|e| e.to_string())?;
    report.merge_in(cloud_report);
    let _ = publish_profile(&state).await;
  }

  {
    let db = state.db.lock().unwrap();
    db.set_setting(LAST_SYNCED_SETTING, &now).map_err(|e| e.to_string())?;
  }
  Ok(report)
}

/// Fetches a book this device has an entry for but no file.
///
/// Book files are not pulled during sync: the shared document is kilobytes and
/// syncs instantly, while a library is gigabytes. Connecting a new device is
/// immediate, and the bytes arrive when a book is actually opened.
#[tauri::command]
pub async fn download_book(book_id: String, state: State<'_, AppState>) -> Result<String, String> {
  let (folder_path, drive_connected) = {
    let db = state.db.lock().unwrap();
    (
      db.get_setting(FOLDER_SETTING)
        .map_err(|e| e.to_string())?
        .filter(|value| !value.is_empty()),
      drive::load_refresh_token(&db)
        .map_err(|e| e.to_string())?
        .is_some()
    )
  };

  // A folder is on this machine already, so try it before the network.
  if let Some(path) = folder_path {
    let record = {
      let db = state.db.lock().unwrap();
      db.find_by_id(&book_id).map_err(|e| e.to_string())?
    };
    if let Some(record) = record {
      let entry = crate::sync::merge::BookEntry::from_record(&record);
      let source = std::path::Path::new(&path).join("books").join(entry.remote_name());
      if source.exists() {
        let destination = crate::sync::store::local_path_for(&entry).map_err(|e| e.to_string())?;
        if let Some(parent) = destination.parent() {
          std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(&source, &destination).map_err(|e| e.to_string())?;
        return Ok(destination.to_string_lossy().to_string());
      }
    }
  }

  if drive_connected {
    return drive::fetch_book(&state.db, &book_id).await.map_err(|e| e.to_string());
  }
  Err("That book is not on this device, and sync is not set up.".to_string())
}

/// Removes a book from the library on every device.
///
/// The row is tombstoned rather than dropped, so the removal can reach the other
/// devices instead of being undone by them on the next sync.
#[tauri::command]
pub fn delete_book(book_id: String, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.lock().unwrap();
  if let Some(book) = db.find_by_id(&book_id).map_err(|e| e.to_string())? {
    let _ = std::fs::remove_file(&book.local_path);
  }
  db.delete_book(&book_id, &db::now_iso()).map_err(|e| e.to_string())
}


// ---- social ----------------------------------------------------------------

use crate::sync::cloud;

/// The local dates of the ISO week containing `today`.
///
/// Minutes are ranked by week, and a reader's ledger is keyed to their *local*
/// day, so the window has to be computed from local dates rather than asked of
/// the server.
fn current_week_days(today_key: &str) -> Vec<String> {
  let Ok(today) = chrono::NaiveDate::parse_from_str(today_key, "%Y-%m-%d") else {
    return vec![today_key.to_string()];
  };
  // Monday, per ISO.
  let offset = chrono::Datelike::weekday(&today).num_days_from_monday() as i64;
  let monday = today - chrono::Duration::days(offset);
  (0..7)
    .map(|day| (monday + chrono::Duration::days(day)).format("%Y-%m-%d").to_string())
    .collect()
}

/// Builds what this reader publishes: the numbers the board ranks on, and the
/// shelf worth showing.
///
/// Derived here rather than on the server, which by design cannot read inside
/// the state document.
fn build_profile_update(db: &db::Database, today_key: &str) -> Result<cloud::ProfileUpdate, String> {
  let snapshot = build_snapshot(db, today_key)?;

  let week = current_week_days(today_key);
  let week_minutes: f64 = snapshot
    .days
    .iter()
    .filter(|day| week.contains(&day.date_key))
    .map(|day| day.minutes)
    .sum();

  let books_finished = db
    .list_books()
    .map_err(|e| e.to_string())?
    .iter()
    .filter(|book| book.progress >= 0.99)
    .count() as i64;

  // The most recent books still on the shelf -- a burned one is not something
  // to show off.
  let mut shelf: Vec<&FocusSessionRecord> = snapshot
    .sessions
    .iter()
    .filter(|session| session.burned_at.is_none())
    .collect();
  shelf.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));

  Ok(cloud::ProfileUpdate {
    week_key: Some(iso_week_key(today_key)),
    week_minutes: Some(week_minutes),
    streak: Some(snapshot.streak),
    books_finished: Some(books_finished),
    shelf: Some(
      shelf
        .into_iter()
        .take(12)
        .map(|session| cloud::ShelfBook {
          title: session.title.clone().unwrap_or_else(|| "Untitled".to_string()),
          author: None,
          style_seed: session.style_seed.clone()
        })
        .collect()
    ),
    ..cloud::ProfileUpdate::default()
  })
}

/// Pushes the ranked numbers after a sync.
///
/// Never fails a sync: a leaderboard that is briefly stale matters far less than
/// reading position that did not save.
async fn publish_profile(state: &State<'_, AppState>) -> Result<(), String> {
  let update = {
    let db = state.db.lock().unwrap();
    // Only for readers who chose to be seen; a private profile publishes nothing.
    let visibility = db
      .get_setting(cloud::PROFILE_VISIBILITY_SETTING)
      .map_err(|e| e.to_string())?
      .unwrap_or_default();
    if visibility != "public" {
      return Ok(());
    }
    build_profile_update(&db, &local_today())?
  };
  cloud::put_profile(&state.db, &update).await.map(|_| ()).map_err(|e| e.to_string())
}

fn iso_week_key(today_key: &str) -> String {
  cloud::iso_week_key(today_key)
}

/// The device's own date. Every habit figure is keyed to it.
fn local_today() -> String {
  chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Points the app at a Leaflet server. Empty turns cloud sync and social off.
#[tauri::command]
pub fn set_cloud_api(url: String, state: State<'_, AppState>) -> Result<SyncStatus, String> {
  let db = state.db.lock().unwrap();
  cloud::set_api_base(&db, &url).map_err(|e| e.to_string())?;
  read_sync_status(&db)
}

#[tauri::command]
pub async fn social_profile(state: State<'_, AppState>) -> Result<cloud::Profile, String> {
  cloud::get_profile(&state.db).await.map_err(|e| e.to_string())
}

/// Saves the parts of a profile the reader controls, and publishes the ranked
/// numbers alongside so the board is never a week behind the switch.
#[tauri::command]
pub async fn save_social_profile(
  handle: Option<String>,
  display_name: Option<String>,
  visibility: Option<String>,
  state: State<'_, AppState>
) -> Result<cloud::Profile, String> {
  let going_public = visibility.as_deref() == Some("public");

  let mut update = cloud::ProfileUpdate {
    handle,
    display_name,
    visibility: visibility.clone(),
    ..cloud::ProfileUpdate::default()
  };

  if going_public {
    let db = state.db.lock().unwrap();
    let stats = build_profile_update(&db, &local_today())?;
    update.week_key = stats.week_key;
    update.week_minutes = stats.week_minutes;
    update.streak = stats.streak;
    update.books_finished = stats.books_finished;
    update.shelf = stats.shelf;
  }

  cloud::put_profile(&state.db, &update).await.map_err(|e| e.to_string())?;

  if let Some(value) = visibility {
    let db = state.db.lock().unwrap();
    db.set_setting(cloud::PROFILE_VISIBILITY_SETTING, &value)
      .map_err(|e| e.to_string())?;
  }

  cloud::get_profile(&state.db).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn social_leaderboard(state: State<'_, AppState>) -> Result<cloud::Leaderboard, String> {
  cloud::leaderboard(&state.db, &iso_week_key(&local_today()))
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn social_profile_by_handle(
  handle: String,
  state: State<'_, AppState>
) -> Result<cloud::Profile, String> {
  cloud::profile_by_handle(&state.db, &handle)
    .await
    .map_err(|e| e.to_string())
}

// ---- community -------------------------------------------------------------
//
// The interactive board: follows, kudos, weekly duels, the inbox and search.
// Each passes the server's JSON straight through (shapes live in
// `socialService.ts`). The week and day are the device's own, so a reader far
// from UTC competes in the week they are actually living in.

use cloud::CommunityAuth;
use reqwest::Method;

async fn community(
  state: &State<'_, AppState>,
  method: Method,
  path: String,
  query: Vec<(&str, String)>,
  body: Option<serde_json::Value>,
  auth: CommunityAuth
) -> Result<serde_json::Value, String> {
  let query: Vec<(&str, &str)> = query.iter().map(|(key, value)| (*key, value.as_str())).collect();
  cloud::community_call(&state.db, method, &path, &query, body, auth)
    .await
    .map_err(|e| e.to_string())
}

/// This week's board: `everyone` (public; marks you when signed in) or
/// `following` (you and the readers you follow).
#[tauri::command]
pub async fn community_leaderboard(
  scope: Option<String>,
  state: State<'_, AppState>
) -> Result<serde_json::Value, String> {
  let following = scope.as_deref() == Some("following");
  let week = iso_week_key(&local_today());
  let auth = if following { CommunityAuth::Required } else { CommunityAuth::Optional };
  let scope = if following { "following" } else { "everyone" };
  community(
    &state,
    Method::GET,
    "/v1/leaderboard".into(),
    vec![("week", week), ("scope", scope.to_string())],
    None,
    auth
  )
  .await
}

/// A reader's card: their public profile, plus how you two stand when signed in.
#[tauri::command]
pub async fn community_profile(handle: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let today = local_today();
  community(
    &state,
    Method::GET,
    format!("/v1/profile/{}", cloud::handle_segment(&handle)),
    vec![("week", iso_week_key(&today)), ("day", today)],
    None,
    CommunityAuth::Optional
  )
  .await
}

#[tauri::command]
pub async fn community_follow(
  handle: String,
  follow: bool,
  state: State<'_, AppState>
) -> Result<serde_json::Value, String> {
  let method = if follow { Method::POST } else { Method::DELETE };
  community(
    &state,
    method,
    format!("/v1/follows/{}", cloud::handle_segment(&handle)),
    vec![],
    None,
    CommunityAuth::Required
  )
  .await
}

#[tauri::command]
pub async fn community_following(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  community(&state, Method::GET, "/v1/follows".into(), vec![], None, CommunityAuth::Required).await
}

/// A leaf of kudos, once per reader per local day.
#[tauri::command]
pub async fn community_kudos(handle: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let today = local_today();
  let body = serde_json::json!({ "dayKey": today, "weekKey": iso_week_key(&today) });
  community(
    &state,
    Method::POST,
    format!("/v1/kudos/{}", cloud::handle_segment(&handle)),
    vec![],
    Some(body),
    CommunityAuth::Required
  )
  .await
}

/// Challenges a reader to a duel for this (local) week.
#[tauri::command]
pub async fn community_challenge(handle: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let body = serde_json::json!({
    "handle": handle.trim().trim_start_matches('@').to_lowercase(),
    "weekKey": iso_week_key(&local_today())
  });
  community(&state, Method::POST, "/v1/duels".into(), vec![], Some(body), CommunityAuth::Required).await
}

#[tauri::command]
pub async fn community_respond_duel(
  id: String,
  accept: bool,
  state: State<'_, AppState>
) -> Result<serde_json::Value, String> {
  if id.len() != 24 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
    return Err("No such duel.".to_string());
  }
  let action = if accept { "accept" } else { "decline" };
  community(
    &state,
    Method::POST,
    format!("/v1/duels/{id}/{action}"),
    vec![],
    None,
    CommunityAuth::Required
  )
  .await
}

#[tauri::command]
pub async fn community_duels(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  community(&state, Method::GET, "/v1/duels".into(), vec![], None, CommunityAuth::Required).await
}

/// New followers, kudos, duel news. `since` is an ISO time; omitted means all.
#[tauri::command]
pub async fn community_inbox(since: Option<String>, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let query = since
    .filter(|value| !value.is_empty())
    .map(|value| vec![("since", value)])
    .unwrap_or_default();
  community(&state, Method::GET, "/v1/inbox".into(), query, None, CommunityAuth::Required).await
}

/// Public readers whose handle starts with `query`.
#[tauri::command]
pub async fn community_search(query: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  community(
    &state,
    Method::GET,
    "/v1/search".into(),
    vec![("q", query.trim().to_string()), ("week", iso_week_key(&local_today()))],
    None,
    CommunityAuth::Optional
  )
  .await
}

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
const STORE_REVIEW_URL: &str = "ms-windows-store://review/?ProductId=9PH0NLGJFF9W";

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicInfo {
  pub page_count: usize
}

/// Indexes a comic archive and caches its page order until `comic_close`.
///
/// The archive work runs off the main thread: listing a large CBZ/CBR would
/// otherwise freeze the window while the reader opens.
#[tauri::command]
pub async fn comic_open(book_id: String, state: State<'_, AppState>) -> Result<ComicInfo, String> {
  let book = {
    let db = state.db.lock().unwrap();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };

  let pages = tauri::async_runtime::spawn_blocking(move || {
    comic::list_pages(std::path::Path::new(&book.local_path))
      .map_err(|error| format!("Leaflet could not read this comic: {error}"))
  })
  .await
  .map_err(|error| format!("Comic task failed: {error}"))??;
  let page_count = pages.len();
  let mut open = state.comic_pages.lock().unwrap();
  let entry = open
    .entry(book_id)
    .or_insert_with(|| OpenComic { pages: Vec::new(), readers: 0 });
  // Freshly listed, so a file replaced since the last open is paged correctly.
  entry.pages = pages;
  entry.readers += 1;
  Ok(ComicInfo { page_count })
}

/// Releases one reader's hold on a comic's page index; the index is dropped
/// with the last one, so closed comics do not accumulate for the session.
#[tauri::command]
pub fn comic_close(book_id: String, state: State<'_, AppState>) {
  let mut open = state.comic_pages.lock().unwrap();
  if let Some(entry) = open.get_mut(&book_id) {
    entry.readers = entry.readers.saturating_sub(1);
    if entry.readers == 0 {
      open.remove(&book_id);
    }
  }
}

/// One page as a data URL. Pages are served individually because a comic is far
/// too large to hand to the webview in one piece.
/// Async for the same reason as `comic_open`: every page turn decompresses an
/// image, which must not block the main thread.
#[tauri::command]
pub async fn comic_page(
  book_id: String,
  index: usize,
  state: State<'_, AppState>
) -> Result<String, String> {
  let entry = {
    let cache = state.comic_pages.lock().unwrap();
    let comic = cache
      .get(&book_id)
      .ok_or_else(|| "This comic is not open.".to_string())?;
    comic
      .pages
      .get(index)
      .cloned()
      .ok_or_else(|| format!("This comic has no page {}.", index + 1))?
  };

  let book = {
    let db = state.db.lock().unwrap();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };

  tauri::async_runtime::spawn_blocking(move || {
    let bytes = comic::read_page(std::path::Path::new(&book.local_path), &entry)
      .map_err(|error| format!("Leaflet could not read page {}: {error}", index + 1))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{}", comic::mime_for(&entry), encoded))
  })
  .await
  .map_err(|error| format!("Comic task failed: {error}"))?
}

// ---------------------------------------------------------------------------
// Habit: the daily ledger, the streak, and the shelf.
//
// Every command takes the caller's *local* `date_key`. The old streak computed
// `Utc::now()` here and disagreed with the UI by a day near midnight.
// ---------------------------------------------------------------------------

const GOAL_SETTING: &str = "habit_goal_minutes";
const STREAK_SETTING: &str = "habit_streak_state";
const DEFAULT_GOAL_MINUTES: i64 = 20;

pub(crate) fn read_goal(db: &db::Database) -> i64 {
  db.get_setting(GOAL_SETTING)
    .ok()
    .flatten()
    .and_then(|value| value.parse::<i64>().ok())
    .filter(|minutes| *minutes > 0)
    .unwrap_or(DEFAULT_GOAL_MINUTES)
}

pub(crate) fn read_streak_state(db: &db::Database) -> habit::StreakState {
  db.get_setting(STREAK_SETTING)
    .ok()
    .flatten()
    .and_then(|value| serde_json::from_str(&value).ok())
    .unwrap_or_default()
}

fn write_streak_state(db: &db::Database, state: &habit::StreakState) -> Result<(), String> {
  let encoded = serde_json::to_string(state).map_err(|e| e.to_string())?;
  db.set_setting(STREAK_SETTING, &encoded).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitSnapshot {
  pub streak: i64,
  pub longest_streak: i64,
  pub freezes: i64,
  pub grace_available: bool,
  pub goal_minutes: i64,
  pub today_minutes: f64,
  pub today_met: bool,
  pub days: Vec<habit::DayRecord>,
  pub sessions: Vec<FocusSessionRecord>,
  pub shelf_count: i64,
  pub peak_shelf: i64,
  /// Set on the evaluation that detects a break, so the UI can explain it once.
  pub broke_from: Option<i64>,
  /// Ids burned by *this* evaluation. Empty on every later call, so replaying
  /// the snapshot cannot replay the fire.
  pub just_burned: Vec<String>,
  /// Every seed ever earned (see `habit::seeds`). The wrap-up shows the
  /// difference a session made; the balance is on `pip_wallet`.
  pub seeds_earned: i64,
  /// All the water reading has poured on Pip's garden, and how many plants
  /// are ripe to pick: the wrap-up's "+N water, 2 plants ripe!".
  pub garden_water: f64,
  pub garden_ripe: i64
}

fn build_snapshot(db: &db::Database, today_key: &str) -> Result<HabitSnapshot, String> {
  let goal_minutes = read_goal(db);
  let previous = read_streak_state(db);
  let days = db.reading_days().map_err(|e| e.to_string())?;

  let evaluation = habit::evaluate(&days, today_key, &previous);

  // Persist the covers the walk decided to spend, so the same gap is never
  // charged twice.
  for (date_key, kind) in &evaluation.covers {
    db.apply_cover(date_key, *kind, goal_minutes)
      .map_err(|e| e.to_string())?;
  }

  let mut state = evaluation.state.clone();
  let mut just_burned = Vec::new();
  if evaluation.burn_count > 0 {
    just_burned = db
      .burn_recent_sessions(evaluation.burn_count, &db::now_iso())
      .map_err(|e| e.to_string())?;
  }

  let shelf_count = db.unburned_session_count().map_err(|e| e.to_string())?;
  state.peak_shelf = state.peak_shelf.max(shelf_count);
  write_streak_state(db, &state)?;

  let day_map = db.reading_days().map_err(|e| e.to_string())?;
  let sessions = db.focus_sessions().map_err(|e| e.to_string())?;
  let (garden, seeds_earned) = garden_totals(db, &day_map, &sessions)?;
  let mut day_list: Vec<habit::DayRecord> = day_map.into_values().collect();
  day_list.sort_by(|a, b| a.date_key.cmp(&b.date_key));

  Ok(HabitSnapshot {
    streak: evaluation.streak,
    longest_streak: state.longest_streak,
    freezes: state.freezes,
    grace_available: state.grace_available,
    goal_minutes,
    today_minutes: evaluation.today_minutes,
    today_met: evaluation.today_met,
    days: day_list,
    sessions,
    shelf_count,
    peak_shelf: state.peak_shelf,
    broke_from: evaluation.broke_from,
    just_burned,
    seeds_earned,
    garden_water: garden.water,
    garden_ripe: garden.ripe_count()
  })
}

/// Evaluates the streak and returns everything the habit UI needs. Lazy by
/// design: the app may be closed for days, so a break is discovered on open
/// rather than by a timer that was never running.
#[tauri::command]
pub fn habit_snapshot(today_key: String, state: State<'_, AppState>) -> Result<HabitSnapshot, String> {
  let db = state.db.lock().unwrap();
  build_snapshot(&db, &today_key)
}

/// Adds reading time to today and re-evaluates. Called by the reader heartbeat.
#[tauri::command]
pub fn credit_reading_minutes(
  date_key: String,
  minutes: f64,
  state: State<'_, AppState>
) -> Result<HabitSnapshot, String> {
  let db = state.db.lock().unwrap();
  if minutes > 0.0 {
    let goal = read_goal(&db);
    db.credit_minutes(&date_key, minutes, goal)
      .map_err(|e| e.to_string())?;
  }
  build_snapshot(&db, &date_key)
}

#[tauri::command]
pub fn set_habit_goal(minutes: i64, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.lock().unwrap();
  db.set_setting(GOAL_SETTING, &minutes.clamp(1, 600).to_string())
    .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSessionInput {
  pub id: String,
  pub started_at: String,
  pub ended_at: String,
  pub date_key: String,
  pub minutes: f64,
  pub book_id: Option<String>,
  pub title: Option<String>,
  pub ended_reason: String,
  pub clean: bool
}

/// Records that a focus session happened. Note this does *not* credit minutes:
/// the reader heartbeat is the only source of ledger time, so a timer you
/// started but did not read through earns nothing.
#[tauri::command]
pub fn record_focus_session(
  session: FocusSessionInput,
  state: State<'_, AppState>
) -> Result<HabitSnapshot, String> {
  let db = state.db.lock().unwrap();
  let record = FocusSessionRecord {
    // The seed drives every shelf decoration, replacing the stored style blob.
    style_seed: session.id.clone(),
    id: session.id,
    started_at: session.started_at,
    ended_at: session.ended_at,
    date_key: session.date_key.clone(),
    minutes: session.minutes.max(0.0),
    book_id: session.book_id,
    title: session.title,
    notes: None,
    ended_reason: session.ended_reason,
    clean: session.clean,
    burned_at: None
  };
  let is_new = !db.focus_session_exists(&record.id).map_err(|e| e.to_string())?;
  db.insert_focus_session(&record).map_err(|e| e.to_string())?;
  // Reading cheers Pip up. Once per session (a retried call is not a second
  // session), and not for a mis-tapped timer.
  if is_new && record.minutes >= 1.0 {
    cheer_pip(&db, habit::seeds::MOOD_PER_SESSION)?;
  }
  build_snapshot(&db, &session.date_key)
}

#[tauri::command]
pub fn add_focus_note(id: String, notes: String, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.lock().unwrap();
  db.add_session_note(&id, &notes).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyHabitImport {
  pub goal_minutes: Option<i64>,
  pub days: Vec<habit::DayRecord>,
  pub sessions: Vec<FocusSessionInput>
}

/// One-time move of the old `leaflet.habit` localStorage blob into the database.
/// Idempotent: days are credited only when absent and sessions conflict on id.
#[tauri::command]
pub fn import_legacy_habit(
  payload: LegacyHabitImport,
  today_key: String,
  state: State<'_, AppState>
) -> Result<HabitSnapshot, String> {
  let db = state.db.lock().unwrap();

  if let Some(goal) = payload.goal_minutes.filter(|value| *value > 0) {
    let _ = db.set_setting(GOAL_SETTING, &goal.clamp(1, 600).to_string());
  }
  let goal = read_goal(&db);

  let existing = db.reading_days().map_err(|e| e.to_string())?;
  for day in payload.days {
    if existing.contains_key(&day.date_key) {
      continue;
    }
    let day_goal = if day.goal_minutes > 0 { day.goal_minutes } else { goal };
    db.credit_minutes(&day.date_key, day.minutes, day_goal)
      .map_err(|e| e.to_string())?;
  }

  for session in payload.sessions {
    let record = FocusSessionRecord {
      style_seed: session.id.clone(),
      id: session.id,
      started_at: session.started_at,
      ended_at: session.ended_at,
      date_key: session.date_key,
      minutes: session.minutes.max(0.0),
      book_id: session.book_id,
      title: session.title,
      notes: None,
      ended_reason: session.ended_reason,
      clean: session.clean,
      burned_at: None
    };
    db.insert_focus_session(&record).map_err(|e| e.to_string())?;
  }

  build_snapshot(&db, &today_key)
}

/// Whether opening this book is blocked on installing the converter.
///
/// False for native formats, and false when a conversion is already cached —
/// the app used to demand a ~200 MB download to reopen a book it had already
/// converted, purely because the Calibre install had moved.
#[tauri::command]
pub fn needs_converter(
  book_id: String,
  state: State<'_, AppState>,
  app: AppHandle
) -> Result<bool, String> {
  let book = {
    let db = state.db.lock().unwrap();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };

  let source = std::path::PathBuf::from(&book.local_path);
  let Some(format) = formats::lookup(&formats::extension_of(&source)) else {
    return Ok(false);
  };
  if !format.delivery.needs_external_converter() {
    return Ok(false);
  }

  let already_converted = storage::converted_epub_path(&book.file_hash)
    .map(|path| path.exists())
    .unwrap_or(false);
  if already_converted {
    return Ok(false);
  }

  Ok(!storage::converter_installed(&app))
}

/// Lets the frontend build its file dialog and copy from the same table the
/// backend enforces.
#[tauri::command]
pub fn supported_formats() -> Vec<formats::Format> {
  formats::FORMATS.to_vec()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConverterInfo {
  pub installed: bool,
  /// Set when an existing Calibre was discovered, so the UI can say where.
  pub path: Option<String>,
  /// False on platforms where Leaflet cannot fetch Calibre for the user.
  pub can_auto_install: bool
}

#[tauri::command]
pub fn converter_status(app: AppHandle) -> Result<ConverterInfo, String> {
  let path = storage::converter_path(&app);
  Ok(ConverterInfo {
    installed: path.is_some(),
    path: path.map(|value| value.to_string_lossy().to_string()),
    can_auto_install: storage::can_auto_install_converter()
  })
}

/// Fetches Calibre. Desktop only: there is no Android build of it, and the
/// whole download-and-unpack path is compiled out of the mobile binary.
#[tauri::command]
pub async fn install_converter(app: AppHandle) -> Result<bool, String> {
  #[cfg(desktop)]
  {
    storage::install_converter(&app)
      .await
      .map(|_| true)
      .map_err(|e| e.to_string())
  }
  #[cfg(not(desktop))]
  {
    let _ = app;
    Err("The book converter is only available on desktop.".to_string())
  }
}

#[tauri::command]
pub fn clear_all_data(state: State<'_, AppState>) -> Result<(), String> {
  {
    let db = state.db.lock().unwrap();
    // The refresh token lives in the OS keychain now, so clearing the settings
    // table is no longer enough to leave nothing behind.
    let _ = drive::clear_tokens(&db);
    // The Leaflet session token is in the keychain too. The account itself
    // stays on the server; this only signs this device out.
    cloud::clear_session(&db);
    db.clear_all().map_err(|e| e.to_string())?;
  }

  if let Ok(dir) = storage::books_dir() {
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::create_dir_all(&dir);
  }
  if let Ok(dir) = storage::covers_dir() {
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::create_dir_all(&dir);
  }

  Ok(())
}

// ---- Pip's shop and garden ------------------------------------------------
//
// Reading waters Pip's garden; ripe plants are harvested for seeds; seeds are
// spent here. None of it is stored as a number: `pip_ledger` replays the
// records (reading, plantings, harvests, purchases) every time. The frontend
// names what to buy or plant; Rust decides the price, from the catalogue
// compiled into the binary (`pip::Catalogue`).

/// Everything the economy is derived from, read once.
struct PipLedger {
  purchases: Vec<pip::Purchase>,
  garden: habit::seeds::Garden,
  earned: habit::seeds::SeedEarnings,
  /// Focus sessions done, for floors that open after so many.
  sessions_done: i64
}

impl PipLedger {
  fn balance(&self) -> i64 {
    self.earned.total - pip::spent(&self.purchases)
  }
}

fn session_inputs(sessions: &[FocusSessionRecord]) -> Vec<habit::seeds::SessionSeeds<'_>> {
  sessions
    .iter()
    .map(|session| habit::seeds::SessionSeeds {
      id: &session.id,
      ended_at: &session.ended_at,
      ended_at_ms: millis(&session.ended_at),
      date_key: &session.date_key,
      minutes: session.minutes,
      completed_clean: session.ended_reason == "completed" && session.clean
    })
    .collect()
}

/// Grows the garden from the reading and the plantings on record.
fn grow_garden(
  days: &std::collections::HashMap<String, habit::DayRecord>,
  sessions: &[FocusSessionRecord],
  plantings: &[pip::Planting],
  harvests: &[pip::Harvest]
) -> habit::seeds::Garden {
  let catalogue = pip::Catalogue::bundled();
  let inputs = session_inputs(sessions);
  let drops = habit::seeds::water_drops(days, &inputs);
  let plants: Vec<habit::seeds::PlantingIn<'_>> = plantings
    .iter()
    .map(|planting| {
      let item = catalogue.get("plant", &planting.plant);
      habit::seeds::PlantingIn {
        id: &planting.id,
        plot: planting.plot,
        plant: &planting.plant,
        planted_at_ms: millis(&planting.planted_at),
        // A plant since dropped from the catalogue still grows, slowly, and
        // pays nothing more than its record says.
        need: item.map(|item| item.water).filter(|water| *water > 0.0).unwrap_or(600.0),
        yield_seeds: item.map(|item| item.yield_seeds).unwrap_or(0)
      }
    })
    .collect();
  let picked: Vec<habit::seeds::HarvestIn<'_>> = harvests
    .iter()
    .map(|harvest| habit::seeds::HarvestIn { id: &harvest.id, planting_id: &harvest.planting_id, seeds: harvest.seeds })
    .collect();
  habit::seeds::grow(&drops, &plants, &picked)
}

fn pip_ledger(db: &db::Database) -> Result<PipLedger, String> {
  let days = db.reading_days().map_err(|e| e.to_string())?;
  let sessions = db.focus_sessions().map_err(|e| e.to_string())?;
  let plantings = db.pip_plantings().map_err(|e| e.to_string())?;
  let harvests = db.pip_harvests().map_err(|e| e.to_string())?;
  let garden = grow_garden(&days, &sessions, &plantings, &harvests);
  let earned = habit::seeds::earnings(&days, &session_inputs(&sessions), garden.harvested);
  let sessions_done = sessions.iter().filter(|session| session.minutes >= 1.0).count() as i64;
  Ok(PipLedger {
    purchases: db.pip_purchases().map_err(|e| e.to_string())?,
    garden,
    earned,
    sessions_done
  })
}

/// The garden's headline numbers, for the habit snapshot (the wrap-up shows
/// the water a session poured and what ripened).
fn garden_totals(
  db: &db::Database,
  days: &std::collections::HashMap<String, habit::DayRecord>,
  sessions: &[FocusSessionRecord]
) -> Result<(habit::seeds::Garden, i64), String> {
  let plantings = db.pip_plantings().map_err(|e| e.to_string())?;
  let harvests = db.pip_harvests().map_err(|e| e.to_string())?;
  let garden = grow_garden(days, sessions, &plantings, &harvests);
  let earned = habit::seeds::earnings(days, &session_inputs(sessions), garden.harvested);
  Ok((garden, earned.total))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipWallet {
  /// Earned minus spent. Never shown below zero: two devices spending the same
  /// seeds offline can overdraw it after a sync, and reading refills it.
  pub balance: i64,
  pub earned: habit::seeds::SeedEarnings,
  pub spent: i64
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipOwned {
  pub kind: String,
  pub id: String
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GardenView {
  /// Plots the garden has (free ones plus bought ones).
  pub plots: i64,
  pub plants: Vec<habit::seeds::PlantState>,
  /// Water waiting in the rain barrel, and the barrel's size.
  pub barrel: f64,
  pub barrel_cap: f64,
  /// All the water reading has poured.
  pub water: f64
}

/// Everything the Pip tab shows: the wallet, what Pip owns, the garden, and
/// Pip's state with the mood as of now.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipOverview {
  pub wallet: PipWallet,
  pub owned: Vec<PipOwned>,
  pub state: pip::PipState,
  pub garden: GardenView,
  /// Focus sessions done, for floors that open after so many.
  pub sessions_done: i64,
  /// Best arcade scores, and how much mood games gave today.
  pub arcade: pip::Arcade
}

/// Arcade scores are this device's alone (a settings row, not the backup):
/// they are a pastime, and nothing is bought with them.
const ARCADE_SETTING: &str = "pip.arcade";

fn read_arcade(db: &db::Database) -> pip::Arcade {
  db.get_setting(ARCADE_SETTING)
    .ok()
    .flatten()
    .and_then(|value| serde_json::from_str(&value).ok())
    .unwrap_or_default()
}

fn millis(value: &str) -> i64 {
  chrono::DateTime::parse_from_rfc3339(value)
    .map(|at| at.timestamp_millis())
    .unwrap_or(0)
}

/// The saved state, created on first use so the mood has a clock to drift from.
fn stored_pip_state(db: &db::Database) -> Result<pip::PipState, String> {
  if let Some(state) = db.pip_state().map_err(|e| e.to_string())? {
    return Ok(state);
  }
  let mut fresh = pip::PipState::fresh(&db::now_iso());
  fresh.room = pip::starter_room(pip::Catalogue::bundled());
  db.put_pip_state(&fresh).map_err(|e| e.to_string())?;
  Ok(fresh)
}

/// Raises Pip's mood from wherever it has drifted to by now.
fn cheer_pip(db: &db::Database, gain: f64) -> Result<(), String> {
  let mut state = stored_pip_state(db)?;
  let now = db::now_iso();
  let current = habit::seeds::mood_at(state.mood, millis(&state.mood_updated_at), millis(&now));
  state.mood = habit::seeds::mood_plus(current, gain);
  state.mood_updated_at = now.clone();
  state.updated_at = now;
  db.put_pip_state(&state).map_err(|e| e.to_string())
}

fn pip_overview(db: &db::Database) -> Result<PipOverview, String> {
  let ledger = pip_ledger(db)?;
  let owned_set = pip::owned(pip::Catalogue::bundled(), &ledger.purchases);
  let plots = pip::plot_count(&owned_set);
  let owned = owned_set.into_iter().map(|(kind, id)| PipOwned { kind, id }).collect();
  let mut state = stored_pip_state(db)?;
  // Reported as of now; stored only when something changes it.
  state.mood = habit::seeds::mood_at(
    state.mood,
    millis(&state.mood_updated_at),
    chrono::Utc::now().timestamp_millis()
  );
  let balance = ledger.balance();
  let spent = pip::spent(&ledger.purchases);
  Ok(PipOverview {
    wallet: PipWallet { balance: balance.max(0), earned: ledger.earned, spent },
    owned,
    state,
    garden: GardenView {
      plots,
      barrel: ledger.garden.barrel,
      barrel_cap: habit::seeds::BARREL_CAP,
      water: ledger.garden.water,
      plants: ledger.garden.plants
    },
    sessions_done: ledger.sessions_done,
    arcade: read_arcade(db)
  })
}

/// Seeds: the balance and where it came from.
#[tauri::command]
pub fn pip_wallet(state: State<'_, AppState>) -> Result<PipWallet, String> {
  let db = state.db.lock().unwrap();
  let ledger = pip_ledger(&db)?;
  Ok(PipWallet {
    balance: ledger.balance().max(0),
    spent: pip::spent(&ledger.purchases),
    earned: ledger.earned
  })
}

#[tauri::command]
pub fn pip_state_get(state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.lock().unwrap();
  pip_overview(&db)
}

/// Buys a thing Pip keeps (anything but food and seed packets). The price is
/// the catalogue's, checked against the balance under the database lock, so
/// two quick taps cannot both spend the same seeds.
#[tauri::command]
pub fn pip_buy(kind: String, id: String, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.lock().unwrap();
  let catalogue = pip::Catalogue::bundled();
  let ledger = pip_ledger(&db)?;
  let owned = pip::owned(catalogue, &ledger.purchases);
  let item = pip::check_buy(catalogue, &owned, ledger.balance(), ledger.sessions_done, &kind, &id)
    .map_err(|e| e.to_string())?;
  db.insert_pip_purchase(&pip::Purchase {
    id: pip::new_purchase_id(),
    item_kind: item.kind.clone(),
    item_id: item.id.clone(),
    price: item.price,
    bought_at: db::now_iso()
  })
  .map_err(|e| e.to_string())?;
  pip_overview(&db)
}

/// Dresses Pip, arranges the house, or picks the signature move. Only owned
/// things are accepted; the mood is left alone.
#[tauri::command]
pub fn pip_state_set(look: pip::PipLook, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.lock().unwrap();
  let catalogue = pip::Catalogue::bundled();
  let purchases = db.pip_purchases().map_err(|e| e.to_string())?;
  pip::check_look(catalogue, &pip::owned(catalogue, &purchases), &look)?;
  let mut saved = stored_pip_state(&db)?;
  saved.variant = look.variant;
  saved.outfit = look.outfit;
  saved.room = look.room;
  saved.room_style = look.room_style;
  saved.signature = look.signature;
  saved.updated_at = db::now_iso();
  db.put_pip_state(&saved).map_err(|e| e.to_string())?;
  pip_overview(&db)
}

/// Gives Pip a treat: food is bought on the spot (a purchase per bite), a toy
/// must already be Pip's. Either way the mood goes up by the treat's amount.
#[tauri::command]
pub fn pip_feed(treat_id: String, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.lock().unwrap();
  let catalogue = pip::Catalogue::bundled();
  let ledger = pip_ledger(&db)?;
  let owned = pip::owned(catalogue, &ledger.purchases);
  let (treat, cost) =
    pip::check_give(catalogue, &owned, ledger.balance(), &treat_id).map_err(|e| e.to_string())?;
  if cost > 0 {
    db.insert_pip_purchase(&pip::Purchase {
      id: pip::new_purchase_id(),
      item_kind: "treat".to_string(),
      item_id: treat.id.clone(),
      price: cost,
      bought_at: db::now_iso()
    })
    .map_err(|e| e.to_string())?;
  }
  cheer_pip(&db, treat.mood)?;
  pip_overview(&db)
}

/// Plants a seed packet in an empty plot. The packet is a purchase (at the
/// catalogue's price) with the same id as the planting, so spending and
/// planting are one record each and cannot come apart.
#[tauri::command]
pub fn pip_plant(plot: i64, plant: String, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.lock().unwrap();
  let catalogue = pip::Catalogue::bundled();
  let ledger = pip_ledger(&db)?;
  let owned = pip::owned(catalogue, &ledger.purchases);
  if plot < 1 || plot > pip::plot_count(&owned) {
    return Err("That plot isn't dug yet.".to_string());
  }
  if ledger.garden.occupied(plot) {
    return Err("Something's already growing there.".to_string());
  }
  let item = catalogue
    .get("plant", &plant)
    .ok_or_else(|| "Pip doesn't know that seed.".to_string())?;
  let balance = ledger.balance();
  if balance < item.price {
    return Err(pip::ShopError::CannotAfford { short: item.price - balance }.to_string());
  }
  let id = pip::new_purchase_id();
  let now = db::now_iso();
  db.insert_pip_purchase(&pip::Purchase {
    id: id.clone(),
    item_kind: "plant".to_string(),
    item_id: item.id.clone(),
    price: item.price,
    bought_at: now.clone()
  })
  .map_err(|e| e.to_string())?;
  db.insert_pip_planting(&pip::Planting { id, plot, plant: item.id.clone(), planted_at: now })
    .map_err(|e| e.to_string())?;
  pip_overview(&db)
}

/// Picks a ripe plant for its seeds. Refused unless the garden, replayed from
/// the reading on record, shows it ripe; a harvest record is never what makes
/// a plant ripe.
#[tauri::command]
pub fn pip_harvest(planting_id: String, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.lock().unwrap();
  let ledger = pip_ledger(&db)?;
  let plant = ledger
    .garden
    .plants
    .iter()
    .find(|plant| plant.id == planting_id)
    .ok_or_else(|| "That plant isn't in the garden.".to_string())?;
  if plant.harvested {
    return Err("Already picked.".to_string());
  }
  if !plant.ripe {
    let left = (plant.need - plant.water).ceil().max(1.0) as i64;
    return Err(format!("Not ripe yet: {left} more minute{} of focus.", if left == 1 { "" } else { "s" }));
  }
  let seeds = pip::Catalogue::bundled()
    .get("plant", &plant.plant)
    .map(|item| item.yield_seeds)
    .unwrap_or(0);
  db.insert_pip_harvest(&pip::Harvest {
    id: pip::new_purchase_id().replacen("buy-", "pick-", 1),
    planting_id,
    seeds,
    harvested_at: db::now_iso()
  })
  .map_err(|e| e.to_string())?;
  cheer_pip(&db, 2.0)?;
  pip_overview(&db)
}

/// A finished arcade game: keeps the best score and cheers Pip up a little
/// (capped per day). Never seeds: those grow only from reading in focus.
#[tauri::command]
pub fn pip_game_played(
  game: String,
  score: i64,
  today_key: String,
  state: State<'_, AppState>
) -> Result<PipOverview, String> {
  let db = state.db.lock().unwrap();
  let result = pip::record_game(&read_arcade(&db), &today_key, &game, score)?;
  let encoded = serde_json::to_string(&result.arcade).map_err(|e| e.to_string())?;
  db.set_setting(ARCADE_SETTING, &encoded).map_err(|e| e.to_string())?;
  if result.mood > 0.0 {
    cheer_pip(&db, result.mood)?;
  }
  pip_overview(&db)
}
