//! Reminders on Android: the phone's alarm clock delivers them, whether
//! Leaflet is open or not.
//!
//! The rules stay here, in Rust: [`sync`] works out the same plan the Windows
//! build leaves with Windows on exit ([`plan_ahead`]: what is still to come
//! today, and tomorrow's) and hands it to the Kotlin side
//! (`gen/android/.../Reminders.kt`), which keeps it in an `AlarmManager` and
//! shows each as a notification when its time comes. The plan is handed over
//! again whenever something it depends on changes: Leaflet coming to the
//! front or leaving it, a session ending, a book closing, the settings. So a
//! goal met cancels today's alarms, and a session that ends just short brings
//! "you're close" a little later.
//!
//! At fire time no Rust runs, so the alarm itself checks the little it can:
//! Leaflet in front (the reader is here: it is dropped, as the running
//! desktop app would hold it), a "goal met on <day>" mark this module writes,
//! too late ([`deliver_until`]), notifications off. What went out is written
//! down there and read back into the [`FiredLog`] at the next hand-over, so
//! each kind still goes out at most once a day.

use super::runtime::{
  end_of_day, habit_view, read_json, read_settings, voice, write_json, ReminderStatus, FIRED_KEY
};
use super::{deliver_until, local_to_utc, plan_ahead, FiredLog, Reminder, ReminderSettings};
use crate::{AppState, LockExt};
use chrono::{Local, NaiveDateTime};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Told to the page after each hand-over, so an open Settings card can show
/// whether the phone lets the reminders through.
const CHANGED_EVENT: &str = "reminders-changed";

struct Native<R: Runtime> {
  handle: PluginHandle<R>,
  /// One hand-over at a time, so an older plan never lands after a newer one.
  turn: tokio::sync::Mutex<()>
}

/// What the Kotlin side knows: whether notifications get through, and what
/// went out while Leaflet was closed.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct NativeState {
  allowed: bool,
  fired: FiredLog
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Alarm {
  kind: &'static str,
  date_key: String,
  title: String,
  body: String,
  /// Epoch milliseconds: when to go out, the latest it still may, and when
  /// it leaves the shade unread (the end of its day).
  at: i64,
  until: i64,
  expires: i64
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Schedule {
  alarms: Vec<Alarm>,
  /// Today, when its goal is already met: an alarm for this day that is
  /// somehow still set is dropped when it fires.
  met_date: Option<String>
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Shown<'a> {
  kind: &'static str,
  title: &'a str,
  body: &'a str
}

/// The plugin that carries the Kotlin half (`RemindersPlugin`). Its only
/// caller is Rust, so the page needs no permission for it.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("leaflet-reminders")
    .setup(|app, api| {
      let handle = api.register_android_plugin("com.leaflet.app", "RemindersPlugin")?;
      // A notification tapped: open the book the reader was in.
      let tapped = app.clone();
      let activation = Channel::<serde_json::Value>::new(move |_| {
        super::runtime::activate(&tapped);
        Ok(())
      });
      handle.run_mobile_plugin::<()>("registerListener", serde_json::json!({ "event": "activation", "handler": activation }))?;
      // Leaflet came to the front or left it: the moments to hand over again.
      let moved = app.clone();
      let lifecycle = Channel::<serde_json::Value>::new(move |_| {
        request_sync(&moved);
        Ok(())
      });
      handle.run_mobile_plugin::<()>("registerListener", serde_json::json!({ "event": "lifecycle", "handler": lifecycle }))?;
      app.manage(Native { handle, turn: tokio::sync::Mutex::new(()) });
      Ok(())
    })
    .build()
}

/// Hands the phone its alarms again, in the background.
pub fn request_sync<R: Runtime>(app: &AppHandle<R>) {
  let app = app.clone();
  tauri::async_runtime::spawn(async move {
    sync(app).await;
  });
}

fn epoch_ms(local: NaiveDateTime) -> Option<i64> {
  local_to_utc(&Local, local).map(|time| time.timestamp_millis())
}

