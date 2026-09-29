//! Seeds: the currency Pip's shop takes, grown in Pip's garden by reading.
//!
//! Pure, like the streak engine next door. There is no balance column
//! anywhere: everything is recomputed from records every time it is asked for.
//!
//! * Reading in a focus session is **water** (one per minute, half as much
//!   again for a session completed without leaving the book). Water flows to
//!   the plants growing in the garden, oldest planting first; water with
//!   nothing to grow waits in the rain barrel, up to a cap.
//! * A plant **ripens** once it has had its minutes of water since it was
//!   planted, and a ripe plant is **harvested** for seeds. A harvest counts only
//!   if this same computation shows the plant ripe, so it cannot be faked by
//!   writing a record.
//! * Days the goal was met add a small bonus, more on a streak.
//! * Everyone starts with a welcome gift.
//! * Pip gives a few back for first steps, the starter chest, finished sets
//!   and a granted wish (`pip::rewards`, worked out from the same records).
//!
//! Seeds earned before the garden existed (`GARDEN_SINCE`) were paid straight
//! from minutes; they are kept, as if already harvested.
//!
//! A session's minutes count only up to the reading the heartbeat recorded that
//! day. The heartbeat is the app's only source of reading time (a timer running
//! while nobody reads earns nothing towards the goal), and the same rule keeps
//! a timer left running from watering anything.
//!
//! Nothing withers: a plant waits, unwatered, for the next chapter, and water
//! read on another device reaches the garden when it syncs.

use super::DayRecord;
use chrono::NaiveDate;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

/// The first local day of the garden. Reading before it was paid in seeds
/// directly (the legacy rules below); reading from it on waters plants.
pub const GARDEN_SINCE: &str = "2026-09-27";

pub const WELCOME_GIFT: i64 = 50;
/// Goal-day bonuses, kept small: the garden is the main income.
pub const GOAL_DAY_BONUS: i64 = 4;
pub const STREAK_BONUS_PER_DAY: i64 = 1;
pub const STREAK_BONUS_CAP: i64 = 6;
/// Water a completed, clean session adds on top of its minutes, as a fraction.
pub const CLEAN_WATER_BONUS: f64 = 0.5;
/// The rain barrel: water read while nothing grows, waiting for a planting.
pub const BARREL_CAP: f64 = 120.0;
/// The heartbeat flushes about once a minute, so the last minute of a session
/// can still be in flight when the session is recorded. This much of a day's
/// session time may run ahead of its ledger minutes.
pub const LEDGER_SLACK_MINUTES: f64 = 1.0;

// The rules before the garden, for what was earned under them.
const LEGACY_GOAL_DAY_BONUS: i64 = 25;
const LEGACY_STREAK_PER_DAY: i64 = 2;
const LEGACY_STREAK_CAP: i64 = 40;

/// What seeds need to know about one session on the shelf.
#[derive(Debug, Clone)]
pub struct SessionSeeds<'a> {
  pub id: &'a str,
  pub ended_at: &'a str,
  /// `ended_at` as milliseconds, for ordering water against plantings.
  pub ended_at_ms: i64,
  pub date_key: &'a str,
  pub minutes: f64,
  /// Ran to its planned end (`completed`) without leaving the book (`clean`).
  pub completed_clean: bool
}

/// Where a reader's seeds came from. `total` is the sum of the rest.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedEarnings {
  /// Harvested from the garden.
  pub harvests: i64,
  /// Goal bonuses, one per day the goal was met by reading.
  pub goal_days: i64,
  /// Streak bonuses on those days.
  pub streak_bonus: i64,
  pub welcome: i64,
  /// Everything earned before the garden, when minutes paid seeds directly.
  pub earlier: i64,
  /// Pip's rewards (`pip::rewards`): a new reader's first steps...
  pub goals: i64,
  /// ...the starter chest, opened by the first focus session...
  pub chest: i64,
  /// ...sets finished...
  pub sets: i64,
  /// ...and daily wishes granted.
  pub wishes: i64,
  pub total: i64
}

impl SeedEarnings {
  /// Adds Pip's rewards to what the reading earned, and totals it all again.
  pub fn with_rewards(mut self, goals: i64, chest: i64, sets: i64, wishes: i64) -> Self {
    self.goals = goals.max(0);
    self.chest = chest.max(0);
    self.sets = sets.max(0);
    self.wishes = wishes.max(0);
    self.total = self.harvests
      + self.goal_days
      + self.streak_bonus
      + self.welcome
      + self.earlier
      + self.goals
      + self.chest
      + self.sets
      + self.wishes;
    self
  }
}

