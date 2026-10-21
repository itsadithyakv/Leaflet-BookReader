//! Pip's earned things: the skins (and anything else marked `earnedOnly` in the
//! catalogue) that are never sold, only earned by reading.
//!
//! Every rule is here, against the words the wardrobe shows for it (`unlock`
//! in `apps/src/pip/skins.js`). Each is read from the reader's own records,
//! like the badges: the day ledger and the streak walked from it, the books
//! and when each was opened and finished, the focus sessions. So there is no
//! "granted" flag for two devices to disagree about, and a thing earned in an
//! earlier version is earned at once by a reader who already did it.
//!
//! Some of those records do not last for ever (a removed book's row is purged
//! once its removal has reached every device, and when a book was opened is
//! kept on this device alone), so a thing once earned is also written down: a
//! record in the purchase ledger at price 0 under an id of its own
//! (`record_id`), as a gift that arrives is. Records merge as a union, so it
//! reaches every device, and nothing ever takes one back. An earlier version
//! reading it owns the thing too.
//!
//! Pure: the caller (`commands::pip_shop::earned_now`) gathers the facts, in
//! the reader's local time; nothing here reads a database or a clock.

use super::{own, Catalogue, Purchase};
use crate::habit::DayRecord;
use chrono::{Datelike, NaiveDate, NaiveDateTime, Timelike};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::sync::LazyLock;

// ---- the marks, one per unlock text ---------------------------------------------

/// "Keep a 7-day streak." (Maple), "Keep a 30-day streak." (Sakura), "Keep a
/// 365-day streak." (Golden Pip): the longest streak ever, as the header's
/// flame counts it (a day kept by grace or a freeze counts).
pub const MAPLE_STREAK: i64 = 7;
pub const SAKURA_STREAK: i64 = 30;
pub const GOLDEN_STREAK: i64 = 365;
/// "Finish 5 books." (Bookworm), counted as the reader's card counts them.
pub const BOOKWORM_BOOKS: i64 = 5;
/// "Finish 3 mystery / fantasy / science fiction books."
pub const GENRE_BOOKS: i64 = 3;
/// "Read 100 hours in total." (Midnight Ink), in minutes on the day ledger.
pub const INK_MINUTES: f64 = 100.0 * 60.0;
/// "Read before 8 am on 10 days." (Early Bird) and "Read after 10 pm on 10
/// nights." (Night Owl).
pub const EARLY_DAYS: usize = 10;
pub const LATE_NIGHTS: usize = 10;
/// A morning is from 4 am to 8 am; a night from 10 pm to 4 am, and belongs to
/// the evening it began on (reading at 1 am on the 2nd is the night of the 1st).
pub const MORNING_FROM_HOUR: u32 = 4;
pub const MORNING_UNTIL_HOUR: u32 = 8;
pub const NIGHT_FROM_HOUR: u32 = 22;
/// "Finish a book you'd set aside for 30+ days." (Prickly): two days the book
/// was read on, with this many days or more between them, before it was finished.
pub const ASIDE_DAYS: i64 = 30;
/// "Finish a whole book in one sitting." (Cartridge): a sitting is one focus
/// session. Its end may be stamped a little after the book's finish.
pub const SITTING_SLACK_MS: i64 = 10 * 60 * 1000;
/// A day counts as read on (Halloween, the longest night) with this much reading.
pub const READ_MINUTES: f64 = 1.0;

/// The record id that writes down a thing earned: one per thing, so two
/// devices earning it are one record after a sync.
pub fn record_id(kind: &str, id: &str) -> String {
  format!("earned-{kind}-{id}")
}

/// The record for a thing earned, stamped `at` (local time with its offset).
pub fn record(kind: &str, id: &str, at: &str) -> Purchase {
  Purchase { id: record_id(kind, id), item_kind: kind.to_string(), item_id: id.to_string(), price: 0, bought_at: at.to_string() }
}

// ---- the facts ------------------------------------------------------------------

/// Which half of the world the reader is in: the longest night is in December
/// in the north and in June in the south.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hemisphere {
  North,
  South
}

