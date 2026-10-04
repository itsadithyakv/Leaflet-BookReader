//! Characters: what the reader has written down about the people in a book
//! (names, notes, who is whose), each entry stamped with the place it was
//! written at. The reader shows only what is stamped at or before the place
//! being read (`src/readers/people/model.ts`).
//!
//! Kept as rows of the annotations table, under kinds of their own, rather
//! than in a table of their own: an annotation is already "something the
//! reader attached to a place in a book", it is already in the backup, and
//! copies already merge row by row (the newest edit of each wins, a delete is
//! a tombstone). A build that does not know these kinds carries them along
//! untouched, where a new part of the backup document would be dropped by it.
//!
//! How a row is used: `cfi` and `chapter` are the place, `note` holds the
//! reader's own words (a name, a note, a label), `color` a group's colour, and
//! `text` a small JSON object with the rest (how far through the book, whose
//! entry it is, who a link is to). The app writes and reads that object; here
//! it is only checked to be one.

use super::*;
use crate::db::{Annotation, Database};

/// What the reader sends: everything but the timestamps, which are set here.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeopleInput {
  pub id: String,
  pub book_id: String,
  pub kind: String,
  /// The exact place, when there is one (none for a sheet brought in from
  /// another edition or an earlier book).
  pub cfi: Option<String>,
  pub text: String,
  pub note: Option<String>,
  pub color: Option<String>,
  pub chapter: Option<String>
}

pub const PEOPLE_KINDS: [&str; 6] =
  ["person", "person.alias", "person.note", "person.member", "person.link", "person.group"];
/// The reader's words are kept to their start, as a highlight's note is.
const MAX_WORDS: usize = 4000;
/// The JSON beside them is never clipped (half an object is no object): one
/// too long is refused. Real ones are under 300 bytes.
const MAX_DETAIL: usize = 2000;
const MAX_SHORT: usize = 300;
/// A whole sheet arrives at once when one is imported or carried over.
const MAX_BATCH: usize = 5000;

fn is_people_kind(kind: &str) -> bool {
  PEOPLE_KINDS.contains(&kind)
}

fn clipped(value: Option<String>, max: usize) -> Option<String> {
  value.map(|text| text.chars().take(max).collect::<String>()).filter(|text| !text.trim().is_empty())
}

/// The row an input becomes, or why it cannot be saved.
fn checked(input: PeopleInput, existing: Option<&Annotation>, now: &str) -> Result<Annotation, String> {
  if !is_people_kind(&input.kind) {
    return Err("Unknown kind of character entry.".to_string());
  }
  if input.id.trim().is_empty() || input.book_id.trim().is_empty() {
    return Err("A character entry needs an id and a book.".to_string());
  }
  // An id is random, so this is a mistake rather than a clash: a character
  // entry must never overwrite a highlight or a bookmark.
  if existing.is_some_and(|row| !is_people_kind(&row.kind)) {
    return Err("That id belongs to a highlight or a bookmark.".to_string());
  }
  if input.text.len() > MAX_DETAIL {
    return Err("A character entry's details are too long.".to_string());
  }
  let detail: serde_json::Value =
    serde_json::from_str(&input.text).map_err(|_| "A character entry's details could not be read.".to_string())?;
  let Some(fields) = detail.as_object() else {
    return Err("A character entry's details could not be read.".to_string());
  };
  // How far through the book it was written, when it says: a fraction.
  if let Some(place) = fields.get("p") {
    match place.as_f64() {
      Some(p) if (0.0..=1.0).contains(&p) => {}
      _ => return Err("A character entry's place is not in the book.".to_string())
    }
  }
  Ok(Annotation {
    id: input.id,
    book_id: input.book_id,
    kind: input.kind,
    cfi: clipped(input.cfi, MAX_WORDS).unwrap_or_default(),
    text: Some(input.text),
    note: clipped(input.note, MAX_WORDS),
    color: clipped(input.color, MAX_SHORT),
    chapter: clipped(input.chapter, MAX_SHORT),
    created_at: existing.map(|row| row.created_at.clone()).unwrap_or_else(|| now.to_string()),
    updated_at: now.to_string(),
    deleted_at: None
  })
}

