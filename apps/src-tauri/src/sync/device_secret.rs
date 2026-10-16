//! Sign-in kept on a phone: the Leaflet session token and the Drive refresh
//! token, each in a small file in Leaflet's private data directory, sealed
//! with a key held in the Android Keystore.
//!
//! The `keyring` crate has no Android store (it falls back to an in-memory
//! mock), so on Android these files stand in for the system keychain behind
//! the same functions in `cloud.rs` and `drive.rs`.
//!
//! The key is an AES-256-GCM key made inside the Keystore and never leaves it
//! (`gen/android/.../SecretBox.kt` does the sealing; Rust reaches it by JNI,
//! not through the plugin, so it works from any thread, the main one too).
//! A sealed secret is `<name>.sealed`; the plain file `<name>` is what older
//! builds wrote, and is sealed and removed the first time it is read. When
//! the Keystore fails (some phones' do), the secret is kept as the plain,
//! owner-only file as before, and that is logged: the sign-in is never lost
//! to a broken Keystore. Android's app sandbox keeps other apps out of either.
//!
//! Elsewhere the keychain is used, and this module exists only for its tests.

use anyhow::{bail, Result};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// The Leaflet account's session token.
#[cfg(target_os = "android")]
pub const SESSION: &str = "account-session";
/// The Google Drive refresh token.
#[cfg(target_os = "android")]
pub const DRIVE_REFRESH: &str = "drive-refresh";

/// Seals and opens a secret with a key the caller never sees. `None` is "it
/// could not" (no Keystore, a key that is gone, bytes that are not its own).
pub trait Cipher {
  fn seal(&self, plain: &[u8]) -> Option<Vec<u8>>;
  fn open(&self, sealed: &[u8]) -> Option<Vec<u8>>;
}

/// The first bytes of a sealed file, so another format can follow one day.
const MAGIC: &[u8; 4] = b"LFS1";
const SEALED: &str = "sealed";

/// `<app data>/secrets`.
#[cfg(target_os = "android")]
fn dir() -> Result<PathBuf> {
  Ok(crate::storage::app_data_dir()?.join("secrets"))
}

#[cfg(target_os = "android")]
fn cipher() -> Option<keystore::Keystore> {
  static SAID: AtomicBool = AtomicBool::new(false);
  let cipher = keystore::Keystore::attached();
  if cipher.is_none() {
    warn_once(&SAID, "The Android Keystore is not attached; sign-in is kept in private storage unsealed.");
  }
  cipher
}

#[cfg(target_os = "android")]
pub fn store(name: &str, value: &str) -> Result<()> {
  let cipher = cipher();
  store_in(&dir()?, name, value, cipher.as_ref().map(|c| c as &dyn Cipher))
}

#[cfg(target_os = "android")]
pub fn load(name: &str) -> Option<String> {
  let cipher = cipher();
  load_in(&dir().ok()?, name, cipher.as_ref().map(|c| c as &dyn Cipher))
}

#[cfg(target_os = "android")]
pub fn clear(name: &str) {
  if let Ok(dir) = dir() {
    clear_in(&dir, name);
  }
}

/// Logged once a process: a Keystore that fails, fails on every read.
fn warn_once(said: &AtomicBool, message: &str) {
  if !said.swap(true, Ordering::Relaxed) {
    note(message);
  }
}

#[cfg(target_os = "android")]
fn note(message: &str) {
  crate::diag::warn(message);
}

/// Off the phone this module only runs in tests, which must not write to the real log.
#[cfg(not(target_os = "android"))]
fn note(_message: &str) {}

fn path_in(dir: &Path, name: &str) -> Result<PathBuf> {
  if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
    bail!("not a secret's name: {name}");
  }
  Ok(dir.join(name))
}

fn sealed_path_in(dir: &Path, name: &str) -> Result<PathBuf> {
  Ok(path_in(dir, name)?.with_extension(SEALED))
}

