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

/// Badges: what a reader has done, worked out from the same records.
pub mod badges;
/// The currency Pip's shop takes, derived from this same ledger.
pub mod names;
pub mod seeds;

/// Days of streak needed to earn one freeze.
const DAYS_PER_FREEZE: i64 = 5;
/// Most freezes a reader can bank at once, earned by the streak or bought
/// with seeds (`pip::freezes`).
pub const MAX_FREEZES: i64 = 2;
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

/// This device's last evaluation, kept in its settings (never synced).
///
/// The streak, the longest, the freezes and the grace are what the last walk
/// of the ledger found, kept for what reads them without walking (badges, the
/// shop); every walk works them out afresh (`evaluate`), so they are never a
/// reason for the next. What is this device's own: the day it last evaluated
/// (so a break is announced once) and the shelf's peak.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakState {
  pub current_streak: i64,
  pub longest_streak: i64,
  pub freezes: i64,
  /// One free missed day per streak; refills when a new streak begins.
  pub grace_available: bool,
  /// The latest day this device evaluated. A break on it or after is news.
  pub last_evaluated_day: Option<String>,
  /// High-water mark of the shelf. Kept from when a broken streak burned
  /// books, so a burn left a record of the peak; nothing lowers the shelf now.
  pub peak_shelf: i64,
  /// The day after the last break in the ledger. Kept for an earlier version
  /// reading this state, whose walk pays for no day before it. Absent in a
  /// state saved by an earlier version, which reads as no break on record.
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
  /// Days to stamp as paid for, with what: those `kept` not stamped yet.
  pub covers: Vec<(String, CoverKind)>,
  /// Every missed day the streak counts as paid for, with what (`judged`).
  #[serde(skip)]
  pub kept: Vec<(String, CoverKind)>,
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