fn parse_day(key: &str) -> Option<NaiveDate> {
  NaiveDate::parse_from_str(key, "%Y-%m-%d").ok()
}

fn in_garden_era(date_key: &str) -> bool {
  date_key >= GARDEN_SINCE
}

/// The streak bonus for a goal day that is day `streak` of a streak.
pub fn streak_bonus_for(streak: i64) -> i64 {
  (streak * STREAK_BONUS_PER_DAY).clamp(0, STREAK_BONUS_CAP)
}

/// Each session's countable minutes: its own, capped by what the heartbeat
/// recorded on its day (shared, in the order the sessions ended).
fn counted_minutes<'a>(days: &HashMap<String, DayRecord>, sessions: &'a [SessionSeeds<'a>]) -> Vec<(&'a SessionSeeds<'a>, f64)> {
  let mut ordered: Vec<&SessionSeeds<'_>> = sessions.iter().collect();
  ordered.sort_by(|a, b| a.ended_at.cmp(b.ended_at).then_with(|| a.id.cmp(b.id)));
  let mut allowance: HashMap<&str, f64> = HashMap::new();
  let mut out = Vec::with_capacity(ordered.len());
  for session in ordered {
    let left = allowance.entry(session.date_key).or_insert_with(|| {
      let read = days.get(session.date_key).map(|day| day.minutes).unwrap_or(0.0);
      if read > 0.0 {
        read + LEDGER_SLACK_MINUTES
      } else {
        0.0
      }
    });
    let counted = session.minutes.max(0.0).min(*left);
    *left -= counted;
    out.push((session, counted));
  }
  out
}

/// The most minutes any one focus session counted: its own, up to what the
/// heartbeat recorded that day, as for water. The starter chest opens on it.
pub fn longest_focus(days: &HashMap<String, DayRecord>, sessions: &[SessionSeeds<'_>]) -> f64 {
  counted_minutes(days, sessions)
    .into_iter()
    .map(|(_, counted)| counted)
    .fold(0.0, f64::max)
}

/// The water each session poured, in the order it poured: `(ended_at_ms, water)`.
/// Sessions from before the garden paid seeds instead and pour nothing.
pub fn water_drops(days: &HashMap<String, DayRecord>, sessions: &[SessionSeeds<'_>]) -> Vec<(i64, f64)> {
  let mut drops: Vec<(i64, f64)> = counted_minutes(days, sessions)
    .into_iter()
    .filter(|(session, counted)| in_garden_era(session.date_key) && *counted > 0.0)
    .map(|(session, counted)| {
      let whole = counted.floor();
      let bonus = if session.completed_clean { (whole * CLEAN_WATER_BONUS).floor() } else { 0.0 };
      (session.ended_at_ms, whole + bonus)
    })
    .filter(|(_, water)| *water > 0.0)
    .collect();
  drops.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)));
  drops
}

/// Everything a reader has earned: the ledger's bonuses, the harvests (from
/// `grow`), the welcome gift, and what the old rules paid before the garden.
pub fn earnings(days: &HashMap<String, DayRecord>, sessions: &[SessionSeeds<'_>], harvests: i64) -> SeedEarnings {
  let mut result = SeedEarnings {
    welcome: WELCOME_GIFT,
    harvests: harvests.max(0),
    ..SeedEarnings::default()
  };

  // Before the garden: a seed a minute, half again for a clean finish.
  for (session, counted) in counted_minutes(days, sessions) {
    if in_garden_era(session.date_key) {
      continue;
    }
    let whole = counted.floor() as i64;
    result.earlier += whole + if session.completed_clean { whole / 2 } else { 0 };
  }

  // Goal days, walked in date order so each knows how long its streak was.
  // A day covered by a freeze or grace keeps a streak going (as it does for
  // the streak itself) but earns nothing: no reading, no seeds.
  let mut dated: Vec<(NaiveDate, &DayRecord)> = days
    .values()
    .filter_map(|day| parse_day(&day.date_key).map(|date| (date, day)))
    .collect();
  dated.sort_by_key(|(date, _)| *date);
  let mut run = 0i64;
  let mut previous: Option<NaiveDate> = None;
  for (date, day) in dated {
    if day.counts() {
      let continues = previous.map(|prev| prev.succ_opt() == Some(date)).unwrap_or(false);
      run = if continues { run + 1 } else { 1 };
      previous = Some(date);
    } else {
      run = 0;
      previous = None;
    }
    if !day.goal_met() {
      continue;
    }
    if in_garden_era(&day.date_key) {
      result.goal_days += GOAL_DAY_BONUS;
      result.streak_bonus += streak_bonus_for(run);
    } else {
      result.earlier += LEGACY_GOAL_DAY_BONUS + (run * LEGACY_STREAK_PER_DAY).clamp(0, LEGACY_STREAK_CAP);
    }
  }

  result.total = result.harvests + result.goal_days + result.streak_bonus + result.welcome + result.earlier;
  result
}

// ---- the garden ---------------------------------------------------------------

/// A planting, with what its plant needs and gives (from the catalogue).
#[derive(Debug, Clone)]
pub struct PlantingIn<'a> {
  pub id: &'a str,
  pub plot: i64,
  pub plant: &'a str,
  pub planted_at_ms: i64,
  /// Water (minutes) to ripen.
  pub need: f64,
  /// Seeds a harvest gives.
  pub yield_seeds: i64
}

