//! What Leaflet leaves lying about on a device, found and taken away, without
//! touching anything a reader needs.
//!
//! A library folder holds `books/` (each book's file, named by its content
//! hash or its id, and the EPUB a Kindle or other book was converted to,
//! `<hash>.epub`, which its highlights point into), `covers/` (each book's
//! cover, its thumbnail, a PDF's first page standing in for one, a cover the
//! reader chose) and the database with the copies made before each upgrade.
//! Over time a few things there stop belonging to anything:
//!
//! - files of books no longer in the library (a removal whose file was busy
//!   at the time, a library put back from a backup without them);
//! - half-written `.part` files from an import, a download, a conversion or a
//!   cover cut short by a crash or a closed app;
//! - covers of books that are gone, a chosen cover after another was chosen,
//!   a PDF's stand-in page after it found a real cover;
//! - copies of the database from before upgrades long since settled.
//!
//! Every rule here keeps a file it cannot place rather than guess: a file is
//! only taken when the library has nothing of that name, when it is older
//! than [`STALE`] (an import writes its file before its row), and when there
//! are fewer such files than ones the library does use (the same rules
//! pointed at the wrong library would otherwise empty it). Nothing in a
//! book's own name is ever removed while its row is there, the converted
//! copy included.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::db::BookRecord;

/// How old a file nobody lists must be before it goes. An import, a
/// download and a cover each write their file first and their row after, so
/// a file only just made is never taken for one left behind.
pub const STALE: Duration = Duration::from_secs(24 * 60 * 60);

/// The copies of the database made before each upgrade: the newest is kept
/// for good, the older ones for this long (an upgrade that went wrong is
/// noticed long before).
pub const OLD_BACKUP: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// A cover bigger than this is worth making smaller. Most are well under it;
/// some EPUBs carry a print-quality cover of several megabytes, which the
/// screen never shows at that size.
const COVER_SHRINK_ABOVE: usize = 400 * 1024;
/// The longest side a cover is kept at: a full-screen cover on a large phone
/// or a 4K monitor's reader banner, with room to spare.
const COVER_LONG_EDGE: u32 = 2000;
const COVER_QUALITY: u8 = 85;

/// What was taken away: how many files, how many bytes.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Swept {
  pub files: usize,
  pub bytes: u64
}

impl Swept {
  fn count(&mut self, bytes: u64) {
    self.files += 1;
    self.bytes += bytes;
  }

  pub fn add(&mut self, other: Swept) {
    self.files += other.files;
    self.bytes += other.bytes;
  }
}

/// The library as the sweep needs it, from its rows (the books not removed).
#[derive(Debug, Default)]
pub struct Live {
  /// Lowercased: each book's id and content hash, and its file's name.
  names: HashSet<String>,
  /// Lowercased: a book's hash, and the file name of the cover it shows.
  covers: HashMap<String, String>
}

impl Live {
  pub fn of(books: &[BookRecord]) -> Live {
    let mut live = Live::default();
    for book in books {
      for name in [&book.id, &book.file_hash] {
        if !name.trim().is_empty() {
          live.names.insert(name.to_lowercase());
        }
      }
      if let Some(file) = file_name(&book.local_path) {
        live.names.insert(file);
      }
      if let Some(cover) = book.cover_url.as_deref().and_then(file_name) {
        live.covers.insert(book.file_hash.to_lowercase(), cover);
      }
    }
    live
  }

  fn is_empty(&self) -> bool {
    self.names.is_empty()
  }

  /// Whether a file in `books/` belongs to a book: its own file, or the EPUB
  /// it was converted to (`<hash>.epub`).
  fn has_book_file(&self, name: &str) -> bool {
    self.names.contains(name) || self.names.contains(stem(name))
  }
}

/// A path's last part, lowercased. Paths are compared by name only: the
/// library writes them in whatever form the platform gave it.
fn file_name(path: &str) -> Option<String> {
  let name = path.rsplit(['/', '\\']).next()?.trim();
  (!name.is_empty()).then(|| name.to_lowercase())
}

/// `abc.epub` and `abc.epub.part` are both `abc`'s.
fn stem(name: &str) -> &str {
  name.split('.').next().unwrap_or(name)
}

