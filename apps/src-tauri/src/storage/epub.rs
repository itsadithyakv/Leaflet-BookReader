//! An EPUB's package: found the way the format says (through
//! `META-INF/container.xml`), then read for the title and author, the series it
//! belongs to, the cover image inside the book, and the size of each section in
//! reading order.
//!
//! The package used to be found by guessing its name (`content.opf` or
//! `package.opf`), so books that named it anything else lost their title, and
//! covers came only from the internet, so an offline reader, an obscure title
//! or a self-published book showed no cover at all.

use anyhow::{anyhow, Result};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

/// Covers larger than this are not read into memory.
const MAX_COVER_BYTES: u64 = 15 * 1024 * 1024;

struct Item {
  href: String,
  media_type: String,
  properties: String
}

struct Itemref {
  idref: String,
  linear: bool
}

pub struct Package {
  /// The package's path inside the archive, e.g. `OEBPS/content.opf`.
  opf_path: String,
  pub title: Option<String>,
  pub author: Option<String>,
  manifest: HashMap<String, Item>,
  spine: Vec<Itemref>,
  /// EPUB 2: `<meta name="cover" content="item-id"/>`.
  cover_id: Option<String>,
  /// The series the book belongs to, and its number in it, when the book says
  /// (see `pick_series`).
  pub series: Option<String>,
  pub series_index: Option<f32>
}

/// A `<meta property="...">` with text, EPUB 3's way of describing the book.
struct PropertyMeta {
  id: Option<String>,
  /// `refines="#id"`: which other meta this one describes, without the `#`.
  refines: Option<String>,
  property: String,
  value: String
}

/// A series number as written ("3", "2.5", "03"). Anything else, or a number no
/// series reaches, is not one.
fn series_number(text: &str) -> Option<f32> {
  text
    .trim()
    .parse::<f32>()
    .ok()
    .filter(|value| value.is_finite() && *value >= 0.0 && *value < 10_000.0)
}

/// The series, from EPUB 3's `belongs-to-collection` (a collection typed
/// `series`, or untyped; a `set` is a boxed set, not a series) or else Calibre's
/// `calibre:series` metas, which most converted books carry.
fn pick_series(
  metas: &[PropertyMeta],
  calibre: Option<String>,
  calibre_index: Option<f32>
) -> (Option<String>, Option<f32>) {
  let refined = |id: &str, property: &str| {
    metas
      .iter()
      .find(|meta| meta.refines.as_deref() == Some(id) && meta.property == property)
      .map(|meta| meta.value.as_str())
  };
  let epub3 = metas
    .iter()
    .filter(|meta| meta.property == "belongs-to-collection" && !meta.value.is_empty())
    .filter_map(|meta| {
      let kind = meta.id.as_deref().and_then(|id| refined(id, "collection-type"));
      match kind {
        Some("set") => None,
        _ => Some((kind == Some("series"), meta))
      }
    })
    // A collection that says it is a series beats one that does not say; among
    // equals, the first written.
    .fold(None, |best: Option<(bool, &PropertyMeta)>, (is_series, meta)| match best {
      Some((true, _)) => best,
      Some((false, _)) if !is_series => best,
      _ => Some((is_series, meta))
    })
    .map(|(_, meta)| {
      let index = meta.id.as_deref().and_then(|id| refined(id, "group-position")).and_then(series_number);
      (meta.value.clone(), index)
    });
  match epub3 {
    Some((name, index)) => (Some(name), index.or(calibre_index)),
    None => (calibre.clone(), calibre.and(calibre_index))
  }
}

/// One section of the book, in reading order.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
  /// As written in the manifest, relative to the package (as epub.js has it).
  pub href: String,
  /// Uncompressed size: how much text (and markup) the section holds.
  pub bytes: u64,
  /// `linear="no"` sections (pop-up notes, say) sit outside the reading order.
  pub linear: bool
}

type Archive = ZipArchive<fs::File>;

fn open_archive(path: &Path) -> Result<Archive> {
  Ok(ZipArchive::new(fs::File::open(path)?)?)
}

