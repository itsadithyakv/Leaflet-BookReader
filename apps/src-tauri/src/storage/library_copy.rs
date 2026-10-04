//! A second copy of each book, in a folder the reader chose.
//!
//! The library already keeps its own copy of every book it imports, under
//! `books/<sha256>.<ext>` in the app's data folder, so reading never depends on
//! the file the book came from. Those names mean nothing to a person, and the
//! folder goes when Leaflet is uninstalled. This is the copy for the reader:
//! the original file, named `Title - Author.ext`, somewhere they can see it.
//!
//! Optional and off by default. Nothing here is allowed to get in the way of
//! importing or reading: every failure comes back as a `CopyError` for
//! Settings to show, never as a panic or a blocked import.

use super::hash_file;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Longest name, without the extension. Windows allows 255, but a path is also
/// capped as a whole (260 for Explorer and many apps), and the folder is the
/// reader's to nest as deep as they like.
const MAX_STEM_CHARS: usize = 120;
/// Other systems count bytes (255), and a title in Chinese or Hindi is three
/// bytes a character.
const MAX_STEM_BYTES: usize = 200;
/// How much of a long name the author may take, so the title is what survives.
const MAX_AUTHOR_CHARS: usize = 40;
/// `Title (2).epub`, `Title (3).epub`, ... for different books that share a
/// name. Past this, something other than a name clash is wrong.
const MAX_NAME_ATTEMPTS: usize = 200;
/// The longest whole path Explorer and most Windows apps will open.
const MAX_PATH_CHARS: usize = 259;
/// However deep the folder is, the name keeps this much of the title.
const MIN_STEM_CHARS: usize = 24;

/// Why a book was not copied. The text is shown to the reader as it is.
#[derive(Debug, Clone, PartialEq)]
pub enum CopyError {
  /// The folder is not there: deleted, renamed, or on a drive that is unplugged.
  FolderMissing,
  /// The library has the book's entry but not its file (not downloaded yet).
  NotOnThisDevice,
  /// Windows or the disk refused, in the reader's words where we have them.
  Failed(String)
}

impl std::fmt::Display for CopyError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      Self::FolderMissing => write!(f, "The folder can't be found. If it is on a removable drive, plug it in."),
      Self::NotOnThisDevice => write!(f, "This book hasn't been downloaded to this computer yet."),
      Self::Failed(reason) => write!(f, "{reason}")
    }
  }
}

impl CopyError {
  fn from_io(error: &io::Error) -> Self {
    match error.kind() {
      io::ErrorKind::NotFound => Self::FolderMissing,
      io::ErrorKind::PermissionDenied => {
        Self::Failed("Leaflet isn't allowed to save files in that folder.".to_string())
      }
      io::ErrorKind::StorageFull => Self::Failed("That drive is full.".to_string()),
      _ => Self::Failed(format!("The copy didn't finish: {error}"))
    }
  }
}

/// What happened to one book.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
  /// A new file was written.
  Copied(PathBuf),
  /// The folder already holds this exact book; nothing was written.
  AlreadyThere(PathBuf)
}

impl Outcome {
  pub fn path(&self) -> &Path {
    match self {
      Self::Copied(path) | Self::AlreadyThere(path) => path
    }
  }

  /// The file's name within the folder, for the index of what is where.
  pub fn file_name(&self) -> Option<String> {
    self.path().file_name().and_then(|name| name.to_str()).map(str::to_string)
  }
}

/// Names Windows keeps for devices. `CON.epub` is as reserved as `CON`: only
/// the part before the first dot counts.
fn is_reserved_name(stem: &str) -> bool {
  let base = stem.split('.').next().unwrap_or("").trim().to_ascii_uppercase();
  match base.as_str() {
    "CON" | "PRN" | "AUX" | "NUL" => true,
    other => {
      (other.starts_with("COM") || other.starts_with("LPT"))
        && other.len() == 4
        && other.as_bytes()[3].is_ascii_digit()
        && other.as_bytes()[3] != b'0'
    }
  }
}

/// One part of a name (a title, an author) with everything a filesystem would
/// refuse taken out, still reading like the original.
fn clean(part: &str) -> String {
  let mut out = String::with_capacity(part.len());
  for character in part.chars() {
    match character {
      // "Dune: Messiah" reads best as "Dune - Messiah".
      ':' => out.push_str(" - "),
      '/' | '\\' | '|' => out.push('-'),
      '"' => out.push('\''),
      '<' | '>' | '?' | '*' => {}
      c if c.is_control() => out.push(' '),
      c => out.push(c)
    }
  }
  let collapsed = out.split_whitespace().collect::<Vec<_>>().join(" ");
  // Windows drops trailing dots and spaces without saying so, which would make
  // the name we remember differ from the name on disk. A leading dot hides the
  // file on other systems.
  collapsed.trim_matches(|c: char| c == '.' || c == ' ').to_string()
}

