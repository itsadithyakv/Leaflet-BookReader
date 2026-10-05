/**
 * Chapters that share a file.
 *
 * Most books give each chapter a file, and the reader's "next chapter",
 * "end of the chapter" and "time left in the chapter" were all worked out by
 * file. A book whose contents (its own, or a list made by Leaflet) place
 * several chapters in one file had them all wrong: in a novel of three files
 * and twenty-one chapters, "next chapter" skipped seven of them, End went to
 * the end of the file, and a chapter had two hours left in it.
 *
 * An entry here is a contents entry as a place: the section it is in and the
 * share of that section's text before it (0 at its top; readers/contentsScan.ts
 * measures it). Entries are in the contents' own order.
 */

export type ChapterStart = { spine: number | undefined; within: number };

const inside = (entry: ChapterStart | undefined) => Boolean(entry) && typeof entry?.spine === "number" && entry.within > 0;

/**
 * Next chapter, from the entry being read (-1 before the first) in `section`:
 * the next entry of the contents, when it starts inside a file (further down
 * this one, or part-way down a later one whose top is still this chapter).
 * Null when the next entry opens a file, or there is none: the next file, as
 * it always was.
 */
export const nextChapterEntry = (entries: readonly ChapterStart[], section: number, current: number): number | null => {
  for (let index = current + 1; index < entries.length; index += 1) {
    const spine = entries[index].spine;
    if (typeof spine !== "number" || spine < section) {
      continue;
    }
    return inside(entries[index]) ? index : null;
  }
  return null;
};

/**
 * Previous chapter. The entry before the one being read, when either of them
 * starts inside a file: "top" when the chapter being read is the first in
 * its file and something comes before it there. Null: the previous file, as
 * it always was.
 */
export const previousChapterEntry = (entries: readonly ChapterStart[], section: number, current: number): number | "top" | null => {
  if (current < 0) {
    return null;
  }
  let before = -1;
  for (let index = current - 1; index >= 0; index -= 1) {
    const spine = entries[index].spine;
    if (typeof spine === "number" && spine <= section) {
      before = index;
      break;
    }
  }
  if (inside(entries[current])) {
    return before < 0 ? "top" : before;
  }
  return before >= 0 && inside(entries[before]) ? before : null;
};

/**
 * Where the chapter being read ends in `section`, as a share of the section:
 * the start of the next entry further down the same file. Null when the
 * chapter runs to the end of the file (or beyond it).
 */
export const chapterEndWithin = (entries: readonly ChapterStart[], section: number, current: number, within: number): number | null => {
  let end: number | null = null;
  entries.forEach((entry, index) => {
    if (index === current || entry.spine !== section || !inside(entry) || entry.within <= within) {
      return;
    }
    if (end === null || entry.within < end) {
      end = entry.within;
    }
  });
  return end;
};

/**
 * The head of a later file that is still the chapter being read: the next
 * entry starts part-way down it. `{ section, within }`: that file and how far
 * down it the chapter runs. Null when the next entry opens its file.
 */
export const chapterTail = (entries: readonly ChapterStart[], section: number, current: number): { section: number; within: number } | null => {
  for (let index = current + 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (typeof entry.spine !== "number" || entry.spine < section) {
      continue;
    }
    if (entry.spine === section) {
      // Further down this file: the chapter ends here (chapterEndWithin), or this entry is behind the reader.
      if (inside(entry)) {
        return null;
      }
      continue;
    }
    return inside(entry) ? { section: entry.spine, within: entry.within } : null;
  }
  return null;
};

/**
 * The entry a place is under, by shares alone (no page to measure on: the
 * progress bar's label for a place the reader has not gone to yet). The last
 * entry that starts at or before it, as `tocEntryAt` finds it on the page.
 */
export const entryAtShare = (entries: readonly ChapterStart[], section: number, within: number): number => {
  let best = -1;
  let bestSpine = -1;
  entries.forEach((entry, index) => {
    if (typeof entry.spine !== "number" || entry.spine > section || entry.spine < bestSpine) {
      return;
    }
    if (entry.spine === section && entry.within > within + 1e-6) {
      return;
    }
    best = index;
    bestSpine = entry.spine;
  });
  return best;
};

/**
 * Sections that are the same file as the one before them in the reading
 * order (a title page listed twice by a conversion): their places in the
 * spine. The reader shows such a file once.
 */
export const listedAgain = (hrefs: readonly string[]): number[] => {
  const again: number[] = [];
  hrefs.forEach((href, index) => {
    if (index > 0 && href && href === hrefs[index - 1]) {
      again.push(index);
    }
  });
  return again;
};

