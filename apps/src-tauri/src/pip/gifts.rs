//! Gifts between readers: one pays for a thing, the other keeps it.
//!
//! Two records, one on each reader's side, and neither can see the other's:
//!
//! * the sender's is spending and nothing else: kind `gift`, item id
//!   `<kind>:<id>:<gift id>`, at the catalogue's price;
//! * the receiver's is an ordinary purchase of the thing at price 0, under
//!   the purchase id `gift-<gift id>`, so it is owned like anything bought.
//!
//! The gift's id is minted where gifts are passed on (the server), which this
//! code cannot ask: it only makes each side happen once per gift id.

use super::{Catalogue, Item, Purchase, ShopError};

/// The sender's record's kind.
pub const KIND_GIFT: &str = "gift";
/// The kinds of thing that can be given: things kept, that show on Pip or in
/// the house. Not floors or plots (they open in order), not food.
pub const GIFT_KINDS: [&str; 6] = ["accessory", "room", "wallpaper", "flooring", "skin", "move"];

/// Whether a thing is one the shop sells to keep: what a reader may pay for
/// on a friend's behalf, and so what may arrive as a gift.
pub fn giftable(item: &Item) -> bool {
  GIFT_KINDS.contains(&item.kind.as_str())
    && !item.earned_only
    && !item.consumable
    && item.free_with.is_none()
    && item.price > 0
}

/// The sender's record's item id.
pub fn sent_item_id(kind: &str, id: &str, gift_id: &str) -> String {
  format!("{kind}:{id}:{gift_id}")
}

/// Whether this gift has been paid for already (on any device).
pub fn sent(purchases: &[Purchase], gift_id: &str) -> bool {
  purchases
    .iter()
    .filter(|purchase| purchase.item_kind == KIND_GIFT)
    .any(|purchase| purchase.item_id.rsplit_once(':').map(|(_, id)| id) == Some(gift_id))
}

/// The receiver's purchase id: one per gift, so a gift arriving twice (a
/// retry, a second device) is one record.
pub fn received_id(gift_id: &str) -> String {
  format!("gift-{gift_id}")
}

/// Whether the reader can give this now, and what it costs them. The sender
/// must be far enough along to buy it for themselves (their level, their
/// focus sessions): a gift is not a way round what a rare thing asks for.
/// Owning it or not makes no difference to giving it.
pub fn check_send<'a>(
  catalogue: &'a Catalogue,
  balance: i64,
  sessions_done: i64,
  level: i64,
  kind: &str,
  id: &str
) -> Result<&'a Item, ShopError> {
  let item = catalogue.get(kind, id).ok_or(ShopError::Unknown)?;
  if !giftable(item) {
    return Err(ShopError::NotAGift);
  }
  if sessions_done < item.sessions {
    return Err(ShopError::NeedsSessions { left: item.sessions - sessions_done });
  }
  if level < item.level {
    return Err(ShopError::NeedsLevel { level: item.level });
  }
  if balance < item.price {
    return Err(ShopError::CannotAfford { short: item.price - balance });
  }
  Ok(item)
}

