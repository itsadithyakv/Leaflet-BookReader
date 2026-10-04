//! The sync document and the rules for merging two of them.
//!
//! Both transports — a folder the user already syncs, and the Drive API — move
//! this same document. Only this module decides what the merged result is, and
//! it is pure: no clock, no I/O, no network. The caller supplies `now`, exactly
//! as `habit::evaluate` does, so every rule below is directly testable.
//!
//! Two properties matter and are tested:
//!
//! * **Commutative** — `merge(a, b) == merge(b, a)`. Devices must not disagree
//!   about the result depending on who synced first.
//! * **Idempotent** — `merge(a, merge(a, b)) == merge(a, b)`. Syncing twice
//!   changes nothing, so a retry after a network failure is always safe.
//!
//! Timestamps are compared as instants, never as strings: two devices in
//! different time zones write different offsets for the same moment.

use crate::db::{BookRecord, FocusSessionRecord};
use crate::habit::DayRecord;
use crate::pip::{Harvest, PipState, Planting, Purchase};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::path::Path;

pub const DOC_VERSION: u32 = 1;

/// How long a deletion is remembered. A device offline longer than this will
/// resurrect its copy of a deleted book — the unavoidable cost of not keeping
/// tombstones forever. Ninety days is far past any realistic gap.
pub const TOMBSTONE_RETENTION_DAYS: i64 = 90;

/// One book, as it travels between devices.
///
/// Deliberately absent: `local_path`, `cover_url` and `metadata_checked_at`.
/// The first two are absolute paths that mean nothing on another machine, and
/// syncing them is what made covers break on the receiving device. The local
/// path is derived from `id` and `ext`; the cover is re-fetched.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookEntry {
  /// SHA-256 of the file contents. The same book is the same id on every
  /// machine, which is what makes identity work without a server.
  pub id: String,
  /// Extension only, so the receiver can name its local copy `{id}.{ext}`.
  pub ext: String,
  pub title: String,
  pub author: Option<String>,
  pub genres: Vec<String>,
  /// When title/author/genres last changed. They move together as one group:
  /// metadata is written by one enrichment pass, not field by field.
  pub metadata_updated_at: String,
  pub progress: f32,
  /// The exact place in the book (an EPUB CFI); `None` for page-based books.
  /// It is the same fact as `progress` at finer grain, so it travels with it:
  /// whichever side wins progress supplies both. Defaulted so documents written
  /// before it existed still parse.
  #[serde(default)]
  pub position: Option<String>,
  /// The series and the book's number in it (`Some("")`: the reader said it is
  /// in none). Part of the metadata group, so it travels with the title.
  /// Defaulted: documents written before it existed still parse.
  #[serde(default)]
  pub series: Option<String>,
  #[serde(default)]
  pub series_index: Option<f32>,
  /// When `progress` last changed — *not* when the book was last opened.
  /// Conflating the two is what let a device that merely opened a book roll
  /// another device's reading position backwards.
  pub progress_updated_at: String,
  pub last_opened: Option<String>,
  pub created_at: String,
  /// Set when the book was removed. The entry survives so the removal can reach
  /// other devices rather than being undone by them.
  pub deleted_at: Option<String>
}

impl BookEntry {
  /// The most recent moment this book was touched in any way. Used to decide
  /// whether an edit is newer than a deletion.
  fn touched_at(&self) -> i64 {
    instant(&self.metadata_updated_at).max(instant(&self.progress_updated_at))
  }

  pub fn is_deleted(&self) -> bool {
    self.deleted_at.is_some()
  }
}

/// One day of the habit ledger.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DayEntry {
  pub date_key: String,
  pub minutes: f64,
  pub goal_minutes: i64,
  pub freeze_used: bool,
  pub grace_used: bool
}

/// One entry on the session shelf.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionEntry {
  pub id: String,
  pub started_at: String,
  pub ended_at: String,
  pub date_key: String,
  pub minutes: f64,
  pub book_id: Option<String>,
  pub title: Option<String>,
  pub notes: Option<String>,
  pub ended_reason: String,
  pub clean: bool,
  pub style_seed: String,
  pub burned_at: Option<String>,
  /// The focus flower a full-screen session grew, and whether it bloomed.
  /// Left out of the document for sessions without one.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub flower: Option<String>,
  #[serde(default, skip_serializing_if = "std::ops::Not::not")]
  pub flower_bloomed: bool
}

/// What travels between devices. A few kilobytes: book files are not in here,
/// and are fetched on demand instead.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncDoc {
  pub version: u32,
  pub updated_at: String,
  pub books: Vec<BookEntry>,
  #[serde(default)]
  pub days: Vec<DayEntry>,
  #[serde(default)]
  pub sessions: Vec<SessionEntry>,
  /// Pip's shop purchases: the spending half of the seed balance (the earning
  /// half is the ledger above). Append-only, so they merge as a union.
  #[serde(default)]
  pub purchases: Vec<Purchase>,
  /// Pip's garden: plantings and harvests. Append-only, merged as unions;
  /// growth is replayed from the reading, never stored.
  #[serde(default)]
  pub plantings: Vec<Planting>,
  #[serde(default)]
  pub harvests: Vec<Harvest>,
  /// Pip's look, home and mood. One record, newest write wins.
  #[serde(default)]
  pub pip: Option<PipState>,
  /// Bookmarks and highlights. Per id, the newest edit wins (a delete is an
  /// edit, kept as a tombstone).
  #[serde(default)]
  pub annotations: Vec<crate::db::Annotation>,
  /// The reader's own collections. Per id, the newest edit wins, as for
  /// annotations.
  #[serde(default)]
  pub collections: Vec<crate::db::Collection>,
  /// How fast the reader reads, overall and per book, merged part by part (see
  /// `reading`). Left out of documents without one, so older builds read them
  /// as before.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub reading_profile: Option<crate::sync::reading::ReadingProfile>
}

impl SyncDoc {
  pub fn empty(now: &str) -> Self {
    SyncDoc {
      version: DOC_VERSION,
      updated_at: now.to_string(),
      books: Vec::new(),
      days: Vec::new(),
      sessions: Vec::new(),
      purchases: Vec::new(),
      plantings: Vec::new(),
      harvests: Vec::new(),
      pip: None,
      annotations: Vec::new(),
      collections: Vec::new(),
      reading_profile: None
    }
  }

  /// Books that should exist locally, i.e. everything not tombstoned.
  pub fn live_books(&self) -> impl Iterator<Item = &BookEntry> {
    self.books.iter().filter(|book| !book.is_deleted())
  }
}

/// An RFC 3339 timestamp as milliseconds since the epoch, or 0 if unparseable.
///
/// Never compare these strings directly: `2026-01-01T00:00:00+05:30` sorts after
/// `2026-01-01T00:00:00+00:00` as text but is the earlier instant.
pub(crate) fn instant(value: &str) -> i64 {
  DateTime::parse_from_rfc3339(value)
    .map(|dt| dt.with_timezone(&Utc).timestamp_millis())
    .unwrap_or(0)
}

fn instant_opt(value: &Option<String>) -> Option<i64> {
  value.as_deref().map(instant)
}

/// The later of two optional timestamps, preferring whichever is set.
fn later(a: &Option<String>, b: &Option<String>) -> Option<String> {
  match (a, b) {
    (Some(x), Some(y)) => {
      if instant(x) >= instant(y) {
        Some(x.clone())
      } else {
        Some(y.clone())
      }
    }
    (Some(x), None) => Some(x.clone()),
    (None, Some(y)) => Some(y.clone()),
    (None, None) => None
  }
}

