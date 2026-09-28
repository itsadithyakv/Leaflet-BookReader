//! Reading reminders: what should fire now, and what to leave with Windows.
//!
//! Deliberately pure, like the habit engine. Every function takes the reader's
//! local time and the habit numbers as data, so the rules (one per day per
//! kind, never once the goal is met, never at night) are tested without a
//! clock, a database or Windows. `runtime` feeds it and `toast` delivers.
//!
//! Two deliveries share these rules:
//!
//! - While Leaflet runs, a scheduler asks [`due_now`] every minute. It knows
//!   whether a book is open or a session is running, which a scheduled toast
//!   cannot know, so it owns delivery for as long as the app is up.
//! - When Leaflet closes, [`plan_ahead`] decides what to hand Windows as
//!   scheduled toasts. Reading minutes only change while the app is open, so
//!   "the goal is not met yet" stays true until the reader comes back, and
//!   launching clears the schedule again.

use crate::habit::{self, DayRecord, StreakState};
use chrono::{Duration, MappedLocalTime, NaiveDateTime, TimeZone, Timelike, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub mod runtime;
mod toast;

/// Whether this process runs from the MSIX package (reminders are scheduled
/// with Windows only then).
pub fn packaged() -> bool {
  toast::packaged()
}

/// Nothing fires from this time of night...
pub const QUIET_START: u32 = 23 * 60;
/// ...until this time in the morning, whatever the settings say.
pub const QUIET_END: u32 = 7 * 60;
/// "Streak at risk" goes out two hours before midnight: late enough that the
/// day really is slipping, early enough to read before bed.
pub const STREAK_RISK_AT: u32 = 22 * 60;
/// The daily reminder's time until the reader picks one.
pub const DEFAULT_DAILY_AT: u32 = 19 * 60;
/// "You're close" is for readers at most this many minutes short.
pub const CLOSE_MARGIN_MINUTES: f64 = 5.0;
/// ...and waits this long after the session ends, so it lands once the reader
/// has wandered off rather than while they are still looking at the wrap-up.
pub const CLOSE_DELAY_MINUTES: i64 = 15;
/// A reminder missed (asleep laptop, book open) can still go out this late.
/// Past that, "time to read?" at 23:00 for a 19:00 reminder is just noise.
pub const CATCH_UP_MINUTES: i64 = 60;

/// Protocol a toast click launches, registered in the MSIX manifest.
pub const PROTOCOL: &str = "leaflet-reader";
/// Where a toast click lands: the book the reader was last in.
pub const CONTINUE_URI: &str = "leaflet-reader://continue";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReminderKind {
  Daily,
  StreakRisk,
  Close
}

impl ReminderKind {
  /// Most urgent first: when two are due in the same minute, one goes out.
  pub const BY_PRIORITY: [ReminderKind; 3] =
    [ReminderKind::StreakRisk, ReminderKind::Daily, ReminderKind::Close];

  /// The toast tag, so a new reminder of a kind replaces the last one.
  pub fn tag(self) -> &'static str {
    match self {
      ReminderKind::Daily => "daily",
      ReminderKind::StreakRisk => "streak",
      ReminderKind::Close => "close"
    }
  }
}

/// What the reader chose in Settings. Everything is off until they say yes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReminderSettings {
  pub daily: bool,
  /// Minutes after local midnight.
  pub daily_at: u32,
  pub streak_risk: bool,
  pub close_nudge: bool,
  /// The opt-in question has been asked (and answered either way), so it is
  /// never asked again.
  pub asked: bool
}

impl Default for ReminderSettings {
  fn default() -> Self {
    Self {
      daily: false,
      daily_at: DEFAULT_DAILY_AT,
      streak_risk: false,
      close_nudge: false,
      asked: false
    }
  }
}

impl ReminderSettings {
  /// Keeps the daily time out of quiet hours, rounded to the minute picker.
  pub fn sanitized(mut self) -> Self {
    self.daily_at = self.daily_at.clamp(QUIET_END, QUIET_START - 1);
    self
  }

  pub fn any_enabled(&self) -> bool {
    self.daily || self.streak_risk || self.close_nudge
  }

  fn enabled(&self, kind: ReminderKind) -> bool {
    match kind {
      ReminderKind::Daily => self.daily,
      ReminderKind::StreakRisk => self.streak_risk,
      ReminderKind::Close => self.close_nudge
    }
  }
}

/// Pip's mode, which changes the wording and nothing else.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PipVoice {
  #[default]
  Chatty,
  Quiet,
  /// Pip is hidden everywhere, so the reminders do not mention it either.
  Off
}

impl PipVoice {
  pub fn from_mode(mode: &str) -> Self {
    match mode {
      "quiet" => PipVoice::Quiet,
      "off" => PipVoice::Off,
      _ => PipVoice::Chatty
    }
  }
}

/// Today's habit numbers, as the reminders need them.
#[derive(Debug, Clone, PartialEq)]
pub struct HabitView {
  /// The local day these numbers are for, `YYYY-MM-DD`.
  pub date_key: String,
  pub minutes: f64,
  pub goal: i64,
  pub met: bool,
  /// Days in the current streak. With today unmet, that is the run up to
  /// yesterday; with today met, it includes today.
  pub streak: i64,
  /// When today's most recent focus session ended, local time.
  pub last_session_end: Option<NaiveDateTime>
}

