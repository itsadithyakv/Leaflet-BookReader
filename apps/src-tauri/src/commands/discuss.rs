//! The public, optional half of the community: reviews and quotes, likes,
//! the discover feed, book communities and their threads, reports, blocks,
//! and the owner's moderation.

use super::*;
use super::friends::book_key;

// ---- discuss ---------------------------------------------------------------
//
// One command for all of it (`discuss`), which names a route and hands over
// its arguments. The routes are a fixed list: the webview cannot ask for an
// address that is not written here, every id is checked before it goes into
// a path, and a handle goes through `cloud::handle_segment`. The server's
// JSON is passed through; the shapes live in `discussService.ts`.
//
// What is added here is what only the device knows: the key a post or a
// community names its book by (`book_key`, the same one a shared library
// uses, so a review, a community and a library all mean the same book).

fn text(args: &serde_json::Value, name: &str) -> Option<String> {
  args.get(name).and_then(|value| value.as_str()).map(str::trim).filter(|value| !value.is_empty()).map(str::to_string)
}

fn need(args: &serde_json::Value, name: &str) -> Result<String, String> {
  text(args, name).ok_or_else(|| format!("Missing {name}."))
}

fn hex(args: &serde_json::Value, name: &str, what: &str) -> Result<String, String> {
  let id = need(args, name).map_err(|_| format!("No such {what}."))?;
  if id.len() == 24 && id.chars().all(|c| c.is_ascii_hexdigit()) {
    Ok(id.to_ascii_lowercase())
  } else {
    Err(format!("No such {what}."))
  }
}

/// A book's or a series' key as it goes on the wire: lower case, of a
/// sensible length. A book's is made here from its title and author when the
/// page does not have one; a series' is the library's own (`series.ts`).
fn key_of(args: &serde_json::Value, kind: &str) -> Result<String, String> {
  let given = text(args, "key").map(|key| key.to_lowercase());
  let key = match (given, kind) {
    (Some(key), _) => key,
    (None, "book") => book_key(&need(args, "title")?, text(args, "author").as_deref()),
    _ => return Err("Missing key.".to_string())
  };
  if key.is_empty() || key.starts_with('|') || key.chars().count() > 160 {
    return Err("That book cannot be named.".to_string());
  }
  Ok(key)
}

fn kind_of(args: &serde_json::Value) -> Result<&'static str, String> {
  match args.get("kind").and_then(|value| value.as_str()) {
    Some("book") => Ok("book"),
    Some("series") => Ok("series"),
    _ => Err("A community is for a book or a series.".to_string())
  }
}

