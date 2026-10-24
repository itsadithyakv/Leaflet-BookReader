/**
 * A PDF's words as they are read aloud: each page is a section of the
 * player's (`player.ts`), its sentences cut from the page's text as pdf.js
 * gives it (`readers/pdfText.ts`), a page or two at a time as the voice
 * reaches them, never the whole book up front.
 *
 * - Lines are joined as a reader would read them: with a space within a
 *   paragraph, a word hyphenated over the end of a line made whole, and a
 *   new paragraph where the line before ended a sentence short of the
 *   margin, the next is set in, or there is more room between them than
 *   between the lines round them. Larger type on a line of its own is a
 *   heading.
 * - A sentence that runs over the foot of a page onto the next is the first
 *   page's, read once and whole; the next page's own sentences start after
 *   it.
 * - Running headers and footers are left out: a short line at the very top
 *   or foot of the page that stands at the same place on a page either side
 *   (or two either side, for books whose left and right pages differ; up to
 *   four, past a blank page), and a
 *   bare page number there. Nothing else is left out: a header read is
 *   better than a line of the text lost.
 * - A page with no words (a picture, a scanned page) has no sentences.
 *
 * Every character of a section's text knows where it is on its page (its
 * offset in the page's joined text), so a sentence or a word is lit with the
 * same rectangles the search marks with (`matchRects`).
 */
import { matchRects, type JoinedText, type MeasureText, type PageRect } from "../pdfText";
import { chapterSentences, type PauseKind, type Sentence } from "./chapterText";
import { splitSentences, type Span } from "./sentences";
import type { SentenceSource } from "./player";

/** A page's text as `PdfExtras.pageText` gives it: only what is read here. */
export type PdfTextPage = {
  joined: JoinedText;
  /** The page as shown at scale 1. */
  width: number;
  height: number;
  /** Page space to the page as shown (pdf.js `viewport.transform` at scale 1). */
  transform: number[];
  fontFamilies?: Record<string, string>;
};

/** A line of a page: where it is in the joined text, and where it sits on the page as shown (scale 1, origin top left). */
export type PdfLine = {
  start: number;
  end: number;
  text: string;
  left: number;
  right: number;
  /** The baseline, down the page. */
  y: number;
  /** The size of its type. */
  size: number;
};

/** A stretch of a section's text that is a page's own: text[from, to) is the page's joined text from `at`. */
export type Piece = { from: number; to: number; page: number; at: number };

/** Part of a sentence (or a word) on one page, as offsets of that page's joined text. */
export type PagePart = { page: number; start: number; end: number };

/** The share of the page's height at the top and at the foot a running header or footer sits in. */
export const EDGE_BAND = 0.12;
/** How many lines at each end of a page may be a header or a footer. */
const EDGE_LINES = 2;
/** A header is short; anything longer is text. */
const HEADER_CHARS = 100;
/** How near the same height on another page a repeated header stands, as a share of the page. */
const SAME_PLACE = 0.025;
/** Pages either side looked at for the same header... */
const NEIGHBOURS = [-1, 1, -2, 2];
/** ...and further, for one still not found (a blank page or a picture beside it, the last pages of a book). */
const FURTHER = [-3, 3, -4, 4];
/** Pages with nothing to say in a row, after which the reading stops: a scanned book is not read through to its end in search of words. */
export const EMPTY_RUN = 30;

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** The type size most of a page's letters are set in. */
const usualSize = (lines: PdfLine[]) => {
  const sorted = lines.filter((line) => line.size > 0).sort((a, b) => a.size - b.size);
  const total = sorted.reduce((sum, line) => sum + line.text.trim().length, 0);
  let count = 0;
  for (const line of sorted) {
    count += line.text.trim().length;
    if (count * 2 >= total) return line.size;
  }
  return 0;
};

const quantile = (values: number[], share: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * share)))];
};

const shown = (point: [number, number], m: number[]): [number, number] =>
  m.length >= 6 ? [point[0] * m[0] + point[1] * m[2] + m[4], point[0] * m[1] + point[1] * m[3] + m[5]] : point;

const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text);

