//! The reader's own fonts: listing them, adding one, handing one to the page,
//! removing one. What a font is and where it is kept is in `crate::fonts`.

use crate::fonts::{self, Font};

#[tauri::command]
pub fn fonts_list() -> Vec<Font> {
  fonts::list()
}

/// Async and off-thread, like a cover: reading and hashing a font of several
/// megabytes on the main thread would stall the window.
#[tauri::command]
pub async fn font_add(path: String) -> Result<Font, String> {
  tauri::async_runtime::spawn_blocking(move || fonts::add(std::path::Path::new(&path)).map_err(|e| e.to_string()))
    .await
    .map_err(|e| format!("Font task failed: {e}"))?
}

/// The font as a data URL; `None` for one that is not there.
#[tauri::command]
pub async fn font_data(id: String) -> Result<Option<String>, String> {
  tauri::async_runtime::spawn_blocking(move || fonts::data(&id).map_err(|e| e.to_string()))
    .await
    .map_err(|e| format!("Font task failed: {e}"))?
}

#[tauri::command]
pub fn font_remove(id: String) -> Result<(), String> {
  fonts::remove(&id).map_err(|e| e.to_string())
}
