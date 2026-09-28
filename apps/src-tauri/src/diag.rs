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
    default(info);
  }));
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
