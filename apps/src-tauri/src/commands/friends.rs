//! What readers who follow each other share beyond the board: a library,
//! finished-book posts and the feed, books in common, book clubs, follow
//! requests and gifts.

use super::*;
use sha2::{Digest, Sha256};

// ---- friends ---------------------------------------------------------------
//
// Like the community commands next door, each passes the server's JSON
// through (shapes live in `friendsService.ts`). Two things are added here
// because only the device knows them: which of another reader's books are in
// this library too, and which of this library's books the readers followed
// have. Both go by `book_key`, made here so that every device makes the same
// one from the same title and author.

/// Set ("1") while the reader shares their library with the readers who
/// follow them. The server holds the same switch (`sharesLibrary`); this copy
/// is what lets a publish know, without asking, whether to send the list.
pub(crate) const SHARE_LIBRARY_SETTING: &str = "social_share_library";
/// A fingerprint of the library as it was last sent, so that the list (which
/// can run to thousands of books) goes up only when it has changed.
pub(crate) const LIBRARY_SENT_SETTING: &str = "social_library_sent";
/// The most books a shared library holds: the server's limit.
pub(crate) const LIBRARY_MAX: usize = 3000;
/// The most of this library's books asked about at once: the server's limit.
pub(crate) const AMONG_MAX: usize = 500;
/// A book counts as being read now if it was opened this recently.
pub(crate) const READING_NOW_DAYS: i64 = 30;

/// Letters and digits in lower case, words one space apart.
fn plain(text: &str) -> String {
  let cleaned: String = text
    .chars()
    .map(|c| if c.is_alphanumeric() { c.to_lowercase().next().unwrap_or(c) } else { ' ' })
    .collect();
  cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// What two libraries match a book by: its title without the subtitle or a
/// leading article, and the first author's surname. "The Hobbit" by
/// "Tolkien, J.R.R." and "Hobbit: or There and Back Again" by "J. R. R.
/// Tolkien" are one book; so are an EPUB and a PDF of it. Two books that
/// differ only in subtitle are one too, which for "who else has this" is the
/// better mistake.
pub(crate) fn book_key(title: &str, author: Option<&str>) -> String {
  let main = title.split([':', '(', '[']).next().unwrap_or(title);
  let mut words = plain(main);
  for article in ["the ", "a ", "an "] {
    if let Some(rest) = words.strip_prefix(article) {
      if !rest.is_empty() {
        words = rest.to_string();
      }
      break;
    }
  }
  let first = author
    .unwrap_or("")
    .split([';', '&'])
    .next()
    .unwrap_or("")
    .split(" and ")
    .next()
    .unwrap_or("");
  // "Tolkien, J.R.R." names the surname first; "J.R.R. Tolkien" last.
  let surname = match first.split_once(',') {
    Some((before, _)) => plain(before),
    None => plain(first).split(' ').next_back().unwrap_or("").to_string()
  };
  format!("{words}|{surname}")
}

/// One book as a shared library lists it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedBook {
  pub key: String,
  pub title: String,
  pub author: Option<String>,
  /// `reading`, `finished` or `unread`.
  pub state: &'static str,
  pub percent: i64
}

fn state_of(book: &BookRecord) -> &'static str {
  if has_finished(book) {
    "finished"
  } else if book.progress > 0.0 {
    "reading"
  } else {
    "unread"
  }
}

fn percent_of(book: &BookRecord) -> i64 {
  ((book.progress.clamp(0.0, 1.0) * 100.0).round() as i64).clamp(0, 100)
}

/// The library as it is shared: one entry a book (two copies of one book are
/// one, the one read furthest), titles and authors and how far along, never
/// a path, a hash or a file. In a fixed order, so the same library always
/// makes the same list.
pub(crate) fn shared_library(books: &[BookRecord]) -> Vec<SharedBook> {
  let rank = |state: &str| match state {
    "finished" => 2,
    "reading" => 1,
    _ => 0
  };
  let mut by_key: std::collections::BTreeMap<String, SharedBook> = std::collections::BTreeMap::new();
  for book in books {
    let title = book.title.trim();
    if title.is_empty() {
      continue;
    }
    let entry = SharedBook {
      key: book_key(title, book.author.as_deref()),
      title: title.chars().take(160).collect(),
      author: book.author.as_deref().map(str::trim).filter(|author| !author.is_empty()).map(|author| author.chars().take(80).collect()),
      state: state_of(book),
      percent: percent_of(book)
    };
    // A key with nothing before the bar is a title of punctuation alone.
    if entry.key.starts_with('|') {
      continue;
    }
    let further = by_key
      .get(&entry.key)
      .is_none_or(|kept| (rank(entry.state), entry.percent) > (rank(kept.state), kept.percent));
    if further {
      by_key.insert(entry.key.clone(), entry);
    }
  }
  by_key.into_values().take(LIBRARY_MAX).collect()
}

