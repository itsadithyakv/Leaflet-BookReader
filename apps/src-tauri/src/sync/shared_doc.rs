//! One round with the shared document, apart from how its bytes travel:
//! read it, merge this device's state in, write it back only over the copy
//! that was read, and check the write stuck.
//!
//! Drive is the transport that needs this (`drive::DriveDoc`); a fake store
//! in the tests below runs two devices against one document with no network,
//! which is how the two-device rules of docs/two-devices.md are proved.
//!
//! Two devices can write at the same moment (reading on the train while the
//! laptop is open at home). Each write names the copy it was merged over
//! (`If-Match` on Drive); a write over a copy that has since changed is
//! refused, and the round starts again from the newer copy. A store that
//! takes the write anyway (one that ignores `If-Match`) is caught by reading
//! back: if what this device sent is no longer all there, it merges again.
//!
//! Every round also asks whose library the store holds (`owner::store_mode`),
//! from what it has just read: the document's owner, else the marker kept
//! beside it. A store that holds another account's library is not merged
//! with ([`Round::Refused`]); a device that loses a race to claim one finds
//! it taken when it reads again, and takes nothing from it.

use crate::db::Database;
use crate::sync::folder::SyncReport;
use crate::sync::merge::{self, has_news, Remote, SyncDoc};
use crate::sync::owner::{self, StoreMode};
use crate::sync::store;
use crate::LockExt;
use anyhow::{anyhow, Result};
use std::future::Future;
use std::pin::Pin;

/// A store's answer, boxed so the trait is object-safe and `Send` (a Tauri
/// command awaits it).
pub type Pending<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

/// Which copy of the document was read: where it is, its revision, and the
/// owner marked beside it (which survives an older Leaflet's write, which
/// drops the document's own `owner`).
#[derive(Debug, Clone, PartialEq)]
pub struct Held {
  pub id: String,
  pub revision: Option<String>,
  pub owner_mark: Option<String>
}

/// How a write went.
#[derive(Debug, PartialEq)]
pub enum Written {
  Kept,
  /// Another device wrote since the copy named was read.
  Conflict
}

/// Where the shared document lives.
pub trait DocStore: Sync {
  /// The document as it is now, and which copy it is (`None`: there is none yet).
  fn read(&self) -> Pending<'_, (Remote, Option<Held>)>;
  /// Writes `body` over `held`, only if `held` is still the current copy;
  /// with `None`, makes the first one. With an `owner`, marks it beside the
  /// document too, where the held copy is not marked so already.
  fn write<'a>(&'a self, held: Option<&'a Held>, body: Vec<u8>, owner: Option<&'a str>) -> Pending<'a, Written>;
}

/// Who is syncing: the signed-in account's tag (none, signed out), and
/// whether a store of the account's own still gets the state (the bridge).
#[derive(Debug, Clone, PartialEq)]
pub struct Who {
  pub signed_in: Option<String>,
  pub bridge: bool
}

impl Who {
  pub fn signed_out() -> Self {
    Who { signed_in: None, bridge: owner::BRIDGE_STATE_JSON }
  }

  pub fn signed_in(tag: &str) -> Self {
    Who { signed_in: Some(tag.to_string()), bridge: owner::BRIDGE_STATE_JSON }
  }

  /// What a store is to this device, given the library's owner and the store's.
  pub fn mode(&self, local: Option<&str>, remote: Option<&str>) -> StoreMode {
    owner::store_mode(self.signed_in.as_deref(), local, remote, self.bridge)
  }
}

/// The store's owner: its document's, else its marker's.
pub fn remote_owner(doc_owner: Option<&str>, mark: Option<&str>) -> Option<String> {
  owner::clean(doc_owner).or_else(|| owner::clean(mark))
}

/// The owner a merged document is written with, in a mode that merges at
/// all: the signed-in account's when it claims or bridges; otherwise the two
/// sides' (`merge::merge`), which is how a signed-out device of the owner
/// stamps a document an older Leaflet left without one.
pub fn stamp_for(mode: StoreMode, who: &Who) -> Option<String> {
  match mode {
    StoreMode::Claim | StoreMode::Bridge => who.signed_in.clone(),
    _ => None
  }
}

/// Whether `remote` has anything `local` lacks: whether merging it in changes
/// this library. The owner is not counted (a stamp is no news).
pub fn brings(local: &SyncDoc, remote: &SyncDoc, now: &str) -> bool {
  let mut remote = remote.clone();
  remote.owner.clone_from(&local.owner);
  !holds(local, &remote, now)
}

/// The document a round writes: this device's state over the store's, with
/// the store's owner (its marker's, when the document lost its own) and,
/// claiming or bridging, this account's stamp.
pub fn merged_for(
  local: &SyncDoc,
  remote: Option<&SyncDoc>,
  remote_owner: &Option<String>,
  stamp: &Option<String>,
  now: &str
) -> SyncDoc {
  let mut remote = remote.cloned().unwrap_or_else(|| SyncDoc::empty(now));
  remote.owner.clone_from(remote_owner);
  let mut merged = merge::merge(local, &remote, now);
  if stamp.is_some() {
    merged.owner.clone_from(stamp);
  }
  merged
}

