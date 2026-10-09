# Testing

## What exists

**254 Rust unit tests**, run with `cargo test` from `apps/src-tauri`. Every test
is colocated in a `#[cfg(test)] mod tests` beside the code it covers. The table
below is the original core; the Pip economy (`pip`, `habit::seeds`), reminders,
the metadata matcher, EPUB package reading (`storage::epub`) and database
upgrades have their own tests beside them too.

| Module | Tests | Covers |
| --- | --- | --- |
| `sync` | 49 | Merge rules, convergence, tombstones, OAuth callback parsing, Drive wire types, credential resolution, two-device folder round trips |
| `convert` | 26 | The built-in TXT / HTML / FB2 → EPUB converters and the EPUB writer |
| `habit` | 15 | The streak walk: grace before freeze, multi-day gaps, the freeze cap, burn counts, day rollover |
| `storage` | 13 | Hashing, path derivation, cover MIME sniffing, EPUB metadata extraction |
| `db` | 12 | Schema migration preserving existing rows, the ledger, the shelf, tombstoning |
| `formats` | 10 | The format table and delivery routing |
| `comic` | 7 | CBZ page listing and natural ordering |

```bash
cd apps && npm run typecheck && npm test && npm run build
cd apps/src-tauri && cargo test
cd server && npm test        # needs MongoDB; TEST_MONGO_URI, default localhost
```

**Vitest** runs the frontend's pure logic (`npm test` in `apps`): reading
progress weighted by section size (`readers/progress.ts`), the shared
"finished" rule, the highlights' Markdown export, and series detection and the
smart shelves (`library/series.test.ts`). Test files sit beside the code as `*.test.ts`.

**CI** (`.github/workflows/ci.yml`) runs all of it on every push and pull
request: the Pip price catalogue check, the type-check, the unit tests, the
production build and `cargo test` on Windows, and the server's API tests
against a MongoDB service. `npm run build` type-checks before building, and the
Tauri build runs it, so a type error cannot reach a release.

## The approach

Logic that can be pure, is pure — and that is where the tests are.

**`habit::evaluate`** takes the ledger and today's date as arguments rather than
reading a clock or a database, so streak rules are tested directly with no
fixtures. **`sync::merge`** is the same: two documents in, one out, no I/O.

The merge is tested for *properties*, not just cases:

- **Commutative** — `merge(a, b) == merge(b, a)`
- **Idempotent** — `merge(a, merge(a, b)) == merge(a, b)`
- **Three-device convergence** — any order of pairwise merges agrees

Alongside those, the specific defects that motivated the rewrite each have a
named regression test: a deletion reaching the other device, opening a book not
rewinding progress, machine-local paths staying out of the document, timestamps
compared as instants rather than strings.

The folder transport is tested **end to end** — two in-memory databases against
one scratch directory, exercising publish, receive, read-on, deletion propagation,
ledger sync, repeat syncs not inflating minutes, a corrupt `state.json` being
survivable, and the lock refusing a second writer.

## What is not tested

**Most of the frontend is untested.** Vitest is in place but covers only the
pure helpers above; no components or stores. The frontend is the larger half of
the app, so this is the biggest remaining gap.

Highest-value things to cover next:

- `sync/merge`'s TypeScript counterparts — the store reducers in `libraryStore`
  and `habitStore`
- `smartReadService`'s pure scoring functions (`estimateWordDifficulty`,
  `estimateRsvpPauseMultiplier`, `getAdaptiveWpm`)
- `constants/bookFormats` staying in step with `formats/mod.rs`

