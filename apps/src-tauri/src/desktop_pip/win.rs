//! The Win32 calls desktop Pip needs, and nothing else.
//!
//! Tauri builds her window (transparent, no frame, always on top, never
//! focused); these do what it cannot, or cannot do from her thread without a
//! round trip to the main one:
//!
//! - moving and sizing the window in one call, without activating it;
//! - keeping it out of Alt+Tab (tao marks every unowned window as an app
//!   window, and "skip taskbar" only removes the taskbar button);
//! - where the pointer is, and whether its button is still down;
//! - what the window in front is, and what fills her monitor, to hide from a
//!   full-screen app.
//!
//! Every call here either posts to the window (`SWP_ASYNCWINDOWPOS`,
//! `ShowWindowAsync`) or only reads, so it is safe while her lock is held:
//! nothing waits on the main thread, which may itself be waiting for the lock.
//! The one exception is [`dress`], which is called before she is shared.

use super::Rect;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows::Win32::UI::Shell::{
  SHQueryUserNotificationState, QUNS_NOT_PRESENT, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN
};
use windows::Win32::UI::WindowsAndMessaging::{
  GetAncestor, GetClassNameW, GetCursorPos, GetForegroundWindow, GetSystemMetrics, GetWindowLongPtrW, GetWindowRect,
  IsWindow, SetWindowLongPtrW, SetWindowPos, ShowWindowAsync, WindowFromPoint, GA_ROOT, GWL_EXSTYLE, GWL_STYLE,
  SM_SWAPBUTTON, SWP_ASYNCWINDOWPOS, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE,
  SW_SHOWNOACTIVATE, WS_CAPTION, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW
};

/// A window handle as a number, so her state can cross threads.
pub type Handle = isize;

fn hwnd(handle: Handle) -> HWND {
  HWND(handle as *mut core::ffi::c_void)
}

pub fn handle_of(hwnd: HWND) -> Handle {
  hwnd.0 as isize
}

fn rect(from: RECT) -> Rect {
  Rect::new(from.left, from.top, from.right, from.bottom)
}

pub fn alive(handle: Handle) -> bool {
  unsafe { IsWindow(Some(hwnd(handle))).as_bool() }
}

/// Where the window is now, as Windows has it.
pub fn rect_of(handle: Handle) -> Option<Rect> {
  let mut found = RECT::default();
  unsafe { GetWindowRect(hwnd(handle), &mut found) }.ok().map(|_| rect(found))
}

/// Moves and sizes the window in one go, so growing upward for the sign is
/// one change on screen, not a resize and then a move. Never activates.
pub fn place(handle: Handle, to: Rect) {
  let _ = unsafe {
    SetWindowPos(
      hwnd(handle),
      None,
      to.left,
      to.top,
      to.width(),
      to.height(),
      SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE | SWP_NOZORDER
    )
  };
}

/// Shows or hides the window without taking the focus from whatever has it.
pub fn show(handle: Handle, on: bool) {
  let _ = unsafe { ShowWindowAsync(hwnd(handle), if on { SW_SHOWNOACTIVATE } else { SW_HIDE }) };
}

