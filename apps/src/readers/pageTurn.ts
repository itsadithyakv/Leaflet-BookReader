/**
 * Turning pages (layout "pages"). epub.js lays a chapter out as columns side
 * by side and scrolls across them, one page's width at a time.
 *
 * Its own "next" adds a page's width to wherever the scroll position is, and
 * first asks whether a whole further page fits:
 * `scrollLeft + container width + page width <= content width`. That holds
 * only while the position is exactly on a page. On a display scaled to 125%
 * or 150% a scroll position lands on device pixels, so each turn can leave it
 * a fraction of a pixel further on, and a container can be a pixel wider than
 * a page; either way the test fails one page early, and the last page of a
 * chapter was skipped, straight into the next chapter. So the page to turn to
 * is worked out here, by counting pages, and a turn goes to that page's exact
 * place rather than a page's width on from wherever the last one stopped.
 */

/** How many pages the chapter on screen has. */
export const pageCount = (contentWidth: number, pageWidth: number) =>
  pageWidth > 0 ? Math.max(1, Math.round(contentWidth / pageWidth)) : 1;

/**
 * Where a page turn lands, as a scroll position, or null when the chapter has
 * no further page that way (the turn goes to the next or previous chapter).
 */
export const pageTurnTarget = (scrollLeft: number, pageWidth: number, contentWidth: number, direction: 1 | -1) => {
  if (!(pageWidth > 0)) {
    return null;
  }
  const pages = pageCount(contentWidth, pageWidth);
  const page = Math.min(pages - 1, Math.max(0, Math.round(scrollLeft / pageWidth)));
  const next = page + direction;
  return next < 0 || next >= pages ? null : next * pageWidth;
};

/**
 * A held key repeats about 30 times a second, and every repeat used to turn a
 * page: a press held a moment too long turned two, and a held key ran through
 * the chapter faster than a page can be seen. Repeats are paced as the page
 * reader paces them (`KEY_REPEAT_TURN_MS` in PageReaderView.tsx): a held key
 * flips through the pages one at a time, visibly.
 */
export const KEY_REPEAT_TURN_MS = 150;

/**
 * Whether a key press turns a page. A press of its own always does; a repeat
 * of a held key only once `KEY_REPEAT_TURN_MS` has passed since the last turn
 * a key made.
 */
export const keyTurns = (repeat: boolean, msSinceLastKeyTurn: number) =>
  !repeat || msSinceLastKeyTurn >= KEY_REPEAT_TURN_MS;

/** How long a page takes to slide across; none when the reader asked for less motion. */
export const pageTurnDuration = (reducedMotion: boolean) => (reducedMotion ? 0 : 280);
