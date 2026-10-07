/**
 * The text of a PDF page, for searching it and for marking what was found.
 *
 * pdf.js gives a page's text as a list of items, each a run of characters
 * with a place on the page. A phrase can run across several items (every
 * change of font starts a new one) and across the end of a line, so the items
 * are joined into one string first, keeping where each began; a match in the
 * string can then be traced back to the items it covers and, through their
 * places, to rectangles on the page. Pure, so it can be tested without a PDF.
 */

/** A text item as pdf.js gives it; only what is read here. */
export type TextItem = {
  str: string;
  /** Text space to page space: [a, b, c, d, e, f]. (e, f) is where the baseline starts. */
  transform: number[];
  /** The run's length along its baseline, in page units. */
  width: number;
  /** The font's height, in page units. */
  height: number;
  hasEOL?: boolean;
  /** pdf.js's name for the run's font, for looking its family up. */
  fontName?: string;
};

export type JoinedText = {
  /** The page's text, a line break for each end of line. */
  text: string;
  /** The items that carry characters, in order. */
  items: TextItem[];
  /** Where each of those items begins in `text`. */
  starts: number[];
};

export type TextMatch = { start: number; end: number };

/** A rectangle on the page, as fractions of the page's width and height. */
export type PageRect = { left: number; top: number; width: number; height: number };

/** The shortest phrase worth searching a whole document for. */
export const MIN_QUERY = 2;

const textOf = (item: Partial<TextItem> | null | undefined) => (item && typeof item.str === "string" ? item.str : null);

/** An upright run of text with a size: the only kind a drop cap is looked for among. */
const upright = (item: Partial<TextItem>): item is TextItem => {
  const m = item.transform;
  return (
    Array.isArray(m) &&
    m.length >= 6 &&
    m[0] > 0 &&
    Math.abs(m[1]) <= m[0] * 0.01 &&
    Number(item.height) > 0 &&
    Number(item.width) > 0
  );
};

/**
 * A drop cap: the first letter of a paragraph set several times the size of
 * the text, the rest of its word on the line beside it. To pdf.js it is a run
 * of its own, on another baseline from the line it begins, and it may be
 * followed by an end of line. Left so, "The" is "T" and "he": the search
 * cannot find the word and a selection copies it broken in two.
 *
 * Decided by where things are: a run at least 1.6 times the height of the
 * run after it, whose right edge meets that run's left edge, with that run's
 * baseline somewhere in the large run's height, and no space between them
 * (none at the end of the one or the start of the other, and no space run in
 * between). The end of line between such a pair is taken out; nothing else is
 * changed. A raised initial, on the same baseline as its line, is the same
 * case. Apart from that the items are returned as they came.
 */
export const mendDropCaps = <Item extends Partial<TextItem> | null | undefined>(items: ReadonlyArray<Item>): Item[] => {
  const mended = items.slice();
  for (let at = 0; at < mended.length; at += 1) {
    const cap = mended[at];
    const capText = textOf(cap);
    if (!cap || !capText || /\s$/.test(capText) || !upright(cap)) {
      continue;
    }
    // The run after it: past markers and empty end-of-line runs, but not past a space.
    let after = at + 1;
    while (after < mended.length && (textOf(mended[after]) === null || textOf(mended[after]) === "")) {
      after += 1;
    }
    const next = mended[after];
    const nextText = textOf(next);
    if (!next || !nextText || /^\s/.test(nextText) || !upright(next)) {
      continue;
    }
    if (cap.height < next.height * 1.6) {
      continue;
    }
    const gap = next.transform[4] - (cap.transform[4] + cap.width);
    const rise = next.transform[5] - cap.transform[5];
    const meets = gap >= -0.25 * cap.height && gap <= 0.3 * cap.height;
    const beside = rise >= -0.1 * cap.height && rise <= cap.height;
    if (!meets || !beside) {
      continue;
    }
    if (cap.hasEOL) {
      mended[at] = { ...cap, hasEOL: false } as Item;
    }
    // Empty runs between them that only end the line go; markers stay.
    for (let between = after - 1; between > at; between -= 1) {
      if (textOf(mended[between]) === "") {
        mended.splice(between, 1);
      }
    }
  }
  return mended;
};

