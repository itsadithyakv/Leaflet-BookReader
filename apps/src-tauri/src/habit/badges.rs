//! Badges: what a reader has done, said in a fixed list.
//!
//! Pure, like the streak and the seeds. A badge is never awarded and never
//! stored: each is a number the records already hold (the longest streak, the
//! minutes on the day ledger, books finished) set against a mark, worked out
//! again every time it is asked for. So there is nothing to sync and nothing
//! for two devices to disagree about beyond the facts themselves, and a badge
//! added in a later version is earned at once by a reader who already did it.
//!
//! The caller gathers the facts (`commands::pip_badges`); nothing here reads a
//! database or a clock. "Today" is the reader's local day, as everywhere in
//! `habit`, and is only used to say which month is still running.

use super::DayRecord;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

/// The marks, in the order the badges are listed.
const STREAK_DAYS: [i64; 4] = [7, 30, 100, 365];
const HOURS_READ: [i64; 4] = [10, 50, 100, 500];
const BOOKS_FINISHED: [i64; 5] = [1, 10, 25, 50, 100];
const SESSIONS_DONE: [i64; 3] = [10, 100, 500];
/// Minutes read in one day.
const MARATHON_MINUTES: i64 = 120;
const HARVESTS: [i64; 2] = [10, 100];
const THINGS_BOUGHT: [i64; 3] = [10, 50, 100];
const LEVELS: [i64; 3] = [5, 10, 20];
/// Minutes read in one calendar month: the monthly challenges.
const MONTH_MINUTES: [i64; 2] = [500, 1000];

/// The plain numbers badges are read from.
pub struct BadgeFacts<'a> {
  /// The day ledger: every day's minutes.
  pub days: &'a HashMap<String, DayRecord>,
  pub current_streak: i64,
  pub longest_streak: i64,
  pub books_finished: i64,
  /// Focus sessions done.
  pub sessions_done: i64,
  /// Plants picked in the garden.
  pub harvests: i64,
  /// Things owned because they were bought or given, not the free ones.
  pub bought: i64,
  /// The arcade's best scores.
  pub arcade_dash: i64,
  pub arcade_catch: i64,
  pub arcade_flap: i64,
  /// The reader's level (`pip::levels`).
  pub level: i64
}

/// One badge: how far along it is, in its own unit (days, hours, books,
/// minutes, a score), against its mark.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BadgeStatus {
  pub id: String,
  pub earned: bool,
  pub value: f64,
  pub target: f64
}

fn badge(id: String, value: f64, target: i64) -> BadgeStatus {
  let target = target as f64;
  BadgeStatus { id, earned: value >= target, value, target }
}

/// A run of badges on one number: `streak-7`, `streak-30`...
fn run(name: &str, value: f64, marks: &[i64]) -> Vec<BadgeStatus> {
  marks.iter().map(|mark| badge(format!("{name}-{mark}"), value, *mark)).collect()
}

/// A day's minutes, as reading: a row that will not read as a number is none.
fn minutes_of(day: &DayRecord) -> f64 {
  if day.minutes.is_finite() { day.minutes.max(0.0) } else { 0.0 }
}

/// The calendar month a ledger day is in (`2026-10`), for a key that is a date.
fn month_of(date_key: &str) -> Option<&str> {
  chrono::NaiveDate::parse_from_str(date_key, "%Y-%m-%d").ok()?;
  date_key.get(..7)
}

/// Every badge, earned or not, in a fixed order; then the monthly challenges.
///
/// A month's challenges are listed once they are met, and stay listed: the
/// ledger keeps the month. The month `today_key` is in is always listed, met
/// or not, so there is progress to show; a past month that fell short is
/// simply not there.
pub fn badges(facts: &BadgeFacts<'_>, today_key: &str) -> Vec<BadgeStatus> {
  let total_minutes: f64 = facts.days.values().map(minutes_of).sum();
  let best_day = facts.days.values().map(minutes_of).fold(0.0, f64::max);
  // The longest ever; the streak running now is at least part of it, even
  // if the state that remembers the longest has not caught up.
  let longest = facts.longest_streak.max(facts.current_streak).max(0);

  let mut list = run("streak", longest as f64, &STREAK_DAYS);
  list.extend(run("hours", total_minutes / 60.0, &HOURS_READ));
  list.extend(run("books", facts.books_finished.max(0) as f64, &BOOKS_FINISHED));
  list.extend(run("sessions", facts.sessions_done.max(0) as f64, &SESSIONS_DONE));
  list.push(badge(format!("marathon-{MARATHON_MINUTES}"), best_day, MARATHON_MINUTES));
  list.extend(run("harvest", facts.harvests.max(0) as f64, &HARVESTS));
  list.extend(run("collector", facts.bought.max(0) as f64, &THINGS_BOUGHT));
  list.push(badge("arcade-dash-100".to_string(), facts.arcade_dash.max(0) as f64, 100));
  list.push(badge("arcade-catch-100".to_string(), facts.arcade_catch.max(0) as f64, 100));
  list.push(badge("arcade-flap-25".to_string(), facts.arcade_flap.max(0) as f64, 25));
  list.extend(run("level", facts.level.max(0) as f64, &LEVELS));

  // The months, oldest first.
  let mut months: BTreeMap<&str, f64> = BTreeMap::new();
  for day in facts.days.values().filter(|day| minutes_of(day) > 0.0) {
    if let Some(month) = month_of(&day.date_key) {
      *months.entry(month).or_default() += minutes_of(day);
    }
  }
  let this_month = month_of(today_key);
  if let Some(month) = this_month {
    months.entry(month).or_default();
  }
  for (month, minutes) in months {
    for mark in MONTH_MINUTES {
      if Some(month) == this_month || minutes >= mark as f64 {
        list.push(badge(format!("month-{month}-{mark}"), minutes, mark));
      }
    }
  }
  list
}

