//! Habit: the daily ledger, the streak, focus sessions and the shelf.

use super::*;

// ---------------------------------------------------------------------------
// Habit: the daily ledger, the streak, and the shelf.
//
// Every command takes the caller's *local* `date_key`. The old streak computed
// `Utc::now()` here and disagreed with the UI by a day near midnight.
// ---------------------------------------------------------------------------

pub(crate) const GOAL_SETTING: &str = "habit_goal_minutes";
pub(crate) const STREAK_SETTING: &str = "habit_streak_state";
pub(crate) const DEFAULT_GOAL_MINUTES: i64 = 20;
/// The smallest daily goal. A one-minute goal made every day a goal day, and
/// goal days pay seeds.
pub(crate) const MIN_GOAL_MINUTES: i64 = 5;
/// Set once the old, pre-database habit data has been imported.
pub(crate) const LEGACY_IMPORTED_SETTING: &str = "habit_legacy_imported";

pub(crate) fn read_goal(db: &db::Database) -> i64 {
  db.get_setting(GOAL_SETTING)
    .ok()
    .flatten()
    .and_then(|value| value.parse::<i64>().ok())
    .filter(|minutes| *minutes > 0)
    .unwrap_or(DEFAULT_GOAL_MINUTES)
}

pub(crate) fn read_streak_state(db: &db::Database) -> habit::StreakState {
  db.get_setting(STREAK_SETTING)
    .ok()
    .flatten()
    .and_then(|value| serde_json::from_str(&value).ok())
    .unwrap_or_default()
}

