# Architecture

## The two halves

Leaflet is a [Tauri v2](https://tauri.app) app: a Rust binary that owns the data
and the filesystem, and a React app rendered in the platform's native webview
(WebView2 on Windows, WebKit on macOS, Android System WebView on Android).

They talk over Tauri's IPC. The frontend calls `invoke("command_name", args)`;
the backend answers with a serialised struct. Argument names cross the boundary
**camelCase on the JS side, snake_case in Rust** — `invoke("set_habit_goal", { minutes })`
maps to `fn set_habit_goal(minutes: i64)`.

```
┌──────────────────────── webview ────────────────────────┐
│  React 18 + zustand + Tailwind                          │
│                                                         │
│  pages/        screen-level components                  │
│  components/   shared UI                                │
│  store/        zustand stores (the app's live state)     │
│  services/     thin `invoke` wrappers, one per domain    │
│  platform/     desktop vs mobile implementations         │
└───────────────────────────┬─────────────────────────────┘
                            │  Tauri IPC
┌───────────────────────────┴─────────────────────────────┐
│  Rust                                                   │
│                                                         │
│  commands/     every #[tauri::command]; lock & delegate  │
│  db/           SQLite (rusqlite, bundled)                │
│  storage/      files on disk, hashing, conversion        │
│  sync/         merge rules + two transports              │
│  habit/        the streak engine (pure)                  │
│  convert/      built-in format converters                │
│  metadata/     Open Library / Wikipedia enrichment       │
│  comic/        CBZ page indexing                         │
│  formats/      the one table of supported formats        │
└─────────────────────────────────────────────────────────┘
```

## Why the crate is a library

`src/lib.rs` holds the whole app; `src/main.rs` is three lines that call
`leaflet_lib::run()`.

That is not stylistic. Android and iOS never start a Rust binary — the platform
starts its own host activity, which loads the crate as a `cdylib` and calls the
entry point marked `#[cfg_attr(mobile, tauri::mobile_entry_point)]`. Producing a
library is what makes a mobile build possible at all; the desktop binary links
the same `rlib`, so both platforms run identical setup.

```toml
[lib]
name = "leaflet_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
```

## Platform differences

Kept deliberately small, and expressed in three places only:

**`#[cfg(desktop)]` in Rust.** Single-instance handling, the window icon, and the
entire Calibre converter. The converter is *compiled out* of mobile builds rather
than shipped as unreachable code — verified by checking the release binary for
`ebook-convert` and friends, which are absent.

**`platform/` in TypeScript.** `getPlatform()` reads the user agent and lazily
imports `platform/desktop/*` or `platform/mobile/*`. Only file picking,
permissions and storage roots differ.

**Responsive CSS.** One layout, not two. See [features.md](features.md#responsive-layout).

## Where state lives

There are three tiers, and the distinction matters:

| Tier | Holds | Survives |
| --- | --- | --- |
| **SQLite** | Library, reading positions, habit ledger, session shelf, settings | Everything. This is the source of truth. |
| **zustand** | The live view of the above, plus transient UI state | The session |
| **localStorage** | Pure preferences: theme, focus-mode toggles, the running timer, first-run flag | Until site data is cleared |

The rule: **anything a reader would be upset to lose goes in SQLite.** The habit
ledger and session shelf were once in `localStorage` and could be destroyed by
clearing site data; they were moved for exactly that reason.

zustand stores are the only thing components subscribe to. They call services,
which call `invoke`. Components never call `invoke` directly.

### The stores

- **`libraryStore`** — books, filters, sync status, reading stats. Owns the
  debounced background sync.
- **`habitStore`** — a reactive view over the Rust habit engine. Keeps only the
  focus-mode preferences and the running timer locally.
- **`appearanceStore`** — theme, and whether the user has overridden the system
  setting.

## The app data directory

Every path derives from one function, `storage::app_data_dir()`:

```
<app data>/
  library.db          SQLite
  books/<sha256>.<ext>  the book files
  covers/<sha256>-cover.jpg
  converters/         desktop only: a portable Calibre, if downloaded
```

On desktop that root comes from `dirs::data_dir()`. On Android `dirs` resolves
through XDG rules to a path the app cannot write, so the host supplies it
instead: `setup()` calls `app.path().app_data_dir()` and installs it via
`storage::set_app_data_dir()` **before anything opens the database**. That is why
`AppState` is managed inside `setup()` rather than on the builder.

## Book identity

A book's id is the **SHA-256 of its file contents**, and stored files are named
`<sha256>.<ext>`. This one decision buys a lot:

- The same book has the same id on every device, so sync needs no server to
  assign identity. (Leaflet's server exists only for optional accounts and
  leaderboards, and never sees book files; see `server/README.md`.)
- Re-importing a file is idempotent.
- A cover, a converted EPUB and a comic page index can all be cached by hash.
