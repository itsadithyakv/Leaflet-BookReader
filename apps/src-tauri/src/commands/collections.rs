//! The reader's own collections, a book's series, and filling series in from
//! the books' own files.
//!
//! Series groups and smart shelves are worked out by the app from the library
//! (`src/library/`); only what the reader decides, and what a book says about
//! itself, is stored.

use super::*;
use crate::db::Collection;

/// What the library sends: the timestamps are set here.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInput {
  pub id: String,
  pub name: String,
  pub book_ids: Vec<String>
}

const MAX_NAME: usize = 80;
const MAX_BOOKS: usize = 10_000;
/// Marks that the books already in the library have had their series read.
/// Books imported after it read theirs at import.
const SERIES_SCAN_KEY: &str = "series_scan_version";
const SERIES_SCAN_VERSION: &str = "1";

fn clip(value: &str, max: usize) -> String {
  value.trim().chars().take(max).collect::<String>().trim().to_string()
}

#[tauri::command]
pub fn collections_list(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
  let db = state.db.guard();
  db.collections().map_err(|e| e.to_string())
}

/// Creates a collection, or saves a change to one (a rename, a book added).
#[tauri::command]
pub fn collection_save(input: CollectionInput, state: State<'_, AppState>) -> Result<Collection, String> {
  let name = clip(&input.name, MAX_NAME);
  if name.is_empty() {
    return Err("A collection needs a name.".to_string());
  }
  if input.id.trim().is_empty() {
    return Err("A collection needs an id.".to_string());
  }
  // Each book once, in the order first added.
  let mut book_ids: Vec<String> = Vec::new();
  for id in input.book_ids {
    if !id.is_empty() && !book_ids.contains(&id) {
      book_ids.push(id);
    }
  }
  book_ids.truncate(MAX_BOOKS);

  let db = state.db.guard();
  let now = db::now_iso();
  let created_at = db
    .find_collection(&input.id)
    .map_err(|e| e.to_string())?
    .filter(|existing| !existing.created_at.is_empty())
    .map(|existing| existing.created_at)
    .unwrap_or_else(|| now.clone());
  let collection = Collection {
    id: input.id,
    name,
    book_ids,
    created_at,
    updated_at: now,
    deleted_at: None
  };
  db.put_collection(&collection).map_err(|e| e.to_string())?;
  Ok(collection)
}

/// Deletes a collection (not its books). A tombstone until every copy has it.
#[tauri::command]
pub fn collection_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.guard();
  if let Some(mut collection) = db.find_collection(&id).map_err(|e| e.to_string())? {
    let now = db::now_iso();
    collection.updated_at = now.clone();
    collection.deleted_at = Some(now);
    db.put_collection(&collection).map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// The reader's word on a book's series: a name and number, or `""` for "not
/// in a series", or `None` to go back to what the book itself says (and, if it
/// says nothing, to what the app works out from the title).
#[tauri::command]
pub async fn book_set_series(
  book_id: String,
  series: Option<String>,
  series_index: Option<f32>,
  state: State<'_, AppState>
) -> Result<BookRecord, String> {
  let (mut series, mut series_index) = (series.map(|name| clip(&name, MAX_NAME)), series_index);
  if series.is_none() {
    let path = {
      let db = state.db.guard();
      db.find_by_id(&book_id).map_err(|e| e.to_string())?.map(|book| std::path::PathBuf::from(book.local_path))
    };
    if let Some(path) = path.filter(|path| formats::extension_of(path) == "epub") {
      let package = tauri::async_runtime::spawn_blocking(move || storage::epub::package(&path).ok())
        .await
        .map_err(|e| format!("Could not read the book: {e}"))?;
      if let Some(package) = package {
        series = package.series;
        series_index = package.series_index;
      }
    }
  }
  let series_index = match (&series, series_index) {
    (Some(name), Some(index)) if !name.is_empty() && index.is_finite() && (0.0..10_000.0).contains(&index) => Some(index),
    _ => None
  };
  let db = state.db.guard();
  if !db.set_series(&book_id, series.as_deref(), series_index).map_err(|e| e.to_string())? {
    return Err("Book not found".to_string());
  }
  db.find_by_id(&book_id)
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Book not found".to_string())
}

/// Reads the series of every EPUB already in the library, once. Returns how
/// many books gained one, so the library knows whether to reload.
#[tauri::command]
pub async fn scan_series(state: State<'_, AppState>) -> Result<usize, String> {
  let pending: Vec<(String, std::path::PathBuf)> = {
    let db = state.db.guard();
    if db.get_setting(SERIES_SCAN_KEY).map_err(|e| e.to_string())?.as_deref() == Some(SERIES_SCAN_VERSION) {
      return Ok(0);
    }
    db.list_books()
      .map_err(|e| e.to_string())?
      .into_iter()
      .filter(|book| book.series.is_none() && book.available)
      .map(|book| (book.id, std::path::PathBuf::from(book.local_path)))
      .filter(|(_, path)| formats::extension_of(path) == "epub")
      .collect()
  };
  // The files are read without holding the database.
  let found = tauri::async_runtime::spawn_blocking(move || {
    pending
      .into_iter()
      .filter_map(|(id, path)| {
        let package = storage::epub::package(&path).ok()?;
        Some((id, package.series?, package.series_index))
      })
      .collect::<Vec<_>>()
  })
  .await
  .map_err(|e| format!("Series scan failed: {e}"))?;

  let db = state.db.guard();
  for (id, series, index) in &found {
    db.fill_series_from_file(id, series, *index).map_err(|e| e.to_string())?;
  }
  db.set_setting(SERIES_SCAN_KEY, SERIES_SCAN_VERSION).map_err(|e| e.to_string())?;
  Ok(found.len())
}