/// The book the reader has open: the one opened last that is begun and not
/// finished, if that was within `READING_NOW_DAYS` of `now`.
pub(crate) fn reading_now(books: &[BookRecord], now: chrono::DateTime<chrono::Utc>) -> Option<serde_json::Value> {
  let opened = |book: &BookRecord| {
    book
      .last_opened
      .as_deref()
      .and_then(|stamp| chrono::DateTime::parse_from_rfc3339(stamp).ok())
      .map(|at| at.with_timezone(&chrono::Utc))
  };
  books
    .iter()
    .filter(|book| state_of(book) == "reading" && !book.title.trim().is_empty())
    .filter_map(|book| opened(book).map(|at| (at, book)))
    .filter(|(at, _)| (now - *at).num_days() < READING_NOW_DAYS)
    .max_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.id.cmp(&a.1.id)))
    .map(|(_, book)| {
      serde_json::json!({
        "title": book.title.trim().chars().take(120).collect::<String>(),
        "author": book.author.as_deref().map(str::trim).filter(|author| !author.is_empty()).map(|author| author.chars().take(80).collect::<String>()),
        "percent": percent_of(book)
      })
    })
}

pub(crate) fn shares_library(db: &db::Database) -> bool {
  db.get_setting(SHARE_LIBRARY_SETTING).ok().flatten().as_deref() == Some("1")
}

/// Remembers whether the library is shared, as the server (or the reader, a
/// moment ago) says. Turning it off forgets what was sent, so turning it on
/// again sends the list afresh.
pub(crate) fn remember_share_library(db: &db::Database, on: bool) {
  let _ = db.set_setting(SHARE_LIBRARY_SETTING, if on { "1" } else { "" });
  if !on {
    let _ = db.set_setting(LIBRARY_SENT_SETTING, "");
  }
}

/// Sends the library to the server if it is shared and has changed since it
/// was last sent. Quiet when there is nothing to do. Called after the
/// profile's own figures are published, which is at most once a minute.
pub(crate) async fn publish_library(state: &State<'_, AppState>) -> Result<(), String> {
  let (books, sent) = {
    let db = state.db.guard();
    if !shares_library(&db) {
      return Ok(());
    }
    (
      shared_library(&db.list_books().map_err(|e| e.to_string())?),
      db.get_setting(LIBRARY_SENT_SETTING).ok().flatten().unwrap_or_default()
    )
  };
  let body = serde_json::json!({ "books": books });
  let print = format!("{:x}", Sha256::digest(body.to_string().as_bytes()));
  if print == sent {
    return Ok(());
  }
  community(state, Method::PUT, "/v1/library/me".into(), vec![], Some(body), CommunityAuth::Required).await?;
  let db = state.db.guard();
  db.set_setting(LIBRARY_SENT_SETTING, &print).map_err(|e| e.to_string())
}

/// Takes the library off the server (the reader stopped sharing it).
pub(crate) async fn withdraw_library(state: &State<'_, AppState>) -> Result<(), String> {
  community(state, Method::DELETE, "/v1/library/me".into(), vec![], None, CommunityAuth::Required).await?;
  Ok(())
}

/// An id as the server makes them: 24 hex digits. Checked before it goes
/// into a path.
fn hex_id(id: &str, what: &str) -> Result<String, String> {
  if id.len() == 24 && id.chars().all(|c| c.is_ascii_hexdigit()) {
    Ok(id.to_ascii_lowercase())
  } else {
    Err(format!("No such {what}."))
  }
}

fn this_week() -> String {
  iso_week_key(&local_today())
}

/// Readers waiting for an answer from a profile kept to followers.
#[tauri::command]
pub async fn community_follow_requests(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  community(&state, Method::GET, "/v1/follow-requests".into(), vec![], None, CommunityAuth::Required).await
}