/** A page's lines, in the order of its text, each placed on the page. */
export const pageLines = (page: PdfTextPage): PdfLine[] => {
  const { text, items, starts } = page.joined;
  const lines: PdfLine[] = [];
  let item = 0;
  let from = 0;
  while (from <= text.length) {
    let to = text.indexOf("\n", from);
    if (to < 0) to = text.length;
    if (to > from) {
      let left = Infinity;
      let right = -Infinity;
      const ys: number[] = [];
      let size = 0;
      while (item < items.length && starts[item] < from) item += 1;
      for (let at = item; at < items.length && starts[at] < to; at += 1) {
        const run = items[at];
        const m = run.transform;
        if (!Array.isArray(m) || m.length < 6 || !run.str.trim()) continue;
        const along = Math.hypot(m[0], m[1]) || 1;
        const start = shown([m[4], m[5]], page.transform);
        const end = shown([m[4] + (m[0] / along) * (run.width || 0), m[5] + (m[1] / along) * (run.width || 0)], page.transform);
        left = Math.min(left, start[0], end[0]);
        right = Math.max(right, start[0], end[0]);
        ys.push(start[1]);
        size = Math.max(size, run.height > 0 ? run.height : Math.hypot(m[2], m[3]));
      }
      if (ys.length > 0) {
        lines.push({ start: from, end: to, text: text.slice(from, to), left, right, y: median(ys), size });
      }
    }
    from = to + 1;
  }
  return lines;
};

/** A line's words, without its numbers (a page number, a roman one in the front matter) or its spacing: what a running header keeps from page to page. */
const headerKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/(^|\s)[ivxlcdm]+(?=\s|$)/g, " ")
    .replace(/[^\p{L}]+/gu, "");

/** A page number on its own ("12", "- 12 -", "xiv", "[3]"). */
const BARE_NUMBER = /^[\s\p{P}\p{S}]*(?:\d{1,4}|[ivxlcdm]{1,8})[\s\p{P}\p{S}]*$/iu;

/** The lines at the top and at the foot of a page, in the band a header or footer sits in: index and which end. */
const edgeLines = (lines: PdfLine[], height: number) => {
  const order = lines.map((line, index) => ({ line, index })).sort((a, b) => a.line.y - b.line.y);
  const top = order.filter(({ line }) => line.y <= height * EDGE_BAND).slice(0, EDGE_LINES);
  const foot = order
    .filter(({ line }) => line.y >= height * (1 - EDGE_BAND))
    .reverse()
    .slice(0, EDGE_LINES);
  return [...top.map((entry) => ({ ...entry, end: "top" as const })), ...foot.map((entry) => ({ ...entry, end: "foot" as const }))];
};

export type PageLines = { lines: PdfLine[]; height: number };

/**
 * Which of a page's lines are a running header or footer, or a page number:
 * the lines to leave unread. `neighbours` are the pages either side, where
 * there are any.
 */
/** How many of a page's lines could be a running header or footer (short, with words, in the band at either end). */
export const headerCandidates = (page: PageLines) =>
  page.height > 0
    ? edgeLines(page.lines, page.height).filter(({ line }) => {
        const text = line.text.trim();
        return text.length > 0 && (BARE_NUMBER.test(text) || (text.length <= HEADER_CHARS && headerKey(text).length > 0));
      }).length
    : 0;

export const runningLines = (page: PageLines, neighbours: ReadonlyArray<PageLines | null>): Set<number> => {
  const skip = new Set<number>();
  if (!(page.height > 0)) return skip;
  const theirs = neighbours
    .filter((other): other is PageLines => Boolean(other && other.height > 0))
    .map((other) => edgeLines(other.lines, other.height).map(({ line, end }) => ({ key: headerKey(line.text), at: line.y / other.height, end })));
  for (const { line, index, end } of edgeLines(page.lines, page.height)) {
    const text = line.text.trim();
    if (!text) continue;
    if (BARE_NUMBER.test(text)) {
      skip.add(index);
      continue;
    }
    if (text.length > HEADER_CHARS) continue;
    const key = headerKey(text);
    if (!key) continue;
    const at = line.y / page.height;
    if (theirs.some((edges) => edges.some((other) => other.end === end && other.key === key && Math.abs(other.at - at) <= SAME_PLACE))) {
      skip.add(index);
    }
  }
  return skip;
};

/** A page's text to be read: its lines but the headers and footers, joined. */
export type PageBody = {
  page: number;
  text: string;
  /** Where the text is on the page (`Piece`s without their page). */
  segs: Array<{ from: number; to: number; at: number }>;
  headings: Span[];
  first: PdfLine | null;
  last: PdfLine | null;
  /** The page's usual type size, and where its lines of text start and end. */
  size: number;
  left: number;
  right: number;
  /** The page has words at all (headers and all): not a picture of a page. */
  hasText: boolean;
};

