/**
 * Links on a PDF page.
 *
 * pdf.js gives a page's annotations as plain objects; the ones of the `Link`
 * kind have a rectangle on the page and somewhere to go: a destination inside
 * the document (a name to look up, or an array naming a page and how to show
 * it), or an address. Here an annotation is turned into what the reader can
 * do with it, its rectangle into fractions of the page as shown (so the area
 * holds at any zoom, on a turned page too), and a destination into a page and
 * a height on it. Pure, so the rules can be tested without a PDF; the lookups
 * a destination needs are passed in, as for the outline (pdfOutline.ts).
 *
 * What is followed: a destination in this document, and an http or https
 * address, which opens in the reader's browser (never in this window). What
 * is not: every other scheme (file:, javascript:, mailto: and the rest),
 * launching a program, another file, an attachment, a form's action. Those
 * get no area at all.
 */

import type { PageRect } from "./pdfText";

/** A link annotation as pdf.js gives it; only what is read here. */
export type LinkAnnotation = {
  subtype?: string;
  rect?: number[];
  /** An address pdf.js has checked the form of. */
  url?: string | null;
  /** A destination in this document: a name, or [page, how, ...numbers]. */
  dest?: string | unknown[] | null;
  /** A named action: NextPage, PrevPage, FirstPage, LastPage. */
  action?: string | null;
};

/** Where a link goes, before its destination is looked up. */
export type LinkAction =
  | { kind: "dest"; dest: string | unknown[] }
  | { kind: "step"; to: "next" | "prev" | "first" | "last" }
  | { kind: "web"; url: string };

const STEPS: Record<string, "next" | "prev" | "first" | "last"> = {
  NextPage: "next",
  PrevPage: "prev",
  FirstPage: "first",
  LastPage: "last"
};

/**
 * The address a web link opens, or null for one that is not followed. Only
 * http and https, with a host; http is opened as https, as the text reader
 * opens a book's links (the app's opener takes https and a mail address,
 * `mailAddress` below, and nothing else).
 */
export const webAddress = (url: unknown): string | null => {
  if (typeof url !== "string") {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    return null;
  }
  parsed.protocol = "https:";
  return parsed.href;
};

/**
 * What a "write to us" link opens, or null: `mailto:` and one plain address.
 * Whatever follows the address (`?subject=`, `&body=`, `&attach=`) is left
 * off, so a link in a book starts a letter and writes none of it. The
 * backend's opener checks the same (`openable_link`).
 */
