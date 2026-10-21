/**
 * A book's layout reined in for a narrow column (a phone's).
 *
 * A stylesheet made for a page or a desktop window can give a block room
 * that a phone's column does not have: `margin: 0 30%` round an epigraph, a
 * poem `width: 40%`, `padding-left: 5em` on a letter, a sidebar floated
 * beside the text. And a Kindle book's indent is a `<blockquote>` in a
 * `<blockquote>` in a `<blockquote>`, each with the browser's 40px on both
 * sides, which the reader keeps as an inset (bookBlocks.ts). On a column of
 * 350px what is left is a strip of a hundred, and justified, it is one or
 * two words a line with rivers of space between them.
 *
 * On a narrow column (`html[data-leaflet-narrow]`, set from the column's
 * width when the chapter opens; or a frame narrower than that, scrolling) the
 * way Readium CSS and the e-ink readers do it, a block keeps most of the
 * column:
 *
 * - an inset, a margin, a padding or a first-line indent is at most 2em or a
 *   tenth of the column on a side; an inset inside an inset adds nothing;
 * - a text block the book sized (a width, a min-width), floated, or set
 *   inline-block takes the column's width, as a block;
 * - verse (a block of short lines broken by `<br>`, or one the book calls a
 *   poem, verse, epigraph...) is set ragged, not justified, unless the book
 *   centred it or set it to the right; so is the text of an inset inside an
 *   inset, and of a blockquote of short lines or mostly in italics (a
 *   Kindle book's verse, a letter, a journal), which justified in what is
 *   left of the column is rivers of space.
 *
 * Pictures, tables and lists are left alone, as are the reader's own margins
 * and everything on a wide column. The book's sizes are read once, as the
 * chapter opens, before the reader's stylesheet goes in (as bookBlocks.ts
 * reads them); the marks are made whatever the width, and the rules only
 * apply when the column is narrow.
 */

/** A text column narrower than this is narrow (px). */
export const NARROW_COLUMN_PX = 560;
/** On a narrow column, a block's margin, padding or indent is at most this many ems on a side... */
export const SIDE_MAX_EMS = 2;
/** ...and at most this share of the column (percent). */
export const SIDE_MAX_SHARE = 10;
/** A line of verse broken by `<br>` is no longer than this, on average. */
export const LINE_MAX_CHARS = 60;
/** A float or an inline-block with at least this much text is a box of text, not an ornament or a raised initial. */
export const BOX_MIN_CHARS = 20;
/** A blockquote with at least this share of its text in italics is set ragged. */
export const ITALIC_MIN_SHARE = 0.6;

export const isNarrowColumn = (width: number) => Number.isFinite(width) && width > 0 && width < NARROW_COLUMN_PX;

/**
 * The width of the text column the reader sets (px). With pages, epub.js's
 * column; scrolling, the frame less the reader's gutters, or the chosen line
 * length if that is shorter (`measure`: "34em", or "100vw" for none).
 */
export const textColumnWidth = (o: { pages: boolean; frame: number; columnWidth?: number; pad: number; measure: string; fontSize: number }) => {
  if (o.pages && Number(o.columnWidth) > 0) {
    return Number(o.columnWidth);
  }
  const free = Math.max(0, o.frame - 2 * o.pad);
  const ems = /^\s*(\d*\.?\d+)em\s*$/.exec(o.measure);
  const measure = ems ? Number(ems[1]) * o.fontSize : Infinity;
  return Math.min(free, measure);
};

/** Marks a chapter's document as set in a narrow column, or not. */
export const markNarrowColumn = (doc: Document, columnWidth: number) => {
  doc.documentElement.toggleAttribute("data-leaflet-narrow", isNarrowColumn(columnWidth));
};

// ---- what a block is ---------------------------------------------------------------------

/** A block of text as the publisher styled it. Lengths in px, as computed. */
export type BoxFacts = {
  tag: string;
  /** Characters of text in it. */
  chars: number;
  /** It is or holds a picture, a table or the like: left alone. */
  picture: boolean;
  /** Its own font size. */
  fontSize: number;
  /** The width its parent gives it (the parent's content box), 0 when not known. */
  room: number;
  /** Its own width (border box). */
  width: number;
  marginLeft: number;
  marginRight: number;
  paddingLeft: number;
  paddingRight: number;
  textIndent: number;
  display: string;
  float: string;
  /** Its parent lays it out (flex, grid, a table): its width is not its own to give back. */
  laidOut: boolean;
  /** bookBlocks.ts kept it as an inset or a hanging indent: its margins are kept there. */
  inset: boolean;
  /** Its class, id and epub:type. */
  name: string;
  /** How many `<br>` break its lines (0 for a block with blocks in it). */
  breaks: number;
  /** A block with blocks in it: the lines its blocks and `<br>`s make (0 for a leaf). */
  rows: number;
  /** The share of its text in italics, 0 to 1 (read for blockquotes only). */
  italic: number;
};