const TERMINAL = /[.!?…:]["'”’»)\]]*\s*$/u;
const HYPHENATED = /\p{L}[-­‐]\s*$/u;

const isHeadingLine = (line: PdfLine, size: number) => size > 0 && line.size >= size * 1.25 && line.text.trim().length <= 120;

/** How two lines are joined: the characters to take off the end of the first (a hyphen), and what goes between them. */
type Join = { drop: number; between: "" | " " | "\n" };

/** How the last line of one stretch of text goes on into the first of the next. */
const joinOf = (
  a: PdfLine,
  b: PdfLine,
  facts: { aSize: number; bSize: number; left: number; right: number; gap: number | null }
): Join => {
  const aText = a.text;
  const bText = b.text.trimStart();
  if (HYPHENATED.test(aText) && /^\p{Ll}/u.test(bText)) {
    // "exam-" / "ple": one word, as on the page.
    return { drop: aText.length - aText.replace(/[-­‐]\s*$/u, "").length, between: "" };
  }
  const aHeading = isHeadingLine(a, facts.aSize);
  const bHeading = isHeadingLine(b, facts.bSize);
  if (aHeading !== bHeading) return { drop: 0, between: "\n" };
  if (aHeading && bHeading) return { drop: 0, between: " " };
  if (facts.gap !== null && facts.gap > 0 && b.y - a.y > facts.gap * 1.8) return { drop: 0, between: "\n" };
  if (TERMINAL.test(aText)) {
    const room = facts.right - a.right;
    const short = room > Math.max(facts.aSize * 2, (facts.right - facts.left) * 0.08);
    const indented = b.left - facts.left > facts.bSize * 0.8;
    if (short || indented) return { drop: 0, between: "\n" };
  }
  return { drop: 0, between: " " };
};

/** A page's body from its lines, less those `skip` names. */
export const pageBody = (page: number, lines: PdfLine[], skip: ReadonlySet<number>, joinedText: string): PageBody => {
  const kept = lines.filter((_, index) => !skip.has(index) && lines[index].text.trim().length > 0);
  const size = usualSize(kept);
  const body = kept.filter((line) => size <= 0 || Math.abs(line.size - size) <= size * 0.2);
  const left = quantile(body.map((line) => line.left), 0.2);
  const right = quantile(body.map((line) => line.right), 0.9);
  const gaps: number[] = [];
  for (let at = 1; at < body.length; at += 1) {
    const gap = body[at].y - body[at - 1].y;
    if (gap > 0) gaps.push(gap);
  }
  const gap = gaps.length > 0 ? median(gaps) : null;
  let text = "";
  const segs: PageBody["segs"] = [];
  const headings: Span[] = [];
  kept.forEach((line, index) => {
    let own = line.text;
    let at = line.start;
    if (index === 0) {
      // (Its spacing at the start is not worth reading.)
      const lead = own.length - own.trimStart().length;
      own = own.slice(lead);
      at += lead;
    }
    const next = kept[index + 1];
    const join = next ? joinOf(line, next, { aSize: size, bSize: size, left, right, gap }) : { drop: 0, between: "" as const };
    const piece = own.slice(0, own.length - join.drop);
    const from = text.length;
    text += piece;
    segs.push({ from, to: text.length, at });
    if (isHeadingLine(line, size)) {
      const last = headings[headings.length - 1];
      if (last && last.end === from - 1) last.end = text.length;
      else headings.push({ start: from, end: text.length });
    }
    text += join.between;
  });
  return {
    page,
    text,
    segs,
    headings,
    first: kept[0] ?? null,
    last: kept[kept.length - 1] ?? null,
    size,
    left,
    right,
    hasText: hasWords(joinedText)
  };
};

/** How one page's body goes on into the next's. */
export const pageJoin = (a: PageBody, b: PageBody): Join => {
  if (!a.last || !b.first || !hasWords(a.text) || !hasWords(b.text)) return { drop: 0, between: "\n" };
  return joinOf(a.last, b.first, { aSize: a.size, bSize: b.size, left: b.left, right: a.right, gap: null });
};

/** The text before a body's first break: as far into a page as a sentence from the page before can run. */
const headOf = (body: PageBody) => {
  const at = body.text.indexOf("\n");
  return at < 0 ? body.text : body.text.slice(0, at);
};

/** A section: a page's own sentences, and where its text is on the pages. */
export type PdfSection = { page: number; sentences: Sentence[]; pieces: Piece[] };

/** A bounded map, the most recently used last. */
const bounded = <Value>(limit: number) => {
  const map = new Map<number, Value>();
  return {
    get(key: number) {
      const value = map.get(key);
      if (value !== undefined) {
        map.delete(key);
        map.set(key, value);
      }
      return value;
    },
    set(key: number, value: Value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > limit) map.delete(map.keys().next().value as number);
    },
    delete(key: number) {
      map.delete(key);
    },
    clear() {
      map.clear();
    }
  };
};

