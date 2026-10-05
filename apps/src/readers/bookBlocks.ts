/**
 * What the publisher did with a block, kept through the reader's own rules.
 *
 * The reader gives running text one size, one line spacing, one left edge
 * and a gap between paragraphs, whatever the book's stylesheet says. Books
 * whose structure is in that stylesheet and not in their tags lost it:
 *
 * - a chapter's number and title set as centred, larger paragraphs (no h1 to
 *   h6 anywhere: the usual shape of a conversion from a Kindle file) came
 *   out as two ordinary lines of body text at the left edge, and a picture
 *   alone in a centred paragraph sat at the left edge;
 * - a book with no `<p>` at all (`<div class="para"><span>`) had no gap and
 *   no indent between its paragraphs: one unbroken wall of text;
 * - a scene break made of space alone (a paragraph with a margin above it,
 *   or a rule the book draws blank) vanished, since every paragraph has a
 *   gap above it and margins collapse;
 * - an inset block (an epigraph, a letter, verse) lost its left margin and
 *   kept its right one.
 *
 * As with drop caps (dropCaps.ts), they are recognised by what they are, not
 * by one publisher's class names, from the book's own computed styles, read
 * before the reader's stylesheet goes in; they are marked, and the reader's
 * rules make room for the marks. The reader's choices (justified or not, the
 * line spacing, the size) still govern every ordinary paragraph.
 *
 * Also here, since they are the same pass over the same blocks: a box sized
 * by the window (a cover in a `95vh` box, which is nothing at all in a frame
 * as tall as its content), a cover's SVG wrapper told to stretch, and a list
 * a conversion flattened into paragraphs, bullets and all.
 */

// ---- what a block is ------------------------------------------------------------------

/** A block as the publisher styled it. Lengths in px. */
export type BlockFacts = {
  tag: string;
  /** It holds words or inline things directly: no block inside it. */
  leaf: boolean;
  /** How many characters of text it has. */
  chars: number;
  /** It holds a picture. */
  picture: boolean;
  /** Computed `text-align`. */
  align: string;
  /** The size of its words (the smaller of its first and last), and of the book's running text. */
  size: number;
  running: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  textIndent: number;
  /** The width it stands in. */
  room: number;
};

/** A heading is this much larger than the running text, at least. */
export const HEADING_MIN_RATIO = 1.15;
/** No styled paragraph outranks a real h1 (1.6 in the reader). */
export const HEADING_MAX_RATIO = 1.6;
/** A heading is a line or two. */
export const HEADING_MAX_CHARS = 150;
/** An inset is this many ems of the running text, at least (a contents page's 1em steps are not). */
export const INSET_MIN_EMS = 1.15;
/** An inset takes at most this share of the column on a side. */
export const INSET_MAX_SHARE = 40;
/** A paragraph set apart has this many ems more above it than paragraphs usually do. */
export const BREAK_MIN_EMS = 0.9;

const isHeadingTag = (tag: string) => /^h[1-6]$/.test(tag);

/** Centred or set to the right by the publisher: kept. */
export const keptAlign = (facts: Pick<BlockFacts, "align" | "leaf" | "chars" | "picture">): "center" | "right" | null => {
  if (!facts.leaf || (facts.chars === 0 && !facts.picture)) {
    return null;
  }
  const align = facts.align.replace("-webkit-", "");
  return align === "center" ? "center" : align === "right" || align === "end" ? "right" : null;
};

/**
 * A paragraph that is a heading in all but its tag: short, and set larger
 * than the running text from its first word to its last. The size to keep,
 * as a multiple of the reading size; or null.
 */
export const headingSize = (facts: Pick<BlockFacts, "tag" | "leaf" | "chars" | "size" | "running">): number | null => {
  if (!facts.leaf || isHeadingTag(facts.tag) || facts.chars === 0 || facts.chars > HEADING_MAX_CHARS || facts.running <= 0) {
    return null;
  }
  const ratio = facts.size / facts.running;
  return ratio >= HEADING_MIN_RATIO ? Math.min(HEADING_MAX_RATIO, Math.round(ratio * 100) / 100) : null;
};

/** A `div` that is a paragraph: words directly in it. */
export const isParagraphDiv = (facts: Pick<BlockFacts, "tag" | "leaf" | "chars">) => facts.tag === "div" && facts.leaf && facts.chars > 0;

/**
 * An inset block: the left margin to keep and the right one with it, as
 * shares of the column (percentages), or null. A hanging indent (a margin
 * with the first line pulled back by as much: a glossary, a list of names)
 * is no inset; what is left of the margin after the pull is.
 */
