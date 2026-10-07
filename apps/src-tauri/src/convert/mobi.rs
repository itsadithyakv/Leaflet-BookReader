//! A Kindle book (MOBI, PRC, old AZW) read without Calibre.
//!
//! The file is a Palm database: a list of records. Record 0 is the header;
//! the records after it are the book's text, cut into 4 KB pieces and each
//! compressed by itself (PalmDOC, a small LZ77); after the text come the
//! pictures, one a record. The text is one long page of old HTML in which a
//! link says where it goes by a byte count (`<a filepos=0001234>`), a picture
//! by its number (`<img recindex="00003">`), and a new page by a tag of
//! Mobipocket's own (`<mbp:pagebreak/>`).
//!
//! That is made into the chapters and pictures of an EPUB here, so the reader
//! opens it as it opens any book. What is not read here still goes to
//! Calibre: the newer format (KF8, most `.azw3`), where the book is in
//! fragments put together by tables; and the older Huffman compression. A
//! book locked to an account is read by nobody.

use super::epub_builder::{Chapter, EpubBuilder, Image};
use super::xhtml::{self, Kind, Token, Writer};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

/// A book of text is a few megabytes; one with many pictures, tens.
const MAX_FILE_BYTES: u64 = 400 * 1024 * 1024;
/// The text, uncompressed. A long novel is two or three megabytes.
const MAX_TEXT_BYTES: usize = 64 * 1024 * 1024;
/// A chapter is split when it passes this, at the next paragraph: a book with
/// no page breaks was one page of a megabyte, and slow to open and to turn.
const SPLIT_AT_BYTES: usize = 200 * 1024;
const MAX_TITLE_CHARS: usize = 120;

