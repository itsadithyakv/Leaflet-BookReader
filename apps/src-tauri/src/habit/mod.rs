//! The habit engine: what a streak is, when it breaks, and what follows.
//!
//! A broken streak used to burn the newest books on the shelf. It burns
//! nothing now: Pip catches a cold instead (`cold`), and reading nurses her
//! back. Sessions an earlier version burned keep their tombstone.
//!
//! Deliberately pure. Every function here takes the day ledger as data and
//! returns a decision, so the rules can be tested without a database or a clock.
//! "Today" is always supplied by the caller — the frontend passes its *local*
//! date, which is why this module never asks the system what day it is. The old
//! `reading_stats` streak computed `Utc::now()` server-side and disagreed with
//! the UI by a day near midnight.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The currency Pip's shop takes, derived from this same ledger.
pub mod seeds;

/// Days of streak needed to earn one freeze.
const DAYS_PER_FREEZE: i64 = 5;
/// Most freezes a reader can bank at once.
const MAX_FREEZES: i64 = 2;
/// The shortest streak whose breaking gives Pip a cold. A day or two lost is
/// not worth one.
pub const COLD_MIN_STREAK: i64 = 3;
/// How many days the cold lasts when nothing cures it, counted from the day
/// after the one that was missed. It always passes: it can never be permanent.
pub const COLD_DAYS: i64 = 3;
/// How far back a walk will look before giving up, in days.
const MAX_WALK_DAYS: i64 = 3650;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayRecord {
  /// Local calendar day, `YYYY-MM-DD`.
  pub date_key: String,
  pub minutes: f64,
  pub goal_minutes: i64,
  pub freeze_used: bool,
  pub grace_used: bool
}

impl DayRecord {
  pub fn goal_met(&self) -> bool {
    self.goal_minutes > 0 && self.minutes >= self.goal_minutes as f64
  }

  /// A day already paid for with grace or a freeze counts toward the streak.
  pub fn covered(&self) -> bool {
    self.freeze_used || self.grace_used
  }

