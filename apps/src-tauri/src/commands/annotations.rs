//! Bookmarks and highlights: listed per book, saved, and deleted (as tombstones,
//! so a delete reaches the backup's other copies).

use super::*;
use crate::db::{Annotation, HighlightCount};
use chrono::{DateTime, Utc};

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
  pub chapter: Option<String>,
  /// When it was made, for one made somewhere else (a highlight brought from a
  /// Kindle keeps the Kindle's date). Used only when the row is new.
  #[serde(default)]
  pub created_at: Option<String>
}

const KINDS: [&str; 2] = ["bookmark", "highlight"];
/// A highlight longer than this is kept to its start; a note, likewise.
const MAX_TEXT: usize = 4000;

fn clipped(value: Option<String>) -> Option<String> {
  value.map(|text| text.chars().take(MAX_TEXT).collect::<String>()).filter(|text| !text.trim().is_empty())
}

/// The time a new row says it was made, written as the database writes times.
/// None when it gives none, or one that cannot be right (not a time, or later
/// than now): the row is then made now.
fn made_at(given: Option<&str>, now: &str) -> Option<String> {
  let made = DateTime::parse_from_rfc3339(given?.trim()).ok()?.with_timezone(&Utc);
  let latest = DateTime::parse_from_rfc3339(now).ok()?.with_timezone(&Utc);
  (made <= latest).then(|| made.to_rfc3339())
}

/// A book's bookmarks and highlights, oldest first.
#[tauri::command]
pub fn annotations_list(book_id: String, state: State<'_, AppState>) -> Result<Vec<Annotation>, String> {
  let db = state.db.guard();
  db.annotations_for_book(&book_id).map_err(|e| e.to_string())
}

/// How many highlights each book has, so the library can list the books with
/// highlights without opening any of them.
#[tauri::command]
pub fn annotations_highlight_counts(state: State<'_, AppState>) -> Result<Vec<HighlightCount>, String> {
  let db = state.db.guard();
  db.highlight_counts().map_err(|e| e.to_string())
}

/// Adds an annotation, or updates one (a note added to a highlight, say).
///
/// The table also holds rows of other kinds (a character sheet's, the words
/// looked up), each written through commands of its own. An id that belongs
/// to one of those is refused: a highlight never overwrites a character or a
/// word.
fn save(db: &db::Database, input: AnnotationInput, now: &str) -> Result<Annotation, String> {
  if !KINDS.contains(&input.kind.as_str()) {
    return Err("Unknown kind of annotation.".to_string());
  }
  if input.id.trim().is_empty() || input.cfi.trim().is_empty() {
    return Err("An annotation needs an id and a place in the book.".to_string());
  }
  let existing = db.find_annotation(&input.id).map_err(|e| e.to_string())?;
  if existing.as_ref().is_some_and(|row| !KINDS.contains(&row.kind.as_str())) {
    return Err("That id belongs to something else.".to_string());
  }
  let annotation = Annotation {
    id: input.id,
    book_id: input.book_id,
    kind: input.kind,
    cfi: input.cfi,
    text: clipped(input.text),
    note: clipped(input.note),
    color: input.color,
    chapter: input.chapter,
    // A row that is there keeps its own date, whatever is sent.
    created_at: existing
      .map(|row| row.created_at)
      .or_else(|| made_at(input.created_at.as_deref(), now))
      .unwrap_or_else(|| now.to_string()),
    updated_at: now.to_string(),
    deleted_at: None
  };
  db.put_annotation(&annotation).map_err(|e| e.to_string())?;
  Ok(annotation)
}

