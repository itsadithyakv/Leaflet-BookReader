//! The reader's level.
//!
//! Worked out from every seed ever earned (`habit::seeds::SeedEarnings::total`),
//! never from the balance: a reader who spends everything and one who hoards
//! are on the same level for the same reading. Like the balance it is not
//! stored anywhere; it is a pure function of a number that is itself replayed
//! from the records, so two devices holding the same records agree on it.

use serde::Serialize;

/// Each level asks for this many seeds more than the one before it did:
/// 100 to reach level 2, 200 more for level 3, 300 more for level 4.
pub const SEEDS_PER_STEP: i64 = 100;
/// Where the count stops. Nobody reads their way here (it is fifty million
/// seeds); it only bounds the walk for a number that is not a real total.
pub const MAX_LEVEL: i64 = 1000;

/// Where a reader stands: the level, and the seeds either side of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelView {
  pub level: i64,
  /// Seeds ever earned.
  pub earned: i64,
  /// Seeds at which this level began.
  pub floor: i64,
  /// Seeds at which the next begins.
  pub next: i64
}

/// Seeds ever earned that reach level `level`: 0, 100, 300, 600, 1000...
pub fn seeds_for(level: i64) -> i64 {
  let level = level.clamp(1, MAX_LEVEL + 1);
  SEEDS_PER_STEP / 2 * (level - 1) * level
}

/// The level a reader with `earned` seeds to their name is on. Everyone
/// starts on level 1.
pub fn level_for(earned: i64) -> LevelView {
  let earned = earned.max(0);
  let mut level = 1;
  while level < MAX_LEVEL && seeds_for(level + 1) <= earned {
    level += 1;
  }
  LevelView { level, earned, floor: seeds_for(level), next: seeds_for(level + 1) }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn each_level_asks_for_a_hundred_seeds_more_than_the_last() {
    let needed: Vec<i64> = (1..=5).map(seeds_for).collect();
    assert_eq!(needed, vec![0, 100, 300, 600, 1000]);
    assert_eq!(seeds_for(10), 4500);
  }

  #[test]
  fn a_new_reader_is_on_level_one() {
    assert_eq!(level_for(0), LevelView { level: 1, earned: 0, floor: 0, next: 100 });
    // The welcome gift alone is not a level.
    assert_eq!(level_for(50).level, 1);
    assert_eq!(level_for(99).level, 1);
  }

  #[test]
  fn a_level_begins_on_the_seed_that_reaches_it() {
    assert_eq!(level_for(100), LevelView { level: 2, earned: 100, floor: 100, next: 300 });
    assert_eq!(level_for(299).level, 2);
    assert_eq!(level_for(300).level, 3);
    assert_eq!(level_for(999).level, 4);
    assert_eq!(level_for(1000).level, 5);
    assert_eq!(level_for(4500), LevelView { level: 10, earned: 4500, floor: 4500, next: 5500 });
  }

  #[test]
  fn the_level_only_goes_up_as_seeds_are_earned() {
    let mut last = 0;
    for earned in (0..20_000).step_by(37) {
      let view = level_for(earned);
      assert!(view.level >= last, "{earned}");
      assert!(view.floor <= earned && earned < view.next, "{earned} is between {} and {}", view.floor, view.next);
      last = view.level;
    }
  }

  #[test]
  fn a_total_that_is_not_one_is_still_a_level() {
    assert_eq!(level_for(-40), LevelView { level: 1, earned: 0, floor: 0, next: 100 });
    let top = level_for(i64::MAX);
    assert_eq!(top.level, MAX_LEVEL);
    assert!(top.floor < top.next);
  }

  #[test]
  fn the_view_is_told_in_camel_case() {
    let json = serde_json::to_string(&level_for(120)).expect("encodes");
    assert_eq!(json, r#"{"level":2,"earned":120,"floor":100,"next":300}"#);
  }
}
