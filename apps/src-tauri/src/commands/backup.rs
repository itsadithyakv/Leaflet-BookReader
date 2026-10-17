//! Backup: its status, Google Drive sign-in, the sync folder, and running a backup.

use super::*;
use crate::sync::folder::SyncReport;
use crate::sync::owner::{self, Standing, StoreMode, Transport};
use crate::sync::shared_doc::{Pending, StateRun, Who};

/// Where this library stands with the account signed in, for the UI. Never
/// the owner's tag itself.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStatus {
  pub standing: Standing,
  /// The reader chose to keep this (another account's) library out of
  /// reading sync and the board.
  pub stay_out: bool,
  /// The signed-in account has a library of its own elsewhere on this device.
  pub elsewhere: bool,
  /// Signed out, the transport that holds another account's library.
  pub refused: Option<Transport>
}

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
  pub books_pending: usize,
  /// Account sync is on: someone is signed in, and this library is the
  /// account's own or about to be (`Standing::Mine` or `Adopting`). The
  /// account then carries the reading state, always.
  pub account_backup: bool,
  pub library: LibraryStatus,
  /// Signed in, Drive holds another account's library: it carries this
  /// library's book files only.
  pub drive_files_only: bool,
  /// The same for the sync folder.
  pub folder_files_only: bool
}

pub const FOLDER_SETTING: &str = "sync_folder_path";
pub const LAST_SYNCED_SETTING: &str = "sync_last_synced_at";

/// Whether account sync is on for a library standing so.
fn account_sync_on(standing: Standing) -> bool {
  matches!(standing, Standing::Mine | Standing::Adopting)
}

pub(crate) fn read_sync_status(db: &db::Database) -> Result<SyncStatus, String> {
  let refresh = drive::load_refresh_token(db).map_err(|e| e.to_string())?;
  let pending = db
    .list_books()
    .map_err(|e| e.to_string())?
    .iter()
    .filter(|book| !crate::sync::store::is_available(&book.local_path))
    .count();
  let signed_in = crate::sync::cloud::signed_in(db);
  let standing = owner::standing(db);
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
    books_pending: pending,
    account_backup: account_sync_on(standing),
    library: LibraryStatus {
      standing,
      stay_out: owner::stays_out(db),
      // Whether the signed-in account has a library of its own elsewhere on
      // this device (only asked when this one is another's).
      elsewhere: standing == Standing::Other
        && owner::signed_in_tag(db).is_some_and(|tag| crate::libraries::elsewhere(db, &tag).is_some()),
      refused: if signed_in { None } else { owner::refused(db) }
    },
    drive_files_only: signed_in && owner::files_only(db, Transport::Drive),
    folder_files_only: signed_in && owner::files_only(db, Transport::Folder)
  })
}

#[tauri::command(async)]
pub fn sync_status(state: State<'_, AppState>) -> Result<SyncStatus, String> {
  let db = state.db.guard();
  read_sync_status(&db)
}

#[tauri::command(async)]
pub fn reading_stats(state: State<'_, AppState>) -> Result<db::ReadingStats, String> {
  let db = state.db.guard();
  db.reading_stats().map_err(|e| e.to_string())
}

/// Opens the consent page in the *system* browser and returns the URL used.
///
/// The frontend used to call `window.open`, which at best lands in an embedded
/// webview — and Google refuses to run its sign-in there. Opening from the
/// backend is the only reliable path.
///
/// The same on a phone: the listener binds `127.0.0.1` on the phone itself,
/// the phone's browser comes back to it, and the page it serves there links
/// back into Leaflet (`drive::SUCCESS_PAGE`). One Desktop OAuth client for
/// both, so the phone sees the folder the laptop made (`drive.file` is per
/// Google project, not per client).
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
  // What this Drive was to the library goes with it.
  forget_store(&db, Transport::Drive)?;
  read_sync_status(&db)
}

/// Forgets that a transport refused, or carried files only: it was
/// disconnected or changed, and the next one is asked afresh.
fn forget_store(db: &db::Database, transport: Transport) -> Result<(), String> {
  owner::clear_refusal(db, transport).map_err(|e| e.to_string())?;
  owner::set_files_only(db, transport, false).map_err(|e| e.to_string())
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
  forget_store(&db, Transport::Folder)?;
  read_sync_status(&db)
}

/// A book whose file is over the size a backup sends without asking
/// (`sync::large`), and what the reader has said about it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeBook {
  pub id: String,
  pub title: String,
  pub bytes: u64,
  /// `true` to back the file up, `false` not to; nothing when not yet asked.
  pub back_up: Option<bool>
}

pub(crate) fn large_books_in(db: &db::Database) -> Result<Vec<LargeBook>, String> {
  let answers = crate::sync::large::Answers::load(db);
  let mut large: Vec<LargeBook> = db
    .list_books()
    .map_err(|e| e.to_string())?
    .into_iter()
    .filter_map(|book| {
      let entry = crate::sync::merge::BookEntry::from_record(&book);
      let path = crate::sync::store::local_path_for(&entry).ok()?;
      let bytes = crate::sync::large::file_bytes(&path);
      (bytes > crate::sync::large::LARGE_BOOK_BYTES).then(|| LargeBook {
        back_up: answers.get(&book.id),
        id: book.id,
        title: book.title,
        bytes
      })
    })
    .collect();
  large.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.title.cmp(&b.title)));
  Ok(large)
}

