use anyhow::Result;
use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// A bookmark or a highlight (with an optional note) in a book.
///
/// Kept in the database and carried in the backup document, so they survive a
/// reinstall and reach a new computer. They used to live in the webview's
/// storage, which clearing site data or reinstalling threw away. Deletion is a
/// tombstone (`deleted_at`), like a book's, so it reaches the other copies.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
  pub id: String,
  pub book_id: String,
  /// "bookmark" or "highlight".
  pub kind: String,
  /// Where it is: a CFI (a range, for a highlight).
  pub cfi: String,
  /// The highlighted words.
  pub text: Option<String>,
  pub note: Option<String>,
  pub color: Option<String>,
  /// The chapter it is in, as the reader showed it.
  pub chapter: Option<String>,
  pub created_at: String,
  /// Every change, the delete included; the newest wins when copies merge.
  pub updated_at: String,
  pub deleted_at: Option<String>
}

/// How many highlights a book has, for the library's list of books with any.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HighlightCount {
  pub book_id: String,
  pub count: i64
}

/// A collection the reader made ("Summer reading", "Book club"): a name and the
/// books in it, in the order they were added.
///
/// One record, carried whole in the backup document: the newest edit of a
/// collection wins, and a delete is a tombstone, as for annotations. Series and
/// smart shelves are not stored at all; the app works them out from the library.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
  pub id: String,
  pub name: String,
  pub book_ids: Vec<String>,
  pub created_at: String,
  pub updated_at: String,
  pub deleted_at: Option<String>
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookRecord {
  pub id: String,
  pub title: String,
  pub author: Option<String>,
  pub genres: Vec<String>,
  pub cover_url: Option<String>,
  pub local_path: String,
  pub file_hash: String,
  pub progress: f32,
  /// The exact place in the book (an EPUB CFI), so another device reopens at
  /// the reader's line rather than the start of the chapter `progress` implies.
  /// `None` for page-based books, whose page follows from `progress` alone.
  /// Written with `progress` and shares its `progress_updated_at`.
  #[serde(default)]
  pub position: Option<String>,
  /// The series the book is in, from the book itself (Calibre's and EPUB 3's
  /// series metadata) or set by the reader. `Some("")` is the reader saying
  /// "not part of a series", which stops the app guessing one from the title.
  /// Part of the metadata group: it changes `metadata_updated_at` and travels
  /// with the title.
  #[serde(default)]
  pub series: Option<String>,
  /// Its number in the series (`2.5` for a novella between two books).
  #[serde(default)]
  pub series_index: Option<f32>,
  pub last_opened: Option<String>,
  pub created_at: String,
  /// When metadata enrichment last ran for this book, successful or not. Used to
  /// stop the library re-querying the same upstream lookups on every launch.
  #[serde(default)]
  pub metadata_checked_at: Option<String>,
  /// When title/author/genres last changed. Sync compares these rather than
  /// `last_opened`, so a device that only opened a book cannot overwrite a
  /// title corrected elsewhere.
  #[serde(default)]
  pub metadata_updated_at: Option<String>,
  /// When `progress` last changed. Distinct from `last_opened` on purpose:
  /// opening a book is not the same as moving through it.
  #[serde(default)]
  pub progress_updated_at: Option<String>,
  /// When the reader finished the book: stamped the moment its progress
  /// reaches the end (`FINISHED_AT`), and by "Mark as finished". It stays when
  /// the book is read again, so a book finished once is not unfinished by a
  /// second reading. `Some("")` is the reader saying "not started", which
  /// takes the date away on every device; `None` is a book never finished.
  #[serde(default)]
  pub finished_at: Option<String>,
  /// Tombstone. A removed book keeps its row so the removal can reach other
  /// devices instead of being undone by them on the next sync.
  #[serde(default)]
  pub deleted_at: Option<String>,
  /// Whether the file is on *this* device. Not a column: sync publishes the
  /// library index everywhere but fetches the bytes on demand, so a book can be
  /// in the library with nothing to open yet.
  #[serde(default)]
  pub available: bool
}

/// One entry on the session shelf. `burned_at` tombstones it: a broken streak
/// scorches books rather than deleting them, so the history stays honest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSessionRecord {
  pub id: String,
  pub started_at: String,
  pub ended_at: String,
  pub date_key: String,
  pub minutes: f64,
  pub book_id: Option<String>,
  pub title: Option<String>,
  pub notes: Option<String>,
  pub ended_reason: String,
  pub clean: bool,
  pub style_seed: String,
  pub burned_at: Option<String>,
  /// The focus flower a full-screen session grew (`tulip`, `rose`, ...).
  #[serde(default)]
  pub flower: Option<String>,
  /// Whether it bloomed: the session completed without leaving full screen.
  #[serde(default)]
  pub flower_bloomed: bool
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStats {
  pub streak_days: i64,
  pub total_days: i64,
  pub last_read_at: Option<String>,
  pub days_last_7: i64
}

pub struct Database {
  conn: Connection,
  path: PathBuf
}

