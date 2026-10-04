# Handoff — 2026-10-04

A snapshot for the next session, not permanent documentation. Delete it once
acted on. The durable reference is [docs/README.md](README.md); how to release
is in [deploy.md](deploy.md) (the checklist) and
[release-msix.md](release-msix.md) (the details).

## Read this first

**The version is 1.2.0, nothing from these sessions is committed, and no 1.2.0
package has been built.** The owner tested 1.1.0 and sent a long list of bugs
and wishes over two days; all of the work below is in the working tree on
`release/1.1`, on top of its two unpushed commits. The packages in
`target\msix` are 1.1.0 and older.

| Branch | State |
| --- | --- |
| `main` | Pushed to GitHub at `399f6c4` |
| `release/1.1` | Two commits on `main`, **not pushed**: `8eb6a1e` version 1.1.0, `51b0341` release docs without a fixed version |
| Working tree | Everything below, uncommitted: about 366 changed or new paths (some 190 of them regenerated icons and logo files) |

Suggested next step: the owner looks at it (list below), then commit in themed
commits on a `release/1.2` branch, build the package, redeploy the server.

## Current state (all run together at the end, 2026-10-04)

| | |
| --- | --- |
| `npx tsc --noEmit -p .` in `apps/` | clean |
| App tests (`npx vitest run` in `apps/`) | 84 files, 906 passing |
| Rust tests (`cargo test --lib`) | 447 passing, 1 ignored |
| `LEAFLET_STORE_BUILD=1 cargo check` | clean |
| Server tests (`npm test` in `server/`) | 75 passing |
| `npm run build` | succeeds |
| `node scripts/pip-catalogue.mjs --check` | up to date |
| Release build, MSIX | **not built.** The build was attempted from the assistant's session and refused by its permission rules; the owner runs it (commands below) |
| Seen on screen | **Nothing.** The browser pane was hidden throughout, so no screenshot was possible. The readers, Pip's house and the character tracker were checked by measuring in the preview (positions, pixels, timings); the rest by tests |

To build the package (the Store one needs the Google client; see
[deploy.md](deploy.md)):

```powershell
$env:LEAFLET_GOOGLE_CLIENT_ID     = "…apps.googleusercontent.com"
$env:LEAFLET_GOOGLE_CLIENT_SECRET = "GOCSPX-…"
$env:VITE_ENABLE_ACCOUNTS         = "true"
$env:VITE_ENABLE_COMMUNITY        = "true"
$env:LEAFLET_API_BASE             = "https://leafletapp.duckdns.org"
cd D:\Leaflet\apps\src-tauri\msix
.\build-msix.ps1
```

## What changed since 1.1.0

Details for every item are in [features.md](features.md); this is the map.

**Text reader** (`pages/ReaderView.tsx`, now about 6,800 lines, with its parts
in `src/readers/`):

- Scrolling is one continuous book (epub.js `continuous` manager): no more
  jumping to the next chapter before its end is read. The chapter list and
  arrows jump within the one scroll.
- Green paragraphs on dark pages fixed (unclosed page-break anchors).
- Smart Read "on but not moving" fixed: the selection bar sat under its
  controls and a stale selection held it. Controls say "On hold" and why.
- Pages layout: the last page of a chapter was skipped on scaled displays and
  a held arrow key turned two; pages are counted, turns slide, a held key
  turns one page every 150 ms.
- Dotty is 7 px, flat and glides. The chapter list has an edge tab.
- New: type panel (faces, spacing, alignment), the book's own drop caps kept,
  time left in the chapter and book, Back / Forward after a jump (Alt+Left /
  Alt+Right), footnotes in a popup, pictures open large, a progress bar to go
  anywhere, a `?` shortcuts sheet, B to bookmark, Escape closing one thing at
  a time, front matter no longer resetting progress, the saved place no longer
  creeping back on reopen, long titles set smaller in the toolbar.
- **Look up** a selected word or phrase (Wiktionary and Wikipedia through
  Rust, `src-tauri/src/lookup/`), and "Search in this book" from a selection.