/// The library's large books on this device, largest first, each with the
/// reader's answer. The app asks about the ones with none after a backup
/// reports files held back, and a book's menu reads its own.
#[tauri::command]
pub fn large_books(state: State<'_, AppState>) -> Result<Vec<LargeBook>, String> {
  let db = state.db.guard();
  large_books_in(&db)
}

/// Records the reader's answer for some large books: back their files up, or
/// not. The next backup acts on it. A "no" sends nothing more; it does not
/// take away a file the backup already holds.
#[tauri::command]
pub fn set_large_book_backup(book_ids: Vec<String>, back_up: bool, state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.guard();
  let mut answers = crate::sync::large::Answers::load(&db);
  for id in &book_ids {
    answers.set(id, back_up);
  }
  answers.save(&db).map_err(|e| e.to_string())
}

/// Runs whichever transports are configured, as the library's owner allows
/// (`run_sync`).
#[tauri::command]
pub async fn sync_now(app: AppHandle, state: State<'_, AppState>) -> Result<SyncReport, String> {
  let result = run_sync(&state).await;
  // A goal met on the laptop silences the phone's reminders now, not at the
  // next re-plan: the phone's alarms are planned again from what arrived.
  #[cfg(target_os = "android")]
  // (After every pull: the report does not count days, and a re-plan is cheap.)
  if result.is_ok() {
    crate::reminders::phone::request_sync(&app);
  }
  #[cfg(not(target_os = "android"))]
  let _ = app;
  if let Err(error) = &result {
    crate::diag::warn(&format!("backup failed: {error}"));
  }
  result
}

/// What a run does, from what is set up and whose the library is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Plan {
  /// Signed in as one account, and the library is another's: nothing runs,
  /// nothing is published.
  Paused,
  /// No folder, no Drive, nobody signed in.
  NotSetUp,
  /// Signed out: the folder, then Drive, carry the state and the files, as
  /// they always have; but never into or out of another account's library.
  SignedOut,
  /// Signed in: the account carries the state; then each of the folder and
  /// Drive by what it holds (`owner::store_mode`). `adopting`: the library
  /// is nobody's yet, and is claimed once the account has its state.
  SignedIn { adopting: bool }
}

pub(crate) fn plan(folder: bool, drive: bool, signed_in: bool, standing: Standing) -> Plan {
  if signed_in && standing == Standing::Other {
    Plan::Paused
  } else if signed_in {
    Plan::SignedIn { adopting: standing == Standing::Adopting }
  } else if folder || drive {
    Plan::SignedOut
  } else {
    Plan::NotSetUp
  }
}

/// What a run does with one transport, by what it holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Step {
  /// Run the state half (which asks again, from what it reads: a store
  /// claimed by another device meanwhile is refused there).
  pub state: bool,
  /// Run the files half.
  pub files: bool,
  /// The files half may take away the files of books removed.
  pub may_delete: bool,
  /// Signed out, and the store is another account's: an error.
  pub refuse: bool
}

pub(crate) fn step_for(mode: StoreMode) -> Step {
  match mode {
    StoreMode::Claim | StoreMode::Bridge | StoreMode::Exchange => Step { state: true, files: true, may_delete: true, refuse: false },
    StoreMode::FilesOnly => Step { state: false, files: true, may_delete: false, refuse: false },
    StoreMode::Refuse => Step { state: false, files: false, may_delete: false, refuse: true }
  }
}

/// A transport with its two halves (`sync::folder`, `sync::drive`), so a run
/// can be driven, and tested, apart from how each moves its bytes.
pub(crate) trait Carrier: Sync {
  fn transport(&self) -> Transport;
  /// Whose library the store holds, before its document is read (the
  /// marker; the folder's document too).
  fn store_owner(&self) -> Option<String>;
  fn sync_state<'a>(&'a self, db_mutex: &'a std::sync::Mutex<db::Database>, now: &'a str, who: &'a Who) -> Pending<'a, StateRun>;
  fn sync_files<'a>(&'a self, db_mutex: &'a std::sync::Mutex<db::Database>, may_delete: bool) -> Pending<'a, SyncReport>;
}

struct FolderCarrier {
  root: std::path::PathBuf,
  owner: Option<String>
}

impl FolderCarrier {
  fn at(path: &str) -> Self {
    let root = std::path::PathBuf::from(path);
    let owner = crate::sync::folder::store_owner(&root);
    FolderCarrier { root, owner }
  }
}

impl Carrier for FolderCarrier {
  fn transport(&self) -> Transport {
    Transport::Folder
  }

  fn store_owner(&self) -> Option<String> {
    self.owner.clone()
  }

  fn sync_state<'a>(&'a self, db_mutex: &'a std::sync::Mutex<db::Database>, now: &'a str, who: &'a Who) -> Pending<'a, StateRun> {
    Box::pin(async move {
      let db = db_mutex.guard();
      crate::sync::folder::sync_state(&db, &self.root, now, who)
    })
  }

  fn sync_files<'a>(&'a self, db_mutex: &'a std::sync::Mutex<db::Database>, may_delete: bool) -> Pending<'a, SyncReport> {
    Box::pin(async move {
      let db = db_mutex.guard();
      crate::sync::folder::sync_files(&db, &self.root, may_delete)
    })
  }
}

impl Carrier for drive::DriveCtx {
  fn transport(&self) -> Transport {
    Transport::Drive
  }

  fn store_owner(&self) -> Option<String> {
    self.doc_owner.clone()
  }

