import { describe, expect, it } from "vitest";
import { autoScrollLinesPerMinute, autoScrollPixelsPerSecond, autoScrollSpeedForLines } from "./autoScroll";
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
