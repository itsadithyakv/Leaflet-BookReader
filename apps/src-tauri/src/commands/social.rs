//! The reader's public profile and the numbers the board ranks on.

use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

// ---- social ----------------------------------------------------------------


/// The local dates of the ISO week containing `today`.
///
/// Minutes are ranked by week, and a reader's ledger is keyed to their *local*
/// day, so the window has to be computed from local dates rather than asked of
/// the server.
pub(crate) fn current_week_days(today_key: &str) -> Vec<String> {
  let Ok(today) = chrono::NaiveDate::parse_from_str(today_key, "%Y-%m-%d") else {
    return vec![today_key.to_string()];
  };
  // Monday, per ISO.
  let offset = chrono::Datelike::weekday(&today).num_days_from_monday() as i64;
  let monday = today - chrono::Duration::days(offset);
  (0..7)
    .map(|day| (monday + chrono::Duration::days(day)).format("%Y-%m-%d").to_string())
    .collect()
}

/// Whether a book has been finished: it has a finished date (`finished_at`,
/// which stays through a second reading), or it is at its end now. The page
/// counts the same way (`hasFinished` in `apps/src/constants/books.ts`), so a
/// reader's own stats and their public card agree.
pub(crate) fn has_finished(book: &BookRecord) -> bool {
  book.finished_at.as_deref().is_some_and(|at| !at.is_empty()) || book.progress >= db::FINISHED_AT
}

/// Builds what this reader publishes: the numbers the board ranks on, and the
/// shelf worth showing.
///
/// Derived here rather than on the server, which by design cannot read inside
/// the state document.
pub(crate) fn build_profile_update(db: &db::Database, today_key: &str) -> Result<cloud::ProfileUpdate, String> {
  let snapshot = build_snapshot(db, today_key)?;

  let week = current_week_days(today_key);
  let week_minutes: f64 = snapshot
    .days
    .iter()
    .filter(|day| week.contains(&day.date_key))
    .map(|day| day.minutes)
    .sum();

  let books = db.list_books().map_err(|e| e.to_string())?;
  // What the profile shows off: the level, the badges, the arcade's bests
  // and Pip's camp.
  let extras = social_extras(db, today_key)?;
  let books_finished = books
    .iter()
    .filter(|book| has_finished(book))
    .count() as i64
    // And those finished and since removed from the library.
    + db.finished_and_removed().map_err(|e| e.to_string())?.len() as i64;

  let shelf = shared_shelf(&snapshot.sessions, &snapshot.free_reads);

  Ok(cloud::ProfileUpdate {
    week_key: Some(iso_week_key(today_key)),
    week_minutes: Some(week_minutes),
    streak: Some(snapshot.streak),
    books_finished: Some(books_finished),
    shelf: Some(shelf),
    read_day: read_day(&snapshot.days, today_key),
    // The book open now, or JSON null for none: sent every time, so a book
    // finished or put down stops being "reading".
    reading: Some(reading_now(&books, chrono::Utc::now()).unwrap_or(serde_json::Value::Null)),
    level: Some(extras.level),
    badges: Some(extras.badges),
    arcade: Some(serde_json::json!({ "dash": extras.arcade.0, "catch": extras.arcade.1, "flap": extras.arcade.2 })),
    // The camp's levels, counts and layout, or JSON null for none (or one
    // that cannot be read): sent every time, so a profile that had one loses it.
    camp: Some(extras.camp.unwrap_or(serde_json::Value::Null)),
    ..cloud::ProfileUpdate::default()
  })
}

/// How many books the shelf others see holds.
pub(crate) const SHARED_SHELF: usize = 12;