  fn sync_state<'a>(&'a self, db_mutex: &'a std::sync::Mutex<db::Database>, now: &'a str, who: &'a Who) -> Pending<'a, StateRun> {
    Box::pin(drive::sync_state(db_mutex, self, now, who))
  }

  fn sync_files<'a>(&'a self, db_mutex: &'a std::sync::Mutex<db::Database>, may_delete: bool) -> Pending<'a, SyncReport> {
    Box::pin(drive::sync_files(db_mutex, self, may_delete))
  }
}

/// Runs a plan over the transports given (the folder first, then Drive) and
/// the account's store (`cloud`, signed in). Nothing here asks who is signed
/// in: `plan` and `tag` say.
///
/// Signed in, the account goes first. That is what makes a claim safe in a
/// race: of two devices claiming one Drive, the one whose write is refused
/// reads again, finds the store taken, and goes on with files only; its
/// account has by then taken nothing of the other's.
pub(crate) async fn execute(
  db_mutex: &std::sync::Mutex<db::Database>,
  now: &str,
  plan: Plan,
  tag: Option<&str>,
  cloud: Option<&dyn crate::sync::cloud::StateStore>,
  carriers: &[&dyn Carrier]
) -> Result<SyncReport, String> {
  let fail = |error: anyhow::Error| error.to_string();
  let mut report = SyncReport::default();
  match plan {
    Plan::Paused => Ok(SyncReport { owner_paused: true, ..SyncReport::default() }),
    Plan::NotSetUp => Err("Sync is not set up yet. Connect Drive or choose a sync folder.".to_string()),
    Plan::SignedOut => {
      let who = Who::signed_out();
      let mut refused: Option<String> = None;
      for carrier in carriers {
        let transport = carrier.transport();
        let local = {
          let db = db_mutex.guard();
          owner::get(&db)
        };
        let mut step = step_for(who.mode(local.as_deref(), carrier.store_owner().as_deref()));
        let mut newer = false;
        if step.state {
          let run = carrier.sync_state(db_mutex, now, &who).await.map_err(fail)?;
          if run.refused {
            step = step_for(StoreMode::Refuse);
          } else {
            newer = run.newer;
            report.merge_in(run.report);
          }
        }
        let db_note = |refusing: bool| -> Result<(), String> {
          let db = db_mutex.guard();
          if refusing { owner::note_refusal(&db, transport) } else { owner::clear_refusal(&db, transport) }.map_err(fail)
        };
        if step.refuse {
          db_note(true)?;
          refused.get_or_insert_with(|| transport.refused_message().to_string());
          continue;
        }
        db_note(false)?;
        if step.files && !newer {
          report.merge_in(carrier.sync_files(db_mutex, step.may_delete).await.map_err(fail)?);
        }
      }
      match refused {
        Some(message) => Err(message),
        None => Ok(report)
      }
    }
    Plan::SignedIn { adopting } => {
      let tag = tag.ok_or_else(|| "Could not tell which Leaflet account is signed in. Try again shortly.".to_string())?;
      let who = Who::signed_in(tag);
      // (a) The account first.
      let mut cloud_error: Option<String> = None;
      let mut cloud_ok = false;
      if let Some(cloud) = cloud {
        match crate::sync::cloud::sync_with(db_mutex, cloud, now, Some(tag)).await {
          Ok(crate::sync::cloud::CloudOutcome::Synced(synced)) => {
            cloud_ok = true;
            report.merge_in(synced);
          }
          Ok(crate::sync::cloud::CloudOutcome::AccountHolds { books }) => {
            return Ok(SyncReport { account_holds: Some(books), ..SyncReport::default() });
          }
          Err(error) => cloud_error = Some(error.to_string())
        }
      }
      // (b) Each store's state, as what it holds allows.
      let mut brought_news = false;
      let mut files: Vec<(usize, bool)> = Vec::new();
      for (index, carrier) in carriers.iter().enumerate() {
        let transport = carrier.transport();
        let local = {
          let db = db_mutex.guard();
          owner::get(&db)
        };
        let mut step = step_for(who.mode(local.as_deref(), carrier.store_owner().as_deref()));
        let mut newer = false;
        if step.state {
          let run = carrier.sync_state(db_mutex, now, &who).await.map_err(fail)?;
          if run.refused {
            step = step_for(StoreMode::FilesOnly);
          } else {
            newer = run.newer;
            brought_news |= run.brought_news;
            report.merge_in(run.report);
          }
        }
        {
          let db = db_mutex.guard();
          owner::set_files_only(&db, transport, !step.may_delete).map_err(fail)?;
        }
        if step.files && !newer {
          files.push((index, step.may_delete));
        }
      }
      // (c) What the stores brought goes to the account at once.
      if brought_news && cloud_ok {
        if let Some(cloud) = cloud {
          match crate::sync::cloud::sync_with(db_mutex, cloud, now, Some(tag)).await {
            Ok(crate::sync::cloud::CloudOutcome::Synced(synced)) => report.merge_in(synced),
            Ok(crate::sync::cloud::CloudOutcome::AccountHolds { .. }) => {}
            Err(error) => cloud_error = Some(error.to_string())
          }
        }
      }
      // (d) The account has the library's state: the library is the account's.
      if adopting && cloud_ok {
        let db = db_mutex.guard();
        owner::claim_if_unowned(&db, tag).map_err(fail)?;
      }
      // (e) The files, over this library as it is now.
      for (index, may_delete) in files {
        report.merge_in(carriers[index].sync_files(db_mutex, may_delete).await.map_err(fail)?);
      }
      // (g) The account's failure, now that the stores have had their turn.
      match cloud_error {
        Some(error) => Err(error),
        None => Ok(report)
      }
    }
  }
}

