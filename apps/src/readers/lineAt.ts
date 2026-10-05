/**
 * The reading line in a chapter's own document, as a place (a CFI): the DOM
 * side of `firstAtLine` (readers/readingPlace.ts), which says why epub.js's
 * own answer will not do.
 */

import { EpubCFI } from "epubjs";
import { firstAtLine, type LinePiece } from "./readingPlace";

type Piece = LinePiece & { node: Node; wordStart: (word: number) => number };

/** epub.js makes a CFI from a node or a range under a chapter's base; its types only know the string form. */
const CfiFrom = EpubCFI as unknown as new (from: Node | Range, base: string) => { toString(): string };

const PICTURES = new Set(["img", "svg", "image"]);

/** A text node as a piece: its words, each measured only when asked for. */
const textPiece = (node: Text): Piece | null => {
  const doc = node.ownerDocument;
  const starts: number[] = [];
  const ends: number[] = [];
  for (const match of node.data.matchAll(/\S+/g)) {
    starts.push(match.index ?? 0);
    ends.push((match.index ?? 0) + match[0].length);
  }
  if (starts.length === 0) {
    return null;
  }
  const whole = doc.createRange();
  whole.selectNodeContents(node);
  const bounds = whole.getBoundingClientRect();
  return {
    node,
    box: bounds.width || bounds.height ? { top: bounds.top, bottom: bounds.bottom } : null,
    words: starts.length,
    wordTop: (word) => {
      const range = doc.createRange();
      range.setStart(node, starts[word]);
      range.setEnd(node, ends[word]);
      const rect = range.getClientRects()[0];
      return rect ? rect.top : null;
    },
    wordStart: (word) => starts[word]
  };
};

/**
 * The chapter's text and pictures from the reading line on, in reading order.
 * Anything that ends above the line is passed over whole (a paragraph is one
 * measurement, not one for each of its words).
 */
function* piecesFrom(root: Element, start: number): Generator<Piece> {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 3) {
      const piece = textPiece(child as Text);
      if (piece) {
        yield piece;
      }
      continue;
    }
    if (child.nodeType !== 1) {
      continue;
    }
    const element = child as Element;
    const tag = element.localName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript") {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (PICTURES.has(tag)) {
      yield { node: element, box: rect.height > 0 ? { top: rect.top, bottom: rect.bottom } : null, words: 0, wordTop: () => null, wordStart: () => 0 };
      continue;
    }
    // (An element with no box of its own may still hold text that has one.)
    if (rect.height > 0 && rect.bottom <= start) {
      continue;
    }
    yield* piecesFrom(element, start);
  }
}

/**
 * The first line of `doc` at or below `start` (in the document's own pixels):
 * its place as a CFI under `cfiBase` (its first word by its first letter, or
 * the picture that is there) and where its top is. Null when nothing is there
 * (the end of the chapter).
 */
export const lineAt = (doc: Document, cfiBase: string, start: number): { cfi: string; top: number } | null => {
  if (!doc.body) {
    return null;
  }
  const seen: Piece[] = [];
  const found = firstAtLine(
    (function* () {
      for (const piece of piecesFrom(doc.body, start)) {
        seen.push(piece);
        yield piece;
      }
    })(),
    start
  );
  if (!found) {
    return null;
  }
  const piece = seen[found.piece];
  if (found.word < 0) {
    return { cfi: new CfiFrom(piece.node, cfiBase).toString(), top: piece.box?.top ?? start };
  }
  const range = doc.createRange();
  range.setStart(piece.node, piece.wordStart(found.word));
  range.collapse(true);
  return { cfi: new CfiFrom(range, cfiBase).toString(), top: piece.wordTop(found.word) ?? start };
};

/** The first text of `doc` that reaches below `start` (in the document's own pixels), or null. */
export const firstTextFrom = (doc: Document, start: number): Text | null => {
  if (!doc.body) {
    return null;
  }
  for (const piece of piecesFrom(doc.body, start)) {
    if (piece.words > 0 && piece.box && piece.box.bottom > start) {
      return piece.node as Text;
    }
  }
  return null;
};