  pub fn counts(&self) -> bool {
    self.goal_met() || self.covered()
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CoverKind {
  Grace,
  Freeze
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakState {
  pub current_streak: i64,
  pub longest_streak: i64,
  pub freezes: i64,
  /// One free missed day per streak; refills when a new streak begins.
  pub grace_available: bool,
  pub last_evaluated_day: Option<String>,
  /// High-water mark of the shelf. Kept from when a broken streak burned
  /// books, so a burn left a record of the peak; nothing lowers the shelf now.
  pub peak_shelf: i64,
  /// The day the last break was found. The walk pays for no day before it:
  /// those gaps were judged then. Absent in a state saved by an earlier
  /// version, which reads as no break on record.
  #[serde(default)]
  pub broke_on: Option<String>
}

impl Default for StreakState {
  fn default() -> Self {
    Self {
      current_streak: 0,
      longest_streak: 0,
      freezes: 0,
      grace_available: true,
      last_evaluated_day: None,
      peak_shelf: 0,
      broke_on: None
    }
  }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evaluation {
  pub streak: i64,
  /// Days to persist as paid for, with what.
  pub covers: Vec<(String, CoverKind)>,
  pub state: StreakState,
  /// Length of the streak that was just lost, when one was. Nothing is taken
  /// for it: see `cold` for what a break does now.
  pub broke_from: Option<i64>,
  /// True once today's goal is met — the frontend celebrates on the edge.
  pub today_met: bool,
  pub today_minutes: f64,
  pub today_goal: i64
}

fn parse_day(key: &str) -> Option<chrono::NaiveDate> {
  chrono::NaiveDate::parse_from_str(key, "%Y-%m-%d").ok()
}

fn key_of(date: chrono::NaiveDate) -> String {
  date.format("%Y-%m-%d").to_string()
}

/// Walks the ledger backwards from `today_key` and decides the streak.
///
/// Grace is spent before a freeze: grace is free and refills every streak, so
/// holding it back to protect an earned freeze would be backwards.
///
/// A gap is only paid for once the walk finds an earlier qualifying day. Without
/// that, a reader opening the app for the first time would spend their grace
/// bridging a gap to a streak that never existed.
///
/// A break is final. The grace it refills belongs to the streak that comes
/// after, so the walk pays for no day earlier than the day the break was
/// found (`broke_on`). Without that the very next walk spent the new grace on
/// the gap that had just broken the streak: the streak came back a minute
/// after its end was announced, and a single missed day could never end one.
pub fn evaluate(
  days: &HashMap<String, DayRecord>,
  today_key: &str,
  previous: &StreakState
) -> Evaluation {
  let today = match parse_day(today_key) {
    Some(date) => date,
    None => {
      return Evaluation {
        streak: previous.current_streak,
        covers: Vec::new(),
        state: previous.clone(),
        broke_from: None,
        today_met: false,
        today_minutes: 0.0,
        today_goal: 0
      }
    }
  };

  let today_record = days.get(today_key);
  let today_met = today_record.map(DayRecord::counts).unwrap_or(false);
  let today_minutes = today_record.map(|d| d.minutes).unwrap_or(0.0);
  let today_goal = today_record.map(|d| d.goal_minutes).unwrap_or(0);

  let earliest = days
    .keys()
    .filter_map(|key| parse_day(key))
    .min()
    .unwrap_or(today);

  let mut streak = 0i64;
  let mut committed: Vec<(String, CoverKind)> = Vec::new();
  let mut pending: Vec<(String, CoverKind)> = Vec::new();
  let mut grace = previous.grace_available;
  let mut freezes = previous.freezes;
  let mut cursor = today;
  let mut walked = 0i64;
  let judged_before = previous.broke_on.as_deref().and_then(parse_day);

  loop {
    let key = key_of(cursor);
    let record = days.get(&key);
    let counts = record.map(DayRecord::counts).unwrap_or(false);

    if counts {
      // Reaching a qualifying day bridges every gap held open behind it.
      streak += 1 + pending.len() as i64;
      committed.append(&mut pending);
    } else if cursor == today {
      // Today is still in progress: it neither counts nor breaks the streak.
    } else if judged_before.is_some_and(|found| cursor < found) {
      // A gap the last break already judged: it is not paid for after the fact.
      break;
    } else if grace {
      grace = false;
      pending.push((key, CoverKind::Grace));
    } else if freezes > 0 {
      freezes -= 1;
      pending.push((key, CoverKind::Freeze));
    } else {
      break;
    }

    walked += 1;
    if cursor <= earliest || walked >= MAX_WALK_DAYS {
      break;
    }
    cursor = match cursor.pred_opt() {
      Some(previous_day) => previous_day,
      None => break
    };
  }

  // Covers that never reached an earlier qualifying day are refunded.
  for (_, kind) in &pending {
    match kind {
      CoverKind::Grace => grace = true,
      CoverKind::Freeze => freezes += 1
    }
  }

  let previous_streak = previous.current_streak;
  // Asked about a day before the one last asked about (a date line crossed
  // going east, a clock corrected), the walk counts fewer days. Nothing was
  // missed, so nothing broke.
  let rewound = previous
    .last_evaluated_day
    .as_deref()
    .and_then(parse_day)
    .is_some_and(|last| today < last);
  let broke = streak < previous_streak && previous_streak > 0 && !rewound;
  let broke_from = if broke { Some(previous_streak) } else { None };

  // Crossing each multiple of DAYS_PER_FREEZE banks one, up to the cap.
  let earned = if streak > previous_streak {
    (streak / DAYS_PER_FREEZE) - (previous_streak / DAYS_PER_FREEZE)
  } else {
    0
  };
  freezes = (freezes + earned.max(0)).clamp(0, MAX_FREEZES);

  // A fresh streak arrives with its grace intact.
  if broke || (previous_streak == 0 && streak > 0) {
    grace = true;
  }

  Evaluation {
    streak,
    covers: committed,
    broke_from,
    state: StreakState {
      current_streak: streak,
      longest_streak: previous.longest_streak.max(streak),
      freezes,
      grace_available: grace,
      last_evaluated_day: Some(today_key.to_string()),
      peak_shelf: previous.peak_shelf,
      broke_on: if broke { Some(today_key.to_string()) } else { previous.broke_on.clone() }
    },
    today_met,
    today_minutes,
    today_goal
  }
}

/// Pip's cold: what a broken streak costs now, in place of burned books.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cold {
  /// The day the streak broke: the first day missed. Local, `YYYY-MM-DD`.
  pub since: String,
  /// How many days the streak had run.
  pub broke_from: i64,
  /// How far the cure has come, 0 to 1: today's reading against today's
  /// goal. Under 1 for as long as she has it (at 1 today is met, and she is
  /// well).
  pub cure: f64,
  /// Whole minutes of reading today that would cure it.
  pub minutes_left_today: i64,
  /// Days until it passes by itself, today included: `COLD_DAYS` down to 1.
  pub days_left: i64
}

/// How many days in a row count, ending on `last` (0 when `last` does not).
fn run_ending(days: &HashMap<String, DayRecord>, last: chrono::NaiveDate) -> i64 {
  let mut run = 0i64;
  let mut cursor = last;
  while run < MAX_WALK_DAYS && days.get(&key_of(cursor)).is_some_and(DayRecord::counts) {
    run += 1;
    cursor = match cursor.pred_opt() {
      Some(previous_day) => previous_day,
      None => break
    };
  }
  run
}

/// Whether Pip has a cold, and how the nursing is going.
///
/// She catches one when a streak of `COLD_MIN_STREAK` days or more breaks,
/// and has it from the day after the missed day until the reader meets the
/// daily goal on any day since (a day covered by grace or a freeze is not a
/// cure), or for `COLD_DAYS` days, whichever comes first.
///
/// Derived, like the streak: a pure function of the ledger, today's local
/// date and the goal in force, so it needs no storage and no sync rule, and
/// two devices holding the same ledger agree. It reads the ledger as it
/// stands *after* the streak walk has stamped its covers: a missed day that
/// grace or a freeze paid for counts, so there was no break and there is no
/// cold. And because it only ever looks `COLD_DAYS` back from today, a break
/// long past (a ledger that has only just arrived by sync, a reader back
/// after a fortnight away) gives none.
///
/// The cure looks at every day after the break, not only those up to today:
/// asked about an earlier day (a clock set back, the date line crossed), a
/// cold already nursed away does not come back.
pub fn cold(days: &HashMap<String, DayRecord>, today_key: &str, goal_minutes: i64) -> Option<Cold> {
  let today = parse_day(today_key)?;
  let counts = |date: chrono::NaiveDate| days.get(&key_of(date)).is_some_and(DayRecord::counts);

  // The break: the nearest day before today that was missed straight after a
  // streak worth a cold. Today is never it: a day in progress breaks nothing.
  let (missed, back, broke_from) = (1..=COLD_DAYS).find_map(|back| {
    let missed = today.checked_sub_signed(chrono::Duration::days(back))?;
    if counts(missed) {
      return None;
    }
    let run = run_ending(days, missed.pred_opt()?);
    (run >= COLD_MIN_STREAK).then_some((missed, back, run))
  })?;

  // Nursed back: the goal met by reading, on any day since.
  let cured = days
    .values()
    .any(|day| day.goal_met() && parse_day(&day.date_key).is_some_and(|date| date > missed));
  if cured {
    return None;
  }

  // Today's reading against today's goal: the goal its row is stamped with,
  // or the one in force when nothing has been read yet.
  let record = days.get(today_key);
  let minutes = record.map(|day| day.minutes).filter(|m| m.is_finite()).unwrap_or(0.0).max(0.0);
  let goal = record
    .map(|day| day.goal_minutes)
    .filter(|goal| *goal > 0)
    .unwrap_or(goal_minutes)
    .max(1) as f64;
  Some(Cold {
    since: key_of(missed),
    broke_from,
    cure: (minutes / goal).clamp(0.0, 1.0),
    minutes_left_today: ((goal - minutes).ceil() as i64).max(1),
    days_left: COLD_DAYS - back + 1
  })
}

/// Free reading shorter than this is not listed. The heartbeat writes the
/// ledger about once a minute, so a session and its day can differ by that
/// much without anything having been read outside the session.
pub const FREE_READ_MIN_MINUTES: f64 = 1.0;

/// What `free_reads` needs to know about one focus session.
#[derive(Debug, Clone)]
pub struct SessionSpan<'a> {
  /// The local day the session ended on: the day it is shelved under.
  pub date_key: &'a str,
  /// The local day it started on. The same day, unless it was read across
  /// midnight or left running and ended on a later day.
  pub started_day: &'a str,
  pub minutes: f64
}

/// A day's reading outside any focus session.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeRead {
  pub date_key: String,
  pub minutes: f64
}

/// Reading done with no focus session running, a day at a time, oldest first.
///
/// Never stored. The ledger holds every minute the heartbeat counted, session
/// or not, and a session's minutes are the part of it read with the timer on,
/// so what is left of a day is its free reading. Derived like this it needs no
/// record of its own: days read before this existed have their free reading
/// too, and two devices holding the same ledger and shelf agree on it.
///
/// A session takes its minutes from the day it ended on first, then from the
/// day it started on, since the heartbeat credited each minute to the day it
/// was read. Burned sessions still take theirs: a book lost to a broken
/// streak does not come back as free reading. Session time the ledger never
/// saw (a timer from before the session clock counted reading) takes nothing
/// more than the day holds.
pub fn free_reads(days: &HashMap<String, DayRecord>, sessions: &[SessionSpan<'_>]) -> Vec<FreeRead> {
  let mut left: std::collections::BTreeMap<&str, f64> = days
    .values()
    .filter(|day| day.minutes > 0.0)
    .map(|day| (day.date_key.as_str(), day.minutes))
    .collect();

  // In a fixed order, so the answer does not depend on how the shelf was listed.
  let mut ordered: Vec<&SessionSpan<'_>> = sessions.iter().collect();
  ordered.sort_by(|a, b| {
    a.date_key
      .cmp(b.date_key)
      .then_with(|| a.started_day.cmp(b.started_day))
      .then_with(|| a.minutes.total_cmp(&b.minutes))
  });
  for session in ordered {
    let mut owed = session.minutes.max(0.0);
    let mut take = |day: &str, owed: &mut f64| {
      if let Some(rest) = left.get_mut(day) {
        let taken = owed.min(*rest);
        *rest -= taken;
        *owed -= taken;
      }
    };
    take(session.date_key, &mut owed);
    if session.started_day != session.date_key {
      take(session.started_day, &mut owed);
    }
  }

  left
    .into_iter()
    .filter(|(_, minutes)| *minutes >= FREE_READ_MIN_MINUTES)
    .map(|(date_key, minutes)| FreeRead { date_key: date_key.to_string(), minutes })
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  fn day(key: &str, minutes: f64, goal: i64) -> DayRecord {
    DayRecord {
      date_key: key.to_string(),
      minutes,
      goal_minutes: goal,
      freeze_used: false,
      grace_used: false
    }
  }

  fn ledger(entries: Vec<DayRecord>) -> HashMap<String, DayRecord> {
    entries
      .into_iter()
      .map(|record| (record.date_key.clone(), record))
      .collect()
  }

  fn state(streak: i64, freezes: i64, grace: bool) -> StreakState {
    StreakState {
      current_streak: streak,
      longest_streak: streak,
      freezes,
      grace_available: grace,
      last_evaluated_day: None,
      peak_shelf: 0,
      broke_on: None
    }
  }

  #[test]
  fn consecutive_met_days_build_a_streak() {
    let days = ledger(vec![
      day("2026-03-01", 25.0, 20),
      day("2026-03-02", 30.0, 20),
      day("2026-03-03", 21.0, 20)
    ]);
    let result = evaluate(&days, "2026-03-03", &state(2, 0, true));
    assert_eq!(result.streak, 3);
    assert_eq!(result.broke_from, None);
  }

  #[test]
  fn a_day_short_of_the_goal_does_not_count() {
    let days = ledger(vec![day("2026-03-03", 19.9, 20)]);
    let result = evaluate(&days, "2026-03-03", &state(0, 0, true));
    assert_eq!(result.streak, 0);
    assert!(!result.today_met);
  }

  #[test]
  fn today_in_progress_never_breaks_the_streak() {
    // Yesterday met, today not yet — the streak holds at 1 and nothing is spent.
    let days = ledger(vec![day("2026-03-02", 25.0, 20), day("2026-03-03", 3.0, 20)]);
    let result = evaluate(&days, "2026-03-03", &state(1, 0, true));
    assert_eq!(result.streak, 1);
    assert_eq!(result.broke_from, None);
    assert!(result.state.grace_available, "grace must not be spent on today");
  }

  #[test]
  fn grace_covers_a_missed_day_before_a_freeze_is_touched() {
    // Mar 1 met, Mar 2 missed, Mar 3 met.
    let days = ledger(vec![day("2026-03-01", 25.0, 20), day("2026-03-03", 25.0, 20)]);
    let result = evaluate(&days, "2026-03-03", &state(1, 2, true));
    assert_eq!(result.streak, 3, "the bridged gap counts too");
    assert_eq!(result.covers.len(), 1);
    assert_eq!(result.covers[0], ("2026-03-02".to_string(), CoverKind::Grace));
    assert_eq!(result.state.freezes, 2, "freezes are untouched while grace remains");
    assert!(!result.state.grace_available);
  }

  #[test]
  fn a_freeze_covers_the_second_gap_once_grace_is_gone() {
    // Mar 1 met, Mar 2 and Mar 3 missed, Mar 4 met.
    let days = ledger(vec![day("2026-03-01", 25.0, 20), day("2026-03-04", 25.0, 20)]);
    let result = evaluate(&days, "2026-03-04", &state(1, 1, true));
    assert_eq!(result.streak, 4);
    let kinds: Vec<CoverKind> = result.covers.iter().map(|(_, k)| *k).collect();
    assert!(kinds.contains(&CoverKind::Grace));
    assert!(kinds.contains(&CoverKind::Freeze));
    assert_eq!(result.state.freezes, 0);
  }

  #[test]
  fn the_streak_breaks_when_nothing_can_cover_the_gap() {
    let days = ledger(vec![day("2026-03-01", 25.0, 20), day("2026-03-05", 25.0, 20)]);
    let result = evaluate(&days, "2026-03-05", &state(9, 0, false));
    assert_eq!(result.streak, 1, "only today survives");
    assert_eq!(result.broke_from, Some(9));
  }

  #[test]
  fn a_break_refills_grace_for_the_new_streak() {
    let days = ledger(vec![day("2026-03-05", 25.0, 20)]);
    let result = evaluate(&days, "2026-03-05", &state(9, 0, false));
    assert!(result.state.grace_available);
  }

  #[test]
  fn an_empty_ledger_spends_nothing() {
    // The critical case: a brand new reader must not burn their grace bridging
    // a gap to a streak that never existed.
    let days = ledger(vec![]);
    let result = evaluate(&days, "2026-03-05", &state(0, 2, true));
    assert_eq!(result.streak, 0);
    assert!(result.covers.is_empty());
    assert!(result.state.grace_available);
    assert_eq!(result.state.freezes, 2);
    assert_eq!(result.broke_from, None);
  }

  #[test]
  fn a_long_absence_does_not_drain_the_bank() {
    // Met once a month ago, nothing since. Covers are only committed when they
    // bridge to a qualifying day, so both resources survive.
    let days = ledger(vec![day("2026-02-01", 25.0, 20)]);
    let result = evaluate(&days, "2026-03-05", &state(4, 2, true));
    assert_eq!(result.streak, 0);
    assert!(result.state.grace_available);
    assert_eq!(result.state.freezes, 2);
    assert_eq!(result.broke_from, Some(4));
  }

  #[test]
  fn freezes_accrue_every_five_days_and_stop_at_the_cap() {
    let mut days = Vec::new();
    for d in 1..=10 {
      days.push(day(&format!("2026-03-{d:02}"), 25.0, 20));
    }
    let ten_days = ledger(days);
    // Crossing day 5 banks one.
    let at_five = evaluate(&ten_days, "2026-03-05", &state(4, 0, true));
    assert_eq!(at_five.streak, 5);
    assert_eq!(at_five.state.freezes, 1);
    // Crossing day 10 banks a second.
    let at_ten = evaluate(&ten_days, "2026-03-10", &state(9, 1, true));
    assert_eq!(at_ten.state.freezes, 2);
    // A third crossing is capped.
    let mut more = Vec::new();
    for d in 1..=15 {
      more.push(day(&format!("2026-03-{d:02}"), 25.0, 20));
    }
    let capped = evaluate(&ledger(more), "2026-03-15", &state(14, 2, true));
    assert_eq!(capped.state.freezes, MAX_FREEZES);
  }

  #[test]
  fn an_already_covered_day_counts_without_spending_again() {
    let mut covered = day("2026-03-02", 0.0, 20);
    covered.grace_used = true;
    let days = ledger(vec![day("2026-03-01", 25.0, 20), covered, day("2026-03-03", 25.0, 20)]);
    let result = evaluate(&days, "2026-03-03", &state(2, 1, false));
    assert_eq!(result.streak, 3);
    assert!(result.covers.is_empty(), "no new covers are spent");
    assert_eq!(result.state.freezes, 1);
  }

  #[test]
  fn longest_streak_only_grows() {
    let days = ledger(vec![day("2026-03-05", 25.0, 20)]);
    let mut previous = state(9, 0, false);
    previous.longest_streak = 40;
    let result = evaluate(&days, "2026-03-05", &previous);
    assert_eq!(result.state.longest_streak, 40);
  }

  #[test]
  fn a_zero_goal_day_never_counts() {
    // Guards against a divide-by-nothing goal letting every day pass for free.
    let days = ledger(vec![day("2026-03-03", 0.0, 0)]);
    let result = evaluate(&days, "2026-03-03", &state(0, 0, true));
    assert_eq!(result.streak, 0);
  }

  #[test]
  fn a_malformed_today_key_is_inert() {
    let days = ledger(vec![day("2026-03-03", 25.0, 20)]);
    let result = evaluate(&days, "not-a-date", &state(3, 1, true));
    assert_eq!(result.streak, 3, "state is returned unchanged");
    assert_eq!(result.broke_from, None);
  }

  #[test]
  fn a_clock_set_back_is_not_a_broken_streak() {
    let days = ledger(vec![
      day("2026-10-01", 25.0, 20),
      day("2026-10-02", 25.0, 20),
      day("2026-10-03", 25.0, 20)
    ]);
    let mut previous = state(3, 0, false);
    previous.last_evaluated_day = Some("2026-10-03".to_string());
    // The same ledger, asked about the day before: a date line crossed going
    // east, or a clock corrected. One day fewer is counted, and nothing broke.
    let result = evaluate(&days, "2026-10-02", &previous);
    assert_eq!(result.streak, 2);
    assert_eq!(result.broke_from, None);

    // A real break is still one, asked on the same day or a later one.
    let gap = ledger(vec![day("2026-10-01", 25.0, 20), day("2026-10-05", 25.0, 20)]);
    let result = evaluate(&gap, "2026-10-05", &previous);
    assert_eq!(result.broke_from, Some(3));
  }

  #[test]
  fn a_break_is_final_and_the_grace_it_refills_is_for_the_streak_after() {
    // Five days to the 9th, the 10th missed, nothing left to pay with.
    let mut entries: Vec<DayRecord> = (5..=9).map(|d| day(&format!("2026-10-{d:02}"), 25.0, 20)).collect();
    let found = evaluate(&ledger(entries.clone()), "2026-10-11", &state(5, 0, false));
    assert_eq!((found.streak, found.broke_from), (0, Some(5)));
    assert!(found.state.grace_available, "a new streak's grace");
    assert_eq!(found.state.broke_on.as_deref(), Some("2026-10-11"));

    // Asked again the same day, a minute later: the new grace does not go
    // back and pay for the 10th. This used to restore the streak.
    let again = evaluate(&ledger(entries.clone()), "2026-10-11", &found.state);
    assert_eq!((again.streak, again.broke_from), (0, None));
    assert!(again.covers.is_empty());
    assert!(again.state.grace_available);

    // The 11th is read: a streak of one, not of seven.
    entries.push(day("2026-10-11", 25.0, 20));
    let met = evaluate(&ledger(entries.clone()), "2026-10-11", &again.state);
    assert_eq!(met.streak, 1);
    assert!(met.covers.is_empty());

    // The 12th is missed and the 13th read: that gap is the new streak's, and its grace pays.
    entries.push(day("2026-10-13", 25.0, 20));
    let covered = evaluate(&ledger(entries), "2026-10-13", &met.state);
    assert_eq!(covered.streak, 3);
    assert_eq!(covered.covers, vec![("2026-10-12".to_string(), CoverKind::Grace)]);
    assert_eq!(covered.broke_from, None);
  }

  #[test]
  fn a_streak_state_from_an_earlier_version_reads_as_no_break_on_record() {
    let saved = r#"{"currentStreak":4,"longestStreak":9,"freezes":1,"graceAvailable":false,"lastEvaluatedDay":"2026-10-03","peakShelf":12}"#;
    let state: StreakState = serde_json::from_str(saved).expect("reads");
    assert_eq!((state.current_streak, state.freezes, state.broke_on), (4, 1, None));
  }

  // ---- the cold ----------------------------------------------------------

  /// `streak` days met in a row, the last of them the day before `missed`.
  fn streak_before(missed: &str, streak: i64) -> Vec<DayRecord> {
    let missed = parse_day(missed).expect("a date");
    (1..=streak)
      .map(|back| day(&key_of(missed - chrono::Duration::days(back)), 25.0, 20))
      .collect()
  }

  /// Stamps a cover on the ledger, as `build_snapshot` does with what the walk decided.
  fn stamp(days: &mut HashMap<String, DayRecord>, key: &str, kind: CoverKind) {
    let record = days.entry(key.to_string()).or_insert_with(|| day(key, 0.0, 20));
    match kind {
      CoverKind::Grace => record.grace_used = true,
      CoverKind::Freeze => record.freeze_used = true
    }
  }

  #[test]
  fn a_streak_of_three_that_breaks_gives_pip_a_cold_the_next_day() {
    let days = ledger(streak_before("2026-10-10", 3));
    assert_eq!(
      cold(&days, "2026-10-11", 20),
      Some(Cold {
        since: "2026-10-10".to_string(),
        broke_from: 3,
        cure: 0.0,
        minutes_left_today: 20,
        days_left: 3
      })
    );
  }

  #[test]
  fn a_new_reader_or_a_short_streak_gets_no_cold() {
    // Nothing read, ever.
    assert_eq!(cold(&ledger(vec![]), "2026-10-11", 20), None);
    // Two days, then a miss: not worth one.
    assert_eq!(cold(&ledger(streak_before("2026-10-10", COLD_MIN_STREAK - 1)), "2026-10-11", 20), None);
    // A first week of reading a little and never meeting the goal.
    let dabbling = ledger(vec![day("2026-10-08", 6.0, 20), day("2026-10-09", 4.0, 20), day("2026-10-11", 3.0, 20)]);
    assert_eq!(cold(&dabbling, "2026-10-11", 20), None);
    // A date that cannot be read.
    assert_eq!(cold(&ledger(streak_before("2026-10-10", 9)), "not-a-date", 20), None);
  }

  #[test]
  fn the_day_in_progress_is_never_the_break() {
    // The 10th is today with nothing read yet: the streak still stands. The
    // day is the reader's own local one, whatever the date is elsewhere, and
    // nothing here reads a clock: only when their 10th is over was it missed.
    let days = ledger(streak_before("2026-10-10", 5));
    assert_eq!(cold(&days, "2026-10-10", 20), None);
    assert!(cold(&days, "2026-10-11", 20).is_some());
    // Flying west brings the 10th round again: it is in progress again, and
    // reading on it keeps the streak after all.
    assert_eq!(cold(&days, "2026-10-10", 20), None);
  }

  #[test]
  fn reading_shows_the_cure_coming_and_meeting_the_goal_is_the_cure() {
    let on_the_11th = |minutes: f64| {
      let mut entries = streak_before("2026-10-10", 4);
      entries.push(day("2026-10-11", minutes, 20));
      cold(&ledger(entries), "2026-10-11", 20)
    };
    let half = on_the_11th(12.0).expect("still ill");
    assert_eq!((half.cure, half.minutes_left_today), (0.6, 8));
    // Under a minute to go is said as one, never as none.
    let nearly = on_the_11th(19.2).expect("still ill");
    assert_eq!(nearly.minutes_left_today, 1);
    assert!(nearly.cure < 1.0);
    // The goal met: she is well, in the same breath.
    assert_eq!(on_the_11th(20.0), None);
    assert_eq!(on_the_11th(48.0), None);
  }

  #[test]
  fn todays_reading_is_measured_against_todays_goal() {
    // The goal today's row is stamped with, not the one passed in.
    let mut entries = streak_before("2026-10-10", 3);
    entries.push(day("2026-10-11", 10.0, 40));
    let stamped = cold(&ledger(entries), "2026-10-11", 20).expect("a cold");
    assert_eq!((stamped.cure, stamped.minutes_left_today), (0.25, 30));
    // Nothing read yet today: the goal in force.
    let unread = cold(&ledger(streak_before("2026-10-10", 3)), "2026-10-11", 45).expect("a cold");
    assert_eq!((unread.cure, unread.minutes_left_today), (0.0, 45));
    // A goal of nothing divides nothing.
    let no_goal = cold(&ledger(streak_before("2026-10-10", 3)), "2026-10-11", 0).expect("a cold");
    assert_eq!((no_goal.cure, no_goal.minutes_left_today), (0.0, 1));
  }

  #[test]
  fn it_passes_by_itself_after_three_days() {
    let days = ledger(streak_before("2026-10-10", 6));
    let left: Vec<Option<i64>> = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]
      .iter()
      .map(|today| cold(&days, today, 20).map(|caught| caught.days_left))
      .collect();
    assert_eq!(left, vec![Some(3), Some(2), Some(1), None, None]);
    // It is dated from the first day missed however many follow.
    let last_day = cold(&days, "2026-10-13", 20).expect("its last day");
    assert_eq!((last_day.since.as_str(), last_day.broke_from), ("2026-10-10", 6));
  }

  #[test]
  fn reading_short_of_the_goal_neither_cures_it_nor_keeps_it_going() {
    let mut entries = streak_before("2026-10-10", 3);
    // A little on the day that was missed, and a little each day since.
    entries.push(day("2026-10-10", 4.0, 20));
    entries.push(day("2026-10-11", 9.0, 20));
    entries.push(day("2026-10-12", 15.0, 20));
    let days = ledger(entries);
    let second_day = cold(&days, "2026-10-12", 20).expect("still ill");
    assert_eq!((second_day.since.as_str(), second_day.days_left, second_day.cure), ("2026-10-10", 2, 0.75));
    assert_eq!(cold(&days, "2026-10-14", 20), None, "it passes all the same");
  }

  #[test]
  fn a_cure_holds_on_the_days_after() {
    let mut entries = streak_before("2026-10-10", 3);
    entries.push(day("2026-10-11", 22.0, 20));
    let days = ledger(entries);
    // Cured on the 11th; the 12th is then missed, after a streak of one.
    for today in ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"] {
      assert_eq!(cold(&days, today, 20), None, "{today}");
    }
  }

