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
  earned: habit::seeds::SeedEarnings,
  /// Focus sessions done, for floors that open after so many.
  sessions_done: i64
}

impl PipLedger {
  fn balance(&self) -> i64 {
    self.earned.total - pip::spent(pip::Catalogue::bundled(), &self.purchases)
  }
}

pub(crate) fn session_inputs(sessions: &[FocusSessionRecord]) -> Vec<habit::seeds::SessionSeeds<'_>> {
  sessions
    .iter()
    .map(|session| habit::seeds::SessionSeeds {
      id: &session.id,
      ended_at: &session.ended_at,
      ended_at_ms: millis(&session.ended_at),
      date_key: &session.date_key,
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

pub(crate) fn pip_ledger(db: &db::Database) -> Result<PipLedger, String> {
  let days = db.reading_days().map_err(|e| e.to_string())?;
  let sessions = db.focus_sessions().map_err(|e| e.to_string())?;
  let plantings = db.pip_plantings().map_err(|e| e.to_string())?;
  let harvests = db.pip_harvests().map_err(|e| e.to_string())?;
  let garden = grow_garden(&days, &sessions, &plantings, &harvests);
  let earned = habit::seeds::earnings(&days, &session_inputs(&sessions), garden.harvested);
  let sessions_done = sessions.iter().filter(|session| session.minutes >= 1.0).count() as i64;
  Ok(PipLedger {
    purchases: db.pip_purchases().map_err(|e| e.to_string())?,
    garden,
    earned,
    sessions_done
  })
}

/// The garden's headline numbers, for the habit snapshot (the wrap-up shows
/// the water a session poured and what ripened).
pub(crate) fn garden_totals(
  db: &db::Database,
  days: &std::collections::HashMap<String, habit::DayRecord>,
  sessions: &[FocusSessionRecord]
) -> Result<(habit::seeds::Garden, i64), String> {
  let plantings = db.pip_plantings().map_err(|e| e.to_string())?;
  let harvests = db.pip_harvests().map_err(|e| e.to_string())?;
  let garden = grow_garden(days, sessions, &plantings, &harvests);
  let earned = habit::seeds::earnings(days, &session_inputs(sessions), garden.harvested);
  Ok((garden, earned.total))
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
  pub arcade: pip::Arcade
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

/// Raises Pip's mood from wherever it has drifted to by now.
pub(crate) fn cheer_pip(db: &db::Database, gain: f64) -> Result<(), String> {
  let mut state = stored_pip_state(db)?;
  let now = db::now_iso();
  let current = habit::seeds::mood_at(state.mood, millis(&state.mood_updated_at), millis(&now));
  state.mood = habit::seeds::mood_plus(current, gain);
  state.mood_updated_at = now.clone();
  state.updated_at = now;
  db.put_pip_state(&state).map_err(|e| e.to_string())
}

pub(crate) fn pip_overview(db: &db::Database) -> Result<PipOverview, String> {
  let ledger = pip_ledger(db)?;
  let owned_set = pip::owned(pip::Catalogue::bundled(), &ledger.purchases);
  let plots = pip::plot_count(&owned_set);
  let owned = owned_set.into_iter().map(|(kind, id)| PipOwned { kind, id }).collect();
  let mut state = stored_pip_state(db)?;
  // Reported as of now; stored only when something changes it.
  state.mood = habit::seeds::mood_at(
    state.mood,
    millis(&state.mood_updated_at),
    chrono::Utc::now().timestamp_millis()
  );
  let balance = ledger.balance();
  let spent = pip::spent(pip::Catalogue::bundled(), &ledger.purchases);
  Ok(PipOverview {
    wallet: PipWallet { balance: balance.max(0), earned: ledger.earned, spent },
    owned,
    state,
    garden: GardenView {
      plots,
      barrel: ledger.garden.barrel,
      barrel_cap: habit::seeds::BARREL_CAP,
      water: ledger.garden.water,
      plants: ledger.garden.plants
    },
    sessions_done: ledger.sessions_done,
    arcade: read_arcade(db)
  })
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
  let owned = pip::owned(catalogue, &ledger.purchases);
  let item = pip::check_buy(catalogue, &owned, ledger.balance(), ledger.sessions_done, &kind, &id)
    .map_err(|e| e.to_string())?;
  db.insert_pip_purchase(&pip::Purchase {
    id: pip::new_purchase_id(),
    item_kind: item.kind.clone(),
    item_id: item.id.clone(),
    price: item.price,
    bought_at: db::now_iso()
  })
  .map_err(|e| e.to_string())?;
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
  let owned = pip::owned(catalogue, &ledger.purchases);
  let (treat, cost) =
    pip::check_give(catalogue, &owned, ledger.balance(), &treat_id).map_err(|e| e.to_string())?;
  if cost > 0 {
    db.insert_pip_purchase(&pip::Purchase {
      id: pip::new_purchase_id(),
      item_kind: "treat".to_string(),
      item_id: treat.id.clone(),
      price: cost,
      bought_at: db::now_iso()
    })
    .map_err(|e| e.to_string())?;
  }
  cheer_pip(&db, treat.mood)?;
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
  let owned = pip::owned(catalogue, &ledger.purchases);
  if plot < 1 || plot > pip::plot_count(&owned) {
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
  let now = db::now_iso();
  db.insert_pip_purchase(&pip::Purchase {
    id: id.clone(),
    item_kind: "plant".to_string(),
    item_id: item.id.clone(),
    price: item.price,
    bought_at: now.clone()
  })
  .map_err(|e| e.to_string())?;
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
  cheer_pip(&db, 2.0)?;
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
    cheer_pip(&db, result.mood)?;
  }
  pip_overview(&db)
}
