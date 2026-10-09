//! "Tidy a folder": the commands. The file work and its checks are in
//! `storage::tidy`; this is the part that knows the library, so it can say
//! which files are books the reader already has, and keep away from the two
//! folders Leaflet needs left as they are.
//!
//! The library keeps its own copy of every book it imports
//! (`books/<sha256>.<ext>` in the app's data folder), so renaming the files a
//! book came from changes nothing in it.

use super::*;
use crate::storage::tidy::{self, Applied, Last, Move, Scan, Undone};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// One at a time: a second run, or an undo, over a folder that is half moved
/// would find files gone that it was told were there.
static TIDYING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// The record of the last run, for Undo. A fact about this computer's files:
/// it is never part of the backup or the synced document.
fn undo_log() -> Result<PathBuf, String> {
  Ok(storage::app_data_dir().map_err(|e| e.to_string())?.join("tidy-undo.json"))
}

/// "Delete All Data": the record names the reader's folder and files, so it
/// goes with everything else. The files themselves stay as they are.
pub(super) fn forget_last() {
  if let Ok(log) = undo_log() {
    let _ = fs::remove_file(log);
  }
}

/// The folder that carries sync, if the reader set one. Its `books/` holds
/// every book under its hash: renamed, no other device would find them.
fn sync_folder(db: &db::Database) -> Option<PathBuf> {
  db.get_setting(FOLDER_SETTING).ok().flatten().filter(|value| !value.is_empty()).map(PathBuf::from)
}

fn not_the_sync_folder(folder: &Path, sync: Option<&Path>) -> Result<(), String> {
  match sync {
    Some(sync) if tidy::overlap(folder, sync) => {
      Err("That is the folder Leaflet syncs through. Its files have to keep their names.".to_string())
    }
    _ => Ok(())
  }
}

/// Every book file under `folder`, with what each says about itself and, for
/// one the library has (the same bytes), which book it is. Changes nothing.
#[tauri::command]
pub async fn tidy_scan(folder: String, state: State<'_, AppState>) -> Result<Scan, String> {
  let _one_at_a_time = TIDYING.lock().await;
  let (in_library, sync) = {
    let db = state.db.guard();
    let books = db.list_books().map_err(|e| e.to_string())?;
    let in_library: HashMap<String, String> = books.into_iter().map(|book| (book.file_hash, book.id)).collect();
    (in_library, sync_folder(&db))
  };
  // Every file is read to its end for its hash, which is not for the window's thread.
  let mut scan = tauri::async_runtime::spawn_blocking(move || {
    let folder = PathBuf::from(folder.trim());
    not_the_sync_folder(&folder, sync.as_deref())?;
    tidy::scan(&folder)
  })
  .await
  .map_err(|error| format!("Couldn't look in that folder: {error}"))??;
  for file in &mut scan.files {
    file.book_id = in_library.get(&file.hash).cloned();
  }
  Ok(scan)
}

/// Makes the moves the reader agreed to. Nothing the page sends is taken on
/// trust: `storage::tidy` checks the folder and every move again.
#[tauri::command]
pub async fn tidy_apply(folder: String, moves: Vec<Move>, state: State<'_, AppState>) -> Result<Applied, String> {
  let _one_at_a_time = TIDYING.lock().await;
  let (in_use, sync) = {
    let db = state.db.guard();
    let books = db.list_books().map_err(|e| e.to_string())?;
    // Every book is read from Leaflet's own copy, which no folder that passes
    // the check can hold. Should one ever be read from where it lies, it stays.
    let in_use: Vec<PathBuf> = books
      .into_iter()
      .filter(|book| !book.local_path.is_empty())
      .map(|book| PathBuf::from(book.local_path))
      .collect();
    (in_use, sync_folder(&db))
  };
  let log = undo_log()?;
  tauri::async_runtime::spawn_blocking(move || {
    let folder = PathBuf::from(folder.trim());
    not_the_sync_folder(&folder, sync.as_deref())?;
    tidy::apply(&folder, &moves, &in_use, &log)
  })
  .await
  .map_err(|error| format!("Couldn't rename those files: {error}"))?
}

/// Puts the last run back, as far as the folder is still as that run left it.
#[tauri::command]
pub async fn tidy_undo() -> Result<Undone, String> {
  let _one_at_a_time = TIDYING.lock().await;
  let log = undo_log()?;
  tauri::async_runtime::spawn_blocking(move || tidy::undo(&log))
    .await
    .map_err(|error| format!("Couldn't put those files back: {error}"))?
}

/// The last run, if it can still be undone: what shows the Undo button after
/// a restart.
#[tauri::command]
pub async fn tidy_last() -> Result<Option<Last>, String> {
  let log = undo_log()?;
  tauri::async_runtime::spawn_blocking(move || tidy::last(&log))
    .await
    .map_err(|error| format!("Couldn't read the last run: {error}"))
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;

  /// The bug this guards: tidying the sync folder would rename
  /// `books/<hash>.epub`, and every other device would lose the book.
  #[test]
  fn the_sync_folder_and_anything_around_it_is_refused() {
    let scratch = std::env::temp_dir().join(format!("leaflet-tidy-sync-{}", std::process::id()));
    let _ = fs::remove_dir_all(&scratch);
    let sync = scratch.join("cloud").join("Leaflet");
    fs::create_dir_all(sync.join("books")).expect("sync folder");
    fs::create_dir_all(scratch.join("my books")).expect("books folder");
    let db = memory_db();
    assert_eq!(sync_folder(&db), None);
    assert_eq!(not_the_sync_folder(&sync, sync_folder(&db).as_deref()), Ok(()));

    db.set_setting(FOLDER_SETTING, &sync.to_string_lossy()).expect("set");
    let chosen = sync_folder(&db);
    let asked = |folder: &Path| not_the_sync_folder(folder, chosen.as_deref());

    assert!(asked(&sync).unwrap_err().contains("syncs through"));
    assert!(asked(&sync.join("books")).is_err(), "inside it");
    assert!(asked(&scratch.join("cloud")).is_err(), "around it");
    assert_eq!(asked(&scratch.join("my books")), Ok(()));

    let _ = fs::remove_dir_all(&scratch);
  }
}
