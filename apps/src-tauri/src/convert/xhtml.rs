//! Old HTML made into the body of an XHTML page.
//!
//! The reader opens a chapter as XML, and XML forgives nothing: one `<br>`
//! left open, one `&nbsp;`, one attribute without quotes, and the chapter is
//! an error page. The markup inside a Kindle book is HTML of the year 2000:
//! all three, on every page. So it is taken apart into tags and text
//! (`tokens`) and written out again (`Writer`) with every tag closed, in
//! order, every attribute quoted, and every entity a character.
//!
//! Only tags a book needs are written; the rest are dropped and what was
//! inside them kept, except for the few whose insides are not text to read.

/// One piece of a page: a tag or the text between two.
#[derive(Debug, Clone, PartialEq)]
pub enum Kind {
  Text,
  /// A start tag: its name in lower case and its attributes as written.
  Open { name: String, attrs: Vec<(String, Vec<u8>)>, closed: bool },
  Close { name: String },
  /// A comment, a doctype, a processing instruction: nothing to show.
  Other
}

#[derive(Debug, Clone, PartialEq)]
pub struct Token {
  /// Where it starts and ends in the page's bytes.
  pub start: usize,
  pub end: usize,
  pub kind: Kind
}

fn is_name_start(byte: u8) -> bool {
  byte.is_ascii_alphabetic()
}

fn is_name_byte(byte: u8) -> bool {
  byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'-' | b'_' | b'.')
}

/// Where a tag that starts at `at` ends (the byte after its `>`), reading
/// past a `>` inside a quoted value. None when it never ends.
fn tag_end(page: &[u8], at: usize) -> Option<usize> {
  let mut quote: Option<u8> = None;
  for (index, byte) in page.iter().enumerate().skip(at + 1) {
    match (quote, *byte) {
      (Some(open), close) if open == close => quote = None,
      (Some(_), _) => {}
      (None, b'"') | (None, b'\'') => quote = Some(*byte),
      (None, b'>') => return Some(index + 1),
      // A new tag before this one ended: this was never a tag.
      (None, b'<') => return None,
      _ => {}
    }
  }
  None
}

fn attributes(tag: &[u8]) -> Vec<(String, Vec<u8>)> {
  let mut attrs = Vec::new();
  let mut at = 0;
  let space = |byte: u8| byte.is_ascii_whitespace() || byte == b'/';
  while at < tag.len() {
    while at < tag.len() && space(tag[at]) {
      at += 1;
    }
    let name_start = at;
    while at < tag.len() && !space(tag[at]) && tag[at] != b'=' {
      at += 1;
    }
    if at == name_start {
      at += 1;
      continue;
    }
    let name = String::from_utf8_lossy(&tag[name_start..at]).to_ascii_lowercase();
    while at < tag.len() && tag[at].is_ascii_whitespace() {
      at += 1;
    }
    let mut value = Vec::new();
    if at < tag.len() && tag[at] == b'=' {
      at += 1;
      while at < tag.len() && tag[at].is_ascii_whitespace() {
        at += 1;
      }
      if at < tag.len() && (tag[at] == b'"' || tag[at] == b'\'') {
        let quote = tag[at];
        let from = at + 1;
        at = from;
        while at < tag.len() && tag[at] != quote {
          at += 1;
        }
        value = tag[from..at].to_vec();
        at += 1;
      } else {
        let from = at;
        while at < tag.len() && !tag[at].is_ascii_whitespace() {
          at += 1;
        }
        value = tag[from..at].to_vec();
        // `<img recindex=00003/>`: the slash closes the tag, it is not the value's.
        if at == tag.len() && value.last() == Some(&b'/') {
          value.pop();
        }
      }
    }
    attrs.push((name, value));
  }
  attrs
}

