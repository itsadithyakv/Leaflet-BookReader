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

/// Challenges a reader to a duel for this (local) week.
#[tauri::command]
pub async fn community_challenge(handle: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let body = serde_json::json!({
    "handle": handle.trim().trim_start_matches('@').to_lowercase(),
    "weekKey": iso_week_key(&local_today())
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