/// When a file was last written or made, whichever is later. A copy keeps
/// the original's modified time on Windows (the made time is the copy's), and
/// on Linux and Android the change time moves with a rename.
fn touched(meta: &fs::Metadata) -> Option<SystemTime> {
  let mut newest = meta.modified().ok();
  if let Ok(made) = meta.created() {
    newest = Some(newest.map_or(made, |at| at.max(made)));
  }
  #[cfg(unix)]
  {
    use std::os::unix::fs::MetadataExt;
    let changed = SystemTime::UNIX_EPOCH + Duration::new(meta.ctime().max(0) as u64, meta.ctime_nsec().clamp(0, 999_999_999) as u32);
    newest = Some(newest.map_or(changed, |at| at.max(changed)));
  }
  newest
}

/// Whether a file has been left alone for at least `age`. One whose times
/// cannot be read is never old enough.
fn older_than(meta: &fs::Metadata, now: SystemTime, age: Duration) -> bool {
  touched(meta).is_some_and(|at| now.duration_since(at).is_ok_and(|since| since >= age))
}

/// Fewer files to take than to keep, or only a couple: the same rules run
/// against the wrong library (or a database that came up empty) would find
/// nearly everything unlisted.
fn plausible(unlisted: usize, kept: usize) -> bool {
  unlisted <= 2 || unlisted <= kept
}

fn remove(path: &Path, bytes: u64, swept: &mut Swept) {
  if fs::remove_file(path).is_ok() {
    swept.count(bytes);
  }
}

/// The files of one folder: path, name (lowercased) and what is known of it.
/// Folders and links are passed over.
fn files_in(dir: &Path) -> Vec<(PathBuf, String, fs::Metadata)> {
  let Ok(entries) = fs::read_dir(dir) else {
    return Vec::new();
  };
  entries
    .flatten()
    .filter_map(|entry| {
      let meta = fs::symlink_metadata(entry.path()).ok()?;
      meta.is_file().then(|| (entry.path(), entry.file_name().to_string_lossy().to_lowercase(), meta))
    })
    .collect()
}

/// The library folder at `dir`: its books, covers and database copies.
/// `stop` is asked before each removal (the reader opened another library).
pub fn sweep_library(dir: &Path, live: &Live, now: SystemTime, stale: Duration, stop: &dyn Fn() -> bool) -> Swept {
  let mut swept = Swept::default();
  swept.add(sweep_books(&dir.join("books"), live, now, stale, stop));
  swept.add(sweep_covers(&dir.join("covers"), live, now, stale, stop));
  swept.add(sweep_database_copies(dir, now, OLD_BACKUP, stop));
  swept
}

fn sweep_books(dir: &Path, live: &Live, now: SystemTime, stale: Duration, stop: &dyn Fn() -> bool) -> Swept {
  let mut swept = Swept::default();
  let mut unlisted = Vec::new();
  let mut kept = 0;
  for (path, name, meta) in files_in(dir) {
    if stop() {
      return swept;
    }
    if name.ends_with(".part") {
      // An import, a download from Drive or a conversion that never finished.
      if older_than(&meta, now, stale) {
        remove(&path, meta.len(), &mut swept);
      }
      continue;
    }
    if live.has_book_file(&name) || !older_than(&meta, now, stale) {
      kept += 1;
    } else {
      unlisted.push((path, meta.len()));
    }
  }
  if live.is_empty() || !plausible(unlisted.len(), kept) {
    if !unlisted.is_empty() {
      crate::diag::warn(&format!("left {} book file(s) the library does not list, beside {kept} it does", unlisted.len()));
    }
    return swept;
  }
  for (path, bytes) in unlisted {
    if stop() {
      break;
    }
    remove(&path, bytes, &mut swept);
  }
  swept
}

fn sweep_covers(dir: &Path, live: &Live, now: SystemTime, stale: Duration, stop: &dyn Fn() -> bool) -> Swept {
  let mut swept = Swept::default();
  let mut unlisted = Vec::new();
  let mut kept = 0;
  for (path, name, meta) in files_in(dir) {
    if stop() {
      return swept;
    }
    if !older_than(&meta, now, stale) {
      kept += 1;
      continue;
    }
    if name.ends_with(".part") {
      remove(&path, meta.len(), &mut swept);
      continue;
    }
    let hash = name.split('-').next().unwrap_or(&name);
    if !live.names.contains(hash) {
      unlisted.push((path, meta.len()));
      continue;
    }
    let shown = live.covers.get(hash);
    // A cover chosen and since replaced, or a PDF's first page once a real
    // cover took its place. The book's own `-cover.jpg` and its thumbnails
    // stay whatever it shows.
    let replaced = if name.contains(super::CHOSEN_COVER_MARK) {
      shown != Some(&name)
    } else if name.ends_with(super::PAGE_COVER_SUFFIX) {
      shown.is_some_and(|cover| *cover != name)
    } else {
      // The one-size thumbnail of 1.5.9 and before: the library asks for
      // the pair that took its place (`thumbs`), never for it again.
      name.ends_with(super::thumbs::LEGACY_SUFFIX)
    };
    if replaced {
      remove(&path, meta.len(), &mut swept);
    } else {
      kept += 1;
    }
  }
  if live.is_empty() || !plausible(unlisted.len(), kept) {
    return swept;
  }
  for (path, bytes) in unlisted {
    if stop() {
      break;
    }
    remove(&path, bytes, &mut swept);
  }
  swept
}

