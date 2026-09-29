//! The reader's pace, as it travels between devices.
//!
//! How fast someone reads is learned on whichever device they happen to be
//! reading on, and it is worth little if a new laptop starts from scratch. The
//! profile is a few parts, each stamped with when it last changed, and each is
//! merged on its own: the newer copy of a part wins.
//!
//! * `core`: the reader-wide part (pace by time of day, how often they reread).
//! * `limits`: Dotty's range, which the reader sets by hand. It is kept apart
//!   from `core` so a setting made on one device is never lost to automatic
//!   learning that happened later on another.
//! * `books`: one entry per book. A book is read on one device at a time, so a
//!   per-book newest-wins keeps what every device learned.
//!
//! What is inside each part belongs to the app (`readers/paceModel.ts`), and is
//! carried here as it is. A device on an older build therefore passes on fields
//! it does not know rather than dropping them.

use crate::db::Database;
use crate::sync::merge::instant;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

/// Where the profile lives on this machine: the settings table, as JSON.
pub const SETTING: &str = "reading_profile";

/// Books kept at most. A library can outgrow what is worth carrying around;
/// the books read longest ago leave first.
pub const MAX_BOOKS: usize = 400;

/// One part of the profile: when it last changed, and what it says.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stamped {
  pub updated_at: String,
  #[serde(flatten)]
  pub fields: Map<String, Value>
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProfile {
  pub version: u32,
  pub core: Stamped,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub limits: Option<Stamped>,
  /// Keyed by book id (the file's hash, the same on every device).
  #[serde(default)]
  pub books: BTreeMap<String, Stamped>,
  /// When the reader last asked Leaflet to forget their pace. Book entries from
  /// before it are dropped everywhere, rather than brought back by a device that
  /// had not heard about the reset yet.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub reset_at: Option<String>
}

/// Whether `a` beats `b`. An exact tie is settled by the content, so the answer
/// does not depend on which side is `a`, and two devices cannot disagree.
fn wins(a: &Stamped, b: &Stamped) -> bool {
  match instant(&a.updated_at).cmp(&instant(&b.updated_at)) {
    Ordering::Greater => true,
    Ordering::Less => false,
    Ordering::Equal => serde_json::to_string(a).unwrap_or_default() >= serde_json::to_string(b).unwrap_or_default()
  }
}

fn later(a: &Option<String>, b: &Option<String>) -> Option<String> {
  match (a, b) {
    (Some(x), Some(y)) => Some(if instant(x) >= instant(y) { x.clone() } else { y.clone() }),
    (Some(x), None) | (None, Some(x)) => Some(x.clone()),
    (None, None) => None
  }
}

/// Drops what no device should keep: books from before a reset, ids that are not
/// ours, and the oldest books past the cap. The order is total (newest first, the
/// id breaking ties), so every device keeps the same ones.
fn tidy(mut profile: ReadingProfile) -> ReadingProfile {
  if let Some(reset) = profile.reset_at.as_deref().map(instant) {
    profile.books.retain(|_, entry| instant(&entry.updated_at) >= reset);
  }
  profile.books.retain(|id, _| !id.is_empty() && id.len() <= 128);
  if profile.books.len() > MAX_BOOKS {
    let mut order: Vec<(i64, String)> =
      profile.books.iter().map(|(id, entry)| (instant(&entry.updated_at), id.clone())).collect();
    order.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    let keep: BTreeSet<String> = order.into_iter().take(MAX_BOOKS).map(|(_, id)| id).collect();
    profile.books.retain(|id, _| keep.contains(id));
  }
  profile
}

/// Minutes of reading behind one time of day's pace; anything unreadable is none.
fn evidence(entry: &Value) -> f64 {
  entry.get("minutes").and_then(Value::as_f64).filter(|minutes| minutes.is_finite()).unwrap_or(0.0)
}

