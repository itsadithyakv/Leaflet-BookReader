//! Smaller copies of book files, for the Google Drive backup only.
//!
//! The same novel turns up at 400 KB and at 12 MB: the difference is nearly
//! always its pictures (a cover scanned at 4000 px, a map as a 9 MB PNG) and a
//! zip packed loosely. Before a book's file goes to Drive, a copy is made with
//! the pictures brought down to a size no screen needs and everything packed
//! tightly, and that copy is sent instead. The book on this device is never
//! touched: the copy is made in a scratch folder and deleted once sent.
//!
//! What changes, and what never does:
//!
//! - **EPUB.** Every entry is packed again (deflate, best), except `mimetype`,
//!   which stays first and stored, as OCF requires. A JPEG, PNG, WebP or BMP
//!   whose long side is over 2048 px is brought down to 2048, in the same
//!   format, under the same name and path. A JPEG is also encoded again at
//!   quality 82 when that is smaller; a PNG is packed again losslessly. GIFs
//!   and SVG stay as they are. The cover the package names (EPUB 3's
//!   `cover-image`, EPUB 2's `<meta name="cover">`) goes further, to 1000 px
//!   and quality 78: it is only ever drawn on a card or a first page, and
//!   covers are found online besides. The bytes of XHTML, HTML, OPF, NCX, CSS and
//!   fonts are never changed, so every CFI, highlight and note stays exactly
//!   where it was. A fixed-layout book keeps its pictures' sizes (its pages
//!   may be laid out by them); a book with DRM is not touched at all.
//! - **CBZ, and a CBR that is a zip.** The pictures are the book, so gentler:
//!   2560 px, quality 88.
//! - **Everything else** (PDF included) goes as it is. Nothing in this crate
//!   writes PDFs (`storage::pdf` only reads a few strings), and rewriting one
//!   by hand (object streams, cross-reference tables, incremental updates)
//!   risks a backup that no longer opens, for megabytes that are mostly
//!   pictures already compressed inside it. A PDF's cover is not dropped or
//!   shrunk either: highlights and places are kept by page, and telling a
//!   picture cover from a scanned page needs a PDF parser this crate lacks.
//!
//! Already-compressed pictures (JPEG, PNG, GIF, WebP) are stored rather than
//! deflated in the copy: deflate gains under 1% on them and was most of the
//! time spent on a large comic.
//!
//! The copy is kept only when it is at least 10% smaller; on any failure, or
//! when it takes too long, the original goes instead. A failure here never
//! fails a backup.
//!
//! The copy says what it is: `META-INF/leaflet-source.json` names the
//! original's sha256 (the book's id), so a device that downloads it, or a
//! reader who imports it from an old backup folder, has the same book under
//! the same id. EPUB readers ignore files in `META-INF` they do not know
//! (calibre keeps `calibre_bookmarks.txt` there, Apple Books
//! `com.apple.ibooks.display-options.xml`); epub.js reads only
//! `container.xml`; Leaflet's comic reader lists only pictures.
//!
//! The output is the same bytes for the same book on any device: fixed zip
//! timestamps and permissions, the original's entry order, no clock or
//! randomness anywhere.

use crate::db::Database;
use anyhow::{anyhow, bail, Result};
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// The marker inside a smaller copy.
pub const MARKER: &str = "META-INF/leaflet-source.json";
/// What the marker's `format` says: the rules a copy was made by.
pub const FORMAT_VERSION: u32 = 1;

/// This device's switch: "0" sends originals; anything else, or nothing, smaller copies.
pub const SETTING: &str = "drive_smaller_backups";
/// What smaller copies have saved on this device so far, in bytes.
pub const SAVED_SETTING: &str = "drive_smaller_saved_bytes";

/// Whether this device sends smaller copies to Drive. On unless turned off.
pub fn enabled(db: &Database) -> bool {
  db.get_setting(SETTING).ok().flatten().as_deref() != Some("0")
}

/// Turns smaller copies on or off for future uploads. Files already in Drive
/// stay as they are, in either direction.
pub fn set_enabled(db: &Database, on: bool) -> Result<()> {
  db.set_setting(SETTING, if on { "1" } else { "0" })
}

pub fn saved_bytes(db: &Database) -> u64 {
  db.get_setting(SAVED_SETTING).ok().flatten().and_then(|value| value.parse().ok()).unwrap_or(0)
}

pub fn add_saved(db: &Database, bytes: u64) -> Result<()> {
  if bytes == 0 {
    return Ok(());
  }
  db.set_setting(SAVED_SETTING, &saved_bytes(db).saturating_add(bytes).to_string())
}

/// How far the pictures of one kind of book are brought down.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Rules {
  long_side: u32,
  jpeg_quality: u8
}

const BOOK: Rules = Rules { long_side: 2048, jpeg_quality: 82 };
const COMIC: Rules = Rules { long_side: 2560, jpeg_quality: 88 };
/// An EPUB's cover: a library card and the first page are all it is drawn
/// at, and Leaflet finds covers online besides.
const COVER: Rules = Rules { long_side: 1000, jpeg_quality: 78 };

fn rules_for(ext: &str) -> Option<(Rules, bool)> {
  match ext {
    "epub" => Some((BOOK, true)),
    "cbz" | "cbr" => Some((COMIC, false)),
    _ => None
  }
}

/// A copy is kept only when it is at most this share of the original.
fn worth_keeping(original: u64, copy: u64) -> bool {
  copy.saturating_mul(10) <= original.saturating_mul(9)
}

/// How long one book may take before the original is sent instead: a minute,
/// and two seconds a megabyte, up to ten minutes (a 300 MB comic on a slow phone).
fn budget(bytes: u64) -> Duration {
  let megabytes = bytes / (1024 * 1024);
  Duration::from_secs((60 + 2 * megabytes).min(600))
}

/// A picture smaller than this is left alone unless it is over the size:
/// encoding it again saves next to nothing.
const SMALL_PICTURE: usize = 24 * 1024;
/// Pictures larger than this in their file are copied as they are, never held whole.
const LARGEST_PICTURE: u64 = 64 * 1024 * 1024;
/// More pixels than this are not decoded (a 50 MP picture is 200 MB in memory).
const MOST_PIXELS: u64 = 50_000_000;