impl HabitView {
  /// Reads the ledger without changing it: a reminder check must never spend
  /// a freeze or burn a book, which is `build_snapshot`'s job.
  pub fn from_ledger(
    days: &HashMap<String, DayRecord>,
    previous: &StreakState,
    goal_setting: i64,
    today_key: &str,
    last_session_end: Option<NaiveDateTime>
  ) -> Self {
    let evaluation = habit::evaluate(days, today_key, previous);
    // Today's row carries the goal it was credited against; before any
    // reading today there is no row, so the current setting applies.
    let goal = if evaluation.today_goal > 0 { evaluation.today_goal } else { goal_setting };
    Self {
      date_key: today_key.to_string(),
      minutes: evaluation.today_minutes,
      goal,
      met: evaluation.today_met,
      streak: evaluation.streak,
      last_session_end
    }
  }

  fn remaining(&self) -> i64 {
    (self.goal as f64 - self.minutes).ceil().max(1.0) as i64
  }
}

/// What the reader is doing in the app right now.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Activity {
  pub session_running: bool,
  pub book_open: bool,
  /// Leaflet is the window in front. A toast telling someone who is looking
  /// at Leaflet to open Leaflet is silly, so it waits until they look away.
  pub focused: bool
}

impl Activity {
  fn busy(&self) -> bool {
    self.session_running || self.book_open || self.focused
  }
}

/// The last local day each kind went out, so none fires twice in a day.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FiredLog {
  pub daily: Option<String>,
  pub streak_risk: Option<String>,
  pub close: Option<String>
}

impl FiredLog {
  fn slot(&mut self, kind: ReminderKind) -> &mut Option<String> {
    match kind {
      ReminderKind::Daily => &mut self.daily,
      ReminderKind::StreakRisk => &mut self.streak_risk,
      ReminderKind::Close => &mut self.close
    }
  }

  pub fn fired_on(&self, kind: ReminderKind, date_key: &str) -> bool {
    let fired = match kind {
      ReminderKind::Daily => &self.daily,
      ReminderKind::StreakRisk => &self.streak_risk,
      ReminderKind::Close => &self.close
    };
    fired.as_deref() == Some(date_key)
  }

  pub fn mark(&mut self, kind: ReminderKind, date_key: &str) {
    *self.slot(kind) = Some(date_key.to_string());
  }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
  pub kind: ReminderKind,
  /// The local day this reminder is about; it expires at that day's end.
  pub date_key: String,
  pub title: String,
  pub body: String
}

/// A reminder the scheduler says should go out this minute.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Due {
  pub reminder: Reminder,
  /// Other kinds due in the same minute. They are marked as sent with it:
  /// "streak at risk" and "time to read?" together is one nudge too many.
  pub superseded: Vec<ReminderKind>
}

/// A reminder to hand Windows for when the app is closed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Planned {
  pub reminder: Reminder,
  /// Local wall-clock time.
  pub at: NaiveDateTime
}

/// A planned toast as remembered between runs, so the next launch knows which
/// went out while the app was closed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledRecord {
  pub kind: ReminderKind,
  pub date_key: String,
  /// Local wall-clock time, `YYYY-MM-DDTHH:MM`.
  pub at: String
}

pub const LOCAL_FORMAT: &str = "%Y-%m-%dT%H:%M";

impl ScheduledRecord {
  pub fn of(planned: &Planned) -> Self {
    Self {
      kind: planned.reminder.kind,
      date_key: planned.reminder.date_key.clone(),
      at: planned.at.format(LOCAL_FORMAT).to_string()
    }
  }
}

/// Marks the toasts whose time passed while Leaflet was closed as sent, so the
/// scheduler does not repeat one the moment the reader opens the app. A toast
/// Windows dropped (the PC was off) is counted too: at most one per day per
/// kind is the promise, and a missed nudge is the cheaper mistake.
pub fn settle_scheduled(log: &mut FiredLog, scheduled: &[ScheduledRecord], now: NaiveDateTime) {
  for record in scheduled {
    let Ok(at) = NaiveDateTime::parse_from_str(&record.at, LOCAL_FORMAT) else {
      continue;
    };
    if at <= now {
      log.mark(record.kind, &record.date_key);
    }
  }
}

fn minute_of_day(time: NaiveDateTime) -> u32 {
  time.hour() * 60 + time.minute()
}

pub fn in_quiet_hours(time: NaiveDateTime) -> bool {
  let minute = minute_of_day(time);
  minute >= QUIET_START || minute < QUIET_END
}

fn at_minute(date: chrono::NaiveDate, minute: u32) -> NaiveDateTime {
  date.and_hms_opt(minute / 60, minute % 60, 0).unwrap_or_else(|| date.and_hms_opt(0, 0, 0).unwrap())
}

fn minutes_phrase(minutes: i64) -> String {
  if minutes == 1 {
    "1 minute".to_string()
  } else {
    format!("{minutes} minutes")
  }
}

