//! Sync through a folder the user's own cloud client already keeps in step.
//!
//! Point Leaflet at a directory inside Google Drive for Desktop, Dropbox,
//! OneDrive or iCloud and cross-device sync works with no OAuth, no API client,
//! no quota and no Google verification. The merge rules are identical to the
//! Drive transport's — only the reading and writing of bytes differs.
//!
//! Layout, matching the Drive transport exactly:
//!
//! ```text
//! <root>/state.json          the shared document
//! <root>/.leaflet-owner      whose library it is (a tag), when it is anyone's
//! <root>/books/<sha256>.epub the files
//! ```
//!
//! Two halves, run apart (`commands::backup::run_sync`): the state
//! (`sync_state`), which a folder holding another account's library never
//! gets, and the files (`sync_files`), which every library gets.

use crate::db::Database;
use crate::sync::large::{self, Decision};
use crate::sync::merge::{self, Remote, SyncDoc};
use crate::sync::owner::{self, StoreMode};
use crate::sync::shared_doc::{self, StateRun, Who};
use crate::sync::store;
use anyhow::{anyhow, Result};
use std::fs;
use std::path::{Path, PathBuf};

const STATE_FILE: &str = "state.json";
const BOOKS_DIR: &str = "books";
const OWNER_FILE: &str = ".leaflet-owner";
const LOCK_FILE: &str = ".leaflet-sync.lock";
/// A lock older than this is assumed to belong to a process that died holding
/// it. Long enough that a slow sync is never stolen from.
const LOCK_STALE_SECS: u64 = 120;

/// What a sync did, for the UI to report honestly.
#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
  pub books_uploaded: usize,
  pub books_downloaded: usize,
  pub books_removed: usize,
  /// In the library but not on this device yet, and not fetched this run.
  pub books_pending: usize,
  pub entries_updated: usize,
  /// Large files not sent because the reader has not been asked about them
  /// yet (`sync::large`).
  pub books_held: usize,
  /// The shared document was written by a later version of Leaflet: this
  /// device took what it understands from it and wrote nothing back.
  pub update_needed: bool,
  /// Nothing was synced: this library is another Leaflet account's than the
  /// one signed in (`owner::Standing::Other`).
  pub owner_paused: bool,
  /// Nothing was synced: this library was started fresh, and the account
  /// already holds a library of this many books from before. The reader is
  /// asked (`library_fresh_answer`).
  pub account_holds: Option<usize>
}

impl SyncReport {
  /// Folds a second transport's result in. Counts add, except pending books,
  /// which is a property of this device rather than of a run: the later
  /// transport has the final word on what is still missing.
  pub fn merge_in(&mut self, other: SyncReport) {
    self.books_uploaded += other.books_uploaded;
    self.books_downloaded += other.books_downloaded;
    self.books_removed += other.books_removed;
    self.entries_updated += other.entries_updated;
    self.books_pending = other.books_pending;
    // The same books wait on every transport: they are counted once.
    self.books_held = self.books_held.max(other.books_held);
    self.update_needed |= other.update_needed;
    self.owner_paused |= other.owner_paused;
    self.account_holds = self.account_holds.or(other.account_holds);
  }
}

/// A document a later version wrote: what this version understands of it is
/// applied to this device, and nothing is written back. What this device has
/// done since stays on it, and goes up once it is updated.
pub(crate) fn take_from_newer(db: &Database, remote: Option<SyncDoc>, now: &str) -> Result<SyncReport> {
  let mut report = SyncReport { update_needed: true, ..SyncReport::default() };
  if let Some(remote) = remote {
    let local = store::snapshot(db, now)?;
    let applied = store::apply(db, &merge::merge(&local, &remote, now))?;
    report.entries_updated = applied.updated;
    report.books_removed = applied.removed.len();
    report.books_pending = applied.missing.len();
  }
  Ok(report)
}

/// Held for the duration of a sync so two devices writing to the same folder at
/// the same moment cannot interleave a read-modify-write of `state.json`.
struct FolderLock {
  path: PathBuf
}