#[tauri::command]
pub async fn community_answer_request(handle: String, accept: bool, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let action = if accept { "accept" } else { "decline" };
  community(
    &state,
    Method::POST,
    format!("/v1/follow-requests/{}/{action}", cloud::handle_segment(&handle)),
    vec![],
    None,
    CommunityAuth::Required
  )
  .await
}

/// A reader's shared library, each book marked with whether this library has
/// it too.
#[tauri::command]
pub async fn community_reader_library(handle: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let mut answer = community(
    &state,
    Method::GET,
    format!("/v1/profile/{}/library", cloud::handle_segment(&handle)),
    vec![],
    None,
    CommunityAuth::Required
  )
  .await?;
  let mine: std::collections::HashSet<String> = {
    let db = state.db.guard();
    shared_library(&db.list_books().map_err(|e| e.to_string())?)
      .into_iter()
      .map(|book| book.key)
      .collect()
  };
  mark_in_yours(&mut answer, &mine);
  Ok(answer)
}

/// Adds `inYours` to each of a library's books.
pub(crate) fn mark_in_yours(answer: &mut serde_json::Value, mine: &std::collections::HashSet<String>) {
  let Some(books) = answer.get_mut("books").and_then(|books| books.as_array_mut()) else {
    return;
  };
  for book in books {
    let has = book.get("key").and_then(|key| key.as_str()).is_some_and(|key| mine.contains(key));
    if let Some(fields) = book.as_object_mut() {
      fields.insert("inYours".to_string(), serde_json::Value::Bool(has));
    }
  }
}

#[tauri::command]
pub async fn community_reader_posts(handle: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  community(
    &state,
    Method::GET,
    format!("/v1/profile/{}/posts", cloud::handle_segment(&handle)),
    vec![],
    None,
    CommunityAuth::Optional
  )
  .await
}

/// Finished books from the reader and the readers they follow; `before` (an
/// ISO date, the last post's) asks for the page after.
#[tauri::command]
pub async fn community_feed(before: Option<String>, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let query = before.filter(|value| !value.is_empty()).map(|value| vec![("before", value)]).unwrap_or_default();
  community(&state, Method::GET, "/v1/feed".into(), query, None, CommunityAuth::Required).await
}

#[tauri::command]
pub async fn community_post(
  title: String,
  author: Option<String>,
  rating: Option<i64>,
  line: Option<String>,
  state: State<'_, AppState>
) -> Result<serde_json::Value, String> {
  let body = serde_json::json!({
    "title": title.trim(),
    "author": author.as_deref().map(str::trim).filter(|value| !value.is_empty()),
    "rating": rating.filter(|stars| (1..=5).contains(stars)),
    "line": line.as_deref().map(str::trim).filter(|value| !value.is_empty())
  });
  community(&state, Method::POST, "/v1/posts".into(), vec![], Some(body), CommunityAuth::Required).await
}

#[tauri::command]
pub async fn community_delete_post(id: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let id = hex_id(&id, "post")?;
  community(&state, Method::DELETE, format!("/v1/posts/{id}"), vec![], None, CommunityAuth::Required).await
}

/// The books to ask the server about, at most `AMONG_MAX`: the ones being
/// read first (two friends on one book), then the unread (who has finished
/// what is waiting on the shelf), then the finished.
pub(crate) fn books_to_ask(books: &[BookRecord]) -> Vec<(String, String, String)> {
  let order = |state: &str| match state {
    "reading" => 0,
    "unread" => 1,
    _ => 2
  };
  let mut seen = std::collections::HashSet::new();
  let mut asked: Vec<(i32, String, String, String)> = books
    .iter()
    .filter(|book| !book.title.trim().is_empty())
    .map(|book| (order(state_of(book)), book_key(&book.title, book.author.as_deref()), book.id.clone(), book.title.trim().to_string()))
    .filter(|(_, key, _, _)| !key.starts_with('|'))
    .collect();
  asked.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)).then_with(|| a.2.cmp(&b.2)));
  asked
    .into_iter()
    .filter(|(_, key, _, _)| seen.insert(key.clone()))
    .take(AMONG_MAX)
    .map(|(_, key, id, title)| (key, id, title))
    .collect()
}

