//! Stakes: seeds bet on the reader's own reading.
//!
//! Two kinds, both plain records in the purchase ledger (kind `stake`), so
//! they sync like anything bought and nothing about them is stored as a
//! balance or a flag:
//!
//! * **The week's goal.** Item id `goal:<ISO week>:<days>`, price the seeds
//!   staked: "I will meet my daily goal on at least this many days of this
//!   week." Whether it was won is never written down. It is read from the day
//!   ledger every time, and a won stake pays back twice its seeds
//!   (`goal_winnings`, in `habit::seeds::SeedEarnings::stakes`).
//! * **A duel.** Item id `duel:<duel id>`. Duels are decided on a server this
//!   code cannot ask, so the outcome is a second record (kind `prize`, the
//!   same item id) written when the app is told how it went. A prize is
//!   income, never spending, and it counts for no more than twice the stake
//!   record beside it: a prize written by hand mints nothing a real bet could
//!   not have won (`duel_prizes`, in `SeedEarnings::prizes`).
//!
//! Records from two devices merge as a union, so there can be two stakes
//! where the rules allow one. The first (`in_order`) is the stake; the others
//! are neither charged nor paid.

use super::{hex_id, in_order, Purchase, ShopError};
use crate::habit::DayRecord;
use chrono::{Datelike, NaiveDate};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

pub const KIND_STAKE: &str = "stake";
pub const KIND_PRIZE: &str = "prize";

/// What a goal stake may be: so many seeds, on so many days of the week.
pub const GOAL_MIN_SEEDS: i64 = 5;
pub const GOAL_MAX_SEEDS: i64 = 100;
pub const GOAL_MIN_DAYS: i64 = 3;
pub const GOAL_MAX_DAYS: i64 = 7;
/// The last day of the week one can be placed on: 1 is Monday, so Wednesday.
/// Later than that the week is nearly decided, and the bet would be on
/// something already known.
pub const GOAL_LAST_WEEKDAY: i64 = 3;
/// What a duel stake may be.
pub const DUEL_MIN_SEEDS: i64 = 1;
pub const DUEL_MAX_SEEDS: i64 = 50;
/// A duel stake that is won comes back this many times over.
pub const WIN_TIMES: i64 = 2;
/// A day counts towards a goal stake only with this much reading on it,
/// whatever the daily goal is set to. The goal can be as low as five minutes,
/// and a bet on five minutes a day would be seeds for nothing.
pub const GOAL_DAY_MINUTES: f64 = 20.0;
/// What a won goal stake adds to the stake itself, in hundredths of it, for
/// each day staked beyond two: three days pays a fifth on top, seven days
/// doubles it. The harder the promise, the more it is worth keeping.
pub const GOAL_GAIN_PER_DAY: i64 = 20;

fn parse_day(key: &str) -> Option<NaiveDate> {
  NaiveDate::parse_from_str(key, "%Y-%m-%d").ok()
}

/// The ISO week a local date is in, as the board names weeks: `2026-W41`.
pub fn week_key(date: NaiveDate) -> String {
  let week = date.iso_week();
  format!("{}-W{:02}", week.year(), week.week())
}

/// The Monday a week key names, or none for one that names no week.
fn week_monday(key: &str) -> Option<NaiveDate> {
  let (year, week) = key.split_once("-W")?;
  let monday = NaiveDate::from_isoywd_opt(year.parse().ok()?, week.parse().ok()?, chrono::Weekday::Mon)?;
  // Only the one spelling: `2026-W7` and `2026-W07` are not two weeks.
  (week_key(monday) == key).then_some(monday)
}

// ---- the week's goal ------------------------------------------------------------

/// A stake on a week's goal, as its record has it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoalStake {
  pub week_key: String,
  /// The week's first day; its last is six days on.
  pub monday: NaiveDate,
  /// Seeds staked: the record's price.
  pub seeds: i64,
  /// Days of the week the goal must be met on.
  pub days: i64
}

/// The item id of a goal stake.
pub fn goal_item_id(week_key: &str, days: i64) -> String {
  format!("goal:{week_key}:{days}")
}

