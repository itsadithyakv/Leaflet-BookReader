/**
 * The book's own text, a chapter at a time, for finding where a name was
 * mentioned (`mentions.ts`).
 *
 * A chapter is read only when asked for, and only chapters up to the one
 * being read are ever asked for. Its text is kept (a novel is a megabyte or
 * two), so the second question about a book is answered from memory; nothing
 * is kept of its document. `clear()` when the book closes.
 */
import { EpubCFI } from "epubjs";
import { mentionsIn, mentionsUpTo, type Here, type MentionSummary, type RawMention, type SectionMentions } from "./mentions";
import type { Place } from "./model";
import { isCommonWord } from "../../services/smartReadService";
import { nameMatcher, type NameEntry } from "./names";
import { nameCounter, type NameCounter, type NameSuggestion } from "./suggest";
import { statOf, termSummary, type SectionStat, type TermSummary } from "./terms";

/** A document's text nodes in reading order, as one string. */
export type TextIndex = { text: string; nodes: Text[]; starts: number[] };

const BLOCKS = new Set(
  "address article aside blockquote body caption dd details div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tbody td tfoot th thead tr ul".split(
    " "
  )
);
const SKIPPED = new Set(["script", "style", "head", "title", "noscript", "template", "rt", "rp", "svg", "math"]);

/**
 * The text under `root` with where each node starts in it. Between two blocks
 * (and at a line break) the string has a newline no node owns, so the last
 * word of one paragraph and the first of the next are two words.
 *
 * The same walk for a chapter read from the file and for one on the page, so
 * an offset in one is the same place in the other.
 */
export const indexText = (root: Node): TextIndex => {
  const doc = root.ownerDocument ?? (root as Document);
  const nodes: Text[] = [];
  const starts: number[] = [];
  const parts: string[] = [];
  let length = 0;
  let lastBlock: Node | null = null;
  let broken = false;
  // 1 | 4: elements (for line breaks) and text.
  const walker = doc.createTreeWalker(root, 5);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === 1) {
      const tag = (node as Element).localName;
      if (SKIPPED.has(tag)) {
        // Past this element and everything in it.
        let next: Node | null = walker.nextSibling();
        while (!next && walker.parentNode()) {
          next = walker.nextSibling();
        }
        node = next;
        continue;
      }
      if (tag === "br") {
        broken = true;
      }
    } else {
      let block: Node | null = node.parentNode;
      while (block && block !== root && !(block.nodeType === 1 && BLOCKS.has((block as Element).localName))) {
        block = block.parentNode;
      }
      if (length > 0 && (broken || block !== lastBlock)) {
        parts.push("\n");
        length += 1;
      }
      broken = false;
      lastBlock = block;
      const value = (node as Text).data;
      nodes.push(node as Text);
      starts.push(length);
      parts.push(value);
      length += value.length;
    }
    node = walker.nextNode();
  }
  return { text: parts.join(""), nodes, starts };
};

/** The node an offset of the text falls in, and how far into it. */
export const nodeAt = (index: TextIndex, offset: number): { node: Text; offset: number } | null => {
  let low = 0;
  let high = index.nodes.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (index.starts[mid] <= offset) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (found < 0) {
    return null;
  }
  const node = index.nodes[found];
  return { node, offset: Math.min(node.data.length, offset - index.starts[found]) };
};

/** A range over `start..end` of the text, or null when it is not all there. */
export const rangeOf = (index: TextIndex, start: number, end: number): Range | null => {
  const from = nodeAt(index, start);
  // The end belongs to the node the last character is in.
  const to = nodeAt(index, Math.max(start, end - 1));
  const doc = from?.node.ownerDocument;
  if (!from || !to || !doc) {
    return null;
  }
  try {
    const range = doc.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, Math.min(to.node.data.length, to.offset + (end > start ? 1 : 0)));
    return range;
  } catch {
    return null;
  }
};

