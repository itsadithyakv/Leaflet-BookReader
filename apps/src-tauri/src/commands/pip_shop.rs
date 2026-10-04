//! Pip's economy: seeds, the shop, the garden and the house.

use super::*;

// ---- Pip's shop and garden ------------------------------------------------
//
// Reading waters Pip's garden; ripe plants are harvested for seeds; seeds are
// spent here. None of it is stored as a number: `pip_ledger` replays the
// records (reading, plantings, harvests, purchases) every time. The frontend
// names what to buy or plant; Rust decides the price, from the catalogue
// compiled into the binary (`pip::Catalogue`).

/// Everything the economy is derived from, read once.
pub(crate) struct PipLedger {
  purchases: Vec<pip::Purchase>,
  garden: habit::seeds::Garden,
  /// Seeds earned, Pip's rewards included.
  earned: habit::seeds::SeedEarnings,
  /// First steps, the chest, sets and wishes, as they stand.
  rewards: pip::rewards::Earned,
  owned: std::collections::BTreeSet<(String, String)>,
  /// Focus sessions done, for floors that open after so many.
  sessions_done: i64
}

impl PipLedger {
  fn balance(&self) -> i64 {
    self.earned.total - pip::spent(pip::Catalogue::bundled(), &self.purchases)
  }
}

/// The reader's day, for Pip's daily wish. The webview's local date (which the
/// streak uses) is this machine's too.
fn local_today() -> String {
  chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// When something is bought or planted: the local time with its offset, so
/// the record says which of the reader's days it happened on (a wish is
/// granted on its own day; see `pip::rewards::record_day`) and still compares
/// as an instant everywhere else.
fn local_stamp() -> String {
  chrono::Local::now().to_rfc3339()
}

pub(crate) fn session_inputs(sessions: &[FocusSessionRecord]) -> Vec<habit::seeds::SessionSeeds<'_>> {
  sessions
    .iter()
    .map(|session| habit::seeds::SessionSeeds {
      id: &session.id,
      ended_at: &session.ended_at,
      ended_at_ms: millis(&session.ended_at),
      date_key: &session.date_key,
      started_day: started_day(session),
      minutes: session.minutes,
      completed_clean: session.ended_reason == "completed" && session.clean
    })
    .collect()
}

/// Grows the garden from the reading and the plantings on record.
pub(crate) fn grow_garden(
  days: &std::collections::HashMap<String, habit::DayRecord>,
  sessions: &[FocusSessionRecord],
  plantings: &[pip::Planting],
  harvests: &[pip::Harvest]
) -> habit::seeds::Garden {
  let catalogue = pip::Catalogue::bundled();
  let inputs = session_inputs(sessions);
  let drops = habit::seeds::water_drops(days, &inputs);
  let plants: Vec<habit::seeds::PlantingIn<'_>> = plantings
    .iter()
    .map(|planting| {
      let item = catalogue.get("plant", &planting.plant);
      habit::seeds::PlantingIn {
        id: &planting.id,
        plot: planting.plot,
        plant: &planting.plant,
        planted_at_ms: millis(&planting.planted_at),
        // A plant since dropped from the catalogue still grows, slowly, and
        // pays nothing more than its record says.
        need: item.map(|item| item.water).filter(|water| *water > 0.0).unwrap_or(600.0),
        yield_seeds: item.map(|item| item.yield_seeds).unwrap_or(0)
      }
    })
    .collect();
  let picked: Vec<habit::seeds::HarvestIn<'_>> = harvests
    .iter()
    .map(|harvest| habit::seeds::HarvestIn { id: &harvest.id, planting_id: &harvest.planting_id, seeds: harvest.seeds })
    .collect();
  habit::seeds::grow(&drops, &plants, &picked)
}