/// An element or attribute name without its namespace prefix, lower-cased.
fn local(name: &[u8]) -> String {
  let name = String::from_utf8_lossy(name);
  name.rsplit(':').next().unwrap_or(&name).to_ascii_lowercase()
}

fn attr(element: &BytesStart<'_>, key: &str) -> Option<String> {
  element
    .attributes()
    .flatten()
    .find(|attribute| local(attribute.key.as_ref()) == key)
    .and_then(|attribute| attribute.unescape_value().ok().map(|value| value.to_string()))
}

fn read_text(archive: &mut Archive, name: &str) -> Result<String> {
  let mut file = archive.by_name(name)?;
  let mut text = String::new();
  file.read_to_string(&mut text)?;
  Ok(text)
}

/// Where the package is: `META-INF/container.xml` names it; failing that, the
/// first `.opf` file in the archive.
fn find_opf(archive: &mut Archive) -> Result<String> {
  if let Ok(container) = read_text(archive, "META-INF/container.xml") {
    let mut reader = Reader::from_str(&container);
    let mut buf = Vec::new();
    loop {
      match reader.read_event_into(&mut buf) {
        Ok(Event::Start(e)) | Ok(Event::Empty(e)) if local(e.name().as_ref()) == "rootfile" => {
          let media = attr(&e, "media-type").unwrap_or_default();
          if let Some(path) = attr(&e, "full-path") {
            if media.is_empty() || media == "application/oebps-package+xml" {
              return Ok(path);
            }
          }
        }
        Ok(Event::Eof) | Err(_) => break,
        _ => {}
      }
      buf.clear();
    }
  }
  (0..archive.len())
    .filter_map(|index| archive.by_index(index).ok().map(|file| file.name().to_string()))
    .find(|name| name.to_ascii_lowercase().ends_with(".opf"))
    .ok_or_else(|| anyhow!("this EPUB has no package document"))
}

fn parse(opf_path: String, xml: &str) -> Package {
  let mut package = Package {
    opf_path,
    title: None,
    author: None,
    manifest: HashMap::new(),
    spine: Vec::new(),
    cover_id: None,
    series: None,
    series_index: None
  };
  let mut reader = Reader::from_str(xml);
  reader.trim_text(true);
  let mut buf = Vec::new();
  let mut capture: Option<&'static str> = None;
  let mut metas: Vec<PropertyMeta> = Vec::new();
  // The `<meta property>` whose text is being read.
  let mut open_meta: Option<PropertyMeta> = None;
  let mut calibre_series: Option<String> = None;
  let mut calibre_index: Option<f32> = None;
  loop {
    let event = reader.read_event_into(&mut buf);
    let is_start = matches!(event, Ok(Event::Start(_)));
    match event {
      Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match local(e.name().as_ref()).as_str() {
        "title" if package.title.is_none() => capture = Some("title"),
        "creator" if package.author.is_none() => capture = Some("creator"),
        "item" => {
          if let (Some(id), Some(href)) = (attr(&e, "id"), attr(&e, "href")) {
            package.manifest.insert(
              id,
              Item {
                href,
                media_type: attr(&e, "media-type").unwrap_or_default(),
                properties: attr(&e, "properties").unwrap_or_default()
              }
            );
          }
        }
        "itemref" => {
          if let Some(idref) = attr(&e, "idref") {
            let linear = attr(&e, "linear").map(|value| value != "no").unwrap_or(true);
            package.spine.push(Itemref { idref, linear });
          }
        }
        "meta" => {
          match attr(&e, "name").as_deref() {
            Some("cover") => package.cover_id = attr(&e, "content"),
            Some("calibre:series") => {
              calibre_series = attr(&e, "content").map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
            }
            Some("calibre:series_index") => {
              calibre_index = attr(&e, "content").as_deref().and_then(series_number);
            }
            _ => {}
          }
          if let (true, Some(property)) = (is_start, attr(&e, "property")) {
            open_meta = Some(PropertyMeta {
              id: attr(&e, "id"),
              refines: attr(&e, "refines").map(|value| value.trim_start_matches('#').to_string()),
              property,
              value: String::new()
            });
          }
        }
        _ => {}
      },
      Ok(Event::Text(text)) => {
        if let Some(meta) = open_meta.as_mut() {
          meta.value = text.unescape().map(|value| value.trim().to_string()).unwrap_or_default();
        }
        if let Some(kind) = capture {
          let value = text.unescape().map(|value| value.trim().to_string()).unwrap_or_default();
          if !value.is_empty() {
            match kind {
              "title" => package.title = Some(value),
              _ => package.author = Some(value)
            }
          }
        }
      }
      Ok(Event::End(_)) => {
        capture = None;
        if let Some(meta) = open_meta.take() {
          metas.push(meta);
        }
      }
      Ok(Event::Eof) | Err(_) => break,
      _ => {}
    }
    buf.clear();
  }
  let (series, series_index) = pick_series(&metas, calibre_series, calibre_index);
  package.series = series;
  package.series_index = series_index;
  package
}

