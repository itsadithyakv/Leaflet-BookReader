use anyhow::Result;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
#[cfg(desktop)]
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
#[cfg(desktop)]
use regex::Regex;

pub mod epub;
pub mod library_copy;
pub mod mobi;
pub mod pdf;
#[cfg(test)]
mod library_probe;

#[cfg(desktop)]
static CONVERTER_INSTALL_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// What a book's file says about itself, as written: `metadata::normalize`
/// makes a title and an author a person would recognise out of it.
#[derive(Debug, Default)]
pub struct BasicMetadata {
  pub title: Option<String>,
  /// Everyone credited as a writer, one entry a credit.
  pub authors: Vec<String>,
  pub subjects: Vec<String>,
  pub series: Option<String>,
  pub series_index: Option<f32>,
  /// The title and authors are the word of whatever program made the file (a
  /// PDF's Info), which is as often "Microsoft Word - draft3.doc" and
  /// "Administrator" as a book and its writer. `metadata::normalize` weighs
  /// them against the file's name before it believes them.
  pub doubtful: bool
}

/// The Kindle family: one container (`storage/mobi.rs`) under several names.
fn is_kindle(ext: &str) -> bool {
  matches!(ext, "mobi" | "azw" | "azw3" | "azw4" | "prc")
}

/// Whether this is a Kindle book Leaflet reads without Calibre
/// (`convert/mobi.rs`): the older kind, not locked. Its header says.
pub fn reads_kindle_itself(source: &Path) -> bool {
  is_kindle(&normalized_ext(source)) && crate::convert::mobi::can_read(source).is_ok()
}

/// Where the library lives, set once at startup from Tauri's path resolver.
static APP_DATA_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Records the platform's own data directory.
///
/// `dirs::data_dir()` has no meaningful answer on Android — it resolves through
/// XDG rules to a path the app cannot write — so the database and the book
/// files have to come from the host instead. Called during setup, before
/// anything opens the database.
pub fn set_app_data_dir(path: PathBuf) {
  let _ = APP_DATA_DIR.set(path);
}

pub fn app_data_dir() -> Result<PathBuf> {
  if let Some(path) = APP_DATA_DIR.get() {
    return Ok(path.clone());
  }
  // The fallback keeps desktop behaviour identical and lets the tests run
  // without a Tauri app around them.
  let base = dirs::data_dir().ok_or_else(|| anyhow::anyhow!("missing app data dir"))?;
  Ok(base.join("leaflet"))
}

pub fn books_dir() -> Result<PathBuf> {
  Ok(app_data_dir()?.join("books"))
}

pub fn covers_dir() -> Result<PathBuf> {
  Ok(app_data_dir()?.join("covers"))
}

pub fn hash_file(path: &Path) -> Result<String> {
  let mut file = fs::File::open(path)?;
  let mut hasher = Sha256::new();
  let mut buffer = [0u8; 8192];
  loop {
    let n = file.read(&mut buffer)?;
    if n == 0 {
      break;
    }
    hasher.update(&buffer[..n]);
  }
  Ok(hex::encode(hasher.finalize()))
}

/// The hash of a file about to be imported, after checking there is a book to
/// hash. Every empty file has the same hash, so the first one imported became
/// a book that could never open, and every later empty file, of any format,
/// was taken for that book.
pub fn hash_for_import(path: &Path) -> Result<String> {
  let metadata = fs::metadata(path).map_err(|error| anyhow::anyhow!(describe_read_failure(&error)))?;
  if metadata.is_dir() {
    anyhow::bail!("That is a folder, not a book file.");
  }
  if metadata.len() == 0 {
    anyhow::bail!("That file is empty (0 bytes), so there is nothing to read. If you downloaded it, the download may not have finished.");
  }
  check_kind(path)?;
  hash_file(path).map_err(|error| match error.downcast::<std::io::Error>() {
    Ok(error) => anyhow::anyhow!(describe_read_failure(&error)),
    Err(other) => other
  })
}

/// Why a file could not be read, in the reader's words. The system's own
/// ("The process cannot access the file because it is being used by another
/// process. (os error 32)") used to be shown as it came.
fn describe_read_failure(error: &std::io::Error) -> String {
  // Windows: 32 a sharing violation, 33 a lock on part of the file.
  let in_use = cfg!(windows) && matches!(error.raw_os_error(), Some(32) | Some(33));
  if in_use {
    return "That file is open in another program, which is keeping it to itself. Close it there (or wait for the download to finish) and add it again.".to_string();
  }
  match error.kind() {
    std::io::ErrorKind::NotFound => "That file is no longer there: it was moved, renamed or deleted after it was picked.".to_string(),
    std::io::ErrorKind::PermissionDenied => "Leaflet is not allowed to read that file. Copy it somewhere of your own (Documents, say) and add it from there.".to_string(),
    _ => format!("That file could not be read: {error}")
  }
}

/// What the first bytes of a file say it is, where they say anything.
fn looks_like(head: &[u8]) -> Option<&'static str> {
  let window = &head[..head.len().min(1024)];
  if head.starts_with(b"PK\x03\x04") || head.starts_with(b"PK\x05\x06") {
    Some("zip")
  } else if window.windows(5).any(|bytes| bytes == b"%PDF-") {
    Some("pdf")
  } else if head.get(60..68) == Some(b"BOOKMOBI".as_slice()) {
    Some("mobi")
  } else if head.starts_with(b"Rar!") {
    Some("rar")
  } else {
    let text = String::from_utf8_lossy(window).to_ascii_lowercase();
    (text.contains("<!doctype html") || text.contains("<html")).then_some("html")
  }
}

/// Refuses a file that is not what its name says, for the formats where the
/// first bytes settle it: an EPUB and a CBZ are zip archives, a PDF says so.
/// Such a file used to come in as a book that could then never be opened (a
/// web page saved as `book.epub` when a download link led to a sign-in page
/// is the usual one).
fn check_kind(path: &Path) -> Result<()> {
  let ext = normalized_ext(path);
  let wanted = match ext.as_str() {
    "epub" | "cbz" => "zip",
    "pdf" => "pdf",
    _ => return Ok(())
  };
  let mut head = Vec::with_capacity(1024);
  fs::File::open(path)
    .and_then(|file| file.take(1024).read_to_end(&mut head))
    .map_err(|error| anyhow::anyhow!(describe_read_failure(&error)))?;
  let found = looks_like(&head);
  if found == Some(wanted) {
    return Ok(());
  }
  let label = ext.to_uppercase();
  let article = if label.starts_with('E') { "an" } else { "a" };
  let really = match found {
    Some("pdf") => " It is a PDF: rename it to end in .pdf and add it again.",
    Some("zip") if ext == "pdf" => " It is a zip archive (an EPUB, perhaps): check what it should be called.",
    Some("mobi") => " It is a Kindle book: rename it to end in .mobi and add it again.",
    Some("html") => " It is a web page, which is what a download that needed signing in leaves behind: download the book again.",
    Some("rar") => " It is a RAR archive: unpack it first.",
    _ => " It may be damaged, or the download may not have finished."
  };
  anyhow::bail!("That file is named .{ext} but it is not {article} {label}.{really}")
}