/// The whole economy from its records: the garden replayed, what the reading
/// earned, Pip's rewards, what is owned. Pure, so the same records (one
/// device's, or a merged sync document's) always give the same answer.
pub(crate) fn ledger_from(
  days: &std::collections::HashMap<String, habit::DayRecord>,
  sessions: &[FocusSessionRecord],
  plantings: &[pip::Planting],
  harvests: &[pip::Harvest],
  purchases: Vec<pip::Purchase>
) -> PipLedger {
  let catalogue = pip::Catalogue::bundled();
  let garden = grow_garden(days, sessions, plantings, harvests);
  let inputs = session_inputs(sessions);
  let owned = pip::owned(catalogue, &purchases);
  let facts = pip::rewards::Facts {
    purchases: &purchases,
    plantings: plantings.len(),
    garden: &garden,
    days,
    longest_focus: habit::seeds::longest_focus(days, &inputs)
  };
  let rewards = pip::rewards::earned(catalogue, &facts, &owned);
  let paid = rewards.seeds;
  let earned = habit::seeds::earnings(days, &inputs, garden.harvested).with_rewards(paid.goals, paid.chest, paid.sets, paid.wishes);
  let sessions_done = sessions.iter().filter(|session| session.minutes >= 1.0).count() as i64;
  PipLedger { purchases, garden, earned, rewards, owned, sessions_done }
}

pub(crate) fn pip_ledger(db: &db::Database) -> Result<PipLedger, String> {
  let days = db.reading_days().map_err(|e| e.to_string())?;
  let sessions = db.focus_sessions().map_err(|e| e.to_string())?;
  let plantings = db.pip_plantings().map_err(|e| e.to_string())?;
  let harvests = db.pip_harvests().map_err(|e| e.to_string())?;
  let purchases = db.pip_purchases().map_err(|e| e.to_string())?;
  Ok(ledger_from(&days, &sessions, &plantings, &harvests, purchases))
}