/// `library.db.bak-v<version>`, the copies made before each upgrade
/// (`db::backup_before_upgrade`). The newest stays; the others go once they
/// are `keep_for` old. A database set aside as damaged (`.broken-`) is the
/// reader's only copy of what was in it, and is never touched.
fn sweep_database_copies(dir: &Path, now: SystemTime, keep_for: Duration, stop: &dyn Fn() -> bool) -> Swept {
  let prefix = format!("{}.bak-v", crate::db::DB_FILE);
  let copies: Vec<(u64, PathBuf, fs::Metadata)> = files_in(dir)
    .into_iter()
    .filter_map(|(path, name, meta)| Some((name.strip_prefix(&prefix)?.parse::<u64>().ok()?, path, meta)))
    .collect();
  let newest = copies.iter().map(|(version, _, _)| *version).max();
  let mut swept = Swept::default();
  for (version, path, meta) in &copies {
    if stop() {
      break;
    }
    if Some(*version) != newest && older_than(meta, now, keep_for) {
      remove(path, meta.len(), &mut swept);
    }
  }
  swept
}

/// Makes the library's big covers smaller, in place: same picture, same
/// name, a fraction of the bytes. Done once per cover; one already small
/// enough is not opened.
pub fn shrink_covers(dir: &Path, live: &Live, stop: &dyn Fn() -> bool) -> Swept {
  shrink_covers_with(dir, live, COVER_SHRINK_ABOVE, COVER_LONG_EDGE, stop)
}

fn shrink_covers_with(dir: &Path, live: &Live, above: usize, long_edge: u32, stop: &dyn Fn() -> bool) -> Swept {
  let mut saved = Swept::default();
  for (path, name, meta) in files_in(dir) {
    if stop() {
      break;
    }
    // A book's cover from its file or a catalogue, or one the reader chose.
    // Thumbnails are small already; a PDF's page is drawn to size.
    let cover = name.ends_with("-cover.jpg") || name.contains(super::CHOSEN_COVER_MARK);
    let hash = name.split('-').next().unwrap_or(&name);
    if !cover || !live.names.contains(hash) || (meta.len() as usize) <= above {
      continue;
    }
    let Ok(bytes) = fs::read(&path) else {
      continue;
    };
    let Some(smaller) = fit_cover_with(&bytes, above, long_edge) else {
      continue;
    };
    let staging = path.with_extension("shrink.part");
    if fs::write(&staging, &smaller).is_err() {
      let _ = fs::remove_file(&staging);
      continue;
    }
    if fs::rename(&staging, &path).is_ok() {
      saved.count((bytes.len() - smaller.len()) as u64);
      // The same picture, smaller: its thumbnails still show it, so they are
      // kept fresh rather than made again from the new file (`thumbs::fresh`).
      keep_thumbs_fresh(dir, hash);
    } else {
      let _ = fs::remove_file(&staging);
    }
  }
  saved
}

/// Marks a book's thumbnails as made now.
fn keep_thumbs_fresh(dir: &Path, hash: &str) {
  for width in super::thumbs::WIDTHS {
    if let Ok(file) = fs::OpenOptions::new().append(true).open(super::thumbs::path_in(dir, hash, width)) {
      let _ = file.set_modified(SystemTime::now());
    }
  }
}

/// A cover's bytes made smaller, if they are big and it is worth it: no
/// longer than [`COVER_LONG_EDGE`] on its longest side, as a JPEG. `None`
/// keeps what there is (small already, see-through, or not a quarter
/// smaller made again).
pub fn fit_cover(bytes: &[u8]) -> Option<Vec<u8>> {
  fit_cover_with(bytes, COVER_SHRINK_ABOVE, COVER_LONG_EDGE)
}

