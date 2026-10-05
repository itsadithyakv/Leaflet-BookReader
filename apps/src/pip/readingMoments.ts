/**
 * What Pip knows about the reader's books, worked out from the library: the
 * book last opened and its mood (pip/genre.ts), a book finished in the last
 * day (the hangover), a book begun and left a fortnight (the one she dusts),
 * and where the reader last stopped (mid-chapter? she has a word about that).
 *
 * Everything is derived from the books as they are, except the stop: a book
 * does not remember how far through a chapter it was closed, so the reader
 * leaves one small record on closing (`leaflet.pip.lastStop`, this device
 * only, never synced, cleared by Delete All Data).
 *
 * All for show: none of it touches mood, seeds or the shop.
 */
import type { Book } from "@shared/models/book";
import { isFinished } from "../constants/books";
import { genreMood } from "./genre";
import type { Rand, World } from "./behaviour";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** A book finished this recently leaves her flat on the floor now and then. */
export const HANGOVER_MS = DAY_MS;
/** A book begun and not opened for this many days gathers dust. */
export const DUSTY_DAYS = 14;
/** "Begun": past the first pages, as a share of the book. */
export const STARTED_AT = 0.03;

const instant = (stamp: string | null | undefined) => {
  const at = stamp ? Date.parse(stamp) : NaN;
  return Number.isFinite(at) ? at : null;
};
const openedAt = (book: Book) => instant(book.lastOpened);
/**
 * When a finished book was finished, as near as the library knows: when its
 * progress last really moved (`progressUpdatedAt`, which merely opening a
 * book does not touch). Only a book with no such stamp falls back on when it
 * was last opened.
 */
const finishedAt = (book: Book) => instant(book.progressUpdatedAt) ?? openedAt(book);
const newestOpened = (books: readonly Book[]) =>
  books.reduce<Book | null>((best, book) => (openedAt(book) !== null && (best === null || (openedAt(book) as number) > (openedAt(best) as number)) ? book : best), null);

/**
 * The part of Pip's world that comes from the books. "Finished within a day"
 * is a finished book whose progress last moved within a day: opening an old
 * finished book for a look does not bring the hangover back. (Reading on in
 * one, so that its place moves, does: the library keeps no time of finishing
 * apart from that.)
 */
export const worldOfBooks = (books: readonly Book[], now: number): Pick<World, "book" | "hangover" | "dusty"> => {
  const last = newestOpened(books);
  const since = (book: Book) => now - (openedAt(book) as number);
  const done = books
    .filter((book) => isFinished(book.progress) && finishedAt(book) !== null)
    .map((book) => ({ book, ago: now - (finishedAt(book) as number) }))
    .filter(({ ago }) => ago >= 0 && ago < HANGOVER_MS)
    .sort((a, b) => a.ago - b.ago);
  const finished = done.length > 0 ? done[0].book : null;
  // At most one: the one most recently put down.
  const left = newestOpened(books.filter((book) => (book.progress ?? 0) >= STARTED_AT && !isFinished(book.progress) && openedAt(book) !== null && since(book) >= DUSTY_DAYS * DAY_MS));
  return {
    book: last ? { title: last.title, mood: genreMood(last.genres), readAgoMin: Math.max(0, since(last) / MINUTE_MS) } : null,
    hangover: finished ? { title: finished.title } : null,
    dusty: left ? { title: left.title, days: Math.floor(since(left) / DAY_MS) } : null
  };
};

// ---- stopped mid-chapter ------------------------------------------------------------

/** Where the reader's last stop is kept (this device only). */
export const LAST_STOP_KEY = "leaflet.pip.lastStop";
/** She remarks on a stop only this soon after it. */
export const STOP_FRESH_MS = 60 * MINUTE_MS;
/** "Really reading": the book was open at least this long. */
export const REALLY_READ_MS = 3 * MINUTE_MS;
/** The middle of a chapter: past its opening, and not near its end. */
export const MID_FROM = 0.12;
export const MID_TO = 0.85;

/** The reader closed a book: which, when (epoch ms), how far through the chapter (0..1), how long it had been open, and whether Pip has remarked on it. */
export type Stop = { book: string; at: number; through: number; readMs: number; said?: boolean };