/// A manifest href as a path inside the archive: relative to the package's
/// folder, percent-decoded, with `.` and `..` resolved.
fn archive_path(opf_path: &str, href: &str) -> String {
  let href = href.split('#').next().unwrap_or(href);
  let decoded = urlencoding::decode(href).map(|value| value.into_owned()).unwrap_or_else(|_| href.to_string());
  let base = opf_path.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");
  let mut parts: Vec<&str> = if decoded.starts_with('/') || base.is_empty() {
    Vec::new()
  } else {
    base.split('/').collect()
  };
  for part in decoded.trim_start_matches('/').split('/') {
    match part {
      "" | "." => {}
      ".." => {
        parts.pop();
      }
      other => parts.push(other)
    }
  }
  parts.join("/")
}

impl Package {
  /// The cover image's path in the archive: the EPUB 3 `cover-image` item, the
  /// EPUB 2 `<meta name="cover">` item, or an image named like a cover.
  fn cover_path(&self) -> Option<String> {
    let is_image = |item: &Item| item.media_type.starts_with("image/");
    let chosen = self
      .manifest
      .values()
      .find(|item| is_image(item) && item.properties.split_whitespace().any(|p| p == "cover-image"))
      .or_else(|| {
        self
          .cover_id
          .as_deref()
          .and_then(|id| self.manifest.get(id))
          .filter(|item| is_image(item))
      })
      .or_else(|| {
        let mut named: Vec<(&String, &Item)> = self
          .manifest
          .iter()
          .filter(|(id, item)| is_image(item) && (id.to_ascii_lowercase().contains("cover") || item.href.to_ascii_lowercase().contains("cover")))
          .collect();
        named.sort_by(|a, b| a.0.cmp(b.0));
        named.first().map(|(_, item)| *item)
      })?;
    Some(archive_path(&self.opf_path, &chosen.href))
  }
}

fn read_package(archive: &mut Archive) -> Result<Package> {
  let opf_path = find_opf(archive)?;
  let xml = read_text(archive, &opf_path)?;
  Ok(parse(opf_path, &xml))
}

/// The package of the EPUB at `path`: title, author and the rest.
pub fn package(path: &Path) -> Result<Package> {
  read_package(&mut open_archive(path)?)
}

/// The cover image inside the book, if it has one. Only real images count
/// (the bytes are checked), and very large ones are skipped.
pub fn cover(path: &Path) -> Result<Option<Vec<u8>>> {
  let mut archive = open_archive(path)?;
  let package = read_package(&mut archive)?;
  let Some(cover) = package.cover_path() else {
    return Ok(None);
  };
  let mut file = match archive.by_name(&cover) {
    Ok(file) => file,
    Err(_) => return Ok(None)
  };
  if file.size() > MAX_COVER_BYTES {
    return Ok(None);
  }
  let mut bytes = Vec::with_capacity(file.size() as usize);
  file.read_to_end(&mut bytes)?;
  Ok(super::sniff_image_mime(&bytes).map(|_| bytes))
}