  #[test]
  fn only_reading_cures_it() {
    // A day after the break that counts by a cover alone is not a cure.
    let mut entries = streak_before("2026-10-10", 3);
    let mut covered = day("2026-10-11", 0.0, 20);
    covered.freeze_used = true;
    entries.push(covered);
    let caught = cold(&ledger(entries), "2026-10-12", 20).expect("still ill");
    assert_eq!((caught.since.as_str(), caught.days_left), ("2026-10-10", 2));
  }

  #[test]
  fn a_miss_paid_for_by_grace_or_a_freeze_is_no_break_and_no_cold() {
    // As build_snapshot does it: the walk decides the covers, they are
    // stamped on the ledger, and the cold is read from the ledger after.
    let mut days = ledger(streak_before("2026-10-10", 5));
    let walked = evaluate(&days, "2026-10-11", &state(5, 0, true));
    assert_eq!(walked.broke_from, None);
    assert_eq!(walked.covers, vec![("2026-10-10".to_string(), CoverKind::Grace)]);
    for (key, kind) in &walked.covers {
      stamp(&mut days, key, *kind);
    }
    assert_eq!(cold(&days, "2026-10-11", 20), None);

    // Two days away (or one, and a date skipped flying east): grace and a freeze.
    let mut days = ledger(streak_before("2026-10-10", 5));
    let walked = evaluate(&days, "2026-10-12", &state(5, 1, true));
    assert_eq!((walked.broke_from, walked.covers.len()), (None, 2));
    for (key, kind) in &walked.covers {
      stamp(&mut days, key, *kind);
    }
    assert_eq!(cold(&days, "2026-10-12", 20), None);

    // Nothing left to pay with: the same ledger is a break, and a cold.
    let days = ledger(streak_before("2026-10-10", 5));
    let walked = evaluate(&days, "2026-10-11", &state(5, 0, false));
    assert_eq!(walked.broke_from, Some(5));
    assert!(walked.covers.is_empty());
    assert_eq!(cold(&days, "2026-10-11", 20).map(|caught| caught.broke_from), Some(5));
  }

