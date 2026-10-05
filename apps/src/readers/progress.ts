/**
 * Reading progress for EPUBs: chapter titles, and progress weighted by how
 * much of the book each section holds. Pure functions, kept out of the reader
 * so they can be tested on their own.
 */

const normalizeLabel = (label: string) => label.toLowerCase().replace(/\s+/g, " ").trim();

const isFrontMatter = (label: string) => {
  const text = normalizeLabel(label);
  const blocked = [
    "title page",
    "copyright",
    "contents",
    "table of contents",
    "dedication",
    "acknowledgments",
    "acknowledgements",
    "foreword",
    "introduction",
    "preface",
    "glossary",
    "index",
    "about the author",
    "maps",
    "map"
  ];
  return blocked.some((entry) => text === entry || text.startsWith(`${entry} `));
};

/**
 * Progress by how much of the book is behind the reader.
 *
 * Each section (spine item) weighs its size in the EPUB, so a long chapter
 * counts for more than a short one. `lo..hi` is the story itself: when the
 * table of contents has chapter titles that frame it (and span at least half
 * the book), front matter reads as 0% and back matter (notes, acknowledgements)
 * leaves progress where the story ended. Otherwise it is every readable section.
 *
 * This replaced "chapter number / chapter count" over TOC titles matching an
 * English pattern: titled chapters ("The Boy Who Lived") or another language
 * miscounted, a "Prologue, …, Epilogue" book jumped between 0% and 50%, and
 * every chapter weighed the same whatever its length.
 */
export type SectionWeights = {
  /** Readable size per spine index (0 for non-linear or missing sections). */
  bytes: number[];
  /** `prefix[i]` is the size of sections 0..i-1. */
  prefix: number[];
  lo: number;
  hi: number;
  /** The last section in lo..hi with any text: reaching its end is finishing. */
  last: number;
};

export const buildSectionWeights = (
  spineHrefs: string[],
  sections: { href: string; bytes: number; linear: boolean }[],
  toc: { href: string; label: string }[],
  spineIndexOf: (href: string) => number | undefined
): SectionWeights | null => {
  const byHref = new Map(sections.map((section) => [section.href, section]));
  const lookup = (href: string) => {
    const direct = byHref.get(href);
    if (direct) {
      return direct;
    }
    try {
      return byHref.get(decodeURIComponent(href)) ?? byHref.get(encodeURI(href));
    } catch {
      return undefined;
    }
  };
  const bytes = spineHrefs.map((href) => {
    const section = lookup(href);
    return section && section.linear ? Math.max(0, section.bytes) : 0;
  });
  const prefix = [0];
  bytes.forEach((size, index) => prefix.push(prefix[index] + size));
  const total = prefix[prefix.length - 1];
  const readable = bytes.map((size, index) => (size > 0 ? index : -1)).filter((index) => index >= 0);
  if (total <= 0 || readable.length === 0) {
    return null;
  }
  let lo = readable[0];
  let hi = readable[readable.length - 1];

  const entries = toc
    .map((item, position) => ({ position, spine: spineIndexOf(item.href), chapter: isChapterLike(item.label) }))
    .filter((entry): entry is { position: number; spine: number; chapter: boolean } => typeof entry.spine === "number");
  const chapters = entries.filter((entry) => entry.chapter);
  if (chapters.length >= 2) {
    const first = Math.min(...chapters.map((entry) => entry.spine));
    const lastChapter = chapters.reduce((a, b) => (b.spine >= a.spine ? b : a));
    // The story runs on through a chapter split over several files, up to the
    // next entry in the contents (acknowledgements, notes, about the author).
    const after = entries.find((entry) => entry.position > lastChapter.position && entry.spine > lastChapter.spine);
    const end = after ? after.spine - 1 : hi;
    if (end >= first && prefix[end + 1] - prefix[first] >= total * 0.5) {
      lo = first;
      hi = end;
    }
  }
  let last = hi;
  while (last > lo && bytes[last] === 0) {
    last -= 1;
  }
  return { bytes, prefix, lo, hi, last };
};

/** Where a stored fraction of the book falls: the spine index to open. */
export const spineIndexForProgress = (weights: SectionWeights, progress: number) => {
  const { prefix, lo, hi } = weights;
  const target = prefix[lo] + progress * (prefix[hi + 1] - prefix[lo]);
  for (let index = lo; index <= hi; index += 1) {
    if (prefix[index + 1] > target) {
      return index;
    }
  }
  return hi;
};

export const isChapterLike = (label: string) => {
  const text = normalizeLabel(label);
  if (isFrontMatter(text)) {
    return false;
  }
  if (/(chapter|book|section)\b/.test(text)) {
    return true;
  }
  if (/^(prologue|epilogue)\b/.test(text)) {
    return true;
  }
  if (/^[ivxlcdm]+\.?$/.test(text)) {
    return true;
  }
  return false;
};

/** Progress this close to an end counts as being there. */
const AT_AN_END = 0.02;

/**
 * A place outside the story: front matter (a map, the contents) or back
 * matter (notes, an appendix). Looking there is not reading there. Front
 * matter used to read as 0%, so opening the map from chapter 20 and closing
 * the book saved 0% and the map as the place to come back to.
 *
 * The progress to record (null: leave it as it is) and whether the saved
 * place follows the reader there. Both follow only when that is where the
 * reading is: front matter at the very start of the book, back matter once
 * the story is finished.
 */
export const outsideStory = (side: "front" | "back", progress: number) => {
  const known = Number.isFinite(progress) ? progress : 0;
  if (side === "front") {
    return known <= AT_AN_END ? { progress: 0 as number | null, placeFollows: true } : { progress: null, placeFollows: false };
  }
  return { progress: null as number | null, placeFollows: known >= 1 - AT_AN_END };
};

/**
 * Scrolling: whether the story's last line is in the window, given where the
 * bottom of its last section's text is from the top of the window. The book
 * is read once it is, however short that last section.
 *
 * Progress used to reach 100% only with the top of the window inside the
 * last section, on its last screenful: a last chapter shorter than the window
 * never got there (the page cannot scroll that far), so such a book stayed at
 * 95% and was never finished.
 */
export const endInView = (endBottom: number | null, windowHeight: number) =>
  endBottom !== null && endBottom > 0 && endBottom <= windowHeight + 1;