/// How many rounds before giving up for now: each lost one means another
/// device wrote in between, which does not happen four times running.
pub const MAX_ROUNDS: u32 = 4;

/// What a round came to.
#[derive(Debug)]
pub enum Round {
  /// The document as it now is, everywhere this device can tell, and whether
  /// the store brought anything this library lacked.
  Merged { doc: SyncDoc, brought_news: bool },
  /// A later Leaflet wrote it: nothing was written (`merge::read_remote`).
  Newer(Option<SyncDoc>),
  /// The store holds another account's library (or, signed in, one whose
  /// state is not this device's to keep there): nothing was taken from it
  /// and nothing written.
  Refused
}

/// Whether `ours` is all in `theirs`: merging it in would change nothing.
/// Both sides are put through the merge, so tidying that depends on the day
/// (old tombstones, old per-device figures) does not count as a difference.
fn holds(theirs: &SyncDoc, ours: &SyncDoc, now: &str) -> bool {
  let with_ours = merge::merge(theirs, ours, now);
  let alone = merge::merge(theirs, theirs, now);
  !has_news(&with_ours, Some(&alone))
}

/// Reads, merges this device's state in, writes, and checks. Nothing local is
/// changed: the caller applies what comes back.
pub async fn exchange<S: DocStore + ?Sized>(
  db_mutex: &std::sync::Mutex<Database>,
  doc_store: &S,
  now: &str,
  who: &Who
) -> Result<Round> {
  let mut round = 0;
  loop {
    let (remote, held) = doc_store.read().await?;
    let mark = held.as_ref().and_then(|held| held.owner_mark.clone());
    let doc_owner = match &remote {
      Remote::Ours(doc) | Remote::Newer(Some(doc)) => doc.owner.clone(),
      _ => None
    };
    let there = remote_owner(doc_owner.as_deref(), mark.as_deref());
    let (local, local_owner) = {
      let db = db_mutex.guard();
      (store::snapshot(&db, now)?, owner::get(&db))
    };
    // Whose the store is, from what was read just now: a device that lost a
    // race to claim it finds it taken here, and takes nothing from it.
    let mode = who.mode(local_owner.as_deref(), there.as_deref());
    if matches!(mode, StoreMode::FilesOnly | StoreMode::Refuse) {
      return Ok(Round::Refused);
    }
    let remote = match remote {
      Remote::Ours(doc) => Some(doc),
      Remote::Absent => None,
      Remote::Newer(doc) => {
        return Ok(Round::Newer(doc.map(|mut doc| {
          doc.owner.clone_from(&there);
          doc
        })))
      }
    };
    let stamp = stamp_for(mode, who);
    let merged = merged_for(&local, remote.as_ref(), &there, &stamp, now);
    let brought_news = remote.as_ref().is_some_and(|remote| brings(&local, remote, now));
    // Nothing the store lacks: it is left as it is (no new revision for the
    // other device to race against). A copy without its marker is written
    // all the same, so the marker lands.
    let unmarked = merged.owner.is_some() && owner::clean(mark.as_deref()) != merged.owner;
    if !has_news(&merged, remote.as_ref()) && !unmarked {
      return Ok(Round::Merged { doc: merged, brought_news });
    }

    let body = serde_json::to_vec_pretty(&merged)?;
    if doc_store.write(held.as_ref(), body, merged.owner.as_deref()).await? == Written::Kept {
      // Read back: a store that took the write over a newer copy (ignoring
      // the revision) has lost the other device's work, or a writer that did
      // the same has lost ours. Either way what was sent is not all there.
      // Nor is it when the store has become another account's meanwhile.
      let (back, back_held) = doc_store.read().await?;
      let back_mark = back_held.and_then(|held| held.owner_mark);
      let kept = match back {
        Remote::Ours(there) => {
          let owner_now = remote_owner(there.owner.as_deref(), back_mark.as_deref());
          (merged.owner.is_none() || owner_now == merged.owner) && holds(&there, &merged, now)
        }
        // A later version wrote meanwhile: ours is its to keep or not.
        Remote::Newer(_) => true,
        Remote::Absent => false
      };
      if kept {
        return Ok(Round::Merged { doc: merged, brought_news });
      }
    }

    round += 1;
    if round >= MAX_ROUNDS {
      return Err(anyhow!("Another device is syncing right now. Try again shortly."));
    }
  }
}

/// How a transport's state half went.
#[derive(Debug, Default)]
pub struct StateRun {
  pub report: SyncReport,
  /// The store brought something this library lacked (so the account's copy
  /// has news too).
  pub brought_news: bool,
  /// A later Leaflet wrote the store: nothing of this device's goes up there,
  /// files included, until it is updated.
  pub newer: bool,
  /// The store holds another account's library, or (signed in) one whose
  /// state is not this device's to keep: nothing was taken or written.
  pub refused: bool
}