/// Characters are counted the way Windows counts a name's length (an emoji is
/// two), and always cut between characters, never inside one.
fn truncate(value: &str, max_chars: usize, max_bytes: usize) -> String {
  let mut out = String::new();
  let mut count = 0;
  for character in value.chars() {
    count += character.len_utf16();
    if count > max_chars || out.len() + character.len_utf8() > max_bytes {
      break;
    }
    out.push(character);
  }
  out.trim_end_matches(|c: char| c == '.' || c == ' ' || c == '-').to_string()
}

/// `Title - Author`, safe to use as a file name on Windows, macOS and Linux:
/// the name a book gets in a folder of ordinary depth.
#[cfg(test)]
pub fn readable_stem(title: &str, author: Option<&str>) -> String {
  stem_within(title, author, MAX_STEM_CHARS)
}

/// `readable_stem`, in at most `max_chars`: less than usual when the folder is
/// so deep that the usual name would take the whole path past what Windows
/// apps open.
fn stem_within(title: &str, author: Option<&str>, max_chars: usize) -> String {
  let title = clean(title);
  let author = author.map(clean).filter(|value| !value.is_empty());
  let title = if title.is_empty() { "Untitled".to_string() } else { title };

  let stem = match author {
    Some(author) => {
      let author = truncate(&author, MAX_AUTHOR_CHARS.min(max_chars / 3), MAX_STEM_BYTES / 3);
      let room_chars = max_chars.saturating_sub(author.encode_utf16().count() + 3);
      let room_bytes = MAX_STEM_BYTES.saturating_sub(author.len() + 3);
      let title = truncate(&title, room_chars, room_bytes);
      // A title of nothing but dashes ("-", ":", "/") is cut to nothing here,
      // and the name used to start with a space: " - Author".
      let title = if title.is_empty() { "Untitled".to_string() } else { title };
      if author.is_empty() {
        title
      } else {
        format!("{title} - {author}")
      }
    }
    None => truncate(&title, max_chars, MAX_STEM_BYTES)
  };

  let stem = if stem.is_empty() { "Untitled".to_string() } else { stem };
  if is_reserved_name(&stem) {
    // The part before the first dot is what Windows reads as the device, so
    // that is the part to change: `CON_`, `Aux_. Notes`.
    match stem.split_once('.') {
      Some((base, rest)) => format!("{}_.{rest}", base.trim_end()),
      None => format!("{stem}_")
    }
  } else {
    stem
  }
}

fn extension_of(path: &Path) -> String {
  let ext = path
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or("")
    .to_lowercase();
  // Only what a file extension can be; the stored copy's is already clean.
  let ext: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).take(12).collect();
  if ext.is_empty() {
    "bin".to_string()
  } else {
    ext
  }
}

/// The `n`th name to try: the plain one first, then `(2)`, `(3)`...
fn candidate_name(stem: &str, ext: &str, attempt: usize) -> String {
  if attempt <= 1 {
    format!("{stem}.{ext}")
  } else {
    format!("{stem} ({attempt}).{ext}")
  }
}

/// True when `existing` holds exactly the book with this content hash. The
/// size is compared first, so a different book is usually told apart without
/// reading either file.
fn is_same_book(existing: &Path, source_len: u64, hash: &str) -> bool {
  let Ok(metadata) = fs::metadata(existing) else {
    return false;
  };
  metadata.is_file()
    && metadata.len() == source_len
    && hash_file(existing).map(|found| found == hash).unwrap_or(false)
}

/// How long the name may be for the whole path to stay one Windows apps can
/// open. Leaflet itself can write a longer path, but Explorer and most readers
/// cannot open what it wrote, which is the one thing these copies are for.
fn stem_room(folder: &Path, ext: &str) -> usize {
  if !cfg!(windows) {
    return MAX_STEM_CHARS;
  }
  // The folder, a separator, the name, " (200)" for a clash, a dot, the extension.
  let taken = folder.to_string_lossy().encode_utf16().count() + 1 + 6 + 1 + ext.len();
  MAX_PATH_CHARS.saturating_sub(taken).clamp(MIN_STEM_CHARS, MAX_STEM_CHARS)
}

