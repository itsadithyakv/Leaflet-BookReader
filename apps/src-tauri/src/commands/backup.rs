//! Backup: its status, Google Drive sign-in, the sync folder, and running a backup.

use super::*;

/// Everything the UI needs to describe sync truthfully, including the cases the
/// old panel could not express: a build with no Google credentials, and a folder
/// transport that needs no account at all.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
  /// Drive is connected and has a usable refresh token.
  pub drive_connected: bool,
  /// Leaflet can talk to Google at all.
  pub drive_available: bool,
  /// Whether the OAuth client is shipped, entered by the reader, or absent — so
  /// the UI can offer to fix the absent case rather than only reporting it.
  pub drive_credential_source: drive::CredentialSource,
  pub expires_at: Option<String>,
  /// The real Google account, not the placeholder the app used to invent.
  pub account_email: Option<String>,
  /// The chosen sync folder, when folder sync is in use.
  pub folder_path: Option<String>,
  /// The Leaflet API, when cloud sync and the social features are in use.
  pub api_base: Option<String>,
  /// The address was typed in on this device (Settings, Advanced) rather than
  /// being Leaflet's own, which arrives by itself from the signed config.
  pub api_base_custom: bool,
  pub last_synced_at: Option<String>,
  /// Books in the library whose file is not on this device yet.
  pub books_pending: usize
}

pub const FOLDER_SETTING: &str = "sync_folder_path";
pub const LAST_SYNCED_SETTING: &str = "sync_last_synced_at";

pub(crate) fn read_sync_status(db: &db::Database) -> Result<SyncStatus, String> {
  let refresh = drive::load_refresh_token(db).map_err(|e| e.to_string())?;
  let pending = db
    .list_books()
    .map_err(|e| e.to_string())?
    .iter()
    .filter(|book| !crate::sync::store::is_available(&book.local_path))
    .count();
  Ok(SyncStatus {
    drive_connected: refresh.is_some(),
    drive_available: drive::credentials_present(db),
    drive_credential_source: drive::credential_source(db),
    expires_at: db
      .get_setting(drive::EXPIRES_SETTING)
      .map_err(|e| e.to_string())?
      .filter(|value| !value.is_empty()),
    account_email: db
      .get_setting(drive::ACCOUNT_SETTING)
      .map_err(|e| e.to_string())?
      .filter(|value| !value.is_empty()),
    folder_path: db
      .get_setting(FOLDER_SETTING)
      .map_err(|e| e.to_string())?
      .filter(|value| !value.is_empty()),
    api_base: crate::sync::cloud::api_base(db),
    api_base_custom: crate::sync::cloud::api_base_is_custom(db),
    last_synced_at: db
      .get_setting(LAST_SYNCED_SETTING)
      .map_err(|e| e.to_string())?
      .filter(|value| !value.is_empty()),
    books_pending: pending
  })
}

#[tauri::command]
pub fn sync_status(state: State<'_, AppState>) -> Result<SyncStatus, String> {
  let db = state.db.guard();
  read_sync_status(&db)
}

#[tauri::command]
pub fn reading_stats(state: State<'_, AppState>) -> Result<db::ReadingStats, String> {
  let db = state.db.guard();
  db.reading_stats().map_err(|e| e.to_string())
}

/// Opens the consent page in the *system* browser and returns the URL used.
///
/// The frontend used to call `window.open`, which at best lands in an embedded
/// webview — and Google refuses to run its sign-in there. Opening from the
/// backend is the only reliable path.
#[tauri::command]
pub fn drive_auth_start(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
  let credentials = {
    let db = state.db.guard();
    drive::load_credentials(&db).ok_or_else(|| {
      "Drive sync needs a Google OAuth client. Add one in Settings, or use folder sync, \
       which needs nothing at all."
        .to_string()
    })?
  };
  let url = {
    let mut drive_state = state.drive.guard();
    drive::auth_start(&mut drive_state, &credentials)
      .map_err(|e| e.to_string())?
      .url
  };
  tauri_plugin_opener::OpenerExt::opener(&app)
    .open_url(&url, None::<&str>)
    .map_err(|error| format!("Could not open your browser: {error}"))?;
  Ok(url)
}