/**
 * Whether a place is before the story: in a section before the story's
 * first, or (several things to a file) still under a contents entry that
 * comes before the first chapter's, in that chapter's own file or an earlier
 * one. `entry` is the contents entry the place is under (-1: none),
 * `firstChapter` the first entry that reads as a chapter (-1: none does) and
 * `firstChapterSection` the section it is in.
 */
export const beforeStory = (place: { section: number; entry: number }, story: { lo: number; firstChapter: number; firstChapterSection: number | undefined }) => {
  if (place.section < story.lo) {
    return true;
  }
  if (story.firstChapter < 0 || typeof story.firstChapterSection !== "number") {
    return false;
  }
  return place.section <= story.firstChapterSection && place.entry < story.firstChapter;
};

/** With pages: the page (from 1) a chapter inside a file starts on, whether at the top of it, and the contents entry it is. */
export type PageStart = { page: number; atTop: boolean; entry?: number };

/**
 * With pages, the chapter a page belongs to when it holds the end of one and
 * the start of the next: which of `starts` (its place in the list; -1 for
 * what comes before the first).
 *
 * The rule: a page belongs to the chapter at its top. A chapter that starts
 * part-way down a page is the reader's from the next page on; the shared
 * page is the last page of the one that is ending, as when scrolling the
 * dock changes its name when the heading reaches the top of the window, not
 * when it comes into view. So End, which shows a chapter's last page, shows
 * it under that chapter's name, and the page count there is "56 of 56".
 *
 * The exception is a chapter the reader asked for by name (the chapter list,
 * next and previous chapter, a link, Home): `asked` is its contents entry,
 * and the page it starts on is its page 1 for as long as that page is up.
 */
export const chapterOnPage = (page: number, starts: ReadonlyArray<PageStart>, asked?: number | null): number => {
  let current = -1;
  starts.forEach((start, index) => {
    if (start.page < page || (start.page === page && (start.atTop || (typeof asked === "number" && start.entry === asked)))) {
      current = index;
    }
  });
  // (Two chapters starting on one page, the second asked for: the loop above ends on the later of them.)
  if (typeof asked === "number") {
    const wanted = starts.findIndex((start) => start.entry === asked && start.page === page);
    if (wanted >= 0) {
      return wanted;
    }
  }
  return current;
};

/**
 * With pages, the page showing as a page of its CHAPTER when chapters share
 * a file: "3 of 12", not "60 of 181". `starts` are the pages (from 1) on
 * which the file's chapters start, in order, and whether each starts at the
 * top of its page; a chapter that starts part-way down a page shares that
 * page with the end of the one before, and the page counts for both. Null
 * when no chapter starts inside the file.
 *
 * Whose page a shared one is: see `chapterOnPage`.
 */
export const pagesOfChapter = (page: number, total: number, starts: ReadonlyArray<PageStart>, asked?: number | null): { page: number; total: number } | null => {
  if (starts.length === 0 || page < 1 || total < 1) {
    return null;
  }
  const current = chapterOnPage(page, starts, asked);
  const first = current >= 0 ? starts[current].page : 1;
  const next = starts[current + 1];
  const last = next ? (next.atTop ? next.page - 1 : next.page) : total;
  return { page: page - first + 1, total: Math.max(page - first + 1, last - first + 1) };
};

/**
 * With pages: the first and the last page of the chapter the page showing
 * is in, when chapters share a file (as `pagesOfChapter` counts them). Home
 * and End go to these. Null when no chapter starts inside the file.
 */
export const chapterPageRange = (page: number, total: number, starts: ReadonlyArray<PageStart>, asked?: number | null): { first: number; last: number } | null => {
  const counted = pagesOfChapter(page, total, starts, asked);
  if (!counted) {
    return null;
  }
  const first = page - counted.page + 1;
  return { first, last: Math.min(total, first + counted.total - 1) };
};

/**
 * With pages, previous chapter: the entry to go back to, stepping past
 * entries that land on the page already showing (a file's own entry and its
 * first heading share its first page: going "back" to the one from the
 * other showed the same page again, for ever). `before` is where to start
 * (the entry before the one being read, in the contents' order), `lands`
 * says whether an entry is on the page showing. -1 when there is no earlier
 * place among the entries.
 */
export const earlierEntry = (entries: readonly ChapterStart[], section: number, before: number, lands: (entry: number) => boolean): number => {
  let target = before;
  while (target >= 0) {
    const spine = entries[target]?.spine;
    if (typeof spine === "number" && spine <= section && !lands(target)) {
      return target;
    }
    target -= 1;
  }
  return -1;
};
