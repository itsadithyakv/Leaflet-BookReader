use anyhow::Result;
use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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
  pub burned_at: Option<String>
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
    let conn = Connection::open(&path)?;
    let db = Self { conn, path };
    db.init_schema()?;
    Ok(db)
  }

  pub fn path(&self) -> &Path {
    &self.path
  }

  fn init_schema(&self) -> Result<()> {
    apply_schema(&self.conn)
  }

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
      last_opened: row.get(8)?,
      created_at: row.get(9)?,
      metadata_checked_at: row.get(10)?,
      metadata_updated_at: row.get(11)?,
      progress_updated_at: row.get(12)?,
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
    let mut stmt = self.conn.prepare(
      "SELECT id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at, metadata_checked_at, metadata_updated_at, progress_updated_at, deleted_at, position FROM books WHERE deleted_at IS NULL"
    )?;
    let rows = stmt.query_map([], Self::row_to_book)?;

    let mut books = Vec::new();
    for row in rows {
      books.push(row?);
    }
    Ok(books)
  }

  pub fn find_by_id(&self, id: &str) -> Result<Option<BookRecord>> {
    let mut stmt = self.conn.prepare(
      "SELECT id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at, metadata_checked_at, metadata_updated_at, progress_updated_at, deleted_at, position FROM books WHERE id = ?1"
    )?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
      return Ok(Some(Self::row_to_book(row)?));
    }
    Ok(None)
  }

  pub fn find_by_hash(&self, hash: &str) -> Result<Option<BookRecord>> {
    let mut stmt = self.conn.prepare(
      "SELECT id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at, metadata_checked_at, metadata_updated_at, progress_updated_at, deleted_at, position FROM books WHERE file_hash = ?1"
    )?;
    let mut rows = stmt.query(params![hash])?;
    if let Some(row) = rows.next()? {
      return Ok(Some(Self::row_to_book(row)?));
    }
    Ok(None)
  }

  pub fn upsert_book(&self, book: &BookRecord) -> Result<()> {
    let genres_json = serde_json::to_string(&book.genres).ok();
    self.conn.execute(
      "INSERT INTO books (id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at, metadata_checked_at, metadata_updated_at, progress_updated_at, deleted_at, position)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
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
        position = excluded.position",
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
        book.position
      ]
    )?;
    Ok(())
  }

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

  /// Every book row including tombstones. Only sync wants these: a deletion
  /// has to travel to the other devices before its row can be forgotten.
  pub fn list_books_for_sync(&self) -> Result<Vec<BookRecord>> {
    let mut stmt = self.conn.prepare(
      "SELECT id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at, metadata_checked_at, metadata_updated_at, progress_updated_at, deleted_at, position FROM books"
    )?;
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
    if let Some(opened_at) = last_opened {
      self.log_reading_session(book_id, &opened_at)?;
    }
    Ok(())
  }

  // ---- habit ledger ------------------------------------------------------

  /// The whole day ledger, keyed by local date. Small enough to read whole:
  /// one row per day the app was used.
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

  /// Adds reading time to a day. The goal is re-stamped because the goal in
  /// force today is today's goal; past days keep the snapshot they were earned
  /// against, since they are never credited again.
  pub fn credit_minutes(&self, date_key: &str, minutes: f64, goal_minutes: i64) -> Result<()> {
    self.conn.execute(
      "INSERT INTO reading_days (date_key, minutes, goal_minutes) VALUES (?1, ?2, ?3)
       ON CONFLICT(date_key) DO UPDATE SET
         minutes = reading_days.minutes + excluded.minutes,
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
         ended_reason, clean, style_seed, burned_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
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
        session.burned_at
      ]
    )?;
    Ok(())
  }

  /// Newest first. Burned sessions are included so the shelf can show scars.
  pub fn focus_sessions(&self) -> Result<Vec<FocusSessionRecord>> {
    let mut stmt = self.conn.prepare(
      "SELECT id, started_at, ended_at, date_key, minutes, book_id, title, notes,
              ended_reason, clean, style_seed, burned_at
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
        burned_at: row.get(11)?
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
         ended_reason, clean, style_seed, burned_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT(id) DO UPDATE SET
         minutes = excluded.minutes,
         notes = excluded.notes,
         burned_at = excluded.burned_at",
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
        session.burned_at
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
       DELETE FROM pip_harvests;"
    )?;
    Ok(())
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
        position TEXT
      );
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
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
        burned_at TEXT
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
  // Fail harmlessly when the column is already present, which is the point:
  // existing libraries gain them once, new ones already have them.
  let _ = conn.execute("ALTER TABLE books ADD COLUMN metadata_checked_at TEXT", []);
  let _ = conn.execute("ALTER TABLE books ADD COLUMN metadata_updated_at TEXT", []);
  let _ = conn.execute("ALTER TABLE books ADD COLUMN progress_updated_at TEXT", []);
  let _ = conn.execute("ALTER TABLE books ADD COLUMN deleted_at TEXT", []);
  // Existing rows get NULL: the reader reopens at the percentage, as before.
  let _ = conn.execute("ALTER TABLE books ADD COLUMN position TEXT", []);
  Ok(())
}

fn db_path() -> Result<PathBuf> {
  // Shares `storage`'s answer rather than repeating the lookup, so the override
  // the host installs at startup applies to the database too.
  Ok(crate::storage::app_data_dir()?.join("library.db"))
}

pub fn now_iso() -> String {
  DateTime::<Utc>::from(Utc::now()).to_rfc3339()
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
      .prepare(
        "SELECT id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at, metadata_checked_at, metadata_updated_at, progress_updated_at, deleted_at, position FROM books"
      )
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
      burned_at: None
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

  #[test]
  fn clearing_everything_clears_pip_too() {
    let db = memory_db();
    db.put_pip_state(&crate::pip::PipState::fresh("2026-09-01T10:00:00Z")).expect("write");
    db.clear_all().expect("clear");
    assert!(db.pip_state().expect("read").is_none());
    assert!(db.pip_purchases().expect("purchases").is_empty());
  }
}
