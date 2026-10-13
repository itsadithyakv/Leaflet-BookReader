/**
 * The book being read, telling the camp where the reading has got to.
 *
 * The camp is fed by reading, and until this only by how much of it: the
 * minutes, the streak, the books finished. This is the book itself coming
 * into it. When the reading passes from one stretch of a book into the
 * next (a chapter, where the book's chapters are known; a twentieth of it
 * where they are not), the camp is told, and its rules decide whether a
 * parcel comes up the path (`storyRead` in `rules.ts`: only with the
 * reading to show for it).
 *
 * It sits between the library and the camp so that neither has to know the
 * other. The library is loaded with the app; the camp's store is not, until
 * somebody opens Pip's tab, and reading must not wait on that or drag it in
 * at every turn of a page. So this keeps where each book was last seen, and
 * only goes for the camp when a stretch is finished.
 */

/** Where a book has no chapters to go by, it is cut into this many stretches. */
export const STRETCHES = 20;

const chapters = new Map<string, number>();
const seen = new Map<string, number>();

/** The reader, saying which chapter of a book is on screen (and that the book has chapters at all). */
export const noteChapter = (bookId: string, index: number, total: number) => {
  if (total > 0 && Number.isInteger(index) && index >= 0) chapters.set(bookId, index);
};

/** The stretch of a book a place in it falls in. */
export const stretchOf = (bookId: string, progress: number) => chapters.get(bookId) ?? Math.floor(Math.max(0, Math.min(1, progress)) * STRETCHES);

type Tell = (bookId: string, stretch: number, title: string) => void;
let tell: Tell | null = null;
/** For tests: who is told, in place of the camp's store. Null puts the camp back. */
export const tellInstead = (to: Tell | null) => {
  tell = to;
  seen.clear();
  chapters.clear();
};

/**
 * The reading moved on in a book. The camp hears of it the first time a
 * book is seen (so that it knows where the reading began) and whenever a
 * stretch is finished; not for every page between.
 */
export const storyMoved = (bookId: string, title: string, progress: number) => {
  const stretch = stretchOf(bookId, progress);
  const before = seen.get(bookId);
  if (before !== undefined && stretch <= before) return;
  seen.set(bookId, stretch);
  if (tell) {
    tell(bookId, stretch, title);
    return;
  }
  // The camp's store is its own piece of the app, fetched when it is first wanted.
  void import("../../store/baseStore").then(({ useBaseStore }) => useBaseStore.getState().storyRead(bookId, stretch, title)).catch(() => undefined);
};
