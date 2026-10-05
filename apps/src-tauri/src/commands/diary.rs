//! Pip's diary: what it reads, and the one thing it writes.
//!
//! The diary is never stored. Each day's entry is worked out in the app
//! (`src/pip/diary/`) from what is already kept: the ledger and the shelf
//! (the habit snapshot), and what is gathered here, which the snapshot does
//! not carry: when each book last moved and how far it is, and the things the
//! reader attached to a place on a day (a highlight, a character, a word
//! looked up). All of it is in the backup already, so two devices holding the
//! same backup write the same diary.
//!
//! The one thing written is a weekly postcard, as a picture, where the reader
//! chooses.

use super::*;
use crate::db::Database;

/// A book as the diary needs it: its name, how far it is, and when it moved.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiaryBook {
  pub id: String,
  pub title: String,
  pub author: Option<String>,
  pub progress: f32,
  pub progress_updated_at: Option<String>,
  pub last_opened: Option<String>
}

/// Something the reader attached to a place in a book, cut down to what a
/// diary line can use.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiaryMark {
  pub id: String,
  pub book_id: String,
  pub kind: String,
  /// A highlight's first words, a character's name, a word looked up.
  pub words: Option<String>,
  /// The row's small JSON object, for the kinds that have one (how far through
  /// the book a character was written down). Never a highlight's note.
  pub detail: Option<String>,
  pub chapter: Option<String>,
  /// Whether it was written at an exact place (a sheet brought in from
  /// another book has none).
  pub has_place: bool,
  pub created_at: String
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiarySources {
  pub books: Vec<DiaryBook>,
  pub marks: Vec<DiaryMark>
}

/// The kinds a diary line is made from. Bookmarks, and the rest of a character
/// sheet (notes, links, groups), are not among them.
const MARK_KINDS: [&str; 3] = ["highlight", "person", "word"];
/// A diary quotes a few words of a highlight, never the passage.
const MAX_QUOTE: usize = 200;
const MAX_NAME: usize = 120;

fn clipped(value: Option<String>, max: usize) -> Option<String> {
  value.map(|text| text.chars().take(max).collect::<String>()).filter(|text| !text.trim().is_empty())
}

pub(super) fn sources(db: &Database) -> Result<DiarySources, String> {
  // Removed books too: a day's entry still names the book that was read then.
  let books = db
    .list_books_for_sync()
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|book| DiaryBook {
      id: book.id,
      title: book.title,
      author: book.author,
      progress: book.progress,
      progress_updated_at: book.progress_updated_at,
      last_opened: book.last_opened
    })
    .collect();
  let mut marks: Vec<DiaryMark> = db
    .all_annotations()
    .map_err(|e| e.to_string())?
    .into_iter()
    .filter(|row| row.deleted_at.is_none() && MARK_KINDS.contains(&row.kind.as_str()))
    .map(|row| {
      let highlight = row.kind == "highlight";
      DiaryMark {
        words: if highlight { clipped(row.text.clone(), MAX_QUOTE) } else { clipped(row.note, MAX_NAME) },
        detail: if highlight { None } else { row.text },
        has_place: !row.cfi.trim().is_empty(),
        id: row.id,
        book_id: row.book_id,
        kind: row.kind,
        chapter: row.chapter,
        created_at: row.created_at
      }
    })
    .collect();
  marks.sort_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.id.cmp(&b.id)));
  Ok(DiarySources { books, marks })
}

/// What the diary is written from, beyond the habit snapshot.
#[tauri::command]
pub fn diary_sources(state: State<'_, AppState>) -> Result<DiarySources, String> {
  let db = state.db.guard();
  sources(&db)
}

/// A postcard is a few hundred kilobytes; nothing near this is one.
const MAX_PICTURE_BYTES: usize = 8 * 1024 * 1024;
/// The card is 1200 by 1500. A picture far larger is not the card.
const MAX_PICTURE_SIDE: u32 = 4096;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// The picture's width and height, read from its header, if it is a PNG at
/// all: the signature, then the IHDR chunk first, as every PNG has.
fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
  if bytes.len() < 33 || bytes[..8] != PNG_SIGNATURE || &bytes[12..16] != b"IHDR" {
    return None;
  }
  let number = |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
  Some((number(16), number(20)))
}