export const mailAddress = (url: unknown): string | null => {
  if (typeof url !== "string") {
    return null;
  }
  const found = /^mailto:([a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\?.*)?$/i.exec(url.trim());
  if (!found || found[1].length > 254 || /(?:^|[.@])-|-(?:[.]|$)/.test(found[1].split("@")[1])) {
    return null;
  }
  return `mailto:${found[1]}`;
};

/** What a link annotation does, or null for one that gets no area. */
export const linkAction = (annotation: LinkAnnotation | null | undefined): LinkAction | null => {
  if (!annotation || annotation.subtype !== "Link") {
    return null;
  }
  const dest = annotation.dest;
  if (typeof dest === "string" ? dest.length > 0 : Array.isArray(dest) && dest.length > 0) {
    return { kind: "dest", dest: dest as string | unknown[] };
  }
  if (annotation.url) {
    // A mail address is opened as a web one is: by the system, not here.
    const url = webAddress(annotation.url) ?? mailAddress(annotation.url);
    return url ? { kind: "web", url } : null;
  }
  const step = typeof annotation.action === "string" ? STEPS[annotation.action] : undefined;
  return step ? { kind: "step", to: step } : null;
};

const applyTransform = (x: number, y: number, m: number[]): [number, number] => [
  x * m[0] + y * m[2] + m[4],
  x * m[1] + y * m[3] + m[5]
];

/**
 * A link's rectangle as fractions of the page as shown. `rect` is in the
 * page's own space (origin bottom left, [x1, y1, x2, y2]); `viewportTransform`
 * is pdf.js's `viewport.transform` at scale 1, which turns that into the page
 * as shown, origin top left, turned as the page is. Null for a rectangle with
 * no size, or off the page.
 */
export const linkRect = (
  rect: number[] | null | undefined,
  viewportTransform: number[],
  pageWidth: number,
  pageHeight: number
): PageRect | null => {
  if (!Array.isArray(rect) || rect.length < 4 || !rect.slice(0, 4).every(Number.isFinite)) {
    return null;
  }
  if (!(pageWidth > 0) || !(pageHeight > 0)) {
    return null;
  }
  const [ax, ay] = applyTransform(rect[0], rect[1], viewportTransform);
  const [bx, by] = applyTransform(rect[2], rect[3], viewportTransform);
  const left = Math.max(0, Math.min(ax, bx));
  const top = Math.max(0, Math.min(ay, by));
  const right = Math.min(pageWidth, Math.max(ax, bx));
  const bottom = Math.min(pageHeight, Math.max(ay, by));
  if (right - left < 1 || bottom - top < 1) {
    return null;
  }
  return {
    left: left / pageWidth,
    top: top / pageHeight,
    width: (right - left) / pageWidth,
    height: (bottom - top) / pageHeight
  };
};

const isRef = (value: unknown): value is { num: number; gen: number } =>
  typeof value === "object" &&
  value !== null &&
  Number.isInteger((value as { num?: unknown }).num) &&
  Number.isInteger((value as { gen?: unknown }).gen);

const numberOr = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * The point of its page an explicit destination shows, in the page's own
 * space: `[page, /XYZ, left, top, zoom]`, `[page, /FitH, top]`,
 * `[page, /FitR, left, bottom, right, top]` and their kin. Null where the
 * destination only names the page (`/Fit`), or leaves the number out.
 */
export const destPoint = (dest: unknown[]): { left: number | null; top: number | null } => {
  const how = dest[1];
  const name = typeof how === "object" && how !== null ? (how as { name?: unknown }).name : how;
  switch (name) {
    case "XYZ":
      return { left: numberOr(dest[2]), top: numberOr(dest[3]) };
    case "FitH":
    case "FitBH":
      return { left: null, top: numberOr(dest[2]) };
    case "FitV":
    case "FitBV":
      return { left: numberOr(dest[2]), top: null };
    case "FitR":
      return { left: numberOr(dest[2]), top: numberOr(dest[5]) };
    default:
      return { left: null, top: null };
  }
};

export type DestLookups = {
  /** A named destination's array, or null when the name is unknown. */
  getDestination: (name: string) => Promise<unknown[] | null>;
  /** The 0-based index of the page a reference points at. */
  getPageIndex: (ref: { num: number; gen: number }) => Promise<number>;
};

/** A destination found: the page (from 1) and the point of it to show, in the page's own space. */
export type DestTarget = { page: number; left: number | null; top: number | null };

/**
 * Finds where a destination goes. Null for a name that is not known, a page
 * that is not in the document, or anything that is not a destination.
 */
export const resolveDest = async (
  dest: string | unknown[],
  lookups: DestLookups,
  pageCount: number
): Promise<DestTarget | null> => {
  try {
    const target = typeof dest === "string" ? await lookups.getDestination(dest) : dest;
    if (!Array.isArray(target) || target.length === 0) {
      return null;
    }
    const first = target[0];
    const index = isRef(first) ? await lookups.getPageIndex(first) : Number.isInteger(first) ? (first as number) : null;
    if (index === null || !Number.isInteger(index) || index < 0 || index >= pageCount) {
      return null;
    }
    return { page: index + 1, ...destPoint(target) };
  } catch {
    return null;
  }
};

/**
 * How far down its page (as shown) a destination's point is, 0 to 1, or null
 * when it names no height. `viewportTransform` is the destination page's.
 */
export const destFraction = (
  target: { left: number | null; top: number | null },
  viewportTransform: number[],
  pageWidth: number,
  pageHeight: number
): number | null => {
  // On a page turned a quarter, "down the page as shown" comes from the point's left.
  const turned = Math.abs(viewportTransform[0]) < 1e-6 && Math.abs(viewportTransform[3]) < 1e-6;
  const needed = turned ? target.left : target.top;
  if (needed === null || !(pageHeight > 0)) {
    return null;
  }
  const y = applyTransform(target.left ?? 0, target.top ?? 0, viewportTransform)[1];
  return Number.isFinite(y) ? Math.min(1, Math.max(0, y / pageHeight)) : null;
};

/** A link as the page reader lays it over a page. */
export type PageLink = {
  rect: PageRect;
  /** What the reader is told it does: "Go to page 12", or the address. */
  label: string;
  target:
    | { kind: "page"; page: number; left: number | null; top: number | null }
    | { kind: "step"; to: "next" | "prev" | "first" | "last" }
    | { kind: "web"; url: string };
};

const STEP_LABEL = { next: "Next page", prev: "Previous page", first: "First page", last: "Last page" } as const;

/**
 * A page's links, ready to lay over it, from its annotations. Destinations
 * are looked up (each page reference once); a link whose destination is not
 * found, or that is not followed, is left out.
 */
export const pageLinks = async (
  annotations: ReadonlyArray<LinkAnnotation | null | undefined>,
  viewportTransform: number[],
  pageWidth: number,
  pageHeight: number,
  lookups: DestLookups,
  pageCount: number
): Promise<PageLink[]> => {
  const pages = new Map<string, Promise<number>>();
  const once: DestLookups = {
    getDestination: lookups.getDestination,
    getPageIndex: (ref) => {
      const key = `${ref.num}R${ref.gen}`;
      let known = pages.get(key);
      if (!known) {
        known = lookups.getPageIndex(ref);
        pages.set(key, known);
      }
      return known;
    }
  };
  const found = await Promise.all(
    annotations.map(async (annotation): Promise<PageLink | null> => {
      const action = linkAction(annotation);
      const rect = action ? linkRect(annotation?.rect, viewportTransform, pageWidth, pageHeight) : null;
      if (!action || !rect) {
        return null;
      }
      if (action.kind === "web") {
        return { rect, label: action.url.startsWith("mailto:") ? `Write to ${action.url.slice(7)}` : action.url, target: action };
      }
      if (action.kind === "step") {
        return { rect, label: STEP_LABEL[action.to], target: action };
      }
      const target = await resolveDest(action.dest, once, pageCount);
      return target ? { rect, label: `Go to page ${target.page}`, target: { kind: "page", ...target } } : null;
    })
  );
  return found.filter((link): link is PageLink => link !== null);
};

/**
 * The link at a point of the page (fractions of its width and height), or
 * null. The last one drawn wins where two overlap, as on the page.
 */
export const linkAt = (links: ReadonlyArray<PageLink>, x: number, y: number): PageLink | null => {
  for (let index = links.length - 1; index >= 0; index -= 1) {
    const { rect } = links[index];
    if (x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height) {
      return links[index];
    }
  }
  return null;
};
