import { describe, expect, it } from "vitest";
import { autoScrollCounted, autoScrollLinesPerMinute, autoScrollPixelsPerSecond, autoScrollSpeedForLines, autoScrollStep } from "./autoScroll";
import { lineHeightPx } from "./readerTypes";

describe("auto-scroll's slider and lines a minute", () => {
  it("go both ways", () => {
    for (const speed of [0, 10, 35, 72, 100]) {
      expect(autoScrollSpeedForLines(autoScrollLinesPerMinute(speed))).toBeCloseTo(speed, -0.5);
    }
  });

  it("keeps to the slider's ends", () => {
    expect(autoScrollSpeedForLines(1)).toBe(0);
    expect(autoScrollSpeedForLines(500)).toBe(100);
  });

  it("moves a line's height for each line, whatever the spacing", () => {
    // The same lines a minute at every spacing: airy type covers more pixels.
    const lines = autoScrollLinesPerMinute(35);
    for (const spacing of ["compact", "normal", "airy"] as const) {
      const perMinute = autoScrollPixelsPerSecond(35, lineHeightPx(18, spacing)) * 60;
      expect(perMinute / lineHeightPx(18, spacing)).toBeCloseTo(lines);
    }
    expect(autoScrollPixelsPerSecond(35, lineHeightPx(18, "airy"))).toBeGreaterThan(
      autoScrollPixelsPerSecond(35, lineHeightPx(18, "compact"))
    );
    // Normal spacing is what it always was: 1.8 of the type size.
    expect(autoScrollPixelsPerSecond(35, lineHeightPx(18, "normal"))).toBeCloseTo((lines * 1.8 * 18) / 60);
  });

  it("slows the page for a wide line: the same pace is fewer lines", () => {
    // 240 words a minute, at 12 words a line and at 30.
    expect(autoScrollSpeedForLines(240 / 12)).toBeGreaterThan(autoScrollSpeedForLines(240 / 30));
  });
});

describe("auto-scroll's step each frame", () => {
  /**
   * Ten seconds of frames at 60 a second, as useAutoScrollEngine runs them,
   * over a page that lands on whole pixels of `snap` per CSS pixel (the
   * screen's, or 1: whole CSS pixels).
   */
  const run = (pxPerSecond: number, ratio: number, snap: number) => {
    let top = 0;
    let carry = 0;
    const moves: number[] = [];
    for (let frame = 0; frame < 600; frame += 1) {
      carry += pxPerSecond / 60;
      const before = top;
      const step = autoScrollStep(carry, ratio);
      if (step > 0) {
        top = Math.round((before + step) * snap) / snap;
        carry -= autoScrollCounted(step, top - before);
      }
      moves.push(top - before);
    }
    return { top, moves };
  };

  it("moves a phone's text a screen pixel at a time, on most frames, not a CSS pixel every third or fourth", () => {
    // 36 lines a minute of 29 px lines on a 2.625 phone.
    const pace = (36 * 29) / 60;
    const { top, moves } = run(pace, 2.625, 2.625);
    const moving = moves.filter((move) => move > 0);
    expect(moving.length).toBeGreaterThan(600 * 0.6);
    for (const move of moving) expect(move).toBeCloseTo(1 / 2.625, 6);
    // And the pace is kept: within a screen pixel of 10 seconds' worth.
    expect(Math.abs(top - pace * 10)).toBeLessThan(1 / 2.625 + 1e-6);
    // What it did before: a whole CSS pixel on under a third of the frames.
    const old = run(pace, 1, 1).moves.filter((move) => move > 0);
    expect(old.length).toBeLessThan(600 * 0.3);
  });

  it("keeps the pace on a page that only scrolls by whole CSS pixels", () => {
    const pace = 17.4;
    const { top, moves } = run(pace, 2.625, 1);
    expect(Math.abs(top - pace * 10)).toBeLessThanOrEqual(1);
    expect(Math.max(...moves)).toBeLessThanOrEqual(1);
  });

  it("is whole CSS pixels on a screen of one pixel to one, and nothing with nothing carried", () => {
    expect(autoScrollStep(2.7, 1)).toBe(2);
    expect(autoScrollStep(0.9, 1)).toBe(0);
    expect(autoScrollStep(0, 2.625)).toBe(0);
    expect(autoScrollStep(-1, 2)).toBe(0);
    expect(autoScrollStep(1 / 2.625, 2.625)).toBeCloseTo(1 / 2.625, 9);
    expect(autoScrollStep(0.75, 1.5)).toBeCloseTo(2 / 3, 9);
    // A ratio that makes no sense is taken for 1.
    expect(autoScrollStep(1.5, Number.NaN)).toBe(1);
    expect(autoScrollStep(1.5, 0)).toBe(1);
  });

  it("counts what the page moved, and a whole pixel not taken (the end of what is loaded) as before", () => {
    expect(autoScrollCounted(0.38, 0.38)).toBe(0.38);
    expect(autoScrollCounted(1, 1.33)).toBe(1.33);
    expect(autoScrollCounted(2, 0)).toBe(2);
    expect(autoScrollCounted(0.38, 0)).toBe(0);
  });
});