/// The words. Quiet Pip is mentioned once and says less; with Pip off the
/// reminder does not mention Pip at all.
pub fn compose(kind: ReminderKind, voice: PipVoice, remaining: i64, streak: i64, date_key: &str) -> Reminder {
  let left = minutes_phrase(remaining);
  let (title, body) = match (kind, voice) {
    (ReminderKind::Daily, PipVoice::Chatty) => (
      "Time to read?".to_string(),
      format!("Pip's saving you a seat. {left} gets today's goal.")
    ),
    (ReminderKind::Daily, PipVoice::Quiet) => ("Time to read?".to_string(), "Pip's saving you a seat.".to_string()),
    (ReminderKind::Daily, PipVoice::Off) => ("Time to read?".to_string(), format!("{left} of reading meets today's goal.")),
    (ReminderKind::StreakRisk, voice) => {
      let title = format!("Your {streak}-day streak is waiting");
      let body = match voice {
        PipVoice::Chatty => format!("Pip's pacing by the shelf. {left} before midnight keeps it going."),
        PipVoice::Quiet => format!("Pip's keeping watch. {left} before midnight keeps it going."),
        PipVoice::Off => format!("{left} before midnight keeps it going.")
      };
      (title, body)
    }
    (ReminderKind::Close, PipVoice::Chatty) => (
      "So close".to_string(),
      format!("Just {left} more and today's goal is done. Pip's already cheering.")
    ),
    (ReminderKind::Close, _) => ("So close".to_string(), format!("Just {left} more and today's goal is done."))
  };
  Reminder { kind, date_key: date_key.to_string(), title, body }
}

/// When `kind` is meant to go out on the view's day, if it is meant to at all.
/// Shared by both deliveries, so "due now" and "scheduled for later" can never
/// disagree about the rules.
fn occurrence(kind: ReminderKind, settings: &ReminderSettings, habit: &HabitView, date: chrono::NaiveDate) -> Option<NaiveDateTime> {
  if !settings.enabled(kind) || habit.met || habit.goal <= 0 {
    return None;
  }
  let at = match kind {
    ReminderKind::Daily => at_minute(date, settings.daily_at),
    ReminderKind::StreakRisk => {
      if habit.streak <= 0 {
        return None;
      }
      at_minute(date, STREAK_RISK_AT)
    }
    ReminderKind::Close => {
      if habit.goal as f64 - habit.minutes > CLOSE_MARGIN_MINUTES {
        return None;
      }
      let ended = habit.last_session_end.filter(|end| end.date() == date)?;
      ended + Duration::minutes(CLOSE_DELAY_MINUTES)
    }
  };
  // Nothing crosses into the night or into the next day.
  if in_quiet_hours(at) || at.date() != date {
    return None;
  }
  Some(at)
}

/// What the running app should show this minute, if anything.
pub fn due_now(
  settings: &ReminderSettings,
  voice: PipVoice,
  habit: &HabitView,
  activity: Activity,
  log: &FiredLog,
  now: NaiveDateTime
) -> Option<Due> {
  let today = now.date();
  let today_key = today.format("%Y-%m-%d").to_string();
  // Numbers from another day (the clock crossed midnight since they were
  // read) say nothing about today; wait for fresh ones.
  if habit.date_key != today_key || in_quiet_hours(now) || activity.busy() {
    return None;
  }
  let due: Vec<ReminderKind> = ReminderKind::BY_PRIORITY
    .into_iter()
    .filter(|kind| !log.fired_on(*kind, &today_key))
    .filter(|kind| {
      occurrence(*kind, settings, habit, today)
        .map(|at| now >= at && now < at + Duration::minutes(CATCH_UP_MINUTES))
        .unwrap_or(false)
    })
    .collect();
  let (first, rest) = due.split_first()?;
  Some(Due {
    reminder: compose(*first, voice, habit.remaining(), habit.streak, &today_key),
    superseded: rest.to_vec()
  })
}

/// What to leave with Windows when the app closes: whatever is still to come
/// today, and tomorrow's.
///
/// Tomorrow starts from nothing read, so its daily reminder is certain. Its
/// streak reminder is only planned when today is already met, because only
/// then is there certainly a streak to lose; if today is unmet, grace or a
/// freeze may or may not carry it, and a toast about a streak that is already
/// gone would be wrong.
pub fn plan_ahead(
  settings: &ReminderSettings,
  voice: PipVoice,
  habit: &HabitView,
  goal_setting: i64,
  log: &FiredLog,
  now: NaiveDateTime
) -> Vec<Planned> {
  let today = now.date();
  let today_key = today.format("%Y-%m-%d").to_string();
  let mut plans = Vec::new();
  if habit.date_key != today_key {
    return plans;
  }

  for kind in ReminderKind::BY_PRIORITY {
    if log.fired_on(kind, &today_key) {
      continue;
    }
    // A reminder whose moment has come while the reader was here is not
    // sent a minute after they close the app: they have just been reading.
    if let Some(at) = occurrence(kind, settings, habit, today).filter(|at| *at > now) {
      plans.push(Planned {
        reminder: compose(kind, voice, habit.remaining(), habit.streak, &today_key),
        at
      });
    }
  }

  let Some(tomorrow) = today.succ_opt() else {
    return plans;
  };
  let tomorrow_key = tomorrow.format("%Y-%m-%d").to_string();
  let fresh = HabitView {
    date_key: tomorrow_key.clone(),
    minutes: 0.0,
    goal: goal_setting,
    met: false,
    streak: if habit.met { habit.streak } else { 0 },
    last_session_end: None
  };
  for kind in [ReminderKind::StreakRisk, ReminderKind::Daily] {
    if let Some(at) = occurrence(kind, settings, &fresh, tomorrow) {
      plans.push(Planned {
        reminder: compose(kind, voice, fresh.remaining(), fresh.streak, &tomorrow_key),
        at
      });
    }
  }
  plans.sort_by_key(|plan| plan.at);
  plans
}

