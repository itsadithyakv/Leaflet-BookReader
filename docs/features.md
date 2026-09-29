# Features

Each feature end to end: what it does, where the code is, and the decisions worth
knowing before changing it.

---

## Library and import

**Where:** `commands/mod.rs::import_books`, `storage/mod.rs`, `pages/LibraryPage.tsx`,
`store/libraryStore.ts`

Books are picked through the dialog plugin, hashed, copied into
`<app data>/books/<sha256>.<ext>`, and inserted. Hashing is streamed in 8 KiB
chunks, and both hashing and import run on `spawn_blocking` so a large file does
not block the UI thread.

Re-importing the same file is a no-op: the hash is the primary key.

**Metadata enrichment** (`metadata/`) fills in missing title, author, genres and
cover from **Open Library**, falling back to **Wikipedia**. Titles are normalised
first (`metadata/normalize.rs`) because filenames from the wild carry ISBNs and
site names. Results are cached with a `metadata_checked_at` stamp and a **14-day
cooldown** — some books simply have no match upstream, and without the cooldown
the app re-queried them on every launch forever.

Covers come **from inside the book first**: at import, the EPUB's own cover
image (the EPUB 3 `cover-image` item, the EPUB 2 `<meta name="cover">`, or an
image named like a cover) is saved as its cover, found through
`META-INF/container.xml` like the rest of the package (`storage/epub.rs`). Only
a book without one is looked up online. Covers are saved to
`covers/<sha256>-cover.jpg`, only after the bytes are checked for a real image
signature (a 404 page was once cached as a permanent "cover").

**Large libraries.** The grid and list draw only the rows on screen once a
library passes 60 books (`components/VirtualRows.tsx`). Cards show a small JPEG
thumbnail (`<sha256>-thumb.jpg`, 360 px, made once) rather than the full cover,
through one cached hook (`hooks/useCoverSrc.ts`). Metadata lookups run three at
a time with a 15-second timeout, and write to the library in batches.

### Series, shelves and collections — `pages/CollectionsPage.tsx`

**Series gather by themselves** (`library/series.ts`). A book's series comes
from, in order of trust:

1. What is **stored on the book**: read from the file at import (Calibre's
   `calibre:series` metas, EPUB 3's `belongs-to-collection`; `storage/epub.rs`),
   or set by the reader from the book's ⋯ menu → Series. `""` means "not in a
   series" and stops every guess. Books imported before this existed have their
   files read once (`scan_series`).
2. A **title that names it**: "Leviathan Wakes (The Expanse, #1)", "…: Book
   Three of the Wheel of Time", "Discworld #4 - Mort".
3. A **well-known series** whose title and author match
   (`library/knownSeries.ts`: about fifty, with reading order, UK and US
   titles). This is what makes seven Harry Potter files with no series metadata
   one series, in order.
4. **Weak hints**, which count only when two books agree: a bare number
   ("Harry Potter 1 - …"), "A Jack Reacher Novel", or one author's titles
   sharing a start ("Mistborn: …").

A group needs two different books (two copies of one are a duplicate, not a
series). Each group knows how much is read, what is next, and which books are
missing: the titles, for a well-known series; the gaps in the numbers,
otherwise. Nothing about groups is stored, so a correction applies at once.

The library shows **"Next in your series"** above the grid when the reader has
finished a book and the next one is waiting, or names the next one to get when
the library lacks it (`components/UpNextStrip.tsx`). Cards carry their series
and number, search matches series names, and the library sorts by series or
title.

**Shelves** fill themselves (`library/shelves.ts`): reading now, next in your
series, recently added (30 days), not started, paused (untouched for 30 days
mid-book), finished, and possible duplicates (one title and author, several
files). Empty shelves are hidden.

**Your collections** are made by the reader: from the page, or any book's ⋯
menu (`components/BookMenu.tsx`). They are in the database (schema v3) and in
the backup document, where the newest edit of a collection wins and a delete
travels as a tombstone, as for highlights.

---

## Formats

**Where:** `formats/mod.rs` (the single source of truth), mirrored for the UI in
`constants/bookFormats.ts`.

Every format falls into one of four *delivery* kinds:

| Delivery | Formats | How it opens |
| --- | --- | --- |
| **Native** | EPUB, PDF, CBZ | Rendered directly. |
| **Built-in** | TXT, TXTZ, HTML, HTM, HTMLZ, XHTML, FB2, FBZ | Converted to EPUB **in-process** by `convert/`. No external tool. |
| **Convert** | MOBI, AZW/AZW3/AZW4, PRC, PDB, LIT, LRF, RB, SNB, TCR, PML/PMLZ, RTF, DOCX, ODT, CHM, CBR, CBC | Needs Calibre. |
| — | anything else | Rejected at the picker, not silently dropped after import. |

The built-in converters (`convert/text.rs`, `convert/html.rs`, `convert/fb2.rs`,
assembled by `convert/epub_builder.rs`) exist so the common formats need no
200 MB download. The EPUB they write stores the `mimetype` entry uncompressed and
first, as the spec requires.

### The Calibre converter

Never bundled. Leaflet looks for an existing Calibre in the usual install
locations first, so a user who already has it is not asked to download a second
copy; on Windows it can fetch a portable build if asked, and removes the
installer afterwards.

**It is compiled out of mobile builds entirely** — there is no Calibre for
Android, and the download-and-unpack path cannot run there. The Settings card and
the open-book prompt both say so rather than offering a dead-end install. A
Calibre-only format opened once on a desktop syncs to a phone as a normal EPUB,
because the conversion is cached by hash.

---

## Readers

Two readers, chosen by delivery kind.

### Text reader — `pages/ReaderView.tsx`

epub.js, **scrolling** by default or **turning pages** (Reader panel → Layout;
a preference of the device, `leaflet.reader.layout`). Progress is stored as a
fraction plus a CFI so a position survives a font-size change.

The page renders inside an **iframe**, which shapes a lot of the code: word
indexing for Smart Read, the toolbar reveal, and typography injection all reach
in through `rendition.getContents()` rather than the parent document.

The reader's helpers live beside it in `src/readers/`: progress
(`progress.ts`), the table of contents, page colours, ink images, auto-scroll
and pacing, the notes panel, search and the selection bar.

**Progress** is by how much of the book is behind the reader: each section
weighs its size in the EPUB (Rust reads the sizes from the archive's directory,
`epub_sections`), and chapter titles only mark where front and back matter
end, when they frame the story. See `readers/progress.ts` and its tests.

**Pages.** epub.js lays a chapter out as columns on the body and slides the
frame a page at a time. Everything that forces a full width (the page CSS, the
`.reader-scroll` rules, `applyReaderInsets`, the overflow clamps) is for
scrolling only; with any of it applied, every chapter becomes one page. Arrow
keys, Page Up/Down and Space turn pages; the dock's arrows become previous and
next page. Auto-scroll, Smart Read, SpeedRead and Dotty are built on scrolling,
so they are off with pages.

**Search** (the magnifier, or Ctrl+F): every section in reading order, loaded,
searched with epub.js's `find` and unloaded, one at a time. Results arrive
section by section under their chapter; choosing one jumps there and marks
the words for a few seconds. `readers/searchBook.ts`, `readers/SearchPanel.tsx`.

**Highlights, notes and bookmarks.** Selecting text offers four highlight
colours, a highlight with a note, or copy (`readers/SelectionBar.tsx`).
Highlights are drawn by epub.js's annotation layer and open their note when
tapped. The notes panel (the bookmark icon) lists bookmarks and highlights in
reading order and copies every highlight and note as Markdown. They are kept in
the database (`annotations`, schema v2) and carried in the backup document,
where the newest edit of each wins and a delete travels as a tombstone.
Bookmarks from before (in the webview's storage) move over the first time a
book opens.

### Page reader — `pages/PageReaderView.tsx`

Draws PDFs with pdf.js, and CBZ comics from images the backend serves page by
page (`comic/mod.rs`). A comic is *not* flattened into an EPUB — that would turn
a comic into a broken text document. Pages are sorted with a natural comparison
so `page10` follows `page9`.

Both readers share `.reader-*` styling, the slide-over chapter/page list, and the
auto-hiding toolbar.

### The auto-hiding toolbar

`hooks/useAutoHideChrome.ts`. The bar **floats over the page**: the page is
always full height and the book's text starts below the bar (an 80px top
padding on the book, and on the page reader's stage). When the page used to
resize to make room, every hide and show re-flowed the book and the text
jumped.

It drifts away ~2.6 s after the book opens and comes back only when:

- the pointer rests on the **top edge** of the window (a transparent strip,
  marked by a faint handle; the book is an iframe, so the bar cannot see a
  pointer moving over the text), staying while the pointer is on it and
  leaving ~0.9 s after;
- keyboard focus moves into it;
- the page is tapped on a touch screen.

Moving the mouse over the text, clicking it, scrolling and the reading keys
never bring it back: that is reading. It is **pinned** while one of its own
panels is open. The chapter list is not one of them: it opens under a hidden
bar and reaches the top of the window.

### Page colours

The reader root publishes the page's own finish as `--reader-page-bg`,
`--reader-page-texture` (the paper's grain), `--reader-page-ink` and
`color-scheme`, and everything around the book text (the frame, the scroll
gutters, the scrollbar) uses them. These used to follow the app theme, so a
dark page under a light app showed pale strips and a white scrollbar track down
the sides.

### Line length

Lines no longer run the whole window: the text sits in a centred column,
**Medium** by default (34 em of the reading size, about 72 characters),
with Narrow (28 em), Wide (42 em) and Full beside the text size in the type
panel. It is a device preference (`leaflet.reader.measure`, in
`readers/readerTypes.ts`), like the layout. The column is measured in em, so
bigger type keeps its characters a line.

- **Scrolling:** each side's padding in the book is
  `max(gutter, (100vw - measure) / 2)` (`MEASURE_PADDING`), so a window
  narrower than the column keeps its 24 px gutter. Dotty and the page steps
  read the computed padding, so they follow the column.
- **Pages:** epub.js lays its columns across the viewer, so the viewer itself
  is narrowed and centred (`pagesViewerMaxWidth`), and the book's own padding
  is left alone.
- A new line length reflows the text like a new type size: the line in view is
  kept, and Dotty is placed again once the padding has eased into place.

**Ink-on-white pictures** (`markInkImages`): chapter titles, drop caps and
ornaments are often black ink on a white rectangle. Images with no colour and
almost nothing but paper and ink are marked `data-leaflet-ink`: "title" when
banner-shaped, "art" otherwise. On the paper finish their white multiplies into
the cream; on a dark page only "title" images are inverted to white ink.
Photos, shaded or finely drawn maps, and pencil art fail the test and are left
untouched, and a line map is never turned into its negative. Clicking a marked
image toggles the original.

---

## Smart Read ("Dotty")

**Where:** `readers/paceModel.ts` (the pace), `readers/paceTracker.ts` (turning
reading into samples), `readers/smartScroll.ts` (page steps),
`readers/ReaderTour.tsx`, `services/readingProfileService.ts`,
`sync/reading.rs`, `components/ReadingPaceCard.tsx`, and `ReaderView.tsx`

A dot, **Dotty**, paces the reader through the text at their own pace; an RSVP
overlay (SpeedRead) can present one word at a time. With no pin Dotty follows
the reading; drag it, or move it with the arrow keys, to pin a start line. In
Smart Read it walks through the text word by word.

**The pace is learned from all reading**, not only Smart Read:

- **Free reading** teaches it: the words passing the reading line as the reader
  scrolls (`ScrollPaceTracker`), or the words on each page they turn in the
  pages layout (`PagePaceTracker`). Auto-scroll's scrolling is not taken for the
  reader's; a run of it left uncorrected counts as a pace kept up with.
- **Each book keeps its own pace.** A new book starts from the reader's overall
  pace (recent books counting most), adjusted by how they read books of the same
  difficulty band and genre.
- **Difficulty**: a chapter's text difficulty (`estimateTextDifficulty`: word
  length and rarity, and sentence length, so dialogue and children's books read
  as easy) sets its pace, so easy books are predicted faster than demanding ones
  before either has taught anything. Paces are stored "plain" (as if on text of
  difficulty 1) and divided by the difficulty of what is on screen. Within a
  chapter, each word's own difficulty spreads the time.
- **Time of day**: how much faster or slower than their usual pace a reader is
  in the morning, afternoon, evening and night, learned once a book's own pace
  is trustworthy.
- **Pauses are not slow reading.** A stretch far slower than expected (a stop to
  think, a reader who looked away) is left out, words and time alike; one far
  faster is skimming. Only when they keep coming the same way (three in a row)
  are they learned, as how this book reads. Time with Leaflet not in front is
  never counted.
- **The reader's own say.** − and + (the pill, the ··· menu, or the - and +
  keys) set Dotty's pace for this book at once, and it is remembered. Reading
  on ahead of Dotty is measured: once the scrolling settles and Dotty is off the
  top of the page, Dotty jumps to the reader and takes up most of their pace.
  Dragging Dotty ahead does the same; back a line or two slows it a little;
  back further is rereading and says nothing about the pace.
- **Dotty waits.** Holding a finger or the mouse on the text, a selection, a
  panel over the page, or scrolling back above Dotty to reread all make it wait
  without counting the time; scrolling back to Dotty (or Space) carries on.
- **Dotty's range** (Settings, default 90–700 WPM) bounds Smart Read. The old
  default ceiling of 320 was why Dotty could never catch a fast reader.

The profile is kept in the library database and travels in the sync document
(`readingProfile`), merged part by part, so every device reads at the reader's
pace. The old device-only Smart Read profile is brought over once.

**Page steps.** Dotty reads down to near the bottom of what is visible, then
the page moves up in one smooth step that brings its line to near the top: a
page turn rather than a nudge every few lines (it used to keep Dotty around the
middle). The step is worked out from the reading area actually on screen (below
the toolbar when it shows, above Smart Read's controls) in lines of the current
type, so it suits a small laptop, a tall portrait monitor, a wide window and
large type alike, and Dotty holds its word while the page moves.

**The tour.** The first book opened on a device shows a short walkthrough:
Dotty, starting Smart Read, making it your pace, and pausing. The ··· menu
("How Dotty works") and Settings bring it back. After it, books open in Smart
Read by default (in the scrolling layout), paused at the reader's line so
nothing moves until Space; its last step and Settings turn that off.

Behaviours worth knowing (from the pre-release review):

- Punctuation and paragraph pauses scale with speed, and each section averages
  out to the WPM shown. They used to be fixed milliseconds, so "600 WPM" really
  ran at about 400.
- Only real paragraph ends pause; an italic or bold word no longer does. Words
  split by inline formatting (a drop cap) read as one word.
- RSVP crosses chapters at the next chapter's first word, skips image-only
  chapters, and stops at the end of the book instead of replaying the last page.
- Hands-free reading (auto-scroll, Smart Read, RSVP) earns time for 5 minutes
  after the last real input (`HANDS_FREE_GRACE_MS`). Past that, playback pauses
  with "Still reading? Press Space to carry on." so playback and credited time
  always agree.
- Keys keep working after clicking into the book text: the epub iframe forwards
  them to the reader's shortcut handler.
- Nothing plays on while Leaflet is in the background: switching apps pauses
  auto-scroll, Smart Read and RSVP (the OS window's focus, not the page's
  `blur`, which fires when the book's iframe is clicked). Coming back says so,
  and the reader resumes with Space.

### The RSVP stage

One word at a time, in a reticle whose tick marks the fixation letter (the
"optimal recognition point", `rsvpPivotIndex`): a little left of centre by word
length, skipping leading quotes. That letter stays on the same spot of the
screen while the word flows around it, so the eye never moves. Trailing
punctuation is shown faintly, so sentences still read as sentences.

Below it: the pace, a progress line for the chapter and the time left in it,
then the passage with the current word underlined. These stay faint while it
runs and come up when paused. The stage takes its colours from the page's
finish (`--rsvp-*`), not the app theme, so a true-black or dark-paper page gets
a dark stage and the paper finish stays paper.

Controls: Space pauses, `+`/`-` change the pace by 20 WPM, and the − / play / +
buttons under the passage do the same.

### Auto-scroll

Measured in **lines per minute**, not pixels: the pixel speed follows the font
size, so a bigger font reads at the same pace. Controls:

- **Space** starts and pauses; `+`/`-` change the pace; a floating control
  (− / pause / +) shows while it runs, faint until the toolbar wakes or the
  pointer is on it.
- **Hold the page** (mouse button or finger down on the text) and it waits;
  letting go resumes after a short breath. Selecting a passage therefore never
  fights the scroll.
- **Scrolling by hand** makes it step aside and resume from wherever the reader
  left it: 3 s after scrolling back (re-reading), 1.2 s after scrolling ahead.
- **A new chapter** holds for a beat at the top, so its heading is seen.

It learns from those corrections: scrolling ahead by more than half a screen
in one burst means it is too slow (+4), scrolling back more than a third of a
screen means too fast (-5), at most once every 12 s, with a toast saying so.
The speed a reader settles on is saved for the book and becomes the starting
speed for every other book.

**At the reader's pace.** In a book where the reader has not set its speed,
auto-scroll starts at their learned reading pace (see Smart Read), turned into
lines by how many words a line holds on this screen: a wide window fits far
more on a line, and a fixed lines-a-minute default ran far too fast there.
Books opened before this keep the speed they had. A run left without a
correction for a few minutes is learned as a pace the reader keeps up with,
counting for less than a measurement, as Smart Read's is.

---

## Focus mode, streaks and the shelf

**Where:** `habit/mod.rs` (the engine), `db/mod.rs` (the ledger), `store/habitStore.ts`

A day counts when reading time meets the daily goal. The engine is **pure** — no
clock, no database — so the rules are unit-testable: the caller passes the ledger
and today's *local* date.

```rust
const DAYS_PER_FREEZE: i64 = 5;   // earn a freeze every 5 counted days
const MAX_FREEZES:    i64 = 2;
const BURN_PER_STREAK_DAY: i64 = 1;
const MAX_BURN:       i64 = 12;   // a 100-day streak cannot wipe the shelf
```

Rules worth knowing:

- **Local dates, everywhere.** An earlier version computed "today" in UTC on the
  Rust side and locally in the UI, so the two disagreed near midnight.
- **Today in progress never breaks a streak.**
- **Grace is spent before a freeze**, and a gap is only paid for once the walk
  finds an *earlier* qualifying day — otherwise opening the app for the first
  time would spend grace bridging to a streak that never existed.
- **Minutes come from a reading heartbeat** (`hooks/useReadingHeartbeat.ts`), not
  from timers. It credits `min(elapsed, tick)` only while a book is open, the
  window is visible and there has been recent interaction — so a sleeping laptop
  banks nothing, and reading without a timer still counts.
- **Breaking a streak burns the most recent books**, scaled to its length and
  capped. Burned sessions are **tombstoned, never deleted**, so Analytics can say
  "42 books · 7 lost to broken streaks" honestly.
- **Time in other apps is not session time.** Leaflet watches the OS window
  focus (`services/windowService.ts`; the DOM's `blur` also fires when the
  reader clicks into the book's iframe, so it cannot be used). A stint away
  under 30 s is free (a dictionary lookup); a longer one is added to the
  session's `awayMs` and the session clock (`sessionElapsedMs`) skips it,
  including a stint still in progress, so a session never completes while the
  reader is elsewhere. On return, Pip reacts.

### Focus lock

Settings → Focus → **Focus lock** (stored as `kioskMode`). During a session the
window goes fullscreen, and leaving the book takes intent:

- **Back** gets Pip: it pops up beside the button and swats at the cursor
  (the `swat` move, mirrored), and a click asks in Leaflet's own dialog
  ("Leave mid-session?"). Ending there records the session as ended early; the
  minutes still count.
- **Escape** tapped: Pip guards and says to hold it. **Held for a second**, it
  leaves (same result). There is no keyup from inside the book's iframe, so the
  hold is timed across the key's auto-repeat.
- **Alt+Tab and the Windows key are never blocked.** An app cannot block them
  reliably, and trapping people is hostile; the Store's policies expect an app
  to let the user leave. Switching away pauses the session clock instead (see
  above), which is the honest version of "you can't leave".

Fullscreen is keyed on "a session is running with the lock on", entered and left
once each. The previous version re-checked fullscreen on every window resize,
and the resizes caused by entering fullscreen could pop a false "Exiting
fullscreen…" confirm the moment a session started.

All yes/no questions use `components/ConfirmDialog.tsx` (`askConfirm`), not
`window.confirm`, which in WebView2 is a grey box titled with the page origin
and can open behind a fullscreen window.

---

## Reminders

**Where:** `reminders/mod.rs` (the rules, pure and unit-tested),
`reminders/runtime.rs` (scheduler, commands, exit hand-over),
`reminders/toast.rs` (Windows toasts), `components/RemindersCard.tsx`
(Settings → Reminders), `components/ReminderOptIn.tsx`, `hooks/useReminders.ts`

Windows toasts that nudge the reader when today's reading is still to do.
Everything is **off by default**. Leaflet asks once, after the first focus
session that runs to the end (never on first launch); either answer is final
and Settings has the rest.

| Reminder | When | Only if |
| --- | --- | --- |
| **Daily** ("Time to read? Pip's saving you a seat.") | The reader's chosen time (07:00–22:59, default 19:00) | Today's goal is not met |
| **Streak at risk** | 22:00 | A streak is running (> 0) and today is not met |
| **"You're close"** (optional) | 15 min after a focus session ends | That session left the reader 5 minutes or less short |

Rules that hold for all of them:

- **At most one per day per kind**, recorded in `reminder_fired` (settings
  table). Two due in the same minute send one (streak beats daily beats close)
  and retire the other for the day.
- **Never at night.** Quiet hours are 23:00–07:00; nothing fires or is
  scheduled inside them, and the daily time is clamped out of them.
- **Never while reading**: not while a session runs, a book is open, or
  Leaflet is the window in front (telling someone looking at Leaflet to open
  Leaflet is silly). A reminder held back this way can still go out up to an
  hour late; after that the moment has passed.
- **Pip's mode changes the words only.** Chatty and Quiet mention Pip (Quiet
  says less); Off never does.
- **Local time.** The rules take the reader's local wall-clock time; the one
  conversion to UTC (for Windows' schedule) handles DST gaps and repeats.
- **Read-only habit check.** Reminders evaluate the ledger with
  `habit::evaluate` but never persist it, so a check cannot spend a freeze or
  burn a book.

### Delivery

- **While Leaflet runs** (minimised included), a Rust thread wakes at the top
  of every minute and asks `due_now`. It runs in Rust so WebView2's throttling
  of a minimised window's timers cannot delay it. The frontend reports session
  / open-book / Pip mode through `reminders_context`.
- **When Leaflet closes** (main window destroyed), `plan_ahead` picks what is
  still to come today plus tomorrow's reminders, and they are handed to Windows
  as `ScheduledToastNotification`s in the group `leaflet-reminders` (tag per
  kind), replacing any earlier ones. Reading minutes only change inside the app,
  so "not met yet" stays true until the reader returns. Tomorrow's streak
  reminder is only scheduled when today is met (otherwise grace or a freeze may
  or may not carry the streak, and a toast about a lost streak would be wrong).
  Something whose time came while the reader was in the app is not sent a
  minute after they close it.
- **On the next launch** the schedule is withdrawn (only the running app can
  see an open book), toasts whose time passed while closed are counted as sent,
  and delivered reminders are cleared from the notification centre. Each toast
  also expires at the end of its own day.
- **Clicking a toast** opens `leaflet-reader://continue`, registered as a
  protocol in the MSIX manifest. Windows starts Leaflet with the URI as its
  argument (or single-instance forwards it to the running window) and the app
  reopens the last book. Only `continue` is acted on, since any web page can
  open that protocol.

| Build | While running | While closed | Toast click |
| --- | --- | --- | --- |
| **MSIX (Store)** | Yes, as Leaflet | Yes (scheduled toasts) | Opens the last book |
| **NSIS / MSI install** | Yes, under the installer's AppUserModelID | No | Nothing |
| **Dev (`tauri dev`)** | Yes, shown as Windows PowerShell | No | Nothing |
| **Android / macOS / Linux** | Card hidden: no delivery path | — | — |

Scheduling needs package identity (`GetCurrentPackageFullName`), which only
the MSIX has. Windows drops a scheduled toast if the PC is off for more than
five minutes past its time; that day's reminder is then simply missed.

---

## Seeds and the Pip tab

**Where:** `habit/seeds.rs` (water, the garden, earnings, mood), `pip/mod.rs`
(the shop's rules), the `pip_*` commands, `pages/PipPage.tsx`,
`components/pip/`, `store/pipWardrobeStore.ts`, `pip/shop.js` (the catalogue
and prices), `pip/home.js` (the house)

A reason to actually use focus mode. Reading in a focus session waters Pip's
**garden**; ripe plants are picked for **seeds**; seeds buy things for Pip,
Talking Tom style: variants (robot, president, skater...), a wardrobe of
accessories, floors of a house with furniture, wallpapers and floors, book
nods, food and toys, and the showier moves. The Pip tab is a main tab (the
sprout icon), and the whole tab is Pip's house.

### The garden (where seeds come from)

Minutes do not pay seeds directly (that made everything too easy). Instead:

- **Water.** Each whole minute of a focus session is one water, half as much
  again for a session completed without leaving the book. Session minutes
  count only up to the reading the **heartbeat** recorded that day (plus a
  minute of slack for a flush in flight), so a timer left running waters
  nothing, as it earns nothing towards the goal.
- **Plots.** Three to start; a fourth, fifth and sixth for 200, 350 and 500
  seeds, each after the one before.
- **Planting** costs a seed packet (a few seeds). Water flows to the growing
  plants in planting order, spilling to the next; with nothing growing it
  waits in a **rain barrel** (up to 120), which pours into the next planting.
- **Ripening.** A plant ripens when it has had its minutes of water. Tap it to
  **harvest** its seeds (Pip cheers, and it cheers Pip up a little).

| Plant | Water (minutes) | Seeds | Packet |
| --- | --- | --- | --- |
| Radish | 15 | 4 | 1 |
| Strawberry | 30 | 9 | 2 |
| Sunflower | 60 | 20 | 4 |
| Reading Rose | 120 | 42 | 8 |
| Pumpkin | 180 | 70 | 12 |
| Oak | 600 | 260 | 30 |

Longer plants pay better per minute, so planting an oak is a small promise to
read. Nothing withers: a plant waits, unwatered, for the next chapter, and
reading done on another device reaches the garden when it syncs.

**Event-sourced, so it cannot be faked.** Plantings and harvests are records,
like purchases. How far a plant has grown is never stored: `habit::seeds::grow`
replays the water (the sessions) against the plantings in time order every
time. A harvest counts only if that replay shows the plant ripe, never for
more than the plant gives, and once per planting. More reading (a sync that
brings in another device's sessions) can only bring plants closer to ripe.

### Seeds

There is no balance column: balance = the welcome gift + harvests + goal
bonuses − purchases (seed packets included), recomputed from the records.

| Source | Seeds |
| --- | --- |
| Harvests | the plant's yield |
| A day the goal was met by reading | +4 |
| ...its streak bonus | +1 per day of the streak, up to +6 |
| Welcome gift | +50, once |

A day covered by a freeze or grace keeps the streak going but earns nothing.
Seeds are never taken back: a broken streak burns books on the shelf, not
Pip's hat. **Before the garden** (local days before `GARDEN_SINCE`,
2026-09-27), minutes paid seeds directly (one a minute, ×1.5 clean, +25 a goal
day, a streak bonus up to 40); what readers earned then is kept, as if already
harvested.

**Pacing**, for a reader doing a 20-minute goal most days (about 30 water a
day): the garden gives 10 to 12 seeds a day, the goal and streak bonuses about
10, so roughly 150 a week. Prices are set for that (`PACING` in `shop.js`):

| Thing | Seeds | Reading |
| --- | --- | --- |
| Accessory | 20 to 200 | a day to ten days |
| Common variant | 120 to 200 | about a week |
| Rare variant | 400 to 520 | about 3 weeks |
| Epic variant | 900 to 1,200 | 6 to 8 weeks |
| Legendary variant | 1,800 to 2,400 | about 3 months |
| A floor of the house | 450 to 900 | 3 to 6 weeks |
| Move | 60 to 360 | a few days to 2 weeks |
| Decor, wallpaper, flooring | the art's price × 0.6 | |
| Snacks | the art's price × 0.5 | |

The art's prices are read as relative (within a skin's rarity, the King costs
more than the President); `shop.js` turns them into seeds on this scale.

### Price authority

`pip_buy(kind, id)`, `pip_plant(plot, plant)`, `pip_feed(treatId)`: the
webview names the thing; **Rust decides the price**, from
`src-tauri/src/pip/catalogue.json`, compiled into the binary. That file and the
server's `pipParts.json` are generated from `apps/src/pip/shop.js` (which reads
the art modules through `home.js`) by `apps/scripts/pip-catalogue.mjs`, run by
the Vite build on every build and dev start. The alternative, the frontend
sending the price and Rust rejecting anything below a floor, would still let a
devtools call buy a 2,400-seed variant at the floor price, and the floor would
be a second, hand-kept price list anyway. A server test fails if
`pipParts.json` is stale.

- Free things (price 0) are owned from the start; achievement skins
  (`earnedOnly`) are never sold.
- Floors of the house open in order: `requires` (the floor below) and
  `sessions` (focus sessions done first), checked in Rust.
- Snacks and seed packets are bought each time they are used. Everything else
  is bought once.
- The balance check and the purchase happen under the database lock, so two
  quick taps cannot spend the same seeds twice.
- `pip_state_set(look)` refuses anything not owned: a variant, an accessory
  (one per slot), a room item (in one place in the whole house), a wallpaper
  or flooring, a floor of the house, a signature move.
- `pip_harvest(plantingId)` refuses a plant the replay does not show ripe.

The other commands: `pip_wallet`, `pip_state_get` (the wallet, what Pip owns,
the garden, sessions done, arcade scores) and `pip_game_played`.

### The tab: Pip's house

The whole tab is the house. The current floor fills the page, drawn by the
house art (`house.js`, 240 x 120) at a whole number of device pixels per
pixel; windows show the real hour's sky, and in the evening the rooms dim and
lamps glow. Pip lives in it: it strolls, fills free moments with its signature
move or a hobby, can be dragged about and dropped, and reacts when poked. A
switcher beside the scene moves between floors: the **Bedroom** and the
**Garden** are free; the Kitchen, Library, Attic Arcade, Basement Workshop and
Rooftop Observatory open in order, each after the one below and some focus
sessions, for seeds.

A bar over the scene holds the seed balance, the **Shop** button (always
there, in the brand green), mood hearts, and the tools, each opening a drawer
beside the scene:

- **Wardrobe**: owned variants and accessories by slot, earned skins as goals.
- **Garden**: plots, their water and minutes to go, planting, picking, more plots.
- **Treats**: snacks (bought as given) and toys; Pip plays the treat's move.
- **Moves**: preview any move, buy one, pick the signature.
- **Decorate**: every slot on the floor becomes a dotted box; select one to
  choose what goes there (only items that fit that slot), plus the floor's
  wallpaper and flooring. Items snap to slots and are in one place at a time.

**The shop** is a large dialog with a tab per kind of thing (Variants,
Wardrobe, Decor, Book Nods, Treats, Moves, Floors & walls): big tiles with the
thing drawn large, a price chip, "Owned" and "Equipped" badges, and what is out
of reach greyed with "N more seeds · ~M min of reading". Selecting a tile opens
it on the right: a big preview, what it is, **Preview on Pip** (the house's Pip
wears it or does it, with a bar to buy, go back to the shop, or stop), and Buy
or Wear / Place / Use. Every purchase confirms (`askConfirm`), except snacks
and seed packets, whose price is on the button.

**Book Nods** are original house items that tip their hat to famous books
(each with a `nod`, the book). If a book in the reader's library matches
(title matching like Pip's book scenes, `nodMatches`), the tile wears a "From
your library" ribbon.

### The Attic Arcade

Three mini-games, on the Attic Arcade floor (select the cabinet, or Arcade):
**Pip Dash** (an endless run: jump book stacks, duck bats and pages),
**Leaf Catch** (catch leaves, seeds and letters, dodge ink) and **Page Flap**
(leaf-copter between towers of book spines). They play in a crisp pixel
canvas (240 x 120) at 60 fps on a fixed 120 Hz simulation, with the reader's own
Pip in its outfit; the art is `games-art.js`. Space or ↑ jumps or flaps (hold
to jump higher), ↓ ducks, ← → move, and a click or tap works everywhere.
Difficulty ramps on a fixed curve and obstacles come from a seeded generator.
They pause when the window loses focus or is hidden, stop their loop when
closed, and under reduced motion play without screen shake.

**Games never mint seeds.** A finished game cheers Pip up (+3 mood, at most +12
a day, by the reader's local day) and keeps a best score per game, in a
settings row on this device (not in the backup: nothing is bought with
scores).

### Mood

0 to 100 in `pip_state`, starting at 70 and drifting down about 8 a day
(`mood_at`, computed when read). A recorded session of a minute or more adds 5,
a treat its `mood`, a harvest 2, a game 3 (capped). Five hearts on the Pip tab;
under 20, Pip mopes. Nothing else: no notifications, no guilt.

### Earning feedback

The session wrap-up counts up "+N water" (what the session poured) and any
bonus seeds, and says "2 plants just ripened!" when it ripened some. The first
time, Pip explains the garden.

### Data and backup

| Table | Holds |
| --- | --- |
| `pip_purchases` | `id` (random), `item_kind`, `item_id`, `price` (as paid), `bought_at`. Append-only. A seed packet's purchase has the same id as its planting. |
| `pip_plantings` | `id`, `plot`, `plant`, `planted_at`. Append-only. |
| `pip_harvests` | `id`, `planting_id`, `seeds`, `harvested_at`. Append-only. |
| `pip_state` | One row: `variant`, `accessories` (JSON), `room_layout` (JSON: `level/slot` to item, `level/@wallpaper`, `level/@floor`), `room_style`, `mood`, `mood_updated_at`, `signature`, `updated_at` |

All four travel in the backup document (`purchases`, `plantings`, `harvests`,
`pip`), because they fit the merge rules without special cases: the records
never change and have random ids, so they merge as **unions** (commutative
and idempotent); the state is one record where the **newest `updated_at`
wins**, a tie settled by content. Documents from before the shop parse with
none of them. Two devices spending the same seeds offline can overdraw the
balance after a sync; it shows as 0 and the garden refills it.

### The profile picture

"Use my Pip" (Seeds and mood, with an account) sets the avatar to the reader's
own Pip: `variant.signature`, plus `.acc+acc` for the accessories that show on
that variant, e.g. `robot.moonwalk.tophat+scarf`. The server
(`server/src/avatars.js`) checks each part against its own allowlist (the signup
catalogue's skins and moves plus `pipParts.json`; accessories one per slot) and
still accepts every older `skin.move`. It is cosmetic: the server does not
check purchases. Builds from before this fall back to the handle's skin for a
value they do not know.

---

## Social page: stats, the bookshelf, the community

**Where:** `pages/SocialPage.tsx`, `components/ReadingCalendar.tsx`,
`components/SessionShelf.tsx`, `components/SocialPanel.tsx` and
`components/community/`

Two tabs: **Stats** (your own reading) and **Community** (everyone else's).

**Stats** has six figures (this week, streak, best streak, books finished,
days read, total time), a twelve-week reading calendar (a column per week,
Monday on top, shaded against the daily goal, today outlined) and the session
bookshelf. A new profile reads honest zeros.

These are the same numbers your public card shows, computed the same way:
minutes from the day ledger, the week from Monday in your own time zone, and
"finished" by one rule, `FINISHED_AT` (0.99) in `constants/books.ts`, mirrored
in Rust. The library count, the book card label, Pip's celebration and the
published profile all read it.

### The session bookshelf

Every finished focus session becomes a spine, and every visual property means
something:

| On the shelf | Means |
| --- | --- |
| A plank | One week (Monday–Sunday, local), newest on top, with that week's minutes |
| Spine height and width | Session length |
| Spine colour | The book (hashed from its id, so a run on one book is recognisable); parchment for free reads |
| Title on the spine | The book read in that session |
| Gold band | Completed cleanly |
| Ribbon | The session has a note |
| Charred spine | Lost when a streak broke, left in place so the cost is visible |
| Golden bookend | A perfect week: goal met all seven days |
| Wood | Levels with the spine count: Pine, Oak, Walnut, Mahogany, Ebony, Gilded |

The newest spine drops in when the shelf is next opened, and the wrap-up says
"Shelved as book #N".

### Community (leaderboards)

Behind `FEATURES.community`, and needs a Leaflet account. In order:

- **You**: the one place for your Pip, name, handle and whether you are shared.
  Settings keeps only the account itself (email, password, sign out, delete).
  Signed out, this is a single "Join the community" card.
- **Leaderboard**: this week's board (Everyone, or readers you follow) with Pip
  avatars, rank changes and your gap to the next place. "Keep reading" starts
  a session long enough to pass the next reader, on the book you were last
  reading, and opens it.
- **Duels**, the **Inbox** (which Pip reacts to) and **Find readers**.
- Reader cards: follow, kudos and weekly duels (accept or decline right there).

Only public profiles appear or can be interacted with. The words are fixed in
`components/community/copy.ts` (kudos, follow, duel, a streak in days, a week
that ends Sunday at midnight); the headers, tabs and shelf are shared
components (`ui/SectionHeader`, `ui/SegmentedTabs`, `shelf/spine`).

**Publishing your numbers.** `publish_social_stats` sends this week's minutes,
streak, books finished and shelf for a public profile. The app calls it when a
session is recorded, when the Social page opens (and every minute it stays
open), and on the five-minute community pulse, at most once a minute unless a
session just ended. It used to ride only on a Drive backup, which left readers
without Drive frozen on the board.

Server side is in `server/`; see `server/README.md`.

---

## Sync, sold as backup

**Where:** `sync/` — `merge.rs`, `store.rs`, `folder.rs`, `drive.rs`, `cloud.rs`

For the desktop launch this is presented as **backup to Google Drive**: one
computer, restorable on another by signing in with the same Google account. It
backs up on launch and whenever a book is closed. Folder sync and "sync across
devices" wording are behind `FEATURES.multiDeviceSync` until the mobile app
ships (see [product.md](product.md)). `sync_now` runs one at a time (a lock in
`AppState`), because two simultaneous first syncs used to create two
`state.json` files in Drive.

The transports below share one set of rules.

### The document

A few kilobytes of JSON: the book index (id, extension, title, author, genres,
series, progress, position, tombstones), the habit ledger, the session shelf,
highlights and bookmarks, and the reader's collections.
**Book files are not in it** — they are fetched on demand, so connecting a new
device is instant rather than a multi-gigabyte download.

Deliberately absent from the document: `local_path` and `cover_url`. Those are
absolute paths that mean nothing on another machine, and syncing them is what
used to break covers on the receiving device.

### The merge

`merge.rs` is pure, and tested for two properties:

- **Commutative** — `merge(a, b) == merge(b, a)`, so devices cannot disagree
  based on who synced first.
- **Idempotent** — syncing twice changes nothing, so a retry is always safe.

Conflicts resolve **per field group**, each with its own timestamp. Whole-record
last-writer-wins keyed on `last_opened` was the original bug: it meant merely
*opening* a book on a second device rolled another device's position backwards.
Now a device that only opened a book cannot win `progress`.

Deletions are **tombstones**, garbage-collected after 90 days. Without them a
deleted book returned from the remote copy on the next sync, forever.

### Folder transport

Point Leaflet at a directory that Google Drive / Dropbox / OneDrive / iCloud
already syncs. No account, no API, no quota. `state.json` is written through a
temp file and renamed, and a lock file keeps two devices from interleaving a
read-modify-write.

### Drive transport

Scope is **`drive.file`** — non-sensitive, so it needs no Google security
assessment, and Leaflet can only see files it created. The OAuth client can come
from a build flag, the environment, or **Settings**, so Drive works without a
rebuild.

Details that matter: `uploadType=media` for the document (no multipart envelope
to get wrong), resumable chunked upload for book files, `If-Match` on the
document's revision so a concurrent write conflicts instead of clobbering,
pagination through `nextPageToken`, and typed errors for 401 / 403 / 429 instead
of feeding an error body to the JSON decoder.

---

## Accounts

**Where:** `server/` (API), `sync/cloud.rs` and the `account_*` commands (Rust),
`services/accountService.ts`, `store/accountStore.ts`, the Account card in
Settings.

Optional email and password accounts on PaperKite's server, behind
`FEATURES.accounts`. Nothing in the app requires one; they exist for
leaderboards now and for one identity across devices when the mobile app ships.

- Passwords: scrypt with a random salt, compared in constant time. Login errors
  do not reveal whether an email exists.
- Sessions: a random token returned once; the server stores only its SHA-256,
  expiring 90 days after last use. On the device the token lives in Windows
  Credential Manager, never in SQLite or `localStorage`.
- Avatars: signing up means picking a Pip (a skin plus a signature move, stored
  as `skin.move`, e.g. `wizard.magic`) from the catalogue in `pip/avatars.ts`,
  preselected at random; the You card on Social → Community swaps it later, and
  "Use my Pip" on the Pip tab sets the reader's own dressed-up Pip (see
  [the profile picture](#the-profile-picture)).
  The server checks ids against its own copy (`server/src/avatars.js`, kept in
  step by a test) and never offers earned skins (Champ, Golden, Prism). Boards
  hold avatars still and play the move on hover; the reader card plays it.
  Accounts from before avatars show Pip in a skin picked from their handle.
- Deleting the account (Settings, with the password) removes the account,
  profile, synced state, sessions and community data at once.
- The server never receives Google or Drive credentials.
- **Forgot password?** on the sign-in card emails an eight-character code
  (`ABCD-EFGH`) that sets a new password, signs every device out and this one
  in. Codes are stored hashed, last 15 minutes, allow five wrong tries and work
  once; the request answers the same whether or not the address has an
  account. Three completed resets per account in any 365 days; past that the
  email explains the limit and the date instead of carrying a code. The email is sent by a Google Apps Script web app from the owner's
  Gmail (`server/deploy/password-reset-mailer.gs`, about 100 a day, free); the
  server holds only a shared secret for it (`server/src/mail.js`).
- Not yet: email verification.

An earlier version had a sign-in modal that accepted any email, verified
nothing, and stored the result in `localStorage`, plus a "premium" flag anyone
could flip in devtools. Both are long gone.

### Finding the server

The app reads a signed `config.json` from GitHub Pages to learn the API address,
verifies it with a public key compiled into `sync/remote_config.rs`, and keeps
the last good address if the file is missing or tampered with. See
[release-msix.md](release-msix.md).

---

## Pip

The reading companion who lives in the app: the header logo is Pip's home, and
Pip hops out to walk the app, celebrate goals, give the tour, and be thrown
around. It has its own tab too: see [Seeds and the Pip tab](#seeds-and-the-pip-tab).
Everything else is in [pip.md](pip.md).

---

## Appearance

Light by default. Dark, or following Windows, is the reader's choice in
Settings. A blocking script in `index.html` sets `data-theme` before first paint
so there is no flash, and mirrors the rule in `store/appearanceStore.ts`.

Colours are design tokens in `index.css` as space-separated RGB triples
(`rgb(var(--color-primary) / 0.4)`), mapped into Tailwind in
`tailwind.config.cjs`. `:root` is light; `:root[data-theme="dark"]` overrides.

The reader has its own finishes on top: paper, dark paper, true white, true black.

---

## Responsive layout

One layout, not a desktop build and a mobile build.

The decision that shapes it: **a landscape phone is wider than the `md`
breakpoint** (844×390 on an iPhone 14), so width alone dresses it as a tablet and
then starves it vertically. Custom breakpoints carry the missing dimension:

```js
short: { raw: "(max-height: 520px)" }
tall:  { raw: "(min-height: 521px)" }
touch: { raw: "(hover: none) and (pointer: coarse)" }
```

| Viewport | Navigation | Header |
| --- | --- | --- |
| Phone, upright | Bottom tab bar | Wordmark + sync badge; search lives on the Library page |
| Phone, landscape | Sidebar rail — a bottom bar would cost scarce height | Compressed to ~56 px |
| Tablet / desktop | Sidebar rail | Full, with search |

Also: safe-area insets for notches, 44 px minimum touch targets, `100dvh` for the
shell (a definite height — `min-height` gives `flex-1` no free space to divide,
which moves scrolling from the main column to the whole page), and the app header
auto-hides on scroll **on small viewports only**.