export const keptInset = (facts: Pick<BlockFacts, "marginLeft" | "marginRight" | "textIndent" | "running" | "room">): { left: number; right: number } | null => {
  const net = facts.marginLeft + Math.min(0, facts.textIndent);
  if (facts.running <= 0 || facts.room <= 0 || net < facts.running * INSET_MIN_EMS) {
    return null;
  }
  const share = (px: number) => Math.round(Math.min(INSET_MAX_SHARE, (Math.max(0, px) / facts.room) * 100) * 10) / 10;
  return { left: share(net), right: share(facts.marginRight) };
};

/** A hanging indent pulls the first line back by no more than this share of the column. */
export const HANG_MAX_SHARE = 15;

/**
 * A hanging indent, as the book set it: a first line pulled back (a
 * negative `text-indent`) into a left margin at least as wide, so that the
 * lines after the first stand in from it (a glossary's entries, a contents
 * page, verse whose long lines turn over). The pull and what is left of the
 * margin beside it, as shares of the column; or null. It is the shape of the
 * entry, not a page margin, and is kept wherever it is found.
 */
export const keptHang = (facts: Pick<BlockFacts, "marginLeft" | "marginRight" | "textIndent" | "running" | "room">): { hang: number; left: number; right: number } | null => {
  const pull = -facts.textIndent;
  if (facts.room <= 0 || facts.running <= 0 || pull < 2 || facts.marginLeft < pull - 1) {
    return null;
  }
  const share = (px: number, most: number) => Math.round(Math.min(most, (Math.max(0, px) / facts.room) * 100) * 10) / 10;
  return { hang: share(pull, HANG_MAX_SHARE), left: share(facts.marginLeft - pull, INSET_MAX_SHARE), right: share(facts.marginRight, INSET_MAX_SHARE) };
};

// ---- verse -------------------------------------------------------------------------------

/** A line of verse is no longer than this. */
export const VERSE_MAX_CHARS = 100;
/** Lines of one stanza have no more than this between them, in ems of the running text, as the book set them. */
export const VERSE_TIGHT_EMS = 0.35;
/** A gap wider than this is not a stanza break: what follows is something else. */
export const VERSE_APART_EMS = 2.5;

/** A paragraph as a possible line of verse, as the publisher styled it. */
export type VerseLine = {
  chars: number;
  /** The space the book leaves above it, from the block before (px). */
  gap: number;
  textIndent: number;
  /** Set off from the running text: inset from the left edge, or centred. */
  set: boolean;
  /** It ends as a sentence does: a stop, a question or exclamation mark, a closing quote after one. */
  endsSentence: boolean;
  /** A heading, a link on its own (a contents line), a line set to the right: never verse. */
  other: boolean;
};

export type VerseRun = { from: number; to: number; /** The lines (after the first) that start a stanza, with the gap to keep in ems. */ stanzas: Array<{ line: number; gap: number }> };

/**
 * The runs of verse among paragraphs that follow one another (null: a block
 * that is not a paragraph of text, which ends a run).
 *
 * A book sets a poem or a song as one short paragraph for each line, with
 * nothing between the lines, and the reader, which puts a paragraph's gap
 * under every paragraph, drew a poem as a list of separate remarks. Lines of
 * verse are told from prose by how the book sets them: short, with no
 * first-line indent, nothing between them, and either set off from the text
 * (inset, or centred: two lines are enough) or, in a book that indents its
 * prose, three or more of them of which most do not end as sentences.
 * Dialogue in short paragraphs is prose: it has the prose's indent, or the
 * prose's gap, and it ends in stops.
 */
export const verseRuns = (lines: ReadonlyArray<VerseLine | null>, running: number, proseIndented: boolean): VerseRun[] => {
  const runs: VerseRun[] = [];
  const fits = (line: VerseLine | null): line is VerseLine => line !== null && !line.other && line.chars >= 1 && line.chars <= VERSE_MAX_CHARS && line.textIndent <= 0.5;
  let at = 0;
  while (at < lines.length) {
    const first = lines[at];
    if (!fits(first)) {
      at += 1;
      continue;
    }
    let to = at;
    while (to + 1 < lines.length) {
      const next = lines[to + 1];
      if (!fits(next) || next.set !== first.set || next.gap > running * VERSE_APART_EMS) {
        break;
      }
      to += 1;
    }
    const count = to - at + 1;
    const stanzas: VerseRun["stanzas"] = [];
    let tight = 0;
    let sentences = first.endsSentence ? 1 : 0;
    for (let index = at + 1; index <= to; index += 1) {
      const line = lines[index] as VerseLine;
      sentences += line.endsSentence ? 1 : 0;
      if (line.gap <= running * VERSE_TIGHT_EMS) {
        tight += 1;
      } else {
        stanzas.push({ line: index, gap: Math.round(Math.min(1.6, Math.max(0.6, line.gap / Math.max(1, running))) * 10) / 10 });
      }
    }
    // Most of the lines stand in stanzas of two or more, as the book has them.
    const together = tight >= 1 && tight >= stanzas.length;
    const verse = first.set ? count >= 2 && together : proseIndented && count >= 3 && tight >= 2 && together && sentences * 2 <= count;
    if (verse) {
      runs.push({ from: at, to, stanzas });
    }
    at = to + 1;
  }
  return runs;
};