impl Database {
  pub fn new() -> Result<Self> {
    let path = db_path()?;
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent)?;
    }
    let existed = path.exists();
    let conn = Connection::open(&path)?;
    write_ahead(&conn);
    if existed {
      backup_before_upgrade(&conn, &path);
    }
    let db = Self { conn, path };
    db.init_schema()?;
    Ok(db)
  }

  /// The schema version the database is at (`PRAGMA user_version`).
  pub fn schema_version(&self) -> i64 {
    self.conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap_or(0)
  }

  pub fn path(&self) -> &Path {
    &self.path
  }

  /// Runs `work` as one transaction: everything it writes is kept, or, when
  /// it fails, none of it. It is one commit as well, where each statement
  /// outside a transaction is its own: what a sync's thousand rows need.
  /// `work` must not start a transaction of its own.
  pub fn in_transaction<T>(&self, work: impl FnOnce() -> Result<T>) -> Result<T> {
    // Dropped without a commit (an error, a panic), it rolls back.
    let transaction = self.conn.unchecked_transaction()?;
    let value = work()?;
    transaction.commit()?;
    Ok(value)
  }

  fn init_schema(&self) -> Result<()> {
    apply_schema(&self.conn)
  }

  /// The columns `row_to_book` reads, in its order.
  const BOOK_COLUMNS: &'static str = "id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at, metadata_checked_at, metadata_updated_at, progress_updated_at, deleted_at, position, series, series_index, finished_at";

  fn row_to_book(row: &rusqlite::Row<'_>) -> rusqlite::Result<BookRecord> {
    let genres_json: Option<String> = row.get(3)?;
    let genres = genres_json
      .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
      .unwrap_or_default();
    Ok(BookRecord {
      id: row.get(0)?,
      title: row.get(1)?,
      author: row.get(2)?,
      genres,
      cover_url: row.get(4)?,
      local_path: row.get(5)?,
      file_hash: row.get(6)?,
      progress: row.get(7)?,
      position: row.get(14)?,
      series: row.get(15)?,
      series_index: row.get(16)?,
      last_opened: row.get(8)?,
      created_at: row.get(9)?,
      metadata_checked_at: row.get(10)?,
      metadata_updated_at: row.get(11)?,
      progress_updated_at: row.get(12)?,
      finished_at: row.get(17)?,
      deleted_at: row.get(13)?,
      available: {
        let path: String = row.get(5)?;
        !path.is_empty() && Path::new(&path).exists()
      }
    })
  }

  /// The visible library. Tombstoned books are excluded: their rows survive
  /// only so the deletion can propagate.
  pub fn list_books(&self) -> Result<Vec<BookRecord>> {
    let mut stmt = self
      .conn
      .prepare(&format!("SELECT {} FROM books WHERE deleted_at IS NULL", Self::BOOK_COLUMNS))?;
    let rows = stmt.query_map([], Self::row_to_book)?;

    let mut books = Vec::new();
    for row in rows {
      books.push(row?);
    }
    Ok(books)
  }

  pub fn find_by_id(&self, id: &str) -> Result<Option<BookRecord>> {
    let mut stmt = self
      .conn
      .prepare(&format!("SELECT {} FROM books WHERE id = ?1", Self::BOOK_COLUMNS))?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
      return Ok(Some(Self::row_to_book(row)?));
    }
    Ok(None)
  }

  pub fn find_by_hash(&self, hash: &str) -> Result<Option<BookRecord>> {
    let mut stmt = self
      .conn
      .prepare(&format!("SELECT {} FROM books WHERE file_hash = ?1", Self::BOOK_COLUMNS))?;
    let mut rows = stmt.query(params![hash])?;
    if let Some(row) = rows.next()? {
      return Ok(Some(Self::row_to_book(row)?));
    }
    Ok(None)
  }

  pub fn upsert_book(&self, book: &BookRecord) -> Result<()> {
    let genres_json = serde_json::to_string(&book.genres).ok();
    self.conn.execute(
      "INSERT INTO books (id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at, metadata_checked_at, metadata_updated_at, progress_updated_at, deleted_at, position, series, series_index, finished_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        author = excluded.author,
        genres = excluded.genres,
        cover_url = excluded.cover_url,
        local_path = excluded.local_path,
        file_hash = excluded.file_hash,
        progress = excluded.progress,
        last_opened = excluded.last_opened,
        created_at = excluded.created_at,
        metadata_checked_at = excluded.metadata_checked_at,
        metadata_updated_at = excluded.metadata_updated_at,
        progress_updated_at = excluded.progress_updated_at,
        deleted_at = excluded.deleted_at,
        position = excluded.position,
        series = excluded.series,
        series_index = excluded.series_index,
        finished_at = excluded.finished_at",
      params![
        book.id,
        book.title,
        book.author,
        genres_json,
        book.cover_url,
        book.local_path,
        book.file_hash,
        book.progress,
        book.last_opened,
        book.created_at,
        book.metadata_checked_at,
        book.metadata_updated_at,
        book.progress_updated_at,
        book.deleted_at,
        book.position,
        book.series,
        book.series_index,
        book.finished_at
      ]
    )?;
    Ok(())
  }

  /// Writes what an enrichment pass found. Not the series: the reader may have
  /// set it while the lookup was out, and a lookup never finds one.
  pub fn update_metadata(&self, book: &BookRecord) -> Result<()> {
    let genres_json = serde_json::to_string(&book.genres).ok();
    self.conn.execute(
      "UPDATE books SET title = ?1, author = ?2, genres = ?3, cover_url = ?4, metadata_checked_at = ?5, metadata_updated_at = ?6 WHERE id = ?7",
      params![
        book.title,
        book.author,
        genres_json,
        book.cover_url,
        book.metadata_checked_at,
        now_iso(),
        book.id
      ]
    )?;
    Ok(())
  }

  /// The reader's word on a book's series (`Some("")`: none). A metadata edit,
  /// so it is stamped and travels with the title.
  pub fn set_series(&self, id: &str, series: Option<&str>, index: Option<f32>) -> Result<bool> {
    let changed = self.conn.execute(
      "UPDATE books SET series = ?1, series_index = ?2, metadata_updated_at = ?3 WHERE id = ?4",
      params![series, index, now_iso(), id]
    )?;
    Ok(changed > 0)
  }

  /// Fills in a series read from the book's own file, where there is none yet.
  /// Not stamped: every device reads the same file and finds the same answer,
  /// and the sync merge prefers a known series over none on a tie.
  pub fn fill_series_from_file(&self, id: &str, series: &str, index: Option<f32>) -> Result<()> {
    self.conn.execute(
      "UPDATE books SET series = ?1, series_index = ?2 WHERE id = ?3 AND series IS NULL",
      params![series, index, id]
    )?;
    Ok(())
  }

  /// Writes a title, author and genres worked out again from the book by
  /// today's rules (`commands::scan_series`). Stamped, unlike the series
  /// above: a device still on the old rules holds the old title under the old
  /// stamp, and on a tie the merge could keep either.
  pub fn retitle(&self, id: &str, title: &str, author: Option<&str>, genres: &[String]) -> Result<()> {
    let genres_json = serde_json::to_string(genres).ok();
    self.conn.execute(
      "UPDATE books SET title = ?1, author = ?2, genres = ?3, metadata_updated_at = ?4 WHERE id = ?5",
      params![title, author, genres_json, now_iso(), id]
    )?;
    Ok(())
  }

  /// Every book row including tombstones. Only sync wants these: a deletion
  /// has to travel to the other devices before its row can be forgotten.
  pub fn list_books_for_sync(&self) -> Result<Vec<BookRecord>> {
    let mut stmt = self.conn.prepare(&format!("SELECT {} FROM books", Self::BOOK_COLUMNS))?;
    let rows = stmt.query_map([], Self::row_to_book)?;
    let mut books = Vec::new();
    for row in rows {
      books.push(row?);
    }
    Ok(books)
  }

  /// Tombstones a book rather than deleting the row, so the removal survives
  /// long enough to reach every other device. The file on disk is the caller's
  /// to remove.
  pub fn delete_book(&self, book_id: &str, deleted_at: &str) -> Result<()> {
    self.conn.execute(
      "UPDATE books SET deleted_at = ?1 WHERE id = ?2",
      params![deleted_at, book_id]
    )?;
    Ok(())
  }

  /// Drops tombstones the merge has already retired, and with them any rows a
  /// reset left behind.
  pub fn purge_tombstones(&self, keep_ids: &[String]) -> Result<()> {
    let mut stmt = self.conn.prepare("SELECT id FROM books WHERE deleted_at IS NOT NULL")?;
    let existing: Vec<String> = stmt
      .query_map([], |row| row.get::<_, String>(0))?
      .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in existing {
      if !keep_ids.iter().any(|kept| kept == &id) {
        self.conn.execute("DELETE FROM books WHERE id = ?1", params![id])?;
      }
    }
    Ok(())
  }

  pub fn update_cover(&self, book_id: &str, cover_url: Option<String>) -> Result<()> {
    self.conn.execute(
      "UPDATE books SET cover_url = ?1 WHERE id = ?2",
      params![cover_url, book_id]
    )?;
    Ok(())
  }

  /// Stamps `progress_updated_at` only when the position actually moved.
  /// Opening a book must not count as progress, or a second device that merely
  /// opened it would win the merge and roll the reader's place backwards.
  ///
  /// `progress` and `position` are one fact and are written as a pair. A new
  /// CFI at the same percentage is a move (a percentage is coarse; several
  /// pages can share it). A move reported without a position clears the stored
  /// one rather than leaving a CFI that no longer matches the percentage.
  pub fn update_progress(
    &self,
    book_id: &str,
    progress: f32,
    last_opened: Option<String>,
    position: Option<String>
  ) -> Result<()> {
    let previous: Option<(f32, Option<String>)> = self
      .conn
      .query_row(
        "SELECT progress, position FROM books WHERE id = ?1",
        params![book_id],
        |row| Ok((row.get(0)?, row.get(1)?))
      )
      .optional()?;
    // Reaching the end from short of it is finishing the book: the date is
    // kept from then on (`BookRecord::finished_at`). A book that is new here,
    // or was already at its end, is not finished again by being opened.
    let finishes = progress >= FINISHED_AT && previous.as_ref().is_some_and(|(value, _)| *value < FINISHED_AT);
    let moved = previous
      .map(|(value, previous_position)| {
        (value - progress).abs() > f32::EPSILON
          || (position.is_some() && position != previous_position)
      })
      .unwrap_or(true);
    if moved {
      self.conn.execute(
        "UPDATE books SET progress = ?1, position = ?2, last_opened = ?3, progress_updated_at = ?4 WHERE id = ?5",
        params![progress, position, last_opened, now_iso(), book_id]
      )?;
    } else {
      self.conn.execute(
        "UPDATE books SET last_opened = ?1 WHERE id = ?2",
        params![last_opened, book_id]
      )?;
    }
    if finishes {
      self.conn.execute("UPDATE books SET finished_at = ?1 WHERE id = ?2", params![now_iso(), book_id])?;
    }
    if let Some(opened_at) = last_opened {
      self.log_reading_session(book_id, &opened_at)?;
    }
    Ok(())
  }

  /// "Mark as finished" and "Mark as not started", from a book's menu.
  ///
  /// Finished: the book is at its end as of `now`. Not started: it is at its
  /// beginning with no place kept, and its finished date is cleared for every
  /// device (`Some("")`, which the merge reads as said on purpose). Both are a
  /// change of progress and carry its stamp, so the other devices follow.
  pub fn set_finished(&self, book_id: &str, finished: bool, now: &str) -> Result<()> {
    if finished {
      self.conn.execute(
        "UPDATE books SET progress = 1.0, position = NULL, finished_at = ?1, progress_updated_at = ?1 WHERE id = ?2",
        params![now, book_id]
      )?;
    } else {
      self.conn.execute(
        "UPDATE books SET progress = 0.0, position = NULL, finished_at = '', progress_updated_at = ?1 WHERE id = ?2",
        params![now, book_id]
      )?;
    }
    Ok(())
  }

  // ---- habit ledger ------------------------------------------------------

  /// The whole day ledger, keyed by local date. Small enough to read whole:
  /// one row per day the app was used.
  /// The latest day with reading on it, if any.
  pub fn latest_reading_day(&self) -> Result<Option<String>> {
    Ok(self
      .conn
      .query_row("SELECT max(date_key) FROM reading_days WHERE minutes > 0", [], |row| row.get::<_, Option<String>>(0))?)
  }

  pub fn reading_days(&self) -> Result<HashMap<String, crate::habit::DayRecord>> {
    let mut stmt = self.conn.prepare(
      "SELECT date_key, minutes, goal_minutes, freeze_used, grace_used FROM reading_days"
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(crate::habit::DayRecord {
        date_key: row.get(0)?,
        minutes: row.get(1)?,
        goal_minutes: row.get(2)?,
        freeze_used: row.get::<_, i64>(3)? != 0,
        grace_used: row.get::<_, i64>(4)? != 0
      })
    })?;
    let mut days = HashMap::new();
    for row in rows {
      let record = row?;
      days.insert(record.date_key.clone(), record);
    }
    Ok(days)
  }

  /// Adds reading time to a day and stamps it with the goal given, as given:
  /// which goal a day is judged against (the one in force, or the one it has
  /// already met) is the caller's to decide, in `commands::goal_for_day`.
  pub fn credit_minutes(&self, date_key: &str, minutes: f64, goal_minutes: i64) -> Result<()> {
    self.conn.execute(
      "INSERT INTO reading_days (date_key, minutes, goal_minutes) VALUES (?1, min(?2, 1440), ?3)
       ON CONFLICT(date_key) DO UPDATE SET
         minutes = min(1440, reading_days.minutes + excluded.minutes),
         goal_minutes = excluded.goal_minutes",
      params![date_key, minutes.max(0.0), goal_minutes]
    )?;
    Ok(())
  }

  /// Records that a missed day was paid for, so re-evaluating never charges for
  /// the same gap twice.
  pub fn apply_cover(
    &self,
    date_key: &str,
    kind: crate::habit::CoverKind,
    goal_minutes: i64
  ) -> Result<()> {
    let (freeze, grace) = match kind {
      crate::habit::CoverKind::Freeze => (1, 0),
      crate::habit::CoverKind::Grace => (0, 1)
    };
    self.conn.execute(
      "INSERT INTO reading_days (date_key, minutes, goal_minutes, freeze_used, grace_used)
       VALUES (?1, 0, ?2, ?3, ?4)
       ON CONFLICT(date_key) DO UPDATE SET
         freeze_used = max(reading_days.freeze_used, excluded.freeze_used),
         grace_used = max(reading_days.grace_used, excluded.grace_used)",
      params![date_key, goal_minutes, freeze, grace]
    )?;
    Ok(())
  }

  /// Writes a day as given, rather than adding to it. Used only when applying
  /// a merge result: `credit_minutes` accumulates, which would double-count
  /// time that has already been counted on the other device.
  pub fn put_day(&self, day: &crate::habit::DayRecord) -> Result<()> {
    self.conn.execute(
      "INSERT INTO reading_days (date_key, minutes, goal_minutes, freeze_used, grace_used)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(date_key) DO UPDATE SET
         minutes = excluded.minutes,
         goal_minutes = excluded.goal_minutes,
         freeze_used = excluded.freeze_used,
         grace_used = excluded.grace_used",
      params![
        day.date_key,
        day.minutes,
        day.goal_minutes,
        i64::from(day.freeze_used),
        i64::from(day.grace_used)
      ]
    )?;
    Ok(())
  }

  // ---- session shelf -----------------------------------------------------

  pub fn insert_focus_session(&self, session: &FocusSessionRecord) -> Result<()> {
    self.conn.execute(
      "INSERT INTO focus_sessions
        (id, started_at, ended_at, date_key, minutes, book_id, title, notes,
         ended_reason, clean, style_seed, burned_at, flower, flower_bloomed)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
       ON CONFLICT(id) DO NOTHING",
      params![
        session.id,
        session.started_at,
        session.ended_at,
        session.date_key,
        session.minutes,
        session.book_id,
        session.title,
        session.notes,
        session.ended_reason,
        i64::from(session.clean),
        session.style_seed,
        session.burned_at,
        session.flower,
        i64::from(session.flower_bloomed)
      ]
    )?;
    Ok(())
  }

  /// Newest first. Burned sessions are included so the shelf can show scars.
  pub fn focus_sessions(&self) -> Result<Vec<FocusSessionRecord>> {
    let mut stmt = self.conn.prepare(
      "SELECT id, started_at, ended_at, date_key, minutes, book_id, title, notes,
              ended_reason, clean, style_seed, burned_at, flower, flower_bloomed
       FROM focus_sessions ORDER BY ended_at DESC"
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(FocusSessionRecord {
        id: row.get(0)?,
        started_at: row.get(1)?,
        ended_at: row.get(2)?,
        date_key: row.get(3)?,
        minutes: row.get(4)?,
        book_id: row.get(5)?,
        title: row.get(6)?,
        notes: row.get(7)?,
        ended_reason: row.get(8)?,
        clean: row.get::<_, i64>(9)? != 0,
        style_seed: row.get(10)?,
        burned_at: row.get(11)?,
        flower: row.get(12)?,
        flower_bloomed: row.get::<_, i64>(13)? != 0
      })
    })?;
    let mut sessions = Vec::new();
    for row in rows {
      sessions.push(row?);
    }
    Ok(sessions)
  }

  /// Applies a merged session, unlike `insert_focus_session` which refuses to
  /// touch an existing row. A note added on another device, or a burn it
  /// recorded, has to be able to land here.
  pub fn put_focus_session(&self, session: &FocusSessionRecord) -> Result<()> {
    self.conn.execute(
      "INSERT INTO focus_sessions
        (id, started_at, ended_at, date_key, minutes, book_id, title, notes,
         ended_reason, clean, style_seed, burned_at, flower, flower_bloomed)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
       ON CONFLICT(id) DO UPDATE SET
         minutes = excluded.minutes,
         notes = excluded.notes,
         burned_at = excluded.burned_at,
         flower = COALESCE(focus_sessions.flower, excluded.flower),
         flower_bloomed = MAX(focus_sessions.flower_bloomed, excluded.flower_bloomed)",
      params![
        session.id,
        session.started_at,
        session.ended_at,
        session.date_key,
        session.minutes,
        session.book_id,
        session.title,
        session.notes,
        session.ended_reason,
        i64::from(session.clean),
        session.style_seed,
        session.burned_at,
        session.flower,
        i64::from(session.flower_bloomed)
      ]
    )?;
    Ok(())
  }

  pub fn add_session_note(&self, id: &str, notes: &str) -> Result<()> {
    self.conn
      .execute("UPDATE focus_sessions SET notes = ?1 WHERE id = ?2", params![notes, id])?;
    Ok(())
  }

  /// Tombstones the `count` most recent unburned sessions and returns their ids
  /// so the UI can animate exactly those spines.
  pub fn burn_recent_sessions(&self, count: i64, burned_at: &str) -> Result<Vec<String>> {
    if count <= 0 {
      return Ok(Vec::new());
    }
    let ids: Vec<String> = {
      let mut stmt = self.conn.prepare(
        "SELECT id FROM focus_sessions WHERE burned_at IS NULL
         ORDER BY ended_at DESC LIMIT ?1"
      )?;
      let rows = stmt.query_map(params![count], |row| row.get::<_, String>(0))?;
      let mut collected = Vec::new();
      for row in rows {
        collected.push(row?);
      }
      collected
    };
    for id in &ids {
      self.conn.execute(
        "UPDATE focus_sessions SET burned_at = ?1 WHERE id = ?2",
        params![burned_at, id]
      )?;
    }
    Ok(ids)
  }

  pub fn unburned_session_count(&self) -> Result<i64> {
    Ok(self.conn.query_row(
      "SELECT COUNT(*) FROM focus_sessions WHERE burned_at IS NULL",
      [],
      |row| row.get(0)
    )?)
  }

  /// Whether a session is already on the shelf, so re-recording one (a retry)
  /// does not cheer Pip up twice.
  pub fn focus_session_exists(&self, id: &str) -> Result<bool> {
    Ok(self.conn.query_row(
      "SELECT EXISTS(SELECT 1 FROM focus_sessions WHERE id = ?1)",
      params![id],
      |row| row.get::<_, i64>(0)
    )? != 0)
  }

  // ---- Pip's shop ----------------------------------------------------------

  /// Every purchase, oldest first. The balance is derived from these and the
  /// habit ledger; nothing stores it.
  fn row_to_annotation(row: &rusqlite::Row<'_>) -> rusqlite::Result<Annotation> {
    Ok(Annotation {
      id: row.get(0)?,
      book_id: row.get(1)?,
      kind: row.get(2)?,
      cfi: row.get(3)?,
      text: row.get(4)?,
      note: row.get(5)?,
      color: row.get(6)?,
      chapter: row.get(7)?,
      created_at: row.get(8)?,
      updated_at: row.get(9)?,
      deleted_at: row.get(10)?
    })
  }

  const ANNOTATION_COLUMNS: &'static str =
    "id, book_id, kind, cfi, text, note, color, chapter, created_at, updated_at, deleted_at";

  /// A book's bookmarks and highlights, oldest first, without deleted ones.
  pub fn annotations_for_book(&self, book_id: &str) -> Result<Vec<Annotation>> {
    let mut stmt = self.conn.prepare(&format!(
      "SELECT {} FROM annotations WHERE book_id = ?1 AND deleted_at IS NULL ORDER BY created_at, id",
      Self::ANNOTATION_COLUMNS
    ))?;
    let rows = stmt.query_map([book_id], Self::row_to_annotation)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
  }

  /// Each book's number of highlights, for the books that have any. Bookmarks
  /// and deleted highlights are not counted.
  pub fn highlight_counts(&self) -> Result<Vec<HighlightCount>> {
    let mut stmt = self.conn.prepare(
      "SELECT book_id, COUNT(*) FROM annotations
       WHERE kind = 'highlight' AND deleted_at IS NULL
       GROUP BY book_id ORDER BY book_id"
    )?;
    let rows = stmt.query_map([], |row| Ok(HighlightCount { book_id: row.get(0)?, count: row.get(1)? }))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
  }

  /// Every annotation, deleted ones included, for the backup document.
  pub fn all_annotations(&self) -> Result<Vec<Annotation>> {
    let mut stmt = self
      .conn
      .prepare(&format!("SELECT {} FROM annotations ORDER BY id", Self::ANNOTATION_COLUMNS))?;
    let rows = stmt.query_map([], Self::row_to_annotation)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
  }

  pub fn find_annotation(&self, id: &str) -> Result<Option<Annotation>> {
    Ok(self
      .conn
      .query_row(
        &format!("SELECT {} FROM annotations WHERE id = ?1", Self::ANNOTATION_COLUMNS),
        [id],
        Self::row_to_annotation
      )
      .optional()?)
  }

  /// Writes an annotation as given (insert or replace).
  pub fn put_annotation(&self, a: &Annotation) -> Result<()> {
    self.conn.execute(
      "INSERT INTO annotations (id, book_id, kind, cfi, text, note, color, chapter, created_at, updated_at, deleted_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT(id) DO UPDATE SET
         book_id = excluded.book_id, kind = excluded.kind, cfi = excluded.cfi,
         text = excluded.text, note = excluded.note, color = excluded.color,
         chapter = excluded.chapter, created_at = excluded.created_at,
         updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
      params![a.id, a.book_id, a.kind, a.cfi, a.text, a.note, a.color, a.chapter, a.created_at, a.updated_at, a.deleted_at]
    )?;
    Ok(())
  }

  /// Drops deleted annotations the backup no longer carries (their tombstones
  /// are old enough that every copy has seen them).
  pub fn retire_annotation_tombstones(&self, keep: &[String]) -> Result<()> {
    let deleted: Vec<String> = {
      let mut stmt = self.conn.prepare("SELECT id FROM annotations WHERE deleted_at IS NOT NULL")?;
      let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
      rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for id in deleted.iter().filter(|id| !keep.contains(id)) {
      self.conn.execute("DELETE FROM annotations WHERE id = ?1", [id])?;
    }
    Ok(())
  }

  fn row_to_collection(row: &rusqlite::Row<'_>) -> rusqlite::Result<Collection> {
    let book_ids: String = row.get(2)?;
    Ok(Collection {
      id: row.get(0)?,
      name: row.get(1)?,
      book_ids: serde_json::from_str(&book_ids).unwrap_or_default(),
      created_at: row.get(3)?,
      updated_at: row.get(4)?,
      deleted_at: row.get(5)?
    })
  }

  const COLLECTION_COLUMNS: &'static str = "id, name, book_ids, created_at, updated_at, deleted_at";

  /// The reader's collections, oldest first, without deleted ones.
  pub fn collections(&self) -> Result<Vec<Collection>> {
    let mut stmt = self.conn.prepare(&format!(
      "SELECT {} FROM collections WHERE deleted_at IS NULL ORDER BY created_at, id",
      Self::COLLECTION_COLUMNS
    ))?;
    let rows = stmt.query_map([], Self::row_to_collection)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
  }

  /// Every collection, deleted ones included, for the backup document.
  pub fn all_collections(&self) -> Result<Vec<Collection>> {
    let mut stmt = self
      .conn
      .prepare(&format!("SELECT {} FROM collections ORDER BY id", Self::COLLECTION_COLUMNS))?;
    let rows = stmt.query_map([], Self::row_to_collection)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
  }

  pub fn find_collection(&self, id: &str) -> Result<Option<Collection>> {
    Ok(self
      .conn
      .query_row(
        &format!("SELECT {} FROM collections WHERE id = ?1", Self::COLLECTION_COLUMNS),
        [id],
        Self::row_to_collection
      )
      .optional()?)
  }

  /// Writes a collection as given (insert or replace).
  pub fn put_collection(&self, c: &Collection) -> Result<()> {
    let book_ids = serde_json::to_string(&c.book_ids)?;
    self.conn.execute(
      "INSERT INTO collections (id, name, book_ids, created_at, updated_at, deleted_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, book_ids = excluded.book_ids, created_at = excluded.created_at,
         updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
      params![c.id, c.name, book_ids, c.created_at, c.updated_at, c.deleted_at]
    )?;
    Ok(())
  }

  /// Drops deleted collections the backup no longer carries.
  pub fn retire_collection_tombstones(&self, keep: &[String]) -> Result<()> {
    let deleted: Vec<String> = {
      let mut stmt = self.conn.prepare("SELECT id FROM collections WHERE deleted_at IS NOT NULL")?;
      let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
      rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for id in deleted.iter().filter(|id| !keep.contains(id)) {
      self.conn.execute("DELETE FROM collections WHERE id = ?1", [id])?;
    }
    Ok(())
  }

  pub fn pip_purchases(&self) -> Result<Vec<crate::pip::Purchase>> {
    let mut stmt = self.conn.prepare(
      "SELECT id, item_kind, item_id, price, bought_at FROM pip_purchases ORDER BY bought_at, id"
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(crate::pip::Purchase {
        id: row.get(0)?,
        item_kind: row.get(1)?,
        item_id: row.get(2)?,
        price: row.get(3)?,
        bought_at: row.get(4)?
      })
    })?;
    let mut purchases = Vec::new();
    for row in rows {
      purchases.push(row?);
    }
    Ok(purchases)
  }

  /// Records a purchase. Purchases never change once made, so one arriving
  /// again from a sync is simply ignored.
  pub fn insert_pip_purchase(&self, purchase: &crate::pip::Purchase) -> Result<()> {
    self.conn.execute(
      "INSERT INTO pip_purchases (id, item_kind, item_id, price, bought_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO NOTHING",
      params![
        purchase.id,
        purchase.item_kind,
        purchase.item_id,
        purchase.price,
        purchase.bought_at
      ]
    )?;
    Ok(())
  }

  pub fn pip_plantings(&self) -> Result<Vec<crate::pip::Planting>> {
    let mut stmt = self.conn.prepare("SELECT id, plot, plant, planted_at FROM pip_plantings ORDER BY planted_at, id")?;
    let rows = stmt.query_map([], |row| {
      Ok(crate::pip::Planting { id: row.get(0)?, plot: row.get(1)?, plant: row.get(2)?, planted_at: row.get(3)? })
    })?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(out)
  }

  /// Records a planting. Like purchases, never changed once made.
  pub fn insert_pip_planting(&self, planting: &crate::pip::Planting) -> Result<()> {
    self.conn.execute(
      "INSERT INTO pip_plantings (id, plot, plant, planted_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO NOTHING",
      params![planting.id, planting.plot, planting.plant, planting.planted_at]
    )?;
    Ok(())
  }

  pub fn pip_harvests(&self) -> Result<Vec<crate::pip::Harvest>> {
    let mut stmt = self.conn.prepare("SELECT id, planting_id, seeds, harvested_at FROM pip_harvests ORDER BY harvested_at, id")?;
    let rows = stmt.query_map([], |row| {
      Ok(crate::pip::Harvest { id: row.get(0)?, planting_id: row.get(1)?, seeds: row.get(2)?, harvested_at: row.get(3)? })
    })?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn insert_pip_harvest(&self, harvest: &crate::pip::Harvest) -> Result<()> {
    self.conn.execute(
      "INSERT INTO pip_harvests (id, planting_id, seeds, harvested_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO NOTHING",
      params![harvest.id, harvest.planting_id, harvest.seeds, harvest.harvested_at]
    )?;
    Ok(())
  }

  /// Pip's saved look, home and mood; `None` before the reader first visits.
  pub fn pip_state(&self) -> Result<Option<crate::pip::PipState>> {
    let mut stmt = self.conn.prepare(
      "SELECT variant, accessories, room_layout, room_style, mood, mood_updated_at, signature, updated_at
       FROM pip_state WHERE id = 1"
    )?;
    let mut rows = stmt.query([])?;
    let Some(row) = rows.next()? else {
      return Ok(None);
    };
    let accessories: String = row.get(1)?;
    let layout: String = row.get(2)?;
    Ok(Some(crate::pip::PipState {
      variant: row.get(0)?,
      // A column that fails to parse costs the outfit, not the whole state.
      outfit: serde_json::from_str(&accessories).unwrap_or_default(),
      room: serde_json::from_str(&layout).unwrap_or_default(),
      room_style: row.get(3)?,
      mood: row.get(4)?,
      mood_updated_at: row.get(5)?,
      signature: row.get(6)?,
      updated_at: row.get(7)?
    }))
  }

  pub fn put_pip_state(&self, state: &crate::pip::PipState) -> Result<()> {
    self.conn.execute(
      "INSERT INTO pip_state
        (id, variant, accessories, room_layout, room_style, mood, mood_updated_at, signature, updated_at)
       VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET
         variant = excluded.variant,
         accessories = excluded.accessories,
         room_layout = excluded.room_layout,
         room_style = excluded.room_style,
         mood = excluded.mood,
         mood_updated_at = excluded.mood_updated_at,
         signature = excluded.signature,
         updated_at = excluded.updated_at",
      params![
        state.variant,
        serde_json::to_string(&state.outfit)?,
        serde_json::to_string(&state.room)?,
        state.room_style,
        state.mood,
        state.mood_updated_at,
        state.signature,
        state.updated_at
      ]
    )?;
    Ok(())
  }

  pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
    self.conn.execute(
      "INSERT INTO settings (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      params![key, value]
    )?;
    Ok(())
  }

  pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
    let mut stmt = self.conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
      return Ok(Some(row.get(0)?));
    }
    Ok(None)
  }

  pub fn log_reading_session(&self, book_id: &str, opened_at: &str) -> Result<()> {
    let date_key = DateTime::parse_from_rfc3339(opened_at)
      .map(|dt| dt.date_naive().to_string())
      .unwrap_or_else(|_| Utc::now().date_naive().to_string());
    self.conn.execute(
      "INSERT INTO reading_sessions (book_id, opened_at, date_key)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(book_id, date_key) DO UPDATE SET opened_at = excluded.opened_at",
      params![book_id, opened_at, date_key]
    )?;
    Ok(())
  }

  pub fn reading_stats(&self) -> Result<ReadingStats> {
    let mut stmt = self.conn.prepare(
      "SELECT date_key FROM reading_sessions GROUP BY date_key ORDER BY date_key DESC"
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut dates: Vec<NaiveDate> = Vec::new();
    for row in rows {
      if let Ok(date) = NaiveDate::parse_from_str(&row?, "%Y-%m-%d") {
        dates.push(date);
      }
    }

    let today = Utc::now().date_naive();
    let mut streak_days = 0;
    if let Some(first) = dates.first() {
      if *first == today {
        streak_days = 1;
        let mut expected = today.pred_opt().unwrap_or(today);
        for date in dates.iter().skip(1) {
          if *date == expected {
            streak_days += 1;
            expected = expected.pred_opt().unwrap_or(*date);
          } else {
            break;
          }
        }
      }
    }

    let cutoff = today - chrono::Duration::days(6);
    let days_last_7 = dates.iter().filter(|date| **date >= cutoff).count() as i64;

    let last_read_at: Option<String> = self
      .conn
      .query_row("SELECT MAX(opened_at) FROM reading_sessions", [], |row| row.get(0))
      .unwrap_or(None);

    Ok(ReadingStats {
      streak_days,
      total_days: dates.len() as i64,
      last_read_at,
      days_last_7
    })
  }

  pub fn clear_all(&self) -> Result<()> {
    self.conn.execute_batch(
      "DELETE FROM book_collections;
       DELETE FROM collections;
       DELETE FROM books;
       DELETE FROM settings;
       DELETE FROM reading_sessions;
       DELETE FROM reading_days;
       DELETE FROM focus_sessions;
       DELETE FROM pip_purchases;
       DELETE FROM pip_state;
       DELETE FROM pip_plantings;
       DELETE FROM pip_harvests;
       DELETE FROM annotations;"
    )?;
    // `DELETE` only marks the pages free: the titles, notes and paths stay in
    // the file until it is rebuilt. Best effort; the rows are gone either way.
    let _ = self.conn.execute_batch("VACUUM;");
    // The rebuilt file is written through the log (`write_ahead`), and the log
    // still holds the pages it replaced until it is emptied.
    let _ = self.conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
    Ok(())
  }
}

