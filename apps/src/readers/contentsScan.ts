/**
 * Reads a book for its chapter headings (readers/autoContents.ts decides
 * what they are): every section, one at a time through epub.js's own loader,
 * as the search does, yielding between sections so the page being read never
 * waits. Nothing of a section's document is kept: only the few short lines
 * that may be headings, where they are, and the links of a contents page.
 */
import { EpubCFI } from "epubjs";
import { elementById } from "./footnotes";
import { hintOf, isCfiAnchor, linkResolver, readHeading, styleHints, type ScannedBlock, type ScannedLink, type ScannedSection, type StyleHint, type StyleHints } from "./autoContents";

const BLOCKS = new Set(
  "address article aside blockquote body caption center dd details div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr li main nav ol p pre section table tbody td tfoot th thead tr ul".split(" ")
);
const SKIPPED = new Set(["script", "style", "head", "title", "noscript", "template", "rt", "rp", "math"]);
/** A line longer than this is not a heading. */
const LINE_MAX = 160;
/** As many lines kept for one section as a very long one may have headings. */
const BLOCKS_MAX = 800;

const nameOf = (element: Element) => (element.localName || element.tagName || "").toLowerCase();
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

const hintsFor = (element: Element, hints: StyleHints): StyleHint => {
  const out = { bold: false, centred: false, larger: false, breaks: false };
  for (const name of (element.getAttribute("class") ?? "").split(/\s+/)) {
    const hint = name ? hints.get(name) : undefined;
    if (hint) {
      out.bold ||= hint.bold;
      out.centred ||= hint.centred;
      out.larger ||= hint.larger;
      out.breaks ||= hint.breaks;
    }
  }
  const inline = element.getAttribute("style");
  if (inline) {
    const own = hintOf(inline);
    out.bold ||= own.bold;
    out.centred ||= own.centred;
    out.larger ||= own.larger;
    out.breaks ||= own.breaks;
  }
  if ((element.getAttribute("align") ?? "").toLowerCase() === "center") {
    out.centred = true;
  }
  return out;
};

/** How a block's words are set: by the block, by what it stands in, and by what wraps all of its words. */
const emphasisOf = (block: Element, hints: StyleHints) => {
  const out = hintsFor(block, hints);
  for (let up = block.parentElement; up && nameOf(up) !== "body"; up = up.parentElement) {
    const outer = hintsFor(up, hints);
    out.centred ||= outer.centred || nameOf(up) === "center";
  }
  // Every word inside <b>, a bold span, <big>: walk the text and see what each piece is in.
  const doc = block.ownerDocument;
  const walker = doc.createTreeWalker(block, 4);
  let pieces = 0;
  let bold = 0;
  let larger = 0;
  let centred = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node as Text).data.trim()) {
      continue;
    }
    pieces += 1;
    let isBold = false;
    let isLarger = false;
    let isCentred = false;
    for (let up = node.parentElement; up && up !== block; up = up.parentElement) {
      const tag = nameOf(up);
      const hint = hintsFor(up, hints);
      isBold ||= tag === "b" || tag === "strong" || hint.bold;
      isLarger ||= tag === "big" || hint.larger || (tag === "font" && Number(up.getAttribute("size")) >= 4);
      isCentred ||= tag === "center" || hint.centred;
    }
    bold += isBold ? 1 : 0;
    larger += isLarger ? 1 : 0;
    centred += isCentred ? 1 : 0;
  }
  if (pieces > 0) {
    out.bold ||= bold === pieces;
    out.larger ||= larger === pieces;
    out.centred ||= centred === pieces;
  }
  return out;
};

const typeOf = (element: Element | null) => (element ? `${element.getAttribute("epub:type") ?? ""} ${element.getAttribute("role") ?? ""}`.trim() : "");

/** A picture's words: its `alt`, or its `title`. */
const pictureWords = (block: Element) => {
  for (const picture of Array.from(block.querySelectorAll("img, image, svg"))) {
    const words = collapse(picture.getAttribute("alt") || picture.getAttribute("title") || picture.getAttribute("aria-label") || "");
    if (words) {
      return words;
    }
  }
  return "";
};

export type SectionScan = {
  section: ScannedSection;
  /** The share of the section's text before each element that has an id. */
  ids: Map<string, number>;
};

/**
 * One section's document as the finder needs it. `cfiBase` is the section's
 * own (epub.js), for a place that has no id; `linkTo` says which section an
 * href (as written in this file) leads to.
 */
