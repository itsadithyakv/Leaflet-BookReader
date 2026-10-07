//! Keeping the screen on while the page reads itself.

/// Asks Windows to keep the display on (`on`), or lets it sleep again.
///
/// While Dotty, auto-scroll or word-by-word is reading there is no key and no
/// mouse, so Windows took the reader for away and dimmed the page under them.
/// The request belongs to the thread that makes it, which is why this command
/// is not `async`: those run on the window's own thread, so the one that
/// asked is the one that lets go. It ends with the app in any case.
#[tauri::command]
pub fn keep_awake(on: bool) {
  #[cfg(windows)]
  {
    use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED};
    let state = if on { ES_CONTINUOUS | ES_DISPLAY_REQUIRED } else { ES_CONTINUOUS };
    // SAFETY: flags only; nothing is pointed at.
    unsafe {
      SetThreadExecutionState(state);
    }
  }
  #[cfg(not(windows))]
  let _ = on;
}