/// Has the database keep a write-ahead log, and wait for the disk at a
/// checkpoint rather than at every commit.
///
/// SQLite's default writes a rollback journal and waits for the disk twice
/// for each commit: 17 ms a saved place on this project's development PC, and
/// 28 ms (328 at worst) on its second drive, on the window's own thread, since
/// most commands are not `async`. With the log a commit is an append: 0.03 ms.
///
/// What is given up is the last moments before a power cut (the commits since
/// the last sync to disk), never the database: a log is replayed or discarded
/// whole. The mode is kept in the file, so this is asked once and found set
/// after. A folder that cannot hold a log (a network share) keeps the default,
/// and its full waits with it.
fn write_ahead(conn: &Connection) {
  let mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0)).unwrap_or_default();
  if mode.eq_ignore_ascii_case("wal") {
    let _ = conn.execute_batch("PRAGMA synchronous = NORMAL;");
  } else {
    crate::diag::warn(&format!("the library database keeps its \"{mode}\" journal: write-ahead logging was refused"));
  }
}

fn apply_schema(conn: &Connection) -> Result<()> {
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT,
        genres TEXT,
        cover_url TEXT,
        local_path TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        progress REAL DEFAULT 0,
        last_opened TEXT,
        created_at TEXT NOT NULL,
        metadata_checked_at TEXT,
        metadata_updated_at TEXT,
        progress_updated_at TEXT,
        deleted_at TEXT,
        position TEXT,
        series TEXT,
        series_index REAL,
        finished_at TEXT
      );
      /* The reader's own collections (see Collection). book_ids is a JSON list.
         book_collections below is unused: it predates collections being carried
         whole in the backup. */
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        book_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS book_collections (
        book_id TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        PRIMARY KEY (book_id, collection_id)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS reading_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        date_key TEXT NOT NULL,
        UNIQUE(book_id, date_key)
      );
      CREATE INDEX IF NOT EXISTS reading_sessions_date_idx ON reading_sessions (date_key);
      CREATE INDEX IF NOT EXISTS books_file_hash_idx ON books (file_hash);
      /* The habit ledger. One row per LOCAL calendar day; the streak is derived
         from these rows rather than stored, so it can never drift out of sync
         with the minutes that earned it. goal_minutes is snapshotted per day so
         changing your goal does not rewrite history. */
      CREATE TABLE IF NOT EXISTS reading_days (
        date_key TEXT PRIMARY KEY,
        minutes REAL NOT NULL DEFAULT 0,
        goal_minutes INTEGER NOT NULL,
        freeze_used INTEGER NOT NULL DEFAULT 0,
        grace_used INTEGER NOT NULL DEFAULT 0
      );
      /* The shelf. burned_at tombstones a session rather than deleting it, so a
         broken streak leaves a scar in the history instead of erasing it. */
      CREATE TABLE IF NOT EXISTS focus_sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        date_key TEXT NOT NULL,
        minutes REAL NOT NULL,
        book_id TEXT,
        title TEXT,
        notes TEXT,
        ended_reason TEXT NOT NULL,
        clean INTEGER NOT NULL DEFAULT 0,
        style_seed TEXT NOT NULL,
        burned_at TEXT,
        flower TEXT,
        flower_bloomed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS focus_sessions_date_idx ON focus_sessions (date_key);
      CREATE INDEX IF NOT EXISTS focus_sessions_burned_idx ON focus_sessions (burned_at);
      /* Pip's shop. Only spending is stored: seeds earned are derived from the
         ledger above, so the balance (earned minus the sum of these) can never
         drift from the reading that earned it. Append-only; ids are random so
         two devices' purchases merge as a union. */
      CREATE TABLE IF NOT EXISTS pip_purchases (
        id TEXT PRIMARY KEY,
        item_kind TEXT NOT NULL,
        item_id TEXT NOT NULL,
        price INTEGER NOT NULL,
        bought_at TEXT NOT NULL
      );
      /* Pip's garden: what was planted where, and what was picked. How far a
         plant has grown is never stored; it is replayed from the reading
         (habit/seeds.rs), so a harvest cannot be written into existence. */
      CREATE TABLE IF NOT EXISTS pip_plantings (
        id TEXT PRIMARY KEY,
        plot INTEGER NOT NULL,
        plant TEXT NOT NULL,
        planted_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pip_harvests (
        id TEXT PRIMARY KEY,
        planting_id TEXT NOT NULL,
        seeds INTEGER NOT NULL,
        harvested_at TEXT NOT NULL
      );
      /* Bookmarks and highlights (see Annotation). */
      CREATE TABLE IF NOT EXISTS annotations (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        cfi TEXT NOT NULL,
        text TEXT,
        note TEXT,
        color TEXT,
        chapter TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS annotations_book_idx ON annotations (book_id);
      /* Pip's look, home and mood: one row. accessories and room_layout are
         JSON (a list of ids; spot -> item id). */
      CREATE TABLE IF NOT EXISTS pip_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        variant TEXT NOT NULL,
        accessories TEXT NOT NULL DEFAULT '[]',
        room_layout TEXT NOT NULL DEFAULT '{}',
        room_style TEXT NOT NULL DEFAULT '',
        mood REAL NOT NULL,
        mood_updated_at TEXT NOT NULL,
        signature TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );"
  )?;
  upgrade(conn)
}