/// What goes to Drive for one book's file: a smaller copy, or the file itself.
/// A copy made here is deleted when this is dropped.
#[derive(Debug)]
pub struct Prepared {
  path: PathBuf,
  made: bool,
  /// The size of what will be sent.
  pub bytes: u64,
  /// The original's size.
  pub original_bytes: u64,
  /// The original's sha256 when what is sent is a smaller copy (made now, or
  /// the file here already is one).
  pub source: Option<String>,
  /// Of what the copy saves, how much is the cover's (an EPUB's, brought to 1000 px).
  pub cover_saved: u64
}

impl Prepared {
  /// The file as it is.
  pub fn original(path: &Path) -> Self {
    let bytes = fs::metadata(path).map(|metadata| metadata.len()).unwrap_or(0);
    Prepared { path: path.to_path_buf(), made: false, bytes, original_bytes: bytes, source: source_of(path), cover_saved: 0 }
  }

  pub fn path(&self) -> &Path {
    &self.path
  }

  /// A smaller copy was made for this upload (not the file here as it is).
  pub fn made(&self) -> bool {
    self.made
  }

  /// What the copy saves over the original.
  pub fn saved(&self) -> u64 {
    if self.made {
      self.original_bytes.saturating_sub(self.bytes)
    } else {
      0
    }
  }
}

impl Drop for Prepared {
  fn drop(&mut self) {
    if self.made {
      let _ = fs::remove_file(&self.path);
    }
  }
}

/// Where copies are made while they wait to be sent.
pub fn scratch_dir() -> Result<PathBuf> {
  Ok(super::app_data_dir()?.join("backup-smaller"))
}

/// Clears copies left by a backup that was cut off (Leaflet closed mid-upload).
pub fn clear_scratch() {
  if let Ok(dir) = scratch_dir() {
    let _ = fs::remove_dir_all(dir);
  }
}

static NEXT: AtomicU64 = AtomicU64::new(0);

fn is_book_id(value: &str) -> bool {
  value.len() == 64 && value.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn extension(path: &Path) -> String {
  crate::formats::extension_of(path)
}

fn starts_like_zip(path: &Path) -> bool {
  let mut head = [0u8; 4];
  File::open(path).and_then(|mut file| file.read_exact(&mut head)).is_ok() && &head == b"PK\x03\x04"
}

/// The original's sha256, when the file at `path` is a smaller copy made for a backup.
pub fn source_of(path: &Path) -> Option<String> {
  if rules_for(&extension(path)).is_none() || !starts_like_zip(path) {
    return None;
  }
  let mut archive = ZipArchive::new(BufReader::new(File::open(path).ok()?)).ok()?;
  let mut marker = archive.by_name(MARKER).ok()?;
  let mut text = String::new();
  (&mut marker).take(4096).read_to_string(&mut text).ok()?;
  let value: serde_json::Value = serde_json::from_str(&text).ok()?;
  let source = value.get("source")?.as_str()?;
  is_book_id(source).then(|| source.to_string())
}

/// Which book a file is: its own hash, or, for a smaller copy, the original's.
pub fn identity(path: &Path, hash: String) -> String {
  source_of(path).unwrap_or(hash)
}

/// What is to be sent for the book `book_id` whose file is at `path`: a
/// smaller copy made in `scratch` when one is worth having, or else the file.
/// Never fails: anything that goes wrong sends the original.
pub fn prepare(path: &Path, book_id: &str, scratch: &Path) -> Prepared {
  let original = Prepared::original(path);
  if original.source.is_some() || original.bytes == 0 || !is_book_id(book_id) {
    return original;
  }
  let ext = extension(path);
  let Some((rules, is_epub)) = rules_for(&ext) else {
    return original;
  };
  if !starts_like_zip(path) {
    return original;
  }
  if fs::create_dir_all(scratch).is_err() {
    return original;
  }
  let out = scratch.join(format!("{}-{}.{ext}", &book_id[..16], NEXT.fetch_add(1, Ordering::Relaxed)));
  let started = Instant::now();
  let deadline = started + budget(original.bytes);
  let made = std::panic::catch_unwind(|| shrink(path, &out, book_id, rules, is_epub, deadline))
    .unwrap_or_else(|_| Err(anyhow!("a picture could not be read")));
  let took = started.elapsed().as_millis();
  let short = &book_id[..12];
  match made.and_then(|shrunk| Ok((fs::metadata(&out)?.len(), shrunk))) {
    Ok((bytes, shrunk)) if worth_keeping(original.bytes, bytes) => {
      let cover_saved = shrunk.cover_before.saturating_sub(shrunk.cover_after);
      crate::diag::info(&format!(
        "Smaller backup of {short}.{ext}: {} -> {} bytes ({}% saved; the cover {cover_saved} of it) in {took} ms",
        original.bytes,
        bytes,
        (original.bytes - bytes) * 100 / original.bytes
      ));
      Prepared {
        path: out,
        made: true,
        bytes,
        original_bytes: original.bytes,
        source: Some(book_id.to_string()),
        cover_saved
      }
    }
    Ok((bytes, _)) => {
      let _ = fs::remove_file(&out);
      crate::diag::info(&format!(
        "Smaller backup of {short}.{ext}: {} -> {bytes} bytes is under 10% saved; the original goes ({took} ms)",
        original.bytes
      ));
      original
    }
    Err(error) => {
      let _ = fs::remove_file(&out);
      crate::diag::warn(&format!("Smaller backup of {short}.{ext} not made, the original goes: {error} ({took} ms)"));
      original
    }
  }
}

fn stored() -> FileOptions {
  FileOptions::default()
    .compression_method(CompressionMethod::Stored)
    .last_modified_time(zip::DateTime::default())
    .unix_permissions(0o644)
}

fn deflated() -> FileOptions {
  FileOptions::default()
    .compression_method(CompressionMethod::Deflated)
    .compression_level(Some(9))
    .last_modified_time(zip::DateTime::default())
    .unix_permissions(0o644)
}

/// What kind of picture a name says it is, for the kinds that can be made smaller.
fn picture_format(name: &str) -> Option<ImageFormat> {
  let ext = name.rsplit_once('.')?.1.to_ascii_lowercase();
  match ext.as_str() {
    "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
    "png" => Some(ImageFormat::Png),
    "webp" => Some(ImageFormat::WebP),
    "bmp" => Some(ImageFormat::Bmp),
    _ => None
  }
}

/// Pictures already compressed in their own format: stored, not deflated.
fn already_compressed(name: &str) -> bool {
  let ext = name.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase()).unwrap_or_default();
  matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "webp" | "avif")
}