/// A harvest record: which planting, and when.
#[derive(Debug, Clone)]
pub struct HarvestIn<'a> {
  pub id: &'a str,
  pub planting_id: &'a str,
  /// What the record says it paid; never more than the plant's yield counts.
  pub seeds: i64
}

/// One planting as it stands now.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlantState {
  pub id: String,
  pub plot: i64,
  pub plant: String,
  pub water: f64,
  pub need: f64,
  pub ripe: bool,
  pub harvested: bool,
  /// Seeds this planting paid (0 until harvested).
  pub seeds: i64
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Garden {
  /// Plantings still in the ground (growing or ripe), and the harvested ones.
  pub plants: Vec<PlantState>,
  /// Water waiting in the rain barrel.
  pub barrel: f64,
  /// All the water reading has poured since the garden began.
  pub water: f64,
  /// Seeds from valid harvests.
  pub harvested: i64
}

impl Garden {
  /// Plantings ripe and waiting to be picked.
  pub fn ripe_count(&self) -> i64 {
    self.plants.iter().filter(|plant| plant.ripe && !plant.harvested).count() as i64
  }

  /// Whether a plot has something in it (growing or ripe, not yet harvested).
  pub fn occupied(&self, plot: i64) -> bool {
    self.plants.iter().any(|plant| plant.plot == plot && !plant.harvested)
  }
}