/// Decides the streak by replaying the whole ledger, oldest day first, up to
/// `today_key`.
///
/// The streak is a function of the records every device holds alike: each
/// day's minutes against that day's own goal, and the freezes bought (the
/// days of the dated purchase records, `freezes_bought`). The bank (grace and
/// freezes) is not stored anywhere: it is replayed too, so two devices
/// holding the same ledger reach the same streak, a freeze spent on one is
/// spent on the other, and a device installed today walks to the same
/// number. A stored `freeze_used` or `grace_used` is a stamp of what was
/// decided, kept for earlier versions, never a reason: a stamp the replayed
/// bank could not have paid for counts for nothing. (Each device kept its own
/// bank once, and a device that adopted a ledger walked it with a fresh one,
/// paying for gaps another device had judged to be breaks; its stamps then
/// came back by sync and the other device counted them too.)
///
/// The rules, day by day:
/// - a day whose reading met its own goal counts;
/// - today counts once met, and before that neither counts nor breaks: it
///   has not ended;
/// - a day that ended unmet (or has no row) while a streak runs is paid for
///   with the streak's grace, else a freeze, and counts; with neither, the
///   streak breaks. A day is paid for as it ends, as a device opened every
///   day always paid: what an absence spent before the streak broke stays
///   spent, and the days it kept stay in the streak that broke;
/// - nothing is paid while no streak runs: a new reader's grace bridges no
///   gap to a streak that never existed;
/// - grace is one missed day per streak, and comes back when a streak breaks;
/// - crossing each multiple of `DAYS_PER_FREEZE` banks a freeze, as does a
///   freeze bought (from the day it was bought), up to `MAX_FREEZES`.
///
/// `previous` (this device's last evaluation) decides only what is news: a
/// break is announced (`broke_from`) when it fell on or after the day last
/// evaluated, so once, and never on a device that had not evaluated before.
pub fn evaluate(
  days: &HashMap<String, DayRecord>,
  freezes_bought: &[String],
  today_key: &str,
  previous: &StreakState
) -> Evaluation {
  let today = match parse_day(today_key) {
    Some(date) => date,
    None => {
      return Evaluation {
        streak: previous.current_streak,
        covers: Vec::new(),
        kept: Vec::new(),
        state: previous.clone(),
        broke_from: None,
        today_met: false,
        today_minutes: 0.0,
        today_goal: 0
      }
    }
  };

  let today_record = days.get(today_key);
  let today_met = today_record.is_some_and(DayRecord::goal_met);
  let today_minutes = today_record.map(|d| d.minutes).unwrap_or(0.0);
  let today_goal = today_record.map(|d| d.goal_minutes).unwrap_or(0);

  let floor = today
    .checked_sub_signed(chrono::Duration::days(MAX_WALK_DAYS))
    .unwrap_or(today);
  let mut bought: HashMap<chrono::NaiveDate, i64> = HashMap::new();
  for date in freezes_bought.iter().filter_map(|key| parse_day(key)) {
    *bought.entry(date.max(floor)).or_insert(0) += 1;
  }
  let start = days
    .keys()
    .filter_map(|key| parse_day(key))
    .chain(bought.keys().copied())
    .filter(|date| *date <= today)
    .min()
    .unwrap_or(today)
    .max(floor);

  let mut streak = 0i64;
  let mut longest = 0i64;
  let mut grace = true;
  let mut freezes = 0i64;
  let mut kept: Vec<(String, CoverKind)> = Vec::new();
  // The last break: the day it became one, and the streak it ended.
  let mut last_break: Option<(chrono::NaiveDate, i64)> = None;

  let mut cursor = start;
  loop {
    if let Some(count) = bought.get(&cursor) {
      freezes = (freezes + count).min(MAX_FREEZES);
    }
    let key = key_of(cursor);
    let counts = if days.get(&key).is_some_and(DayRecord::goal_met) {
      true
    } else if cursor == today || streak == 0 {
      // Today has not ended; and with no streak there is nothing to keep.
      false
    } else if grace {
      grace = false;
      kept.push((key, CoverKind::Grace));
      true
    } else if freezes > 0 {
      freezes -= 1;
      kept.push((key, CoverKind::Freeze));
      true
    } else {
      // A break, and the next streak gets its grace.
      last_break = Some((cursor, streak));
      streak = 0;
      grace = true;
      false
    };
    if counts {
      streak += 1;
      // Crossing each multiple of DAYS_PER_FREEZE banks one, up to the cap.
      if streak % DAYS_PER_FREEZE == 0 {
        freezes = (freezes + 1).min(MAX_FREEZES);
      }
      longest = longest.max(streak);
    }
    if cursor >= today {
      break;
    }
    cursor = match cursor.succ_opt() {
      Some(next) => next,
      None => break
    };
  }

  // Only what is not stamped yet needs stamping.
  let covers = kept
    .iter()
    .filter(|(key, _)| !days.get(key).is_some_and(DayRecord::covered))
    .cloned()
    .collect();

  let last_evaluated = previous.last_evaluated_day.as_deref().and_then(parse_day);
  let broke_from = last_break
    .filter(|(day, _)| last_evaluated.is_some_and(|last| *day >= last))
    .map(|(_, lost)| lost);

  Evaluation {
    streak,
    covers,
    kept,
    broke_from,
    state: StreakState {
      current_streak: streak,
      longest_streak: longest,
      freezes,
      grace_available: grace,
      // Never wound back: a clock set back must not make an old break news.
      last_evaluated_day: Some(key_of(last_evaluated.map_or(today, |last| last.max(today)))),
      peak_shelf: previous.peak_shelf,
      broke_on: last_break.map(|(day, _)| key_of(day.succ_opt().unwrap_or(day)))
    },
    today_met,
    today_minutes,
    today_goal
  }
}