/// Merges two views of the same book, field group by field group.
///
/// Whole-record last-writer-wins was the original bug: it let one field's
/// timestamp decide the fate of every other field. Here a title correction on
/// one device and a position change on another both survive.
fn merge_book(a: &BookEntry, b: &BookEntry) -> BookEntry {
  // Metadata moves as a group, newest write wins. Exact ties fall back to
  // comparing the values themselves so the result cannot depend on argument
  // order — without that, merge would not be commutative and two devices could
  // settle on different answers.
  let metadata_from = match instant(&a.metadata_updated_at).cmp(&instant(&b.metadata_updated_at)) {
    Ordering::Greater => a,
    Ordering::Less => b,
    Ordering::Equal => {
      // A series is compared too, and a known one beats none (`None` sorts
      // first): a series read from the file is filled in without a new stamp,
      // since every device reads the same file to the same answer.
      let index = |x: &BookEntry| x.series_index.map(|value| value.to_bits() as i64).unwrap_or(-1);
      let order = (&a.title, &a.author, &a.genres, &a.series)
        .cmp(&(&b.title, &b.author, &b.genres, &b.series))
        .then_with(|| index(a).cmp(&index(b)));
      if order != Ordering::Less {
        a
      } else {
        b
      }
    }
  };

  // Progress has its own stamp, so a device that only opened the book cannot
  // win here. A tie keeps the further position: never lose a reader's place.
  // Equal percentages fall back to the CFI so a tie is still decided the same
  // way whichever side is `a`.
  let progress_from = match instant(&a.progress_updated_at).cmp(&instant(&b.progress_updated_at)) {
    Ordering::Greater => a,
    Ordering::Less => b,
    Ordering::Equal => {
      let further = a
        .progress
        .partial_cmp(&b.progress)
        .unwrap_or(Ordering::Equal)
        .then_with(|| a.position.cmp(&b.position));
      if further == Ordering::Less {
        b
      } else {
        a
      }
    }
  };

  // A deletion holds unless the other device edited the book after it — which
  // is how re-importing a removed book brings it back rather than being undone
  // on the next sync.
  let deleted_at = match (&a.deleted_at, &b.deleted_at) {
    (Some(x), Some(y)) => later(&Some(x.clone()), &Some(y.clone())),
    (Some(x), None) => {
      if b.touched_at() > instant(x) {
        None
      } else {
        Some(x.clone())
      }
    }
    (None, Some(y)) => {
      if a.touched_at() > instant(y) {
        None
      } else {
        Some(y.clone())
      }
    }
    (None, None) => None
  };

  BookEntry {
    id: a.id.clone(),
    // An empty extension means the writer could not determine one; the other
    // device's answer is strictly better than nothing.
    ext: if metadata_from.ext.is_empty() {
      let other = if std::ptr::eq(metadata_from, a) { b } else { a };
      other.ext.clone()
    } else {
      metadata_from.ext.clone()
    },
    title: metadata_from.title.clone(),
    author: metadata_from.author.clone(),
    genres: metadata_from.genres.clone(),
    series: metadata_from.series.clone(),
    series_index: metadata_from.series_index,
    metadata_updated_at: metadata_from.metadata_updated_at.clone(),
    progress: progress_from.progress,
    // Taken from the progress winner even when it is `None`: filling it from the
    // loser would pair one device's percentage with another device's place.
    position: progress_from.position.clone(),
    progress_updated_at: progress_from.progress_updated_at.clone(),
    // "Last opened" is inherently a maximum rather than a contested value.
    last_opened: later(&a.last_opened, &b.last_opened),
    // The earliest import is the truth about when the book entered the library.
    created_at: if instant(&a.created_at) <= instant(&b.created_at) {
      a.created_at.clone()
    } else {
      b.created_at.clone()
    },
    deleted_at
  }
}

/// Same day seen by two devices.
///
/// Minutes take the maximum rather than the sum. Neither device knows how much
/// of the other's time overlapped its own, and a sum would let a reader inflate
/// a streak by syncing repeatedly. The maximum is monotone, so it converges.
///
/// The goal: a day that met its goal on a device stays met. "Met" is a goal
/// above zero and that device's own minutes at or over it.
///
/// * Both devices met theirs: the harder (larger) of the two goals.
/// * One did: that device's goal, whatever the other's minutes or goal. The
///   other read more against a goal it did not reach; its minutes are kept,
///   its goal is not.
/// * Neither did: the goal of the device that read more; on equal minutes the
///   harder of the two, so a day is never judged against a goal the reader
///   had already raised.
///
/// The minutes kept are the larger, so they are at or over any goal either
/// device met: a met day cannot come out of a merge unmet, and a day met by
/// neither cannot come out met (the goal kept is over the minutes kept). The
/// rule is the same whichever side is `a`, merging a day with itself changes
/// nothing, and three devices reach the same day in any order.
fn merge_day(a: &DayEntry, b: &DayEntry) -> DayEntry {
  let met = |day: &DayEntry| day.goal_minutes > 0 && day.minutes >= day.goal_minutes as f64;
  let leader = if a.minutes >= b.minutes { a } else { b };
  DayEntry {
    date_key: a.date_key.clone(),
    minutes: leader.minutes,
    goal_minutes: match (met(a), met(b)) {
      (true, true) => a.goal_minutes.max(b.goal_minutes),
      (true, false) => a.goal_minutes,
      (false, true) => b.goal_minutes,
      (false, false) if (a.minutes - b.minutes).abs() < f64::EPSILON => a.goal_minutes.max(b.goal_minutes),
      (false, false) => leader.goal_minutes
    },
    // Spending a freeze or grace on one device spends it everywhere: the
    // alternative lets a reader claim the same protection twice.
    freeze_used: a.freeze_used || b.freeze_used,
    grace_used: a.grace_used || b.grace_used
  }
}

fn merge_session(a: &SessionEntry, b: &SessionEntry) -> SessionEntry {
  let mut merged = a.clone();
  // A burn is a tombstone; once scorched a session stays scorched.
  merged.burned_at = later(&a.burned_at, &b.burned_at);
  // A note written on either device is worth more than its absence.
  merged.notes = match (&a.notes, &b.notes) {
    (Some(x), Some(y)) => Some(if x >= y { x.clone() } else { y.clone() }),
    (Some(x), None) => Some(x.clone()),
    (None, Some(y)) => Some(y.clone()),
    (None, None) => None
  };
  merged.minutes = a.minutes.max(b.minutes);
  // A flower is set when its session is recorded and never changes after;
  // either side's word for it will do, and a bloom is never unbloomed.
  merged.flower = a.flower.clone().or_else(|| b.flower.clone());
  merged.flower_bloomed = a.flower_bloomed || b.flower_bloomed;
  merged
}

/// Pip's state seen by two devices: the newer write wins whole. It is one
/// small record the reader edits in one place at a time, so a per-field merge
/// would buy nothing. An exact tie is settled by the content itself, so the
/// answer does not depend on which side is `a`.
fn merge_pip(a: &Option<PipState>, b: &Option<PipState>) -> Option<PipState> {
  match (a, b) {
    (Some(x), Some(y)) => Some(
      match instant(&x.updated_at).cmp(&instant(&y.updated_at)) {
        Ordering::Greater => x,
        Ordering::Less => y,
        Ordering::Equal => {
          let (tx, ty) = (serde_json::to_string(x).unwrap_or_default(), serde_json::to_string(y).unwrap_or_default());
          if tx >= ty {
            x
          } else {
            y
          }
        }
      }
      .clone()
    ),
    (Some(x), None) => Some(x.clone()),
    (None, Some(y)) => Some(y.clone()),
    (None, None) => None
  }
}

