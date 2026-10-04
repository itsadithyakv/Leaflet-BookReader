//! How Leaflet names itself to the public services it asks things of.

/// Where to reach us. The same address as SUPPORT_EMAIL in
/// apps/src/constants/links.ts (a test below holds the two together).
const CONTACT: &str = "adithyakrishnan.vinod@gmail.com";

/// The `User-Agent` for calls to public catalogues (Wikipedia, Wiktionary,
/// Open Library). Wikimedia's API policy asks every client to say what it is
/// and how to reach whoever runs it, and may block one that does not; Open
/// Library asks the same. One string, so no caller makes up its own.
pub fn user_agent() -> String {
  format!("Leaflet/{} (e-book reader; {CONTACT})", env!("CARGO_PKG_VERSION"))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_caller_is_named_with_its_version_and_a_contact() {
    assert_eq!(user_agent(), format!("Leaflet/{} (e-book reader; adithyakrishnan.vinod@gmail.com)", env!("CARGO_PKG_VERSION")));
    // Nothing a header cannot carry.
    assert!(user_agent().chars().all(|c| c.is_ascii() && !c.is_ascii_control()));
    assert!(reqwest::header::HeaderValue::from_str(&user_agent()).is_ok());
  }

  #[test]
  fn the_contact_is_the_apps_support_address() {
    let links = include_str!("../../src/constants/links.ts");
    assert!(links.contains(&format!("SUPPORT_EMAIL = \"{CONTACT}\"")), "links.ts and http.rs name different addresses");
  }
}
