/**
 * Chapters for a PDF that has no table of contents of its own.
 *
 * Many PDFs carry no outline: a scan put through OCR, a manuscript exported
 * from a word processor, a paper. For those the sidebar had only "Page 1,
 * Page 2 ...". Here a contents list is worked out from the pages themselves,
 * in two ways, the surer first:
 *
 * 1. **A printed contents page whose lines are links.** A page near the front
 *    with a column of links into the document is a contents page; each link's
 *    line is a title and its destination the page.
 * 2. **Headings by their type.** The size most of the text is set in is the
 *    body size. A short line clearly larger than that at the top of a page,
 *    or one that says "Chapter 12", "PART TWO" or is a bare numeral, is a
 *    chapter heading. Running heads and page numbers are also short lines at
 *    the top of a page, and are told apart by the one thing headings never
 *    do: they repeat, at the same height, page after page.
 *
 * A made list that is wrong is worse than none, so the rules give up easily:
 * fewer than three headings, headings that do not agree in size or height, or
 * a "heading" on nearly every page (slides: the page list already serves) all
 * mean no list. A scan has no text at all and is reported as one, so the
 * sidebar can say why there are no chapters.
 *
 * Each page is boiled down to a few facts as it is read (`digestPage`), so a
 * whole book is a few hundred kilobytes and its text need not be kept. Pure:
 * the pages come in as runs of text with sizes and places, as pdf.js gives
 * them, so the rules are tested on made-up pages.
 */

import type { OutlineEntry } from "./pdfOutline";
import type { PageLink } from "./pdfLinks";
import type { TextItem } from "./pdfText";

/** A line of a page: the runs on one baseline. Places are fractions of the page. */
export type PageLine = { text: string; size: number; top: number; left: number; right: number };

/** What is kept of one page. */
export type PageFacts = {
  /** 1-based. */
  page: number;
  /** How many characters of text the page has. */
  chars: number;
  /** How much of it is set in each size (to the half point): [size, characters]. */
  sizes: Array<[number, number]>;
  /** The first lines from the top of the page. */
  head: PageLine[];
  /** The last lines: a running foot and a page number live here. */
  foot: PageLine[];
  /** For a page with a column of links into the document: each link's line and where it goes. */
  contents?: Array<{ title: string; page: number; left: number }>;
};

export type FoundChapters = {
  entries: OutlineEntry[];
  /** How they were found; null when no list was made. */
  from: "contents" | "headings" | null;
  /** The document has no text to read: pictures of pages. */
  scan: boolean;
};

/** How many lines from the top of a page are kept, and from its foot. */
const HEAD_LINES = 7;
const FOOT_LINES = 2;
/** A page with this many links into the document, one a line, is a contents page. */
const CONTENTS_LINKS = 5;
/** A heading is at least this much larger than the body. */
const LARGER = 1.18;
/** No chapter title is longer. */
const MAX_TITLE = 90;
const MAX_ENTRIES = 400;

/**
 * One space between words, and letters set apart for show closed up: a
 * heading printed "C H A P T E R  T H R E E" is read by OCR as single
 * letters, and would not be known for a chapter.
 */
const clean = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/(?<![\p{L}\p{N}])(?:\p{L} ){2,}\p{L}(?![\p{L}\p{N}])/gu, (spaced) => spaced.replace(/ /g, ""))
    .trim();

/**
 * A page's lines from its runs. Runs that follow one another on one baseline
 * are a line; a gap between them wider than a fifth of the type is a space.
 * `transform` takes page space to the page as shown at scale 1 (`width` by
 * `height`), as pdf.js's viewport gives it.
 */
