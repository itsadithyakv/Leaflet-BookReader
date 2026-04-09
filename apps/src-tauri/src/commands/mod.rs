use crate::db::{self, BookRecord};
use crate::metadata::{normalize, open_library, wikipedia};
use crate::storage;
use crate::sync::drive;
use crate::AppState;
use base64::Engine;
use serde::Serialize;
use std::fs;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn import_books(
  paths: Vec<String>,
  state: State<'_, AppState>,
  app: AppHandle
) -> Result<Vec<BookRecord>, String> {
  let mut imported = Vec::new();

  for path in paths {
    let source = std::path::Path::new(&path);
    let hash = storage::hash_file(source).map_err(|e| e.to_string())?;
    if let Some(existing) = {
      let db = state.db.lock().unwrap();
      db.find_by_hash(&hash).map_err(|e| e.to_string())?
    } {
      imported.push(existing);
      continue;
    }

    let stored = storage::store_book_file(source, &hash).map_err(|e| e.to_string())?;
    let converted =
      storage::ensure_epub_version(&stored, &hash, Some(&app)).map_err(|e| e.to_string())?;
    let metadata_source = converted.as_deref().unwrap_or(source);
    let mut basic = storage::extract_basic_metadata(metadata_source).map_err(|e| e.to_string())?;

    let filename = source
      .file_stem()
      .and_then(|v| v.to_str())
      .unwrap_or("Untitled")
      .to_string();

    let mut title = basic.title.take().unwrap_or_else(|| filename.clone());
    let mut author = basic.author.take();
    let mut genres = Vec::new();
    let mut cover_url = None;

    let normalized = normalize::normalize_query(&title, author.as_deref());
    if normalize::is_noisy_title(&title) && !normalized.title.trim().is_empty() {
      title = normalized.title.clone();
    }
    if author.is_none() {
      author = normalized.author.clone();
    }

    if let Ok(Some(meta)) = open_library::fetch_metadata(&normalized.title, normalized.author.as_deref(), normalized.isbn.as_deref()).await {
      title = meta.title;
      author = meta.author;
      genres = meta.subjects;
      if let Some(url) = meta.cover_url {
        if let Ok(path) = storage::store_cover(&url, &hash).await {
          cover_url = Some(path.to_string_lossy().to_string());
        }
      }
    }

    if author.is_none() {
      author = normalized.author.clone();
    }

    if cover_url.is_none() {
      if let Ok(Some(url)) = wikipedia::fetch_cover(&normalized.title, normalized.author.as_deref()).await {
        if let Ok(path) = storage::store_cover(&url, &hash).await {
          cover_url = Some(path.to_string_lossy().to_string());
        }
      }
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
      last_opened: None,
      created_at: db::now_iso()
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

  if let Ok(Some(meta)) = open_library::fetch_metadata(&normalized.title, normalized.author.as_deref(), normalized.isbn.as_deref()).await {
    book.title = meta.title;
    book.author = meta.author;
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

#[tauri::command]
pub fn cover_data(book_id: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
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

  let bytes = std::fs::read(&cover_url).map_err(|e| e.to_string())?;
  let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
  Ok(Some(format!("data:image/jpeg;base64,{}", encoded)))
}

#[tauri::command]
pub fn read_book_bytes(
  book_id: String,
  state: State<'_, AppState>,
  app: AppHandle
) -> Result<Option<String>, String> {
  let book = {
    let db = state.db.lock().unwrap();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };

  let source_path = std::path::Path::new(&book.local_path);
  let ext = source_path
    .extension()
    .and_then(|v| v.to_str())
    .unwrap_or("")
    .to_lowercase();

  let readable_path = if ext == "epub" {
    source_path.to_path_buf()
  } else if ext == "mobi" || ext == "azw3" {
    match storage::ensure_epub_version(source_path, &book.file_hash, Some(&app))
      .map_err(|e| e.to_string())? {
      Some(path) => path,
      None => {
        return Err(
          "Converter not installed or conversion failed. Install it in Settings to open this file."
            .to_string()
        );
      }
    }
  } else {
    return Err("This reader supports EPUB files only.".to_string());
  };

  let bytes = std::fs::read(&readable_path).map_err(|e| e.to_string())?;
  let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
  Ok(Some(encoded))
}

#[tauri::command]
pub fn update_progress(book_id: String, progress: f32, last_opened: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.lock().unwrap();
  db.update_progress(&book_id, progress, last_opened)
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveStatus {
  pub connected: bool,
  pub expires_at: Option<String>
}

#[tauri::command]
pub fn drive_status(state: State<'_, AppState>) -> Result<DriveStatus, String> {
  let db = state.db.lock().unwrap();
  let refresh = db.get_setting("drive_refresh_token").map_err(|e| e.to_string())?;
  let expires_at = db.get_setting("drive_expires_at").map_err(|e| e.to_string())?;
  Ok(DriveStatus {
    connected: refresh.is_some(),
    expires_at
  })
}

#[tauri::command]
pub fn reading_stats(state: State<'_, AppState>) -> Result<db::ReadingStats, String> {
  let db = state.db.lock().unwrap();
  db.reading_stats().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn drive_auth_start(state: State<'_, AppState>) -> Result<String, String> {
  let mut drive_state = state.drive.lock().unwrap();
  let auth = drive::auth_start(&mut drive_state).map_err(|e| e.to_string())?;
  Ok(auth.url)
}

#[tauri::command]
pub async fn drive_auth_wait(state: State<'_, AppState>) -> Result<(), String> {
  let pending = {
    let mut drive_state = state.drive.lock().unwrap();
    drive_state.take_pending().ok_or_else(|| "auth not started".to_string())?
  };
  let tokens = drive::auth_wait(pending).await.map_err(|e| e.to_string())?;
  let db = state.db.lock().unwrap();
  db.set_setting("drive_access_token", &tokens.access_token)
    .map_err(|e| e.to_string())?;
  db.set_setting("drive_refresh_token", &tokens.refresh_token)
    .map_err(|e| e.to_string())?;
  db.set_setting("drive_expires_at", &tokens.expires_at)
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub async fn drive_sync(state: State<'_, AppState>) -> Result<(), String> {
  drive::drive_sync(&state.db)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn converter_status(app: AppHandle) -> Result<bool, String> {
  Ok(storage::converter_installed(&app))
}

#[tauri::command]
pub async fn install_converter(app: AppHandle) -> Result<bool, String> {
  storage::install_converter(&app)
    .await
    .map(|_| true)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_all_data(state: State<'_, AppState>) -> Result<(), String> {
  {
    let db = state.db.lock().unwrap();
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
