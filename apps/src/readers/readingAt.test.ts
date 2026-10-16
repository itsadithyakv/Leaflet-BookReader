import { describe, expect, it } from "vitest";
import {
  buildSectionWeights,
  chaptersFrameBook,
  dropsToStartAtOpen,
  isChapterLike,
  readingAt,
  STILL_READING_MAX,
  type SectionWeights
} from "./progress";

/**
 * The Well of Ascension as Leaflet makes it from its Kindle file: 148
 * sections (an epigraph page before each chapter), and contents of parts
 * whose only chapter-like entries are the epilogue and the appendix after it.
 * Sizes are the sections' own, in bytes.
 */
const WELL_SIZES = [
  1034, 1170, 729, 378, 458, 863, 293, 613, 567, 1515, 2980, 488, 323, 295, 324, 9254, 515, 23927, 394, 30704, 489, 9730, 339,
  41656, 579, 24092, 456, 11085, 379, 27149, 389, 4333, 399, 23168, 386, 31160, 297, 293, 418, 27622, 497, 42290, 392, 21494,
  532, 15142, 487, 29802, 327, 28374, 355, 20412, 318, 28196, 603, 29727, 301, 11915, 381, 31602, 284, 26179, 333, 10015, 298,
  38045, 360, 35331, 332, 31135, 301, 365, 22989, 598, 11573, 514, 27199, 278, 30002, 476, 14983, 333, 29772, 505, 28473, 317,
  27050, 407, 41053, 390, 19676, 445, 36435, 300, 281, 464, 14534, 528, 29928, 276, 27360, 368, 42995, 291, 26497, 330, 21934,
  319, 27618, 259, 38221, 261, 35174, 487, 20253, 300, 287, 328, 28903, 384, 42115, 271, 30541, 389, 33549, 495, 29969, 389,
  27050, 449, 16598, 298, 289, 331, 16715, 415, 40582, 283, 24406, 312, 4176, 13112, 25695, 1398, 25490, 692, 262, 844
];
const WELL_TOC: [number, string][] = [
  [1, "The Well of Ascension"],
  [4, "THE WELL OF ASCENSIONBOOK TWO OF MISTBORN"],
  [8, "TOR BOOKS BY BRANDON SANDERSON"],
  [11, "MAPS"],
  [13, "PART ONE"],
  [36, "PART TWO: Ghosts in the Mist"],
  [37, "PART TWO"],
  [70, "PART THREE: King"],
  [71, "PART THREE"],
  [93, "PART FOUR: Knives"],
  [94, "PART FOUR"],
  [115, "PART FIVE: Snow and Ash"],
  [116, "PART FIVE"],
  [131, "PART SIX: Words in Steel"],
  [132, "PART SIX"],
  [142, "EPILOGUE"],
  [143, "1. Metals Quick-Reference Chart"]
];
const wellHrefs = WELL_SIZES.map((_, index) => `text/chapter${index + 1}.xhtml`);
const wellToc = WELL_TOC.map(([file, label]) => ({ href: `text/chapter${file}.xhtml`, label }));
const wellIndexOf = (href: string) => {
  const index = wellHrefs.indexOf(href.split("#")[0]);
  return index >= 0 ? index : undefined;
};
const wellWeights = () =>
  buildSectionWeights(
    wellHrefs,
    wellHrefs.map((href, index) => ({ href, bytes: WELL_SIZES[index], linear: true })),
    wellToc,
    wellIndexOf
  )!;
/** As the reader lists them: the sections the chapter-like entries open, one per file. */
const wellChapterSpines = [...new Set(wellToc.filter((item) => isChapterLike(item.label)).map((item) => wellIndexOf(item.href)!))].sort(
  (a, b) => a - b
);
/** Where the owner was: chapter20.xhtml (epubcfi(/6/40!…)), some way in. */
const AT = { spineIndex: 19, within: 0.5, spineCount: WELL_SIZES.length };