/// Makes the (still hidden) window a tool window that is never activated: no
/// taskbar button, no place in Alt+Tab or Task View, and a click on it leaves
/// the focus where it was.
///
/// This sends the window a message and waits, so it must not be called with
/// her lock held. tao rewrites these styles whenever one of its own window
/// flags changes, which is why nothing after this goes through tao's setters
/// (show, hide, always on top): `place` and `show` above are used instead.
pub fn dress(handle: Handle) {
  unsafe {
    let window = hwnd(handle);
    let before = GetWindowLongPtrW(window, GWL_EXSTYLE);
    let wanted = (before | (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize) & !(WS_EX_APPWINDOW.0 as isize);
    if wanted != before {
      SetWindowLongPtrW(window, GWL_EXSTYLE, wanted);
      let _ = SetWindowPos(
        window,
        None,
        0,
        0,
        0,
        0,
        SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
      );
    }
  }
}

/// The pointer, in physical pixels on the virtual desktop.
pub fn cursor() -> Option<(i32, i32)> {
  let mut point = POINT::default();
  unsafe { GetCursorPos(&mut point) }.ok().map(|_| (point.x, point.y))
}

/// Whether the button she is carried with is down: the left one, or the right
/// for a reader who has swapped them. Asked of Windows rather than trusted to
/// the page, so a `pointerup` that never arrives cannot leave her stuck to the
/// pointer.
pub fn button_down() -> bool {
  unsafe {
    let key = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
    (GetAsyncKeyState(i32::from(key.0)) as u16 & 0x8000) != 0
  }
}

/// A top-level window, as the full-screen check needs it.
pub struct Front {
  pub handle: Handle,
  pub rect: Rect,
  /// It has a title bar's style (a maximised window does, a full-screen one
  /// does not).
  pub captioned: bool,
  /// It is the desktop itself.
  pub shell: bool
}

fn describe(window: HWND) -> Option<Front> {
  unsafe {
    if window.0.is_null() {
      return None;
    }
    let mut found = RECT::default();
    GetWindowRect(window, &mut found).ok()?;
    let style = GetWindowLongPtrW(window, GWL_STYLE) as u32;
    let mut name = [0u16; 64];
    let length = GetClassNameW(window, &mut name).max(0) as usize;
    let class = String::from_utf16_lossy(&name[..length.min(name.len())]);
    Some(Front {
      handle: handle_of(window),
      rect: rect(found),
      captioned: style & WS_CAPTION.0 == WS_CAPTION.0,
      shell: class == "Progman" || class == "WorkerW"
    })
  }
}

/// The window the reader is working in.
pub fn foreground() -> Option<Front> {
  describe(unsafe { GetForegroundWindow() })
}

/// The top-level window showing at a point: a film left playing full screen
/// on her monitor is not the window in front while the reader types on
/// another. `WindowFromPoint` only asks windows of the calling thread whether
/// they are see-through there, and her thread has none, so this never waits
/// on another program.
pub fn window_at(x: i32, y: i32) -> Option<Front> {
  unsafe {
    let found = WindowFromPoint(POINT { x, y });
    if found.0.is_null() {
      return None;
    }
    let root = GetAncestor(found, GA_ROOT);
    describe(if root.0.is_null() { found } else { root })
  }
}

/// Windows' own word that this is no time to be on screen: a Direct3D app has
/// the display to itself, presentation mode is on, or nobody is there (locked,
/// a screen saver). `QUNS_BUSY` is left out on purpose: it is the shell's
/// guess at a full-screen window, and the check in `runtime` makes that one
/// itself, for the monitor she is on.
pub fn away() -> bool {
  match unsafe { SHQueryUserNotificationState() } {
    Ok(state) => state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE || state == QUNS_NOT_PRESENT,
    Err(_) => false
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Reads this machine's real desktop (it changes nothing and shows
  /// nothing), so it is kept out of the suite:
  /// `cargo test --lib desktop_pip::win -- --ignored --nocapture`.
  /// Prints what the calls see and what one look around costs.
  #[test]
  #[ignore]
  fn what_a_look_around_sees_and_costs_on_this_machine() {
    let front = foreground().expect("some window is in front");
    println!("in front: {:?} captioned={} shell={}", front.rect, front.captioned, front.shell);
    assert!(alive(front.handle));
    assert_eq!(rect_of(front.handle), Some(front.rect));
    let (x, y) = cursor().expect("the pointer is somewhere");
    println!("pointer: {x},{y}  button down: {}  away: {}", button_down(), away());
    let under = window_at(x, y).expect("a window is under the pointer");
    println!("under the pointer: {:?} captioned={} shell={}", under.rect, under.captioned, under.shell);
    assert!(under.rect.contains(x, y));

    let rounds = 2000;
    let started = std::time::Instant::now();
    for _ in 0..rounds {
      let _ = foreground();
      let _ = window_at(x, y);
      let _ = cursor();
      let _ = away();
      let _ = rect_of(front.handle);
    }
    let each = started.elapsed().as_secs_f64() * 1e6 / f64::from(rounds);
    println!("one look around: {each:.1} microseconds (she takes two a second while standing)");
    assert!(each < 5000.0, "{each}");
  }
}