/// Writes `bytes` to `path` (in `dir`), replacing what was there in one step
/// (a write cut short leaves the old one, never half of the new). Owner-only.
fn write_whole(dir: &Path, path: &Path, bytes: &[u8]) -> Result<()> {
  fs::create_dir_all(dir)?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
  }
  let mut staging = path.as_os_str().to_owned();
  staging.push(".part");
  let staging = PathBuf::from(staging);
  let mut options = fs::OpenOptions::new();
  options.write(true).create(true).truncate(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  let mut file = options.open(&staging)?;
  file.write_all(bytes)?;
  file.sync_all()?;
  drop(file);
  fs::rename(&staging, path)?;
  Ok(())
}

/// Seals `value` with `cipher` and writes it as `<name>.sealed`; with no
/// cipher, or one that fails, writes it plain as `<name>`. Either way the
/// other file is removed, so there is one copy, and it is the newest.
pub fn store_in(dir: &Path, name: &str, value: &str, cipher: Option<&dyn Cipher>) -> Result<()> {
  static SAID: AtomicBool = AtomicBool::new(false);
  let plain = path_in(dir, name)?;
  let sealed = sealed_path_in(dir, name)?;
  if let Some(cipher) = cipher {
    if let Some(bytes) = cipher.seal(value.as_bytes()) {
      write_whole(dir, &sealed, &[MAGIC.as_slice(), &bytes].concat())?;
      let _ = fs::remove_file(&plain);
      return Ok(());
    }
    warn_once(&SAID, "The Android Keystore could not seal a sign-in; it is kept in private storage unsealed.");
  }
  write_whole(dir, &plain, value.as_bytes())?;
  let _ = fs::remove_file(&sealed);
  Ok(())
}

fn opened(cipher: &dyn Cipher, bytes: &[u8]) -> Option<String> {
  let body = bytes.strip_prefix(MAGIC.as_slice())?;
  String::from_utf8(cipher.open(body)?).ok()
}

fn non_empty(value: &str) -> Option<String> {
  let value = value.trim();
  (!value.is_empty()).then(|| value.to_string())
}

/// The value kept as `name`, or `None` when there is none (or it is empty).
///
/// The sealed copy is read first. A plain one (from an older build, or kept
/// while the Keystore failed) is sealed and removed once the cipher can; if
/// it cannot, the plain file stays and is still read.
pub fn load_in(dir: &Path, name: &str, cipher: Option<&dyn Cipher>) -> Option<String> {
  static SAID: AtomicBool = AtomicBool::new(false);
  let plain = path_in(dir, name).ok()?;
  let sealed = sealed_path_in(dir, name).ok()?;
  if let Ok(bytes) = fs::read(&sealed) {
    match cipher.and_then(|cipher| opened(cipher, &bytes)) {
      Some(value) => {
        // A plain copy beside a sealed one that opens is left from a cut-short move.
        let _ = fs::remove_file(&plain);
        return non_empty(&value);
      }
      None => warn_once(&SAID, "A sealed sign-in could not be opened (the Keystore failed or its key is gone)."),
    }
  }
  let value = non_empty(&fs::read_to_string(&plain).ok()?)?;
  if let Some(cipher) = cipher {
    // Moved into the sealed file; the plain one goes only once that is written.
    if let Some(bytes) = cipher.seal(value.as_bytes()) {
      if write_whole(dir, &sealed, &[MAGIC.as_slice(), &bytes].concat()).is_ok() {
        let _ = fs::remove_file(&plain);
      }
    }
  }
  Some(value)
}

/// Forgets `name`, sealed and plain. Nothing there is not an error.
pub fn clear_in(dir: &Path, name: &str) {
  if let Ok(path) = path_in(dir, name) {
    let _ = fs::remove_file(path);
  }
  if let Ok(path) = sealed_path_in(dir, name) {
    let _ = fs::remove_file(path);
  }
}