export const pageLines = (
  items: ReadonlyArray<Partial<TextItem> | null | undefined>,
  transform: ReadonlyArray<number>,
  width: number,
  height: number
): PageLine[] => {
  if (!(width > 0) || !(height > 0) || transform.length < 6) {
    return [];
  }
  type Open = { text: string; size: number; x: number; y: number; right: number };
  const lines: Open[] = [];
  for (const item of items) {
    const run = item?.str;
    const at = item?.transform;
    if (typeof run !== "string" || !run.trim() || !Array.isArray(at) || at.length < 6) {
      continue;
    }
    const x = transform[0] * at[4] + transform[2] * at[5] + transform[4];
    const y = transform[1] * at[4] + transform[3] * at[5] + transform[5];
    const size = Math.hypot(at[2], at[3]) || item?.height || 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(size > 0)) {
      continue;
    }
    const right = x + (Number.isFinite(item?.width) ? (item?.width as number) : 0);
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) < Math.max(1.5, Math.min(size, last.size) * 0.35) && x >= last.x - size) {
      last.text += (x - last.right > size * 0.2 && !/\s$/.test(last.text) && !/^\s/.test(run) ? " " : "") + run;
      last.right = Math.max(last.right, right);
      // A drop cap or a superscript does not set the line's size: the size most of it has does.
      if (run.trim().length > last.text.trim().length / 2) {
        last.size = size;
      }
    } else {
      lines.push({ text: run, size, x, y, right });
    }
  }
  return lines
    .map((line) => ({
      text: clean(line.text),
      size: Math.round(line.size * 2) / 2,
      // The baseline, less the type's height: about where the line's top is.
      top: Math.max(0, Math.min(1, (line.y - line.size) / height)),
      left: Math.max(0, Math.min(1, line.x / width)),
      right: Math.max(0, Math.min(1, line.right / width))
    }))
    .filter((line) => line.text.length > 0)
    .sort((a, b) => a.top - b.top || a.left - b.left);
};

/** Dot leaders and the page number after a contents line's title. */
const withoutLeader = (text: string) =>
  clean(
    text
      .replace(/(?:\s*[.·…_•]){3,}\s*\S{0,8}\s*$/, "")
  );

/**
 * What is kept of a page: how much text in which sizes, its first and last
 * lines, and, when it has a column of links into the document, those.
 */
export const digestPage = (
  page: number,
  text: { items: ReadonlyArray<Partial<TextItem> | null | undefined>; transform: ReadonlyArray<number>; width: number; height: number },
  links: ReadonlyArray<PageLink> = []
): PageFacts => {
  const lines = pageLines(text.items, text.transform, text.width, text.height);
  const sizes = new Map<number, number>();
  let chars = 0;
  for (const line of lines) {
    const count = line.text.replace(/\s/g, "").length;
    chars += count;
    sizes.set(line.size, (sizes.get(line.size) ?? 0) + count);
  }
  const facts: PageFacts = {
    page,
    chars,
    sizes: [...sizes.entries()],
    head: lines.slice(0, HEAD_LINES),
    foot: lines.slice(Math.max(HEAD_LINES, lines.length - FOOT_LINES))
  };
  const inward = links.filter(
    (link): link is PageLink & { target: { kind: "page"; page: number; left: number | null; top: number | null } } =>
      link.target.kind === "page" && link.target.page !== page
  );
  if (inward.length >= CONTENTS_LINKS) {
    const contents: NonNullable<PageFacts["contents"]> = [];
    for (const link of [...inward].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)) {
      const middle = link.rect.top + link.rect.height / 2;
      // The line the link lies on: the one whose own height its middle falls in.
      const line = lines.find((candidate) => middle >= candidate.top - 0.004 && middle <= candidate.top + (candidate.size / text.height) * 1.5);
      const title = line ? withoutLeader(line.text) : "";
      const before = contents[contents.length - 1];
      // Several link areas on one line (the title, then its page number) are one entry.
      if (title && !(before && before.title === title && before.page === link.target.page)) {
        contents.push({ title: title.slice(0, MAX_TITLE), page: link.target.page, left: line ? line.left : link.rect.left });
      }
    }
    if (contents.length >= CONTENTS_LINKS) {
      facts.contents = contents;
    }
  }
  return facts;
};

// ---- a printed contents page ----------------------------------------------------