/// A round, then its result applied here.
pub async fn sync<S: DocStore + ?Sized>(
  db_mutex: &std::sync::Mutex<Database>,
  doc_store: &S,
  now: &str,
  who: &Who
) -> Result<StateRun> {
  match exchange(db_mutex, doc_store, now, who).await? {
    Round::Refused => Ok(StateRun { refused: true, ..StateRun::default() }),
    Round::Newer(doc) => {
      let db = db_mutex.guard();
      let report = crate::sync::folder::take_from_newer(&db, doc, now)?;
      let brought_news = report.entries_updated > 0 || report.books_removed > 0;
      Ok(StateRun { report, brought_news, newer: true, refused: false })
    }
    Round::Merged { doc, brought_news } => {
      let applied = {
        let db = db_mutex.guard();
        store::apply(&db, &doc)?
      };
      let report = SyncReport {
        entries_updated: applied.updated,
        books_removed: applied.removed.len(),
        books_pending: applied.missing.len(),
        ..SyncReport::default()
      };
      Ok(StateRun { report, brought_news, newer: false, refused: false })
    }
  }
}

#[cfg(test)]
pub(crate) mod fake {
  use super::*;
  use std::sync::Mutex;

  /// Drive without the network: one document, a revision that counts writes,
  /// the owner marked beside it (`appProperties`), and two ways for another
  /// device to get in between a read and a write.
  #[derive(Default)]
  pub struct FakeDrive {
    inner: Mutex<Inner>
  }

  #[derive(Default)]
  struct Inner {
    body: Option<Vec<u8>>,
    revision: u64,
    mark: Option<String>,
    /// Written by "another device" just before the next write lands, with
    /// the mark it leaves.
    interloper: Option<(Vec<u8>, Option<String>)>,
    /// Written by "another device" just after the next write lands, over it.
    clobber: Option<Vec<u8>>,
    /// Takes a write whatever revision it names, as a store that does not
    /// honour `If-Match` would.
    ignores_revision: bool,
    writes: u32,
    conflicts: u32
  }

  impl FakeDrive {
    pub fn ignoring_revisions() -> Self {
      let drive = FakeDrive::default();
      drive.inner.lock().unwrap().ignores_revision = true;
      drive
    }

    pub fn doc(&self) -> Option<SyncDoc> {
      let inner = self.inner.lock().unwrap();
      inner.body.as_ref().map(|body| serde_json::from_slice(body).expect("a document"))
    }

    pub fn raw(&self) -> Option<Vec<u8>> {
      self.inner.lock().unwrap().body.clone()
    }

    pub fn put_raw(&self, body: Vec<u8>) {
      let mut inner = self.inner.lock().unwrap();
      inner.body = Some(body);
      inner.revision += 1;
    }

    /// The owner marked beside the document.
    pub fn mark(&self) -> Option<String> {
      self.inner.lock().unwrap().mark.clone()
    }

    /// What Leaflet 1.5.0 to 1.5.2 do to the document: read it into the
    /// shapes they know (no `owner`) and write it back. Drive keeps the mark.
    pub fn strip_owner(&self) {
      let mut inner = self.inner.lock().unwrap();
      if let Some(body) = &inner.body {
        let mut json: serde_json::Value = serde_json::from_slice(body).expect("json");
        json.as_object_mut().expect("an object").remove("owner");
        inner.body = Some(serde_json::to_vec_pretty(&json).expect("json"));
        inner.revision += 1;
      }
    }

    /// The next write finds this already written by someone else.
    pub fn sneak_in(&self, body: Vec<u8>) {
      self.inner.lock().unwrap().interloper = Some((body, None));
    }

    /// The same, by a device that marks what it writes.
    pub fn sneak_in_marked(&self, body: Vec<u8>, mark: &str) {
      self.inner.lock().unwrap().interloper = Some((body, Some(mark.to_string())));
    }

    /// The next write is written over at once by someone who never saw it.
    pub fn clobber_after(&self, body: Vec<u8>) {
      self.inner.lock().unwrap().clobber = Some(body);
    }

    pub fn writes(&self) -> u32 {
      self.inner.lock().unwrap().writes
    }

    pub fn conflicts(&self) -> u32 {
      self.inner.lock().unwrap().conflicts
    }
  }

  impl DocStore for FakeDrive {
    fn read(&self) -> Pending<'_, (Remote, Option<Held>)> {
      Box::pin(async move {
        let inner = self.inner.lock().unwrap();
        Ok(match &inner.body {
          None => (Remote::Absent, None),
          Some(body) => (
            merge::read_remote(body),
            Some(Held {
              id: "state".to_string(),
              revision: Some(inner.revision.to_string()),
              owner_mark: inner.mark.clone()
            })
          )
        })
      })
    }

