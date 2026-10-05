//! Words the reader looked up: each word that got an answer, with the short
//! meaning that was shown, the book and the place it was looked up at. The
//! Attic Arcade's word quiz is played with them.
//!
//! Kept as rows of the annotations table under a kind of their own, `word`,
//! as the character sheets are (see `people.rs` for why): they are in the
//! backup with no new rule, copies merge row by row, and a build that does
//! not know the kind carries the rows along untouched.
//!
//! How a row is used: `note` is the word, `cfi` and `chapter` the place it was
//! last looked up at, and `text` a small JSON object with the rest:
//! `p` (how far through the book, 0..1), `m` (the meaning that was shown),
//! `n` (how many times it has been looked up), `at` (when it last was), `l`
//! (the language), `pos` (its part of speech, when it has one), and the quiz's
//! own two: `b` (the box the word is in) and `d` (the day it is next due, as a
//! count of days). `src/readers/words/rows.ts` reads that object; here it is
//! written and checked.
//!
//! A word has one row however often it is looked up: the row's id is made
//! from the word and its language, so a second look-up (in any book, on any
//! device) lands on the first.

use super::*;
use crate::db::{Annotation, Database};

pub const WORD_KIND: &str = "word";
/// A look-up is six words or eighty characters at most (`lookup/mod.rs`).
const MAX_WORD: usize = 80;
/// The meaning kept is the first one shown: a line, not the entry.
const MAX_MEANING: usize = 300;
const MAX_SHORT: usize = 300;
const MAX_PLACE: usize = 4000;
/// The JSON is never clipped (half an object is no object): one too long is refused.
const MAX_DETAIL: usize = 2000;
/// The quiz has six boxes, 0 to 5 (`components/pip/arcade/quiz/boxes.ts`).
const MAX_BOX: i64 = 5;
/// A day as a count of days since 1970: a century and a half of them.
const MAX_DAY: i64 = 60_000;
const MAX_BATCH: usize = 500;

/// What the reader's look-up sends: the word, what it means, and where.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordInput {
  pub word: String,
  /// The book's language ("en", "fr-FR"); English when it has none.
  pub language: Option<String>,
  pub meaning: String,
  pub part: Option<String>,
  pub book_id: String,
  pub cfi: Option<String>,
  pub chapter: Option<String>,
  /// How far through the book, 0..1.
  pub p: f64
}

/// One answer in the quiz: the box the word moves to and the day it is due.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordReview {
  pub id: String,
  #[serde(rename = "box")]
  pub to_box: i64,
  pub due: i64
}

fn tidy(text: &str) -> String {
  text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clipped(value: Option<String>, max: usize) -> Option<String> {
  value.map(|text| text.chars().take(max).collect::<String>()).filter(|text| !text.trim().is_empty())
}

/// The language as the look-up reads it: the tag's first part ("en-US" and "en" are one).
fn language_key(language: Option<&str>) -> String {
  let key: String = language
    .unwrap_or("")
    .trim()
    .split(['-', '_'])
    .next()
    .unwrap_or("")
    .chars()
    .filter(|c| c.is_ascii_alphabetic())
    .take(8)
    .collect::<String>()
    .to_ascii_lowercase();
  if key.is_empty() { "en".to_string() } else { key }
}

/// The one row a word has: by its language and the word itself, case aside.
pub fn word_id(word: &str, language: Option<&str>) -> String {
  format!("word:{}:{}", language_key(language), tidy(word).to_lowercase())
}

fn detail_of(row: &Annotation) -> serde_json::Map<String, serde_json::Value> {
  row
    .text
    .as_deref()
    .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
    .and_then(|value| value.as_object().cloned())
    .unwrap_or_default()
}

/// Every word kept, the most recently added first, without removed ones.
fn list(db: &Database) -> Result<Vec<Annotation>, String> {
  let mut rows: Vec<Annotation> = db
    .all_annotations()
    .map_err(|e| e.to_string())?
    .into_iter()
    .filter(|row| row.kind == WORD_KIND && row.deleted_at.is_none())
    .collect();
  rows.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| a.id.cmp(&b.id)));
  Ok(rows)
}

