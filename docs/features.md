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

**Tidy a folder** (after 1.3.1; Settings, Library; `storage/tidy.rs`,
`commands/tidy.rs`, `library/tidyPlan.ts`, `library/tidyNames.ts`,
`components/TidyFolderCard.tsx`). The owner keeps their book files in one
folder under the names the sites gave them and asked for Leaflet to "rename my
files locally so they are well sorted". The card renames and sorts the book
files of a folder the reader chooses: `Author\Series\01 - Title.ext` for a
book in a series, `Author\Title.ext` otherwise, `Unknown author\` where
nobody is named. A file whose bytes are a book in the library takes the
title, author and series the library shows (so a well-known series is sorted
though no file names it); any other file goes by what it says about itself,
read as import reads it, and a series only where it is named outright.
Nothing happens until asked: Preview lists every change (`tidy_scan`, then
the planner on the page), and only the Rename button moves anything
(`tidy_apply`, which trusts nothing the page sent: each path is checked to
be a plain, legal name inside the folder, a book file keeps its kind, links
and junctions are not followed). Names are made safe for Windows and
shortened so the whole path opens; two books wanting one name get `(2)`; a
second copy of the same book stays where it is and is counted. No file is
deleted or written over, and a folder is removed only when the run emptied
it. Undo puts the last run back (`tidy_undo`, from `<app data>/tidy-undo.json`,
which is written every 25 moves so that a run cut short can still be undone),
after a restart too, for every file still where the run put it. The library
is untouched: Leaflet reads its own copy of each book. A whole drive, the
home folder, AppData and the sync folder are refused. It is asked for each
time; nothing watches a folder. Book copies look two folders down for a book
that is there already (`find_same_book`), so a copies folder that has been
tidied is not filled a second time. Tried end to end on a copy of the
owner's own folder in the temporary directory (the folder itself only read;
numbers only): 25 files, 11 into `Author\`, 14 into `Author\Series\` with
their numbers, every book byte for byte the same after, and all 25 put back
by Undo. That trial found Undo refusing to give a file back a name longer
than Windows opens, which was the name it had; fixed. The three steps are
kept (`storage::tidy::probe`, `library/tidyProbe.test.ts`). Not checked: the
card on a screen, the folder picker, a run through the app.

**Packing books smaller was measured and not built.** The owner asked
whether copies could be compressed to save space. An EPUB is a zip already
and its pictures are JPEGs: packing the owner's 23 files again as hard as a
zip allows took 68.8 MB to 67.8 MB (1.5%; the EPUBs 0.1%, half their bytes
being pictures). Anything more means making the pictures worse. What takes
the space is that a book can be on the disk three times (the reader's file,
Leaflet's own copy, the book copy).

**Metadata enrichment** (`metadata/`) fills in missing title, author, genres and
cover from **Open Library**, falling back to **Wikipedia**. Titles are normalised
first (`metadata/normalize.rs`) because filenames from the wild carry ISBNs and
site names. Results are cached with a `metadata_checked_at` stamp and a **14-day
cooldown** — some books simply have no match upstream, and without the cooldown
the app re-queried them on every launch forever.

The stamp is for a lookup that was really made (1.3.1; `lookup_was_made`).
A lookup that got no answer (offline, the catalogue slow or down) or was
offered a cover that would not download used to be stamped all the same, so
a famous book added at a bad moment went a fortnight with no cover: the
owner's copy of a novel everyone knows sat at "No cover yet" while the
catalogue had its cover all along. Unstamped, it is asked for again the next
time the library loads. Schema 6 clears the stamp of every book still without
a cover, once, so those get their turn again. Among a search's results the
book is the closest title, then one with a cover, then the catalogue's first
(`best_match`): it was the last of the equals, cover or none.

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
`save_page_cover`): drawn 600 px wide, 2.5 s after the book is open and a
lookup has had its turn (answered or not, in this run of the app or before),
and never in place of a cover. A blank first page is not used. Since 1.3.1
the page is a stand-in, kept as `<hash>-page.jpg` beside where a real cover
goes: the book still counts as one to look up, and a lookup that finds its
real cover replaces the page (`storage::is_page_cover`, `isStandInCover`).
Before, a title page saved after a failed lookup was the cover for good. The
reader also goes by the library as it is now and not by the book as it was
when it opened: a PDF opened straight after being added, with its lookup
still out, never got its page until it was opened a second time. And a
lookup that ends after a page was saved keeps the page in the database (it
used to write back the "no cover" it had read at its start).

**The import dialog says what happened**, as a drop does
(`import_books_report`, `library/importSummary.ts`): how many books were
added, which were already in the library by title, and each file that was not
added by name with why (two named, the rest counted). A drop hands over every
file, so a picture among the books is named instead of vanishing. A toast
stays up for as long as its length needs (`toastMs`: as before to 45
characters, then 55 ms a character, 14 s at most).

Known and left: the same book in two formats is two books with separate
progress, listed under "Possible duplicates" and counted once in its series.

**A PDF's subject and keywords are its genres** (2026-10-12; `storage/pdf.rs`,
`metadata/normalize.rs`). They were not read. The Subject and Keywords of
the file's own description (or, where it has neither, the keyword list in
its XMP) are cut at commas, semicolons and the like, and go through the same
cleaning and the same cap of eight as an EPUB's. A PDF's are doubted first
(`tool_subjects`): a field that reads as a sentence is dropped whole, and so
is an entry that is the book's own title, its writer, a program's name, a
file name, an address, or has a digit in it. PDFs already in a library get
theirs the first time 1.4 is opened: the library is read again once
(`SERIES_SCAN_VERSION` 5, as it was for versions 2 to 4). Known soft spots:
keywords separated only by spaces become one tile, a short phrase that is
not a genre ("Annual report") passes, and "20th century" is dropped for its
digit. Tried with made-up inputs only, not with a real PDF.

Covers come **from inside the book first**: at import, the EPUB's own cover
image (the EPUB 3 `cover-image` item, the EPUB 2 `<meta name="cover">`, or an
image named like a cover) is saved as its cover, found through
`META-INF/container.xml` like the rest of the package (`storage/epub.rs`). Only
a book without one is looked up online. Covers are saved to
`covers/<sha256>-cover.jpg`, only after the bytes are checked for a real image
signature (a 404 page was once cached as a permanent "cover").

**Large libraries.** The grid and list draw only the rows on screen once a
library passes 60 books (`components/VirtualRows.tsx`). Since 1.5.8 rows are
moved by writing their position straight to the page while the list scrolls,
so React draws again only when a row comes into reach or leaves it; the first
draw starts where the scroll area already is, and the row holding the
keyboard's focus stays drawn. Metadata lookups run three at a time with a
15-second timeout, and write to the library in batches.

**Cover thumbnails come from Rust** (1.5.8; `src-tauri/src/storage/thumbs.rs`,
`src-tauri/src/cover_protocol.rs`). Drawing a full cover (up to 2000 px) in a
card made the web view decode about 10 MB of pixels for every card scrolled
past. Each cover is now decoded once, off the window's thread, and written at
two widths beside it (`<hash>-thumb-240.jpg`, `<hash>-thumb-480.jpg`). Cards
ask for `cover://localhost/<book id>?w=240` with a `srcset`, so the web view
picks the width for the card and the screen; no base64 crosses the IPC bridge.
The URL carries the cover's file name, so a new cover is a new URL. A cover
with no thumbnails yet (a library from before them) is answered with the full
cover while they are made in the background. The old single 360 px thumbnail
(`-thumb.jpg`) is removed when the pair is made (`hooks/useCoverSrc.ts` picks
the source).

**Storage** (1.5.9; Settings → Library → Storage, `components/StorageCard.tsx`,
`commands/space.rs`, `storage/sweep.rs`): how much room books, covers and the
cache take on this device, and **Free Up Space**, which empties the web view's
cache and removes files no book uses. Leaflet does the same tidy by itself
about once a day, a little after start-up. Books, highlights and notes stay.

**Search inside books** (1.3; the row under the library's search box, in the
app only): the words typed are looked for in the text of every EPUB in the
library, and of the EPUB kept beside a Kindle book or a text file that has
been opened once. A book is never converted for the sake of a search, and
PDFs and comics have no text to read, so they are counted as "not searched".
Each book is read a section at a time in reading order: the markup is taken
off by hand (a parser stops at the first unclosed `<br>`), scripts, styles and
the head are left out, and a paragraph's end parts two words where an `<em>`
does not. Matching is the in-book search's: whatever the case, without the
accents typed, and a typed apostrophe finds a curly one (the in-book search
gained that too, so the two agree). Every match is counted and the first five
of a book are shown with about sixty characters each side, cut between words;
books arrive as they are finished, the most recently read first, and end
sorted by count. A newer search stops the one before it. Fourteen books
(17 MB of text) take about a third of a second in an optimised build.
Picking a match opens the book there: the place is the section, which of its
matches, and the words (`find:<spine>:<nth>:<href>` and the words on a second
line), found again once the book is open and marked like a result of the
in-book search, with that search open on the same words. It is a look, as a
highlight opened from the library is: the saved place stays where the reading
stopped until the reader stays two minutes. When the words are no longer in
the section the book opens at its start; when the section is gone, where the
reading stopped. `src-tauri/src/search.rs`, `readers/findPlace.ts`,
`components/search/`. The two sides read a section's text by the same rules
and have to change together. Checked: opening at a match in the preview (the
41st of 107 in a chapter came to the top of the window, the find panel open on
the words, the saved place untouched). Not checked: the dialog itself and the
command over IPC, which need the app. PDFs are covered too (next paragraph).
Accents beyond Latin European letters
must be typed in the library search (the in-book search folds everything).

**Search inside books covers PDFs** (1.3.1; `src-tauri/src/pdf_text.rs`,
`readers/pdfTextCache.ts`, `readers/pdfFindPlace.ts`,
`components/search/readPdfBook.ts`). Rust cannot read a PDF's text well and
pdf.js can, so a PDF's text is read once by the page and kept on this device
(`<app data>/text/<sha256>.json.gz`, a string a page); after that the search
reads what was kept, as fast as it reads an EPUB. It is kept when a PDF with
no table of contents of its own is opened in the reader, which reads every
page anyway to find its chapters, and otherwise the first time a search meets
the PDF: the dialog says "Reading 3 PDFs…" while it reads them, one at a
time, and closing it or typing something else stops the reading where it is.
A match in a PDF is shown with its page ("p. 12", counted from the file's
first page), and picking it opens the book on that page with the reader's own
search open on the same words (`pagefind:<page>:<nth>` and the words on a
second line). The words are matched as in an EPUB, and a word broken over the
end of a line is found whole; the reader's PDF search now also takes a typed
apostrophe for a curly one, so the two agree. A phrase that runs from the
foot of one page onto the next is not found here, though the reader's own
search finds it. A scanned PDF has no text: it is counted as "not searched",
and the count says why when the pointer rests on it. Comics are not searched.
No more than 20,000 pages and ten million characters are kept of one PDF.
The text is removed with the book, and all of it by "Delete All Data"; it is
not synced. Reading 600 pages of text took 0.4 s in Node, and searching what
was kept of them about 0.1 s in a debug build. Trying this in the preview
found a fault older than the search: in the Scroll layout a PDF opened at a
place (a search match, and a highlight before that) showed the page it was
last read at, because a go-to made before the pages were first laid out was
overwritten by the saved place. `PdfScrollPages.tsx` now keeps what was asked
and goes there once the pages are laid out.

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

