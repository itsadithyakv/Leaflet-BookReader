/**
 * Reading progress for EPUBs: chapter titles, and progress weighted by how
 * much of the book each section holds. Pure functions, kept out of the reader
 * so they can be tested on their own.
 */

import { FINISHED_AT } from "../constants/books";

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

/** What comes after a story, by its name in the contents: "Appendix II: …", "Excerpt from …", "Also by …", "A Note about the Author". */
const BACK_MATTER =
  /^(appendix|appendices|acknowledge?ments?|afterword|notes?|endnotes|footnotes|glossary|index|bibliography|references|credits|colophon|copyright|back ads?|also by|other (titles|books)|by the same author|more (from|by)|about the (author|publisher|type)|(a |an |the )?(special |bonus |sneak )?(preview|excerpt|peek|teaser)|(a )?note (about|on) the (author|type)|reading group|discussion questions|newsletter|follow (us|penguin|the (author|publisher))|sign up|stay in touch|discover more)\b/;

/** Named as front or back matter: the cover, the title page and the like before a story; what `BACK_MATTER` names after it. */
export const isOutsideLabel = (label: string) => {
  const text = normalizeLabel(label);
  return isFrontMatter(text) || BACK_MATTER.test(text) || /^(cover|epigraph|praise|half title|frontispiece)\b/.test(text);
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
    .map((item) => ({ spine: spineIndexOf(item.href), label: item.label }))
    .filter((entry): entry is StoryEntry => typeof entry.spine === "number");
  const story = storySpan(entries, prefix, lo, hi, (section) => isBackMatterFile(spineHrefs[section] ?? ""));
  if (story) {
    lo = story.lo;
    hi = story.hi;
  }
  let last = hi;
  while (last > lo && bytes[last] === 0) {
    last -= 1;
  }
  return { bytes, prefix, lo, hi, last };
};

/** A contents entry that opens a section of the book, in contents order. */
export type StoryEntry = { spine: number; label: string };

/**
 * A section's file named for what follows a story: "appendix001.xhtml",
 * "endpage.xhtml", "bm2.htm", "copyright.xhtml". Read only for sections the
 * contents do not list, at a story's end.
 */
