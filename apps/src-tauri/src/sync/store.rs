//! The bridge between the local database and the shared sync document.
//!
//! Everything here is about *this* machine: reading local rows into a document
//! that means the same thing everywhere, and writing a merged document back
//! without letting another device's absolute paths in.
//!
//! The original sync computed a merged document, uploaded it, and then applied
//! it to nothing but brand-new books — so a reading position from another device
//! was fetched, merged and discarded. `apply` is the half that was missing.

use crate::db::Database;
use crate::storage;
use crate::sync::merge::{BookEntry, DayEntry, SessionEntry, SyncDoc};
use anyhow::Result;
use std::path::{Path, PathBuf};

/// Where a book lives on this machine, whether or not it has been fetched yet.
///
/// Every device names stored books `{sha256}.{ext}`, so this is derivable rather
/// than something that needs syncing. The old code shipped absolute paths
/// between machines and only worked because the names happened to line up.
pub fn local_path_for(entry: &BookEntry) -> Result<PathBuf> {
  if !entry.is_safe_name() {
    anyhow::bail!("Refusing a synced book with an unsafe name: {:?}", entry.id);
  }
  Ok(storage::books_dir()?.join(entry.remote_name()))
}

/// Reads this device's whole state into a document fit to send anywhere.
pub fn snapshot(db: &Database, now: &str) -> Result<SyncDoc> {
  let books = db
    .list_books_for_sync()?
    .iter()
    .map(BookEntry::from_record)
    .collect();

  let mut days: Vec<DayEntry> = db
    .reading_days()?
    .values()
    .map(DayEntry::from_record)
    .collect();
  days.sort_by(|a, b| a.date_key.cmp(&b.date_key));

  let mut sessions: Vec<SessionEntry> = db
    .focus_sessions()?
    .iter()
    .map(SessionEntry::from_record)
    .collect();
  sessions.sort_by(|a, b| a.id.cmp(&b.id));

  Ok(SyncDoc {
    version: crate::sync::merge::DOC_VERSION,
    updated_at: now.to_string(),
    books,
    days,
    sessions,
    // Oldest first already; the merge re-sorts by id either way.
    purchases: db.pip_purchases()?,
    plantings: db.pip_plantings()?,
    harvests: db.pip_harvests()?,
    pip: db.pip_state()?,
    annotations: db.all_annotations()?,
    collections: db.all_collections()?
  })
}

/// What `apply` changed, so the caller can report it and fetch missing files.
#[derive(Debug, Default)]
pub struct Applied {
  /// Books in the document whose file is not on this machine yet.
  pub missing: Vec<BookEntry>,
  /// Books tombstoned elsewhere and now removed here.
  pub removed: Vec<String>,
  /// Books whose local row changed.
  pub updated: usize
}

