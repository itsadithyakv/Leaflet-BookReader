//! Search inside every book: the words typed, looked for in the text of each
//! EPUB in the library (and of the EPUB kept beside a book that was converted
//! to one), with a few of each book's matches to show and all of them counted.
//!
//! A book is read a section at a time, in reading order: the section is
//! unpacked, its markup taken off, and the words looked for in what is left.
//! Only one section is ever held, so a library of any size costs the memory of
//! its largest chapter.
//!
//! The text is matched the way the reader's own search matches it
//! (`apps/src/readers/searchFold.ts`): whatever the case, without the accents
//! having to be typed, and with a typed apostrophe finding a curly one. The
//! reader finds a match again by the same rules (`apps/src/readers/findPlace.ts`:
//! what is skipped, what parts two words), so the two have to change together.

use crate::storage::epub;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// The shortest query worth going through a library for.
const MIN_QUERY: usize = 2;
/// A query is cut here: nobody types more, and a pasted page is not a search.
const MAX_QUERY: usize = 200;
/// How many of a book's matches are kept to show; the rest are counted.
const KEPT: usize = 5;
/// About how many characters are shown each side of a match.
const CONTEXT: usize = 60;
/// A section larger than this is passed over. No chapter is; an archive that
/// claims one is damaged, or means harm.
const MAX_SECTION_BYTES: u64 = 32 * 1024 * 1024;

/// Whether a character is an accent written on its own after its letter.
fn is_mark(c: char) -> bool {
  ('\u{0300}'..='\u{036f}').contains(&c)
}

/// A lower-case letter without its accent, for the Latin letters of European
/// languages and the few Greek and Cyrillic ones that have one; anything else
/// as it is. (The reader's search takes the accent off any letter at all, so
/// it can find a few words this does not: Vietnamese, say.)
fn bare(c: char) -> char {
  match c {
    'ά' => 'α',
    'έ' => 'ε',
    'ή' => 'η',
    'ί' | 'ϊ' | 'ΐ' => 'ι',
    'ό' => 'ο',
    'ύ' | 'ϋ' | 'ΰ' => 'υ',
    'ώ' => 'ω',
    'ѐ' | 'ё' => 'е',
    'ѓ' => 'г',
    'ї' => 'і',
    'й' | 'ѝ' => 'и',
    'ќ' => 'к',
    'ў' => 'у',
    'ǎ' => 'a',
    'ǐ' => 'i',
    'ǒ' | 'ơ' => 'o',
    'ǔ' | 'ư' => 'u',
    'ș' => 's',
    'ț' => 't',
    'à'..='å' | 'ā' | 'ă' | 'ą' => 'a',
    'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => 'c',
    'ď' => 'd',
    'è'..='ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => 'e',
    'ĝ' | 'ğ' | 'ġ' | 'ģ' => 'g',
    'ĥ' => 'h',
    'ì'..='ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' => 'i',
    'ĵ' => 'j',
    'ķ' => 'k',
    'ĺ' | 'ļ' | 'ľ' => 'l',
    'ñ' | 'ń' | 'ņ' | 'ň' => 'n',
    'ò'..='ö' | 'ō' | 'ŏ' | 'ő' => 'o',
    'ŕ' | 'ŗ' | 'ř' => 'r',
    'ś' | 'ŝ' | 'ş' | 'š' => 's',
    'ţ' | 'ť' => 't',
    'ù'..='ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => 'u',
    'ŵ' => 'w',
    'ý' | 'ÿ' | 'ŷ' => 'y',
    'ź' | 'ż' | 'ž' => 'z',
    other => other
  }
}

/// A typographic apostrophe or quotation mark as the one on the keyboard.
fn plain_quote(c: char) -> char {
  match c {
    '‘' | '’' | '‚' | '‛' | 'ʼ' => '\'',
    '“' | '”' | '„' | '‟' => '"',
    other => other
  }
}

/// One character as it is compared: lowered, its quotes plain and, unless the
/// query has accents of its own, without its accent.
fn fold_into(c: char, keep_marks: bool, out: &mut String) {
  if c.is_ascii() {
    out.push(c.to_ascii_lowercase());
    return;
  }
  for lower in c.to_lowercase() {
    let lower = plain_quote(lower);
    if keep_marks {
      out.push(lower);
    } else if !is_mark(lower) {
      out.push(bare(lower));
    }
  }
}

/// The words typed, ready to be looked for.
pub struct Needle {
  folded: String,
  /// The words were typed with an accent, so they are matched as typed:
  /// "résumé" does not find "resume".
  keep_marks: bool
}

impl Needle {
  /// `None` for a query too short to search for. Runs of spaces count as one,
  /// as they do in the text.
  pub fn new(query: &str) -> Option<Needle> {
    let words = query.split_whitespace().collect::<Vec<_>>().join(" ");
    let words: String = words.chars().take(MAX_QUERY).collect();
    let words = words.trim_end();
    if words.chars().count() < MIN_QUERY {
      return None;
    }
    let keep_marks = words.chars().flat_map(char::to_lowercase).any(|c| is_mark(c) || bare(c) != c);
    let mut folded = String::with_capacity(words.len());
    for c in words.chars() {
      fold_into(c, keep_marks, &mut folded);
    }
    (!folded.is_empty()).then_some(Needle { folded, keep_marks })
  }
}

