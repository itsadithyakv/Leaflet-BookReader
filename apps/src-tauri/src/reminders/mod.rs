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
//!
//! On Android the phone's alarm clock delivers everything, open or closed
//! (`phone`): the same [`plan_ahead`] is handed over again whenever anything
//! it depends on changes, each alarm carrying the latest moment it may still
//! go out ([`deliver_until`]).

use crate::habit::{self, DayRecord, StreakState};
use chrono::{Datelike, Duration, MappedLocalTime, NaiveDateTime, TimeZone, Timelike, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[cfg(target_os = "android")]
pub mod phone;
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
/// "Your year in pages" goes out on Christmas Eve, the first day the Library's
/// festive key is up...
pub const YEAR_MONTH: u32 = 12;
pub const YEAR_DAY: u32 = 24;
/// ...in the morning, when there is a whole day left to look at it.
pub const YEAR_AT: u32 = 10 * 60;
/// It is left with Windows or the phone this many days ahead, so a reader who
/// does not open Leaflet for a week before Christmas still gets it.
pub const YEAR_PLAN_DAYS: i64 = 14;

/// Protocol a toast click launches, registered in the MSIX manifest.
pub const PROTOCOL: &str = "leaflet-reader";
/// Where a toast click lands: the book the reader was last in.
pub const CONTINUE_URI: &str = "leaflet-reader://continue";
/// Where the year's toast lands: just Leaflet, whose Library has the key.
#[cfg(any(windows, test))]
pub const OPEN_URI: &str = "leaflet-reader://open";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReminderKind {
  Daily,
  StreakRisk,
  Close,
  /// "Your year in pages", once a year. Not a nudge to read: it keeps none of
  /// the daily rules (the goal, the streak) and is never part of their contest.
  Year
}

impl ReminderKind {
  /// The daily kinds, most urgent first: when two are due in the same minute,
  /// one goes out. The year's notice is not among them, so it never retires a
  /// daily reminder and none retires it.
  pub const BY_PRIORITY: [ReminderKind; 3] =
    [ReminderKind::StreakRisk, ReminderKind::Daily, ReminderKind::Close];

  /// Every kind the log keeps.
  #[cfg(any(target_os = "android", test))]
  const ALL: [ReminderKind; 4] =
    [ReminderKind::StreakRisk, ReminderKind::Daily, ReminderKind::Close, ReminderKind::Year];

  /// The toast (or notification) tag, so a new reminder of a kind replaces
  /// the last one.
  #[cfg(any(windows, target_os = "android", test))]
  pub fn tag(self) -> &'static str {
    match self {
      ReminderKind::Daily => "daily",
      ReminderKind::StreakRisk => "streak",
      ReminderKind::Close => "close",
      ReminderKind::Year => "year"
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
      ReminderKind::Close => self.close_nudge,
      // There is no switch of its own: a reader who said yes to any reminder
      // gets this one, and one who said no to all hears nothing.
      ReminderKind::Year => self.any_enabled()
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
  /// a freeze or announce a break, which is `build_snapshot`'s job.
  pub fn from_ledger(
    days: &HashMap<String, DayRecord>,
    freezes_bought: &[String],
    previous: &StreakState,
    goal_setting: i64,
    today_key: &str,
    last_session_end: Option<NaiveDateTime>
  ) -> Self {
    let evaluation = habit::evaluate(days, freezes_bought, today_key, previous);
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

/// The last local day each kind went out, so none fires twice in a day (and
/// the year's notice not twice in a year).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FiredLog {
  pub daily: Option<String>,
  pub streak_risk: Option<String>,
  pub close: Option<String>,
  /// The day "your year in pages" went out. Logs from before it read as never.
  pub year: Option<String>
}

impl FiredLog {
  fn slot(&mut self, kind: ReminderKind) -> &mut Option<String> {
    match kind {
      ReminderKind::Daily => &mut self.daily,
      ReminderKind::StreakRisk => &mut self.streak_risk,
      ReminderKind::Close => &mut self.close,
      ReminderKind::Year => &mut self.year
    }
  }

  fn get(&self, kind: ReminderKind) -> &Option<String> {
    match kind {
      ReminderKind::Daily => &self.daily,
      ReminderKind::StreakRisk => &self.streak_risk,
      ReminderKind::Close => &self.close,
      ReminderKind::Year => &self.year
    }
  }

  /// Whether `kind` already went out on that day; for the year's notice, on
  /// any day of that year.
  pub fn fired_on(&self, kind: ReminderKind, date_key: &str) -> bool {
    let fired = self.get(kind).as_deref();
    match kind {
      ReminderKind::Year => fired.and_then(|day| day.get(..4)).is_some_and(|year| Some(year) == date_key.get(..4)),
      _ => fired == Some(date_key)
    }
  }

  pub fn mark(&mut self, kind: ReminderKind, date_key: &str) {
    *self.slot(kind) = Some(date_key.to_string());
  }

  /// Takes in what another record says went out (the phone's alarm clock
  /// delivers while the app is closed), keeping the later day of each kind.
  /// Returns whether anything changed.
  #[cfg(any(target_os = "android", test))]
  pub fn merge(&mut self, other: &FiredLog) -> bool {
    let mut changed = false;
    for kind in ReminderKind::ALL {
      let Some(theirs) = other.get(kind) else {
        continue;
      };
      let ours = self.slot(kind);
      // `YYYY-MM-DD` sorts as it reads.
      if ours.as_deref().map(|day| day < theirs.as_str()).unwrap_or(true) {
        *ours = Some(theirs.clone());
        changed = true;
      }
    }
    changed
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
  // Quiet runs over midnight: every minute outside the waking span.
  !(QUIET_END..QUIET_START).contains(&minute)
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

/// The lines a reminder can say, for its kind and Pip's voice: (title, body),
/// with `{left}` the minutes still to read, `{streak}` the days so far and
/// `{next}` the day the streak reaches if today is read. Chatty Pip has the
/// most to say; quiet Pip mentions herself at most once and briefly; with Pip
/// off nothing mentions her. Kind, never a telling-off: a reminder is an
/// invitation (the owner, 2026-10-15: "fun notifications, not the same all
/// the time").
fn lines(kind: ReminderKind, voice: PipVoice, weekend: bool) -> Vec<(&'static str, &'static str)> {
  let mut lines = match (kind, voice) {
    (ReminderKind::Daily, PipVoice::Chatty) => vec![
      ("Time to read?", "Pip's saving you a seat. {left} gets today's goal."),
      ("Your book misses you", "It's been sitting very still all day, Pip says. {left} and it's a happy book again."),
      ("Your bookmark is waiting", "Pip found it right where you left it. {left} would make today count."),
      ("Psst. Chapter time?", "Pip has fluffed every cushion in the house. {left} to today's goal."),
      ("A page or two?", "Even a few pages count. {left} meets the goal, and Pip does a little spin."),
      ("Story o'clock", "The characters want to know what happens next. So does Pip. {left} to go."),
      ("Open your book?", "Pip wants to read over your shoulder. {left} gets today's goal."),
      ("Tea, blanket, book?", "Pip can't make tea, but she can keep you company for {left}.")
    ],
    (ReminderKind::Daily, PipVoice::Quiet) => vec![
      ("Time to read?", "Pip's saving you a seat."),
      ("A few pages?", "Your book is right where you left it."),
      ("Story o'clock", "{left} to today's goal."),
      ("Your book's waiting", "Pip kept your place."),
      ("Reading time", "{left} and today counts.")
    ],
    (ReminderKind::Daily, PipVoice::Off) => vec![
      ("Time to read?", "{left} of reading meets today's goal."),
      ("A few pages?", "Your book is right where you left it. {left} to today's goal."),
      ("Story o'clock", "{left} and today's reading is done."),
      ("Your book's waiting", "{left} gets today's goal.")
    ],
    (ReminderKind::StreakRisk, PipVoice::Chatty) => vec![
      ("Your {streak}-day streak is waiting", "Pip's pacing by the shelf. {left} before midnight keeps it going."),
      ("{streak} days and counting?", "Pip has the confetti ready. {left} before midnight makes it {next}."),
      ("{streak} days, and heavy too", "Pip is holding your streak for you. {left} before midnight and it's yours again."),
      ("Last call for today", "{left} keeps your {streak}-day streak. Pip's leaving the lamp on."),
      ("Day {next} is right there", "One more evening chapter. {left} before midnight, and Pip will be insufferable about it.")
    ],
    (ReminderKind::StreakRisk, PipVoice::Quiet) => vec![
      ("Your {streak}-day streak is waiting", "Pip's keeping watch. {left} before midnight keeps it going."),
      ("Keep your {streak}-day streak?", "{left} before midnight. Pip's leaving the lamp on."),
      ("{streak} days so far", "{left} tonight makes it {next}.")
    ],
    (ReminderKind::StreakRisk, PipVoice::Off) => vec![
      ("Your {streak}-day streak is waiting", "{left} before midnight keeps it going."),
      ("Keep the streak going?", "{left} tonight and it's {next} days."),
      ("{streak} days so far", "{left} before midnight keeps it going.")
    ],
    (ReminderKind::Close, PipVoice::Chatty) => vec![
      ("So close", "Just {left} more and today's goal is done. Pip's already cheering."),
      ("Nearly there!", "{left} left. Pip has started the victory dance a little early."),
      ("Almost!", "You stopped {left} short. Pip's holding the door open."),
      ("Just a smidge more", "{left} and today's goal is done. Pip is counting on her leaves.")
    ],
    (ReminderKind::Close, _) => vec![
      ("So close", "Just {left} more and today's goal is done."),
      ("Nearly there", "{left} left for today's goal."),
      ("Almost done", "{left} more and today counts.")
    ],
    // Once a year, so one line each: there is no yesterday's to differ from.
    (ReminderKind::Year, PipVoice::Chatty) => vec![("Your {year} in pages", "Pip has your whole year of reading ready to show you.")],
    (ReminderKind::Year, PipVoice::Quiet) => vec![("Your {year} in pages", "Pip kept every page. Come and see.")],
    (ReminderKind::Year, PipVoice::Off) => vec![("Your {year} in pages", "Every page you read this year, in one place.")]
  };
  // A Saturday or a Sunday has lines of its own, when there's time for more.
  // (Saturday and Sunday are consecutive days on one list, so `line_for`
  // still never repeats a line; Friday and Monday are on the other list.)
  if weekend && kind == ReminderKind::Daily {
    lines = match voice {
      PipVoice::Chatty => vec![
        ("A slow weekend read?", "Pip votes for a blanket, a book and {left}. The motion carries."),
        ("Weekend chapter?", "No alarms, no rush. Pip has found the comfiest spot for {left}."),
        ("Any day ending in -day", "is a reading day, says Pip. {left} to today's goal."),
        ("Cosy weekend plans?", "Pip has stolen your blanket and wants {left} of story before she gives it back.")
      ],
      PipVoice::Quiet => vec![
        ("A weekend chapter?", "{left} to today's goal."),
        ("Weekend pages?", "Pip kept your place."),
        ("A slow read?", "{left} and today counts.")
      ],
      PipVoice::Off => vec![
        ("A weekend chapter?", "{left} of reading meets today's goal."),
        ("Weekend pages?", "Your book is right where you left it. {left} to go."),
        ("A slow read?", "{left} and today's reading is done.")
      ]
    };
  }
  lines
}

/// Which of `count` lines a day gets: the same all day (a reminder planned
/// again in the afternoon keeps its words), and never the line of the day
/// before. Each day moves a fixed step through the list, a step that shares
/// no factor with its length, so consecutive days always differ and every
/// line comes round; each kind starts from its own place.
fn line_for(count: usize, kind: ReminderKind, date_key: &str) -> usize {
  if count <= 1 {
    return 0;
  }
  let day = chrono::NaiveDate::parse_from_str(date_key, "%Y-%m-%d")
    .map(|date| i64::from(date.num_days_from_ce()))
    .unwrap_or(0);
  let start = match kind {
    ReminderKind::Daily => 0,
    ReminderKind::StreakRisk => 1,
    ReminderKind::Close => 2,
    ReminderKind::Year => 3
  };
  let gcd = |mut a: usize, mut b: usize| {
    while b != 0 {
      (a, b) = (b, a % b);
    }
    a
  };
  // 3 reads less like counting than 1; the first that fits the length.
  let step = [3, 2, 1].into_iter().find(|&step| step < count && gcd(step, count) == 1).unwrap_or(1);
  ((day.rem_euclid(count as i64) as usize) * step + start) % count
}

/// The words. Which line is chosen by the day (`line_for`), so the same kind
/// of reminder says something new each day but the same thing all day.
/// `{year}` is the year of `date_key`, for the year's notice.
pub fn compose(kind: ReminderKind, voice: PipVoice, remaining: i64, streak: i64, date_key: &str) -> Reminder {
  let weekend = chrono::NaiveDate::parse_from_str(date_key, "%Y-%m-%d")
    .map(|date| matches!(date.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun))
    .unwrap_or(false);
  let choices = lines(kind, voice, weekend);
  let (title, body) = choices[line_for(choices.len(), kind, date_key)];
  let fill = |text: &str| {
    text
      .replace("{left}", &minutes_phrase(remaining))
      .replace("{streak}", &streak.to_string())
      .replace("{next}", &(streak + 1).to_string())
      .replace("{year}", date_key.get(..4).unwrap_or_default())
  };
  // A line that starts with the minutes reads better with a capital.
  let body = capitalise(&fill(body));
  Reminder { kind, date_key: date_key.to_string(), title: fill(title), body }
}

fn capitalise(text: &str) -> String {
  let mut chars = text.chars();
  match chars.next() {
    Some(first) => first.to_uppercase().chain(chars).collect(),
    None => String::new()
  }
}

/// When `kind` is meant to go out on the view's day, if it is meant to at all.
/// Shared by both deliveries, so "due now" and "scheduled for later" can never
/// disagree about the rules.
fn occurrence(kind: ReminderKind, settings: &ReminderSettings, habit: &HabitView, date: chrono::NaiveDate) -> Option<NaiveDateTime> {
  if !settings.enabled(kind) {
    return None;
  }
  // The year's notice is not about today's reading, so a met goal (or none)
  // does not stop it.
  if kind != ReminderKind::Year && (habit.met || habit.goal <= 0) {
    return None;
  }
  let at = match kind {
    ReminderKind::Year => {
      if (date.month(), date.day()) != (YEAR_MONTH, YEAR_DAY) {
        return None;
      }
      at_minute(date, YEAR_AT)
    }
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
  let in_window = |kind: ReminderKind| {
    !log.fired_on(kind, &today_key)
      && occurrence(kind, settings, habit, today).is_some_and(|at| now >= at && now < deliver_until(kind, at))
  };
  let due: Vec<ReminderKind> = ReminderKind::BY_PRIORITY.into_iter().filter(|kind| in_window(*kind)).collect();
  if let Some((first, rest)) = due.split_first() {
    return Some(Due {
      reminder: compose(*first, voice, habit.remaining(), habit.streak, &today_key),
      superseded: rest.to_vec()
    });
  }
  // The year's notice is not in that contest: due with a daily reminder, it
  // waits a minute rather than being retired, and it retires nothing.
  in_window(ReminderKind::Year).then(|| Due {
    reminder: compose(ReminderKind::Year, voice, habit.remaining(), habit.streak, &today_key),
    superseded: Vec::new()
  })
}

/// The year's notice to leave with Windows or the phone: from
/// [`YEAR_PLAN_DAYS`] before its day, unless it already went out this year.
/// If its moment came while the reader was here (the Library's key said it
/// for it), it is left for a little after they go, as the running app sends
/// it once they look away; never into the night or past its day.
fn year_ahead(settings: &ReminderSettings, voice: PipVoice, habit: &HabitView, log: &FiredLog, now: NaiveDateTime) -> Option<Planned> {
  let day = chrono::NaiveDate::from_ymd_opt(now.year(), YEAR_MONTH, YEAR_DAY)?;
  let key = day.format("%Y-%m-%d").to_string();
  if log.fired_on(ReminderKind::Year, &key) || (day - now.date()).num_days() > YEAR_PLAN_DAYS {
    return None;
  }
  let moment = occurrence(ReminderKind::Year, settings, habit, day)?;
  let at = moment.max(now + Duration::minutes(CLOSE_DELAY_MINUTES));
  if at >= deliver_until(ReminderKind::Year, moment) {
    return None;
  }
  Some(Planned { reminder: compose(ReminderKind::Year, voice, habit.remaining(), habit.streak, &key), at })
}

/// What to leave with Windows when the app closes: whatever is still to come
/// today, and tomorrow's (and, before Christmas, the year's notice).
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
  plans.extend(year_ahead(settings, voice, habit, log, now));

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

/// The latest a reminder meant for `at` may still go out late (a laptop
/// asleep, a phone saving battery, Leaflet in front): within the catch-up,
/// and never into the night. The year's notice has the rest of its day: it is
/// about the year, not this evening's reading.
pub fn deliver_until(kind: ReminderKind, at: NaiveDateTime) -> NaiveDateTime {
  let night = at_minute(at.date(), QUIET_START);
  match kind {
    ReminderKind::Year => night,
    _ => (at + Duration::minutes(CATCH_UP_MINUTES)).min(night)
  }
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

#[cfg(any(windows, test))]
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
/// The year's toast only opens Leaflet: it is not about the book.
#[cfg(any(windows, test))]
pub fn toast_xml(reminder: &Reminder, image: Option<&str>, activation: bool) -> String {
  let to_book = reminder.kind != ReminderKind::Year;
  let launch = if activation {
    format!(" launch=\"{}\" activationType=\"protocol\"", if to_book { CONTINUE_URI } else { OPEN_URI })
  } else {
    String::new()
  };
  let image = image
    .map(|src| format!("<image placement=\"appLogoOverride\" src=\"{}\"/>", escape_xml(src)))
    .unwrap_or_default();
  let actions = if activation && to_book {
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
    // Today's line, whichever it is, with the minutes still to read.
    assert_eq!(due.reminder, compose(ReminderKind::Daily, PipVoice::Chatty, 15, 0, "2026-03-03"));
    assert!(due.reminder.body.contains("15 minutes"), "{:?}", due.reminder);
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
    let habit = HabitView::from_ledger(&days, &[], &previous, 30, "2026-03-03", None);
    assert_eq!(habit.streak, 1, "yesterday counts, today is in progress");
    assert!(!habit.met);
    assert_eq!(habit.goal, 25, "today's row keeps the goal it was credited against");
    assert_eq!(habit.remaining(), 18);

    // No row today yet: the setting applies.
    let fresh = HabitView::from_ledger(&days, &[], &previous, 30, "2026-03-04", None);
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
    for (title, body) in lines(ReminderKind::Daily, PipVoice::Quiet, true).into_iter().chain(lines(ReminderKind::Daily, PipVoice::Quiet, false)) {
      assert!(format!("{title} {body}").matches("Pip").count() <= 1, "{title} {body}");
    }
  }

  #[test]
  fn one_minute_is_singular() {
    for day in days(14) {
      for kind in KINDS {
        for voice in VOICES {
          let reminder = compose(kind, voice, 1, 4, &day);
          let text = format!("{} {}", reminder.title, reminder.body);
          assert!(!text.contains("1 minutes"), "{text}");
        }
      }
    }
  }

  const KINDS: [ReminderKind; 3] = [ReminderKind::Daily, ReminderKind::StreakRisk, ReminderKind::Close];
  const VOICES: [PipVoice; 3] = [PipVoice::Chatty, PipVoice::Quiet, PipVoice::Off];

  /// `count` days in a row from 2026-03-01 (a Sunday), as date keys.
  fn days(count: i64) -> Vec<String> {
    let first = chrono::NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
    (0..count).map(|offset| (first + Duration::days(offset)).format("%Y-%m-%d").to_string()).collect()
  }

  #[test]
  fn a_reminder_says_the_same_thing_all_day_and_something_new_the_next() {
    for kind in KINDS {
      for voice in VOICES {
        let said: Vec<Reminder> = days(60).iter().map(|day| compose(kind, voice, 12, 7, day)).collect();
        for (index, reminder) in said.iter().enumerate() {
          // Planned again later the same day, it keeps its words.
          assert_eq!(*reminder, compose(kind, voice, 12, 7, &reminder.date_key));
          if index > 0 {
            assert_ne!(
              (&reminder.title, &reminder.body),
              (&said[index - 1].title, &said[index - 1].body),
              "{kind:?} {voice:?} repeated on {}",
              reminder.date_key
            );
          }
        }
        let different: std::collections::HashSet<&String> = said.iter().map(|reminder| &reminder.title).collect();
        assert!(different.len() >= 3, "{kind:?} {voice:?} had only {} titles in 60 days", different.len());
      }
    }
  }

  #[test]
  fn every_line_is_filled_in_and_pip_speaks_only_when_she_is_on() {
    for day in days(21) {
      for kind in KINDS {
        for voice in VOICES {
          let reminder = compose(kind, voice, 12, 7, &day);
          let text = format!("{} {}", reminder.title, reminder.body);
          assert!(!text.contains('{') && !text.contains('}'), "unfilled: {text}");
          assert!(reminder.body.chars().next().is_some_and(|first| !first.is_lowercase()), "{text}");
          let pips = text.matches("Pip").count();
          match voice {
            PipVoice::Off => assert_eq!(pips, 0, "{text}"),
            PipVoice::Quiet => assert!(pips <= 1, "{text}"),
            PipVoice::Chatty => {}
          }
          if kind == ReminderKind::StreakRisk {
            assert!(text.contains('7') || text.contains('8'), "the streak is not mentioned: {text}");
          }
        }
      }
    }
  }

  #[test]
  fn a_weekend_has_lines_of_its_own() {
    for day in days(366) {
      let date = chrono::NaiveDate::parse_from_str(&day, "%Y-%m-%d").unwrap();
      let weekend = matches!(date.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun);
      for voice in VOICES {
        let said = compose(ReminderKind::Daily, voice, 12, 0, &day);
        let from_weekend = lines(ReminderKind::Daily, voice, true)
          .iter()
          .any(|(title, _)| said.title == title.replace("{left}", "12 minutes"));
        assert_eq!(from_weekend, weekend, "{day} {voice:?}: {said:?}");
      }
    }
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
    // Its words are tomorrow's line for a 5-day streak (which line varies by the day).
    assert_eq!(plans[1].reminder, compose(ReminderKind::StreakRisk, PipVoice::Chatty, 20, 5, "2026-03-04"));
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

  // ---- the phone's alarm clock ----------------------------------------------

  #[test]
  fn a_late_alarm_may_go_out_within_the_hour_but_never_at_night() {
    assert_eq!(deliver_until(ReminderKind::Daily, at("2026-03-03", 19, 0)), at("2026-03-03", 20, 0));
    // "Streak at risk" at 22:00 may run until the night starts, not past it.
    assert_eq!(deliver_until(ReminderKind::StreakRisk, at("2026-03-03", 22, 0)), at("2026-03-03", 23, 0));
    assert_eq!(deliver_until(ReminderKind::Close, at("2026-03-03", 22, 50)), at("2026-03-03", 23, 0));
  }

  #[test]
  fn what_the_phone_delivered_counts_as_sent() {
    let mut log = FiredLog::default();
    log.mark(ReminderKind::Daily, "2026-03-02");
    let phone = FiredLog {
      daily: Some("2026-03-03".to_string()),
      streak_risk: None,
      close: Some("2026-03-03".to_string()),
      year: None
    };
    assert!(log.merge(&phone));
    assert!(log.fired_on(ReminderKind::Daily, "2026-03-03"));
    assert!(log.fired_on(ReminderKind::Close, "2026-03-03"));
    assert_eq!(log.streak_risk, None);
    // Nothing new the second time, and an older day never wins.
    assert!(!log.merge(&phone));
    let older = FiredLog { daily: Some("2026-03-01".to_string()), ..FiredLog::default() };
    assert!(!log.merge(&older));
    assert!(log.fired_on(ReminderKind::Daily, "2026-03-03"));
  }

  #[test]
  fn one_close_nudge_a_day_even_after_a_second_short_session() {
    // The phone said "so close" at 15:15; a second short session ends at 17:00.
    let settings = ReminderSettings { close_nudge: true, ..ReminderSettings::default() };
    let mut log = FiredLog::default();
    log.merge(&FiredLog { close: Some("2026-03-03".to_string()), ..FiredLog::default() });
    let mut habit = view("2026-03-03", 18.0, 20, 0);
    habit.last_session_end = Some(at("2026-03-03", 17, 0));
    let plans = plan_ahead(&settings, PipVoice::Chatty, &habit, 20, &log, at("2026-03-03", 17, 1));
    assert!(plans.is_empty());
  }

  #[test]
  fn meeting_the_goal_leaves_the_phone_nothing_for_today() {
    // Handed over at 14:00 with today unmet, then again once the goal is met:
    // the second plan replaces the first, so tonight's alarms are gone.
    let before = plan_ahead(&all_on(), PipVoice::Chatty, &view("2026-03-03", 5.0, 20, 4), 20, &FiredLog::default(), at("2026-03-03", 14, 0));
    assert!(before.iter().any(|plan| plan.reminder.date_key == "2026-03-03"));
    let after = plan_ahead(&all_on(), PipVoice::Chatty, &view("2026-03-03", 21.0, 20, 5), 20, &FiredLog::default(), at("2026-03-03", 14, 30));
    assert!(after.iter().all(|plan| plan.reminder.date_key == "2026-03-04"));
    assert!(!after.is_empty(), "tomorrow is still planned");
  }

  // ---- the year in pages ----------------------------------------------------

  fn one_on() -> ReminderSettings {
    ReminderSettings { close_nudge: true, ..ReminderSettings::default() }
  }

  fn year_due(settings: &ReminderSettings, habit: &HabitView, activity: Activity, log: &FiredLog, now: NaiveDateTime) -> bool {
    due_kind(due_now(settings, PipVoice::Chatty, habit, activity, log, now)) == Some(ReminderKind::Year)
  }

  fn year_planned(settings: &ReminderSettings, habit: &HabitView, log: &FiredLog, now: NaiveDateTime) -> Option<Planned> {
    plan_ahead(settings, PipVoice::Chatty, habit, 20, log, now)
      .into_iter()
      .find(|plan| plan.reminder.kind == ReminderKind::Year)
  }

  #[test]
  fn the_year_is_told_only_to_a_reader_with_a_reminder_on() {
    let habit = view("2026-12-24", 0.0, 20, 0);
    let now = at("2026-12-24", 10, 0);
    let early = at("2026-12-20", 9, 0);
    let off = ReminderSettings { asked: true, ..ReminderSettings::default() };
    assert!(!year_due(&off, &habit, idle(), &FiredLog::default(), now));
    assert!(year_planned(&off, &view("2026-12-20", 0.0, 20, 0), &FiredLog::default(), early).is_none());
    for settings in [
      ReminderSettings { daily: true, ..off.clone() },
      ReminderSettings { streak_risk: true, ..off.clone() },
      ReminderSettings { close_nudge: true, ..off.clone() }
    ] {
      assert!(year_due(&settings, &habit, idle(), &FiredLog::default(), now), "{settings:?}");
      let plan = year_planned(&settings, &view("2026-12-20", 0.0, 20, 0), &FiredLog::default(), early).unwrap();
      assert_eq!(plan.at, at("2026-12-24", 10, 0));
    }
  }

  #[test]
  fn the_year_goes_out_on_christmas_eve_from_ten_until_the_night() {
    let settings = one_on();
    let log = FiredLog::default();
    let habit = view("2026-12-24", 0.0, 20, 0);
    assert!(!year_due(&settings, &habit, idle(), &log, at("2026-12-24", 9, 59)));
    assert!(year_due(&settings, &habit, idle(), &log, at("2026-12-24", 10, 0)));
    // Not a nudge with an hour's catch-up: the whole day is its own.
    assert!(year_due(&settings, &habit, idle(), &log, at("2026-12-24", 16, 30)));
    assert!(year_due(&settings, &habit, idle(), &log, at("2026-12-24", 22, 59)));
    assert!(!year_due(&settings, &habit, idle(), &log, at("2026-12-24", 23, 0)));
    // Missed on the 24th, it is not said on the 25th, nor on any other day.
    assert!(!year_due(&settings, &view("2026-12-25", 0.0, 20, 0), idle(), &log, at("2026-12-25", 10, 0)));
    assert!(!year_due(&settings, &view("2026-12-23", 0.0, 20, 0), idle(), &log, at("2026-12-23", 10, 0)));
    // On the phone, a late alarm has the same span.
    assert_eq!(deliver_until(ReminderKind::Year, at("2026-12-24", 10, 0)), at("2026-12-24", 23, 0));
  }

  #[test]
  fn the_year_waits_while_the_reader_is_looking_at_leaflet() {
    let settings = one_on();
    let habit = view("2026-12-24", 0.0, 20, 0);
    let log = FiredLog::default();
    let now = at("2026-12-24", 10, 0);
    for activity in [
      Activity { session_running: true, ..idle() },
      Activity { book_open: true, ..idle() },
      Activity { focused: true, ..idle() }
    ] {
      assert!(!year_due(&settings, &habit, activity, &log, now));
    }
    // They look away in the afternoon: it still goes out.
    assert!(year_due(&settings, &habit, idle(), &log, at("2026-12-24", 15, 0)));
    // Closing Leaflet after its moment leaves it for a little later that day...
    let plan = year_planned(&settings, &habit, &log, at("2026-12-24", 15, 0)).unwrap();
    assert_eq!(plan.at, at("2026-12-24", 15, CLOSE_DELAY_MINUTES as u32));
    // ...but not into the night.
    assert!(year_planned(&settings, &habit, &log, at("2026-12-24", 22, 50)).is_none());
  }

  #[test]
  fn the_year_goes_out_even_with_the_day_read() {
    let settings = all_on();
    let met = view("2026-12-24", 30.0, 20, 9);
    assert!(year_due(&settings, &met, idle(), &FiredLog::default(), at("2026-12-24", 10, 0)));
    // And with no streak and no goal at all.
    let none = view("2026-12-24", 0.0, 0, 0);
    assert!(year_due(&settings, &none, idle(), &FiredLog::default(), at("2026-12-24", 10, 0)));
    let plan = year_planned(&settings, &met, &FiredLog::default(), at("2026-12-24", 8, 0)).unwrap();
    assert_eq!(plan.at, at("2026-12-24", 10, 0));
  }

  #[test]
  fn the_year_neither_retires_nor_is_retired_by_a_daily_reminder() {
    // The daily reminder set for 10:00 lands in the same minute.
    let settings = ReminderSettings { daily: true, daily_at: YEAR_AT, ..ReminderSettings::default() };
    let habit = view("2026-12-24", 0.0, 20, 0);
    let mut log = FiredLog::default();
    let first = due_now(&settings, PipVoice::Chatty, &habit, idle(), &log, at("2026-12-24", 10, 0)).unwrap();
    assert_eq!(first.reminder.kind, ReminderKind::Daily);
    assert!(first.superseded.is_empty());
    log.mark(first.reminder.kind, "2026-12-24");
    let second = due_now(&settings, PipVoice::Chatty, &habit, idle(), &log, at("2026-12-24", 10, 1)).unwrap();
    assert_eq!(second.reminder.kind, ReminderKind::Year);
    assert!(second.superseded.is_empty());
    log.mark(second.reminder.kind, "2026-12-24");
    // Marking the year's notice leaves the daily kinds as they were.
    assert_eq!(log.daily.as_deref(), Some("2026-12-24"));
    assert_eq!(log.streak_risk, None);
  }

  #[test]
  fn the_year_is_told_once_a_year() {
    let settings = one_on();
    let habit = view("2026-12-24", 0.0, 20, 0);
    let mut log = FiredLog::default();
    log.mark(ReminderKind::Year, "2026-12-24");
    assert!(!year_due(&settings, &habit, idle(), &log, at("2026-12-24", 15, 0)));
    assert!(year_planned(&settings, &view("2026-12-20", 0.0, 20, 0), &log, at("2026-12-20", 9, 0)).is_none());
    // Any day of this year counts as sent this year; last year's does not.
    let other_day = FiredLog { year: Some("2026-12-20".to_string()), ..FiredLog::default() };
    assert!(!year_due(&settings, &habit, idle(), &other_day, at("2026-12-24", 10, 0)));
    let last_year = FiredLog { year: Some("2025-12-24".to_string()), ..FiredLog::default() };
    assert!(year_due(&settings, &habit, idle(), &last_year, at("2026-12-24", 10, 0)));
    assert!(year_planned(&settings, &view("2026-12-20", 0.0, 20, 0), &last_year, at("2026-12-20", 9, 0)).is_some());
    // A toast Windows held while Leaflet was closed counts on the next launch.
    let plan = year_planned(&settings, &view("2026-12-20", 0.0, 20, 0), &FiredLog::default(), at("2026-12-20", 9, 0)).unwrap();
    let mut settled = FiredLog::default();
    settle_scheduled(&mut settled, &[ScheduledRecord::of(&plan)], at("2026-12-26", 9, 0));
    assert!(settled.fired_on(ReminderKind::Year, "2026-12-24"));
  }

  #[test]
  fn the_year_is_planned_up_to_a_fortnight_ahead() {
    let settings = one_on();
    let log = FiredLog::default();
    let plan_on = |key: &str| year_planned(&settings, &view(key, 0.0, 20, 0), &log, at(key, 21, 0));
    let plan = plan_on("2026-12-10").expect("14 days before");
    assert_eq!(plan.at, at("2026-12-24", 10, 0));
    assert_eq!(plan.reminder.date_key, "2026-12-24");
    assert!(plan_on("2026-12-09").is_none(), "15 days before");
    assert!(plan_on("2026-12-23").is_some());
    assert!(plan_on("2026-12-25").is_none());
    assert!(plan_on("2027-01-03").is_none());
    // Alongside today's and tomorrow's, in time order: well inside the
    // phone's eight alarms.
    let mut close = view("2026-12-23", 16.0, 20, 4);
    close.last_session_end = Some(at("2026-12-23", 9, 0));
    let plans = plan_ahead(&all_on(), PipVoice::Chatty, &close, 20, &log, at("2026-12-23", 9, 5));
    assert!(plans.len() <= 8, "{plans:?}");
    assert!(plans.windows(2).all(|pair| pair[0].at <= pair[1].at));
    assert!(plans.iter().any(|plan| plan.reminder.kind == ReminderKind::Year));
  }

  #[test]
  fn the_years_words_name_the_year_and_pip_only_when_she_is_on() {
    for voice in VOICES {
      let said = compose(ReminderKind::Year, voice, 12, 7, "2026-12-24");
      assert_eq!(said.title, "Your 2026 in pages");
      let text = format!("{} {}", said.title, said.body);
      assert!(!text.contains('{') && !text.contains("minute"), "{text}");
      match voice {
        PipVoice::Off => assert_eq!(text.matches("Pip").count(), 0, "{text}"),
        PipVoice::Quiet => assert!(text.matches("Pip").count() <= 1, "{text}"),
        PipVoice::Chatty => assert!(text.contains("Pip"), "{text}")
      }
    }
  }

  #[test]
  fn the_years_toast_only_opens_leaflet() {
    let reminder = compose(ReminderKind::Year, PipVoice::Chatty, 1, 1, "2026-12-24");
    let packaged = toast_xml(&reminder, None, true);
    assert!(packaged.contains("launch=\"leaflet-reader://open\""), "{packaged}");
    assert!(!packaged.contains("continue") && !packaged.contains("<actions>"), "{packaged}");
    assert_eq!(activation_route([OPEN_URI.to_string()]), Some("open"));
    assert_eq!(ReminderKind::Year.tag(), "year");
  }

  #[test]
  fn an_old_log_reads_without_the_year_and_the_phone_brings_it() {
    let old: FiredLog = serde_json::from_str(r#"{"daily":"2026-12-23","streakRisk":null,"close":"2026-12-23"}"#).unwrap();
    assert_eq!(old.year, None);
    assert_eq!(old.daily.as_deref(), Some("2026-12-23"));
    let new: FiredLog = serde_json::from_str(r#"{"year":"2026-12-24"}"#).unwrap();
    assert!(new.fired_on(ReminderKind::Year, "2026-12-24"));
    assert_eq!(serde_json::to_value(&new).unwrap()["year"], "2026-12-24");

    let mut log = old.clone();
    assert!(log.merge(&new));
    assert_eq!(log.year.as_deref(), Some("2026-12-24"));
    assert_eq!(log.daily.as_deref(), Some("2026-12-23"), "the daily kinds are kept");
    // The later wins, whichever side has it.
    assert!(!log.merge(&FiredLog { year: Some("2025-12-24".to_string()), ..FiredLog::default() }));
    assert_eq!(log.year.as_deref(), Some("2026-12-24"));
    assert!(log.merge(&FiredLog { year: Some("2027-12-24".to_string()), ..FiredLog::default() }));
    assert_eq!(log.year.as_deref(), Some("2027-12-24"));
  }
}
