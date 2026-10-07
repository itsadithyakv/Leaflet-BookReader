/**
 * A book opened at a match of the library's search ("Search inside books"):
 * the place is the section the words are in, which of its matches was
 * picked, and the words themselves, and the reader finds them again once the
 * book is open. A CFI cannot be had without the book open in epub.js, and the
 * library searches the files without it (src-tauri/src/search.rs).
 *
 * The words are looked for the way the library looked for them: in the
 * section's text as it reads on the page (scripts, styles and the head left
 * out, white space run together, a paragraph's end parting two words) and
 * through the in-book search's own matching (readers/searchFold.ts). The two
 * have to change together, or the third match there is not the third here.
 */

import { findFolded } from "./searchFold";

export type FindPlace = {
  /** The section's href, as the book's manifest writes it (what epub.js calls it). */
  href: string;
  /** The section's place in the spine, for a book whose href epub.js names differently. */
  spine: number;
  /** Which of the section's matches, from 0. */
  nth: number;
  query: string;
};

/** Starts no CFI ("epubcfi(") and no PDF place ("pdf:"), so neither reader takes it for one of its own. */
const PREFIX = "find:";

export const isFindPlace = (place: string | null | undefined): place is string => typeof place === "string" && place.startsWith(PREFIX);

/** `find:<spine>:<nth>:<href>`, then the words on a line of their own: an href can hold anything but a line break. */
export const encodeFindPlace = ({ href, spine, nth, query }: FindPlace): string =>
  `${PREFIX}${Math.max(0, Math.trunc(spine) || 0)}:${Math.max(0, Math.trunc(nth) || 0)}:${href.replace(/[\r\n]/g, "")}\n${query.replace(/[\r\n]+/g, " ")}`;

export const decodeFindPlace = (place: string | null | undefined): FindPlace | null => {
  if (!isFindPlace(place)) {
    return null;
  }
  const parts = /^(\d{1,9}):(\d{1,9}):([^\n]+)\n([^]*)$/.exec(place.slice(PREFIX.length));
  if (!parts) {
    return null;
  }
  const query = normalQuery(parts[4]);
  return query ? { href: parts[3], spine: Number(parts[1]), nth: Number(parts[2]), query } : null;
};

/** White space as the library's search counts it (a browser's, and U+0085). */
const SPACE = /[\s\u0085]/;
const NOT_SPACE = /[^\s\u0085]/;

/** The words with their spaces as the text has them: none at the ends, one between. */
export const normalQuery = (query: string) => query.replace(/[\s\u0085]+/g, " ").trim();

/** Elements whose text is not the book's. */
const UNREAD = new Set(["script", "style", "head"]);

/** Elements that start a line of their own: the words either side of one are two words. */
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "body", "br", "caption", "center", "dd", "details", "dialog", "dir",
  "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hgroup", "hr", "html", "li", "main", "menu", "nav", "ol", "p", "pre", "section", "summary", "table",
  "tbody", "td", "tfoot", "th", "thead", "tr", "ul"
]);

/** As much of a DOM node as is read here, so the walk can be tried without a browser. */
export type TextTreeNode = {
  nodeType: number;
  localName?: string | null;
  nodeName?: string;
  data?: string;
  firstChild?: TextTreeNode | null;
  nextSibling?: TextTreeNode | null;
};

/**
 * A section's text in reading order: each text node's text, and `null`
 * wherever a block starts or ends. `nodes` are the text nodes themselves, in
 * step with `pieces`.
 */
export const sectionPieces = (root: TextTreeNode): { pieces: (string | null)[]; nodes: (TextTreeNode | null)[] } => {
  const pieces: (string | null)[] = [];
  const nodes: (TextTreeNode | null)[] = [];
  const part = () => {
    pieces.push(null);
    nodes.push(null);
  };
  const walk = (parent: TextTreeNode) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      // Text, and a CDATA section, which is text too.
      if (child.nodeType === 3 || child.nodeType === 4) {
        pieces.push(child.data ?? "");
        nodes.push(child);
      } else if (child.nodeType === 1) {
        const name = (child.localName ?? child.nodeName ?? "").replace(/^.*:/, "").toLowerCase();
        if (UNREAD.has(name)) {
          continue;
        }
        const block = BLOCK.has(name);
        if (block) {
          part();
        }
        walk(child);
        if (block) {
          part();
        }
      }
    }
  };
  walk(root);
  return { pieces, nodes };
};