/** Whether a line ends as a sentence does. */
export const endsAsSentence = (text: string) => /[.!?…]["'”’»)\]]*$/.test(text.trim());

/**
 * Whether the "insets" are the book's own page margin: most of the text is
 * under one (every paragraph has the same left margin, or the whole chapter
 * sits in an indented box). The reader has its own margins; those are not
 * kept. A page too short to tell (a part title and its epigraph) keeps them.
 */
export const insetsAreMargins = (insetChars: number, totalChars: number) => totalChars >= 1500 && insetChars > totalChars * 0.5;

/** The middle of a list of numbers (0 for none). */
export const median = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

/**
 * A paragraph set apart from the one before it by space alone: a scene
 * break. `gap` is the space the publisher left between the two (margins
 * collapse: the larger of the one's bottom and the other's top), `usual` the
 * space between this book's paragraphs as a rule.
 */
export const isSetApart = (gap: number, usual: number, running: number) => running > 0 && gap - usual >= running * BREAK_MIN_EMS;

/**
 * The room such a paragraph gets above the reader's gap between paragraphs,
 * in ems: what the publisher left, between one line's worth and two (the
 * groups of a copyright page are not scene breaks, and are not set as far
 * apart).
 */
export const breakRoom = (gap: number, usual: number, running: number) => Math.round(Math.min(2, Math.max(1, (gap - usual) / Math.max(1, running))) * 10) / 10;

/** A rule (`hr`) as the book and the reader's theme together draw it. */
export type RuleFacts = {
  /** Any border with a width and a style that draws. */
  border: boolean;
  height: number;
  /** A background colour that is not transparent, or a background picture. */
  filled: boolean;
  hidden: boolean;
};

/**
 * - "blank": the book draws nothing (`border: none`): a scene break made of
 *   space, which needs the room a scene break has here;
 * - "own": the book draws its rule itself (a filled box, a picture) and the
 *   reader's hairline has landed on top of it: one of the two goes;
 * - "plain": one line, the book's or the reader's.
 */
export const ruleKind = (facts: RuleFacts): "blank" | "own" | "plain" => {
  const drawsItself = facts.filled && facts.height > 0;
  if (facts.hidden || (!facts.border && !drawsItself)) {
    return "blank";
  }
  return facts.border && drawsItself ? "own" : "plain";
};

// ---- a list flattened into paragraphs ----------------------------------------------------

const BULLET = /^[o•◦○●▪■·∙*–-]$/;
/** A flattened list's item is a line, not a paragraph of prose. */
export const LISTED_MAX_CHARS = 80;
/** This many bullets in a row, each with its item, before any of them is taken for a list. */
export const LISTED_MIN_ITEMS = 3;

export const isLoneBullet = (text: string) => BULLET.test(text.trim());

/**
 * A list a conversion flattened: paragraphs that are a single bullet
 * character ("o", "•"), each followed by its item as a paragraph of its own.
 * Given the texts of paragraphs that follow one another, which are the
 * bullets to hide and which the items. Three bullets in a row, each with a
 * short item after it, at the least: a paragraph that is a lone "o" in the
 * middle of a story stays.
 */
export const flattenedList = (texts: readonly string[]): { bullets: number[]; items: number[] } => {
  const bullets: number[] = [];
  const items: number[] = [];
  let at = 0;
  while (at < texts.length) {
    const run: number[] = [];
    let next = at;
    while (next + 1 < texts.length && isLoneBullet(texts[next])) {
      const item = texts[next + 1].trim();
      if (!item || item.length > LISTED_MAX_CHARS || isLoneBullet(item)) {
        break;
      }
      run.push(next);
      next += 2;
    }
    if (run.length >= LISTED_MIN_ITEMS) {
      run.forEach((bullet) => {
        bullets.push(bullet);
        items.push(bullet + 1);
      });
    }
    at = run.length > 0 ? next : at + 1;
  }
  return { bullets, items };
};

const plainLine = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:]+$/, "")
    .trim();

/**
 * The contents entry a line of such a list names: "Chapter 3." is the entry
 * "Chapter 3", or "Chapter 3 · The Road". -1 when none does, or when two do.
 */
