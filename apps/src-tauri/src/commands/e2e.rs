//! The app's requests against a real Leaflet server.
//!
//! Every other test of the community code checks one side: the server's own
//! suite calls its routes by hand, and the tests here check the requests the
//! app builds and what it does with canned answers. Neither shows that the
//! two fit. This one does: it runs against a server started on this machine
//! on a throwaway database, and sends what the app itself would send (the
//! profile as `cloud::ProfileUpdate` serialises it, the library as
//! `shared_library` lists it, every public-community request as
//! `discuss::ask_for` builds it) and reads the answers with the app's own
//! types and helpers.
//!
//! Ignored unless asked for, because it needs that server:
//!
//! ```text
//! node server/scripts/e2e-server.mjs      (API on 18787, control on 18788)
//! LEAFLET_E2E_API=http://127.0.0.1:18787 LEAFLET_E2E_CONTROL=http://127.0.0.1:18788 \
//!   cargo test --lib -- --ignored commands::e2e
//! ```
//!
//! It signs readers up by calling the server directly, never through
//! `cloud::signup`: that keeps the session in the system keychain, and a test
//! must not replace the sign-in of whoever is running it.

use super::discuss::ask_for;
use super::friends::{books_to_ask, mark_in_yours, name_books, shared_library};
use super::*;
use serde_json::{json, Value};

struct Server {
  http: reqwest::Client,
  api: String,
  control: String
}

struct Reader {
  token: String,
  handle: String,
  email: String
}

impl Server {
  /// One request; the answer's status and JSON (null where there is none).
  async fn send(&self, method: Method, path: &str, query: &[(&str, String)], token: Option<&str>, body: Option<Value>) -> (u16, Value) {
    let mut request = self.http.request(method, format!("{}{path}", self.api));
    if !query.is_empty() {
      request = request.query(query);
    }
    if let Some(token) = token {
      request = request.bearer_auth(token);
    }
    if let Some(body) = body {
      request = request.json(&body);
    }
    let response = request.send().await.expect("the test server answers");
    let status = response.status().as_u16();
    (status, response.json().await.unwrap_or(Value::Null))
  }

  /// A request that should succeed.
  async fn ok(&self, method: Method, path: &str, reader: &Reader, body: Option<Value>) -> Value {
    let (status, answer) = self.send(method.clone(), path, &[], Some(&reader.token), body).await;
    assert!((200..300).contains(&status), "{method} {path} as @{}: {status} {answer}", reader.handle);
    answer
  }

  /// A public-community request, built as the app builds it (`ask_for`).
  async fn ask(&self, reader: &Reader, route: &str, args: Value) -> Result<Value, String> {
    let ask = ask_for(route, &args)?;
    let (status, answer) = self.send(ask.method, &ask.path, &ask.query, Some(&reader.token), ask.body).await;
    if (200..300).contains(&status) {
      Ok(answer)
    } else {
      Err(format!("{status}: {}", answer.get("error").and_then(|e| e.as_str()).unwrap_or("")))
    }
  }

  async fn must(&self, reader: &Reader, route: &str, args: Value) -> Value {
    self.ask(reader, route, args.clone()).await.unwrap_or_else(|error| panic!("{route} {args} as @{}: {error}", reader.handle))
  }

  async fn sign_up(&self, name: &str, run: &str) -> Reader {
    let email = format!("{name}-{run}@example.test");
    let (status, answer) = self
      .send(Method::POST, "/v1/auth/signup", &[], None, Some(json!({ "email": email, "password": "correct horse battery", "displayName": name })))
      .await;
    assert_eq!(status, 201, "sign-up: {answer}");
    Reader { token: answer["token"].as_str().expect("a token").to_string(), handle: format!("{name}{run}"), email }
  }

  /// What only the database can do: a month's age and a confirmed address, or the admin's mark.
  async fn control(&self, path: &str, body: Value) {
    let response = self.http.post(format!("{}{path}", self.control)).json(&body).send().await.expect("the control port answers");
    assert!(response.status().is_success(), "control {path}");
  }

