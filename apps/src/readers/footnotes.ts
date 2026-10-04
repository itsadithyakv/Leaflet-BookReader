/**
 * Footnotes in a popup. A note reference in the text is a link to the note,
 * which may be at the foot of the chapter or in a file of notes at the back
 * of the book; following it used to take the reader away from the page for
 * one sentence. A link that is a note reference shows the note where the
 * reader is instead; anything else stays a jump.
 *
 * What a note reference is: one marked as such (`epub:type="noteref"`,
 * `role="doc-noteref"`), a link to something marked as a note, or (the
 * common unmarked case) a superscript or bracketed number that leads to a
 * small block of text which the link's target begins.
 */

export type NoteLinkFacts = {
  /** The link's `epub:type` and `role`. */
  linkTypes: string;
  linkRole: string;
  /** The link's own text. */
  text: string;
  /** Set as a superscript: inside (or around) a `<sup>`, or raised by its style. */
  superscript: boolean;
  /** What it leads to; null when it could not be found. */
  target: {
    /** `epub:type` and `role` of the target, or of what contains it. */
    types: string;
    role: string;
    /** The block the target is in (or is): its tag, in lower case. */
    blockTag: string;
    /** Nothing but white space comes before the target in that block. */
    atBlockStart: boolean;
    /** How much text the block holds. */
    blockChars: number;
  } | null;
};

/** A note this long or shorter may be an unmarked one; a longer target is a passage, not a note. */
export const NOTE_MAX_CHARS = 1500;
/** How much of a note the popup shows before "Go to note" is the way to the rest. */
export const NOTE_SHOWN_CHARS = 700;

const has = (types: string, names: string[]) => {
  const words = types.toLowerCase().split(/\s+/);
  return names.some((name) => words.includes(name));
};

