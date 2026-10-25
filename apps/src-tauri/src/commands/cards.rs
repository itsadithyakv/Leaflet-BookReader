//! Study cards: what a reader turns a highlight or a picture into, to be
//! asked again later (docs/design/study-plan.md). Three kinds: a passage with
//! words hidden ("fill in"), a question with the highlight as its answer, and
//! a picture with one box covered.
//!
//! Kept as rows of the annotations table under a kind of their own, `card`,
//! as the words looked up and the character sheets are (see `people.rs` for
//! why): they are in the backup with no new rule, copies merge row by row
//! (the newest edit of each wins, a removal is a tombstone), and a build that
//! does not know the kind carries the rows along untouched.
//!
//! How a row is used: `cfi` and `chapter` are the place, `note` a question
//! card's question, and `text` a small JSON object with the rest:
//! `t` (the kind: `fill`, `ask` or `pic`), `h` (the highlight it was made
//! from), `s` (the passage, or the answer), `x` (the hidden words of a
//! passage, as `[start, end]` ranges of `s` in UTF-16 units, which is how the
//! page counts), `i` (the picture: `epub:<path in the archive>` or
//! `pdf:<page>`), `m` (the covered box) and `r` (the part of a PDF page shown),
//! both `[left, top, width, height]` in ten-thousandths of the picture, `a`
//! (what is under the box), `g` (the cards of one picture), `p` (how far
//! through the book, 0..1), and the review's own two, as for words: `b` (the
//! box) and `d` (the day it is next due). `src/study/cards.ts` reads that
//! object; here it is checked and written.
//!
//! A card keeps its own copy of its words: a highlight removed (whose
//! tombstone keeps none) does not empty the card made from it. No picture is
//! ever in a row, only where it is in the book.

use super::*;
use super::words::later_than;
use crate::db::{Annotation, Database};
use serde_json::{Map, Value};

pub const CARD_KIND: &str = "card";
const ID_PREFIX: &str = "card:";
const MAX_ID: usize = 100;
/// A card is a passage, not a page: the start of a long highlight is kept.
const MAX_PASSAGE: usize = 600;
const MAX_QUESTION: usize = 300;
const MAX_LABEL: usize = 120;
const MAX_HIDDEN: usize = 60;
const MAX_SHORT: usize = 300;
const MAX_PLACE: usize = 4000;
const MAX_PICTURE_PATH: usize = 1000;
/// The JSON is never clipped (half an object is no object): one too long is refused.
const MAX_DETAIL: usize = 3000;
/// Boxes on one picture: a labelled diagram, not a census.
pub const MAX_GROUP: usize = 40;
/// The review has six boxes, 0 to 5 (`components/pip/arcade/quiz/boxes.ts`).
const MAX_BOX: i64 = 5;
const MAX_DAY: i64 = 60_000;
const MAX_BATCH: usize = 500;
/// A box's sides are kept in ten-thousandths of the picture.
const PARTS: i64 = 10_000;
/// The keys a save writes. Anything else in the row (the review's box, and
/// whatever a later version puts there) stays as it was.
const WRITTEN: [&str; 10] = ["t", "h", "s", "x", "i", "m", "r", "a", "g", "p"];

/// What the app sends for a card: everything but the timestamps and the review.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CardInput {
  pub id: String,
  pub book_id: String,
  pub cfi: Option<String>,
  pub chapter: Option<String>,
  /// A question card's question.
  pub question: Option<String>,
  /// The rest, as `src/study/cards.ts` writes it.
  pub detail: Map<String, Value>
}

/// One answer in a review: the box the card moves to and the day it is due.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CardReview {
  pub id: String,
  #[serde(rename = "box")]
  pub to_box: i64,
  pub due: i64
}

fn detail_of(row: &Annotation) -> Map<String, Value> {
  row
    .text
    .as_deref()
    .and_then(|text| serde_json::from_str::<Value>(text).ok())
    .and_then(|value| value.as_object().cloned())
    .unwrap_or_default()
}

fn clipped(value: Option<String>, max: usize) -> Option<String> {
  value.map(|text| text.chars().take(max).collect::<String>()).filter(|text| !text.trim().is_empty())
}