describe("The Well of Ascension (a Kindle book made into an EPUB)", () => {
  it("has only its epilogue and appendix as chapter-like entries, near the end", () => {
    expect(wellChapterSpines).toEqual([141, 142]);
    expect(chaptersFrameBook(wellChapterSpines, WELL_SIZES.length)).toBe(false);
  });

  it("weighs every section as story (the parts frame nothing)", () => {
    const weights = wellWeights();
    expect(weights.lo).toBe(0);
    expect(weights.hi).toBe(147);
  });

  it("is read by size in chapter twenty, not front matter at 0%", () => {
    const reading = readingAt({ ...AT, weights: wellWeights(), chapterSpines: wellChapterSpines });
    expect(reading?.kind).toBe("read");
    const progress = reading?.kind === "read" ? reading.progress : 0;
    expect(reading?.kind === "read" && reading.by).toBe("sizes");
    // 46,120 bytes before chapter20.xhtml, half of its 30,704, of 1,636,831.
    expect(progress).toBeCloseTo((46120 + 30704 / 2) / 1636831, 5);
    expect(progress).toBeGreaterThan(0.02);
  });

  it("without section sizes is still past the start: the chapters are not trusted, the spine stands in", () => {
    const reading = readingAt({ ...AT, weights: null, chapterSpines: wellChapterSpines });
    expect(reading).toEqual({ kind: "read", progress: 19.5 / 148, by: "spine" });
  });

  it("without section sizes takes epub.js's index once it has one", () => {
    const reading = readingAt({ ...AT, weights: null, chapterSpines: wellChapterSpines, located: 0.034 });
    expect(reading).toEqual({ kind: "read", progress: 0.034, by: "locations" });
  });
});