/// Elements whose text is not the book's: never shown, so never searched.
fn is_unread(name: &str) -> bool {
  matches!(name, "script" | "style" | "head")
}

/// Elements that start a line of their own: the words either side of one are
/// two words, where an `<em>` in the middle of a word leaves it one.
fn is_block(name: &str) -> bool {
  matches!(
    name,
    "address" | "article" | "aside" | "blockquote" | "body" | "br" | "caption" | "center" | "dd" | "details"
      | "dialog" | "dir" | "div" | "dl" | "dt" | "fieldset" | "figcaption" | "figure" | "footer" | "form"
      | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "header" | "hgroup" | "hr" | "html" | "li" | "main" | "menu"
      | "nav" | "ol" | "p" | "pre" | "section" | "summary" | "table" | "tbody" | "td" | "tfoot" | "th"
      | "thead" | "tr" | "ul"
  )
}

/// `<agrave>` and its kind: a letter and the name of its accent.
fn accented(name: &str) -> Option<char> {
  let base = name.chars().next()?;
  let (plain, marked) = match &name[base.len_utf8()..] {
    "grave" => ("aeiouAEIOU", "àèìòùÀÈÌÒÙ"),
    "acute" => ("aeiouyAEIOUY", "áéíóúýÁÉÍÓÚÝ"),
    "circ" => ("aeiouAEIOU", "âêîôûÂÊÎÔÛ"),
    "uml" => ("aeiouyAEIOUY", "äëïöüÿÄËÏÖÜŸ"),
    "tilde" => ("anoANO", "ãñõÃÑÕ"),
    "cedil" => ("cC", "çÇ"),
    "ring" => ("aA", "åÅ"),
    "slash" => ("oO", "øØ"),
    "caron" => ("sS", "šŠ"),
    _ => return None
  };
  plain.chars().position(|c| c == base).and_then(|at| marked.chars().nth(at))
}

/// What an entity stands for: the numbered ones, and the named ones a book's
/// prose uses. XML knows five of them; books written as HTML use the rest.
fn entity(name: &str) -> Option<char> {
  if let Some(number) = name.strip_prefix('#') {
    let code = match number.strip_prefix(['x', 'X']) {
      Some(hex) => u32::from_str_radix(hex, 16).ok()?,
      None => number.parse().ok()?
    };
    return char::from_u32(code).filter(|c| *c != '\0');
  }
  Some(match name {
    "amp" => '&',
    "lt" => '<',
    "gt" => '>',
    "quot" => '"',
    "apos" => '\'',
    "nbsp" => '\u{a0}',
    "ensp" => '\u{2002}',
    "emsp" => '\u{2003}',
    "thinsp" => '\u{2009}',
    "shy" => '\u{ad}',
    "zwnj" => '\u{200c}',
    "zwj" => '\u{200d}',
    "ndash" => '–',
    "mdash" => '—',
    "hellip" => '…',
    "lsquo" => '‘',
    "rsquo" => '’',
    "sbquo" => '‚',
    "ldquo" => '“',
    "rdquo" => '”',
    "bdquo" => '„',
    "laquo" => '«',
    "raquo" => '»',
    "lsaquo" => '‹',
    "rsaquo" => '›',
    "prime" => '′',
    "Prime" => '″',
    "bull" => '•',
    "middot" => '·',
    "dagger" => '†',
    "Dagger" => '‡',
    "sect" => '§',
    "para" => '¶',
    "copy" => '©',
    "reg" => '®',
    "trade" => '™',
    "deg" => '°',
    "times" => '×',
    "divide" => '÷',
    "minus" => '−',
    "frac12" => '½',
    "frac14" => '¼',
    "frac34" => '¾',
    "iexcl" => '¡',
    "iquest" => '¿',
    "cent" => '¢',
    "pound" => '£',
    "yen" => '¥',
    "euro" => '€',
    "szlig" => 'ß',
    "aelig" => 'æ',
    "AElig" => 'Æ',
    "oelig" => 'œ',
    "OElig" => 'Œ',
    "eth" => 'ð',
    "ETH" => 'Ð',
    "thorn" => 'þ',
    "THORN" => 'Þ',
    other => return accented(other)
  })
}

/// A section's text as it is being read, in one line: any run of white space
/// is one space. `gap` carries a space across a tag, so `</p><p>` and a line
/// break in the file both part two words, with a single space.
#[derive(Default)]
struct Line {
  text: String,
  gap: bool
}

impl Line {
  fn push(&mut self, c: char) {
    // (U+FEFF is white space to a browser and not to Rust.)
    if c.is_whitespace() || c == '\u{feff}' {
      self.gap = true;
      return;
    }
    if self.gap && !self.text.is_empty() {
      self.text.push(' ');
    }
    self.gap = false;
    self.text.push(c);
  }

  /// Text as it stands (a CDATA section's).
  fn push_raw(&mut self, text: &str) {
    text.chars().for_each(|c| self.push(c));
  }