**Real books.** The readers were built on made-up fixtures and one real
novel, and that novel happens to mark its headings, centring and scene breaks
in the one way the reader already handled; a pass over nineteen real files
found faults in nearly every other book. Real books are not in the
repository. Copies for the preview go under
`apps/node_modules/.leaflet-test/library/` (git-ignored, served by the dev
server), and each fault found is pinned by a test on a small made-up sample
of the markup, never the book's own text (`bookBlocks.test.ts`,
`autoContents.test.ts`, `ncx.test.ts`, `innerBooks.test.ts`,
`chapterSpan.test.ts`, `normalize.rs`). The import rules can be run over a
folder of real files with an ignored test that only reads and skips where the
folder is absent: `cargo test --lib real_library -- --ignored --nocapture`.
When a new kind of book misbehaves, look inside the file first (its OPF, its
contents in both forms, a chapter's markup, its stylesheet).

**Drive sync has never run against Google.** Everything beneath the transport is
covered and the folder transport is verified end to end, but no test touches the
real API — that needs an OAuth client tied to a Google account.

## Verifying UI

With no component tests, UI changes are checked in a browser against the dev
server (`npm --prefix ./apps run dev`, port 1421).

The routine that has caught the most:

1. **Four viewports**: 390×844 and 360×640 portrait, 844×390 and 667×375
   landscape, plus 1440×900 as a desktop regression check. The landscape sizes
   matter because they are *wider* than the `md` breakpoint.
2. **Programmatic checks rather than eyeballing.** Walking the DOM for elements
   whose right edge exceeds the viewport catches overflow that a screenshot
   hides; measuring every interactive element's box catches touch targets under
   44 px. Both have found real bugs that looked fine in a screenshot.
3. **Both themes**, since per-theme rules drift apart.

**The text reader in the browser.** The preview has no library, so a book is
put there by hand: copy an EPUB somewhere the dev server serves (a folder under
`apps/node_modules/` is ignored by git), import the running
`/src/store/libraryStore.ts` module from the page (use the URL the page loaded
it by, from `performance.getEntriesByType("resource")`; a bare import makes a
second copy of the store) and `setState({ books: [...] })` with a book whose
`localPath` is that file's URL. The reader publishes its epub.js rendition as
`window.__leafletRendition` in development, for reading its state, and
`window.__leafletReader` (`words()`, `active()`, `paceScale()`) for Smart Read
and SpeedRead's.

**They went on 2026-10-08**, when the release run sheet's `npm ci` cleaned
`node_modules`: every harness and fixture named below, and the copies of the
owner's books. Only `mistborn.epub` has been put back (2026-10-09). The next
session that needs them should keep them somewhere `npm ci` does not reach
(a git-ignored folder beside `apps`, served to the preview by a Vite alias).

Aids kept out of git in `apps/node_modules/.leaflet-test/` (they go when
`node_modules` is cleaned; none is needed to build): `boot.txt` loads the
harnesses; `__bootBook('fixture' | 'mistborn', prefs, bookPrefs)` opens a
book; `fixture.epub` has drop caps, every kind of note reference, pictures and
eight sections; `rsvp-run.txt`, `rsvp-geometry.txt` and `rsvp-holds.txt` re-run
the SpeedRead measurements; `people-harness.txt` seeds a character sheet;
`long.pdf`, `scanbook.pdf` and `dropcaps.pdf` (each with its generator) are
for the page reader. For Pip: `life-harness.txt` (`__life.boot(hour)`, `act`,
`reduced`, `count`), `room-harness.txt`, `memory-boot.js`, `trail-boot.js`,
`visit-test.html` (a page that does not reload under the test; `window.__vt`
mounts `VisitorPip` with a clock that can be stopped; in the app,
`window.__pipVisitors.stub()`), `sound-bench.txt` and `sound-measure.txt`
(`__soundTen()`, `__soundLong(ids, seconds, seeds)`). The house's dev hook
(`__pipHouse`) has `world(patch)`, `choose(id)`, `plan()`, `night("peek")`,
`visitor(type)` and `state()` fields `away`, `holding`, `welcomed`, `pace`,
`peeking`; its loop does not run in a hidden pane, step it with `advance`.

The radio is measured, not heard: `sound-measure.txt` renders each scene
offline and reports level, peak, spectrum and steadiness. The preview pane is
hidden and unfocused, so the radio rests there after 2 s unless
`document.visibilityState` and `hasFocus` are overridden; with them overridden
it plays through the speakers, so store a volume of 0.05 first.

`http://localhost:1421/desktop-pip.html` runs desktop Pip's page against a
stand-in host; `window.__desktopPip.log` is every call it made and
`.tell(event)` plays an event from Rust. In a hidden pane her 12 fps ticker is
paused: override `document.hidden` and dispatch `visibilitychange` first.

In a hidden pane the reader does not run at all without help: epub.js queues
its work on `requestAnimationFrame`, which never fires there, and no scroll
events are sent either. Replace `requestAnimationFrame` with a timer before
opening the book, and dispatch `scroll` on the scrolling container
(`rendition.manager.container`) after setting its position. Check places and
sizes by measuring; transitions sit at their first frame.

One caveat worth knowing when measuring animation: if the browser pane is
hidden, the document timeline is frozen, so a CSS transition sits pinned at its
start value and a transform will look like it is not applying at all. Bypass the
transition (`el.style.transition = "none"`) before measuring geometry.

**The name card and the notes, in the preview.** Two more harnesses in
`.leaflet-test/`: `peek-harness.txt` (`__hoverWord("Vin")` rests the pointer
on a word, `__peek()` reads the card, `__bootAny({...})` opens any book of
the test library) and `notes-harness.txt` (`__selectFrom`, `__noteCard()`,
`__notesPanel()`). A pointer's move needs a new place on the screen each time
(`screenX`/`screenY`), or it is taken for the page moving under a still
pointer. After editing a module that is not a component, load the page
afresh: a book left open went on running the old code, and a rule that was
already fixed looked broken. Asking a wiki from the preview goes straight to
fandom.com (the app goes through Rust); it sends the test book's series name.

**Checking a move of the text reader's code.** The reader has no component
tests, so a change that should change nothing (the split of `ReaderView.tsx`
into `readers/text/`, 2026-10-05) is checked by walking the same book the same
way before and after, and comparing every number. Two walks are kept with the
other aids in `apps/node_modules/.leaflet-test/`:

- `split-measure.txt`: Mistborn in both layouts (`__split.run(stage, tag)`,
  stages `scrollA` to `scrollE` and `pagesA` to `pagesC`): opening, scrolling
  across chapter ends, the keys, back and forward, Smart Read, reopening at
  the saved line, opening at 40%, and what is saved on leaving. 48 readings.
- `split-more.txt`: what that does not touch (`__more.run(stage, tag)`,
  stages `moreA` to `moreF`): the chapter list, the shortcuts sheet, a
  bookmark, search, type size, page colour, scrolling to pages, auto-scroll,
  SpeedRead, a footnote and a picture in the fixture book, a selection and a
  highlight. 58 readings.

`__split.diff(a, b)` and `__more.diff(a, b)` list what differs between two
tagged runs. The readings are kept in `localStorage` under `splitmeasure.`,
so they outlive a reload (and should be removed when done). Compared like
with like, two runs of the same code agree on every reading. What "like with
like" took to learn:

- **The same page history.** A chapter measures a pixel taller at the end of
  a long session than on a page just loaded (16223 against 16222 for
  Mistborn's chapter 14). Load the page afresh before each side's run.
- **The same stored state.** The preview keeps bookmarks, the learned pace
  and the last auto-scroll speed in `localStorage`, so one run moves where
  the next starts. `__base.keep()` once; `__base.restore()` and a reload
  before each side.
- **The same display scale.** `devicePixelRatio` went from 1.5 to 1 under a
  run (the machine had slept) and every box moved by a pixel. Read it with
  each run.
- **Not beside a timer.** The toolbar hides 2.6 s after its menu shuts; a
  reading taken 2.55 s after came out both ways. How far Smart Read has got
  after a timed second is a count by the clock, and varies by a word or two
  between runs of the same code.
- **One stage a call** when a call nears 45 s: one that times out carries on
  in the page, and the next runs on top of it.

To find a read of the scope made too early (see features.md, "Where its own
code lives"), wrap `reader` in a `Proxy` in `ReaderView.tsx` for the length of
a test, noting any string key read that is not yet in the object. Over about a
thousand renders of both walks there were none.
