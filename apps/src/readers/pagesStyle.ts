/**
 * Rules for the book's own document in the pages layout, where a chapter is
 * columns a page wide and a page high.
 *
 * The foot of a page. epub.js leaves 20px under the text, and the chapter
 * dock floats over the bottom 51px of the window (16px up, 35 high): the last
 * line of a full page ran behind it. Measured over 90 pages of a novel (page
 * 677 by 768), 35 of them had their last line under the dock, by up to 23 of
 * its 32px. Scrolling, a reader moves the line up; a page cannot be moved.
 * The text stops above the dock.
 *
 * A picture may be as tall as a page and no taller: a column cannot break
 * inside one, so what does not fit is cut off at the foot. epub.js sets a
 * limit of its own, but works it out before the reader's stylesheet moves the
 * text down clear of the toolbar: 95% of the frame less 40px, placed 80px
 * down. On a page 768px high that was a picture of 692px ending at 772: the
 * cover and every full-page map lost their last 4px beyond the frame, with
 * the rest of the foot under the dock. The limit here is the room a page has.
 *
 * A heading is kept with the lines that follow it, not left as the last line
 * of a page.
 *
 * What is wider than the column wraps. A table whose cells do not wrap, or a
 * long line of code, ran on past the column's edge (710px and 616px in the
 * test book) and was drawn across the next page, over its text, and cut off
 * on its own. Scrolling clips it at the window; a column has a neighbour.
 */

import { PAGE_TOP_PAD } from "./finish";

/** Room under the text of a page: the chapter dock (16px up, 35px high) and a little air. */
export const PAGE_FOOT_PAD = 56;

export const PAGES_CSS = `
  /* A finger moving across the page is a page turn (readers/pageTurn.ts,
     swipeTurn), not the browser's to pan with: it is left to the reader. */
  html[data-leaflet-layout="pages"] {
    touch-action: pan-y pinch-zoom;
  }
  html[data-leaflet-layout="pages"] body {
    padding-bottom: ${PAGE_FOOT_PAD}px !important;
  }
  html[data-leaflet-layout="pages"] body img,
  html[data-leaflet-layout="pages"] body svg {
    max-height: calc(100vh - ${PAGE_TOP_PAD + PAGE_FOOT_PAD}px) !important;
    object-fit: contain;
  }
  html[data-leaflet-layout="pages"] body :where(h1, h2, h3, h4, h5, h6) {
    break-after: avoid;
    break-inside: avoid;
  }
  html[data-leaflet-layout="pages"] body :where(td, th) {
    white-space: normal !important;
    overflow-wrap: anywhere;
  }
  html[data-leaflet-layout="pages"] body pre {
    white-space: pre-wrap !important;
    overflow-wrap: anywhere;
  }
`;

/**
 * A phone's pages (readers/touchLayout.ts). Its chrome is away while reading
 * and comes over the page only for a moment, so the page does not keep room
 * for it: 80 px over the text and 56 under it were a third of a sideways
 * phone's height, and left it six lines a page. The reader's frame is
 * already clear of the status and gesture bars (readers/touch.css).
 */
export const PHONE_PAGE_PAD = 20;

export const PHONE_PAGES_CSS = `
  html[data-leaflet-layout="pages"][data-leaflet-phone] body {
    padding-top: ${PHONE_PAGE_PAD}px !important;
    padding-bottom: ${PHONE_PAGE_PAD}px !important;
  }
  html[data-leaflet-layout="pages"][data-leaflet-phone] body img,
  html[data-leaflet-layout="pages"][data-leaflet-phone] body svg {
    max-height: calc(100vh - ${PHONE_PAGE_PAD * 2}px) !important;
  }
`;

/**
 * A phone's margins (docs/android.md, "The reader"). A phone is narrow
 * already: upright the text runs the width less 18 px a side, the least a
 * thumb's edge and a rounded corner leave readable (24 px, the desktop's, was
 * 12% of a 412 px screen), with no line length to cap it; the type panel's
 * line length is not offered there.
 */
export const PHONE_TEXT_PAD = 18;

/**
 * A phone's pages: the room between two columns of a spread, which epub.js
 * also takes for the margins (half each side; its own is a twelfth of the
 * width, 56 px a gap and 28 a side on a phone on its side).
 */
export const PHONE_PAGE_GAP = 36;

/**
 * Each side's margin of a phone's page, in px, inside the frame (which is
 * already clear of the system's bars and a camera's cutout). Beside a cutout
 * the cutout is the margin: the text starts where it ends, and the other side
 * takes the rest. The two always add up to the gap, which keeps every page
 * a whole turn wide.
 */
export const phonePageSides = (gap: number, insetLeft: number, insetRight: number): { left: number; right: number } => {
  if (insetLeft > insetRight) {
    return { left: 0, right: gap };
  }
  if (insetRight > insetLeft) {
    return { left: gap, right: 0 };
  }
  return { left: gap / 2, right: gap / 2 };
};

/**
 * A phone's chapters (`html[data-leaflet-phone]`): upright, narrower than any
 * line length, the text runs the width; hyphenation is fitted to short lines
 * (the chapter's language is set from the book's when it names none, or
 * `hyphens: auto` breaks nothing and justified lines gape).
 */
export const PHONE_TEXT_CSS = `
  @media (max-width: 560px) {
    html[data-leaflet-phone] {
      --reader-measure: 100vw !important;
    }
  }
  html[data-leaflet-phone] body,
  html[data-leaflet-phone] body p {
    hyphenate-limit-chars: 6 3 2;
  }
`;
