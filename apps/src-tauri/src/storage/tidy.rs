//! "Tidy a folder": the reader's own book files, renamed and sorted into
//! `Author/Series/NN - Title.ext`.
//!
//! Only when asked, and in three steps. `scan` reads what is in the folder and
//! changes nothing. The page works out the new names (`library/tidyPlan.ts`)
//! and shows them. `apply` makes the moves the reader agreed to, and `undo`
//! puts the last run back.
//!
//! The page's plan is not trusted: every move is checked again here. A file is
//! only ever renamed inside the folder, never over another file, and no file
//! is deleted. The one thing removed is a folder left empty, with `remove_dir`,
//! which refuses a folder that still holds anything.

use super::library_copy;
use super::{extract_basic_metadata, hash_for_import};
use crate::formats;
use crate::metadata::normalize;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// How many folders below the chosen one are looked into.
const MAX_DEPTH: usize = 8;
/// How many book files one scan reads. Every one is hashed, so this is also
/// what stops a scan of the wrong folder running for an hour.
const MAX_FILES: usize = 5_000;
/// The longest whole path Explorer and most Windows apps will open.
const MAX_PATH_CHARS: usize = 259;

const GONE: &str = "That file is no longer there.";
const TAKEN: &str = "A file with that name is already there.";
const NOT_INSIDE: &str = "That is not a file in this folder.";

/// One book file in the folder, and what it says about itself.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
  /// From the folder, with `/` between the parts.
  pub path: String,
  pub size: u64,
  pub hash: String,
  /// The book in the library with these exact bytes. Filled in by the command:
  /// nothing here knows the library.
  pub book_id: Option<String>,
  pub title: String,
  pub author: Option<String>,
  pub series: Option<String>,
  pub series_index: Option<f32>,
  pub extension: String
}

/// A book file the scan could not read. It keeps its name and its place.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LeftAlone {
  pub path: String,
  pub reason: String
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
  pub folder: String,
  pub files: Vec<Found>,
  pub left_alone: Vec<LeftAlone>,
  /// The folder holds more book files than one scan reads.
  pub capped: bool
}

/// A file's place now and the place it is to have, both from the folder.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Move {
  pub from: String,
  pub to: String
}

/// A move that was not made, and why, in the reader's words.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Skipped {
  pub from: String,
  pub reason: String
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Applied {
  pub moved: usize,
  pub skipped: Vec<Skipped>
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Undone {
  pub restored: usize,
  pub skipped: Vec<Skipped>
}

/// The last run, for the Undo button.
#[derive(Debug, Serialize, PartialEq)]
pub struct Last {
  pub folder: String,
  pub count: usize,
  pub at: String
}

/// What `undo` needs: the moves that were made, in the order they were made,
/// and the folders made for them.
#[derive(Debug, Serialize, Deserialize)]
struct UndoLog {
  folder: String,
  at: String,
  moves: Vec<Move>,
  made_dirs: Vec<String>
}

// ---- which folders ----------------------------------------------------------

#[cfg(windows)]
fn is_network_share(path: &Path) -> bool {
  use std::path::{Component, Prefix};
  matches!(
    path.components().next(),
    Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::UNC(..) | Prefix::VerbatimUNC(..))
  )
}

#[cfg(not(windows))]
fn is_network_share(_path: &Path) -> bool {
  false
}

/// True when one of the two folders is the other, or is inside it.
pub fn overlap(first: &Path, second: &Path) -> bool {
  match (fs::canonicalize(first), fs::canonicalize(second)) {
    (Ok(first), Ok(second)) => first.starts_with(&second) || second.starts_with(&first),
    _ => false
  }
}

/// Why a folder holds too much to be a folder of books, from where it is: a
/// whole drive, the reader's home folder or anything above it, a folder with
/// Leaflet's own library inside. Every document in one of those would be
/// taken for a book. All three paths are as the disk names them.
fn too_wide(found: &Path, home: Option<&Path>, own: Option<&Path>) -> Option<&'static str> {
  if found.parent().is_none() && !is_network_share(found) {
    return Some("That is a whole drive. Choose the folder your books are in.");
  }
  if home.is_some_and(|home| home.starts_with(found)) {
    return Some("That folder holds everything of yours, not only books. Choose the folder your books are in.");
  }
  if own.is_some_and(|own| own.starts_with(found)) {
    return Some("Leaflet's own library is inside that folder. Choose the folder your books are in.");
  }
  None
}

/// Whether `folder` is one to tidy.
pub fn check_folder(folder: &Path) -> Result<(), String> {
  let missing = || "That folder does not exist.".to_string();
  let found = fs::canonicalize(folder).map_err(|_| missing())?;
  if !found.is_dir() {
    return Err(missing());
  }
  let home = dirs::home_dir().and_then(|home| fs::canonicalize(home).ok());
  let own = super::app_data_dir().ok().and_then(|own| fs::canonicalize(own).ok());
  if let Some(reason) = too_wide(&found, home.as_deref(), own.as_deref()) {
    return Err(reason.to_string());
  }
  // Leaflet's data folder itself, AppData (a packaged app's writes there are
  // redirected, so the files would not be the ones the reader sees), and a
  // folder that cannot be written to.
  library_copy::check_folder(folder)
}

// ---- reading the folder -----------------------------------------------------

/// Hidden and system files are not the reader's books, whatever they are
/// called: a dot file, `desktop.ini`, a folder Windows keeps for itself.
fn is_hidden(entry: &fs::DirEntry) -> bool {
  if entry.file_name().to_string_lossy().starts_with('.') {
    return true;
  }
  #[cfg(windows)]
  {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN_OR_SYSTEM: u32 = 0x2 | 0x4;
    // Not known either way counts as hidden: it is left alone.
    if entry.metadata().map(|metadata| metadata.file_attributes() & HIDDEN_OR_SYSTEM != 0).unwrap_or(true) {
      return true;
    }
  }
  false
}

