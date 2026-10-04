import { describe, expect, it } from "vitest";
import { fractionAlong, fractionAt, seekByKey, seekTarget } from "./seek";
import { spineIndexForProgress, type SectionWeights } from "./progress";

/** A title page, four chapters (one empty file between them) and notes: the story is sections 1 to 5. */
const bytes = [800, 60_000, 30_000, 0, 90_000, 20_000, 12_000];
const prefix = bytes.reduce<number[]>((sums, size) => [...sums, sums[sums.length - 1] + size], [0]);
const weights: SectionWeights = { bytes, prefix, lo: 1, hi: 5, last: 5 };

describe("going anywhere in the book", () => {
  it("finds the section a fraction falls in, and how far through it", () => {
    expect(seekTarget(weights, 0)).toEqual({ section: 1, within: 0 });
    // The story is 200,000 bytes: 15% is half way through the first chapter.
    expect(seekTarget(weights, 0.15)).toEqual({ section: 1, within: 0.5 });
    // 30% is the very start of the second.
    expect(seekTarget(weights, 0.3)).toEqual({ section: 2, within: 0 });
    const deep = seekTarget(weights, 0.675);
    expect(deep.section).toBe(4);
    expect(deep.within).toBeCloseTo(0.5);
  });

  it("never lands in a file with nothing in it, or past the last line", () => {
    // 45% is exactly where the empty file sits.
    expect(seekTarget(weights, 0.45).section).toBe(4);
    const end = seekTarget(weights, 1);
    expect(end.section).toBe(5);
    expect(end.within).toBeLessThan(1);
    expect(end.within).toBeGreaterThan(0.99);
  });

  it("agrees with where progress says a fraction is", () => {
    for (const fraction of [0.05, 0.29, 0.31, 0.5, 0.89, 0.95]) {
      expect(seekTarget(weights, fraction).section).toBe(spineIndexForProgress(weights, fraction));
    }
  });

  it("goes there and back: the bar shows the place it went to", () => {
    for (const fraction of [0, 0.07, 0.3, 0.52, 0.9]) {
      const { section, within } = seekTarget(weights, fraction);
      expect(fractionAt(weights, section, within)).toBeCloseTo(fraction, 5);
    }
    // Front matter is the start, back matter the end.
    expect(fractionAt(weights, 0, 0.5)).toBe(0);
    expect(fractionAt(weights, 6, 0.2)).toBe(1);
  });

  it("takes nonsense for the start", () => {
    expect(seekTarget(weights, Number.NaN)).toEqual({ section: 1, within: 0 });
    expect(seekTarget(weights, -3)).toEqual({ section: 1, within: 0 });
  });

  it("reads the pointer along the bar", () => {
    expect(fractionAlong(100, 100, 800)).toBe(0);
    expect(fractionAlong(500, 100, 800)).toBe(0.5);
    expect(fractionAlong(2000, 100, 800)).toBe(1);
    expect(fractionAlong(-50, 100, 800)).toBe(0);
    expect(fractionAlong(10, 0, 0)).toBe(0);
  });

  it("steps a hundredth for an arrow, a tenth for a Page key, and to the ends", () => {
    expect(seekByKey("ArrowRight", 0.42)).toBeCloseTo(0.43);
    expect(seekByKey("ArrowLeft", 0.42)).toBeCloseTo(0.41);
    expect(seekByKey("ArrowUp", 0.999)).toBe(1);
    expect(seekByKey("ArrowDown", 0)).toBe(0);
    expect(seekByKey("PageUp", 0.42)).toBeCloseTo(0.52);
    expect(seekByKey("PageDown", 0.05)).toBe(0);
    expect(seekByKey("Home", 0.42)).toBe(0);
    expect(seekByKey("End", 0.42)).toBe(1);
    expect(seekByKey("a", 0.42)).toBeNull();
    // Ten presses are ten percent.
    let at = 0.3;
    for (let press = 0; press < 10; press += 1) {
      at = seekByKey("ArrowRight", at) as number;
    }
    expect(at).toBeCloseTo(0.4, 10);
  });
});
