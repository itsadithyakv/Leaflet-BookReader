/**
 * How much reading is left: in the chapter, and in the book, at the reader's
 * own pace for this book (see paceModel).
 *
 * Words are counted in the chapters the page holds; the rest of the book is
 * estimated from each section's size (`SectionWeights`, the bytes it takes in
 * the EPUB) and the words a byte has held so far. That ratio moves a little
 * each time a chapter is counted, so what is shown is rounded to steps a
 * reader would say aloud and held steady until the estimate has really moved:
 * a number that twitched as chapters loaded would be worse than none.
 */

import type { SectionWeights } from "./progress";

/** Words counted per section (spine index), for the sections seen so far. */
export type SectionWords = ReadonlyMap<number, number>;

/** A section with fewer bytes than this says little about the book's words a byte (a title page is all markup). */
const MIN_SAMPLE_BYTES = 2000;

/**
 * Words per byte across the sections counted, or null when none has enough
 * text to go on. `remembered` is the ratio from an earlier visit to the book
 * and how many bytes it came from: the larger sample wins, so the estimate
 * does not start over each time the book opens.
 */
export const wordsPerByte = (
  counted: SectionWords,
  bytes: readonly number[],
  remembered?: { ratio: number; bytes: number } | null
) => {
  let words = 0;
  let size = 0;
  counted.forEach((count, index) => {
    const sectionBytes = bytes[index] ?? 0;
    if (sectionBytes >= MIN_SAMPLE_BYTES && count > 0) {
      words += count;
      size += sectionBytes;
    }
  });
  if (remembered && remembered.ratio > 0 && remembered.bytes > size) {
    return { ratio: remembered.ratio, bytes: remembered.bytes };
  }
  return size > 0 ? { ratio: words / size, bytes: size } : null;
};

export type PlaceInBook = {
  weights: SectionWeights;
  /** The section (spine index) being read, and how far through it (0 to 1). */
  section: number;
  within: number;
  /** The last section of the chapter being read (a chapter may run over several files). */
  chapterEnd: number;
  counted: SectionWords;
  /** Words per byte, for the sections not counted. */
  ratio: number;
};

/**
 * Words left in the chapter and in the book (to the end of the story: back
 * matter is not reading left, as it is not progress). `book` is null past the
 * end of the story, where "left in the book" means nothing.
 */
export const wordsLeft = ({ weights, section, within, chapterEnd, counted, ratio }: PlaceInBook) => {
  const wordsIn = (index: number) => counted.get(index) ?? (weights.bytes[index] ?? 0) * ratio;
  const rest = wordsIn(section) * (1 - Math.min(1, Math.max(0, within)));
  const through = (last: number) => {
    let total = rest;
    for (let index = section + 1; index <= last; index += 1) {
      total += wordsIn(index);
    }
    return total;
  };
  return {
    chapter: through(Math.max(section, chapterEnd)),
    book: section > weights.hi ? null : through(weights.hi)
  };
};

/**
 * The last section of the chapter a section is in: the one before the next
 * entry in the contents. `starts` are the sections the contents' entries open
 * (in any order); `last` is where the book's sections end.
 */
export const chapterEndFor = (section: number, starts: readonly number[], last: number) => {
  let next = Number.POSITIVE_INFINITY;
  for (const start of starts) {
    if (start > section && start < next) {
      next = start;
    }
  }
  return Number.isFinite(next) ? Math.max(section, next - 1) : Math.max(section, last);
};

/** The step minutes are rounded to: finer when little is left. */
const stepFor = (minutes: number) => (minutes < 10 ? 1 : minutes < 60 ? 5 : minutes < 300 ? 10 : minutes < 600 ? 30 : 60);

/** Minutes as a reader would say them: 0 stands for "less than a minute". */
export const roundMinutes = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes < 1) {
    return 0;
  }
  const step = stepFor(minutes);
  return Math.max(1, Math.round(minutes / step) * step);
};

/**
 * What to show, given what is showing: the rounded estimate, unless it has
 * only wobbled across the edge between two steps. Reading on brings it down
 * a step at a time; a jump elsewhere moves it at once.
 */
export const steadyMinutes = (shown: number | null, minutes: number) => {
  const rounded = roundMinutes(minutes);
  if (shown === null || rounded === shown) {
    return rounded;
  }
  // Most of a step past what is showing before it changes its mind (the
  // finer of the two steps, so the last minutes still count down singly).
  const step = Math.min(stepFor(minutes), stepFor(shown));
  return Math.abs(minutes - shown) < step * 0.75 ? shown : rounded;
};

/** "less than a minute", "about 12 min", "about 3 hours", "about 3 h 20 min". */
export const describeMinutes = (rounded: number) => {
  if (rounded < 1) {
    return "less than a minute";
  }
  if (rounded < 60) {
    return `about ${rounded} min`;
  }
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (rest === 0) {
    return `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `about ${hours} h ${rest} min`;
};

/** The same, short: "<1 min", "12 min", "3 h", "3 h 20 min". */
export const describeMinutesShort = (rounded: number) => {
  if (rounded < 1) {
    return "<1 min";
  }
  if (rounded < 60) {
    return `${rounded} min`;
  }
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

/** Minutes for words at a pace; null without a pace worth the name. */
export const minutesFor = (words: number, wpm: number | null) =>
  wpm && Number.isFinite(wpm) && wpm >= 40 ? Math.max(0, words) / wpm : null;