impl FolderLock {
  fn acquire(root: &Path) -> Result<Self> {
    let path = root.join(LOCK_FILE);
    if let Ok(metadata) = fs::metadata(&path) {
      let stale = metadata
        .modified()
        .ok()
        .and_then(|time| time.elapsed().ok())
        .map(|age| age.as_secs() > LOCK_STALE_SECS)
        .unwrap_or(true);
      if !stale {
        return Err(anyhow!(
          "Another device is syncing this folder. Try again in a moment."
        ));
      }
      let _ = fs::remove_file(&path);
    }
    fs::OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&path)
      .map_err(|error| anyhow!("could not lock the sync folder: {error}"))?;
    Ok(FolderLock { path })
  }
}

impl Drop for FolderLock {
  fn drop(&mut self) {
    let _ = fs::remove_file(&self.path);
  }
}

fn read_state(root: &Path) -> Result<Remote> {
  let path = root.join(STATE_FILE);
  if !path.exists() {
    return Ok(Remote::Absent);
  }
  // A truncated or hand-edited document must not take the library down with it.
  // Treating it as absent means this device re-publishes its own state, which is
  // the recoverable outcome. A document from a later version is not that case,
  // and is told apart by its version before anything else is read.
  Ok(merge::read_remote(&fs::read(&path)?))
}

/// Writes `state.json` through a temporary file, so a crash or a cloud client
/// reading mid-write never sees a half-written document.
fn write_state(root: &Path, doc: &SyncDoc) -> Result<()> {
  let staging = root.join(format!("{STATE_FILE}.tmp"));
  fs::write(&staging, serde_json::to_vec_pretty(doc)?)?;
  fs::rename(&staging, root.join(STATE_FILE))?;
  Ok(())
}

/// The owner marked beside the document: one line, a tag. Kept apart from
/// `state.json` because Leaflet 1.5.0 to 1.5.2 rewrite that without it.
fn read_mark(root: &Path) -> Option<String> {
  owner::clean(fs::read_to_string(root.join(OWNER_FILE)).ok().as_deref())
}

/// Marks the folder as `owner`'s, through a temporary file like the document.
fn write_mark(root: &Path, owner: &str) -> Result<()> {
  let staging = root.join(format!("{OWNER_FILE}.tmp"));
  fs::write(&staging, format!("{owner}\n"))?;
  fs::rename(&staging, root.join(OWNER_FILE))?;
  Ok(())
}

/// Whose library the folder holds, as far as can be told without reading
/// the whole document's books: the document's owner, else the marker.
pub fn store_owner(root: &Path) -> Option<String> {
  let doc_owner = match read_state(root).ok()? {
    Remote::Ours(doc) | Remote::Newer(Some(doc)) => doc.owner,
    _ => None
  };
  shared_doc::remote_owner(doc_owner.as_deref(), read_mark(root).as_deref())
}

/// The state half: merges this device's state with the folder's, unless the
/// folder holds a library that is not this device's to merge with
/// (`owner::store_mode`). The folder is written every run, as it always was.
pub fn sync_state(db: &Database, root: &Path, now: &str, who: &Who) -> Result<StateRun> {
  fs::create_dir_all(root)?;
  let _lock = FolderLock::acquire(root)?;

  let remote = read_state(root)?;
  let mark = read_mark(root);
  let doc_owner = match &remote {
    Remote::Ours(doc) | Remote::Newer(Some(doc)) => doc.owner.clone(),
    _ => None
  };
  let there = shared_doc::remote_owner(doc_owner.as_deref(), mark.as_deref());
  let mode = who.mode(owner::get(db).as_deref(), there.as_deref());
  if matches!(mode, StoreMode::FilesOnly | StoreMode::Refuse) {
    return Ok(StateRun { refused: true, ..StateRun::default() });
  }

  let remote = match remote {
    Remote::Ours(doc) => Some(doc),
    Remote::Absent => None,
    Remote::Newer(doc) => {
      let doc = doc.map(|mut doc| {
        doc.owner.clone_from(&there);
        doc
      });
      let report = take_from_newer(db, doc, now)?;
      let brought_news = report.entries_updated > 0 || report.books_removed > 0;
      return Ok(StateRun { report, brought_news, newer: true, refused: false });
    }
  };
  let local = store::snapshot(db, now)?;
  let stamp = shared_doc::stamp_for(mode, who);
  let merged = shared_doc::merged_for(&local, remote.as_ref(), &there, &stamp, now);
  let brought_news = remote.as_ref().is_some_and(|remote| shared_doc::brings(&local, remote, now));

  // Publish before moving files: if the copy stage fails halfway, the other
  // device still learns what exists rather than nothing at all.
  write_state(root, &merged)?;
  if let Some(owner) = merged.owner.as_deref() {
    if mark.as_deref() != Some(owner) {
      write_mark(root, owner)?;
    }
  }

  let applied = store::apply(db, &merged)?;
  let report = SyncReport {
    entries_updated: applied.updated,
    books_removed: applied.removed.len(),
    books_pending: applied.missing.len(),
    ..SyncReport::default()
  };
  Ok(StateRun { report, brought_news, newer: false, refused: false })
}