  /// Text between tags: its entities become what they stand for.
  fn push_text(&mut self, text: &str) {
    let mut rest = text;
    while let Some(at) = rest.find('&') {
      self.push_raw(&rest[..at]);
      rest = &rest[at + 1..];
      // An entity's name is short; an `&` with no `;` near it is just an `&`.
      let named = rest
        .bytes()
        .take(12)
        .position(|byte| byte == b';')
        .and_then(|end| entity(&rest[..end]).map(|c| (c, end)));
      match named {
        Some((c, end)) => {
          self.push(c);
          rest = &rest[end + 1..];
        }
        None => self.push('&')
      }
    }
    self.push_raw(rest);
  }
}

/// Where `needle` (lower-case ASCII) next is in `text` from `from`, whatever
/// its case there.
fn find_ignoring_case(text: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
  text
    .get(from..)?
    .windows(needle.len())
    .position(|window| window.eq_ignore_ascii_case(needle))
    .map(|at| from + at)
}

/// The `>` that ends the tag whose name ends at `from`. One inside a quoted
/// attribute does not end it.
fn tag_end(bytes: &[u8], from: usize) -> usize {
  let mut quote = 0u8;
  for (at, &byte) in bytes.iter().enumerate().skip(from) {
    match byte {
      b'"' | b'\'' if quote == 0 => quote = byte,
      _ if byte == quote => quote = 0,
      b'>' if quote == 0 => return at,
      _ => {}
    }
  }
  bytes.len()
}

/// A section's text as it reads on the page, in one line: the markup taken
/// off, scripts, styles and the head left out, entities read, and white space
/// run together.
///
/// Read by hand rather than with an XML parser: a parser stops at the first
/// thing that is not XML (an unclosed `<br>`, an `&nbsp;`, a bare `&`), and a
/// book made by a careless converter has all three. Nothing here can fail.
pub fn plain_text(markup: &str) -> String {
  let bytes = markup.as_bytes();
  let mut line = Line { text: String::with_capacity(markup.len() / 2), gap: false };
  let mut at = 0;
  while at < bytes.len() {
    if bytes[at] != b'<' {
      let end = bytes[at..].iter().position(|&byte| byte == b'<').map_or(bytes.len(), |next| at + next);
      line.push_text(&markup[at..end]);
      at = end;
      continue;
    }
    let rest = &markup[at..];
    if rest.starts_with("<!--") {
      at = rest.find("-->").map_or(bytes.len(), |end| at + end + 3);
      continue;
    }
    if let Some(inside) = rest.strip_prefix("<![CDATA[") {
      // Written out as it stands: nothing in it is markup or an entity.
      let end = inside.find("]]>").unwrap_or(inside.len());
      line.push_raw(&inside[..end]);
      at = (at + 9 + end + 3).min(bytes.len());
      continue;
    }
    if rest.starts_with("<!") || rest.starts_with("<?") {
      at = rest.find('>').map_or(bytes.len(), |end| at + end + 1);
      continue;
    }
    let closing = bytes.get(at + 1) == Some(&b'/');
    let name_at = at + 1 + usize::from(closing);
    let name_len = bytes[name_at.min(bytes.len())..]
      .iter()
      .take_while(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'-' | b'_'))
      .count();
    if name_len == 0 || !bytes[name_at].is_ascii_alphabetic() {
      // Not a tag: "a < b".
      line.push('<');
      at += 1;
      continue;
    }
    let written = &markup[name_at..name_at + name_len];
    let name = written.rsplit(':').next().unwrap_or(written).to_ascii_lowercase();
    let end = tag_end(bytes, name_at + name_len);
    let empty = end > 0 && bytes.get(end - 1) == Some(&b'/');
    at = (end + 1).min(bytes.len());
    if is_unread(&name) {
      if !closing && !empty {
        let close = format!("</{}", written.to_ascii_lowercase());
        at = find_ignoring_case(bytes, at, close.as_bytes()).map_or(bytes.len(), |found| tag_end(bytes, found + close.len()) + 1).min(bytes.len());
      }
    } else if is_block(&name) {
      line.gap = true;
    }
  }
  line.text
}

/// Where the words are in a section's text: `[start, end)` in bytes, in
/// order. Matches that overlap are each counted, as the reader's search
/// counts them, so the nth here is the nth there.
fn find_all(text: &str, needle: &Needle) -> Vec<(usize, usize)> {
  // The text as it is compared, and where each of its bytes came from: taking
  // an accent off shortens the text, and lowering "İ" lengthens it.
  let mut folded = String::with_capacity(text.len());
  let mut from: Vec<u32> = Vec::with_capacity(text.len());
  for (at, c) in text.char_indices() {
    fold_into(c, needle.keep_marks, &mut folded);
    from.resize(folded.len(), at as u32);
  }
  let mut found = Vec::new();
  let mut at = 0;
  while let Some(next) = folded[at..].find(&needle.folded) {
    let first = at + next;
    let start = from[first] as usize;
    // To the end of the last character matched, and of the accents written after it.
    let last = from[first + needle.folded.len() - 1] as usize;
    let mut end = last + text[last..].chars().next().map_or(0, char::len_utf8);
    if !needle.keep_marks {
      end += text[end..].chars().take_while(|c| is_mark(*c)).map(char::len_utf8).sum::<usize>();
    }
    found.push((start, end));
    at = first + folded[first..].chars().next().map_or(1, char::len_utf8);
  }
  found
}

