import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, PREFS_KEY, clampVolume, parsePrefs, readPrefs, serialisePrefs, volumeGain, writePrefs } from "./prefs";

describe("what the radio remembers", () => {
  it("is off, on rain, with thunder, until the reader says otherwise", () => {
    expect(DEFAULT_PREFS).toEqual({ on: false, scene: "rain", volume: 0.6, thunder: true });
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("")).toEqual(DEFAULT_PREFS);
  });

  it("comes back as it was stored", () => {
    const chosen = { on: true, scene: "cafe", volume: 0.35, thunder: false } as const;
    expect(parsePrefs(serialisePrefs(chosen))).toEqual(chosen);
  });

  it("makes whole what is missing or odd, a part at a time", () => {
    expect(parsePrefs("not json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("null")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("[1,2]")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"scene":"fire"}')).toEqual({ ...DEFAULT_PREFS, scene: "fire" });
    expect(parsePrefs('{"on":true,"scene":"disco","volume":"loud","thunder":1}')).toEqual({ ...DEFAULT_PREFS, on: true });
    // Only a plain `true` turns it on.
    expect(parsePrefs('{"on":"yes"}').on).toBe(false);
    expect(parsePrefs('{"volume":7}').volume).toBe(1);
    expect(parsePrefs('{"volume":-1}').volume).toBe(0);
  });

  it("never hands back the defaults themselves to be changed", () => {
    const parsed = parsePrefs(null);
    parsed.on = true;
    expect(DEFAULT_PREFS.on).toBe(false);
  });

  it("keeps a volume between nothing and full", () => {
    expect(clampVolume(0.4)).toBe(0.4);
    expect(clampVolume(3)).toBe(1);
    expect(clampVolume(-2)).toBe(0);
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_PREFS.volume);
  });

  it("turns the slider into a level the ear finds even", () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(0.5)).toBeCloseTo(0.25, 6);
    // Each step up is louder than the last.
    for (let step = 1; step <= 10; step += 1) {
      expect(volumeGain(step / 10)).toBeGreaterThan(volumeGain((step - 1) / 10));
    }
    expect(volumeGain(9)).toBe(1);
  });
});

describe("where it is kept", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is one key on this device", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value)
    });
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
    writePrefs({ on: true, scene: "waves", volume: 0.8, thunder: true });
    expect(Array.from(data.keys())).toEqual([PREFS_KEY]);
    expect(PREFS_KEY).toBe("leaflet.ambience");
    expect(readPrefs()).toEqual({ on: true, scene: "waves", volume: 0.8, thunder: true });
  });

  it("falls back to the defaults, and does not throw, where nothing can be stored", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      }
    });
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
    expect(() => writePrefs(DEFAULT_PREFS)).not.toThrow();
  });

  it("needs no browser to be asked", () => {
    // Under the tests there is no storage at all.
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
    expect(() => writePrefs(DEFAULT_PREFS)).not.toThrow();
  });
});
