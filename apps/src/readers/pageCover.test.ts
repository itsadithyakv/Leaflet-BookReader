import { describe, expect, it } from "vitest";
import { COVER_WIDTH, coverScale, looksBlank } from "./pageCover";

/** A page of one colour, `width` by `height`, with rectangles of others drawn on it. */
const drawn = (width: number, height: number, paper: number, marks: Array<[x: number, y: number, w: number, h: number, shade: number]> = [], noise = 0) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const mark = marks.find(([mx, my, mw, mh]) => x >= mx && x < mx + mw && y >= my && y < my + mh);
      // A scan's paper is never one value: it wanders a few levels either way.
      const shade = mark ? mark[4] : paper + (noise ? ((x * 7 + y * 13) % (2 * noise + 1)) - noise : 0);
      data.set([shade, shade, shade, 255], (y * width + x) * 4);
    }
  }
  return data;
};

describe("the size a first page is drawn at", () => {
  it("is as wide as a cover", () => {
    // A4 and US Letter in points.
    expect(coverScale(595, 842) * 595).toBeCloseTo(COVER_WIDTH, 5);
    expect(coverScale(612, 792, 300) * 612).toBeCloseTo(300, 5);
    // A small page is drawn larger, a poster smaller.
    expect(coverScale(200, 300)).toBe(3);
    expect(coverScale(2400, 3600)).toBe(0.25);
  });

  it("is smaller for a page far taller than a cover", () => {
    // A receipt: 200 by 2000. Its height is kept to 2.2 widths of the picture.
    expect(coverScale(200, 2000) * 2000).toBeCloseTo(COVER_WIDTH * 2.2, 5);
    // A wide page (a slide) is just as wide.
    expect(coverScale(960, 540) * 960).toBeCloseTo(COVER_WIDTH, 5);
  });

  it("is 1 for a page with no size", () => {
    expect(coverScale(0, 842)).toBe(1);
    expect(coverScale(595, Number.NaN)).toBe(1);
    expect(coverScale(595, 842, 0)).toBe(1);
  });
});

describe("whether a first page has anything on it", () => {
  it("knows a blank page, typeset or scanned", () => {
    expect(looksBlank(drawn(120, 160, 255), 120, 160)).toBe(true);
    // Cream paper with a scanner's grain, and a few specks of dust.
    expect(looksBlank(drawn(120, 160, 226, [], 9), 120, 160)).toBe(true);
    expect(looksBlank(drawn(120, 160, 226, [[40, 40, 2, 2, 60]], 9), 120, 160)).toBe(true);
    // A page of one dark colour.
    expect(looksBlank(drawn(120, 160, 12), 120, 160)).toBe(true);
    expect(looksBlank(new Uint8ClampedArray(0), 0, 0)).toBe(true);
  });

  it("knows a page with a title on it, however little", () => {
    // Two short lines of type on a white page: about 1% of it.
    const title = drawn(240, 320, 255, [
      [70, 100, 100, 5, 0],
      [90, 120, 60, 3, 0]
    ]);
    expect(looksBlank(title, 240, 320)).toBe(false);
    // Light type on a dark cover, and a scanned cover that is all picture.
    expect(looksBlank(drawn(120, 160, 10, [[20, 60, 80, 8, 240]]), 120, 160)).toBe(false);
    expect(looksBlank(drawn(120, 160, 128, [[0, 0, 120, 80, 30], [0, 80, 60, 80, 220]]), 120, 160)).toBe(false);
  });

  it("reads no further than the page it was given", () => {
    // More bytes than the size says: only the page is judged.
    const longer = new Uint8ClampedArray(120 * 160 * 4 + 4000).fill(255);
    longer.fill(0, 120 * 160 * 4);
    expect(looksBlank(longer, 120, 160)).toBe(true);
    // Fewer: what there is.
    expect(looksBlank(drawn(120, 80, 255), 120, 160)).toBe(true);
  });
});
