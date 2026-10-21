//! The Studio voice's pack: what to download (`packs.json`, versioned in the
//! repo), where it goes, and the download itself — resumed where it stopped,
//! every file checked against its SHA-256, gathered in a staging folder and
//! moved into place in one rename, so a pack is either whole or not there.
//!
//! The same on every platform (Android's Kotlin reads the files this puts in
//! place); only synthesis is desktop-only (`engine.rs`). The command and
//! event shapes are in `mod.rs`.

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The manifest, as shipped. One line in it (`"variant"`) picks fp32 or int8.
pub const MANIFEST_JSON: &str = include_str!("packs.json");
/// The only pack there is, for now.
pub const PACK_ID: &str = "kokoro-v1";
/// Past this real-time factor (seconds of work per second of speech) the
/// voice cannot keep up comfortably: it stays offered, never picked by itself.
pub const SLOW_RTF: f64 = 0.8;

// ---- the manifest -----------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
  pub version: u32,
  pub packs: Vec<PackSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackSpec {
  pub id: String,
  /// The variant downloaded (a key of `variants`).
  pub variant: String,
  pub variants: BTreeMap<String, VariantSpec>,
  pub voices: Vec<VoiceSpec>,
  pub default_voice: String,
  /// The sample sentence (the self-test, and Settings' ▶).
  pub sample: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantSpec {
  /// The model file, as named in the pack (`model.onnx`, `model.int8.onnx`).
  pub model: String,
  /// The files the pack is made of, as they lie in the pack folder.
  pub files: Vec<FileSpec>,
  /// Where to get them, tried in order.
  pub sources: Vec<Source>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSpec {
  /// Relative, `/`-separated.
  pub path: String,
  pub size: u64,
  pub sha256: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Source {
  /// Each file at `base` + its path (an owner-hosted mirror of pinned copies).
  #[serde(rename_all = "camelCase")]
  Files { base: String },
  /// One `.tar.bz2` holding the files under `root/` (and much else, skipped).
  #[serde(rename_all = "camelCase")]
  Archive { url: String, size: u64, sha256: String, root: String },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSpec {
  /// `neural:af_heart`.
  pub id: String,
  pub name: String,
  /// The speaker in `voices.bin`.
  pub sid: i32,
  pub lang: String,
  /// The lexicon it reads with (`lexicon-us-en.txt`).
  pub lexicon: String,
}

impl VoiceSpec {
  /// The espeak-ng voice its words are sounded out with (sherpa-onnx 1.x's
  /// Kokoro `lang`): `en-us` for an American voice; plain `en` — espeak's
  /// British English — for a British one (espeak-ng 1.13.8 has no `en-gb`).
  /// Not `en` for all: that reads "Darcy" as dˈɑːsi in an American voice.
  pub fn espeak_lang(&self) -> &'static str {
    espeak_lang_for(&self.lang)
  }
}

/// The espeak-ng voice for a BCP 47 tag of the pack's (`en-US`, `en-GB`).
pub fn espeak_lang_for(lang: &str) -> &'static str {
  let tag = lang.trim().to_ascii_lowercase().replace('_', "-");
  if tag == "en-gb" || tag.starts_with("en-gb-") {
    "en"
  } else {
    "en-us"
  }
}

impl Manifest {
  pub fn parse(json: &str) -> Result<Manifest, String> {
    let manifest: Manifest = serde_json::from_str(json).map_err(|e| format!("Bad voice manifest: {e}"))?;
    if manifest.version != 1 {
      return Err(format!("Voice manifest version {} is not known", manifest.version));
    }
    for pack in &manifest.packs {
      let variant = pack.variants.get(&pack.variant).ok_or_else(|| format!("Pack {} has no variant {}", pack.id, pack.variant))?;
      if variant.sources.is_empty() {
        return Err(format!("Pack {} has nowhere to download from", pack.id));
      }
      for file in &variant.files {
        if safe_relative(&file.path).is_none() {
          return Err(format!("Pack {} names an unsafe path: {}", pack.id, file.path));
        }
        if file.sha256.len() != 64 || !file.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
          return Err(format!("Pack {} has a bad hash for {}", pack.id, file.path));
        }
      }
      if !variant.files.iter().any(|file| file.path == variant.model) {
        return Err(format!("Pack {} does not list its model {}", pack.id, variant.model));
      }
      if !pack.voices.iter().any(|voice| voice.id == pack.default_voice) {
        return Err(format!("Pack {} has no voice {}", pack.id, pack.default_voice));
      }
    }
    Ok(manifest)
  }

  pub fn shipped() -> Manifest {
    Manifest::parse(MANIFEST_JSON).expect("packs.json is checked by the tests")
  }

  pub fn pack(&self, id: &str) -> Option<&PackSpec> {
    self.packs.iter().find(|pack| pack.id == id)
  }
}

impl PackSpec {
  pub fn chosen(&self) -> &VariantSpec {
    &self.variants[&self.variant]
  }

  /// What the pack takes on disk once installed.
  pub fn installed_size(&self) -> u64 {
    self.chosen().files.iter().map(|file| file.size).sum()
  }

  /// What the download costs: the first source's bytes.
  pub fn download_size(&self) -> u64 {
    match self.chosen().sources.first() {
      Some(Source::Archive { size, .. }) => *size,
      _ => self.installed_size(),
    }
  }

  #[cfg_attr(not(any(test, studio_voice)), allow(dead_code))]
  pub fn voice(&self, id: Option<&str>) -> &VoiceSpec {
    id.and_then(|id| self.voices.iter().find(|voice| voice.id == id))
      .or_else(|| self.voices.iter().find(|voice| voice.id == self.default_voice))
      .unwrap_or(&self.voices[0])
  }
}

/// A manifest path as a relative path with no way out of the folder.
pub fn safe_relative(path: &str) -> Option<PathBuf> {
  if path.is_empty() || path.contains('\\') || path.contains(':') {
    return None;
  }
  let candidate = Path::new(path);
  let mut out = PathBuf::new();
  for part in candidate.components() {
    match part {
      Component::Normal(name) => out.push(name),
      _ => return None,
    }
  }
  (!out.as_os_str().is_empty()).then_some(out)
}

// ---- where it lives ---------------------------------------------------------

/// `<voices>/kokoro-v1`, `<voices>/.kokoro-v1.partial`, …: the folders of one pack.
#[derive(Debug, Clone)]
pub struct PackDirs {
  /// The installed pack.
  pub dir: PathBuf,
  /// Files gathered (and kept, to resume) until they are all there.
  pub staging: PathBuf,
  /// The archive as it downloads.
  pub archive: PathBuf,
  /// The pack being replaced, for the moment of the swap.
  pub old: PathBuf,
}

impl PackDirs {
  pub fn under(voices: &Path, id: &str) -> PackDirs {
    PackDirs {
      dir: voices.join(id),
      staging: voices.join(format!(".{id}.partial")),
      archive: voices.join(format!(".{id}.archive.part")),
      old: voices.join(format!(".{id}.old")),
    }
  }

  /// The pack's folders in the app's data folder (the top of it, whichever library is open).
  pub fn app(id: &str) -> Result<PackDirs, String> {
    let root = crate::storage::app_data_dir().map_err(|e| e.to_string())?;
    Ok(PackDirs::under(&root.join("voices"), id))
  }
}

// ---- what is installed ------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SelfTest {
  pub rtf: f64,
  pub threads: u32,
  pub platform: String,
  pub at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
  pub pack: String,
  pub manifest_version: u32,
  pub variant: String,
  pub model: String,
  pub bytes: u64,
  pub installed_at: String,
  pub files: BTreeMap<String, FileEntry>,
  #[serde(default)]
  pub self_test: Option<SelfTest>,
  /// Threads to synthesise with, when set by hand (else min(4, cores / 2)).
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub threads: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
  pub size: u64,
  pub sha256: String,
}