/// A record edited as a whole, deleted as a tombstone: annotations and
/// collections.
trait Edited: Clone + Ord {
  fn id(&self) -> &str;
  fn updated_at(&self) -> &str;
  fn deleted_at(&self) -> &Option<String>;
}

impl Edited for crate::db::Annotation {
  fn id(&self) -> &str {
    &self.id
  }
  fn updated_at(&self) -> &str {
    &self.updated_at
  }
  fn deleted_at(&self) -> &Option<String> {
    &self.deleted_at
  }
}

impl Edited for crate::db::Collection {
  fn id(&self) -> &str {
    &self.id
  }
  fn updated_at(&self) -> &str {
    &self.updated_at
  }
  fn deleted_at(&self) -> &Option<String> {
    &self.deleted_at
  }
}

/// Two copies of one record: the newer edit wins. An exact tie is decided by
/// the records themselves, so every device picks the same one.
fn merge_edited<T: Edited>(a: &[T], b: &[T], cutoff: i64) -> Vec<T> {
  let mut out: BTreeMap<String, T> = BTreeMap::new();
  for item in a.iter().chain(b.iter()) {
    let replace = match out.get(item.id()) {
      None => true,
      Some(existing) => match instant(item.updated_at()).cmp(&instant(existing.updated_at())) {
        Ordering::Greater => true,
        Ordering::Less => false,
        Ordering::Equal => item > existing
      }
    };
    if replace {
      out.insert(item.id().to_string(), item.clone());
    }
  }
  out
    .into_values()
    // Old tombstones leave, as books' do.
    .filter(|item| instant_opt(item.deleted_at()).map(|at| at >= cutoff).unwrap_or(true))
    .collect()
}

/// Records that never change once made (plantings, harvests): a union by id.
/// Two different records under one id cannot happen (ids are random), but if
/// one did, the smaller wins on every device alike.
fn union_by_id<T: Clone + Ord>(a: &[T], b: &[T], id: impl Fn(&T) -> &str) -> Vec<T> {
  let mut out: BTreeMap<String, T> = BTreeMap::new();
  for item in a.iter().chain(b.iter()) {
    match out.get(id(item)) {
      Some(existing) if existing <= item => {}
      _ => {
        out.insert(id(item).to_string(), item.clone());
      }
    }
  }
  out.into_values().collect()
}

/// Combines two documents into the one both devices should end up holding.
///
/// `now` drives tombstone collection only; nothing else here reads a clock.
pub fn merge(local: &SyncDoc, remote: &SyncDoc, now: &str) -> SyncDoc {
  // BTreeMap rather than HashMap: the output order must be identical on every
  // device, or two machines produce byte-different documents from the same
  // inputs and re-upload each other's work forever.
  let mut books: BTreeMap<&str, BookEntry> = BTreeMap::new();
  for book in &local.books {
    books.insert(book.id.as_str(), book.clone());
  }
  for book in &remote.books {
    let merged = match books.get(book.id.as_str()) {
      Some(existing) => merge_book(existing, book),
      None => book.clone()
    };
    books.insert(book.id.as_str(), merged);
  }

  let cutoff = instant(now) - Duration::days(TOMBSTONE_RETENTION_DAYS).num_milliseconds();
  let books = books
    .into_values()
    .filter(|book| match instant_opt(&book.deleted_at) {
      // Drop tombstones old enough that every device has certainly seen them.
      Some(deleted) => deleted >= cutoff,
      None => true
    })
    .collect();

  let mut days: BTreeMap<&str, DayEntry> = BTreeMap::new();
  for day in &local.days {
    days.insert(day.date_key.as_str(), day.clone());
  }
  for day in &remote.days {
    let merged = match days.get(day.date_key.as_str()) {
      Some(existing) => merge_day(existing, day),
      None => day.clone()
    };
    days.insert(day.date_key.as_str(), merged);
  }

  let mut sessions: BTreeMap<&str, SessionEntry> = BTreeMap::new();
  for session in &local.sessions {
    sessions.insert(session.id.as_str(), session.clone());
  }
  for session in &remote.sessions {
    let merged = match sessions.get(session.id.as_str()) {
      Some(existing) => merge_session(existing, session),
      None => session.clone()
    };
    sessions.insert(session.id.as_str(), merged);
  }

  // Purchases never change once made: a union by id. Two different records
  // under one id cannot happen (ids are random), but if one ever did, the
  // smaller wins on both devices alike.
  let mut purchases: BTreeMap<&str, Purchase> = BTreeMap::new();
  for purchase in local.purchases.iter().chain(remote.purchases.iter()) {
    match purchases.get(purchase.id.as_str()) {
      Some(existing) if existing <= purchase => {}
      _ => {
        purchases.insert(purchase.id.as_str(), purchase.clone());
      }
    }
  }

  SyncDoc {
    version: DOC_VERSION,
    updated_at: now.to_string(),
    annotations: merge_edited(&local.annotations, &remote.annotations, cutoff),
    collections: merge_edited(&local.collections, &remote.collections, cutoff),
    plantings: union_by_id(&local.plantings, &remote.plantings, |p| p.id.as_str()),
    harvests: union_by_id(&local.harvests, &remote.harvests, |h| h.id.as_str()),
    books,
    days: days.into_values().collect(),
    sessions: sessions.into_values().collect(),
    purchases: purchases.into_values().collect(),
    pip: merge_pip(&local.pip, &remote.pip),
    reading_profile: crate::sync::reading::merge(&local.reading_profile, &remote.reading_profile)
  }
}

// ---- conversions to and from local storage --------------------------------

/// The extension of a stored book, used to name the copy on the other device.
fn extension_of(local_path: &str) -> String {
  Path::new(local_path)
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or("")
    .to_lowercase()
}

impl BookEntry {
  pub fn from_record(book: &BookRecord) -> Self {
    BookEntry {
      id: book.id.clone(),
      ext: extension_of(&book.local_path),
      title: book.title.clone(),
      author: book.author.clone(),
      genres: book.genres.clone(),
      // Libraries that predate per-field stamps fall back to `created_at`, so an
      // un-stamped record loses to any real edit rather than winning by accident.
      metadata_updated_at: book
        .metadata_updated_at
        .clone()
        .unwrap_or_else(|| book.created_at.clone()),
      progress: book.progress,
      position: book.position.clone(),
      series: book.series.clone(),
      series_index: book.series_index,
      progress_updated_at: book
        .progress_updated_at
        .clone()
        .unwrap_or_else(|| book.created_at.clone()),
      last_opened: book.last_opened.clone(),
      created_at: book.created_at.clone(),
      deleted_at: book.deleted_at.clone()
    }
  }

  /// Rebuilds a local record. `local_path` and `cover_url` are the caller's to
  /// supply: they are properties of *this* machine, not of the shared document.
  pub fn to_record(&self, local_path: String, cover_url: Option<String>) -> BookRecord {
    BookRecord {
      id: self.id.clone(),
      title: self.title.clone(),
      author: self.author.clone(),
      genres: self.genres.clone(),
      cover_url,
      local_path,
      file_hash: self.id.clone(),
      progress: self.progress,
      position: self.position.clone(),
      series: self.series.clone(),
      series_index: self.series_index,
      last_opened: self.last_opened.clone(),
      created_at: self.created_at.clone(),
      metadata_checked_at: None,
      metadata_updated_at: Some(self.metadata_updated_at.clone()),
      progress_updated_at: Some(self.progress_updated_at.clone()),
      deleted_at: self.deleted_at.clone(),
      // A document entry says nothing about whether the bytes are here; the
      // caller re-reads the row, which checks the filesystem.
      available: false
    }
  }

