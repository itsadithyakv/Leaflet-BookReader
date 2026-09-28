//! FictionBook 2 to EPUB.
//!
//! FB2 is a single XML document: metadata in `<description>`, prose in nested
//! `<body><section>`, and images as base64 `<binary>` blobs at the end. That
//! maps onto XHTML closely enough to do in-process with the XML reader already
//! used for EPUB metadata.

use super::epub_builder::{escape_xml, Chapter, EpubBuilder, Image};
use super::{decode_text, read_zip_entry};
use anyhow::Result;
use base64::Engine;
use quick_xml::events::Event;
use quick_xml::Reader;
use std::path::Path;

pub fn from_fb2(source: &Path, fallback_title: &str) -> Result<EpubBuilder> {
  let bytes = std::fs::read(source)?;
  build(&decode_text(&bytes), fallback_title)
}

pub fn from_fb2_archive(source: &Path, fallback_title: &str) -> Result<EpubBuilder> {
  let entry = read_zip_entry(source, |name| name.ends_with(".fb2"))?
    .or(read_zip_entry(source, |name| name.ends_with(".xml"))?)
    .ok_or_else(|| anyhow::anyhow!("the archive contained no FB2 document"))?;
  build(&decode_text(&entry.1), fallback_title)
}

fn local_name(raw: &[u8]) -> String {
  let name = String::from_utf8_lossy(raw);
  name.rsplit(':').next().unwrap_or(&name).to_lowercase()
}

/// Tracks just enough of the FB2 tree to know what the current text belongs to.
#[derive(Default)]
struct State {
  in_description: bool,
  in_title_info: bool,
  in_author: bool,
  in_body: bool,
  in_binary: bool,
  capture: Option<String>,
  book_title: Option<String>,
  first_name: Option<String>,
  last_name: Option<String>,
  binary_id: Option<String>,
  binary_mime: Option<String>,
  binary_data: String,
  /// Depth of nested <section> elements, used to pick a heading level.
  section_depth: usize,
  pending_title: Option<String>
}

