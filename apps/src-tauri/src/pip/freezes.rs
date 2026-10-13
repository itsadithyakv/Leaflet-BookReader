//! Streak freezes, bought with seeds.
//!
//! The streak engine banks a freeze for every few days of streak
//! (`habit::evaluate`); this is the other way to come by one. A freeze bought
//! is a purchase record like a snack: charged every time, never owned. The
//! record is what is counted (so many a month); the freeze itself goes into
//! the streak's bank on the device that bought it (`commands::pip_buy_freeze`).

use super::rewards::record_day;
use super::{Catalogue, Item, Purchase, ShopError};
use crate::habit::MAX_FREEZES;

/// The record's kind, and the one thing of that kind the catalogue lists.
pub const KIND_FREEZE: &str = "freeze";
pub const FREEZE_ID: &str = "freeze";
/// How many may be bought in a calendar month. A freeze forgives a missed
/// day; a streak that seeds could always buy back would mean nothing.
pub const FREEZES_PER_MONTH: i64 = 2;

/// The calendar month of a local day (`2026-10` of `2026-10-11`), or none for
/// a day that is not a date.
pub fn month_of(day: &str) -> Option<&str> {
  chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()?;
  day.get(..7)
}

/// Freezes bought in a month (`2026-10`), on any device: each record is
/// stamped with the reader's local time, so its own date says which month.
pub fn bought_in_month(purchases: &[Purchase], month: &str) -> i64 {
  purchases
    .iter()
    .filter(|purchase| purchase.item_kind == KIND_FREEZE)
    .filter(|purchase| record_day(&purchase.bought_at).and_then(|day| day.get(..7)) == Some(month))
    .count() as i64
}

/// Whether a freeze can be bought today, and at what price. `held` is how
/// many the streak's bank holds now.
pub fn check_buy<'a>(
  catalogue: &'a Catalogue,
  purchases: &[Purchase],
  balance: i64,
  held: i64,
  today_key: &str
) -> Result<&'a Item, String> {
  let item = catalogue.get(KIND_FREEZE, FREEZE_ID).ok_or_else(|| ShopError::Unknown.to_string())?;
  let month = month_of(today_key).ok_or_else(|| "That isn't a day.".to_string())?;
  // The bank first: a freeze there is no room for would be seeds for nothing.
  if held >= MAX_FREEZES {
    return Err(format!("Pip is holding {MAX_FREEZES} streak freezes already, and that's all there's room for."));
  }
  if bought_in_month(purchases, month) >= FREEZES_PER_MONTH {
    return Err(format!("That's this month's {FREEZES_PER_MONTH} streak freezes bought. More next month."));
  }
  if balance < item.price {
    return Err(ShopError::CannotAfford { short: item.price - balance }.to_string());
  }
  Ok(item)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn catalogue() -> Catalogue {
    Catalogue::parse(
      r#"{ "items": [
        {"kind":"skin","id":"sprout","price":0},
        {"kind":"freeze","id":"freeze","price":120,"consumable":true}
      ] }"#
    )
    .expect("parses")
  }

  fn freeze(id: &str, at: &str) -> Purchase {
    Purchase { id: id.into(), item_kind: KIND_FREEZE.into(), item_id: FREEZE_ID.into(), price: 120, bought_at: at.into() }
  }

  #[test]
  fn a_freeze_costs_what_the_catalogue_says() {
    assert_eq!(check_buy(&catalogue(), &[], 500, 0, "2026-10-11").map(|item| item.price), Ok(120));
    assert_eq!(
      check_buy(&catalogue(), &[], 100, 0, "2026-10-11"),
      Err(ShopError::CannotAfford { short: 20 }.to_string())
    );
  }

  #[test]
  fn a_catalogue_with_no_freeze_sells_none() {
    let bare = Catalogue::parse(r#"{"items":[{"kind":"skin","id":"sprout","price":0}]}"#).expect("parses");
    assert_eq!(check_buy(&bare, &[], 500, 0, "2026-10-11"), Err(ShopError::Unknown.to_string()));
  }

  #[test]
  fn two_a_month_and_the_month_is_the_readers_own() {
    let one = [freeze("a", "2026-10-02T09:00:00+05:30")];
    assert!(check_buy(&catalogue(), &one, 500, 0, "2026-10-11").is_ok());
    let two = [freeze("a", "2026-10-02T09:00:00+05:30"), freeze("b", "2026-10-09T21:00:00+05:30")];
    let refused = check_buy(&catalogue(), &two, 500, 0, "2026-10-11").expect_err("the month is used up");
    assert!(refused.contains("this month"), "{refused}");
    // November starts again.
    assert!(check_buy(&catalogue(), &two, 500, 0, "2026-11-01").is_ok());
    // 00:30 on the 1st in India is still the 31st in UTC: it is November's.
    let late = [freeze("a", "2026-10-31T23:30:00+05:30"), freeze("b", "2026-11-01T00:30:00+05:30")];
    assert_eq!((bought_in_month(&late, "2026-10"), bought_in_month(&late, "2026-11")), (1, 1));
  }

  #[test]
  fn only_freezes_are_counted_and_only_stamps_that_read() {
    let mixed = [
      freeze("a", "2026-10-02T09:00:00+05:30"),
      freeze("b", "sometime in October"),
      Purchase { id: "c".into(), item_kind: "treat".into(), item_id: "apple".into(), price: 5, bought_at: "2026-10-03T09:00:00+05:30".into() }
    ];
    assert_eq!(bought_in_month(&mixed, "2026-10"), 1);
  }

  #[test]
  fn a_full_bank_takes_no_more() {
    let refused = check_buy(&catalogue(), &[], 500, MAX_FREEZES, "2026-10-11").expect_err("no room");
    assert!(refused.contains("room"), "{refused}");
    assert!(check_buy(&catalogue(), &[], 500, MAX_FREEZES - 1, "2026-10-11").is_ok());
  }

  #[test]
  fn a_day_that_is_not_a_date_buys_nothing() {
    assert!(check_buy(&catalogue(), &[], 500, 0, "October").is_err());
    assert_eq!(month_of("2026-10-11"), Some("2026-10"));
    assert_eq!(month_of("2026-13-01"), None);
  }
}
