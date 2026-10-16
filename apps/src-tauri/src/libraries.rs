//! Per-account libraries on one device.
//!
//! A library belongs to one Leaflet account (`sync::owner`). When another
//! account signs in on the same device, it gets a library of its own beside
//! the first, rather than a share of someone else's reading.
//!
//! A library is a folder holding its database, its books and its covers. The
//! first is the data folder itself, laid out as every earlier version left it;
//! another account's is `<app data>/libraries/<tag>`. A small file at the top,
//! `active-library`, says which is open: empty for the first, or
//! `libraries/<tag>`. Anything else in it (a hand edit, `..`, a damaged file)
//! opens the first. The device's own things stay at the top whichever library
//! is open: fonts, the text of PDFs, the log, the phone's sealed secrets, the
//! converter and the record of the last tidy.
//!
//! Switching (`switch`) swaps the database under the running app, which then
//! reloads its window. Who is signed in goes along (the session's rows; the
//! token is the device's, in the keychain), and so do the settings that are
//! the device's rather than the reader's (`DEVICE_KEYS`). Each library keeps
//! its own Drive connection (`sync::drive::slot_name`).

use crate::db::{Database, DB_FILE};
use crate::sync::{cloud, drive, owner, remote_config};
use crate::{diag, storage, AppState, LockExt};
use anyhow::{bail, Result};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

/// The file at the top of the data folder naming the library in use.
pub const POINTER_FILE: &str = "active-library";
/// The folder the other accounts' libraries live in.
pub const LIBRARIES_DIR: &str = "libraries";
/// Emitted once another library is open, for whatever still shows the old one.
pub const SWITCHED_EVENT: &str = "library-switched";

/// Settings that are the device's, not the reader's: where Leaflet's server
/// is (chosen, or learnt from the signed config) and the Google client the
/// reader entered. They follow the reader into another library.
pub const DEVICE_KEYS: [&str; 5] = [
  cloud::API_BASE_SETTING,
  remote_config::REMEMBERED_KEYS[0],
  remote_config::REMEMBERED_KEYS[1],
  drive::CLIENT_ID_SETTING,
  drive::CLIENT_SECRET_SETTING
];

pub fn pointer_path(root: &Path) -> PathBuf {
  root.join(POINTER_FILE)
}

/// What a pointer says: `Some(tag)` for `libraries/<tag>`, `None` for the
/// first library, which is also the answer for anything that is not exactly
/// a tag in the libraries folder.
pub fn parse_pointer(text: &str) -> Option<String> {
  let tag = text.trim().strip_prefix(LIBRARIES_DIR)?.strip_prefix('/')?;
  owner::is_tag(tag).then(|| tag.to_string())
}

/// The library the pointer in `root` names (`parse_pointer`).
pub fn read_pointer(root: &Path) -> Option<String> {
  let text = fs::read_to_string(pointer_path(root)).ok()?;
  let tag = parse_pointer(&text);
  if tag.is_none() && !text.trim().is_empty() {
    diag::warn("the active-library file names no library; opening the first");
  }
  tag
}

/// Points `root` at a library: `None` is the first. Written whole, through a
/// staging file, so a crash leaves the old pointer or the new, never half.
pub fn write_pointer(root: &Path, tag: Option<&str>) -> Result<()> {
  let text = match tag {
    None => String::new(),
    Some(tag) if owner::is_tag(tag) => format!("{LIBRARIES_DIR}/{tag}"),
    Some(tag) => bail!("not a library: {tag}")
  };
  fs::create_dir_all(root)?;
  let staging = root.join(format!("{POINTER_FILE}.part"));
  fs::write(&staging, text)?;
  if let Err(error) = fs::rename(&staging, pointer_path(root)) {
    let _ = fs::remove_file(&staging);
    return Err(error.into());
  }
  Ok(())
}