pub const INSTALL_FILE: &str = "install.json";

pub fn read_install(dir: &Path) -> Option<InstallInfo> {
  let text = fs::read_to_string(dir.join(INSTALL_FILE)).ok()?;
  let info: InstallInfo = serde_json::from_str(&text).ok()?;
  // The model is opened by this name: a file of the pack's own, never a path out of it.
  (safe_relative(&info.model).is_some() && info.files.contains_key(&info.model)).then_some(info)
}

/// Writes `install.json` by way of a temporary file, so a crash leaves the old one.
pub fn write_install(dir: &Path, info: &InstallInfo) -> Result<(), String> {
  let text = serde_json::to_string_pretty(info).map_err(|e| e.to_string())?;
  let temp = dir.join(format!("{INSTALL_FILE}.tmp"));
  fs::write(&temp, text).map_err(|e| format!("Couldn't save the voice: {e}"))?;
  fs::rename(&temp, dir.join(INSTALL_FILE)).map_err(|e| format!("Couldn't save the voice: {e}"))
}

/// Bytes under a folder (0 when it is not there).
pub fn dir_size(path: &Path) -> u64 {
  let Ok(meta) = fs::symlink_metadata(path) else { return 0 };
  if meta.is_file() {
    return meta.len();
  }
  if !meta.is_dir() {
    return 0;
  }
  fs::read_dir(path)
    .map(|entries| entries.flatten().map(|entry| dir_size(&entry.path())).sum())
    .unwrap_or(0)
}

