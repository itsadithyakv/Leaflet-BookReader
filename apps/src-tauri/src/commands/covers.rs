//! Choosing a series' covers: the sets its books have been published in, a
//! look at each cover, and putting one on a book.

use super::*;
use crate::metadata::editions;

// ---- covers ----------------------------------------------------------------
//
// The webview may not load pictures from the web (the app's content policy
// allows only its own), so the covers on offer are fetched here and handed
// over as `data:` URLs, like every other cover.

/// A book of the series, as the page asks about it: its id here, and the
/// title to look it up by (the series list's own title for a well-known
/// series, which a translated or oddly named file would not find).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverAsk {
  pub book_id: String,
  pub title: String,
  pub author: Option<String>
}

/// The most books one series is asked about: two requests each, one after
/// another (Open Library asks clients to be gentle).
const SERIES_MAX: usize = 24;

/// The sets of covers a series can wear: one publisher's cover for each book
/// it published, the publishers that cover most of the series first.
#[tauri::command]
pub async fn series_cover_sets(books: Vec<CoverAsk>, state: State<'_, AppState>) -> Result<Vec<editions::CoverSet>, String> {
  // Only books this library has: an id is what a cover is later put on.
  let known: Vec<CoverAsk> = {
    let db = state.db.guard();
    books
      .into_iter()
      .filter(|ask| !ask.title.trim().is_empty() && db.find_by_id(&ask.book_id).ok().flatten().is_some())
      .take(SERIES_MAX)
      .collect()
  };
  let mut found = Vec::with_capacity(known.len());
  let mut failed = None;
  for ask in known {
    let query = normalize::normalize_query(&ask.title, ask.author.as_deref());
    match editions::fetch(&query.title, query.author.as_deref()).await {
      Ok(covers) => found.push((ask.book_id, covers)),
      // One book the catalogue will not answer for does not lose the rest.
      Err(error) => failed = Some(error.to_string())
    }
  }
  let sets = editions::cover_sets(&found);
  match (sets.is_empty(), failed) {
    (true, Some(error)) => Err(format!("Could not reach Open Library: {error}")),
    _ => Ok(sets)
  }
}

async fn cover_bytes(cover_id: i64, size: char) -> Result<Vec<u8>, String> {
  if cover_id <= 0 {
    return Err("No such cover.".to_string());
  }
  let client = reqwest::Client::builder()
    .user_agent(crate::http::user_agent())
    .timeout(std::time::Duration::from_secs(20))
    .build()
    .map_err(|e| e.to_string())?;
  // `default=false`: a missing cover is a 404, not a blank picture to save.
  let bytes = client
    .get(format!("https://covers.openlibrary.org/b/id/{cover_id}-{size}.jpg?default=false"))
    .send()
    .await
    .and_then(|response| response.error_for_status())
    .map_err(|_| "That cover could not be fetched.".to_string())?
    .bytes()
    .await
    .map_err(|_| "That cover could not be fetched.".to_string())?;
  match storage::sniff_image_mime(&bytes) {
    Some("image/jpeg") | Some("image/png") => Ok(bytes.to_vec()),
    _ => Err("That cover could not be read.".to_string())
  }
}

/// One cover on offer, small, as a `data:` URL for the picker to show.
#[tauri::command]
pub async fn cover_preview(cover_id: i64) -> Result<String, String> {
  let bytes = cover_bytes(cover_id, 'M').await?;
  let mime = storage::sniff_image_mime(&bytes).unwrap_or("image/jpeg");
  Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

/// Puts a chosen cover on a book, in place of whatever it had. Kept under a
/// name of its own (`storage::store_chosen_cover`), so a later lookup never
/// takes it for a cover still to be found, or writes over it.
#[tauri::command]
pub async fn apply_cover(book_id: String, cover_id: i64, state: State<'_, AppState>) -> Result<BookRecord, String> {
  let mut book = {
    let db = state.db.guard();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };
  let bytes = cover_bytes(cover_id, 'L').await?;
  let hash = book.file_hash.clone();
  let saved = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<std::path::PathBuf> {
    let cover = storage::store_chosen_cover(&bytes, &hash, cover_id)?;
    // Made now, so the library's card has it the moment the picker closes.
    let _ = storage::cover_thumbnail(&cover, &hash);
    Ok(cover)
  })
  .await
  .map_err(|e| format!("Cover task failed: {e}"))?
  .map_err(|e| e.to_string())?;
  book.cover_url = Some(saved.to_string_lossy().to_string());
  let db = state.db.guard();
  db.update_cover(&book.id, book.cover_url.clone()).map_err(|e| e.to_string())?;
  Ok(book)
}
