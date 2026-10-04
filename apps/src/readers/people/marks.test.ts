import { describe, expect, it } from "vitest";
import { clickAsks, pointInRects, type ClickFacts } from "./marks";

const plain: ClickFacts = { button: 0, modified: false, handled: false, onLink: false, selecting: false, moved: 0 };

describe("a click on a marked name", () => {
  it("asks who it is when it is a plain click on plain text", () => {
    expect(clickAsks(plain)).toBe(true);
    // A hand is never perfectly still.
    expect(clickAsks({ ...plain, moved: 4 })).toBe(true);
  });

  it("is left alone when the reader is selecting text", () => {
    expect(clickAsks({ ...plain, selecting: true })).toBe(false);
    expect(clickAsks({ ...plain, moved: 30 })).toBe(false);
    expect(clickAsks({ ...plain, modified: true })).toBe(false);
  });

  it("is the link's or the footnote's when it is on one", () => {
    expect(clickAsks({ ...plain, onLink: true })).toBe(false);
    expect(clickAsks({ ...plain, handled: true })).toBe(false);
  });

  it("is not a click with another button", () => {
    expect(clickAsks({ ...plain, button: 1 })).toBe(false);
    expect(clickAsks({ ...plain, button: 2 })).toBe(false);
  });
});

describe("whether a point is on a name's words", () => {
  // A name broken over two lines: the end of one, the start of the next.
  const rects = [
    { left: 300, right: 340, top: 100, bottom: 120 },
    { left: 40, right: 90, top: 124, bottom: 144 }
  ];

  it("is on either part", () => {
    expect(pointInRects(320, 110, rects)).toBe(true);
    expect(pointInRects(60, 130, rects)).toBe(true);
  });

  it("is not in the margin beside it, where a caret would still snap to it", () => {
    expect(pointInRects(400, 110, rects)).toBe(false);
    expect(pointInRects(200, 130, rects)).toBe(false);
    expect(pointInRects(320, 200, rects)).toBe(false);
  });

  it("forgives a pixel or two", () => {
    expect(pointInRects(341, 121, rects)).toBe(true);
    expect(pointInRects(344, 110, rects)).toBe(false);
    expect(pointInRects(10, 10, [])).toBe(false);
  });
});