fn names_in_order<R: Read + io::Seek>(archive: &mut ZipArchive<R>) -> Result<Vec<String>> {
  (0..archive.len()).map(|index| Ok(archive.by_index_raw(index)?.name().to_string())).collect()
}

fn read_entry_text(archive: &mut ZipArchive<BufReader<File>>, name: &str, most: u64) -> Option<String> {
  let entry = archive.by_name(name).ok()?;
  let mut text = String::new();
  entry.take(most).read_to_string(&mut text).ok()?;
  Some(text)
}

/// A manifest href as a path inside the archive: relative to the package's
/// folder, percent-decoded, `.` and `..` resolved (as `epub::archive_path`).
fn in_archive(opf_path: &str, href: &str) -> String {
  let href = href.split('#').next().unwrap_or(href);
  let decoded = urlencoding::decode(href).map(|value| value.into_owned()).unwrap_or_else(|_| href.to_string());
  let base = opf_path.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");
  let mut parts: Vec<&str> = if decoded.starts_with('/') || base.is_empty() { Vec::new() } else { base.split('/').collect() };
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

/// The cover picture the package names: EPUB 3's `properties="cover-image"`
/// item, or EPUB 2's `<meta name="cover">`. Nothing is guessed from names.
fn declared_cover(opf_path: &str, opf: &str) -> Option<String> {
  use quick_xml::events::Event;
  struct Item {
    id: String,
    href: String,
    media_type: String,
    properties: String
  }
  let mut reader = quick_xml::Reader::from_str(opf);
  let mut items = Vec::new();
  let mut cover_id = None;
  loop {
    match reader.read_event() {
      Ok(Event::Start(element)) | Ok(Event::Empty(element)) => {
        let get = |key: &str| {
          element
            .attributes()
            .flatten()
            .find(|attribute| attribute.key.local_name().as_ref() == key.as_bytes())
            .and_then(|attribute| attribute.unescape_value().ok().map(|value| value.into_owned()))
        };
        match element.local_name().as_ref() {
          b"item" => items.push(Item {
            id: get("id").unwrap_or_default(),
            href: get("href").unwrap_or_default(),
            media_type: get("media-type").unwrap_or_default(),
            properties: get("properties").unwrap_or_default()
          }),
          b"meta" if get("name").as_deref() == Some("cover") => cover_id = get("content"),
          _ => {}
        }
      }
      Ok(Event::Eof) | Err(_) => break,
      _ => {}
    }
  }
  let pictures = || items.iter().filter(|item| item.media_type.starts_with("image/") && !item.href.is_empty());
  let chosen = pictures()
    .find(|item| item.properties.split_whitespace().any(|property| property == "cover-image"))
    .or_else(|| cover_id.as_deref().and_then(|id| pictures().find(|item| item.id == id)))?;
  Some(in_archive(opf_path, &chosen.href))
}

/// What one copy did to the book's cover, for the log and the measures.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
struct Shrunk {
  cover_before: u64,
  cover_after: u64
}

/// Writes the smaller copy of `source` to `out`.
fn shrink(source: &Path, out: &Path, book_id: &str, rules: Rules, is_epub: bool, deadline: Instant) -> Result<Shrunk> {
  let mut archive = ZipArchive::new(BufReader::new(File::open(source)?))?;
  // In the archive's own order (`file_names` is in no order at all).
  let names = names_in_order(&mut archive)?;
  if names.iter().any(|name| name == MARKER) {
    bail!("already a smaller copy");
  }
  let mut keep_as_is: Vec<String> = Vec::new();
  let mut resize = true;
  let mut cover: Option<String> = None;
  let mut shrunk = Shrunk::default();
  if is_epub {
    if names.iter().any(|name| name.eq_ignore_ascii_case("META-INF/rights.xml")) {
      bail!("the book has DRM");
    }
    // Resources named in encryption.xml (obfuscated fonts, or worse) stay as they are.
    if let Some(encryption) = read_entry_text(&mut archive, "META-INF/encryption.xml", 4 * 1024 * 1024) {
      keep_as_is = names.iter().filter(|name| encryption.contains(name.rsplit('/').next().unwrap_or(name))).cloned().collect();
    }
    // A fixed-layout book may place its pictures by their own sizes. The
    // cover is the one the package names as it.
    let packages: Vec<String> = names.iter().filter(|name| name.to_ascii_lowercase().ends_with(".opf")).cloned().collect();
    for package in packages {
      let Some(opf) = read_entry_text(&mut archive, &package, 8 * 1024 * 1024) else {
        continue;
      };
      if opf.contains("pre-paginated") {
        resize = false;
      }
      if cover.is_none() {
        cover = declared_cover(&package, &opf);
      }
    }
  }

  let mut writer = ZipWriter::new(BufWriter::new(File::create(out)?));
  // `mimetype` first, as OCF requires; then every entry in the original's order.
  let mut order: Vec<usize> = Vec::with_capacity(archive.len());
  if let Some(first) = names.iter().position(|name| name == "mimetype") {
    order.push(first);
  }
  order.extend((0..archive.len()).filter(|index| names.get(*index).map(String::as_str) != Some("mimetype")));

  for index in order {
    if Instant::now() > deadline {
      bail!("it took too long");
    }
    let mut entry = archive.by_index(index)?;
    let name = entry.name().to_string();
    // A name the writer would spell differently (an old code page) could
    // stop a reader finding the file it names.
    if entry.name_raw() != name.as_bytes() {
      bail!("an entry's name is not UTF-8");
    }
    if entry.is_dir() {
      writer.add_directory(name, deflated())?;
      continue;
    }
    if name == "mimetype" {
      writer.start_file(name, stored())?;
      io::copy(&mut entry, &mut writer)?;
      continue;
    }
    let options = if already_compressed(&name) { stored() } else { deflated() };
    let picture = picture_format(&name).filter(|_| entry.size() <= LARGEST_PICTURE && !keep_as_is.contains(&name));
    match picture {
      Some(format) => {
        let packed = entry.compressed_size();
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes)?;
        let is_cover = cover.as_deref() == Some(name.as_str());
        let rules = if is_cover { COVER } else { rules };
        let smaller = std::panic::catch_unwind(|| smaller_picture(&bytes, format, rules, resize)).ok().flatten();
        let written = smaller.as_deref().unwrap_or(&bytes);
        if is_cover {
          shrunk.cover_before += packed;
          shrunk.cover_after += written.len() as u64;
        }
        writer.start_file(name, options)?;
        writer.write_all(written)?;
      }
      None => {
        writer.start_file(name, options)?;
        io::copy(&mut entry, &mut writer)?;
      }
    }
  }

  writer.start_file(MARKER, deflated())?;
  writer.write_all(serde_json::json!({ "source": book_id, "format": FORMAT_VERSION }).to_string().as_bytes())?;
  let mut file = writer.finish()?;
  file.flush()?;
  file.into_inner().map_err(|error| anyhow!("{}", error.error()))?.sync_all()?;
  Ok(shrunk)
}

