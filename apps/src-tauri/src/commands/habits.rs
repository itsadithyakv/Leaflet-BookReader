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
  /// Each day's reading outside a focus session (see `habit::free_reads`):
  /// worked out from the two lists above, so the shelf can show it too.
  pub free_reads: Vec<habit::FreeRead>,
  pub shelf_count: i64,
  pub peak_shelf: i64,
  /// Set on the evaluation that detects a break, so the UI can explain it once.
  /// A break takes nothing from the shelf (it used to burn the newest books).
  pub broke_from: Option<i64>,
  /// Pip's cold, when a streak worth one has just broken and reading has not
  /// yet nursed her back (see `habit::cold`). Worked out from the ledger
  /// every time, never stored.
  pub cold: Option<habit::Cold>,
  /// Every seed ever earned (see `habit::seeds`). The wrap-up shows the
  /// difference a session made; the balance is on `pip_wallet`.
  pub seeds_earned: i64,
  /// All the water reading has poured on Pip's garden, and how many plants
  /// are ripe to pick: the wrap-up's "+N water, 2 plants ripe!".
  pub garden_water: f64,
  pub garden_ripe: i64
}

/// The local day an instant fell on, as the ledger keys days.
fn local_day(stamp: &str) -> Option<String> {
  chrono::DateTime::parse_from_rfc3339(stamp)
    .ok()
    .map(|at| at.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string())
}

/// The local day a session started on. A session is shelved under the day it
/// ended; the day it started is read from its start time, and one that cannot
/// be read, or reads as later than the end, is taken to be the same day.
pub(crate) fn started_day(session: &FocusSessionRecord) -> String {
  local_day(&session.started_at)
    .filter(|day| day.as_str() <= session.date_key.as_str())
    .unwrap_or_else(|| session.date_key.clone())
}

