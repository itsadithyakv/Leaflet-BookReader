/**
 * Which voice sounds best for a book, of those the device has: the one
 * Leaflet reads in until the reader picks another, and the order the voice
 * list is in.
 *
 * In order: a voice that is on the device (its data downloaded); offline,
 * one that needs no network; not a studio voice that is slow here (it
 * prepares a chapter first: picked only by hand); one of Leaflet's own studio voices (downloaded in Settings; on
 * Android the phone's own voice comes first, `studioFirst: false`); on Android,
 * one that needs no network; the best sounding (Android says, from very low
 * to very high; on Windows a "Natural" or "Neural" voice is far ahead, then
 * the newer OneCore voices, then the old desktop ones); not Android's
 * stand-in for a language ("legacy"); the book's own region ("en-GB" for a
 * British book), else the reader's; quick to start; the engine's own pick.
 */
import type { SpeechVoice } from "./engine";

export type RankOptions = {
  /** Prefer a voice that needs no network, even over a better one that does (Android). */
  preferOffline?: boolean;
  /** The device is offline (`navigator.onLine` false): a voice that needs the network cannot speak, and goes last. */
  offline?: boolean;
  /** The reader's own languages, best first (`navigator.languages`): the region to prefer when the book does not say. */
  userLangs?: readonly string[];
  /** Leaflet's own studio voices before the device's (default); false: after them (Android, where the phone's voice is the one recommended). */
  studioFirst?: boolean;
};

const tagOf = (lang: string | null | undefined) => (lang ?? "").trim().toLowerCase().replace(/_/g, "-");
const baseOf = (lang: string | null | undefined) => tagOf(lang).split("-")[0] ?? "";
const regionOf = (lang: string | null | undefined) => {
  // "en-GB", "zh-Hant-TW", "es-419": the region is the part of two letters or three digits.
  const parts = tagOf(lang).split("-").slice(1);
  return parts.find((part) => /^[a-z]{2}$|^\d{3}$/.test(part)) ?? "";
};

/**
 * How good a voice of the browser's sounds, from its name, on Android's
 * scale: Windows names its natural voices "… Online (Natural)" or "…
 * Natural", its old SAPI ones "… Desktop", and the OneCore ones neither.
 */
export const webVoiceQuality = (name: string, online: boolean) => {
  if (/\b(natural|neural)\b/i.test(name)) return 500;
  if (/\bdesktop\b/i.test(name)) return 200;
  if (online) return 400;
  return 300;
};

/** 0 to 5: how good it sounds (unknown counts as normal). */
const qualityTier = (voice: SpeechVoice) => Math.round((voice.quality ?? 300) / 100);

/** 2: the book's own region; 1: the reader's; 0: neither. */
const regionScore = (voice: SpeechVoice, bookLang: string | null | undefined, userLangs: readonly string[]) => {
  const region = regionOf(voice.lang);
  if (!region) return 0;
  if (region === regionOf(bookLang)) return 2;
  const base = baseOf(voice.lang);
  return userLangs.some((lang) => baseOf(lang) === base && regionOf(lang) === region) ? 1 : 0;
};

/** The voices for a book in this language, best first ("en" matches "en-US"; all, when the book does not say). */
export const rankVoices = (voices: readonly SpeechVoice[], bookLang: string | null | undefined, options: RankOptions = {}): SpeechVoice[] => {
  const userLangs = options.userLangs ?? [];
  const base = baseOf(bookLang);
  const matching = base ? voices.filter((voice) => baseOf(voice.lang) === base) : [...voices];
  // A book that does not say its language: the reader's own languages first.
  const userBase = baseOf(userLangs[0]);
  const keyOf = (voice: SpeechVoice) => [
    voice.installed === false ? 0 : 1,
    // Offline, a voice that needs the network says nothing (each item fails).
    options.offline && voice.online ? 0 : 1,
    // A studio voice this device makes too slowly to read live, or not yet tried here: never the one picked by itself.
    voice.studio && (voice.slow || voice.untested) ? 0 : 1,
    // Leaflet's own downloaded voices before the device's (after them on Android).
    voice.studio ? (options.studioFirst === false ? 0 : 1) : options.studioFirst === false ? 1 : 0,
    !base && userBase && baseOf(voice.lang) === userBase ? 1 : 0,
    options.preferOffline && !voice.online ? 1 : 0,
    voice.legacy ? 0 : 1,
    qualityTier(voice),
    regionScore(voice, bookLang, userLangs),
    options.preferOffline ? 0 : voice.online ? 0 : 1,
    // Quick to start: low latency first.
    -(voice.latency ?? 300),
    voice.preferred ? 1 : 0
  ];
  const keys = new Map(matching.map((voice) => [voice, keyOf(voice)]));
  return matching.sort((a, b) => {
    const ka = keys.get(a) ?? [];
    const kb = keys.get(b) ?? [];
    for (let index = 0; index < ka.length; index += 1) {
      if (ka[index] !== kb[index]) return kb[index] - ka[index];
    }
    return a.name.localeCompare(b.name);
  });
};

/** The best of them, or null when there is none for the language. */
export const bestVoice = (voices: readonly SpeechVoice[], bookLang: string | null | undefined, options: RankOptions = {}) =>
  rankVoices(voices, bookLang, options)[0] ?? null;