/// The files half, over this library as it is here: publishes the books the
/// folder lacks, fetches the ones this device lacks, and (with `may_delete`)
/// takes away the files of books removed. A folder that holds another
/// account's library is never cleared of anything (`may_delete` false).
pub fn sync_files(db: &Database, root: &Path, may_delete: bool) -> Result<SyncReport> {
  fs::create_dir_all(root)?;
  let _lock = FolderLock::acquire(root)?;
  let books_root = root.join(BOOKS_DIR);
  fs::create_dir_all(&books_root)?;
  let mut report = SyncReport::default();

  let library = store::library_files(db)?;
  // A tombstoned book's bytes should not linger in the shared folder.
  if may_delete {
    for (entry, _) in library.iter().filter(|(entry, _)| entry.is_deleted()) {
      let _ = fs::remove_file(books_root.join(entry.remote_name()));
    }
  }

  let mut answers = large::Answers::load(db);
  for (entry, local_path) in library.iter().filter(|(entry, _)| !entry.is_deleted()) {
    let shared = books_root.join(entry.remote_name());

    match (local_path.exists(), shared.exists()) {
      // Ours and not theirs: publish it, once, for good. A large file only
      // with the reader's word (`sync::large`).
      (true, false) => match large::decide(large::file_bytes(local_path), answers.get(&entry.id)) {
        Decision::Send => {
          if copy_atomically(local_path, &shared).is_ok() {
            report.books_uploaded += 1;
          }
        }
        Decision::Ask => report.books_held += 1,
        Decision::Skip => {}
      },
      // Theirs and not ours: fetch it now. Files come from a folder on this
      // machine, so there is no reason to defer the copy the way the Drive
      // transport does.
      (false, true) => {
        if let Some(parent) = local_path.parent() {
          fs::create_dir_all(parent)?;
        }
        if copy_atomically(&shared, local_path).is_ok() {
          report.books_downloaded += 1;
        } else {
          report.books_pending += 1;
        }
      }
      (false, false) => report.books_pending += 1,
      (true, true) => answers.found_backed_up(&entry.id, large::file_bytes(local_path))
    }
  }
  answers.save(db)?;

  Ok(report)
}

