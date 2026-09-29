use super::*;
use crate::sync::reading::{self, ReadingProfile};

/// How fast this reader reads, as learned on every device (see `sync::reading`).
/// `None` until the reader has read anything here or a sync brought one in.
#[tauri::command]
pub fn reading_profile_get(state: State<'_, AppState>) -> Result<Option<ReadingProfile>, String> {
  let db = state.db.guard();
  reading::load(&db).map_err(|e| e.to_string())
}

/// Folds the reader's latest copy into the stored one and returns the result,
/// which may carry something newer that a sync brought in meanwhile.
#[tauri::command]
pub fn reading_profile_set(profile: ReadingProfile, state: State<'_, AppState>) -> Result<ReadingProfile, String> {
  let db = state.db.guard();
  reading::absorb(&db, &profile).map_err(|e| e.to_string())
}