/// Every book file under `dir`, as `(path from the folder, path on disk)`.
/// Returns true when it stopped at `limit`. A link or a junction is neither a
/// file nor a folder to `file_type`, so none is followed out of the folder.
fn walk(dir: &Path, prefix: &str, depth: usize, limit: usize, out: &mut Vec<(String, PathBuf)>) -> bool {
  let Ok(entries) = fs::read_dir(dir) else {
    return false;
  };
  let mut entries: Vec<fs::DirEntry> = entries.flatten().collect();
  // The disk's own order differs from one drive to the next.
  entries.sort_by_key(|entry| entry.file_name());
  let mut folders = Vec::new();
  for entry in entries {
    let name = entry.file_name();
    // A name that is not text cannot be sent to the page and back.
    let (Some(name), Ok(file_type)) = (name.to_str(), entry.file_type()) else {
      continue;
    };
    if is_hidden(&entry) {
      continue;
    }
    let relative = if prefix.is_empty() { name.to_string() } else { format!("{prefix}/{name}") };
    if file_type.is_dir() {
      folders.push((relative, entry.path()));
    } else if file_type.is_file() && formats::is_supported(&formats::extension_of(&entry.path())) {
      if out.len() >= limit {
        return true;
      }
      out.push((relative, entry.path()));
    }
  }
  if depth == 0 {
    return false;
  }
  folders.into_iter().any(|(relative, path)| walk(&path, &relative, depth - 1, limit, out))
}

/// One file's hash and what it says about itself, by the rules import uses.
fn read_one(relative: &str, path: &Path) -> Result<Found, String> {
  let hash = hash_for_import(path).map_err(|error| error.to_string())?;
  let size = fs::metadata(path).map(|metadata| metadata.len()).map_err(|_| GONE.to_string())?;
  let basic = extract_basic_metadata(path).unwrap_or_default();
  let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("Untitled");
  let identity = normalize::identify(stem, &basic);
  Ok(Found {
    path: relative.to_string(),
    size,
    hash,
    book_id: None,
    title: identity.title,
    author: identity.author,
    series: identity.series,
    series_index: identity.series_index,
    extension: formats::extension_of(path)
  })
}

fn scan_checked(folder: &Path, limit: usize) -> Scan {
  let mut paths = Vec::new();
  let capped = walk(folder, "", MAX_DEPTH, limit, &mut paths);
  let mut files = Vec::new();
  let mut left_alone = Vec::new();
  for (relative, path) in paths {
    // These are files nobody has checked, and a parser that panics on one of
    // them must not lose the scan of the rest.
    let read = std::panic::catch_unwind(|| read_one(&relative, &path))
      .unwrap_or_else(|_| Err("Leaflet could not read that file.".to_string()));
    match read {
      Ok(found) => files.push(found),
      Err(reason) => left_alone.push(LeftAlone { path: relative, reason })
    }
  }
  Scan { folder: folder.to_string_lossy().to_string(), files, left_alone, capped }
}

/// Every book file in `folder` and the folders inside it. Reads only.
pub fn scan(folder: &Path) -> Result<Scan, String> {
  check_folder(folder)?;
  Ok(scan_checked(folder, MAX_FILES))
}

// ---- moving -----------------------------------------------------------------

/// A path as the page names it, split into its parts. `None` for anything that
/// is not plainly inside the folder: a drive, a root, `..`, an empty part.
fn parts(relative: &str) -> Option<Vec<&str>> {
  if relative.is_empty() || relative.contains('\0') {
    return None;
  }
  let parts: Vec<&str> = relative.split(['/', '\\']).collect();
  let plain = |part: &&str| {
    !part.is_empty()
      && *part != "."
      && *part != ".."
      // Windows reads `C:` as a drive and `name:stream` as part of a file, and
      // drops a trailing dot or space, so the name used is not the name given.
      && !(cfg!(windows) && (part.contains(':') || part.ends_with(['.', ' '])))
  };
  parts.iter().all(plain).then_some(parts)
}

/// A name the page may ask for: one Windows, macOS and Linux all keep as
/// written. The planner only makes names like this; anything else did not
/// come from it.
fn legal_name(name: &str) -> bool {
  !name.is_empty()
    && name.encode_utf16().count() <= 255
    && !name.chars().any(|c| c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
    && !name.starts_with([' ', '.'])
    && !name.ends_with([' ', '.'])
    && !library_copy::is_reserved_name(name)
}

/// A book file stays a book file of the same kind: `x.epub` cannot become
/// `x.exe`, and a file that is not a book is not moved at all.
fn same_kind(from: &str, to: &str) -> bool {
  let from = formats::extension_of(Path::new(from));
  formats::is_supported(&from) && from == formats::extension_of(Path::new(to))
}

fn join(folder: &Path, parts: &[&str]) -> PathBuf {
  parts.iter().fold(folder.to_path_buf(), |path, part| path.join(part))
}

fn same_file(first: &Path, second: &Path) -> bool {
  matches!((fs::canonicalize(first), fs::canonicalize(second)), (Ok(first), Ok(second)) if first == second)
}

fn describe(error: &io::Error) -> String {
  // Windows: 32 a sharing violation, 33 a lock on part of the file.
  if cfg!(windows) && matches!(error.raw_os_error(), Some(32) | Some(33)) {
    return "That file is open in another program.".to_string();
  }
  match error.kind() {
    io::ErrorKind::NotFound => GONE.to_string(),
    io::ErrorKind::PermissionDenied => "Leaflet isn't allowed to rename that file.".to_string(),
    _ => format!("It couldn't be renamed: {error}")
  }
}

/// Renames the file at `from` to `to`, both inside `folder` (`root` is the
/// folder as the disk names it). Folders made on the way are added to `made`.
///
/// Every folder on both paths has to be a real folder, not a link or a
/// junction, and both ends are looked up on the disk and compared with `root`:
/// a path that is inside the folder by its text can still lead out of it.
///
/// `any_length` is for putting a file back: the name it had was the reader's
/// own, however long. (A copy of the owner's folder, tidied and undone, left
/// one book of 25 under its new name: its old one was too long to be given.)
fn relocate(folder: &Path, root: &Path, from: &[&str], to: &[&str], any_length: bool, made: &mut Vec<String>) -> Result<(), String> {
  let real_dir = |path: &Path| fs::symlink_metadata(path).map(|metadata| metadata.is_dir()).unwrap_or(false);
  let (Some((_, from_dirs)), Some((_, to_dirs))) = (from.split_last(), to.split_last()) else {
    return Err(NOT_INSIDE.to_string());
  };

  let mut source = folder.to_path_buf();
  for dir in from_dirs {
    source.push(dir);
    if !real_dir(&source) {
      return Err(GONE.to_string());
    }
  }
  let source = join(folder, from);
  if !fs::symlink_metadata(&source).map(|metadata| metadata.is_file()).unwrap_or(false) {
    return Err(GONE.to_string());
  }
  if !fs::canonicalize(&source).is_ok_and(|real| real.starts_with(root)) {
    return Err(NOT_INSIDE.to_string());
  }

  let target = join(folder, to);
  // The one file that may already have the name is this file: a rename that
  // only changes the case of its letters.
  let taken = |target: &Path| fs::symlink_metadata(target).is_ok() && !same_file(&source, target);
  if taken(&target) {
    return Err(TAKEN.to_string());
  }
  // Leaflet could write a longer path; Explorer could not open what it wrote.
  let length = |path: &Path| path.to_string_lossy().encode_utf16().count();
  if cfg!(windows) && !any_length && length(&target) > MAX_PATH_CHARS && length(&target) > length(&source) {
    return Err("That name would be too long for Windows to open.".to_string());
  }

  let mut parent = folder.to_path_buf();
  for (depth, dir) in to_dirs.iter().enumerate() {
    parent.push(dir);
    match fs::symlink_metadata(&parent) {
      Ok(metadata) if metadata.is_dir() => {}
      Ok(_) => return Err("Something that is not a folder has that folder's name.".to_string()),
      Err(_) => {
        fs::create_dir(&parent).map_err(|error| format!("Its folder couldn't be made: {error}"))?;
        made.push(to_dirs[..=depth].join("/"));
      }
    }
  }
  if !fs::canonicalize(&parent).is_ok_and(|real| real.starts_with(root)) {
    return Err(NOT_INSIDE.to_string());
  }
  // `rename` replaces whatever is at the target, so look once more.
  if taken(&target) {
    return Err(TAKEN.to_string());
  }
  fs::rename(&source, &target).map_err(|error| describe(&error))
}

/// Removes the folders in `dirs` that hold nothing, the deepest first.
/// `remove_dir` fails on a folder with anything in it, which is the safety.
fn remove_if_empty<'a>(folder: &Path, dirs: impl IntoIterator<Item = &'a str>) -> Vec<String> {
  let mut dirs: Vec<Vec<&str>> = dirs.into_iter().filter_map(parts).collect();
  dirs.sort();
  dirs.dedup();
  dirs.sort_by_key(|dir| std::cmp::Reverse(dir.len()));
  let mut removed = Vec::new();
  for dir in dirs {
    let path = join(folder, &dir);
    // A real folder only: removing a link takes the link away, full or not.
    let real = fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_dir());
    if real && fs::remove_dir(&path).is_ok() {
      removed.push(dir.join("/"));
    }
  }
  removed
}