/// This library's books that the readers followed have: for each, how many
/// finished it and who is reading it now, with the book's id here.
#[tauri::command]
pub async fn community_friends_books(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let asked = {
    let db = state.db.guard();
    books_to_ask(&db.list_books().map_err(|e| e.to_string())?)
  };
  if asked.is_empty() {
    return Ok(serde_json::json!({ "books": [] }));
  }
  let keys: Vec<&str> = asked.iter().map(|(key, _, _)| key.as_str()).collect();
  let mut answer = community(
    &state,
    Method::POST,
    "/v1/library/among".into(),
    vec![],
    Some(serde_json::json!({ "keys": keys })),
    CommunityAuth::Required
  )
  .await?;
  name_books(&mut answer, &asked);
  Ok(answer)
}

/// Adds `bookId` and `title` (this library's) to each book of an "among"
/// answer, and drops any the library does not have.
pub(crate) fn name_books(answer: &mut serde_json::Value, asked: &[(String, String, String)]) {
  let by_key: std::collections::HashMap<&str, (&str, &str)> =
    asked.iter().map(|(key, id, title)| (key.as_str(), (id.as_str(), title.as_str()))).collect();
  let Some(books) = answer.get_mut("books").and_then(|books| books.as_array_mut()) else {
    return;
  };
  books.retain_mut(|book| {
    let found = book.get("key").and_then(|key| key.as_str()).and_then(|key| by_key.get(key).copied());
    match (found, book.as_object_mut()) {
      (Some((id, title)), Some(fields)) => {
        fields.insert("bookId".to_string(), serde_json::Value::String(id.to_string()));
        fields.insert("title".to_string(), serde_json::Value::String(title.to_string()));
        true
      }
      _ => false
    }
  });
}

#[tauri::command]
pub async fn community_clubs(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  community(&state, Method::GET, "/v1/clubs".into(), vec![("week", this_week())], None, CommunityAuth::Required).await
}

#[tauri::command]
pub async fn community_club_create(name: String, goal_minutes: i64, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let body = serde_json::json!({ "name": name.trim(), "goalMinutes": goal_minutes.clamp(0, 10_080) });
  community(&state, Method::POST, "/v1/clubs".into(), vec![("week", this_week())], Some(body), CommunityAuth::Required).await
}

#[tauri::command]
pub async fn community_club_join(code: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let code: String = code.trim().to_ascii_uppercase().chars().filter(|c| c.is_ascii_alphanumeric()).take(12).collect();
  if code.is_empty() {
    return Err("Type the club's code.".to_string());
  }
  let body = serde_json::json!({ "code": code });
  community(&state, Method::POST, "/v1/clubs/join".into(), vec![("week", this_week())], Some(body), CommunityAuth::Required).await
}

#[tauri::command]
pub async fn community_club_leave(id: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let id = hex_id(&id, "club")?;
  community(&state, Method::POST, format!("/v1/clubs/{id}/leave"), vec![], None, CommunityAuth::Required).await
}

/// The owner's changes. A field left out is left as it is.
#[tauri::command]
pub async fn community_club_update(
  id: String,
  name: Option<String>,
  goal_minutes: Option<i64>,
  state: State<'_, AppState>
) -> Result<serde_json::Value, String> {
  let id = hex_id(&id, "club")?;
  let mut body = serde_json::Map::new();
  if let Some(name) = name.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
    body.insert("name".to_string(), serde_json::Value::String(name.to_string()));
  }
  if let Some(minutes) = goal_minutes {
    body.insert("goalMinutes".to_string(), serde_json::json!(minutes.clamp(0, 10_080)));
  }
  community(
    &state,
    Method::PUT,
    format!("/v1/clubs/{id}"),
    vec![("week", this_week())],
    Some(serde_json::Value::Object(body)),
    CommunityAuth::Required
  )
  .await
}

#[tauri::command]
pub async fn community_club_add_book(
  id: String,
  title: String,
  author: Option<String>,
  state: State<'_, AppState>
) -> Result<serde_json::Value, String> {
  let id = hex_id(&id, "club")?;
  let body = serde_json::json!({
    "title": title.trim(),
    "author": author.as_deref().map(str::trim).filter(|value| !value.is_empty())
  });
  community(
    &state,
    Method::POST,
    format!("/v1/clubs/{id}/books"),
    vec![("week", this_week())],
    Some(body),
    CommunityAuth::Required
  )
  .await
}

