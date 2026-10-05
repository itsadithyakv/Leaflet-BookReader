//! What a PDF says it is called: the Title and Author of its Info dictionary,
//! or, where that is empty, of its XMP metadata.
//!
//! Nothing in a PDF used to be read at import, so a PDF came in under its
//! file's name ("The J Curve A New Way to Understand ..." for a book whose own
//! title has the colon the name lost). This is a small reader for that one
//! purpose, not a PDF parser: it follows the cross-reference tables from the
//! end of the file (the classic kind, the compressed kind of PDF 1.5, and a
//! chain of updates), finds the Info object, wherever it is kept, and reads
//! two strings out of it. A few kilobytes of the file are read, never the
//! whole of it. A file it cannot follow (damaged tables, encryption, a filter
//! it does not know) has no title as far as import is concerned: every failure
//! is an empty answer, and nothing here can panic on a bad file.
//!
//! What it finds is the word of whatever program made the file, which is as
//! often "Microsoft Word - draft3.doc" as a title. Whether to believe it is
//! `metadata::normalize`'s business.

use anyhow::{anyhow, bail, Result};
use flate2::read::ZlibDecoder;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Default, PartialEq)]
pub struct Info {
  pub title: Option<String>,
  pub author: Option<String>
}

/// A dictionary is a few hundred bytes; an object this large is not one.
const MAX_OBJECT_BYTES: usize = 4 * 1024 * 1024;
/// A cross-reference stream for a million objects is a few megabytes.
const MAX_STREAM_BYTES: usize = 32 * 1024 * 1024;
/// How many earlier versions of a file's tables are followed.
const MAX_UPDATES: usize = 32;
const MAX_DEPTH: usize = 24;

type Dict = Vec<(String, Value)>;

#[derive(Debug, Clone, PartialEq)]
enum Value {
  Int(i64),
  /// A reference to another object, by its number.
  Ref(u32),
  /// A string, as bytes: its encoding is its reader's to work out.
  Text(Vec<u8>),
  Name(String),
  List(Vec<Value>),
  Dict(Dict),
  /// A real number, a boolean, null: nothing read here.
  Other
}

fn get<'a>(dict: &'a Dict, key: &str) -> Option<&'a Value> {
  dict.iter().find(|(name, _)| name == key).map(|(_, value)| value)
}

fn int(dict: &Dict, key: &str) -> Option<i64> {
  match get(dict, key) {
    Some(Value::Int(value)) => Some(*value),
    _ => None
  }
}

fn reference(dict: &Dict, key: &str) -> Option<u32> {
  match get(dict, key) {
    Some(Value::Ref(number)) => Some(*number),
    _ => None
  }
}

fn is_space(byte: u8) -> bool {
  matches!(byte, 0 | 9 | 10 | 12 | 13 | 32)
}

fn is_delimiter(byte: u8) -> bool {
  matches!(byte, b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%')
}

/// Reads PDF syntax out of a run of bytes.
struct Scan<'a> {
  bytes: &'a [u8],
  at: usize
}

impl<'a> Scan<'a> {
  fn new(bytes: &'a [u8], at: usize) -> Self {
    Scan { bytes, at }
  }

  fn peek(&self) -> Option<u8> {
    self.bytes.get(self.at).copied()
  }

  fn starts_with(&self, word: &[u8]) -> bool {
    self.bytes.get(self.at..).is_some_and(|rest| rest.starts_with(word))
  }

  /// Past white space and comments.
  fn skip_space(&mut self) {
    while let Some(byte) = self.peek() {
      if is_space(byte) {
        self.at += 1;
      } else if byte == b'%' {
        while self.peek().is_some_and(|byte| byte != b'\n' && byte != b'\r') {
          self.at += 1;
        }
      } else {
        break;
      }
    }
  }