describe("readingAt", () => {
  const sized = (bytes: number[], lo = 0, hi = bytes.length - 1): SectionWeights => {
    const prefix = [0];
    bytes.forEach((size, index) => prefix.push(prefix[index] + size));
    let last = hi;
    while (last > lo && bytes[last] === 0) {
      last -= 1;
    }
    return { bytes, prefix, lo, hi, last };
  };

  it("measures by size before the chapters are asked where the story starts", () => {
    const weights = sized([100, 100, 100, 100]);
    // Chapters that say the story starts at section 3 do not make section 1 front matter.
    const reading = readingAt({ spineIndex: 1, within: 0, spineCount: 4, weights, chapterSpines: [3, 3] });
    expect(reading).toEqual({ kind: "read", progress: 0.25, by: "sizes" });
  });

  it("keeps front and back matter by the sizes' story span", () => {
    const weights = sized([50, 100, 100, 50], 1, 2);
    expect(readingAt({ spineIndex: 0, within: 0.5, spineCount: 4, weights, chapterSpines: [] })).toEqual({ kind: "front" });
    expect(readingAt({ spineIndex: 3, within: 0.5, spineCount: 4, weights, chapterSpines: [] })).toEqual({ kind: "back" });
    expect(readingAt({ spineIndex: 2, within: 0.5, spineCount: 4, weights, chapterSpines: [] })).toEqual({ kind: "read", progress: 0.75, by: "sizes" });
  });

  it("is between two stories when the reader only looks there", () => {
    const weights = sized([100, 100, 100]);
    expect(readingAt({ spineIndex: 1, within: 0, spineCount: 3, weights, chapterSpines: [], between: (section) => section === 1 })).toEqual({
      kind: "between"
    });
  });

  it("finishes at the story's end: its last line in view, or its last page", () => {
    const weights = sized([100, 100]);
    expect(readingAt({ spineIndex: 1, within: 0.9, spineCount: 2, weights, chapterSpines: [], endInView: true })).toEqual({
      kind: "read",
      progress: 1,
      by: "sizes"
    });
    expect(readingAt({ spineIndex: 1, within: 1, spineCount: 2, weights, chapterSpines: [], page: { page: 5, total: 5 } })).toEqual({
      kind: "read",
      progress: 1,
      by: "sizes"
    });
    // Short of the last page: just short of finished.
    expect(readingAt({ spineIndex: 1, within: 1, spineCount: 2, weights, chapterSpines: [], page: { page: 4, total: 5 } })).toEqual({
      kind: "read",
      progress: STILL_READING_MAX,
      by: "sizes"
    });
  });

  it("goes by chapters without sizes when they frame the book", () => {
    const chapterSpines = [2, 4, 6, 8];
    const base = { spineCount: 10, weights: null, chapterSpines };
    expect(readingAt({ ...base, spineIndex: 1, within: 0.5 })).toEqual({ kind: "front" });
    expect(readingAt({ ...base, spineIndex: 9, within: 0.5 })).toEqual({ kind: "back" });
    expect(readingAt({ ...base, spineIndex: 5, within: 0.5 })).toEqual({
      kind: "read",
      progress: (1 + 0.5) / 4,
      by: "chapters",
      chapter: { index: 1, total: 4 }
    });
    // The section's own chapter, when it opens one, wins over counting.
    expect(readingAt({ ...base, spineIndex: 5, within: 0, chapterIndex: 2 })).toEqual({
      kind: "read",
      progress: 0.5,
      by: "chapters",
      chapter: { index: 2, total: 4 }
    });
    expect(readingAt({ ...base, spineIndex: 8, within: 0.99 })).toEqual({
      kind: "read",
      progress: 1,
      by: "chapters",
      chapter: { index: 3, total: 4 }
    });
  });

  it("does not trust a single chapter, or chapters that start in the book's second half", () => {
    expect(chaptersFrameBook([2], 10)).toBe(false);
    expect(chaptersFrameBook([6, 7], 10)).toBe(false);
    expect(chaptersFrameBook([4, 7], 10)).toBe(true);
    expect(chaptersFrameBook([], 10)).toBe(false);
    expect(readingAt({ spineIndex: 3, within: 0, spineCount: 10, weights: null, chapterSpines: [6, 7] })).toEqual({
      kind: "read",
      progress: 0.3,
      by: "spine"
    });
  });

  it("prefers epub.js's index to the spine, and clamps it", () => {
    expect(readingAt({ spineIndex: 3, within: 0, spineCount: 10, weights: null, chapterSpines: [], located: 1.2 })).toEqual({
      kind: "read",
      progress: 1,
      by: "locations"
    });
    expect(readingAt({ spineIndex: 3, within: 0, spineCount: 10, weights: null, chapterSpines: [], located: Number.NaN })?.kind).toBe("read");
  });

  it("is 0 only at the very start, and never finishes a book by the spine alone", () => {
    expect(readingAt({ spineIndex: 0, within: 0, spineCount: 10, weights: null, chapterSpines: [] })).toEqual({ kind: "read", progress: 0, by: "spine" });
    expect(readingAt({ spineIndex: 9, within: 1, spineCount: 10, weights: null, chapterSpines: [] })).toEqual({
      kind: "read",
      progress: STILL_READING_MAX,
      by: "spine"
    });
  });

  it("saves nothing for a place it cannot find", () => {
    expect(readingAt({ spineIndex: undefined, within: 0.5, spineCount: 10, weights: null, chapterSpines: [] })).toBeNull();
    expect(readingAt({ spineIndex: 12, within: 0.5, spineCount: 10, weights: null, chapterSpines: [] })).toBeNull();
    expect(readingAt({ spineIndex: 3, within: 0.5, spineCount: 0, weights: null, chapterSpines: [] })).toBeNull();
  });

  it("keeps the within fraction in range", () => {
    const weights = sized([100, 100]);
    expect(readingAt({ spineIndex: 0, within: 7, spineCount: 2, weights, chapterSpines: [] })).toEqual({ kind: "read", progress: 0.5, by: "sizes" });
    expect(readingAt({ spineIndex: 1, within: -3, spineCount: 2, weights, chapterSpines: [] })).toEqual({ kind: "read", progress: 0.5, by: "sizes" });
  });
});

describe("dropsToStartAtOpen", () => {
  it("skips taking a book back to its start while it is still opening", () => {
    expect(dropsToStartAtOpen(0.3, 0, true)).toBe(true);
    expect(dropsToStartAtOpen(0.3, 0.01, true)).toBe(true);
  });

  it("lets the reader do it, and lets an open move progress on", () => {
    expect(dropsToStartAtOpen(0.3, 0, false)).toBe(false);
    expect(dropsToStartAtOpen(0, 0.04, true)).toBe(false);
    expect(dropsToStartAtOpen(0.3, 0.25, true)).toBe(false);
    // A book at its start stays there.
    expect(dropsToStartAtOpen(0.01, 0, true)).toBe(false);
  });
});