/// Reads a record as a goal stake, when it is one.
fn goal_stake_of(purchase: &Purchase) -> Option<GoalStake> {
  if purchase.item_kind != KIND_STAKE {
    return None;
  }
  let (week, days) = purchase.item_id.strip_prefix("goal:")?.rsplit_once(':')?;
  let monday = week_monday(week)?;
  Some(GoalStake { week_key: week.to_string(), monday, seeds: purchase.price, days: days.parse().ok()? })
}

/// What a record is charged once for (`pip::spent`). A week's goal stake is
/// charged once for the week, whatever number of days each record names: two
/// devices offline can each place one, and a sync must not charge both. For
/// everything else it is the item itself.
pub(crate) fn charge_key(purchase: &Purchase) -> &str {
  if goal_stake_of(purchase).is_none() {
    return &purchase.item_id;
  }
  purchase.item_id.rsplit_once(':').map(|(week, _)| week).unwrap_or(&purchase.item_id)
}

impl GoalStake {
  /// Whether the record is one the shop would have written. A stake outside
  /// the rules (a record made by hand) can win nothing; its seeds are spent
  /// all the same.
  pub fn within_rules(&self) -> bool {
    (GOAL_MIN_SEEDS..=GOAL_MAX_SEEDS).contains(&self.seeds) && (GOAL_MIN_DAYS..=GOAL_MAX_DAYS).contains(&self.days)
  }

  /// Days of its week on which the goal was met by reading. A day paid for
  /// with grace or a freeze keeps a streak going, but it is not a day read:
  /// it does not count here, as it earns no goal bonus either.
  pub fn met(&self, ledger: &HashMap<String, DayRecord>) -> i64 {
    (0..7)
      .map(|day| (self.monday + chrono::Duration::days(day)).format("%Y-%m-%d").to_string())
      .filter(|key| ledger.get(key).is_some_and(|day| day.goal_met() && day.minutes >= GOAL_DAY_MINUTES))
      .count() as i64
  }

  /// Won as soon as the days are there; a day's reading is never taken back,
  /// so a stake once won stays won.
  pub fn won(&self, ledger: &HashMap<String, DayRecord>) -> bool {
    self.within_rules() && self.met(ledger) >= self.days
  }

  /// What a win pays: the stake back, and a share of it on top that grows
  /// with the days promised (`GOAL_GAIN_PER_DAY`), never less than one seed.
  pub fn prize(&self) -> i64 {
    if !self.within_rules() {
      return 0;
    }
    self.seeds + (self.seeds * (self.days - 2) * GOAL_GAIN_PER_DAY / 100).max(1)
  }
}

/// The stake on each week's goal: the first record for that week, and no
/// other. A later one (a second device's, or a made-up one) counts for nothing.
pub fn goal_stakes(purchases: &[Purchase]) -> BTreeMap<String, GoalStake> {
  let mut by_week = BTreeMap::new();
  for stake in in_order(purchases).into_iter().filter_map(goal_stake_of) {
    by_week.entry(stake.week_key.clone()).or_insert(stake);
  }
  by_week
}

/// Seeds won on the week's goal, ever: every won stake's prize.
pub fn goal_winnings(purchases: &[Purchase], ledger: &HashMap<String, DayRecord>) -> i64 {
  goal_stakes(purchases).values().filter(|stake| stake.won(ledger)).map(GoalStake::prize).sum()
}

/// A goal stake as the Pip tab shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalStakeView {
  pub week_key: String,
  pub seeds: i64,
  /// Days the stake asks for, and days the goal has been met on so far.
  pub days: i64,
  pub met: i64,
  /// "open" while the week runs, "won" from the moment the days are there,
  /// "lost" once the week is over without them.
  pub state: &'static str,
  /// What it pays if it is won (open), what it paid (won), nothing (lost).
  pub payout: i64
}

fn view_of(stake: &GoalStake, ledger: &HashMap<String, DayRecord>, today: NaiveDate) -> GoalStakeView {
  let sunday = stake.monday + chrono::Duration::days(6);
  let state = if stake.won(ledger) {
    "won"
  } else if today > sunday || !stake.within_rules() {
    "lost"
  } else {
    "open"
  };
  GoalStakeView {
    week_key: stake.week_key.clone(),
    seeds: stake.seeds,
    days: stake.days,
    met: stake.met(ledger),
    state,
    payout: if state == "lost" { 0 } else { stake.prize() }
  }
}

