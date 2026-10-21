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
 * How many files "next chapter" (or "previous") may step over to reach an
 * entry of the contents. Further than that, the contents do not list the
 * chapters (a list of the parts alone) and the next file is as near as the
 * reader can be taken to the next chapter.
 */
export const ENTRY_REACH_FILES = 4;

/** Of two entries, whether `a` comes earlier in the book than `b`. */
const earlier = (a: ChapterStart, b: ChapterStart) => (a.spine as number) < (b.spine as number) || (a.spine === b.spine && a.within < b.within);

/**
 * Next chapter, when the next entry opens a file (`nextChapterEntry` said
 * null): the earliest entry in a file after `section`, stepping over the
 * files between that the contents do not list. Those used to be stopped at
 * one by one: a chapter's epigraph, given a file of its own by a Kindle
 * conversion, then the chapter; a part's second title page; the rest of a
 * chapter a publisher split into two files, which put the reader in the
 * middle of the chapter they had asked to leave. -1 when no entry is within
 * `reach` files: the next file, as it always was.
 */
export const entryAfter = (entries: readonly ChapterStart[], section: number, reach = ENTRY_REACH_FILES): number => {
  let best = -1;
  entries.forEach((entry, index) => {
    if (typeof entry.spine !== "number" || entry.spine <= section || entry.spine - section - 1 > reach) {
      return;
    }
    if (best < 0 || earlier(entry, entries[best])) {
      best = index;
    }
  });
  return best;
};

/**
 * Previous chapter, when neither the chapter being read nor the one before
 * it starts inside a file (`previousChapterEntry` said null): the start of
 * the latest entry in a file before `section`. In a file the contents do not
 * list (the epigraph before a chapter, the second half of a split chapter)
 * that is the start of the chapter the dock names there. -1 when none is
 * within `reach` files: the file before, as it always was.
 */
export const entryBefore = (entries: readonly ChapterStart[], section: number, reach = ENTRY_REACH_FILES): number => {
  let best = -1;
  entries.forEach((entry, index) => {
    if (typeof entry.spine !== "number" || entry.spine >= section || section - entry.spine - 1 > reach) {
      return;
    }
    // The latest file; in it, its first entry (the file's top).
    const held = best >= 0 ? entries[best] : null;
    if (!held || (entry.spine as number) > (held.spine as number) || (entry.spine === held.spine && entry.within < held.within)) {
      best = index;
    }
  });
  return best;
};

/** A file this small (in bytes) that the contents do not list, straight before a chapter's own, is part of that chapter: its epigraph. */
export const LEAD_IN_BYTES = 2048;

/**
 * The file a chapter whose entry opens file `section` starts in: the small
 * file straight before it that the contents do not list (its epigraph,
 * which a Kindle conversion gives a file of its own), so it is read rather
 * than left above the window. Never at or before `floor` (the file being
 * left), never a large unlisted file (the rest of the chapter before, split
 * in two by its publisher), and one file at most: a part's subtitle above
 * the epigraph stays the part's. `section` when there is none.
 */
export const leadInOf = (section: number, listed: ReadonlySet<number>, bytes: readonly number[], floor: number): number => {
  const before = section - 1;
  return before > floor && !listed.has(before) && (bytes[before] ?? 0) > 0 && bytes[before] <= LEAD_IN_BYTES ? before : section;
};

/**
 * What the chapter rules below need to know of the book: its entries as
 * places, the files they list, the files' sizes, and which entries are a
 * part's (the title page of Part Three, say: `partEntries`).
 */
export type ChapterBook = { entries: readonly ChapterStart[]; listed: ReadonlySet<number>; bytes: readonly number[]; parts: ReadonlySet<number> };

export const chapterBook = (entries: readonly ChapterStart[], bytes: readonly number[], parts: ReadonlySet<number> = new Set()): ChapterBook => ({
  entries,
  listed: new Set(entries.map((entry) => entry.spine).filter((spine): spine is number => typeof spine === "number")),
  bytes,
  parts
});

/**
 * The contents entries that are a part's: named as one ("PART THREE: King",
 * "Book Two"; `isPart` reads a label), or holding entries beneath them.
 */
export const partEntries = (labels: readonly string[], depths: readonly number[], isPart: (label: string) => boolean): Set<number> => {
  const parts = new Set<number>();
  labels.forEach((label, index) => {
    if (isPart(label) || (depths[index + 1] ?? 0) > (depths[index] ?? 0)) {
      parts.add(index);
    }
  });
  return parts;
};

const small = (book: ChapterBook, section: number) => (book.bytes[section] ?? 0) > 0 && book.bytes[section] <= LEAD_IN_BYTES;

/**
 * The file a chapter whose own file is `section` starts in: its epigraph
 * (`leadInOf`), and above that, when the chapter is its part's first, the
 * part's title page (and the subtitle page between): so next chapter from
 * the part before lands on the part's title with its first chapter, and
 * that page counts as the chapter, not as a stop of its own (which took a
 * second press, a few lines on).
 */