/// The ledger as `evaluate` judged it: each day covered exactly as `kept`
/// says, and a stamp it did not keep taken off. What reads covers from the
/// ledger (Pip's cold, the calendar) reads this, so it agrees with the
/// streak on every device. The database keeps its stamps: they merge as
/// "either device's", so taking one off here would not take it off there.
pub fn judged(days: &HashMap<String, DayRecord>, kept: &[(String, CoverKind)]) -> HashMap<String, DayRecord> {
  let mut judged: HashMap<String, DayRecord> = days
    .iter()
    .map(|(key, day)| (key.clone(), DayRecord { freeze_used: false, grace_used: false, ..day.clone() }))
    .collect();
  for (key, kind) in kept {
    let day = judged.entry(key.clone()).or_insert_with(|| DayRecord {
      date_key: key.clone(),
      minutes: 0.0,
      goal_minutes: 0,
      freeze_used: false,
      grace_used: false
    });
    match kind {
      CoverKind::Grace => day.grace_used = true,
      CoverKind::Freeze => day.freeze_used = true
    }
  }
  judged
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
  pub minutes: f64,
  /// The book it was of, where the library can say (`names::book_on_day`):
  /// filled in by the snapshot, never by `free_reads`.
  pub book_id: Option<String>,
  pub title: Option<String>
}

impl FreeRead {
  /// A day's free reading with no book named yet.
  pub fn of(date_key: &str, minutes: f64) -> Self {
    FreeRead { date_key: date_key.to_string(), minutes, book_id: None, title: None }
  }
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
    .map(|(date_key, minutes)| FreeRead::of(date_key, minutes))
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

  /// A device's state, whatever it says: the walk takes no figure from it.
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

  /// A device that last evaluated on `day`.
  fn seen(day: &str) -> StreakState {
    StreakState { last_evaluated_day: Some(day.to_string()), ..StreakState::default() }
  }

  fn bought(days: &[&str]) -> Vec<String> {
    days.iter().map(|day| day.to_string()).collect()
  }

  /// `count` days met in a row from `from`.
  fn met_from(from: &str, count: i64) -> Vec<DayRecord> {
    let from = parse_day(from).expect("a date");
    (0..count).map(|ahead| day(&key_of(from + chrono::Duration::days(ahead)), 25.0, 20)).collect()
  }

  fn stamped(key: &str, minutes: f64, kind: CoverKind) -> DayRecord {
    let mut record = day(key, minutes, 20);
    match kind {
      CoverKind::Grace => record.grace_used = true,
      CoverKind::Freeze => record.freeze_used = true
    }
    record
  }

  #[test]
  fn consecutive_met_days_build_a_streak() {
    let days = ledger(met_from("2026-03-01", 3));
    let result = evaluate(&days, &[], "2026-03-03", &state(2, 0, true));
    assert_eq!(result.streak, 3);
    assert_eq!(result.broke_from, None);
  }

  #[test]
  fn a_day_short_of_the_goal_does_not_count() {
    let days = ledger(vec![day("2026-03-03", 19.9, 20)]);
    let result = evaluate(&days, &[], "2026-03-03", &state(0, 0, true));
    assert_eq!(result.streak, 0);
    assert!(!result.today_met);
  }

  #[test]
  fn today_in_progress_never_breaks_the_streak() {
    // Yesterday met, today not yet: the streak holds at 1 and nothing is spent.
    let days = ledger(vec![day("2026-03-02", 25.0, 20), day("2026-03-03", 3.0, 20)]);
    let result = evaluate(&days, &[], "2026-03-03", &seen("2026-03-02"));
    assert_eq!(result.streak, 1);
    assert_eq!(result.broke_from, None);
    assert!(result.covers.is_empty());
    assert!(result.state.grace_available, "grace must not be spent on today");
    // Met later the same day, today counts.
    let days = ledger(vec![day("2026-03-02", 25.0, 20), day("2026-03-03", 21.0, 20)]);
    let result = evaluate(&days, &[], "2026-03-03", &result.state);
    assert_eq!((result.streak, result.today_met), (2, true));
  }

  #[test]
  fn grace_covers_a_missed_day_before_a_freeze_is_touched() {
    // Two freezes bought; Mar 1 met, Mar 2 missed (no row at all), Mar 3 met.
    let days = ledger(vec![day("2026-03-01", 25.0, 20), day("2026-03-03", 25.0, 20)]);
    let result = evaluate(&days, &bought(&["2026-02-28", "2026-02-28"]), "2026-03-03", &state(0, 0, true));
    assert_eq!(result.streak, 3, "the bridged gap counts too");
    assert_eq!(result.covers, vec![("2026-03-02".to_string(), CoverKind::Grace)]);
    assert_eq!(result.state.freezes, 2, "freezes are untouched while grace remains");
    assert!(!result.state.grace_available);
  }