/// Writes a merged document into the local database.
///
/// Local-only facts are preserved rather than overwritten: `cover_url` points at
/// this machine's cache, and `local_path` is derived here. Neither travels.
pub fn apply(db: &Database, doc: &SyncDoc) -> Result<Applied> {
  let mut result = Applied::default();
  let existing: std::collections::HashMap<String, crate::db::BookRecord> = db
    .list_books_for_sync()?
    .into_iter()
    .map(|book| (book.id.clone(), book))
    .collect();

  for entry in &doc.books {
    // Skipped rather than failing the whole run: one bad entry should not stop
    // every other book from syncing.
    if !entry.is_safe_name() {
      continue;
    }
    let local = existing.get(&entry.id);

    if entry.is_deleted() {
      // Nothing to do if this device already knows it is gone.
      if local.map(|book| book.deleted_at.is_some()).unwrap_or(true) {
        continue;
      }
      if let Some(book) = local {
        let _ = std::fs::remove_file(&book.local_path);
      }
      db.delete_book(
        &entry.id,
        entry.deleted_at.as_deref().unwrap_or(&doc.updated_at)
      )?;
      result.removed.push(entry.id.clone());
      continue;
    }

    let path = match local {
      // Keep the path this device already uses; re-deriving could rename a file
      // that is open in the reader.
      Some(book) if !book.local_path.is_empty() => PathBuf::from(&book.local_path),
      _ => local_path_for(entry)?
    };
    if !path.exists() {
      result.missing.push(entry.clone());
    }

    let mut record = entry.to_record(
      path.to_string_lossy().to_string(),
      local.and_then(|book| book.cover_url.clone())
    );
    // The enrichment cooldown is a property of this device's lookups, not of the
    // shared document; carrying it across would re-query on every new machine.
    record.metadata_checked_at = local.and_then(|book| book.metadata_checked_at.clone());

    db.upsert_book(&record)?;
    result.updated += 1;
  }

  for day in &doc.days {
    db.put_day(&day.to_record())?;
  }
  for session in &doc.sessions {
    db.put_focus_session(&session.to_record())?;
  }
  for purchase in &doc.purchases {
    db.insert_pip_purchase(purchase)?;
  }
  for planting in &doc.plantings {
    db.insert_pip_planting(planting)?;
  }
  for harvest in &doc.harvests {
    db.insert_pip_harvest(harvest)?;
  }
  if let Some(pip) = &doc.pip {
    db.put_pip_state(pip)?;
  }
  for annotation in &doc.annotations {
    db.put_annotation(annotation)?;
  }
  let carried: Vec<String> = doc.annotations.iter().map(|a| a.id.clone()).collect();
  db.retire_annotation_tombstones(&carried)?;
  for collection in &doc.collections {
    db.put_collection(collection)?;
  }
  let carried: Vec<String> = doc.collections.iter().map(|c| c.id.clone()).collect();
  db.retire_collection_tombstones(&carried)?;

  // Tombstones the merge has retired can finally leave the database.
  let keep: Vec<String> = doc
    .books
    .iter()
    .filter(|entry| entry.is_deleted())
    .map(|entry| entry.id.clone())
    .collect();
  db.purge_tombstones(&keep)?;

  Ok(result)
}