fn fit_cover_with(bytes: &[u8], above: usize, long_edge: u32) -> Option<Vec<u8>> {
  if bytes.len() <= above {
    return None;
  }
  let image = image::load_from_memory(bytes).ok()?;
  // A JPEG has no see-through parts: a PNG cover that has them is kept.
  if image.color().has_alpha() {
    return None;
  }
  let image = if image.width().max(image.height()) > long_edge {
    image.resize(long_edge, long_edge, image::imageops::FilterType::CatmullRom)
  } else {
    image
  };
  let mut out = Vec::new();
  let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, COVER_QUALITY);
  image.to_rgb8().write_with_encoder(encoder).ok()?;
  (out.len() * 4 <= bytes.len() * 3).then_some(out)
}

/// The copies Android hands over for an import, kept in the app's cache
/// (`DevicePlugin.copyIn`: `picked/` for the file picker, `opened/` for "Open
/// with" and "Share to"), and files made to be shared (`shared/`). The
/// library keeps its own copy of each book, so these are only needed while
/// the import runs; they used to stay until the next pick a day later, so the
/// last batch imported took its room twice.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn sweep_import_copies(cache: &Path, now: SystemTime, age: Duration) -> Swept {
  let mut swept = Swept::default();
  for folder in ["picked", "opened", "shared"] {
    let Ok(entries) = fs::read_dir(cache.join(folder)) else {
      continue;
    };
    for entry in entries.flatten() {
      let path = entry.path();
      let Ok(meta) = fs::symlink_metadata(&path) else {
        continue;
      };
      if !older_than(&meta, now, age) {
        continue;
      }
      let bytes = disk_usage(&path);
      let gone = if meta.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
      if gone.is_ok() {
        swept.count(bytes);
      }
    }
  }
  swept
}

/// The bytes under `path`, without following links (a phone's app folder
/// links to the installed app's libraries).
pub fn disk_usage(path: &Path) -> u64 {
  let mut total = 0;
  let mut pending = vec![path.to_path_buf()];
  while let Some(next) = pending.pop() {
    let Ok(meta) = fs::symlink_metadata(&next) else {
      continue;
    };
    if meta.is_file() {
      total += meta.len();
    } else if meta.is_dir() {
      if let Ok(entries) = fs::read_dir(&next) {
        pending.extend(entries.flatten().map(|entry| entry.path()));
      }
    }
  }
  total
}

#[cfg(test)]
mod tests {
  use super::*;

  const DAY: Duration = Duration::from_secs(24 * 60 * 60);
  const A: &str = "aaaa1111";
  const B: &str = "bbbb2222";
  const GONE: &str = "dead0000";

  struct Scratch(PathBuf);

  impl Scratch {
    fn new(name: &str) -> Scratch {
      let path = std::env::temp_dir().join(format!("leaflet-sweep-{name}-{}", std::process::id()));
      let _ = fs::remove_dir_all(&path);
      fs::create_dir_all(path.join("books")).expect("books");
      fs::create_dir_all(path.join("covers")).expect("covers");
      Scratch(path)
    }

    fn put(&self, at: &str, bytes: &[u8]) -> PathBuf {
      let path = self.0.join(at);
      fs::write(&path, bytes).expect("write");
      path
    }

    fn has(&self, at: &str) -> bool {
      self.0.join(at).exists()
    }
  }

  impl Drop for Scratch {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  fn book(hash: &str, file: &str, cover: Option<&str>) -> BookRecord {
    BookRecord {
      id: hash.to_string(),
      title: hash.to_string(),
      author: None,
      genres: Vec::new(),
      cover_url: cover.map(str::to_string),
      local_path: file.to_string(),
      file_hash: hash.to_string(),
      progress: 0.0,
      last_opened: None,
      created_at: "2026-10-01T00:00:00Z".to_string(),
      metadata_checked_at: None,
      metadata_updated_at: None,
      progress_updated_at: None,
      deleted_at: None,
      position: None,
      series: None,
      series_index: None,
      finished_at: None,
      available: true
    }
  }

  /// Every file looks a couple of days old: the sweep is asked about a day
  /// that has not come yet.
  fn later() -> SystemTime {
    SystemTime::now() + 2 * DAY
  }

  fn never() -> bool {
    false
  }