pub fn platform_name() -> &'static str {
  if cfg!(target_os = "android") {
    "android"
  } else if cfg!(windows) {
    "windows"
  } else {
    std::env::consts::OS
  }
}

// ---- status -----------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusVoice {
  pub id: String,
  pub name: String,
  pub sid: i32,
  pub lang: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudioVoiceStatus {
  pub pack: String,
  pub installed: bool,
  pub downloading: bool,
  pub download_bytes: u64,
  pub installed_bytes: u64,
  pub partial_bytes: u64,
  pub dir: String,
  pub variant: String,
  pub voices: Vec<StatusVoice>,
  pub default_voice: String,
  pub self_test: Option<SelfTest>,
  pub slow: bool,
  /// How it reads here (`lead.rs`): live, preparing each chapter first, or too slow to offer.
  pub mode: super::lead::Mode,
  pub can_speak: bool,
}

pub fn status_of(pack: &PackSpec, dirs: &PackDirs, downloading: bool, can_speak: bool) -> StudioVoiceStatus {
  let install = read_install(&dirs.dir).filter(|info| info.pack == pack.id);
  let installed = install.is_some();
  let self_test = install.as_ref().and_then(|info| info.self_test.clone());
  StudioVoiceStatus {
    pack: pack.id.clone(),
    installed,
    downloading,
    download_bytes: pack.download_size(),
    installed_bytes: if installed { dir_size(&dirs.dir) } else { 0 },
    partial_bytes: dir_size(&dirs.staging) + dir_size(&dirs.archive),
    dir: dirs.dir.display().to_string(),
    variant: install.as_ref().map(|info| info.variant.clone()).unwrap_or_else(|| pack.variant.clone()),
    voices: pack
      .voices
      .iter()
      .map(|voice| StatusVoice { id: voice.id.clone(), name: voice.name.clone(), sid: voice.sid, lang: voice.lang.clone() })
      .collect(),
    default_voice: pack.default_voice.clone(),
    slow: self_test.as_ref().is_some_and(|test| test.rtf > SLOW_RTF),
    mode: self_test.as_ref().map(|test| super::lead::mode_for(test.rtf)).unwrap_or(super::lead::Mode::Live),
    self_test,
    can_speak,
  }
}

/// Records a self-test's result in the installed pack.
pub fn record_self_test(dirs: &PackDirs, rtf: f64, threads: u32) -> Result<(), String> {
  if !rtf.is_finite() || rtf <= 0.0 {
    return Err("The self-test's result is not a number".into());
  }
  let mut info = read_install(&dirs.dir).ok_or("The Studio voice is not installed")?;
  info.self_test = Some(SelfTest { rtf, threads, platform: platform_name().into(), at: chrono::Utc::now().to_rfc3339() });
  write_install(&dirs.dir, &info)
}

