//! `cover:` — the library's covers by URL, at the size a card draws them.
//!
//! The page asks for `cover://localhost/<book id>?w=240` (on Windows and
//! Android the web view writes it `http://cover.localhost/...`; the page gets
//! the right form from `convertFileSrc`). The answer is the book's thumbnail
//! of that width (`storage::thumbs`), read from disk and handed to the web
//! view as an image: no base64 through the IPC bridge, no copy of every cover
//! in the page's memory, and `srcset` lets the web view pick 240 or 480 for
//! the screen.
//!
//! A cover without its thumbnails yet (a library from before they existed)
//! is answered with the full cover at once, not cached, while its thumbnails
//! are made in the background (`thumbs::request`); the next time the card is
//! drawn they are there. The URL carries the cover's own file name (`v`), so
//! a new cover is a new URL and the old picture is never shown from cache.

use crate::{storage, AppState, LockExt};
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

pub const SCHEME: &str = "cover";

/// What a request asks for: a book, and a width.
#[derive(Debug, PartialEq, Eq)]
pub struct Ask {
  pub book_id: String,
  pub width: u32
}

/// Reads `/<book id>?w=<width>` (the id percent-encoded). `None` for anything else.
pub fn parse(path: &str, query: Option<&str>) -> Option<Ask> {
  let raw = path.trim_start_matches('/');
  if raw.is_empty() || raw.contains('/') {
    return None;
  }
  let book_id = percent_decode(raw)?;
  if book_id.is_empty() || book_id.len() > 200 {
    return None;
  }
  let width = query
    .unwrap_or("")
    .split('&')
    .find_map(|pair| pair.strip_prefix("w="))
    .and_then(|value| value.parse::<u32>().ok())
    .unwrap_or(storage::thumbs::WIDTHS[0]);
  Some(Ask { book_id, width: storage::thumbs::width_for(width) })
}

fn percent_decode(text: &str) -> Option<String> {
  let bytes = text.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut at = 0;
  while at < bytes.len() {
    if bytes[at] == b'%' {
      let hex = text.get(at + 1..at + 3)?;
      out.push(u8::from_str_radix(hex, 16).ok()?);
      at += 3;
    } else {
      out.push(bytes[at]);
      at += 1;
    }
  }
  String::from_utf8(out).ok()
}

/// What is sent back, decided from the files alone (so it can be tested
/// without a web view).
#[derive(Debug, PartialEq, Eq)]
pub enum Answer {
  /// The thumbnail, which never changes under its URL.
  Thumb(PathBuf),
  /// The full cover, for now: its thumbnails are being made.
  Full(PathBuf),
  Missing
}

pub fn answer(dir: &Path, cover: Option<&Path>, hash: &str, width: u32) -> Answer {
  let Some(cover) = cover.filter(|cover| cover.is_file()) else {
    return Answer::Missing;
  };
  match storage::thumbs::fresh(dir, cover, hash, width) {
    Some(thumb) => Answer::Thumb(thumb),
    None => {
      storage::thumbs::request(dir, cover, hash);
      Answer::Full(cover.to_path_buf())
    }
  }
}

fn respond(status: StatusCode, body: Vec<u8>, mime: &str, cache: &str) -> Response<Cow<'static, [u8]>> {
  Response::builder()
    .status(status)
    .header(header::CONTENT_TYPE, mime)
    .header(header::CACHE_CONTROL, cache)
    // The page is another origin (tauri.localhost): it may draw these, and
    // read them into a canvas (Pip's cover colours) without tainting it.
    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
    .body(Cow::Owned(body))
    .unwrap_or_else(|_| Response::new(Cow::Borrowed(&[][..])))
}

fn not_found() -> Response<Cow<'static, [u8]>> {
  respond(StatusCode::NOT_FOUND, Vec::new(), "text/plain", "no-store")
}

fn serve(path: &Path, cache: &str) -> Response<Cow<'static, [u8]>> {
  match std::fs::read(path) {
    Ok(bytes) => {
      // Covers are named .jpg whatever they are: the type comes from the bytes.
      let mime = storage::sniff_image_mime(&bytes).unwrap_or("image/jpeg");
      respond(StatusCode::OK, bytes, mime, cache)
    }
    Err(_) => not_found()
  }
}

