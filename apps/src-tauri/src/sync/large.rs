//! Asking before a large book's file is backed up.
//!
//! A backup to Drive or a folder carried every book's file, whatever its
//! size: a 45 MB scan went up beside a 300 KB novel, into a Drive quota the
//! reader shares with everything else they keep there, and nothing said so.
//! A file over `LARGE_BOOK_BYTES` now waits for the reader's word. Only the
//! file waits: the book's place, notes and highlights are in the shared
//! document and are backed up either way.
//!
//! The answers are this device's own (a setting, not synced): the question is
//! about what this device sends.

use crate::db::Database;
use anyhow::Result;
use std::collections::BTreeMap;

/// A book's file larger than this is backed up only when the reader says so.
pub const LARGE_BOOK_BYTES: u64 = 10 * 1024 * 1024;

/// Where the answers are kept: `{ "<book id>": true | false }`.
pub const ANSWERS_SETTING: &str = "backup_large_books";

/// What the reader has said about each large book: `true` to back its file
/// up, `false` not to. A book with no answer has not been asked about yet.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Answers {
  given: BTreeMap<String, bool>,
  changed: bool
}

impl Answers {
  /// The answers on record; none when the setting is missing or unreadable.
  pub fn load(db: &Database) -> Self {
    let given = db
      .get_setting(ANSWERS_SETTING)
      .ok()
      .flatten()
      .and_then(|stored| serde_json::from_str::<BTreeMap<String, bool>>(&stored).ok())
      .unwrap_or_default();
    Answers { given, changed: false }
  }

  pub fn get(&self, book_id: &str) -> Option<bool> {
    self.given.get(book_id).copied()
  }

  pub fn set(&mut self, book_id: &str, back_up: bool) {
    if self.given.insert(book_id.to_string(), back_up) != Some(back_up) {
      self.changed = true;
    }
  }

  /// A large file found already in the backup (sent before this question
  /// existed, or by another device) is one the reader need not be asked
  /// about: it is recorded as backed up, unless they have answered.
  pub fn found_backed_up(&mut self, book_id: &str, bytes: u64) {
    if bytes > LARGE_BOOK_BYTES && self.get(book_id).is_none() {
      self.set(book_id, true);
    }
  }

  /// Writes the answers back, if any changed.
  pub fn save(&mut self, db: &Database) -> Result<()> {
    if self.changed {
      db.set_setting(ANSWERS_SETTING, &serde_json::to_string(&self.given)?)?;
      self.changed = false;
    }
    Ok(())
  }
}

/// What to do with a book's file that the backup does not hold yet.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Decision {
  /// Small, or large and the reader said yes.
  Send,
  /// Large, and the reader has not been asked: it waits.
  Ask,
  /// Large, and the reader said no.
  Skip
}

pub fn decide(bytes: u64, answer: Option<bool>) -> Decision {
  if bytes <= LARGE_BOOK_BYTES {
    return Decision::Send;
  }
  match answer {
    Some(true) => Decision::Send,
    Some(false) => Decision::Skip,
    None => Decision::Ask
  }
}

/// The size of the file at `path`; nothing for a file that cannot be read.
pub fn file_bytes(path: &std::path::Path) -> u64 {
  std::fs::metadata(path).map(|file| file.len()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;

  const MB: u64 = 1024 * 1024;

  #[test]
  fn a_small_file_is_sent_and_a_large_one_waits_for_an_answer() {
    assert_eq!(decide(300 * 1024, None), Decision::Send);
    // The limit itself is not over it.
    assert_eq!(decide(LARGE_BOOK_BYTES, None), Decision::Send);
    assert_eq!(decide(LARGE_BOOK_BYTES + 1, None), Decision::Ask);
    // The reported case: a 45 MB scan.
    assert_eq!(decide(45 * MB, None), Decision::Ask);
    assert_eq!(decide(45 * MB, Some(true)), Decision::Send);
    assert_eq!(decide(45 * MB, Some(false)), Decision::Skip);
    // A "no" never holds back a small file (the book was replaced by a smaller copy).
    assert_eq!(decide(2 * MB, Some(false)), Decision::Send);
  }

  #[test]
  fn answers_are_kept_and_written_only_when_they_change() {
    let db = memory_db();
    let mut answers = Answers::load(&db);
    assert_eq!(answers.get("scan"), None);
    answers.save(&db).expect("nothing to write");
    assert!(db.get_setting(ANSWERS_SETTING).expect("setting").is_none());

    answers.set("scan", false);
    answers.set("atlas", true);
    answers.save(&db).expect("saved");
    let again = Answers::load(&db);
    assert_eq!(again.get("scan"), Some(false));
    assert_eq!(again.get("atlas"), Some(true));
    assert_eq!(again.get("novel"), None);
  }

  #[test]
  fn a_large_file_already_in_the_backup_is_not_asked_about() {
    let db = memory_db();
    let mut answers = Answers::load(&db);
    answers.found_backed_up("sent-long-ago", 80 * MB);
    answers.found_backed_up("small", 2 * MB);
    assert_eq!(answers.get("sent-long-ago"), Some(true));
    assert_eq!(answers.get("small"), None, "a small file needs no answer");
    // An answer the reader gave stands.
    answers.set("said-no", false);
    answers.found_backed_up("said-no", 80 * MB);
    assert_eq!(answers.get("said-no"), Some(false));
  }

  #[test]
  fn a_setting_that_cannot_be_read_is_no_answers() {
    let db = memory_db();
    db.set_setting(ANSWERS_SETTING, "{ not json").expect("junk");
    assert_eq!(Answers::load(&db), Answers::default());
  }
}