/// Removes the pack and anything half-downloaded; what that freed.
pub fn remove(dirs: &PackDirs) -> u64 {
  let mut freed = 0;
  for path in [&dirs.dir, &dirs.staging, &dirs.archive, &dirs.old] {
    let size = dir_size(path);
    let gone = if path.is_dir() { fs::remove_dir_all(path) } else if path.exists() { fs::remove_file(path) } else { Ok(()) };
    if gone.is_ok() {
      freed += size;
    }
  }
  freed
}

// ---- downloading ------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
  Download,
  Verify,
  Extract,
  Install,
  /// Desktop: the self-test after installing.
  #[cfg_attr(not(studio_voice), allow(dead_code))]
  Test,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
  pub phase: Phase,
  pub done: u64,
  pub total: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DownloadError {
  Cancelled,
  Failed(String),
}

impl std::fmt::Display for DownloadError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      DownloadError::Cancelled => f.write_str("cancelled"),
      DownloadError::Failed(message) => f.write_str(message),
    }
  }
}

fn failed(message: impl Into<String>) -> DownloadError {
  DownloadError::Failed(message.into())
}

/// What to ask for, given what is already on disk of a file of `expected` bytes.
#[derive(Debug, PartialEq, Eq)]
pub enum RangePlan {
  /// All there: only to check.
  Complete,
  /// Ask from this byte on (0: the whole file).
  From(u64),
}

pub fn plan_range(have: u64, expected: u64) -> RangePlan {
  if expected > 0 && have == expected {
    RangePlan::Complete
  } else if have > 0 && have < expected {
    RangePlan::From(have)
  } else {
    RangePlan::From(0)
  }
}

/// What a response to a request from byte `from` means for the file on disk.
#[derive(Debug, PartialEq, Eq)]
pub enum ResponsePlan {
  /// Add the body to what is there.
  Append,
  /// The server sends the whole file: start again.
  Restart,
  /// Nothing more to send (416 when the file is whole).
  Nothing,
  Fail(String),
}

pub fn plan_response(from: u64, status: u16, content_range_start: Option<u64>) -> ResponsePlan {
  match status {
    206 if content_range_start == Some(from) => ResponsePlan::Append,
    206 => ResponsePlan::Fail("The server resumed from the wrong place".into()),
    200 => ResponsePlan::Restart,
    416 if from > 0 => ResponsePlan::Nothing,
    other => ResponsePlan::Fail(format!("The download failed (HTTP {other})")),
  }
}

/// What the server says the whole file is: a 200's length, or a 206's
/// `Content-Range` total (`bytes 100-199/1000` → 1000). None when it does not say.
pub fn reported_total(status: u16, content_length: Option<u64>, content_range: Option<&str>) -> Option<u64> {
  match status {
    200 => content_length,
    206 => content_range.and_then(|header| header.rsplit_once('/')).and_then(|(_, total)| total.trim().parse().ok()),
    _ => None,
  }
}

/// The message for a download that is not the file the manifest names (a re-upload upstream).
pub const CHANGED_UPSTREAM: &str = "The voice download is not the one expected (it may have changed upstream)";

/// `bytes 100-199/1000` → 100.
pub fn content_range_start(header: &str) -> Option<u64> {
  let rest = header.trim().strip_prefix("bytes")?.trim();
  let (span, _) = rest.split_once('/')?;
  let (start, _) = span.split_once('-')?;
  start.trim().parse().ok()
}

pub fn sha256_file(path: &Path) -> io::Result<String> {
  let mut file = File::open(path)?;
  let mut hasher = Sha256::new();
  let mut buffer = vec![0u8; 1 << 20];
  loop {
    let read = file.read(&mut buffer)?;
    if read == 0 {
      break;
    }
    hasher.update(&buffer[..read]);
  }
  Ok(hex::encode(hasher.finalize()))
}

/// Whether a file on disk is the one the manifest names.
pub fn file_matches(path: &Path, spec_size: u64, spec_sha: &str) -> bool {
  fs::metadata(path).is_ok_and(|meta| meta.len() == spec_size) && sha256_file(path).is_ok_and(|sha| sha.eq_ignore_ascii_case(spec_sha))
}

