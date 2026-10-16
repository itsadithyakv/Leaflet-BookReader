//! Whose library this is: one library, one Leaflet account.
//!
//! A library is claimed once, by the first account that syncs it, and from
//! then on carries that account's tag. The tag is a hash of the account's id
//! (`tag_for`), so it names the owner without saying who they are, and it is
//! the same on every device and every server.
//!
//! Signed in, the account carries the reading state (`cloud`); Drive and the
//! sync folder carry the book files, and a copy of the state for devices of
//! the same owner that are signed out (the bridge). A Drive or folder holding
//! another account's library is used for files only. Signed out, Drive and the
//! folder carry everything as they always have, but never into a library that
//! belongs to someone else.
//!
//! Everything here is pure, or reads and writes a settings row: the decisions
//! are tables (`standing_of`, `store_mode`, `on_sign_in`) with tests.

use crate::db::Database;
use anyhow::Result;
use serde::Serialize;
use sha2::{Digest, Sha256};

/// The account this library belongs to (a tag), written once.
pub const OWNER_SETTING: &str = "library_owner";
/// "1" when the reader chose to keep this (another account's) library out of
/// reading sync and the board.
pub const STAY_OUT_SETTING: &str = "library_stay_out";
/// Which transports, signed out, hold another account's library: "drive",
/// "folder" or both, comma separated.
pub const REFUSED_SETTING: &str = "sync_refused";
/// "1" when, signed in, Drive (or the folder) holds another account's library
/// and so carries only this library's book files.
pub const DRIVE_FILES_ONLY_SETTING: &str = "drive_files_only";
pub const FOLDER_FILES_ONLY_SETTING: &str = "folder_files_only";
/// "1" for a library started fresh for an account: its first account sync
/// asks before taking in what the account already holds.
pub const FRESH_SETTING: &str = "library_fresh";

/// Whether, signed in, a Drive or folder holding this owner's library still
/// gets a copy of the state, for the owner's devices that are signed out.
pub const BRIDGE_STATE_JSON: bool = true;

pub const DRIVE_REFUSED: &str = "This Drive holds another Leaflet account's library.";
pub const FOLDER_REFUSED: &str = "This sync folder holds another Leaflet account's library.";
pub const OTHER_LIBRARY: &str = "This library belongs to another Leaflet account.";

/// The tag for an account: 32 hex digits of a hash of its id. The server's
/// address is left out, so a library keeps its owner across a move.
pub fn tag_for(account_id: &str) -> String {
  let digest = Sha256::digest(format!("leaflet.library-owner.v1\n{account_id}").as_bytes());
  digest.iter().take(16).map(|byte| format!("{byte:02x}")).collect()
}

/// Whether a value is a tag as `tag_for` makes them. Anything else read from
/// a document, a marker or a setting is no owner at all.
pub fn is_tag(value: &str) -> bool {
  value.len() == 32 && value.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// A tag read from somewhere outside this code, or nothing.
pub fn clean(value: Option<&str>) -> Option<String> {
  value.map(str::trim).filter(|value| is_tag(value)).map(str::to_string)
}

/// The library's owner, or nothing for one never claimed.
pub fn get(db: &Database) -> Option<String> {
  clean(db.get_setting(OWNER_SETTING).ok().flatten().as_deref())
}

/// Claims the library for `tag` if nobody has. Never changes an owner.
/// Whether the library is now `tag`'s.
pub fn claim_if_unowned(db: &Database, tag: &str) -> Result<bool> {
  if !is_tag(tag) {
    return Ok(false);
  }
  match get(db) {
    Some(owner) => Ok(owner == tag),
    None => {
      db.set_setting(OWNER_SETTING, tag)?;
      Ok(true)
    }
  }
}

/// Lets the library go if `tag` owns it (the account was deleted).
pub fn release_if(db: &Database, tag: &str) -> Result<bool> {
  if get(db).as_deref() != Some(tag) {
    return Ok(false);
  }
  db.set_setting(OWNER_SETTING, "")?;
  Ok(true)
}

/// The signed-in account's tag, when someone is signed in and this device
/// knows who.
pub fn signed_in_tag(db: &Database) -> Option<String> {
  if !crate::sync::cloud::signed_in(db) {
    return None;
  }
  crate::sync::cloud::signed_in_account_id(db).map(|id| tag_for(&id))
}

/// Where this library stands with whoever is signed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Standing {
  /// Signed out, and never claimed.
  Unowned,
  /// Signed in, and the library is not claimed yet: the first sync claims it.
  Adopting,
  /// The signed-in account's own.
  Mine,
  /// Claimed, and nobody is signed in.
  SignedOut,
  /// Signed in as one account, and the library is another's.
  Other
}

