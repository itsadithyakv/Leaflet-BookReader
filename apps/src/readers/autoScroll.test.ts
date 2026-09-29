import { describe, expect, it } from "vitest";
import { autoScrollLinesPerMinute, autoScrollSpeedForLines } from "./autoScroll";

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

  it("slows the page for a wide line: the same pace is fewer lines", () => {
    // 240 words a minute, at 12 words a line and at 30.
    expect(autoScrollSpeedForLines(240 / 12)).toBeGreaterThan(autoScrollSpeedForLines(240 / 30));
  });
});
