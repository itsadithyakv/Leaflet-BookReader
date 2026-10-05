import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Book } from "@shared/models/book";
import { useLibraryStore } from "../../store/libraryStore";
import { sessionElapsedMs, useHabitStore } from "../../store/habitStore";
import { annotationService } from "../../services/annotationService";
import { getDateKey } from "../../services/habitService";
import { HIGHLIGHT_COLORS } from "../../readers/highlightColors";
import { AmbiencePanel, useAmbienceState } from "../../ambience";
import { openHighlights, openInBook, useHighlightsStore } from "../highlights/highlightsStore";
import { countLabel } from "../highlights/highlightsView";
import { ReadingCalendar } from "../ReadingCalendar";
import { freeReadsBesides } from "../shelf/rows";
import { UiIcon } from "../UiIcon";
import { AlbumRoomPanel, useAlbumRoom } from "./album";
import { DiaryPanel, useDiaryStatus } from "./diary/DiaryBook";
import {
  SPINE_STORE,
  bookcaseArt,
  currentBook,
  finishedBooks,
  keptColour,
  parseSpines,
  revOf,
  shelfWords,
  shownBooks,
  spineColour,
  withSpine,
  type BookcaseArt,
  type KeptSpines
} from "../../pip/bookSpines";
import type { Offer } from "../../pip/behaviour";
import { noteBooks, noteWords, notesWords, pinnedNotes, type Pinned } from "../../pip/furnish";
import { setHandBook } from "../../pip/furnish-art.js";
import { plantLines, plantNow, plantOf, plantReport, plantWants } from "../../pip/houseplant";
import { calendarArt, calendarLines, calendarWords, clockArt, clockLines, clockTime, clockWords, sessionWords } from "../../pip/roomTime";
import { coverColour } from "./coverColour";

/**
 * What the things in Pip's room show that is the reader's own, and what is in
 * the card each opens (components/pip/furnishings.tsx puts them in the room;
 * the rules are in pip/bookSpines.ts, furnish.ts, roomTime.ts and
 * houseplant.ts): the finished books in her bookcase, the book in her hands,
 * the highlights on her fridge, the month on her calendar, the time and the
 * focus session on her clock, the plant free reading waters, the radio, what
 * she has brought home, her diary. All of it is read from what the app
 * already keeps; only the colour a cover came down to is kept, on this device.
 *
 * `useRoomThings` is the one table: for each thing, how it stands (its
 * label), what its art shows, the card it opens, and what Pip may do with it
 * of her own accord.
 */

const readKept = (): KeptSpines => {
  try {
    return parseSpines(localStorage.getItem(SPINE_STORE));
  } catch {
    return {};
  }
};
const writeKept = (all: KeptSpines) => {
  try {
    if (Object.keys(all).length > 0) localStorage.setItem(SPINE_STORE, JSON.stringify(all));
    else localStorage.removeItem(SPINE_STORE);
  } catch {
    // Worked out again next time.
  }
};

/** Covers are read one after another, and the shelf is drawn again this often while they are (not once a book). */
const SHELF_FLUSH_MS = 400;

export type ShelfData = {
  /** The books the reader has finished, the most recently finished first. */
  finished: Book[];
  kept: KeptSpines;
  /** The bookcase as its art draws it. */
  art: BookcaseArt;
};

/**
 * Her shelf: the reader's finished books and the colour of each spine. The
 * covers of the books on show (and of the book being read, which goes in her
 * hands) are read for their colour once, a few at a time, and kept.
 */
