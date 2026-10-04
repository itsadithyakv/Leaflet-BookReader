/**
 * Where a word is in the book, for finding it again after the page was laid
 * out afresh.
 *
 * The words on the page are numbered from the top of whatever chapters are
 * loaded, and each is known by its text node. A resize makes epub.js throw the
 * chapters away and render them again: the nodes are new and the numbering may
 * start at another chapter, so the word being read (Smart Read's, or a pinned
 * Dotty's) could be found by neither, and reading carried on from wherever was
 * 38% down the window, or from the first word on the page. A chapter's own
 * words do not change, so "the nth word of chapter c" still names it.
 */
export type WordPlace = {
  /** The chapter's place in the book (its spine index). */
  section: number;
  /** Which word of that chapter, from 0. */
  offset: number;
};

/**
 * The place of the word numbered `index`. `sectionStarts[i]` is the number of
 * the first word of the i-th chapter on the page and `sectionIds[i]` is that
 * chapter. Null when the word is in no chapter that is known.
 */
export const wordPlace = (index: number, sectionStarts: number[], sectionIds: number[]): WordPlace | null => {
  let at = -1;
  for (let i = 0; i < sectionStarts.length; i += 1) {
    if (sectionStarts[i] <= index) {
      at = i;
    }
  }
  const section = sectionIds[at];
  return at >= 0 && index >= 0 && typeof section === "number" ? { section, offset: index - sectionStarts[at] } : null;
};

/**
 * The number, among `total` words now on the page, of the word at `place`; -1
 * when its chapter is not on the page (or no longer has that many words).
 */
export const indexOfPlace = (place: WordPlace | null, sectionStarts: number[], sectionIds: number[], total: number) => {
  if (!place) {
    return -1;
  }
  const at = sectionIds.indexOf(place.section);
  if (at < 0 || sectionStarts[at] === undefined) {
    return -1;
  }
  const index = sectionStarts[at] + place.offset;
  return index < (sectionStarts[at + 1] ?? total) ? index : -1;
};
