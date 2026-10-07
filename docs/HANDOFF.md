# Handoff — 2026-10-05

A snapshot for the next session, not permanent documentation. Delete it once
acted on. The durable reference is [docs/README.md](README.md); how to release
is in [deploy.md](deploy.md) (the checklist) and
[release-msix.md](release-msix.md) (the details).

## Read this first

**2026-10-07: 1.2 is released (the owner built and shipped it from
`release/1.2` at `8553264`). Work is now on the branch `release/1.3`, version
1.3.0, made off that commit. It is committed there (13 commits, to
`e79cad2`) and not pushed. What it holds:**

- **Dotty comes back** (features.md, "Smart Read"). With Dotty below the
  page, Space reads from what is on screen; a drag held at the window's top
  or bottom scrolls the page.
- **A name's card on resting the pointer** (features.md, "Characters"). Any
  name the book uses, written down or not; the book's own line that best says
  what it is; no spoilers; on this device. "Characters" is now on unless
  switched off.
- **A fan wiki's summary** in that card, when asked: fandom.com, through a
  narrow Rust command (`wiki_ask`). It can spoil and says so. **The privacy
  policy draft has a new paragraph for it; publishing the legal pages is the
  owner's, and should go out with 1.3.**
- **The notes, redesigned**: a highlight opens in a card beside the page, and
  the list of notes is a panel of its own.
- **Highlights in PDFs** (features.md, "Highlights in a PDF"): select, colour,
  note, the same card and list as a book's; a place is a page and rectangles.
- **"Where was I?"** (features.md): a card on coming back to a book after
  three days, and in the ··· menu.
- **Pictures to share** (`components/share/`): a highlight as a quote card,
  and a year in review on Social, Stats.
- **Fewer words on screen**: the owner asked for standing explanations to go
  (features.md, "Fewer words on the page").
- **A pass over how it is built** (2026-10-07, the owner asked whether it is
  well built and optimised). Measured first: the bundle (lazy pages; 600 kB
  of script at startup, about 200 kB gzipped), the library with 2,000 books (about
  800 elements on the page, a keystroke in search 4 to 12 ms in a
  development build), the reader (0.2 ms a scroll event, no task over 50 ms
  in 240 steps; a name card three novels into the largest test book in
  0.85 s with no long task). Those were left alone. What was wrong was the
  database: see data-model.md, "How it writes". It now keeps a write-ahead
  log, and a sync is one transaction (18 s to 0.08 s for a year's reading).
  Also: `cargo clippy --all-targets` is clean (it gave 20 style notes), and
  Settings no longer redraws for every book a sync touches. Not done, on
  purpose: 54 commands still run on the window's thread (their writes are
  now cheap; making them `async` is a wide change for little); Pip's art is
  in the startup script (about 150 kB before minifying).
  `apps/node_modules/.leaflet-test/chunks.mjs` prints what each chunk is
  made of.
- 2,231 app tests (120 new), 556 Rust tests (7 new), `tsc` clean, `vite
  build` succeeds. The version is 1.3.0 in the five places deploy.md names.
- **Asked for and not built: read aloud.** The voices Windows gives an app
  are the old flat ones (this PC has David, Zira and Mark only); a natural
  voice means a paid cloud service or a speech model shipped in the app
  (about 100 MB, and its licence needs checking: the usual pronunciation
  part is GPL). The owner said "later". Start with a listening trial, not
  the feature. Also offered and not asked for: translating a selection, a
  dyslexia-friendly face, importing Kindle clippings, a shelf of free books.
- **Not seen on a screen**, any of it: measured in the preview. The look of
  the notes and the card, and how the drag's scrolling feels, are for eyes
  and a hand.
- Phone stage 0 is still uncommitted in its own checkout
  (`.claude/worktrees/stage-0`, branch `phone/stage-0`, off `release/1.2`).

What follows was written for 1.2 and is kept as it was.

**The version is 1.2.0. Everything is committed on `release/1.2` and
pushed to GitHub (2026-10-05; `main` is untouched): the first two days' work, "Pip round two", the reader bug pass and
"The third round", each described below. No 1.2.0 package has been built.
If you are a new session picking the work up, go to "Start here" next.**
**The split of `ReaderView.tsx` (item 1 of "Start here") was done later on
2026-10-05, and the owner chose to ship 1.2 with it: it is committed on
`release/1.2` and pushed, two commits after `8078ca2`.**
The owner tested
1.1.0 and sent a long list of bugs and wishes, then asked for a set of new
Pip features. The packages in `target\msix` are 1.1.0 and older.

