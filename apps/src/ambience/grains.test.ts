import { describe, expect, it } from "vitest";
import { GRAIN_SECONDS, NOISE_RMS, noiseLoop, noisePair, renderGrain, renderRoom } from "./grains";
import { balance, correlation, peak, rms } from "./measure";
import { seeded } from "./random";
import type { GrainKind, NoiseColour } from "./scenes";

const RATE = 44100;
const COLOURS: NoiseColour[] = ["white", "pink", "brown"];
const KINDS: GrainKind[] = ["drop", "crackle", "pop", "clink"];

describe("the loops of noise", () => {
  it("are all as loud as each other, and centred on zero", () => {
    for (const colour of COLOURS) {
      const loop = noiseLoop(colour, 2, RATE, seeded(1));
      expect(loop.length).toBe(2 * RATE);
      expect(rms(loop)).toBeCloseTo(NOISE_RMS, 3);
      const mean = loop.reduce((sum, value) => sum + value, 0) / loop.length;
      expect(Math.abs(mean)).toBeLessThan(1e-4);
    }
  });

  it("differ in colour: white is bright, pink is even by octave, brown is low", () => {
    const centre = (colour: NoiseColour) => balance(noiseLoop(colour, 3, RATE, seeded(2)), RATE).centre;
    const share = (colour: NoiseColour) => balance(noiseLoop(colour, 3, RATE, seeded(2)), RATE).shares;
    expect(centre("white")).toBeGreaterThan(9000);
    expect(centre("pink")).toBeGreaterThan(1500);
    expect(centre("pink")).toBeLessThan(centre("white") / 2);
    expect(centre("brown")).toBeLessThan(800);
    expect(centre("brown")).toBeLessThan(centre("pink") / 2);
    expect(share("brown").low).toBeGreaterThan(0.4);
    expect(share("white").low).toBeLessThan(0.02);
  });

  it("run from their end into their start without a step", () => {
    for (const colour of COLOURS) {
      const loop = noiseLoop(colour, 2, RATE, seeded(3));
      // The step across the join is no bigger than the steps anywhere else.
      let biggest = 0;
      for (let index = 1; index < loop.length; index += 1) {
        biggest = Math.max(biggest, Math.abs(loop[index] - loop[index - 1]));
      }
      expect(Math.abs(loop[0] - loop[loop.length - 1])).toBeLessThanOrEqual(biggest);
    }
    // Brown noise is where a bad join would show: it moves slowly, so a jump stands out.
    const brown = noiseLoop("brown", 2, RATE, seeded(4));
    let typical = 0;
    for (let index = 1; index < brown.length; index += 1) {
      typical += Math.abs(brown[index] - brown[index - 1]);
    }
    typical /= brown.length - 1;
    expect(Math.abs(brown[0] - brown[brown.length - 1])).toBeLessThan(typical * 6);
  });

  it("give each ear its own noise", () => {
    for (const colour of COLOURS) {
      const [left, right] = noisePair(colour, 8000, seeded(5));
      expect(left.length).toBe(right.length);
      expect(Math.abs(correlation(left, right))).toBeLessThan(0.1);
    }
  });

  it("are the same for the same seed and different for another", () => {
    expect(Array.from(noiseLoop("pink", 0.5, 8000, seeded(6)))).toEqual(Array.from(noiseLoop("pink", 0.5, 8000, seeded(6))));
    expect(Array.from(noiseLoop("pink", 0.5, 8000, seeded(6)))).not.toEqual(Array.from(noiseLoop("pink", 0.5, 8000, seeded(7))));
  });
});

describe("the short sounds", () => {
  it("reach full scale, never past it, and are as long as they say", () => {
    for (const kind of KINDS) {
      const random = seeded(8);
      for (let make = 0; make < 12; make += 1) {
        const grain = renderGrain(kind, RATE, random);
        expect(grain.length).toBe(Math.round(GRAIN_SECONDS[kind] * RATE));
        expect(peak(grain)).toBeCloseTo(1, 5);
        expect(grain.every((sample) => Number.isFinite(sample))).toBe(true);
      }
    }
  });

  it("start and end in silence, so playing one never clicks at its edges", () => {
    for (const kind of KINDS) {
      const random = seeded(9);
      for (let make = 0; make < 12; make += 1) {
        const grain = renderGrain(kind, RATE, random);
        expect(grain[0]).toBe(0);
        expect(Math.abs(grain[grain.length - 1])).toBeLessThan(0.001);
        // The last two milliseconds are well down on the first ten.
        const tail = rms(grain.subarray(grain.length - Math.round(0.002 * RATE)));
        const head = rms(grain.subarray(0, Math.round(0.01 * RATE)));
        expect(tail).toBeLessThan(head * 0.2);
      }
    }
  });

  it("are over quickly: most of a crackle is in its first few milliseconds, a cup rings on", () => {
    const early = (kind: GrainKind, seconds: number) => {
      const grain = renderGrain(kind, RATE, seeded(10));
      const cut = Math.round(seconds * RATE);
      return rms(grain.subarray(0, cut)) ** 2 * cut / (rms(grain) ** 2 * grain.length);
    };
    expect(early("crackle", 0.02)).toBeGreaterThan(0.9);
    expect(early("clink", 0.02)).toBeLessThan(0.75);
  });

  it("sit where they should: a pop is low, a clink is high", () => {
    const centre = (kind: GrainKind) => {
      const random = seeded(11);
      const centres = Array.from({ length: 8 }, () => {
        // The measure wants a longer stretch than a grain: the grain, then silence.
        const padded = new Float32Array(8192);
        padded.set(renderGrain(kind, RATE, random).subarray(0, 8192));
        return balance(padded, RATE).centre;
      });
      return centres.reduce((sum, value) => sum + value, 0) / centres.length;
    };
    expect(centre("pop")).toBeLessThan(1500);
    expect(centre("clink")).toBeGreaterThan(2500);
    expect(centre("crackle")).toBeGreaterThan(centre("pop"));
  });

  it("are never made the same twice from one source, and always the same from one seed", () => {
    for (const kind of KINDS) {
      const random = seeded(12);
      const first = Array.from(renderGrain(kind, 16000, random));
      const second = Array.from(renderGrain(kind, 16000, random));
      expect(first).not.toEqual(second);
      expect(Array.from(renderGrain(kind, 16000, seeded(12)))).toEqual(first);
    }
  });
});

describe("the room's echo", () => {
  it("gives back about what it is sent, dying away to nothing", () => {
    const echo = renderRoom(0.9, RATE, seeded(13));
    expect(echo.length).toBe(Math.round(0.9 * RATE));
    const energy = echo.reduce((sum, value) => sum + value * value, 0);
    expect(energy).toBeCloseTo(1, 4);
    const first = rms(echo.subarray(0, echo.length >> 2));
    const last = rms(echo.subarray(echo.length - (echo.length >> 2)));
    expect(last).toBeLessThan(first * 0.05);
  });

  it("is different for each ear", () => {
    const random = seeded(14);
    expect(Math.abs(correlation(renderRoom(0.5, 16000, random), renderRoom(0.5, 16000, random)))).toBeLessThan(0.2);
  });
});