/// A page as tags and the text between them, in order, with nothing left out:
/// every byte is in exactly one token.
pub fn tokens(page: &[u8]) -> Vec<Token> {
  let mut out = Vec::new();
  let mut text_from = 0;
  let mut at = 0;
  let text = |out: &mut Vec<Token>, from: usize, to: usize| {
    if to > from {
      out.push(Token { start: from, end: to, kind: Kind::Text });
    }
  };
  while at < page.len() {
    if page[at] != b'<' {
      at += 1;
      continue;
    }
    let next = page.get(at + 1).copied().unwrap_or(0);
    // A comment ends at `-->`, whatever is inside it.
    if page[at..].starts_with(b"<!--") {
      let end = page[at + 4..].windows(3).position(|w| w == b"-->").map(|found| at + 4 + found + 3).unwrap_or(page.len());
      text(&mut out, text_from, at);
      out.push(Token { start: at, end, kind: Kind::Other });
      at = end;
      text_from = at;
      continue;
    }
    let closing = next == b'/';
    let name_at = if closing { at + 2 } else { at + 1 };
    let named = page.get(name_at).copied().is_some_and(is_name_start);
    if !named && next != b'!' && next != b'?' {
      // A `<` that opens nothing: text.
      at += 1;
      continue;
    }
    let Some(end) = tag_end(page, at) else {
      at += 1;
      continue;
    };
    text(&mut out, text_from, at);
    let kind = if !named {
      Kind::Other
    } else {
      let mut name_end = name_at;
      while name_end < end - 1 && is_name_byte(page[name_end]) {
        name_end += 1;
      }
      let name = String::from_utf8_lossy(&page[name_at..name_end]).to_ascii_lowercase();
      if closing {
        Kind::Close { name }
      } else {
        let inside = &page[name_end..end - 1];
        let closed = inside.last() == Some(&b'/');
        Kind::Open { name, attrs: attributes(inside), closed }
      }
    };
    out.push(Token { start: at, end, kind });
    at = end;
    text_from = at;
  }
  text(&mut out, text_from, page.len());
  out
}

/// Tags whose insides are not the book's text.
pub fn is_hidden(name: &str) -> bool {
  matches!(name, "head" | "script" | "style" | "title" | "guide" | "iframe" | "object" | "embed" | "noscript" | "form" | "svg" | "math")
}

const VOID: [&str; 3] = ["br", "hr", "img"];
const INLINE: [&str; 21] = [
  "a", "b", "i", "u", "em", "strong", "span", "sup", "sub", "small", "big", "s", "strike", "del", "ins", "code", "tt", "cite", "q", "abbr", "font"
];
const BLOCK: [&str; 24] = [
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "dl", "dt", "dd", "pre", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption"
];

/// Whether the writer writes this tag. `font` is known and never written.
pub fn is_written(name: &str) -> bool {
  name != "font" && (VOID.contains(&name) || INLINE.contains(&name) || BLOCK.contains(&name))
}

fn is_block(name: &str) -> bool {
  BLOCK.contains(&name) || name == "hr"
}

/// The characters HTML has names for that a book is likely to use: Latin-1 in
/// its order (160 to 255), then the typographer's.
const LATIN1: [&str; 96] = [
  "nbsp", "iexcl", "cent", "pound", "curren", "yen", "brvbar", "sect", "uml", "copy", "ordf", "laquo", "not", "shy", "reg", "macr", "deg", "plusmn", "sup2", "sup3",
  "acute", "micro", "para", "middot", "cedil", "sup1", "ordm", "raquo", "frac14", "frac12", "frac34", "iquest", "Agrave", "Aacute", "Acirc", "Atilde", "Auml", "Aring",
  "AElig", "Ccedil", "Egrave", "Eacute", "Ecirc", "Euml", "Igrave", "Iacute", "Icirc", "Iuml", "ETH", "Ntilde", "Ograve", "Oacute", "Ocirc", "Otilde", "Ouml", "times",
  "Oslash", "Ugrave", "Uacute", "Ucirc", "Uuml", "Yacute", "THORN", "szlig", "agrave", "aacute", "acirc", "atilde", "auml", "aring", "aelig", "ccedil", "egrave", "eacute",
  "ecirc", "euml", "igrave", "iacute", "icirc", "iuml", "eth", "ntilde", "ograve", "oacute", "ocirc", "otilde", "ouml", "divide", "oslash", "ugrave", "uacute", "ucirc",
  "uuml", "yacute", "thorn", "yuml"
];