| Branch | State |
| --- | --- |
| `main` | Pushed to GitHub at `399f6c4` |
| `release/1.1` | Two commits on `main`, not pushed as a branch of its own: `8eb6a1e` version 1.1.0, `51b0341` release docs without a fixed version |
| `release/1.2` | 26 commits on `release/1.1`, **pushed** as `origin/release/1.2` (which carries `release/1.1`'s two commits with it); five are the third round (backend, readers, Pip, app, docs), the last two the reader split (`apps/src/pages/ReaderView.tsx` from 9,137 lines to 148, `apps/src/readers/text/` new) and its docs |
| Working tree | Clean, bar the untracked `.claude/` (the preview's launch file) |

The commits are split by folder, not by change, because the big files
(`ReaderView.tsx`, `lib.rs`, `index.css`) carry several themes each. Only the
tip was checked: a commit in the middle of a round may not type-check alone.

Suggested next step: the owner looks at it (list below), builds the package,
redeploys the server, then fast-forwards `main` and pushes.

## Start here: what is left to build

Two different lists. The first is the owner's and no session can do it; the
second is the building that remains, in the order to do it.

**The owner's (do not attempt):** build the package, look at the app, redeploy
the server and publish the legal pages, push. All under "Waiting on the
owner". The 1.2 release does not wait on anything in the list below.

**To build, in order:**

1. **Split `apps/src/pages/ReaderView.tsx`: done 2026-10-05, in 1.2.**
   The file was one component of 9,000 lines (9,137, not "about 8,000"). It
   is now 148 lines: a list of hook calls round a frame of JSX. Its state and
   behaviour are in `apps/src/readers/text/`: 24 hook files, each with the
   refs it owns, 8 components for what is drawn, and `scope.ts`. The map of
   files and the three rules that hold them together are in
   [features.md](features.md), "Where its own code lives". **Read those rules
   before changing the reader**: the hooks share one object a render, the
   effects are called in a fixed order, and a hook reaches a later hook only
   through `reader.name` inside something that runs later.
   - *It is a move.* Every one of the 523 statements is in its new file token
     for token (checked with the TypeScript compiler), changed in one way
     only: 49 reads of something a later hook adds (25 names) are written
     `reader.name`.
     The effects run in their old order. Four comments that sat above the
     wrong statement were put above the right one, the one file's section
     rules (`// ---- reading pace ----`) went, and two notes on code no
     longer there were dropped ("flip mode removed", "no auto-advance
     listeners").
   - *It measures the same.* 106 readings over 14 stages, original against
     split: Mistborn in both layouts (at two display scales, 1.5 and 1), and
     a second walk over the chapter list, search, bookmarks, type size, page
     colours, switching layout, auto-scroll, SpeedRead, footnotes, a picture,
     a selection and a highlight. All the same. How, and what made two runs
     comparable, is in [testing.md](testing.md).
   - `tsc` clean, 2,111 app tests, `vite build` succeeds. No Rust changed.
   - *Not done:* nothing was seen on a screen (the pane was hidden, as
     before), and the installed app was not run. The book-opening effect is
     still one effect of 1,300 lines (`useBookOpening.ts`): taking it apart
     would be a change, not a move. Three functions nothing calls came across
     as they were: `applyContentFlowStyles` (`useReaderLook.ts`),
     `displayNextSpine` and `displayPrevSpine` (`useChapters.ts`).
2. **The phone, stage 0** ([mobile.md](mobile.md)): tokens kept on Android
   (the `keyring` crate has no Android store), minutes per device in a ledger
   day (`sync/merge.rs` takes the larger of two devices' minutes, not their
   sum), a document version so an older app does not write a newer document,
   sync when the app goes to the background, and a written two-device test
   run on two copies of the desktop app. This changes the sync document:
   design it so that 1.0, 1.1 and 1.2, which are in readers' hands and know
   none of it, cannot lose data when they meet it, and write that design down
   before coding. During this stage, run the one-hour Drive experiment in
   mobile.md ("Signing in"), which needs the owner's Google project.
3. **The phone, stages 1 to 6**, as mobile.md orders them. The owner can
   build for Android on this machine today (mobile.md, "Building it today":
   the SDK, NDK and JDK 21 are installed; three environment variables are
   not set). A measured list of what breaks at 360 x 800 with touch is in
   features.md, "The readers' chrome", last bullet.
4. **Small things left**, any time, none blocking:
   - a very large PDF page zoomed far in is soft: draw only the part in view
     (a second drawing mode in both PDF layouts; features.md has the numbers);
   - links on the two light page finishes are the browser's blue: give them a
     reader's accent as the dark finishes have (it recolours every book's
     links, so ask the owner first);
   - a PDF's subject and keywords are not read as genres;
   - bookmarks, search results and link tooltips in a PDF give the file's
     page count, not the printed number;
   - converting the owner's three Kindle files has never been tried: Calibre
     is not installed on this machine (do not install it; ask);
   - the Relations drawing with real people, the page reader's Back chip and
     the dock with a very long chapter name at 380 wide were never measured;
   - "Known gaps" and "Decide" below.

**How the owner works, learned the slow way:**

- **Decide, do not ask**, on judgement calls; say what was decided and how to
  undo it. Ask only where the choice is the owner's alone (money, the store,
  anything that recolours or re-lays every book).
- **Commit only when asked**, on `release/1.2` or a branch off it, in themed
  commits; push only when asked, and never to `main`.
- **The owner deploys and builds releases.** Never touch the server, the
  database, secrets, `.env` or the signing key; never run the MSIX build or
  launch the desktop app. Health checks by `curl` are fine.
- **`D:\Books` is the owner's library: read only**, never quoted beyond a few
  words. Copies for testing are in
  `apps/node_modules/.leaflet-test/library/`. No network calls made by hand
  with the books' titles, and the installed app's database is not to be read.
- **Reports in plain words, with numbers**, bugs first, and always what was
  not checked and what only eyes can judge. Nothing in this whole round was
  seen on a screen: the preview pane is hidden, so everything was measured by
  script ([testing.md](testing.md) says how).
- **Several engineers at once** worked well with: a written brief per
  engineer, one owner per file, a shared `CHANGES.md` line before touching a
  shared function, notes saved as they go, and the rule "small edits only,
  never a script that reads and rewrites a shared file", which was broken
  seven times and never cost work, by luck. Item 1 above removes the reason.

## Current state (all run together after the third round, 2026-10-05)

| | |
| --- | --- |
| `npx tsc --noEmit -p .` in `apps/` | clean |
| App tests (`npx vitest run` in `apps/`) | 135 files, 2111 passing (on `release/1.3`, 2026-10-07: 141 files, 2231) |
| Rust tests (`cargo test --lib`) | 549 passing, 3 ignored (one reads `D:\Books` and skips where it is absent); on `release/1.3`, 556 and 4 ignored (the fourth prints what a sync costs) |
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

**Text reader** (`pages/ReaderView.tsx`; since the split its state and
behaviour are in `src/readers/text/`, its helpers in `src/readers/`):

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

## The third round (uncommitted)

Everything here is in features.md with its numbers; this is the map.

- **"Fix them all"**: what the bug pass had left. The scrollbar's runaway when
  its thumb is held (`readers/scrollbarHold.ts`); click zones, swipes and the
  wheel to turn pages, right-to-left books; links in a PDF, Back and Forward
  there, sharper zoom; Smart Read rests at a full-page picture; "finished"
  arrives at the story's last line; sentences followed by speech now pause.
- **Responsive**: every screen measured by script at thirteen window sizes
  from 380 x 480 to 3440 x 1440 (features.md, "Responsive layout"): the cover
  grid counts its own width, pages have a widest size, dialogs fit, the Pip
  tab's room no longer shrinks itself, the readers' popovers scroll and stay
  in the window. The readers' chrome was swept at all thirteen sizes in both
  readers and both layouts (78 runs). Settings gained a **Habit** tab (the
  daily goal, focus and reminders), because Reading's five cards fitted no
  1366 x 768 window.
- **The owner's real library** (`D:\Books`, 19 files; read only, copies under
  `apps/node_modules/.leaflet-test/library/`). Three engineers:
  - *Import*: 8 of 19 were named wrongly (site tags, "Last, First", a file
    name as the title); no book had ever had a genre (Open Library stopped
    sending subjects unasked); Kindle headers read without Calibre; chapters
    found for a PDF with no outline.
  - *The four-novel set*: half its contents were missing (a repeated id in
    the NCX), its last novel counted as back matter, search stopped at 200
    matches. The chapter list now groups by book.
  - *The other EPUBs*: nearly every real book lost its centring, its heading
    sizes and its scene breaks, because the one novel earlier passes used
    happens to mark them in the one way the reader spared
    (`readers/bookBlocks.ts`). A chapter list is made for a book without one
    (`readers/autoContents.ts`), and chapters that share a file are chapters
    for every purpose (`readers/chapterSpan.ts`).
