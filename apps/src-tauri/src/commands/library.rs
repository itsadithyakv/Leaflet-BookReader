//! The library: importing books, their details and covers, reading progress, and removing them.

use super::*;

/// Imports books, one file at a time. A file that fails (unreadable, damaged,
/// a disk error) is logged and skipped; the others still come in. It used to
/// abort the whole batch after the earlier books were already saved, so the
/// library showed "Import failed" while holding half of them. Only when
/// nothing at all came in is the last error returned.
#[tauri::command]
pub async fn import_books(
  paths: Vec<String>,
  state: State<'_, AppState>,
  app: AppHandle
) -> Result<Vec<BookRecord>, String> {
  let mut imported = Vec::new();
  let mut last_error = None;
  for path in paths {
    match import_one(&path, &state).await {
      Ok(Some(book)) => imported.push(book),
      Ok(None) => {}
      Err(error) => {
        crate::diag::error(&format!("import failed for {path}: {error}"));
        last_error = Some(error);
      }
    }
  }
  // Every way a book is added ends up here (the import dialog, drag and drop,
  // "Open with"), so this is where "keep a copy of my books" hears of it. A
  // book already in the library counts too: opening it again is how one gets
  // its copy when the option was turned on later. Done after the import, in
  // the background: the books are in the library whatever happens to the copy.
  keep_copies_later(&app, imported.clone());
  match last_error {
    Some(error) if imported.is_empty() => Err(error),
    _ => Ok(imported)
  }
}

/// One file: `None` for a format the reader cannot open.
pub(crate) async fn import_one(path: &str, state: &State<'_, AppState>) -> Result<Option<BookRecord>, String> {
  {
    let source = std::path::PathBuf::from(path);
    // Importing a file the reader cannot open only defers the failure to the
    // moment the user tries to read it.
    if !formats::is_supported(&formats::extension_of(&source)) {
      return Ok(None);
    }
    let hash = {
      let source = source.clone();
      tauri::async_runtime::spawn_blocking(move || storage::hash_for_import(&source))
        .await
        .map_err(|e| format!("Import task failed: {e}"))?
        .map_err(|e| e.to_string())?
    };
    // A tombstoned row is a book the reader deleted, whose file is already
    // gone. Returning it would make re-importing a no-op for the 90 days the
    // tombstone lives, so it falls through and is imported afresh; the upsert
    // below clears `deleted_at`.
    if let Some(existing) = {
      let db = state.db.guard();
      db.find_by_hash(&hash).map_err(|e| e.to_string())?
    } {
      if existing.deleted_at.is_none() {
        let mut existing = existing;
        // Listed, but its file is not on this computer (it came from a backup
        // and was never downloaded). The reader has just handed over the same
        // bytes, so keep them: returning the entry alone left the book
        // unreadable once the file they opened was gone.
        if !existing.available {
          let source = source.clone();
          let hash = hash.clone();
          let known = existing.local_path.clone();
          let restored = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<std::path::PathBuf> {
            if known.is_empty() {
              return storage::store_book_file(&source, &hash);
            }
            let dest = std::path::PathBuf::from(known);
            storage::restore_book_file(&source, &dest)?;
            Ok(dest)
          })
          .await
          .map_err(|e| format!("Import task failed: {e}"))?
          .map_err(|e| e.to_string())?;
          let restored = restored.to_string_lossy().to_string();
          existing.available = true;
          // Only an entry that had no path at all needs writing back.
          if existing.local_path != restored {
            existing.local_path = restored;
            let db = state.db.guard();
            db.upsert_book(&existing).map_err(|e| e.to_string())?;
          }
        }
        return Ok(Some(existing));
      }
    }

    let (stored, mut basic, embedded_cover) = {
      let source = source.clone();
      let hash = hash.clone();
      tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<_> {
        let stored = storage::store_book_file(&source, &hash)?;
        let basic = storage::extract_basic_metadata(&stored)?;
        let cover = storage::store_embedded_cover(&stored, &hash);
        Ok((stored, basic, cover))
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
    let cover_url = embedded_cover.map(|path| path.to_string_lossy().to_string());

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
      // What the book says about itself; the app works out the rest.
      series: basic.series.take(),
      series_index: basic.series_index,
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
      let db = state.db.guard();
      db.upsert_book(&book).map_err(|e| e.to_string())?;
    }

    Ok(Some(book))
  }
}

