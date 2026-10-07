//! The text of a PDF, kept so the library's search can read it.
//!
//! A PDF's text cannot be read well here (its fonts and encodings are pdf.js's
//! business), so the page reads it once, a page at a time, and hands it over:
//! when the PDF is read in the reader, or when a search finds a PDF it has no
//! text for (`apps/src/readers/pdfTextCache.ts`). It is kept in
//! `<app data>/text/<the book's hash>.json.gz`: the text of each page, in
//! order. Named by the hash of the file, so it never has to be made again: the
//! same file has the same text.
//!
//! A PDF with no text at all (a scan) is kept too, as empty pages, so it is
//! not read again at every search.
//!
//! Nothing is synced: the text is made from a file that is on this device.

use anyhow::{bail, Result};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// The most pages kept of one PDF; the pages after are left off.
pub const MAX_PAGES: usize = 20_000;
/// The most characters kept of one PDF, over all its pages; the text is cut
/// there. A long novel is about one million, and the longest book there is a
/// few. Without a limit a file made to do it could fill the disk.
pub const MAX_CHARS: usize = 10_000_000;
/// The largest file read back. One written here is far under it.
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// The most a file may unpack to: a character is at most four bytes (control
/// characters, which would be six written out, are not kept), and a page adds
/// its quotes and a comma. A file that claims more was not written here.
const MAX_UNPACKED_BYTES: u64 = (4 * MAX_CHARS + 4 * MAX_PAGES + 64) as u64;
/// Raised when what is kept of a page changes, so text kept by older rules is
/// read from the PDF again.
const RULES: u32 = 1;

#[derive(Serialize, Deserialize)]
struct Kept {
  rules: u32,
  pages: Vec<String>
}

pub fn dir() -> Result<PathBuf> {
  Ok(crate::storage::app_data_dir()?.join("text"))
}

