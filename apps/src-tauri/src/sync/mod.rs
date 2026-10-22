//! Cross-device sync.
//!
//! [`merge`] owns the rules and knows nothing about where bytes come from.
//! [`store`] translates between those rules and this machine's database.
//! [`owner`] decides whose library this is, and so what each transport may
//! carry. [`folder`], [`drive`] and [`cloud`] are the three transports, and
//! they merge identically because none of them decides anything:
//!
//! * [`cloud`] talks to Leaflet's own API. Signed in, it carries the reading
//!   state, always: the account is where a library's state lives. It never
//!   carries book files.
//! * [`drive`] and [`folder`] carry the book files. Signed out, they carry the
//!   state as well, as they always have. Signed in, they keep a copy of the
//!   state for the owner's signed-out devices (the bridge), or carry files
//!   alone when they hold another account's library.
//!
//! A folder needs no account at all: a directory the reader's own cloud
//! client already syncs. Drive is for devices with no such client.

pub mod clock;
pub mod cloud;
/// Sign-in kept in a private file where there is no keychain (Android).
#[cfg(any(target_os = "android", test))]
pub mod device_secret;
pub mod drive;
pub mod folder;
pub mod large;
pub mod merge;
pub mod owner;
pub mod reading;
pub mod remote_config;
pub mod shared_doc;
pub mod store;

use anyhow::Result;
use oauth2::PkceCodeVerifier;
use tokio::sync::oneshot;

/// The half-finished OAuth exchange, held between "open the consent page" and
/// "the browser came back".
#[derive(Default)]
pub struct DriveState {
  /// Carries a `Result` rather than a bare code so a cancelled or timed-out
  /// consent screen arrives as an explanation instead of a dropped channel.
  pub pending_code_rx: Option<oneshot::Receiver<Result<String>>>,
  pub pkce_verifier: Option<PkceCodeVerifier>,
  pub redirect_uri: Option<String>
}

pub struct PendingAuth {
  pub code_rx: oneshot::Receiver<Result<String>>,
  pub pkce_verifier: PkceCodeVerifier,
  pub redirect_uri: String
}

impl DriveState {
  pub fn take_pending(&mut self) -> Option<PendingAuth> {
    let code_rx = self.pending_code_rx.take()?;
    let pkce_verifier = self.pkce_verifier.take()?;
    let redirect_uri = self.redirect_uri.take()?;
    Some(PendingAuth {
      code_rx,
      pkce_verifier,
      redirect_uri
    })
  }
}