/// One book file is put in place at a time. Two imports of the same file at
/// once (a second double-click while a large book is still being copied) wrote
/// to the same staging file, and Windows failed one of them with "the file is
/// being used by another process" although the book came in.
static STORING: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn store_book_file(source: &Path, hash: &str) -> Result<PathBuf> {
  store_book_file_in(&books_dir()?, source, hash)
}

/// `store_book_file` against an explicit folder, so it can be exercised
/// without touching the real library.
fn store_book_file_in(dir: &Path, source: &Path, hash: &str) -> Result<PathBuf> {
  let ext = normalized_ext(source);
  let ext = if ext.is_empty() { "bin".to_string() } else { ext };
  fs::create_dir_all(dir)?;
  let dest = dir.join(format!("{}.{}", hash, ext));
  let _one_at_a_time = STORING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  if !dest.exists() {
    // Through a staging file: an interrupted copy straight to `dest` left a
    // truncated book that the `exists()` check above then trusted forever.
    let staging = dir.join(format!("{}.{}.part", hash, ext));
    // One left by an interrupted import. A copy keeps the original's
    // read-only mark, and a read-only leftover cannot be written over.
    let _ = fs::remove_file(&staging);
    if let Err(error) = fs::copy(source, &staging) {
      let _ = fs::remove_file(&staging);
      return Err(error.into());
    }
    if let Err(error) = fs::rename(&staging, &dest) {
      let _ = fs::remove_file(&staging);
      return Err(error.into());
    }
  }
  Ok(dest)
}

/// Puts a book's bytes back where the library expects them.
///
/// For a book the library lists but has no file for (it came from a backup and
/// was never downloaded, or its file was removed by hand). `source` has the
/// same content hash, so it is the same book whatever it is called.
pub fn restore_book_file(source: &Path, dest: &Path) -> Result<()> {
  // The same staging file as an import of this book would use.
  let _one_at_a_time = STORING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  if dest.exists() {
    return Ok(());
  }
  if let Some(parent) = dest.parent() {
    fs::create_dir_all(parent)?;
  }
  let mut staging = dest.as_os_str().to_owned();
  staging.push(".part");
  let staging = PathBuf::from(staging);
  let _ = fs::remove_file(&staging);
  if let Err(error) = fs::copy(source, &staging) {
    let _ = fs::remove_file(&staging);
    return Err(error.into());
  }
  if let Err(error) = fs::rename(&staging, dest) {
    let _ = fs::remove_file(&staging);
    return Err(error.into());
  }
  Ok(())
}

pub fn converted_epub_path(hash: &str) -> Result<PathBuf> {
  Ok(books_dir()?.join(format!("{}.epub", hash)))
}

fn normalized_ext(path: &Path) -> String {
  path.extension()
    .and_then(|v| v.to_str())
    .unwrap_or("")
    .to_lowercase()
}

// ---- external converter (desktop only) ------------------------------------
//
// Everything below finds, downloads or drives a Calibre install. A phone can do
// none of that -- there is no Calibre for Android, and offering to fetch a
// Windows portable build would be nonsense -- so it is compiled out entirely
// rather than shipped as unreachable code.
#[cfg(desktop)]
fn converter_filename() -> &'static str {
  #[cfg(target_os = "windows")]
  {
    "ebook-convert.exe"
  }
  #[cfg(not(target_os = "windows"))]
  {
    "ebook-convert"
  }
}

/// Well-known locations of a normal Calibre installation. Without these the app
/// would ask a user who already has Calibre to download a second ~200 MB copy,
/// and would refuse to convert at all on macOS/Linux.
#[cfg(desktop)]
fn system_converter_candidates() -> Vec<PathBuf> {
  let mut candidates = Vec::new();

  // Anything on PATH wins: it is what the user's own shell would run.
  if let Some(paths) = std::env::var_os("PATH") {
    for dir in std::env::split_paths(&paths) {
      candidates.push(dir.join(converter_filename()));
    }
  }

  #[cfg(target_os = "windows")]
  {
    for root in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
      if let Some(base) = std::env::var_os(root) {
        let base = PathBuf::from(base);
        candidates.push(base.join("Calibre2").join(converter_filename()));
        candidates.push(base.join("Calibre").join(converter_filename()));
      }
    }
  }

  #[cfg(target_os = "macos")]
  {
    candidates.push(PathBuf::from(
      "/Applications/calibre.app/Contents/MacOS/ebook-convert"
    ));
    if let Some(home) = dirs::home_dir() {
      candidates.push(home.join("Applications/calibre.app/Contents/MacOS/ebook-convert"));
    }
  }

  #[cfg(target_os = "linux")]
  {
    for base in ["/usr/bin", "/usr/local/bin", "/opt/calibre", "/snap/bin"] {
      candidates.push(PathBuf::from(base).join(converter_filename()));
    }
  }

  candidates
}

#[cfg(desktop)]
fn converter_candidates(app: Option<&AppHandle>) -> Vec<PathBuf> {
  let mut candidates = Vec::new();

  if let Some(handle) = app {
    if let Ok(resource_dir) = handle.path().resource_dir() {
      candidates.push(resource_dir.join("resources").join("converters").join(converter_filename()));
      candidates.push(
        resource_dir
          .join("resources")
          .join("converters")
          .join("calibre-portable")
          .join("Calibre")
          .join(converter_filename())
      );
      candidates.push(resource_dir.join("converters").join(converter_filename()));
    }
    if let Ok(app_data) = handle.path().app_data_dir() {
      candidates.push(
        app_data
          .join("converters")
          .join("calibre-portable")
          .join("Calibre")
          .join(converter_filename())
      );
      candidates.push(app_data.join("converters").join(converter_filename()));
    }
  }

  // `cargo run` sets this; a packaged app never has it, and a release build
  // should not take an executable path from the environment.
  if let Some(manifest) = cfg!(debug_assertions)
    .then(|| std::env::var("CARGO_MANIFEST_DIR").ok())
    .flatten()
  {
    candidates.push(
      PathBuf::from(manifest)
        .join("resources")
        .join("converters")
        .join(converter_filename())
    );
  }

  candidates.extend(system_converter_candidates());
  candidates
}

#[cfg(desktop)]
fn resolve_converter_path(app: Option<&AppHandle>) -> Option<PathBuf> {
  let mut candidates = converter_candidates(app);

  if let Some(app_handle) = app {
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
      candidates.push(resource_dir.join("resources").join("converters"));
      candidates.push(resource_dir.join("converters"));
    }
  }

  // `cargo run` sets this; a packaged app never has it, and a release build
  // should not take an executable path from the environment.
  if let Some(manifest) = cfg!(debug_assertions)
    .then(|| std::env::var("CARGO_MANIFEST_DIR").ok())
    .flatten()
  {
    candidates.push(PathBuf::from(manifest).join("resources").join("converters"));
  }

  for path in candidates {
    if path.is_file() && path.exists() {
      return Some(path);
    }
    if path.is_dir() {
      if let Some(found) = find_in_dir(&path, converter_filename(), CONVERTER_SEARCH_DEPTH) {
        return Some(found);
      }
    }
  }

  None
}

/// Depth is capped so a symlink cycle inside a Calibre tree cannot hang startup;
/// the binary sits within a couple of levels of the install root in every layout
/// we look at.
const CONVERTER_SEARCH_DEPTH: usize = 4;

