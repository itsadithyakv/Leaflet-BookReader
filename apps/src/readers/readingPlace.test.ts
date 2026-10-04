import { describe, expect, it } from "vitest";
import { LINE_TOLERANCE, placeToSave, readingLineIn } from "./readingPlace";

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