/** How much of the text is at or before a point in its document. */
export const offsetOf = (index: TextIndex, container: Node, offset: number): number | null => {
  const at = index.nodes.indexOf(container as Text);
  if (at >= 0) {
    return index.starts[at] + Math.min(offset, index.nodes[at].data.length);
  }
  // A point between elements: everything in the nodes that come before it.
  try {
    const doc = container.ownerDocument;
    if (!doc) {
      return null;
    }
    const point = doc.createRange();
    point.setStart(container, offset);
    point.collapse(true);
    let low = 0;
    let high = index.nodes.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (point.comparePoint(index.nodes[mid], 0) < 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low < index.nodes.length ? index.starts[low] : index.text.length;
  } catch {
    return null;
  }
};

// epub.js has no types for these internals.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** The chapter (spine index) a CFI is in. */
export const sectionOfCfi = (cfi: string | null | undefined): number | null => {
  if (!cfi) {
    return null;
  }
  try {
    const at = (new EpubCFI(cfi) as any).spinePos;
    return typeof at === "number" && at >= 0 ? at : null;
  } catch {
    return null;
  }
};

export type MentionSearch = {
  /**
   * Where the names were mentioned up to `place`. `onProgress` is given what
   * has been found so far, the chapters nearest the place first (the count and
   * the first appearance are only settled when the promise resolves). Null
   * when the place cannot be told.
   */
  find: (
    names: NameEntry[],
    person: string | null,
    place: Place,
    options: { signal: AbortSignal; keep?: number; onProgress?: (soFar: MentionSummary) => void }
  ) => Promise<MentionSummary | null>;
  /**
   * "People so far": the names the book has kept using up to `place`, less
   * the ones in `known`. Counted a chapter at a time and kept, so asking again
   * at the same place costs nothing. Null when the place cannot be told.
   */
  namesSoFar: (place: Place, known: NameEntry[], options: { signal: AbortSignal; limit?: number }) => Promise<NameSuggestion[] | null>;
  /**
   * What the book has said of a name up to `place` (`terms.ts`): how often,
   * where first, and the line that best says what it is. `small` is the name
   * as one lower-case word, when it is one and nobody has vouched for it: a
   * word the book also writes small is no name. Null when the place cannot
   * be told.
   */
  about: (
    names: NameEntry[],
    person: string | null,
    place: Place,
    options: { signal: AbortSignal; small?: string | null }
  ) => Promise<TermSummary | null>;
  /**
   * The book's words just before `place`, at least `chars` of them where the
   * book has that many: the end of the chapter being read up to the place,
   * with the end of the chapters before it when that is short. For "where
   * was I?" (readers/recap). Null when the place cannot be told.
   */
  before: (place: Place, options: { signal: AbortSignal; chars: number }) => Promise<string | null>;
  /** The names the book has used most in the stretch just before `place` (as `namesSoFar`, over `before`). */
  recentNames: (place: Place, options: { signal: AbortSignal; chars: number; limit?: number }) => Promise<NameSuggestion[] | null>;
  /** The exact place of a mention found, for jumping to it. */
  cfiOf: (mention: { section: number; start: number; end: number }) => Promise<string | null>;
  clear: () => void;
};

/** How many different sets of names keep their findings (a card each). */
const KEPT_QUERIES = 24;
/** Chapters are searched in slices no longer than this, so the page stays lively. */
const SLICE_MS = 8;

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * `passOver` names sections that are not read for mentions at all: a
 * contents page (readers/people/mentions.ts: isContentsPage).
 */
export const mentionSearch = (book: any, passOver: (section: number) => boolean = () => false): MentionSearch => {
  const texts = new Map<number, string>();
  const found = new Map<string, Map<number, RawMention[]>>();
  /** What whole chapters say of a name, by the name asked about (see `about`). */
  const told = new Map<string, Map<number, SectionStat>>();
  let counted: { key: string; counter: NameCounter } | null = null;

  const load = async (section: number): Promise<{ index: TextIndex; item: any } | null> => {
    const item = book?.spine?.spineItems?.[section];
    if (!item) {
      return null;
    }
    try {
      // Read from the file, not through the section: the page being shown is
      // made from the section's own copy, which is left alone.
      const doc: Document = await book.load(item.url);
      const root = doc?.body ?? doc?.querySelector?.("body") ?? doc?.documentElement;
      if (!root) {
        return null;
      }
      const index = indexText(root);
      texts.set(section, index.text);
      return { index, item };
    } catch {
      return null;
    }
  };

  const textOf = async (section: number) => (passOver(section) ? "" : (texts.get(section) ?? (await load(section))?.index.text ?? ""));

  /** The place, as a chapter and how much of its text is at or before it. */
  const hereOf = async (place: Place): Promise<Here | null> => {
    const section = sectionOfCfi(place.cfi);
    if (section === null) {
      return null;
    }
    const loaded = await load(section);
    let offset: number | null = null;
    if (loaded) {
      try {
        const range: Range | null = (new EpubCFI(place.cfi as string) as any).toRange(loaded.index.nodes[0]?.ownerDocument);
        offset = range ? offsetOf(loaded.index, range.startContainer, range.startOffset) : null;
      } catch {
        offset = null;
      }
    }
    return { section, offset };
  };

  const before = async (place: Place, { signal, chars }: { signal: AbortSignal; chars: number }): Promise<string | null> => {
    const here = await hereOf(place);
    if (!here || here.offset === null || signal.aborted) {
      return null;
    }
    let text = (await textOf(here.section)).slice(0, here.offset);
    // The place is near the top of its chapter: the chapter before ends just above it.
    for (let section = here.section - 1; section >= 0 && text.length < chars; section -= 1) {
      if (signal.aborted) {
        return null;
      }
      const earlier = await textOf(section);
      if (earlier.trim()) {
        text = `${earlier}\n${text}`;
      }
    }
    return signal.aborted ? null : text.slice(-chars);
  };

  return {
    before,

    recentNames: async (place, { signal, chars, limit = 8 }) => {
      const text = await before(place, { signal, chars });
      if (text === null) {
        return null;
      }
      const counter = nameCounter(isCommonWord);
      counter.add(text);
      return counter.result([], limit);
    },

    find: async (names, person, place, { signal, keep = 3, onProgress }) => {
      const here = await hereOf(place);
      if (!here || signal.aborted) {
        return null;
      }
      const key = `${person ?? ""}|${names.map((name) => `${name.exact ? "=" : "~"}${name.text}>${name.person}`).sort().join("|")}`;
      let kept = found.get(key);
      if (!kept) {
        kept = new Map();
        found.set(key, kept);
        if (found.size > KEPT_QUERIES) {
          found.delete(found.keys().next().value as string);
        }
      }
      const matcher = nameMatcher(names);
      const sections: SectionMentions[] = [];
      let sliceStart = performance.now();
      // From the chapter being read backwards: the latest mentions come first.
      for (let section = here.section; section >= 0; section -= 1) {
        if (signal.aborted) {
          return null;
        }
        let hits = kept.get(section);
        if (!hits) {
          const loaded = !texts.has(section);
          hits = mentionsIn(await textOf(section), matcher, person);
          kept.set(section, hits);
          if (loaded || performance.now() - sliceStart > SLICE_MS) {
            await pause();
            sliceStart = performance.now();
          }
        }
        sections.push({ section, hits });
        if (hits.length > 0 && section > 0) {
          onProgress?.(mentionsUpTo(sections, here, keep));
        }
      }
      return signal.aborted ? null : mentionsUpTo(sections, here, keep);
    },

    namesSoFar: async (place, known, { signal, limit }) => {
      const here = await hereOf(place);
      if (!here || signal.aborted) {
        return null;
      }
      const key = `${here.section}:${here.offset}`;
      if (counted?.key !== key) {
        const counter = nameCounter(isCommonWord);
        let sliceStart = performance.now();
        for (let section = 0; section <= here.section; section += 1) {
          if (signal.aborted) {
            return null;
          }
          const loaded = !texts.has(section);
          const text = await textOf(section);
          if (section < here.section) {
            counter.add(text);
          } else if (here.offset !== null) {
            // The chapter being read: only as far as the place.
            counter.add(text.slice(0, here.offset));
          }
          if (loaded || performance.now() - sliceStart > SLICE_MS) {
            await pause();
            sliceStart = performance.now();
          }
        }
        counted = { key, counter };
      }
      return signal.aborted ? null : counted.counter.result(known, limit);
    },

    about: async (names, person, place, { signal, small = null }) => {
      const here = await hereOf(place);
      if (!here || signal.aborted) {
        return null;
      }
      const key = `${person ?? ""}|${small ?? ""}|${names.map((name) => `${name.exact ? "=" : "~"}${name.text}>${name.person}`).sort().join("|")}`;
      let kept = told.get(key);
      if (!kept) {
        kept = new Map();
        told.set(key, kept);
        if (told.size > KEPT_QUERIES * 2) {
          told.delete(told.keys().next().value as string);
        }
      }
      const matcher = nameMatcher(names);
      const stats: SectionStat[] = [];
      let sliceStart = performance.now();
      for (let section = 0; section <= here.section; section += 1) {
        if (signal.aborted) {
          return null;
        }
        const loaded = !texts.has(section);
        if (section < here.section) {
          let stat = kept.get(section);
          if (!stat) {
            stat = statOf(section, await textOf(section), matcher, person, small);
            kept.set(section, stat);
          }
          stats.push(stat);
        } else if (here.offset !== null) {
          // The chapter being read: only as far as the place, and not kept (the place moves).
          stats.push(statOf(section, (await textOf(section)).slice(0, here.offset), matcher, person, small));
        }
        if (loaded || performance.now() - sliceStart > SLICE_MS) {
          await pause();
          sliceStart = performance.now();
        }
      }
      return signal.aborted ? null : termSummary(stats);
    },

    cfiOf: async ({ section, start, end }) => {
      const loaded = await load(section);
      const range = loaded ? rangeOf(loaded.index, start, end) : null;
      if (!loaded || !range) {
        return null;
      }
      try {
        return loaded.item.cfiFromRange(range) as string;
      } catch {
        return null;
      }
    },

    clear: () => {
      texts.clear();
      found.clear();
      told.clear();
      counted = null;
    }
  };
};