  /// A run of ordinary characters: a number or a keyword.
  fn word(&mut self) -> &'a [u8] {
    let start = self.at;
    while self.peek().is_some_and(|byte| !is_space(byte) && !is_delimiter(byte)) {
      self.at += 1;
    }
    &self.bytes[start..self.at]
  }

  fn integer(&mut self) -> Option<i64> {
    self.skip_space();
    let start = self.at;
    let word = self.word();
    let parsed = std::str::from_utf8(word).ok().and_then(|text| text.parse::<i64>().ok());
    if parsed.is_none() {
      self.at = start;
    }
    parsed
  }

  fn keyword(&mut self, word: &[u8]) -> bool {
    self.skip_space();
    if self.starts_with(word) {
      self.at += word.len();
      true
    } else {
      false
    }
  }

  /// `(a string)`, with its escapes undone and its own brackets kept.
  fn literal(&mut self) -> Option<Vec<u8>> {
    self.at += 1;
    let mut out = Vec::new();
    let mut depth = 1usize;
    loop {
      let byte = self.peek()?;
      self.at += 1;
      match byte {
        b'(' => {
          depth += 1;
          out.push(byte);
        }
        b')' => {
          depth -= 1;
          if depth == 0 {
            return Some(out);
          }
          out.push(byte);
        }
        b'\\' => {
          let escaped = self.peek()?;
          self.at += 1;
          match escaped {
            b'n' => out.push(b'\n'),
            b'r' => out.push(b'\r'),
            b't' => out.push(b'\t'),
            b'b' => out.push(8),
            b'f' => out.push(12),
            b'0'..=b'7' => {
              let mut code = u32::from(escaped - b'0');
              for _ in 0..2 {
                match self.peek() {
                  Some(digit @ b'0'..=b'7') => {
                    code = code * 8 + u32::from(digit - b'0');
                    self.at += 1;
                  }
                  _ => break
                }
              }
              out.push((code & 0xFF) as u8);
            }
            // A backslash at the end of a line carries the string on.
            b'\r' => {
              if self.peek() == Some(b'\n') {
                self.at += 1;
              }
            }
            b'\n' => {}
            other => out.push(other)
          }
        }
        other => out.push(other)
      }
      if out.len() > MAX_OBJECT_BYTES {
        return None;
      }
    }
  }

  /// `<48656C6C6F>`.
  fn hex(&mut self) -> Option<Vec<u8>> {
    self.at += 1;
    let mut digits = Vec::new();
    loop {
      let byte = self.peek()?;
      self.at += 1;
      match byte {
        b'>' => break,
        _ if is_space(byte) => {}
        _ => digits.push((byte as char).to_digit(16)? as u8)
      }
    }
    if digits.len() % 2 == 1 {
      digits.push(0);
    }
    Some(digits.chunks(2).map(|pair| pair[0] * 16 + pair[1]).collect())
  }

  fn name(&mut self) -> Option<String> {
    if self.peek() != Some(b'/') {
      return None;
    }
    self.at += 1;
    let raw = self.word();
    let mut out = Vec::with_capacity(raw.len());
    let mut at = 0;
    while at < raw.len() {
      // `#20` is a character by its code.
      let coded = (raw[at] == b'#')
        .then(|| raw.get(at + 1..at + 3))
        .flatten()
        .and_then(|pair| std::str::from_utf8(pair).ok())
        .and_then(|pair| u8::from_str_radix(pair, 16).ok());
      match coded {
        Some(byte) => {
          out.push(byte);
          at += 3;
        }
        None => {
          out.push(raw[at]);
          at += 1;
        }
      }
    }
    Some(String::from_utf8_lossy(&out).into_owned())
  }

  /// One object: `None` for anything that is not PDF, or runs off the end.
  fn value(&mut self, depth: usize) -> Option<Value> {
    if depth > MAX_DEPTH {
      return None;
    }
    self.skip_space();
    match self.peek()? {
      b'<' if self.starts_with(b"<<") => {
        self.at += 2;
        let mut dict = Dict::new();
        loop {
          self.skip_space();
          if self.starts_with(b">>") {
            self.at += 2;
            return Some(Value::Dict(dict));
          }
          let key = self.name()?;
          let value = self.value(depth + 1)?;
          dict.push((key, value));
        }
      }
      b'<' => self.hex().map(Value::Text),
      b'(' => self.literal().map(Value::Text),
      b'/' => self.name().map(Value::Name),
      b'[' => {
        self.at += 1;
        let mut list = Vec::new();
        loop {
          self.skip_space();
          if self.peek()? == b']' {
            self.at += 1;
            return Some(Value::List(list));
          }
          list.push(self.value(depth + 1)?);
        }
      }
      b'0'..=b'9' | b'+' | b'-' | b'.' => {
        let Some(number) = self.integer() else {
          // A real number.
          return (!self.word().is_empty()).then_some(Value::Other);
        };
        // "12 0 R" is a reference; "12 0" are two numbers.
        let after = self.at;
        let generation = self.integer();
        self.skip_space();
        let referred = generation.is_some() && self.peek() == Some(b'R') && self.bytes.get(self.at + 1).map_or(true, |next| is_space(*next) || is_delimiter(*next));
        if referred {
          self.at += 1;
          return u32::try_from(number).ok().map(Value::Ref);
        }
        self.at = after;
        Some(Value::Int(number))
      }
      _ => (!self.word().is_empty()).then_some(Value::Other)
    }
  }
}

/// One table of where objects are.
enum Section {
  /// The classic kind: twenty bytes an object, read when one is asked for.
  Table { entries_at: u64, first: u32, count: u32 },
  /// The compressed kind, unpacked: rows of three fields of these widths.
  Rows { data: Vec<u8>, widths: [usize; 3], index: Vec<(u32, u32)> }
}

enum Place {
  At(u64),
  /// Packed with others inside an object stream.
  Within { stream: u32, nth: usize }
}

struct Pdf {
  file: File,
  len: u64,
  /// Newest first.
  sections: Vec<Section>,
  trailers: Vec<Dict>
}

