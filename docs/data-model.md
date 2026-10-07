# Data model

## SQLite

One file, `<app data>/library.db`, opened through `rusqlite` with a bundled
SQLite so there is no system dependency on any platform.

**How it writes (1.3).** The database keeps a write-ahead log
(`journal_mode = WAL`, `synchronous = NORMAL`; `write_ahead` in `db/mod.rs`),
so `library.db-wal` and `library.db-shm` sit beside it while the app runs.
SQLite's default waited for the disk twice a commit: 17 ms a saved place on
the development PC and 28 ms (328 at worst) on its second drive, on the
window's own thread, because most commands are not `async`. With the log a
commit is 0.03 ms. What is given up is the last moments before a power cut,
never the database. The mode is kept in the file, so an older Leaflet opens it
the same way; a folder that cannot hold a log keeps the default and says so
in the log file. "Delete All Data" empties the log as well as rebuilding the
file (`clear_all`; a test reads both for what was deleted), and a database set
aside as broken takes its log with it.

A sync writes every row of the merged document, so `sync::store::apply` is one
transaction (`Database::in_transaction`): 18 s row by row for a reader with
300 books, a year of days and 900 marks, 0.08 s as one, and a run that fails
part way leaves the library as it was. The measurement is kept:
`cargo test --lib sync::store::tests::what_applying -- --ignored --nocapture`.

### `books`

| Column | Notes |
| --- | --- |
| `id` TEXT PK | SHA-256 of the file contents |
| `title`, `author`, `genres` | `genres` is a JSON array |
| `cover_url` | **Local** path to the cached cover. Never synced. A path ending `-page.jpg` is a PDF's first page standing in for one |
| `local_path` | **Local** absolute path. Never synced. |
| `file_hash` | Same as `id`; kept for the index |
| `progress` REAL | 0–1 |
| `position` TEXT | Exact place (EPUB CFI); `NULL` for page-based books. Written with `progress` |
| `last_opened`, `created_at` | RFC 3339 |
| `metadata_checked_at` | Drives the 14-day enrichment cooldown. Stamped only when the catalogue answered (1.3.1) |
| `metadata_updated_at` | When title/author/genres last changed |
| `progress_updated_at` | When `progress` last changed — *not* when opened |
| `finished_at` | When the reader finished the book (1.3, schema 5): stamped when `progress` reaches `FINISHED_AT` (0.99) from short of it, and by "Mark as finished". It stays through a second reading. `''` is the reader saying "not started"; `NULL` is never finished |
| `deleted_at` | Tombstone; the row survives so the deletion can travel |
| `series`, `series_index` | From the book's own metadata or set by the reader; `""` means "not in a series". Part of the metadata group. Most books leave these `NULL` and the app works the series out (`src/library/series.ts`) |

`list_books()` excludes tombstoned rows; `list_books_for_sync()` includes them.

The two `*_updated_at` columns exist for the sync merge. `update_progress` only
stamps `progress_updated_at` when the value actually moved, which is what stops a
device that merely opened a book from winning the merge.

`BookRecord` also carries a computed, non-column field: `available`, a filesystem
check for whether the book's bytes are on *this* device.

### `reading_days` — the habit ledger

| Column | Notes |
| --- | --- |
| `date_key` TEXT PK | **Local** calendar day, `YYYY-MM-DD` |
| `minutes` REAL | Credited by the reading heartbeat |
| `goal_minutes` INTEGER | Snapshotted per day, so changing the goal does not rewrite history |
| `freeze_used`, `grace_used` | Whether a missed day was paid for |

The streak is **derived** from these rows rather than stored, so it can never
drift from the minutes that earned it. Pip's cold is derived from them too
(`habit::cold`): no column, no table. The per-device streak state in
`settings` carries `brokeOn`, the day the last break was found, so grace
refilled by a break is not spent on the gap that caused it.

### `focus_sessions` — the shelf

`id`, `started_at`, `ended_at`, `date_key`, `minutes`, `book_id`, `title`,
`notes`, `ended_reason` (`completed` | `manual_end`), `clean`, `style_seed`,
`burned_at`, `flower`, `flower_bloomed`.

Reading outside a focus session has no row here. It is not stored at all:
`habit::free_reads` derives it from `reading_days` and this table (a day's
ledger minutes less its sessions'; a session takes from its end day, then its
start day) and the habit snapshot carries it as `freeReads`.