/// The shelf other readers see: the latest reading, newest first, each named
/// after its book. Focus sessions and, a day at a time, reading outside one
/// (it used to be sessions only, so a reader who never starts a timer showed
/// an empty shelf). The snapshot has named them (`ReadNames`); reading no
/// book can be named for is left off, where it used to stand as "Untitled".
/// A burned session is not something to show off.
pub(crate) fn shared_shelf(sessions: &[FocusSessionRecord], free_reads: &[habit::FreeRead]) -> Vec<cloud::ShelfBook> {
  let named = |title: &Option<String>| title.as_deref().map(str::trim).filter(|title| !title.is_empty()).map(str::to_string);
  // The day it stands under, whether it is the day's loose pages (which
  // stand after that day's sessions), when it ended, and the book.
  let mut shelf: Vec<(&str, bool, &str, cloud::ShelfBook)> = Vec::new();
  for session in sessions.iter().filter(|session| session.burned_at.is_none()) {
    if let Some(title) = named(&session.title) {
      let book = cloud::ShelfBook { title, author: None, style_seed: session.style_seed.clone() };
      shelf.push((session.date_key.as_str(), false, session.ended_at.as_str(), book));
    }
  }
  for free in free_reads {
    if let Some(title) = named(&free.title) {
      let book = cloud::ShelfBook { title, author: None, style_seed: format!("free-{}", free.date_key) };
      shelf.push((free.date_key.as_str(), true, "", book));
    }
  }
  shelf.sort_by(|a, b| (b.0, b.1, b.2).cmp(&(a.0, a.1, a.2)));
  shelf.into_iter().take(SHARED_SHELF).map(|(_, _, _, book)| book).collect()
}

/// A day counts as read from this many minutes on its ledger. The same number
/// is `READ_TODAY_MINUTES` in `apps/src/pip/visitors.ts`: what a reader
/// publishes as "read today" is what lets their own Pip have visitors.
pub(crate) const READ_DAY_MINUTES: f64 = 1.0;

/// Today's date when today has been read on, for a friend's Pip to visit
/// "on a day you both read"; nothing on a day with no reading yet, which
/// leaves the last day published standing (and that day is not today).
pub(crate) fn read_day(days: &[habit::DayRecord], today_key: &str) -> Option<String> {
  days
    .iter()
    .any(|day| day.date_key == today_key && day.minutes >= READ_DAY_MINUTES)
    .then(|| today_key.to_string())
}

/// Pushes the ranked numbers. Resolves `true` when something was published.
///
/// After a sync it never fails the sync: a leaderboard that is briefly stale
/// matters far less than reading position that did not save.
pub(crate) async fn publish_profile(state: &State<'_, AppState>) -> Result<bool, String> {
  // Only from a library that is the account's own: another account's
  // library on this device never goes on this one's board.
  if !library_may_publish(state).await {
    return Ok(false);
  }
  // Only for readers who chose to be seen; a private profile publishes nothing.
  //
  // Whether they chose is the server's to say. This used to go by a setting
  // written only when the profile was shared *on this device*, so a reader who
  // shared on another computer, or reinstalled, showed as "Shared" here while
  // nothing was ever published: their row froze and left the board with the
  // week. The server is asked once a run (and after every sign-in); between
  // times the remembered answer stands.
  let known = {
    let db = state.db.guard();
    cloud::known_visibility(&db)
  };
  let asked = if known.is_none() || !VISIBILITY_CONFIRMED.load(Ordering::Relaxed) {
    let answer = cloud::get_profile(&state.db).await;
    if let Ok(profile) = &answer {
      let db = state.db.guard();
      cloud::remember_visibility(&db, &profile.visibility);
      VISIBILITY_CONFIRMED.store(true, Ordering::Relaxed);
    }
    Some(answer.map(|profile| profile.visibility == "public").map_err(|e| e.to_string()))
  } else {
    None
  };
  if !shared_now(known, asked)? {
    return Ok(false);
  }
  let update = {
    let db = state.db.guard();
    build_profile_update(&db, &local_today())?
  };
  let saved = cloud::put_profile(&state.db, &update).await.map_err(|e| e.to_string())?;
  // The answer is the profile as the server now has it. If it says private,
  // the profile was un-shared somewhere else since this run last asked (on
  // another computer, say), and until the app was restarted every publish
  // kept sending a private reader's minutes. Nothing is published, and the
  // next time round the server is asked again before anything is sent.
  if server_says_private(&saved) {
    VISIBILITY_CONFIRMED.store(false, Ordering::Relaxed);
    return Ok(false);
  }
  // The library, where it is shared and has changed. The figures above went
  // through whatever happens to it: a list that will not send is not a
  // reason to say the week's minutes did not.
  if let Err(error) = publish_library(state).await {
    crate::diag::warn(&format!("the shared library was not sent: {error}"));
  }
  *LAST_PUBLISHED.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Instant::now());
  Ok(true)
}

