//! Pip's shop, on the side that decides.
//!
//! The webview asks to buy a thing by kind and id; it never names a price.
//! Prices come from `catalogue.json`, generated from the app's own catalogue
//! (`apps/src/pip/shop.js`) by `apps/scripts/pip-catalogue.mjs`, which the Vite
//! build runs, and compiled into the binary. The alternative (the frontend
//! sends the price, Rust rejects anything below a floor) would still let a
//! devtools console buy a 1,000-seed skin for the floor price, and would make
//! the floor a second, hand-kept price list anyway. With the table here, the
//! only way to change a price is to change the art.
//!
//! Everything below is pure: ownership is derived from the purchases, and the
//! balance from the ledger (see `habit::seeds`) minus the purchases, so there
//! is no counter anywhere to drift.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fmt;
use std::sync::OnceLock;

/// Seeds Pip gives back: first steps, the starter chest, sets, the daily wish.
pub mod rewards;

/// Most accessories worn at once: one per slot.
pub const MAX_OUTFIT: usize = 5;
/// Most entries a house layout may hold (every floor's slots, wallpapers and
/// floors together). The house has a few dozen; this only stops a malformed
/// layout from growing without bound.
pub const MAX_ROOM_SPOTS: usize = 256;
/// Longest layout key: `level/slot`.
const MAX_SPOT_KEY: usize = 64;

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
  pub kind: String,
  pub id: String,
  pub price: i64,
  /// An achievement: shown, never sold.
  #[serde(default)]
  pub earned_only: bool,
  /// Food: bought each time it is given, never owned.
  #[serde(default)]
  pub consumable: bool,
  /// How much a treat cheers Pip up.
  #[serde(default)]
  pub mood: f64,
  /// Where an accessory is worn.
  #[serde(default)]
  pub slot: Option<String>,
  /// Another item of the same kind that must be owned first (the floor below,
  /// the plot before).
  #[serde(default)]
  pub requires: Option<String>,
  /// Focus sessions the reader must have done first.
  #[serde(default)]
  pub sessions: i64,
  /// A plant: the water (minutes of focus) it needs to ripen...
  #[serde(default)]
  pub water: f64,
  /// ...and the seeds a harvest gives.
  #[serde(default, rename = "yield")]
  pub yield_seeds: i64,
  /// A room item that lights a room: the "place a lamp" first step counts it.
  #[serde(default)]
  pub light: bool,
  /// A floor's starter piece: owned once that floor (a "level") is, and
  /// never sold on its own. Its price says what it is worth.
  #[serde(default)]
  pub free_with: Option<String>
}

impl Item {
  /// Owned from the start without buying.
  fn free(&self) -> bool {
    self.price == 0 && !self.earned_only && !self.consumable && self.free_with.is_none()
  }
}

#[derive(Deserialize)]
struct CatalogueFile {
  items: Vec<Item>,
  #[serde(flatten)]
  rewards: rewards::Rewards
}

pub struct Catalogue {
  items: HashMap<(String, String), Item>,
  /// What rewards pay (the rules are in `rewards`).
  rewards: rewards::Rewards
}

impl Catalogue {
  pub fn parse(json: &str) -> Result<Self, String> {
    let file: CatalogueFile = serde_json::from_str(json).map_err(|e| format!("Pip catalogue: {e}"))?;
    let mut items = HashMap::new();
    for item in file.items {
      if item.price < 0 {
        return Err(format!("Pip catalogue: {} {} has a negative price", item.kind, item.id));
      }
      let key = (item.kind.clone(), item.id.clone());
      if items.insert(key, item).is_some() {
        return Err("Pip catalogue: an item is listed twice".to_string());
      }
    }
    Ok(Self { items, rewards: file.rewards })
  }

  /// What the first steps, the chest, sets and the daily wish pay.
  pub fn rewards(&self) -> &rewards::Rewards {
    &self.rewards
  }

  /// The catalogue compiled into this build.
  pub fn bundled() -> &'static Catalogue {
    static BUNDLED: OnceLock<Catalogue> = OnceLock::new();
    BUNDLED.get_or_init(|| Catalogue::parse(include_str!("catalogue.json")).expect("the bundled Pip catalogue parses"))
  }

  pub fn get(&self, kind: &str, id: &str) -> Option<&Item> {
    self.items.get(&(kind.to_string(), id.to_string()))
  }

  pub fn items(&self) -> impl Iterator<Item = &Item> {
    self.items.values()
  }
}

/// One purchase: the spending ledger. Append-only, and unique by `id` so two
/// devices' purchases merge as a plain union.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct Purchase {
  pub id: String,
  pub item_kind: String,
  pub item_id: String,
  /// What it cost at the time. A later price change never rewrites history.
  pub price: i64,
  pub bought_at: String
}

/// Seeds spent. Food and seed packets count every time; anything kept (a skin,
/// a chair) counts once, however many records say it was bought: two devices
/// offline can each buy the same thing, and a sync must not charge twice.
pub fn spent(catalogue: &Catalogue, purchases: &[Purchase]) -> i64 {
  let mut ordered: Vec<&Purchase> = purchases.iter().collect();
  ordered.sort_by(|a, b| a.bought_at.cmp(&b.bought_at).then_with(|| a.id.cmp(&b.id)));
  let mut kept: BTreeSet<(&str, &str)> = BTreeSet::new();
  ordered
    .into_iter()
    .filter(|purchase| {
      let consumable = catalogue
        .get(&purchase.item_kind, &purchase.item_id)
        .map(|item| item.consumable)
        .unwrap_or(false);
      consumable || kept.insert((purchase.item_kind.as_str(), purchase.item_id.as_str()))
    })
    .map(|purchase| purchase.price.max(0))
    .sum()
}

/// What the reader owns: everything free, plus everything bought except food,
/// which was eaten, plus each owned floor's starter pieces. Something bought
/// and later dropped from the catalogue stays owned; it simply has nowhere to
/// show.
pub fn owned(catalogue: &Catalogue, purchases: &[Purchase]) -> BTreeSet<(String, String)> {
  let mut owned = owned_free(catalogue);
  for purchase in purchases {
    own(catalogue, &mut owned, purchase);
  }
  owned
}

/// What every reader owns before buying anything: the free things, and the
/// starter pieces of the free floors (the bedroom, the garden).
pub(crate) fn owned_free(catalogue: &Catalogue) -> BTreeSet<(String, String)> {
  let mut owned: BTreeSet<(String, String)> = catalogue
    .items()
    .filter(|item| item.free())
    .map(|item| (item.kind.clone(), item.id.clone()))
    .collect();
  let floors: Vec<String> = owned.iter().filter(|(kind, _)| kind == "level").map(|(_, id)| id.clone()).collect();
  for floor in floors {
    add_starter_pieces(catalogue, &mut owned, &floor);
  }
  owned
}

