//! In-process converters for formats that are cheap to turn into EPUB.
//!
//! These exist so the common long tail — plain text, saved web pages, FB2 —
//! opens with no external dependency. Anything genuinely hard (Kindle
//! containers, OOXML, CHM) stays with Calibre; see `storage::ensure_epub_version`.

pub mod epub_builder;
mod fb2;
mod html;
mod text;

use anyhow::Result;
use std::path::Path;

/// Whether a builtin converter exists for this extension.
pub fn handles(extension: &str) -> bool {
  matches!(
    extension,
    "txt" | "txtz" | "html" | "htm" | "xhtml" | "htmlz" | "fb2" | "fbz"
  )
}

/// Converts `source` into an EPUB at `target`. `fallback_title` is used when the
/// source carries no title of its own.
pub fn to_epub(source: &Path, target: &Path, fallback_title: &str) -> Result<()> {
  let extension = source
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or("")
    .to_lowercase();

  if !handles(&extension) {
    return Err(anyhow::anyhow!("no builtin converter for .{extension}"));
  }

  let builder = match extension.as_str() {
    "txt" => text::from_plain_text(source, fallback_title)?,
    "txtz" => text::from_text_archive(source, fallback_title)?,
    "html" | "htm" | "xhtml" => html::from_html(source, fallback_title)?,
    "htmlz" => html::from_html_archive(source, fallback_title)?,
    "fb2" => fb2::from_fb2(source, fallback_title)?,
    "fbz" => fb2::from_fb2_archive(source, fallback_title)?,
    other => return Err(anyhow::anyhow!("no builtin converter for .{other}"))
  };

  builder.write_to(target)
}

/// Reads a file as text, honouring a BOM. Files without one are treated as
/// UTF-8 and repaired lossily rather than refused — plain-text books are often
/// legacy encodings and a mangled character beats an unopenable book.
pub(crate) fn decode_text(bytes: &[u8]) -> String {
  if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
    return String::from_utf8_lossy(&bytes[3..]).into_owned();
  }
  if bytes.starts_with(&[0xFF, 0xFE]) {
    return decode_utf16(&bytes[2..], true);
  }
  if bytes.starts_with(&[0xFE, 0xFF]) {
    return decode_utf16(&bytes[2..], false);
  }
  String::from_utf8_lossy(bytes).into_owned()
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
  let units: Vec<u16> = bytes
    .chunks_exact(2)
    .map(|pair| {
      if little_endian {
        u16::from_le_bytes([pair[0], pair[1]])
      } else {
        u16::from_be_bytes([pair[0], pair[1]])
      }
    })
    .collect();
  String::from_utf16_lossy(&units)
}