const NAMED: [(&str, char); 44] = [
  ("quot", '"'), ("amp", '&'), ("lt", '<'), ("gt", '>'), ("apos", '\''),
  ("OElig", '\u{152}'), ("oelig", '\u{153}'), ("Scaron", '\u{160}'), ("scaron", '\u{161}'), ("Yuml", '\u{178}'),
  ("circ", '\u{2c6}'), ("tilde", '\u{2dc}'), ("ensp", '\u{2002}'), ("emsp", '\u{2003}'), ("thinsp", '\u{2009}'),
  ("zwnj", '\u{200c}'), ("zwj", '\u{200d}'), ("ndash", '\u{2013}'), ("mdash", '\u{2014}'), ("lsquo", '\u{2018}'),
  ("rsquo", '\u{2019}'), ("sbquo", '\u{201a}'), ("ldquo", '\u{201c}'), ("rdquo", '\u{201d}'), ("bdquo", '\u{201e}'),
  ("dagger", '\u{2020}'), ("Dagger", '\u{2021}'), ("bull", '\u{2022}'), ("hellip", '\u{2026}'), ("permil", '\u{2030}'),
  ("prime", '\u{2032}'), ("Prime", '\u{2033}'), ("lsaquo", '\u{2039}'), ("rsaquo", '\u{203a}'), ("euro", '\u{20ac}'),
  ("trade", '\u{2122}'), ("larr", '\u{2190}'), ("uarr", '\u{2191}'), ("rarr", '\u{2192}'), ("darr", '\u{2193}'),
  ("minus", '\u{2212}'), ("lrm", '\u{200e}'), ("rlm", '\u{200f}'), ("fnof", '\u{192}')
];

fn entity(name: &str) -> Option<char> {
  if let Some(number) = name.strip_prefix('#') {
    let code = match number.strip_prefix(['x', 'X']) {
      Some(hex) => u32::from_str_radix(hex, 16).ok()?,
      None => number.parse::<u32>().ok()?
    };
    // Windows' quotes and dashes written as the bytes they were (`&#146;`).
    let code = if (0x80..=0x9f).contains(&code) { cp1252(code as u8) as u32 } else { code };
    return char::from_u32(code).filter(|c| *c != '\0');
  }
  if let Some(at) = LATIN1.iter().position(|known| *known == name) {
    return char::from_u32(160 + at as u32);
  }
  NAMED.iter().find(|(known, _)| *known == name).map(|(_, c)| *c)
}

/// Windows-1252, which older books are written in: Latin-1 but for 0x80 to
/// 0x9F, where the quotes, the dashes and a few letters are.
pub fn cp1252(byte: u8) -> char {
  const HIGH: [char; 32] = [
    '\u{20ac}', '\u{81}', '\u{201a}', '\u{192}', '\u{201e}', '\u{2026}', '\u{2020}', '\u{2021}', '\u{2c6}', '\u{2030}', '\u{160}', '\u{2039}', '\u{152}', '\u{8d}', '\u{17d}', '\u{8f}',
    '\u{90}', '\u{2018}', '\u{2019}', '\u{201c}', '\u{201d}', '\u{2022}', '\u{2013}', '\u{2014}', '\u{2dc}', '\u{2122}', '\u{161}', '\u{203a}', '\u{153}', '\u{9d}', '\u{17e}', '\u{178}'
  ];
  if (0x80..=0x9f).contains(&byte) {
    HIGH[(byte - 0x80) as usize]
  } else {
    char::from(byte)
  }
}

/// Text as written in a page, with its entities made characters. One it does
/// not know stays as it was written, ampersand and all.
pub fn decode_entities(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  let mut rest = text;
  while let Some(at) = rest.find('&') {
    out.push_str(&rest[..at]);
    let after = &rest[at + 1..];
    let end = after.find(';').filter(|end| *end > 0 && *end <= 10);
    match end.and_then(|end| entity(&after[..end]).map(|c| (c, end))) {
      Some((c, end)) => {
        out.push(c);
        rest = &after[end + 1..];
      }
      None => {
        out.push('&');
        rest = after;
      }
    }
  }
  out.push_str(rest);
  out
}

fn escape(text: &str, out: &mut String) {
  for c in text.chars() {
    match c {
      '&' => out.push_str("&amp;"),
      '<' => out.push_str("&lt;"),
      '>' => out.push_str("&gt;"),
      '"' => out.push_str("&quot;"),
      // What XML does not allow at all.
      c if (c as u32) < 0x20 && c != '\n' && c != '\r' && c != '\t' => out.push(' '),
      '\u{fffe}' | '\u{ffff}' => {}
      c => out.push(c)
    }
  }
}

/// Writes a page's body with every tag closed and in order.
#[derive(Default)]
pub struct Writer {
  out: String,
  open: Vec<String>
}

