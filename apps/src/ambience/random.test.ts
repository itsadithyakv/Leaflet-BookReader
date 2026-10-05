import { describe, expect, it } from "vitest";
import { between, betweenRatio, forkSeed, mostlyLow, seeded, waitFor, wholeBetween } from "./random";

const draw = (seed: number, count: number) => {
  const random = seeded(seed);
  return Array.from({ length: count }, () => random());
};

describe("chance from a seed", () => {
  it("gives the same run for the same seed, and another for another", () => {
    expect(draw(7, 20)).toEqual(draw(7, 20));
    expect(draw(7, 20)).not.toEqual(draw(8, 20));
  });

  it("stays from 0 up to 1 and is spread evenly", () => {
    const values = draw(1, 20000);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
    // Each tenth gets about a tenth.
    for (let tenth = 0; tenth < 10; tenth += 1) {
      const share = values.filter((value) => Math.floor(value * 10) === tenth).length / values.length;
      expect(share).toBeGreaterThan(0.085);
      expect(share).toBeLessThan(0.115);
    }
  });

  it("gives each part of a scene its own seed", () => {
    const seeds = Array.from({ length: 30 }, (_, part) => forkSeed(42, part));
    expect(new Set(seeds).size).toBe(30);
    expect(forkSeed(42, 3)).toBe(forkSeed(42, 3));
    expect(forkSeed(42, 3)).not.toBe(forkSeed(43, 3));
  });
});

describe("the shapes of chance", () => {
  it("keeps every draw inside its span", () => {
    const random = seeded(3);
    for (let index = 0; index < 2000; index += 1) {
      const even = between(random, [2, 5]);
      const ratio = betweenRatio(random, [200, 3200]);
      const low = mostlyLow(random, [0.1, 0.9], 3);
      const whole = wholeBetween(random, [1, 4]);
      expect(even).toBeGreaterThanOrEqual(2);
      expect(even).toBeLessThanOrEqual(5);
      expect(ratio).toBeGreaterThanOrEqual(200);
      expect(ratio).toBeLessThanOrEqual(3200);
      expect(low).toBeGreaterThanOrEqual(0.1);
      expect(low).toBeLessThanOrEqual(0.9);
      expect([1, 2, 3, 4]).toContain(whole);
    }
  });

  it("picks by ratio: as many below the middle octave as above", () => {
    const random = seeded(5);
    const values = Array.from({ length: 4000 }, () => betweenRatio(random, [200, 3200]));
    // 800 is two octaves from each end.
    const below = values.filter((value) => value < 800).length / values.length;
    expect(below).toBeGreaterThan(0.46);
    expect(below).toBeLessThan(0.54);
  });

  it("leaves few near the top when asked for mostly low", () => {
    const random = seeded(9);
    const values = Array.from({ length: 4000 }, () => mostlyLow(random, [0, 1], 3));
    expect(values.filter((value) => value > 0.5).length / values.length).toBeLessThan(0.25);
  });

  it("reaches both ends of a span of whole numbers", () => {
    const random = seeded(11);
    const values = new Set(Array.from({ length: 400 }, () => wholeBetween(random, [1, 4])));
    expect(Array.from(values).sort()).toEqual([1, 2, 3, 4]);
  });

  it("waits, on average, as long as the rate says", () => {
    const random = seeded(13);
    const waits = Array.from({ length: 8000 }, () => waitFor(random, 4));
    const mean = waits.reduce((sum, wait) => sum + wait, 0) / waits.length;
    expect(mean).toBeGreaterThan(0.24);
    expect(mean).toBeLessThan(0.26);
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(0);
  });
});