/// A match with what stands round it: about `CONTEXT` characters each side,
/// cut between words, with an ellipsis where something was left out.
fn snippet(text: &str, start: usize, end: usize) -> (String, String, String) {
  let mut from = text[..start].char_indices().rev().take(CONTEXT).last().map_or(start, |(at, _)| at);
  let cut_before = from > 0;
  // Unless the stretch happens to begin at a word, its first word is a piece
  // of one. A stretch with no space in it is all there is to show.
  if cut_before && !text[..from].ends_with(' ') {
    if let Some(space) = text[from..start].find(' ') {
      from += space + 1;
    }
  }
  let mut to = text[end..].char_indices().nth(CONTEXT).map_or(text.len(), |(at, _)| end + at);
  let cut_after = to < text.len();
  if cut_after && !text[to..].starts_with(' ') {
    if let Some(space) = text[end..to].rfind(' ') {
      to = end + space;
    }
  }
  let before = format!("{}{}", if cut_before { "…" } else { "" }, &text[from..start]);
  let after = format!("{}{}", text[end..to].trim_end(), if cut_after { "…" } else { "" });
  (before, text[start..end].to_string(), after)
}

/// One match kept to show.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
  /// The section it is in: its href as the book's manifest writes it, which
  /// is how the reader names a section, and its place in the spine.
  pub href: String,
  pub spine: usize,
  /// Which of the section's matches it is, from 0: the reader finds the
  /// section's matches again and goes to this one.
  pub nth: usize,
  pub before: String,
  /// The words found, as the book writes them.
  pub text: String,
  pub after: String
}

/// What one book holds of the words.
#[derive(Debug, Default)]
pub struct Found {
  pub count: usize,
  pub hits: Vec<Hit>
}

/// Goes through the EPUB at `path`. An error means the book could not be read
/// at all; a section that cannot be is passed over and the rest still read.
/// `stop` is asked between sections.
pub fn search_book(path: &Path, needle: &Needle, stop: &dyn Fn() -> bool) -> anyhow::Result<Found> {
  let mut book = epub::reading(path)?;
  let mut found = Found::default();
  let mut read_any = book.sections.is_empty();
  for at in 0..book.sections.len() {
    if stop() {
      break;
    }
    let Some(bytes) = book.read(at, MAX_SECTION_BYTES) else {
      continue;
    };
    read_any = true;
    // As the reader takes it: UTF-8, whatever the file says of itself.
    let text = plain_text(&String::from_utf8_lossy(&bytes));
    drop(bytes);
    let places = find_all(&text, needle);
    let room = KEPT.saturating_sub(found.hits.len());
    for (nth, &(start, end)) in places.iter().enumerate().take(room) {
      let (before, words, after) = snippet(&text, start, end);
      let section = &book.sections[at];
      found.hits.push(Hit { href: section.href.clone(), spine: section.index, nth, before, text: words, after });
    }
    found.count += places.len();
  }
  if !read_any {
    anyhow::bail!("none of the book's sections could be read");
  }
  Ok(found)
}

/// A book of the library, and the EPUB its text is in: its own file, or the
/// conversion kept beside it. `None` for a book with neither (a PDF, a comic,
/// a Kindle book never opened, a book whose file is not on this device).
pub struct Shelved {
  pub id: String,
  pub epub: Option<PathBuf>
}

/// The EPUB to search for a book: the book itself when it is one, or else the
/// conversion made when it was first opened, if there is one. A conversion is
/// never made for the sake of a search: it can take minutes and need Calibre.
pub fn epub_of(book: &Path, converted: Option<&Path>) -> Option<PathBuf> {
  let is_epub = book.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("epub"));
  if is_epub {
    return book.is_file().then(|| book.to_path_buf());
  }
  converted.filter(|path| path.is_file()).map(Path::to_path_buf)
}

/// A book's matches, as the library shows them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookMatches {
  pub book_id: String,
  /// Every match in the book; `matches` holds the first few.
  pub count: usize,
  pub matches: Vec<Hit>
}

/// Sent as each book is finished, so results show as they are found.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
  /// Books gone through or passed over so far, of `total`.
  pub done: usize,
  pub total: usize,
  /// The book just finished, when the words are in it.
  pub book: Option<BookMatches>
}

/// A whole search.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
  /// The books the words are in, the one with the most matches first.
  pub books: Vec<BookMatches>,
  /// Books whose text was gone through.
  pub searched: usize,
  /// Books that could not be: no text to read (a PDF, a comic, a book not
  /// converted or not on this device) or a file too damaged to open.
  pub skipped: usize,
  /// A newer search began, and this one stopped where it was.
  pub stopped: bool
}