/// The garden's headline numbers, for the habit snapshot (the wrap-up shows
/// the water a session poured, what ripened, and the seeds it earned: a first
/// step or the starter chest included).
pub(crate) fn garden_totals(
  db: &db::Database,
  days: &std::collections::HashMap<String, habit::DayRecord>,
  sessions: &[FocusSessionRecord]
) -> Result<(habit::seeds::Garden, i64), String> {
  let plantings = db.pip_plantings().map_err(|e| e.to_string())?;
  let harvests = db.pip_harvests().map_err(|e| e.to_string())?;
  let purchases = db.pip_purchases().map_err(|e| e.to_string())?;
  let ledger = ledger_from(days, sessions, &plantings, &harvests, purchases);
  Ok((ledger.garden, ledger.earned.total))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipWallet {
  /// Earned minus spent. Never shown below zero: two devices spending the same
  /// seeds offline can overdraw it after a sync, and reading refills it.
  pub balance: i64,
  pub earned: habit::seeds::SeedEarnings,
  pub spent: i64
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipOwned {
  pub kind: String,
  pub id: String
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GardenView {
  /// Plots the garden has (free ones plus bought ones).
  pub plots: i64,
  pub plants: Vec<habit::seeds::PlantState>,
  /// Water waiting in the rain barrel, and the barrel's size.
  pub barrel: f64,
  pub barrel_cap: f64,
  /// All the water reading has poured.
  pub water: f64
}

/// Everything the Pip tab shows: the wallet, what Pip owns, the garden, and
/// Pip's state with the mood as of now.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipOverview {
  pub wallet: PipWallet,
  pub owned: Vec<PipOwned>,
  pub state: pip::PipState,
  pub garden: GardenView,
  /// Focus sessions done, for floors that open after so many.
  pub sessions_done: i64,
  /// Best arcade scores, and how much mood games gave today.
  pub arcade: pip::Arcade,
  /// How much mood reading has given, by local day (this device's).
  pub reading_mood: pip::ReadingMood,
  /// A new reader's first steps, in the order Pip suggests them: done or
  /// not, and the seeds each pays (already in `wallet.earned.goals`).
  pub goals: Vec<pip::rewards::GoalStatus>,
  /// The starter chest: open once a focus session counted its minutes.
  pub chest: pip::rewards::ChestStatus,
  /// Every set, and how far along it is.
  pub sets: Vec<pip::rewards::SetStatus>,
  /// Owned out of all there are, by catalogue kind ("accessory": 5 of 42).
  pub collection: std::collections::BTreeMap<String, pip::rewards::Count>,
  /// Today's wish (the reader's local day), and whether it was granted.
  pub wish: Option<pip::rewards::WishView>,
  /// The last few things that cheered Pip up, oldest first (this device's).
  pub mood_log: Vec<pip::MoodEvent>,
  /// What moves the mood and by how much, so the tab explains the real rules.
  pub mood_rules: MoodRules
}

/// The mood's rules as they stand in this build, for the Pip tab to put into
/// words: nothing here is decided by the webview.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoodRules {
  /// Mood lost per day since Pip was last cheered up.
  pub drift_per_day: f64,
  /// Where the drift stops: time alone never takes the mood below this.
  pub drift_floor: f64,
  /// What a minute of reading adds, in a focus session or not...
  pub per_reading_minute: f64,
  /// ...and the most reading can add in a day.
  pub reading_per_day: f64,
  /// What a recorded focus session adds, on top of its minutes.
  pub per_session: f64,
  pub per_harvest: f64,
  pub per_game: f64,
  pub per_play: f64,
  /// The most games and play can add in a day, together.
  pub play_per_day: f64,
  /// What granting the day's wish adds.
  pub per_wish: f64,
  /// Where a new Pip's mood starts.
  pub start: f64
}

fn mood_rules(catalogue: &pip::Catalogue) -> MoodRules {
  MoodRules {
    drift_per_day: habit::seeds::MOOD_DRIFT_PER_DAY,
    drift_floor: habit::seeds::MOOD_DRIFT_FLOOR,
    per_reading_minute: pip::MOOD_PER_READING_MINUTE,
    reading_per_day: pip::READING_MOOD_PER_DAY,
    per_session: habit::seeds::MOOD_PER_SESSION,
    per_harvest: pip::MOOD_PER_HARVEST,
    per_game: pip::MOOD_PER_GAME,
    per_play: pip::MOOD_PER_PLAY,
    play_per_day: pip::GAME_MOOD_PER_DAY,
    per_wish: catalogue.rewards().wish.mood,
    start: habit::seeds::MOOD_START
  }
}

/// Arcade scores are this device's alone (a settings row, not the backup):
/// they are a pastime, and nothing is bought with them.
pub(crate) const ARCADE_SETTING: &str = "pip.arcade";

pub(crate) fn read_arcade(db: &db::Database) -> pip::Arcade {
  db.get_setting(ARCADE_SETTING)
    .ok()
    .flatten()
    .and_then(|value| serde_json::from_str(&value).ok())
    .unwrap_or_default()
}

pub(crate) fn millis(value: &str) -> i64 {
  chrono::DateTime::parse_from_rfc3339(value)
    .map(|at| at.timestamp_millis())
    .unwrap_or(0)
}

/// The saved state, created on first use so the mood has a clock to drift from.
pub(crate) fn stored_pip_state(db: &db::Database) -> Result<pip::PipState, String> {
  if let Some(state) = db.pip_state().map_err(|e| e.to_string())? {
    return Ok(state);
  }
  let mut fresh = pip::PipState::fresh(&db::now_iso());
  fresh.room = pip::starter_room(pip::Catalogue::bundled());
  db.put_pip_state(&fresh).map_err(|e| e.to_string())?;
  Ok(fresh)
}

/// What cheered Pip up lately is this device's alone (a settings row, like
/// the arcade's scores): it explains the mood, and is never read back into it.
pub(crate) const MOOD_LOG_SETTING: &str = "pip.moodLog";

pub(crate) fn read_mood_log(db: &db::Database) -> Vec<pip::MoodEvent> {
  db.get_setting(MOOD_LOG_SETTING)
    .ok()
    .flatten()
    .and_then(|value| serde_json::from_str(&value).ok())
    .unwrap_or_default()
}

/// A finished focus session cheering Pip up: the reading's own call
/// (`commands::habits`). Everything else says what it is with `cheer_pip_for`.
pub(crate) fn cheer_pip(db: &db::Database, gain: f64) -> Result<(), String> {
  cheer_pip_for(db, gain, "session")
}

/// Raises Pip's mood from wherever it has drifted to by now, and notes what
/// did it (`cause`: see `pip::MoodEvent`).
pub(crate) fn cheer_pip_for(db: &db::Database, gain: f64, cause: &str) -> Result<(), String> {
  let mut state = stored_pip_state(db)?;
  let now = db::now_iso();
  let current = habit::seeds::mood_at(state.mood, millis(&state.mood_updated_at), millis(&now));
  state.mood = habit::seeds::mood_plus(current, gain);
  state.mood_updated_at = now.clone();
  state.updated_at = now.clone();
  db.put_pip_state(&state).map_err(|e| e.to_string())?;
  // The note is a courtesy: a log that will not save never stops Pip being cheered up.
  let event = pip::MoodEvent { at: now, cause: cause.to_string(), gain: state.mood - current, mood: state.mood };
  let log = pip::log_mood(&read_mood_log(db), event);
  if let Ok(encoded) = serde_json::to_string(&log) {
    let _ = db.set_setting(MOOD_LOG_SETTING, &encoded);
  }
  Ok(())
}

/// How much reading has cheered Pip up, day by day, is this device's alone (a
/// settings row, like the arcade's scores): never the sync document, never
/// the backup. Only the mood it raised travels, with Pip's state.
pub(crate) const READING_MOOD_SETTING: &str = "pip.readingMood";

pub(crate) fn read_reading_mood(db: &db::Database) -> pip::ReadingMood {
  db.get_setting(READING_MOOD_SETTING)
    .ok()
    .flatten()
    .and_then(|value| serde_json::from_str(&value).ok())
    .unwrap_or_default()
}

/// Minutes of reading the ledger has just taken for `date_key` cheering Pip
/// up, out of that day's allowance (`pip::record_reading`): the reading's own
/// call (`commands::habits`), for any reading, in a focus session or not.
///
/// The allowance is saved before the mood, as the games' is: if the second
/// write fails, a little cheer is lost rather than handed out twice.
pub(crate) fn cheer_pip_for_reading(db: &db::Database, date_key: &str, minutes: f64) -> Result<(), String> {
  let (reading, mood) = pip::record_reading(&read_reading_mood(db), date_key, minutes);
  if mood <= 0.0 {
    return Ok(());
  }
  let encoded = serde_json::to_string(&reading).map_err(|e| e.to_string())?;
  db.set_setting(READING_MOOD_SETTING, &encoded).map_err(|e| e.to_string())?;
  cheer_pip_for(db, mood, "reading")
}

pub(crate) fn pip_overview(db: &db::Database) -> Result<PipOverview, String> {
  let catalogue = pip::Catalogue::bundled();
  let ledger = pip_ledger(db)?;
  let plots = pip::plot_count(&ledger.owned);
  let collection = pip::rewards::collection(catalogue, &ledger.owned);
  let wish = pip::rewards::wish_today(catalogue, &ledger.purchases, &local_today());
  let mut state = stored_pip_state(db)?;
  // Reported as of now; stored only when something changes it.
  state.mood = habit::seeds::mood_at(
    state.mood,
    millis(&state.mood_updated_at),
    chrono::Utc::now().timestamp_millis()
  );
  let balance = ledger.balance();
  let spent = pip::spent(catalogue, &ledger.purchases);
  Ok(PipOverview {
    wallet: PipWallet { balance: balance.max(0), earned: ledger.earned, spent },
    owned: ledger.owned.into_iter().map(|(kind, id)| PipOwned { kind, id }).collect(),
    state,
    garden: GardenView {
      plots,
      barrel: ledger.garden.barrel,
      barrel_cap: habit::seeds::BARREL_CAP,
      water: ledger.garden.water,
      plants: ledger.garden.plants
    },
    sessions_done: ledger.sessions_done,
    arcade: read_arcade(db),
    reading_mood: read_reading_mood(db),
    goals: ledger.rewards.goals,
    chest: ledger.rewards.chest,
    sets: ledger.rewards.sets,
    collection,
    wish,
    mood_log: read_mood_log(db),
    mood_rules: mood_rules(catalogue)
  })
}

/// Records a purchase; if it grants today's wish (the first to), Pip cheers up.
fn record_purchase(db: &db::Database, ledger: &PipLedger, purchase: &pip::Purchase) -> Result<(), String> {
  let catalogue = pip::Catalogue::bundled();
  let wished = pip::rewards::grants_wish_now(catalogue, &ledger.purchases, purchase, &local_today());
  db.insert_pip_purchase(purchase).map_err(|e| e.to_string())?;
  if wished {
    cheer_pip_for(db, catalogue.rewards().wish.mood, "wish")?;
  }
  Ok(())
}

/// Seeds: the balance and where it came from.
#[tauri::command]
pub fn pip_wallet(state: State<'_, AppState>) -> Result<PipWallet, String> {
  let db = state.db.guard();
  let ledger = pip_ledger(&db)?;
  Ok(PipWallet {
    balance: ledger.balance().max(0),
    spent: pip::spent(pip::Catalogue::bundled(), &ledger.purchases),
    earned: ledger.earned
  })
}

#[tauri::command]
pub fn pip_state_get(state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.guard();
  pip_overview(&db)
}

/// Buys a thing Pip keeps (anything but food and seed packets). The price is
/// the catalogue's, checked against the balance under the database lock, so
/// two quick taps cannot both spend the same seeds.
#[tauri::command]
pub fn pip_buy(kind: String, id: String, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.guard();
  let catalogue = pip::Catalogue::bundled();
  let ledger = pip_ledger(&db)?;
  let item = pip::check_buy(catalogue, &ledger.owned, ledger.balance(), ledger.sessions_done, &kind, &id)
    .map_err(|e| e.to_string())?;
  let purchase = pip::Purchase {
    id: pip::new_purchase_id(),
    item_kind: item.kind.clone(),
    item_id: item.id.clone(),
    price: item.price,
    bought_at: local_stamp()
  };
  record_purchase(&db, &ledger, &purchase)?;
  pip_overview(&db)
}

/// Dresses Pip, arranges the house, or picks the signature move. Only owned
/// things are accepted; the mood is left alone.
#[tauri::command]
pub fn pip_state_set(look: pip::PipLook, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.guard();
  let catalogue = pip::Catalogue::bundled();
  let purchases = db.pip_purchases().map_err(|e| e.to_string())?;
  pip::check_look(catalogue, &pip::owned(catalogue, &purchases), &look)?;
  let mut saved = stored_pip_state(&db)?;
  saved.variant = look.variant;
  saved.outfit = look.outfit;
  saved.room = look.room;
  saved.room_style = look.room_style;
  saved.signature = look.signature;
  saved.updated_at = db::now_iso();
  db.put_pip_state(&saved).map_err(|e| e.to_string())?;
  pip_overview(&db)
}

/// Gives Pip a treat: food is bought on the spot (a purchase per bite), a toy
/// must already be Pip's. Either way the mood goes up by the treat's amount.
#[tauri::command]
pub fn pip_feed(treat_id: String, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.guard();
  let catalogue = pip::Catalogue::bundled();
  let ledger = pip_ledger(&db)?;
  let (treat, cost) =
    pip::check_give(catalogue, &ledger.owned, ledger.balance(), &treat_id).map_err(|e| e.to_string())?;
  if cost > 0 {
    let purchase = pip::Purchase {
      id: pip::new_purchase_id(),
      item_kind: "treat".to_string(),
      item_id: treat.id.clone(),
      price: cost,
      bought_at: local_stamp()
    };
    record_purchase(&db, &ledger, &purchase)?;
  }
  cheer_pip_for(&db, treat.mood, &format!("treat:{}", treat.id))?;
  pip_overview(&db)
}

/// Plants a seed packet in an empty plot. The packet is a purchase (at the
/// catalogue's price) with the same id as the planting, so spending and
/// planting are one record each and cannot come apart.
#[tauri::command]
pub fn pip_plant(plot: i64, plant: String, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.guard();
  let catalogue = pip::Catalogue::bundled();
  let ledger = pip_ledger(&db)?;
  if plot < 1 || plot > pip::plot_count(&ledger.owned) {
    return Err("That plot isn't dug yet.".to_string());
  }
  if ledger.garden.occupied(plot) {
    return Err("Something's already growing there.".to_string());
  }
  let item = catalogue
    .get("plant", &plant)
    .ok_or_else(|| "Pip doesn't know that seed.".to_string())?;
  let balance = ledger.balance();
  if balance < item.price {
    return Err(pip::ShopError::CannotAfford { short: item.price - balance }.to_string());
  }
  let id = pip::new_purchase_id();
  let now = local_stamp();
  let purchase = pip::Purchase {
    id: id.clone(),
    item_kind: "plant".to_string(),
    item_id: item.id.clone(),
    price: item.price,
    bought_at: now.clone()
  };
  record_purchase(&db, &ledger, &purchase)?;
  db.insert_pip_planting(&pip::Planting { id, plot, plant: item.id.clone(), planted_at: now })
    .map_err(|e| e.to_string())?;
  pip_overview(&db)
}

/// Picks a ripe plant for its seeds. Refused unless the garden, replayed from
/// the reading on record, shows it ripe; a harvest record is never what makes
/// a plant ripe.
#[tauri::command]
pub fn pip_harvest(planting_id: String, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.guard();
  let ledger = pip_ledger(&db)?;
  let plant = ledger
    .garden
    .plants
    .iter()
    .find(|plant| plant.id == planting_id)
    .ok_or_else(|| "That plant isn't in the garden.".to_string())?;
  if plant.harvested {
    return Err("Already picked.".to_string());
  }
  if !plant.ripe {
    let left = (plant.need - plant.water).ceil().max(1.0) as i64;
    return Err(format!("Not ripe yet: {left} more minute{} of focus.", if left == 1 { "" } else { "s" }));
  }
  let seeds = pip::Catalogue::bundled()
    .get("plant", &plant.plant)
    .map(|item| item.yield_seeds)
    .unwrap_or(0);
  db.insert_pip_harvest(&pip::Harvest {
    id: pip::new_purchase_id().replacen("buy-", "pick-", 1),
    planting_id,
    seeds,
    harvested_at: db::now_iso()
  })
  .map_err(|e| e.to_string())?;
  cheer_pip_for(&db, pip::MOOD_PER_HARVEST, "harvest")?;
  pip_overview(&db)
}

/// A finished arcade game: keeps the best score and cheers Pip up a little
/// (capped per day). Never seeds: those grow only from reading in focus.
#[tauri::command]
pub fn pip_game_played(
  game: String,
  score: i64,
  today_key: String,
  state: State<'_, AppState>
) -> Result<PipOverview, String> {
  let db = state.db.guard();
  let result = pip::record_game(&read_arcade(&db), &today_key, &game, score)?;
  let encoded = serde_json::to_string(&result.arcade).map_err(|e| e.to_string())?;
  db.set_setting(ARCADE_SETTING, &encoded).map_err(|e| e.to_string())?;
  if result.mood > 0.0 {
    cheer_pip_for(&db, result.mood, &format!("game:{game}"))?;
  }
  pip_overview(&db)
}

/// A bout of play by hand (a stroke, a tickle, the ball fetched, a toss):
/// cheers Pip up a little, out of the same daily allowance as the games.
/// Never seeds.
#[tauri::command]
pub fn pip_played(kind: String, today_key: String, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.guard();
  let (arcade, mood) = pip::record_play(&read_arcade(&db), &today_key, &kind)?;
  let encoded = serde_json::to_string(&arcade).map_err(|e| e.to_string())?;
  db.set_setting(ARCADE_SETTING, &encoded).map_err(|e| e.to_string())?;
  if mood > 0.0 {
    cheer_pip_for(&db, mood, &format!("play:{kind}"))?;
  }
  pip_overview(&db)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::sync::merge::{merge, DayEntry, SessionEntry, SyncDoc};

  const NOW: &str = "2026-10-06T12:00:00+00:00";

  /// The economy a device holding this document works out.
  fn ledger_of(doc: &SyncDoc) -> PipLedger {
    let days = doc.days.iter().map(|day| (day.date_key.clone(), day.to_record())).collect();
    let sessions: Vec<FocusSessionRecord> = doc.sessions.iter().map(SessionEntry::to_record).collect();
    ledger_from(&days, &sessions, &doc.plantings, &doc.harvests, doc.purchases.clone())
  }

  fn purchase(id: &str, kind: &str, item: &str, price: i64, at: &str) -> pip::Purchase {
    pip::Purchase { id: id.into(), item_kind: kind.into(), item_id: item.into(), price, bought_at: at.into() }
  }

  /// A seed packet bought and planted: one purchase, one planting, one id.
  fn sow(doc: &mut SyncDoc, id: &str, plot: i64, at: &str) {
    doc.purchases.push(purchase(id, "plant", "radish", 1, at));
    doc.plantings.push(pip::Planting { id: id.into(), plot, plant: "radish".into(), planted_at: at.into() });
  }

  fn read(doc: &mut SyncDoc, id: &str, day: &str, ended_at: &str, minutes: f64) {
    doc.days.push(DayEntry { date_key: day.into(), minutes, goal_minutes: 20, freeze_used: false, grace_used: false });
    doc.sessions.push(SessionEntry {
      id: id.into(),
      started_at: ended_at.into(),
      ended_at: ended_at.into(),
      date_key: day.into(),
      minutes,
      book_id: None,
      title: None,
      notes: None,
      ended_reason: "completed".into(),
      clean: true,
      style_seed: id.into(),
      burned_at: None,
      flower: None,
      flower_bloomed: false
    });
  }

  /// The first day in October when Pip wishes for a snack, and the snack.
  fn snack_day() -> (String, String) {
    let catalogue = pip::Catalogue::bundled();
    (1..=31)
      .map(|n| format!("2026-10-{n:02}"))
      .filter_map(|day| pip::rewards::wish_today(catalogue, &[], &day).map(|wish| (day, wish)))
      .find(|(_, wish)| wish.kind == "treat")
      .map(|(day, wish)| (day, wish.id))
      .expect("a day wishing for a snack")
  }

  /// One reader, a laptop and a phone, each busy before they synced: both
  /// planted, both read, both granted the day's wish, each bought half of a
  /// set. After the merge every reward is paid once, the set neither
  /// finished alone is finished, and the kitchen's starter piece is owned
  /// wherever the kitchen is.
  #[test]
  fn rewards_pay_once_across_a_sync() {
    // Everything on a day Pip wishes for a snack, so only the snack grants it.
    let (day, snack) = snack_day();
    let at = |time: &str| format!("{day}T{time}");
    let mut laptop = SyncDoc::empty(NOW);
    sow(&mut laptop, "buy-a1", 1, &at("08:00:00+05:30"));
    read(&mut laptop, "s-a", &day, &at("09:00:00+00:00"), 25.0);
    laptop.harvests.push(pip::Harvest { id: "pick-a1".into(), planting_id: "buy-a1".into(), seeds: 4, harvested_at: at("09:30:00+00:00") });
    laptop.purchases.push(purchase("buy-a2", "accessory", "roundglasses", 35, &at("16:00:00+05:30")));
    laptop.purchases.push(purchase("buy-a3", "accessory", "scarf", 40, &at("16:01:00+05:30")));
    laptop.purchases.push(purchase("buy-a4", "level", "kitchen", 450, &at("16:02:00+05:30")));
    laptop.purchases.push(purchase("buy-a5", "treat", &snack, 8, &at("16:03:00+05:30")));

    let mut phone = SyncDoc::empty(NOW);
    sow(&mut phone, "buy-b1", 2, &at("07:00:00+05:30"));
    read(&mut phone, "s-b", &day, &at("08:00:00+00:00"), 22.0);
    phone.purchases.push(purchase("buy-b2", "accessory", "bookbag", 60, &at("17:00:00+05:30")));
    phone.purchases.push(purchase("buy-b3", "accessory", "book", 20, &at("17:01:00+05:30")));
    phone.purchases.push(purchase("buy-b5", "treat", &snack, 8, &at("21:00:00+05:30")));

    let alone = ledger_of(&laptop);
    assert_eq!(alone.earned.goals, 10 + 10 + 15 + 15 + 5, "planted, watered, goal met, picked, a treat");
    assert_eq!((alone.earned.chest, alone.earned.sets, alone.earned.wishes), (30, 0, 8));
    assert!(alone.owned.contains(&("room".to_string(), "kettle".to_string())), "the kettle came with the kitchen");
    assert!(!ledger_of(&phone).owned.contains(&("room".to_string(), "kettle".to_string())));

    let merged = merge(&laptop, &phone, NOW);
    let both = ledger_of(&merged);
    // Both devices planted, read, fed Pip and granted the wish: each paid once.
    assert_eq!(both.earned.goals, alone.earned.goals);
    assert_eq!(both.earned.chest, 30);
    assert_eq!(both.earned.wishes, 8, "one wish a day, however many devices granted it");
    // Half a set on each device is a whole set together.
    assert_eq!(both.earned.sets, 20);
    assert!(both.rewards.sets.iter().any(|set| set.id == "bookworm" && set.done));
    assert!(both.owned.contains(&("room".to_string(), "kettle".to_string())));

    // Every device works out the same, and syncing again changes nothing.
    let other_way = ledger_of(&merge(&phone, &laptop, NOW));
    assert_eq!(other_way.earned, both.earned);
    assert_eq!(other_way.rewards, both.rewards);
    assert_eq!(ledger_of(&merge(&laptop, &merged, NOW)).earned, both.earned);
  }

  /// The starter chest opens on either device's first session, and a second
  /// device's first session does not open a second chest.
  #[test]
  fn the_starter_chest_opens_once() {
    let mut laptop = SyncDoc::empty(NOW);
    read(&mut laptop, "s-a", "2026-10-01", "2026-10-01T09:00:00+00:00", 6.0);
    let mut phone = SyncDoc::empty(NOW);
    read(&mut phone, "s-b", "2026-10-02", "2026-10-02T09:00:00+00:00", 30.0);
    assert_eq!(ledger_of(&laptop).earned.chest, 30);
    assert_eq!(ledger_of(&merge(&laptop, &phone, NOW)).earned.chest, 30);
    // A timer left running is not reading: two minutes read opens nothing.
    let mut idle = SyncDoc::empty(NOW);
    read(&mut idle, "s-c", "2026-10-03", "2026-10-03T09:00:00+00:00", 2.0);
    idle.sessions[0].minutes = 45.0;
    assert_eq!(ledger_of(&idle).earned.chest, 0);
  }

  /// Rewards are in every seed total: the balance, and what the habit
  /// snapshot tells the session wrap-up.
  #[test]
  fn rewards_are_in_the_balance() {
    // Planted on a day Pip wished for a snack: the packet grants no wish.
    let (day, _) = snack_day();
    let mut doc = SyncDoc::empty(NOW);
    sow(&mut doc, "buy-1", 1, &format!("{day}T08:00:00+05:30"));
    let ledger = ledger_of(&doc);
    // The welcome gift and the first step's ten, less the packet.
    assert_eq!(ledger.earned.total, habit::seeds::WELCOME_GIFT + 10);
    assert_eq!(ledger.balance(), habit::seeds::WELCOME_GIFT + 10 - 1);
  }
}
