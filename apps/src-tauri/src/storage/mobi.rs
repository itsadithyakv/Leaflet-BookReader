//! What a Kindle book (MOBI, AZW, AZW3, PRC) says about itself: its title, its
//! writers, its subjects and its cover.
//!
//! These files need Calibre before they can be read, and until then nothing in
//! them was looked at: a book came in under its file's name, with no cover,
//! although all of it sits unencrypted at the front of the file. The container
//! is a Palm database (a list of records); record 0 holds the MOBI header, the
//! EXTH records after it hold the metadata, and the cover is one of the image
//! records further on. Only the header and that one record are read, never the
//! whole file.

use anyhow::{anyhow, bail, Result};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Record 0 is a few kilobytes; anything larger is not a header.
const MAX_HEADER_BYTES: u64 = 1024 * 1024;
/// Covers larger than this are not read into memory (as for an EPUB).
const MAX_COVER_BYTES: u64 = 15 * 1024 * 1024;
/// A book credits a handful of people and subjects; a header that lists
/// thousands is damaged.
const MAX_EXTH_RECORDS: u32 = 4096;

#[derive(Debug, Default, PartialEq)]
pub struct Info {
  pub title: Option<String>,
  /// As written, one per credit: "Pierce Brown [Brown, Pierce]".
  pub authors: Vec<String>,
  pub subjects: Vec<String>,
  /// Locked to an account (DRM). The metadata can still be read; the text
  /// cannot, by Leaflet or by Calibre.
  pub encrypted: bool,
  /// Which record holds the cover image.
  cover_record: Option<usize>
}

struct Book {
  file: File,
  len: u64,
  /// Where each record starts.
  offsets: Vec<u64>
}

fn be16(bytes: &[u8], at: usize) -> Option<u16> {
  bytes.get(at..at.checked_add(2)?).map(|b| u16::from_be_bytes([b[0], b[1]]))
}

