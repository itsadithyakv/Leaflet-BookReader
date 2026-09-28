//! Finding Leaflet's server without baking its address into the app.
//!
//! The app ships with one fixed URL: a small config file on GitHub Pages. It
//! names the API base, so the server can move (a new domain, a new machine)
//! with a one-line change and no Store update.
//!
//! The file is signed with PaperKite's Ed25519 key and only the public half is
//! compiled in here. Readers' passwords travel to whatever this file names, so
//! an unsigned or tampered file (a compromised repo, a spoofed network) is
//! ignored and the last good address stays in use. `site/sign-config.mjs`
//! produces the file.

use crate::db::Database;
use crate::sync::cloud;
use anyhow::{anyhow, Result};
use base64::Engine;
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::Deserialize;
use std::time::Duration;
use crate::LockExt;

/// Where the config lives. A build can point elsewhere (a staging site).
const DEFAULT_CONFIG_URL: &str = "https://itsadithyakv.github.io/Leaflet-BookReader/config.json";
/// PaperKite's config-signing public key (raw Ed25519, base64). The private key
/// lives outside the repo; see docs/release-msix.md for rotating it.
const PUBLIC_KEY: &str = "MPUaW9kE/6v0I1pHoQdyHA8fxYC96mtcevkrPFpC8Es=";

pub const REMOTE_API_SETTING: &str = "remote_api_base";
const ISSUED_SETTING: &str = "remote_config_issued_at";

#[derive(Deserialize)]
struct Envelope {
  payload: String,
  signature: String
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConfig {
  pub version: u32,
  pub api_base: String,
  pub issued_at: String
}

fn config_url() -> &'static str {
  option_env!("LEAFLET_CONFIG_URL").filter(|value| !value.is_empty()).unwrap_or(DEFAULT_CONFIG_URL)
}

/// Checks the signature over the exact payload bytes, then parses them.
pub fn verify(body: &str, public_key: &[u8]) -> Result<RemoteConfig> {
  let envelope: Envelope = serde_json::from_str(body).map_err(|_| anyhow!("Config is not in the expected format."))?;
  let engine = base64::engine::general_purpose::STANDARD;
  let payload = engine.decode(envelope.payload.trim()).map_err(|_| anyhow!("Config payload is not base64."))?;
  let signature = engine.decode(envelope.signature.trim()).map_err(|_| anyhow!("Config signature is not base64."))?;
  UnparsedPublicKey::new(&ED25519, public_key)
    .verify(&payload, &signature)
    .map_err(|_| anyhow!("Config signature does not match; ignoring it."))?;
  let config: RemoteConfig = serde_json::from_slice(&payload).map_err(|_| anyhow!("Config payload is not valid."))?;
  if config.version != 1 {
    return Err(anyhow!("Config version {} is newer than this app understands.", config.version));
  }
  // Only https, even though localhost http is fine for a hand-set address.
  if !config.api_base.starts_with("https://") {
    return Err(anyhow!("Config names a non-https server; ignoring it."));
  }
  Ok(config)
}

fn public_key() -> Vec<u8> {
  base64::engine::general_purpose::STANDARD.decode(PUBLIC_KEY).unwrap_or_default()
}

/// The last verified address, if any.
pub fn cached(db: &Database) -> Option<String> {
  db.get_setting(REMOTE_API_SETTING)
    .ok()
    .flatten()
    .and_then(|value| cloud::normalise_api_base(&value).ok())
    .filter(|value| !value.is_empty())
}

/// Fetches, verifies and caches the config. Failures leave the cache alone:
/// offline, GitHub down or a bad file all mean "keep using the last good one".
pub async fn refresh(db_mutex: &std::sync::Mutex<Database>) -> Result<Option<String>> {
  let client = reqwest::Client::builder().timeout(Duration::from_secs(8)).build()?;
  let body = client.get(config_url()).send().await?.error_for_status()?.text().await?;
  let config = verify(&body, &public_key())?;
  let base = cloud::normalise_api_base(&config.api_base)?;

  let db = db_mutex.guard();
  // Never step back to an older signed file: a replayed old config could
  // point at a server that has since been retired and taken over.
  let previous = db.get_setting(ISSUED_SETTING)?.unwrap_or_default();
  if !previous.is_empty() && config.issued_at < previous {
    return Ok(cached(&db));
  }
  db.set_setting(REMOTE_API_SETTING, &base)?;
  db.set_setting(ISSUED_SETTING, &config.issued_at)?;
  Ok(Some(base))
}

#[cfg(test)]
mod tests {
  use super::*;

  // Produced by site/sign-config.mjs with the key whose public half is PUBLIC_KEY.
  const SIGNED: &str = r#"{
    "payload": "eyJ2ZXJzaW9uIjoxLCJhcGlCYXNlIjoiaHR0cHM6Ly9sZWFmbGV0YXBwLmR1Y2tkbnMub3JnIiwiaXNzdWVkQXQiOiIyMDI2LTA5LTI3VDEyOjA0OjI4LjM5NFoifQ==",
    "signature": "a3v48cVfWcbN4fVY85pOKC0GNwgRZsOseiHnWoBh39QLFVmdJ3p0kep8eohiU0sH3K/xI0nACbsZz/+rep2cBA=="
  }"#;

  #[test]
  fn a_signed_config_verifies() {
    let config = verify(SIGNED, &public_key()).expect("signed config should verify");
    assert_eq!(config.api_base, "https://leafletapp.duckdns.org");
    assert_eq!(config.version, 1);
  }

  #[test]
  fn a_tampered_payload_is_refused() {
    // Same signature, payload pointing somewhere else.
    let forged_payload = base64::engine::general_purpose::STANDARD
      .encode(r#"{"version":1,"apiBase":"https://evil.example","issuedAt":"2026-09-27T12:04:28.394Z"}"#);
    let forged = SIGNED.replace(
      "eyJ2ZXJzaW9uIjoxLCJhcGlCYXNlIjoiaHR0cHM6Ly9sZWFmbGV0YXBwLmR1Y2tkbnMub3JnIiwiaXNzdWVkQXQiOiIyMDI2LTA5LTI3VDEyOjA0OjI4LjM5NFoifQ==",
      &forged_payload
    );
    assert!(verify(&forged, &public_key()).is_err());
  }

  #[test]
  fn another_key_is_refused() {
    assert!(verify(SIGNED, &[7u8; 32]).is_err());
  }

  #[test]
  fn garbage_is_refused() {
    assert!(verify("not json", &public_key()).is_err());
    assert!(verify(r#"{"payload":"!!","signature":"!!"}"#, &public_key()).is_err());
  }
}
