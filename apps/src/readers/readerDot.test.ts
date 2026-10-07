import { describe, expect, it } from "vitest";
import { DRAG_EDGE_ZONE, dotIsStranded, dragEdgeSpeed } from "./readerDot";

describe("Dotty and the chapters on the page", () => {
  it("is in place beside a line of a chapter on the page", () => {
    expect(dotIsStranded(36571, [20779, 41677])).toBe(false);
  });

  it("is stranded below a short chapter jumped to from deep in a long one", () => {
    // Deep in a chapter, then the cover (1,028px) from the chapter list: the
    // page scrolled on for 35,000px of nothing, and no chapter followed.
    expect(dotIsStranded(36571, [1028])).toBe(true);
  });

  it("is stranded while the page is being swapped", () => {
    expect(dotIsStranded(36571, [])).toBe(true);
  });

  it("may sit on the last line", () => {
    expect(dotIsStranded(1028, [1028])).toBe(false);
  });
});

describe("Dotty dragged against the edge of the window", () => {
  // A window from 0 to 800.
  it("leaves the page alone in the middle", () => {
    expect(dragEdgeSpeed(400, 0, 800)).toBe(0);
    expect(dragEdgeSpeed(DRAG_EDGE_ZONE, 0, 800)).toBe(0);
    expect(dragEdgeSpeed(800 - DRAG_EDGE_ZONE, 0, 800)).toBe(0);
  });

  it("scrolls up at the top and down at the bottom", () => {
    expect(dragEdgeSpeed(20, 0, 800)).toBeLessThan(0);
    expect(dragEdgeSpeed(780, 0, 800)).toBeGreaterThan(0);
    expect(dragEdgeSpeed(780, 0, 800)).toBeCloseTo(-dragEdgeSpeed(20, 0, 800));
  });

  it("starts slowly, so a line can be picked as it comes into view", () => {
    // Just inside the strip: a few lines a second at most.
    expect(Math.abs(dragEdgeSpeed(DRAG_EDGE_ZONE - 8, 0, 800))).toBeLessThan(120);
  });

  it("goes faster the further the pointer is pushed, past the edge too", () => {
    const inside = Math.abs(dragEdgeSpeed(32, 0, 800));
    const atEdge = Math.abs(dragEdgeSpeed(0, 0, 800));
    const beyond = Math.abs(dragEdgeSpeed(-40, 0, 800));
    expect(atEdge).toBeGreaterThan(inside);
    expect(beyond).toBeGreaterThan(atEdge);
    // About a screen a second at the edge itself.
    expect(atEdge).toBeCloseTo(700);
  });

  it("has a top speed however far the pointer goes", () => {
    expect(dragEdgeSpeed(-5000, 0, 800)).toBe(-2000);
    expect(dragEdgeSpeed(5000, 0, 800)).toBe(2000);
  });

  it("keeps a middle on a very short window", () => {
    // 120 px tall: the strips are a quarter each, not the whole of it.
    expect(dragEdgeSpeed(60, 0, 120)).toBe(0);
    expect(dragEdgeSpeed(10, 0, 120)).toBeLessThan(0);
    expect(dragEdgeSpeed(0, 0, 0)).toBe(0);
  });

  it("is measured from where the window is, not from the top of the screen", () => {
    expect(dragEdgeSpeed(120, 100, 900)).toBeLessThan(0);
    expect(dragEdgeSpeed(500, 100, 900)).toBe(0);
  });
});
