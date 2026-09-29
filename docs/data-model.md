# Data model

## SQLite

One file, `<app data>/library.db`, opened through `rusqlite` with a bundled
SQLite so there is no system dependency on any platform.

### `books`

| Column | Notes |
| --- | --- |
| `id` TEXT PK | SHA-256 of the file contents |
| `title`, `author`, `genres` | `genres` is a JSON array |
| `cover_url` | **Local** path to the cached cover. Never synced. |
| `local_path` | **Local** absolute path. Never synced. |
| `file_hash` | Same as `id`; kept for the index |
| `progress` REAL | 0–1 |
| `position` TEXT | Exact place (EPUB CFI); `NULL` for page-based books. Written with `progress` |
| `last_opened`, `created_at` | RFC 3339 |
| `metadata_checked_at` | Drives the 14-day enrichment cooldown |
| `metadata_updated_at` | When title/author/genres last changed |
| `progress_updated_at` | When `progress` last changed — *not* when opened |
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
drift from the minutes that earned it.

### `focus_sessions` — the shelf

`id`, `started_at`, `ended_at`, `date_key`, `minutes`, `book_id`, `title`,
`notes`, `ended_reason` (`completed` | `manual_end`), `clean`, `style_seed`,
`burned_at`.

`style_seed` replaces a persisted decoration blob — the shelf's appearance is
derived deterministically from the seed at render time. `burned_at` tombstones a
session when a streak breaks, rather than deleting it.

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

### `reading_sessions`

`UNIQUE(book_id, date_key)`, written as a side effect of `update_progress`.
Predates the habit ledger and carries no duration; the ledger is the real record.

### `settings`

A key/value table. Holds the habit goal and streak state (as JSON), the sync
folder path, the last sync time, the Drive access token and expiry, the Drive
account email, a Drive OAuth client if the reader supplied one, and the reading
pace profile (`reading_profile`, JSON; see the sync document below).

The Drive **refresh** token is not here — it goes to the OS keychain, with this
table as the fallback where no keychain exists.

## Migrations

The schema is versioned with SQLite's `PRAGMA user_version`
(`SCHEMA_VERSION` in `db/mod.rs`, currently **3**). `apply_schema()` runs
`CREATE TABLE IF NOT EXISTS` for everything at the latest shape, then
`upgrade()` brings an older file forward one step at a time, in one
transaction:

| Version | Adds |
| --- | --- |
| 1 | `books.metadata_checked_at`, `metadata_updated_at`, `progress_updated_at`, `deleted_at`, `position` |
| 2 | `annotations` |
| 3 | `books.series`, `series_index`; `collections.book_ids`, `created_at`, `updated_at`, `deleted_at` |

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
  "annotations": [ /* bookmarks and highlights, with tombstones */ ],
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
- **`lastOpened`** — the maximum; it is not a contested value.
- **`createdAt`** — the minimum; the earliest import is the truth.
- **Deletion** — holds unless the other device edited the book *after* it, which
  is how re-importing a removed book brings it back instead of being undone.
- **Ledger minutes** — the maximum, not the sum. Neither device knows how much of
  the other's time overlapped its own, and a sum would let repeated syncing
  inflate a streak.
- **Freeze / grace** — OR'd. Spending it on one device spends it everywhere.
- **Sessions** — union by id; a burn is a tombstone and sticks.
- **Purchases, plantings, harvests** — unions by id; they never change once made.
- **Pip's state** — newest `updatedAt` wins, whole; a tie is settled by content.
- **Annotations, collections** — per id, newest `updatedAt` wins, whole; a delete
  is an edit (a tombstone), dropped after the tombstone retention period.
- **Reading profile** — part by part, newest `updatedAt` wins: the reader-wide
  `core`, `limits` (apart, so a range set by hand is never lost to learning
  that happened later on another device) and each book's entry on its own. A
  reset (`resetAt`) drops book entries older than it on every device; past 400
  books the least recently read leave. `sync/reading.rs`.

Exact timestamp ties fall back to comparing the values themselves, so the result
cannot depend on argument order. Output is ordered by a `BTreeMap`, so two
devices produce byte-identical documents from the same inputs.

All timestamps are compared as **instants**, never as strings: `+05:30` sorts
after `+00:00` as text while being the earlier moment.