/// The folders a file was in, from the nearest to the one just inside `folder`.
fn folders_above(relative: &str) -> Vec<String> {
  let Some(parts) = parts(relative) else {
    return Vec::new();
  };
  (1..parts.len()).rev().map(|depth| parts[..depth].join("/")).collect()
}

fn staging_of(log: &Path) -> PathBuf {
  let mut staging = log.as_os_str().to_owned();
  staging.push(".part");
  PathBuf::from(staging)
}

fn read_log(log: &Path) -> Option<UndoLog> {
  serde_json::from_slice(&fs::read(log).ok()?).ok()
}

/// One move, checked from nothing: where the page says a file is and where it
/// says the file should go are both only text until this has looked.
fn checked_move(
  folder: &Path,
  root: &Path,
  item: &Move,
  in_use: &BTreeSet<PathBuf>,
  made: &mut Vec<String>
) -> Result<(), String> {
  let (Some(from), Some(to)) = (parts(&item.from), parts(&item.to)) else {
    return Err(NOT_INSIDE.to_string());
  };
  if !to.iter().all(|name| legal_name(name)) {
    return Err("That is not a name a file can have.".to_string());
  }
  if !same_kind(&item.from, &item.to) {
    return Err("Only a book file is renamed, and it keeps its kind.".to_string());
  }
  if fs::canonicalize(join(folder, &from)).is_ok_and(|real| in_use.contains(&real)) {
    return Err("Leaflet reads this book from that file, so it stays where it is.".to_string());
  }
  relocate(folder, root, &from, &to, false, made)
}

/// How many moves go by between two writings of the undo record while a run
/// is under way: a run cut short (the power, the app closed) can then be
/// undone as far as its last writing, where it used to leave no record at all.
const RECORD_EVERY: usize = 25;

/// Writes the record of a run, whole or as far as it has got, in place of the one before.
fn save_record(folder: &Path, done: &[Move], made: &[String], log: &Path) -> io::Result<()> {
  let record = UndoLog {
    folder: folder.to_string_lossy().to_string(),
    at: chrono::Utc::now().to_rfc3339(),
    moves: done.to_vec(),
    made_dirs: made.to_vec()
  };
  let staging = staging_of(log);
  let json = serde_json::to_vec(&record).map_err(io::Error::other)?;
  fs::write(&staging, json)?;
  fs::rename(&staging, log)
}

fn apply_checked(folder: &Path, moves: &[Move], in_use: &[PathBuf], log: &Path) -> Result<Applied, String> {
  let root = fs::canonicalize(folder).map_err(|_| "That folder does not exist.".to_string())?;
  let in_use: BTreeSet<PathBuf> = in_use
    .iter()
    .filter_map(|path| fs::canonicalize(path).ok())
    .filter(|path| path.starts_with(&root))
    .collect();

  // Before anything moves: a run that could not be undone is not started.
  let staging = staging_of(log);
  let no_record = |error: io::Error| format!("Leaflet couldn't keep a record for Undo, so nothing was renamed: {error}");
  if let Some(parent) = log.parent() {
    fs::create_dir_all(parent).map_err(no_record)?;
  }
  fs::write(&staging, b"").map_err(no_record)?;

  let mut done = Vec::new();
  let mut made = Vec::new();
  let mut skipped = Vec::new();
  for item in moves {
    match checked_move(folder, &root, item, &in_use, &mut made) {
      Ok(()) => {
        done.push(Move { from: item.from.replace('\\', "/"), to: item.to.replace('\\', "/") });
        if done.len() % RECORD_EVERY == 0 {
          let _ = save_record(folder, &done, &made, log);
        }
      }
      Err(reason) => skipped.push(Skipped { from: item.from.clone(), reason })
    }
  }

  // The folders the files left, where nothing else is left in them.
  let left: Vec<String> = done.iter().flat_map(|item| folders_above(&item.from)).collect();
  remove_if_empty(folder, left.iter().map(String::as_str));
  // And a folder made for a move that then did not happen.
  let unused = remove_if_empty(folder, made.iter().map(String::as_str));
  made.retain(|dir| !unused.contains(dir));

  if done.is_empty() {
    // Nothing to undo, so the record of the run before this one stays.
    let _ = fs::remove_file(&staging);
  } else {
    if let Err(error) = save_record(folder, &done, &made, log) {
      crate::diag::warn(&format!("tidy a folder: the undo record was not saved: {error}"));
      let _ = fs::remove_file(&staging);
    }
  }
  Ok(Applied { moved: done.len(), skipped })
}