/// Whether a PNG or WebP moves (APNG's `acTL`, WebP's `ANIM`): only its first
/// frame would be kept.
fn animated(bytes: &[u8], format: ImageFormat) -> bool {
  let mark: &[u8] = match format {
    ImageFormat::Png => b"acTL",
    ImageFormat::WebP => b"ANIM",
    _ => return false
  };
  let head = &bytes[..bytes.len().min(64 * 1024)];
  head.windows(4).any(|window| window == mark)
}

/// The size a picture is brought down to: the long side to `long`, the other in proportion.
fn fit(width: u32, height: u32, long: u32) -> (u32, u32) {
  if width >= height {
    let other = (u64::from(height) * u64::from(long) + u64::from(width) / 2) / u64::from(width);
    (long, (other as u32).max(1))
  } else {
    let other = (u64::from(width) * u64::from(long) + u64::from(height) / 2) / u64::from(height);
    ((other as u32).max(1), long)
  }
}

/// The picture made smaller in its own format, or nothing when it cannot be
/// or would not be smaller.
fn smaller_picture(bytes: &[u8], format: ImageFormat, rules: Rules, resize: bool) -> Option<Vec<u8>> {
  // A name that is not what the bytes are is left alone.
  if image::guess_format(bytes).ok()? != format || animated(bytes, format) {
    return None;
  }
  let (width, height) = ImageReader::with_format(Cursor::new(bytes), format).into_dimensions().ok()?;
  let over = resize && width.max(height) > rules.long_side;
  // Only JPEG and PNG are worth encoding again at the same size (WebP can
  // only be written losslessly here, BMP is rare).
  if !over && (bytes.len() < SMALL_PICTURE || !matches!(format, ImageFormat::Jpeg | ImageFormat::Png)) {
    return None;
  }
  // A JPEG at under 0.2 bytes a pixel is packed as tightly as quality 82
  // would, or more: decoding and encoding it again only spends a phone's time.
  if !over && format == ImageFormat::Jpeg && (bytes.len() as u64) * 5 < u64::from(width) * u64::from(height) {
    return None;
  }
  if u64::from(width) * u64::from(height) > MOST_PIXELS {
    return None;
  }

  let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
  let mut limits = image::Limits::default();
  limits.max_alloc = Some(256 * 1024 * 1024);
  reader.limits(limits);
  let mut decoder = reader.into_decoder().ok()?;
  // CMYK would come back as a guess at RGB: its colours are not ours to change.
  if matches!(decoder.original_color_type(), image::ExtendedColorType::Cmyk8) {
    return None;
  }
  let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
  let icc = decoder.icc_profile().ok().flatten();
  let mut picture = DynamicImage::from_decoder(decoder).ok()?;
  // The copy carries no EXIF, so a turn it asked for is made in the pixels.
  picture.apply_orientation(orientation);
  if over {
    let (new_width, new_height) = fit(picture.width(), picture.height(), rules.long_side);
    picture = picture.resize_exact(new_width, new_height, image::imageops::FilterType::CatmullRom);
  }

  let mut out = Vec::new();
  match format {
    ImageFormat::Jpeg => {
      let picture = match picture.color() {
        image::ColorType::L8 => picture,
        image::ColorType::L16 | image::ColorType::La8 | image::ColorType::La16 => DynamicImage::ImageLuma8(picture.to_luma8()),
        _ => DynamicImage::ImageRgb8(picture.to_rgb8())
      };
      let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, rules.jpeg_quality);
      if let Some(icc) = icc {
        let _ = image::ImageEncoder::set_icc_profile(&mut encoder, icc);
      }
      picture.write_with_encoder(encoder).ok()?;
    }
    ImageFormat::Png => {
      let mut encoder = image::codecs::png::PngEncoder::new_with_quality(
        &mut out,
        image::codecs::png::CompressionType::Best,
        image::codecs::png::FilterType::Adaptive
      );
      if let Some(icc) = icc {
        let _ = image::ImageEncoder::set_icc_profile(&mut encoder, icc);
      }
      picture.write_with_encoder(encoder).ok()?;
    }
    ImageFormat::WebP => {
      let picture = if picture.color().has_alpha() {
        DynamicImage::ImageRgba8(picture.to_rgba8())
      } else {
        DynamicImage::ImageRgb8(picture.to_rgb8())
      };
      picture.write_with_encoder(image::codecs::webp::WebPEncoder::new_lossless(&mut out)).ok()?;
    }
    ImageFormat::Bmp => {
      picture.write_to(&mut Cursor::new(&mut out), ImageFormat::Bmp).ok()?;
    }
    _ => return None
  }
  (out.len() < bytes.len()).then_some(out)
}