`style_seed` replaces a persisted decoration blob — the shelf's appearance is
derived deterministically from the seed at render time. `burned_at` is a
tombstone from earlier versions, which burned the newest sessions when a
streak broke. Nothing writes it now; it is kept, synced and never cleared.

Pip's album has no table: each session's find is derived from its
`style_seed`, `minutes`, `ended_reason` and `clean` (`pip/expedition.ts`).

`flower` is the focus flower a session started in full screen grew (`tulip`,
`daisy`, `sunflower`, `rose`; NULL for other sessions) and `flower_bloomed`
whether it bloomed: the session completed without leaving. Both travel in the
sync document (left out for sessions without a flower), and a merge never
unblooms a flower. `minutes` is reading time only: the session clock counts
what the reading heartbeat counts (a book open, Leaflet in front, recent
input), never time since Start.

### `pip_purchases`, `pip_plantings`, `pip_harvests`, `pip_state` — Pip's shop and garden

`pip_purchases`: `id` (random), `item_kind`, `item_id`, `price` (as paid),
`bought_at`. `pip_plantings`: `id` (the seed packet's purchase id), `plot`,
`plant`, `planted_at`. `pip_harvests`: `id`, `planting_id`, `seeds`,
`harvested_at`. All append-only. Nothing about the garden's growth or the seed
balance is stored: `habit/seeds.rs` replays the reading (the ledger above)
against the plantings, and the balance is the welcome gift + valid harvests +
goal bonuses − purchases.

`pip_state`: one row (`id = 1`): `variant`, `accessories` (JSON list),
`room_layout` (JSON: `level/slot` to item, `level/@wallpaper`, `level/@floor`),
`room_style`, `mood`, `mood_updated_at`, `signature`, `updated_at`. See
[features.md](features.md#seeds-and-the-pip-tab).

### `collections`

The reader's own collections: `id`, `name`, `book_ids` (a JSON list, in the
order added), `created_at`, `updated_at`, `deleted_at` (tombstone). One record,
edited and synced whole. `book_collections` is an older, unused join table.

Series and smart shelves are **not** stored; they are worked out from `books`.

### `annotations`

Bookmarks and highlights: `id`, `book_id`, `kind` (`bookmark` or `highlight`),
`cfi` (a range for a highlight), `text`, `note`, `color`, `chapter`,
`created_at`, `updated_at`, `deleted_at` (tombstone).

Character sheets are rows here too, under six kinds of their own, so they are
in the backup and merge row by row with no rule of their own (and a build that
does not know the kinds carries them untouched): `person`, `person.alias`,
`person.note`, `person.member` (the group from a place on), `person.link`,
`person.group` (a group's colour; its id is `people-group:<book>:<name>`, so
two devices make one). In these rows `cfi` and `chapter` are the place the
entry was written at (`cfi` is empty for an entry with no exact place), `note`
holds the reader's words (the name, the note, the link's label, the group),
`color` a group's colour, and `text` a small JSON object: `p` (fraction of the
book, 0..1), `who` (the person it is about), for a link `to`, `type` (`child`,
`spouse`, `sibling`, `kin`, `serves`, `ward`, `friend`, `enemy`, `killedBy`,
`other`) and `end` (`{p, cfi, chapter}`, where it stopped being true), `main`
and `x` flags, `from` (the book it was carried from).
`readers/people/rows.ts` is the only code that knows this shape.

They are written only through `people_save` / `people_delete`
(`commands/people.rs`), which accept only those kinds, refuse an id that
belongs to a highlight or bookmark, require `text` to be a JSON object under
2,000 bytes (never clipped) with `p` in 0..1, clip `note` at 4,000 characters,
and write a batch all or nothing. Every reader of annotations filters by kind,
so highlights, bookmarks and their counts never see these rows. Removing a
book from the library leaves its sheet rows, as it leaves its highlights;
Delete All Data takes them.

Words looked up are rows here too, kind `word`. `id` is
`word:<language>:<the word, lower case>` (one row a word, on every device);
`note` the word; `cfi` and `chapter` the place it was last looked up at; `text`
a JSON object: `p` (fraction of the book), `m` (the meaning shown, 300
characters at most), `n` (times looked up), `at` (when last), `l` (language),
`pos` (part of speech, optional), and the quiz's `b` (box, 0 to 5) and `d` (day
next due, days since 1970). Written only through `word_record`,
`words_review` and `words_delete` (`commands/words.rs`): a word of 1 to 80
characters with a non-empty meaning, a book and `p` in 0..1; an id held by a
row of another kind is refused; the JSON is refused over 2,000 bytes, never
clipped; a review takes box 0..5 and a day 0..60,000 for words still kept, a
batch all or nothing; delete tombstones words only. `readers/words/rows.ts` is
the only app code that knows the shape. Sync is "newest row wins", so the same
word looked up on two devices while both are offline merges to one count, not
the sum.

