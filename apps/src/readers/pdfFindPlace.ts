/**
 * A PDF opened at a match of the library's search ("Search inside books"):
 * the place is the page the words are on, which of its matches was picked,
 * and the words themselves. The reader goes to the page and opens its own
 * search on the words, which marks them there (pages/PageReaderView.tsx).
 *
 * The library found the words in the text kept of the PDF
 * (src-tauri/src/pdf_text.rs) and the reader finds them again in the page as
 * pdf.js reads it now (readers/pdfText.ts `findMatches`). The two match
 * nearly alike, not exactly: where the page has fewer matches than the
 * library counted, the first is shown, and where it has none the reader is
 * simply on the page.
 */

import { normalQuery } from "./findPlace";

export type PdfFindPlace = {
  /** From 1. */
  page: number;
  /** Which of the page's matches, from 0. */
  nth: number;
  query: string;
};

/**
 * Starts no highlight's place ("pdf:", readers/pdfHighlights.ts), no match in
 * an EPUB ("find:", readers/findPlace.ts) and no CFI ("epubcfi("), so none of
 * them is taken for this, nor this for one of them.
 */
const PREFIX = "pagefind:";

export const isPdfFindPlace = (place: string | null | undefined): place is string => typeof place === "string" && place.startsWith(PREFIX);

/** `pagefind:<page>:<nth>`, then the words on a line of their own. */
export const encodePdfFindPlace = ({ page, nth, query }: PdfFindPlace): string =>
  `${PREFIX}${Math.max(1, Math.trunc(page) || 1)}:${Math.max(0, Math.trunc(nth) || 0)}\n${query.replace(/[\r\n]+/g, " ")}`;

export const decodePdfFindPlace = (place: string | null | undefined): PdfFindPlace | null => {
  if (!isPdfFindPlace(place)) {
    return null;
  }
  const parts = /^(\d{1,9}):(\d{1,9})\n([^]*)$/.exec(place.slice(PREFIX.length));
  if (!parts) {
    return null;
  }
  const page = Number(parts[1]);
  const query = normalQuery(parts[3]);
  return page >= 1 && query ? { page, nth: Number(parts[2]), query } : null;
};

/**
 * Which of a page's matches to show, of `count` found there now: the one
 * picked or, when the page has fewer than the library counted, the first.
 * Null when the words are not on the page any more.
 */
export const matchToShow = (count: number, nth: number): number | null => (count <= 0 ? null : nth >= 0 && nth < count ? nth : 0);