/** What the narrow column does to a block: CSS lengths (ems of its own size) to cap, and marks. */
export type NarrowBox = {
  marginLeft?: string;
  marginRight?: string;
  paddingLeft?: string;
  paddingRight?: string;
  textIndent?: string;
  /** Takes the column's width: "box" (no width, no float), or "block" (and is a block, not inline-block). */
  free?: "box" | "block";
  /** Verse: set ragged. */
  lines?: boolean;
};

/** The reader already gives these no left margin and no first-line indent (useBookOpening.ts). */
const LEFT_RESET = new Set(["p", "div", "section", "article", "blockquote", "li"]);
/** Names a publisher gives verse. */
const VERSE_NAME = /(^|[\s:_-])(poem|poetry|verse|stanza|epigraph|lyrics?|song|inscription)/i;

const ems = (px: number, fontSize: number) => `${Math.round((px / Math.max(1, fontSize)) * 100) / 100}em`;

/** A side's most on a narrow column, in px, for a block of this size in this room. */
export const sideCap = (fontSize: number, room: number) => Math.min(fontSize * SIDE_MAX_EMS, room > 0 ? (room * SIDE_MAX_SHARE) / 100 : Infinity);

/** Verse, by its name or its lines: short lines broken by `<br>`. */
export const isVerseLike = (facts: Pick<BoxFacts, "name" | "breaks" | "chars">) =>
  VERSE_NAME.test(facts.name) || (facts.breaks >= 2 && facts.chars > 0 && facts.chars / (facts.breaks + 1) <= LINE_MAX_CHARS);

/** A blockquote of short lines (its paragraphs or its breaks), or mostly in italics. */
export const isRaggedQuote = (facts: Pick<BoxFacts, "tag" | "rows" | "chars" | "italic">) =>
  facts.tag === "blockquote" &&
  facts.chars > 0 &&
  (facts.italic >= ITALIC_MIN_SHARE ||
    (facts.rows >= 2 && facts.chars / facts.rows <= LINE_MAX_CHARS));

/** What a narrow column does to this block, or null for nothing. */
export const narrowBox = (facts: BoxFacts): NarrowBox | null => {
  if (facts.picture) {
    return null;
  }
  const out: NarrowBox = {};
  const cap = sideCap(facts.fontSize, facts.room);
  const over = (px: number) => px > cap + 0.5;
  const leftReset = LEFT_RESET.has(facts.tag);
  if (!facts.inset) {
    if (!leftReset && over(facts.marginLeft)) {
      out.marginLeft = ems(facts.marginLeft, facts.fontSize);
    }
    if (over(facts.marginRight)) {
      out.marginRight = ems(facts.marginRight, facts.fontSize);
    }
    if (!leftReset && Math.abs(facts.textIndent) > facts.fontSize * SIDE_MAX_EMS + 0.5) {
      out.textIndent = ems(facts.textIndent, facts.fontSize);
    }
  }
  if (over(facts.paddingLeft)) {
    out.paddingLeft = ems(facts.paddingLeft, facts.fontSize);
  }
  if (over(facts.paddingRight)) {
    out.paddingRight = ems(facts.paddingRight, facts.fontSize);
  }
  if (facts.chars > 0 && !facts.laidOut) {
    const floated = facts.float !== "none" && facts.float !== "";
    if (floated || facts.display === "inline-block") {
      // (A raised initial or an ornament floated beside the text stays as it is.)
      if (facts.chars >= BOX_MIN_CHARS) {
        out.free = floated ? "box" : "block";
      }
    } else if (/^(block|list-item|flow-root)$/.test(facts.display) && facts.room > 0) {
      // Narrower than the room its margins leave: the book gave it a width.
      const sized = facts.width + Math.max(0, facts.marginLeft) + Math.max(0, facts.marginRight) < facts.room - 2;
      // Centred by wide margins (auto ones are reported as what they came to), with a width or without.
      const squeezed = (over(facts.marginLeft) || over(facts.marginRight)) && facts.width < facts.room * 0.75;
      // Wider than its room: a min-width.
      if (sized || squeezed || facts.width > facts.room + 2) {
        out.free = "box";
      }
    }
  }
  if (facts.chars > 0 && (isVerseLike(facts) || isRaggedQuote(facts))) {
    out.lines = true;
  }
  return Object.keys(out).length > 0 ? out : null;
};

// ---- the rules --------------------------------------------------------------------------------

