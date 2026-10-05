/**
 * A chapter list for a book that came without one.
 *
 * Some books have no contents at all, or one entry ("Start"), or three for
 * thirty chapters. The reader then had nothing to show in its chapter list,
 * the dock named the one entry from cover to cover, "next chapter" meant the
 * next file, and the time left "in the chapter" was the time left in the
 * book. Here the chapters are found in the book itself and a list is made:
 *
 * 1. the book's own contents page (a page of links near the front), which
 *    has the publisher's titles and targets;
 * 2. headings the book marks as headings (h1 to h6, `epub:type`, `role`);
 * 3. lines that read as chapter headings ("Chapter 12", "XII", "Part Two")
 *    and are set as one (bold, centred, larger, or at the head of a file),
 *    with the title on the next line joined on;
 * 4. paragraphs in a style the book keeps for the head of its sections;
 * 5. failing all of those, one entry for each section of the book.
 *
 * A book whose contents are honest is left alone, however short they are.
 * Contents that are thin but real stay as the top level, with what was found
 * beneath them. Everything here is pure: `contentsScan.ts` reads the book
 * and hands over what it saw (`ScannedSection`).
 */

import type { TocItem } from "./readerTypes";

// ---- what the scan saw ------------------------------------------------------------

/** A short block that may be a heading. */
export type ScannedBlock = {
  /** Its words (a picture's `alt` or `title` when it has none), white space collapsed. */
  text: string;
  /** Its place among the section's blocks that have something in them, in reading order. */
  order: number;
  tag: string;
  /** The book's name for how it is set: tag and class ("p.chapter-title"). */
  style: string;
  /** Where it is: the id of an element there, or a CFI when nothing there has one. */
  anchor: string;
  /** The share of the section's text that comes before it (0 to 1). */
  at: number;
  /** Nothing to read comes before it in its section (pictures and empty blocks apart). */
  head: boolean;
  /** The book says it is a heading: h1 to h6, `epub:type` chapter, part or title, `role="doc-chapter"`. */
  marked: boolean;
  /** 1 to 6 for h1 to h6; 0 otherwise. */
  level: number;
  bold: boolean;
  centred: boolean;
  larger: boolean;
  /** A page break, a rule or an empty paragraph comes just before it. */
  afterBreak: boolean;
  /** Its words are a picture's. */
  picture: boolean;
};

export type ScannedLink = {
  text: string;
  /** The section it leads to (spine index), and the anchor in it, if any. */
  section: number;
  anchor: string | null;
  /** Whether that anchor is in that section, and the share of the section before it. */
  at: number | null;
};

export type ScannedSection = {
  index: number;
  href: string;
  linear: boolean;
  /** How much text it holds, in characters. */
  chars: number;
  /** Its first words. */
  opening: string;
  /** What the book says it is (`epub:type` of its body, the guide's or landmarks' name for it). */
  type: string;
  pictures: number;
  blocks: ScannedBlock[];
  /** How many blocks of each style it has, short or long. */
  styles: Record<string, number>;
  /** Links to other places in the book. */
  links: ScannedLink[];
};

/** An entry of the book's own contents, as a place. */
export type OwnEntry = { label: string; section: number | undefined; anchor: string | null };

// ---- what the stylesheets and the links say ---------------------------------------

/** How a class is set, as far as a heading goes. */
export type StyleHint = { bold: boolean; centred: boolean; larger: boolean; breaks: boolean };
export type StyleHints = Map<string, StyleHint>;

const sizeIsLarger = (value: string) => {
  const size = value.trim().toLowerCase();
  if (/^(large|x-large|xx-large|xxx-large|larger)$/.test(size)) {
    return true;
  }
  const number = Number.parseFloat(size);
  if (!Number.isFinite(number)) {
    return false;
  }
  return size.endsWith("%") ? number >= 115 : /r?em$/.test(size) ? number >= 1.15 : /px$/.test(size) ? number >= 19 : /pt$/.test(size) ? number >= 14 : false;
};

export const hintOf = (declarations: string): StyleHint => {
  const value = (name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(declarations)?.[1]?.trim().toLowerCase() ?? "";
  const weight = value("font-weight");
  return {
    bold: /^(bold|bolder|[6-9]00)/.test(weight),
    centred: value("text-align").startsWith("center"),
    larger: sizeIsLarger(value("font-size")),
    breaks: /^(always|page|left|right)/.test(value("page-break-before")) || /^(always|page|left|right)/.test(value("break-before"))
  };
};

/**
 * What the book's stylesheets say of each class: bold, centred, larger, a new
 * page before it. Only rules for a class on its own (".ct", "p.ct") are
 * read: a chapter title's class is nearly always that plain.
 */
export const styleHints = (css: string): StyleHints => {
  const hints: StyleHints = new Map();
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match = rule.exec(plain);
  while (match) {
    const hint = hintOf(match[2]);
    if (hint.bold || hint.centred || hint.larger || hint.breaks) {
      for (const selector of match[1].split(",")) {
        const name = /^\s*[a-z0-9]*\.([\w-]+)\s*$/i.exec(selector)?.[1];
        if (name) {
          const before = hints.get(name);
          hints.set(name, {
            bold: hint.bold || Boolean(before?.bold),
            centred: hint.centred || Boolean(before?.centred),
            larger: hint.larger || Boolean(before?.larger),
            breaks: hint.breaks || Boolean(before?.breaks)
          });
        }
      }
    }
    match = rule.exec(plain);
  }
  return hints;
};

/** A link as written in a section, as the section and anchor it leads to. */
export const linkResolver = (sectionHref: string, spineIndexOf: (path: string) => number | undefined) => (href: string) => {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return null;
  }
  const hashAt = href.indexOf("#");
  const path = hashAt >= 0 ? href.slice(0, hashAt) : href;
  let anchor: string | null = hashAt >= 0 ? href.slice(hashAt + 1) : null;
  try {
    anchor = anchor ? decodeURIComponent(anchor) : null;
  } catch {
    // As written.
  }
  const parts = path ? sectionHref.split("/").slice(0, -1) : sectionHref.split("/");
  for (const part of path.split("/")) {
    if (part === "..") {
      parts.pop();
    } else if (part && part !== ".") {
      parts.push(part);
    }
  }
  const joined = parts.join("/");
  let decoded = joined;
  try {
    decoded = decodeURIComponent(joined);
  } catch {
    // As written.
  }
  const section = spineIndexOf(joined) ?? spineIndexOf(decoded);
  return typeof section === "number" ? { section, anchor: anchor || null } : null;
};

