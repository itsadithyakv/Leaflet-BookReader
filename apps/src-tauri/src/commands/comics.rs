//! Comic books: pages served one at a time.

use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicInfo {
  pub page_count: usize
}

/// Indexes a comic archive and caches its page order until `comic_close`.
///
/// The archive work runs off the main thread: listing a large CBZ/CBR would
/// otherwise freeze the window while the reader opens.
#[tauri::command]
pub async fn comic_open(book_id: String, state: State<'_, AppState>) -> Result<ComicInfo, String> {
  let book = {
    let db = state.db.guard();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };

  let pages = tauri::async_runtime::spawn_blocking(move || {
    comic::list_pages(std::path::Path::new(&book.local_path))
      .map_err(|error| format!("Leaflet could not read this comic: {error}"))
  })
  .await
  .map_err(|error| format!("Comic task failed: {error}"))??;
  let page_count = pages.len();
  let mut open = state.comic_pages.guard();
  let entry = open
    .entry(book_id)
    .or_insert_with(|| OpenComic { pages: Vec::new(), readers: 0 });
  // Freshly listed, so a file replaced since the last open is paged correctly.
  entry.pages = pages;
  entry.readers += 1;
  Ok(ComicInfo { page_count })
}

/// Releases one reader's hold on a comic's page index; the index is dropped
/// with the last one, so closed comics do not accumulate for the session.
#[tauri::command]
pub fn comic_close(book_id: String, state: State<'_, AppState>) {
  let mut open = state.comic_pages.guard();
  if let Some(entry) = open.get_mut(&book_id) {
    entry.readers = entry.readers.saturating_sub(1);
    if entry.readers == 0 {
      open.remove(&book_id);
    }
  }
}

/// One page as a data URL. Pages are served individually because a comic is far
/// too large to hand to the webview in one piece.
/// Async for the same reason as `comic_open`: every page turn decompresses an
/// image, which must not block the main thread.
#[tauri::command]
pub async fn comic_page(
  book_id: String,
  index: usize,
  state: State<'_, AppState>
) -> Result<String, String> {
  let entry = {
    let cache = state.comic_pages.guard();
    let comic = cache
      .get(&book_id)
      .ok_or_else(|| "This comic is not open.".to_string())?;
    comic
      .pages
      .get(index)
      .cloned()
      .ok_or_else(|| format!("This comic has no page {}.", index + 1))?
  };

  let book = {
    let db = state.db.guard();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };

  tauri::async_runtime::spawn_blocking(move || {
    let bytes = comic::read_page(std::path::Path::new(&book.local_path), &entry)
      .map_err(|error| format!("Leaflet could not read page {}: {error}", index + 1))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{}", comic::mime_for(&entry), encoded))
  })
  .await
  .map_err(|error| format!("Comic task failed: {error}"))?
}