/// Reports progress at most every 100 ms (and always at the end).
pub struct Throttle<'a> {
  report: &'a (dyn Fn(Progress) + Send + Sync),
  last: Option<Instant>,
}

impl<'a> Throttle<'a> {
  pub fn new(report: &'a (dyn Fn(Progress) + Send + Sync)) -> Self {
    Throttle { report, last: None }
  }

  pub fn tell(&mut self, phase: Phase, done: u64, total: u64) {
    let now = Instant::now();
    if done >= total || self.last.is_none_or(|last| now.duration_since(last) >= Duration::from_millis(100)) {
      self.last = Some(now);
      (self.report)(Progress { phase, done, total });
    }
  }
}

/// A neutral client: no address, no account, only what is being fetched.
pub fn http_client() -> Result<reqwest::Client, String> {
  reqwest::Client::builder()
    .user_agent(format!("Leaflet/{}", env!("CARGO_PKG_VERSION")))
    .connect_timeout(Duration::from_secs(20))
    .read_timeout(Duration::from_secs(60))
    .build()
    .map_err(|e| e.to_string())
}

/// Downloads `url` to `path`, carrying on from what is there. `progress`
/// gets the bytes on disk; `cancel` stops it between chunks (what is there stays).
pub async fn fetch_resumable(
  client: &reqwest::Client,
  url: &str,
  path: &Path,
  expected: u64,
  cancel: &AtomicBool,
  mut progress: impl FnMut(u64),
) -> Result<(), DownloadError> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| failed(format!("Couldn't make room for the voice: {e}")))?;
  }
  let have = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
  let from = match plan_range(have, expected) {
    RangePlan::Complete => return Ok(()),
    RangePlan::From(from) => from,
  };
  if from == 0 && have > 0 {
    // Longer than it should be: not the file the manifest names.
    let _ = fs::remove_file(path);
  }
  let mut request = client.get(url);
  if from > 0 {
    request = request.header(reqwest::header::RANGE, format!("bytes={from}-"));
  }
  let mut response = request.send().await.map_err(|e| failed(format!("Couldn't reach the voice download: {e}")))?;
  let range = response.headers().get(reqwest::header::CONTENT_RANGE).and_then(|value| value.to_str().ok()).map(str::to_string);
  let start = range.as_deref().and_then(content_range_start);
  let status = response.status().as_u16();
  // Another size than the manifest's: not this file (re-uploaded upstream). Said now, and
  // nothing kept to resume, rather than "bigger than it should be" on every try.
  if let Some(total) = reported_total(status, response.content_length(), range.as_deref()) {
    if expected > 0 && total != expected {
      let _ = fs::remove_file(path);
      return Err(failed(CHANGED_UPSTREAM));
    }
  }
  let mut file = match plan_response(from, status, start) {
    ResponsePlan::Append => OpenOptions::new().append(true).open(path),
    ResponsePlan::Restart => File::create(path),
    ResponsePlan::Nothing => return Ok(()),
    ResponsePlan::Fail(message) => return Err(failed(message)),
  }
  .map_err(|e| failed(format!("Couldn't save the voice: {e}")))?;
  let mut done = file.seek(io::SeekFrom::End(0)).map_err(|e| failed(e.to_string()))?;
  progress(done);
  loop {
    if cancel.load(Ordering::SeqCst) {
      return Err(DownloadError::Cancelled);
    }
    let chunk = response.chunk().await.map_err(|e| failed(format!("The download stopped: {e}")))?;
    let Some(chunk) = chunk else { break };
    done += chunk.len() as u64;
    if expected > 0 && done > expected {
      drop(file);
      let _ = fs::remove_file(path);
      return Err(failed("The download is bigger than it should be"));
    }
    file.write_all(&chunk).map_err(|e| failed(format!("Couldn't save the voice (is the disk full?): {e}")))?;
    progress(done);
  }
  file.flush().map_err(|e| failed(e.to_string()))?;
  if expected > 0 && done != expected {
    return Err(failed("The download ended early"));
  }
  Ok(())
}