/// The schema version this build expects.
///
/// To change the schema: bump this, add a step to `upgrade` for the new
/// version, and put the new shape in the `CREATE TABLE`s above too (a new
/// library is created at the latest version directly). Never edit a step that
/// has shipped.
pub const SCHEMA_VERSION: i64 = 6;

/// From this much of a book on, it is finished: the last page often reports
/// 0.99x rather than 1. The same number is `FINISHED_AT` in
/// `apps/src/constants/books.ts`; keep the two equal.
pub const FINISHED_AT: f32 = 0.99;

/// Brings an older database up to `SCHEMA_VERSION`, one version at a time,
/// all in one transaction: a step that fails leaves the database as it was.
fn upgrade(conn: &Connection) -> Result<()> {
  let from: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
  if from >= SCHEMA_VERSION {
    return Ok(());
  }
  let tx = conn.unchecked_transaction()?;
  if from < 1 {
    // Columns added before the schema had a version. Libraries from then may
    // already have some of them; new ones have them all.
    add_column(&tx, "books", "metadata_checked_at TEXT")?;
    add_column(&tx, "books", "metadata_updated_at TEXT")?;
    add_column(&tx, "books", "progress_updated_at TEXT")?;
    add_column(&tx, "books", "deleted_at TEXT")?;
    // Existing rows get NULL: the reader reopens at the percentage, as before.
    add_column(&tx, "books", "position TEXT")?;
  }
  // Version 2 added the annotations table, which the CREATE TABLE IF NOT
  // EXISTS above makes for every library, old or new; there is nothing to move.
  if from < 3 {
    // A book's series, and collections the reader makes. The collections table
    // existed, empty and unused, since the first version.
    add_column(&tx, "books", "series TEXT")?;
    add_column(&tx, "books", "series_index REAL")?;
    add_column(&tx, "collections", "book_ids TEXT NOT NULL DEFAULT '[]'")?;
    add_column(&tx, "collections", "created_at TEXT NOT NULL DEFAULT ''")?;
    add_column(&tx, "collections", "updated_at TEXT NOT NULL DEFAULT ''")?;
    add_column(&tx, "collections", "deleted_at TEXT")?;
  }
  if from < 4 {
    // The focus flower a full-screen session grew, and whether it bloomed.
    add_column(&tx, "focus_sessions", "flower TEXT")?;
    add_column(&tx, "focus_sessions", "flower_bloomed INTEGER NOT NULL DEFAULT 0")?;
  }
  if from < 5 {
    // When a book was finished. Until now that was read off its progress, so
    // the books already at their end get the day their progress last moved
    // (which is what the app showed as the day they were finished).
    add_column(&tx, "books", "finished_at TEXT")?;
    // The stamp the date is read from is as old as version 1; a library
    // without it for any reason gets it here rather than failing the upgrade.
    add_column(&tx, "books", "progress_updated_at TEXT")?;
    tx.execute(
      "UPDATE books SET finished_at = COALESCE(progress_updated_at, last_opened, created_at)
       WHERE finished_at IS NULL AND progress >= ?1",
      params![FINISHED_AT]
    )?;
  }
  if from < 6 {
    // A lookup that got no answer (offline, the catalogue down) used to be
    // stamped as made, and the stamp holds the next one off for fourteen
    // days. Books still without a cover get another turn now: it is one
    // lookup each, once, and most of them will find the cover they missed.
    add_column(&tx, "books", "metadata_checked_at TEXT")?;
    tx.execute("UPDATE books SET metadata_checked_at = NULL WHERE cover_url IS NULL", [])?;
  }
  tx.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
  tx.commit()?;
  crate::diag::info(&format!("library database upgraded from version {from} to {SCHEMA_VERSION}"));
  Ok(())
}

