# Tech stack

Every dependency, and why it earns its place. Versions are the ones pinned in
`apps/package.json` and `apps/src-tauri/Cargo.toml`.

## Shell

| | |
| --- | --- |
| **Tauri** 2.5 | Desktop + mobile shell. Chosen over Electron because it uses the platform's own webview instead of bundling Chromium — a release Android APK is 16 MB, and the desktop app does not ship a browser. |
| **Rust** (edition 2021) | Everything touching files, the database, and the network. |

### Tauri plugins

- **`tauri-plugin-dialog`** — the file picker, on both desktop and mobile.
- **`tauri-plugin-opener`** — opens the OAuth consent page in the *system*
  browser. Not optional: Google refuses to run its sign-in inside an embedded
  webview, so `window.open` from the frontend could never work.
- **`tauri-plugin-single-instance`** — focuses a running window when a second
  launch arrives with a file. Desktop only, and gated out of mobile builds in
  `Cargo.toml`; it has no mobile implementation.

## Frontend

| | |
| --- | --- |
| **React** 18.3 | UI. |
| **zustand** 4.5 | State. Small enough to read in one sitting, and `useShallow` gives components a scoped subscription so a library update does not re-render the reader. |
| **Tailwind** 3.4 | Styling, over a design-token layer in `index.css`. |
| **Vite** 5 | Build and dev server (port 1421). |
| **TypeScript** 5.5 | Strict throughout, including the shared `packages/shared` types. |

### Rendering books

- **`epubjs`** 0.3 — EPUB rendering, in scrolled-doc flow. It renders into an
  iframe, which is why anything that needs page events (Smart Read word
  tracking, the toolbar reveal) binds listeners into `rendition.getContents()`
  documents rather than the parent window.
- **`pdfjs-dist`** 4.10 — PDF rendering, and the same page reader draws CBZ
  comics from images the backend serves one at a time.
- **`lucide-react`** — the UI icon set.
- **Material Symbols** — the reader toolbar's icons, **self-hosted** and subset
  to the 14 glyphs actually used (2.8 KB, down from a 2.2 MB variable font). It
  used to come from Google Fonts through an `@import` placed after other rules,
  which is invalid CSS: the bundler dropped it and every icon rendered as its own
  ligature name.

### Fonts

**ZT Nature** (5 weights) and the Material Symbols subset are both in
`apps/src/assets/fonts/`. Nothing is fetched at runtime — an offline-first reader
should not need a CDN to draw its own toolbar.

## Backend

| Crate | For |
| --- | --- |
| **`rusqlite`** (bundled) | The library database. `bundled` compiles SQLite itself, so there is no system dependency on any platform. |
| **`tokio`** | Async runtime for the network and long file work. |
| **`reqwest`** (rustls) | HTTP: metadata lookups, cover downloads, Google Drive. `rustls` rather than native TLS to avoid an OpenSSL dependency on Android. |
| **`serde` / `serde_json`** | Everything crossing IPC or written as JSON. |
| **`sha2`** + **`hex`** | Book identity. Hashing is streamed, so a 500 MB book does not land in memory. |
| **`zip`** | Reading EPUB and CBZ containers, and writing converted EPUBs. |
| **`quick-xml`** | EPUB metadata (OPF) and FB2 parsing. |
| **`chrono`** | Timestamps. All comparisons parse to an instant rather than comparing RFC 3339 strings, which would order `+05:30` wrongly against `+00:00`. |
| **`oauth2`** | The Google Drive flow, with PKCE. |
| **`keyring`** | The Drive refresh token, in the OS credential store rather than a plaintext database column. Falls back to the database where no keychain exists. |
| **`image`** (png only) | The desktop window icon. Feature-limited to PNG so it does not pull in every decoder. |
| **`dirs`** | The desktop data directory. Not used on Android — see [architecture.md](architecture.md#the-app-data-directory). |
| **`anyhow`** | Error plumbing inside Rust; commands convert to `Result<_, String>` at the boundary. |
| **`regex`**, **`urlencoding`**, **`base64`**, **`dotenvy`** | Small utilities. `dotenvy` loads a `.env` in development only. |

## Build profile

```toml
[profile.release]
strip = "symbols"
lto = true
codegen-units = 1
```

Cargo has no per-platform profiles, so these apply to the desktop release too —
which is why every setting is one that costs nothing behaviourally. Two were
tried and deliberately dropped:

- **`opt-level = "s"`** would slow hashing and conversion on desktop to save a
  little size on mobile.
- **`panic = "abort"`** is sharper: the import path turns a panicking
  `spawn_blocking` task into a *"Import task failed"* message rather than taking
  the app down, and Leaflet parses arbitrary user files, which is exactly where a
  panic comes from.

`strip` alone takes the Android library from 199.7 MB to 13.6 MB.

## Deliberately absent

- **No CSS-in-JS, no component library.** Tailwind plus a token layer.
- **No animation library.** Every animation is CSS keyframes or a transition;
  `prefers-reduced-motion` is honoured by a blanket reset in `index.css`.
- **No JS test framework.** See [testing.md](testing.md) — this is a real gap,
  not a choice to be proud of.
- **No server, no analytics, no telemetry.**