  #[test]
  fn a_freeze_covers_the_second_gap_once_grace_is_gone() {
    // Mar 1 met, Mar 2 and Mar 3 missed, Mar 4 met, one freeze bought.
    let days = ledger(vec![day("2026-03-01", 25.0, 20), day("2026-03-04", 25.0, 20)]);
    let result = evaluate(&days, &bought(&["2026-03-01"]), "2026-03-04", &state(1, 0, true));
    assert_eq!(result.streak, 4);
    assert_eq!(
      result.covers,
      vec![("2026-03-02".to_string(), CoverKind::Grace), ("2026-03-03".to_string(), CoverKind::Freeze)]
    );
    assert_eq!(result.state.freezes, 0);
  }

  #[test]
  fn a_freeze_bought_covers_from_the_day_it_was_bought_and_not_before() {
    // Mar 1-2 met, Mar 3 missed (grace's), Mar 4 missed.
    let days = ledger(met_from("2026-03-01", 2));
    // Bought on the 4th, before it ended: it keeps the streak.
    let kept = evaluate(&days, &bought(&["2026-03-04"]), "2026-03-05", &seen("2026-03-04"));
    assert_eq!((kept.streak, kept.broke_from, kept.state.freezes), (4, None, 0));
    // Bought on the 5th, after the 4th was a break: it is in the bank for later.
    let late = evaluate(&days, &bought(&["2026-03-05"]), "2026-03-05", &seen("2026-03-04"));
    assert_eq!((late.streak, late.broke_from, late.state.freezes), (0, Some(3), 1));
  }

  #[test]
  fn the_streak_breaks_when_nothing_can_cover_the_gap() {
    let days = ledger(vec![day("2026-03-01", 25.0, 20), day("2026-03-05", 25.0, 20)]);
    let result = evaluate(&days, &[], "2026-03-05", &seen("2026-03-02"));
    assert_eq!(result.streak, 1, "only today survives");
    assert_eq!(result.broke_from, Some(2), "the 1st, and the 2nd grace paid for");
  }

  #[test]
  fn a_break_refills_grace_for_the_new_streak() {
    let days = ledger(vec![day("2026-03-01", 25.0, 20), day("2026-03-05", 25.0, 20)]);
    let result = evaluate(&days, &[], "2026-03-05", &state(9, 0, false));
    assert!(result.state.grace_available);
  }

  #[test]
  fn an_empty_ledger_spends_nothing() {
    // The critical case: a brand new reader must not burn their grace bridging
    // a gap to a streak that never existed.
    let result = evaluate(&HashMap::new(), &bought(&["2026-03-01", "2026-03-02"]), "2026-03-05", &state(0, 0, true));
    assert_eq!(result.streak, 0);
    assert!(result.covers.is_empty());
    assert!(result.state.grace_available);
    assert_eq!(result.state.freezes, 2);
    assert_eq!(result.broke_from, None);
  }

  #[test]
  fn an_absence_is_paid_for_a_day_at_a_time_until_the_bank_is_empty() {
    // Two freezes bought, met once a month ago, nothing since: grace and the
    // freezes keep the 2nd to the 4th, as they did on a device opened each
    // day, and the 5th breaks a streak of four. Whenever it is walked.
    let days = ledger(vec![day("2026-02-01", 25.0, 20)]);
    let freezes = bought(&["2026-01-31", "2026-01-31"]);
    let result = evaluate(&days, &freezes, "2026-03-05", &seen("2026-02-01"));
    assert_eq!((result.streak, result.broke_from), (0, Some(4)));
    assert_eq!((result.state.freezes, result.state.grace_available), (0, true));
    assert_eq!(result.covers.len(), 3);
    let day_by_day = (2..=5).fold(seen("2026-02-01"), |previous, d| {
      evaluate(&days, &freezes, &format!("2026-02-{d:02}"), &previous).state
    });
    let late = evaluate(&days, &freezes, "2026-03-05", &day_by_day);
    assert_eq!((late.streak, late.state.freezes, late.state.longest_streak), (0, 0, 4));
  }

