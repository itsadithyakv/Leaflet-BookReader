import type { Book } from "@shared/models/book";
import type { Annotation } from "../../services/annotationService";

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
  for (const item of highlights) {
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
  return [...placed, ...unplaced.sort(byMade)];
};

export type ChapterGroup = { chapter: string | null; items: Annotation[] };

/**
 * Highlights (already in order) under their chapter labels. A highlight with
 * no label stays with the chapter before it, which is where the Markdown
 * export puts it too, so the list and the copy read the same. Labels are
 * compared as they read: one saved with a line break or a stray space in it
 * (a contents entry kept as the book wrote it) is the same chapter, and one
 * of only spaces is no label.
 */
export const groupByChapter = (highlights: Annotation[]): ChapterGroup[] => {
  const groups: ChapterGroup[] = [];
  for (const item of highlights) {
    const chapter = item.chapter?.replace(/\s+/g, " ").trim() || null;
    const last = groups[groups.length - 1];
    if (last && (!chapter || chapter === last.chapter)) {
      last.items.push(item);
    } else {
      groups.push({ chapter, items: [item] });
    }
  }
  return groups;
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