/// Adds one purchase to what is owned: food is eaten, and a floor brings its
/// starter pieces with it.
pub(crate) fn own(catalogue: &Catalogue, owned: &mut BTreeSet<(String, String)>, purchase: &Purchase) {
  let consumable = catalogue
    .get(&purchase.item_kind, &purchase.item_id)
    .map(|item| item.consumable)
    .unwrap_or(false);
  if consumable {
    return;
  }
  owned.insert((purchase.item_kind.clone(), purchase.item_id.clone()));
  if purchase.item_kind == "level" {
    add_starter_pieces(catalogue, owned, &purchase.item_id);
  }
}

fn add_starter_pieces(catalogue: &Catalogue, owned: &mut BTreeSet<(String, String)>, floor: &str) {
  for item in catalogue.items().filter(|item| item.free_with.as_deref() == Some(floor)) {
    owned.insert((item.kind.clone(), item.id.clone()));
  }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShopError {
  Unknown,
  NotForSale,
  AlreadyOwned,
  /// Food is bought as it is given (`pip_feed`), not stocked.
  GiveInstead,
  NotOwned,
  CannotAfford { short: i64 },
  /// The floor below (or the plot before) comes first.
  NeedsFirst,
  /// So many focus sessions come first.
  NeedsSessions { left: i64 },
  /// A floor's starter piece: it comes with the floor, not from the shop.
  ComesWithFloor
}

impl fmt::Display for ShopError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      ShopError::Unknown => write!(f, "That isn't in Pip's shop."),
      ShopError::NotForSale => write!(f, "That one can't be bought. It's earned by reading."),
      ShopError::AlreadyOwned => write!(f, "Pip already has that."),
      ShopError::GiveInstead => write!(f, "Snacks and seed packets are bought as you use them."),
      ShopError::NeedsFirst => write!(f, "That opens once the one before it is Pip's."),
      ShopError::NeedsSessions { left } => {
        write!(f, "That opens after {left} more focus session{}.", if *left == 1 { "" } else { "s" })
      }
      ShopError::NotOwned => write!(f, "Pip doesn't have that yet."),
      ShopError::CannotAfford { short } => write!(f, "{short} more seeds needed. Read in focus to earn them."),
      ShopError::ComesWithFloor => write!(f, "That one comes free with its floor of the house.")
    }
  }
}

/// Whether a thing can be bought now, and at what price.
pub fn check_buy<'a>(
  catalogue: &'a Catalogue,
  owned: &BTreeSet<(String, String)>,
  balance: i64,
  sessions_done: i64,
  kind: &str,
  id: &str
) -> Result<&'a Item, ShopError> {
  let item = catalogue.get(kind, id).ok_or(ShopError::Unknown)?;
  if item.earned_only {
    return Err(ShopError::NotForSale);
  }
  if item.consumable {
    return Err(ShopError::GiveInstead);
  }
  if item.free() || owned.contains(&(kind.to_string(), id.to_string())) {
    return Err(ShopError::AlreadyOwned);
  }
  // Buying it now would be paying for what the floor will bring anyway.
  if item.free_with.is_some() {
    return Err(ShopError::ComesWithFloor);
  }
  if let Some(first) = &item.requires {
    if !owned.contains(&(kind.to_string(), first.clone())) {
      return Err(ShopError::NeedsFirst);
    }
  }
  if sessions_done < item.sessions {
    return Err(ShopError::NeedsSessions { left: item.sessions - sessions_done });
  }
  if balance < item.price {
    return Err(ShopError::CannotAfford { short: item.price - balance });
  }
  Ok(item)
}

/// Giving Pip a treat: food is paid for on the spot, a toy must be owned.
/// Returns the treat and what it costs now.
pub fn check_give<'a>(
  catalogue: &'a Catalogue,
  owned: &BTreeSet<(String, String)>,
  balance: i64,
  id: &str
) -> Result<(&'a Item, i64), ShopError> {
  let item = catalogue.get("treat", id).ok_or(ShopError::Unknown)?;
  if item.consumable {
    if balance < item.price {
      return Err(ShopError::CannotAfford { short: item.price - balance });
    }
    return Ok((item, item.price));
  }
  if !owned.contains(&("treat".to_string(), id.to_string())) {
    return Err(ShopError::NotOwned);
  }
  Ok((item, 0))
}

// ---- the garden -------------------------------------------------------------
//
// Plantings and harvests are records, like purchases: append-only, with
// random ids, merged as a union. How far each plant has grown is never stored;
// `habit::seeds::grow` replays the water (reading) against them.

/// Plots every garden has; more are bought (`plot-4`, `plot-5`, ...).
pub const FREE_PLOTS: i64 = 3;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct Planting {
  /// The same id as the seed-packet purchase that paid for it.
  pub id: String,
  pub plot: i64,
  pub plant: String,
  pub planted_at: String
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct Harvest {
  pub id: String,
  pub planting_id: String,
  /// The plant's yield when picked. The balance never counts more than the
  /// plant gives. A harvest is only recorded once Rust has seen the plant ripe,
  /// so a recorded harvest is final (see `habit::seeds::grow`).
  pub seeds: i64,
  pub harvested_at: String
}

/// How many plots the reader's garden has.
pub fn plot_count(owned: &BTreeSet<(String, String)>) -> i64 {
  FREE_PLOTS + owned.iter().filter(|(kind, _)| kind == "plot").count() as i64
}

/// Pip's look and home, as saved. Mood is Pip's own and changes only through
/// reading and treats; the rest is the reader's choice.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipState {
  /// The skin (variant) Pip wears.
  pub variant: String,
  /// Accessory ids, worn over the variant.
  pub outfit: Vec<String>,
  /// Room spot id -> room item id. Each item has one spot in the room art,
  /// so today a spot is named after its item (see `starter_room`); the map
  /// leaves room for items that can go in more than one place.
  pub room: BTreeMap<String, String>,
  /// "" for the room's default style.
  pub room_style: String,
  /// 0..100, as of `mood_updated_at`; drifts down from there.
  pub mood: f64,
  pub mood_updated_at: String,
  /// The signature idle: the move on the profile picture.
  pub signature: String,
  /// When any of this last changed, for the sync merge.
  pub updated_at: String
}

impl PipState {
  pub fn fresh(now: &str) -> Self {
    PipState {
      variant: "sprout".to_string(),
      outfit: Vec::new(),
      room: BTreeMap::new(),
      room_style: String::new(),
      mood: crate::habit::seeds::MOOD_START,
      mood_updated_at: now.to_string(),
      signature: "read".to_string(),
      updated_at: now.to_string()
    }
  }
}

/// A new room: the free (starter) room items put out, each at its own spot.
/// Every item has one place in the room (the art's `at`), so the layout maps
/// an item's id to itself; arranging the room is choosing what is out.
pub fn starter_room(catalogue: &Catalogue) -> BTreeMap<String, String> {
  catalogue
    .items()
    .filter(|item| item.kind == "room" && item.free())
    .map(|item| (item.id.clone(), item.id.clone()))
    .collect()
}

/// The part of the state the reader sets from the Pip tab.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipLook {
  pub variant: String,
  pub outfit: Vec<String>,
  pub room: BTreeMap<String, String>,
  pub room_style: String,
  pub signature: String
}

