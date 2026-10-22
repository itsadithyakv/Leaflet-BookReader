//! What the main window is made of: Windows 11's Mica behind a see-through
//! webview, or an ordinary opaque window.
//!
//! Mica is drawn by the compositor from the desktop wallpaper, once, and costs
//! nothing while the window is moved or resized. Windows 10 has no Mica, and
//! its Acrylic lags behind the pointer while a window is dragged, so it gets
//! the opaque window it always had. macOS would take vibrancy, but a see-through
//! window there needs the private-API feature, which Leaflet does not build
//! with (and no Mac build ships); Linux has no window material at all.
//!
//! Mica goes with the full visual effects only (Settings → Visual effects:
//! Full), which a reader has to choose: the default, Smooth, is an opaque
//! window. A see-through WebView2 is composited with the desktop on every
//! frame, its text loses ClearType (there is no opaque layer to draw it on),
//! and the page's own scroller cannot be an opaque layer either, so each
//! scrolled frame was painted again; 1.5.10's laptops felt it.
//!
//! The choice is made before the window exists, because a webview is made
//! see-through only when it is created. The page keeps the reader's choice
//! in a small file beside the library (`window_material_effects`), read here
//! at launch, so a change in Settings reaches the window at the next start.
//! The page learns the material from a script run before its own
//! (`data-window-material` on `<html>`), so its first paint is already right
//! for the window it is in (`styles/window-material.css`).

use std::path::Path;

/// The window's material.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Material {
  /// Windows 11's Mica: the window and the webview are see-through.
  Mica,
  /// An opaque window; the page paints its own background.
  None
}

/// The first Windows 11 build: Mica is there from here (by its documented
/// attribute from 22523, by the earlier undocumented one before).
const FIRST_MICA_BUILD: u32 = 22_000;

/// Which material, on which system: `os` as `std::env::consts::OS`, and the
/// Windows build where there is one.
pub fn choose(os: &str, windows_build: Option<u32>) -> Material {
  match (os, windows_build) {
    ("windows", Some(build)) if build >= FIRST_MICA_BUILD => Material::Mica,
    _ => Material::None
  }
}

/// The material for the system this is running on, when the reader chose the
/// full effects; an opaque window otherwise.
pub fn detect(full_effects: bool) -> Material {
  if !full_effects {
    return Material::None;
  }
  #[cfg(windows)]
  let build = Some(windows_version::OsVersion::current().build);
  #[cfg(not(windows))]
  let build = None;
  choose(std::env::consts::OS, build)
}

/// The file beside the library that says the reader chose the full effects.
const FULL_EFFECTS_FILE: &str = "visual-effects-full";

/// Whether the reader chose the full effects, as the page last said (in the
/// app's data folder, `dir`). No folder, or no file: no.
pub fn full_effects_chosen(dir: Option<&Path>) -> bool {
  dir.map(|dir| dir.join(FULL_EFFECTS_FILE).is_file()).unwrap_or(false)
}

/// Keeps the reader's choice for the next launch.
pub fn remember_full_effects(dir: &Path, full: bool) -> std::io::Result<()> {
  let file = dir.join(FULL_EFFECTS_FILE);
  if full {
    if file.is_file() {
      return Ok(());
    }
    std::fs::create_dir_all(dir)?;
    std::fs::write(file, "full")
  } else {
    match std::fs::remove_file(file) {
      Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
      _ => Ok(())
    }
  }
}

/// The page's word on the visual effects (Settings), kept for the window made
/// at the next launch: Mica with Full, an opaque window without.
#[tauri::command]
pub async fn window_material_effects(app: tauri::AppHandle, full: bool) -> Result<(), String> {
  use tauri::Manager;
  let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
  remember_full_effects(&dir, full).map_err(|error| error.to_string())
}

// (A phone gets no script: its page is always "none".)
#[cfg_attr(not(desktop), allow(dead_code))]
impl Material {
  pub fn name(self) -> &'static str {
    match self {
      Material::Mica => "mica",
      Material::None => "none"
    }
  }

  /// The script that tells the page, before any of its own runs. `<html>` may
  /// not exist yet when it runs, so it waits for it if need be.
  pub fn page_script(self) -> String {
    format!(
      r#"(function () {{
  var material = "{}";
  window.__LEAFLET_WINDOW_MATERIAL__ = material;
  var mark = function () {{
    if (!document.documentElement) return false;
    document.documentElement.setAttribute("data-window-material", material);
    return true;
  }};
  if (!mark()) {{
    new MutationObserver(function (_, observer) {{
      if (mark()) observer.disconnect();
    }}).observe(document, {{ childList: true }});
  }}
}})();"#,
      self.name()
    )
  }
}

/// The window's light or dark, from the app's theme: Mica's tint and the title
/// bar follow it. `None` follows Windows (the reader chose "follow the system").
/// (Async: it only posts to the window's thread, and need not hold the main one.)
#[tauri::command]
pub async fn window_material_theme(window: tauri::WebviewWindow, theme: Option<String>) {
  #[cfg(desktop)]
  {
    let theme = match theme.as_deref() {
      Some("dark") => Some(tauri::Theme::Dark),
      Some("light") => Some(tauri::Theme::Light),
      _ => None
    };
    let _ = window.set_theme(theme);
  }
  #[cfg(not(desktop))]
  let _ = (window, theme);
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn mica_from_the_first_windows_11_build() {
    assert_eq!(choose("windows", Some(22_000)), Material::Mica);
    assert_eq!(choose("windows", Some(22_631)), Material::Mica);
    assert_eq!(choose("windows", Some(26_200)), Material::Mica);
  }

  #[test]
  fn windows_10_stays_opaque() {
    // 19045 is Windows 10 22H2, the last; Acrylic there lags while dragging.
    assert_eq!(choose("windows", Some(19_045)), Material::None);
    assert_eq!(choose("windows", Some(21_999)), Material::None);
    assert_eq!(choose("windows", None), Material::None);
  }

  #[test]
  fn other_systems_stay_opaque() {
    assert_eq!(choose("macos", None), Material::None);
    assert_eq!(choose("linux", None), Material::None);
    assert_eq!(choose("android", None), Material::None);
    // A build number means nothing off Windows.
    assert_eq!(choose("linux", Some(30_000)), Material::None);
  }

  #[test]
  fn an_opaque_window_unless_the_full_effects_were_chosen() {
    // Smooth, the default everywhere: no Mica even on Windows 11.
    assert_eq!(detect(false), Material::None);
  }

  #[test]
  fn the_choice_is_kept_beside_the_library() {
    let dir = std::env::temp_dir().join(format!("leaflet-effects-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    assert!(!full_effects_chosen(None));
    // Never told: no folder yet, and not chosen.
    assert!(!full_effects_chosen(Some(&dir)));
    // Turning Full off before it was ever on is fine.
    remember_full_effects(&dir, false).expect("nothing to remove");
    remember_full_effects(&dir, true).expect("kept");
    assert!(full_effects_chosen(Some(&dir)));
    remember_full_effects(&dir, true).expect("kept again");
    remember_full_effects(&dir, false).expect("taken back");
    assert!(!full_effects_chosen(Some(&dir)));
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn the_page_script_names_the_material() {
    let script = Material::Mica.page_script();
    assert!(script.contains(r#"var material = "mica";"#));
    assert!(script.contains("data-window-material"));
    assert!(Material::None.page_script().contains(r#""none""#));
  }
}