/// The moment a local wall-clock time happens, in UTC, for Windows' schedule.
///
/// A time that does not exist (the hour skipped when clocks go forward) moves
/// to the first minute after the gap; a time that happens twice (clocks going
/// back) takes the first.
pub fn local_to_utc<Tz: TimeZone>(zone: &Tz, local: NaiveDateTime) -> Option<chrono::DateTime<Utc>> {
  let mut candidate = local;
  // Gaps are an hour, occasionally half; two hours of probing is plenty.
  for _ in 0..=120 {
    match zone.from_local_datetime(&candidate) {
      MappedLocalTime::Single(time) => return Some(time.with_timezone(&Utc)),
      MappedLocalTime::Ambiguous(first, _) => return Some(first.with_timezone(&Utc)),
      MappedLocalTime::None => candidate += Duration::minutes(1)
    }
  }
  None
}

/// The route a Leaflet launch argument asks for, when it is a toast click.
/// Only the one known route is honoured: the protocol is open to any web page,
/// so anything else just opens the app.
pub fn activation_route<I: IntoIterator<Item = String>>(args: I) -> Option<&'static str> {
  args.into_iter().find_map(|arg| {
    let lower = arg.trim().to_ascii_lowercase();
    let rest = lower.strip_prefix(PROTOCOL)?.strip_prefix(':')?;
    Some(if rest.trim_matches('/') == "continue" { "continue" } else { "open" })
  })
}

fn escape_xml(text: &str) -> String {
  text
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
    .replace('\'', "&apos;")
}

/// The toast. `activation` is off for unpackaged builds: without the MSIX's
/// protocol registration a click would open Windows' "find an app" dialog.
pub fn toast_xml(reminder: &Reminder, image: Option<&str>, activation: bool) -> String {
  let launch = if activation {
    format!(" launch=\"{CONTINUE_URI}\" activationType=\"protocol\"")
  } else {
    String::new()
  };
  let image = image
    .map(|src| format!("<image placement=\"appLogoOverride\" src=\"{}\"/>", escape_xml(src)))
    .unwrap_or_default();
  let actions = if activation {
    format!(
      "<actions><action content=\"Continue reading\" activationType=\"protocol\" arguments=\"{CONTINUE_URI}\"/></actions>"
    )
  } else {
    String::new()
  };
  format!(
    "<toast{launch}><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text>{image}</binding></visual>{actions}</toast>",
    escape_xml(&reminder.title),
    escape_xml(&reminder.body)
  )
}

#[cfg(test)]
mod tests {
  use super::*;
  use chrono::{FixedOffset, NaiveDate, Offset};

  fn at(key: &str, hour: u32, minute: u32) -> NaiveDateTime {
    NaiveDate::parse_from_str(key, "%Y-%m-%d")
      .unwrap()
      .and_hms_opt(hour, minute, 0)
      .unwrap()
  }

  fn view(key: &str, minutes: f64, goal: i64, streak: i64) -> HabitView {
    HabitView {
      date_key: key.to_string(),
      minutes,
      goal,
      met: minutes >= goal as f64,
      streak,
      last_session_end: None
    }
  }

  fn all_on() -> ReminderSettings {
    ReminderSettings {
      daily: true,
      daily_at: 19 * 60,
      streak_risk: true,
      close_nudge: true,
      asked: true
    }
  }

  fn idle() -> Activity {
    Activity::default()
  }

  fn due_kind(due: Option<Due>) -> Option<ReminderKind> {
    due.map(|due| due.reminder.kind)
  }

  // ---- due now -----------------------------------------------------------

  #[test]
  fn nothing_is_on_by_default() {
    let settings = ReminderSettings::default();
    assert!(!settings.any_enabled());
    let habit = view("2026-03-03", 0.0, 20, 4);
    for hour in 7..23 {
      let now = at("2026-03-03", hour, 0);
      assert_eq!(due_now(&settings, PipVoice::Chatty, &habit, idle(), &FiredLog::default(), now), None);
    }
  }

  #[test]
  fn the_daily_reminder_fires_at_its_time_when_the_goal_is_not_met() {
    let habit = view("2026-03-03", 5.0, 20, 0);
    let settings = ReminderSettings { daily: true, ..all_on() };
    let log = FiredLog::default();
    assert_eq!(due_kind(due_now(&settings, PipVoice::Chatty, &habit, idle(), &log, at("2026-03-03", 18, 59))), None);
    let due = due_now(&settings, PipVoice::Chatty, &habit, idle(), &log, at("2026-03-03", 19, 0)).unwrap();
    assert_eq!(due.reminder.kind, ReminderKind::Daily);
    assert_eq!(due.reminder.title, "Time to read?");
    assert!(due.reminder.body.starts_with("Pip's saving you a seat."));
    assert!(due.reminder.body.contains("15 minutes"));
  }

