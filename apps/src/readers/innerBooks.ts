/**
 * Books within a book: an omnibus, a boxed set, a trilogy in one file.
 *
 * The reader took every EPUB for one story. A set of four novels then had one
 * flat list of 378 chapters with "Prologue" four times and "Tyrion"
 * thirty-five, a dock that said "Tyrion", one percentage across all four, and
 * "time left in the book" counted to the end of the last one. This finds the
 * books inside (`findInnerBooks`), from the contents alone, and answers what
 * the list, the dock, the progress bar and the time left ask about them. Pure:
 * contents rows and section sizes in, plain data out.
 *
 * What counts as a book inside:
 *
 * - **Nested contents.** A top-level entry that holds three entries or more
 *   and 2% of the book or more is a book, when there are at least two of them
 *   and together they are half the file. Not an entry named as a numbered
 *   division ("Part One", "Book Two: Muad'Dib", "Volume 3", "Act IV"): those
 *   are the parts of one novel, unless the entry holds front matter of its
 *   own (a title page, a copyright page), which a part never does. Nor an
 *   entry named as front or back matter ("Appendices", "Notes").
 * - **Flat contents.** A title page or a copyright page listed more than
 *   once: each run of front matter that is followed by 5% of the book or more
 *   opens a book, named by the entry just before the run when that is a name
 *   and not front matter itself. "Book One" entries in a flat list cannot be
 *   told from the parts of one novel and are left as they are.
 *
 * A single novel has none, and is shown exactly as before.
 */

import { isOutsideLabel, storySpan } from "./progress";
import type { TocItem } from "./readerTypes";

/** A contents entry in reading order (the order of `flattenToc`): its name, the section it opens, how deep it is nested. */
export type ContentsRow = {
  label: string;
  spine: number | undefined;
  depth: number;
  /** Known to be a whole book of a set, whatever it is called (`TocItem.book`: a chapter list made by Leaflet says so). */
  book?: boolean;
};

export type InnerBook = {
  /** Its own row in the contents, or -1 when nothing names it (flat contents). */
  entry: number;
  /** Its first and last rows (the first is `entry` when it has one). */
  firstRow: number;
  lastRow: number;
  label: string;
  /** The sections it runs over, covers and appendices included. */
  first: number;
  last: number;
  /** The novel itself: its first chapter's section to its last chapter's. */
  storyLo: number;
  storyHi: number;
};

const MIN_ENTRIES = 3;
const MIN_SHARE_NESTED = 0.02;
const MIN_SHARE_FLAT = 0.05;
const MIN_TOGETHER = 0.5;

const tidy = (label: string) => label.toLowerCase().replace(/\s+/g, " ").trim();

const COUNT_WORD =
  "\\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth";
const NUMBERED_DIVISION = new RegExp(`^(part|book|volume|vol\\.?|act|section|livre|tome|teil|buch|parte|libro)\\s+(${COUNT_WORD})\\b`);

/** "Part One", "Book Two: Muad'Dib", "Volume 3": a division of one work, by its name. */
export const isNumberedDivision = (label: string) => NUMBERED_DIVISION.test(tidy(label));

/** A title page or a copyright page: what a book has and a part of one does not. */
const isOwnFrontMatter = (label: string) => /^(title page|half title|copyright)\b/.test(tidy(label));

/**
 * What a whole book carries inside it and a part of a novel, or a version of
 * a text, does not: a cover, a title page, a copyright page, a dedication, a
 * contents page, an appendix, acknowledgments, a note about the author. (Not
 * an introduction, a prologue or notes: parts have those.)
 */
const isBookMatter = (label: string) =>
  /^(cover|title page|half title|copyright|dedication|contents|table of contents|epigraph|appendix|appendices|acknowledge?ments?|afterword|about the author|also by)\b/.test(tidy(label));

/** How deep each entry of a contents tree is, in the order of `flattenToc`. */
export const tocDepths = (items: readonly TocItem[]) => {
  const depths: number[] = [];
  const walk = (list: readonly TocItem[], depth: number) => {
    list.forEach((item) => {
      depths.push(depth);
      walk(item.subitems ?? [], depth + 1);
    });
  };
  walk(items, 0);
  return depths;
};

const prefixOf = (bytes: readonly number[]) => {
  const prefix = [0];
  bytes.forEach((size, index) => prefix.push(prefix[index] + Math.max(0, size || 0)));
  return prefix;
};