  /// Saves a profile exactly as the app serialises one.
  async fn save_profile(&self, reader: &Reader, update: &cloud::ProfileUpdate) -> Value {
    self.ok(Method::PUT, "/v1/profile/me", reader, Some(serde_json::to_value(update).expect("a profile"))).await
  }
}

fn book(id: &str, title: &str, author: &str, progress: f32) -> BookRecord {
  BookRecord {
    id: id.to_string(),
    title: title.to_string(),
    author: Some(author.to_string()),
    genres: Vec::new(),
    cover_url: None,
    local_path: format!("C:\\books\\{id}.epub"),
    file_hash: id.to_string(),
    progress,
    position: None,
    series: None,
    series_index: None,
    last_opened: Some(chrono::Utc::now().to_rfc3339()),
    created_at: "2026-01-01T00:00:00+00:00".to_string(),
    metadata_checked_at: None,
    metadata_updated_at: None,
    progress_updated_at: None,
    finished_at: None,
    deleted_at: None,
    available: true
  }
}

/// A camp as the app keeps one (`pip_base_save`): more than a profile shows.
const KEPT_CAMP: &str = r#"{
  "v": 2, "acorns": 310,
  "levels": { "burrow": 3, "oak": 2, "store": 2, "fence": 1, "tower": 1, "hut": 2 },
  "yard": [ { "kind": "workshop", "level": 1 }, { "kind": null, "level": 0 } ],
  "camps": 7,
  "banners": ["2026-09", "2026-10"],
  "raised": ["a1", "a2", "a3"]
}"#;

