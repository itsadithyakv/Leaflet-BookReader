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

  /// The reader's level: from every seed ever earned, spent or not.
  fn level(&self) -> pip::levels::LevelView {
    // From what reading and the garden earned: a stake won back, or a duel's
    // prize, is seeds moved about, and must not raise a level by itself.
    pip::levels::level_for(self.earned.total - self.earned.stakes - self.earned.prizes)
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
  // What stakes won is read from the same records: the day ledger says
  // whether a week's goal stake was met, and a duel's prize is bounded by
  // the stake beside it (`pip::stakes`).
  let earned = habit::seeds::earnings(days, &inputs, garden.harvested)
    .with_rewards(paid.goals, paid.chest, paid.sets, paid.wishes)
    .with_winnings(pip::stakes::goal_winnings(&purchases, days), pip::stakes::duel_prizes(&purchases));
  let sessions_done = sessions.iter().filter(|session| session.minutes >= 1.0).count() as i64;
  PipLedger { purchases, garden, earned, rewards, owned, sessions_done }
}

pub(crate) fn pip_ledger(db: &db::Database) -> Result<PipLedger, String> {
  ledger_and_days(db).map(|(ledger, _)| ledger)
}

/// The economy, and the day ledger it was replayed from: a goal stake and
/// the badges are read from the days themselves.
fn ledger_and_days(db: &db::Database) -> Result<(PipLedger, std::collections::HashMap<String, habit::DayRecord>), String> {
  let days = db.reading_days().map_err(|e| e.to_string())?;
  let sessions = db.focus_sessions().map_err(|e| e.to_string())?;
  let plantings = db.pip_plantings().map_err(|e| e.to_string())?;
  let harvests = db.pip_harvests().map_err(|e| e.to_string())?;
  let purchases = db.pip_purchases().map_err(|e| e.to_string())?;
  let ledger = ledger_from(&days, &sessions, &plantings, &harvests, purchases);
  Ok((ledger, days))
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
  pub mood_rules: MoodRules,
  /// The reader's level, from every seed ever earned (`pip::levels`).
  pub level: pip::levels::LevelView,
  /// Streak freezes for sale: the price, and how many more can be had.
  pub freezes: FreezeShop,
  /// This week's stake on the reading goal, or last week's with nothing
  /// staked this week (`pip::stakes::goal_stake_view`).
  pub goal_stake: Option<pip::stakes::GoalStakeView>,
  /// What a stake may be, so the tab offers only what would be taken.
  pub stake_rules: StakeRules,
  /// Her fridge: until when the snacks on record keep it stocked, and whether
  /// finding it bare has taken its toll today (`pip::fridge`).
  pub fridge: pip::fridge::FridgeView
}

/// Streak freezes as the shop sells them (`pip::freezes`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreezeShop {
  /// The catalogue's price; 0 when this build's catalogue sells none.
  pub price: i64,
  /// Bought this calendar month, on any device...
  pub bought_this_month: i64,
  /// ...out of this many (0 when none are sold).
  pub per_month: i64,
  /// Freezes in the streak's bank on this device, and the most it holds.
  pub held: i64,
  pub cap: i64
}

/// The stakes' rules as they stand in this build (`pip::stakes`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StakeRules {
  /// A stake on the week's goal: seeds, and days of the week.
  pub min_seeds: i64,
  pub max_seeds: i64,
  pub min_days: i64,
  pub max_days: i64,
  /// The last day of the week one can be placed on: 1 Monday, 3 Wednesday.
  pub last_weekday: i64,
  /// A stake on a duel.
  pub duel_min_seeds: i64,
  pub duel_max_seeds: i64,
  /// Minutes a day must have to count towards a goal stake, whatever the goal.
  pub day_minutes: f64,
  /// What a won goal stake adds, in hundredths of the stake, for each day
  /// staked beyond two; and what a won duel stake comes back as, times over.
  pub gain_per_day: i64,
  pub duel_win_times: i64
}

fn stake_rules() -> StakeRules {
  StakeRules {
    min_seeds: pip::stakes::GOAL_MIN_SEEDS,
    max_seeds: pip::stakes::GOAL_MAX_SEEDS,
    min_days: pip::stakes::GOAL_MIN_DAYS,
    max_days: pip::stakes::GOAL_MAX_DAYS,
    last_weekday: pip::stakes::GOAL_LAST_WEEKDAY,
    duel_min_seeds: pip::stakes::DUEL_MIN_SEEDS,
    duel_max_seeds: pip::stakes::DUEL_MAX_SEEDS,
    day_minutes: pip::stakes::GOAL_DAY_MINUTES,
    gain_per_day: pip::stakes::GOAL_GAIN_PER_DAY,
    duel_win_times: pip::stakes::WIN_TIMES
  }
}