  #[test]
  fn covered_days_count_in_the_streak_that_broke() {
    let mut covered = day("2026-10-08", 0.0, 20);
    covered.grace_used = true;
    let days = ledger(vec![day("2026-10-07", 25.0, 20), covered, day("2026-10-09", 25.0, 20)]);
    assert_eq!(cold(&days, "2026-10-11", 20).map(|caught| caught.broke_from), Some(3));
  }

  #[test]
  fn a_break_long_past_gives_no_cold_on_a_device_that_has_only_just_heard_of_it() {
    // A ledger arriving by sync: a month's streak that broke in March, a
    // little reading after it, and nothing since.
    let mut entries = streak_before("2026-03-10", 30);
    entries.push(day("2026-03-12", 5.0, 20));
    assert_eq!(cold(&ledger(entries), "2026-10-11", 20), None);
    // Four days is already long past.
    assert_eq!(cold(&ledger(streak_before("2026-10-07", 30)), "2026-10-11", 20), None);
    // And a clock far ahead of the ledger finds nothing either.
    assert_eq!(cold(&ledger(streak_before("2026-10-10", 30)), "2031-01-01", 20), None);
  }

  #[test]
  fn a_clock_set_back_brings_no_cold() {
    // A streak to the 5th, the 6th missed, nursed back on the 7th, read on since.
    let mut entries = streak_before("2026-10-06", 5);
    for d in 7..=12 {
      entries.push(day(&format!("2026-10-{d:02}"), 25.0, 20));
    }
    let days = ledger(entries);
    // Asked about days already lived: inside the old streak, the day that
    // was missed, the day of the cure and the days after it.
    for today in ["2026-10-03", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"] {
      assert_eq!(cold(&days, today, 20), None, "{today}");
    }

    // Two days missed and the cure on the third: asked about the second
    // missed day again, the cure that came after it still holds.
    let mut entries = streak_before("2026-10-06", 5);
    entries.push(day("2026-10-08", 25.0, 20));
    let days = ledger(entries);
    assert_eq!(cold(&days, "2026-10-07", 20), None);
    assert_eq!(cold(&days, "2026-10-08", 20), None);
  }