    fn write<'a>(&'a self, held: Option<&'a Held>, body: Vec<u8>, owner: Option<&'a str>) -> Pending<'a, Written> {
      Box::pin(async move {
        let mut inner = self.inner.lock().unwrap();
        if let Some((theirs, mark)) = inner.interloper.take() {
          inner.body = Some(theirs);
          inner.revision += 1;
          if mark.is_some() {
            inner.mark = mark;
          }
        }
        let current = inner.body.as_ref().map(|_| inner.revision.to_string());
        let named = held.and_then(|held| held.revision.clone());
        if !inner.ignores_revision && current != named {
          inner.conflicts += 1;
          return Ok(Written::Conflict);
        }
        inner.body = Some(body);
        inner.revision += 1;
        inner.writes += 1;
        if let Some(owner) = owner {
          inner.mark = Some(owner.to_string());
        }
        if let Some(theirs) = inner.clobber.take() {
          inner.body = Some(theirs);
          inner.revision += 1;
        }
        Ok(Written::Kept)
      })
    }
  }
}
#[cfg(test)]
mod tests {
  //! Two devices, one document, no network (docs/two-devices.md, "The
  //! two-device script"): read on both in one day, a highlight edited on both,
  //! a book deleted on one, one device offline and back, an older version's
  //! document, and a write that loses a race.

  use super::fake::FakeDrive;
  use super::*;
  use crate::db::tests::memory_db;
  use crate::db::{Annotation, BookRecord};
  use std::sync::Mutex;

  struct Device {
    db: Mutex<Database>
  }

  impl Device {
    fn new() -> Self {
      Device { db: Mutex::new(memory_db()) }
    }

    async fn sync(&self, drive: &FakeDrive, now: &str) -> SyncReport {
      super::sync(&self.db, drive, now, &Who::signed_out()).await.expect("sync").report
    }

    fn minutes(&self, day: &str) -> f64 {
      self.db.guard().reading_days().expect("days").get(day).map(|d| d.minutes).unwrap_or(0.0)
    }

    fn books(&self) -> Vec<String> {
      let mut ids: Vec<String> = self.db.guard().list_books().expect("list").into_iter().map(|b| b.id).collect();
      ids.sort();
      ids
    }

    fn highlight(&self, id: &str) -> Option<Annotation> {
      self.db.guard().all_annotations().expect("annotations").into_iter().find(|a| a.id == id)
    }
  }

  fn book(id: &str, now: &str) -> BookRecord {
    BookRecord {
      finished_at: None,
      id: id.to_string(),
      title: format!("Book {id}"),
      author: Some("Someone".to_string()),
      genres: Vec::new(),
      cover_url: None,
      local_path: format!("/device/books/{id}.epub"),
      file_hash: id.to_string(),
      progress: 0.0,
      position: None,
      series: None,
      series_index: None,
      last_opened: None,
      created_at: now.to_string(),
      metadata_checked_at: None,
      metadata_updated_at: Some(now.to_string()),
      progress_updated_at: Some(now.to_string()),
      deleted_at: None,
      available: true
    }
  }

  fn highlight(id: &str, note: &str, at: &str) -> Annotation {
    Annotation {
      id: id.to_string(),
      book_id: "aaa".to_string(),
      kind: "highlight".to_string(),
      cfi: "epubcfi(/6/4!/4/2,/1:0,/1:12)".to_string(),
      text: Some("It was a dark".to_string()),
      note: Some(note.to_string()),
      color: Some("yellow".to_string()),
      chapter: Some("One".to_string()),
      created_at: "2026-10-01T09:00:00+00:00".to_string(),
      updated_at: at.to_string(),
      deleted_at: None
    }
  }

  /// The fault stage 0 fixes: twenty minutes on the laptop and twenty on the
  /// phone, neither synced, is forty on both, and a goal of thirty is met.
  #[tokio::test]
  async fn a_day_read_on_both_devices_is_the_sum() {
    let drive = FakeDrive::default();
    let (laptop, phone) = (Device::new(), Device::new());
    laptop.db.guard().credit_minutes("2026-10-14", 20.0, 30).expect("laptop reads");
    phone.db.guard().credit_minutes("2026-10-14", 20.0, 30).expect("phone reads");

    laptop.sync(&drive, "2026-10-14T20:00:00+00:00").await;
    phone.sync(&drive, "2026-10-14T20:01:00+00:00").await;
    laptop.sync(&drive, "2026-10-14T20:02:00+00:00").await;

    assert_eq!(laptop.minutes("2026-10-14"), 40.0);
    assert_eq!(phone.minutes("2026-10-14"), 40.0);
    assert!(phone.db.guard().reading_days().expect("days")["2026-10-14"].goal_met());

    // Syncing on and on, either device, never inflates it.
    for minute in 3..8 {
      phone.sync(&drive, &format!("2026-10-14T20:0{minute}:00+00:00")).await;
      laptop.sync(&drive, &format!("2026-10-14T20:0{minute}:30+00:00")).await;
    }
    assert_eq!(laptop.minutes("2026-10-14"), 40.0);
    assert_eq!(phone.minutes("2026-10-14"), 40.0);

    // And a sync with nothing new writes nothing.
    let writes = drive.writes();
    laptop.sync(&drive, "2026-10-14T21:00:00+00:00").await;
    assert_eq!(drive.writes(), writes);
  }