/// The reader-wide part. Where a new reader starts is set once, and the newer
/// copy's word on it stands. But the paces by time of day and the count of
/// stops are learned on whichever device is being read on, and a newest-wins
/// merge threw away one device's learning whenever both had learned since they
/// last met. So each time of day keeps the pace with more minutes of reading
/// behind it (the newer copy's on a tie), and the count keeps the larger.
/// Still commutative and idempotent: each choice is a maximum.
fn merge_core(x: &Stamped, y: &Stamped) -> Stamped {
  let (top, other) = if wins(x, y) { (x, y) } else { (y, x) };
  let mut merged = top.clone();
  if let Some(Value::Object(theirs)) = other.fields.get("timeOfDay") {
    let mut bands = match top.fields.get("timeOfDay") {
      Some(Value::Object(ours)) => ours.clone(),
      _ => Map::new()
    };
    for (band, entry) in theirs {
      let keep_ours = bands.get(band).map(|ours| evidence(ours) >= evidence(entry)).unwrap_or(false);
      if !keep_ours {
        bands.insert(band.clone(), entry.clone());
      }
    }
    merged.fields.insert("timeOfDay".to_string(), Value::Object(bands));
  }
  let stops = |part: &Stamped| part.fields.get("pausesSkipped").and_then(Value::as_i64).unwrap_or(0);
  if top.fields.contains_key("pausesSkipped") || other.fields.contains_key("pausesSkipped") {
    merged.fields.insert("pausesSkipped".to_string(), Value::from(stops(x).max(stops(y))));
  }
  merged
}

/// Two devices' profiles, part by part: the core by evidence (`merge_core`),
/// the newer limits, and per book the newer entry. Commutative and idempotent,
/// like the rest of the sync document.
pub fn merge(a: &Option<ReadingProfile>, b: &Option<ReadingProfile>) -> Option<ReadingProfile> {
  let (x, y) = match (a, b) {
    (None, None) => return None,
    (Some(only), None) | (None, Some(only)) => return Some(tidy(only.clone())),
    (Some(x), Some(y)) => (x, y)
  };
  // The version describes the core's shape, so it travels with the newer core.
  let version = if wins(&x.core, &y.core) { x.version } else { y.version };
  let core = merge_core(&x.core, &y.core);
  let limits = match (&x.limits, &y.limits) {
    (Some(p), Some(q)) => Some(if wins(p, q) { p.clone() } else { q.clone() }),
    (Some(only), None) | (None, Some(only)) => Some(only.clone()),
    (None, None) => None
  };
  let mut books = x.books.clone();
  for (id, entry) in &y.books {
    let keep_ours = books.get(id).map(|ours| wins(ours, entry)).unwrap_or(false);
    if !keep_ours {
      books.insert(id.clone(), entry.clone());
    }
  }
  Some(tidy(ReadingProfile { version, core, limits, books, reset_at: later(&x.reset_at, &y.reset_at) }))
}

/// This device's profile, or `None` before it has one. A damaged value reads as
/// none: losing a pace is better than a sync that fails over it.
pub fn load(db: &Database) -> Result<Option<ReadingProfile>> {
  Ok(db.get_setting(SETTING)?.and_then(|raw| serde_json::from_str(&raw).ok()))
}