  fn library(scratch: &Scratch) -> Live {
    let books = scratch.0.join("books");
    let covers = scratch.0.join("covers");
    Live::of(&[
      // A Kindle book: its own file and the EPUB it was converted to.
      book(A, &books.join(format!("{A}.mobi")).to_string_lossy(), Some(&covers.join(format!("{A}-cover.jpg")).to_string_lossy())),
      book(B, &books.join(format!("{B}.epub")).to_string_lossy(), Some(&covers.join(format!("{B}-chosen-7.jpg")).to_string_lossy()))
    ])
  }

  /// What the library lists stays, the converted copy with it; what it does
  /// not, and what was never finished, goes.
  #[test]
  fn the_files_of_books_in_the_library_stay_and_the_rest_go() {
    let scratch = Scratch::new("books");
    for name in [format!("{A}.mobi"), format!("{A}.epub"), format!("{B}.epub")] {
      scratch.put(&format!("books/{name}"), b"a book");
    }
    scratch.put(&format!("books/{GONE}.epub"), b"a removed book");
    scratch.put(&format!("books/{A}.epub.part"), b"a conversion cut short");
    scratch.put("books/ffff9999.part", b"a download cut short");
    fs::create_dir_all(scratch.0.join("books").join("a folder")).expect("folder");

    let swept = sweep_library(&scratch.0, &library(&scratch), later(), STALE, &never);

    for kept in [format!("{A}.mobi"), format!("{A}.epub"), format!("{B}.epub"), "a folder".to_string()] {
      assert!(scratch.has(&format!("books/{kept}")), "{kept} stays");
    }
    assert!(!scratch.has(&format!("books/{GONE}.epub")));
    assert!(!scratch.has(&format!("books/{A}.epub.part")));
    assert!(!scratch.has("books/ffff9999.part"));
    assert_eq!(swept.files, 3);
  }

  /// An import writes the file before the row: a file just made is not taken
  /// for one left behind, half-written or not.
  #[test]
  fn a_file_just_made_is_left_alone() {
    let scratch = Scratch::new("fresh");
    scratch.put(&format!("books/{B}.epub"), b"a book");
    scratch.put(&format!("books/{GONE}.epub"), b"being imported");
    scratch.put(&format!("books/{GONE}.epub.part"), b"being copied");
    scratch.put(&format!("covers/{GONE}-cover.jpg"), b"being saved");

    let swept = sweep_library(&scratch.0, &library(&scratch), SystemTime::now(), STALE, &never);

    assert_eq!(swept, Swept::default());
    assert!(scratch.has(&format!("books/{GONE}.epub")) && scratch.has(&format!("books/{GONE}.epub.part")));
    assert!(scratch.has(&format!("covers/{GONE}-cover.jpg")));
  }

  /// An empty library, or one that lists hardly any of the files, is more
  /// likely the wrong library or a database that did not read than a
  /// folder of leftovers: nothing of a book's goes then.
  #[test]
  fn nothing_goes_when_the_library_does_not_look_like_the_folder() {
    let scratch = Scratch::new("implausible");
    for at in 0..5 {
      scratch.put(&format!("books/{at}{GONE}.epub"), b"a book");
      scratch.put(&format!("covers/{at}{GONE}-cover.jpg"), b"a cover");
    }
    scratch.put(&format!("books/{B}.epub"), b"a book");

    assert_eq!(sweep_library(&scratch.0, &Live::default(), later(), STALE, &never), Swept::default());
    assert_eq!(sweep_library(&scratch.0, &library(&scratch), later(), STALE, &never), Swept::default());
    assert_eq!(files_in(&scratch.0.join("books")).len(), 6);
    assert_eq!(files_in(&scratch.0.join("covers")).len(), 5);
  }