**A series in parts, and the books beside it** (after 1.3.1;
`library/knownSeries.ts`: `parts`, `extras`; `components/collections/SeriesDetail.tsx`).
The owner's Mistborn page listed seven books in one run, though they are two
series of three and four, and gave no sign of which books can be skipped. A
well-known series may now name its parts (Mistborn's two eras, a trilogy and
its prequels, the Witcher's stories, saga and standalone: nine series so far)
and the page puts a small heading where each begins, with its numbers. It may
also name books beside its main line (a novella between two novels, a
prequel: seven so far). Those are shown with their kind and "optional", are
placed where they are best read and not where a shop numbers them (Mistborn:
Secret History after the sixth book, as its writer asks, not at 3.5), and are
left out of "n of m read", of what is missing and of what is next until the
main line is read. A file that names a part as if it were the series ("Wax
and Wayne, #1") joins the whole series at the right number.

Two files of the owner's did not join their series. One wrote its own title
where its author goes, so its author was not the series' author: such an
"author" is now nobody, on the page (`knownSeriesFor`) and in what is stored
(`metadata::normalize::identify`; `scan_series` version 4 reads the books
already in the library again, and a book left with no author is owed a
catalogue lookup at once, not after the fortnight's wait). And a book whose
title is one of a well-known series that is already in the library joins it
whatever its file says of its author, when the title is three words or more
("The Alloy of Law" with The Final Empire on the shelf; never "Eclipse").

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

**Genres are a wall of tiles, each a shelf of its own** (1.4;
`library/genres.ts`, `components/collections/GenreTile.tsx`). The owner asked
for the library "by genres in collections... similar to how spotify shows".
A genre was a chip under "Browse by" that sent the reader to the library with
a filter set. It is now a block of colour with the genre's name, how many
books, and one of its covers leaning out of the corner; twelve show, with
"Show all". Selecting one opens that genre inside Collections: its books,
the ones being read first, then the unread (newest first), then the
finished. "Fantasy" and "fantasy " are one genre, under the spelling most
books use; a book with several genres stands in each. The colours are the
session shelf's twelve cloths, handed out so that neighbours differ. Authors
are still chips. Nothing is stored: it is worked out from the genres the
books already have. Not done: rows inside a genre (new, popular), since a
library has no "popular". The commonest other spellings of a genre are one
tile now (`library/genres.ts`, a short alias list: "Sci-fi", "SF" and
"Science Fiction"; "YA"; "Non-fiction"; "Biographies"): that was a limit
written here, closed on 2026-10-12. The Library page's genre filter still
lists the spellings as the books have them.

**The Bharat Trilogy** (1.4; `library/knownSeries.ts`). The second book's
file names the trilogy and the first's says nothing, so the series had one
book and one book is not listed. It is in the known list now, which numbers
the first. The general case stands: a series only one of whose books names
it, and that the list does not know, is not gathered.

**A PDF takes its first page for a cover without being opened** (1.4;
`library/pageCoverQueue.ts`, `hooks/usePageCovers.ts`). It did so only when
opened (below, "A PDF's first page as its cover"), so a PDF added and not yet
read stood as "No cover yet": the owner's 43 MB scan of a history book,
which no catalogue has a cover for. The library now makes them itself: four
seconds after it settles, one book at a time, for each PDF with no cover
that a lookup has had its turn at; never while a book is open. The file is
read, the page drawn and the file let go; the PDF reader's code is loaded
only then. A PDF over 200 MB is left for its reader, as before (the whole
file is held in memory to draw one page). A book tried is not tried again
for 14 days (`leaflet.pageCoverTried`), so a file that cannot be drawn is
not read at every launch. And a blank first page gives way to the second or
third (`COVER_PAGES`): a scan often opens on a blank sheet. Checked on the
owner's file in the preview: 500 pages, a 600 x 849 JPEG of 85 KB, about a
second. Not checked in the installed app.

**The Hobbit stands with The Lord of the Rings** (1.4;
`library/knownSeries.ts`). It was in the library and not on the series' page:
it is not one of the three. It is listed as the optional book before them
("Prequel · optional", number 0), and The Silmarillion as a companion after;
the count stays "of 3".

**A series can change its covers** (1.4; `metadata/editions.rs`,
`commands/covers.rs`, `components/collections/SeriesCovers.tsx`). The owner
found the covers a lookup gave The Lord of the Rings ugly, and asked to choose
"which series of covers" from the top of its page. **Covers**, beside the
series' Start button, asks Open Library for every edition of each book (the
work is found as a lookup finds it, by the series list's own title where the
series is a known one, so a translated file's title does not get in the way)
and offers them as sets: one row a publisher, its cover for each book it
published, the publisher with most of the series first. "Use these" puts
that row's covers on the books it has. A chosen cover is kept as
`<hash>-chosen-<cover id>.jpg`, apart from a looked-up one, so a lookup
neither replaces it nor is blocked by it. The pictures are fetched by the
backend and shown as `data:` URLs: the webview may not load pictures from
the web. Two requests a book, one after another, at most 24 books. Not
tried against Open Library itself: the grouping, the parsing and the storage
are unit-tested, the requests are not. A set is by publisher, not by print
run, so one publisher's two designs can be mixed in a row.

## Formats

**Where:** `formats/mod.rs` (the single source of truth), mirrored for the UI in
`constants/bookFormats.ts`.

Every format falls into one of four *delivery* kinds:

| Delivery | Formats | How it opens |
| --- | --- | --- |
| **Native** | EPUB, PDF, CBZ | Rendered directly. |
| **Built-in** | TXT, TXTZ, HTML, HTM, HTMLZ, XHTML, FB2, FBZ | Converted to EPUB **in-process** by `convert/`. No external tool. |
| **Convert** | MOBI, AZW/AZW3/AZW4, PRC, PDB, LIT, LRF, RB, SNB, TCR, PML/PMLZ, RTF, DOCX, ODT, CHM, CBR, CBC | Needs Calibre, except a Kindle book of the older kind, which Leaflet reads itself (below). |
| — | anything else | Rejected at the picker, not silently dropped after import. |

The built-in converters (`convert/text.rs`, `convert/html.rs`, `convert/fb2.rs`,
and `convert/mobi.rs` for a Kindle book of the older kind, assembled by
`convert/epub_builder.rs`) exist so the common formats need no 200 MB
download. The EPUB they write stores the `mimetype` entry uncompressed and
first, as the spec requires.

### Kindle books without Calibre

(1.3.1; `convert/mobi.rs`, `convert/xhtml.rs`.) A `.mobi`, `.prc` or old
`.azw` is a Palm database: record 0 is a header, the records after it are the
text in 4 KB pieces each compressed by itself (PalmDOC, a small LZ77), and
after the text come the pictures. The text is one page of HTML from the year
2000 in which a link says where it goes by a byte count
(`<a filepos=0001234>`), a picture by its number (`<img recindex="00003">`)
and a new page by `<mbp:pagebreak/>`. Leaflet now makes that into an EPUB
itself, in the conversion cache where Calibre's would go, so the reader opens
it as any book:

- A chapter is a run between page breaks. Its name is what the book's own
  contents page calls the place (the words of the link that leads there);
  with no contents page, its first heading. A chapter with no name is in the
  book and not in the contents list (`Chapter.title` empty), and the first is
  always listed. A book with no page breaks is cut every 200 KB at the next
  paragraph: one page of a megabyte was slow to open and to turn.
- Every place a link leads to gets an anchor, and the link the chapter that
  anchor ended up in. Pictures are the ones the text uses, by their own type.
- The reader opens a chapter as XML, which forgives nothing, and this HTML
  leaves `<br>` open, writes `&nbsp;` and does not quote attributes. So it is
  taken apart into tags and text and written again with every tag closed in
  order and every entity a character (`xhtml.rs`). Of how a page was set,
  centred and right-aligned are kept; sizes, indents and fonts are the
  reader's to decide. Scripts, styles and the head are not text and are left
  out.
- Windows-1252 books (most older ones) are read as such.

Windows offers Leaflet for these under "Open with" (after 1.3.1;
`msix/AppxManifest.xml`, `leaflet.kindle`: `.mobi`, `.prc`, `.azw`, `.azw3`):
the package had never declared them, because every one of them needed
Calibre. It takes a new package to show.

Whether a file is one of these is in its header, not its ending
(`mobi::can_read`), and `needs_converter` asks: a readable one no longer
prompts for Calibre. Still Calibre's: the newer format (KF8: most `.azw3`,
where the book is in fragments put together by tables) and the old Huffman
compression. A file that carries both formats (most made after 2011) is read
from its older half. A book locked to an account says so and asks for
nothing, as before. If reading one here fails for any other reason, it goes
to Calibre as it always did.

Checked on the one real `.mobi` in the owner's library (numbers only: 8.6 MB,
59 chapters of which 56 named by its contents page, 65 pictures, 15,414 links
all placed, every chapter well formed, 0.35 s in a debug build), and that
book opened in the reader in the preview: its chapters, its contents list, a
chapter's three pictures, and a link followed to its place in another
chapter. `cargo test --lib convert::mobi::probe -- --ignored --nocapture`
prints those numbers again. Not checked: more than one real file; a
Windows-1252 one from the wild; how it looks.

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
  always do. The dock and the shortcuts sheet follow (2026-10-12): "next
  page" is on the left and points left, the chapter chevrons swap sides with
  it, the tooltips name the arrow that really turns the page, and the sheet
  lists the keys that way round. The mirroring lives in the key table
  (`readers/readerKeys.ts`), which the sheet and the key handler both read.
  Left as it was: Ctrl with an arrow for the next and previous chapter is
  the same in every book, so in such a book the "next chapter" button is on
  the left while its key is Ctrl+Right.

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
  picture"; Space, the play button or scrolling past it
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
Highlights are drawn by epub.js's annotation layer.

A highlight opens where it is (`readers/HighlightCard.tsx`, 1.3): tapping one
in the page, or pressing "Highlight and add a note", opens a card in the
selection bar's place above the chapter dock, as the look-up card and the
character card do. It has the highlighted words (in a book face, the
highlight's colour down their side), the four colours to change it to, the
note to write, and copy, remove and "All notes". What is typed is kept
however the card goes (Done, Ctrl+Enter, Escape, a click elsewhere, another
highlight tapped); emptying the note removes it. Hands-free reading waits
while it is open ("Notes are open"). A note used to be written in the list of
all notes, a 320 px popover hung from the toolbar's bookmark icon, far from
the words it was about.

The notes panel (`readers/AnnotationsPanel.tsx`, `readers/notes.css`; the
bookmark icon) is a panel of its own beside the page, like search and the
characters: highlights under their chapters (the chapter's name stays in
sight while its highlights scroll), each with the book's words set as a book
sets them and the reader's note under them on a tint of the highlight's
colour. Pointing at one shows what can be done with it: the other colours, a
note, copy, remove. Above the list, when there is anything to choose between:
only one colour, only those with a note, and "Copy all" (Markdown). Bookmarks
are the second tab, with "Bookmark this page". The two voices, the book's and
the reader's, are told apart the same way in the card and the panel. The look
was designed from the code and measured; it has not been seen on a screen.

**A highlight as a picture** (1.3; `components/share/`). "Share as a
picture" on a highlight's card and in the list of notes, in either reader,
draws the passage, the book and its author on a card (1080 by 1350, four
looks) to save as a PNG or copy. The passage is set as large as fits
(`fitText`); past 560 characters it is cut at a word. Drawn on a canvas on
this device; nothing is sent. Saving and copying are the diary postcard's
(`components/pip/diary/picture.ts`). Its layout was checked by where the ink
falls on the canvas (inside the margins, the passage clear of the foot, a
long one and a one-word one); how it looks is for eyes.

**"Where was I?"** (1.3; `readers/recap/`). A book opened again after three
days or more (and more than 1% read, and not opened at a highlight) shows a
card in the selection bar's place a second and a half after it is on the
page: how long it has been, the chapter and how far through, the last lines
read (the book's words up to the top of the screen, from the start of a
sentence, 420 characters at most), the names the last thirty thousand
characters used most (`recentNames`; each opens its name card when Characters
is on), and the last passage the reader marked. The ··· menu has it at any
time ("Where was I?"). Everything in it is from before the reader's place, on
this device. It is not a summary: there is no language model in the app.
Escape, Space, Enter, a click elsewhere or "Carry on" closes it; hands-free
reading waits while it is up.

**A double-click looks a word up, and a word no dictionary has is answered
by the book** (after 1.3.2; `readers/words/wordPrefs.ts`,
`readers/people/TermInBook.tsx`, `readers/LookupCard.tsx`). The owner asked
for one way to ask about any word, in any book, without a wiki having to be
known beforehand: "let them double tap a word... if it is an English word,
show meaning, else show what it means in context to the book." A double-click
selects a word, as it always did, and the look-up card now opens on it by
itself (in a book of text and in a PDF). If Wiktionary has the word, the
card is what Look up always showed. If it has not, the card's first section
is **In this book**: the line the word came into the book on (or the one
that says what it is), how often the book has used it so far, a way to go
there; and under it the book's fan wiki on the word, asked for at once where
the reader chose "Straight away", on a press of "Ask the book's wiki" where
they chose "When I ask", and not offered where they chose "Never". Nothing
after the place being read is read. The book's own lines need no wiki and no
list of anyone's: they are there for every book, which is what a reader of
many books wanted. Needs "Characters" on (the book's text is read by it);
without it the card says, as before, that nothing was found. A selection
made any other way opens nothing by itself. Settings, Reading has the
switch ("Look a word up when I double-click it"), on unless turned off: it
is the one thing that sends a word to Wiktionary and Wikipedia without the
Look up button, and the card's (i) and the privacy policy now say so.
Checked in the preview on a real book: a double-click on a made-up word
gave the book's line and, asked, the wiki's summary; on an ordinary word the
meaning; a plain selection, and a double-click with the switch off, only the
selection bar. In the preview the dictionary's answer is a stand-in, so the
real Wiktionary saying "no such word" was not part of the check.

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
shows too. So is a word whose definition only points at the word it is made
from (after 1.3.1; `leans_on` in `lookup/mod.rs`): the owner looked up
"sagaciousness" and was told "the state of being sagacious", which says
nothing to a reader who does not know "sagacious". When the first definition
is short (seven words to its first stop) and links a word this one starts
like, or starts like after "un-", "in-", "dis-" and the like, that word's
meaning is shown under it (`Meaning.base`), with the part of speech the link
named first ("impossible to fathom" means the verb). The word kept in My
words and the link to Wiktionary stay the word looked up. A definition that
stands by itself ("a realm having a king or queen as its sovereign") is left
alone. It is one more request, for a word out of Wiktionary's own answer.
Checked against Wiktionary itself with seven words (`live`, the ignored
test); the card showing it was not seen. Definitions arrive as HTML and leave Rust as plain text. A name, a
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
words and nothing else; the card says so in a small note that opens from the
"i" at its foot (until 1.3 the note was open the first time the card was
used). Every call Leaflet makes to Wikipedia,
Wiktionary and Open Library names the app (`src-tauri/src/http.rs`), as their
API policy asks; the cover look-ups used to send no name.

**Highlights in a PDF** (1.3; `readers/pdfHighlights.ts`,
`readers/usePdfNotes.tsx`). Selecting words on a PDF's page offers what
selecting them in a book does (four colours, a highlight with a note, copy,
look up), a highlight is drawn over the page in both layouts, pressing one
opens its card, and the list of notes (the same panel as a book's) has them
under their chapters with the PDF's page bookmarks beside them. A PDF could
not be highlighted at all before.

- A PDF has no CFI, so a highlight's place is its page and the rectangles
  its words cover, as fractions of the page (as the search's marks are), kept
  in the same field of the same row: `pdf:12:1234,2000,5000,180;...` in
  ten-thousandths. So it is right at any zoom, travels in the backup like any
  highlight, and an older Leaflet that meets one lists it and cannot place it.
- A selection's rectangles (one for every run of text) are joined into one
  bar a line (`lineRects`); two columns on a line keep a bar each. A
  highlight is on one page: a selection run on into the next is kept as far
  as the first.
- The text layer lies over the highlights so their words can still be
  selected, so a press on one is found by where it landed on the page.
- A PDF's bookmarks stay where they were (pages, on this device, under
  `leaflet.bookmarks.<book id>`): that is the key a book's old bookmarks are
  moved to the database from, and the PDF reader does not run that move.
- The Library's Highlights lists PDFs too, in page order, and "Open in book"
  goes to the highlight's page as a jump (Back returns). A comic has no words
  and keeps its bookmarks popover.
- Not done: a highlight across a page break; "search for the selection";
  the highlight is not kept out of the saved place when a PDF is opened at
  one (a book opened at a highlight is "a look" for two minutes; a PDF is
  simply taken there).

**Highlights from a Kindle** (1.3; `library/kindleClippings.ts`,
`library/kindleImport.ts`, `components/highlights/KindleImport.tsx`). "Import
from Kindle…" at the foot of the Library's Highlights view takes the `My
Clippings.txt` a Kindle keeps and adds its highlights and notes to the books
the library already has. The file is read by the page itself and goes
nowhere. A highlight the Kindle wrote again after an edit is kept once, as it
was last; a note goes with the highlight it was written on (a note with no
highlight is kept by itself); bookmarks, empty entries and those the Kindle
would not copy (the publisher's clipping limit) are left out. Only the
English wording is understood: an entry in another language is kept, with no
place and no date. A book is found by its title, and its author when both
sides name one ("Voss, Maren" is "Maren Voss"; a series in brackets or a
subtitle on one side only does not matter); a title that fits two books is
not guessed at. Before anything is added, one line says how many highlights
for how many books, how many are here already, and how many books were not
found (their titles when that is pointed at). A Kindle location is not a
place in the book's file, so these highlights are kept at
`kindle:<location>`, as a PDF's are at `pdf:…`: listed after the book's own,
in the Kindle's order, under its page or location, with a small "Kindle" tag,
and neither drawn nor gone to until the book has been opened once (next
paragraph). Each keeps the Kindle's date (`annotation_save`
takes an optional creation time, used only for a new row). Its id comes from
the book, the place and the words, so the same file imported again adds
nothing and changes nothing. One removed in Leaflet stays removed when the
file is imported again (2026-10-12): the import asks which of a book's
highlights were removed (`annotations_removed`) and leaves those out, and
says how many ("2 you removed"). Undo in the Highlights dialog still brings
one back. This lasts as long as the removal is remembered, which on a device
that backs up is ninety days (`sync/merge.rs`); after that the same file
would bring it back. Known: one edited on the Kindle since arrives as a
second row. Checked in the preview with an invented file (a highlight, its
note, a book not in the library); not with a real Kindle's.

**Kindle highlights, placed in the book** (1.3.1;
`readers/kindlePlacing.ts`, `readers/text/useKindlePlacing.ts`). A clipping
has no place in the file, but it has its words, and the words are in the
book. Four seconds after an EPUB with such highlights is up, their words are
looked for in its text, in the page's idle moments (no more than 6 ms at a
time, so reading and Smart Read come first), and each one found is saved again
at a CFI of its own, under its chapter's name, with its note, colour and the
Kindle's date as they were. From then on it is drawn on the page, opens from
the list and syncs like any other; the "Kindle" tag goes with the
`kindle:` place. Only letters and digits are compared (lower case, no
accents, a ligature as its letters), because the two files never agree on
quotes, dashes, ellipses, spaces or soft hyphens. A passage that is not there
whole (a footnote's number in the middle, a word set right in another
edition) is found by its first and last eight words, in order and about as
far apart as it is long. A wrong place is worse than none: one or two words,
or fewer than twelve letters, are placed only where the book says them once
as whole words; a longer passage said more than once goes to the one nearest
where its Kindle location points, and one said more than 24 times goes
nowhere. One not found stays listed as before and is not looked for again on
this device (`leaflet.kindleTried.<book>` in the page's storage, cleared by
"Delete All Data"). Not placed: clippings of a PDF or a comic; a note written
where nothing was highlighted. Checked in the preview on a test copy of a
real novel: two real passages were placed in the right chapter and drawn, an
invented one stayed where it was. Not checked with a real Kindle's file.

**A highlight from the past, once a day** (1.3;
`components/highlights/DailyHighlight.tsx`, `highlightOfTheDay.ts`). The
library page shows one of the reader's own highlights between the top of the
page and the books: the passage (two lines of it), its book, and a cross that
puts it away until tomorrow. Pressing it opens the book there, as "Open in
book" does. Which one is settled by the date, so it is the same all day: a
book is chosen as likely as it has highlights, then one of its highlights,
from a week or more ago when there is one. Nothing shows with no highlights.
One list call a day; nothing leaves the device.

**Highlights outside the reader** (`components/highlights/`). The Library's
**Highlights** button lists every book that has highlights, with a count
(`annotations_highlight_counts`), and a book's menu has a **Highlights** item
for that book alone. A book's highlights are shown in reading order under their
chapters, each with its colour, full text, note and date, and a second tab
lists its bookmarks. **Open in book** opens the book at that place (the
reader's `openAt`; the next ordinary open resumes where the reading stopped),
**Copy** copies one, **Copy all as Markdown** the lot, and **Remove** deletes
one at once, with Undo. Comics cannot be highlighted and have no item.
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

**No highlight on a highlight** (after 1.3.1; `readers/highlightOverlap.ts`,
`readers/text/useReaderMarks.ts`, `readers/pdfHighlights.ts`:
`highlightsUnderRects`). The owner highlighted two words, then three that
began with the same two: two highlights, the colour doubled where they met,
and removing one left the other, so that it looked as if highlights could not
be removed. A selection inside a highlight is now that highlight: a colour
pressed changes its colour ("Colour changed.", or "Already highlighted."),
the note button opens its card, and nothing is added. A selection that runs
past a highlight's end grows it: the highlights it touches become one, over
all their words, with their notes joined (the new one is saved before the old
are removed). In a PDF the first half holds; a selection running past a
highlight's end still makes a second one there. With words selected over a
highlight, the selection bar has **Remove highlight** (every highlight under
the selection). Removing from a highlight's card also removes any other
highlight of exactly that place that has no note of its own, which is what an
older version could leave behind. Checked in the preview on a real book, as
the owner did it: twelve letters highlighted, then thirteen from the same
start, came to one highlight and one mark; the same words again added
nothing; another colour changed its colour; a selection past its end grew it;
"Remove highlight" and the card's bin each left none. The first run of that
check found the fix not working at all: the rendition's `getRange` knows only
the chapters it counts as in view, so a highlight's range is now read from
its chapter's own document.

**A highlight's card is its colour** (after 1.3.1). The colour was a thin bar
down the side of each highlight, in the library's list, the reader's notes
panel and the card's quote (the owner: "I don't like that little bar"). Each
is now tinted all over in the highlight's colour, faint enough to read on,
with a border of the same.

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

**Characters** (`readers/people/`; on unless switched off in Settings,
Reading; `leaflet.reader.characters`. It was off by default until 1.3, where
the owner could not find it). Keeps track of who is who without
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

**Resting the pointer on a name** (1.3; `terms.ts`, `termHover.ts`,
`TermPeek.tsx`) shows a small card beside it: what the book has said of it so
far. It works for any name of the book's own, written down or not: a person,
a place, an order ("Order of the Phoenix", "Night's Watch", "Lord Ruler",
"the Wall"). Nothing is marked in the text and the book's DOM is not touched.

- *What counts as a name.* There is no dictionary to ask, so a name is told
  from a word by how the book writes it: capitalised in the middle of a
  sentence, and not also written small (unless it is given its capital there
  eight times or more: "the Wall", "the Hand"). The word under the pointer is
  read with the capitalised words around it, through the small words inside
  a name ("of the") and through a possessive; of the names that offers, the
  longest the book has written three times is the one meant ("Night's Watch",
  not "Watch"), and a title has to hold its own ("Lord Ruler", but "Kelsier"
  for "Master Kelsier"). Lower-case words of a book's own ("skaa") are not
  found this way; selecting one and asking still works.
- *A word the book made up and writes small* (after 1.3.2). The owner rested
  the pointer on "shelldry", a game a novel names twice and never with a
  capital, and got nothing: nothing in the book tells it from a word. The
  book's fan wiki does, by having a page for it. With wiki summaries set to
  "Straight away", the names of the wiki's pages are read once when the book
  opens (`wikiService.words`: five hundred to a request, redirects too, up
  to 20,000; the single words among them are kept on this device for a
  month under `leaflet.wikiWords.<wiki>`, 4,372 words and 95 KB for the
  Coppermind, read in under fifteen seconds beside the book opening). A word
  written small that is one of them, or its plural, and is not an everyday
  word, gets the card: the book's own line, and the wiki's summary of the
  page the wiki keeps it under. No word under the pointer is ever sent
  anywhere to find this out. A word the book has used more than thirty times
  so far gets no card: by then the reader knows it, and a card at every rest
  on "mist" would be in the way. Not done where the wiki waits to be asked
  ("When I ask") or is off: nothing is read from a wiki unasked there.
- *What the card says.* The sentence, among every one so far that uses the
  name, that reads most like an introduction ("X was a...", "X, the...", "a
  ... called X", "her brother, X"), labelled "The book says" with its
  chapter; failing one, where the name first came up ("First appears"). Then
  how often it has come up, and for someone on the sheet the reader's last
  note. The rules are strict on purpose: a line that only uses the name,
  shown as if it said who they were, is worse than the first mention. They
  were tuned on three novels and are English only. It is the book's own
  words, not a summary: there is no language model in the app.
- *No spoilers,* in the same way as the mentions: only text up to the foot of
  the screen is ever read (`bookText.ts` `about`).
- *How it behaves.* The pointer rests 380 ms; the card goes when the pointer
  leaves the name and the card, when the page scrolls, or at a key. A move
  the page made under a still pointer (Smart Read turning the page) is not a
  rest: the place on the screen has not changed. It takes no focus and holds
  nothing up. "More" opens the full card. Mouse only; a phone will need
  press-and-hold. Settings, Reading has its switch.
- *Speed.* Chapters are read once and kept: the first card a whole novel into
  a four-novel set took 0.6 s from the pointer coming to rest, later ones
  0.8 s (of which 0.38 s is the rest itself).

**A fan wiki's summary** (1.3; `wiki.ts`, `services/wikiService.ts`,
`src-tauri/src/wiki.rs`). The card's "Wiki" button fetches the opening of the
name's page on the book's wiki on fandom.com and shows it under the book's
own line, marked "From the wiki · may spoil". This is the one part of
Characters that goes online and the one part that can spoil (a wiki's first
paragraph often tells a character's fate; the test book's did), so it waits
to be asked unless Settings says "Straight away", and "Never" removes it.

- The wiki is found from the book's series or title (a table of well-known
  series whose wiki is named otherwise, then the name itself, joined and
  hyphenated), asked whether it exists, and checked to be about the book (it
  has a page for the author, the series or the title: `alchemist.fandom.com`
  is a game's). The answer is kept per book (`leaflet.wiki.<book id>`); the
  Characters panel's foot shows it and takes another address, or "None".
- Fandom has no summary API (Wikipedia's is not installed there; its own
  sits behind a browser check), so the page's opening section is asked for
  as HTML and read down to its first paragraphs as plain text. The page of
  that very name is asked for first, so the wiki's own redirects are
  followed.
- The Rust side (`wiki_ask`) is a narrow door: `<name>.fandom.com` and the
  wikis named in `OTHER_WIKIS` only, their `api.php` only, three read-only
  actions (and of a wiki's lists only the names of its pages), JSON only,
  redirects followed no further than a wiki's own API.
- *A series' own wiki* (after 1.3.2). Fandom's Mistborn wiki has two hundred
  pages and none for "shelldry"; the Coppermind, the wiki of everything that
  writer has written, has five thousand. `coppermind.net` is now a wiki
  Leaflet may ask (`OTHER_WIKIS`, in `wiki.ts` and in `wiki.rs`, which is
  what decides), and is tried first for those books, by series or by title
  (`HINTS`). A wiki found for a book the older way is looked for again once
  (`LOOKING` in `wikiService.ts`); one the reader chose is left alone. Other
  series' own wikis are added to the two lists one by one: A Wiki of Ice and
  Fire (`awoiaf.westeros.org`) and the Discworld's (`wiki.lspace.org`) are
  there too, each asked first for its books. Tolkien Gateway did not answer
  its API from here and is not. For every other book the wiki is still the
  one on Fandom named for its series or title, found without any list.
- What is sent: the name, and to find the wiki the series or title and the
  author. [The privacy policy](legal/privacy-policy.md) says so (it is a
  draft: publishing it is the owner's).

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

### Opening a book, turning the phone, and what floats over the text (1.5.8 to 1.5.10)

The phone's gestures and toolbar are in [android.md](android.md), "Reading".
What changed in the reader itself:

- **Opening a book says so at once.** A tap shows an "Opening book…" veil
  (`App.tsx`) while the book is fetched and checked, and further taps wait
  for it. The reader's code is fetched once the app has settled, so the first
  book does not wait for it. Before opening, a pull of the other device's
  place waits at most 1.2 s (`OPEN_WAITS_FOR_PULL_MS`,
  `services/placeElsewhere.ts`; a pull at start-up held a tap for up to five
  seconds before 1.5.10). A pull that takes longer goes on, and if the other
  device is further on, the offer appears in the open book when it lands. The
  book always opens at this device's own place.
- **Scroll or Pages is kept as the phone turns** (`layoutForShape`). Each way
  up used to keep its own layout, and sideways defaulted to pages. Now the
  reader's choice holds either way up; only a reader who has never chosen
  opens a book sideways in pages.
- **A veil covers a re-layout** (`readers/readerVeil.ts`). A turn of the phone,
  or Scroll and Pages swapped in the type panel, puts a veil in the page's own
  colour over the page at once. The book is laid out once the window has kept
  its size for 220 ms (`TURN_SETTLE_MS`; 60 ms once the screen says it has
  landed), the place is put back, and the veil fades in 200 ms (no fade with
  reduced motion). It lifts after 3 s whatever happens. The bars and an open
  sheet stay over it.
- **Back to the library** on a phone is a round ← at the top left that comes
  and goes with the toolbar (a double tap; `ReaderPhoneBack` in
  `readers/text/ReaderToolbar.tsx`). It leaves as Android's Back does: the
  place is saved, and under focus lock Pip's "Hold to leave" comes first.
- **A focus session's mug or flower no longer covers text**
  (`readers/sessionMark.ts`). On a phone it sits small and faint at the right
  end of the footer's strip; in pages on a desktop or tablet, in the room
  under the page's text; scrolling on a desktop, in the window's corner as
  before. It used to sit over the first lines of every page.
- **Auto-scroll moves by screen pixels** (`autoScrollStep` in
  `readers/autoScroll.ts`). It moved by whole CSS pixels: at a reading pace
  that was one step every third or fourth frame, and on a phone (two or three
  screen pixels to a CSS pixel) the text moved in small, uneven jerks. It now
  moves on most frames, a screen pixel at a time.
- **The screen stays on for 3 minutes after the last touch** on a phone or
  tablet while the book is open and nothing reads itself
  (`readers/readerAwake.ts`, `TOUCHED_AWAKE_MS`; five minutes until 1.5.9).
  While Dotty, word by word or auto-scroll runs, it stays on throughout. Never
  while Leaflet is out of sight.

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

### Your own font

(1.3.) The type panel lists the reader's own fonts after the faces that come
with the system, and an "Add a font…" tile picks a file: TrueType, OpenType,
WOFF or WOFF2, up to 10 MB, twelve at most. Leaflet goes by the file's first
bytes, not its name, and says so plainly when it is something else (a `.ttc`
collection is several fonts in one file and is refused). The file is copied
into `fonts/` in the app's data folder under a name made from its contents,
with what it was called kept in `index.json` beside it
(`src-tauri/src/fonts.rs`); nothing goes into the database, the backup or
sync, and "Delete All Data" removes the folder. The typeface chosen is then
`custom:<id>` (`readers/customFonts.ts`). The book opens without waiting for
the font: its bytes are asked for separately and reach the page as a data
URL, each chapter gets an `@font-face` for it, and the text shows in the book
serif until it is drawn, and stays in it if the font is no longer there, with
nothing said. Each font has a small cross to remove it; removing the one in
use goes back to the book serif. Bold and italic are the browser's own from
the one file. The PDF and comic readers have no typeface and are unchanged.
Not in the browser preview, which has no files to add one from, so none of
it has been seen running: the panel's layout, a real font in a chapter, and
whether the saved line holds when a wide font replaces the serif a moment
after the book opens (if it drifts: wait on `doc.fonts.load()` before the
cover lifts in `useBookOpening`).

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
the reading; drag it, or move it with the arrow keys, to pin a start line. A
drag held against the top or bottom of the window scrolls the page under
Dotty, so it can be carried to a line that is not on screen. In Smart Read it
walks through the text word by word.

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
  without counting the time; scrolling back down to Dotty carries on from it.
- **Dotty comes back.** With Dotty below the page (the reader went back above
  it, or it ran on without them), Space or the play button reads from what is
  on screen: Dotty comes up to the first line of the reading area, the page
  stays where it is, and Dotty sets off after a beat (`readFromHere` in
  `useSmartRead.ts`). Paused or not, the control then says "Space reads from
  here". Space used to carry on from Dotty, and the
  next page step took the page down to it, so a Dotty that had got ahead could
  not be brought back at all: it was out of sight to drag, and a drag stopped
  at the window's first line. Space now never moves the page from under the
  reader. Going back says nothing about the pace.
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

**Fewer words on the page (1.3).** The owner asked for the standing
explanations to go. A control's own words now say what state it is in and no
more; how to work it is in its buttons' tooltips. Gone from view: the hint
beside the Smart Read and auto-scroll controls while they run or are paused
(it shows only what they are waiting on), the paragraphs under the pace
controls in the ··· menu, the sentence above the three choices of where to
start reading, "Your highlights are under the bookmark icon" after every
highlight, and the second halves of several empty states. The look-up card's
note on what is sent opens only from its "i". Settings keeps a line under
each switch, since that is where a reader goes to find out.

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
- A drag puts Dotty no nearer the window's top or bottom than a line's
  height, so it is never left on a line half off the page (where, pinned, it
  counted as out of sight and was let go after five seconds). Held within
  64 px of either edge, or past it, the page scrolls: a few lines a second
  as the pointer comes into the strip, about a screen a second at the edge,
  2,000 px a second at most (`dragEdgeSpeed` in `readers/readerDot.ts`),
  into the chapters before and after. What the drag says about the pace is
  judged from the word it began on, found again by what it is and not by its
  number: such a drag brings chapters in above, which renumbers every word.
- Hands-free reading (auto-scroll, Smart Read, RSVP) reads on for as long as
  it is left to. It used to pause five minutes after the last real input,
  always, with "Still reading? Press Space to carry on."; to a reader
  following Dotty with their hands in their lap that is a book that keeps
  stopping (the owner: "kind of annoying"). The pause is now a switch,
  Settings → Reading → "Pause when I've been still for five minutes", off
  unless turned on (`readers/pacing.ts`: `pausesWhenStill`, `stillTooLong`).
  With it on, time is earned for those five minutes (`HANDS_FREE_GRACE_MS`),
  as before. With it off, time is earned for an hour after the last touch
  (`HANDS_FREE_UNPAUSED_MS`) and the page then reads on uncounted: a night
  left running is not a night of reading, and the minutes go on a board
  other readers are on.
- Keys keep working after clicking into the book text: the epub iframe forwards
  them to the reader's shortcut handler.
- Space after a button was clicked is still the reader's (since 1.4). The
  owner pressed "faster" and then Space to pause, and got "faster" again: a
  click leaves the keyboard on the button, and the reader let a focused
  button keep its Space when the browser said the keyboard had reached it
  (`:focus-visible`), which the browser says of a clicked button as soon as
  any key is pressed. The reader now notes the button the pointer last
  pressed itself (`clickedControlRef` in `text/useReaderKeys.ts`, as the page
  reader already did): Space on that one pauses or carries on, and only a
  button the Tab key reached keeps its own Space and Enter. Checked in the
  preview: "Faster" clicked, then Space, started Dotty; Space again paused
  her; after Tab, Space was left to the button.
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

### The screen stays on

While the page reads itself (auto-scroll running, or Dotty or word by word
not paused) the app asks Windows to keep the display on (`keep_awake`,
`commands/power.rs`: `SetThreadExecutionState`; `services/keepAwake.ts`,
`useAwakeWhileReading`). There is no key and no mouse in those modes, so
Windows took the reader for away and dimmed the page under them. It is let go
the moment they pause, which they do by themselves when the reader leaves
the window (and, with "Pause when I've been still" on, has gone quiet), and
when the book is closed.
In a browser it is the screen wake lock where there is one. Not checked on a
real screen: it needs a build and the patience to wait out a display timeout.
On a phone or tablet the screen also stays on for 3 minutes after the last
touch while a book is open (`readers/readerAwake.ts`; see "Opening a book,
turning the phone" above).

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

## Read aloud

`readers/readAloud/`. Started from the reader's ⋯ menu ("Read aloud", key
`R`); a pill over the page has play and pause, a sentence back and on, the
speed and the voice. It reads from the place to the end of the book, the next
chapter following on its own, and the page follows the sentence being read
(`follow.ts`) until the reader moves the page themselves. Reworked in 1.5.9:

- **Paragraph units** (`units.ts`). Where the voice says which word it is at,
  it is given a paragraph at a time (up to 1,000 characters, cut only where a
  sentence ends), so its tune carries from one sentence to the next. Where it
  does not, a sentence at a time. Only a few units go ahead of the one being
  said (`player.ts`).
- **Pauses** of their own before each unit (`PAUSE_MS`): 400 ms after a
  paragraph, 650 around a heading, 850 at a new chapter, 950 at a scene break,
  shorter the faster the reading.
- **What is said** is not always what is set (`chapterText.ts`,
  `speechText.ts`): footnote markers, page numbers, scene-break glyphs and
  hidden text are left out; a drop cap is joined to its word, small caps are
  said in ordinary case, a web address as its site, Roman numerals after
  "Chapter" as numbers. Every character said maps back to the page, so the
  word (where the voice says it) and the sentence are lit exactly.
- **The voice is ranked** (`voiceRank.ts`): one on the device before one that
  needs the network, Windows' "Natural" voices well ahead of the older ones,
  Android's own quality rating, the book's own region (en-GB for a British
  book) before the reader's. The best is used until the reader picks another;
  the pick is kept per language.
- **Speed**: 0.75x, then 0.8x to 2x a tenth at a time (`prefs.ts`,
  `leaflet.readAloud`), on a slider in the pill's "Voice and speed" sheet; the
  pill's speed button steps through 0.8, 1, 1.2, 1.5, 1.8 and 2.
- **Engines** (`engine.ts`): on Windows the browser's speech with Windows'
  voices (`webSpeechEngine.ts`); on Android the phone's own text-to-speech in
  Kotlin (`ReadAloud.kt`), which plays on with the screen off, with a
  notification, lock-screen controls, and a pause for a call or unplugged
  headphones.

**The Studio voice** (Kokoro, run on the device by sherpa-onnx, an optional
download) is behind the same engines (`desktopEngine.ts`, `neuralEngine.ts`,
`StudioVoice.kt`; Settings → Reading → Studio voice). All of it is in
[studio-voice.md](studio-voice.md). **It does not ship to readers yet.**
sherpa-onnx 1.x has eSpeak NG (GPL-3.0) compiled in, and Leaflet is MIT. A
release build leaves the sherpa-onnx libraries out unless
`LEAFLET_STUDIO_VOICE=1` is set (`msix/build-msix.ps1`,
`gen/android/app/build.gradle.kts`), and a Store build must not set it until
Leaflet runs on sherpa-onnx 2.0. Without the libraries the Studio voice is
simply not offered.

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
  stored, so past days appear too. It earns the goal and streak bonuses, and
  0.75 water a minute for the garden (a focus minute is 1.5).
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

### Starting a session

**One tap.** The Focus key (phone), Start Session (the desktop Library card)
and Pip's menu start a session at once, at the usual length (the one last
chosen, kept in `leaflet.focus.minutes`, else the daily goal), on the book
being read (the board's "keep reading" target), which opens. With no book it
starts on none, in the Library, as before. The length is changed with the
desktop card's select, or by holding (or right-clicking) the phone's Focus key,
which opens the old sheet (`components/focus/focusDeal.ts`). Each carries a
"2×" badge whose tooltip is the deal: "Reading in Focus earns double seeds".

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

All reading waters Pip's **garden**, and reading in a focus session waters it
twice as much (the "2×" on every Focus key); ripe plants are picked for **seeds**; seeds buy things for Pip,
Talking Tom style: variants (robot, president, skater...), a wardrobe of
accessories, floors of a house with furniture, wallpapers and floors, book
nods, food and toys, and the showier moves. The Pip tab is a main tab (the
sprout icon), and the whole tab is Pip's house.

### The garden (where seeds come from)

Minutes do not pay seeds directly (that made everything too easy). Instead:

- **Water.** Every whole minute the **heartbeat** recorded waters: a minute a
  focus session counted is 1.5 water (poured when it ended; what a clean,
  completed minute poured before), a minute read with no session running is
  0.75 (each day's, poured at the day's end, UTC). No bonus for finishing.
  Every drop is a whole number of quarter-waters, exact in an `f64`, so water
  accrues exactly in any order and no day is rounded. Session minutes count only up to the reading the
  heartbeat recorded on the day the session ended, then the day it started
  (read across midnight, or left running and ended the next day), plus a
  minute of slack for a flush in flight, so a timer left running waters
  nothing more than was read. Each day's minutes are handed out once, in the
  order sessions ended, and what is left of the day is its plain reading, so
  no minute is counted for a session and as plain. It is all replayed from
  the records, so a restart or a sync never pours twice.
- **The switch-over.** A device takes up this rule on the local day it first
  works the garden out after the update (the setting
  `garden_plain_water_since`). Days before it keep the water they were
  poured: focus sessions only, a water a minute, half again for one completed
  without leaving the book; their plain reading is never paid. Known limit:
  the day is per device, so two devices that updated on different days can
  disagree about the days between.
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

| Plant | Water | Seeds | Packet |
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
replays the water (the sessions and each day's plain reading) against the plantings in time order every
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

**Pacing**, for a reader doing a 20-minute goal most days (30 water a day in
Focus, 15 without): the garden gives 10 to 12 seeds a day in Focus (half that
without), the goal and streak bonuses about 10, so roughly 150 a week in Focus
and 110 without. Prices are set for that (`PACING` in `shop.js`).
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
  (`earnedOnly`) are never sold, nor given: they are earned by reading.
  `src-tauri/src/pip/earned.rs` holds every rule, against the skin's `unlock`
  words: the longest streak ever as the header's flame counts it (grace and
  freeze days in) for Maple (7), Sakura (30) and Golden Pip (365); books
  finished (as the profile card counts them) for Bookworm (5) and, by genre,
  Detective, Wizard and Astronaut (3 each); 100 hours on the day ledger for
  Midnight Ink; 10 mornings (4 to 8 am) and 10 nights (10 pm to 4 am) of
  reading, from focus sessions and the hour minutes were credited in
  (`pip.readingHours`, this device's) for Early Bird and Night Owl; reading on
  31 October for Boo, and on the winter solstice (21 or 22 December, or 20 or 21
  June south of the equator, by the time zone) for Frost; a finished book read
  on two days 30+ days apart for Prickly; a book finished in the one focus
  session it was ever read in for Cartridge. Pages per month (Tour de Page) and
  league results (Champ, Prism) are not on record yet, so those cannot be earned.
  A thing found earned is written down as a price-0 purchase `earned-<kind>-<id>`,
  so it reaches every device and stays even if what earned it is later pruned.
  The overview lists each with its progress (`earned`) for the wardrobe's hints;
  Pip shows a new one off once in her house.
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
fetched, three times before Pip is puffed (since 2026-10-13 it is a game of
catch instead: she throws it back to the pointer, a press on it in the air
catches it, and catches in a row are counted beside it; pip.md, "The ball is
a game of catch"). The rail's **Play** key turns it
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
  now casts one when lit). Since 2026-10-13 the bedroom has a light of its
  own on the ceiling with a switch on the wall, and after dark Pip and her
  ball are as bright as the light that falls on them: dim in a dark room,
  lit under a lamp (pip.md, "The room's own light, and who it falls on").
- **The fridge** (the Bedroom's mini fridge): select to open it, and again to
  shut it; left open it shuts itself after 8 seconds. Lit shelves, a hum while
  open, a click and thud as it shuts, and after dark its light pools on the
  floor. Pip hears it and comes over hopefully. The Play rail's **Snack** key
  sends her to it: she opens it, waits while a snack is chosen and eats it
  there. Opening it gives nothing; snacks are still bought as they are given.
  Since 2026-10-13 (the owner's asking) what is in it is real: each snack
  bought stocks it for a day, three days at most, and with none bought lately
  the shelves are drawn bare. Pip, finding it so, droops and gets nothing, and
  the first such look of a day takes 3 off her mood (never under the floor of
  40, and never for time the app was shut); a snack puts it right and she
  cheers at the next look (`pip/fridge.rs`; pip.md has the rules).
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
minutes of the reader putting her to bed (`TUCKED_QUIET_MIN`). The habits
themselves are for show: no seeds, nothing bought. The one that is not, since
2026-10-13, is what she finds in the fridge (above), and being woken, which
wears on her temper (`pip/temper.ts`). Under reduced motion: still poses with
the lines.

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

**The room is painted far less often, and faster by night** (1.4;
`HouseScene.tsx` `roomFrames`, `pip/house.js` `nightLight`). The owner: "pip
feels a little laggy at times". Two causes, both measured in the preview.

- A frame of the room takes 2 to 9 ms to paint by day, there are 48 to a
  loop, and each is painted on the 12-a-second tick that first shows it. The
  frames were kept inside the scene's effect, so they were thrown away on
  every visit to the page, every change of floor or decor, every ten minutes
  (the sky), and all together whenever a fifth state came along (a lamp
  switched, the fridge opened), the one on screen with them. Each time meant
  four seconds of heavy ticks, on the same thread that moves Pip. They are
  kept outside the scene now, the four latest states, the oldest going
  first; away from Pip's page only the last is kept (about 5 MB).
- By night (from seven in the evening) every pixel of every frame went
  through `nightLight`, which made three arrays and five strings a pixel: 17
  to 24 ms a frame against 2 to 9 by day. A pixel outside every light now
  takes its colour from a table (the answer depends on the colour alone),
  and the rest are worked out without the arrays. Bedroom 24.4 ms to 4.8,
  kitchen 17 to 3.5, library 17.5 to 6.6, greenhouse 21 to 11.3 (medians of
  twelve frames, development build, starter furniture). The pictures are the
  same to the pixel: three frames of each of the seven floors, compared by
  hash before and after.
- The parsed-colour table (`pip/engine.js`) is emptied at 60,000 colours:
  the night pass made new colours every frame and each was kept for good.

Not changed: Pip out on the other pages measures the page every frame while
she moves (`PipWorld.tsx` `readBounds`, `readLedges`); a helper's reading of
the code put that at tenths of a millisecond, so it was left. Not measured:
the installed app, a fully furnished room, or frames a second on screen (the
preview's pane was hidden, where nothing animates).

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

**The games are played on an old television set, large if wanted** (1.4;
`ArcadeOverlay.tsx`). The owner asked for full screen, then for "an old crt
screen like effect" in its place. The canvas sits in a dark frame behind
glass with a tube's lines over it (one to a game pixel) and darker corners;
nothing flickers or rolls. There was a "Big screen" switch; it went when the
arcade itself took the whole window (see "The arcade fills the window, in
Pip's own hand" below), and a game is now always as large as the window
allows.

**A game that ends stays ended for a moment.** A press used to start the
next one at once, and the press was nearly always the jump that came too
late, so the game vanished before the reader saw how it ended. Now the
picture dims, the score and the best are said, and a press starts the next
game only after 0.9 s (`PLAY_AGAIN_AFTER_MS`), when "Space or tap to play
again" appears.

**And it no longer starts again by itself** (2026-10-12; the real cause of
"when you lose the game, it resets abruptly", found by playing a run in the
preview). Recording a finished game brings back a fresh overview from Rust,
and with it a new list of the same clothes for Pip. The game's loop was set
up again whenever that list changed, so every game began again the moment
its result was saved, and the game-over picture was on screen for as long as
Rust took to answer. The loop now goes by what Pip wears (`wornKey`), not by
which list holds it. Measured in the preview: before, the screen was back at
"Press Space or tap to start" within the second; after, "Game over" was
still there three seconds on.

### A book can be removed from any card

The owner could not find how to delete a book. It could be done, but only
from a row of the list view (and for duplicates): the cards' own menu had no
such thing. "Remove from library..." is now the last item of every book's
menu (`components/BookMenu.tsx`), set apart and asked about first. What goes
is Leaflet's own copy of the file (an import copies the book in); the file it
was added from is never touched, and the reading done in it stays in the
history.

**And from Google Drive.** Removing a book starts a backup run a moment
later, and that run deletes the file of every removed book from the Drive
folder (`sync/drive.rs`; the same for a backup folder). A run that fails
tries again on every later run for ninety days. This was already so and was
read through, not run: the owner's Drive was not touched.

### The Hollow: Pip's camp, the arcade's building game

*Since 2026-10-15 the game is as "The Hollow, simplified (1.4)" below says;
this section and the ones after it are its history.*

*It is no longer in the arcade: since 2026-10-12 Pip's tab opens on it. See
"The Hollow grows up: one level, four shelves, and Pip's tab opens on it"
for that and for everything added after this section was written.*

The owner asked for "something like what clash of clans does" on the arcade
floor, then, as it took shape: "a mix of clash of clans and sims with a
unique twist of pip", "funded primarily from reading and streaks", with
"strategy" from "placement of buildings", heroes that nod to the books readers
know, and "easy but still enough to make it interesting". A fifth tile in the
arcade, "The Hollow".

**Its history, because the first version was wrong.** The first slice (six
buildings on fixed plots, a number for attack and one for defence, dice for
raids) was played through for seven kinds of reader
(`apps/node_modules/.leaflet-test/hollow-sim.ts`) and came out as a progress
bar: nothing to do on two days in three, magpies that never won a night,
raids that were a roll of dice, a reader who could spend the first twenty
acorns into a corner for good, and no end but running out. Everything below
was written against that list, and against the same simulation.

**How it fits together** (the "(i)" on its screen says this in six lines):

- **Reading runs the camp.** Every ten minutes read, the oak drops acorns.
  Every quarter hour read rests the scouts for one raid (three in hand at
  most). Every ten minutes read earns one paid run at the arcade's games
  (five in hand). A building is paid for in acorns and finished by so many
  minutes read after it was begun; no waiting finishes one. A day's reading
  goal met lights the lookout's lantern that night. A reading streak makes
  the oak richer (10% from 3 days, 20% from 7, 30% from 14, 50% from 30).
  Pip has a wish each day, and it is always some reading. So the game is
  never somewhere to be instead of a book: reading is what lets it be played.
- **Acorns** are its money and its own. Never seeds (those still come only
  from reading in focus and buy Pip's things); nothing a server counts.
- **The camp** (`pip/base/rules.ts`): the burrow (nothing is built past its
  level), the acorn oak, the larder (how much the camp holds, and how much it
  hides from magpies), the lookout, the scouts' hut, the fence, and a yard of
  two plots that take two of four things: a workshop (a second builder), bees
  (honey each day), a well (a richer oak), a market stall (better-paid
  games). At level 3 the oak, the lookout and the hut each take one of two
  paths. A new camp has its oak already standing.
- **Where things stand matters, and is the reader's to choose.** "Arrange"
  turns the picture into the place the camp is laid out: a building is
  picked up and put down (free, as often as wanted); fence goes down a piece
  at a time, three pieces to a level, on a grid the pieces join up on.
- **The night is a battle on that layout** (`pip/base/battle.ts`,
  `campStructures`, `nightOutcome`). Magpies come once the burrow is level 2,
  from a side the day decides, which the lookout names beforehand. They make
  straight for the larder, and whatever stands on their line (fence, a
  building, a construct) has to come down first; from a bolder flock some
  fly over all of it. The lookout throws at what comes in
  reach (further and harder with the lantern lit), so do the scouts from
  their hut's roof and Pip from the burrow. What they take is by how far
  they got with the larder: untouched, the camp held. Never more than a fifth
  of what the camp has, never what the larder hides. A lost night also
  knocks down the fence pieces they broke (to be put up again, free) and, if
  the larder was emptied, carries off one decoration, which a won road raid
  brings home. A night comes only after the reader has read since the last
  one: a camp nobody has read for is left alone, however long. "Tonight" says
  how it will go as the camp stands, and "Watch it" plays it through, so a
  layout is tried before the night comes.
- **Raids are fought the same way round the other way.** The reader puts
  scouts down anywhere outside a magpie camp, one at a time, and they fight
  by themselves: each makes for the nearest thing, a wall in the way is
  pulled down first, a mole goes under and for the loot, a slinger throws
  from where a sentry may not reach. Where, in what order and from which side
  is the skill. Half the camp is a star, the nest is a star, all of it is
  three; what came down is what is brought home, won or not. Three kinds:
  **camps on the road** (three new ones every day, each raided once: an easy
  one, an even one and a rich one), the next **stronghold** on the ladder
  (taking it moves the camp on; it never ends, and gets harder), and each
  month the **Magpie King**, who wants two stars and gives up that month's
  banner. "Left to themselves" on each card is how it goes if the scouts are
  simply sent: a camp is the same camp each time, so that is a fact, not a
  guess, and nobody pays for a raid that cannot be won without being told.
  "Send" does exactly that for 60% of the loot, for a reader who would rather
  not fight (or cannot).
- **Heroes come out of the reading** (`pip/base/heroes.ts`). Every book
  finished is a trophy in the clearing, shaped by the kind of book it was
  (`trophies.ts`), and a trophy of the right kind brings a hero (so does
  simply finishing enough books, for a library whose genres say little). One
  goes on a raid and does one thing no scout does: a young wizard who strikes
  from far off, a sea-born fighter whose blow everything nearby feels, a
  thief who leaps walls for the loot, an archer for the sentries, a detective
  no sentry sees, an old wizard every sentry throws at first, a star captain
  who cuts walls, two who mend the scouts, a hunter made for nests and
  champions. They are the camp's own characters. Each tips a hat to a kind of
  hero every reader has met and none is anybody else's: the names, the looks
  and the words are Leaflet's (no borrowed names, marks or lines).
- **Villains.** The last stronghold of each name is held by its lord, who
  comes out to meet whoever gets near and goes for a hero first; the King has
  his own. A hero within reach turns and fights him.
- **Small things for most days**: the hedgehog brings three things each day
  and one may be taken; Pip's list is twenty-three things to do in order, each
  for acorns (it is what a new camp is steered by); the word quiz gives a tip
  (two more scouts on one raid) for seven right of ten; a club that reads an
  hour each in a week beats its boss, and every member's camp has a share;
  eighteen things can be bought and set down anywhere in the clearing for
  their own sake (charm, which fills the hedgehog's sack and brings the
  animals).
- **The arcade's games** pay the camp a little for each paid run (up to 8
  acorns), and can be wagered on: acorns on beating the reader's own usual
  score, taken when placed and settled by the next finished run. That is the
  one way acorns are lost by playing.

**What the simulations say** (two, both kept): raids played by rule get a
hut of level 1 to about the sixth stronghold and a hut of level 5 to about
the twenty-sixth, with the best side a camp or two better than the near one
(`battle-tune.ts`). The same camp on the same night loses its larder from one
side and holds from another, and holds more often built up, fenced and lit
(`night-tune.ts`). A reader of 30 minutes a day who fights raids has all six
buildings at level 5 in about 45 days, with something going up on all but
one of them; one who reads 20 minutes and never raids, about 83. Acorns come
45 to 70% straight from reading (the oak and Pip's wishes) and 13 to 45%
from raids, which reading rests the scouts for. A reader who never arranges
the camp loses about one night in three: laying it out is worth doing.

**The screen** (`components/pip/arcade/base/`): three pages. *Camp*: what
to do next, the clearing as a picture (in its season, by day or night, the
buildings in the night's own light), the plots as pictures to press, the
chosen one's card, tonight, the hedgehog, a trophy to raise, things to set
down. *Raids*: who goes, the road, the strongholds. *Journal*: what the camp
has done and what happened lately. A raid being fought or a night being
watched takes the whole screen. Words are kept for names and numbers;
buildings, heroes, camps, prices and directions are pictures, and what a
thing means is in its tooltip. Everything the picture does is also on a
button. The art is `pip/base-art.js` (`GAME_SPRITES.base`).

**Elsewhere in the app**: a line at the end of a reading session ("The
Hollow. The lookout is finished, 12 acorns on the oak."), a dot on the
arcade's button when something is waiting, and a reader's camp on their card
for those who may see their profile (its levels and counts only: where they
put things, their acorns and which books stand behind their trophies are
theirs).

**Kept** in one settings row (`pip.base`), in the backup (newest wins, like
Pip's look), and its summary on a shared profile. The rules are the app's
(TypeScript), and Rust keeps what it is handed after checking it is a small
JSON object. That is deliberate and safe only because acorns buy nothing
outside the game: if they are ever to buy what a seed buys, or be ranked
between readers, the rules have to move to Rust first.

**Decided, and how to undo each:**

- *Its own money rather than seeds.* The games have never paid seeds, and a
  game that paid them would let the arcade buy what reading is meant to earn.
- *Raids against the computer; friends only visit.* Raiding a friend needs
  the server to hold every camp and referee every raid, and would let one
  reader take from another.
- *Heroes are original.* They are meant to be recognised as kinds, not as
  anybody's characters.
- *No night without reading, and a fifth at most.* The owner's rule: it must
  not be a game one signs in to every day. Raiders come only to a camp that
  has been read for since they last came, so being away costs nothing.

**Its limits, plainly.** No person has played it over days: every number is
from the simulations and from reasoning, and a simulated reader is not a
bored one. (Four limits written here first were taken away the same day:
see the next two sections. The camp is reached from a "Camp" key on the rail
under every floor of Pip's house now, as well as from the arcade.)

### The Hollow after its first look: the critique, answered

The first report on the Hollow listed what was wrong with it, and the owner
said "fix all of those critiques". Each, and what was done:

- **"Still dense", and no walk-through.** The camp page is three things now:
  what Pip has to say, the picture, and one card for whatever is chosen from
  a row of tiles under the picture (the eight plots, tonight, the hedgehog,
  things to set down). Tonight, the hedgehog and the decorations used to be
  cards of their own down the page; a trophy to raise and the morning's
  report are lines of Pip's. Pip says the to-dos herself, in a speech bubble
  beside her own face (as the reader dressed her). The next thing on her
  list is **marked where it is done** (a tile, or the Raids tab, with a mark
  that jumps), and a tap on its line goes there: each thing on the list
  (`QUESTS`) now says where (`at`, `questAt`). A new reader gets three
  bubbles from Pip once (`leaflet.pip.base.intro`).
- **"Raids are too safe early".** Four changes (`battle.ts`, `rules.ts`):
  - *Stars are graded.* The nest counted for 40% of a camp, so "half the
    camp" could hardly be had without it and results were nearly all none,
    two or three. It counts as two buildings now: scouts who cannot crack
    the nest can still take a star off the rest.
  - *A champion can be set on.* Only the scout he had hold of fought back,
    one at a time, which made every third stronghold a wall. Any scout close
    by turns on him now.
  - *A camp's newest sentry is green.* A camp gains a sentry every third
    camp; the new one throws 45% as hard in its first camp and 70% in its
    second, so the ladder climbs instead of stepping.
  - *The road is measured against the scouts.* The three camps of the day
    were three, one and minus one behind the ladder, so a reader whose hut
    had outgrown the ladder saw three stars on everything. Each is now at
    least as hard as scouts of that hut are a match for (`ROAD_AT`, and
    `ROAD_AT_HERO` once any hero has come): sent by themselves they take the
    first whole, the second with about two stars, the third with one or two.
    What a road camp costs and pays still goes by the ladder alone.
  - And *three stars on a stronghold empties the next one too* (unless that
    one is a lord's own), so a camp that has fallen behind catches up in
    half the raids.
- **"Heroes may be too strong".** Mending is one scout at a time now, the
  worst hurt near her (it was every scout in reach at once, which out-mended
  a sentry). The young wizard strikes from inside a sentry's reach, not
  outside it; the archer is slower; the old wizard is frailer and no longer
  splashes; the hunter less. The thief is sturdier (she was dying alone).
  **The King is measured against the hut, not the ladder** (`KING_AT`): set
  where scouts sent alone do not take him and where, with a hero, four to
  nine of the ten do with two stars and none with three. So he is not an
  easy banner for a reader who has taken few strongholds, and not out of
  reach for one who has taken many.
- **"Tooltips carry a lot", and a finger cannot hover.** `Tips.tsx`: a finger
  held on anything that has words to say shows them in a bubble (and does
  not press it); a tap or a click on a thing that only explains shows them
  too. One layer serves the whole arcade.
- **"Small in a narrow window".** The picture was sized to whole screen
  pixels only, which in a narrow window left up to half the width empty.
  `fit.ts`: where the whole size would leave more than a quarter empty the
  picture fills the room instead, drawn at the next whole size up and
  brought down smoothly. In a 480-wide window it is 360 wide where it was
  240.
- **"No sound".** Nine sounds in Pip's own synth (`pip/sound.ts`): a hammer,
  a scout's feet, a pebble, a thing coming down, a star, a raid won and one
  lost, the magpies, the horn. They follow Pip's sounds switch, which is
  also on the camp's own screen now (off unless turned on).
- **"Friends see a default layout".** The camp's summary on a profile now
  carries where each building stands, each piece of fence and each
  decoration (`camp_summary` in Rust, `sanitiseCamp` on the server, both
  clamped and capped; `lookOfSummary` draws it). An older server drops them
  and the card falls back to the default layout.

**What the tables say now** (`raid-band.ts`, `road-band.ts`, `king-band.ts`,
kept beside the others): scouts sent alone take strongholds to about the 7th
with a level 1 hut, the 10th, the 13th, the 19th and the 25th with a level
5. The economy did not move: a reader of 30 minutes a day who fights raids
has all six buildings at level 5 in about 47 days (45 before), one of 20
minutes who never raids in 83, and one of 60 in 32. The reader of 10 minutes
a day who only sends raids is slower, about 162 days from 133, because the
road is harder for scouts sent alone.

### The arcade fills the window, in Pip's own hand

Three asks from the owner, on seeing the above: "add more whimsy to the pip
UI, it being neumorphic all around is kind of annoying"; "the animations on
them feel very jittery, add more personality to them too"; "instead of it
being in a popup can you make them full screen"; and "the pick a game menu
could look better, while describing what the game could be about too".

- **Not a popup.** The arcade takes the whole window (`.pip-arcade`), its
  name and its way out held at the top, its pages in a column 1240 wide at
  most. The "Big screen" switch is gone: a game always has what the window
  can give. On a wide window the camp's picture has the left of the page
  and Pip's words and the card sit beside it; in a narrow one they stack.
- **Pip's hand, not the app's.** The rest of the app is soft raised paper.
  The arcade and the Hollow now use the look Pip's house already had for
  its own controls: dotted paper, a hard ink line with notched corners, keys
  that sink into a lip, the camp's picture in a wooden frame, tabs like a
  ring binder's, price-tag labels. Every `tactile-button` inside the arcade
  is restyled by one rule (`.pip-arcade .tactile-button`), and the six left
  on Pip's other surfaces (shop, drawer, album, seeds) became `pip-key`s.
  The arcade's standing line about seeds and mood went behind a small chip.
- **The front page** (`GamePicker.tsx`): a card for each of the five things
  to play, and the picture on each card is the game itself. Each runs its
  game with a stand-in at the controls far enough for something to be on
  screen, and holds that frame; under the pointer (or with the keyboard on
  it) the card's game plays on. The camp's card is the reader's own camp.
  Under the picture: what the game is about in a sentence, the keys it is
  played with as keys, and the reader's best.
- **Why it shivered, and what was done.** Three causes, none of them the
  art. (1) A raid's simulation steps thirty times a second and its pieces
  were drawn at whole art pixels: at three or four screen pixels to the art
  pixel, a scout at twenty pixels a second moved in uneven jumps. A piece is
  now drawn between the last step and this one, and placed to the screen's
  pixels (`View.at`, `snap`). The simulation is untouched. (2) Keys, tiles
  and cards moved when the pointer came to them, so they moved out from
  under it and back. Nothing moves on hover now but what is inside a key;
  a card that lifts keeps an unseen skirt under the pointer. (3) A tab grew
  under the pointer and pushed the page down a pixel.
- **Personality.** In a raid: a scout drops in and lands in a puff of dust,
  has a spring in its step, and jumps when the raid is won; a thing that is
  hit rocks on its feet; a thing that falls goes in a burst (loot from a
  hoard); each star pops over the nest as it is won; the champion stamps. In
  the camp: Pip goes on her rounds between the burrow, the oak and the
  larder when nothing is going up (`pipRounds`, by the clock, so it needs no
  memory), a chosen building gives a bounce, gathered acorns fly from the
  oak to the larder, the hedgehog trundles in, and there is something on the
  air for the season (butterflies, leaves, snow, petals; fireflies by
  night). In the page: a jump that lands and then waits, jelly on a tile.
  None of it runs for a reader who has asked for less motion.

**Checked**: 2,689 app tests, 760 Rust, 186 server, the type check, clippy
and the production build. In the preview: the front page, the camp at 1280
wide (picture left, cards right, no scrolling at 820 high) and at 480 wide,
the dark theme, each card of the camp, arranging, a tip shown by a tap, and
two raids fought to their end ("Taken!", stars, acorns, back to camp), with
no errors in the console.

**Not checked**: how the motion feels. The preview's pane was too small to
judge it and a screenshot cannot show a shiver: that the pieces now move
between steps is from the code and its numbers, not from watching. The
sounds were not heard. Holding a finger for a tip was not tried on a touch
screen (a tap was, with a mouse). The friend's layout was not looked at on a
card. Nothing in the installed app.

### The camp is lived in, and belongs to the house

The owner, next: "add some unique features to this game too. Add animations
to everything like the stars. Add a sims like element to it too. Like the
pip home already exists, tie them all together. Also I think after the taken
screen, the animations don't pop up."

**After "Taken!", nothing showed, and why.** The end of a raid was said in a
panel laid over the field with the field dimmed to 42% under it, and the
field is where the star and the cheering are drawn. The result is now a
panel *under* the field (`RaidResult` in `BattleScreen.tsx`): the word, the
three stars landing one at a time (each heard), then what was carried home,
counted up. The field stays as it is: whoever is left jumps, and paper comes
down the width of it for a raid won. Back in the camp, what was won is seen
going into the larder.

**The house and the camp are one place** (the tie the owner asked for):

- A **Camp** key on the rail under every floor of Pip's house
  (`pages/pip/PipRail.tsx`) goes straight out to the Hollow; the dot for
  "something is waiting" is on it. The camp was only reachable through the
  arcade's list on the attic floor.
- **Pip brings her mood with her.** Her mood in the house (what reading, play
  and a snack lift) is told to the camp (`ArcadeOverlay` to
  `baseStore.setMood`, `Now.mood`): at 75 or more she builds a tenth
  quicker, at 90 a fifth (`moodQuicker`). Never slower: a low mood costs
  nothing. Her hearts show in the camp beside her name.
- She is the same Pip, dressed as in the house, and at night she is asleep
  at the burrow's door.

**Who lives here** (the Sims in it; `rules.ts`, "who lives here"). The heroes
a reader's finished books have brought are not only raiders: they live in
the camp, and can be seen about it, each on a round of their own. Each has
**one want a day**: some reading (10, 15 or 20 minutes), the day's goal, the
oak gathered, a raid won with them along, or a thing for the clearing that
is not there yet. Every want is reading or something reading pays for.
Seeing to one is a step of **friendship** (five steps, "new here" to "sworn
to the Hollow") and a few acorns from them, and each step makes that hero 3%
sturdier and surer on a raid (15% at most). A tile in the row under the
picture opens the list: a face, hearts, what they said, and a button when it
has come true.

**Things that are this game's own:**

- **Pip's walks.** She can be sent for a walk of 10, 20 or 30 minutes, and
  the minutes are minutes of *reading*: she is back when they have been
  read, not before, with a share of what the oak gave for them (40%) and,
  often, a **tale**: one line of what she saw ("A snail was reading a leaf.
  It was on the same line when I came back."). There are 36, each found
  once, kept in the journal. While she is out she is not in the picture.
- **The first acorns of the day** have the dew on them: one more fall of the
  oak comes with the day's first gathering. It is worth most to who reads
  least (double for ten minutes, a sixth more for an hour), and it took the
  reader of ten minutes a day from about 162 days to 115 in the simulation,
  which was the one number in the last report that had got worse.
- **A week's streak puts a rainbow over the trees.**

**Everything moves a little now** (`index.css`, "the camp, moving"): a card
rises into place when it changes; the tiles, the raids, the residents and
the tales are dealt in one after another; Pip's lines come from her side;
promised stars turn up in turn; hearts fill one by one; a building's bar
crawls while there is reading still to do; the chosen thing's picture
breathes. None of it for a reader who has asked for less motion.

**Kept**: five more parts of the camp's one row (`dewDay`, `bonds`, `wants`,
`trip`, `tales`). A camp kept before them reads as one that never used them.

**Checked**: 2,710 app tests (12 new, `life.test.ts`), 761 Rust, 186 server,
the type check, clippy, the production build. In the preview: the Camp key
on the rail and the dot on it, the list of who lives here with Pip's hearts
from the house and four heroes' wants, a walk under way and then welcomed
back after the reading was done, the tales in the journal, and a raid fought
to its end with the result under the field and no dimming.

**Checked afterwards** (the owner: "fix the critiques where you can"): a
raid *won* ("Taken!", three stars landed, +40 counted up, "The next
stronghold emptied at the news"); the hero who went had his "take me on a
raid, and win it" ready to be seen to when the camp came back; a want seen
to on screen (two hearts to three, 200 acorns to 210, "Seen to today."); a
finger held on a tile, with a made-up touch (its name shown, and the press
that followed not taken as a press). Pip's walks are in the economy
simulation now: a reader of 30 minutes who fights raids is done in about 43
days with them (45 without), one of ten minutes in 111; walks are 6 to 11%
of a camp's acorns, and reading's own share (the oak, the wishes, the walks)
is 60 to 76%.

**Still not checked**: the motion, the sounds and the paper were not
watched: the preview's pane was in the background, where nothing animates,
so every check above read the page rather than looked at it. Friendship
over days. The mood bonus with a real mood from Rust. Nothing in the
installed app.

### The Hollow grows up: one level, four shelves, and Pip's tab opens on it

Written 2026-10-12, for what was added after "The camp is lived in". The
owner's steer for all of it: reading lets you play, playing gives you a camp
to show friends; it must not be a daily chore; raiders should differ enough
to make where things stand matter; a reader should be able to lose a little;
book homages are welcome but must be original.

**Where it is now.** Pip's tab opens on the Hollow, in the page, not in a
window over it (`HollowPlace.tsx`, `PipPage` `place`). It used to be a card
in the attic's arcade cabinet, three taps from the tab that is about Pip.
The clearing is where she lives and the burrow in it is her house: "Go
inside" (at the top, and on the burrow's card) shows her rooms, and the
rail's last key there says "Outside". The house stays mounted behind the
clearing, `inert` and not shown, so it is as it was left. The arcade keeps
the games that are games (three and the word quiz); the Hollow's card is
gone from its front page. The app's own tour is shown the house, and the
house's first-visit walk waits until the reader first goes in.
*The garden* has a place of its own outside since (next section); its
floor is still in the lift.

**One level.** The camp's level is the burrow's (`campOpens`, `PLOT_FROM`,
`plotOpen`, `standing`). It is on a chip at the top, and the Camp shelf
shows what the next level brings as a row of small pictures, each named on
its tooltip. That list is read off the gates themselves and a test holds
each claim to its gate (`levels.test.ts`). What each brings:

| Level | Brings |
| --- | --- |
| 2 | a plot in the yard; decorations and landscape; magpies by night |
| 3 | a second plot; the meadow; guardians; paths; ward stone and hedge; the Mudtusk rabble |
| 4 | thumper and smoke brazier; the Gilded and the Stumbling; the yard to level 3 |
| 5 | Frostwights; everything to its top |

A plot of the yard is what a level brings. Before, two "Empty plot" tiles
marked 0 stood in the dock and the clearing from the first minute and could
not be used until level 2. Now there is no plot until its level comes: not
drawn, not on a shelf, not in the way of anything being placed. When it
comes it is seated on free ground (`seatPlots`). A plot already built on
under the old rule stays. The second plot now comes at level 3, not 2; the
simulation moved by two days at most (30 minutes a day, fighting raids: all
six buildings at level 5 on day 45).

**Four shelves.** Everything to build, post or buy is sorted by what it is
for (`SHELVES` in `BaseScreen.tsx`). Which shelf is open follows from what
is chosen, so tapping a building in the picture opens its own.

- *Camp*: burrow, oak, larder, the yard's plots.
- *Defence*: fence, lookout, tonight; the four constructs.
- *Heroes*: everyone in the camp. The scouts' hut, who lives here (wants,
  walks, blades), and the seven guardians. The guardians were under Defence
  at first; the owner looked for the figures on the map under Heroes and
  did not find them, so that is where they are.
- *Decorate*: eighteen decorations and ten pieces of landscape, with the
  camp's charm against the next animal's.

A thing a level has yet to bring is shown greyed with that level on it.
The hedgehog and the meadow keep their own keys.

**Guardians** (`guards.ts`, `GUARDIANS`). Seven, one to a building, posted
for acorns and trained by reading to rank 3: Halvar Longstride (lookout:
reach), Corwin Blackcloak (fence: sturdier), Mossgather (oak: slows
walkers), Dame Berit Tallshield (burrow: a tougher larder), Emberling
(larder: throws, fire), Pim Greenhand (yard: hides more), Ilsa Reedwhistle
(hut: everything throws quicker). The first design was measured and four of
the seven changed nothing; they were redone so each makes the one number its
building is for bigger at every rank, and a test says so.

**Raiders** (`FOES`, `FACTIONS`). Five kinds, each wanting a different
answer: Magpies (some fly), the Mudtusk rabble (many, hard on fence), the
Gilded (few, sturdy, not drawn by the thumper), the Stumbling (slow, get up
once), Frostwights (slow what throws near them; fire is what they fear).
"Tonight" says who is coming.

**Constructs** (`WORKS`). One of each, moved for nothing: ward stone (fliers
must walk inside its ring), whip-thorn hedge (cuts walkers), thumper (draws
walkers to it first), smoke brazier (hides the larder).

**Blades** (`BLADES`). Nine, won from the magpies' lords and the King or
given by a hero at friendship 3, carried by a hero on raids with their own
numbers.

**The land** (`SCENERY`, `placeLand`). Ten pieces (pond, knoll, trees,
flowers and the like), thirty at most, set down anywhere; they do nothing
but look as the reader wants. **The meadow** opens at level 3: a second
clearing, where six animals come to live as the camp's charm grows (hen,
cat, goat, owl, fox, tortoise), each with a small gift.

**Seeing reach.** While arranging, or with a thrower chosen, the picture
shows how far it reaches and the line raiders will take. The lookout's two
paths are two towers to look at: the White Spire and the Dark Watch.

**Small things.** "Collect all" takes everything that is ready in one go. A
chip says what ten minutes of reading drops. Two-frame sprites are never
flipped between frames: the second is faded over the first on a slow wave,
each thing in its own time; figures at rest breathe, figures walking step.

**Still not checked**: the garden question above; the new raiders watched
through a night; a lost night's losses on screen; the motion by eye (the
preview's pane was in the background for every check); a first-time reader
going from the clearing indoors with the house's walkthrough; anything in
the installed app. No person has played it over days: the numbers are from
the simulations beside it.

### The Hollow is the page: the picture, and what goes on in it

Written 2026-10-13, for what followed the section above in the same sitting.
The owner's words for it: "make the pip tab the game. Options etc are inside
that."

**The picture is the page** (`BaseScreen.tsx` `lay`, `fit.ts`, CSS "The
picture is the page"). No title, no box. Where Pip's tab is at least 820 by
460 the clearing fills it edge to edge and everything else is laid over
the picture: what the camp has along the top, Pip's word under that, the
ways out (Arcade, Go inside) in the corner, the row of keys on a board at
the foot, and whatever is opened in a panel at the side that shuts from
its corner, with its key again, or by a tap on open ground. Raids and the
journal are keys in the row and open as a sheet over the picture. The
clearing is 240 by 120; where the page is taller than that, the first of
the spare height is ground at the foot for the keys to stand on and the
rest is sky (at most 90 art pixels), with stars of its own by night. In a
smaller window the picture is hung first and the rest follows under it.

**Everything stands smaller** (`THINGS` 0.75 in `scene.ts`, `FOOT` in
`rules.ts`): pictures are drawn at three quarters about their feet, to the
canvas pixel, and the ground a building takes shrinks with it, so more
fits and a full camp is not a heap. Pip is smaller again (she was as tall
as her burrow). Everything throws a shadow.

**Hours of its own** (`duskAt`). A day in the clearing is four minutes:
light, an eased dusk, a night of a little over a minute, a dawn. By the
wall clock a reader who opens the app in the evening saw only night. It
is for looking at only: the night the raiders come in is the calendar's.
By night the burrow's windows are lit, a lantern post, a campfire, the
brazier and the lookout's lantern glow, and Pip is in bed (it says so over
the roof). A tap on the burrow wakes her for 45 seconds.

**Walking** (`walks.ts`). Pip and the camp's people go round what stands
(a way found on a coarse grid and pulled straight) and not through it,
in at doors, on rounds made of what the camp has: the order shuffled per
camp, three times round before it repeats. What is set down is used: a
nap under the oak, a drink at the water, a read on the bench, tea by the
fire, the can to the garden. Guardians do something at each end of their
beat. Pip is in the meadow too, seeing to the animals. The loop that
paints is one clock however often it is begun again, and cannot outlive
itself (a stale one was painting a small copy into the corner).

**Ways in, and about.** Twice on the burrow is the way into Pip's house;
the garden has a bed beside the burrow (`gardenSpot`), a tile and a card,
and twice on it goes to the garden. Anything can be dragged to move it
without "Arrange" first, held by where it was taken hold of. A tab at the
picture's edge goes to the meadow; so does a finger swept across open
ground (not a mouse: a drag that missed was too easily a sweep).

**Prowlers** (`planProwl`, `prowlsAt`, `prowlTarget`). Between raids, one
comes out of the wood every half minute by day and three times as often
by night, out of sight until he is on the grass. Each kind has a mind of
its own about what to make for: the rabble the larder, the Gilded the
lookout or the burrow, the Stumbling whatever is nearest, the Frostwights
the oak; and three in ten of any kind go for whatever in the camp the
fewest things reach, so a building nobody watches is found. He has health
(1 + the camp's level) on a bar. What throws, throws while he is in reach,
no oftener than every 1.35 s, each stone half a second in the air. He
carries a club and swings it. At the building he lays into it for four
seconds; if he is still on his feet at the end of them the building is
the worse for it (`harmSite`): four knocks at most, drawn on the building
itself (soot, cracks, boards, smoke, stones at its foot), a bar over the
roof for four seconds and under the pointer, acorns to fix, and not built
on until fixed. Measured over 200 walks: one lookout alone stops 16% at
level 3 and none at level 5; four throwers about the larder stop all of
them. They come only while the camp is on show.

**Signposts, and who fights** (`postSpotOf`, `movePost`, `fightersOf`).
Each guardian on the ground keeps to a signpost, which starts beside
their building and is dragged anywhere in the clearing (the dragon has
none: she keeps to her roof). They stand by it and walk a short beat from
it. Whoever passes within 20 of it they go out to with a blade (the
ranger shoots from where he stands, from 34), a blow more for each rank;
and when a prowler starts on a building, whoever is nearest within 95
hears it and comes running, which takes as long as it is far. They go
from wherever they were and back, never from nowhere. The first of the
camp's heroes fights the same way, from the hut. In the night's fight
each guardian is a figure of their own at their signpost and throws at
what comes within reach of it, so where a post is set matters there too;
what they do for their building they still do.

**Worn out** (`woundFighter`, `isAsleep`). One who goes out to a prowler
and does not finish him takes a knock; at three they are worn out and
sleep for three hours by the wall clock, laid down by their post, and
fight nobody: not prowlers, and not at night. Knocks an hour old are
shaken off. A friend's raid of two stars or three leaves every guardian
on the ground asleep the same way. It mends by itself whether the reader
is there or not.

**Eight constructs** (`WORKS` in `guards.ts`; `battle.ts` `zone`, `slows`,
`stings`, `traps`, `rouses`). Four were added to the first four, each a
different answer and each coming with a level of the camp:

| Construct | Level | What it does |
| --- | --- | --- |
| Tanglefoot patch | 2 | Whoever walks through it goes at less than half pace (so is thrown at for longer). Walked into, not stopped at. |
| Hornet jar | 3 | Stings whatever is on the wing within 26 of it. |
| Pitfall | 4 | The first three on foot to step on it are gone, sturdy or not: the answer to the Gilded. Nobody makes for it, it is in nobody's way, and it is not counted with what there was to pull down. A hero goes round. |
| Watch bell | 5 | While anyone is within 32 of it, everything that throws waits 0.7 as long between throws. |

They act on the night's raiders and, like the hedge now, on a friend's
scouts (`Setup.works`); the ward, the thumper and the brazier are still
for the night only, being about where raiders fly and what they make
for. Against a prowler: the patch slows him, the hedge cuts him every
1.2 s he is in it, the pit has one in two outright, and the bell brings
the next throw sooner. The friend's card carries kinds 0 to 7, eight at
most, one of a kind (Rust and server both; the widest card is 2,233
bytes of the 3,072 its test allows). An older server drops the new four
from a card and nothing else.

**Something to do.** Standing about, the camp's people are at something,
with a thing in the hand and in whole pixels: a pass with a blade, a
blade raised with the light on it, an edge put on it with sparks, a glass
to the eye, a practice shot, a tune, the can, a book, two acorns up and
over, a breath of fire from the dragon. (The first try breathed and
leaned them by fractions of a pixel, which at this size read as
sneezing.)

**Raiding a friend** (`startFriendRaid`, `sufferRaids`; server
`routes/raids.js`). Readers who follow each other can fight over each
other's camps, once a day each, for a raid's worth of the scouts' rest.
The fight is on the raider's device against the camp as the friend's card
shows it, twice as sturdy and throwing twice as hard as it
does against the night. That was three times until the guardians stood
in the fight at their signposts, and is twice now (measured again:
scouts against a camp of their own level take two stars, guardians
posted or not; a bare one three; one two levels up with every guardian
trained, none). Nothing is taken from the friend: a star is worth 6 acorns from
the game. The friend is told who came; a raid that took a star knocks
down a piece of fence a star and leaves the camp to be mended by reading,
four minutes a star and never more than twenty, during which nothing new
is begun; a raid that took none pays the defender 8 acorns for holding.
Raids can be switched off on the raids' sheet. **This needs the server
deployed** (one new collection, no migration).

**The game's Pip is the reader's Pip**: it always was drawn from the
chosen look and outfit; it now follows a look the moment it is picked.

**Not done, and said so**: a friend's card does not carry where the
signposts were moved to, so a raid on a friend meets their guardians
beside their buildings; a hero who is worn out can still be sent on a
raid; the night watched as a battle still draws things at their
full size; the garden's floor is still in the house.

**Still not checked**: all motion by eye for more than a few frames;
dragging with a real mouse or finger (it was driven by script); a friend
raid end to end in the app (the server and Rust halves are tested, and
the rules; the screen was not opened against a server); the installed
app; anything played by a person over days.


### The Hollow, simplified (1.4)

Written 2026-10-15, not committed. This replaces the long account of the
defences that was here ("The Hollow defended"), and is what the game is
now; the sections above are its history. Since 1.5.10 the camp's level is
chapters of hours read, the larder and the oak have no cap, and raids cost
nothing: see "The Hollow by chapters" below, which wins where the two
disagree.

**Why.** The owner, who designed it over many sessions: "The game is a bit
confusing to understand, despite helping build it i have no clue what to
play and what to do and why etc. Simplify the game, critisize it and work
it out." A review played it fresh and found eight separate things telling
a reader what to do (an introduction, tips, a list, a daily wish, each
hero's daily want, a hedgehog with daily offers, "N things are ready", and
badges on five buttons); five clocks (minutes read, the calendar day, the
picture's four-minute day, wall-clock hours, the month); two kinds of attack,
one of them fought out of sight; locked tiles on every shelf; and a first
tip that asked for something a new camp could not do. The fixes below were
chosen against the owner's steer: show off that you read, never a daily
chore, reading pays for everything, losses small and seen.

**The game in one paragraph.** Reading drops acorns on the oak (every ten
minutes) and sends parcels up the path (a chapter read, a day's goal met).
Acorns build the camp, and are its one money: since 1.5.8 a building's
reading time is part of its price (half an acorn a minute, `ACORNS_A_MINUTE`)
and it stands as soon as it is paid for; a guardian's training likewise.
The burrow is the camp's level, and each level clears more of the wood and
brings something new. From level 2 prowlers come out of the wood while the
camp is on screen: what throws, the fence, the constructs and the guardians
see them off, and one who gets through knocks a building about or takes a
few acorns (two knocks and one theft a day at most). The scouts raid the
magpies' strongholds, led by a hero; heroes come for books finished. The
camp is on the reader's profile for friends to see, and the camera makes a
postcard of it.

**One next thing, always** (`nextStep`). Pip's bubble has three lines at
most: a tip when one is due, the next thing, and the parcels. The next
thing is the list (`QUESTS`, rewritten: nineteen steps in the order the camp
opens), said as reading while what it asks for goes up ("Read 3 more
minutes: the larder is finished"); after the list, whatever is building,
the cheapest thing that can be built, or reading. A finished book whose
trophy can be raised takes its place until it is. A tap on it goes to where
it is done, and the key where it is done is marked. The list ticks itself
off (`advanceList`, run after every change in `baseStore`); its acorns go in
whole or wait, and the line says "the larder is full" while they wait. A
camp from before the rewrite is put on the new list once (`LIST_MARK` in
`taught`), passing over what it has already done without being paid for it.

**A first session.** Level 1 shows the clearing, the burrow, the oak and Pip;
two chips (level, acorns); three keys (Camp, Defence, People). Pip says:
read ten minutes, then tap the oak. Then the larder, the scouts' hut and the
lookout, each finished by a few minutes' reading, and the burrow's level 2,
which brings the prowlers, the fence and the postcard, a tip each. The
three-bubble introduction is gone (it spoke of a larder, magpies and scouts
a new camp does not have); the twenty acorns a camp starts with build
nothing, so the first thing is always to read.

**Nothing locked on show.** A shelf shows what is open and the next one
only: one plot to come, one construct to come, the fence (from level 2) on
the Defence shelf. Guardians appear on the People shelf and their buildings'
cards from level 3. Decorate, Raids (once there is a hut), Arrange and the
camera appear when they mean something.

**A quieter screen.** The top has the level and the acorns (charm too, from
level 3). The season, the streak, the oak's rate and the book being read
are in those chips' tooltips. The (i) has five lines on how the camp works,
then what has happened (the old Journal: strongholds, banners, trophies,
the clubs' bosses, Pip's tales, the last few events).

**Parcels are the one inbox.** A chapter read (eight minutes behind it), a
day's goal met (once a day), the hen's egg, the bees' honey (a parcel a day
for each level of the hives) and a walk Pip was on before walks went: all
arrive as parcels by the burrow's door, six at most. A parcel holds
4 + 2 × the burrow's level acorns, and one more for every 30 of charm; every
other one or so has one of Pip's tales in it. It is opened whole or not at
all: a full larder leaves it waiting, and the button says "Larder full".
"Open all" opens as many as fit.

**Nothing promised that does not arrive.** The Gather button says what the
tap brings, the streak and the season counted and as far as the larder has
room (`gatherBrings`), and the figure over the tree is what came in. A
trophy's acorns are shown as what fits. The list's reward waits whole.

**Defence, briefly.** As before, with three changes. The calendar night is
no longer fought: prowlers in the picture are the only thing that comes at
the camp (the day turning still marks `night` as through). Heroes no longer
run out to prowlers: guardians hold the camp at their signposts, heroes lead
raids and are shown off, and nobody has to tell the two apart. A knock no
longer wears a building down by a tenth (`WEAR_A_KNOCK` is 0): a knocked
building works until it is broken, at four knocks, and is fixed for acorns.
A friend's raid now stops only the fence from being built on until it is
mended (it stopped all building). The fence comes with level 2
(`FENCE_FROM`). Twelve constructs, seven guardians, the gate, landscape that
turns prowlers, the red and blue rings, the caps on what prowlers cost: all
as they were.

**Animals.** The cat: one prowler in ten thinks better of it and stays in
the wood. The owl: mending is a quarter cheaper. (Both did something to the
night.) The hen's egg is a parcel.

**One name.** What comes at the camp is a prowler, everywhere; the magpies
are the ones whose strongholds the scouts raid.

**Hidden, and how to bring each back.** Every field stays in `BaseState`,
is read by `readBase` and written back as it was read; the save is still
`v: 2` (a `v: 3` would make an older build start a new camp, and newest
wins in the backup). The rules of most of them are still in `rules.ts`,
unused.

| Hidden | Fields kept | To bring it back |
|---|---|---|
| The calendar night (`nightOutcome`), its report, the lantern oil, a thing carried off | `night`, `nightAt`, `report`, `oil`, `stolen` | the block in `settle` (see its comment); the Tonight tile and card and the Watch button in `BaseScreen` (in git history). A thing already carried off comes home with the next raid won |
| The hedgehog's daily offers, the quiz's tips | `visitor`, `intel`, `pack`, `quizDay` | `offers`, `takeOffer`, `afterQuiz` are still there; the dock key, card and `WordQuiz`'s call |
| Pip's wish, the heroes' wants | `wishDay` (now the day the goal parcel came), `wants`, `bonds` | `wishToday`, `wantOf`, `grantWant`; the daily reset in `settle` |
| Pip's walks | `trip`, `tales` (tales now come in parcels) | `sendOut`, `welcomeBack` |
| The dew on the first gathering | `dewDay` | the end of `gather` |
| Paths at level 3 | `forks` (a path taken keeps its effect) | the Path row on the site card |
| The road's three camps a day | `wild` | the "On the road today" cards on the raids page |
| The Magpie King before ten strongholds | `kingDay`, `banners` | `KING_FROM_CAMPS` (was 3) |
| Wagers | `wager`, `purse`, `scores`, `stats.wagers` | `WagerBar` (a wager placed before still settles) |
| Wear | `harm` | `WEAR_A_KNOCK` back to 0.1 |
| The market stall | `yard` | the filter on the empty plot's buttons |

Friends' cards are untouched: Rust's `camp_summary` and the server read
`levels`, `yard`, `camps`, `banners`, `raised`, `spots`, `walls`, `decor`,
`land`, `works`, `guards` and `posts`, all as they were (a test settles a
camp with every field set and checks these, and the hidden ones, do not
move).

**Measured** (`full-sim.ts`, a copy run against these rules: no walks,
wishes, hedgehog, road or nights; the list ticked as it goes). The oak drops
more to make up for what went (`OAK_DROPS` 8, 13, 20, 28, 40; it holds 50,
80, 130, 200, 300), and a parcel is worth more.

| Reading a day | Six buildings at 5 (was) | All guardians at 3 (was) | Acorns a day (was) | Careless, lost a day |
|---|---|---|---|---|
| 10 minutes | day 242 (158) | day 298 (212) | 56 (65) | 21% |
| 30 minutes | day 79 (72) | day 99 (92) | 168 (166) | 8% |
| 60 minutes | day 49 (46) | day 62 (60) | 266 (260) | 6% |

The reader of ten minutes a day is slower than before: the dew doubled
their oak, and the road and the nights were a third of their acorns. The
oak is two thirds of what comes in at half an hour, parcels a third, raids
very little (strongholds only).

Tests: `rules.test.ts` ("a camp kept before the simplifying", "nothing
promised that would not arrive", "the one next thing", "Pip's list"),
`life.test.ts` (parcels, the goal, walks, the dot on the way in), and the
older tests changed where they encoded what went.

Friendship, which grew from the heroes' wants, now grows from reading: each
day's goal parcel makes every hero in the camp a step fonder (to
`BOND_MOST`), so a hero's own blade (`BLADE_AT_BOND`, 3) comes after three
goal days with them, with a line in the journal (`life.test.ts`, "grow
fonder of the camp").

Left as it is, on purpose: the light reader's pace (above). A ten-minute
reader is slower than before, and slower than a long reader, which is what
the Hollow is for (showing that you read); nothing in it asks for a visit a
day. `BattleScreen` still has the night-watch mode, unused.

### The Hollow by chapters (1.5.8 to 1.5.10)

What changed after the simplifying. The burrow is no longer the camp's
level, and no larder fills up: the level is the reading done. Pip's side of
it, and what is being built next, is in [pip.md](pip.md), "The Hollow".

- **Acorns are the one money** (1.5.8; `components/pip/arcade/base/currency.ts`).
  A building's reading time is part of its price (half an acorn a minute,
  `ACORNS_A_MINUTE`) and it stands as soon as it is paid for; a guardian's
  training likewise. Collected acorns fly up to the count (`collect.tsx`).
- **A tap on a building opens its sheet** (1.5.9; `base/siteSheet.ts`): what it
  does now, its next level, what that needs, one key, and why not when
  pressed anyway. On a phone held sideways the camp is a window onto a
  picture a quarter larger than the screen (`base/camera.ts`); see
  [android.md](android.md).
- **Chapters by hours read** (1.5.10; `pip/base/chapters.ts`). Ten chapters,
  reached at 0, 0.25, 3, 6, 10, 15, 21, 28, 36 and 45 hours read in Leaflet
  (the minutes ledger the oak counts by), then a new volume every 15 hours
  with no end. Each chapter brings one new thing (the scouts and raids, the
  lookout and prowlers, the fence, the yard and decorations, guardians, the
  meadow and animals, more defences, a second plot, the Magpie King), a chest
  of acorns paid the moment it is reached (40 at chapter 2 up to 300 at 10;
  200 a volume) and two or three optional goals that pay acorns too
  (`GOALS`). The burrow's level follows the chapter by itself (level 2 at
  chapter 3, up to 5 at chapter 9), and every other building can go as high
  as the burrow. A volume brings a stone with the hours carved on it and a
  set of things to set down (`VOLUME_SETS`). A camp from before chapters
  keeps everything its burrow had opened (`legacy`), and gets one chest.
- **The chapter bar** across the top (`HollowTop.tsx`): the chapter, how far
  through it the reading is, and the one next thing. A tap opens the chapter
  card (`ChapterCard.tsx`) with what the chapter brings, in pictures.
- **Nothing expires.** No larder cap and no cap on the oak: it holds
  everything read since the last gather. Up to 99 parcels wait. Acorns have no
  top; what is saved keeps at most 1,400 in `acorns` and the rest in `bank`,
  so a 1.5.9 build reading a 1.5.10 camp clamps nothing.
- **The raid board** (`RaidBoard.tsx`, `raidBoard`, `raidForecast`): up to
  three cards, a rematch of the last stronghold taken (a sure three stars for
  small loot), the next stronghold, and from chapter 10 the King. Each says in
  a plain sentence how the scouts expect it to go, with its stars. "Fight it"
  is always there; "Send" (the scouts go without the reader, for 75% of the
  loot) only where they would win. Supplies are free: a raid costs no acorns.
  Three stars on a stronghold moves the ladder on and pays a bonus.
- **Friends' raids are news** (`FriendNews.tsx`, `state.news`, five at most):
  on opening the Hollow, who raided and how it went, in a line each, with
  **Put them back** for the fence pieces they knocked down and **Raid back**.
  Nothing is taken and nobody is put to sleep.
- **Raidable is off by default** (1.5.10). The raid board asks once, "Let
  friends raid your camp? Just for fun: nothing is taken."
  (`raidsAsked`). On the server a profile with no `raidable` at all now means
  no (`server/src/routes/raids.js`, `social.js`); it meant yes. **The server
  must be deployed for this**; until then a reader who never touched the
  switch can still be raided.
- **Rendering**: the camp is painted only when its art turns to a new frame
  (twelve a second) or while something is being done to it (`sceneGate`,
  `runScene` in `components/pip/arcade/frameGate.ts`), and not while it is out
  of view. It used to be painted at every display refresh.
- **The Build panel** has four tabs (Camp, Defence, People, Decor;
  `HollowDock.tsx`), and the (i) is a guide of short pages (`HollowGuide.tsx`).

Two things outside the camp came with 1.5.10:

- **Pip's earned skins unlock** (`src-tauri/src/pip/earned.rs`; see the
  shop's rules under "Seeds and the Pip tab"): a 7-day streak earns Maple.
- **The rating prompt after a good read** (`components/RatePrompt.tsx`). It
  followed only a focus session's wrap-up, so a reader who never used Focus
  was never asked. Closing a book after 15 minutes' reading, or with the
  day's goal met during the visit, is now a moment too, on the same terms:
  Leaflet used on 3 days, and not again for 14 days after "Later".

### The rest of the app, looked at with fresh eyes

Asked to "critique the app", a read of everything outside the arcade found
fifteen things worth fixing, and all but one claim held. Fixed the same day:

- "Mark as not started" wiped a book's place with one click under "Mark as
  finished": it asks first now, and both say when they fail.
- The list view's Remove turned into Confirm under the pointer, so a
  double-click deleted a book (and its Drive copy) with no dialog. The row's
  button is gone; the menu's "Remove from library..." is the one way.
- Pip's drawers said "Pip is getting dressed..." for ever when her things
  failed to load: there is a line and "Try again" now.
- The Library's hidden half of the session card could be tabbed onto,
  including a full-screen switch nobody could see (`inert` on it now).
- The Library counted finished books by progress, Social by the finished
  date: both use the date (`hasFinished`).
- Failures that showed nothing (rename, delete and add in Collections; new
  collection, tick and "back up this file" in a book's menu; a failed search
  for communities, which read as "none yet") are shown.
- Escape threw away a typed session note; it saves it, as Done does.
- Labels are tied to their fields, placeholder-only fields have names, and
  five toggles say they are switches (Settings, the sign-in forms, Library,
  Collections, the reading pace card).
- Standing explanations moved into tooltips (Collections, three in
  Settings, the library-copy card, the line under "Social").
- A book's menu can be used by keyboard: it takes the focus, and the arrows,
  Home and End move in it.
- A keeper can remove a member (the docs said so; nothing called it), an
  admin can pin, a book's posts have "Older", eight dead-end error lines
  have "Try again" (`ErrorLine.tsx`), a follow request answered elsewhere
  says "Answered" and not "Accepted", and the reader's own profile has one
  name everywhere ("Social → Board → You"; it had four).
- The owner's last missing control and the two spellings of a genre: see
  where each is written above.

What was left on that list was done next, on the owner's "fix the critiques
where you can": the right-to-left dock and shortcuts sheet, removed Kindle
highlights staying removed, and a PDF's subject and keywords as genres (each
written up where the feature is, above); the Library page no longer redraws
every second during a session (the countdown is a small part of its own);
a book's menu closes on Tab and keeps the focus after "Add"; removing a book
from its menu says "Removed <title>."; the Library's genre filter has one
entry for a genre however its books spell it; a launch-time read of reading
statistics that nothing used is gone; the PDF and text readers' Back buttons
have a name for a screen reader in a narrow window; and the reason "Connect
Drive" is disabled is on the button as well as the heading.

Still open, and why each is the owner's: a removed Kindle highlight is
forgotten after ninety days on a device that backs up (keeping it for ever
is a change to what the backup carries); Ctrl with an arrow is not mirrored
in a right-to-left book (it is a tested rule that it is the same in every
book); an admin as well as a keeper may remove a member and pin a thread
(the server allows it; say if it should be the keeper alone). None of these
fixes was looked at in a running app: they were read, type-checked and
(where there are tests) tested. Tests after them: 2,719 app, 765 Rust, 186
server.

**Page Flap's background no longer stutters** (`gameArt.ts`). A sprite with
no frame count was drawn again for every frame number that came by, twelve
times a second, and each kept: the whole 240 x 120 backdrop and every
pillar. Such a sprite is a still now, drawn once (the falling letters in
Leaf Catch, which do move, say their sixteen frames). All three games did
it; Page Flap had the most to redraw. The games were not played by hand
after the change: the preview's pane was hidden, where nothing animates.

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

The session wrap-up counts up "+N water 2×" (what the session poured, at the
focus rate) and any bonus seeds, and says "2 plants just ripened!" when it
ripened some. It also says what Pip found on her expedition
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

**Finished, with a date** (1.3). Finishing used to be read off progress and
nothing else, so reading a book again un-finished it (on the reader's stats,
their public card and the year in review) and nothing knew when it had been
finished. A book now keeps the day (`books.finished_at`, data-model.md):
stamped when its progress reaches the end, and filled for books already there
when 1.3 first opens the library. Two rules follow, both in
`constants/books.ts`: `isFinished(progress)` is where the book is now, which
is what a shelf and a card's label go by; `hasFinished(book)` is whether it
has ever been finished, which is what a count goes by (books finished here
and on the public card, the year in review, the goal). A book's menu has
**Mark as finished** (it goes to its end, dated now) and **Mark as not
started** (back to the start, no place kept, the date cleared on every
device).

Removing a finished book does not take it out of the count (1.3.1). Its row
was already kept for ninety days so the removal could reach the other
devices; a row with a finished date is now kept for good, as the record that
the book was read (`finished_and_removed`, and the merge never collects it).
A book at its end with no date is given one as it is removed. The row reaches
a device that never had the book, so the count is the same everywhere. The
stats, the public card, the goal and the year in review count the library's
books and these together (`library/finishedBooks.ts`, `finished_removed`);
shelves, series and the library's own "N Finished" are of the books that are
there. A book added back takes its date with it and is counted once.

**A goal of books for the year** (1.3; `components/goal/`). A card on Stats:
"7 of 20 books", a bar, and the pace in a word or two ("On pace", "3 ahead",
"2 behind", in whole books; within a book of the pace is on it). The pace runs
from the day the goal was set, with what had been read by then: what was
left to read, spread evenly over what was left of the year. From January it
made a goal of twenty set in October "8 behind" on its first day. The pencil
changes it (and starts the pace again from today); with none set the card is
one line offering to. Counted from finished dates in the year. Kept on this
device, a goal a year (`leaflet.goal.booksPerYear`).

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
| Star sticker | The longest session of a week with four or more spines |
| Moon sticker | A late-night read (started 23:00–04:00) |
| Coffee ring | An early-morning read (started 04:00–08:00) |

**Bindings, stickers and wear** (`components/shelf/dress.ts`). A book has
one binding wherever it stands (hashed from its id, so a run of sessions on
it is a matching set): cloth with headbands, leather with raised bands and
gilt lettering where the cloth carries gold, a glossy creased paperback, a
library binding whose call-number label carries the day, or cloth with a
paper title label. A tome stands a little taller than a paperback. A spine
has at most one sticker, and a sticker always means something (above; the
tip and the spine's label say what). Spines two or more weeks old sometimes
show a little wear (a dog-ear, a water mark, a scuffed corner, a faded head),
which means only their age. All of it is gradients on pseudo-elements, the
same on every device and render. A coverless book on a phone's library grid
gets a quiet version: its binding's finish (gilt fillets, gloss, a fine
weave) and on a few books a cup ring or a worn corner, kept off the
lettering (`--cloth-deco`).

The newest spine drops in when the shelf is next opened, and the wrap-up says
"Shelved as book #N".

**Every spine and loose page says which book it was** (1.4;
`habit/names.rs`, `commands/habits.rs` `ReadNames`, `commands/social.rs`
`shared_shelf`). The owner: "the sessions in social are all titled untitled.
Give them names of the book they were reading, even for sessions that are
not tracked or in focus." Two causes. A session started from the library (or
by Pip) has no book, since the timer is started first and a book opened
after: it was shelved with no name, "Free read" on the reader's own shelf
and "Untitled" on the one other readers see. And reading with no session
never had a book at all, and was not on the shared shelf.

- From now on a session started on no book takes the first book opened
  while it runs (`habitStore.nameSession`, called where a book is opened),
  and is recorded with it.
- For what is already on the shelf, the snapshot works the book out: the
  library keeps when each book was last opened on each day
  (`reading_sessions`), so a session is of the book opened while it ran
  (the latest), failing that the one opened nearest to it that day; a day's
  free reading is of the book opened last that day. A session started on a
  book shows the title the book has now. Nothing is written back: a guess
  stays a guess. With two books opened on one day it can pick the wrong one.
- The shelf others see is the twelve latest of both kinds, newest first, a
  day's loose pages after that day's sessions. Reading no book can be named
  for is left off, where it used to stand as "Untitled". A reader who never
  starts a timer now has a shelf. The server is unchanged: it stores the
  titles it is sent.

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
- Reader pages (a full page on the Social page since 1.5.5, it was a drawer):
  their camp in the Hollow as the banner (the Hollow postcard's picture),
  follow, kudos and weekly duels (accept or decline right there), their
  numbers and badges, the books they recommend (finished or reviewed with
  four or five stars), their library where they share it with you, their
  shelf and their other posts.
- **Kudos**: one a day for each reader, from their page or from one of their
  posts; one sent from a post says what it was for in their inbox ("for
  finishing Dune"). Nothing is bought or earned with them, so trading them
  gains nothing. Two badges count *different* readers, which the server keeps
  (up to ten each, as the kudos themselves expire after 21 days):
  **Cheerleader** (kudos to 10 different readers) and **Well-liked** (kudos
  from 10). The server grants these two; a profile cannot publish them itself.

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

### Friends: what readers who follow each other share (1.4)

Everything here needs the server of this version (`server/README.md`,
"Deploying this version"); against an older one the new calls fail quietly
and the page says so. None of it was run against a live server from the app:
the server's own tests pass (139), the app's parts are unit-tested and
type-checked, and the two have not been joined by hand.

- **A profile kept to followers** (`ProfileCard.tsx`). The switch is three
  ways now: Public, Followers, Private. "Followers" is found by handle and
  shows only a Pip, a name and a handle until its owner accepts a request;
  it is not on the public board. Requests are answered on the profile card
  and in the inbox. Private means what it always did. A released app (1.3.2)
  meeting a locked profile is sent an empty card it can draw.
- **A reader's library** (`commands/friends.rs`, `ReaderLibrary.tsx`). Off
  until "Readers who follow me can see my library" is ticked. Titles,
  authors, reading/finished/not started and percent: never a file, a path
  or a hash (a test reads what is sent). Sent after the profile's figures,
  and only when it has changed. On a reader's card it is a tab, with filters
  (all, in common, reading, finished) and "Yours too" on the books both
  libraries have. Two libraries match a book by `book_key`: the title
  without subtitle or leading article, and the first author's surname, so an
  EPUB and a PDF of one book are one, and two books that differ only in
  subtitle are wrongly one too.
- **Reading with friends** (`FriendsPanel.tsx`). For this library's books:
  who among the readers followed is reading the same one, with each one's
  progress bar beside the reader's own, and how many finished it. Up to 500
  books are asked about, the ones being read first.
- **Finished books and the feed** (`Posts.tsx`). "Tell your followers…" on a
  finished book's menu, or "I finished a book" on the feed: one to five
  stars (optional) and a line of up to 280 characters. The feed is the
  reader's own posts and those of the readers they follow, newest first; a
  reader's posts are also a tab on their card.
- **Book clubs.** A name, a code to join by, an optional weekly goal in
  minutes, a list of books anyone in it can add to, and a board of its
  members' week. Up to 10 clubs a reader, 50 members a club. The goal is in
  minutes because pages are not counted anywhere in the app.
- **On the board and the card:** the book a reader has open ("Dune · 34%",
  the last opened that is begun and unfinished, within 30 days), their level
  and their badges; on the card, their arcade bests.

### Discover and book communities: the public, optional half (1.4)

(`commands/discuss.rs`, `services/discussService.ts`, `components/discuss/`,
`components/community/Posts.tsx`; the rules are the server's,
`server/README.md` "Moderation"; what readers agree to is
`docs/legal/community-guidelines.md`.) The owner asked for "a social media
feed kind of thing, to scroll book recommendations", quotes from highlights,
proper reviews with like and dislike, and communities for a book "to discuss
theories and stuff", all optional, and "creation of communities has to be
well thought of so people don't abuse it". The Social page has five tabs
now: Stats, Board (it was "Community"), Friends, Discover, Communities.

**What can be posted.** A post is one of three things about a book: that it
is finished (stars and a line, as before), a review (stars and up to 3,000
characters; one a book a reader, a new one replaces the old), or a quote (up
to 500 characters, with a note; at most 30 from one book). "Post" on a
highlight's share dialog starts a quote with its words in. Each post is for
"My followers" unless "Everyone" is chosen, and can be marked as giving the
book away, which covers it until a reader asks. Every post can be liked or
disliked (not by its writer), and its title opens what else was said of
that book, with how its reviews average and its community.

**Discover.** What readers anywhere posted for everyone: the newest, or the
best liked of the last month.

**Communities.** One for each book and one for each series, named after the
book. Threads (a title, up to 5,000 characters, a spoiler mark) and flat
replies, both with like and dislike.

**Spoilers.** A thread says how far into its book it goes: nothing, the
first so many percent, or all of it; for a series, up to which book. The app
knows the reader's own place from their library (`spoilers.ts`), so a thread
past it is a cover that says how far it goes and opens only if asked. A
reader who does not have the book has everything marked covered. Their
place is not sent anywhere for this: the server could reveal the titles of
marked threads to a reader who says how far they are (`?at=`), and the app
does not ask it to, so in a community's list a marked thread that is not
past the reader shows as "A thread with spoilers" with how far it goes, and
has its title once opened.

**What keeps it from being abused.** Decided before any of it was built:

- *Nobody names a community.* It is its book's or series' title and there is
  one a book (the same key a shared library and a review use). There is
  nothing to squat on and no free text to be offensive in.
- *A new community is invisible to everyone else* until three readers with
  accounts a week old and a confirmed email address have joined it. A
  made-up or offensive "book" stays unlisted and unsearchable.
- *Who may start one:* a public profile, a confirmed email address, an
  account a week old, the guidelines accepted; one a day, five in all.
- *Who may post for everyone, join, or write in a community:* a public
  profile, a confirmed email address, an account three days old, the
  guidelines accepted (asked once, the first time), and not suspended. The
  server says which is missing, in words the app shows.
- *Limits:* 20 posts a day, 10 of them quotes, 5 threads, 60 replies, 20
  reports; 30 quotes a book; deleting something does not give the day's
  allowance back. Discover shows at most three posts by one reader a page.
  Nothing in a post is a link (it is plain text, and the app does not make
  text clickable). A like or a dislike needs a confirmed email address and
  an account three days old.
- *Reports:* on every post, thread, reply, community and reader. Three
  readers' reports hide a post, thread or reply at once, before anyone has
  looked; two for an unmarked spoiler mark it as one instead; five unlist a
  community. Only reports from readers with a confirmed address and an
  account three days old count, a reader whose reports keep being dismissed
  stops counting, and once the owner has looked at a thing and let it
  stand, more reports no longer hide it. The writer sees their own hidden
  post, with why.
- *Blocks:* either way, the two stop seeing each other everywhere and cannot
  follow, challenge or send each other anything; the refusal does not say
  who blocked whom. Undone under Board → You.
- *A keeper:* the reader who started a community pins threads and removes
  threads, replies and members in it; the role passes on when they leave.
- *The owner:* an account marked admin in the database sees a Reports panel
  on Discover (the server answers "no such route" to anyone else), and can
  dismiss, restore or remove what was reported, suspend its writer for 7 or
  30 days, and pause public posting altogether. A suspension outlasts
  deleting the account and signing up again with the same address. The
  owner can also correct a community's title and author, replace its
  keeper, lift a ban, and list or unlist it by hand: an "Owner" button in a
  community's own header, seen only by an admin (`Communities.tsx`, the
  `admin_community` request in `discuss.rs`). That was the last admin route
  with no control in the app.
- *Leaving:* making a profile private or kept to followers hides everything
  it posted for everyone and takes it out of its communities; deleting the
  account deletes it, except a thread others replied to, which stays, by "a
  reader who left".

**Not done, and known.** Three established accounts are enough to list a
community, and three to hide a post: someone with several confirmed email
addresses and a week's patience can do either, and only the owner's review
undoes it. A community's title is what its first reader's app sent. There
is no filter on words. A review's text is read by nobody before it is
posted. Posts do not show covers (the server has none). There is no "save
for later" list and no notification when someone replies to a thread. None
of it has been run against a live server from the app: the screens were
filled with stand-in data in the preview and worked there, and the server's
own tests cover its rules.

### Badges, levels and the month's challenge (1.4)

(`habit/badges.rs`, `pip/levels.rs`, `components/community/badges.ts`,
`BadgesCard.tsx`.) The owner: "people should be able to show off... badges
when you complete difficult milestones, similar to Strava". Twenty-eight badges
worked out by the backend from the ledger, the shelf and the shop (streaks
of 7, 30, 100 and 365 days; 10 to 500 hours; 1 to 100 books; focus sessions;
a two-hour day; harvests; things owned; arcade scores; levels), and two a
calendar month for 500 and 1,000 minutes read in it. Stats shows the earned
ones as medals in four metals, the six nearest dimmed with a bar, and this
month's challenge as a line. A shared profile publishes the ids of the
earned ones. The level is from seeds ever earned, spent or not (level n
begins at 50 x (n - 1) x n seeds), and not from what a bet or a duel won.

### More to do with seeds (1.4)

The owner: "there is actually not that much motivation to get seeds, other
than cosmetics". All in the Seeds drawer on Pip's page (`SeedUses.tsx`)
unless said; the rules are the backend's and nothing is stored as a balance.

- **A streak freeze**, 120 seeds, at most two a month and two held. It lives
  on the device that bought it (the streak's state is not synced); the
  charge is.
- **A bet on the week's goal** (`pip/stakes.rs`). 10 to 100 seeds that the
  goal will be met on 3 to 7 days of this week, placed Monday to Wednesday.
  A day counts with the goal met and at least 20 minutes read, whatever the
  goal is set to. Won, the stake comes back with a fifth of it for each day
  beyond two (three days: 1.2 times; seven: double). Whether it was won is
  read from the day ledger every time, never written down.
- **Seeds on a duel.** A challenge can carry 10, 25 or 50 seeds each. Nothing
  is taken until the other reader accepts (and they cannot without the
  seeds); then each app puts its own stake down, and when the week is
  settled the winner's comes back doubled, a tie's as it was. The server
  only carries the number. It is trust-based: each reader's seeds are on
  their own device, and a prize counts for no more than twice a stake that
  is on record.
- **Presents** (`GiftDialog.tsx`). "Send a present" on the card of a reader
  who follows you back: a thing from the shop that Pip keeps, paid for here,
  theirs when their app next looks (as it opens, then every five minutes). Five a
  day.
- **Rare things by level** (`pip/shop.js` `RARE_LEVELS`). Six new things to
  wear that the shop sells only from a level: a magnifying glass (3), a
  quill (5), a scholar's cap (8), a reading lantern (10), a starry wizard
  hat (12) and a starry cloak (16).
- **Three sounds for the radio**, 150 seeds each: a summer night, a stream,
  a night train. The six there were stay free. Not heard by anyone: their
  levels were set by measurement against the others.
- Not built: new arcade games, expedition places, page finishes or fonts to
  unlock.

## Sync, sold as backup

**Where:** `sync/` — `merge.rs`, `store.rs`, `folder.rs`, `drive.rs`, `cloud.rs`

For the desktop launch this is presented as **backup to Google Drive**: one
computer, restorable on another by signing in with the same Google account. It
backs up on launch and whenever a book is closed. Folder sync and "sync across
devices" wording are behind `FEATURES.multiDeviceSync` until the mobile app
ships (see [product.md](product.md)). `sync_now` runs one at a time (a lock in
`AppState`), because two simultaneous first syncs used to create two
`state.json` files in Drive.

**Backing up to the Leaflet account alone** (1.3). The account's copy of the
reading state used to ride along with a Drive or folder backup and never went
by itself, so a reader with an account and no Drive had nothing kept but
their numbers on the board. Settings, Backup has a switch for signed-in
readers, "Back up reading to my Leaflet account", off until chosen
(`cloud::backs_up_alone`, the setting `cloud_backup_alone`,
`set_account_backup`). On, a backup runs with the account as its only
transport, at launch and after changes like any other. It carries the
reading (progress, highlights, days, Pip) and never book files, so on a
second computer the books are listed and each needs its file added again;
the message says so. Signing out, or deleting the account, turns it off.
Turning it off sends nothing more and leaves what the account holds. It is a
choice and not a default because it sends the reading to Leaflet's server,
which a Drive backup does not: making it the default is the owner's to
decide, with the privacy policy.

**Replaced in 1.5.3:** the owner decided. Signed in, the reading always goes
to the account and the switch is gone (`cloud_backup_alone` is no longer
read); Drive and the folder carry the book files. See
[two-devices.md](two-devices.md), "One library, one owner; the account
carries the state".

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

### A large file waits for the reader's word

(1.4; `sync/large.rs`, `library/largeBooks.ts`,
`hooks/useLargeBookPrompt.ts`.) The owner: "this book is quite large, 45 mb.
If a book is that large, ask users permission before backing it up. Set a
10mb limit." A backup to Drive or a folder sent every file, whatever its
size, into a quota the reader shares with everything else.

- A file over 10 MB (`LARGE_BOOK_BYTES`) is sent only when the reader has
  said yes. Only the file waits: the book's place, notes and highlights are
  in the shared document and go either way.
- A backup that held files back says how many (`booksHeld`); the app then
  asks once, in its own dialog, about the books not yet answered for: one by
  name and size, or several with what they come to. Not while a book is
  open. "Yes" backs up again at once. Escape counts as "no".
- A "no" is taken back from the book's ⋯ menu ("Back up this file", with
  its size), shown where a backup carries files and this one is not sent.
- The answers are this device's (the setting `backup_large_books`), not
  synced. A large file already in the backup when this arrived is recorded
  as "yes" and never asked about. A "no" does not remove a file the backup
  already holds, and a "yes" cannot be withdrawn in the app.
- The account's own backup carries no files, so it never asks.
- Not tried against a real Drive or a real sync folder: the rule and the
  answers are unit-tested, the two transports' use of them is not.

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
  Credential Manager, or on Android sealed by the Keystore (`SecretBox.kt`),
  never in SQLite or `localStorage`.
- The name: an account has one and so does the profile (the profile's is
  the one other readers see; the account's is what the app shows by the
  reader's avatar). They were set together only at sign-up, so a name changed
  on Social left the old one in the sidebar for good. Saving the profile now
  sends the name to both (`cloud::set_display_name`, `PATCH /v1/account`),
  and the sidebar follows without a restart. No server change.
- Avatars: signing up means picking a Pip (a skin plus a signature move, stored
  as `skin.move`, e.g. `wizard.magic`) from the catalogue in `pip/avatars.ts`,
  preselected at random; the You card on Social → Community swaps it later, and
  "Use my Pip" on the Pip tab sets the reader's own dressed-up Pip (see
  [the profile picture](#the-profile-picture)).
  The server checks ids against its own copy (`server/src/avatars.js`, kept in
  step by a test) and never offers earned skins (Champ, Golden, Prism). Boards
  hold avatars still and play the move on hover; the reader card plays it.
  Accounts from before avatars show Pip in a skin picked from their handle.
- **Signing in, simpler** (1.5.9; `components/account/`). One form for
  signing in, creating an account and a forgotten password
  (`AccountForm.tsx`), used by Settings → Account and the account dialog
  alike. The switch between signing in and creating an account is its top
  line (it was under the whole sign-up form, below the fold of a phone's
  sheet). Creating an account asks for an email and a password only; then,
  where the community is on, one short step: a handle to share the profile,
  or "Not now", which leaves it private (`signUpFlow.ts`). The emailed code
  is asked for once after that, or "Later". Signing in never asks. A page
  that needs an account (Social's board, Friends, Discover) shows one line
  and a Sign in button that opens the form there (`SignInPrompt.tsx`).
- **Deleting the account** (Settings → Account → Delete account, with the
  password) removes the account, profile, synced state, sessions, problem
  reports and community data at once. Since 1.5.10 every way of deleting
  goes through one function (`server/src/deletion.js`): the route, the
  owner's `src/tools/delete-account.js` for a request by email, and the
  backup restore tool. Each deletion is noted first in `deletions` (the
  account's id and when, nothing else, kept 45 days), so a restored backup
  deletes again what was deleted after it was taken. A public page says how
  to ask without the app and what is kept ([legal/delete-account.md](legal/delete-account.md),
  built to the site's `/delete-account/`).
- **Report a problem** (1.5.8; Settings → General → About,
  `components/ReportProblemSheet.tsx`, `server/src/routes/problems.js`). A
  reader says what happened, with the app's diagnostics if left on, and
  presses Send. Signed in, the report carries the account; signed out, an
  optional reply address. Anyone may send one, held to five a day per
  account and ten per address, and to 1,000 waiting at once. A report goes
  by itself after 90 days, and with the account; what it says is never
  written to the server's log. The owner reads them in Settings → Admin
  (`ProblemsPanel.tsx`). Where there is no server, the sheet copies the
  report for an email instead.
- **The server's database is backed up nightly**, encrypted, to a Google
  Drive the owner keeps ([backups.md](backups.md)). Atlas's free tier keeps
  no backups of its own, and since 1.5.3 the database holds signed-in
  readers' highlights, notes, places and history.
- The server never receives Google or Drive credentials.
- **Forgot password?** on the sign-in card emails an eight-character code
  (`ABCD-EFGH`) that sets a new password, signs every device out and this one
  in. Codes are stored hashed, last 15 minutes, allow five wrong tries and work
  once; the request answers the same whether or not the address has an
  account. Three completed resets per account in any 365 days; past that the
  email explains the limit and the date instead of carrying a code. The email is sent by a Google Apps Script web app from the owner's
  Gmail (`server/deploy/password-reset-mailer.gs`, about 100 a day, free); the
  server holds only a shared secret for it (`server/src/mail.js`).
- **Confirming the address** (1.3.1; `components/account/AccountForm.tsx`,
  `AccountEmail.tsx`, `emailHint.ts`). A typo at sign-up used to lose the
  account for good: no reset email could ever arrive. Signing up now emails an
  eight-character code (30 minutes, five wrong tries, stored hashed together
  with the address it went to) and the form ends on one step, "Enter the code
  we emailed to …", with Confirm, Resend and Later. Nothing waits on it: the
  account works at once. Unconfirmed, the only reminder is one row in
  Settings → Account ("Email not confirmed": Confirm, Resend, Change); accounts
  from before this are unconfirmed and see only that row. The address can be
  changed there with the password (`POST /v1/account/email`): every device
  stays signed in, the new address starts unconfirmed and is sent a code, and
  codes sent to the old one stop working. Under the email field at sign-up, a
  domain one slip from a common one (gmial.com, gmail.con) gets a quiet "Did
  you mean …?" that fills the field and never blocks. The server says
  `emailConfirmed` on every account answer; one with no mailer leaves it out,
  and the app then shows none of this, as it does with a server from before
  1.3.1. At most five confirmation emails an hour per account and three per
  address, through the same Apps Script as resets, as a third fixed message.
  **It needs the mail script and the server deployed** (deploy.md, 4b and
  "Releasing an update"): the script first. Nothing tells the old address
  when an email is changed, and a completed password reset does not count as
  confirming. Not seen on a screen; the server's part is tested (108 tests).

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

### Liquid Glass (1.5.8, 1.5.9)

Desktop and Android share one look: clear glass bars, sheets and buttons with
a rim that catches the light, and pages that soften as they scroll under a bar
instead of stopping at a hard line. Pip's own surfaces keep her pixel-paper
style.

- **Scroll edges** (`components/ui/GradualBlur.tsx`, `ScrollEdge.tsx`): a ramp
  of blur where content scrolls under a bar or out of a panel. A touch device
  gets at most five layers (`TOUCH_LAYERS`: each is a backdrop filter drawn on
  every scrolled frame). Where no blur is drawn, a tint wash alone fades the
  edge.
- **Refraction** (`components/ui/GlassSurface.tsx`, `glassRefraction.ts`,
  `LiquidGlassDefs.tsx`): the lens bends what is behind it at the rim. Where
  the bend cannot be drawn, it is frosted glass with a sheen and a rim.
- **Windows 11's Mica** behind a see-through window (`src-tauri/src/window_material.rs`,
  `styles/window-material.css`). Chosen before the window exists, since a web
  view is made see-through only when it is created; Windows 10 keeps its
  opaque window.

**Visual effects tiers** (`platform/perfTier.ts`, `styles/perf.css`, the one
place the lighter looks are written). Settings → General → Appearance →
**Visual effects**: Auto, Full, Smooth.

| Tier | `html[data-perf]` | What is drawn |
| --- | --- | --- |
| Full | `full` | Everything: the lens, ramps of blur, frosted bars and sheets |
| Smooth | `lite` | No lens and no backdrop blur at all; edges fade by tint; bars, sheets and menus are near-opaque tints with the rim; the same shapes and motion |
| Minimal | `minimal` | Smooth, solid. Not offered as a choice: Auto picks it for the weakest devices |

On Auto, **Android is Smooth on every phone** (the owner's call: a phone
scrolling under a blurred bar redraws the blur every frame, and an Adreno 619
dropped frames scrolling and throwing Pip). Minimal at 2 GB of memory or
less, or a weak or software GPU with little memory or few cores. Full on a
phone only by choice. Windows is Full, Smooth on a software renderer, minimal
at 2 GB or less. What the device was judged to be is kept
(`leaflet.perf.auto.v1`). Then, on Auto only, a short probe of frame times
after start and a watchdog over scrolling and dragging (15% of frames over
25 ms across 3 s of movement) can step the tier down for the session. The
Hollow's busy paints are capped by the tier too (`busyFpsFor`: 60 a second on
Smooth, 30 on minimal).

**No page-wide `:has()`** (`platform/rootMarks.ts`). Rules like
`html:has(.reader-scope)` and `.app-shell:has(.pip-house-page)` made the
browser restyle the whole document whenever any element was added or removed
anywhere (a row of covers as the library scrolls, Pip's speech, a toast):
about 10 ms each time on a desktop, 90 to 200 ms on a phone. What they asked
is now an attribute on `<html>` set in a layout effect: `data-reading` (a book
is open), `data-pip-page`, `data-pip-fill`, `data-pip-out`; an open sheet is
`data-sheet-open` (`components/ui/motion.ts`) and the dock is
`.app-shell[data-dock]`. A test keeps such `:has()` out of every stylesheet
(`styles/hasSelectors.test.ts`); a `:has()` on a small part (a toolbar, a
card) is fine.

---

**The bar at the foot of the page can be made small, and is not on Pip's
page** (1.4; `App.tsx`). The bar with the book being read sat over Pip's own
row of buttons ("kind of disturbing"). It is not drawn on Pip's page, where
"Continue" is among her buttons already. Elsewhere a small arrow at its end
makes it a cover and a play button; the cover opens it out again. Kept in
`leaflet.nowReading.small`.

**Pip holds still in the logo** (1.4; `PipHome.tsx`). At home she is the
logo, and she breathed and blinked there, beside the page being read. She
is drawn as one still pose now, asleep or awake.

## Settings

`pages/SettingsPage.tsx`. A few short sections behind tabs: **General**,
**Reading**, **Library**, **Account** (only in builds with accounts or the
community) and **Admin** (only for the owner, signed in). There used to be six
(Habit and About had a tab each, measured to fit a 1366×768 window without
scrolling); their cards moved into Reading and General, and a kept tab of
either name opens the new one (`MOVED` in `pages/settingsSection.ts`). Each
section is columns of cards, every card as tall as what is in it.

| Section | Cards |
| --- | --- |
| General | Appearance (theme, Visual effects); Pip (how much it moves, the tour, sounds); About (rate, policies, Copy diagnostics, **Report a problem**, open-source notices); Danger zone |
| Reading | Daily goal and focus; Reminders; Reading pace; Turning pages (a phone: volume keys); Characters; Keep the words I look up; Studio voice (beside Reading pace on a computer, last on a phone; shown only where the build has its runtime) |
| Library | Backup or Sync; Book copies; Tidy a folder; Optional book converter (not on a phone); Storage |
| Account | Account; Leaderboards |
| Admin | Problem reports (`components/discuss/ProblemsPanel.tsx`); the admin panel |

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
  query), and Play's keys (eleven, since the cuddle, the high five and the spin
  were added on 2026-10-13) shrink to their names before they wrap.
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
