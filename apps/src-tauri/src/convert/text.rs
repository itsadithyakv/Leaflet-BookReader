//! Plain text to EPUB.

use super::epub_builder::{escape_xml, Chapter, EpubBuilder};
use super::{decode_text, read_zip_entry};
use anyhow::Result;
use std::path::Path;

/// Paragraphs per generated chapter. A single multi-megabyte XHTML document
/// makes epub.js slow to lay out and gives the reader no chapter list at all.
const PARAGRAPHS_PER_CHAPTER: usize = 150;

pub fn from_plain_text(source: &Path, fallback_title: &str) -> Result<EpubBuilder> {
  let bytes = std::fs::read(source)?;
  Ok(build(&decode_text(&bytes), fallback_title))
}

pub fn from_text_archive(source: &Path, fallback_title: &str) -> Result<EpubBuilder> {
  let entry = read_zip_entry(source, |name| name.ends_with(".txt"))?
    .ok_or_else(|| anyhow::anyhow!("the archive contained no text file"))?;
  Ok(build(&decode_text(&entry.1), fallback_title))
}

/// Splits on blank lines. Text files also commonly use a single newline per
/// line within a wrapped paragraph, so consecutive non-blank lines are joined.
fn paragraphs(text: &str) -> Vec<String> {
  let normalised = text.replace("\r\n", "\n").replace('\r', "\n");
  let mut result = Vec::new();
  let mut current = String::new();

  for line in normalised.split('\n') {
    let trimmed = line.trim();
    if trimmed.is_empty() {
      if !current.trim().is_empty() {
        result.push(current.trim().to_string());
      }
      current.clear();
    } else {
      if !current.is_empty() {
        current.push(' ');
      }
      current.push_str(trimmed);
    }
  }
  if !current.trim().is_empty() {
    result.push(current.trim().to_string());
  }
  result
}

/// Recognises the headings plain-text books actually use, so the chapter list is
/// meaningful instead of "Part 1, Part 2".
fn heading_for(paragraph: &str) -> Option<String> {
  let trimmed = paragraph.trim();
  if trimmed.len() > 60 || trimmed.is_empty() {
    return None;
  }
  let lowered = trimmed.to_lowercase();
  let looks_like_heading = lowered.starts_with("chapter ")
    || lowered.starts_with("part ")
    || lowered.starts_with("book ")
    || lowered == "prologue"
    || lowered == "epilogue"
    || lowered == "foreword"
    || lowered == "introduction";
  if looks_like_heading {
    return Some(trimmed.to_string());
  }
  None
}

fn build(text: &str, fallback_title: &str) -> EpubBuilder {
  let mut builder = EpubBuilder::new(fallback_title);
  let paragraphs = paragraphs(text);

  if paragraphs.is_empty() {
    return builder;
  }

  let mut body = String::new();
  let mut title: Option<String> = None;
  let mut count = 0usize;

  let flush = |body: &mut String, title: &mut Option<String>, builder: &mut EpubBuilder| {
    if body.trim().is_empty() {
      return;
    }
    let index = builder.chapters.len() + 1;
    builder.chapters.push(Chapter {
      title: title.take().unwrap_or_else(|| format!("Part {index}")),
      body: std::mem::take(body)
    });
  };

  for paragraph in paragraphs {
    if let Some(heading) = heading_for(&paragraph) {
      // Start a new chapter at a recognised heading rather than mid-scene.
      flush(&mut body, &mut title, &mut builder);
      count = 0;
      title = Some(heading.clone());
      body.push_str(&format!("<h2>{}</h2>\n", escape_xml(&heading)));
      continue;
    }

    body.push_str(&format!("<p>{}</p>\n", escape_xml(&paragraph)));
    count += 1;

    if count >= PARAGRAPHS_PER_CHAPTER {
      flush(&mut body, &mut title, &mut builder);
      count = 0;
    }
  }

  flush(&mut body, &mut title, &mut builder);
  builder
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn wrapped_lines_join_into_one_paragraph() {
    let result = paragraphs("the quick\nbrown fox\n\njumped over");
    assert_eq!(result, vec!["the quick brown fox", "jumped over"]);
  }

  #[test]
  fn windows_line_endings_are_handled() {
    let result = paragraphs("one\r\n\r\ntwo");
    assert_eq!(result, vec!["one", "two"]);
  }

  #[test]
  fn markup_in_the_source_is_escaped_not_rendered() {
    let builder = build("a <script>alert(1)</script> b", "Book");
    let body = &builder.chapters[0].body;
    assert!(body.contains("&lt;script&gt;"), "{body}");
    assert!(!body.contains("<script>"), "{body}");
  }

  #[test]
  fn recognised_headings_start_new_chapters() {
    let builder = build("Chapter 1\n\nfirst\n\nChapter 2\n\nsecond", "Book");
    assert_eq!(builder.chapters.len(), 2);
    assert_eq!(builder.chapters[0].title, "Chapter 1");
    assert_eq!(builder.chapters[1].title, "Chapter 2");
  }

  #[test]
  fn long_text_without_headings_is_split_into_parts() {
    let text = (0..400).map(|i| format!("para {i}")).collect::<Vec<_>>().join("\n\n");
    let builder = build(&text, "Book");
    assert!(builder.chapters.len() >= 2, "{}", builder.chapters.len());
    assert_eq!(builder.chapters[0].title, "Part 1");
  }

  #[test]
  fn an_empty_file_produces_no_chapters() {
    assert!(build("   \n\n  ", "Book").chapters.is_empty());
  }

  #[test]
  fn a_sentence_that_merely_mentions_a_chapter_is_not_a_heading() {
    assert!(heading_for("She read the chapter again and again, slowly, twice over").is_none());
  }
}
