//! Reminders wired into the app: the settings, the minute-by-minute scheduler,
//! the hand-over to Windows on exit, and toast clicks. On Android the phone's
//! alarm clock delivers instead, and `phone` keeps it up to date; the commands
//! below have an Android twin each where the answer needs the Kotlin side.
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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use crate::LockExt;

const SETTINGS_KEY: &str = "reminder_settings";
pub(super) const FIRED_KEY: &str = "reminder_fired";
/// What was left with Windows at the last exit, read back on the next launch.
const SCHEDULED_KEY: &str = "reminder_scheduled";
/// Emitted when a toast click reaches the running app.
pub(super) const ACTIVATION_EVENT: &str = "reminder-activation";

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
  /// Reminders can be delivered on this device at all (Windows and Android).
  pub supported: bool,
  /// Running from the MSIX package (or on a phone), so reminders also arrive
  /// with Leaflet closed. Unpackaged Windows builds only remind while running.
  pub while_closed: bool,
  /// Windows (or the phone) has notifications for Leaflet turned off.
  pub blocked: bool
}

pub(super) fn read_json<T: serde::de::DeserializeOwned + Default>(db: &db::Database, key: &str) -> T {
  db.get_setting(key)
    .ok()
    .flatten()
    .and_then(|value| serde_json::from_str(&value).ok())
    .unwrap_or_default()
}

pub(super) fn write_json<T: Serialize>(db: &db::Database, key: &str, value: &T) -> Result<(), String> {
  let encoded = serde_json::to_string(value).map_err(|e| e.to_string())?;
  db.set_setting(key, &encoded).map_err(|e| e.to_string())
}

pub(super) fn read_settings(db: &db::Database) -> ReminderSettings {
  read_json::<ReminderSettings>(db, SETTINGS_KEY).sanitized()
}

fn identifier<R: Runtime>(app: &AppHandle<R>) -> String {
  app.config().identifier.clone()
}

pub(super) fn today_key(now: NaiveDateTime) -> String {
  now.format("%Y-%m-%d").to_string()
}

/// Today's habit numbers straight from the ledger (read-only; see
/// `HabitView::from_ledger`).
pub(super) fn habit_view(db: &db::Database, settings: &ReminderSettings, now: NaiveDateTime) -> Result<(HabitView, i64), String> {
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
pub(super) fn end_of_day(date_key: &str) -> Option<chrono::DateTime<chrono::Utc>> {
  let date = chrono::NaiveDate::parse_from_str(date_key, "%Y-%m-%d").ok()?;
  local_to_utc(&Local, date.succ_opt()?.and_hms_opt(0, 0, 0)?)
}

#[cfg_attr(target_os = "android", allow(dead_code))]
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
#[cfg_attr(target_os = "android", allow(dead_code))]
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
  // Pip on the desktop, if she is out there, holds up a sign for it.
  crate::desktop_pip::runtime::nudge(app, &due.reminder);
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
    activation: Mutex::new(
      activation_route(std::env::args().skip(1)).or_else(|| TAPPED_EARLY.swap(false, Ordering::SeqCst).then_some("continue"))
    ),
    ..ReminderRuntime::default()
  });

  // The phone's alarm clock delivers there; it is brought up to date now
  // that the library is open.
  #[cfg(target_os = "android")]
  super::phone::request_sync(app);

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

/// Another library was opened (`libraries::switch`): its reminders, its goal
/// and its days are the ones that count now. On a computer the running app's
/// own clock reads the open library every minute and Windows holds nothing
/// while it runs, so only the old library's delivered reminders go; the
/// phone's alarms are planned again from the new library.
pub fn library_switched<R: Runtime>(app: &AppHandle<R>) {
  #[cfg(target_os = "android")]
  super::phone::request_sync(app);
  if cfg!(windows) {
    toast::clear_delivered(&identifier(app));
  }
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

/// Pip's mode as the frontend last reported it, for the wording.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(super) fn voice<R: Runtime>(app: &AppHandle<R>) -> PipVoice {
  app
    .try_state::<ReminderRuntime>()
    .map(|runtime| *runtime.voice.guard())
    .unwrap_or_default()
}

/// A notification tapped before `init` (it started Leaflet): picked up there.
static TAPPED_EARLY: AtomicBool = AtomicBool::new(false);

/// A tapped notification on the phone: the same as a toast click.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(super) fn activate<R: Runtime>(app: &AppHandle<R>) {
  match app.try_state::<ReminderRuntime>() {
    Some(runtime) => *runtime.activation.guard() = Some("continue"),
    None => TAPPED_EARLY.store(true, Ordering::SeqCst)
  }
  let _ = app.emit(ACTIVATION_EVENT, ());
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