/// Refuses a look that uses anything the reader does not own. The frontend
/// only offers owned things; this keeps a stale tab or a devtools call from
/// dressing Pip in the shop's stock for free.
pub fn check_look(catalogue: &Catalogue, owned: &BTreeSet<(String, String)>, look: &PipLook) -> Result<(), String> {
  let has = |kind: &str, id: &str| owned.contains(&(kind.to_string(), id.to_string()));

  if !has("skin", &look.variant) {
    return Err("Pip doesn't have that outfit yet.".to_string());
  }
  if look.outfit.len() > MAX_OUTFIT {
    return Err("Pip can only wear one thing per slot.".to_string());
  }
  let mut slots = HashSet::new();
  let mut seen = HashSet::new();
  for id in &look.outfit {
    if !has("accessory", id) || !seen.insert(id) {
      return Err("Pip doesn't have that accessory yet.".to_string());
    }
    // Unknown slot (an accessory since removed from the art) still takes a
    // slot of its own, so it cannot be used to wear two hats.
    let slot = catalogue
      .get("accessory", id)
      .and_then(|item| item.slot.clone())
      .unwrap_or_else(|| format!("?{id}"));
    if !slots.insert(slot) {
      return Err("Pip can only wear one thing per slot.".to_string());
    }
  }
  if look.room.len() > MAX_ROOM_SPOTS {
    return Err("That's more than the house holds.".to_string());
  }
  // The house layout, one map for every floor:
  //   `level/slot`       -> a room item placed in that slot
  //   `level/@wallpaper` -> that floor's wallpaper
  //   `level/@floor`     -> that floor's flooring
  //   `item`             -> a room item in the single-room layout from before
  //                         the house had floors (the item's own spot)
  // Everything must be owned, the floor included, and an item is in one place
  // at a time: owning one lamp does not light two rooms.
  let mut placed = HashSet::new();
  for (key, id) in &look.room {
    if key.is_empty() || key.len() > MAX_SPOT_KEY {
      return Err("Pip doesn't have that for the house yet.".to_string());
    }
    let (kind, level) = match key.split_once('/') {
      None => ("room", None),
      Some((level, "@wallpaper")) => ("wallpaper", Some(level)),
      Some((level, "@floor")) => ("flooring", Some(level)),
      Some((level, slot)) if !slot.is_empty() && !slot.starts_with('@') => ("room", Some(level)),
      Some(_) => return Err("Pip doesn't have that for the house yet.".to_string())
    };
    if let Some(level) = level {
      if !has("level", level) {
        return Err("That floor of the house isn't open yet.".to_string());
      }
    }
    if !has(kind, id) || (kind == "room" && !placed.insert(id)) {
      return Err("Pip doesn't have that for the house yet.".to_string());
    }
  }
  if !look.room_style.is_empty() && !has("style", &look.room_style) {
    return Err("Pip doesn't have that room style yet.".to_string());
  }
  if !has("move", &look.signature) {
    return Err("Pip hasn't learned that move yet.".to_string());
  }
  Ok(())
}

// ---- the arcade -------------------------------------------------------------
//
// Mini-games in the Attic Arcade. They never mint seeds: the currency stays
// tied to reading in focus, or the shop would reward the arcade over the
// books. A finished game cheers Pip up a little, capped per day, and the best
// score per game is kept.

/// The games there are. Anything else is refused.
pub const GAMES: [&str; 3] = ["dash", "catch", "flap"];
/// What one finished game adds to Pip's mood...
pub const MOOD_PER_GAME: f64 = 3.0;
/// ...and the most games can add in a day.
pub const GAME_MOOD_PER_DAY: f64 = 12.0;
/// No honest run gets near this; it only bounds what is stored.
pub const MAX_SCORE: i64 = 10_000_000;

/// Best scores, and how much mood games have given today.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Arcade {
  pub best: BTreeMap<String, i64>,
  /// Local day `mood_today` belongs to.
  pub day: String,
  pub mood_today: f64
}

/// What a finished game changed.
#[derive(Debug, Clone, PartialEq)]
pub struct GameResult {
  pub arcade: Arcade,
  /// Mood to add now; 0 once today's cap is reached.
  pub mood: f64,
  pub new_best: bool
}

/// Records a finished game. `today` is the reader's local date, as for the
/// streak: the cap resets at their midnight, not UTC's.
pub fn record_game(arcade: &Arcade, today: &str, game: &str, score: i64) -> Result<GameResult, String> {
  if !GAMES.contains(&game) {
    return Err("That isn't one of the arcade's games.".to_string());
  }
  let score = score.clamp(0, MAX_SCORE);
  let mut next = arcade.clone();
  if next.day != today {
    next.day = today.to_string();
    next.mood_today = 0.0;
  }
  // A game that ended before it began (score 0) is a mis-tap, not play.
  let mood = if score > 0 {
    MOOD_PER_GAME.min(GAME_MOOD_PER_DAY - next.mood_today).max(0.0)
  } else {
    0.0
  };
  next.mood_today += mood;
  let previous = next.best.get(game).copied().unwrap_or(0);
  let new_best = score > previous;
  if new_best {
    next.best.insert(game.to_string(), score);
  }
  Ok(GameResult { arcade: next, mood, new_best })
}

// ---- playing with Pip ---------------------------------------------------------
//
// Stroking Pip, tickling her, throwing the ball, tossing her in the air: play
// by hand, in the Pip tab. Like the arcade's games it cheers her up a little
// and never pays seeds, and it draws on the *same* daily allowance
// (`GAME_MOOD_PER_DAY`): an afternoon of petting adds no more mood than an
// afternoon of games did before, so the economy of snacks is as it was.

/// The ways of playing there are. Anything else is refused.
pub const PLAYS: [&str; 5] = ["pet", "tickle", "fetch", "toss", "dance"];
/// What one bout of play adds to Pip's mood, out of the day's allowance.
pub const MOOD_PER_PLAY: f64 = 1.0;
/// What picking a ripe plant adds.
pub const MOOD_PER_HARVEST: f64 = 2.0;

/// Records a bout of play: the mood to add now (0 once today's allowance,
/// shared with the games, is used up) and the allowance after it.
pub fn record_play(arcade: &Arcade, today: &str, kind: &str) -> Result<(Arcade, f64), String> {
  if !PLAYS.contains(&kind) {
    return Err("That isn't a way of playing with Pip.".to_string());
  }
  let mut next = arcade.clone();
  if next.day != today {
    next.day = today.to_string();
    next.mood_today = 0.0;
  }
  let mood = MOOD_PER_PLAY.min(GAME_MOOD_PER_DAY - next.mood_today).max(0.0);
  next.mood_today += mood;
  Ok((next, mood))
}

// ---- reading cheers Pip up ----------------------------------------------------
//
// Any reading counts, in a focus session or not: each minute the ledger takes
// cheers Pip up a little, up to a day's allowance. A finished focus session
// still adds its own `MOOD_PER_SESSION` on top. Its own allowance, apart from
// the games' and play's, and never seeds: those are the ledger's business.