  #[test]
  fn a_missed_minute_is_caught_up_but_not_hours_later() {
    let habit = view("2026-03-03", 0.0, 20, 0);
    let log = FiredLog::default();
    // The laptop woke at 19:40: still worth saying.
    assert_eq!(
      due_kind(due_now(&all_on(), PipVoice::Chatty, &habit, idle(), &log, at("2026-03-03", 19, 40))),
      Some(ReminderKind::Daily)
    );
    // At 20:30 the moment has passed.
    assert_eq!(due_kind(due_now(&all_on(), PipVoice::Chatty, &habit, idle(), &log, at("2026-03-03", 20, 30))), None);
  }

  #[test]
  fn nothing_fires_once_the_goal_is_met() {
    let habit = view("2026-03-03", 20.0, 20, 6);
    let log = FiredLog::default();
    for (hour, minute) in [(19, 0), (22, 0), (22, 30)] {
      assert_eq!(
        due_now(&all_on(), PipVoice::Chatty, &habit, idle(), &log, at("2026-03-03", hour, minute)),
        None
      );
    }
  }

  #[test]
  fn each_kind_fires_at_most_once_a_day() {
    let habit = view("2026-03-03", 0.0, 20, 3);
    let mut log = FiredLog::default();
    let first = due_now(&all_on(), PipVoice::Chatty, &habit, idle(), &log, at("2026-03-03", 19, 0)).unwrap();
    log.mark(first.reminder.kind, "2026-03-03");
    assert_eq!(due_kind(due_now(&all_on(), PipVoice::Chatty, &habit, idle(), &log, at("2026-03-03", 19, 1))), None);
  }

  #[test]
  fn the_streak_reminder_needs_a_streak() {
    let settings = ReminderSettings { streak_risk: true, ..ReminderSettings::default() };
    let log = FiredLog::default();
    let no_streak = view("2026-03-03", 0.0, 20, 0);
    assert_eq!(due_now(&settings, PipVoice::Chatty, &no_streak, idle(), &log, at("2026-03-03", 22, 0)), None);
    let streak = view("2026-03-03", 0.0, 20, 12);
    let due = due_now(&settings, PipVoice::Chatty, &streak, idle(), &log, at("2026-03-03", 22, 0)).unwrap();
    assert_eq!(due.reminder.kind, ReminderKind::StreakRisk);
    assert_eq!(due.reminder.title, "Your 12-day streak is waiting");
    assert_eq!(due_kind(due_now(&settings, PipVoice::Chatty, &streak, idle(), &log, at("2026-03-03", 21, 59))), None);
  }

  #[test]
  fn two_due_together_send_one_and_retire_the_other() {
    // A daily reminder set for 22:00 lands with the streak reminder.
    let settings = ReminderSettings { daily_at: STREAK_RISK_AT, ..all_on() };
    let habit = view("2026-03-03", 0.0, 20, 5);
    let due = due_now(&settings, PipVoice::Chatty, &habit, idle(), &FiredLog::default(), at("2026-03-03", 22, 0)).unwrap();
    assert_eq!(due.reminder.kind, ReminderKind::StreakRisk);
    assert_eq!(due.superseded, vec![ReminderKind::Daily]);
  }

  #[test]
  fn no_reminder_while_reading_or_looking_at_leaflet() {
    let habit = view("2026-03-03", 0.0, 20, 0);
    let log = FiredLog::default();
    let now = at("2026-03-03", 19, 5);
    for activity in [
      Activity { session_running: true, ..idle() },
      Activity { book_open: true, ..idle() },
      Activity { focused: true, ..idle() }
    ] {
      assert_eq!(due_now(&all_on(), PipVoice::Chatty, &habit, activity, &log, now), None);
    }
    // Close the book and it goes out, still inside the catch-up window.
    assert!(due_now(&all_on(), PipVoice::Chatty, &habit, idle(), &log, now).is_some());
  }

  #[test]
  fn quiet_hours_are_quiet() {
    assert!(in_quiet_hours(at("2026-03-03", 23, 0)));
    assert!(in_quiet_hours(at("2026-03-03", 3, 0)));
    assert!(in_quiet_hours(at("2026-03-03", 6, 59)));
    assert!(!in_quiet_hours(at("2026-03-03", 7, 0)));
    assert!(!in_quiet_hours(at("2026-03-03", 22, 59)));

    // The streak window closes at quiet time, even inside its catch-up.
    let habit = view("2026-03-03", 0.0, 20, 5);
    let settings = ReminderSettings { streak_risk: true, ..ReminderSettings::default() };
    assert!(due_now(&settings, PipVoice::Chatty, &habit, idle(), &FiredLog::default(), at("2026-03-03", 22, 59)).is_some());
    assert_eq!(due_now(&settings, PipVoice::Chatty, &habit, idle(), &FiredLog::default(), at("2026-03-03", 23, 0)), None);

    // A daily time typed into the night is pulled back out of it.
    let late = ReminderSettings { daily_at: 23 * 60 + 30, ..all_on() }.sanitized();
    assert_eq!(late.daily_at, QUIET_START - 1);
    let early = ReminderSettings { daily_at: 5 * 60, ..all_on() }.sanitized();
    assert_eq!(early.daily_at, QUIET_END);
  }

