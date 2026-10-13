//! What is in Pip's fridge.
//!
//! Until 2026-10-13 the fridge in her bedroom was for show: a door to open,
//! a light to stare into, and nothing behind either. The owner asked for it
//! to mean something ("make Pip sad by not having food in the fridge if you
//! don't buy"), so now it does, a little: a snack bought stocks it for a
//! while, and a Pip who goes to look and finds it bare is a little sadder
//! for it.
//!
//! The stock is not a number kept anywhere. It is worked out from the
//! purchase ledger, which is already there and already syncs: each snack on
//! record keeps the fridge stocked for `HOURS_PER_SNACK` from when it was
//! bought (or from when the food before it runs out, if that is later), and
//! there is never more than `MAX_HOURS` in hand. Nothing is eaten out of it
//! (her midnight nibble takes nothing): it runs out by the clock alone, so
//! every device replaying the same records has the same fridge.
//!
//! The mood side is kept gentle on purpose, because Pip must never be a
//! chore, nor a debt that grows while the app is shut:
//!
//! - nothing is worked out for time away: the fridge being bare costs
//!   nothing by itself. Only her *finding* it bare does, and she can only do
//!   that while the Pip tab is open and she is up and at home to look;
//! - it takes `BARE_MOOD` once a local day at most (`minds`), however often
//!   she looks;
//! - it never takes the mood below the floor that being away already stops
//!   at (`habit::seeds::mood_minus`), and a mood already there is left alone;
//! - one snack mends it, and cheers her up as a snack always has.

use super::{Catalogue, Purchase};
use serde::{Deserialize, Serialize};

/// How long one snack keeps the fridge stocked, in hours.
pub const HOURS_PER_SNACK: i64 = 24;
/// The most food the fridge ever has in hand, in hours: buying ten snacks in
/// an afternoon stocks it for three days, not ten.
pub const MAX_HOURS: i64 = 72;
/// What finding the fridge bare takes off Pip's mood: a game's worth, less
/// than a focus session adds back.
pub const BARE_MOOD: f64 = 3.0;
/// The cause in the mood log (`pip::MoodEvent`).
pub const CAUSE_BARE: &str = "fridge";

const HOUR_MS: i64 = 3_600_000;

fn stamp_ms(value: &str) -> Option<i64> {
  chrono::DateTime::parse_from_rfc3339(value).ok().map(|at| at.timestamp_millis())
}

/// Whether a record is a snack: food from the treats, bought each time it is
/// given. A toy is a treat too, but it is kept, and stocks nothing.
fn is_snack(catalogue: &Catalogue, purchase: &Purchase) -> bool {
  purchase.item_kind == "treat"
    && catalogue
      .get(&purchase.item_kind, &purchase.item_id)
      .map(|item| item.consumable)
      .unwrap_or(false)
}

/// When the fridge runs out, in milliseconds, from the snacks on record; none
/// if no snack was ever bought. Each snack adds `HOURS_PER_SNACK` to whatever
/// is still in hand when it is bought, and the fridge never holds more than
/// `MAX_HOURS` from that moment. A record whose time will not read stocks
/// nothing.
pub fn stocked_until(catalogue: &Catalogue, purchases: &[Purchase]) -> Option<i64> {
  // In the order they were bought, by the clock (two devices stamp their
  // records in their own time zones, which do not sort as text), then by
  // id: whatever order the records arrive in, the answer is the same.
  let mut snacks: Vec<(i64, &str)> = purchases
    .iter()
    .filter(|purchase| is_snack(catalogue, purchase))
    .filter_map(|purchase| stamp_ms(&purchase.bought_at).map(|at| (at, purchase.id.as_str())))
    .collect();
  snacks.sort_unstable();
  let mut until: Option<i64> = None;
  for (at, _) in snacks {
    let from = until.map_or(at, |until| until.max(at));
    until = Some((from + HOURS_PER_SNACK * HOUR_MS).min(at + MAX_HOURS * HOUR_MS));
  }
  until
}