/// Deletes a bookmark or a highlight. It stays as a tombstone until every
/// copy has seen it. An id of anything else (a character, a word) is refused:
/// those are removed through their own commands. An id nothing has is no
/// error: it is already gone.
fn delete(db: &db::Database, id: &str, now: &str) -> Result<(), String> {
  if let Some(mut annotation) = db.find_annotation(id).map_err(|e| e.to_string())? {
    if !KINDS.contains(&annotation.kind.as_str()) {
      return Err("That is not a bookmark or a highlight.".to_string());
    }
    annotation.updated_at = now.to_string();
    annotation.deleted_at = Some(now.to_string());
    db.put_annotation(&annotation).map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
pub fn annotation_save(input: AnnotationInput, state: State<'_, AppState>) -> Result<Annotation, String> {
  let db = state.db.guard();
  save(&db, input, &db::now_iso())
}

#[tauri::command]
pub fn annotation_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.guard();
  delete(&db, &id, &db::now_iso())
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;

  const NOW: &str = "2026-10-04T10:00:00Z";
  const LATER: &str = "2026-10-05T10:00:00Z";

  fn input(id: &str, kind: &str) -> AnnotationInput {
    AnnotationInput {
      id: id.into(),
      book_id: "b1".into(),
      kind: kind.into(),
      cfi: "epubcfi(/6/4!/4/2,/1:0,/1:5)".into(),
      text: Some("words".into()),
      note: None,
      color: Some("yellow".into()),
      chapter: None,
      created_at: None
    }
  }

  /// A row of a kind this file does not write: a character, a word looked up.
  fn other(id: &str, kind: &str) -> Annotation {
    Annotation {
      id: id.into(),
      book_id: "b1".into(),
      kind: kind.into(),
      cfi: String::new(),
      text: Some(r#"{"p":0.1}"#.into()),
      note: Some("Vin".into()),
      color: None,
      chapter: None,
      created_at: NOW.into(),
      updated_at: NOW.into(),
      deleted_at: None
    }
  }

  #[test]
  fn a_highlight_is_saved_edited_and_deleted_as_before() {
    let db = memory_db();
    let saved = save(&db, input("h1", "highlight"), NOW).expect("save");
    assert_eq!(saved.created_at, NOW);
    let mut noted = input("h1", "highlight");
    noted.note = Some("a note".into());
    let edited = save(&db, noted, LATER).expect("save");
    assert_eq!((edited.created_at.as_str(), edited.updated_at.as_str()), (NOW, LATER));
    assert_eq!(edited.note.as_deref(), Some("a note"));
    save(&db, input("m1", "bookmark"), NOW).expect("save");

    delete(&db, "h1", LATER).expect("delete");
    delete(&db, "m1", LATER).expect("delete");
    delete(&db, "nothing", LATER).expect("an id nothing has is already gone");
    assert!(db.annotations_for_book("b1").expect("list").is_empty());
    assert_eq!(db.find_annotation("h1").expect("find").and_then(|row| row.deleted_at).as_deref(), Some(LATER));
    // Saved again, it is back.
    save(&db, input("h1", "highlight"), LATER).expect("save");
    assert_eq!(db.annotations_for_book("b1").expect("list").len(), 1);

    assert!(save(&db, input("x", "person"), NOW).is_err());
    assert!(save(&db, input("x", "word"), NOW).is_err());
    assert!(save(&db, input(" ", "highlight"), NOW).is_err());
  }

  #[test]
  fn a_highlight_cannot_take_the_id_of_a_character_or_a_word() {
    let db = memory_db();
    for (id, kind) in [("p1", "person"), ("n1", "person.note"), ("g1", "person.group"), ("word:en:brume", "word")] {
      let row = other(id, kind);
      db.put_annotation(&row).expect("put");
      assert!(save(&db, input(id, "highlight"), LATER).is_err(), "{kind}");
      assert!(save(&db, input(id, "bookmark"), LATER).is_err(), "{kind}");
      assert_eq!(db.find_annotation(id).expect("find"), Some(row), "{kind} is as it was");
    }
    // Nor one that was removed: its tombstone is still that kind's.
    let mut gone = other("p2", "person");
    gone.deleted_at = Some(NOW.into());
    db.put_annotation(&gone).expect("put");
    assert!(save(&db, input("p2", "highlight"), LATER).is_err());
  }

  #[test]
  fn deleting_takes_only_bookmarks_and_highlights() {
    let db = memory_db();
    for (id, kind) in [("p1", "person"), ("a1", "person.alias"), ("l1", "person.link"), ("word:en:brume", "word")] {
      let row = other(id, kind);
      db.put_annotation(&row).expect("put");
      assert!(delete(&db, id, LATER).is_err(), "{kind}");
      assert_eq!(db.find_annotation(id).expect("find"), Some(row), "{kind} is as it was");
    }
  }

  #[test]
  fn a_new_row_keeps_the_date_it_was_made_elsewhere() {
    let db = memory_db();
    // A highlight brought from a Kindle: made then, changed (here) now.
    let mut brought = input("k1", "highlight");
    brought.created_at = Some("2024-03-04T22:15:32.000+05:30".into());
    let saved = save(&db, brought, NOW).expect("save");
    assert_eq!((saved.created_at.as_str(), saved.updated_at.as_str()), ("2024-03-04T16:45:32+00:00", NOW));
    assert_eq!(db.find_annotation("k1").expect("find").map(|row| row.created_at).as_deref(), Some("2024-03-04T16:45:32+00:00"));

    // Saved again, with another date or none, it keeps the one it has.
    let mut again = input("k1", "highlight");
    again.created_at = Some("2020-01-01T00:00:00Z".into());
    assert_eq!(save(&db, again, LATER).expect("save").created_at, "2024-03-04T16:45:32+00:00");
    assert_eq!(save(&db, input("k1", "highlight"), LATER).expect("save").created_at, "2024-03-04T16:45:32+00:00");
    // So does one made here: a date sent later does not move it.
    save(&db, input("h1", "highlight"), NOW).expect("save");
    let mut dated = input("h1", "highlight");
    dated.created_at = Some("2020-01-01T00:00:00Z".into());
    assert_eq!(save(&db, dated, LATER).expect("save").created_at, NOW);
    // Removed and brought again, it is back with its first date.
    delete(&db, "k1", LATER).expect("delete");
    let mut back = input("k1", "highlight");
    back.created_at = Some("2021-06-01T00:00:00Z".into());
    assert_eq!(save(&db, back, LATER).expect("save").created_at, "2024-03-04T16:45:32+00:00");

    // A date that cannot be right is not kept: the row is made now.
    for (id, given) in [("x1", "next Tuesday"), ("x2", ""), ("x3", "2031-01-01T00:00:00Z"), ("x4", "2024-03-04 22:15:32")] {
      let mut odd = input(id, "highlight");
      odd.created_at = Some(given.into());
      assert_eq!(save(&db, odd, NOW).expect("save").created_at, NOW, "{given}");
    }
  }

  #[test]
  fn the_date_is_optional_in_what_the_reader_sends() {
    let plain = r#"{"id":"h1","bookId":"b1","kind":"highlight","cfi":"kindle:123","text":"words","note":null,"color":"yellow","chapter":"Page 12"}"#;
    let without: AnnotationInput = serde_json::from_str(plain).expect("the reader's own highlights send no date");
    assert_eq!(without.created_at, None);
    let dated = plain.replace(r#""id":"h1""#, r#""id":"h1","createdAt":"2024-03-04T16:45:32.000Z""#);
    let with: AnnotationInput = serde_json::from_str(&dated).expect("a date");
    assert_eq!(with.created_at.as_deref(), Some("2024-03-04T16:45:32.000Z"));
    // A place that is not a CFI is kept as it is sent, like a PDF's.
    let saved = save(&memory_db(), with, NOW).expect("save");
    assert_eq!((saved.cfi.as_str(), saved.created_at.as_str()), ("kindle:123", "2024-03-04T16:45:32+00:00"));
  }
}