/// Why a Kindle book is not read here.
#[derive(Debug, PartialEq)]
pub enum NotRead {
  /// Locked to an account. Nobody can read it but the app it was bought in.
  Locked,
  /// A kind this does not read (KF8, Huffman): Calibre's to convert.
  OtherKind(&'static str),
  /// Not a Kindle book at all, or damaged.
  Damaged(String)
}

fn be16(bytes: &[u8], at: usize) -> Option<u16> {
  bytes.get(at..at.checked_add(2)?).map(|b| u16::from_be_bytes([b[0], b[1]]))
}

fn be32(bytes: &[u8], at: usize) -> Option<u32> {
  bytes.get(at..at.checked_add(4)?).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

/// What record 0 says about how the text is kept.
#[derive(Debug, PartialEq)]
struct Header {
  compressed: bool,
  text_bytes: usize,
  text_records: usize,
  utf8: bool,
  /// The record the pictures start at.
  first_image: Option<usize>,
  /// Which kinds of extra bytes end each text record.
  extra_flags: u16
}

fn header(record: &[u8]) -> std::result::Result<Header, NotRead> {
  let damaged = |what: &str| NotRead::Damaged(what.to_string());
  if record.get(16..20) != Some(b"MOBI".as_slice()) {
    return Err(damaged("no MOBI header"));
  }
  if be16(record, 12).unwrap_or(0) != 0 {
    return Err(NotRead::Locked);
  }
  let compressed = match be16(record, 0) {
    Some(1) => false,
    Some(2) => true,
    Some(17480) => return Err(NotRead::OtherKind("Huffman compression")),
    _ => return Err(damaged("an unknown compression"))
  };
  // A file that is only the newer format says so here. One that carries both
  // (most files made after 2011) says 6, and its first half is read.
  if be32(record, 36) == Some(8) {
    return Err(NotRead::OtherKind("the newer Kindle format (KF8)"));
  }
  let header_len = be32(record, 20).unwrap_or(0) as usize;
  // The flags are in headers long enough to have them.
  let extra_flags = if header_len >= 0xE4 { be16(record, 0xF2).unwrap_or(0) } else { 0 };
  Ok(Header {
    compressed,
    text_bytes: be32(record, 4).unwrap_or(0) as usize,
    text_records: be16(record, 8).unwrap_or(0) as usize,
    utf8: be32(record, 28) == Some(65001),
    first_image: be32(record, 108).filter(|index| *index != u32::MAX && *index != 0).map(|index| index as usize),
    extra_flags
  })
}

/// The file's records, as slices of it.
fn records(file: &[u8]) -> std::result::Result<Vec<&[u8]>, NotRead> {
  let damaged = |what: &str| NotRead::Damaged(what.to_string());
  if file.get(60..68) != Some(b"BOOKMOBI".as_slice()) {
    return Err(damaged("not a Kindle book"));
  }
  let count = be16(file, 76).unwrap_or(0) as usize;
  if count == 0 {
    return Err(damaged("a Kindle book with no records"));
  }
  let mut starts = Vec::with_capacity(count);
  for index in 0..count {
    starts.push(be32(file, 78 + index * 8).ok_or_else(|| damaged("the list of records is cut short"))? as usize);
  }
  let mut out = Vec::with_capacity(count);
  for (index, start) in starts.iter().enumerate() {
    let end = starts.get(index + 1).copied().unwrap_or(file.len());
    out.push(file.get(*start..end).ok_or_else(|| damaged("a record lies outside the file"))?);
  }
  Ok(out)
}

/// How many bytes at the end of a text record are not text: the entries the
/// flags name, each ending in its own length written backwards, and, for the
/// lowest flag, the bytes of a letter cut in two by the record's end.
fn trailing_bytes(record: &[u8], flags: u16) -> usize {
  let entry = |upto: usize| -> usize {
    let mut size = 0usize;
    for byte in &record[upto.saturating_sub(4)..upto] {
      if byte & 0x80 != 0 {
        size = 0;
      }
      size = (size << 7) | (byte & 0x7f) as usize;
    }
    size
  };
  let mut extra = 0usize;
  let mut rest = flags >> 1;
  while rest != 0 {
    if rest & 1 != 0 {
      extra = extra.saturating_add(entry(record.len().saturating_sub(extra)));
    }
    rest >>= 1;
  }
  if flags & 1 != 0 && extra < record.len() {
    extra += (record[record.len() - extra - 1] & 3) as usize + 1;
  }
  extra.min(record.len())
}

/// PalmDOC: a byte is itself, a count of bytes to copy as they are, a space
/// and a letter in one, or two bytes that say "the same as so far back, for
/// so long".
fn inflate(packed: &[u8], out: &mut Vec<u8>) {
  let start = out.len();
  let mut at = 0;
  while at < packed.len() {
    let byte = packed[at];
    at += 1;
    match byte {
      0x01..=0x08 => {
        let end = (at + byte as usize).min(packed.len());
        out.extend_from_slice(&packed[at..end]);
        at = end;
      }
      0x00 | 0x09..=0x7f => out.push(byte),
      0x80..=0xbf => {
        let Some(next) = packed.get(at) else { break };
        at += 1;
        let pair = (((byte as usize) << 8) | *next as usize) & 0x3fff;
        let back = pair >> 3;
        let count = (pair & 7) + 3;
        // Only ever into this record's own text, as it was written.
        if back == 0 || back > out.len() - start {
          continue;
        }
        for _ in 0..count {
          out.push(out[out.len() - back]);
        }
      }
      _ => {
        out.push(b' ');
        out.push(byte ^ 0x80);
      }
    }
  }
}

/// The book's text as it was written: one page of HTML, in the book's bytes.
fn text_of(records: &[&[u8]], header: &Header) -> std::result::Result<Vec<u8>, NotRead> {
  let last = header.text_records;
  if last == 0 || last >= records.len() {
    return Err(NotRead::Damaged("the text records are missing".to_string()));
  }
  let mut text = Vec::with_capacity(header.text_bytes.min(MAX_TEXT_BYTES));
  for record in &records[1..=last] {
    let kept = &record[..record.len() - trailing_bytes(record, header.extra_flags)];
    if header.compressed {
      inflate(kept, &mut text);
    } else {
      text.extend_from_slice(kept);
    }
    if text.len() > MAX_TEXT_BYTES {
      return Err(NotRead::Damaged("the text is larger than a book's".to_string()));
    }
  }
  if header.text_bytes > 0 {
    text.truncate(header.text_bytes);
  }
  Ok(text)
}

fn decode(bytes: &[u8], utf8: bool) -> String {
  if utf8 {
    String::from_utf8_lossy(bytes).into_owned()
  } else {
    bytes.iter().map(|byte| xhtml::cp1252(*byte)).collect()
  }
}

fn attr<'a>(attrs: &'a [(String, Vec<u8>)], name: &str) -> Option<&'a [u8]> {
  attrs.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_slice())
}

/// A number written in a tag: `filepos=0001234`, `recindex="00003"`.
fn number(value: &[u8]) -> Option<usize> {
  let digits: String = value.iter().map(|byte| *byte as char).filter(char::is_ascii_digit).collect();
  if digits.is_empty() || digits.len() != value.iter().filter(|byte| !byte.is_ascii_whitespace()).count() {
    return None;
  }
  digits.parse().ok()
}

fn image_kind(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
  match bytes {
    [0xff, 0xd8, 0xff, ..] => Some(("jpeg", "image/jpeg")),
    [0x89, b'P', b'N', b'G', ..] => Some(("png", "image/png")),
    [b'G', b'I', b'F', b'8', ..] => Some(("gif", "image/gif")),
    [b'B', b'M', ..] => Some(("bmp", "image/bmp")),
    _ => None
  }
}