/// Adds a column unless it is already there. Only that case is forgiven: a
/// full disk or a locked file is an error, not something to skip past.
fn add_column(conn: &Connection, table: &str, column: &str) -> Result<()> {
  let name = column.split_whitespace().next().unwrap_or(column);
  let exists: bool = conn
    .prepare(&format!("SELECT 1 FROM pragma_table_info('{table}') WHERE name = ?1"))?
    .exists([name])?;
  if !exists {
    conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column}"), [])?;
  }
  Ok(())
}

/// Copies the database before an upgrade, as `library.db.bak-v<version>`, so a
/// bad upgrade can be undone by hand. `VACUUM INTO` writes a consistent copy
/// even while the file is open. A failed copy is logged, not fatal: the
/// upgrade steps are small and transactional on their own.
fn backup_before_upgrade(conn: &Connection, path: &Path) {
  let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap_or(0);
  let has_books: bool = conn
    .query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'books'", [], |_| Ok(true))
    .optional()
    .ok()
    .flatten()
    .unwrap_or(false);
  if version >= SCHEMA_VERSION || !has_books {
    return;
  }
  let backup = PathBuf::from(format!("{}.bak-v{version}", path.display()));
  if backup.exists() {
    return;
  }
  if let Err(error) = conn.execute("VACUUM INTO ?1", [backup.to_string_lossy()]) {
    crate::diag::warn(&format!("could not back up the library before upgrading it: {error}"));
  }
}

/// Where the library database lives.
pub fn database_path() -> Result<PathBuf> {
  db_path()
}

fn db_path() -> Result<PathBuf> {
  // Shares `storage`'s answer rather than repeating the lookup, so the override
  // the host installs at startup applies to the database too.
  Ok(crate::storage::app_data_dir()?.join("library.db"))
}

pub fn now_iso() -> String {
  Utc::now().to_rfc3339()
}

#[cfg(test)]
pub(crate) mod tests {
  use super::*;

  fn column_names(conn: &Connection, table: &str) -> Vec<String> {
    let mut stmt = conn
      .prepare(&format!("PRAGMA table_info({table})"))
      .expect("pragma");
    let names = stmt
      .query_map([], |row| row.get::<_, String>(1))
      .expect("query")
      .map(|value| value.expect("column name"))
      .collect();
    names
  }

