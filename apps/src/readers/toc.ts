/** The table of contents, flattened for the chapter list. */

import type { TocItem } from "./readerTypes";

export const flattenToc = (items: TocItem[]) => {
  const result: TocItem[] = [];
  const walk = (list: TocItem[]) => {
    list.forEach((item) => {
      result.push(item);
      if (item.subitems && item.subitems.length > 0) {
        walk(item.subitems);
      }
    });
  };
  walk(items);
  return result;
};

/** A contents entry as a place: the section it opens (its spine index, when it is in the book) and the anchor inside it, if any. */
export type TocPlace = { spine: number | undefined; anchor: string | null };

/**
 * The contents entry a place in the book is under: the last entry that
 * starts at or before it, or -1 before the first. `reached` says whether an
 * anchor in the section being read is at or above the reading line (several
 * chapters can share one file).
 *
 * The dock used to name only entries that say "Chapter", "Book", "Section",
 * "Prologue" or "Epilogue": on a part title, a map or the notes it went on
 * showing the last one that did, and a book whose chapters have titles of
 * their own said "Chapter 1" from cover to cover.
 */
export const tocEntryAt = (entries: readonly TocPlace[], section: number, reached: (anchor: string) => boolean) => {
  let best = -1;
  let bestSpine = -1;
  entries.forEach((entry, index) => {
    if (typeof entry.spine !== "number" || entry.spine > section || entry.spine < bestSpine) {
      return;
    }
    if (entry.spine === section && entry.anchor && !reached(entry.anchor)) {
      return;
    }
    best = index;
    bestSpine = entry.spine;
  });
  return best;
};

/** A contents link as a place. `spineIndexOf` knows a file's place in the book. */
export const tocPlace = (href: string, spineIndexOf: (file: string) => number | undefined): TocPlace => {
  const hashAt = href.indexOf("#");
  let anchor: string | null = hashAt >= 0 ? href.slice(hashAt + 1) : null;
  try {
    anchor = anchor ? decodeURIComponent(anchor) : null;
  } catch {
    // A stray "%": the raw form is the only candidate.
  }
  return { spine: spineIndexOf(hashAt >= 0 ? href.slice(0, hashAt) : href), anchor: anchor || null };
};