#[cfg(test)]
pub(crate) mod tests {
  use super::*;
  use image::{Rgb, RgbImage};

  pub(crate) const ID: &str = "4f2d9c0e8a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d";

  pub(crate) struct Scratch(pub PathBuf);
  impl Scratch {
    pub(crate) fn new(label: &str) -> Self {
      let dir = std::env::temp_dir().join(format!("leaflet-smaller-{label}-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
      let _ = fs::remove_dir_all(&dir);
      fs::create_dir_all(&dir).expect("scratch");
      Scratch(dir)
    }
  }
  impl Drop for Scratch {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  /// A photograph-like picture: smooth gradients with some noise, which JPEG
  /// and PNG compress the way they do real pictures.
  fn photo(width: u32, height: u32) -> RgbImage {
    let mut seed: u32 = 0x1234_5678;
    RgbImage::from_fn(width, height, |x, y| {
      seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
      let noise = (seed >> 27) as u8;
      Rgb([
        ((x * 255 / width.max(1)) as u8).wrapping_add(noise),
        ((y * 255 / height.max(1)) as u8).wrapping_add(noise / 2),
        (((x + y) * 127 / (width + height).max(1)) as u8).wrapping_add(noise)
      ])
    })
  }

  pub(crate) fn jpeg(width: u32, height: u32, quality: u8) -> Vec<u8> {
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)
      .encode_image(&photo(width, height))
      .expect("jpeg");
    out
  }

  fn png(width: u32, height: u32) -> Vec<u8> {
    let mut out = Vec::new();
    DynamicImage::ImageRgb8(photo(width, height))
      .write_with_encoder(image::codecs::png::PngEncoder::new_with_quality(
        &mut out,
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::NoFilter
      ))
      .expect("png");
    out
  }

  const CHAPTER: &[u8] = b"<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>One</title><link href=\"../style.css\" rel=\"stylesheet\"/></head><body><p>It was a bright cold day in April, and the clocks were striking thirteen.</p><img src=\"../images/map.jpg\"/></body></html>";
  const OPF: &[u8] = b"<?xml version=\"1.0\"?><package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\"><metadata><dc:title xmlns:dc=\"http://purl.org/dc/elements/1.1/\">Test</dc:title></metadata><manifest/><spine/></package>";
  const CSS: &[u8] = b"p { text-indent: 1.5em; margin: 0; }\n";
  const FONT: &[u8] = b"\x00\x01\x00\x00 not really a font, but bytes that must not change";

  /// Writes a zip of these entries as a loose packer would: deflate, fast, real times.
  pub(crate) fn write_zip(path: &Path, entries: &[(&str, &[u8], CompressionMethod)]) {
    let mut writer = ZipWriter::new(File::create(path).expect("zip"));
    for (name, bytes, method) in entries {
      let options = FileOptions::default().compression_method(*method).compression_level(if *method == CompressionMethod::Deflated { Some(1) } else { None });
      writer.start_file(*name, options).expect("entry");
      writer.write_all(bytes).expect("bytes");
    }
    writer.finish().expect("finish");
  }

  pub(crate) fn epub_with(path: &Path, map: &[u8], extra: &[(&str, &[u8])]) {
    let mut entries: Vec<(&str, &[u8], CompressionMethod)> = vec![
      ("mimetype", b"application/epub+zip", CompressionMethod::Stored),
      ("META-INF/container.xml", b"<?xml version=\"1.0\"?><container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles><rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles></container>", CompressionMethod::Deflated),
      ("OEBPS/content.opf", OPF, CompressionMethod::Deflated),
      ("OEBPS/text/one.xhtml", CHAPTER, CompressionMethod::Deflated),
      ("OEBPS/style.css", CSS, CompressionMethod::Deflated),
      ("OEBPS/fonts/serif.otf", FONT, CompressionMethod::Deflated),
      ("OEBPS/images/map.jpg", map, CompressionMethod::Deflated),
    ];
    entries.extend(extra.iter().map(|(name, bytes)| (*name, *bytes, CompressionMethod::Deflated)));
    write_zip(path, &entries);
  }

  fn entry(path: &Path, name: &str) -> Vec<u8> {
    let mut archive = ZipArchive::new(File::open(path).expect("open")).expect("zip");
    let mut file = archive.by_name(name).expect(name);
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).expect("read");
    bytes
  }

  fn dimensions(bytes: &[u8]) -> (u32, u32) {
    image::load_from_memory(bytes).expect("a picture").into_dimensions()
  }

  trait Dims {
    fn into_dimensions(self) -> (u32, u32);
  }
  impl Dims for DynamicImage {
    fn into_dimensions(self) -> (u32, u32) {
      (self.width(), self.height())
    }
  }