#[cfg(test)]
mod tests {
  use super::*;

  fn day(key: &str, minutes: f64) -> DayRecord {
    DayRecord { date_key: key.to_string(), minutes, goal_minutes: 20, freeze_used: false, grace_used: false }
  }

  fn ledger(entries: Vec<DayRecord>) -> HashMap<String, DayRecord> {
    entries.into_iter().map(|record| (record.date_key.clone(), record)).collect()
  }

  /// A reader who has done nothing yet, on this ledger.
  fn facts(days: &HashMap<String, DayRecord>) -> BadgeFacts<'_> {
    BadgeFacts {
      days,
      current_streak: 0,
      longest_streak: 0,
      books_finished: 0,
      sessions_done: 0,
      harvests: 0,
      bought: 0,
      arcade_dash: 0,
      arcade_catch: 0,
      arcade_flap: 0,
      level: 1
    }
  }

  fn find<'a>(list: &'a [BadgeStatus], id: &str) -> &'a BadgeStatus {
    list.iter().find(|badge| badge.id == id).unwrap_or_else(|| panic!("no badge {id}"))
  }

  fn earned(list: &[BadgeStatus]) -> Vec<&str> {
    list.iter().filter(|badge| badge.earned).map(|badge| badge.id.as_str()).collect()
  }

  #[test]
  fn every_badge_is_listed_in_a_fixed_order_and_a_new_reader_has_none() {
    let none = HashMap::new();
    let list = badges(&facts(&none), "2026-10-11");
    let ids: Vec<&str> = list.iter().map(|badge| badge.id.as_str()).collect();
    assert_eq!(
      ids,
      vec![
        "streak-7", "streak-30", "streak-100", "streak-365",
        "hours-10", "hours-50", "hours-100", "hours-500",
        "books-1", "books-10", "books-25", "books-50", "books-100",
        "sessions-10", "sessions-100", "sessions-500",
        "marathon-120",
        "harvest-10", "harvest-100",
        "collector-10", "collector-50", "collector-100",
        "arcade-dash-100", "arcade-catch-100", "arcade-flap-25",
        "level-5", "level-10", "level-20",
        "month-2026-10-500", "month-2026-10-1000"
      ]
    );
    assert!(earned(&list).is_empty());
    assert!(list.iter().all(|badge| badge.value == 0.0 || badge.id.starts_with("level-")));
  }

  #[test]
  fn a_streak_badge_is_for_the_longest_streak_ever() {
    let none = HashMap::new();
    let mut broken = facts(&none);
    broken.longest_streak = 31;
    broken.current_streak = 2;
    let list = badges(&broken, "2026-10-11");
    assert!(find(&list, "streak-7").earned && find(&list, "streak-30").earned);
    assert!(!find(&list, "streak-100").earned);
    assert_eq!((find(&list, "streak-100").value, find(&list, "streak-100").target), (31.0, 100.0));
    // A streak running past the longest on record is the longest.
    let mut running = facts(&none);
    running.current_streak = 7;
    assert!(find(&badges(&running, "2026-10-11"), "streak-7").earned);
  }

  #[test]
  fn hours_are_every_minute_on_the_ledger() {
    // 599 minutes is a minute short of ten hours.
    let short = ledger(vec![day("2026-08-01", 300.0), day("2026-09-01", 299.0)]);
    let list = badges(&facts(&short), "2026-10-11");
    assert!(!find(&list, "hours-10").earned);
    let there = ledger(vec![day("2026-08-01", 300.0), day("2026-09-01", 300.0)]);
    let list = badges(&facts(&there), "2026-10-11");
    assert!(find(&list, "hours-10").earned);
    assert_eq!(find(&list, "hours-50").value, 10.0, "told in hours");
    assert!(!find(&list, "hours-50").earned);
  }

  #[test]
  fn a_marathon_is_two_hours_in_one_day() {
    // Two hours over two days is not one.
    let spread = ledger(vec![day("2026-10-01", 119.0), day("2026-10-02", 119.0)]);
    let list = badges(&facts(&spread), "2026-10-11");
    assert_eq!((find(&list, "marathon-120").earned, find(&list, "marathon-120").value), (false, 119.0));
    let one_day = ledger(vec![day("2026-10-01", 30.0), day("2026-10-02", 120.0)]);
    assert!(find(&badges(&facts(&one_day), "2026-10-11"), "marathon-120").earned);
  }

  #[test]
  fn counts_are_set_against_their_marks() {
    let none = HashMap::new();
    let mut busy = facts(&none);
    busy.books_finished = 25;
    busy.sessions_done = 99;
    busy.harvests = 10;
    busy.bought = 50;
    busy.level = 10;
    let list = badges(&busy, "2026-10-11");
    assert_eq!(
      earned(&list),
      vec!["books-1", "books-10", "books-25", "sessions-10", "harvest-10", "collector-10", "collector-50", "level-5", "level-10"]
    );
    assert_eq!(find(&list, "sessions-100").value, 99.0);
  }

  #[test]
  fn an_arcade_badge_is_a_best_score_at_its_mark() {
    let none = HashMap::new();
    let mut player = facts(&none);
    player.arcade_dash = 100;
    player.arcade_catch = 99;
    player.arcade_flap = 25;
    let list = badges(&player, "2026-10-11");
    assert!(find(&list, "arcade-dash-100").earned);
    assert!(!find(&list, "arcade-catch-100").earned);
    assert!(find(&list, "arcade-flap-25").earned);
    assert_eq!(find(&list, "arcade-flap-25").target, 25.0);
  }

  #[test]
  fn a_months_challenge_is_listed_once_met_and_this_months_always() {
    let days = ledger(vec![
      // July fell short: not listed. August reached 500, September 1,000.
      day("2026-07-10", 499.0),
      day("2026-08-03", 250.0),
      day("2026-08-20", 250.0),
      day("2026-09-01", 600.0),
      day("2026-09-30", 400.0),
      // October is still running.
      day("2026-10-02", 90.0),
      day("2026-10-09", 30.0)
    ]);
    let list = badges(&facts(&days), "2026-10-11");
    let months: Vec<(&str, bool, f64)> = list
      .iter()
      .filter(|badge| badge.id.starts_with("month-"))
      .map(|badge| (badge.id.as_str(), badge.earned, badge.value))
      .collect();
    assert_eq!(
      months,
      vec![
        ("month-2026-08-500", true, 500.0),
        ("month-2026-09-500", true, 1000.0),
        ("month-2026-09-1000", true, 1000.0),
        ("month-2026-10-500", false, 120.0),
        ("month-2026-10-1000", false, 120.0)
      ]
    );
    // November comes: October fell short and is gone, and November is there
    // from its first day with nothing read.
    let later = badges(&facts(&days), "2026-11-01");
    assert!(later.iter().all(|badge| !badge.id.starts_with("month-2026-10")));
    assert_eq!((find(&later, "month-2026-11-500").earned, find(&later, "month-2026-11-500").value), (false, 0.0));
    // A challenge met this month is earned this month, and kept after it.
    let met = ledger(vec![day("2026-10-02", 500.0)]);
    assert!(find(&badges(&facts(&met), "2026-10-11"), "month-2026-10-500").earned);
    assert!(!find(&badges(&facts(&met), "2026-10-11"), "month-2026-10-1000").earned);
    assert!(find(&badges(&facts(&met), "2027-03-01"), "month-2026-10-500").earned);
  }

  #[test]
  fn days_and_minutes_that_will_not_read_earn_nothing() {
    let odd = ledger(vec![day("someday", 5000.0), day("2026-10-02", f64::NAN), day("2026-10-03", -300.0), day("2026-10-04", f64::INFINITY)]);
    let list = badges(&facts(&odd), "2026-10-11");
    // A day with no date still read its minutes; it is in no month.
    assert_eq!(find(&list, "hours-50").value, 5000.0 / 60.0);
    assert_eq!(find(&list, "month-2026-10-500").value, 0.0);
    assert!(list.iter().all(|badge| badge.value.is_finite()));
    // A day that is not a date has no month running: only what was met is listed.
    let bad_today = badges(&facts(&odd), "today");
    assert!(bad_today.iter().all(|badge| !badge.id.starts_with("month-")));
  }

  #[test]
  fn a_badge_is_told_in_camel_case() {
    let none = HashMap::new();
    let list = badges(&facts(&none), "2026-10-11");
    assert_eq!(
      serde_json::to_string(find(&list, "streak-7")).expect("encodes"),
      r#"{"id":"streak-7","earned":false,"value":0.0,"target":7.0}"#
    );
  }
}