#[tauri::command]
pub fn list_books(state: State<'_, AppState>) -> Result<Vec<BookRecord>, String> {
  let db = state.db.guard();
  db.list_books().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn take_pending_open_paths(state: State<'_, AppState>) -> Vec<String> {
  std::mem::take(&mut *state.pending_open_paths.guard())
}

#[tauri::command]
pub async fn refresh_metadata(book_id: String, state: State<'_, AppState>) -> Result<BookRecord, String> {
  let mut book = {
    let db = state.db.guard();
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
    let db = state.db.guard();
    db.update_metadata(&book).map_err(|e| e.to_string())?;
  }

  Ok(book)
}

#[tauri::command]
pub async fn fetch_cover(book_id: String, state: State<'_, AppState>) -> Result<Option<BookRecord>, String> {
  let mut book = {
    let db = state.db.guard();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };

  if book.cover_url.is_some() {
    return Ok(Some(book));
  }

  let embedded = {
    let path = std::path::PathBuf::from(&book.local_path);
    let hash = book.file_hash.clone();
    tauri::async_runtime::spawn_blocking(move || storage::store_embedded_cover(&path, &hash))
      .await
      .ok()
      .flatten()
  };
  if let Some(path) = embedded {
    book.cover_url = Some(path.to_string_lossy().to_string());
    let db = state.db.guard();
    db.update_cover(&book.id, book.cover_url.clone())
      .map_err(|e| e.to_string())?;
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
        let db = state.db.guard();
        db.update_cover(&book.id, book.cover_url.clone())
          .map_err(|e| e.to_string())?;
        return Ok(Some(book));
      }
    }
  }

  if let Ok(Some(url)) = wikipedia::fetch_cover(&normalized.title, normalized.author.as_deref()).await {
    if let Ok(path) = storage::store_cover(&url, &book.file_hash).await {
      book.cover_url = Some(path.to_string_lossy().to_string());
      let db = state.db.guard();
      db.update_cover(&book.id, book.cover_url.clone())
        .map_err(|e| e.to_string())?;
      return Ok(Some(book));
    }
  }

  Ok(None)
}

/// The EPUB's sections in reading order with their sizes, for progress by how
/// much of the book has been read. Empty for a book that is not an EPUB.
#[tauri::command]
pub async fn epub_sections(book_id: String, state: State<'_, AppState>) -> Result<Vec<storage::epub::Section>, String> {
  let path = {
    let db = state.db.guard();
    let book = db
      .find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?;
    // A converted book is read from its EPUB copy.
    let converted = storage::converted_epub_path(&book.file_hash).ok().filter(|path| path.exists());
    converted.unwrap_or_else(|| std::path::PathBuf::from(&book.local_path))
  };
  if !path.to_string_lossy().to_ascii_lowercase().ends_with(".epub") {
    return Ok(Vec::new());
  }
  tauri::async_runtime::spawn_blocking(move || storage::epub::sections(&path).map_err(|e| e.to_string()))
    .await
    .map_err(|e| format!("Section task failed: {e}"))?
}