const chapterStartFrom = (book: ChapterBook, section: number) => {
  const start = leadInOf(section, book.listed, book.bytes, -1);
  let at = start - 1;
  // At most one unlisted small page (the part's subtitle) between.
  if (at >= 0 && !book.listed.has(at) && small(book, at)) {
    at -= 1;
  }
  const partHere = book.entries.some((entry, index) => book.parts.has(index) && entry.spine === at && entry.within <= 0);
  return at >= 0 && partHere && small(book, at) ? at : start;
};

/** The file an entry's chapter starts in (its epigraph's, its part's title page, or its own), or null for an entry that is not a file's top. */
export const startFileOf = (book: ChapterBook, entry: number): number | null => {
  const at = book.entries[entry];
  if (!at || typeof at.spine !== "number" || at.within > 0) {
    return null;
  }
  return book.parts.has(entry) ? leadInOf(at.spine, book.listed, book.bytes, -1) : chapterStartFrom(book, at.spine);
};

/** The first entry after file `section` that is not a part's title (the part's first chapter for one that is), or -1. */
const chapterAfter = (book: ChapterBook, section: number, reach = ENTRY_REACH_FILES): number => {
  let entry = entryAfter(book.entries, section, reach);
  for (let hops = 0; entry >= 0 && book.parts.has(entry) && hops < 4; hops += 1) {
    const spine = book.entries[entry].spine as number;
    const chapter = entryAfter(book.entries, spine);
    // A part whose first chapter starts on its title page is that chapter's way in.
    if (chapter < 0 || book.parts.has(chapter) ? false : (startFileOf(book, chapter) ?? Infinity) <= spine) {
      entry = chapter;
    } else {
      break;
    }
  }
  return entry;
};

/**
 * The chapter a place is in, as the dock names it and as next and previous
 * chapter go from: `reached` is the contents entry the reading line is under
 * (readers/toc.ts: tocEntryAt). In a chapter's epigraph, or on the title
 * page of a part it opens, it is that chapter. One rule for both, so that
 * the name shown and where the arrows go never disagree.
 */
export const entryOfPlace = (book: ChapterBook, section: number, reached: number): number => {
  // A file that is a chapter's own, not a part's: the entry reached.
  const own = book.entries.some((entry, index) => entry.spine === section && !book.parts.has(index));
  if (own) {
    return reached;
  }
  const next = chapterAfter(book, section, 2);
  return next >= 0 && !book.parts.has(next) && (startFileOf(book, next) ?? Infinity) <= section ? next : reached;
};

/** Where next or previous chapter goes: a contents entry, and the file to show from its top when the chapter starts above its own (an epigraph, a part's title). */
export type ChapterStep = { entry: number; file: number | null };

/**
 * Next chapter from the chapter being read (`current`, by `entryOfPlace`)
 * with the reading line in file `section`: the next entry inside a file
 * when there is one (`nextChapterEntry`), else the first chapter after the
 * one being read, from the top of where it starts (its epigraph, its part's
 * title page). The next chapter's opening already in the window below
 * changes nothing: it is still where next goes, put at the top. Null at the
 * end.
 */
export const nextChapterStep = (book: ChapterBook, section: number, current: number): ChapterStep | null => {
  const inside = nextChapterEntry(book.entries, section, current);
  if (inside !== null) {
    return { entry: inside, file: null };
  }
  // In the epigraph of the chapter being read (or on its part's title page), that chapter starts below: the one after it.
  const own = book.entries[current]?.spine;
  const from = typeof own === "number" && own > section ? own : section;
  const entry = chapterAfter(book, from);
  if (entry < 0) {
    return null;
  }
  const file = startFileOf(book, entry);
  return { entry, file: file !== null && file !== book.entries[entry].spine && file > section ? file : null };
};

/**
 * Previous chapter, when neither the chapter being read nor the one before
 * starts inside a file: the start of the chapter before the one being read
 * (its epigraph, its part's title page). Not the start of the one being
 * read, nor a part's title on its own: next and previous go a chapter at a
 * time either way. Null at the start.
 */
export const previousChapterStep = (book: ChapterBook, section: number, current: number): ChapterStep | null => {
  const own = typeof current === "number" && current >= 0 ? startFileOf(book, current) : null;
  let from = own !== null ? Math.min(own, section) : section;
  let entry = entryBefore(book.entries, from);
  // A part's title page on its own (its chapter is the one being read, or was stepped past): the chapter before it.
  for (let hops = 0; entry >= 0 && book.parts.has(entry) && hops < 4; hops += 1) {
    const before = entryBefore(book.entries, book.entries[entry].spine as number);
    if (before < 0) {
      break;
    }
    from = book.entries[entry].spine as number;
    entry = before;
  }
  if (entry < 0) {
    return null;
  }
  const file = startFileOf(book, entry);
  return { entry, file: file !== null && file !== book.entries[entry].spine ? file : null };
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