/// What a tag keeps of how it was set: centred or to the right. The rest of a
/// Kindle page's looks (sizes, indents, fonts) is the reader's to decide.
fn alignment(attrs: &[(String, Vec<u8>)]) -> Vec<(&'static str, String)> {
  match attr(attrs, "align").map(|value| String::from_utf8_lossy(value).trim().to_ascii_lowercase()).as_deref() {
    Some("center") => vec![("style", "text-align:center".to_string())],
    Some("right") => vec![("style", "text-align:right".to_string())],
    _ => Vec::new()
  }
}

fn tidy_title(text: &str) -> Option<String> {
  let title = xhtml::decode_entities(text).split_whitespace().collect::<Vec<_>>().join(" ");
  let title: String = title.chars().take(MAX_TITLE_CHARS).collect();
  Some(title).filter(|title| title.chars().any(char::is_alphanumeric))
}

/// One chapter as it is being written.
struct Part {
  page: Writer,
  /// From the book's own contents page, when it has one.
  listed: Option<String>,
  /// Its first heading, for a book without one.
  heading: Option<String>
}

impl Part {
  fn new() -> Self {
    Part { page: Writer::new(), listed: None, heading: None }
  }
}

/// The page of HTML made into chapters. `picture` answers for a picture's
/// number with the name it will have in the book.
fn chapters(page: &[u8], utf8: bool, book_title: &str, mut picture: impl FnMut(usize) -> Option<String>) -> Vec<Chapter> {
  let tokens: Vec<Token> = xhtml::tokens(page);

  // Where the links go, and what the contents page calls each place: the
  // words of a link are the name of the chapter it leads to.
  let mut targets: BTreeSet<usize> = BTreeSet::new();
  let mut names: HashMap<usize, String> = HashMap::new();
  for (index, token) in tokens.iter().enumerate() {
    let Kind::Open { name, attrs, .. } = &token.kind else { continue };
    if name != "a" && name != "reference" {
      continue;
    }
    let Some(target) = attr(attrs, "filepos").and_then(number) else { continue };
    targets.insert(target);
    if name == "a" && !names.contains_key(&target) {
      let mut words = String::new();
      for inner in &tokens[index + 1..] {
        match &inner.kind {
          Kind::Close { name } if name == "a" => break,
          Kind::Text => words.push_str(&decode(&page[inner.start..inner.end], utf8)),
          _ => {}
        }
        if words.len() > 4 * MAX_TITLE_CHARS {
          break;
        }
      }
      if let Some(title) = tidy_title(&words) {
        names.insert(target, title);
      }
    }
  }

  let mut parts: Vec<Part> = vec![Part::new()];
  // Which chapter each link's place came to be in.
  let mut landed: BTreeMap<usize, usize> = BTreeMap::new();
  let mut pending: Vec<usize> = targets.iter().copied().collect();
  pending.reverse();
  let mut hidden: Option<String> = None;
  let mut in_heading: Option<(String, String)> = None;

  for token in &tokens {
    // Inside a tag whose insides are not the book's text.
    if let Some(inside) = &hidden {
      if matches!(&token.kind, Kind::Close { name } if name == inside) {
        hidden = None;
      }
      continue;
    }
    // A link's place is marked just before whatever is written next.
    while pending.last().is_some_and(|target| *target <= token.start) {
      let target = pending.pop().unwrap_or_default();
      let part = parts.len() - 1;
      parts[part].page.raw(&format!("<a id=\"fp{target}\"></a>"));
      landed.insert(target, part);
      if parts[part].listed.is_none() {
        parts[part].listed = names.get(&target).cloned();
      }
    }
    match &token.kind {
      Kind::Other => {}
      Kind::Text => {
        let text = decode(&page[token.start..token.end], utf8);
        if let Some((_, words)) = &mut in_heading {
          words.push_str(&text);
        }
        let part = parts.len() - 1;
        parts[part].page.text(&text);
      }
      Kind::Open { name, attrs, closed } => {
        let part = parts.len() - 1;
        match name.as_str() {
          hidden_tag if xhtml::is_hidden(hidden_tag) => {
            if !closed {
              hidden = Some(name.clone());
            }
          }
          "mbp:pagebreak" => {
            if !parts[part].page.is_empty() {
              parts.push(Part::new());
            }
          }
          "a" => {
            let mut written: Vec<(&str, String)> = Vec::new();
            if let Some(target) = attr(attrs, "filepos").and_then(number) {
              written.push(("href", format!("fp:{target}")));
            } else if let Some(link) = attr(attrs, "href").map(|value| decode(value, utf8)) {
              let link = link.trim().to_string();
              if link.starts_with("http://") || link.starts_with("https://") || link.starts_with("mailto:") {
                written.push(("href", link));
              }
            }
            parts[part].page.open("a", &written);
          }
          "img" => {
            let name = attr(attrs, "recindex").and_then(number).and_then(&mut picture);
            if let Some(name) = name {
              parts[part].page.open("img", &[("src", format!("../images/{name}")), ("alt", String::new())]);
            }
          }
          "center" => parts[part].page.open("div", &[("style", "text-align:center".to_string())]),
          other => {
            // A long chapter is cut before a paragraph that is not inside anything.
            if matches!(other, "p" | "div" | "h1" | "h2" | "h3") && parts[part].page.depth() == 0 && parts[part].page.len() > SPLIT_AT_BYTES {
              parts.push(Part::new());
            }
            let part = parts.len() - 1;
            if matches!(other, "h1" | "h2" | "h3") && parts[part].heading.is_none() {
              in_heading = Some((other.to_string(), String::new()));
            }
            parts[part].page.open(other, &alignment(attrs));
          }
        }
      }
      Kind::Close { name } => {
        let part = parts.len() - 1;
        if in_heading.as_ref().is_some_and(|(open, _)| open == name) {
          let (_, words) = in_heading.take().unwrap_or_default();
          if parts[part].heading.is_none() {
            parts[part].heading = tidy_title(&words);
          }
        }
        parts[part].page.close(if name == "center" { "div" } else { name });
      }
    }
  }
  // Places past the last thing written are at the end of the book.
  let last = parts.len() - 1;
  for target in pending {
    parts[last].page.raw(&format!("<a id=\"fp{target}\"></a>"));
    landed.insert(target, last);
  }

  // The chapters that have something in them, numbered as the book will have them.
  let kept: Vec<(usize, Part)> = parts.into_iter().enumerate().filter(|(_, part)| !part.page.is_empty()).collect();
  let kept_at: Vec<usize> = kept.iter().map(|(index, _)| *index).collect();
  // A place that landed in an empty chapter is in the next one kept, or the last.
  let chapter_of = |part: usize| -> usize { kept_at.iter().position(|index| *index >= part).unwrap_or(kept_at.len().saturating_sub(1)) + 1 };

  let any_listed = kept.iter().any(|(_, part)| part.listed.is_some());
  let mut out = Vec::with_capacity(kept.len());
  for (position, (_, part)) in kept.iter().enumerate() {
    // The contents page's names when the book has one; its headings when not.
    let title = if any_listed { part.listed.clone() } else { part.heading.clone() };
    // The first chapter is always in the list, so the list is never empty.
    let title = title.or_else(|| (position == 0).then(|| book_title.to_string())).unwrap_or_default();
    out.push(Chapter { title, body: String::new() });
  }
  for ((_, part), chapter) in kept.into_iter().zip(out.iter_mut()) {
    let body = part.page.finish();
    // Each link now knows which chapter its place is in.
    let mut linked = String::with_capacity(body.len());
    let mut rest = body.as_str();
    while let Some(at) = rest.find("href=\"fp:") {
      linked.push_str(&rest[..at]);
      let after = &rest[at + 9..];
      let end = after.find('"').unwrap_or(after.len());
      let target: usize = after[..end].parse().unwrap_or(0);
      let chapter = landed.get(&target).map(|part| chapter_of(*part)).unwrap_or(1);
      linked.push_str(&format!("href=\"chapter{chapter}.xhtml#fp{target}\""));
      rest = after.get(end + 1..).unwrap_or("");
    }
    linked.push_str(rest);
    chapter.body = linked;
  }
  out
}

