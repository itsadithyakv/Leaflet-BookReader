import { describe, expect, it } from "vitest";
import { planScrollStep, readingBand, stepDuration, type ReadingArea } from "./smartScroll";

// 18px type at 1.8 line height.
const LINE = 32.4;

const screens: Record<string, ReadingArea> = {
  "small laptop": { height: 640, lineHeight: LINE, topInset: 12, bottomInset: 112 },
  "big monitor": { height: 1300, lineHeight: LINE, topInset: 12, bottomInset: 112 },
  "portrait monitor": { height: 1840, lineHeight: LINE, topInset: 12, bottomInset: 112 },
  "landscape phone": { height: 330, lineHeight: 28.8, topInset: 56, bottomInset: 96 },
  "large type": { height: 700, lineHeight: 57.6, topInset: 76, bottomInset: 112 }
};

describe("Smart Read's page steps", () => {
  it.each(Object.entries(screens))("turns a real page at a time on a %s", (_name, area) => {
    const band = readingBand(area);
    const usable = area.height - area.topInset - area.bottomInset;
    // Dotty's line lands near the top of what is visible, and is never hidden.
    expect(band.top).toBeGreaterThanOrEqual(area.topInset);
    expect(band.top - area.topInset).toBeLessThanOrEqual(Math.max(area.lineHeight * 1.5, usable * 0.08) + 0.01);
    // It reads to near the bottom before the page moves.
    expect(band.turn).toBeLessThanOrEqual(area.height - area.bottomInset);
    expect(band.turn).toBeGreaterThan(band.top);
    // A step moves most of a screen: the old rule moved a quarter.
    const step = planScrollStep(band.turn + 1, band.turn + 1 + area.lineHeight, area);
    expect(step).not.toBeNull();
    expect(step!).toBeGreaterThan(Math.max(area.lineHeight * 2, area.height * 0.26));
  });

  it("moves several lines at a time even with little room", () => {
    const area = screens["landscape phone"];
    const band = readingBand(area);
    expect((band.turn - band.top) / area.lineHeight).toBeGreaterThanOrEqual(3);
  });

  it("stays put while Dotty is inside the reading area", () => {
    const area = screens["small laptop"];
    const band = readingBand(area);
    expect(planScrollStep(band.top + 40, band.top + 40 + LINE, area)).toBeNull();
    expect(planScrollStep(band.turn - LINE - 1, band.turn - 1, area)).toBeNull();
  });

  it("brings Dotty back down when its line has gone above the page", () => {
    const area = screens["big monitor"];
    const step = planScrollStep(-200, -200 + LINE, area);
    expect(step).toBeLessThan(0);
    expect(-200 - step!).toBeCloseTo(readingBand(area).top, 5);
  });

  it("scrolls long distances gently, and not at all for reduced motion", () => {
    expect(stepDuration(40, false)).toBe(320);
    expect(stepDuration(3000, false)).toBe(720);
    expect(stepDuration(900, true)).toBe(0);
  });
});