/** The novel inside the sections `first..last`: by its chapters when the contents frame them, else from its first entry not named as front matter to its last before the back matter. */
const storyOf = (rows: readonly ContentsRow[], firstRow: number, lastRow: number, prefix: readonly number[], first: number, last: number) => {
  const entries = rows
    .slice(firstRow, lastRow + 1)
    .filter((row): row is ContentsRow & { spine: number } => typeof row.spine === "number" && row.spine >= first && row.spine <= last);
  const framed = storySpan(entries, prefix, first, last);
  if (framed) {
    return framed;
  }
  const story = entries.filter((row) => !isOutsideLabel(row.label));
  if (story.length === 0) {
    return { lo: first, hi: last };
  }
  const lo = Math.min(...story.map((row) => row.spine));
  const lastStory = story.reduce((a, b) => (b.spine >= a.spine ? b : a));
  const after = entries.find((row) => row.spine > lastStory.spine && isOutsideLabel(row.label));
  const hi = after ? after.spine - 1 : last;
  return hi >= lo && prefix[hi + 1] - prefix[lo] >= (prefix[last + 1] - prefix[first]) * 0.5 ? { lo, hi } : { lo: first, hi: last };
};

const nestedBooks = (rows: readonly ContentsRow[], prefix: readonly number[], lastSection: number): InnerBook[] => {
  const total = prefix[prefix.length - 1];
  const tops = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.depth === 0);
  const found: InnerBook[] = [];
  let proven = 0;
  tops.forEach(({ row, index }, at) => {
    const lastRow = at + 1 < tops.length ? tops[at + 1].index - 1 : rows.length - 1;
    const inside = rows.slice(index + 1, lastRow + 1);
    const children = inside.filter((child) => child.depth === 1);
    // An entry said to be a book is one, whatever it is called and however few entries it holds.
    if (!row.book) {
      if (children.length < MIN_ENTRIES || isOutsideLabel(row.label)) {
        return;
      }
      if (isNumberedDivision(row.label) && !children.some((child) => isOwnFrontMatter(child.label))) {
        return;
      }
    }
    const spines = [row, ...inside].map((entry) => entry.spine).filter((spine): spine is number => typeof spine === "number");
    if (spines.length === 0) {
      return;
    }
    const first = Math.min(...spines);
    // It runs to the section before the next top-level entry that opens a later one.
    const next = tops.slice(at + 1).find((top) => typeof top.row.spine === "number" && top.row.spine > first);
    const last = Math.max(first, next ? (next.row.spine as number) - 1 : lastSection);
    if (prefix[last + 1] - prefix[first] < total * MIN_SHARE_NESTED) {
      return;
    }
    const story = storyOf(rows, index + 1, lastRow, prefix, first, last);
    found.push({ entry: index, firstRow: index, lastRow, label: row.label, first, last, storyLo: story.lo, storyHi: story.hi });
    if (row.book || children.some((child) => isBookMatter(child.label))) {
      proven += 1;
    }
  });
  // Named groups of chapters are books only when half of them or more show it: the parts of a novel have names too.
  return proven * 2 >= found.length ? found : [];
};