/// Whether this Kindle book can be read here, from its header alone.
pub fn can_read(path: &Path) -> std::result::Result<(), NotRead> {
  use std::io::Read;
  let damaged = |error: std::io::Error| NotRead::Damaged(error.to_string());
  let mut file = std::fs::File::open(path).map_err(damaged)?;
  // The list of records and record 0 are at the front: 64 KB holds both for
  // any book (a list of eight thousand records is that long).
  let mut head = vec![0u8; 64 * 1024];
  let mut read = 0;
  while read < head.len() {
    match file.read(&mut head[read..]).map_err(damaged)? {
      0 => break,
      count => read += count
    }
  }
  head.truncate(read);
  if head.get(60..68) != Some(b"BOOKMOBI".as_slice()) {
    return Err(NotRead::Damaged("not a Kindle book".to_string()));
  }
  let start = be32(&head, 78).unwrap_or(0) as usize;
  let end = be32(&head, 86).map(|end| end as usize).unwrap_or(head.len()).min(head.len());
  let record = head.get(start..end).ok_or_else(|| NotRead::Damaged("the header lies outside the file".to_string()))?;
  header(record).map(|_| ())
}

/// The book as an EPUB to be written.
pub fn from_mobi(source: &Path, fallback_title: &str) -> std::result::Result<EpubBuilder, NotRead> {
  let damaged = |error: std::io::Error| NotRead::Damaged(error.to_string());
  if std::fs::metadata(source).map_err(damaged)?.len() > MAX_FILE_BYTES {
    return Err(NotRead::Damaged("the file is larger than a book".to_string()));
  }
  let file = std::fs::read(source).map_err(damaged)?;
  let records = records(&file)?;
  let header = header(records[0])?;
  let text = text_of(&records, &header)?;

  let info = crate::storage::mobi::info(source).ok();
  let title = info.as_ref().and_then(|info| info.title.clone()).unwrap_or_else(|| fallback_title.to_string());

  let mut images: Vec<Image> = Vec::new();
  let mut named: HashMap<usize, Option<String>> = HashMap::new();
  let picture = |number: usize| -> Option<String> {
    if let Some(known) = named.get(&number) {
      return known.clone();
    }
    // Pictures are counted from one, from the first picture's record.
    let record = header.first_image.and_then(|first| first.checked_add(number)?.checked_sub(1)).and_then(|index| records.get(index));
    let name = record.and_then(|bytes| {
      let (ending, mime) = image_kind(bytes)?;
      let name = format!("img{number}.{ending}");
      images.push(Image { name: name.clone(), mime: mime.to_string(), bytes: bytes.to_vec() });
      Some(name)
    });
    named.insert(number, name.clone());
    name
  };

  let chapters = chapters(&text, header.utf8, &title, picture);
  if chapters.is_empty() {
    return Err(NotRead::Damaged("the book has no text".to_string()));
  }
  let mut builder = EpubBuilder::new(title);
  builder.author = info.and_then(|info| info.authors.first().cloned());
  builder.chapters = chapters;
  builder.images = images;
  Ok(builder)
}