/// Goes through the books in the order given, telling of each as it is done.
/// `stop` is asked between books and between sections.
pub fn search_library(shelf: &[Shelved], needle: &Needle, stop: &dyn Fn() -> bool, mut tell: impl FnMut(Progress)) -> Summary {
  let mut summary = Summary::default();
  for (at, book) in shelf.iter().enumerate() {
    if stop() {
      summary.stopped = true;
      break;
    }
    // A damaged file must not end the search, whatever it does to the code
    // that reads it: a panic there is one more book that could not be read.
    let found = book.epub.as_deref().and_then(|path| {
      std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| search_book(path, needle, stop).ok())).ok().flatten()
    });
    if stop() {
      summary.stopped = true;
      break;
    }
    let matches = match found {
      Some(found) => {
        summary.searched += 1;
        (found.count > 0).then(|| BookMatches { book_id: book.id.clone(), count: found.count, matches: found.hits })
      }
      None => {
        summary.skipped += 1;
        None
      }
    };
    if let Some(matches) = &matches {
      summary.books.push(matches.clone());
    }
    tell(Progress { done: at + 1, total: shelf.len(), book: matches });
  }
  // Stable: books with as many matches stay in the order they were searched.
  summary.books.sort_by_key(|book| std::cmp::Reverse(book.count));
  summary
}

/// The newest search's number. A search that finds a later one here stops.
static LATEST: AtomicU64 = AtomicU64::new(0);

/// Starts a search, which stops any still running, and gives its number.
pub fn begin() -> u64 {
  LATEST.fetch_add(1, Ordering::SeqCst) + 1
}

/// Whether no search has begun, and none been called off, since this one.
pub fn is_latest(search: u64) -> bool {
  LATEST.load(Ordering::SeqCst) == search
}