#[tauri::command]
pub async fn drive_auth_wait(state: State<'_, AppState>) -> Result<(), String> {
  let pending = {
    let mut drive_state = state.drive.guard();
    drive_state
      .take_pending()
      .ok_or_else(|| "Connect Drive was not started.".to_string())?
  };
  let credentials = {
    let db = state.db.guard();
    drive::load_credentials(&db)
      .ok_or_else(|| "Drive credentials were removed mid-connection.".to_string())?
  };
  let tokens = drive::auth_wait(pending, &credentials)
    .await
    .map_err(|e| e.to_string())?;
  let db = state.db.guard();
  db.set_setting(drive::ACCESS_SETTING, &tokens.access_token)
    .map_err(|e| e.to_string())?;
  db.set_setting(drive::EXPIRES_SETTING, &tokens.expires_at)
    .map_err(|e| e.to_string())?;
  // Goes to the OS keychain when one is available, not a plaintext column.
  drive::store_refresh_token(&db, &tokens.refresh_token).map_err(|e| e.to_string())?;
  Ok(())
}

/// Sets the Google OAuth client Leaflet presents.
///
/// Without this, Drive sync only works in a build that shipped credentials —
/// which left readers of every other build with a button that could only fail.
/// Anyone can create a free "Desktop app" client and paste it here.
#[tauri::command]
pub fn set_drive_credentials(
  client_id: String,
  client_secret: String,
  state: State<'_, AppState>
) -> Result<SyncStatus, String> {
  let trimmed_id = drive::validate_client_id(&client_id).map_err(|e| e.to_string())?;

  let db = state.db.guard();
  drive::set_credentials(&db, &trimmed_id, client_secret.trim()).map_err(|e| e.to_string())?;
  // A different OAuth client cannot use tokens issued to the previous one.
  drive::clear_tokens(&db).map_err(|e| e.to_string())?;
  read_sync_status(&db)
}

#[tauri::command]
pub fn clear_drive_credentials(state: State<'_, AppState>) -> Result<SyncStatus, String> {
  let db = state.db.guard();
  drive::clear_credentials(&db).map_err(|e| e.to_string())?;
  drive::clear_tokens(&db).map_err(|e| e.to_string())?;
  db.set_setting(drive::ACCOUNT_SETTING, "").map_err(|e| e.to_string())?;
  read_sync_status(&db)
}

#[tauri::command]
pub fn drive_disconnect(state: State<'_, AppState>) -> Result<SyncStatus, String> {
  let db = state.db.guard();
  drive::clear_tokens(&db).map_err(|e| e.to_string())?;
  db.set_setting(drive::ACCOUNT_SETTING, "").map_err(|e| e.to_string())?;
  read_sync_status(&db)
}

/// Chooses the folder that carries sync, for readers whose own cloud client
/// already keeps a directory in step across their devices.
#[tauri::command]
pub fn set_sync_folder(path: Option<String>, state: State<'_, AppState>) -> Result<SyncStatus, String> {
  let db = state.db.guard();
  let value = path.unwrap_or_default();
  if !value.is_empty() && !std::path::Path::new(&value).is_dir() {
    return Err("That folder does not exist.".to_string());
  }
  db.set_setting(FOLDER_SETTING, &value).map_err(|e| e.to_string())?;
  read_sync_status(&db)
}

/// Runs whichever transports are configured.
///
/// Both may be: a folder covers this machine's other desktops, Drive covers a
/// phone. They share the merge rules, so running both simply converges twice.
#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> Result<crate::sync::folder::SyncReport, String> {
  let result = run_sync(&state).await;
  if let Err(error) = &result {
    crate::diag::warn(&format!("backup failed: {error}"));
  }
  result
}

