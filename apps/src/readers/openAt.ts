/**
 * A book opened at a place picked elsewhere (a highlight's "Open in book" in
 * the library) rather than where the reading stopped.
 *
 * That is a look, not reading on from there: the saved place and the book's
 * progress stay where the reading stopped, so the next ordinary open resumes
 * there. They used to follow the look, and peeking at a highlight in chapter 2
 * while reading chapter 20 lost the place. A reader who stays is reading, and
 * from then on the place follows as usual.
 */

/** How long in the book before a look counts as reading. */
export const LOOK_MS = 2 * 60_000;

/**
 * Whether the place on screen is to be saved as the book's place.
 * `openedAtPlace`: the book was opened at a picked place; `msInBook`: how long
 * this visit has lasted.
 */
export const placeFollows = (openedAtPlace: boolean, msInBook: number) => !openedAtPlace || msInBook >= LOOK_MS;
