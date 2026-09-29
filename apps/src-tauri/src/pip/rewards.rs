//! Pip's rewards: seeds for a new reader's first steps, the starter chest, a
//! finished set and a granted daily wish.
//!
//! None of it is stored, like the balance. Each reward is a pure function of
//! records every device shares (purchases, plantings, the garden replayed
//! from the reading, the reading ledger), so there is no "claimed" flag for
//! two devices to disagree about, and a sync can never pay twice: after a
//! merge a first step is done or not, a set is complete or not, and a day's
//! wish was granted or not, whichever device did it (or both).
//!
//! Every rule asks for records that are never unmade (a purchase, a planting,
//! a harvest, a day read), so a reward once earned stays earned.
//!
//! What each reward pays comes from the catalogue (`catalogue.json`, written
//! from the app's `shop.js`); what earns it is decided here.

use super::{own, owned_free, Catalogue, Item, Purchase};
use crate::habit::seeds::Garden;
use crate::habit::DayRecord;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};

// ---- what the catalogue says rewards pay --------------------------------------

/// The rewards as the catalogue holds them.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct Rewards {
  #[serde(default)]
  pub goals: Vec<GoalDef>,
  #[serde(default)]
  pub chest: ChestDef,
  #[serde(default)]
  pub sets: Vec<SetDef>,
  #[serde(default)]
  pub wish: WishDef
}

/// One first step: its id names its rule (`goal_done`).
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct GoalDef {
  pub id: String,
  pub seeds: i64
}

/// The starter chest: seeds with the first focus session of `minutes`.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct ChestDef {
  pub seeds: i64,
  pub minutes: f64
}

/// A set: own every piece (things of one kind) for `seeds`.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct SetDef {
  pub id: String,
  pub kind: String,
  pub items: Vec<String>,
  pub seeds: i64,
  /// A floor's decor set.
  #[serde(default)]
  pub level: Option<String>
}

/// Pip's daily wish: what granting it pays, and the lists it is chosen from.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct WishDef {
  pub seeds: i64,
  pub mood: f64,
  #[serde(default)]
  pub eras: Vec<WishEra>
}

/// The lists a wish is chosen from, from `since` (a local day) on. Frozen once
/// shipped: a new list is a new era, so past days keep the wishes they had.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct WishEra {
  pub since: String,
  #[serde(default)]
  pub treat: Vec<String>,
  #[serde(default)]
  pub plant: Vec<String>,
  #[serde(default)]
  pub room: Vec<String>,
  #[serde(default, rename = "move")]
  pub moves: Vec<String>
}

impl WishEra {
  fn list(&self, kind: &str) -> &[String] {
    match kind {
      "treat" => &self.treat,
      "plant" => &self.plant,
      "room" => &self.room,
      "move" => &self.moves,
      _ => &[]
    }
  }
}

// ---- what the Pip tab is told ---------------------------------------------------

/// A first step, done or not, and what it pays.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalStatus {
  pub id: String,
  pub done: bool,
  pub seeds: i64
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChestStatus {
  pub open: bool,
  pub seeds: i64,
  /// Minutes of focused reading in one session that open it.
  pub minutes: f64
}

/// How far along a set is: `have` of its `of` pieces.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetStatus {
  pub id: String,
  pub kind: String,
  pub have: usize,
  pub of: usize,
  pub done: bool,
  pub seeds: i64,
  pub level: Option<String>
}

/// Owned out of all there are, for one kind of thing.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Count {
  pub owned: usize,
  pub total: usize
}

/// A day's wish.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Wish {
  pub day: String,
  pub kind: String,
  pub id: String
}

/// Today's wish, whether it was granted, and what granting it gives.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WishView {
  pub day: String,
  pub kind: String,
  pub id: String,
  pub granted: bool,
  pub seeds: i64,
  pub mood: f64
}

/// Seeds from each kind of reward.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RewardSeeds {
  pub goals: i64,
  pub chest: i64,
  pub sets: i64,
  pub wishes: i64
}

/// Every reward, worked out from the records.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Earned {
  pub goals: Vec<GoalStatus>,
  pub chest: ChestStatus,
  pub sets: Vec<SetStatus>,
  /// The days whose wish was granted.
  pub wish_days: BTreeSet<String>,
  pub seeds: RewardSeeds
}

// ---- the rules -------------------------------------------------------------------