const fromContents = (pages: ReadonlyArray<PageFacts>, pageCount: number): OutlineEntry[] => {
  // Contents pages sit together near the front; the first run of them is taken.
  const front = pages.filter((page) => page.contents && page.page <= Math.max(40, pageCount * 0.2));
  const run: PageFacts[] = [];
  for (const page of front) {
    const before = run[run.length - 1]?.contents;
    // The list goes on over the page only if it goes on forward: the page
    // after the contents is often a title page with a list of its own.
    if (before && (page.page - run[run.length - 1].page > 2 || (page.contents?.[0]?.page ?? 0) < before[before.length - 1].page)) {
      break;
    }
    run.push(page);
  }
  const listed = run.flatMap((page) => page.contents ?? []).filter((entry) => entry.page >= 1 && entry.page <= pageCount);
  if (listed.length < 3 || new Set(listed.map((entry) => entry.page)).size < 3) {
    return [];
  }
  // A contents list goes forward through the book. An index of names, or a
  // page of cross-references, does not.
  let forward = 0;
  for (let at = 1; at < listed.length; at += 1) {
    if (listed[at].page >= listed[at - 1].page) {
      forward += 1;
    }
  }
  if (forward < (listed.length - 1) * 0.85) {
    return [];
  }
  const margin = Math.min(...listed.map((entry) => entry.left));
  // "Chapter One 12": where most lines end in their page number, it is not part of the title.
  const numbered = /\s+(?:\d{1,4}|[ivxlc]{1,7})$/i;
  const strip = listed.filter((entry) => numbered.test(entry.title)).length >= listed.length * 0.7;
  return listed.slice(0, MAX_ENTRIES).map((entry) => ({
    title: (strip ? entry.title.replace(numbered, "") : entry.title) || entry.title,
    page: entry.page,
    // A section sits in from its chapter.
    depth: entry.left > margin + 0.025 ? 1 : 0
  }));
};

// ---- headings by their type --------------------------------------------------------

const NUMBER_WORD =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[- ]?(?:one|two|three|four|five|six|seven|eight|nine))?|thirty|forty|fifty";
/** Loosely: any run of these letters standing as a word. Chapters past LXXXIX are not looked for. */
const ROMAN = "[ivxl]{1,7}";
/** "Chapter 12", "CHAPTER XII", "Part Two", "Book the Third" is not tried for. */
const NUMBERED = new RegExp(`^(?:chapter|part|book|section|lesson|act|canto)\\s+(?:\\d{1,3}|${NUMBER_WORD}|${ROMAN})\\b`, "i");
/** The parts of a book that have a name of their own. */
const NAMED =
  /^(?:prologue|epilogue|introduction|foreword|preface|afterword|appendix(?:\s+[a-z0-9]{1,3})?|acknowledge?ments|conclusion|interlude|contents|table of contents|notes|endnotes|bibliography|references|glossary|index|about the author|dedication|a note on the text)\.?$/i;
/** A numeral standing alone: "7", "VII", "Seven". */
const BARE_NUMBER = new RegExp(`^(?:\\d{1,3}|${NUMBER_WORD}|${ROMAN})\\.?$`, "i");

const letters = (text: string) => (text.match(/\p{L}/gu) ?? []).length;

/**
 * A line as running heads are compared: its words without digits (the page
 * number beside them changes), case or spaces, and its size. Not its height:
 * on a scan that wanders by a line from page to page.
 */
const repeatKey = (line: PageLine) => {
  const text = line.text.toLowerCase().replace(/[\d\s.,;:·•|–—-]+/g, "");
  return text ? `${text}@${Math.round(line.size)}` : "";
};

/** How near two pages must be for the same line on both to be a running head. */
const RUNNING_WITHIN = 4;

/** A page number by itself, or with a rule or dashes about it: "12", "- 12 -", "xiv". */
const isPageNumber = (line: PageLine) => /^[\s\-–—·•|]*(?:\d{1,4}|[ivxlc]{1,7})[\s\-–—·•|]*$/i.test(line.text) && line.text.replace(/\W/g, "").length <= 6;

type Candidate = { page: number; title: string; size: number; top: number; labelled: boolean };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/** The size most of the document's text is set in. */
export const bodySize = (pages: ReadonlyArray<PageFacts>): number => {
  const sizes = new Map<number, number>();
  for (const page of pages) {
    for (const [size, chars] of page.sizes) {
      sizes.set(size, (sizes.get(size) ?? 0) + chars);
    }
  }
  let best = 0;
  let most = 0;
  for (const [size, chars] of sizes) {
    if (chars > most) {
      best = size;
      most = chars;
    }
  }
  return best;
};

