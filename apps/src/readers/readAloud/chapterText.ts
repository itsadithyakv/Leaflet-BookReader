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
 *
 * The walk also notes what a listener should hear as a pause or a join: the
 * headings, the scene breaks (a rule, an ornament, a line of "* * *"), the
 * line breaks within a block, and the drop caps (a letter set apart from its
 * word). Each sentence carries what is to be said (`say`, `speechText.ts`)
 * and the pause it follows (`lead`).
 */
import { isNoteMarker } from "../footnotes";
import { splitSentences, type Span } from "./sentences";
import { speechText } from "./speechText";

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
export type SpokenText<N = WalkNode> = {
  text: string;
  nodes: N[];
  starts: number[];
  /** The text of the chapter's headings. */
  headings?: Span[];
  /** Offsets where a scene break with no text stands (a rule, an ornament). */
  scenes?: number[];
  /** Offsets of the newlines a line break (not a new block) put in. */
  lines?: number[];
  /**
   * Offsets of every newline the walk put in (a new block, a line break; a
   * newline inside a `pre`). Any other newline is the book's own source
   * wrapping its lines (a paragraph set over several lines of the file), which
   * the page shows as a space and the voice reads on across. Unset: every
   * newline is a break.
   */
  breaks?: number[];
  /** Offsets just past a drop cap: its word goes on after it, across any space or newline. */
  glue?: number[];
};

/** The pause before a sentence: none of its own within a paragraph, longer for each kind of break. */
export type PauseKind = "sentence" | "line" | "paragraph" | "heading" | "scene" | "chapter";

/** From the least pause to the most. */
export const PAUSE_ORDER: readonly PauseKind[] = ["sentence", "line", "paragraph", "heading", "scene", "chapter"];