/// Time zones south of the equator (IANA names). Anything else, or a zone
/// that cannot be read, is taken to be the north, where most readers are.
const SOUTHERN_PREFIXES: [&str; 3] = ["Australia/", "Antarctica/", "America/Argentina/"];
const SOUTHERN_ZONES: [&str; 77] = [
  "Antarctica", "NZ", "NZ-CHAT", "Brazil/East", "Brazil/West", "Brazil/Acre", "Brazil/DeNoronha", "Chile/Continental",
  "Chile/EasterIsland", "America/Sao_Paulo", "America/Santiago", "America/Punta_Arenas", "America/Montevideo",
  "America/Asuncion", "America/La_Paz", "America/Lima", "America/Bahia", "America/Recife", "America/Maceio",
  "America/Fortaleza", "America/Belem", "America/Manaus", "America/Santarem", "America/Cuiaba", "America/Campo_Grande",
  "America/Porto_Velho", "America/Rio_Branco", "America/Eirunepe", "America/Araguaina", "America/Noronha",
  "America/Guayaquil", "America/Buenos_Aires", "America/Cordoba", "America/Mendoza", "Africa/Johannesburg", "Africa/Maputo",
  "Africa/Harare", "Africa/Lusaka", "Africa/Lubumbashi", "Africa/Gaborone", "Africa/Windhoek", "Africa/Maseru",
  "Africa/Mbabane", "Africa/Blantyre", "Africa/Luanda", "Africa/Kinshasa", "Africa/Brazzaville", "Africa/Dar_es_Salaam",
  "Africa/Kigali", "Africa/Bujumbura", "Indian/Antananarivo", "Indian/Mauritius", "Indian/Reunion", "Indian/Mayotte",
  "Indian/Comoro", "Indian/Kerguelen", "Indian/Cocos", "Indian/Christmas", "Asia/Jakarta", "Asia/Makassar",
  "Asia/Jayapura", "Asia/Dili", "Atlantic/St_Helena", "Atlantic/Stanley", "Atlantic/South_Georgia", "Pacific/Auckland",
  "Pacific/Chatham", "Pacific/Fiji", "Pacific/Tongatapu", "Pacific/Apia", "Pacific/Noumea", "Pacific/Efate",
  "Pacific/Port_Moresby", "Pacific/Guadalcanal", "Pacific/Norfolk", "Pacific/Rarotonga", "Pacific/Tahiti"
];
const SOUTHERN_PACIFIC: [&str; 9] = [
  "Pacific/Marquesas", "Pacific/Gambier", "Pacific/Pitcairn", "Pacific/Easter", "Pacific/Niue", "Pacific/Pago_Pago",
  "Pacific/Fakaofo", "Pacific/Wallis", "Pacific/Bougainville"
];

/// The hemisphere of an IANA time zone name ("Australia/Sydney" is south).
pub fn hemisphere_of(zone: &str) -> Hemisphere {
  let zone = zone.trim();
  let south = SOUTHERN_PREFIXES.iter().any(|prefix| zone.starts_with(prefix))
    || SOUTHERN_ZONES.contains(&zone)
    || SOUTHERN_PACIFIC.contains(&zone);
  if south { Hemisphere::South } else { Hemisphere::North }
}

/// One focus session on a book: when it began and ended (milliseconds), and
/// the local day it began on.
#[derive(Debug, Clone, PartialEq)]
pub struct Sitting {
  pub start_ms: i64,
  pub end_ms: i64,
  pub start_day: NaiveDate
}

/// A finished book, as the earned things read it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FinishedBook {
  pub genres: Vec<String>,
  /// When it was finished, where known (milliseconds), and the local day.
  pub finished_ms: Option<i64>,
  pub finished_day: Option<NaiveDate>,
  /// Local days it was opened or read in a focus session on.
  pub read_days: BTreeSet<NaiveDate>,
  /// Its focus sessions.
  pub sittings: Vec<Sitting>
}

/// What the rules are read from.
pub struct EarnFacts<'a> {
  /// The longest streak ever, as the header counts it.
  pub best_streak: i64,
  /// The day ledger: each local day's minutes.
  pub days: &'a HashMap<String, DayRecord>,
  /// Every book finished (removed ones too, while their rows last).
  pub finished: &'a [FinishedBook],
  /// Local days with reading before 8 am, and nights with reading after 10 pm
  /// (`mornings_and_nights`).
  pub early_days: usize,
  pub late_nights: usize,
  pub hemisphere: Hemisphere
}

/// A genre a skin asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Genre {
  Mystery,
  Fantasy,
  ScienceFiction
}

// The same words as `apps/src/pip/genre.ts`, which puts Pip in the mood for a book.
static MYSTERY: LazyLock<Regex> =
  LazyLock::new(|| Regex::new(r"\bmyster|\bdetective|\bcrime\b|\bwhodun|\bnoir\b|\bsleuth").expect("mystery"));
static FANTASY: LazyLock<Regex> =
  LazyLock::new(|| Regex::new(r"\bfantas|\bfairy ?tale|\bsword|\bsorcer|\bdragon|\bwizard").expect("fantasy"));
static SCIENCE_FICTION: LazyLock<Regex> = LazyLock::new(|| {
  Regex::new(r"\bscience[ -]fiction|\bsci[ -]?fi\b|\bspace opera|\bcyberpunk|\bdystopi|\btime travel").expect("scifi")
});

/// Whether any of a book's genres (free-form: "Detective and mystery stories",
/// "Epic fantasy", "Fiction, science fiction, general") says it is `genre`. A
/// book can be two: a fantasy mystery counts for both.
pub fn is_genre(genres: &[String], genre: Genre) -> bool {
  let pattern = match genre {
    Genre::Mystery => &*MYSTERY,
    Genre::Fantasy => &*FANTASY,
    Genre::ScienceFiction => &*SCIENCE_FICTION
  };
  genres.iter().any(|text| pattern.is_match(&text.to_lowercase()))
}

