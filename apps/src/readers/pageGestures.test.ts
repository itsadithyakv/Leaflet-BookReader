import { describe, expect, it } from "vitest";
import { DOUBLE_TAP_MS, doubleTapFit, isDoubleTap, isTap, midpoint, pinchScale, pinchTransform, spreadOf } from "./pageGestures";

describe("a PDF's pages by finger", () => {
  it("pinches about the point between the fingers, by how far they moved apart", () => {
    expect(spreadOf({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(midpoint({ x: 0, y: 10 }, { x: 20, y: 30 })).toEqual({ x: 10, y: 20 });
    expect(pinchScale(1.2, 100, 200)).toBeCloseTo(2.4);
    expect(pinchScale(1.2, 200, 100)).toBeCloseTo(0.6);
    expect(pinchScale(1.2, 0, 100)).toBe(1.2);
  });

  it("goes between the whole page and its width on a double tap", () => {
    expect(doubleTapFit("page")).toBe("width");
    expect(doubleTapFit("width")).toBe("page");
    expect(doubleTapFit("free")).toBe("width");
    expect(doubleTapFit("actual")).toBe("width");
  });

  it("tells a double tap from two taps", () => {
    const first = { at: 0, x: 100, y: 100 };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { at: DOUBLE_TAP_MS - 1, x: 110, y: 95 })).toBe(true);
    expect(isDoubleTap(first, { at: DOUBLE_TAP_MS + 1, x: 100, y: 100 })).toBe(false);
    expect(isDoubleTap(first, { at: 100, x: 200, y: 100 })).toBe(false);
  });

  it("takes a short, still touch for a tap, and nothing else", () => {
    expect(isTap(4, 120)).toBe(true);
    expect(isTap(30, 120)).toBe(false);
    expect(isTap(2, 900)).toBe(false);
  });

  it("stretches the page under a pinch so the point between the fingers follows them", () => {
    const origin = { x: 40, y: 120 };
    const from = { x: 200, y: 400 };
    const to = { x: 230, y: 380 };
    const move = pinchTransform(origin, from, to, 1.5);
    // Where a point of the page lands, stretched from its top left corner and moved.
    const shown = (point: { x: number; y: number }) => ({
      x: origin.x + move.x + (point.x - origin.x) * move.scale,
      y: origin.y + move.y + (point.y - origin.y) * move.scale
    });
    expect(shown(from).x).toBeCloseTo(to.x);
    expect(shown(from).y).toBeCloseTo(to.y);
    expect(pinchTransform(origin, from, from, 1)).toEqual({ x: 0, y: 0, scale: 1 });
  });
});
