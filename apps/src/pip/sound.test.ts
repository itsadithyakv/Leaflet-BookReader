import { describe, expect, it } from "vitest";
import { playSound, setSoundOn, soundOn, spaced } from "./sound";

describe("Pip's sounds", () => {
  it("are off unless the reader turns them on", () => {
    expect(soundOn()).toBe(false);
    setSoundOn(true);
    expect(soundOn()).toBe(true);
    setSoundOn(false);
    expect(soundOn()).toBe(false);
  });

  it("make nothing while off, and never throw without audio", () => {
    expect(() => playSound("chime")).not.toThrow();
    setSoundOn(true);
    // No window, no AudioContext: still nothing thrown.
    expect(() => playSound("coin", { pitch: 1.2, volume: 0.5 })).not.toThrow();
    setSoundOn(false);
  });

  it("space out the same sound, so a shower of seeds is a patter", () => {
    expect(spaced("coin", 1000, undefined)).toBe(true);
    expect(spaced("coin", 1020, 1000)).toBe(false);
    expect(spaced("coin", 1060, 1000)).toBe(true);
    expect(spaced("chime", 1100, 1000)).toBe(false);
  });
});