/// The records a reader's first steps are read from.
pub struct Facts<'a> {
  pub purchases: &'a [Purchase],
  /// Seeds planted, ever.
  pub plantings: usize,
  /// The garden, replayed from the reading (`habit::seeds::grow`).
  pub garden: &'a Garden,
  pub days: &'a HashMap<String, DayRecord>,
  /// The most minutes of reading one focus session counted (the ledger-backed
  /// minutes that water the garden; see `habit::seeds::longest_focus`).
  pub longest_focus: f64
}

/// Whether a first step is done. Each asks for a record that is never unmade,
/// so a step never comes undone.
fn goal_done(catalogue: &Catalogue, id: &str, facts: &Facts<'_>) -> bool {
  let bought = |kind: &str, like: &dyn Fn(&Item) -> bool| {
    facts
      .purchases
      .iter()
      .any(|purchase| purchase.item_kind == kind && catalogue.get(kind, &purchase.item_id).map(like).unwrap_or(false))
  };
  match id {
    "plant" => facts.plantings > 0,
    // Water reached a plant: reading in focus after planting, or before it
    // (the barrel pours into the new planting). More reading or more
    // plantings only ever bring more water to the plants.
    "water" => facts.garden.plants.iter().any(|plant| plant.water >= 1.0),
    "read" => facts.days.values().any(DayRecord::goal_met),
    "pick" => facts.garden.plants.iter().any(|plant| plant.harvested),
    "treat" => facts.purchases.iter().any(|purchase| purchase.item_kind == "treat"),
    // A hat bought, not a hat worn: an outfit changes, a purchase does not.
    "hat" => bought("accessory", &|item| item.slot.as_deref() == Some("head")),
    // A lamp bought. The shop puts a new lamp straight into a free spot, but
    // where a thing stands can change and a purchase cannot. No light is
    // free, so any lamp out in the house was bought.
    "lamp" => bought("room", &|item| item.light),
    _ => false
  }
}

/// The first steps, in the catalogue's order.
pub fn goals(catalogue: &Catalogue, facts: &Facts<'_>) -> Vec<GoalStatus> {
  catalogue
    .rewards()
    .goals
    .iter()
    .map(|goal| GoalStatus { id: goal.id.clone(), done: goal_done(catalogue, &goal.id, facts), seeds: goal.seeds.max(0) })
    .collect()
}

/// The starter chest: open once one focus session has counted its minutes.
pub fn chest(catalogue: &Catalogue, longest_focus: f64) -> ChestStatus {
  let def = &catalogue.rewards().chest;
  ChestStatus {
    open: def.seeds > 0 && def.minutes > 0.0 && longest_focus >= def.minutes,
    seeds: def.seeds.max(0),
    minutes: def.minutes
  }
}

/// Every set and how far along it is. Owning only grows (purchases merge as a
/// union), so a finished set stays finished.
pub fn sets(catalogue: &Catalogue, owned: &BTreeSet<(String, String)>) -> Vec<SetStatus> {
  catalogue
    .rewards()
    .sets
    .iter()
    .map(|set| {
      let have = set.items.iter().filter(|id| owned.contains(&(set.kind.clone(), (*id).clone()))).count();
      SetStatus {
        id: set.id.clone(),
        kind: set.kind.clone(),
        have,
        of: set.items.len(),
        done: !set.items.is_empty() && have == set.items.len(),
        seeds: set.seeds.max(0),
        level: set.level.clone()
      }
    })
    .collect()
}

/// Owned out of all there are, by kind ("Wardrobe 5/42"). Things bought each
/// time they are used (snacks, seed packets) are not collected.
pub fn collection(catalogue: &Catalogue, owned: &BTreeSet<(String, String)>) -> BTreeMap<String, Count> {
  let mut counts: BTreeMap<String, Count> = BTreeMap::new();
  for item in catalogue.items().filter(|item| !item.consumable) {
    let count = counts.entry(item.kind.clone()).or_default();
    count.total += 1;
    if owned.contains(&(item.kind.clone(), item.id.clone())) {
      count.owned += 1;
    }
  }
  counts
}

// ---- the daily wish -----------------------------------------------------------------

/// FNV-1a: small and fixed, so every device and every version of the app picks
/// the same wish for the same day.
fn fnv1a(text: &str) -> u32 {
  let mut hash: u32 = 0x811c_9dc5;
  for byte in text.bytes() {
    hash ^= u32::from(byte);
    hash = hash.wrapping_mul(0x0100_0193);
  }
  hash
}