/// Folds another copy (from the reader, or from a sync) into the stored one and
/// keeps the result. Merging rather than overwriting means that whatever landed
/// in between, from either side, survives.
pub fn absorb(db: &Database, incoming: &ReadingProfile) -> Result<ReadingProfile> {
  let stored = load(db)?;
  let merged = merge(&stored, &Some(incoming.clone())).unwrap_or_else(|| incoming.clone());
  if stored.as_ref() != Some(&merged) {
    db.set_setting(SETTING, &serde_json::to_string(&merged)?)?;
  }
  Ok(merged)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;
  use crate::sync::merge::{self as doc_merge, SyncDoc};
  use serde_json::json;

  const NOW: &str = "2026-09-29T12:00:00+00:00";

  fn stamped(updated_at: &str, fields: Value) -> Stamped {
    Stamped {
      updated_at: updated_at.to_string(),
      fields: fields.as_object().cloned().unwrap_or_default()
    }
  }

  fn profile(core_at: &str, wpm: f64, books: Vec<(&str, &str, f64)>) -> ReadingProfile {
    ReadingProfile {
      version: 2,
      core: stamped(core_at, json!({ "base": { "wpm": wpm, "minutes": 3 } })),
      limits: None,
      books: books
        .into_iter()
        .map(|(id, at, pace)| (id.to_string(), stamped(at, json!({ "wpm": pace, "minutes": 6 }))))
        .collect(),
      reset_at: None
    }
  }

  fn pace_of(profile: &ReadingProfile, id: &str) -> f64 {
    profile.books[id].fields["wpm"].as_f64().expect("a pace")
  }

  /// Each device read a different book: both books' paces survive, and the
  /// newer reader-wide part wins.
  #[test]
  fn books_read_on_different_devices_both_survive() {
    let laptop = profile("2026-09-20T10:00:00Z", 230.0, vec![("dune", "2026-09-20T10:00:00Z", 210.0)]);
    let phone = profile("2026-09-21T08:00:00Z", 250.0, vec![("hobbit", "2026-09-21T08:00:00Z", 290.0)]);
    let merged = merge(&Some(laptop.clone()), &Some(phone.clone())).expect("merged");
    assert_eq!(pace_of(&merged, "dune"), 210.0);
    assert_eq!(pace_of(&merged, "hobbit"), 290.0);
    assert_eq!(merged.core.fields["base"]["wpm"], json!(250.0));
    assert_eq!(merge(&Some(phone), &Some(laptop)), Some(merged), "commutative");
  }

  /// The same book read on both: the later reading is the truer pace.
  #[test]
  fn the_newer_entry_for_a_book_wins() {
    let older = profile("2026-09-20T10:00:00Z", 230.0, vec![("dune", "2026-09-20T10:00:00Z", 180.0)]);
    let newer = profile("2026-09-19T10:00:00Z", 230.0, vec![("dune", "2026-09-22T10:00:00Z", 240.0)]);
    let merged = merge(&Some(older), &Some(newer)).expect("merged");
    assert_eq!(pace_of(&merged, "dune"), 240.0);
    // The core is judged on its own stamp, not the book's.
    assert_eq!(merged.core.updated_at, "2026-09-20T10:00:00Z");
  }

  /// A range the reader chose by hand is not lost to learning that happened
  /// later on another device.
  #[test]
  fn a_hand_set_range_outlives_newer_learning_elsewhere() {
    let mut tuned = profile("2026-09-20T10:00:00Z", 230.0, vec![]);
    tuned.limits = Some(stamped("2026-09-20T10:00:00Z", json!({ "minWpm": 150, "maxWpm": 420 })));
    let learning = profile("2026-09-25T10:00:00Z", 260.0, vec![]);
    let merged = merge(&Some(learning), &Some(tuned)).expect("merged");
    assert_eq!(merged.limits.expect("kept").fields["maxWpm"], json!(420));
    assert_eq!(merged.core.updated_at, "2026-09-25T10:00:00Z");
  }

  /// Two devices learned since they last met: the laptop in the mornings, the
  /// phone in the evenings, and both a little at night. Neither loses its
  /// learning; the night pace with more reading behind it stands.
  #[test]
  fn both_devices_keep_what_they_learned_about_the_time_of_day() {
    let core = |at: &str, bands: Value, stops: i64| {
      stamped(at, json!({ "base": { "wpm": 215, "minutes": 2 }, "timeOfDay": bands, "pausesSkipped": stops }))
    };
    let laptop = ReadingProfile {
      core: core(
        "2026-09-22T09:00:00Z",
        json!({ "morning": { "ratio": 1.1, "minutes": 40 }, "night": { "ratio": 0.8, "minutes": 25 } }),
        7
      ),
      ..profile("2026-09-22T09:00:00Z", 215.0, vec![])
    };
    let phone = ReadingProfile {
      core: core(
        "2026-09-23T21:00:00Z",
        json!({ "evening": { "ratio": 0.9, "minutes": 30 }, "night": { "ratio": 0.85, "minutes": 12 } }),
        4
      ),
      ..profile("2026-09-23T21:00:00Z", 215.0, vec![])
    };
    let merged = merge(&Some(laptop.clone()), &Some(phone.clone())).expect("merged");
    let bands = &merged.core.fields["timeOfDay"];
    assert_eq!(bands["morning"]["minutes"], json!(40), "the laptop's mornings");
    assert_eq!(bands["evening"]["minutes"], json!(30), "the phone's evenings");
    assert_eq!(bands["night"]["ratio"], json!(0.8), "more reading behind it");
    assert_eq!(merged.core.fields["pausesSkipped"], json!(7));
    assert_eq!(merged.core.updated_at, "2026-09-23T21:00:00Z", "stamped as the newer copy");
    assert_eq!(Some(merged.clone()), merge(&Some(phone), &Some(laptop)), "commutative");
    assert_eq!(merge(&Some(merged.clone()), &Some(merged.clone())), Some(merged), "idempotent");
  }

  #[test]
  fn merging_is_idempotent_and_ties_settle_the_same_both_ways() {
    let a = profile("2026-09-20T10:00:00Z", 230.0, vec![("dune", "2026-09-20T10:00:00Z", 200.0)]);
    let b = profile("2026-09-20T10:00:00Z", 245.0, vec![("dune", "2026-09-20T10:00:00Z", 260.0)]);
    let ab = merge(&Some(a.clone()), &Some(b.clone()));
    assert_eq!(ab, merge(&Some(b.clone()), &Some(a.clone())), "an exact tie is settled by content");
    assert_eq!(merge(&Some(a.clone()), &ab), ab, "idempotent");
    assert_eq!(merge(&None, &Some(a.clone())), merge(&Some(a), &None));
    assert_eq!(merge(&None, &None), None);
  }

  /// Timestamps from different zones compare as instants, as everywhere in sync.
  #[test]
  fn stamps_compare_as_instants() {
    // 00:30 UTC, written in India.
    let india = profile("2026-09-20T06:00:00+05:30", 200.0, vec![]);
    // 01:00 UTC: half an hour later, though it sorts first as text.
    let london = profile("2026-09-20T01:00:00+00:00", 260.0, vec![]);
    let merged = merge(&Some(india), &Some(london)).expect("merged");
    assert_eq!(merged.core.fields["base"]["wpm"], json!(260.0));
  }

  /// "Forget my pace" reaches a device that still has the old books, instead of
  /// being undone by it.
  #[test]
  fn a_reset_is_not_undone_by_a_device_that_missed_it() {
    let stale = profile("2026-09-20T10:00:00Z", 230.0, vec![("dune", "2026-09-20T10:00:00Z", 200.0)]);
    let mut reset = profile("2026-09-24T10:00:00Z", 210.0, vec![("hobbit", "2026-09-25T10:00:00Z", 280.0)]);
    reset.reset_at = Some("2026-09-24T10:00:00Z".to_string());
    let merged = merge(&Some(stale.clone()), &Some(reset.clone())).expect("merged");
    assert!(!merged.books.contains_key("dune"), "read before the reset");
    assert!(merged.books.contains_key("hobbit"), "read after it");
    assert_eq!(merge(&Some(reset), &Some(stale)), Some(merged));
  }

  #[test]
  fn the_oldest_books_leave_past_the_cap_on_every_device_alike() {
    let many: Vec<(String, String)> = (0..MAX_BOOKS + 5)
      .map(|n| (format!("book{n:04}"), format!("2026-01-01T00:{:02}:{:02}Z", n / 60 % 60, n % 60)))
      .collect();
    let mut a = profile(NOW, 230.0, vec![]);
    for (id, at) in &many[..300] {
      a.books.insert(id.clone(), stamped(at, json!({ "wpm": 200 })));
    }
    let mut b = profile(NOW, 230.0, vec![]);
    for (id, at) in &many[250..] {
      b.books.insert(id.clone(), stamped(at, json!({ "wpm": 200 })));
    }
    let merged = merge(&Some(a.clone()), &Some(b.clone())).expect("merged");
    assert_eq!(merged.books.len(), MAX_BOOKS);
    assert!(!merged.books.contains_key("book0000"), "the oldest leaves");
    assert!(merged.books.contains_key(&format!("book{:04}", MAX_BOOKS + 4)), "the newest stays");
    assert_eq!(merge(&Some(b), &Some(a.clone())), Some(merged.clone()));
    assert_eq!(merge(&Some(a), &Some(merged.clone())), Some(merged));
  }

  /// Fields this build does not know are carried on, not dropped: a newer build
  /// on another device may have written them.
  #[test]
  fn unknown_fields_travel_untouched() {
    let json = r#"{
      "version": 2,
      "core": { "updatedAt": "2026-09-20T10:00:00Z", "base": { "wpm": 230, "minutes": 3 }, "somethingNew": [1, 2] },
      "books": { "dune": { "updatedAt": "2026-09-20T10:00:00Z", "wpm": 210, "futureField": "kept" } }
    }"#;
    let parsed: ReadingProfile = serde_json::from_str(json).expect("parses");
    let back = serde_json::to_value(&parsed).expect("serializes");
    assert_eq!(back["core"]["somethingNew"], json!([1, 2]));
    assert_eq!(back["books"]["dune"]["futureField"], json!("kept"));
    assert_eq!(back["core"]["updatedAt"], json!("2026-09-20T10:00:00Z"));
    assert!(back.get("limits").is_none() && back.get("resetAt").is_none(), "absent parts stay absent");
  }

  /// The profile rides in the sync document; documents from before it still
  /// parse, and ones without it leave the field out entirely.
  #[test]
  fn it_rides_in_the_sync_document() {
    let legacy = r#"{"version":1,"updatedAt":"2026-08-01T00:00:00Z","books":[]}"#;
    let parsed: SyncDoc = serde_json::from_str(legacy).expect("parses");
    assert!(parsed.reading_profile.is_none());
    let empty = serde_json::to_string(&SyncDoc::empty(NOW)).expect("json");
    assert!(!empty.contains("readingProfile"), "{empty}");

    let mut mine = SyncDoc::empty(NOW);
    mine.reading_profile = Some(profile("2026-09-20T10:00:00Z", 230.0, vec![("dune", "2026-09-20T10:00:00Z", 210.0)]));
    let mut theirs = SyncDoc::empty(NOW);
    theirs.reading_profile = Some(profile("2026-09-21T10:00:00Z", 250.0, vec![("hobbit", "2026-09-21T10:00:00Z", 290.0)]));
    let merged = doc_merge::merge(&mine, &theirs, NOW);
    assert_eq!(merged, doc_merge::merge(&theirs, &mine, NOW), "commutative");
    let reading = merged.reading_profile.expect("carried");
    assert_eq!(reading.books.len(), 2);
    let json = serde_json::to_string(&SyncDoc { reading_profile: Some(reading.clone()), ..SyncDoc::empty(NOW) }).expect("json");
    assert!(json.contains("\"readingProfile\""), "{json}");
  }

  /// A write from the reader is merged into what a sync stored meanwhile.
  #[test]
  fn absorbing_keeps_what_either_side_learned() {
    let db = memory_db();
    assert_eq!(load(&db).expect("load"), None);
    let synced = profile("2026-09-21T10:00:00Z", 250.0, vec![("hobbit", "2026-09-21T10:00:00Z", 290.0)]);
    absorb(&db, &synced).expect("sync writes");
    let reader = profile("2026-09-22T10:00:00Z", 240.0, vec![("dune", "2026-09-22T10:00:00Z", 205.0)]);
    let kept = absorb(&db, &reader).expect("reader writes");
    assert_eq!(kept.books.len(), 2);
    assert_eq!(load(&db).expect("load"), Some(kept));

    // A damaged value reads as none rather than failing.
    db.set_setting(SETTING, "{not json").expect("write");
    assert_eq!(load(&db).expect("load"), None);
  }
}
