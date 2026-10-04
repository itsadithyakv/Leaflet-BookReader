/**
 * Search inside a PDF: every page, in order, for the phrase typed.
 *
 * A page's text is asked for only when the search reaches it, so the first
 * results of an 800-page document arrive after its first pages, not after all
 * of them, and a search that is cancelled (the phrase changed, the panel
 * closed) reads no further. Where the text comes from is passed in, so the
 * search can be tested without a PDF.
 */

import { findMatches, hasSearchableText, searchPattern, snippetAt, type Snippet } from "./pdfText";

export type PdfSearchHit = {
  /** 1-based. */
  page: number;
  /** Which match on its page this is, from 0. */
  nth: number;
  snippet: Snippet;
};

export type PdfSearchState = {
  hits: PdfSearchHit[];
  /** How much of the document has been read, 0 to 1. */
  fraction: number;
  /** Whether any page read so far had text. A scan has none, and no search can find anything in it. */
  sawText: boolean;
  /** True once the search stopped at `limit` hits rather than at the last page. */
  capped: boolean;
};

type SearchOptions = {
  pageCount: number;
  /** A page's searchable text (readers/pdfText.ts `joinTextItems`). */
  textOf: (page: number) => Promise<string>;
  signal: AbortSignal;
  limit?: number;
  onProgress?: (state: PdfSearchState) => void;
  /** A clock, for tests. */
  now?: () => number;
};

/** How long the search may run before it lets the window draw and take input. */
const BREATHE_AFTER_MS = 12;

/**
 * Runs the search. Resolves with what was found when it reaches the end, the
 * limit, or is cancelled (what it had by then; the caller that cancelled has
 * no use for it).
 */
export const searchPdf = async (
  query: string,
  { pageCount, textOf, signal, limit = 200, onProgress, now = () => performance.now() }: SearchOptions
): Promise<PdfSearchState> => {
  const state: PdfSearchState = { hits: [], fraction: 0, sawText: false, capped: false };
  if (!searchPattern(query) || pageCount <= 0) {
    state.fraction = 1;
    return state;
  }
  let lastBreath = now();
  for (let page = 1; page <= pageCount; page += 1) {
    if (signal.aborted) {
      return state;
    }
    let text = "";
    try {
      text = await textOf(page);
    } catch {
      // A page whose text cannot be read is skipped; the rest are still searched.
    }
    if (signal.aborted) {
      return state;
    }
    if (!state.sawText && hasSearchableText(text)) {
      state.sawText = true;
    }
    const matches = findMatches(text, query, limit - state.hits.length);
    matches.forEach((match, nth) => {
      state.hits.push({ page, nth, snippet: snippetAt(text, match) });
    });
    state.fraction = page / pageCount;
    if (state.hits.length >= limit) {
      state.capped = true;
      onProgress?.(state);
      return state;
    }
    // Told about every page that found something, and now and then otherwise.
    if (matches.length > 0 || page === pageCount || page % 8 === 0) {
      onProgress?.(state);
    }
    // Text already read comes back without a pause; a long run of such pages
    // must not hold the window.
    if (now() - lastBreath > BREATHE_AFTER_MS) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastBreath = now();
    }
  }
  return state;
};