/// What a route asks the server: how, where, with what.
pub(crate) struct Ask {
  pub method: Method,
  pub path: String,
  pub query: Vec<(&'static str, String)>,
  pub body: Option<serde_json::Value>
}

impl Ask {
  fn get(path: impl Into<String>) -> Self {
    Ask { method: Method::GET, path: path.into(), query: Vec::new(), body: None }
  }
  fn send(method: Method, path: impl Into<String>, body: Option<serde_json::Value>) -> Self {
    Ask { method, path: path.into(), query: Vec::new(), body }
  }
  fn with(mut self, name: &'static str, value: Option<String>) -> Self {
    if let Some(value) = value {
      self.query.push((name, value));
    }
    self
  }
}

/// The request a route and its arguments come to, or why there is none.
/// Pure: what it builds is tested without a server.
pub(crate) fn ask_for(route: &str, args: &serde_json::Value) -> Result<Ask, String> {
  let number = |name: &str| args.get(name).and_then(|value| value.as_i64());
  let flag = |name: &str| args.get(name).and_then(|value| value.as_bool());
  Ok(match route {
    "rules_accept" => Ask::send(Method::POST, "/v1/rules/accept", None),

    // ---- posts: a finished book, a review, a quote -------------------------
    "post" => {
      let kind = match args.get("kind").and_then(|value| value.as_str()) {
        Some("review") => "review",
        Some("quote") => "quote",
        _ => "finished"
      };
      let title = need(args, "title")?;
      let author = text(args, "author");
      let mut body = serde_json::json!({
        "kind": kind,
        "title": title,
        "author": author,
        "bookKey": book_key(&title, author.as_deref()),
        "audience": if args.get("audience").and_then(|value| value.as_str()) == Some("everyone") { "everyone" } else { "followers" },
        "spoiler": flag("spoiler").unwrap_or(false)
      });
      let fields = body.as_object_mut().expect("an object");
      let rating = number("rating").filter(|stars| (1..=5).contains(stars));
      match kind {
        "review" => {
          fields.insert("rating".into(), serde_json::json!(rating.ok_or_else(|| "A review needs its stars.".to_string())?));
          fields.insert("body".into(), serde_json::json!(need(args, "body")?));
        }
        "quote" => {
          fields.insert("quote".into(), serde_json::json!(need(args, "quote")?));
          fields.insert("note".into(), serde_json::json!(text(args, "note")));
        }
        _ => {
          fields.insert("rating".into(), serde_json::json!(rating));
          fields.insert("line".into(), serde_json::json!(text(args, "line")));
        }
      }
      Ask::send(Method::POST, "/v1/posts", Some(body))
    }
    "react" => {
      let place = match args.get("target").and_then(|value| value.as_str()) {
        Some("post") => "posts",
        Some("thread") => "threads",
        Some("reply") => "replies",
        _ => return Err("Nothing to react to.".to_string())
      };
      let value = number("value").unwrap_or(0).clamp(-1, 1);
      Ask::send(Method::POST, format!("/v1/{place}/{}/react", hex(args, "id", "post")?), Some(serde_json::json!({ "value": value })))
    }
    "discover" => Ask::get("/v1/discover")
      .with("sort", Some(if args.get("sort").and_then(|value| value.as_str()) == Some("top") { "top" } else { "new" }.to_string()))
      .with("before", text(args, "before"))
      // Where the newest-first list left off: the server's own mark, handed back as it came.
      .with("cursor", text(args, "cursor").filter(|cursor| cursor.len() <= 400))
      .with("skip", number("skip").filter(|skip| *skip > 0).map(|skip| skip.min(300).to_string())),
    "book_posts" => Ask::get("/v1/books/posts").with("key", Some(key_of(args, "book")?)).with("before", text(args, "before")),

    // ---- book communities ---------------------------------------------------
    "community_open" => {
      let kind = kind_of(args)?;
      let body = serde_json::json!({ "kind": kind, "key": key_of(args, kind)?, "title": need(args, "title")?, "author": text(args, "author") });
      Ask::send(Method::POST, "/v1/communities", Some(body))
    }
    "communities" => Ask::get("/v1/communities")
      .with("mine", flag("mine").filter(|mine| *mine).map(|_| "1".to_string()))
      .with("q", text(args, "q")),
    "community_find" => {
      let kind = kind_of(args)?;
      Ask::get("/v1/communities/find").with("kind", Some(kind.to_string())).with("key", Some(key_of(args, kind)?))
    }
    "community" => Ask::get(format!("/v1/communities/{}", hex(args, "id", "community")?)),
    "community_join" => Ask::send(Method::POST, format!("/v1/communities/{}/join", hex(args, "id", "community")?), None),
    "community_leave" => Ask::send(Method::POST, format!("/v1/communities/{}/leave", hex(args, "id", "community")?), None),
    "community_remove_member" => Ask::send(
      Method::POST,
      format!("/v1/communities/{}/members/{}/remove", hex(args, "id", "community")?, cloud::handle_segment(&need(args, "handle")?)),
      None
    ),

    // ---- threads and replies ------------------------------------------------
    "threads" => Ask::get(format!("/v1/communities/{}/threads", hex(args, "id", "community")?)).with("before", text(args, "before")),
    "thread_create" => {
      // Passed as it was chosen: nothing, so far into the book, or up to a book of the series.
      let spoiler = args.get("spoiler").filter(|value| value.is_object()).cloned().unwrap_or(serde_json::Value::Null);
      let body = serde_json::json!({ "title": need(args, "title")?, "body": need(args, "body")?, "spoiler": spoiler });
      Ask::send(Method::POST, format!("/v1/communities/{}/threads", hex(args, "id", "community")?), Some(body))
    }
    "thread" => Ask::get(format!("/v1/threads/{}", hex(args, "id", "thread")?)).with("after", text(args, "after")),
    "reply" => Ask::send(
      Method::POST,
      format!("/v1/threads/{}/replies", hex(args, "id", "thread")?),
      Some(serde_json::json!({ "body": need(args, "body")? }))
    ),
    "thread_delete" => Ask::send(Method::DELETE, format!("/v1/threads/{}", hex(args, "id", "thread")?), None),
    "reply_delete" => Ask::send(Method::DELETE, format!("/v1/replies/{}", hex(args, "id", "reply")?), None),
    "thread_pin" => Ask::send(
      Method::POST,
      format!("/v1/threads/{}/pin", hex(args, "id", "thread")?),
      Some(serde_json::json!({ "pinned": flag("pinned").unwrap_or(false) }))
    ),

    // ---- reports and blocks -------------------------------------------------
    "report" => {
      let target = match args.get("target").and_then(|value| value.as_str()) {
        Some(target @ ("post" | "thread" | "reply" | "community")) => (target, hex(args, "id", "thing")?),
        Some("profile") => ("profile", need(args, "id")?.trim_start_matches('@').to_lowercase()),
        _ => return Err("Nothing to report.".to_string())
      };
      let reason = args
        .get("reason")
        .and_then(|value| value.as_str())
        .filter(|reason| ["spam", "harassment", "hate", "sexual", "spoiler"].contains(reason))
        .unwrap_or("other");
      let body = serde_json::json!({ "target": target.0, "id": target.1, "reason": reason, "note": text(args, "note") });
      Ask::send(Method::POST, "/v1/reports", Some(body))
    }
    "block" => Ask::send(Method::POST, format!("/v1/blocks/{}", cloud::handle_segment(&need(args, "handle")?)), None),
    "unblock" => Ask::send(Method::DELETE, format!("/v1/blocks/{}", cloud::handle_segment(&need(args, "handle")?)), None),
    "blocks" => Ask::get("/v1/blocks"),

    // ---- the owner's moderation (the server answers 404 to anyone else) -----
    "admin_reports" => Ask::get("/v1/admin/reports"),
    "admin_resolve" => {
      let target = match args.get("target").and_then(|value| value.as_str()) {
        Some(target @ ("post" | "thread" | "reply" | "community" | "profile")) => target,
        _ => return Err("Nothing to resolve.".to_string())
      };
      let action = match args.get("action").and_then(|value| value.as_str()) {
        Some(action @ ("remove" | "restore" | "dismiss")) => action,
        _ => return Err("Remove, restore or dismiss.".to_string())
      };
      Ask::send(Method::POST, "/v1/admin/resolve", Some(serde_json::json!({ "target": target, "id": need(args, "id")?, "action": action })))
    }
    "admin_suspend" => Ask::send(
      Method::POST,
      "/v1/admin/suspend",
      Some(serde_json::json!({ "handle": need(args, "handle")?.trim_start_matches('@').to_lowercase(), "days": number("days").unwrap_or(0).clamp(0, 3650) }))
    ),
    // What only the owner can put right in a community. Only what is sent
    // changes, so only what was given goes: a field left out (or null, but
    // for the author, where null takes it away) is not in the body at all.
    "admin_community" => {
      let mut body = serde_json::json!({ "id": hex(args, "id", "community")? });
      let fields = body.as_object_mut().expect("an object");
      let given = |name: &str| args.get(name).filter(|value| !value.is_null());
      if given("title").is_some() {
        fields.insert("title".into(), serde_json::json!(need(args, "title")?));
      }
      match args.get("author") {
        None => {}
        Some(author) if author.is_null() || author.is_string() => {
          fields.insert("author".into(), serde_json::json!(text(args, "author")));
        }
        Some(_) => return Err("An author is a name, or nothing.".to_string())
      }
      for name in ["keeper", "unban"] {
        if given(name).is_some() {
          fields.insert(name.into(), serde_json::json!(need(args, name)?.trim_start_matches('@').to_lowercase()));
        }
      }
      if let Some(relist) = given("relist") {
        fields.insert("relist".into(), serde_json::json!(relist.as_bool().ok_or_else(|| "List it or unlist it.".to_string())?));
      }
      Ask::send(Method::POST, "/v1/admin/community", Some(body))
    }
    "admin_settings" => Ask::get("/v1/admin/settings"),
    "admin_set_settings" => Ask::send(Method::PUT, "/v1/admin/settings", Some(serde_json::json!({ "publicPosting": flag("publicPosting").unwrap_or(true) }))),
    // The update notice: the newest version and a line about it; no version takes it down.
    "admin_set_notice" => Ask::send(Method::PUT, "/v1/admin/notice", Some(serde_json::json!({ "version": text(args, "version"), "note": text(args, "note") }))),

    // The problem reports readers sent from Settings: open or closed, fifty
    // at a time (`before` the last one shown); one whole; closed or reopened
    // with the owner's note (none takes it away); deleted.
    "admin_problems" => {
      let status = if text(args, "status").as_deref() == Some("closed") { "closed" } else { "open" };
      let before = match text(args, "before") {
        Some(_) => Some(hex(args, "before", "report")?),
        None => None
      };
      Ask::get("/v1/admin/problems").with("status", Some(status.to_string())).with("before", before)
    }
    "admin_problem" => Ask::get(format!("/v1/admin/problems/{}", hex(args, "id", "report")?)),
    "admin_problem_update" => {
      let status = match text(args, "status").as_deref() {
        Some(status @ ("open" | "closed")) => status.to_string(),
        _ => return Err("Close it or reopen it.".to_string())
      };
      let body = serde_json::json!({ "status": status, "note": text(args, "note") });
      Ask::send(Method::POST, format!("/v1/admin/problems/{}", hex(args, "id", "report")?), Some(body))
    }
    "admin_problem_delete" => {
      Ask::send(Method::DELETE, format!("/v1/admin/problems/{}", hex(args, "id", "report")?), None)
    }

    // An error kind marked fixed in a version, or (no version) open again.
    "admin_error_mark" => {
      let sig = need(args, "sig")?.to_ascii_lowercase();
      if sig.len() != 32 || !sig.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("No such error.".to_string());
      }
      Ask::send(Method::POST, format!("/v1/admin/errors/{sig}"), Some(serde_json::json!({ "fixedIn": text(args, "fixedIn") })))
    }

    // The owner's announcements: the list, one published (the server checks
    // every field, so what the page wrote goes as it is), one withdrawn.
    "admin_announcements" => Ask::get("/v1/admin/announcements"),
    "admin_announce" => {
      let draft = args.get("draft").filter(|draft| draft.is_object()).cloned().ok_or_else(|| "Nothing to publish.".to_string())?;
      Ask::send(Method::POST, "/v1/admin/announcements", Some(draft))
    }
    "admin_withdraw" => {
      let id = need(args, "id")?.to_ascii_lowercase();
      if id.len() != 12 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("No such announcement.".to_string());
      }
      Ask::send(Method::DELETE, format!("/v1/admin/announcements/{id}"), None)
    }

    _ => return Err("No such request.".to_string())
  })
}