  #[test]
  fn two_devices_with_the_same_ledger_agree() {
    // Nothing but the ledger, the date and the goal goes in: whatever each
    // device's own streak state says, the answer is the same.
    let mut entries = streak_before("2026-10-10", 7);
    entries.push(day("2026-10-11", 5.0, 20));
    let here = cold(&ledger(entries.clone()), "2026-10-11", 20);
    entries.reverse();
    let there = cold(&ledger(entries), "2026-10-11", 20);
    assert!(here.is_some());
    assert_eq!(here, there);
  }

  // ---- free reading ------------------------------------------------------

  fn span<'a>(date_key: &'a str, started_day: &'a str, minutes: f64) -> SessionSpan<'a> {
    SessionSpan { date_key, started_day, minutes }
  }

  fn free(date_key: &str, minutes: f64) -> FreeRead {
    FreeRead { date_key: date_key.to_string(), minutes }
  }

  #[test]
  fn a_day_read_with_no_session_is_all_free_reading() {
    // The reported case: an evening of reading, no timer started.
    let days = ledger(vec![day("2026-10-02", 95.0, 20)]);
    assert_eq!(free_reads(&days, &[]), vec![free("2026-10-02", 95.0)]);
  }

  #[test]
  fn a_session_takes_its_minutes_and_the_rest_of_the_day_is_free() {
    let days = ledger(vec![day("2026-10-02", 65.0, 20)]);
    let sessions = [span("2026-10-02", "2026-10-02", 25.0)];
    assert_eq!(free_reads(&days, &sessions), vec![free("2026-10-02", 40.0)]);
  }