/// A library's folder under `root`: the root itself for the first.
pub fn dir_in(root: &Path, tag: Option<&str>) -> PathBuf {
  match tag {
    Some(tag) => root.join(LIBRARIES_DIR).join(tag),
    None => root.to_path_buf()
  }
}

/// Where `tag`'s own library is, or would be made.
pub fn dir_for(tag: &str) -> Result<PathBuf> {
  if !owner::is_tag(tag) {
    bail!("not a library: {tag}");
  }
  Ok(dir_in(&storage::app_data_dir()?, Some(tag)))
}

/// Which library a database is, from where it lies: `Some(tag)` for
/// `…/libraries/<tag>/library.db`, `None` for the first (and for anything
/// else, an in-memory database among them).
pub fn slot_of(db_path: &Path) -> Option<String> {
  let folder = db_path.parent()?;
  let tag = folder.file_name()?.to_str()?;
  let parent = folder.parent()?.file_name()?.to_str()?;
  (parent == LIBRARIES_DIR && owner::is_tag(tag)).then(|| tag.to_string())
}

/// The folder the pointer in `root` opens: the library it names when that is
/// there, else the first.
fn chosen_in(root: &Path) -> Option<PathBuf> {
  let tag = read_pointer(root)?;
  let dir = dir_in(root, Some(&tag));
  if dir.is_dir() {
    Some(dir)
  } else {
    diag::warn(&format!("the library in use ({}…) is missing; opening the first", &tag[..6]));
    None
  }
}

/// Opens, at startup, the library in use when Leaflet last closed. Called in
/// setup right after the data folder is known and before the database opens.
pub fn activate_at_startup() {
  let Ok(root) = storage::app_data_dir() else {
    return;
  };
  let chosen = chosen_in(&root);
  if let Some(dir) = &chosen {
    diag::info(&format!("opening the library at {}", dir.display()));
  }
  storage::set_library_dir(chosen);
}

/// The owner a library's database names, read without changing it.
fn owner_of_file(path: &Path) -> Option<String> {
  let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
  let conn = rusqlite::Connection::open_with_flags(path, flags).ok()?;
  let _ = conn.busy_timeout(std::time::Duration::from_millis(500));
  let value: String = conn
    .query_row("SELECT value FROM settings WHERE key = ?1", [owner::OWNER_SETTING], |row| row.get(0))
    .ok()?;
  owner::clean(Some(&value))
}

/// `tag`'s library under `root`: its own folder, or the first library when
/// that is the one it claimed.
pub fn find_in(root: &Path, tag: &str) -> Option<PathBuf> {
  if !owner::is_tag(tag) {
    return None;
  }
  let own = dir_in(root, Some(tag));
  if own.join(DB_FILE).is_file() {
    return Some(own);
  }
  let first = root.join(DB_FILE);
  (first.is_file() && owner_of_file(&first).as_deref() == Some(tag)).then(|| root.to_path_buf())
}

/// `tag`'s library on this device, if it has one.
pub fn find_for(tag: &str) -> Option<PathBuf> {
  find_in(&storage::app_data_dir().ok()?, tag)
}

/// `tag`'s library on this device when it is not the one open (`active`).
pub fn elsewhere(active: &Database, tag: &str) -> Option<PathBuf> {
  find_for(tag).filter(|dir| !is_open(active, dir))
}

/// Whether `dir` is the library `active` is.
pub fn is_open(active: &Database, dir: &Path) -> bool {
  dir.join(DB_FILE) == active.path()
}

/// Whether the device holds a library besides the one open: Delete All Data
/// then leaves the device's own things (fonts, PDF text) for the others.
pub fn others_exist(active: &Database) -> bool {
  storage::app_data_dir().is_ok_and(|root| others_in(&root, active.path()))
}