  /// A highlight's note changed on both: the later edit wins on both.
  #[tokio::test]
  async fn a_highlight_edited_on_both_keeps_the_later_edit() {
    let drive = FakeDrive::default();
    let (laptop, phone) = (Device::new(), Device::new());
    laptop.db.guard().upsert_book(&book("aaa", "2026-10-01T09:00:00+00:00")).expect("import");
    laptop.db.guard().put_annotation(&highlight("h1", "first", "2026-10-01T09:00:00+00:00")).expect("mark");
    laptop.sync(&drive, "2026-10-01T09:01:00+00:00").await;
    phone.sync(&drive, "2026-10-01T09:02:00+00:00").await;
    assert_eq!(phone.highlight("h1").and_then(|h| h.note).as_deref(), Some("first"));

    laptop.db.guard().put_annotation(&highlight("h1", "on the laptop", "2026-10-02T10:00:00+00:00")).expect("edit");
    phone.db.guard().put_annotation(&highlight("h1", "on the phone", "2026-10-02T10:05:00+00:00")).expect("edit");
    phone.sync(&drive, "2026-10-02T11:00:00+00:00").await;
    laptop.sync(&drive, "2026-10-02T11:01:00+00:00").await;
    phone.sync(&drive, "2026-10-02T11:02:00+00:00").await;

    assert_eq!(laptop.highlight("h1").and_then(|h| h.note).as_deref(), Some("on the phone"));
    assert_eq!(phone.highlight("h1").and_then(|h| h.note).as_deref(), Some("on the phone"));
  }

  /// A book removed on the phone leaves the laptop, and does not come back.
  #[tokio::test]
  async fn a_book_deleted_on_one_is_gone_from_both() {
    let drive = FakeDrive::default();
    let (laptop, phone) = (Device::new(), Device::new());
    laptop.db.guard().upsert_book(&book("aaa", "2026-10-01T09:00:00+00:00")).expect("import");
    laptop.db.guard().upsert_book(&book("bbb", "2026-10-01T09:00:00+00:00")).expect("import");
    laptop.sync(&drive, "2026-10-01T09:01:00+00:00").await;
    phone.sync(&drive, "2026-10-01T09:02:00+00:00").await;
    assert_eq!(phone.books(), vec!["aaa".to_string(), "bbb".to_string()]);

    phone.db.guard().delete_book("aaa", "2026-10-03T08:00:00+00:00").expect("delete");
    phone.sync(&drive, "2026-10-03T08:01:00+00:00").await;
    laptop.sync(&drive, "2026-10-03T08:02:00+00:00").await;
    laptop.sync(&drive, "2026-10-03T08:03:00+00:00").await;
    phone.sync(&drive, "2026-10-03T08:04:00+00:00").await;

    assert_eq!(laptop.books(), vec!["bbb".to_string()]);
    assert_eq!(phone.books(), vec!["bbb".to_string()]);
  }

  /// The phone reads for three days with no signal while the laptop goes on
  /// syncing; when it is back, nothing either did is lost.
  #[tokio::test]
  async fn a_device_offline_for_days_loses_nothing_when_it_is_back() {
    let drive = FakeDrive::default();
    let (laptop, phone) = (Device::new(), Device::new());
    laptop.db.guard().upsert_book(&book("aaa", "2026-10-01T09:00:00+00:00")).expect("import");
    laptop.sync(&drive, "2026-10-01T09:01:00+00:00").await;
    phone.sync(&drive, "2026-10-01T09:02:00+00:00").await;

    // Offline: the phone reads, finds a new book, and marks a line.
    for day in ["2026-10-02", "2026-10-03", "2026-10-04"] {
      phone.db.guard().credit_minutes(day, 15.0, 20).expect("phone reads");
    }
    phone.db.guard().upsert_book(&book("ccc", "2026-10-03T12:00:00+00:00")).expect("import");
    phone.db.guard().put_annotation(&highlight("h2", "on the train", "2026-10-03T12:30:00+00:00")).expect("mark");
    // Meanwhile the laptop reads on the same days and syncs each time.
    for (day, at) in [("2026-10-02", "2026-10-02T21:00:00+00:00"), ("2026-10-03", "2026-10-03T21:00:00+00:00")] {
      laptop.db.guard().credit_minutes(day, 10.0, 20).expect("laptop reads");
      laptop.sync(&drive, at).await;
    }

    phone.sync(&drive, "2026-10-05T08:00:00+00:00").await;
    laptop.sync(&drive, "2026-10-05T08:01:00+00:00").await;

    for device in [&laptop, &phone] {
      assert_eq!(device.minutes("2026-10-02"), 25.0);
      assert_eq!(device.minutes("2026-10-03"), 25.0);
      assert_eq!(device.minutes("2026-10-04"), 15.0);
      assert_eq!(device.books(), vec!["aaa".to_string(), "ccc".to_string()]);
      assert!(device.highlight("h2").is_some());
    }
  }

