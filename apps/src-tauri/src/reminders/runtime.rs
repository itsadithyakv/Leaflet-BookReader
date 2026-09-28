//! Reminders wired into the app: the settings, the minute-by-minute scheduler,
//! the hand-over to Windows on exit, and toast clicks.
//!
//! The rules live in the parent module; this file only gathers their inputs
//! (the database, the clock, what the reader is doing) and acts on the answer.

use super::{
  activation_route, due_now, local_to_utc, plan_ahead, settle_scheduled, toast, Activity, FiredLog, HabitView,
  PipVoice, ReminderKind, ReminderSettings, ScheduledRecord
};
use crate::{db, AppState};
use chrono::{Local, NaiveDateTime};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use crate::LockExt;

const SETTINGS_KEY: &str = "reminder_settings";
const FIRED_KEY: &str = "reminder_fired";
/// What was left with Windows at the last exit, read back on the next launch.
const SCHEDULED_KEY: &str = "reminder_scheduled";
/// Emitted when a toast click reaches the running app.
const ACTIVATION_EVENT: &str = "reminder-activation";

/// What the frontend reports about the reader, and a toast click waiting to
/// be picked up.
#[derive(Default)]
pub struct ReminderRuntime {
  activity: Mutex<Activity>,
  voice: Mutex<PipVoice>,
  activation: Mutex<Option<&'static str>>
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderStatus {
  pub settings: ReminderSettings,
  /// Reminders can be delivered on this device at all (Windows only).
  pub supported: bool,
  /// Running from the MSIX package, so reminders also arrive with Leaflet
  /// closed. Unpackaged builds only remind while running.
  pub while_closed: bool,
  /// Windows has notifications for Leaflet turned off.
  pub blocked: bool
}

fn read_json<T: serde::de::DeserializeOwned + Default>(db: &db::Database, key: &str) -> T {
  db.get_setting(key)
    .ok()
    .flatten()
    .and_then(|value| serde_json::from_str(&value).ok())
    .unwrap_or_default()
}

fn write_json<T: Serialize>(db: &db::Database, key: &str, value: &T) -> Result<(), String> {
  let encoded = serde_json::to_string(value).map_err(|e| e.to_string())?;
  db.set_setting(key, &encoded).map_err(|e| e.to_string())
}

fn read_settings(db: &db::Database) -> ReminderSettings {
  read_json::<ReminderSettings>(db, SETTINGS_KEY).sanitized()
}

fn identifier<R: Runtime>(app: &AppHandle<R>) -> String {
  app.config().identifier.clone()
}

fn today_key(now: NaiveDateTime) -> String {
  now.format("%Y-%m-%d").to_string()
}

/// Today's habit numbers straight from the ledger (read-only; see
/// `HabitView::from_ledger`).
fn habit_view(db: &db::Database, settings: &ReminderSettings, now: NaiveDateTime) -> Result<(HabitView, i64), String> {
  let key = today_key(now);
  let days = db.reading_days().map_err(|e| e.to_string())?;
  let previous = crate::commands::read_streak_state(db);
  let goal = crate::commands::read_goal(db);
  // Only the close nudge cares about sessions; the rest skip the query.
  let last_session_end = if settings.close_nudge {
    db.focus_sessions()
      .map_err(|e| e.to_string())?
      .into_iter()
      .filter(|session| session.burned_at.is_none() && session.date_key == key)
      .filter_map(|session| chrono::DateTime::parse_from_rfc3339(&session.ended_at).ok())
      .map(|ended| ended.with_timezone(&Local).naive_local())
      .max()
  } else {
    None
  };
  Ok((HabitView::from_ledger(&days, &previous, goal, &key, last_session_end), goal))
}

/// The end of a reminder's day, when its toast leaves the notification centre.
fn end_of_day(date_key: &str) -> Option<chrono::DateTime<chrono::Utc>> {
  let date = chrono::NaiveDate::parse_from_str(date_key, "%Y-%m-%d").ok()?;
  local_to_utc(&Local, date.succ_opt()?.and_hms_opt(0, 0, 0)?)
}

fn focused<R: Runtime>(app: &AppHandle<R>) -> bool {
  app
    .get_webview_window("main")
    .map(|window| {
      window.is_focused().unwrap_or(false)
        && window.is_visible().unwrap_or(true)
        && !window.is_minimized().unwrap_or(false)
    })
    .unwrap_or(false)
}

/// One scheduler pass: shows a reminder if one is due this minute.
fn tick<R: Runtime>(app: &AppHandle<R>) {
  let Some(state) = app.try_state::<AppState>() else {
    return;
  };
  let runtime = app.state::<ReminderRuntime>();
  let now = Local::now().naive_local();

  let (due, mut log) = {
    let db = state.db.guard();
    let settings = read_settings(&db);
    if !settings.any_enabled() {
      return;
    }
    let Ok((habit, _)) = habit_view(&db, &settings, now) else {
      return;
    };
    let log: FiredLog = read_json(&db, FIRED_KEY);
    let mut activity = *runtime.activity.guard();
    activity.focused = focused(app);
    let voice = *runtime.voice.guard();
    (due_now(&settings, voice, &habit, activity, &log, now), log)
  };

  let Some(due) = due else {
    return;
  };
  let expires = end_of_day(&due.reminder.date_key);
  // Marked as sent even if Windows refused it: a toast that failed once
  // would fail again every minute for the next hour.
  let _ = toast::show(&identifier(app), &due.reminder, expires);
  log.mark(due.reminder.kind, &due.reminder.date_key);
  for kind in &due.superseded {
    log.mark(*kind, &due.reminder.date_key);
  }
  let db = state.db.guard();
  let _ = write_json(&db, FIRED_KEY, &log);
}

/// Called once from setup, after `AppState` is managed.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
  app.manage(ReminderRuntime {
    activation: Mutex::new(activation_route(std::env::args().skip(1))),
    ..ReminderRuntime::default()
  });