  /// Whether this entry can safely name a file.
  ///
  /// `id` and `ext` arrive from a document another device, or a server, wrote,
  /// and both become part of a path. Locally they are always a hex digest and a
  /// short extension, so anything with a separator or a dot is not ours: an id
  /// of `../../Documents/x` would otherwise let a later tombstone delete a file
  /// outside the library.
  pub fn is_safe_name(&self) -> bool {
    let plain = |value: &str, max: usize| {
      value.len() <= max && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
    };
    !self.id.is_empty() && plain(&self.id, 128) && plain(&self.ext, 10)
  }

  /// The name this book has in the shared store, on every machine.
  pub fn remote_name(&self) -> String {
    if self.ext.is_empty() {
      self.id.clone()
    } else {
      format!("{}.{}", self.id, self.ext)
    }
  }
}

impl DayEntry {
  pub fn from_record(day: &DayRecord) -> Self {
    DayEntry {
      date_key: day.date_key.clone(),
      minutes: day.minutes,
      goal_minutes: day.goal_minutes,
      freeze_used: day.freeze_used,
      grace_used: day.grace_used
    }
  }

  pub fn to_record(&self) -> DayRecord {
    DayRecord {
      date_key: self.date_key.clone(),
      minutes: self.minutes,
      goal_minutes: self.goal_minutes,
      freeze_used: self.freeze_used,
      grace_used: self.grace_used
    }
  }
}

impl SessionEntry {
  pub fn from_record(session: &FocusSessionRecord) -> Self {
    SessionEntry {
      id: session.id.clone(),
      started_at: session.started_at.clone(),
      ended_at: session.ended_at.clone(),
      date_key: session.date_key.clone(),
      minutes: session.minutes,
      book_id: session.book_id.clone(),
      title: session.title.clone(),
      notes: session.notes.clone(),
      ended_reason: session.ended_reason.clone(),
      clean: session.clean,
      style_seed: session.style_seed.clone(),
      burned_at: session.burned_at.clone(),
      flower: session.flower.clone(),
      flower_bloomed: session.flower_bloomed
    }
  }

  pub fn to_record(&self) -> FocusSessionRecord {
    FocusSessionRecord {
      id: self.id.clone(),
      started_at: self.started_at.clone(),
      ended_at: self.ended_at.clone(),
      date_key: self.date_key.clone(),
      minutes: self.minutes,
      book_id: self.book_id.clone(),
      title: self.title.clone(),
      notes: self.notes.clone(),
      ended_reason: self.ended_reason.clone(),
      clean: self.clean,
      style_seed: self.style_seed.clone(),
      burned_at: self.burned_at.clone(),
      flower: self.flower.clone(),
      flower_bloomed: self.flower_bloomed
    }
  }
}

#[cfg(test)]
mod tests {
  #[test]
  fn names_that_could_escape_the_library_are_unsafe() {
    let mut safe = entry("3f9a0c");
    safe.ext = "epub".to_string();
    assert!(safe.is_safe_name());
    for (id, ext) in [("../../x", "epub"), ("a/b", "epub"), ("abc", "e/../p"), ("", "epub"), ("abc", "tar.gz")] {
      let mut bad = entry("aaa");
      bad.id = id.to_string();
      bad.ext = ext.to_string();
      assert!(!bad.is_safe_name(), "{id}.{ext} should be refused");
    }
  }

  use super::*;

  const NOW: &str = "2026-08-29T12:00:00+00:00";

  fn entry(id: &str) -> BookEntry {
    BookEntry {
      id: id.to_string(),
      ext: "epub".to_string(),
      title: format!("Book {id}"),
      author: Some("Someone".to_string()),
      genres: vec!["fiction".to_string()],
      metadata_updated_at: "2026-01-01T00:00:00+00:00".to_string(),
      progress: 0.0,
      position: None,
      series: None,
      series_index: None,
      progress_updated_at: "2026-01-01T00:00:00+00:00".to_string(),
      last_opened: None,
      created_at: "2026-01-01T00:00:00+00:00".to_string(),
      deleted_at: None
    }
  }

  fn doc(books: Vec<BookEntry>) -> SyncDoc {
    SyncDoc {
      version: DOC_VERSION,
      updated_at: NOW.to_string(),
      books,
      days: Vec::new(),
      sessions: Vec::new(),
      purchases: Vec::new(),
      plantings: Vec::new(),
      harvests: Vec::new(),
      pip: None,
      annotations: Vec::new(),
      collections: Vec::new(),
      reading_profile: None
    }
  }