/// The table. Signed in with an account this device cannot name (no cached
/// account) and an owned library: `Other`, the safe answer, until it can.
pub fn standing_of(owner: Option<&str>, signed_in: bool, tag: Option<&str>) -> Standing {
  match (signed_in, owner) {
    (false, None) => Standing::Unowned,
    (false, Some(_)) => Standing::SignedOut,
    (true, None) => Standing::Adopting,
    (true, Some(owner)) if tag == Some(owner) => Standing::Mine,
    (true, Some(_)) => Standing::Other
  }
}

/// This library's standing now.
pub fn standing(db: &Database) -> Standing {
  let signed_in = crate::sync::cloud::signed_in(db);
  let tag = if signed_in { crate::sync::cloud::signed_in_account_id(db).map(|id| tag_for(&id)) } else { None };
  standing_of(get(db).as_deref(), signed_in, tag.as_deref())
}

/// Whether this library's figures, shelf and library may go on the board.
pub fn may_publish(standing: Standing) -> bool {
  standing == Standing::Mine
}

/// Whether seeds may be spent towards another reader (gifts, staked duels):
/// not from a library that is another account's.
pub fn may_spend_socially(standing: Standing) -> bool {
  standing != Standing::Other
}

/// Refuses a seed spend in another account's library.
pub fn check_spend(db: &Database) -> Result<(), String> {
  if may_spend_socially(standing(db)) {
    Ok(())
  } else {
    Err(OTHER_LIBRARY.to_string())
  }
}

/// What to do with the open library when an account signs in (for the
/// per-account libraries' `library_resolve`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OnSignIn {
  /// It is theirs already.
  Stay,
  /// They have a library of their own on this device: open it.
  Switch,
  /// Nobody's: it becomes theirs.
  Claim,
  /// Someone else's, and they have none here: offer a fresh one.
  Offer
}

/// The table, in that order: their own, then theirs elsewhere, then nobody's.
pub fn on_sign_in(active_owner: Option<&str>, tag: &str, library_exists_for_tag: bool) -> OnSignIn {
  if active_owner == Some(tag) {
    OnSignIn::Stay
  } else if library_exists_for_tag {
    OnSignIn::Switch
  } else if active_owner.is_none() {
    OnSignIn::Claim
  } else {
    OnSignIn::Offer
  }
}

/// Two documents' owners as one: an owner beats none, and of two different
/// ones (which only a race between two claims makes) the smaller, so every
/// device settles on the same. Commutative and idempotent, like the merge.
pub fn merge_owner(a: &Option<String>, b: &Option<String>) -> Option<String> {
  match (a, b) {
    (Some(a), Some(b)) => Some(std::cmp::min(a, b).clone()),
    (Some(one), None) | (None, Some(one)) => Some(one.clone()),
    (None, None) => None
  }
}

/// What a Drive or a sync folder is to this device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreMode {
  /// Signed in, and the store's state is nobody's: merge it and stamp it ours.
  Claim,
  /// Signed in, and the store is the account's own: keep a copy of the state
  /// there for its signed-out devices.
  Bridge,
  /// Signed in, and the state there is not to be touched: book files only.
  FilesOnly,
  /// Signed out: the state travels through the store, as it always has.
  Exchange,
  /// Signed out, and the store holds another account's library.
  Refuse
}