  #[test]
  fn freezes_accrue_every_five_days_and_stop_at_the_cap() {
    let ten_days = ledger(met_from("2026-03-01", 10));
    let at_four = evaluate(&ten_days, &[], "2026-03-04", &state(0, 0, true));
    assert_eq!(at_four.state.freezes, 0);
    // Crossing day 5 banks one.
    let at_five = evaluate(&ten_days, &[], "2026-03-05", &state(0, 0, true));
    assert_eq!((at_five.streak, at_five.state.freezes), (5, 1));
    // Crossing day 10 banks a second.
    let at_ten = evaluate(&ten_days, &[], "2026-03-10", &state(0, 0, true));
    assert_eq!(at_ten.state.freezes, 2);
    // A third crossing is capped.
    let capped = evaluate(&ledger(met_from("2026-03-01", 15)), &[], "2026-03-15", &state(0, 0, true));
    assert_eq!(capped.state.freezes, MAX_FREEZES);
  }

  #[test]
  fn a_freeze_earned_is_spent_on_a_later_gap() {
    // Five days earn one; Mar 6 is grace's, Mar 7 the freeze's, Mar 8 read.
    let mut entries = met_from("2026-03-01", 5);
    entries.push(day("2026-03-08", 25.0, 20));
    let result = evaluate(&ledger(entries), &[], "2026-03-08", &state(0, 0, true));
    assert_eq!(result.streak, 8);
    assert_eq!(result.covers.last(), Some(&("2026-03-07".to_string(), CoverKind::Freeze)));
    assert_eq!((result.state.freezes, result.state.grace_available), (0, false));
  }

  #[test]
  fn an_already_stamped_day_counts_without_being_stamped_again() {
    let days = ledger(vec![
      day("2026-03-01", 25.0, 20),
      stamped("2026-03-02", 0.0, CoverKind::Grace),
      day("2026-03-03", 25.0, 20)
    ]);
    let result = evaluate(&days, &[], "2026-03-03", &state(2, 1, false));
    assert_eq!(result.streak, 3);
    assert!(result.covers.is_empty(), "nothing new to stamp");
    assert_eq!(result.kept, vec![("2026-03-02".to_string(), CoverKind::Grace)]);
    assert!(!result.state.grace_available, "the stamp is grace spent");
  }

  #[test]
  fn a_stamp_the_bank_could_not_have_paid_for_counts_for_nothing() {
    // Mar 2 is grace's; Mar 4 says a freeze paid for it, but none was ever
    // earned or bought: a device walking with a bank of its own stamped it.
    let days = ledger(vec![
      day("2026-03-01", 25.0, 20),
      stamped("2026-03-02", 0.0, CoverKind::Grace),
      day("2026-03-03", 25.0, 20),
      stamped("2026-03-04", 2.0, CoverKind::Freeze),
      day("2026-03-05", 25.0, 20)
    ]);
    let result = evaluate(&days, &[], "2026-03-05", &seen("2026-03-05"));
    assert_eq!(result.streak, 1, "the 4th was a break");
    assert_eq!(result.state.longest_streak, 3);
    let judged = judged(&days, &result.kept);
    assert!(!judged["2026-03-04"].covered(), "a stamp not kept is taken off");
    assert!(judged["2026-03-02"].grace_used);
  }

  #[test]
  fn the_longest_streak_is_the_ledgers() {
    let days = ledger(vec![day("2026-03-04", 25.0, 20), day("2026-03-05", 25.0, 20)]);
    let mut previous = state(9, 0, false);
    previous.longest_streak = 40;
    let result = evaluate(&days, &[], "2026-03-05", &previous);
    assert_eq!(result.state.longest_streak, 2, "no device's own figure outlives the ledger");
  }

