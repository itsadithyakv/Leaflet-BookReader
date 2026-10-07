//! Fonts of the reader's own, to read a book in.
//!
//! A font file the reader picks is copied into `<app data>/fonts/` under a
//! name made here from its contents: never the name or the path it came with,
//! which could say anything. What each one is called is kept in `index.json`
//! beside them. The database is not touched and nothing is synced: a font is
//! a fact about this device, like the typeface chosen.
//!
//! The webview cannot read a file, so a font reaches it as a data URL
//! (`data`), as a cover does. What is made of it there is in
//! `apps/src/readers/customFonts.ts`.

use anyhow::{anyhow, bail, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// The largest font taken. A book face is well under a megabyte; one with
/// every script in it, a few. The whole file is handed to the page as text.
pub const MAX_BYTES: u64 = 10 * 1024 * 1024;
/// How many are kept. The type panel shows them all at once, with a sample
/// of each, and has no scrolling of its own.
pub const MAX_FONTS: usize = 12;
const MAX_NAME_CHARS: usize = 40;
/// An id is this much of the file's hash, in hex.
const ID_CHARS: usize = 16;
const INDEX: &str = "index.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
  Ttf,
  Otf,
  Woff,
  Woff2
}

impl Kind {
  fn ext(self) -> &'static str {
    match self {
      Self::Ttf => "ttf",
      Self::Otf => "otf",
      Self::Woff => "woff",
      Self::Woff2 => "woff2"
    }
  }

  fn mime(self) -> &'static str {
    match self {
      Self::Ttf => "font/ttf",
      Self::Otf => "font/otf",
      Self::Woff => "font/woff",
      Self::Woff2 => "font/woff2"
    }
  }
}

/// A font the reader added: what it is kept under, and what it is called.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Font {
  pub id: String,
  pub name: String,
  pub kind: Kind
}

impl Font {
  fn file_name(&self) -> String {
    format!("{}.{}", self.id, self.kind.ext())
  }
}

/// What a file is, by its first four bytes: its name is not asked. A
/// collection is several fonts in one file, which a page cannot be handed as
/// one face, so it is refused in words that say so.
pub fn kind_of(head: &[u8]) -> Result<Kind> {
  match head.get(..4) {
    Some([0x00, 0x01, 0x00, 0x00]) | Some(b"true") => Ok(Kind::Ttf),
    Some(b"OTTO") => Ok(Kind::Otf),
    Some(b"wOFF") => Ok(Kind::Woff),
    Some(b"wOF2") => Ok(Kind::Woff2),
    Some(b"ttcf") => bail!("That is a font collection (.ttc), several fonts in one file. Add a single font: .ttf, .otf, .woff or .woff2."),
    _ => bail!("That is not a font file. Leaflet takes .ttf, .otf, .woff and .woff2.")
  }
}

fn check_size(bytes: u64) -> Result<()> {
  if bytes == 0 {
    bail!("That file is empty.");
  }
  if bytes > MAX_BYTES {
    bail!("That font is over {} MB, which is more than Leaflet takes.", MAX_BYTES / (1024 * 1024));
  }
  Ok(())
}

/// What a font is called: its file's name without the ending, tidied. Only
/// ever shown as text, never used to find a file.
fn display_name(path: &Path) -> String {
  let stem = path.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
  let spaced: String = stem
    .chars()
    .map(|c| if c == '_' || c == '-' || c.is_whitespace() { ' ' } else { c })
    .filter(|c| !c.is_control())
    .collect();
  let mut words: Vec<&str> = spaced.split(' ').filter(|word| !word.is_empty()).collect();
  // "Literata-Regular" is Literata.
  if words.len() > 1 && words.last().is_some_and(|word| word.eq_ignore_ascii_case("regular")) {
    words.pop();
  }
  let name: String = words.join(" ").chars().take(MAX_NAME_CHARS).collect();
  let name = name.trim_end();
  if name.is_empty() {
    "Font".to_string()
  } else {
    name.to_string()
  }
}

