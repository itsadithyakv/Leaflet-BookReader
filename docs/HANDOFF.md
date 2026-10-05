# Handoff — 2026-10-04

A snapshot for the next session, not permanent documentation. Delete it once
acted on. The durable reference is [docs/README.md](README.md); how to release
is in [deploy.md](deploy.md) (the checklist) and
[release-msix.md](release-msix.md) (the details).

## Read this first

**The version is 1.2.0. Everything is committed on `release/1.2` (not
pushed): the first two days' work, "Pip round two" below, and the reader bug
pass below it. No 1.2.0 package has been built.** The owner tested
1.1.0 and sent a long list of bugs and wishes, then asked for a set of new
Pip features. The packages in `target\msix` are 1.1.0 and older.

| Branch | State |
| --- | --- |
| `main` | Pushed to GitHub at `399f6c4` |
| `release/1.1` | Two commits on `main`, **not pushed**: `8eb6a1e` version 1.1.0, `51b0341` release docs without a fixed version |
| `release/1.2` | Nine commits on `release/1.1`, **not pushed**: version, logo, server, backend, Pip, readers, app, docs, handoff |
| Working tree | Clean, bar the untracked `.claude/` (the preview's launch file) |

The commits are split by folder, not by change, because the big files
(`ReaderView.tsx`, `lib.rs`, `index.css`) carry several themes each. Only the
tip was checked: a commit in the middle of the eight may not type-check alone.

Suggested next step: the owner looks at it (list below), builds the package,
redeploys the server, then fast-forwards `main` and pushes.

## Current state (all run together after the bug pass, 2026-10-05)

| | |
| --- | --- |
| `npx tsc --noEmit -p .` in `apps/` | clean |
| App tests (`npx vitest run` in `apps/`) | 117 files, 1779 passing |
| Rust tests (`cargo test --lib`) | 511 passing, 2 ignored |
| `LEAFLET_STORE_BUILD=1 cargo check` | clean |
| Server tests (`npm test` in `server/`) | 88 passing |
| `npm run build` | succeeds; it now emits two pages, `index.html` and `desktop-pip.html` |
| `node scripts/pip-catalogue.mjs --check` | up to date |
| Release build, MSIX | **not built.** The build was attempted from the assistant's session and refused by its permission rules; the owner runs it (commands below) |
| Seen on screen | **Nothing.** The browser pane was hidden throughout, so no screenshot was possible. The readers, Pip's house and the character tracker were checked by measuring in the preview (positions, pixels, timings); the rest by tests |
| Heard | **Nothing.** The radio's sounds were measured (level, peak, spectrum), never listened to |
| Desktop Pip's window | **Never opened.** Compiled, unit-tested, and its page driven against a stand-in |

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

## Pip round two

The owner asked "what other features can be added to Pip", then "build all of
them". Seven engineers built them at once; each is described in
[features.md](features.md) under the heading given.

| Feature | Where in features.md | State |
| --- | --- | --- |
| Genre moods, "you stopped *there*?", book hangover, dusting, the horror peek at night | "Pip knows your book" | Measured in the preview |
| Bookcase of finished books, the book in her hands, fridge notes | "Her bookcase, her book, the fridge door" | Measured; covers and highlights in the packaged app not exercised |
| Wall calendar, wall clock, houseplant (free reading waters it), radio in the room, album board, diary on the bookcase | same | Measured |
| Pip's diary and the weekly postcard | "Pip's diary" | Measured; the save dialog and Copy not exercised |
| Words looked up are kept; My words; Word Quiz; Who is this? | "Words looked up are kept", "The Attic Arcade" | Measured; the Tauri paths not run end to end |
| The radio: six synthesised scenes while reading | "The radio" | Controls measured; **never heard** |
| Expeditions and the album (44 finds, derived from focus sessions) | "Expeditions and the album" | Measured |
| Visitors (a friend's Pip: each follows the other) | "Visitors" | Server tests pass; the app has never called a server for it |
| The kinder streak: nothing burns, Pip catches a cold | "Focus mode, streaks and the shelf" | Rust tests pass; no real break exercised in the app |
| Pip on the desktop | "Pip on the desktop" | **Window never opened** |

All of it is for show (no seeds, no mood) except the streak change.

**Decisions, taken on the owner's instruction ("answer yourself"):**

1. **"A break is final" stays.** The old walk spent the grace a break
   refilled on the very gap that broke the streak, so a streak came back a
   minute after its end was announced; fixed. Streak numbers after a one-day
   miss with no grace in hand are honestly lower than older versions gave (the
   published streak, the board's tie-break, the streak bonus). To revert: the
   `broke_on` handling in `habit/mod.rs`; the cold then rarely lasts.
2. **Visitors are friends only: each must follow the other.** A follow one way
   tells nobody anything. One new published field, `readDay`. Server tests: 88.
3. **The fridge keeps its two targets** once a highlight is pinned: the lower
   door opens the notes, the freezer door (top third) the fridge; the keyboard
   and the Snack key open the fridge as before.
4. **The Diary and Album keys are off the Pip tab's rail.** Both open from
   their things in the Bedroom (the diary on the bookcase, weekly postcard
   included; the board under the window). `openPipDiary` and `AlbumDialog`
   remain for opening them from elsewhere and are unused today.
5. **Desktop Pip is not required and is out of a release unless the build asks
   for her** (`VITE_ENABLE_DESKTOP_PIP=true`, `FEATURES.desktopPip`): her
   window has never been opened on a real desktop. Without the flag the switch
   is not shown and Rust never makes the window. Leave the flag unset for the
   Store build until the checklist below has been run.

**A Mac build:** asked for, and not possible from this Windows machine. There
is now a manual workflow, `.github/workflows/macos.yml`, that builds an
unsigned universal `.dmg` on a GitHub Mac (deploy.md, 7b). It has never been
run, and the app has never been compiled for macOS.

**Server:** `server/src/routes/community.js`, `routes/social.js`,
`community.js`, `boardCache.js`, `rateLimit.js` gained `readDay` and
`GET /v1/visitors`. No migration, no index. The app is safe to ship first:
against today's server the route is a 404 and nothing is shown. The privacy
policy has the new lines and a 4 October entry; publish it with the redeploy.

**Desktop Pip: the owner's checklist**, most likely to be wrong first. Build
or run with `VITE_ENABLE_DESKTOP_PIP=true`, then switch on Settings > General >
Pip on the desktop.

1. She appears cleanly: no white, black or grey box, no border or shadow; 64
   px wide at 100%, not about 136; feet on the taskbar's top edge; no flash of
   an empty window or of the default Pip.
2. Focus: type in Notepad, then click, drag and right-click her; the caret
   stays in Notepad. She is not in Alt+Tab, Task View or the taskbar.
3. Nothing left behind: close Leaflet with her out (also mid-walk and
   mid-carry); no `leaflet.exe` and no orphaned `msedgewebview2.exe`. Then the
   switch, Send her home, Hide for today (back tomorrow), Delete All Data.
4. Carry and drop: she follows the pointer, a flick throws her, she lands on
   the taskbar, and never stays stuck to the pointer.
5. Clicks beside her reach what is underneath, taskbar icons included.
6. The walk: no flicker or tearing; she turns before the screen's end.
7. Menu and sign: the window grows upward with no flash; each item works.
8. Scaling 100 to 200%, and changing it while she is out.
9. Two monitors with different scaling; unplugging the one she is on.
10. Taskbar auto-hide, and top, left and right on Windows 10.
11. Full-screen apps (a game, a film, a slide show, Leaflet's focus lock):
    hidden during, back after.
12. The nudge: a reminder a few minutes ahead with the goal unmet; toast and
    sign together; click the sign; no second sign that day.
13. Her look follows the Pip tab's outfit.
14. Night (asleep after 23:00) and reduced motion (still, in the corner).
15. Task Manager: `leaflet.exe` near 0% standing; the extra
    `msedgewebview2.exe` renderer's memory (expected 40 to 80 MB, unmeasured).
16. The Store package: sideload and repeat 1 to 3 and 12.

**Also to look at and listen to:** the radio (above all whether the cafe's
voices sound like people; the five `talker` levels in `ambience/scenes.ts`
are the knob); the bedroom at the common scales (eight small things: 1 px
calendar squares, a 13 px clock, 2 px spines); the 44 expedition sprites (the
thimble is the weakest); the new moves (quilt-hide, underbed, trail, march,
hangover, bring, show, the cold's blanket); the visitor beside Pip; the quiz;
the postcard at thumbnail size.

## After round two: books, small fixes, and the reader bug pass

- **The books Pip knows**: 59 became 549 books and series (336 entries, 71
  scenes), with a fallback by genre for a book she has never heard of
  (features.md, "Book nods"). Sherlock Holmes had an entry all along but its
  author had to be written exactly "Arthur Conan Doyle"; and a nod plays only
  on first open and then one open in four (`NOD_ODDS`).
- **The tour's Next and Skip did nothing** and the click went to whatever was
  under the bubble: a later CSS rule switched off the pointer on Pip's
  bubble. Fixed (`.pip-say-world.pip-say-interactive`), which also fixed the
  buttons in her right-click menu.
- **The pace control** (auto-scroll, Smart Read) fades out completely when
  left alone and shows again briefly when the pace changes.
- **Previous chapter with pages**: chapter buttons either side of the page
  arrows in the dock; Ctrl+Left / Ctrl+Right in every layout.
- **The page-turn animation** exists and was measured (a 280 ms eased slide,
  0 to 678 px); it is a slide, not a page curl.
- **A Mac build** cannot be made on Windows: `.github/workflows/macos.yml`
  builds an unsigned universal `.dmg` on a GitHub Mac when run by hand
  (deploy.md, 7b). Never run; the app has never been compiled for macOS.
- **The reader bug pass** (three engineers: scrolling, pages, and the PDF
  reader in both its layouts; each thought through what a reader does, then
  reproduced before fixing). About thirty bugs fixed; each is listed with its
  cause in features.md under "What the bug pass of 1.2 settled". The ones a
  reader would have met most: arrow keys throwing the text a chapter's height
  on near a chapter's start; the saved place coming back one to six lines
  early; with pages, the place slipping back a page on every resize or type
  change, and the last line of four pages in ten hidden behind the dock; in
  the PDF reader, a wasted Space at the foot of every page, Space re-pressing
  a clicked button, and the line lost on a layout switch or a reopen.
- **Reading time changed** (decided by the assistant on the owner's standing
  instruction, both engineers having measured the loss): a page read slowly
  and then turned is credited the time it was up, to 240 s a page
  (features.md, "A page read slowly is reading"). To revert: the
  `pageTurned()` calls in `ReaderView.tsx` and `PageReaderView.tsx`.
- **Also decided there**: the wheel turns pages (one a gesture); "12 of 50" in
  the dock with pages; text stops 56 px above the foot of a page (about a line
  a page fewer); a new comic opens at fit page; Home / End are the chapter's
  start and end when scrolling (Ctrl for the book); a plain `<hr>` now shows
  as a hairline in every book.

**Left from the bug pass, most worth doing first:** the native scrollbar's
runaway when its thumb is held at an end (hide it, or fetch only on release);
click zones and swipe to turn pages; links inside a PDF are not clickable;
no Back after a jump in the PDF reader; a full-page picture flies past in
Smart Read; "finished" (99%) arrives a little before the story's last page;
Scroll in the PDF reader is a little soft on a 4K display at 200%.

**Process note:** twice an engineer changed `ReaderView.tsx` with a script
that rewrote the whole file instead of small edits. Each time the result was
checked (34 markers of the other's work, all present) and the tests passed,
but with several engineers in one 7,000-line file it is the thing most likely
to lose work silently. The file needs splitting before the next round.

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

- **Round two, by design or by limit:** a device on an older version still
  burns books on a break, and that syncs and sticks; "restore my burned books"
  is not offered because a cleared tombstone would return at the next sync;
  the album's lists and odds are frozen once shipped (new things need a dated
  list); a word looked up on two devices while both are offline merges to one
  count; the diary cannot name the book for a past day read with no session,
  mark or progress stamp; the page reader leaves no "stopped mid-chapter"
  record; reading on inside a finished book restamps it and can bring the
  hangover back; the suggestion thinning and the cafe are English- and
  ear-dependent; the bedroom is full.

- **The API is on DuckDNS**, which schools and offices block.
- **Free reads have no book title or start time**, and the public shelf lists
  focus sessions only.
- **Scrolling by wheel or arrow keys for more than 90 seconds without input
  stops counting** (`IDLE_MS`); a page or a screen turned after a slow read is
  now credited (see the bug pass).
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