`annotations_list` returns every kind for a book; its readers filter by kind
(`annotationService.list` itself returns only bookmarks and highlights).
`annotation_save` and `annotation_delete` act only on bookmarks and
highlights: an id held by a row of another kind is refused. Pip's diary reads
`highlight`, `person` and `word` rows (`diary_sources`) and stores nothing.

### `reading_sessions`

`UNIQUE(book_id, date_key)`, written as a side effect of `update_progress`.
Predates the habit ledger and carries no duration; the ledger is the real record.

### `settings`

A key/value table. Holds the habit goal and streak state (as JSON), the sync
folder path, the last sync time, the Drive access token and expiry, the Drive
account email, a Drive OAuth client if the reader supplied one, and the reading
pace profile (`reading_profile`, JSON; see the sync document below), and the
book copies folder (`library_copy_enabled`, `library_copy_folder`,
`library_copy_index`, `library_copy_problem`), which is this device's alone:
never in the sync document or the backup.

**Device-only keys in the webview's storage** added in 1.2, none synced, all
removed by Delete All Data (`services/deviceData.ts`): `leaflet.pip.lastStop`
(the last book closed, when, how far through its chapter, how long it was
open), `leaflet.pip.spines` (a cover's colour per finished book;
recomputable), `leaflet.pip.findSeen` (the session whose find Pip last
showed), `leaflet.pip.visits` (today's visitor log; also cleared at
sign-out), `leaflet.ambience` (the radio's `{ on, scene, volume, thunder }`),
`leaflet.reader.keepWords` ("0" = do not keep looked-up words),
`leaflet.desktopPip.enabled` and `leaflet.desktopPip.hiddenOn`,
`leaflet.contents.<book id>` (the chapter list made for an EPUB that came
without one; recomputable), `leaflet.pdfChapters.<book id>` (the same for a
PDF with no outline), `leaflet.reader.contentsSeen` (the chapter list has
shown itself once on this device) and `leaflet.reader.contentsOpen` (whether
the reader left it open). On the server,
`profiles.readDay` (the local date last read on) is held for public profiles
only. `Book.progressUpdatedAt` is now read by the front end.

The Drive **refresh** token is not here — it goes to the OS keychain, with this
table as the fallback where no keychain exists.

## Migrations

The schema is versioned with SQLite's `PRAGMA user_version`
(`SCHEMA_VERSION` in `db/mod.rs`, currently **6**). `apply_schema()` runs
`CREATE TABLE IF NOT EXISTS` for everything at the latest shape, then
`upgrade()` brings an older file forward one step at a time, in one
transaction:

| Version | Adds |
| --- | --- |
| 1 | `books.metadata_checked_at`, `metadata_updated_at`, `progress_updated_at`, `deleted_at`, `position` |
| 2 | `annotations` |
| 3 | `books.series`, `series_index`; `collections.book_ids`, `created_at`, `updated_at`, `deleted_at` |
| 4 | `focus_sessions.flower`, `flower_bloomed` |
| 5 | `books.finished_at`, filled for books already at their end from the day their progress last moved (which is what the app had been showing as the day they were finished) |
| 6 | Nothing added: `metadata_checked_at` is cleared for books with no cover, once, because a lookup that got no answer used to be stamped as made |

Columns are added only if missing (`add_column`), and only that case is
forgiven: a full disk or a locked file is an error. Before any upgrade the file
is copied to `library.db.bak-v<old version>` with `VACUUM INTO`. There is no
down-migration. To change the schema: bump the version, add a step, and put the
new shape in the `CREATE TABLE`s too; never edit a step that has shipped.

Rows written before the stamp columns existed have `NULL` in them; the sync
converter falls back to `created_at`, so an un-stamped record loses to any real
edit rather than winning by accident.

## The sync document

Defined in `sync/merge.rs`. This is what crosses between devices — as
`state.json` in a sync folder, or as a file in the Drive `Leaflet/` folder.

```jsonc
{
  "version": 1,
  "updatedAt": "2026-09-04T12:00:00+00:00",
  "books": [
    {
      "id": "<sha256>",
      "ext": "epub",              // the receiver names its copy <id>.<ext>
      "title": "…",
      "author": "…",
      "genres": [],
      "series": "The Expanse",    // optional, with "seriesIndex"; "" = none
      "metadataUpdatedAt": "…",   // title/author/genres/series move as one group
      "progress": 0.42,
      "position": "epubcfi(…)",   // optional; travels with progress
      "progressUpdatedAt": "…",   // distinct from lastOpened, on purpose
      "finishedAt": "…",          // optional: when it was finished; "" = "not started"
      "lastOpened": "…",
      "createdAt": "…",
      "deletedAt": null           // tombstone
    }
  ],
  "days":     [ /* the habit ledger */ ],
  "sessions": [ /* the shelf */ ],
  "purchases": [ /* Pip's shop: what was bought */ ],
  "plantings": [ /* Pip's garden: what was planted where */ ],
  "harvests": [ /* ...and what was picked */ ],
  "pip":      { /* Pip's look, room and mood */ },
  "annotations": [ /* bookmarks, highlights and character sheets, with tombstones */ ],
  "collections": [ /* the reader's collections, with tombstones */ ],
  "readingProfile": {           // optional: left out until there is one
    "version": 2,
    "core":   { "updatedAt": "…", /* reader-wide: starting pace, time of day */ },
    "limits": { "updatedAt": "…", "minWpm": 90, "maxWpm": 700 },  // Dotty's range
    "books":  { "<sha256>": { "updatedAt": "…", "wpm": 240, "minutes": 12, "difficulty": 1.04 } },
    "resetAt": "…"              // optional: "forget my pace"
  }
}
```

What is inside each part of `readingProfile` belongs to the app
(`readers/paceModel.ts`); Rust carries the fields as they are, so a device on an
older build passes on what it does not know rather than dropping it.

Book files live beside it as `books/<sha256>.<ext>` and are fetched on demand.

### Merge rules

- **Metadata** — newest `metadataUpdatedAt` wins, as a group (title, author,
  genres, series). On an exact tie a known series beats none: a series read from
  the file is filled in without a new stamp, as every device reads the same
  file to the same answer.
- **Progress** — newest `progressUpdatedAt` wins. A tie keeps the further
  position; never lose a reader's place. `position` (the CFI) is taken from the
  same winner, even when it has none, so a percentage is never paired with
  another device's place. Documents without the field parse as `null`.
- **Finished date** — the later of the two stands (a book read twice was last
  finished the second time). A side that says nothing never takes the other's
  away, which is what a device on a version before 1.3 does: it drops the field
  and its newer progress still wins without losing the date. A side that says
  "not started" (`""`) does take it away, unless the other finished the book
  after that side's progress last moved (the nearest thing there is to when it
  was said).