  #[test]
  fn the_close_nudge_follows_a_session_that_left_the_reader_just_short() {
    let settings = ReminderSettings { close_nudge: true, ..ReminderSettings::default() };
    let mut habit = view("2026-03-03", 16.0, 20, 0);
    habit.last_session_end = Some(at("2026-03-03", 15, 0));
    let log = FiredLog::default();
    assert_eq!(due_now(&settings, PipVoice::Chatty, &habit, idle(), &log, at("2026-03-03", 15, 14)), None);
    let due = due_now(&settings, PipVoice::Chatty, &habit, idle(), &log, at("2026-03-03", 15, 15)).unwrap();
    assert_eq!(due.reminder.kind, ReminderKind::Close);
    assert!(due.reminder.body.contains("4 minutes"));

    // Ten minutes short is not close.
    let mut far = view("2026-03-03", 10.0, 20, 0);
    far.last_session_end = habit.last_session_end;
    assert_eq!(due_now(&settings, PipVoice::Chatty, &far, idle(), &log, at("2026-03-03", 15, 15)), None);

    // No session today, no nudge: it is about a session that just ended.
    let mut yesterday = habit.clone();
    yesterday.last_session_end = Some(at("2026-03-02", 22, 50));
    assert_eq!(due_now(&settings, PipVoice::Chatty, &yesterday, idle(), &log, at("2026-03-03", 15, 15)), None);
  }

  #[test]
  fn the_close_nudge_never_rolls_into_the_night() {
    let settings = ReminderSettings { close_nudge: true, ..ReminderSettings::default() };
    let mut habit = view("2026-03-03", 17.0, 20, 0);
    habit.last_session_end = Some(at("2026-03-03", 22, 50));
    for minute in [5, 10, 30] {
      assert_eq!(due_now(&settings, PipVoice::Chatty, &habit, idle(), &FiredLog::default(), at("2026-03-03", 23, minute)), None);
    }
  }

  #[test]
  fn yesterdays_log_does_not_silence_today() {
    let habit = view("2026-03-04", 0.0, 20, 0);
    let mut log = FiredLog::default();
    log.mark(ReminderKind::Daily, "2026-03-03");
    assert_eq!(
      due_kind(due_now(&all_on(), PipVoice::Chatty, &habit, idle(), &log, at("2026-03-04", 19, 0))),
      Some(ReminderKind::Daily)
    );
  }

  #[test]
  fn numbers_from_before_midnight_are_not_trusted_after_it() {
    // Read at 23:59 on the 3rd, checked at 19:00 on the 4th: wait for fresh.
    let stale = view("2026-03-03", 0.0, 20, 4);
    assert_eq!(due_now(&all_on(), PipVoice::Chatty, &stale, idle(), &FiredLog::default(), at("2026-03-04", 19, 0)), None);
  }

  #[test]
  fn yesterdays_reminder_is_not_caught_up_after_midnight() {
    // Just past midnight: the 19:00 reminder belongs to a day that is over.
    let habit = view("2026-03-04", 0.0, 20, 4);
    for minute in [0, 5, 59] {
      assert_eq!(due_now(&all_on(), PipVoice::Chatty, &habit, idle(), &FiredLog::default(), at("2026-03-04", 0, minute)), None);
    }
  }

  #[test]
  fn the_view_reads_the_ledger_without_changing_it() {
    let mut days = HashMap::new();
    days.insert(
      "2026-03-02".to_string(),
      DayRecord { date_key: "2026-03-02".into(), minutes: 25.0, goal_minutes: 20, freeze_used: false, grace_used: false }
    );
    days.insert(
      "2026-03-03".to_string(),
      DayRecord { date_key: "2026-03-03".into(), minutes: 7.0, goal_minutes: 25, freeze_used: false, grace_used: false }
    );
    let previous = StreakState { current_streak: 1, ..StreakState::default() };
    let habit = HabitView::from_ledger(&days, &previous, 30, "2026-03-03", None);
    assert_eq!(habit.streak, 1, "yesterday counts, today is in progress");
    assert!(!habit.met);
    assert_eq!(habit.goal, 25, "today's row keeps the goal it was credited against");
    assert_eq!(habit.remaining(), 18);

    // No row today yet: the setting applies.
    let fresh = HabitView::from_ledger(&days, &previous, 30, "2026-03-04", None);
    assert_eq!(fresh.goal, 30);
    assert_eq!(fresh.minutes, 0.0);
  }

  // ---- wording -----------------------------------------------------------

  #[test]
  fn pip_off_means_no_pip_in_the_words() {
    for kind in ReminderKind::BY_PRIORITY {
      let off = compose(kind, PipVoice::Off, 5, 3, "2026-03-03");
      assert!(!off.title.contains("Pip") && !off.body.contains("Pip"), "{kind:?}: {off:?}");
      let chatty = compose(kind, PipVoice::Chatty, 5, 3, "2026-03-03");
      assert!(chatty.body.contains("Pip"), "{kind:?}: {chatty:?}");
    }
    assert_eq!(compose(ReminderKind::Daily, PipVoice::Quiet, 5, 0, "2026-03-03").body, "Pip's saving you a seat.");
  }