/// Takes the pack's files out of a `.tar.bz2` (any other entry is skipped),
/// checking each against the manifest as it is written. A file already in
/// `staging` and correct is kept.
pub fn extract_archive(
  archive: &Path,
  root: &str,
  files: &[FileSpec],
  staging: &Path,
  cancel: &AtomicBool,
  mut progress: impl FnMut(u64, u64),
) -> Result<(), DownloadError> {
  let total = fs::metadata(archive).map(|meta| meta.len()).unwrap_or(0);
  let counter = Arc::new(Mutex::new(0u64));
  let reader = CountingReader { inner: File::open(archive).map_err(|e| failed(e.to_string()))?, count: counter.clone() };
  let mut tar = tar::Archive::new(bzip2::read::BzDecoder::new(io::BufReader::with_capacity(1 << 20, reader)));
  let wanted: BTreeMap<&str, &FileSpec> = files.iter().map(|file| (file.path.as_str(), file)).collect();
  let mut found = 0usize;
  let prefix = format!("{}/", root.trim_end_matches('/'));
  let entries = tar.entries().map_err(|e| failed(format!("The voice download is damaged: {e}")))?;
  for entry in entries {
    if cancel.load(Ordering::SeqCst) {
      return Err(DownloadError::Cancelled);
    }
    let mut entry = entry.map_err(|e| failed(format!("The voice download is damaged: {e}")))?;
    let name = entry.path().map_err(|e| failed(e.to_string()))?.to_string_lossy().replace('\\', "/");
    let name = name.trim_start_matches("./");
    let Some(inside) = name.strip_prefix(&prefix) else { continue };
    let Some(spec) = wanted.get(inside) else { continue };
    let relative = safe_relative(&spec.path).ok_or_else(|| failed("Unsafe path"))?;
    let target = staging.join(&relative);
    if !file_matches(&target, spec.size, &spec.sha256) {
      if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| failed(e.to_string()))?;
      }
      let partial = target.with_extension("extracting");
      let mut out = File::create(&partial).map_err(|e| failed(format!("Couldn't save the voice: {e}")))?;
      let mut hasher = Sha256::new();
      let mut written = 0u64;
      let mut buffer = vec![0u8; 1 << 16];
      loop {
        let read = entry.read(&mut buffer).map_err(|e| failed(format!("The voice download is damaged: {e}")))?;
        if read == 0 {
          break;
        }
        hasher.update(&buffer[..read]);
        out.write_all(&buffer[..read]).map_err(|e| failed(format!("Couldn't save the voice (is the disk full?): {e}")))?;
        written += read as u64;
        progress(*counter.lock().unwrap_or_else(|e| e.into_inner()), total);
        if cancel.load(Ordering::SeqCst) {
          drop(out);
          let _ = fs::remove_file(&partial);
          return Err(DownloadError::Cancelled);
        }
      }
      drop(out);
      let sha = hex::encode(hasher.finalize());
      if written != spec.size || !sha.eq_ignore_ascii_case(&spec.sha256) {
        let _ = fs::remove_file(&partial);
        return Err(failed(format!("{} is not the file it should be", spec.path)));
      }
      fs::rename(&partial, &target).map_err(|e| failed(e.to_string()))?;
    }
    found += 1;
    progress(*counter.lock().unwrap_or_else(|e| e.into_inner()), total);
    if found == wanted.len() {
      break;
    }
  }
  progress(total, total);
  if found < wanted.len() {
    let missing: Vec<&str> = wanted.keys().copied().filter(|path| !staging.join(path).is_file()).collect();
    return Err(failed(format!("The voice download is missing {}", missing.join(", "))));
  }
  Ok(())
}

struct CountingReader<R> {
  inner: R,
  count: Arc<Mutex<u64>>,
}

impl<R: Read> Read for CountingReader<R> {
  fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
    let read = self.inner.read(buf)?;
    *self.count.lock().unwrap_or_else(|e| e.into_inner()) += read as u64;
    Ok(read)
  }
}