  /// A document from a later Leaflet is read from and never written: the old
  /// app says "update Leaflet on this device" instead of dropping fields.
  #[tokio::test]
  async fn an_older_version_never_overwrites_a_newer_document() {
    let drive = FakeDrive::default();
    let (newer, older) = (Device::new(), Device::new());
    newer.db.guard().upsert_book(&book("aaa", "2026-10-01T09:00:00+00:00")).expect("import");
    newer.sync(&drive, "2026-10-01T09:01:00+00:00").await;

    let mut doc: serde_json::Value = serde_json::from_slice(&drive.raw().expect("written")).expect("json");
    doc["version"] = (merge::DOC_VERSION + 1).into();
    doc["somethingNew"] = serde_json::json!({ "kept": true });
    let written = serde_json::to_vec_pretty(&doc).expect("json");
    drive.put_raw(written.clone());

    older.db.guard().upsert_book(&book("bbb", "2026-10-01T10:00:00+00:00")).expect("import");
    let report = older.sync(&drive, "2026-10-01T10:01:00+00:00").await;

    assert!(report.update_needed);
    assert_eq!(older.books(), vec!["aaa".to_string(), "bbb".to_string()], "what it understands arrives");
    assert_eq!(drive.raw().expect("still there"), written, "and the document is untouched");
  }

  /// The phone writes between the laptop's read and its write. The laptop's
  /// write names the copy it read, is refused, and the laptop merges again
  /// over the phone's: both devices' reading is in the end.
  #[tokio::test]
  async fn a_write_that_loses_a_race_is_retried_over_the_winner() {
    let drive = FakeDrive::default();
    let (laptop, phone) = (Device::new(), Device::new());
    laptop.db.guard().credit_minutes("2026-10-14", 10.0, 30).expect("laptop reads");
    laptop.sync(&drive, "2026-10-14T08:00:00+00:00").await;

    // The phone's sync, landing in the middle of the laptop's next one.
    phone.db.guard().credit_minutes("2026-10-14", 25.0, 30).expect("phone reads");
    let theirs = {
      let local = store::snapshot(&phone.db.guard(), "2026-10-14T09:00:00+00:00").expect("snapshot");
      merge::merge(&local, &drive.doc().expect("doc"), "2026-10-14T09:00:00+00:00")
    };
    drive.sneak_in(serde_json::to_vec(&theirs).expect("json"));

    laptop.db.guard().credit_minutes("2026-10-14", 5.0, 30).expect("laptop reads on");
    laptop.sync(&drive, "2026-10-14T09:00:01+00:00").await;
    assert_eq!(drive.conflicts(), 1, "the first write was refused");

    phone.sync(&drive, "2026-10-14T09:01:00+00:00").await;
    assert_eq!(laptop.minutes("2026-10-14"), 40.0, "fifteen on the laptop and twenty-five on the phone");
    assert_eq!(phone.minutes("2026-10-14"), 40.0);
  }

  /// The same race on a store that takes a write whatever copy it names (as
  /// Drive would if it ignored `If-Match`): the laptop, having read before
  /// the phone wrote, writes blind over the phone's work. The phone reads back
  /// after writing, finds its reading gone, and merges and writes again.
  /// (Had the blind write come after the phone's read-back, the phone's next
  /// sync would put it back the same way: each device keeps its own.)
  #[tokio::test]
  async fn a_write_lost_to_a_blind_overwrite_is_caught_by_reading_back() {
    let drive = FakeDrive::ignoring_revisions();
    let (laptop, phone) = (Device::new(), Device::new());
    laptop.db.guard().credit_minutes("2026-10-14", 10.0, 30).expect("laptop reads");
    laptop.sync(&drive, "2026-10-14T08:00:00+00:00").await;

    // The laptop reads on, and its next write is made over the copy it read.
    laptop.db.guard().credit_minutes("2026-10-14", 5.0, 30).expect("laptop reads on");
    let blind = {
      let local = store::snapshot(&laptop.db.guard(), "2026-10-14T09:00:00+00:00").expect("snapshot");
      merge::merge(&local, &drive.doc().expect("doc"), "2026-10-14T09:00:00+00:00")
    };
    drive.clobber_after(serde_json::to_vec(&blind).expect("json"));

    phone.db.guard().credit_minutes("2026-10-14", 25.0, 30).expect("phone reads");
    phone.sync(&drive, "2026-10-14T09:00:01+00:00").await;

    let day = drive.doc().expect("doc").days.into_iter().find(|d| d.date_key == "2026-10-14").expect("day");
    assert_eq!(day.minutes, 40.0, "the phone's twenty-five and the laptop's fifteen");
    assert_eq!(day.by_device.len(), 2);
    assert_eq!(drive.writes(), 3, "the laptop's first, the phone's lost one, the phone's again");
    laptop.sync(&drive, "2026-10-14T09:01:00+00:00").await;
    assert_eq!(laptop.minutes("2026-10-14"), 40.0);
  }