/// One request to the public community: `route` is a name from the list in
/// `ask_for`, `args` its arguments.
#[tauri::command]
pub async fn discuss(route: String, args: Option<serde_json::Value>, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let ask = ask_for(&route, &args.unwrap_or(serde_json::Value::Null))?;
  community(&state, ask.method, ask.path, ask.query, ask.body, CommunityAuth::Required).await
}

/// The owner's overview (`GET /v1/admin/overview`), or `None` from a server
/// deployed before it, which the admin page says in a line rather than as a
/// failure. (A reader who is not the admin is told the same 404, but is
/// never shown the page that asks.)
#[tauri::command]
pub async fn admin_overview(state: State<'_, AppState>) -> Result<Option<serde_json::Value>, String> {
  cloud::community_call_if_there(&state.db, Method::GET, "/v1/admin/overview", &[], CommunityAuth::Required)
    .await
    .map_err(|e| e.to_string())
}

/// The error kinds the apps sent, open, fixed or all; `None` from a server deployed before them.
#[tauri::command]
pub async fn admin_errors(status: Option<String>, state: State<'_, AppState>) -> Result<Option<serde_json::Value>, String> {
  let status = status.as_deref().filter(|status| matches!(*status, "fixed" | "all")).unwrap_or("open");
  cloud::community_call_if_there(&state.db, Method::GET, "/v1/admin/errors", &[("status", status)], CommunityAuth::Required)
    .await
    .map_err(|e| e.to_string())
}

