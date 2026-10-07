//! Asking a book's fan wiki what it says of a name: one read-only question to
//! the wiki's own API, for the reader's "From the wiki" summary.
//!
//! It happens here rather than in the webview because the release build's
//! Content-Security-Policy does not let the webview reach the internet. This
//! is a narrow door, not a way out: only Fandom's wikis (`<name>.fandom.com`),
//! only their `api.php`, only reading, and only the few questions the reader
//! has a use for. What is asked and what is made of the answer is in
//! `apps/src/readers/people/wiki.ts`, where it is tested.
//!
//! What leaves the device is the wiki's name (found from the book's series or
//! title) and the name being asked about: not the book, not the sentence, no
//! account. Nothing is logged. It is only ever asked when the reader asks.

use reqwest::{Client, StatusCode};
use serde::Serialize;
use std::sync::OnceLock;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(8);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// A page's opening section is a few kilobytes; a long one, a few hundred.
const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_VALUE_CHARS: usize = 200;
const SUFFIX: &str = ".fandom.com";

/// What may be asked: finding a page by name, a page's opening section, and
/// what the wiki calls itself.
const ACTIONS: [&str; 3] = ["opensearch", "parse", "query"];
const PARAMS: [&str; 12] = [
  "action",
  "search",
  "limit",
  "namespace",
  "page",
  "prop",
  "section",
  "redirects",
  "disableeditsection",
  "disabletoc",
  "meta",
  "siprop"
];

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WikiErrorKind {
  /// Not a question this door lets through: nothing was sent.
  Refused,
  /// The wiki could not be reached.
  Offline,
  /// There is no such wiki.
  Missing,
  /// It answered with something unusable.
  Unavailable
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiError {
  pub kind: WikiErrorKind,
  pub message: String
}

impl WikiError {
  fn new(kind: WikiErrorKind) -> Self {
    let message = match kind {
      WikiErrorKind::Refused => "That is not something a wiki can be asked.",
      WikiErrorKind::Offline => "Couldn't reach the wiki. Check your connection and try again.",
      WikiErrorKind::Missing => "There is no wiki at that address.",
      WikiErrorKind::Unavailable => "The wiki didn't answer as expected. Try again in a moment."
    };
    Self { kind, message: message.to_string() }
  }
}

/// `mistborn.fandom.com`: one label of lower-case letters, digits and hyphens
/// (not at either end), then Fandom's domain. Nothing else is ever called.
pub fn valid_host(host: &str) -> bool {
  let Some(label) = host.strip_suffix(SUFFIX) else {
    return false;
  };
  !label.is_empty()
    && label.len() <= 60
    && !label.starts_with('-')
    && !label.ends_with('-')
    && label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// The question, checked: a known action, known parameters, short values.
/// `format=json` is added here, so nothing else can be asked for.
pub fn checked(params: &[(String, String)]) -> Option<Vec<(String, String)>> {
  let mut out: Vec<(String, String)> = Vec::with_capacity(params.len() + 1);
  let mut action = None;
  for (key, value) in params {
    if !PARAMS.contains(&key.as_str()) || value.chars().count() > MAX_VALUE_CHARS || out.iter().any(|(seen, _)| seen == key) {
      return None;
    }
    if key == "action" {
      action = Some(value.as_str());
    }
    out.push((key.clone(), value.clone()));
  }
  if !action.is_some_and(|action| ACTIONS.contains(&action)) {
    return None;
  }
  out.push(("format".to_string(), "json".to_string()));
  Some(out)
}

fn client() -> Result<&'static Client, WikiError> {
  static CLIENT: OnceLock<Client> = OnceLock::new();
  if let Some(client) = CLIENT.get() {
    return Ok(client);
  }
  let built = Client::builder()
    .user_agent(crate::http::user_agent())
    .timeout(TIMEOUT)
    .connect_timeout(CONNECT_TIMEOUT)
    .https_only(true)
    // A wiki that has moved (`redrising` to `red-rising`) is followed, and no further than Fandom.
    .redirect(reqwest::redirect::Policy::custom(|attempt| {
      let stays = attempt.url().host_str().is_some_and(valid_host) && attempt.url().path() == "/api.php";
      if stays && attempt.previous().len() < 4 {
        attempt.follow()
      } else {
        attempt.stop()
      }
    }))
    .build()
    .map_err(|_| WikiError::new(WikiErrorKind::Unavailable))?;
  Ok(CLIENT.get_or_init(|| built))
}

/// The wiki's answer, as the JSON text it sent.
pub async fn ask(host: &str, params: &[(String, String)]) -> Result<String, WikiError> {
  let host = host.trim().to_ascii_lowercase();
  let Some(query) = checked(params) else {
    return Err(WikiError::new(WikiErrorKind::Refused));
  };
  if !valid_host(&host) {
    return Err(WikiError::new(WikiErrorKind::Refused));
  }
  let response = client()?
    .get(format!("https://{host}/api.php"))
    .query(&query)
    .send()
    .await
    .map_err(|error| WikiError::new(if error.is_connect() || error.is_timeout() { WikiErrorKind::Offline } else { WikiErrorKind::Unavailable }))?;
  match response.status() {
    StatusCode::OK => {}
    StatusCode::NOT_FOUND | StatusCode::GONE => return Err(WikiError::new(WikiErrorKind::Missing)),
    _ => return Err(WikiError::new(WikiErrorKind::Unavailable))
  }
  if response.content_length().is_some_and(|length| length as usize > MAX_BYTES) {
    return Err(WikiError::new(WikiErrorKind::Unavailable));
  }
  let body = response.bytes().await.map_err(|_| WikiError::new(WikiErrorKind::Unavailable))?;
  if body.len() > MAX_BYTES {
    return Err(WikiError::new(WikiErrorKind::Unavailable));
  }
  let text = String::from_utf8(body.to_vec()).map_err(|_| WikiError::new(WikiErrorKind::Unavailable))?;
  // A page that is not JSON is a challenge or an error page, not an answer.
  if !text.trim_start().starts_with(['{', '[']) {
    return Err(WikiError::new(WikiErrorKind::Unavailable));
  }
  Ok(text)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
    items.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect()
  }

  #[test]
  fn only_a_fandom_wiki_is_a_host() {
    assert!(valid_host("mistborn.fandom.com"));
    assert!(valid_host("red-rising.fandom.com"));
    assert!(valid_host("a1.fandom.com"));
    for host in [
      "fandom.com",
      ".fandom.com",
      "mistborn.fandom.com.evil.example",
      "evil.example/mistborn.fandom.com",
      "mistborn.wiki.fandom.com",
      "Mistborn.fandom.com",
      "-mistborn.fandom.com",
      "mistborn-.fandom.com",
      "mist born.fandom.com",
      "mistborn.fandom.com:8443",
      "user@mistborn.fandom.com",
      "mistborn.fandom.com/api.php?x",
      "localhost",
      "127.0.0.1",
      ""
    ] {
      assert!(!valid_host(host), "{host} was taken for a wiki");
    }
  }

  #[test]
  fn only_the_questions_the_reader_asks_get_through() {
    let search = checked(&pairs(&[("action", "opensearch"), ("search", "Vin"), ("limit", "5")])).expect("a search is allowed");
    assert_eq!(search.last(), Some(&("format".to_string(), "json".to_string())));
    assert!(checked(&pairs(&[("action", "parse"), ("page", "Vin"), ("prop", "text"), ("section", "0"), ("redirects", "1")])).is_some());
    assert!(checked(&pairs(&[("action", "query"), ("meta", "siteinfo"), ("siprop", "general")])).is_some());
  }

  #[test]
  fn anything_else_is_refused_before_it_is_sent() {
    // Writing, logging in, another format, a parameter not on the list, no action at all.
    assert!(checked(&pairs(&[("action", "edit"), ("page", "Vin")])).is_none());
    assert!(checked(&pairs(&[("action", "login")])).is_none());
    assert!(checked(&pairs(&[("action", "parse"), ("format", "xml")])).is_none());
    assert!(checked(&pairs(&[("action", "parse"), ("text", "{{evil}}")])).is_none());
    assert!(checked(&pairs(&[("page", "Vin")])).is_none());
    // The same parameter twice, and a value too long to be a name.
    assert!(checked(&pairs(&[("action", "parse"), ("action", "edit")])).is_none());
    assert!(checked(&pairs(&[("action", "opensearch"), ("search", &"x".repeat(201))])).is_none());
  }

  #[tokio::test]
  async fn a_bad_host_or_question_never_reaches_the_network() {
    let ok = pairs(&[("action", "opensearch"), ("search", "Vin")]);
    assert_eq!(ask("example.com", &ok).await.unwrap_err().kind, WikiErrorKind::Refused);
    assert_eq!(ask("mistborn.fandom.com", &pairs(&[("action", "edit")])).await.unwrap_err().kind, WikiErrorKind::Refused);
  }
}