/// The local days with reading in the morning (4 to 8 am), and the nights
/// with reading late (10 pm to 4 am, by the evening the night began on).
///
/// `spans` are focus sessions, from start to end in local time: one counts on
/// every morning and night it reaches into by a minute or more. `noted_*` are
/// the days this device saw reading credited in those hours, outside a
/// session too (`commands::habits`).
pub fn mornings_and_nights(
  spans: &[(NaiveDateTime, NaiveDateTime)],
  noted_mornings: &BTreeSet<NaiveDate>,
  noted_nights: &BTreeSet<NaiveDate>
) -> (BTreeSet<NaiveDate>, BTreeSet<NaiveDate>) {
  let mut mornings = noted_mornings.clone();
  let mut nights = noted_nights.clone();
  // No honest session is longer than this; it only bounds the walk.
  const MOST_MINUTES: i64 = 24 * 60;
  for (start, end) in spans {
    let minutes = (*end - *start).num_minutes().clamp(0, MOST_MINUTES);
    // Each whole minute of the session, by the minute it starts on.
    for step in 0..minutes {
      let at = *start + chrono::Duration::minutes(step);
      match hour_kind(at) {
        Some(Hours::Morning(day)) => {
          mornings.insert(day);
        }
        Some(Hours::Night(night)) => {
          nights.insert(night);
        }
        None => {}
      }
    }
  }
  (mornings, nights)
}

/// What a moment of reading counts for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hours {
  /// A morning, before 8 am, on this day.
  Morning(NaiveDate),
  /// A night, after 10 pm, that began on this day.
  Night(NaiveDate)
}

/// Whether a local moment is in the morning or the night, and which.
pub fn hour_kind(at: NaiveDateTime) -> Option<Hours> {
  let hour = at.hour();
  if (MORNING_FROM_HOUR..MORNING_UNTIL_HOUR).contains(&hour) {
    Some(Hours::Morning(at.date()))
  } else if hour >= NIGHT_FROM_HOUR {
    Some(Hours::Night(at.date()))
  } else if hour < MORNING_FROM_HOUR {
    at.date().pred_opt().map(Hours::Night)
  } else {
    None
  }
}

/// The most mornings (and nights) `NotedHours` keeps: more than any rule asks
/// for, so a list cut short never costs a thing not yet earned.
pub const NOTED_KEPT: usize = 60;

/// The mornings and nights this device saw reading credited in, outside a
/// focus session too: the heartbeat's minutes carry no time of their own on
/// the day ledger. This device's alone (a settings row); what it earns is
/// written down for every device (`record`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotedHours {
  #[serde(default)]
  pub mornings: BTreeSet<NaiveDate>,
  #[serde(default)]
  pub nights: BTreeSet<NaiveDate>
}

impl NotedHours {
  /// With reading at local moment `at` noted: None when it changes nothing
  /// (the middle of the day, or a morning or night already noted).
  pub fn note(&self, at: NaiveDateTime) -> Option<NotedHours> {
    let mut next = self.clone();
    let added = match hour_kind(at)? {
      Hours::Morning(day) => next.mornings.insert(day),
      Hours::Night(night) => next.nights.insert(night)
    };
    if !added {
      return None;
    }
    // The oldest go first.
    while next.mornings.len() > NOTED_KEPT {
      next.mornings.pop_first();
    }
    while next.nights.len() > NOTED_KEPT {
      next.nights.pop_first();
    }
    Some(next)
  }
}

/// Whether the reader read on a day whose month and day are one of `dates`.
fn read_on(days: &HashMap<String, DayRecord>, dates: &[(u32, u32)]) -> bool {
  days.values().any(|day| {
    day.minutes.is_finite()
      && day.minutes >= READ_MINUTES
      && NaiveDate::parse_from_str(&day.date_key, "%Y-%m-%d").is_ok_and(|date| dates.contains(&(date.month(), date.day())))
  })
}

/// The longest night of the year: the winter solstice, which falls on one of
/// these two days in every time zone.
fn longest_night(hemisphere: Hemisphere) -> [(u32, u32); 2] {
  match hemisphere {
    Hemisphere::North => [(12, 21), (12, 22)],
    Hemisphere::South => [(6, 20), (6, 21)]
  }
}

/// Whether a finished book was set aside for `ASIDE_DAYS` or more and then
/// picked up again: two days it was read on, both by the day it was finished,
/// that far apart. Marking a book finished without opening it again is not
/// picking it up.
pub fn set_aside_then_finished(book: &FinishedBook) -> bool {
  let read: Vec<NaiveDate> = book
    .read_days
    .iter()
    .copied()
    .filter(|day| book.finished_day.is_none_or(|finished| *day <= finished))
    .collect();
  read.windows(2).any(|pair| (pair[1] - pair[0]).num_days() >= ASIDE_DAYS)
}

/// Whether a finished book was read whole in one sitting: it was finished
/// during a focus session on it (or within a few minutes of its end), and was
/// not read on any earlier day, nor in an earlier session.
pub fn one_sitting(book: &FinishedBook) -> bool {
  let Some(finished) = book.finished_ms else {
    return false;
  };
  book.sittings.iter().any(|sitting| {
    let finished_in_it = sitting.start_ms <= finished && finished <= sitting.end_ms + SITTING_SLACK_MS;
    let nothing_before = book.read_days.iter().all(|day| *day >= sitting.start_day)
      && book.sittings.iter().all(|other| other == sitting || other.end_ms > sitting.start_ms);
    finished_in_it && nothing_before
  })
}