/// Both halves as a signed-out device runs them: the state, then the files
/// (none when a later version wrote the folder, or it is another's).
#[cfg(test)]
pub fn sync(db: &Database, root: &Path, now: &str) -> Result<SyncReport> {
  let run = sync_state(db, root, now, &Who::signed_out())?;
  if run.refused {
    return Err(anyhow!(owner::FOLDER_REFUSED));
  }
  let mut report = run.report;
  if !run.newer {
    let files = sync_files(db, root, true)?;
    report.books_uploaded += files.books_uploaded;
    report.books_downloaded += files.books_downloaded;
    report.books_held += files.books_held;
    report.books_pending = files.books_pending;
  }
  Ok(report)
}
/// Copies via a temporary file in the destination directory, so a reader never
/// opens a partially written book.
fn copy_atomically(from: &Path, to: &Path) -> Result<()> {
  let staging = to.with_extension("part");
  fs::copy(from, &staging)?;
  if let Err(error) = fs::rename(&staging, to) {
    let _ = fs::remove_file(&staging);
    return Err(error.into());
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;
  use crate::db::{BookRecord, Database};

  /// A scratch directory that cleans itself up, standing in for the folder a
  /// cloud client keeps in step.
  struct Scratch {
    path: PathBuf
  }

  impl Scratch {
    fn new(name: &str) -> Self {
      let path = std::env::temp_dir().join(format!("leaflet-sync-test-{name}"));
      let _ = fs::remove_dir_all(&path);
      fs::create_dir_all(&path).expect("scratch dir");
      Scratch { path }
    }
  }

  impl Drop for Scratch {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.path);
    }
  }

  fn book(id: &str, progress: f32, now: &str) -> BookRecord {
    BookRecord {
      finished_at: None,
      id: id.to_string(),
      title: format!("Book {id}"),
      author: Some("Someone".to_string()),
      genres: Vec::new(),
      cover_url: None,
      local_path: format!("D:\\device\\books\\{id}.epub"),
      file_hash: id.to_string(),
      progress,
      position: None,
      series: None,
      series_index: None,
      last_opened: None,
      created_at: now.to_string(),
      metadata_checked_at: None,
      metadata_updated_at: Some(now.to_string()),
      progress_updated_at: Some(now.to_string()),
      deleted_at: None,
      available: true
    }
  }

  fn titles(db: &Database) -> Vec<String> {
    let mut ids: Vec<String> = db.list_books().expect("list").into_iter().map(|b| b.id).collect();
    ids.sort();
    ids
  }

  /// The whole point of sync, end to end: a book imported on one device appears
  /// on the other, and a position read on the second reaches the first.
  #[test]
  fn two_devices_converge_through_a_folder() {
    let scratch = Scratch::new("converge");
    let laptop = memory_db();
    let desktop = memory_db();

    laptop
      .upsert_book(&book("aaa", 0.5, "2026-08-01T10:00:00+00:00"))
      .expect("import");

    sync(&laptop, &scratch.path, "2026-08-01T10:00:01+00:00").expect("laptop publishes");
    sync(&desktop, &scratch.path, "2026-08-01T10:00:02+00:00").expect("desktop receives");

    assert_eq!(titles(&desktop), vec!["aaa".to_string()]);
    let received = desktop.find_by_id("aaa").expect("query").expect("present");
    assert_eq!(received.progress, 0.5);
    // The path is this device's own, derived from the content hash, not the
    // sender's absolute path.
    assert!(received.local_path.ends_with("aaa.epub"));
    assert!(!received.local_path.contains("D:\\device"));

    // The desktop reads on. `update_progress` stamps the moment it moved.
    desktop
      .update_progress(
        "aaa",
        0.9,
        Some("2026-08-02T09:00:00+00:00".to_string()),
        Some("epubcfi(/6/14!/4/2/1:0)".to_string())
      )
      .expect("read on");

    sync(&desktop, &scratch.path, "2026-08-02T09:00:01+00:00").expect("desktop publishes");
    sync(&laptop, &scratch.path, "2026-08-02T09:00:02+00:00").expect("laptop receives");

    let back = laptop.find_by_id("aaa").expect("query").expect("present");
    assert_eq!(back.progress, 0.9);
    // The exact place arrives too, so the laptop reopens at the line rather
    // than at the start of the chapter.
    assert_eq!(back.position.as_deref(), Some("epubcfi(/6/14!/4/2/1:0)"));
  }

  /// Merely opening a book on the second device must not undo reading done on
  /// the first — the defect that made the old sync worse than no sync.
  #[test]
  fn opening_on_one_device_does_not_rewind_the_other() {
    let scratch = Scratch::new("rewind");
    let laptop = memory_db();
    let desktop = memory_db();

    laptop
      .upsert_book(&book("aaa", 0.0, "2026-08-01T10:00:00+00:00"))
      .expect("import");
    laptop
      .update_progress("aaa", 0.85, Some("2026-08-01T11:00:00+00:00".to_string()), None)
      .expect("read");

    sync(&laptop, &scratch.path, "2026-08-01T11:00:01+00:00").expect("publish");
    sync(&desktop, &scratch.path, "2026-08-01T11:00:02+00:00").expect("receive");
    assert_eq!(desktop.find_by_id("aaa").unwrap().unwrap().progress, 0.85);

    // Opened, but not read: the same progress written back.
    desktop
      .update_progress("aaa", 0.85, Some("2026-08-03T08:00:00+00:00".to_string()), None)
      .expect("open only");

    sync(&desktop, &scratch.path, "2026-08-03T08:00:01+00:00").expect("publish");
    sync(&laptop, &scratch.path, "2026-08-03T08:00:02+00:00").expect("receive");

    let held = laptop.find_by_id("aaa").expect("query").expect("present");
    assert_eq!(held.progress, 0.85);
    assert_eq!(held.last_opened.as_deref(), Some("2026-08-03T08:00:00+00:00"));
  }

  /// A deletion travels instead of being undone by the other device.
  #[test]
  fn a_deletion_travels_between_devices() {
    let scratch = Scratch::new("delete");
    let laptop = memory_db();
    let desktop = memory_db();

    laptop.upsert_book(&book("aaa", 0.0, "2026-08-01T10:00:00+00:00")).expect("import");
    laptop.upsert_book(&book("bbb", 0.0, "2026-08-01T10:00:00+00:00")).expect("import");

    sync(&laptop, &scratch.path, "2026-08-01T10:00:01+00:00").expect("publish");
    sync(&desktop, &scratch.path, "2026-08-01T10:00:02+00:00").expect("receive");
    assert_eq!(titles(&desktop), vec!["aaa".to_string(), "bbb".to_string()]);

    desktop.delete_book("aaa", "2026-08-04T12:00:00+00:00").expect("delete");

    sync(&desktop, &scratch.path, "2026-08-04T12:00:01+00:00").expect("publish");
    sync(&laptop, &scratch.path, "2026-08-04T12:00:02+00:00").expect("receive");

    assert_eq!(titles(&laptop), vec!["bbb".to_string()]);
    // Syncing again must not bring it back, which the old union did forever.
    sync(&laptop, &scratch.path, "2026-08-04T12:00:03+00:00").expect("again");
    assert_eq!(titles(&laptop), vec!["bbb".to_string()]);
  }

  /// The habit ledger travels, so a streak follows the reader across devices.
  #[test]
  fn the_streak_ledger_follows_the_reader() {
    let scratch = Scratch::new("ledger");
    let laptop = memory_db();
    let desktop = memory_db();

    laptop.credit_minutes("2026-08-01", 25.0, 20).expect("credit");
    sync(&laptop, &scratch.path, "2026-08-01T20:00:00+00:00").expect("publish");
    sync(&desktop, &scratch.path, "2026-08-01T20:00:01+00:00").expect("receive");

    let days = desktop.reading_days().expect("days");
    assert_eq!(days.get("2026-08-01").expect("day").minutes, 25.0);
  }

  /// Repeated syncing must not accumulate: minutes take the maximum, not the
  /// sum, or a reader could inflate a streak by pressing the button.
  #[test]
  fn syncing_twice_does_not_inflate_the_ledger() {
    let scratch = Scratch::new("idempotent-ledger");
    let laptop = memory_db();

    laptop.credit_minutes("2026-08-01", 25.0, 20).expect("credit");
    for tick in 0..3 {
      sync(&laptop, &scratch.path, &format!("2026-08-01T20:00:0{tick}+00:00")).expect("sync");
    }

    let days = laptop.reading_days().expect("days");
    assert_eq!(days.get("2026-08-01").expect("day").minutes, 25.0);
  }

  fn minutes_on(db: &Database, day: &str) -> f64 {
    db.reading_days().expect("days").get(day).expect("day").minutes
  }

  /// Read on both devices in one day before either syncs: the day is both
  /// readings together, on both, and syncing on does not move it.
  #[test]
  fn reading_on_both_devices_in_one_day_adds_up() {
    let scratch = Scratch::new("both-read");
    let laptop = memory_db();
    let phone = memory_db();

    laptop.credit_minutes("2026-08-01", 20.0, 30).expect("laptop reads");
    phone.credit_minutes("2026-08-01", 20.0, 30).expect("phone reads");

    sync(&laptop, &scratch.path, "2026-08-01T20:00:00+00:00").expect("laptop");
    sync(&phone, &scratch.path, "2026-08-01T20:00:01+00:00").expect("phone");
    sync(&laptop, &scratch.path, "2026-08-01T20:00:02+00:00").expect("laptop again");

    assert_eq!(minutes_on(&laptop, "2026-08-01"), 40.0);
    assert_eq!(minutes_on(&phone, "2026-08-01"), 40.0);
    assert!(laptop.reading_days().expect("days")["2026-08-01"].goal_met(), "a goal of 30 neither met alone");

    for tick in 3..6 {
      sync(&phone, &scratch.path, &format!("2026-08-01T20:00:0{tick}+00:00")).expect("sync");
      sync(&laptop, &scratch.path, &format!("2026-08-01T20:00:0{tick}+00:00")).expect("sync");
    }
    assert_eq!(minutes_on(&laptop, "2026-08-01"), 40.0);
    assert_eq!(minutes_on(&phone, "2026-08-01"), 40.0);

    // The laptop reads five more: 45 on both.
    laptop.credit_minutes("2026-08-01", 5.0, 30).expect("more");
    sync(&laptop, &scratch.path, "2026-08-01T21:00:00+00:00").expect("laptop");
    sync(&phone, &scratch.path, "2026-08-01T21:00:01+00:00").expect("phone");
    assert_eq!(minutes_on(&phone, "2026-08-01"), 45.0);
  }

  /// What 1.0 to 1.2 do to the shared document: read it into the shapes they
  /// know, add their own reading to the day's total, and write it back.
  fn an_old_version_syncs(root: &Path, day: &str, read_since: f64) {
    let path = root.join(STATE_FILE);
    let mut doc: serde_json::Value = serde_json::from_slice(&fs::read(&path).expect("read")).expect("json");
    for entry in doc["days"].as_array_mut().expect("days") {
      let object = entry.as_object_mut().expect("a day");
      object.remove("byDevice");
      if object["dateKey"] == day {
        let minutes = object["minutes"].as_f64().expect("minutes") + read_since;
        object.insert("minutes".to_string(), minutes.into());
      }
    }
    fs::write(&path, serde_json::to_vec_pretty(&doc).expect("json")).expect("write");
  }

  /// An installed 1.1 between two newer devices: the day's total never goes
  /// down, its own reading counts, and what it dropped is back after the
  /// newer devices' next syncs.
  #[test]
  fn an_old_version_in_between_loses_nothing() {
    let scratch = Scratch::new("old-between");
    let laptop = memory_db();
    let phone = memory_db();
    laptop.credit_minutes("2026-08-01", 20.0, 30).expect("laptop reads");
    phone.credit_minutes("2026-08-01", 20.0, 30).expect("phone reads");
    sync(&laptop, &scratch.path, "2026-08-01T20:00:00+00:00").expect("laptop");
    sync(&phone, &scratch.path, "2026-08-01T20:00:01+00:00").expect("phone");

    an_old_version_syncs(&scratch.path, "2026-08-01", 10.0);
    let raw = fs::read_to_string(scratch.path.join(STATE_FILE)).expect("read");
    assert!(!raw.contains("byDevice"), "the old version wrote none");

    sync(&laptop, &scratch.path, "2026-08-01T20:10:00+00:00").expect("laptop");
    assert_eq!(minutes_on(&laptop, "2026-08-01"), 50.0, "the forty, and the old version's ten");
    let raw = fs::read_to_string(scratch.path.join(STATE_FILE)).expect("read");
    assert!(raw.contains("byDevice"), "back in the document");
    // The laptop synced before the phone did, so it never saw the phone's
    // figure, and cannot put back what it never held. The total is whole all
    // the same: the old version kept it.
    assert_eq!(laptop.reading_day_devices().expect("figures")["2026-08-01"].len(), 1);

    // The phone puts its own figure back, and nothing is counted twice.
    sync(&phone, &scratch.path, "2026-08-01T20:10:01+00:00").expect("phone");
    assert_eq!(minutes_on(&phone, "2026-08-01"), 50.0);
    assert_eq!(phone.reading_day_devices().expect("figures")["2026-08-01"].len(), 2, "the laptop's and the phone's");
    // And reading goes on counting from there.
    phone.credit_minutes("2026-08-01", 4.0, 30).expect("more");
    sync(&phone, &scratch.path, "2026-08-01T20:20:00+00:00").expect("phone");
    sync(&laptop, &scratch.path, "2026-08-01T20:20:01+00:00").expect("laptop");
    assert_eq!(minutes_on(&laptop, "2026-08-01"), 54.0);
  }

  /// A half-written or hand-edited document must not take the library down; the
  /// device republishes its own state instead.
  #[test]
  fn a_corrupt_document_is_survivable() {
    let scratch = Scratch::new("corrupt");
    let laptop = memory_db();
    laptop.upsert_book(&book("aaa", 0.3, "2026-08-01T10:00:00+00:00")).expect("import");

    fs::write(scratch.path.join("state.json"), b"{ this is not json").expect("write junk");

    sync(&laptop, &scratch.path, "2026-08-01T10:00:01+00:00").expect("survives");

    assert_eq!(titles(&laptop), vec!["aaa".to_string()]);
    let republished = fs::read(scratch.path.join("state.json")).expect("read back");
    let doc: SyncDoc = serde_json::from_slice(&republished).expect("valid json now");
    assert_eq!(doc.books.len(), 1);
  }

  /// A document a later version wrote is read from and left exactly as it
  /// was: this version would write it back without what it does not know.
  #[test]
  fn a_later_versions_document_is_taken_from_and_not_written() {
    let scratch = Scratch::new("newer");
    let laptop = memory_db();
    let newer = memory_db();
    newer.upsert_book(&book("bbb", 0.4, "2026-08-01T09:00:00+00:00")).expect("import");
    sync(&newer, &scratch.path, "2026-08-01T09:00:01+00:00").expect("publish");

    // The document as a later version would leave it: a higher version, and a field this one has no name for.
    let path = scratch.path.join(STATE_FILE);
    let mut doc: serde_json::Value = serde_json::from_slice(&fs::read(&path).expect("read")).expect("json");
    doc["version"] = (merge::DOC_VERSION + 1).into();
    doc["somethingNew"] = serde_json::json!({ "kept": true });
    let written = serde_json::to_vec_pretty(&doc).expect("json");
    fs::write(&path, &written).expect("write");

    laptop.upsert_book(&book("aaa", 0.3, "2026-08-01T10:00:00+00:00")).expect("import");
    let report = sync(&laptop, &scratch.path, "2026-08-01T10:00:01+00:00").expect("survives");

    assert!(report.update_needed);
    assert_eq!(titles(&laptop), vec!["aaa".to_string(), "bbb".to_string()], "what it understands arrives");
    assert_eq!(fs::read(&path).expect("read back"), written, "and the document is untouched");

    // One it cannot read at all: nothing taken, nothing written, and its own books unharmed.
    let unreadable = format!(r#"{{"version":{},"books":"moved elsewhere"}}"#, merge::DOC_VERSION + 1);
    fs::write(&path, &unreadable).expect("write");
    let report = sync(&laptop, &scratch.path, "2026-08-01T10:00:02+00:00").expect("survives");
    assert!(report.update_needed);
    assert_eq!(fs::read_to_string(&path).expect("read back"), unreadable);
    assert_eq!(titles(&laptop), vec!["aaa".to_string(), "bbb".to_string()]);
  }

  /// The lock keeps two devices from interleaving a read-modify-write of the
  /// shared document.
  #[test]
  fn a_held_lock_refuses_a_second_writer() {
    let scratch = Scratch::new("lock");
    let db = memory_db();
    let _held = FolderLock::acquire(&scratch.path).expect("first lock");

    let error = sync(&db, &scratch.path, "2026-08-01T10:00:00+00:00")
      .expect_err("second writer is refused");
    assert!(error.to_string().contains("Another device is syncing"));
  }

  /// The document names every book by its content hash, so `state.json` carries
  /// nothing machine-specific at all.
  #[test]
  fn the_published_document_holds_no_local_paths() {
    let scratch = Scratch::new("paths");
    let laptop = memory_db();
    laptop.upsert_book(&book("aaa", 0.3, "2026-08-01T10:00:00+00:00")).expect("import");

    sync(&laptop, &scratch.path, "2026-08-01T10:00:01+00:00").expect("publish");

    let raw = fs::read_to_string(scratch.path.join("state.json")).expect("read");
    assert!(!raw.contains("D:\\\\device"));
    assert!(!raw.contains("localPath"));
    assert!(!raw.contains("coverUrl"));
    assert!(raw.contains("\"id\": \"aaa\""));
  }

  // ---- whose library the folder holds ---------------------------------------

  const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  fn mark_in(root: &Path) -> Option<String> {
    fs::read_to_string(root.join(OWNER_FILE)).ok().map(|line| line.trim().to_string())
  }

  /// Signed in, the folder is stamped (document and sidecar); another
  /// account's device leaves it alone; an older Leaflet's rewrite drops the
  /// document's owner and the sidecar still says it.
  #[test]
  fn a_folder_is_marked_and_another_accounts_library_is_left_alone() {
    let scratch = Scratch::new("owner-gate");
    let a = memory_db();
    a.upsert_book(&book("aaa", 0.2, "2026-08-01T10:00:00+00:00")).expect("import");
    let run = sync_state(&a, &scratch.path, "2026-08-01T10:00:01+00:00", &Who::signed_in(A)).expect("claim");
    assert!(!run.refused);
    assert_eq!(store_owner(&scratch.path).as_deref(), Some(A));
    assert_eq!(mark_in(&scratch.path).as_deref(), Some(A));
    assert_eq!(owner::get(&a).as_deref(), Some(A));
    let written = fs::read(scratch.path.join(STATE_FILE)).expect("doc");

    // Another account's device, signed in or out: nothing read, nothing written.
    let b = memory_db();
    b.upsert_book(&book("bbb", 0.2, "2026-08-01T11:00:00+00:00")).expect("import");
    assert!(sync_state(&b, &scratch.path, "2026-08-01T11:00:01+00:00", &Who::signed_in(B)).expect("run").refused);
    owner::claim_if_unowned(&b, B).expect("B's");
    assert!(sync(&b, &scratch.path, "2026-08-01T11:00:02+00:00").is_err());
    assert_eq!(fs::read(scratch.path.join(STATE_FILE)).expect("doc"), written);
    assert_eq!(titles(&b), vec!["bbb".to_string()]);

    // What 1.5.0 to 1.5.2 do: rewrite the document without the owner.
    let path = scratch.path.join(STATE_FILE);
    let mut doc: serde_json::Value = serde_json::from_slice(&fs::read(&path).expect("read")).expect("json");
    doc.as_object_mut().expect("object").remove("owner");
    fs::write(&path, serde_json::to_vec_pretty(&doc).expect("json")).expect("write");
    assert_eq!(store_owner(&scratch.path).as_deref(), Some(A), "the sidecar says it");
    assert!(sync_state(&b, &scratch.path, "2026-08-01T12:00:00+00:00", &Who::signed_out()).expect("run").refused);

    // A signed-out library nobody claimed takes A from the sidecar, and the
    // document has its owner back.
    let phone = memory_db();
    sync(&phone, &scratch.path, "2026-08-01T12:00:01+00:00").expect("exchange");
    assert_eq!(owner::get(&phone).as_deref(), Some(A));
    assert_eq!(titles(&phone), vec!["aaa".to_string()]);
    let back: SyncDoc = serde_json::from_slice(&fs::read(&path).expect("read")).expect("json");
    assert_eq!(back.owner.as_deref(), Some(A));
  }

  /// The files half works over the library here: what the folder lacks goes
  /// up, what this device lacks comes down, and a removed book's file goes
  /// only when the folder's library is this one's (`may_delete`).
  #[test]
  fn the_files_half_follows_this_library_and_deletes_only_when_it_may() {
    let scratch = Scratch::new("files-half");
    let shared = scratch.path.join("shared");
    let here = scratch.path.join("here");
    fs::create_dir_all(shared.join(BOOKS_DIR)).expect("dir");
    fs::create_dir_all(&here).expect("dir");
    let at = |id: &str| BookRecord { local_path: here.join(format!("{id}.epub")).to_string_lossy().to_string(), ..book(id, 0.0, "2026-08-01T10:00:00+00:00") };

    let db = memory_db();
    db.upsert_book(&at("aaa")).expect("on this device");
    fs::write(here.join("aaa.epub"), b"aaa bytes").expect("file");
    db.upsert_book(&at("ccc")).expect("not on this device yet");
    fs::write(shared.join(BOOKS_DIR).join("ccc.epub"), b"ccc bytes").expect("theirs");
    db.upsert_book(&at("zzz")).expect("removed");
    db.delete_book("zzz", "2026-08-01T10:05:00+00:00").expect("delete");
    fs::write(shared.join(BOOKS_DIR).join("zzz.epub"), b"zzz bytes").expect("a removed book's file");

    let report = sync_files(&db, &shared, false).expect("files only");
    assert_eq!(report.books_uploaded, 1);
    assert_eq!(report.books_downloaded, 1);
    assert_eq!(fs::read(shared.join(BOOKS_DIR).join("aaa.epub")).expect("uploaded"), b"aaa bytes");
    assert_eq!(fs::read(here.join("ccc.epub")).expect("downloaded"), b"ccc bytes");
    assert!(shared.join(BOOKS_DIR).join("zzz.epub").exists(), "not this library's to clear");

    let report = sync_files(&db, &shared, true).expect("its own");
    assert_eq!((report.books_uploaded, report.books_downloaded), (0, 0));
    assert!(!shared.join(BOOKS_DIR).join("zzz.epub").exists());
    assert!(!scratch.path.join("shared").join(STATE_FILE).exists(), "the files half writes no state");
  }
}