/**
 * How far through its chapter a place is, 0 to 1, by the size of the chapter's
 * sections (a chapter may run over several files). `bytes`: each section's
 * size; `starts`: the sections the contents' entries open; `last`: the last
 * section of the story. Null where there is nothing to measure.
 */
export const chapterThrough = (bytes: readonly number[], starts: readonly number[], section: number, within: number, last = bytes.length - 1): number | null => {
  if (section < 0 || section >= bytes.length) return null;
  // With no contents to go by, each section is its own chapter.
  let from = section;
  let to = section;
  if (starts.length > 0) {
    const before = starts.filter((start) => start <= section);
    const after = starts.filter((start) => start > section);
    from = before.length > 0 ? Math.max(...before) : 0;
    to = after.length > 0 ? Math.min(...after) - 1 : Math.max(section, last);
  }
  let total = 0;
  let read = 0;
  for (let index = from; index <= to; index += 1) {
    const size = bytes[index] ?? 0;
    total += size;
    if (index < section) read += size;
    else if (index === section) read += size * Math.min(1, Math.max(0, within));
  }
  return total > 0 ? Math.min(1, Math.max(0, read / total)) : null;
};

export const parseStop = (raw: string | null): Stop | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Stop> | null;
    if (!value || typeof value.book !== "string" || !Number.isFinite(value.at) || !Number.isFinite(value.through) || !Number.isFinite(value.readMs)) return null;
    return { book: value.book, at: value.at as number, through: value.through as number, readMs: value.readMs as number, ...(value.said ? { said: true } : {}) };
  } catch {
    return null;
  }
};

/** Whether a stop was in the middle of a chapter, after really reading. */
export const midChapter = (stop: Stop) => stop.readMs >= REALLY_READ_MS && stop.through >= MID_FROM && stop.through <= MID_TO;

const STOP_LINES = ["you stopped *there*?", "mid-chapter? you monster.", "wait. what happens next?", "you left it *there*? i need to know.", "in the middle of a chapter. bold."];

/** What she says about the last stop on the next visit, if anything: once, within the hour, and only for a stop mid-chapter. */
export const stopRemark = (stop: Stop | null, now: number, rand: Rand): string | null => {
  if (!stop || stop.said || !midChapter(stop)) return null;
  if (now < stop.at || now - stop.at > STOP_FRESH_MS) return null;
  return STOP_LINES[Math.min(STOP_LINES.length - 1, Math.floor(rand() * STOP_LINES.length))];
};

// The reader's side of it (pages/ReaderView.tsx): where the reading line is,
// as the book moves, and one record as the book closes.

let reading: { book: string; through: number | null } | null = null;

/** The reader's place in its chapter, as it changes (null: not known, or not in the story). */
export const noteReadingPlace = (book: string, through: number | null) => {
  reading = { book, through };
};

const store = (): Storage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/** The book is closing after being read: leaves the stop for Pip. A look that was not reading leaves the last stop as it was. */
export const recordStop = (book: string, openedAtMs: number, now = Date.now(), storage: Pick<Storage, "setItem"> | null = store()) => {
  const place = reading;
  reading = null;
  if (!place || place.book !== book || place.through === null) return;
  const stop: Stop = { book, at: now, through: Number(place.through.toFixed(3)), readMs: Math.max(0, now - openedAtMs) };
  try {
    storage?.setItem(LAST_STOP_KEY, JSON.stringify(stop));
  } catch {
    // Nowhere to leave it: she says nothing this time.
  }
};

export const readStop = (storage: Pick<Storage, "getItem"> | null = store()): Stop | null => {
  try {
    return parseStop(storage?.getItem(LAST_STOP_KEY) ?? null);
  } catch {
    return null;
  }
};

/** She has had her word about this stop: never twice. */
export const markStopSaid = (stop: Stop, storage: Pick<Storage, "setItem"> | null = store()) => {
  try {
    storage?.setItem(LAST_STOP_KEY, JSON.stringify({ ...stop, said: true }));
  } catch {
    // Said for this visit, at least.
  }
};
