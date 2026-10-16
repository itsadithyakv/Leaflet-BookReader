//! The community: the board, follows, kudos, duels, the inbox and search.

use super::*;

// ---- community -------------------------------------------------------------
//
// The interactive board: follows, kudos, weekly duels, the inbox and search.
// Each passes the server's JSON straight through (shapes live in
// `socialService.ts`). The week and day are the device's own, so a reader far
// from UTC competes in the week they are actually living in.


pub(crate) async fn community(
  state: &State<'_, AppState>,
  method: Method,
  path: String,
  query: Vec<(&str, String)>,
  body: Option<serde_json::Value>,
  auth: CommunityAuth
) -> Result<serde_json::Value, String> {
  let query: Vec<(&str, &str)> = query.iter().map(|(key, value)| (*key, value.as_str())).collect();
  cloud::community_call(&state.db, method, &path, &query, body, auth)
    .await
    .map_err(|e| e.to_string())
}

/// This week's board: `everyone` (public; marks you when signed in) or
/// `following` (you and the readers you follow).
#[tauri::command]
pub async fn community_leaderboard(
  scope: Option<String>,
  state: State<'_, AppState>
) -> Result<serde_json::Value, String> {
  let following = scope.as_deref() == Some("following");
  let week = iso_week_key(&local_today());
  let auth = if following { CommunityAuth::Required } else { CommunityAuth::Optional };
  let scope = if following { "following" } else { "everyone" };
  community(
    &state,
    Method::GET,
    "/v1/leaderboard".into(),
    vec![("week", week), ("scope", scope.to_string())],
    None,
    auth
  )
  .await
}

/// A reader's card: their public profile, plus how you two stand when signed in.
#[tauri::command]
pub async fn community_profile(handle: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let today = local_today();
  community(
    &state,
    Method::GET,
    format!("/v1/profile/{}", cloud::handle_segment(&handle)),
    vec![("week", iso_week_key(&today)), ("day", today)],
    None,
    CommunityAuth::Optional
  )
  .await
}

#[tauri::command]
pub async fn community_follow(
  handle: String,
  follow: bool,
  state: State<'_, AppState>
) -> Result<serde_json::Value, String> {
  let method = if follow { Method::POST } else { Method::DELETE };
  community(
    &state,
    method,
    format!("/v1/follows/{}", cloud::handle_segment(&handle)),
    vec![],
    None,
    CommunityAuth::Required
  )
  .await
}

#[tauri::command]
pub async fn community_kudos(handle: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let today = local_today();
  let body = serde_json::json!({ "dayKey": today, "weekKey": iso_week_key(&today) });
  community(
    &state,
    Method::POST,
    format!("/v1/kudos/{}", cloud::handle_segment(&handle)),
    vec![],
    Some(body),
    CommunityAuth::Required
  )
  .await
}

/// Challenges a reader to a duel for this (local) week. `stake` is the seeds
/// each side puts on it (0 for none); the server only carries the number, the
/// two apps settle it (`pip_stake_duel`, `pip_settle_duel`).
#[tauri::command]
pub async fn community_challenge(handle: String, stake: Option<i64>, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  // A stake is seeds, and they are this library's: not one of another account's.
  if stake.unwrap_or(0) > 0 {
    let db = state.db.guard();
    crate::sync::owner::check_spend(&db)?;
  }
  let body = serde_json::json!({
    "handle": handle.trim().trim_start_matches('@').to_lowercase(),
    "weekKey": iso_week_key(&local_today()),
    "stake": stake.unwrap_or(0).clamp(0, 50)
  });
  community(&state, Method::POST, "/v1/duels".into(), vec![], Some(body), CommunityAuth::Required).await
}

#[tauri::command]
pub async fn community_respond_duel(
  id: String,
  accept: bool,
  state: State<'_, AppState>
) -> Result<serde_json::Value, String> {
  if id.len() != 24 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
    return Err("No such duel.".to_string());
  }
  let action = if accept { "accept" } else { "decline" };
  community(
    &state,
    Method::POST,
    format!("/v1/duels/{id}/{action}"),
    vec![],
    None,
    CommunityAuth::Required
  )
  .await
}