#[cfg(desktop)]
fn find_in_dir(root: &Path, filename: &str, depth: usize) -> Option<PathBuf> {
  if depth == 0 {
    return None;
  }
  let entries = std::fs::read_dir(root).ok()?;
  let mut directories = Vec::new();
  for entry in entries.flatten() {
    let path = entry.path();
    // `file_type` does not follow symlinks, so a self-referential link is never
    // descended into.
    let Ok(file_type) = entry.file_type() else {
      continue;
    };
    if file_type.is_file() {
      if let Some(name) = path.file_name().and_then(|v| v.to_str()) {
        if name.eq_ignore_ascii_case(filename) {
          return Some(path);
        }
      }
    } else if file_type.is_dir() {
      directories.push(path);
    }
  }
  for path in directories {
    if let Some(found) = find_in_dir(&path, filename, depth - 1) {
      return Some(found);
    }
  }
  None
}

#[cfg(desktop)]
fn converter_install_dir(app: &AppHandle) -> Result<PathBuf> {
  let base = app
    .path()
    .app_data_dir()
    .map_err(|_| anyhow::anyhow!("missing app data dir"))?;
  Ok(base.join("converters"))
}

pub fn converter_installed(app: &AppHandle) -> bool {
  converter_path(app).is_some()
}

/// Where the converter was found, so Settings can show that an existing Calibre
/// is being reused rather than implying a download is required.
pub fn converter_path(app: &AppHandle) -> Option<PathBuf> {
  #[cfg(desktop)]
  {
    resolve_converter_path(Some(app))
  }
  // Nothing to find: Settings then shows the converter as unavailable rather
  // than offering a download that could not work.
  #[cfg(not(desktop))]
  {
    let _ = app;
    None
  }
}

/// Microsoft Store builds never download and run Calibre's installer: Store
/// policy does not allow an app to fetch executable code. There Leaflet only
/// uses a Calibre the reader installed themselves. The MSIX script sets
/// `LEAFLET_STORE_BUILD`.
const STORE_BUILD: bool = option_env!("LEAFLET_STORE_BUILD").is_some();

/// Whether Leaflet can fetch Calibre itself on this platform. Elsewhere the user
/// installs it and Leaflet picks it up from PATH.
pub const fn can_auto_install_converter() -> bool {
  cfg!(all(desktop, target_os = "windows")) && !STORE_BUILD
}

#[cfg(desktop)]
pub async fn install_converter(app: &AppHandle) -> Result<PathBuf> {
  if STORE_BUILD {
    if let Some(existing) = resolve_converter_path(Some(app)) {
      return Ok(existing);
    }
    anyhow::bail!("Install Calibre from calibre-ebook.com, then open the book again: Leaflet finds it without a restart.");
  }
  let _install_guard = CONVERTER_INSTALL_LOCK.lock().await;
  if let Some(existing) = resolve_converter_path(Some(app)) {
    return Ok(existing);
  }

  let install_root = converter_install_dir(app)?.join("calibre-portable");
  fs::create_dir_all(&install_root)?;

  #[cfg(target_os = "windows")]
  {
    let installer_path = download_latest_portable_installer(&install_root).await?;
    let result = run_portable_installer(installer_path.clone(), install_root.clone()).await;
    let _ = fs::remove_file(&installer_path);
    result?;
    resolve_converter_path(Some(app))
      .ok_or_else(|| anyhow::anyhow!("calibre installed, but ebook-convert.exe was not found"))
  }

  #[cfg(not(target_os = "windows"))]
  Err(anyhow::anyhow!(
    "Leaflet can only download Calibre automatically on Windows. Install Calibre from calibre-ebook.com and Leaflet will detect it the next time you open the book."
  ))
}

#[cfg(target_os = "windows")]
async fn download_latest_portable_installer(install_root: &Path) -> Result<PathBuf> {
  let client = reqwest::Client::builder()
    .connect_timeout(Duration::from_secs(12))
    .timeout(Duration::from_secs(1200))
    .user_agent("Leaflet/0.1 converter bootstrap")
    .build()?;
  let page = client
    .get("https://calibre-ebook.com/download_portable")
    .send()
    .await?
    .error_for_status()?
    .text()
    .await?;

  let version_re = Regex::new(r"Version:\s*([0-9.]+)")?;
  let version = version_re
    .captures(&page)
    .and_then(|caps| caps.get(1))
    .map(|value| value.as_str().to_string())
    .ok_or_else(|| anyhow::anyhow!("unable to detect the current calibre version"))?;
  let installer_name = format!("calibre-portable-installer-{version}.exe");
  let installer_url = format!(
    "https://download.calibre-ebook.com/{version}/{installer_name}"
  );
  let installer_path = install_root.join(&installer_name);
  let download_result: Result<()> = async {
    let mut response = client
      .get(installer_url)
      .send()
      .await?
      .error_for_status()?;
    let mut installer_file = tokio::fs::File::create(&installer_path).await?;
    while let Some(chunk) = response.chunk().await? {
      installer_file.write_all(&chunk).await?;
    }
    installer_file.flush().await?;
    drop(installer_file);

    let installer_size = fs::metadata(&installer_path)?.len();
    let mut header = [0u8; 2];
    fs::File::open(&installer_path)?.read_exact(&mut header)?;
    if installer_size < 1_000_000 || header != [0x4d, 0x5a] {
      return Err(anyhow::anyhow!("the downloaded converter installer is incomplete"));
    }
    Ok(())
  }
  .await;

  if let Err(error) = download_result {
    let _ = fs::remove_file(&installer_path);
    return Err(error);
  }
  Ok(installer_path)
}

#[cfg(target_os = "windows")]
async fn run_portable_installer(installer: PathBuf, install_root: PathBuf) -> Result<()> {
  tauri::async_runtime::spawn_blocking(move || {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let status = Command::new(&installer)
      .arg(&install_root)
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .creation_flags(CREATE_NO_WINDOW)
      .status()?;

    if status.success() {
      Ok(())
    } else {
      Err(anyhow::anyhow!(
        "calibre portable installer exited with status {status}"
      ))
    }
  })
  .await
  .map_err(|error| anyhow::anyhow!("converter installer task failed: {error}"))?
}

/// Why a book could not be turned into something the reader can display.
#[derive(Debug)]
pub enum ConversionError {
  /// Calibre is not installed; the caller can offer to fetch it.
  ConverterMissing,
  /// The format is outside the supported table entirely.
  Unsupported(String),
  /// `ebook-convert` ran and refused. Carries its own explanation (DRM, a
  /// corrupt archive, an unreadable source) rather than a generic failure.
  Failed(String)
}

impl std::fmt::Display for ConversionError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      Self::ConverterMissing => write!(
        f,
        "This format needs the optional book converter. Install it from Settings to open the book."
      ),
      Self::Unsupported(ext) => write!(
        f,
        "Leaflet cannot open .{ext} files. Supported formats: {}.",
        crate::formats::summary()
      ),
      Self::Failed(reason) => write!(f, "{reason}")
    }
  }
}

#[cfg(desktop)]
const DRM_MESSAGE: &str = "This book is DRM-protected, so it cannot be converted. Open it in the app it was purchased from.";

/// Calibre is slow on large books but should never run forever; a hung process
/// used to leave the reader spinning with no way back.
const CONVERSION_TIMEOUT: Duration = Duration::from_secs(15 * 60);

