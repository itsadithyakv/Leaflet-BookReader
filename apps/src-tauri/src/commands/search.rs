use super::*;
use crate::search;
use tauri::ipc::Channel;

/// Looks for the words inside every book (`crate::search`). Each book is told
/// of down `on_progress` as it is finished, so the results show as they are
/// found; the answer is all of them, the book with the most matches first.
///
/// Async and off-thread: it reads every book in the library. The database is
/// held only long enough to list them.
#[tauri::command]
pub async fn library_search(
  query: String,
  on_progress: Channel<search::Progress>,
  state: State<'_, AppState>
) -> Result<search::Summary, String> {
  // Before anything else: a newer search stops an older one, even when the
  // newer one turns out to have nothing to look for.
  let turn = search::begin();
  let Some(needle) = search::Needle::new(&query) else {
    return Ok(search::Summary::default());
  };
  let mut books = {
    let db = state.db.guard();
    db.list_books().map_err(|e| e.to_string())?
  };
  // The books read most lately first: theirs are the results most likely wanted.
  books.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
  tauri::async_runtime::spawn_blocking(move || {
    let shelf: Vec<search::Shelved> = books
      .into_iter()
      .map(|book| {
        let converted = storage::converted_epub_path(&book.file_hash).ok();
        let epub = search::epub_of(std::path::Path::new(&book.local_path), converted.as_deref());
        search::Shelved { id: book.id, epub }
      })
      .collect();
    search::search_library(&shelf, &needle, &|| !search::is_latest(turn), |progress| {
      // The dialog may have shut: nobody is listening, and that is fine.
      let _ = on_progress.send(progress);
    })
  })
  .await
  .map_err(|error| format!("Search task failed: {error}"))
}

/// Stops the search that is running: its dialog was shut, or the words were
/// cleared.
#[tauri::command]
pub fn library_search_cancel() {
  search::call_off();
}