/// The day a record was made, where it was made (`YYYY-MM-DD`). The shop
/// stamps purchases in the reader's local time with its offset, so the date
/// part is the reader's own day, on every device. None for a stamp that does
/// not parse.
pub fn record_day(stamp: &str) -> Option<&str> {
  chrono::DateTime::parse_from_rfc3339(stamp).ok()?;
  stamp.get(..10)
}

/// Pip's wish for a day. The day's hash picks a kind (snacks most often, then
/// seed packets, then a piece of decor, now and then a move) and a thing of
/// that kind from the day's list. A piece or a move Pip already had before
/// the day began is not wished for; with none left, Pip wishes for a snack.
/// None before the first list's day, or for a day that is not a date.
pub fn wish_for(catalogue: &Catalogue, day: &str, owned_before: &BTreeSet<(String, String)>) -> Option<Wish> {
  chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()?;
  let era = catalogue
    .rewards()
    .wish
    .eras
    .iter()
    .filter(|era| era.since.as_str() <= day)
    .max_by(|a, b| a.since.cmp(&b.since))?;
  let open = |kind: &str| -> Vec<&String> {
    era
      .list(kind)
      .iter()
      .filter(|id| match catalogue.get(kind, id) {
        Some(item) if kind == "treat" || kind == "plant" => item.consumable,
        Some(_) => !owned_before.contains(&(kind.to_string(), (*id).clone())),
        None => false
      })
      .collect()
  };
  let wanted = match fnv1a(day) % 10 {
    0..=3 => "treat",
    4..=6 => "plant",
    7 | 8 => "room",
    _ => "move"
  };
  let (kind, pool) = match open(wanted) {
    pool if !pool.is_empty() => (wanted, pool),
    _ => ("treat", open("treat"))
  };
  if pool.is_empty() {
    return None;
  }
  let pick = pool[fnv1a(&format!("{day}/{kind}")) as usize % pool.len()];
  Some(Wish { day: day.to_string(), kind: kind.to_string(), id: pick.clone() })
}

/// Whether a purchase grants a wish: the wished thing, given, planted or
/// bought on the wish's own day.
fn grants(wish: &Wish, purchase: &Purchase) -> bool {
  purchase.item_kind == wish.kind && purchase.item_id == wish.id && record_day(&purchase.bought_at) == Some(wish.day.as_str())
}

/// What was owned before a day began.
fn owned_before(catalogue: &Catalogue, purchases: &[Purchase], day: &str) -> BTreeSet<(String, String)> {
  let mut owned = owned_free(catalogue);
  for purchase in purchases {
    if record_day(&purchase.bought_at).map(|at| at < day).unwrap_or(false) {
      own(catalogue, &mut owned, purchase);
    }
  }
  owned
}

/// Every day, from the first list's day on, whose wish was granted.
pub fn granted_days(catalogue: &Catalogue, purchases: &[Purchase]) -> BTreeSet<String> {
  let mut granted = BTreeSet::new();
  let Some(first) = catalogue.rewards().wish.eras.iter().map(|era| era.since.as_str()).min() else {
    return granted;
  };
  let mut by_day: BTreeMap<&str, Vec<&Purchase>> = BTreeMap::new();
  for purchase in purchases {
    if let Some(day) = record_day(&purchase.bought_at) {
      by_day.entry(day).or_default().push(purchase);
    }
  }
  // Day by day, in order, keeping what was owned before each one.
  let mut owned = owned_free(catalogue);
  for (day, bought) in by_day {
    if day >= first {
      if let Some(wish) = wish_for(catalogue, day, &owned) {
        if bought.iter().any(|purchase| grants(&wish, purchase)) {
          granted.insert(day.to_string());
        }
      }
    }
    for purchase in bought {
      own(catalogue, &mut owned, purchase);
    }
  }
  granted
}

/// Today's wish (`today` is the reader's local day), and whether it was granted.
pub fn wish_today(catalogue: &Catalogue, purchases: &[Purchase], today: &str) -> Option<WishView> {
  let wish = wish_for(catalogue, today, &owned_before(catalogue, purchases, today))?;
  let def = &catalogue.rewards().wish;
  Some(WishView {
    granted: purchases.iter().any(|purchase| grants(&wish, purchase)),
    day: wish.day,
    kind: wish.kind,
    id: wish.id,
    seeds: def.seeds.max(0),
    mood: def.mood.max(0.0)
  })
}