- **The chapter list is findable**: the owner's demo readers could not tell it
  existed. A "Contents" handle on the left edge, the dock's chapter name as a
  button, the C key, a first showing once per device.
- **The phone plan**: [mobile.md](mobile.md). Not started. Its stage 0 names
  three faults that exist today and only show with two devices (the session
  token is not kept on Android; a day read on two devices counts once; an
  older version drops newer fields from the document).

- **The left-overs of all that** were then fixed too: a PDF's own title and
  author, its first page as a cover, printed page numbers, mail links, a
  summary after importing through the dialog; verse, hanging indents, ink
  pictures of any shape, the dock's chapter on a page two chapters share,
  highlights grouped by the chapter's place, search without accents; press
  areas for everything in Pip's room, the room following a change of display
  scaling, and the 77 kB table of book nods loaded on demand (the main chunk
  went from 365 to 290 kB).

**Left, most worth doing first:** converting the three Kindle files was never
tried (no Calibre on this machine); a very large PDF page zoomed far in is
soft (a second drawing mode: features.md has the numbers); links on the light
page finishes are the browser's blue; a PDF's subject is not read as a genre;
everything under "For the phone" in features.md and in [mobile.md](mobile.md).

**Deliberately not done in this round:** splitting `ReaderView.tsx` (no
reader-visible gain, real risk before a release: do it first thing after 1.2
ships; it has since been done, before 1.2 was built, and ships in it:
"Waiting on the owner", 0), and the two-device faults in the phone plan's stage 0 (they change
the sync document, which copies of 1.0 and 1.1 already installed would not
understand: they go out with the phone release).

