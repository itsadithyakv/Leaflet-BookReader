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
use crate::sync::merge::{BookEntry, CampEntry, DayEntry, SessionEntry, SyncDoc};
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

  let mut figures = db.reading_day_devices()?;
  let mut days: Vec<DayEntry> = db
    .reading_days()?
    .values()
    .map(|day| DayEntry::from_record(day, figures.remove(&day.date_key).unwrap_or_default()))
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
    collections: db.all_collections()?,
    reading_profile: crate::sync::reading::load(db)?,
    camp: kept_camp(db)?,
    owner: crate::sync::owner::get(db)
  })
}

/// Pip's camp in the Hollow is two settings rows: the game's state as the app
/// wrote it, and when it was saved, which is what decides between two
/// devices' camps (`merge::merge_camp`).
pub(crate) const CAMP_SETTING: &str = "pip.base";
pub(crate) const CAMP_SAVED_AT_SETTING: &str = "pip.base.at";

/// The camp this device keeps, or nothing before the first. One kept by a
/// build from before saves were stamped has an empty stamp.
pub(crate) fn kept_camp(db: &Database) -> Result<Option<CampEntry>> {
  let Some(state) = db.get_setting(CAMP_SETTING)? else {
    return Ok(None);
  };
  let saved_at = db.get_setting(CAMP_SAVED_AT_SETTING)?.unwrap_or_default();
  Ok(Some(CampEntry { state, saved_at }))
}

/// Keeps a camp and its stamp together: a camp under another save's stamp
/// would win or lose a sync it should not.
pub(crate) fn keep_camp(db: &Database, camp: &CampEntry) -> Result<()> {
  db.in_transaction(|| write_camp(db, camp))
}

