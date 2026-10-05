/**
 * Continuous scrolling for PDFs: every page in one column, drawn as it comes
 * near and let go of as it leaves.
 *
 * The column is laid out before most pages have been looked at. A page's
 * size is only known once pdf.js has fetched it, and fetching a thousand
 * pages to open a book is the thing not to do; so a page not yet seen is
 * given the first page's size, and takes its own when it is first needed.
 * That changes heights above the reader's place, and a place kept as a
 * scroll position would move under it. So a place is kept as a page and how
 * far down it, and turned back into a scroll position whenever the layout
 * changes.
 *
 * Pure: the arithmetic of the layout, of what is in view, of what to draw and
 * what to let go, and of keeping the place. The view (PdfScrollPages.tsx)
 * does the drawing.
 */

export type PageSize = { width: number; height: number };

/** The space between one page and the next, in CSS pixels. */
export const PAGE_GAP = 18;

/** A page's box at a scale, its 1px border each side included. */
export const pageBox = (size: PageSize, scale: number) => ({
  width: Math.floor(Math.max(1, size.width) * scale) + 2,
  height: Math.floor(Math.max(1, size.height) * scale) + 2
});

/**
 * The scale one page is drawn at. The document has one scale, worked out for
 * its first page; under a fit (`widthLimit` is the room a page has across),
 * a page that would be wider than the window at that scale is drawn at the
 * scale that fits it instead, so a landscape page in a portrait book is shown
 * whole, shorter, and nothing scrolls sideways. A zoom the reader chose
 * (`widthLimit` null) is the same for every page.
 */
export const pageScale = (size: PageSize, scale: number, widthLimit: number | null) => {
  const width = Math.max(1, size.width);
  // A hair over, so the width comes out at the whole pixel and not a fraction under it.
  return widthLimit !== null && width * scale > widthLimit ? (widthLimit + 1e-4) / width : scale;
};

/**
 * Where each page begins down the column. `tops[i]` is the top of page `i`
 * (from 0); one more entry than there are pages, the last being where a
 * further page would begin. The column's height is `columnHeight(tops)`.
 */
export const layOut = (count: number, heightOf: (index: number) => number, gap = PAGE_GAP) => {
  const tops = new Float64Array(count + 1);
  for (let index = 0; index < count; index += 1) {
    tops[index + 1] = tops[index] + heightOf(index) + gap;
  }
  return tops;
};

export const pageCountOf = (tops: Float64Array) => Math.max(0, tops.length - 1);

/** The height of the whole column: no gap after the last page. */
export const columnHeight = (tops: Float64Array, gap = PAGE_GAP) =>
  tops.length > 1 ? tops[tops.length - 1] - gap : 0;

/** The page a point down the column is in (or in the gap after), from 0. */
export const pageIndexAt = (tops: Float64Array, y: number) => {
  const count = pageCountOf(tops);
  if (count === 0) {
    return 0;
  }
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (tops[middle] <= y) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
};

/**
 * The pages to have in the document: those in view and those within
 * `overscan` pixels above and below, so a page is in place before it is
 * scrolled to.
 */
export const pagesNear = (tops: Float64Array, top: number, height: number, overscan: number) => ({
  first: pageIndexAt(tops, top - overscan),
  last: pageIndexAt(tops, top + height + overscan)
});

/**
 * The page the reader is on: the one across the line a third of the way down
 * the window. At the very start it is the first page and at the very end the
 * last, whatever is across the line.
 */
export const currentPageAt = (tops: Float64Array, top: number, height: number, gap = PAGE_GAP) => {
  const count = pageCountOf(tops);
  if (count === 0 || top <= 0) {
    return 0;
  }
  if (top + height >= columnHeight(tops, gap) - 1) {
    return count - 1;
  }
  return pageIndexAt(tops, top + height / 3);
};

/**
 * A place in the document that survives a change of layout: a page (from 0),
 * how far down that page as a share of its height, and, for a place in the
 * gap after it, how many pixels into the gap.
 */
export type Place = { page: number; fraction: number; extra: number };

export const placeAt = (tops: Float64Array, y: number, gap = PAGE_GAP): Place => {
  const count = pageCountOf(tops);
  if (count === 0) {
    return { page: 0, fraction: 0, extra: 0 };
  }
  const page = pageIndexAt(tops, y);
  const height = tops[page + 1] - tops[page] - gap;
  const into = y - tops[page];
  if (into <= 0) {
    return { page, fraction: 0, extra: Math.min(0, into) };
  }
  return into <= height || height <= 0
    ? { page, fraction: height > 0 ? into / height : 0, extra: 0 }
    : { page, fraction: 1, extra: into - height };
};

/**
 * The same for a page on its own, as the paged layout shows it: `into` pixels
 * of a page `height` tall are above the top of the window (fewer than none
 * while the room above the page is in view). Kept in the same form so a book
 * closed in one layout reopens at the same line in either.
 */
