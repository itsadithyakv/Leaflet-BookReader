# Handoff — 2026-09-27

A snapshot for the next session, not permanent documentation. Delete it once
acted on. The durable reference is [docs/README.md](README.md); what ships and
why is in [product.md](product.md); how to release is in
[release-msix.md](release-msix.md).

## Read this first

**Nothing is committed.** The working tree carries two sessions of work on top of
`4bcca5e`. Everything builds and the test suites pass, so it is a safe point to
commit, but split it. Suggested commits:

1. Habit/focus engine, sync rebuild, mobile groundwork (the previous session's work)
2. Launch framing: backup instead of sync, feature flags, light theme by default, mobile banner
3. Bug fixes from the review (sync lock, re-import after delete, safe synced names, reader keys, kiosk permission)
4. Pip: engine, moves, skins, world, home in the logo, tour, wrap-up, reader peek, app icon and logo assets
5. Session bookshelf rebuild
6. Smart Read / RSVP fixes and the idle pause
7. Accounts and server hardening
8. Community: boards, follows, kudos, duels, inbox
9. Release: signed remote config, website (`site/`), Pages workflow, MSIX packaging, Store-build Calibre switch
10. Docs and legal pages
11. Avatars: the picker, `pip/avatars.ts`, `server/src/avatars.js`, avatar on every community payload
12. Focus lock and the session clock: `ConfirmDialog`, `windowService`, `useFocusLockExit`, away time, Pip's `swat`
13. Reader: auto-scroll controls and learning, the RSVP stage
14. Production pass: CSP, app guards, ErrorBoundary, lazy tabs, server headers, board cache, systemd priority
15. Reader opening/display fixes (progress, restore, TOC paths, links, focus, raw-byte IPC, synced position)
16. Pip life: swing, webs, dizziness, perch, time-of-day moments, sleep transitions
17. Pip book scenes (`pip/books/*`, `pip/bookNods.ts`, 60 books, 51 scenes)
18. Pip's house: variants, wardrobe, floors, 171 items (101 book nods), garden economy, shop, arcade
19. Reminders (Windows toasts), rating prompt, Social tabs, accessibility fixes

## Current state

| | |
| --- | --- |
| Server tests (`npm test` in `server/`) | 43 passing |
| Rust tests (`cargo test --lib --offline`) | 234 passing |
| `tsc --noEmit` | clean |
| `vite build` | clean (main chunk ~450 KB; book scenes load after start-up) |
| Release build | clean, 0 warnings (`LEAFLET_STORE_BUILD=1 VITE_ENABLE_ACCOUNTS=true VITE_ENABLE_COMMUNITY=true npm run tauri build -- --no-bundle`) |
| MSIX | packs and validates (`build-msix.ps1 -SkipBuild -Configuration release`), ~10.6 MB |
| End-to-end (release exe over DevTools, against a local API + Mongo) | 56 / 56 checks pass: library, EPUB/PDF/CBZ reading, TOC, links, RSVP, auto-scroll, accounts, community, Pip house and shop, reminders, settings |
| API load test | 3,000 leaderboard requests, 25 at a time: ~4,000 req/s, p95 12 ms, ~76 MB RSS |
| Website | builds (`node site/build.mjs`) |

## Waiting on the owner

These need the owner's accounts or credentials; the commands are in
[release-msix.md](release-msix.md).

1. **GitHub Pages:** Settings → Pages → Source: GitHub Actions, then push.
2. **MongoDB Atlas:** allow `129.154.40.208`, and create a database user.
3. **Oracle VM:** Node 22, the env file with `MONGO_URI`, the Caddy block for
   `leafletapp.duckdns.org`, then `server/deploy/deploy.ps1`.
4. **Google Cloud:** a Desktop OAuth client, consent screen in Production, home
   page and privacy URLs pointing at the Pages site.
5. **Release build** with the env vars, then upload the MSIX to Partner Center.
6. **Terms of use:** governing law set to India; confirm it's right.
7. **Display name:** confirm the reserved Store name matches "Leaflet Book
   Reader" in `apps/src-tauri/msix/AppxManifest.xml`.
8. **Back up** `C:\Users\Adi\.leaflet\config-signing-key.pem`.

## Not verified on screen

- The community UI (boards, reader cards, duels, inbox) was tested end to end
  against the API but not looked at in the running app, because the webview
  only reaches the server inside Tauri.
- The Pip tour, Pip living on cards while scrolling, and the Pip right-click
  menu were built after the last visual check.
- The Smart Read / RSVP fixes; the reviewer's hand-test list is in
  [features.md](features.md) under Smart Read.

## Known gaps

- **Release-only CSP.** `tauri.conf.json` now has a real Content-Security-Policy;
  dev (`tauri dev`) loads the dev server without it, so anything it blocks only
  shows in a release build. Smoke-test a release build before each submission.
- **Links inside books** (`http(s)` in an EPUB) do nothing: epub.js opens them
  as popups, which the sandboxed iframe blocks. Route them through
  `accountService.openLink` from the content hook.
- **Book bytes cross IPC as base64** and are decoded byte by byte; returning a
  raw `tauri::ipc::Response` would cut a third of the transfer on big books,
  and PDFs over ~400 MB cannot open at all this way.
- **TOC hrefs are used raw.** epub.js keeps nav/NCX hrefs relative to the nav
  file, but `spine` matches OPF-relative paths, so a book whose nav lives in a
  subfolder (Sigil layout: `OEBPS/Text/nav.xhtml`) has TOC entries that do
  nothing and no chapter-based progress. Resolve them against the nav path.
- **Reading position does not sync**, only the percentage. A second device now
  opens at the chapter the percentage points into and does not overwrite it
  until the reader moves, but it cannot land on the exact line.
- **Focus under the reader overlay** stays in the library (Tab walks the
  hidden page); make the app shell `inert` while a book is open.

- **No JavaScript tests.** `tsc` and a clean build are the only frontend gates.
- **Multi-device sync** has known issues that only bite with two devices writing
  at once (a progress save during a sync can be overwritten; the Drive
  `If-Match` check is probably ignored; a device that has not synced can burn the
  shelf). They are why the launch calls it backup. Fix before
  `VITE_ENABLE_MULTI_DEVICE`.
- **Android:** the keychain crate has no Android backend (the refresh token is
  silently lost), and Google's loopback sign-in is not allowed for Android
  clients. Both need solving before mobile.
- **Accounts:** no email verification and no password reset by email yet.
- **Duel results** settle lazily, on the first load after the week has ended
  everywhere, so a result can show up to about a day late.
- **Rate limits** are in memory: correct for the single API instance, not for
  more than one.
- **Skins** exist in the engine but are not unlockable in the app yet.

## Architectural commitments worth not breaking

1. **Merge rules live in one place.** `sync/merge.rs` is pure; the transports
   only move bytes.
2. **Book files never touch MongoDB** or the API server.
3. **Local dates for the habit ledger;** the client sends its local week key to
   the server.
4. **Private by default,** enforced server-side.
5. **No CDN at runtime.** Fonts are self-hosted.
6. **The server never sees Google credentials.**
7. **The API address is never baked in alone:** it comes from the signed config,
   so moving the server never needs a Store update.
8. **One Pip on screen.**
