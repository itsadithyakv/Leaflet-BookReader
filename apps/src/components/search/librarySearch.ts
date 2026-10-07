import type { Book } from "@shared/models/book";
import { encodeFindPlace, normalQuery } from "../../readers/findPlace";
import { encodePdfFindPlace } from "../../readers/pdfFindPlace";
import type { BookMatches, LibraryMatch, SearchSummary } from "../../services/librarySearchService";

/** The shortest query worth going through a library for, and the longest taken (as src-tauri/src/search.rs has them). */
export const MIN_QUERY = 2;
export const MAX_QUERY = 200;

/** The words as they are searched for, or null when there are too few to search. */
export const searchable = (query: string): string | null => {
  const words = normalQuery(query).slice(0, MAX_QUERY).trim();
  return words.length >= MIN_QUERY ? words : null;
};

/**
 * The results with one more book's, the book with the most matches first.
 * Books with as many stay in the order they came (the library searches the
 * books read most lately first), and a book told of twice is counted once.
 */
export const withBook = (results: readonly BookMatches[], found: BookMatches): BookMatches[] => {
  const rest = results.filter((item) => item.bookId !== found.bookId);
  const at = rest.findIndex((item) => item.count < found.count);
  return at < 0 ? [...rest, found] : [...rest.slice(0, at), found, ...rest.slice(at)];
};

export type BookResult = { book: Book; count: number; matches: LibraryMatch[] };

/** The results beside their books. One whose book has left the library since (a delete, a sync) is dropped. */
export const listResults = (results: readonly BookMatches[], books: readonly Book[]): BookResult[] => {
  const byId = new Map(books.map((book) => [book.id, book]));
  return results.flatMap((item) => {
    const book = byId.get(item.bookId);
    return book ? [{ book, count: item.count, matches: item.matches }] : [];
  });
};

const bookCount = (count: number) => `${count.toLocaleString()} ${count === 1 ? "book" : "books"}`;

export const matchCount = (count: number) => `${count.toLocaleString()} ${count === 1 ? "match" : "matches"}`;

export type SearchState =
  | { kind: "idle" }
  | { kind: "searching"; done: number; total: number }
  /** PDFs whose text was never read are being read, one at a time: `left` of them to go, `fraction` of the reading done. */
  | { kind: "reading"; left: number; fraction: number }
  /** `noText` of the `skipped` are PDFs with no text in them. */
  | { kind: "done"; skipped: number; noText: number }
  | { kind: "failed" };

/** The one line under the search box. */
export const statusLine = (state: SearchState, results: readonly BookResult[]): string => {
  if (state.kind === "idle") {
    return "Type a word or phrase";
  }
  if (state.kind === "failed") {
    return "The search did not finish";
  }
  if (state.kind === "searching") {
    return state.total > 0 ? `Searching… ${state.done.toLocaleString()} of ${bookCount(state.total)}` : "Searching…";
  }
  if (state.kind === "reading") {
    return `Reading ${state.left.toLocaleString()} ${state.left === 1 ? "PDF" : "PDFs"}…`;
  }
  if (results.length === 0) {
    return "No matches";
  }
  const matches = results.reduce((sum, item) => sum + item.count, 0);
  return `${matchCount(matches)} in ${bookCount(results.length)}`;
};

/** What "not searched" means, said only to a reader who asks (a `title`): `noText` of the books are PDFs with no text in them. */
export const notSearchedTitle = (noText: number) =>
  [
    noText > 0 ? `${noText.toLocaleString()} ${noText === 1 ? "PDF is" : "PDFs are"} scanned pages, with no text to search.` : null,
    "Comics have no text to search. A Kindle book or a text file is searched once it has been opened, and a book not on this device once it is downloaded."
  ]
    .filter(Boolean)
    .join(" ");

/** Where a match is, as the reader takes it (`openAt`): its section, or its page in a PDF, and the words, to be found once the book is open. */
export const matchPlace = (match: LibraryMatch, query: string) =>
  match.page !== undefined
    ? encodePdfFindPlace({ page: match.page, nth: match.nth, query })
    : encodeFindPlace({ href: match.href, spine: match.spine, nth: match.nth, query });

/** A PDF match's page, as its row says it; null for a match in an EPUB, which has no pages. */
export const pageLabel = (match: LibraryMatch): string | null => (match.page !== undefined ? `p. ${match.page.toLocaleString()}` : null);

export type UnreadSteps = {
  /** A PDF's text, a string a page (readers/pdfTextCache.ts): null when the reading was called off, and it throws for a PDF that cannot be read. */
  read: (bookId: string, onPage: (done: number, total: number) => void) => Promise<string[] | null>;
  /** Keeps it for every search after this one. */
  save: (bookId: string, pages: string[]) => Promise<void>;
  /** The words looked for in that book alone, now its text is kept. */
  search: (bookId: string) => Promise<SearchSummary>;
  /** False once nobody is waiting: the dialog was shut, or the words changed. */
  stillWanted: () => boolean;
  /** PDFs that could not be read since the app started. They are not tried at every search; added to here. */
  unreadable: Set<string>;
  /** `left` PDFs still to read, this one among them, and how far along the reading is, 0 to 1. */
  onProgress: (left: number, fraction: number) => void;
  /** A PDF just read has the words in it. */
  onBook: (found: BookMatches) => void;
};

/**
 * Reads the PDFs a search found no text for, one at a time: each is read,
 * kept, and then searched by itself. Gives what they add to the counts; null
 * when it was called off on the way (what was kept by then stays kept).
 * `stopped` when a search of one was stopped by something else.
 */
export const readUnread = async (
  ids: readonly string[],
  { read, save, search, stillWanted, unreadable, onProgress, onBook }: UnreadSteps
): Promise<{ skipped: number; noText: number; stopped: boolean } | null> => {
  const todo = ids.filter((id) => !unreadable.has(id));
  const tally = { skipped: ids.length - todo.length, noText: 0, stopped: false };
  for (let at = 0; at < todo.length; at += 1) {
    const id = todo[at];
    if (!stillWanted()) {
      return null;
    }
    const left = todo.length - at;
    onProgress(left, at / todo.length);
    try {
      const pages = await read(id, (done, total) => {
        if (stillWanted() && total > 0) {
          onProgress(left, (at + Math.min(1, done / total)) / todo.length);
        }
      });
      if (pages === null || !stillWanted()) {
        return null;
      }
      await save(id, pages);
    } catch {
      if (!stillWanted()) {
        return null;
      }
      // Locked, damaged, or its text could not be kept: one more book not searched.
      unreadable.add(id);
      tally.skipped += 1;
      continue;
    }
    if (!stillWanted()) {
      return null;
    }
    const summary = await search(id);
    if (!stillWanted()) {
      return null;
    }
    if (summary.stopped) {
      tally.stopped = true;
      return tally;
    }
    summary.books.forEach(onBook);
    // (Still named as unread after being kept: it was not kept after all.)
    tally.skipped += summary.skipped + summary.unread.length;
    tally.noText += summary.noText;
  }
  return tally;
};