  #[test]
  fn each_day_is_judged_against_its_own_goal() {
    let days = ledger(vec![
      day("2026-03-01", 25.0, 20),
      // The goal raised to an hour: 30 minutes is short of it.
      day("2026-03-02", 30.0, 60),
      day("2026-03-03", 45.0, 40),
      // And lowered: 15 minutes meets 10.
      day("2026-03-04", 15.0, 10)
    ]);
    let result = evaluate(&days, &[], "2026-03-04", &state(0, 0, true));
    assert_eq!(result.streak, 4);
    assert_eq!(result.covers, vec![("2026-03-02".to_string(), CoverKind::Grace)]);
  }

  #[test]
  fn a_zero_goal_day_never_counts() {
    // Guards against a divide-by-nothing goal letting every day pass for free.
    let days = ledger(vec![day("2026-03-03", 0.0, 0)]);
    let result = evaluate(&days, &[], "2026-03-03", &state(0, 0, true));
    assert_eq!(result.streak, 0);
  }

  #[test]
  fn a_malformed_today_key_is_inert() {
    let days = ledger(vec![day("2026-03-03", 25.0, 20)]);
    let result = evaluate(&days, &[], "not-a-date", &state(3, 1, true));
    assert_eq!(result.streak, 3, "state is returned unchanged");
    assert_eq!(result.broke_from, None);
  }

  #[test]
  fn a_clock_set_back_is_not_a_broken_streak() {
    let days = ledger(met_from("2026-10-01", 3));
    // The same ledger, asked about the day before: a date line crossed going
    // east, or a clock corrected. One day fewer is counted, and nothing broke.
    let result = evaluate(&days, &[], "2026-10-02", &seen("2026-10-03"));
    assert_eq!(result.streak, 2);
    assert_eq!(result.broke_from, None);
    assert_eq!(result.state.last_evaluated_day.as_deref(), Some("2026-10-03"), "never wound back");

    // A real break is still one, asked on the same day or a later one.
    let gap = ledger(vec![day("2026-10-01", 25.0, 20), day("2026-10-05", 25.0, 20)]);
    assert_eq!(evaluate(&gap, &[], "2026-10-05", &seen("2026-10-03")).broke_from, Some(2));
    // But not asked about a day after the break, before the day last asked.
    assert_eq!(evaluate(&gap, &[], "2026-10-04", &seen("2026-10-06")).broke_from, None);
  }

  #[test]
  fn a_break_is_announced_once_and_never_on_a_device_new_to_the_ledger() {
    // Three days met, the 8th missed (grace), the 9th missed: a break.
    let days = ledger(met_from("2026-10-05", 3));
    let found = evaluate(&days, &[], "2026-10-10", &seen("2026-10-09"));
    assert_eq!((found.streak, found.broke_from), (0, Some(4)), "three days and grace's");
    let again = evaluate(&days, &[], "2026-10-10", &found.state);
    assert_eq!((again.streak, again.broke_from), (0, None));
    // A device that never evaluated before has no news of an old break.
    let fresh = evaluate(&days, &[], "2026-10-10", &StreakState::default());
    assert_eq!((fresh.streak, fresh.broke_from), (0, None));
  }

  #[test]
  fn a_break_is_final_and_the_grace_it_refills_is_for_the_streak_after() {
    // As above, then the 10th is read: a streak of one, not of six.
    let mut entries = met_from("2026-10-05", 3);
    entries.push(day("2026-10-10", 25.0, 20));
    let met = evaluate(&ledger(entries.clone()), &[], "2026-10-10", &seen("2026-10-10"));
    assert_eq!(met.streak, 1);

    // The 11th is missed and the 12th read: that gap is the new streak's, and its grace pays.
    entries.push(day("2026-10-12", 25.0, 20));
    let covered = evaluate(&ledger(entries), &[], "2026-10-12", &met.state);
    assert_eq!(covered.streak, 3);
    assert_eq!(covered.covers.last(), Some(&("2026-10-11".to_string(), CoverKind::Grace)));
    assert_eq!(covered.broke_from, None);
  }