/// The handler given to `register_asynchronous_uri_scheme_protocol`: the
/// reading and any decoding happen on a blocking thread, never on the
/// window's.
pub fn handle<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
  let app = context.app_handle().clone();
  let uri = request.uri().clone();
  tauri::async_runtime::spawn_blocking(move || {
    let Some(ask) = parse(uri.path(), uri.query()) else {
      return responder.respond(not_found());
    };
    let Some(state) = app.try_state::<AppState>() else {
      return responder.respond(not_found());
    };
    let book = state.db.guard().find_by_id(&ask.book_id).ok().flatten();
    let Some(book) = book else {
      return responder.respond(not_found());
    };
    let Ok(dir) = storage::covers_dir() else {
      return responder.respond(not_found());
    };
    let cover = book.cover_url.as_deref().filter(|url| !url.starts_with("http")).map(PathBuf::from);
    let response = match answer(&dir, cover.as_deref(), &book.file_hash, ask.width) {
      Answer::Thumb(path) => serve(&path, "public, max-age=31536000, immutable"),
      Answer::Full(path) => serve(&path, "no-store"),
      Answer::Missing => not_found()
    };
    responder.respond(response);
  });
}

/// The library's books whose covers have no thumbnails yet, made in the
/// background a little after startup, one at a time: a library from before
/// thumbnails gets them without waiting for each card to be drawn.
pub fn warm_after_startup<R: Runtime>(app: &tauri::AppHandle<R>) {
  let app = app.clone();
  let _ = std::thread::Builder::new().name("cover-thumbs-warm".into()).spawn(move || {
    // After the library has opened and drawn its first screen.
    std::thread::sleep(std::time::Duration::from_secs(8));
    let Some(state) = app.try_state::<AppState>() else {
      return;
    };
    let books = state.db.guard().list_books().unwrap_or_default();
    let Ok(dir) = storage::covers_dir() else {
      return;
    };
    for book in books {
      if let Some(cover) = book.cover_url.as_deref().filter(|url| !url.starts_with("http")) {
        let cover = Path::new(cover);
        if cover.is_file() {
          storage::thumbs::request(&dir, cover, &book.file_hash);
        }
      }
    }
  });
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  #[test]
  fn a_request_names_a_book_and_a_width() {
    assert_eq!(parse("/abc-123", Some("w=480&v=x-cover.jpg")), Some(Ask { book_id: "abc-123".into(), width: 480 }));
    assert_eq!(parse("/abc", Some("w=300")), Some(Ask { book_id: "abc".into(), width: 480 }), "the next width up");
    assert_eq!(parse("/abc", None), Some(Ask { book_id: "abc".into(), width: 240 }));
    assert_eq!(parse("/a%20b%2Fc", Some("w=240")), Some(Ask { book_id: "a b/c".into(), width: 240 }));
    assert_eq!(parse("/", None), None);
    assert_eq!(parse("/a/b", None), None, "no paths");
    assert_eq!(parse("/%zz", None), None);
    assert_eq!(parse("/%e2%82", None), None, "not UTF-8");
  }

  #[test]
  fn a_cover_without_thumbnails_is_served_whole_and_they_are_asked_for() {
    let dir = std::env::temp_dir().join(format!("leaflet-cover-protocol-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("dir");
    let cover = dir.join("h-cover.jpg");
    image::RgbImage::from_pixel(900, 1350, image::Rgb([20, 40, 60])).save_with_format(&cover, image::ImageFormat::Jpeg).expect("cover");
    assert_eq!(answer(&dir, Some(&cover), "h", 480), Answer::Full(cover.clone()));
    storage::thumbs::make(&dir, &cover, "h").expect("thumbs");
    assert_eq!(answer(&dir, Some(&cover), "h", 480), Answer::Thumb(dir.join("h-thumb-480.jpg")));
    assert_eq!(answer(&dir, Some(&cover), "h", 240), Answer::Thumb(dir.join("h-thumb-240.jpg")));
    assert_eq!(answer(&dir, None, "h", 240), Answer::Missing);
    assert_eq!(answer(&dir, Some(&dir.join("gone-cover.jpg")), "gone", 240), Answer::Missing);
    let _ = fs::remove_dir_all(&dir);
  }
}
