//! The optional book converter for formats Leaflet cannot open itself.

use super::*;

/// Whether opening this book is blocked on installing the converter.
///
/// False for native formats, and false when a conversion is already cached —
/// the app used to demand a ~200 MB download to reopen a book it had already
/// converted, purely because the Calibre install had moved.
#[tauri::command]
pub fn needs_converter(
  book_id: String,
  state: State<'_, AppState>,
  app: AppHandle
) -> Result<bool, String> {
  let book = {
    let db = state.db.guard();
    db.find_by_id(&book_id)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "Book not found".to_string())?
  };

  let source = std::path::PathBuf::from(&book.local_path);
  let Some(format) = formats::lookup(&formats::extension_of(&source)) else {
    return Ok(false);
  };
  if !format.delivery.needs_external_converter() {
    return Ok(false);
  }

  let already_converted = storage::converted_epub_path(&book.file_hash)
    .map(|path| path.exists())
    .unwrap_or(false);
  if already_converted {
    return Ok(false);
  }
  // A Kindle book locked to an account cannot be converted by Calibre either.
  // Opening it says so (`ensure_epub_version`); asking the reader to install
  // Calibre first would be 200 MB for nothing.
  if storage::mobi::info(&source).is_ok_and(|info| info.encrypted) {
    return Ok(false);
  }
  // A Kindle book of the older kind is read by Leaflet itself.
  if storage::reads_kindle_itself(&source) {
    return Ok(false);
  }

  Ok(!storage::converter_installed(&app))
}

/// Lets the frontend build its file dialog and copy from the same table the
/// backend enforces.
#[tauri::command]
pub fn supported_formats() -> Vec<formats::Format> {
  formats::FORMATS.to_vec()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConverterInfo {
  pub installed: bool,
  /// Set when an existing Calibre was discovered, so the UI can say where.
  pub path: Option<String>,
  /// False on platforms where Leaflet cannot fetch Calibre for the user.
  pub can_auto_install: bool
}

/// Async, so the search runs off the window's thread. It looks in every
/// folder on PATH and the usual install places, Settings asks again each time
/// the window comes back, and one PATH entry on a drive that does not answer
/// would hold the window still each time.
#[tauri::command]
pub async fn converter_status(app: AppHandle) -> Result<ConverterInfo, String> {
  let path = tauri::async_runtime::spawn_blocking(move || storage::converter_path(&app))
    .await
    .map_err(|error| format!("Couldn't look for the converter: {error}"))?;
  Ok(ConverterInfo {
    installed: path.is_some(),
    path: path.map(|value| value.to_string_lossy().to_string()),
    can_auto_install: storage::can_auto_install_converter()
  })
}

/// Fetches Calibre. Desktop only: there is no Android build of it, and the
/// whole download-and-unpack path is compiled out of the mobile binary.
#[tauri::command]
pub async fn install_converter(app: AppHandle) -> Result<bool, String> {
  #[cfg(desktop)]
  {
    storage::install_converter(&app)
      .await
      .map(|_| true)
      .map_err(|e| e.to_string())
  }
  #[cfg(not(desktop))]
  {
    let _ = app;
    Err("The book converter is only available on desktop.".to_string())
  }
}