const fromHeadings = (pages: ReadonlyArray<PageFacts>, pageCount: number): OutlineEntry[] => {
  const body = bodySize(pages);
  if (!(body > 0)) {
    return [];
  }
  // Lines that come back on the pages around: running heads and feet. A
  // book's title on the left pages and the chapter's on the right are both
  // caught, each by its own repeats two pages on. "Chapter 1" and "Chapter 2"
  // are the same line once the digits are gone, but they are chapters apart,
  // which is why the repeats must be near.
  const seenOn = new Map<string, number[]>();
  for (const page of pages) {
    for (const key of new Set([...page.head, ...page.foot].map(repeatKey))) {
      if (key) {
        const list = seenOn.get(key) ?? [];
        list.push(page.page);
        seenOn.set(key, list);
      }
    }
  }
  const running = (line: PageLine, page: number) =>
    (seenOn.get(repeatKey(line)) ?? []).filter((other) => other !== page && Math.abs(other - page) <= RUNNING_WITHIN).length >= 2;

  const candidates: Candidate[] = [];
  for (const page of pages) {
    // What the page opens with, once the head is taken away.
    const big = (line: PageLine) => line.size >= body * LARGER;
    // A numeral in the body's size is the page's number; a large one may be the chapter's.
    const opening = page.head.filter((line) => line.top < 0.55 && !(isPageNumber(line) && !big(line)) && !running(line, page.page)).slice(0, 4);
    const usable = (line: PageLine) => line.text.length <= MAX_TITLE && line.text.split(" ").length <= 14;
    const large = (line: PageLine) => big(line) && usable(line) && letters(line.text) >= 2;
    // In the body's own size, "Chapter 3" is a heading only when it stands
    // alone: a short line, not the start of a sentence that fills the measure.
    const alone = (line: PageLine) => big(line) || (line.text.length <= 48 && line.right - line.left < 0.6);
    const label = opening
      .slice(0, 3)
      .find(
        (line) =>
          line.size >= body * 0.98 &&
          usable(line) &&
          // A numeral alone is a chapter's only over a page of text: a half-title
          // or a plate with a figure on it is not a chapter.
          (((NUMBERED.test(line.text) || NAMED.test(line.text)) && alone(line)) || (BARE_NUMBER.test(line.text) && big(line) && page.chars >= 200))
      );
    const first = opening.slice(0, 3).find((line) => line !== label && large(line));
    // A title set over two or three lines of one size.
    const title: PageLine[] = [];
    if (first) {
      for (const line of opening.slice(opening.indexOf(first))) {
        if (line !== label && large(line) && Math.abs(line.size - first.size) <= 0.5 && title.length < 3) {
          title.push(line);
        } else if (title.length > 0) {
          break;
        }
      }
    }
    const words = title.map((line) => line.text).join(" ");
    if (label) {
      // "CHAPTER ONE" and the title under it are one entry; a named part ("Foreword") stands alone.
      const full = words && !NAMED.test(label.text) && label.top <= (first?.top ?? 1) ? `${label.text}: ${words}` : label.text;
      candidates.push({ page: page.page, title: clean(full).slice(0, MAX_TITLE), size: first ? first.size : label.size, top: label.top, labelled: true });
    } else if (first && !/[.,;:]$/.test(words)) {
      candidates.push({ page: page.page, title: clean(words).slice(0, MAX_TITLE), size: first.size, top: first.top, labelled: false });
    }
  }

  const labelled = candidates.filter((candidate) => candidate.labelled);
  let chosen: Candidate[];
  if (labelled.length >= 3) {
    // The numbered chapters, and whatever else is set exactly as their titles
    // are ("A Note on Sources", "Epilogue" in another language).
    const size = median(labelled.map((candidate) => candidate.size));
    const top = median(labelled.map((candidate) => candidate.top));
    chosen = candidates.filter(
      (candidate) => candidate.labelled || (size >= body * LARGER && Math.abs(candidate.size - size) <= size * 0.04 && Math.abs(candidate.top - top) <= 0.1)
    );
  } else {
    // No chapter says it is one: the size most headings share, if they share
    // a place on the page as well.
    const classes: Candidate[][] = [];
    for (const candidate of [...candidates].sort((a, b) => a.size - b.size)) {
      const last = classes[classes.length - 1];
      // Within a twentieth of the smallest in its class: one size, as a scan measures it.
      if (last && candidate.size <= last[0].size * 1.05) {
        last.push(candidate);
      } else {
        classes.push([candidate]);
      }
    }
    const largest = [...classes].sort((a, b) => b.length - a.length || b[0].size - a[0].size)[0] ?? [];
    const top = median(largest.map((candidate) => candidate.top));
    const together = largest.filter((candidate) => Math.abs(candidate.top - top) <= 0.1);
    chosen = together.length >= largest.length * 0.8 ? together : [];
  }
  // Too few to be a book's chapters; or one on most pages, which is a deck of
  // slides, whose page list already is its contents.
  if (chosen.length < 3 || (pageCount >= 10 && chosen.length > pageCount * 0.4)) {
    return [];
  }
  return chosen
    .sort((a, b) => a.page - b.page)
    .slice(0, MAX_ENTRIES)
    .map((candidate) => ({ title: candidate.title, page: candidate.page, depth: 0 }));
};

