/**
 * What reading aloud remembers on this device, for every book: the speed,
 * and the voice picked for each language.
 */
import type { SpeechVoice } from "./engine";

export const READ_ALOUD_KEY = "leaflet.readAloud";

/** The speeds offered, slowest first. */
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const MIN_RATE = RATES[0];
export const MAX_RATE = RATES[RATES.length - 1];

export type ReadAloudPrefs = {
  rate: number;
  /** Voice ids by language ("en", "fr"): the main part of the tag only. */
  voices: Record<string, string>;
};

const DEFAULTS: ReadAloudPrefs = { rate: 1, voices: {} };

type Store = Pick<Storage, "getItem" | "setItem">;

const clampRate = (rate: unknown) => {
  const value = typeof rate === "number" && Number.isFinite(rate) ? rate : 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(value * 100) / 100));
};

export const loadPrefs = (store: Store | null | undefined): ReadAloudPrefs => {
  try {
    const raw = store?.getItem(READ_ALOUD_KEY);
    if (!raw) return { ...DEFAULTS, voices: {} };
    const parsed = JSON.parse(raw) as Partial<ReadAloudPrefs>;
    const voices: Record<string, string> = {};
    if (parsed.voices && typeof parsed.voices === "object") {
      for (const [lang, id] of Object.entries(parsed.voices)) {
        if (typeof id === "string" && id) voices[lang] = id;
      }
    }
    return { rate: clampRate(parsed.rate), voices };
  } catch {
    return { ...DEFAULTS, voices: {} };
  }
};

export const savePrefs = (store: Store | null | undefined, prefs: ReadAloudPrefs) => {
  try {
    store?.setItem(READ_ALOUD_KEY, JSON.stringify({ rate: clampRate(prefs.rate), voices: prefs.voices }));
  } catch {
    // Private mode, or full: kept for this session only.
  }
};

/** The main part of a language tag, lower case: "en-GB" and "en_gb" are "en". */
export const baseLanguage = (tag: string | null | undefined) => (tag ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";

/** The voices for a language ("en" matches "en-US"); all of them when the book's language is not known. */
export const voicesFor = (voices: readonly SpeechVoice[], lang: string | null | undefined): SpeechVoice[] => {
  const base = baseLanguage(lang);
  const matching = base ? voices.filter((voice) => baseLanguage(voice.lang) === base) : [...voices];
  // The same region first ("en-GB" for a British book), then the engine's own pick, then by name.
  const region = (lang ?? "").toLowerCase().replace("_", "-");
  return matching.sort(
    (a, b) =>
      Number(b.lang.toLowerCase().replace("_", "-") === region) - Number(a.lang.toLowerCase().replace("_", "-") === region) ||
      Number(Boolean(b.preferred)) - Number(Boolean(a.preferred)) ||
      Number(Boolean(a.online)) - Number(Boolean(b.online)) ||
      a.name.localeCompare(b.name)
  );
};

/** The voice to read a book in: the one picked for its language, if it is still there, or the best match. */
export const pickVoice = (voices: readonly SpeechVoice[], lang: string | null | undefined, prefs: ReadAloudPrefs): SpeechVoice | null => {
  const offered = voicesFor(voices, lang);
  const chosen = prefs.voices[baseLanguage(lang)];
  return offered.find((voice) => voice.id === chosen) ?? offered[0] ?? null;
};

/** The speed after this one, round to the slowest after the fastest. */
export const nextRate = (rate: number) => RATES.find((step) => step > rate + 0.001) ?? RATES[0];

export const rateLabel = (rate: number) => `${Number.isInteger(rate) ? rate.toFixed(0) : String(rate)}×`;