/// Every file of the pack in `staging` and correct (`progress`: bytes checked).
pub fn verify_all(files: &[FileSpec], staging: &Path, mut progress: impl FnMut(u64, u64)) -> Result<(), DownloadError> {
  let total: u64 = files.iter().map(|file| file.size).sum();
  let mut done = 0;
  for file in files {
    let path = staging.join(safe_relative(&file.path).ok_or_else(|| failed("Unsafe path"))?);
    if !file_matches(&path, file.size, &file.sha256) {
      // Not kept: the next try fetches it again rather than trusting it.
      let _ = fs::remove_file(&path);
      return Err(failed(format!("{} is not the file it should be", file.path)));
    }
    done += file.size;
    progress(done, total);
  }
  Ok(())
}

/// Moves a finished staging folder into place (the old pack, if any, out of
/// the way first), and writes `install.json` inside it before the move.
pub fn install_staged(pack: &PackSpec, dirs: &PackDirs) -> Result<InstallInfo, DownloadError> {
  let variant = pack.chosen();
  let keep_threads = read_install(&dirs.dir).and_then(|info| info.threads);
  let info = InstallInfo {
    pack: pack.id.clone(),
    manifest_version: 1,
    variant: pack.variant.clone(),
    model: variant.model.clone(),
    bytes: pack.installed_size(),
    installed_at: chrono::Utc::now().to_rfc3339(),
    files: variant.files.iter().map(|file| (file.path.clone(), FileEntry { size: file.size, sha256: file.sha256.clone() })).collect(),
    self_test: None,
    threads: keep_threads,
  };
  write_install(&dirs.staging, &info).map_err(failed)?;
  if dirs.old.exists() {
    let _ = fs::remove_dir_all(&dirs.old);
  }
  if dirs.dir.exists() {
    fs::rename(&dirs.dir, &dirs.old).map_err(|e| failed(format!("Couldn't replace the voice (is it in use?): {e}")))?;
  }
  if let Err(error) = fs::rename(&dirs.staging, &dirs.dir) {
    // Put the old one back.
    let _ = fs::rename(&dirs.old, &dirs.dir);
    return Err(failed(format!("Couldn't install the voice: {error}")));
  }
  let _ = fs::remove_dir_all(&dirs.old);
  Ok(info)
}

/// The whole download: each source in turn until one gives every file.
pub async fn download_pack(
  client: &reqwest::Client,
  pack: &PackSpec,
  dirs: &PackDirs,
  cancel: &AtomicBool,
  report: &(dyn Fn(Progress) + Send + Sync),
) -> Result<InstallInfo, DownloadError> {
  let variant = pack.chosen();
  fs::create_dir_all(&dirs.staging).map_err(|e| failed(format!("Couldn't make room for the voice: {e}")))?;
  let mut last_error = failed("Nowhere to download the voice from");
  for source in &variant.sources {
    let result = match source {
      Source::Files { base } => fetch_files(client, base, &variant.files, &dirs.staging, cancel, report).await,
      Source::Archive { url, size, sha256, root } => fetch_archive(client, url, *size, sha256, root, &variant.files, dirs, cancel, report).await,
    };
    match result {
      Ok(()) => {
        let mut throttle = Throttle::new(report);
        verify_all(&variant.files, &dirs.staging, |done, total| throttle.tell(Phase::Verify, done, total))?;
        report(Progress { phase: Phase::Install, done: 0, total: 1 });
        let info = install_staged(pack, dirs)?;
        let _ = fs::remove_file(&dirs.archive);
        report(Progress { phase: Phase::Install, done: 1, total: 1 });
        return Ok(info);
      }
      Err(DownloadError::Cancelled) => return Err(DownloadError::Cancelled),
      Err(error) => last_error = error,
    }
  }
  Err(last_error)
}

