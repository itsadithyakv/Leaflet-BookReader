//! "Keep a copy of my books in a folder": the setting, and the copying.
//!
//! The naming and the file work are in `storage::library_copy`; this is the
//! part that knows about the library and its settings. The folder is a fact
//! about this computer, so it lives in the `settings` table beside the sync
//! folder and never in the synced document or the backup.

use super::*;
use crate::storage::library_copy::{self, CopyError, Outcome};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// One copy at a time. Two at once for the same book would share a staging
/// file, and the loser would report a failure that never happened.
static COPYING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// "1" when the reader has turned the feature on. Off unless they did.
pub const COPY_ENABLED_SETTING: &str = "library_copy_enabled";
/// The folder they chose. Kept while the feature is off, so turning it back on
/// does not mean finding the folder again.
pub const COPY_FOLDER_SETTING: &str = "library_copy_folder";
/// Which file in that folder is which book: a JSON map of book id to file
/// name. What stops a book whose title changed being copied a second time.
const COPY_INDEX_SETTING: &str = "library_copy_index";
/// The last copy that failed, for Settings to show. JSON, or empty.
const COPY_PROBLEM_SETTING: &str = "library_copy_problem";

/// How many failures a "copy my library" run names; the rest are counted.
const MAX_FAILURES_LISTED: usize = 20;