/// Whether a thing may arrive as a gift: one the catalogue knows and a
/// sender could have paid for.
pub fn check_receive<'a>(catalogue: &'a Catalogue, kind: &str, id: &str) -> Result<&'a Item, ShopError> {
  let item = catalogue.get(kind, id).ok_or(ShopError::Unknown)?;
  if !giftable(item) {
    return Err(ShopError::NotAGift);
  }
  Ok(item)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::pip::{owned, spent};

  const GIFT: &str = "0123456789abcdef01234567";
  const OTHER: &str = "89abcdef0123456789abcdef";

  fn catalogue() -> Catalogue {
    Catalogue::parse(
      r#"{ "items": [
        {"kind":"skin","id":"sprout","price":0},
        {"kind":"skin","id":"golden","price":0,"earnedOnly":true},
        {"kind":"skin","id":"dragon","price":900,"level":8},
        {"kind":"accessory","id":"scarf","price":80,"slot":"neck"},
        {"kind":"room","id":"kettle","price":50,"freeWith":"kitchen"},
        {"kind":"room","id":"jukebox","price":300,"sessions":20},
        {"kind":"level","id":"kitchen","price":450},
        {"kind":"plot","id":"plot-4","price":200},
        {"kind":"treat","id":"apple","price":10,"consumable":true,"mood":8},
        {"kind":"treat","id":"ball","price":60,"mood":12}
      ] }"#
    )
    .expect("parses")
  }

  fn sent_record(id: &str, kind: &str, thing: &str, gift_id: &str, price: i64) -> Purchase {
    Purchase {
      id: id.into(),
      item_kind: KIND_GIFT.into(),
      item_id: sent_item_id(kind, thing, gift_id),
      price,
      bought_at: "2026-10-06T10:00:00+05:30".into()
    }
  }

  #[test]
  fn a_thing_kept_and_for_sale_can_be_given() {
    let catalogue = catalogue();
    assert_eq!(check_send(&catalogue, 100, 0, 1, "accessory", "scarf").map(|item| item.price), Ok(80));
    assert_eq!(check_send(&catalogue, 30, 0, 1, "accessory", "scarf"), Err(ShopError::CannotAfford { short: 50 }));
    assert_eq!(check_send(&catalogue, 999, 0, 1, "accessory", "cape"), Err(ShopError::Unknown));
  }

  #[test]
  fn what_is_not_sold_to_keep_cannot_be_given() {
    let catalogue = catalogue();
    for (kind, id, why) in [
      ("skin", "sprout", "free: everyone has it"),
      ("skin", "golden", "earned by reading"),
      ("room", "kettle", "comes with a floor"),
      ("level", "kitchen", "a floor"),
      ("plot", "plot-4", "a plot"),
      ("treat", "apple", "food"),
      ("treat", "ball", "a toy is not one of the kinds")
    ] {
      assert_eq!(check_send(&catalogue, 9999, 99, 99, kind, id), Err(ShopError::NotAGift), "{why}");
      assert_eq!(check_receive(&catalogue, kind, id), Err(ShopError::NotAGift), "{why}");
    }
  }

  #[test]
  fn the_sender_must_be_able_to_buy_it_themselves() {
    let catalogue = catalogue();
    assert_eq!(check_send(&catalogue, 9999, 0, 7, "skin", "dragon"), Err(ShopError::NeedsLevel { level: 8 }));
    assert!(check_send(&catalogue, 9999, 0, 8, "skin", "dragon").is_ok());
    assert_eq!(check_send(&catalogue, 9999, 5, 1, "room", "jukebox"), Err(ShopError::NeedsSessions { left: 15 }));
    // The receiver needs neither: it was given.
    assert!(check_receive(&catalogue, "skin", "dragon").is_ok());
    assert!(check_receive(&catalogue, "room", "jukebox").is_ok());
  }

  #[test]
  fn a_gift_sent_is_spent_and_not_owned() {
    let catalogue = catalogue();
    let records = [sent_record("buy-1", "accessory", "scarf", GIFT, 80)];
    assert_eq!(spent(&catalogue, &records), 80);
    let mine = owned(&catalogue, &records);
    assert!(!mine.contains(&("accessory".into(), "scarf".into())), "the friend has it, not the sender");
    assert!(mine.iter().all(|(kind, _)| kind != KIND_GIFT));
    assert!(sent(&records, GIFT));
    assert!(!sent(&records, OTHER));
  }

  #[test]
  fn the_same_thing_given_to_two_friends_is_paid_for_twice() {
    let catalogue = catalogue();
    let records = [sent_record("buy-1", "accessory", "scarf", GIFT, 80), sent_record("buy-2", "accessory", "scarf", OTHER, 80)];
    assert_eq!(spent(&catalogue, &records), 160);
    // One gift recorded on two devices before they synced is paid for once.
    let twice = [sent_record("buy-1", "accessory", "scarf", GIFT, 80), sent_record("buy-9", "accessory", "scarf", GIFT, 80)];
    assert_eq!(spent(&catalogue, &twice), 80);
  }

  #[test]
  fn a_gift_received_is_owned_and_costs_nothing() {
    let catalogue = catalogue();
    let arrived = Purchase {
      id: received_id(GIFT),
      item_kind: "accessory".into(),
      item_id: "scarf".into(),
      price: 0,
      bought_at: "2026-10-06T10:00:00+05:30".into()
    };
    assert_eq!(arrived.id, "gift-0123456789abcdef01234567");
    assert!(owned(&catalogue, std::slice::from_ref(&arrived)).contains(&("accessory".into(), "scarf".into())));
    assert_eq!(spent(&catalogue, &[arrived]), 0);
  }
}
