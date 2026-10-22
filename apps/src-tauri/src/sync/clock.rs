//! The time a sync goes by, where there is a server to tell it.
//!
//! Every last-writer-wins rule in the merge compares stamps written by device
//! clocks, and a device's clock can be minutes, or hours, wrong (sync audit
//! D3). Leaflet's server and Google both say what time it is on every answer
//! (the `Date` header), so a sync that has heard from one goes by that time:
//! its merge is made at it, and stamps more than a few minutes past it are
//! read as it (`merge::bounded`). A device whose own clock runs fast has its
//! stamps put right that way at its next sync.
//!
//! Pure: the transports keep what they heard (`cloud::Server`, Drive's
//! `DriveDoc`) and hand it to the run that asked.

use chrono::{DateTime, Duration, Utc};

/// A clock this close to the server's is taken at its word: the `Date`
/// header counts whole seconds, and an answer takes a moment to arrive, so a
/// smaller difference says nothing about the clock.
pub const TRUSTED_SKEW_SECS: i64 = 60;

/// How far the server's clock is ahead of this one (milliseconds; behind is
/// negative), from the `Date` header of an answer that arrived at `local`.
/// Nothing for a header that will not read.
pub fn offset_from(date: &str, local: DateTime<Utc>) -> Option<i64> {
  let server = DateTime::parse_from_rfc2822(date.trim()).ok()?.with_timezone(&Utc);
  Some((server - local).num_milliseconds())
}

/// The same from an answer's headers, as it arrives.
pub fn offset_of(headers: &reqwest::header::HeaderMap) -> Option<i64> {
  let date = headers.get(reqwest::header::DATE)?.to_str().ok()?;
  offset_from(date, Utc::now())
}

/// The time a run goes by: `now` (this device's clock, RFC 3339) moved by
/// what the server said, when it said this clock is out by more than
/// `TRUSTED_SKEW_SECS`. `now` itself otherwise, and when there was no server
/// to ask (a folder) or `now` will not read.
pub fn reference(now: &str, offset_ms: Option<i64>) -> String {
  let Some(offset) = offset_ms.filter(|offset| offset.abs() >= TRUSTED_SKEW_SECS * 1000) else {
    return now.to_string();
  };
  match DateTime::parse_from_rfc3339(now) {
    Ok(at) => (at.with_timezone(&Utc) + Duration::milliseconds(offset)).to_rfc3339(),
    Err(_) => now.to_string()
  }
}

/// What a transport heard last, kept behind a lock (a store answers through
/// `&self`).
#[derive(Debug, Default)]
pub struct Heard(std::sync::Mutex<Option<i64>>);

impl Heard {
  /// Keeps what an answer's `Date` said, where it said anything.
  pub fn note(&self, headers: &reqwest::header::HeaderMap) {
    if let Some(offset) = offset_of(headers) {
      if let Ok(mut kept) = self.0.lock() {
        *kept = Some(offset);
      }
    }
  }

  pub fn offset(&self) -> Option<i64> {
    self.0.lock().ok().and_then(|kept| *kept)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const NOW: &str = "2026-10-22T12:00:00+00:00";

  fn at(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value).expect("time").with_timezone(&Utc)
  }

  #[test]
  fn the_date_header_is_read_as_http_writes_it() {
    // This device's clock twenty minutes fast: the server is behind it.
    assert_eq!(offset_from("Thu, 22 Oct 2026 12:00:00 GMT", at("2026-10-22T12:20:00+00:00")), Some(-20 * 60 * 1000));
    assert_eq!(offset_from("Thu, 22 Oct 2026 12:00:00 GMT", at(NOW)), Some(0));
    assert_eq!(offset_from(" Thu, 22 Oct 2026 13:00:05 +0000 ", at(NOW)), Some(3_605_000));
    assert_eq!(offset_from("yesterday", at(NOW)), None);
    assert_eq!(offset_from("", at(NOW)), None);

    let mut headers = reqwest::header::HeaderMap::new();
    assert_eq!(offset_of(&headers), None);
    headers.insert(reqwest::header::DATE, "not a date".parse().expect("header"));
    assert_eq!(offset_of(&headers), None);
  }

  #[test]
  fn a_run_goes_by_the_servers_time_when_this_clock_is_out() {
    // Twenty minutes fast: the run goes by noon, the server's time.
    assert_eq!(reference("2026-10-22T12:20:00+00:00", Some(-20 * 60 * 1000)), NOW);
    // Twenty minutes slow, the same.
    assert_eq!(reference("2026-10-22T11:40:00+00:00", Some(20 * 60 * 1000)), NOW);
    // Within a minute, or with no server, or with a time that will not read:
    // this device's word.
    assert_eq!(reference(NOW, Some(59_000)), NOW);
    assert_eq!(reference(NOW, Some(-59_000)), NOW);
    assert_eq!(reference(NOW, None), NOW);
    assert_eq!(reference("soon", Some(3_600_000)), "soon");
  }

  #[test]
  fn what_a_store_heard_is_kept_until_it_hears_again() {
    let heard = Heard::default();
    assert_eq!(heard.offset(), None);
    let mut headers = reqwest::header::HeaderMap::new();
    heard.note(&headers);
    assert_eq!(heard.offset(), None, "an answer with no date says nothing");
    headers.insert(reqwest::header::DATE, "Thu, 01 Jan 2015 00:00:00 GMT".parse().expect("header"));
    heard.note(&headers);
    assert!(heard.offset().is_some_and(|offset| offset < 0), "a server years behind this clock");
  }
}