export const entryForLine = (line: string, labels: readonly string[]): number => {
  const wanted = plainLine(line);
  if (!wanted) {
    return -1;
  }
  let found = -1;
  for (let index = 0; index < labels.length; index += 1) {
    const label = plainLine(labels[index]);
    const rest = label.startsWith(wanted) ? label.slice(wanted.length) : null;
    if (rest === null || !(rest === "" || /^(\s*[·:—–-]\s|\.\s)/.test(rest))) {
      continue;
    }
    if (found >= 0) {
      return -1;
    }
    found = index;
  }
  return found;
};

// ---- sizes that depend on the window -------------------------------------------------------

const WINDOW_UNIT = /(^|[\s(,+*/-])\d*\.?\d+(vh|vmin|vmax|svh|lvh|dvh)\b/i;

/** A length in units of the window's height ("95vh", "calc(100vh - 2em)"). */
export const sizedByWindow = (value: string | null | undefined) => Boolean(value) && WINDOW_UNIT.test(String(value));

/**
 * Rules that undo heights given in the window's height. A chapter's frame is
 * as tall as its content, so "95vh" is 95% of whatever the content came to:
 * nothing, at first, and a picture set to fill such a box was 0 by 0 (a
 * book's cover: it opened on a blank band). With pages the box was 95% of
 * the window, taller than a page's room, and spilled onto a second page.
 */
export const unsizeCss = (selectors: readonly string[]) =>
  [...new Set(selectors.map((selector) => selector.trim()).filter(Boolean))].map((selector) => `${selector} { height: auto !important; min-height: 0 !important; }`).join("\n");

// ---- finding them in a chapter ---------------------------------------------------------------

const BLOCK_TAGS = new Set([
  "p", "div", "blockquote", "li", "dd", "dt", "td", "th", "ul", "ol", "dl", "table", "section", "article", "aside",
  "h1", "h2", "h3", "h4", "h5", "h6", "pre", "figure", "figcaption", "hr", "nav", "header", "footer", "center", "address"
]);
/** The blocks the reader's rules flatten: these are looked at. */
const LOOKED_AT = "p, div, blockquote, section, article, aside, figure, center";
/** A chapter has at most this many of them looked at (a guard, far above any book's). */
const BLOCKS_MAX = 30000;

const px = (value: string) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
};

const tagOf = (element: Element) => (element.localName || element.tagName).toLowerCase();

const isLeaf = (element: Element) => {
  for (let child = element.firstElementChild; child; child = child.nextElementSibling) {
    if (BLOCK_TAGS.has(tagOf(child)) || !isLeaf(child)) {
      return false;
    }
  }
  return true;
};

/** The element before this one among its parent's children that shows something (text, a picture, a rule). */
const shownBefore = (element: Element): Element | null => {
  for (let before = element.previousElementSibling; before; before = before.previousElementSibling) {
    if ((before.textContent ?? "").trim() || tagOf(before) === "hr" || before.querySelector("img, svg, hr")) {
      return before;
    }
  }
  return null;
};

const shownAfter = (element: Element): Element | null => {
  for (let after = element.nextElementSibling; after; after = after.nextElementSibling) {
    if ((after.textContent ?? "").trim() || tagOf(after) === "hr" || after.querySelector("img, svg, hr")) {
      return after;
    }
  }
  return null;
};

type Looked = {
  element: HTMLElement;
  facts: BlockFacts;
  /** A paragraph of running text: words, at the left, at the running size, not inset. */
  plain: boolean;
  verse?: VerseLine;
};

/**
 * Marks a chapter's blocks. Called before the reader's stylesheet goes in,
 * while the publisher's own styles can still be read; a chapter already
 * marked is left alone.
 */
