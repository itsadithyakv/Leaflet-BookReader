# Leaflet 1.0 — release notes

**Version 1.0.0 · Windows · 28 September 2026**

Leaflet is a free book reader for Windows that keeps your library on your own
computer and turns reading into a daily habit, with Pip, a small pixel-art
companion who lives in the app. No subscription and nothing locked. An account
is optional.

This is the first public release.

---

## Your library

- **Drop books in** anywhere on the Library page, or click to browse.
  **EPUB, PDF, CBZ comics, TXT, HTML and FB2** open straight away; 19 more
  formats (MOBI, AZW3, DOCX and others) open through a free Calibre install.
- **Covers from inside the book** first, then from Open Library and Wikipedia
  for books without one. Titles and authors are read from the book itself.
- **Series gather by themselves.** Own all seven Harry Potter books and they
  become one series, in reading order, even when the files say nothing about
  it. Leaflet reads the series from the book (Calibre and EPUB 3 metadata),
  from titles like "Leviathan Wakes (The Expanse, #1)", and knows about fifty
  well-known series by title and author, UK and US titles included.
- **Next in your series.** Finish a book and the next one waits above your
  library. If you don't have it, Leaflet names it: "Catching Fire · Book 2 ·
  not in your library". Each series page shows your books in order, the ones
  you're missing, and how far through you are.
- **Shelves that keep themselves up to date:** Reading now, Next in your
  series, Recently added, Not started, Paused (left mid-book for a month),
  Finished, and Possible duplicates (the same book as two files).
- **Your own collections.** Make one from the Collections page or any book's
  ⋯ menu, and add books with a quick search.
- **Fix anything by hand.** A book in the wrong series, or not in one at all:
  ⋯ → Series.
- **Sort by title, author, series, date added or last opened,** and search
  titles, authors, genres and series names.
- **Big libraries stay quick.** Only the books on screen are drawn, and covers
  load as small thumbnails.

## Reading

- **Scroll or turn pages.** Reader panel → Layout. Arrow keys, Page Up/Down and
  Space turn pages.
- **Search the whole book** with Ctrl+F; results are grouped by chapter and
  jump straight to the words.
- **Highlights in four colours, with notes.** Select text to highlight, add a
  note, or copy. Tap a highlight to see its note.
- **Bookmarks and a notes panel** listing everything in reading order, with
  **Copy all** as Markdown for your own notes app.
- **Progress that means something:** measured by how much of the book is
  behind you, not how many chapters, so a long chapter no longer jumps the
  percentage.
- **Make the page yours:** text size, and a page finish: warm paper, dark
  paper, true white, true black, or the app's own light or dark theme.
- **Smart Read** paces your reading with a gentle guide dot.
- **SpeedRead** shows one word at a time at the pace you set, holding your eye
  on one spot.
- **Auto-scroll** that learns your pace.
- **PDFs and comics** in a page reader with zoom.
- The toolbar gets out of the way while you read and comes back when you reach
  for it.

## The reading habit

- **A daily goal and a streak,** with freezes and a grace day so one busy day
  doesn't undo a month.
- **Focus sessions** (10 to 45 minutes). The timer runs only while you're
  actually reading: a book open, Leaflet in front, and you turning pages.
  A book left open behind other windows doesn't count.
- **Full screen and a focus flower.** Switch on Full screen beside Start
  Session and each session plants a flower (a tulip, daisy, sunflower or
  rose) that grows as you read and blooms when the session ends. Leave early
  (end the session, spend more than 30 seconds in another app, or close
  Leaflet) and it wilts. Your minutes still count; the flowers you grow are
  counted on every device.
- **The session bookshelf:** every session becomes a book spine on your shelf.
- **Reading reminders** as Windows notifications, even while Leaflet is closed.
  Clicking one opens your last book.
- **Stats and a reading calendar** on the Social page.

## Pip

- Pip lives in the app: it perches on the Leaflet logo, reacts when you finish
  a book or keep a streak, naps at night, and has a few surprises for some
  famous books.
- **Seeds** earned by reading in focus grow Pip's garden and buy decor and
  outfits for its room.
- A short tour on first run. Drag Pip anywhere; click the logo to send him
  home; right-click him for shortcuts.

## Backup, account and community — all optional

- **Back up to your own Google Drive:** your books, progress, streaks,
  highlights, notes and collections, restorable on a new computer. Leaflet can
  only see the files it created there.
- **Leaflet account** (email and password): one identity for the leaderboards
  now and the mobile app later. Forgot your password? Leaflet emails you a code
  to set a new one (up to three times a year).
- **Community:** weekly leaderboards (everyone, or the readers you follow),
  follows, kudos, friendly weekly duels, an inbox, and a public reader card
  with your shelf. Your profile is **private until you make it public**.

## Privacy

Your books never leave your computer except to your own Google Drive, if you
turn backup on. Leaflet's server only ever sees your account, and your profile
if you make it public. It never sees your books, your Google account or your
Drive. Full policy:
<https://itsadithyakv.github.io/Leaflet-BookReader/privacy/>

---

## Known issues in 1.0

- **Backup is for one computer.** Two computers backing up to the same Drive
  mostly agree, but edits made on both at the same moment can overwrite each
  other. Multi-device sync comes with the mobile app.
- **Mixed versions.** A copy of an older pre-release on another computer drops
  highlights, series and collections from the backup when it saves. Update
  every computer to 1.0.
- **PDFs** can't be searched or highlighted yet (text books can), and very
  large PDFs (hundreds of MB) may not open.
- **Links inside books** to websites don't open yet.
- **Accounts** don't verify email addresses yet. Password-reset emails come
  from a Gmail address, so check spam if one doesn't arrive, and there's a
  daily limit of about 100.
- **Duel results** can appear up to a day after the week ends, as they wait
  for the week to end in every time zone.
- **Formats beyond the built-in six** need Calibre installed from
  calibre-ebook.com; the Store version can't install it for you.
- Uninstalling Leaflet removes its library. Back up to Drive first if you want
  it back.

## For the record

| | |
| --- | --- |
| App | Tauri 2 (Rust) + React, WebView2 |
| Package | MSIX, `AdithyaKV.LeafletBookReader`, publisher PaperKite |
| Library database | SQLite, schema version 3 (upgrades older libraries in place, with a backup copy first) |
| API | Node 22 + MongoDB Atlas, `https://leafletapp.duckdns.org` (found through the signed config on GitHub Pages) |
| Tests at release | 254 Rust, 37 app (Vitest), 51 server |