**Process note:** engineers changed `ReaderView.tsx` (now about 8,000 lines)
or another shared file with a script that rewrote the whole file, instead of
small edits, twice in the bug pass and five more times in the third round,
each time against a written rule. Every time the result was checked and the
tests passed, but with several engineers in one file it is the thing most
likely to lose work silently. **Split the file before the next round**; the
phone plan says the same. (Done 2026-10-05: "Start here", item 1. The rule
still stands for the other shared files, `lib.rs` and `index.css`.)

## Waiting on the owner

0. **1.2 ships with the reader split** (the owner's choice, 2026-10-05; it
   had been planned for "first thing after 1.2 ships"). It changes nothing a
   reader can see, and was measured so ("Start here", item 1); what it has
   not had is a look in the installed app, so the text reader comes first in
   the list below: open a book in each layout, turn pages, start Smart Read,
   make a highlight, close and reopen at the line. To build 1.2 without it
   instead, build from `8078ca2`.
1. **Look at it.** In order of risk:
   - In the installed app (the preview has no backend): import through the
     dialog and read its summary; a PDF with no cover taking its first page;
     a mail link in a PDF; The J Curve gaining its colon and four books being
     renamed on the first launch; Pip's nod on opening a book she knows.
   - New in the third round: the "Contents" handle (is it a control or
     clutter) and the list grouped by book in the boxed set; a book whose
     chapters Leaflet found (does the list changing a second after opening
     read as a flicker); Red Rising, Dune and The Alchemist for centring,
     heading sizes, scene breaks and covers; chapter-number pictures on the
     dark finishes in Project Hail Mary; the four renamed books and genres
     after the first launch; any page at 125% and 150% scaling.
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
[testing.md](testing.md). It includes copies of the owner's own files
(`mistborn.epub`, `test.pdf`, and 16 books under `library/`), and
`shell-sweep.html`, which runs the app in frames of thirteen window sizes. Delete the folder whenever; nothing builds
from it. Development builds publish `window.__leafletRendition` and
`window.__leafletReader`, both behind `import.meta.env.DEV`.