/// Async and off-thread: a sync command runs on the main thread, and reading
/// and encoding a large cover there stalls the window. `thumb` asks for the
/// library's small version (made once, then reused); without it, the full cover.
#[tauri::command]
pub async fn cover_data(
  book_id: String,
  thumb: Option<bool>,
  state: State<'_, AppState>
) -> Result<Option<String>, String> {
  let book = {
    let db = state.db.guard();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };

  let cover_url = match book.cover_url {
    Some(value) => value,
    None => return Ok(None)
  };

  let hash = book.file_hash.clone();
  tauri::async_runtime::spawn_blocking(move || {
    let full = std::path::PathBuf::from(&cover_url);
    // A cover that cannot be shrunk (an odd format) is served whole.
    let path = if thumb.unwrap_or(false) {
      storage::cover_thumbnail(&full, &hash).unwrap_or(full)
    } else {
      full
    };
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
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
    let db = state.db.guard();
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
  let db = state.db.guard();
  db.update_progress(&book_id, progress, last_opened, position)
    .map_err(|e| e.to_string())
}

/// Removes a book from the library on every device.
///
/// The row is tombstoned rather than dropped, so the removal can reach the other
/// devices instead of being undone by them on the next sync.
#[tauri::command]
pub fn delete_book(book_id: String, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.guard();
  let book = db.find_by_id(&book_id).map_err(|e| e.to_string())?;
  // The delete is recorded first: if that fails, the book and its file both
  // stay. The other way round, a failed write left a row pointing at a file
  // that was already gone.
  db.delete_book(&book_id, &db::now_iso()).map_err(|e| e.to_string())?;
  if let Some(book) = book {
    if let Err(error) = std::fs::remove_file(&book.local_path) {
      if error.kind() != std::io::ErrorKind::NotFound {
        crate::diag::warn(&format!("could not remove the file of a deleted book: {error}"));
      }
    }
    storage::remove_book_extras(&book.file_hash, std::path::Path::new(&book.local_path));
  }
  Ok(())
}

/// Removes the copies of the database kept from before each upgrade
/// (`library.db.bak-v3`, beside it). Each is the whole library as it was:
/// titles, reading history, notes, settings. "Delete All Data" left them.
fn remove_database_backups(database: &std::path::Path) {
  let (Some(dir), Some(name)) = (database.parent(), database.file_name().and_then(|name| name.to_str())) else {
    return;
  };
  let prefix = format!("{name}.bak-v");
  let Ok(entries) = fs::read_dir(dir) else {
    return;
  };
  for entry in entries.flatten() {
    if entry.file_name().to_string_lossy().starts_with(&prefix) {
      let _ = fs::remove_file(entry.path());
    }
  }
}

#[tauri::command]
pub fn clear_all_data(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
  // Pip on the desktop is switched off and her window closed.
  crate::desktop_pip::runtime::forget(&app);
  {
    let db = state.db.guard();
    // The refresh token lives in the OS keychain now, so clearing the settings
    // table is no longer enough to leave nothing behind.
    let _ = drive::clear_tokens(&db);
    // The Leaflet session token is in the keychain too. The account itself
    // stays on the server; this only signs this device out.
    cloud::clear_session(&db);
    // Where Leaflet's server is, which is not the reader's data and is only
    // learned at startup.
    let server = crate::sync::remote_config::remembered(&db);
    db.clear_all().map_err(|e| e.to_string())?;
    crate::sync::remote_config::put_back(&db, &server);
    remove_database_backups(db.path());
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

#[cfg(test)]
mod tests {
  use super::*;

  /// The bug this guards: "Delete All Data" emptied `library.db` and left the
  /// copies made before each upgrade beside it, each one the whole library.
  #[test]
  fn deleting_all_data_removes_the_backups_made_before_upgrades() {
    let dir = std::env::temp_dir().join(format!("leaflet-clear-backups-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("books")).expect("dir");
    let database = dir.join("library.db");
    for name in ["library.db", "library.db.bak-v2", "library.db.bak-v3", "library.db.broken-20260101-120000", "notes.txt"] {
      fs::write(dir.join(name), b"x").expect("write");
    }

    remove_database_backups(&database);

    let mut left: Vec<String> = fs::read_dir(&dir)
      .expect("read")
      .flatten()
      .map(|entry| entry.file_name().to_string_lossy().to_string())
      .collect();
    left.sort();
    // The database itself is emptied, not removed; a database set aside as
    // damaged was kept on purpose and is not Leaflet's to remove here.
    assert_eq!(left, vec!["books", "library.db", "library.db.broken-20260101-120000", "notes.txt"]);

    // Nothing to do, and nothing to fail, for a database with no folder.
    remove_database_backups(std::path::Path::new(":memory:"));
    let _ = fs::remove_dir_all(&dir);
  }
}