#[cfg(desktop)]
fn drain(stream: Option<impl std::io::Read + Send + 'static>) -> std::thread::JoinHandle<Vec<u8>> {
  std::thread::spawn(move || {
    let mut buffer = Vec::new();
    if let Some(mut stream) = stream {
      let _ = stream.read_to_end(&mut buffer);
    }
    buffer
  })
}

#[cfg(desktop)]
fn run_converter(converter: &Path, source: &Path, target: &Path) -> Result<(), ConversionError> {
  let mut command = Command::new(converter);
  command
    .arg(source)
    .arg(target)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

  // The installer already does this; conversion was missing it, so every open of
  // a converted book flashed a console window.
  #[cfg(target_os = "windows")]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
  }

  let mut child = command
    .spawn()
    .map_err(|error| ConversionError::Failed(format!("Could not start the book converter: {error}")))?;

  // ebook-convert is chatty. Left unread, its pipes fill and the process blocks
  // forever mid-conversion, so both streams are drained on their own threads
  // rather than after the wait.
  let stdout = drain(child.stdout.take());
  let stderr = drain(child.stderr.take());

  let deadline = Instant::now() + CONVERSION_TIMEOUT;
  let status = loop {
    match child.try_wait() {
      Ok(Some(status)) => break status,
      Ok(None) => {
        if Instant::now() >= deadline {
          let _ = child.kill();
          let _ = child.wait();
          return Err(ConversionError::Failed(
            "The book converter timed out. The file may be very large or damaged.".to_string()
          ));
        }
        std::thread::sleep(Duration::from_millis(120));
      }
      Err(error) => {
        let _ = child.kill();
        return Err(ConversionError::Failed(format!(
          "Could not monitor the book converter: {error}"
        )));
      }
    }
  };

  if status.success() {
    return Ok(());
  }

  let stdout = stdout.join().unwrap_or_default();
  let stderr = stderr.join().unwrap_or_default();
  Err(ConversionError::Failed(describe_converter_failure(&stderr, &stdout)))
}

/// Turns Calibre's output into something a reader can act on. DRM in particular
/// used to surface as a generic "conversion failed".
#[cfg(desktop)]
fn describe_converter_failure(stderr: &[u8], stdout: &[u8]) -> String {
  let combined = format!(
    "{}\n{}",
    String::from_utf8_lossy(stderr),
    String::from_utf8_lossy(stdout)
  );
  let lowered = combined.to_lowercase();

  if lowered.contains("drm") {
    return DRM_MESSAGE.to_string();
  }
  if lowered.contains("no such file") || lowered.contains("does not exist") {
    return "The original book file is missing. Re-import it to read it again.".to_string();
  }

  let detail = combined
    .lines()
    .map(str::trim)
    .filter(|line| !line.is_empty())
    .rfind(|line| !line.starts_with("Traceback") && !line.starts_with("File \""))
    .unwrap_or("")
    .to_string();

  if detail.is_empty() {
    "The book converter could not read this file. It may be damaged.".to_string()
  } else {
    format!("The book converter could not read this file: {detail}")
  }
}

type ConversionLock = std::sync::Arc<std::sync::Mutex<()>>;

/// One lock per content hash, held across a conversion. Both converters stage
/// into the same `.epub.part` beside the cache path, so two readers opening the
/// same book at once would each delete and overwrite the other's half-written
/// file. The second caller waits instead, then finds the finished conversion.
static CONVERSION_LOCKS: std::sync::LazyLock<
  std::sync::Mutex<std::collections::HashMap<String, ConversionLock>>
> = std::sync::LazyLock::new(Default::default);

fn with_conversion_lock<T>(hash: &str, work: impl FnOnce() -> T) -> T {
  let lock = CONVERSION_LOCKS
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner())
    .entry(hash.to_string())
    .or_default()
    .clone();

  let result = {
    // A conversion that panicked leaves nothing to protect: the staging file
    // is removed before every attempt.
    let _held = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    work()
  };

  // Forget the entry once no one else holds or waits on it, so the map does
  // not grow with every book ever opened. Every clone is taken and dropped
  // under the map lock, so the count is exact while it is held here.
  let mut locks = CONVERSION_LOCKS
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner());
  let last = locks
    .get(hash)
    .is_some_and(|entry| std::sync::Arc::ptr_eq(entry, &lock))
    && std::sync::Arc::strong_count(&lock) == 2;
  drop(lock);
  if last {
    locks.remove(hash);
  }
  result
}

/// Resolves a path the EPUB reader can open, converting first if the format
/// requires it. Conversions are cached next to the original by content hash.
pub fn ensure_epub_version(
  source: &Path,
  hash: &str,
  app: Option<&AppHandle>
) -> std::result::Result<PathBuf, ConversionError> {
  let ext = normalized_ext(source);
  let Some(format) = crate::formats::lookup(&ext) else {
    return Err(ConversionError::Unsupported(ext));
  };

  use crate::formats::Delivery;
  match format.delivery {
    // Already something a reader can open.
    Delivery::Epub | Delivery::Pdf | Delivery::Comic => return Ok(source.to_path_buf()),
    Delivery::Builtin | Delivery::Convert => {}
  }

  let target = converted_epub_path(hash)
    .map_err(|error| ConversionError::Failed(error.to_string()))?;

  with_conversion_lock(hash, || {
    if format.delivery == Delivery::Builtin {
      return convert_builtin_to(source, &target);
    }
    // A Kindle book is tried here first. What this does not read (the newer
    // format, an old compression) is Calibre's as before; one locked to an
    // account is nobody's, and says so without asking for Calibre.
    if is_kindle(&ext) && !target.exists() {
      match convert_kindle_to(source, &target) {
        Ok(path) => return Ok(path),
        Err(crate::convert::mobi::NotRead::Locked) => return Err(ConversionError::Failed(DRM_MESSAGE.to_string())),
        Err(_) => {}
      }
    }
    convert_to(source, &target, app)
  })
}

/// A Kindle book made into an EPUB in the conversion cache by Leaflet itself,
/// written to one side and renamed, like every conversion.
fn convert_kindle_to(source: &Path, target: &Path) -> std::result::Result<PathBuf, crate::convert::mobi::NotRead> {
  use crate::convert::mobi::NotRead;
  if let Some(parent) = target.parent() {
    let _ = fs::create_dir_all(parent);
  }
  let fallback_title = source.file_stem().and_then(|value| value.to_str()).unwrap_or("Untitled");
  let staging = target.with_extension("epub.part");
  let _ = fs::remove_file(&staging);
  if let Err(error) = crate::convert::mobi::to_epub(source, &staging, fallback_title) {
    let _ = fs::remove_file(&staging);
    return Err(error);
  }
  if let Err(error) = fs::rename(&staging, target) {
    let _ = fs::remove_file(&staging);
    return Err(NotRead::Damaged(format!("Could not save the converted book: {error}")));
  }
  Ok(target.to_path_buf())
}