/// Gifts waiting to be unwrapped.
#[tauri::command]
pub async fn community_gifts(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  community(&state, Method::GET, "/v1/gifts".into(), vec![], None, CommunityAuth::Required).await
}

/// Tells the server a thing is on its way to a friend. The seeds are this
/// device's affair (`pip_send_gift`): the server only carries the news.
#[tauri::command]
pub async fn community_gift_send(to: String, kind: String, item_id: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let body = serde_json::json!({
    "to": to.trim().trim_start_matches('@').to_lowercase(),
    "kind": kind,
    "itemId": item_id
  });
  community(&state, Method::POST, "/v1/gifts".into(), vec![], Some(body), CommunityAuth::Required).await
}

#[tauri::command]
pub async fn community_gift_claim(id: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let id = hex_id(&id, "gift")?;
  community(&state, Method::POST, format!("/v1/gifts/{id}/claim"), vec![], None, CommunityAuth::Required).await
}

#[cfg(test)]
mod tests {
  use super::*;

  fn book(id: &str, title: &str, author: Option<&str>, progress: f32, opened: Option<&str>) -> BookRecord {
    BookRecord {
      id: id.to_string(),
      title: title.to_string(),
      author: author.map(str::to_string),
      genres: Vec::new(),
      cover_url: None,
      local_path: format!("C:\\Users\\someone\\books\\{id}.epub"),
      file_hash: format!("hash-{id}"),
      progress,
      position: None,
      series: None,
      series_index: None,
      last_opened: opened.map(str::to_string),
      created_at: "2026-01-01T00:00:00+00:00".to_string(),
      metadata_checked_at: None,
      metadata_updated_at: None,
      progress_updated_at: None,
      finished_at: None,
      deleted_at: None,
      available: true
    }
  }

  /// Two readers' copies of one book have one key, however each file spells it.
  #[test]
  fn one_book_has_one_key_however_it_is_written() {
    let key = book_key("The Hobbit", Some("J.R.R. Tolkien"));
    assert_eq!(key, "hobbit|tolkien");
    assert_eq!(book_key("Hobbit: or There and Back Again", Some("Tolkien, J. R. R.")), key);
    assert_eq!(book_key("  THE HOBBIT (Illustrated Edition) ", Some("J. R. R. Tolkien; Alan Lee")), key);
    assert_eq!(book_key("The Hobbit", Some("J.R.R. Tolkien & Christopher Tolkien")), key);
    // The reported pair: a subtitle in one file's title and not the other's.
    assert_eq!(
      book_key("India that is Bharat: Coloniality, Civilisation, Constitution", Some("J Sai Deepak")),
      book_key("India That Is Bharat", Some("J. Sai Deepak"))
    );
    // Different books stay apart, and a book with no author is still a book.
    assert_ne!(book_key("Dune", Some("Frank Herbert")), book_key("Dune Messiah", Some("Frank Herbert")));
    assert_eq!(book_key("Beowulf", None), "beowulf|");
    // A title that is only an article is kept whole.
    assert_eq!(book_key("A", Some("Andy Warhol")), "a|warhol");
  }

  /// What leaves the device is titles, authors and how far along: nothing
  /// that says where a file is or what it is.
  #[test]
  fn a_shared_library_is_titles_and_places_and_nothing_else() {
    let books = [
      book("b1", "Dune", Some("Frank Herbert"), 0.34, None),
      book("b2", "Emma", Some("Jane Austen"), 1.0, None),
      book("b3", "Ulysses", None, 0.0, None),
      // The same book twice (an EPUB and a PDF): one entry, the one read furthest.
      book("b4", "Dune: Deluxe Edition", Some("Herbert, Frank"), 0.6, None),
      book("b5", "  ", Some("Nobody"), 0.5, None),
      book("b6", "!!!", None, 0.5, None)
    ];
    let shared = shared_library(&books);
    let listed: Vec<(&str, &str, i64)> = shared.iter().map(|book| (book.title.as_str(), book.state, book.percent)).collect();
    assert_eq!(listed, vec![("Dune: Deluxe Edition", "reading", 60), ("Emma", "finished", 100), ("Ulysses", "unread", 0)]);
    let sent = serde_json::to_string(&shared).expect("json");
    for private in ["someone", "hash-", ".epub", "localPath", "fileHash", "b1"] {
      assert!(!sent.contains(private), "{private} is in what is sent");
    }
    // The same library always makes the same list, whatever order it is read in.
    let mut turned = books.to_vec();
    turned.reverse();
    assert_eq!(shared_library(&turned), shared);
  }