const flatBooks = (rows: readonly ContentsRow[], prefix: readonly number[], lastSection: number): InnerBook[] => {
  const total = prefix[prefix.length - 1];
  // Runs of front matter that hold a title page or a copyright page.
  const runs: { from: number; to: number }[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (!isOutsideLabel(rows[index].label)) {
      continue;
    }
    let to = index;
    while (to + 1 < rows.length && isOutsideLabel(rows[to + 1].label)) {
      to += 1;
    }
    if (to > index && rows.slice(index, to + 1).some((row) => isOwnFrontMatter(row.label))) {
      // A run can begin with the back matter of the book before (its
      // appendix, its acknowledgments): the book opens at its cover or title page.
      const opens = rows.slice(index, to + 1).findIndex((row) => /^(cover|title page|half title|frontispiece)\b/.test(tidy(row.label)));
      runs.push({ from: opens > 0 ? index + opens : index, to });
    }
    index = to;
  }
  const spineOf = (row: number) => rows[row]?.spine;
  const openings = runs
    .map((run, at) => {
      const named = run.from > 0 && !isOutsideLabel(rows[run.from - 1].label) && typeof spineOf(run.from - 1) === "number";
      const before = named ? (spineOf(run.from - 1) as number) : undefined;
      const runStart = rows.slice(run.from, run.to + 1).find((row) => typeof row.spine === "number")?.spine;
      // The entry before the run names the book when it opens the run's own first section, or a short one just before it.
      const title = named && typeof runStart === "number" && (before as number) <= runStart && prefix[runStart] - prefix[before as number] < total * 0.01;
      const firstRow = title ? run.from - 1 : run.from;
      const first = title ? (before as number) : runStart;
      const nextRun = runs[at + 1];
      return { run, firstRow, first, title, nextFrom: nextRun ? nextRun.from : rows.length };
    })
    .filter((opening): opening is typeof opening & { first: number } => typeof opening.first === "number");
  // A run opens a book when a real stretch of the file follows it before the next run.
  const real = openings.filter((opening, at) => {
    const nextFirst = openings[at + 1]?.first ?? lastSection + 1;
    return prefix[Math.max(nextFirst, opening.first)] - prefix[opening.first] >= total * MIN_SHARE_FLAT;
  });
  return real.map((opening, at) => {
    const next = real[at + 1];
    const lastRow = (next ? next.firstRow : rows.length) - 1;
    const last = Math.max(opening.first, (next ? next.first : lastSection + 1) - 1);
    const story = storyOf(rows, opening.firstRow, lastRow, prefix, opening.first, last);
    return {
      entry: opening.title ? opening.firstRow : -1,
      firstRow: opening.firstRow,
      lastRow,
      label: opening.title ? rows[opening.firstRow].label : `Book ${at + 1}`,
      first: opening.first,
      last,
      storyLo: story.lo,
      storyHi: story.hi
    };
  });
};

/**
 * The books inside a book, in reading order; empty for a single work.
 * `bytes` is each section's size (`SectionWeights.bytes`).
 */
export const findInnerBooks = (rows: readonly ContentsRow[], bytes: readonly number[]): InnerBook[] => {
  const prefix = prefixOf(bytes);
  const total = prefix[prefix.length - 1];
  if (rows.length === 0 || total <= 0) {
    return [];
  }
  const lastSection = bytes.length - 1;
  const together = (books: InnerBook[]) => books.reduce((sum, book) => sum + prefix[book.last + 1] - prefix[book.first], 0) >= total * MIN_TOGETHER;
  const inOrder = (books: InnerBook[]) => books.every((book, at) => at === 0 || book.first > books[at - 1].last);
  for (const books of [nestedBooks(rows, prefix, lastSection), flatBooks(rows, prefix, lastSection)]) {
    if (books.length >= 2 && together(books) && inOrder(books)) {
      return books;
    }
  }
  return [];
};

/** The book a section belongs to (its place in `books`), or -1: the set's own cover, its closing pages. */
export const bookOfSection = (books: readonly InnerBook[], section: number) => books.findIndex((book) => section >= book.first && section <= book.last);

/** The book a contents row belongs to, or -1. */
export const bookOfRow = (books: readonly InnerBook[], row: number) => books.findIndex((book) => row >= book.firstRow && row <= book.lastRow);

/** How a row of the chapter list reads: a book's own header, its front matter, a chapter of it, what follows its end, or an entry of the set outside every book. */
export type RowKind = "header" | "front" | "chapter" | "back" | "loose";

export type ListRow = { entry: number; kind: RowKind; book: number; depth: number };

/**
 * The chapter list of a set: every contents row with the book it is under
 * and how it reads. Front matter and what follows a book's end are set
 * quieter than its chapters, and the first row after the end is where the
 * list marks the end.
 */
export const listRows = (rows: readonly ContentsRow[], books: readonly InnerBook[]): ListRow[] =>
  rows.map((row, entry) => {
    const at = bookOfRow(books, entry);
    if (at < 0) {
      return { entry, kind: "loose" as RowKind, book: -1, depth: row.depth };
    }
    const book = books[at];
    const depth = Math.max(0, row.depth - (book.entry >= 0 ? rows[book.entry].depth + 1 : 0));
    if (entry === book.entry) {
      return { entry, kind: "header" as RowKind, book: at, depth: 0 };
    }
    const kind: RowKind = typeof row.spine !== "number" ? "chapter" : row.spine < book.storyLo ? "front" : row.spine > book.storyHi ? "back" : "chapter";
    return { entry, kind, book: at, depth };
  });