/// What a run starts from.
struct Facts {
  folder_path: Option<String>,
  drive_connected: bool,
  signed_in: bool,
  tag: Option<String>,
  standing: Standing
}

impl Facts {
  fn read(db: &db::Database) -> Result<Self, String> {
    Ok(Facts {
      folder_path: db.get_setting(FOLDER_SETTING).map_err(|e| e.to_string())?.filter(|value| !value.is_empty()),
      drive_connected: drive::load_refresh_token(db).map_err(|e| e.to_string())?.is_some(),
      signed_in: crate::sync::cloud::signed_in(db),
      tag: owner::signed_in_tag(db),
      standing: owner::standing(db)
    })
  }
}

/// One run: the account (signed in), the folder, then Drive, each as whose
/// library this is allows (`execute`); then the board, for a library that is
/// the account's own.
pub(crate) async fn run_sync(state: &State<'_, AppState>) -> Result<SyncReport, String> {
  // One run at a time. Connecting Drive fires a sync from the auth flow and
  // another from the status change; run together, both found no `state.json`
  // and both created one, leaving devices to drift across two copies. A caller
  // that arrives mid-run waits and then converges against what the first wrote.
  let _running = state.sync_lock.lock().await;
  let now = db::now_iso();
  let mut known = {
    let db = state.db.guard();
    Facts::read(&db)?
  };
  // Signed in, but this device has not heard who: ask the server once (which
  // also notices a session that has ended), and go by its answer.
  if known.signed_in && known.tag.is_none() {
    let _ = crate::sync::cloud::status(&state.db, true).await;
    let db = state.db.guard();
    known = Facts::read(&db)?;
  }
  let Facts { folder_path, drive_connected, signed_in, tag, standing } = known;
  let plan = plan(folder_path.is_some(), drive_connected, signed_in, standing);
  if matches!(plan, Plan::Paused | Plan::NotSetUp) {
    return execute(&state.db, &now, plan, None, None, &[]).await;
  }

  let folder = folder_path.as_deref().map(FolderCarrier::at);
  // Drive that cannot be reached does not keep the rest from syncing; its
  // failure is reported once the others have run.
  let mut drive_error = None;
  let drive_ctx = if drive_connected {
    match drive::open(&state.db).await {
      Ok(ctx) => Some(ctx),
      Err(error) => {
        drive_error = Some(error.to_string());
        None
      }
    }
  } else {
    None
  };
  let mut carriers: Vec<&dyn Carrier> = Vec::new();
  if let Some(folder) = &folder {
    carriers.push(folder);
  }
  if let Some(ctx) = &drive_ctx {
    carriers.push(ctx);
  }
  let server = if signed_in {
    Some(crate::sync::cloud::Server::signed_in(&state.db).map_err(|e| e.to_string())?)
  } else {
    None
  };
  let cloud = server.as_ref().map(|server| server as &dyn crate::sync::cloud::StateStore);

  let result = execute(&state.db, &now, plan, tag.as_deref(), cloud, &carriers).await;
  let report = match result {
    Ok(report) if report.account_holds.is_some() => return Ok(report),
    other => other
  };
  if signed_in {
    // When one is due: the app publishes on its own clock as well, and a
    // sync follows every book closed and every line marked. Only for a
    // library that is the account's own (`publish_profile`).
    let _ = publish_profile_after_sync(state).await;
  }
  let report = report?;
  if let Some(error) = drive_error {
    return Err(error);
  }
  {
    let db = state.db.guard();
    db.set_setting(LAST_SYNCED_SETTING, &now).map_err(|e| e.to_string())?;
  }
  Ok(report)
}

