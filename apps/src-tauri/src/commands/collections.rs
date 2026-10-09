//! The reader's own collections, a book's series, and filling series in from
//! the books' own files.
//!
//! Series groups and smart shelves are worked out by the app from the library
//! (`src/library/`); only what the reader decides, and what a book says about
//! itself, is stored.

use super::*;
use crate::db::Collection;

/// What the library sends: the timestamps are set here.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInput {
  pub id: String,
  pub name: String,
  pub book_ids: Vec<String>
}

const MAX_NAME: usize = 80;
const MAX_BOOKS: usize = 10_000;
/// Marks that the books already in the library have been read again by the
/// rules of this version. Books imported after it are read by them at import.
/// Version 1 read each EPUB's series; version 2 also makes every book's title,
/// author and genres again (`metadata::normalize`), since a reader cannot
/// edit them and an older version stored "Title (Author) (z-library.sk, ...)"
/// and "Brown, Pierce" as they came. Version 3 reads a PDF's own title and
/// author (`storage/pdf.rs`), which nothing read before. Version 4 takes
/// the author away from a book whose file wrote its title there.
const SERIES_SCAN_KEY: &str = "series_scan_version";
const SERIES_SCAN_VERSION: &str = "4";

fn clip(value: &str, max: usize) -> String {
  value.trim().chars().take(max).collect::<String>().trim().to_string()
}

#[tauri::command]
pub fn collections_list(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
  let db = state.db.guard();
  db.collections().map_err(|e| e.to_string())
}

/// Creates a collection, or saves a change to one (a rename, a book added).
#[tauri::command]
pub fn collection_save(input: CollectionInput, state: State<'_, AppState>) -> Result<Collection, String> {
  let name = clip(&input.name, MAX_NAME);
  if name.is_empty() {
    return Err("A collection needs a name.".to_string());
  }
  if input.id.trim().is_empty() {
    return Err("A collection needs an id.".to_string());
  }
  // Each book once, in the order first added.
  let mut book_ids: Vec<String> = Vec::new();
  for id in input.book_ids {
    if !id.is_empty() && !book_ids.contains(&id) {
      book_ids.push(id);
    }
  }
  book_ids.truncate(MAX_BOOKS);

  let db = state.db.guard();
  let now = db::now_iso();
  let created_at = db
    .find_collection(&input.id)
    .map_err(|e| e.to_string())?
    .filter(|existing| !existing.created_at.is_empty())
    .map(|existing| existing.created_at)
    .unwrap_or_else(|| now.clone());
  let collection = Collection {
    id: input.id,
    name,
    book_ids,
    created_at,
    updated_at: now,
    deleted_at: None
  };
  db.put_collection(&collection).map_err(|e| e.to_string())?;
  Ok(collection)
}

