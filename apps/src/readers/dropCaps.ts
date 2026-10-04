/**
 * A chapter's opening: the large first letter (a drop cap, or a raised
 * initial) and the first few words in small capitals.
 *
 * The reader gives running text one size, whatever the publisher set. A drop
 * cap made with `p::first-letter` survives that (a pseudo-element is not
 * matched), but the common kind made with an element, `<span
 * class="dropcap">T</span>he`, came out at body size while keeping its float
 * and margins: a small "T" set apart from "he". Small capitals made the usual
 * way (capitals, a little smaller) came out as full-size shouting.
 *
 * They are recognised by what they are, not by one publisher's class name,
 * from the publisher's own styles (read before the reader's stylesheet goes
 * in), marked, and left out of the one-size rule: their size is kept as a
 * multiple of the reading size, so it follows the type-size control.
 */

export type OpeningKind = "dropcap" | "smallcaps";

export type OpeningCandidate = {
  /** The element's own text. */
  text: string;
  /** Nothing but white space comes before it in its paragraph (or only the drop cap does). */
  atStart: boolean;
  /** Its size over its paragraph's, as the publisher styled it. */
  sizeRatio: number;
  floated: boolean;
  /** `font-variant: small-caps`. */
  smallCapsVariant: boolean;
  /** `text-transform: uppercase`. */
  upperTransform: boolean;
  /** Its class names and `epub:type`, for what the styles do not say. */
  hint: string;
};

/** A cap is this much larger than its paragraph, at least. */
export const CAP_MIN_RATIO = 1.4;
/** Opening small capitals run for a few words, not a paragraph. */
export const SMALL_CAPS_MAX_CHARS = 80;

/** One to three characters: a letter or two, with a quote mark or bracket before it at most. */
const CAP_TEXT = /^[“"‘'«‹„¿¡(\[]{0,2}[\p{L}\p{N}]{1,2}$/u;
const SMALL_CAPS_HINT = /small-?caps?|smcp|(^|[\s_-])sc([\s_-]|$)/i;
const CAP_HINT = /(^|[\s_-])(drop-?caps?\w*|initial\w*|first-?letter|lettrine|versal|big-?cap|cap)([\s_-]|$)/i;

export const hintsSmallCaps = (hint: string) => SMALL_CAPS_HINT.test(hint);
export const hintsDropCap = (hint: string) => !hintsSmallCaps(hint) && CAP_HINT.test(hint);

/** Written in capitals: "THE MORNING", not "The" or "A". */
const isUpperCase = (text: string) => {
  const letters = text.replace(/[^\p{L}]/gu, "");
  return letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
};

/**
 * What an inline element at the start of a paragraph is. An ordinary bold or
 * italic first word is neither: it is no larger than its paragraph and is not
 * floated, so the one-size rule costs it nothing.
 */
export const classifyOpening = (candidate: OpeningCandidate): OpeningKind | null => {
  if (!candidate.atStart) {
    return null;
  }
  const text = candidate.text.trim();
  if (!text) {
    return null;
  }
  if (text.length <= 3 && CAP_TEXT.test(text)) {
    const large = candidate.sizeRatio >= CAP_MIN_RATIO;
    return large || candidate.floated || hintsDropCap(candidate.hint) ? "dropcap" : null;
  }
  if (text.length > SMALL_CAPS_MAX_CHARS || text.replace(/[^\p{L}]/gu, "").length < 2) {
    return null;
  }
  const smaller = candidate.sizeRatio < 0.95;
  if (candidate.smallCapsVariant) {
    return "smallcaps";
  }
  // Capitals set a little smaller: small capitals in all but name.
  if (smaller && (candidate.upperTransform || isUpperCase(text))) {
    return "smallcaps";
  }
  return smaller && hintsSmallCaps(candidate.hint) ? "smallcaps" : null;
};

/** The size to keep, as a multiple of the reading size: within what a page can hold. */
export const keptSize = (kind: OpeningKind, sizeRatio: number) => {
  const ratio = Number.isFinite(sizeRatio) && sizeRatio > 0 ? sizeRatio : 1;
  return kind === "dropcap" ? Math.min(6, Math.max(1, ratio)) : Math.min(1, Math.max(0.6, ratio));
};

/**
 * A cap's own line height, as a multiple of its size. A floated cap's box is
 * as tall as its line, and the paragraph's 1.8 on a letter three times the
 * size would hold four or five lines of text away from the margin; one with
 * none at all would let the text run over it.
 */
export const keptLeading = (lineHeightRatio: number, floated: boolean) => {
  const ratio = Number.isFinite(lineHeightRatio) && lineHeightRatio >= 0 ? lineHeightRatio : 1;
  return Math.min(1.15, Math.max(floated ? 0.6 : 0, ratio));
};

// ---- finding them in a chapter ---------------------------------------------------

const BLOCKS = "p, div, blockquote, li, dd, td";
const BLOCK_TAGS = new Set([
  "p", "div", "blockquote", "li", "dd", "dt", "td", "th", "ul", "ol", "dl", "table", "section", "article", "aside",
  "h1", "h2", "h3", "h4", "h5", "h6", "pre", "figure", "figcaption", "hr", "nav", "header", "footer"
]);
const NOT_TEXT = new Set(["img", "svg", "image", "br", "picture", "video", "audio", "object", "math", "script", "style"]);

/** The first thing in an element that is read: an element with something in it, or text that is not white space. */
const firstContent = (parent: Node): Node | null => {
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 3) {
      if ((node as Text).data.trim()) {
        return node;
      }
    } else if (node.nodeType === 1) {
      const element = node as Element;
      // A page-break anchor (<a id="page12"/>) is nothing to read.
      if ((element.textContent ?? "").trim() || element.querySelector("img, svg")) {
        return node;
      }
    }
  }
  return null;
};

