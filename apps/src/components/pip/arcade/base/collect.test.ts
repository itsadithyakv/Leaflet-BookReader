import { describe, expect, it } from "vitest";
import { COUNT_MS, TRAIL_GAP_MS, TRAIL_MS, countAt, trailLands, trailPoint, trailSize } from "./collect";

describe("acorns flying to the count", () => {
  const from = { x: 120.3, y: 400.7 };
  const to = { x: 40, y: 24 };

  it("set off where they came from and land on the count", () => {
    expect(trailPoint(from, to, 0, 40)).toEqual({ x: 120, y: 401 });
    expect(trailPoint(from, to, 1, 40)).toEqual(to);
    // Past either end, they are held there.
    expect(trailPoint(from, to, -0.5, 40)).toEqual(trailPoint(from, to, 0, 40));
    expect(trailPoint(from, to, 1.5, 40)).toEqual(to);
  });

  it("are always at a whole device pixel, never between: a small sprite moved by fractions shimmers", () => {
    for (const dpr of [1, 2, 2.625, 3]) {
      for (let t = 0; t <= 1; t += 0.013) {
        const at = trailPoint(from, to, t, 55, dpr);
        expect(Math.abs(at.x * dpr - Math.round(at.x * dpr))).toBeLessThan(1e-6);
        expect(Math.abs(at.y * dpr - Math.round(at.y * dpr))).toBeLessThan(1e-6);
      }
    }
  });

  it("go in an arc, over the straight line, and smoothly: no jumps from one frame to the next", () => {
    const middle = trailPoint(from, to, 0.5, 60);
    expect(middle.y).toBeLessThan((from.y + to.y) / 2 - 50);
    let last = trailPoint(from, to, 0, 60);
    for (let frame = 1; frame <= 34; frame++) {
      const at = trailPoint(from, to, frame / 34, 60);
      expect(Math.hypot(at.x - last.x, at.y - last.y)).toBeLessThan(40);
      last = at;
    }
  });

  it("are a few for a few acorns, and never more than six", () => {
    expect(trailSize(0)).toBe(0);
    expect(trailSize(-3)).toBe(0);
    expect(trailSize(1)).toBe(1);
    expect(trailSize(12)).toBe(3);
    expect(trailSize(500)).toBe(6);
    expect(trailLands(1)).toEqual({ first: TRAIL_MS, last: TRAIL_MS });
    expect(trailLands(6).last - trailLands(6).first).toBe(5 * TRAIL_GAP_MS);
    expect(COUNT_MS).toBeGreaterThan(0);
  });
});

describe("the count going up and down", () => {
  it("is whole acorns all the way, from the one figure to the other", () => {
    expect(countAt(10, 34, 0)).toBe(10);
    expect(countAt(10, 34, 1)).toBe(34);
    expect(countAt(10, 34, 2)).toBe(34);
    let last = 10;
    for (let t = 0; t <= 1; t += 0.05) {
      const figure = countAt(10, 34, t);
      expect(Number.isInteger(figure)).toBe(true);
      expect(figure).toBeGreaterThanOrEqual(last);
      last = figure;
    }
    // Spent: down, the same way.
    expect(countAt(80, 30, 0.5)).toBeLessThan(80);
    expect(countAt(80, 30, 0.5)).toBeGreaterThan(30);
  });
});
