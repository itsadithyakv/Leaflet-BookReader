import { describe, expect, it } from "vitest";
import { baseLanguage, loadPrefs, nextRate, pickVoice, rateLabel, READ_ALOUD_KEY, savePrefs, voicesFor } from "./prefs";
import type { SpeechVoice } from "./engine";

const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values
  };
};

const VOICES: SpeechVoice[] = [
  { id: "us-1", name: "Zira", lang: "en-US", preferred: true },
  { id: "gb-1", name: "Hazel", lang: "en-GB" },
  { id: "us-net", name: "Aria Online", lang: "en-US", online: true },
  { id: "fr-1", name: "Hortense", lang: "fr-FR" }
];

describe("read-aloud prefs", () => {
  it("keeps the speed and the voice for each language, across books", () => {
    const store = memory();
    expect(loadPrefs(store)).toEqual({ rate: 1, voices: {} });
    savePrefs(store, { rate: 1.5, voices: { en: "gb-1" } });
    expect(loadPrefs(store)).toEqual({ rate: 1.5, voices: { en: "gb-1" } });
  });

  it("keeps a stored speed within 0.75x to 2x, and survives a broken or missing store", () => {
    const store = memory();
    store.setItem(READ_ALOUD_KEY, JSON.stringify({ rate: 9, voices: { en: 4, fr: "fr-1" } }));
    expect(loadPrefs(store)).toEqual({ rate: 2, voices: { fr: "fr-1" } });
    store.setItem(READ_ALOUD_KEY, "{not json");
    expect(loadPrefs(store)).toEqual({ rate: 1, voices: {} });
    expect(loadPrefs(null)).toEqual({ rate: 1, voices: {} });
    expect(() => savePrefs({ getItem: () => null, setItem: () => { throw new Error("full"); } }, { rate: 1, voices: {} })).not.toThrow();
  });

  it("steps the speed round from 0.75x to 2x", () => {
    expect(nextRate(1)).toBe(1.25);
    expect(nextRate(1.75)).toBe(2);
    expect(nextRate(2)).toBe(0.75);
    expect(rateLabel(1)).toBe("1×");
    expect(rateLabel(1.25)).toBe("1.25×");
  });

  it("offers the voices for the book's language, its own region and the engine's pick first", () => {
    expect(baseLanguage("en_GB")).toBe("en");
    expect(voicesFor(VOICES, "en-GB").map((voice) => voice.id)).toEqual(["gb-1", "us-1", "us-net"]);
    expect(voicesFor(VOICES, "en").map((voice) => voice.id)).toEqual(["us-1", "gb-1", "us-net"]);
    expect(voicesFor(VOICES, "de")).toEqual([]);
    // A book that does not say its language: every voice.
    expect(voicesFor(VOICES, null).length).toBe(4);
  });

  it("picks the voice chosen for the language while it is there, the best match otherwise", () => {
    expect(pickVoice(VOICES, "en-US", { rate: 1, voices: { en: "gb-1" } })?.id).toBe("gb-1");
    expect(pickVoice(VOICES, "en-US", { rate: 1, voices: { en: "gone" } })?.id).toBe("us-1");
    expect(pickVoice(VOICES, "fr", { rate: 1, voices: {} })?.id).toBe("fr-1");
    expect(pickVoice(VOICES, "ja", { rate: 1, voices: {} })).toBeNull();
  });
});