export const isBackMatterFile = (href: string) => {
  const name = (href.split(/[?#]/)[0].split("/").pop() ?? "").toLowerCase().replace(/\.[a-z0-9]+$/, "");
  return /^(appendix|appendices|back_?matter|bm|end_?page|ads?|adverts?|also_?by|about_?the_?(author|publisher)|ata|copyright|colophon|teaser|excerpt|preview|promo|newsletter|endnotes|footnotes)(?![a-z])/.test(
    name.replace(/^[a-z]{0,6}_?\d{6,}_(epub_)?/, "")
  );
};

/**
 * The story of a book none of whose contents entries reads as a chapter (a
 * collection of stories, each under its own name): from the first entry not
 * named as front matter to the section before the closing run of entries
 * named as back matter, less any unlisted sections just before that run
 * whose files are named for back matter. Null when nothing is trimmed.
 *
 * Such a book's story used to be every section: a collection reached 99% on
 * the publisher's "follow us" page and was finished only at the foot of its
 * copyright page, after fifteen kilobytes of the publisher's other books.
 */
const spanByOutsideLabels = (
  placed: readonly (StoryEntry & { position: number })[],
  prefix: readonly number[],
  from: number,
  to: number,
  backFile: (section: number) => boolean
) => {
  const story = placed.filter((entry) => !isOutsideLabel(entry.label));
  if (story.length === 0) {
    return null;
  }
  const firstStory = story[0];
  const lastStory = story.reduce((a, b) => (b.spine >= a.spine ? b : a));
  // Front matter leads only when every entry before the first story is named as such.
  const lo = firstStory.position > (placed[0]?.position ?? 0) ? Math.max(from, firstStory.spine) : from;
  const closing = placed.filter((entry) => entry.position > lastStory.position && entry.spine > lastStory.spine);
  let hi = closing.length > 0 ? Math.min(...closing.map((entry) => entry.spine)) - 1 : to;
  const listed = new Set(placed.map((entry) => entry.spine));
  while (hi > lastStory.spine && !listed.has(hi) && (prefix[hi + 1] - prefix[hi] === 0 || backFile(hi))) {
    hi -= 1;
  }
  if (lo === from && hi === to) {
    return null;
  }
  return hi >= lo && prefix[hi + 1] - prefix[lo] >= (prefix[to + 1] - prefix[from]) * 0.5 ? { lo, hi } : null;
};

/** Named chapters after the last "Chapter N" entry are the story when they hold this share of the sections looked at. */
const NAMED_TAIL_SHARE = 0.1;

/**
 * Where the story starts and ends among the sections `from..to`, read from
 * the contents entries that open them; null when the entries do not frame it
 * (then it is every section).
 *
 * It starts at the first entry that reads as a chapter ("Chapter 3", "Book
 * One", "Prologue") and ends before the entry after the last one, so a
 * chapter split over several files is kept whole.
 *
 * Chapters with names of their own ("Tyrion", "The Prophet") do not read as
 * chapters, and in a novel that opens with a prologue the prologue was the
 * last one that did: a boxed set of four such novels had its story end at the
 * fourth one's prologue, 77% of the way through the file, and the whole of
 * the fourth novel was back matter (nothing read there was saved). So the
 * story runs on through the entries after the last chapter up to the first
 * that is named as front or back matter ("Appendix", "Acknowledgments"), when
 * they are a tenth of the sections or more; a short named piece after an
 * epilogue (a glossary under a name of its own) stays outside it, as before.
 */
export const storySpan = (
  entries: readonly StoryEntry[],
  prefix: readonly number[],
  from: number,
  to: number,
  /** Whether a section's file is named for back matter (`isBackMatterFile`); asked only of sections no entry opens. */
  backFile: (section: number) => boolean = () => false
) => {
  const total = prefix[to + 1] - prefix[from];
  const placed = entries.map((entry, position) => ({ ...entry, position })).filter((entry) => entry.spine >= from && entry.spine <= to);
  const chapters = placed.filter((entry) => isChapterLike(entry.label));
  if (total <= 0) {
    return null;
  }
  if (chapters.length === 0) {
    return spanByOutsideLabels(placed, prefix, from, to, backFile);
  }
  const first = Math.min(...chapters.map((entry) => entry.spine));
  const lastChapter = chapters.reduce((a, b) => (b.spine >= a.spine ? b : a));
  // The story runs on through a chapter split over several files, up to the
  // next entry in the contents (acknowledgements, notes, about the author).
  const tail = placed.filter((entry) => entry.position > lastChapter.position && entry.spine > lastChapter.spine);
  const after = tail[0];
  let end = after ? after.spine - 1 : to;
  let named = false;
  if (after && !isOutsideLabel(after.label)) {
    const stop = tail.find((entry) => isOutsideLabel(entry.label));
    const namedEnd = stop ? stop.spine - 1 : to;
    if (namedEnd > end && prefix[namedEnd + 1] - prefix[after.spine] >= total * NAMED_TAIL_SHARE) {
      end = namedEnd;
      named = true;
    }
  }
  if (chapters.length < 2 && !named) {
    return null;
  }
  return end >= first && prefix[end + 1] - prefix[first] >= total * 0.5 ? { lo: first, hi: end } : null;
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
  // (As whole words: "eBook Information" is not a chapter.)
  if (/\b(chapter|book|section)\b/.test(text)) {
    return true;
  }
  if (/^(prologue|epilogue)\b/.test(text)) {
    return true;
  }
  if (/^[ivxlcdm]+\.?$/.test(text)) {
    return true;
  }
  // A number, or a number and a title: "12", "12: The Road", "12. The Road",
  // "12 · The Road". (Contents that number their chapters without the word
  // had one chapter-like entry, the prologue, and the story was the whole
  // file: the adverts and the next book's first chapter counted as reading.)
  if (/^\d{1,3}(\s*[.:·—–-]\s+\S|\s*[.:]?$)/.test(text)) {
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

/**
 * The most a book is saved as read while there is story left: just short of
 * finished (`FINISHED_AT` in constants/books.ts).
 */
export const STILL_READING_MAX = FINISHED_AT - 0.005;

/**
 * The progress to save. A book is finished when the reader reaches the end
 * of the story's last section (its last page with pages; its last line on
 * screen when scrolling), not when the weighted progress rounds past 99%:
 * that marked Mistborn finished on page 9 of the 23 of its epilogue, with
 * the shelf, the diary and the profile all taking it for read. Until the end
 * the progress stops just short.
 *
 * A book already finished stays so while the reader is back among its last
 * pages (as it always did); going further back un-finishes it, as it always
 * did too.
 */
export const progressToSave = (progress: number, atEnd: boolean, wasFinished = false) => {
  if (atEnd) {
    return 1;
  }
  const known = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return wasFinished && known >= FINISHED_AT ? known : Math.min(known, STILL_READING_MAX);
};

/** With pages: whether this is the last page of the story's last section. */
export const onLastPage = (section: number, lastSection: number, page: number, total: number) =>
  section >= lastSection && total >= 1 && page >= total;

/**
 * Scrolling: whether the story's end has been reached. It is in the window
 * (`endInView`), or it was below the window when last looked at and is now
 * above it: a long scroll carried it past between two looks.
 */
export const endReached = (endBottom: number | null, windowHeight: number, wasBelow: boolean) =>
  endInView(endBottom, windowHeight) || (wasBelow && endBottom !== null && endBottom <= windowHeight + 1);