  #[test]
  fn one_minute_is_singular() {
    let reminder = compose(ReminderKind::Close, PipVoice::Off, 1, 0, "2026-03-03");
    assert!(reminder.body.contains("Just 1 minute more"));
  }

  // ---- planning for a closed app ------------------------------------------

  #[test]
  fn closing_in_the_afternoon_leaves_tonight_and_tomorrow_scheduled() {
    let habit = view("2026-03-03", 5.0, 20, 4);
    let plans = plan_ahead(&all_on(), PipVoice::Chatty, &habit, 20, &FiredLog::default(), at("2026-03-03", 14, 0));
    let summary: Vec<(ReminderKind, NaiveDateTime)> = plans.iter().map(|plan| (plan.reminder.kind, plan.at)).collect();
    assert_eq!(
      summary,
      vec![
        (ReminderKind::Daily, at("2026-03-03", 19, 0)),
        (ReminderKind::StreakRisk, at("2026-03-03", 22, 0)),
        // Today is unmet, so tomorrow's streak is not certain: no streak toast.
        (ReminderKind::Daily, at("2026-03-04", 19, 0))
      ]
    );
    assert_eq!(plans[2].reminder.date_key, "2026-03-04");
    assert!(plans[2].reminder.body.contains("20 minutes"), "tomorrow starts from nothing");
  }

  #[test]
  fn a_met_day_schedules_only_tomorrow_including_its_streak() {
    let habit = view("2026-03-03", 30.0, 20, 5);
    let plans = plan_ahead(&all_on(), PipVoice::Chatty, &habit, 20, &FiredLog::default(), at("2026-03-03", 20, 0));
    let summary: Vec<(ReminderKind, String)> =
      plans.iter().map(|plan| (plan.reminder.kind, plan.reminder.date_key.clone())).collect();
    assert_eq!(
      summary,
      vec![
        (ReminderKind::Daily, "2026-03-04".to_string()),
        (ReminderKind::StreakRisk, "2026-03-04".to_string())
      ]
    );
    assert_eq!(plans[1].reminder.title, "Your 5-day streak is waiting");
  }