  #[test]
  fn an_epubs_text_stays_exactly_and_its_pictures_come_down_under_the_same_names() {
    let scratch = Scratch::new("epub");
    let book = scratch.0.join("book.epub");
    let map = jpeg(2400, 1800, 95);
    let cover = png(2200, 3300);
    epub_with(&book, &map, &[("OEBPS/images/cover.png", &cover), ("OEBPS/images/tiny.gif", b"GIF89a tiny"), ("OEBPS/images/plan.svg", b"<svg/>")]);
    let before = fs::metadata(&book).unwrap().len();

    let prepared = prepare(&book, ID, &scratch.0.join("out"));
    assert!(prepared.made(), "a 2400 px map is worth making smaller");
    assert!(worth_keeping(before, prepared.bytes));
    assert_eq!(prepared.source.as_deref(), Some(ID));
    assert_eq!(prepared.original_bytes, before);
    let copy = prepared.path().to_path_buf();

    // Text, package, style and font: the same bytes.
    for (name, bytes) in [("OEBPS/content.opf", OPF), ("OEBPS/text/one.xhtml", CHAPTER), ("OEBPS/style.css", CSS), ("OEBPS/fonts/serif.otf", FONT)] {
      assert_eq!(entry(&copy, name), bytes, "{name}");
    }
    assert_eq!(entry(&copy, "OEBPS/images/tiny.gif"), b"GIF89a tiny");
    assert_eq!(entry(&copy, "OEBPS/images/plan.svg"), b"<svg/>");

    // The pictures: the same names and formats, the long side at 2048.
    let small_map = entry(&copy, "OEBPS/images/map.jpg");
    assert_eq!(image::guess_format(&small_map).unwrap(), ImageFormat::Jpeg);
    assert_eq!(dimensions(&small_map), (2048, 1536));
    let small_cover = entry(&copy, "OEBPS/images/cover.png");
    assert_eq!(image::guess_format(&small_cover).unwrap(), ImageFormat::Png);
    assert_eq!(dimensions(&small_cover), (1365, 2048));

    // `mimetype` first and stored; the marker names the original.
    let mut archive = ZipArchive::new(File::open(&copy).unwrap()).unwrap();
    let first = archive.by_index(0).unwrap();
    assert_eq!(first.name(), "mimetype");
    assert_eq!(first.compression(), CompressionMethod::Stored);
    drop(first);
    let names = names_in_order(&mut archive).unwrap();
    assert_eq!(names.last().map(String::as_str), Some(MARKER));
    assert_eq!(source_of(&copy).as_deref(), Some(ID));
    assert_eq!(identity(&copy, "the copy's own hash".into()), ID);
    // The original is untouched and is no copy.
    assert_eq!(fs::metadata(&book).unwrap().len(), before);
    assert_eq!(source_of(&book), None);
    // epub.js and Leaflet find the book in it as before.
    let package = crate::storage::extract_basic_metadata(&copy).expect("metadata");
    assert_eq!(package.title.as_deref(), Some("Test"));

    drop(prepared);
    assert!(!copy.exists(), "the copy is deleted once sent");
  }

  /// The cover the package names comes down to 1000 px; every other picture
  /// to 2048. EPUB 3's `cover-image` and EPUB 2's `<meta name="cover">` both
  /// count; a picture merely called "cover" does not.
  #[test]
  fn the_cover_comes_down_further_than_the_other_pictures() {
    let scratch = Scratch::new("cover");
    let cover = jpeg(1500, 2250, 92);
    let plate = jpeg(2100, 1400, 92);
    let epub3: &[u8] = b"<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\"><manifest><item id=\"c\" href=\"images/Front%20Cover.jpg\" media-type=\"image/jpeg\" properties=\"cover-image\"/><item id=\"p\" href=\"images/plate.jpg\" media-type=\"image/jpeg\"/></manifest></package>";
    let epub2: &[u8] = b"<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"2.0\"><metadata><meta name=\"cover\" content=\"front\"/></metadata><manifest><item id=\"front\" href=\"images/Front%20Cover.jpg\" media-type=\"image/jpeg\"/><item id=\"p\" href=\"../OEBPS/images/plate.jpg\" media-type=\"image/jpeg\"/></manifest></package>";
    let none: &[u8] = b"<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"2.0\"><manifest><item id=\"cover\" href=\"images/Front%20Cover.jpg\" media-type=\"image/jpeg\"/></manifest></package>";
    for (label, opf, cover_side) in [("epub3", epub3, 1000), ("epub2", epub2, 1000), ("named only", none, 2048)] {
      let book = scratch.0.join(format!("{label}.epub"));
      write_zip(&book, &[
        ("mimetype", b"application/epub+zip", CompressionMethod::Stored),
        ("OEBPS/content.opf", opf, CompressionMethod::Deflated),
        ("OEBPS/images/Front Cover.jpg", &cover, CompressionMethod::Stored),
        ("OEBPS/images/plate.jpg", &plate, CompressionMethod::Stored),
      ]);
      let prepared = prepare(&book, ID, &scratch.0.join("out"));
      assert!(prepared.made(), "{label}");
      let (width, height) = dimensions(&entry(prepared.path(), "OEBPS/images/Front Cover.jpg"));
      assert_eq!(width.max(height), cover_side.min(2250), "{label}: the cover");
      assert_eq!(dimensions(&entry(prepared.path(), "OEBPS/images/plate.jpg")), (2048, 1365), "{label}: a plate");
      assert_eq!(entry(prepared.path(), "OEBPS/content.opf"), opf, "{label}: the package as it was");
      if cover_side == 1000 {
        assert!(prepared.cover_saved > 0, "{label}");
        assert_eq!((width, height), (667, 1000));
      } else {
        assert_eq!(prepared.cover_saved, 0);
      }
    }
    assert_eq!(declared_cover("content.opf", "<package><manifest><item id='c' href='c.jpg' media-type='image/jpeg' properties='cover-image'/></manifest></package>").as_deref(), Some("c.jpg"));
    assert_eq!(declared_cover("OEBPS/content.opf", "not xml at all <"), None);
  }

  #[test]
  fn the_same_book_gives_the_same_bytes_every_time() {
    let scratch = Scratch::new("same");
    let book = scratch.0.join("book.epub");
    epub_with(&book, &jpeg(2100, 900, 95), &[]);
    let first = prepare(&book, ID, &scratch.0.join("a"));
    let second = prepare(&book, ID, &scratch.0.join("b"));
    assert!(first.made() && second.made());
    assert_eq!(fs::read(first.path()).unwrap(), fs::read(second.path()).unwrap());
  }

  #[test]
  fn a_copy_under_ten_percent_smaller_is_not_kept() {
    let scratch = Scratch::new("ten");
    let book = scratch.0.join("book.epub");
    // A small picture already well packed: nothing much to gain.
    epub_with(&book, &jpeg(600, 400, 60), &[]);
    let prepared = prepare(&book, ID, &scratch.0.join("out"));
    assert!(!prepared.made());
    assert_eq!(prepared.path(), book.as_path());
    assert_eq!(prepared.bytes, fs::metadata(&book).unwrap().len());
    assert!(fs::read_dir(scratch.0.join("out")).map(|dir| dir.count()).unwrap_or(0) == 0, "no copy left behind");

    assert!(worth_keeping(1000, 900));
    assert!(!worth_keeping(1000, 901));
  }