/// Keeps a word that was looked up. The first time it makes the word's row;
/// after that it counts the look-up, and moves the row to the new place and
/// the meaning now shown. The quiz's box stays as it was. A word the reader
/// removed and then looks up again starts afresh.
fn record(db: &Database, input: WordInput, now: &str) -> Result<Annotation, String> {
  let word = tidy(&input.word);
  if word.is_empty() || word.chars().count() > MAX_WORD {
    return Err("That is not a word to keep.".to_string());
  }
  let meaning: String = tidy(&input.meaning).chars().take(MAX_MEANING).collect();
  if meaning.is_empty() {
    return Err("A word is kept with its meaning.".to_string());
  }
  if input.book_id.trim().is_empty() {
    return Err("A word is kept with the book it was looked up in.".to_string());
  }
  if !(0.0..=1.0).contains(&input.p) {
    return Err("A word's place is not in the book.".to_string());
  }
  let id = word_id(&word, input.language.as_deref());
  let existing = db.find_annotation(&id).map_err(|e| e.to_string())?;
  // An id made from a word cannot be a highlight's, so this is a mistake
  // rather than a clash; either way a word never overwrites anything else.
  if existing.as_ref().is_some_and(|row| row.kind != WORD_KIND) {
    return Err("That id belongs to something else.".to_string());
  }
  let known = existing.filter(|row| row.deleted_at.is_none());
  // What is already in the row stays (the quiz's box, and anything a later
  // version put there); the look-up's own fields are written over.
  let mut detail = known.as_ref().map(detail_of).unwrap_or_default();
  let looked_up = detail.get("n").and_then(|n| n.as_i64()).unwrap_or(0).max(0);
  // Six decimals place a word in the longest book, and keep the row short.
  detail.insert("p".into(), serde_json::json!((input.p * 1e6).round() / 1e6));
  detail.insert("m".into(), serde_json::json!(meaning));
  detail.insert("n".into(), serde_json::json!(looked_up + 1));
  detail.insert("at".into(), serde_json::json!(now));
  detail.insert("l".into(), serde_json::json!(language_key(input.language.as_deref())));
  match clipped(input.part.map(|part| tidy(&part).to_lowercase()), 40) {
    Some(part) => detail.insert("pos".into(), serde_json::json!(part)),
    None => detail.remove("pos")
  };
  let text = serde_json::Value::Object(detail).to_string();
  if text.len() > MAX_DETAIL {
    return Err("A word's details are too long.".to_string());
  }
  let row = Annotation {
    id,
    book_id: input.book_id,
    kind: WORD_KIND.to_string(),
    cfi: clipped(input.cfi, MAX_PLACE).unwrap_or_default(),
    text: Some(text),
    note: Some(word),
    color: None,
    chapter: clipped(input.chapter, MAX_SHORT),
    created_at: known.map(|row| row.created_at).unwrap_or_else(|| now.to_string()),
    updated_at: now.to_string(),
    deleted_at: None
  };
  db.put_annotation(&row).map_err(|e| e.to_string())?;
  Ok(row)
}

/// Moves words between the quiz's boxes. All of them or none: every one is
/// checked before the first is written. Only words, and only ones still kept.
fn review(db: &Database, reviews: &[WordReview], now: &str) -> Result<Vec<Annotation>, String> {
  if reviews.len() > MAX_BATCH {
    return Err("Too many words at once.".to_string());
  }
  let mut rows = Vec::with_capacity(reviews.len());
  for answer in reviews {
    if !(0..=MAX_BOX).contains(&answer.to_box) || !(0..=MAX_DAY).contains(&answer.due) {
      return Err("That is not a box a word can be in.".to_string());
    }
    let row = db
      .find_annotation(&answer.id)
      .map_err(|e| e.to_string())?
      .filter(|row| row.kind == WORD_KIND && row.deleted_at.is_none())
      .ok_or_else(|| "That word is not kept.".to_string())?;
    let mut detail = detail_of(&row);
    detail.insert("b".into(), serde_json::json!(answer.to_box));
    detail.insert("d".into(), serde_json::json!(answer.due));
    let text = serde_json::Value::Object(detail).to_string();
    if text.len() > MAX_DETAIL {
      return Err("A word's details are too long.".to_string());
    }
    rows.push(Annotation { text: Some(text), updated_at: now.to_string(), ..row });
  }
  for row in &rows {
    db.put_annotation(row).map_err(|e| e.to_string())?;
  }
  Ok(rows)
}

/// Removes words. Each stays as a tombstone until every copy has seen it.
/// Only words: an id of anything else is left alone.
fn delete(db: &Database, ids: &[String], now: &str) -> Result<(), String> {
  for id in ids {
    if let Some(mut row) = db.find_annotation(id).map_err(|e| e.to_string())? {
      if row.kind == WORD_KIND && row.deleted_at.is_none() {
        row.updated_at = now.to_string();
        row.deleted_at = Some(now.to_string());
        db.put_annotation(&row).map_err(|e| e.to_string())?;
      }
    }
  }
  Ok(())
}