  #[test]
  fn a_streak_state_from_an_earlier_version_reads_as_no_break_on_record() {
    let saved = r#"{"currentStreak":4,"longestStreak":9,"freezes":1,"graceAvailable":false,"lastEvaluatedDay":"2026-10-03","peakShelf":12}"#;
    let state: StreakState = serde_json::from_str(saved).expect("reads");
    assert_eq!((state.current_streak, state.freezes, state.broke_on), (4, 1, None));
  }

  // ---- one streak on every device ------------------------------------------

  /// A ledger shaped like the one in the report of two devices disagreeing
  /// (made up, not the reader's): five days short of the goal; three days
  /// met, grace for a fourth, and a day with nothing to pay; three met, grace,
  /// a fifth met that earns a freeze, the freeze spent, and a day with nothing
  /// to pay; two days met and today under way.
  fn two_devices_ledger() -> Vec<DayRecord> {
    let minutes = [
      1.0, 9.0, 6.0, 8.0, 19.0, // Mar 1-5: short
      200.0, 90.0, 21.0,        // Mar 6-8: met
      1.0,                      // Mar 9: grace
      5.0, 13.0,                // Mar 10: nothing left, a break; Mar 11
      70.0, 70.0, 230.0,        // Mar 12-14: met
      6.0,                      // Mar 15: grace
      160.0,                    // Mar 16: met, the fifth day: a freeze
      1.0,                      // Mar 17: the freeze
      2.0,                      // Mar 18: missed, nothing left: a break
      40.0, 170.0,              // Mar 19-20: met
      11.0                      // Mar 21: today, under way
    ];
    let mut entries: Vec<DayRecord> =
      minutes.iter().enumerate().map(|(at, m)| day(&format!("2026-03-{:02}", at + 1), *m, 20)).collect();
    // As the device that walked it day by day stamped it.
    entries[8].grace_used = true;
    entries[14].grace_used = true;
    entries[16].freeze_used = true;
    entries
  }

  #[test]
  fn the_reported_ledger_has_a_streak_of_two_and_three_once_today_is_met() {
    let days = ledger(two_devices_ledger());
    let result = evaluate(&days, &[], "2026-03-21", &seen("2026-03-21"));
    assert_eq!(result.streak, 2, "the 18th, short and unpaid for, broke the streak");
    assert_eq!(result.state.longest_streak, 6);
    assert_eq!((result.state.freezes, result.state.grace_available), (0, true));
    assert!(result.covers.is_empty());
    // No cold: the 19th nursed her back.
    assert_eq!(cold(&judged(&days, &result.kept), "2026-03-21", 20), None);

    let mut entries = two_devices_ledger();
    entries[20].minutes = 25.0;
    assert_eq!(evaluate(&ledger(entries), &[], "2026-03-21", &seen("2026-03-21")).streak, 3);
  }

  #[test]
  fn a_device_new_to_the_ledger_reaches_the_same_streak_and_its_stamps_change_nothing() {
    // The way the second device came to 16: a fresh bank walked the adopted
    // ledger, stamped grace and freezes on days already judged breaks, and
    // walked again. Those stamps synced back to the first device.
    let mut days = ledger(two_devices_ledger());
    let mut previous = StreakState::default();
    for _ in 0..5 {
      let walked = evaluate(&days, &[], "2026-03-21", &previous);
      assert_eq!(walked.streak, 2);
      assert_eq!(walked.broke_from, None, "an old break is no news to a new device");
      for (key, kind) in &walked.covers {
        let record = days.get_mut(key).expect("a day");
        match kind {
          CoverKind::Grace => record.grace_used = true,
          CoverKind::Freeze => record.freeze_used = true
        }
      }
      previous = walked.state;
    }
    // The stamps that walk once made, now in the ledger: still two.
    for (key, kind) in [("2026-03-18", CoverKind::Grace), ("2026-03-11", CoverKind::Grace), ("2026-03-10", CoverKind::Freeze)] {
      let record = days.get_mut(key).expect("a day");
      match kind {
        CoverKind::Grace => record.grace_used = true,
        CoverKind::Freeze => record.freeze_used = true
      }
    }
    let stamped = evaluate(&days, &[], "2026-03-21", &previous);
    assert_eq!((stamped.streak, stamped.state.longest_streak), (2, 6));
  }