/// The file in `folder` that already holds exactly this book, whatever it is
/// called. The names Leaflet would give it are tried first; this is for the
/// rest: a copy the reader renamed, the original they keep in this same folder
/// under its own name, a `(2)` whose plain name has since been freed.
fn find_same_book(folder: &Path, ext: &str, source_len: u64, hash: &str) -> Option<PathBuf> {
  fs::read_dir(folder)
    .ok()?
    .flatten()
    .map(|entry| entry.path())
    // The same kind of file only, which also leaves out staging files.
    .filter(|path| path.extension().is_some() && extension_of(path) == ext)
    .find(|path| is_same_book(path, source_len, hash))
}

/// A name from the index is only ever a plain file name. Anything with a path
/// in it is ignored rather than followed out of the folder.
fn plain_file_name(name: &str) -> bool {
  !name.is_empty() && Path::new(name).file_name().and_then(|value| value.to_str()) == Some(name)
}

/// Copies one book into `folder` as `Title - Author.ext`.
///
/// `source` is the library's own copy (the original bytes, named by `hash`).
/// `known_name` is the name this book was given the last time it was copied
/// here, if it was: that is what keeps a book whose title has since changed
/// from being copied a second time under the new one.
///
/// A file already in the folder is never overwritten. The same book is left
/// alone and reported as `AlreadyThere`; a different book with the same name
/// gets `(2)`.
pub fn copy_book(
  folder: &Path,
  source: &Path,
  hash: &str,
  title: &str,
  author: Option<&str>,
  known_name: Option<&str>
) -> Result<Outcome, CopyError> {
  if !folder.is_dir() {
    return Err(CopyError::FolderMissing);
  }
  let source_len = match fs::metadata(source) {
    Ok(metadata) if metadata.is_file() => metadata.len(),
    _ => return Err(CopyError::NotOnThisDevice)
  };

  if let Some(name) = known_name.filter(|name| plain_file_name(name)) {
    let remembered = folder.join(name);
    // Size only: this file was written by Leaflet from these bytes, and
    // hashing every book again would make "copy my library" slow for nothing.
    if fs::metadata(&remembered).map(|m| m.is_file() && m.len() == source_len).unwrap_or(false) {
      return Ok(Outcome::AlreadyThere(remembered));
    }
  }

  let ext = extension_of(source);
  let stem = stem_within(title, author, stem_room(folder, &ext));

  for attempt in 1..=MAX_NAME_ATTEMPTS {
    let destination = folder.join(candidate_name(&stem, &ext, attempt));
    if destination.exists() {
      if is_same_book(&destination, source_len, hash) {
        return Ok(Outcome::AlreadyThere(destination));
      }
      // Someone else's file, or a different edition: leave it and try the next name.
      continue;
    }
    // A free name is not proof the book is missing. Without this look, a
    // reader who chose the folder their books already live in got every one
    // of them a second time under Leaflet's name for it.
    if let Some(existing) = find_same_book(folder, &ext, source_len, hash) {
      return Ok(Outcome::AlreadyThere(existing));
    }
    return write_copy(source, &destination, hash).map(|()| Outcome::Copied(destination));
  }

  Err(CopyError::Failed(
    "Too many different books in that folder share this name.".to_string()
  ))
}

/// Through a staging file, like every other write in `storage`: an interrupted
/// copy must not leave half a book under a real name, where the next run would
/// see "a different file" and make a `(2)` beside it.
fn write_copy(source: &Path, destination: &Path, hash: &str) -> Result<(), CopyError> {
  let folder = destination.parent().ok_or(CopyError::FolderMissing)?;
  let staging = folder.join(format!(".leaflet-{}.part", hash.get(..16).unwrap_or(hash)));
  let _ = fs::remove_file(&staging);

  if let Err(error) = fs::copy(source, &staging) {
    let _ = fs::remove_file(&staging);
    // A missing source and a missing folder both read as "not found"; tell them apart.
    if !source.exists() {
      return Err(CopyError::NotOnThisDevice);
    }
    return Err(CopyError::from_io(&error));
  }
  // `rename` replaces whatever is at the destination, so look once more.
  if destination.exists() {
    let _ = fs::remove_file(&staging);
    return Err(CopyError::Failed("A file with that name appeared while copying.".to_string()));
  }
  if let Err(error) = fs::rename(&staging, destination) {
    let _ = fs::remove_file(&staging);
    return Err(CopyError::from_io(&error));
  }
  Ok(())
}

