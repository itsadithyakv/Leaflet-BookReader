import type { Book } from "@shared/models/book";
import type { Annotation } from "../../services/annotationService";
import { compareKindlePlaces, isKindlePlace } from "../../library/kindleClippings";

/** Compares two places in a book (epub.js's `EpubCFI.compare`); may throw on a CFI it cannot read. */
export type CfiCompare = (a: string, b: string) => number;

const byMade = (a: Annotation, b: Annotation) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Highlights in reading order, as the reader lists them. One whose place
 * cannot be read (comparing it throws, even with itself) has no place among
 * the others: settled pair by pair by which was made first, it left the order
 * to how the list happened to arrive. Those come last, oldest first.
 */
export const orderHighlights = (highlights: Annotation[], compare: CfiCompare) => {
  const placed: Annotation[] = [];
  const unplaced: Annotation[] = [];
  // Brought from a Kindle (library/kindleClippings.ts): no place in this
  // book's file, so after those that have one, in the Kindle's own order.
  const kindle: Annotation[] = [];
  for (const item of highlights) {
    if (isKindlePlace(item.cfi)) {
      kindle.push(item);
      continue;
    }
    try {
      compare(item.cfi, item.cfi);
      placed.push(item);
    } catch {
      unplaced.push(item);
    }
  }
  placed.sort((a, b) => {
    try {
      return compare(a.cfi, b.cfi) || byMade(a, b);
    } catch {
      return byMade(a, b);
    }
  });
  kindle.sort((a, b) => compareKindlePlaces(a.cfi, b.cfi) || byMade(a, b));
  return [...placed, ...kindle, ...unplaced.sort(byMade)];
};

export type ChapterGroup = {
  /** The chapter's name; in a set of books, without its book's ("Tyrion", under `book`). */
  chapter: string | null;
  items: Annotation[];
  /** The book of a set this chapter is in, when the highlights show there is one; and whether this group is the first under it. */
  book?: string | null;
  opensBook?: boolean;
};

/** The section of the book (its place in the reading order, from 0) a CFI is in; null when it cannot be read from it. */
export const sectionOfCfi = (cfi: string | null | undefined): number | null => {
  const step = /^epubcfi\(\/6\/(\d+)/.exec(cfi ?? "");
  const number = step ? Number(step[1]) : Number.NaN;
  return Number.isFinite(number) && number >= 2 && number % 2 === 0 ? number / 2 - 1 : null;
};

/** How a chapter's name is joined to its book's in a set (readers/innerBooks.ts: labelInBook). */
const IN_BOOK = " · ";

/**
 * Highlights (already in order) under their chapters. A highlight with no
 * label stays with the chapter before it, which is where the Markdown export
 * puts it too, so the list and the copy read the same. Labels are compared
 * as they read: one saved with a line break or a stray space in it (a
 * contents entry kept as the book wrote it) is the same chapter, and one of
 * only spaces is no label.
 *
 * A chapter is a place, not a name. A novel told by its characters has
 * thirty-five chapters called "Tyrion", and a highlight in each of two of
 * them, with none between, stood under one heading. Two neighbours of the
 * same name are one chapter when they are in the same section of the book or
 * in the next one (a chapter may run over two files); further apart they are
 * two chapters that share a name, each with its own heading.
 *
 * In a set of books the label carries the book ("A Clash of Kings · Tyrion").
 * When the highlights show that (two chapters of different names under one
 * book's name), the book is named once, above its chapters.
 */
export const groupByChapter = (highlights: Annotation[]): ChapterGroup[] => {
  const groups: Array<ChapterGroup & { label: string | null; section: number | null }> = [];
  for (const item of highlights) {
    const label = item.chapter?.replace(/\s+/g, " ").trim() || null;
    const section = sectionOfCfi(item.cfi);
    const last = groups[groups.length - 1];
    const sameName = last && (!label || label === last.label);
    const samePlace = !last || last.section === null || section === null || !label || Math.abs(section - last.section) <= 1;
    if (last && sameName && samePlace) {
      last.items.push(item);
      last.section = section ?? last.section;
    } else {
      groups.push({ chapter: label, label, section, items: [item] });
    }
  }
  // The books of a set: a name that stands before two or more different chapter names.
  const under = new Map<string, Set<string>>();
  for (const group of groups) {
    const at = group.label?.indexOf(IN_BOOK) ?? -1;
    if (group.label && at > 0) {
      const book = group.label.slice(0, at);
      under.set(book, (under.get(book) ?? new Set()).add(group.label.slice(at + IN_BOOK.length)));
    }
  }
  // Once one book shows itself, the file is a set, and a book with a single chapter highlighted is a book too.
  const isSet = [...under.values()].some((chapters) => chapters.size >= 2);
  let current: string | null = null;
  return groups.map(({ label, section: _section, ...group }) => {
    const at = label?.indexOf(IN_BOOK) ?? -1;
    const book = label && at > 0 && isSet ? label.slice(0, at) : null;
    const opensBook = book !== null && book !== current;
    current = book;
    return book && label ? { ...group, chapter: label.slice(at + IN_BOOK.length), book, opensBook } : group;
  });
};

export type BookHighlights = { book: Book; count: number };

/**
 * The library's books that have highlights, the most recently read first.
 * Counts for books no longer in the library are left out.
 */
export const booksWithHighlights = (books: Book[], counts: Record<string, number>): BookHighlights[] =>
  books
    .filter((book) => (counts[book.id] ?? 0) > 0)
    .map((book) => ({ book, count: counts[book.id] }))
    .sort(
      (a, b) =>
        (b.book.lastOpened ?? "").localeCompare(a.book.lastOpened ?? "") ||
        a.book.title.localeCompare(b.book.title, undefined, { numeric: true, sensitivity: "base" })
    );

export const countLabel = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;