#[tauri::command]
pub fn words_list(state: State<'_, AppState>) -> Result<Vec<Annotation>, String> {
  let db = state.db.guard();
  list(&db)
}

#[tauri::command]
pub fn word_record(input: WordInput, state: State<'_, AppState>) -> Result<Annotation, String> {
  let db = state.db.guard();
  record(&db, input, &db::now_iso())
}

#[tauri::command]
pub fn words_review(reviews: Vec<WordReview>, state: State<'_, AppState>) -> Result<Vec<Annotation>, String> {
  let db = state.db.guard();
  review(&db, &reviews, &db::now_iso())
}

#[tauri::command]
pub fn words_delete(ids: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.guard();
  delete(&db, &ids, &db::now_iso())
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;
  use crate::sync::merge::merge;
  use crate::sync::store::{apply, snapshot};

  const NOW: &str = "2026-10-04T10:00:00Z";
  const LATER: &str = "2026-10-05T10:00:00Z";

  fn looked_up(word: &str, meaning: &str) -> WordInput {
    WordInput {
      word: word.into(),
      language: Some("en-GB".into()),
      meaning: meaning.into(),
      part: Some("Noun".into()),
      book_id: "b1".into(),
      cfi: Some("epubcfi(/6/8!/4/2/1:0)".into()),
      chapter: Some("Chapter 2".into()),
      p: 0.25
    }
  }

  fn detail(row: &Annotation) -> serde_json::Value {
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
  fn a_word_is_kept_with_its_meaning_its_book_and_its_place() {
    let db = memory_db();
    let row = record(&db, looked_up("  Brume ", "Mist; fog."), NOW).expect("record");
    assert_eq!(row.id, "word:en:brume");
    assert_eq!(row.kind, "word");
    assert_eq!(row.note.as_deref(), Some("Brume"), "the word as it was found");
    assert_eq!(row.book_id, "b1");
    assert_eq!(row.cfi, "epubcfi(/6/8!/4/2/1:0)");
    assert_eq!(row.chapter.as_deref(), Some("Chapter 2"));
    let kept = detail(&row);
    assert_eq!(kept["m"], "Mist; fog.");
    assert_eq!(kept["n"], 1);
    assert_eq!(kept["p"], 0.25);
    assert_eq!(kept["l"], "en");
    assert_eq!(kept["pos"], "noun");
    assert_eq!(kept["at"], NOW);
    assert!(kept.get("b").is_none(), "not in the quiz yet");
    assert_eq!(list(&db).expect("list"), vec![row]);
  }

  #[test]
  fn a_word_looked_up_twice_is_one_row_with_a_count() {
    let db = memory_db();
    let first = record(&db, looked_up("brume", "Mist; fog."), NOW).expect("record");
    review(&db, &[WordReview { id: first.id.clone(), to_box: 2, due: 20_370 }], NOW).expect("review");
    // Again, in another book, written another way, with a better meaning.
    let mut again = looked_up("BRUME", "A mist or a fog.");
    again.book_id = "b2".into();
    again.cfi = None;
    again.chapter = None;
    again.p = 0.9;
    again.part = None;
    let second = record(&db, again, LATER).expect("record");
    assert_eq!(second.id, first.id);
    let rows = list(&db).expect("list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0], second);
    // The first date stays (the diary says "looked up" once), the last moves, which is what merges.
    assert_eq!(second.created_at, NOW);
    assert_eq!(second.updated_at, LATER);
    assert_eq!(second.book_id, "b2");
    assert_eq!(second.cfi, "");
    assert_eq!(second.chapter, None);
    let kept = detail(&second);
    assert_eq!(kept["n"], 2);
    assert_eq!(kept["m"], "A mist or a fog.");
    assert_eq!(kept["p"], 0.9);
    assert_eq!(kept["at"], LATER);
    assert!(kept.get("pos").is_none());
    // The quiz's box is not lost to a look-up.
    assert_eq!(kept["b"], 2);
    assert_eq!(kept["d"], 20_370);

    // The same letters in another language are another word.
    let mut french = looked_up("brume", "Brouillard léger.");
    french.language = Some("fr".into());
    assert_eq!(record(&db, french, LATER).expect("record").id, "word:fr:brume");
    let mut unsaid = looked_up("brume", "Mist.");
    unsaid.language = None;
    assert_eq!(record(&db, unsaid, LATER).expect("record").id, first.id, "no language is english");
    assert_eq!(list(&db).expect("list").len(), 2);
  }

  #[test]
  fn what_is_not_a_word_with_a_meaning_and_a_place_is_refused() {
    let db = memory_db();
    let good = || looked_up("brume", "Mist; fog.");
    let mut no_word = good();
    no_word.word = "   ".into();
    let mut long_word = good();
    long_word.word = "x".repeat(MAX_WORD + 1);
    let mut no_meaning = good();
    no_meaning.meaning = " \n ".into();
    let mut no_book = good();
    no_book.book_id = " ".into();
    let mut past_the_end = good();
    past_the_end.p = 1.5;
    let mut before_the_start = good();
    before_the_start.p = -0.1;
    let mut nowhere = good();
    nowhere.p = f64::NAN;
    for input in [no_word, long_word, no_meaning, no_book, past_the_end, before_the_start, nowhere] {
      assert!(record(&db, input, NOW).is_err());
    }
    assert!(list(&db).expect("list").is_empty(), "nothing written");
    assert!(db.all_annotations().expect("all").is_empty());

    // A long meaning is kept to its start; the JSON round it is whole.
    let mut wordy = good();
    wordy.meaning = "é".repeat(MAX_MEANING + 50);
    let row = record(&db, wordy, NOW).expect("record");
    assert_eq!(detail(&row)["m"].as_str().map(|m| m.chars().count()), Some(MAX_MEANING));
    assert!(row.text.as_ref().is_some_and(|text| text.len() <= MAX_DETAIL));
  }

  #[test]
  fn words_and_everything_else_keep_out_of_each_others_way() {
    let db = memory_db();
    db.put_annotation(&highlight("h1")).expect("save");
    // A highlight that somehow has the id a word would get.
    db.put_annotation(&highlight("word:en:brume")).expect("save");
    record(&db, looked_up("mizzle", "Fine rain."), NOW).expect("record");

    // The library's count of highlights is of highlights.
    let counts = db.highlight_counts().expect("counts");
    assert_eq!(counts.len(), 1);
    assert_eq!(counts[0].count, 2);
    // The words' list has no highlight in it.
    assert_eq!(list(&db).expect("list").iter().map(|row| row.id.as_str()).collect::<Vec<_>>(), vec!["word:en:mizzle"]);
    // A word cannot take a highlight's row, review it or remove it.
    assert!(record(&db, looked_up("brume", "Mist."), LATER).is_err());
    assert!(review(&db, &[WordReview { id: "h1".into(), to_box: 1, due: 20_000 }], LATER).is_err());
    delete(&db, &["h1".to_string(), "word:en:brume".to_string()], LATER).expect("delete");
    assert_eq!(db.find_annotation("h1").expect("find"), Some(highlight("h1")));
    assert_eq!(db.find_annotation("word:en:brume").expect("find"), Some(highlight("word:en:brume")));
    // The character sheets' kinds do not include it.
    assert!(!PEOPLE_KINDS.contains(&WORD_KIND));
  }

  #[test]
  fn the_quiz_moves_a_word_between_boxes_all_or_nothing() {
    let db = memory_db();
    let a = record(&db, looked_up("brume", "Mist; fog."), NOW).expect("record");
    let b = record(&db, looked_up("mizzle", "Fine rain."), NOW).expect("record");
    let moved = review(
      &db,
      &[WordReview { id: a.id.clone(), to_box: 1, due: 20_366 }, WordReview { id: b.id.clone(), to_box: 0, due: 20_365 }],
      LATER
    )
    .expect("review");
    assert_eq!(moved.len(), 2);
    let kept = detail(&db.find_annotation(&a.id).expect("find").expect("row"));
    assert_eq!((kept["b"].as_i64(), kept["d"].as_i64()), (Some(1), Some(20_366)));
    assert_eq!(kept["m"], "Mist; fog.", "the rest of the row is as it was");
    assert_eq!(kept["n"], 1);
    assert_eq!(moved[0].created_at, NOW);
    assert_eq!(moved[0].updated_at, LATER);

    let good = WordReview { id: a.id.clone(), to_box: 5, due: 20_400 };
    for bad in [
      WordReview { id: b.id.clone(), to_box: MAX_BOX + 1, due: 20_400 },
      WordReview { id: b.id.clone(), to_box: -1, due: 20_400 },
      WordReview { id: b.id.clone(), to_box: 1, due: -5 },
      WordReview { id: b.id.clone(), to_box: 1, due: MAX_DAY + 1 },
      WordReview { id: "word:en:nothing".into(), to_box: 1, due: 20_400 }
    ] {
      assert!(review(&db, &[good.clone(), bad], LATER).is_err());
      let still = detail(&db.find_annotation(&a.id).expect("find").expect("row"));
      assert_eq!(still["b"], 1, "nothing of the batch was written");
    }
  }

  #[test]
  fn a_removed_word_is_a_tombstone_and_looked_up_again_starts_afresh() {
    let db = memory_db();
    let row = record(&db, looked_up("brume", "Mist; fog."), NOW).expect("record");
    record(&db, looked_up("brume", "Mist; fog."), NOW).expect("record");
    review(&db, &[WordReview { id: row.id.clone(), to_box: 3, due: 20_400 }], NOW).expect("review");
    delete(&db, &[row.id.clone(), "nobody".to_string()], LATER).expect("delete");
    assert!(list(&db).expect("list").is_empty());
    let gone = db.find_annotation(&row.id).expect("find").expect("kept");
    assert_eq!(gone.deleted_at.as_deref(), Some(LATER));
    // Removing it twice keeps the first date; it cannot be reviewed while it is gone.
    delete(&db, &[row.id.clone()], "2026-10-06T10:00:00Z").expect("delete");
    assert_eq!(db.find_annotation(&row.id).expect("find"), Some(gone));
    assert!(review(&db, &[WordReview { id: row.id.clone(), to_box: 1, due: 20_400 }], LATER).is_err());

    let back = record(&db, looked_up("brume", "Mist; fog."), "2026-10-07T10:00:00Z").expect("record");
    assert_eq!(back.created_at, "2026-10-07T10:00:00Z");
    let kept = detail(&back);
    assert_eq!(kept["n"], 1);
    assert!(kept.get("b").is_none());
    assert_eq!(list(&db).expect("list").len(), 1);
  }

  #[test]
  fn words_travel_in_the_backup_and_the_newest_copy_of_one_wins() {
    let from = memory_db();
    let to = memory_db();
    let row = record(&from, looked_up("brume", "Mist; fog."), NOW).expect("record");
    apply(&to, &snapshot(&from, NOW).expect("snapshot")).expect("apply");
    assert_eq!(list(&to).expect("list"), vec![row.clone()]);

    // One device plays the quiz, the other removes the word later: the removal wins everywhere.
    review(&to, &[WordReview { id: row.id.clone(), to_box: 2, due: 20_400 }], LATER).expect("review");
    delete(&from, &[row.id.clone()], "2026-10-06T10:00:00Z").expect("delete");
    let (a, b) = (snapshot(&to, LATER).expect("snapshot"), snapshot(&from, LATER).expect("snapshot"));
    let merged = merge(&a, &b, LATER);
    assert_eq!(merged.annotations, merge(&b, &a, LATER).annotations, "either way round");
    apply(&to, &merged).expect("apply");
    assert!(list(&to).expect("list").is_empty());
  }

  #[test]
  fn delete_all_data_takes_the_words_with_it() {
    let db = memory_db();
    let row = record(&db, looked_up("brume", "Mist; fog."), NOW).expect("record");
    record(&db, looked_up("mizzle", "Fine rain."), NOW).expect("record");
    delete(&db, &[row.id], LATER).expect("delete");
    db.clear_all().expect("clear");
    assert!(list(&db).expect("list").is_empty());
    assert!(db.all_annotations().expect("all").is_empty(), "not even a tombstone");
  }

  /// The diary says "you looked up ..." from these rows: what is written here
  /// is what it reads.
  #[test]
  fn the_diary_reads_the_word_from_the_row_as_it_is_written() {
    let db = memory_db();
    let row = record(&db, looked_up("Brume", "Mist; fog."), NOW).expect("record");
    let marks = super::super::diary::sources(&db).expect("sources").marks;
    assert_eq!(marks.len(), 1);
    assert_eq!(marks[0].kind, "word");
    assert_eq!(marks[0].words.as_deref(), Some("Brume"));
    assert_eq!(marks[0].created_at, row.created_at);
    assert_eq!(marks[0].book_id, "b1");
    // Looked up again another day, it is still the first day's word.
    record(&db, looked_up("brume", "Mist; fog."), LATER).expect("record");
    let marks = super::super::diary::sources(&db).expect("sources").marks;
    assert_eq!(marks.len(), 1);
    assert_eq!(marks[0].created_at, NOW);
  }
}