/** Where the reading is, as a section and how far through it. */
export type PlaceInSections = { section: number; within: number };

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** How far through a book's own story a place is: 0 before its first chapter, 1 after its last. */
export const fractionOfBook = (book: InnerBook, bytes: readonly number[], place: PlaceInSections) => {
  let before = 0;
  let total = 0;
  for (let index = book.storyLo; index <= book.storyHi; index += 1) {
    const size = Math.max(0, bytes[index] ?? 0);
    total += size;
    if (index < place.section) {
      before += size;
    } else if (index === place.section) {
      before += size * clamp01(place.within);
    }
  }
  return total > 0 ? clamp01(before / total) : place.section > book.storyHi ? 1 : 0;
};

/** A book's standing: read, being read (and how far), or not started. */
export type BookStanding = { state: "read" | "reading" | "unread"; fraction: number };

/** A book counts as read from here: its last line is a rounding away. */
const READ_AT = 0.995;

/**
 * How each book stands, given where the reading has got to (the place the
 * progress stands for, not a look elsewhere) and whether the whole set is
 * finished. The books before the one being read are read, the ones after
 * are not started.
 */
export const bookStandings = (books: readonly InnerBook[], bytes: readonly number[], place: PlaceInSections | null, finished = false): BookStanding[] =>
  books.map((book) => {
    if (finished) {
      return { state: "read", fraction: 1 };
    }
    if (!place || place.section < book.first) {
      return { state: "unread", fraction: 0 };
    }
    const fraction = fractionOfBook(book, bytes, place);
    if (place.section > book.storyHi || fraction >= READ_AT) {
      return { state: "read", fraction: 1 };
    }
    return { state: "reading", fraction };
  });

/**
 * The book whose story the reading has just read past: it was in that book's
 * last chapter (`from`) and is now beyond it (`to`), in its appendices or at
 * the opening of the next book. -1 otherwise: a jump from anywhere else, a
 * move within the story, a look back. For one quiet word that a novel of the
 * set is finished; the set itself is one book, finished at its last story's end.
 */
export const crossedStoryEnd = (books: readonly InnerBook[], from: number | null, to: number) =>
  books.findIndex((book, at) => {
    const next = books[at + 1];
    return from === book.storyHi && to > book.storyHi && to <= (next ? next.storyLo : book.last);
  });

/** "A Clash of Kings · Tyrion": a chapter's name with its book's, for the dock, a bookmark, a highlight. The book alone on its own cover. */
export const labelInBook = (bookLabel: string | null | undefined, chapterLabel: string) => {
  const book = (bookLabel ?? "").replace(/\s+/g, " ").trim();
  const chapter = chapterLabel.replace(/\s+/g, " ").trim();
  if (!book || book.toLowerCase() === chapter.toLowerCase()) {
    return chapter || book;
  }
  return chapter ? `${book} · ${chapter}` : book;
};

/**
 * Between two stories: a book's appendices and the next one's cover, title
 * page and maps (or the first book's front matter, or the last one's back
 * matter). `from..to` are its sections; `before` and `after` are the books
 * either side (-1 at the ends of the set).
 */
export type StoryGap = { from: number; to: number; before: number; after: number };

/** The stretches between the stories of a set, in order. */
export const storyGaps = (books: readonly InnerBook[], lastSection: number): StoryGap[] => {
  const gaps: StoryGap[] = [];
  books.forEach((book, at) => {
    const from = at === 0 ? 0 : books[at - 1].storyHi + 1;
    if (book.storyLo - 1 >= from) {
      gaps.push({ from, to: book.storyLo - 1, before: at - 1, after: at });
    }
  });
  const lastBook = books[books.length - 1];
  if (lastBook && lastBook.storyHi < lastSection) {
    gaps.push({ from: lastBook.storyHi + 1, to: lastSection, before: books.length - 1, after: -1 });
  }
  return gaps;
};

/** Progress this close to a gap's edges counts as having read up to it. */
const AT_A_GAP = 0.0025;

/**
 * Whether the saved place and the progress follow the reader into a stretch
 * between two stories. They do when that is where the reading has got to
 * (the progress stands at the gap's edge or inside it: the book before was
 * just finished, or the next is about to begin) and not when it is a look
 * from elsewhere: the third novel's map opened from its fortieth chapter must
 * not become the place to come back to, as a single novel's map must not.
 *
 * `known` is the progress so far; `start` and `end` are the gap's edges as
 * fractions of the set's story.
 */
export const gapFollows = (known: number, start: number, end: number) => {
  const progress = Number.isFinite(known) ? known : 0;
  return progress >= start - AT_A_GAP && progress <= end + AT_A_GAP;
};