/// The table. `signed_in` is the signed-in account's tag; `local` the
/// library's owner; `remote` the store's (`doc.owner`, else its marker).
pub fn store_mode(signed_in: Option<&str>, local: Option<&str>, remote: Option<&str>, bridge: bool) -> StoreMode {
  match signed_in {
    Some(tag) => match remote {
      None => StoreMode::Claim,
      Some(remote) if remote == tag => {
        if bridge {
          StoreMode::Bridge
        } else {
          StoreMode::FilesOnly
        }
      }
      Some(_) => StoreMode::FilesOnly
    },
    None => match (local, remote) {
      (None, _) => StoreMode::Exchange,
      (Some(_), None) => StoreMode::Exchange,
      (Some(local), Some(remote)) if local == remote => StoreMode::Exchange,
      (Some(_), Some(_)) => StoreMode::Refuse
    }
  }
}

/// A transport that carries the state document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Transport {
  Drive,
  Folder
}

impl Transport {
  fn key(self) -> &'static str {
    match self {
      Transport::Drive => "drive",
      Transport::Folder => "folder"
    }
  }

  /// What a refusal says.
  pub fn refused_message(self) -> &'static str {
    match self {
      Transport::Drive => DRIVE_REFUSED,
      Transport::Folder => FOLDER_REFUSED
    }
  }

  pub fn files_only_setting(self) -> &'static str {
    match self {
      Transport::Drive => DRIVE_FILES_ONLY_SETTING,
      Transport::Folder => FOLDER_FILES_ONLY_SETTING
    }
  }
}

fn refused_set(db: &Database) -> Vec<String> {
  db.get_setting(REFUSED_SETTING)
    .ok()
    .flatten()
    .unwrap_or_default()
    .split(',')
    .map(str::trim)
    .filter(|part| *part == "drive" || *part == "folder")
    .map(str::to_string)
    .collect()
}

fn write_refused(db: &Database, mut set: Vec<String>) -> Result<()> {
  set.sort();
  set.dedup();
  db.set_setting(REFUSED_SETTING, &set.join(","))
}

/// Notes that, signed out, `transport` holds another account's library.
pub fn note_refusal(db: &Database, transport: Transport) -> Result<()> {
  let mut set = refused_set(db);
  set.push(transport.key().to_string());
  write_refused(db, set)
}

/// Forgets a refusal: the transport synced, or was disconnected or changed.
pub fn clear_refusal(db: &Database, transport: Transport) -> Result<()> {
  let set = refused_set(db).into_iter().filter(|part| part != transport.key()).collect();
  write_refused(db, set)
}

/// The transport that refused, for the UI: Drive first when both did.
pub fn refused(db: &Database) -> Option<Transport> {
  let set = refused_set(db);
  if set.iter().any(|part| part == "drive") {
    Some(Transport::Drive)
  } else if set.iter().any(|part| part == "folder") {
    Some(Transport::Folder)
  } else {
    None
  }
}

fn flag(db: &Database, key: &str) -> bool {
  db.get_setting(key).ok().flatten().as_deref() == Some("1")
}

fn set_flag(db: &Database, key: &str, on: bool) -> Result<()> {
  db.set_setting(key, if on { "1" } else { "" })
}

pub fn files_only(db: &Database, transport: Transport) -> bool {
  flag(db, transport.files_only_setting())
}

pub fn set_files_only(db: &Database, transport: Transport, on: bool) -> Result<()> {
  set_flag(db, transport.files_only_setting(), on)
}

/// Whether the account signed in chose to keep this library out of reading
/// sync (`stays_out_as`).
pub fn stays_out(db: &Database) -> bool {
  stays_out_as(db, signed_in_tag(db).as_deref())
}

/// Whether `tag` chose to keep this library out of reading sync. The choice
/// is that account's alone: a third account signing in is still asked.
pub fn stays_out_as(db: &Database, tag: Option<&str>) -> bool {
  let chosen = clean(db.get_setting(STAY_OUT_SETTING).ok().flatten().as_deref());
  chosen.is_some() && chosen.as_deref() == tag
}

