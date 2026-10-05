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
  /**
   * The page to begin at (1-based; the reader's own). The search goes on to
   * the end and round to the pages before it, so when it stops at `limit`
   * what it has is what comes next from where the reader is.
   */
  from?: number;
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
  { pageCount, textOf, signal, limit = 200, from = 1, onProgress, now = () => performance.now() }: SearchOptions
): Promise<PdfSearchState> => {
  const state: PdfSearchState = { hits: [], fraction: 0, sawText: false, capped: false };
  if (!searchPattern(query) || pageCount <= 0) {
    state.fraction = 1;
    return state;
  }
  const first = Number.isFinite(from) ? Math.min(pageCount, Math.max(1, Math.round(from))) : 1;
  let lastBreath = now();
  for (let read = 1; read <= pageCount; read += 1) {
    const page = ((first - 1 + read - 1) % pageCount) + 1;
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
    state.fraction = read / pageCount;
    if (state.hits.length >= limit) {
      state.capped = true;
      onProgress?.(state);
      return state;
    }
    // Told about every page that found something, and now and then otherwise.
    if (matches.length > 0 || read === pageCount || read % 8 === 0) {
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

/** The results in page order, however the search came by them. */
export const hitsInPageOrder = (hits: ReadonlyArray<PdfSearchHit>) =>
  [...hits].sort((a, b) => a.page - b.page || a.nth - b.nth);

/**
 * Which result Enter (`by` 1) or Shift+Enter (-1) goes to, among results in
 * page order; -1 when there are none. From the result on show it is the next
 * or the one before, round the ends. With none on show yet it is the first on
 * or after the reader's page (or the last before it, going back): a reader on
 * page 400 used to be taken to the first match in the book, on page 1.
 */
export const nextHitIndex = (
  hits: ReadonlyArray<PdfSearchHit>,
  active: PdfSearchHit | null,
  by: 1 | -1,
  page: number
) => {
  if (hits.length === 0) {
    return -1;
  }
  const at = active ? hits.findIndex((hit) => hit.page === active.page && hit.nth === active.nth) : -1;
  if (at >= 0) {
    return (at + by + hits.length) % hits.length;
  }
  if (by > 0) {
    const ahead = hits.findIndex((hit) => hit.page >= page);
    return ahead >= 0 ? ahead : 0;
  }
  let behind = -1;
  hits.forEach((hit, index) => {
    if (hit.page < page) {
      behind = index;
    }
  });
  return behind >= 0 ? behind : hits.length - 1;
};
