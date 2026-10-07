/**
 * Highlights in a PDF: where one is, as something that can be stored, put in
 * order and drawn again.
 *
 * An EPUB highlight's place is a CFI, a path into the book's text. A PDF has
 * no such thing: a page is a picture with words laid over it. So a PDF
 * highlight's place is the page and the rectangles its words cover, as
 * fractions of the page (which is how the search's marks are drawn too), and
 * it is kept in the same field of the same row as a CFI is
 * (`annotations.cfi`), written `pdf:12:1234,2000,5000,180;...` in
 * ten-thousandths of the page. The rest of a highlight (its words, colour,
 * note, the backup) is as for any book.
 *
 * Fractions, not points: the same highlight is right at any zoom, on any
 * screen, in either layout.
 *
 * Pure: numbers in, numbers out.
 */
import type { PageRect } from "./pdfText";

export type PdfPlace = {
  /** From 1. */
  page: number;
  /** What the highlight covers, in fractions of the page; none for a bare page (a bookmark). */
  rects: PageRect[];
};

const PREFIX = "pdf:";
/** Fractions are kept to this many parts: a twentieth of a millimetre on an A4 page. */
const PARTS = 10_000;
/** A highlight over more lines than this is a page, not a passage; the rest is left off. */
export const MAX_RECTS = 120;

const part = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * PARTS);

/** A place as it is stored. */
export const encodePlace = ({ page, rects }: PdfPlace): string => {
  const where = rects
    .slice(0, MAX_RECTS)
    .map((rect) => [rect.left, rect.top, rect.width, rect.height].map(part).join(","))
    .join(";");
  return where ? `${PREFIX}${Math.round(page)}:${where}` : `${PREFIX}${Math.round(page)}`;
};

/** A page alone, for a bookmark listed beside the highlights. */
export const pagePlace = (page: number) => encodePlace({ page, rects: [] });

export const isPdfPlace = (stored: string | null | undefined): stored is string => typeof stored === "string" && stored.startsWith(PREFIX);

/** A stored place, read back; null when it is not one (an EPUB's CFI, or damaged). */
export const decodePlace = (stored: string | null | undefined): PdfPlace | null => {
  if (!isPdfPlace(stored)) {
    return null;
  }
  const [pageText, where = ""] = stored.slice(PREFIX.length).split(":");
  const page = Number(pageText);
  if (!Number.isInteger(page) || page < 1) {
    return null;
  }
  const rects: PageRect[] = [];
  for (const piece of where.split(";")) {
    if (!piece) {
      continue;
    }
    const numbers = piece.split(",").map(Number);
    if (numbers.length !== 4 || numbers.some((value) => !Number.isFinite(value) || value < 0 || value > PARTS)) {
      return null;
    }
    const [left, top, width, height] = numbers.map((value) => value / PARTS);
    rects.push({ left, top, width, height });
  }
  return { page, rects };
};

/**
 * Which of two places comes first in the book: by page, then down the page,
 * then along the line. Throws on a place it cannot read, as comparing CFIs
 * does, so such a highlight is listed last (`orderHighlights`).
 */
export const comparePlaces = (a: string, b: string): number => {
  const first = decodePlace(a);
  const second = decodePlace(b);
  if (!first || !second) {
    throw new Error("Not a place in a PDF");
  }
  const at = (place: PdfPlace) => place.rects[0] ?? { left: 0, top: 0 };
  return first.page - second.page || at(first).top - at(second).top || at(first).left - at(second).left;
};

/**
 * A selection's rectangles, made fit to keep: inside the page, one to a line.
 *
 * The browser gives a rectangle for every run of text the selection touches
 * (a line of a PDF is often a dozen runs, and a run inside another gives the
 * same rectangle twice). Those on one line are joined into one, so a
 * highlight is a bar across the words and not a row of tiles with gaps, and
 * so it is a few numbers to store.
 */
export const lineRects = (rects: PageRect[]): PageRect[] => {
  const inside: PageRect[] = [];
  for (const rect of rects) {
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(1, rect.left + rect.width);
    const bottom = Math.min(1, rect.top + rect.height);
    // Off the page, or nothing at all (a line break selects as a sliver).
    if (right - left > 0.0005 && bottom - top > 0.0005) {
      inside.push({ left, top, width: right - left, height: bottom - top });
    }
  }
  // First which line each is on (runs of one line sit a hair higher or lower
  // than each other, so their tops alone do not say), then along each line.
  inside.sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: PageRect[][] = [];
  for (const rect of inside) {
    const row = rows.find((candidate) => {
      const first = candidate[0];
      const overlap = Math.min(first.top + first.height, rect.top + rect.height) - Math.max(first.top, rect.top);
      return overlap > Math.min(first.height, rect.height) * 0.5;
    });
    if (row) {
      row.push(rect);
    } else {
      rows.push([rect]);
    }
  }
  const lines: PageRect[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.left - b.left);
    let bar: PageRect | null = null;
    for (const rect of row) {
      // Runs of one line touch, overlap, or are a space apart: no further than a line is tall.
      // Further than that is another column, which keeps its own bar.
      if (bar && rect.left - (bar.left + bar.width) < Math.max(bar.height, rect.height)) {
        const top = Math.min(bar.top, rect.top);
        bar.width = Math.max(bar.left + bar.width, rect.left + rect.width) - bar.left;
        bar.height = Math.max(bar.top + bar.height, rect.top + rect.height) - top;
        bar.top = top;
      } else {
        bar = { ...rect };
        lines.push(bar);
      }
    }
  }
  lines.sort((a, b) => a.top - b.top || a.left - b.left);
  return lines.slice(0, MAX_RECTS);
};

/**
 * Rectangles in the window, as fractions of the page they are on (`page` is
 * the page's own box in the window).
 */
export const toPageRects = (
  rects: Array<{ left: number; top: number; width: number; height: number }>,
  page: { left: number; top: number; width: number; height: number }
): PageRect[] =>
  page.width > 0 && page.height > 0
    ? rects.map((rect) => ({
        left: (rect.left - page.left) / page.width,
        top: (rect.top - page.top) / page.height,
        width: rect.width / page.width,
        height: rect.height / page.height
      }))
    : [];

/**
 * The highlight at a point of a page (in fractions of it), the smallest
 * first: one highlight made inside another is the one the pointer is on.
 */
export const highlightAt = <T extends { rects: PageRect[] }>(highlights: T[], x: number, y: number): T | null => {
  let found: T | null = null;
  let foundArea = Infinity;
  for (const highlight of highlights) {
    const on = highlight.rects.some((rect) => x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height);
    if (on) {
      const area = highlight.rects.reduce((sum, rect) => sum + rect.width * rect.height, 0);
      if (area < foundArea) {
        found = highlight;
        foundArea = area;
      }
    }
  }
  return found;
};

/** A selection's words as a highlight keeps them: one line, hyphens at line ends joined. */
export const selectedWords = (text: string) =>
  text
    .replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
