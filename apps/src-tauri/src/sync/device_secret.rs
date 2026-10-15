//! Sign-in kept on a phone: the Leaflet session token and the Drive refresh
//! token, each in a small file in Leaflet's private data directory.
//!
//! The `keyring` crate has no Android store (it falls back to an in-memory
//! mock), so on Android these files stand in for the system keychain behind
//! the same functions in `cloud.rs` and `drive.rs`. Android's app sandbox
//! already keeps other apps out of that directory; the files are owner-only
//! as well. (The Android Keystore is the better home and comes later.)
//!
//! Elsewhere the keychain is used, and this module exists only for its tests.

use anyhow::{bail, Result};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The Leaflet account's session token.
#[cfg(target_os = "android")]
pub const SESSION: &str = "account-session";
/// The Google Drive refresh token.
#[cfg(target_os = "android")]
pub const DRIVE_REFRESH: &str = "drive-refresh";

/// `<app data>/secrets`.
#[cfg(target_os = "android")]
fn dir() -> Result<PathBuf> {
  Ok(crate::storage::app_data_dir()?.join("secrets"))
}

#[cfg(target_os = "android")]
pub fn store(name: &str, value: &str) -> Result<()> {
  store_in(&dir()?, name, value)
}

#[cfg(target_os = "android")]
pub fn load(name: &str) -> Option<String> {
  load_in(&dir().ok()?, name)
}

#[cfg(target_os = "android")]
pub fn clear(name: &str) {
  if let Ok(dir) = dir() {
    clear_in(&dir, name);
  }
}

fn path_in(dir: &Path, name: &str) -> Result<PathBuf> {
  if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
    bail!("not a secret's name: {name}");
  }
  Ok(dir.join(name))
}

/// Writes `value` as `name` in `dir`, replacing what was there in one step
/// (a write cut short leaves the old one, never half of the new).
pub fn store_in(dir: &Path, name: &str, value: &str) -> Result<()> {
  let path = path_in(dir, name)?;
  fs::create_dir_all(dir)?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
  }
  let staging = dir.join(format!("{name}.part"));
  let mut options = fs::OpenOptions::new();
  options.write(true).create(true).truncate(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  let mut file = options.open(&staging)?;
  file.write_all(value.as_bytes())?;
  file.sync_all()?;
  drop(file);
  fs::rename(&staging, &path)?;
  Ok(())
}

/// The value kept as `name`, or `None` when there is none (or it is empty).
pub fn load_in(dir: &Path, name: &str) -> Option<String> {
  let value = fs::read_to_string(path_in(dir, name).ok()?).ok()?;
  let value = value.trim();
  (!value.is_empty()).then(|| value.to_string())
}

/// Forgets `name`. Nothing there is not an error.
pub fn clear_in(dir: &Path, name: &str) {
  if let Ok(path) = path_in(dir, name) {
    let _ = fs::remove_file(path);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn scratch(tag: &str) -> PathBuf {
    let stamp = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|time| time.as_nanos())
      .unwrap_or_default();
    std::env::temp_dir().join(format!("leaflet-secret-{tag}-{}-{stamp}", std::process::id())).join("secrets")
  }

  #[test]
  fn a_secret_is_kept_replaced_and_forgotten() {
    let dir = scratch("round-trip");
    assert_eq!(load_in(&dir, "account-session"), None, "nothing before it is stored");

    store_in(&dir, "account-session", "first-token").expect("stored");
    assert_eq!(load_in(&dir, "account-session").as_deref(), Some("first-token"));

    store_in(&dir, "account-session", "second-token").expect("replaced");
    assert_eq!(load_in(&dir, "account-session").as_deref(), Some("second-token"));
    assert!(!dir.join("account-session.part").exists(), "no staging file is left");

    // Each name is its own: the Drive token does not see the session's.
    assert_eq!(load_in(&dir, "drive-refresh"), None);

    clear_in(&dir, "account-session");
    assert_eq!(load_in(&dir, "account-session"), None);
    clear_in(&dir, "account-session");

    let _ = fs::remove_dir_all(dir.parent().unwrap_or(&dir));
  }

  #[test]
  fn an_empty_secret_is_none_and_a_bad_name_is_refused() {
    let dir = scratch("odd");
    store_in(&dir, "drive-refresh", "  ").expect("stored");
    assert_eq!(load_in(&dir, "drive-refresh"), None);
    assert!(store_in(&dir, "../escape", "x").is_err());
    assert!(store_in(&dir, "", "x").is_err());
    let _ = fs::remove_dir_all(dir.parent().unwrap_or(&dir));
  }

  #[cfg(unix)]
  #[test]
  fn only_the_owner_can_read_it() {
    use std::os::unix::fs::PermissionsExt;
    let dir = scratch("mode");
    store_in(&dir, "account-session", "token").expect("stored");
    let mode = fs::metadata(dir.join("account-session")).expect("there").permissions().mode();
    assert_eq!(mode & 0o077, 0, "no one but the owner");
    let _ = fs::remove_dir_all(dir.parent().unwrap_or(&dir));
  }
}
