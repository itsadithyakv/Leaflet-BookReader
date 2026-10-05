/**
 * The scrollbar, held.
 *
 * Scrolling is one continuous book of which only two or three chapters are
 * on the page: the next is fetched as the scroll nears the end of what is
 * loaded. A wheel or a key gets there a line or a screen at a time. The
 * scrollbar's thumb gets there at once, and stays: held at the bottom it
 * fetched a chapter, found itself at the bottom of that too, and fetched the
 * next. Seventeen chapters in five seconds, the reader carried from 29% of
 * the book to 66%; at the top, back to the first page. A reader dragging the
 * thumb to the end expects to arrive somewhere and stop.
 *
 * So while the scrollbar is held the chapters on the page are shown and
 * hidden as they come into view, and none is fetched; fetching takes up
 * again when the thumb is let go. Browsers do not always say when that is,
 * so nothing here depends on being told: a hold lasts only while the page
 * goes on scrolling under it, and lapses by itself once the page has been
 * still for `STILL_MS`. Chapters can never stop loading for good.
 *
 * Pure: the reader says what happened and asks whether fetching is held.
 */

/** A hold lapses when the page has not scrolled for this long, released or not. */
export const STILL_MS = 1500;

export type ScrollbarHold = {
  /** A press on the scrollbar has been seen, and no release since. */
  pressed: boolean;
  /** When it was pressed, or last scrolled the page while pressed. */
  since: number;
};

export const NOT_HELD: ScrollbarHold = { pressed: false, since: 0 };

/**
 * A press on the scrolling container. `onScrollbar`: it landed outside the
 * container's own content box, which is where its scrollbar is drawn. A press
 * anywhere else means no scrollbar is being held.
 */
export const pressOn = (onScrollbar: boolean, now: number): ScrollbarHold => (onScrollbar ? { pressed: true, since: now } : NOT_HELD);

/** The page scrolled: a held scrollbar is still being dragged. */
export const pageScrolled = (hold: ScrollbarHold, now: number): ScrollbarHold => (hold.pressed ? { pressed: true, since: now } : hold);

/**
 * Let go, or as good as: the button came up, the pointer moved with no
 * button down, the window lost the keyboard, or the reader turned to the
 * wheel or a key (which the hold must never get in the way of).
 */
export const letGo = (): ScrollbarHold => NOT_HELD;

/** Whether fetching is held just now. */
export const holdsFetching = (hold: ScrollbarHold, now: number, still = STILL_MS) => hold.pressed && now - hold.since < still;

/** Whether a press `x` px from the left edge of a container's content box, `clientWidth` wide, is on its scrollbar (drawn on either side). */
export const isOnScrollbar = (x: number, clientWidth: number) => x >= clientWidth || x < 0;
