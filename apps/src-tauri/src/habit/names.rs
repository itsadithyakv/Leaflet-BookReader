//! Which book a stretch of reading was of, when nothing says.
//!
//! A focus session started from the library (or by Pip) has no book: the
//! timer is started first and a book opened after. And a day's reading outside
//! any session (`free_reads`) never had one. Both stood on the shelf as "Free
//! read", and on the shelf other readers see as "Untitled".
//!
//! What the library does keep is when each book was last opened on each day
//! (`reading_sessions`: one row a book a day). That is enough to name most of
//! them, and it is a best guess: with two books opened on one day, the row
//! says when each was opened last, not for how long it was read.
//!
//! Pure: the caller reads the rows and says which local day each fell on.

/// A book opened on a day: the last time it was, that day.
#[derive(Debug, Clone, PartialEq)]
pub struct Open {
  pub book_id: String,
  /// When, in milliseconds since the epoch.
  pub at: i64,
  /// The reader's local day that was (`YYYY-MM-DD`), as the ledger keys days.
  pub day: String
}

/// The book a focus session was read from: of the books opened on the day it
/// ended (or the day it started), the one opened while it ran, the latest of
/// them; failing that, the one opened nearest to it. None when no book was
/// opened on either day.
pub fn book_in_session<'a>(started: i64, ended: i64, ended_day: &str, started_day: &str, opens: &'a [Open]) -> Option<&'a str> {
  let (from, to) = if started <= ended { (started, ended) } else { (ended, started) };
  // How far from the session an open was: nothing while it ran.
  let apart = |open: &Open| {
    if open.at < from {
      from - open.at
    } else if open.at > to {
      open.at - to
    } else {
      0
    }
  };
  opens
    .iter()
    .filter(|open| open.day == ended_day || open.day == started_day)
    // Nearest first; of two as near, the later (and then by name, so the
    // answer never depends on the order the rows came in).
    .min_by(|a, b| {
      apart(a)
        .cmp(&apart(b))
        .then_with(|| b.at.cmp(&a.at))
        .then_with(|| a.book_id.cmp(&b.book_id))
    })
    .map(|open| open.book_id.as_str())
}

/// The book a day's free reading was of: the one opened last that day.
pub fn book_on_day<'a>(day: &str, opens: &'a [Open]) -> Option<&'a str> {
  opens
    .iter()
    .filter(|open| open.day == day)
    .max_by(|a, b| a.at.cmp(&b.at).then_with(|| b.book_id.cmp(&a.book_id)))
    .map(|open| open.book_id.as_str())
}

#[cfg(test)]
mod tests {
  use super::*;

  const HOUR: i64 = 3_600_000;

  fn open(book: &str, day: &str, at: i64) -> Open {
    Open { book_id: book.to_string(), at, day: day.to_string() }
  }

  #[test]
  fn the_only_book_opened_that_day_is_the_one_that_was_read() {
    let opens = [open("dune", "2026-10-02", 9 * HOUR), open("emma", "2026-10-03", 9 * HOUR)];
    // Opened hours before the timer was started: still the book.
    assert_eq!(book_in_session(20 * HOUR, 21 * HOUR, "2026-10-02", "2026-10-02", &opens), Some("dune"));
    assert_eq!(book_on_day("2026-10-02", &opens), Some("dune"));
    // A day with no book opened names nothing.
    assert_eq!(book_in_session(20 * HOUR, 21 * HOUR, "2026-10-04", "2026-10-04", &opens), None);
    assert_eq!(book_on_day("2026-10-04", &opens), None);
  }

  #[test]
  fn of_two_books_the_one_opened_while_the_session_ran_is_it() {
    let opens = [open("dune", "2026-10-02", 8 * HOUR), open("emma", "2026-10-02", 20 * HOUR + 60_000)];
    assert_eq!(book_in_session(20 * HOUR, 21 * HOUR, "2026-10-02", "2026-10-02", &opens), Some("emma"));
    // Two opened while it ran: the later, whichever order the rows are in.
    let both = [open("emma", "2026-10-02", 20 * HOUR + 60_000), open("dune", "2026-10-02", 20 * HOUR + 600_000)];
    assert_eq!(book_in_session(20 * HOUR, 21 * HOUR, "2026-10-02", "2026-10-02", &both), Some("dune"));
    let turned: Vec<Open> = both.iter().rev().cloned().collect();
    assert_eq!(book_in_session(20 * HOUR, 21 * HOUR, "2026-10-02", "2026-10-02", &turned), Some("dune"));
  }

  /// A book opened again later in the day has only its later time on record:
  /// nearest still finds it, ahead of one opened long before.
  #[test]
  fn with_none_opened_while_it_ran_the_nearest_is_it() {
    let opens = [open("dune", "2026-10-02", 8 * HOUR), open("emma", "2026-10-02", 22 * HOUR)];
    assert_eq!(book_in_session(20 * HOUR, 21 * HOUR, "2026-10-02", "2026-10-02", &opens), Some("emma"));
    let earlier = [open("dune", "2026-10-02", 19 * HOUR + 50 * 60_000), open("emma", "2026-10-02", 23 * HOUR)];
    assert_eq!(book_in_session(20 * HOUR, 21 * HOUR, "2026-10-02", "2026-10-02", &earlier), Some("dune"));
  }

  #[test]
  fn a_session_read_across_midnight_looks_at_both_its_days() {
    let opens = [open("dune", "2026-10-02", 23 * HOUR)];
    assert_eq!(book_in_session(23 * HOUR, 25 * HOUR, "2026-10-03", "2026-10-02", &opens), Some("dune"));
  }

  #[test]
  fn a_days_free_reading_is_of_the_book_opened_last() {
    let opens = [open("dune", "2026-10-02", 8 * HOUR), open("emma", "2026-10-02", 22 * HOUR), open("ulysses", "2026-10-03", 1)];
    assert_eq!(book_on_day("2026-10-02", &opens), Some("emma"));
  }
}