export const scanSection = (
  root: Element,
  about: { index: number; href: string; linear: boolean; cfiBase: string; type?: string },
  hints: StyleHints,
  linkTo: (href: string) => { section: number; anchor: string | null } | null
): SectionScan => {
  const doc = root.ownerDocument;
  const body = (nameOf(root) === "body" ? root : root.querySelector("body")) ?? root;
  const blocks: ScannedBlock[] = [];
  const styles: Record<string, number> = {};
  const ids = new Map<string, number>();
  const links: ScannedLink[] = [];
  // First, how much text there is: places are shares of it.
  let total = 0;
  {
    const walker = doc.createTreeWalker(body, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      total += (node as Text).data.length;
    }
  }
  const share = (seen: number) => (total > 0 ? Math.min(1, seen / total) : 0);
  let seen = 0;
  let read = 0;
  let order = 0;
  let pendingBreak = false;
  let opening = "";
  // Elements and text, in reading order.
  const walker = doc.createTreeWalker(body, 5);
  let node: Node | null = walker.nextNode();
  const skip = () => {
    let next: Node | null = walker.nextSibling();
    while (!next && walker.parentNode()) {
      next = walker.nextSibling();
    }
    return next;
  };
  while (node) {
    if (node.nodeType !== 1) {
      const data = (node as Text).data;
      seen += data.length;
      const words = data.trim();
      if (words) {
        read += words.length;
        if (opening.length < 80) {
          opening = collapse(`${opening} ${words}`).slice(0, 80);
        }
      }
      node = walker.nextNode();
      continue;
    }
    const element = node as Element;
    const tag = nameOf(element);
    if (SKIPPED.has(tag)) {
      node = skip();
      continue;
    }
    const id = element.getAttribute("id") || (tag === "a" ? element.getAttribute("name") : null);
    if (id && !ids.has(id)) {
      ids.set(id, share(seen));
    }
    if (tag === "hr") {
      pendingBreak = true;
    }
    if (tag === "a" && element.getAttribute("href") && links.length < 600) {
      const to = linkTo(element.getAttribute("href") ?? "");
      const text = collapse(element.textContent ?? "") || pictureWords(element);
      if (to && text) {
        links.push({ text: text.slice(0, LINE_MAX), section: to.section, anchor: to.anchor, at: null });
      }
    }
    // A block with no block inside it: a line of the page.
    if (BLOCKS.has(tag) && tag !== "body" && tag !== "hr" && !Array.from(element.children).some((child) => BLOCKS.has(nameOf(child)) && nameOf(child) !== "hr")) {
      const own = collapse(element.textContent ?? "");
      const pictured = own ? "" : pictureWords(element);
      const text = own || pictured;
      const style = `${tag}${element.getAttribute("class") ? `.${collapse(element.getAttribute("class") ?? "").split(" ").join(".")}` : ""}`;
      const hasPicture = Boolean(element.querySelector("img, image, svg"));
      if (!text && !hasPicture) {
        // An empty paragraph: the book's blank line.
        pendingBreak = true;
      } else {
        styles[style] = (styles[style] ?? 0) + 1;
        if (text && text.length <= LINE_MAX && blocks.length < BLOCKS_MAX) {
          const heading = /^h[1-6]$/.test(tag);
          const type = `${typeOf(element)} ${nameOf(element.parentElement ?? element) === "hgroup" || nameOf(element.parentElement ?? element) === "header" ? "title" : ""}`;
          const marked = heading || /\b(title|subtitle|fulltitle|halftitle|ordinal|heading|doc-subtitle)\b/.test(type);
          const emphasis = emphasisOf(element, hints);
          const head = read === 0;
          const breaks = pendingBreak || emphasis.breaks || /page-?break/i.test(element.previousElementSibling?.getAttribute("class") ?? "");
          if (marked || head || emphasis.bold || emphasis.centred || emphasis.larger || readHeading(text)) {
            let anchor = element.getAttribute("id") || element.querySelector("[id]")?.getAttribute("id") || "";
            if (!anchor) {
              try {
                anchor = new (EpubCFI as unknown as new (at: Element, base: string) => { toString: () => string })(element, about.cfiBase).toString();
              } catch {
                anchor = "";
              }
            }
            blocks.push({
              text,
              order,
              tag,
              style,
              anchor,
              at: share(seen),
              head,
              marked,
              level: heading ? Number(tag[1]) : 0,
              bold: emphasis.bold || heading,
              centred: emphasis.centred,
              larger: emphasis.larger,
              afterBreak: breaks,
              picture: Boolean(pictured)
            });
          }
        }
        order += 1;
        // A picture alone is not something read: what follows it is still at the head.
        if (own) {
          pendingBreak = false;
        }
      }
    }
    node = walker.nextNode();
  }
  const first = body.firstElementChild;
  const type = `${about.type ?? ""} ${typeOf(body)} ${first && nameOf(first) === "section" ? typeOf(first) : ""}`.trim();
  return {
    section: { index: about.index, href: about.href, linear: about.linear, chars: read, opening, type, pictures: body.querySelectorAll("img, image").length, blocks, styles, links },
    ids
  };
};

