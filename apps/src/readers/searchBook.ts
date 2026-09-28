/**
 * Search inside an EPUB: every section, in reading order, for the words typed.
 *
 * Each section is loaded, searched (epub.js `find`, case-insensitive) and
 * unloaded again, one at a time, yielding between sections so the page stays
 * responsive in a long book. Stops early when cancelled or at `limit` hits.
 */

export type SearchHit = {
  cfi: string;
  excerpt: string;
  /** The section (spine index) it is in. */
  section: number;
};

type SearchOptions = {
  signal: AbortSignal;
  limit?: number;
  onProgress?: (fraction: number, hits: SearchHit[]) => void;
};

/** The shortest query worth searching a whole book for. */
export const MIN_QUERY = 2;

// epub.js has no types for these internals.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const searchBook = async (book: any, query: string, { signal, limit = 200, onProgress }: SearchOptions) => {
  const words = query.trim();
  const hits: SearchHit[] = [];
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
      const found: Array<{ cfi: string; excerpt: string }> = section.find(words) ?? [];
      for (const hit of found) {
        hits.push({ cfi: hit.cfi, excerpt: hit.excerpt.replace(/\s+/g, " ").trim(), section: index });
        if (hits.length >= limit) {
          break;
        }
      }
    } catch {
      // A section that will not load is skipped; the rest are still searched.
    } finally {
      section.unload?.();
    }
    onProgress?.((index + 1) / sections.length, hits);
    if (hits.length >= limit) {
      break;
    }
    // Let the page breathe between sections.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return hits;
};