/// In-process conversion. Same caching and same write-then-rename discipline as
/// the Calibre path, so a failure never leaves a half-written book behind.
fn convert_builtin_to(
  source: &Path,
  target: &Path
) -> std::result::Result<PathBuf, ConversionError> {
  if target.exists() {
    return Ok(target.to_path_buf());
  }
  if let Some(parent) = target.parent() {
    let _ = fs::create_dir_all(parent);
  }

  let fallback_title = source
    .file_stem()
    .and_then(|value| value.to_str())
    .unwrap_or("Untitled");

  let staging = target.with_extension("epub.part");
  let _ = fs::remove_file(&staging);

  if let Err(error) = crate::convert::to_epub(source, &staging, fallback_title) {
    let _ = fs::remove_file(&staging);
    return Err(ConversionError::Failed(format!(
      "Leaflet could not read this file: {error}"
    )));
  }

  if let Err(error) = fs::rename(&staging, target) {
    let _ = fs::remove_file(&staging);
    return Err(ConversionError::Failed(format!(
      "Could not save the converted book: {error}"
    )));
  }

  Ok(target.to_path_buf())
}

/// Conversion against an explicit cache path, so the cache and failure
/// behaviour can be exercised without touching the real library directory.
fn convert_to(
  source: &Path,
  target: &Path,
  app: Option<&AppHandle>
) -> std::result::Result<PathBuf, ConversionError> {
  // A cached conversion is usable even if Calibre has since been uninstalled, so
  // this has to be checked before the converter is resolved. On a phone it is
  // also the only way a Calibre-only format opens at all: converted once on a
  // desktop, the EPUB syncs across like any other book.
  if target.exists() {
    return Ok(target.to_path_buf());
  }
  convert_with_external(source, target, app)
}

/// Drives an external Calibre. Desktop only -- see the converter block above.
#[cfg(desktop)]
fn convert_with_external(
  source: &Path,
  target: &Path,
  app: Option<&AppHandle>
) -> std::result::Result<PathBuf, ConversionError> {
  // A book locked to an account cannot be converted by anyone: say so now
  // rather than after the reader has installed Calibre to find out.
  if is_kindle(&normalized_ext(source)) && mobi::info(source).is_ok_and(|info| info.encrypted) {
    return Err(ConversionError::Failed(DRM_MESSAGE.to_string()));
  }
  let converter = resolve_converter_path(app).ok_or(ConversionError::ConverterMissing)?;

  // Convert to a scratch path and rename on success. Writing straight to the
  // cache path meant an interrupted conversion left a truncated EPUB that the
  // `target.exists()` check above trusted forever.
  let staging = target.with_extension("epub.part");
  let _ = fs::remove_file(&staging);
  let result = run_converter(&converter, source, &staging);

  if result.is_err() || !staging.exists() {
    let _ = fs::remove_file(&staging);
    return Err(result.err().unwrap_or_else(|| {
      ConversionError::Failed("The book converter produced no output.".to_string())
    }));
  }

  if let Err(error) = fs::rename(&staging, target) {
    let _ = fs::remove_file(&staging);
    return Err(ConversionError::Failed(format!(
      "Could not save the converted book: {error}"
    )));
  }

  Ok(target.to_path_buf())
}

/// There is no Calibre for Android, so the formats that need it simply cannot
/// be opened here. Reported as a missing converter, which the UI already
/// explains, rather than as a failure the reader could act on.
#[cfg(not(desktop))]
fn convert_with_external(
  _source: &Path,
  _target: &Path,
  _app: Option<&AppHandle>
) -> std::result::Result<PathBuf, ConversionError> {
  Err(ConversionError::ConverterMissing)
}

/// Recognises the container formats a cover can plausibly arrive in. Used to
/// reject error pages, which otherwise get cached as a permanent "cover".
pub fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
  if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
    return Some("image/jpeg");
  }
  if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
    return Some("image/png");
  }
  if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
    return Some("image/gif");
  }
  if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
    return Some("image/webp");
  }
  if bytes.starts_with(b"BM") {
    return Some("image/bmp");
  }
  None
}

pub async fn store_cover(url: &str, hash: &str) -> Result<PathBuf> {
  let dir = covers_dir()?;
  fs::create_dir_all(&dir)?;
  let dest = dir.join(format!("{}-cover.jpg", hash));
  if dest.exists() {
    return Ok(dest);
  }

  // Without these checks a 404 page or a redirect to HTML was written to disk and
  // cached forever, permanently blocking the real cover for that book.
  let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).build()?;
  let bytes = client.get(url).send().await?.error_for_status()?.bytes().await?;
  store_cover_bytes(&bytes, hash)
}

/// Saves cover image bytes (from the internet or from inside the book) as the
/// book's cover. A cover already saved is kept: the book's own, saved at
/// import, is not replaced by a guess from a search.
pub fn store_cover_bytes(bytes: &[u8], hash: &str) -> Result<PathBuf> {
  if sniff_image_mime(bytes).is_none() {
    return Err(anyhow::anyhow!("cover was not an image"));
  }
  let dir = covers_dir()?;
  fs::create_dir_all(&dir)?;
  let dest = dir.join(format!("{}-cover.jpg", hash));
  if dest.exists() {
    return Ok(dest);
  }
  // Write via a temp file so an interrupted write cannot leave a truncated
  // cover behind that the `dest.exists()` short-circuit would then trust.
  let staging = dir.join(format!("{}-cover.part", hash));
  fs::write(&staging, bytes)?;
  if let Err(error) = fs::rename(&staging, &dest) {
    let _ = fs::remove_file(&staging);
    return Err(error.into());
  }
  Ok(dest)
}

/// How a PDF's first page is named when it stands in for a cover.
const PAGE_COVER_SUFFIX: &str = "-page.jpg";

/// Whether a stored cover is a PDF's own first page standing in for one
/// (`store_page_cover_bytes`), and not a cover from the book or a catalogue.
/// A stand-in gives way to a real cover the next time a lookup finds one.
pub fn is_page_cover(cover: &str) -> bool {
  cover.ends_with(PAGE_COVER_SUFFIX)
}

/// Saves a PDF's first page as its stand-in cover. Under a name of its own:
/// kept as `<hash>-cover.jpg` it could not be told from a real cover, and
/// `store_cover` never replaces one of those, so a title page saved after a
/// lookup that failed stayed the book's cover for good.
pub fn store_page_cover_bytes(bytes: &[u8], hash: &str) -> Result<PathBuf> {
  if sniff_image_mime(bytes).is_none() {
    return Err(anyhow::anyhow!("cover was not an image"));
  }
  page_cover_into(&covers_dir()?, bytes, hash)
}

fn page_cover_into(dir: &Path, bytes: &[u8], hash: &str) -> Result<PathBuf> {
  fs::create_dir_all(dir)?;
  let dest = dir.join(format!("{hash}{PAGE_COVER_SUFFIX}"));
  let staging = dir.join(format!("{hash}-page.part"));
  fs::write(&staging, bytes)?;
  if let Err(error) = fs::rename(&staging, &dest) {
    let _ = fs::remove_file(&staging);
    return Err(error.into());
  }
  Ok(dest)
}

/// Takes a stand-in away once the book has a real cover, and the thumbnail
/// made from it, so the next one asked for is made from the real one.
pub fn drop_page_cover(hash: &str) {
  if let Ok(dir) = covers_dir() {
    let _ = fs::remove_file(dir.join(format!("{hash}{PAGE_COVER_SUFFIX}")));
    let _ = fs::remove_file(dir.join(format!("{hash}-thumb.jpg")));
  }
}

/// Widest a library thumbnail is drawn: a grid card is about 180 px wide, so
/// this covers a 2x display with room to spare.
const THUMB_WIDTH: u32 = 360;