/** The element a contents entry's anchor names in a chapter on the page: by id, or by CFI. */
export const anchorElement = (doc: Document, anchor: string): Element | null => {
  if (!isCfiAnchor(anchor)) {
    return elementById(doc, anchor);
  }
  try {
    const range = (new EpubCFI(anchor) as unknown as { toRange: (within: Document) => Range | null }).toRange(doc);
    const node = range?.startContainer ?? null;
    if (!range || !node) {
      return null;
    }
    if (node.nodeType !== 1) {
      return node.parentElement;
    }
    // A place that is an element is given as its parent and its number among the parent's nodes.
    const child = node.childNodes[range.startOffset];
    return child && child.nodeType === 1 ? (child as Element) : (node as Element);
  } catch {
    return null;
  }
};

// epub.js has no types for these internals.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type BookScan = {
  sections: ScannedSection[];
  /** The share of its section before an id: `ids[section].get(id)`. */
  ids: Array<Map<string, number>>;
  /** How long the reading took, and how many sections would not load. */
  ms: number;
  failed: number;
};

/**
 * Every section of the book, read for headings. Between sections the page
 * gets a turn (and a longer one while the reader is scrolling or typing, if
 * the browser can say so).
 */
export const scanBook = async (book: any, options: { signal: { readonly aborted: boolean }; landmarks?: Array<{ href?: string; type?: string }> }): Promise<BookScan | null> => {
  const started = performance.now();
  const items: any[] = book?.spine?.spineItems ?? [];
  const indexByHref = new Map<string, number>();
  items.forEach((item, index) => {
    if (item?.href) {
      indexByHref.set(String(item.href), index);
    }
  });
  const spineIndexOf = (path: string) => indexByHref.get(path);
  // What the stylesheets say of each class.
  let hints: StyleHints = new Map();
  try {
    const manifest: Record<string, { href?: string; type?: string }> = book?.packaging?.manifest ?? {};
    const sheets = Object.values(manifest).filter((item) => item?.type === "text/css" || /\.css$/i.test(item?.href ?? ""));
    let css = "";
    for (const sheet of sheets.slice(0, 12)) {
      if (options.signal.aborted) {
        return null;
      }
      try {
        const text = await book.load(book.resolve(sheet.href));
        css += typeof text === "string" ? `${text}\n` : "";
      } catch {
        // A stylesheet that will not load says nothing.
      }
    }
    hints = styleHints(css);
  } catch {
    hints = new Map();
  }
  const typeByHref = new Map<string, string>();
  (options.landmarks ?? []).forEach((mark) => {
    const path = String(mark?.href ?? "").split("#")[0];
    if (path && mark?.type) {
      typeByHref.set(path, `${typeByHref.get(path) ?? ""} ${mark.type}`.trim());
    }
  });
  const sections: ScannedSection[] = [];
  const ids: Array<Map<string, number>> = [];
  let failed = 0;
  // A turn for the page between sections, and a longer one while the reader's hands are on it.
  const pause = () =>
    new Promise<void>((resolve) => {
      const busy = (navigator as unknown as { scheduling?: { isInputPending?: () => boolean } }).scheduling?.isInputPending?.() === true;
      setTimeout(resolve, busy ? 60 : 0);
    });
  for (let index = 0; index < items.length; index += 1) {
    if (options.signal.aborted) {
      return null;
    }
    const item = items[index];
    const href = String(item?.href ?? "");
    const about = { index, href, linear: item?.linear !== false && item?.linear !== "no", cfiBase: String(item?.cfiBase ?? ""), type: typeByHref.get(href) };
    try {
      const root: Element = await item.load(book.load.bind(book));
      const scan = scanSection(root, about, hints, linkResolver(href, spineIndexOf));
      sections.push(scan.section);
      ids.push(scan.ids);
    } catch {
      failed += 1;
      sections.push({ index, href, linear: about.linear, chars: 0, opening: "", type: about.type ?? "", pictures: 0, blocks: [], styles: {}, links: [] });
      ids.push(new Map());
    } finally {
      try {
        item.unload?.();
      } catch {
        // Nothing was held.
      }
    }
    await pause();
  }
  // Where each link lands, now that every section has been read.
  for (const section of sections) {
    for (const link of section.links) {
      link.at = link.anchor ? (ids[link.section]?.get(link.anchor) ?? null) : 0;
    }
  }
  return { sections, ids, ms: Math.round(performance.now() - started), failed };
};
