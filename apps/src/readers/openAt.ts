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

import { isFindPlace } from "./findPlace";

/** How long in the book before a look counts as reading. */
export const LOOK_MS = 2 * 60_000;

/**
 * Whether the place on screen is to be saved as the book's place.
 * `openedAtPlace`: the book was opened at a picked place; `msInBook`: how long
 * this visit has lasted.
 */
export const placeFollows = (openedAtPlace: boolean, msInBook: number) => !openedAtPlace || msInBook >= LOOK_MS;

/**
 * The picked place the reader can go to the moment the book is open: a
 * highlight's CFI. A match of the library's search names a section and the
 * words (readers/findPlace.ts) and has to be found in the book first; until
 * it is, the reader holds the place where the reading stopped, as on any
 * other visit, and nothing is ever handed a place that is not a CFI.
 */
export const placeAtOpen = (openAt: string | null): string | null => (openAt !== null && !isFindPlace(openAt) ? openAt : null);

/**
 * Whether the visit is a look: the book was opened at a picked place. A
 * match of the library's search is one once the reader has been `taken` to
 * it (or to the start of its section, when the words are no longer there).
 * When the book has no such section there is nowhere to look: it opens where
 * the reading stopped, and that is an ordinary visit, whose place follows
 * from the first line.
 */
export const isLook = (openAt: string | null, taken = true) => openAt !== null && (taken || !isFindPlace(openAt));