/// Words of the reader's own (a question, a label): one line, no runs of spaces.
fn tidy(text: &str) -> String {
  text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A passage or an answer: there, and short enough. Kept as written (the
/// hidden words are counted in it), so it is checked rather than tidied.
fn passage(detail: &Map<String, Value>, what: &str) -> Result<String, String> {
  let text = detail.get("s").and_then(Value::as_str).unwrap_or("");
  if text.trim().is_empty() {
    return Err(format!("A card needs {what}."));
  }
  if text.chars().count() > MAX_PASSAGE {
    return Err(format!("A card's {what} is too long."));
  }
  Ok(text.to_string())
}

/// `[left, top, width, height]` in ten-thousandths, inside the picture and not empty.
fn rect(value: &Value) -> Option<[i64; 4]> {
  let parts = value.as_array()?;
  if parts.len() != 4 {
    return None;
  }
  let mut out = [0i64; 4];
  for (index, part) in parts.iter().enumerate() {
    out[index] = part.as_i64().filter(|n| (0..=PARTS).contains(n))?;
  }
  let [left, top, width, height] = out;
  (width > 0 && height > 0 && left + width <= PARTS && top + height <= PARTS).then_some(out)
}

/// The hidden words: in order, not overlapping, inside the passage.
fn hidden(value: Option<&Value>, length: usize) -> Option<Vec<[usize; 2]>> {
  let ranges = value?.as_array()?;
  if ranges.is_empty() || ranges.len() > MAX_HIDDEN {
    return None;
  }
  let mut out = Vec::with_capacity(ranges.len());
  let mut after = 0usize;
  for range in ranges {
    let pair = range.as_array().filter(|pair| pair.len() == 2)?;
    let start = usize::try_from(pair[0].as_u64()?).ok()?;
    let end = usize::try_from(pair[1].as_u64()?).ok()?;
    if start < after || start >= end || end > length {
      return None;
    }
    after = end;
    out.push([start, end]);
  }
  Some(out)
}

/// Where a picture is in the book: a path in an EPUB's archive, or a PDF's page.
fn picture_place(value: Option<&Value>) -> Option<String> {
  let place = value?.as_str()?.trim();
  if let Some(page) = place.strip_prefix("pdf:") {
    return page.parse::<u32>().ok().filter(|page| *page >= 1).map(|page| format!("pdf:{page}"));
  }
  let path = place.strip_prefix("epub:")?;
  (!path.is_empty() && path.chars().count() <= MAX_PICTURE_PATH).then(|| place.to_string())
}

/// The row an input becomes, or why it cannot be saved. `existing` is the row
/// with that id, if there is one.
fn checked(input: CardInput, existing: Option<&Annotation>, now: &str) -> Result<Annotation, String> {
  let id = input.id.trim().to_string();
  if !id.starts_with(ID_PREFIX) || id.len() <= ID_PREFIX.len() || id.len() > MAX_ID {
    return Err("A card needs an id of its own.".to_string());
  }
  if input.book_id.trim().is_empty() {
    return Err("A card is kept with the book it was made from.".to_string());
  }
  // An id is random, so this is a mistake rather than a clash: a card never
  // overwrites a highlight, a word or a character.
  if existing.is_some_and(|row| row.kind != CARD_KIND) {
    return Err("That id belongs to something else.".to_string());
  }
  if existing.is_some_and(|row| row.deleted_at.is_some()) {
    return Err("That card was removed.".to_string());
  }
  let given = &input.detail;
  let kind = given.get("t").and_then(Value::as_str).unwrap_or("");
  let mut written = Map::new();
  written.insert("t".into(), Value::from(kind));
  let mut question = None;
  match kind {
    "fill" => {
      let text = passage(given, "a passage")?;
      let ranges = hidden(given.get("x"), text.encode_utf16().count()).ok_or_else(|| "Hide a word or two to make a card.".to_string())?;
      written.insert("s".into(), Value::from(text));
      written.insert("x".into(), serde_json::json!(ranges));
    }
    "ask" => {
      let asked = clipped(input.question.as_deref().map(tidy), MAX_QUESTION).ok_or_else(|| "Write the question.".to_string())?;
      written.insert("s".into(), Value::from(passage(given, "an answer")?));
      question = Some(asked);
    }
    "pic" => {
      let place = picture_place(given.get("i")).ok_or_else(|| "A picture card needs its picture.".to_string())?;
      let mask = given.get("m").and_then(rect).ok_or_else(|| "Draw a box over the picture.".to_string())?;
      let group = given.get("g").and_then(Value::as_str).map(str::trim).filter(|g| !g.is_empty() && g.len() <= 64);
      written.insert("i".into(), Value::from(place));
      written.insert("m".into(), serde_json::json!(mask));
      written.insert("g".into(), Value::from(group.ok_or_else(|| "A picture card needs its picture.".to_string())?));
      if let Some(shown) = given.get("r") {
        written.insert("r".into(), serde_json::json!(rect(shown).ok_or_else(|| "That part of the page is not on it.".to_string())?));
      }
      if let Some(label) = clipped(given.get("a").and_then(Value::as_str).map(tidy), MAX_LABEL) {
        written.insert("a".into(), Value::from(label));
      }
    }
    _ => return Err("Unknown kind of card.".to_string())
  }
  if kind != "pic" {
    if let Some(from) = clipped(given.get("h").and_then(Value::as_str).map(str::to_string), 200) {
      written.insert("h".into(), Value::from(from));
    }
  }
  if let Some(place) = given.get("p") {
    let p = place.as_f64().filter(|p| (0.0..=1.0).contains(p)).ok_or_else(|| "A card's place is not in the book.".to_string())?;
    // Six decimals place a card in the longest book, and keep the row short.
    written.insert("p".into(), serde_json::json!((p * 1e6).round() / 1e6));
  }

  // What the row already holds stays (the review's box, and anything a later
  // version put there); what a save writes is written over, or taken away.
  let mut detail = existing.map(detail_of).unwrap_or_default();
  for key in WRITTEN {
    detail.remove(key);
  }
  detail.extend(written);
  let text = Value::Object(detail).to_string();
  if text.len() > MAX_DETAIL {
    return Err("That card is too long.".to_string());
  }
  Ok(Annotation {
    id,
    book_id: input.book_id,
    kind: CARD_KIND.to_string(),
    cfi: clipped(input.cfi, MAX_PLACE).unwrap_or_default(),
    text: Some(text),
    note: question,
    color: None,
    chapter: clipped(input.chapter.as_deref().map(tidy), MAX_SHORT),
    created_at: existing.map(|row| row.created_at.clone()).unwrap_or_else(|| now.to_string()),
    updated_at: now.to_string(),
    deleted_at: None
  })
}

/// Every card kept, the most recently made first, without removed ones.
fn list(db: &Database) -> Result<Vec<Annotation>, String> {
  let mut rows: Vec<Annotation> = db
    .all_annotations()
    .map_err(|e| e.to_string())?
    .into_iter()
    .filter(|row| row.kind == CARD_KIND && row.deleted_at.is_none())
    .collect();
  rows.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| a.id.cmp(&b.id)));
  Ok(rows)
}

