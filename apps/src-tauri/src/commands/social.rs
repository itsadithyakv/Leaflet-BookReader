//! The reader's public profile and the numbers the board ranks on.

use super::*;
use std::sync::atomic::{AtomicBool, Ordering};

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

/// When a book counts as finished. The last page often reports 0.99x rather
/// than 1, so "finished" is anything from here on. The same number is
/// `FINISHED_AT` in `apps/src/constants/books.ts`; keep the two equal, or a
/// reader's own stats and their public card disagree.
pub(crate) const FINISHED_AT: f32 = 0.99;

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

  let books_finished = db
    .list_books()
    .map_err(|e| e.to_string())?
    .iter()
    .filter(|book| book.progress >= FINISHED_AT)
    .count() as i64;

  // The most recent books still on the shelf -- a burned one is not something
  // to show off.
  let mut shelf: Vec<&FocusSessionRecord> = snapshot
    .sessions
    .iter()
    .filter(|session| session.burned_at.is_none())
    .collect();
  shelf.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));

  Ok(cloud::ProfileUpdate {
    week_key: Some(iso_week_key(today_key)),
    week_minutes: Some(week_minutes),
    streak: Some(snapshot.streak),
    books_finished: Some(books_finished),
    shelf: Some(
      shelf
        .into_iter()
        .take(12)
        .map(|session| cloud::ShelfBook {
          title: session.title.clone().unwrap_or_else(|| "Untitled".to_string()),
          author: None,
          style_seed: session.style_seed.clone()
        })
        .collect()
    ),
    read_day: read_day(&snapshot.days, today_key),
    ..cloud::ProfileUpdate::default()
  })
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
  Ok(true)
}

/// Whether the server's answer to a profile save says the profile is private.
/// Only its own word for it counts: an answer that does not say is not "private".
pub(crate) fn server_says_private(saved: &serde_json::Value) -> bool {
  saved.get("visibility").and_then(|value| value.as_str()) == Some("private")
}

/// Set once the server has said, this run, whether the profile is shared.
static VISIBILITY_CONFIRMED: AtomicBool = AtomicBool::new(false);

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
  Ok(profile)
}

/// Saves the parts of a profile the reader controls, and publishes the ranked
/// numbers alongside so the board is never a week behind the switch.
#[tauri::command]
pub async fn save_social_profile(
  handle: Option<String>,
  display_name: Option<String>,
  visibility: Option<String>,
  state: State<'_, AppState>
) -> Result<cloud::Profile, String> {
  let going_public = visibility.as_deref() == Some("public");
  // Handles are shown with an "@" and stored without one.
  let handle = handle.map(|value| bare_handle(&value));

  let mut update = cloud::ProfileUpdate {
    handle,
    display_name,
    visibility: visibility.clone(),
    ..cloud::ProfileUpdate::default()
  };

  if going_public {
    let db = state.db.guard();
    let stats = build_profile_update(&db, &local_today())?;
    update.week_key = stats.week_key;
    update.week_minutes = stats.week_minutes;
    update.streak = stats.streak;
    update.books_finished = stats.books_finished;
    update.shelf = stats.shelf;
    update.read_day = stats.read_day;
  }

  cloud::put_profile(&state.db, &update).await.map_err(|e| e.to_string())?;

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
    assert!(update.shelf.expect("shelf").is_empty(), "the shelf is sessions only");
    // Read on the day itself: that day is published, for a friend's Pip to visit on.
    assert_eq!(update.read_day.as_deref(), Some("2026-10-03"));
    // Nothing a reader did not choose to change rides along.
    assert!(update.visibility.is_none() && update.handle.is_none() && update.display_name.is_none());
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