fn freeze_shop(db: &db::Database, catalogue: &pip::Catalogue, purchases: &[pip::Purchase], today: &str) -> FreezeShop {
  let item = catalogue.get(pip::freezes::KIND_FREEZE, pip::freezes::FREEZE_ID);
  FreezeShop {
    price: item.map(|item| item.price).unwrap_or(0),
    bought_this_month: pip::freezes::month_of(today)
      .map(|month| pip::freezes::bought_in_month(purchases, month))
      .unwrap_or(0),
    per_month: if item.is_some() { pip::freezes::FREEZES_PER_MONTH } else { 0 },
    held: read_streak_state(db).freezes,
    cap: habit::MAX_FREEZES
  }
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
  pub start: f64,
  /// What finding her fridge bare takes off, once a day at most and never
  /// below `drift_floor` (`pip::fridge`).
  pub bare_fridge: f64
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
    start: habit::seeds::MOOD_START,
    bare_fridge: pip::fridge::BARE_MOOD
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

/// The day finding the fridge bare last took its toll is this device's alone
/// (a settings row, like the arcade's allowance): it bounds the rule to once
/// a day, and only the mood it lowered travels, with Pip's state.
pub(crate) const BARE_FRIDGE_SETTING: &str = "pip.bareFridge";

pub(crate) fn read_bare_fridge(db: &db::Database) -> pip::fridge::BareFridge {
  db.get_setting(BARE_FRIDGE_SETTING)
    .ok()
    .flatten()
    .and_then(|value| serde_json::from_str(&value).ok())
    .unwrap_or_default()
}

/// Lowers Pip's mood a little from wherever it has drifted to by now, never
/// below the floor the drift stops at (`habit::seeds::mood_minus`), and notes
/// what did it. Returns what it took, which is nothing for a Pip already at
/// the floor: then nothing is written either.
pub(crate) fn sadden_pip_for(db: &db::Database, loss: f64, cause: &str) -> Result<f64, String> {
  let mut state = stored_pip_state(db)?;
  let now = db::now_iso();
  let current = habit::seeds::mood_at(state.mood, millis(&state.mood_updated_at), millis(&now));
  let next = habit::seeds::mood_minus(current, loss);
  if next >= current {
    return Ok(0.0);
  }
  state.mood = next;
  state.mood_updated_at = now.clone();
  state.updated_at = now.clone();
  db.put_pip_state(&state).map_err(|e| e.to_string())?;
  let event = pip::MoodEvent { at: now, cause: cause.to_string(), gain: next - current, mood: next };
  let log = pip::log_mood(&read_mood_log(db), event);
  if let Ok(encoded) = serde_json::to_string(&log) {
    let _ = db.set_setting(MOOD_LOG_SETTING, &encoded);
  }
  Ok(current - next)
}

/// Pip has gone to her fridge and found it bare (the Pip tab says so, when
/// she has looked): a little off her mood, once a local day at most.
///
/// Whether it is bare is not the webview's to say: it is read from the
/// snacks on record, as of `now_ms`, and a stocked fridge costs nothing
/// whatever was asked. Nothing here runs unless she looks, so no day the app
/// was shut is ever charged for. The day is saved before the mood, as the
/// games' allowance is: if the second write fails, the sadness is lost
/// rather than taken twice. Returns what it took.
pub(crate) fn find_fridge_bare(db: &db::Database, today: &str, now_ms: i64) -> Result<f64, String> {
  let purchases = db.pip_purchases().map_err(|e| e.to_string())?;
  if pip::fridge::stocked(pip::fridge::stocked_until(pip::Catalogue::bundled(), &purchases), now_ms) {
    return Ok(0.0);
  }
  if !pip::fridge::minds(&read_bare_fridge(db), today) {
    return Ok(0.0);
  }
  let seen = pip::fridge::BareFridge { day: today.to_string() };
  let encoded = serde_json::to_string(&seen).map_err(|e| e.to_string())?;
  db.set_setting(BARE_FRIDGE_SETTING, &encoded).map_err(|e| e.to_string())?;
  sadden_pip_for(db, pip::fridge::BARE_MOOD, pip::fridge::CAUSE_BARE)
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
  pip_overview_on(db, &local_today())
}

/// The overview as of `today` (the reader's local day): which week's stake
/// is showing, and which month's freezes are counted.
pub(crate) fn pip_overview_on(db: &db::Database, today: &str) -> Result<PipOverview, String> {
  let catalogue = pip::Catalogue::bundled();
  let (ledger, days) = ledger_and_days(db)?;
  let level = ledger.level();
  let freezes = freeze_shop(db, catalogue, &ledger.purchases, today);
  let goal_stake = pip::stakes::goal_stake_view(&ledger.purchases, &days, today);
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
  let fridge = pip::fridge::view(catalogue, &ledger.purchases, &read_bare_fridge(db), today, chrono::Utc::now().timestamp_millis());
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
    mood_rules: mood_rules(catalogue),
    level,
    freezes,
    goal_stake,
    stake_rules: stake_rules(),
    fridge
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
  let level = ledger.level().level;
  let item = pip::check_buy(catalogue, &ledger.owned, ledger.balance(), ledger.sessions_done, level, &kind, &id)
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

/// The Hollow, the arcade's building game. Its rules are the app's
/// (`src/pip/base/rules.ts`), and what is kept is their state as they wrote
/// it: acorns are a toy's money, nothing a seed or a server depends on, so
/// this side only keeps it and hands it back.
///
/// Kept as a settings row with a second beside it for when it was saved
/// (`sync::store`), and carried in the sync document from there: a camp takes
/// months to build, so it has to survive a new computer. Between two
/// devices the one saved later wins whole (`sync::merge::merge_camp`).
pub(crate) const BASE_SETTING: &str = crate::sync::store::CAMP_SETTING;

/// What is kept of the camp, or why it cannot be: a JSON object, no larger
/// than `sync::merge::CAMP_MAX_BYTES`. The rule is the sync document's too,
/// so a camp another device sends is held to it as well.
pub(crate) fn base_to_keep(state: &str) -> Result<&str, String> {
  match crate::sync::merge::CampEntry::problem(state) {
    None => Ok(state),
    Some(problem) => Err(problem.to_string())
  }
}

/// Keeps the camp as of `now`. The stamp is written with it, in one
/// transaction: it is what decides between this camp and another device's.
pub(crate) fn save_base(db: &db::Database, base: &str, now: &str) -> Result<(), String> {
  let camp = crate::sync::merge::CampEntry { state: base_to_keep(base)?.to_string(), saved_at: now.to_string() };
  crate::sync::store::keep_camp(db, &camp).map_err(|e| e.to_string())
}

/// The kept camp as it was saved, or nothing before the first.
#[tauri::command]
pub fn pip_base_load(state: State<'_, AppState>) -> Result<Option<String>, String> {
  state.db.guard().get_setting(BASE_SETTING).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pip_base_save(base: String, state: State<'_, AppState>) -> Result<(), String> {
  save_base(&state.db.guard(), &base, &db::now_iso())
}

// ---- the camp on a profile ---------------------------------------------------

/// The camp's buildings, and the level each stops at.
const CAMP_BUILDINGS: [&str; 6] = ["burrow", "oak", "store", "fence", "tower", "hut"];
const CAMP_MAX_LEVEL: i64 = 5;
/// What a plot of the yard can hold, how many plots there are, and the level
/// a thing on one stops at.
const CAMP_YARD_KINDS: [&str; 4] = ["workshop", "hive", "well", "stall"];
const CAMP_YARD_PLOTS: usize = 2;
const CAMP_YARD_MAX_LEVEL: i64 = 3;
/// More magpie camps, banners or trophies than any real camp has.
const CAMP_MAX_COUNT: i64 = 100_000;
/// The buildings that stand somewhere (the fence does not: it is its pieces).
const CAMP_PLACED: [&str; 7] = ["burrow", "oak", "store", "tower", "hut", "yard0", "yard1"];
/// The clearing, in the art's own pixels: nothing stands outside it.
const CAMP_SCENE_WIDTH: i64 = 240;
const CAMP_SCENE_HEIGHT: i64 = 120;
/// The most pieces of fence a camp has, the most things set about it, and
/// how many kinds of thing there are.
const CAMP_MAX_WALLS: usize = 32;
const CAMP_MAX_DECOR: usize = 24;
const CAMP_DECOR_KINDS: i64 = 18;
/// The most of the landscape set about a camp (ponds, a knoll, trees) and of
/// its defences, and how many kinds of each there are.
const CAMP_MAX_LAND: usize = 30;
const CAMP_LAND_KINDS: i64 = 10;
const CAMP_MAX_WORKS: usize = 12;
const CAMP_WORK_KINDS: i64 = 12;
/// The posts a guardian can stand at, and the rank one stops at.
const CAMP_GUARD_POSTS: usize = 7;
const CAMP_MAX_GUARD_RANK: i64 = 3;
/// The guardian with no signpost on the ground: the dragon keeps to the larder's roof.
const CAMP_GUARD_NO_POST: usize = 4;

/// A whole number from the camp's JSON, held to `0..=max`; nothing for
/// anything that is not one (absent, text, a fraction).
fn camp_whole(value: Option<&serde_json::Value>, max: i64) -> Option<i64> {
  let whole = value.and_then(|value| value.as_i64().or_else(|| value.as_u64().map(|_| i64::MAX)))?;
  Some(whole.clamp(0, max))
}

/// The same, with 0 for anything that is not a whole number.
fn camp_number(value: Option<&serde_json::Value>, max: i64) -> i64 {
  camp_whole(value, max).unwrap_or(0)
}

/// How many things a list in the camp's JSON holds; 0 if it is not a list.
fn camp_count(value: Option<&serde_json::Value>) -> i64 {
  let length = value.and_then(|value| value.as_array()).map_or(0, Vec::len);
  i64::try_from(length).unwrap_or(i64::MAX).clamp(0, CAMP_MAX_COUNT)
}

/// A place in the clearing, `[x, y]`, held to the scene; nothing for what is
/// not a pair of whole numbers.
fn camp_spot(spot: &serde_json::Value) -> Option<serde_json::Value> {
  let pair = spot.as_array()?;
  let x = camp_whole(pair.first(), CAMP_SCENE_WIDTH)?;
  let y = camp_whole(pair.get(1), CAMP_SCENE_HEIGHT)?;
  Some(serde_json::json!([x, y]))
}

/// Where each building stands. A building with no place that can be read is
/// left out (it is drawn where a camp begins), and with none at all there is
/// nothing to say.
fn camp_spots(spots: Option<&serde_json::Value>) -> Option<serde_json::Value> {
  let kept = spots?.as_object()?;
  let placed: serde_json::Map<String, serde_json::Value> = CAMP_PLACED
    .iter()
    .filter_map(|site| Some((site.to_string(), camp_spot(kept.get(*site)?)?)))
    .collect();
  (!placed.is_empty()).then(|| placed.into())
}

/// The pieces of fence put down, each where it is: the first few that can be
/// read. Nothing if the camp keeps no list of them.
fn camp_walls(walls: Option<&serde_json::Value>) -> Option<serde_json::Value> {
  let pieces: Vec<serde_json::Value> = walls?.as_array()?.iter().filter_map(camp_spot).take(CAMP_MAX_WALLS).collect();
  Some(pieces.into())
}

/// One thing that stands somewhere, `{kind, x, y}`; nothing for what is not
/// one, or is of a kind there is not (`kinds` of them, from 0).
fn camp_thing(entry: &serde_json::Value, kinds: i64) -> Option<serde_json::Value> {
  let kind = entry.get("kind").and_then(|kind| kind.as_i64()).filter(|kind| (0..kinds).contains(kind))?;
  let x = camp_whole(entry.get("x"), CAMP_SCENE_WIDTH)?;
  let y = camp_whole(entry.get("y"), CAMP_SCENE_HEIGHT)?;
  Some(serde_json::json!({ "kind": kind, "x": x, "y": y }))
}

/// A list of things that each stand somewhere, `{kind, x, y}` each: the first
/// `most` that can be read. One of a kind there is not (`kinds` of them, from
/// 0) is left out, not taken for another. Nothing if the camp keeps no such
/// list.
fn camp_things(things: Option<&serde_json::Value>, kinds: i64, most: usize) -> Option<serde_json::Value> {
  let read: Vec<serde_json::Value> = things?.as_array()?.iter().filter_map(|entry| camp_thing(entry, kinds)).take(most).collect();
  Some(read.into())
}

/// What is set about the clearing: the first few things that can be read.
fn camp_decor(decor: Option<&serde_json::Value>) -> Option<serde_json::Value> {
  camp_things(decor, CAMP_DECOR_KINDS, CAMP_MAX_DECOR)
}

/// The landscape set about the camp (ponds, a knoll, trees), each piece where it is.
fn camp_land(land: Option<&serde_json::Value>) -> Option<serde_json::Value> {
  camp_things(land, CAMP_LAND_KINDS, CAMP_MAX_LAND)
}

/// The camp's defences, each where it stands. A camp has one of a kind at
/// most: a second of a kind is left out, and the first is the one kept.
fn camp_works(works: Option<&serde_json::Value>) -> Option<serde_json::Value> {
  let mut seen = std::collections::HashSet::new();
  let read: Vec<serde_json::Value> = works?
    .as_array()?
    .iter()
    .filter_map(|work| camp_thing(work, CAMP_WORK_KINDS))
    .filter(|work| seen.insert(work["kind"].as_i64()))
    .take(CAMP_MAX_WORKS)
    .collect();
  Some(read.into())
}

/// The rank of the guardian at each of the seven posts, 0 for a post with
/// none: always all seven, a rank that cannot be read as 0 and one past the
/// top as the top. Nothing if the camp keeps no list of them, or no guardian
/// is posted.
fn camp_guards(guards: Option<&serde_json::Value>) -> Option<Vec<i64>> {
  let kept = guards?.as_array()?;
  let ranks: Vec<i64> = (0..CAMP_GUARD_POSTS).map(|post| camp_number(kept.get(post), CAMP_MAX_GUARD_RANK)).collect();
  ranks.iter().any(|rank| *rank > 0).then_some(ranks)
}

/// Where each guardian's signpost was carried to, one entry for each of the
/// seven in their order: a place held to the scene, or null for a post that
/// was never moved (the app stands it beside the guardian's building). The
/// camp keeps them by the guardian's number, and only the ones moved. Null
/// as well for the dragon, who has no post, for a guardian not posted
/// (`ranks`, as `camp_guards` reads them), and for a place that cannot be
/// read. Nothing if the camp keeps none, or none of the seven is somewhere.
fn camp_posts(posts: Option<&serde_json::Value>, ranks: Option<&[i64]>) -> Option<serde_json::Value> {
  let kept = posts?.as_object()?;
  let ranks = ranks?;
  let moved: Vec<serde_json::Value> = (0..CAMP_GUARD_POSTS)
    .map(|guard| {
      let posted = guard != CAMP_GUARD_NO_POST && ranks.get(guard).is_some_and(|rank| *rank > 0);
      kept.get(&guard.to_string()).filter(|_| posted).and_then(camp_spot).unwrap_or(serde_json::Value::Null)
    })
    .collect();
  moved.iter().any(|post| !post.is_null()).then(|| moved.into())
}

/// What a reader's profile shows of their camp, from the camp as it is kept:
/// the level of each building, what stands on each plot of the yard, how
/// many magpie camps were beaten, how many banners and trophies there are,
/// and how the camp is laid out (where each building stands, each piece of
/// fence, each thing set about the clearing, the landscape, the defences,
/// the rank of the guardian at each post, and where each guardian's signpost
/// was carried to). Never the acorns, and never the books behind the
/// trophies, which are a list of what the reader has read.
///
/// Nothing for a camp that cannot be read at all (not a JSON object). A part
/// that is missing or not what it should be says nothing: its levels are 0,
/// its list empty. Everything is held to what a real camp can be, since the
/// kept JSON is the app's to write and a server refuses what is out of range.
///
/// The layout is seven parts of its own (`spots`, `walls`, `decor`, `land`,
/// `works`, `guards`, `posts`), each left out when the kept camp has none to
/// read, so a camp from before things could be moved has the summary it
/// always had, `guards` left out as well when no guardian is posted, and
/// `posts` when no signpost was moved. It stays small: at most seven places,
/// 32 pieces of fence, 24 things, 30 pieces of landscape, 12 defences, seven
/// ranks and seven signposts, under 3 KB.
pub(crate) fn camp_summary(kept: &str) -> Option<serde_json::Value> {
  let camp = serde_json::from_str::<serde_json::Value>(kept).ok()?;
  let camp = camp.as_object()?;
  let built = camp.get("levels").and_then(|levels| levels.as_object());
  let levels: serde_json::Map<String, serde_json::Value> = CAMP_BUILDINGS
    .iter()
    .map(|name| (name.to_string(), camp_number(built.and_then(|built| built.get(*name)), CAMP_MAX_LEVEL).into()))
    .collect();
  let yard: Vec<serde_json::Value> = camp
    .get("yard")
    .and_then(|yard| yard.as_array())
    .map(|plots| plots.iter().take(CAMP_YARD_PLOTS).map(camp_plot).collect())
    .unwrap_or_default();
  let mut summary = serde_json::json!({
    "levels": levels,
    "yard": yard,
    "camps": camp_number(camp.get("camps"), CAMP_MAX_COUNT),
    "banners": camp_count(camp.get("banners")),
    "trophies": camp_count(camp.get("raised"))
  });
  let guards = camp_guards(camp.get("guards"));
  let layout = [
    ("spots", camp_spots(camp.get("spots"))),
    ("walls", camp_walls(camp.get("walls"))),
    ("decor", camp_decor(camp.get("decor"))),
    ("land", camp_land(camp.get("land"))),
    ("works", camp_works(camp.get("works"))),
    ("posts", camp_posts(camp.get("posts"), guards.as_deref())),
    ("guards", guards.map(Into::into))
  ];
  for (part, laid) in layout {
    if let Some(laid) = laid {
      summary[part] = laid;
    }
  }
  Some(summary)
}

/// One plot of the yard: what stands on it and at what level, or an empty
/// plot for anything that is not a thing a yard holds. A plot keeps its place
/// in the list either way, so the second is never shown as the first.
fn camp_plot(plot: &serde_json::Value) -> serde_json::Value {
  let kind = plot.get("kind").and_then(|kind| kind.as_str()).filter(|kind| CAMP_YARD_KINDS.contains(kind));
  match kind {
    Some(kind) => serde_json::json!({ "kind": kind, "level": camp_number(plot.get("level"), CAMP_YARD_MAX_LEVEL) }),
    None => serde_json::json!({ "kind": null, "level": 0 })
  }
}

/// The summary of the camp kept on this device, or nothing with none kept.
fn kept_camp_summary(db: &db::Database) -> Option<serde_json::Value> {
  db.get_setting(BASE_SETTING).ok().flatten().and_then(|kept| camp_summary(&kept))
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

/// Pip went to her fridge and found it bare: a little off her mood, once a
/// day at most, never below the floor (`find_fridge_bare`, `pip::fridge`).
/// The day is this machine's own, not one the webview names.
#[tauri::command]
pub fn pip_fridge_bare(state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.guard();
  find_fridge_bare(&db, &local_today(), chrono::Utc::now().timestamp_millis())?;
  pip_overview(&db)
}

// ---- more to buy with seeds ------------------------------------------------
//
// A streak freeze, a stake on the week's goal or on a duel, a gift for a
// friend, and the badges. Each thing bought is one more record in the
// purchase ledger (`pip_purchases`), so it syncs as the rest does and the
// balance is still earned minus spent, replayed. The rules are in `pip`
// (`freezes`, `stakes`, `gifts`) and `habit::badges`; here they are checked
// under the database lock and the record is written.

/// Whether the day the webview names is the reader's today: this machine's
/// local date, or a day either side of it (a time zone, midnight). The rules
/// that turn on the calendar (a stake by Wednesday, so many freezes a month)
/// are not the caller's to move by naming another day.
fn is_today(today_key: &str) -> Result<(), String> {
  let named = chrono::NaiveDate::parse_from_str(today_key, "%Y-%m-%d").map_err(|_| "That isn't a day.".to_string())?;
  if (named - chrono::Local::now().date_naive()).num_days().abs() > 1 {
    return Err("That isn't today.".to_string());
  }
  Ok(())
}

/// A record made now, under a fresh id.
fn record_of(kind: &str, item_id: String, price: i64) -> pip::Purchase {
  pip::Purchase { id: pip::new_purchase_id(), item_kind: kind.to_string(), item_id, price, bought_at: local_stamp() }
}

/// Buys a streak freeze: at the catalogue's price, so many a calendar month,
/// and only while the streak's bank has room for it.
///
/// Across devices. The purchase is a record and syncs: every device charges
/// it and counts it towards the month. The freeze itself goes into the
/// streak's bank, and that bank is each device's own (a settings row, never
/// in the sync document), so it is held where it was bought and covers a
/// missed day when that device walks the streak; the day it covers then
/// travels with the ledger. Two devices that each buy one before they sync
/// are both charged and each holds its own, even where that makes a third in
/// the month: nothing is undone after the fact.
#[tauri::command]
pub fn pip_buy_freeze(today_key: String, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.guard();
  is_today(&today_key)?;
  buy_freeze(&db, pip::Catalogue::bundled(), &today_key)
}

pub(crate) fn buy_freeze(db: &db::Database, catalogue: &pip::Catalogue, today_key: &str) -> Result<PipOverview, String> {
  let ledger = pip_ledger(db)?;
  let mut streak = read_streak_state(db);
  let item = pip::freezes::check_buy(catalogue, &ledger.purchases, ledger.balance(), streak.freezes, today_key)?;
  record_purchase(db, &ledger, &record_of(pip::freezes::KIND_FREEZE, item.id.clone(), item.price))?;
  // Paid for first: if the second write fails, a freeze is owed, which is
  // better than one handed out for nothing.
  streak.freezes = (streak.freezes + 1).clamp(0, habit::MAX_FREEZES);
  write_streak_state(db, &streak)?;
  pip_overview_on(db, today_key)
}

/// Stakes seeds on meeting the daily goal on `days` days of this week
/// (`pip::stakes`). The outcome is never recorded: it is read from the day
/// ledger, and a won stake's seeds appear in what was earned.
#[tauri::command]
pub fn pip_stake_goal(seeds: i64, days: i64, today_key: String, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.guard();
  is_today(&today_key)?;
  stake_goal(&db, seeds, days, &today_key)
}

pub(crate) fn stake_goal(db: &db::Database, seeds: i64, days: i64, today_key: &str) -> Result<PipOverview, String> {
  let (ledger, ledger_days) = ledger_and_days(db)?;
  let item_id = pip::stakes::check_goal_stake(&ledger.purchases, &ledger_days, ledger.balance(), seeds, days, today_key)?;
  record_purchase(db, &ledger, &record_of(pip::stakes::KIND_STAKE, item_id, seeds))?;
  pip_overview_on(db, today_key)
}

/// Stakes seeds on a duel. Asked twice for the same duel (a retry, a second
/// device after a sync), the first stake stands and nothing more is taken.
#[tauri::command]
pub fn pip_stake_duel(duel_id: String, seeds: i64, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.guard();
  stake_duel(&db, &duel_id, seeds)
}

pub(crate) fn stake_duel(db: &db::Database, duel_id: &str, seeds: i64) -> Result<PipOverview, String> {
  let ledger = pip_ledger(db)?;
  if pip::hex_id(duel_id) && pip::stakes::duel_stake(&ledger.purchases, duel_id).is_some() {
    return pip_overview(db);
  }
  let item_id = pip::stakes::check_duel_stake(ledger.balance(), duel_id, seeds)?;
  record_purchase(db, &ledger, &record_of(pip::stakes::KIND_STAKE, item_id, seeds))?;
  pip_overview(db)
}

/// Records how a staked duel went: `won` pays twice the stake, `tied` gives
/// it back, `lost` records nothing. Once a prize is on record a second call
/// changes nothing.
///
/// Taken on trust: the duel was decided on a server this code cannot ask.
/// What bounds it is the replay (`pip::stakes::duel_prizes`): one prize a
/// duel, and never more than twice the stake that was really taken.
#[tauri::command]
pub fn pip_settle_duel(duel_id: String, outcome: String, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.guard();
  settle_duel(&db, &duel_id, &outcome)
}

pub(crate) fn settle_duel(db: &db::Database, duel_id: &str, outcome: &str) -> Result<PipOverview, String> {
  let ledger = pip_ledger(db)?;
  let staked = pip::stakes::duel_stake(&ledger.purchases, duel_id)
    .filter(|_| pip::hex_id(duel_id))
    .ok_or_else(|| "Nothing was staked on that duel.".to_string())?;
  let prize = pip::stakes::duel_prize(staked, outcome)?;
  if prize > 0 && !pip::stakes::duel_settled(&ledger.purchases, duel_id) {
    record_purchase(db, &ledger, &record_of(pip::stakes::KIND_PRIZE, pip::stakes::duel_item_id(duel_id), prize))?;
  }
  pip_overview(db)
}

/// Pays for a thing a friend will keep. The record is the spending alone
/// (`pip::gifts`): passing the gift on is the caller's business, and `to`
/// (the friend) is theirs to use; nothing here stores it. One record a gift
/// id, however often it is asked.
#[tauri::command]
pub fn pip_send_gift(
  kind: String,
  id: String,
  to: String,
  gift_id: String,
  state: State<'_, AppState>
) -> Result<PipOverview, String> {
  let db = state.db.guard();
  if to.trim().is_empty() {
    return Err("A gift is for someone.".to_string());
  }
  send_gift(&db, &kind, &id, &gift_id)
}

pub(crate) fn send_gift(db: &db::Database, kind: &str, id: &str, gift_id: &str) -> Result<PipOverview, String> {
  if !pip::hex_id(gift_id) {
    return Err("That isn't a gift.".to_string());
  }
  let ledger = pip_ledger(db)?;
  if pip::gifts::sent(&ledger.purchases, gift_id) {
    return pip_overview(db);
  }
  let item = pip::gifts::check_send(
    pip::Catalogue::bundled(),
    ledger.balance(),
    ledger.sessions_done,
    ledger.level().level,
    kind,
    id
  )
  .map_err(|e| e.to_string())?;
  let sent = record_of(pip::gifts::KIND_GIFT, pip::gifts::sent_item_id(&item.kind, &item.id, gift_id), item.price);
  record_purchase(db, &ledger, &sent)?;
  pip_overview(db)
}

/// Takes a gift: the thing is Pip's from now on, bought for nothing, under
/// the gift's own purchase id so it arrives once. Something Pip already has
/// is left as it is.
///
/// Taken on trust, like a duel's outcome: that a friend really paid is known
/// to the server that passed the gift on, not here.
#[tauri::command]
pub fn pip_receive_gift(kind: String, id: String, gift_id: String, state: State<'_, AppState>) -> Result<PipOverview, String> {
  let db = state.db.guard();
  receive_gift(&db, &kind, &id, &gift_id)
}

pub(crate) fn receive_gift(db: &db::Database, kind: &str, id: &str, gift_id: &str) -> Result<PipOverview, String> {
  if !pip::hex_id(gift_id) {
    return Err("That isn't a gift.".to_string());
  }
  let item = pip::gifts::check_receive(pip::Catalogue::bundled(), kind, id).map_err(|e| e.to_string())?;
  let ledger = pip_ledger(db)?;
  if !ledger.owned.contains(&(item.kind.clone(), item.id.clone())) {
    let arrived = pip::Purchase {
      id: pip::gifts::received_id(gift_id),
      item_kind: item.kind.clone(),
      item_id: item.id.clone(),
      price: 0,
      bought_at: local_stamp()
    };
    record_purchase(db, &ledger, &arrived)?;
  }
  pip_overview(db)
}

/// Books finished, counted as the reader's public card counts them
/// (`commands::social::build_profile_update`): those at their end or with a
/// finished date, and those finished and since removed.
fn books_finished(db: &db::Database) -> Result<i64, String> {
  let here = db.list_books().map_err(|e| e.to_string())?.iter().filter(|book| has_finished(book)).count();
  let removed = db.finished_and_removed().map_err(|e| e.to_string())?.len();
  Ok((here + removed) as i64)
}

/// Where a reader stands: every badge, the level, and the arcade's best
/// scores (dash, catch, flap).
struct Standing {
  badges: Vec<habit::badges::BadgeStatus>,
  level: i64,
  arcade: (i64, i64, i64)
}

/// The reader's standing, from one read of the records.
fn standing(db: &db::Database, today_key: &str) -> Result<Standing, String> {
  let (ledger, days) = ledger_and_days(db)?;
  // The streak as it was last walked: reading it must not walk it again
  // (a walk spends grace and freezes), and the habit snapshot keeps it fresh.
  let streak = read_streak_state(db);
  let arcade = read_arcade(db);
  let best = |game: &str| arcade.best.get(game).copied().unwrap_or(0);
  let scores = (best("dash"), best("catch"), best("flap"));
  let level = ledger.level().level;
  let facts = habit::badges::BadgeFacts {
    days: &days,
    current_streak: streak.current_streak,
    longest_streak: streak.longest_streak,
    books_finished: books_finished(db)?,
    sessions_done: ledger.sessions_done,
    harvests: ledger.garden.plants.iter().filter(|plant| plant.harvested).count() as i64,
    bought: pip::bought_count(pip::Catalogue::bundled(), &ledger.purchases),
    arcade_dash: scores.0,
    arcade_catch: scores.1,
    arcade_flap: scores.2,
    level
  };
  Ok(Standing { badges: habit::badges::badges(&facts, today_key), level, arcade: scores })
}

/// Every badge, earned or not, with how far along each is (`habit::badges`).
#[tauri::command]
pub fn pip_badges(today_key: String, state: State<'_, AppState>) -> Result<Vec<habit::badges::BadgeStatus>, String> {
  let db = state.db.guard();
  standing(&db, &today_key).map(|standing| standing.badges)
}

/// What a reader's public card can say beyond the reading itself.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SocialExtras {
  pub level: i64,
  /// The badges earned, by id, in the order `habit::badges` lists them.
  pub badges: Vec<String>,
  /// The arcade's best scores: dash, catch, flap.
  pub arcade: (i64, i64, i64),
  /// Pip's camp in the Hollow as a profile shows it (`camp_summary`), or
  /// nothing with no camp kept, or one that cannot be read.
  pub camp: Option<serde_json::Value>
}

/// The level, the badges earned, the arcade's best scores and the camp, for
/// the profile (`commands::social`) to publish.
pub(crate) fn social_extras(db: &db::Database, today_key: &str) -> Result<SocialExtras, String> {
  let Standing { badges, level, arcade } = standing(db, today_key)?;
  let badges = badges.into_iter().filter(|badge| badge.earned).map(|badge| badge.id).collect();
  Ok(SocialExtras { level, badges, arcade, camp: kept_camp_summary(db) })
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;
  use crate::sync::merge::{merge, DayEntry, SessionEntry, SyncDoc};

  const NOW: &str = "2026-10-06T12:00:00+00:00";

  #[test]
  fn the_camp_is_kept_only_as_a_small_json_object() {
    use crate::sync::merge::CAMP_MAX_BYTES;
    let camp = r#"{"v":1,"acorns":20,"levels":{"burrow":1}}"#;
    assert_eq!(base_to_keep(camp), Ok(camp));
    assert!(base_to_keep("[1,2,3]").is_err());
    assert!(base_to_keep("not json").is_err());
    assert!(base_to_keep(&format!(r#"{{"pad":"{}"}}"#, "x".repeat(CAMP_MAX_BYTES))).is_err());
    // Four hundred trophies, each the id of a book (a SHA-256), still fit.
    let raised: Vec<String> = (0..400).map(|book| format!("{book:064x}")).collect();
    let large = serde_json::json!({ "v": 2, "raised": raised }).to_string();
    assert!(large.len() > 16 * 1024 && base_to_keep(&large).is_ok(), "{}", large.len());
  }

  #[test]
  fn saving_the_camp_stamps_it() {
    use crate::sync::store::{kept_camp, CAMP_SAVED_AT_SETTING};
    let db = memory_db();
    assert_eq!(db.get_setting(BASE_SETTING).expect("row"), None);

    let first = r#"{"v":2,"camps":1}"#;
    save_base(&db, first, "2026-10-12T09:00:00+00:00").expect("saved");
    assert_eq!(db.get_setting(BASE_SETTING).expect("row").as_deref(), Some(first), "what the game loads is what it saved");
    assert_eq!(db.get_setting(CAMP_SAVED_AT_SETTING).expect("row").as_deref(), Some("2026-10-12T09:00:00+00:00"));

    // Every save moves the stamp on, and the document carries both.
    let second = r#"{"v":2,"camps":2}"#;
    save_base(&db, second, "2026-10-12T09:05:00+00:00").expect("saved");
    let kept = kept_camp(&db).expect("camp").expect("one is kept");
    assert_eq!((kept.state.as_str(), kept.saved_at.as_str()), (second, "2026-10-12T09:05:00+00:00"));
    assert_eq!(crate::sync::store::snapshot(&db, NOW).expect("snapshot").camp, Some(kept.clone()));

    // What is not a camp is refused, and neither row moves.
    assert!(save_base(&db, "[1,2,3]", "2026-10-12T09:10:00+00:00").is_err());
    assert_eq!(kept_camp(&db).expect("camp"), Some(kept));
  }

  /// A camp as the app keeps one, with all it has to say.
  const KEPT_CAMP: &str = r#"{
    "v": 2, "acorns": 1240, "seed": "pip-7", "night": 12,
    "levels": { "burrow": 3, "oak": 2, "store": 2, "fence": 1, "tower": 1, "hut": 2 },
    "yard": [ { "kind": "workshop", "level": 1 }, { "kind": null, "level": 0 } ],
    "camps": 7,
    "banners": ["2026-09", "2026-10"],
    "raised": ["9f2c", "41aa", "77b0", "c0de", "beef", "f00d", "abcd", "1234", "5678", "9abc", "def0", "0fed", "cba9", "8765"],
    "spots": { "oak": [44, 76], "burrow": [120, 90], "store": [176, 70], "tower": [200, 100], "hut": [64, 104], "yard0": [150, 108], "yard1": [96, 66] },
    "walls": [[110, 104], [120, 104], [130, 104]],
    "decor": [ { "kind": 3, "x": 30, "y": 100 }, { "kind": 0, "x": 222, "y": 60 } ],
    "land": [ { "kind": 0, "x": 20, "y": 64 }, { "kind": 7, "x": 210, "y": 88 } ],
    "works": [ { "kind": 2, "x": 132, "y": 112 } ],
    "guards": [3, 0, 2, 0, 1, 0, 0], "drill": { "guard": 3, "from": 990, "needs": 20 },
    "hero": 1, "quest": 6
  }"#;

  #[test]
  fn a_profile_shows_the_camps_levels_counts_and_layout_and_nothing_else() {
    let summary = camp_summary(KEPT_CAMP).expect("a camp");
    assert_eq!(
      summary,
      serde_json::json!({
        "levels": { "burrow": 3, "oak": 2, "store": 2, "fence": 1, "tower": 1, "hut": 2 },
        "yard": [ { "kind": "workshop", "level": 1 }, { "kind": null, "level": 0 } ],
        "camps": 7, "banners": 2, "trophies": 14,
        // The camp as it is laid out: each building, each piece of fence, each thing set down.
        "spots": { "oak": [44, 76], "burrow": [120, 90], "store": [176, 70], "tower": [200, 100], "hut": [64, 104], "yard0": [150, 108], "yard1": [96, 66] },
        "walls": [[110, 104], [120, 104], [130, 104]],
        "decor": [ { "kind": 3, "x": 30, "y": 100 }, { "kind": 0, "x": 222, "y": 60 } ],
        // The landscape about it, its defences, and the guardian at each of the seven posts.
        "land": [ { "kind": 0, "x": 20, "y": 64 }, { "kind": 7, "x": 210, "y": 88 } ],
        "works": [ { "kind": 2, "x": 132, "y": 112 } ],
        "guards": [3, 0, 2, 0, 1, 0, 0]
      })
    );
    // Not the acorns, not a book, not a month, not who is in training: only those eleven parts.
    let sent = summary.to_string();
    for private in ["acorns", "1240", "9f2c", "raised", "2026-09", "seed", "night", "hero", "quest", "drill", "990"] {
      assert!(!sent.contains(private), "{private} in {sent}");
    }
    let mut parts: Vec<&str> = summary.as_object().expect("an object").keys().map(String::as_str).collect();
    parts.sort_unstable();
    assert_eq!(parts, ["banners", "camps", "decor", "guards", "land", "levels", "spots", "trophies", "walls", "works", "yard"]);
  }

  #[test]
  fn a_camp_with_no_layout_kept_has_the_summary_it_always_had() {
    // A camp from before things could be moved: five parts, and the app draws it as a camp begins.
    let old = r#"{"v":1,"acorns":20,"levels":{"burrow":1},"camps":2}"#;
    let summary = camp_summary(old).expect("a camp");
    let mut parts: Vec<&str> = summary.as_object().expect("an object").keys().map(String::as_str).collect();
    parts.sort_unstable();
    assert_eq!(parts, ["banners", "camps", "levels", "trophies", "yard"]);

    // A layout that is the wrong type altogether is left out, and costs the rest nothing.
    let wrong = camp_summary(r#"{"camps":2,"spots":[[1,2]],"walls":{"0":[10,60]},"decor":"a pond","land":{"kind":0,"x":5,"y":5},"works":7,"guards":"3,0,2","posts":[[1,2]]}"#).expect("a camp");
    assert_eq!(wrong, summary_without_levels(2));
    // Buildings with no place that can be read: nothing to say of where they stand.
    let nowhere = camp_summary(r#"{"camps":2,"spots":{"oak":"left","cellar":[5,5]}}"#).expect("a camp");
    assert_eq!(nowhere, summary_without_levels(2));
    // No fence put down and nothing set about is still a layout: said as empty lists.
    let bare = camp_summary(r#"{"spots":{"oak":[38,80]},"walls":[],"decor":[]}"#).expect("a camp");
    assert_eq!((&bare["spots"], &bare["walls"], &bare["decor"]), (&serde_json::json!({ "oak": [38, 80] }), &serde_json::json!([]), &serde_json::json!([])));
    // So is no landscape and no defence. Guardians with none posted are not said at all.
    let quiet = camp_summary(r#"{"camps":2,"land":[],"works":[],"guards":[0,0,0,0,0,0,0]}"#).expect("a camp");
    assert_eq!((&quiet["land"], &quiet["works"]), (&serde_json::json!([]), &serde_json::json!([])));
    assert!(quiet.get("guards").is_none(), "{quiet}");
  }

  #[test]
  fn the_camps_guardians_are_seven_ranks_or_not_said() {
    let guards = |kept: &str| camp_summary(&format!(r#"{{"guards":{kept}}}"#)).expect("a camp").get("guards").cloned();
    assert_eq!(guards("[3,0,2,0,1,0,0]"), Some(serde_json::json!([3, 0, 2, 0, 1, 0, 0])));
    // Always all seven: a short list is filled out with none, a long one cut.
    assert_eq!(guards("[1]"), Some(serde_json::json!([1, 0, 0, 0, 0, 0, 0])));
    assert_eq!(guards("[0,0,0,0,0,0,2,3,3]"), Some(serde_json::json!([0, 0, 0, 0, 0, 0, 2])));
    // A rank past the top is the top, and what is not a rank is none.
    assert_eq!(guards(r#"[9,-2,"3",2.5,null,18446744073709551615,1]"#), Some(serde_json::json!([3, 0, 0, 0, 0, 3, 1])));
    // Nobody posted, nobody among the seven, nothing that can be read, or no list: not said.
    for none in ["[]", "[0,0,0,0,0,0,0]", "[0,0,0,0,0,0,0,3]", r#"["3",2.5,true]"#, "3", r#""3""#, "null", r#"{"0":3}"#] {
      assert_eq!(guards(none), None, "{none}");
    }
  }

  #[test]
  fn the_camps_signposts_are_seven_places_or_none_and_not_said_when_none_was_moved() {
    let posts = |guards: &str, kept: &str| camp_summary(&format!(r#"{{"guards":{guards},"posts":{kept}}}"#)).expect("a camp").get("posts").cloned();
    let all = "[3,1,2,1,3,1,2]";
    // Every post carried somewhere: all seven in the guardians' order, but for the dragon, who has none.
    assert_eq!(
      posts(all, r#"{"0":[200,100],"1":[100,104],"2":[30,80],"3":[130,96],"4":[176,60],"5":[160,110],"6":[60,108]}"#),
      Some(serde_json::json!([[200, 100], [100, 104], [30, 80], [130, 96], null, [160, 110], [60, 108]]))
    );
    // Only the ones moved are kept: the rest are null, and the app stands them beside the building.
    assert_eq!(posts(all, r#"{"2":[30,80]}"#), Some(serde_json::json!([null, null, [30, 80], null, null, null, null])));
    // A guardian not posted has no signpost, wherever one was left.
    assert_eq!(
      posts("[3,0,2,0,0,0,0]", r#"{"0":[200,100],"1":[100,104],"2":[30,80],"6":[60,108]}"#),
      Some(serde_json::json!([[200, 100], null, [30, 80], null, null, null, null]))
    );
    // Outside the clearing: brought to its edge.
    assert_eq!(
      posts(all, r#"{"0":[-20,500],"1":[9999,-1],"3":[18446744073709551615,54],"6":[240,120]}"#),
      Some(serde_json::json!([[0, 120], [240, 0], null, [240, 54], null, null, [240, 120]]))
    );
    // A place that cannot be read is that post's loss alone, and a guardian there is not has none.
    assert_eq!(
      posts(all, r#"{"0":[200.5,100],"1":"left","2":[30],"3":{"x":130,"y":96},"5":null,"6":[60,108,7],"7":[50,60],"oak":[50,60]}"#),
      Some(serde_json::json!([null, null, null, null, null, null, [60, 108]]))
    );
    // Nothing moved, nothing that can be read, only the dragon's, or not kept by guardian: not said.
    for none in ["{}", r#"{"0":"left","1":[10]}"#, r#"{"4":[176,60]}"#, r#"{"7":[50,60]}"#, "[[200,100],[100,104],[30,80],[130,96],null,[160,110],[60,108]]", r#""0""#, "7", "null"] {
      assert_eq!(posts(all, none), None, "{none}");
    }
    // Nor with nobody posted, or no ranks that can be read.
    for nobody in ["[0,0,0,0,0,0,0]", "[]", "null", r#""3""#] {
      assert_eq!(posts(nobody, r#"{"0":[200,100]}"#), None, "{nobody}");
    }
    // A camp that never moved one says what it always said, to the byte.
    let unmoved = KEPT_CAMP.replacen(r#""hero": 1"#, r#""posts": {}, "hero": 1"#, 1);
    assert!(unmoved.contains("posts"));
    assert_eq!(camp_summary(&unmoved).expect("a camp").to_string(), camp_summary(KEPT_CAMP).expect("a camp").to_string());
    assert!(!camp_summary(KEPT_CAMP).expect("a camp").to_string().contains("posts"));
  }

  /// A summary with nothing built and no layout, and so many magpie camps beaten.
  fn summary_without_levels(camps: i64) -> serde_json::Value {
    serde_json::json!({
      "levels": { "burrow": 0, "oak": 0, "store": 0, "fence": 0, "tower": 0, "hut": 0 },
      "yard": [], "camps": camps, "banners": 0, "trophies": 0
    })
  }

  #[test]
  fn the_camps_layout_is_held_to_the_clearing_and_what_cannot_be_read_is_left_out() {
    let wild = serde_json::json!({
      "spots": {
        // Outside the clearing: brought to its edge.
        "oak": [-20, 500], "burrow": [9999, -1], "store": [240, 120], "tower": [0, 0],
        // Not a place: left out. Something more than a place: its first two numbers.
        "hut": [60.5, 100], "yard0": [160], "yard1": [190, 108, 7],
        "cellar": [50, 50]
      },
      "walls": [[10, 60], "a wall", [20], [30, 60.5], { "x": 40, "y": 60 }, null, [-5, 130], [18446744073709551615u64, 54]],
      "decor": [
        { "kind": 9, "x": 232, "y": 116 },
        // A kind no camp has is not taken for another.
        { "kind": 18, "x": 50, "y": 60 }, { "kind": -1, "x": 50, "y": 60 }, { "kind": "pond", "x": 50, "y": 60 }, { "kind": 1.5, "x": 50, "y": 60 },
        { "kind": 2, "x": "50", "y": 60 }, { "kind": 2, "x": 50 }, [2, 50, 60], null,
        { "kind": 4, "x": 900, "y": -3, "name": "Scarecrow" }
      ],
      // The landscape and the defences are read as things are, each held to its own kinds.
      "land": [
        { "kind": 9, "x": 12, "y": 70 },
        { "kind": 10, "x": 50, "y": 60 }, { "kind": -1, "x": 50, "y": 60 }, { "kind": "pond", "x": 50, "y": 60 }, { "kind": 0.5, "x": 50, "y": 60 },
        { "kind": 1, "x": 50.5, "y": 60 }, { "kind": 1, "y": 60 }, [1, 50, 60], "a knoll", null,
        { "kind": 0, "x": -40, "y": 4000, "name": "Pond" }
      ],
      "works": [
        { "kind": 12, "x": 50, "y": 60 }, { "kind": 17, "x": 50, "y": 60 }, { "kind": -1, "x": 50, "y": 60 }, { "kind": "moat", "x": 50, "y": 60 }, { "kind": 1, "x": null, "y": 60 },
        { "kind": 2, "x": 241, "y": 121, "cost": 400 }, { "kind": 0, "x": 100, "y": 100 }, { "kind": 11, "x": 60, "y": 90 },
        // One of a kind at most: a second is left out. One that could not be read was never the first.
        { "kind": 2, "x": 10, "y": 10 }, { "kind": 11, "x": 60, "y": 90 }, { "kind": 1, "x": 30, "y": 40 }, { "kind": 4, "x": 150, "y": 70 }
      ]
    })
    .to_string();
    let summary = camp_summary(&wild).expect("a camp");
    assert_eq!(
      summary["spots"],
      serde_json::json!({ "oak": [0, 120], "burrow": [240, 0], "store": [240, 120], "tower": [0, 0], "yard1": [190, 108] })
    );
    assert_eq!(summary["walls"], serde_json::json!([[10, 60], [0, 120], [240, 54]]));
    assert_eq!(summary["decor"], serde_json::json!([{ "kind": 9, "x": 232, "y": 116 }, { "kind": 4, "x": 240, "y": 0 }]));
    assert_eq!(summary["land"], serde_json::json!([{ "kind": 9, "x": 12, "y": 70 }, { "kind": 0, "x": 0, "y": 120 }]));
    assert_eq!(
      summary["works"],
      serde_json::json!([{ "kind": 2, "x": 240, "y": 120 }, { "kind": 0, "x": 100, "y": 100 }, { "kind": 11, "x": 60, "y": 90 }, { "kind": 1, "x": 30, "y": 40 }, { "kind": 4, "x": 150, "y": 70 }])
    );
    let sent = summary.to_string();
    for beside in ["Scarecrow", "Pond", "cost", "400"] {
      assert!(!sent.contains(beside), "{beside} in {sent}");
    }
  }

  #[test]
  fn the_camps_layout_is_capped_and_the_fullest_summary_stays_small() {
    let walls: Vec<[i64; 2]> = (0..33).map(|piece| [10 + piece * 5, 116]).collect();
    let decor: Vec<serde_json::Value> = (0..60).map(|thing| serde_json::json!({ "kind": thing % 10, "x": 232 - thing, "y": 116 })).collect();
    let land: Vec<serde_json::Value> = (0..50).map(|piece| serde_json::json!({ "kind": piece % 10, "x": 240 - piece, "y": 120 })).collect();
    let works: Vec<serde_json::Value> = (0..13).map(|work| serde_json::json!({ "kind": work % 12, "x": 200 + work, "y": 110 })).collect();
    let fullest = serde_json::json!({
      "levels": { "burrow": 5, "oak": 5, "store": 5, "fence": 5, "tower": 5, "hut": 5 },
      "yard": [ { "kind": "workshop", "level": 3 }, { "kind": "workshop", "level": 3 } ],
      "camps": 100_000,
      "banners": vec!["2026-10"; 1200],
      "raised": vec!["a-book"; 400],
      "spots": { "oak": [218, 110], "burrow": [218, 110], "store": [218, 110], "tower": [218, 110], "hut": [218, 110], "yard0": [218, 110], "yard1": [218, 110] },
      "walls": walls,
      "decor": decor,
      "land": land,
      "works": works,
      "guards": [3, 3, 3, 3, 3, 3, 3, 3, 3],
      "posts": { "0": [218, 110], "1": [218, 110], "2": [218, 110], "3": [218, 110], "4": [218, 110], "5": [218, 110], "6": [218, 110], "7": [218, 110], "8": [218, 110] }
    })
    .to_string();
    let summary = camp_summary(&fullest).expect("a camp");
    // The first thirty-two pieces of fence (the thirty-third is not kept) and the first two dozen things, in the order kept.
    let kept_walls = summary["walls"].as_array().expect("a list");
    assert_eq!(kept_walls.len(), 32);
    assert_eq!((&kept_walls[0], &kept_walls[31]), (&serde_json::json!([10, 116]), &serde_json::json!([165, 116])));
    let kept_decor = summary["decor"].as_array().expect("a list");
    assert_eq!(kept_decor.len(), 24);
    assert_eq!(kept_decor[23], serde_json::json!({ "kind": 3, "x": 209, "y": 116 }));
    assert_eq!(summary["spots"].as_object().expect("an object").len(), 7);
    // The first thirty pieces of landscape, the first twelve defences (one of each kind), and seven ranks.
    let kept_land = summary["land"].as_array().expect("a list");
    assert_eq!(kept_land.len(), 30);
    assert_eq!((&kept_land[0], &kept_land[29]), (&serde_json::json!({ "kind": 0, "x": 240, "y": 120 }), &serde_json::json!({ "kind": 9, "x": 211, "y": 120 })));
    let kept_works: Vec<serde_json::Value> = (0..12).map(|work| serde_json::json!({ "kind": work, "x": 200 + work, "y": 110 })).collect();
    assert_eq!(summary["works"], serde_json::Value::from(kept_works));
    assert_eq!(summary["guards"], serde_json::json!([3, 3, 3, 3, 3, 3, 3]));
    // Seven signposts, the dragon's never one of them.
    assert_eq!(summary["posts"], serde_json::json!([[218, 110], [218, 110], [218, 110], [218, 110], null, [218, 110], [218, 110]]));
    let sent = summary.to_string();
    assert!(sent.len() < 3072, "{} bytes: {sent}", sent.len());

    // The same with every number as long as it can be written (2588 bytes): still small.
    let widest = serde_json::json!({
      "levels": { "burrow": 5, "oak": 5, "store": 5, "fence": 5, "tower": 5, "hut": 5 },
      "yard": [ { "kind": "workshop", "level": 3 }, { "kind": "workshop", "level": 3 } ],
      "camps": 100_000,
      "banners": vec!["2026-10"; 100_000],
      "raised": vec!["a-book"; 100_000],
      "spots": { "oak": [240, 120], "burrow": [240, 120], "store": [240, 120], "tower": [240, 120], "hut": [240, 120], "yard0": [240, 120], "yard1": [240, 120] },
      "walls": vec![[240, 120]; 32],
      "decor": vec![serde_json::json!({ "kind": 17, "x": 240, "y": 120 }); 24],
      "land": vec![serde_json::json!({ "kind": 9, "x": 240, "y": 120 }); 30],
      "works": (0..12).map(|work| serde_json::json!({ "kind": work, "x": 240, "y": 120 })).collect::<Vec<_>>(),
      "guards": [3, 3, 3, 3, 3, 3, 3],
      "posts": { "0": [240, 120], "1": [240, 120], "2": [240, 120], "3": [240, 120], "5": [240, 120], "6": [240, 120] }
    })
    .to_string();
    let sent = camp_summary(&widest).expect("a camp").to_string();
    assert_eq!(sent.len(), 2588, "{sent}");
    assert!(sent.len() < 3072, "{} bytes: {sent}", sent.len());
  }

  #[test]
  fn a_camp_that_cannot_be_read_has_no_summary_and_a_part_that_cannot_says_nothing() {
    for unreadable in ["", "not json", "[1,2,3]", "7", "null", "\"camp\""] {
      assert_eq!(camp_summary(unreadable), None, "{unreadable}");
    }
    let nothing = serde_json::json!({
      "levels": { "burrow": 0, "oak": 0, "store": 0, "fence": 0, "tower": 0, "hut": 0 },
      "yard": [], "camps": 0, "banners": 0, "trophies": 0
    });
    // A camp with nothing in it, the first version's, and one whose every part is the wrong type.
    assert_eq!(camp_summary("{}"), Some(nothing.clone()));
    assert_eq!(camp_summary(r#"{"v":1,"acorns":20,"levels":{"burrow":1}}"#).expect("a camp")["levels"]["burrow"], 1);
    let wrong = r#"{"levels":[3,2,2],"yard":{"kind":"workshop","level":1},"camps":"7","banners":4,"raised":{"a":1}}"#;
    assert_eq!(camp_summary(wrong), Some(nothing));

    // One building of the wrong type is that building's loss alone.
    let partly = camp_summary(r#"{"levels":{"burrow":"3","oak":2.5,"store":null,"fence":true,"tower":4,"cellar":5}}"#).expect("a camp");
    assert_eq!(partly["levels"], serde_json::json!({ "burrow": 0, "oak": 0, "store": 0, "fence": 0, "tower": 4, "hut": 0 }));
  }

  #[test]
  fn the_camp_summary_is_held_to_what_a_camp_can_be() {
    let wild = serde_json::json!({
      "levels": { "burrow": 6, "oak": -1, "store": 99, "fence": 5, "tower": 0, "hut": 18446744073709551615u64 },
      "yard": [
        { "kind": "hive", "level": 9 },
        { "kind": "castle", "level": 2 },
        { "kind": "well", "level": 1 }
      ],
      "camps": 5_000_000,
      "banners": vec!["2026-10"; 3],
      "raised": vec!["a-book"; 100_001]
    })
    .to_string();
    assert_eq!(
      camp_summary(&wild),
      Some(serde_json::json!({
        "levels": { "burrow": 5, "oak": 0, "store": 5, "fence": 5, "tower": 0, "hut": 5 },
        // Two plots at most; a thing no yard holds is an empty plot, in its place.
        "yard": [ { "kind": "hive", "level": 3 }, { "kind": null, "level": 0 } ],
        "camps": 100_000, "banners": 3, "trophies": 100_000
      }))
    );
    // A plot that is not a plot at all, a level that is not a number, a count below nothing.
    let odd = camp_summary(r#"{"yard":["workshop",{"kind":"stall","level":"2"}],"camps":-4}"#).expect("a camp");
    assert_eq!(odd["yard"], serde_json::json!([{ "kind": null, "level": 0 }, { "kind": "stall", "level": 0 }]));
    assert_eq!(odd["camps"], 0);
  }

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
    doc.days.push(DayEntry { date_key: day.into(), minutes, goal_minutes: 20, freeze_used: false, grace_used: false, by_device: Default::default() });
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

  // ---- more to buy with seeds: freezes, stakes, gifts, badges ------------------

  const DUEL: &str = "0123456789abcdef01234567";
  const OTHER: &str = "89abcdef0123456789abcdef";
  const THIRD: &str = "fedcba9876543210fedcba98";

  /// A week's stake on the goal, as the shop records one.
  fn goal_stake(id: &str, week: &str, seeds: i64, days: i64, at: &str) -> pip::Purchase {
    purchase(id, pip::stakes::KIND_STAKE, &pip::stakes::goal_item_id(week, days), seeds, at)
  }

  fn met(doc: &mut SyncDoc, day: &str) {
    doc.days.push(DayEntry { date_key: day.into(), minutes: 25.0, goal_minutes: 20, freeze_used: false, grace_used: false, by_device: Default::default() });
  }

  /// One reader, a laptop and a phone, each staking on the same week and
  /// each told how the same duel went before they synced. After the merge
  /// one stake is charged and paid, and the duel pays one prize.
  #[test]
  fn stakes_are_charged_and_paid_once_across_a_sync() {
    let mut laptop = SyncDoc::empty(NOW);
    laptop.purchases.push(goal_stake("buy-a1", "2026-W41", 20, 3, "2026-10-05T08:00:00+05:30"));
    laptop.purchases.push(purchase("buy-a2", "stake", &format!("duel:{DUEL}"), 10, "2026-10-05T09:00:00+05:30"));
    laptop.purchases.push(purchase("buy-a3", "prize", &format!("duel:{DUEL}"), 20, "2026-10-07T09:00:00+05:30"));
    for day in ["2026-10-05", "2026-10-06"] {
      met(&mut laptop, day);
    }
    let mut phone = SyncDoc::empty(NOW);
    phone.purchases.push(goal_stake("buy-b1", "2026-W41", 50, 4, "2026-10-06T08:00:00+05:30"));
    phone.purchases.push(purchase("buy-a2", "stake", &format!("duel:{DUEL}"), 10, "2026-10-05T09:00:00+05:30"));
    phone.purchases.push(purchase("buy-b3", "prize", &format!("duel:{DUEL}"), 20, "2026-10-07T10:00:00+05:30"));
    for day in ["2026-10-07", "2026-10-08"] {
      met(&mut phone, day);
    }

    let spent = |ledger: &PipLedger| pip::spent(pip::Catalogue::bundled(), &ledger.purchases);
    let alone = ledger_of(&laptop);
    assert_eq!((alone.earned.stakes, alone.earned.prizes, spent(&alone)), (0, 20, 30), "two days are not three yet");

    let both = ledger_of(&merge(&laptop, &phone, NOW));
    // Four days read between them: the laptop's stake on three is won, and
    // it is the week's stake. The phone's is neither charged nor paid.
    assert_eq!(both.earned.stakes, 24);
    assert_eq!(both.earned.prizes, 20, "one prize a duel, however many devices were told");
    assert_eq!(spent(&both), 30);
    assert!(both.owned.iter().all(|(kind, _)| kind != "stake" && kind != "prize"));
    // Every device works out the same, and syncing again changes nothing.
    let other_way = ledger_of(&merge(&phone, &laptop, NOW));
    assert_eq!(other_way.earned, both.earned);
    assert_eq!(spent(&other_way), 30);
    // What a stake or a duel won is not in the level's seeds: only what was earned.
    assert_eq!(both.level().earned, both.earned.total - both.earned.stakes - both.earned.prizes);
  }

  /// Ten goal days in a row from before the garden, when a goal day paid
  /// well: seeds enough to spend in a test.
  fn rich(db: &db::Database) {
    for date in 1..=10 {
      db.credit_minutes(&format!("2026-09-{date:02}"), 25.0, 20).expect("a day");
    }
  }

  fn freeze_catalogue() -> pip::Catalogue {
    pip::Catalogue::parse(r#"{"items":[{"kind":"freeze","id":"freeze","price":30,"consumable":true}]}"#).expect("parses")
  }

  fn freezes_on_record(db: &db::Database) -> Vec<pip::Purchase> {
    db.pip_purchases()
      .expect("purchases")
      .into_iter()
      .filter(|purchase| purchase.item_kind == pip::freezes::KIND_FREEZE)
      .collect()
  }

  #[test]
  fn a_freeze_bought_is_charged_counted_and_put_in_the_streaks_bank() {
    let db = memory_db();
    let today = local_today();
    let before = pip_overview_on(&db, &today).expect("overview");
    assert_eq!((before.freezes.held, before.freezes.bought_this_month, before.freezes.cap), (0, 0, habit::MAX_FREEZES));

    let after = buy_freeze(&db, &freeze_catalogue(), &today).expect("bought");
    assert_eq!(after.wallet.balance, before.wallet.balance - 30);
    assert_eq!(after.wallet.spent, before.wallet.spent + 30);
    assert_eq!((after.freezes.held, after.freezes.bought_this_month), (1, 1));
    assert_eq!(read_streak_state(&db).freezes, 1);
    let records = freezes_on_record(&db);
    assert_eq!(records.len(), 1);
    assert_eq!((records[0].item_id.as_str(), records[0].price), ("freeze", 30));
    assert!(after.owned.iter().all(|thing| thing.kind != "freeze"), "a freeze is used, not owned");

    // The welcome gift does not stretch to a second: nothing is taken, nothing banked.
    assert!(buy_freeze(&db, &freeze_catalogue(), &today).is_err());
    assert_eq!(freezes_on_record(&db).len(), 1);
    assert_eq!(read_streak_state(&db).freezes, 1);
  }

  #[test]
  fn two_freezes_a_month_and_never_more_than_the_bank_holds() {
    let db = memory_db();
    rich(&db);
    let today = local_today();
    buy_freeze(&db, &freeze_catalogue(), &today).expect("the first");
    // A second in the same month fills the bank.
    let after = buy_freeze(&db, &freeze_catalogue(), &today).expect("the second");
    assert_eq!((after.freezes.held, after.freezes.bought_this_month), (2, 2));
    let full = buy_freeze(&db, &freeze_catalogue(), &today).err().expect("the bank is full");
    assert!(full.contains("room"), "{full}");
    // With room in the bank again, the month is what stops a third.
    write_streak_state(&db, &habit::StreakState { freezes: 0, ..read_streak_state(&db) }).expect("streak state");
    let month = buy_freeze(&db, &freeze_catalogue(), &today).err().expect("the month is used up");
    assert!(month.contains("month"), "{month}");
    assert_eq!(freezes_on_record(&db).len(), 2);
    assert_eq!(read_streak_state(&db).freezes, 0, "a refusal banks nothing");
  }

  #[test]
  fn a_catalogue_with_no_freeze_sells_none_and_says_so_in_the_overview() {
    let db = memory_db();
    let bare = pip::Catalogue::parse(r#"{"items":[]}"#).expect("parses");
    assert_eq!(buy_freeze(&db, &bare, &local_today()).err(), Some(pip::ShopError::Unknown.to_string()));
    assert!(freezes_on_record(&db).is_empty());
    let shop = freeze_shop(&db, &bare, &[], "2026-10-11");
    assert_eq!((shop.price, shop.per_month), (0, 0));
    let stocked = freeze_shop(&db, &freeze_catalogue(), &[], "2026-10-11");
    assert_eq!((stocked.price, stocked.per_month), (30, pip::freezes::FREEZES_PER_MONTH));
  }

  #[test]
  fn only_the_readers_today_is_taken_for_today() {
    let now = chrono::Local::now().date_naive();
    let day = |offset: i64| (now + chrono::Duration::days(offset)).format("%Y-%m-%d").to_string();
    for near in [-1, 0, 1] {
      assert!(is_today(&day(near)).is_ok(), "{near}");
    }
    for far in [-40, -2, 2, 40] {
      assert!(is_today(&day(far)).is_err(), "{far}");
    }
    assert!(is_today("Wednesday").is_err());
  }

  #[test]
  fn a_goal_stake_is_spent_at_once_and_pays_when_the_days_are_read() {
    let db = memory_db();
    // Monday 5 October 2026.
    let before = pip_overview_on(&db, "2026-10-05").expect("overview");
    assert!(before.goal_stake.is_none());
    assert_eq!((before.level.level, before.level.earned), (1, before.wallet.earned.total));

    let staked = stake_goal(&db, 20, 3, "2026-10-05").expect("staked");
    assert_eq!(staked.wallet.balance, before.wallet.balance - 20);
    assert_eq!(staked.wallet.earned.stakes, 0);
    let view = staked.goal_stake.expect("this week's stake");
    assert_eq!(
      (view.week_key.as_str(), view.seeds, view.days, view.met, view.state, view.payout),
      ("2026-W41", 20, 3, 0, "open", 24)
    );
    // One a week.
    assert!(stake_goal(&db, 5, 4, "2026-10-06").is_err());

    for day in ["2026-10-05", "2026-10-06"] {
      db.credit_minutes(day, 25.0, 20).expect("a day read");
    }
    let two = pip_overview_on(&db, "2026-10-06").expect("overview");
    assert_eq!((two.wallet.earned.stakes, two.goal_stake.map(|view| view.met)), (0, Some(2)));

    // The third day: won there and then, with the week still running.
    db.credit_minutes("2026-10-08", 25.0, 20).expect("a day read");
    let won = pip_overview_on(&db, "2026-10-08").expect("overview");
    assert_eq!(won.wallet.earned.stakes, 24);
    assert_eq!(won.wallet.spent, before.wallet.spent + 20);
    assert_eq!(won.goal_stake.map(|view| (view.state, view.met, view.payout)), Some(("won", 3, 24)));
    assert_eq!(
      won.level.earned,
      won.wallet.earned.total - won.wallet.earned.stakes - won.wallet.earned.prizes,
      "what a stake wins is seeds moved about: it raises no level"
    );
    // Nothing of the outcome was written down: one record, the stake itself.
    let records = db.pip_purchases().expect("purchases");
    assert_eq!(records.len(), 1);
    assert_eq!((records[0].item_kind.as_str(), records[0].item_id.as_str(), records[0].price), ("stake", "goal:2026-W41:3", 20));
  }

  #[test]
  fn a_goal_stake_refused_takes_nothing() {
    let db = memory_db();
    // Thursday is too late; more than the balance is too much.
    assert!(stake_goal(&db, 20, 3, "2026-10-08").is_err());
    assert!(stake_goal(&db, 100, 3, "2026-10-05").is_err(), "the welcome gift is fifty");
    assert!(stake_goal(&db, 3, 3, "2026-10-05").is_err());
    assert!(db.pip_purchases().expect("purchases").is_empty());
    let rules = pip_overview_on(&db, "2026-10-05").expect("overview").stake_rules;
    assert_eq!(
      (rules.min_seeds, rules.max_seeds, rules.min_days, rules.max_days, rules.last_weekday),
      (5, 100, 3, 7, 3)
    );
    assert_eq!((rules.duel_min_seeds, rules.duel_max_seeds), (1, 50));
  }

  #[test]
  fn a_duel_stake_is_taken_once_and_settled_once() {
    let db = memory_db();
    let start = pip_overview(&db).expect("overview").wallet.balance;
    assert!(settle_duel(&db, DUEL, "won").is_err(), "nothing was staked on it");

    let staked = stake_duel(&db, DUEL, 20).expect("staked");
    assert_eq!(staked.wallet.balance, start - 20);
    // Asked again, with other seeds: the first stake stands.
    let again = stake_duel(&db, DUEL, 30).expect("no second stake");
    assert_eq!(again.wallet.balance, start - 20);
    assert_eq!(db.pip_purchases().expect("purchases").len(), 1);

    let won = settle_duel(&db, DUEL, "won").expect("settled");
    assert_eq!((won.wallet.earned.prizes, won.wallet.balance), (40, start + 20));
    // Told again, or told otherwise: the prize on record stands.
    for outcome in ["won", "tied", "lost"] {
      let told = settle_duel(&db, DUEL, outcome).expect("already settled");
      assert_eq!((told.wallet.earned.prizes, told.wallet.balance), (40, start + 20), "{outcome}");
    }
    assert_eq!(db.pip_purchases().expect("purchases").len(), 2);

    // A tie gives the stake back; a loss records nothing.
    stake_duel(&db, OTHER, 10).expect("staked");
    let tied = settle_duel(&db, OTHER, "tied").expect("settled");
    assert_eq!((tied.wallet.earned.prizes, tied.wallet.balance), (50, start + 20));
    stake_duel(&db, THIRD, 5).expect("staked");
    let lost = settle_duel(&db, THIRD, "lost").expect("settled");
    assert_eq!((lost.wallet.earned.prizes, lost.wallet.balance), (50, start + 15));
    let records = db.pip_purchases().expect("purchases");
    assert_eq!(records.iter().filter(|record| record.item_kind == "prize").count(), 2);
    assert!(lost.owned.iter().all(|thing| thing.kind != "stake" && thing.kind != "prize"));
  }

  #[test]
  fn a_duel_stake_or_outcome_that_makes_no_sense_is_refused() {
    let db = memory_db();
    assert!(stake_duel(&db, "the-big-one", 5).is_err());
    assert!(stake_duel(&db, DUEL, 0).is_err());
    assert!(stake_duel(&db, DUEL, 51).is_err());
    assert!(db.pip_purchases().expect("purchases").is_empty());
    stake_duel(&db, DUEL, 50).expect("all the welcome gift");
    assert!(stake_duel(&db, OTHER, 1).is_err(), "nothing left to stake");
    assert!(settle_duel(&db, DUEL, "abandoned").is_err());
    assert!(settle_duel(&db, OTHER, "won").is_err());
    assert_eq!(db.pip_purchases().expect("purchases").len(), 1);
  }

  /// The cheapest thing in the shop that can be given, and that any reader
  /// may buy.
  fn something_to_give() -> &'static pip::Item {
    pip::Catalogue::bundled()
      .items()
      .filter(|item| pip::gifts::giftable(item) && item.level == 0 && item.sessions == 0)
      .min_by(|a, b| a.price.cmp(&b.price).then_with(|| a.id.cmp(&b.id)))
      .expect("something to give")
  }

  #[test]
  fn a_gift_is_paid_for_once_and_is_not_the_senders() {
    let db = memory_db();
    rich(&db);
    let thing = something_to_give();
    let before = pip_overview(&db).expect("overview");

    let sent = send_gift(&db, &thing.kind, &thing.id, DUEL).expect("sent");
    assert_eq!(sent.wallet.balance, before.wallet.balance - thing.price);
    assert!(!sent.owned.iter().any(|owned| owned.kind == thing.kind && owned.id == thing.id), "the friend's, not the sender's");
    assert!(sent.owned.iter().all(|owned| owned.kind != "gift"));
    // The same gift asked again changes nothing; another gift of the same
    // thing is another purchase.
    assert_eq!(send_gift(&db, &thing.kind, &thing.id, DUEL).expect("again").wallet.balance, sent.wallet.balance);
    let second = send_gift(&db, &thing.kind, &thing.id, OTHER).expect("to another friend");
    assert_eq!(second.wallet.balance, before.wallet.balance - 2 * thing.price);
    let records = db.pip_purchases().expect("purchases");
    assert_eq!(records.len(), 2);
    assert!(records.iter().all(|record| record.item_kind == "gift" && record.price == thing.price));
    assert!(records.iter().any(|record| record.item_id == format!("{}:{}:{DUEL}", thing.kind, thing.id)));

    // What is not a gift, and what is not a gift's id.
    assert!(send_gift(&db, "level", "kitchen", THIRD).is_err());
    assert!(send_gift(&db, "treat", "nothing-of-the-kind", THIRD).is_err());
    assert!(send_gift(&db, &thing.kind, &thing.id, "a-gift").is_err());
    assert_eq!(db.pip_purchases().expect("purchases").len(), 2);
  }

  #[test]
  fn a_gift_received_is_owned_for_nothing_and_arrives_once() {
    let db = memory_db();
    let thing = something_to_give();
    let before = pip_overview(&db).expect("overview");

    let got = receive_gift(&db, &thing.kind, &thing.id, DUEL).expect("received");
    assert!(got.owned.iter().any(|owned| owned.kind == thing.kind && owned.id == thing.id));
    assert_eq!(got.wallet.spent, before.wallet.spent, "given, not bought");
    let records = db.pip_purchases().expect("purchases");
    assert_eq!(records.len(), 1);
    assert_eq!((records[0].id.as_str(), records[0].price), (format!("gift-{DUEL}").as_str(), 0));
    assert_eq!((records[0].item_kind.as_str(), records[0].item_id.as_str()), (thing.kind.as_str(), thing.id.as_str()));

    // The same gift again, or another of what Pip now has: nothing more, and no error.
    receive_gift(&db, &thing.kind, &thing.id, DUEL).expect("again");
    receive_gift(&db, &thing.kind, &thing.id, OTHER).expect("already Pip's");
    assert_eq!(db.pip_purchases().expect("purchases").len(), 1);
    // And it cannot then be bought.
    let level = pip_ledger(&db).expect("ledger").level().level;
    let owned = pip::owned(pip::Catalogue::bundled(), &db.pip_purchases().expect("purchases"));
    assert_eq!(
      pip::check_buy(pip::Catalogue::bundled(), &owned, 9999, 99, level, &thing.kind, &thing.id),
      Err(pip::ShopError::AlreadyOwned)
    );

    // Not everything can arrive as a gift.
    assert!(receive_gift(&db, "level", "kitchen", THIRD).is_err());
    assert!(receive_gift(&db, &thing.kind, "nothing-of-the-kind", THIRD).is_err());
    assert!(receive_gift(&db, &thing.kind, &thing.id, "a-gift").is_err());
  }

  fn finished_book(id: &str) -> BookRecord {
    BookRecord {
      id: id.to_string(),
      title: id.to_string(),
      author: None,
      genres: Vec::new(),
      cover_url: None,
      local_path: format!("/{id}.epub"),
      file_hash: id.to_string(),
      progress: 1.0,
      position: None,
      series: None,
      series_index: None,
      last_opened: None,
      created_at: "2026-01-01T00:00:00+00:00".to_string(),
      metadata_checked_at: None,
      metadata_updated_at: None,
      progress_updated_at: None,
      finished_at: None,
      deleted_at: None,
      available: true
    }
  }

  #[test]
  fn badges_and_the_profiles_extras_are_read_from_the_records() {
    let db = memory_db();
    let new = social_extras(&db, "2026-10-11").expect("extras");
    assert_eq!(new, SocialExtras { level: 1, badges: Vec::new(), arcade: (0, 0, 0), camp: None });

    // A long day's reading, a streak on record, a book finished, two scores.
    db.credit_minutes("2026-10-02", 130.0, 20).expect("a day");
    let streak = habit::StreakState { current_streak: 3, longest_streak: 8, ..Default::default() };
    write_streak_state(&db, &streak).expect("streak state");
    db.upsert_book(&finished_book("dune")).expect("book");
    let mut arcade = pip::Arcade::default();
    arcade.best.insert("dash".into(), 140);
    arcade.best.insert("flap".into(), 30);
    db.set_setting(ARCADE_SETTING, &serde_json::to_string(&arcade).expect("encodes")).expect("arcade");

    let extras = social_extras(&db, "2026-10-11").expect("extras");
    assert_eq!(extras.badges, vec!["streak-7", "books-1", "marathon-120", "arcade-dash-100", "arcade-flap-25"]);
    assert_eq!((extras.level, extras.arcade), (1, (140, 0, 30)));
    assert_eq!(extras.camp, None, "no camp kept yet");

    // A camp, once the game has saved one: its summary, not the camp.
    save_base(&db, KEPT_CAMP, NOW).expect("saved");
    let camp = social_extras(&db, "2026-10-11").expect("extras").camp.expect("a camp");
    assert_eq!((camp["levels"]["burrow"].as_i64(), camp["trophies"].as_i64()), (Some(3), Some(14)));
    assert!(camp.get("raised").is_none() && camp.get("acorns").is_none());

    // The whole list says how far along the rest are, this month's too.
    let Standing { badges: all, level, .. } = standing(&db, "2026-10-11").expect("badges");
    assert_eq!(level, 1);
    let of = |id: &str| all.iter().find(|badge| badge.id == id).map(|badge| (badge.earned, badge.value));
    assert_eq!(of("streak-30"), Some((false, 8.0)));
    assert_eq!(of("month-2026-10-500"), Some((false, 130.0)));
    assert_eq!(of("collector-10"), Some((false, 0.0)));
    assert!(all.len() > extras.badges.len());
    // Asking walked no streak: the state is as it was.
    let after = read_streak_state(&db);
    assert_eq!((after.current_streak, after.longest_streak, after.last_evaluated_day), (3, 8, None));
  }

  // ---- the fridge ------------------------------------------------------------

  /// Pip's mood as stored (these tests run in a moment: nothing has drifted).
  fn stored_mood(db: &db::Database) -> f64 {
    stored_pip_state(db).expect("state").mood
  }

  fn near(left: f64, right: f64) -> bool {
    (left - right).abs() < 1e-3
  }

  /// A snack on the record, bought at `at_ms`.
  fn buy_snack(db: &db::Database, at_ms: i64) {
    let at = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(at_ms).expect("a time").to_rfc3339();
    let snack = pip::Catalogue::bundled().items().find(|item| item.kind == "treat" && item.consumable).expect("the catalogue sells a snack");
    db.insert_pip_purchase(&pip::Purchase { id: format!("buy-snack-{at_ms}"), item_kind: "treat".into(), item_id: snack.id.clone(), price: snack.price, bought_at: at })
      .expect("purchase");
  }

  #[test]
  fn finding_the_fridge_bare_saddens_pip_a_little_and_only_once_a_day() {
    let db = memory_db();
    let now = chrono::Utc::now().timestamp_millis();
    let start = stored_mood(&db);
    assert_eq!(start, habit::seeds::MOOD_START);

    // The first look of the day at a fridge nobody has stocked.
    let took = find_fridge_bare(&db, "2026-10-13", now).expect("looked");
    assert!(near(took, pip::fridge::BARE_MOOD), "{took}");
    assert!(near(stored_mood(&db), start - pip::fridge::BARE_MOOD));
    // However often she looks again that day, it takes no more.
    for _ in 0..5 {
      assert_eq!(find_fridge_bare(&db, "2026-10-13", now), Ok(0.0));
    }
    assert!(near(stored_mood(&db), start - pip::fridge::BARE_MOOD));
    // The next day she looks, once more; a day nobody opened the app in between cost nothing.
    assert!(near(find_fridge_bare(&db, "2026-10-16", now).expect("looked"), pip::fridge::BARE_MOOD));
    assert!(near(stored_mood(&db), start - 2.0 * pip::fridge::BARE_MOOD));

    // It is said in the mood log, as a loss (the two looks here are a moment apart by the clock, whatever
    // days they were called, so the log has them as one line: `pip::log_mood`), and the overview says today's is taken.
    let log = read_mood_log(&db);
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].cause, pip::fridge::CAUSE_BARE);
    assert!(near(log[0].gain, -2.0 * pip::fridge::BARE_MOOD), "{}", log[0].gain);
    assert!(near(log[0].mood, start - 2.0 * pip::fridge::BARE_MOOD));
    let overview = pip_overview_on(&db, "2026-10-16").expect("overview");
    assert!(overview.fridge.minded_today);
    assert_eq!(overview.fridge.stocked_until, None);
    assert_eq!(overview.mood_rules.bare_fridge, pip::fridge::BARE_MOOD);
    assert!(!pip_overview_on(&db, "2026-10-17").expect("overview").fridge.minded_today);
  }

  #[test]
  fn a_bare_fridge_never_takes_pip_below_the_floor_being_away_stops_at() {
    let db = memory_db();
    let now = chrono::Utc::now().timestamp_millis();
    let floor = habit::seeds::MOOD_DRIFT_FLOOR;
    let mut state = stored_pip_state(&db).expect("state");
    state.mood = floor + 1.0;
    db.put_pip_state(&state).expect("saved");

    // A point above the floor: it takes the point, not the three.
    assert!(near(find_fridge_bare(&db, "2026-10-13", now).expect("looked"), 1.0));
    assert!(near(stored_mood(&db), floor));
    // At the floor it takes nothing, day after day, and nothing is written or said.
    let at_floor = stored_pip_state(&db).expect("state");
    for day in 14..30 {
      assert_eq!(find_fridge_bare(&db, &format!("2026-10-{day}"), now), Ok(0.0));
    }
    assert_eq!(stored_pip_state(&db).expect("state"), at_floor);
    assert_eq!(read_mood_log(&db).len(), 1);

    // A Pip already under the floor (away under the old rule) is left where she is.
    let mut low = stored_pip_state(&db).expect("state");
    low.mood = 12.5;
    db.put_pip_state(&low).expect("saved");
    assert_eq!(find_fridge_bare(&db, "2026-11-01", now), Ok(0.0));
    assert_eq!(stored_mood(&db), 12.5);
  }

  #[test]
  fn a_stocked_fridge_costs_nothing_whatever_the_webview_says() {
    let db = memory_db();
    let now = chrono::Utc::now().timestamp_millis();
    let hour = 3_600_000;
    let start = stored_mood(&db);
    buy_snack(&db, now - hour);

    // Food in it: she is not saddened, and today's look is not used up.
    assert_eq!(find_fridge_bare(&db, "2026-10-13", now), Ok(0.0));
    assert_eq!(stored_mood(&db), start);
    assert_eq!(read_bare_fridge(&db), pip::fridge::BareFridge::default());
    let overview = pip_overview_on(&db, "2026-10-13").expect("overview");
    let until = overview.fridge.stocked_until.as_deref().map(millis).expect("stocked");
    assert_eq!(until, now - hour + pip::fridge::HOURS_PER_SNACK * hour);
    assert!(!overview.fridge.minded_today);

    // A day later it has run out, and then she minds.
    let later = now + pip::fridge::HOURS_PER_SNACK * hour;
    assert!(near(find_fridge_bare(&db, "2026-10-14", later).expect("looked"), pip::fridge::BARE_MOOD));
    // Stocking it again mends the fridge; the mood is the snack's to lift, as it always was.
    buy_snack(&db, later);
    assert_eq!(find_fridge_bare(&db, "2026-10-15", later + hour), Ok(0.0));
  }
}
