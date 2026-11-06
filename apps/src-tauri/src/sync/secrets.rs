//! Where a sign-in is kept between launches: the Leaflet account's session
//! token and the Drive refresh token.
//!
//! On Windows, macOS and Linux that is the system keychain, through the
//! `keyring` crate, under the names these tokens have always had. The crate
//! has no store for Android or iOS: there it keeps a secret in memory and
//! reports success, which is how a phone came to be signed out at every
//! launch. On those two a secret goes to a file in the app's private data
//! folder instead, which other apps cannot read.
//!
//! That file is not the Android Keystore. Wrapping it in a Keystore key needs
//! Kotlin and a device to try it on, and is stage 1 of docs/mobile.md; see
//! docs/two-devices.md.

use anyhow::Result;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// Keeps a secret under a service and a user, as a keychain names things.
pub fn set(service: &str, user: &str, value: &str) -> Result<()> {
  #[cfg(any(target_os = "android", target_os = "ios"))]
  {
    file_set(&private_file()?, &name(service, user), value)
  }
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
    keyring::Entry::new(service, user)
      .and_then(|entry| entry.set_password(value))
      .map_err(|error| anyhow::anyhow!("{error}"))
  }
}

/// The secret kept there, if there is one.
pub fn get(service: &str, user: &str) -> Option<String> {
  #[cfg(any(target_os = "android", target_os = "ios"))]
  let found = private_file().ok().and_then(|path| file_get(&path, &name(service, user)));
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  let found = keyring::Entry::new(service, user).and_then(|entry| entry.get_password()).ok();
  found.filter(|value| !value.is_empty())
}

/// Forgets it. Nothing there is not an error.
pub fn clear(service: &str, user: &str) {
  #[cfg(any(target_os = "android", target_os = "ios"))]
  if let Ok(path) = private_file() {
    let _ = file_clear(&path, &name(service, user));
  }
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  if let Ok(entry) = keyring::Entry::new(service, user) {
    let _ = entry.delete_credential();
  }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn private_file() -> Result<std::path::PathBuf> {
  Ok(crate::storage::app_data_dir()?.join("sign-ins.json"))
}

#[cfg_attr(not(any(target_os = "android", target_os = "ios", test)), allow(dead_code))]
fn name(service: &str, user: &str) -> String {
  format!("{service}/{user}")
}

// ---- the file a phone keeps them in ----------------------------------------
// Compiled everywhere so it is tested where the tests run.

#[cfg_attr(not(any(target_os = "android", target_os = "ios", test)), allow(dead_code))]
fn file_read(path: &Path) -> BTreeMap<String, String> {
  fs::read(path)
    .ok()
    .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    .unwrap_or_default()
}

/// Written through a temporary file beside it, so a phone stopped mid-write
/// leaves the old sign-ins, not half a file; and readable by this app alone.
#[cfg_attr(not(any(target_os = "android", target_os = "ios", test)), allow(dead_code))]
fn file_write(path: &Path, secrets: &BTreeMap<String, String>) -> Result<()> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)?;
  }
  let temporary = path.with_extension("json.part");
  fs::write(&temporary, serde_json::to_vec(secrets)?)?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
  }
  fs::rename(&temporary, path)?;
  Ok(())
}

#[cfg_attr(not(any(target_os = "android", target_os = "ios", test)), allow(dead_code))]
fn file_set(path: &Path, name: &str, value: &str) -> Result<()> {
  let mut secrets = file_read(path);
  secrets.insert(name.to_string(), value.to_string());
  file_write(path, &secrets)
}

#[cfg_attr(not(any(target_os = "android", target_os = "ios", test)), allow(dead_code))]
fn file_get(path: &Path, name: &str) -> Option<String> {
  file_read(path).remove(name)
}

#[cfg_attr(not(any(target_os = "android", target_os = "ios", test)), allow(dead_code))]
fn file_clear(path: &Path, name: &str) -> Result<()> {
  let mut secrets = file_read(path);
  if secrets.remove(name).is_none() {
    return Ok(());
  }
  if secrets.is_empty() {
    let _ = fs::remove_file(path);
    return Ok(());
  }
  file_write(path, &secrets)
}

#[cfg(test)]
mod tests {
  use super::*;

  struct Scratch(std::path::PathBuf);

  impl Scratch {
    fn new(label: &str) -> Self {
      let dir = std::env::temp_dir().join(format!("leaflet-secrets-{label}-{}", std::process::id()));
      let _ = fs::remove_dir_all(&dir);
      Scratch(dir)
    }
    fn file(&self) -> std::path::PathBuf {
      self.0.join("sign-ins.json")
    }
  }

  impl Drop for Scratch {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  /// What a phone needs: a sign-in is still there the next time the app starts.
  #[test]
  fn a_secret_in_the_file_outlives_the_process_that_wrote_it() {
    let scratch = Scratch::new("outlives");
    let (account, drive) = (name("app.leaflet.account", "session-token"), name("app.leaflet.drive", "refresh-token"));

    assert_eq!(file_get(&scratch.file(), &account), None, "nothing kept yet, and no file is not an error");
    file_set(&scratch.file(), &account, "a session").expect("set");
    file_set(&scratch.file(), &drive, "a refresh token").expect("set");

    // Read back from the file alone, as a fresh launch does.
    assert_eq!(file_get(&scratch.file(), &account).as_deref(), Some("a session"));
    assert_eq!(file_get(&scratch.file(), &drive).as_deref(), Some("a refresh token"));

    file_set(&scratch.file(), &account, "a newer session").expect("replace");
    assert_eq!(file_get(&scratch.file(), &account).as_deref(), Some("a newer session"));
    assert_eq!(file_get(&scratch.file(), &drive).as_deref(), Some("a refresh token"), "the other is untouched");
  }

  #[test]
  fn signing_out_forgets_one_and_leaves_no_empty_file() {
    let scratch = Scratch::new("forgets");
    let (account, drive) = (name("app.leaflet.account", "session-token"), name("app.leaflet.drive", "refresh-token"));
    file_set(&scratch.file(), &account, "a session").expect("set");
    file_set(&scratch.file(), &drive, "a refresh token").expect("set");

    file_clear(&scratch.file(), &account).expect("clear");
    assert_eq!(file_get(&scratch.file(), &account), None);
    assert_eq!(file_get(&scratch.file(), &drive).as_deref(), Some("a refresh token"));

    file_clear(&scratch.file(), &drive).expect("clear");
    assert!(!scratch.file().exists(), "nothing left to keep");
    file_clear(&scratch.file(), &drive).expect("forgetting what is not there is fine");
  }

  /// A file cut short (the phone stopped the app mid-write, before the rename
  /// existed) reads as no sign-ins, not as a crash.
  #[test]
  fn a_damaged_file_reads_as_signed_out() {
    let scratch = Scratch::new("damaged");
    fs::create_dir_all(&scratch.0).expect("dir");
    fs::write(scratch.file(), b"{ \"app.leaflet.account/session-to").expect("write");
    assert_eq!(file_get(&scratch.file(), &name("app.leaflet.account", "session-token")), None);
    file_set(&scratch.file(), "a/b", "kept").expect("and can be written again");
    assert_eq!(file_get(&scratch.file(), "a/b").as_deref(), Some("kept"));
  }
}