/// Reads back what went out, works out the plan, and replaces the phone's
/// alarms with it. Nothing changes when the numbers cannot be read: a wrong
/// cancel is worse than a stale alarm, which checks the goal mark anyway.
pub async fn sync<R: Runtime>(app: AppHandle<R>) {
  let Some(native) = app.try_state::<Native<R>>() else {
    return;
  };
  let Some(state) = app.try_state::<AppState>() else {
    return;
  };
  let _turn = native.turn.lock().await;
  let delivered = native.handle.run_mobile_plugin_async::<NativeState>("state", ()).await.ok();
  let voice = voice(&app);
  let now = Local::now().naive_local();

  let schedule = {
    let db = state.db.guard();
    let mut log: FiredLog = read_json(&db, FIRED_KEY);
    if let Some(delivered) = &delivered {
      if log.merge(&delivered.fired) {
        let _ = write_json(&db, FIRED_KEY, &log);
      }
    }
    let settings = read_settings(&db);
    if settings.any_enabled() {
      match habit_view(&db, &settings, now) {
        Ok((habit, goal)) => Some(Schedule {
          alarms: plan_ahead(&settings, voice, &habit, goal, &log, now)
            .into_iter()
            .filter_map(|plan| {
              Some(Alarm {
                kind: plan.reminder.kind.tag(),
                at: epoch_ms(plan.at)?,
                until: epoch_ms(deliver_until(plan.at))?,
                expires: end_of_day(&plan.reminder.date_key)?.timestamp_millis(),
                date_key: plan.reminder.date_key,
                title: plan.reminder.title,
                body: plan.reminder.body
              })
            })
            .collect(),
          met_date: habit.met.then(|| habit.date_key.clone())
        }),
        Err(_) => None
      }
    } else {
      Some(Schedule { alarms: Vec::new(), met_date: None })
    }
  };

  if let Some(schedule) = schedule {
    if let Err(error) = native.handle.run_mobile_plugin_async::<()>("schedule", schedule).await {
      crate::diag::error(&format!("reminders: the phone did not take the schedule: {error}"));
    }
  }
  let _ = app.emit(CHANGED_EVENT, ());
}

/// The status for Settings. `blocked` is the phone's own switch for Leaflet's
/// notifications (or the reminders channel), or Android 13+'s permission.
pub async fn status<R: Runtime>(app: &AppHandle<R>, settings: ReminderSettings) -> ReminderStatus {
  let allowed = match app.try_state::<Native<R>>() {
    Some(native) => native
      .handle
      .run_mobile_plugin_async::<NativeState>("state", ())
      .await
      .map(|state| state.allowed)
      .unwrap_or(true),
    None => true
  };
  ReminderStatus { settings, supported: true, while_closed: true, blocked: !allowed }
}

/// Asks Android 13+ whether Leaflet may notify (once a reminder is turned
/// on, never at launch). Android itself stops asking after two refusals;
/// Settings then offers the phone's own page.
pub async fn ask_permission<R: Runtime>(app: &AppHandle<R>) {
  if let Some(native) = app.try_state::<Native<R>>() {
    let _ = native.handle.run_mobile_plugin_async::<NativeState>("requestNotifications", ()).await;
  }
}

/// "Send a Test": shown now, not logged as sent.
pub async fn show_now<R: Runtime>(app: &AppHandle<R>, reminder: &Reminder) -> Result<(), String> {
  let native = app.try_state::<Native<R>>().ok_or("Reminders aren't ready yet.")?;
  native
    .handle
    .run_mobile_plugin_async::<()>(
      "show",
      Shown { kind: reminder.kind.tag(), title: &reminder.title, body: &reminder.body }
    )
    .await
    .map_err(|error| error.to_string())
}

pub async fn open_settings<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
  let native = app.try_state::<Native<R>>().ok_or("Reminders aren't ready yet.")?;
  native
    .handle
    .run_mobile_plugin_async::<()>("openSettings", ())
    .await
    .map_err(|error| error.to_string())
}