pub(crate) fn write_streak_state(db: &db::Database, state: &habit::StreakState) -> Result<(), String> {
  let encoded = serde_json::to_string(state).map_err(|e| e.to_string())?;
  db.set_setting(STREAK_SETTING, &encoded).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitSnapshot {
  pub streak: i64,
  pub longest_streak: i64,
  pub freezes: i64,
  pub grace_available: bool,
  pub goal_minutes: i64,
  pub today_minutes: f64,
  pub today_met: bool,
  pub days: Vec<habit::DayRecord>,
  pub sessions: Vec<FocusSessionRecord>,
  pub shelf_count: i64,
  pub peak_shelf: i64,
  /// Set on the evaluation that detects a break, so the UI can explain it once.
  pub broke_from: Option<i64>,
  /// Ids burned by *this* evaluation. Empty on every later call, so replaying
  /// the snapshot cannot replay the fire.
  pub just_burned: Vec<String>,
  /// Every seed ever earned (see `habit::seeds`). The wrap-up shows the
  /// difference a session made; the balance is on `pip_wallet`.
  pub seeds_earned: i64,
  /// All the water reading has poured on Pip's garden, and how many plants
  /// are ripe to pick: the wrap-up's "+N water, 2 plants ripe!".
  pub garden_water: f64,
  pub garden_ripe: i64
}

pub(crate) fn build_snapshot(db: &db::Database, today_key: &str) -> Result<HabitSnapshot, String> {
  let goal_minutes = read_goal(db);
  let previous = read_streak_state(db);
  let days = db.reading_days().map_err(|e| e.to_string())?;

  let evaluation = habit::evaluate(&days, today_key, &previous);

  // Persist the covers the walk decided to spend, so the same gap is never
  // charged twice.
  for (date_key, kind) in &evaluation.covers {
    db.apply_cover(date_key, *kind, goal_minutes)
      .map_err(|e| e.to_string())?;
  }

  let mut state = evaluation.state.clone();
  let mut just_burned = Vec::new();
  if evaluation.burn_count > 0 {
    just_burned = db
      .burn_recent_sessions(evaluation.burn_count, &db::now_iso())
      .map_err(|e| e.to_string())?;
  }

  let shelf_count = db.unburned_session_count().map_err(|e| e.to_string())?;
  state.peak_shelf = state.peak_shelf.max(shelf_count);
  write_streak_state(db, &state)?;

  let day_map = db.reading_days().map_err(|e| e.to_string())?;
  let sessions = db.focus_sessions().map_err(|e| e.to_string())?;
  let (garden, seeds_earned) = garden_totals(db, &day_map, &sessions)?;
  let mut day_list: Vec<habit::DayRecord> = day_map.into_values().collect();
  day_list.sort_by(|a, b| a.date_key.cmp(&b.date_key));

  Ok(HabitSnapshot {
    streak: evaluation.streak,
    longest_streak: state.longest_streak,
    freezes: state.freezes,
    grace_available: state.grace_available,
    goal_minutes,
    today_minutes: evaluation.today_minutes,
    today_met: evaluation.today_met,
    days: day_list,
    sessions,
    shelf_count,
    peak_shelf: state.peak_shelf,
    broke_from: evaluation.broke_from,
    just_burned,
    seeds_earned,
    garden_water: garden.water,
    garden_ripe: garden.ripe_count()
  })
}

/// Evaluates the streak and returns everything the habit UI needs. Lazy by
/// design: the app may be closed for days, so a break is discovered on open
/// rather than by a timer that was never running.
#[tauri::command]
pub fn habit_snapshot(today_key: String, state: State<'_, AppState>) -> Result<HabitSnapshot, String> {
  let db = state.db.guard();
  build_snapshot(&db, &today_key)
}

/// Adds reading time to today and re-evaluates. Called by the reader heartbeat.
#[tauri::command]
pub fn credit_reading_minutes(
  date_key: String,
  minutes: f64,
  state: State<'_, AppState>
) -> Result<HabitSnapshot, String> {
  let db = state.db.guard();
  if minutes > 0.0 {
    match creditable(&db, &date_key, minutes) {
      Ok(minutes) => {
        let goal = read_goal(&db);
        db.credit_minutes(&date_key, minutes, goal)
          .map_err(|e| e.to_string())?;
      }
      Err(reason) => crate::diag::warn(&format!("reading minutes not credited to {date_key}: {reason}"))
    }
  }
  build_snapshot(&db, &date_key)
}

/// The most the heartbeat can honestly report in one call: it flushes about
/// once a minute, and a little more after the window was busy.
pub(crate) const MAX_MINUTES_PER_CREDIT: f64 = 15.0;

/// Whether reading minutes may be credited to `date_key`, and how many.
///
/// Minutes are the seed economy's input, so they are credited only to the
/// reader's today (a day either side, for time zones and midnight), never
/// before the garden began, never to a day earlier than the latest one
/// already read, and never beyond what a call or a day can hold. Setting the
/// clock back used to open old days to credit under the old, richer rules.
pub(crate) fn creditable(db: &db::Database, date_key: &str, minutes: f64) -> Result<f64, &'static str> {
  let day = chrono::NaiveDate::parse_from_str(date_key, "%Y-%m-%d").map_err(|_| "not a date")?;
  let today = chrono::Local::now().date_naive();
  if (day - today).num_days().abs() > 1 {
    return Err("not today");
  }
  if date_key < habit::seeds::GARDEN_SINCE {
    return Err("before the garden began; the clock is likely wrong");
  }
  let latest = db.latest_reading_day().ok().flatten();
  if let Some(latest) = latest.as_deref().and_then(|key| chrono::NaiveDate::parse_from_str(key, "%Y-%m-%d").ok()) {
    if (latest - day).num_days() > 1 {
      return Err("earlier than reading already recorded; the clock went back");
    }
  }
  Ok(minutes.min(MAX_MINUTES_PER_CREDIT))
}