  /// The shape of `books` as shipped before metadata_checked_at existed.
  fn legacy_schema(conn: &Connection) {
    conn
      .execute_batch(
        "CREATE TABLE books (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          author TEXT,
          genres TEXT,
          cover_url TEXT,
          local_path TEXT NOT NULL,
          file_hash TEXT NOT NULL,
          progress REAL DEFAULT 0,
          last_opened TEXT,
          created_at TEXT NOT NULL
        );"
      )
      .expect("legacy schema");
  }

  #[test]
  fn migrates_an_existing_library_without_losing_rows() {
    let conn = Connection::open_in_memory().expect("open");
    legacy_schema(&conn);
    conn
      .execute(
        "INSERT INTO books (id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at)
         VALUES ('h1', 'Old Book', 'Someone', '[]', NULL, '/books/h1.epub', 'h1', 0.5, NULL, '2026-01-01T00:00:00Z')",
        []
      )
      .expect("seed row");

    apply_schema(&conn).expect("migrate");

    assert!(column_names(&conn, "books").contains(&"metadata_checked_at".to_string()));

    let mut stmt = conn
      .prepare(&format!("SELECT {} FROM books", Database::BOOK_COLUMNS))
      .expect("prepare");
    let books: Vec<BookRecord> = stmt
      .query_map([], Database::row_to_book)
      .expect("query")
      .map(|row| row.expect("row"))
      .collect();

    assert_eq!(books.len(), 1, "the existing row must survive the migration");
    assert_eq!(books[0].title, "Old Book");
    assert_eq!(books[0].progress, 0.5);
    assert_eq!(
      books[0].metadata_checked_at, None,
      "migrated books start unchecked so enrichment runs once"
    );
    assert!(column_names(&conn, "books").contains(&"position".to_string()));
    assert_eq!(books[0].position, None, "migrated books reopen at their percentage");
  }

  #[test]
  fn an_upgrade_stamps_the_schema_version_and_is_idempotent() {
    let conn = Connection::open_in_memory().expect("open");
    legacy_schema(&conn);
    apply_schema(&conn).expect("first upgrade");
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).expect("version");
    assert_eq!(version, SCHEMA_VERSION);
    apply_schema(&conn).expect("running it again changes nothing");
    assert_eq!(column_names(&conn, "books").iter().filter(|name| *name == "position").count(), 1);
  }

  #[test]
  fn an_upgrade_does_not_swallow_real_errors() {
    let conn = Connection::open_in_memory().expect("open");
    // No books table at all: adding a column to it must fail, not be skipped.
    assert!(add_column(&conn, "books", "position TEXT").is_err());
  }

  fn seeded_book(db: &Database) {
    db.conn
      .execute(
        "INSERT INTO books (id, title, local_path, file_hash, progress, created_at)
         VALUES ('b1', 'Book', '/b1.epub', 'b1', 0.0, '2026-01-01T00:00:00Z')",
        []
      )
      .expect("seed");
  }

  #[test]
  fn a_series_from_the_file_never_overrides_the_readers_word() {
    let db = memory_db();
    seeded_book(&db);
    db.fill_series_from_file("b1", "Discworld", Some(1.0)).expect("fill");
    let book = db.find_by_id("b1").expect("query").expect("present");
    assert_eq!((book.series.as_deref(), book.series_index), (Some("Discworld"), Some(1.0)));
    // Filling from the file is not an edit: it leaves the metadata stamp alone.
    assert_eq!(book.metadata_updated_at, None);

    // The reader says it is in no series; a later scan does not bring one back.
    assert!(db.set_series("b1", Some(""), None).expect("set"));
    db.fill_series_from_file("b1", "Discworld", Some(1.0)).expect("fill again");
    let book = db.find_by_id("b1").expect("query").expect("present");
    assert_eq!(book.series.as_deref(), Some(""));
    assert!(book.metadata_updated_at.is_some(), "the reader's word is stamped, so it syncs");
    assert!(!db.set_series("missing", Some("X"), None).expect("set"));
  }

  #[test]
  fn collections_are_saved_listed_and_deleted_as_tombstones() {
    let db = memory_db();
    let mut shelf = Collection {
      id: "c1".into(),
      name: "Book club".into(),
      book_ids: vec!["b2".into(), "b1".into()],
      created_at: "2026-09-01T10:00:00Z".into(),
      updated_at: "2026-09-01T10:00:00Z".into(),
      deleted_at: None
    };
    db.put_collection(&shelf).expect("save");
    assert_eq!(db.collections().expect("list"), vec![shelf.clone()]);

    shelf.deleted_at = Some("2026-09-02T10:00:00Z".into());
    db.put_collection(&shelf).expect("delete");
    assert!(db.collections().expect("list").is_empty());
    assert_eq!(db.all_collections().expect("all").len(), 1, "the tombstone stays for the backup");
    db.retire_collection_tombstones(&[]).expect("retire");
    assert!(db.all_collections().expect("all").is_empty());
  }

  #[test]
  fn version_3_adds_series_and_collection_columns_to_an_old_library() {
    let conn = Connection::open_in_memory().expect("open");
    conn
      .execute_batch(
        "CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, genres TEXT,
           cover_url TEXT, local_path TEXT NOT NULL, file_hash TEXT NOT NULL, progress REAL DEFAULT 0,
           last_opened TEXT, created_at TEXT NOT NULL);
         CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT NOT NULL);
         INSERT INTO collections (id, name) VALUES ('old', 'Never used');
         PRAGMA user_version = 2;"
      )
      .expect("old library");
    apply_schema(&conn).expect("upgrade");
    for column in ["series", "series_index"] {
      assert!(column_names(&conn, "books").contains(&column.to_string()), "{column}");
    }
    for column in ["book_ids", "created_at", "updated_at", "deleted_at"] {
      assert!(column_names(&conn, "collections").contains(&column.to_string()), "{column}");
    }
    let db = Database { conn, path: PathBuf::from(":memory:") };
    let old = db.find_collection("old").expect("query").expect("present");
    assert!(old.book_ids.is_empty());
  }

  #[test]
  fn version_4_adds_the_focus_flower_to_old_sessions() {
    let conn = Connection::open_in_memory().expect("open");
    conn
      .execute_batch(
        "CREATE TABLE focus_sessions (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
           date_key TEXT NOT NULL, minutes REAL NOT NULL, book_id TEXT, title TEXT, notes TEXT,
           ended_reason TEXT NOT NULL, clean INTEGER NOT NULL DEFAULT 0, style_seed TEXT NOT NULL, burned_at TEXT);
         INSERT INTO focus_sessions (id, started_at, ended_at, date_key, minutes, ended_reason, clean, style_seed)
           VALUES ('s1', '2026-09-01T10:00:00Z', '2026-09-01T10:20:00Z', '2026-09-01', 20, 'completed', 1, 's1');
         PRAGMA user_version = 3;"
      )
      .expect("old library");
    apply_schema(&conn).expect("upgrade");
    let db = Database { conn, path: PathBuf::from(":memory:") };
    let sessions = db.focus_sessions().expect("sessions");
    assert_eq!(sessions.len(), 1, "the old session survives");
    assert_eq!(sessions[0].flower, None);
    assert!(!sessions[0].flower_bloomed);

    let mut bloomed = session("s2", "2026-09-02T10:20:00Z");
    bloomed.flower = Some("tulip".to_string());
    bloomed.flower_bloomed = true;
    db.insert_focus_session(&bloomed).expect("insert");
    let back = db.focus_sessions().expect("sessions");
    let s2 = back.iter().find(|s| s.id == "s2").expect("s2");
    assert_eq!(s2.flower.as_deref(), Some("tulip"));
    assert!(s2.flower_bloomed);
  }

  /// Reaching the end stamps the day; reading the book again keeps it; and
  /// being opened while already at the end is not finishing it again.
  #[test]
  fn reaching_the_end_is_finishing_and_the_date_stays() {
    let db = memory_db();
    seeded_book(&db);
    db.update_progress("b1", 0.6, None, None).expect("reading");
    assert_eq!(db.find_by_id("b1").expect("query").expect("present").finished_at, None);

    db.update_progress("b1", 0.995, None, None).expect("the last page");
    let finished = db.find_by_id("b1").expect("query").expect("present").finished_at.expect("finished");
    assert!(!finished.is_empty());

    // Opened again at the end, then read again from the start.
    db.conn.execute("UPDATE books SET finished_at = '2026-03-01T10:00:00Z' WHERE id = 'b1'", []).expect("backdate");
    db.update_progress("b1", 1.0, None, None).expect("still at the end");
    db.update_progress("b1", 0.02, None, None).expect("a second reading");
    let book = db.find_by_id("b1").expect("query").expect("present");
    assert_eq!(book.finished_at.as_deref(), Some("2026-03-01T10:00:00Z"));
    assert_eq!(book.progress, 0.02);

    // Finished the second time: that is the day now.
    db.update_progress("b1", 0.99, None, None).expect("finished again");
    let again = db.find_by_id("b1").expect("query").expect("present").finished_at.expect("finished");
    assert_ne!(again, "2026-03-01T10:00:00Z");
  }

  #[test]
  fn a_book_is_marked_finished_or_not_started() {
    let db = memory_db();
    seeded_book(&db);
    db.update_progress("b1", 0.4, None, Some("epubcfi(/6/8!/4/2/1:0)".to_string())).expect("reading");

    db.set_finished("b1", true, "2026-10-07T09:00:00Z").expect("finished");
    let book = db.find_by_id("b1").expect("query").expect("present");
    assert_eq!((book.progress, book.position.as_deref()), (1.0, None));
    assert_eq!(book.finished_at.as_deref(), Some("2026-10-07T09:00:00Z"));
    assert_eq!(book.progress_updated_at.as_deref(), Some("2026-10-07T09:00:00Z"), "stamped, so it syncs");

    db.set_finished("b1", false, "2026-10-08T09:00:00Z").expect("not started");
    let book = db.find_by_id("b1").expect("query").expect("present");
    assert_eq!((book.progress, book.position.as_deref()), (0.0, None));
    // Said on purpose, which is not the same as never finished.
    assert_eq!(book.finished_at.as_deref(), Some(""));
    assert_eq!(book.progress_updated_at.as_deref(), Some("2026-10-08T09:00:00Z"));
  }

  /// A library from before finished dates: the books at their end get the day
  /// their progress last moved, and the others get none.
  #[test]
  fn version_5_dates_the_books_already_finished() {
    let conn = Connection::open_in_memory().expect("open");
    conn
      .execute_batch(
        "CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, genres TEXT, cover_url TEXT,
           local_path TEXT NOT NULL, file_hash TEXT NOT NULL, progress REAL DEFAULT 0, last_opened TEXT,
           created_at TEXT NOT NULL, metadata_checked_at TEXT, metadata_updated_at TEXT, progress_updated_at TEXT,
           deleted_at TEXT, position TEXT, series TEXT, series_index REAL);
         INSERT INTO books (id, title, local_path, file_hash, progress, created_at, progress_updated_at, last_opened) VALUES
           ('done', 'Done', '/done.epub', 'done', 0.995, '2026-01-01T00:00:00Z', '2026-05-02T20:00:00Z', '2026-06-01T08:00:00Z'),
           ('old', 'Old', '/old.epub', 'old', 1.0, '2025-01-01T00:00:00Z', NULL, '2025-02-03T08:00:00Z'),
           ('half', 'Half', '/half.epub', 'half', 0.5, '2026-01-01T00:00:00Z', '2026-05-02T20:00:00Z', NULL);
         PRAGMA user_version = 4;"
      )
      .expect("old library");
    apply_schema(&conn).expect("upgrade");
    let db = Database { conn, path: PathBuf::from(":memory:") };
    let finished = |id: &str| db.find_by_id(id).expect("query").expect("present").finished_at;
    assert_eq!(finished("done").as_deref(), Some("2026-05-02T20:00:00Z"));
    assert_eq!(finished("old").as_deref(), Some("2025-02-03T08:00:00Z"), "no progress stamp: the day it was last opened");
    assert_eq!(finished("half"), None);
    assert_eq!(db.schema_version(), SCHEMA_VERSION);
  }

  /// Books with no cover get another lookup: the old stamp may be from one
  /// that never got an answer. A book with a cover keeps its stamp.
  #[test]
  fn version_6_gives_books_without_a_cover_another_lookup() {
    let conn = Connection::open_in_memory().expect("open");
    apply_schema(&conn).expect("schema");
    conn
      .execute_batch(
        "INSERT INTO books (id, title, local_path, file_hash, progress, created_at, metadata_checked_at, cover_url) VALUES
           ('bare', 'Bare', '/bare.pdf', 'bare', 0.0, '2026-01-01T00:00:00Z', '2026-10-05T10:00:00Z', NULL),
           ('covered', 'Covered', '/covered.epub', 'covered', 0.0, '2026-01-01T00:00:00Z', '2026-10-05T10:00:00Z', '/covers/covered-cover.jpg');
         PRAGMA user_version = 5;"
      )
      .expect("a library at version 5");
    apply_schema(&conn).expect("upgrade");
    let db = Database { conn, path: PathBuf::from(":memory:") };
    let checked = |id: &str| db.find_by_id(id).expect("query").expect("present").metadata_checked_at;
    assert_eq!(checked("bare"), None);
    assert_eq!(checked("covered").as_deref(), Some("2026-10-05T10:00:00Z"));
    assert_eq!(db.schema_version(), SCHEMA_VERSION);
  }

  #[test]
  fn progress_and_position_are_written_as_a_pair() {
    let db = memory_db();
    seeded_book(&db);
    db.update_progress("b1", 0.4, None, Some("epubcfi(/6/8!/4/2/1:0)".to_string()))
      .expect("update");

    let book = db.find_by_id("b1").expect("query").expect("present");
    assert_eq!(book.progress, 0.4);
    assert_eq!(book.position.as_deref(), Some("epubcfi(/6/8!/4/2/1:0)"));
    assert!(book.progress_updated_at.is_some());
  }

  /// Several pages can share one percentage; turning between them is still
  /// reading, and must be stamped or the merge would keep the older CFI.
  #[test]
  fn a_new_position_at_the_same_percentage_is_a_move() {
    let db = memory_db();
    seeded_book(&db);
    db.update_progress("b1", 0.4, None, Some("epubcfi(/6/8!/4/2/1:0)".to_string()))
      .expect("first");
    db.conn
      .execute("UPDATE books SET progress_updated_at = '2026-01-02T00:00:00Z'", [])
      .expect("backdate");

    db.update_progress("b1", 0.4, None, Some("epubcfi(/6/8!/4/40/1:0)".to_string()))
      .expect("second");

    let book = db.find_by_id("b1").expect("query").expect("present");
    assert_eq!(book.position.as_deref(), Some("epubcfi(/6/8!/4/40/1:0)"));
    assert_ne!(book.progress_updated_at.as_deref(), Some("2026-01-02T00:00:00Z"));
  }

  /// A caller that reports only the percentage, unchanged, is just an open: it
  /// must neither stamp progress nor forget the stored position.
  #[test]
  fn reopening_without_a_position_keeps_the_stored_one() {
    let db = memory_db();
    seeded_book(&db);
    db.update_progress("b1", 0.4, None, Some("epubcfi(/6/8!/4/2/1:0)".to_string()))
      .expect("first");
    db.conn
      .execute("UPDATE books SET progress_updated_at = '2026-01-02T00:00:00Z'", [])
      .expect("backdate");

    db.update_progress("b1", 0.4, Some("2026-01-03T00:00:00Z".to_string()), None)
      .expect("open");

    let book = db.find_by_id("b1").expect("query").expect("present");
    assert_eq!(book.position.as_deref(), Some("epubcfi(/6/8!/4/2/1:0)"));
    assert_eq!(book.progress_updated_at.as_deref(), Some("2026-01-02T00:00:00Z"));
  }

  /// A move reported without a position must not leave behind a CFI that
  /// points somewhere the new percentage does not.
  #[test]
  fn a_move_without_a_position_clears_the_stale_one() {
    let db = memory_db();
    seeded_book(&db);
    db.update_progress("b1", 0.4, None, Some("epubcfi(/6/8!/4/2/1:0)".to_string()))
      .expect("first");
    db.update_progress("b1", 0.7, None, None).expect("move");

    let book = db.find_by_id("b1").expect("query").expect("present");
    assert_eq!(book.progress, 0.7);
    assert_eq!(book.position, None);
  }

  #[test]
  fn applying_the_schema_twice_is_a_no_op() {
    let conn = Connection::open_in_memory().expect("open");
    apply_schema(&conn).expect("first");
    apply_schema(&conn).expect("second");

    let columns = column_names(&conn, "books");
    assert_eq!(
      columns.iter().filter(|name| *name == "metadata_checked_at").count(),
      1
    );
  }

  #[test]
  fn a_fresh_database_already_has_the_column() {
    let conn = Connection::open_in_memory().expect("open");
    apply_schema(&conn).expect("schema");
    assert!(column_names(&conn, "books").contains(&"metadata_checked_at".to_string()));
  }

  pub(crate) fn memory_db() -> Database {
    let conn = Connection::open_in_memory().expect("open");
    apply_schema(&conn).expect("schema");
    Database { conn, path: PathBuf::from(":memory:") }
  }

  /// A new database in a file, as the app opens one or as SQLite would by
  /// default (`logged` false): for measuring what the disk costs.
  pub(crate) fn disk_db(path: &Path, logged: bool) -> Database {
    for suffix in ["", "-wal", "-shm", "-journal"] {
      let _ = fs::remove_file(format!("{}{suffix}", path.display()));
    }
    let conn = Connection::open(path).expect("open");
    if logged {
      write_ahead(&conn);
    }
    apply_schema(&conn).expect("schema");
    Database { conn, path: path.to_path_buf() }
  }

  fn session(id: &str, ended_at: &str) -> FocusSessionRecord {
    FocusSessionRecord {
      id: id.to_string(),
      started_at: ended_at.to_string(),
      ended_at: ended_at.to_string(),
      date_key: ended_at[..10].to_string(),
      minutes: 20.0,
      book_id: None,
      title: None,
      notes: None,
      ended_reason: "completed".to_string(),
      clean: true,
      style_seed: id.to_string(),
      burned_at: None,
      flower: None,
      flower_bloomed: false
    }
  }

  #[test]
  fn crediting_a_day_accumulates_rather_than_replacing() {
    let db = memory_db();
    db.credit_minutes("2026-03-01", 8.0, 20).expect("first");
    db.credit_minutes("2026-03-01", 7.5, 20).expect("second");
    let days = db.reading_days().expect("read");
    assert_eq!(days["2026-03-01"].minutes, 15.5);
    assert_eq!(days["2026-03-01"].goal_minutes, 20);
  }

  #[test]
  fn a_cover_is_idempotent() {
    let db = memory_db();
    db.apply_cover("2026-03-02", crate::habit::CoverKind::Grace, 20).expect("once");
    db.apply_cover("2026-03-02", crate::habit::CoverKind::Grace, 20).expect("twice");
    let days = db.reading_days().expect("read");
    assert!(days["2026-03-02"].grace_used);
    assert!(!days["2026-03-02"].freeze_used);
  }

  #[test]
  fn covering_a_day_does_not_erase_the_minutes_already_read() {
    let db = memory_db();
    db.credit_minutes("2026-03-02", 6.0, 20).expect("credit");
    db.apply_cover("2026-03-02", crate::habit::CoverKind::Freeze, 20).expect("cover");
    let days = db.reading_days().expect("read");
    assert_eq!(days["2026-03-02"].minutes, 6.0);
    assert!(days["2026-03-02"].freeze_used);
  }

  #[test]
  fn burning_tombstones_the_newest_sessions_and_keeps_the_rest() {
    let db = memory_db();
    for (id, at) in [("a", "2026-03-01T10:00:00Z"), ("b", "2026-03-02T10:00:00Z"),
                     ("c", "2026-03-03T10:00:00Z"), ("d", "2026-03-04T10:00:00Z")] {
      db.insert_focus_session(&session(id, at)).expect("insert");
    }
    let burned = db.burn_recent_sessions(2, "2026-03-05T00:00:00Z").expect("burn");
    assert_eq!(burned, vec!["d".to_string(), "c".to_string()]);
    assert_eq!(db.unburned_session_count().expect("count"), 2);

    // Nothing is deleted: the shelf keeps its scars.
    let all = db.focus_sessions().expect("list");
    assert_eq!(all.len(), 4);
    assert!(all.iter().find(|s| s.id == "d").unwrap().burned_at.is_some());
    assert!(all.iter().find(|s| s.id == "a").unwrap().burned_at.is_none());
  }

  #[test]
  fn a_second_burn_skips_what_already_burned() {
    let db = memory_db();
    for (id, at) in [("a", "2026-03-01T10:00:00Z"), ("b", "2026-03-02T10:00:00Z")] {
      db.insert_focus_session(&session(id, at)).expect("insert");
    }
    db.burn_recent_sessions(1, "2026-03-03T00:00:00Z").expect("first");
    let second = db.burn_recent_sessions(1, "2026-03-04T00:00:00Z").expect("second");
    assert_eq!(second, vec!["a".to_string()]);
    assert_eq!(db.unburned_session_count().expect("count"), 0);
  }

  #[test]
  fn burning_more_than_the_shelf_holds_is_safe() {
    let db = memory_db();
    db.insert_focus_session(&session("a", "2026-03-01T10:00:00Z")).expect("insert");
    let burned = db.burn_recent_sessions(50, "2026-03-05T00:00:00Z").expect("burn");
    assert_eq!(burned.len(), 1);
    assert_eq!(db.burn_recent_sessions(0, "x").expect("zero").len(), 0);
  }

  #[test]
  fn re_recording_a_session_id_does_not_duplicate_it() {
    let db = memory_db();
    db.insert_focus_session(&session("a", "2026-03-01T10:00:00Z")).expect("first");
    db.insert_focus_session(&session("a", "2026-03-01T10:00:00Z")).expect("again");
    assert_eq!(db.focus_sessions().expect("list").len(), 1);
  }

  #[test]
  fn the_habit_tables_are_added_to_an_existing_library() {
    let conn = Connection::open_in_memory().expect("open");
    legacy_schema(&conn);
    conn.execute(
      "INSERT INTO books (id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at)
       VALUES ('h1','Old Book',NULL,'[]',NULL,'/b.epub','h1',0.5,NULL,'2026-01-01T00:00:00Z')",
      []
    ).expect("seed");

    apply_schema(&conn).expect("migrate");

    let db = Database { conn, path: PathBuf::from(":memory:") };
    assert_eq!(db.list_books().expect("books").len(), 1, "the library survives");
    assert!(db.reading_days().expect("days").is_empty());
    assert!(db.focus_sessions().expect("sessions").is_empty());
  }

  /// Drive manifests written before this field existed must still deserialize.
  #[test]
  fn legacy_sync_payloads_deserialize() {
    let json = r#"{
      "id": "h1",
      "title": "Old Book",
      "author": null,
      "genres": [],
      "coverUrl": null,
      "localPath": "/books/h1.epub",
      "fileHash": "h1",
      "progress": 0.25,
      "lastOpened": null,
      "createdAt": "2026-01-01T00:00:00Z"
    }"#;
    let book: BookRecord = serde_json::from_str(json).expect("legacy payload");
    assert_eq!(book.metadata_checked_at, None);
    assert_eq!(book.position, None);
  }

  #[test]
  fn pip_purchases_round_trip_and_ignore_a_repeat() {
    let db = memory_db();
    let purchase = crate::pip::Purchase {
      id: "buy-1".to_string(),
      item_kind: "skin".to_string(),
      item_id: "chef".to_string(),
      price: 300,
      bought_at: "2026-09-01T10:00:00Z".to_string()
    };
    db.insert_pip_purchase(&purchase).expect("insert");
    db.insert_pip_purchase(&purchase).expect("again");
    assert_eq!(db.pip_purchases().expect("purchases"), vec![purchase]);
  }

  #[test]
  fn pip_state_round_trips() {
    let db = memory_db();
    assert!(db.pip_state().expect("read").is_none());
    let mut state = crate::pip::PipState::fresh("2026-09-01T10:00:00Z");
    state.outfit = vec!["tophat".to_string(), "scarf".to_string()];
    state.room.insert("left".to_string(), "armchair".to_string());
    state.signature = "moonwalk".to_string();
    db.put_pip_state(&state).expect("write");
    assert_eq!(db.pip_state().expect("read"), Some(state.clone()));
    state.mood = 12.5;
    db.put_pip_state(&state).expect("overwrite");
    assert_eq!(db.pip_state().expect("read").map(|s| s.mood), Some(12.5));
  }

  fn annotation(id: &str, book_id: &str, kind: &str, deleted_at: Option<&str>) -> Annotation {
    Annotation {
      id: id.to_string(),
      book_id: book_id.to_string(),
      kind: kind.to_string(),
      cfi: "epubcfi(/6/2!/4/2,/1:0,/1:5)".to_string(),
      text: Some("It was a dark and stormy night".to_string()),
      note: None,
      color: Some("yellow".to_string()),
      chapter: Some("Chapter 1".to_string()),
      created_at: "2026-09-01T10:00:00Z".to_string(),
      updated_at: "2026-09-01T10:00:00Z".to_string(),
      deleted_at: deleted_at.map(str::to_string)
    }
  }

  #[test]
  fn annotation_highlight_counts_leave_out_bookmarks_and_deleted_ones() {
    let db = memory_db();
    assert!(db.highlight_counts().expect("counts").is_empty());

    db.put_annotation(&annotation("h1", "b1", "highlight", None)).expect("save");
    db.put_annotation(&annotation("h2", "b1", "highlight", None)).expect("save");
    db.put_annotation(&annotation("m1", "b1", "bookmark", None)).expect("save");
    db.put_annotation(&annotation("h3", "b2", "highlight", None)).expect("save");
    db.put_annotation(&annotation("h4", "b2", "highlight", Some("2026-09-02T00:00:00Z"))).expect("save");
    // Only a bookmark, and only a deleted highlight: neither book is listed.
    db.put_annotation(&annotation("m2", "b3", "bookmark", None)).expect("save");
    db.put_annotation(&annotation("h5", "b4", "highlight", Some("2026-09-02T00:00:00Z"))).expect("save");

    assert_eq!(
      db.highlight_counts().expect("counts"),
      vec![
        HighlightCount { book_id: "b1".to_string(), count: 2 },
        HighlightCount { book_id: "b2".to_string(), count: 1 }
      ]
    );
  }

  #[test]
  fn clearing_everything_clears_pip_too() {
    let db = memory_db();
    db.put_pip_state(&crate::pip::PipState::fresh("2026-09-01T10:00:00Z")).expect("write");
    db.clear_all().expect("clear");
    assert!(db.pip_state().expect("read").is_none());
    assert!(db.pip_purchases().expect("purchases").is_empty());
  }

  /// The bug this guards: `DELETE` only marks the pages free, so after "Delete
  /// All Data" the file still held every title, note and folder path, there
  /// for anyone who opened it in a text editor.
  #[test]
  fn clearing_everything_leaves_nothing_readable_in_the_file() {
    let path = std::env::temp_dir().join(format!("leaflet-clear-test-{}.db", std::process::id()));
    let _ = fs::remove_file(&path);
    let log = PathBuf::from(format!("{}-wal", path.display()));
    let _ = fs::remove_file(&log);
    let conn = Connection::open(&path).expect("open");
    write_ahead(&conn);
    apply_schema(&conn).expect("schema");
    let db = Database { conn, path: path.clone() };
    seeded_book(&db);
    for index in 0..200 {
      db.set_setting(&format!("key-{index}"), &format!("ZZ-PRIVATE-{index}-ZZ D:\\Books\\A Title I Read.epub")).expect("setting");
    }
    assert!(fs::read(&log).expect("log").windows(11).any(|window| window == b"ZZ-PRIVATE-"), "the test writes through the log");

    db.clear_all().expect("clear");

    // With the app still running, which is when it matters: the log as well
    // as the file, since what was written last is in the log.
    for file in [&path, &log] {
      let bytes = fs::read(file).unwrap_or_default();
      let holds = |needle: &str| bytes.windows(needle.len()).any(|window| window == needle.as_bytes());
      assert!(!holds("ZZ-PRIVATE-"), "a deleted setting is still in {}", file.display());
      assert!(!holds("A Title I Read"), "a deleted path is still in {}", file.display());
    }
    drop(db);
    let _ = fs::remove_file(&path);
  }

  /// A database on disk keeps a write-ahead log and does not wait for the
  /// disk at every commit; what was written is there when it is opened again.
  #[test]
  fn a_database_on_disk_writes_ahead() {
    let path = std::env::temp_dir().join(format!("leaflet-wal-test-{}.db", std::process::id()));
    let _ = fs::remove_file(&path);
    {
      let conn = Connection::open(&path).expect("open");
      write_ahead(&conn);
      apply_schema(&conn).expect("schema");
      let mode: String = conn.query_row("PRAGMA journal_mode", [], |row| row.get(0)).expect("mode");
      assert_eq!(mode, "wal");
      // 1 is NORMAL: the disk is waited for at a checkpoint.
      let synchronous: i64 = conn.query_row("PRAGMA synchronous", [], |row| row.get(0)).expect("synchronous");
      assert_eq!(synchronous, 1);
      let db = Database { conn, path: path.clone() };
      db.set_setting("kept", "yes").expect("setting");
    }
    // The mode is the file's: a connection that asks for nothing has it.
    let conn = Connection::open(&path).expect("open again");
    let mode: String = conn.query_row("PRAGMA journal_mode", [], |row| row.get(0)).expect("mode");
    assert_eq!(mode, "wal");
    let db = Database { conn, path: path.clone() };
    assert_eq!(db.get_setting("kept").expect("read").as_deref(), Some("yes"));
    drop(db);
    let _ = fs::remove_file(&path);
  }

  /// What a transaction wrote is kept whole, and what a failed one wrote is
  /// not kept at all.
  #[test]
  fn a_transaction_keeps_all_of_its_writes_or_none() {
    let db = memory_db();
    let kept = db.in_transaction(|| {
      db.set_setting("one", "1")?;
      db.set_setting("two", "2")?;
      Ok(2)
    });
    assert_eq!(kept.expect("commit"), 2);
    assert_eq!(db.get_setting("two").expect("read").as_deref(), Some("2"));

    let failed: Result<()> = db.in_transaction(|| {
      db.set_setting("one", "changed")?;
      db.set_setting("three", "3")?;
      anyhow::bail!("the fourth row would not write")
    });
    assert!(failed.is_err());
    assert_eq!(db.get_setting("one").expect("read").as_deref(), Some("1"));
    assert_eq!(db.get_setting("three").expect("read"), None);
    // And the database takes writes again after it.
    db.set_setting("four", "4").expect("write");
    assert_eq!(db.get_setting("four").expect("read").as_deref(), Some("4"));
  }

  /// A database that cannot keep a log (one in memory) is left as it was.
  #[test]
  fn a_database_that_cannot_log_keeps_its_journal() {
    let conn = Connection::open_in_memory().expect("open");
    write_ahead(&conn);
    let synchronous: i64 = conn.query_row("PRAGMA synchronous", [], |row| row.get(0)).expect("synchronous");
    assert_eq!(synchronous, 2);
  }
}