impl Writer {
  pub fn new() -> Self {
    Self::default()
  }

  pub fn len(&self) -> usize {
    self.out.len()
  }

  pub fn is_empty(&self) -> bool {
    self.out.trim().is_empty()
  }

  /// How deep in open tags the page is.
  pub fn depth(&self) -> usize {
    self.open.len()
  }

  /// Text from the page: entities and all.
  pub fn text(&mut self, raw: &str) {
    escape(&decode_entities(raw), &mut self.out);
  }

  /// Markup that is already XML and needs no closing.
  pub fn raw(&mut self, xml: &str) {
    self.out.push_str(xml);
  }

  fn close_to(&mut self, index: usize) {
    while self.open.len() > index {
      let name = self.open.pop().unwrap_or_default();
      self.out.push_str("</");
      self.out.push_str(&name);
      self.out.push('>');
    }
  }

  /// The innermost open `wanted` that is not outside an open `within`.
  fn open_inside(&self, wanted: &[&str], within: &[&str]) -> Option<usize> {
    for (index, name) in self.open.iter().enumerate().rev() {
      if wanted.contains(&name.as_str()) {
        return Some(index);
      }
      if within.contains(&name.as_str()) {
        return None;
      }
    }
    None
  }

  /// A start tag, with the attributes to write. What HTML closes by itself
  /// is closed first: a paragraph by the next block, a list item, a table's
  /// row or cell by the next one.
  pub fn open(&mut self, name: &str, attrs: &[(&str, String)]) {
    if !is_written(name) {
      return;
    }
    if is_block(name) {
      if let Some(paragraph) = self.open_inside(&["p"], &["td", "th", "li", "blockquote", "div"]) {
        self.close_to(paragraph);
      }
    }
    let closes: Option<usize> = match name {
      "li" => self.open_inside(&["li"], &["ul", "ol"]),
      "tr" => self.open_inside(&["tr"], &["table"]),
      "td" | "th" => self.open_inside(&["td", "th"], &["tr", "table"]),
      "dt" | "dd" => self.open_inside(&["dt", "dd"], &["dl"]),
      _ => None
    };
    if let Some(index) = closes {
      self.close_to(index);
    }
    self.out.push('<');
    self.out.push_str(name);
    for (key, value) in attrs {
      self.out.push(' ');
      self.out.push_str(key);
      self.out.push_str("=\"");
      escape(value, &mut self.out);
      self.out.push('"');
    }
    if VOID.contains(&name) {
      self.out.push_str("/>");
    } else {
      self.out.push('>');
      self.open.push(name.to_string());
    }
  }

  /// An end tag. One that closes nothing open is left out; one that closes
  /// something further out closes what is inside it first.
  pub fn close(&mut self, name: &str) {
    if let Some(index) = self.open.iter().rposition(|open| open == name) {
      self.close_to(index);
    }
  }