/// Makes cards, or edits them. All of them or none: every one is checked
/// before the first is written (a picture's boxes are saved together).
fn save(db: &Database, inputs: Vec<CardInput>, now: &str) -> Result<Vec<Annotation>, String> {
  if inputs.len() > MAX_BATCH {
    return Err("Too many cards at once.".to_string());
  }
  let mut rows: Vec<Annotation> = Vec::with_capacity(inputs.len());
  for input in inputs {
    let existing = db.find_annotation(input.id.trim()).map_err(|e| e.to_string())?;
    let row = checked(input, existing.as_ref(), now)?;
    if rows.iter().any(|other| other.id == row.id) {
      return Err("The same card twice.".to_string());
    }
    rows.push(row);
  }
  // A picture's boxes, counted with those already kept that this save leaves be.
  let groups: std::collections::BTreeSet<String> = rows.iter().filter_map(|row| detail_of(row).get("g").and_then(Value::as_str).map(str::to_string)).collect();
  if !groups.is_empty() {
    let kept = list(db)?;
    for group in groups {
      let in_group = |row: &Annotation| detail_of(row).get("g").and_then(Value::as_str) == Some(group.as_str());
      let saving = rows.iter().filter(|row| in_group(row)).count();
      let others = kept.iter().filter(|row| in_group(row) && !rows.iter().any(|saved| saved.id == row.id)).count();
      if saving + others > MAX_GROUP {
        return Err(format!("A picture can have {MAX_GROUP} boxes at most."));
      }
    }
  }
  for row in &rows {
    db.put_annotation(row).map_err(|e| e.to_string())?;
  }
  Ok(rows)
}

/// Moves cards between the review's boxes. All of them or none. Only cards,
/// and only ones still kept.
fn review(db: &Database, reviews: &[CardReview], now: &str) -> Result<Vec<Annotation>, String> {
  if reviews.len() > MAX_BATCH {
    return Err("Too many cards at once.".to_string());
  }
  let mut rows = Vec::with_capacity(reviews.len());
  for answer in reviews {
    if !(0..=MAX_BOX).contains(&answer.to_box) || !(0..=MAX_DAY).contains(&answer.due) {
      return Err("That is not a box a card can be in.".to_string());
    }
    let row = db
      .find_annotation(&answer.id)
      .map_err(|e| e.to_string())?
      .filter(|row| row.kind == CARD_KIND && row.deleted_at.is_none())
      .ok_or_else(|| "That card is not kept.".to_string())?;
    let mut detail = detail_of(&row);
    detail.insert("b".into(), serde_json::json!(answer.to_box));
    detail.insert("d".into(), serde_json::json!(answer.due));
    let text = Value::Object(detail).to_string();
    if text.len() > MAX_DETAIL {
      return Err("That card is too long.".to_string());
    }
    rows.push(Annotation { text: Some(text), updated_at: now.to_string(), ..row });
  }
  for row in &rows {
    db.put_annotation(row).map_err(|e| e.to_string())?;
  }
  Ok(rows)
}