  #[test]
  fn a_damaged_archive_or_another_format_goes_as_it_is() {
    let scratch = Scratch::new("bad");
    let out = scratch.0.join("out");
    // A zip cut short halfway.
    let whole = scratch.0.join("whole.epub");
    epub_with(&whole, &jpeg(800, 600, 98), &[]);
    let bytes = fs::read(&whole).unwrap();
    let cut = scratch.0.join("cut.epub");
    fs::write(&cut, &bytes[..bytes.len() / 2]).unwrap();
    let prepared = prepare(&cut, ID, &out);
    assert!(!prepared.made());
    assert_eq!(prepared.path(), cut.as_path());
    // An entry whose bytes do not match its checksum.
    let mut flipped = bytes.clone();
    let at = flipped.windows(4).position(|window| window == b"one.").unwrap() + 400;
    flipped[at] ^= 0xff;
    let bad = scratch.0.join("bad.epub");
    fs::write(&bad, &flipped).unwrap();
    assert!(!prepare(&bad, ID, &out).made());
    // Not a zip at all, a PDF, a file with no book id to name.
    let fake = scratch.0.join("fake.epub");
    fs::write(&fake, b"<html>sign in</html>").unwrap();
    assert!(!prepare(&fake, ID, &out).made());
    let pdf = scratch.0.join("book.pdf");
    fs::write(&pdf, b"%PDF-1.7 ...").unwrap();
    assert!(!prepare(&pdf, ID, &out).made());
    assert!(!prepare(&whole, "not-a-hash", &out).made());
    assert_eq!(fs::read_dir(&out).map(|dir| dir.count()).unwrap_or(0), 0, "nothing left behind");
  }

  #[test]
  fn a_book_with_drm_or_a_copy_already_is_left_alone() {
    let scratch = Scratch::new("drm");
    let out = scratch.0.join("out");
    let locked = scratch.0.join("locked.epub");
    epub_with(&locked, &jpeg(800, 600, 98), &[("META-INF/rights.xml", b"<rights/>")]);
    assert!(!prepare(&locked, ID, &out).made());

    // A copy sent again is sent as it is: never made smaller twice.
    let book = scratch.0.join("book.epub");
    epub_with(&book, &jpeg(800, 600, 98), &[]);
    let copy = prepare(&book, ID, &out);
    assert!(copy.made());
    let again = prepare(copy.path(), ID, &scratch.0.join("again"));
    assert!(!again.made());
    assert_eq!(again.source.as_deref(), Some(ID), "it is still sent as a smaller copy");
  }

  #[test]
  fn a_fixed_layout_book_keeps_its_picture_sizes() {
    let scratch = Scratch::new("fixed");
    let book = scratch.0.join("book.epub");
    let fixed_opf: &[u8] = b"<package><metadata><meta property=\"rendition:layout\">pre-paginated</meta></metadata></package>";
    let mut entries: Vec<(&str, &[u8], CompressionMethod)> = vec![("mimetype", b"application/epub+zip", CompressionMethod::Stored)];
    let map = jpeg(2200, 1000, 98);
    entries.push(("OEBPS/content.opf", fixed_opf, CompressionMethod::Deflated));
    entries.push(("OEBPS/page.jpg", &map, CompressionMethod::Deflated));
    write_zip(&book, &entries);
    let prepared = prepare(&book, ID, &scratch.0.join("out"));
    // Quality 98 to 82 at the same size is still well worth it.
    assert!(prepared.made());
    assert_eq!(dimensions(&entry(prepared.path(), "OEBPS/page.jpg")), (2200, 1000));
  }

  #[test]
  fn a_comics_pages_come_down_more_gently() {
    let scratch = Scratch::new("cbz");
    let comic = scratch.0.join("comic.cbz");
    let page = jpeg(1700, 2720, 97);
    let small = jpeg(1200, 1800, 70);
    write_zip(&comic, &[
      ("001.jpg", &page, CompressionMethod::Stored),
      ("002.jpg", &small, CompressionMethod::Stored),
      ("003.jpg", &small, CompressionMethod::Stored),
      ("ComicInfo.xml", b"<ComicInfo><Title>Test</Title></ComicInfo>", CompressionMethod::Deflated),
    ]);
    let prepared = prepare(&comic, ID, &scratch.0.join("out"));
    assert!(prepared.made());
    let copy = prepared.path();
    assert_eq!(dimensions(&entry(copy, "001.jpg")), (1600, 2560));
    assert_eq!(dimensions(&entry(copy, "003.jpg")), (1200, 1800));
    assert_eq!(entry(copy, "ComicInfo.xml"), b"<ComicInfo><Title>Test</Title></ComicInfo>");
    let mut archive = ZipArchive::new(File::open(copy).unwrap()).unwrap();
    let names = names_in_order(&mut archive).unwrap();
    assert_eq!(names, vec!["001.jpg", "002.jpg", "003.jpg", "ComicInfo.xml", MARKER], "the original's order");
    // The comic reader still finds three pages and nothing else.
    assert_eq!(crate::comic::list_pages(copy).expect("pages"), vec!["001.jpg", "002.jpg", "003.jpg"]);
    assert_eq!(source_of(copy).as_deref(), Some(ID));
  }

  #[test]
  fn animated_and_mislabelled_pictures_are_kept() {
    let mut apng = png(3000, 100);
    apng.splice(33..33, b"\x00\x00\x00\x08acTL\x00\x00\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00".iter().copied());
    assert_eq!(smaller_picture(&apng, ImageFormat::Png, BOOK, true), None);
    let jpg = jpeg(3000, 100, 95);
    assert_eq!(smaller_picture(&jpg, ImageFormat::Png, BOOK, true), None, "a JPEG named .png");
    assert!(smaller_picture(&jpg, ImageFormat::Jpeg, BOOK, true).is_some());
    assert_eq!(fit(4000, 3000, 2048), (2048, 1536));
    assert_eq!(fit(3000, 4500, 2048), (1365, 2048));
    assert_eq!(fit(10_000, 1, 2048), (2048, 1));
  }