/**
 * The chapters of a document from its pages' facts (every page, in any
 * order). An empty list when the rules are not sure.
 */
export const findChapters = (pages: ReadonlyArray<PageFacts>, pageCount: number): FoundChapters => {
  const withText = pages.filter((page) => page.chars >= 20).length;
  if (pages.length > 0 && withText === 0) {
    return { entries: [], from: null, scan: true };
  }
  const ordered = [...pages].sort((a, b) => a.page - b.page);
  const contents = fromContents(ordered, pageCount);
  if (contents.length > 0) {
    return { entries: contents, from: "contents", scan: false };
  }
  const headings = fromHeadings(ordered, pageCount);
  return { entries: headings, from: headings.length > 0 ? "headings" : null, scan: false };
};

// ---- reading a document, and keeping what was found ------------------------------

type ReadOptions = {
  pageCount: number;
  /** A page's facts (`digestPage` over its text and links). */
  factsOf: (page: number) => Promise<PageFacts>;
  /** Asked before every page: false once the book is closed. */
  stillWanted: () => boolean;
  /** Lets the window draw and take input; resolves when the reading may go on. */
  breathe: () => Promise<void>;
  /** A clock, for tests. */
  now?: () => number;
};

/** How long the reading may run before it lets the window have a turn. */
const BREATHE_AFTER_MS = 10;

/**
 * Reads every page's facts, one page at a time, and finds the chapters. Null
 * when the book was closed on the way. A page that cannot be read is a page
 * with nothing on it.
 */
export const readChapters = async ({ pageCount, factsOf, stillWanted, breathe, now = () => performance.now() }: ReadOptions): Promise<FoundChapters | null> => {
  const pages: PageFacts[] = [];
  let since = now();
  for (let page = 1; page <= pageCount; page += 1) {
    if (!stillWanted()) {
      return null;
    }
    try {
      pages.push(await factsOf(page));
    } catch {
      pages.push({ page, chars: 0, sizes: [], head: [], foot: [] });
    }
    if (now() - since >= BREATHE_AFTER_MS) {
      await breathe();
      since = now();
    }
  }
  return stillWanted() ? findChapters(pages, pageCount) : null;
};

/** Where a book's found chapters are kept on this device (services/deviceData.ts clears them). */
export const CHAPTERS_KEY_PREFIX = "leaflet.pdfChapters.";
/** Raised when the rules change, so lists made by older rules are made again. */
const RULES = 1;

type Kept = { rules: number; pages: number; from: FoundChapters["from"]; scan: boolean; entries: Array<[string, number, number]> };

/** What was found, as it is stored. */
export const packChapters = (found: FoundChapters, pageCount: number): string => {
  const kept: Kept = {
    rules: RULES,
    pages: pageCount,
    from: found.from,
    scan: found.scan,
    entries: found.entries.map((entry) => [entry.title, entry.page, entry.depth])
  };
  return JSON.stringify(kept);
};

/**
 * What was stored, if it was made by these rules for a document of this many
 * pages (the same id with another page count is another file); null otherwise,
 * or for anything that is not what `packChapters` wrote.
 */
export const unpackChapters = (stored: string | null | undefined, pageCount: number): FoundChapters | null => {
  if (!stored) {
    return null;
  }
  try {
    const kept = JSON.parse(stored) as Partial<Kept> | null;
    if (!kept || kept.rules !== RULES || kept.pages !== pageCount || !Array.isArray(kept.entries)) {
      return null;
    }
    const entries: OutlineEntry[] = [];
    for (const entry of kept.entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Number.isInteger(entry[1]) || entry[1] < 1 || entry[1] > pageCount) {
        return null;
      }
      entries.push({ title: entry[0], page: entry[1], depth: Number.isInteger(entry[2]) ? Math.max(0, Math.min(4, entry[2])) : 0 });
    }
    const from = kept.from === "contents" || kept.from === "headings" ? kept.from : null;
    return { entries: from ? entries : [], from: entries.length > 0 ? from : null, scan: kept.scan === true };
  } catch {
    return null;
  }
};