/**
 * The pieces as one line, every run of white space (and every parting of two
 * blocks) one space, and where each of its characters came from: `piece[i]`
 * and `offset[i]` are the piece and the place in it of the character at `i`.
 */
export const flattenPieces = (pieces: readonly (string | null)[]) => {
  let text = "";
  const piece: number[] = [];
  const offset: number[] = [];
  let gap = false;
  pieces.forEach((words, at) => {
    if (words === null) {
      gap = true;
      return;
    }
    for (let index = 0; index < words.length; index += 1) {
      const char = words[index];
      if (SPACE.test(char)) {
        gap = true;
        continue;
      }
      if (gap && text) {
        text += " ";
        piece.push(at);
        offset.push(index);
      }
      gap = false;
      text += char;
      piece.push(at);
      offset.push(index);
    }
  });
  return { text, piece, offset };
};

/**
 * Where the words are in a section's pieces, each match as the piece and
 * place of its first character and of the end of its last. Counted as the
 * library counts them, so the nth here is the nth there.
 */
export const findInPieces = (pieces: readonly (string | null)[], query: string) => {
  const flat = flattenPieces(pieces);
  const words = normalQuery(query);
  // (A match begins and ends on a character of the words, never on a space, so both ends have a place of their own.)
  return findFolded(flat.text, words).map(([start, end]) => ({
    start: { piece: flat.piece[start], offset: flat.offset[start] },
    end: { piece: flat.piece[end - 1], offset: flat.offset[end - 1] + 1 }
  }));
};

/** The match to go to: the one picked or, when the book has fewer than the library counted, the first. */
export const pickMatch = <T>(matches: readonly T[], nth: number): T | null => matches[nth] ?? matches[0] ?? null;

// epub.js has no types for these internals.
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Where a match of the library's search is in the open book, as a CFI the
 * reader can go to and mark. `found` is false when the section is there but
 * the words are not (the file was changed since, or is read differently by
 * the browser): the CFI is then the section's start. Null when the book has
 * no such section.
 */
export const findInBook = async (book: any, place: FindPlace): Promise<{ cfi: string; found: boolean } | null> => {
  const section = book?.spine?.get?.(place.href) ?? book?.spine?.get?.(place.spine);
  if (!section || typeof section.load !== "function") {
    return null;
  }
  try {
    await section.load(book.load.bind(book));
    const doc: Document | undefined = section.document;
    const root = doc?.documentElement;
    if (!doc || !root) {
      return null;
    }
    const { pieces, nodes } = sectionPieces(root as unknown as TextTreeNode);
    const match = pickMatch(findInPieces(pieces, place.query), place.nth);
    const from = match ? nodes[match.start.piece] : null;
    const to = match ? nodes[match.end.piece] : null;
    if (match && from && to) {
      const range = doc.createRange();
      range.setStart(from as unknown as Node, match.start.offset);
      range.setEnd(to as unknown as Node, match.end.offset);
      return { cfi: section.cfiFromRange(range), found: true };
    }
    // The section's first word, as a saved place is a word; a section with
    // no words at all (a picture) is its body.
    const first = pieces.findIndex((piece) => piece !== null && NOT_SPACE.test(piece));
    const node = nodes[first];
    if (node) {
      const range = doc.createRange();
      range.setStart(node as unknown as Node, (pieces[first] ?? "").search(NOT_SPACE));
      range.collapse(true);
      return { cfi: section.cfiFromRange(range), found: false };
    }
    return { cfi: section.cfiFromElement(doc.body ?? root), found: false };
  } catch {
    return null;
  } finally {
    section.unload?.();
  }
};