/// How far along a rule is: the value and the mark, in `unit`.
#[derive(Debug, Clone, PartialEq)]
struct Progress {
  value: f64,
  target: f64,
  unit: &'static str
}

fn count(value: f64, target: f64, unit: &'static str) -> Option<Progress> {
  Some(Progress { value, target, unit })
}

/// Done or not, for a thing that happens once.
fn once(done: bool) -> Option<Progress> {
  count(if done { 1.0 } else { 0.0 }, 1.0, "")
}

/// The rule for an earned thing, as it stands: None for one that cannot be
/// earned in this build (what it asks for is not on record yet).
fn rule(kind: &str, id: &str, facts: &EarnFacts<'_>) -> Option<Progress> {
  let finished = |genre: Option<Genre>| {
    facts.finished.iter().filter(|book| genre.is_none_or(|genre| is_genre(&book.genres, genre))).count() as f64
  };
  let streak = facts.best_streak.max(0) as f64;
  match (kind, id) {
    ("skin", "autumn") => count(streak, MAPLE_STREAK as f64, "days"),
    ("skin", "sakura") => count(streak, SAKURA_STREAK as f64, "days"),
    ("skin", "golden") => count(streak, GOLDEN_STREAK as f64, "days"),
    ("skin", "bookworm") => count(finished(None), BOOKWORM_BOOKS as f64, "books"),
    ("skin", "detective") => count(finished(Some(Genre::Mystery)), GENRE_BOOKS as f64, "books"),
    ("skin", "wizard") => count(finished(Some(Genre::Fantasy)), GENRE_BOOKS as f64, "books"),
    ("skin", "astronaut") => count(finished(Some(Genre::ScienceFiction)), GENRE_BOOKS as f64, "books"),
    ("skin", "ink") => {
      let minutes: f64 = facts.days.values().map(|day| if day.minutes.is_finite() { day.minutes.max(0.0) } else { 0.0 }).sum();
      count((minutes / 60.0).floor(), INK_MINUTES / 60.0, "hours")
    }
    ("skin", "earlybird") => count(facts.early_days as f64, EARLY_DAYS as f64, "days"),
    ("skin", "nightowl") => count(facts.late_nights as f64, LATE_NIGHTS as f64, "nights"),
    ("skin", "ghost") => once(read_on(facts.days, &[(10, 31)])),
    ("skin", "frost") => once(read_on(facts.days, &longest_night(facts.hemisphere))),
    ("skin", "cactus") => once(facts.finished.iter().any(set_aside_then_finished)),
    ("skin", "classic") => once(facts.finished.iter().any(one_sitting)),
    // "Read 1,000 pages in a month.": pages are not counted anywhere yet.
    // "Finish first in a weekly league." and "Reach every league tier.":
    // no week's final standing, and no tiers, are kept on the reader's side.
    _ => None
  }
}

/// One earned thing, as the Pip tab is told: done or not, and how far along
/// (`value` of `target` `unit`: "5" of "7" "days"). `earnable` is false for a
/// thing this build cannot award yet; it shows its words and no progress.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EarnStatus {
  pub kind: String,
  pub id: String,
  pub done: bool,
  pub earnable: bool,
  pub value: f64,
  pub target: f64,
  pub unit: String
}

/// Every earned-only thing in the catalogue, by kind and id: done when its
/// rule is met now, or when it is `held` already (written down earlier, on
/// this device or another), which nothing takes back.
pub fn statuses(catalogue: &Catalogue, facts: &EarnFacts<'_>, held: &BTreeSet<(String, String)>) -> Vec<EarnStatus> {
  let mut list: Vec<EarnStatus> = catalogue
    .items()
    .filter(|item| item.earned_only)
    .map(|item| {
      let progress = rule(&item.kind, &item.id, facts);
      let had = held.contains(&(item.kind.clone(), item.id.clone()));
      let met = progress.as_ref().is_some_and(|progress| progress.value >= progress.target);
      let earnable = had || progress.is_some();
      let (value, target, unit) = progress.map(|p| (p.value, p.target, p.unit)).unwrap_or((0.0, 1.0, ""));
      EarnStatus {
        kind: item.kind.clone(),
        id: item.id.clone(),
        done: had || met,
        earnable,
        value: if had { value.max(target) } else { value },
        target,
        unit: unit.to_string()
      }
    })
    .collect();
  list.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| a.id.cmp(&b.id)));
  list
}

/// The things done but not yet written down: the records to add.
pub fn to_record<'a>(list: &'a [EarnStatus], held: &'a BTreeSet<(String, String)>) -> impl Iterator<Item = &'a EarnStatus> {
  list.iter().filter(|status| status.done && !held.contains(&(status.kind.clone(), status.id.clone())))
}