/// A small JPEG of a book's cover for the library grid, made once and kept
/// beside the cover. Full covers are often 100 to 300 KB, and the grid used to
/// load every one of them in full, as base64, for every card.
pub fn cover_thumbnail(cover: &Path, hash: &str) -> Result<PathBuf> {
  thumbnail_into(&covers_dir()?, cover, hash)
}

fn thumbnail_into(dir: &Path, cover: &Path, hash: &str) -> Result<PathBuf> {
  let dest = dir.join(format!("{}-thumb.jpg", hash));
  if dest.exists() {
    return Ok(dest);
  }
  let image = image::load_from_memory(&fs::read(cover)?)?;
  let small = if image.width() > THUMB_WIDTH {
    image.thumbnail(THUMB_WIDTH, THUMB_WIDTH * 3)
  } else {
    image
  };
  let mut bytes = Vec::new();
  let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 82);
  small.to_rgb8().write_with_encoder(encoder)?;
  let staging = dir.join(format!("{}-thumb.part", hash));
  fs::write(&staging, &bytes)?;
  if let Err(error) = fs::rename(&staging, &dest) {
    let _ = fs::remove_file(&staging);
    return Err(error.into());
  }
  Ok(dest)
}

/// What a deleted book leaves besides its own file: the cover, its thumbnail,
/// and the EPUB made when another format was converted. Best effort.
pub fn remove_book_extras(hash: &str, book_path: &Path) {
  if let Ok(dir) = covers_dir() {
    let _ = fs::remove_file(dir.join(format!("{}-cover.jpg", hash)));
    let _ = fs::remove_file(dir.join(format!("{hash}{PAGE_COVER_SUFFIX}")));
    let _ = fs::remove_file(dir.join(format!("{}-thumb.jpg", hash)));
  }
  if let Ok(converted) = converted_epub_path(hash) {
    if converted != book_path {
      let _ = fs::remove_file(converted);
    }
  }
  // The text kept of a PDF for the library's search.
  crate::pdf_text::remove(hash);
}

/// The cover inside the book, saved as its cover: an EPUB's, a Kindle
/// book's, or, for any other format that has been opened once, the cover of
/// the EPUB it was converted to. `None` for a book without one.
pub fn store_embedded_cover(book_path: &Path, hash: &str) -> Option<PathBuf> {
  let bytes = embedded_cover(book_path, converted_epub_path(hash).ok().as_deref())?;
  store_cover_bytes(&bytes, hash).ok()
}

fn embedded_cover(book_path: &Path, converted: Option<&Path>) -> Option<Vec<u8>> {
  let ext = normalized_ext(book_path);
  let own = if ext == "epub" {
    epub::cover(book_path).ok().flatten()
  } else if is_kindle(&ext) {
    mobi::cover(book_path).ok().flatten()
  } else {
    None
  };
  own.or_else(|| {
    let converted = converted.filter(|path| *path != book_path && path.exists())?;
    epub::cover(converted).ok().flatten()
  })
}

pub fn extract_basic_metadata(path: &Path) -> Result<BasicMetadata> {
  let ext = path.extension().and_then(|v| v.to_str()).unwrap_or("").to_lowercase();
  if ext == "epub" {
    if let Ok(metadata) = extract_epub_metadata(path) {
      return Ok(metadata);
    }
  }
  if is_kindle(&ext) {
    if let Ok(info) = mobi::info(path) {
      return Ok(BasicMetadata { title: info.title, authors: info.authors, subjects: info.subjects, ..BasicMetadata::default() });
    }
  }
  if ext == "pdf" {
    if let Ok(info) = pdf::info(path) {
      return Ok(BasicMetadata { title: info.title, authors: info.author.into_iter().collect(), doubtful: true, ..BasicMetadata::default() });
    }
  }
  // A comic, a text file, or a book whose metadata cannot be read: the
  // file's name is all there is.
  Ok(BasicMetadata::default())
}

fn extract_epub_metadata(path: &Path) -> Result<BasicMetadata> {
  let package = epub::package(path)?;
  Ok(BasicMetadata {
    title: package.title,
    authors: package.authors,
    subjects: package.subjects,
    series: package.series,
    series_index: package.series_index,
    doubtful: false
  })
}

#[cfg(test)]
mod tests {
  use crate::LockExt;
  use super::*;