/// Writes a postcard where the reader chose (the save dialog's path). Only a
/// `.png` file, and only a picture that is one: this is not a way to write
/// anything anywhere.
fn write_picture(path: &str, bytes: &[u8]) -> Result<(), String> {
  let target = std::path::Path::new(path);
  let is_png = target.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("png"));
  if !is_png {
    return Err("A postcard is saved as a .png file.".to_string());
  }
  if bytes.len() > MAX_PICTURE_BYTES {
    return Err("That picture is too large to save.".to_string());
  }
  let not_a_picture = || "That is not a picture.".to_string();
  let (width, height) = png_size(bytes).ok_or_else(not_a_picture)?;
  if width == 0 || height == 0 || width > MAX_PICTURE_SIDE || height > MAX_PICTURE_SIDE {
    return Err(not_a_picture());
  }
  // Read all the way through: a header with anything at all after it is not a picture.
  image::load_from_memory_with_format(bytes, image::ImageFormat::Png).map_err(|_| not_a_picture())?;
  fs::write(target, bytes).map_err(|e| format!("Couldn't save the picture: {e}"))
}

/// Saves the week's postcard as a picture. `png` is the picture in base64 (a
/// list of numbers is ten times the size on the way here).
#[tauri::command]
pub fn diary_save_picture(path: String, png: String) -> Result<(), String> {
  // Checked before decoding: base64 is four characters for three bytes.
  if png.len() > MAX_PICTURE_BYTES / 3 * 4 + 4 {
    return Err("That picture is too large to save.".to_string());
  }
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(png.as_bytes())
    .map_err(|_| "That is not a picture.".to_string())?;
  write_picture(&path, &bytes)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;
  use crate::db::Annotation;

  const NOW: &str = "2026-10-04T10:00:00Z";

  fn book(id: &str, title: &str, progress: f32, deleted: bool) -> BookRecord {
    BookRecord {
      id: id.to_string(),
      title: title.to_string(),
      author: Some("Someone".to_string()),
      genres: Vec::new(),
      cover_url: None,
      local_path: format!("/books/{id}.epub"),
      file_hash: id.to_string(),
      progress,
      position: None,
      series: None,
      series_index: None,
      last_opened: Some(NOW.to_string()),
      created_at: NOW.to_string(),
      metadata_checked_at: None,
      metadata_updated_at: Some(NOW.to_string()),
      progress_updated_at: Some(NOW.to_string()),
      deleted_at: deleted.then(|| NOW.to_string()),
      available: true
    }
  }

  fn row(id: &str, kind: &str, text: Option<&str>, note: Option<&str>, at: &str) -> Annotation {
    Annotation {
      id: id.into(),
      book_id: "b1".into(),
      kind: kind.into(),
      cfi: if kind == "person.note" { String::new() } else { "epubcfi(/6/4!/4/2/1:0)".into() },
      text: text.map(str::to_string),
      note: note.map(str::to_string),
      color: None,
      chapter: Some("Chapter 2".into()),
      created_at: at.into(),
      updated_at: at.into(),
      deleted_at: None
    }
  }

  #[test]
  fn the_diary_is_given_books_and_the_marks_it_can_use_and_nothing_else() {
    let db = memory_db();
    db.upsert_book(&book("b1", "Mistborn", 0.42, false)).expect("book");
    db.upsert_book(&book("b2", "A Removed Book", 1.0, true)).expect("book");
    let long = "word ".repeat(200);
    db.put_annotation(&row("h1", "highlight", Some(&long), Some("a private note"), "2026-10-02T09:00:00Z")).expect("save");
    db.put_annotation(&row("m1", "bookmark", None, None, "2026-10-02T09:00:00Z")).expect("save");
    db.put_annotation(&row("p1", "person", Some(r#"{"p":0.1}"#), Some("Vin"), "2026-10-01T09:00:00Z")).expect("save");
    db.put_annotation(&row("n1", "person.note", Some(r#"{"p":0.1,"who":"p1"}"#), Some("a thief"), "2026-10-01T09:00:00Z")).expect("save");
    db.put_annotation(&row("w1", "word", Some(r#"{"p":0.2,"m":"a mist"}"#), Some("brume"), "2026-10-03T09:00:00Z")).expect("save");
    let mut gone = row("h2", "highlight", Some("deleted"), None, "2026-10-03T09:00:00Z");
    gone.deleted_at = Some(NOW.into());
    db.put_annotation(&gone).expect("save");

    let found = sources(&db).expect("sources");
    let mut titles: Vec<&str> = found.books.iter().map(|b| b.title.as_str()).collect();
    titles.sort();
    assert_eq!(titles, vec!["A Removed Book", "Mistborn"], "a removed book still has its name");
    let mistborn = found.books.iter().find(|b| b.id == "b1").expect("book");
    assert_eq!(mistborn.progress_updated_at.as_deref(), Some(NOW));

    // Oldest first: the character, the highlight, the word. No bookmark, no
    // character note, nothing deleted.
    assert_eq!(found.marks.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["p1", "h1", "w1"]);
    let highlight = &found.marks[1];
    assert_eq!(highlight.words.as_ref().map(|w| w.chars().count()), Some(MAX_QUOTE));
    assert_eq!(highlight.detail, None, "a highlight's note stays where it is");
    assert_eq!(found.marks[0].words.as_deref(), Some("Vin"));
    assert_eq!(found.marks[0].detail.as_deref(), Some(r#"{"p":0.1}"#));
    assert!(found.marks[0].has_place);
    assert_eq!(found.marks[2].words.as_deref(), Some("brume"));
  }

  #[test]
  fn an_empty_library_has_an_empty_diary() {
    let found = sources(&memory_db()).expect("sources");
    assert!(found.books.is_empty());
    assert!(found.marks.is_empty());
  }

  /// A real, tiny picture: 2 by 3, drawn by the same library that reads it.
  fn tiny_png() -> Vec<u8> {
    let mut bytes = Vec::new();
    image::RgbaImage::from_pixel(2, 3, image::Rgba([240, 234, 220, 255]))
      .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png)
      .expect("encode");
    bytes
  }

  #[test]
  fn a_postcard_is_saved_only_as_a_png_and_only_if_it_is_one() {
    let dir = std::env::temp_dir().join(format!("leaflet-diary-test-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("dir");
    let png = tiny_png();
    assert_eq!(png_size(&png), Some((2, 3)));

    let good = dir.join("Pip's week.PNG");
    write_picture(good.to_str().expect("path"), &png).expect("save");
    assert_eq!(fs::read(&good).expect("read"), png);

    // Through the command's own door: base64 in, the same bytes out.
    let again = dir.join("again.png");
    let encoded = base64::engine::general_purpose::STANDARD.encode(&png);
    diary_save_picture(again.to_str().expect("path").to_string(), encoded).expect("save");
    assert_eq!(fs::read(&again).expect("read"), png);

    let mut cut_short = png.clone();
    cut_short.truncate(40);
    let mut wrong_start = png.clone();
    wrong_start[1] = b'X';
    let mut huge_claim = png.clone();
    huge_claim[16..20].copy_from_slice(&(MAX_PICTURE_SIDE + 1).to_be_bytes());
    let cases: Vec<(&str, Vec<u8>)> = vec![
      ("card.jpg", png.clone()),
      ("card", png.clone()),
      ("run.bat", png.clone()),
      ("card.png.exe", png.clone()),
      ("text.png", b"not a picture at all, just words in a file".to_vec()),
      ("script.png", b"<script>alert(1)</script>".to_vec()),
      ("empty.png", Vec::new()),
      ("short.png", cut_short),
      ("start.png", wrong_start),
      ("claim.png", huge_claim)
    ];
    for (name, bytes) in cases {
      let path = dir.join(name);
      assert!(write_picture(path.to_str().expect("path"), &bytes).is_err(), "{name}");
      assert!(!path.exists(), "{name} was written");
    }
    let too_big = vec![0u8; MAX_PICTURE_BYTES + 1];
    assert!(write_picture(dir.join("big.png").to_str().expect("path"), &too_big).is_err());
    assert!(diary_save_picture(dir.join("b64.png").to_str().expect("path").to_string(), "not base64!".to_string()).is_err());
    assert!(!dir.join("b64.png").exists());
    let _ = fs::remove_dir_all(&dir);
  }
}