  if !cfg!(windows) {
    return;
  }

  // The app is running again, so the in-app scheduler takes over. What went
  // out while it was closed counts as sent for the day; the rest of Windows'
  // schedule is withdrawn, because only the running app can see a book open.
  if let Some(state) = app.try_state::<AppState>() {
    let db = state.db.guard();
    let scheduled: Vec<ScheduledRecord> = read_json(&db, SCHEDULED_KEY);
    if !scheduled.is_empty() {
      let mut log: FiredLog = read_json(&db, FIRED_KEY);
      settle_scheduled(&mut log, &scheduled, Local::now().naive_local());
      let _ = write_json(&db, FIRED_KEY, &log);
      let _ = db.set_setting(SCHEDULED_KEY, "[]");
    }
  }
  let identifier = identifier(app);
  let _ = toast::clear_scheduled(&identifier);
  toast::clear_delivered(&identifier);

  let handle = app.clone();
  let _ = std::thread::Builder::new().name("reminders".into()).spawn(move || loop {
    // Wake at the top of each minute, so an 19:00 reminder is not up to a
    // minute late.
    let second = u64::from(chrono::Timelike::second(&Local::now()));
    std::thread::sleep(std::time::Duration::from_secs(60 - second.min(59)));
    tick(&handle);
  });
}