/// Removes cards. Each stays as a tombstone until every copy has seen it,
/// with its words, so Undo can put it back as it was (a card's words are its
/// own, a few hundred bytes, unlike a highlight's). Only cards.
fn delete(db: &Database, ids: &[String], now: &str) -> Result<(), String> {
  if ids.len() > MAX_BATCH {
    return Err("Too many cards at once.".to_string());
  }
  for id in ids {
    if let Some(mut row) = db.find_annotation(id).map_err(|e| e.to_string())? {
      if row.kind == CARD_KIND && row.deleted_at.is_none() {
        row.updated_at = now.to_string();
        row.deleted_at = Some(now.to_string());
        db.put_annotation(&row).map_err(|e| e.to_string())?;
      }
    }
  }
  Ok(())
}

/// Puts removed cards back as they were, the review's box included: the undo
/// of a removal. Only cards, only removed ones, and only rows that still hold
/// a card (a removal "Start empty" sends keeps nothing). Each is dated after
/// its removal (`words::later_than`), so the other copies take it back too.
fn restore(db: &Database, ids: &[String], now: &str) -> Result<Vec<Annotation>, String> {
  if ids.len() > MAX_BATCH {
    return Err("Too many cards at once.".to_string());
  }
  let mut back = Vec::new();
  for id in ids {
    let Some(row) = db.find_annotation(id).map_err(|e| e.to_string())? else {
      continue;
    };
    let whole = detail_of(&row).get("t").and_then(Value::as_str).is_some_and(|t| ["fill", "ask", "pic"].contains(&t));
    if row.kind != CARD_KIND || row.deleted_at.is_none() || !whole {
      continue;
    }
    let updated_at = later_than(&row.updated_at, now);
    let row = Annotation { deleted_at: None, updated_at, ..row };
    db.put_annotation(&row).map_err(|e| e.to_string())?;
    back.push(row);
  }
  Ok(back)
}

#[tauri::command(async)]
pub fn cards_list(state: State<'_, AppState>) -> Result<Vec<Annotation>, String> {
  let db = state.db.guard();
  list(&db)
}

#[tauri::command]
pub fn cards_save(cards: Vec<CardInput>, state: State<'_, AppState>) -> Result<Vec<Annotation>, String> {
  let db = state.db.guard();
  save(&db, cards, &db::now_iso())
}

#[tauri::command]
pub fn cards_review(reviews: Vec<CardReview>, state: State<'_, AppState>) -> Result<Vec<Annotation>, String> {
  let db = state.db.guard();
  review(&db, &reviews, &db::now_iso())
}

#[tauri::command]
pub fn cards_delete(ids: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.guard();
  delete(&db, &ids, &db::now_iso())
}

#[tauri::command]
pub fn cards_restore(ids: Vec<String>, state: State<'_, AppState>) -> Result<Vec<Annotation>, String> {
  let db = state.db.guard();
  restore(&db, &ids, &db::now_iso())
}

/// A book's cards as a CSV file is a few hundred kilobytes for the most studied book.
const MAX_EXPORT_BYTES: usize = 8 * 1024 * 1024;
/// What every cards file begins with (`src/study/export.ts`).
const EXPORT_HEAD: &str = "\u{feff}\"front\",\"back\",\"book\",\"place\"";

/// Writes a book's cards where the reader chose (the save dialog's path).
/// Only a `.csv` file, and only cards: this is not a way to write anything
/// anywhere.
fn write_export(path: &str, contents: &str) -> Result<(), String> {
  let target = std::path::Path::new(path);
  let is_csv = target.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("csv"));
  if !is_csv {
    return Err("Cards are saved as a .csv file.".to_string());
  }
  if contents.len() > MAX_EXPORT_BYTES {
    return Err("That is too many cards to save at once.".to_string());
  }
  if !contents.starts_with(EXPORT_HEAD) {
    return Err("Those are not cards.".to_string());
  }
  fs::write(target, contents).map_err(|e| format!("Couldn't save the cards: {e}"))
}

/// Saves a book's cards as a file, for another flashcard app.
#[tauri::command]
pub fn cards_export(path: String, contents: String) -> Result<(), String> {
  write_export(&path, &contents)
}