const cap = (value: string) => `min(${value}, ${SIDE_MAX_EMS}em, ${SIDE_MAX_SHARE}%)`;
/** Something that already stands in from the column's edges. */
const INSETTING = `:is([data-leaflet-inset], [data-leaflet-hang], [data-leaflet-box~="in"])`;
/** An inset inside an inset. */
const NESTED = `[data-leaflet-inset] [data-leaflet-inset]`;

/** The rules, for a narrow column marked by `scope` (a selector for the `html` element). */
export const narrowRules = (scope: string) => {
  const at = `${scope} body`;
  return `
  ${at} [data-leaflet-inset] { margin-left: ${cap("var(--leaflet-inset-left, 5%)")} !important; margin-right: ${cap("var(--leaflet-inset-right, 0%)")} !important; }
  ${at} [data-leaflet-hang] {
    margin-left: calc(${cap("var(--leaflet-inset-left, 0%)")} + min(var(--leaflet-hang, 0%), ${SIDE_MAX_EMS}em)) !important;
    margin-right: ${cap("var(--leaflet-inset-right, 0%)")} !important;
    text-indent: calc(-1 * min(var(--leaflet-hang, 0%), ${SIDE_MAX_EMS}em)) !important;
  }
  ${at} [data-leaflet-box~="ml"] { margin-left: ${cap("var(--leaflet-box-ml, 0px)")} !important; }
  ${at} [data-leaflet-box~="mr"] { margin-right: ${cap("var(--leaflet-box-mr, 0px)")} !important; }
  ${at} [data-leaflet-box~="pl"] { padding-left: ${cap("var(--leaflet-box-pl, 0px)")} !important; }
  ${at} [data-leaflet-box~="pr"] { padding-right: ${cap("var(--leaflet-box-pr, 0px)")} !important; }
  ${at} [data-leaflet-box~="ti"] { text-indent: clamp(-${SIDE_MAX_EMS}em, var(--leaflet-box-ti, 0px), ${SIDE_MAX_EMS}em) !important; }
  ${at} ${INSETTING} :is([data-leaflet-inset], [data-leaflet-box~="ml"]) { margin-left: 0 !important; }
  ${at} ${INSETTING} :is([data-leaflet-inset], [data-leaflet-box~="mr"]) { margin-right: 0 !important; }
  ${at} [data-leaflet-box~="free"] { width: auto !important; min-width: 0 !important; max-width: 100% !important; float: none !important; }
  ${at} [data-leaflet-box~="block"] { display: block !important; }
  ${at} [data-leaflet-lines]:not([data-leaflet-set]),
  ${at} [data-leaflet-lines] :where(p, div):not([data-leaflet-set]),
  ${at} ${NESTED}:not([data-leaflet-set]),
  ${at} ${NESTED} :where(p, div):not([data-leaflet-set]) {
    text-align: start !important; -webkit-hyphens: manual !important; hyphens: manual !important;
  }
`;
};

/**
 * The rules for the chapter's stylesheet, after bookBlocks.ts's (which they
 * outrank): for a column marked narrow, and, scrolling, for a frame that is
 * narrow (a window made narrow after the chapter opened).
 */
export const NARROW_CSS = `${narrowRules("html[data-leaflet-narrow]")}
  @media (max-width: ${NARROW_COLUMN_PX - 0.02}px) {${narrowRules('html:not([data-leaflet-layout="pages"])')}  }
`;

// ---- finding them in a chapter -----------------------------------------------------------------

/** The blocks looked at. Lists keep the reader's own rules, figures and tables their own. */
const LOOKED_AT = "p, div, blockquote, section, article, aside, center, header, footer, dl, dd, dt, figcaption, address, h1, h2, h3, h4, h5, h6";
const PICTURE = "img, svg, video, canvas, iframe, object, embed, table, math";
const BLOCK_INSIDE = "p, div, blockquote, section, article, aside, center, header, footer, dl, dd, dt, ul, ol, li, table, h1, h2, h3, h4, h5, h6, pre, figure, hr, address";
const LOOKED_MAX = 30000;

const px = (value: string) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
};

/**
 * Marks a chapter's blocks for a narrow column. Called once a chapter, after
 * bookBlocks.ts's `markBlocks` and before the reader's stylesheet goes in.
 */