fn be32(bytes: &[u8], at: usize) -> Option<u32> {
  bytes.get(at..at.checked_add(4)?).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

/// Windows-1252, which older books use: Latin-1 but for the quotes and dashes
/// between 0x80 and 0x9F.
fn cp1252(byte: u8) -> char {
  match byte {
    0x80 => '€',
    0x85 => '…',
    0x91 => '‘',
    0x92 => '’',
    0x93 => '“',
    0x94 => '”',
    0x96 => '–',
    0x97 => '—',
    other => char::from(other)
  }
}

fn text(bytes: &[u8], utf8: bool) -> Option<String> {
  let text = if utf8 {
    String::from_utf8_lossy(bytes).into_owned()
  } else {
    bytes.iter().map(|byte| cp1252(*byte)).collect()
  };
  let text = text.replace('\0', "").split_whitespace().collect::<Vec<_>>().join(" ");
  Some(text).filter(|text| !text.is_empty())
}

fn open(path: &Path) -> Result<Book> {
  let mut file = File::open(path)?;
  let len = file.metadata()?.len();
  let mut head = [0u8; 78];
  file.read_exact(&mut head).map_err(|_| anyhow!("too short to be a Kindle book"))?;
  if &head[60..68] != b"BOOKMOBI" {
    bail!("not a Kindle book");
  }
  let count = u16::from_be_bytes([head[76], head[77]]) as usize;
  if count == 0 {
    bail!("a Kindle book with no records");
  }
  let mut table = vec![0u8; count * 8];
  file.read_exact(&mut table).map_err(|_| anyhow!("the list of records is cut short"))?;
  let offsets = table
    .chunks_exact(8)
    .map(|entry| u32::from_be_bytes([entry[0], entry[1], entry[2], entry[3]]) as u64)
    .collect();
  Ok(Book { file, len, offsets })
}

impl Book {
  fn record(&mut self, index: usize, max: u64) -> Result<Vec<u8>> {
    let start = *self.offsets.get(index).ok_or_else(|| anyhow!("no record {index}"))?;
    let end = self.offsets.get(index + 1).copied().unwrap_or(self.len);
    if start >= end || end > self.len {
      bail!("record {index} lies outside the file");
    }
    if end - start > max {
      bail!("record {index} is too large");
    }
    self.file.seek(SeekFrom::Start(start))?;
    let mut bytes = vec![0u8; (end - start) as usize];
    self.file.read_exact(&mut bytes)?;
    Ok(bytes)
  }
}

/// Record 0: the PalmDOC header (16 bytes), the MOBI header, then EXTH.
fn parse(record: &[u8]) -> Result<Info> {
  if record.get(16..20) != Some(b"MOBI".as_slice()) {
    bail!("no MOBI header");
  }
  let mut info = Info { encrypted: be16(record, 12).unwrap_or(0) != 0, ..Info::default() };
  let header_len = be32(record, 20).unwrap_or(0) as usize;
  let utf8 = be32(record, 28) == Some(65001);

  // The name the file was made with, at an offset the header gives.
  let full_name = match (be32(record, 84), be32(record, 88)) {
    (Some(at), Some(len)) => (at as usize).checked_add(len as usize).and_then(|end| record.get(at as usize..end)).and_then(|bytes| text(bytes, utf8)),
    _ => None
  };
  let first_image = be32(record, 108).filter(|index| *index != u32::MAX);
  let mut updated_title = None;
  let mut cover_offset = None;

  let has_exth = be32(record, 128).is_some_and(|flags| flags & 0x40 != 0);
  let exth = 16usize.saturating_add(header_len);
  if has_exth && record.get(exth..exth.saturating_add(4)) == Some(b"EXTH".as_slice()) {
    let count = be32(record, exth + 8).unwrap_or(0).min(MAX_EXTH_RECORDS);
    let mut at = exth + 12;
    for _ in 0..count {
      let (Some(kind), Some(size)) = (be32(record, at), be32(record, at.saturating_add(4))) else {
        break;
      };
      let size = size as usize;
      let Some(data) = (size >= 8).then(|| at.checked_add(size)).flatten().and_then(|end| record.get(at + 8..end)) else {
        break;
      };
      match kind {
        100 => info.authors.extend(text(data, utf8)),
        105 => info.subjects.extend(text(data, utf8)),
        201 => cover_offset = be32(data, 0).filter(|offset| *offset != u32::MAX),
        503 => updated_title = text(data, utf8),
        _ => {}
      }
      at += size;
    }
  }

  // The shop's title ("Red Rising (The Red Rising Trilogy, Book 1)") says
  // more than the name the file was built with ("Red Rising").
  info.title = updated_title.or(full_name);
  info.cover_record = match (first_image, cover_offset) {
    (Some(first), Some(offset)) => (first as usize).checked_add(offset as usize),
    _ => None
  };
  Ok(info)
}

/// The book's own word on what it is.
pub fn info(path: &Path) -> Result<Info> {
  let mut book = open(path)?;
  parse(&book.record(0, MAX_HEADER_BYTES)?)
}

/// The cover image inside the book, if it names one and it is a real image.
pub fn cover(path: &Path) -> Result<Option<Vec<u8>>> {
  let mut book = open(path)?;
  let info = parse(&book.record(0, MAX_HEADER_BYTES)?)?;
  let Some(index) = info.cover_record else {
    return Ok(None);
  };
  let Ok(bytes) = book.record(index, MAX_COVER_BYTES) else {
    return Ok(None);
  };
  Ok(super::sniff_image_mime(&bytes).map(|_| bytes))
}

#[cfg(test)]
pub(crate) mod tests {
  use super::*;

  /// A small Kindle file: the header, some text, then `images`.
  pub(crate) fn kindle_file(exth: &[(u32, &[u8])], full_name: &[u8], utf8: bool, encrypted: bool, images: &[&[u8]]) -> Vec<u8> {
    let mut exth_bytes = Vec::new();
    for (kind, data) in exth {
      exth_bytes.extend((*kind).to_be_bytes());
      exth_bytes.extend((data.len() as u32 + 8).to_be_bytes());
      exth_bytes.extend(*data);
    }
    let header_len = 232usize;
    let mut record0 = vec![0u8; 16 + header_len];
    record0[12..14].copy_from_slice(&(if encrypted { 2u16 } else { 0 }).to_be_bytes());
    record0[16..20].copy_from_slice(b"MOBI");
    record0[20..24].copy_from_slice(&(header_len as u32).to_be_bytes());
    record0[28..32].copy_from_slice(&(if utf8 { 65001u32 } else { 1252 }).to_be_bytes());
    // Records: 0 the header, 1 the text, 2.. the images.
    record0[108..112].copy_from_slice(&2u32.to_be_bytes());
    record0[128..132].copy_from_slice(&0x40u32.to_be_bytes());
    record0.extend(b"EXTH");
    record0.extend((exth_bytes.len() as u32 + 12).to_be_bytes());
    record0.extend((exth.len() as u32).to_be_bytes());
    record0.extend(&exth_bytes);
    let name_at = record0.len() as u32;
    record0[84..88].copy_from_slice(&name_at.to_be_bytes());
    record0[88..92].copy_from_slice(&(full_name.len() as u32).to_be_bytes());
    record0.extend(full_name);

    let mut records: Vec<Vec<u8>> = vec![record0, b"the text of the book, compressed".to_vec()];
    records.extend(images.iter().map(|image| image.to_vec()));
    let mut file = vec![0u8; 78];
    file[60..68].copy_from_slice(b"BOOKMOBI");
    file[76..78].copy_from_slice(&(records.len() as u16).to_be_bytes());
    let mut at = 78 + records.len() * 8 + 2;
    for record in &records {
      file.extend((at as u32).to_be_bytes());
      file.extend([0u8; 4]);
      at += record.len();
    }
    file.extend([0u8; 2]);
    for record in &records {
      file.extend(record);
    }
    file
  }

  fn saved(name: &str, bytes: &[u8]) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("leaflet-mobi-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dir");
    let path = dir.join(name);
    std::fs::write(&path, bytes).expect("write");
    path
  }

  const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 16, b'J', b'F', b'I', b'F', 0, 1, 2, 3];

  #[test]
  fn reads_what_a_kindle_book_says_about_itself() {
    let bytes = kindle_file(
      &[
        (100, b"Mara Ellison [Ellison, Mara]"),
        (100, b"shuwu5.com"),
        (105, b"Fiction"),
        (503, b"Night Ferry (The Saltmarsh Trilogy, Book 1)"),
        (201, &1u32.to_be_bytes()),
        (202, &0u32.to_be_bytes())
      ],
      b"Night Ferry",
      true,
      false,
      &[b"GIF89a-a-thumbnail", JPEG]
    );
    let path = saved("book.azw3", &bytes);
    let info = info(&path).expect("info");
    assert_eq!(info.title.as_deref(), Some("Night Ferry (The Saltmarsh Trilogy, Book 1)"));
    assert_eq!(info.authors, ["Mara Ellison [Ellison, Mara]", "shuwu5.com"]);
    assert_eq!(info.subjects, ["Fiction"]);
    assert!(!info.encrypted);
    // The cover is the image the header points at, not the first one.
    assert_eq!(cover(&path).expect("cover").as_deref(), Some(JPEG));
  }

  #[test]
  fn falls_back_to_the_name_the_file_was_built_with() {
    // No title record, an older encoding, and locked to an account.
    let bytes = kindle_file(&[(100, b"Zo\xEB Caf\xE9")], b"L\x92\xE9t\xE9", false, true, &[]);
    let info = info(&saved("old.mobi", &bytes)).expect("info");
    assert_eq!(info.title.as_deref(), Some("L’été"));
    assert_eq!(info.authors, ["Zoë Café"]);
    assert!(info.encrypted);
    assert_eq!(cover(&saved("old.mobi", &bytes)).expect("cover"), None, "no cover is named");
  }

  #[test]
  fn a_file_that_is_not_one_or_is_cut_short_is_an_error_not_a_panic() {
    let whole = kindle_file(&[(503, b"Night Ferry"), (201, &7u32.to_be_bytes())], b"Night Ferry", true, false, &[JPEG]);
    // A cover the header points past the end for.
    assert_eq!(cover(&saved("past.mobi", &whole)).expect("cover"), None);
    // Every way of cutting the file short.
    for len in (0..whole.len()).step_by(7) {
      let path = saved("cut.mobi", &whole[..len]);
      let _ = info(&path);
      let _ = cover(&path);
    }
    // A header whose lengths lie.
    let mut lying = whole.clone();
    let record0 = 78 + 3 * 8 + 2;
    lying[record0 + 20..record0 + 24].copy_from_slice(&u32::MAX.to_be_bytes());
    lying[record0 + 84..record0 + 92].copy_from_slice(&[0xFF; 8]);
    let info = info(&saved("lying.mobi", &lying)).expect("still a header");
    assert_eq!(info.title, None);
    // Not a Kindle file at all: an EPUB, a text file, nothing.
    for other in [&b"PK\x03\x04 an epub"[..], &[b'x'; 200][..], b""] {
      assert!(super::info(&saved("other.mobi", other)).is_err());
    }
  }
}