/// `keep_camp`'s rows, for a caller already inside a transaction (`apply`).
fn write_camp(db: &Database, camp: &CampEntry) -> Result<()> {
  db.set_setting(CAMP_SETTING, &camp.state)?;
  db.set_setting(CAMP_SAVED_AT_SETTING, &camp.saved_at)
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
///
/// As one transaction. Every row of the document is written on every run, and
/// a row a commit held the database (and so every command waiting on it) for
/// twenty seconds with a year's reading in it; and a run that fails part way
/// now leaves the library as it was rather than half merged.
///
/// Merged, inside that transaction, with what the database holds now, not
/// written over it. A run takes its snapshot, then goes to the network for
/// seconds (the account's push, Drive's read, write and read-back), and the
/// reader goes on meanwhile: the heartbeat keeps a minute's reading, a note
/// is edited, a highlight or a book is removed. Written as the document had
/// it, those minutes were gone for good, the note went back, and the
/// highlight and the book came back to life (sync audit D1). The merge is
/// commutative and idempotent, so merging the document again with the rows
/// as they are now loses nothing of either; what was written meanwhile goes
/// up with the next sync. The document's own time (`updated_at`, the run's
/// `now`) is the clock it is merged at.
pub fn apply(db: &Database, doc: &SyncDoc) -> Result<Applied> {
  let mut gone: Vec<(String, String)> = Vec::new();
  let result = db.in_transaction(|| {
    let now = doc.updated_at.as_str();
    let current = snapshot(db, now)?;
    let merged = crate::sync::merge::merge(&current, doc, now);
    write(db, &merged, &mut gone)
  })?;
  // Only once their rows say so: a file cannot be put back by a rollback.
  for (path, hash) in gone {
    let _ = std::fs::remove_file(&path);
    // And its cover, thumbnail and converted copy, as a removal here takes
    // (`commands::delete_book`): they stayed behind on every other device.
    storage::remove_book_extras(&hash, Path::new(&path));
  }
  Ok(result)
}

/// `apply`'s rows. The files of books removed elsewhere are named in `gone`
/// for the caller to delete once the rows are kept.
fn write(db: &Database, doc: &SyncDoc, gone: &mut Vec<(String, String)>) -> Result<Applied> {
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
      // Removed here by this run, if this device still had it.
      let was_here = local.is_some_and(|book| book.deleted_at.is_none());
      if let (true, Some(book)) = (was_here, local) {
        gone.push((book.local_path.clone(), book.file_hash.clone()));
        result.removed.push(entry.id.clone());
      }
      // A removed book that was finished is still a book finished: its row is
      // kept with the date (and made, on a device that never had the book),
      // so the count of books finished is the same everywhere.
      let finished = entry.finished_at.as_deref().is_some_and(|at| !at.is_empty());
      let recorded = local.is_some_and(|book| book.deleted_at.is_some() && book.finished_at == entry.finished_at);
      if finished && !recorded {
        let path = match local {
          Some(book) => book.local_path.clone(),
          None => local_path_for(entry)?.to_string_lossy().to_string()
        };
        db.upsert_book(&entry.to_record(path, None))?;
      } else if was_here {
        db.delete_book(
          &entry.id,
          entry.deleted_at.as_deref().unwrap_or(&doc.updated_at)
        )?;
      }
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
    db.put_day_devices(&day.date_key, &day.by_device)?;
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
  // `apply` has already merged these with what is stored now, so they are
  // kept as they are: a stamp from a clock that was ahead has been put right
  // (`merge::bounded`), and folding them in again would keep the wrong one.
  if let Some(profile) = &doc.reading_profile {
    crate::sync::reading::keep(db, profile)?;
  }
  if let Some(camp) = &doc.camp {
    if CampEntry::problem(&camp.state).is_none() && kept_camp(db)?.as_ref() != Some(camp) {
      write_camp(db, camp)?;
    }
  }

  // Tombstones the merge has retired can finally leave the database.
  let keep: Vec<String> = doc
    .books
    .iter()
    .filter(|entry| entry.is_deleted())
    .map(|entry| entry.id.clone())
    .collect();
  db.purge_tombstones(&keep)?;

  // A library nobody has claimed takes the owner of the one it was merged
  // with; one that is somebody's keeps its owner whatever arrives.
  if let Some(owner) = crate::sync::owner::clean(doc.owner.as_deref()) {
    crate::sync::owner::claim_if_unowned(db, &owner)?;
  }

  Ok(result)
}

/// Every book in this library as the files halves of Drive and the folder
/// see it: its entry (tombstones included), and where its file is or would
/// be here: the path its row keeps, else the one derived from its name. Books
/// with an unsafe name are left out.
pub fn library_files(db: &Database) -> Result<Vec<(BookEntry, PathBuf)>> {
  let mut files = Vec::new();
  for record in db.list_books_for_sync()? {
    let entry = BookEntry::from_record(&record);
    if !entry.is_safe_name() {
      continue;
    }
    let path = if record.local_path.is_empty() { local_path_for(&entry)? } else { PathBuf::from(&record.local_path) };
    files.push((entry, path));
  }
  Ok(files)
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

  const NOW: &str = "2026-10-29T12:00:00+00:00";

  /// History trimming (`merge::compact`, 1.5.12) on a real reader's library,
  /// not a made-up one: given a **copy** of a `library.db` (with its `-wal`),
  /// it keeps every session, day, purchase, planting, harvest, live book and
  /// live highlight; trimming twice is trimming once; and a trimmed and an
  /// untrimmed device merge to the same document in either order.
  /// `$env:LEAFLET_REAL_DB="<copy>\library.db"; cargo test --lib sync::store::tests::compacting_a_real -- --ignored --nocapture`
  #[test]
  #[ignore = "needs a copy of a real library.db in LEAFLET_REAL_DB"]
  fn compacting_a_real_library_loses_nothing_that_counts() {
    let path = std::env::var("LEAFLET_REAL_DB").expect("LEAFLET_REAL_DB: a copy of library.db");
    let db = crate::db::Database::open_at(std::path::Path::new(&path)).expect("open the copy");
    let now = chrono::Utc::now().to_rfc3339();
    let full = snapshot(&db, &now).expect("snapshot");
    let trimmed = merge::compact(full.clone(), &now);
    let live = |values: &[serde_json::Value]| values.iter().filter(|value| value.get("deletedAt").is_none_or(|at| at.is_null())).count();
    let json = |items: &[crate::db::Annotation]| items.iter().map(|item| serde_json::to_value(item).expect("json")).collect::<Vec<_>>();

    assert_eq!(trimmed.sessions.len(), full.sessions.len(), "sessions");
    assert_eq!(trimmed.days.len(), full.days.len(), "days");
    assert_eq!(trimmed.purchases.len(), full.purchases.len(), "purchases");
    assert_eq!(trimmed.plantings.len(), full.plantings.len(), "plantings");
    assert_eq!(trimmed.harvests.len(), full.harvests.len(), "harvests");
    let live_books = |doc: &SyncDoc| doc.books.iter().filter(|book| book.deleted_at.is_none()).count();
    assert_eq!(live_books(&trimmed), live_books(&full), "live books");
    assert_eq!(live(&json(&trimmed.annotations)), live(&json(&full.annotations)), "live highlights");
    assert_eq!(merge::compact(trimmed.clone(), &now), trimmed, "trimming twice is trimming once");
    let one_way = merge::compact(merge::merge(&full, &trimmed, &now), &now);
    let other_way = merge::compact(merge::merge(&trimmed, &full, &now), &now);
    assert_eq!(one_way, other_way, "the same in either order");

    let size = |doc: &SyncDoc| serde_json::to_vec(doc).expect("json").len();
    println!(
      "books {} ({} live), days {}, sessions {}, highlights {}: {} bytes, trimmed {} bytes",
      full.books.len(),
      live_books(&full),
      full.days.len(),
      full.sessions.len(),
      full.annotations.len(),
      size(&full),
      size(&trimmed)
    );
  }

  fn record(id: &str, progress: f32) -> BookRecord {
    BookRecord {
      finished_at: None,
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

  /// Prints what writing a sync into the database costs, with SQLite's
  /// default journal and with the write-ahead log the app asks for:
  /// `cargo test --lib sync::store::tests::what_applying -- --ignored --nocapture`
  #[test]
  #[ignore = "a measurement: writes two databases to the temp folder"]
  fn what_applying_a_sync_costs_on_this_machine() {
    use crate::db::tests::disk_db;
    // A reader of a year or so: 300 books, a year of days, 900 marks.
    let from = memory_db();
    for index in 0..300 {
      from.upsert_book(&record(&format!("book{index}"), 0.3)).expect("book");
    }
    for day in 0..365 {
      let date = chrono::NaiveDate::from_ymd_opt(2026, 1, 1).expect("date") + chrono::Duration::days(day);
      from.credit_minutes(&date.to_string(), 25.0, 20).expect("day");
    }
    for index in 0..900 {
      from
        .put_annotation(&crate::db::Annotation {
          id: format!("mark{index}"),
          book_id: format!("book{}", index % 300),
          kind: "highlight".to_string(),
          cfi: format!("epubcfi(/6/{index}!/4/2,/1:0,/1:40)"),
          text: Some("A passage of about the length a reader marks, give or take a line.".to_string()),
          note: None,
          color: Some("yellow".to_string()),
          chapter: Some("Chapter One".to_string()),
          created_at: NOW.to_string(),
          updated_at: NOW.to_string(),
          deleted_at: None
        })
        .expect("mark");
    }
    let doc = snapshot(&from, NOW).expect("snapshot");
    println!("{} books, {} days, {} marks", doc.books.len(), doc.days.len(), doc.annotations.len());
    // Row by row, as it was before `apply` became one transaction.
    for logged in [false, true] {
      let path = std::env::temp_dir().join(format!("leaflet-rows-cost-{}-{logged}.db", std::process::id()));
      let to = disk_db(&path, logged);
      let rows = std::time::Instant::now();
      write(&to, &doc, &mut Vec::new()).expect("write");
      println!("{}, a commit a row: {:?}", if logged { "write-ahead log" } else { "default journal" }, rows.elapsed());
      drop(to);
      for suffix in ["", "-wal", "-shm", "-journal"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
      }
    }
    for logged in [false, true] {
      let path = std::env::temp_dir().join(format!("leaflet-apply-cost-{}-{logged}.db", std::process::id()));
      let to = disk_db(&path, logged);
      let first = std::time::Instant::now();
      apply(&to, &doc).expect("apply");
      let first = first.elapsed();
      // The second is what every later sync costs: the same rows again.
      let again = std::time::Instant::now();
      apply(&to, &doc).expect("apply");
      println!("{}, one transaction: first {:?}, again {:?}", if logged { "write-ahead log" } else { "default journal" }, first, again.elapsed());
      drop(to);
      for suffix in ["", "-wal", "-shm", "-journal"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
      }
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
      collections: Vec::new(),
      reading_profile: None,
      camp: None,
      owner: None
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
      collections: Vec::new(),
      reading_profile: None,
      camp: None,
      owner: None
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
      collections: Vec::new(),
      reading_profile: None,
      camp: None,
      owner: None
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

  /// A book finished and removed on another device is removed here too, and
  /// is still a book finished: on a device that had it, and on one that never
  /// did. Applying the same document again changes nothing.
  #[test]
  fn a_book_finished_and_removed_elsewhere_still_counts_as_finished_here() {
    let mut gone = merge::BookEntry::from_record(&record("aaa", 1.0));
    gone.deleted_at = Some("2026-08-20T00:00:00+00:00".to_string());
    gone.finished_at = Some("2026-08-01T00:00:00+00:00".to_string());
    // Removed without ever being finished: gone, and nothing to count.
    let mut dropped = merge::BookEntry::from_record(&record("ccc", 0.2));
    dropped.deleted_at = Some("2026-08-20T00:00:00+00:00".to_string());
    let doc = merge::SyncDoc {
      version: merge::DOC_VERSION,
      updated_at: NOW.to_string(),
      books: vec![gone, dropped],
      days: Vec::new(),
      sessions: Vec::new(),
      purchases: Vec::new(),
      plantings: Vec::new(),
      harvests: Vec::new(),
      pip: None,
      annotations: Vec::new(),
      collections: Vec::new(),
      reading_profile: None,
      camp: None,
      owner: None
    };
    let counted = |db: &Database| db.finished_and_removed().expect("counted").into_iter().map(|book| (book.id, book.finished_at)).collect::<Vec<_>>();
    let dated = vec![("aaa".to_string(), Some("2026-08-01T00:00:00+00:00".to_string()))];

    // This device was part way through both.
    let had = memory_db();
    had.upsert_book(&record("aaa", 0.3)).expect("seed");
    had.upsert_book(&record("ccc", 0.2)).expect("seed");
    let mut applied = apply(&had, &doc).expect("apply");
    applied.removed.sort();
    assert_eq!(applied.removed, vec!["aaa".to_string(), "ccc".to_string()]);
    assert!(had.list_books().expect("list").is_empty());
    assert_eq!(counted(&had), dated);

    // This one never had either.
    let never = memory_db();
    let applied = apply(&never, &doc).expect("apply");
    assert!(applied.removed.is_empty() && applied.missing.is_empty());
    assert!(never.list_books().expect("list").is_empty());
    assert_eq!(counted(&never), dated);

    for db in [&had, &never] {
      let again = apply(db, &doc).expect("again");
      assert!(again.removed.is_empty());
      assert_eq!(counted(db), dated);
    }
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
      collections: Vec::new(),
      reading_profile: None,
      camp: None,
      owner: None
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
      collections: Vec::new(),
      reading_profile: None,
      camp: None,
      owner: None
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
      collections: Vec::new(),
      reading_profile: None,
      camp: None,
      owner: None
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
        grace_used: true,
        by_device: Default::default()
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
        burned_at: None,
        flower: Some("daisy".to_string()),
        flower_bloomed: true
      }],
      purchases: Vec::new(),
      plantings: Vec::new(),
      harvests: Vec::new(),
      pip: None,
      annotations: Vec::new(),
      collections: Vec::new(),
      reading_profile: None,
      camp: None,
      owner: None
    };

    apply(&db, &doc).expect("apply");

    let days = db.reading_days().expect("days");
    assert_eq!(days.get("2026-08-01").expect("day").minutes, 32.0);
    assert!(days.get("2026-08-01").expect("day").grace_used);

    let sessions = db.focus_sessions().expect("sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].notes.as_deref(), Some("a note"));
    // A flower bloomed on another device blooms here too.
    assert_eq!(sessions[0].flower.as_deref(), Some("daisy"));
    assert!(sessions[0].flower_bloomed);
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

    // A tombstone the merge has retired (past the ninety days every device
    // has had to see it) is removed for good.
    let mut gone = annotation.clone();
    gone.updated_at = "2026-09-03T00:00:00Z".into();
    gone.deleted_at = Some("2026-09-03T00:00:00Z".into());
    to.put_annotation(&gone).expect("delete");
    let mut empty = doc.clone();
    empty.annotations.clear();
    // Not yet: a run a day after the removal keeps it, to carry it.
    empty.updated_at = "2026-09-04T00:00:00Z".into();
    apply(&to, &empty).expect("apply");
    assert_eq!(to.find_annotation("h1").expect("find").and_then(|a| a.deleted_at).as_deref(), Some("2026-09-03T00:00:00Z"));
    empty.updated_at = "2026-12-31T00:00:00Z".into();
    apply(&to, &empty).expect("apply");
    assert!(to.find_annotation("h1").expect("find").is_none());
  }

  // ---- what is written while a run is at the network (sync audit D1) -----

  /// A library that has been read in: a book, a day with minutes, a note.
  fn read_in(db: &Database) {
    db.upsert_book(&record("aaa", 0.3)).expect("book");
    db.upsert_book(&record("bbb", 0.1)).expect("book");
    db.credit_minutes("2026-10-29", 10.0, 20).expect("minutes");
    db.put_annotation(&mark("h1", "first thoughts", "2026-10-29T10:00:00+00:00")).expect("note");
    db.put_annotation(&mark("h2", "keep this", "2026-10-29T10:00:00+00:00")).expect("note");
  }

  fn mark(id: &str, note: &str, at: &str) -> crate::db::Annotation {
    crate::db::Annotation {
      id: id.into(),
      book_id: "aaa".into(),
      kind: "highlight".into(),
      cfi: format!("epubcfi(/6/2!/4/2,/1:0,/1:{})", id.len()),
      text: Some("A line worth keeping".into()),
      note: Some(note.into()),
      color: Some("yellow".into()),
      chapter: None,
      created_at: "2026-10-29T10:00:00+00:00".into(),
      updated_at: at.into(),
      deleted_at: None
    }
  }

  /// The run: its snapshot, merged with what the account held, the document
  /// it will apply once the network has answered.
  fn run_started(db: &Database) -> SyncDoc {
    let local = snapshot(db, NOW).expect("snapshot");
    merge::merge(&local, &SyncDoc::empty(NOW), NOW)
  }

  /// Minutes the heartbeat keeps while the run is away are not put back to
  /// the snapshot's figure, the total or this device's own.
  #[test]
  fn minutes_kept_while_a_run_is_at_the_network_survive_it() {
    let db = memory_db();
    read_in(&db);
    let doc = run_started(&db);
    // Meanwhile: another minute and a half of reading.
    db.credit_minutes("2026-10-29", 1.5, 20).expect("heartbeat");
    let before = db.reading_days().expect("days")["2026-10-29"].minutes;
    let mine_before = db.reading_day_devices().expect("figures").get("2026-10-29").cloned().unwrap_or_default();

    apply(&db, &doc).expect("apply");

    assert_eq!(db.reading_days().expect("days")["2026-10-29"].minutes, before);
    assert!((before - 11.5).abs() < 1e-9, "{before}");
    assert_eq!(db.reading_day_devices().expect("figures").get("2026-10-29").cloned().unwrap_or_default(), mine_before);
    // And they are in the next run's document.
    assert_eq!(snapshot(&db, NOW).expect("snapshot").days[0].minutes, before);
  }

  /// A note edited while the run is away keeps its edit.
  #[test]
  fn a_note_edited_while_a_run_is_at_the_network_keeps_its_edit() {
    let db = memory_db();
    read_in(&db);
    let doc = run_started(&db);
    db.put_annotation(&mark("h1", "second thoughts", "2026-10-29T11:00:00+00:00")).expect("edit");

    apply(&db, &doc).expect("apply");

    let kept = db.find_annotation("h1").expect("find").expect("there");
    assert_eq!(kept.note.as_deref(), Some("second thoughts"));
  }

  /// A highlight removed while the run is away stays removed, and its
  /// tombstone stays to carry the removal: dropped, the next sync brought
  /// the highlight back from the server.
  #[test]
  fn a_highlight_removed_while_a_run_is_at_the_network_stays_removed() {
    let db = memory_db();
    read_in(&db);
    let doc = run_started(&db);
    let mut gone = mark("h2", "keep this", "2026-10-29T11:00:00+00:00");
    gone.deleted_at = Some("2026-10-29T11:00:00+00:00".into());
    db.put_annotation(&gone).expect("remove");

    apply(&db, &doc).expect("apply");

    let kept = db.find_annotation("h2").expect("find").expect("the tombstone is kept");
    assert_eq!(kept.deleted_at.as_deref(), Some("2026-10-29T11:00:00+00:00"));
    let next = snapshot(&db, NOW).expect("snapshot");
    assert!(next.annotations.iter().any(|a| a.id == "h2" && a.deleted_at.is_some()), "it travels");
    // The server's copy still has it live; the removal wins there too.
    let on_server = merge::merge(&next, &doc, NOW);
    assert!(on_server.annotations.iter().any(|a| a.id == "h2" && a.deleted_at.is_some()));
  }

  /// A book removed while the run is away stays removed: the snapshot's live
  /// row was written over the new tombstone, and the book was back at once,
  /// its file already gone.
  #[test]
  fn a_book_removed_while_a_run_is_at_the_network_stays_removed() {
    let db = memory_db();
    read_in(&db);
    let doc = run_started(&db);
    db.delete_book("bbb", "2026-10-29T11:00:00+00:00").expect("remove");

    let applied = apply(&db, &doc).expect("apply");

    let ids: Vec<String> = db.list_books().expect("list").into_iter().map(|book| book.id).collect();
    assert_eq!(ids, vec!["aaa".to_string()]);
    let row = db.find_by_id("bbb").expect("find").expect("the tombstone is kept");
    assert_eq!(row.deleted_at.as_deref(), Some("2026-10-29T11:00:00+00:00"));
    assert!(applied.removed.is_empty(), "removed here, not by the run");
    assert!(snapshot(&db, NOW).expect("snapshot").books.iter().any(|b| b.id == "bbb" && b.is_deleted()));
  }

  /// The run's own news still lands around what was written meanwhile.
  #[test]
  fn what_a_run_brings_lands_beside_what_was_written_meanwhile() {
    let db = memory_db();
    read_in(&db);
    let mut doc = run_started(&db);
    let ahead = doc.books.iter_mut().find(|book| book.id == "aaa").expect("aaa");
    ahead.progress = 0.8;
    ahead.progress_updated_at = "2026-10-29T11:30:00+00:00".into();
    db.put_annotation(&mark("h1", "second thoughts", "2026-10-29T11:00:00+00:00")).expect("edit");

    apply(&db, &doc).expect("apply");

    assert_eq!(db.find_by_id("aaa").expect("find").expect("there").progress, 0.8);
    assert_eq!(db.find_annotation("h1").expect("find").and_then(|a| a.note).as_deref(), Some("second thoughts"));
  }

  /// Sync audit D4, as the laptop meets it: the phone removed a book; the
  /// laptop, opening later, looks the book up (a cover, an author) and tidies
  /// its title before its first sync. Its stamps are later than the removal,
  /// and the book still leaves the laptop, rather than coming back everywhere.
  #[test]
  fn a_lookup_at_launch_does_not_bring_back_a_book_removed_elsewhere() {
    let laptop = memory_db();
    laptop.upsert_book(&record("aaa", 0.3)).expect("book");
    // An hour ago, on the phone.
    let removal = (chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
    let mut removed = merge::BookEntry::from_record(&record("aaa", 0.3));
    removed.deleted_at = Some(removal.clone());
    let phone = SyncDoc { books: vec![removed], ..SyncDoc::empty(NOW) };

    // At launch, before the sync: a lookup that finds an author, and the
    // title put through today's rules. Both stamp the metadata now.
    let mut found = laptop.find_by_id("aaa").expect("find").expect("there");
    found.author = Some("Found Author".into());
    laptop.update_metadata(&found).expect("lookup");
    laptop.retitle("aaa", "A Tidier Title", Some("Found Author"), &[]).expect("retitle");
    let stamped = laptop.find_by_id("aaa").expect("find").expect("there").metadata_updated_at.expect("stamped");
    assert!(merge::instant(&stamped) > merge::instant(&removal));

    let now = chrono::Utc::now().to_rfc3339();
    let merged = merge::merge(&snapshot(&laptop, &now).expect("snapshot"), &phone, &now);
    assert!(merged.books[0].is_deleted(), "the removal holds in what goes up");
    let applied = apply(&laptop, &merged).expect("apply");
    assert_eq!(applied.removed, vec!["aaa".to_string()]);
    assert!(laptop.list_books().expect("list").is_empty());

    // Reading on in it, on the other hand, is the reader wanting it back.
    let reader = memory_db();
    reader.upsert_book(&record("aaa", 0.3)).expect("book");
    reader.update_progress("aaa", 0.35, None, None).expect("read on");
    let merged = merge::merge(&snapshot(&reader, &now).expect("snapshot"), &phone, &now);
    assert!(!merged.books[0].is_deleted());
  }

  /// Sync audit D3, as a device keeps it: a stamp from a clock that ran
  /// ahead is written back as the run's time, so it cannot go on winning
  /// (and undo a removal made on another device) once the clock is right.
  #[test]
  fn a_stamp_from_a_fast_clock_is_put_right_in_the_rows() {
    let laptop = memory_db();
    let mut fast = record("aaa", 0.4);
    fast.progress_updated_at = Some("2026-10-29T12:20:00+00:00".into());
    laptop.upsert_book(&fast).expect("book");
    let doc = run_started(&laptop);
    apply(&laptop, &doc).expect("apply");
    assert_eq!(laptop.find_by_id("aaa").expect("find").expect("there").progress_updated_at.as_deref(), Some(NOW));

    // The phone removes the book a minute later; the laptop syncs at 12:30.
    let mut removed = merge::BookEntry::from_record(&laptop.find_by_id("aaa").expect("find").expect("there"));
    removed.deleted_at = Some("2026-10-29T12:01:00+00:00".into());
    let phone = SyncDoc { books: vec![removed], ..SyncDoc::empty(NOW) };
    let later = "2026-10-29T12:30:00+00:00";
    let merged = merge::merge(&snapshot(&laptop, later).expect("snapshot"), &phone, later);
    apply(&laptop, &merged).expect("apply");
    assert!(laptop.list_books().expect("list").is_empty(), "the removal holds");
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

  fn camp(saved_at: &str, state: &str) -> CampEntry {
    CampEntry { state: state.to_string(), saved_at: saved_at.to_string() }
  }

  /// The camp is in the backup: a camp takes months to build, and a new
  /// computer gets it back, with the stamp that says how new it is.
  #[test]
  fn the_camp_and_its_stamp_travel() {
    let from = memory_db();
    assert!(snapshot(&from, NOW).expect("snapshot").camp.is_none(), "no camp kept, none in the document");
    let built = camp("2026-10-01T10:00:00+00:00", r#"{"v":2,"camps":7,"raised":["aaa"]}"#);
    keep_camp(&from, &built).expect("kept");
    let doc = snapshot(&from, NOW).expect("snapshot");
    assert_eq!(doc.camp, Some(built.clone()));

    // Through the document as a transport writes and reads it.
    let sent: SyncDoc = serde_json::from_str(&serde_json::to_string(&doc).expect("json")).expect("parses");
    let to = memory_db();
    apply(&to, &sent).expect("apply");
    assert_eq!(to.get_setting(CAMP_SETTING).expect("row").as_deref(), Some(r#"{"v":2,"camps":7,"raised":["aaa"]}"#));
    assert_eq!(to.get_setting(CAMP_SAVED_AT_SETTING).expect("row").as_deref(), Some("2026-10-01T10:00:00+00:00"));
    // And on from there, unchanged.
    assert_eq!(snapshot(&to, NOW).expect("snapshot").camp, Some(built));
  }

  /// What a sync may do to the camp kept here: replace it with one saved
  /// later, and nothing else.
  #[test]
  fn applying_a_document_never_takes_a_camp_away_or_rolls_one_back() {
    let db = memory_db();
    let mine = camp("2026-10-05T10:00:00+00:00", r#"{"v":2,"camps":5}"#);
    keep_camp(&db, &mine).expect("kept");
    let with = |camp: Option<CampEntry>| SyncDoc { camp, ..SyncDoc::empty(NOW) };

    // A document with no camp (an older build's, or a device that never played).
    apply(&db, &with(None)).expect("apply");
    assert_eq!(kept_camp(&db).expect("camp"), Some(mine.clone()));
    // One saved earlier: a camp saved here while a run was away at the
    // network is newer than what that run merged, and stays.
    apply(&db, &with(Some(camp("2026-10-04T10:00:00+00:00", r#"{"v":2,"camps":4}"#)))).expect("apply");
    assert_eq!(kept_camp(&db).expect("camp"), Some(mine.clone()));
    // Something that is not a camp, however new it says it is.
    apply(&db, &with(Some(camp("2027-01-01T00:00:00+00:00", "[1,2,3]")))).expect("apply");
    assert_eq!(kept_camp(&db).expect("camp"), Some(mine));
    // One saved later replaces it, state and stamp together.
    let theirs = camp("2026-10-06T10:00:00+00:00", r#"{"v":2,"camps":6}"#);
    apply(&db, &with(Some(theirs.clone()))).expect("apply");
    assert_eq!(kept_camp(&db).expect("camp"), Some(theirs));

    // A camp kept before saves were stamped gives way to any stamped one.
    let old = memory_db();
    old.set_setting(CAMP_SETTING, r#"{"v":1,"acorns":20}"#).expect("an unstamped camp");
    assert_eq!(snapshot(&old, NOW).expect("snapshot").camp, Some(camp("", r#"{"v":1,"acorns":20}"#)));
    let stamped = camp("2026-01-01T00:00:00+00:00", r#"{"v":2,"camps":0}"#);
    apply(&old, &with(Some(stamped.clone()))).expect("apply");
    assert_eq!(kept_camp(&old).expect("camp"), Some(stamped));

    // And nothing that is not a camp is written to a device with none.
    let bare = memory_db();
    apply(&bare, &with(Some(camp("2027-01-01T00:00:00+00:00", "not json")))).expect("apply");
    assert_eq!(kept_camp(&bare).expect("camp"), None);
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

  /// A reader's pace follows them: what one device learned reaches the other,
  /// merged with what that one learned, rather than written over it.
  #[test]
  fn the_reading_profile_travels_and_merges_on_arrival() {
    use crate::sync::reading::{self, ReadingProfile};
    let parse = |json: &str| serde_json::from_str::<ReadingProfile>(json).expect("profile");
    let from = memory_db();
    reading::absorb(
      &from,
      &parse(r#"{"version":2,"core":{"updatedAt":"2026-09-21T10:00:00Z","base":{"wpm":250}},"books":{"dune":{"updatedAt":"2026-09-21T10:00:00Z","wpm":210}}}"#)
    )
    .expect("laptop learns");
    let doc = snapshot(&from, NOW).expect("snapshot");
    assert!(doc.reading_profile.is_some(), "the snapshot carries it");

    let to = memory_db();
    reading::absorb(
      &to,
      &parse(r#"{"version":2,"core":{"updatedAt":"2026-09-20T10:00:00Z","base":{"wpm":230}},"books":{"hobbit":{"updatedAt":"2026-09-20T10:00:00Z","wpm":290}}}"#)
    )
    .expect("phone learns");
    apply(&to, &doc).expect("apply");
    let arrived = reading::load(&to).expect("load").expect("present");
    assert_eq!(arrived.books.len(), 2, "both books' paces are kept");
    assert_eq!(arrived.core.updated_at, "2026-09-21T10:00:00Z", "the newer reader-wide part wins");
  }

  /// An unowned library takes the owner of what it is merged with; an owned
  /// one keeps its own whatever arrives. And its snapshot carries it.
  #[test]
  fn an_owner_is_inherited_only_by_an_unowned_library() {
    use crate::sync::owner;
    const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let owned_by = |tag: &str| SyncDoc { owner: Some(tag.to_string()), ..SyncDoc::empty(NOW) };

    let db = memory_db();
    assert_eq!(snapshot(&db, NOW).expect("snapshot").owner, None);
    apply(&db, &SyncDoc::empty(NOW)).expect("apply");
    assert_eq!(owner::get(&db), None, "nobody's stays nobody's");
    apply(&db, &owned_by(A)).expect("apply");
    assert_eq!(owner::get(&db).as_deref(), Some(A));
    apply(&db, &owned_by(B)).expect("apply");
    assert_eq!(owner::get(&db).as_deref(), Some(A), "never changed by a document");
    assert_eq!(snapshot(&db, NOW).expect("snapshot").owner.as_deref(), Some(A));

    // Something that is not a tag is no owner.
    let other = memory_db();
    apply(&other, &SyncDoc { owner: Some("../../x".to_string()), ..SyncDoc::empty(NOW) }).expect("apply");
    assert_eq!(owner::get(&other), None);

    // A later version's document is taken from the same way.
    let newer = memory_db();
    crate::sync::folder::take_from_newer(&newer, Some(owned_by(B)), NOW).expect("taken");
    assert_eq!(owner::get(&newer).as_deref(), Some(B));
  }
}