/** Joins a page's items into one searchable string. */
export const joinTextItems = (items: ReadonlyArray<Partial<TextItem> | null | undefined>): JoinedText => {
  let text = "";
  const kept: TextItem[] = [];
  const starts: number[] = [];
  for (const item of items) {
    // Marked-content markers sit in the same list and carry no text.
    if (!item || typeof item.str !== "string") {
      continue;
    }
    if (item.str.length > 0) {
      kept.push(item as TextItem);
      starts.push(text.length);
      text += item.str;
    }
    if (item.hasEOL && text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
    }
  }
  return { text, items: kept, starts };
};

/** True when the page has something to search: letters or digits, not only spacing. */
export const hasSearchableText = (text: string) => /[\p{L}\p{N}]/u.test(text);

const escapeForPattern = (char: string) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One character of the phrase, as the pattern looks for it. A typed
 * apostrophe or quotation mark finds a curly one, and the other way round, as
 * the library's search does (src-tauri/src/search.rs): it opens a PDF here on
 * the words it found (readers/pdfFindPlace.ts), and they have to be found again.
 */
const charPattern = (char: string) =>
  /['‘’‚‛ʼ]/.test(char) ? "['‘’‚‛ʼ]" : /["“”„‟]/.test(char) ? '["“”„‟]' : escapeForPattern(char);

/**
 * Letters without their accents, for comparing: "café" as "cafe", "Zürich"
 * as "Zurich". One character for one, so a place in the folded text is the
 * same place in the text itself; a letter that does not come apart into a
 * letter and its accent (ß, æ, ø) is left as it is.
 */
export const foldAccents = (text: string) =>
  text.replace(/[À-ɏḀ-ỿ]/g, (char) => {
    const base = char.normalize("NFD").replace(/\p{M}+/gu, "");
    return base.length === 1 ? base : char;
  });

/**
 * The pattern a phrase is looked for with. Case and accents are ignored (the
 * text searched is folded the same way, `findMatches`); a space in the
 * phrase matches any run of spacing, so a phrase is found where the line
 * breaks inside it; and a word is found where it was hyphenated over the end
 * of a line ("exam-" / "ple").
 */
export const searchPattern = (query: string): RegExp | null => {
  const words = foldAccents(query).trim().split(/\s+/).filter(Boolean);
  if (words.join(" ").length < MIN_QUERY) {
    return null;
  }
  const source = words
    .map((word) =>
      Array.from(word)
        .map((char, index, chars) =>
          index === chars.length - 1
            ? charPattern(char)
            : // A hyphen typed may itself be where the line ended ("harness-" / "room").
              charPattern(char) + (char === "-" ? "\\n?" : "(?:-\\n)?")
        )
        .join("")
    )
    .join("\\s+");
  try {
    return new RegExp(source, "giu");
  } catch {
    return null;
  }
};