  fn find<'a>(doc: &'a SyncDoc, id: &str) -> &'a BookEntry {
    doc.books.iter().find(|book| book.id == id).expect("entry present")
  }

  // ---- the defects the old merge had -------------------------------------

  /// Was: the union brought a deleted book back on every sync, forever.
  #[test]
  fn a_deletion_reaches_the_other_device() {
    let mut removed = entry("aaa");
    removed.deleted_at = Some("2026-06-01T00:00:00+00:00".to_string());
    let deleting = doc(vec![removed]);
    let unaware = doc(vec![entry("aaa")]);

    let merged = merge(&deleting, &unaware, NOW);

    assert!(find(&merged, "aaa").is_deleted());
    assert_eq!(merged.live_books().count(), 0);
  }

  /// Was: whole-record last-writer-wins keyed on `last_opened`, so a device that
  /// merely opened a book overwrote a position read elsewhere.
  #[test]
  fn opening_a_book_elsewhere_does_not_rewind_progress() {
    let mut ahead = entry("aaa");
    ahead.progress = 0.90;
    ahead.progress_updated_at = "2026-06-01T00:00:00+00:00".to_string();
    ahead.last_opened = Some("2026-06-01T00:00:00+00:00".to_string());

    // The second device opened the book a day later but never moved through it,
    // so its progress stamp is still the original import.
    let mut opened_only = entry("aaa");
    opened_only.progress = 0.0;
    opened_only.last_opened = Some("2026-06-02T00:00:00+00:00".to_string());

    let merged = merge(&doc(vec![ahead]), &doc(vec![opened_only]), NOW);
    let book = find(&merged, "aaa");

    assert_eq!(book.progress, 0.90);
    // The later open is still the truth about when it was last picked up.
    assert_eq!(book.last_opened.as_deref(), Some("2026-06-02T00:00:00+00:00"));
  }

  /// The other half of the rule: real reading on the second device does win.
  #[test]
  fn genuine_later_reading_wins() {
    let mut first = entry("aaa");
    first.progress = 0.90;
    first.progress_updated_at = "2026-06-01T00:00:00+00:00".to_string();

    let mut restarted = entry("aaa");
    restarted.progress = 0.05;
    restarted.progress_updated_at = "2026-06-02T00:00:00+00:00".to_string();

    let merged = merge(&doc(vec![first]), &doc(vec![restarted]), NOW);
    assert_eq!(find(&merged, "aaa").progress, 0.05);
  }

  /// Was impossible: one timestamp decided every field, so a title fix and a
  /// position change could not both survive.
  #[test]
  fn edits_to_different_fields_both_survive() {
    let mut retitled = entry("aaa");
    retitled.title = "Dune".to_string();
    retitled.metadata_updated_at = "2026-06-05T00:00:00+00:00".to_string();

    let mut advanced = entry("aaa");
    advanced.progress = 0.42;
    advanced.progress_updated_at = "2026-06-06T00:00:00+00:00".to_string();

    let merged = merge(&doc(vec![retitled]), &doc(vec![advanced]), NOW);
    let book = find(&merged, "aaa");

    assert_eq!(book.title, "Dune");
    assert_eq!(book.progress, 0.42);
  }

  /// Was: absolute `local_path` and `cover_url` travelled between machines, so
  /// the receiving device adopted paths that did not exist and covers broke.
  /// They are not fields of the document at all now; the local path is derived
  /// and the cover is the caller's to supply.
  #[test]
  fn machine_local_paths_are_not_part_of_the_document() {
    let json = serde_json::to_string(&entry("aaa")).unwrap();
    assert!(!json.contains("localPath"));
    assert!(!json.contains("coverUrl"));

    let record = entry("aaa").to_record("D:\\bob\\books\\aaa.epub".to_string(), None);
    assert_eq!(record.local_path, "D:\\bob\\books\\aaa.epub");
    assert_eq!(record.cover_url, None);
  }

  /// Every device names a stored book the same way, because the name is its
  /// content hash. That is what lets the two sides agree without a server.
  #[test]
  fn the_shared_name_is_content_addressed() {
    assert_eq!(entry("abc123").remote_name(), "abc123.epub");
    let mut no_ext = entry("abc123");
    no_ext.ext = String::new();
    assert_eq!(no_ext.remote_name(), "abc123");
  }

  // ---- the properties that make sync safe --------------------------------

  fn note(id: &str, updated_at: &str, text: &str, deleted_at: Option<&str>) -> crate::db::Annotation {
    crate::db::Annotation {
      id: id.into(),
      book_id: "b".into(),
      kind: "highlight".into(),
      cfi: "epubcfi(/6/2!/4/2,/1:0,/1:5)".into(),
      text: Some(text.into()),
      note: None,
      color: None,
      chapter: None,
      created_at: "2026-09-01T10:00:00Z".into(),
      updated_at: updated_at.into(),
      deleted_at: deleted_at.map(Into::into)
    }
  }

  #[test]
  fn annotations_merge_newest_edit_wins_and_deletes_travel() {
    let now = "2026-09-28T12:00:00Z";
    let mut a = SyncDoc::empty(now);
    let mut b = SyncDoc::empty(now);
    a.annotations = vec![note("n1", "2026-09-10T10:00:00Z", "old", None), note("n2", "2026-09-10T10:00:00Z", "kept", None)];
    b.annotations = vec![
      note("n1", "2026-09-12T10:00:00Z", "edited", None),
      note("n2", "2026-09-20T10:00:00Z", "kept", Some("2026-09-20T10:00:00Z")),
      note("n3", "2026-09-11T10:00:00Z", "new", None)
    ];
    let ab = merge(&a, &b, now);
    let ba = merge(&b, &a, now);
    assert_eq!(ab.annotations, ba.annotations, "commutative");
    assert_eq!(merge(&ab, &b, now).annotations, ab.annotations, "idempotent");
    let by_id = |id: &str| ab.annotations.iter().find(|n| n.id == id).cloned();
    assert_eq!(by_id("n1").and_then(|n| n.text).as_deref(), Some("edited"));
    assert!(by_id("n2").map(|n| n.deleted_at.is_some()).unwrap_or(false), "a delete reaches the other copy");
    assert!(by_id("n3").is_some());
    // An old tombstone is dropped, as a book's is.
    let mut old = SyncDoc::empty(now);
    old.annotations = vec![note("gone", "2026-01-01T00:00:00Z", "x", Some("2026-01-01T00:00:00Z"))];
    assert!(merge(&old, &SyncDoc::empty(now), now).annotations.is_empty());
  }

  #[test]
  fn a_known_series_wins_a_tie_and_a_readers_edit_wins_outright() {
    let plain = entry("aaa");
    let mut scanned = entry("aaa");
    scanned.series = Some("Harry Potter".into());
    scanned.series_index = Some(2.0);
    // Same stamp: one device read the series from the file, the other has not.
    let ab = merge(&doc(vec![plain.clone()]), &doc(vec![scanned.clone()]), NOW);
    let ba = merge(&doc(vec![scanned.clone()]), &doc(vec![plain.clone()]), NOW);
    assert_eq!(ab, ba, "commutative");
    assert_eq!(find(&ab, "aaa").series.as_deref(), Some("Harry Potter"));
    assert_eq!(find(&ab, "aaa").series_index, Some(2.0));

    // The reader says "not in a series", later: that holds.
    let mut none = plain.clone();
    none.series = Some(String::new());
    none.metadata_updated_at = "2026-03-01T00:00:00+00:00".into();
    let merged = merge(&doc(vec![scanned]), &doc(vec![none]), NOW);
    assert_eq!(find(&merged, "aaa").series.as_deref(), Some(""));
  }

  #[test]
  fn collections_merge_newest_edit_wins() {
    let shelf = |name: &str, books: &[&str], updated_at: &str| crate::db::Collection {
      id: "c1".into(),
      name: name.into(),
      book_ids: books.iter().map(|id| id.to_string()).collect(),
      created_at: "2026-09-01T10:00:00Z".into(),
      updated_at: updated_at.into(),
      deleted_at: None
    };
    let now = "2026-09-28T12:00:00Z";
    let mut a = SyncDoc::empty(now);
    let mut b = SyncDoc::empty(now);
    a.collections = vec![shelf("Book club", &["b1"], "2026-09-10T10:00:00Z")];
    b.collections = vec![shelf("Book club", &["b1", "b2"], "2026-09-12T10:00:00Z")];
    let ab = merge(&a, &b, now);
    assert_eq!(ab.collections, merge(&b, &a, now).collections, "commutative");
    assert_eq!(ab.collections[0].book_ids, vec!["b1".to_string(), "b2".to_string()]);
  }

  #[test]
  fn merge_is_commutative() {
    let mut a = entry("aaa");
    a.progress = 0.4;
    a.progress_updated_at = "2026-06-03T00:00:00+00:00".to_string();
    let mut b = entry("aaa");
    b.title = "Renamed".to_string();
    b.metadata_updated_at = "2026-06-04T00:00:00+00:00".to_string();
    let extra = entry("bbb");

    let left = merge(&doc(vec![a.clone(), extra.clone()]), &doc(vec![b.clone()]), NOW);
    let right = merge(&doc(vec![b]), &doc(vec![a, extra]), NOW);

    assert_eq!(left, right);
  }

  #[test]
  fn merge_is_idempotent() {
    let mut a = entry("aaa");
    a.progress = 0.4;
    a.progress_updated_at = "2026-06-03T00:00:00+00:00".to_string();
    let local = doc(vec![a]);
    let remote = doc(vec![entry("aaa"), entry("bbb")]);

    let once = merge(&local, &remote, NOW);
    let twice = merge(&local, &once, NOW);

    assert_eq!(once, twice);
  }

  /// Three devices, each holding a different piece, all end up the same.
  #[test]
  fn three_devices_converge() {
    let mut phone = entry("aaa");
    phone.progress = 0.2;
    phone.progress_updated_at = "2026-06-01T00:00:00+00:00".to_string();

    let mut laptop = entry("aaa");
    laptop.title = "The Dispossessed".to_string();
    laptop.metadata_updated_at = "2026-06-02T00:00:00+00:00".to_string();

    let desktop = doc(vec![entry("bbb")]);

    let a = merge(&merge(&doc(vec![phone.clone()]), &doc(vec![laptop.clone()]), NOW), &desktop, NOW);
    let b = merge(&merge(&desktop, &doc(vec![laptop]), NOW), &doc(vec![phone]), NOW);

    assert_eq!(a, b);
    assert_eq!(a.books.len(), 2);
    assert_eq!(find(&a, "aaa").progress, 0.2);
    assert_eq!(find(&a, "aaa").title, "The Dispossessed");
  }

  /// Two devices in different zones wrote the same day. Comparing the strings
  /// would pick the wrong one, because `+05:30` sorts after `+00:00` as text
  /// while being the earlier instant.
  #[test]
  fn timestamps_are_compared_as_instants_not_as_text() {
    let mut india = entry("aaa");
    india.progress = 0.1;
    // 00:30 UTC
    india.progress_updated_at = "2026-06-01T06:00:00+05:30".to_string();

    let mut london = entry("aaa");
    london.progress = 0.7;
    // 01:00 UTC — half an hour later in real time, earlier as a string.
    london.progress_updated_at = "2026-06-01T01:00:00+00:00".to_string();

    let merged = merge(&doc(vec![india]), &doc(vec![london]), NOW);
    assert_eq!(find(&merged, "aaa").progress, 0.7);
  }

  // ---- exact position ----------------------------------------------------

  /// The CFI is the same fact as the percentage at finer grain, so the side
  /// that wins progress supplies both — in either argument order.
  #[test]
  fn position_follows_the_progress_winner() {
    let mut newer = entry("aaa");
    newer.progress = 0.3;
    newer.position = Some("epubcfi(/6/10!/4/2/1:0)".to_string());
    newer.progress_updated_at = "2026-06-02T00:00:00+00:00".to_string();

    let mut older = entry("aaa");
    older.progress = 0.8;
    older.position = Some("epubcfi(/6/30!/4/2/1:0)".to_string());
    older.progress_updated_at = "2026-06-01T00:00:00+00:00".to_string();

    for merged in [
      merge(&doc(vec![newer.clone()]), &doc(vec![older.clone()]), NOW),
      merge(&doc(vec![older]), &doc(vec![newer]), NOW)
    ] {
      let book = find(&merged, "aaa");
      assert_eq!(book.progress, 0.3);
      assert_eq!(book.position.as_deref(), Some("epubcfi(/6/10!/4/2/1:0)"));
    }
  }

  /// A newer percentage with no CFI (an older client, or a device that only
  /// knew the percentage) must not be paired with the loser's CFI, which
  /// points somewhere else in the book.
  #[test]
  fn a_winner_without_a_position_does_not_borrow_the_losers() {
    let mut newer = entry("aaa");
    newer.progress = 0.6;
    newer.position = None;
    newer.progress_updated_at = "2026-06-02T00:00:00+00:00".to_string();

    let mut older = entry("aaa");
    older.progress = 0.2;
    older.position = Some("epubcfi(/6/4!/4/2/1:0)".to_string());
    older.progress_updated_at = "2026-06-01T00:00:00+00:00".to_string();

    let merged = merge(&doc(vec![older]), &doc(vec![newer]), NOW);
    let book = find(&merged, "aaa");
    assert_eq!(book.progress, 0.6);
    assert_eq!(book.position, None);
  }

  #[test]
  fn a_winning_position_survives_a_side_that_has_none() {
    let mut newer = entry("aaa");
    newer.progress = 0.6;
    newer.position = Some("epubcfi(/6/12!/4/2/1:0)".to_string());
    newer.progress_updated_at = "2026-06-02T00:00:00+00:00".to_string();

    // A book this device has never read, as an older client would write it.
    let older = entry("aaa");

    let merged = merge(&doc(vec![older]), &doc(vec![newer]), NOW);
    assert_eq!(
      find(&merged, "aaa").position.as_deref(),
      Some("epubcfi(/6/12!/4/2/1:0)")
    );
  }

  /// Same stamp, same percentage, different CFI: the tie has to be broken by
  /// the CFI or the two devices could settle on different places.
  #[test]
  fn a_full_tie_is_still_commutative() {
    let mut a = entry("aaa");
    a.progress = 0.5;
    a.position = Some("epubcfi(/6/8!/4/2/1:0)".to_string());
    a.progress_updated_at = "2026-06-01T00:00:00+00:00".to_string();
    let mut b = a.clone();
    b.position = Some("epubcfi(/6/8!/4/20/1:0)".to_string());

    let left = merge(&doc(vec![a.clone()]), &doc(vec![b.clone()]), NOW);
    let right = merge(&doc(vec![b]), &doc(vec![a]), NOW);
    assert_eq!(left, right);
  }

  /// Documents written before `position` existed must still merge.
  #[test]
  fn a_document_without_positions_still_parses() {
    let json = r#"{
      "version": 1,
      "updatedAt": "2026-08-01T00:00:00+00:00",
      "books": [{
        "id": "aaa",
        "ext": "epub",
        "title": "Old",
        "author": null,
        "genres": [],
        "metadataUpdatedAt": "2026-01-01T00:00:00+00:00",
        "progress": 0.25,
        "progressUpdatedAt": "2026-01-01T00:00:00+00:00",
        "lastOpened": null,
        "createdAt": "2026-01-01T00:00:00+00:00",
        "deletedAt": null
      }]
    }"#;
    let legacy: SyncDoc = serde_json::from_str(json).expect("legacy document");
    assert_eq!(legacy.books[0].position, None);

    let mut current = entry("aaa");
    current.progress = 0.4;
    current.position = Some("epubcfi(/6/6!/4/2/1:0)".to_string());
    current.progress_updated_at = "2026-06-01T00:00:00+00:00".to_string();

    let merged = merge(&legacy, &doc(vec![current]), NOW);
    assert_eq!(find(&merged, "aaa").position.as_deref(), Some("epubcfi(/6/6!/4/2/1:0)"));
  }

  // ---- tombstones --------------------------------------------------------

  #[test]
  fn re_importing_a_deleted_book_brings_it_back() {
    let mut deleted = entry("aaa");
    deleted.deleted_at = Some("2026-06-01T00:00:00+00:00".to_string());

    // A fresh import stamps the metadata group, which is how the merge learns
    // the book was wanted again.
    let mut reimported = entry("aaa");
    reimported.metadata_updated_at = "2026-06-02T00:00:00+00:00".to_string();

    let merged = merge(&doc(vec![deleted]), &doc(vec![reimported]), NOW);
    assert!(!find(&merged, "aaa").is_deleted());
  }

  #[test]
  fn a_deletion_beats_an_earlier_edit() {
    let mut deleted = entry("aaa");
    deleted.deleted_at = Some("2026-06-05T00:00:00+00:00".to_string());

    let mut edited = entry("aaa");
    edited.metadata_updated_at = "2026-06-01T00:00:00+00:00".to_string();

    let merged = merge(&doc(vec![deleted]), &doc(vec![edited]), NOW);
    assert!(find(&merged, "aaa").is_deleted());
  }

  #[test]
  fn stale_tombstones_are_collected() {
    let mut ancient = entry("aaa");
    // Well past the retention window, so every device has long since seen it.
    ancient.deleted_at = Some("2025-01-01T00:00:00+00:00".to_string());
    let merged = merge(&doc(vec![ancient]), &doc(vec![]), NOW);
    assert!(merged.books.is_empty());
  }

  #[test]
  fn recent_tombstones_are_kept_so_they_can_travel() {
    let mut fresh = entry("aaa");
    fresh.deleted_at = Some("2026-08-20T00:00:00+00:00".to_string());
    let merged = merge(&doc(vec![fresh]), &doc(vec![]), NOW);
    assert_eq!(merged.books.len(), 1);
    assert!(merged.books[0].is_deleted());
  }

  /// A library written before per-field stamps existed has none. Falling back to
  /// `created_at` makes it lose to any real edit, rather than winning by chance.
  #[test]
  fn an_unstamped_legacy_record_loses_to_a_real_edit() {
    let legacy = BookRecord {
      id: "aaa".to_string(),
      title: "Old".to_string(),
      author: None,
      genres: Vec::new(),
      cover_url: None,
      local_path: "/books/aaa.epub".to_string(),
      file_hash: "aaa".to_string(),
      progress: 0.1,
      position: None,
      series: None,
      series_index: None,
      last_opened: None,
      created_at: "2026-01-01T00:00:00+00:00".to_string(),
      metadata_checked_at: None,
      metadata_updated_at: None,
      progress_updated_at: None,
      deleted_at: None,
      available: true
    };
    let converted = BookEntry::from_record(&legacy);
    assert_eq!(converted.progress_updated_at, "2026-01-01T00:00:00+00:00");
    assert_eq!(converted.ext, "epub");

    let mut edited = entry("aaa");
    edited.progress = 0.6;
    edited.progress_updated_at = "2026-06-01T00:00:00+00:00".to_string();

    let merged = merge(&doc(vec![converted]), &doc(vec![edited]), NOW);
    assert_eq!(find(&merged, "aaa").progress, 0.6);
  }

  // ---- habit ledger ------------------------------------------------------

  fn day(key: &str, minutes: f64) -> DayEntry {
    DayEntry {
      date_key: key.to_string(),
      minutes,
      goal_minutes: 20,
      freeze_used: false,
      grace_used: false
    }
  }

  /// Minutes take the maximum, not the sum: neither device knows how much of the
  /// other's time overlapped its own, and summing would let repeated syncing
  /// inflate a streak.
  #[test]
  fn day_minutes_take_the_maximum() {
    let mine = SyncDoc { days: vec![day("2026-08-01", 12.0)], ..doc(vec![]) };
    let theirs = SyncDoc { days: vec![day("2026-08-01", 30.0)], ..doc(vec![]) };

    let merged = merge(&mine, &theirs, NOW);
    assert_eq!(merged.days[0].minutes, 30.0);
  }

  fn day_with(minutes: f64, goal_minutes: i64) -> DayEntry {
    DayEntry { goal_minutes, ..day("2026-10-03", minutes) }
  }

  fn met(day: &DayEntry) -> bool {
    day.to_record().goal_met()
  }

  /// A day met on one device stays met when the other read more against a
  /// goal it did not reach: the reported case, which broke the streak and
  /// burned the shelf.
  #[test]
  fn a_day_met_on_one_device_is_not_unmet_by_the_other() {
    let here = SyncDoc { days: vec![day("2026-10-02", 25.0), day_with(25.0, 20)], ..doc(vec![]) };
    let there = SyncDoc { days: vec![day_with(26.0, 60)], ..doc(vec![]) };

    let merged = merge(&here, &there, NOW);
    let today = merged.days.iter().find(|d| d.date_key == "2026-10-03").expect("today");
    assert_eq!((today.minutes, today.goal_minutes), (26.0, 20));
    assert!(met(today));

    // The streak this device held before the sync still stands: no break,
    // nothing to burn.
    let ledger = merged.days.iter().map(|d| (d.date_key.clone(), d.to_record())).collect();
    let previous = crate::habit::StreakState {
      current_streak: 2,
      longest_streak: 2,
      last_evaluated_day: Some("2026-10-03".to_string()),
      ..Default::default()
    };
    let result = crate::habit::evaluate(&ledger, "2026-10-03", &previous);
    assert_eq!(result.streak, 2);
    assert_eq!(result.broke_from, None);
    assert_eq!(result.burn_count, 0);
  }

  #[test]
  fn the_goal_kept_is_the_hardest_one_met() {
    // Both met: the harder goal.
    assert_eq!(merge_day(&day_with(25.0, 20), &day_with(70.0, 60)).goal_minutes, 60);
    // One met: its goal, even on equal minutes.
    assert_eq!(merge_day(&day_with(25.0, 20), &day_with(25.0, 60)).goal_minutes, 20);
    // Neither met: the goal of the one that read more; a tie takes the harder.
    assert_eq!(merge_day(&day_with(10.0, 20), &day_with(15.0, 60)).goal_minutes, 60);
    assert_eq!(merge_day(&day_with(15.0, 20), &day_with(10.0, 60)).goal_minutes, 20);
    assert_eq!(merge_day(&day_with(10.0, 20), &day_with(10.0, 60)).goal_minutes, 60);
  }

  /// Every pair and triple of a small grid of days: the merge is the same in
  /// any order, repeating it changes nothing, and a day comes out met exactly
  /// when some device met it.
  #[test]
  fn day_merges_commute_repeat_and_converge_with_goals() {
    let mut grid = Vec::new();
    for minutes in [0.0, 10.0, 25.0, 26.0, 70.0] {
      for goal in [0, 20, 60] {
        for covered in [false, true] {
          let mut entry = day_with(minutes, goal);
          entry.grace_used = covered;
          grid.push(entry);
        }
      }
    }
    for a in &grid {
      assert_eq!(&merge_day(a, a), a, "a day merged with itself is itself");
      for b in &grid {
        let ab = merge_day(a, b);
        assert_eq!(ab, merge_day(b, a), "commutative: {a:?} {b:?}");
        assert_eq!(merge_day(a, &ab), ab, "idempotent: {a:?} {b:?}");
        assert_eq!(merge_day(&ab, b), ab, "idempotent: {a:?} {b:?}");
        assert_eq!(met(&ab), met(a) || met(b), "met exactly when one of them was: {a:?} {b:?}");
        assert_eq!(ab.minutes, a.minutes.max(b.minutes));
        for c in &grid {
          let one = merge_day(&ab, c);
          assert_eq!(one, merge_day(a, &merge_day(b, c)), "three devices: {a:?} {b:?} {c:?}");
          assert_eq!(one, merge_day(&merge_day(c, a), b), "three devices: {a:?} {b:?} {c:?}");
        }
      }
    }
  }

  /// The same through whole documents, as the devices exchange them.
  #[test]
  fn three_devices_converge_on_a_day_and_its_goal() {
    let phone = SyncDoc { days: vec![day_with(25.0, 20)], ..doc(vec![]) };
    let laptop = SyncDoc { days: vec![day_with(26.0, 60)], ..doc(vec![]) };
    let desktop = SyncDoc { days: vec![day_with(45.0, 30)], ..doc(vec![]) };

    let a = merge(&merge(&phone, &laptop, NOW), &desktop, NOW);
    let b = merge(&merge(&desktop, &laptop, NOW), &phone, NOW);
    let c = merge(&laptop, &merge(&phone, &desktop, NOW), NOW);
    assert_eq!(a, b);
    assert_eq!(a, c);
    assert_eq!((a.days[0].minutes, a.days[0].goal_minutes), (45.0, 30));
    assert_eq!(merge(&a, &phone, NOW), a, "a device syncing again changes nothing");
  }

  #[test]
  fn a_spent_freeze_stays_spent_everywhere() {
    let mut spent = day("2026-08-01", 0.0);
    spent.freeze_used = true;
    let mine = SyncDoc { days: vec![spent], ..doc(vec![]) };
    let theirs = SyncDoc { days: vec![day("2026-08-01", 5.0)], ..doc(vec![]) };

    let merged = merge(&mine, &theirs, NOW);
    assert!(merged.days[0].freeze_used);
  }

  // ---- session shelf -----------------------------------------------------

  fn session(id: &str) -> SessionEntry {
    SessionEntry {
      id: id.to_string(),
      started_at: "2026-08-01T10:00:00+00:00".to_string(),
      ended_at: "2026-08-01T10:25:00+00:00".to_string(),
      date_key: "2026-08-01".to_string(),
      minutes: 25.0,
      book_id: Some("aaa".to_string()),
      title: Some("Book aaa".to_string()),
      notes: None,
      ended_reason: "completed".to_string(),
      clean: true,
      style_seed: "seed".to_string(),
      burned_at: None,
      flower: None,
      flower_bloomed: false
    }
  }

  #[test]
  fn a_bloom_travels_and_is_never_lost() {
    let mut bloomed = session("s1");
    bloomed.flower = Some("rose".to_string());
    bloomed.flower_bloomed = true;
    let mine = SyncDoc { sessions: vec![bloomed.clone()], ..doc(vec![]) };
    let theirs = SyncDoc { sessions: vec![session("s1")], ..doc(vec![]) };
    for merged in [merge(&mine, &theirs, NOW), merge(&theirs, &mine, NOW)] {
      assert_eq!(merged.sessions[0].flower.as_deref(), Some("rose"));
      assert!(merged.sessions[0].flower_bloomed);
    }
    // A session without a flower leaves the fields out of the document, so an
    // older build reads it as before.
    let json = serde_json::to_string(&session("s2")).expect("json");
    assert!(!json.contains("flower"), "{json}");
    let back: SessionEntry = serde_json::from_str(&serde_json::to_string(&bloomed).expect("json")).expect("parse");
    assert_eq!(back, bloomed);
  }

  #[test]
  fn a_burned_session_stays_burned() {
    let mut burned = session("s1");
    burned.burned_at = Some("2026-08-10T00:00:00+00:00".to_string());
    let mine = SyncDoc { sessions: vec![burned], ..doc(vec![]) };
    let theirs = SyncDoc { sessions: vec![session("s1")], ..doc(vec![]) };

    let merged = merge(&mine, &theirs, NOW);
    assert!(merged.sessions[0].burned_at.is_some());
  }

  #[test]
  fn a_note_written_on_either_device_survives() {
    let mut annotated = session("s1");
    annotated.notes = Some("the bit about the desert".to_string());
    let mine = SyncDoc { sessions: vec![session("s1")], ..doc(vec![]) };
    let theirs = SyncDoc { sessions: vec![annotated], ..doc(vec![]) };

    let merged = merge(&mine, &theirs, NOW);
    assert_eq!(
      merged.sessions[0].notes.as_deref(),
      Some("the bit about the desert")
    );
  }

  /// The output order must not depend on which device did the merging, or two
  /// machines produce byte-different documents from the same inputs and
  /// re-upload each other's work forever.
  #[test]
  fn output_order_is_stable() {
    let books = vec![entry("ccc"), entry("aaa"), entry("bbb")];
    let merged = merge(&doc(books.clone()), &doc(vec![]), NOW);
    let ids: Vec<&str> = merged.books.iter().map(|book| book.id.as_str()).collect();
    assert_eq!(ids, vec!["aaa", "bbb", "ccc"]);
  }

  // ---- Pip's shop --------------------------------------------------------

  fn purchase(id: &str, item: &str) -> Purchase {
    Purchase {
      id: id.to_string(),
      item_kind: "skin".to_string(),
      item_id: item.to_string(),
      price: 300,
      bought_at: "2026-08-01T10:00:00+00:00".to_string()
    }
  }

  fn pip_at(updated_at: &str, variant: &str) -> PipState {
    let mut state = PipState::fresh(updated_at);
    state.variant = variant.to_string();
    state
  }

  /// Seeds spent on either device stay spent: purchases are a union, so
  /// buying on one machine can never be undone (or refunded) by another.
  #[test]
  fn purchases_from_both_devices_are_kept_once() {
    let mine = SyncDoc { purchases: vec![purchase("buy-a", "chef"), purchase("buy-b", "punk")], ..doc(vec![]) };
    let theirs = SyncDoc { purchases: vec![purchase("buy-b", "punk"), purchase("buy-c", "king")], ..doc(vec![]) };

    let merged = merge(&mine, &theirs, NOW);
    let ids: Vec<&str> = merged.purchases.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids, vec!["buy-a", "buy-b", "buy-c"]);
    assert_eq!(merged.purchases, merge(&theirs, &mine, NOW).purchases, "commutative");
    assert_eq!(merge(&mine, &merged, NOW).purchases, merged.purchases, "idempotent");
  }

  #[test]
  fn the_newer_pip_state_wins_and_a_tie_is_settled_the_same_both_ways() {
    let older = SyncDoc { pip: Some(pip_at("2026-08-01T10:00:00+00:00", "chef")), ..doc(vec![]) };
    let newer = SyncDoc { pip: Some(pip_at("2026-08-02T10:00:00+00:00", "punk")), ..doc(vec![]) };
    assert_eq!(merge(&older, &newer, NOW).pip.map(|p| p.variant).as_deref(), Some("punk"));
    assert_eq!(merge(&newer, &older, NOW).pip.map(|p| p.variant).as_deref(), Some("punk"));

    let tie_a = SyncDoc { pip: Some(pip_at("2026-08-01T10:00:00+00:00", "chef")), ..doc(vec![]) };
    let tie_b = SyncDoc { pip: Some(pip_at("2026-08-01T10:00:00+00:00", "king")), ..doc(vec![]) };
    assert_eq!(merge(&tie_a, &tie_b, NOW).pip, merge(&tie_b, &tie_a, NOW).pip);

    let none = doc(vec![]);
    assert_eq!(merge(&none, &older, NOW).pip, older.pip, "a device that never opened the Pip tab loses nothing");
  }

  /// A document written before the shop existed still parses, with no purchases.
  #[test]
  fn a_document_from_before_the_shop_parses() {
    let json = r#"{"version":1,"updatedAt":"2026-08-01T00:00:00Z","books":[],"days":[],"sessions":[]}"#;
    let parsed: SyncDoc = serde_json::from_str(json).expect("parses");
    assert!(parsed.purchases.is_empty());
    assert!(parsed.pip.is_none());
  }

  /// The garden's records merge like purchases: a union by id, the same on
  /// both devices, and merging again changes nothing.
  #[test]
  fn plantings_and_harvests_from_both_devices_are_kept_once() {
    let planting = |id: &str, plot: i64| Planting {
      id: id.to_string(),
      plot,
      plant: "sunflower".to_string(),
      planted_at: "2026-09-28T10:00:00+00:00".to_string()
    };
    let picked = Harvest {
      id: "pick-a".to_string(),
      planting_id: "a".to_string(),
      seeds: 20,
      harvested_at: "2026-09-29T10:00:00+00:00".to_string()
    };
    let mine = SyncDoc { plantings: vec![planting("a", 1)], harvests: vec![picked.clone()], ..doc(vec![]) };
    let theirs = SyncDoc { plantings: vec![planting("a", 1), planting("b", 2)], ..doc(vec![]) };
    let merged = merge(&mine, &theirs, NOW);
    assert_eq!(merged.plantings.len(), 2);
    assert_eq!(merged.harvests, vec![picked]);
    assert_eq!(merged.plantings, merge(&theirs, &mine, NOW).plantings, "commutative");
    assert_eq!(merge(&mine, &merged, NOW), merge(&merged, &mine, NOW));
  }
}
