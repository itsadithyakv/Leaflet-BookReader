import { describe, expect, it } from "vitest";
import { bubbleArea } from "./pipBubbleArea";

describe("where Pip's bubble may go", () => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };

  it("on a phone on its side: right of the rail's column and clear of the notch, not cut at the page's edge", () => {
    // The rail's column: 74 px and a 51.81 px notch; a card's scrolling layer starting at the page's left edge.
    const area = bubbleArea({ left: 125.81, right: 915 }, { top: 0, right: 0, bottom: 24, left: 51.81 }, { width: 915, height: 412 }, { left: 125.81, top: 60, right: 915, bottom: 412 });
    expect(area.left).toBeCloseTo(133.81);
    expect(area.top).toBe(64);
    expect(area.right).toBe(907);
    expect(area.bottom).toBe(380);
  });

  it("upright: the window less its bars", () => {
    expect(bubbleArea({ left: 0, right: 412 }, { top: 52, right: 0, bottom: 24, left: 0 }, { width: 412, height: 915 }, null)).toEqual({ left: 8, top: 60, right: 404, bottom: 883 });
  });

  it("never turns inside out in a window too small for it", () => {
    const area = bubbleArea({ left: 300, right: 290 }, none, { width: 300, height: 10 }, null);
    expect(area.right).toBeGreaterThanOrEqual(area.left);
    expect(area.bottom).toBeGreaterThanOrEqual(area.top);
  });
});