async fn fetch_files(
  client: &reqwest::Client,
  base: &str,
  files: &[FileSpec],
  staging: &Path,
  cancel: &AtomicBool,
  report: &(dyn Fn(Progress) + Send + Sync),
) -> Result<(), DownloadError> {
  let total: u64 = files.iter().map(|file| file.size).sum();
  let mut throttle = Throttle::new(report);
  let mut before = 0u64;
  for file in files {
    let relative = safe_relative(&file.path).ok_or_else(|| failed("Unsafe path"))?;
    let target = staging.join(&relative);
    if !file_matches(&target, file.size, &file.sha256) {
      let partial = target.with_extension("part");
      let url = format!("{}/{}", base.trim_end_matches('/'), file.path);
      fetch_resumable(client, &url, &partial, file.size, cancel, |done| throttle.tell(Phase::Download, before + done, total)).await?;
      if !file_matches(&partial, file.size, &file.sha256) {
        let _ = fs::remove_file(&partial);
        return Err(failed(format!("{} is not the file it should be", file.path)));
      }
      fs::rename(&partial, &target).map_err(|e| failed(e.to_string()))?;
    }
    before += file.size;
    throttle.tell(Phase::Download, before, total);
  }
  Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn fetch_archive(
  client: &reqwest::Client,
  url: &str,
  size: u64,
  sha256: &str,
  root: &str,
  files: &[FileSpec],
  dirs: &PackDirs,
  cancel: &AtomicBool,
  report: &(dyn Fn(Progress) + Send + Sync),
) -> Result<(), DownloadError> {
  // Every file already gathered (an earlier run got as far as extracting them): no need for the archive.
  if files.iter().all(|file| dirs.staging.join(&file.path).is_file() && fs::metadata(dirs.staging.join(&file.path)).is_ok_and(|m| m.len() == file.size)) {
    return Ok(());
  }
  {
    let mut throttle = Throttle::new(report);
    fetch_resumable(client, url, &dirs.archive, size, cancel, |done| throttle.tell(Phase::Download, done, size)).await?;
  }
  let archive = dirs.archive.clone();
  let expected = sha256.to_string();
  let checked = tokio::task::spawn_blocking(move || sha256_file(&archive)).await.map_err(|e| failed(e.to_string()))?.map_err(|e| failed(e.to_string()))?;
  if !checked.eq_ignore_ascii_case(&expected) {
    // Re-uploaded upstream, or damaged: no use resuming it.
    let _ = fs::remove_file(&dirs.archive);
    return Err(failed(CHANGED_UPSTREAM));
  }
  let archive = dirs.archive.clone();
  let root = root.to_string();
  let files = files.to_vec();
  let staging = dirs.staging.clone();
  // The cancel flag lives with the caller; the blocking task needs its own handle.
  let flag = Arc::new(AtomicBool::new(cancel.load(Ordering::SeqCst)));
  let watcher = flag.clone();
  let latest = Arc::new(Mutex::new(None::<(u64, u64)>));
  let sink = latest.clone();
  let task = tokio::task::spawn_blocking(move || {
    extract_archive(&archive, &root, &files, &staging, &watcher, |done, total| {
      if let Ok(mut slot) = sink.lock() {
        *slot = Some((done, total));
      }
    })
  });
  tokio::pin!(task);
  let mut throttle = Throttle::new(report);
  loop {
    tokio::select! {
      result = &mut task => {
        return result.map_err(|e| failed(e.to_string()))?;
      }
      _ = tokio::time::sleep(Duration::from_millis(100)) => {
        if cancel.load(Ordering::SeqCst) {
          flag.store(true, Ordering::SeqCst);
        }
        let last = latest.lock().ok().and_then(|slot| *slot);
        if let Some((done, total)) = last {
          throttle.tell(Phase::Extract, done, total);
        }
      }
    }
  }
}

// ---- one download at a time -------------------------------------------------

static RUNNING: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

/// Claims the one download slot; None while another runs.
pub fn begin_download() -> Option<Arc<AtomicBool>> {
  let mut slot = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
  if slot.is_some() {
    return None;
  }
  let flag = Arc::new(AtomicBool::new(false));
  *slot = Some(flag.clone());
  Some(flag)
}

pub fn end_download() {
  *RUNNING.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

pub fn downloading() -> bool {
  RUNNING.lock().unwrap_or_else(|e| e.into_inner()).is_some()
}

pub fn cancel_download() {
  if let Some(flag) = RUNNING.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
    flag.store(true, Ordering::SeqCst);
  }
}

#[cfg(test)]
mod tests;
