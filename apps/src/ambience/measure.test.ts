import { describe, expect, it } from "vitest";
import { balance, correlation, decibels, difference, earOffsetDb, earWeight, flutter, levels, measure, peak, rms, steadiness } from "./measure";
import { seeded } from "./random";

const RATE = 44100;

const sine = (hertz: number, seconds: number, level = 1) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, index) => level * Math.sin((2 * Math.PI * hertz * index) / RATE));

const hiss = (seconds: number, seed: number, level = 1) => {
  const random = seeded(seed);
  return Float32Array.from({ length: Math.round(seconds * RATE) }, () => level * (random() * 2 - 1));
};

describe("measuring a sound", () => {
  it("knows how loud a sine is, and its peak", () => {
    const tone = sine(440, 1, 0.5);
    expect(rms(tone)).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(peak(tone)).toBeCloseTo(0.5, 3);
    expect(decibels(0.5)).toBeCloseTo(-6.02, 1);
    expect(decibels(0)).toBe(-Infinity);
  });

  it("tells the same channel twice from two channels", () => {
    const left = hiss(0.5, 1);
    expect(correlation(left, left)).toBeCloseTo(1, 6);
    expect(Math.abs(correlation(left, hiss(0.5, 2)))).toBeLessThan(0.05);
    expect(correlation(left, left.map((sample) => -sample))).toBeCloseTo(-1, 6);
  });

  it("tells the same render from another", () => {
    const first = hiss(0.5, 3);
    expect(difference(first, first)).toBe(0);
    // Two unrelated noises of one level are root two apart.
    expect(difference(first, hiss(0.5, 4))).toBeCloseTo(Math.SQRT2, 1);
  });

  it("finds where a tone's energy is", () => {
    expect(balance(sine(100, 1), RATE).shares.low).toBeGreaterThan(0.99);
    expect(balance(sine(500, 1), RATE).shares.lowMid).toBeGreaterThan(0.99);
    expect(balance(sine(2000, 1), RATE).shares.mid).toBeGreaterThan(0.99);
    expect(balance(sine(5000, 1), RATE).shares.high).toBeGreaterThan(0.99);
    expect(balance(sine(12000, 1), RATE).shares.air).toBeGreaterThan(0.99);
    expect(balance(sine(2000, 1), RATE).centre).toBeGreaterThan(1950);
    expect(balance(sine(2000, 1), RATE).centre).toBeLessThan(2050);
  });

  it("spreads hiss across the spectrum by width of band", () => {
    const { shares, centre } = balance(hiss(2, 5), RATE);
    // White noise: energy in proportion to each band's width in hertz.
    expect(shares.air).toBeGreaterThan(shares.high);
    expect(shares.high).toBeGreaterThan(shares.mid);
    expect(shares.mid).toBeGreaterThan(shares.lowMid);
    expect(shares.low).toBeLessThan(0.02);
    expect(centre).toBeGreaterThan(10000);
    expect(centre).toBeLessThan(12000);
  });

  it("weighs frequencies as an ear does", () => {
    expect(10 * Math.log10(earWeight(1000))).toBeCloseTo(0, 1);
    expect(10 * Math.log10(earWeight(100))).toBeCloseTo(-19.1, 0);
    expect(10 * Math.log10(earWeight(50))).toBeCloseTo(-30.2, 0);
    expect(earOffsetDb(sine(1000, 1), RATE)).toBeCloseTo(0, 0);
    expect(earOffsetDb(sine(100, 1), RATE)).toBeLessThan(-17);
  });

  it("sees a hole in a level, and a jump", () => {
    const steady = hiss(3, 6, 0.3);
    const held = steadiness(levels(steady, RATE));
    expect(held.quietestDb).toBeGreaterThan(-1);
    expect(held.loudestDb).toBeLessThan(1);
    expect(held.biggestStepDb).toBeLessThan(1);

    const holed = hiss(3, 6, 0.3);
    holed.fill(0, RATE, RATE + RATE / 2);
    expect(steadiness(levels(holed, RATE)).quietestDb).toBe(-Infinity);

    const stepped = hiss(3, 6, 0.3);
    for (let index = RATE; index < stepped.length; index += 1) {
      stepped[index] *= 3;
    }
    expect(steadiness(levels(stepped, RATE)).biggestStepDb).toBeGreaterThan(8);
  });

  it("tells static from something that comes and goes like talk", () => {
    const still = hiss(4, 7, 0.3);
    // The same hiss, rising and falling four times a second.
    const spoken = still.map((sample, index) => sample * (0.55 + 0.45 * Math.sin((2 * Math.PI * 4 * index) / RATE)));
    expect(flutter(still, RATE, 300, 3000)).toBeLessThan(0.12);
    expect(flutter(spoken, RATE, 300, 3000)).toBeGreaterThan(0.4);
  });

  it("puts it all in one report", () => {
    const report = measure(hiss(2, 8, 0.2), hiss(2, 9, 0.2), RATE);
    expect(report.seconds).toBeCloseTo(2, 3);
    expect(report.rmsDb).toBeCloseTo(decibels(0.2 / Math.sqrt(3)), 0);
    expect(report.peak).toBeLessThanOrEqual(0.2);
    expect(Math.abs(report.correlation)).toBeLessThan(0.05);
    expect(Object.values(report.shares).reduce((sum, share) => sum + share, 0)).toBeGreaterThan(0.95);
    expect(report.steadiness.biggestStepDb).toBeLessThan(1);
    // Hiss is mostly where the ear is not at its keenest, but far from deaf.
    expect(report.heardDb).toBeLessThan(report.rmsDb + 1);
    expect(report.heardDb).toBeGreaterThan(report.rmsDb - 6);
  });
});