/// Makes the moves, each one checked again here, and writes the record `undo`
/// works from to `log`, in place of any earlier one. `in_use` is every file
/// the library reads a book from: one of those inside the folder is not moved.
pub fn apply(folder: &Path, moves: &[Move], in_use: &[PathBuf], log: &Path) -> Result<Applied, String> {
  check_folder(folder)?;
  apply_checked(folder, moves, in_use, log)
}

/// The last run, if there is one to undo.
pub fn last(log: &Path) -> Option<Last> {
  let record = read_log(log)?;
  Some(Last { folder: record.folder, count: record.moves.len(), at: record.at })
}

/// Puts the last run back, last move first. A file goes back only if it is
/// still where the run put it and its old place is still free. Then the
/// folders the run made are removed where they are empty, and the record goes.
pub fn undo(log: &Path) -> Result<Undone, String> {
  let record = read_log(log).ok_or_else(|| "There is nothing to undo.".to_string())?;
  let folder = PathBuf::from(&record.folder);
  // The record is kept: the drive may only be unplugged.
  let root = fs::canonicalize(&folder)
    .map_err(|_| "The folder can't be found. If it is on a removable drive, plug it in.".to_string())?;

  let mut restored = 0;
  let mut skipped = Vec::new();
  // The folders the run emptied and removed, made again for their files.
  let mut remade = Vec::new();
  for item in record.moves.iter().rev() {
    let result = match (parts(&item.to), parts(&item.from)) {
      (Some(now), Some(before)) => relocate(&folder, &root, &now, &before, true, &mut remade),
      _ => Err(NOT_INSIDE.to_string())
    };
    match result {
      Ok(()) => restored += 1,
      Err(reason) => skipped.push(Skipped { from: item.from.clone(), reason })
    }
  }
  remove_if_empty(&folder, record.made_dirs.iter().chain(&remade).map(String::as_str));
  let _ = fs::remove_file(log);
  Ok(Undone { restored, skipped })
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A folder of books for one test, and somewhere for its undo record,
  /// removed afterwards even if the test fails.
  struct Scratch {
    path: PathBuf
  }

  impl Scratch {
    fn new(name: &str) -> Self {
      let path = std::env::temp_dir().join(format!("leaflet-tidy-{name}-{}", std::process::id()));
      let _ = fs::remove_dir_all(&path);
      fs::create_dir_all(path.join("books")).expect("books dir");
      Self { path }
    }

    fn books(&self) -> PathBuf {
      self.path.join("books")
    }

    fn log(&self) -> PathBuf {
      self.path.join("data").join("tidy-undo.json")
    }

    fn put(&self, relative: &str, bytes: &[u8]) -> PathBuf {
      let path = self.books().join(relative);
      fs::create_dir_all(path.parent().expect("parent")).expect("folders");
      fs::write(&path, bytes).expect("write");
      path
    }

    fn read(&self, relative: &str) -> Option<Vec<u8>> {
      fs::read(self.books().join(relative)).ok()
    }

    /// Everything under the folder, files and folders (those with a `/` after).
    fn tree(&self) -> Vec<String> {
      fn list(dir: &Path, prefix: &str, out: &mut Vec<String>) {
        for entry in fs::read_dir(dir).expect("read").flatten() {
          let name = format!("{prefix}{}", entry.file_name().to_string_lossy());
          if entry.path().is_dir() {
            out.push(format!("{name}/"));
            list(&entry.path(), &format!("{name}/"), out);
          } else {
            out.push(name);
          }
        }
      }
      let mut out = Vec::new();
      list(&self.books(), "", &mut out);
      out.sort();
      out
    }

    fn apply(&self, moves: &[(&str, &str)]) -> Applied {
      apply_checked(&self.books(), &moves_of(moves), &[], &self.log()).expect("apply")
    }
  }

  impl Drop for Scratch {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.path);
    }
  }

  fn moves_of(moves: &[(&str, &str)]) -> Vec<Move> {
    moves.iter().map(|(from, to)| Move { from: from.to_string(), to: to.to_string() }).collect()
  }

  #[test]
  fn files_are_moved_and_their_folders_made() {
    let scratch = Scratch::new("apply");
    scratch.put("Dune (Frank Herbert) (z-library.sk, 1lib.sk).epub", b"dune");
    scratch.put("downloads/expanse 1.epub", b"leviathan");
    scratch.put("downloads/notes.txt", b"not asked about");

    let done = scratch.apply(&[
      ("Dune (Frank Herbert) (z-library.sk, 1lib.sk).epub", "Frank Herbert/Dune.epub"),
      // The page may use either slash.
      ("downloads\\expanse 1.epub", "James S. A. Corey\\The Expanse\\01 - Leviathan Wakes.epub")
    ]);

    assert_eq!(done, Applied { moved: 2, skipped: Vec::new() });
    assert_eq!(
      scratch.tree(),
      vec![
        "Frank Herbert/",
        "Frank Herbert/Dune.epub",
        "James S. A. Corey/",
        "James S. A. Corey/The Expanse/",
        "James S. A. Corey/The Expanse/01 - Leviathan Wakes.epub",
        "downloads/",
        "downloads/notes.txt"
      ]
    );
    assert_eq!(scratch.read("Frank Herbert/Dune.epub").as_deref(), Some(b"dune".as_slice()));
    assert!(!staging_of(&scratch.log()).exists(), "no staging file is left behind");
  }

  #[test]
  fn a_file_is_never_written_over() {
    let scratch = Scratch::new("overwrite");
    scratch.put("a.epub", b"first");
    scratch.put("b.epub", b"second");
    scratch.put("Author/Title.epub", b"already here");

    let done = scratch.apply(&[("a.epub", "Author/Title.epub"), ("b.epub", "a.epub")]);

    assert_eq!(done.moved, 0);
    assert_eq!(done.skipped.len(), 2);
    assert!(done.skipped.iter().all(|skip| skip.reason == TAKEN), "{:?}", done.skipped);
    assert_eq!(scratch.read("a.epub").as_deref(), Some(b"first".as_slice()));
    assert_eq!(scratch.read("b.epub").as_deref(), Some(b"second".as_slice()));
    assert_eq!(scratch.read("Author/Title.epub").as_deref(), Some(b"already here".as_slice()));
    // Two moves to one name in the same run: the second finds it taken.
    let done = scratch.apply(&[("a.epub", "New/Same.epub"), ("b.epub", "New/Same.epub")]);
    assert_eq!((done.moved, done.skipped.len()), (1, 1));
    assert_eq!(scratch.read("New/Same.epub").as_deref(), Some(b"first".as_slice()));
    assert_eq!(scratch.read("b.epub").as_deref(), Some(b"second".as_slice()));
  }

  #[test]
  fn a_path_that_is_not_plainly_inside_the_folder_is_refused() {
    let scratch = Scratch::new("escape");
    scratch.put("a.epub", b"inside");
    fs::write(scratch.path.join("outside.epub"), b"outside").expect("outside");
    let elsewhere = scratch.path.join("elsewhere.epub").to_string_lossy().to_string();
    let outside = scratch.path.join("outside.epub").to_string_lossy().to_string();

    let refused = [
      ("a.epub", "../escaped.epub"),
      ("a.epub", "Author/../../escaped.epub"),
      ("a.epub", "..\\escaped.epub"),
      ("a.epub", "./a2.epub"),
      ("a.epub", elsewhere.as_str()),
      ("a.epub", "/rooted.epub"),
      ("a.epub", "\\rooted.epub"),
      ("a.epub", "\\\\server\\share\\a.epub"),
      ("a.epub", "C:/escaped.epub"),
      ("a.epub", "C:escaped.epub"),
      ("a.epub", "Author//a.epub"),
      ("a.epub", "Author/"),
      ("a.epub", ""),
      ("../outside.epub", "Author/Stolen.epub"),
      (outside.as_str(), "Author/Stolen.epub"),
      ("", "Author/Nothing.epub")
    ];
    let done = scratch.apply(&refused);

    assert_eq!(done.moved, 0);
    assert_eq!(done.skipped.len(), refused.len());
    assert_eq!(scratch.tree(), vec!["a.epub"], "nothing was moved and no folder was made");
    assert_eq!(fs::read(scratch.path.join("outside.epub")).expect("outside"), b"outside");
    assert!(!scratch.path.join("escaped.epub").exists());
    assert!(!scratch.path.join("elsewhere.epub").exists());
    assert!(!scratch.log().exists(), "a run that moved nothing leaves nothing to undo");
  }

  #[test]
  fn a_name_windows_would_not_keep_is_refused() {
    let scratch = Scratch::new("illegal");
    scratch.put("a.epub", b"a book");

    let refused = [
      "What?.epub",
      "Dune: Messiah.epub",
      "Either|Or.epub",
      "a<b>.epub",
      "say \"hi\".epub",
      "star*.epub",
      "tab\there.epub",
      "CON.epub",
      "nul.epub",
      "Author/COM1/a.epub",
      "LPT9/a.epub",
      "Author /a.epub",
      "Author./a.epub",
      " Author/a.epub",
      ".hidden/a.epub",
      // The kind of file is not the page's to change.
      "Author/a.exe",
      "Author/a.pdf",
      "Author/a",
      "Author/a.epub."
    ];
    let moves: Vec<(&str, &str)> = refused.iter().map(|to| ("a.epub", *to)).collect();
    let done = scratch.apply(&moves);

    assert_eq!(done.moved, 0, "{:?}", scratch.tree());
    assert_eq!(done.skipped.len(), refused.len());
    assert_eq!(scratch.tree(), vec!["a.epub"]);

    // A file that is not a book is not moved, whatever it is to be called.
    scratch.put("notes.xyz", b"not a book");
    let done = scratch.apply(&[("notes.xyz", "Author/notes.xyz")]);
    assert_eq!(done.moved, 0);
    assert!(legal_name("Dune - Messiah.epub") && legal_name("03.5 - Title.epub") && legal_name("Console Wars"));
  }

  /// A folder inside the chosen one that is really a link to somewhere else
  /// is inside by its name only.
  #[test]
  fn a_link_out_of_the_folder_is_not_followed() {
    let scratch = Scratch::new("link");
    scratch.put("a.txt", b"inside");
    let away = scratch.path.join("away");
    fs::create_dir_all(&away).expect("away");
    fs::write(away.join("theirs.txt"), b"outside").expect("theirs");
    // Making a link needs a right not every Windows account has; a junction
    // needs none, and is the kind Windows itself makes.
    let mut links = Vec::new();
    #[cfg(windows)]
    {
      if std::os::windows::fs::symlink_dir(&away, scratch.books().join("link")).is_ok() {
        links.push("link");
      }
      let junction = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(scratch.books().join("junction"))
        .arg(&away)
        .output();
      if junction.is_ok_and(|output| output.status.success()) {
        links.push("junction");
      }
    }
    #[cfg(not(windows))]
    if std::os::unix::fs::symlink(&away, scratch.books().join("link")).is_ok() {
      links.push("link");
    }

    for link in &links {
      let into = format!("{link}/a.txt");
      let out_of = format!("{link}/theirs.txt");
      let done = scratch.apply(&[("a.txt", into.as_str()), (out_of.as_str(), "Author/Theirs.txt")]);
      assert_eq!(done.moved, 0, "{link}: {:?}", done.skipped);
    }

    assert_eq!(fs::read(away.join("theirs.txt")).expect("theirs"), b"outside");
    assert!(!away.join("a.txt").exists());
    assert_eq!(scratch.read("a.txt").as_deref(), Some(b"inside".as_slice()));
    // And the scan does not look through one.
    let scan = scan_checked(&scratch.books(), MAX_FILES);
    assert_eq!(scan.files.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(), vec!["a.txt"]);
  }

  /// The run's own folders are checked the same way when it is undone: a
  /// record that names a place outside the folder moves nothing.
  #[test]
  fn an_undo_record_cannot_reach_outside_the_folder() {
    let scratch = Scratch::new("undo-escape");
    scratch.put("Author/A.epub", b"inside");
    fs::write(scratch.path.join("outside.epub"), b"outside").expect("outside");
    let record = UndoLog {
      folder: scratch.books().to_string_lossy().to_string(),
      at: "2026-10-09T12:00:00+00:00".to_string(),
      moves: moves_of(&[("../escaped.epub", "Author/A.epub"), ("Back/B.epub", "../outside.epub")]),
      made_dirs: vec!["..".to_string(), "../data".to_string()]
    };
    fs::create_dir_all(scratch.log().parent().expect("data")).expect("data dir");
    fs::write(scratch.log(), serde_json::to_vec(&record).expect("json")).expect("record");

    let undone = undo(&scratch.log()).expect("undo");

    assert_eq!((undone.restored, undone.skipped.len()), (0, 2));
    assert_eq!(scratch.tree(), vec!["Author/", "Author/A.epub"]);
    assert_eq!(fs::read(scratch.path.join("outside.epub")).expect("outside"), b"outside");
    assert!(!scratch.path.join("escaped.epub").exists());
    assert!(scratch.path.join("data").is_dir(), "a folder outside is not removed, empty or not");
  }

  #[test]
  fn undo_puts_everything_back_and_removes_the_folders_it_made() {
    let scratch = Scratch::new("undo");
    scratch.put("Dune (z-library).epub", b"dune");
    scratch.put("downloads/expanse 1.epub", b"leviathan");
    scratch.put("Kept/already.epub", b"kept");
    let before = scratch.tree();

    let done = scratch.apply(&[
      ("Dune (z-library).epub", "Frank Herbert/Dune.epub"),
      ("downloads/expanse 1.epub", "James S. A. Corey/The Expanse/01 - Leviathan Wakes.epub"),
      ("Kept/already.epub", "Kept/Renamed.epub")
    ]);
    assert_eq!(done.moved, 3);
    assert!(!scratch.books().join("downloads").exists(), "the folder the run emptied is gone");
    let run = last(&scratch.log()).expect("a run to undo");
    assert_eq!((run.folder, run.count), (scratch.books().to_string_lossy().to_string(), 3));
    assert!(!run.at.is_empty());

    let undone = undo(&scratch.log()).expect("undo");

    assert_eq!(undone, Undone { restored: 3, skipped: Vec::new() });
    assert_eq!(scratch.tree(), before, "the folders made are gone and the one emptied is back");
    assert_eq!(scratch.read("downloads/expanse 1.epub").as_deref(), Some(b"leviathan".as_slice()));
    assert!(!scratch.log().exists());
    assert_eq!(last(&scratch.log()), None);
    assert!(undo(&scratch.log()).unwrap_err().contains("nothing to undo"));
  }

  /// A name too long to give a file is still the name to give it back.
  #[test]
  fn undo_puts_a_file_back_under_a_name_longer_than_windows_opens() {
    let scratch = Scratch::new("undo-long");
    let long = format!("{}.epub", "a very long name from a site ".repeat(8).trim());
    scratch.put(&long, b"book");
    assert!(scratch.books().join(&long).to_string_lossy().len() > MAX_PATH_CHARS);
    let before = scratch.tree();

    assert_eq!(scratch.apply(&[(long.as_str(), "Someone/Short.epub")]).moved, 1);
    let undone = undo(&scratch.log()).expect("undo");

    assert_eq!(undone, Undone { restored: 1, skipped: Vec::new() });
    assert_eq!(scratch.tree(), before);
  }

  #[test]
  fn undo_leaves_what_has_changed_since() {
    let scratch = Scratch::new("undo-changed");
    scratch.put("a.epub", b"first");
    scratch.put("b.epub", b"second");
    scratch.put("c.epub", b"third");
    scratch.apply(&[("a.epub", "One/A.epub"), ("b.epub", "Two/B.epub"), ("c.epub", "Three/C.epub")]);
    // Since the run: one file moved on, one old name taken, one folder added to.
    fs::rename(scratch.books().join("One/A.epub"), scratch.books().join("One/elsewhere.epub")).expect("moved on");
    scratch.put("b.epub", b"a newer file");
    scratch.put("Three/their notes.txt", b"theirs");

    let undone = undo(&scratch.log()).expect("undo");

    assert_eq!(undone.restored, 1);
    let skipped: Vec<(&str, &str)> = undone.skipped.iter().map(|skip| (skip.from.as_str(), skip.reason.as_str())).collect();
    assert_eq!(skipped, vec![("b.epub", TAKEN), ("a.epub", GONE)]);
    assert_eq!(
      scratch.tree(),
      vec!["One/", "One/elsewhere.epub", "Three/", "Three/their notes.txt", "Two/", "Two/B.epub", "b.epub", "c.epub"]
    );
    assert_eq!(scratch.read("b.epub").as_deref(), Some(b"a newer file".as_slice()));
    assert_eq!(scratch.read("Two/B.epub").as_deref(), Some(b"second".as_slice()));
  }

  #[test]
  fn a_run_that_moves_nothing_keeps_the_earlier_undo() {
    let scratch = Scratch::new("undo-kept");
    scratch.put("a.epub", b"first");
    scratch.apply(&[("a.epub", "One/A.epub")]);

    let done = scratch.apply(&[("gone.epub", "Two/Gone.epub")]);

    assert_eq!((done.moved, done.skipped.len()), (0, 1));
    assert_eq!(done.skipped[0].reason, GONE);
    assert_eq!(last(&scratch.log()).map(|last| last.count), Some(1));
    assert!(!scratch.books().join("Two").exists(), "a folder made for nothing is not left");

    // A later run that does move something replaces it.
    scratch.put("b.epub", b"second");
    scratch.put("c.epub", b"third");
    scratch.apply(&[("b.epub", "Two/B.epub"), ("c.epub", "Two/C.epub")]);
    assert_eq!(last(&scratch.log()).map(|last| last.count), Some(2));
    undo(&scratch.log()).expect("undo");
    assert_eq!(scratch.tree(), vec!["One/", "One/A.epub", "b.epub", "c.epub"]);
  }

  /// Windows and macOS take `dune.epub` and `Dune.epub` for one file, so the
  /// name is "taken" by the very file being renamed.
  #[test]
  fn a_rename_that_only_changes_case_works() {
    let scratch = Scratch::new("case");
    scratch.put("Frank Herbert/dune.EPUB", b"dune");

    let done = scratch.apply(&[("Frank Herbert/dune.EPUB", "Frank Herbert/Dune.epub")]);

    assert_eq!(done, Applied { moved: 1, skipped: Vec::new() });
    assert_eq!(scratch.tree(), vec!["Frank Herbert/", "Frank Herbert/Dune.epub"]);
    assert_eq!(scratch.read("Frank Herbert/Dune.epub").as_deref(), Some(b"dune".as_slice()));

    undo(&scratch.log()).expect("undo");
    assert_eq!(scratch.tree(), vec!["Frank Herbert/", "Frank Herbert/dune.EPUB"]);
  }

  #[test]
  fn an_emptied_folder_is_removed_and_one_with_anything_left_is_kept() {
    let scratch = Scratch::new("emptied");
    scratch.put("old/deep/deeper/a.epub", b"first");
    scratch.put("mixed/b.epub", b"second");
    scratch.put("mixed/cover.jpg", b"a picture");
    scratch.put("mixed/inner/c.epub", b"third");
    fs::create_dir_all(scratch.books().join("empty before")).expect("their empty folder");

    let done = scratch.apply(&[
      ("old/deep/deeper/a.epub", "Author/A.epub"),
      ("mixed/b.epub", "Author/B.epub"),
      ("mixed/inner/c.epub", "Author/C.epub")
    ]);

    assert_eq!(done.moved, 3);
    assert_eq!(
      scratch.tree(),
      vec!["Author/", "Author/A.epub", "Author/B.epub", "Author/C.epub", "empty before/", "mixed/", "mixed/cover.jpg"],
      "every folder the files left empty is gone, up to the chosen one; the rest are as they were"
    );
    assert_eq!(scratch.read("mixed/cover.jpg").as_deref(), Some(b"a picture".as_slice()));
    assert!(scratch.books().is_dir());
  }

  #[test]
  fn a_file_the_library_reads_from_is_not_moved() {
    let scratch = Scratch::new("in-use");
    let read_in_place = scratch.put("a.epub", b"the library opens this one");
    scratch.put("b.epub", b"second");
    let moves = moves_of(&[("a.epub", "Author/A.epub"), ("b.epub", "Author/B.epub")]);
    // As the library stores paths: its own copy somewhere else, a book with
    // no file yet, and this one.
    let in_use = vec![scratch.path.join("library").join("abc.epub"), PathBuf::new(), read_in_place];

    let done = apply_checked(&scratch.books(), &moves, &in_use, &scratch.log()).expect("apply");

    assert_eq!(done.moved, 1);
    assert_eq!(done.skipped.len(), 1);
    assert!(done.skipped[0].reason.contains("Leaflet reads this book"), "{:?}", done.skipped);
    assert_eq!(scratch.tree(), vec!["Author/", "Author/B.epub", "a.epub"]);
  }

  #[test]
  fn a_path_too_long_for_windows_to_open_is_not_made() {
    let scratch = Scratch::new("long");
    scratch.put("a.epub", b"a book");
    let long = format!("{}/{}.epub", "A".repeat(120), "T".repeat(140));

    let done = scratch.apply(&[("a.epub", long.as_str())]);

    if cfg!(windows) {
      assert_eq!(done.moved, 0);
      assert!(done.skipped[0].reason.contains("too long"), "{:?}", done.skipped);
      assert_eq!(scratch.tree(), vec!["a.epub"]);
    } else {
      assert_eq!(done.moved, 1);
    }
  }

  #[test]
  fn folders_that_are_not_folders_of_books_are_refused() {
    let scratch = Scratch::new("refused");
    let file = scratch.put("a.epub", b"a book");
    let moves = moves_of(&[("a.epub", "Author/A.epub")]);
    let refused = |folder: &Path| {
      let checked = check_folder(folder).expect_err("refused");
      // Refused by the same door whichever way it is come to.
      assert_eq!(scan(folder).expect_err("scan"), checked);
      assert_eq!(apply(folder, &moves, &[], &scratch.log()).expect_err("apply"), checked);
      checked
    };

    assert!(refused(&scratch.path.join("nowhere")).contains("does not exist"));
    assert!(refused(&file).contains("does not exist"), "a file is not a folder");
    // Where the temp folder is under AppData (Windows), that is a refusal too.
    let result = check_folder(&scratch.books());
    if cfg!(windows) && dirs::data_local_dir().is_some_and(|local| overlap(&scratch.books(), &local)) {
      assert!(result.unwrap_err().contains("AppData"));
      assert!(refused(&scratch.books()).contains("AppData"));
    } else {
      assert_eq!(result, Ok(()));
    }
    assert_eq!(scratch.tree(), vec!["a.epub"], "a refusal moves nothing");
    assert!(!scratch.log().exists());
  }

  /// From the paths alone, so no test looks at a real drive or home folder.
  #[test]
  fn a_drive_a_home_folder_and_leaflets_own_are_too_wide() {
    let (drive, home, own, books) = if cfg!(windows) {
      ("C:\\", "C:\\Users\\reader", "C:\\Users\\reader\\AppData\\Roaming\\leaflet", "D:\\Books")
    } else {
      ("/", "/home/reader", "/home/reader/.local/share/leaflet", "/media/books")
    };
    let asked = |folder: &str| too_wide(Path::new(folder), Some(Path::new(home)), Some(Path::new(own)));
    let above_home = Path::new(home).parent().expect("above home").to_string_lossy().to_string();

    assert!(asked(drive).is_some_and(|reason| reason.contains("whole drive")));
    assert!(asked(home).is_some_and(|reason| reason.contains("everything of yours")));
    assert!(asked(&above_home).is_some_and(|reason| reason.contains("everything of yours")));
    assert_eq!(asked(books), None);
    assert_eq!(asked(&format!("{home}{}Books", std::path::MAIN_SEPARATOR)), None, "a folder in the home folder is fine");
    // A library kept somewhere other than under the home folder.
    let elsewhere = Path::new(books).join("leaflet");
    assert!(too_wide(Path::new(books), None, Some(&elsewhere)).is_some_and(|reason| reason.contains("own library")));
    if cfg!(windows) {
      // As `canonicalize` spells them. A share on a network drive is a folder.
      assert!(too_wide(Path::new("\\\\?\\D:\\"), None, None).is_some());
      assert_eq!(too_wide(Path::new("\\\\?\\UNC\\nas\\books"), None, None), None);
      assert_eq!(too_wide(Path::new("\\\\?\\D:\\Books"), None, None), None);
    }
  }

  #[test]
  fn two_folders_overlap_when_one_is_inside_the_other() {
    let scratch = Scratch::new("overlap");
    scratch.put("inner/a.epub", b"a book");
    fs::create_dir_all(scratch.path.join("beside")).expect("beside");

    assert!(overlap(&scratch.books(), &scratch.books()));
    assert!(overlap(&scratch.books(), &scratch.books().join("inner")));
    assert!(overlap(&scratch.books().join("inner"), &scratch.books()));
    assert!(!overlap(&scratch.books(), &scratch.path.join("beside")));
    assert!(!overlap(&scratch.books(), &scratch.path.join("nowhere")));
  }

  #[test]
  fn a_scan_finds_the_book_files_and_reads_nothing_else() {
    let scratch = Scratch::new("scan");
    let dune = scratch.put("Dune (Frank Herbert) (z-library.sk, 1lib.sk).txt", b"the whole book");
    scratch.put("sub/deeper/Emma - Jane Austen.TXT", b"another book entirely");
    scratch.put("sub/copy of dune.txt", b"the whole book");
    scratch.put("sub/cover.jpg", b"a picture");
    scratch.put("sub/notes.xyz", b"not a book");
    scratch.put(".hidden/secret.txt", b"in a dot folder");
    scratch.put(".dotfile.txt", b"a dot file");
    scratch.put("sub/unfinished download.txt", b"");
    scratch.put("sub/sign-in page.epub", b"<!DOCTYPE html><html><body>Please sign in</body></html>");
    #[cfg(windows)]
    {
      let hidden = scratch.put("hidden by windows.txt", b"hidden");
      let status = std::process::Command::new("attrib").arg("+h").arg(&hidden).status();
      assert!(status.is_ok_and(|status| status.success()), "attrib +h");
    }
    let before = scratch.tree();

    let scan = scan_checked(&scratch.books(), MAX_FILES);

    let paths: Vec<&str> = scan.files.iter().map(|file| file.path.as_str()).collect();
    assert_eq!(
      paths,
      vec!["Dune (Frank Herbert) (z-library.sk, 1lib.sk).txt", "sub/copy of dune.txt", "sub/deeper/Emma - Jane Austen.TXT"]
    );
    let first = &scan.files[0];
    assert_eq!(first.hash, crate::storage::hash_file(&dune).expect("hash"));
    assert_eq!(first.hash, scan.files[1].hash, "the same bytes under another name");
    assert_eq!((first.size, first.extension.as_str(), first.book_id.as_deref()), (14, "txt", None));
    assert_eq!((first.title.as_str(), first.author.as_deref()), ("Dune", Some("Frank Herbert")));
    assert_eq!(scan.files[2].extension, "txt");
    let left: Vec<&str> = scan.left_alone.iter().map(|file| file.path.as_str()).collect();
    assert_eq!(left, vec!["sub/sign-in page.epub", "sub/unfinished download.txt"]);
    assert!(scan.left_alone[1].reason.contains("empty"), "{:?}", scan.left_alone);
    assert!(!scan.capped);
    assert_eq!(scan.folder, scratch.books().to_string_lossy());
    assert_eq!(scratch.tree(), before, "a scan changes nothing");
  }

  #[test]
  fn a_scan_stops_at_a_depth_and_at_a_count() {
    let scratch = Scratch::new("scan-caps");
    let mut folder = String::new();
    for level in 0..=MAX_DEPTH + 2 {
      scratch.put(&format!("{folder}book {level:02}.txt"), format!("book {level}").as_bytes());
      folder.push_str(&format!("level {level:02}/"));
    }

    let scan = scan_checked(&scratch.books(), MAX_FILES);
    assert_eq!(scan.files.len(), MAX_DEPTH + 1, "the chosen folder and {MAX_DEPTH} below it");
    assert!(!scan.capped);
    assert!(scan.files.iter().all(|file| !file.path.contains('\\')));

    let scan = scan_checked(&scratch.books(), 3);
    assert_eq!(scan.files.len(), 3);
    assert!(scan.capped);
  }
}

