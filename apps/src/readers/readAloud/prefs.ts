/**
 * What reading aloud remembers on this device, for every book: the speed,
 * and the voice picked for each language.
 */
import type { SpeechVoice } from "./engine";
import { rankVoices, type RankOptions } from "./voiceRank";

export const READ_ALOUD_KEY = "leaflet.readAloud";

/** The speeds offered, slowest first: 0.75x, then 0.8x to 2x a tenth at a time. */
export const RATES: readonly number[] = [0.75, ...Array.from({ length: 13 }, (_, step) => Math.round((0.8 + step * 0.1) * 10) / 10)];
export const MIN_RATE = RATES[0];
export const MAX_RATE = RATES[RATES.length - 1];
/** What the pill's speed button steps through. */
export const QUICK_RATES: readonly number[] = [0.8, 1, 1.2, 1.5, 1.8, 2];

export type ReadAloudPrefs = {
  rate: number;
  /** Voice ids by language ("en", "fr"): the main part of the tag only. */
  voices: Record<string, string>;
};

const DEFAULTS: ReadAloudPrefs = { rate: 1, voices: {} };

type Store = Pick<Storage, "getItem" | "setItem">;

/** A speed made one of those offered: the nearest (1.25x, kept from before, is 1.2x). */
export const snapRate = (rate: unknown) => {
  const value = typeof rate === "number" && Number.isFinite(rate) ? rate : 1;
  let best = RATES[0];
  for (const step of RATES) {
    if (Math.abs(step - value) < Math.abs(best - value) - 1e-9) best = step;
  }
  return best;
};

const clampRate = snapRate;

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

/** The voices for a language ("en" matches "en-US"), the best sounding first; all of them when the book's language is not known. */
export const voicesFor = (voices: readonly SpeechVoice[], lang: string | null | undefined, options: RankOptions = {}): SpeechVoice[] =>
  rankVoices(voices, lang, options);

/** The voice to read a book in: the one picked for its language, if it is still there (and, offline, needs no network), or the best. */
export const pickVoice = (voices: readonly SpeechVoice[], lang: string | null | undefined, prefs: ReadAloudPrefs, options: RankOptions = {}): SpeechVoice | null => {
  const offered = voicesFor(voices, lang, options);
  const chosen = prefs.voices[baseLanguage(lang)];
  return offered.find((voice) => voice.id === chosen && !(options.offline && voice.online)) ?? offered[0] ?? null;
};

/** The pill's next speed, round to the slowest after the fastest. */
export const nextRate = (rate: number) => QUICK_RATES.find((step) => step > rate + 0.001) ?? QUICK_RATES[0];

export const rateLabel = (rate: number) => `${Number.isInteger(rate) ? rate.toFixed(0) : String(Math.round(rate * 100) / 100)}×`;
