/** A Studio voice status for the tests: installed, live, on Windows. */
import type { StudioVoiceStatus } from "./studioVoice";

export const studioStatus = (change: Partial<StudioVoiceStatus> = {}): StudioVoiceStatus => ({
  pack: "kokoro-v1",
  installed: true,
  downloading: false,
  downloadBytes: 349_906_910,
  installedBytes: 367_000_000,
  partialBytes: 0,
  dir: "C:/x/voices/kokoro-v1",
  variant: "fp32",
  voices: [
    { id: "neural:af_heart", name: "Heart", sid: 3, lang: "en-US" },
    { id: "neural:bf_emma", name: "Emma", sid: 21, lang: "en-GB" },
    { id: "neural:am_michael", name: "Michael", sid: 16, lang: "en-US" }
  ],
  defaultVoice: "neural:af_heart",
  selfTest: { rtf: 0.45, threads: 4, platform: "windows", at: "2026-10-20T00:00:00Z" },
  slow: false,
  mode: "live",
  canSpeak: true,
  ...change
});
