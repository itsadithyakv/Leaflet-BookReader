//! The habit engine: what a streak is, when it breaks, and what it costs.
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
/// Books burned per day of the streak that was lost.
const BURN_PER_STREAK_DAY: i64 = 1;
/// Ceiling on a single burn, so a long streak cannot wipe an entire shelf.
const MAX_BURN: i64 = 12;
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
  /// High-water mark of the shelf, kept so a burn leaves a record of the peak.
  pub peak_shelf: i64
}

impl Default for StreakState {
  fn default() -> Self {
    Self {
      current_streak: 0,
      longest_streak: 0,
      freezes: 0,
      grace_available: true,
      last_evaluated_day: None,
      peak_shelf: 0
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
  /// Length of the streak that was just lost, when one was.
  pub broke_from: Option<i64>,
  /// How many shelf books that break costs.
  pub burn_count: i64,
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

/// How many books a broken streak burns.
pub fn burn_count_for(broken_streak: i64) -> i64 {
  (broken_streak * BURN_PER_STREAK_DAY).clamp(0, MAX_BURN)
}

/// Walks the ledger backwards from `today_key` and decides the streak.
///
/// Grace is spent before a freeze: grace is free and refills every streak, so
/// holding it back to protect an earned freeze would be backwards.
///
/// A gap is only paid for once the walk finds an earlier qualifying day. Without
/// that, a reader opening the app for the first time would spend their grace
/// bridging a gap to a streak that never existed.
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
        burn_count: 0,
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
  let broke = streak < previous_streak && previous_streak > 0;
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
    burn_count: broke_from.map(burn_count_for).unwrap_or(0),
    state: StreakState {
      current_streak: streak,
      longest_streak: previous.longest_streak.max(streak),
      freezes,
      grace_available: grace,
      last_evaluated_day: Some(today_key.to_string()),
      peak_shelf: previous.peak_shelf
    },
    today_met,
    today_minutes,
    today_goal
  }
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
      peak_shelf: 0
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
    assert_eq!(result.burn_count, 9);
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
  fn the_burn_is_capped() {
    assert_eq!(burn_count_for(0), 0);
    assert_eq!(burn_count_for(7), 7);
    assert_eq!(burn_count_for(12), 12);
    assert_eq!(burn_count_for(100), MAX_BURN);
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
}
