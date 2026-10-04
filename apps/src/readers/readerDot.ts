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
