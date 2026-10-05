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

Re-importing the same file is a no-op: the hash is the primary key. The one
exception: a book the library lists but has no file for (restored from a
backup, never downloaded) takes its bytes from the file being opened.

Reading never depends on the original file, for any format: `local_path` is the
library's own copy, and a Calibre format is converted from that copy.

An empty file or a folder is refused in plain words (an empty file used to
import as a book that would not open, and every later empty file was "that
book"). Two imports of one file at once are taken in turn, a staging file left
by an interrupted import no longer blocks the book, and a book fetched from
the sync folder is staged and renamed like any other, so an interrupted copy
is never taken for the book.

**Delete All Data** (Settings, About) removes the library, covers, history and
settings, vacuums the database (deleted rows used to stay readable in the
file), removes the copies of the database made before upgrades
(`library.db.bak-v*`), forgets what the webview kept about each book (its
place, bookmarks and reader settings: `services/deviceData.ts`) and signs the
device out. It keeps the signed server address. Left as they are: a Drive
backup, a sync folder's contents, the book copies folder, the Leaflet account
on the server, Calibre, `logs/` and any `library.db.broken-*` set aside by a
failed start. "Confirm Delete" disarms after eight seconds.

**Book copies** (Settings, off by default; `storage/library_copy.rs`,
`commands/library_copy.rs`, `components/LibraryCopyCard.tsx`). Each book added
to the library, by any route, is also saved as `Title - Author.ext` in a folder
the reader chooses, and "Copy My Library There Now" does the same for the
books already there. It is a second copy with a name a person can read, for
other apps and for peace of mind. Names are made safe for Windows, a file is
never overwritten (the same book, by hash, counts as already there; a different
one with the same name gets `(2)`), and Leaflet never deletes a copy. Copies
are made in the background after the import, so a missing folder or an
unplugged drive never blocks importing or reading; the card shows what went
wrong. A book already in the folder under any name (the same contents)
counts as already there, so picking the folder the books came from does not
double them; names shrink in a deep folder so the whole path stays within 259
characters; a run stops between books if copies are switched off or the folder
changes; a book removed before its copy is made is skipped. The folder is a setting of this device (`library_copy_*` in the
`settings` table) and is never in the sync document or the backup. Folders
under AppData are refused: Windows redirects a packaged app's writes there
into the package.

**Metadata enrichment** (`metadata/`) fills in missing title, author, genres and
cover from **Open Library**, falling back to **Wikipedia**. Titles are normalised
first (`metadata/normalize.rs`) because filenames from the wild carry ISBNs and
site names. Results are cached with a `metadata_checked_at` stamp and a **14-day
cooldown** — some books simply have no match upstream, and without the cooldown
the app re-queried them on every launch forever.

**What a book is called** (`metadata/normalize.rs`, `identify`). The title,
author, series and genres come from what the file says about itself (an EPUB's
package, a Kindle book's header: `storage/epub.rs`, `storage/mobi.rs`) and,
failing that, from its file's name. Both are tidied by rule: a site's tag and
the author come off a Z-Library name, the first two fields are taken from an
Anna's Archive name, a title that is a catalogue's file name ("Author - Series
02 - Title") is read as one, "(Series, Book 1)" moves to the series, "Last,
First" is turned round, several writers are joined with "&" (translators,
editors and illustrators are skipped by role), and a site's name or "Unknown"
is nobody. A real title is left whole (18 shapes tested: brackets, dashes,
numbers, a colon, "(2nd Edition)"). A catalogue's title replaces a file-name
title only when the words agree ("Dune" is not renamed by "Dune Messiah").
Readers cannot edit a title, so `scan_series` (version 2) reads every book
already in the library again, once. Checked against the owner's 19 real files
with an ignored test that skips where the folder is absent
(`cargo test --lib real_library -- --ignored --nocapture`): 8 were named
wrongly, none now.

**Genres** are the book's own subjects (codes, catalogue tags and site names
dropped, eight at most); a lookup adds to them and is made only for a book with
no genres, cover or author. The Open Library search asks for `subject` by name:
it stopped sending it unasked, so for a time no book had a genre, the genre
filter was empty, Pip's genre moods never fired, and every book was looked up
again each 14 days. Initials are dropped from the author in a query ("Daniel
L. Everett" found nothing).

**A file that is not what its name says** (a PDF named .epub, a sign-in page
saved as a book) is refused at import in words that say what it is; a file
another program holds open, or one that has gone, is explained rather than
shown as a system error.

**A PDF's own title and author** are read at import (`storage/pdf.rs`, no new
dependency): the Info dictionary, or XMP where that is empty, found through
the file's cross-reference tables without reading the file (0.8 ms for a
small one; an encrypted or damaged file gives nothing, and the tests cut a
file at every byte). It is the word of whatever program made the file, so it
is believed only when it reads like a title (not "Microsoft Word - ...",
"untitled", "Slide 1", a file name or a path) and, where the file's name is
clearly a title, shares a word with it. The file name's author comes first;
the PDF's fills a gap unless it is an account's or a program's name
("Administrator", "Adobe Acrobat 7.0"). For a book already in the library
(`scan_series` version 3) the PDF's title is taken only where it is the
stored one written properly, as when a site's file name lost a colon.

**A PDF with no cover takes its first page** (`readers/pageCover.ts`,
`save_page_cover`): drawn once, 600 px wide, 2.5 s after the book is first
opened once a lookup has had its turn, saved as every cover is (a real image,
the thumbnail made) and never in place of one. A blank first page is not
used. A cover that exists is always kept, so a lookup that succeeds later
does not replace a first page.

**The import dialog says what happened**, as a drop does
(`import_books_report`, `library/importSummary.ts`): how many books were
added, which were already in the library by title, and each file that was not
added by name with why (two named, the rest counted). A drop hands over every
file, so a picture among the books is named instead of vanishing. A toast
stays up for as long as its length needs (`toastMs`: as before to 45
characters, then 55 ms a character, 14 s at most).

Known and left: the same book in two formats is two books with separate
progress, listed under "Possible duplicates" and counted once in its series;
a PDF's subject and keywords are not read as genres.

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

**In Settings** (`components/ConverterCard.tsx`) the card always offers
something to do when Calibre is missing: **Get Calibre** opens
calibre-ebook.com/download in the browser, and **Check Again** looks for it
(as does coming back to the window), so installing it needs no restart. Windows
builds from outside the Store also keep **Install It for Me**, the in-app
portable install; the Store build cannot download and run an installer, and
used to show no action at all. The prompt on opening a book that needs
Calibre follows the same rule: "Download & install" only where the build may
install it, "Get Calibre" elsewhere.

**It is compiled out of mobile builds entirely** — there is no Calibre for
Android, and the download-and-unpack path cannot run there. The Settings card and
the open-book prompt both say so rather than offering a dead-end install. A
Calibre-only format opened once on a desktop syncs to a phone as a normal EPUB,
because the conversion is cached by hash.

A Kindle book's title, authors and cover are read from its header at import,
without Calibre (`storage/mobi.rs`). One locked to an account (DRM) says so
when opened instead of asking for Calibre first. Converting the owner's three
Kindle files was not tried: Calibre is not installed on the build machine.

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
and pacing, page turns (`pageTurn.ts`), the notes panel, search and the
selection bar.

**Where its own code lives.** Until 2026-10-05 the reader was one component
of 9,000 lines. The page file is now a list of hook calls round a frame of
JSX (about 150 lines); its state and behaviour are in `src/readers/text/`, a
file a concern:

| File | What it holds |
| --- | --- |
| `useReaderCore.ts` | The page's elements, the book and its rendition, the reading mode, what was saved with the book, the toast |
| `useReaderLook.ts` | Type size and face, line length, scrolling or pages, page colours; putting them into the book's documents (and the effects for a change of theme and of type) |
| `useReaderScroll.ts` | The scrolling window: finding it, moving it, asking for the next chapter (and the effect that watches it) |
| `useReaderPlace.ts` | The reading line, the saved place, a page's place in the pages layout, going to a place (and the relayout on resize) |
| `useReaderPrefs.ts` | What is saved with the book on this device |
| `useReaderWords.ts` | The words on the page, indexed for Dotty, Smart Read and SpeedRead |
| `useReaderDot.ts` | Dotty, and the mark on the last line read |
| `useReadingPace.ts` | The reader's pace: learning it, keeping it |
| `useAutoScroll.ts` | Auto-scroll and its engine |
| `useSmartRead.ts` | Smart Read's pace and the reader's say in it |
| `useReadingModes.ts` | Asking for and starting Smart Read and SpeedRead; the engine that runs them word by word; what hands-free reading waits on |
| `useChapters.ts` | The contents as places; chapters, edges, the progress bar, back and forward |
| `useReaderOutlook.ts` | The chapter being read, how far through, how long left |
| `useContentsList.ts` | The chapter list: pinned, peeking, showing itself once |
| `usePageTurning.ts` | Turning pages, and the pages layout's own clicks, drags and wheel |
| `useReaderMarks.ts` | Bookmarks, highlights, the selection, search |
| `useNotesAndPictures.ts` | Footnotes shown in place, pictures opened large |
| `useReaderPanels.ts` | The type panel, the ··· menu, the shortcuts sheet, the walkthrough |
| `useReaderKeys.ts` | The key handler, and what Escape closes first |
| `useReaderSession.ts` | The focus session: progress, checkpoints, leaving mid-session |
| `useReaderChrome.ts` | The toolbar hiding itself; the characters feature's hook |
| `useReaderCover.ts` | The cover |
| `useReaderLifecycle.ts` | Closing the reader; another book in the same reader |
| `useBookOpening.ts` | The book-opening effect: one effect of 1,300 lines, as it always was |
| `ReaderToolbar.tsx`, `ReaderMoreMenu.tsx`, `ReaderContentsPanel.tsx`, `ReaderPage.tsx`, `SpeedReadStage.tsx`, `ReaderDialogs.tsx`, `ReaderSessionMarks.tsx`, `ReaderPaceControls.tsx` | What is drawn. They take the scope and hold no state |
| `scope.ts`, `constants.ts` | The scope's types; a constant two files share |

The split moved code and changed none: the same statements, in files. What
holds them together, and has to be kept:

- **One scope a render.** `ReaderView` makes a plain object, `reader`, on
  every render. Each hook takes what it needs out of it at the top, and adds
  what it owns (`Object.assign(reader, useX(reader))`); a hook returns only
  what another file uses. Made afresh each render, it gives a function or an
  effect the values of the render that made it, as the one closure did.
- **Two blocks of hooks, and the second has an order.** The first block
  declares (refs, state, functions) and runs no effects, so its order is free
  apart from what a hook reads while rendering. The second holds every effect
  and is called in the order those effects have always run: effects run in
  the order they are declared, and the reader leans on it. Do not reorder it;
  a new effect goes where it should run among the others. (A subscription to
  a store, `useLibraryStore` and its kind, is not an effect in this sense and
  sits with the declarations.)
- **Reaching a hook called later.** The parts call each other in circles (the
  word index moves Dotty, Dotty asks the word index where a word is), so a
  hook may use what a later hook adds, but only inside something that runs
  later: an effect, a handler, a function. It is written `reader.name` where
  it is used, never taken out at the top, with the name in the hook's
  `Later<...>` and its type in `ReaderLater` (`scope.ts`). TypeScript checks
  the type where `ReaderView` hands the scope over. Nothing checks that the
  read is late: `reader.name` while rendering is `undefined`. There are 25
  such names.
- **Where a new thing goes.** In the hook whose concern it is; into that
  hook's `return` only if another file needs it.

