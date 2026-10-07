import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

/** One match kept to show: the words found, with what stands round them. */
export type LibraryMatch = {
  /** The section it is in, as the book's manifest names it, and its place in the spine. */
  href: string;
  spine: number;
  /** Which of the section's matches it is, from 0. */
  nth: number;
  /** In a PDF: the page it is on, from 1, `nth` being which of that page's matches. Absent for an EPUB. */
  page?: number;
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
  /** Books with no text to search (a comic, a scanned PDF, a book never opened and so never converted) or too damaged to read. */
  skipped: number;
  /** How many of those are PDFs with no text in them (scans). */
  noText: number;
  /** PDFs whose text has not been read yet, by id: neither searched nor skipped. Read here, kept, and asked for again (`only`). */
  unread: string[];
  /** A newer search began and this one stopped where it was. */
  stopped: boolean;
};

/**
 * Search inside every book (src-tauri/src/search.rs). The books' files are
 * read by the app itself, so there is nothing to search in the browser preview.
 */
export const librarySearchService = {
  available: () => isTauri(),

  /**
   * Looks for the words. A search already running stops; `onProgress` hears of each book as it is finished.
   * `only` names the books to go through, by id, when it is not the whole library.
   */
  search(query: string, onProgress: (progress: SearchProgress) => void, only?: string[]): Promise<SearchSummary> {
    const channel = new Channel<SearchProgress>();
    channel.onmessage = onProgress;
    return invoke<SearchSummary>("library_search", { query, only: only ?? null, onProgress: channel });
  },

  /**
   * Whether a PDF's text is kept for the search already (src-tauri/src/pdf_text.rs).
   * Where it cannot be kept at all (the browser preview) it is said to be, so nobody gathers it.
   */
  hasPdfText(bookId: string): Promise<boolean> {
    return isTauri() ? invoke<boolean>("pdf_text_has", { bookId }) : Promise.resolve(true);
  },

  /** Keeps a PDF's text as the page read it, a string a page, in order (readers/pdfTextCache.ts). */
  savePdfText(bookId: string, pages: string[]): Promise<void> {
    return invoke("pdf_text_save", { bookId, pages });
  },

  /** Stops the search that is running: nobody is waiting for it any more. */
  cancel(): void {
    if (isTauri()) {
      void invoke("library_search_cancel").catch(() => undefined);
    }
  }
};