/// The reader's answer for a library started fresh whose account already
/// held one from before (`SyncReport::account_holds`): use it (`use_it`),
/// which merges it in; or start empty, which replaces what the account holds
/// with an empty library and cannot be undone. Then a sync.
#[tauri::command]
pub async fn library_fresh_answer(use_it: bool, app: AppHandle, state: State<'_, AppState>) -> Result<SyncReport, String> {
  {
    let _running = state.sync_lock.lock().await;
    let fresh = {
      let db = state.db.guard();
      owner::is_fresh(&db)
    };
    if !fresh {
      return Err("This library has nothing to ask about.".to_string());
    }
    if !use_it {
      crate::sync::cloud::replace_with_empty(&state.db, &db::now_iso()).await.map_err(|e| e.to_string())?;
    }
    let db = state.db.guard();
    owner::set_fresh(&db, false).map_err(|e| e.to_string())?;
  }
  sync_now(app, state).await
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::tests::memory_db;
  use crate::db::BookRecord;
  use crate::sync::cloud::fake::FakeCloud;
  use crate::sync::shared_doc::fake::FakeDrive;
  use std::sync::Mutex;

  const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  /// With only the account, a missing file is the reader's to add again; the
  /// account never had it.
  #[test]
  fn a_book_with_no_file_says_what_to_do_about_it() {
    assert!(no_file_message(true).contains("Add the same file again"));
    assert!(no_file_message(false).contains("sync is not set up"));
  }

  #[test]
  fn the_plan_table() {
    use Standing::*;
    assert_eq!(plan(false, false, true, Adopting), Plan::SignedIn { adopting: true }, "the account alone");
    assert_eq!(plan(false, false, true, Mine), Plan::SignedIn { adopting: false });
    assert_eq!(plan(true, true, true, Mine), Plan::SignedIn { adopting: false });
    assert_eq!(plan(true, true, true, Other), Plan::Paused);
    assert_eq!(plan(false, false, true, Other), Plan::Paused);
    assert_eq!(plan(false, false, false, Unowned), Plan::NotSetUp);
    assert_eq!(plan(false, false, false, SignedOut), Plan::NotSetUp);
    assert_eq!(plan(true, false, false, SignedOut), Plan::SignedOut);
    assert_eq!(plan(false, true, false, Unowned), Plan::SignedOut);

    assert!(step_for(StoreMode::Claim).may_delete && step_for(StoreMode::Bridge).state);
    assert_eq!(step_for(StoreMode::FilesOnly), Step { state: false, files: true, may_delete: false, refuse: false });
    assert_eq!(step_for(StoreMode::Refuse), Step { state: false, files: false, may_delete: false, refuse: true });
  }

  #[test]
  fn the_status_says_where_the_library_stands_and_never_its_owner() {
    let db = memory_db();
    owner::claim_if_unowned(&db, A).expect("claim");
    owner::note_refusal(&db, Transport::Drive).expect("note");
    owner::set_files_only(&db, Transport::Folder, true).expect("flag");
    let status = read_sync_status(&db).expect("status");
    assert!(!status.account_backup, "nobody is signed in");
    assert_eq!(
      status.library,
      LibraryStatus { standing: Standing::SignedOut, stay_out: false, elsewhere: false, refused: Some(Transport::Drive) }
    );
    assert!(!status.folder_files_only, "files only is a signed-in state");
    let json = serde_json::to_value(&status).expect("json");
    assert_eq!(json["library"], serde_json::json!({ "standing": "signedOut", "stayOut": false, "elsewhere": false, "refused": "drive" }));
    assert!(json.get("driveFilesOnly").is_some() && json.get("folderFilesOnly").is_some() && json.get("accountBackup").is_some());
    assert!(!json.to_string().contains(A));
  }

  /// A device: its library, behind the mutex a run holds.
  struct Device {
    db: Mutex<db::Database>
  }

  impl Device {
    fn new() -> Self {
      Device { db: Mutex::new(memory_db()) }
    }

    fn owned_by(tag: &str) -> Self {
      let device = Device::new();
      owner::claim_if_unowned(&device.db.guard(), tag).expect("claim");
      device
    }

    fn read(&self, day: &str, minutes: f64) {
      self.db.guard().credit_minutes(day, minutes, 30).expect("read");
    }

    fn add(&self, id: &str) {
      self.db.guard().upsert_book(&book(id)).expect("import");
    }

    fn minutes(&self, day: &str) -> f64 {
      self.db.guard().reading_days().expect("days").get(day).map(|d| d.minutes).unwrap_or(0.0)
    }

    fn books(&self) -> Vec<String> {
      let mut ids: Vec<String> = self.db.guard().list_books().expect("list").into_iter().map(|b| b.id).collect();
      ids.sort();
      ids
    }

    fn owner(&self) -> Option<String> {
      owner::get(&self.db.guard())
    }

    /// A run as `run_sync` makes it, signed in as `tag` or signed out.
    async fn run(&self, now: &str, tag: Option<&str>, cloud: Option<&FakeCloud>, carriers: &[&dyn Carrier]) -> Result<SyncReport, String> {
      let standing = owner::standing_of(self.owner().as_deref(), tag.is_some(), tag);
      let plan = plan(carriers.iter().any(|c| c.transport() == Transport::Folder), carriers.iter().any(|c| c.transport() == Transport::Drive), tag.is_some(), standing);
      execute(&self.db, now, plan, tag, cloud.map(|c| c as &dyn crate::sync::cloud::StateStore), carriers).await
    }
  }

  fn book(id: &str) -> BookRecord {
    BookRecord {
      finished_at: None,
      id: id.to_string(),
      title: format!("Book {id}"),
      author: None,
      genres: Vec::new(),
      cover_url: None,
      local_path: format!("/device/books/{id}.epub"),
      file_hash: id.to_string(),
      progress: 0.0,
      position: None,
      series: None,
      series_index: None,
      last_opened: None,
      created_at: "2026-10-01T09:00:00+00:00".to_string(),
      metadata_checked_at: None,
      metadata_updated_at: Some("2026-10-01T09:00:00+00:00".to_string()),
      progress_updated_at: Some("2026-10-01T09:00:00+00:00".to_string()),
      deleted_at: None,
      available: true
    }
  }

  /// Drive without the network: the document through `FakeDrive`, and the
  /// files half recorded rather than run.
  #[derive(Default)]
  struct FakeDriveCarrier {
    drive: FakeDrive,
    files: Mutex<Vec<bool>>
  }

  impl FakeDriveCarrier {
    fn deletes(&self) -> Vec<bool> {
      self.files.lock().unwrap().clone()
    }
  }

  impl Carrier for FakeDriveCarrier {
    fn transport(&self) -> Transport {
      Transport::Drive
    }

    fn store_owner(&self) -> Option<String> {
      crate::sync::shared_doc::remote_owner(self.drive.doc().and_then(|doc| doc.owner).as_deref(), self.drive.mark().as_deref())
    }

    fn sync_state<'a>(&'a self, db_mutex: &'a Mutex<db::Database>, now: &'a str, who: &'a Who) -> Pending<'a, StateRun> {
      Box::pin(crate::sync::shared_doc::sync(db_mutex, &self.drive, now, who))
    }

    fn sync_files<'a>(&'a self, _db_mutex: &'a Mutex<db::Database>, may_delete: bool) -> Pending<'a, SyncReport> {
      Box::pin(async move {
        self.files.lock().unwrap().push(may_delete);
        Ok(SyncReport::default())
      })
    }
  }

  const DAY: &str = "2026-10-14";

  #[tokio::test]
  async fn signed_in_with_nothing_set_up_the_account_alone_carries_the_library() {
    let (laptop, cloud) = (Device::new(), FakeCloud::default());
    laptop.add("aaa");
    laptop.read(DAY, 20.0);
    laptop.run("2026-10-14T20:00:00+00:00", Some(A), Some(&cloud), &[]).await.expect("sync");
    let held = cloud.doc().expect("the account holds it");
    assert_eq!(held.books.len(), 1);
    assert_eq!(held.owner.as_deref(), Some(A), "stamped for the record");
    assert_eq!(laptop.owner().as_deref(), Some(A), "and the library is the account's");

    // A second device signing in takes it all in.
    let phone = Device::new();
    phone.run("2026-10-14T20:01:00+00:00", Some(A), Some(&cloud), &[]).await.expect("sync");
    assert_eq!(phone.books(), vec!["aaa".to_string()]);
    assert_eq!(phone.minutes(DAY), 20.0);
    assert_eq!(phone.owner().as_deref(), Some(A));
  }

  #[tokio::test]
  async fn a_drive_nobody_has_claimed_is_claimed_after_the_account_and_its_news_goes_up() {
    let drive = FakeDriveCarrier::default();
    let old = Device::new();
    old.add("ddd");
    crate::sync::shared_doc::sync(&old.db, &drive.drive, "2026-10-13T09:00:00+00:00", &Who::signed_out()).await.expect("an old device's Drive");

    let (laptop, cloud) = (Device::new(), FakeCloud::default());
    laptop.add("aaa");
    laptop.run("2026-10-14T20:00:00+00:00", Some(A), Some(&cloud), &[&drive]).await.expect("sync");
    assert_eq!(cloud.pushes(), 2, "the account, then what Drive brought");
    let held = cloud.doc().expect("held");
    let mut ids: Vec<&str> = held.books.iter().map(|b| b.id.as_str()).collect();
    ids.sort();
    assert_eq!(ids, vec!["aaa", "ddd"]);
    assert_eq!(drive.drive.doc().expect("doc").owner.as_deref(), Some(A));
    assert_eq!(drive.drive.mark().as_deref(), Some(A));
    assert_eq!(laptop.owner().as_deref(), Some(A));
    assert_eq!(drive.deletes(), vec![true]);
  }

  #[tokio::test]
  async fn the_accounts_own_drive_is_bridged_and_another_accounts_carries_files_only() {
    let mine = FakeDriveCarrier::default();
    let laptop = Device::owned_by(A);
    let cloud = FakeCloud::default();
    laptop.read(DAY, 10.0);
    laptop.run("2026-10-14T20:00:00+00:00", Some(A), Some(&cloud), &[&mine]).await.expect("sync");
    assert_eq!(mine.drive.doc().expect("bridged").days.len(), 1, "the state is kept there too");
    assert!(!owner::files_only(&laptop.db.guard(), Transport::Drive));

    let theirs = FakeDriveCarrier::default();
    let b = Device::owned_by(B);
    b.add("bbb");
    b.run("2026-10-14T19:00:00+00:00", Some(B), Some(&FakeCloud::default()), &[&theirs]).await.expect("B's");
    let written = theirs.drive.raw();
    laptop.run("2026-10-14T20:05:00+00:00", Some(A), Some(&cloud), &[&theirs]).await.expect("sync");
    assert_eq!(theirs.drive.raw(), written, "B's state untouched");
    assert_eq!(laptop.books(), Vec::<String>::new(), "and nothing of it taken");
    assert_eq!(theirs.deletes(), vec![true, false], "files for both; deletes for B alone");
    assert!(owner::files_only(&laptop.db.guard(), Transport::Drive));
  }

  #[tokio::test]
  async fn signed_out_a_store_is_exchanged_with_or_refused() {
    let drive = FakeDriveCarrier::default();
    let a = Device::owned_by(A);
    a.add("aaa");
    a.run("2026-10-14T09:00:00+00:00", Some(A), Some(&FakeCloud::default()), &[&drive]).await.expect("A claims it");

    // Nobody's library takes it in, and becomes A's.
    let phone = Device::new();
    phone.run("2026-10-14T10:00:00+00:00", None, None, &[&drive]).await.expect("exchange");
    assert_eq!(phone.books(), vec!["aaa".to_string()]);
    assert_eq!(phone.owner().as_deref(), Some(A));

    // B's library is kept out of it.
    let b = Device::owned_by(B);
    b.add("bbb");
    let written = drive.drive.raw();
    let error = b.run("2026-10-14T11:00:00+00:00", None, None, &[&drive]).await.expect_err("refused");
    assert_eq!(error, owner::DRIVE_REFUSED);
    assert_eq!(owner::refused(&b.db.guard()), Some(Transport::Drive));
    assert_eq!(drive.drive.raw(), written);
    assert_eq!(b.books(), vec!["bbb".to_string()]);
    assert_eq!(drive.deletes(), vec![true, true], "no files for a refused store");
  }

  #[tokio::test]
  async fn another_accounts_library_is_paused() {
    let (b, cloud, drive) = (Device::owned_by(B), FakeCloud::default(), FakeDriveCarrier::default());
    b.add("bbb");
    let report = b.run("2026-10-14T09:00:00+00:00", Some(A), Some(&cloud), &[&drive]).await.expect("paused");
    assert!(report.owner_paused);
    assert_eq!(cloud.doc(), None);
    assert_eq!(drive.drive.raw(), None);
    assert!(drive.deletes().is_empty());
  }

  #[tokio::test]
  async fn an_account_that_fails_still_lets_the_bridge_and_files_run_then_says_so() {
    let (laptop, cloud, drive) = (Device::owned_by(A), FakeCloud::failing(), FakeDriveCarrier::default());
    laptop.read(DAY, 10.0);
    let error = laptop.run("2026-10-14T09:00:00+00:00", Some(A), Some(&cloud), &[&drive]).await.expect_err("the account failed");
    assert!(error.contains("server"), "{error}");
    assert_eq!(drive.drive.doc().expect("bridged").days.len(), 1);
    assert_eq!(drive.deletes(), vec![true]);
  }

  /// Two devices, two accounts, one Drive nobody had claimed, at the same
  /// moment. B's write is refused (A's landed first); B reads again, finds
  /// it taken, and goes on with files only. B's account took nothing of A's,
  /// nor of what was in the Drive.
  #[tokio::test]
  async fn two_accounts_claiming_one_drive_at_once_never_mix() {
    let drive = FakeDriveCarrier::default();
    let old = Device::new();
    old.add("ddd");
    crate::sync::shared_doc::sync(&old.db, &drive.drive, "2026-10-13T09:00:00+00:00", &Who::signed_out()).await.expect("seed");

    let (x, y) = (Device::new(), Device::new());
    let (cloud_a, cloud_b) = (FakeCloud::default(), FakeCloud::default());
    x.add("aaa");
    y.add("bbb");
    // X's claim lands between Y's read of the Drive and Y's write.
    let claimed = {
      let local = crate::sync::store::snapshot(&x.db.guard(), "2026-10-14T09:00:00+00:00").expect("snapshot");
      let mut doc = crate::sync::merge::merge(&local, &drive.drive.doc().expect("doc"), "2026-10-14T09:00:00+00:00");
      doc.owner = Some(A.to_string());
      doc
    };
    drive.drive.sneak_in_marked(serde_json::to_vec(&claimed).expect("json"), A);
    y.run("2026-10-14T09:00:01+00:00", Some(B), Some(&cloud_b), &[&drive]).await.expect("sync");

    assert_eq!(drive.drive.conflicts(), 1);
    assert!(owner::files_only(&y.db.guard(), Transport::Drive));
    assert_eq!(y.books(), vec!["bbb".to_string()]);
    let held = cloud_b.doc().expect("B's account");
    assert_eq!(held.books.iter().map(|b| b.id.as_str()).collect::<Vec<_>>(), vec!["bbb"]);
    assert_eq!(cloud_b.pushes(), 1, "nothing came from the Drive to send again");
    assert_eq!(y.owner().as_deref(), Some(B));
    assert_eq!(drive.deletes(), vec![false]);

    // X, on its next run, sees its own Drive.
    x.run("2026-10-14T09:01:00+00:00", Some(A), Some(&cloud_a), &[&drive]).await.expect("sync");
    assert!(!owner::files_only(&x.db.guard(), Transport::Drive));
    assert_eq!(x.owner().as_deref(), Some(A));
    let a_held = cloud_a.doc().expect("A's account");
    assert!(a_held.books.iter().all(|b| b.id != "bbb"));
  }

  /// A fresh library's first account sync asks before taking in a copy from
  /// before owners; nothing else runs until the reader answers.
  #[tokio::test]
  async fn a_fresh_library_asks_about_what_the_account_holds() {
    let legacy = Device::new();
    legacy.add("old1");
    legacy.add("old2");
    let cloud = FakeCloud::default();
    cloud.put(&crate::sync::store::snapshot(&legacy.db.guard(), "2026-10-01T09:00:00+00:00").expect("a copy"));

    let fresh = Device::owned_by(A);
    owner::set_fresh(&fresh.db.guard(), true).expect("fresh");
    fresh.add("new");
    let drive = FakeDriveCarrier::default();
    let report = fresh.run("2026-10-14T09:00:00+00:00", Some(A), Some(&cloud), &[&drive]).await.expect("asks");
    assert_eq!(report.account_holds, Some(2));
    assert_eq!(fresh.books(), vec!["new".to_string()]);
    assert!(drive.deletes().is_empty() && drive.drive.raw().is_none());
    assert_eq!(cloud.pushes(), 0);

    // "Start empty": the account's copy is replaced, and the next run sends
    // this library alone.
    crate::sync::cloud::replace_with_empty_on(&fresh.db, &cloud, "2026-10-14T09:01:00+00:00", A).await.expect("replaced");
    owner::set_fresh(&fresh.db.guard(), false).expect("answered");
    fresh.run("2026-10-14T09:02:00+00:00", Some(A), Some(&cloud), &[]).await.expect("sync");
    let held = cloud.doc().expect("held");
    assert_eq!(held.books.iter().map(|b| b.id.as_str()).collect::<Vec<_>>(), vec!["new"]);
    assert_eq!(held.owner.as_deref(), Some(A));
  }

  /// The bridge between devices: a phone signed out and a laptop signed in,
  /// one owner, one Drive. Each run brings the other's reading; the account
  /// ends with both.
  #[tokio::test]
  async fn a_signed_out_phone_and_a_signed_in_laptop_keep_in_step_through_the_bridge() {
    let (laptop, phone) = (Device::owned_by(A), Device::owned_by(A));
    let (cloud, drive) = (FakeCloud::default(), FakeDriveCarrier::default());
    laptop.read(DAY, 20.0);
    phone.read(DAY, 15.0);

    laptop.run("2026-10-14T20:00:00+00:00", Some(A), Some(&cloud), &[&drive]).await.expect("laptop");
    phone.run("2026-10-14T20:01:00+00:00", None, None, &[&drive]).await.expect("phone");
    laptop.run("2026-10-14T20:02:00+00:00", Some(A), Some(&cloud), &[&drive]).await.expect("laptop");

    assert_eq!(laptop.minutes(DAY), 35.0);
    assert_eq!(phone.minutes(DAY), 35.0);
    let day = cloud.doc().expect("held").days.into_iter().find(|d| d.date_key == DAY).expect("day");
    assert_eq!(day.minutes, 35.0, "the phone's reading reached the account");

    // And back: what the account brings (a third device) reaches the phone.
    let tablet = Device::owned_by(A);
    tablet.read("2026-10-15", 5.0);
    tablet.run("2026-10-15T08:00:00+00:00", Some(A), Some(&cloud), &[]).await.expect("tablet");
    laptop.run("2026-10-15T08:01:00+00:00", Some(A), Some(&cloud), &[&drive]).await.expect("laptop");
    phone.run("2026-10-15T08:02:00+00:00", None, None, &[&drive]).await.expect("phone");
    assert_eq!(phone.minutes("2026-10-15"), 5.0);
  }

  /// The folder in a run: the state half refuses another's library and the
  /// files half keeps it whole.
  #[tokio::test]
  async fn a_folder_runs_the_same_way() {
    let root = std::env::temp_dir().join("leaflet-backup-test-folder");
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("dir");
    let carrier = |path: &std::path::Path| FolderCarrier::at(path.to_str().expect("path"));

    let b = Device::owned_by(B);
    b.add("bbb");
    b.run("2026-10-14T09:00:00+00:00", Some(B), Some(&FakeCloud::default()), &[&carrier(&root)]).await.expect("B's");
    assert_eq!(std::fs::read_to_string(root.join(".leaflet-owner")).expect("marked").trim(), B);

    let a = Device::owned_by(A);
    a.add("aaa");
    let error = a.run("2026-10-14T10:00:00+00:00", None, None, &[&carrier(&root)]).await.expect_err("refused");
    assert_eq!(error, owner::FOLDER_REFUSED);
    a.run("2026-10-14T10:01:00+00:00", Some(A), Some(&FakeCloud::default()), &[&carrier(&root)]).await.expect("files only");
    assert!(owner::files_only(&a.db.guard(), Transport::Folder));
    assert_eq!(a.books(), vec!["aaa".to_string()]);
    let doc: crate::sync::merge::SyncDoc = serde_json::from_slice(&std::fs::read(root.join("state.json")).expect("doc")).expect("json");
    assert!(doc.books.iter().all(|entry| entry.id != "aaa"));
    let _ = std::fs::remove_dir_all(&root);
  }
}