/// Stops whatever search is running (its results are no longer wanted).
pub fn call_off() {
  LATEST.fetch_add(1, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Write;
  use zip::write::FileOptions;
  use zip::ZipWriter;

  fn needle(query: &str) -> Needle {
    Needle::new(query).expect("a query long enough")
  }

  fn found(text: &str, query: &str) -> Vec<String> {
    find_all(text, &needle(query)).into_iter().map(|(start, end)| text[start..end].to_string()).collect()
  }

  fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("leaflet-search-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("dir");
    dir
  }

  fn page(body: &str) -> String {
    format!(
      r#"<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>The lighthouse in the head</title><style>p {{ color: lighthouse }}</style></head><body>{body}</body></html>"#
    )
  }

  /// A small EPUB: `sections` are (file name, markup), in the manifest in the
  /// order given and in the spine in the order of `spine`.
  fn write_epub(path: &Path, sections: &[(&str, String)], spine: &[&str]) {
    let mut zip = ZipWriter::new(std::fs::File::create(path).expect("create"));
    let options = FileOptions::default();
    zip.start_file("mimetype", options).expect("entry");
    zip.write_all(b"application/epub+zip").expect("write");
    zip.start_file("META-INF/container.xml", options).expect("entry");
    zip
      .write_all(br#"<container><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#)
      .expect("write");
    let manifest: String = sections
      .iter()
      .map(|(name, _)| format!(r#"<item id="{name}" href="text/{name}" media-type="application/xhtml+xml"/>"#))
      .collect();
    let itemrefs: String = spine.iter().map(|name| format!(r#"<itemref idref="{name}"/>"#)).collect();
    zip.start_file("OEBPS/book.opf", options).expect("entry");
    zip
      .write_all(format!(r#"<package><metadata/><manifest>{manifest}<item id="pic" href="pic.jpg" media-type="image/jpeg"/></manifest><spine>{itemrefs}</spine></package>"#).as_bytes())
      .expect("write");
    for (name, markup) in sections {
      zip.start_file(format!("OEBPS/text/{name}"), options).expect("entry");
      zip.write_all(markup.as_bytes()).expect("write");
    }
    zip.finish().expect("finish");
  }

  #[test]
  fn markup_comes_off_and_the_text_reads_as_on_the_page() {
    let text = plain_text(&page(
      "<h1>Chapter&nbsp;One</h1>\n<p>The keeper   climbed\n the <em>light</em>house stairs.</p><p>&ldquo;Who&rsquo;s there?&rdquo; he said &amp; waited&#8212;nothing&#x2026;</p><script>var lighthouse = 1 < 2;</script><!-- a lighthouse in a comment --><p>caf&eacute; &unknown; 3 < 4</p>"
    ));
    assert_eq!(text, "Chapter One The keeper climbed the lighthouse stairs. “Who’s there?” he said & waited—nothing… café &unknown; 3 < 4");
  }

  #[test]
  fn markup_no_parser_would_take_is_still_read() {
    // Unclosed tags, a `>` inside an attribute, upper case, a script never closed.
    assert_eq!(plain_text("<P>one<BR>two<img alt=\"a > b\">three</P><div>four"), "one twothree four");
    assert_eq!(plain_text("<p>kept</p><SCRIPT>lost <p>and this</p>"), "kept");
    assert_eq!(plain_text("<p>before</p><style>p{}</STYLE ><p>after</p>"), "before after");
    assert_eq!(plain_text("<p>a<![CDATA[ <b> & ]]>c</p>"), "a <b> & c");
    assert_eq!(plain_text("<p>cut short</p><"), "cut short <");
    assert_eq!(plain_text("<p>cut short</p><p class=\"never closed"), "cut short");
    assert_eq!(plain_text(""), "");
  }

  #[test]
  fn the_words_are_found_whatever_their_case() {
    assert_eq!(found("The Lighthouse stood. the LIGHTHOUSE fell.", "the lighthouse"), ["The Lighthouse", "the LIGHTHOUSE"]);
    assert_eq!(found("nothing of the kind", "lighthouse"), Vec::<String>::new());
    // Overlapping matches are each counted, as the reader's search counts them.
    assert_eq!(found("aaa", "aa"), ["aa", "aa"]);
  }

  #[test]
  fn an_apostrophe_or_a_quote_is_found_straight_or_curly() {
    assert_eq!(found("He said don’t, then don't, then DON‘T.", "don't"), ["don’t", "don't", "DON‘T"]);
    assert_eq!(found("He said don’t, then don't.", "don’t"), ["don’t", "don't"]);
    assert_eq!(found("“Quite so,” she said. \"Quite so.\"", "\"quite so"), ["“Quite so", "\"Quite so"]);
  }

  #[test]
  fn accents_need_not_be_typed_but_count_when_they_are() {
    assert_eq!(found("A naïve façade, a NAIVE facade.", "naive facade"), ["naïve façade", "NAIVE facade"]);
    assert_eq!(found("resume and résumé", "résumé"), ["résumé"]);
    assert_eq!(found("resume and résumé", "resume"), ["resume", "résumé"]);
    // The accent written as its own character after the letter.
    assert_eq!(found("the Miran\u{303}ha river", "miranha"), ["Miran\u{303}ha"]);
    assert_eq!(found("the Miran\u{303}ha river", "miran"), ["Miran\u{303}"]);
    // Lowering "İ" makes two characters of one; the places still hold.
    assert_eq!(found("İstanbul straße café", "cafe"), ["café"]);
    assert_eq!(found("İstanbul straße café", "istanbul"), ["İstanbul"]);
  }

  #[test]
  fn a_query_is_trimmed_and_has_a_shortest_and_a_longest() {
    assert!(Needle::new("").is_none());
    assert!(Needle::new("  a  ").is_none());
    assert!(Needle::new("ab").is_some());
    assert_eq!(needle("  The   Light\thouse ").folded, "the light house");
    assert_eq!(needle(&"x".repeat(5000)).folded.len(), MAX_QUERY);
  }

  #[test]
  fn a_snippet_is_cut_between_words() {
    let lead = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen";
    let tail = "fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three";
    let text = format!("{lead} LIGHTHOUSE {tail}");
    let (start, end) = find_all(&text, &needle("lighthouse"))[0];
    let (before, words, after) = snippet(&text, start, end);
    assert_eq!(words, "LIGHTHOUSE");
    assert_eq!(before, "…six seven eight nine ten eleven twelve thirteen fourteen ");
    assert_eq!(after, " fifteen sixteen seventeen eighteen nineteen twenty…");
    assert!(before.chars().count() <= CONTEXT + 1 && after.chars().count() <= CONTEXT + 1);

    // Nothing left out, nothing marked as left out.
    assert_eq!(snippet("a lighthouse here", 2, 12), ("a ".to_string(), "lighthouse".to_string(), " here".to_string()));
    // A stretch that begins exactly at a word keeps it.
    let exact = format!("zero {} lighthouse", "ab ".repeat(20).trim_end());
    let (start, end) = find_all(&exact, &needle("lighthouse"))[0];
    assert_eq!(snippet(&exact, start, end).0, format!("…{} ", "ab ".repeat(20).trim_end()));
    // Text with no spaces (or one very long word) is shown as far as it goes.
    let unbroken = format!("{}灯台{}", "字".repeat(100), "字".repeat(100));
    let (start, end) = find_all(&unbroken, &needle("灯台"))[0];
    let (before, words, after) = snippet(&unbroken, start, end);
    assert_eq!((before.chars().count(), words.as_str(), after.chars().count()), (CONTEXT + 1, "灯台", CONTEXT + 1));
  }

  #[test]
  fn a_book_is_searched_in_reading_order_and_its_matches_counted() {
    let dir = scratch("order");
    let path = dir.join("book.epub");
    // The manifest lists the files one way and the spine reads them another.
    write_epub(
      &path,
      &[
        ("z-first.xhtml", page("<p>Nothing here.</p>")),
        ("a-last.xhtml", page(&"<p>The lighthouse again.</p>".repeat(9))),
        ("m-middle.xhtml", page("<p>A light<b>house</b> on the rock.</p><p>Light</p><p>house apart. The Lighthouse&rsquo;s lamp.</p>"))
      ],
      &["z-first.xhtml", "m-middle.xhtml", "a-last.xhtml"]
    );
    let found = search_book(&path, &needle("lighthouse"), &|| false).expect("search");
    // Two in the middle section (the word split by a paragraph is two words), nine in the last.
    assert_eq!(found.count, 11);
    assert_eq!(found.hits.len(), KEPT);
    let places: Vec<(&str, usize, usize)> = found.hits.iter().map(|hit| (hit.href.as_str(), hit.spine, hit.nth)).collect();
    assert_eq!(
      places,
      [("text/m-middle.xhtml", 1, 0), ("text/m-middle.xhtml", 1, 1), ("text/a-last.xhtml", 2, 0), ("text/a-last.xhtml", 2, 1), ("text/a-last.xhtml", 2, 2)]
    );
    assert_eq!((found.hits[0].before.as_str(), found.hits[0].text.as_str(), found.hits[0].after.as_str()), ("A ", "lighthouse", " on the rock. Light house apart. The Lighthouse’s lamp."));
    // The head's title and style are not the book's text.
    assert_eq!(search_book(&path, &needle("lighthouse in the head"), &|| false).expect("search").count, 0);
    assert_eq!(search_book(&path, &needle("color"), &|| false).expect("search").count, 0);
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_damaged_file_is_passed_over_and_the_rest_still_searched() {
    let dir = scratch("damaged");
    let good = dir.join("good.epub");
    write_epub(&good, &[("one.xhtml", page("<p>A lighthouse.</p>"))], &["one.xhtml"]);
    // Not a zip at all; a zip cut off half way; a zip with no package; a
    // package whose section is not in the archive.
    let noise = dir.join("noise.epub");
    std::fs::write(&noise, [7u8; 4096]).expect("write");
    let cut = dir.join("cut.epub");
    let whole = std::fs::read(&good).expect("read");
    std::fs::write(&cut, &whole[..whole.len() / 2]).expect("write");
    let empty = dir.join("empty.epub");
    ZipWriter::new(std::fs::File::create(&empty).expect("create")).finish().expect("finish");
    let hollow = dir.join("hollow.epub");
    write_epub(&hollow, &[], &["gone.xhtml"]);
    let lost = dir.join("lost.epub");
    {
      let mut zip = ZipWriter::new(std::fs::File::create(&lost).expect("create"));
      zip.start_file("book.opf", FileOptions::default()).expect("entry");
      zip
        .write_all(br#"<package><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>"#)
        .expect("write");
      zip.finish().expect("finish");
    }

    for path in [&noise, &cut, &empty, &lost] {
      assert!(search_book(path, &needle("lighthouse"), &|| false).is_err(), "{}", path.display());
    }
    // A spine that names nothing readable is an empty book, not a broken one.
    assert_eq!(search_book(&hollow, &needle("lighthouse"), &|| false).expect("search").count, 0);

    let shelf: Vec<Shelved> = [("noise", Some(&noise)), ("cut", Some(&cut)), ("pdf", None), ("good", Some(&good)), ("gone", Some(&dir.join("gone.epub")))]
      .into_iter()
      .map(|(id, path)| Shelved { id: id.to_string(), epub: path.cloned() })
      .collect();
    let mut told = Vec::new();
    let summary = search_library(&shelf, &needle("lighthouse"), &|| false, |progress| told.push((progress.done, progress.total, progress.book.map(|book| book.book_id))));
    assert_eq!((summary.searched, summary.skipped, summary.stopped), (1, 4, false));
    assert_eq!(summary.books.iter().map(|book| (book.book_id.as_str(), book.count)).collect::<Vec<_>>(), [("good", 1)]);
    assert_eq!(told, [(1, 5, None), (2, 5, None), (3, 5, None), (4, 5, Some("good".to_string())), (5, 5, None)]);
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn books_come_back_with_the_most_matches_first() {
    let dir = scratch("ranked");
    let shelf: Vec<Shelved> = [("once", 1), ("none", 0), ("thrice", 3), ("twice", 2)]
      .into_iter()
      .map(|(id, times)| {
        let path = dir.join(format!("{id}.epub"));
        write_epub(&path, &[("one.xhtml", page(&format!("<p>Fog.</p>{}", "<p>A lighthouse.</p>".repeat(times))))], &["one.xhtml"]);
        Shelved { id: id.to_string(), epub: Some(path) }
      })
      .collect();
    let summary = search_library(&shelf, &needle("lighthouse"), &|| false, |_| {});
    assert_eq!(summary.books.iter().map(|book| (book.book_id.as_str(), book.count)).collect::<Vec<_>>(), [("thrice", 3), ("twice", 2), ("once", 1)]);
    assert_eq!((summary.searched, summary.skipped), (4, 0));
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_search_that_is_called_off_stops_between_books() {
    let dir = scratch("stopped");
    let shelf: Vec<Shelved> = (0..6)
      .map(|at| {
        let path = dir.join(format!("{at}.epub"));
        write_epub(&path, &[("one.xhtml", page("<p>A lighthouse.</p>"))], &["one.xhtml"]);
        Shelved { id: at.to_string(), epub: Some(path) }
      })
      .collect();
    // Called off while the third book is being told of.
    let stopped = std::cell::Cell::new(false);
    let mut told = 0;
    let summary = search_library(&shelf, &needle("lighthouse"), &|| stopped.get(), |progress| {
      told += 1;
      stopped.set(progress.done == 3);
    });
    assert_eq!((told, summary.searched, summary.books.len(), summary.stopped), (3, 3, 3, true));

    // Called off in the middle of a book: what it had found is not reported.
    let asked = std::cell::Cell::new(0);
    let summary = search_library(
      &shelf,
      &needle("lighthouse"),
      &|| {
        asked.set(asked.get() + 1);
        asked.get() > 2
      },
      |_| panic!("nothing was finished")
    );
    assert_eq!((summary.searched, summary.books.len(), summary.stopped), (0, 0, true));
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_newer_search_stops_an_older_one() {
    // (The only test that touches the counter: the others pass their own `stop`.)
    let first = begin();
    assert!(is_latest(first));
    let second = begin();
    assert!(!is_latest(first) && is_latest(second));
    call_off();
    assert!(!is_latest(second));
  }

  #[test]
  fn a_book_is_searched_through_its_epub_or_its_conversion_and_never_converted() {
    let dir = scratch("which");
    let epub = dir.join("abc.epub");
    let kindle = dir.join("def.mobi");
    let pdf = dir.join("ghi.pdf");
    for path in [&epub, &kindle, &pdf] {
      std::fs::write(path, b"x").expect("write");
    }
    assert_eq!(epub_of(&epub, Some(&epub)), Some(epub.clone()));
    assert_eq!(epub_of(&dir.join("ABC.EPUB"), None), dir.join("ABC.EPUB").is_file().then(|| dir.join("ABC.EPUB")));
    // A Kindle book: only once it has been opened, and so converted.
    let converted = dir.join("def.epub");
    assert_eq!(epub_of(&kindle, Some(&converted)), None);
    std::fs::write(&converted, b"x").expect("write");
    assert_eq!(epub_of(&kindle, Some(&converted)), Some(converted));
    assert_eq!(epub_of(&pdf, Some(&dir.join("ghi.epub"))), None);
    assert_eq!(epub_of(&pdf, None), None);
    // Listed, but its file is not on this device.
    assert_eq!(epub_of(&dir.join("missing.epub"), None), None);
    let _ = std::fs::remove_dir_all(&dir);
  }

  /// What a search of a real library costs, for a person to read: the test
  /// copies under `apps/node_modules/.leaflet-test/library`. Prints numbers
  /// only, never a title or a word of a book. Silent where the folder is absent.
  ///
  /// ```text
  /// cargo test --lib search_cost -- --ignored --nocapture
  /// ```
  #[test]
  #[ignore = "reads the test library; run by hand with --ignored --nocapture"]
  fn search_cost_over_the_test_library() {
    use std::time::Instant;
    let library = Path::new(env!("CARGO_MANIFEST_DIR")).join("../node_modules/.leaflet-test/library");
    let Ok(entries) = std::fs::read_dir(&library) else {
      eprintln!("the test library is not here: nothing to time.");
      return;
    };
    let mut files: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).filter(|path| path.is_file()).collect();
    files.sort();
    let shelf: Vec<Shelved> = files
      .iter()
      .enumerate()
      .map(|(at, path)| Shelved { id: at.to_string(), epub: epub_of(path, None) })
      .collect();
    let bytes: u64 = shelf.iter().filter_map(|book| book.epub.as_ref()).filter_map(|path| std::fs::metadata(path).ok()).map(|meta| meta.len()).sum();
    println!("{} files, {} of them EPUBs, {:.1} MB of EPUB", shelf.len(), shelf.iter().filter(|book| book.epub.is_some()).count(), bytes as f64 / 1_048_576.0);

    for query in ["the", "said the", "zzqqzz", "don't", "facade"] {
      let started = Instant::now();
      let summary = search_library(&shelf, &needle(query), &|| false, |_| {});
      let matches: usize = summary.books.iter().map(|book| book.count).sum();
      println!(
        "{:>9}: {:7.1} ms, {} searched, {} skipped, {} books with a match, {} matches",
        format!("{query:?}"),
        started.elapsed().as_secs_f64() * 1000.0,
        summary.searched,
        summary.skipped,
        summary.books.len(),
        matches
      );
    }

    // Where the time goes, over every section of every book.
    let (mut unpack, mut strip, mut look, mut text_bytes, mut sections) = (0.0, 0.0, 0.0, 0usize, 0usize);
    let wanted = needle("the");
    for path in shelf.iter().filter_map(|book| book.epub.as_ref()) {
      let Ok(mut book) = epub::reading(path) else {
        continue;
      };
      for at in 0..book.sections.len() {
        let started = Instant::now();
        let Some(bytes) = book.read(at, MAX_SECTION_BYTES) else {
          continue;
        };
        unpack += started.elapsed().as_secs_f64();
        let started = Instant::now();
        let text = plain_text(&String::from_utf8_lossy(&bytes));
        strip += started.elapsed().as_secs_f64();
        let started = Instant::now();
        let _ = find_all(&text, &wanted);
        look += started.elapsed().as_secs_f64();
        text_bytes += text.len();
        sections += 1;
      }
    }
    println!(
      "{sections} sections, {:.1} MB of text: unpacking {:.0} ms, taking the markup off {:.0} ms, looking {:.0} ms",
      text_bytes as f64 / 1_048_576.0,
      unpack * 1000.0,
      strip * 1000.0,
      look * 1000.0
    );
  }
}