How the split was checked is in [testing.md](testing.md) ("Checking a move of
the text reader's code").

**Scrolling is one continuous book** (epub.js's `continuous` manager, flow
`scrolled`). The chapters follow each other down the page: the next one is
fetched as its neighbour's end comes within 500 px, the one before as its top
does, and chapters left far behind are let go (their place is kept until
trimmed, and the scroll position is corrected so the text never moves). It
used to be a chapter at a time, swapped for the next the moment its last line
reached the bottom of the window, before that line had been read. The chapter
list, the dock's arrows and Left/Right now jump within the one scroll, like
bookmarks; Down at the end just fetches more. What this needs:

- **Words are found again by identity.** Smart Read, a pinned Dotty and the
  pace trackers number the words on the page, and those numbers change
  whenever a chapter loads or leaves above. `prepareReaderWords` finds the word
  being read again by its text node, not by proportion; `readerWordsStale`
  notices when a chapter has gone; the free-reading tracker counts within a
  chapter (`sectionSpan`).
- **A place is resolved in its own chapter** (`contentsForCfi`): asked of the
  wrong chapter, a CFI lands on an unrelated line rather than nowhere.
- **epub.js is told where the page is** before it decides what to fetch (its
  `check` is wrapped): it reads a scroll position remembered from the last
  scroll event, a frame late, and just after a chapter loaded in above it
  fetched the one before that too.
- **The opening size is not re-sent.** epub.js measures the scrolling layout a
  scrollbar narrower than the viewer; telling it the viewer's size again made
  it clear the page before any place was known to restore, and the book
  opened blank.
- `overflow-anchor: none` on the scroller: epub.js corrects the scroll
  position itself, and the browser doing so too would move the text twice.
- **A chapter is measured again once it is dressed.** epub.js sizes a
  chapter's frame before the theme and the reader's stylesheet go in, and they
  make it two to three times as long; it then went to the place asked for
  before measuring again. A saved place, bookmark, highlight or search result
  deep in a chapter opened at the wrong line (and that wrong line was saved
  back), or on a blank page. The content hook now ends with `view.expand()`,
  and the line-length easing applies only once a chapter has settled
  (`data-leaflet-settled`), so chapters do not reflow for a quarter of a
  second after the place has been gone to.
- **What leaves with a chapter**: a `MutationObserver` on the scroller lets a
  text selection go with the chapter it was in (the bar used to stay, holding
  hands-free reading), and tucks Dotty away when the chapters under it have
  left (it used to hold thousands of pixels of blank page open below a short
  chapter).
- Sections marked `linear="no"` (a cover, often) lead on to the reading order
  around them; epub.js gives them no next or previous, which made them dead
  ends.
- After a resize, when epub.js draws the chapters afresh, the word being read
  is found by its place in its chapter (`readers/wordPlace.ts`).

**Links, not anchors, take the accent.** On a dark page links are coloured by
`a:any-link`. It used to be every `a`: books mark page breaks with empty
anchors (`<a id="page12"/>`), epub.js parses `.html` chapters as HTML, where
such an anchor never closes, and the browser then wraps the rest of the
paragraph in it. Every paragraph holding a page break came out green.

**Progress** is by how much of the book is behind the reader: each section
weighs its size in the EPUB (Rust reads the sizes from the archive's directory,
`epub_sections`), and chapter titles only mark where front and back matter
end, when they frame the story. See `readers/progress.ts` and its tests.

**Pages.** epub.js lays a chapter out as columns on the body and slides the
frame a page at a time. Everything that forces a full width (the page CSS, the
`.reader-scroll` rules, `applyReaderInsets`, the overflow clamps) is for
scrolling only; with any of it applied, every chapter becomes one page. Arrow
keys, Page Up/Down and Space turn pages; the dock's arrows become previous and
next page, with the chapter before and the chapter after either side of them.
Ctrl+Left and Ctrl+Right go a chapter back or on in every layout (the plain
arrows already do when scrolling). Auto-scroll, Smart Read, SpeedRead and Dotty are built on scrolling,
so they are off with pages.

**Turning a page** (`turnPage`, `readers/pageTurn.ts`). The page to turn to is
counted from the chapter's columns, and the turn goes to that page's exact
place. epub.js's own `next` adds a page's width to wherever the scroll position
is and first asks whether a whole further page fits; on a display scaled to
125% or 150% the position drifts a fraction of a pixel a turn, the test fails a
page early, and the last page of a chapter was skipped. Within a chapter the
page slides across (280 ms, eased; the place is reported once it has arrived);
into another chapter the new page comes in from the side it was turned from
(`data-turn` on the viewer). A turn made mid-slide starts from where that one
was going. Neither animates under `prefers-reduced-motion`.

Confirmed in the preview at 150% scaling with a page 647 px wide: epub.js's
own `next` skipped the last page of all six chapters tried, the position
having drifted 6 px after 24 turns; with an even page width it did not, which
is why it was only "sometimes". The same walks through `turnPage` (window and
in-book key presses, Page Down, Space, the dock) showed every page once. A
held key turns a page every 150 ms (`keyTurns`), as the page reader does: it
used to turn one on every repeat, about thirty a second, so a press held a
moment too long turned two. Turns made while another chapter is loading are
dropped, a slide stops if its chapter is swapped under it, and `+` / `-` do
nothing with pages.

What the bug pass of 1.2 settled with pages, each measured at 150% scaling
with odd and even page widths (`readers/pageTurn.ts`, `readers/pagesStyle.ts`):

- **The page's number** is counted from where the frame is (`pageAt`), not
  taken from epub.js, which rounds the scroll position down: on a scaled
  display the last page of a chapter read as the one before it, and the
  story's last page never counted as its end. The dock says 100% on that
  page, a one-page last chapter included.
- **The place is held across layouts** (`pagePlaceRef`): the first word of the
  page the reader turned to. A resize, a new type size or a new line length
  shows the page holding it. Each layout used to start from its own page's
  first word, which is at or before the last one: three pages back over ten
  changes of type size, two over eight window widths.
- **The frame stays on a whole page.** When the browser moves it (focus on a
  link on another page, a selection dragged past the edge) it is put back on
  the nearer page once it rests (`strayPageTarget`); it used to be left
  showing two half pages.
- **A turn takes the page's selection and footnote popup with it**, and
  measures the chapter's frame again before leaving it, so text that grew
  late (a font arriving) is not passed over.
- **The foot of a page**: text stops 56 px up, above the chapter dock (the
  last line of four pages in ten used to run behind it); a picture is no
  taller than the page's room (a cover was cut at the foot); a heading is kept
  with what follows. It costs about a line a page.
- **Right-to-left books** turn with the same counting from the other end,
  without the slide; they could not leave their first page. epub.js still
  adds one blank page at the end of each such chapter.
- A chapter turn that never arrives no longer leaves the page hidden (the
  same 4 s limit as a dropped turn).
- **The wheel and the trackpad turn pages**, one page for a gesture
  (`wheelTurn`): the first wheel event turns the page and the rest are passed
  over until the wheel has been quiet for 250 ms, so a trackpad's inertia or a
  long spin turns one page, not ten. Down or right goes on, up or left goes
  back (in a right-to-left book too). A reversal inside the quiet window is
  passed over as well. Not with Ctrl held, nor over anything that scrolls by
  itself, nor with a dialog open. It used to do nothing.
- **The dock says which page** of the chapter is showing ("12 of 50"), counted
  from the frame's position; the chapter's name gives way to it on a narrow
  window.
- **What is wider than the column wraps** with pages (table cells, lines of
  code): it used to run on across the next page. The cause was the theme's
  camelCase keys (`overflowX`, `whiteSpace`), which epub.js writes out as they
  are, so they never applied.

- **A click at the side of the page turns it** (`clickZone`, `pressIsClick`):
  the outer sixth each side and the gutter beside the page; right goes on,
  left goes back. Only a click that is nothing else: not a drag, a long press
  or a selection, not with a modifier, not on a link, a note reference, a
  picture, a marked name, a highlight or a control, and not while anything is
  open over the page. In the margin it turns at once; on text it waits 220
  ms, so a double-click still selects the word.
- **A swipe turns it too** on a touch screen or with a pen (`swipeTurn`): 48
  px or more, twice as far across as down, within half a second, one finger.
- **One press made while a chapter is arriving is kept** and made when it is
  up, so two presses at a chapter's end are two pages; more are dropped, as
  are a held key's repeats.
- **Home and End** go to the first and last page of the chapter with pages,
  **Ctrl+Home and Ctrl+End** to the book's; Back returns.
- **In a right-to-left book** the pages run the other way: the left side of
  the page, the Left arrow and a swipe to the right go on; Space and Page Down
  always do. The dock's arrows and the shortcuts sheet are not mirrored.

Known and left: a book last read in Smart Read stays in standard reading
after a visit to pages; the book's time left can step up by one rounding
step on turning into a new chapter (the words-per-byte estimate is refined as
chapters are counted).

**Search** (the magnifier, or Ctrl+F): every section in reading order, loaded,
searched with epub.js's `find` and unloaded, one at a time. Results arrive
section by section under their chapter; choosing one jumps there and marks
the words for a few seconds. `readers/searchBook.ts`, `readers/SearchPanel.tsx`.

**Openings.** A book's drop caps, raised initials and opening small capitals
are kept (`readers/dropCaps.ts`): found from the publisher's own styles before
the reader's stylesheet goes in (an inline element of one to three characters
at the start of a paragraph that is 1.4 times its paragraph or more, floated,
or named for it), marked (`data-leaflet-dropcap`, `data-leaflet-smallcaps`),
left out of the one-size and one-spacing rules, and sized as a multiple of the
reading size. `::first-letter` caps were never affected. A cap and the rest of
its word are one word to Smart Read and SpeedRead (`isInlineJoin`).

**Time left.** The chapter dock (`readers/ChapterDock.tsx`) shows the
percentage, and under the pointer, with focus or when the percentage is
pressed, the time left in the chapter and the book at the reader's pace for
this book (`readers/timeLeft.ts`): words counted in the chapters on the page,
the rest estimated from section sizes (the words-per-byte ratio is remembered
per book in `leaflet.reader.<id>`); rounded in spoken steps and held steady as
chapters load; silent until there is a pace. Section sizes fall back to
epub.js's own copy of the archive directory (`readers/archiveSections.ts`)
when the backend gives none, as in the browser preview.

**Back.** After a jump (a link, the chapter list, next/previous chapter, a
search result, a bookmark or highlight, the progress bar) the dock offers Back,
and Forward after it (Alt+Left / Alt+Right; `readers/jumpHistory.ts`, 20
places, this visit only). Scrolling and page turns add nothing. The place kept
is the first line clear of the toolbar (`readers/readingPlace.ts`). In-book
links go through the reader's own jump, not epub.js's handler. With pages, a
place is shown on the page holding its first word (`settleOnPage`): a place at
a page that starts mid-paragraph used to come back one page early.

**Footnotes.** A note reference shows its note in a popup above the chapter
dock instead of leaving the page (`readers/footnotes.ts`, `NotePopover.tsx`):
marked references (`noteref`, `doc-noteref`), links to marked notes, and
unmarked superscript or bracketed numbers that lead to the start of a small
block (1,500 characters or fewer). The note is read from its chapter (through
epub.js when it is in another file) as plain text with italics and bold; the
book's HTML is never put in the app. Long notes are cut at 700 characters;
**Go to note** jumps, and Back returns. Backlinks and every other link stay
jumps. The popup shares the selection bar's dock, and counts as an
interruption to hands-free reading.

**Pictures.** A click on a picture opens it large (`readers/ImageViewer.tsx`,
geometry in `imageZoom.ts`): fitted, zoomed with the wheel about the pointer,
a pinch or + and -, dragged or moved with the arrows, closed with Escape or a
click beside it, always as drawn. Ornaments under 48 px and pictures that are
links do not open. The viewer holds "Show as drawn" / "Blend with page" for
ink pictures (it used to be the click itself), applied to every copy of that
picture on the page.

**The progress bar** (`readers/ProgressBar.tsx`, `seek.ts`) runs along the
bottom edge and shows with the chapter dock. Dragging names the chapter and
percentage under the handle; letting go goes there by the section weights.
Arrows move 1%, Page Up/Down 10%, Home/End the ends; a burst of keys is one
jump. It is a jump: Back returns. The dock's percentage comes from the reading
line and the same weights, so the handle sits where the jump went.

**Keys.** `?` (or ··· → Keyboard shortcuts) shows the reader's keys for the
layout and mode in use (`readers/ShortcutsSheet.tsx`). The sheet and the key
handler read one table (`readers/readerKeys.ts`), so they cannot disagree. B
or Ctrl+D bookmarks the line under the toolbar. Space and Enter press a button
the keyboard is on, and arrows move a focused slider; a button only clicked
with the mouse leaves Space to reading.

**Escape** closes the nearest thing (`readers/escapeOrder.ts`, with tests): a
picture, the shortcuts sheet, the start dialog, the walkthrough, a held
progress-bar handle, a character's card, the look-up card, a footnote, search,
the type panel, the notes, the ··· menu, the characters panel, the chapter
list; then lets a selection go; then leaves SpeedRead or stops auto-scroll /
pauses Smart Read; and only then leaves the book. One press, one thing; a held
key stops at the first.

**Outside the story.** Front matter and back matter do not move progress or
the saved place unless that is where the reading is (the very start; after the
end) (`outsideStory` in `readers/progress.ts`). Opening the map from chapter
20 used to save 0%.

**The place saved** is the reading line, the first line clear of the toolbar
(`readers/readingPlace.ts`), so open, close, open lands on the same line; it
used to creep back about 70 px each time. A type change keeps that same line
(it used to drift about 47 px over ten changes; it then drifted again, a line
a change, 80 to 177 px over six, because each change re-anchored on the first
word of a line that the change before had left mid-line: the line anchored by
one change is now used again by the next while it is still where it was put,
79.8 to 80.3 px over eight changes). With pages a restored place
is shown on the page holding its first word.

What the bug pass of 1.2 settled when scrolling, each measured before and
after (`readers/lineAt.ts`, `glide.ts`, `toc.ts`, `smartScroll.ts`,
`readingPlace.ts`):

- **The reader's own scrolls keep to the text** (`readers/glide.ts`): an arrow
  key, a Page key and Smart Read's page step count from wherever the page is
  each frame. Counting from where they began undid epub.js's correction when a
  chapter was let go above, and threw the text a chapter's height on (949 to
  1,061 px, reproduced with taps 300 to 520 ms apart near a chapter's start).
  This is very likely the "it skips lines at chapter ends" the owner saw.
- **The place saved** is the first word of the first line at or below the
  reading line (`firstAtLine`), with how far below the line it started
  (`cfiBelow`), so a reopened book has the line where it was left. epub.js's
  own answer named the space before the word, or the start of its text node:
  at about a third of scroll positions the place came back one to six lines
  early (32 to 191 px), for a reopen, Back, a bookmark and the type-size
  anchor alike.