/// Writes the book as an EPUB at `target`.
pub fn to_epub(source: &Path, target: &Path, fallback_title: &str) -> std::result::Result<(), NotRead> {
  let builder = from_mobi(source, fallback_title)?;
  builder.write_to(target).map_err(|error| NotRead::Damaged(error.to_string()))
}

#[cfg(test)]
mod tests {
  use super::*;

  /// The text as PalmDOC would keep it, using only what needs no searching:
  /// plain bytes as themselves and the rest as runs to copy.
  fn deflate(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    for byte in text {
      if *byte == 0 || (0x09..=0x7f).contains(byte) {
        out.push(*byte);
      } else {
        out.extend_from_slice(&[1, *byte]);
      }
    }
    out
  }

  struct Made<'a> {
    text: &'a [u8],
    compression: u16,
    utf8: bool,
    images: Vec<Vec<u8>>,
    flags: u16,
    version: u32,
    locked: bool
  }

  impl<'a> Made<'a> {
    fn of(text: &'a [u8]) -> Self {
      Made { text, compression: 2, utf8: true, images: Vec::new(), flags: 0, version: 6, locked: false }
    }

    /// A Kindle file with this text and these pictures.
    fn file(&self) -> Vec<u8> {
      let mut texts: Vec<Vec<u8>> = Vec::new();
      for piece in self.text.chunks(4096) {
        let mut record = if self.compression == 2 { deflate(piece) } else { piece.to_vec() };
        // The extra bytes a real file ends its text records with.
        if self.flags & 1 != 0 {
          record.push(0);
        }
        if self.flags & 2 != 0 {
          record.extend_from_slice(&[0xaa, 0xbb, 0x83]);
        }
        texts.push(record);
      }
      let name = b"A Made Book";
      let mut zero = vec![0u8; 16 + 0xe8];
      zero[0..2].copy_from_slice(&self.compression.to_be_bytes());
      zero[4..8].copy_from_slice(&(self.text.len() as u32).to_be_bytes());
      zero[8..10].copy_from_slice(&(texts.len() as u16).to_be_bytes());
      zero[10..12].copy_from_slice(&4096u16.to_be_bytes());
      zero[12..14].copy_from_slice(&(if self.locked { 2u16 } else { 0 }).to_be_bytes());
      zero[16..20].copy_from_slice(b"MOBI");
      zero[20..24].copy_from_slice(&0xe8u32.to_be_bytes());
      zero[28..32].copy_from_slice(&(if self.utf8 { 65001u32 } else { 1252 }).to_be_bytes());
      zero[36..40].copy_from_slice(&self.version.to_be_bytes());
      zero[84..88].copy_from_slice(&((16 + 0xe8) as u32).to_be_bytes());
      zero[88..92].copy_from_slice(&(name.len() as u32).to_be_bytes());
      let first_image = if self.images.is_empty() { u32::MAX } else { texts.len() as u32 + 1 };
      zero[108..112].copy_from_slice(&first_image.to_be_bytes());
      zero[0xf2..0xf4].copy_from_slice(&self.flags.to_be_bytes());
      zero.extend_from_slice(name);

      let mut all: Vec<Vec<u8>> = vec![zero];
      all.extend(texts);
      all.extend(self.images.iter().cloned());
      let mut file = vec![0u8; 78];
      file[60..68].copy_from_slice(b"BOOKMOBI");
      file[76..78].copy_from_slice(&(all.len() as u16).to_be_bytes());
      let mut at = 78 + all.len() * 8 + 2;
      for record in &all {
        file.extend_from_slice(&(at as u32).to_be_bytes());
        file.extend_from_slice(&[0, 0, 0, 0]);
        at += record.len();
      }
      file.extend_from_slice(&[0, 0]);
      for record in &all {
        file.extend_from_slice(record);
      }
      file
    }

    fn written(&self, name: &str) -> std::path::PathBuf {
      let dir = std::env::temp_dir().join(format!("leaflet-mobi-test-{}", std::process::id()));
      std::fs::create_dir_all(&dir).expect("dir");
      let path = dir.join(name);
      std::fs::write(&path, self.file()).expect("write");
      path
    }
  }

  /// Whether a chapter is XML the reader will open: every tag closed, in order.
  fn well_formed(body: &str) -> bool {
    let page = format!("<body>{body}</body>");
    let mut reader = quick_xml::Reader::from_str(&page);
    loop {
      match reader.read_event() {
        Ok(quick_xml::events::Event::Eof) => return true,
        Ok(_) => {}
        Err(_) => return false
      }
    }
  }

  const PNG: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1];

  /// A small book as a Kindle keeps one: a title page, a contents page whose
  /// links say where the chapters start, two chapters, and a picture.
  fn small_book() -> Vec<u8> {
    let page = "<html><head><guide><reference type=\"toc\" title=\"Contents\" filepos=CCCCCCCCCC /></guide></head><body>\
      <p align=\"center\">A Title Page</p><mbp:pagebreak/>\
      <p><b>Contents</b></p><p><a filepos=AAAAAAAAAA>The First</a><br><a filepos=BBBBBBBBBB >The Second &amp; Last</a></p><mbp:pagebreak/>\
      <h2>ONE</h2><p>Hello &nbsp;caf&eacute; <i>unclosed<p>next <img recindex=\"00001\" align=baseline> x < y</p><mbp:pagebreak/>\
      <h2>TWO</h2><p>Back to <a filepos=AAAAAAAAAA>one</a>.<script>evil()</script></p></body></html>";
    let at = |what: &str| format!("{:010}", page.find(what).expect(what));
    page
      .replace("CCCCCCCCCC", &at("<p><b>Contents"))
      .replace("AAAAAAAAAA", &at("<h2>ONE"))
      .replace("BBBBBBBBBB", &at("<h2>TWO"))
      .into_bytes()
  }

  #[test]
  fn the_compression_is_undone() {
    let mut out = Vec::new();
    // Three letters, then "the six bytes that start three back", then a space
    // and a letter in one byte, then two bytes copied as they are.
    inflate(&[b'a', b'b', b'c', 0x80, 0x1b, 0xe1, 0x02, 0xc3, 0xa9], &mut out);
    assert_eq!(out, "abcabcabc a\u{e9}".as_bytes());
    // A reference to before the record's own text is left out, not followed.
    let mut out = b"earlier".to_vec();
    inflate(&[b'x', 0x80, 0x1b, b'y'], &mut out);
    assert_eq!(out, b"earlierxy");
    // A record cut off in the middle of a pair or a run.
    let mut out = Vec::new();
    inflate(&[b'a', 0x80], &mut out);
    inflate(&[0x05, b'b'], &mut out);
    assert_eq!(out, b"ab");
  }

  #[test]
  fn the_bytes_that_end_a_text_record_are_not_text() {
    // A letter's bytes cut by the record's end (one byte), then an entry of three.
    let record = [b't', b'e', b'x', b't', 0x00, 0xaa, 0xbb, 0x83];
    assert_eq!(trailing_bytes(&record, 3), 4);
    assert_eq!(trailing_bytes(&record, 2), 3);
    assert_eq!(trailing_bytes(&record, 0), 0);
    // Flags that claim more than the record holds take all of it and no more.
    assert_eq!(trailing_bytes(&[0xff, 0xff], 0xfffe), 2);
    assert_eq!(trailing_bytes(&[], 3), 0);
  }

  #[test]
  fn a_kindle_book_becomes_chapters_the_reader_can_open() {
    let text = small_book();
    for (compression, flags) in [(2u16, 0u16), (1, 0), (2, 3)] {
      let path = Made { compression, flags, images: vec![PNG.to_vec()], ..Made::of(&text) }.written(&format!("small-{compression}-{flags}.mobi"));
      let book = from_mobi(&path, "The File's Name").expect("read");
      assert_eq!(book.title, "A Made Book");
      let titles: Vec<&str> = book.chapters.iter().map(|chapter| chapter.title.as_str()).collect();
      // The contents page names the chapters; the pages before them are in the book and not the list.
      assert_eq!(titles, vec!["A Made Book", "", "The First", "The Second & Last"]);
      assert!(book.chapters.iter().all(|chapter| well_formed(&chapter.body)), "{:?}", book.chapters.iter().map(|chapter| &chapter.body).collect::<Vec<_>>());

      assert_eq!(book.chapters[0].body.trim(), "<p style=\"text-align:center\">A Title Page</p>");
      let contents = &book.chapters[1].body;
      let one = text.windows(7).position(|w| w == b"<h2>ONE").expect("one");
      let two = text.windows(7).position(|w| w == b"<h2>TWO").expect("two");
      assert!(contents.contains(&format!("<a href=\"chapter3.xhtml#fp{one}\">The First</a><br/>")), "{contents}");
      assert!(contents.contains(&format!("<a href=\"chapter4.xhtml#fp{two}\">The Second &amp; Last</a>")), "{contents}");

      let first = &book.chapters[2].body;
      assert!(first.trim_start().starts_with(&format!("<a id=\"fp{one}\"></a><h2>ONE</h2>")), "{first}");
      assert!(first.contains("<p>Hello \u{a0}caf\u{e9} <i>unclosed</i></p><p>next <img src=\"../images/img1.png\" alt=\"\"/> x &lt; y</p>"), "{first}");
      let second = &book.chapters[3].body;
      assert!(second.contains(&format!("Back to <a href=\"chapter3.xhtml#fp{one}\">one</a>.")), "{second}");
      assert!(!second.contains("evil"));

      assert_eq!(book.images.iter().map(|image| (image.name.as_str(), image.mime.as_str())).collect::<Vec<_>>(), vec![("img1.png", "image/png")]);
      let _ = std::fs::remove_file(&path);
    }
  }

  #[test]
  fn a_book_in_windows_letters_is_read_as_one() {
    let text = b"<p>\x93Caf\xe9\x94 \x97 it\x92s</p>";
    let path = Made { utf8: false, ..Made::of(text) }.written("windows.prc");
    let book = from_mobi(&path, "x").expect("read");
    assert_eq!(book.chapters[0].body, "<p>\u{201c}Caf\u{e9}\u{201d} \u{2014} it\u{2019}s</p>");
    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn a_long_book_with_no_page_breaks_is_cut_into_pieces_between_paragraphs() {
    let mut text = String::from("<html><body><h1>The Only Heading</h1>");
    for number in 0..700 {
      text.push_str(&format!("<p>Paragraph {number} marker. {}</p>\n", "words and more words ".repeat(40)));
    }
    text.push_str("</body></html>");
    let path = Made::of(text.as_bytes()).written("long.mobi");
    let book = from_mobi(&path, "x").expect("read");
    assert!(book.chapters.len() >= 3, "{} pieces", book.chapters.len());
    assert!(book.chapters.iter().all(|chapter| well_formed(&chapter.body) && chapter.body.len() < 2 * SPLIT_AT_BYTES));
    // Nothing lost between the pieces, and only the first is in the contents list.
    assert_eq!(book.chapters.iter().map(|chapter| chapter.body.matches(" marker.").count()).sum::<usize>(), 700);
    assert_eq!(book.chapters[0].title, "The Only Heading");
    assert!(book.chapters[1..].iter().all(|chapter| chapter.title.is_empty()));
    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn what_is_not_read_here_says_which_kind_it_is() {
    let text = b"<p>x</p>";
    let locked = Made { locked: true, ..Made::of(text) }.written("locked.mobi");
    assert_eq!(can_read(&locked), Err(NotRead::Locked));
    assert!(matches!(from_mobi(&locked, "x"), Err(NotRead::Locked)));

    let newer = Made { version: 8, ..Made::of(text) }.written("newer.azw3");
    assert!(matches!(can_read(&newer), Err(NotRead::OtherKind(_))));
    let huffman = Made { compression: 17480, ..Made::of(text) }.written("huffman.mobi");
    assert!(matches!(can_read(&huffman), Err(NotRead::OtherKind(_))));

    let readable = Made::of(text).written("readable.mobi");
    assert_eq!(can_read(&readable), Ok(()));

    let dir = readable.parent().expect("dir").to_path_buf();
    std::fs::write(dir.join("not-one.mobi"), b"just some words in a file with the ending of a Kindle book").expect("write");
    assert!(matches!(can_read(&dir.join("not-one.mobi")), Err(NotRead::Damaged(_))));
    assert!(matches!(from_mobi(&dir.join("not-one.mobi"), "x"), Err(NotRead::Damaged(_))));
    assert!(matches!(can_read(&dir.join("is-not-there.mobi")), Err(NotRead::Damaged(_))));
    // A file that ends in the middle of its records: an answer either way, never a panic.
    let mut cut = Made::of(text).file();
    cut.truncate(cut.len() - 6);
    std::fs::write(dir.join("cut.mobi"), &cut).expect("write");
    let _ = from_mobi(&dir.join("cut.mobi"), "x");
    for name in ["locked.mobi", "newer.azw3", "huffman.mobi", "readable.mobi", "not-one.mobi", "cut.mobi"] {
      let _ = std::fs::remove_file(dir.join(name));
    }
  }

  #[test]
  fn the_book_is_written_as_an_epub_with_only_named_chapters_in_its_list() {
    let text = small_book();
    let source = Made { images: vec![PNG.to_vec()], ..Made::of(&text) }.written("to-epub.mobi");
    let target = source.with_extension("epub");
    to_epub(&source, &target, "x").expect("epub");
    let mut archive = zip::ZipArchive::new(std::fs::File::open(&target).expect("open")).expect("zip");
    let mut read = |name: &str| {
      use std::io::Read;
      let mut text = String::new();
      archive.by_name(name).expect(name).read_to_string(&mut text).expect("read");
      text
    };
    let nav = read("OEBPS/nav.xhtml");
    assert!(nav.contains("chapter1.xhtml") && nav.contains("chapter3.xhtml") && nav.contains("The Second &amp; Last"));
    assert!(!nav.contains("chapter2.xhtml"), "an unnamed page is not in the list");
    let package = read("OEBPS/content.opf");
    assert!(package.contains("text/chapter2.xhtml") && package.contains("images/img1.png"), "and is in the book");
    assert!(read("OEBPS/text/chapter3.xhtml").contains("<h2>ONE</h2>"));
    let _ = std::fs::remove_file(&source);
    let _ = std::fs::remove_file(&target);
  }
}

/// What reading the Kindle books of a real library comes to: numbers only,
/// never a title or a word of the text.
/// `cargo test --lib convert::mobi::probe -- --ignored --nocapture`
#[cfg(test)]
mod probe {
  use super::*;

  #[test]
  #[ignore = "reads the Kindle books in D:\\Books; run by hand with --ignored --nocapture"]
  fn real_kindle_books_are_read() {
    let library = Path::new("D:\\Books");
    let Ok(entries) = std::fs::read_dir(library) else {
      eprintln!("no library here: nothing to look at");
      return;
    };
    let mut seen = 0;
    for path in entries.flatten().map(|entry| entry.path()) {
      let ending = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_lowercase();
      if !matches!(ending.as_str(), "mobi" | "azw" | "azw3" | "prc") {
        continue;
      }
      seen += 1;
      let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
      let started = std::time::Instant::now();
      match from_mobi(&path, "x") {
        Err(why) => println!("book {seen} (.{ending}, {size} bytes): not read here: {:?}", match why {
          NotRead::Damaged(_) => "damaged".to_string(),
          other => format!("{other:?}")
        }),
        Ok(book) => {
          let took = started.elapsed();
          let bodies: usize = book.chapters.iter().map(|chapter| chapter.body.len()).sum();
          let broken = book
            .chapters
            .iter()
            .filter(|chapter| {
              let page = format!("<body>{}</body>", chapter.body);
              let mut reader = quick_xml::Reader::from_str(&page);
              loop {
                match reader.read_event() {
                  Ok(quick_xml::events::Event::Eof) => break false,
                  Ok(_) => {}
                  Err(_) => break true
                }
              }
            })
            .count();
          let links: usize = book.chapters.iter().map(|chapter| chapter.body.matches("href=\"chapter").count()).sum();
          let dangling: usize = book.chapters.iter().map(|chapter| chapter.body.matches("href=\"fp:").count()).sum();
          let largest = book.chapters.iter().map(|chapter| chapter.body.len()).max().unwrap_or(0);
          println!(
            "book {seen} (.{ending}, {size} bytes): {} chapters ({} named), {} pictures, {bodies} bytes of text, largest chapter {largest}, {links} links ({dangling} left unplaced), {broken} chapters not well formed, {took:?}",
            book.chapters.len(),
            book.chapters.iter().filter(|chapter| !chapter.title.is_empty()).count(),
            book.images.len()
          );
          // Kept when a place for it is named (to open it in the reader by hand).
          let keep = std::env::var_os("LEAFLET_MOBI_PROBE_OUT").map(std::path::PathBuf::from);
          let target = keep.clone().unwrap_or_else(|| std::env::temp_dir().join(format!("leaflet-mobi-probe-{}-{seen}.epub", std::process::id())));
          let wrote = book.write_to(&target).is_ok();
          println!("  as an EPUB: written {wrote}, {} bytes", std::fs::metadata(&target).map(|meta| meta.len()).unwrap_or(0));
          if keep.is_none() {
            let _ = std::fs::remove_file(&target);
          }
        }
      }
    }
    println!("{seen} Kindle books looked at");
  }
}
