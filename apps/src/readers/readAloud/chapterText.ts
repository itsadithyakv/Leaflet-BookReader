/**
 * A chapter's words as they are read aloud: its text in reading order, with
 * what a listener should not hear left out, cut into sentences.
 *
 * Left out: scripts and styles, footnote markers (a marked note reference, or
 * a small superscript number or symbol), page numbers set in the text
 * (`epub:type="pagebreak"`, `role="doc-pagebreak"`), the notes themselves
 * where the chapter holds them, hidden elements, ruby readings, pictures and
 * formulas. A block (a paragraph, a heading, a list item) always ends a
 * sentence.
 *
 * The walk is the same for a chapter read from the file and for the one on
 * the page, so an offset in one is the same place in the other: a sentence
 * found in the file is lit on the page by its offsets alone.
 */
import { isNoteMarker } from "../footnotes";
import { splitSentences } from "./sentences";

/** As much of a DOM node as is read here: real nodes fit, and so do a test's parsed XML. */
export type WalkNode = {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  data?: string;
  childNodes: ArrayLike<WalkNode>;
  getAttribute?: (name: string) => string | null;
  hasAttribute?: (name: string) => boolean;
};

/** The chapter's text, and where each text node starts in it (as `people/bookText.ts`'s TextIndex). */
export type SpokenText<N = WalkNode> = { text: string; nodes: N[]; starts: number[] };

export type Sentence = {
  /** The chapter's place in the spine. */
  section: number;
  /** Which sentence of the chapter, from 0. */
  n: number;
  /** Where it is in the chapter's spoken text. */
  start: number;
  end: number;
  text: string;
};

const BLOCKS = new Set(
  (
    "address article aside blockquote body caption center dd details dialog dir div dl dt fieldset figcaption figure " +
    "footer form h1 h2 h3 h4 h5 h6 header hgroup hr html li main menu nav ol p pre section summary table tbody td tfoot th thead tr ul"
  ).split(" ")
);

/** Never read, nor anything inside. */
const UNREAD = new Set(["script", "style", "head", "title", "noscript", "template", "rt", "rp", "svg", "math", "img", "image", "audio", "video", "object", "iframe", "button", "input", "select", "textarea"]);

const nameOf = (node: WalkNode) => (node.localName ?? node.nodeName ?? "").toLowerCase().replace(/^.*:/, "");

const attr = (node: WalkNode, name: string) => {
  try {
    return node.getAttribute?.(name) ?? null;
  } catch {
    return null;
  }
};

const words = (value: string | null) => (value ?? "").toLowerCase().split(/\s+/).filter(Boolean);

/** The text under a node, for telling what a small element holds. */
const textUnder = (node: WalkNode, limit = 40): string => {
  let out = "";
  const visit = (at: WalkNode) => {
    if (out.length > limit) return;
    if (at.nodeType === 3) {
      out += at.data ?? "";
      return;
    }
    for (let index = 0; index < at.childNodes.length; index += 1) visit(at.childNodes[index]);
  };
  visit(node);
  return out;
};

/** Whether an element, and all it holds, is passed over. */
export const isUnspoken = (node: WalkNode): boolean => {
  const tag = nameOf(node);
  if (UNREAD.has(tag)) {
    return true;
  }
  const types = words(attr(node, "epub:type"));
  const roles = words(attr(node, "role"));
  const hidden = node.hasAttribute ? node.hasAttribute("hidden") : Boolean(attr(node, "hidden"));
  if (hidden || attr(node, "aria-hidden") === "true") {
    return true;
  }
  if (/display\s*:\s*none/i.test(attr(node, "style") ?? "")) {
    return true;
  }
  // A page number of the printed book.
  if (types.includes("pagebreak") || roles.includes("doc-pagebreak")) {
    return true;
  }
  // A note reference, marked as one.
  if (types.includes("noteref") || roles.includes("doc-noteref")) {
    return true;
  }
  // The notes themselves, where the chapter holds them.
  if (
    types.some((type) => type === "footnote" || type === "endnote" || type === "rearnote" || type === "footnotes" || type === "endnotes") ||
    roles.some((role) => role === "doc-footnote" || role === "doc-endnote" || role === "doc-endnotes")
  ) {
    return true;
  }
  // An unmarked marker: a small superscript number or symbol ("3", "*", "[12]"), or a link that is nothing else.
  if (tag === "sup" || (tag === "a" && (attr(node, "href") ?? "").includes("#"))) {
    const text = textUnder(node).trim();
    if (text.length > 0 && text.length <= 6 && isNoteMarker(text) && (tag === "sup" || /^[\[(].*[\])]$|^\d+$|^[*†‡§¶]+$/.test(text))) {
      return true;
    }
  }
  return false;
};

/**
 * The text of a chapter's body in reading order. Between two blocks (and at
 * a line break) the string has a newline no node owns.
 */
export const spokenText = <N extends WalkNode>(root: N): SpokenText<N> => {
  const nodes: N[] = [];
  const starts: number[] = [];
  const parts: string[] = [];
  let length = 0;
  let lastBlock: WalkNode | null = null;
  let broken = false;
  const visit = (node: WalkNode, block: WalkNode) => {
    if (node.nodeType === 3) {
      const value = node.data ?? "";
      if (!value) {
        return;
      }
      if (length > 0 && (broken || block !== lastBlock)) {
        parts.push("\n");
        length += 1;
      }
      broken = false;
      lastBlock = block;
      nodes.push(node as N);
      starts.push(length);
      parts.push(value);
      length += value.length;
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) {
      return;
    }
    if (node.nodeType === 1 && node !== root && isUnspoken(node)) {
      return;
    }
    const tag = nameOf(node);
    if (tag === "br") {
      broken = true;
      return;
    }
    const inner = node.nodeType === 1 && BLOCKS.has(tag) ? node : block;
    if (inner !== block) {
      broken = true;
    }
    for (let index = 0; index < node.childNodes.length; index += 1) {
      visit(node.childNodes[index], inner);
    }
    if (inner !== block) {
      broken = true;
    }
  };
  visit(root, root);
  return { text: parts.join(""), nodes, starts };
};

/**
 * The chapter's sentences. Runs of white space inside one (the book's own
 * line breaks in its source) are read as one space.
 */
export const chapterSentences = (spoken: Pick<SpokenText<unknown>, "text">, section: number): Sentence[] =>
  splitSentences(spoken.text).map((span, n) => ({
    section,
    n,
    start: span.start,
    end: span.end,
    // (Soft hyphens are for the line, not the voice.)
    text: spoken.text.slice(span.start, span.end).replace(/­/g, "").replace(/\s+/g, " ")
  }));

/** The sentence an offset of the chapter's text falls in, or the first after it; the last when it is past them all. */
export const sentenceAt = (sentences: readonly Sentence[], offset: number): number => {
  if (sentences.length === 0) {
    return -1;
  }
  let low = 0;
  let high = sentences.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sentences[mid].end <= offset) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
};