/** Every place the phrase occurs in the text, in order, up to `limit`. */
export const findMatches = (text: string, query: string, limit = Infinity): TextMatch[] => {
  const pattern = searchPattern(query);
  const matches: TextMatch[] = [];
  if (!pattern || !text) {
    return matches;
  }
  // "cafe" finds "café": most of what is searched for is typed without its accents.
  const plain = foldAccents(text);
  for (let found = pattern.exec(plain); found && matches.length < limit; found = pattern.exec(plain)) {
    if (found[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    matches.push({ start: found.index, end: found.index + found[0].length });
  }
  return matches;
};

/**
 * A phrase that runs over the end of one page onto the next: where it begins
 * in the first page's text and where it ends in the second's, or null. Only
 * the foot of the one and the head of the other are looked at, joined as two
 * lines are, so the page break may fall at a space or at a hyphen like any
 * end of line. A phrase wholly on either page is that page's own match and
 * is not found here.
 */
export const matchAcross = (before: string, after: string, query: string): { start: number; end: number } | null => {
  if (!before || !after || !searchPattern(query)) {
    return null;
  }
  const reach = Math.max(64, query.length * 3 + 16);
  // The spacing a page ends and begins with is not part of the break: the two are joined as one line end.
  const ended = before.trimEnd();
  const foot = ended.slice(-reach);
  const begun = after.trimStart();
  const head = begun.slice(0, reach);
  const found = findMatches(`${foot}\n${head}`, query).find(
    (match) => match.start < foot.length && match.end > foot.length + 1
  );
  return found
    ? {
        start: ended.length - foot.length + found.start,
        end: after.length - begun.length + found.end - foot.length - 1
      }
    : null;
};

/**
 * What to mark on one page for a phrase: every match wholly on it, in order;
 * then, last, the part on this page of a match that runs on over the page
 * break (the search lists that match under this page, with that place among
 * its matches); and apart from those, the end of a match that began on the
 * page before.
 */
export const pageMatches = (
  text: string,
  query: string,
  limit = Infinity,
  textBefore: string | null = null,
  textAfter: string | null = null
): { own: TextMatch[]; head: TextMatch | null } => {
  const own = findMatches(text, query, limit);
  const onward = textAfter ? matchAcross(text, textAfter, query) : null;
  if (onward) {
    own.push({ start: onward.start, end: text.length });
  }
  const carried = textBefore ? matchAcross(textBefore, text, query) : null;
  return { own, head: carried ? { start: 0, end: carried.end } : null };
};

/**
 * Which of a page's marks is the result on show (`pageMarks` puts them in
 * the search's order): the result's own place among its page's matches; on
 * the page after a result that runs over the page break, the head; null
 * where the result is on neither.
 */
export const currentMark = (
  active: { page: number; nth: number; across?: boolean } | null,
  page: number,
  marks: { rects: PageRect[][]; head: boolean } | null | undefined
): number | null => {
  if (!active) {
    return null;
  }
  if (active.page === page) {
    return active.nth;
  }
  return active.across && active.page === page - 1 && marks?.head ? marks.rects.length - 1 : null;
};

export type Snippet = { before: string; match: string; after: string };

const oneLine = (text: string) => text.replace(/-\n(?=\p{Ll})/gu, "").replace(/\s+/g, " ");

/**
 * The words around a match, for the list of results: about `radius`
 * characters each side, cut at a word where there is one, on one line.
 */
export const snippetAt = (text: string, match: TextMatch, radius = 48): Snippet => {
  let from = Math.max(0, match.start - radius);
  let to = Math.min(text.length, match.end + radius);
  if (from > 0) {
    const space = text.slice(from, match.start).search(/\s/);
    from = space >= 0 ? from + space + 1 : from;
  }
  if (to < text.length) {
    const tail = text.slice(match.end, to);
    const space = tail.search(/\s\S*$/);
    to = space > 0 ? match.end + space : to;
  }
  const before = oneLine(text.slice(from, match.start)).replace(/^\s+/, "");
  const after = oneLine(text.slice(match.end, to)).replace(/\s+$/, "");
  return {
    before: (from > 0 ? "…" : "") + before,
    match: oneLine(text.slice(match.start, match.end)),
    after: after + (to < text.length ? "…" : "")
  };
};

/**
 * How wide a piece of a run is, in any unit: only the share of the whole run
 * is used. The default counts characters; the view measures them in the run's
 * own kind of face, as pdf.js's text layer does, so a mark and a selection of
 * the same word agree.
 */
export type MeasureText = (text: string, item: TextItem) => number;

const byCount: MeasureText = (text) => text.length;

const applyTransform = (point: [number, number], m: number[]): [number, number] => [
  point[0] * m[0] + point[1] * m[2] + m[4],
  point[0] * m[1] + point[1] * m[3] + m[5]
];

// A letter reaches above its baseline and a little below it.
const ASCENT = 0.86;
const DESCENT = 0.24;

/**
 * Where a match is on the page: one rectangle for each stretch of a line it
 * covers. `viewportTransform` is the page's own (pdf.js `viewport.transform`
 * at scale 1), which turns page space, origin bottom left, into the page as
 * shown, origin top left, rotated as the page is. The rectangles are
 * fractions of the page, so they stay on the words at any zoom.
 */
export const matchRects = (
  joined: JoinedText,
  match: TextMatch,
  viewportTransform: number[],
  pageWidth: number,
  pageHeight: number,
  measure: MeasureText = byCount
): PageRect[] => {
  const rects: PageRect[] = [];
  if (!(pageWidth > 0) || !(pageHeight > 0)) {
    return rects;
  }
  joined.items.forEach((item, index) => {
    const itemStart = joined.starts[index];
    const from = Math.max(match.start, itemStart) - itemStart;
    const to = Math.min(match.end, itemStart + item.str.length) - itemStart;
    if (to <= from || !(item.width > 0) || !Array.isArray(item.transform)) {
      return;
    }
    const [a, b, c, d, e, f] = item.transform;
    const along = Math.hypot(a, b);
    const up = Math.hypot(c, d);
    if (!(along > 0) || !(up > 0)) {
      return;
    }
    const whole = measure(item.str, item);
    const share = (count: number) =>
      whole > 0 ? measure(item.str.slice(0, count), item) / whole : count / item.str.length;
    const x0 = item.width * share(from);
    const x1 = item.width * share(to);
    const height = item.height > 0 ? item.height : up;
    const ux = a / along;
    const uy = b / along;
    const vx = c / up;
    const vy = d / up;
    const corners = [
      [x0, -DESCENT * height],
      [x1, -DESCENT * height],
      [x1, ASCENT * height],
      [x0, ASCENT * height]
    ].map(([s, t]) => applyTransform([e + ux * s + vx * t, f + uy * s + vy * t], viewportTransform));
    const xs = corners.map((corner) => corner[0]);
    const ys = corners.map((corner) => corner[1]);
    const left = Math.max(0, Math.min(...xs));
    const top = Math.max(0, Math.min(...ys));
    const right = Math.min(pageWidth, Math.max(...xs));
    const bottom = Math.min(pageHeight, Math.max(...ys));
    if (right - left < 0.01 || bottom - top < 0.01) {
      return;
    }
    const rect = { left, top, width: right - left, height: bottom - top };
    // Runs on the same line that touch are one stretch of highlight, not
    // several laid over each other.
    const last = rects[rects.length - 1];
    if (
      last &&
      Math.abs(last.top - rect.top) < rect.height * 0.5 &&
      // Of a size: a drop cap and the letters beside it are two boxes.
      Math.abs(last.height - rect.height) <= Math.min(last.height, rect.height) * 0.35 &&
      rect.left <= last.left + last.width + rect.height * 0.6 &&
      rect.left + rect.width >= last.left
    ) {
      const mergedTop = Math.min(last.top, rect.top);
      const mergedBottom = Math.max(last.top + last.height, rect.top + rect.height);
      const mergedRight = Math.max(last.left + last.width, rect.left + rect.width);
      last.top = mergedTop;
      last.height = mergedBottom - mergedTop;
      last.width = mergedRight - last.left;
      return;
    }
    rects.push(rect);
  });
  return rects.map((rect) => ({
    left: rect.left / pageWidth,
    top: rect.top / pageHeight,
    width: rect.width / pageWidth,
    height: rect.height / pageHeight
  }));
};

/** A page's text as the marks need it (readers/pageSources.ts `PdfPageText`). */
type MarkedText = { joined: JoinedText; transform: number[]; width: number; height: number };

/**
 * A page's marks for a phrase: a list of rectangles for each match on it, in
 * the order the search numbers them (`pageMatches`), and, when `head` says
 * so, one more list at the end for the end of a match that began on the page
 * before. `before` and `after` are the neighbouring pages' text, where they
 * are known.
 */
export const pageMarks = (
  text: MarkedText,
  query: string,
  limit: number,
  before: string | null,
  after: string | null,
  measure?: MeasureText
): { rects: PageRect[][]; head: boolean } => {
  const { own, head } = pageMatches(text.joined.text, query, limit, before, after);
  const rects = own.map((match) => matchRects(text.joined, match, text.transform, text.width, text.height, measure));
  if (head) {
    rects.push(matchRects(text.joined, head, text.transform, text.width, text.height, measure));
  }
  return { rects, head: head !== null };
};
