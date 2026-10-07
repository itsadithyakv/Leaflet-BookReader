//! Assembles a minimal but valid EPUB.
//!
//! The builtin converters all funnel through this so the rest of the pipeline —
//! the on-disk conversion cache, epub.js, progress tracking, Dotty — sees the
//! same thing regardless of what the source file was.

use anyhow::Result;
use std::io::Write;
use std::path::Path;
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipWriter};

pub struct Chapter {
  /// What the contents list calls it. A chapter with no title is in the book
  /// and not in the list: the next piece of a long chapter, a page between
  /// two named ones.
  pub title: String,
  /// Body markup only; the builder wraps it in an XHTML document.
  pub body: String
}

pub struct Image {
  /// File name within OEBPS/images, e.g. `img1.jpeg`.
  pub name: String,
  pub mime: String,
  pub bytes: Vec<u8>
}

pub struct EpubBuilder {
  pub title: String,
  pub author: Option<String>,
  pub chapters: Vec<Chapter>,
  pub images: Vec<Image>
}

/// Escapes text for use in XML character data or an attribute value.
pub fn escape_xml(value: &str) -> String {
  let mut out = String::with_capacity(value.len());
  for character in value.chars() {
    match character {
      '&' => out.push_str("&amp;"),
      '<' => out.push_str("&lt;"),
      '>' => out.push_str("&gt;"),
      '"' => out.push_str("&quot;"),
      '\'' => out.push_str("&apos;"),
      // XML 1.0 forbids most control characters outright.
      c if (c as u32) < 0x20 && c != '\n' && c != '\r' && c != '\t' => out.push(' '),
      c => out.push(c)
    }
  }
  out
}

impl EpubBuilder {
  pub fn new(title: impl Into<String>) -> Self {
    Self {
      title: title.into(),
      author: None,
      chapters: Vec::new(),
      images: Vec::new()
    }
  }

  pub fn write_to(&self, path: &Path) -> Result<()> {
    if self.chapters.is_empty() {
      return Err(anyhow::anyhow!("the book had no readable text"));
    }

    let file = std::fs::File::create(path)?;
    let mut zip = ZipWriter::new(file);

    // The spec requires `mimetype` first and stored uncompressed.
    zip.start_file(
      "mimetype",
      FileOptions::default().compression_method(CompressionMethod::Stored)
    )?;
    zip.write_all(b"application/epub+zip")?;

    let deflated = FileOptions::default().compression_method(CompressionMethod::Deflated);

    zip.start_file("META-INF/container.xml", deflated)?;
    zip.write_all(
      br#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#
    )?;

    for (index, chapter) in self.chapters.iter().enumerate() {
      zip.start_file(format!("OEBPS/text/chapter{}.xhtml", index + 1), deflated)?;
      zip.write_all(self.chapter_document(chapter).as_bytes())?;
    }

    for image in &self.images {
      zip.start_file(format!("OEBPS/images/{}", image.name), deflated)?;
      zip.write_all(&image.bytes)?;
    }

    zip.start_file("OEBPS/content.opf", deflated)?;
    zip.write_all(self.package_document().as_bytes())?;

    // epub.js reads either, and emitting both keeps the chapter list working
    // whichever path it takes.
    zip.start_file("OEBPS/nav.xhtml", deflated)?;
    zip.write_all(self.nav_document().as_bytes())?;

    zip.start_file("OEBPS/toc.ncx", deflated)?;
    zip.write_all(self.ncx_document().as_bytes())?;

    zip.finish()?;
    Ok(())
  }

  fn chapter_document(&self, chapter: &Chapter) -> String {
    format!(
      r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head><meta charset="utf-8"/><title>{}</title></head>
<body>
{}
</body>
</html>"#,
      escape_xml(&chapter.title),
      chapter.body
    )
  }

  fn package_document(&self) -> String {
    let mut manifest = String::new();
    let mut spine = String::new();

    for index in 0..self.chapters.len() {
      let id = index + 1;
      manifest.push_str(&format!(
        "    <item id=\"chapter{id}\" href=\"text/chapter{id}.xhtml\" media-type=\"application/xhtml+xml\"/>\n"
      ));
      spine.push_str(&format!("    <itemref idref=\"chapter{id}\"/>\n"));
    }

    for (index, image) in self.images.iter().enumerate() {
      manifest.push_str(&format!(
        "    <item id=\"img{}\" href=\"images/{}\" media-type=\"{}\"/>\n",
        index + 1,
        escape_xml(&image.name),
        escape_xml(&image.mime)
      ));
    }

    let author = self.author.as_deref().unwrap_or("Unknown");
    format!(
      r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">leaflet-{}</dc:identifier>
    <dc:title>{}</dc:title>
    <dc:creator>{}</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
{}  </manifest>
  <spine toc="ncx">
{}  </spine>
</package>"#,
      self.chapters.len(),
      escape_xml(&self.title),
      escape_xml(author),
      manifest,
      spine
    )
  }

  fn nav_document(&self) -> String {
    let mut items = String::new();
    for (index, chapter) in self.chapters.iter().enumerate() {
      if chapter.title.is_empty() {
        continue;
      }
      items.push_str(&format!(
        "      <li><a href=\"text/chapter{}.xhtml\">{}</a></li>\n",
        index + 1,
        escape_xml(&chapter.title)
      ));
    }
    format!(
      r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8"/><title>{}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
{}    </ol>
  </nav>
</body>
</html>"#,
      escape_xml(&self.title),
      items
    )
  }

  fn ncx_document(&self) -> String {
    let mut points = String::new();
    let mut order = 0;
    for (index, chapter) in self.chapters.iter().enumerate() {
      if chapter.title.is_empty() {
        continue;
      }
      let id = index + 1;
      order += 1;
      points.push_str(&format!(
        r#"    <navPoint id="navpoint{id}" playOrder="{order}">
      <navLabel><text>{}</text></navLabel>
      <content src="text/chapter{id}.xhtml"/>
    </navPoint>
"#,
        escape_xml(&chapter.title)
      ));
    }
    format!(
      r#"<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="leaflet-{}"/></head>
  <docTitle><text>{}</text></docTitle>
  <navMap>
{}  </navMap>
</ncx>"#,
      self.chapters.len(),
      escape_xml(&self.title),
      points
    )
  }
}