#[cfg(not(target_os = "android"))]
fn status<R: Runtime>(app: &AppHandle<R>, settings: ReminderSettings) -> ReminderStatus {
  ReminderStatus {
    settings,
    supported: cfg!(windows),
    while_closed: toast::packaged(),
    blocked: cfg!(windows) && toast::blocked(&identifier(app))
  }
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn reminders_get(app: AppHandle, state: State<'_, AppState>) -> ReminderStatus {
  let settings = read_settings(&state.db.guard());
  status(&app, settings)
}

/// Saves the reader's choices. Nothing else to do while the app runs: the
/// scheduler reads them every minute, and the Windows schedule is written
/// from them on exit (and was cleared at launch).
#[cfg(not(target_os = "android"))]
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
  runtime: State<'_, ReminderRuntime>,
  _app: AppHandle
) {
  {
    let mut activity = runtime.activity.guard();
    activity.session_running = session_running;
    activity.book_open = book_open;
  }
  *runtime.voice.guard() = PipVoice::from_mode(&pip_mode);
  // A session ended (perhaps short, perhaps with the goal met) or a book
  // closed: the phone's alarms are handed over again.
  #[cfg(target_os = "android")]
  super::phone::request_sync(&_app);
}

/// The route a toast click asked for, once.
#[tauri::command]
pub fn reminders_take_activation(runtime: State<'_, ReminderRuntime>) -> Option<String> {
  runtime.activation.guard().take().map(str::to_string)
}

/// Shows one reminder now, so the reader can see what it looks like (and find
/// out whether Windows is letting it through). Not logged as sent.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn reminders_preview(
  kind: ReminderKind,
  app: AppHandle,
  runtime: State<'_, ReminderRuntime>,
  state: State<'_, AppState>
) -> Result<(), String> {
  let voice = *runtime.voice.guard();
  let reminder = sample(&state.db.guard(), kind, voice)?;
  toast::show(&identifier(&app), &reminder, end_of_day(&reminder.date_key)).map_err(|error| error.to_string())
}

/// The sample reminder for "Send a Test": what it says now, in Pip's voice.
pub(super) fn sample(db: &db::Database, kind: ReminderKind, voice: PipVoice) -> Result<super::Reminder, String> {
  let now = Local::now().naive_local();
  let settings = read_settings(db);
  let (habit, goal) = habit_view(db, &settings, now)?;
  let remaining = if habit.met { goal.max(1) } else { (habit.goal as f64 - habit.minutes).ceil().max(1.0) as i64 };
  Ok(super::compose(kind, voice, remaining, habit.streak.max(1), &today_key(now)))
}

// ---- Android: the same commands, answered with the phone's help ------------
//
// Async, because the Kotlin side answers on the main thread and these must
// not hold it up waiting.

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn reminders_get(app: AppHandle) -> Result<ReminderStatus, String> {
  let settings = {
    let state = app.try_state::<AppState>().ok_or("Leaflet isn't ready yet.")?;
    let db = state.db.guard();
    read_settings(&db)
  };
  Ok(super::phone::status(&app, settings).await)
}

/// Saves the reader's choices and hands the phone its alarms again. Turning a
/// reminder on is when Android 13+ asks whether Leaflet may notify at all.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn reminders_set(settings: ReminderSettings, app: AppHandle) -> Result<ReminderStatus, String> {
  let settings = settings.sanitized();
  let turned_on = {
    let state = app.try_state::<AppState>().ok_or("Leaflet isn't ready yet.")?;
    let db = state.db.guard();
    let before = read_settings(&db);
    write_json(&db, SETTINGS_KEY, &settings)?;
    (settings.daily && !before.daily)
      || (settings.streak_risk && !before.streak_risk)
      || (settings.close_nudge && !before.close_nudge)
  };
  if turned_on {
    super::phone::ask_permission(&app).await;
  }
  super::phone::sync(app.clone()).await;
  Ok(super::phone::status(&app, settings).await)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn reminders_preview(kind: ReminderKind, app: AppHandle) -> Result<(), String> {
  let reminder = {
    let state = app.try_state::<AppState>().ok_or("Leaflet isn't ready yet.")?;
    let db = state.db.guard();
    sample(&db, kind, voice(&app))?
  };
  super::phone::show_now(&app, &reminder).await
}

/// Opens the phone's notification settings for Leaflet, for when they are
/// off. There is no such page to open on Windows from here.
#[tauri::command]
pub async fn reminders_open_settings(app: AppHandle) -> Result<(), String> {
  #[cfg(target_os = "android")]
  {
    super::phone::open_settings(&app).await
  }
  #[cfg(not(target_os = "android"))]
  {
    let _ = app;
    Err("Only on a phone.".to_string())
  }
}