/// Every section in reading order with its size, read from the archive's
/// directory (nothing is decompressed), for progress that reflects how much
/// of the book is behind the reader rather than how many chapters.
pub fn sections(path: &Path) -> Result<Vec<Section>> {
  let mut archive = open_archive(path)?;
  let package = read_package(&mut archive)?;
  let mut out = Vec::with_capacity(package.spine.len());
  for itemref in &package.spine {
    let Some(item) = package.manifest.get(&itemref.idref) else {
      continue;
    };
    let inside = archive_path(&package.opf_path, &item.href);
    let bytes = archive.by_name(&inside).map(|file| file.size()).unwrap_or(0);
    out.push(Section {
      href: item.href.clone(),
      bytes,
      linear: itemref.linear
    });
  }
  Ok(out)
}

#[cfg(test)]
mod tests {
  use super::*;

  const OPF: &str = r#"<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
      <metadata>
        <dc:title>The Hobbit</dc:title>
        <dc:creator>J. R. R. Tolkien</dc:creator>
        <meta name="cover" content="old-cover"/>
      </metadata>
      <manifest>
        <item id="old-cover" href="images/old.jpg" media-type="image/jpeg"/>
        <item id="c" href="images/Cover%20Art.png" media-type="image/png" properties="cover-image"/>
        <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="note" href="../notes.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="ch1"/>
        <itemref idref="note" linear="no"/>
      </spine>
    </package>"#;

  #[test]
  fn reads_title_author_spine_and_the_epub3_cover() {
    let package = parse("OEBPS/content.opf".into(), OPF);
    assert_eq!(package.title.as_deref(), Some("The Hobbit"));
    assert_eq!(package.author.as_deref(), Some("J. R. R. Tolkien"));
    assert_eq!(package.spine.len(), 2);
    assert!(!package.spine[1].linear);
    // EPUB 3's cover-image wins over EPUB 2's meta, and the href is decoded.
    assert_eq!(package.cover_path().as_deref(), Some("OEBPS/images/Cover Art.png"));
  }

  #[test]
  fn falls_back_to_the_epub2_cover_meta() {
    let opf = OPF.replace(r#" properties="cover-image""#, "");
    let package = parse("content.opf".into(), &opf);
    assert_eq!(package.cover_path().as_deref(), Some("images/old.jpg"));
  }

  #[test]
  fn reads_the_series_calibre_writes() {
    let opf = OPF.replace(
      r#"<meta name="cover" content="old-cover"/>"#,
      r#"<meta name="calibre:series" content="Harry Potter"/>
        <meta name="calibre:series_index" content="2.0"/>"#
    );
    let package = parse("content.opf".into(), &opf);
    assert_eq!(package.series.as_deref(), Some("Harry Potter"));
    assert_eq!(package.series_index, Some(2.0));
  }

  #[test]
  fn prefers_an_epub3_series_collection_and_skips_a_boxed_set() {
    let opf = OPF.replace(
      r#"<meta name="cover" content="old-cover"/>"#,
      r##"<meta property="belongs-to-collection" id="box">The Complete Set</meta>
        <meta refines="#box" property="collection-type">set</meta>
        <meta property="belongs-to-collection" id="c01">The Stormlight Archive</meta>
        <meta refines="#c01" property="collection-type">series</meta>
        <meta refines="#c01" property="group-position">3</meta>
        <meta name="calibre:series" content="Stormlight"/>
        <meta name="calibre:series_index" content="9"/>"##
    );
    let package = parse("content.opf".into(), &opf);
    assert_eq!(package.series.as_deref(), Some("The Stormlight Archive"));
    assert_eq!(package.series_index, Some(3.0));
    // The title is still the title: series metas do not leak into it.
    assert_eq!(package.title.as_deref(), Some("The Hobbit"));
  }

  #[test]
  fn a_book_without_a_series_has_none() {
    let package = parse("content.opf".into(), OPF);
    assert_eq!(package.series, None);
    assert_eq!(package.series_index, None);
    assert_eq!(series_number("third"), None);
    assert_eq!(series_number(" 03 "), Some(3.0));
  }

  #[test]
  fn resolves_paths_relative_to_the_package() {
    assert_eq!(archive_path("OEBPS/content.opf", "text/ch1.xhtml#p3"), "OEBPS/text/ch1.xhtml");
    assert_eq!(archive_path("OEBPS/content.opf", "../notes.xhtml"), "notes.xhtml");
    assert_eq!(archive_path("content.opf", "./a/b.xhtml"), "a/b.xhtml");
  }
}