#[tauri::command]
pub async fn community_duels(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  community(&state, Method::GET, "/v1/duels".into(), vec![], None, CommunityAuth::Required).await
}

/// New followers, kudos, duel news. `since` is an ISO time; omitted means all.
#[tauri::command]
pub async fn community_inbox(since: Option<String>, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let query = since
    .filter(|value| !value.is_empty())
    .map(|value| vec![("since", value)])
    .unwrap_or_default();
  community(&state, Method::GET, "/v1/inbox".into(), query, None, CommunityAuth::Required).await
}

/// The readers this reader follows who read today, for a friend's Pip to come
/// by in the Pip tab: at most a handful, each with what their public profile
/// already shows. `None` from a server that has no such route yet.
#[tauri::command]
pub async fn community_visitors(state: State<'_, AppState>) -> Result<Option<serde_json::Value>, String> {
  let today = local_today();
  let week = iso_week_key(&today);
  cloud::community_call_if_there(
    &state.db,
    Method::GET,
    "/v1/visitors",
    &[("day", today.as_str()), ("week", week.as_str())],
    CommunityAuth::Required
  )
  .await
  .map_err(|e| e.to_string())
}

/// Public readers whose handle starts with `query`.
#[tauri::command]
pub async fn community_search(query: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  community(
    &state,
    Method::GET,
    "/v1/search".into(),
    vec![("q", query.trim().to_string()), ("week", iso_week_key(&local_today()))],
    None,
    CommunityAuth::Optional
  )
  .await
}

/// Whether a newer Leaflet is out, as the owner has said on the server (the
/// admin panel): `{version, note, at}`, all null when nothing is said. Asked
/// for with or without an account: most readers have none.
#[tauri::command]
pub async fn update_notice(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  community(&state, Method::GET, "/v1/notice".into(), Vec::new(), None, CommunityAuth::Optional).await
}

// ---- raids -----------------------------------------------------------------
//
// One reader's Pip going at a friend's camp in the Hollow. The fight is the
// page's (it is played against the camp the friend's profile shows) and so
// is what a raid does to the camp raided; these only carry the news to the
// server and back. The two lists are empty, not an error, for a reader who
// is signed out and from a server that has no raids yet.

/// The most stars a raid wins.
pub(crate) const RAID_STARS: i64 = 3;
/// The most raids marked as seen at once: the server's limit.
pub(crate) const RAID_ACK_MAX: usize = 100;

/// What tells the server of a raid: whose camp (a handle as it is stored)
/// and the stars it won, never fewer than none or more than three.
pub(crate) fn raid_body(handle: &str, stars: i64) -> serde_json::Value {
  serde_json::json!({ "to": bare_handle(handle), "stars": stars.clamp(0, RAID_STARS) })
}

/// The raids to mark as seen: the ids that are ids as the server makes them
/// (24 hex digits), each once, in the order given, and no more than the
/// server takes at once. Anything else never reaches it.
pub(crate) fn raid_ids(ids: &[String]) -> Vec<String> {
  let mut seen = std::collections::HashSet::new();
  ids
    .iter()
    .map(|id| id.trim().to_ascii_lowercase())
    .filter(|id| id.len() == 24 && id.chars().all(|c| c.is_ascii_hexdigit()))
    .filter(|id| seen.insert(id.clone()))
    .take(RAID_ACK_MAX)
    .collect()
}

/// A list the server keeps under `key`, as it answered; an empty one where
/// there was no answer to be had.
pub(crate) fn list_or_none(answer: Option<serde_json::Value>, key: &str) -> serde_json::Value {
  answer.unwrap_or_else(|| serde_json::json!({ key: [] }))
}