  /// A device that downloaded the smaller copy keeps it as the book's file
  /// under the book's id. "Keep a copy of my books in a folder" then finds
  /// the copy it wrote (or the reader renamed) as that book, not a different one.
  #[test]
  fn a_downloaded_copy_is_the_same_book_to_the_folder_of_copies() {
    use crate::storage::library_copy::{copy_book, Outcome};
    let scratch = Scratch::new("copies");
    let original = scratch.0.join("original.epub");
    epub_with(&original, &jpeg(800, 600, 98), &[]);
    let id = crate::storage::hash_file(&original).expect("hash");
    let made = prepare(&original, &id, &scratch.0.join("out"));
    // As `fetch_book` leaves it: `books/<id>.epub`, the copy's bytes.
    fs::create_dir_all(scratch.0.join("books")).unwrap();
    let library_file = scratch.0.join("books").join(format!("{id}.epub"));
    fs::copy(made.path(), &library_file).unwrap();
    drop(made);
    assert_ne!(crate::storage::hash_file(&library_file).unwrap(), id, "not the original's bytes");

    let copies = scratch.0.join("copies");
    fs::create_dir_all(&copies).unwrap();
    let first = copy_book(&copies, &library_file, &id, "Dune", Some("Frank Herbert"), None).expect("copy");
    assert!(matches!(first, Outcome::Copied(_)));
    let again = copy_book(&copies, &library_file, &id, "Dune", Some("Frank Herbert"), None).expect("again");
    assert!(matches!(again, Outcome::AlreadyThere(_)), "{again:?}");
    // Renamed by the reader, and the title changed since: still found.
    fs::rename(first.path(), copies.join("my dune.epub")).unwrap();
    let renamed = copy_book(&copies, &library_file, &id, "Dune (Revised)", None, None).expect("renamed");
    assert!(matches!(renamed, Outcome::AlreadyThere(ref path) if path.ends_with("my dune.epub")), "{renamed:?}");
    assert_eq!(fs::read_dir(&copies).unwrap().count(), 1);
  }

  /// Importing a smaller copy (from an old Drive backup folder, say) is
  /// importing its original: the same id, so a listed book without its file
  /// gets it, as `commands::library::import_one` does for the original.
  #[test]
  fn importing_a_smaller_copy_finds_the_book_it_came_from() {
    let scratch = Scratch::new("import");
    let original = scratch.0.join("Dune.epub");
    epub_with(&original, &jpeg(800, 600, 98), &[]);
    let id = crate::storage::hash_file(&original).expect("hash");
    let made = prepare(&original, &id, &scratch.0.join("out"));
    let from_backup = scratch.0.join(format!("{id}.epub"));
    fs::copy(made.path(), &from_backup).unwrap();

    assert_eq!(crate::storage::book_hash_for_import(&from_backup).expect("hash"), id);
    assert_eq!(crate::storage::book_hash_for_import(&original).expect("hash"), id);

    // The library lists the book (from a backup), without its file here.
    let db = crate::db::tests::memory_db();
    let missing = scratch.0.join("books").join(format!("{id}.epub"));
    let mut record = crate::db::BookRecord {
      finished_at: None,
      id: id.clone(),
      title: "Dune".into(),
      author: None,
      genres: Vec::new(),
      cover_url: None,
      local_path: missing.to_string_lossy().to_string(),
      file_hash: id.clone(),
      progress: 0.4,
      position: None,
      series: None,
      series_index: None,
      last_opened: None,
      created_at: "2026-10-01T09:00:00+00:00".into(),
      metadata_checked_at: None,
      metadata_updated_at: None,
      progress_updated_at: None,
      deleted_at: None,
      available: false
    };
    db.upsert_book(&record).unwrap();
    let hash = crate::storage::book_hash_for_import(&from_backup).unwrap();
    let found = db.find_by_hash(&hash).unwrap().expect("the listed book");
    assert_eq!(found.id, id);
    assert!(!found.available);
    crate::storage::restore_book_file(&from_backup, std::path::Path::new(&found.local_path)).expect("restored");
    assert_eq!(source_of(&missing).as_deref(), Some(id.as_str()));
    record.available = true;
    assert_eq!(record.progress, found.progress, "its place is kept");
  }

  /// The switch: on unless turned off, a device setting, and the total saved.
  #[test]
  fn the_switch_is_on_until_turned_off() {
    let db = crate::db::tests::memory_db();
    assert!(enabled(&db));
    set_enabled(&db, false).unwrap();
    assert!(!enabled(&db));
    set_enabled(&db, true).unwrap();
    assert!(enabled(&db));
    assert_eq!(saved_bytes(&db), 0);
    add_saved(&db, 1500).unwrap();
    add_saved(&db, 500).unwrap();
    assert_eq!(saved_bytes(&db), 2000);
  }

  /// Not a test of the code: a measure of it on real books, for the notes.
  /// `LEAFLET_SMALLER_MEASURE=D:\Books cargo test measure_real_books -- --ignored --nocapture`.
  /// Reads the folder and writes only to the system's temp folder.
  #[test]
  #[ignore]
  fn measure_real_books() {
    let Some(folder) = std::env::var_os("LEAFLET_SMALLER_MEASURE") else {
      return;
    };
    let scratch = Scratch::new("measure");
    let (mut before, mut after, mut covers, mut total_ms) = (0u64, 0u64, 0u64, 0u128);
    let mut rows = Vec::new();
    for entry in fs::read_dir(folder).expect("folder").flatten() {
      let path = entry.path();
      if rules_for(&extension(&path)).is_none() {
        continue;
      }
      let started = Instant::now();
      let prepared = prepare(&path, ID, &scratch.0);
      let took = started.elapsed().as_millis();
      before += prepared.original_bytes;
      after += prepared.bytes;
      covers += prepared.cover_saved;
      total_ms += took;
      let name: String = path.file_name().unwrap().to_string_lossy().chars().take(40).collect();
      rows.push(format!("{:>10} -> {:>10}  {:>3}%  cover {:>8}  {:>6} ms  {}{}", prepared.original_bytes, prepared.bytes, 100 - prepared.bytes * 100 / prepared.original_bytes.max(1), prepared.cover_saved, took, name, if prepared.made() { "" } else { "  (original)" }));
    }
    for row in &rows {
      println!("{row}");
    }
    println!("{} books: {before} -> {after} bytes, covers {covers} of the saving, {total_ms} ms", rows.len());
  }
}
