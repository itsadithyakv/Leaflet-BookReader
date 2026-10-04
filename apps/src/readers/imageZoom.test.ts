import { describe, expect, it } from "vitest";
import { FIT_MARGIN, clampView, fitScale, fitView, isViewable, panBy, zoomAt, zoomLimits } from "./imageZoom";

const map = { width: 1600, height: 1200 };
const win = { width: 1024, height: 768 };

describe("looking at a picture", () => {
  it("opens for a picture, not for an ornament or a drop cap", () => {
    expect(isViewable(400, 300)).toBe(true);
    expect(isViewable(32, 32)).toBe(false);
    expect(isViewable(600, 20)).toBe(false);
  });

  it("fits the whole picture in the window, with a little room", () => {
    const scale = fitScale(map, win);
    expect(map.width * scale).toBeLessThanOrEqual(win.width - 2 * FIT_MARGIN + 0.001);
    expect(map.height * scale).toBeLessThanOrEqual(win.height - 2 * FIT_MARGIN + 0.001);
    // A tall picture is held by its height.
    expect(fitScale({ width: 600, height: 2400 }, win)).toBeCloseTo((win.height - 2 * FIT_MARGIN) / 2400);
    // A small one is not blown up past twice its size.
    expect(fitScale({ width: 100, height: 80 }, win)).toBe(2);
    expect(fitView(map, win)).toEqual({ scale: fitScale(map, win), x: 0, y: 0 });
  });

  it("zooms about the pointer: what is under it stays under it", () => {
    const start = fitView(map, win);
    const at = { x: 200, y: -100 };
    // The picture point under the pointer, before and after.
    const under = (view: { scale: number; x: number; y: number }) => ({ x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale });
    const zoomed = zoomAt(start, 2, map, win, at);
    expect(zoomed.scale).toBeCloseTo(start.scale * 2);
    expect(under(zoomed).x).toBeCloseTo(under(start).x);
    expect(under(zoomed).y).toBeCloseTo(under(start).y);
  });

  it("stops at the fitted size going out, and at a limit going in", () => {
    const limits = zoomLimits(map, win);
    const fitted = fitView(map, win);
    expect(zoomAt(fitted, 0.5, map, win)).toEqual(fitted);
    let view = fitted;
    for (let step = 0; step < 40; step += 1) {
      view = zoomAt(view, 1.25, map, win);
    }
    expect(view.scale).toBe(limits.max);
    expect(limits.max).toBeGreaterThanOrEqual(8);
  });

  it("keeps a picture that fits in the middle, and a larger one within reach", () => {
    const fitted = fitView(map, win);
    expect(panBy(fitted, 300, 300, map, win)).toEqual(fitted);
    const close = zoomAt(fitted, 4, map, win);
    const dragged = panBy(close, 10_000, -10_000, map, win);
    // Its left edge has reached the window's, and its bottom edge the bottom.
    expect(dragged.x).toBeCloseTo((map.width * close.scale - win.width) / 2);
    expect(dragged.y).toBeCloseTo(-(map.height * close.scale - win.height) / 2);
  });

  it("comes back to the middle when zoomed out again", () => {
    const fitted = fitView(map, win);
    const out = zoomAt(panBy(zoomAt(fitted, 4, map, win), 500, 200, map, win), 0.01, map, win);
    expect(out.scale).toBeCloseTo(fitted.scale);
    expect(Math.abs(out.x)).toBe(0);
    expect(Math.abs(out.y)).toBe(0);
    // A window resized under a zoomed picture pulls it back into reach.
    const small = clampView({ scale: 3, x: 4000, y: 0 }, map, { width: 500, height: 400 });
    expect(small.x).toBeCloseTo((map.width * 3 - 500) / 2);
  });
});
