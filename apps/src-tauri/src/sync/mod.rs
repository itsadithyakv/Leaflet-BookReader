//! Cross-device sync.
//!
//! [`merge`] owns the rules and knows nothing about where bytes come from.
//! [`store`] translates between those rules and this machine's database.
//! [`folder`], [`drive`] and [`cloud`] are the three transports, and they behave
//! identically because none of them decides anything:
//!
//! * [`folder`] needs no account at all — a directory the reader's own cloud
//!   client already syncs.
//! * [`drive`] is for devices with no such client, and carries the book files.
//! * [`cloud`] talks to Leaflet's own API. It carries the state document only,
//!   and exists for the one thing the others cannot do: compare readers to each
//!   other for the leaderboard.

pub mod cloud;
pub mod drive;
pub mod folder;
pub mod merge;
pub mod remote_config;
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