/// Whether there is food in the fridge at `now_ms`.
pub fn stocked(until: Option<i64>, now_ms: i64) -> bool {
  until.is_some_and(|until| now_ms < until)
}

/// The day finding the fridge bare last took its toll, on this device (a
/// settings row, like the arcade's allowance: it bounds a rule, it is not
/// the reader's data, and it is not in the sync document or the backup).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BareFridge {
  /// The reader's local day ("2026-10-13"), or empty for never.
  #[serde(default)]
  pub day: String
}

/// Whether finding the fridge bare on `today` still costs her anything: not
/// if it already has today.
pub fn minds(seen: &BareFridge, today: &str) -> bool {
  seen.day != today
}

/// The fridge as the Pip tab is told of it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FridgeView {
  /// When the food runs out (RFC 3339, UTC); none if it is bare now. The
  /// webview compares it with its own clock, so a fridge that empties while
  /// the tab is open is seen to.
  pub stocked_until: Option<String>,
  /// Whether finding it bare has already taken its toll today, on this device.
  pub minded_today: bool,
  /// The rules, for the tab to put into words.
  pub hours_per_snack: i64,
  pub max_hours: i64
}

/// The view at `now_ms`, on the reader's local day `today`.
pub fn view(catalogue: &Catalogue, purchases: &[Purchase], seen: &BareFridge, today: &str, now_ms: i64) -> FridgeView {
  let until = stocked_until(catalogue, purchases).filter(|until| now_ms < *until);
  FridgeView {
    stocked_until: until
      .and_then(chrono::DateTime::<chrono::Utc>::from_timestamp_millis)
      .map(|at| at.to_rfc3339()),
    minded_today: !minds(seen, today),
    hours_per_snack: HOURS_PER_SNACK,
    max_hours: MAX_HOURS
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn catalogue() -> Catalogue {
    Catalogue::parse(
      r#"{"items":[
        {"kind":"treat","id":"apple","price":4,"consumable":true,"mood":5},
        {"kind":"treat","id":"ball","price":90,"mood":8},
        {"kind":"plant","id":"radish","price":1,"consumable":true,"water":15,"yield":4},
        {"kind":"room","id":"lamp","price":90}
      ]}"#
    )
    .expect("catalogue")
  }

  fn bought(kind: &str, id: &str, at: &str) -> Purchase {
    Purchase { id: format!("buy-{kind}-{id}-{at}"), item_kind: kind.into(), item_id: id.into(), price: 4, bought_at: at.into() }
  }

  fn ms(at: &str) -> i64 {
    stamp_ms(at).expect("a time")
  }

  #[test]
  fn a_fridge_nobody_has_stocked_is_bare() {
    assert_eq!(stocked_until(&catalogue(), &[]), None);
    assert!(!stocked(None, ms("2026-10-13T12:00:00+00:00")));
  }

  #[test]
  fn a_snack_stocks_it_for_a_day() {
    let until = stocked_until(&catalogue(), &[bought("treat", "apple", "2026-10-13T09:00:00+00:00")]);
    assert_eq!(until, Some(ms("2026-10-14T09:00:00+00:00")));
    assert!(stocked(until, ms("2026-10-13T09:00:00+00:00")));
    assert!(stocked(until, ms("2026-10-14T08:59:59+00:00")));
    // On the stroke it is gone.
    assert!(!stocked(until, ms("2026-10-14T09:00:00+00:00")));
    assert!(!stocked(until, ms("2026-11-01T09:00:00+00:00")));
  }

  #[test]
  fn only_a_snack_stocks_it() {
    let others = [
      bought("treat", "ball", "2026-10-13T09:00:00+00:00"),
      bought("plant", "radish", "2026-10-13T09:00:00+00:00"),
      bought("room", "lamp", "2026-10-13T09:00:00+00:00"),
      // A snack this build's catalogue does not list, and a time that will not read.
      bought("treat", "ambrosia", "2026-10-13T09:00:00+00:00"),
      bought("treat", "apple", "yesterday")
    ];
    assert_eq!(stocked_until(&catalogue(), &others), None);
  }

  #[test]
  fn snacks_add_up_to_three_days_in_hand_and_no_more() {
    let catalogue = catalogue();
    let two = [bought("treat", "apple", "2026-10-13T09:00:00+00:00"), bought("treat", "apple", "2026-10-13T09:05:00+00:00")];
    assert_eq!(stocked_until(&catalogue, &two), Some(ms("2026-10-15T09:00:00+00:00")), "the second day follows the first");
    // Ten in an afternoon: three days from the last of them, not ten.
    let ten: Vec<Purchase> = (0..10).map(|minute| bought("treat", "apple", &format!("2026-10-13T09:{minute:02}:00+00:00"))).collect();
    assert_eq!(stocked_until(&catalogue, &ten), Some(ms("2026-10-16T09:09:00+00:00")));
  }

  #[test]
  fn a_snack_after_it_ran_out_starts_from_when_it_was_bought() {
    let later = [bought("treat", "apple", "2026-10-01T09:00:00+00:00"), bought("treat", "apple", "2026-10-13T20:00:00+00:00")];
    assert_eq!(stocked_until(&catalogue(), &later), Some(ms("2026-10-14T20:00:00+00:00")));
  }

  #[test]
  fn the_order_the_records_arrive_in_does_not_matter() {
    // Two devices' purchases, merged in either order, are the same fridge.
    let catalogue = catalogue();
    let a = bought("treat", "apple", "2026-10-13T09:00:00+00:00");
    let b = bought("treat", "apple", "2026-10-13T21:00:00+02:00");
    let c = bought("treat", "apple", "2026-10-14T07:30:00+00:00");
    let one = stocked_until(&catalogue, &[a.clone(), b.clone(), c.clone()]);
    assert_eq!(one, stocked_until(&catalogue, &[c, a, b]));
    assert_eq!(one, Some(ms("2026-10-16T09:00:00+00:00")));
  }

  #[test]
  fn finding_it_bare_is_minded_once_a_day() {
    let never = BareFridge::default();
    assert!(minds(&never, "2026-10-13"));
    let today = BareFridge { day: "2026-10-13".into() };
    assert!(!minds(&today, "2026-10-13"));
    assert!(minds(&today, "2026-10-14"));
    // A row from before there was one, or one that says nothing, reads as never.
    assert_eq!(serde_json::from_str::<BareFridge>("{}").expect("row"), never);
  }

  #[test]
  fn the_view_says_when_the_food_runs_out_and_nothing_when_it_has() {
    let catalogue = catalogue();
    let snack = [bought("treat", "apple", "2026-10-13T09:00:00+00:00")];
    let seen = BareFridge { day: "2026-10-13".into() };
    let full = view(&catalogue, &snack, &seen, "2026-10-13", ms("2026-10-13T12:00:00+00:00"));
    assert_eq!(full.stocked_until.as_deref(), Some("2026-10-14T09:00:00+00:00"));
    assert!(full.minded_today);
    assert_eq!((full.hours_per_snack, full.max_hours), (HOURS_PER_SNACK, MAX_HOURS));
    let bare = view(&catalogue, &snack, &seen, "2026-10-15", ms("2026-10-15T12:00:00+00:00"));
    assert_eq!(bare.stocked_until, None);
    assert!(!bare.minded_today);
  }

  #[test]
  fn the_numbers_are_gentle() {
    // A day a snack, a few days at most, and less than a focus session gives back.
    // (Held at compile time: they are constants, and a build that breaks them should not build.)
    const { assert!(HOURS_PER_SNACK == 24) };
    const { assert!(MAX_HOURS >= 2 * HOURS_PER_SNACK && MAX_HOURS <= 7 * 24) };
    const { assert!(BARE_MOOD > 0.0 && BARE_MOOD < crate::habit::seeds::MOOD_PER_SESSION) };
  }
}