/// Whether this is a file's hash as the library writes it. Asked before one
/// is put in a path.
fn is_hash(hash: &str) -> bool {
  hash.len() == 64 && hash.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

pub(crate) fn file_in(dir: &Path, hash: &str) -> Option<PathBuf> {
  is_hash(hash).then(|| dir.join(format!("{hash}.json.gz")))
}

/// Where the text of the book with this hash is kept, or would be. `None` for
/// a hash that is not one.
pub fn path_of(hash: &str) -> Option<PathBuf> {
  file_in(&dir().ok()?, hash)
}

/// The pages as they are kept: no more than `MAX_PAGES` of them and
/// `MAX_CHARS` characters in all, and no control characters but the line
/// break and the tab.
fn fit_to_keep(pages: &[String]) -> Vec<String> {
  let mut room = MAX_CHARS;
  pages
    .iter()
    .take(MAX_PAGES)
    .map(|page| {
      let kept: String = page
        .chars()
        .map(|c| if c.is_control() && c != '\n' && c != '\t' { ' ' } else { c })
        .take(room)
        .collect();
      // (Counted again rather than carried: `take` does not say how many it took.)
      room -= kept.chars().count();
      kept
    })
    .collect()
}

/// One file written at a time: the reader and a search can both finish
/// reading the same PDF, and would write the same staging file.
static WRITING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Keeps a PDF's text, one string a page, in order.
pub fn save(hash: &str, pages: &[String]) -> Result<()> {
  save_in(&dir()?, hash, pages)
}

pub(crate) fn save_in(dir: &Path, hash: &str, pages: &[String]) -> Result<()> {
  let Some(dest) = file_in(dir, hash) else {
    bail!("That is not a book's hash.");
  };
  let kept = Kept { rules: RULES, pages: fit_to_keep(pages) };
  let _one_at_a_time = WRITING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  fs::create_dir_all(dir)?;
  // Through a staging file, so an interrupted write leaves no half a book.
  let staging = dir.join(format!("{hash}.json.gz.part"));
  let written = (|| -> Result<()> {
    let mut encoder = GzEncoder::new(fs::File::create(&staging)?, Compression::default());
    serde_json::to_writer(&mut encoder, &kept)?;
    encoder.finish()?.sync_all()?;
    fs::rename(&staging, &dest)?;
    Ok(())
  })();
  if written.is_err() {
    let _ = fs::remove_file(&staging);
  }
  written
}

/// The text kept in this file, a string a page. `None` when there is none, or
/// when the file cannot be read as one written here (cut short, changed by
/// hand, made by other rules): the PDF is then read again, and the file
/// written over.
pub fn load_from(path: &Path) -> Option<Vec<String>> {
  if fs::metadata(path).ok()?.len() > MAX_FILE_BYTES {
    return None;
  }
  // No more than the limit is unpacked, whatever the file says is in it.
  let mut json = Vec::new();
  GzDecoder::new(fs::File::open(path).ok()?).take(MAX_UNPACKED_BYTES + 1).read_to_end(&mut json).ok()?;
  if json.len() as u64 > MAX_UNPACKED_BYTES {
    return None;
  }
  let kept: Kept = serde_json::from_slice(&json).ok()?;
  (kept.rules == RULES && kept.pages.len() <= MAX_PAGES).then_some(kept.pages)
}

/// Whether the text of the book with this hash is kept, and can be read.
pub fn has(hash: &str) -> bool {
  path_of(hash).is_some_and(|path| load_from(&path).is_some())
}

/// Whether any page has something to search: a letter or a digit. A scan has
/// none, and neither has a PDF whose every page is only spacing.
pub fn has_text(pages: &[String]) -> bool {
  pages.iter().any(|page| page.chars().any(char::is_alphanumeric))
}

/// A removed book's text goes with it. Best effort.
pub fn remove(hash: &str) {
  if let Some(path) = path_of(hash) {
    let _ = fs::remove_file(path);
  }
}

/// Every book's text, for "Delete All Data". Best effort.
pub fn remove_all() {
  let _one_at_a_time = WRITING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  if let Ok(dir) = dir() {
    let _ = fs::remove_dir_all(dir);
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Write;

  const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("leaflet-pdf-text-{name}-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("dir");
    dir
  }

  fn pages(texts: &[&str]) -> Vec<String> {
    texts.iter().map(|text| text.to_string()).collect()
  }

  /// A file as `save_in` writes one, holding whatever JSON it is given.
  fn write_gz(path: &Path, json: &[u8]) {
    let mut encoder = GzEncoder::new(fs::File::create(path).expect("create"), Compression::default());
    encoder.write_all(json).expect("write");
    encoder.finish().expect("finish");
  }

  #[test]
  fn a_books_text_comes_back_as_it_was_kept_page_for_page() {
    let root = scratch("round-trip");
    let texts = root.join("text");
    let book = pages(&["The keeper climbed\nthe stairs.", "", "“Who’s there?” naïve café 灯台 \"quoted\" back\\slash\ttab", "last page"]);
    save_in(&texts, HASH, &book).expect("save");
    let path = file_in(&texts, HASH).expect("a hash");
    assert_eq!(load_from(&path), Some(book));
    // Nothing is left beside it, and it is packed: not the words in the clear.
    let kept: Vec<String> = fs::read_dir(&texts).expect("read").flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect();
    assert_eq!(kept, vec![format!("{HASH}.json.gz")]);
    assert_eq!(fs::read(&path).expect("read")[..2], [0x1f, 0x8b]);

    // Kept again, it is what was kept last.
    save_in(&texts, HASH, &pages(&["only this"])).expect("save again");
    assert_eq!(load_from(&path), Some(pages(&["only this"])));
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn a_scan_is_kept_as_pages_with_nothing_on_them() {
    let root = scratch("scan");
    let texts = root.join("text");
    save_in(&texts, HASH, &pages(&["", "", ""])).expect("save");
    let kept = load_from(&file_in(&texts, HASH).expect("a hash")).expect("kept");
    assert_eq!(kept.len(), 3);
    assert!(!has_text(&kept));
    // A book of no pages at all is kept as well, and is not "nothing kept".
    save_in(&texts, HASH, &[]).expect("save");
    assert_eq!(load_from(&file_in(&texts, HASH).expect("a hash")), Some(Vec::new()));

    assert!(!has_text(&pages(&[" \n ", "\t", "— … ·"])));
    assert!(has_text(&pages(&["", " 7 "])));
    assert!(has_text(&pages(&["", "灯"])));
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn no_more_is_kept_than_the_limits_allow() {
    // More pages than are kept: the ones after are left off.
    let many: Vec<String> = (0..MAX_PAGES + 5).map(|at| at.to_string()).collect();
    let kept = fit_to_keep(&many);
    assert_eq!(kept.len(), MAX_PAGES);
    assert_eq!(kept.last().map(String::as_str), Some((MAX_PAGES - 1).to_string().as_str()));

    // More characters than are kept: cut where the limit falls, in the middle
    // of a page if it must, and the pages after are empty. Counted in
    // characters, so the cut never lands inside one.
    let long = vec!["é".repeat(MAX_CHARS - 10), "灯".repeat(25), "after".to_string()];
    let kept = fit_to_keep(&long);
    assert_eq!(kept.iter().map(|page| page.chars().count()).collect::<Vec<_>>(), [MAX_CHARS - 10, 10, 0]);
    assert_eq!(kept[1], "灯".repeat(10));

    // Control characters would each be six bytes written out: they are spaces. Line breaks and tabs stay.
    assert_eq!(fit_to_keep(&pages(&["a\u{1}b\u{0}c\nd\te\u{7f}f\r"])), pages(&["a b c\nd\te f "]));
    // What is within the limits is kept as it came.
    assert_eq!(fit_to_keep(&pages(&["one", "", "three"])), pages(&["one", "", "three"]));
  }

  #[test]
  fn the_limits_hold_for_what_is_written_to_the_disk() {
    let root = scratch("caps");
    let texts = root.join("text");
    let long = vec!["windmill ".repeat(MAX_CHARS / 9 + 1000), "never kept".to_string()];
    save_in(&texts, HASH, &long).expect("save");
    let path = file_in(&texts, HASH).expect("a hash");
    let kept = load_from(&path).expect("kept");
    assert_eq!(kept.iter().map(|page| page.chars().count()).collect::<Vec<_>>(), [MAX_CHARS, 0]);
    assert!(fs::metadata(&path).expect("there").len() < MAX_FILE_BYTES);
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn a_damaged_file_is_as_good_as_none() {
    let root = scratch("damaged");
    let texts = root.join("text");
    fs::create_dir_all(&texts).expect("dir");
    let path = file_in(&texts, HASH).expect("a hash");
    assert_eq!(load_from(&path), None, "never written");

    // Not packed at all; packed but cut short; packed but not what is written here.
    fs::write(&path, br#"{"rules":1,"pages":["in the clear"]}"#).expect("write");
    assert_eq!(load_from(&path), None);
    save_in(&texts, HASH, &pages(&[&"The lighthouse stood on the rock. ".repeat(400)])).expect("save");
    let whole = fs::read(&path).expect("read");
    fs::write(&path, &whole[..whole.len() / 2]).expect("write");
    assert_eq!(load_from(&path), None);
    fs::write(&path, b"").expect("write");
    assert_eq!(load_from(&path), None);
    for other in [&b"{ not json"[..], b"[\"a\",\"b\"]", br#"{"pages":["no rules"]}"#, br#"{"rules":1,"pages":"one string"}"#, br#"{"rules":1,"pages":[1,2]}"#] {
      write_gz(&path, other);
      assert_eq!(load_from(&path), None, "{}", String::from_utf8_lossy(other));
    }
    // Made by rules that are not these.
    write_gz(&path, format!(r#"{{"rules":{},"pages":["older"]}}"#, RULES + 1).as_bytes());
    assert_eq!(load_from(&path), None);
    // A small file that unpacks to more than any book: given up, not unpacked to the end.
    write_gz(&path, &vec![b' '; MAX_UNPACKED_BYTES as usize + 4096]);
    assert!(fs::metadata(&path).expect("there").len() < 1024 * 1024);
    assert_eq!(load_from(&path), None);

    // And it is written over by the next reading.
    save_in(&texts, HASH, &pages(&["read again"])).expect("save");
    assert_eq!(load_from(&path), Some(pages(&["read again"])));
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn only_a_hash_reaches_a_path() {
    let root = scratch("hash");
    let texts = root.join("text");
    assert!(is_hash(HASH));
    for bad in ["", "abc", &HASH[1..], &format!("{HASH}0"), &HASH.to_uppercase(), "../../library.db", &format!("../{}", &HASH[3..]), &format!("{}/", &HASH[1..])] {
      assert!(!is_hash(bad), "{bad}");
      assert_eq!(file_in(&texts, bad), None);
      assert!(save_in(&texts, bad, &pages(&["text"])).is_err());
    }
    assert!(!texts.exists(), "nothing was written");
    let _ = fs::remove_dir_all(&root);
  }
}