export type Sentence = {
  /** The chapter's place in the spine. */
  section: number;
  /** Which sentence of the chapter, from 0. */
  n: number;
  /** Where it is in the chapter's spoken text. */
  start: number;
  end: number;
  /** As the page has it (white space made single). */
  text: string;
  /** As the voice says it (`speechText.ts`). */
  say: string;
  /** For each character of `say`, its offset in the chapter's text; one more at the end. */
  map: number[];
  /** Which block (paragraph, heading, line) of the chapter it is in, from 0. */
  block: number;
  /** In a heading. */
  heading: boolean;
  /** The pause before it. */
  lead: PauseKind;
  /** Not the end of its sentence (a long one cut for lighting): the voice goes straight on. */
  cont?: boolean;
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

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** A heading: h1 to h6, or marked as one. */
const isHeading = (node: WalkNode, tag: string) =>
  HEADINGS.has(tag) ||
  attr(node, "role") === "heading" ||
  words(attr(node, "epub:type")).some((type) => type === "title" || type === "subtitle" || type === "bridgehead" || type === "halftitle");

/** Class names books give a scene break ("scenebreak", "space-break", "orn", "dinkus", "section-sep"). */
const BREAK_CLASS = /break|brk|separator|divider|ornament|\born\b|dinkus|asterism|transition|\bsep\b|section-?sep/i;

/** A scene break with no text of its own: a rule, or an empty block or picture marked as one. */
const isSceneBreak = (node: WalkNode, tag: string) => {
  if (tag === "hr") return true;
  const marked = BREAK_CLASS.test(attr(node, "class") ?? "") || words(attr(node, "epub:type")).includes("transition");
  if (!marked || !BLOCKS.has(tag)) return false;
  return !/[\p{L}\p{N}]/u.test(textUnder(node, 20));
};

const DROP_CAP_CLASS = /drop|initial|lettrine|first-?letter|big-?letter|\bdc\b|\bcap\b/i;

/** A letter set apart from its word (a drop cap): one letter, maybe after an opening quote, marked by its class or style. */
const isDropCap = (node: WalkNode) => {
  const text = textUnder(node, 4).trim();
  if (!/^["'“‘«(]?\p{L}$/u.test(text)) return false;
  return DROP_CAP_CLASS.test(attr(node, "class") ?? "") || /float\s*:\s*(left|right)|font-size/i.test(attr(node, "style") ?? "");
};

/**
 * The text of a chapter's body in reading order. Between two blocks (and at
 * a line break) the string has a newline no node owns.
 */
export const spokenText = <N extends WalkNode>(root: N): SpokenText<N> => {
  const nodes: N[] = [];
  const starts: number[] = [];
  const parts: string[] = [];
  const headings: Span[] = [];
  const scenes: number[] = [];
  const lines: number[] = [];
  const glue: number[] = [];
  const breaks: number[] = [];
  let length = 0;
  let lastBlock: WalkNode | null = null;
  /** Why the next text goes on a new line: a line break, or a new block. */
  let broken: "line" | "block" | null = null;
  /** The heading being walked, and the one the last heading span is of. */
  let heading: WalkNode | null = null;
  let headingOf: WalkNode | null = null;
  /** Inside a `pre`: the text's own newlines are line breaks. */
  let preformatted = 0;
  const visit = (node: WalkNode, block: WalkNode) => {
    if (node.nodeType === 3) {
      const value = node.data ?? "";
      if (!value) {
        return;
      }
      const newBlock = block !== lastBlock;
      if (length > 0 && (broken || newBlock)) {
        if (!newBlock && broken === "line") lines.push(length);
        breaks.push(length);
        parts.push("\n");
        length += 1;
      }
      broken = null;
      lastBlock = block;
      nodes.push(node as N);
      starts.push(length);
      parts.push(value);
      // Set as it is in the file (a poem, code): its own newlines are lines.
      if (preformatted > 0) {
        for (let at = value.indexOf("\n"); at >= 0; at = value.indexOf("\n", at + 1)) {
          lines.push(length + at);
          breaks.push(length + at);
        }
      }
      if (heading) {
        const last = headings[headings.length - 1];
        if (last && headingOf === heading) last.end = length + value.length;
        else headings.push({ start: length, end: length + value.length });
        headingOf = heading;
      }
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
      broken = broken ?? "line";
      return;
    }
    if (node.nodeType === 1 && node !== root && isSceneBreak(node, tag) && scenes[scenes.length - 1] !== length) {
      scenes.push(length);
    }
    const inner = node.nodeType === 1 && BLOCKS.has(tag) ? node : block;
    if (inner !== block) {
      broken = "block";
    }
    const opensHeading = !heading && node.nodeType === 1 && isHeading(node, tag);
    if (opensHeading) heading = node;
    const pre = node.nodeType === 1 && tag === "pre";
    if (pre) preformatted += 1;
    for (let index = 0; index < node.childNodes.length; index += 1) {
      visit(node.childNodes[index], inner);
    }
    if (pre) preformatted -= 1;
    if (opensHeading) heading = null;
    if (node.nodeType === 1 && node !== root && isDropCap(node)) {
      glue.push(length);
    }
    if (inner !== block) {
      broken = "block";
    }
  };
  visit(root, root);
  return { text: parts.join(""), nodes, starts, headings, scenes, lines, glue, breaks };
};

const stronger = (a: PauseKind, b: PauseKind) => (PAUSE_ORDER.indexOf(a) >= PAUSE_ORDER.indexOf(b) ? a : b);

/** Whether an offset is in one of these spans. */
const within = (spans: readonly Span[], at: number) => spans.some((span) => at >= span.start && at < span.end);

type ChapterFacts = Pick<SpokenText<unknown>, "text" | "headings" | "scenes" | "lines" | "glue" | "breaks">;

/**
 * The chapter's sentences. Runs of white space inside one (the book's own
 * line breaks in its source) are read as one space. A sentence with nothing
 * left to say (a lone note marker) is passed over, and its pause goes to the
 * next.
 */
export const chapterSentences = (spoken: ChapterFacts, section: number): Sentence[] => {
  const text = spoken.text;
  const headings = spoken.headings ?? [];
  const scenes = spoken.scenes ?? [];
  const lines = new Set(spoken.lines ?? []);
  const glue = spoken.glue ?? [];
  // The book's own source lines (a paragraph wrapped over several lines of
  // the file) are spaces, as on the page: each used to end a sentence, with a
  // paragraph's pause, part of the way through it.
  // A drop cap's word goes on across the space or newline after it.
  // The text is cut as if there were none (the same length: offsets hold).
  let cutText = text;
  const breaks = spoken.breaks ? new Set(spoken.breaks) : null;
  if (glue.length > 0 || (breaks && text.includes("\n"))) {
    const chars = text.split("");
    if (breaks) {
      for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) {
        if (!breaks.has(index)) chars[index] = " ";
      }
    }
    for (const at of glue) {
      for (let index = at; index < chars.length && /\s/u.test(chars[index]); index += 1) chars[index] = " ";
    }
    cutText = chars.join("");
  }
  const out: Sentence[] = [];
  let lead: PauseKind = "chapter";
  let block = -1;
  let previousEnd = -1;
  let previousHeading = false;
  let previousCont = false;
  for (const span of splitSentences(cutText)) {
    const heading = within(headings, span.start);
    if (previousEnd >= 0) {
      const gap = cutText.slice(previousEnd, span.start);
      let kind: PauseKind = "sentence";
      if (gap.includes("\n")) {
        let onlyLines = true;
        for (let at = previousEnd; at < span.start; at += 1) {
          if (cutText[at] === "\n" && !lines.has(at)) onlyLines = false;
        }
        kind = onlyLines ? "line" : "paragraph";
        // A line of glyphs between two blocks ("* * *", "⁂", "❦") is a scene break.
        if (gap.split("\n").some((line) => /\S/u.test(line))) kind = "scene";
      }
      if (scenes.some((at) => at > previousEnd && at <= span.start)) kind = "scene";
      if ((kind === "line" || kind === "paragraph") && (heading || previousHeading)) kind = "heading";
      if (previousCont) kind = "sentence";
      lead = stronger(lead, kind);
    }
    if (block < 0 || lead !== "sentence") block += 1;
    previousEnd = span.end;
    previousHeading = heading;
    previousCont = Boolean(span.cont);
    const source = text.slice(span.start, span.end);
    const said = speechText(source, {
      heading,
      blockStart: lead !== "sentence",
      glue: glue.filter((at) => at > span.start && at < span.end).map((at) => at - span.start)
    });
    if (!/[\p{L}\p{N}]/u.test(said.text)) {
      // Nothing to say: its pause goes to the next.
      continue;
    }
    out.push({
      section,
      n: out.length,
      start: span.start,
      end: span.end,
      // (Soft hyphens are for the line, not the voice.)
      text: source.replace(/­/g, "").replace(/\s+/g, " "),
      say: said.text,
      map: said.map.map((at) => at + span.start),
      block,
      heading,
      lead,
      ...(span.cont ? { cont: true } : {})
    });
    lead = "sentence";
  }
  return out;
};

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