/// Grows the garden from the water poured and the plantings made.
///
/// Water and plantings are replayed in time order. Each drop fills the oldest
/// planting still growing, spilling into the next; with nothing growing it
/// fills the barrel (overflow is lost, like rain). A new planting drinks from
/// the barrel first. A ripe plant takes no more water. The result depends only
/// on the records, so every device agrees.
///
/// A harvest, once recorded, is final. Rust records one only after seeing the
/// plant ripe, but a sync can bring in an older planting from another device
/// that drinks first, leaving a harvested plant "unripe" on replay; its seeds,
/// perhaps already spent, used to vanish from the balance.
pub fn grow(drops: &[(i64, f64)], plantings: &[PlantingIn<'_>], harvests: &[HarvestIn<'_>]) -> Garden {
  let mut order: Vec<&PlantingIn<'_>> = plantings.iter().collect();
  order.sort_by(|a, b| a.planted_at_ms.cmp(&b.planted_at_ms).then_with(|| a.id.cmp(b.id)));

  let mut water_in: Vec<f64> = vec![0.0; order.len()];
  let mut barrel = 0.0f64;
  let mut poured = 0.0f64;
  let mut next_planting = 0usize;
  let mut growing: Vec<usize> = Vec::new();

  let pour = |amount: f64, growing: &mut Vec<usize>, water_in: &mut Vec<f64>, barrel: &mut f64| {
    let mut left = amount;
    while left > 0.0 {
      let Some(&index) = growing.first() else { break };
      let room = (order[index].need - water_in[index]).max(0.0);
      let given = left.min(room);
      water_in[index] += given;
      left -= given;
      if water_in[index] >= order[index].need {
        growing.remove(0);
      }
    }
    *barrel = (*barrel + left).min(BARREL_CAP);
  };

  let mut drop_index = 0usize;
  loop {
    let plant_at = order.get(next_planting).map(|planting| planting.planted_at_ms);
    let drop = drops.get(drop_index);
    // A planting made at the same moment as a session's end gets its water.
    let plant_first = match (plant_at, drop) {
      (None, None) => break,
      (Some(_), None) => true,
      (None, Some(_)) => false,
      (Some(at), Some(&(drop_at, _))) => at <= drop_at
    };
    if plant_first {
      growing.push(next_planting);
      next_planting += 1;
      let from_barrel = barrel;
      barrel = 0.0;
      pour(from_barrel, &mut growing, &mut water_in, &mut barrel);
    } else if let Some(&(_, amount)) = drop {
      poured += amount;
      pour(amount, &mut growing, &mut water_in, &mut barrel);
      drop_index += 1;
    }
  }

  // Harvests: one per planting (the first by id), and only of a ripe plant.
  let mut by_planting: HashMap<&str, &HarvestIn<'_>> = HashMap::new();
  let mut sorted: Vec<&HarvestIn<'_>> = harvests.iter().collect();
  sorted.sort_by(|a, b| a.id.cmp(b.id));
  for harvest in sorted {
    by_planting.entry(harvest.planting_id).or_insert(harvest);
  }

  let mut seen_ids = HashSet::new();
  let mut plants = Vec::with_capacity(order.len());
  let mut harvested_total = 0i64;
  for (index, planting) in order.iter().enumerate() {
    if !seen_ids.insert(planting.id) {
      continue;
    }
    let harvest = by_planting.get(planting.id);
    let ripe = water_in[index] >= planting.need || harvest.is_some();
    let seeds = harvest.map(|h| h.seeds.clamp(0, planting.yield_seeds)).unwrap_or(0);
    harvested_total += seeds;
    plants.push(PlantState {
      id: planting.id.to_string(),
      plot: planting.plot,
      plant: planting.plant.to_string(),
      water: water_in[index],
      need: planting.need,
      ripe,
      harvested: harvest.is_some(),
      seeds
    });
  }

  Garden { plants, barrel, water: poured, harvested: harvested_total }
}

// ---- mood -------------------------------------------------------------------

/// Pip's mood runs 0..100 and starts here.
pub const MOOD_START: f64 = 70.0;
/// How much it drifts down per day nobody visits. Slow: a weekend away takes
/// Pip from content to wistful, not to miserable.
pub const MOOD_DRIFT_PER_DAY: f64 = 8.0;
/// What a recorded reading session adds.
pub const MOOD_PER_SESSION: f64 = 5.0;

/// The mood now, given the last stored value and when it was stored.
///
/// Drift only ever lowers it and never below zero; a clock that went
/// backwards (another device's timestamp, a changed system clock) is treated
/// as no time passing.
pub fn mood_at(stored: f64, stored_at_ms: i64, now_ms: i64) -> f64 {
  let days = (now_ms - stored_at_ms).max(0) as f64 / 86_400_000.0;
  (stored - days * MOOD_DRIFT_PER_DAY).clamp(0.0, 100.0)
}

/// The mood after something cheered Pip up, from the mood now.
pub fn mood_plus(now: f64, gain: f64) -> f64 {
  (now + gain.max(0.0)).clamp(0.0, 100.0)
}

#[cfg(test)]
mod tests {
  use super::*;

