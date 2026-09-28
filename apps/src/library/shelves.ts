import type { Book } from "@shared/models/book";
import { isFinished } from "../constants/books";
import { authorKey, titleKeys, type LibrarySeries } from "./series";

/**
 * Smart shelves: collections that fill themselves from how the library is
 * being read. Worked out on the spot, never stored, so they are always right.
 */
export type ShelfId = "reading" | "up-next" | "not-started" | "recent" | "paused" | "finished" | "duplicates";

export type Shelf = {
  id: ShelfId;
  name: string;
  /** One line under the name. */
  description: string;
  books: Book[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Added this recently, a book is "new". */
export const RECENT_DAYS = 30;
/** Started but untouched this long, a book is "paused". */
export const PAUSED_DAYS = 30;

const time = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};
const newestOpened = (a: Book, b: Book) => time(b.lastOpened) - time(a.lastOpened);
const newestAdded = (a: Book, b: Book) => time(b.createdAt) - time(a.createdAt);
const started = (book: Book) => (book.progress ?? 0) > 0 && !isFinished(book.progress);

/**
 * Books that look like the same book twice: one title and author, different
 * files (an EPUB and a PDF, or two editions). Grouped together, largest group
 * first.
 */
export const findDuplicates = (books: Book[]): Book[][] => {
  const groups = new Map<string, Book[]>();
  for (const book of books) {
    const title = titleKeys(book.title)[0];
    if (!title) {
      continue;
    }
    const key = `${title}|${authorKey(book.author) ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), book]);
  }
  return [...groups.values()].filter((group) => group.length > 1).sort((a, b) => b.length - a.length);
};

export const buildShelves = (books: Book[], series: LibrarySeries, now = Date.now()): Shelf[] => {
  const reading = books.filter(started);
  const paused = reading.filter((book) => now - time(book.lastOpened) > PAUSED_DAYS * DAY_MS).sort(newestOpened);
  const pausedIds = new Set(paused.map((book) => book.id));
  const upNext = series.groups.filter((group) => group.upNext && group.next).map((group) => group.next as Book);

  const shelves: Shelf[] = [
    {
      id: "reading",
      name: "Reading now",
      description: "Started and not finished, most recent first.",
      books: reading.filter((book) => !pausedIds.has(book.id)).sort(newestOpened)
    },
    {
      id: "up-next",
      name: "Next in your series",
      description: "You finished the book before each of these.",
      books: upNext
    },
    {
      id: "recent",
      name: "Recently added",
      description: `Added in the last ${RECENT_DAYS} days.`,
      books: books.filter((book) => now - time(book.createdAt) <= RECENT_DAYS * DAY_MS).sort(newestAdded)
    },
    {
      id: "not-started",
      name: "Not started",
      description: "Waiting on the shelf.",
      books: books.filter((book) => (book.progress ?? 0) === 0).sort(newestAdded)
    },
    {
      id: "paused",
      name: "Paused",
      description: `Started, then left for ${PAUSED_DAYS} days or more.`,
      books: paused
    },
    {
      id: "finished",
      name: "Finished",
      description: "Read to the end.",
      books: books.filter((book) => isFinished(book.progress)).sort(newestOpened)
    },
    {
      id: "duplicates",
      name: "Possible duplicates",
      description: "The same title and author more than once.",
      books: findDuplicates(books).flat()
    }
  ];
  return shelves.filter((shelf) => shelf.books.length > 0);
};