/** What follows an element in its paragraph, climbing out of the wrappers it ends. */
const nextContent = (from: Element, block: Element): Node | null => {
  let at: Node | null = from;
  while (at && at !== block) {
    for (let node = at.nextSibling; node; node = node.nextSibling) {
      if (node.nodeType === 3 ? (node as Text).data.trim() : node.nodeType === 1 && ((node as Element).textContent ?? "").trim()) {
        return node;
      }
    }
    at = at.parentNode;
  }
  return null;
};

const isInlineElement = (node: Node | null): node is HTMLElement => {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  const tag = (node as Element).tagName.toLowerCase();
  return !BLOCK_TAGS.has(tag) && !NOT_TEXT.has(tag);
};

const pixels = (value: string) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
};

/**
 * Marks the drop caps and opening small capitals of a chapter. Called before
 * the reader's stylesheet goes in, while the publisher's sizes can still be
 * read; a chapter already marked is left alone.
 */
export const markOpenings = (doc: Document) => {
  const view = doc.defaultView;
  if (!view || !doc.body || doc.body.hasAttribute("data-leaflet-openings")) {
    return;
  }
  doc.body.setAttribute("data-leaflet-openings", "1");

  const describe = (element: HTMLElement, block: Element, atStart: boolean): { candidate: OpeningCandidate; leading: number } => {
    const style = view.getComputedStyle(element);
    const blockSize = pixels(view.getComputedStyle(block).fontSize) || 16;
    // The size may be set on a wrapper inside (<span class="cap"><b>T</b></span>) or on the element itself.
    let innermost: Element = element;
    for (let node = firstContent(element); node && node.nodeType === 1; node = firstContent(node)) {
      innermost = node as Element;
    }
    const size = Math.max(pixels(style.fontSize), innermost === element ? 0 : pixels(view.getComputedStyle(innermost).fontSize));
    const lineHeight = pixels(style.lineHeight);
    return {
      candidate: {
        text: element.textContent ?? "",
        atStart,
        sizeRatio: size / blockSize,
        floated: style.cssFloat === "left" || style.cssFloat === "right",
        smallCapsVariant: /small-caps/.test(`${style.fontVariantCaps} ${style.fontVariant}`),
        upperTransform: style.textTransform === "uppercase",
        hint: `${element.getAttribute("class") ?? ""} ${element.getAttribute("epub:type") ?? ""}`
      },
      leading: style.lineHeight === "normal" || size <= 0 ? 1 : lineHeight / size
    };
  };

  const mark = (element: HTMLElement, kind: OpeningKind, described: { candidate: OpeningCandidate; leading: number }) => {
    element.setAttribute(kind === "dropcap" ? "data-leaflet-dropcap" : "data-leaflet-smallcaps", "1");
    element.style.setProperty("--leaflet-cap-size", keptSize(kind, described.candidate.sizeRatio).toFixed(3));
    if (kind === "dropcap") {
      element.style.setProperty("--leaflet-cap-leading", keptLeading(described.leading, described.candidate.floated).toFixed(3));
    }
  };

  doc.body.querySelectorAll(BLOCKS).forEach((block) => {
    // Most paragraphs begin with plain text and are passed over here, with no styles read.
    let node = firstContent(block);
    let cap: HTMLElement | null = null;
    for (let depth = 0; depth < 5 && isInlineElement(node); depth += 1) {
      const element: HTMLElement = node;
      if ((element.textContent ?? "").trim().length <= SMALL_CAPS_MAX_CHARS) {
        const described = describe(element, block, true);
        const kind = classifyOpening(described.candidate);
        if (kind) {
          mark(element, kind, described);
          cap = kind === "dropcap" ? element : null;
          // The paragraph keeps its first lines together beside the cap (see the stylesheet).
          block.setAttribute("data-leaflet-opening", kind);
          break;
        }
      }
      node = firstContent(element);
    }
    // "T" + "HE MORNING CAME": small capitals straight after the cap.
    const after = cap ? nextContent(cap, block) : null;
    if (isInlineElement(after) && (after.textContent ?? "").trim().length <= SMALL_CAPS_MAX_CHARS) {
      const described = describe(after, block, true);
      if (classifyOpening(described.candidate) === "smallcaps") {
        mark(after, "smallcaps", described);
      }
    }
  });
};

/**
 * The rules for what `markOpenings` marked, for the chapter's stylesheet.
 * They outrank the one-size and one-spacing rules for running text.
 */
export const OPENINGS_CSS = `
  body [data-leaflet-dropcap] { font-size: calc(var(--leaflet-cap-size, 3) * 1em) !important; line-height: var(--leaflet-cap-leading, 1) !important; -webkit-hyphens: manual; hyphens: manual; }
  body [data-leaflet-smallcaps] { font-size: calc(var(--leaflet-cap-size, 1) * 1em) !important; }
  /* With pages, a cap is not left at the foot of a column with one line beside it. */
  [data-leaflet-opening="dropcap"] { orphans: 3; widows: 2; }
  /* A cap takes the page's ink on a dark page, like the text it opens. */
  html[data-reader-dark="1"] body [data-leaflet-dropcap], html[data-reader-dark="1"] body [data-leaflet-dropcap] * { color: inherit !important; }
`;
