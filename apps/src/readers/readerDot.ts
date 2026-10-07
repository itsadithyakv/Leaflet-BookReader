/** Dotty, the marker beside the line being read: where it may sit. */

/**
 * Whether Dotty has been left below the end of the chapters on the page.
 *
 * It sits in the scrolling container at a height in the book, and the chapters
 * under it come and go. Left below the last of them it holds the page open
 * down to itself: blank space to scroll into, which epub.js takes for text
 * still to come, so the next chapter is not fetched.
 *
 * `chapterEnds` is where each chapter on the page ends, from the top of the
 * container; none means the page is being swapped.
 */
export const dotIsStranded = (dotBottom: number, chapterEnds: number[]) =>
  dotBottom > chapterEnds.reduce((end, bottom) => Math.max(end, bottom), 0);

/** How near the top or bottom of the window a drag has to be for the page to move, in pixels. */
export const DRAG_EDGE_ZONE = 64;

/**
 * How fast the page scrolls while Dotty is held against the top or bottom of
 * the window, in pixels a second (up is negative), or 0 away from both.
 *
 * A drag chose a line among those in the window and nothing moved the page,
 * so Dotty could be taken no further than the window's first or last line:
 * a Dotty that had run on could not be carried back to an earlier page.
 *
 * Slow as the pointer comes into the edge's strip, so a line can be picked as
 * it comes into view, and faster the further it is pushed, past the edge too
 * (a held pointer goes on being heard outside the window).
 */
export const dragEdgeSpeed = (pointerY: number, top: number, bottom: number) => {
  const zone = Math.min(DRAG_EDGE_ZONE, (bottom - top) / 4);
  if (!(zone > 0)) {
    return 0;
  }
  const up = top + zone - pointerY;
  const down = pointerY - (bottom - zone);
  const into = Math.max(up, down);
  if (into <= 0) {
    return 0;
  }
  const depth = Math.min(2, into / zone);
  const speed = Math.min(2000, 80 + 620 * depth * depth);
  return up > down ? -speed : speed;
};