/// Whether a save of the switch took: the server answers with the profile as
/// it now has it, and one from before raids says nothing of `raidable`. That
/// is an error, not a quiet yes: a reader who switched raids off must not be
/// left thinking they are off when nothing was kept.
pub(crate) fn raidable_saved(saved: &serde_json::Value, on: bool) -> Result<(), String> {
  match saved.get("raidable").and_then(|value| value.as_bool()) {
    Some(kept) if kept == on => Ok(()),
    Some(_) => Err("That didn't save. Try again.".to_string()),
    None => Err("This Leaflet server has no raids yet.".to_string())
  }
}

fn signed_in(state: &State<'_, AppState>) -> bool {
  let db = state.db.guard();
  cloud::signed_in(&db)
}

async fn raid_list(state: &State<'_, AppState>, path: &str, key: &str) -> Result<serde_json::Value, String> {
  if !signed_in(state) {
    return Ok(list_or_none(None, key));
  }
  let answer = cloud::community_call_if_there(&state.db, Method::GET, path, &[], CommunityAuth::Required)
    .await
    .map_err(|e| e.to_string())?;
  Ok(list_or_none(answer, key))
}

/// Whose camp could be raided: the friends (each follows the other) who show
/// a camp and have not switched raids off, each with that camp and whether
/// it has been raided today.
#[tauri::command]
pub async fn community_raid_targets(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  raid_list(&state, "/v1/raids/targets", "targets").await
}

/// Tells the server a friend's camp was raided, and how it went. Once a day
/// for each friend; the server's refusal says so.
#[tauri::command]
pub async fn community_raid(handle: String, stars: i64, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  community(&state, Method::POST, "/v1/raids".into(), vec![], Some(raid_body(&handle, stars)), CommunityAuth::Required).await
}

/// The raids on this reader's camp that have not been seen here yet, oldest first.
#[tauri::command]
pub async fn community_raids(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  raid_list(&state, "/v1/raids", "raids").await
}

/// Marks raids as seen, so the server stops handing them over.
#[tauri::command]
pub async fn community_raids_ack(ids: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
  let ids = raid_ids(&ids);
  if ids.is_empty() || !signed_in(&state) {
    return Ok(());
  }
  let body = serde_json::json!({ "ids": ids });
  community(&state, Method::POST, "/v1/raids/ack".into(), vec![], Some(body), CommunityAuth::Required).await?;
  Ok(())
}

/// Whether friends may raid this reader's camp: yes until they say no, and
/// yes for a reader who is signed out (nobody can raid them anyway).
#[tauri::command]
pub async fn community_raidable(state: State<'_, AppState>) -> Result<bool, String> {
  if !signed_in(&state) {
    return Ok(true);
  }
  let profile = cloud::get_profile(&state.db).await.map_err(|e| e.to_string())?;
  Ok(profile.raidable)
}