export type PdfSentenceSource = SentenceSource & {
  /** A page's section, loaded if it is not at hand. */
  section(page: number): Promise<PdfSection | null>;
  /** The section, if it is at hand. */
  sectionNow(page: number): PdfSection | null;
  /** A page's text, if it is at hand. */
  textNow(page: number): PdfTextPage | null;
  /** Where a stretch of a section's text is on its pages. */
  partsOf(section: number, start: number, end: number): PagePart[];
  /** Whether a page has words at all (a picture of a page has none). */
  hasText(page: number): Promise<boolean>;
  /** The reading stopped at a long run of pages with nothing to read, not at the end of the book. */
  readonly stoppedAtGap: boolean;
  forget(): void;
};

/**
 * The sentences of a PDF, a page at a time. `readPage` is the document's
 * page text (kept by the document itself for a bounded number of pages).
 */
export const createPdfSentenceSource = ({
  pageCount,
  readPage
}: {
  pageCount: () => number;
  readPage: (page: number) => Promise<PdfTextPage | null>;
}): PdfSentenceSource => {
  const texts = bounded<Promise<{ text: PdfTextPage | null; lines: PageLines | null }>>(16);
  const textsNow = bounded<PdfTextPage>(16);
  const bodies = bounded<Promise<PageBody | null>>(10);
  const sections = bounded<Promise<PdfSection | null>>(8);
  const sectionsNow = bounded<PdfSection>(8);
  const empty = new Set<number>();
  let stoppedAtGap = false;

  const inBook = (page: number) => page >= 1 && page <= pageCount();

  const linesOf = (page: number) => {
    let kept = texts.get(page);
    if (!kept) {
      kept = readPage(page)
        .catch(() => null)
        .then((text) => {
          if (!text) return { text: null, lines: null };
          textsNow.set(page, text);
          return { text, lines: { lines: pageLines(text), height: text.height } };
        });
      texts.set(page, kept);
    }
    return kept;
  };

  const bodyOf = (page: number): Promise<PageBody | null> => {
    if (!inBook(page)) return Promise.resolve(null);
    let kept = bodies.get(page);
    if (!kept) {
      kept = (async () => {
        const own = await linesOf(page);
        if (!own.text || !own.lines) return null;
        if (!hasWords(own.text.joined.text)) {
          return pageBody(page, [], new Set(), "");
        }
        const around = (steps: number[]) => Promise.all(steps.map((step) => (inBook(page + step) ? linesOf(page + step).then((read) => read.lines) : null)));
        const near = await around(NEIGHBOURS);
        let skip = runningLines(own.lines, near);
        if (skip.size < headerCandidates(own.lines)) {
          skip = runningLines(own.lines, [...near, ...(await around(FURTHER))]);
        }
        return pageBody(page, own.lines.lines, skip, own.text.joined.text);
      })();
      bodies.set(page, kept);
    }
    return kept;
  };

  /**
   * Where a page's own sentences start: past the end of the one that began
   * on the page before and runs on into it. That one is found by cutting the
   * foot of the page before as its own section is cut: from its last break
   * (a sentence never runs over one, so it is cut the same from there), or
   * from where its own sentences start.
   */
  const carryInto = async (page: number, depth = 0): Promise<number> => {
    if (page <= 1) return 0;
    const [before, body] = await Promise.all([bodyOf(page - 1), bodyOf(page)]);
    if (!before || !body || !hasWords(before.text) || !hasWords(body.text)) return 0;
    const join = pageJoin(before, body);
    if (join.between === "\n") return 0;
    const upTo = before.text.length - join.drop;
    const lastBreak = before.text.lastIndexOf("\n", upTo - 1);
    const from = lastBreak >= 0 ? lastBreak + 1 : depth < 3 ? Math.min(upTo, await carryInto(page - 1, depth + 1)) : 0;
    const tail = before.text.slice(from, upTo);
    const head = headOf(body);
    const window = tail + join.between + head;
    const into = tail.length + join.between.length;
    const across = splitSentences(window).find((span) => span.start < tail.length && span.end > into);
    return across ? Math.min(body.text.length, across.end - into) : 0;
  };

  /** The pause before a page's first sentence: none within a sentence's paragraph, a paragraph's after a break. */
  const leadInto = async (page: number, body: PageBody, carry: number, first: Sentence): Promise<PauseKind> => {
    const gap = body.text.slice(carry, carry + Math.max(0, first.start));
    let kind: PauseKind;
    if (carry > 0) {
      kind = gap.includes("\n") ? "paragraph" : "sentence";
    } else if (page <= 1) {
      kind = "chapter";
    } else {
      const before = await bodyOf(page - 1);
      kind = before && hasWords(before.text) && pageJoin(before, body).between !== "\n" && !gap.includes("\n") ? "sentence" : "paragraph";
    }
    return kind === "paragraph" && first.heading ? "heading" : kind;
  };

  const build = async (page: number): Promise<PdfSection | null> => {
    if (!inBook(page)) return null;
    const body = await bodyOf(page);
    if (!body || !hasWords(body.text)) return { page, sentences: [], pieces: [] };
    const carry = await carryInto(page);
    const next = inBook(page + 1) ? await bodyOf(page + 1) : null;
    const join = next ? pageJoin(body, next) : { drop: 0, between: "" as const };
    const upTo = Math.max(carry, body.text.length - join.drop);
    const own = body.text.slice(carry, upTo);
    const head = next && join.between !== "\n" ? headOf(next) : "";
    const between = head ? join.between : "";
    const text = own + between + head;
    const pieces: Piece[] = [];
    const headings: Span[] = [];
    const place = (from: PageBody, shift: number, lo: number, hi: number) => {
      for (const seg of from.segs) {
        const a = Math.max(seg.from, lo);
        const b = Math.min(seg.to, hi);
        if (b > a) pieces.push({ from: a + shift, to: b + shift, page: from.page, at: seg.at + (a - seg.from) });
      }
      for (const span of from.headings) {
        const a = Math.max(span.start, lo);
        const b = Math.min(span.end, hi);
        if (b > a) headings.push({ start: a + shift, end: b + shift });
      }
    };
    place(body, -carry, carry, upTo);
    if (next && head) place(next, own.length + between.length, 0, head.length);
    const all = chapterSentences({ text, headings }, page);
    const sentences = all.filter((sentence) => sentence.start < own.length);
    if (sentences.length > 0) {
      sentences[0] = { ...sentences[0], lead: await leadInto(page, body, carry, sentences[0]) };
    }
    return { page, sentences, pieces };
  };

  const section = (page: number) => {
    let kept = sections.get(page);
    if (!kept) {
      kept = build(page).then((made) => {
        if (made) sectionsNow.set(page, made);
        return made;
      });
      kept.catch(() => sections.delete(page));
      sections.set(page, kept);
    }
    return kept;
  };

  const partsIn = (made: PdfSection, start: number, end: number): PagePart[] => {
    const parts: PagePart[] = [];
    for (const piece of made.pieces) {
      const a = Math.max(piece.from, start);
      const b = Math.min(piece.to, end);
      if (b <= a) continue;
      const from = piece.at + (a - piece.from);
      const to = piece.at + (b - piece.from);
      const last = parts[parts.length - 1];
      if (last && last.page === piece.page) {
        last.start = Math.min(last.start, from);
        last.end = Math.max(last.end, to);
      } else {
        parts.push({ page: piece.page, start: from, end: to });
      }
    }
    return parts;
  };

  return {
    async load(page) {
      const made = await section(page);
      if (!made) return null;
      if (made.sentences.length === 0) empty.add(page);
      else empty.delete(page);
      return made.sentences;
    },
    after(page) {
      if (!inBook(page + 1)) return null;
      // A long run of pages with nothing to read: the rest is pictures, not words to be looked for one page at a time.
      let run = 0;
      for (let at = page; at >= 1 && empty.has(at); at -= 1) run += 1;
      if (run >= EMPTY_RUN) {
        stoppedAtGap = true;
        return null;
      }
      stoppedAtGap = false;
      return page + 1;
    },
    before(page) {
      return inBook(page - 1) ? page - 1 : null;
    },
    section,
    sectionNow: (page) => sectionsNow.get(page) ?? null,
    textNow: (page) => textsNow.get(page) ?? null,
    partsOf(page, start, end) {
      const made = sectionsNow.get(page);
      return made ? partsIn(made, start, end) : [];
    },
    async hasText(page) {
      const read = await linesOf(page);
      return Boolean(read.text && hasWords(read.text.joined.text));
    },
    get stoppedAtGap() {
      return stoppedAtGap;
    },
    forget() {
      texts.clear();
      textsNow.clear();
      bodies.clear();
      sections.clear();
      sectionsNow.clear();
      empty.clear();
    }
  };
};

/** The rectangles of a part of a page, as fractions of the page (as the search's marks are). */
export const partRects = (text: PdfTextPage, part: PagePart, measure?: MeasureText): PageRect[] =>
  matchRects(text.joined, { start: part.start, end: part.end }, text.transform, text.width, text.height, measure);