/// Why a book with no file here cannot be fetched. An account's backup holds
/// the reading, never the files, so there the way on is the file itself.
pub(crate) fn no_file_message(account_backup: bool) -> &'static str {
  if account_backup {
    "That book's file is not on this computer. Add the same file again and your place will be waiting."
  } else {
    "That book is not on this device, and sync is not set up."
  }
}

/// Where this device itself last stood in a book, apart from the place a
/// sync may have brought (`Database::place_here`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceHere {
  pub progress: f32,
  pub position: Option<String>
}

/// The reader opens a book here, and offers the other device's place when it
/// differs ("Your other device is further on"). Nothing when the book was
/// never read on this device: then the agreed place is the only one.
#[tauri::command]
pub fn place_here(book_id: String, state: State<'_, AppState>) -> Result<Option<PlaceHere>, String> {
  let db = state.db.guard();
  Ok(
    db.place_here(&book_id)
      .map_err(|e| e.to_string())?
      .map(|(progress, position)| PlaceHere { progress, position })
  )
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
  // The library the book was asked for in (`AppState::db_for`).
  let epoch = state.epoch();
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
        keep_copies_later(&app, epoch, vec![BookRecord { local_path: local.clone(), ..record }]);
        return Ok(local);
      }
    }
  }

  if drive_connected {
    let local = drive::fetch_book(&state.db, &book_id).await.map_err(|e| e.to_string())?;
    // Another library opened meanwhile: the reader is no longer waiting for
    // this book, and no copy is made for it (the file stays where it landed).
    if state.epoch() != epoch {
      return Err(crate::LIBRARY_CHANGED.to_string());
    }
    let record = {
      let db = state.db.guard();
      db.find_by_id(&book_id).ok().flatten()
    };
    if let Some(record) = record {
      keep_copies_later(&app, epoch, vec![BookRecord { local_path: local.clone(), ..record }]);
    }
    return Ok(local);
  }
  let account = {
    let db = state.db.guard();
    account_sync_on(owner::standing(&db))
  };
  Err(no_file_message(account).to_string())
}