/// True when the book's bytes are on this machine.
pub fn is_available(local_path: &str) -> bool {
  !local_path.is_empty() && Path::new(local_path).exists()
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;
  use crate::db::BookRecord;
  use crate::sync::merge;

  const NOW: &str = "2026-08-29T12:00:00+00:00";

  fn record(id: &str, progress: f32) -> BookRecord {
    BookRecord {
      id: id.to_string(),
      title: format!("Book {id}"),
      author: Some("Someone".to_string()),
      genres: vec!["fiction".to_string()],
      cover_url: Some(format!("D:\\bob\\covers\\{id}-cover.jpg")),
      local_path: format!("D:\\bob\\books\\{id}.epub"),
      file_hash: id.to_string(),
      progress,
      position: None,
      series: None,
      series_index: None,
      last_opened: None,
      created_at: "2026-01-01T00:00:00+00:00".to_string(),
      metadata_checked_at: Some("2026-02-01T00:00:00+00:00".to_string()),
      metadata_updated_at: Some("2026-01-01T00:00:00+00:00".to_string()),
      progress_updated_at: Some("2026-01-01T00:00:00+00:00".to_string()),
      deleted_at: None,
      available: true
    }
  }

  /// The defect that made sync pointless: the merged document was computed,
  /// uploaded, and then applied to nothing but brand-new books, so a position
  /// read on another device was fetched and thrown away.
  #[test]
  fn progress_from_another_device_reaches_a_book_we_already_have() {
    let db = memory_db();
    db.upsert_book(&record("aaa", 0.1)).expect("seed");

    let mut ahead = merge::BookEntry::from_record(&record("aaa", 0.75));
    ahead.progress = 0.75;
    ahead.progress_updated_at = "2026-06-01T00:00:00+00:00".to_string();

    let doc = merge::SyncDoc {
      version: merge::DOC_VERSION,
      updated_at: NOW.to_string(),
      books: vec![ahead],
      days: Vec::new(),
      sessions: Vec::new(),
      purchases: Vec::new(),
      plantings: Vec::new(),
      harvests: Vec::new(),
      pip: None,
      annotations: Vec::new(),
      collections: Vec::new()
    };

    apply(&db, &doc).expect("apply");

    let stored = db.find_by_id("aaa").expect("query").expect("present");
    assert_eq!(stored.progress, 0.75);
  }

  /// The exact place makes the round trip through the document and back into
  /// the row, where the reader restores from it.
  #[test]
  fn the_exact_position_reaches_the_local_row() {
    let db = memory_db();
    db.upsert_book(&record("aaa", 0.1)).expect("seed");

    let mut ahead = merge::BookEntry::from_record(&record("aaa", 0.5));
    ahead.position = Some("epubcfi(/6/12!/4/2/1:0)".to_string());
    ahead.progress_updated_at = "2026-06-01T00:00:00+00:00".to_string();

    let doc = merge::SyncDoc {
      version: merge::DOC_VERSION,
      updated_at: NOW.to_string(),
      books: vec![ahead],
      days: Vec::new(),
      sessions: Vec::new(),
      purchases: Vec::new(),
      plantings: Vec::new(),
      harvests: Vec::new(),
      pip: None,
      annotations: Vec::new(),
      collections: Vec::new()
    };
    apply(&db, &doc).expect("apply");

    let stored = db.find_by_id("aaa").expect("query").expect("present");
    assert_eq!(stored.position.as_deref(), Some("epubcfi(/6/12!/4/2/1:0)"));
    let published = snapshot(&db, NOW).expect("snapshot");
    assert_eq!(published.books[0].position.as_deref(), Some("epubcfi(/6/12!/4/2/1:0)"));
  }

  /// The receiving device keeps its own paths. Adopting the sender's is what
  /// used to break covers on every machine but the one that wrote them.
  #[test]
  fn a_foreign_document_cannot_overwrite_local_paths() {
    let db = memory_db();
    db.upsert_book(&record("aaa", 0.0)).expect("seed");

    let mut incoming = merge::BookEntry::from_record(&record("aaa", 0.5));
    incoming.progress = 0.5;
    incoming.progress_updated_at = "2026-06-01T00:00:00+00:00".to_string();

    let doc = merge::SyncDoc {
      version: merge::DOC_VERSION,
      updated_at: NOW.to_string(),
      books: vec![incoming],
      days: Vec::new(),
      sessions: Vec::new(),
      purchases: Vec::new(),
      plantings: Vec::new(),
      harvests: Vec::new(),
      pip: None,
      annotations: Vec::new(),
      collections: Vec::new()
    };
    apply(&db, &doc).expect("apply");

    let stored = db.find_by_id("aaa").expect("query").expect("present");
    assert_eq!(stored.local_path, "D:\\bob\\books\\aaa.epub");
    assert_eq!(stored.cover_url.as_deref(), Some("D:\\bob\\covers\\aaa-cover.jpg"));
    // The enrichment cooldown belongs to this device's own lookups.
    assert_eq!(
      stored.metadata_checked_at.as_deref(),
      Some("2026-02-01T00:00:00+00:00")
    );
  }

  /// A book deleted elsewhere leaves the visible library here.
  #[test]
  fn a_tombstone_removes_the_book_locally() {
    let db = memory_db();
    db.upsert_book(&record("aaa", 0.0)).expect("seed");
    db.upsert_book(&record("bbb", 0.0)).expect("seed");

    let mut gone = merge::BookEntry::from_record(&record("aaa", 0.0));
    gone.deleted_at = Some("2026-08-20T00:00:00+00:00".to_string());

    let doc = merge::SyncDoc {
      version: merge::DOC_VERSION,
      updated_at: NOW.to_string(),
      books: vec![gone, merge::BookEntry::from_record(&record("bbb", 0.0))],
      days: Vec::new(),
      sessions: Vec::new(),
      purchases: Vec::new(),
      plantings: Vec::new(),
      harvests: Vec::new(),
      pip: None,
      annotations: Vec::new(),
      collections: Vec::new()
    };
    let applied = apply(&db, &doc).expect("apply");

    assert_eq!(applied.removed, vec!["aaa".to_string()]);
    let visible: Vec<String> = db
      .list_books()
      .expect("list")
      .into_iter()
      .map(|book| book.id)
      .collect();
    assert_eq!(visible, vec!["bbb".to_string()]);
    // The row survives so the deletion can still travel to a third device.
    assert_eq!(db.list_books_for_sync().expect("all").len(), 2);
  }

  /// A book the document knows about but this device has no file for is
  /// reported rather than silently missing, so it can be fetched on demand.
  #[test]
  fn a_book_without_local_bytes_is_reported_as_missing() {
    let db = memory_db();
    let doc = merge::SyncDoc {
      version: merge::DOC_VERSION,
      updated_at: NOW.to_string(),
      books: vec![merge::BookEntry::from_record(&record("ccc", 0.0))],
      days: Vec::new(),
      sessions: Vec::new(),
      purchases: Vec::new(),
      plantings: Vec::new(),
      harvests: Vec::new(),
      pip: None,
      annotations: Vec::new(),
      collections: Vec::new()
    };
    let applied = apply(&db, &doc).expect("apply");

    assert_eq!(applied.missing.len(), 1);
    assert_eq!(applied.missing[0].id, "ccc");
    // It is still in the library, so the reader can ask for it.
    assert_eq!(db.list_books().expect("list").len(), 1);
  }

  /// Applying the same document twice must not change anything the second time.
  #[test]
  fn applying_twice_is_the_same_as_applying_once() {
    let db = memory_db();
    db.upsert_book(&record("aaa", 0.1)).expect("seed");

    let mut ahead = merge::BookEntry::from_record(&record("aaa", 0.6));
    ahead.progress = 0.6;
    ahead.progress_updated_at = "2026-06-01T00:00:00+00:00".to_string();
    let doc = merge::SyncDoc {
      version: merge::DOC_VERSION,
      updated_at: NOW.to_string(),
      books: vec![ahead],
      days: Vec::new(),
      sessions: Vec::new(),
      purchases: Vec::new(),
      plantings: Vec::new(),
      harvests: Vec::new(),
      pip: None,
      annotations: Vec::new(),
      collections: Vec::new()
    };

    apply(&db, &doc).expect("first");
    let first = db.find_by_id("aaa").expect("query").expect("present");
    apply(&db, &doc).expect("second");
    let second = db.find_by_id("aaa").expect("query").expect("present");

    assert_eq!(first.progress, second.progress);
    assert_eq!(first.local_path, second.local_path);
    assert_eq!(first.progress_updated_at, second.progress_updated_at);
  }

  /// The ledger and the shelf travel too, so a streak follows the reader.
  #[test]
  fn the_habit_ledger_and_shelf_are_applied() {
    let db = memory_db();
    let doc = merge::SyncDoc {
      version: merge::DOC_VERSION,
      updated_at: NOW.to_string(),
      books: Vec::new(),
      days: vec![merge::DayEntry {
        date_key: "2026-08-01".to_string(),
        minutes: 32.0,
        goal_minutes: 20,
        freeze_used: false,
        grace_used: true
      }],
      sessions: vec![merge::SessionEntry {
        id: "s1".to_string(),
        started_at: "2026-08-01T10:00:00+00:00".to_string(),
        ended_at: "2026-08-01T10:32:00+00:00".to_string(),
        date_key: "2026-08-01".to_string(),
        minutes: 32.0,
        book_id: None,
        title: Some("Book".to_string()),
        notes: Some("a note".to_string()),
        ended_reason: "completed".to_string(),
        clean: true,
        style_seed: "seed".to_string(),
        burned_at: None
      }],
      purchases: Vec::new(),
      plantings: Vec::new(),
      harvests: Vec::new(),
      pip: None,
      annotations: Vec::new(),
      collections: Vec::new()
    };

    apply(&db, &doc).expect("apply");

    let days = db.reading_days().expect("days");
    assert_eq!(days.get("2026-08-01").expect("day").minutes, 32.0);
    assert!(days.get("2026-08-01").expect("day").grace_used);

    let sessions = db.focus_sessions().expect("sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].notes.as_deref(), Some("a note"));
  }

  /// `snapshot` must include tombstones, or a deletion could never be published.
  #[test]
  fn a_snapshot_carries_tombstones() {
    let db = memory_db();
    db.upsert_book(&record("aaa", 0.0)).expect("seed");
    db.delete_book("aaa", "2026-08-20T00:00:00+00:00").expect("delete");

    let doc = snapshot(&db, NOW).expect("snapshot");
    assert_eq!(doc.books.len(), 1);
    assert!(doc.books[0].is_deleted());
    assert_eq!(doc.live_books().count(), 0);
  }

  /// Seeds spent and Pip's look are in the backup: restoring on a new
  /// machine brings the wardrobe back rather than refunding it.
  #[test]
  fn annotations_travel_and_retired_tombstones_leave() {
    let from = memory_db();
    let to = memory_db();
    let annotation = crate::db::Annotation {
      id: "h1".into(),
      book_id: "b1".into(),
      kind: "highlight".into(),
      cfi: "epubcfi(/6/2!/4/2,/1:0,/1:5)".into(),
      text: Some("It was a dark and stormy night".into()),
      note: Some("classic".into()),
      color: Some("yellow".into()),
      chapter: Some("Chapter 1".into()),
      created_at: "2026-09-01T10:00:00Z".into(),
      updated_at: "2026-09-01T10:00:00Z".into(),
      deleted_at: None
    };
    from.put_annotation(&annotation).expect("save");
    let doc = snapshot(&from, "2026-09-02T00:00:00Z").expect("snapshot");
    assert_eq!(doc.annotations.len(), 1);
    apply(&to, &doc).expect("apply");
    assert_eq!(to.annotations_for_book("b1").expect("list"), vec![annotation.clone()]);

    // A tombstone the document no longer carries is removed for good.
    let mut gone = annotation.clone();
    gone.deleted_at = Some("2026-09-03T00:00:00Z".into());
    to.put_annotation(&gone).expect("delete");
    let mut empty = doc.clone();
    empty.annotations.clear();
    apply(&to, &empty).expect("apply");
    assert!(to.find_annotation("h1").expect("find").is_none());
  }

  #[test]
  fn collections_and_series_travel() {
    let from = memory_db();
    let to = memory_db();
    let mut book = record("aaa", 0.2);
    book.series = Some("The Expanse".into());
    book.series_index = Some(3.0);
    from.upsert_book(&book).expect("seed");
    let shelf = crate::db::Collection {
      id: "c1".into(),
      name: "Space".into(),
      book_ids: vec!["aaa".into()],
      created_at: "2026-09-01T10:00:00Z".into(),
      updated_at: "2026-09-01T10:00:00Z".into(),
      deleted_at: None
    };
    from.put_collection(&shelf).expect("save");

    let doc = snapshot(&from, "2026-09-02T00:00:00Z").expect("snapshot");
    apply(&to, &doc).expect("apply");
    assert_eq!(to.collections().expect("list"), vec![shelf]);
    let arrived = to.find_by_id("aaa").expect("query").expect("present");
    assert_eq!((arrived.series.as_deref(), arrived.series_index), (Some("The Expanse"), Some(3.0)));
  }

  #[test]
  fn pip_purchases_and_state_travel() {
    let from = memory_db();
    from
      .insert_pip_purchase(&crate::pip::Purchase {
        id: "buy-1".to_string(),
        item_kind: "move".to_string(),
        item_id: "moonwalk".to_string(),
        price: 400,
        bought_at: "2026-09-01T10:00:00+00:00".to_string()
      })
      .expect("buy");
    let mut state = crate::pip::PipState::fresh("2026-09-01T10:00:00+00:00");
    state.signature = "moonwalk".to_string();
    from.put_pip_state(&state).expect("state");

    let doc = snapshot(&from, NOW).expect("snapshot");
    let to = memory_db();
    apply(&to, &doc).expect("apply");
    assert_eq!(to.pip_purchases().expect("purchases").len(), 1);
    assert_eq!(to.pip_state().expect("state").map(|s| s.signature).as_deref(), Some("moonwalk"));
  }

  /// The garden is in the backup: a restored device grows the same plants.
  #[test]
  fn the_garden_travels() {
    let from = memory_db();
    from
      .insert_pip_planting(&crate::pip::Planting {
        id: "buy-1".to_string(),
        plot: 1,
        plant: "oak".to_string(),
        planted_at: "2026-09-28T10:00:00+00:00".to_string()
      })
      .expect("plant");
    from
      .insert_pip_harvest(&crate::pip::Harvest {
        id: "pick-1".to_string(),
        planting_id: "buy-0".to_string(),
        seeds: 4,
        harvested_at: "2026-09-28T09:00:00+00:00".to_string()
      })
      .expect("pick");
    let doc = snapshot(&from, NOW).expect("snapshot");
    let to = memory_db();
    apply(&to, &doc).expect("apply");
    assert_eq!(to.pip_plantings().expect("plantings").len(), 1);
    assert_eq!(to.pip_harvests().expect("harvests").len(), 1);
  }
}
