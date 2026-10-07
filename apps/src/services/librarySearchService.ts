import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

/** One match kept to show: the words found, with what stands round them. */
export type LibraryMatch = {
  /** The section it is in, as the book's manifest names it, and its place in the spine. */
  href: string;
  spine: number;
  /** Which of the section's matches it is, from 0. */
  nth: number;
  before: string;
  text: string;
  after: string;
};

/** What one book holds of the words: every match counted, the first few to show. */
export type BookMatches = { bookId: string; count: number; matches: LibraryMatch[] };

/** Sent as each book is finished. `book` is null for a book without the words, or one that could not be searched. */
export type SearchProgress = { done: number; total: number; book: BookMatches | null };

export type SearchSummary = {
  /** The books the words are in, the one with the most matches first. */
  books: BookMatches[];
  searched: number;
  /** Books with no text to search (a PDF, a comic, a book never opened and so never converted) or too damaged to read. */
  skipped: number;
  /** A newer search began and this one stopped where it was. */
  stopped: boolean;
};

/**
 * Search inside every book (src-tauri/src/search.rs). The books' files are
 * read by the app itself, so there is nothing to search in the browser preview.
 */
export const librarySearchService = {
  available: () => isTauri(),

  /** Looks for the words. A search already running stops; `onProgress` hears of each book as it is finished. */
  search(query: string, onProgress: (progress: SearchProgress) => void): Promise<SearchSummary> {
    const channel = new Channel<SearchProgress>();
    channel.onmessage = onProgress;
    return invoke<SearchSummary>("library_search", { query, onProgress: channel });
  },

  /** Stops the search that is running: nobody is waiting for it any more. */
  cancel(): void {
    if (isTauri()) {
      void invoke("library_search_cancel").catch(() => undefined);
    }
  }
};