#[tauri::command]
pub fn set_habit_goal(minutes: i64, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.guard();
  db.set_setting(GOAL_SETTING, &minutes.clamp(MIN_GOAL_MINUTES, 600).to_string())
    .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSessionInput {
  pub id: String,
  pub started_at: String,
  pub ended_at: String,
  pub date_key: String,
  pub minutes: f64,
  pub book_id: Option<String>,
  pub title: Option<String>,
  pub ended_reason: String,
  pub clean: bool,
  #[serde(default)]
  pub flower: Option<String>,
  #[serde(default)]
  pub flower_bloomed: bool
}

/// A flower's name as the shelf stores it: a short lowercase word, or none.
fn flower_name(flower: Option<String>) -> Option<String> {
  flower.filter(|name| !name.is_empty() && name.len() <= 24 && name.chars().all(|c| c.is_ascii_lowercase()))
}

/// Records that a focus session happened. Note this does *not* credit minutes:
/// the reader heartbeat is the only source of ledger time, so a timer you
/// started but did not read through earns nothing.
#[tauri::command]
pub fn record_focus_session(
  session: FocusSessionInput,
  state: State<'_, AppState>
) -> Result<HabitSnapshot, String> {
  let db = state.db.guard();
  let flower = flower_name(session.flower);
  let record = FocusSessionRecord {
    // The seed drives every shelf decoration, replacing the stored style blob.
    style_seed: session.id.clone(),
    id: session.id,
    started_at: session.started_at,
    ended_at: session.ended_at,
    date_key: session.date_key.clone(),
    minutes: session.minutes.max(0.0),
    book_id: session.book_id,
    title: session.title,
    notes: None,
    ended_reason: session.ended_reason,
    clean: session.clean,
    burned_at: None,
    flower_bloomed: session.flower_bloomed && flower.is_some(),
    flower
  };
  let is_new = !db.focus_session_exists(&record.id).map_err(|e| e.to_string())?;
  db.insert_focus_session(&record).map_err(|e| e.to_string())?;
  // Reading cheers Pip up. Once per session (a retried call is not a second
  // session), and not for a mis-tapped timer.
  if is_new && record.minutes >= 1.0 {
    cheer_pip(&db, habit::seeds::MOOD_PER_SESSION)?;
  }
  build_snapshot(&db, &session.date_key)
}

#[tauri::command]
pub fn add_focus_note(id: String, notes: String, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.guard();
  db.add_session_note(&id, &notes).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyHabitImport {
  pub goal_minutes: Option<i64>,
  pub days: Vec<habit::DayRecord>,
  pub sessions: Vec<FocusSessionInput>
}

/// One-time move of the old `leaflet.habit` localStorage blob into the database.
/// Idempotent: days are credited only when absent and sessions conflict on id.
#[tauri::command]
pub fn import_legacy_habit(
  payload: LegacyHabitImport,
  today_key: String,
  state: State<'_, AppState>
) -> Result<HabitSnapshot, String> {
  let db = state.db.guard();
  // Once only: it writes days straight into the ledger, which pays seeds.
  if db.get_setting(LEGACY_IMPORTED_SETTING).ok().flatten().is_some() {
    return build_snapshot(&db, &today_key);
  }
  let _ = db.set_setting(LEGACY_IMPORTED_SETTING, &db::now_iso());

  if let Some(goal) = payload.goal_minutes.filter(|value| *value > 0) {
    let _ = db.set_setting(GOAL_SETTING, &goal.clamp(MIN_GOAL_MINUTES, 600).to_string());
  }
  let goal = read_goal(&db);

  let existing = db.reading_days().map_err(|e| e.to_string())?;
  for day in payload.days {
    if existing.contains_key(&day.date_key) {
      continue;
    }
    let day_goal = if day.goal_minutes > 0 { day.goal_minutes } else { goal };
    db.credit_minutes(&day.date_key, day.minutes, day_goal)
      .map_err(|e| e.to_string())?;
  }

  for session in payload.sessions {
    let record = FocusSessionRecord {
      style_seed: session.id.clone(),
      id: session.id,
      started_at: session.started_at,
      ended_at: session.ended_at,
      date_key: session.date_key,
      minutes: session.minutes.max(0.0),
      book_id: session.book_id,
      title: session.title,
      notes: None,
      ended_reason: session.ended_reason,
      clean: session.clean,
      burned_at: None,
      flower: None,
      flower_bloomed: false
    };
    db.insert_focus_session(&record).map_err(|e| e.to_string())?;
  }

  build_snapshot(&db, &today_key)
}