- **`lastOpened`** — the maximum; it is not a contested value.
- **`createdAt`** — the minimum; the earliest import is the truth.
- **Deletion** — holds unless the other device edited the book *after* it, which
  is how re-importing a removed book brings it back instead of being undone.
  A tombstone leaves the document after ninety days, except one with a
  finished date: that entry is the record that the book was read, and stays.
- **Ledger minutes** — the maximum, not the sum. Neither device knows how much of
  the other's time overlapped its own, and a sum would let repeated syncing
  inflate a streak.
- **Freeze / grace** — OR'd. Spending it on one device spends it everywhere.
- **Sessions** — union by id; a burn (written only by older versions) is a
  tombstone and sticks.
- **Purchases, plantings, harvests** — unions by id; they never change once made.
- **Pip's state** — newest `updatedAt` wins, whole; a tie is settled by content.
- **Annotations, collections** — per id, newest `updatedAt` wins, whole; a delete
  is an edit (a tombstone), dropped after the tombstone retention period.
- **Reading profile** — part by part: `limits` (apart, so a range set by hand
  is never lost to learning that happened later on another device) and each
  book's entry on its own, newest `updatedAt` wins; the reader-wide `core` by
  evidence: its starting pace from the newer copy, each time of day's pace from
  the copy with more minutes behind it, and the larger count of stops, so two
  devices that both learned keep both. A reset (`resetAt`) drops book entries
  older than it on every device; past 400 books the least recently read leave.
  `sync/reading.rs` (`merge_core`), mirrored by `mergeProfiles`.

Exact timestamp ties fall back to comparing the values themselves, so the result
cannot depend on argument order. Output is ordered by a `BTreeMap`, so two
devices produce byte-identical documents from the same inputs.

All timestamps are compared as **instants**, never as strings: `+05:30` sorts
after `+00:00` as text while being the earlier moment.
