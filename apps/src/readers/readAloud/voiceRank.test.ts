import { describe, expect, it } from "vitest";
import { bestVoice, rankVoices, webVoiceQuality } from "./voiceRank";
import type { SpeechVoice } from "./engine";

const ids = (voices: SpeechVoice[]) => voices.map((voice) => voice.id);

/** Voices as Google's speech on Android lists them (quality and latency on Android's scale). */
const ANDROID: SpeechVoice[] = [
  { id: "en-US-language", name: "English (United States) 1", lang: "en-US", legacy: true, quality: 300, latency: 300, preferred: true },
  { id: "en-us-x-sfg-network", name: "English (United States) 2", lang: "en-US", online: true, quality: 500, latency: 400 },
  { id: "en-us-x-sfg-local", name: "English (United States) 3", lang: "en-US", quality: 400, latency: 300 },
  { id: "en-us-x-iom-local", name: "English (United States) 4", lang: "en-US", quality: 400, latency: 200 },
  { id: "en-gb-x-gba-local", name: "English (United Kingdom) 1", lang: "en-GB", quality: 400, latency: 300 },
  { id: "en-in-x-low", name: "English (India) 1", lang: "en-IN", quality: 200, latency: 300 },
  { id: "en-au-x-gone", name: "English (Australia) 1", lang: "en-AU", quality: 500, installed: false }
];

describe("ranking voices", () => {
  it("on Android: installed, offline, the best sounding, not a legacy stand-in, then quick to start", () => {
    const ranked = rankVoices(ANDROID, "en-US", { preferOffline: true });
    expect(ids(ranked)).toEqual([
      "en-us-x-iom-local",
      "en-us-x-sfg-local",
      "en-gb-x-gba-local",
      "en-in-x-low",
      "en-US-language",
      "en-us-x-sfg-network",
      "en-au-x-gone"
    ]);
    // The system's own pick (often the legacy voice) is not the best.
    expect(bestVoice(ANDROID, "en-US", { preferOffline: true })?.id).toBe("en-us-x-iom-local");
  });

  it("prefers the book's own region, else the reader's, among voices as good", () => {
    expect(bestVoice(ANDROID, "en-GB", { preferOffline: true })?.id).toBe("en-gb-x-gba-local");
    const even: SpeechVoice[] = [
      { id: "us", name: "US", lang: "en-US", quality: 400 },
      { id: "in", name: "IN", lang: "en-IN", quality: 400 },
      { id: "gb", name: "GB", lang: "en-GB", quality: 400 }
    ];
    expect(bestVoice(even, "en", { preferOffline: true, userLangs: ["en-IN", "hi"] })?.id).toBe("in");
    expect(bestVoice(even, "en-GB", { preferOffline: true, userLangs: ["en-IN"] })?.id).toBe("gb");
  });

  it("on Windows: a natural voice first (even online), then OneCore over the old desktop voices", () => {
    const web = (name: string, online = false, preferred = false): SpeechVoice => ({
      id: name,
      name,
      lang: "en-US",
      online,
      preferred,
      quality: webVoiceQuality(name, online)
    });
    const voices = [
      web("Microsoft David Desktop - English (United States)", false, true),
      web("Microsoft Zira - English (United States)"),
      web("Microsoft David - English (United States)", false, true),
      web("Microsoft Aria Online (Natural) - English (United States)", true),
      web("Google US English", true)
    ];
    expect(ids(rankVoices(voices, "en-US"))).toEqual([
      "Microsoft Aria Online (Natural) - English (United States)",
      "Google US English",
      "Microsoft David - English (United States)",
      "Microsoft Zira - English (United States)",
      "Microsoft David Desktop - English (United States)"
    ]);
    // The owner's laptop as it is: David, Mark, Zira (OneCore), David the default.
    const today = [web("Microsoft David - English (United States)", false, true), web("Microsoft Mark - English (United States)"), web("Microsoft Zira - English (United States)")];
    expect(bestVoice(today, "en")?.name).toBe("Microsoft David - English (United States)");
  });

  it("offline, never picks a voice that needs the network (it would say nothing)", () => {
    const voices: SpeechVoice[] = [
      { id: "aria", name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US", online: true, quality: webVoiceQuality("Aria Online (Natural)", true) },
      { id: "zira", name: "Microsoft Zira - English (United States)", lang: "en-US", quality: webVoiceQuality("Zira", false) }
    ];
    expect(bestVoice(voices, "en-US")?.id).toBe("aria");
    expect(bestVoice(voices, "en-US", { offline: true })?.id).toBe("zira");
    expect(ids(rankVoices(voices, "en-US", { offline: true }))).toEqual(["zira", "aria"]);
  });

  it("puts Leaflet's own downloaded voices first", () => {
    const voices: SpeechVoice[] = [...ANDROID, { id: "neural:af_heart", name: "Heart", lang: "en-US", quality: 500, studio: true }];
    expect(bestVoice(voices, "en-US", { preferOffline: true })?.id).toBe("neural:af_heart");
  });

  it("on Android keeps the phone's own voice first, the studio voices after it (picked by hand)", () => {
    const voices: SpeechVoice[] = [...ANDROID, { id: "neural:af_heart", name: "Heart", lang: "en-US", quality: 500, studio: true }];
    const ranked = rankVoices(voices, "en-US", { preferOffline: true, studioFirst: false });
    expect(ranked[0].id).toBe("en-us-x-iom-local");
    expect(ids(ranked).indexOf("neural:af_heart")).toBe(ranked.length - 2);
  });

  it("never picks by itself a studio voice not yet tried here (no self-test passed)", () => {
    const voices: SpeechVoice[] = [
      { id: "zira", name: "Zira", lang: "en-US", quality: 300 },
      { id: "neural:af_heart", name: "Heart", lang: "en-US", quality: 500, studio: true, untested: true }
    ];
    expect(bestVoice(voices, "en-US")?.id).toBe("zira");
    expect(bestVoice([{ ...voices[1], untested: false }, voices[0]], "en-US")?.id).toBe("neural:af_heart");
  });

  it("never picks by itself a studio voice that is slow here", () => {
    const voices: SpeechVoice[] = [
      { id: "zira", name: "Zira", lang: "en-US", quality: 300 },
      { id: "neural:af_heart", name: "Heart", lang: "en-US", quality: 500, studio: true, slow: true },
      { id: "neural:bf_emma", name: "Emma", lang: "en-GB", quality: 500, studio: true }
    ];
    expect(ids(rankVoices(voices, "en"))).toEqual(["neural:bf_emma", "zira", "neural:af_heart"]);
  });

  it("keeps to the book's language, or the reader's when the book does not say", () => {
    const voices: SpeechVoice[] = [
      { id: "fr", name: "Amélie", lang: "fr-FR" },
      { id: "en", name: "Zira", lang: "en-US" }
    ];
    expect(ids(rankVoices(voices, "fr"))).toEqual(["fr"]);
    expect(ids(rankVoices(voices, null, { userLangs: ["en-GB"] }))).toEqual(["en", "fr"]);
    expect(rankVoices(voices, "de")).toEqual([]);
  });
});
