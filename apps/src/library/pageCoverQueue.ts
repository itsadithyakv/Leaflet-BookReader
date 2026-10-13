import type { Book } from "@shared/models/book";
import { getBookExtension } from "../constants/bookFormats";

/**
 * Which PDFs are owed a cover made from their own first page, without being
 * opened (hooks/usePageCovers.ts makes them, one at a time).
 *
 * A PDF with no cover took its first page for one only when it was opened
 * (readers/pageCover.ts), so a PDF added and not yet read stood in the library
 * as "No cover yet", however long the library was looked at. The rule is the
 * reader's: only after a lookup has had its turn at finding the real cover.
 *
 * Pure: the storage and the drawing are the hook's.
 */

/** Where the books already tried are kept: `{ [bookId]: when, in ms }`. */
export const TRIED_KEY = "leaflet.pageCoverTried";
/** A book whose first pages gave no cover (blank, unreadable) is tried again after this long. */
export const RETRY_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * A PDF larger than this is not read in the background for a cover: the whole
 * file is held in memory to draw one page. It takes its cover when it is
 * opened, as before, when the file is in memory anyway.
 */
export const MAX_BACKGROUND_BYTES = 200 * 1024 * 1024;

export type Tried = Record<string, number>;

/** What was read from storage, as a tried list: anything else is an empty one. */
export const readTried = (stored: string | null): Tried => {
  if (!stored) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    );
  } catch {
    return {};
  }
};

/** The list with `id` tried at `now`, and without books no longer in the library. */
export const withTried = (tried: Tried, id: string, now: number, books: Array<Pick<Book, "id">>): Tried => {
  const here = new Set(books.map((book) => book.id));
  const kept = Object.fromEntries(Object.entries(tried).filter(([bookId]) => here.has(bookId)));
  return { ...kept, [id]: now };
};

/**
 * The PDFs to make a cover for now, in library order: with no cover, on this
 * device, looked up (this run, or stamped by an earlier one), not tried
 * lately, and not the book being read (its reader makes its own).
 */
export const duePageCovers = (
  books: Book[],
  lookupTried: Record<string, true>,
  tried: Tried,
  now: number,
  readingId: string | null = null
): Book[] =>
  books.filter((book) => {
    if (book.coverUrl || book.available === false || book.id === readingId) {
      return false;
    }
    if (getBookExtension(book.localPath) !== "pdf") {
      return false;
    }
    if (!lookupTried[book.id] && !book.metadataCheckedAt) {
      return false;
    }
    const last = tried[book.id];
    // A clock set back does not keep a book waiting for ever.
    return last === undefined || Math.abs(now - last) >= RETRY_AFTER_MS;
  });
