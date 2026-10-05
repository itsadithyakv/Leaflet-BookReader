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

/**
 * Clicking (or tapping) the side of a page turns it: the outer sixth each
 * side, or the page's own side margin where that is wider. The right side
 * goes on and the left goes back; in a right-to-left book the left side goes
 * on. The middle is left to whatever a click there already means. A point
 * beside the page (the window's gutter) belongs to the side it is on.
 */
export const CLICK_ZONE_SHARE = 1 / 6;

export const clickZone = (x: number, pageLeft: number, pageWidth: number, sideMargin: number, rtl = false): 1 | -1 | null => {
  if (!(pageWidth > 0)) {
    return null;
  }
  const zone = Math.min(pageWidth / 2, Math.max(pageWidth * CLICK_ZONE_SHARE, sideMargin));
  const side = x < pageLeft + zone ? -1 : x >= pageLeft + pageWidth - zone ? 1 : 0;
  return side === 0 ? null : ((rtl ? -side : side) as 1 | -1);
};

/** A press that moved further than this before letting go was a drag, not a click. */
export const CLICK_SLACK_PX = 5;
/** Held longer than this it is a long press (holding the page, starting a selection), not a click. */
export const CLICK_MAX_MS = 500;
/** A click on text waits this long before it turns the page, so the first click of a double-click (selecting a word) does not. */
export const DOUBLE_CLICK_MS = 220;

/** What is known of a press and its release, for deciding whether it was a plain click that may turn the page. */
export type PressFacts = {
  /** The main button (or a finger, or a pen's tip). */
  button: number;
  /** Ctrl, Cmd, Shift or Alt was held. */
  modified: boolean;
  /** How far the pointer moved between pressing and letting go, and how long that took. */
  moved: number;
  ms: number;
  /** Which click of a run this is: 2 for the second of a double-click. */
  count: number;
  /** Text was selected when the button went down (the click lets it go), or is now (the press selected some). */
  selection: boolean;
  /** Something is open over the page (a panel, a card, a popup, a dialog): the click is for closing it. */
  covered: boolean;
  /** The click has a meaning of its own where it landed: a link, a note, a picture, a name, a highlight, a control. */
  claimed: boolean;
};

export const pressIsClick = (press: PressFacts) =>
  press.button === 0 &&
  !press.modified &&
  press.moved <= CLICK_SLACK_PX &&
  press.ms <= CLICK_MAX_MS &&
  press.count <= 1 &&
  !press.selection &&
  !press.covered &&
  !press.claimed;

/**
 * A swipe across the page with a finger or a pen turns it. It has to be a
 * swipe and nothing else: far enough, clearly more across than down, quick
 * (a slow drag after a long press is selecting text), and one finger (two
 * are a pinch). The page follows the finger: swiping to the left brings the
 * next page in from the right, and in a right-to-left book the previous one.
 */
export const SWIPE_MIN_PX = 48;
export const SWIPE_MAX_MS = 500;
/** How many times further across than down. */
export const SWIPE_ACROSS = 2;

export type SwipeFacts = {
  dx: number;
  dy: number;
  ms: number;
  /** The most fingers that were down at once during it. */
  pointers: number;
  /** "mouse", "touch" or "pen": a mouse drags, it does not swipe. */
  pointerType: string;
  /** It began on something that scrolls sideways by itself, or it selected text. */
  taken: boolean;
};

export const swipeTurn = (swipe: SwipeFacts, rtl = false): 1 | -1 | null => {
  if (swipe.pointerType === "mouse" || swipe.pointers !== 1 || swipe.taken || !(swipe.ms <= SWIPE_MAX_MS)) {
    return null;
  }
  const across = Math.abs(swipe.dx);
  if (across < SWIPE_MIN_PX || across < Math.abs(swipe.dy) * SWIPE_ACROSS) {
    return null;
  }
  const on = swipe.dx < 0 ? 1 : -1;
  return (rtl ? -on : on) as 1 | -1;
};

/** How long a page takes to slide across; none when the reader asked for less motion. */
export const pageTurnDuration = (reducedMotion: boolean) => (reducedMotion ? 0 : 280);
