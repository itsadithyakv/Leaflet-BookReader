//! The reader's public profile and the numbers the board ranks on.

use super::*;

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
    ..cloud::ProfileUpdate::default()
  })
}

/// Pushes the ranked numbers. Resolves `true` when something was published.
///
/// After a sync it never fails the sync: a leaderboard that is briefly stale
/// matters far less than reading position that did not save.
pub(crate) async fn publish_profile(state: &State<'_, AppState>) -> Result<bool, String> {
  let update = {
    let db = state.db.guard();
    // Only for readers who chose to be seen; a private profile publishes nothing.
    let visibility = db
      .get_setting(cloud::PROFILE_VISIBILITY_SETTING)
      .map_err(|e| e.to_string())?
      .unwrap_or_default();
    if visibility != "public" {
      return Ok(false);
    }
    build_profile_update(&db, &local_today())?
  };
  cloud::put_profile(&state.db, &update).await.map(|_| true).map_err(|e| e.to_string())
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

#[tauri::command]
pub async fn social_profile(state: State<'_, AppState>) -> Result<cloud::Profile, String> {
  cloud::get_profile(&state.db).await.map_err(|e| e.to_string())
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
  }

  cloud::put_profile(&state.db, &update).await.map_err(|e| e.to_string())?;

  if let Some(value) = visibility {
    let db = state.db.guard();
    db.set_setting(cloud::PROFILE_VISIBILITY_SETTING, &value)
      .map_err(|e| e.to_string())?;
  }

  cloud::get_profile(&state.db).await.map_err(|e| e.to_string())
}