/// A copy that did not happen, kept until a later run puts it right.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CopyProblem {
  pub at: String,
  pub message: String
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCopyStatus {
  pub enabled: bool,
  pub folder: Option<String>,
  /// The folder is there right now. False for an unplugged drive, or a folder
  /// that has been moved or deleted since it was chosen.
  pub folder_found: bool,
  pub problem: Option<CopyProblem>
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CopyFailure {
  pub title: String,
  pub reason: String
}

/// What "Copy my existing library there now" did.
#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CopyTally {
  pub copied: usize,
  pub already_there: usize,
  /// In the library, but the file has not been downloaded to this computer.
  pub not_downloaded: usize,
  pub failed: usize,
  /// The first few failures, by title, with why.
  pub failures: Vec<CopyFailure>
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCopyReport {
  #[serde(flatten)]
  pub tally: CopyTally,
  pub status: LibraryCopyStatus
}

fn setting(db: &db::Database, key: &str) -> Option<String> {
  db.get_setting(key).ok().flatten().filter(|value| !value.is_empty())
}

/// The folder to copy into, when the feature is on and one is chosen.
fn copy_folder(db: &db::Database) -> Option<PathBuf> {
  setting(db, COPY_ENABLED_SETTING)?;
  setting(db, COPY_FOLDER_SETTING).map(PathBuf::from)
}

fn load_index(db: &db::Database) -> BTreeMap<String, String> {
  setting(db, COPY_INDEX_SETTING)
    .and_then(|json| serde_json::from_str(&json).ok())
    .unwrap_or_default()
}

fn remember(db: &db::Database, names: impl IntoIterator<Item = (String, String)>) {
  let mut index = load_index(db);
  let mut changed = false;
  for (id, name) in names {
    if index.get(&id) != Some(&name) {
      index.insert(id, name);
      changed = true;
    }
  }
  if changed {
    if let Ok(json) = serde_json::to_string(&index) {
      let _ = db.set_setting(COPY_INDEX_SETTING, &json);
    }
  }
}

fn note_problem(db: &db::Database, message: &str) {
  crate::diag::warn(&format!("keep a copy: {message}"));
  let problem = CopyProblem { at: db::now_iso(), message: message.to_string() };
  if let Ok(json) = serde_json::to_string(&problem) {
    let _ = db.set_setting(COPY_PROBLEM_SETTING, &json);
  }
}

fn clear_problem(db: &db::Database) {
  let _ = db.set_setting(COPY_PROBLEM_SETTING, "");
}

/// Whether copies are being kept, for the diagnostics report. From the
/// settings alone: the folder is not looked at.
pub(crate) fn copies_on(db: &db::Database) -> bool {
  copy_folder(db).is_some()
}

/// The status as the settings have it. `folder_found` is left false: finding
/// out means asking the disk, and for a network share that is switched off
/// Windows takes its time to answer. That wait must not happen with the
/// database locked or on the window's own thread, so `look_for_folder` does it.
fn stored_status(db: &db::Database) -> LibraryCopyStatus {
  let folder = setting(db, COPY_FOLDER_SETTING);
  LibraryCopyStatus {
    enabled: setting(db, COPY_ENABLED_SETTING).is_some() && folder.is_some(),
    folder_found: false,
    folder,
    problem: setting(db, COPY_PROBLEM_SETTING).and_then(|json| serde_json::from_str(&json).ok())
  }
}

fn folder_is_there(status: LibraryCopyStatus) -> LibraryCopyStatus {
  let folder_found = status.folder.as_deref().is_some_and(|path| Path::new(path).is_dir());
  LibraryCopyStatus { folder_found, ..status }
}

/// Fills in `folder_found`, off the calling thread and with no lock held.
async fn look_for_folder(status: LibraryCopyStatus) -> LibraryCopyStatus {
  let unchecked = status.clone();
  tauri::async_runtime::spawn_blocking(move || folder_is_there(status))
    .await
    .unwrap_or(unchecked)
}

#[cfg(test)]
pub(crate) fn read_copy_status(db: &db::Database) -> LibraryCopyStatus {
  folder_is_there(stored_status(db))
}

/// True while the reader still wants copies in `folder`. They can switch the
/// option off or choose another folder while a copy is being made; what that
/// copy did then says nothing about the folder they have now.
fn still_copying_to(db: &db::Database, folder: &Path) -> bool {
  copy_folder(db).as_deref() == Some(folder)
}

/// False once a book has been removed from the library. Its background copy
/// may not have started yet, and its file is gone by then: that is not a
/// failure to show in Settings.
fn still_in_library(db: &db::Database, book_id: &str) -> bool {
  match db.find_by_id(book_id) {
    Ok(Some(book)) => book.deleted_at.is_none(),
    Ok(None) => false,
    // Not known either way: carry on, as before.
    Err(_) => true
  }
}

/// Saves the switch and, when one is given, the folder. A different folder
/// starts with nothing remembered: what was copied to the old one is not there.
fn store_settings(db: &db::Database, enabled: bool, folder: Option<&str>) -> Result<(), String> {
  if let Some(folder) = folder.map(str::trim).filter(|value| !value.is_empty()) {
    if setting(db, COPY_FOLDER_SETTING).as_deref() != Some(folder) {
      db.set_setting(COPY_INDEX_SETTING, "").map_err(|e| e.to_string())?;
      clear_problem(db);
    }
    db.set_setting(COPY_FOLDER_SETTING, folder).map_err(|e| e.to_string())?;
  }
  if enabled && setting(db, COPY_FOLDER_SETTING).is_none() {
    return Err("Choose a folder for the copies first.".to_string());
  }
  db.set_setting(COPY_ENABLED_SETTING, if enabled { "1" } else { "" })
    .map_err(|e| e.to_string())
}

fn copy_one(folder: &Path, book: &BookRecord, known_name: Option<&str>) -> Result<Outcome, CopyError> {
  if book.local_path.is_empty() {
    return Err(CopyError::NotOnThisDevice);
  }
  library_copy::copy_book(
    folder,
    Path::new(&book.local_path),
    &book.file_hash,
    &book.title,
    book.author.as_deref(),
    known_name
  )
}

/// Copies every book that is not in the folder yet. Returns the count and the
/// names to remember. One book failing does not stop the others, except when
/// the folder itself goes (a drive pulled out mid-run): then every remaining
/// book would fail the same way, so the run stops and says so once.
///
/// `keep_going` is asked before each book: a run stops between books when the
/// reader switches copies off or chooses another folder part-way through.
fn copy_all(
  folder: &Path,
  books: &[BookRecord],
  index: &BTreeMap<String, String>,
  keep_going: &dyn Fn() -> bool
) -> (CopyTally, Vec<(String, String)>) {
  let mut tally = CopyTally::default();
  let mut names = Vec::new();
  for (done, book) in books.iter().enumerate() {
    if !keep_going() {
      break;
    }
    match copy_one(folder, book, index.get(&book.id).map(String::as_str)) {
      Ok(outcome) => {
        match outcome {
          Outcome::Copied(_) => tally.copied += 1,
          Outcome::AlreadyThere(_) => tally.already_there += 1
        }
        if let Some(name) = outcome.file_name() {
          names.push((book.id.clone(), name));
        }
      }
      Err(CopyError::NotOnThisDevice) => tally.not_downloaded += 1,
      Err(error) => {
        let folder_gone = error == CopyError::FolderMissing;
        tally.failed += if folder_gone { books.len() - done } else { 1 };
        if tally.failures.len() < MAX_FAILURES_LISTED {
          tally.failures.push(CopyFailure { title: book.title.clone(), reason: error.to_string() });
        }
        if folder_gone {
          break;
        }
      }
    }
  }
  (tally, names)
}

/// Keeps copies of books that have just joined the library, if the reader
/// asked for that. In the background, by design: importing and reading must
/// never wait on a folder that may be on a slow or unplugged drive, and a copy
/// that fails must not fail them. It is written to the log and left for
/// Settings to show.
pub(crate) fn keep_copies_later(app: &AppHandle, books: Vec<BookRecord>) {
  if books.is_empty() {
    return;
  }
  let app = app.clone();
  tauri::async_runtime::spawn(async move {
    let state = app.state::<AppState>();
    for book in &books {
      keep_copy(&state, book).await;
    }
  });
}

async fn keep_copy(state: &State<'_, AppState>, book: &BookRecord) {
  let _one_at_a_time = COPYING.lock().await;
  let plan = {
    let db = state.db.guard();
    if !still_in_library(&db, &book.id) {
      return;
    }
    copy_folder(&db).map(|folder| (folder, load_index(&db).get(&book.id).cloned()))
  };
  let Some((folder, known_name)) = plan else {
    return;
  };

  let job = book.clone();
  let into = folder.clone();
  let result = tauri::async_runtime::spawn_blocking(move || copy_one(&into, &job, known_name.as_deref()))
    .await
    .unwrap_or_else(|error| Err(CopyError::Failed(format!("The copy was interrupted: {error}"))));

  let db = state.db.guard();
  if !still_copying_to(&db, &folder) {
    return;
  }
  match result {
    Ok(outcome) => remember(&db, outcome.file_name().map(|name| (book.id.clone(), name))),
    // Removed from the library while its copy was being made.
    Err(_) if !still_in_library(&db, &book.id) => {}
    Err(error) => note_problem(&db, &format!("\u{201c}{}\u{201d} wasn't copied. {error}", book.title))
  }
}

/// Async, so the look at the folder happens off the window's thread: a plain
/// command runs on it, and an unreachable network share froze the window each
/// time Settings was opened.
#[tauri::command]
pub async fn library_copy_status(state: State<'_, AppState>) -> Result<LibraryCopyStatus, String> {
  let status = {
    let db = state.db.guard();
    stored_status(&db)
  };
  Ok(look_for_folder(status).await)
}

/// Turns the feature on or off and, when `folder` is given, changes where the
/// copies go. The folder is checked here (it exists, it can be written to, it
/// is somewhere the reader can see), so a bad choice is refused on the spot.
#[tauri::command]
pub async fn library_copy_set(
  enabled: bool,
  folder: Option<String>,
  state: State<'_, AppState>
) -> Result<LibraryCopyStatus, String> {
  let folder = folder.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
  if let Some(folder) = folder.clone() {
    // Writes a test file, which on a slow drive is not for the window's thread.
    tauri::async_runtime::spawn_blocking(move || library_copy::check_folder(Path::new(&folder)))
      .await
      .map_err(|error| format!("Couldn't check that folder: {error}"))??;
  }
  let status = {
    let db = state.db.guard();
    store_settings(&db, enabled, folder.as_deref())?;
    stored_status(&db)
  };
  Ok(look_for_folder(status).await)
}

/// "Copy my existing library there now": every book already in the library.
#[tauri::command]
pub async fn library_copy_run(state: State<'_, AppState>, app: AppHandle) -> Result<LibraryCopyReport, String> {
  let _one_at_a_time = COPYING.lock().await;
  // Read once the turn has come: a run that waited behind another one would
  // otherwise work from the folder and the names as they were before it.
  let (folder, books, index) = {
    let db = state.db.guard();
    let folder = copy_folder(&db).ok_or_else(|| "Choose a folder for the copies first.".to_string())?;
    (folder, db.list_books().map_err(|e| e.to_string())?, load_index(&db))
  };

  let into = folder.clone();
  let (tally, names) = tauri::async_runtime::spawn_blocking(move || {
    if !into.is_dir() {
      return Err(CopyError::FolderMissing.to_string());
    }
    let keep_going = || {
      let state = app.state::<AppState>();
      let db = state.db.guard();
      still_copying_to(&db, &into)
    };
    Ok(copy_all(&into, &books, &index, &keep_going))
  })
  .await
  .map_err(|error| format!("Copy task failed: {error}"))??;

  let status = {
    let db = state.db.guard();
    // Only while this is still the folder: names and failures from a folder
    // the reader has since left would be remembered against the new one.
    if still_copying_to(&db, &folder) {
      remember(&db, names);
      match tally.failures.first() {
        Some(first) if tally.failed == 1 => {
          note_problem(&db, &format!("\u{201c}{}\u{201d} wasn't copied. {}", first.title, first.reason))
        }
        Some(first) => note_problem(&db, &format!("{} books weren't copied. {}", tally.failed, first.reason)),
        // Everything is there now, so an earlier failure has been put right.
        None => clear_problem(&db)
      }
    }
    stored_status(&db)
  };
  let status = look_for_folder(status).await;
  Ok(LibraryCopyReport { tally, status })
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;

  const NOW: &str = "2026-10-03T12:00:00+00:00";

  /// A library and a folder for copies, removed afterwards.
  struct Scratch {
    path: PathBuf
  }

  impl Scratch {
    fn new(name: &str) -> Self {
      let path = std::env::temp_dir().join(format!("leaflet-keep-copy-{name}-{}", std::process::id()));
      let _ = fs::remove_dir_all(&path);
      fs::create_dir_all(path.join("books")).expect("books dir");
      fs::create_dir_all(path.join("copies")).expect("copies dir");
      Self { path }
    }

    fn copies(&self) -> PathBuf {
      self.path.join("copies")
    }

    /// A book as the library stores it: `books/<hash>.epub`.
    fn book(&self, title: &str, bytes: &[u8]) -> BookRecord {
      let staged = self.path.join("books").join("incoming");
      fs::write(&staged, bytes).expect("write");
      let hash = storage::hash_file(&staged).expect("hash");
      let stored = self.path.join("books").join(format!("{hash}.epub"));
      fs::rename(&staged, &stored).expect("store");
      record(&hash, title, &stored.to_string_lossy())
    }

    fn names(&self) -> Vec<String> {
      let mut names: Vec<String> = fs::read_dir(self.copies())
        .expect("read copies")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
      names.sort();
      names
    }
  }

  impl Drop for Scratch {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.path);
    }
  }

  fn record(id: &str, title: &str, local_path: &str) -> BookRecord {
    BookRecord {
      finished_at: None,
      id: id.to_string(),
      title: title.to_string(),
      author: Some("Someone".to_string()),
      genres: Vec::new(),
      cover_url: None,
      local_path: local_path.to_string(),
      file_hash: id.to_string(),
      progress: 0.0,
      position: None,
      series: None,
      series_index: None,
      last_opened: None,
      created_at: NOW.to_string(),
      metadata_checked_at: None,
      metadata_updated_at: Some(NOW.to_string()),
      progress_updated_at: Some(NOW.to_string()),
      deleted_at: None,
      available: true
    }
  }

  #[test]
  fn it_is_off_until_the_reader_turns_it_on() {
    let db = memory_db();
    assert_eq!(
      read_copy_status(&db),
      LibraryCopyStatus { enabled: false, folder: None, folder_found: false, problem: None }
    );
    assert_eq!(copy_folder(&db), None);
    // On needs somewhere to copy to.
    assert!(store_settings(&db, true, None).is_err());
    assert_eq!(copy_folder(&db), None);
  }

  #[test]
  fn the_folder_is_remembered_while_the_feature_is_off() {
    let scratch = Scratch::new("remembered");
    let folder = scratch.copies().to_string_lossy().to_string();
    let db = memory_db();

    store_settings(&db, true, Some(&folder)).expect("on");
    assert_eq!(copy_folder(&db), Some(scratch.copies()));
    assert!(read_copy_status(&db).folder_found);

    store_settings(&db, false, None).expect("off");
    assert_eq!(copy_folder(&db), None, "off means nothing is copied");
    let status = read_copy_status(&db);
    assert!(!status.enabled);
    assert_eq!(status.folder.as_deref(), Some(folder.as_str()));

    store_settings(&db, true, None).expect("on again, same folder");
    assert_eq!(copy_folder(&db), Some(scratch.copies()));
  }

  /// The rule the sync document already keeps for `local_path`: a path on this
  /// computer means nothing on another one, and has no business in a backup.
  #[test]
  fn the_folder_never_reaches_the_synced_document() {
    let scratch = Scratch::new("sync");
    let folder = scratch.copies().to_string_lossy().to_string();
    let db = memory_db();
    let book = scratch.book("Dune", b"the whole book");
    db.upsert_book(&book).expect("import");
    store_settings(&db, true, Some(&folder)).expect("on");
    let (_, names) = copy_all(&scratch.copies(), &[book], &load_index(&db), &|| true);
    remember(&db, names);
    note_problem(&db, "something about the folder");

    let doc = crate::sync::store::snapshot(&db, NOW).expect("snapshot");
    let json = serde_json::to_string(&doc).expect("json");

    // The folder's own name, however the path's separators are escaped.
    let marker = scratch.path.file_name().unwrap().to_string_lossy().to_string();
    assert!(!json.contains(&marker), "the folder leaked into the document");
    assert!(!json.contains("library_copy"));
    assert!(!json.contains("Dune - Someone.epub"));
    assert!(!json.contains("something about the folder"));
  }

  #[test]
  fn the_whole_library_is_copied_and_counted() {
    let scratch = Scratch::new("run");
    let dune = scratch.book("Dune", b"the whole book");
    let emma = scratch.book("Emma", b"another book entirely");
    let pending = record("ccc", "Not Downloaded", &scratch.path.join("books").join("ccc.epub").to_string_lossy());
    let books = vec![dune.clone(), emma, pending];

    let (first, names) = copy_all(&scratch.copies(), &books, &BTreeMap::new(), &|| true);

    assert_eq!((first.copied, first.already_there, first.not_downloaded, first.failed), (2, 0, 1, 0));
    assert!(first.failures.is_empty());
    assert_eq!(scratch.names(), vec!["Dune - Someone.epub", "Emma - Someone.epub"]);
    assert_eq!(names.len(), 2);

    // Again, with what was remembered: nothing new, nothing duplicated.
    let index: BTreeMap<String, String> = names.into_iter().collect();
    let (second, _) = copy_all(&scratch.copies(), &books, &index, &|| true);
    assert_eq!((second.copied, second.already_there, second.not_downloaded, second.failed), (0, 2, 1, 0));
    assert_eq!(scratch.names().len(), 2);

    // And with nothing remembered (a database restored from a backup): the
    // files are recognised by their contents.
    let (third, _) = copy_all(&scratch.copies(), &books, &BTreeMap::new(), &|| true);
    assert_eq!((third.copied, third.already_there), (0, 2));
    assert_eq!(scratch.names().len(), 2);

    // The originals in the library are untouched.
    assert!(Path::new(&dune.local_path).exists());
  }

  #[test]
  fn an_unplugged_folder_fails_once_and_blocks_nothing() {
    let scratch = Scratch::new("gone");
    let books = vec![
      scratch.book("Dune", b"the whole book"),
      scratch.book("Emma", b"another book entirely"),
      scratch.book("Ulysses", b"a third")
    ];
    let gone = scratch.path.join("unplugged");

    let (tally, names) = copy_all(&gone, &books, &BTreeMap::new(), &|| true);

    assert_eq!((tally.copied, tally.failed), (0, 3));
    assert_eq!(tally.failures.len(), 1, "said once, not once a book");
    assert!(tally.failures[0].reason.contains("can't be found"));
    assert!(names.is_empty());
    assert!(!gone.exists());
    // The library itself is as it was.
    assert!(books.iter().all(|book| Path::new(&book.local_path).exists()));
  }

  #[test]
  fn a_failure_shows_in_settings_until_it_is_put_right() {
    let scratch = Scratch::new("problem");
    let folder = scratch.copies().to_string_lossy().to_string();
    let db = memory_db();
    store_settings(&db, true, Some(&folder)).expect("on");

    note_problem(&db, "\u{201c}Dune\u{201d} wasn't copied. That drive is full.");
    let problem = read_copy_status(&db).problem.expect("shown");
    assert!(problem.message.contains("Dune"));
    assert!(!problem.at.is_empty());

    clear_problem(&db);
    assert_eq!(read_copy_status(&db).problem, None);
  }

  #[test]
  fn a_new_folder_starts_with_nothing_remembered() {
    let scratch = Scratch::new("moved");
    let first = scratch.copies().to_string_lossy().to_string();
    let second = scratch.path.join("elsewhere");
    fs::create_dir_all(&second).expect("second folder");
    let db = memory_db();

    store_settings(&db, true, Some(&first)).expect("on");
    remember(&db, [("aaa".to_string(), "Dune.epub".to_string())]);
    note_problem(&db, "the old folder was full");
    assert_eq!(load_index(&db).len(), 1);

    // The same folder again keeps what is known about it.
    store_settings(&db, true, Some(&first)).expect("same");
    assert_eq!(load_index(&db).len(), 1);

    store_settings(&db, true, Some(&second.to_string_lossy())).expect("changed");
    assert!(load_index(&db).is_empty());
    assert_eq!(read_copy_status(&db).problem, None);
  }

  /// The bug this guards: a book removed before its background copy started
  /// had no file by then, and Settings said it "hasn't been downloaded to this
  /// computer yet".
  #[test]
  fn a_book_removed_before_its_copy_is_not_a_problem_to_report() {
    let scratch = Scratch::new("removed");
    let db = memory_db();
    let book = scratch.book("Dune", b"the whole book");
    db.upsert_book(&book).expect("import");
    assert!(still_in_library(&db, &book.id));

    db.delete_book(&book.id, NOW).expect("remove");
    assert!(!still_in_library(&db, &book.id), "a tombstone is not in the library");
    assert!(!still_in_library(&db, "never-imported"));
  }

  /// The bug this guards: a run carried on to the last book after the reader
  /// switched copies off (and was told "Copies stopped"), and one that ended
  /// after they chose another folder wrote the old folder's file names and
  /// failures into what is remembered about the new one.
  #[test]
  fn a_run_stops_when_copies_are_switched_off_or_the_folder_changes() {
    let scratch = Scratch::new("stopped");
    let first = scratch.copies();
    let second = scratch.path.join("elsewhere");
    fs::create_dir_all(&second).expect("second folder");
    let db = memory_db();
    store_settings(&db, true, Some(&first.to_string_lossy())).expect("on");
    let books = vec![
      scratch.book("Dune", b"the whole book"),
      scratch.book("Emma", b"another book entirely"),
      scratch.book("Ulysses", b"a third")
    ];
    assert!(still_copying_to(&db, &first));

    // Switched off after the first book.
    let asked = std::cell::Cell::new(0);
    let keep_going = || {
      asked.set(asked.get() + 1);
      if asked.get() == 2 {
        store_settings(&db, false, None).expect("off");
      }
      still_copying_to(&db, &first)
    };
    let (tally, names) = copy_all(&first, &books, &BTreeMap::new(), &keep_going);
    assert_eq!((tally.copied, tally.failed), (1, 0));
    assert_eq!(names.len(), 1);
    assert_eq!(scratch.names(), vec!["Dune - Someone.epub"]);
    assert!(!still_copying_to(&db, &first));

    // Another folder is not this folder, on or off.
    store_settings(&db, true, Some(&second.to_string_lossy())).expect("changed");
    assert!(!still_copying_to(&db, &first));
    assert!(still_copying_to(&db, &second));
  }

  /// Reading the settings never waits on the disk; only `look_for_folder` does.
  #[test]
  fn the_stored_status_does_not_look_at_the_folder() {
    let scratch = Scratch::new("stored");
    let db = memory_db();
    store_settings(&db, true, Some(&scratch.copies().to_string_lossy())).expect("on");

    assert!(!stored_status(&db).folder_found);
    assert!(folder_is_there(stored_status(&db)).folder_found);
    assert!(copies_on(&db));
    store_settings(&db, false, None).expect("off");
    assert!(!copies_on(&db));
  }

  #[test]
  fn a_folder_that_has_gone_is_reported_in_the_status() {
    let scratch = Scratch::new("status");
    let gone = scratch.path.join("was-here");
    let db = memory_db();
    store_settings(&db, true, Some(&gone.to_string_lossy())).expect("on");

    let status = read_copy_status(&db);
    assert!(status.enabled);
    assert!(!status.folder_found);
  }
}