/// The key of each book in the library, by its id here: what tells the app
/// how far the reader is in the book a community or a post is about, so it
/// can keep spoilers past that place covered.
#[tauri::command(async)]
pub fn library_keys(state: State<'_, AppState>) -> Result<std::collections::BTreeMap<String, String>, String> {
  let db = state.db.guard();
  Ok(
    db.list_books()
      .map_err(|e| e.to_string())?
      .into_iter()
      .filter(|book| !book.title.trim().is_empty())
      .map(|book| {
        let key = book_key(&book.title, book.author.as_deref());
        (book.id, key)
      })
      .collect()
  )
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  const ID: &str = "0123456789abcdef01234567";

  fn ask(route: &str, args: serde_json::Value) -> Ask {
    ask_for(route, &args).unwrap_or_else(|error| panic!("{route}: {error}"))
  }

  #[test]
  fn only_the_listed_routes_can_be_asked_for() {
    assert!(ask_for("../v1/account", &json!({})).is_err());
    assert!(ask_for("", &json!({})).is_err());
    assert!(ask_for("admin_delete_everything", &json!({})).is_err());
  }

  /// An id from the page goes into a path only if it is one.
  #[test]
  fn an_id_is_checked_before_it_goes_into_a_path() {
    assert_eq!(ask("thread", json!({ "id": ID })).path, format!("/v1/threads/{ID}"));
    for bad in [json!({ "id": "../../account" }), json!({ "id": "123" }), json!({}), json!({ "id": 7 })] {
      for route in ["thread", "reply_delete", "thread_delete", "community_join", "threads", "thread_pin"] {
        assert!(ask_for(route, &bad).is_err(), "{route} took {bad}");
      }
    }
    let removed = ask("community_remove_member", json!({ "id": ID, "handle": "@Maya/../x" }));
    assert_eq!(removed.path, format!("/v1/communities/{ID}/members/maya%2F..%2Fx/remove"));
  }

  /// A post names its book by the same key a shared library does.
  #[test]
  fn a_post_carries_its_books_key_and_only_its_own_kinds_fields() {
    let review = ask("post", json!({ "kind": "review", "title": "The Hobbit: or There and Back Again", "author": "Tolkien, J.R.R.", "rating": 5, "body": "  Went there. Came back.  ", "audience": "everyone", "spoiler": true, "line": "ignored" }));
    assert_eq!(review.path, "/v1/posts");
    assert_eq!(
      review.body,
      Some(json!({ "kind": "review", "title": "The Hobbit: or There and Back Again", "author": "Tolkien, J.R.R.", "bookKey": "hobbit|tolkien", "audience": "everyone", "spoiler": true, "rating": 5, "body": "Went there. Came back." }))
    );
    // To followers unless everyone is chosen; a kind not known is a finished book.
    let finished = ask("post", json!({ "kind": "poem", "title": "Dune", "rating": 9, "audience": "the world" }));
    assert_eq!(
      finished.body,
      Some(json!({ "kind": "finished", "title": "Dune", "author": null, "bookKey": "dune|", "audience": "followers", "spoiler": false, "rating": null, "line": null }))
    );
    let quote = ask("post", json!({ "kind": "quote", "title": "Dune", "author": "Frank Herbert", "quote": "Fear is the mind-killer.", "note": "" }));
    assert_eq!(quote.body.as_ref().and_then(|body| body.get("quote")), Some(&json!("Fear is the mind-killer.")));
    assert_eq!(quote.body.as_ref().and_then(|body| body.get("note")), Some(&json!(null)));
    // A review with no stars, or no words, is not sent.
    assert!(ask_for("post", &json!({ "kind": "review", "title": "Dune", "body": "Good." })).is_err());
    assert!(ask_for("post", &json!({ "kind": "review", "title": "Dune", "rating": 4, "body": "  " })).is_err());
    assert!(ask_for("post", &json!({ "kind": "quote", "title": "Dune" })).is_err());
  }

  #[test]
  fn a_community_is_for_a_book_or_a_series_named_by_its_key() {
    let book = ask("community_open", json!({ "kind": "book", "title": "The Lord of the Rings", "author": "J.R.R. Tolkien" }));
    assert_eq!(book.body, Some(json!({ "kind": "book", "key": "lord of the rings|tolkien", "title": "The Lord of the Rings", "author": "J.R.R. Tolkien" })));
    let series = ask("community_open", json!({ "kind": "series", "key": "The Lord Of The Rings", "title": "The Lord of the Rings" }));
    assert_eq!(series.body.as_ref().and_then(|body| body.get("key")), Some(&json!("the lord of the rings")));
    // A series has no key to be made up from, and a kind that is neither is refused.
    assert!(ask_for("community_open", &json!({ "kind": "series", "title": "Mistborn" })).is_err());
    assert!(ask_for("community_open", &json!({ "kind": "club", "key": "x", "title": "X" })).is_err());
    assert!(ask_for("community_open", &json!({ "kind": "book", "title": "!!!" })).is_err());
    let found = ask("community_find", json!({ "kind": "book", "key": "Dune|Herbert" }));
    assert_eq!(found.query, vec![("kind", "book".to_string()), ("key", "dune|herbert".to_string())]);
  }

  #[test]
  fn the_lists_are_asked_for_with_only_what_was_given() {
    assert_eq!(ask("discover", json!({})).query, vec![("sort", "new".to_string())]);
    assert_eq!(
      ask("discover", json!({ "sort": "top", "skip": 9000, "before": "2026-10-11T10:00:00Z" })).query,
      vec![("sort", "top".to_string()), ("before", "2026-10-11T10:00:00Z".to_string()), ("skip", "300".to_string())]
    );
    assert_eq!(ask("discover", json!({ "cursor": "abc" })).query, vec![("sort", "new".to_string()), ("cursor", "abc".to_string())]);
    assert_eq!(ask("communities", json!({ "mine": true })).query, vec![("mine", "1".to_string())]);
    assert_eq!(ask("communities", json!({ "mine": false, "q": " rings " })).query, vec![("q", "rings".to_string())]);
  }

  #[test]
  fn a_spoiler_goes_as_it_was_chosen() {
    let none = ask("thread_create", json!({ "id": ID, "title": "A theory", "body": "What if..." }));
    assert_eq!(none.body, Some(json!({ "title": "A theory", "body": "What if...", "spoiler": null })));
    let far = ask("thread_create", json!({ "id": ID, "title": "The ending", "body": "So.", "spoiler": { "percent": 100 } }));
    assert_eq!(far.body.as_ref().and_then(|body| body.get("spoiler")), Some(&json!({ "percent": 100 })));
    assert!(ask_for("thread_create", &json!({ "id": ID, "title": " ", "body": "x" })).is_err());
  }

  #[test]
  fn reactions_reports_and_the_owners_tools_say_only_what_they_may() {
    let liked = ask("react", json!({ "target": "reply", "id": ID, "value": 7 }));
    assert_eq!((liked.path.as_str(), liked.body), (format!("/v1/replies/{ID}/react").as_str(), Some(json!({ "value": 1 }))));
    assert!(ask_for("react", &json!({ "target": "account", "id": ID, "value": 1 })).is_err());

    let report = ask("report", json!({ "target": "thread", "id": ID, "reason": "made up", "note": " rude " }));
    assert_eq!(report.body, Some(json!({ "target": "thread", "id": ID, "reason": "other", "note": "rude" })));
    let profile = ask("report", json!({ "target": "profile", "id": "@Maya", "reason": "spam" }));
    assert_eq!(profile.body, Some(json!({ "target": "profile", "id": "maya", "reason": "spam", "note": null })));
    assert!(ask_for("report", &json!({ "target": "post", "id": "nope", "reason": "spam" })).is_err());

    assert_eq!(ask("block", json!({ "handle": "@Maya" })).path, "/v1/blocks/maya");
    assert_eq!(ask("unblock", json!({ "handle": "maya" })).method, Method::DELETE);
    assert!(ask_for("admin_resolve", &json!({ "target": "post", "id": ID, "action": "promote" })).is_err());
    assert_eq!(
      ask("admin_suspend", json!({ "handle": "@Maya", "days": 99999 })).body,
      Some(json!({ "handle": "maya", "days": 3650 }))
    );
    assert_eq!(ask("admin_set_settings", json!({ "publicPosting": false })).body, Some(json!({ "publicPosting": false })));
    let notice = ask("admin_set_notice", json!({ "version": "1.4.2", "note": "Fixes." }));
    assert_eq!((notice.method, notice.path.as_str()), (Method::PUT, "/v1/admin/notice"));
    assert_eq!(notice.body, Some(json!({ "version": "1.4.2", "note": "Fixes." })));
    // Nothing given: the notice comes down.
    assert_eq!(ask("admin_set_notice", json!({})).body, Some(json!({ "version": null, "note": null })));
  }

  /// The owner's problem reports: a status that is one of two, ids that are
  /// ids, and a note that is the field's words or nothing.
  #[test]
  fn the_owners_problem_reports_ask_for_what_the_server_has() {
    let open = ask("admin_problems", json!({}));
    assert_eq!((open.method.clone(), open.path.as_str()), (Method::GET, "/v1/admin/problems"));
    assert_eq!(open.query, vec![("status", "open".to_string())]);
    let closed = ask("admin_problems", json!({ "status": "closed", "before": ID.to_uppercase() }));
    assert_eq!(closed.query, vec![("status", "closed".to_string()), ("before", ID.to_string())]);
    assert!(ask_for("admin_problems", &json!({ "before": "../x" })).is_err());
    assert_eq!(ask("admin_problems", json!({ "status": "everything" })).query[0].1, "open");

    assert_eq!(ask("admin_problem", json!({ "id": ID })).path, format!("/v1/admin/problems/{ID}"));
    assert!(ask_for("admin_problem", &json!({ "id": "nope" })).is_err());

    let close = ask("admin_problem_update", json!({ "id": ID, "status": "closed", "note": " Fixed. " }));
    assert_eq!(close.method, Method::POST);
    assert_eq!(close.path, format!("/v1/admin/problems/{ID}"));
    assert_eq!(close.body, Some(json!({ "status": "closed", "note": "Fixed." })));
    let reopen = ask("admin_problem_update", json!({ "id": ID, "status": "open", "note": "" }));
    assert_eq!(reopen.body, Some(json!({ "status": "open", "note": null })));
    assert!(ask_for("admin_problem_update", &json!({ "id": ID, "status": "gone" })).is_err());

    let gone = ask("admin_problem_delete", json!({ "id": ID }));
    assert_eq!((gone.method, gone.body), (Method::DELETE, None));
  }

  /// Error kinds and announcements: a signature and an id go into a path
  /// only if they are one, and a draft is sent as the page wrote it.
  #[test]
  fn the_owners_errors_and_announcements_ask_for_what_the_server_has() {
    let sig = "0123456789abcdef0123456789ABCDEF";
    let fixed = ask("admin_error_mark", json!({ "sig": sig, "fixedIn": " 1.5.12 " }));
    assert_eq!((fixed.method, fixed.path.as_str()), (Method::POST, "/v1/admin/errors/0123456789abcdef0123456789abcdef"));
    assert_eq!(fixed.body, Some(json!({ "fixedIn": "1.5.12" })));
    assert_eq!(ask("admin_error_mark", json!({ "sig": sig })).body, Some(json!({ "fixedIn": null })));
    for bad in ["../admin", "123", "0123456789abcdef0123456789abcdeg"] {
      assert!(ask_for("admin_error_mark", &json!({ "sig": bad })).is_err(), "{bad}");
    }

    assert_eq!(ask("admin_announcements", json!({})).path, "/v1/admin/announcements");
    let draft = json!({ "title": "Sorry", "body": "Drive needs you.", "link": { "label": "Reconnect", "action": "reconnect_drive" }, "audience": { "kind": "drive" } });
    let made = ask("admin_announce", json!({ "draft": draft.clone() }));
    assert_eq!((made.method, made.body), (Method::POST, Some(draft)));
    assert!(ask_for("admin_announce", &json!({ "draft": "Sorry" })).is_err());
    let gone = ask("admin_withdraw", json!({ "id": "0123456789AB" }));
    assert_eq!((gone.method, gone.path.as_str()), (Method::DELETE, "/v1/admin/announcements/0123456789ab"));
    assert!(ask_for("admin_withdraw", &json!({ "id": "../../notice" })).is_err());
  }

  /// The server changes whatever is in the body, so nothing goes that was not given.
  #[test]
  fn the_owner_changes_only_what_is_sent_of_a_community() {
    let nothing = ask("admin_community", json!({ "id": ID }));
    assert_eq!((nothing.method.clone(), nothing.path.as_str()), (Method::POST, "/v1/admin/community"));
    assert_eq!(nothing.body, Some(json!({ "id": ID })));
    // Null is nothing given, but for the author, where it takes the name away (as an empty one does).
    assert_eq!(
      ask("admin_community", json!({ "id": ID, "title": null, "keeper": null, "unban": null, "relist": null, "author": null })).body,
      Some(json!({ "id": ID, "author": null }))
    );
    assert_eq!(ask("admin_community", json!({ "id": ID, "author": "  " })).body, Some(json!({ "id": ID, "author": null })));
    assert_eq!(
      ask("admin_community", json!({ "id": ID, "title": "  Dune  ", "author": " Frank Herbert ", "keeper": "@Maya", "unban": " @@Sam ", "relist": false, "memberCount": 0 })).body,
      Some(json!({ "id": ID, "title": "Dune", "author": "Frank Herbert", "keeper": "maya", "unban": "sam", "relist": false }))
    );
    assert_eq!(ask("admin_community", json!({ "id": ID, "relist": true })).body, Some(json!({ "id": ID, "relist": true })));
    // An id that is not one, a title of nothing, and values of the wrong kind are not sent.
    for bad in [
      json!({ "title": "Dune" }),
      json!({ "id": "../../account", "title": "Dune" }),
      json!({ "id": ID, "title": "  " }),
      json!({ "id": ID, "author": 7 }),
      json!({ "id": ID, "keeper": "" }),
      json!({ "id": ID, "unban": 7 }),
      json!({ "id": ID, "relist": "yes" })
    ] {
      assert!(ask_for("admin_community", &bad).is_err(), "took {bad}");
    }
  }
}