/// Hands Windows whatever should arrive while Leaflet is closed. Runs when the
/// main window is destroyed, which is how Leaflet exits.
pub fn schedule_for_exit<R: Runtime>(app: &AppHandle<R>) {
  if !toast::packaged() {
    return;
  }
  let Some(state) = app.try_state::<AppState>() else {
    return;
  };
  let voice = app
    .try_state::<ReminderRuntime>()
    .map(|runtime| *runtime.voice.guard())
    .unwrap_or_default();
  let now = Local::now().naive_local();
  let db = state.db.guard();
  let settings = read_settings(&db);
  let plans = if settings.any_enabled() {
    match habit_view(&db, &settings, now) {
      Ok((habit, goal)) => plan_ahead(&settings, voice, &habit, goal, &read_json(&db, FIRED_KEY), now),
      Err(_) => Vec::new()
    }
  } else {
    Vec::new()
  };

  let toasts: Vec<_> = plans
    .iter()
    .filter_map(|plan| {
      let at = local_to_utc(&Local, plan.at)?;
      Some((plan.reminder.clone(), at, end_of_day(&plan.reminder.date_key)))
    })
    .collect();
  if toast::schedule(&identifier(app), &toasts).is_ok() {
    let records: Vec<ScheduledRecord> = plans.iter().map(ScheduledRecord::of).collect();
    let _ = write_json(&db, SCHEDULED_KEY, &records);
  }
}

/// A toast click that reached the already-running app (through
/// single-instance). A cold start picks its route up in `init` instead.
pub fn note_activation<R: Runtime>(app: &AppHandle<R>, args: &[String]) {
  let Some(route) = activation_route(args.iter().skip(1).cloned()) else {
    return;
  };
  if let Some(runtime) = app.try_state::<ReminderRuntime>() {
    *runtime.activation.guard() = Some(route);
  }
  let _ = app.emit(ACTIVATION_EVENT, ());
}

fn status<R: Runtime>(app: &AppHandle<R>, settings: ReminderSettings) -> ReminderStatus {
  ReminderStatus {
    settings,
    supported: cfg!(windows),
    while_closed: toast::packaged(),
    blocked: cfg!(windows) && toast::blocked(&identifier(app))
  }
}

#[tauri::command]
pub fn reminders_get(app: AppHandle, state: State<'_, AppState>) -> ReminderStatus {
  let settings = read_settings(&state.db.guard());
  status(&app, settings)
}

/// Saves the reader's choices. Nothing else to do while the app runs: the
/// scheduler reads them every minute, and the Windows schedule is written
/// from them on exit (and was cleared at launch).
#[tauri::command]
pub fn reminders_set(
  settings: ReminderSettings,
  app: AppHandle,
  state: State<'_, AppState>
) -> Result<ReminderStatus, String> {
  let settings = settings.sanitized();
  write_json(&state.db.guard(), SETTINGS_KEY, &settings)?;
  Ok(status(&app, settings))
}

/// What the reader is doing, from the frontend: a session running, a book
/// open, and Pip's mode (for the wording).
#[tauri::command]
pub fn reminders_context(
  session_running: bool,
  book_open: bool,
  pip_mode: String,
  runtime: State<'_, ReminderRuntime>
) {
  {
    let mut activity = runtime.activity.guard();
    activity.session_running = session_running;
    activity.book_open = book_open;
  }
  *runtime.voice.guard() = PipVoice::from_mode(&pip_mode);
}

/// The route a toast click asked for, once.
#[tauri::command]
pub fn reminders_take_activation(runtime: State<'_, ReminderRuntime>) -> Option<String> {
  runtime.activation.guard().take().map(str::to_string)
}

/// Shows one reminder now, so the reader can see what it looks like (and find
/// out whether Windows is letting it through). Not logged as sent.
#[tauri::command]
pub fn reminders_preview(
  kind: ReminderKind,
  app: AppHandle,
  runtime: State<'_, ReminderRuntime>,
  state: State<'_, AppState>
) -> Result<(), String> {
  let now = Local::now().naive_local();
  let voice = *runtime.voice.guard();
  let reminder = {
    let db = state.db.guard();
    let settings = read_settings(&db);
    let (habit, goal) = habit_view(&db, &settings, now)?;
    let remaining = if habit.met { goal.max(1) } else { (habit.goal as f64 - habit.minutes).ceil().max(1.0) as i64 };
    super::compose(kind, voice, remaining, habit.streak.max(1), &today_key(now))
  };
  toast::show(&identifier(&app), &reminder, end_of_day(&reminder.date_key)).map_err(|error| error.to_string())
}