/// Undoes the PNG row filters a cross-reference stream is packed with.
fn unfilter(data: &[u8], columns: usize) -> Option<Vec<u8>> {
  if columns == 0 || columns > 64 {
    return None;
  }
  let mut out: Vec<u8> = Vec::with_capacity(data.len());
  let mut before = vec![0u8; columns];
  for row in data.chunks(columns + 1) {
    if row.len() < 2 {
      break;
    }
    let (kind, row) = (row[0], &row[1..]);
    let mut now = vec![0u8; columns];
    for (at, byte) in row.iter().enumerate() {
      let left = if at > 0 { now[at - 1] } else { 0 };
      let up = before[at];
      let up_left = if at > 0 { before[at - 1] } else { 0 };
      let predicted = match kind {
        0 => 0,
        1 => left,
        2 => up,
        3 => ((u16::from(left) + u16::from(up)) / 2) as u8,
        4 => {
          let (a, b, c) = (i16::from(left), i16::from(up), i16::from(up_left));
          let p = a + b - c;
          let (pa, pb, pc) = ((p - a).abs(), (p - b).abs(), (p - c).abs());
          if pa <= pb && pa <= pc {
            left
          } else if pb <= pc {
            up
          } else {
            up_left
          }
        }
        _ => return None
      };
      now[at] = byte.wrapping_add(predicted);
    }
    out.extend_from_slice(&now[..row.len().min(columns)]);
    before = now;
  }
  Some(out)
}

/// A stream's bytes as they were before its filter: no filter, or Flate.
fn decode_stream(dict: &Dict, raw: &[u8]) -> Option<Vec<u8>> {
  let flate = |name: &Value| matches!(name, Value::Name(name) if name == "FlateDecode" || name == "Fl");
  let data = match get(dict, "Filter") {
    None => raw.to_vec(),
    Some(name) if flate(name) => inflate(raw)?,
    Some(Value::List(names)) if names.is_empty() => raw.to_vec(),
    Some(Value::List(names)) if names.len() == 1 && flate(&names[0]) => inflate(raw)?,
    _ => return None
  };
  let parms = match get(dict, "DecodeParms") {
    Some(Value::Dict(parms)) => Some(parms),
    Some(Value::List(list)) => list.iter().find_map(|item| match item {
      Value::Dict(parms) => Some(parms),
      _ => None
    }),
    _ => None
  };
  match parms.and_then(|parms| int(parms, "Predictor")).unwrap_or(1) {
    1 => Some(data),
    10..=15 => unfilter(&data, usize::try_from(parms.and_then(|parms| int(parms, "Columns")).unwrap_or(1)).ok()?),
    _ => None
  }
}

fn inflate(raw: &[u8]) -> Option<Vec<u8>> {
  let mut out = Vec::new();
  // What was read before an error counts: writers leave a ragged end.
  let _ = ZlibDecoder::new(raw).take(MAX_STREAM_BYTES as u64).read_to_end(&mut out);
  (!out.is_empty()).then_some(out)
}