  const DAY_MS: i64 = 86_400_000;

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
    entries.into_iter().map(|d| (d.date_key.clone(), d)).collect()
  }

  fn session<'a>(id: &'a str, date_key: &'a str, at_ms: i64, minutes: f64, completed_clean: bool) -> SessionSeeds<'a> {
    SessionSeeds {
      id,
      ended_at: date_key,
      ended_at_ms: at_ms,
      date_key,
      minutes,
      completed_clean
    }
  }

  fn planting<'a>(id: &'a str, plot: i64, at_ms: i64, need: f64, yield_seeds: i64) -> PlantingIn<'a> {
    PlantingIn { id, plot, plant: "sunflower", planted_at_ms: at_ms, need, yield_seeds }
  }

  // ---- earnings ------------------------------------------------------------

  #[test]
  fn a_new_reader_has_the_welcome_gift() {
    let result = earnings(&HashMap::new(), &[], 0);
    assert_eq!(result.total, WELCOME_GIFT);
  }

  #[test]
  fn minutes_no_longer_pay_seeds_directly() {
    let days = ledger(vec![day("2026-10-01", 30.0, 60)]);
    let result = earnings(&days, &[session("a", "2026-10-01", 0, 25.0, true)], 0);
    assert_eq!(result.total, WELCOME_GIFT, "reading waters the garden; seeds come from harvests");
  }

  #[test]
  fn seeds_earned_before_the_garden_are_kept() {
    let days = ledger(vec![day("2026-09-20", 30.0, 60)]);
    let result = earnings(&days, &[session("a", "2026-09-20", 0, 25.0, true)], 0);
    assert_eq!(result.earlier, 37, "25 a minute plus half again, as the old rules paid");
  }

  #[test]
  fn goal_days_earn_a_small_bonus_growing_with_the_streak() {
    let days = ledger(vec![
      day("2026-10-01", 20.0, 20),
      day("2026-10-02", 25.0, 20),
      day("2026-10-03", 30.0, 20)
    ]);
    let result = earnings(&days, &[], 0);
    assert_eq!(result.goal_days, 3 * GOAL_DAY_BONUS);
    assert_eq!(result.streak_bonus, 1 + 2 + 3);
    assert_eq!(streak_bonus_for(100), STREAK_BONUS_CAP);
  }

  #[test]
  fn a_frozen_day_carries_the_streak_but_earns_nothing() {
    let mut frozen = day("2026-10-02", 0.0, 20);
    frozen.freeze_used = true;
    let days = ledger(vec![day("2026-10-01", 20.0, 20), frozen, day("2026-10-03", 20.0, 20)]);
    let result = earnings(&days, &[], 0);
    assert_eq!(result.goal_days, 2 * GOAL_DAY_BONUS);
    assert_eq!(result.streak_bonus, 1 + 3);
  }

  #[test]
  fn harvests_are_part_of_the_total() {
    assert_eq!(earnings(&HashMap::new(), &[], 20).total, WELCOME_GIFT + 20);
  }

  #[test]
  fn pips_rewards_join_the_total() {
    let result = earnings(&HashMap::new(), &[], 4).with_rewards(10, 30, 0, 8);
    assert_eq!((result.goals, result.chest, result.sets, result.wishes), (10, 30, 0, 8));
    assert_eq!(result.total, WELCOME_GIFT + 4 + 10 + 30 + 8);
  }

  #[test]
  fn the_longest_session_counts_only_what_was_read() {
    let days = ledger(vec![day("2026-10-01", 8.0, 20)]);
    let sessions = [session("a", "2026-10-01", 5, 30.0, true), session("b", "2026-10-02", 9, 6.0, false)];
    // Thirty minutes on the timer, eight read (and the minute of flush slack);
    // nothing on the ledger the next day.
    assert_eq!(longest_focus(&days, &sessions), 9.0);
    assert_eq!(longest_focus(&HashMap::new(), &[]), 0.0);
  }

  // ---- water ---------------------------------------------------------------

  #[test]
  fn a_clean_session_waters_half_again() {
    let days = ledger(vec![day("2026-10-01", 40.0, 60)]);
    let drops = water_drops(&days, &[session("a", "2026-10-01", 5, 20.0, true), session("b", "2026-10-01", 9, 10.0, false)]);
    assert_eq!(drops, vec![(5, 30.0), (9, 10.0)]);
  }

  #[test]
  fn a_timer_nobody_read_through_waters_nothing() {
    let days = ledger(vec![day("2026-10-01", 10.0, 60)]);
    let drops = water_drops(&days, &[session("a", "2026-10-01", 5, 45.0, false)]);
    assert_eq!(drops, vec![(5, 11.0)], "10 read, plus the minute of flush slack");
    assert!(water_drops(&HashMap::new(), &[session("b", "2026-10-02", 5, 30.0, false)]).is_empty());
  }

  #[test]
  fn reading_before_the_garden_waters_nothing() {
    let days = ledger(vec![day("2026-09-20", 30.0, 60)]);
    assert!(water_drops(&days, &[session("a", "2026-09-20", 5, 25.0, false)]).is_empty());
  }

  // ---- growing --------------------------------------------------------------

  #[test]
  fn a_plant_ripens_on_its_minutes_of_water() {
    let plants = [planting("p", 1, 0, 60.0, 20)];
    let garden = grow(&[(10, 30.0)], &plants, &[]);
    assert!(!garden.plants[0].ripe);
    assert_eq!(garden.plants[0].water, 30.0);
    let garden = grow(&[(10, 30.0), (20, 30.0)], &plants, &[]);
    assert!(garden.plants[0].ripe);
    assert_eq!(garden.ripe_count(), 1);
  }

  #[test]
  fn water_flows_oldest_planting_first_and_spills_over() {
    let plants = [planting("a", 1, 0, 15.0, 4), planting("b", 2, 1, 60.0, 20)];
    let garden = grow(&[(10, 40.0)], &plants, &[]);
    assert!(garden.plants[0].ripe);
    assert_eq!(garden.plants[1].water, 25.0);
  }

  #[test]
  fn water_before_a_planting_waits_in_the_barrel_up_to_its_cap() {
    let plants = [planting("a", 1, 100, 60.0, 20)];
    let garden = grow(&[(10, 40.0)], &plants, &[]);
    assert_eq!(garden.plants[0].water, 40.0, "the barrel pours into the new planting");
    let flood = grow(&[(10, 500.0)], &[planting("b", 1, 100, 600.0, 260)], &[]);
    assert_eq!(flood.plants[0].water, BARREL_CAP, "overflow is lost like rain");
    let idle = grow(&[(10, 30.0)], &[], &[]);
    assert_eq!(idle.barrel, 30.0);
    assert_eq!(idle.water, 30.0);
  }

  #[test]
  fn a_harvest_counts_once_and_stays_counted() {
    let plants = [planting("p", 1, 0, 60.0, 20)];
    let harvests = [
      HarvestIn { id: "h1", planting_id: "p", seeds: 20 },
      HarvestIn { id: "h2", planting_id: "p", seeds: 20 }
    ];
    // Another device's older planting arrives in a sync and drinks first: the
    // harvest already made stands.
    let synced = [planting("older", 2, -50, 60.0, 20), planting("p", 1, 0, 60.0, 20)];
    let after_sync = grow(&[(10, 60.0)], &synced, &harvests);
    assert_eq!(after_sync.harvested, 20, "a recorded harvest is not taken back by a sync");
    let ripe = grow(&[(10, 60.0)], &plants, &harvests);
    assert_eq!(ripe.harvested, 20, "once, however many records");
    assert!(ripe.plants[0].harvested);
    assert!(!ripe.occupied(1), "a harvested plot is free again");
    let greedy = grow(&[(10, 60.0)], &plants, &[HarvestIn { id: "h", planting_id: "p", seeds: 9999 }]);
    assert_eq!(greedy.harvested, 20, "never more than the plant gives");
  }

  #[test]
  fn more_reading_only_brings_plants_closer() {
    let plants = [planting("a", 1, 0, 30.0, 9), planting("b", 2, 0, 60.0, 20)];
    let before = grow(&[(10, 20.0)], &plants, &[]);
    let after = grow(&[(5, 15.0), (10, 20.0)], &plants, &[]);
    for (x, y) in before.plants.iter().zip(after.plants.iter()) {
      assert!(y.water >= x.water);
    }
  }

  #[test]
  fn a_typical_week() {
    // 20 minutes a day, finished cleanly: 30 water a day. A pumpkin (180)
    // ripens in six days.
    let drops: Vec<(i64, f64)> = (1..=7).map(|d| (d * DAY_MS, 30.0)).collect();
    let garden = grow(&drops, &[planting("p", 1, 0, 180.0, 70)], &[]);
    assert!(garden.plants[0].ripe);
    assert_eq!(garden.barrel, 30.0, "the seventh day waits in the barrel");
  }

  // ---- mood -----------------------------------------------------------------

  #[test]
  fn mood_drifts_down_about_eight_a_day_and_stops_at_zero() {
    assert_eq!(mood_at(70.0, 0, 0), 70.0);
    assert!((mood_at(70.0, 0, DAY_MS) - 62.0).abs() < 1e-9);
    assert_eq!(mood_at(70.0, 0, 30 * DAY_MS), 0.0);
    assert_eq!(mood_at(70.0, DAY_MS, 0), 70.0);
  }

  #[test]
  fn cheering_up_is_capped_at_a_hundred() {
    assert_eq!(mood_plus(95.0, 20.0), 100.0);
    assert_eq!(mood_plus(40.0, -10.0), 40.0);
  }
}
