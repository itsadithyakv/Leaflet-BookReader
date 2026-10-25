//! Backup: its status, Google Drive sign-in, the sync folder, and running a backup.

use super::*;
use crate::sync::folder::{StoreHolds as SyncStoreHolds, SyncReport};
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
  pub folder_files_only: bool,
  /// Drive is connected and the last try found Google refusing Leaflet's
  /// client (`client_disabled`) or the reader's grant (`reconnect`).
  pub drive_unavailable: Option<drive::DriveUnavailable>,
  /// Account sync is on and its copy is filling up (sync audit D2): how
  /// large it is and the most the server keeps, in bytes. Nothing below
  /// four fifths of that.
  pub account_usage: Option<AccountUsage>
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsage {
  pub bytes: usize,
  pub limit: usize
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
    folder_files_only: signed_in && owner::files_only(db, Transport::Folder),
    drive_unavailable: if refresh.is_some() { drive::unavailable_noted(db) } else { None },
    account_usage: if account_sync_on(standing) {
      crate::sync::cloud::state_usage(db).map(|(bytes, limit)| AccountUsage { bytes, limit })
    } else {
      None
    }
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
  drive::note_grant_client(&db, &credentials.client_id).map_err(|e| e.to_string())?;
  // A new grant: whatever Google refused before is asked afresh.
  drive::clear_unavailable(&db).map_err(|e| e.to_string())?;
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
  owner::set_claim_answer(db, transport, None).map_err(|e| e.to_string())?;
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
  // With smaller backups, a book is as large as its smaller copy, once made.
  let sizes = crate::storage::smaller::enabled(db).then(|| crate::sync::large::SentSizes::load(db));
  let mut large: Vec<LargeBook> = db
    .list_books()
    .map_err(|e| e.to_string())?
    .into_iter()
    .filter_map(|book| {
      let entry = crate::sync::merge::BookEntry::from_record(&book);
      let path = crate::sync::store::local_path_for(&entry).ok()?;
      let bytes = sizes
        .as_ref()
        .and_then(|sizes| sizes.get(&book.id))
        .unwrap_or_else(|| crate::sync::large::file_bytes(&path));
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
#[tauri::command(async)]
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

/// This device's "Smaller backups" switch (`storage::smaller`), and what it
/// has saved in Drive so far.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmallerBackups {
  pub on: bool,
  pub saved_bytes: u64
}

#[tauri::command(async)]
pub fn smaller_backups(state: State<'_, AppState>) -> SmallerBackups {
  let db = state.db.guard();
  SmallerBackups { on: crate::storage::smaller::enabled(&db), saved_bytes: crate::storage::smaller::saved_bytes(&db) }
}

/// Turns smaller copies on or off for the files backed up from now on. What
/// Drive already holds stays as it is, either way.
#[tauri::command]
pub fn set_smaller_backups(on: bool, state: State<'_, AppState>) -> Result<SmallerBackups, String> {
  let db = state.db.guard();
  crate::storage::smaller::set_enabled(&db, on).map_err(|e| e.to_string())?;
  Ok(SmallerBackups { on, saved_bytes: crate::storage::smaller::saved_bytes(&db) })
}

/// Runs whichever transports are configured, as the library's owner allows
/// (`run_sync`). `manual`: the reader asked (Sync now), so Drive is tried
/// even while a disabled client is being left alone (`drive::paused`).
#[tauri::command]
pub async fn sync_now(app: AppHandle, manual: Option<bool>, state: State<'_, AppState>) -> Result<SyncReport, String> {
  let result = run_sync(&state, manual.unwrap_or(false)).await;
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
      // A store that fails is noted and the next one still runs (sync audit
      // W6): a folder that is not there must not keep Drive from syncing.
      let mut store_error: Option<String> = None;
      for carrier in carriers {
        let transport = carrier.transport();
        let (local, there) = {
          let db = db_mutex.guard();
          // An account deleted here owns nothing (sync audit W3).
          (owner::get(&db), owner::live(&db, carrier.store_owner()))
        };
        let mut step = step_for(who.mode(local.as_deref(), there.as_deref()));
        let mut newer = false;
        if step.state {
          let run = match carrier.sync_state(db_mutex, now, &who).await {
            Ok(run) => run,
            // Its files wait for a run whose state half went through.
            Err(error) => {
              store_error.get_or_insert_with(|| fail(error));
              continue;
            }
          };
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
          match carrier.sync_files(db_mutex, step.may_delete).await {
            Ok(files) => report.merge_in(files),
            Err(error) => {
              store_error.get_or_insert_with(|| fail(error));
            }
          }
        }
      }
      match (refused, store_error) {
        (Some(message), _) | (None, Some(message)) => Err(message),
        (None, None) => Ok(report)
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
      // (b) Each store's state, as what it holds allows. A store that fails
      // is noted and the run goes on (sync audit W6): what the others
      // brought still reaches the account in (c), the claim in (d) is still
      // made, and the other stores' files still move in (e). The failure is
      // the run's answer at the end, after the account's own.
      let mut store_error: Option<String> = None;
      let mut brought_news = false;
      let mut files: Vec<(usize, bool)> = Vec::new();
      for (index, carrier) in carriers.iter().enumerate() {
        let transport = carrier.transport();
        let (local, there, answer) = {
          let db = db_mutex.guard();
          (owner::get(&db), owner::live(&db, carrier.store_owner()), owner::claim_answer(&db, transport))
        };
        let mut mode = who.mode(local.as_deref(), there.as_deref());
        // A library from before owners the reader chose to keep apart: this
        // library's files go there, its reading is left as it is.
        if mode == StoreMode::Claim && answer == Some(false) {
          mode = StoreMode::FilesOnly;
        }
        let mut step = step_for(mode);
        let mut newer = false;
        if step.state {
          let run = match carrier.sync_state(db_mutex, now, &who.answered(answer)).await {
            Ok(run) => run,
            // Its files wait for a run whose state half went through.
            Err(error) => {
              store_error.get_or_insert_with(|| fail(error));
              continue;
            }
          };
          // A library from before owners: nothing is taken from it, nothing
          // of this one's goes there, until the reader says (sync audit W1).
          if let Some(books) = run.asks {
            report.store_holds.get_or_insert(SyncStoreHolds { transport, books });
            continue;
          }
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
        match carriers[index].sync_files(db_mutex, may_delete).await {
          Ok(moved) => report.merge_in(moved),
          Err(error) => {
            store_error.get_or_insert_with(|| fail(error));
          }
        }
      }
      // (g) The account's failure, now that the stores have had their turn;
      // else the first store's.
      match cloud_error.or(store_error) {
        Some(error) => Err(error),
        None => Ok(report)
      }
    }
  }
}

/// How a run ends once Drive could not be opened (`drive_error`).
///
/// Signed in, the account carries the reading: when it synced and Google
/// refuses only Leaflet's client or the reader's grant, the run succeeded,
/// and says so with `drive_unavailable`. Anything else of Drive's, and every
/// Drive failure signed out (where Drive is a carrier of the reading), stays
/// an error.
pub(crate) fn settle(plan: Plan, result: Result<SyncReport, String>, drive_error: Option<anyhow::Error>) -> Result<SyncReport, String> {
  let mut report = result?;
  let Some(error) = drive_error else {
    return Ok(report);
  };
  match (plan, drive::unavailable(&error)) {
    (Plan::SignedIn { .. }, Some(kind)) => {
      report.drive_unavailable = Some(kind);
      Ok(report)
    }
    _ => Err(error.to_string())
  }
}

/// Opens Drive for a run, or says why not. An automatic run (not `manual`)
/// leaves a disabled client alone for a while (`drive::paused`) rather than
/// asking Google again at every book closed; what Google refused is noted
/// for the status, and cleared once Drive answers.
async fn open_drive(db_mutex: &std::sync::Mutex<db::Database>, manual: bool) -> Result<drive::DriveCtx, anyhow::Error> {
  let now = chrono::Utc::now();
  if let Some(error) = drive_left_alone(&db_mutex.guard(), manual, now) {
    return Err(error);
  }
  let opened = drive::open(db_mutex).await;
  let db = db_mutex.guard();
  match &opened {
    Ok(_) => drive::clear_unavailable(&db)?,
    Err(error) => {
      if let Some(kind) = drive::unavailable(error) {
        drive::note_unavailable(&db, kind, now)?;
      }
    }
  }
  opened
}

/// Drive is not asked this run: it is automatic, and Google disabled the
/// client less than `drive::CLIENT_DISABLED_PAUSE_HOURS` ago. The error is
/// the one Google gave then.
fn drive_left_alone(db: &db::Database, manual: bool, now: chrono::DateTime<chrono::Utc>) -> Option<anyhow::Error> {
  (!manual && drive::paused(db, now)).then(|| drive::DriveAuthError(drive::DriveUnavailable::ClientDisabled).into())
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
pub(crate) async fn run_sync(state: &State<'_, AppState>, manual: bool) -> Result<SyncReport, String> {
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
  // failure is reported once the others have run (`settle`).
  let mut drive_error = None;
  let drive_ctx = if drive_connected {
    match open_drive(&state.db, manual).await {
      Ok(ctx) => Some(ctx),
      Err(error) => {
        drive_error = Some(error);
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
  let report = settle(plan, report, drive_error)?;
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
  sync_now(app, None, state).await
}

/// The reader's answer for a Drive or sync folder that holds a library from
/// before owners (`SyncReport::store_holds`): bring it into this library
/// (`use_it`), which claims it for the account; or keep it apart, which
/// leaves its reading as it is and uses it for this library's book files
/// only. Kept until the Drive is disconnected or the folder changed. Then a
/// sync.
#[tauri::command]
pub async fn library_store_answer(transport: Transport, use_it: bool, app: AppHandle, state: State<'_, AppState>) -> Result<SyncReport, String> {
  {
    let _running = state.sync_lock.lock().await;
    let db = state.db.guard();
    owner::set_claim_answer(&db, transport, Some(use_it)).map_err(|e| e.to_string())?;
  }
  sync_now(app, None, state).await
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
    assert!(no_file_message(true).contains("Connect the Google Drive"));
    assert!(no_file_message(true).contains("add the same file again"));
    assert!(!no_file_message(true).contains("computer"), "a phone is not a computer");
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
    // It holds a library from before owners: asked first (sync audit W1).
    // The account syncs; nothing of the Drive's is taken, nor its files touched.
    let asked = laptop.run("2026-10-14T19:59:00+00:00", Some(A), Some(&cloud), &[&drive]).await.expect("sync");
    assert_eq!(asked.store_holds, Some(SyncStoreHolds { transport: Transport::Drive, books: 1 }));
    assert_eq!(laptop.books(), vec!["aaa".to_string()]);
    assert_eq!(drive.drive.mark(), None);
    assert_eq!(drive.deletes(), Vec::<bool>::new());
    assert_eq!(cloud.pushes(), 1);
    // "Use it".
    owner::set_claim_answer(&laptop.db.guard(), Transport::Drive, Some(true)).expect("answered");
    laptop.run("2026-10-14T20:00:00+00:00", Some(A), Some(&cloud), &[&drive]).await.expect("sync");
    assert_eq!(cloud.pushes(), 2, "then what Drive brought");
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

  /// A store that cannot be reached: a sync folder on a drive that is not
  /// plugged in, say. Its state half fails, or (`files_fail`) only its files.
  struct FailingFolder {
    files_fail: bool
  }

  const FOLDER_GONE: &str = "The sync folder could not be read.";

  impl Carrier for FailingFolder {
    fn transport(&self) -> Transport {
      Transport::Folder
    }

    fn store_owner(&self) -> Option<String> {
      None
    }

    fn sync_state<'a>(&'a self, _db_mutex: &'a Mutex<db::Database>, _now: &'a str, _who: &'a Who) -> Pending<'a, StateRun> {
      Box::pin(async move {
        if self.files_fail {
          Ok(StateRun::default())
        } else {
          Err(anyhow::anyhow!(FOLDER_GONE))
        }
      })
    }

    fn sync_files<'a>(&'a self, _db_mutex: &'a Mutex<db::Database>, _may_delete: bool) -> Pending<'a, SyncReport> {
      Box::pin(async move { Err(anyhow::anyhow!(FOLDER_GONE)) })
    }
  }

  /// Sync audit W6: a folder whose state failed used to end the run there
  /// (`?`), so Drive never ran, what it would have brought never reached the
  /// account, and its files never moved.
  #[tokio::test]
  async fn a_store_that_fails_lets_the_others_run_and_their_news_reach_the_account() {
    let drive = FakeDriveCarrier::default();
    // The phone, signed out, keeps the account's Drive in step (the bridge).
    let phone = Device::owned_by(A);
    phone.add("ppp");
    phone.run("2026-10-14T08:00:00+00:00", None, None, &[&drive]).await.expect("the phone's Drive");

    for files_fail in [false, true] {
      let (laptop, cloud) = (Device::owned_by(A), FakeCloud::default());
      let folder = FailingFolder { files_fail };
      let error = laptop.run("2026-10-14T09:00:00+00:00", Some(A), Some(&cloud), &[&folder, &drive]).await.expect_err("the folder failed");
      assert_eq!(error, FOLDER_GONE);
      assert_eq!(laptop.books(), vec!["ppp".to_string()], "Drive still ran");
      assert!(cloud.doc().expect("pushed").books.iter().any(|book| book.id == "ppp"), "and what it brought reached the account");
      assert_eq!(drive.deletes().last(), Some(&true), "and its files moved");
    }

    // Signed out, the same.
    let tablet = Device::owned_by(A);
    let before = drive.deletes().len();
    let error = tablet.run("2026-10-14T10:00:00+00:00", None, None, &[&FailingFolder { files_fail: false }, &drive]).await.expect_err("failed");
    assert_eq!(error, FOLDER_GONE);
    assert_eq!(tablet.books(), vec!["ppp".to_string()]);
    assert_eq!(drive.deletes().len(), before + 1);
  }

  /// The owner's Drive client, 2026-10-22: Google disabled it ("Error 401:
  /// disabled_client"), and every run read "Couldn't sync since ...",
  /// though the account had synced the reading each time. Signed in, a run
  /// whose account synced is a success that says Drive is unavailable.
  #[tokio::test]
  async fn signed_in_a_disabled_drive_client_leaves_the_run_synced_and_says_so() {
    use crate::sync::drive::{DriveAuthError, DriveUnavailable};
    let (laptop, cloud) = (Device::owned_by(A), FakeCloud::default());
    laptop.read(DAY, 10.0);
    let plan = Plan::SignedIn { adopting: false };
    // `run_sync` with Drive connected and `drive::open` refused: no Drive carrier.
    let run = laptop.run("2026-10-22T09:00:00+00:00", Some(A), Some(&cloud), &[]).await;
    let report = settle(plan, run, Some(DriveAuthError(DriveUnavailable::ClientDisabled).into())).expect("synced");
    assert_eq!(report.drive_unavailable, Some(DriveUnavailable::ClientDisabled));
    assert_eq!(cloud.doc().expect("the account holds the reading").days.len(), 1);

    let run = laptop.run("2026-10-22T09:01:00+00:00", Some(A), Some(&cloud), &[]).await;
    let report = settle(plan, run, Some(DriveAuthError(DriveUnavailable::Reconnect).into())).expect("synced");
    assert_eq!(report.drive_unavailable, Some(DriveUnavailable::Reconnect));

    // Drive failing otherwise (offline) is still a failure.
    let run = laptop.run("2026-10-22T09:02:00+00:00", Some(A), Some(&cloud), &[]).await;
    let error = settle(plan, run, Some(anyhow::anyhow!("Could not reach Drive: timed out"))).expect_err("offline");
    assert!(error.contains("Could not reach Drive"), "{error}");

    // And the account failing is the run failing, whatever Drive did.
    let failing = FakeCloud::failing();
    let run = laptop.run("2026-10-22T09:03:00+00:00", Some(A), Some(&failing), &[]).await;
    assert!(settle(plan, run, Some(DriveAuthError(DriveUnavailable::ClientDisabled).into())).is_err());

    // With Drive fine, nothing is flagged.
    let run = laptop.run("2026-10-22T09:04:00+00:00", Some(A), Some(&cloud), &[]).await;
    assert_eq!(settle(plan, run, None).expect("synced").drive_unavailable, None);
  }

  /// Signed out, Drive carries the reading itself: a disabled client is a
  /// failed sync, in words that say what happened.
  #[tokio::test]
  async fn signed_out_a_disabled_drive_client_is_an_error() {
    use crate::sync::drive::{DriveAuthError, DriveUnavailable};
    // A sync folder beside Drive syncs; Drive's refusal still fails the run.
    let root = std::env::temp_dir().join("leaflet-backup-test-drive-disabled");
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("dir");
    let folder = FolderCarrier::at(root.to_str().expect("path"));
    let phone = Device::new();
    phone.read(DAY, 10.0);
    let run = phone.run("2026-10-22T09:00:00+00:00", None, None, &[&folder]).await;
    assert!(run.is_ok(), "the folder synced: {run:?}");
    let error = settle(Plan::SignedOut, run, Some(DriveAuthError(DriveUnavailable::ClientDisabled).into())).expect_err("signed out");
    assert_eq!(error, "Google Drive is unavailable right now.");
    let error = settle(Plan::SignedOut, Ok(SyncReport::default()), Some(DriveAuthError(DriveUnavailable::Reconnect).into())).expect_err("signed out");
    assert!(error.contains("Reconnect Google Drive"), "{error}");
    let _ = std::fs::remove_dir_all(&root);
  }

  /// An automatic run leaves a disabled client alone for six hours; one the
  /// reader asks for (Sync now) tries Google again (`open_drive`).
  #[test]
  fn automatic_runs_leave_a_disabled_drive_client_alone() {
    use crate::sync::drive::{self, DriveUnavailable};
    let db = memory_db();
    let at = chrono::DateTime::parse_from_rfc3339("2026-10-22T09:00:00+00:00").unwrap().with_timezone(&chrono::Utc);
    assert!(drive_left_alone(&db, false, at).is_none(), "nothing refused yet");
    drive::note_unavailable(&db, DriveUnavailable::ClientDisabled, at).expect("noted");
    let error = drive_left_alone(&db, false, at + chrono::Duration::hours(1)).expect("left alone");
    assert_eq!(drive::unavailable(&error), Some(DriveUnavailable::ClientDisabled));
    assert!(drive_left_alone(&db, true, at + chrono::Duration::hours(1)).is_none(), "Sync now still tries");
    assert!(drive_left_alone(&db, false, at + chrono::Duration::hours(6)).is_none(), "and after six hours, any run");
    // A reconnect is not waited out: it is the reader's to fix.
    drive::note_unavailable(&db, DriveUnavailable::Reconnect, at).expect("noted");
    assert!(drive_left_alone(&db, false, at).is_none());
  }

  /// The owner's laptop, from 2026-10-20: every run ended "Another device is
  /// syncing right now", with no other device syncing. A day's minutes are a
  /// sum of fractions (9.748933333333333 on 29 September); JSON read back
  /// from Drive's `state.json` gave 9.748933333333332, a step short, so the
  /// check after the write never found what was sent, and the round ran four
  /// times and gave up. (The account had synced first; it was only sent the
  /// same document again at every sync, for the same reason.)
  #[tokio::test]
  async fn minutes_that_json_does_not_write_round_still_sync_with_drive_once() {
    let (laptop, cloud, drive) = (Device::owned_by(A), FakeCloud::default(), FakeDriveCarrier::default());
    laptop.read("2026-09-29", 9.748933333333333);
    laptop.run("2026-10-21T11:21:41+00:00", Some(A), Some(&cloud), &[&drive]).await.expect("a run with Drive bridged");
    assert_eq!((drive.drive.writes(), drive.drive.conflicts()), (1, 0));
    assert_eq!(cloud.pushes(), 1);
    assert_eq!(drive.drive.doc().expect("bridged").days[0].minutes, 9.748933333333333);

    // Nothing read since: neither is sent anything.
    laptop.run("2026-10-21T11:30:00+00:00", Some(A), Some(&cloud), &[&drive]).await.expect("again");
    assert_eq!(drive.drive.writes(), 1, "nothing new for Drive");
    assert_eq!(cloud.pushes(), 1, "nor for the account");
  }

  /// A run whose write to the account loses one race (the phone wrote
  /// between this device's read and its write) merges over the phone's and
  /// succeeds: both devices' reading is on the account and here.
  #[tokio::test]
  async fn an_account_sync_that_loses_one_race_merges_again_and_succeeds() {
    let (laptop, phone, cloud) = (Device::owned_by(A), Device::owned_by(A), FakeCloud::default());
    laptop.read(DAY, 10.0);
    laptop.run("2026-10-14T09:00:00+00:00", Some(A), Some(&cloud), &[]).await.expect("first");
    phone.read(DAY, 25.0);
    let theirs = {
      let local = crate::sync::store::snapshot(&phone.db.guard(), "2026-10-14T09:05:00+00:00").expect("snapshot");
      crate::sync::merge::merge(&local, &cloud.doc().expect("held"), "2026-10-14T09:05:00+00:00")
    };
    cloud.sneak_in(&theirs);
    laptop.read(DAY, 5.0);
    laptop.run("2026-10-14T09:06:00+00:00", Some(A), Some(&cloud), &[]).await.expect("one lost race, then kept");
    assert_eq!(laptop.minutes(DAY), 40.0, "the laptop's 15 and the phone's 25");
    assert_eq!(cloud.doc().expect("held").days[0].minutes, 40.0);
  }

  /// The owner's book on 2026-10-21. The phone had read on past 70 % (72
  /// here) and the account carried it to the laptop; the laptop opened the
  /// book at its own older 54 % and saved that as the newest place, and the
  /// account was sent back to it. Opening at this device's own place is
  /// right (the phone's is offered, not taken), but standing there is not a
  /// move: only reading on from it is.
  #[tokio::test]
  async fn a_device_opening_at_its_own_older_place_never_drags_the_other_back() {
    let (laptop, phone, cloud) = (Device::owned_by(A), Device::owned_by(A), FakeCloud::default());
    let (at54, at55, at72) = ("epubcfi(/6/178!/4/2/2/4/1:287)", "epubcfi(/6/178!/4/2/2/30/1:0)", "epubcfi(/6/230!/4/2/1:0)");
    let place = |device: &Device, progress: f32, cfi: Option<&str>| {
      device.db.guard().update_progress("well", progress, Some(db::now_iso()), cfi.map(str::to_string)).expect("a save");
    };
    let agreed = |device: &Device| {
      let book = device.db.guard().find_by_id("well").expect("query").expect("listed");
      (book.progress, book.position)
    };
    laptop.add("well");
    place(&laptop, 0.54, Some(at54));
    laptop.run("2026-10-19T09:41:29+00:00", Some(A), Some(&cloud), &[]).await.expect("laptop");
    phone.run("2026-10-19T10:00:00+00:00", Some(A), Some(&cloud), &[]).await.expect("phone takes the book in");
    place(&phone, 0.72, Some(at72));
    phone.run("2026-10-21T10:00:00+00:00", Some(A), Some(&cloud), &[]).await.expect("phone");
    laptop.run("2026-10-21T11:17:00+00:00", Some(A), Some(&cloud), &[]).await.expect("laptop takes the phone's place in");
    assert_eq!(agreed(&laptop), (0.72, Some(at72.to_string())));

    // The laptop opens at its own place: the open (no position), then the
    // reader's first saves of where it stands, then closing unread.
    place(&laptop, 0.54, None);
    place(&laptop, 0.54, Some(at54));
    place(&laptop, 0.54, None);
    assert_eq!(agreed(&laptop), (0.72, Some(at72.to_string())), "the agreed place is not moved by standing still");
    assert_eq!(laptop.db.guard().place_here("well").expect("place"), Some((0.54, Some(at54.to_string()))));
    laptop.run("2026-10-21T11:21:41+00:00", Some(A), Some(&cloud), &[]).await.expect("laptop");
    phone.run("2026-10-21T11:30:00+00:00", Some(A), Some(&cloud), &[]).await.expect("phone");
    let on_account = cloud.doc().expect("held").books.into_iter().find(|book| book.id == "well").expect("the book");
    assert_eq!(on_account.progress, 0.72);
    assert_eq!(agreed(&phone), (0.72, Some(at72.to_string())), "the phone keeps its place");

    // Reading on from the laptop's own place is the reader's choice, and is a move.
    place(&laptop, 0.55, Some(at55));
    laptop.run("2026-10-21T12:00:00+00:00", Some(A), Some(&cloud), &[]).await.expect("laptop read on");
    assert_eq!(agreed(&laptop), (0.55, Some(at55.to_string())));
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
    // (Y's reader has said to bring the Drive's library in.)
    owner::set_claim_answer(&y.db.guard(), Transport::Drive, Some(true)).expect("answered");
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

  /// "Keep it apart": a Drive from before owners the reader chose not to
  /// bring in carries this library's book files, and its reading is left
  /// as it is, never asked about again until the Drive is disconnected.
  #[tokio::test]
  async fn a_drive_kept_apart_carries_files_only_and_is_not_asked_again() {
    let drive = FakeDriveCarrier::default();
    let family = Device::new();
    family.add("theirs");
    crate::sync::shared_doc::sync(&family.db, &drive.drive, "2026-10-13T09:00:00+00:00", &Who::signed_out()).await.expect("seed");
    let before = drive.drive.raw();

    let (laptop, cloud) = (Device::new(), FakeCloud::default());
    laptop.add("mine");
    owner::set_claim_answer(&laptop.db.guard(), Transport::Drive, Some(false)).expect("kept apart");
    for at in ["2026-10-14T20:00:00+00:00", "2026-10-14T21:00:00+00:00"] {
      let report = laptop.run(at, Some(A), Some(&cloud), &[&drive]).await.expect("sync");
      assert_eq!(report.store_holds, None);
    }
    assert_eq!(drive.drive.raw(), before, "its reading untouched");
    assert_eq!(laptop.books(), vec!["mine".to_string()]);
    assert_eq!(drive.deletes(), vec![false, false], "files, and never a removal");
    assert!(owner::files_only(&laptop.db.guard(), Transport::Drive));
    forget_store(&laptop.db.guard(), Transport::Drive).expect("disconnected");
    assert_eq!(owner::claim_answer(&laptop.db.guard(), Transport::Drive), None);
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
    assert_eq!(held.live_books().map(|b| b.id.as_str()).collect::<Vec<_>>(), vec!["new"]);
    // With the old library's books as removals, so a device that still has
    // them does not bring them back (sync audit W2).
    let mut removed: Vec<&str> = held.books.iter().filter(|b| b.is_deleted()).map(|b| b.id.as_str()).collect();
    removed.sort();
    assert_eq!(removed, vec!["old1", "old2"]);
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
/// the reading, never the files: the files come by the Google Drive (or the
/// folder) the other device backs up to, so that is the way on, or the file
/// itself added again. (The app offers to connect Drive before it gets here;
/// this is what is said where it cannot, and it says "device": it was
/// "computer" on a phone too.)
pub(crate) fn no_file_message(account_backup: bool) -> &'static str {
  if account_backup {
    "That book's file isn't on this device yet. Connect the Google Drive your other device backs up to, or add the same file again, and your place will be waiting."
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
  pub position: Option<String>,
  /// When this device stood there (ISO); a books row unchanged since is not another device's place.
  pub at: Option<String>
}

/// The reader opens a book here, and offers the other device's place when it
/// differs ("Your other device is further on"). Nothing when the book was
/// never read on this device: then the agreed place is the only one.
#[tauri::command]
pub fn place_here(book_id: String, state: State<'_, AppState>) -> Result<Option<PlaceHere>, String> {
  let db = state.db.guard();
  Ok(
    db.place_here_at(&book_id)
      .map_err(|e| e.to_string())?
      .map(|(progress, position, at)| PlaceHere { progress, position, at })
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