impl Pdf {
  fn open(path: &Path) -> Result<Pdf> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let mut head = Vec::with_capacity(1024);
    (&mut file).take(1024).read_to_end(&mut head)?;
    if !head.windows(5).any(|bytes| bytes == b"%PDF-") {
      bail!("not a PDF");
    }
    Ok(Pdf { file, len, sections: Vec::new(), trailers: Vec::new() })
  }

  /// Up to `len` bytes from `at`; fewer at the end of the file.
  fn read_at(&mut self, at: u64, len: usize) -> Result<Vec<u8>> {
    if at >= self.len {
      bail!("past the end of the file");
    }
    let len = len.min(usize::try_from(self.len - at).unwrap_or(usize::MAX));
    self.file.seek(SeekFrom::Start(at))?;
    let mut bytes = vec![0u8; len];
    self.file.read_exact(&mut bytes)?;
    Ok(bytes)
  }

  /// The object written at an offset: `12 0 obj ... endobj`, with the bytes of
  /// its stream if it has one.
  fn object_at(&mut self, at: u64, depth: usize) -> Option<(u32, Value, Option<Vec<u8>>)> {
    for size in [16 * 1024, 256 * 1024, MAX_OBJECT_BYTES] {
      let bytes = self.read_at(at, size).ok()?;
      let whole = bytes.len() < size;
      let mut scan = Scan::new(&bytes, 0);
      let number = scan.integer().and_then(|number| u32::try_from(number).ok())?;
      scan.integer()?;
      if !scan.keyword(b"obj") {
        return None;
      }
      let Some(value) = scan.value(0) else {
        if whole {
          return None;
        }
        // It ran off the end of what was read: read more.
        continue;
      };
      scan.skip_space();
      if !scan.starts_with(b"stream") {
        return Some((number, value, None));
      }
      let Value::Dict(dict) = &value else {
        return None;
      };
      let mut start = scan.at + b"stream".len();
      if bytes.get(start) == Some(&b'\r') {
        start += 1;
      }
      if bytes.get(start) == Some(&b'\n') {
        start += 1;
      }
      let length = match get(dict, "Length") {
        Some(Value::Int(length)) => usize::try_from(*length).ok(),
        // Written elsewhere in the file.
        Some(Value::Ref(elsewhere)) if depth < 4 => match self.object(*elsewhere, depth + 1) {
          Some(Value::Int(length)) => usize::try_from(length).ok(),
          _ => None
        },
        _ => None
      }?;
      if length > MAX_STREAM_BYTES {
        return None;
      }
      let raw = self.read_at(at + start as u64, length).ok()?;
      return Some((number, value, Some(raw)));
    }
    None
  }

  /// A compressed cross-reference table at an offset, and the dictionary that
  /// is its trailer.
  fn read_rows(&mut self, at: u64) -> Option<Dict> {
    let (_, value, raw) = self.object_at(at, 0)?;
    let Value::Dict(dict) = value else {
      return None;
    };
    let data = decode_stream(&dict, &raw?)?;
    let widths: Vec<usize> = match get(&dict, "W") {
      Some(Value::List(list)) => list
        .iter()
        .map(|width| match width {
          Value::Int(width) if (0..=8).contains(width) => Some(*width as usize),
          _ => None
        })
        .collect::<Option<Vec<_>>>()?,
      _ => return None
    };
    if widths.len() != 3 || widths.iter().sum::<usize>() == 0 {
      return None;
    }
    let numbers: Vec<u32> = match get(&dict, "Index") {
      Some(Value::List(list)) => list
        .iter()
        .map(|item| match item {
          Value::Int(number) => u32::try_from(*number).ok(),
          _ => None
        })
        .collect::<Option<Vec<_>>>()?,
      _ => vec![0, u32::try_from(int(&dict, "Size")?).ok()?]
    };
    let index = numbers.chunks_exact(2).map(|pair| (pair[0], pair[1])).collect();
    self.sections.push(Section::Rows { data, widths: [widths[0], widths[1], widths[2]], index });
    Some(dict)
  }

  /// A classic table at an offset (`xref`, runs of entries, `trailer`), and
  /// its trailer.
  fn read_table(&mut self, at: u64) -> Option<Dict> {
    let mut at = at + 4;
    // A table is in runs: "first count", then that many entries.
    for _ in 0..4096 {
      let bytes = self.read_at(at, 64).ok()?;
      let mut scan = Scan::new(&bytes, 0);
      scan.skip_space();
      if scan.starts_with(b"trailer") {
        at += scan.at as u64;
        break;
      }
      let first = u32::try_from(scan.integer()?).ok()?;
      let count = u32::try_from(scan.integer()?).ok()?;
      // The entries begin on the next line.
      while scan.peek().is_some_and(|byte| byte == b' ') {
        scan.at += 1;
      }
      if scan.peek() == Some(b'\r') {
        scan.at += 1;
      }
      if scan.peek() == Some(b'\n') {
        scan.at += 1;
      }
      let entries_at = at + scan.at as u64;
      self.sections.push(Section::Table { entries_at, first, count });
      at = entries_at + 20 * u64::from(count);
    }
    for size in [16 * 1024, 256 * 1024] {
      let bytes = self.read_at(at, size).ok()?;
      let mut scan = Scan::new(&bytes, 0);
      if !scan.keyword(b"trailer") {
        return None;
      }
      if let Some(Value::Dict(dict)) = scan.value(0) {
        return Some(dict);
      }
    }
    None
  }

  /// Follows the tables from the end of the file back through its updates.
  fn load(&mut self) -> Result<()> {
    let tail_at = self.len.saturating_sub(2048);
    let tail = self.read_at(tail_at, 2048)?;
    let marker = tail.windows(9).rposition(|bytes| bytes == b"startxref").ok_or_else(|| anyhow!("no cross-reference table"))?;
    let mut next = Scan::new(&tail, marker + 9).integer().and_then(|at| u64::try_from(at).ok());
    let mut seen: Vec<u64> = Vec::new();
    while let Some(at) = next.take() {
      if seen.contains(&at) || seen.len() >= MAX_UPDATES {
        break;
      }
      seen.push(at);
      let Ok(head) = self.read_at(at, 16) else {
        break;
      };
      let mut scan = Scan::new(&head, 0);
      scan.skip_space();
      let classic = scan.starts_with(b"xref");
      let trailer = if classic { self.read_table(at + scan.at as u64) } else { self.read_rows(at) };
      let Some(trailer) = trailer else {
        break;
      };
      // A file written both ways keeps its compressed objects in a second table.
      if classic {
        if let Some(extra) = int(&trailer, "XRefStm").and_then(|at| u64::try_from(at).ok()) {
          let _ = self.read_rows(extra);
        }
      }
      next = int(&trailer, "Prev").and_then(|at| u64::try_from(at).ok());
      self.trailers.push(trailer);
    }
    if self.trailers.is_empty() {
      bail!("the cross-reference table cannot be followed");
    }
    Ok(())
  }

  fn place(&mut self, number: u32) -> Option<Place> {
    for at in 0..self.sections.len() {
      match &self.sections[at] {
        Section::Table { entries_at, first, count } => {
          if number < *first || number - *first >= *count {
            continue;
          }
          let entry_at = *entries_at + 20 * u64::from(number - *first);
          let entry = self.read_at(entry_at, 20).ok()?;
          let offset = std::str::from_utf8(entry.get(..10)?).ok()?.trim().parse::<u64>().ok()?;
          // "n" is in use; "f" was freed, by this or a later version.
          return (entry.get(17) == Some(&b'n')).then_some(Place::At(offset));
        }
        Section::Rows { data, widths, index } => {
          let mut row = 0usize;
          for (first, count) in index {
            if number >= *first && number - *first < *count {
              let size: usize = widths.iter().sum();
              let start = (row + (number - *first) as usize).checked_mul(size)?;
              let fields = data.get(start..start + size)?;
              let field = |from: usize, width: usize| fields[from..from + width].iter().fold(0u64, |value, byte| (value << 8) | u64::from(*byte));
              // With no width for the kind, every entry is an object in the file.
              let kind = if widths[0] == 0 { 1 } else { field(0, widths[0]) };
              let (second, third) = (field(widths[0], widths[1]), field(widths[0] + widths[1], widths[2]));
              return match kind {
                1 => Some(Place::At(second)),
                2 => Some(Place::Within { stream: u32::try_from(second).ok()?, nth: usize::try_from(third).ok()? }),
                _ => None
              };
            }
            row += *count as usize;
          }
        }
      }
    }
    None
  }

  /// An object by its number, wherever it is kept.
  fn object(&mut self, number: u32, depth: usize) -> Option<Value> {
    match self.place(number)? {
      Place::At(at) => {
        let (found, value, _) = self.object_at(at, depth)?;
        (found == number).then_some(value)
      }
      Place::Within { stream, nth } => {
        let Place::At(at) = self.place(stream)? else {
          return None;
        };
        let (_, value, raw) = self.object_at(at, depth)?;
        let Value::Dict(dict) = value else {
          return None;
        };
        let data = decode_stream(&dict, &raw?)?;
        let count = usize::try_from(int(&dict, "N")?).ok()?.min(100_000);
        let first = usize::try_from(int(&dict, "First")?).ok()?;
        // Its head lists each object's number and where it starts.
        let mut head = Scan::new(data.get(..first.min(data.len()))?, 0);
        let mut starts: Vec<(i64, i64)> = Vec::with_capacity(count.min(1024));
        for _ in 0..count {
          match (head.integer(), head.integer()) {
            (Some(found), Some(offset)) => starts.push((found, offset)),
            _ => break
          }
        }
        let (_, offset) = starts
          .get(nth)
          .filter(|(found, _)| *found == i64::from(number))
          .or_else(|| starts.iter().find(|(found, _)| *found == i64::from(number)))?;
        Scan::new(&data, first.checked_add(usize::try_from(*offset).ok()?)?).value(0)
      }
    }
  }

  /// The decoded stream of an object kept in the file itself.
  fn stream(&mut self, number: u32) -> Option<Vec<u8>> {
    let Place::At(at) = self.place(number)? else {
      return None;
    };
    let (_, value, raw) = self.object_at(at, 0)?;
    match value {
      Value::Dict(dict) => decode_stream(&dict, &raw?),
      _ => None
    }
  }
}

