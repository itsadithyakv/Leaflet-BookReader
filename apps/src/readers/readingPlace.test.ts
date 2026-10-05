import { describe, expect, it } from "vitest";
import { LINE_TOLERANCE, PICTURE_SHOWING, firstAtLine, placeToSave, readingLineIn, type LinePiece } from "./readingPlace";

const PAD = 80;
const WINDOW = 768;

describe("the reading line", () => {
  it("is taken below the toolbar, not at the top of the window", () => {
    // One chapter, scrolled 3,000 px in.
    const found = readingLineIn([{ top: -3000, height: 18_000 }], PAD, WINDOW);
    expect(found).toEqual({ index: 0, start: 3000 + PAD - LINE_TOLERANCE, end: 3000 + WINDOW });
  });

  it("lands on the same line every time: a place put back at the reading line is found there again", () => {
    // A line at 5,000 px in its chapter is gone to (its top at the window's
    // top), then brought down below the toolbar: the chapter starts 4,920 px up.
    const lineAt = 5000;
    const chapterTop = -(lineAt - PAD);
    const found = readingLineIn([{ top: chapterTop, height: 18_000 }], PAD, WINDOW);
    // The search starts just above that line, so it is the first one found…
    expect(found!.start).toBeLessThanOrEqual(lineAt);
    expect(lineAt - found!.start).toBeLessThanOrEqual(LINE_TOLERANCE);
    // …where the top of the window (the old rule) named a line 80 px earlier.
    expect(lineAt - -chapterTop).toBe(PAD);
  });

  it("allows for a scroll position that fell between pixels", () => {
    const found = readingLineIn([{ top: -(5000 - PAD) - 0.67, height: 18_000 }], PAD, WINDOW);
    expect(found!.start).toBeLessThanOrEqual(5000);
  });

  it("passes over a chapter whose last lines are under the toolbar", () => {
    // The chapter before ends 30 px down the window; the next starts there.
    const found = readingLineIn(
      [
        { top: -9970, height: 10_000 },
        { top: 30, height: 12_000 }
      ],
      PAD,
      WINDOW
    );
    expect(found).toEqual({ index: 1, start: PAD - 30 - LINE_TOLERANCE, end: WINDOW - 30 });
  });

  it("reads a chapter that starts below the reading line from its top", () => {
    const found = readingLineIn([{ top: 300, height: 5000 }], PAD, WINDOW);
    expect(found).toEqual({ index: 0, start: 0, end: WINDOW - 300 });
  });

  it("stops at the end of a short chapter", () => {
    const found = readingLineIn([{ top: -100, height: 400 }], PAD, WINDOW);
    expect(found).toEqual({ index: 0, start: 180 - LINE_TOLERANCE, end: 400 });
  });

  it("finds nothing on an empty page, or one whose chapters are all above or below", () => {
    expect(readingLineIn([], PAD, WINDOW)).toBeNull();
    expect(readingLineIn([{ top: -5000, height: 5000 }], PAD, WINDOW)).toBeNull();
    expect(readingLineIn([{ top: 900, height: 5000 }], PAD, WINDOW)).toBeNull();
    expect(readingLineIn([{ top: 0, height: 0 }], PAD, WINDOW)).toBeNull();
  });
});

describe("the place that is saved", () => {
  it("is the reading line when scrolling, so reopening does not creep", () => {
    expect(placeToSave("scroll", "cfi-reading-line", "cfi-top")).toBe("cfi-reading-line");
  });

  it("falls back to the top of the window when the reading line cannot be read", () => {
    expect(placeToSave("scroll", null, "cfi-top")).toBe("cfi-top");
    expect(placeToSave("scroll", null, null)).toBeNull();
  });

  it("is the page's first line with pages", () => {
    expect(placeToSave("pages", "cfi-reading-line", "cfi-page")).toBe("cfi-page");
  });
});

describe("the first word at the reading line", () => {
  const LINE = 32;
  /** A text node of `lines` lines of `perLine` words, its first line at `top`. */
  const text = (top: number, lines: number, perLine = 10): LinePiece => ({
    box: { top, bottom: top + lines * LINE - 11 },
    words: lines * perLine,
    wordTop: (word) => top + Math.floor(word / perLine) * LINE
  });
  const picture = (top: number, height: number): LinePiece => ({ box: { top, bottom: top + height }, words: 0, wordTop: () => null });

  it("is the first word of the first line at or below it, not the start of its paragraph", () => {
    // A paragraph of 8 lines from 1,000; the reading line falls in its fourth line.
    const found = firstAtLine([text(0, 30), text(1000, 8)], 1000 + 3 * LINE + 5);
    // The fifth line's first word: word 40 of the second piece.
    expect(found).toEqual({ piece: 1, word: 40 });
  });

  it("takes a line that starts exactly at the reading line", () => {
    expect(firstAtLine([text(1000, 8)], 1000 + 2 * LINE)).toEqual({ piece: 0, word: 20 });
  });

  it("goes on to the next paragraph when only the tail of a last line is cut", () => {
    // The paragraph's last line starts 6 px above the reading line: epub.js
    // named the paragraph's first word, six lines up.
    const first = text(1000, 6);
    const start = 1000 + 5 * LINE + 6;
    expect(first.box!.bottom).toBeGreaterThan(start);
    expect(firstAtLine([first, text(1000 + 6 * LINE + 29, 4)], start)).toEqual({ piece: 1, word: 0 });
  });

  it("passes over hidden text and words that are not drawn", () => {
    const hidden: LinePiece = { box: null, words: 5, wordTop: () => 0 };
    const gappy: LinePiece = { box: { top: 500, bottom: 600 }, words: 4, wordTop: (word) => (word === 2 ? null : 500 + (word > 2 ? LINE : 0)) };
    expect(firstAtLine([hidden, gappy], 520)).toEqual({ piece: 1, word: 3 });
  });

  it("names a picture that starts at the line, or that still shows below it", () => {
    expect(firstAtLine([text(0, 3), picture(200, 600)], 150)).toEqual({ piece: 1, word: -1 });
    // Half way down a tall picture: the picture, not the text a screen below it.
    expect(firstAtLine([picture(200, 900), text(1200, 5)], 600)).toEqual({ piece: 0, word: -1 });
    // Only its last few pixels show: the text after it.
    expect(firstAtLine([picture(200, 400), text(650, 5)], 600 - PICTURE_SHOWING + 1)).toEqual({ piece: 1, word: 0 });
  });

  it("finds nothing past the end of the chapter", () => {
    expect(firstAtLine([text(0, 3)], 500)).toBeNull();
    expect(firstAtLine([], 0)).toBeNull();
  });
});
