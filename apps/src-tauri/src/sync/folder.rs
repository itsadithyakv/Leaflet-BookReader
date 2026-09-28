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
//! <root>/books/<sha256>.epub the files, fetched on demand
//! ```

use crate::db::Database;
use crate::sync::merge::{self, SyncDoc};
use crate::sync::store;
use anyhow::{anyhow, Result};
use std::fs;
use std::path::{Path, PathBuf};

const STATE_FILE: &str = "state.json";
const BOOKS_DIR: &str = "books";
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
  pub entries_updated: usize
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
  }
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

fn read_state(root: &Path) -> Result<Option<SyncDoc>> {
  let path = root.join(STATE_FILE);
  if !path.exists() {
    return Ok(None);
  }
  let bytes = fs::read(&path)?;
  // A truncated or hand-edited document must not take the library down with it.
  // Treating it as absent means this device re-publishes its own state, which is
  // the recoverable outcome.
  match serde_json::from_slice::<SyncDoc>(&bytes) {
    Ok(doc) => Ok(Some(doc)),
    Err(_) => Ok(None)
  }
}

/// Writes `state.json` through a temporary file, so a crash or a cloud client
/// reading mid-write never sees a half-written document.
fn write_state(root: &Path, doc: &SyncDoc) -> Result<()> {
  let staging = root.join(format!("{STATE_FILE}.tmp"));
  fs::write(&staging, serde_json::to_vec_pretty(doc)?)?;
  fs::rename(&staging, root.join(STATE_FILE))?;
  Ok(())
}

/// Merges this device's state with the folder's and reconciles the book files.
pub fn sync(db: &Database, root: &Path, now: &str) -> Result<SyncReport> {
  fs::create_dir_all(root)?;
  let _lock = FolderLock::acquire(root)?;
  let books_root = root.join(BOOKS_DIR);
  fs::create_dir_all(&books_root)?;

  let local = store::snapshot(db, now)?;
  let remote = read_state(root)?.unwrap_or_else(|| SyncDoc::empty(now));
  let merged = merge::merge(&local, &remote, now);

  // Publish before moving files: if the copy stage fails halfway, the other
  // device still learns what exists rather than nothing at all.
  write_state(root, &merged)?;

  let applied = store::apply(db, &merged)?;
  let mut report = SyncReport {
    entries_updated: applied.updated,
    books_removed: applied.removed.len(),
    ..SyncReport::default()
  };

  // A tombstoned book's bytes should not linger in the shared folder.
  for entry in merged.books.iter().filter(|entry| entry.is_deleted()) {
    let _ = fs::remove_file(books_root.join(entry.remote_name()));
  }

  for entry in merged.live_books() {
    let shared = books_root.join(entry.remote_name());
    let local_path = store::local_path_for(entry)?;

    match (local_path.exists(), shared.exists()) {
      // Ours and not theirs: publish it, once, for good.
      (true, false) => {
        if copy_atomically(&local_path, &shared).is_ok() {
          report.books_uploaded += 1;
        }
      }
      // Theirs and not ours: fetch it now. Files come from a folder on this
      // machine, so there is no reason to defer the copy the way the Drive
      // transport does.
      (false, true) => {
        if let Some(parent) = local_path.parent() {
          fs::create_dir_all(parent)?;
        }
        if copy_atomically(&shared, &local_path).is_ok() {
          report.books_downloaded += 1;
        } else {
          report.books_pending += 1;
        }
      }
      (false, false) => report.books_pending += 1,
      (true, true) => {}
    }
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
}