fn others_in(root: &Path, active_db: &Path) -> bool {
  let first = root.join(DB_FILE);
  if first.is_file() && first != active_db {
    return true;
  }
  let Ok(entries) = fs::read_dir(root.join(LIBRARIES_DIR)) else {
    return false;
  };
  entries.flatten().any(|entry| {
    let db = entry.path().join(DB_FILE);
    owner::is_tag(&entry.file_name().to_string_lossy()) && db.is_file() && db != active_db
  })
}

/// Copies the device's settings (`DEVICE_KEYS`) from one library to another.
pub fn copy_device_keys(from: &Database, to: &Database) -> Result<()> {
  for key in DEVICE_KEYS {
    let value = from.get_setting(key)?.unwrap_or_default();
    to.set_setting(key, &value)?;
  }
  Ok(())
}

/// Which library under `root` the folder `dir` is (`Ok(None)` the first), or
/// an error for a folder that is not a library's.
fn slot_for_dir(root: &Path, dir: &Path) -> Result<Option<String>> {
  if dir == root {
    return Ok(None);
  }
  match slot_of(&dir.join(DB_FILE)) {
    Some(tag) if dir_in(root, Some(&tag)) == dir => Ok(Some(tag)),
    _ => bail!("not a library's folder: {}", dir.display())
  }
}

/// Opens the library in `target` in place of the one open, and tells the
/// app (reminders, desktop Pip, the window). `fresh_tag`: a new library made
/// for that account, claimed for it and marked to ask before taking in what
/// the account already holds (`owner::FRESH_SETTING`).
pub async fn switch(state: &AppState, app: &tauri::AppHandle, target: &Path, fresh_tag: Option<&str>) -> Result<(), String> {
  let root = storage::app_data_dir().map_err(|e| e.to_string())?;
  let switched = switch_in(state, &root, target, fresh_tag).await.map_err(|error| {
    diag::error(&format!("another library did not open: {error:#}"));
    "Couldn't open that library.".to_string()
  })?;
  if !switched {
    return Ok(());
  }
  diag::info(&format!("opened the library at {}", target.display()));
  // The phone's alarms come from the new library's goal and days.
  crate::reminders::runtime::library_switched(app);
  // Her look is the new library's Pip.
  crate::desktop_pip::runtime::library_switched(app);
  let _ = tauri::Emitter::emit(app, SWITCHED_EVENT, ());
  Ok(())
}

/// The switch itself, in this order, so that a crash at any point leaves one
/// library or the other open and whole:
///
/// 1. no sync is running, and none starts (`sync_lock`);
/// 2. the library count moves on, so late writes are dropped (`db_for`);
/// 3. the target's database opens (made, claimed and marked fresh if new);
/// 4. the device's settings and who is signed in are copied into it;
/// 5. the pointer names it (from here a restart opens it);
/// 6. it replaces the open database, and its folder the books and covers;
/// 7. the old one forgets who is signed in, empties its log and closes;
/// 8. what was remembered of the old library is let go.
///
/// Whether anything changed: the target may be open already.
pub(crate) async fn switch_in(state: &AppState, root: &Path, target: &Path, fresh_tag: Option<&str>) -> Result<bool> {
  let target_tag = slot_for_dir(root, target)?;
  let _running = state.sync_lock.lock().await;
  if is_open(&state.db.guard(), target) {
    return Ok(false);
  }
  state.library_epoch.fetch_add(1, Ordering::SeqCst);

  let opened = Database::open_at(&target.join(DB_FILE))?;
  if let Some(tag) = fresh_tag {
    owner::claim_if_unowned(&opened, tag)?;
    owner::set_fresh(&opened, true)?;
  }

  let old = {
    let mut db = state.db.guard();
    copy_device_keys(&db, &opened)?;
    cloud::copy_session_markers(&db, &opened)?;
    write_pointer(root, target_tag.as_deref())?;
    // With the database held: no command sees one library's rows beside
    // another's books.
    storage::set_library_dir(Some(target.to_path_buf()));
    std::mem::replace(&mut *db, opened)
  };

  // Staying out of the old library's sync was instead of a library of one's
  // own; now there is one, the next sign-in there opens it again.
  if let Err(error) = owner::set_stay_out(&old, None) {
    diag::warn(&format!("the library left behind still keeps someone out of sync: {error:#}"));
  }
  if let Err(error) = cloud::clear_session_markers(&old) {
    diag::warn(&format!("the library left behind still names who was signed in: {error:#}"));
  }
  old.checkpoint();
  drop(old);

  state.comic_pages.guard().clear();
  // A Drive consent under way was for the old library's Drive.
  *state.drive.guard() = crate::sync::DriveState::default();
  crate::commands::forget_run_state();
  crate::search::call_off();
  Ok(true)
}