/// Keeps this library out of reading sync for `tag`, or (`None`) for nobody.
/// Opening another library forgets the choice (`libraries::switch_in`): the
/// reader went to a library of their own.
pub fn set_stay_out(db: &Database, tag: Option<&str>) -> Result<()> {
  db.set_setting(STAY_OUT_SETTING, tag.filter(|tag| is_tag(tag)).unwrap_or(""))
}

pub fn is_fresh(db: &Database) -> bool {
  flag(db, FRESH_SETTING)
}

pub fn set_fresh(db: &Database, on: bool) -> Result<()> {
  set_flag(db, FRESH_SETTING, on)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;

  const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  #[test]
  fn staying_out_is_the_choosing_accounts_alone() {
    let db = memory_db();
    assert!(!stays_out_as(&db, Some(B)));
    set_stay_out(&db, Some(B)).expect("B stays out");
    assert!(stays_out_as(&db, Some(B)));
    assert!(!stays_out_as(&db, Some("cccccccccccccccccccccccccccccccc")), "a third account is still asked");
    assert!(!stays_out_as(&db, None), "nobody signed in");
    set_stay_out(&db, Some("not a tag")).expect("ignored");
    assert!(!stays_out_as(&db, Some(B)), "only a tag is kept");
    set_stay_out(&db, Some(B)).expect("again");
    set_stay_out(&db, None).expect("let back in");
    assert!(!stays_out_as(&db, Some(B)));
    db.set_setting(STAY_OUT_SETTING, "1").expect("an older flag");
    assert!(!stays_out_as(&db, Some(B)), "a bare flag names nobody");
  }

  #[test]
  fn a_tag_is_32_hex_digits_of_the_account_and_nothing_else() {
    let tag = tag_for("65f0c0ffee0000000000abcd");
    assert!(is_tag(&tag));
    assert_eq!(tag, tag_for("65f0c0ffee0000000000abcd"), "the same on every device");
    assert_ne!(tag, tag_for("65f0c0ffee0000000000abce"));
    assert!(!is_tag("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
    assert!(!is_tag(&tag[..31]));
    assert!(!is_tag("../../aaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    assert_eq!(clean(Some(&format!(" {tag}\n"))), Some(tag));
    assert_eq!(clean(Some("someone")), None);
  }

  #[test]
  fn a_library_is_claimed_once_and_let_go_only_by_its_owner() {
    let db = memory_db();
    assert_eq!(get(&db), None);
    assert!(claim_if_unowned(&db, A).expect("claim"));
    assert!(claim_if_unowned(&db, A).expect("again"), "idempotent");
    assert!(!claim_if_unowned(&db, B).expect("someone else"));
    assert_eq!(get(&db).as_deref(), Some(A));
    assert!(!release_if(&db, B).expect("not theirs"));
    assert_eq!(get(&db).as_deref(), Some(A));
    assert!(release_if(&db, A).expect("theirs"));
    assert_eq!(get(&db), None);
    assert!(!claim_if_unowned(&db, "not a tag").expect("junk"));
    assert_eq!(get(&db), None);
  }

  #[test]
  fn the_standing_table() {
    assert_eq!(standing_of(None, false, None), Standing::Unowned);
    assert_eq!(standing_of(Some(A), false, None), Standing::SignedOut);
    assert_eq!(standing_of(None, true, Some(A)), Standing::Adopting);
    assert_eq!(standing_of(None, true, None), Standing::Adopting);
    assert_eq!(standing_of(Some(A), true, Some(A)), Standing::Mine);
    assert_eq!(standing_of(Some(A), true, Some(B)), Standing::Other);
    assert_eq!(standing_of(Some(A), true, None), Standing::Other, "who is signed in is not known");
    assert!(may_publish(Standing::Mine));
    for standing in [Standing::Unowned, Standing::Adopting, Standing::SignedOut, Standing::Other] {
      assert!(!may_publish(standing));
    }
    assert!(!may_spend_socially(Standing::Other));
    assert!(may_spend_socially(Standing::Mine) && may_spend_socially(Standing::Adopting));
    assert_eq!(serde_json::to_string(&Standing::SignedOut).unwrap(), r#""signedOut""#);
  }

  #[test]
  fn a_memory_library_with_nobody_signed_in_may_spend() {
    let db = memory_db();
    assert!(check_spend(&db).is_ok());
    claim_if_unowned(&db, A).expect("claim");
    assert_eq!(standing(&db), Standing::SignedOut);
    assert!(check_spend(&db).is_ok());
  }

  #[test]
  fn the_sign_in_table_in_its_order() {
    assert_eq!(on_sign_in(Some(A), A, true), OnSignIn::Stay);
    assert_eq!(on_sign_in(Some(A), A, false), OnSignIn::Stay);
    assert_eq!(on_sign_in(Some(B), A, true), OnSignIn::Switch);
    assert_eq!(on_sign_in(None, A, true), OnSignIn::Switch);
    assert_eq!(on_sign_in(None, A, false), OnSignIn::Claim);
    assert_eq!(on_sign_in(Some(B), A, false), OnSignIn::Offer);
  }

  #[test]
  fn owners_merge_commutatively_and_idempotently() {
    let (a, b, none) = (Some(A.to_string()), Some(B.to_string()), None);
    for (x, y) in [(&a, &b), (&a, &none), (&none, &b), (&none, &none), (&a, &a)] {
      assert_eq!(merge_owner(x, y), merge_owner(y, x));
      let once = merge_owner(x, y);
      assert_eq!(merge_owner(&once, y), once);
    }
    assert_eq!(merge_owner(&a, &none), a);
    assert_eq!(merge_owner(&b, &a), a, "the smaller of two");
  }

  #[test]
  fn the_store_mode_table() {
    use StoreMode::*;
    for bridge in [true, false] {
      // Signed in as A: the local owner does not matter (Other never gets here).
      for local in [None, Some(A)] {
        assert_eq!(store_mode(Some(A), local, None, bridge), Claim);
        assert_eq!(store_mode(Some(A), local, Some(A), bridge), if bridge { Bridge } else { FilesOnly });
        assert_eq!(store_mode(Some(A), local, Some(B), bridge), FilesOnly);
      }
      // Signed out.
      assert_eq!(store_mode(None, None, None, bridge), Exchange);
      assert_eq!(store_mode(None, None, Some(B), bridge), Exchange, "inherits the store's owner");
      assert_eq!(store_mode(None, Some(A), None, bridge), Exchange);
      assert_eq!(store_mode(None, Some(A), Some(A), bridge), Exchange);
      assert_eq!(store_mode(None, Some(A), Some(B), bridge), Refuse);
    }
  }

  #[test]
  fn refusals_and_files_only_are_kept_per_transport() {
    let db = memory_db();
    assert_eq!(refused(&db), None);
    note_refusal(&db, Transport::Folder).expect("note");
    assert_eq!(refused(&db), Some(Transport::Folder));
    note_refusal(&db, Transport::Drive).expect("note");
    note_refusal(&db, Transport::Drive).expect("twice");
    assert_eq!(db.get_setting(REFUSED_SETTING).unwrap().as_deref(), Some("drive,folder"));
    assert_eq!(refused(&db), Some(Transport::Drive));
    clear_refusal(&db, Transport::Drive).expect("clear");
    assert_eq!(refused(&db), Some(Transport::Folder));
    clear_refusal(&db, Transport::Folder).expect("clear");
    assert_eq!(refused(&db), None);

    assert!(!files_only(&db, Transport::Drive));
    set_files_only(&db, Transport::Drive, true).expect("set");
    assert!(files_only(&db, Transport::Drive) && !files_only(&db, Transport::Folder));
    set_files_only(&db, Transport::Drive, false).expect("clear");
    assert!(!files_only(&db, Transport::Drive));
    assert_eq!(Transport::Drive.refused_message(), DRIVE_REFUSED);
  }
}