/// A book's character entries, oldest first, without deleted ones.
fn list(db: &Database, book_id: &str) -> Result<Vec<Annotation>, String> {
  let rows = db.annotations_for_book(book_id).map_err(|e| e.to_string())?;
  Ok(rows.into_iter().filter(|row| is_people_kind(&row.kind)).collect())
}

/// Saves entries, new or changed. All of them or none: every one is checked
/// before the first is written.
fn save(db: &Database, inputs: Vec<PeopleInput>, now: &str) -> Result<Vec<Annotation>, String> {
  if inputs.len() > MAX_BATCH {
    return Err("Too many character entries at once.".to_string());
  }
  let mut rows = Vec::with_capacity(inputs.len());
  for input in inputs {
    let existing = db.find_annotation(&input.id).map_err(|e| e.to_string())?;
    rows.push(checked(input, existing.as_ref(), now)?);
  }
  for row in &rows {
    db.put_annotation(row).map_err(|e| e.to_string())?;
  }
  Ok(rows)
}

/// Deletes entries. Each stays as a tombstone until every copy has seen it.
/// Only character entries: an id of anything else is left alone.
fn delete(db: &Database, ids: &[String], now: &str) -> Result<(), String> {
  for id in ids {
    if let Some(mut row) = db.find_annotation(id).map_err(|e| e.to_string())? {
      if is_people_kind(&row.kind) && row.deleted_at.is_none() {
        row.updated_at = now.to_string();
        row.deleted_at = Some(now.to_string());
        db.put_annotation(&row).map_err(|e| e.to_string())?;
      }
    }
  }
  Ok(())
}

#[tauri::command]
pub fn people_list(book_id: String, state: State<'_, AppState>) -> Result<Vec<Annotation>, String> {
  let db = state.db.guard();
  list(&db, &book_id)
}

#[tauri::command]
pub fn people_save(inputs: Vec<PeopleInput>, state: State<'_, AppState>) -> Result<Vec<Annotation>, String> {
  let db = state.db.guard();
  save(&db, inputs, &db::now_iso())
}

#[tauri::command]
pub fn people_delete(ids: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.guard();
  delete(&db, &ids, &db::now_iso())
}

/// A sheet file is a few hundred kilobytes for the longest book.
const MAX_SHEET_BYTES: usize = 8 * 1024 * 1024;

/// Writes a sheet where the reader chose (the save dialog's path). Only a
/// `.json` file, and only a sheet: this is not a way to write anything
/// anywhere.
fn write_sheet(path: &str, contents: &str) -> Result<(), String> {
  let target = std::path::Path::new(path);
  let is_json = target.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("json"));
  if !is_json {
    return Err("A character sheet is saved as a .json file.".to_string());
  }
  if contents.len() > MAX_SHEET_BYTES {
    return Err("That sheet is too large to save.".to_string());
  }
  let sheet: serde_json::Value =
    serde_json::from_str(contents).map_err(|_| "That is not a character sheet.".to_string())?;
  if sheet.get("format").and_then(|f| f.as_str()) != Some("leaflet-characters") {
    return Err("That is not a character sheet.".to_string());
  }
  fs::write(target, contents).map_err(|e| format!("Couldn't save the sheet: {e}"))
}