fn is_inside(folder: &Path, parent: &Path) -> bool {
  match (fs::canonicalize(folder), fs::canonicalize(parent)) {
    (Ok(folder), Ok(parent)) => folder.starts_with(parent),
    _ => false
  }
}

/// Whether `folder` can hold the copies, checked when the reader picks it so
/// the answer comes while they are looking at Settings, not at the next import.
pub fn check_folder(folder: &Path) -> Result<(), String> {
  if !folder.is_dir() {
    return Err("That folder does not exist.".to_string());
  }
  // Leaflet's own data folder is the one place a copy protects nothing: it is
  // removed with the app.
  if let Ok(own) = super::app_data_dir() {
    if is_inside(folder, &own) {
      return Err("That is Leaflet's own data folder. Choose somewhere else, such as Documents.".to_string());
    }
  }
  // The Store version of Leaflet runs packaged, and Windows quietly redirects
  // what a packaged app writes under AppData into the package's private
  // storage: the copies would not be where the reader looks for them, and
  // would be deleted on uninstall.
  #[cfg(windows)]
  for hidden in [dirs::data_dir(), dirs::data_local_dir()].into_iter().flatten() {
    if is_inside(folder, &hidden) {
      return Err("Windows hides what apps save under AppData. Choose a folder such as Documents.".to_string());
    }
  }
  // Try it, rather than guess from attributes: a read-only share and a folder
  // Windows protects both look writable until something is written.
  let probe = folder.join(".leaflet-write-test.part");
  match fs::write(&probe, b"") {
    Ok(()) => {
      let _ = fs::remove_file(&probe);
      Ok(())
    }
    Err(error) => Err(CopyError::from_io(&error).to_string())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A folder for one test, removed afterwards even if the test fails.
  struct Scratch {
    path: PathBuf
  }

  impl Scratch {
    fn new(name: &str) -> Self {
      let path = std::env::temp_dir().join(format!("leaflet-library-copy-{name}-{}", std::process::id()));
      let _ = fs::remove_dir_all(&path);
      fs::create_dir_all(path.join("library")).expect("library dir");
      fs::create_dir_all(path.join("copies")).expect("copies dir");
      Self { path }
    }

    fn copies(&self) -> PathBuf {
      self.path.join("copies")
    }

    /// A book in the "library": `<name>.<ext>` with these bytes, and its hash.
    fn book(&self, name: &str, bytes: &[u8]) -> (PathBuf, String) {
      let path = self.path.join("library").join(name);
      fs::write(&path, bytes).expect("write book");
      let hash = hash_file(&path).expect("hash");
      (path, hash)
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

  #[test]
  fn a_book_is_named_by_its_title_and_author() {
    assert_eq!(readable_stem("Dune", Some("Frank Herbert")), "Dune - Frank Herbert");
    assert_eq!(readable_stem("Dune", None), "Dune");
    assert_eq!(readable_stem("Dune", Some("   ")), "Dune");
    assert_eq!(readable_stem("", None), "Untitled");
    assert_eq!(readable_stem("  ...  ", Some("Someone")), "Untitled - Someone");
  }

  #[test]
  fn characters_a_filesystem_refuses_are_taken_out() {
    assert_eq!(readable_stem("Dune: Messiah", None), "Dune - Messiah");
    assert_eq!(readable_stem("Either/Or", Some("S. Kierkegaard")), "Either-Or - S. Kierkegaard");
    assert_eq!(readable_stem("What If?", None), "What If");
    assert_eq!(readable_stem("The \"Good\" Book <draft> *", None), "The 'Good' Book draft");
    assert_eq!(readable_stem("Tab\there\nand\u{0}there", None), "Tab here and there");
    assert_eq!(readable_stem("C:\\Users\\me|you", None), "C - -Users-me-you");

    for stem in [
      readable_stem("a<b>c:d\"e/f\\g|h?i*j", Some("k<l>m:n")),
      readable_stem("..\\..\\escape", None),
      readable_stem("../../escape", Some("../x"))
    ] {
      assert!(!stem.contains(['<', '>', ':', '"', '/', '\\', '|', '?', '*']), "{stem}");
      assert!(!stem.starts_with('.') && !stem.ends_with('.') && !stem.ends_with(' '), "{stem}");
    }
  }

  #[test]
  fn trailing_dots_and_spaces_never_reach_the_disk() {
    // Windows strips them silently, so the name would not be the one remembered.
    assert_eq!(readable_stem("Wait...", None), "Wait");
    assert_eq!(readable_stem("Title", Some("Jr. ")), "Title - Jr");
    assert_eq!(readable_stem(".hidden", None), "hidden");
  }

  #[test]
  fn windows_device_names_are_not_used_as_they_are() {
    for name in ["CON", "con", "Prn", "AUX", "nul", "COM1", "com9", "LPT1", "lpt9", "Aux. Notes"] {
      let stem = readable_stem(name, None);
      assert!(!is_reserved_name(&stem), "{name} became {stem}");
      assert!(stem.to_lowercase().starts_with(&name[..3].to_lowercase()), "{name} became {stem}");
    }
    assert_eq!(readable_stem("CON", None), "CON_");
    assert_eq!(readable_stem("Aux. Notes", None), "Aux_. Notes");
    // Only the device names: an ordinary title that starts like one is left alone.
    assert_eq!(readable_stem("Console Wars", None), "Console Wars");
    assert_eq!(readable_stem("COM10", None), "COM10");
    assert_eq!(readable_stem("COM0", None), "COM0");
    // With an author the name is no longer the device's.
    assert_eq!(readable_stem("Con", Some("Air")), "Con - Air");
  }

  #[test]
  fn a_long_name_is_cut_and_keeps_the_author() {
    let stem = readable_stem(&"A very long title ".repeat(40), Some("An Author"));
    assert!(stem.chars().count() <= MAX_STEM_CHARS, "{}", stem.chars().count());
    assert!(stem.ends_with(" - An Author"), "{stem}");

    let stem = readable_stem("Short", Some(&"Name ".repeat(40)));
    assert!(stem.starts_with("Short - Name"), "{stem}");
    assert!(stem.chars().count() <= MAX_STEM_CHARS);

    // Counted in bytes too: three per character here.
    let stem = readable_stem(&"書".repeat(300), Some(&"著".repeat(100)));
    assert!(stem.len() <= MAX_STEM_BYTES, "{} bytes", stem.len());
    assert!(stem.contains(" - "));
  }

  /// The bug this guards: a title that is only punctuation ("-", ":", "/") was
  /// cut to nothing after the "Untitled" check, leaving " - Author.epub".
  #[test]
  fn a_title_of_only_dashes_does_not_leave_a_name_starting_with_a_space() {
    for title in ["-", ":", "/", "--", " : / : ", "\\"] {
      assert_eq!(readable_stem(title, Some("Someone")), "Untitled - Someone", "{title:?}");
      assert_eq!(readable_stem(title, None), "Untitled", "{title:?}");
    }
    assert_eq!(readable_stem("Dune", Some("-")), "Dune");
  }

  #[test]
  fn a_long_name_is_never_cut_inside_a_character() {
    // Emoji are two of Windows' characters each and four bytes; the accents
    // are separate combining marks. Any cut inside one would not be a string.
    let stem = readable_stem(&"📚".repeat(300), Some(&"e\u{301}".repeat(100)));
    assert!(stem.encode_utf16().count() <= MAX_STEM_CHARS, "{}", stem.encode_utf16().count());
    assert!(stem.len() <= MAX_STEM_BYTES);
    assert!(stem.starts_with("📚") && stem.contains(" - e\u{301}"), "{stem}");

    let stem = readable_stem(&"שלום עולם ".repeat(60), None);
    assert!(stem.encode_utf16().count() <= MAX_STEM_CHARS && !stem.ends_with(' '));
  }

  /// The bug this guards: 120 characters of name in a deeply nested folder made
  /// a path past 260, which Leaflet can write and Explorer cannot open.
  #[test]
  fn a_deep_folder_gets_a_shorter_name_so_the_path_stays_openable() {
    let scratch = Scratch::new("deep");
    let (source, hash) = scratch.book("aaa.epub", b"the whole book");
    let mut folder = scratch.copies();
    while folder.to_string_lossy().encode_utf16().count() < 150 {
      folder = folder.join("a folder inside a folder");
    }
    fs::create_dir_all(&folder).expect("deep folder");
    let title = "A Very Long Title That Goes On ".repeat(12);

    let outcome = copy_book(&folder, &source, &hash, &title, Some("An Author"), None).expect("copy");

    let name = outcome.file_name().expect("name");
    assert!(name.starts_with("A Very Long Title") && name.ends_with(" - An Author.epub"), "{name}");
    if cfg!(windows) {
      let length = outcome.path().to_string_lossy().encode_utf16().count();
      assert!(length <= MAX_PATH_CHARS, "{length}");
    }
    // An ordinary folder keeps the full name.
    assert_eq!(stem_room(Path::new("C:\\Books"), "epub"), MAX_STEM_CHARS);
    // However deep, some of the title survives.
    assert_eq!(stem_room(Path::new(&"x".repeat(400)), "epub"), if cfg!(windows) { MIN_STEM_CHARS } else { MAX_STEM_CHARS });
  }

  /// The bug this guards: only the names Leaflet would choose were looked at,
  /// so a reader who picked the folder their books already live in got each
  /// one again as `Title - Author.epub` beside the original.
  #[test]
  fn a_book_already_in_the_folder_under_another_name_is_not_copied_again() {
    let scratch = Scratch::new("own-name");
    let folder = scratch.copies();
    let (source, hash) = scratch.book("aaa.epub", b"the whole book");
    fs::write(folder.join("dune (my scan).EPUB"), b"the whole book").expect("their copy");
    // Same size, different book, and a staging file with the same bytes: neither is it.
    fs::write(folder.join("other.epub"), b"another book!!").expect("other");
    fs::write(folder.join(".leaflet-0000.part"), b"the whole book").expect("staging");

    let outcome = copy_book(&folder, &source, &hash, "Dune", Some("Frank Herbert"), None).expect("copy");

    assert_eq!(outcome, Outcome::AlreadyThere(folder.join("dune (my scan).EPUB")));
    assert_eq!(scratch.names(), vec![".leaflet-0000.part", "dune (my scan).EPUB", "other.epub"]);
  }

  /// `Dune (2).epub` is this book and `Dune.epub` (another book) has since
  /// been deleted, with nothing remembered: the free name is not a reason to
  /// write the book a second time.
  #[test]
  fn a_numbered_copy_is_found_when_the_plain_name_has_been_freed() {
    let scratch = Scratch::new("gap");
    let folder = scratch.copies();
    let (first, first_hash) = scratch.book("aaa.epub", b"first edition");
    let (second, second_hash) = scratch.book("bbb.epub", b"second edition, revised");
    copy_book(&folder, &first, &first_hash, "Dune", None, None).expect("first");
    copy_book(&folder, &second, &second_hash, "Dune", None, None).expect("second");
    fs::remove_file(folder.join("Dune.epub")).expect("delete the first");

    let again = copy_book(&folder, &second, &second_hash, "Dune", None, None).expect("second again");

    assert_eq!(again, Outcome::AlreadyThere(folder.join("Dune (2).epub")));
    assert_eq!(scratch.names(), vec!["Dune (2).epub"]);
    // The deleted one is a different book, so it is made again, under the free name.
    let remade = copy_book(&folder, &first, &first_hash, "Dune", None, None).expect("first again");
    assert_eq!(remade, Outcome::Copied(folder.join("Dune.epub")));
  }

  /// Windows treats `Dune.epub` and `dune.EPUB` as one file.
  #[test]
  fn names_that_differ_only_by_case_are_one_file() {
    let scratch = Scratch::new("case");
    let folder = scratch.copies();
    let (first, first_hash) = scratch.book("aaa.epub", b"first edition");
    let (second, second_hash) = scratch.book("bbb.epub", b"second edition, revised");

    copy_book(&folder, &first, &first_hash, "Dune", Some("Herbert"), None).expect("first");
    let outcome = copy_book(&folder, &second, &second_hash, "DUNE", Some("herbert"), None).expect("second");

    assert_eq!(fs::read(folder.join("Dune - Herbert.epub")).expect("read"), b"first edition");
    assert_eq!(fs::read(outcome.path()).expect("read"), b"second edition, revised");
    assert_eq!(scratch.names().len(), 2);
  }

  #[test]
  fn a_book_is_copied_under_its_readable_name() {
    let scratch = Scratch::new("copy");
    let (source, hash) = scratch.book("aaa.EPUB", b"the whole book");

    let outcome = copy_book(&scratch.copies(), &source, &hash, "Dune", Some("Frank Herbert"), None).expect("copy");

    let expected = scratch.copies().join("Dune - Frank Herbert.epub");
    assert_eq!(outcome, Outcome::Copied(expected.clone()));
    assert_eq!(outcome.file_name().as_deref(), Some("Dune - Frank Herbert.epub"));
    assert_eq!(fs::read(&expected).expect("read"), b"the whole book");
    // The original stays where it was, and no staging file is left behind.
    assert!(source.exists());
    assert_eq!(scratch.names(), vec!["Dune - Frank Herbert.epub"]);
  }

  #[test]
  fn the_same_book_again_makes_no_second_copy() {
    let scratch = Scratch::new("again");
    let (source, hash) = scratch.book("aaa.epub", b"the whole book");
    let folder = scratch.copies();

    copy_book(&folder, &source, &hash, "Dune", None, None).expect("first");
    let again = copy_book(&folder, &source, &hash, "Dune", None, None).expect("second");

    assert_eq!(again, Outcome::AlreadyThere(folder.join("Dune.epub")));
    assert_eq!(scratch.names(), vec!["Dune.epub"]);
  }

  #[test]
  fn a_different_book_with_the_same_name_is_never_overwritten() {
    let scratch = Scratch::new("clash");
    let folder = scratch.copies();
    let (first, first_hash) = scratch.book("aaa.epub", b"first edition");
    let (second, second_hash) = scratch.book("bbb.epub", b"second edition, revised");
    // Same length as the first, so only the hash can tell them apart.
    let (third, third_hash) = scratch.book("ccc.epub", b"third edition");

    copy_book(&folder, &first, &first_hash, "Dune", None, None).expect("first");
    let second_outcome = copy_book(&folder, &second, &second_hash, "Dune", None, None).expect("second");
    let third_outcome = copy_book(&folder, &third, &third_hash, "Dune", None, None).expect("third");

    assert_eq!(second_outcome, Outcome::Copied(folder.join("Dune (2).epub")));
    assert_eq!(third_outcome, Outcome::Copied(folder.join("Dune (3).epub")));
    assert_eq!(fs::read(folder.join("Dune.epub")).expect("read"), b"first edition");
    assert_eq!(fs::read(folder.join("Dune (2).epub")).expect("read"), b"second edition, revised");

    // Each one, asked again, finds its own copy rather than adding a fourth.
    assert_eq!(
      copy_book(&folder, &second, &second_hash, "Dune", None, None).expect("second again"),
      Outcome::AlreadyThere(folder.join("Dune (2).epub"))
    );
    assert_eq!(
      copy_book(&folder, &third, &third_hash, "Dune", None, None).expect("third again"),
      Outcome::AlreadyThere(folder.join("Dune (3).epub"))
    );
    assert_eq!(scratch.names(), vec!["Dune (2).epub", "Dune (3).epub", "Dune.epub"]);
  }

  #[test]
  fn a_file_the_reader_put_there_is_left_alone() {
    let scratch = Scratch::new("theirs");
    let folder = scratch.copies();
    fs::write(folder.join("Dune.epub"), b"my own notes, not a book").expect("their file");
    let (source, hash) = scratch.book("aaa.epub", b"the whole book");

    let outcome = copy_book(&folder, &source, &hash, "Dune", None, None).expect("copy");

    assert_eq!(outcome, Outcome::Copied(folder.join("Dune (2).epub")));
    assert_eq!(fs::read(folder.join("Dune.epub")).expect("read"), b"my own notes, not a book");
  }

  /// The title a book was imported under is often replaced later (a file name
  /// tidied up by a metadata lookup). The remembered name stops that making a
  /// second copy of the same bytes.
  #[test]
  fn a_retitled_book_is_found_by_the_name_it_was_copied_under() {
    let scratch = Scratch::new("retitled");
    let folder = scratch.copies();
    let (source, hash) = scratch.book("aaa.epub", b"the whole book");

    let first = copy_book(&folder, &source, &hash, "dune_final_v2", None, None).expect("first");
    let name = first.file_name().expect("name");
    let again = copy_book(&folder, &source, &hash, "Dune", Some("Frank Herbert"), Some(&name)).expect("again");

    assert_eq!(again, Outcome::AlreadyThere(folder.join("dune_final_v2.epub")));
    assert_eq!(scratch.names(), vec!["dune_final_v2.epub"]);
  }

  #[test]
  fn a_remembered_copy_that_was_deleted_is_made_again() {
    let scratch = Scratch::new("deleted");
    let folder = scratch.copies();
    let (source, hash) = scratch.book("aaa.epub", b"the whole book");

    let outcome = copy_book(&folder, &source, &hash, "Dune", None, Some("Old Name.epub")).expect("copy");

    assert_eq!(outcome, Outcome::Copied(folder.join("Dune.epub")));
  }

  #[test]
  fn a_remembered_name_cannot_point_outside_the_folder() {
    let scratch = Scratch::new("escape");
    let folder = scratch.copies();
    let (source, hash) = scratch.book("aaa.epub", b"the whole book");
    // Same size as the book, one level up: it must not be taken for the copy.
    fs::write(scratch.path.join("outside.epub"), b"not the book!!").expect("outside");

    let outcome = copy_book(&folder, &source, &hash, "Dune", None, Some("../outside.epub")).expect("copy");

    assert_eq!(outcome, Outcome::Copied(folder.join("Dune.epub")));
    assert!(!plain_file_name("../outside.epub"));
    assert!(!plain_file_name("sub/inside.epub"));
    assert!(!plain_file_name(""));
    assert!(plain_file_name("Dune - Frank Herbert.epub"));
  }

  #[test]
  fn a_missing_folder_is_reported_not_created() {
    let scratch = Scratch::new("unplugged");
    let (source, hash) = scratch.book("aaa.epub", b"the whole book");
    let gone = scratch.path.join("unplugged-drive").join("Books");

    let error = copy_book(&gone, &source, &hash, "Dune", None, None).expect_err("no folder");

    assert_eq!(error, CopyError::FolderMissing);
    assert!(error.to_string().contains("can't be found"), "{error}");
    // Making it would scatter books across whatever now has that drive letter.
    assert!(!gone.exists());
  }

  #[test]
  fn a_folder_that_is_really_a_file_is_reported() {
    let scratch = Scratch::new("not-a-folder");
    let (source, hash) = scratch.book("aaa.epub", b"the whole book");
    let file = scratch.path.join("not-a-folder.txt");
    fs::write(&file, b"x").expect("file");

    assert_eq!(copy_book(&file, &source, &hash, "Dune", None, None), Err(CopyError::FolderMissing));
    assert!(check_folder(&file).is_err());
  }

  #[test]
  fn a_book_whose_file_is_not_here_is_reported() {
    let scratch = Scratch::new("no-source");
    let absent = scratch.path.join("library").join("never-downloaded.epub");

    let error = copy_book(&scratch.copies(), &absent, "abc", "Dune", None, None).expect_err("no source");

    assert_eq!(error, CopyError::NotOnThisDevice);
    assert!(scratch.names().is_empty(), "nothing is written for a book that is not here");
  }

  #[test]
  fn refusals_are_put_in_the_readers_words() {
    let denied = CopyError::from_io(&io::Error::from(io::ErrorKind::PermissionDenied));
    assert!(denied.to_string().contains("isn't allowed"), "{denied}");
    let full = CopyError::from_io(&io::Error::from(io::ErrorKind::StorageFull));
    assert!(full.to_string().contains("full"), "{full}");
    assert_eq!(CopyError::from_io(&io::Error::from(io::ErrorKind::NotFound)), CopyError::FolderMissing);
  }

  #[test]
  fn a_leftover_staging_file_does_not_stop_the_next_copy() {
    let scratch = Scratch::new("staging");
    let folder = scratch.copies();
    let (source, hash) = scratch.book("aaa.epub", b"the whole book");
    let staging = folder.join(format!(".leaflet-{}.part", &hash[..16]));
    fs::write(&staging, b"half a bo").expect("leftover");

    let outcome = copy_book(&folder, &source, &hash, "Dune", None, None).expect("copy");

    assert_eq!(fs::read(outcome.path()).expect("read"), b"the whole book");
    assert_eq!(scratch.names(), vec!["Dune.epub"]);
  }

  #[test]
  fn an_ordinary_folder_passes_the_check_and_is_left_clean() {
    let scratch = Scratch::new("check");
    // The temp folder is under AppData on Windows, which the check refuses on
    // purpose; everywhere else it is an ordinary writable folder.
    let result = check_folder(&scratch.copies());
    if cfg!(windows) && dirs::data_local_dir().is_some_and(|local| is_inside(&scratch.copies(), &local)) {
      assert!(result.unwrap_err().contains("AppData"));
    } else {
      assert_eq!(result, Ok(()));
    }
    assert!(scratch.names().is_empty(), "the write test cleans up after itself");
    assert!(check_folder(&scratch.path.join("nowhere")).unwrap_err().contains("does not exist"));
  }

  #[test]
  fn leaflets_own_data_folder_is_refused() {
    let own = crate::storage::app_data_dir().expect("data dir").join("books");
    // Only meaningful where the folder exists (a machine that has run Leaflet).
    if own.is_dir() {
      assert!(check_folder(&own).is_err());
    }
  }
}
