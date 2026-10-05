/**
 * Search inside an EPUB: every section, in reading order, for the words typed.
 *
 * Each section is loaded, searched (epub.js `find`, case-insensitive) and
 * unloaded again, one at a time, yielding between sections so the page stays
 * responsive in a long book. Stops early when cancelled.
 *
 * Every match is counted; only the first few of each section are kept to
 * show (`perSection`). It used to keep the first 200 matches and stop: in a
 * set of four novels a name was found 200 times in the first eight chapters
 * of the first one, and nowhere a reader of the third could use. Kept by
 * section, the results reach the end of the book however common the word.
 */

import { findInSection } from "./searchFold";

export type SearchHit = {
  cfi: string;
  excerpt: string;
  /** The section (spine index) it is in. */
  section: number;
};

type SearchOptions = {
  signal: AbortSignal;
  /** The most matches kept to show, over the whole book. */
  limit?: number;
  /** The most matches kept from one section; the rest of it are counted. */
  perSection?: number;
  /** `counts` is every match found so far, kept or not, by section. */
  onProgress?: (fraction: number, hits: SearchHit[], counts: ReadonlyMap<number, number>) => void;
};

/** The shortest query worth searching a whole book for. */
export const MIN_QUERY = 2;

/** How many of a section's matches to keep: all of them up to `perSection`, while there is room under `limit`. */
export const keepFrom = (found: number, kept: number, perSection: number, limit: number) => Math.max(0, Math.min(found, perSection, limit - kept));

/** Matches found in all, and in how many sections. */
export const tally = (counts: ReadonlyMap<number, number>) => {
  let matches = 0;
  counts.forEach((count) => {
    matches += count;
  });
  return { matches, sections: counts.size };
};

/** The matches of one book of a set (or of a stretch outside every book: `book` is -1), in reading order. */
export type BookMatches = { book: number; matches: number; hits: { hit: SearchHit; index: number }[] };

/**
 * A set's results by the book they are in (readers/innerBooks.ts), so five
 * hundred rows can be folded to four headers with a count each. `bookOf`
 * gives a section's book (-1 outside every book: the set's own pages, which
 * come before the first book and after the last, each a group of its own).
 * `index` is the hit's place in `hits`.
 */
export const groupByBook = (hits: readonly SearchHit[], counts: ReadonlyMap<number, number>, bookOf: (section: number) => number): BookMatches[] => {
  const groups: BookMatches[] = [];
  const ofSection = new Map<number, BookMatches>();
  [...new Set([...counts.keys(), ...hits.map((hit) => hit.section)])]
    .sort((a, b) => a - b)
    .forEach((section) => {
      const book = bookOf(section);
      let group = groups[groups.length - 1];
      if (!group || group.book !== book) {
        group = { book, matches: 0, hits: [] };
        groups.push(group);
      }
      group.matches += counts.get(section) ?? 0;
      ofSection.set(section, group);
    });
  hits.forEach((hit, index) => ofSection.get(hit.section)?.hits.push({ hit, index }));
  return groups;
};

/** With more rows than this, a set's results open with only the book being read unfolded. */
export const FOLD_BOOKS_OVER = 40;

// epub.js has no types for these internals.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const searchBook = async (book: any, query: string, { signal, limit = 200, perSection = Number.POSITIVE_INFINITY, onProgress }: SearchOptions) => {
  const words = query.trim();
  const hits: SearchHit[] = [];
  const counts = new Map<number, number>();
  const sections: any[] = book?.spine?.spineItems ?? [];
  if (words.length < MIN_QUERY || sections.length === 0) {
    return hits;
  }
  for (let index = 0; index < sections.length; index += 1) {
    if (signal.aborted) {
      break;
    }
    const section = sections[index];
    try {
      await section.load(book.load.bind(book));
      // (Not epub.js's own `find`: words typed without their accents are found too. readers/searchFold.ts)
      const found: Array<{ cfi: string; excerpt: string }> = findInSection(section, words);
      if (found.length > 0) {
        counts.set(index, found.length);
      }
      for (const hit of found.slice(0, keepFrom(found.length, hits.length, perSection, limit))) {
        hits.push({ cfi: hit.cfi, excerpt: hit.excerpt.replace(/\s+/g, " ").trim(), section: index });
      }
    } catch {
      // A section that will not load is skipped; the rest are still searched.
    } finally {
      section.unload?.();
    }
    onProgress?.((index + 1) / sections.length, hits, counts);
    // With no cap on a section the search is over once the list is full, as it always was.
    if (hits.length >= limit && !Number.isFinite(perSection)) {
      break;
    }
    // Let the page breathe between sections.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return hits;
};