const useShelf = (): ShelfData => {
  const books = useLibraryStore((state) => state.books);
  const finished = useMemo(() => finishedBooks(books), [books]);
  const current = useMemo(() => currentBook(books), [books]);
  const [kept, setKept] = useState<KeptSpines>(readKept);
  const keptRef = useRef(kept);
  const booksRef = useRef(books);
  booksRef.current = books;
  // Covers asked for on this visit that gave no colour (no file here yet, another site's image): not asked again until the next.
  const tried = useRef(new Set<string>());

  // The book in her hands first, then the shelves, top to bottom.
  const wanted = useMemo(() => [...(current ? [current] : []), ...finished.slice(0, shownBooks(finished.length))], [current, finished]);
  const wantedKey = wanted.map((book) => `${book.id}|${book.coverUrl ?? ""}`).join(",");
  useEffect(() => {
    let live = true;
    const name = (book: Book) => `${book.id}|${book.coverUrl}`;
    const list = wanted.filter((book) => book.coverUrl && !keptColour(keptRef.current, book) && !tried.current.has(name(book)));
    if (list.length === 0) return;
    const library = new Set(booksRef.current.map((book) => book.id));
    let shownAt = performance.now();
    const show = () => {
      shownAt = performance.now();
      writeKept(keptRef.current);
      setKept(keptRef.current);
    };
    void (async () => {
      for (const book of list) {
        const colour = await coverColour(book);
        if (!live) return;
        tried.current.add(name(book));
        if (!colour) continue;
        keptRef.current = withSpine(keptRef.current, book, colour, library);
        if (performance.now() - shownAt >= SHELF_FLUSH_MS) show();
      }
      show();
    })();
    return () => {
      live = false;
    };
    // wantedKey stands in for wanted, a new array whenever the library changes at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);

  // The book she reads is the reader's current one, in its cover's colour, the ribbon where the reader is.
  const hand = current ? `${spineColour(kept, current)}|${current.progress}` : "";
  useEffect(() => {
    setHandBook(current ? { cover: spineColour(kept, current), progress: current.progress } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand]);

  return useMemo(() => ({ finished, kept, art: bookcaseArt(finished, kept) }), [finished, kept]);
};

/**
 * The notes on the fridge: the reader's latest highlights. The books that
 * have highlights are known from their counts; the few last open are read for
 * theirs (the annotations hold the character sheets and the words looked up
 * too, which are passed over). Read again when a count changes. None on a
 * floor without a fridge.
 */
const useNotes = (active: boolean): Pinned[] => {
  const books = useLibraryStore((state) => state.books);
  const counts = useHighlightsStore((state) => state.counts);
  const loadCounts = useHighlightsStore((state) => state.loadCounts);
  const [notes, setNotes] = useState<Pinned[]>([]);

  // Highlights may have been made (or come with a sync) since the library last counted them.
  useEffect(() => {
    if (active) void loadCounts();
  }, [active, loadCounts]);

  const asked = useMemo(() => (active ? noteBooks(books, counts) : []), [active, books, counts]);
  const askedKey = asked.map((book) => `${book.id}:${counts[book.id]}`).join(",");
  useEffect(() => {
    if (asked.length === 0) {
      setNotes([]);
      return;
    }
    let live = true;
    void Promise.all(asked.map((book) => annotationService.list(book.id).catch(() => []))).then((lists) => {
      if (live) setNotes(pinnedNotes(lists.flat()));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedKey]);
  return notes;
};

/** The paper each note is drawn on: its highlight's colour. */
const notePaper = (note: Pinned) => (HIGHLIGHT_COLORS[note.color ?? "yellow"] ?? HIGHLIGHT_COLORS.yellow).swatch;

/** The time now, to the minute: told again as each minute begins (and no oftener). */
const useMinute = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const wait = () => {
      timer = window.setTimeout(() => {
        setNow(new Date());
        wait();
      }, 60_000 - (Date.now() % 60_000) + 40);
    };
    wait();
    return () => window.clearTimeout(timer);
  }, []);
  return now;
};

// ---- what the cards hold ------------------------------------------------------------------

/**
 * The bookcase's card: the finished books by title, the most recently
 * finished first. A book with highlights opens them; one without opens the
 * book.
 */
const ShelfList = ({ shelf, onClose }: { shelf: ShelfData; onClose: () => void }) => {
  const counts = useHighlightsStore((state) => state.counts);
  if (shelf.finished.length === 0) {
    return <p className="pip-room-card-empty">No finished books yet. Finish one and its spine stands here, in its cover's colour.</p>;
  }
  return (
    <ol className="pip-shelf-list">
      {shelf.finished.map((book) => {
        const count = counts[book.id] ?? 0;
        return (
          <li key={book.id}>
            <button
              type="button"
              className="pip-shelf-row"
              onClick={() => {
                onClose();
                if (count > 0) openHighlights(book.id);
                else openInBook(book.id);
              }}
              aria-label={`${book.title}${book.author ? `, by ${book.author}` : ""}. ${count > 0 ? `Open its ${countLabel(count, "highlight")}.` : "Open the book."}`}
            >
              <span className="pip-shelf-spine" style={{ background: spineColour(shelf.kept, book) }} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="pip-shelf-title">{book.title}</span>
                {book.author && <span className="pip-shelf-author">{book.author}</span>}
              </span>
              <span className="pip-shelf-does" aria-hidden="true">
                <UiIcon name={count > 0 ? "highlight" : "book-open"} size={13} />
                {count > 0 ? count : "Open"}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
};

/** The fridge notes' card: each highlight's words, its book and chapter, and a way to it in the book. */
const NotesList = ({ notes, onClose }: { notes: Pinned[]; onClose: () => void }) => {
  const books = useLibraryStore((state) => state.books);
  return (
    <ul className="pip-notes-list">
      {notes.map((note) => {
        const book = books.find((entry) => entry.id === note.bookId);
        const from = [book?.title, note.chapter].filter(Boolean).join(" · ");
        return (
          <li key={note.id} className="pip-note" style={{ ["--note-paper" as string]: notePaper(note) }}>
            <blockquote className="pip-note-words">{noteWords(note.text)}</blockquote>
            <div className="pip-note-foot">
              <span className="pip-note-from">{from || "A book no longer in the library"}</span>
              {book && (
                <button
                  type="button"
                  className="pip-note-open"
                  onClick={() => {
                    onClose();
                    openInBook(note.bookId, note.cfi);
                  }}
                  aria-label={`Open in book: ${book.title}`}
                >
                  <UiIcon name="book-open" size={13} />
                  Open in book
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

/** A card of a few plain lines: the first said large. */
const Lines = ({ lead, lines }: { lead: string; lines: readonly string[] }) => (
  <div className="pip-room-lines">
    <p className="pip-room-lead">{lead}</p>
    {lines.map((line) => (
      <p key={line}>{line}</p>
    ))}
  </div>
);

// ---- the table ----------------------------------------------------------------------------

/** One of the room's things, as it is now. */
export type RoomView = {
  /** How it stands, for its label: "7 finished books", "playing rain". */
  now: string;
  /** What its art shows (handed to the fixture's draw), and a short name for that: the art is drawn again only when it changes. */
  data?: unknown;
  rev?: string;
  card: { title: string; note?: string; size?: "narrow" | "wide"; body: (close: () => void) => ReactNode };
  /** What Pip may do with it of her own accord (pip/behaviour.ts, `Offer`). */
  offer?: Offer;
};

export type RoomThings = {
  /** By the thing's name among the fixtures (pip/furnish.ts, `THING_NAMES`); a thing with nothing to show is not in it. */
  views: Record<string, RoomView>;
  /** What the fridge's door shows: the paper of each note pinned to it. */
  fridge: { data: { notes: string[] }; rev: string };
};

/** The room's things on this floor. `fridge`: the floor has one (the notes are read only then). */
export const useRoomThings = (fridge: boolean): RoomThings => {
  const shelf = useShelf();
  const notes = useNotes(fridge);
  const now = useMinute();
  const days = useHabitStore((state) => state.snapshot.days);
  const goalMinutes = useHabitStore((state) => state.snapshot.goalMinutes);
  const freeReads = useHabitStore((state) => state.snapshot.freeReads);
  const running = useHabitStore((state) => state.activeSession);
  const radio = useAmbienceState();
  const album = useAlbumRoom();
  const diary = useDiaryStatus();

  return useMemo(() => {
    const views: Record<string, RoomView> = {};
    const count = shelf.finished.length;

    const cased = { ...shelf.art, diary: { today: diary.data.today } };
    views.bookcase = {
      now: shelfWords(count),
      data: cased,
      rev: revOf(cased),
      card: { title: "Your finished books", note: count > 1 ? "The most recently finished first." : undefined, body: (close) => <ShelfList shelf={shelf} onClose={close} /> },
      offer: {
        label: "admiring her books",
        move: "gaze",
        seconds: 4,
        lines: count === 0 ? ["so much room for books.", "an empty shelf. imagine it full."] : count === 1 ? ["one book. we read that.", "the first of many."] : [`${count} books. we read all of these.`, "which one was your favourite?"]
      }
    };

    if (notes.length > 0) {
      views.fridgenotes = {
        now: notesWords(notes.length),
        card: { title: "On the fridge", note: notes.length === 1 ? "Your latest highlight." : "Your latest highlights.", body: (close) => <NotesList notes={notes} onClose={close} /> }
      };
    }

    const month = calendarArt(days, now);
    views.calendar = {
      now: calendarWords(month, now),
      data: month,
      rev: revOf(month),
      card: {
        title: "Reading calendar",
        note: calendarWords(month, now),
        size: "wide",
        body: () => <ReadingCalendar days={days} goalMinutes={goalMinutes} freeReads={freeReads} />
      },
      offer: { label: "looking at the calendar", move: "pointup", seconds: 3, lines: calendarLines(month) }
    };

    const face = clockArt(now, running ? { durationMinutes: running.durationMinutes, elapsedMs: sessionElapsedMs(running, now.getTime()) } : null);
    views.wallclock = {
      now: clockWords(now, face.left),
      data: face,
      rev: revOf(face),
      card: {
        title: "The time",
        body: () => <Lines lead={clockTime(now)} lines={[face.left === null ? "No focus session is running. While one is, the clock shows how long it has left." : `${sessionWords(face.left)?.replace(/^./, (first) => first.toUpperCase())}.`]} />
      },
      offer: { label: "squinting at the clock", move: "squint", seconds: 2.5, lines: clockLines(now, face.left) }
    };

    // What a running session has read is not free reading (as on the shelf and the calendar).
    const plant = plantOf(freeReadsBesides(freeReads, running ? { startedAt: running.startedAt, minutes: sessionElapsedMs(running, now.getTime()) / 60000 } : null, now), getDateKey(now));
    const potted = { state: plant.state, leaves: plant.leaves, flowers: plant.flowers };
    const [how, ...rest] = plantReport(plant);
    views.plantpot = {
      now: `${plantNow(plant)}. ${plantWants(plant)}`.replace(/\.$/, ""),
      data: potted,
      rev: revOf(potted),
      card: { title: "The houseplant", body: () => <Lines lead={how} lines={rest} /> },
      offer: { label: "talking to the plant", move: "look", seconds: 3, lines: plantLines(plant) }
    };

    const tuned = { on: radio.on || radio.listening, playing: radio.playing };
    views.radio = {
      now: radio.playing ? `playing ${radio.sceneName.toLowerCase()}` : radio.on ? `on (${radio.sceneName.toLowerCase()}), waiting for a book to be opened` : "off",
      data: tuned,
      rev: revOf(tuned),
      card: { title: "Radio", note: "Sound behind the page while you read.", body: () => <AmbiencePanel /> },
      offer: radio.playing
        ? { label: "nodding along to the radio", move: "bop", seconds: 4, lines: ["ooh. i like this one.", `${radio.sceneName.toLowerCase()}. good choice.`] }
        : { label: "fiddling with the radio", move: "tap", seconds: 3, use: "dial", lines: ["nothing on. you choose.", "what shall we listen to?"] }
    };

    const pinned = { finds: album.finds };
    views.corkboard = {
      now: album.status,
      data: pinned,
      rev: revOf(pinned),
      card: { title: "Album", note: `What Pip has brought home: ${album.status}.`, size: "wide", body: (close) => <AlbumRoomPanel onClose={close} /> },
      offer: { label: "looking at her finds", move: "pointup", seconds: 3, lines: album.finds.length === 0 ? ["nothing pinned up yet. soon.", "room for three. i'll find them."] : ["look at everything i found.", "that one's my favourite. no, that one."] }
    };

    views.diary = {
      now: diary.status,
      card: { title: "Pip's diary", note: `A line a day: ${diary.status}.`, size: "wide", body: (close) => <DiaryPanel onClose={close} /> }
    };

    const papers = notes.map(notePaper);
    return { views, fridge: { data: { notes: papers }, rev: papers.join("") } };
    // `shelf`, `radio` and `album` are new objects only when what they say changes; `now` once a minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelf, notes, now, days, goalMinutes, freeReads, running, radio, album, diary.status, diary.data.today]);
};