  #[test]
  fn a_day_read_only_in_sessions_has_no_free_reading() {
    let days = ledger(vec![day("2026-10-02", 45.4, 20)]);
    let sessions = [span("2026-10-02", "2026-10-02", 20.0), span("2026-10-02", "2026-10-02", 25.0)];
    // The last flush lags the session by under a minute: not a free read.
    assert!(free_reads(&days, &sessions).is_empty());
  }

  #[test]
  fn session_time_the_ledger_never_saw_takes_nothing_from_other_days() {
    // An old timer left running: 175 minutes on the shelf, 10 actually read.
    let days = ledger(vec![day("2026-09-01", 30.0, 20), day("2026-09-02", 10.0, 20)]);
    let sessions = [span("2026-09-02", "2026-09-02", 175.0)];
    assert_eq!(free_reads(&days, &sessions), vec![free("2026-09-01", 30.0)]);
  }

  #[test]
  fn a_session_read_across_midnight_takes_from_both_days() {
    // 15 minutes before midnight, 10 after, and 30 read freely that afternoon.
    let days = ledger(vec![day("2026-10-01", 45.0, 20), day("2026-10-02", 10.0, 20)]);
    let sessions = [span("2026-10-02", "2026-10-01", 25.0)];
    assert_eq!(free_reads(&days, &sessions), vec![free("2026-10-01", 30.0)]);
  }

