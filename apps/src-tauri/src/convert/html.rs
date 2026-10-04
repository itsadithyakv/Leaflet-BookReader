//! HTML / HTMLZ to EPUB.
//!
//! The reader already renders HTML, so this mostly means extracting the body,
//! removing what must not run inside the reader iframe, and giving epub.js a
//! container it understands.

use super::epub_builder::{Chapter, EpubBuilder};
use super::{decode_text, read_zip_entry};
use anyhow::Result;
use std::path::Path;

pub fn from_html(source: &Path, fallback_title: &str) -> Result<EpubBuilder> {
  let bytes = std::fs::read(source)?;
  Ok(build(&decode_text(&bytes), fallback_title))
}

pub fn from_html_archive(source: &Path, fallback_title: &str) -> Result<EpubBuilder> {
  // HTMLZ always carries index.html; fall back to any markup file.
  let entry = read_zip_entry(source, |name| name == "index.html")?
    .or(read_zip_entry(source, |name| {
      name.ends_with(".html") || name.ends_with(".htm") || name.ends_with(".xhtml")
    })?)
    .ok_or_else(|| anyhow::anyhow!("the archive contained no HTML file"))?;
  Ok(build(&decode_text(&entry.1), fallback_title))
}

/// Removes an element and everything inside it, tag included.
fn strip_element(html: &str, tag: &str) -> String {
  // ASCII only: the offsets found here are used on `html`, and full
  // lower-casing changes the length of some letters (Turkish "İ" grows by a
  // byte), which cut the page in the wrong place or in the middle of a letter.
  let lowered = html.to_ascii_lowercase();
  let open = format!("<{tag}");
  let close = format!("</{tag}>");
  let mut out = String::with_capacity(html.len());
  let mut cursor = 0usize;

  while let Some(found) = lowered[cursor..].find(&open) {
    let start = cursor + found;
    // Only a real tag boundary counts, so <scriptish> is left alone.
    let after = lowered[start + open.len()..].chars().next();
    if !matches!(after, Some(c) if c.is_whitespace() || c == '>' || c == '/') {
      out.push_str(&html[cursor..start + open.len()]);
      cursor = start + open.len();
      continue;
    }
    out.push_str(&html[cursor..start]);
    match lowered[start..].find(&close) {
      Some(end) => cursor = start + end + close.len(),
      None => return out
    }
  }
  out.push_str(&html[cursor..]);
  out
}

fn slice_between(html: &str, open_tag: &str, close_tag: &str) -> Option<String> {
  // ASCII only, for the same reason as in `strip_element`.
  let lowered = html.to_ascii_lowercase();
  let open = lowered.find(open_tag)?;
  let body_start = lowered[open..].find('>')? + open + 1;
  let end = lowered[body_start..]
    .find(close_tag)
    .map(|offset| body_start + offset)
    .unwrap_or(html.len());
  Some(html[body_start..end].to_string())
}

fn extract_title(html: &str) -> Option<String> {
  let text = slice_between(html, "<title", "</title>")?;
  let trimmed = text.trim();
  if trimmed.is_empty() {
    None
  } else {
    Some(trimmed.to_string())
  }
}

fn build(html: &str, fallback_title: &str) -> EpubBuilder {
  let title = extract_title(html).unwrap_or_else(|| fallback_title.to_string());
  let mut builder = EpubBuilder::new(title.clone());

  // Scripts must never run in the reader iframe; styles and head metadata would
  // fight the reader's own theming.
  let cleaned = strip_element(html, "script");
  let cleaned = strip_element(&cleaned, "style");
  let cleaned = strip_element(&cleaned, "noscript");
  let cleaned = strip_element(&cleaned, "iframe");
  let cleaned = strip_element(&cleaned, "object");

  let body = slice_between(&cleaned, "<body", "</body>").unwrap_or(cleaned);
  let trimmed = body.trim();

  if trimmed.is_empty() {
    return builder;
  }

  builder.chapters.push(Chapter {
    title,
    body: trimmed.to_string()
  });
  builder
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn scripts_are_removed_entirely() {
    let out = strip_element("<p>a</p><script>evil()</script><p>b</p>", "script");
    assert_eq!(out, "<p>a</p><p>b</p>");
  }

  #[test]
  fn a_similarly_named_tag_is_left_alone() {
    let out = strip_element("<scriptish>keep</scriptish>", "script");
    assert!(out.contains("keep"), "{out}");
  }

  #[test]
  fn an_unclosed_script_truncates_rather_than_leaking() {
    let out = strip_element("<p>a</p><script>oops", "script");
    assert_eq!(out, "<p>a</p>");
  }

  #[test]
  fn the_document_title_becomes_the_book_title() {
    let builder = build("<html><head><title>Real Title</title></head><body><p>x</p></body></html>", "Fallback");
    assert_eq!(builder.title, "Real Title");
  }

  #[test]
  fn a_missing_title_falls_back_to_the_file_name() {
    let builder = build("<html><body><p>x</p></body></html>", "Fallback");
    assert_eq!(builder.title, "Fallback");
  }

  #[test]
  fn only_the_body_is_kept() {
    let builder = build(
      "<html><head><title>T</title></head><body><p>keep</p></body></html>",
      "Fallback"
    );
    let body = &builder.chapters[0].body;
    assert!(body.contains("keep"), "{body}");
    assert!(!body.contains("<head>"), "{body}");
  }

  #[test]
  fn markup_without_a_body_tag_is_still_readable() {
    let builder = build("<p>bare fragment</p>", "Fallback");
    assert_eq!(builder.chapters.len(), 1);
    assert!(builder.chapters[0].body.contains("bare fragment"));
  }

  /// The bug this guards: tags were found in a lower-cased copy and cut out of
  /// the original by the same byte offsets. "İ" is two bytes and its lower case
  /// three, so every one before a tag moved the cut along by a byte: a Turkish
  /// page lost the start of its text, kept part of a script, or stopped the
  /// conversion with a cut through the middle of a letter.
  #[test]
  fn letters_that_change_length_in_lower_case_do_not_move_the_cuts() {
    let page = "<html><head><title>İstanbul İİİ</title><script>evil()</script></head>\
                <body><p>İyi günler, İstanbul’da KELVİN \u{212A}</p><script>more()</script><p>ığüşöç</p></body></html>";
    let builder = build(page, "Fallback");
    assert_eq!(builder.title, "İstanbul İİİ");
    assert_eq!(
      builder.chapters[0].body,
      "<p>İyi günler, İstanbul’da KELVİN \u{212A}</p><p>ığüşöç</p>"
    );

    assert_eq!(strip_element("İİİİ<script>x()</script>é", "script"), "İİİİé");
  }

  #[test]
  fn a_page_that_is_only_script_yields_nothing_to_read() {
    assert!(build("<html><body><script>x()</script></body></html>", "T").chapters.is_empty());
  }
}