#[tokio::test]
#[ignore = "needs a Leaflet server on this machine: see the top of this file"]
async fn the_apps_requests_fit_a_real_server() {
  let (Ok(api), Ok(control)) = (std::env::var("LEAFLET_E2E_API"), std::env::var("LEAFLET_E2E_CONTROL")) else {
    panic!("set LEAFLET_E2E_API and LEAFLET_E2E_CONTROL");
  };
  let server = Server { http: reqwest::Client::builder().no_proxy().build().expect("a client"), api, control };
  // Letters only: a handle is letters, digits and underscores.
  let run: String = format!("{:x}", chrono::Utc::now().timestamp_millis()).chars().rev().take(6).collect();
  let today = chrono::Local::now().format("%Y-%m-%d").to_string();
  let week = iso_week_key(&today);
  // The counts below (one review of Dune, one community) are of this run alone.
  server.control("/reset", Value::Null).await;

  let ana = server.sign_up("ana", &run).await;
  let ben = server.sign_up("ben", &run).await;
  let cal = server.sign_up("cal", &run).await;
  let dee = server.sign_up("dee", &run).await;

  // ---- a profile, as the app sends and reads it -----------------------------------
  let anas_books = [book("a1", "Dune", "Frank Herbert", 0.4), book("a2", "Emma", "Jane Austen", 1.0), book("a3", "Ulysses", "James Joyce", 0.0)];
  let bens_books = [book("b1", "Dune: Deluxe Edition", "Herbert, Frank", 0.1), book("b2", "Middlemarch", "George Eliot", 0.0), book("b3", "Emma", "Jane Austen", 0.0)];
  // The camp as the profile publishes it: built from a kept camp by the app's own summary.
  let camp = camp_summary(KEPT_CAMP).expect("a camp the app can read");
  assert_eq!(camp, json!({
    "levels": { "burrow": 3, "oak": 2, "store": 2, "fence": 1, "tower": 1, "hut": 2 },
    "yard": [ { "kind": "workshop", "level": 1 }, { "kind": null, "level": 0 } ],
    "camps": 7, "banners": 2, "trophies": 3
  }));
  for (reader, minutes) in [(&ana, 120.0), (&ben, 40.0), (&cal, 5.0), (&dee, 0.0)] {
    let update = cloud::ProfileUpdate {
      handle: Some(reader.handle.clone()),
      visibility: Some("public".to_string()),
      week_key: Some(week.clone()),
      week_minutes: Some(minutes),
      streak: Some(3),
      books_finished: Some(1),
      shelf: Some(vec![cloud::ShelfBook { title: "Dune".to_string(), author: None, style_seed: "free-2026-10-11".to_string() }]),
      share_library: Some(true),
      reading: Some(friends::reading_now(&anas_books, chrono::Utc::now()).unwrap_or(Value::Null)),
      level: Some(4),
      badges: Some(vec!["streak-7".to_string(), format!("month-{}-500", &today[..7])]),
      arcade: Some(json!({ "dash": 120, "catch": 44, "flap": 9 })),
      camp: Some(camp.clone()),
      ..cloud::ProfileUpdate::default()
    };
    let saved = server.save_profile(reader, &update).await;
    assert_eq!(saved["camp"], camp, "the server takes the summary as the app builds it");
  }
  let mine: cloud::Profile = serde_json::from_value(server.ok(Method::GET, "/v1/profile/me", &ana, None).await).expect("the app's own Profile type reads it");
  assert_eq!(mine.handle.as_deref(), Some(ana.handle.as_str()));
  assert_eq!(mine.visibility, "public");
  assert!(mine.shares_library);
  assert_eq!(mine.level, Some(4));
  assert_eq!(mine.badges.len(), 2);
  assert_eq!(mine.reading.as_ref().and_then(|reading| reading.get("title")), Some(&json!("Dune")));
  assert_eq!(mine.reading.as_ref().and_then(|reading| reading.get("percent")), Some(&json!(40)));
  assert!(!mine.rules_accepted && !mine.is_admin && mine.suspended_until.is_none());
  // The camp comes back as it went, and with nothing of the kept camp but its levels and counts.
  assert_eq!(mine.camp.as_ref(), Some(&camp));
  let shown = server.ok(Method::GET, &format!("/v1/profile/{}", ana.handle), &ben, None).await;
  assert_eq!(shown["camp"], camp, "and on the card another reader opens");
  assert!(!shown.to_string().contains("acorns") && !shown.to_string().contains("raised"));
  // No camp kept (or one that cannot be read) is sent as null, and the profile loses it.
  assert_eq!(camp_summary("not a camp"), None);
  let cleared = cloud::ProfileUpdate { camp: Some(camp_summary("not a camp").unwrap_or(Value::Null)), ..cloud::ProfileUpdate::default() };
  let without: cloud::Profile = serde_json::from_value(server.save_profile(&dee, &cleared).await).expect("a profile");
  assert!(without.camp.is_none());
  assert_eq!(without.level, Some(4), "and it loses nothing else");

  // ---- the library, for a reader who follows ---------------------------------------
  let sent = server.ok(Method::PUT, "/v1/library/me", &ana, Some(json!({ "books": shared_library(&anas_books) }))).await;
  assert_eq!(sent["count"], 3);
  let follow = server.ok(Method::POST, &format!("/v1/follows/{}", cloud::handle_segment(&ana.handle)), &ben, None).await;
  assert_eq!((follow["following"].as_bool(), follow["requested"].as_bool()), (Some(true), Some(false)));
  let mut theirs = server.ok(Method::GET, &format!("/v1/profile/{}/library", ana.handle), &ben, None).await;
  let bens_keys: std::collections::HashSet<String> = shared_library(&bens_books).into_iter().map(|book| book.key).collect();
  mark_in_yours(&mut theirs, &bens_keys);
  let in_common: Vec<(&str, bool)> = theirs["books"].as_array().expect("books").iter().map(|book| (book["title"].as_str().unwrap_or(""), book["inYours"] == json!(true))).collect();
  assert!(in_common.contains(&("Dune", true)) && in_common.contains(&("Emma", true)) && in_common.contains(&("Ulysses", false)), "{in_common:?}");
  // A stranger is told to follow first.
  let (status, _) = server.send(Method::GET, &format!("/v1/profile/{}/library", ana.handle), &[], Some(&cal.token), None).await;
  assert_eq!(status, 403);

  // Which of Ben's books the readers he follows have.
  let asked = books_to_ask(&bens_books);
  let keys: Vec<&str> = asked.iter().map(|(key, _, _)| key.as_str()).collect();
  let mut among = server.ok(Method::POST, "/v1/library/among", &ben, Some(json!({ "keys": keys }))).await;
  name_books(&mut among, &asked);
  let dune = among["books"].as_array().expect("books").iter().find(|book| book["bookId"] == "b1").expect("Dune is among them").clone();
  assert_eq!(dune["readers"][0]["handle"], json!(ana.handle));
  assert_eq!(dune["readers"][0]["percent"], 40);
  let emma = among["books"].as_array().expect("books").iter().find(|book| book["bookId"] == "b3").expect("Emma too").clone();
  assert_eq!(emma["finished"], 1);

  // ---- a profile kept to followers ---------------------------------------------------
  server.save_profile(&cal, &cloud::ProfileUpdate { visibility: Some("followers".to_string()), ..cloud::ProfileUpdate::default() }).await;
  let locked = server.ok(Method::GET, &format!("/v1/profile/{}", cal.handle), &ben, None).await;
  assert_eq!((locked["locked"].as_bool(), locked["visibility"].as_str()), (Some(true), Some("followers")));
  assert_eq!(locked["shelf"], json!([]), "an older app can still draw the card");
  assert!(locked.get("camp").is_none() && !locked.to_string().contains("burrow"), "a locked card says nothing of the camp: {locked}");
  let asked_to = server.ok(Method::POST, &format!("/v1/follows/{}", cal.handle), &ben, None).await;
  assert_eq!((asked_to["following"].as_bool(), asked_to["requested"].as_bool()), (Some(false), Some(true)));
  let requests = server.ok(Method::GET, "/v1/follow-requests", &cal, None).await;
  assert_eq!(requests["requests"][0]["handle"], json!(ben.handle));
  server.ok(Method::POST, &format!("/v1/follow-requests/{}/accept", ben.handle), &cal, None).await;
  let open = server.ok(Method::GET, &format!("/v1/profile/{}", cal.handle), &ben, None).await;
  assert_eq!((open["locked"].as_bool(), open["isFollowing"].as_bool()), (Some(false), Some(true)));
  assert_eq!(open["camp"], camp, "in full once accepted; a save that did not name the camp left it alone");
  server.save_profile(&cal, &cloud::ProfileUpdate { visibility: Some("public".to_string()), ..cloud::ProfileUpdate::default() }).await;

  // ---- posts: for followers at once, for everyone only in good standing ---------------
  let finished = server.must(&ana, "post", json!({ "kind": "finished", "title": "Emma", "author": "Jane Austen", "rating": 4, "line": "Better than I remembered." })).await;
  assert_eq!(finished["post"]["kind"], "finished");
  assert_eq!(finished["post"]["bookKey"], "emma|austen");
  let feed = server.ok(Method::GET, "/v1/feed", &ben, None).await;
  assert_eq!(feed["posts"][0]["title"], "Emma");
  assert_eq!(feed["posts"][0]["likes"], 0);
  assert_eq!(feed["posts"][0]["author"], "Jane Austen", "the book's author, not the poster's profile");
  assert_eq!(feed["posts"][0]["person"]["handle"], json!(ana.handle));
  let review = json!({ "kind": "review", "title": "Dune", "author": "Frank Herbert", "rating": 5, "body": "The spice must flow.\n\nSecond paragraph.", "audience": "everyone", "spoiler": false });
  let refused = server.ask(&ana, "post", review.clone()).await.expect_err("a new account does not post for everyone");
  assert!(refused.starts_with("403"), "{refused}");
  let too_new = server.ask(&ben, "react", json!({ "target": "post", "id": finished["post"]["id"], "value": 1 })).await.expect_err("nor like");
  assert!(too_new.starts_with("403"), "{too_new}");

  for reader in [&ana, &ben, &cal, &dee] {
    server.control("/age", json!({ "email": reader.email })).await;
  }
  let no_rules = server.ask(&ana, "post", review.clone()).await.expect_err("the guidelines come first");
  assert!(no_rules.contains("guidelines"), "{no_rules}");
  for reader in [&ana, &ben, &cal, &dee] {
    assert_eq!(server.must(reader, "rules_accept", Value::Null).await["accepted"], true);
  }

  let posted = server.must(&ana, "post", review).await;
  let review_id = posted["post"]["id"].as_str().expect("an id").to_string();
  assert_eq!(posted["post"]["body"], "The spice must flow.\n\nSecond paragraph.", "a review keeps its paragraphs");
  let discover = server.must(&ben, "discover", json!({ "sort": "new" })).await;
  assert!(discover["posts"].as_array().expect("posts").iter().any(|post| post["id"] == json!(review_id)));
  assert!(discover.get("next").is_some(), "the cursor the app pages by");
  let liked = server.must(&ben, "react", json!({ "target": "post", "id": review_id, "value": 1 })).await;
  assert_eq!((liked["likes"].as_i64(), liked["dislikes"].as_i64(), liked["myReaction"].as_i64()), (Some(1), Some(0), Some(1)));
  let changed = server.must(&ben, "react", json!({ "target": "post", "id": review_id, "value": -1 })).await;
  assert_eq!((changed["likes"].as_i64(), changed["dislikes"].as_i64()), (Some(0), Some(1)));
  assert!(server.ask(&ana, "react", json!({ "target": "post", "id": review_id, "value": 1 })).await.is_err(), "not one's own");
  // Ben's copy is "Dune: Deluxe Edition" by "Herbert, Frank": the same book, by the key.
  let about = server.must(&ben, "book_posts", json!({ "title": "Dune: Deluxe Edition", "author": "Herbert, Frank" })).await;
  assert_eq!(about["summary"]["reviews"], 1);
  assert_eq!(about["posts"][0]["id"], json!(review_id));
  assert_eq!(about["posts"][0]["author"], "Frank Herbert");
  let quote = server.must(&ben, "post", json!({ "kind": "quote", "title": "Dune", "author": "Frank Herbert", "quote": "Fear is the mind-killer.", "audience": "everyone" })).await;
  assert_eq!(quote["post"]["quote"], "Fear is the mind-killer.");

  // ---- a community: one a book, unlisted until three established readers are in it -----
  let dune = json!({ "kind": "book", "title": "Dune", "author": "Frank Herbert" });
  let started = server.must(&ana, "community_open", dune.clone()).await;
  let community = started["community"]["id"].as_str().expect("an id").to_string();
  assert_eq!((started["community"]["isKeeper"].as_bool(), started["community"]["listed"].as_bool()), (Some(true), Some(false)));
  assert_eq!(started["community"]["title"], "Dune");
  let found = server.must(&cal, "communities", json!({ "q": "dune" })).await;
  assert_eq!(found["communities"], json!([]), "nobody else can find it yet");
  // Ben's differently titled copy opens the same one.
  let joined = server.must(&ben, "community_open", json!({ "kind": "book", "title": "Dune: Deluxe Edition", "author": "Herbert, Frank" })).await;
  assert_eq!(joined["community"]["id"], json!(community));
  let third = server.must(&dee, "community_join", json!({ "id": community })).await;
  assert_eq!((third["community"]["memberCount"].as_i64(), third["community"]["listed"].as_bool()), (Some(3), Some(true)));
  let found = server.must(&cal, "communities", json!({ "q": "dune" })).await;
  assert_eq!(found["communities"][0]["id"], json!(community));
  assert_eq!(server.must(&cal, "community", json!({ "id": community })).await["community"]["isMember"], false);
  assert_eq!(server.must(&ana, "communities", json!({ "mine": true })).await["communities"][0]["id"], json!(community));
  assert_eq!(server.must(&cal, "community_find", dune).await["community"]["id"], json!(community));

  // ---- threads, replies, and a spoiler that does not leak through the list -------------
  let made = server.must(&ana, "thread_create", json!({ "id": community, "title": "The ending, explained", "body": "It was the water of life.\n\nAll along.", "spoiler": { "percent": 100 } })).await;
  let thread = made["thread"]["id"].as_str().expect("an id").to_string();
  let open_thread = server.must(&ben, "thread_create", json!({ "id": community, "title": "First impressions", "body": "The opening is slow and I like it." })).await;
  assert!(server.ask(&cal, "thread_create", json!({ "id": community, "title": "Hello", "body": "Not a member." })).await.is_err());
  let listed = server.must(&ben, "threads", json!({ "id": community })).await;
  let rows = listed["threads"].as_array().expect("threads");
  let marked = rows.iter().find(|row| row["id"] == json!(thread)).expect("the marked thread");
  assert_eq!((marked["title"].is_null(), marked["titleHidden"].as_bool(), marked["excerpt"].is_null()), (true, Some(true), true), "{marked}");
  assert_eq!(marked["spoiler"], json!({ "percent": 100 }));
  let plain = rows.iter().find(|row| row["id"] == open_thread["thread"]["id"]).expect("the other");
  assert_eq!(plain["title"], "First impressions");
  assert!(plain["excerpt"].as_str().is_some_and(|excerpt| excerpt.starts_with("The opening")));
  let opened = server.must(&ben, "thread", json!({ "id": thread })).await;
  assert_eq!(opened["thread"]["title"], "The ending, explained");
  assert_eq!(opened["community"]["id"], json!(community));
  let reply = server.must(&ben, "reply", json!({ "id": thread, "body": "I did not see it coming." })).await;
  let reply_id = reply["reply"]["id"].as_str().expect("an id").to_string();
  assert_eq!(server.must(&ana, "react", json!({ "target": "reply", "id": reply_id, "value": 1 })).await["likes"], 1);
  assert_eq!(server.must(&ana, "thread_pin", json!({ "id": thread, "pinned": true })).await["pinned"], true);
  assert_eq!(server.must(&ben, "thread", json!({ "id": thread })).await["replies"][0]["id"], json!(reply_id));

  // ---- reports hide at three; the owner sees them and restores -------------------------
  let plain_id = open_thread["thread"]["id"].as_str().expect("an id").to_string();
  for (reader, reason) in [(&ana, "spam"), (&cal, "harassment")] {
    assert_eq!(server.must(reader, "report", json!({ "target": "thread", "id": plain_id, "reason": reason, "note": "test" })).await["reported"], true);
  }
  assert!(server.ask(&cal, "thread", json!({ "id": plain_id })).await.is_ok(), "two reports do not hide it");
  server.must(&dee, "report", json!({ "target": "thread", "id": plain_id, "reason": "spam" })).await;
  assert!(server.ask(&cal, "thread", json!({ "id": plain_id })).await.is_err(), "three do");
  assert!(server.ask(&ben, "admin_reports", Value::Null).await.expect_err("only the owner").starts_with("404"));
  server.control("/admin", json!({ "handle": ana.handle })).await;
  let me: cloud::Profile = serde_json::from_value(server.ok(Method::GET, "/v1/profile/me", &ana, None).await).expect("a profile");
  assert!(me.is_admin && me.rules_accepted);
  let queue = server.must(&ana, "admin_reports", Value::Null).await;
  let waiting = queue["reports"].as_array().expect("reports").iter().find(|group| group["id"] == json!(plain_id)).expect("the reported thread").clone();
  assert_eq!((waiting["target"].as_str(), waiting["count"].as_i64()), (Some("thread"), Some(3)));
  assert_eq!(waiting["content"]["title"], "First impressions");
  assert_eq!(waiting["content"]["person"]["handle"], json!(ben.handle));
  assert_eq!(waiting["content"]["hidden"], true);
  assert_eq!(waiting["reasons"]["spam"], 2);
  server.must(&ana, "admin_resolve", json!({ "target": "thread", "id": plain_id, "action": "restore" })).await;
  assert!(server.ask(&cal, "thread", json!({ "id": plain_id })).await.is_ok(), "restored");
  let settings = server.must(&ana, "admin_set_settings", json!({ "publicPosting": false })).await;
  assert_eq!(settings["publicPosting"], false);
  let paused = server.ask(&ben, "reply", json!({ "id": thread, "body": "Still here?" })).await.expect_err("paused");
  assert!(paused.starts_with("503"), "{paused}");
  assert!(server.ask(&ben, "thread", json!({ "id": thread })).await.is_ok(), "reading still works");
  server.must(&ana, "admin_set_settings", json!({ "publicPosting": true })).await;

  // ---- blocks -----------------------------------------------------------------------
  server.must(&ben, "block", json!({ "handle": cal.handle })).await;
  assert_eq!(server.must(&ben, "blocks", Value::Null).await["blocked"][0]["handle"], json!(cal.handle));
  let (status, _) = server.send(Method::GET, &format!("/v1/profile/{}", ben.handle), &[], Some(&cal.token), None).await;
  assert_eq!(status, 404, "a blocked reader cannot open the profile of the one who blocked them");
  let seen = server.must(&cal, "discover", json!({ "sort": "new" })).await;
  assert!(seen["posts"].as_array().expect("posts").iter().all(|post| post["person"]["handle"] != json!(ben.handle)), "nor see their posts");
  server.must(&ben, "unblock", json!({ "handle": cal.handle })).await;

  // ---- clubs, presents and a staked duel, by the paths the app's commands use -----------
  let club = server.ok(Method::POST, "/v1/clubs", &ana, Some(json!({ "name": "Sunday readers", "goalMinutes": 120 }))).await;
  let code = club["club"]["code"].as_str().expect("a code").to_string();
  let joined = server.ok(Method::POST, "/v1/clubs/join", &ben, Some(json!({ "code": code }))).await;
  assert_eq!(joined["club"]["members"].as_array().map(Vec::len), Some(2));
  let (_, clubs) = server.send(Method::GET, "/v1/clubs", &[("week", week.clone())], Some(&ben.token), None).await;
  assert_eq!(clubs["clubs"][0]["members"][0]["weekMinutes"], 120, "the board is the members' week");

  server.ok(Method::POST, &format!("/v1/follows/{}", ben.handle), &ana, None).await;
  let gift = server.ok(Method::POST, "/v1/gifts", &ana, Some(json!({ "to": ben.handle, "kind": "accessory", "itemId": "cap" }))).await;
  let gift_id = gift["gift"]["id"].as_str().expect("an id").to_string();
  let waiting = server.ok(Method::GET, "/v1/gifts", &ben, None).await;
  assert_eq!((waiting["gifts"][0]["id"].as_str(), waiting["gifts"][0]["itemId"].as_str()), (Some(gift_id.as_str()), Some("cap")));
  server.ok(Method::POST, &format!("/v1/gifts/{gift_id}/claim"), &ben, None).await;

  let duel = server.ok(Method::POST, "/v1/duels", &ben, Some(json!({ "handle": ana.handle, "weekKey": week, "stake": 25 }))).await;
  assert_eq!(duel["stake"], 25);
  let duels = server.ok(Method::GET, "/v1/duels", &ana, None).await;
  assert_eq!(duels["duels"][0]["stake"], 25);

  // ---- a raid on a friend's camp, as the app's commands send and read it ----------------
  // Ana and Ben follow each other by now, and each shows a camp.
  let targets = list_or_none(Some(server.ok(Method::GET, "/v1/raids/targets", &ana, None).await), "targets");
  let bens = targets["targets"].as_array().expect("targets").iter().find(|target| target["handle"] == json!(ben.handle)).expect("a friend with a camp").clone();
  assert_eq!(bens["camp"], camp, "the camp to fight is the one on the profile");
  assert_eq!((bens["raidedToday"].as_bool(), bens["name"].as_str()), (Some(false), Some(ben.handle.as_str())));
  // A handle as it might be typed, and more stars than a raid can win: neither leaves the app like that.
  let raided = server.ok(Method::POST, "/v1/raids", &ana, Some(raid_body(&format!(" @{}", ben.handle.to_uppercase()), 7))).await;
  let raid_id = raided["raid"]["id"].as_str().expect("an id").to_string();
  let (status, again) = server.send(Method::POST, "/v1/raids", &[], Some(&ana.token), Some(raid_body(&ben.handle, 1))).await;
  assert_eq!(status, 429, "once a day: {again}");
  let on_ben = list_or_none(Some(server.ok(Method::GET, "/v1/raids", &ben, None).await), "raids");
  assert_eq!(on_ben["raids"].as_array().map(Vec::len), Some(1));
  let raid = &on_ben["raids"][0];
  assert_eq!((raid["id"].as_str(), raid["by"].as_str(), raid["name"].as_str(), raid["stars"].as_i64()), (Some(raid_id.as_str()), Some(ana.handle.as_str()), Some(ana.handle.as_str()), Some(3)));
  assert!(chrono::DateTime::parse_from_rfc3339(raid["at"].as_str().expect("a time")).is_ok());
  assert_eq!(raid.as_object().map(|fields| fields.len()), Some(5), "and nothing else: {raid}");
  // Marked seen with the ids as the app cleans them; what is not an id never reaches the server.
  server.ok(Method::POST, "/v1/raids/ack", &ben, Some(json!({ "ids": raid_ids(&[raid_id.to_uppercase(), "not-an-id".to_string()]) }))).await;
  assert_eq!(server.ok(Method::GET, "/v1/raids", &ben, None).await["raids"], json!([]));
  // The switch, as the app sends it and reads the answer.
  let off = server.save_profile(&ben, &cloud::ProfileUpdate { raidable: Some(false), ..cloud::ProfileUpdate::default() }).await;
  assert_eq!(raidable_saved(&off, false), Ok(()));
  let bens_own: cloud::Profile = serde_json::from_value(server.ok(Method::GET, "/v1/profile/me", &ben, None).await).expect("a profile");
  assert!(!bens_own.raidable && mine.raidable, "off for Ben, and on for a reader who never touched it");
  let hidden = server.ok(Method::GET, "/v1/raids/targets", &ana, None).await;
  assert!(hidden["targets"].as_array().expect("targets").iter().all(|target| target["handle"] != json!(ben.handle)), "switched off, Ben is on nobody's list");
  let on = server.save_profile(&ben, &cloud::ProfileUpdate { raidable: Some(true), ..cloud::ProfileUpdate::default() }).await;
  assert_eq!(raidable_saved(&on, true), Ok(()));

  // The inbox names the new kinds the app has words for.
  let inbox = server.ok(Method::GET, "/v1/inbox", &ben, None).await;
  let kinds: Vec<&str> = inbox["events"].as_array().expect("events").iter().filter_map(|event| event["type"].as_str()).collect();
  assert!(kinds.contains(&"gift") && kinds.contains(&"follow"), "{kinds:?}");

  // The answers themselves, for checking the app's TypeScript types against by eye.
  if let Ok(path) = std::env::var("LEAFLET_E2E_DUMP") {
    let seen = json!({
      "profile": open, "lockedProfile": locked, "library": theirs, "among": among, "feed": feed, "post": posted, "discover": discover,
      "bookPosts": about, "community": started, "threads": listed, "thread": server.must(&ben, "thread", json!({ "id": thread })).await,
      "reply": reply, "reports": queue, "clubs": clubs, "gifts": waiting, "duels": duels, "inbox": inbox,
      "raidTargets": targets, "raids": on_ben,
      "communities": server.must(&ana, "communities", json!({ "mine": true })).await,
      "requests": requests, "blocks": server.must(&ben, "blocks", Value::Null).await
    });
    std::fs::write(path, serde_json::to_string_pretty(&seen).expect("JSON")).expect("the dump is written");
  }
}