export const markNarrowBoxes = (doc: Document) => {
  const view = doc.defaultView;
  if (!view || !doc.body || doc.body.hasAttribute("data-leaflet-narrow-boxes")) {
    return;
  }
  doc.body.setAttribute("data-leaflet-narrow-boxes", "1");
  const parents = new Map<Element, { room: number; laidOut: boolean }>();
  const parentOf = (parent: HTMLElement | null) => {
    if (!parent) {
      return { room: 0, laidOut: false };
    }
    let known = parents.get(parent);
    if (!known) {
      const style = view.getComputedStyle(parent);
      known = {
        room: Math.max(0, parent.clientWidth - px(style.paddingLeft) - px(style.paddingRight)),
        laidOut: /flex|grid|table/.test(style.display)
      };
      parents.set(parent, known);
    }
    return known;
  };
  const italics = new Map<Element, boolean>();
  const isItalic = (element: Element) => {
    let known = italics.get(element);
    if (known === undefined) {
      known = /italic|oblique/.test(view.getComputedStyle(element).fontStyle);
      italics.set(element, known);
    }
    return known;
  };
  /** The share of a block's text in italics. */
  const italicShare = (element: HTMLElement, chars: number) => {
    if (chars === 0) {
      return 0;
    }
    let italic = 0;
    const walker = doc.createTreeWalker(element, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent && isItalic(parent)) {
        italic += (node.textContent ?? "").replace(/\s+/g, " ").trim().length;
      }
    }
    return Math.min(1, italic / chars);
  };
  /** The lines a block with blocks in it makes: its paragraphs with words in them, and its breaks. */
  const rowsOf = (element: HTMLElement) => {
    const leaves = Array.from(element.querySelectorAll("p, div")).filter(
      (inner) => !inner.querySelector(BLOCK_INSIDE) && (inner.textContent ?? "").trim() !== ""
    );
    return leaves.length + element.querySelectorAll("br").length;
  };
  const elements = Array.from(doc.body.querySelectorAll<HTMLElement>(LOOKED_AT)).slice(0, LOOKED_MAX);
  // Every block is read before any is marked: a mark written between two
  // reads would have the chapter laid out again for each block.
  const found: Array<[HTMLElement, NarrowBox]> = [];
  for (const element of elements) {
    if (element.closest("table, figure, ul, ol")) {
      continue;
    }
    const style = view.getComputedStyle(element);
    if (style.display === "none") {
      continue;
    }
    const tag = (element.localName || element.tagName).toLowerCase();
    const parent = parentOf(element.parentElement);
    const leaf = !element.querySelector(BLOCK_INSIDE);
    const chars = (element.textContent ?? "").replace(/\s+/g, " ").trim().length;
    const quote = tag === "blockquote";
    const facts: BoxFacts = {
      tag,
      chars,
      picture: Boolean(element.querySelector(PICTURE)),
      fontSize: px(style.fontSize) || 16,
      room: parent.room,
      width: element.getBoundingClientRect().width,
      marginLeft: px(style.marginLeft),
      marginRight: px(style.marginRight),
      paddingLeft: px(style.paddingLeft),
      paddingRight: px(style.paddingRight),
      textIndent: px(style.textIndent),
      display: style.display,
      float: style.cssFloat || style.getPropertyValue("float") || "none",
      laidOut: parent.laidOut,
      inset: element.hasAttribute("data-leaflet-inset") || element.hasAttribute("data-leaflet-hang"),
      name: [element.getAttribute("class"), element.id, element.getAttribute("epub:type")].filter(Boolean).join(" "),
      breaks: leaf ? element.querySelectorAll("br").length : 0,
      rows: quote && !leaf ? rowsOf(element) : 0,
      italic: quote ? italicShare(element, chars) : 0
    };
    const box = narrowBox(facts);
    if (box) {
      found.push([element, box]);
    }
  }
  found.forEach(([element, box]) => applyNarrowBox(element, box));
};

/** Writes what `narrowBox` found onto the element: marks, and the book's lengths for the rules to cap. */
export const applyNarrowBox = (element: HTMLElement, box: NarrowBox | null) => {
  if (!box) {
    return;
  }
  const marks: string[] = [];
  const keep = (mark: string, property: string, value: string | undefined) => {
    if (value !== undefined) {
      marks.push(mark);
      element.style.setProperty(property, value);
    }
  };
  keep("ml", "--leaflet-box-ml", box.marginLeft);
  keep("mr", "--leaflet-box-mr", box.marginRight);
  keep("pl", "--leaflet-box-pl", box.paddingLeft);
  keep("pr", "--leaflet-box-pr", box.paddingRight);
  keep("ti", "--leaflet-box-ti", box.textIndent);
  if (box.marginLeft || box.marginRight || box.paddingLeft || box.paddingRight) {
    marks.push("in");
  }
  if (box.free) {
    marks.push("free");
    if (box.free === "block") {
      marks.push("block");
    }
  }
  if (marks.length > 0) {
    element.setAttribute("data-leaflet-box", marks.join(" "));
  }
  if (box.lines) {
    element.setAttribute("data-leaflet-lines", "1");
  }
};