pub(crate) async fn run_sync(state: &State<'_, AppState>) -> Result<crate::sync::folder::SyncReport, String> {
  // One run at a time. Connecting Drive fires a sync from the auth flow and
  // another from the status change; run together, both found no `state.json`
  // and both created one, leaving devices to drift across two copies. A caller
  // that arrives mid-run waits and then converges against what the first wrote.
  let _running = state.sync_lock.lock().await;
  let now = db::now_iso();
  let (folder_path, drive_connected, cloud_signed_in) = {
    let db = state.db.guard();
    (
      db.get_setting(FOLDER_SETTING)
        .map_err(|e| e.to_string())?
        .filter(|value| !value.is_empty()),
      drive::load_refresh_token(&db)
        .map_err(|e| e.to_string())?
        .is_some(),
      crate::sync::cloud::signed_in(&db)
    )
  };

  if folder_path.is_none() && !drive_connected {
    return Err("Sync is not set up yet. Connect Drive or choose a sync folder.".to_string());
  }

  let mut report = crate::sync::folder::SyncReport::default();

  if let Some(path) = folder_path {
    let db = state.db.guard();
    let folder_report = crate::sync::folder::sync(&db, std::path::Path::new(&path), &now)
      .map_err(|e| e.to_string())?;
    report.merge_in(folder_report);
  }

  if drive_connected {
    let drive_report = drive::sync(&state.db, &now).await.map_err(|e| e.to_string())?;
    report.merge_in(drive_report);
  }

  // Runs last, for readers signed in to a Leaflet account. It carries no book
  // files, so it rides along with a folder or Drive rather than standing alone.
  // By this point the local state already holds everything the other
  // transports brought, so one round trip publishes the lot.
  if cloud_signed_in {
    let cloud_report = crate::sync::cloud::sync(&state.db, &now)
      .await
      .map_err(|e| e.to_string())?;
    report.merge_in(cloud_report);
    let _ = publish_profile(&state).await;
  }

  {
    let db = state.db.guard();
    db.set_setting(LAST_SYNCED_SETTING, &now).map_err(|e| e.to_string())?;
  }
  Ok(report)
}

/// Fetches a book this device has an entry for but no file.
///
/// Book files are not pulled during sync: the shared document is kilobytes and
/// syncs instantly, while a library is gigabytes. Connecting a new device is
/// immediate, and the bytes arrive when a book is actually opened.
#[tauri::command]
pub async fn download_book(
  book_id: String,
  state: State<'_, AppState>,
  app: AppHandle
) -> Result<String, String> {
  let (folder_path, drive_connected) = {
    let db = state.db.guard();
    (
      db.get_setting(FOLDER_SETTING)
        .map_err(|e| e.to_string())?
        .filter(|value| !value.is_empty()),
      drive::load_refresh_token(&db)
        .map_err(|e| e.to_string())?
        .is_some()
    )
  };

  // A folder is on this machine already, so try it before the network.
  if let Some(path) = folder_path {
    let record = {
      let db = state.db.guard();
      db.find_by_id(&book_id).map_err(|e| e.to_string())?
    };
    if let Some(record) = record {
      let entry = crate::sync::merge::BookEntry::from_record(&record);
      let source = std::path::Path::new(&path).join("books").join(entry.remote_name());
      if source.exists() {
        let destination = crate::sync::store::local_path_for(&entry).map_err(|e| e.to_string())?;
        // Through a staging file, like an import and a Drive download: copied
        // straight to its place, a copy cut short (the sync folder's own cloud
        // client still fetching it, the app closed) left a truncated file that
        // counted as the book from then on and was never fetched again.
        storage::restore_book_file(&source, &destination).map_err(|e| e.to_string())?;
        let local = destination.to_string_lossy().to_string();
        // A book that arrives from the backup is a book added to this library,
        // so it gets its copy too. In the background: the reader is waiting to read.
        keep_copies_later(&app, vec![BookRecord { local_path: local.clone(), ..record }]);
        return Ok(local);
      }
    }
  }

  if drive_connected {
    let local = drive::fetch_book(&state.db, &book_id).await.map_err(|e| e.to_string())?;
    let record = {
      let db = state.db.guard();
      db.find_by_id(&book_id).ok().flatten()
    };
    if let Some(record) = record {
      keep_copies_later(&app, vec![BookRecord { local_path: local.clone(), ..record }]);
    }
    return Ok(local);
  }
  Err("That book is not on this device, and sync is not set up.".to_string())
}