/// The Kotlin half (`SecretBox.kt`) by JNI. `SecretBox.attach()` is called
/// from `MainActivity.onCreate`, before the Rust app starts, and hands over
/// its class; from then on any thread can seal and open.
#[cfg(target_os = "android")]
mod keystore {
  use jni::objects::{GlobalRef, JByteArray, JClass, JValue};
  use jni::{JNIEnv, JavaVM};
  use std::sync::OnceLock;

  static SECRET_BOX: OnceLock<(JavaVM, GlobalRef)> = OnceLock::new();

  /// `SecretBox.attach()`: keeps the VM and the class (found here, on a
  /// thread that can see the app's classes, which a Rust thread cannot).
  #[no_mangle]
  pub extern "system" fn Java_com_leaflet_app_SecretBox_attach(env: JNIEnv, class: JClass) {
    if SECRET_BOX.get().is_some() {
      return;
    }
    if let (Ok(vm), Ok(class)) = (env.get_java_vm(), env.new_global_ref(&class)) {
      let _ = SECRET_BOX.set((vm, class));
    }
  }

  pub struct Keystore;

  impl Keystore {
    pub fn attached() -> Option<Self> {
      SECRET_BOX.get().map(|_| Keystore)
    }
  }

  impl super::Cipher for Keystore {
    fn seal(&self, plain: &[u8]) -> Option<Vec<u8>> {
      call("seal", plain)
    }

    fn open(&self, sealed: &[u8]) -> Option<Vec<u8>> {
      call("open", sealed)
    }
  }