/// Adds the things done to what is owned (a floor brings its starter pieces,
/// as a bought one does). For when a record could not be written: the thing
/// is still the reader's.
pub fn grant(catalogue: &Catalogue, owned: &mut BTreeSet<(String, String)>, list: &[EarnStatus]) {
  for status in list.iter().filter(|status| status.done) {
    own(catalogue, owned, &record(&status.kind, &status.id, ""));
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::pip::{check_buy, check_look, owned, spent, PipLook, ShopError};
  use std::collections::BTreeMap;

  const JSON: &str = r#"{ "items": [
    {"kind":"skin","id":"sprout","price":0},
    {"kind":"skin","id":"autumn","price":0,"earnedOnly":true},
    {"kind":"skin","id":"sakura","price":0,"earnedOnly":true},
    {"kind":"skin","id":"golden","price":0,"earnedOnly":true},
    {"kind":"skin","id":"bookworm","price":0,"earnedOnly":true},
    {"kind":"skin","id":"detective","price":0,"earnedOnly":true},
    {"kind":"skin","id":"wizard","price":0,"earnedOnly":true},
    {"kind":"skin","id":"astronaut","price":0,"earnedOnly":true},
    {"kind":"skin","id":"ink","price":0,"earnedOnly":true},
    {"kind":"skin","id":"earlybird","price":0,"earnedOnly":true},
    {"kind":"skin","id":"nightowl","price":0,"earnedOnly":true},
    {"kind":"skin","id":"ghost","price":0,"earnedOnly":true},
    {"kind":"skin","id":"frost","price":0,"earnedOnly":true},
    {"kind":"skin","id":"cactus","price":0,"earnedOnly":true},
    {"kind":"skin","id":"classic","price":0,"earnedOnly":true},
    {"kind":"skin","id":"cyclist","price":0,"earnedOnly":true},
    {"kind":"skin","id":"champ","price":0,"earnedOnly":true},
    {"kind":"skin","id":"rainbow","price":0,"earnedOnly":true},
    {"kind":"skin","id":"robot","price":700},
    {"kind":"move","id":"read","price":0},
    {"kind":"level","id":"bedroom","price":0},
    {"kind":"level","id":"observatory","price":0,"earnedOnly":true},
    {"kind":"room","id":"telescope","price":300,"freeWith":"observatory"}
  ] }"#;

  fn catalogue() -> Catalogue {
    Catalogue::parse(JSON).expect("parses")
  }

  fn date(key: &str) -> NaiveDate {
    NaiveDate::parse_from_str(key, "%Y-%m-%d").expect("date")
  }

  fn at(stamp: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(stamp, "%Y-%m-%d %H:%M").expect("time")
  }

  fn day(key: &str, minutes: f64) -> DayRecord {
    DayRecord { date_key: key.to_string(), minutes, goal_minutes: 20, freeze_used: false, grace_used: false }
  }

  fn ledger(entries: Vec<DayRecord>) -> HashMap<String, DayRecord> {
    entries.into_iter().map(|record| (record.date_key.clone(), record)).collect()
  }

  fn facts<'a>(days: &'a HashMap<String, DayRecord>, finished: &'a [FinishedBook]) -> EarnFacts<'a> {
    EarnFacts { best_streak: 0, days, finished, early_days: 0, late_nights: 0, hemisphere: Hemisphere::North }
  }

  fn find<'a>(list: &'a [EarnStatus], id: &str) -> &'a EarnStatus {
    list.iter().find(|status| status.id == id).unwrap_or_else(|| panic!("no {id}"))
  }

  fn done(list: &[EarnStatus]) -> Vec<&str> {
    list.iter().filter(|status| status.done).map(|status| status.id.as_str()).collect()
  }

  fn book(genres: &[&str]) -> FinishedBook {
    FinishedBook { genres: genres.iter().map(|genre| genre.to_string()).collect(), ..FinishedBook::default() }
  }

  /// A streak walked from a ledger, as the header shows it.
  fn walked(days: &HashMap<String, DayRecord>, today: &str) -> crate::habit::Evaluation {
    crate::habit::evaluate(days, &[], today, &crate::habit::StreakState::default())
  }

  fn run(from: &str, count: i64) -> Vec<DayRecord> {
    (0..count).map(|offset| day(&(date(from) + chrono::Duration::days(offset)).format("%Y-%m-%d").to_string(), 25.0)).collect()
  }

  #[test]
  fn a_new_reader_has_earned_nothing_and_every_earned_thing_is_listed() {
    let catalogue = catalogue();
    let days = HashMap::new();
    let list = statuses(&catalogue, &facts(&days, &[]), &BTreeSet::new());
    assert_eq!(list.len(), 18, "every earned-only thing, the floor too");
    assert!(done(&list).is_empty());
    for id in ["cyclist", "champ", "rainbow", "observatory"] {
      assert!(!find(&list, id).earnable, "{id} cannot be earned in this build");
    }
    assert!(find(&list, "autumn").earnable);
    assert_eq!((find(&list, "autumn").value, find(&list, "autumn").target, find(&list, "autumn").unit.as_str()), (0.0, 7.0, "days"));
  }

  /// The bug: a friend with an 8-day streak did not have Maple.
  #[test]
  fn an_eight_day_streak_earns_maple_as_the_header_counts_it() {
    let catalogue = catalogue();
    let days = ledger(run("2026-10-14", 8));
    let walk = walked(&days, "2026-10-21");
    assert_eq!(walk.streak, 8, "the flame says 8");
    let mut facts = facts(&days, &[]);
    facts.best_streak = walk.state.longest_streak;
    let list = statuses(&catalogue, &facts, &BTreeSet::new());
    assert!(find(&list, "autumn").done, "Maple");
    assert!(!find(&list, "sakura").done);
    assert_eq!(find(&list, "sakura").value, 8.0);
  }

  #[test]
  fn six_days_is_not_seven_and_seven_is() {
    let catalogue = catalogue();
    let days = HashMap::new();
    let mut facts = facts(&days, &[]);
    facts.best_streak = 6;
    assert!(!find(&statuses(&catalogue, &facts, &BTreeSet::new()), "autumn").done);
    facts.best_streak = 7;
    assert!(find(&statuses(&catalogue, &facts, &BTreeSet::new()), "autumn").done);
    facts.best_streak = 30;
    assert!(find(&statuses(&catalogue, &facts, &BTreeSet::new()), "sakura").done);
    facts.best_streak = 364;
    assert!(!find(&statuses(&catalogue, &facts, &BTreeSet::new()), "golden").done);
    facts.best_streak = 365;
    assert!(find(&statuses(&catalogue, &facts, &BTreeSet::new()), "golden").done);
  }

  /// A missed day that grace (or a freeze) paid for keeps the streak, in the
  /// flame and here alike: four days, a miss, three days is a streak of 8.
  #[test]
  fn a_day_kept_by_grace_or_a_freeze_counts_toward_the_seven() {
    let mut entries = run("2026-10-10", 4);
    entries.extend(run("2026-10-15", 3));
    let days = ledger(entries);
    let walk = walked(&days, "2026-10-17");
    assert_eq!(walk.streak, 8, "the missed 14th is kept by grace");
    assert!(walk.state.longest_streak >= 7);

    // Two misses in a row: grace keeps one, the freeze banked at day 5 the other.
    let mut entries = run("2026-10-01", 5);
    entries.extend(run("2026-10-08", 2));
    let days = ledger(entries);
    let walk = walked(&days, "2026-10-09");
    assert_eq!(walk.streak, 9, "the 6th by grace, the 7th by the freeze");
  }

  /// The longest streak ever, not the one running: a broken streak keeps Maple.
  #[test]
  fn a_broken_streak_does_not_take_maple_back() {
    let catalogue = catalogue();
    let mut entries = run("2026-09-01", 9);
    entries.extend(run("2026-10-20", 2));
    let days = ledger(entries);
    let walk = walked(&days, "2026-10-21");
    assert_eq!(walk.streak, 2);
    let mut facts = facts(&days, &[]);
    facts.best_streak = walk.state.longest_streak;
    assert!(find(&statuses(&catalogue, &facts, &BTreeSet::new()), "autumn").done);
  }

  #[test]
  fn once_held_a_thing_stays_earned_whatever_the_facts_say_now() {
    let catalogue = catalogue();
    let days = HashMap::new();
    let held: BTreeSet<(String, String)> = [("skin".to_string(), "bookworm".to_string())].into_iter().collect();
    let list = statuses(&catalogue, &facts(&days, &[]), &held);
    assert!(find(&list, "bookworm").done, "the books were removed and their rows purged");
    assert_eq!(find(&list, "bookworm").value, 5.0, "shown full");
    assert_eq!(to_record(&list, &held).count(), 0, "nothing more to write");
  }

  #[test]
  fn books_finished_and_their_genres() {
    let catalogue = catalogue();
    let days = HashMap::new();
    let finished = vec![
      book(&["Detective and mystery stories"]),
      book(&["Fiction", "Crime"]),
      book(&["Epic fantasy", "Mystery"]),
      book(&["Fiction, science fiction, general"]),
      book(&["Sci-Fi"])
    ];
    let list = statuses(&catalogue, &facts(&days, &finished), &BTreeSet::new());
    assert!(find(&list, "bookworm").done, "five books");
    assert!(find(&list, "detective").done, "a fantasy mystery is a mystery too");
    assert_eq!(find(&list, "wizard").value, 1.0);
    assert_eq!(find(&list, "astronaut").value, 2.0);
    assert!(!find(&list, "astronaut").done);
    let four = &finished[..4];
    assert!(!find(&statuses(&catalogue, &facts(&days, four), &BTreeSet::new()), "bookworm").done);
    assert!(!is_genre(&["Crimea travel".to_string()], Genre::Mystery), "a whole word");
  }

  #[test]
  fn a_hundred_hours_is_six_thousand_minutes() {
    let catalogue = catalogue();
    let short = ledger(vec![day("2026-01-01", 5999.0)]);
    assert!(!find(&statuses(&catalogue, &facts(&short, &[]), &BTreeSet::new()), "ink").done);
    assert_eq!(find(&statuses(&catalogue, &facts(&short, &[]), &BTreeSet::new()), "ink").value, 99.0);
    let enough = ledger(vec![day("2026-01-01", 3000.0), day("2026-01-02", 3000.0)]);
    assert!(find(&statuses(&catalogue, &facts(&enough, &[]), &BTreeSet::new()), "ink").done);
  }

  #[test]
  fn mornings_and_nights_in_local_time() {
    let none = BTreeSet::new();
    let (mornings, nights) = mornings_and_nights(
      &[
        (at("2026-10-01 07:30"), at("2026-10-01 08:30")),
        (at("2026-10-02 08:00"), at("2026-10-02 09:00")),
        (at("2026-10-03 21:30"), at("2026-10-03 22:01")),
        (at("2026-10-04 21:00"), at("2026-10-04 22:00")),
        (at("2026-10-06 00:30"), at("2026-10-06 01:00")),
        (at("2026-10-07 03:50"), at("2026-10-07 04:10"))
      ],
      &none,
      &none
    );
    assert_eq!(mornings, [date("2026-10-01"), date("2026-10-07")].into_iter().collect(), "7:30 counts, 8:00 does not, 4:05 does");
    assert_eq!(
      nights,
      [date("2026-10-03"), date("2026-10-05"), date("2026-10-06")].into_iter().collect(),
      "22:00 counts, ending at 22:00 does not; half past midnight is the night before"
    );
    assert_eq!(hour_kind(at("2026-10-01 23:59")), Some(Hours::Night(date("2026-10-01"))));
    assert_eq!(hour_kind(at("2026-10-02 00:00")), Some(Hours::Night(date("2026-10-01"))), "local midnight");
    assert_eq!(hour_kind(at("2026-10-02 12:00")), None);
  }

  #[test]
  fn reading_outside_a_session_is_noted_by_the_hour_it_was_credited_in() {
    let noted = NotedHours::default();
    assert_eq!(noted.note(at("2026-10-01 12:00")), None, "midday is neither");
    let morning = noted.note(at("2026-10-01 07:59")).expect("a morning");
    assert_eq!(morning.note(at("2026-10-01 06:00")), None, "already noted");
    let night = morning.note(at("2026-10-02 01:30")).expect("a night");
    assert_eq!(night.nights, [date("2026-10-01")].into_iter().collect());
    let (mornings, nights) = mornings_and_nights(&[(at("2026-10-03 06:00"), at("2026-10-03 06:30"))], &night.mornings, &night.nights);
    assert_eq!((mornings.len(), nights.len()), (2, 1), "sessions and noted hours together");

    let mut many = NotedHours::default();
    for offset in 0..(NOTED_KEPT as i64 + 5) {
      let moment = at("2026-01-01 05:00") + chrono::Duration::days(offset);
      many = many.note(moment).expect("a new morning");
    }
    assert_eq!(many.mornings.len(), NOTED_KEPT);
    assert!(!many.mornings.contains(&date("2026-01-01")), "the oldest go first");
  }

  #[test]
  fn ten_mornings_earn_the_early_bird_and_ten_nights_the_night_owl() {
    let catalogue = catalogue();
    let days = HashMap::new();
    let mut facts = facts(&days, &[]);
    facts.early_days = 9;
    facts.late_nights = 10;
    let list = statuses(&catalogue, &facts, &BTreeSet::new());
    assert!(!find(&list, "earlybird").done);
    assert_eq!(find(&list, "earlybird").unit, "days");
    assert!(find(&list, "nightowl").done);
    assert_eq!(find(&list, "nightowl").unit, "nights");
  }

  #[test]
  fn halloween_and_the_longest_night_by_hemisphere() {
    let catalogue = catalogue();
    let halloween = ledger(vec![day("2025-10-31", 3.0)]);
    assert!(find(&statuses(&catalogue, &facts(&halloween, &[]), &BTreeSet::new()), "ghost").done);
    let too_little = ledger(vec![day("2025-10-31", 0.5), day("2025-11-01", 30.0)]);
    assert!(!find(&statuses(&catalogue, &facts(&too_little, &[]), &BTreeSet::new()), "ghost").done);

    let december = ledger(vec![day("2025-12-22", 10.0)]);
    let june = ledger(vec![day("2026-06-21", 10.0)]);
    let mut north = facts(&december, &[]);
    assert!(find(&statuses(&catalogue, &north, &BTreeSet::new()), "frost").done);
    north.days = &june;
    assert!(!find(&statuses(&catalogue, &north, &BTreeSet::new()), "frost").done, "the north's shortest night");
    let mut south = facts(&june, &[]);
    south.hemisphere = Hemisphere::South;
    assert!(find(&statuses(&catalogue, &south, &BTreeSet::new()), "frost").done);
    assert_eq!(hemisphere_of("Australia/Sydney"), Hemisphere::South);
    assert_eq!(hemisphere_of("America/Argentina/Buenos_Aires"), Hemisphere::South);
    assert_eq!(hemisphere_of("Pacific/Auckland"), Hemisphere::South);
    assert_eq!(hemisphere_of("Europe/London"), Hemisphere::North);
    assert_eq!(hemisphere_of("Asia/Kolkata"), Hemisphere::North);
    assert_eq!(hemisphere_of(""), Hemisphere::North);
  }

  #[test]
  fn a_book_set_aside_for_thirty_days_and_finished() {
    let mut aside = book(&[]);
    aside.read_days = [date("2026-08-01"), date("2026-08-02"), date("2026-09-01")].into_iter().collect();
    aside.finished_day = Some(date("2026-09-01"));
    assert!(set_aside_then_finished(&aside), "31 days between");
    let mut short = aside.clone();
    short.read_days = [date("2026-08-02"), date("2026-08-31")].into_iter().collect();
    short.finished_day = Some(date("2026-08-31"));
    assert!(!set_aside_then_finished(&short), "29 days");
    let mut exactly = aside.clone();
    exactly.read_days = [date("2026-08-01"), date("2026-08-31")].into_iter().collect();
    assert!(set_aside_then_finished(&exactly), "30 days");
    let mut marked = book(&[]);
    marked.read_days = [date("2026-08-01")].into_iter().collect();
    marked.finished_day = Some(date("2026-10-01"));
    assert!(!set_aside_then_finished(&marked), "marked finished without opening it again");
    let mut after = book(&[]);
    after.read_days = [date("2026-08-01"), date("2026-08-02"), date("2026-10-01")].into_iter().collect();
    after.finished_day = Some(date("2026-08-02"));
    assert!(!set_aside_then_finished(&after), "opened again after it was finished");
  }

  #[test]
  fn a_whole_book_in_one_sitting() {
    let ms = |stamp: &str| at(stamp).and_utc().timestamp_millis();
    let sitting = Sitting { start_ms: ms("2026-10-05 13:00"), end_ms: ms("2026-10-05 16:00"), start_day: date("2026-10-05") };
    let mut whole = book(&[]);
    whole.read_days = [date("2026-10-05")].into_iter().collect();
    whole.sittings = vec![sitting.clone()];
    whole.finished_ms = Some(ms("2026-10-05 15:55"));
    whole.finished_day = Some(date("2026-10-05"));
    assert!(one_sitting(&whole));
    let mut slack = whole.clone();
    slack.finished_ms = Some(ms("2026-10-05 16:05"));
    assert!(one_sitting(&slack), "finished just after the session was stamped");
    let mut read_before = whole.clone();
    read_before.read_days.insert(date("2026-10-04"));
    assert!(!one_sitting(&read_before), "opened the day before");
    let mut two = whole.clone();
    two.sittings.insert(0, Sitting { start_ms: ms("2026-10-05 09:00"), end_ms: ms("2026-10-05 10:00"), start_day: date("2026-10-05") });
    assert!(!one_sitting(&two), "a session on it that morning");
    let mut later = whole.clone();
    later.finished_ms = Some(ms("2026-10-06 10:00"));
    assert!(!one_sitting(&later), "finished another day");
    let mut unknown = whole;
    unknown.finished_ms = None;
    assert!(!one_sitting(&unknown));
  }

  /// What is earned is owned and can be worn; it still cannot be bought.
  #[test]
  fn an_earned_thing_is_owned_worn_and_never_sold() {
    let catalogue = catalogue();
    let days = HashMap::new();
    let mut facts = facts(&days, &[]);
    facts.best_streak = 8;
    let list = statuses(&catalogue, &facts, &BTreeSet::new());
    let mut mine = owned(&catalogue, &[]);
    let look = PipLook {
      variant: "autumn".to_string(),
      outfit: Vec::new(),
      room: BTreeMap::new(),
      room_style: String::new(),
      signature: "read".to_string()
    };
    assert!(check_look(&catalogue, &mine, &look).is_err(), "not before");
    grant(&catalogue, &mut mine, &list);
    assert!(check_look(&catalogue, &mine, &look).is_ok(), "Maple, worn");
    assert_eq!(check_buy(&catalogue, &mine, 10_000, 0, 1, "skin", "autumn").unwrap_err(), ShopError::NotForSale);

    // Written down, it is owned from the record alone, and costs nothing.
    let records: Vec<Purchase> = to_record(&list, &BTreeSet::new()).map(|status| record(&status.kind, &status.id, "2026-10-21T09:00:00+02:00")).collect();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].id, "earned-skin-autumn");
    assert_eq!(records[0].price, 0);
    assert!(check_look(&catalogue, &owned(&catalogue, &records), &look).is_ok());
    assert_eq!(spent(&catalogue, &records), 0);
    assert_eq!(crate::pip::bought_count(&catalogue, &records), 0, "earned, not bought");
  }

  #[test]
  fn an_earned_floor_brings_its_starter_pieces() {
    let catalogue = catalogue();
    let mut mine = owned(&catalogue, &[]);
    let earned = vec![EarnStatus {
      kind: "level".to_string(),
      id: "observatory".to_string(),
      done: true,
      earnable: true,
      value: 1.0,
      target: 1.0,
      unit: String::new()
    }];
    grant(&catalogue, &mut mine, &earned);
    assert!(mine.contains(&("level".to_string(), "observatory".to_string())));
    assert!(mine.contains(&("room".to_string(), "telescope".to_string())));
  }
}