  #[test]
  fn the_book_being_read_is_the_one_opened_last_and_lately() {
    let now = chrono::DateTime::parse_from_rfc3339("2026-10-11T12:00:00+00:00").expect("now").with_timezone(&chrono::Utc);
    let books = [
      book("old", "Middlemarch", Some("George Eliot"), 0.2, Some("2026-10-01T10:00:00+00:00")),
      book("new", "Dune", Some("Frank Herbert"), 0.336, Some("2026-10-10T21:00:00+05:30")),
      book("done", "Emma", Some("Jane Austen"), 1.0, Some("2026-10-11T09:00:00+00:00")),
      book("unread", "Ulysses", None, 0.0, Some("2026-10-11T10:00:00+00:00"))
    ];
    let reading = reading_now(&books, now).expect("reading");
    assert_eq!(reading, serde_json::json!({ "title": "Dune", "author": "Frank Herbert", "percent": 34 }));
    // Left for a month, a book is no longer "reading now"; nor is one never opened.
    let stale = [book("old", "Middlemarch", None, 0.2, Some("2026-08-01T10:00:00+00:00")), book("never", "Dune", None, 0.5, None)];
    assert!(reading_now(&stale, now).is_none());
  }

  #[test]
  fn the_books_asked_about_start_with_the_ones_being_read() {
    let books = [
      book("f", "Emma", Some("Jane Austen"), 1.0, None),
      book("u", "Ulysses", Some("James Joyce"), 0.0, None),
      book("r", "Dune", Some("Frank Herbert"), 0.4, None),
      book("r2", "Dune (PDF)", Some("Frank Herbert"), 0.1, None)
    ];
    let asked = books_to_ask(&books);
    let keys: Vec<&str> = asked.iter().map(|(key, _, _)| key.as_str()).collect();
    assert_eq!(keys, vec!["dune|herbert", "ulysses|joyce", "emma|austen"]);
    // The answer comes back by key and leaves by this library's own id and title.
    let mut answer = serde_json::json!({ "books": [
      { "key": "dune|herbert", "finished": 2, "readers": [] },
      { "key": "not-asked|nobody", "finished": 9, "readers": [] }
    ] });
    name_books(&mut answer, &asked);
    assert_eq!(answer["books"].as_array().expect("books").len(), 1);
    assert_eq!(answer["books"][0]["bookId"], "r");
    assert_eq!(answer["books"][0]["title"], "Dune");
    assert_eq!(answer["books"][0]["finished"], 2);
  }

  #[test]
  fn another_readers_books_are_marked_where_this_library_has_them() {
    let mine: std::collections::HashSet<String> = ["dune|herbert".to_string()].into_iter().collect();
    let mut answer = serde_json::json!({ "books": [{ "key": "dune|herbert", "title": "Dune" }, { "key": "emma|austen", "title": "Emma" }], "updatedAt": null });
    mark_in_yours(&mut answer, &mine);
    assert_eq!(answer["books"][0]["inYours"], true);
    assert_eq!(answer["books"][1]["inYours"], false);
    // An answer with no list is left as it is.
    let mut odd = serde_json::json!({ "error": "x" });
    mark_in_yours(&mut odd, &mine);
    assert_eq!(odd, serde_json::json!({ "error": "x" }));
  }

  #[test]
  fn an_id_is_checked_before_it_goes_into_a_path() {
    assert_eq!(hex_id("0123456789ABCDEF01234567", "post").as_deref(), Ok("0123456789abcdef01234567"));
    assert!(hex_id("../../v1/account", "post").is_err());
    assert!(hex_id("0123", "club").is_err());
  }

  /// Sharing is off until chosen, and turning it off forgets what was sent.
  #[test]
  fn sharing_the_library_is_off_until_chosen() {
    let db = crate::db::tests::memory_db();
    assert!(!shares_library(&db));
    remember_share_library(&db, true);
    assert!(shares_library(&db));
    db.set_setting(LIBRARY_SENT_SETTING, "abc").expect("sent");
    remember_share_library(&db, false);
    assert!(!shares_library(&db));
    assert_eq!(db.get_setting(LIBRARY_SENT_SETTING).expect("setting").as_deref(), Some(""));
  }
}