  #[test]
  fn two_devices_with_the_same_ledger_reach_the_same_streak_whatever_their_own_state() {
    let days = ledger(two_devices_ledger());
    let desktop = StreakState { last_evaluated_day: Some("2026-03-21".into()), ..state(2, 0, true) };
    let phone = StreakState { longest_streak: 16, last_evaluated_day: Some("2026-03-21".into()), ..state(16, 2, false) };
    let a = evaluate(&days, &[], "2026-03-21", &desktop);
    let b = evaluate(&days, &[], "2026-03-21", &phone);
    let c = evaluate(&days, &[], "2026-03-21", &StreakState::default());
    for other in [&b, &c] {
      assert_eq!(a.streak, other.streak);
      assert_eq!(a.state.longest_streak, other.state.longest_streak);
      assert_eq!(a.state.freezes, other.state.freezes);
      assert_eq!(a.state.grace_available, other.state.grace_available);
      assert_eq!(a.kept, other.kept);
    }
  }

  #[test]
  fn a_freeze_spent_on_one_device_is_not_spent_again_on_the_other() {
    // One freeze bought; the 1st met, the 2nd (grace's) and 3rd missed, the 4th met.
    let entries = vec![day("2026-03-01", 25.0, 20), day("2026-03-04", 25.0, 20)];
    let freezes = bought(&["2026-03-01"]);
    let mut here = ledger(entries);
    let walked = evaluate(&here, &freezes, "2026-03-04", &seen("2026-03-03"));
    assert_eq!(walked.streak, 4);
    assert_eq!(walked.state.freezes, 0);
    for (key, kind) in &walked.covers {
      let record = here.entry(key.clone()).or_insert_with(|| day(key, 0.0, 20));
      match kind {
        CoverKind::Grace => record.grace_used = true,
        CoverKind::Freeze => record.freeze_used = true
      }
    }

    // The other device: the synced ledger and purchase, and a bank of two of
    // its own on record. The freeze is spent there too.
    let there = evaluate(&here, &freezes, "2026-03-04", &state(3, 2, true));
    assert_eq!((there.streak, there.state.freezes), (4, 0));
    assert!(there.covers.is_empty(), "nothing is paid for twice");
    assert_eq!(there.kept, walked.kept);
    // The 5th missed: nothing left, on either device.
    for previous in [&walked.state, &state(4, 2, true)] {
      let after = evaluate(&here, &freezes, "2026-03-06", previous);
      assert_eq!(after.streak, 0);
    }
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
    let walked = evaluate(&days, &[], "2026-10-11", &seen("2026-10-10"));
    assert_eq!(walked.broke_from, None);
    assert_eq!(walked.covers, vec![("2026-10-10".to_string(), CoverKind::Grace)]);
    for (key, kind) in &walked.covers {
      stamp(&mut days, key, *kind);
    }
    assert_eq!(cold(&days, "2026-10-11", 20), None);

    // Two days away (or one, and a date skipped flying east): grace and the
    // freeze the fifth day earned.
    let mut days = ledger(streak_before("2026-10-10", 5));
    let walked = evaluate(&days, &[], "2026-10-12", &seen("2026-10-10"));
    assert_eq!((walked.broke_from, walked.covers.len()), (None, 2));
    for (key, kind) in &walked.covers {
      stamp(&mut days, key, *kind);
    }
    assert_eq!(cold(&days, "2026-10-12", 20), None);

    // Nothing left to pay with (grace spent on the 7th, no freeze earned):
    // a break, and a cold, read from the ledger as the walk judged it.
    let mut entries = streak_before("2026-10-07", 1);
    entries.extend(met_from("2026-10-08", 2));
    let days = ledger(entries);
    let walked = evaluate(&days, &[], "2026-10-11", &seen("2026-10-10"));
    assert_eq!((walked.streak, walked.broke_from), (0, Some(4)));
    let judged = judged(&days, &walked.kept);
    assert_eq!(cold(&judged, "2026-10-11", 20).map(|caught| caught.broke_from), Some(4));
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
    FreeRead::of(date_key, minutes)
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