/// The stake to show on `today_key` (the reader's local day): this week's,
/// or with nothing staked this week, last week's, so its outcome is still
/// there to see for the week after it was decided.
pub fn goal_stake_view(
  purchases: &[Purchase],
  ledger: &HashMap<String, DayRecord>,
  today_key: &str
) -> Option<GoalStakeView> {
  let today = parse_day(today_key)?;
  let stakes = goal_stakes(purchases);
  let last_week = today - chrono::Duration::days(7);
  stakes
    .get(&week_key(today))
    .or_else(|| stakes.get(&week_key(last_week)))
    .map(|stake| view_of(stake, ledger, today))
}

/// Whether a stake on this week's goal can be placed today, and the item id
/// its record takes.
///
/// One a week, on Monday, Tuesday or Wednesday, for a number of days that is
/// neither in the bag already nor out of reach: a bet has to be on something
/// not yet known.
pub fn check_goal_stake(
  purchases: &[Purchase],
  ledger: &HashMap<String, DayRecord>,
  balance: i64,
  seeds: i64,
  days: i64,
  today_key: &str
) -> Result<String, String> {
  let today = parse_day(today_key).ok_or_else(|| "That isn't a day.".to_string())?;
  if !(GOAL_MIN_SEEDS..=GOAL_MAX_SEEDS).contains(&seeds) {
    return Err(format!("A stake is {GOAL_MIN_SEEDS} to {GOAL_MAX_SEEDS} seeds."));
  }
  if !(GOAL_MIN_DAYS..=GOAL_MAX_DAYS).contains(&days) {
    return Err(format!("A stake is on {GOAL_MIN_DAYS} to {GOAL_MAX_DAYS} days of the week."));
  }
  let week = week_key(today);
  if goal_stakes(purchases).contains_key(&week) {
    return Err("This week's stake is already placed.".to_string());
  }
  let weekday = i64::from(today.weekday().number_from_monday());
  if weekday > GOAL_LAST_WEEKDAY {
    return Err("A week's stake is placed by Wednesday. Next week's opens on Monday.".to_string());
  }
  let monday = today - chrono::Duration::days(weekday - 1);
  let stake = GoalStake { week_key: week.clone(), monday, seeds, days };
  let met = stake.met(ledger);
  if met >= days {
    return Err("You've met your goal on that many days this week already.".to_string());
  }
  // Days met before today, and every day from today to Sunday.
  let today_met = ledger.get(today_key).is_some_and(DayRecord::goal_met);
  let reachable = met - i64::from(today_met) + (8 - weekday);
  if reachable < days {
    return Err("There aren't that many days left in this week.".to_string());
  }
  if balance < seeds {
    return Err(ShopError::CannotAfford { short: seeds - balance }.to_string());
  }
  Ok(goal_item_id(&week, days))
}

// ---- a duel ------------------------------------------------------------------

/// The item id of a duel's stake, and of its prize.
pub fn duel_item_id(duel_id: &str) -> String {
  format!("duel:{duel_id}")
}

/// The seeds staked on each duel: the first stake record for it, and nothing
/// for one outside what a duel stake may be.
fn duel_stakes(purchases: &[Purchase]) -> BTreeMap<&str, i64> {
  let mut by_duel = BTreeMap::new();
  for purchase in in_order(purchases).into_iter().filter(|purchase| purchase.item_kind == KIND_STAKE) {
    if let Some(duel) = purchase.item_id.strip_prefix("duel:") {
      let seeds = if (DUEL_MIN_SEEDS..=DUEL_MAX_SEEDS).contains(&purchase.price) { purchase.price } else { 0 };
      by_duel.entry(duel).or_insert(seeds);
    }
  }
  by_duel
}

/// Seeds staked on a duel, if any are.
pub fn duel_stake(purchases: &[Purchase], duel_id: &str) -> Option<i64> {
  duel_stakes(purchases).get(duel_id).copied()
}

/// Whether a duel's prize is on record (on any device).
pub fn duel_settled(purchases: &[Purchase], duel_id: &str) -> bool {
  let item = duel_item_id(duel_id);
  purchases.iter().any(|purchase| purchase.item_kind == KIND_PRIZE && purchase.item_id == item)
}