// ---- reading a line as a heading ------------------------------------------------------

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };

/** "twelve", "twenty-one", "XII", "12": the number, or null. */
export const numberFrom = (word: string): number | null => {
  const text = word.toLowerCase().replace(/[.:)\]]+$/, "").trim();
  if (/^\d{1,4}$/.test(text)) {
    return Number(text);
  }
  if (text in ORDINALS) {
    return ORDINALS[text];
  }
  const ones = ONES.indexOf(text);
  if (ones >= 0) {
    return ones;
  }
  const parts = text.split(/[\s-]+/);
  const tens = TENS.indexOf(parts[0]);
  if (tens >= 2 && parts.length <= 2) {
    const unit = parts.length === 2 ? ONES.indexOf(parts[1]) : 0;
    return unit >= 0 && unit < 10 ? tens * 10 + unit : null;
  }
  if (/^[ivxlcdm]+$/.test(text) && text.length <= 8) {
    const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
    let total = 0;
    for (let index = 0; index < text.length; index += 1) {
      const value = values[text[index]];
      const next = values[text[index + 1]] ?? 0;
      total += value < next ? -value : value;
    }
    // Only numerals written the usual way ("iiii" and "vx" are words or noise).
    return total > 0 && total < 400 && toRoman(total) === text ? total : null;
  }
  return null;
};

const toRoman = (value: number) => {
  const table: Array<[number, string]> = [[100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let rest = value;
  let out = "";
  for (const [size, letters] of table) {
    while (rest >= size) {
      out += letters;
      rest -= size;
    }
  }
  return out;
};

export type HeadingRead = {
  kind: "chapter" | "part" | "named" | "numeral";
  /** The chapter's or part's number, when it has one. */
  number: number | null;
  /** How it is listed: "Chapter 12", "Part Two", "Prologue". */
  label: string;
  /** A title on the same line ("Chapter 12: The Road"), if any. */
  title: string;
};

const NAMED = /^(prologue|epilogue|interlude|prelude|coda|afterword|foreword|preface|introduction|postscript|envoi)\b[\s.:—–-]*(.*)$/i;
const NUMBER_WORD = "(?:\\d{1,4}|[ivxlcdm]{1,8}|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\\s-](?:one|two|three|four|five|six|seven|eight|nine))?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)";
const CHAPTER = new RegExp(`^(chapter|chap\\.?|part|book|volume|act|canto|letter|section)\\s+(${NUMBER_WORD})\\b[\\s.:—–-]*(.*)$`, "i");
const ORDINAL_FIRST = new RegExp(`^(?:the\\s+)?(${Object.keys(ORDINALS).join("|")})\\s+(chapter|part|book|act)\\b[\\s.:—–-]*(.*)$`, "i");

const capital = (word: string) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word);

/** A line that reads as the heading of a chapter or a part, or null. Titles alone ("The Road") are not read here. */
export const readHeading = (line: string): HeadingRead | null => {
  const text = line.replace(/\s+/g, " ").trim();
  if (!text || text.length > 90) {
    return null;
  }
  const chapter = CHAPTER.exec(text);
  if (chapter) {
    const word = capital(chapter[1].replace(/^chap\.?$/i, "Chapter"));
    const number = numberFrom(chapter[2]);
    if (number === null) {
      return null;
    }
    // "Part of the reason" and "Book me a room" are sentences: a numeral is a digit, a word or capitals.
    if (/^[ivxlcdm]+$/.test(chapter[2]) && chapter[2] !== chapter[2].toUpperCase() && !/^(chapter|chap)/i.test(chapter[1])) {
      return null;
    }
    const numeral = /^\d+$/.test(chapter[2]) ? chapter[2] : /^[ivxlcdm]+$/i.test(chapter[2]) ? chapter[2].toUpperCase() : capital(chapter[2]);
    const kind = /^(part|book|volume|act)$/i.test(chapter[1]) ? "part" : "chapter";
    return { kind, number, label: `${word} ${numeral}`, title: chapter[3].trim() };
  }
  const ordinal = ORDINAL_FIRST.exec(text);
  if (ordinal) {
    const kind = /^chapter$/i.test(ordinal[2]) ? "chapter" : "part";
    return { kind, number: ORDINALS[ordinal[1].toLowerCase()], label: `${capital(ordinal[2])} ${capital(ordinal[1])}`, title: ordinal[3].trim() };
  }
  const named = NAMED.exec(text);
  if (named && named[2].length <= 60) {
    return { kind: "named", number: null, label: capital(named[1]), title: named[2].trim() };
  }
  // A number alone: "12", "XII", "12."
  const alone = /^([0-9]{1,3}|[IVXLCDM]{1,8})[.)]?$/.exec(text);
  if (alone) {
    const number = numberFrom(alone[1]);
    if (number !== null) {
      return { kind: "numeral", number, label: alone[1], title: "" };
    }
  }
  return null;
};