/// Whether this library's figures, shelf and books may be published for the
/// account signed in (`owner::may_publish`). A library nobody has claimed is
/// claimed here, as the first sync would. Signed in on a device that has not
/// heard who, the server is asked first.
pub(crate) async fn library_may_publish(state: &State<'_, AppState>) -> bool {
  let unknown = {
    let db = state.db.guard();
    cloud::signed_in(&db) && cloud::signed_in_account_id(&db).is_none()
  };
  if unknown {
    let _ = cloud::status(&state.db, true).await;
  }
  let db = state.db.guard();
  if let Some(tag) = crate::sync::owner::signed_in_tag(&db) {
    let _ = crate::sync::owner::claim_if_unowned(&db, &tag);
  }
  crate::sync::owner::may_publish(crate::sync::owner::standing(&db))
}

/// When the figures were last published, this run.
static LAST_PUBLISHED: Mutex<Option<Instant>> = Mutex::new(None);

/// How long after a publish the one that follows a sync is left out: what
/// the app waits between the publishes it makes of its own accord
/// (`PUBLISH_EVERY_MS` in `apps/src/services/socialService.ts`).
const PUBLISH_EVERY: Duration = Duration::from_secs(5 * 60);

/// Whether a publish that nobody asked for is due: none yet this run, or the
/// last one long enough ago.
pub(crate) fn publish_due(last: Option<Instant>, now: Instant) -> bool {
  last.is_none_or(|at| now.saturating_duration_since(at) >= PUBLISH_EVERY)
}

/// The publish at the end of a sync, when one is due.
///
/// A sync used to end with a publish every time, whatever had just been
/// sent: the app publishes on a clock of its own and when a session ends,
/// and a sync follows every book closed and every line marked, so the same
/// figures went up twice within seconds (at launch, and at the end of every
/// session), and once for each highlight while a reader marked a page. It
/// now waits its turn like the app's own. Nothing needs it sooner: the end
/// of a session is published by the app, at once; and what a sync brings
/// from another device goes up with the next publish, minutes later at most.
///
/// A reader this run has not yet asked the server about is always let
/// through: that first publish is also what learns whether they share.
pub(crate) async fn publish_profile_after_sync(state: &State<'_, AppState>) -> Result<bool, String> {
  let known = {
    let db = state.db.guard();
    cloud::known_visibility(&db)
  };
  let last = *LAST_PUBLISHED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  if known.is_some() && VISIBILITY_CONFIRMED.load(Ordering::Relaxed) && !publish_due(last, Instant::now()) {
    return Ok(false);
  }
  publish_profile(state).await
}

/// Whether the server's answer to a profile save says the profile is private.
/// Only its own word for it counts: an answer that does not say is not "private".
pub(crate) fn server_says_private(saved: &serde_json::Value) -> bool {
  saved.get("visibility").and_then(|value| value.as_str()) == Some("private")
}

/// Set once the server has said, this run, whether the profile is shared.
static VISIBILITY_CONFIRMED: AtomicBool = AtomicBool::new(false);

/// Forgets what this run learnt about publishing, for another library opened
/// (`libraries::switch`): its first publish asks the server again, like a launch.
pub(crate) fn forget_run_state() {
  *LAST_PUBLISHED.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
  VISIBILITY_CONFIRMED.store(false, Ordering::Relaxed);
}

/// Whether to publish: the server's word when it was asked and answered, else
/// what this device remembers. With neither there is nothing to go on, and
/// the failure is passed up rather than read as "private" (which is how a
/// shared reader went quietly missing from the board).
pub(crate) fn shared_now(known: Option<bool>, asked: Option<Result<bool, String>>) -> Result<bool, String> {
  match (asked, known) {
    (Some(Ok(shared)), _) => Ok(shared),
    (Some(Err(_)), Some(shared)) | (None, Some(shared)) => Ok(shared),
    (Some(Err(error)), None) => Err(error),
    (None, None) => Ok(false)
  }
}

/// Publishes this week's minutes, streak and shelf for a public profile.
///
/// This used to happen only at the end of a backup, and a backup needs Drive:
/// a public reader without Drive stayed frozen on the board at whatever they
/// had when they went public, and their duels with them. The app now calls
/// this when a session ends, when the Social page opens and when the window
/// comes back. Signed out or private, it does nothing.
#[tauri::command]
pub async fn publish_social_stats(state: State<'_, AppState>) -> Result<bool, String> {
  let signed_in = {
    let db = state.db.guard();
    crate::sync::cloud::signed_in(&db)
  };
  if !signed_in {
    return Ok(false);
  }
  publish_profile(&state).await
}

pub(crate) fn iso_week_key(today_key: &str) -> String {
  cloud::iso_week_key(today_key)
}