/** "3", "[3]", "(12)", "*", "†", "iv", "a": what a note's marker looks like. */
const MARKER = /^[\[(]?\s*(\d{1,4}|[*†‡§¶‖#]{1,3}|[ivxlc]{1,6}|[a-z])\s*[\])]?[.:]?$/i;
export const isNoteMarker = (text: string) => MARKER.test(text.trim());
const isBracketed = (text: string) => /^[\[(].*[\])]$/.test(text.trim());
const isSymbol = (text: string) => /^[*†‡§¶‖#]{1,3}$/.test(text.trim());

/** Whether a link is a note reference, to be shown in place, or a jump like any other. */
export const classifyNoteLink = (facts: NoteLinkFacts): "note" | "jump" => {
  const target = facts.target;
  if (!target || target.blockChars <= 0) {
    return "jump";
  }
  // The way back from a note to the text is never a note.
  if (has(facts.linkTypes, ["backlink", "referrer"]) || has(facts.linkRole, ["doc-backlink"])) {
    return "jump";
  }
  if (has(facts.linkTypes, ["noteref"]) || has(facts.linkRole, ["doc-noteref"])) {
    return "note";
  }
  if (has(target.types, ["footnote", "endnote", "rearnote", "note"]) || has(target.role, ["doc-footnote", "doc-endnote", "note"])) {
    return "note";
  }
  // Unmarked: it must look like a marker, and lead to the start of a small block.
  const text = facts.text.trim();
  const looksLikeMarker = isNoteMarker(text) && (facts.superscript || isBracketed(text) || isSymbol(text));
  if (!looksLikeMarker || !target.atBlockStart || target.blockChars > NOTE_MAX_CHARS) {
    return "jump";
  }
  return /^(h[1-6]|body|html|section|article|nav|table|img|figure)$/.test(target.blockTag) ? "jump" : "note";
};

// ---- the note's text ----------------------------------------------------------------

/** As much of a DOM node as is read here: real nodes fit, and so do a test's plain objects. */
export type NodeLike = {
  nodeType: number;
  nodeName: string;
  data?: string;
  childNodes: ArrayLike<NodeLike>;
  getAttribute?: (name: string) => string | null;
};

export type NoteRun = { text: string; em?: boolean; strong?: boolean };
export type NoteText = { paragraphs: NoteRun[][]; truncated: boolean };

const BLOCK = /^(p|div|li|blockquote|dd|dt|tr|section|aside|ol|ul|h[1-6]|br)$/;
const SKIP = /^(script|style|svg|img|math|audio|video|object|iframe|noscript|template)$/;
const EM = /^(em|i|cite|dfn|var)$/;
const STRONG = /^(strong|b)$/;

const textOf = (node: NodeLike): string => {
  if (node.nodeType === 3) {
    return node.data ?? "";
  }
  let text = "";
  for (let index = 0; index < node.childNodes.length; index += 1) {
    text += textOf(node.childNodes[index]);
  }
  return text;
};

/** The link back to the text ("↩", "Back", or the note's own number as a link): not part of the note. */
const isWayBack = (node: NodeLike) => {
  if (node.nodeName.toLowerCase() !== "a" || !node.getAttribute?.("href")) {
    return false;
  }
  const types = `${node.getAttribute("epub:type") ?? ""} ${node.getAttribute("role") ?? ""}`;
  const text = textOf(node).trim();
  return /backlink|referrer/i.test(types) || isNoteMarker(text) || /^(↩|↑|⏎|\^|back|return|back to text|return to text)\.?$/i.test(text);
};

/**
 * A note's text, as plain runs with simple emphasis: paragraphs of words,
 * some italic, some bold. Nothing else of the book's markup comes through
 * (the popup builds its own elements from this), and the note's own number
 * and its link back to the text are left out.
 */
export const noteText = (block: NodeLike, limit = NOTE_SHOWN_CHARS): NoteText => {
  const paragraphs: NoteRun[][] = [[]];
  let shown = 0;
  let truncated = false;
  const breakParagraph = () => {
    if (paragraphs[paragraphs.length - 1].length > 0) {
      paragraphs.push([]);
    }
  };
  const add = (raw: string, em: boolean, strong: boolean) => {
    if (truncated) {
      return;
    }
    const paragraph = paragraphs[paragraphs.length - 1];
    let text = raw.replace(/\s+/g, " ");
    const last = paragraph[paragraph.length - 1];
    if (paragraph.length === 0 || last.text.endsWith(" ")) {
      text = text.replace(/^ /, "");
    }
    if (!text) {
      return;
    }
    if (shown + text.length > limit) {
      // Cut at a word, and say there is more.
      const room = Math.max(0, limit - shown);
      const cut = text.slice(0, room).replace(/\s+\S*$/, "");
      text = `${cut.trimEnd()}…`;
      truncated = true;
    }
    shown += text.length;
    if (last && Boolean(last.em) === em && Boolean(last.strong) === strong) {
      last.text += text;
    } else {
      paragraph.push({ text, ...(em ? { em } : {}), ...(strong ? { strong } : {}) });
    }
  };
  const walk = (node: NodeLike, em: boolean, strong: boolean) => {
    if (truncated) {
      return;
    }
    if (node.nodeType === 3) {
      add(node.data ?? "", em, strong);
      return;
    }
    if (node.nodeType !== 1) {
      return;
    }
    const tag = node.nodeName.toLowerCase();
    if (SKIP.test(tag) || isWayBack(node)) {
      return;
    }
    const block = BLOCK.test(tag);
    if (block) {
      breakParagraph();
    }
    for (let index = 0; index < node.childNodes.length; index += 1) {
      walk(node.childNodes[index], em || EM.test(tag), strong || STRONG.test(tag));
    }
    if (block) {
      breakParagraph();
    }
  };
  walk(block, false, false);
  const kept = paragraphs
    .map((paragraph) => {
      const runs = paragraph.map((run) => ({ ...run }));
      if (runs.length > 0) {
        runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
      }
      return runs.filter((run) => run.text);
    })
    .filter((paragraph) => paragraph.length > 0);
  // The note's own number at its start ("1. ", "[4] ", "3 ") says nothing in a popup.
  if (kept.length > 0) {
    const first = kept[0][0];
    first.text = first.text.replace(/^[\[(]?(\d{1,4}|[*†‡§¶‖#]{1,3})[\])]?[.:]?\s+/, "");
    if (!first.text) {
      kept[0].shift();
      if (kept[0].length === 0) {
        kept.shift();
      }
    }
  }
  return { paragraphs: kept, truncated };
};

// ---- reading a link and its target from the page -----------------------------------

const NOTE_TYPES = /(^|\s)(footnote|endnote|rearnote|note)(\s|$)/i;
const NOTE_ROLES = /(^|\s)(doc-footnote|doc-endnote|note)(\s|$)/i;
const BLOCK_SELECTOR = "p, li, div, aside, dd, dt, td, blockquote, section, article, body";

/** The element a note's text is read from: the marked note around the target, else the block it is in. */
export const noteBlockOf = (target: Element): Element => {
  for (let at: Element | null = target; at; at = at.parentElement) {
    if (NOTE_TYPES.test(at.getAttribute("epub:type") ?? "") || NOTE_ROLES.test(at.getAttribute("role") ?? "")) {
      return at;
    }
  }
  return target.matches(BLOCK_SELECTOR) ? target : (target.closest(BLOCK_SELECTOR) ?? target);
};

/** An element by its id, in a document parsed as HTML or as XML. */
export const elementById = (doc: Document, id: string): Element | null => {
  const direct = doc.getElementById(id);
  if (direct) {
    return direct;
  }
  for (const element of Array.from(doc.querySelectorAll("[id], [name]"))) {
    if (element.getAttribute("id") === id || (element.tagName.toLowerCase() === "a" && element.getAttribute("name") === id)) {
      return element;
    }
  }
  return null;
};

/** What `classifyNoteLink` needs to know about a link's target. */
export const targetFacts = (target: Element): NonNullable<NoteLinkFacts["target"]> => {
  const block = noteBlockOf(target);
  let before = "";
  if (block !== target && block.contains(target)) {
    const range = block.ownerDocument.createRange();
    range.setStart(block, 0);
    range.setEndBefore(target);
    before = range.toString();
  }
  return {
    types: `${target.getAttribute("epub:type") ?? ""} ${block.getAttribute("epub:type") ?? ""}`,
    role: `${target.getAttribute("role") ?? ""} ${block.getAttribute("role") ?? ""}`,
    blockTag: block.tagName.toLowerCase(),
    atBlockStart: before.trim() === "",
    blockChars: (block.textContent ?? "").trim().length
  };
};

/** What `classifyNoteLink` needs to know about the link itself (it is on the page, so its style can be read). */
export const linkFacts = (anchor: Element): Omit<NoteLinkFacts, "target"> => {
  const view = anchor.ownerDocument.defaultView;
  const raised = (element: Element | null) => {
    if (!element || !view) {
      return false;
    }
    const align = view.getComputedStyle(element).verticalAlign;
    return align === "super" || Number.parseFloat(align) > 0;
  };
  return {
    linkTypes: anchor.getAttribute("epub:type") ?? "",
    linkRole: anchor.getAttribute("role") ?? "",
    text: anchor.textContent ?? "",
    superscript: Boolean(anchor.closest("sup") || anchor.querySelector("sup")) || raised(anchor) || raised(anchor.firstElementChild)
  };
};
