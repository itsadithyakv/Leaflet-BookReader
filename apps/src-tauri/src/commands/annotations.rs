//! Bookmarks and highlights: listed per book, saved, and deleted (as tombstones,
//! so a delete reaches the backup's other copies).

use super::*;
use crate::db::Annotation;

/// What the reader sends: everything but the timestamps, which are set here.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationInput {
  pub id: String,
  pub book_id: String,
  pub kind: String,
  pub cfi: String,
  pub text: Option<String>,
  pub note: Option<String>,
  pub color: Option<String>,
  pub chapter: Option<String>
}

const KINDS: [&str; 2] = ["bookmark", "highlight"];
/// A highlight longer than this is kept to its start; a note, likewise.
const MAX_TEXT: usize = 4000;

fn clipped(value: Option<String>) -> Option<String> {
  value.map(|text| text.chars().take(MAX_TEXT).collect::<String>()).filter(|text| !text.trim().is_empty())
}

/// A book's bookmarks and highlights, oldest first.
#[tauri::command]
pub fn annotations_list(book_id: String, state: State<'_, AppState>) -> Result<Vec<Annotation>, String> {
  let db = state.db.guard();
  db.annotations_for_book(&book_id).map_err(|e| e.to_string())
}

/// Adds an annotation, or updates one (a note added to a highlight, say).
#[tauri::command]
pub fn annotation_save(input: AnnotationInput, state: State<'_, AppState>) -> Result<Annotation, String> {
  if !KINDS.contains(&input.kind.as_str()) {
    return Err("Unknown kind of annotation.".to_string());
  }
  if input.id.trim().is_empty() || input.cfi.trim().is_empty() {
    return Err("An annotation needs an id and a place in the book.".to_string());
  }
  let db = state.db.guard();
  let now = db::now_iso();
  let created_at = db
    .find_annotation(&input.id)
    .map_err(|e| e.to_string())?
    .map(|existing| existing.created_at)
    .unwrap_or_else(|| now.clone());
  let annotation = Annotation {
    id: input.id,
    book_id: input.book_id,
    kind: input.kind,
    cfi: input.cfi,
    text: clipped(input.text),
    note: clipped(input.note),
    color: input.color,
    chapter: input.chapter,
    created_at,
    updated_at: now,
    deleted_at: None
  };
  db.put_annotation(&annotation).map_err(|e| e.to_string())?;
  Ok(annotation)
}

/// Deletes an annotation. It stays as a tombstone until every copy has seen it.
#[tauri::command]
pub fn annotation_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.guard();
  if let Some(mut annotation) = db.find_annotation(&id).map_err(|e| e.to_string())? {
    let now = db::now_iso();
    annotation.updated_at = now.clone();
    annotation.deleted_at = Some(now);
    db.put_annotation(&annotation).map_err(|e| e.to_string())?;
  }
  Ok(())
}