/// The device's own date. Every habit figure is keyed to it.
pub(crate) fn local_today() -> String {
  chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Points the app at a Leaflet server. Empty turns cloud sync and social off.
#[tauri::command]
pub fn set_cloud_api(url: String, state: State<'_, AppState>) -> Result<SyncStatus, String> {
  let db = state.db.guard();
  cloud::set_api_base(&db, &url).map_err(|e| e.to_string())?;
  read_sync_status(&db)
}

/// Whether the server can be reached right now; the error says why not.
#[tauri::command]
pub async fn cloud_reachable(state: State<'_, AppState>) -> Result<(), String> {
  cloud::check_reachable(&state.db).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn social_profile(state: State<'_, AppState>) -> Result<cloud::Profile, String> {
  let profile = cloud::get_profile(&state.db).await.map_err(|e| e.to_string())?;
  // What the server says about sharing is what publishing goes by.
  let db = state.db.guard();
  cloud::remember_visibility(&db, &profile.visibility);
  // Whether the library is shared, too (set on another device, perhaps);
  // only when it differs, so what was last sent is not forgotten for nothing.
  if shares_library(&db) != profile.shares_library {
    remember_share_library(&db, profile.shares_library);
  }
  Ok(profile)
}

/// Saves the parts of a profile the reader controls, and publishes the ranked
/// numbers alongside so the board is never a week behind the switch.
#[tauri::command]
pub async fn save_social_profile(
  handle: Option<String>,
  display_name: Option<String>,
  visibility: Option<String>,
  share_library: Option<bool>,
  state: State<'_, AppState>
) -> Result<cloud::Profile, String> {
  // Shared with everyone or kept to followers: either way the figures go up
  // with the switch, so the profile is never a week behind it.
  let going_public = matches!(visibility.as_deref(), Some("public") | Some("followers"));
  // Handles are shown with an "@" and stored without one.
  let handle = handle.map(|value| bare_handle(&value));
  let renamed = display_name.clone();

  let mut update = cloud::ProfileUpdate {
    handle,
    display_name,
    visibility: visibility.clone(),
    share_library,
    ..cloud::ProfileUpdate::default()
  };

  // The figures go only from the account's own library.
  if going_public && library_may_publish(&state).await {
    let db = state.db.guard();
    let stats = build_profile_update(&db, &local_today())?;
    update.week_key = stats.week_key;
    update.week_minutes = stats.week_minutes;
    update.streak = stats.streak;
    update.books_finished = stats.books_finished;
    update.shelf = stats.shelf;
    update.read_day = stats.read_day;
    update.reading = stats.reading;
    update.level = stats.level;
    update.badges = stats.badges;
    update.arcade = stats.arcade;
    update.camp = stats.camp;
  }

  cloud::put_profile(&state.db, &update).await.map_err(|e| e.to_string())?;

  // The library follows its switch at once: sent when it is turned on, taken
  // away when it is turned off or the profile is made private (the server
  // drops it then too; this device must forget that it was sent).
  let now_private = visibility.as_deref() == Some("private");
  if share_library == Some(false) || now_private {
    {
      let db = state.db.guard();
      remember_share_library(&db, false);
    }
    if share_library == Some(false) && !now_private {
      withdraw_library(&state).await?;
    }
  } else if share_library == Some(true) {
    {
      let db = state.db.guard();
      remember_share_library(&db, true);
    }
    publish_library(&state).await?;
  }

  // The account's own copy of the name follows (`cloud::set_display_name`).
  // The save is not failed for it: the profile's is the one readers see.
  if let Some(name) = renamed {
    if let Err(error) = cloud::set_display_name(&state.db, &name).await {
      crate::diag::warn(&format!("the account's name did not follow the profile's: {error}"));
    }
  }

  if let Some(value) = visibility {
    let db = state.db.guard();
    cloud::remember_visibility(&db, &value);
  }

  let profile = cloud::get_profile(&state.db).await.map_err(|e| e.to_string())?;
  let db = state.db.guard();
  cloud::remember_visibility(&db, &profile.visibility);
  // The server has just said whether the profile is shared, so the first
  // publish after this (a new account's, straight after sign-up) does not
  // stop to ask it again.
  VISIBILITY_CONFIRMED.store(true, Ordering::Relaxed);
  Ok(profile)
}

/// A handle as it is stored and sent: trimmed, lower case, and without the
/// "@" it is shown with (which a reader may type or paste).
pub(crate) fn bare_handle(typed: &str) -> String {
  typed.trim().trim_start_matches('@').trim().to_lowercase()
}

#[cfg(test)]
mod tests {
  use super::*;

  /// The publish that follows a sync waits its turn; the first of a run never does.
  #[test]
  fn a_publish_nobody_asked_for_is_due_once_the_last_is_long_enough_ago() {
    let now = Instant::now();
    let ago = |seconds: u64| now.checked_sub(Duration::from_secs(seconds));
    // None yet this run: due. (Where the machine has not been up that long, there is no such moment, and it is due too.)
    assert!(publish_due(None, now));
    // Published seconds ago (the app's own, as a session ended; or the sync before this one): not again.
    assert!(!publish_due(Some(now), now));
    for seconds in [2, 59, 299] {
      if let Some(last) = ago(seconds) {
        assert!(!publish_due(Some(last), now), "{seconds} s ago");
      }
    }
    // The same wait as the app's own publishes, and then it is due.
    for seconds in [300, 301, 3600] {
      if let Some(last) = ago(seconds) {
        assert!(publish_due(Some(last), now), "{seconds} s ago");
      }
    }
    // A clock that reads earlier than the last publish is not a reason to publish, or to panic.
    if let Some(earlier) = ago(10) {
      assert!(!publish_due(Some(now), earlier));
    }
  }

  /// The week the board ranks is the reader's own Monday to Sunday.
  #[test]
  fn the_week_runs_monday_to_sunday_on_the_local_calendar() {
    // 2026-10-03 is a Saturday.
    let week = current_week_days("2026-10-03");
    assert_eq!(week.first().map(String::as_str), Some("2026-09-28"));
    assert_eq!(week.last().map(String::as_str), Some("2026-10-04"));
    assert_eq!(week.len(), 7);
    // A Monday starts its own week; the Sunday before it ends the last one.
    assert_eq!(current_week_days("2026-10-05")[0], "2026-10-05");
    assert_eq!(current_week_days("2026-10-04")[0], "2026-09-28");
    // Every day of it has the same week key, which is the board it is ranked on.
    assert!(week.iter().all(|day| iso_week_key(day) == "2026-W40"));
    assert_eq!(iso_week_key("2026-10-05"), "2026-W41");
  }

  /// A book finished once still counts while it is being read again; one
  /// marked "not started" does not, whatever it was before.
  #[test]
  fn books_finished_counts_dates_as_well_as_books_at_their_end() {
    let db = crate::db::tests::memory_db();
    let add = |id: &str, progress: f32, finished: Option<&str>| {
      let entry = crate::sync::merge::BookEntry::from_record(&BookRecord {
        id: id.to_string(),
        title: id.to_string(),
        author: None,
        genres: Vec::new(),
        cover_url: None,
        local_path: format!("/{id}.epub"),
        file_hash: id.to_string(),
        progress,
        position: None,
        series: None,
        series_index: None,
        last_opened: None,
        created_at: "2026-01-01T00:00:00+00:00".to_string(),
        metadata_checked_at: None,
        metadata_updated_at: None,
        progress_updated_at: None,
        finished_at: finished.map(str::to_string),
        deleted_at: None,
        available: true
      });
      db.upsert_book(&entry.to_record(format!("/{id}.epub"), None)).expect("book");
    };
    add("at-its-end", 1.0, None);
    add("being-read-again", 0.2, Some("2026-03-01T10:00:00+00:00"));
    add("marked-not-started", 0.0, Some(""));
    add("half-way", 0.5, None);
    assert_eq!(build_profile_update(&db, "2026-10-03").expect("update").books_finished, Some(2));

    // Taking a finished book out of the library does not take it out of the count.
    // (One at its end with no date yet is dated as it goes.)
    db.delete_book("at-its-end", "2026-10-02T10:00:00+00:00").expect("remove");
    db.delete_book("being-read-again", "2026-10-02T10:00:00+00:00").expect("remove");
    assert_eq!(build_profile_update(&db, "2026-10-03").expect("update").books_finished, Some(2));
    // One never finished, or marked "not started", leaves nothing behind.
    db.delete_book("half-way", "2026-10-02T10:00:00+00:00").expect("remove");
    db.delete_book("marked-not-started", "2026-10-02T10:00:00+00:00").expect("remove");
    assert_eq!(build_profile_update(&db, "2026-10-03").expect("update").books_finished, Some(2));
    let kept: Vec<String> = db.finished_and_removed().expect("kept").into_iter().map(|book| book.id).collect();
    assert_eq!(kept.len(), 2);
    assert!(kept.contains(&"at-its-end".to_string()) && kept.contains(&"being-read-again".to_string()));
  }

  /// The board is fed by the day ledger, which holds every minute the reading
  /// heartbeat counted, with or without a focus session.
  #[test]
  fn the_published_minutes_are_the_weeks_ledger_sessions_or_not() {
    let db = crate::db::tests::memory_db();
    // Read with no session running, on three days of the week of 2026-10-03...
    db.credit_minutes("2026-09-28", 30.0, 20).expect("monday");
    db.credit_minutes("2026-10-02", 95.5, 20).expect("friday");
    db.credit_minutes("2026-10-03", 12.0, 20).expect("saturday");
    // ...and the Sunday before, which is last week's.
    db.credit_minutes("2026-09-27", 60.0, 20).expect("last sunday");

    let update = build_profile_update(&db, "2026-10-03").expect("update");
    assert_eq!(update.week_key.as_deref(), Some("2026-W40"));
    assert_eq!(update.week_minutes, Some(137.5));
    assert!(update.shelf.expect("shelf").is_empty(), "reading no book can be named for is not on the shelf");
    // Read on the day itself: that day is published, for a friend's Pip to visit on.
    assert_eq!(update.read_day.as_deref(), Some("2026-10-03"));
    // Nothing a reader did not choose to change rides along.
    assert!(update.visibility.is_none() && update.handle.is_none() && update.display_name.is_none());
  }

  /// The shelf others see says which book each stretch of reading was, with
  /// or without a timer, and never "Untitled".
  #[test]
  fn the_shared_shelf_names_every_read_after_its_book() {
    let session = |id: &str, day: &str, ended: &str, title: Option<&str>| FocusSessionRecord {
      id: id.to_string(),
      started_at: ended.to_string(),
      ended_at: ended.to_string(),
      date_key: day.to_string(),
      minutes: 20.0,
      book_id: None,
      title: title.map(str::to_string),
      notes: None,
      ended_reason: "completed".to_string(),
      clean: true,
      style_seed: id.to_string(),
      burned_at: None,
      flower: None,
      flower_bloomed: false
    };
    let free = |day: &str, title: Option<&str>| habit::FreeRead { title: title.map(str::to_string), ..habit::FreeRead::of(day, 30.0) };
    let mut burned = session("burned", "2026-10-03", "2026-10-03T09:00:00+00:00", Some("Ulysses"));
    burned.burned_at = Some("2026-10-04T00:00:00+00:00".to_string());
    let sessions = [
      session("morning", "2026-10-02", "2026-10-02T08:00:00+00:00", Some("Dune")),
      session("evening", "2026-10-02", "2026-10-02T21:00:00+00:00", Some("Emma")),
      session("no-name", "2026-10-03", "2026-10-03T10:00:00+00:00", None),
      session("blank", "2026-10-03", "2026-10-03T11:00:00+00:00", Some("  ")),
      burned
    ];
    let frees = [free("2026-10-01", Some("Dune")), free("2026-10-02", Some("Emma")), free("2026-10-03", None)];
    let shelf = shared_shelf(&sessions, &frees);
    let shown: Vec<(&str, &str)> = shelf.iter().map(|book| (book.title.as_str(), book.style_seed.as_str())).collect();
    // Newest first; a day's loose pages stand after that day's sessions.
    assert_eq!(shown, vec![("Emma", "free-2026-10-02"), ("Emma", "evening"), ("Dune", "morning"), ("Dune", "free-2026-10-01")]);
    assert!(shelf.iter().all(|book| book.title != "Untitled" && book.author.is_none()));

    // Twelve at most, the newest.
    let many: Vec<FocusSessionRecord> = (10..30)
      .map(|day| session(&format!("s{day}"), &format!("2026-09-{day}"), &format!("2026-09-{day}T10:00:00+00:00"), Some("Dune")))
      .collect();
    let shelf = shared_shelf(&many, &[]);
    assert_eq!(shelf.len(), SHARED_SHELF);
    assert_eq!(shelf[0].style_seed, "s29");
  }

  #[test]
  fn publishing_goes_by_the_servers_word_then_by_what_is_remembered() {
    let down = || Some(Err("Could not reach the Leaflet server.".to_string()));
    // The server answered: that is the answer, whatever this device thought.
    assert_eq!(shared_now(None, Some(Ok(true))), Ok(true));
    assert_eq!(shared_now(Some(false), Some(Ok(true))), Ok(true), "shared on another device");
    assert_eq!(shared_now(Some(true), Some(Ok(false))), Ok(false), "made private elsewhere");
    // It could not be reached: what was last heard stands.
    assert_eq!(shared_now(Some(true), down()), Ok(true));
    assert_eq!(shared_now(Some(false), down()), Ok(false));
    // Never heard and cannot ask: an error, not a silent "private".
    assert!(shared_now(None, down()).is_err());
    // Already confirmed this run: no need to ask again.
    assert_eq!(shared_now(Some(true), None), Ok(true));
    assert_eq!(shared_now(Some(false), None), Ok(false));
  }

  /// "Read today" is published only on a day with a minute of reading in it,
  /// and is the device's own date.
  #[test]
  fn the_day_read_is_published_only_once_it_has_been_read_on() {
    let db = crate::db::tests::memory_db();
    db.credit_minutes("2026-10-02", 40.0, 20).expect("yesterday");
    // Nothing read yet today: no day is sent, and nothing else changes.
    let before = build_profile_update(&db, "2026-10-03").expect("update");
    assert_eq!(before.read_day, None);
    assert_eq!(before.week_minutes, Some(40.0));
    assert!(!serde_json::to_string(&before).expect("json").contains("readDay"));
    // A few seconds on the page is not a day read.
    db.credit_minutes("2026-10-03", 0.4, 20).expect("a glance");
    assert_eq!(build_profile_update(&db, "2026-10-03").expect("update").read_day, None);
    db.credit_minutes("2026-10-03", 0.8, 20).expect("a page");
    let after = build_profile_update(&db, "2026-10-03").expect("update");
    assert_eq!(after.read_day.as_deref(), Some("2026-10-03"));
    assert!(serde_json::to_string(&after).expect("json").contains(r#""readDay":"2026-10-03""#));
    // The next morning, before any reading: yesterday is not passed off as today.
    assert_eq!(build_profile_update(&db, "2026-10-04").expect("update").read_day, None);
  }

  /// A publish is answered with the profile as the server has it, which is
  /// how a device learns the profile was made private on another one.
  #[test]
  fn a_publish_hears_that_the_profile_was_made_private() {
    let private = serde_json::json!({ "handle": "adi", "visibility": "private", "weekMinutes": 0 });
    assert!(server_says_private(&private));
    let public = serde_json::json!({ "handle": "adi", "visibility": "public", "weekMinutes": 137 });
    assert!(!server_says_private(&public));
    // An answer that does not say is not taken for "private": that would
    // stop a shared reader's minutes, which is the bug this replaced.
    assert!(!server_says_private(&serde_json::json!({})));
    assert!(!server_says_private(&serde_json::json!({ "visibility": null })));
    assert!(!server_says_private(&serde_json::Value::Null));
  }

  /// The "@" is how a handle is shown, never part of it.
  #[test]
  fn a_handle_is_sent_without_its_at_sign() {
    assert_eq!(bare_handle("@maya_reads"), "maya_reads");
    assert_eq!(bare_handle("  @@Maya_Reads "), "maya_reads");
    assert_eq!(bare_handle("adi"), "adi");
    assert_eq!(bare_handle(""), "");
    let update = cloud::ProfileUpdate { handle: Some(bare_handle("@adi")), ..cloud::ProfileUpdate::default() };
    assert_eq!(serde_json::to_string(&update).expect("json"), r#"{"handle":"adi"}"#);
  }

  /// A name the reader emptied is sent as empty, which the server takes as
  /// "remove it"; a name that was not given is not sent at all.
  #[test]
  fn an_emptied_name_is_sent_and_a_missing_one_is_not() {
    let cleared = cloud::ProfileUpdate { display_name: Some(String::new()), ..cloud::ProfileUpdate::default() };
    assert_eq!(serde_json::to_string(&cleared).expect("json"), r#"{"displayName":""}"#);
    let untouched = cloud::ProfileUpdate { visibility: Some("public".to_string()), ..cloud::ProfileUpdate::default() };
    assert_eq!(serde_json::to_string(&untouched).expect("json"), r#"{"visibility":"public"}"#);
  }
}
