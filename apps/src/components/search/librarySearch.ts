import type { Book } from "@shared/models/book";
import { encodeFindPlace, normalQuery } from "../../readers/findPlace";
import type { BookMatches, LibraryMatch } from "../../services/librarySearchService";

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
  | { kind: "done"; skipped: number }
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
  if (results.length === 0) {
    return "No matches";
  }
  const matches = results.reduce((sum, item) => sum + item.count, 0);
  return `${matchCount(matches)} in ${bookCount(results.length)}`;
};

/** Where a match is, as the reader takes it (`openAt`): its section and the words, to be found once the book is open. */
export const matchPlace = (match: LibraryMatch, query: string) =>
  encodeFindPlace({ href: match.href, spine: match.spine, nth: match.nth, query });