/// A picture from inside an EPUB, for a picture card: that one file, unzipped
/// from the book on this device (a converted book's EPUB copy), not the
/// whole book handed over. Only pictures, and none past 20 MB.
#[tauri::command]
pub async fn book_picture(book_id: String, path: String, state: State<'_, AppState>) -> Result<tauri::ipc::Response, String> {
  const LIMIT: u64 = 20 * 1024 * 1024;
  let file = {
    let db = state.db.guard();
    let book = db.find_by_id(&book_id).map_err(|e| e.to_string())?.ok_or_else(|| "Book not found".to_string())?;
    let converted = storage::converted_epub_path(&book.file_hash).ok().filter(|path| path.exists());
    converted.unwrap_or_else(|| std::path::PathBuf::from(&book.local_path))
  };
  if !file.to_string_lossy().to_ascii_lowercase().ends_with(".epub") {
    return Err("That book has no pictures to show here.".to_string());
  }
  tauri::async_runtime::spawn_blocking(move || {
    storage::epub::picture(&file, &path, LIMIT)
      .map_err(|e| e.to_string())?
      .map(tauri::ipc::Response::new)
      .ok_or_else(|| "That picture is not in the book.".to_string())
  })
  .await
  .map_err(|e| format!("Picture task failed: {e}"))?
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;
  use crate::sync::merge::merge;
  use crate::sync::store::{apply, snapshot};

  const NOW: &str = "2026-10-25T10:00:00Z";
  const LATER: &str = "2026-10-26T10:00:00Z";

  fn detail(pairs: Value) -> Map<String, Value> {
    pairs.as_object().cloned().expect("object")
  }

  fn fill(id: &str) -> CardInput {
    CardInput {
      id: id.into(),
      book_id: "b1".into(),
      cfi: Some("epubcfi(/6/8!/4/2,/1:0,/1:40)".into()),
      chapter: Some("  The   heart ".into()),
      question: None,
      detail: detail(serde_json::json!({
        "t": "fill",
        "h": "h1",
        "s": "The mitral valve has two cusps.",
        "x": [[4, 10], [25, 30]],
        "p": 0.123_456_78
      }))
    }
  }

  fn ask(id: &str) -> CardInput {
    CardInput {
      id: id.into(),
      book_id: "b1".into(),
      cfi: Some("epubcfi(/6/8!/4/2,/1:0,/1:40)".into()),
      chapter: None,
      question: Some(" How many cusps   has the mitral valve? ".into()),
      detail: detail(serde_json::json!({ "t": "ask", "h": "h1", "s": "Two.", "p": 0.5 }))
    }
  }

  fn picture(id: &str, group: &str) -> CardInput {
    CardInput {
      id: id.into(),
      book_id: "b1".into(),
      cfi: Some("pdf:12".into()),
      chapter: Some("Bones".into()),
      question: None,
      detail: detail(serde_json::json!({
        "t": "pic",
        "i": "pdf:12",
        "m": [1000, 2000, 1500, 400],
        "r": [500, 500, 9000, 6000],
        "a": "Femur",
        "g": group
      }))
    }
  }

  fn kept(row: &Annotation) -> Value {
    serde_json::from_str(row.text.as_deref().expect("text")).expect("json")
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
  fn each_kind_of_card_is_kept_with_its_book_and_its_place() {
    let db = memory_db();
    let rows = save(&db, vec![fill("card:f"), ask("card:a"), picture("card:p", "g1")], NOW).expect("save");
    assert_eq!(rows.len(), 3);

    let made = &rows[0];
    assert_eq!((made.kind.as_str(), made.book_id.as_str()), ("card", "b1"));
    assert_eq!(made.cfi, "epubcfi(/6/8!/4/2,/1:0,/1:40)");
    assert_eq!(made.chapter.as_deref(), Some("The heart"));
    assert_eq!(made.note, None);
    let f = kept(made);
    assert_eq!(f["t"], "fill");
    assert_eq!(f["s"], "The mitral valve has two cusps.", "the passage as it was, the hidden words counted in it");
    assert_eq!(f["x"], serde_json::json!([[4, 10], [25, 30]]));
    assert_eq!(f["h"], "h1");
    assert_eq!(f["p"], 0.123457);
    assert!(f.get("b").is_none(), "not asked yet");

    let a = &rows[1];
    assert_eq!(a.note.as_deref(), Some("How many cusps has the mitral valve?"));
    assert_eq!(kept(a)["s"], "Two.");

    let p = kept(&rows[2]);
    assert_eq!(p["i"], "pdf:12");
    assert_eq!(p["m"], serde_json::json!([1000, 2000, 1500, 400]));
    assert_eq!(p["r"], serde_json::json!([500, 500, 9000, 6000]));
    assert_eq!((p["a"].as_str(), p["g"].as_str()), (Some("Femur"), Some("g1")));
    assert!(p.get("h").is_none());

    let listed = list(&db).expect("list");
    assert_eq!(listed.len(), 3);
    // Every row is small: the account's copy is to hold thousands.
    assert!(listed.iter().all(|row| row.text.as_ref().is_some_and(|text| text.len() < 400)));
  }

  #[test]
  fn what_is_not_a_card_is_refused_and_nothing_of_the_batch_is_written() {
    let db = memory_db();
    let mut bad: Vec<CardInput> = Vec::new();
    let mut no_id = fill("highlight-1");
    no_id.id = "h1".into();
    bad.push(no_id);
    let mut no_book = fill("card:1");
    no_book.book_id = " ".into();
    bad.push(no_book);
    let mut nothing_hidden = fill("card:1");
    nothing_hidden.detail.insert("x".into(), serde_json::json!([]));
    bad.push(nothing_hidden);
    let mut past_the_end = fill("card:1");
    past_the_end.detail.insert("x".into(), serde_json::json!([[4, 99]]));
    bad.push(past_the_end);
    let mut overlapping = fill("card:1");
    overlapping.detail.insert("x".into(), serde_json::json!([[4, 10], [8, 12]]));
    bad.push(overlapping);
    let mut long = fill("card:1");
    long.detail.insert("s".into(), Value::from("é".repeat(MAX_PASSAGE + 1)));
    bad.push(long);
    let mut no_question = ask("card:1");
    no_question.question = Some("   ".into());
    bad.push(no_question);
    let mut no_answer = ask("card:1");
    no_answer.detail.insert("s".into(), Value::from(" "));
    bad.push(no_answer);
    let mut no_box = picture("card:1", "g");
    no_box.detail.insert("m".into(), serde_json::json!([9000, 0, 2000, 100]));
    bad.push(no_box);
    let mut nowhere = picture("card:1", "g");
    nowhere.detail.insert("i".into(), Value::from("http://elsewhere/x.png"));
    bad.push(nowhere);
    let mut page_zero = picture("card:1", "g");
    page_zero.detail.insert("i".into(), Value::from("pdf:0"));
    bad.push(page_zero);
    let mut no_group = picture("card:1", "g");
    no_group.detail.remove("g");
    bad.push(no_group);
    let mut odd = fill("card:1");
    odd.detail.insert("t".into(), Value::from("essay"));
    bad.push(odd);
    let mut far = fill("card:1");
    far.detail.insert("p".into(), Value::from(1.5));
    bad.push(far);
    for input in bad {
      // With a good card beside it, which is not written either.
      assert!(save(&db, vec![fill("card:good"), input], NOW).is_err());
    }
    assert!(db.all_annotations().expect("all").is_empty(), "nothing written");
    assert!(save(&db, vec![fill("card:x"), fill("card:x")], NOW).is_err(), "the same card twice");
  }

  #[test]
  fn cards_and_everything_else_keep_out_of_each_others_way() {
    let db = memory_db();
    db.put_annotation(&highlight("h1")).expect("save");
    db.put_annotation(&highlight("card:taken")).expect("save");
    save(&db, vec![fill("card:f")], NOW).expect("save");
    // The library counts highlights, not cards; the reader lists none of them.
    assert_eq!(db.highlight_counts().expect("counts")[0].count, 2);
    assert_eq!(list(&db).expect("list").iter().map(|row| row.id.as_str()).collect::<Vec<_>>(), vec!["card:f"]);
    // A card cannot take a highlight's row, review it or remove it.
    assert!(save(&db, vec![fill("card:taken")], LATER).is_err());
    assert!(review(&db, &[CardReview { id: "h1".into(), to_box: 1, due: 20_000 }], LATER).is_err());
    delete(&db, &["h1".to_string(), "card:taken".to_string()], LATER).expect("delete");
    assert_eq!(db.find_annotation("h1").expect("find"), Some(highlight("h1")));
    assert_eq!(db.find_annotation("card:taken").expect("find"), Some(highlight("card:taken")));
    assert!(!PEOPLE_KINDS.contains(&CARD_KIND));
    // And the diary's marks are not cards.
    assert!(super::super::diary::sources(&db).expect("sources").marks.iter().all(|mark| mark.kind != CARD_KIND));
  }

  #[test]
  fn an_edit_keeps_the_review_and_what_a_later_version_wrote() {
    let db = memory_db();
    let made = save(&db, vec![ask("card:a")], NOW).expect("save").remove(0);
    review(&db, &[CardReview { id: made.id.clone(), to_box: 3, due: 20_400 }], NOW).expect("review");
    // A later version's own key, in the row.
    let mut row = db.find_annotation(&made.id).expect("find").expect("row");
    let mut extra = detail_of(&row);
    extra.insert("future".into(), Value::from(1));
    row.text = Some(Value::Object(extra).to_string());
    db.put_annotation(&row).expect("save");

    let mut edited = ask("card:a");
    edited.question = Some("Mitral valve: how many cusps?".into());
    edited.detail.remove("h");
    let after = save(&db, vec![edited], LATER).expect("save").remove(0);
    assert_eq!(after.created_at, NOW);
    assert_eq!(after.updated_at, LATER);
    assert_eq!(after.note.as_deref(), Some("Mitral valve: how many cusps?"));
    let detail = kept(&after);
    assert_eq!((detail["b"].as_i64(), detail["d"].as_i64()), (Some(3), Some(20_400)), "the box is not lost to an edit");
    assert_eq!(detail["future"], 1);
    assert!(detail.get("h").is_none(), "what the edit took out is out");
  }

  #[test]
  fn a_picture_has_forty_boxes_at_most() {
    let db = memory_db();
    let many: Vec<CardInput> = (0..MAX_GROUP).map(|n| picture(&format!("card:{n}"), "g1")).collect();
    save(&db, many, NOW).expect("save");
    assert!(save(&db, vec![picture("card:one-more", "g1")], NOW).is_err());
    // An edit of one already there is no new box; another picture is another count.
    save(&db, vec![picture("card:3", "g1"), picture("card:other", "g2")], LATER).expect("save");
    delete(&db, &["card:0".to_string()], LATER).expect("delete");
    save(&db, vec![picture("card:one-more", "g1")], LATER).expect("room again");
  }

  #[test]
  fn the_review_moves_a_card_between_boxes_all_or_nothing() {
    let db = memory_db();
    save(&db, vec![fill("card:f"), ask("card:a")], NOW).expect("save");
    review(&db, &[CardReview { id: "card:f".into(), to_box: 1, due: 20_366 }, CardReview { id: "card:a".into(), to_box: 0, due: 20_365 }], LATER).expect("review");
    let f = db.find_annotation("card:f").expect("find").expect("row");
    assert_eq!((kept(&f)["b"].as_i64(), kept(&f)["d"].as_i64()), (Some(1), Some(20_366)));
    assert_eq!(kept(&f)["s"], "The mitral valve has two cusps.", "the rest as it was");
    assert_eq!((f.created_at.as_str(), f.updated_at.as_str()), (NOW, LATER));
    let good = CardReview { id: "card:f".into(), to_box: 5, due: 20_400 };
    for bad in [
      CardReview { id: "card:a".into(), to_box: MAX_BOX + 1, due: 20_400 },
      CardReview { id: "card:a".into(), to_box: -1, due: 20_400 },
      CardReview { id: "card:a".into(), to_box: 1, due: MAX_DAY + 1 },
      CardReview { id: "card:nothing".into(), to_box: 1, due: 20_400 }
    ] {
      assert!(review(&db, &[good.clone(), bad], LATER).is_err());
      assert_eq!(kept(&db.find_annotation("card:f").expect("find").expect("row"))["b"], 1, "nothing of the batch was written");
    }
  }

  #[test]
  fn a_removed_card_is_a_tombstone_that_keeps_it_for_undo() {
    let db = memory_db();
    save(&db, vec![fill("card:f")], NOW).expect("save");
    review(&db, &[CardReview { id: "card:f".into(), to_box: 2, due: 20_400 }], NOW).expect("review");
    let before = db.find_annotation("card:f").expect("find").expect("row");
    delete(&db, &["card:f".to_string(), "nobody".to_string()], LATER).expect("delete");
    assert!(list(&db).expect("list").is_empty());
    let gone = db.find_annotation("card:f").expect("find").expect("tombstone");
    assert_eq!(gone.deleted_at.as_deref(), Some(LATER));
    // Removed twice, the first date stays; it cannot be reviewed or edited while it is gone.
    delete(&db, &["card:f".to_string()], "2026-10-27T10:00:00Z").expect("delete");
    assert_eq!(db.find_annotation("card:f").expect("find"), Some(gone));
    assert!(review(&db, &[CardReview { id: "card:f".into(), to_box: 1, due: 20_400 }], LATER).is_err());
    assert!(save(&db, vec![fill("card:f")], LATER).is_err());

    let back = restore(&db, &["card:f".to_string(), "nobody".to_string()], "2026-10-27T10:00:00Z").expect("restore");
    assert_eq!(back.len(), 1);
    assert_eq!(Annotation { updated_at: before.updated_at.clone(), ..back[0].clone() }, before, "as it was, its box too");
    assert_eq!(list(&db).expect("list"), back);
    // Not removed, a highlight, and a removal that kept nothing: left alone.
    assert!(restore(&db, &["card:f".to_string()], "2026-10-28T10:00:00Z").expect("restore").is_empty());
    let mut gone_highlight = highlight("h1");
    gone_highlight.deleted_at = Some(NOW.into());
    db.put_annotation(&gone_highlight).expect("save");
    let emptied = save(&db, vec![ask("card:a")], NOW).expect("save").remove(0);
    db.put_annotation(&Annotation { text: None, note: None, deleted_at: Some(LATER.into()), updated_at: LATER.into(), ..emptied.clone() }).expect("save");
    assert!(restore(&db, &["h1".to_string(), emptied.id.clone()], "2026-10-28T10:00:00Z").expect("restore").is_empty());
    assert_eq!(db.find_annotation("h1").expect("find"), Some(gone_highlight));
  }

  #[test]
  fn an_undo_is_dated_after_its_removal_even_on_a_clock_that_stepped_back() {
    let db = memory_db();
    save(&db, vec![fill("card:f")], NOW).expect("save");
    delete(&db, &["card:f".to_string()], LATER).expect("delete");
    let same = restore(&db, &["card:f".to_string()], LATER).expect("restore");
    assert_eq!(same[0].updated_at, "2026-10-26T10:00:00.001Z");
    delete(&db, &["card:f".to_string()], "2026-10-26T10:00:00.002Z").expect("delete");
    let earlier = restore(&db, &["card:f".to_string()], NOW).expect("restore");
    assert_eq!(earlier[0].updated_at, "2026-10-26T10:00:00.003Z");
  }

  #[test]
  fn cards_travel_in_the_backup_and_the_newest_copy_of_one_wins() {
    let from = memory_db();
    let to = memory_db();
    save(&from, vec![fill("card:f"), picture("card:p", "g1")], NOW).expect("save");
    apply(&to, &snapshot(&from, NOW).expect("snapshot")).expect("apply");
    assert_eq!(list(&to).expect("list"), list(&from).expect("list"));

    // One device reviews a card, the other edits it later: the edit wins, either way round.
    review(&to, &[CardReview { id: "card:f".into(), to_box: 2, due: 20_400 }], LATER).expect("review");
    let mut edited = fill("card:f");
    edited.detail.insert("x".into(), serde_json::json!([[4, 10]]));
    save(&from, vec![edited], "2026-10-27T10:00:00Z").expect("save");
    let (a, b) = (snapshot(&to, LATER).expect("snapshot"), snapshot(&from, LATER).expect("snapshot"));
    let merged = merge(&a, &b, LATER);
    assert_eq!(merged.annotations, merge(&b, &a, LATER).annotations);
    apply(&to, &merged).expect("apply");
    let card = to.find_annotation("card:f").expect("find").expect("row");
    assert_eq!(kept(&card)["x"], serde_json::json!([[4, 10]]));

    // Removed on one device after the other answered it: the removal wins everywhere.
    review(&to, &[CardReview { id: "card:p".into(), to_box: 1, due: 20_400 }], LATER).expect("review");
    delete(&from, &["card:p".to_string()], "2026-10-28T10:00:00Z").expect("delete");
    let merged = merge(&snapshot(&to, LATER).expect("snapshot"), &snapshot(&from, LATER).expect("snapshot"), LATER);
    apply(&to, &merged).expect("apply");
    assert_eq!(list(&to).expect("list").iter().map(|row| row.id.as_str()).collect::<Vec<_>>(), vec!["card:f"]);
  }

  #[test]
  fn a_card_put_back_comes_back_on_the_other_copies_too() {
    let here = memory_db();
    let there = memory_db();
    save(&here, vec![ask("card:a")], NOW).expect("save");
    apply(&there, &snapshot(&here, NOW).expect("snapshot")).expect("apply");
    delete(&here, &["card:a".to_string()], LATER).expect("delete");
    let removed = merge(&snapshot(&there, LATER).expect("snapshot"), &snapshot(&here, LATER).expect("snapshot"), LATER);
    apply(&there, &removed).expect("apply");
    assert!(list(&there).expect("list").is_empty());
    // Undone in the same millisecond as the removal: the card still wins, either way round.
    restore(&here, &["card:a".to_string()], LATER).expect("restore");
    let (a, b) = (snapshot(&there, LATER).expect("snapshot"), snapshot(&here, LATER).expect("snapshot"));
    let merged = merge(&a, &b, LATER);
    assert_eq!(merged.annotations, merge(&b, &a, LATER).annotations);
    apply(&there, &merged).expect("apply");
    apply(&here, &merged).expect("apply");
    for db in [&here, &there] {
      let cards = list(db).expect("list");
      assert_eq!(cards.len(), 1);
      assert_eq!(cards[0].note.as_deref(), Some("How many cusps has the mitral valve?"));
    }
  }

  #[test]
  fn an_export_is_written_only_as_a_csv_of_cards() {
    let dir = std::env::temp_dir().join(format!("leaflet-cards-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("dir");
    let file = dir.join("anatomy-cards.csv");
    let good = format!("{EXPORT_HEAD}\r\n\"The [...] valve\",\"The mitral valve\",\"Anatomy\",\"The heart\"\r\n");
    write_export(file.to_str().expect("path"), &good).expect("write");
    assert_eq!(fs::read_to_string(&file).expect("read"), good);
    assert!(write_export(dir.join("x.txt").to_str().expect("path"), &good).is_err(), "not a .csv");
    assert!(write_export(file.to_str().expect("path"), "anything at all").is_err(), "not cards");
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn delete_all_data_takes_the_cards_with_it() {
    let db = memory_db();
    save(&db, vec![fill("card:f"), ask("card:a")], NOW).expect("save");
    delete(&db, &["card:f".to_string()], LATER).expect("delete");
    db.clear_all().expect("clear");
    assert!(db.all_annotations().expect("all").is_empty(), "not even a tombstone");
  }
}