  /// A removed book's covers go; a chosen cover replaced by another goes, and
  /// so does a PDF's stand-in page once a real cover is shown, and the old
  /// one-size thumbnail. The book's own cover and its thumbnails stay
  /// whatever it shows.
  #[test]
  fn covers_of_removed_books_and_covers_replaced_go() {
    let scratch = Scratch::new("covers");
    let keep = [
      format!("{A}-cover.jpg"),
      format!("{A}-thumb-240.jpg"),
      format!("{A}-thumb-480.jpg"),
      format!("{B}-cover.jpg"),
      format!("{B}-chosen-7.jpg"),
      format!("{B}-thumb-480.jpg")
    ];
    let drop = [
      format!("{A}-page.jpg"),
      format!("{A}-thumb.jpg"),
      format!("{B}-chosen-3.jpg"),
      format!("{GONE}-cover.jpg"),
      format!("{GONE}-thumb.jpg"),
      format!("{GONE}-thumb-240.jpg"),
      format!("{GONE}-thumb-480.jpg"),
      format!("{B}-thumb.part"),
      format!("{B}-thumb-240.part")
    ];
    for name in keep.iter().chain(&drop) {
      scratch.put(&format!("covers/{name}"), b"a picture");
    }

    let swept = sweep_library(&scratch.0, &library(&scratch), later(), STALE, &never);

    for name in &keep {
      assert!(scratch.has(&format!("covers/{name}")), "{name} stays");
    }
    for name in &drop {
      assert!(!scratch.has(&format!("covers/{name}")), "{name} goes");
    }
    assert_eq!(swept.files, drop.len());
    assert_eq!(swept.bytes, (drop.len() * b"a picture".len()) as u64, "what went is counted");
  }

  /// A PDF still showing its first page keeps it.
  #[test]
  fn a_stand_in_page_in_use_stays() {
    let scratch = Scratch::new("page");
    let page = scratch.put(&format!("covers/{A}-page.jpg"), b"page one");
    let live = Live::of(&[book(A, &format!("/books/{A}.pdf"), Some(&page.to_string_lossy()))]);
    sweep_library(&scratch.0, &live, later(), STALE, &never);
    assert!(page.exists());
  }

  /// The newest copy of the database stays for good; older ones go once they
  /// are old. A database set aside as damaged is never touched.
  #[test]
  fn old_copies_of_the_database_go_and_the_newest_stays() {
    let scratch = Scratch::new("database");
    for name in ["library.db", "library.db-wal", "library.db.bak-v3", "library.db.bak-v4", "library.db.bak-v12", "library.db.broken-20260101-120000"] {
      scratch.put(name, b"rows");
    }

    let soon = sweep_database_copies(&scratch.0, later(), OLD_BACKUP, &never);
    assert_eq!(soon, Swept::default(), "not old enough yet");

    let swept = sweep_database_copies(&scratch.0, SystemTime::now() + OLD_BACKUP + DAY, OLD_BACKUP, &never);
    assert_eq!(swept.files, 2);
    assert!(!scratch.has("library.db.bak-v3") && !scratch.has("library.db.bak-v4"));
    for name in ["library.db", "library.db-wal", "library.db.bak-v12", "library.db.broken-20260101-120000"] {
      assert!(scratch.has(name), "{name} stays");
    }
  }

  /// Opening another library meanwhile stops the sweep before it removes
  /// anything more.
  #[test]
  fn a_sweep_told_to_stop_removes_nothing() {
    let scratch = Scratch::new("stop");
    scratch.put(&format!("books/{GONE}.epub.part"), b"half");
    scratch.put(&format!("covers/{GONE}-cover.jpg"), b"a cover");
    let swept = sweep_library(&scratch.0, &library(&scratch), later(), STALE, &|| true);
    assert_eq!(swept, Swept::default());
    assert!(scratch.has(&format!("books/{GONE}.epub.part")));
  }

