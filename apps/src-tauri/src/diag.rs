//! Diagnostics: a small log file in the app-data folder, a panic hook that
//! writes to it, the report behind Settings → "Copy diagnostics", and a native
//! message box for failures that happen before there is a window to show them.
//!
//! The log holds what went wrong and where, never tokens, passwords or book
//! contents. It is capped at about 1 MB (one older file is kept), and nothing
//! leaves the computer unless the reader copies the report and sends it.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_BYTES: u64 = 1_000_000;
static WRITING: Mutex<()> = Mutex::new(());

/// `<app data>/logs/leaflet.log`.
pub fn log_path() -> Option<PathBuf> {
  crate::storage::app_data_dir().ok().map(|dir| dir.join("logs").join("leaflet.log"))
}

/// Appends one line. Never fails the caller: a log that cannot be written is
/// not worth an error of its own.
pub fn write(level: &str, message: &str) {
  #[cfg(debug_assertions)]
  eprintln!("[{level}] {message}");
  // A phone's stderr goes nowhere; `adb logcat -s Leaflet` shows these.
  #[cfg(target_os = "android")]
  logcat(level, message);
  let Some(path) = log_path() else {
    return;
  };
  let _held = WRITING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  if let Some(dir) = path.parent() {
    let _ = fs::create_dir_all(dir);
  }
  if fs::metadata(&path).map(|meta| meta.len() > MAX_BYTES).unwrap_or(false) {
    let _ = fs::rename(&path, path.with_extension("log.1"));
  }
  if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
    let one_line: String = message.chars().take(4000).collect::<String>().replace(['\r', '\n'], " | ");
    let _ = writeln!(file, "{} {level} {one_line}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f %z"));
  }
}

/// One line to Android's log, under the tag "Leaflet".
#[cfg(target_os = "android")]
fn logcat(level: &str, message: &str) {
  use std::ffi::CString;
  use std::os::raw::{c_char, c_int};
  #[link(name = "log")]
  extern "C" {
    fn __android_log_write(priority: c_int, tag: *const c_char, text: *const c_char) -> c_int;
  }
  // android/log.h: INFO 4, WARN 5, ERROR 6.
  let priority = match level {
    "ERROR" | "PANIC" => 6,
    "WARN" => 5,
    _ => 4
  };
  let (Ok(tag), Ok(text)) = (CString::new("Leaflet"), CString::new(message.replace('\0', " "))) else {
    return;
  };
  // SAFETY: both are valid, NUL-terminated and outlive the call.
  unsafe {
    __android_log_write(priority, tag.as_ptr(), text.as_ptr());
  }
}

pub fn info(message: &str) {
  write("INFO", message);
}

pub fn warn(message: &str) {
  write("WARN", message);
}

pub fn error(message: &str) {
  write("ERROR", message);
}

/// Panics are written to the log before the default hook runs, so a crash in
/// the field leaves a line saying what and where.
pub fn install_panic_hook() {
  let default = std::panic::take_hook();
  std::panic::set_hook(Box::new(move |info| {
    let location = info
      .location()
      .map(|place| format!("{}:{}", place.file(), place.line()))
      .unwrap_or_else(|| "unknown place".to_string());
    let payload = info
      .payload()
      .downcast_ref::<&str>()
      .map(|text| text.to_string())
      .or_else(|| info.payload().downcast_ref::<String>().cloned())
      .unwrap_or_else(|| "panic".to_string());
    write("PANIC", &format!("{payload} at {location}"));
    let place = info.location().map(|place| format!("{}:{}", panic_place(place.file()), place.line())).unwrap_or_default();
    note_pending_panic(&payload, &place);
    default(info);
  }));
}

/// Where a panic is noted for the app's next start, which reports its kind
/// (`take_pending_panics`, then `errorReports.ts`): a panic usually ends the
/// app before the page could send anything. Beside the log, a few lines at
/// most, and gone once read.
fn pending_path() -> Option<PathBuf> {
  log_path().map(|path| path.with_file_name("panics.pending"))
}
const PENDING_MAX_BYTES: u64 = 16 * 1024;
const PENDING_MAX: usize = 20;

/// A panic's place in the code as reported: the file inside its crate
/// ("sync/cloud.rs"), never the folders it was built in (which name the
/// builder's home folder) or the crate cache's.
pub fn panic_place(file: &str) -> String {
  let file = file.replace('\\', "/");
  let segments: Vec<&str> = file.split('/').filter(|segment| !segment.is_empty()).collect();
  if file.contains("/.cargo/") || file.contains("/rustc/") || file.contains("/registry/") {
    return segments[segments.len().saturating_sub(2)..].join("/");
  }
  match segments.iter().position(|segment| *segment == "src") {
    Some(at) => segments[at + 1..].join("/"),
    None => segments.last().map(|last| last.to_string()).unwrap_or_default()
  }
}