/// Each day's reading outside a focus session, from the ledger and the shelf.
pub(crate) fn free_reads_from(
  days: &std::collections::HashMap<String, habit::DayRecord>,
  sessions: &[FocusSessionRecord]
) -> Vec<habit::FreeRead> {
  let started: Vec<String> = sessions.iter().map(started_day).collect();
  let spans: Vec<habit::SessionSpan<'_>> = sessions
    .iter()
    .zip(&started)
    .map(|(session, started_day)| habit::SessionSpan {
      date_key: &session.date_key,
      started_day,
      minutes: session.minutes
    })
    .collect();
  habit::free_reads(days, &spans)
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

  // A break burns nothing. Sessions an earlier version burned (or a device
  // still on one burns, and syncs here) keep their tombstone: `shelf_count`
  // is still the spines left standing.
  let mut state = evaluation.state.clone();
  let shelf_count = db.unburned_session_count().map_err(|e| e.to_string())?;
  state.peak_shelf = state.peak_shelf.max(shelf_count);
  write_streak_state(db, &state)?;

  let day_map = db.reading_days().map_err(|e| e.to_string())?;
  let sessions = db.focus_sessions().map_err(|e| e.to_string())?;
  let (garden, seeds_earned) = garden_totals(db, &day_map, &sessions)?;
  let free_reads = free_reads_from(&day_map, &sessions);
  // Read from the ledger as it stands with this walk's covers stamped on it:
  // a miss that grace or a freeze paid for is no break.
  let cold = habit::cold(&day_map, today_key, goal_minutes);
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
    free_reads,
    shelf_count,
    peak_shelf: state.peak_shelf,
    broke_from: evaluation.broke_from,
    cold,
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

/// Adds reading time to a day and re-evaluates. Called by the reader heartbeat,
/// whether or not a focus session is running.
///
/// `date_key` is the day the minutes were read. It is today, except for the
/// last minute of a read that Leaflet was closed in the middle of, which is
/// credited when it next opens: `today_key` is then the day to evaluate the
/// streak on. Evaluating it as of an earlier day would read as a break.
#[tauri::command]
pub fn credit_reading_minutes(
  date_key: String,
  minutes: f64,
  today_key: Option<String>,
  state: State<'_, AppState>
) -> Result<HabitSnapshot, String> {
  let db = state.db.guard();
  credit_reading(&db, &date_key, minutes, today_key.as_deref())
}

pub(crate) fn credit_reading(
  db: &db::Database,
  date_key: &str,
  minutes: f64,
  today_key: Option<&str>
) -> Result<HabitSnapshot, String> {
  if minutes > 0.0 {
    match creditable(db, date_key, minutes) {
      Ok(minutes) => {
        // Which goal the day is judged against is `goal_for_day`'s to say.
        let earlier = today_key.is_some_and(|today| today != date_key);
        let goal = goal_for_day(db, date_key, earlier)?;
        db.credit_minutes(date_key, minutes, goal)
          .map_err(|e| e.to_string())?;
        // Any reading cheers Pip up, in a focus session or not: the minutes
        // the ledger took, out of that day's allowance. A courtesy: the
        // minutes are credited whether or not she could be cheered up.
        if let Err(reason) = cheer_pip_for_reading(db, date_key, minutes) {
          crate::diag::warn(&format!("reading credited to {date_key}, but Pip was not cheered up: {reason}"));
        }
      }
      Err(reason) => crate::diag::warn(&format!("reading minutes not credited to {date_key}: {reason}"))
    }
  }
  build_snapshot(db, today_key.unwrap_or(date_key))
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

/// The goal a day is judged against. Decided here and nowhere else: the
/// ledger stamps a day with whatever it is given.
///
/// * A day that has met the goal it is stamped with keeps that goal. A goal
///   raised afterwards must not unmeet it (the streak would drop by the day
///   and read as broken), and one lowered afterwards changes
///   nothing: a day is met once, and its bonus is worked out from the ledger,
///   so no run of goal changes can pay it twice.
/// * An earlier day (`earlier`: the last minute of a read Leaflet was closed
///   in, credited the next day) keeps the goal it was read against, met or
///   not.
/// * Any other day, which is today short of its goal or not yet read, takes
///   the goal in force now, lower or higher than the one it had.
pub(crate) fn goal_for_day(db: &db::Database, date_key: &str, earlier: bool) -> Result<i64, String> {
  let kept = db
    .reading_days()
    .map_err(|e| e.to_string())?
    .get(date_key)
    .filter(|day| earlier || day.goal_met())
    .map(|day| day.goal_minutes)
    .filter(|goal| *goal > 0);
  Ok(kept.unwrap_or_else(|| read_goal(db)))
}

/// Whether a goal change may re-stamp `today_key`: it is the reader's today
/// (a day either side of this machine's, for time zones and midnight) and no
/// later day has reading on it. An earlier day is never re-stamped: with the
/// clock set back, lowering the goal would meet a day that had missed it.
fn is_reading_today(db: &db::Database, today_key: &str) -> bool {
  let Ok(day) = chrono::NaiveDate::parse_from_str(today_key, "%Y-%m-%d") else {
    return false;
  };
  if (day - chrono::Local::now().date_naive()).num_days().abs() > 1 {
    return false;
  }
  !matches!(db.latest_reading_day(), Ok(Some(latest)) if latest.as_str() > today_key)
}

/// Saves the daily goal. With `today_key` (the caller's local day) the change
/// applies to today at once: today's row, if it has one, is stamped again by
/// `goal_for_day`'s rule, so a goal lowered to what has been read meets today
/// now, not at the next minute credited. The snapshot is today's, evaluated
/// after the change.
#[tauri::command]
pub fn set_habit_goal(
  minutes: i64,
  today_key: Option<String>,
  state: State<'_, AppState>
) -> Result<Option<HabitSnapshot>, String> {
  let db = state.db.guard();
  set_goal(&db, minutes, today_key.as_deref())
}

pub(crate) fn set_goal(
  db: &db::Database,
  minutes: i64,
  today_key: Option<&str>
) -> Result<Option<HabitSnapshot>, String> {
  db.set_setting(GOAL_SETTING, &minutes.clamp(MIN_GOAL_MINUTES, 600).to_string())
    .map_err(|e| e.to_string())?;
  let Some(today) = today_key else {
    return Ok(None);
  };
  let has_row = db.reading_days().map_err(|e| e.to_string())?.contains_key(today);
  if has_row && is_reading_today(db, today) {
    // No minutes: only the stamp changes.
    let goal = goal_for_day(db, today, false)?;
    db.credit_minutes(today, 0.0, goal).map_err(|e| e.to_string())?;
  }
  build_snapshot(db, today).map(Some)
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

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;

  /// Now, and the local days around it: minutes are only credited near today.
  fn clock() -> (chrono::DateTime<chrono::Local>, String, String) {
    let now = chrono::Local::now();
    let day = |offset: i64| (now.date_naive() + chrono::Duration::days(offset)).format("%Y-%m-%d").to_string();
    (now, day(0), day(-1))
  }

  fn session(id: &str, day: &str, at: &chrono::DateTime<chrono::Local>, minutes: f64) -> FocusSessionRecord {
    FocusSessionRecord {
      id: id.to_string(),
      started_at: at.to_rfc3339(),
      ended_at: at.to_rfc3339(),
      date_key: day.to_string(),
      minutes,
      book_id: None,
      title: None,
      notes: None,
      ended_reason: "completed".to_string(),
      clean: true,
      style_seed: id.to_string(),
      burned_at: None,
      flower: None,
      flower_bloomed: false
    }
  }

  #[test]
  fn reading_with_no_session_counts_and_is_listed_as_free_reading() {
    let db = memory_db();
    let (_, today, _) = clock();
    // The heartbeat's flushes over a quarter of an hour, no timer running.
    credit_reading(&db, &today, 10.0, None).expect("first");
    let snapshot = credit_reading(&db, &today, 5.0, None).expect("second");
    assert_eq!(snapshot.today_minutes, 15.0);
    assert!(snapshot.sessions.is_empty(), "no session is made up for it");
    assert_eq!(snapshot.shelf_count, 0);
    assert_eq!(snapshot.free_reads, vec![habit::FreeRead { date_key: today, minutes: 15.0 }]);
  }

  #[test]
  fn a_session_is_not_counted_again_as_free_reading() {
    let db = memory_db();
    let (now, today, _) = clock();
    credit_reading(&db, &today, 12.0, None).expect("in the session");
    db.insert_focus_session(&session("s1", &today, &now, 12.0)).expect("session");
    let only_session = build_snapshot(&db, &today).expect("snapshot");
    assert!(only_session.free_reads.is_empty());

    // Reading on after the timer ran out is free reading.
    let snapshot = credit_reading(&db, &today, 8.0, None).expect("after it");
    assert_eq!(snapshot.today_minutes, 20.0);
    assert_eq!(snapshot.free_reads, vec![habit::FreeRead { date_key: today, minutes: 8.0 }]);
  }

  #[test]
  fn free_reading_meets_the_goal_and_keeps_the_streak_like_a_session() {
    let db = memory_db();
    let (_, today, yesterday) = clock();
    db.credit_minutes(&yesterday, 25.0, 20).expect("yesterday");
    credit_reading(&db, &today, 15.0, None).expect("first");
    let snapshot = credit_reading(&db, &today, 6.0, None).expect("second");
    assert!(snapshot.today_met);
    assert_eq!(snapshot.streak, 2);
    assert_eq!(snapshot.free_reads.len(), 2);
  }

  #[test]
  fn a_minute_left_over_from_yesterday_is_credited_to_yesterday_without_breaking_today() {
    let db = memory_db();
    let (_, today, yesterday) = clock();
    db.credit_minutes(&yesterday, 25.0, 20).expect("yesterday");
    db.credit_minutes(&today, 25.0, 20).expect("today");
    assert_eq!(build_snapshot(&db, &today).expect("snapshot").streak, 2);
    // The goal went up this morning; yesterday was read against the old one.
    db.set_setting(GOAL_SETTING, "60").expect("goal");

    // Leaflet was closed mid-read last night: its last minute arrives now.
    let snapshot = credit_reading(&db, &yesterday, 0.75, Some(&today)).expect("late credit");
    assert_eq!(snapshot.streak, 2, "evaluated as of today, not as of yesterday");
    assert_eq!(snapshot.broke_from, None);
    assert_eq!(snapshot.today_minutes, 25.0);
    let day = snapshot.days.iter().find(|day| day.date_key == yesterday).expect("yesterday");
    assert_eq!(day.minutes, 25.75);
    assert_eq!(day.goal_minutes, 20, "yesterday keeps the goal it was read against");
  }

  #[test]
  fn raising_the_goal_after_meeting_it_does_not_unmeet_today_or_break_the_streak() {
    let db = memory_db();
    let (now, today, yesterday) = clock();
    db.credit_minutes(&yesterday, 25.0, 20).expect("yesterday");
    db.insert_focus_session(&session("s1", &yesterday, &now, 25.0)).expect("session");
    credit_reading(&db, &today, 15.0, Some(&today)).expect("first");
    let met = credit_reading(&db, &today, 6.0, Some(&today)).expect("second");
    assert!(met.today_met);
    assert_eq!(met.streak, 2);

    // The goal goes up for tomorrow, and the reader reads on tonight.
    db.set_setting(GOAL_SETTING, "60").expect("goal");
    let after = credit_reading(&db, &today, 1.0, Some(&today)).expect("reading on");
    assert!(after.today_met, "today met the goal it was read against");
    assert_eq!(after.streak, 2);
    assert_eq!(after.broke_from, None);
    assert_eq!(after.cold, None);
    assert_eq!(after.shelf_count, 1);
    let day = after.days.iter().find(|day| day.date_key == today).expect("today");
    assert_eq!((day.minutes, day.goal_minutes), (22.0, 20));
  }

  #[test]
  fn a_day_still_short_of_its_goal_takes_a_raised_one() {
    let db = memory_db();
    let (_, today, _) = clock();
    credit_reading(&db, &today, 10.0, Some(&today)).expect("first");
    db.set_setting(GOAL_SETTING, "60").expect("goal");
    let snapshot = credit_reading(&db, &today, 12.0, Some(&today)).expect("second");
    assert!(!snapshot.today_met, "22 minutes against the goal now in force");
    let day = snapshot.days.iter().find(|day| day.date_key == today).expect("today");
    assert_eq!(day.goal_minutes, 60);
  }

  fn goal_of(snapshot: &HabitSnapshot, day: &str) -> i64 {
    snapshot.days.iter().find(|record| record.date_key == day).expect("the day").goal_minutes
  }

  #[test]
  fn lowering_the_goal_meets_today_at_once_when_enough_is_read() {
    let db = memory_db();
    let (_, today, yesterday) = clock();
    db.credit_minutes(&yesterday, 25.0, 20).expect("yesterday");
    set_goal(&db, 60, Some(&today)).expect("goal").expect("snapshot");
    credit_reading(&db, &today, 15.0, Some(&today)).expect("first");
    let short = credit_reading(&db, &today, 11.0, Some(&today)).expect("second");
    assert!(!short.today_met, "26 minutes of 60");
    assert_eq!(short.streak, 1);

    // On the change itself, not at the next minute credited.
    let lowered = set_goal(&db, 20, Some(&today)).expect("goal").expect("snapshot");
    assert_eq!(lowered.goal_minutes, 20);
    assert!(lowered.today_met);
    assert_eq!(lowered.today_minutes, 26.0, "no minutes were added");
    assert_eq!(goal_of(&lowered, &today), 20);
    assert_eq!(lowered.streak, 2);
    // The goal day is paid once: its bonus, and day two of a streak.
    assert_eq!(
      lowered.seeds_earned - short.seeds_earned,
      habit::seeds::GOAL_DAY_BONUS + habit::seeds::streak_bonus_for(2)
    );
  }

  #[test]
  fn lowering_then_raising_then_lowering_pays_the_goal_once_and_never_unmeets_it() {
    let db = memory_db();
    let (now, today, yesterday) = clock();
    db.credit_minutes(&yesterday, 25.0, 20).expect("yesterday");
    db.insert_focus_session(&session("s1", &yesterday, &now, 25.0)).expect("session");
    set_goal(&db, 60, Some(&today)).expect("goal");
    credit_reading(&db, &today, 15.0, Some(&today)).expect("first");
    credit_reading(&db, &today, 11.0, Some(&today)).expect("second");

    let met = set_goal(&db, 20, Some(&today)).expect("lower").expect("snapshot");
    assert!(met.today_met);
    for goal in [60, 20, 5, 240, 20] {
      let after = set_goal(&db, goal, Some(&today)).expect("change").expect("snapshot");
      assert!(after.today_met, "goal {goal}: today stays met");
      assert_eq!(goal_of(&after, &today), 20, "goal {goal}: against the goal it met");
      assert_eq!(after.seeds_earned, met.seeds_earned, "goal {goal}: paid once");
      assert_eq!((after.streak, after.freezes), (met.streak, met.freezes));
      assert_eq!(after.broke_from, None);
      assert_eq!(after.shelf_count, 1, "goal {goal}: the shelf stands");
    }
    // Reading on under a raised goal changes none of it either.
    set_goal(&db, 240, Some(&today)).expect("raise");
    let reading_on = credit_reading(&db, &today, 1.0, Some(&today)).expect("reading on");
    assert!(reading_on.today_met);
    assert_eq!(reading_on.seeds_earned, met.seeds_earned);
  }

  #[test]
  fn lowering_the_goal_after_meeting_it_changes_nothing_for_today() {
    let db = memory_db();
    let (_, today, _) = clock();
    credit_reading(&db, &today, 15.0, Some(&today)).expect("first");
    let met = credit_reading(&db, &today, 10.0, Some(&today)).expect("second");
    assert!(met.today_met);
    let lowered = set_goal(&db, 10, Some(&today)).expect("goal").expect("snapshot");
    assert!(lowered.today_met);
    assert_eq!(goal_of(&lowered, &today), 20, "the goal it met");
    assert_eq!(lowered.seeds_earned, met.seeds_earned);
  }

  #[test]
  fn raising_the_goal_before_meeting_it_applies_to_today_at_once() {
    let db = memory_db();
    let (_, today, _) = clock();
    credit_reading(&db, &today, 10.0, Some(&today)).expect("reading");
    let raised = set_goal(&db, 60, Some(&today)).expect("goal").expect("snapshot");
    assert_eq!(goal_of(&raised, &today), 60);
    assert!(!raised.today_met);
    // Read up to the old goal: not met against the new one.
    let after = credit_reading(&db, &today, 12.0, Some(&today)).expect("more");
    assert!(!after.today_met);
  }

  #[test]
  fn raising_the_goal_after_meeting_it_changes_nothing_for_today() {
    let db = memory_db();
    let (_, today, _) = clock();
    credit_reading(&db, &today, 15.0, Some(&today)).expect("first");
    let met = credit_reading(&db, &today, 10.0, Some(&today)).expect("second");
    let raised = set_goal(&db, 60, Some(&today)).expect("goal").expect("snapshot");
    assert_eq!(raised.goal_minutes, 60, "the goal from tomorrow");
    assert!(raised.today_met);
    assert_eq!(goal_of(&raised, &today), 20);
    assert_eq!(raised.seeds_earned, met.seeds_earned);
  }

  #[test]
  fn a_goal_change_never_restamps_an_earlier_day() {
    let db = memory_db();
    let (_, today, yesterday) = clock();
    // Yesterday fell short of the 60 it was read against.
    db.credit_minutes(&yesterday, 26.0, 60).expect("yesterday");
    credit_reading(&db, &today, 5.0, Some(&today)).expect("today");

    let lowered = set_goal(&db, 20, Some(&today)).expect("goal").expect("snapshot");
    assert_eq!(goal_of(&lowered, &yesterday), 60);
    assert_eq!(goal_of(&lowered, &today), 20);
    assert_eq!(lowered.streak, 0, "yesterday is not met after the fact");

    // Nor when the caller names yesterday as its today (a clock set back).
    let named = set_goal(&db, 5, Some(&yesterday)).expect("goal").expect("snapshot");
    assert_eq!(goal_of(&named, &yesterday), 60);
    // A late credit to yesterday keeps its goal too.
    let late = credit_reading(&db, &yesterday, 0.5, Some(&today)).expect("late credit");
    assert_eq!(goal_of(&late, &yesterday), 60);
  }

  #[test]
  fn a_goal_change_on_a_day_with_no_reading_adds_no_day() {
    let db = memory_db();
    let (_, today, _) = clock();
    let snapshot = set_goal(&db, 45, Some(&today)).expect("goal").expect("snapshot");
    assert_eq!(snapshot.goal_minutes, 45);
    assert!(snapshot.days.is_empty());
    assert_eq!(set_goal(&db, 30, None).expect("goal").map(|s| s.goal_minutes), None, "an older caller: saved, no snapshot");
    assert_eq!(read_goal(&db), 30);
  }

  #[test]
  fn minutes_from_days_ago_are_not_credited() {
    let db = memory_db();
    let (now, today, yesterday) = clock();
    let stale = (now.date_naive() - chrono::Duration::days(3)).format("%Y-%m-%d").to_string();
    // A leftover minute is only good for a day: the ledger takes today's
    // reading, a day either side, and nothing older.
    assert_eq!(creditable(&db, &stale, 1.0), Err("not today"));
    assert_eq!(creditable(&db, &yesterday, 1.0), Ok(1.0));
    assert_eq!(creditable(&db, &today, 1.0), Ok(1.0));
  }

  // ---- a broken streak: nothing burns, and Pip catches a cold ---------------

  fn day_before(now: &chrono::DateTime<chrono::Local>, back: i64) -> String {
    (now.date_naive() - chrono::Duration::days(back)).format("%Y-%m-%d").to_string()
  }

  /// Three days met, the last of them the day before yesterday, a session on
  /// each; yesterday missed; and a streak state with nothing left to cover it.
  fn a_streak_broken_yesterday(db: &db::Database, now: &chrono::DateTime<chrono::Local>) {
    for back in 2..=4 {
      let key = day_before(now, back);
      db.credit_minutes(&key, 25.0, 20).expect("a day");
      db.insert_focus_session(&session(&format!("s{back}"), &key, now, 25.0)).expect("a session");
    }
    let state = habit::StreakState {
      current_streak: 3,
      longest_streak: 3,
      freezes: 0,
      grace_available: false,
      last_evaluated_day: Some(day_before(now, 1)),
      peak_shelf: 3,
      broke_on: None
    };
    write_streak_state(db, &state).expect("streak state");
  }

  #[test]
  fn a_broken_streak_burns_nothing_and_gives_pip_a_cold() {
    let db = memory_db();
    let (now, today, yesterday) = clock();
    a_streak_broken_yesterday(&db, &now);

    let snapshot = build_snapshot(&db, &today).expect("snapshot");
    assert_eq!(snapshot.broke_from, Some(3), "the break is still found, and said once");
    assert_eq!(snapshot.streak, 0);
    assert_eq!(snapshot.shelf_count, 3, "every book still stands");
    assert!(snapshot.sessions.iter().all(|session| session.burned_at.is_none()));
    assert_eq!(db.unburned_session_count().expect("count"), 3);
    assert_eq!(
      snapshot.cold,
      Some(habit::Cold { since: yesterday, broke_from: 3, cure: 0.0, minutes_left_today: 20, days_left: 3 })
    );

    // Asked again, the break is not announced twice, the streak does not
    // come back, and the cold is still there.
    let again = build_snapshot(&db, &today).expect("again");
    assert_eq!((again.broke_from, again.streak), (None, 0));
    assert_eq!(again.cold, snapshot.cold);
    assert_eq!(again.shelf_count, 3);
  }

  #[test]
  fn reading_nurses_pip_back() {
    let db = memory_db();
    let (now, today, _) = clock();
    a_streak_broken_yesterday(&db, &now);
    build_snapshot(&db, &today).expect("the break");

    // Any reading counts, in a focus session or not.
    let some = credit_reading(&db, &today, 12.0, Some(&today)).expect("some reading");
    let caught = some.cold.expect("still ill");
    assert_eq!((caught.cure, caught.minutes_left_today), (0.6, 8));
    // The goal met: she is well in the same snapshot, and a new streak begins.
    let met = credit_reading(&db, &today, 8.0, Some(&today)).expect("the rest");
    assert!(met.today_met);
    assert_eq!(met.cold, None);
    assert_eq!(met.streak, 1);
    assert_eq!(met.shelf_count, 3);
  }

  #[test]
  fn a_miss_covered_by_grace_is_no_break_and_no_cold() {
    let db = memory_db();
    let (now, today, yesterday) = clock();
    a_streak_broken_yesterday(&db, &now);
    // The same ledger, with grace still in hand.
    let mut state = read_streak_state(&db);
    state.grace_available = true;
    write_streak_state(&db, &state).expect("streak state");

    let snapshot = build_snapshot(&db, &today).expect("snapshot");
    assert_eq!(snapshot.broke_from, None);
    assert_eq!(snapshot.streak, 4, "three days and the one grace paid for");
    assert_eq!(snapshot.cold, None);
    let covered = snapshot.days.iter().find(|day| day.date_key == yesterday).expect("yesterday");
    assert!(covered.grace_used);
  }

  #[test]
  fn books_already_burned_stay_burned() {
    let db = memory_db();
    let (now, today, _) = clock();
    a_streak_broken_yesterday(&db, &now);
    // One burned by an earlier version (or by a device still on one, by sync).
    let mut burned = session("old", &day_before(&now, 9), &now, 30.0);
    burned.burned_at = Some("2026-01-05T08:00:00+00:00".to_string());
    db.put_focus_session(&burned).expect("burned");

    let snapshot = build_snapshot(&db, &today).expect("snapshot");
    assert_eq!(snapshot.sessions.len(), 4);
    assert_eq!(snapshot.shelf_count, 3, "the burned one is not counted, and not brought back");
    let old = snapshot.sessions.iter().find(|session| session.id == "old").expect("the burned one");
    assert_eq!(old.burned_at.as_deref(), Some("2026-01-05T08:00:00+00:00"));
    // And the break found just now added no tombstone of its own.
    assert_eq!(snapshot.sessions.iter().filter(|session| session.burned_at.is_some()).count(), 1);
  }

  #[test]
  fn the_cold_does_not_touch_pips_mood() {
    let well = memory_db();
    let ill = memory_db();
    let (now, today, _) = clock();
    a_streak_broken_yesterday(&ill, &now);
    assert!(build_snapshot(&ill, &today).expect("the break").cold.is_some());
    // Finding the break, and having the cold, moved nothing.
    assert_eq!(ill.pip_state().expect("state").map(|state| state.mood), well.pip_state().expect("state").map(|state| state.mood));
    assert!(read_mood_log(&ill).is_empty());

    // The same reading cheers her up by the same amount, cold or no cold,
    // and the cure adds nothing of its own.
    for db in [&well, &ill] {
      credit_reading(db, &today, 12.0, Some(&today)).expect("reading");
      credit_reading(db, &today, 8.0, Some(&today)).expect("to the goal");
    }
    assert!(near(cheered_by(&ill), cheered_by(&well)), "{} / {}", cheered_by(&ill), cheered_by(&well));
    assert!(near(cheered_by(&ill), 20.0 * pip::MOOD_PER_READING_MINUTE));
    assert_eq!(read_reading_mood(&ill), read_reading_mood(&well));
  }

  /// The cold is worked out, not kept: nothing of it is in the document that
  /// syncs and backs up, and a device given the same ledger finds it itself.
  #[test]
  fn the_cold_is_not_stored_or_synced() {
    let from = memory_db();
    let (now, today, _) = clock();
    a_streak_broken_yesterday(&from, &now);
    let here = build_snapshot(&from, &today).expect("snapshot").cold.expect("a cold");

    let doc = crate::sync::store::snapshot(&from, &db::now_iso()).expect("snapshot");
    let sent = serde_json::to_string(&doc).expect("encodes");
    assert!(!sent.to_lowercase().contains("cold"), "the cold is in the sync document");

    // A device that never held the streak, with nothing to cover the miss
    // either: its own state says nothing broke, and the ledger still says
    // she has a cold.
    let to = memory_db();
    crate::sync::store::apply(&to, &doc).expect("apply");
    write_streak_state(&to, &habit::StreakState { grace_available: false, ..Default::default() }).expect("streak state");
    let there = build_snapshot(&to, &today).expect("snapshot");
    assert_eq!(there.broke_from, None);
    assert_eq!(there.cold, Some(here));
  }

  /// The streak's bank is each device's own, so a device with grace in hand
  /// pays for a miss another could not. The cover travels (spent on one
  /// device, spent everywhere), and with it the cold goes from both.
  #[test]
  fn a_cover_from_another_device_cures_the_cold_here_too() {
    let from = memory_db();
    let (now, today, yesterday) = clock();
    a_streak_broken_yesterday(&from, &now);
    assert!(build_snapshot(&from, &today).expect("snapshot").cold.is_some());

    // The other device: the same ledger, and a new device's grace.
    let other = memory_db();
    crate::sync::store::apply(&other, &crate::sync::store::snapshot(&from, &db::now_iso()).expect("snapshot")).expect("apply");
    let there = build_snapshot(&other, &today).expect("snapshot");
    assert_eq!(there.cold, None);
    assert!(there.days.iter().any(|day| day.date_key == yesterday && day.grace_used));

    // Back here by sync: the day is paid for, so it was no break after all.
    let stamp = db::now_iso();
    let merged = crate::sync::merge::merge(
      &crate::sync::store::snapshot(&from, &stamp).expect("here"),
      &crate::sync::store::snapshot(&other, &stamp).expect("there"),
      &stamp
    );
    crate::sync::store::apply(&from, &merged).expect("apply");
    assert_eq!(build_snapshot(&from, &today).expect("snapshot").cold, None);
  }

  /// How far Pip's mood is above where a new Pip's starts. (A few
  /// milliseconds of drift pass in a test: near enough is equal.)
  fn cheered_by(db: &db::Database) -> f64 {
    db.pip_state().expect("state").map(|state| state.mood).unwrap_or(habit::seeds::MOOD_START) - habit::seeds::MOOD_START
  }

  fn near(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.001
  }

  #[test]
  fn any_reading_cheers_pip_up_with_or_without_a_session() {
    let db = memory_db();
    let (_, today, _) = clock();
    // The heartbeat's flushes, no timer running.
    credit_reading(&db, &today, 10.0, None).expect("first");
    credit_reading(&db, &today, 0.5, None).expect("half a minute");
    let snapshot = credit_reading(&db, &today, 4.5, None).expect("third");
    assert_eq!(snapshot.today_minutes, 15.0);
    assert!(snapshot.sessions.is_empty());
    assert!(near(cheered_by(&db), 15.0 * pip::MOOD_PER_READING_MINUTE), "{}", cheered_by(&db));
    assert_eq!(read_reading_mood(&db).given_on(&today), 3.75);
    // Flush after flush is one line in the mood's notes, with all it added.
    let log = read_mood_log(&db);
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].cause, "reading");
    assert!(near(log[0].gain, 3.75), "{}", log[0].gain);
    // A focus session still adds its own, on top of its minutes.
    cheer_pip(&db, habit::seeds::MOOD_PER_SESSION).expect("session");
    assert!(near(cheered_by(&db), 3.75 + habit::seeds::MOOD_PER_SESSION));
    assert_eq!(read_reading_mood(&db).given_on(&today), 3.75, "the session's own cheer is not reading's allowance");
  }

  #[test]
  fn reading_cheers_pip_up_no_more_than_a_days_allowance() {
    let db = memory_db();
    let (_, today, _) = clock();
    for _ in 0..4 {
      credit_reading(&db, &today, 15.0, Some(&today)).expect("a quarter of an hour");
    }
    assert!(near(cheered_by(&db), pip::READING_MOOD_PER_DAY), "{}", cheered_by(&db));
    // Reading on is still reading: the minutes count, the mood has had its day.
    let snapshot = credit_reading(&db, &today, 15.0, Some(&today)).expect("reading on");
    assert_eq!(snapshot.today_minutes, 75.0);
    assert!(near(cheered_by(&db), pip::READING_MOOD_PER_DAY));
    assert_eq!(read_reading_mood(&db).given_on(&today), pip::READING_MOOD_PER_DAY);
  }

  #[test]
  fn only_minutes_the_ledger_took_cheer_pip_up() {
    let db = memory_db();
    let (now, today, _) = clock();
    let stale = (now.date_naive() - chrono::Duration::days(3)).format("%Y-%m-%d").to_string();
    // Refused minutes, and no minutes at all.
    credit_reading(&db, &stale, 15.0, Some(&today)).expect("refused, not failed");
    credit_reading(&db, &today, 0.0, Some(&today)).expect("nothing");
    credit_reading(&db, &today, f64::NAN, Some(&today)).expect("not a number");
    assert_eq!(read_reading_mood(&db), pip::ReadingMood::default());
    assert!(read_mood_log(&db).is_empty());
    assert_eq!(cheered_by(&db), 0.0);
    // An hour reported in one call is taken as the most a call can hold.
    credit_reading(&db, &today, 60.0, Some(&today)).expect("clipped");
    assert_eq!(read_reading_mood(&db).given_on(&today), MAX_MINUTES_PER_CREDIT * pip::MOOD_PER_READING_MINUTE);
  }

  #[test]
  fn a_late_minute_for_yesterday_does_not_open_a_second_allowance() {
    let db = memory_db();
    let (_, today, yesterday) = clock();
    for _ in 0..3 {
      credit_reading(&db, &yesterday, 15.0, Some(&yesterday)).expect("last night");
    }
    credit_reading(&db, &today, 8.0, Some(&today)).expect("this morning");
    let before = cheered_by(&db);
    assert!(near(before, pip::READING_MOOD_PER_DAY + 2.0), "{before}");
    // Leaflet was closed mid-read last night: its last minute arrives now,
    // and then the days alternate. Yesterday is used up and stays so.
    for _ in 0..5 {
      credit_reading(&db, &yesterday, 0.75, Some(&today)).expect("late credit");
    }
    assert!(near(cheered_by(&db), before), "{}", cheered_by(&db));
    credit_reading(&db, &today, 4.0, Some(&today)).expect("reading on");
    credit_reading(&db, &yesterday, 0.75, Some(&today)).expect("late again");
    assert!(near(cheered_by(&db), before + 1.0));
    let reading = read_reading_mood(&db);
    assert_eq!((reading.given_on(&yesterday), reading.given_on(&today)), (pip::READING_MOOD_PER_DAY, 3.0));
  }

  /// Reading's allowance is this device's own: only the mood it raised is in
  /// the document that syncs and backs up, with Pip's state.
  #[test]
  fn readings_allowance_stays_on_this_device() {
    let from = memory_db();
    let (_, today, _) = clock();
    credit_reading(&from, &today, 12.0, Some(&today)).expect("reading");
    let doc = crate::sync::store::snapshot(&from, &db::now_iso()).expect("snapshot");
    let sent = serde_json::to_string(&doc).expect("encodes");
    for local in ["readingMood", "reading_mood", "moodLog", "mood_log", "moodToday"] {
      assert!(!sent.contains(local), "{local} is in the sync document");
    }
    let to = memory_db();
    crate::sync::store::apply(&to, &doc).expect("apply");
    assert_eq!(read_reading_mood(&to), pip::ReadingMood::default());
    assert!(read_mood_log(&to).is_empty());
    assert_eq!(to.get_setting(READING_MOOD_SETTING).expect("read"), None);
    // The mood itself travels, as it always has.
    assert!(near(cheered_by(&to), 3.0), "{}", cheered_by(&to));
  }
}