/// Switches raids on this reader's camp on or off.
#[tauri::command]
pub async fn community_set_raidable(on: bool, state: State<'_, AppState>) -> Result<(), String> {
  let update = cloud::ProfileUpdate { raidable: Some(on), ..cloud::ProfileUpdate::default() };
  let saved = cloud::put_profile(&state.db, &update).await.map_err(|e| e.to_string())?;
  raidable_saved(&saved, on)
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A raid is sent as whose camp and how many stars, and nothing else: no
  /// camp, no layout, nothing about anybody's reading.
  #[test]
  fn a_raid_is_sent_as_a_handle_and_its_stars() {
    assert_eq!(raid_body("  @Maya_Reads ", 2).to_string(), r#"{"stars":2,"to":"maya_reads"}"#);
    assert_eq!(raid_body("adi", 0)["stars"], 0);
    assert_eq!(raid_body("adi", 3)["stars"], 3);
    // Stars outside what a raid can win are brought to the nearest it can.
    assert_eq!(raid_body("adi", -4)["stars"], 0);
    assert_eq!(raid_body("adi", 99)["stars"], 3);
    assert_eq!(raid_body("adi", 1).as_object().expect("an object").len(), 2);
  }

  /// Only ids as the server makes them are sent back to it, each once.
  #[test]
  fn the_raids_marked_seen_are_ids_and_nothing_else() {
    let ids = |list: &[&str]| raid_ids(&list.iter().map(|id| id.to_string()).collect::<Vec<_>>());
    let first = "0123456789abcdef01234567";
    let second = "aaaaaaaaaaaaaaaaaaaaaaaa";
    assert_eq!(ids(&[first, second]), vec![first, second]);
    // Upper case is the same id, and the same id twice is one.
    assert_eq!(ids(&["0123456789ABCDEF01234567", first, " aaaaaaaaaaaaaaaaaaaaaaaa "]), vec![first, second]);
    assert!(ids(&["", "0123", "../../v1/account", "zzzzzzzzzzzzzzzzzzzzzzzz", "0123456789abcdef012345678"]).is_empty());
    assert!(ids(&[]).is_empty());
    // No more than the server takes at once.
    let many: Vec<String> = (0..150).map(|index| format!("{index:024x}")).collect();
    let kept = raid_ids(&many);
    assert_eq!(kept.len(), RAID_ACK_MAX);
    assert_eq!(kept[0], many[0]);
    assert_eq!(serde_json::json!({ "ids": ids(&[first]) }).to_string(), r#"{"ids":["0123456789abcdef01234567"]}"#);
  }

  /// The server's lists come through as they are, and no answer is an empty
  /// list under the same name, so the page reads both the same way.
  #[test]
  fn a_list_with_no_answer_is_an_empty_one() {
    let targets = serde_json::json!({ "targets": [{ "handle": "maya", "name": "Maya", "camp": { "camps": 3 }, "raidedToday": true }] });
    assert_eq!(list_or_none(Some(targets.clone()), "targets"), targets);
    assert_eq!(list_or_none(None, "targets").to_string(), r#"{"targets":[]}"#);
    assert_eq!(list_or_none(None, "raids").to_string(), r#"{"raids":[]}"#);
    let raids = serde_json::json!({ "raids": [{ "id": "0123456789abcdef01234567", "by": "adi", "name": "Adi", "stars": 2, "at": "2026-10-12T09:00:00.000Z" }] });
    assert_eq!(list_or_none(Some(raids.clone()), "raids")["raids"][0]["stars"], 2);
  }

  /// The switch is sent alone, read as on from a server that does not say,
  /// and a save that such a server ignored is not passed off as saved.
  #[test]
  fn the_raid_switch_is_sent_alone_and_is_on_unless_the_server_says_off() {
    let off = cloud::ProfileUpdate { raidable: Some(false), ..cloud::ProfileUpdate::default() };
    assert_eq!(serde_json::to_string(&off).expect("json"), r#"{"raidable":false}"#);
    let untouched = cloud::ProfileUpdate { streak: Some(4), ..cloud::ProfileUpdate::default() };
    assert!(!serde_json::to_string(&untouched).expect("json").contains("raidable"));

    let read = |json: &str| serde_json::from_str::<cloud::Profile>(json).expect("a profile").raidable;
    assert!(read(r#"{"handle":"adi","visibility":"public"}"#), "a server from before raids");
    assert!(read(r#"{"handle":"adi","raidable":true}"#));
    assert!(!read(r#"{"handle":"adi","raidable":false}"#));

    assert_eq!(raidable_saved(&serde_json::json!({ "handle": "adi", "raidable": false }), false), Ok(()));
    assert_eq!(raidable_saved(&serde_json::json!({ "raidable": true }), true), Ok(()));
    assert!(raidable_saved(&serde_json::json!({ "raidable": true }), false).is_err());
    assert!(raidable_saved(&serde_json::json!({ "handle": "adi" }), false).is_err(), "nothing was kept");
    assert!(raidable_saved(&serde_json::Value::Null, true).is_err());
  }
}