/// Notes one panic for the next start: its message and place, one line.
fn note_pending_panic(payload: &str, place: &str) {
  let Some(path) = pending_path() else {
    return;
  };
  if fs::metadata(&path).map(|meta| meta.len() > PENDING_MAX_BYTES).unwrap_or(false) {
    return;
  }
  if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
    let message: String = payload.chars().take(300).collect::<String>().replace(['\r', '\n', '\t'], " ");
    let _ = writeln!(file, "{message}\t{place}");
  }
}

/// The panics noted since the app last asked, as (message, place), and the
/// note removed, so each is reported once. The message is as it was: the
/// page scrubs it before it goes anywhere.
pub fn take_pending_panics() -> Vec<(String, String)> {
  let Some(path) = pending_path() else {
    return Vec::new();
  };
  let text = fs::read_to_string(&path).unwrap_or_default();
  let _ = fs::remove_file(&path);
  parse_pending(&text)
}

fn parse_pending(text: &str) -> Vec<(String, String)> {
  text
    .lines()
    .filter(|line| !line.trim().is_empty())
    .take(PENDING_MAX)
    .map(|line| match line.split_once('\t') {
      Some((message, place)) => (message.to_string(), place.to_string()),
      None => (line.to_string(), String::new())
    })
    .collect()
}

/// The last `lines` lines across the current and previous log file.
pub fn tail(lines: usize) -> String {
  let Some(path) = log_path() else {
    return String::new();
  };
  let older = fs::read_to_string(path.with_extension("log.1")).unwrap_or_default();
  let current = fs::read_to_string(&path).unwrap_or_default();
  let all: Vec<&str> = older.lines().chain(current.lines()).collect();
  all[all.len().saturating_sub(lines)..].join("\n")
}

/// Asks a yes/no question in a native dialog. For startup failures, before the
/// webview exists. Anywhere but Windows it logs the question and answers no.
pub fn ask(title: &str, text: &str) -> bool {
  #[cfg(windows)]
  {
    use windows::core::HSTRING;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONERROR, MB_YESNO};
    let answer = unsafe { MessageBoxW(None, &HSTRING::from(text), &HSTRING::from(title), MB_YESNO | MB_ICONERROR) };
    answer == IDYES
  }
  #[cfg(not(windows))]
  {
    write("ERROR", &format!("{title}: {text}"));
    false
  }
}

/// Tells the reader something went wrong, in a native dialog (Windows) or the log.
#[cfg(not(target_os = "android"))]
pub fn tell(title: &str, text: &str) {
  #[cfg(windows)]
  {
    use windows::core::HSTRING;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    unsafe {
      MessageBoxW(None, &HSTRING::from(text), &HSTRING::from(title), MB_OK | MB_ICONERROR);
    }
  }
  #[cfg(not(windows))]
  write("ERROR", &format!("{title}: {text}"));
}

#[cfg(test)]
mod pending_tests {
  use super::*;

  #[test]
  fn a_panics_place_is_the_file_in_its_crate_not_the_folders_around_it() {
    assert_eq!(panic_place("src\\sync\\cloud.rs"), "sync/cloud.rs");
    assert_eq!(panic_place("C:\\Users\\Ada\\Leaflet\\apps\\src-tauri\\src\\commands\\library.rs"), "commands/library.rs");
    assert_eq!(
      panic_place("C:\\Users\\Ada\\.cargo\\registry\\src\\index.crates.io-6f17d22bba15001f\\tokio-1.40.0\\src\\runtime\\park.rs"),
      "runtime/park.rs"
    );
    assert!(!panic_place("/home/ada/build/src/main.rs").contains("ada"));
  }

  #[test]
  fn noted_panics_are_read_back_a_few_at_most() {
    let text = "called `Option::unwrap()` on a `None` value\tsync/cloud.rs:12\nno place at all\n\n";
    assert_eq!(
      parse_pending(text),
      vec![
        ("called `Option::unwrap()` on a `None` value".to_string(), "sync/cloud.rs:12".to_string()),
        ("no place at all".to_string(), String::new())
      ]
    );
    assert_eq!(parse_pending(&"x\ty\n".repeat(50)).len(), PENDING_MAX);
  }
}