  /// Every device names itself once, and the name sticks.
  #[test]
  fn each_install_has_its_own_stable_id() {
    let (laptop, phone) = (memory_db(), memory_db());
    let id = laptop.device_id().expect("id");
    assert_eq!(laptop.device_id().expect("again"), id);
    assert_ne!(phone.device_id().expect("id"), id);
  }

  // ---- whose library the store holds ----------------------------------------

  const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  impl Device {
    async fn run(&self, drive: &FakeDrive, now: &str, who: &Who) -> StateRun {
      super::sync(&self.db, drive, now, who).await.expect("sync")
    }

    fn owner(&self) -> Option<String> {
      owner::get(&self.db.guard())
    }
  }

  /// Signed in, a store nobody has claimed is merged and stamped: in the
  /// document and in its marker, even when it had nothing new to take.
  #[tokio::test]
  async fn a_claim_stamps_the_document_and_its_marker() {
    let drive = FakeDrive::default();
    let old = Device::new();
    old.db.guard().upsert_book(&book("aaa", "2026-10-01T09:00:00+00:00")).expect("import");
    old.sync(&drive, "2026-10-01T09:01:00+00:00").await;
    assert_eq!(drive.doc().expect("doc").owner, None, "a signed-out device stamps nothing of its own");

    let laptop = Device::new();
    laptop.db.guard().upsert_book(&book("aaa", "2026-10-01T09:00:00+00:00")).expect("the same book");
    let run = laptop.run(&drive, "2026-10-02T09:00:00+00:00", &Who::signed_in(A)).await;
    assert!(!run.refused);
    assert_eq!(drive.doc().expect("doc").owner.as_deref(), Some(A));
    assert_eq!(drive.mark().as_deref(), Some(A));
    assert_eq!(laptop.owner().as_deref(), Some(A), "and the library is taken by the same stamp");

    // Again, with nothing new: nothing is written.
    let writes = drive.writes();
    laptop.run(&drive, "2026-10-02T10:00:00+00:00", &Who::signed_in(A)).await;
    assert_eq!(drive.writes(), writes);
  }

  /// A store that is another account's: signed in, nothing is taken from it
  /// or written to it (files only); signed out, it is refused.
  #[tokio::test]
  async fn another_accounts_store_is_neither_read_nor_written() {
    let drive = FakeDrive::default();
    let a = Device::new();
    a.db.guard().upsert_book(&book("aaa", "2026-10-01T09:00:00+00:00")).expect("import");
    a.run(&drive, "2026-10-01T09:01:00+00:00", &Who::signed_in(A)).await;
    let written = drive.raw().expect("doc");

    let b = Device::new();
    b.db.guard().upsert_book(&book("bbb", "2026-10-01T10:00:00+00:00")).expect("import");
    let run = b.run(&drive, "2026-10-01T10:01:00+00:00", &Who::signed_in(B)).await;
    assert!(run.refused);
    assert_eq!(b.books(), vec!["bbb".to_string()], "nothing of A's arrives");
    assert_eq!(drive.raw().expect("doc"), written, "and nothing of B's goes");

    // Signed out, a library of B's own is refused there too.
    owner::claim_if_unowned(&b.db.guard(), B).expect("claim");
    let run = b.run(&drive, "2026-10-01T10:02:00+00:00", &Who::signed_out()).await;
    assert!(run.refused);
    assert_eq!(drive.raw().expect("doc"), written);

    // A signed-out library nobody has claimed takes the store's owner with it.
    let fresh = Device::new();
    let run = fresh.run(&drive, "2026-10-01T10:03:00+00:00", &Who::signed_out()).await;
    assert!(!run.refused && run.brought_news);
    assert_eq!(fresh.owner().as_deref(), Some(A));
    assert_eq!(fresh.books(), vec!["aaa".to_string()]);
  }

