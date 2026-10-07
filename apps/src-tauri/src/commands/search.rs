use super::*;
use crate::pdf_text;
use crate::search;
use tauri::ipc::Channel;

/// Looks for the words inside every book (`crate::search`). Each book is told
/// of down `on_progress` as it is finished, so the results show as they are
/// found; the answer is all of them, the book with the most matches first.
///
/// `only` names the books to go through, by id, when it is not all of them:
/// the page asks again for a PDF whose text it has just read and kept.
///
/// Async and off-thread: it reads every book in the library. The database is
/// held only long enough to list them.
#[tauri::command]
pub async fn library_search(
  query: String,
  only: Option<Vec<String>>,
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
  if let Some(only) = &only {
    books.retain(|book| only.contains(&book.id));
  }
  tauri::async_runtime::spawn_blocking(move || {
    let shelf: Vec<search::Shelved> = books
      .into_iter()
      .map(|book| {
        let path = std::path::Path::new(&book.local_path);
        let converted = storage::converted_epub_path(&book.file_hash).ok();
        let epub = search::epub_of(path, converted.as_deref());
        // A PDF that is here to be read: one that is not could never have its text read.
        let pdf = (epub.is_none() && search::is_pdf(path) && path.is_file()).then(|| pdf_text::path_of(&book.file_hash)).flatten();
        search::Shelved { id: book.id, epub, pdf }
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

/// The hash of the book with this id, if it is a PDF: the name its text is
/// kept under.
fn pdf_hash(book_id: &str, state: &State<'_, AppState>) -> Result<String, String> {
  let db = state.db.guard();
  let book = db.find_by_id(book_id).map_err(|e| e.to_string())?.ok_or_else(|| "Book not found".to_string())?;
  if !search::is_pdf(std::path::Path::new(&book.local_path)) {
    return Err("Only a PDF's text is kept.".to_string());
  }
  Ok(book.file_hash)
}

/// Whether a PDF's text is kept already (`crate::pdf_text`), so the page need
/// not hand it over again.
#[tauri::command]
pub async fn pdf_text_has(book_id: String, state: State<'_, AppState>) -> Result<bool, String> {
  let hash = pdf_hash(&book_id, &state)?;
  tauri::async_runtime::spawn_blocking(move || pdf_text::has(&hash))
    .await
    .map_err(|error| format!("Text task failed: {error}"))
}

/// Keeps a PDF's text as the page read it, a string a page, in order, for
/// the library's search. No more is kept than `pdf_text::MAX_PAGES` pages and
/// `pdf_text::MAX_CHARS` characters, whatever is handed over.
#[tauri::command]
pub async fn pdf_text_save(book_id: String, pages: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
  let hash = pdf_hash(&book_id, &state)?;
  tauri::async_runtime::spawn_blocking(move || pdf_text::save(&hash, &pages).map_err(|e| e.to_string()))
    .await
    .map_err(|error| format!("Text task failed: {error}"))?
}
