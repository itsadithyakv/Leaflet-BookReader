/**
 * Scrolling runs the chapters together, one frame under another. A chapter
 * above the window that grows or shrinks (a picture in it arrives, it is
 * drawn again after being let go, its fonts come) moves everything below it,
 * the text being read with it, unless the page is scrolled by as much.
 * epub.js does that for a chapter it has just put in above, and for no other.
 */

/**
 * Whether a chapter that changed height by `delta` (its box now `top`,
 * `height`, in the scrolling container) was wholly above the window, whose
 * top is at `scrollTop`: its bottom, before the change, at or above it.
 * Then the page is scrolled by `delta` to keep the text where it was. One
 * the window shows any of is the reader's to see change, and is left be;
 * so is one drawn for the first time (it had no height: a chapter just put
 * on the page, the one a jump goes to among them).
 */
export const aboveWindow = (top: number, height: number, delta: number, scrollTop: number) =>
  delta !== 0 && height - delta > 0 && top + height - delta <= scrollTop + 1;

/**
 * The same for a chapter epub.js has put in above. It kept the text still
 * at every change of such a chapter's height, wherever the window was by
 * then: scrolled up into it, a change below the line being read threw the
 * page on by as much (1588px, once). Kept still now only while it is above
 * the window; and when it is first drawn, from no height at the top of the
 * page, that is where it is.
 */
export const aboveWindowPrepended = (top: number, height: number, delta: number, scrollTop: number) =>
  delta !== 0 && top + height - delta <= scrollTop + 1;