  #[test]
  fn a_moment_already_passed_is_not_sent_on_the_way_out() {
    // Closing at 19:30 with the goal unmet: the reader was just here.
    let habit = view("2026-03-03", 5.0, 20, 0);
    let settings = ReminderSettings { daily: true, ..ReminderSettings::default() };
    let plans = plan_ahead(&settings, PipVoice::Chatty, &habit, 20, &FiredLog::default(), at("2026-03-03", 19, 30));
    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].at, at("2026-03-04", 19, 0));
  }

  #[test]
  fn what_already_went_out_today_is_not_scheduled_again() {
    let habit = view("2026-03-03", 5.0, 20, 3);
    let mut log = FiredLog::default();
    log.mark(ReminderKind::StreakRisk, "2026-03-03");
    let plans = plan_ahead(&all_on(), PipVoice::Chatty, &habit, 20, &log, at("2026-03-03", 21, 0));
    assert!(plans.iter().all(|plan| plan.reminder.kind != ReminderKind::StreakRisk || plan.reminder.date_key != "2026-03-03"));
  }

  #[test]
  fn the_close_nudge_is_scheduled_for_after_the_session() {
    let settings = ReminderSettings { close_nudge: true, ..ReminderSettings::default() };
    let mut habit = view("2026-03-03", 16.0, 20, 0);
    habit.last_session_end = Some(at("2026-03-03", 15, 0));
    let plans = plan_ahead(&settings, PipVoice::Quiet, &habit, 20, &FiredLog::default(), at("2026-03-03", 15, 2));
    assert_eq!(plans.len(), 1, "never for tomorrow: there is no session yet");
    assert_eq!(plans[0].at, at("2026-03-03", 15, 15));
  }

  #[test]
  fn nothing_is_planned_when_everything_is_off() {
    let habit = view("2026-03-03", 0.0, 20, 9);
    assert!(plan_ahead(&ReminderSettings::default(), PipVoice::Chatty, &habit, 20, &FiredLog::default(), at("2026-03-03", 8, 0)).is_empty());
  }

  #[test]
  fn closing_after_quiet_hours_begin_plans_only_tomorrow() {
    let habit = view("2026-03-03", 0.0, 20, 2);
    let plans = plan_ahead(&all_on(), PipVoice::Chatty, &habit, 20, &FiredLog::default(), at("2026-03-03", 23, 40));
    assert!(plans.iter().all(|plan| plan.reminder.date_key == "2026-03-04"));
    assert!(plans.iter().all(|plan| !in_quiet_hours(plan.at)));
  }

  #[test]
  fn the_next_launch_counts_toasts_that_went_out_while_closed() {
    let habit = view("2026-03-03", 5.0, 20, 4);
    let plans = plan_ahead(&all_on(), PipVoice::Chatty, &habit, 20, &FiredLog::default(), at("2026-03-03", 14, 0));
    let records: Vec<ScheduledRecord> = plans.iter().map(ScheduledRecord::of).collect();
    let mut log = FiredLog::default();
    // Reopened at 19:10: the 19:00 toast went out, the 22:00 one did not.
    settle_scheduled(&mut log, &records, at("2026-03-03", 19, 10));
    assert!(log.fired_on(ReminderKind::Daily, "2026-03-03"));
    assert!(!log.fired_on(ReminderKind::StreakRisk, "2026-03-03"));
    assert_eq!(due_now(&all_on(), PipVoice::Chatty, &habit, idle(), &log, at("2026-03-03", 19, 11)), None);
  }

  // ---- time zones ----------------------------------------------------------

  #[test]
  fn delivery_time_follows_the_readers_zone() {
    let india = FixedOffset::east_opt(5 * 3600 + 1800).unwrap();
    let utc = local_to_utc(&india, at("2026-03-03", 19, 0)).unwrap();
    assert_eq!(utc.naive_utc(), at("2026-03-03", 13, 30));

    // West of UTC, an evening reminder is already tomorrow in UTC.
    let pacific = FixedOffset::west_opt(8 * 3600).unwrap();
    let utc = local_to_utc(&pacific, at("2026-03-03", 22, 0)).unwrap();
    assert_eq!(utc.naive_utc(), at("2026-03-04", 6, 0));
  }

  /// A zone that springs forward at 22:00 on 2026-03-29 (a stand-in for the
  /// few real zones that change clocks in the evening): 22:00-22:59 never
  /// happens there.
  #[derive(Clone, Debug)]
  struct EveningSpring;

  impl EveningSpring {
    fn before() -> FixedOffset {
      FixedOffset::east_opt(3600).unwrap()
    }
    fn after() -> FixedOffset {
      FixedOffset::east_opt(2 * 3600).unwrap()
    }
  }

  impl TimeZone for EveningSpring {
    type Offset = FixedOffset;

    fn from_offset(_offset: &FixedOffset) -> Self {
      EveningSpring
    }

    fn offset_from_local_date(&self, _local: &NaiveDate) -> MappedLocalTime<FixedOffset> {
      MappedLocalTime::Single(Self::before())
    }

    fn offset_from_local_datetime(&self, local: &NaiveDateTime) -> MappedLocalTime<FixedOffset> {
      if *local < at("2026-03-29", 22, 0) {
        MappedLocalTime::Single(Self::before())
      } else if *local < at("2026-03-29", 23, 0) {
        MappedLocalTime::None
      } else {
        MappedLocalTime::Single(Self::after())
      }
    }

    fn offset_from_utc_date(&self, _utc: &NaiveDate) -> FixedOffset {
      Self::before()
    }

    fn offset_from_utc_datetime(&self, utc: &NaiveDateTime) -> FixedOffset {
      if *utc < at("2026-03-29", 21, 0) {
        Self::before()
      } else {
        Self::after()
      }
    }
  }

  #[test]
  fn a_time_the_clocks_skip_moves_to_the_end_of_the_gap() {
    let utc = local_to_utc(&EveningSpring, at("2026-03-29", 22, 0)).unwrap();
    // 23:00 local at +02:00.
    assert_eq!(utc.naive_utc(), at("2026-03-29", 21, 0));
    assert_eq!(EveningSpring.offset_from_utc_datetime(&utc.naive_utc()).fix(), EveningSpring::after());
    // An ordinary evening is untouched.
    let utc = local_to_utc(&EveningSpring, at("2026-03-28", 22, 0)).unwrap();
    assert_eq!(utc.naive_utc(), at("2026-03-28", 21, 0));
  }

  // ---- activation and the toast -------------------------------------------

  #[test]
  fn only_the_known_route_is_honoured() {
    let args = |list: &[&str]| list.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
    assert_eq!(activation_route(args(&["leaflet.exe", "leaflet-reader://continue"])), Some("continue"));
    assert_eq!(activation_route(args(&["leaflet.exe", "LEAFLET-READER://continue/"])), Some("continue"));
    assert_eq!(activation_route(args(&["leaflet.exe", "leaflet-reader://delete-everything"])), Some("open"));
    assert_eq!(activation_route(args(&["leaflet.exe", "C:\\Books\\novel.epub"])), None);
    assert_eq!(activation_route(args(&["leaflet.exe", "leaflet-readerx://continue"])), None);
  }

  #[test]
  fn the_toast_escapes_its_text_and_only_links_when_packaged() {
    let reminder = Reminder {
      kind: ReminderKind::Daily,
      date_key: "2026-03-03".into(),
      title: "Tom & Jerry's <time>".into(),
      body: "\"quoted\"".into()
    };
    let packaged = toast_xml(&reminder, Some("ms-appx:///Assets/PipToast.png"), true);
    assert!(packaged.contains("Tom &amp; Jerry&apos;s &lt;time&gt;"));
    assert!(packaged.contains("&quot;quoted&quot;"));
    assert!(packaged.contains("launch=\"leaflet-reader://continue\" activationType=\"protocol\""));
    assert!(packaged.contains("placement=\"appLogoOverride\" src=\"ms-appx:///Assets/PipToast.png\""));
    let unpackaged = toast_xml(&reminder, None, false);
    assert!(!unpackaged.contains("launch="));
    assert!(!unpackaged.contains("<actions>"));
    assert!(!unpackaged.contains("<image"));
  }
}