  #[test]
  fn a_session_ended_days_later_takes_from_the_day_it_was_read() {
    // Started and read on the 1st, left running, ended when Leaflet next opened.
    let days = ledger(vec![day("2026-10-01", 12.0, 20)]);
    let sessions = [span("2026-10-04", "2026-10-01", 12.0)];
    assert!(free_reads(&days, &sessions).is_empty());
  }

  #[test]
  fn free_reading_is_listed_oldest_first_whatever_the_order_given() {
    let days = ledger(vec![
      day("2026-10-03", 20.0, 20),
      day("2026-10-01", 30.0, 20),
      day("2026-10-02", 40.0, 20)
    ]);
    let one = [span("2026-10-02", "2026-10-02", 15.0), span("2026-10-03", "2026-10-03", 5.0)];
    let other = [span("2026-10-03", "2026-10-03", 5.0), span("2026-10-02", "2026-10-02", 15.0)];
    let expected = vec![free("2026-10-01", 30.0), free("2026-10-02", 25.0), free("2026-10-03", 15.0)];
    assert_eq!(free_reads(&days, &one), expected);
    assert_eq!(free_reads(&days, &other), expected);
  }

  #[test]
  fn a_covered_day_with_nothing_read_is_not_a_free_read() {
    let mut covered = day("2026-10-02", 0.0, 20);
    covered.freeze_used = true;
    let days = ledger(vec![covered, day("2026-10-03", 0.4, 20)]);
    assert!(free_reads(&days, &[]).is_empty());
  }
}