/// Whether a purchase about to be recorded grants today's wish, which nothing
/// had granted yet: Pip cheers up once a day for it, not once a purchase.
pub fn grants_wish_now(catalogue: &Catalogue, purchases: &[Purchase], purchase: &Purchase, today: &str) -> bool {
  match wish_today(catalogue, purchases, today) {
    Some(view) if !view.granted => {
      let wish = Wish { day: view.day, kind: view.kind, id: view.id };
      grants(&wish, purchase)
    }
    _ => false
  }
}

// ---- all together ------------------------------------------------------------------

/// Every reward and the seeds each kind pays.
pub fn earned(catalogue: &Catalogue, facts: &Facts<'_>, owned: &BTreeSet<(String, String)>) -> Earned {
  let goals = goals(catalogue, facts);
  let chest = chest(catalogue, facts.longest_focus);
  let sets = sets(catalogue, owned);
  let wish_days = granted_days(catalogue, facts.purchases);
  let seeds = RewardSeeds {
    goals: goals.iter().filter(|goal| goal.done).map(|goal| goal.seeds).sum(),
    chest: if chest.open { chest.seeds } else { 0 },
    sets: sets.iter().filter(|set| set.done).map(|set| set.seeds).sum(),
    wishes: wish_days.len() as i64 * catalogue.rewards().wish.seeds.max(0)
  };
  Earned { goals, chest, sets, wish_days, seeds }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::habit::seeds::{grow, HarvestIn, PlantingIn};
  use crate::pip::owned;

  const JSON: &str = r#"{
    "items": [
      {"kind":"skin","id":"sprout","price":0},
      {"kind":"accessory","id":"cap","price":30,"slot":"head"},
      {"kind":"accessory","id":"shades","price":60,"slot":"face"},
      {"kind":"accessory","id":"scarf","price":40,"slot":"neck"},
      {"kind":"room","id":"bed","price":0},
      {"kind":"room","id":"lamp","price":70,"light":true},
      {"kind":"room","id":"beanbag","price":90},
      {"kind":"room","id":"clock","price":60},
      {"kind":"room","id":"window","price":120,"freeWith":"bedroom"},
      {"kind":"room","id":"kettle","price":50,"freeWith":"kitchen"},
      {"kind":"room","id":"stove","price":240},
      {"kind":"level","id":"bedroom","price":0},
      {"kind":"level","id":"kitchen","price":450,"requires":"bedroom"},
      {"kind":"treat","id":"apple","price":5,"consumable":true,"mood":6},
      {"kind":"treat","id":"cookie","price":8,"consumable":true,"mood":8},
      {"kind":"treat","id":"duck","price":20,"mood":10},
      {"kind":"plant","id":"radish","price":1,"consumable":true,"water":15,"yield":4},
      {"kind":"plant","id":"sunflower","price":4,"consumable":true,"water":60,"yield":20},
      {"kind":"move","id":"read","price":0},
      {"kind":"move","id":"floss","price":60}
    ],
    "goals": [
      {"id":"plant","seeds":10}, {"id":"water","seeds":10}, {"id":"read","seeds":15}, {"id":"pick","seeds":15},
      {"id":"treat","seeds":5}, {"id":"hat","seeds":20}, {"id":"lamp","seeds":25}
    ],
    "chest": {"seeds":30,"minutes":5},
    "sets": [
      {"id":"explorer","kind":"accessory","items":["cap","shades","scarf"],"seeds":25},
      {"id":"kitchen","kind":"room","items":["kettle","stove"],"seeds":70,"level":"kitchen"}
    ],
    "wish": {"seeds":8,"mood":10,"eras":[
      {"since":"2026-09-29","treat":["apple","cookie"],"plant":["radish","sunflower"],"room":["lamp","beanbag","clock"],"move":["floss"]}
    ]}
  }"#;

  fn catalogue() -> Catalogue {
    Catalogue::parse(JSON).expect("parses")
  }

  fn bought_at(kind: &str, id: &str, price: i64, at: &str) -> Purchase {
    Purchase {
      id: format!("buy-{kind}-{id}-{at}"),
      item_kind: kind.to_string(),
      item_id: id.to_string(),
      price,
      bought_at: at.to_string()
    }
  }

  fn bought(kind: &str, id: &str, price: i64) -> Purchase {
    bought_at(kind, id, price, "2026-09-30T10:00:00+05:30")
  }

  fn day(key: &str, minutes: f64, goal: i64) -> DayRecord {
    DayRecord { date_key: key.to_string(), minutes, goal_minutes: goal, freeze_used: false, grace_used: false }
  }

  /// The first steps as a new reader's records would have them.
  fn steps(purchases: &[Purchase], plantings: usize, garden: &Garden, days: &HashMap<String, DayRecord>) -> Vec<(String, bool)> {
    let facts = Facts { purchases, plantings, garden, days, longest_focus: 0.0 };
    goals(&catalogue(), &facts).into_iter().map(|goal| (goal.id, goal.done)).collect()
  }

  fn done(list: &[(String, bool)], id: &str) -> bool {
    list.iter().any(|(goal, done)| goal == id && *done)
  }

  #[test]
  fn the_bundled_rewards_parse_and_every_step_has_a_rule() {
    let bundled = Catalogue::bundled();
    let rewards = bundled.rewards();
    assert!(!rewards.goals.is_empty(), "the first steps ship");
    for goal in &rewards.goals {
      assert!(["plant", "water", "read", "pick", "treat", "hat", "lamp"].contains(&goal.id.as_str()), "{} has a rule", goal.id);
      assert!(goal.seeds > 0);
    }
    assert!(rewards.chest.seeds > 0 && rewards.chest.minutes > 0.0);
    for set in &rewards.sets {
      for id in &set.items {
        assert!(bundled.get(&set.kind, id).is_some(), "set {} has {} {}", set.id, set.kind, id);
      }
    }
    assert!(!rewards.wish.eras.is_empty() && rewards.wish.seeds > 0);
    // No light is free, so the "place a lamp" step always means buying one.
    assert!(bundled.items().filter(|item| item.light).all(|item| item.price > 0 && item.free_with.is_none()));
  }

  #[test]
  fn nothing_is_done_for_a_new_reader() {
    let list = steps(&[], 0, &Garden::default(), &HashMap::new());
    assert_eq!(list.len(), 7);
    assert!(list.iter().all(|(_, done)| !done));
  }

  #[test]
  fn planting_watering_and_picking_are_read_from_the_garden() {
    let plants = [PlantingIn { id: "p", plot: 1, plant: "radish", planted_at_ms: 0, need: 15.0, yield_seeds: 4 }];
    let planted = grow(&[], &plants, &[]);
    let list = steps(&[], 1, &planted, &HashMap::new());
    assert!(done(&list, "plant") && !done(&list, "water") && !done(&list, "pick"));

    let watered = grow(&[(10, 6.0)], &plants, &[]);
    assert!(done(&steps(&[], 1, &watered, &HashMap::new()), "water"));

    // Read before planting: the barrel pours into the new plant.
    let early = grow(&[(-10, 6.0)], &plants, &[]);
    assert!(done(&steps(&[], 1, &early, &HashMap::new()), "water"));

    let picked = grow(&[(10, 15.0)], &plants, &[HarvestIn { id: "h", planting_id: "p", seeds: 4 }]);
    assert!(done(&steps(&[], 1, &picked, &HashMap::new()), "pick"));
  }

  #[test]
  fn the_reading_goal_step_is_any_day_the_goal_was_met() {
    let short: HashMap<String, DayRecord> = [("2026-09-30".to_string(), day("2026-09-30", 12.0, 20))].into_iter().collect();
    assert!(!done(&steps(&[], 0, &Garden::default(), &short), "read"));
    let met: HashMap<String, DayRecord> = [("2026-09-30".to_string(), day("2026-09-30", 21.0, 20))].into_iter().collect();
    assert!(done(&steps(&[], 0, &Garden::default(), &met), "read"));
  }

  #[test]
  fn a_treat_a_hat_and_a_lamp_are_purchases() {
    let garden = Garden::default();
    let none = HashMap::new();
    let snack = steps(&[bought("treat", "apple", 5)], 0, &garden, &none);
    assert!(done(&snack, "treat"));
    // Sunglasses are not a hat, and a beanbag is not a lamp.
    let not_yet = steps(&[bought("accessory", "shades", 60), bought("room", "beanbag", 90)], 0, &garden, &none);
    assert!(!done(&not_yet, "hat") && !done(&not_yet, "lamp"));
    let yes = steps(&[bought("accessory", "cap", 30), bought("room", "lamp", 70)], 0, &garden, &none);
    assert!(done(&yes, "hat") && done(&yes, "lamp"));
  }

  #[test]
  fn the_chest_opens_with_a_session_of_five_counted_minutes() {
    assert!(!chest(&catalogue(), 0.0).open);
    assert!(!chest(&catalogue(), 4.5).open);
    let open = chest(&catalogue(), 5.0);
    assert!(open.open);
    assert_eq!(open.seeds, 30);
  }

  #[test]
  fn a_set_pays_once_every_piece_is_owned() {
    let catalogue = catalogue();
    let partly = owned(&catalogue, &[bought("accessory", "cap", 30), bought("accessory", "shades", 60)]);
    let explorer = sets(&catalogue, &partly).into_iter().find(|set| set.id == "explorer").expect("the set");
    assert_eq!((explorer.have, explorer.of, explorer.done), (2, 3, false));
    let all = owned(
      &catalogue,
      &[bought("accessory", "cap", 30), bought("accessory", "shades", 60), bought("accessory", "scarf", 40)]
    );
    let finished = sets(&catalogue, &all).into_iter().find(|set| set.id == "explorer").expect("the set");
    assert!(finished.done);
  }

  #[test]
  fn a_floor_set_counts_the_starter_piece_that_came_with_the_floor() {
    let catalogue = catalogue();
    let before = sets(&catalogue, &owned(&catalogue, &[bought("room", "stove", 240)]));
    let kitchen = before.iter().find(|set| set.id == "kitchen").expect("the set");
    assert_eq!(kitchen.have, 1, "the kettle is not Pip's before the kitchen is");
    let with_floor = owned(&catalogue, &[bought("level", "kitchen", 450), bought("room", "stove", 240)]);
    let after = sets(&catalogue, &with_floor);
    assert!(after.iter().any(|set| set.id == "kitchen" && set.done), "the kettle came with the floor");
  }

  #[test]
  fn the_collection_counts_what_is_kept() {
    let catalogue = catalogue();
    let counts = collection(&catalogue, &owned(&catalogue, &[bought("accessory", "cap", 30)]));
    assert_eq!(counts.get("accessory"), Some(&Count { owned: 1, total: 3 }));
    // The bed is free and the window comes with the bedroom.
    assert_eq!(counts.get("room").map(|count| count.owned), Some(2));
    assert!(!counts.contains_key("plant"), "seed packets are used, not collected");
    assert_eq!(counts.get("treat"), Some(&Count { owned: 0, total: 1 }), "toys are kept; snacks are eaten");
  }

  // ---- the wish --------------------------------------------------------------

  #[test]
  fn a_day_has_one_wish_and_it_is_the_same_everywhere() {
    let catalogue = catalogue();
    let none = owned(&catalogue, &[]);
    let wish = wish_for(&catalogue, "2026-10-02", &none).expect("a wish");
    assert_eq!(wish_for(&catalogue, "2026-10-02", &none), Some(wish.clone()), "the same for the same day");
    assert_eq!(fnv1a("2026-10-02"), fnv1a("2026-10-02"));
    assert_eq!(fnv1a(""), 0x811c_9dc5, "FNV-1a's offset basis: the hash is the standard one");
    // Over a season, every kind comes up.
    let kinds: BTreeSet<String> = (1..=60)
      .map(|n| (chrono::NaiveDate::from_ymd_opt(2026, 10, 1).expect("date") + chrono::Duration::days(n)).format("%Y-%m-%d").to_string())
      .filter_map(|day| wish_for(&catalogue, &day, &none).map(|wish| wish.kind))
      .collect();
    assert_eq!(kinds.len(), 4, "snacks, packets, decor and moves: {kinds:?}");
  }

  #[test]
  fn no_wish_before_the_first_list_or_for_a_bad_day() {
    let catalogue = catalogue();
    let none = owned(&catalogue, &[]);
    assert!(wish_for(&catalogue, "2026-09-28", &none).is_none());
    assert!(wish_for(&catalogue, "tomorrow", &none).is_none());
  }

  /// A day whose wish is of this kind, from the first list's day on.
  fn a_day_wishing_for(kind: &str) -> String {
    let catalogue = catalogue();
    let none = owned(&catalogue, &[]);
    (0..400)
      .map(|n| (chrono::NaiveDate::from_ymd_opt(2026, 9, 29).expect("date") + chrono::Duration::days(n)).format("%Y-%m-%d").to_string())
      .find(|day| wish_for(&catalogue, day, &none).map(|wish| wish.kind == kind).unwrap_or(false))
      .expect("such a day")
  }

  #[test]
  fn pip_never_wishes_for_what_he_already_had() {
    let catalogue = catalogue();
    let day = a_day_wishing_for("move");
    // The only move on the list, bought the day before: Pip wishes for a snack instead.
    let floss = bought_at("move", "floss", 60, "2026-09-29T09:00:00+00:00");
    let wish = wish_for(&catalogue, &day, &owned(&catalogue, &[floss])).expect("a wish");
    assert_eq!(wish.kind, "treat");
  }

  #[test]
  fn granting_a_wish_pays_once_for_its_day_only() {
    let catalogue = catalogue();
    let day = a_day_wishing_for("room");
    let wish = wish_for(&catalogue, &day, &owned(&catalogue, &[])).expect("a wish");
    let at = |time: &str| format!("{day}T{time}+05:30");
    let granted = bought_at("room", &wish.id, 70, &at("20:15:00"));
    assert_eq!(granted_days(&catalogue, &[granted.clone()]), BTreeSet::from([day.clone()]));

    // Bought, and the wish for that day stays what it was: what was owned
    // before the day began is what it was chosen from.
    let view = wish_today(&catalogue, &[granted.clone()], &day).expect("today's wish");
    assert!(view.granted);
    assert_eq!(view.id, wish.id);

    // Something else that day grants nothing more; the wished thing bought
    // the next day does not grant the day before's wish.
    let snack = bought_at("treat", "apple", 5, &at("21:00:00"));
    assert_eq!(granted_days(&catalogue, &[granted.clone(), snack]).len(), 1);
    let next = chrono::NaiveDate::parse_from_str(&day, "%Y-%m-%d").expect("date").succ_opt().expect("next").format("%Y-%m-%d").to_string();
    let late = bought_at("room", &wish.id, 70, &format!("{next}T08:00:00+05:30"));
    assert!(!granted_days(&catalogue, &[late]).contains(&day));
  }

  #[test]
  fn a_wish_is_granted_on_the_readers_own_day() {
    // 23:30 in India is 18:00 UTC the same day, but 00:30 the next day in
    // Tokyo would be another day: the stamp's own date is the reader's day.
    assert_eq!(record_day("2026-10-02T23:30:00+05:30"), Some("2026-10-02"));
    assert_eq!(record_day("2026-10-03T00:30:00+09:00"), Some("2026-10-03"));
    assert_eq!(record_day("not a time"), None);
  }

  #[test]
  fn granting_cheers_pip_once_a_day() {
    let catalogue = catalogue();
    let day = a_day_wishing_for("treat");
    let wish = wish_today(&catalogue, &[], &day).expect("a wish");
    let first = bought_at("treat", &wish.id, 5, &format!("{day}T10:00:00+00:00"));
    assert!(grants_wish_now(&catalogue, &[], &first, &day));
    let second = bought_at("treat", &wish.id, 5, &format!("{day}T11:00:00+00:00"));
    assert!(!grants_wish_now(&catalogue, &[first], &second, &day), "already granted today");
    let other = bought_at("treat", "duck", 20, &format!("{day}T10:00:00+00:00"));
    assert!(!grants_wish_now(&catalogue, &[], &other, &day));
  }

  #[test]
  fn every_reward_adds_up() {
    let catalogue = catalogue();
    let day = a_day_wishing_for("plant");
    let wish = wish_today(&catalogue, &[], &day).expect("a wish");
    let purchases = vec![
      bought_at("plant", &wish.id, 1, &format!("{day}T10:00:00+00:00")),
      bought("accessory", "cap", 30),
      bought("accessory", "shades", 60),
      bought("accessory", "scarf", 40)
    ];
    let plants = [PlantingIn { id: "p", plot: 1, plant: "radish", planted_at_ms: 0, need: 15.0, yield_seeds: 4 }];
    let garden = grow(&[(10, 20.0)], &plants, &[]);
    let days = HashMap::new();
    let facts = Facts { purchases: &purchases, plantings: 1, garden: &garden, days: &days, longest_focus: 20.0 };
    let all = earned(&catalogue, &facts, &owned(&catalogue, &purchases));
    // Planted, watered, a hat: 10 + 10 + 20. The chest, a set, a wish.
    assert_eq!(all.seeds, RewardSeeds { goals: 40, chest: 30, sets: 25, wishes: 8 });
  }
}