fn build(xml: &str, fallback_title: &str) -> Result<EpubBuilder> {
  let mut reader = Reader::from_str(xml);
  reader.trim_text(true);
  let mut buffer = Vec::new();
  let mut state = State::default();

  let mut chapters: Vec<Chapter> = Vec::new();
  let mut images: Vec<Image> = Vec::new();
  let mut body = String::new();
  let mut paragraph = String::new();

  loop {
    match reader.read_event_into(&mut buffer) {
      Ok(Event::Start(element)) => {
        let name = local_name(element.name().as_ref());
        match name.as_str() {
          "description" => state.in_description = true,
          "title-info" => state.in_title_info = true,
          "author" => state.in_author = true,
          "body" => state.in_body = true,
          "binary" => {
            state.in_binary = true;
            state.binary_data.clear();
            for attribute in element.attributes().flatten() {
              let key = local_name(attribute.key.as_ref());
              let value = attribute.unescape_value().unwrap_or_default().to_string();
              match key.as_str() {
                "id" => state.binary_id = Some(value),
                "content-type" => state.binary_mime = Some(value),
                _ => {}
              }
            }
          }
          "book-title" if state.in_title_info => state.capture = Some("book-title".into()),
          "first-name" if state.in_author => state.capture = Some("first-name".into()),
          "last-name" if state.in_author => state.capture = Some("last-name".into()),
          "section" if state.in_body => {
            state.section_depth += 1;
            // A new top-level section is a new chapter.
            if state.section_depth == 1 && !body.trim().is_empty() {
              chapters.push(Chapter {
                title: state
                  .pending_title
                  .take()
                  .unwrap_or_else(|| format!("Section {}", chapters.len() + 1)),
                body: std::mem::take(&mut body)
              });
            }
          }
          "title" if state.in_body => state.capture = Some("title".into()),
          "p" | "v" if state.in_body => paragraph.clear(),
          "empty-line" if state.in_body => body.push_str("<p><br/></p>\n"),
          "image" if state.in_body => {
            for attribute in element.attributes().flatten() {
              if local_name(attribute.key.as_ref()) == "href" {
                let href = attribute.unescape_value().unwrap_or_default();
                let id = href.trim_start_matches('#');
                body.push_str(&format!(
                  "<p><img src=\"../images/{}\" alt=\"\"/></p>\n",
                  escape_xml(id)
                ));
              }
            }
          }
          _ => {}
        }
      }
      Ok(Event::Empty(element)) => {
        let name = local_name(element.name().as_ref());
        if name == "empty-line" && state.in_body {
          body.push_str("<p><br/></p>\n");
        }
        if name == "image" && state.in_body {
          for attribute in element.attributes().flatten() {
            if local_name(attribute.key.as_ref()) == "href" {
              let href = attribute.unescape_value().unwrap_or_default();
              let id = href.trim_start_matches('#');
              body.push_str(&format!(
                "<p><img src=\"../images/{}\" alt=\"\"/></p>\n",
                escape_xml(id)
              ));
            }
          }
        }
      }
      Ok(Event::Text(text)) => {
        let value = text.unescape().unwrap_or_default().to_string();
        if state.in_binary {
          state.binary_data.push_str(value.trim());
        } else if let Some(kind) = state.capture.clone() {
          match kind.as_str() {
            "book-title" => state.book_title.get_or_insert(value),
            "first-name" => state.first_name.get_or_insert(value),
            "last-name" => state.last_name.get_or_insert(value),
            "title" => {
              let existing = state.pending_title.take().unwrap_or_default();
              state.pending_title = Some(if existing.is_empty() {
                value.clone()
              } else {
                format!("{existing} {value}")
              });
              &mut String::new()
            }
            _ => &mut String::new()
          };
        } else if state.in_body {
          paragraph.push_str(&value);
        }
      }
      Ok(Event::End(element)) => {
        let name = local_name(element.name().as_ref());
        match name.as_str() {
          "description" => state.in_description = false,
          "title-info" => state.in_title_info = false,
          "author" => state.in_author = false,
          "body" => state.in_body = false,
          "binary" => {
            state.in_binary = false;
            if let (Some(id), Some(mime)) = (state.binary_id.take(), state.binary_mime.take()) {
              if let Ok(bytes) = base64::engine::general_purpose::STANDARD
                .decode(state.binary_data.replace(['\n', '\r', ' '], ""))
              {
                // The href in the body is `#id`, so the file is named for the
                // id and referenced verbatim.
                images.push(Image { name: id, mime, bytes });
              }
            }
            state.binary_data.clear();
          }
          "section" if state.in_body => {
            state.section_depth = state.section_depth.saturating_sub(1);
          }
          "title" if state.in_body => {
            state.capture = None;
            if let Some(heading) = state.pending_title.clone() {
              let level = if state.section_depth <= 1 { 2 } else { 3 };
              body.push_str(&format!(
                "<h{level}>{}</h{level}>\n",
                escape_xml(heading.trim())
              ));
            }
          }
          "p" | "v" if state.in_body => {
            let text = paragraph.trim();
            if !text.is_empty() {
              body.push_str(&format!("<p>{}</p>\n", escape_xml(text)));
            }
            paragraph.clear();
          }
          "book-title" | "first-name" | "last-name" => state.capture = None,
          _ => {}
        }
      }
      Ok(Event::Eof) => break,
      Err(error) => return Err(anyhow::anyhow!("could not read the FB2 file: {error}")),
      _ => {}
    }
    buffer.clear();
  }

  if !body.trim().is_empty() {
    chapters.push(Chapter {
      title: state
        .pending_title
        .take()
        .unwrap_or_else(|| format!("Section {}", chapters.len() + 1)),
      body
    });
  }

  let title = state
    .book_title
    .filter(|value| !value.trim().is_empty())
    .unwrap_or_else(|| fallback_title.to_string());

  let author = match (state.first_name, state.last_name) {
    (Some(first), Some(last)) => Some(format!("{} {}", first.trim(), last.trim())),
    (Some(only), None) | (None, Some(only)) => Some(only.trim().to_string()),
    (None, None) => None
  };

  Ok(EpubBuilder {
    title,
    author: author.filter(|value| !value.is_empty()),
    chapters,
    images
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  const SAMPLE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <book-title>The Real Title</book-title>
      <author><first-name>Ada</first-name><last-name>Lovelace</last-name></author>
    </title-info>
  </description>
  <body>
    <section>
      <title><p>First Chapter</p></title>
      <p>Hello &amp; welcome.</p>
      <p>Second paragraph.</p>
    </section>
    <section>
      <title><p>Second Chapter</p></title>
      <p>More text.</p>
    </section>
  </body>
</FictionBook>"#;

  #[test]
  fn metadata_comes_from_the_document() {
    let builder = build(SAMPLE, "Fallback").expect("parse");
    assert_eq!(builder.title, "The Real Title");
    assert_eq!(builder.author.as_deref(), Some("Ada Lovelace"));
  }

  #[test]
  fn each_top_level_section_becomes_a_chapter() {
    let builder = build(SAMPLE, "Fallback").expect("parse");
    assert_eq!(builder.chapters.len(), 2, "{:?}", builder.chapters.len());
    assert_eq!(builder.chapters[0].title, "First Chapter");
    assert_eq!(builder.chapters[1].title, "Second Chapter");
  }

  #[test]
  fn entities_are_decoded_then_re_escaped_once() {
    let builder = build(SAMPLE, "Fallback").expect("parse");
    let body = &builder.chapters[0].body;
    assert!(body.contains("Hello &amp; welcome."), "{body}");
    assert!(!body.contains("&amp;amp;"), "{body}");
  }

  #[test]
  fn a_namespaced_document_still_parses() {
    let xml = SAMPLE.replace("<body>", "<fb:body xmlns:fb=\"x\">")
      .replace("</body>", "</fb:body>");
    let builder = build(&xml, "Fallback").expect("parse");
    assert!(!builder.chapters.is_empty());
  }

  #[test]
  fn embedded_images_are_extracted() {
    let xml = r#"<FictionBook><body><section><p>x</p></section></body>
      <binary id="cover.jpg" content-type="image/jpeg">aGVsbG8=</binary></FictionBook>"#;
    let builder = build(xml, "Fallback").expect("parse");
    assert_eq!(builder.images.len(), 1);
    assert_eq!(builder.images[0].name, "cover.jpg");
    assert_eq!(builder.images[0].bytes, b"hello");
  }

  #[test]
  fn a_missing_title_falls_back() {
    let builder = build("<FictionBook><body><section><p>x</p></section></body></FictionBook>", "Fallback")
      .expect("parse");
    assert_eq!(builder.title, "Fallback");
  }

  #[test]
  fn malformed_xml_reports_an_error_rather_than_panicking() {
    let result = build("<FictionBook><body><section><p>unclosed", "Fallback");
    // Either a parse error or an empty book is acceptable; a panic is not.
    if let Ok(builder) = result {
      assert!(builder.chapters.len() <= 1);
    }
  }
}