export const markBlocks = (doc: Document) => {
  const view = doc.defaultView;
  if (!view || !doc.body || doc.body.hasAttribute("data-leaflet-blocks")) {
    return;
  }
  doc.body.setAttribute("data-leaflet-blocks", "1");
  unsizeWindowBoxes(doc);
  fitWrappedPictures(doc);
  // A page that is a picture and no words (a cover, a title page, a map): see the rules for it below.
  if (!(doc.body.textContent ?? "").trim() && doc.body.querySelector("img, svg")) {
    doc.body.setAttribute("data-leaflet-plate", "1");
  }

  const elements = Array.from(doc.body.querySelectorAll<HTMLElement>(LOOKED_AT)).slice(0, BLOCKS_MAX);
  const root = px(view.getComputedStyle(doc.documentElement).fontSize) || 16;
  const read = elements.map((element) => {
    const style = view.getComputedStyle(element);
    const leaf = isLeaf(element);
    return {
      element,
      style,
      leaf,
      shown: style.display !== "none",
      chars: leaf ? (element.textContent ?? "").replace(/\s+/g, " ").trim().length : 0,
      fontSize: px(style.fontSize)
    };
  });

  // The size of the running text: the one most of the words are set in.
  const bySize = new Map<number, number>();
  let words = 0;
  for (const block of read) {
    if (block.leaf && block.shown && block.chars > 0) {
      bySize.set(block.fontSize, (bySize.get(block.fontSize) ?? 0) + block.chars);
      words += block.chars;
    }
  }
  let running = root;
  if (words >= 400) {
    let most = 0;
    bySize.forEach((chars, size) => {
      if (chars > most) {
        most = chars;
        running = size;
      }
    });
  }

  /** The size of a short block's words: the smaller of its first and its last (a raised initial does not make a heading). */
  const wordsSize = (element: HTMLElement, own: number) => {
    const walker = doc.createTreeWalker(element, 4);
    let first: Text | null = null;
    let last: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node as Text).data.trim()) {
        first ??= node as Text;
        last = node as Text;
      }
    }
    const sizeAt = (text: Text | null) => (text?.parentElement && text.parentElement !== element ? px(view.getComputedStyle(text.parentElement).fontSize) : own);
    return Math.min(sizeAt(first), sizeAt(last));
  };

  /** The width a block's children have: its own, less its padding. */
  const contentWidth = (parent: HTMLElement | null) => {
    if (!parent) {
      return 0;
    }
    const style = view.getComputedStyle(parent);
    return Math.max(0, parent.clientWidth - px(style.paddingLeft) - px(style.paddingRight));
  };

  const looked: Looked[] = [];
  const byElement = new Map<Element, Looked>();
  for (const block of read) {
    if (!block.shown) {
      continue;
    }
    const { element, style, leaf, chars } = block;
    const marginLeft = px(style.marginLeft);
    // (A first-line indent given as a percentage is reported as one: of the width the block stands in.)
    const indentIsShare = style.textIndent.trim().endsWith("%");
    const room = marginLeft >= running || indentIsShare || px(style.textIndent) < -1 ? contentWidth(element.parentElement) : 0;
    const textIndent = indentIsShare ? (px(style.textIndent) / 100) * room : px(style.textIndent);
    const facts: BlockFacts = {
      tag: tagOf(element),
      leaf,
      chars,
      picture: leaf && Boolean(element.querySelector("img, svg")),
      align: style.textAlign,
      size: leaf && chars > 0 && chars <= HEADING_MAX_CHARS ? wordsSize(element, block.fontSize) : block.fontSize,
      running,
      marginLeft,
      marginRight: px(style.marginRight),
      marginTop: px(style.marginTop),
      marginBottom: px(style.marginBottom),
      textIndent,
      room
    };
    const entry: Looked = { element, facts, plain: false };
    looked.push(entry);
    byElement.set(element, entry);
  }

  // Insets, unless they are the book's page margin.
  const insets = new Map<HTMLElement, { left: number; right: number }>();
  // Hanging indents are kept as the book set them, page margin or not: they are the shape of an entry.
  const hangs = new Set<HTMLElement>();
  let insetChars = 0;
  for (const { element, facts } of looked) {
    const hang = facts.leaf && facts.chars > 0 ? keptHang(facts) : null;
    if (hang) {
      hangs.add(element);
      element.setAttribute("data-leaflet-hang", "1");
      element.style.setProperty("--leaflet-hang", `${hang.hang}%`);
      // (Its own, always: a custom property left unset would be taken from an inset block it stands in.)
      element.style.setProperty("--leaflet-inset-left", `${hang.left}%`);
      element.style.setProperty("--leaflet-inset-right", `${hang.right}%`);
      continue;
    }
    const inset = keptInset(facts);
    if (inset) {
      insets.set(element, inset);
    }
  }
  if (insets.size > 0) {
    for (const { element, facts } of looked) {
      if (!facts.leaf || facts.chars === 0) {
        continue;
      }
      for (let up: HTMLElement | null = element; up && up !== doc.body; up = up.parentElement) {
        if (insets.has(up)) {
          insetChars += facts.chars;
          break;
        }
      }
    }
    if (insetsAreMargins(insetChars, words)) {
      insets.clear();
    }
  }
  insets.forEach((inset, element) => {
    element.setAttribute("data-leaflet-inset", "1");
    element.style.setProperty("--leaflet-inset-left", `${inset.left}%`);
    element.style.setProperty("--leaflet-inset-right", `${inset.right}%`);
  });

  for (const entry of looked) {
    const { element, facts } = entry;
    const align = keptAlign(facts);
    if (align) {
      element.setAttribute("data-leaflet-set", align);
    }
    const heading = headingSize(facts);
    if (heading !== null) {
      element.setAttribute("data-leaflet-heading", "1");
      element.style.setProperty("--leaflet-heading-size", heading.toFixed(2));
    }
    if (isParagraphDiv(facts)) {
      element.setAttribute("data-leaflet-para", "1");
    }
    // (A line that is nothing but a link is a line of a contents page: the gaps between its groups are not scene breaks.)
    const link = facts.leaf && facts.chars > 0 ? element.querySelector("a[href]") : null;
    const linkOnly = Boolean(link) && (link?.textContent ?? "").replace(/\s+/g, " ").trim().length >= facts.chars;
    entry.plain = facts.leaf && facts.chars > 0 && (facts.tag === "p" || facts.tag === "div") && !align && heading === null && !insets.has(element) && !hangs.has(element) && !linkOnly;
    // As a possible line of verse (below): a paragraph of the kind the reader spaces.
    if (facts.leaf && facts.chars > 0 && (facts.tag === "p" || facts.tag === "div")) {
      entry.verse = {
        chars: facts.chars,
        gap: 0,
        textIndent: facts.textIndent,
        set: align === "center" || facts.marginLeft + Math.min(0, facts.textIndent) >= running * 0.9,
        endsSentence: endsAsSentence(element.textContent ?? ""),
        other: heading !== null || linkOnly || align === "right"
      };
    }
  }

  // Verse: runs of short lines the book sets with nothing between them.
  let proseIn = 0;
  let proseOut = 0;
  for (const { facts } of looked) {
    if (facts.leaf && facts.chars > 150) {
      if (facts.textIndent > 0.5) {
        proseIn += facts.chars;
      } else {
        proseOut += facts.chars;
      }
    }
  }
  const sequence: Looked[] = [];
  const flushVerse = () => {
    if (sequence.length >= 2) {
      const lines = sequence.map((entry) => entry.verse ?? null);
      for (const run of verseRuns(lines, running, proseIn > proseOut)) {
        for (let index = run.from; index <= run.to; index += 1) {
          sequence[index].element.setAttribute("data-leaflet-verse", index === run.to ? "last" : "line");
        }
        run.stanzas.forEach((stanza) => {
          sequence[stanza.line].element.setAttribute("data-leaflet-stanza", "1");
          sequence[stanza.line].element.style.setProperty("--leaflet-stanza", String(stanza.gap));
        });
      }
    }
    sequence.length = 0;
  };
  for (const entry of looked) {
    if (!entry.verse) {
      continue;
    }
    const last = sequence[sequence.length - 1];
    if (last && shownBefore(entry.element) === last.element) {
      entry.verse.gap = Math.max(last.facts.marginBottom, entry.facts.marginTop);
    } else {
      flushVerse();
    }
    sequence.push(entry);
  }
  flushVerse();

  // Paragraphs set apart by space alone. The usual gap is the middle one
  // between two plain paragraphs that follow each other.
  const pairs: Array<{ entry: Looked; gap: number }> = [];
  for (const entry of looked) {
    if (!entry.plain) {
      continue;
    }
    const before = shownBefore(entry.element);
    const previous = before ? byElement.get(before) : undefined;
    if (previous?.plain) {
      pairs.push({ entry, gap: Math.max(previous.facts.marginBottom, entry.facts.marginTop) });
    }
  }
  const usual = median(pairs.map((pair) => pair.gap));
  for (const { entry, gap } of pairs) {
    if (isSetApart(gap, usual, running)) {
      entry.element.setAttribute("data-leaflet-break", "1");
      entry.element.style.setProperty("--leaflet-break", String(breakRoom(gap, usual, running)));
    }
  }

  // Rules: blank ones are scene breaks; one the book draws itself is not drawn twice.
  doc.body.querySelectorAll<HTMLElement>("hr").forEach((rule) => {
    const style = view.getComputedStyle(rule);
    if (style.display === "none") {
      return;
    }
    const draws = (width: string, line: string) => px(width) > 0 && line !== "none" && line !== "hidden";
    const colour = style.backgroundColor;
    const kind = ruleKind({
      border:
        draws(style.borderTopWidth, style.borderTopStyle) ||
        draws(style.borderBottomWidth, style.borderBottomStyle) ||
        draws(style.borderLeftWidth, style.borderLeftStyle) ||
        draws(style.borderRightWidth, style.borderRightStyle),
      height: px(style.height),
      filled: style.backgroundImage !== "none" || !(colour === "transparent" || /rgba\([^)]*,\s*0\)$/.test(colour)),
      hidden: style.visibility === "hidden"
    });
    if (kind === "own") {
      rule.setAttribute("data-leaflet-rule", "own");
      return;
    }
    if (kind !== "blank") {
      return;
    }
    // Between two paragraphs (itself, or the box it is alone in): a scene break, not a page break at a chapter's end.
    const parent = rule.parentElement;
    const alone = parent && parent !== doc.body && parent.children.length === 1 && !(parent.textContent ?? "").trim();
    const context: Element = alone && parent ? parent : rule;
    const before = shownBefore(context);
    const after = shownAfter(context);
    // (Plain paragraphs both sides: where the book sets an ornament beside its blank rule, the ornament is the break.)
    if (before && after && byElement.get(before)?.plain && byElement.get(after)?.plain) {
      rule.setAttribute("data-leaflet-break", "1");
    }
  });

  // A list flattened into paragraphs: by runs of leaves that follow one another.
  const starts = looked.filter((entry) => entry.facts.leaf && entry.facts.chars === 1 && isLoneBullet(entry.element.textContent ?? ""));
  const done = new Set<Element>();
  for (const start of starts) {
    if (done.has(start.element)) {
      continue;
    }
    const run: HTMLElement[] = [];
    for (let at: Element | null = start.element; at && byElement.get(at)?.facts.leaf && run.length < 4000; at = at.nextElementSibling) {
      run.push(at as HTMLElement);
    }
    const found = flattenedList(run.map((element) => element.textContent ?? ""));
    found.bullets.forEach((index) => {
      run[index].setAttribute("data-leaflet-bullet", "1");
      // (Not a word of the book: Smart Read and SpeedRead pass over what is aria-hidden.)
      run[index].setAttribute("aria-hidden", "true");
      done.add(run[index]);
    });
    found.items.forEach((index) => run[index].setAttribute("data-leaflet-listed", "1"));
  }
};