/// Pulls the first entry matching `pick` out of a zip archive.
pub(crate) fn read_zip_entry(
  path: &Path,
  pick: impl Fn(&str) -> bool
) -> Result<Option<(String, Vec<u8>)>> {
  use std::io::Read;
  let file = std::fs::File::open(path)?;
  let mut archive = zip::ZipArchive::new(file)?;
  let mut chosen: Option<String> = None;
  for index in 0..archive.len() {
    let entry = archive.by_index(index)?;
    if entry.is_file() && pick(&entry.name().to_lowercase()) {
      chosen = Some(entry.name().to_string());
      break;
    }
  }
  let Some(name) = chosen else {
    return Ok(None);
  };
  let mut entry = archive.by_name(&name)?;
  let mut bytes = Vec::new();
  entry.read_to_end(&mut bytes)?;
  Ok(Some((name, bytes)))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_utf8_bom_is_stripped() {
    assert_eq!(decode_text(b"\xEF\xBB\xBFhello"), "hello");
  }

  #[test]
  fn utf16_little_endian_is_decoded() {
    let bytes = [0xFF, 0xFE, b'h', 0x00, b'i', 0x00];
    assert_eq!(decode_text(&bytes), "hi");
  }

  #[test]
  fn utf16_big_endian_is_decoded() {
    let bytes = [0xFE, 0xFF, 0x00, b'h', 0x00, b'i'];
    assert_eq!(decode_text(&bytes), "hi");
  }

  #[test]
  fn undecodable_bytes_do_not_fail_the_book() {
    assert!(!decode_text(&[b'a', 0xFF, b'b']).is_empty());
  }

  fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join("leaflet-convert-tests");
    std::fs::create_dir_all(&dir).expect("scratch dir");
    dir.join(name)
  }

  /// Opens the produced file the way a reader would and returns its entries.
  fn epub_entries(path: &Path) -> Vec<String> {
    let file = std::fs::File::open(path).expect("open epub");
    let mut archive = zip::ZipArchive::new(file).expect("read epub");
    (0..archive.len())
      .map(|index| archive.by_index(index).expect("entry").name().to_string())
      .collect()
  }

  fn entry_text(path: &Path, name: &str) -> String {
    use std::io::Read;
    let file = std::fs::File::open(path).expect("open epub");
    let mut archive = zip::ZipArchive::new(file).expect("read epub");
    let mut entry = archive.by_name(name).expect(name);
    let mut text = String::new();
    entry.read_to_string(&mut text).expect("read entry");
    text
  }

  fn convert_fixture(file_name: &str, contents: &[u8]) -> std::path::PathBuf {
    let source = scratch(file_name);
    std::fs::write(&source, contents).expect("write source");
    let target = scratch(&format!("{file_name}.epub"));
    let _ = std::fs::remove_file(&target);
    to_epub(&source, &target, "Fallback Title").expect("convert");
    target
  }

  #[test]
  fn a_text_file_becomes_a_readable_epub() {
    let target = convert_fixture(
      "roundtrip.txt",
      b"Chapter 1\n\nIt was a dark night.\n\nChapter 2\n\nThen it was not."
    );
    let entries = epub_entries(&target);

    // The spec requires `mimetype` to be the very first entry.
    assert_eq!(entries.first().map(String::as_str), Some("mimetype"));
    assert!(entries.contains(&"META-INF/container.xml".to_string()));
    assert!(entries.contains(&"OEBPS/content.opf".to_string()));
    assert!(entries.contains(&"OEBPS/nav.xhtml".to_string()));
    assert!(entries.contains(&"OEBPS/toc.ncx".to_string()));
    assert!(entries.contains(&"OEBPS/text/chapter2.xhtml".to_string()));

    let chapter = entry_text(&target, "OEBPS/text/chapter1.xhtml");
    assert!(chapter.contains("It was a dark night."), "{chapter}");

    let opf = entry_text(&target, "OEBPS/content.opf");
    assert!(opf.contains("<itemref idref=\"chapter1\"/>"), "{opf}");
    assert!(opf.contains("<itemref idref=\"chapter2\"/>"), "{opf}");
  }

  #[test]
  fn the_mimetype_entry_is_stored_uncompressed() {
    let target = convert_fixture("stored.txt", b"just some words to convert");
    let file = std::fs::File::open(&target).expect("open");
    let mut archive = zip::ZipArchive::new(file).expect("read");
    let entry = archive.by_index(0).expect("first entry");
    assert_eq!(entry.name(), "mimetype");
    assert_eq!(entry.compression(), zip::CompressionMethod::Stored);
  }

  #[test]
  fn an_html_file_keeps_its_body_and_drops_its_scripts() {
    let target = convert_fixture(
      "roundtrip.html",
      b"<html><head><title>Saved Page</title></head><body><p>kept</p><script>bad()</script></body></html>"
    );
    let chapter = entry_text(&target, "OEBPS/text/chapter1.xhtml");
    assert!(chapter.contains("kept"), "{chapter}");
    assert!(!chapter.contains("bad()"), "{chapter}");
    assert!(entry_text(&target, "OEBPS/content.opf").contains("Saved Page"));
  }

  #[test]
  fn an_fb2_file_carries_its_metadata_and_images_across() {
    let target = convert_fixture(
      "roundtrip.fb2",
      br##"<FictionBook><description><title-info>
           <book-title>FB2 Title</book-title>
           <author><first-name>Ada</first-name><last-name>Lovelace</last-name></author>
         </title-info></description>
         <body><section><title><p>One</p></title><p>Body text.</p>
           <image href="#pic.jpg"/></section></body>
         <binary id="pic.jpg" content-type="image/jpeg">aGVsbG8=</binary></FictionBook>"##
    );
    let opf = entry_text(&target, "OEBPS/content.opf");
    assert!(opf.contains("FB2 Title"), "{opf}");
    assert!(opf.contains("Ada Lovelace"), "{opf}");
    assert!(opf.contains("images/pic.jpg"), "{opf}");

    let entries = epub_entries(&target);
    assert!(entries.contains(&"OEBPS/images/pic.jpg".to_string()), "{entries:?}");

    // The chapter references the image by a path that resolves from OEBPS/text.
    let chapter = entry_text(&target, "OEBPS/text/chapter1.xhtml");
    assert!(chapter.contains("../images/pic.jpg"), "{chapter}");
    assert!(chapter.contains("Body text."), "{chapter}");
  }

  #[test]
  fn a_file_with_nothing_readable_fails_instead_of_writing_an_empty_book() {
    let source = scratch("empty.txt");
    std::fs::write(&source, b"   \n\n   ").expect("write");
    let target = scratch("empty.epub");
    let _ = std::fs::remove_file(&target);
    assert!(to_epub(&source, &target, "Fallback").is_err());
    assert!(!target.exists(), "no output should be left behind");
  }

  #[test]
  fn a_format_without_a_builtin_converter_is_refused() {
    let source = scratch("book.mobi");
    std::fs::write(&source, b"not really a mobi").expect("write");
    let target = scratch("book.mobi.epub");
    assert!(to_epub(&source, &target, "Fallback").is_err());
  }

  #[test]
  fn only_declared_builtin_formats_are_handled() {
    for extension in ["txt", "html", "fb2", "htmlz", "fbz", "txtz", "htm", "xhtml"] {
      assert!(handles(extension), "{extension}");
    }
    for extension in ["mobi", "azw3", "docx", "pdf", "epub", "cbz"] {
      assert!(!handles(extension), "{extension}");
    }
  }
}