/// Deletes a collection (not its books). A tombstone until every copy has it.
#[tauri::command]
pub fn collection_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.guard();
  if let Some(mut collection) = db.find_collection(&id).map_err(|e| e.to_string())? {
    let now = db::now_iso();
    collection.updated_at = now.clone();
    collection.deleted_at = Some(now);
    db.put_collection(&collection).map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// The reader's word on a book's series: a name and number, or `""` for "not
/// in a series", or `None` to go back to what the book itself says (and, if it
/// says nothing, to what the app works out from the title).
#[tauri::command]
pub async fn book_set_series(
  book_id: String,
  series: Option<String>,
  series_index: Option<f32>,
  state: State<'_, AppState>
) -> Result<BookRecord, String> {
  let (mut series, mut series_index) = (series.map(|name| clip(&name, MAX_NAME)), series_index);
  if series.is_none() {
    let path = {
      let db = state.db.guard();
      db.find_by_id(&book_id).map_err(|e| e.to_string())?.map(|book| std::path::PathBuf::from(book.local_path))
    };
    if let Some(path) = path.filter(|path| formats::extension_of(path) == "epub") {
      let package = tauri::async_runtime::spawn_blocking(move || storage::epub::package(&path).ok())
        .await
        .map_err(|e| format!("Could not read the book: {e}"))?;
      if let Some(package) = package {
        series = package.series;
        series_index = package.series_index;
      }
    }
  }
  let series_index = match (&series, series_index) {
    (Some(name), Some(index)) if !name.is_empty() && index.is_finite() && (0.0..10_000.0).contains(&index) => Some(index),
    _ => None
  };
  let db = state.db.guard();
  if !db.set_series(&book_id, series.as_deref(), series_index).map_err(|e| e.to_string())? {
    return Err("Book not found".to_string());
  }
  db.find_by_id(&book_id)
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Book not found".to_string())
}

/// What today's rules make of a book already in the library, where that
/// differs from what is stored.
#[derive(Debug, PartialEq)]
struct Reread {
  id: String,
  /// The title, author and genres to store, when any of them changed.
  named: Option<(String, Option<String>, Vec<String>)>,
  /// A series for a book that has none stored.
  series: Option<(String, Option<f32>)>
}

/// `basic` is what the book's file says about itself, for a file that could
/// be read; without it the stored title and author are all there is.
fn reread(book: &BookRecord, basic: Option<&storage::BasicMetadata>) -> Option<Reread> {
  let stored = normalize::identify_stored(&book.title, book.author.as_deref());
  // A title inside the file that is itself a file's name is no better than
  // the stored one, which a lookup may since have put right.
  let own = basic.filter(|basic| basic.title.as_deref().is_some_and(|title| !normalize::is_noisy_title(title)));
  // A PDF's own title is taken only where it is the stored one written
  // properly (with the colon its file's name lost): a title a lookup has
  // since settled is not put back. Its author still fills a gap.
  let pdf = basic.filter(|basic| basic.doubtful).map(|basic| storage::BasicMetadata {
    title: basic.title.clone().filter(|title| normalize::is_same_title(&stored.title, title)),
    authors: basic.authors.clone(),
    doubtful: true,
    ..storage::BasicMetadata::default()
  });
  let own = pdf.as_ref().or(own);
  let identity = match own {
    Some(basic) => normalize::identify(&book.title, basic),
    None => normalize::Identity {
      genres: basic.map(|basic| normalize::clean_subjects(&basic.subjects)).unwrap_or_default(),
      series: basic.and_then(|basic| basic.series.clone()).or(stored.series.clone()),
      series_index: basic.and_then(|basic| basic.series_index).or(stored.series_index),
      ..stored.clone()
    }
  };
  // A book that names no one keeps the author a lookup found for it; a PDF
  // keeps the one it has, whoever its maker's computer says wrote it.
  let author = if pdf.is_some() { stored.author.or(identity.author) } else { identity.author.or(stored.author) };
  let genres = if book.genres.is_empty() { identity.genres } else { book.genres.clone() };
  let named = (identity.title != book.title || author != book.author || genres != book.genres).then_some((identity.title, author, genres));
  let series = if book.series.is_none() {
    identity.series.filter(|name| !name.is_empty()).map(|name| (name, identity.series_index))
  } else {
    None
  };
  (named.is_some() || series.is_some()).then(|| Reread { id: book.id.clone(), named, series })
}

/// Reads every book already in the library again, once: its series, and its
/// title, author and genres by today's rules. Returns how many books changed,
/// so the library knows whether to reload.
#[tauri::command]
pub async fn scan_series(state: State<'_, AppState>) -> Result<usize, String> {
  let books: Vec<BookRecord> = {
    let db = state.db.guard();
    if db.get_setting(SERIES_SCAN_KEY).map_err(|e| e.to_string())?.as_deref() == Some(SERIES_SCAN_VERSION) {
      return Ok(0);
    }
    db.list_books().map_err(|e| e.to_string())?
  };
  // The files are read without holding the database.
  let found = tauri::async_runtime::spawn_blocking(move || {
    books
      .iter()
      .filter_map(|book| {
        let path = std::path::Path::new(&book.local_path);
        let basic = book.available.then(|| storage::extract_basic_metadata(path).ok()).flatten();
        // Nothing is read from a PDF, a comic or a missing file.
        let basic = basic.filter(|basic| basic.title.is_some() || !basic.authors.is_empty() || basic.series.is_some());
        reread(book, basic.as_ref())
      })
      .collect::<Vec<_>>()
  })
  .await
  .map_err(|e| format!("Series scan failed: {e}"))?;

  let db = state.db.guard();
  for change in &found {
    if let Some((title, author, genres)) = &change.named {
      db.retitle(&change.id, title, author.as_deref(), genres).map_err(|e| e.to_string())?;
    }
    if let Some((series, index)) = &change.series {
      db.fill_series_from_file(&change.id, series, *index).map_err(|e| e.to_string())?;
    }
  }
  db.set_setting(SERIES_SCAN_KEY, SERIES_SCAN_VERSION).map_err(|e| e.to_string())?;
  Ok(found.len())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn stored(title: &str, author: Option<&str>) -> BookRecord {
    BookRecord {
      finished_at: None,
      id: "abc".into(),
      title: title.into(),
      author: author.map(str::to_string),
      genres: Vec::new(),
      cover_url: None,
      local_path: String::new(),
      file_hash: "abc".into(),
      progress: 0.0,
      position: None,
      series: None,
      series_index: None,
      last_opened: None,
      created_at: String::new(),
      metadata_checked_at: None,
      metadata_updated_at: None,
      progress_updated_at: None,
      deleted_at: None,
      available: true
    }
  }

  fn says(title: Option<&str>, authors: &[&str], subjects: &[&str]) -> storage::BasicMetadata {
    storage::BasicMetadata {
      title: title.map(str::to_string),
      authors: authors.iter().map(|author| author.to_string()).collect(),
      subjects: subjects.iter().map(|subject| subject.to_string()).collect(),
      ..storage::BasicMetadata::default()
    }
  }

  /// What an older version stored is made again; a book already right is left alone.
  #[test]
  fn books_already_in_the_library_are_named_again_by_the_rules_of_today() {
    // A PDF: only its stored title, which was its file's name.
    let pdf = stored("Night Ferry (Mara Ellison) (z-library.sk, 1lib.sk, z-lib.sk)", None);
    assert_eq!(
      reread(&pdf, None),
      Some(Reread { id: "abc".into(), named: Some(("Night Ferry".into(), Some("Mara Ellison".into()), vec![])), series: None })
    );

    // An EPUB whose own title was a catalogue's file name.
    let epub = stored("Ellison, Mara - Saltmarsh 02 - Night Ferry 02", Some("Ellison, Mara"));
    let inside = says(Some("Ellison, Mara - Saltmarsh 02 - Night Ferry 02"), &["Ellison, Mara"], &["FIC055000 Fiction / Dystopian"]);
    assert_eq!(
      reread(&epub, Some(&inside)),
      Some(Reread {
        id: "abc".into(),
        named: Some(("Night Ferry".into(), Some("Mara Ellison".into()), vec!["Fiction".into(), "Dystopian".into()])),
        series: Some(("Saltmarsh".into(), Some(2.0)))
      })
    );

    // Right already, with nothing new to say: untouched.
    assert_eq!(reread(&stored("Night Ferry", Some("Mara Ellison")), Some(&says(Some("Night Ferry"), &["Mara Ellison"], &[]))), None);
    assert_eq!(reread(&stored("Night Ferry", Some("Mara Ellison")), None), None);

    // A file that wrote its title where the author goes: the book names no one.
    let titled_twice = stored("Night Ferry", Some("Night Ferry"));
    assert_eq!(
      reread(&titled_twice, Some(&says(Some("Night Ferry"), &["Night Ferry"], &[]))),
      Some(Reread { id: "abc".into(), named: Some(("Night Ferry".into(), None, vec![])), series: None })
    );

    // Genres the book already has stay; a series the reader set stays.
    let mut kept = stored("Night Ferry", Some("Mara Ellison"));
    kept.genres = vec!["Sea stories".into()];
    kept.series = Some(String::new());
    let mut inside = says(Some("Night Ferry"), &["Mara Ellison"], &["Fiction"]);
    inside.series = Some("Saltmarsh".into());
    assert_eq!(reread(&kept, Some(&inside)), None);

    // A PDF: its own title where that is the stored one written properly.
    let says_pdf = |title: Option<&str>, author: Option<&str>| storage::BasicMetadata { doubtful: true, ..says(title, &author.into_iter().collect::<Vec<_>>(), &[]) };
    let pdf = stored("The Tide Table A New Way to Understand Why Harbours Rise and Fall", Some("Mara Ellison"));
    let inside = says_pdf(Some("The Tide Table: A New Way to Understand Why Harbours Rise and Fall (2006)"), Some("Tobias Wren"));
    assert_eq!(
      reread(&pdf, Some(&inside)),
      Some(Reread {
        id: "abc".into(),
        named: Some(("The Tide Table: A New Way to Understand Why Harbours Rise and Fall".into(), Some("Mara Ellison".into()), vec![])),
        series: None
      })
    );
    // A title a lookup settled since, or the maker's own, is not put in its
    // place; an author still fills a gap, if it is a person.
    let settled = stored("The Tide Table", None);
    assert_eq!(reread(&settled, Some(&says_pdf(Some("Tide Table, The: Harbours"), Some("Administrator")))), None);
    assert_eq!(reread(&settled, Some(&says_pdf(Some("Microsoft Word - tides.doc"), None))), None);
    assert_eq!(
      reread(&settled, Some(&says_pdf(Some("Chapter 1"), Some("Ellison, Mara")))),
      Some(Reread { id: "abc".into(), named: Some(("The Tide Table".into(), Some("Mara Ellison".into()), vec![])), series: None })
    );

    // A lookup once named a book whose own metadata is a file's name or
    // names no one: its answer is kept.
    let found = stored("The Night Ferry", Some("Mara Ellison"));
    assert_eq!(reread(&found, Some(&says(Some("night_ferry_final.epub"), &[], &[]))), None);
    assert_eq!(reread(&found, Some(&says(Some("The Night Ferry"), &["Unknown"], &[]))), None);
  }
}