  fn noisy_jpeg(width: u32, height: u32, quality: u8) -> Vec<u8> {
    // Noise does not compress, so a small picture can stand for a big cover.
    let mut seed = 7u32;
    let image = image::RgbImage::from_fn(width, height, |_, _| {
      seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
      let [r, g, b, _] = seed.to_le_bytes();
      image::Rgb([r, g, b])
    });
    let mut out = Vec::new();
    image.write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)).expect("encode");
    out
  }

  /// A big cover is made smaller and no longer than the longest side kept; a
  /// small one, or one with see-through parts, is kept as it is.
  #[test]
  fn a_big_cover_is_made_smaller_and_a_small_one_is_not_touched() {
    let big = noisy_jpeg(300, 450, 100);
    let fitted = fit_cover_with(&big, 1000, 200).expect("smaller");
    assert!(fitted.len() * 4 <= big.len() * 3);
    let image = image::load_from_memory(&fitted).expect("still a picture");
    assert_eq!((image.width(), image.height()), (133, 200));

    assert!(fit_cover_with(&big, big.len(), 200).is_none(), "under the size worth the trouble");

    let mut clear = Vec::new();
    image::RgbaImage::from_pixel(300, 450, image::Rgba([0, 0, 0, 0]))
      .write_to(&mut std::io::Cursor::new(&mut clear), image::ImageFormat::Png)
      .expect("png");
    assert!(fit_cover_with(&clear, 10, 200).is_none(), "see-through");
    assert!(fit_cover_with(b"not a picture at all, but long enough", 10, 200).is_none());
  }

  /// In place, for the library's covers only, under the same name.
  #[test]
  fn the_librarys_big_covers_are_shrunk_in_place() {
    let scratch = Scratch::new("shrink");
    let big = noisy_jpeg(300, 450, 100);
    let mine = scratch.put(&format!("covers/{A}-cover.jpg"), &big);
    let chosen = scratch.put(&format!("covers/{B}-chosen-7.jpg"), &big);
    let thumb = scratch.put(&format!("covers/{A}-thumb-480.jpg"), &big);
    let theirs = scratch.put(&format!("covers/{GONE}-cover.jpg"), &big);
    // The thumbnail was made before the cover is shrunk.
    let made = SystemTime::now() - DAY;
    fs::OpenOptions::new().append(true).open(&thumb).expect("thumb").set_modified(made).expect("backdate");

    let saved = shrink_covers_with(&scratch.0.join("covers"), &library(&scratch), 1000, 200, &never);
    // The same picture made smaller: the thumbnail still shows it, so it stays fresh.
    assert!(super::super::thumbs::fresh(&scratch.0.join("covers"), &mine, A, 480).is_some());

    assert_eq!(saved.files, 2);
    for shrunk in [&mine, &chosen] {
      let now = fs::read(shrunk).expect("still there");
      assert!(now.len() < big.len());
      image::load_from_memory(&now).expect("still a picture");
    }
    assert_eq!(fs::read(&thumb).expect("thumb").len(), big.len());
    assert_eq!(fs::read(&theirs).expect("theirs").len(), big.len());
    assert_eq!(files_in(&scratch.0.join("covers")).len(), 4, "no staging file left");
  }

  /// Android's copies for an import go once they are an hour old.
  #[test]
  fn the_copies_made_for_an_import_go_once_it_is_over() {
    let scratch = Scratch::new("cache");
    let batch = scratch.0.join("picked").join("1700000000000-1").join("0");
    fs::create_dir_all(&batch).expect("batch");
    fs::write(batch.join("Dune.epub"), vec![0u8; 2048]).expect("copy");
    fs::create_dir_all(scratch.0.join("shared")).expect("shared");
    fs::write(scratch.0.join("shared").join("quote.png"), b"png").expect("share");
    fs::create_dir_all(scratch.0.join("WebView")).expect("webview");
    fs::write(scratch.0.join("WebView").join("index"), b"cache").expect("cache");

    let hour = Duration::from_secs(60 * 60);
    assert_eq!(sweep_import_copies(&scratch.0, SystemTime::now(), hour), Swept::default(), "an import still running");

    let swept = sweep_import_copies(&scratch.0, SystemTime::now() + 2 * hour, hour);
    assert_eq!(swept, Swept { files: 2, bytes: 2048 + 3 });
    assert!(!scratch.0.join("picked").join("1700000000000-1").exists());
    assert!(scratch.0.join("picked").exists() && scratch.0.join("WebView").join("index").exists());
  }

  #[test]
  fn disk_usage_counts_every_file_below() {
    let scratch = Scratch::new("usage");
    scratch.put(&format!("books/{A}.epub"), &[0u8; 1000]);
    scratch.put(&format!("covers/{A}-cover.jpg"), &[0u8; 24]);
    assert_eq!(disk_usage(&scratch.0), 1024);
    assert_eq!(disk_usage(&scratch.0.join("books")), 1000);
    assert_eq!(disk_usage(&scratch.0.join("nowhere")), 0);
  }

  #[test]
  fn names_are_compared_without_their_folders_or_case() {
    let live = Live::of(&[book("ABC", r"C:\Users\me\AppData\Roaming\com.leaflet.app\books\ABC.EPUB", None)]);
    assert!(live.has_book_file("abc.epub") && live.has_book_file("abc.mobi"));
    assert!(!live.has_book_file("abd.epub"));
    assert_eq!(file_name("/data/user/0/com.leaflet.app/books/x.pdf").as_deref(), Some("x.pdf"));
    assert_eq!(file_name(""), None);
  }
}