// ---- front and back matter ----------------------------------------------------------

export type Matter = { label: string; side: "front" | "back" };

const MATTER_BY_TYPE: Array<[RegExp, Matter]> = [
  [/\bcover\b/, { label: "Cover", side: "front" }],
  [/\b(titlepage|title-page|halftitlepage)\b/, { label: "Title page", side: "front" }],
  [/\bcopyright(-page)?\b|\bimprint\b|\bcolophon\b/, { label: "Copyright", side: "front" }],
  [/\bdedication\b/, { label: "Dedication", side: "front" }],
  [/\b(toc|contents)\b/, { label: "Contents", side: "front" }],
  [/\bepigraph\b/, { label: "Epigraph", side: "front" }],
  [/\backnowledge?ments?\b/, { label: "Acknowledgements", side: "back" }],
  [/\b(index)\b/, { label: "Index", side: "back" }],
  [/\b(endnotes|footnotes|rearnotes|notes)\b/, { label: "Notes", side: "back" }],
  [/\bbibliography\b/, { label: "Bibliography", side: "back" }],
  [/\bglossary\b/, { label: "Glossary", side: "back" }]
];

const MATTER_BY_TEXT: Array<[RegExp, Matter]> = [
  [/^(table of )?contents$/, { label: "Contents", side: "front" }],
  [/^copyright( page| notice)?$|^copyright ©/, { label: "Copyright", side: "front" }],
  [/^dedication$/, { label: "Dedication", side: "front" }],
  [/^epigraph$/, { label: "Epigraph", side: "front" }],
  [/^title page$/, { label: "Title page", side: "front" }],
  [/^cover$/, { label: "Cover", side: "front" }],
  [/^acknowledge?ments?$/, { label: "Acknowledgements", side: "back" }],
  [/^(a note )?about the authors?$|^a note about the author$/, { label: "About the author", side: "back" }],
  [/^(also|other (books|titles)|books) by\b|^by the same author$/, { label: "Also by", side: "back" }],
  [/^(end)?notes$|^footnotes$/, { label: "Notes", side: "back" }],
  [/^index$/, { label: "Index", side: "back" }],
  [/^bibliography$|^further reading$/, { label: "Bibliography", side: "back" }],
  [/^glossary$/, { label: "Glossary", side: "back" }],
  [/^appendix\b|^appendices$|^appendixes$/, { label: "Appendix", side: "back" }]
];

/** Front or back matter by its heading (or a contents label), or null. */
export const matterByText = (text: string): Matter | null => {
  const line = text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").replace(/[.:]+$/, "").trim();
  if (!line || line.length > 60) {
    return null;
  }
  const found = MATTER_BY_TEXT.find(([pattern]) => pattern.test(line));
  return found ? found[1] : null;
};

/** What a section is when it is not a chapter: by what the book calls it, then by its first heading. */
export const matterOf = (section: ScannedSection): Matter | null => {
  const type = section.type.toLowerCase();
  const byType = MATTER_BY_TYPE.find(([pattern]) => pattern.test(type));
  if (byType) {
    return byType[1];
  }
  const first = section.blocks.find((block) => block.head);
  const byText = first ? matterByText(first.text) : null;
  if (byText) {
    return byText;
  }
  // A page that is one picture and no words, first in the book: the cover.
  if (section.index === 0 && section.chars < 40 && section.pictures >= 1) {
    return { label: "Cover", side: "front" };
  }
  if (/^copyright ©|^©|all rights reserved/i.test(section.opening) && section.chars < 6000) {
    return { label: "Copyright", side: "front" };
  }
  return null;
};

// ---- labels ---------------------------------------------------------------------------

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

/** "THE SECOND NIGHT" as "The Second Night": a heading set in capitals is not shouted in the list. Mixed case is left. */
export const tidyLabel = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  const letters = line.replace(/[^\p{L}]/gu, "");
  if (letters.length < 4 || letters !== letters.toUpperCase() || letters === letters.toLowerCase()) {
    return line;
  }
  return line
    .split(" ")
    .map((word, index) => {
      // A numeral stays a numeral ("CHAPTER XII").
      if (/^[IVXLCDM]+[.:]?$/.test(word) && numberFrom(word) !== null && index > 0) {
        return word;
      }
      const lower = word.toLowerCase();
      if (index > 0 && SMALL_WORDS.has(lower)) {
        return lower;
      }
      return lower.replace(/^([^\p{L}]*)(\p{L})/u, (_, lead: string, first: string) => lead + first.toUpperCase());
    })
    .join(" ");
};

const joinLabel = (head: string, title: string) => {
  const name = tidyLabel(title).replace(/^[\s.:—–-]+/, "");
  return name ? `${head} · ${name}` : head;
};

// ---- finding the chapters -----------------------------------------------------------

export type FoundSource = "page" | "headings" | "patterns" | "styled" | "sections";

export type Found = {
  label: string;
  section: number;
  /** Null at the top of the section. */
  anchor: string | null;
  /** The share of the section before it. */
  at: number;
  kind: "chapter" | "part" | "front" | "back";
  /** 0 for the top level. */
  depth: number;
};

