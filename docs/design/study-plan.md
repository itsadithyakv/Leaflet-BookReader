# Study cards (1.5.14)

The owner: "Allow a bit for studying too. Like if someone wants to study using
their app things like anatomy etc." Leaflet already had one kind of spaced
review, the word quiz (words looked up, in boxes that rest 0, 1, 3, 7, 14
and 30 days). Study cards are the same idea for what a reader highlights and
for the pictures in a textbook.

## What

Three kinds of card, all made from the book, never typed from nothing:

| Kind | Made from | Review shows | Then |
|---|---|---|---|
| **Fill in** | a highlight | the passage with the words the reader tapped hidden | reveal, right or wrong |
| **Question** | a highlight | the question the reader wrote | reveal the highlight (or its note), right or wrong |
| **Picture** | a picture in an EPUB, or a page of a PDF | the picture with one box covered and marked, the rest as drawn | reveal, right or wrong |

One picture with five labels boxed is five cards (one a box), kept together as
a group so they can be edited together.

Every card keeps its book and its place (the highlight's CFI, the PDF page),
so review can open the spot in the book.

## Where

- **Making, in the reader, only when asked.** "Make a card" is in the
  highlight card (a tapped highlight) and in the selection bar (it highlights
  the selection first, in the last colour). It opens a sheet with the two
  kinds, Fill in and Question. In the picture viewer (EPUB) "Make a card"
  turns the picture into a canvas to draw boxes on; pinch, the wheel and two
  fingers still zoom and pan. A PDF has no picture viewer (its pages zoom
  themselves), so its More menu has "Make a picture card", which does the
  same over the page being read. None of this is loaded, or listened for,
  until the button is pressed: nothing on the page's hot paths.
- **Revising, from the Library.** The "Revise words" key becomes "Revise",
  counting what is due across words and cards ("Revise · 12 due"). Its
  overlay (Pip's pixel paper, as the word quiz) chooses: All, Words, or Cards
  (all books, or one). Words alone is the word quiz as it was; All and Cards
  are a round of up to 20, the due ones first, Pip asking.
- **A book's cards.** From the book's menu ("Study cards") and the
  Highlights view of the book ("Cards"): the cards made from that book, the
  due count, edit, delete (with Undo, as words), revise just this book, and
  export.
- **Hints** are behind an (i) or a tooltip. No standing explanations.

## Data

Cards are rows of the annotations table under a kind of their own, `card`, as
the character sheets and the words are (`commands/people.rs` says why): they
are in the backup and both syncs with no new rule, copies merge row by row
(the newest `updatedAt` wins, a removal is a tombstone kept 90 days), and an
older build carries the rows along untouched (its reader lists only bookmarks
and highlights). No new table, no new field in the sync document.

A row: `id` `card:<uuid>`, `book_id`, `kind` `card`, `cfi` (the place),
`chapter`, `note` (a question card's question), and `text`, a small JSON object:

| Key | What |
|---|---|
| `t` | `fill`, `ask` or `pic` |
| `h` | the highlight it was made from (fill, ask), so the highlight can say it has a card |
| `s` | fill: the passage; ask: the answer (the highlight's words, or its note) |
| `x` | fill: the hidden words, as `[start, end]` character ranges of `s` |
| `i` | pic: the picture: `epub:<path in the archive>` or `pdf:<page>` |
| `m` | pic: the covered box, `[left, top, width, height]` in ten-thousandths of the picture |
| `r` | pic, PDF: the part of the page shown, likewise |
| `a` | pic: what is under the box, if the reader typed it (for the text export) |
| `g` | pic: the group (the cards of one picture) |
| `p` | how far through the book, 0..1 |
| `b`, `d` | the review's box (0..5) and the day it is next due, as for words |

**Limits.** A passage or an answer is kept to its first 600 characters, a
question to 300, a label to 120; the JSON is refused over 3,000 bytes (it is
never clipped). A picture group is at most 40 boxes. A typical card is 300 to
500 bytes, about 150 gzipped: 1,000 cards add some 150 KB to the account's
copy, against its 2 MB (the app warns from 1.6 MB). No picture data is ever
in a row.

A card has its own copy of its passage rather than pointing at the highlight:
a reader tidying away highlights must not empty their cards, and a removed
highlight's tombstone keeps no words (sync audit D2).

## Pictures: by reference, not a copy

**Decided: a reference.** A book's id is its file's SHA-256, so the same book
on another device has the same id and the same bytes, and a path inside it
or a page of it means the same picture there.

- **EPUB:** the image's path inside the archive (epub.js's archive keeps the
  path of each picture it hands the page; `readers/pictures.ts` reads it
  back). Review asks the backend for that one file (`book_picture`, which
  unzips only it, capped at 20 MB, images only), not the whole book.
- **PDF:** the page and the part of it shown. Review draws the page with
  pdf.js and cuts that part out; the boxes are fractions of the page, so the
  zoom does not matter. The part shown is the boxes' bounds with a margin.

Why not a copy: a copy is 50 to 300 KB a picture. Kept in the row it would
fill the account's 2 MB with a few dozen diagrams; kept beside it, it would
need a new place in both syncs and in the backup. The reference is a few
dozen bytes and is exactly as reliable as the book being there, which is
also what "open the spot in the book" needs.

**The book not on this device** (not in the library, or its file not
downloaded): the card shows a placeholder with the box's label if it has one,
and can still be answered, edited and removed.

## Sync and the server

Nothing new in the document: cards ride the `annotations` array. The server
keeps the document as an opaque gzip (`server/src/routes/state.js` checks only
its size), so **no server change and no deploy** are needed. Drive and the
folder carry the same document.

## Export

A book's cards as CSV: `front,back,book,place`, quoted as RFC 4180, with a
byte order mark so spreadsheets read it as UTF-8. Anki, Quizlet and
RemNote import two columns plus tags. A fill-in card's front has the hidden
words as `[...]`; a picture card exports its text only (the picture and box
number on the front, the label on the back).

## Not now

Typed answers, cloze across several highlights, decks that are not books,
sharing cards, card statistics, a daily reminder.