/// Whether seeds can be staked on a duel, and the item id the record takes.
pub fn check_duel_stake(balance: i64, duel_id: &str, seeds: i64) -> Result<String, String> {
  if !hex_id(duel_id) {
    return Err("That isn't a duel.".to_string());
  }
  if !(DUEL_MIN_SEEDS..=DUEL_MAX_SEEDS).contains(&seeds) {
    return Err(format!("A duel stake is {DUEL_MIN_SEEDS} to {DUEL_MAX_SEEDS} seeds."));
  }
  if balance < seeds {
    return Err(ShopError::CannotAfford { short: seeds - balance }.to_string());
  }
  Ok(duel_item_id(duel_id))
}

/// What a duel's outcome pays on a stake of `seeds`: twice the stake for a
/// win, the stake back for a tie, nothing (and no record) for a loss.
pub fn duel_prize(seeds: i64, outcome: &str) -> Result<i64, String> {
  match outcome {
    "won" => Ok(seeds * WIN_TIMES),
    "tied" => Ok(seeds),
    "lost" => Ok(0),
    _ => Err("A duel is won, lost or tied.".to_string())
  }
}

/// Seeds won in duels, ever. For each duel the first prize on record, and
/// never more than twice its own stake record: a prize with no stake beside
/// it, or with a stake outside the rules, is worth nothing.
pub fn duel_prizes(purchases: &[Purchase]) -> i64 {
  let stakes = duel_stakes(purchases);
  let mut paid: BTreeMap<&str, i64> = BTreeMap::new();
  for purchase in in_order(purchases).into_iter().filter(|purchase| purchase.item_kind == KIND_PRIZE) {
    if let Some(duel) = purchase.item_id.strip_prefix("duel:") {
      let most = stakes.get(duel).copied().unwrap_or(0) * WIN_TIMES;
      paid.entry(duel).or_insert_with(|| purchase.price.clamp(0, most));
    }
  }
  paid.values().sum()
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::pip::{owned, spent, Catalogue};

  const DUEL: &str = "0123456789abcdef01234567";
  const OTHER: &str = "89abcdef0123456789abcdef";

  fn catalogue() -> Catalogue {
    Catalogue::parse(r#"{"items":[{"kind":"skin","id":"sprout","price":0},{"kind":"move","id":"read","price":0}]}"#).expect("parses")
  }

  fn record(id: &str, kind: &str, item: &str, price: i64, at: &str) -> Purchase {
    Purchase { id: id.into(), item_kind: kind.into(), item_id: item.into(), price, bought_at: at.into() }
  }

  /// A stake on the goal for the week of Monday 5 October 2026 (`2026-W41`).
  fn staked(id: &str, seeds: i64, days: i64, at: &str) -> Purchase {
    record(id, KIND_STAKE, &goal_item_id("2026-W41", days), seeds, at)
  }

  fn day(key: &str, minutes: f64) -> DayRecord {
    DayRecord { date_key: key.to_string(), minutes, goal_minutes: 20, freeze_used: false, grace_used: false }
  }

  /// A ledger with the goal met on these days of October 2026.
  fn met_on(dates: &[u32]) -> HashMap<String, DayRecord> {
    dates
      .iter()
      .map(|date| format!("2026-10-{date:02}"))
      .map(|key| (key.clone(), day(&key, 25.0)))
      .collect()
  }

  const MONDAY: &str = "2026-10-05T08:00:00+05:30";

  // ---- weeks -----------------------------------------------------------------

  #[test]
  fn a_week_runs_monday_to_sunday_by_the_readers_dates() {
    let date = |key: &str| parse_day(key).expect("a date");
    assert_eq!(week_key(date("2026-10-05")), "2026-W41");
    assert_eq!(week_key(date("2026-10-11")), "2026-W41");
    assert_eq!(week_key(date("2026-10-12")), "2026-W42");
    assert_eq!(week_monday("2026-W41"), Some(date("2026-10-05")));
    // The year a week belongs to is the ISO one: 1 January 2027 is a Friday
    // of the last week of 2026.
    assert_eq!(week_key(date("2027-01-01")), "2026-W53");
    for odd in ["2026-W7", "2026-W54", "2026-41", "W41", ""] {
      assert_eq!(week_monday(odd), None, "{odd}");
    }
  }

  // ---- the week's goal ----------------------------------------------------------

  #[test]
  fn a_stake_is_won_as_soon_as_the_days_are_there_and_pays_more_for_more_days() {
    let records = [staked("buy-1", 20, 3, MONDAY)];
    assert_eq!(goal_winnings(&records, &met_on(&[5, 6])), 0);
    assert_eq!(goal_winnings(&records, &met_on(&[5, 6, 8])), 24, "won on Thursday, before the week is out");
    assert_eq!(goal_winnings(&records, &met_on(&[5, 6, 8, 9, 10, 11])), 24, "more days read than promised pay no more");
    // The harder the promise, the more it pays: a fifth on top for three days, double for all seven.
    let all_week = met_on(&[5, 6, 7, 8, 9, 10, 11]);
    let pays = |seeds: i64, days: i64| goal_winnings(&[staked("buy-1", seeds, days, MONDAY)], &all_week);
    assert_eq!([pays(50, 3), pays(50, 4), pays(50, 5), pays(50, 6), pays(50, 7)], [60, 70, 80, 90, 100]);
    assert_eq!(pays(5, 3), 6, "never less than a seed on top");
    // A day short of twenty minutes is not a day for a stake, whatever the goal is set to.
    let mut short = met_on(&[5, 6, 8]);
    short.insert("2026-10-08".to_string(), DayRecord { date_key: "2026-10-08".to_string(), minutes: 6.0, goal_minutes: 5, freeze_used: false, grace_used: false });
    assert_eq!(goal_winnings(&records, &short), 0);
    // Days of other weeks are not this week's.
    assert_eq!(goal_winnings(&records, &met_on(&[2, 3, 4, 5, 12, 13])), 0);
  }

  #[test]
  fn a_lost_stake_pays_nothing_and_is_still_spent() {
    let records = [staked("buy-1", 20, 5, MONDAY)];
    let ledger = met_on(&[5, 6, 7, 8]);
    assert_eq!(goal_winnings(&records, &ledger), 0);
    assert_eq!(spent(&catalogue(), &records), 20);
    let view = goal_stake_view(&records, &ledger, "2026-10-12").expect("last week's stake");
    assert_eq!((view.state, view.met, view.payout), ("lost", 4, 0));
  }

  #[test]
  fn a_day_covered_by_a_freeze_or_grace_is_not_a_day_met() {
    let records = [staked("buy-1", 20, 3, MONDAY)];
    let mut ledger = met_on(&[5, 6]);
    let mut frozen = day("2026-10-07", 0.0);
    frozen.freeze_used = true;
    let mut graced = day("2026-10-08", 4.0);
    graced.grace_used = true;
    ledger.insert(frozen.date_key.clone(), frozen);
    ledger.insert(graced.date_key.clone(), graced);
    assert_eq!(goal_stakes(&records)["2026-W41"].met(&ledger), 2);
    assert_eq!(goal_winnings(&records, &ledger), 0);
    // Read short of the goal is not met either.
    ledger.insert("2026-10-09".into(), day("2026-10-09", 19.0));
    assert_eq!(goal_winnings(&records, &ledger), 0);
  }

  #[test]
  fn one_stake_counts_a_week_and_it_is_the_first() {
    // The laptop staked 20 on three days; the phone, offline, 50 on six.
    let laptop = staked("buy-a", 20, 3, MONDAY);
    let phone = staked("buy-b", 50, 6, "2026-10-06T09:00:00+05:30");
    let ledger = met_on(&[5, 6, 7, 8, 9, 10]);
    for records in [[laptop.clone(), phone.clone()], [phone.clone(), laptop.clone()]] {
      assert_eq!(goal_winnings(&records, &ledger), 24, "the first stake's prize, once");
      assert_eq!(spent(&catalogue(), &records), 20, "and only the first is charged");
    }
    // Made at the same moment, the id decides, the same way on every device.
    let twin = staked("buy-0", 50, 6, MONDAY);
    assert_eq!(goal_stakes(&[laptop, twin])["2026-W41"].seeds, 50);
  }

  #[test]
  fn a_stake_outside_the_rules_wins_nothing_and_is_still_spent() {
    let ledger = met_on(&[5, 6, 7, 8, 9, 10, 11]);
    for (seeds, days) in [(4, 3), (101, 3), (5000, 7), (20, 2), (20, 8), (20, 0), (-20, 3)] {
      let records = [staked("buy-1", seeds, days, MONDAY)];
      assert_eq!(goal_winnings(&records, &ledger), 0, "{seeds} seeds on {days} days");
      assert_eq!(spent(&catalogue(), &records), seeds.max(0), "{seeds} seeds on {days} days");
      let view = goal_stake_view(&records, &ledger, "2026-10-06").expect("shown");
      assert_eq!((view.state, view.payout), ("lost", 0));
    }
    // The edges of the rules are inside them.
    for (seeds, days) in [(5, 3), (100, 7)] {
      assert_eq!(goal_winnings(&[staked("buy-1", seeds, days, MONDAY)], &ledger), seeds + (seeds * (days - 2) / 5).max(1));
    }
    // A made-up one cannot push the real one aside by being first: it is the
    // week's stake, and the week's stake is worth nothing.
    let forged = staked("buy-0", 5000, 3, "2026-10-05T00:00:01+05:30");
    assert_eq!(goal_winnings(&[forged, staked("buy-1", 20, 3, MONDAY)], &ledger), 0);
  }

  #[test]
  fn a_record_that_names_no_week_is_no_stake() {
    let ledger = met_on(&[5, 6, 7, 8, 9, 10, 11]);
    for item in ["goal:2026-W41", "goal:2026-W99:3", "goal:soon:3", "goal:2026-W41:many", "goal::3"] {
      let records = [record("buy-1", KIND_STAKE, item, 20, MONDAY)];
      assert!(goal_stakes(&records).is_empty(), "{item}");
      assert_eq!(goal_winnings(&records, &ledger), 0, "{item}");
    }
    // A thing bought that happens to be called like one is not a stake.
    assert!(goal_stakes(&[record("buy-1", "room", &goal_item_id("2026-W41", 3), 20, MONDAY)]).is_empty());
  }

  #[test]
  fn the_view_follows_the_week() {
    let records = [staked("buy-1", 20, 4, MONDAY)];
    let open = goal_stake_view(&records, &met_on(&[5, 6]), "2026-10-07").expect("this week's");
    assert_eq!(
      open,
      GoalStakeView { week_key: "2026-W41".into(), seeds: 20, days: 4, met: 2, state: "open", payout: 28 }
    );
    // Still open on Sunday: the day is not over.
    assert_eq!(goal_stake_view(&records, &met_on(&[5, 6, 7]), "2026-10-11").map(|view| view.state), Some("open"));
    let won = goal_stake_view(&records, &met_on(&[5, 6, 7, 9]), "2026-10-09").expect("this week's");
    assert_eq!((won.state, won.met, won.payout), ("won", 4, 28));
    // The week after, its outcome is still shown; the week after that, gone.
    assert_eq!(goal_stake_view(&records, &met_on(&[5, 6, 7, 9]), "2026-10-15").map(|view| view.state), Some("won"));
    assert_eq!(goal_stake_view(&records, &met_on(&[5, 6]), "2026-10-18").map(|view| view.state), Some("lost"));
    assert_eq!(goal_stake_view(&records, &met_on(&[5, 6, 7, 9]), "2026-10-19"), None);
    // A new week's stake takes its place.
    let next = record("buy-2", KIND_STAKE, &goal_item_id("2026-W42", 3), 10, "2026-10-12T08:00:00+05:30");
    let both = [records[0].clone(), next];
    assert_eq!(goal_stake_view(&both, &met_on(&[5, 6]), "2026-10-13").map(|view| view.week_key), Some("2026-W42".into()));
    assert_eq!(goal_stake_view(&[], &met_on(&[5, 6]), "2026-10-07"), None);
    assert_eq!(goal_stake_view(&records, &met_on(&[5, 6]), "today"), None);
  }

  #[test]
  fn the_view_is_told_in_camel_case() {
    let records = [staked("buy-1", 20, 4, MONDAY)];
    let view = goal_stake_view(&records, &met_on(&[5]), "2026-10-06").expect("this week's");
    assert_eq!(
      serde_json::to_string(&view).expect("encodes"),
      r#"{"weekKey":"2026-W41","seeds":20,"days":4,"met":1,"state":"open","payout":28}"#
    );
  }

  #[test]
  fn a_stake_is_placed_by_wednesday_once_a_week() {
    let none = HashMap::new();
    for (today, ok) in [
      ("2026-10-05", true),
      ("2026-10-06", true),
      ("2026-10-07", true),
      ("2026-10-08", false),
      ("2026-10-10", false),
      ("2026-10-11", false)
    ] {
      assert_eq!(check_goal_stake(&[], &none, 500, 20, 3, today).is_ok(), ok, "{today}");
    }
    assert_eq!(check_goal_stake(&[], &none, 500, 20, 3, "2026-10-05"), Ok("goal:2026-W41:3".to_string()));
    // One a week, whatever it was for; next week is another.
    let placed = [staked("buy-1", 20, 3, MONDAY)];
    assert!(check_goal_stake(&placed, &none, 500, 10, 5, "2026-10-06").is_err());
    assert_eq!(check_goal_stake(&placed, &none, 500, 10, 5, "2026-10-12"), Ok("goal:2026-W42:5".to_string()));
  }

  #[test]
  fn a_stake_is_within_its_rules_and_the_balance() {
    let none = HashMap::new();
    for (seeds, days) in [(4, 3), (101, 3), (0, 3), (-5, 3), (20, 2), (20, 8)] {
      assert!(check_goal_stake(&[], &none, 500, seeds, days, "2026-10-05").is_err(), "{seeds} on {days}");
    }
    assert!(check_goal_stake(&[], &none, 500, 5, 3, "2026-10-05").is_ok());
    assert!(check_goal_stake(&[], &none, 500, 100, 7, "2026-10-05").is_ok());
    assert_eq!(
      check_goal_stake(&[], &none, 12, 20, 3, "2026-10-05"),
      Err(ShopError::CannotAfford { short: 8 }.to_string())
    );
    assert!(check_goal_stake(&[], &none, 500, 20, 3, "Monday").is_err());
  }

  #[test]
  fn a_stake_is_on_something_not_yet_known() {
    // Wednesday, with Monday missed: five days are left, so six are out of reach.
    let tuesday_only = met_on(&[6]);
    assert!(check_goal_stake(&[], &tuesday_only, 500, 20, 7, "2026-10-07").is_err());
    assert!(check_goal_stake(&[], &tuesday_only, 500, 20, 6, "2026-10-07").is_ok(), "Tuesday, and Wednesday to Sunday");
    // Today already met is one of the days from today on, not one more.
    let today_too = met_on(&[6, 7]);
    assert!(check_goal_stake(&[], &today_too, 500, 20, 6, "2026-10-07").is_ok());
    assert!(check_goal_stake(&[], &today_too, 500, 20, 7, "2026-10-07").is_err());
    // Three days met by Wednesday: a stake on three is already won.
    let all_three = met_on(&[5, 6, 7]);
    assert!(check_goal_stake(&[], &all_three, 500, 20, 3, "2026-10-07").is_err());
    assert!(check_goal_stake(&[], &all_three, 500, 20, 4, "2026-10-07").is_ok());
    // On Monday every number of days is still open.
    assert!(check_goal_stake(&[], &HashMap::new(), 500, 20, 7, "2026-10-05").is_ok());
  }

  // ---- duels ----------------------------------------------------------------

  fn duel_stake_record(id: &str, duel: &str, seeds: i64) -> Purchase {
    record(id, KIND_STAKE, &duel_item_id(duel), seeds, MONDAY)
  }

  fn prize(id: &str, duel: &str, seeds: i64) -> Purchase {
    record(id, KIND_PRIZE, &duel_item_id(duel), seeds, "2026-10-08T08:00:00+05:30")
  }

  #[test]
  fn a_duel_stake_is_one_to_fifty_seeds_on_a_real_duel() {
    assert_eq!(check_duel_stake(100, DUEL, 20), Ok(format!("duel:{DUEL}")));
    assert!(check_duel_stake(100, DUEL, 1).is_ok());
    assert!(check_duel_stake(100, DUEL, 50).is_ok());
    for seeds in [0, -3, 51, 5000] {
      assert!(check_duel_stake(100, DUEL, seeds).is_err(), "{seeds}");
    }
    assert_eq!(check_duel_stake(15, DUEL, 20), Err(ShopError::CannotAfford { short: 5 }.to_string()));
    for id in ["", "duel", "0123456789ABCDEF01234567", "0123456789abcdef0123456", "0123456789abcdef012345678", "0123456789abcdef0123456g"] {
      assert!(check_duel_stake(100, id, 20).is_err(), "{id}");
    }
  }

  #[test]
  fn a_duel_won_pays_twice_a_tie_gives_the_stake_back_a_loss_nothing() {
    assert_eq!(duel_prize(20, "won"), Ok(40));
    assert_eq!(duel_prize(20, "tied"), Ok(20));
    assert_eq!(duel_prize(20, "lost"), Ok(0));
    assert!(duel_prize(20, "abandoned").is_err());

    let staked = duel_stake_record("buy-1", DUEL, 20);
    assert_eq!(duel_prizes(std::slice::from_ref(&staked)), 0, "not settled, or lost");
    assert_eq!(duel_prizes(&[staked.clone(), prize("buy-2", DUEL, 40)]), 40);
    assert_eq!(duel_prizes(&[staked.clone(), prize("buy-2", DUEL, 20)]), 20);
    assert_eq!(duel_stake(std::slice::from_ref(&staked), DUEL), Some(20));
    assert_eq!(duel_stake(std::slice::from_ref(&staked), OTHER), None);
    assert!(duel_settled(&[staked.clone(), prize("buy-2", DUEL, 40)], DUEL));
    assert!(!duel_settled(&[staked], DUEL));
  }

  #[test]
  fn a_prize_is_income_and_never_spending() {
    let catalogue = catalogue();
    let records = [duel_stake_record("buy-1", DUEL, 20), prize("buy-2", DUEL, 40)];
    assert_eq!(spent(&catalogue, &records), 20, "the stake, and not the prize");
    // The stake recorded on two devices is one stake.
    let twice = [duel_stake_record("buy-1", DUEL, 20), duel_stake_record("buy-9", DUEL, 20)];
    assert_eq!(spent(&catalogue, &twice), 20);
  }

  #[test]
  fn a_duel_pays_one_prize_and_never_more_than_twice_its_stake() {
    let staked = duel_stake_record("buy-1", DUEL, 20);
    // Settled on two devices before they synced.
    assert_eq!(duel_prizes(&[staked.clone(), prize("buy-2", DUEL, 40), prize("buy-3", DUEL, 40)]), 40);
    // A prize written by hand: capped at what the bet could have won.
    assert_eq!(duel_prizes(&[staked.clone(), prize("buy-2", DUEL, 100_000)]), 40);
    assert_eq!(duel_prizes(&[staked, prize("buy-2", DUEL, -40)]), 0);
    // No stake beside it, or a stake no duel takes: nothing.
    assert_eq!(duel_prizes(&[prize("buy-2", DUEL, 40)]), 0);
    assert_eq!(duel_prizes(&[duel_stake_record("buy-1", DUEL, 5000), prize("buy-2", DUEL, 10_000)]), 0);
    assert_eq!(duel_prizes(&[duel_stake_record("buy-1", OTHER, 20), prize("buy-2", DUEL, 40)]), 0, "another duel's stake");
    // Each duel has its own.
    let two = [
      duel_stake_record("buy-1", DUEL, 20),
      duel_stake_record("buy-2", OTHER, 50),
      prize("buy-3", DUEL, 40),
      prize("buy-4", OTHER, 50)
    ];
    assert_eq!(duel_prizes(&two), 90);
  }

  #[test]
  fn stakes_and_prizes_are_never_owned_things() {
    let catalogue = catalogue();
    let records = [staked("buy-1", 20, 3, MONDAY), duel_stake_record("buy-2", DUEL, 20), prize("buy-3", DUEL, 40)];
    assert_eq!(owned(&catalogue, &records), owned(&catalogue, &[]));
  }
}
