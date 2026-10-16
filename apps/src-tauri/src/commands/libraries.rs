//! Per-account libraries: what a sign-in means for the open library, and
//! opening the signed-in account's own (`crate::libraries`). The app reloads
//! its window after a switch (`store/libraryOwnerStore.ts`).

use super::*;
use crate::libraries;
use crate::sync::owner::{self, OnSignIn, Standing};

/// What `library_resolve` did, or asks the app to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResolveAction {
  /// Nothing: the library is the account's, or the reader keeps it out of sync.
  Stay,
  /// It was nobody's, and is the account's now.
  Claimed,
  /// The account has a library of its own on this device: open it.
  Switch,
  /// It is another account's, and this one has none here: ask.
  Offer
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
  pub action: ResolveAction
}

const SIGN_IN_FIRST: &str = "Sign in to your Leaflet account first.";

/// The table's answer as the app hears it. A reader who chose to keep this
/// library out of reading sync is not moved, nor asked again.
pub(crate) fn resolve_action(on: OnSignIn, stays_out: bool) -> ResolveAction {
  match on {
    OnSignIn::Stay => ResolveAction::Stay,
    OnSignIn::Claim => ResolveAction::Claimed,
    OnSignIn::Switch | OnSignIn::Offer if stays_out => ResolveAction::Stay,
    OnSignIn::Switch => ResolveAction::Switch,
    OnSignIn::Offer => ResolveAction::Offer
  }
}

/// The signed-in account's tag. A device that has not heard who is signed in
/// asks the server once.
async fn signed_in_tag(state: &State<'_, AppState>) -> Option<String> {
  let (signed_in, tag) = {
    let db = state.db.guard();
    (cloud::signed_in(&db), owner::signed_in_tag(&db))
  };
  if !signed_in || tag.is_some() {
    return tag;
  }
  let _ = cloud::status(&state.db, true).await;
  let db = state.db.guard();
  owner::signed_in_tag(&db)
}

/// What a sign-in means for the open library (`owner::on_sign_in`). A library
/// nobody owns is claimed here and now.
#[tauri::command]
pub async fn library_resolve(state: State<'_, AppState>) -> Result<Resolved, String> {
  let Some(tag) = signed_in_tag(&state).await else {
    return Ok(Resolved { action: ResolveAction::Stay });
  };
  let db = state.db.guard();
  let has_own = libraries::elsewhere(&db, &tag).is_some();
  let on = owner::on_sign_in(owner::get(&db).as_deref(), &tag, has_own);
  let action = resolve_action(on, owner::stays_out_as(&db, Some(&tag)));
  if action == ResolveAction::Claimed {
    owner::claim_if_unowned(&db, &tag).map_err(|e| e.to_string())?;
  }
  Ok(Resolved { action })
}

/// Opens the signed-in account's own library on this device.
#[tauri::command]
pub async fn library_open_mine(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
  let tag = signed_in_tag(&state).await.ok_or_else(|| SIGN_IN_FIRST.to_string())?;
  let dir = libraries::find_for(&tag).ok_or_else(|| "Your account has no library on this device yet.".to_string())?;
  libraries::switch(&state, &app, &dir, None).await
}

/// A new, empty library for the signed-in account, when the open one is
/// another account's. If it has one here already, that one opens instead.
#[tauri::command]
pub async fn library_start_fresh(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
  let tag = signed_in_tag(&state).await.ok_or_else(|| SIGN_IN_FIRST.to_string())?;
  let standing = {
    let db = state.db.guard();
    owner::standing(&db)
  };
  if standing != Standing::Other {
    return Err("This library is already yours.".to_string());
  }
  if let Some(dir) = libraries::find_for(&tag) {
    return libraries::switch(&state, &app, &dir, None).await;
  }
  let dir = libraries::dir_for(&tag).map_err(|e| e.to_string())?;
  fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make a library for you: {e}"))?;
  libraries::switch(&state, &app, &dir, Some(&tag)).await
}

/// Keeps this library (another account's) out of reading sync and the board,
/// or lets it back in.
#[tauri::command]
pub async fn library_stay_out(on: bool, state: State<'_, AppState>) -> Result<(), String> {
  let tag = if on {
    Some(signed_in_tag(&state).await.ok_or_else(|| SIGN_IN_FIRST.to_string())?)
  } else {
    None
  };
  let db = state.db.guard();
  owner::set_stay_out(&db, tag.as_deref()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_sign_in_is_answered_from_the_table_and_the_readers_choice() {
    assert_eq!(resolve_action(OnSignIn::Stay, false), ResolveAction::Stay);
    assert_eq!(resolve_action(OnSignIn::Claim, false), ResolveAction::Claimed);
    assert_eq!(resolve_action(OnSignIn::Claim, true), ResolveAction::Claimed, "staying out is for another's library");
    assert_eq!(resolve_action(OnSignIn::Switch, false), ResolveAction::Switch);
    assert_eq!(resolve_action(OnSignIn::Offer, false), ResolveAction::Offer);
    assert_eq!(resolve_action(OnSignIn::Switch, true), ResolveAction::Stay);
    assert_eq!(resolve_action(OnSignIn::Offer, true), ResolveAction::Stay);
    let json = serde_json::to_value(Resolved { action: ResolveAction::Claimed }).expect("json");
    assert_eq!(json, serde_json::json!({ "action": "claimed" }));
  }
}