/// PDFDocEncoding where it parts from Latin-1: 0x80 to 0xA0.
const DOC_ENCODING: [char; 33] = [
  '•', '†', '‡', '…', '—', '–', 'ƒ', '⁄', '‹', '›', '−', '‰', '„', '“', '”', '‘', '’', '‚', '™', 'ﬁ', 'ﬂ', 'Ł', 'Œ', 'Š', 'Ÿ', 'Ž', 'ı',
  'ł', 'œ', 'š', 'ž', ' ', '€'
];

/// A text string as PDF writes one: UTF-16 after a byte order mark, UTF-8
/// after its own (or, as many programs write it, with none), otherwise
/// PDFDocEncoding. One line, or nothing.
fn text(bytes: &[u8]) -> Option<String> {
  let utf16 = |bytes: &[u8], big: bool| {
    let units: Vec<u16> = bytes
      .chunks_exact(2)
      .map(|pair| if big { u16::from_be_bytes([pair[0], pair[1]]) } else { u16::from_le_bytes([pair[0], pair[1]]) })
      .collect();
    String::from_utf16_lossy(&units)
  };
  let decoded = if let Some(rest) = bytes.strip_prefix(&[0xFEu8, 0xFF]) {
    utf16(rest, true)
  } else if let Some(rest) = bytes.strip_prefix(&[0xFFu8, 0xFE]) {
    utf16(rest, false)
  } else if let Some(rest) = bytes.strip_prefix(&[0xEFu8, 0xBB, 0xBF]) {
    String::from_utf8_lossy(rest).into_owned()
  } else if bytes.iter().any(|byte| *byte >= 0x80) && std::str::from_utf8(bytes).is_ok() {
    String::from_utf8_lossy(bytes).into_owned()
  } else {
    bytes
      .iter()
      .map(|byte| match byte {
        0x80..=0xA0 => DOC_ENCODING[usize::from(byte - 0x80)],
        other => char::from(*other)
      })
      .collect()
  };
  let line = decoded.chars().map(|ch| if ch.is_control() { ' ' } else { ch }).collect::<String>();
  let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
  Some(line).filter(|line| !line.is_empty())
}