- **A place gone to is put by where it is now** (`clearToolbar(cfi)`), once the
  next chapter is on the page: a place in a chapter's last screenful used to
  land most of a screen early (a book closed at a chapter's end came back 394
  px off; also Back, a bookmark, a search result, the progress bar's 100%).
- **The end of the book** has half a window of room below its last line
  (`applyEndRoom`), so the last line can be read above the dock (it sat at the
  very bottom edge, under it). The book is read when the story's last line is
  on screen (`endInView`), however short its last chapter (one shorter than
  the window stopped at 95%); scrolling, progress goes by the reading line, so
  the dock and the library agree.
- **The dock names the contents entry under the reading line** (`readers/toc.ts`),
  whatever it is called, by anchor when a file holds several; the chapter list
  marks the same row; the book's title before the first entry. It used to
  name only entries called Chapter, Book, Section, Prologue or Epilogue, with
  a count stuck on ("PROLOGUE 1"), and stay on "CHAPTER 1" through a run of
  short sections. Next and previous chapter go from that chapter.
- **Keys, scrolling.** Page Down and Page Up move a screen less the toolbar's
  strip and two lines, whatever has the focus (they were left to the browser,
  and worked only with the focus in the text); Home and End go to the start
  and end of the chapter, Ctrl+Home and Ctrl+End of the book (jumps: Back
  returns).
- **A very long chapter.** When the page holds more words than the index
  (90,000), they are taken from a screen above the window, so Smart Read and
  SpeedRead work anywhere in it. Past word 90,000 Smart Read used to drag the
  page back 20,000 px and announce the end of the book.
- **A resize** lays the page out round the reading line and puts it back there.
- **The selection bar** goes just above words it would lie on (`placeBar` in
  `lookupPlacement.ts`), in both layouts.
- **Leaving a book while it is still opening** no longer shows "Something went
  wrong": the cleanup's `destroy()` calls are guarded.
- **Themes.** epub.js writes theme keys as given, so the camelCase ones never
  applied. `hr`, `table`, `pre` and `code` are now spelt as CSS: a rule shows
  as a hairline (it was invisible), a wide table scrolls inside its own box
  (its far cells could not be reached), long code wraps. The other camelCase
  keys (a hairline above `h1` / `h2`, a gap under `li`) are left inert on
  purpose: switching them on would change how every book looks.

- **The scrollbar, held** (`readers/scrollbarHold.ts`, a pure state machine
  with tests). While the scrollbar is pressed and the page is scrolling under
  it, chapters on the page are shown and hidden but none is fetched or taken
  away (epub.js's `check` and `trim` are held); fetching goes on when it is
  let go, or by itself once the page has been still for 1.5 s, because
  browsers do not always report the release. A wheel, a key or a press in the
  text ends a hold. Held at the bottom, the thumb used to fetch chapter after
  chapter: 17 in 5 seconds, the reader carried from 29% to 66%. The press is
  told from `clientX` against the container's box.
- **Finished means the end was reached** (`progressToSave` in `progress.ts`).
  Until the story's last line is on screen (scrolling) or its last section's
  last page is showing (pages), the progress saved stops at 98.5%, however
  little is left by weight: Mistborn's epilogue used to pass 99% some eleven
  screens before its end. A finished book stays finished while the reader is
  back among its last pages; going further back un-finishes it, as before.
- **Back** returns a line to the height it was left at, not to the reading
  line.
- **A picture in Smart Read.** At a picture, or any stretch with no words
  taller than half the window, Dotty rests beside it and the control says "A
  picture · Space to go on"; Space, the play button or scrolling past it
  carries on. It used to go past in one step. Auto-scroll glides over a
  picture at its set pace, as before.
- Leaving SpeedRead or Smart Read leaves Dotty on the last word read for a
  minute.
- **A sentence ends before speech too** (`said. “I will`), and when closed by
  a single quote (`SENTENCE_END_PATTERN`): 171 of the 1,169 sentence ends in
  one chapter of a novel had no pause in Smart Read or SpeedRead. A
  footnote's marker is not read as part of the word before it. The first
  moves a chapter's difficulty estimate slightly (0.992 to 0.972 there), so
  its predicted pace rises about 2%.

Known and left: a selection cannot cross a chapter boundary (separate
documents). Progress follows the reader backwards when they go back to
re-read. A resize during Smart Read can put the place one word back. In
SpeedRead a web address goes by in pieces, and an opening quote is shown at
the end of the word before it.

**Highlights, notes and bookmarks.** Selecting text offers four highlight
colours, a highlight with a note, or copy (`readers/SelectionBar.tsx`). The bar
sits above the chapter dock, and above auto-scroll's or Smart Read's controls
when they are showing: it used to sit in exactly their place, underneath them,
so in Smart Read (which most books open in) a selection could not be
highlighted. A selection let go by clicking elsewhere in the text takes the bar
with it (`selectionchange` in the book's documents).
Highlights are drawn by epub.js's annotation layer and open their note when
tapped. The notes panel (the bookmark icon) lists bookmarks and highlights in
reading order, opens or removes each, and copies every highlight and note as
Markdown; a toast says where a new highlight went.

**Look up** (the book-with-a-letter button on the selection bar). A selected
word or short phrase (six words, 80 characters; a longer selection is refused
before anything is sent) is looked up in one call, `lookup_term`: its meaning
from Wiktionary and a short summary from Wikipedia, both at once, 7 seconds
each. It goes through Rust (`src-tauri/src/lookup/`) because the release
build's Content-Security-Policy keeps the webview off the internet. Only the
English Wiktionary answers the definitions API, so meanings come from there,
from the section for the book's language or else English; the summary comes
from the Wikipedia in the book's language, then the English one. A word is
tried as selected, lower-cased, without a possessive and without a plural
ending, and a form ("houses", "ran") is followed one hop so its root's meaning
shows too. Definitions arrive as HTML and leave Rust as plain text. A name, a
capitalised word or a phrase leads with the summary, a plain word with its
meaning (so a capitalised common word at the start of a sentence gets the
name's entry: lower-casing first would break "German" and "Polish"). A
disambiguation page is reported as ambiguous with a link. Finding nothing is
an answer (with "Search the web"); an error means neither source could be
asked, and one source failing does not hide the other. The card
(`readers/LookupCard.tsx`, `readers/lookupPlacement.ts`) is a dialog above the
selection bar, in the bar's own dock (beside it, **Search in this book** opens
search on the selected words), a fixed height so nothing jumps when the answer arrives, kept
off the selected words where there is room; Escape or a click elsewhere closes
it. Answers are cached in memory for the session. What is sent is the selected
words and nothing else; the card says so the first time it is used on a
device, and behind its "i" after that. Every call Leaflet makes to Wikipedia,
Wiktionary and Open Library names the app (`src-tauri/src/http.rs`), as their
API policy asks; the cover look-ups used to send no name.

**Highlights outside the reader** (`components/highlights/`). The Library's
**Highlights** button lists every book that has highlights, with a count
(`annotations_highlight_counts`), and a book's menu has a **Highlights** item
for that book alone. A book's highlights are shown in reading order under their
chapters, each with its colour, full text, note and date, and a second tab
lists its bookmarks. **Open in book** opens the book at that place (the
reader's `openAt`; the next ordinary open resumes where the reading stopped),
**Copy** copies one, **Copy all as Markdown** the lot, and **Remove** deletes
one at once, with Undo. PDFs and comics cannot be highlighted and have no item.
A highlight whose place cannot be read (one damaged CFI used to scramble the
order of all the rest) is listed last, oldest first; chapter labels are
compared with their whitespace collapsed, here and in the Markdown export,
which also escapes a highlighted line that starts like a heading, a list item,
a quote or a rule. A book opened at a highlight is a look for its first two
minutes (`readers/openAt.ts`): the saved place and the progress do not move,
so the next ordinary open resumes where the reading stopped. Search results,
bookmarks and highlights open 80 px down, clear of the toolbar, and one mark
is drawn per place (`readers/highlightDraws.ts`): two highlights of exactly
the same words used to leave a mark that could not be removed.

**Words looked up are kept** (`readers/words/`, `services/wordService.ts`,
`commands/words.rs`). A look-up that gets an answer keeps the word (in its
dictionary form), the first meaning shown, the book and the place; the card's
foot says so and has "Don't keep". Looked up again, the same row counts it and
moves to the new place. Settings → Reading → "Keep the words I look up" (on
by default) stops it; words already kept stay until removed. Nothing more is
sent anywhere: the look-up itself is unchanged. The words feed the Arcade's
Word Quiz and Pip's diary.

**The radio** (`apps/src/ambience/`). Rain, a fireplace, a cafe, wind, waves or
plain brown noise behind the page. It is turned on from a reader's ··· menu
(Sound) or from the radio in Pip's room; it plays while a book is open in
either reader, stops when the book is left, and rests while Leaflet is hidden
(after 2 seconds) or another window has the keyboard (after 15), coming back
by itself. While it is on, a small mark on the reader's toolbar opens its
controls: the scene, the volume, off, and for rain whether there is thunder
far off. Every sound is synthesised on the spot (Web Audio: noise loops
through filters, with what happens laid on the audio clock from a seeded
schedule): nothing is downloaded, it works offline and under the release CSP,
and it never comes round to the same moment twice. Nothing is set up at
launch. It is separate from Pip's own sounds, which keep their switch in
Settings. Its choices are `leaflet.ambience` on this device. The sound is
measured, not heard, in tests (`measure.ts`: level, peak, spectrum,
steadiness); how the cafe's voices sound is for ears, and the five `talker`
levels in `scenes.ts` are the one knob.

**Characters** (`readers/people/`, off until switched on in Settings,
Reading; `leaflet.reader.characters`). Keeps track of who is who without
spoiling: everything the reader writes about a person (a name, a note, a
group, a tie to someone else) is stamped with the place in the book it was
written at, and a card only ever shows what is stamped at or before the place
being read (`model.ts`, `castAt`). Later notes are counted ("2 later notes
hidden", shown only if asked for); later people, names, ties and endings are
neither shown nor counted, bar "N more later in the book". Places in this
edition are compared by CFI, which is exact; an entry without one (imported,
or from an earlier book) by its fraction of the book. "Here" is the foot of
the screen; what is written is stamped at the name asked about, or the top of
the screen.

Select a name and press **Who is this?** on the selection bar. For a name not
on the sheet the card shows the book's own answer, spoiler-free by
construction (`mentions.ts`, `bookText.ts`): where it first appeared, how often
since, and its last mentions before this place, each a jump (through the
reader's own jump, so Back returns); chapters are read from the file one at a
time, never past the current one, and in the current one nothing after the
place, not even the tail of a line. One line typed there ("Son of Ned, the
bastard boy", Enter) makes the character. A line that names someone already
met suggests a tie ("child of Ned Stark"), added with one tap, never by itself
(`relations.ts`).

Names learned so far are marked in the text with a dotted underline and open
their card on a plain click (`marks.ts`). The book's DOM is not touched (Smart
Read numbers its text nodes): the underline is the CSS Custom Highlight API
with an adopted stylesheet, and a click is matched against the ranges. A click
that selects, is on a link or a footnote reference, or was taken by another
handler is left alone, and a single click waits 220 ms so a double-click still
selects the word; chapters are searched once, when idle, and let go when they
leave the page; nothing runs on scroll. A name written with a capital matches
as written or in capitals, one written small in any case; a given name
("Sansa" for "Sansa Stark") is matched while no one else met so far shares it.
Underlined names cannot be reached by keyboard in the text; the selection
bar's button and the panel are the keyboard paths.

The **Characters** panel (toolbar) lists everyone met so far by group, offers
"People so far" (names the book has kept using up to here, counted with
SpeedRead's rule for a name and thinned of places, things and ideas;
`suggest.ts`; the thinning leans on English verbs, so other languages get more
false names), and draws the relations: families as trees, other ties as
labelled lines, a large cast a neighbourhood at a time (`graphLayout.ts`,
`RelationsGraph.tsx`, plain SVG). The editor renames, adds a name learned here
(optionally "call them this from here on"), sets a group and its colour, adds
or ends a tie, rewords notes, joins two entries that are one person
(`mergePeople`), and deletes.

A sheet can be saved as a file and brought in from one (`sheet.ts`;
`people_export` writes only a `.json` of its own format): what arrives keeps
its stamps and shows only as the reader gets there, so a friend's sheet does
not spoil; from another edition the exact places are dropped. The sheet of the
book before this one in its series can be brought in as known from the first
page. Nothing leaves the device. Turning the switch off stops all of it and
deletes nothing. Storage: [data-model.md](data-model.md#annotations).

In the reader, `readers/text/useReaderChrome.ts` mounts `usePeopleReader` and gives it the book, the
rendition, the reader's place and its own jump. The card shares the selection
bar's dock (above the chapter dock and the pace pill); the panel sits beside
search, and opening one closes the other. A card or the panel pins the
toolbar, holds hands-free reading ("Characters are open") and has its place in
the Escape order. Clicks on links, note references and pictures stay the
reader's (it takes them in the capture phase). A chapter that comes back after
being let go is marked again within about a second, and a name is marked only
below the place it was learned at, so scrolling above that place shows it
unmarked: that is the no-spoilers rule, not a fault. Reading keys still act
under an open card or panel, as they do under the notes panel.

Highlights and bookmarks are kept in
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

**The page finish reaches a PDF's page** (`readers/pageTone.ts`). pdf.js draws
a page black on white whatever finish is chosen, so Dark paper and True black
used to change everything around the page and leave the page a white
rectangle. The drawn page is now re-toned: its white becomes the finish's page
colour and its black the finish's text colour; True white shows it as drawn,
and comics are never toned.

- **Dark finishes turn lightness over and keep hue**: the same amount is added
  to all three channels, so a blue link stays blue and a red heading red,
  where a plain negative would make them yellow and cyan.
- **Photographs are left as drawn.** While pdf.js paints, the page source
  notes where pictures go by standing in for the canvas's `drawImage` (asking
  pdf.js for the page's operations instead would parse the page, and decode
  every scan, twice). Afterwards each picture is judged by its pixels
  (`looksLikePhoto`): paper and ink, however yellow the paper or soft the
  letters, is a scan of text and turns with the page, as does a chart of a few
  flat colours; a picture whose lightness is spread over many levels is a
  photograph and is put back as it was. Pictures under 40 pixels a side
  (bullets, rules, icons) turn with the page. A picture inside a transparency
  group arrives as the group and is judged as a whole.
- **The page is drawn out of sight** and shown when finished, so there is no
  flash of white before a dark page and no blank between pages; the page
  before stays up, dimmed, until the next is ready.
- **A picture kept as drawn loses the white it stands on** (`clearWhiteGround`):
  white connected to its edge becomes the page colour, white inside the
  drawing stays. A coloured initial or an illustration on white used to sit in
  a white box on a dark page.

**What the page reader does** (`pages/PageReaderView.tsx`; pure parts in
`readers/pdf*.ts` and `readers/page*.ts`, each with tests):

- **Contents.** A PDF's own outline is listed in the sidebar above the page
  list (Contents | Pages), each entry with its page and the current one
  marked (`pdfOutline.ts`). It is the only thing read from the whole document
  on opening.
- **A PDF with no outline has its chapters found** (`readers/pdfChapters.ts`):
  from a printed contents page whose lines are links, or from headings set
  larger than the body at the top of a page, with running heads excluded by
  their repeating on nearby pages. It reads every page's text once, a page at
  a time, starting 1.2 s after the book is open (600 pages in about 1.4 s),
  stops when the book is closed, and is kept per book on this device
  (`leaflet.pdfChapters.<book id>`). The list is used as a real outline is,
  under "Chapters found by Leaflet". Fewer than three headings, headings that
  disagree in size or height, or one on most pages (slides) make no list, and
  the sidebar says why; a scan is said to be one. A PDF's own outline is
  always kept. Tested on two real PDFs with their outlines hidden: 12 and 13
  entries, the same as their own top level, on the same pages.
- **Printed page numbers** (`readers/pageLabels.ts`, 13 tests). Where a PDF
  says what is printed on its pages, the dock reads "Page 6 (20 of 321)" (a
  page labelled with a word is called by it: "Cover (1 of 20)"), the contents
  and page lists show printed numbers, and "go to page" takes them: `#20` is
  the twentieth page of the file; `40%` a share of the way; a printed number
  goes to the page that has it (so a plain number that is also printed goes
  there); any other plain number is a page of the file. The field opens
  holding the page in view, written so that Enter stays put. A PDF without
  labels is unchanged. Bookmarks, search results and link tooltips still give
  the file's count.
- **Go to a page.** The dock's "Page 12 of 300 · 4%" is a button: click it, or
  press G, to type a page number or a percentage. Home and End go to the first
  and last page.
- **Search (PDF).** Ctrl+F. Text is read a page at a time as the search
  reaches it and kept for 80 pages, so results arrive while a long document
  is still being read; a phrase is found across runs, line breaks and
  end-of-line hyphens. Results are marked on the page as rectangles that are
  fractions of the page, so they hold at any zoom and finish. A scan says it
  has no text to search (`pdfText.ts`, `pdfSearch.ts`, `PdfSearchPanel.tsx`).
- **Selecting text (PDF).** pdf.js's text layer lies transparent over the
  canvas, rebuilt on every page turn and zoom and cancelled when superseded;
  its CSS is `pdfTextLayer.css`, to be kept in step with pdfjs-dist.
- **Drop caps.** A large initial is joined to the word beside it for search
  and selection (`mendDropCaps`): "The" is found and copied whole, with the
  big letter's mark matching the big glyph.
- **Size.** Fit width, fit page, actual size, or free zoom from 25% to 400% of
  actual size (a PDF at 100% is its printed size; `pageZoom.ts`). Ctrl+wheel
  zooms about the pointer: the page is stretched at once and redrawn sharp.
  Remembered per book in `leaflet.reader.<book id>`. A canvas is capped at
  16.7 million pixels, so a page zoomed far in on a dense screen is drawn a
  little softer.
- **Reading keys.** Space, Page Down and the arrows scroll a page larger than
  the window and turn it only at its end (`pageKeys.ts`); a new page appears
  at its top at once.
- **Bookmarks.** B (or Ctrl+D) toggles one on the page in view; the list is in
  page order, says the chapter and how far through, marks the current page,
  and each can be removed.
- **Comics.** Per book: read right to left (swaps the arrows, the dock's
  arrows and a click on the page's left or right third) and two pages side by
  side on a wide window, with a cover or a double-page picture shown alone
  (`pageSpread.ts`). Pairs are worked out from pages already read, so a jump
  far ahead can be one page off until it is read through.

Keys: Space / Page Down and Shift+Space / Page Up scroll then turn; Left /
Right turn; Home / End; G go to a page; Ctrl+F search, Enter / Shift+Enter
next / previous match; B bookmark; + / -, Ctrl +/-, Ctrl+wheel zoom; Ctrl+0
actual size, Ctrl+1 fit width, Ctrl+2 fit page; Escape closes an open panel
before it leaves the book.

What the bug pass of 1.2 settled, each measured before and after
(`readers/pageKeys.ts`, `pageScroll.ts`, `pdfText.ts`, `pdfOpenError.ts`):

- **The page turns once its own end is in view.** The room round the page is
  not a screen to scroll to (`padTop` / `padBottom`): Space used to spend a
  press on it at the foot of every page. A button the mouse clicked does not
  take the next Space (it used to turn page after page, unread); one the
  keyboard tabbed to does.
- **The place** in the paged layout is kept as it is in Scroll: the top of the
  window as a page and a share of its height (`placeWithin`), stored 400 ms
  after a scroll or turn, so the book reopens on that line and not at the top
  of the page. Switching Pages and Scroll keeps the line a third of the way
  down the window (it used to go to the page's top, 22 lines away).
- **A window resized under a fit keeps the middle of the page where it was.**
  The page on show is redrawn 120 ms after the last change of size, and Scroll
  holds drawing after a change of scale as it does after a jump: a pinch or a
  dragged window used to start over fifty drawings and now draws once.
- **At a chosen zoom the column is as wide as the widest page met so far**, and
  when it grows the scroll is moved with it, so the page being read does not
  jump sideways when a landscape page comes or goes.
- **Search (PDF)** begins at the reader's page and comes round; the list is in
  page order; Enter starts from the reader's page; accents are ignored
  (`foldAccents`: "cafe" finds "café"). A phrase across a page break is not
  found.
- **A PDF that will not open says why** in plain words: protected by a
  password, damaged or incomplete, or no pages. A page that failed to draw in
  Scroll is tried again when it comes back.
- **Comics**: a comic never opened before fits the whole page. With two pages
  side by side, a page that cannot be decoded is shown as an error on its own
  and the page beside it alone.

- **Links (PDF)**, in both layouts (`pdfLinks.ts`, `PdfLinkAreas.tsx`). A
  page's links are read with it and laid over it as fractions of the page,
  under the text layer so a link's words can still be selected (a drag
  selects, a click follows). Each can be reached with Tab and says where it
  goes. A destination in the document is a jump, to its height on the page
  when it gives one; the named actions presentations use (next, previous,
  first, last page) are followed too. An http or https address opens in the
  browser through `accountService.openLink` (http as https), with the address
  as the tooltip. A `mailto:` link opens the reader's mail program with the
  address alone (anything after it, a subject or a body, is dropped). Every
  other scheme (`javascript:`, `file:`, `tel:`), launch actions and other
  files get no area: the opener (`openable_link`, `commands/account.rs`)
  takes https and one plain mail address only.
- **Back after a jump.** Go to page, the contents, a bookmark, a search
  result, a link, Home and End leave the line they were made from in
  `jumpHistory.ts` (the page and a share of its height). Alt+Left and the
  dock's Back chip return to it, a third of the way down the window;
  Alt+Right goes forward again. Ordinary reading adds nothing.
- **The wheel turns the page in Pages**, one page a gesture (`wheelTurn` in
  `pageTurn.ts`), and only a gesture that began with the page already at that
  edge, so scrolling down a tall page stops at its foot. A comic read right
  to left goes on with a push left.
- **Left and Right turn once the page's own side edge is in view**; a held
  Space or Page Down is paced at 150 ms like a held turn (it ran 30 screens a
  second in Scroll).
- **A phrase that runs over a page break is found**, listed under the page it
  begins on, and marked in two parts.
- **Sharpness in Scroll.** The page across the reader's line gets the paged
  layout's cap (16.7M pixels), its neighbours 8.4M, so the page being read is
  as sharp as in Pages: 2.00 device pixels at 200% on a 4K screen, where it
  was 1.70. The budget is 50.3M pixels in all (about 200 MB at most; the peak
  measured through 58 pages was 144 MB). On such a display a page is drawn
  twice, once as a neighbour and once sharp; at 150% and below nothing
  changed. The place is stored with the page the reader was on.

Known and left: a very large page zoomed far in is still soft: a page is
drawn whole on one canvas of at most 16.7 million pixels (an A0 poster on a
1.5x screen is at 72% of the screen's resolution at 100%, 48% at 150%, 18% at
400%; an A4 page is sharp to about 300%), and drawing only the part in view
would be a second drawing mode in both layouts; a one-page PDF is 100% read
on opening.

**Continuous scrolling (PDF)** — `readers/PdfScrollPages.tsx`, arithmetic in
`readers/pageScroll.ts` (with tests). All the pages in one column in the
reader's stage; "Continuous scrolling" in Reader settings switches between this
and one page at a time. A PDF opened for the first time scrolls; one with
preferences from before the choice existed keeps pages; comics are always
paged, and two pages side by side is not offered in Scroll.

- **Only the pages near the window are in the document**, about a screen
  above and below. A page not yet drawn is the finish's page colour with its
  number, faint.
- **Sizes are not read on opening.** A page not yet seen is given the first
  page's size and takes its own when it comes near. The reader's place is kept
  as a page and a share of its height, not as a scroll position, and put back
  in the same commit whenever the layout changes; the stage has
  `overflow-anchor: none` because the column does this itself. A jump or a
  reopening holds its target the same way until the pages round it have their
  sizes.
- **One scale for the document**, from the first page. Under fit width or fit
  page, a page wider than the window at that scale is drawn at the scale that
  fits it (a landscape page in a portrait book is shown whole, with no
  sideways scrollbar); a chosen zoom is the same for every page and may scroll
  sideways. Fit page means one first-page-sized page fits the window.
- **Drawing** is one page at a time, nearest the reader first, each on its own
  canvas with its own cancel (`pageSize`, `draw`, `layTextOn` in
  `pageSources.ts`; the paged `render()` is untouched). A page is drawn only
  once its size is known. A page that scrolls away before it is drawn is given
  up. A move of more than a window at once is a jump, and nothing is drawn
  until it settles, so dragging the scrollbar across a book starts no renders
  on the way.
- **Memory**: 50.3 M pixels in all, the page being drawn counted twice (the
  off-screen sheet and the toning read-back); 8.4 M a page, and the paged
  layout's 16.7 M for the page across the reader's line. The furthest pages
  are let go first, never a nearer one for a further.
- **The current page** is the one across a line a third of the way down the
  window; it drives progress, the outline, bookmarks and the dock. The top of
  the window is stored as `place` in `leaflet.reader.<book id>` (with `layout`)
  and the book reopens there when that is within a page of the saved progress;
  otherwise at the top of the page the progress names, so progress from
  another device wins.
- Search marks (a hit is put on the reader's line, a third of the way down,
  clear of the toolbar, so the dock names the hit's page), text selection
  (within a page, and across a page boundary with a line break between),
  drop caps, the finishes and zoom about the pointer work as in the paged
  layout; a finish change blanks the pages in the new colour before redrawing
  them.

Keys in Scroll: Space / Page Down and Shift+Space / Page Up scroll a screen;
Up / Down a line; Left / Right go to the previous or next page; the rest as
above.

**Keyboard shortcuts sheet.** `?` or "Keyboard shortcuts (?)" in Reader
settings opens the same sheet the text reader has
(`readers/ShortcutsSheet.tsx`), listing what the keys do for what is open: a
PDF in Pages or Scroll, or a comic in either reading direction. The rows and
the key handler both read one table, `readers/pageReaderKeys.ts`, so the sheet
cannot drift from the keys; Escape closes the sheet before anything else.

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

**Finding the chapter list** (`readers/contentsPanel.ts`,
`readers/ContentsList.tsx`). The list used to slide wholly out of sight with a
6 px hover strip, then had a faint tab; readers shown the app still could not
tell it was there. Now:

- A **"Contents" handle** stays on the left edge, outside the toolbar and
  never hidden with it: 30 x 132 px, an icon and the word set upright, at full
  opacity (the word on the tab is 7.3:1 to 11.5:1 on the four finishes, the
  tab's edge on the page 3.7:1 to 6.6:1). It is sized to the margin beside the
  text and is icon-only on a phone-width window; the text clears it by 5 px at
  390 wide and 57 px at 800. It opens on a click, not under a resting pointer
  (a click meant for it would land on a chapter); the 10 px edge strip still
  opens on hover.
- The **dock's chapter name is a button**, the **C key** toggles the list
  (on the `?` sheet), the toolbar's chapters button shows on every screen, and
  the list has its own X.
- **Opened on purpose it stays**, is remembered for the book and then for the
  device, and comes back open where it fits beside the text (a margin of 288
  px or more, about 1,190 px of window at the default line length). Narrower,
  it opens over the text and is not reopened by itself. Beside the text it
  does not hold Smart Read or take Escape; over the text it does both.
- It **shows itself once per device** (`leaflet.reader.contentsSeen`): 0.7 s
  after the first book opens, for 2.8 s; with the walkthrough pending it waits
  for it, and the walkthrough has a step that lights the handle.
- The list opens centred on the current row (a bar and `aria-current`) and
  follows the reading.

**Books within a book** (`readers/innerBooks.ts`, 19 tests). A set of novels
in one file is found from its contents: top-level entries that each hold a
cover, title page or appendix of their own and a share of the file (or, in a
flat list, a title page listed more than once). Numbered divisions ("Part
One", "Book Two") are parts of one novel, and a single novel is unchanged.

- The chapter list groups by book under headers that stay in view ("Book 2 of
  4", the title, Read / 46% / Not started, a meter) and fold (`aria-expanded`,
  Left and Right); past 60 rows the books not being read start folded. Front
  matter and appendices are set quieter, and each story's end is marked.
- The dock names book and chapter with the book's percentage beside the set's
  ("A CLASH OF KINGS · TYRION 46% · set 34%"); the progress bar marks where
  each book begins and its bubble has two lines; "left in this book" is the
  novel being read.
- A look at another book's map or appendix moves neither progress nor the
  saved place; reading through from one novel into the next does
  (`gapFollows`).
- A list replaced after the book is open (chapters found by Leaflet, below)
  keeps its scroll, its folds and its current row.

**A chapter list for a book without one** (`readers/autoContents.ts`,
`contentsScan.ts`; 36 tests). When a book's contents are missing, one entry,
all one place, or only front matter, Leaflet makes the list; when they are
real but thin (three or more files that open with a heading are unlisted, and
outnumber the chapters listed), the book's entries stay as the top level with
what was found beneath. Sources in order of trust: the book's own contents
page (a page of links), headings the book marks, lines that read as chapter
headings and are set as one ("Chapter 12", "XII", "Part Two", with the title
on the next line joined: "Chapter 3 · The Road"), paragraphs in a style kept
for the head of a section, then one entry per section. A number lost from a
run is supplied only when the lines between two numbered chapters are exactly
as many as the numbers missing. Front and back matter are named plainly. The
book is read once, in the background, 0.9 s after its first page is up (48 ms
to 0.35 s for a novel, 1.6 s for 320 sections), and the result kept in
`leaflet.contents.<book id>`; the list says "Chapters found by Leaflet". A
heading with no id is reached by CFI (`TocItem.cfi`). Of the owner's 14 EPUBs
one had its list made (one entry, "Start", became a cover, a contents page and
21 chapters with their titles), one had it filled in (five headed files
unlisted), and twelve kept their own untouched; against those twelve the
finders agree with the book's own list (55 of 55, 101 of 102, 106 of 107 from
the in-book contents page).

**Chapters that share a file** (`readers/chapterSpan.ts`, 13 tests). Next and
previous chapter, Home and End, the time left in the chapter and the progress
bar's label follow the headings inside a file, not the file, where the scan
found an entry part-way down one. A novel of three files and 21 chapters had
"2 h 30 min left in the chapter" (the book's) and five stops for "next
chapter"; now each list entry lands with its heading 80 px down (on the
showing page, with pages) and the dock and the list agree for all 21. Ordinary
books, a chapter a file, are unchanged. With pages the dock's "12 of 50", Home
and End go by the chapter's own pages ("CHAPTER 2 ... 1 OF 93" in a file of
178), and previous chapter steps past entries on the page already showing: at
an appendix whose entries are anchors in one file, and at each novel's cover
in a set, it used to stay where it was.

**Lists.** A marker sits beside its item's first line
(`list-style-position: outside`), and lists are padded 2em so nested ones
indent: a stylesheet that said `inside` with a paragraph in the item left each
bullet alone on a line above its item. **A list flattened into paragraphs**
(three or more lone bullets, each followed by a short line: one real novel's
contents page is 21 of them) loses its bullets, for Smart Read's word index
too, and a line that names a contents entry goes there on a click.

**What the publisher did with blocks is kept** (`readers/bookBlocks.ts`, 28
tests; read from the book's own styles before the reader's stylesheet goes in,
like drop caps). The reader's stylesheet set every paragraph's alignment and
spared only a class called `.center`, which the one novel earlier passes were
tested on happens to use; in nearly every other real book chapter numbers and
titles, dedications and epigraph credits were pushed to the left at body size.

- Centred and right-aligned lines stay so, and a picture alone in one is
  centred with it.
- A short paragraph set larger than the running text from first word to last
  is a heading and keeps its size (1.15x to 1.6x, so nothing outranks a real
  `h1`).
- A `div` that holds words is spaced as a paragraph: a novel made of
  `<div><span>` was a wall of text (535 of 757 blocks with no gap and no
  indent).
- An inset block keeps both margins as shares of the column (the left one was
  zeroed and the right kept), unless most of the page is inset, which is the
  book's own page margin.
- A paragraph set apart by space alone has the publisher's room, one to two
  ems, above the reader's gap: margins collapsed, and a scene break measured
  32 px against 28.8 px for any two paragraphs. A blank rule between two plain
  paragraphs gets a scene break's room; a rule the book draws itself is not
  drawn again. A line that is only a link (a contents page) is not a break.
- The baseline novel, section by section: 13 of 19 identical to the pixel; the
  others are its cover (fits the window), four space-only scene breaks it had
  all along, and centred lines on its last pages.

**Pictures.** Scrolling, a picture is no taller than the window's room
(`--leaflet-picture-room`): every calibre SVG cover was about 612 x 930 with
632 px to show it in. Heights given in `vh` are undone (epub.js's own
`max-height: 0` with a `95vh` box in a content-sized frame made a cover 0 by
0, a blank band at the head of the book). An SVG wrapper told to stretch is
told to fit. With pages, a page that is one picture has nothing around it (a
title picture after an empty paragraph went to a column that was never
counted, and the page showed blank). Flat-grey artwork (outlined letters with
a tint, a grey ornament) counts as ink on the dark finishes (`inkKind`,
`readers/inkImages.ts`): 31 of one novel's 36 pictures were chapter numbers
left as white boxes; a shaded drawing or a photograph stays as drawn.

**Links** take the reader's colour whatever `-webkit-text-fill-color` the book
set (107 contents links were navy on black); an anchor that is not a link
takes the page's ink on a dark page.

**A file listed twice in a row in the spine** is shown once, and contents
entries for it open the copy that is shown.

**Verse** (`verseRuns`, `readers/bookBlocks.ts`). Lines of a poem or song set
as a paragraph each, with nothing between them, follow one another at the
line spacing of the text (they were a paragraph's gap apart, 29 px under
every line); a stanza keeps its gap, and the paragraph's gap comes after the
last line. Told from prose by how the book sets them: short (100 characters
or fewer), no first-line indent, and either inset or centred (two lines are
enough), or, in a book that indents its prose, three or more of which most do
not end as sentences. Dialogue in short paragraphs is prose; a book with
neither indent nor gap gives nothing to tell by and is left alone.

**Hanging indents** (`keptHang`) are kept as the book set them, whatever the
page-margin rule says: a glossary's entries, a contents page, a cast list,
verse whose long lines turn over. A `text-indent` given in % is resolved
against the block's width (the browser reports the percentage).

**Ink pictures.** An ink picture is blended on a dark page when it is a
banner, or no larger than 480 px either way, or a link (the viewer's switch
cannot reach a link); only a large drawing the viewer can open stays as
drawn.

**A page shared by two chapters, with pages** (`chapterOnPage`,
`readers/chapterSpan.ts`). A page belongs to the chapter at its top; a
chapter that starts part-way down is named from the next page, unless the
reader asked for it by name (the list, next or previous chapter, a link,
Home), in which case it is named on its page until another comes up. End
shows a chapter's last page under that chapter's name.

**Search finds a word whose accents were not typed**
(`readers/searchFold.ts`): epub.js lowers the case and nothing else, so a
name spelt with a tilde gave 1,231 matches and the same name typed plainly
none. Typed with a mark, the words are matched as typed.

**Highlights are grouped by the chapter's place** (`groupByChapter`,
`components/highlights/highlightsView.ts`): two chapters of the same name are
two headings (a set of novels has 35 chapters called by one name); one
chapter running over two files is one. In a set the book is named once, above
its chapters, in the notes panel, the Library's Highlights dialog and the
Markdown copy. The notes panel had no headings before; each row carried its
own chapter line.

Checked and fine on a real non-fiction book with notes: the footnote popup,
Go to note and Back (to within 1 px, and to the same page with pages); a
selection and a highlight across a heading mark and a raised initial, before
and after a type-size change; the two light finishes (lowest text contrast
12.8 and 18.6).

Known and left: links on the light finishes are the browser's blue or the
publisher's own (readable, 7.8:1 on paper, but not the reader's accent as on
dark); a fully selected centred line is highlighted the column's width; a
chapter whose highlights are two files apart is listed under two headings of
its name.

**Smart Read's pill** is held back at open while the page is before the
story's first chapter or is a picture, and comes up when the story reaches the
reading line.

What the real-library pass of 1.2 settled on a four-novel set (320 sections,
1.38 million words, 378 contents entries):

- **Half the contents were missing** (211 of 378 shown; every chapter of two
  of the novels). epub.js files NCX entries by id and finds parents by id, so
  an id used twice orphans what is under it. `readers/ncx.ts` reads the NCX by
  its nesting and is used when it holds more entries than epub.js's tree.
- **The story "ended" at 77%.** Chapters named for people did not read as
  chapters, so the whole last novel was back matter: 100% on every page, and
  neither progress nor place saved. `storySpan` (`readers/progress.ts`) runs
  the story on, after the last "Prologue" / "Chapter N" entry, through named
  entries up to the first back-matter label when they are a tenth of the
  sections. A label that is a number, or a number and a title ("12", "12: The
  Road"), is a chapter too: two real novels had one chapter-like label each,
  so their story was the whole file, adverts and all.
- **Search stopped at 200 matches**: a common name gave 200 hits from the
  first nine chapters and nothing after. It keeps 4 a section and counts them
  all (`searchBook.ts`): 2,510 matches in 183 chapters, 1.5 to 5.2 s, the
  longest stall 129 ms; chapter headings carry their count.
- A file holding several contents entries was named for the last of them in
  search headings, the bar's bubble and mentions; a character "first appeared"
  on a contents page (`isContentsPage`, `people/mentions.ts`).
- Fine as found: 0.7 to 1.2 s to the first page, reopening at 90% in 0.5 s on
  the same line; memory flat over 55 chapters (one or two held, heap 111 to
  115 MB); "Who is this?" at 60% in 0.7 s the first time and 9 ms after.

- **Smart Read stopped with "Waiting for you" after a run of maps** between
  two novels, until Space was pressed again. When epub.js lets a chapter go
  above the window it moves the scroll position by that chapter's height
  (1,315 px here) to keep the text still, and the scroll handler took that for
  the reader going back. A scroll that moves nothing on screen is not the
  reader's (`isScrollCorrection`, `readers/smartScroll.ts`); a real scroll
  back still makes Dotty wait.
- **Time left was understated from front matter**: opened on a novel's
  contents page the dock said "about 6 hours left in this book" where a
  chapter said 7 h 30 min (8.3 h by the files). A contents page holds 7 to 9%
  of a chapter's words for its size, an appendix 58 to 70%, so words per byte
  is learned from the story's own sections (`wordsPerByte`'s `inStory`,
  `readers/timeLeft.ts`). "Left in this book" is now within 2.1% a novel.
- **A collection of stories** was finished only at the foot of its last
  section. When no contents entry reads as a chapter, the story runs from the
  first entry not named as front matter to before the closing back matter,
  less unlisted files named for back matter (`spanByOutsideLabels`,
  `isBackMatterFile`, `readers/progress.ts`).
- **Search in a set folds by book**, with a count on each header
  (`groupByBook`): 164 rows drawn for a common name instead of 547; 40 rows or
  fewer open unfolded, and a single novel keeps its flat list.
- **A novel of a set finished** says so once, quietly, when read through and
  not on a jump ("A CLASH OF KINGS: FINISHED · BOOK 3 OF 4 IS NEXT",
  `crossedStoryEnd`). The set is one book for the shelf, the diary and the
  profile, finished at its last story's end.
- Fine as found across the seam between two novels: auto-scroll and SpeedRead
  carry on and name every stop; a bookmark and a highlight keep "book ·
  chapter" and go back to the right one of 35 same-named chapters; with pages
  a resize and a type-size change in a 74-page appendix hold the same word;
  the scrollbar held for 5 s fetches nothing; 318 names marked over two
  chapters in 1.36 s; the relations drawing with 40 people in 21 ms.
- **On a touch screen** the Contents handle, the dock's chapter name and the
  list's close button take a 44 px press (the handle's was 20 px wide at 360
  wide). The list does not show itself under 768 px.

Known and left: named groups with no cover, title page or appendix of their
own are not taken for books, so such a set stays a flat list; the list opens
over the text, not beside it, under about 1,190 px; on a landscape phone (800
x 360) the open list has about three rows under its header; a run of pictures
is one Smart Read stop; the highlights view puts neighbouring highlights from
two same-named chapters under one heading.

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
`sync/reading.rs`, `components/ReadingPaceCard.tsx`, and in `readers/text/`:
`useSmartRead.ts`, `useReadingModes.ts` (the engine), `useReaderWords.ts`,
`useReaderDot.ts`, `useReadingPace.ts`

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
- Smart Read and RSVP read on into the next chapter, which is already on the
  page below (see the text reader): the words are re-indexed and the word
  being read is found again. They scroll past image-only chapters, and stop
  at the end of the book instead of replaying the last page.
- Their controls never show a pace while nothing is moving. Anything over the
  text (a selection, search, the notes or the chapter list) makes hands-free
  reading wait, and the control then says "On hold" and why. A selection left
  behind used to hold Smart Read for good while it went on showing its pace.
- Dotty is a small flat dot (7 px, no ring or pulse) that glides from line to
  line, and jumps without a streak when it has far to go. The ring, the bounce
  and the sparks are for when a hand reaches for it; what a pointer can catch
  is larger than the dot.
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
"optimal recognition point", `rsvpPivotIndex`). That letter stays on the same
spot of the screen while the word flows around it, so the eye never moves.
Trailing punctuation is shown faintly, so sentences still read as sentences.

Where the word sits (`readers/rsvpWord.ts`, with tests):

- **The pivot is about 36% of the way through the word as drawn**, by the
  letters' approximate widths, skipping leading quotes and never on a hyphen
  or apostrophe; a word of up to five letters pivots on its second. It used to
  be counted in letters (the 5th of a 15-letter word), which left three
  quarters of a long word hanging to the right.
- **The spot is 0.55 em of the stage's type left of the stage's middle**
  (`RSVP_ANCHOR_EM`), not the middle itself: the pivot is left of a word's
  middle, so a spot at the middle put every word off to the right. It is a
  distance in letters, not a percentage of the stage, because the type scales
  with the window while the stage stops at 720 px. Measured on 1,817 words of
  one chapter: ordinary 5 to 9 letter words sit a median 0.00 em from the
  middle, 99.5% within a letter, at 1280×800, 1024×768, 800×600 and 375×812;
  the pivot is on the tick within 0.02 px.
- **A word too long for the room either side of the spot is set smaller**
  (`--rsvp-fit`) instead of being cut off, by its measured width in the
  stage's face (canvas `measureText`, `readers/rsvpMeasure.ts`) against the
  stage's real width; `rsvpFit`'s estimate by letter widths is the fallback.
  The line's height is taken from the full size, so the guides and the passage
  below do not move when it happens.

How long a word is held (`readers/rsvpHold.ts`, with tests; on top of the
rarity estimate in `smartReadService.ts` and the punctuation pauses in
`pacing.ts`):

- **A name is held longer when it is introduced**: 0.9 of a word's time more
  on its first appearance, 0.45 on its second, 0.2 on its third, then like any
  word. A name is a word capitalised in the middle of a sentence at least once
  and never written in lower case; a word that only ever starts sentences or
  speech is not taken for one, nor is a heading in capitals, nor I'm, I'll,
  I'd and I've. "Vin's" counts with "Vin". A world's capitalised terms
  (Ministry, Empire) count too, which is right: they are new to the reader.
- **A long uncommon word** gets 0.3 the first time and 0.12 the second; a
  shorter one 0.1 the first time; **a figure** ("1984", "1,200", "3.5", kept
  whole by `READER_WORD_PATTERN`) 0.35 every time. Everyday words get nothing.
- "First" means first in the text on the page (the chapter being read and its
  loaded neighbours). The chapter is still scaled to average the chosen words
  a minute (`getPaceScale`), so this moves time towards new words; it does not
  slow the whole.
- **Setting off**: the first six words after Play or a resume are held longer,
  easing from 1.8 times to the chosen pace (`rsvpRamp`), so the eye has found
  the spot before words pass at full speed.

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
  (− / pause / +) is there while it runs. It is for reaching, not for reading
  beside: awake while the toolbar is, a hand is on the page, it is paused or
  on hold, or the pointer or the keyboard is on it; left alone it lingers two
  seconds and fades out completely, and a change of pace shows it again for a
  moment (`is-fresh` renames its animation so that it starts over). Smart
  Read's control is the same one and behaves the same.
- **Hold the page** (mouse button or finger down on the text) and it waits;
  letting go resumes after a short breath. Selecting a passage therefore never
  fights the scroll.
- **Scrolling by hand** makes it step aside and resume from wherever the reader
  left it: 3 s after scrolling back (re-reading), 1.2 s after scrolling ahead.
- **The end of a chapter** is not an event: the next one is already below, and
  the scroll carries on into it. (It used to jump to the next chapter the
  moment the last line reached the bottom of the window.) At the end of the
  book it stops and says so.

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
const COLD_MIN_STREAK: i64 = 3;   // a shorter streak breaking gives Pip no cold
const COLD_DAYS:       i64 = 3;   // a cold passes by itself after this many days
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
- **Reading outside a focus session shows on the shelf too.** It always counted
  toward the day, the goal and the streak, but only a stopped session made an
  entry, so a day read with no session looked like nothing had happened. Each
  day's free reading (`habit::free_reads`: the day's ledger minutes less its
  sessions', a minute or more) is now an entry of its own, derived and never
  stored, so past days appear too. It earns the goal and streak bonuses but
  no water: only focus sessions water the garden.
- **Time counted between flushes is kept** in localStorage
  (`leaflet.habit.pendingReading`) with its day, so closing Leaflet mid-read
  credits the last minute on the next launch, to the day it was read. It is
  credited before the streak is judged on launch, and before a session is
  recorded, so a session as long as the goal no longer ends "1 min to go".
- **A goal change applies to today at once, lower or higher, unless today has
  already met its goal**; a met day keeps the goal it met. Lowering the goal
  to what has been read meets today on the change itself, and raising it after
  meeting it cannot unmeet today (that used to read as a broken streak). Earlier days are never re-stamped. `commands::goal_for_day`
  is the one place that decides.
- **A sync cannot un-meet a day.** For the same day on two devices the minutes
  take the maximum, and the goal kept is the hardest one a device actually met
  (its own minutes at or over its own goal); if neither met its goal, the goal
  of the device that read more. A day met on any device stays met.
- **A clock set back is not a broken streak**: an evaluation as of a day
  earlier than the last one evaluated (a corrected clock, the date line
  crossed eastward) never finds a break.
- **A break is announced whenever it is found**: on launch, by a credit, by a
  recorded session, or by the once-a-minute check that notices a new day in
  an app left open overnight (which also stops yesterday's minutes showing as
  today's).
- **A broken streak burns nothing; Pip catches a cold.** When a streak of
  three days or more breaks, she has a cold from the day after the missed day
  (`habit::cold`, on the snapshot as `cold: { since, brokeFrom, cure,
  minutesLeftToday, daysLeft }`). Meeting the daily goal on any day since
  cures it at once; a day covered by grace or a freeze does not. It passes by
  itself after three days. It is derived from the ledger, never stored, so two
  devices agree and a clock set back cannot bring back a cold already nursed
  away. It does not touch her mood. Earlier versions burned the newest books:
  those keep their tombstone (`burned_at`), the shelf speaks of burning only
  while it holds one, a device still on an old version can still burn, and
  that syncs and sticks. Clearing old burns is not offered: a cleared
  tombstone would come back at the next sync from any copy that still has it.
- **A break is final.** The grace a break refills is for the streak after it:
  the walk pays for no day earlier than the day the break was found (`broke_on`
  in the per-device streak state). It used to spend that grace on the gap
  itself at the next evaluation, so the streak came back a minute after its
  end was announced, a single missed day could never end a streak, and books
  burned for a break that then undid itself. Streak numbers after a one-day
  miss with no grace in hand are therefore lower than older versions gave;
  covers already stamped stay.
- **A page read slowly is reading** (`hooks/slowPage.ts`, with tests). The
  heartbeat stops counting after 90 seconds without input (`IDLE_MS`), which
  was written for scrolling, where input is constant. With pages a reader at
  200 words a minute on a 400-word page was credited 75% of their time, and
  one at 150 wpm 56%. Time that went uncounted for want of input, with Leaflet
  in front, is now claimed when the reader turns the page (the text reader's
  pages layout, Pages in the page reader, and Page Down / Page Up when
  scrolling): up to 240 s a page in all, never time away, minimised or asleep,
  never more than has passed since anything was last counted, credited to the
  day it was read on. The ledger and the session clock take it once; the pace
  model's own rule for what is a pause is untouched. What it newly allows: a
  book left in front with a page key pressed once every four minutes earns the
  full hour (it earned 22 to 26 minutes before; a mouse wiggle every 90
  seconds already earned the hour). Wheel and arrow-key scrolling keep the
  90-second rule.
- **Time in other apps is not session time.** Leaflet watches the OS window
  focus (`services/windowService.ts`; the DOM's `blur` also fires when the
  reader clicks into the book's iframe, so it cannot be used). A stint away
  under 30 s is free (a dictionary lookup); a longer one is added to the
  session's `awayMs` and the session clock (`sessionElapsedMs`) skips it,
  including a stint still in progress, so a session never completes while the
  reader is elsewhere. On return, Pip reacts.

### Focus lock

Settings → Habit → **Focus lock** (stored as `kioskMode`). During a session the
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
  announce a break.

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
  count only up to the reading the **heartbeat** recorded on the day the
  session ended, then the day it started (read across midnight, or left
  running and ended the next day), plus a minute of slack for a flush in
  flight, so a timer left running waters nothing, as it earns nothing towards
  the goal. Each day's minutes are handed out once, in the order sessions
  ended. Known limit: after a sync the counted minutes never fall, but water
  can, since sessions from two devices share one day's merged minutes and an
  earlier unclean session can take a later clean one's bonus.
- **Plots.** Three to start; a fourth, fifth and sixth for 200, 350 and 500
  seeds, each after the one before.
- **Planting** costs a seed packet (a few seeds). Water flows to the growing
  plants in planting order, spilling to the next; with nothing growing it
  waits in a **rain barrel** (up to 120), which pours into the next planting.
- **Ripening.** A plant ripens when it has had its minutes of water. Tap it to
  **harvest** its seeds (Pip cheers, and it cheers Pip up a little).
- **Rows.** The garden is planted in two furrows (`pip/gardenRows.ts`): plots
  1 to 3 along the front, 4 to 6 along the back, the bed one sprite
  (`renderGardenBed`). They used to be scattered pots. A plot is still its
  number, so saved gardens load as they are.
- **The sky** behind the garden's glass (`pip/sky.js`,
  `components/pip/GardenSky.tsx`) follows the real clock: the hour's colours,
  three depths of cloud, the sun's arc or the moon and stars, birds by day.
  Every two and a half minutes there is a chance of something rare: a balloon
  or a dragon by day, a shooting star or a dragon by night (a dragon about
  every half hour). It is a pure function of the clock, redrawn only when
  something moved, and a still picture under reduced motion.

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
bonuses + rewards − purchases (seed packets included), recomputed from the
records.

| Source | Seeds |
| --- | --- |
| Harvests | the plant's yield |
| A day the goal was met by reading | +4 |
| ...its streak bonus | +1 per day of the streak, up to +6 |
| Welcome gift | +50, once |
| Starter chest | +30, with the first focus session of 5 minutes or more |
| First steps | 10 to 25 each, 100 in all (below) |
| A finished set | about a tenth of its pieces' cost (15 to 110) |
| Pip's daily wish, granted | +8, and mood |

**Rewards** (`pip/rewards.rs`) are never stored either: each is a pure
function of records every device syncs (purchases, plantings, the garden
replayed from the reading, the ledger), so there is no "claimed" flag to
disagree about and a sync can never pay twice. Each rule asks for records that
are never unmade, so a reward once earned stays earned. Reward amounts may only
go up, and a set's pieces and the wish lists are frozen once shipped (a new
list is a new dated "era"), or a change would take seeds back.

- **First steps:** plant a seed (any planting), water it by reading (a planting
  with water in the replay), meet your reading goal (a goal day), pick a plant
  (a harvest), give Pip a treat (a treat bought), buy Pip a hat (an accessory
  worn on the head, bought), place a lamp (a light bought). Shown as a
  checklist in the top bar (`PipGoals`) until all are done and celebrated.
- **Sets:** own every piece of a fixed list: 8 outfits, 2 bedroom corners, 6
  floors' decor.
- **The daily wish:** chosen in Rust from the local date and what Pip owned
  before that day began; granted by buying, giving or planting that thing the
  same day (`PipWish`, a plaque in the top bar).
- **Starter pieces:** a window, a poster and a book tower in every bedroom and
  a watering can in the garden are free; each paid floor comes with one piece
  (`freeWith`: kettle, ladder, arcade cabinet, pegboard, star chart), owned
  with the floor and never sold alone.

Purchases and plantings are stamped in local time with the offset, so a
record's day is the reader's own (older records keep their UTC day).

A day covered by a freeze or grace keeps the streak going but earns nothing.
Seeds are never taken back: a broken streak takes nothing, Pip catches a
cold. **Before the garden** (local days before `GARDEN_SINCE`,
2026-09-27), minutes paid seeds directly (one a minute, ×1.5 clean, +25 a goal
day, a streak bonus up to 40); what readers earned then is kept, as if already
harvested.

**Pacing**, for a reader doing a 20-minute goal most days (about 30 water a
day): the garden gives 10 to 12 seeds a day, the goal and streak bonuses about
10, so roughly 150 a week. Prices are set for that (`PACING` in `shop.js`).
The first days are gentler: the welcome gift, the chest and the first steps
come to 180, and the first variant (the gardener) costs 80, so a reader's
first evening can buy a cap, the floor lamp, an apple and the gardener.

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

The whole tab is the house, played like a game. The current floor fills the
page, drawn by the house art (`house.js`, 240 x 120) at a whole or half number
of device pixels per pixel (`sceneFit.ts`: half steps let it fill narrow
windows); windows show the real hour's sky, and in the evening the rooms dim
and lamps glow. Pip lives in it (below). A **lift** up the side of the room
rides between floors, a numbered stop for each: the **Bedroom** and the
**Garden** are free; the Kitchen, Library, Attic Arcade, Basement Workshop and
Rooftop Observatory open in order, each after the one below and some focus
sessions, for seeds. Without `VITE_ENABLE_FULL_PIP_HOUSE` (the shipped
setting) the house is three floors: Bedroom, Garden and the **Attic Arcade**,
which is open to visit, furnished by the house (`usePipHouse.ts`) and cannot
be decorated or bought.

**Pip does activities, not clips** (`pip/behaviour.ts`, pure and seeded;
`HouseScene` walks the plan). It used to play an unrelated clip at random and
cut it short. A free moment now starts an activity, a plan of steps (walk
there, face the right way, do a move for so many seconds): read (to the books,
take one, read for 20 to 40 seconds, yawn or bookmark, put it back), nap, look
out of the window, water a houseplant, check a growing plot, play with a toy
it owns, dance, exercise, play at an arcade cabinet, sunbathe, stroll. The
choice is weighted by mood, the hour, what is on the floor, what Pip owns and
what the reader just did (fed: sleepy; back from a game: a book, not a
cabinet), never the same twice running, and only quiet ones under mood 20.
Between activities Pip fidgets, its eyes follow the pointer, and it turns to
face where it is going (edge-on half way, not a mirror flip). Under reduced
motion: standing activities only, a pose about every 14 seconds, no walking.

**Playing with Pip** (`pip/play.ts`, pure). A poke climbs a ladder (boop, a
giggle, a laugh, dizzy, a huff, then one of the old surprises) and is
forgotten after five seconds. The pointer rubbed over Pip is petting (it leans
in, hearts, a purr), rubbed fast a tickle. Picked up, Pip swings from its leaf
like a pendulum; let go while moving it is tossed, spins, bounces off the walls
and lands. A ball (scrap paper, or the Bouncy Ball if owned) is thrown and
fetched, three times before Pip is puffed. The rail's **Play** key turns it
into a play rail (Pet, Tickle, Toss, Ball, Dance, Snack, Done), so every way
has a key; the up arrow tosses. The first hover invites it, and the
walkthrough has two more steps (Pip, Play). Play cheers Pip up by 1 a bout
(`pip_played`), from the same allowance of 12 a day as the arcade games, and
never pays seeds.

**Carrying Pip** (`pip/play.ts`, `holdStep`). Picked up, Pip hangs from the
hand by its leaf and swings with it; let go from a still hand it drops, from a
moving one it is thrown with that speed and its swing's, turns, bounces off
the walls, the ceiling and the floor, and lands. It used to hang as one rigid
pose and fall straight down, and the pointer was measured from the stage, not
the room the stage centres: on a wide window Pip jumped 59 to 142 floor pixels
to the right of the cursor and sat pinned against the wall. A press that ends
any way at all (cancel, blur, another floor) puts Pip down. Under reduced
motion Pip is carried and put down with no swing or flight.

**Things in the room can be used** (`pip/furnish.ts` for the rules,
`components/pip/furnishings.tsx` for the layer). A kind of furnishing declares
what the hand does with it, what Pip makes of it and what is remembered; each
usable piece gets a button with a gold edge on hover or focus, a label saying
what it does, and a key that does the same.

- **Curtains** (the Window): select to draw or open, or drag across to pull
  them; drawn, they hide the sky and dim the room. Pip squints by day and
  heads for bed at night.
- **Pictures**: select to nudge one (it swings on its nail, by the same
  pendulum as Pip, and hangs crooked); drag, or use the arrow keys, to slide
  it along the free wall. Pip straightens a crooked one as an activity
  (`tidy`).
- **The bed**: select it, use the Play rail's Bed key, or carry Pip over and
  put it down. By day Pip naps 30 to 45 seconds and gets up; after dark it
  stays until day. Tapping Pip, or opening the curtains in the morning, wakes
  it. Pip's own nap uses the bed when it is out.
- **Windows without curtains**: select and Pip comes to look out. **Books**:
  select and Pip comes and reads one. **Lights**: select to switch off or on;
  off, a light is drawn unlit and casts no glow after dark (the floor lamp
  now casts one when lit).
- **The fridge** (the Bedroom's mini fridge): select to open it, and again to
  shut it; left open it shuts itself after 8 seconds. Lit shelves, a hum while
  open, a click and thud as it shuts, and after dark its light pools on the
  floor. Pip hears it and comes over hopefully. The Play rail's **Snack** key
  sends her to it: she opens it, waits while a snack is chosen and eats it
  there. Opening it gives nothing; snacks are still bought as they are given.
  It is a fixture, not decor (`home.js`, `fridgeBox`; id `minifridge`, since
  `fridge` is the unshipped Kitchen's decor item): every Pip has one, it is in
  no slot, shop, catalogue or saved layout, it cannot be moved in Decorate,
  and it stands in whichever of three gaps between the floor spots the
  reader's pieces leave free.

**Pip has habits** (`pip/behaviour.ts`: `fridgeVisit`, `scrollSession`,
`nightStir`; moves in `house-moves.js`; tests in `pip/habits.test.ts` and
`pip/fridge.test.ts`). After dark (19:00 to 06:00) she raids the fridge: over
on tiptoe, a long stare into the light, something small or nothing, and back
to bed; one time in four she shuts it, wanders off and comes back to look
again. Curtains opened or a light switched on catches her. Late (21:00 to
05:00) she takes her phone to bed about every other night: scrolling, a laugh,
a frown, "one more", the phone on her nose, asleep with it on her chest; the
later the hour the longer. Tap her and she hides it ("i was reading."); draw
the curtains or put the light out and she winds down. By day the phone is a
glance, the fridge a short look; one read in five drifts to the phone and the
book wins. In the morning she hits snooze once, and about every other morning
looks in the fridge on getting up. Asleep for the night she stirs now and then
(a 0.3 chance each half minute, at least 3 minutes apart), but not within 20
minutes of the reader putting her to bed (`TUCKED_QUIET_MIN`). All of it is
for show: no seeds, no mood, nothing bought. Under reduced motion: still poses
with the lines.

**Book nods** (`pip/bookNods.ts`, scenes in `pip/books/`, tests in
`pip/bookNods.test.ts`). Pip knows 549 books and series (336 entries): fantasy,
young adult, romance and rom-coms, mysteries and thrillers, classics, science
fiction, self-help and non-fiction, Indian favourites, manga and comics. Open
one and she plays a little scene about it with a line of her own: sparks and a
white bird for Shatter Me, a deerstalker and magnifying glass for Sherlock
Holmes, a straw hat on the wind for One Piece. Always the first time a book is
opened, then about one open in four, and now and then in her idle time while
it is the current book (`NOD_ODDS`). Chatty mode only; a book untouched for 30
days gets the dusty-book line instead.

Matching is on the file's own title and author, tidied (case, accents,
apostrophes, "&", "Doyle, Arthur Conan", initials). Each entry says what is
enough to claim a book: a `title` alone; `titleBy`, a title that counts only
with its author, for short or common ones ("It", "Emma", "Legend", "Wonder");
or an `author` alone, for a writer whose every book fits (Agatha Christie,
Conan Doyle, Jane Austen, Chetan Bhagat). A title always speaks before an
author, and a bare short title with no author matches nothing. Wings of Fire
is told apart by its author: Abdul Kalam's memoir and the dragon series get
different scenes. Scripture is left out on purpose, and retellings of sacred
stories get plain scenes.

A book she has never heard of still gets a generic scene for its genre
(romance, mystery, thriller, horror, fantasy, science fiction, historical,
humour, poetry, biography, self-help, young adult, children's, comics and
manga), read from the book's genres. These play less often (one in two on
first open, one in ten after) and never claim to know the book ("a love story.
i'm invested."). The diary quotes her only on books she knows.

The scenes are 71 animations drawn in code. Her lines are her own words: never
a quotation, never a spoiler. The table is 92 KB of source imported at
start-up; moving it behind a lazy import would mean making `nodFor`'s three
callers asynchronous, and has not been done.

**Pip knows your book** (`pip/genre.ts`, `pip/readingMoments.ts`, planned in
`pip/behaviour.ts`, tests in `pip/bookLife.test.ts`; the house gathers it all
as one `world` input, `pages/pip/usePipWorld.ts`). The genres of the book last
opened (`books.genres`, free-form; `genreMood`) set a mood: horror, mystery,
fantasy, science fiction or romance. After dark a horror sends her to bed on
tiptoe, under the quilt, then down with a torch to check beneath the bed; by
day it is a glance over her shoulder; and the night after one (read within 6
hours) about one night stir in four is a look out from under the quilt. A
mystery brings out the magnifying glass and a trail followed along the floor.
A fantasy is a cape, a wooden sword and a quest across the room. Science
fiction is a look at the sky, a romance a sigh. These are activities with
weights like the others (2 within 90 minutes of that book being read, 1.2
within a day, 0.6 within a week, then none), never constant states.
**Reading moments:** a book closed 12% to 85% of the way through a chapter,
after at least 3 minutes in it, gets "you stopped *there*?" on the next visit
to the Pip tab within the hour, once (the text reader leaves
`leaflet.pip.lastStop` on closing; the page reader has no chapters and leaves
none); for 24 hours after a book is finished (finished, and its progress last
moved within the day: `progressUpdatedAt`) she now and then lies on the floor
with it on her chest, and opening an old finished book does not bring that
back; a book begun, unfinished and unopened for 14 days (the most recently put
down only) is dusted off and named. All for show: no seeds, no mood.

**Her bookcase, her book, the fridge door** (fixtures of the bedroom, like the
fridge: `home.js`, `fixtureBoxes`; rules in `pip/bookSpines.ts` and
`pip/furnish.ts`; what each shows and opens is one table,
`components/pip/roomThings.tsx`; cards open in `RoomCard.tsx`, placed by
`cardPlace.ts`).

- **Her bookcase** hangs on the wall. Every book the reader has finished
  (`isFinished`) is a spine in it, in its cover's colour, the most recently
  finished first (by when its progress last moved, `progressUpdatedAt`). Up to
  44 stand in rows on four shelves; past that the lowest shelves become stacks
  (up to 83 on show); past that a tag on top says how many there are. A
  cover's colour is its dominant one (`dominantColour`: by hue, vivid pixels
  counting for more, never the average), made legible, read once from the
  thumbnail and kept in `localStorage` (`leaflet.pip.spines`, this device
  only, cleared by Delete All Data); a book with no cover gets a colour from
  its id. Select it for a card of the finished books: one with highlights
  opens them, one without opens the book.
- **The book in her hands.** Reading in the house, Pip holds the reader's
  current book (the last opened that is not finished): its cover's colour and
  a ribbon at the reader's place (`pip/furnish-art.js`, `readingMove`).
- **Fridge notes.** The reader's latest highlights are pinned to the fridge's
  lower door, up to three, one from each book while there are books to go
  round (`pinnedNotes`; the highlights of the six books last open that have
  any). The lower door opens them in a card (words, book, chapter, "Open in
  book"); the freezer door still opens the fridge, as do the keyboard and the
  Snack key. No highlight: no note.
- **Decor with a job** (`pip/house-fixtures.js`). A **wall calendar** with
  today's date and a square a day, green where the goal was met, teal where a
  freeze or grace kept it (`pip/roomTime.ts`), opening the reading calendar. A
  **wall clock** with the real time and, while a focus session runs, a wedge
  for its reading minutes left; it is drawn on a canvas of its own, so a new
  minute does not redraw the room. A **houseplant** on the fridge that only
  free reading waters (`pip/houseplant.ts`, from the snapshot's `freeReads`;
  nothing stored): each free minute is water, draining by two fifths a day
  over a week; thriving at ten, then fine, thirsty, drooping. With no free
  reading in a week it rests and looks fine, so a reader who reads only in
  focus sessions is not shamed; it never dies. It grows a leaf for each hour
  of free reading ever (up to six) and a flower for every five (up to three).
  Free reading does not water the garden; it waters this plant. A **radio** on
  a bedside table: dial lit when the ambience is on, notes rising while it
  plays, opening its panel (see The radio). An **album board** under the
  window with the three newest finds pinned up, opening the album. **Pip's
  diary** on top of the bookcase, a ribbon out of it once today's page is
  written, opening the diary.
- All of these are free fixtures every Pip has, in no shop, slot or saved
  layout: the existing clock and plant pieces cost seeds or belong to floors
  the shipped house cannot place. The bedroom is now full; a ninth thing goes
  on another floor or replaces one.
- Each offers Pip something to do of her own accord (a spot's `offer`, done by
  the planner's `potter`, so a new thing needs no planner change): she admires
  her books, looks at the calendar, squints at the clock, talks to the plant
  (she does not water it), fiddles with the radio, looks at her finds.
- A thing that opens a card is never smaller than 24 CSS px a side to choose
  (`targetBox`).

**Out, and back.** While a focus session runs Pip is on an expedition
(`world.away`, from `useExpedition`): not in the house, a note on her pillow,
the room otherwise alive. When it ends, or the tab is next opened within 12
hours, she comes in by the right wall with the find held over her head, shows
it, and it is marked seen (`leaflet.pip.findSeen`, this device only). See
Expeditions and the album.

**Company.** `PipPage` mounts `Visitors` over the room (see Visitors). Pip
answers the knock, greets the visitor by handle, reads beside them
(`company`), and never crosses their box in anything she does (`stopForVisitor`,
`crossesVisitor`, tests in `pip/company.test.ts`).

**The cold's face.** `snapshot.cold` shows as a blanket, a pink nose, a slower
walk (0.55 / 0.7 / 0.9 of her pace by thirds of `cure`), longer rests,
tissues, tea, and none of the lively activities, easing as today's reading
nears the goal; the mood panel says why and what cures it (`pip/cold.ts`,
`coldWords`). When the reader's reading cures it she says so. Tests in
`pip/coldFace.test.ts`.

Drawn curtains, a picture's place and tilt, and lights switched off are kept
in `localStorage` (`leaflet.pip.furnish`) on this device only, outside the
backup. The saved layout is unchanged: Decorate still decides which piece is
in which slot, and the hand only tilts, slides, draws and switches. Nothing
here earns seeds or mood.

Over the room, the **seeds** and Pip's **mood** (five hearts) share one plaque,
with a **goal** beside them when one is pinned from the shop: its progress in
seeds, a cheer once it is affordable (kept in `localStorage`). Under the room,
one leather rail of tools:

- **Shop**: the one place seeds are spent (below).
- **Pip's things**: what Pip owns, to use. Looks (variants and accessories by
  slot, earned skins as goals), treats (snacks, bought as they are given, and
  toys), moves (do one, make it the signature). Each tab counts the set
  ("Moves 8/22") and ends with a way into the shop for more.
- **Garden**: plots, their water and minutes to go, picking; rules as short
  hints. Selecting an empty plot in the garden opens its seed packets right
  there.
- **Decorate**: a mode. A pin on every slot of the floor, a gold edge round the
  room, and a rail of its own with Wallpaper, Flooring and **Done**. A pin opens
  a low sheet of what Pip owns that fits there, and a link to the shop filtered
  to that spot. Items snap to slots and are in one place at a time.

A first visit gets a six-step walkthrough (seeds and mood, Pip, playing, the
shop, decorating, a plot), shown once; "?" in the HUD plays it again.

**The shop** is a large dialog with a tab per kind of thing (Variants,
Wardrobe, Decor, Book Nods, Treats, Moves, Walls & flooring, House: floors and
plots), each counting how much of it Pip has: big tiles with the thing drawn
large, a price chip, "Owned" and "Equipped" badges, and what is out of reach
greyed with "N more seeds · ~M min of reading". Selecting a tile opens it on
the right: a big preview, what it is, **Try it on Pip** (the house's Pip wears
it or does it, with a bar to buy, go back to the shop, or stop), Buy or Wear /
Place / Use, and **Pin as my goal**. A purchase of 30 seeds or more asks first,
with the thing and its price and Buy as the main button. Below 30 nothing is
asked: it happens at once (Pip eats the snack, wears the hat, the seed goes in)
with an **Undo** toast for a few seconds, and is bought only when they are up
(Rust keeps no refunds, so an undone purchase was never made; `quickBuy.ts`).

**Book Nods** are original house items that tip their hat to famous books
(each with a `nod`, the book). If a book in the reader's library matches
(title matching like Pip's book scenes, `nodMatches`), the tile wears a "From
your library" ribbon.

### The Attic Arcade

Floor 3 in the lift, in every build. Each machine opens its game (the cabinet
Pip Dash, the television Page Flap, the claw machine Leaf Catch; the jukebox
is a dance), and Pip walks over and plays in its own time. A Pause button is
there for pointer users.

Three mini-games, on the Attic Arcade floor (select a machine, or Arcade):
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

**Word Quiz and My words** (`components/pip/arcade/quiz/`). A fourth tile. Pip
holds up a word the reader looked up and offers four meanings (or a meaning
and four words); the wrong answers are the reader's other words, topped up
from a small built-in list while they have few. Rounds of ten, due words
first. A box per word (`boxes.ts`): right moves it up (rest 1, 3, 7, 14, 30
days), wrong back to the first; the box and due day are kept in the word's
row, saved per answer. Fewer than four words: the game says how to get some.
**Who is this?** is a second mode from the character sheets, offered with the
tracker on and four people with a note: every name and note passes `castAt`
at the book's saved progress, so it cannot spoil. **My words** lists the words
newest first with meaning, book and place, Open in book and Remove. The quiz
pays nothing: no seeds, no mood, no score (it is not recorded as a game
played). Keys: 1 to 4, Enter, Esc.

### Pip's diary

**Where:** `pip/diary/` (pure: `facts.ts`, `entry.ts`, `templates.ts`,
`week.ts`, `seed.ts`), `components/pip/diary/`, `commands/diary.rs`

The diary on top of her bookcase opens a little book Pip keeps: a page for each day since the first day read, written by her
from what the app already knows. Nothing is typed and nothing is stored: a
day's entry is a pure function of that day's facts and its date, so it reads
the same on every device. The facts are the ledger's minutes and goal, the
shelf's sessions (which book, clean or not), each book's progress and the day
it last moved (so "finished" and "bookmark at 42%" are known for that day
only), and the highlights, characters and looked-up words made that day. There
are no page counts in the app, so no line counts pages. A character is named
only if the reader wrote it down at a place no further than the book has been
read. An entry is a lead for the kind of day and at most two asides; lines are
dealt out by the date so none is used two days running. A day off gets one
quiet line and is greyed; Earlier and Later (and the arrow keys) skip it.

**The week** is the book's other half: a 1200 x 1500 pixel postcard (days
read, minutes, books, the week's best line, the reader's Pip), drawn on a
canvas. Save as picture writes a PNG where the reader chooses
(`diary_save_picture`: `.png` only, 8 MB, checked and decoded as a PNG first;
a download in the browser preview); Copy puts the picture on the clipboard, or
its words where the clipboard takes no pictures. The card holds only what is
on its face: no name, handle or device.

### Expeditions and the album

**Where:** `pip/expedition.ts` (the rules, pure), `pip/expedition-art.js` (the
sprites), `components/pip/album/`, `components/SessionWrapUp.tsx`

Pip goes out for the length of a focus session and comes back with one thing
for her album. Nothing is stored: what a session found is a pure function of
that session (its `style_seed`, the minutes read, whether it completed without
leaving the book), so the album is worked out from the shelf every time.
Sessions from before this existed have their finds, a session that arrives by
sync brings its own, burned sessions count, and two devices with the same
shelf show the same album.

- Under 5 minutes read: nothing. Otherwise her reach is the minutes read, x1.5
  for a session completed cleanly (the garden's bonus), and the reach names a
  place: the garden gate (5), the lane (15), the woods (30), the hills (45),
  the shore (60), the edge of the map (90). Completed sessions of 10, 20, 30,
  45 and 60 minutes reach the lane, woods, hills, shore and edge.
- Each place has odds for the five rarities (common / uncommon / rare / epic /
  legendary, in 100): 90/10/0/0/0, 62/30/8/0/0, 40/34/20/5/1, 27/32/27/12/2,
  19/27/29/18/7, 18/24/27/19/12. The rarity, and which of that rarity's
  things, are drawn from the session's seed.
- 44 things: 14 common, 11 uncommon, 9 rare, 6 epic, 4 legendary. Duplicates
  count up ("x3"). At one 30-minute session a day the album takes about a year
  (median 378 days; half of it in the first month); at 45 minutes about eight
  months; ten-minute sessions never finish it.
- **Frozen once shipped**: a find is an index into these lists, so adding or
  reordering things, or changing a place's odds, would change every reader's
  album. New things need a new dated list. A test pins five sessions to their
  finds.

The album (the board under her window) shows what is found, a silhouette for what is not, and how many of each rarity remain; a
selected thing shows its name, her line, and when and in which session it was
first found. The session wrap-up says what she brought back, or that the
session was too short. For show: no seeds, no mood.

### Visitors

Behind `FEATURES.community`. On a day the reader has read (a minute on the
ledger) a friend who has also read today may send their Pip round (a friend is
a reader they follow who follows them back; a follow one way is not enough):
a knock, then their Pip, in their own look with their `@handle` under it,
walks in, waves, reads beside the reader's for three to five minutes, waves
and leaves. One at a time, three a day at most, each friend once, the first a
little after the Pip tab opens; seeded by the date and played by the clock, so
it survives refetches. If Pip is asleep or out, the friend leaves a note by
the door instead ("@handle came by"). Selecting the visitor shows what their
public profile already shows (name, streak, minutes this week) and a way to
their card. Only a signed-in reader with a public profile has visitors, and
only public readers visit. "Read today" is therefore told only to someone the
reader has chosen to follow back. Nothing is earned. Rules in
`pip/visitors.ts`, driver in `pip/useVisitors.ts`, drawing in
`components/pip/VisitorPip.tsx`. Needs the server's `GET /v1/visitors`;
against a server without it (a 404) nothing happens, nothing is shown, and the
app does not ask again for 6 hours.

### Mood

Pip's mood runs 0 to 100 in `pip_state` and starts at 70. It drifts down 8 a
day from the last time it was cheered up (`mood_at`, computed when read),
whether or not Leaflet is open, and the drift stops at 40 ("Content"): time
alone never makes Pip mope. A mood already under 40 (a reader who was away
before 1.2, when it drifted to 0) stays where it is, neither lifted nor
lowered, until something cheers Pip up. Under 20 Pip mopes; nothing is lost and
nothing withers. No notifications, no guilt.

What cheers Pip up:

- **Any reading**: +0.25 for each minute the ledger credits, in a focus
  session or not, up to +10 a day (40 minutes), by the day the minutes are
  credited to (`pip::record_reading`, hooked into `credit_reading`). It used
  to be focus sessions only, so a reader who never started one watched the
  mood fall however much they read.
- A recorded focus session of a minute or more: +5, on top of its minutes.
- A game +3 and a bout of play +1, sharing +12 a day; a ripe plant picked +2;
  the day's wish +10; each snack or toy its own amount.

The reading and play allowances and the last twelve things that cheered Pip up
are this device's alone (settings rows `pip.readingMood`, `pip.arcade`,
`pip.moodLog`): never in sync or the backup. Only the mood itself travels,
with Pip's state. A late minute for yesterday draws on what yesterday had
left, so going back and forth between days cannot hand out a second allowance.

**The hearts open "Pip's mood"** (`pages/pip/MoodPanel.tsx`, `pip/mood.ts`):
the mood in a word and out of 100, what the drift took, today's reading and
what more would add, what changed it last, and the rule. The numbers come
from Rust with the overview (`moodRules`, `moodLog`, `readingMood`), so the
panel cannot disagree with what is counted. A cold (a streak that broke) is
shown in the same panel as its own thing: why, what cures it, when it passes.
It changes no number here.

### Earning feedback

The session wrap-up counts up "+N water" (what the session poured) and any
bonus seeds, and says "2 plants just ripened!" when it ripened some. The first
time, Pip explains the garden. It also says what Pip found on her expedition
(see Expeditions), and when the session's reading cured Pip's cold, or how
many minutes more today would. The card's foot (Done) stays in view while its
body scrolls.

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

**Drawn as a portrait** (`pip/portrait.ts`, `PipSprite`'s `portrait`). An
avatar used to be the whole 32 px sprite at a whole number of device pixels,
of which a standing Pip fills 22 by 27: in the header at 125% scaling that was
a 32 px sprite in a 57 px button. A portrait is scaled to the largest whole
number at which a standing Pip fits the frame and centred on the art, so wide
poses (a sparkle, a cape's corners) are cropped by the circle;
`PORTRAIT_PX` is the knob.

---

## Pip on the desktop

**Where:** `src-tauri/src/desktop_pip/` (`mod.rs` the rules, pure and
unit-tested; `runtime.rs` the window, its thread and the commands; `win.rs`
the Win32 calls), `apps/desktop-pip.html` and `src/desktop-pip/` (her page,
the brain, the menu, the Settings row)

**Not in a release build unless it asks for her**: `FEATURES.desktopPip`
(`VITE_ENABLE_DESKTOP_PIP=true`). Without the flag the switch is not shown and
Rust is never told to make her window, because that window has not yet been
tried on a real desktop. With it: Settings → General → "Pip on the desktop".
Off by default; Windows only. While Leaflet runs, Pip stands on the taskbar's top edge in a small window of her
own (transparent, always on top, never focused, not in Alt+Tab), wearing what
is equipped on the Pip tab. She strolls, sits, fidgets, looks at the pointer,
and sleeps through the reminders' quiet hours. A click pokes her, a drag
carries her, a right click (or a long press) opens Open Leaflet / Send her
home / Hide for today. **The real window has never been opened by its
author**: see the checklist in HANDOFF.md.

- **The window is as large as she is** (64 px at 100%), so everything else
  stays clickable; the transparent corners of her own square are hers. Rust
  moves it: twelve steps a second walking, none standing. An art pixel is a
  whole number of device pixels at every scaling.
- **Her page is its own HTML entry** (`vite.config.js`, `rollupOptions.input`):
  it never loads the app's stylesheet or stores. Rust talks to it down a Tauri
  `Channel`; no capability and no `tauri.conf.json` change. Two `windows`
  crate feature flags were added, no crate.
- **Three things tao does not do are done by Win32** (`win.rs`): the minimum
  width an undecorated window is held to, the `WS_EX_TOOLWINDOW` style that
  keeps her out of Alt+Tab, and showing, hiding and moving without tao
  rewriting those styles.
- **Where she stands:** the bottom of the work area of her monitor. A top or
  side taskbar, or an auto-hiding one, leaves her the bottom of the screen.
  Another monitor is the end of her edge; she changes monitor only by being
  carried.
- **The nudge:** when the reminders' scheduler sends a reminder
  (`reminders::runtime::tick`) she holds up a sign for five minutes; clicking
  it opens the last book. Same rules as the reminders, because it is the same
  call; the toast still goes out. Never twice for one reminder.
- **Full-screen apps:** she hides while a window with no title bar fills her
  monitor, or Windows reports a Direct3D full-screen app or presentation mode.
- **Life cycle:** she exists only while Leaflet runs (closing the main window
  exits the process, so she goes with it; Store reminder toasts still arrive
  with Leaflet closed, without her). The switch, her menu and Delete All Data
  all close her window. Pip's mode Off keeps her in; Quiet stops the
  strolling. Her switch and the day she was hidden for are
  `leaflet.desktopPip.enabled` and `leaflet.desktopPip.hiddenOn`, this device
  only.
- **Reduced motion:** she stands still in the corner.

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
| Charred spine | Burned when a streak broke, by an earlier version; left in place. Nothing burns now, and the shelf's legend mentions it only while it holds one |
| Loose pages, "Free read" | A day's reading outside any focus session. Not a spine: it does not level the wood. A running session's reading is not shown as free |
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

The board lists only readers whose profile is shared. A profile created at
sign-up (1.2 and later) is public unless the reader turned the switch off on
the form; accounts from before 1.2 stay private until their owner shares, and
are never switched by Leaflet. "Make private" under Social, You, hides the
reader everywhere and (on the 1.2 server) removes the stored figures. A signed-in reader always sees **their own row** for the week, built
on the device from the same minutes as the Stats tile
(`components/community/ownRow.ts`). While the profile is private the row is
marked "Only you", is sent to nobody, and carries a "Share my profile" button.
The board ranks all reading in the local Monday–Sunday week, in or out of a
focus session. An empty board says why: nobody shares yet, nobody who shares
has read this week, or the board could not be loaded (with "Try again"); it
used to say "Nobody's on the board yet" for all three. The own row claims a
rank only against rows of the same ISO week (`weekKeyOf`, the week Rust
names), and is matched to the server's row by handle when the board was
fetched without the session, so it is never drawn twice.

Signing out forgets everything personal in the community store, including
answers still on their way and who "you" were on the Everyone board it keeps.
A session ended on the server (a password changed elsewhere, the account
deleted) is noticed at the first refused call, and the page goes to its
signed-out state. The inbox is fetched whole on each poll, so a reader who
goes private or deletes their account leaves it within one poll. An emptied
Name removes the profile's name.

**On the server** (`server/`; needs a redeploy to take effect): reading
figures are held only while a profile is public (sent for a private one they
are dropped, and going private removes them); a board being read while a
profile goes private can no longer put it back in the cache; public profiles
without a handle take no place on the board; the limit of three duels holds
for challenges sent at the same moment; names are one line of visible text.
`GET /v1/visitors` lists at most five public readers the caller follows, and
who follow the caller back, who read on the caller's day; `readDay` is held only while a profile is public and
is never returned by any route.

Only public profiles appear or can be interacted with. The words are fixed in
`components/community/copy.ts` (kudos, follow, duel, a streak in days, a week
that ends Sunday at midnight); the headers, tabs and shelf are shared
components (`ui/SectionHeader`, `ui/SegmentedTabs`, `shelf/spine`).

**Publishing your numbers.** `publish_social_stats` sends this week's minutes,
streak, books finished and shelf for a public profile, and `readDay`, the
local date, once a minute has been read that day. The app calls it when a
session is recorded, when the Social page opens (and every minute it stays
open), and on the five-minute community pulse, at most once a minute unless a
session just ended, and when today's minutes change. It used to ride only on a
Drive backup, which left readers without Drive frozen on the board. Whether
the profile is shared is asked of the server once a run and after each sign-in:
it used to be a setting of the device, so a reader who shared on another
device, or reinstalled, showed as shared and never published. A failed publish
is shown on the board with "Send again".

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

**Signing up** (`components/account/AccountForm.tsx`,
`components/account/signUpFlow.ts`). The form asks for a handle, shown and
entered with an "@" that is never stored (`community/HandleField.tsx`, rules
in `community/handle.ts`, display through `at()`), and has a "Share my
profile" switch, on by default, with a sentence listing what other readers
will see. The account is created first, then the profile is saved public. If
the second step fails (the handle is taken, the connection dropped) the reader
is signed in with a private profile and the form offers another handle or
"Keep it private for now": a sign-up is never lost half way. Builds without
the community create a private account, as before.

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

The address must be a bare one (a `?` or `#` in it used to send every call,
sign-in included, to the host's front page), and "Connected" means `/health`
answered `{"ok":true}`, not just any 200.

A reader never needs the address. The Settings card
(`components/LeaderboardsCard.tsx`) shows status only: Connected, Can't reach
it (with the reason, a note that school or work Wi-Fi may block it, and Try
Again) or Off. The address field and the note on running your own server are
under a closed "Advanced"; `SyncStatus.apiBaseCustom` says whether this device
overrides the signed address.

---

## Pip

The reading companion who lives in the app: the header logo is Pip's home, and
Pip hops out to walk the app, celebrate goals, give the tour, and be thrown
around. It has its own tab too: see [Seeds and the Pip tab](#seeds-and-the-pip-tab).
Everything else is in [pip.md](pip.md).

Thrown hard at a wall, Pip grabs it and slides down to the floor
(`pip/wall.ts`). A grab now takes all of the throw's sideways speed: it used
to keep it, let go after 1.4 seconds and grab again on the next frame, which
showed one frame of falling every 1.4 seconds all the way down.

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

## Settings

`pages/SettingsPage.tsx`. A few short sections behind tabs (**General**,
**Reading**, **Habit**, **Library**, **Account**, **About**), each meant to
fit a 1366×768 window without scrolling. Habit was part of Reading until that
made five cards, which no arrangement fitted (three columns left it 1,112 px
tall where 690 show). Measured at 1366×768, both end about 607 px down with
nothing to scroll; on a 1366×768 laptop at 125% (1093×614) Reading scrolls by
41 px and Habit by 25 (Reading scrolled by 343). The preview cannot draw the
Reminders card, which is about as tall as the card beside it. It used to be one page about three screens
long. Each section is two columns of cards from `lg` up, every card as tall as
what is in it.

| Section | Cards |
| --- | --- |
| General | Appearance; Pip (how much it moves, the tour, sounds) |
| Reading | Reading pace; Characters; Keep the words I look up |
| Habit | Daily goal and focus; Reminders |
| Library | Backup; Book copies; Optional book converter |
| Account | Account; Leaderboards (only in builds with accounts or the community) |
| About | Rate, policies, diagnostics; Danger zone |

The section is remembered for the session (`pages/settingsSection.ts`, kept
apart from the page so that asking for a section does not load it), and another
page can ask for one: "Sign in" on the Social page opens Account.

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

What a display means for the layout is the window's size in CSS pixels, and
Windows scaling divides it: a 1366x768 laptop at 125% gives the app about
1093x614, a 1080p laptop at 200% only 960x540, an ultrawide 3440x1440. The
pages were measured at thirteen sizes from 380x480 (the smallest the window
goes) to 3440x1440, by a script, since the preview cannot be looked at.

**A page has a widest size.** The Library and Collections stop at 2,240 px and
Social and Settings at 1,480 px, centred, so a 4K or ultrawide window gets more
covers to a row rather than larger ones and a settings card never runs a line
across the screen. The Pip tab fills the window.

**The cover grid counts its own width, not the window's**
(`library/gridColumns.ts`, used by `BookGrid` for both the plain and the
virtualised grid): 2 columns under 520 px of grid, 3 from 520, 4 from 760, 5
from 1,040 (a desktop window), and past 1,500 as many as keep a cover at or
under 270 px. A cover is between about 150 and 275 px wide from 520 px of grid
up; it used to be 150 px at 1024 wide and 633 px on an ultrawide.

**Height is a breakpoint too.** The Library's hero and import box sit side by
side from `md`. In a window at least 768 px wide and at most 820 px high
(1366x768, 1093x614, 960x540) the hero gives up padding, its title drops to 36
px and the import box drops its formats line (`@media (min-width: 768px) and
(max-height: 820px)` in `index.css`), so the first row of covers starts on the
first screen: at 1093x614 it began 962 px down and now begins at 510.

**Nothing makes the page scroll sideways.** Filters are capped and truncated
(an author select was as wide as its longest name), list rows wrap, and grid
and flex items that hold long text have `min-w-0`.

**Dialogs fit the window.** `.dialog-fit` caps a dialog at `100dvh - 1.5rem`
and scrolls it inside itself; the account dialog scrolls in its overlay and is
centred with `m-auto` (a centred flex item that overflows cannot be scrolled
to its top).

**Fixed bars are cleared.** `.dock-clear` on a page adds 84 px under its last
row while the "now reading" bar exists; `.app-toast` sits above that bar under
1,536 px and above the bottom bar on a narrow window, and is never wider than
the window.

Tailwind's `min-[..]` / `max-[..]` variants are unavailable here (the `short`,
`tall` and `touch` screens are raw queries): write
`[@media(min-width:1900px)]:`. Pill tabs (`ui/SegmentedTabs`) wrap to a second
row rather than scroll.

**The Pip tab.**

- The room is drawn at the largest whole or half number of device pixels per
  art pixel that fits the page's width and the height left under the HUD and
  over the rail (`sceneFit.ts`): 240 x 120 at 380 x 480, 600 x 300 at 800 x 600
  and 960 x 540, 672 x 336 on a 1366 x 768 laptop at 125%, 1320 x 660 in the
  default window, 2280 x 1140 on a 3440 x 1440 ultrawide (height-bound,
  centred).
- The HUD and the rail line up with the room but are never narrower than
  `min(100%, 800px)` (`--bar-width`): following a small room they wrapped,
  took its height, and it shrank again (at 800 x 600 and 960 x 540 the room
  was 360 x 180 where 600 x 300 fits). Under 900 px wide or 620 px tall the
  first steps show their count only.
- A drawer stands beside the house from 900 px wide, and from 768 px on a
  window 520 px tall or less; it is a sheet at the bottom (44dvh) only under
  that. The rail shares one row whenever it is under 560 px wide (a container
  query), and Play's eight keys shrink to their names before they wrap.
- The shop's tabs are one scrolling row under 900 px wide or 620 px tall; its
  detail goes under the grid only under 700 px.
- Cards over the room (and a visitor's card) are laid over the whole window
  and placed by `cardPlace.ts`, so a small room never clips them. The album
  lays itself out by its card's width: the card is the container, not the
  album (its container query never applied, at any size).
- Pip outside her tab: her floor is the top of the bottom tab bar when it
  shows; a tour bubble that fits neither side of her goes over or under her
  (at 380 x 480 it sat 189 px off the window with its buttons out of reach).
- Every thing in the room is pressed in an area of its own (`pressAreas`,
  `pip/furnish.ts`): its art grown to 24 px a side (44 under a finger), inside
  the room, and never over another's. Two that would overlap are divided
  halfway between their art; where art overlaps (the diary on the bookcase)
  the one on top keeps its own; a thing with room to spare stands back for a
  neighbour that has none. The art is untouched: the gold edge is drawn round
  the thing, not the area. With a pointer every thing is at least 24 x 24
  from one pixel a pixel (380 x 480, where the fridge was 12 x 20 and its
  press overlapped the plant's by 30%). The smallest window at 125% (a 192 x
  96 room) leaves the fridge 24 x 22 and the plant 24 x 19; with notes
  pinned, the freezer door is as tall as it is drawn. Under a finger every
  area is 44 x 44 from room scale 2 (800 x 600) up; a 240 x 120 room cannot
  hold twelve of them.
- Under a finger the lift's keys are 44 px. It shows one floor sooner, and
  in a room under 144 px tall it is one key whose list reaches every floor.
  A diary day is pressed in the 44 px about its square.
- The room is measured again when the display's scaling changes, not only on
  resize (`watchPixelRatio`, `components/pip/pixelRatio.ts`): moved to a
  monitor with other scaling it kept its old size for some seconds.
- The table of Pip's nods to books (`pip/bookNods.ts`, 77 kB built) is fetched
  when a nod is first looked up (`pip/nods.ts`, 7 to 12 ms), not with the app:
  the main chunk went from 365 to 289 kB.

**The readers' chrome** (both readers; CSS and class names only).

- A toolbar popover (`.reader-menu`: text settings, search, characters, notes,
  page size, "···") is never taller than the window less the toolbar less
  1rem and scrolls inside itself: the "···" menu is 546 to 597 px tall and its
  foot was at 609 in a 540 px window. Under 640 px wide the popover is fixed
  8 px from each side (text settings began 116 px off the left of a 380 px
  window).
- The toolbar's title is no wider than `min(46vw, 100vw - 39rem)`
  (`readers/titleFit.ts`; six buttons on the right when the radio's mark
  shows): a 200-character title at 800 wide lay over the chapters button. Under 768 px the title is hidden and "Back to Library" is
  its arrow, so five to seven buttons fit a 380 px window.
- Things pressed are 24 px with a pointer (44 px on touch for the toolbar's
  buttons, the Contents handle, the dock's chapter name and the list's close):
  toolbar buttons, line-width options, the notes and characters tabs, the
  dock's percent and the page reader's "Page 1 of 600". The 18 px highlight
  dots, the bookmark's cross, the look-up card's two text links and the 14 px
  progress bar keep their look with a 24 px press area behind them. The
  dock's and SpeedRead's small labels are 11 px.
- The reader's toast (`.reader-toast`) sits above the dock under 1,400 px
  wide, and above the pace control while one shows: its longest line lay over
  the dock at every size from 380 to 1366 wide.
- Under 520 px of height the chapter list drops the book's cover, title and
  author, so the list has the height (155 to 282 px of scrolling list at
  844 x 390).
- Measured by script at all thirteen sizes, in both readers and both layouts,
  on a four-novel set, a novel and a 600-page PDF (78 runs, each in a frame of
  the wanted size: `shell-sweep.html` among the test aids). The dock's long
  line in a set ("A CLASH OF KINGS · ARYA 1 of 26 14% · set 26%") is one line
  at every size, its arrows inside.
- Not reached: the Relations drawing with people in it, the page reader's
  Back chip, the dock with a very long chapter name at 380 wide with pages.
- Left: the dock at rest is drawn at 86%, so its 28 px controls measure 24
  until the pointer is on it.
- For the phone (report only, 360 x 800 with touch): seven toolbar buttons at
  44 px do not fit 360 px (the "···" button is outside the window); the dock's
  controls, the selection bar's ten and most of the Characters panel are under
  44 px; the progress bar, the time left, the strip that brings the toolbar
  back and the dock's resting state all wait for a hover. See
  [mobile.md](mobile.md).

Known and left: a 380-wide window gets the sidebar rail (the `short` rule),
leaving 264 px of content, which everything now fits; Settings' Reading tab is
longer than a 1366x768 window and scrolls with the page; a window resized by
dragging its edge was not verified (the preview sends no resize events).

Also: safe-area insets for notches, 44 px minimum touch targets, `100dvh` for the
shell (a definite height — `min-height` gives `flex-1` no free space to divide,
which moves scrolling from the main column to the whole page), and the app header
auto-hides on scroll **on small viewports only**.
