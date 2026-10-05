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
 * Which page of the chapter is showing (the first is 1) and how many it has,
 * from where the frame is. epub.js numbers the page by rounding the scroll
 * position down, and on a scaled display the position of a page sits a
 * fraction of a pixel short of it (at 125%, 846 device pixels for a page 677
 * wide is 676.8; at 150% the last page of a chapter cannot scroll past
 * 3384.67 for 3385): the page was numbered one less than it is. The last
 * page of a chapter then read as the one before it, so the last chapter's
 * last page never counted as the end of the book.
 */
export const pageAt = (scrollLeft: number, pageWidth: number, contentWidth: number) => {
  const total = pageCount(contentWidth, pageWidth);
  const page = pageWidth > 0 ? Math.min(total, Math.max(1, Math.round(scrollLeft / pageWidth) + 1)) : 1;
  return { page, total };
};

/**
 * Where the frame goes to show the page that holds a point of the chapter
 * (`left`, measured from the chapter's start). A pixel of give: a word at the
 * very start of a page can be drawn a fraction short of it.
 */
export const pageHolding = (left: number, pageWidth: number) =>
  pageWidth > 0 ? Math.max(0, Math.floor((left + 1) / pageWidth)) * pageWidth : 0;

/**
 * The frame was moved by something other than a page turn (the browser
 * bringing a focused link into view, a selection dragged past the edge) and
 * sits between two pages: where the nearer whole page is. Null when it is on
 * a page already (within a pixel, which a scaled display leaves).
 */
export const strayPageTarget = (scrollLeft: number, pageWidth: number, contentWidth: number) => {
  if (!(pageWidth > 0)) {
    return null;
  }
  const target = (pageAt(scrollLeft, pageWidth, contentWidth).page - 1) * pageWidth;
  return Math.abs(scrollLeft - target) > 1 ? target : null;
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

/**
 * The wheel and the trackpad turn pages: one page for a gesture, not one for
 * every event of it. A notch of a mouse wheel is one event; a flick on a
 * trackpad is dozens, and they keep coming for half a second and more after
 * the fingers have left (inertia). The first of a gesture turns the page, and
 * the rest are passed over until the wheel has been quiet for
 * `WHEEL_QUIET_MS`; a second notch after that turns another.
 */
export const WHEEL_QUIET_MS = 250;

/**
 * Movement this small (in pixels, added up while the wheel keeps moving) is a
 * finger resting on a trackpad, not a turn. A notch of a wheel is 100 or so.
 */
export const WHEEL_MIN_PX = 10;

export type WheelGesture = {
  /** When the last event of a gesture that turned a page came; null with none under way. */
  turnedAt: number | null;
  /** Small movement gathered so far towards a turn, and when its last event came. */
  gathered: number;
  gatheredAt: number;
};

export const WHEEL_AT_REST: WheelGesture = { turnedAt: null, gathered: 0, gatheredAt: 0 };

/**
 * A wheel event at time `at` (milliseconds): the page it turns (1 on, -1
 * back), if any, and what to remember for the next event. Down or right goes
 * on, up or left goes back, by whichever way the wheel moved more.
 * `deltaMode` is the event's own: 0 pixels, 1 lines, 2 pages.
 */
export const wheelTurn = (
  gesture: WheelGesture,
  at: number,
  deltaX: number,
  deltaY: number,
  deltaMode = 0
): { turn: 1 | -1 | null; gesture: WheelGesture } => {
  if (gesture.turnedAt !== null && at - gesture.turnedAt < WHEEL_QUIET_MS) {
    // More of the gesture that turned the page: it goes on as long as it keeps coming.
    return { turn: null, gesture: { ...gesture, turnedAt: at } };
  }
  const moved = (Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX) * (deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1);
  if (!Number.isFinite(moved) || moved === 0) {
    return { turn: null, gesture: { ...gesture, turnedAt: null } };
  }
  const gathered = (at - gesture.gatheredAt < WHEEL_QUIET_MS ? gesture.gathered : 0) + moved;
  if (Math.abs(gathered) < WHEEL_MIN_PX) {
    return { turn: null, gesture: { turnedAt: null, gathered, gatheredAt: at } };
  }
  return { turn: gathered > 0 ? 1 : -1, gesture: { turnedAt: at, gathered: 0, gatheredAt: at } };
};

/** How long a page takes to slide across; none when the reader asked for less motion. */
export const pageTurnDuration = (reducedMotion: boolean) => (reducedMotion ? 0 : 280);