- **Characters** (`readers/people/`, off by default, Settings > Reading):
  who-is cards that show only what was learned up to the place being read,
  underlined names, a panel with suggestions and a relations drawing, export,
  import, carry-over within a series. Stored as new kinds of `annotations`
  rows ([data-model.md](data-model.md#annotations)).
- **SpeedRead**: the word sits across the middle instead of off to the right,
  long words are fitted, a name being introduced and new words are held
  longer, figures are kept whole, and it eases in after Play.

**Page reader** (`pages/PageReaderView.tsx`): dark and paper finishes reach the
PDF page; outline, go to page, search, text selection, drop caps mended, zoom,
bookmarks, comics right to left and two-up; **continuous scrolling** for PDFs
(the default for a PDF opened for the first time); a `?` shortcuts sheet.

**Highlights outside the reader** (`components/highlights/`).

**Habit**: free reading shows on the shelf (`habit::free_reads`); any reading
counts for Pip's mood and the mood's drift stops at 40; the sync merge keeps
the hardest goal a day was met against; lowering the goal applies today.

**Pip tab**: activities instead of clips, physics when carried and tossed, a
Play rail, a mood panel that says why, the garden as rows with a sky, the
Attic Arcade open to visit, room pieces that can be used (curtains, pictures,
bed, lights, books), a mini fridge, and night habits (midnight snack, phone in
bed, snooze). All of the night habits are for show: no seeds, no mood.

**Community and accounts**: your own row always shows on the board; a new
account's profile is public by default and can be set private; handles are
shown with `@`. **Settings** is tabbed and compact; the server address is
under Advanced; "Get Calibre"; an optional **Book copies** folder.

**Logo**: Pip sitting with an open book, transparent, no tile
(`apps/scripts/pip-logo.mjs`, `src-tauri/msix/windows-icons.py`). Windows
icons and Store logos regenerated; macOS, iOS and Android icons still show the
old logo.

## Waiting on the owner

1. **Look at it.** In order of risk:
   - Text reader: scroll across several chapter ends both ways by wheel,
     scrollbar, auto-scroll and Smart Read; change the type near a chapter's
     end; reopen and check the line. Pages at 125% scaling: every page shows.
   - SpeedRead: does the word feel centred, are name holds and the run-in
     right. `RSVP_ANCHOR_EM` in `readers/rsvpWord.ts`, the holds in
     `readers/rsvpHold.ts`.
   - Characters (turn it on): the dotted underline on each page finish, the
     card and panel, the relations drawing, whether 220 ms before a click
     opens a card feels prompt.
   - PDF Scroll: real wheel and trackpad smoothness, a mouse drag selecting
     across two pages, zoom past 200% (drawn a little softer than in Pages).
   - Pip: tossing her about, the fridge's size and sounds (never heard), the
     night habits' pacing, whether the phone's glow is too bright
     (one number in `pip/house.js`).
   - Footnote popup, picture viewer, progress bar (it is invisible until the
     dock wakes), the type panel's faces, the logo at small sizes.
   - Settings in both themes at 1366×768; the leaderboard's own row.
2. **Build the package** (above) and test it installed: section sizes from
   Rust, the look-up through the release CSP, the character sheet's save
   dialog, Book copies on MSIX.
3. **Redeploy the server**: `server/src/routes/community.js`, `social.js`,
   `account.js`, `boardCache.js`, `http.js` changed (own row, public by
   default, handles). No schema, index, env or secret change. Publish the
   updated `docs/legal/privacy-policy.md` and `terms-of-use.md` with it.
   Optional one-off, to clear what private profiles had published before:
   `db.profiles.updateMany({visibility:{$ne:"public"}},{$set:{weekKey:null,weekMinutes:0,streak:0,booksFinished:0,shelf:[]}})`
4. **Decide:**
   - Read aloud (text to speech) for the text reader: not built.
   - Two pages side by side in the EPUB pages layout: not built.
   - Should a character card or panel hold the page-turn keys while open
     (today they still turn the page, as under the notes panel).
   - Free reading earns the goal and streak but waters no garden (focus
     sessions only). Say if it should also water.
   - More room interactions (a book off the shelf, the rug, a toy, a watering
     can), and whether the Arcade's games are priced or visit-only.
5. From before: upload from a network that is not college Wi-Fi, Google
   consent screen in production, Partner Center listing, back up
   `C:\Users\Adi\.leaflet\config-signing-key.pem`, delete the stale packages
   in `target\msix`, 1.2 release notes and store listing text.

## Not verified

- Everything visual, every sound, every real pointer gesture.
- Anything inside the Tauri app as opposed to the browser preview: the Rust
  commands are tested, but the new ones (`lookup_term`, `people_*`,
  `library_copy`) were not driven from the packaged app.
- Real scroll events with real scroll anchoring in the continuous reader (the
  preview sent them by hand).
- Sync of a character sheet between two devices (the merge is tested in Rust).
- The Rust publish path for a shared profile against the real server.
- Reading-time credit while scrolling a PDF (checked by reading the code).
- Comics in the shortcuts sheet (table tests only). An Android build.

## Known gaps

- **The API is on DuckDNS**, which schools and offices block.
- **Free reads have no book title or start time**, and the public shelf lists
  focus sessions only.
- **A page read for more than 90 seconds without input stops counting**
  (`IDLE_MS`).
- **Characters**: underlined names cannot be reached by keyboard in the text
  (the selection bar and the panel can); name suggestions lean on English
  verbs; removing a book leaves its sheet rows, as it leaves its highlights.
- **SpeedRead's "first time"** is first in the chapters on the page, not in
  the whole book, so a name is held again briefly in a later chapter.
- **PDF Scroll** offers no two-page spread; the toolbar does not come back on
  scroll up in any reader (`hooks/useAutoHideChrome.ts`, by design so far).
- **Late-loading pictures in a chapter above the viewport** can move the text.
- From before: test signing signs the upload file; the Calibre installer is
  dormant, not absent, in the Store exe; `store-listing.md` and
  `release-notes-1.0.md` still say 1.0; the release-only CSP is not applied by
  `tauri dev`.

## Test aids left on disk

`apps/node_modules/.leaflet-test/` (inside `node_modules`, so git-ignored)
holds the harnesses and fixtures the measurements used, described in
[testing.md](testing.md). It includes copies of two of the owner's own files
(`mistborn.epub`, `test.pdf`). Delete the folder whenever; nothing builds
from it. Development builds publish `window.__leafletRendition` and
`window.__leafletReader`, both behind `import.meta.env.DEV`.