/// Whether this is an id made here. Asked before an id from the page is put
/// in a path.
fn is_id(id: &str) -> bool {
  id.len() == ID_CHARS && id.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

pub fn dir() -> Result<PathBuf> {
  Ok(crate::storage::app_data_dir()?.join("fonts"))
}

/// One change to the folder at a time: two fonts added at once each read the
/// index, and the second to write it would drop the first.
static CHANGING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// The fonts the index names whose files are still there. An index that is
/// missing or cannot be read is an empty one.
fn read_index(dir: &Path) -> Vec<Font> {
  let Ok(text) = fs::read_to_string(dir.join(INDEX)) else {
    return Vec::new();
  };
  let fonts: Vec<Font> = serde_json::from_str(&text).unwrap_or_default();
  fonts
    .into_iter()
    .filter(|font| is_id(&font.id) && dir.join(font.file_name()).is_file())
    .collect()
}

fn write_index(dir: &Path, fonts: &[Font]) -> Result<()> {
  // Through a staging file, so an interrupted write leaves the old index.
  let staging = dir.join(format!("{INDEX}.part"));
  fs::write(&staging, serde_json::to_vec_pretty(fonts)?)?;
  if let Err(error) = fs::rename(&staging, dir.join(INDEX)) {
    let _ = fs::remove_file(&staging);
    return Err(error.into());
  }
  Ok(())
}

pub fn list() -> Vec<Font> {
  dir().map(|dir| read_index(&dir)).unwrap_or_default()
}

/// Copies a font the reader picked into the folder, if it is one. The same
/// file added again is the font already there.
pub fn add(source: &Path) -> Result<Font> {
  add_in(&dir()?, source)
}

fn add_in(dir: &Path, source: &Path) -> Result<Font> {
  let unreadable = |error: std::io::Error| anyhow!("That file could not be read: {error}");
  let metadata = fs::metadata(source).map_err(unreadable)?;
  if metadata.is_dir() {
    bail!("That is a folder, not a font file.");
  }
  check_size(metadata.len())?;
  // No more than the limit is read, whatever the size was a moment ago.
  let mut bytes = Vec::new();
  fs::File::open(source)
    .and_then(|file| file.take(MAX_BYTES + 1).read_to_end(&mut bytes))
    .map_err(unreadable)?;
  check_size(bytes.len() as u64)?;
  let kind = kind_of(&bytes)?;
  let mut id = hex::encode(Sha256::digest(&bytes));
  id.truncate(ID_CHARS);

  let _one_at_a_time = CHANGING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  let mut fonts = read_index(dir);
  if let Some(existing) = fonts.iter().find(|font| font.id == id) {
    return Ok(existing.clone());
  }
  if fonts.len() >= MAX_FONTS {
    bail!("Leaflet keeps {MAX_FONTS} fonts. Remove one to add another.");
  }
  let font = Font { id, name: display_name(source), kind };
  fs::create_dir_all(dir)?;
  let dest = dir.join(font.file_name());
  let staging = dir.join(format!("{}.part", font.file_name()));
  fs::write(&staging, &bytes)?;
  if let Err(error) = fs::rename(&staging, &dest) {
    let _ = fs::remove_file(&staging);
    return Err(error.into());
  }
  fonts.push(font.clone());
  write_index(dir, &fonts)?;
  Ok(font)
}

/// A font as a data URL for the page's stylesheet. `None` for one that is not
/// there (removed, or an id from another time): the page then keeps the face
/// it has, and nothing is said.
pub fn data(id: &str) -> Result<Option<String>> {
  data_in(&dir()?, id)
}

fn data_in(dir: &Path, id: &str) -> Result<Option<String>> {
  if !is_id(id) {
    return Ok(None);
  }
  let Some(font) = read_index(dir).into_iter().find(|font| font.id == id) else {
    return Ok(None);
  };
  let path = dir.join(font.file_name());
  if fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(u64::MAX) > MAX_BYTES {
    return Ok(None);
  }
  let bytes = fs::read(&path)?;
  // The type comes from the bytes again: the file could have been changed by
  // hand since, and a page told "woff2" of something else shows nothing.
  let Ok(kind) = kind_of(&bytes) else {
    return Ok(None);
  };
  let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
  Ok(Some(format!("data:{};base64,{}", kind.mime(), encoded)))
}

pub fn remove(id: &str) -> Result<()> {
  remove_in(&dir()?, id)
}

fn remove_in(dir: &Path, id: &str) -> Result<()> {
  if !is_id(id) {
    return Ok(());
  }
  let _one_at_a_time = CHANGING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  let fonts = read_index(dir);
  let (gone, kept): (Vec<Font>, Vec<Font>) = fonts.into_iter().partition(|font| font.id == id);
  if gone.is_empty() {
    return Ok(());
  }
  // The index first: a file left without an entry is only lost space, an
  // entry left without its file would be a font that cannot be read.
  write_index(dir, &kept)?;
  for font in gone {
    let _ = fs::remove_file(dir.join(font.file_name()));
  }
  Ok(())
}

/// Every font and the index, for "Delete All Data". Best effort.
pub fn remove_all() {
  let _one_at_a_time = CHANGING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  if let Ok(dir) = dir() {
    let _ = fs::remove_dir_all(dir);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const TTF: [u8; 4] = [0x00, 0x01, 0x00, 0x00];

  fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("leaflet-fonts-{name}-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("dir");
    dir
  }

  /// A file that starts as a font does, with `tail` to tell one from another.
  fn put(dir: &Path, name: &str, magic: &[u8], tail: &[u8]) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, [magic, tail].concat()).expect("write");
    path
  }

  #[test]
  fn a_font_is_known_by_its_first_bytes() {
    assert_eq!(kind_of(&[0x00, 0x01, 0x00, 0x00, 0x00, 0x0C]).unwrap(), Kind::Ttf);
    assert_eq!(kind_of(b"true and more").unwrap(), Kind::Ttf);
    assert_eq!(kind_of(b"OTTO\x00\x0b").unwrap(), Kind::Otf);
    assert_eq!(kind_of(b"wOFF\x00\x01\x00\x00").unwrap(), Kind::Woff);
    assert_eq!(kind_of(b"wOF2\x00\x01\x00\x00").unwrap(), Kind::Woff2);
    assert_eq!((Kind::Ttf.mime(), Kind::Otf.mime(), Kind::Woff.mime(), Kind::Woff2.mime()), ("font/ttf", "font/otf", "font/woff", "font/woff2"));
  }

  #[test]
  fn what_is_not_one_font_is_refused_in_plain_words() {
    let collection = kind_of(b"ttcf\x00\x02\x00\x00").unwrap_err().to_string();
    assert!(collection.contains("font collection") && collection.contains(".ttf"), "{collection}");
    for other in [&b"PK\x03\x04 an epub"[..], b"%PDF-1.7", b"<!DOCTYPE html>", b"wOF", b"", b"\x00\x01\x00", b"typ1"] {
      let message = kind_of(other).unwrap_err().to_string();
      assert!(message.contains("not a font file"), "{message}");
    }
  }

  #[test]
  fn a_font_has_a_size_worth_taking() {
    assert!(check_size(1).is_ok());
    assert!(check_size(MAX_BYTES).is_ok());
    assert!(check_size(0).unwrap_err().to_string().contains("empty"));
    let message = check_size(MAX_BYTES + 1).unwrap_err().to_string();
    assert!(message.contains("over 10 MB"), "{message}");
  }

  #[test]
  fn a_font_is_called_what_its_file_was_tidied() {
    let name = |path: &str| display_name(Path::new(path));
    assert_eq!(name("/home/mara/Fonts/Literata-Regular.ttf"), "Literata");
    assert_eq!(name("Atkinson_Hyperlegible-Bold.otf"), "Atkinson Hyperlegible Bold");
    assert_eq!(name("  EB   Garamond  .woff2"), "EB Garamond");
    assert_eq!(name("Regular.ttf"), "Regular");
    assert_eq!(name("思源宋体.otf"), "思源宋体");
    assert_eq!(name("tab\there\u{7}.ttf"), "tab here");
    assert_eq!(name("---.ttf"), "Font");
    assert_eq!(name(""), "Font");
    // Forty characters of it, and not the space it may be cut on.
    assert_eq!(name(&format!("{}.ttf", "Very Long Family Name ".repeat(6))), "Very Long Family Name Very Long Family N");
    assert_eq!(name(&format!("{} and more.ttf", "a".repeat(MAX_NAME_CHARS - 1))), "a".repeat(MAX_NAME_CHARS - 1));
    assert_eq!(name(&format!("{}.otf", "宋".repeat(60))).chars().count(), MAX_NAME_CHARS);
  }

  #[test]
  fn only_an_id_made_here_reaches_a_path() {
    assert!(is_id("0123456789abcdef"));
    for bad in ["", "0123456789abcde", "0123456789abcdef0", "0123456789ABCDEF", "../../library.db", "..\\..\\index.json", "0123456789abcde/", "0123456789abcde."] {
      assert!(!is_id(bad), "{bad}");
    }
  }

  #[test]
  fn a_font_added_is_kept_under_a_name_of_its_own_and_handed_back_whole() {
    let root = scratch("add");
    let fonts = root.join("fonts");
    let source = put(&root, "..My Fav'rite (Font)-Regular.TTF", &TTF, b" the tables");

    let font = add_in(&fonts, &source).expect("add");
    assert!(is_id(&font.id));
    assert_eq!((font.name.as_str(), font.kind), ("..My Fav'rite (Font)", Kind::Ttf));
    // Nothing of the name it came with is in the folder.
    let mut kept: Vec<String> = fs::read_dir(&fonts).expect("read").flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect();
    kept.sort();
    assert_eq!(kept, vec![format!("{}.ttf", font.id), INDEX.to_string()]);
    assert_eq!(read_index(&fonts), vec![font.clone()]);

    let url = data_in(&fonts, &font.id).expect("data").expect("there");
    let encoded = url.strip_prefix("data:font/ttf;base64,").expect("a font's data URL");
    assert_eq!(base64::engine::general_purpose::STANDARD.decode(encoded).expect("base64"), [&TTF[..], b" the tables"].concat());

    // The original can go, and the same file added again is the same font.
    let again = add_in(&fonts, &put(&root, "another name.ttf", &TTF, b" the tables")).expect("again");
    assert_eq!(again, font);
    assert_eq!(read_index(&fonts).len(), 1);
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn what_is_not_a_font_is_not_kept() {
    let root = scratch("refuse");
    let fonts = root.join("fonts");
    let refused = |path: &Path| add_in(&fonts, path).unwrap_err().to_string();

    assert!(refused(&put(&root, "really a book.ttf", b"PK\x03\x04", b"mimetype")).contains("not a font file"));
    assert!(refused(&put(&root, "family.ttc", b"ttcf", b"\x00\x02")).contains("font collection"));
    assert!(refused(&put(&root, "nothing.otf", b"", b"")).contains("empty"));
    assert!(refused(&root).contains("folder"));
    assert!(refused(&root.join("gone.ttf")).contains("could not be read"));
    assert!(!fonts.exists(), "nothing was written");
    assert!(read_index(&fonts).is_empty());
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn a_font_removed_is_gone_and_one_never_there_is_no_error() {
    let root = scratch("remove");
    let fonts = root.join("fonts");
    let serif = add_in(&fonts, &put(&root, "Serif.otf", b"OTTO", b"one")).expect("add");
    let sans = add_in(&fonts, &put(&root, "Sans.woff2", b"wOF2", b"two")).expect("add");
    assert_eq!(read_index(&fonts), vec![serif.clone(), sans.clone()]);
    assert!(data_in(&fonts, &sans.id).expect("data").expect("there").starts_with("data:font/woff2;base64,"));

    remove_in(&fonts, &serif.id).expect("remove");
    assert_eq!(read_index(&fonts), vec![sans.clone()]);
    assert!(!fonts.join(format!("{}.otf", serif.id)).exists());
    assert_eq!(data_in(&fonts, &serif.id).expect("data"), None);

    // An id from another time, and things that are not ids at all.
    remove_in(&fonts, &serif.id).expect("again");
    remove_in(&fonts, "../index").expect("not an id");
    assert_eq!(data_in(&fonts, "fedcba9876543210").expect("data"), None);
    assert_eq!(data_in(&fonts, "../index").expect("data"), None);
    assert_eq!(read_index(&fonts), vec![sans.clone()]);

    // A file deleted by hand takes its font off the list.
    fs::remove_file(fonts.join(format!("{}.woff2", sans.id))).expect("delete");
    assert!(read_index(&fonts).is_empty());
    assert_eq!(data_in(&fonts, &sans.id).expect("data"), None);
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn a_font_changed_by_hand_into_something_else_is_not_handed_over() {
    let root = scratch("changed");
    let fonts = root.join("fonts");
    let font = add_in(&fonts, &put(&root, "Serif.ttf", &TTF, b"one")).expect("add");
    fs::write(fonts.join(format!("{}.ttf", font.id)), b"<html>not a font now</html>").expect("overwrite");
    assert_eq!(data_in(&fonts, &font.id).expect("data"), None);
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn an_index_that_cannot_be_read_is_an_empty_one() {
    let root = scratch("index");
    let fonts = root.join("fonts");
    fs::create_dir_all(&fonts).expect("dir");
    fs::write(fonts.join(INDEX), b"{ not json").expect("write");
    assert!(read_index(&fonts).is_empty());
    // An entry whose id was written by hand is not followed out of the folder.
    fs::write(root.join("secret.ttf"), TTF).expect("write");
    fs::write(fonts.join(INDEX), br#"[{"id":"../secret","name":"x","kind":"ttf"}]"#).expect("write");
    assert!(read_index(&fonts).is_empty());
    let font = add_in(&fonts, &put(&root, "Serif.ttf", &TTF, b"one")).expect("add");
    assert_eq!(read_index(&fonts), vec![font]);
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn no_more_fonts_are_kept_than_the_panel_shows() {
    let root = scratch("many");
    let fonts = root.join("fonts");
    for number in 0..MAX_FONTS {
      add_in(&fonts, &put(&root, &format!("Face {number}.ttf"), &TTF, number.to_string().as_bytes())).expect("add");
    }
    let message = add_in(&fonts, &put(&root, "One more.ttf", &TTF, b"more")).unwrap_err().to_string();
    assert!(message.contains("Remove one"), "{message}");
    assert_eq!(read_index(&fonts).len(), MAX_FONTS);
    // One already there is still found, and room made is room.
    let first = add_in(&fonts, &root.join("Face 0.ttf")).expect("already there");
    remove_in(&fonts, &first.id).expect("remove");
    add_in(&fonts, &root.join("One more.ttf")).expect("room now");
    let _ = fs::remove_dir_all(&root);
  }
}