#[cfg(test)]
mod tests {
  use super::*;

  const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  /// A data folder of its own for a test.
  struct Scratch(PathBuf);

  impl Scratch {
    fn new(name: &str) -> Self {
      let dir = std::env::temp_dir().join(format!("leaflet-libraries-{name}-{}", std::process::id()));
      let _ = fs::remove_dir_all(&dir);
      fs::create_dir_all(&dir).expect("scratch");
      Scratch(dir)
    }
  }

  impl Drop for Scratch {
    fn drop(&mut self) {
      storage::set_library_dir(None);
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  #[test]
  fn a_pointer_names_a_library_or_the_first_one() {
    assert_eq!(parse_pointer(""), None);
    assert_eq!(parse_pointer(&format!("libraries/{A}")).as_deref(), Some(A));
    assert_eq!(parse_pointer(&format!("  libraries/{A}\n")).as_deref(), Some(A), "a trailing newline is forgiven");
    assert_eq!(parse_pointer("libraries/.."), None);
    assert_eq!(parse_pointer(&format!("libraries/../{A}")), None);
    assert_eq!(parse_pointer(&format!("libraries/{A}/..")), None);
    assert_eq!(parse_pointer(&format!("libraries\\{A}")), None);
    assert_eq!(parse_pointer(&format!("/libraries/{A}")), None);
    assert_eq!(parse_pointer(&format!("libraries/{}", A.to_uppercase())), None);
    assert_eq!(parse_pointer(&format!("libraries/{}", &A[..31])), None);
    assert_eq!(parse_pointer("libraries/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"), None, "not hex");
    assert_eq!(parse_pointer("C:\\Windows"), None);
  }

  #[test]
  fn a_pointer_is_written_whole_and_read_back() {
    let root = Scratch::new("pointer");
    assert_eq!(read_pointer(&root.0), None, "no file: the first library");
    write_pointer(&root.0, Some(B)).expect("written");
    assert_eq!(read_pointer(&root.0).as_deref(), Some(B));
    assert!(!root.0.join("active-library.part").exists(), "no staging file is left");
    write_pointer(&root.0, None).expect("back to the first");
    assert_eq!(fs::read_to_string(pointer_path(&root.0)).expect("file"), "");
    assert_eq!(read_pointer(&root.0), None);
    assert!(write_pointer(&root.0, Some("../elsewhere")).is_err());
    fs::write(pointer_path(&root.0), "../../somewhere").expect("a damaged pointer");
    assert_eq!(read_pointer(&root.0), None);
  }

  #[test]
  fn startup_opens_the_named_library_only_when_its_folder_is_there() {
    let root = Scratch::new("startup");
    assert_eq!(chosen_in(&root.0), None);
    write_pointer(&root.0, Some(B)).expect("written");
    assert_eq!(chosen_in(&root.0), None, "its folder is missing: the first library opens");
    fs::create_dir_all(dir_in(&root.0, Some(B))).expect("folder");
    assert_eq!(chosen_in(&root.0), Some(root.0.join("libraries").join(B)));
  }

  #[test]
  fn a_database_says_which_library_it_is_by_where_it_lies() {
    let root = PathBuf::from("data");
    assert_eq!(slot_of(&root.join("library.db")), None);
    assert_eq!(slot_of(&root.join("libraries").join(A).join("library.db")).as_deref(), Some(A));
    assert_eq!(slot_of(&root.join("libraries").join("someone").join("library.db")), None);
    assert_eq!(slot_of(&root.join("elsewhere").join(A).join("library.db")), None);
    assert_eq!(slot_of(Path::new(":memory:")), None);
    assert_eq!(slot_for_dir(&root, &root).expect("the first"), None);
    assert_eq!(slot_for_dir(&root, &dir_in(&root, Some(A))).expect("A's").as_deref(), Some(A));
    assert!(slot_for_dir(&root, &root.join("libraries").join("someone")).is_err());
    assert!(slot_for_dir(&root, &PathBuf::from("other").join("libraries").join(A)).is_err(), "under another root");
  }

  #[test]
  fn an_accounts_library_is_its_own_folder_or_the_first_it_claimed() {
    let root = Scratch::new("find");
    assert_eq!(find_in(&root.0, A), None, "nothing on the device");
    {
      let first = Database::open_at(&root.0.join(DB_FILE)).expect("first");
      assert_eq!(find_in(&root.0, A), None, "the first library is nobody's");
      owner::claim_if_unowned(&first, A).expect("claimed");
      assert_eq!(find_in(&root.0, A), Some(root.0.clone()), "read while it is open");
      assert_eq!(find_in(&root.0, B), None);
      assert!(is_open(&first, &root.0));
    }
    fs::create_dir_all(dir_in(&root.0, Some(B))).expect("folder");
    assert_eq!(find_in(&root.0, B), None, "a folder without a database is no library");
    Database::open_at(&dir_in(&root.0, Some(B)).join(DB_FILE)).expect("B's");
    assert_eq!(find_in(&root.0, B), Some(dir_in(&root.0, Some(B))));
    assert_eq!(find_in(&root.0, "not a tag"), None);
    assert!(others_in(&root.0, &root.0.join(DB_FILE)), "B's is another");
    assert!(others_in(&root.0, &dir_in(&root.0, Some(B)).join(DB_FILE)), "the first is another");
  }

  #[test]
  fn alone_on_the_device_a_library_has_no_others() {
    let root = Scratch::new("alone");
    assert!(!others_in(&root.0, &root.0.join(DB_FILE)));
    Database::open_at(&root.0.join(DB_FILE)).expect("first");
    assert!(!others_in(&root.0, &root.0.join(DB_FILE)));
  }

  fn signed_in_rows(db: &Database) -> Vec<String> {
    [cloud::ACCOUNT_API_SETTING, cloud::ACCOUNT_CACHE_SETTING, cloud::PROFILE_VISIBILITY_SETTING]
      .iter()
      .map(|key| db.get_setting(key).expect("read").unwrap_or_default())
      .collect()
  }

  #[tokio::test]
  async fn a_switch_carries_the_device_and_the_sign_in_and_stamps_a_fresh_library() {
    let root = Scratch::new("switch");
    storage::set_library_dir(Some(root.0.clone()));
    let first = Database::open_at(&root.0.join(DB_FILE)).expect("first");
    owner::claim_if_unowned(&first, A).expect("A's");
    for (key, value) in [
      (cloud::API_BASE_SETTING, "https://leaflet.example"),
      (remote_config::REMEMBERED_KEYS[0], "https://api.leaflet.example"),
      (remote_config::REMEMBERED_KEYS[1], "2026-10-01T00:00:00Z"),
      (drive::CLIENT_ID_SETTING, "id.apps.googleusercontent.com"),
      (drive::CLIENT_SECRET_SETTING, "shh"),
      (cloud::ACCOUNT_API_SETTING, "https://leaflet.example"),
      (cloud::ACCOUNT_CACHE_SETTING, "{\"id\":\"b\"}"),
      (cloud::PROFILE_VISIBILITY_SETTING, "public"),
      ("sync_folder_path", "D:/Sync")
    ] {
      first.set_setting(key, value).expect("seed");
    }
    owner::set_stay_out(&first, Some(B)).expect("B stayed out of A's");
    let state = AppState::for_tests(first);
    let before = state.epoch();
    let theirs = dir_in(&root.0, Some(B));
    fs::create_dir_all(&theirs).expect("folder");

    assert!(switch_in(&state, &root.0, &theirs, Some(B)).await.expect("switched"));

    assert_eq!(state.epoch(), before + 1, "late writes for the first library are dropped");
    assert_eq!(read_pointer(&root.0).as_deref(), Some(B), "a restart opens B's");
    assert_eq!(storage::library_dir().expect("dir"), theirs);
    assert_eq!(storage::books_dir().expect("books"), theirs.join("books"), "the books follow the library");
    assert_eq!(storage::covers_dir().expect("covers"), theirs.join("covers"));
    {
      let db = state.db.guard();
      assert_eq!(db.path(), theirs.join(DB_FILE));
      for key in DEVICE_KEYS {
        assert!(db.get_setting(key).expect("read").is_some_and(|value| !value.is_empty()), "{key} goes along");
      }
      assert_eq!(signed_in_rows(&db), ["https://leaflet.example", "{\"id\":\"b\"}", "public"]);
      assert_eq!(owner::get(&db).as_deref(), Some(B), "a fresh library is its account's");
      assert!(owner::is_fresh(&db));
      assert_eq!(db.get_setting("sync_folder_path").expect("read"), None, "the reader's own settings stay");
    }
    let left = Database::open_at(&root.0.join(DB_FILE)).expect("reopened");
    assert_eq!(signed_in_rows(&left), ["", "", ""], "the library left behind is signed out");
    assert_eq!(owner::get(&left).as_deref(), Some(A), "and still A's");
    assert!(!owner::stays_out_as(&left, Some(B)), "B has a library of its own now: back there, B is moved to it");
    assert_eq!(left.get_setting(drive::CLIENT_ID_SETTING).expect("read").as_deref(), Some("id.apps.googleusercontent.com"));
    drop(left);

    assert!(!switch_in(&state, &root.0, &theirs, None).await.expect("again"), "already open");
    assert_eq!(state.epoch(), before + 1);

    assert!(switch_in(&state, &root.0, &root.0, None).await.expect("back"));
    assert_eq!(read_pointer(&root.0), None);
    assert_eq!(storage::books_dir().expect("books"), root.0.join("books"));
    let db = state.db.guard();
    assert_eq!(db.path(), root.0.join(DB_FILE));
    assert_eq!(signed_in_rows(&db), ["https://leaflet.example", "{\"id\":\"b\"}", "public"], "the sign-in came back");
    assert!(!owner::is_fresh(&db));
  }

  #[tokio::test]
  async fn a_switch_refuses_a_folder_that_is_no_library() {
    let root = Scratch::new("refuse");
    let state = AppState::for_tests(Database::open_at(&root.0.join(DB_FILE)).expect("first"));
    assert!(switch_in(&state, &root.0, &root.0.join("libraries").join(".."), None).await.is_err());
    assert!(switch_in(&state, &root.0, &std::env::temp_dir(), None).await.is_err());
    assert_eq!(state.epoch(), 0, "nothing moved");
    assert_eq!(read_pointer(&root.0), None);
  }

  #[test]
  fn a_write_from_before_a_switch_is_dropped() {
    let state = AppState::for_tests(crate::db::tests::memory_db());
    let started = state.epoch();
    assert!(state.db_for(started).is_some(), "the same library: written");
    state.library_epoch.fetch_add(1, Ordering::SeqCst);
    assert!(state.db_for(started).is_none(), "another library: dropped");
    assert!(state.db_for(state.epoch()).is_some());
  }
}