/// What tidying a real folder of books comes to, on a copy of it: numbers
/// only, never a title. The folder itself is only read.
///
/// In three steps, with the planner (TypeScript) between the two here:
/// `LEAFLET_TIDY_PROBE=scan cargo test --lib storage::tidy::probe -- --ignored --nocapture`,
/// `LEAFLET_TIDY_PROBE=1 npx vitest run src/library/tidyProbe.test.ts`, then
/// the first again with `LEAFLET_TIDY_PROBE=apply`.
#[cfg(test)]
mod probe {
  use super::*;
  use std::collections::BTreeMap;

  fn hashes(folder: &Path) -> BTreeMap<String, String> {
    scan_checked(folder, MAX_FILES).files.into_iter().map(|file| (file.path, file.hash)).collect()
  }

  #[test]
  #[ignore = "copies the books in D:\\Books to a temporary folder and tidies the copy; run by hand"]
  fn a_real_folder_is_tidied_and_put_back() {
    let step = std::env::var("LEAFLET_TIDY_PROBE").unwrap_or_default();
    let scratch = std::env::temp_dir().join("leaflet-tidy-probe");
    let books = scratch.join("books");
    let log = scratch.join("tidy-undo.json");
    match step.as_str() {
      "scan" => {
        let Ok(entries) = fs::read_dir("D:\\Books") else {
          eprintln!("no library here: nothing to look at");
          return;
        };
        let _ = fs::remove_dir_all(&scratch);
        fs::create_dir_all(&books).expect("scratch");
        for entry in entries.flatten().filter(|entry| entry.path().is_file()) {
          fs::copy(entry.path(), books.join(entry.file_name())).expect("copy");
        }
        let started = std::time::Instant::now();
        let found = scan_checked(&books, MAX_FILES);
        println!(
          "{} files read in {:?}, {} left alone; {} name an author, {} a series",
          found.files.len(),
          started.elapsed(),
          found.left_alone.len(),
          found.files.iter().filter(|file| file.author.is_some()).count(),
          found.files.iter().filter(|file| file.series.is_some()).count()
        );
        fs::write(scratch.join("scan.json"), serde_json::to_vec(&found).expect("json")).expect("scan.json");
      }
      "apply" => {
        let moves: Vec<Move> = serde_json::from_slice(&fs::read(scratch.join("moves.json")).expect("moves.json: run the planner first")).expect("moves");
        let before = hashes(&books);
        let applied = apply_checked(&books, &moves, &[], &log).expect("apply");
        let after = hashes(&books);
        let mut depth = BTreeMap::new();
        for path in after.keys() {
          *depth.entry(path.matches('/').count()).or_insert(0usize) += 1;
        }
        println!("{} asked for, {} moved, {} skipped; files by how many folders deep: {depth:?}", moves.len(), applied.moved, applied.skipped.len());
        for skipped in &applied.skipped {
          println!("  skipped: {}", skipped.reason);
        }
        let same_books = |a: &BTreeMap<String, String>, b: &BTreeMap<String, String>| {
          let (mut a, mut b): (Vec<_>, Vec<_>) = (a.values().collect(), b.values().collect());
          a.sort();
          b.sort();
          a == b
        };
        assert!(same_books(&before, &after), "every book is still there, byte for byte");
        let longest = after.keys().map(|path| books.join(path).to_string_lossy().encode_utf16().count()).max().unwrap_or(0);
        println!("longest path {longest} characters");
        let undone = undo(&log).expect("undo");
        println!("{} put back, {} not", undone.restored, undone.skipped.len());
        for skipped in &undone.skipped {
          println!("  not put back: {} (a name of {} characters)", skipped.reason, skipped.from.chars().count());
        }
        assert_eq!(hashes(&books), before, "undo leaves the folder as it was");
        let _ = fs::remove_dir_all(&scratch);
      }
      _ => eprintln!("set LEAFLET_TIDY_PROBE to scan or apply")
    }
  }
}