/** Undoes heights given in the window's height (see `unsizeCss`), in the book's stylesheets and in `style` attributes. */
const unsizeWindowBoxes = (doc: Document) => {
  const view = doc.defaultView;
  if (!view || doc.getElementById("reader-unsized")) {
    return;
  }
  const selectors: string[] = [];
  const walk = (rules: CSSRuleList | undefined, depth: number) => {
    if (!rules || depth > 4) {
      return;
    }
    for (const rule of Array.from(rules)) {
      const styled = rule as CSSStyleRule;
      if (styled.selectorText && styled.style) {
        if (sizedByWindow(styled.style.height) || sizedByWindow(styled.style.minHeight)) {
          selectors.push(styled.selectorText);
        }
        continue;
      }
      const media = (rule as CSSMediaRule).media;
      if (media && media.mediaText && !view.matchMedia(media.mediaText).matches) {
        continue;
      }
      try {
        walk((rule as CSSGroupingRule).cssRules ?? (rule as CSSImportRule).styleSheet?.cssRules, depth + 1);
      } catch {
        // A stylesheet from elsewhere cannot be read; it is left as it is.
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    const owner = sheet.ownerNode as Element | null;
    if (owner && /^(reader-|epubjs-inserted-css)/.test(owner.id ?? "")) {
      continue;
    }
    if (sheet.media?.mediaText && !view.matchMedia(sheet.media.mediaText).matches) {
      continue;
    }
    try {
      walk(sheet.cssRules, 0);
    } catch {
      // As above.
    }
  }
  doc.body.querySelectorAll<HTMLElement>('[style*="vh"], [style*="vmin"], [style*="vmax"]').forEach((element) => {
    if (sizedByWindow(element.style.height)) {
      element.style.setProperty("height", "auto", "important");
    }
    if (sizedByWindow(element.style.minHeight)) {
      element.style.setProperty("min-height", "0", "important");
    }
  });
  const css = unsizeCss(selectors);
  if (css) {
    const style = doc.createElement("style");
    style.id = "reader-unsized";
    style.textContent = css;
    doc.head.appendChild(style);
  }
};

/**
 * A picture wrapped in an SVG that is told to stretch to its box
 * (`preserveAspectRatio="none"`: the usual cover page of a converted book)
 * is told to fit inside it instead: the reader gives a picture no more than
 * a window's height, and a stretched cover is a squashed one.
 */
const fitWrappedPictures = (doc: Document) => {
  doc.querySelectorAll("svg").forEach((svg) => {
    if (svg.getAttribute("preserveAspectRatio") === "none" && svg.querySelector("image")) {
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    }
  });
};

/**
 * Marks the lines of a flattened list that name a contents entry
 * (`data-leaflet-jump`, the entry's number): the reader goes there on a
 * click. Called again when the contents change (a chapter list made after
 * the book opened).
 */
export const markListedLines = (doc: Document, labels: readonly string[]) => {
  doc.querySelectorAll<HTMLElement>("[data-leaflet-listed]").forEach((line) => {
    const entry = labels.length > 0 ? entryForLine(line.textContent ?? "", labels) : -1;
    if (entry >= 0) {
      line.setAttribute("data-leaflet-jump", String(entry));
      line.setAttribute("role", "link");
    } else {
      line.removeAttribute("data-leaflet-jump");
      line.removeAttribute("role");
    }
  });
};

/**
 * The rules for what `markBlocks` marked, for the chapter's stylesheet. They
 * come after the reader's own rules for paragraphs and outrank them.
 */
export const BLOCKS_CSS = `
  /* A div that is a paragraph is spaced and set as one. */
  body div[data-leaflet-para] { text-align: var(--reader-align, justify) !important; text-justify: inter-word !important; hyphens: auto; margin-bottom: 1.6em !important; }
  /* What the publisher centred or set to the right stays so. */
  html body [data-leaflet-set="center"] { text-align: center !important; }
  html body [data-leaflet-set="right"] { text-align: right !important; }
  /* A paragraph that is a heading keeps its size, as a multiple of the reading size. */
  body [data-leaflet-heading] { font-size: calc(var(--leaflet-heading-size, 1.3) * 1em) !important; line-height: 1.3 !important; -webkit-hyphens: manual !important; hyphens: manual !important; }
  body [data-leaflet-heading]:not([data-leaflet-set]) { text-align: start !important; }
  html[data-leaflet-layout="pages"] body [data-leaflet-heading] { break-after: avoid; break-inside: avoid; }
  /* An inset block is inset on both sides, as the book has it. */
  html body [data-leaflet-inset] { margin-left: var(--leaflet-inset-left, 5%) !important; margin-right: var(--leaflet-inset-right, 0%) !important; }
  /* A hanging indent, as the book has it: the first line pulled back into the margin the other lines stand in from. */
  html body [data-leaflet-hang] { margin-left: calc(var(--leaflet-inset-left, 0%) + var(--leaflet-hang, 0%)) !important; margin-right: var(--leaflet-inset-right, 0%) !important; text-indent: calc(-1 * var(--leaflet-hang, 0%)) !important; }
  /* Verse: its lines follow one another at the line spacing of the text, a
     stanza keeps its gap, and the paragraph's gap comes after the last line. */
  html body [data-leaflet-verse] { margin-top: 0 !important; margin-bottom: 0 !important; -webkit-hyphens: manual !important; hyphens: manual !important; }
  html body [data-leaflet-verse]:not([data-leaflet-set]) { text-align: start !important; }
  html body [data-leaflet-verse][data-leaflet-stanza] { margin-top: calc(var(--leaflet-stanza, 1) * 1em) !important; }
  html body [data-leaflet-verse="last"] { margin-bottom: 1.6em !important; }
  /* A scene break made of space has room: a blank line or two more than the gap between any two paragraphs. */
  html body [data-leaflet-break] { margin-top: calc(1.6em + var(--leaflet-break, 1.8) * 1em) !important; }
  html body hr[data-leaflet-break] { margin: 1.7em 0 !important; }
  /* A rule the book draws itself is not drawn again by the reader. */
  html body hr[data-leaflet-rule="own"] { border: none !important; }
  /* A list flattened into paragraphs: its lone bullets go, its lines close up. */
  html body [data-leaflet-bullet] { display: none !important; }
  html body [data-leaflet-listed] { margin-bottom: 0.35em !important; text-align: start !important; }
  html body [data-leaflet-jump] { cursor: pointer; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.2em; }
  html[data-reader-dark="1"] body [data-leaflet-jump] { color: #8cc95a !important; }
  /* Scrolling, a picture is no taller than the window has room for (the
     reader sets the room: a chapter's frame is as tall as the chapter, so
     the frame's own height says nothing). epub.js's limit is 95% of the
     chapter's height when it was measured: 0 for a page that is one picture. */
  html:not([data-leaflet-layout="pages"]) body img,
  html:not([data-leaflet-layout="pages"]) body svg { max-height: var(--leaflet-picture-room, none) !important; object-fit: contain; }
  /* With pages, a page that is one picture has nothing above the picture: an
     empty paragraph before it (which the reader gives a paragraph's gap) and
     the line it sits on (ten pixels of strut under it) made a picture of a
     page's height too tall for the page; it went whole to a second column
     that was never counted, and the page showed blank. */
  html[data-leaflet-layout="pages"] body[data-leaflet-plate] :where(p, div, figure, section, article, blockquote, h1, h2, h3, h4, h5, h6, span, a) {
    margin-top: 0 !important; margin-bottom: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; line-height: 0 !important;
  }
  /* And a frame as tall as its content gives "100%" of itself nothing to mean. */
  html:not([data-leaflet-layout="pages"]),
  html:not([data-leaflet-layout="pages"]) body { height: auto !important; min-height: 0 !important; }
`;

/** Room for a picture when scrolling: the window, less the toolbar's strip above and the dock below. */
export const pictureRoom = (windowHeight: number, top: number, foot: number) => Math.max(160, Math.round(windowHeight - top - foot));