  /// `SecretBox.<method>(byte[]): byte[]?`. Kotlin catches its own failures
  /// and answers null; a JNI failure is cleared here and is also `None`.
  fn call(method: &str, input: &[u8]) -> Option<Vec<u8>> {
    let (vm, class) = SECRET_BOX.get()?;
    let mut env = vm.attach_current_thread().ok()?;
    let answer = env.with_local_frame(8, |env| -> jni::errors::Result<Option<Vec<u8>>> {
      let array = env.byte_array_from_slice(input)?;
      let class: &JClass = class.as_obj().into();
      let result = env.call_static_method(class, method, "([B)[B", &[JValue::Object(&array)])?.l()?;
      if result.is_null() {
        return Ok(None);
      }
      Ok(Some(env.convert_byte_array(JByteArray::from(result))?))
    });
    match answer {
      Ok(bytes) => bytes,
      Err(_) => {
        let _ = env.exception_clear();
        None
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::cell::Cell;

  fn scratch(tag: &str) -> PathBuf {
    let stamp = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|time| time.as_nanos())
      .unwrap_or_default();
    std::env::temp_dir().join(format!("leaflet-secret-{tag}-{}-{stamp}", std::process::id())).join("secrets")
  }

  fn tidy(dir: &Path) {
    let _ = fs::remove_dir_all(dir.parent().unwrap_or(dir));
  }

  /// A stand-in for the Keystore: XOR with a key byte, and a marker so a
  /// wrong key (another phone's, a lost one) is refused as GCM would.
  struct Fake {
    key: u8,
    works: Cell<bool>
  }

  impl Fake {
    fn new(key: u8) -> Self {
      Fake { key, works: Cell::new(true) }
    }
  }

  impl Cipher for Fake {
    fn seal(&self, plain: &[u8]) -> Option<Vec<u8>> {
      self.works.get().then(|| std::iter::once(self.key).chain(plain.iter().map(|b| b ^ self.key)).collect())
    }

    fn open(&self, sealed: &[u8]) -> Option<Vec<u8>> {
      let (first, rest) = sealed.split_first()?;
      (self.works.get() && *first == self.key).then(|| rest.iter().map(|b| b ^ self.key).collect())
    }
  }

  #[test]
  fn a_secret_is_kept_replaced_and_forgotten() {
    let dir = scratch("round-trip");
    assert_eq!(load_in(&dir, "account-session", None), None, "nothing before it is stored");

    store_in(&dir, "account-session", "first-token", None).expect("stored");
    assert_eq!(load_in(&dir, "account-session", None).as_deref(), Some("first-token"));

    store_in(&dir, "account-session", "second-token", None).expect("replaced");
    assert_eq!(load_in(&dir, "account-session", None).as_deref(), Some("second-token"));
    assert!(!dir.join("account-session.part").exists(), "no staging file is left");

    // Each name is its own: the Drive token does not see the session's.
    assert_eq!(load_in(&dir, "drive-refresh", None), None);

    clear_in(&dir, "account-session");
    assert_eq!(load_in(&dir, "account-session", None), None);
    clear_in(&dir, "account-session");

    tidy(&dir);
  }

  /// Another account's library keeps its Drive token under its own name
  /// (`drive::slot_name`), beside the first library's.
  #[test]
  fn each_library_keeps_its_own_drive_token() {
    let dir = scratch("slots");
    let tag = "0123456789abcdef0123456789abcdef";
    let theirs = crate::sync::drive::slot_name("drive-refresh", Some(tag));
    assert_eq!(theirs, format!("drive-refresh-{tag}"));
    assert_eq!(crate::sync::drive::slot_name("drive-refresh", None), "drive-refresh");
    store_in(&dir, "drive-refresh", "first", None).expect("the first library's");
    store_in(&dir, &theirs, "second", None).expect("a name with a tag is accepted");
    assert_eq!(load_in(&dir, "drive-refresh", None).as_deref(), Some("first"));
    assert_eq!(load_in(&dir, &theirs, None).as_deref(), Some("second"));
    clear_in(&dir, &theirs);
    assert_eq!(load_in(&dir, &theirs, None), None);
    assert_eq!(load_in(&dir, "drive-refresh", None).as_deref(), Some("first"), "the other library's stays");
    tidy(&dir);
  }

  #[test]
  fn an_empty_secret_is_none_and_a_bad_name_is_refused() {
    let dir = scratch("odd");
    store_in(&dir, "drive-refresh", "  ", None).expect("stored");
    assert_eq!(load_in(&dir, "drive-refresh", None), None);
    assert!(store_in(&dir, "../escape", "x", None).is_err());
    assert!(store_in(&dir, "", "x", None).is_err());
    assert!(store_in(&dir, "a.sealed", "x", None).is_err(), "a name cannot reach the sealed file");
    tidy(&dir);
  }

  #[test]
  fn with_a_cipher_only_the_sealed_file_is_written() {
    let dir = scratch("sealed");
    let cipher = Fake::new(0x5a);
    store_in(&dir, "account-session", "token-123", Some(&cipher)).expect("stored");
    assert!(!dir.join("account-session").exists(), "no plain copy");
    let bytes = fs::read(dir.join("account-session.sealed")).expect("sealed file");
    assert!(bytes.starts_with(MAGIC));
    assert!(!bytes.windows(9).any(|window| window == b"token-123"), "the token is not in the file as text");
    assert!(!dir.join("account-session.sealed.part").exists(), "no staging file is left");
    assert_eq!(load_in(&dir, "account-session", Some(&cipher)).as_deref(), Some("token-123"));

    clear_in(&dir, "account-session");
    assert!(!dir.join("account-session.sealed").exists());
    assert_eq!(load_in(&dir, "account-session", Some(&cipher)), None);
    tidy(&dir);
  }

  #[test]
  fn an_old_plain_file_is_sealed_and_removed_on_first_read() {
    let dir = scratch("migrate");
    // What 1.4.x wrote.
    store_in(&dir, "drive-refresh", "refresh-abc", None).expect("stored plain");
    assert!(dir.join("drive-refresh").exists());

    let cipher = Fake::new(0x33);
    assert_eq!(load_in(&dir, "drive-refresh", Some(&cipher)).as_deref(), Some("refresh-abc"));
    assert!(!dir.join("drive-refresh").exists(), "the plain file is gone");
    assert!(dir.join("drive-refresh.sealed").exists(), "and the sealed one is there");
    assert_eq!(load_in(&dir, "drive-refresh", Some(&cipher)).as_deref(), Some("refresh-abc"));
    tidy(&dir);
  }

  #[test]
  fn a_failing_keystore_never_loses_the_sign_in() {
    let dir = scratch("failing");
    let cipher = Fake::new(0x11);
    cipher.works.set(false);

    // Storing falls back to the plain file.
    store_in(&dir, "account-session", "kept-anyway", Some(&cipher)).expect("stored");
    assert!(dir.join("account-session").exists());
    assert!(!dir.join("account-session.sealed").exists());

    // Reading leaves the plain file where it is while sealing fails.
    assert_eq!(load_in(&dir, "account-session", Some(&cipher)).as_deref(), Some("kept-anyway"));
    assert!(dir.join("account-session").exists());

    // Once the Keystore works again, the next read moves it.
    cipher.works.set(true);
    assert_eq!(load_in(&dir, "account-session", Some(&cipher)).as_deref(), Some("kept-anyway"));
    assert!(!dir.join("account-session").exists());
    assert!(dir.join("account-session.sealed").exists());
    tidy(&dir);
  }

  #[test]
  fn a_fallback_write_replaces_the_sealed_copy() {
    let dir = scratch("fallback");
    let cipher = Fake::new(0x44);
    store_in(&dir, "account-session", "old", Some(&cipher)).expect("sealed");
    cipher.works.set(false);
    store_in(&dir, "account-session", "new", Some(&cipher)).expect("plain");
    assert!(!dir.join("account-session.sealed").exists(), "the older sealed copy is gone");
    cipher.works.set(true);
    assert_eq!(load_in(&dir, "account-session", Some(&cipher)).as_deref(), Some("new"));
    tidy(&dir);
  }

  #[test]
  fn a_sealed_file_another_key_cannot_open_is_none_but_kept() {
    // A backup restored to a new phone: the file came, the Keystore's key did not.
    let dir = scratch("other-key");
    store_in(&dir, "drive-refresh", "from-the-old-phone", Some(&Fake::new(0x01))).expect("sealed");
    let here = Fake::new(0x02);
    assert_eq!(load_in(&dir, "drive-refresh", Some(&here)), None);
    assert!(dir.join("drive-refresh.sealed").exists(), "not deleted: a later read may open it");
    assert_eq!(load_in(&dir, "drive-refresh", None), None, "and no cipher at all is none too");

    // Signing in again replaces it.
    store_in(&dir, "drive-refresh", "fresh", Some(&here)).expect("sealed");
    assert_eq!(load_in(&dir, "drive-refresh", Some(&here)).as_deref(), Some("fresh"));
    tidy(&dir);
  }

  #[test]
  fn a_plain_copy_left_beside_a_sealed_one_is_cleared() {
    let dir = scratch("both");
    let cipher = Fake::new(0x77);
    store_in(&dir, "account-session", "sealed-one", Some(&cipher)).expect("sealed");
    fs::write(dir.join("account-session"), "stale-plain").expect("plain");
    assert_eq!(load_in(&dir, "account-session", Some(&cipher)).as_deref(), Some("sealed-one"));
    assert!(!dir.join("account-session").exists());
    tidy(&dir);
  }

  #[cfg(unix)]
  #[test]
  fn only_the_owner_can_read_it() {
    use std::os::unix::fs::PermissionsExt;
    let dir = scratch("mode");
    store_in(&dir, "account-session", "token", None).expect("stored");
    let mode = fs::metadata(dir.join("account-session")).expect("there").permissions().mode();
    assert_eq!(mode & 0o077, 0, "no one but the owner");
    store_in(&dir, "drive-refresh", "token", Some(&Fake::new(9))).expect("stored");
    let mode = fs::metadata(dir.join("drive-refresh.sealed")).expect("there").permissions().mode();
    assert_eq!(mode & 0o077, 0, "sealed too");
    tidy(&dir);
  }
}