  /// The body, with whatever was still open closed.
  pub fn finish(mut self) -> String {
    self.close_to(0);
    self.out
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn kinds(page: &str) -> Vec<String> {
    tokens(page.as_bytes())
      .into_iter()
      .map(|token| match token.kind {
        Kind::Text => format!("text:{}", &page[token.start..token.end]),
        Kind::Open { name, attrs, closed } => {
          let attrs: Vec<String> = attrs.iter().map(|(key, value)| format!("{key}={}", String::from_utf8_lossy(value))).collect();
          format!("open:{name}[{}]{}", attrs.join(","), if closed { "/" } else { "" })
        }
        Kind::Close { name } => format!("close:{name}"),
        Kind::Other => "other".to_string()
      })
      .collect()
  }

  #[test]
  fn a_page_is_cut_into_tags_and_text_with_nothing_left_out() {
    let page = "<P Align=center>One <b>two</b><br><img recindex=00003 alt='a > b'/> 3 < 4 &amp; 5<!-- a <b> in a comment --><a filepos=0000123 >x</a></p>";
    assert_eq!(
      kinds(page),
      vec![
        "open:p[align=center]", "text:One ", "open:b[]", "text:two", "close:b", "open:br[]", "open:img[recindex=00003,alt=a > b]/", "text: 3 < 4 &amp; 5",
        "other", "open:a[filepos=0000123]", "text:x", "close:a", "close:p"
      ]
    );
    // Every byte is in one token, in order.
    let cut = tokens(page.as_bytes());
    assert_eq!(cut.first().map(|token| token.start), Some(0));
    assert_eq!(cut.last().map(|token| token.end), Some(page.len()));
    assert!(cut.windows(2).all(|pair| pair[0].end == pair[1].start));
  }

  #[test]
  fn a_tag_that_never_ends_is_text() {
    assert_eq!(kinds("a <b and no more"), vec!["text:a <b and no more"]);
    assert_eq!(kinds("x <p <i>y</i>"), vec!["text:x <p ", "open:i[]", "text:y", "close:i"]);
    assert_eq!(kinds("<mbp:pagebreak/>"), vec!["open:mbp:pagebreak[]/"]);
  }

  #[test]
  fn entities_become_characters_and_unknown_ones_stay_as_written() {
    assert_eq!(decode_entities("caf&eacute; &mdash; &ldquo;oui&rdquo;&nbsp;&#8230;&#x2014;"), "caf\u{e9} \u{2014} \u{201c}oui\u{201d}\u{a0}\u{2026}\u{2014}");
    assert_eq!(decode_entities("&#146;tis &#150; so"), "\u{2019}tis \u{2013} so");
    assert_eq!(decode_entities("AT&T, &unknown; and a lone & here; &#0; &#xD800;"), "AT&T, &unknown; and a lone & here; &#0; &#xD800;");
    assert_eq!(decode_entities("&yuml;&nbsp;&Agrave;"), "\u{ff}\u{a0}\u{c0}");
  }

  #[test]
  fn what_is_written_is_well_formed_whatever_came_in() {
    let mut page = Writer::new();
    page.open("p", &[("style", "text-align:center".to_string())]);
    page.text("One & two <three> &nbsp;");
    page.open("b", &[]);
    page.open("i", &[]);
    page.text("bold");
    // Closed out of order, and a tag that was never opened.
    page.close("b");
    page.close("u");
    page.open("br", &[]);
    page.open("img", &[("src", "../images/img1.jpeg".to_string()), ("alt", "a \"b\"".to_string())]);
    // A paragraph inside a paragraph closes the first.
    page.open("p", &[]);
    page.text("next");
    // Left open at the end.
    page.open("span", &[]);
    assert_eq!(
      page.finish(),
      "<p style=\"text-align:center\">One &amp; two &lt;three&gt; \u{a0}<b><i>bold</i></b><br/><img src=\"../images/img1.jpeg\" alt=\"a &quot;b&quot;\"/></p><p>next<span></span></p>"
    );
  }

  #[test]
  fn lists_and_tables_close_what_html_leaves_open() {
    let mut page = Writer::new();
    page.open("ul", &[]);
    page.open("li", &[]);
    page.text("one");
    page.open("li", &[]);
    page.text("two");
    page.open("ul", &[]);
    page.open("li", &[]);
    page.text("inner");
    page.close("ul");
    page.close("ul");
    page.open("table", &[]);
    page.open("tr", &[]);
    page.open("td", &[]);
    page.text("a");
    page.open("td", &[]);
    page.open("p", &[]);
    page.text("b");
    page.open("tr", &[]);
    page.open("td", &[]);
    page.text("c");
    assert_eq!(
      page.finish(),
      "<ul><li>one</li><li>two<ul><li>inner</li></ul></li></ul><table><tr><td>a</td><td><p>b</p></td></tr><tr><td>c</td></tr></table>"
    );
  }

  #[test]
  fn tags_a_book_does_not_need_are_not_written() {
    let mut page = Writer::new();
    page.open("font", &[("size", "5".to_string())]);
    page.open("mbp:section", &[]);
    page.open("marquee", &[]);
    page.text("kept");
    page.close("marquee");
    page.close("font");
    assert_eq!(page.finish(), "kept");
    assert!(is_hidden("script") && is_hidden("head") && !is_hidden("p"));
  }

  #[test]
  fn windows_bytes_are_the_characters_windows_meant() {
    assert_eq!(cp1252(0x93), '\u{201c}');
    assert_eq!(cp1252(0x97), '\u{2014}');
    assert_eq!(cp1252(0x80), '\u{20ac}');
    assert_eq!(cp1252(0xe9), '\u{e9}');
    assert_eq!(cp1252(b'a'), 'a');
  }
}