export type Finding = { source: FoundSource; entries: Found[]; confident: boolean };

/** A section with this much text is one that is read (not a title page or a picture). */
const TEXT_SECTION = 1500;
/** A book's chapters do not average more than this (about 20,000 words). */
const CHAPTER_MAX_AVERAGE = 120000;
const TITLE_MAX = 90;

const emphasised = (block: ScannedBlock) => block.marked || block.bold || block.centred || block.larger;
const textSections = (sections: ScannedSection[]) => sections.filter((section) => section.linear && section.chars >= TEXT_SECTION);
const totalChars = (sections: ScannedSection[]) => sections.reduce((sum, section) => sum + (section.linear ? section.chars : 0), 0);

const place = (section: ScannedSection, block: ScannedBlock) => ({
  section: section.index,
  // The head of a section is its top: a picture or an empty line above the heading comes with it.
  anchor: block.head ? null : block.anchor,
  at: block.head ? 0 : block.at
});

const plausible = (sections: ScannedSection[], count: number) => count >= 3 && totalChars(sections) / count <= CHAPTER_MAX_AVERAGE;

/**
 * The book's own contents page: a page of links, near the front or at the
 * very back. Its links are the entries, when they lead somewhere: to three
 * places or more, most of them found.
 */
export const fromContentsPage = (sections: ScannedSection[]): Finding | null => {
  const near = sections.filter((section, position) => position < 20 || position >= sections.length - 4);
  let best: ScannedSection | null = null;
  for (const section of near) {
    const links = section.links.filter((link) => link.text.trim() && link.section !== section.index);
    const linked = links.reduce((sum, link) => sum + link.text.length, 0);
    // A page of links: five or more, and most of what it says.
    if (links.length < 5 || linked < section.chars * 0.5) {
      continue;
    }
    if (!best || /\b(toc|contents)\b/.test(section.type.toLowerCase()) || links.length > best.links.length) {
      best = section;
      if (/\b(toc|contents)\b/.test(section.type.toLowerCase())) {
        break;
      }
    }
  }
  if (!best) {
    return null;
  }
  const entries: Found[] = [];
  const seen = new Set<string>();
  let missing = 0;
  for (const link of best.links) {
    const label = link.text.replace(/\s+/g, " ").trim();
    if (!label || link.section === best.index) {
      continue;
    }
    // An anchor the book does not have leads to the top of its file.
    if (link.anchor && link.at === null) {
      missing += 1;
    }
    const anchor = link.anchor && link.at !== null && link.at > 0.002 ? link.anchor : null;
    const key = `${link.section}#${anchor ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const read = readHeading(label);
    const matter = matterByText(label);
    entries.push({
      label: tidyLabel(label),
      section: link.section,
      anchor,
      at: anchor ? (link.at ?? 0) : 0,
      kind: matter ? matter.side : read?.kind === "part" ? "part" : "chapter",
      depth: 0
    });
  }
  // Links that all land in one or two places name nothing (anchors lost in a conversion).
  if (entries.length < 3 || missing > best.links.length / 2) {
    return null;
  }
  entries.sort((a, b) => a.section - b.section || a.at - b.at);
  return { source: "page", entries, confident: true };
};

/** Headings the book marks as headings, in the styles it uses for the heads of its sections. */
export const fromHeadings = (sections: ScannedSection[]): Finding | null => {
  const marked = sections.flatMap((section) => (section.linear ? section.blocks.filter((block) => block.marked && block.text).map((block) => ({ section, block })) : []));
  if (marked.length === 0) {
    return null;
  }
  // By level (h2, h5): publishers give one level several classes ("first", "no space above").
  const kindOf = (block: ScannedBlock) => (block.level ? `h${block.level}` : block.style);
  // A level counts when the book opens two sections or more with it, or uses it three times and opens one.
  const heads = new Map<string, number>();
  const uses = new Map<string, number>();
  const levels = new Map<string, number>();
  const headed = new Set<number>();
  for (const { block } of marked) {
    const kind = kindOf(block);
    uses.set(kind, (uses.get(kind) ?? 0) + 1);
    levels.set(kind, block.level || 2);
    if (block.head) {
      heads.set(kind, (heads.get(kind) ?? 0) + 1);
    }
  }
  const kinds = [...uses.keys()].filter((kind) => (heads.get(kind) ?? 0) >= 2 || ((uses.get(kind) ?? 0) >= 3 && (heads.get(kind) ?? 0) >= 1));
  // With one file for the whole book, a heading used three times is a chapter heading.
  if (kinds.length === 0 && textSections(sections).length <= 1) {
    kinds.push(...[...uses.keys()].filter((kind) => (uses.get(kind) ?? 0) >= 3));
  }
  if (kinds.length === 0) {
    return null;
  }
  // The two highest levels among them: books, then chapters; or chapters, then their parts.
  const ranks = [...new Set(kinds.map((kind) => levels.get(kind) ?? 2))].sort((a, b) => a - b).slice(0, 2);
  const entries: Found[] = [];
  type Line = { section: number; order: number; depth: number };
  let lastBlock: Line | null = null as Line | null;
  for (const { section, block } of marked) {
    const kind = kindOf(block);
    const depth = ranks.indexOf(levels.get(kind) ?? 2);
    if (!kinds.includes(kind) || depth < 0 || block.text.length > TITLE_MAX) {
      continue;
    }
    const follows = lastBlock !== null && lastBlock.section === section.index && block.order === lastBlock.order + 1;
    const last = entries[entries.length - 1];
    if (follows && last && lastBlock) {
      const above: number = lastBlock.depth;
      lastBlock = { section: section.index, order: block.order, depth: above };
      // A number and its title on two lines (or three: number, narrator, title) are one heading.
      if (depth === above && !matterByText(block.text)) {
        last.label = joinLabel(last.label, block.text);
      }
      // A smaller heading straight under a heading is its subtitle, not a chapter of its own.
      continue;
    }
    lastBlock = { section: section.index, order: block.order, depth };
    const matter = block.head ? matterByText(block.text) : null;
    const read = readHeading(block.text);
    entries.push({ label: tidyLabel(block.text), ...place(section, block), kind: matter ? matter.side : read?.kind === "part" ? "part" : "chapter", depth });
    if (block.head) {
      headed.add(section.index);
    }
  }
  const reading = textSections(sections);
  const chapters = entries.filter((entry) => entry.kind === "chapter" || entry.kind === "part").length;
  const confident = plausible(sections, chapters) && headed.size >= Math.max(1, reading.length / 3);
  return { source: "headings", entries, confident };
};

/**
 * Lines that read as chapter headings and are set as headings. The numbers
 * must run on (1, 2, 3; a new part may start again at 1): a "Chapter 7" in
 * the middle of someone's speech does not.
 */
export const fromPatterns = (sections: ScannedSection[]): Finding | null => {
  type Hit = { section: ScannedSection; block: ScannedBlock; read: HeadingRead; position: number };
  const hits: Hit[] = [];
  const all: Array<{ section: ScannedSection; block: ScannedBlock }> = [];
  for (const section of sections) {
    if (!section.linear) {
      continue;
    }
    for (const block of section.blocks) {
      all.push({ section, block });
      const read = block.text.length <= TITLE_MAX ? readHeading(block.text) : null;
      if (!read) {
        continue;
      }
      // Set as a heading, or where one would be. A number alone must be both.
      const set = emphasised(block);
      const placed = block.head || block.afterBreak;
      if (read.kind === "numeral" ? !(block.head || (set && placed)) : !(set || placed)) {
        continue;
      }
      hits.push({ section, block, read, position: all.length - 1 });
    }
  }
  // The chapters proper: the commonest kind among "chapter" and bare numerals.
  const numbered = hits.filter((hit) => hit.read.number !== null && hit.read.kind !== "part" && hit.read.kind !== "named");
  const kinds = new Map<string, number>();
  numbered.forEach((hit) => kinds.set(hit.read.kind, (kinds.get(hit.read.kind) ?? 0) + 1));
  const kind = (kinds.get("chapter") ?? 0) >= (kinds.get("numeral") ?? 0) ? "chapter" : "numeral";
  const run: Hit[] = [];
  for (const hit of numbered) {
    if (hit.read.kind !== kind) {
      continue;
    }
    const before = run[run.length - 1]?.read.number ?? 0;
    const number = hit.read.number ?? 0;
    // On from the last one (a gap is a heading that was not found), or a new start at 1.
    if (number > before && number <= before + 6) {
      run.push(hit);
    } else if (number === 1 && before >= 2) {
      run.push(hit);
    }
  }
  if (run.length < 3) {
    return null;
  }
  const taken = new Set<number>();
  const entries: Array<Found & { position: number }> = [];
  // The title on the line after, set the same way: "Chapter 1." then "The Road".
  const titleAfter = (hit: Hit) => {
    const next = all[hit.position + 1];
    if (!next || next.section !== hit.section || next.block.order !== hit.block.order + 1 || taken.has(hit.position + 1)) {
      return null;
    }
    const block = next.block;
    if (!emphasised(block) || block.text.length > TITLE_MAX || readHeading(block.text) || !block.text) {
      return null;
    }
    return { block, position: hit.position + 1 };
  };
  const titleStyles = new Set<string>();
  const add = (hit: Hit, depth: number, kindOf: Found["kind"]) => {
    taken.add(hit.position);
    let label = hit.read.kind === "numeral" ? hit.read.label : tidyLabel(hit.read.label);
    if (hit.read.title) {
      label = joinLabel(label, hit.read.title);
    } else {
      const title = titleAfter(hit);
      if (title) {
        taken.add(title.position);
        titleStyles.add(styleKey(title.block));
        label = joinLabel(label, title.block.text);
      }
    }
    entries.push({ label, ...place(hit.section, hit.block), kind: kindOf, depth, position: hit.position });
  };
  const parts = hits.filter((hit) => hit.read.kind === "part");
  const named = hits.filter((hit) => hit.read.kind === "named" && (hit.block.head || emphasised(hit.block)));
  const nested = parts.length >= 2;
  run.forEach((hit) => add(hit, nested ? 1 : 0, "chapter"));
  if (nested) {
    parts.forEach((hit) => add(hit, 0, "part"));
  }
  named.forEach((hit) => {
    if (!taken.has(hit.position)) {
      add(hit, 0, "chapter");
    }
  });
  // Chapters whose number was lost, between two that kept theirs: as many
  // title-like lines as there are numbers missing, or none of them.
  const sorted = () => entries.sort((a, b) => a.position - b.position);
  const numbers = run.map((hit) => ({ position: hit.position, number: hit.read.number ?? 0 }));
  if (titleStyles.size > 0) {
    for (let index = 0; index + 1 < numbers.length; index += 1) {
      const from = numbers[index];
      const to = numbers[index + 1];
      const lost = to.number - from.number - 1;
      if (lost <= 0) {
        continue;
      }
      const between: number[] = [];
      for (let position = from.position + 1; position < to.position; position += 1) {
        const block = all[position].block;
        if (!taken.has(position) && titleStyles.has(styleKey(block)) && block.text.length <= TITLE_MAX && block.text && !readHeading(block.text)) {
          between.push(position);
        }
      }
      if (between.length !== lost) {
        continue;
      }
      between.forEach((position, step) => {
        const { section, block } = all[position];
        taken.add(position);
        const word = kind === "chapter" ? `Chapter ${from.number + step + 1}` : String(from.number + step + 1);
        entries.push({ label: joinLabel(word, block.text), ...place(section, block), kind: "chapter", depth: nested ? 1 : 0, position });
      });
    }
  }
  const list = sorted().map(({ position: _position, ...entry }) => entry);
  return { source: "patterns", entries: list, confident: plausible(sections, run.length) };
};

/** How a block is set, for telling one kind of line from another: its style and its emphasis. */
const styleKey = (block: ScannedBlock) => `${block.style}|${block.bold ? "b" : ""}${block.centred ? "c" : ""}${block.larger ? "l" : ""}${block.marked ? "m" : ""}`;

/**
 * Paragraphs set as headings (bold, centred or larger, and short) in a style
 * the book keeps for the head of its sections: used to open three sections
 * or more, and hardly anywhere else.
 */
export const fromStyled = (sections: ScannedSection[]): Finding | null => {
  const heads = new Map<string, number>();
  const uses = new Map<string, number>();
  for (const section of sections) {
    Object.entries(section.styles).forEach(([style, count]) => uses.set(style, (uses.get(style) ?? 0) + count));
    if (!section.linear) {
      continue;
    }
    const seen = new Set<string>();
    section.blocks.forEach((block) => {
      if (block.head && !block.marked && emphasised(block) && block.text && block.text.length <= TITLE_MAX && !seen.has(block.style)) {
        seen.add(block.style);
        heads.set(block.style, (heads.get(block.style) ?? 0) + 1);
      }
    });
  }
  // Two lines at each head (a number and a title) at the most: twice as many uses as sections opened.
  const styles = new Set([...heads.entries()].filter(([style, count]) => count >= 3 && (uses.get(style) ?? count) <= count * 2 + 2).map(([style]) => style));
  if (styles.size === 0) {
    return null;
  }
  const entries: Found[] = [];
  const headed = new Set<number>();
  for (const section of sections) {
    if (!section.linear) {
      continue;
    }
    // The line the section opens with, and the lines straight under it set as headings too (a number, then its title).
    const lines: ScannedBlock[] = [];
    for (const block of section.blocks) {
      const fits = !block.marked && emphasised(block) && Boolean(block.text) && block.text.length <= TITLE_MAX;
      if (lines.length === 0) {
        if (block.head && fits && styles.has(block.style)) {
          lines.push(block);
        }
      } else if (fits && block.order === lines[lines.length - 1].order + 1 && lines.length < 3) {
        lines.push(block);
      }
    }
    if (lines.length === 0) {
      continue;
    }
    const first = readHeading(lines[0].text);
    let label = first ? (first.kind === "numeral" ? first.label : tidyLabel(first.label)) : tidyLabel(lines[0].text);
    if (first?.title) {
      label = joinLabel(label, first.title);
    }
    lines.slice(1, 3).forEach((line) => {
      label = joinLabel(label, line.text);
    });
    const matter = matterByText(lines[0].text);
    entries.push({ label, section: section.index, anchor: null, at: 0, kind: matter ? matter.side : first?.kind === "part" ? "part" : "chapter", depth: 0 });
    headed.add(section.index);
  }
  const chapters = entries.filter((entry) => entry.kind === "chapter" || entry.kind === "part").length;
  return { source: "styled", entries, confident: plausible(sections, chapters) && headed.size >= textSections(sections).length / 3 };
};

const firstWords = (text: string) => {
  const words = text.replace(/\s+/g, " ").trim().split(" ").slice(0, 6);
  const line = words.join(" ").replace(/[\s,;:—–-]+$/, "");
  return line.length > 44 ? `${line.slice(0, 42).trimEnd()}…` : words.length === 6 ? `${line}…` : line;
};

/** One entry for each section that is read: named for what it is, or by its first words, or "Section N". */
export const fromSections = (sections: ScannedSection[]): Finding => {
  const entries: Found[] = [];
  let count = 0;
  for (const section of sections) {
    if (!section.linear) {
      continue;
    }
    const matter = matterOf(section);
    if (matter) {
      // The cover and the copyright page are places to go, not chapters; a blank page is nothing.
      if (section.chars > 0 || section.pictures > 0) {
        entries.push({ label: matter.label, section: section.index, anchor: null, at: 0, kind: matter.side, depth: 0 });
      }
      continue;
    }
    // A page that is one picture, or next to nothing: not a chapter.
    if (section.chars < 200) {
      continue;
    }
    count += 1;
    const head = section.blocks.find((block) => block.head && emphasised(block) && block.text && block.text.length <= TITLE_MAX);
    const opening = head ? tidyLabel(head.text) : firstWords(section.opening);
    entries.push({ label: opening ? `Section ${count} · ${opening}` : `Section ${count}`, section: section.index, anchor: null, at: 0, kind: "chapter", depth: 0 });
  }
  return { source: "sections", entries, confident: false };
};

/** The chapters of the book, from the surest source that finds them. */
export const findChapters = (sections: ScannedSection[]): Finding => {
  const tried = [fromContentsPage(sections), fromHeadings(sections), fromPatterns(sections), fromStyled(sections)];
  const sure = tried.find((finding) => finding?.confident);
  return withMatter(sections, sure ?? fromSections(sections));
};

/** Front and back matter named plainly, for the sections before the first chapter found and after the last. */
const withMatter = (sections: ScannedSection[], finding: Finding): Finding => {
  if (finding.source === "sections" || finding.source === "page") {
    return finding;
  }
  const story = finding.entries.filter((entry) => entry.kind === "chapter" || entry.kind === "part");
  if (story.length === 0) {
    return finding;
  }
  const first = story[0].section;
  const last = story[story.length - 1].section;
  const listed = new Set(finding.entries.map((entry) => entry.section));
  const extra: Found[] = [];
  for (const section of sections) {
    if (!section.linear || listed.has(section.index) || (section.index >= first && section.index <= last)) {
      continue;
    }
    const matter = matterOf(section);
    if (matter && (section.chars > 0 || section.pictures > 0)) {
      extra.push({ label: matter.label, section: section.index, anchor: null, at: 0, kind: section.index < first ? "front" : "back", depth: 0 });
    }
  }
  // What stands before the first chapter in its own file: the book's plain
  // list of its chapters, or its title. (Without an entry of its own, that
  // page went by the name of whatever came before it: "Cover".)
  const opener = story[0];
  const openerSection = sections.find((section) => section.index === opener.section);
  if (openerSection && opener.anchor !== null && opener.at > 0) {
    const before = openerSection.blocks.filter((block) => block.at < opener.at);
    const listedLines = before.filter((block) => readHeading(block.text) && !emphasised(block)).length;
    const label = listedLines >= 3 ? "Contents" : openerSection.chars * opener.at < 800 ? "Title page" : null;
    if (label) {
      extra.push({ label, section: opener.section, anchor: null, at: 0, kind: "front", depth: 0 });
    }
  }
  const entries = [...finding.entries, ...extra].sort((a, b) => a.section - b.section || a.at - b.at);
  return { ...finding, entries };
};

// ---- whether the book's own contents will do ------------------------------------------

export type Verdict = "own" | "merged" | "made";

export type ContentsDecision = {
  use: Verdict;
  /** Why, in a few words (for the notes and the tests; the reader is not told). */
  reason: string;
  source: FoundSource | null;
  toc: TocItem[];
  /** The share of its section before each entry found that is not at the top of one (`placeKey` to 0..1). */
  within: Record<string, number>;
};

const isStory = (entry: Found) => entry.kind === "chapter" || entry.kind === "part";

/**
 * Whether the book's own contents are kept, added to, or replaced.
 *
 * Replaced when they say nothing: none, one entry, every entry leading to
 * one place, or nothing but front and back matter in a book with chapters.
 * Added to when they are real but thin: three sections or more that open
 * with a chapter heading are not in them, and those outnumber the chapters
 * they do list. Otherwise kept: a short list for a short book is honest.
 */
export const judgeContents = (own: OwnEntry[], sections: ScannedSection[], finding: Finding): { use: Verdict; reason: string } => {
  const placed = own.filter((entry) => typeof entry.section === "number");
  if (placed.length <= 1) {
    return { use: "made", reason: placed.length === 0 ? "no contents" : "one entry" };
  }
  const targets = new Set(placed.map((entry) => `${entry.section}#${entry.anchor ?? ""}`));
  if (targets.size === 1) {
    return { use: "made", reason: "every entry leads to one place" };
  }
  const reading = textSections(sections);
  const body = placed.filter((entry) => !matterByText(entry.label));
  const found = finding.entries.filter(isStory);
  if (body.length === 0 && reading.length >= 3 && finding.confident && found.length >= 3) {
    return { use: "made", reason: "only front and back matter listed" };
  }
  if (!finding.confident || finding.source === "sections") {
    return { use: "own", reason: "nothing surer found" };
  }
  const listed = new Set(placed.map((entry) => entry.section));
  const unlisted = found.filter((entry) => !listed.has(entry.section) && entry.anchor === null);
  if (unlisted.length >= 3 && unlisted.length >= body.length) {
    return { use: "merged", reason: `${unlisted.length} headed sections not listed` };
  }
  return { use: "own", reason: "the book's contents cover it" };
};

// ---- the list -------------------------------------------------------------------------

/** A place written as a CFI (a heading with no id), not an id. */
export const isCfiAnchor = (anchor: string) => /^epubcfi\(/.test(anchor);

/** Where an entry leads: its file and the id there; or the bare file and a CFI, for a heading with no id (`TocItem.cfi`). */
const linkOf = (hrefs: readonly string[], entry: { section: number; anchor: string | null }): { href: string; cfi?: string } => {
  const file = hrefs[entry.section] ?? "";
  if (!entry.anchor) {
    return { href: file };
  }
  return isCfiAnchor(entry.anchor) ? { href: file, cfi: entry.anchor } : { href: `${file}#${entry.anchor}` };
};

/** The name an entry's place goes by in `within`: its CFI, or its href. */
export const placeKey = (item: { href: string; cfi?: string }) => item.cfi ?? item.href;

/** The entries found as a contents tree: parts hold their chapters. */
export const treeOf = (entries: Found[], hrefs: readonly string[]): TocItem[] => {
  const top: TocItem[] = [];
  let holder: TocItem | null = null;
  entries.forEach((entry, index) => {
    const item: TocItem = { id: `leaflet-auto-${index}`, label: entry.label, ...linkOf(hrefs, entry), subitems: [] };
    if (entry.depth > 0 && holder) {
      holder.subitems = [...(holder.subitems ?? []), item];
      return;
    }
    top.push(item);
    holder = entry.depth === 0 && isStory(entry) ? item : entry.depth === 0 ? null : holder;
  });
  return top;
};

/**
 * The book's own contents with what was found beneath them: each chapter
 * found that the contents do not have goes under the top-level entry it
 * follows. The book's entries, their order and their names are untouched.
 */
export const mergeContents = (
  own: TocItem[],
  placeOf: (href: string) => { section: number | undefined; anchor: string | null },
  entries: Found[],
  hrefs: readonly string[]
): TocItem[] => {
  const flat: Array<{ section: number; anchor: string | null }> = [];
  const walk = (items: TocItem[]) =>
    items.forEach((item) => {
      const at = placeOf(item.href);
      if (typeof at.section === "number") {
        flat.push({ section: at.section, anchor: at.anchor });
      }
      walk(item.subitems ?? []);
    });
  walk(own);
  // What the book lists is the book's to name: a section it has an entry for (at its head), or the same anchor.
  const has = (entry: Found) => flat.some((at) => at.section === entry.section && (entry.anchor === null || at.anchor === entry.anchor));
  const tops = own.map((item) => ({ item: { ...item, subitems: [...(item.subitems ?? [])] }, section: placeOf(item.href).section }));
  entries.forEach((entry, index) => {
    if (!isStory(entry) || has(entry)) {
      return;
    }
    let parent = -1;
    tops.forEach((top, position) => {
      if (typeof top.section === "number" && top.section <= entry.section) {
        parent = position;
      }
    });
    // Under one of the book's chapters or parts: a heading inside "About the Author" is not a chapter.
    if (parent < 0 || matterByText(tops[parent].item.label)) {
      return;
    }
    const item: TocItem = { id: `leaflet-auto-${index}`, label: entry.label, ...linkOf(hrefs, entry), subitems: [] };
    const siblings = tops[parent].item.subitems ?? [];
    // Among the entry's own children, in reading order.
    let before = siblings.length;
    for (let position = 0; position < siblings.length; position += 1) {
      const at = placeOf(siblings[position].href);
      if (typeof at.section === "number" && at.section > entry.section) {
        before = position;
        break;
      }
    }
    siblings.splice(before, 0, item);
    tops[parent].item.subitems = siblings;
  });
  return tops.map((top) => top.item);
};

/** The contents the reader should show: the book's own, added to, or made. */
export const decideContents = (
  own: TocItem[],
  placeOf: (href: string) => { section: number | undefined; anchor: string | null },
  sections: ScannedSection[]
): ContentsDecision => {
  const hrefs = sections.map((section) => section.href);
  const flat: OwnEntry[] = [];
  const walk = (items: TocItem[]) =>
    items.forEach((item) => {
      flat.push({ label: item.label, ...placeOf(item.href) });
      walk(item.subitems ?? []);
    });
  walk(own);
  const finding = findChapters(sections);
  const { use, reason } = judgeContents(flat, sections, finding);
  if (use === "own") {
    return { use, reason, source: null, toc: own, within: {} };
  }
  const within: Record<string, number> = {};
  finding.entries.forEach((entry) => {
    if (entry.anchor && entry.at > 0) {
      within[placeKey(linkOf(hrefs, entry))] = entry.at;
    }
  });
  if (use === "merged") {
    return { use, reason, source: finding.source, toc: mergeContents(own, placeOf, finding.entries, hrefs), within };
  }
  return { use, reason, source: finding.source, toc: treeOf(finding.entries, hrefs), within };
};

// ---- kept for the next time the book is opened ----------------------------------------

/** Bumped when the finder changes what it would say of the same book. */
export const CONTENTS_VERSION = 1;
export const CONTENTS_KEY_PREFIX = "leaflet.contents.";

export type KeptContents = {
  v: number;
  /** How many sections the book had when it was read: a different file under the same id is read again. */
  spine: number;
  use: Verdict;
  source: FoundSource | null;
  /** The list, unless the book's own is used. */
  toc: TocItem[] | null;
  /** The share of its section before each entry that has an anchor: `href` to 0..1. */
  within: Record<string, number>;
};

export const keepContents = (decision: ContentsDecision, spine: number, within: Record<string, number>): KeptContents => ({
  v: CONTENTS_VERSION,
  spine,
  use: decision.use,
  source: decision.source,
  toc: decision.use === "own" ? null : decision.toc,
  within
});

/** What was kept, if it is this finder's and this book's; null otherwise. */
export const readKept = (raw: string | null, spine: number): KeptContents | null => {
  if (!raw) {
    return null;
  }
  try {
    const kept = JSON.parse(raw) as Partial<KeptContents>;
    if (kept?.v !== CONTENTS_VERSION || kept.spine !== spine || (kept.use !== "own" && kept.use !== "merged" && kept.use !== "made")) {
      return null;
    }
    if (kept.use !== "own" && !Array.isArray(kept.toc)) {
      return null;
    }
    return { v: kept.v, spine, use: kept.use, source: kept.source ?? null, toc: kept.use === "own" ? null : (kept.toc as TocItem[]), within: kept.within && typeof kept.within === "object" ? kept.within : {} };
  } catch {
    return null;
  }
};

/** What the chapter list says under its heading when Leaflet made or added to it. */
export const CONTENTS_FOUND_NOTE = "Chapters found by Leaflet";
