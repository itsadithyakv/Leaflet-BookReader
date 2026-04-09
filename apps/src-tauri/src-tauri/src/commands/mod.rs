use crate::db::{self, BookRecord};
use crate::metadata::open_library;
use crate::storage;
use crate::sync::drive;
use crate::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn import_books(paths: Vec<String>, state: State<'_, AppState>) -> Result<Vec<BookRecord>, String> {
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
    let mut basic = storage::extract_basic_metadata(source).map_err(|e| e.to_string())?;

    let filename = source
      .file_stem()
      .and_then(|v| v.to_str())
      .unwrap_or("Untitled")
      .to_string();

    let mut title = basic.title.take().unwrap_or_else(|| filename.clone());
    let mut author = basic.author.take();
    let mut genres = Vec::new();
    let mut cover_url = None;

    if let Ok(Some(meta)) = open_library::fetch_metadata(&title, author.as_deref()).await {
      title = meta.title;
      author = meta.author;
      genres = meta.subjects;
      if let Some(url) = meta.cover_url {
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

  if let Ok(Some(meta)) = open_library::fetch_metadata(&book.title, book.author.as_deref()).await {
    book.title = meta.title;
    book.author = meta.author;
    book.genres = meta.subjects;
    if let Some(url) = meta.cover_url {
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
pub fn update_progress(book_id: String, progress: f32, last_opened: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.lock().unwrap();
  db.update_progress(&book_id, progress, last_opened)
    .map_err(|e| e.to_string())
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