/// What a minute of reading adds to Pip's mood: twenty minutes is what a
/// focus session adds.
pub const MOOD_PER_READING_MINUTE: f64 = 0.25;
/// The most reading can add in a day, by the day the minutes are credited to.
pub const READING_MOOD_PER_DAY: f64 = 10.0;
/// How many days' allowances are remembered: the latest read on, and the one
/// before it (the ledger takes a late minute for yesterday, and no older).
const READING_MOOD_DAYS_KEPT: usize = 2;

/// How much mood reading has given, by local day ("2026-10-03").
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingMood {
  /// The latest days read on, and what reading has added on each.
  #[serde(default)]
  pub days: BTreeMap<String, f64>
}

impl ReadingMood {
  /// What reading has added on `day`, out of `READING_MOOD_PER_DAY`.
  pub fn given_on(&self, day: &str) -> f64 {
    self.days.get(day).map(|given| spent_of_the_day(*given)).unwrap_or(0.0)
  }
}

/// A stored amount, kept to what a day can hold (a row edited by hand, or
/// one that will not read as a number, is not a bigger allowance).
fn spent_of_the_day(given: f64) -> f64 {
  given.max(0.0).min(READING_MOOD_PER_DAY)
}

/// Records minutes of reading credited to `day` (the reader's local date, as
/// the ledger keys days): the mood to add now (0 once that day's allowance is
/// used up) and the allowances after it.
///
/// Each day has its own allowance, and a day gets one only once. The two
/// latest days are remembered, so a minute credited late to yesterday draws
/// on what yesterday has left, not on a fresh allowance and not on today's;
/// a day older than both adds nothing. Days only ever leave from the old end,
/// so going back and forth between days never hands out a second allowance.
pub fn record_reading(reading: &ReadingMood, day: &str, minutes: f64) -> (ReadingMood, f64) {
  let wanted = minutes * MOOD_PER_READING_MINUTE;
  // No minutes, minutes that are not a number, or a day that is not a date.
  let Ok(date) = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d") else {
    return (reading.clone(), 0.0);
  };
  if wanted.is_nan() || wanted <= 0.0 {
    return (reading.clone(), 0.0);
  }
  let day = date.format("%Y-%m-%d").to_string();
  let mut next = reading.clone();
  if !next.days.contains_key(&day) {
    let oldest = next.days.keys().next().cloned();
    let full = next.days.len() >= READING_MOOD_DAYS_KEPT;
    if full && oldest.is_some_and(|oldest| day < oldest) {
      // Older than every day remembered: its allowance was let go of.
      return (next, 0.0);
    }
    next.days.insert(day.clone(), 0.0);
    while next.days.len() > READING_MOOD_DAYS_KEPT {
      next.days.pop_first();
    }
  }
  let given = next.given_on(&day);
  let mood = wanted.min(READING_MOOD_PER_DAY - given).max(0.0);
  next.days.insert(day, given + mood);
  (next, mood)
}

// ---- why Pip feels as she does ----------------------------------------------
//
// The last few things that cheered Pip up, so the Pip tab can say what moved
// her mood and when, instead of leaving the reader to guess. This device's
// alone (a settings row, like the arcade's scores): it explains, it is never
// read back into the mood, and nothing is bought with it.

/// How many events are kept.
pub const MOOD_LOG_KEPT: usize = 12;
/// The same cause again within this long joins the entry before it (ten
/// strokes are one petting, not ten lines).
const MOOD_LOG_JOIN_MS: i64 = 10 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoodEvent {
  /// When, RFC 3339.
  pub at: String,
  /// "reading", "session", "treat:<id>", "harvest", "game:<id>", "play:<kind>" or "wish".
  pub cause: String,
  /// How much the mood actually rose (less than the rule says at the top of the scale).
  pub gain: f64,
  /// The mood afterwards.
  pub mood: f64
}

fn stamp_ms(value: &str) -> i64 {
  chrono::DateTime::parse_from_rfc3339(value).map(|at| at.timestamp_millis()).unwrap_or(0)
}

/// The log with one more event, oldest first. An event that raised nothing
/// (Pip was already as happy as she gets) is not an event.
pub fn log_mood(log: &[MoodEvent], event: MoodEvent) -> Vec<MoodEvent> {
  let mut next = log.to_vec();
  if event.gain <= 0.0 {
    return next;
  }
  match next.last_mut() {
    Some(last) if last.cause == event.cause && (stamp_ms(&event.at) - stamp_ms(&last.at)).abs() <= MOOD_LOG_JOIN_MS => {
      last.gain += event.gain;
      last.mood = event.mood;
      last.at = event.at;
    }
    _ => next.push(event)
  }
  let extra = next.len().saturating_sub(MOOD_LOG_KEPT);
  next.drain(..extra);
  next
}

/// A fresh purchase id: random, so two devices never mint the same one.
pub fn new_purchase_id() -> String {
  use ring::rand::SecureRandom;
  let mut bytes = [0u8; 12];
  if ring::rand::SystemRandom::new().fill(&mut bytes).is_err() {
    // No system randomness is vanishingly unlikely; the clock still keeps
    // this device's ids apart from each other.
    let nanos = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
    bytes[..8].copy_from_slice(&nanos.to_le_bytes());
  }
  format!("buy-{}", hex::encode(bytes))
}

#[cfg(test)]
mod tests {
  use super::*;