export const placeWithin = (page: number, into: number, height: number): Place => {
  if (!(height > 0) || !Number.isFinite(into)) {
    return { page, fraction: 0, extra: 0 };
  }
  if (into <= 0) {
    return { page, fraction: 0, extra: into };
  }
  return into <= height ? { page, fraction: into / height, extra: 0 } : { page, fraction: 1, extra: into - height };
};

/** Where a place is down the column, in the layout given. */
export const positionOf = (tops: Float64Array, place: Place, gap = PAGE_GAP) => {
  const count = pageCountOf(tops);
  if (count === 0) {
    return 0;
  }
  const page = Math.min(count - 1, Math.max(0, Math.floor(place.page)));
  const height = tops[page + 1] - tops[page] - gap;
  const fraction = Number.isFinite(place.fraction) ? Math.min(1, Math.max(0, place.fraction)) : 0;
  // Above the first page there is the scroller's own room, however much: a place there is kept as it is.
  const extra = Number.isFinite(place.extra) ? Math.min(gap, place.extra) : 0;
  return tops[page] + height * fraction + extra;
};

/**
 * A place and where in the window it is held: `offset` pixels below the top
 * of the window. Keeping an anchor through a change of layout is putting its
 * place back at its offset.
 */
export type Anchor = { place: Place; offset: number };

/**
 * The scroll position (down the column) that puts an anchor back where it
 * was. Not kept inside the column: the scroller has room above and below it,
 * and holds the position to what it can reach.
 */
export const scrollForAnchor = (tops: Float64Array, anchor: Anchor, gap = PAGE_GAP) =>
  positionOf(tops, anchor.place, gap) - anchor.offset;

export type DrawState = {
  /** The pages wanted, nearest the reader first. */
  wanted: number[];
  /** Pixels held by each page that has a drawn canvas. */
  drawn: ReadonlyMap<number, number>;
  /** Of the drawn pages, those drawn for the present scale and finish. */
  fresh: ReadonlySet<number>;
  /** The pixels a page's canvas will hold. */
  pixelsOf: (page: number) => number;
  /** How far a page is from the reader, in any unit; larger is further. */
  distanceOf: (page: number) => number;
  /** The most pixels to hold at once, the page being drawn included. */
  budget: number;
};

export type DrawPlan = {
  /** The page to draw next, or null when nothing is to be drawn now. */
  draw: number | null;
  /** Pages to let go of first, to make room for it. */
  release: number[];
};

/**
 * What to draw next and what to let go of for it.
 *
 * The next page is the nearest wanted one that is not drawn for the present
 * scale and finish. Drawing takes room twice over while it lasts: the page
 * is drawn on a sheet out of sight, and toning reads that sheet back; when it
 * lands, the sheet is exchanged for the canvas in the page. So a page of `p`
 * pixels needs `2p` free. Room is made by letting go of the drawn pages
 * furthest from the reader, and never of one nearer than the page to draw: if
 * that would be needed, the page waits as a blank one, which is how a page
 * zoomed past the budget stays within it.
 */
export const planDraw = (state: DrawState): DrawPlan => {
  const next = state.wanted.find((page) => !state.fresh.has(page));
  if (next === undefined) {
    return { draw: null, release: [] };
  }
  const need = state.pixelsOf(next) * 2;
  let held = 0;
  state.drawn.forEach((pixels) => {
    held += pixels;
  });
  const release: number[] = [];
  const reach = state.distanceOf(next);
  // Furthest first; a page being redrawn keeps its old canvas until the new one lands.
  const candidates = [...state.drawn.keys()]
    .filter((page) => page !== next && state.distanceOf(page) > reach)
    .sort((a, b) => state.distanceOf(b) - state.distanceOf(a));
  for (const page of candidates) {
    if (held + need <= state.budget) {
      break;
    }
    held -= state.drawn.get(page) ?? 0;
    release.push(page);
  }
  if (held + need > state.budget && held > (state.drawn.get(next) ?? 0)) {
    // No room without letting go of something nearer: this page waits.
    return { draw: null, release };
  }
  return { draw: next, release };
};

/**
 * The pages wanted for a window on the column: those in view first, from the
 * page the reader is on outwards, then the ones waiting just outside it.
 */
export const pagesWanted = (
  tops: Float64Array,
  top: number,
  height: number,
  near: { first: number; last: number }
) => {
  const current = currentPageAt(tops, top, height);
  const inView = pagesNear(tops, top, height, 0);
  const pages: number[] = [];
  for (let page = near.first; page <= near.last; page += 1) {
    pages.push(page);
  }
  const rank = (page: number) => (page >= inView.first && page <= inView.last ? 0 : 1);
  return pages.sort((a, b) => rank(a) - rank(b) || Math.abs(a - current) - Math.abs(b - current) || a - b);
};

/**
 * Whether a scroll is a jump (a drag of the scrollbar, a leap to a page)
 * rather than reading: it moved more than a window's height at once. Drawing
 * waits for a jump to settle, so dragging across 500 pages starts no renders
 * on the way.
 */
export const isJump = (from: number, to: number, viewHeight: number) => Math.abs(to - from) > Math.max(200, viewHeight);