  /// An older Leaflet drops the document's owner and Drive keeps the marker:
  /// the store is still A's to everyone, and A's next write puts it back.
  #[tokio::test]
  async fn an_older_app_that_drops_the_owner_leaves_the_marker_to_say_it() {
    let drive = FakeDrive::default();
    let a = Device::new();
    a.db.guard().upsert_book(&book("aaa", "2026-10-01T09:00:00+00:00")).expect("import");
    a.run(&drive, "2026-10-01T09:01:00+00:00", &Who::signed_in(A)).await;
    drive.strip_owner();
    assert_eq!(drive.doc().expect("doc").owner, None);
    assert_eq!(drive.mark().as_deref(), Some(A));

    let b = Device::new();
    assert!(b.run(&drive, "2026-10-01T10:00:00+00:00", &Who::signed_in(B)).await.refused);
    let signed_out_b = Device::new();
    owner::claim_if_unowned(&signed_out_b.db.guard(), B).expect("claim");
    assert!(signed_out_b.run(&drive, "2026-10-01T10:01:00+00:00", &Who::signed_out()).await.refused);

    // A signed-out library of nobody's inherits A from the marker alone.
    let phone = Device::new();
    phone.run(&drive, "2026-10-01T10:02:00+00:00", &Who::signed_out()).await;
    assert_eq!(phone.owner().as_deref(), Some(A));
    assert_eq!(drive.doc().expect("doc").owner.as_deref(), Some(A), "and wrote it back");

    drive.strip_owner();
    a.run(&drive, "2026-10-01T11:00:00+00:00", &Who::signed_in(A)).await;
    assert_eq!(drive.doc().expect("doc").owner.as_deref(), Some(A), "the owner's device restamps it");
  }

  /// Two devices signed in to two accounts claim one store at once. The one
  /// that writes second names the copy it read, is refused, reads again, and
  /// finds the store taken: it takes nothing of it, and writes nothing.
  #[tokio::test]
  async fn the_device_that_loses_a_race_to_claim_takes_nothing() {
    let drive = FakeDrive::default();
    let old = Device::new();
    old.db.guard().upsert_book(&book("old", "2026-10-01T08:00:00+00:00")).expect("import");
    old.sync(&drive, "2026-10-01T08:01:00+00:00").await;

    let (a, b) = (Device::new(), Device::new());
    a.db.guard().upsert_book(&book("aaa", "2026-10-01T09:00:00+00:00")).expect("import");
    b.db.guard().upsert_book(&book("bbb", "2026-10-01T09:00:00+00:00")).expect("import");
    // A's claim, landing between B's read and B's write.
    let claimed = {
      let local = store::snapshot(&a.db.guard(), "2026-10-01T09:01:00+00:00").expect("snapshot");
      let mut doc = merge::merge(&local, &drive.doc().expect("doc"), "2026-10-01T09:01:00+00:00");
      doc.owner = Some(A.to_string());
      doc
    };
    drive.sneak_in_marked(serde_json::to_vec(&claimed).expect("json"), A);

    let run = b.run(&drive, "2026-10-01T09:01:30+00:00", &Who::signed_in(B)).await;
    assert_eq!(drive.conflicts(), 1, "B's write named the copy it read");
    assert!(run.refused, "and B, reading again, found it taken");
    assert_eq!(b.books(), vec!["bbb".to_string()], "nothing of the store's reached B");
    assert_eq!(b.owner(), None);
    let doc = drive.doc().expect("doc");
    assert_eq!(doc.owner.as_deref(), Some(A));
    assert!(doc.books.iter().all(|entry| entry.id != "bbb"), "nothing of B's reached the store");
  }

  /// The bridge: a phone signed out and a laptop signed in, one owner, one
  /// Drive. The laptop keeps a copy of the state there and the phone reads
  /// and writes it as always.
  #[tokio::test]
  async fn the_bridge_keeps_a_signed_out_phone_in_step_with_a_signed_in_laptop() {
    let drive = FakeDrive::default();
    let (laptop, phone) = (Device::new(), Device::new());
    owner::claim_if_unowned(&phone.db.guard(), A).expect("the phone's library is A's");
    laptop.db.guard().credit_minutes("2026-10-14", 20.0, 30).expect("laptop reads");
    phone.db.guard().credit_minutes("2026-10-14", 15.0, 30).expect("phone reads");

    let first = laptop.run(&drive, "2026-10-14T20:00:00+00:00", &Who::signed_in(A)).await;
    assert!(!first.refused && !first.brought_news);
    let mid = phone.run(&drive, "2026-10-14T20:01:00+00:00", &Who::signed_out()).await;
    assert!(!mid.refused && mid.brought_news);
    let last = laptop.run(&drive, "2026-10-14T20:02:00+00:00", &Who::signed_in(A)).await;
    assert!(last.brought_news, "the phone's reading is news for the account");
    assert_eq!(laptop.minutes("2026-10-14"), 35.0);
    assert_eq!(phone.minutes("2026-10-14"), 35.0);
    assert_eq!(drive.doc().expect("doc").owner.as_deref(), Some(A));

    // Without the bridge, the laptop leaves the state there alone.
    let off = Who { signed_in: Some(A.to_string()), bridge: false };
    laptop.db.guard().credit_minutes("2026-10-14", 5.0, 30).expect("more");
    let writes = drive.writes();
    assert!(laptop.run(&drive, "2026-10-14T21:00:00+00:00", &off).await.refused);
    assert_eq!(drive.writes(), writes);
  }
}