  const JSON: &str = r#"{ "items": [
    {"kind":"skin","id":"sprout","price":0},
    {"kind":"skin","id":"golden","price":0,"earnedOnly":true},
    {"kind":"skin","id":"robot","price":700},
    {"kind":"accessory","id":"tophat","price":120,"slot":"head"},
    {"kind":"accessory","id":"crown","price":300,"slot":"head"},
    {"kind":"accessory","id":"scarf","price":80,"slot":"neck"},
    {"kind":"room","id":"lamp","price":90},
    {"kind":"style","id":"cozy","price":0},
    {"kind":"style","id":"space","price":400},
    {"kind":"treat","id":"apple","price":10,"consumable":true,"mood":8},
    {"kind":"treat","id":"ball","price":60,"mood":12},
    {"kind":"move","id":"read","price":0},
    {"kind":"move","id":"moonwalk","price":400}
  ] }"#;

  fn catalogue() -> Catalogue {
    Catalogue::parse(JSON).expect("parses")
  }

  fn bought(kind: &str, id: &str, price: i64) -> Purchase {
    Purchase {
      id: format!("buy-{kind}-{id}"),
      item_kind: kind.to_string(),
      item_id: id.to_string(),
      price,
      bought_at: "2026-09-01T10:00:00Z".to_string()
    }
  }

  fn look(variant: &str, outfit: &[&str], signature: &str) -> PipLook {
    PipLook {
      variant: variant.to_string(),
      outfit: outfit.iter().map(|id| id.to_string()).collect(),
      room: BTreeMap::new(),
      room_style: String::new(),
      signature: signature.to_string()
    }
  }

  #[test]
  fn the_bundled_catalogue_parses_and_is_sane() {
    let bundled = Catalogue::bundled();
    assert!(bundled.get("skin", "sprout").is_some(), "the starter skin is in the catalogue");
    assert!(bundled.get("move", "read").map(|item| item.price == 0).unwrap_or(false), "the default signature is free");
    for item in bundled.items() {
      assert!(item.price >= 0);
      if item.kind == "move" && item.price > 0 {
        assert!((50..=600).contains(&item.price), "moves cost 50 to 600, {} costs {}", item.id, item.price);
      }
      if item.kind == "accessory" {
        assert!(item.slot.is_some(), "accessory {} has a slot", item.id);
      }
      if item.kind == "plant" {
        assert!(item.consumable && item.water > 0.0 && item.yield_seeds > item.price, "plant {} pays for itself", item.id);
      }
    }
  }

  #[test]
  fn a_duplicate_or_negative_price_is_refused() {
    assert!(Catalogue::parse(r#"{"items":[{"kind":"skin","id":"a","price":1},{"kind":"skin","id":"a","price":2}]}"#).is_err());
    assert!(Catalogue::parse(r#"{"items":[{"kind":"skin","id":"a","price":-1}]}"#).is_err());
  }

  #[test]
  fn free_things_are_owned_and_bought_things_join_them() {
    let catalogue = catalogue();
    let owned = owned(&catalogue, &[bought("skin", "robot", 700), bought("treat", "apple", 10)]);
    assert!(owned.contains(&("skin".into(), "sprout".into())));
    assert!(owned.contains(&("skin".into(), "robot".into())));
    assert!(!owned.contains(&("skin".into(), "golden".into())), "achievements are not free");
    assert!(!owned.contains(&("treat".into(), "apple".into())), "food is eaten, not owned");
  }

  #[test]
  fn the_price_comes_from_the_catalogue() {
    let catalogue = catalogue();
    let owned = owned(&catalogue, &[]);
    let item = check_buy(&catalogue, &owned, 1_000, 0, "skin", "robot").expect("buyable");
    assert_eq!(item.price, 700);
  }

  #[test]
  fn buying_refuses_what_it_should() {
    let catalogue = catalogue();
    let owned = owned(&catalogue, &[bought("accessory", "tophat", 120)]);
    assert_eq!(check_buy(&catalogue, &owned, 999, 0, "skin", "nope"), Err(ShopError::Unknown));
    assert_eq!(check_buy(&catalogue, &owned, 999, 0, "skin", "golden"), Err(ShopError::NotForSale));
    assert_eq!(check_buy(&catalogue, &owned, 999, 0, "skin", "sprout"), Err(ShopError::AlreadyOwned));
    assert_eq!(check_buy(&catalogue, &owned, 999, 0, "accessory", "tophat"), Err(ShopError::AlreadyOwned));
    assert_eq!(check_buy(&catalogue, &owned, 999, 0, "treat", "apple"), Err(ShopError::GiveInstead));
    assert_eq!(
      check_buy(&catalogue, &owned, 100, 0, "move", "moonwalk"),
      Err(ShopError::CannotAfford { short: 300 })
    );
  }

  #[test]
  fn food_is_paid_for_each_time_and_toys_once() {
    let catalogue = catalogue();
    let none = owned(&catalogue, &[]);
    assert_eq!(check_give(&catalogue, &none, 50, "apple").map(|(_, cost)| cost), Ok(10));
    assert_eq!(check_give(&catalogue, &none, 5, "apple").map(|(_, cost)| cost), Err(ShopError::CannotAfford { short: 5 }));
    assert_eq!(check_give(&catalogue, &none, 500, "ball").map(|(_, cost)| cost), Err(ShopError::NotOwned));
    let with_ball = owned(&catalogue, &[bought("treat", "ball", 60)]);
    assert_eq!(check_give(&catalogue, &with_ball, 0, "ball").map(|(_, cost)| cost), Ok(0));
  }

  #[test]
  fn spending_is_the_sum_of_purchases() {
    assert_eq!(spent(&catalogue(), &[bought("skin", "robot", 700), bought("treat", "apple", 10)]), 710);
    assert_eq!(spent(&catalogue(), &[]), 0);
    // The same skin bought on two devices before they synced: paid once.
    let mut twice = bought("skin", "robot", 700);
    twice.id = "other-device".into();
    assert_eq!(spent(&catalogue(), &[bought("skin", "robot", 700), twice]), 700);
    // Food is eaten, so buying it twice is two purchases.
    let mut second_apple = bought("treat", "apple", 10);
    second_apple.id = "second".into();
    assert_eq!(spent(&catalogue(), &[bought("treat", "apple", 10), second_apple]), 20);
  }

  #[test]
  fn a_look_may_only_use_owned_things() {
    let catalogue = catalogue();
    let owned = owned(
      &catalogue,
      &[bought("accessory", "tophat", 120), bought("accessory", "scarf", 80), bought("room", "lamp", 90)]
    );
    assert!(check_look(&catalogue, &owned, &look("sprout", &["tophat", "scarf"], "read")).is_ok());
    assert!(check_look(&catalogue, &owned, &look("robot", &[], "read")).is_err(), "not bought");
    assert!(check_look(&catalogue, &owned, &look("golden", &[], "read")).is_err(), "not earned");
    assert!(check_look(&catalogue, &owned, &look("sprout", &["crown"], "read")).is_err());
    assert!(check_look(&catalogue, &owned, &look("sprout", &[], "moonwalk")).is_err(), "move not learned");

    let mut room = look("sprout", &[], "read");
    room.room.insert("ceiling".into(), "lamp".into());
    assert!(check_look(&catalogue, &owned, &room).is_ok());
    room.room.insert("left".into(), "lamp".into());
    assert!(check_look(&catalogue, &owned, &room).is_err(), "one lamp cannot be in two places");

    let mut styled = look("sprout", &[], "read");
    styled.room_style = "space".into();
    assert!(check_look(&catalogue, &owned, &styled).is_err());
    styled.room_style = "cozy".into();
    assert!(check_look(&catalogue, &owned, &styled).is_ok());
  }

  #[test]
  fn a_new_room_has_the_free_things_out() {
    let room = starter_room(&catalogue());
    assert!(room.is_empty(), "the fixture has no free room items");
    let with_bed = Catalogue::parse(r#"{"items":[{"kind":"room","id":"bed","price":0},{"kind":"room","id":"lamp","price":90}]}"#)
      .expect("parses");
    let room = starter_room(&with_bed);
    assert_eq!(room.get("bed").map(String::as_str), Some("bed"));
    assert!(!room.contains_key("lamp"));
  }

  #[test]
  fn one_accessory_per_slot() {
    let catalogue = catalogue();
    let owned = owned(&catalogue, &[bought("accessory", "tophat", 120), bought("accessory", "crown", 300)]);
    assert!(check_look(&catalogue, &owned, &look("sprout", &["tophat", "crown"], "read")).is_err());
    assert!(check_look(&catalogue, &owned, &look("sprout", &["tophat", "tophat"], "read")).is_err());
  }

  fn house() -> Catalogue {
    Catalogue::parse(
      r#"{ "items": [
        {"kind":"skin","id":"sprout","price":0},
        {"kind":"move","id":"read","price":0},
        {"kind":"level","id":"bedroom","price":0},
        {"kind":"level","id":"kitchen","price":400},
        {"kind":"level","id":"observatory","price":0,"earnedOnly":true},
        {"kind":"room","id":"bulb","price":40},
        {"kind":"room","id":"bed","price":0},
        {"kind":"wallpaper","id":"stripes","price":0},
        {"kind":"wallpaper","id":"stars","price":150},
        {"kind":"flooring","id":"oak","price":0}
      ] }"#
    )
    .expect("parses")
  }

  #[test]
  fn a_house_layout_uses_only_owned_floors_and_things() {
    let catalogue = house();
    let none = owned(&catalogue, &[]);
    let mut look = look("sprout", &[], "read");
    look.room.insert("bedroom/bed-spot".into(), "bed".into());
    look.room.insert("bedroom/@wallpaper".into(), "stripes".into());
    look.room.insert("bedroom/@floor".into(), "oak".into());
    assert!(check_look(&catalogue, &none, &look).is_ok(), "the free floor, free things");

    let mut kitchen = look.clone();
    kitchen.room.insert("kitchen/@floor".into(), "oak".into());
    assert!(check_look(&catalogue, &none, &kitchen).is_err(), "the kitchen is not bought");
    let with_kitchen = owned(&catalogue, &[bought("level", "kitchen", 400)]);
    assert!(check_look(&catalogue, &with_kitchen, &kitchen).is_ok());

    let mut stars = look.clone();
    stars.room.insert("bedroom/@wallpaper".into(), "stars".into());
    assert!(check_look(&catalogue, &none, &stars).is_err(), "wallpaper not bought");

    let mut earned = look.clone();
    earned.room.insert("observatory/@floor".into(), "oak".into());
    assert!(check_look(&catalogue, &none, &earned).is_err(), "an earned floor is not free");

    let mut wrong_kind = look.clone();
    wrong_kind.room.insert("bedroom/window".into(), "stripes".into());
    assert!(check_look(&catalogue, &none, &wrong_kind).is_err(), "a wallpaper is not a room item");
    let mut bad_key = look.clone();
    bad_key.room.insert("bedroom/@ceiling".into(), "oak".into());
    assert!(check_look(&catalogue, &none, &bad_key).is_err());
  }

  #[test]
  fn one_bulb_lights_one_room() {
    let catalogue = house();
    let owned = owned(&catalogue, &[bought("room", "bulb", 40), bought("level", "kitchen", 400)]);
    let mut look = look("sprout", &[], "read");
    look.room.insert("bedroom/ceiling".into(), "bulb".into());
    assert!(check_look(&catalogue, &owned, &look).is_ok());
    look.room.insert("kitchen/ceiling".into(), "bulb".into());
    assert!(check_look(&catalogue, &owned, &look).is_err());
  }

  #[test]
  fn games_cheer_pip_up_a_little_a_day_and_never_pay() {
    let mut arcade = Arcade::default();
    let mut total = 0.0;
    for run in 0..10 {
      let result = record_game(&arcade, "2026-09-27", "dash", 100 + run).expect("a game");
      total += result.mood;
      arcade = result.arcade;
    }
    assert_eq!(total, GAME_MOOD_PER_DAY, "capped per day");
    let tomorrow = record_game(&arcade, "2026-09-28", "flap", 5).expect("a game");
    assert_eq!(tomorrow.mood, MOOD_PER_GAME, "the cap resets on the reader's next day");
    assert_eq!(tomorrow.arcade.best.get("dash"), Some(&109));
  }

  #[test]
  fn play_cheers_pip_up_out_of_the_games_allowance() {
    let mut arcade = Arcade::default();
    let mut total = 0.0;
    for _ in 0..40 {
      let (next, mood) = record_play(&arcade, "2026-10-03", "pet").expect("play");
      total += mood;
      arcade = next;
    }
    assert_eq!(total, GAME_MOOD_PER_DAY, "play and games share one allowance a day");
    // The allowance is used up: a game now adds nothing either.
    assert_eq!(record_game(&arcade, "2026-10-03", "dash", 50).expect("a game").mood, 0.0);
    // And the other way: games first leave less for play.
    let mut after_games = Arcade::default();
    for _ in 0..3 {
      after_games = record_game(&after_games, "2026-10-03", "dash", 50).expect("a game").arcade;
    }
    let (_, left) = record_play(&after_games, "2026-10-03", "fetch").expect("play");
    assert_eq!(left, MOOD_PER_PLAY);
    assert_eq!(after_games.mood_today, 3.0 * MOOD_PER_GAME);
    // Tomorrow it starts again, and best scores are untouched by play.
    let (tomorrow, mood) = record_play(&arcade, "2026-10-04", "toss").expect("play");
    assert_eq!((mood, tomorrow.mood_today), (MOOD_PER_PLAY, MOOD_PER_PLAY));
    assert!(tomorrow.best.is_empty());
    assert!(record_play(&arcade, "2026-10-03", "bribe").is_err());
  }

  /// Minute after minute of reading credited to one day.
  fn read_on(reading: &ReadingMood, day: &str, credits: &[f64]) -> (ReadingMood, f64) {
    credits.iter().fold((reading.clone(), 0.0), |(reading, total), minutes| {
      let (next, mood) = record_reading(&reading, day, *minutes);
      (next, total + mood)
    })
  }

  #[test]
  fn reading_cheers_pip_up_by_the_minute() {
    let (reading, mood) = record_reading(&ReadingMood::default(), "2026-10-03", 1.0);
    assert_eq!(mood, MOOD_PER_READING_MINUTE);
    assert_eq!(reading.given_on("2026-10-03"), 0.25);
    // Part of a minute is part of a quarter, and they add up as they are.
    let (reading, mood) = record_reading(&reading, "2026-10-03", 0.5);
    assert_eq!(mood, 0.125);
    assert_eq!(reading.given_on("2026-10-03"), 0.375);
    // Twenty minutes, a minute at a time, is what a focus session adds.
    let (reading, total) = read_on(&ReadingMood::default(), "2026-10-03", &[1.0; 20]);
    assert_eq!(total, crate::habit::seeds::MOOD_PER_SESSION);
    assert_eq!(reading.given_on("2026-10-03"), 5.0);
    // The heartbeat's odd lengths come to the same as their sum.
    let (_, odd) = read_on(&ReadingMood::default(), "2026-10-03", &[1.02, 0.97, 1.31, 0.7]);
    assert!((odd - 1.0).abs() < 1e-9);
  }

  #[test]
  fn reading_adds_no_more_than_a_days_allowance() {
    // Forty minutes use the day up; the next hour adds nothing.
    let (reading, total) = read_on(&ReadingMood::default(), "2026-10-03", &[1.0; 100]);
    assert_eq!(total, READING_MOOD_PER_DAY);
    assert_eq!(reading.given_on("2026-10-03"), READING_MOOD_PER_DAY);
    assert_eq!(record_reading(&reading, "2026-10-03", 15.0), (reading.clone(), 0.0));
    // The last credit before the cap gets only what is left.
    let (nearly, _) = read_on(&ReadingMood::default(), "2026-10-03", &[13.0; 3]);
    assert_eq!(nearly.given_on("2026-10-03"), 9.75);
    let (full, last) = record_reading(&nearly, "2026-10-03", 15.0);
    assert_eq!((last, full.given_on("2026-10-03")), (0.25, READING_MOOD_PER_DAY));
    // Tomorrow it starts again.
    let (tomorrow, mood) = record_reading(&full, "2026-10-04", 2.0);
    assert_eq!(mood, 0.5);
    assert_eq!((tomorrow.given_on("2026-10-04"), tomorrow.given_on("2026-10-03")), (0.5, READING_MOOD_PER_DAY));
  }

  #[test]
  fn a_late_credit_to_yesterday_draws_on_yesterdays_allowance() {
    // Last night used yesterday up; this morning has begun.
    let (reading, _) = read_on(&ReadingMood::default(), "2026-10-02", &[15.0; 3]);
    let (reading, _) = record_reading(&reading, "2026-10-03", 8.0);
    assert_eq!(reading.given_on("2026-10-03"), 2.0);
    // The minute Leaflet was closed in the middle of arrives now: yesterday
    // has nothing left, and today's allowance is not touched.
    let (late, mood) = record_reading(&reading, "2026-10-02", 0.75);
    assert_eq!(mood, 0.0);
    assert_eq!(late, reading);

    // Yesterday had some left: the late minute gets it, out of yesterday's.
    let (reading, _) = record_reading(&ReadingMood::default(), "2026-10-02", 12.0);
    let (reading, _) = record_reading(&reading, "2026-10-03", 8.0);
    let (late, mood) = record_reading(&reading, "2026-10-02", 1.0);
    assert_eq!(mood, 0.25);
    assert_eq!((late.given_on("2026-10-02"), late.given_on("2026-10-03")), (3.25, 2.0));
  }

  #[test]
  fn going_back_and_forth_between_days_never_hands_out_a_second_allowance() {
    let mut reading = ReadingMood::default();
    let mut total = 0.0;
    for _ in 0..50 {
      for day in ["2026-10-03", "2026-10-02", "2026-10-04", "2026-10-01", "2026-10-03", "2026-10-02"] {
        let (next, mood) = record_reading(&reading, day, 15.0);
        reading = next;
        total += mood;
      }
    }
    // The 3rd and the 4th: one allowance each, however often they come round.
    // The 2nd had one credit (15 minutes) while it was still remembered, and
    // nothing once the 4th had pushed it out. The 1st was older than both
    // days remembered from the start.
    assert_eq!(total, 2.0 * READING_MOOD_PER_DAY + 15.0 * MOOD_PER_READING_MINUTE);
    assert_eq!(reading.days.keys().collect::<Vec<_>>(), ["2026-10-03", "2026-10-04"]);

    // A day skipped and read late gets its one allowance, and the day it
    // pushed out does not come back.
    let (reading, _) = record_reading(&ReadingMood::default(), "2026-10-05", 15.0);
    let (reading, _) = record_reading(&reading, "2026-10-07", 15.0);
    let (reading, tuesday) = record_reading(&reading, "2026-10-06", 100.0);
    assert_eq!(tuesday, READING_MOOD_PER_DAY);
    assert_eq!(record_reading(&reading, "2026-10-05", 100.0).1, 0.0);
    assert_eq!(record_reading(&reading, "2026-10-06", 100.0).1, 0.0);
  }

  #[test]
  fn minutes_that_are_not_reading_add_nothing() {
    let (some, _) = record_reading(&ReadingMood::default(), "2026-10-03", 4.0);
    for minutes in [0.0, -0.0, -5.0, f64::NAN, f64::NEG_INFINITY] {
      assert_eq!(record_reading(&some, "2026-10-03", minutes), (some.clone(), 0.0), "{minutes}");
      // Nor do they start a day.
      assert_eq!(record_reading(&some, "2026-10-04", minutes), (some.clone(), 0.0), "{minutes}");
    }
    // More minutes than a day has is still only a day's allowance.
    for minutes in [1.0e12, f64::MAX, f64::INFINITY] {
      let (reading, mood) = record_reading(&ReadingMood::default(), "2026-10-03", minutes);
      assert_eq!((mood, reading.given_on("2026-10-03")), (READING_MOOD_PER_DAY, READING_MOOD_PER_DAY), "{minutes}");
      assert_eq!(record_reading(&some, "2026-10-03", minutes).1, READING_MOOD_PER_DAY - 1.0, "{minutes}");
    }
    // A day that is not a date has no allowance.
    for day in ["", "today", "2026-13-40", "03/10/2026"] {
      assert_eq!(record_reading(&some, day, 5.0), (some.clone(), 0.0), "{day}");
    }
  }

  #[test]
  fn a_reading_allowance_that_will_not_read_is_not_a_bigger_one() {
    // The settings row is this device's own, and could be edited by hand.
    let odd: ReadingMood = serde_json::from_str(r#"{"days":{"2026-10-02":-40.0,"2026-10-03":250.0}}"#).expect("parses");
    assert_eq!(record_reading(&odd, "2026-10-03", 15.0).1, 0.0, "more than a day holds is a day used up");
    assert_eq!(record_reading(&odd, "2026-10-02", 100.0).1, READING_MOOD_PER_DAY, "less than nothing is nothing");
    assert_eq!(serde_json::from_str::<ReadingMood>("{}").expect("parses"), ReadingMood::default());
    let (reading, _) = record_reading(&ReadingMood::default(), "2026-10-03", 2.0);
    assert_eq!(serde_json::to_string(&reading).expect("encodes"), r#"{"days":{"2026-10-03":0.5}}"#);
  }

  fn cheered(at: &str, cause: &str, gain: f64, mood: f64) -> MoodEvent {
    MoodEvent { at: at.into(), cause: cause.into(), gain, mood }
  }

  #[test]
  fn the_mood_log_keeps_the_last_few_things_that_cheered_pip_up() {
    let mut log = Vec::new();
    log = log_mood(&log, cheered("2026-10-03T09:00:00+00:00", "session", 5.0, 60.0));
    log = log_mood(&log, cheered("2026-10-03T09:30:00+00:00", "treat:apple", 5.0, 65.0));
    assert_eq!(log.len(), 2);
    // Strokes close together are one petting.
    log = log_mood(&log, cheered("2026-10-03T09:31:00+00:00", "play:pet", 1.0, 66.0));
    log = log_mood(&log, cheered("2026-10-03T09:32:00+00:00", "play:pet", 1.0, 67.0));
    assert_eq!(log.len(), 3);
    assert_eq!(log[2], cheered("2026-10-03T09:32:00+00:00", "play:pet", 2.0, 67.0));
    // Later, it is a new one.
    log = log_mood(&log, cheered("2026-10-03T12:00:00+00:00", "play:pet", 1.0, 66.0));
    assert_eq!(log.len(), 4);
    // Nothing gained is nothing to say.
    assert_eq!(log_mood(&log, cheered("2026-10-03T12:01:00+00:00", "treat:cake", 0.0, 100.0)), log);
    // Only the last few are kept, oldest dropped first.
    for hour in 0..30 {
      log = log_mood(&log, cheered(&format!("2026-10-04T{:02}:00:00+00:00", hour % 24), if hour % 2 == 0 { "session" } else { "harvest" }, 2.0, 70.0));
    }
    assert_eq!(log.len(), MOOD_LOG_KEPT);
    assert_eq!(log.last().map(|event| event.cause.as_str()), Some("harvest"));
  }

  #[test]
  fn reading_minute_by_minute_is_one_line_in_the_mood_log() {
    // Forty minutes, a quarter of a point a minute: each joins the one
    // before (the ten minutes run from the latest), and the quarters add up
    // as quarters, not as ones.
    let mut log = vec![cheered("2026-10-03T08:00:00+00:00", "session", 5.0, 60.0)];
    for minute in 0..40 {
      let mood = 60.0 + 0.25 * f64::from(minute + 1);
      log = log_mood(&log, cheered(&format!("2026-10-03T09:{minute:02}:00+00:00"), "reading", MOOD_PER_READING_MINUTE, mood));
    }
    assert_eq!(log.len(), 2);
    assert_eq!(log[1], cheered("2026-10-03T09:39:00+00:00", "reading", 10.0, 70.0));
    // A read later in the day is a line of its own, a quarter still a quarter.
    log = log_mood(&log, cheered("2026-10-03T15:00:00+00:00", "reading", 0.25, 70.25));
    assert_eq!((log.len(), log[2].gain), (3, 0.25));
  }

  #[test]
  fn best_scores_and_bad_games() {
    let first = record_game(&Arcade::default(), "2026-09-27", "catch", 40).expect("a game");
    assert!(first.new_best);
    let worse = record_game(&first.arcade, "2026-09-27", "catch", 12).expect("a game");
    assert!(!worse.new_best);
    assert_eq!(worse.arcade.best.get("catch"), Some(&40));
    let zero = record_game(&Arcade::default(), "2026-09-27", "catch", 0).expect("a game");
    assert_eq!(zero.mood, 0.0, "a mis-tap is not play");
    assert!(record_game(&Arcade::default(), "2026-09-27", "slots", 5).is_err());
    let huge = record_game(&Arcade::default(), "2026-09-27", "flap", i64::MAX).expect("a game");
    assert_eq!(huge.arcade.best.get("flap"), Some(&MAX_SCORE));
  }

  #[test]
  fn floors_open_in_order_after_enough_sessions() {
    let catalogue = Catalogue::parse(
      r#"{ "items": [
        {"kind":"level","id":"bedroom","price":0},
        {"kind":"level","id":"kitchen","price":450,"requires":"bedroom","sessions":3},
        {"kind":"level","id":"library","price":550,"requires":"kitchen","sessions":10},
        {"kind":"plot","id":"plot-4","price":200},
        {"kind":"plot","id":"plot-5","price":350,"requires":"plot-4"}
      ] }"#
    )
    .expect("parses");
    let none = owned(&catalogue, &[]);
    assert_eq!(check_buy(&catalogue, &none, 9999, 1, "level", "kitchen"), Err(ShopError::NeedsSessions { left: 2 }));
    assert!(check_buy(&catalogue, &none, 9999, 3, "level", "kitchen").is_ok());
    assert_eq!(check_buy(&catalogue, &none, 9999, 50, "level", "library"), Err(ShopError::NeedsFirst));
    assert_eq!(check_buy(&catalogue, &none, 9999, 0, "plot", "plot-5"), Err(ShopError::NeedsFirst));
    assert_eq!(plot_count(&none), FREE_PLOTS);
    let more = owned(&catalogue, &[bought("plot", "plot-4", 200)]);
    assert_eq!(plot_count(&more), FREE_PLOTS + 1);
  }

  fn starters() -> Catalogue {
    Catalogue::parse(
      r#"{ "items": [
        {"kind":"skin","id":"sprout","price":0},
        {"kind":"move","id":"read","price":0},
        {"kind":"level","id":"bedroom","price":0},
        {"kind":"level","id":"kitchen","price":450,"requires":"bedroom"},
        {"kind":"room","id":"bed","price":0},
        {"kind":"room","id":"window","price":120,"freeWith":"bedroom"},
        {"kind":"room","id":"kettle","price":50,"freeWith":"kitchen"},
        {"kind":"room","id":"stove","price":240}
      ] }"#
    )
    .expect("parses")
  }

  /// A floor's starter pieces are owned with the floor: the bedroom's from
  /// the start, a new floor's the moment it is bought, on every device that
  /// has the purchase.
  #[test]
  fn starter_pieces_come_with_their_floor() {
    let catalogue = starters();
    let none = owned(&catalogue, &[]);
    assert!(none.contains(&("room".into(), "window".into())), "the bedroom's are everyone's");
    assert!(!none.contains(&("room".into(), "kettle".into())));
    let kitchen = owned(&catalogue, &[bought("level", "kitchen", 450)]);
    assert!(kitchen.contains(&("room".into(), "kettle".into())), "the kitchen brings its kettle");
    assert!(!kitchen.contains(&("room".into(), "stove".into())));
  }

  #[test]
  fn a_starter_piece_is_never_sold_on_its_own() {
    let catalogue = starters();
    let none = owned(&catalogue, &[]);
    assert_eq!(check_buy(&catalogue, &none, 999, 0, "room", "kettle"), Err(ShopError::ComesWithFloor));
    assert_eq!(check_buy(&catalogue, &none, 999, 0, "room", "window"), Err(ShopError::AlreadyOwned));
    assert_eq!(spent(&catalogue, &[bought("level", "kitchen", 450)]), 450, "the kettle costs nothing more");
  }

  #[test]
  fn a_starter_piece_can_go_out_on_its_floor() {
    let catalogue = starters();
    let mut layout = look("sprout", &[], "read");
    layout.room.insert("bedroom/window-1".into(), "window".into());
    assert!(check_look(&catalogue, &owned(&catalogue, &[]), &layout).is_ok());
    layout.room.insert("kitchen/top-1".into(), "kettle".into());
    assert!(check_look(&catalogue, &owned(&catalogue, &[]), &layout).is_err(), "no kitchen yet");
    assert!(check_look(&catalogue, &owned(&catalogue, &[bought("level", "kitchen", 450)]), &layout).is_ok());
  }

  #[test]
  fn purchase_ids_are_unique() {
    let a = new_purchase_id();
    let b = new_purchase_id();
    assert_ne!(a, b);
    assert!(a.starts_with("buy-"));
  }
}