/// Saves a book's sheet as a file, for a friend or for safe keeping.
#[tauri::command]
pub fn people_export(path: String, contents: String) -> Result<(), String> {
  write_sheet(&path, &contents)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;
  use crate::sync::merge::{merge, SyncDoc};
  use crate::sync::store::{apply, snapshot};

  const NOW: &str = "2026-10-04T10:00:00Z";
  const LATER: &str = "2026-10-05T10:00:00Z";

  fn input(id: &str, kind: &str, text: &str, note: Option<&str>) -> PeopleInput {
    PeopleInput {
      id: id.into(),
      book_id: "b1".into(),
      kind: kind.into(),
      cfi: Some("epubcfi(/6/8!/4/2/1:0)".into()),
      text: text.into(),
      note: note.map(str::to_string),
      color: None,
      chapter: Some("Chapter 2".into())
    }
  }

  fn highlight(id: &str) -> Annotation {
    Annotation {
      id: id.into(),
      book_id: "b1".into(),
      kind: "highlight".into(),
      cfi: "epubcfi(/6/4!/4/2,/1:0,/1:5)".into(),
      text: Some("words".into()),
      note: None,
      color: Some("yellow".into()),
      chapter: None,
      created_at: NOW.into(),
      updated_at: NOW.into(),
      deleted_at: None
    }
  }

  #[test]
  fn entries_are_saved_listed_and_keep_when_they_were_made() {
    let db = memory_db();
    let saved = save(
      &db,
      vec![
        input("p1", "person", r#"{"p":0.02}"#, Some("Jon Snow")),
        input("n1", "person.note", r#"{"p":0.02,"who":"p1"}"#, Some("Son of Ned, the bastard boy"))
      ],
      NOW
    )
    .expect("save");
    assert_eq!(saved.len(), 2);
    // Listed oldest first; made at the same moment, by id.
    assert_eq!(list(&db, "b1").expect("list"), vec![saved[1].clone(), saved[0].clone()]);
    assert!(list(&db, "b2").expect("list").is_empty());

    // An edit keeps the first date and moves the last, which is what merges.
    let edited = save(&db, vec![input("n1", "person.note", r#"{"p":0.02,"who":"p1"}"#, Some("Ned's son"))], LATER)
      .expect("save");
    assert_eq!(edited[0].created_at, NOW);
    assert_eq!(edited[0].updated_at, LATER);
    assert_eq!(edited[0].note.as_deref(), Some("Ned's son"));
  }

  #[test]
  fn an_entry_without_an_exact_place_is_kept() {
    // A sheet from another edition, or an earlier book of the series.
    let db = memory_db();
    let mut carried = input("p1", "person", r#"{"p":0,"from":"b0"}"#, Some("Kelsier"));
    carried.cfi = None;
    carried.chapter = None;
    let saved = save(&db, vec![carried], NOW).expect("save");
    assert_eq!(saved[0].cfi, "");
    assert_eq!(saved[0].chapter, None);
    assert_eq!(list(&db, "b1").expect("list"), saved);
  }

  #[test]
  fn what_cannot_be_read_back_is_refused_and_nothing_of_the_batch_is_written() {
    let db = memory_db();
    let good = || input("p1", "person", r#"{"p":0.5}"#, Some("Vin"));
    let bad = [
      input("x", "highlight", r#"{"p":0.5}"#, None),
      input("x", "bookmark", r#"{"p":0.5}"#, None),
      input("x", "person.pet", r#"{"p":0.5}"#, None),
      input("", "person", r#"{"p":0.5}"#, None),
      input("x", "person", "not json", None),
      input("x", "person", "[1,2]", None),
      input("x", "person", r#"{"p":1.5}"#, None),
      input("x", "person", r#"{"p":-0.1}"#, None),
      input("x", "person", r#"{"p":"half"}"#, None),
      input("x", "person", &format!(r#"{{"p":0.5,"pad":"{}"}}"#, "x".repeat(MAX_DETAIL)), None)
    ];
    for entry in bad {
      assert!(save(&db, vec![good(), entry], NOW).is_err());
      assert!(list(&db, "b1").expect("list").is_empty(), "nothing written");
    }
    let mut homeless = good();
    homeless.book_id = " ".into();
    assert!(save(&db, vec![homeless], NOW).is_err());
    let many: Vec<PeopleInput> = (0..=MAX_BATCH).map(|n| input(&format!("p{n}"), "person", "{}", Some("x"))).collect();
    assert!(save(&db, many, NOW).is_err());
  }

  #[test]
  fn the_readers_words_are_clipped_but_the_details_never_are() {
    let db = memory_db();
    let long = "é".repeat(MAX_WORDS + 50);
    let saved = save(&db, vec![input("n1", "person.note", r#"{"p":0.1,"who":"p1"}"#, Some(&long))], NOW).expect("save");
    assert_eq!(saved[0].note.as_ref().map(|note| note.chars().count()), Some(MAX_WORDS));
    assert_eq!(saved[0].text.as_deref(), Some(r#"{"p":0.1,"who":"p1"}"#));
    // Words that are only spaces are no words.
    let blank = save(&db, vec![input("n2", "person.note", "{}", Some("   "))], NOW).expect("save");
    assert_eq!(blank[0].note, None);
  }

  #[test]
  fn highlights_and_characters_keep_out_of_each_others_way() {
    let db = memory_db();
    db.put_annotation(&highlight("h1")).expect("save");
    save(&db, vec![input("p1", "person", r#"{"p":0.1}"#, Some("Vin"))], NOW).expect("save");

    // The library's count of highlights is of highlights.
    let counts = db.highlight_counts().expect("counts");
    assert_eq!(counts.len(), 1);
    assert_eq!(counts[0].count, 1);
    // The characters' list has no highlight in it.
    assert_eq!(list(&db, "b1").expect("list").iter().map(|row| row.id.as_str()).collect::<Vec<_>>(), vec!["p1"]);
    // A character entry cannot take a highlight's id, nor delete one.
    assert!(save(&db, vec![input("h1", "person", "{}", Some("Vin"))], LATER).is_err());
    delete(&db, &["h1".to_string()], LATER).expect("delete");
    assert_eq!(db.find_annotation("h1").expect("find"), Some(highlight("h1")));
  }

  #[test]
  fn a_delete_is_a_tombstone_and_deleting_twice_keeps_the_first_date() {
    let db = memory_db();
    save(&db, vec![input("p1", "person", r#"{"p":0.1}"#, Some("Vin"))], NOW).expect("save");
    delete(&db, &["p1".to_string(), "nobody".to_string()], LATER).expect("delete");
    assert!(list(&db, "b1").expect("list").is_empty());
    let row = db.find_annotation("p1").expect("find").expect("kept");
    assert_eq!(row.deleted_at.as_deref(), Some(LATER));
    delete(&db, &["p1".to_string()], "2026-10-06T10:00:00Z").expect("delete");
    assert_eq!(db.find_annotation("p1").expect("find"), Some(row));
    // Saving it again brings it back.
    save(&db, vec![input("p1", "person", r#"{"p":0.1}"#, Some("Vin"))], "2026-10-07T10:00:00Z").expect("save");
    assert_eq!(list(&db, "b1").expect("list").len(), 1);
  }

  #[test]
  fn a_sheet_travels_in_the_backup_and_deletes_travel_too() {
    let from = memory_db();
    let to = memory_db();
    let saved = save(
      &from,
      vec![
        input("p1", "person", r#"{"p":0.02}"#, Some("Jon Snow")),
        input("l1", "person.link", r#"{"p":0.02,"who":"p1","to":"p2","type":"child"}"#, None)
      ],
      NOW
    )
    .expect("save");
    let doc = snapshot(&from, NOW).expect("snapshot");
    apply(&to, &doc).expect("apply");
    let mut arrived = list(&to, "b1").expect("list");
    arrived.sort();
    let mut sent = saved.clone();
    sent.sort();
    assert_eq!(arrived, sent);

    delete(&from, &["l1".to_string()], LATER).expect("delete");
    let merged = merge(&snapshot(&to, LATER).expect("snapshot"), &snapshot(&from, LATER).expect("snapshot"), LATER);
    apply(&to, &merged).expect("apply");
    assert_eq!(list(&to, "b1").expect("list").iter().map(|row| row.id.as_str()).collect::<Vec<_>>(), vec!["p1"]);
  }

  #[test]
  fn delete_all_data_takes_the_sheets_with_it() {
    let db = memory_db();
    save(&db, vec![input("p1", "person", r#"{"p":0.1}"#, Some("Vin"))], NOW).expect("save");
    delete(&db, &["p1".to_string()], LATER).expect("delete");
    save(&db, vec![input("p2", "person", r#"{"p":0.1}"#, Some("Kelsier"))], NOW).expect("save");
    db.clear_all().expect("clear");
    assert!(list(&db, "b1").expect("list").is_empty());
    // Not even a tombstone is left to say there was one.
    assert!(db.all_annotations().expect("all").is_empty());
  }

  #[test]
  fn a_sheet_is_saved_only_as_a_sheet_and_only_as_json() {
    let dir = std::env::temp_dir().join(format!("leaflet-people-test-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("dir");
    let sheet = r#"{"format":"leaflet-characters","version":1,"entries":[]}"#;
    let good = dir.join("Mistborn - characters.JSON");
    write_sheet(good.to_str().expect("path"), sheet).expect("save");
    assert_eq!(fs::read_to_string(&good).expect("read"), sheet);

    for (name, contents) in [
      ("sheet.txt", sheet),
      ("sheet", sheet),
      ("run.bat", sheet),
      ("other.json", r#"{"format":"something-else"}"#),
      ("other.json", "[]"),
      ("other.json", "not json")
    ] {
      let path = dir.join(name);
      assert!(write_sheet(path.to_str().expect("path"), contents).is_err(), "{name}: {contents}");
      assert!(!path.exists(), "{name} was written");
    }
    let huge = format!(r#"{{"format":"leaflet-characters","pad":"{}"}}"#, "x".repeat(MAX_SHEET_BYTES));
    assert!(write_sheet(dir.join("huge.json").to_str().expect("path"), &huge).is_err());
    let _ = fs::remove_dir_all(&dir);
  }

  /// Two devices and a third: each edits a different entry of one sheet, one
  /// edits and one deletes the same entry. Whatever order they meet in, they
  /// end up holding the same sheet, entry by entry.
  #[test]
  fn three_devices_converge_on_a_sheet_entry_by_entry() {
    let row = |id: &str, kind: &str, words: &str, at: &str, deleted: Option<&str>| Annotation {
      id: id.into(),
      book_id: "b1".into(),
      kind: kind.into(),
      cfi: String::new(),
      text: Some(r#"{"p":0.1,"who":"p1"}"#.into()),
      note: Some(words.into()),
      color: None,
      chapter: None,
      created_at: "2026-10-01T00:00:00Z".into(),
      updated_at: at.into(),
      deleted_at: deleted.map(str::to_string)
    };
    let doc = |rows: Vec<Annotation>| {
      let mut doc = SyncDoc::empty(NOW);
      doc.annotations = rows;
      doc
    };
    let shared = vec![
      row("p1", "person", "Jon", "2026-10-01T00:00:00Z", None),
      row("n1", "person.note", "a boy", "2026-10-01T00:00:00Z", None),
      row("n2", "person.note", "of the Watch", "2026-10-01T00:00:00Z", None)
    ];
    let mut a = shared.clone();
    a[0] = row("p1", "person", "Jon Snow", "2026-10-02T00:00:00Z", None);
    a.push(row("a1", "person.alias", "Lord Snow", "2026-10-02T00:00:00Z", None));
    let mut b = shared.clone();
    b[1] = row("n1", "person.note", "Ned's son", "2026-10-02T08:00:00Z", None);
    let mut c = shared.clone();
    c[1] = row("n1", "person.note", "a boy", "2026-10-03T00:00:00Z", Some("2026-10-03T00:00:00Z"));
    let (a, b, c) = (doc(a), doc(b), doc(c));

    let abc = merge(&merge(&a, &b, NOW), &c, NOW);
    let cba = merge(&merge(&c, &b, NOW), &a, NOW);
    let bca = merge(&b, &merge(&c, &a, NOW), NOW);
    assert_eq!(abc.annotations, cba.annotations);
    assert_eq!(abc.annotations, bca.annotations);
    assert_eq!(merge(&abc, &a, NOW).annotations, abc.annotations, "idempotent");

    let words = |id: &str| abc.annotations.iter().find(|r| r.id == id).map(|r| (r.note.clone(), r.deleted_at.is_some()));
    assert_eq!(words("p1"), Some((Some("Jon Snow".into()), false)), "the rename");
    assert_eq!(words("a1"), Some((Some("Lord Snow".into()), false)), "the new name");
    assert_eq!(words("n2"), Some((Some("of the Watch".into()), false)), "untouched");
    assert_eq!(words("n1"), Some((Some("a boy".into()), true)), "the later delete beats the earlier edit");
  }
}