  /// A PDF's first page is kept under a name of its own, so it can be told
  /// from a real cover and replaced by one; and it is written again each time.
  #[test]
  fn a_page_standing_in_for_a_cover_is_kept_apart_from_a_real_one() {
    let dir = std::env::temp_dir().join(format!("leaflet-page-cover-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    let mut png = Vec::new();
    image::RgbImage::from_pixel(8, 12, image::Rgb([200, 200, 190]))
      .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
      .expect("png");
    let page = page_cover_into(&dir, &png, "h").expect("page");
    assert!(is_page_cover(&page.to_string_lossy()));
    assert!(!is_page_cover(&dir.join("h-cover.jpg").to_string_lossy()));
    assert!(!dir.join("h-cover.jpg").exists(), "the real cover's name is left free");
    // Saved again (the book opened again before a lookup): no error, same file.
    assert_eq!(page_cover_into(&dir, &png, "h").expect("again"), page);
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_cover_thumbnail_is_a_small_jpeg_made_once() {
    let dir = std::env::temp_dir().join("leaflet-thumb-test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("dir");
    let cover = dir.join("big-cover.png");
    image::RgbImage::from_pixel(1200, 1800, image::Rgb([180, 60, 40]))
      .save(&cover)
      .expect("cover");
    let thumb = thumbnail_into(&dir, &cover, "h").expect("thumbnail");
    let bytes = fs::read(&thumb).expect("read");
    assert_eq!(sniff_image_mime(&bytes), Some("image/jpeg"));
    let small = image::load_from_memory(&bytes).expect("decode");
    assert_eq!((small.width(), small.height()), (THUMB_WIDTH, THUMB_WIDTH * 3 / 2), "keeps the shape");
    assert!(bytes.len() < fs::metadata(&cover).expect("meta").len() as usize || bytes.len() < 60_000);
    // Made once: a second call returns the same file untouched.
    let again = thumbnail_into(&dir, &cover, "h").expect("again");
    assert_eq!(again, thumb);
    let _ = fs::remove_dir_all(&dir);
  }

  /// The bug this guards: opening a file whose book the library already listed
  /// (from a backup, not downloaded yet) did nothing, so the book still could
  /// not be read once the file in Downloads was gone.
  #[test]
  fn a_listed_book_without_its_file_gets_it_back_from_the_same_bytes() {
    let dir = std::env::temp_dir().join(format!("leaflet-restore-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("dir");
    let source = dir.join("Downloads copy.epub");
    fs::write(&source, b"the whole book").expect("source");
    let dest = dir.join("books").join("abc.epub");

    restore_book_file(&source, &dest).expect("restore");
    assert_eq!(fs::read(&dest).expect("read"), b"the whole book");
    assert!(!dir.join("books").join("abc.epub.part").exists());

    // The original can go; the library's copy stays. A file already there is kept.
    fs::remove_file(&source).expect("delete the original");
    assert_eq!(fs::read(&dest).expect("read"), b"the whole book");
    fs::write(&source, b"something else").expect("another");
    restore_book_file(&source, &dest).expect("no-op");
    assert_eq!(fs::read(&dest).expect("read"), b"the whole book");

    let _ = fs::remove_dir_all(&dir);
  }

  /// The bug this guards: a second import of a file still being copied (a
  /// second double-click on a large book) opened the same staging file, and
  /// Windows refused it: "being used by another process", shown as a failed
  /// import of a book that had in fact come in.
  #[test]
  fn two_imports_of_one_file_at_once_both_succeed() {
    let dir = std::env::temp_dir().join(format!("leaflet-store-twice-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("dir");
    let source = dir.join("A Large Book.PDF");
    fs::write(&source, vec![7u8; 48 * 1024 * 1024]).expect("source");
    let books = dir.join("books");

    let threads: Vec<_> = (0..4)
      .map(|_| {
        let (books, source) = (books.clone(), source.clone());
        std::thread::spawn(move || store_book_file_in(&books, &source, "abc").map_err(|error| error.to_string()))
      })
      .collect();
    for thread in threads {
      assert_eq!(thread.join().unwrap(), Ok(books.join("abc.pdf")));
    }
    assert_eq!(fs::metadata(books.join("abc.pdf")).expect("stored").len(), 48 * 1024 * 1024);
    assert!(!books.join("abc.pdf.part").exists());

    let _ = fs::remove_dir_all(&dir);
  }

  /// A copy keeps the original's read-only mark, staging file included. One
  /// left behind by an interrupted import could not be written over, so that
  /// book could never be imported again: "Access is denied".
  #[test]
  fn a_read_only_staging_file_left_behind_does_not_block_the_import() {
    let dir = std::env::temp_dir().join(format!("leaflet-store-readonly-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    let books = dir.join("books");
    fs::create_dir_all(&books).expect("dir");
    let source = dir.join("From a CD.epub");
    fs::write(&source, b"the whole book").expect("source");
    let mut permissions = fs::metadata(&source).expect("meta").permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&source, permissions).expect("read-only");
    fs::copy(&source, books.join("abc.epub.part")).expect("the interrupted import");

    let stored = store_book_file_in(&books, &source, "abc").expect("import");
    assert_eq!(fs::read(&stored).expect("read"), b"the whole book");
    assert!(!books.join("abc.epub.part").exists());

    // The same for a listed book getting its file back.
    let dest = books.join("def.epub");
    fs::copy(&source, books.join("def.epub.part")).expect("another leftover");
    restore_book_file(&source, &dest).expect("restore");
    assert_eq!(fs::read(&dest).expect("read"), b"the whole book");

    for path in [source, stored, dest] {
      let mut permissions = fs::metadata(&path).expect("meta").permissions();
      #[allow(clippy::permissions_set_readonly_false)]
      permissions.set_readonly(false);
      let _ = fs::set_permissions(&path, permissions);
    }
    let _ = fs::remove_dir_all(&dir);
  }

  /// Every empty file hashes the same, so the first became a book that could
  /// not open and every later one, of any format, was taken for it.
  #[test]
  fn an_empty_file_or_a_folder_is_not_imported_as_a_book() {
    let dir = std::env::temp_dir().join(format!("leaflet-empty-import-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("A Folder.epub")).expect("dir");
    let empty = dir.join("unfinished download.epub");
    fs::write(&empty, b"").expect("empty");
    let book = dir.join("book.epub");
    fs::write(&book, b"PK the whole book").expect("book");

    assert!(hash_for_import(&empty).unwrap_err().to_string().contains("empty"));
    assert!(hash_for_import(&dir.join("A Folder.epub")).unwrap_err().to_string().contains("folder"));
    assert!(hash_for_import(&dir.join("gone.epub")).is_err(), "a file that vanished after it was picked");
    assert_eq!(hash_for_import(&book).expect("hash"), hash_file(&book).expect("hash"));

    let _ = fs::remove_dir_all(&dir);
  }

  /// A file that is not what its name says is refused in words that say what
  /// it is; one that is, or whose format the first bytes cannot settle, is not.
  #[test]
  fn a_file_that_is_not_what_its_name_says_is_refused_plainly() {
    let dir = std::env::temp_dir().join(format!("leaflet-kind-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("dir");
    let put = |name: &str, bytes: &[u8]| {
      let path = dir.join(name);
      fs::write(&path, bytes).expect("write");
      path
    };
    let refused = |name: &str, bytes: &[u8]| hash_for_import(&put(name, bytes)).expect_err(name).to_string();

    let message = refused("really a pdf.epub", b"%PDF-1.4 and so on");
    assert!(message.contains("named .epub") && message.contains("not an EPUB") && message.contains("rename it to end in .pdf"), "{message}");
    let message = refused("sign-in page.epub", b"<!DOCTYPE html><html><body>Please sign in</body></html>");
    assert!(message.contains("web page") && message.contains("download the book again"), "{message}");
    let message = refused("really an epub.pdf", b"PK\x03\x04mimetypeapplication/epub+zip");
    assert!(message.contains("not a PDF") && message.contains("zip archive"), "{message}");
    let message = refused("noise.epub", &[7u8; 300]);
    assert!(message.contains("damaged"), "{message}");
    let message = refused("cut short.pdf", b"%PD");
    assert!(message.contains("not a PDF"), "{message}");
    let mut kindle = vec![0u8; 100];
    kindle[60..68].copy_from_slice(b"BOOKMOBI");
    assert!(refused("kindle.epub", &kindle).contains(".mobi"));

    // What they say they are, as far as the first bytes go.
    for (name, bytes) in [
      ("book.epub", &b"PK\x03\x04mimetype"[..]),
      ("BOOK.EPUB", b"PK\x03\x04mimetype"),
      ("comic.cbz", b"PK\x03\x04page1.jpg"),
      ("paper.pdf", b"%PDF-1.7"),
      // A PDF may open with a few stray bytes; readers allow it.
      ("mailed.pdf", b"\xEF\xBB\xBF\r\n%PDF-1.4"),
      // Formats with no signature to check are taken at their word.
      ("notes.txt", b"%PDF- is how a PDF starts"),
      ("old.mobi", b"anything"),
      ("page.html", b"PK is not markup")
    ] {
      assert!(hash_for_import(&put(name, bytes)).is_ok(), "{name}");
    }
    let _ = fs::remove_dir_all(&dir);
  }

  /// Paths as real libraries have them: an apostrophe, a typographic one,
  /// Chinese, a name over 200 characters in a folder deep enough to pass
  /// Windows' 260.
  #[test]
  fn awkward_paths_import_like_any_other() {
    let root = std::env::temp_dir().join(format!("leaflet-path-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let deep = root.join("Don't Wake").join("Anna’s shelf 万千书友聚集地").join("a".repeat(60));
    fs::create_dir_all(&deep).expect("dir");
    let name = format!("Don't Wake, There Are Wolves_ {} -- Ellison, Mara -- ©2008 -- 万千 -- Anna’s Archive.epub", "long ".repeat(34));
    let source = deep.join(&name);
    assert!(name.chars().count() > 200 && source.to_string_lossy().chars().count() > 300, "the path is long enough to matter");
    fs::write(&source, b"PK\x03\x04 not much of a book").expect("write");

    let hash = hash_for_import(&source).expect("hash");
    let stored = store_book_file_in(&root.join("books"), &source, &hash).expect("store");
    assert_eq!(fs::read(&stored).expect("read"), b"PK\x03\x04 not much of a book");
    // Not a real EPUB inside: nothing is read from it, and nothing panics.
    let basic = extract_basic_metadata(&stored).expect("metadata");
    assert_eq!(basic.title, None);
    assert_eq!(embedded_cover(&stored, None), None);
    assert!(epub::sections(&stored).is_err());
    let stem = source.file_stem().and_then(|value| value.to_str()).expect("stem");
    let identity = crate::metadata::normalize::identify(stem, &basic);
    assert_eq!(identity.author.as_deref(), Some("Mara Ellison"));
    assert!(identity.title.starts_with("Don't Wake, There Are Wolves: long long"), "{}", identity.title);
    let _ = fs::remove_dir_all(&root);
  }

  /// A file another program holds open for itself: said in plain words, not
  /// "os error 32".
  #[cfg(windows)]
  #[test]
  fn a_file_another_program_holds_is_explained() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = std::env::temp_dir().join(format!("leaflet-locked-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("dir");
    let path = dir.join("still downloading.epub");
    fs::write(&path, b"PK\x03\x04 half a book").expect("write");
    let held = fs::OpenOptions::new().read(true).write(true).share_mode(0).open(&path).expect("hold");
    let message = hash_for_import(&path).expect_err("held").to_string();
    assert!(message.contains("open in another program"), "{message}");
    assert!(!message.contains("os error"), "{message}");
    drop(held);
    assert!(hash_for_import(&path).is_ok());

    let message = hash_for_import(&dir.join("gone.epub")).expect_err("gone").to_string();
    assert!(message.contains("no longer there"), "{message}");
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn conversions_of_one_book_run_one_at_a_time() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let active = std::sync::Arc::new(AtomicUsize::new(0));
    let threads: Vec<_> = (0..4)
      .map(|_| {
        let active = active.clone();
        std::thread::spawn(move || {
          with_conversion_lock("same-book", || {
            assert_eq!(active.fetch_add(1, Ordering::SeqCst), 0, "overlapping conversion");
            std::thread::sleep(Duration::from_millis(20));
            active.fetch_sub(1, Ordering::SeqCst);
          })
        })
      })
      .collect();
    for thread in threads {
      thread.join().unwrap();
    }
    // The last one out forgets the entry.
    assert!(!CONVERSION_LOCKS.guard().contains_key("same-book"));
  }

  #[test]
  fn drm_is_named_rather_than_reported_as_a_generic_failure() {
    let message = describe_converter_failure(
      b"calibre.ebooks.DRMError: This book is corrupted or has DRM",
      b""
    );
    assert!(message.contains("DRM-protected"), "{message}");
    assert!(!message.contains("Traceback"), "{message}");
  }

  #[test]
  fn a_missing_source_is_distinguished_from_a_bad_one() {
    let message = describe_converter_failure(b"IOError: No such file or directory", b"");
    assert!(message.contains("Re-import"), "{message}");
  }

  #[test]
  fn python_tracebacks_are_reduced_to_their_last_useful_line() {
    let message = describe_converter_failure(
      b"Traceback (most recent call last):\n  File \"x.py\", line 3\nValueError: not a known format",
      b""
    );
    assert!(message.contains("ValueError: not a known format"), "{message}");
    assert!(!message.contains("Traceback"), "{message}");
  }

  #[test]
  fn silent_failures_still_produce_an_explanation() {
    let message = describe_converter_failure(b"", b"");
    assert!(message.contains("may be damaged"), "{message}");
  }

  #[test]
  fn unsupported_formats_are_named_in_the_error() {
    let message = ConversionError::Unsupported("exe".to_string()).to_string();
    assert!(message.contains(".exe"), "{message}");
    assert!(message.contains("EPUB"), "{message}");
  }

  #[test]
  fn a_missing_converter_points_at_settings() {
    let message = ConversionError::ConverterMissing.to_string();
    assert!(message.to_lowercase().contains("settings"), "{message}");
  }

  #[test]
  fn native_formats_never_reach_the_converter() {
    // No converter is installed in the test environment, so anything that tried
    // to convert would fail rather than return the source path.
    let epub = Path::new("/library/book.epub");
    assert_eq!(ensure_epub_version(epub, "hash", None).unwrap(), epub.to_path_buf());

    let pdf = Path::new("/library/book.pdf");
    assert_eq!(ensure_epub_version(pdf, "hash", None).unwrap(), pdf.to_path_buf());
  }

  #[test]
  fn unsupported_extensions_are_rejected_before_any_work() {
    let error = ensure_epub_version(Path::new("/library/book.exe"), "hash", None).unwrap_err();
    assert!(matches!(error, ConversionError::Unsupported(ref ext) if ext == "exe"));
  }

  #[test]
  fn uppercase_extensions_resolve_to_the_same_format() {
    let epub = Path::new("/library/BOOK.EPUB");
    assert_eq!(ensure_epub_version(epub, "hash", None).unwrap(), epub.to_path_buf());
  }

  #[test]
  fn the_directory_walk_is_depth_limited() {
    let root = std::env::temp_dir().join("leaflet-converter-depth-test");
    let _ = fs::remove_dir_all(&root);
    let deep = root.join("a").join("b").join("c").join("d").join("e");
    fs::create_dir_all(&deep).expect("create nested dirs");
    let needle = deep.join("ebook-convert-probe");
    fs::write(&needle, b"x").expect("write probe");

    assert!(
      find_in_dir(&root, "ebook-convert-probe", 3).is_none(),
      "a file below the depth cap must not be found"
    );
    assert_eq!(
      find_in_dir(&root, "ebook-convert-probe", 8),
      Some(needle),
      "the same file is found once the cap allows it"
    );

    let _ = fs::remove_dir_all(&root);
  }

  /// The bug this guards: the app refused to reopen a book it had already
  /// converted whenever the Calibre install went missing.
  #[test]
  fn a_cached_conversion_opens_without_a_converter() {
    let dir = std::env::temp_dir().join("leaflet-cached-conversion");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create dir");
    let target = dir.join("cached.epub");
    fs::write(&target, b"PK pretend epub").expect("seed cache");

    let resolved = convert_to(Path::new("/library/book.azw3"), &target, None)
      .expect("a cached conversion must not need the converter");
    assert_eq!(resolved, target);

    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_convertible_book_without_a_cache_reports_the_missing_converter() {
    let dir = std::env::temp_dir().join("leaflet-missing-converter");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create dir");
    let target = dir.join("absent.epub");

    // Now that a system Calibre is discovered, this path only exists on machines
    // without one; elsewhere the call would legitimately try to convert.
    if resolve_converter_path(None).is_some() {
      let _ = fs::remove_dir_all(&dir);
      return;
    }

    let error = convert_to(Path::new("/library/book.azw3"), &target, None)
      .expect_err("no converter is installed in the test environment");
    assert!(matches!(error, ConversionError::ConverterMissing), "{error:?}");
    assert!(!target.exists(), "a failed attempt must not leave a cache entry");

    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn the_search_terminates_on_a_zero_depth_budget() {
    let root = std::env::temp_dir().join("leaflet-converter-zero-depth");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("create root");
    assert!(find_in_dir(&root, "anything", 0).is_none());
    let _ = fs::remove_dir_all(&root);
  }
}