/// The text of `<dc:title>` or `<dc:creator>` in an XMP packet: its list's
/// entries (a title has one a language; a book's creators are one each).
fn xmp_field(xmp: &str, tag: &str) -> Vec<String> {
  let Some(start) = xmp.find(&format!("<{tag}")) else {
    return Vec::new();
  };
  let Some(inside) = xmp[start..].find('>').map(|open| &xmp[start + open + 1..]) else {
    return Vec::new();
  };
  let inside = inside.find(&format!("</{tag}>")).map(|end| &inside[..end]).unwrap_or("");
  let mut found = Vec::new();
  let mut rest = inside;
  while let Some(item) = rest.find("<rdf:li") {
    let Some(open) = rest[item..].find('>') else {
      break;
    };
    let body = &rest[item + open + 1..];
    let Some(close) = body.find("</rdf:li>") else {
      break;
    };
    found.push(body[..close].to_string());
    rest = &body[close..];
  }
  if found.is_empty() && !inside.contains('<') {
    found.push(inside.to_string());
  }
  found
    .into_iter()
    .map(|entry| entry.split_whitespace().collect::<Vec<_>>().join(" "))
    .filter(|entry| !entry.is_empty())
    .collect()
}

/// What the PDF at `path` says it is called. Empty for one that says nothing,
/// or whose strings are encrypted.
pub fn info(path: &Path) -> Result<Info> {
  let mut pdf = Pdf::open(path)?;
  pdf.load()?;
  let mut info = Info::default();
  if pdf.trailers.iter().any(|trailer| get(trailer, "Encrypt").is_some()) {
    return Ok(info);
  }
  let newest = |pdf: &Pdf, key: &str| pdf.trailers.iter().find_map(|trailer| reference(trailer, key));

  if let Some(Value::Dict(dict)) = newest(&pdf, "Info").and_then(|number| pdf.object(number, 0)) {
    let mut field = |key: &str| match get(&dict, key) {
      Some(Value::Text(bytes)) => text(bytes),
      Some(Value::Ref(elsewhere)) => match pdf.object(*elsewhere, 0) {
        Some(Value::Text(bytes)) => text(&bytes),
        _ => None
      },
      _ => None
    };
    info.title = field("Title");
    info.author = field("Author");
  }

  if info.title.is_none() || info.author.is_none() {
    let xmp = newest(&pdf, "Root")
      .and_then(|number| pdf.object(number, 0))
      .and_then(|root| match root {
        Value::Dict(root) => reference(&root, "Metadata"),
        _ => None
      })
      .and_then(|number| pdf.stream(number))
      .map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
    if let Some(xmp) = xmp {
      if info.title.is_none() {
        info.title = xmp_field(&xmp, "dc:title").into_iter().next();
      }
      if info.author.is_none() {
        let creators = xmp_field(&xmp, "dc:creator");
        info.author = (!creators.is_empty()).then(|| creators.join("; "));
      }
    }
  }
  Ok(info)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Write;

  fn deflate(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(bytes).expect("deflate");
    encoder.finish().expect("deflate")
  }

  /// A PDF with a classic table: `objects` are (number, body). `trailer` is
  /// what goes in the trailer besides /Size; `before` an earlier version to
  /// append to, with where its table is.
  fn classic(objects: &[(u32, &str)], trailer: &str, before: Option<(Vec<u8>, usize)>) -> (Vec<u8>, usize) {
    let (mut file, prev) = match before {
      Some((file, prev)) => (file, Some(prev)),
      None => (b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec(), None)
    };
    let mut offsets = Vec::new();
    for (number, body) in objects {
      offsets.push((*number, file.len()));
      file.extend(format!("{number} 0 obj\n{body}\nendobj\n").as_bytes());
    }
    let table = file.len();
    file.extend(b"xref\n");
    for (number, offset) in &offsets {
      file.extend(format!("{number} 1\n{offset:010} 00000 n \n").as_bytes());
    }
    let prev = prev.map(|prev| format!("/Prev {prev}")).unwrap_or_default();
    file.extend(format!("trailer\n<</Size 50 {trailer} {prev}>>\nstartxref\n{table}\n%%EOF\n").as_bytes());
    (file, table)
  }

  fn saved(name: &str, bytes: &[u8]) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("leaflet-pdf-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dir");
    let path = dir.join(name);
    std::fs::write(&path, bytes).expect("write");
    path
  }

  fn read(name: &str, bytes: &[u8]) -> Info {
    info(&saved(name, bytes)).expect("a PDF")
  }

  fn named(title: &str, author: &str) -> Info {
    Info { title: Some(title.to_string()), author: Some(author.to_string()) }
  }

  #[test]
  fn reads_the_title_and_author_of_a_plain_pdf() {
    let (file, _) = classic(
      &[
        (1, "<</Type/Catalog/Pages 2 0 R>>"),
        (2, "<</Type/Pages/Count 0/Kids[]>>"),
        // Brackets of its own, an escaped one, an octal code, a line carried on.
        (3, "<</Producer(a maker 1.0)/Title( Night Ferry \\(A \\101 Life\\) (at sea) car\\\nried)/Author(Mara Ellison)/CreationDate(D:2001)>>")
      ],
      "/Root 1 0 R/Info 3 0 R",
      None
    );
    assert_eq!(read("plain.pdf", &file), named("Night Ferry (A A Life) (at sea) carried", "Mara Ellison"));
  }

  #[test]
  fn reads_strings_in_every_encoding_pdf_writes() {
    let utf16: String = "\u{FEFF}L’été — a life".encode_utf16().map(|unit| format!("{unit:04X}")).collect();
    let (file, _) = classic(
      &[(1, "<</Type/Catalog>>"), (3, &format!("<</Title <{utf16}> /Author 4 0 R>>")), (4, "(Zo\\353 Caf\\351 \\215quoted\\216)")],
      "/Root 1 0 R /Info 3 0 R",
      None
    );
    assert_eq!(read("utf16.pdf", &file), named("L’été — a life", "Zoë Café “quoted”"));
    // UTF-8 with no mark, as many programs write it; and with one.
    assert_eq!(text("Café Days".as_bytes()).as_deref(), Some("Café Days"));
    assert_eq!(text(b"\xEF\xBB\xBFCaf\xC3\xA9").as_deref(), Some("Café"));
    assert_eq!(text(b"  two\r\nlines\x00 ").as_deref(), Some("two lines"));
    assert_eq!(text(b" \n"), None);
  }

  #[test]
  fn follows_a_compressed_table_to_an_object_packed_with_others() {
    // Objects 3 (Info) and 4 are packed inside object 5; the table is object 6.
    let packed = "<</Title(Night Ferry)/Author(Mara Ellison)>> <</Type/Catalog/Pages 2 0 R>>";
    let head = "3 0 4 45 ";
    let body = deflate(format!("{head}{packed}").as_bytes());
    let mut file = b"%PDF-1.6\n".to_vec();
    let stream_at = file.len();
    file.extend(format!("5 0 obj\n<</Type/ObjStm/N 2/First {}/Filter/FlateDecode/Length {}>>\nstream\r\n", head.len(), body.len()).as_bytes());
    file.extend(&body);
    file.extend(b"\nendstream\nendobj\n");
    let table_at = file.len();
    // Rows for objects 3 to 6: kind, a two-byte field, a one-byte field.
    let rows: Vec<[u8; 4]> = vec![
      [2, 0, 5, 0],
      [2, 0, 5, 1],
      [1, (stream_at >> 8) as u8, stream_at as u8, 0],
      [1, (table_at >> 8) as u8, table_at as u8, 0]
    ];
    // Packed as writers pack them: each row as its difference from the one above.
    let mut filtered = Vec::new();
    let mut above = [0u8; 4];
    for row in &rows {
      filtered.push(2);
      for (at, byte) in row.iter().enumerate() {
        filtered.push(byte.wrapping_sub(above[at]));
      }
      above = *row;
    }
    let table = deflate(&filtered);
    file.extend(
      format!(
        "6 0 obj\n<</Type/XRef/Size 7/Index[3 4]/W[1 2 1]/Root 4 0 R/Info 3 0 R/Filter/FlateDecode/DecodeParms<</Predictor 12/Columns 4>>/Length {}>>\nstream\n",
        table.len()
      )
      .as_bytes()
    );
    file.extend(&table);
    file.extend(format!("\nendstream\nendobj\nstartxref\n{table_at}\n%%EOF\n").as_bytes());
    assert_eq!(read("packed.pdf", &file), named("Night Ferry", "Mara Ellison"));
  }

  #[test]
  fn the_newest_version_of_an_updated_file_speaks() {
    let first = classic(&[(1, "<</Type/Catalog>>"), (3, "<</Title(draft3.doc)/Author(Administrator)>>")], "/Root 1 0 R/Info 3 0 R", None);
    // Saved again with a new Info object; the old one is still in the file.
    let (file, _) = classic(&[(7, "<</Title(Night Ferry)/Author(Mara Ellison)>>")], "/Root 1 0 R/Info 7 0 R", Some(first.clone()));
    assert_eq!(read("updated.pdf", &file), named("Night Ferry", "Mara Ellison"));
    // Saved again without touching it: the earlier table still finds it.
    let (file, _) = classic(&[(8, "<</Note(nothing)>>")], "/Root 1 0 R/Info 3 0 R", Some(first));
    assert_eq!(read("kept.pdf", &file), named("draft3.doc", "Administrator"));
  }

  #[test]
  fn falls_back_to_the_xmp_packet_when_info_says_nothing() {
    let xmp = r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF>
      <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:format>application/pdf</dc:format>
        <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Night Ferry:
          A Life at Sea</rdf:li><rdf:li xml:lang="fr">Le bac de nuit</rdf:li></rdf:Alt></dc:title>
        <dc:creator><rdf:Seq><rdf:li>Mara Ellison</rdf:li><rdf:li>Tobias Wren</rdf:li></rdf:Seq></dc:creator>
      </rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>"#;
    let metadata = format!("<</Type/Metadata/Subtype/XML/Length {}>>\nstream\n{xmp}\nendstream", xmp.len());
    let objects = [(1, "<</Type/Catalog/Metadata 5 0 R>>"), (3, "<</Producer(a maker)>>"), (5, metadata.as_str())];
    let (file, _) = classic(&objects, "/Root 1 0 R/Info 3 0 R", None);
    assert_eq!(read("xmp.pdf", &file), named("Night Ferry: A Life at Sea", "Mara Ellison; Tobias Wren"));
    // With no Info at all; and Info's word first where it has one.
    let (file, _) = classic(&objects[..1].iter().chain(&objects[2..]).cloned().collect::<Vec<_>>(), "/Root 1 0 R", None);
    assert_eq!(read("xmp-only.pdf", &file).author.as_deref(), Some("Mara Ellison; Tobias Wren"));
    let titled = [(1, "<</Type/Catalog/Metadata 5 0 R>>"), (3, "<</Title(From Info)>>"), (5, metadata.as_str())];
    let (file, _) = classic(&titled, "/Root 1 0 R/Info 3 0 R", None);
    assert_eq!(read("both.pdf", &file), named("From Info", "Mara Ellison; Tobias Wren"));
    assert_eq!(xmp_field("<dc:title>Plain</dc:title>", "dc:title"), ["Plain"]);
    assert_eq!(xmp_field("<dc:title><rdf:Alt><rdf:li>cut off", "dc:title"), Vec::<String>::new());
  }

  #[test]
  fn says_nothing_for_a_pdf_that_says_nothing_or_is_locked() {
    let (file, _) = classic(&[(1, "<</Type/Catalog>>")], "/Root 1 0 R", None);
    assert_eq!(read("bare.pdf", &file), Info::default());
    let (file, _) = classic(&[(1, "<</Type/Catalog>>"), (3, "<</Title()/Author(   )>>")], "/Root 1 0 R/Info 3 0 R", None);
    assert_eq!(read("empty.pdf", &file), Info::default());
    // Encrypted: the strings are not text until unlocked.
    let (file, _) = classic(&[(1, "<</Type/Catalog>>"), (3, "<</Title(\\235\\021x\\004)>>"), (9, "<</Filter/Standard>>")], "/Root 1 0 R/Info 3 0 R/Encrypt 9 0 R", None);
    assert_eq!(read("locked.pdf", &file), Info::default());
    // An Info that points nowhere, or at something that is not a dictionary.
    let (file, _) = classic(&[(1, "<</Type/Catalog>>")], "/Root 1 0 R/Info 40 0 R", None);
    assert_eq!(read("nowhere.pdf", &file), Info::default());
    let (file, _) = classic(&[(1, "<</Type/Catalog>>"), (3, "[1 2 3]")], "/Root 1 0 R/Info 3 0 R", None);
    assert_eq!(read("list.pdf", &file), Info::default());
  }

  #[test]
  fn a_damaged_file_is_an_error_or_an_empty_answer_never_a_panic() {
    let (whole, _) = classic(
      &[(1, "<</Type/Catalog/Pages 2 0 R>>"), (3, "<</Title(Night Ferry)/Author<FEFF004D>/Odd[1 2.5 true null /N#20x (a\\)b)]>>")],
      "/Root 1 0 R/Info 3 0 R",
      None
    );
    assert_eq!(read("whole.pdf", &whole), named("Night Ferry", "M"));
    // Cut short anywhere, and with any byte struck out.
    for len in 0..whole.len() {
      let _ = info(&saved("cut.pdf", &whole[..len]));
    }
    for at in (0..whole.len()).step_by(3) {
      let mut struck = whole.clone();
      struck[at] = b'<';
      let _ = info(&saved("struck.pdf", &struck));
      struck[at] = b'9';
      let _ = info(&saved("struck.pdf", &struck));
    }
    // A table that points at itself, and one whose offsets are past the end.
    let looped = String::from_utf8_lossy(&whole).replace("/Info 3 0 R", "/Prev 0000 /Info 3 0 R").into_bytes();
    let _ = info(&saved("looped.pdf", &looped));
    let far = String::from_utf8_lossy(&whole).replace("startxref\n", "startxref\n9").into_bytes();
    assert!(info(&saved("far.pdf", &far)).is_err());
    assert!(info(&saved("not.pdf", b"PK\x03\x04 an epub")).is_err());
    assert!(info(&saved("none.pdf", b"")).is_err());
    assert_eq!(unfilter(&[9, 1, 2], 2), None, "a row filter that does not exist");
    assert_eq!(unfilter(&[1, 1, 1, 1, 3, 4, 4, 4, 0, 9], 3), Some(vec![1, 2, 3, 4, 7, 9, 9]));
  }
}
