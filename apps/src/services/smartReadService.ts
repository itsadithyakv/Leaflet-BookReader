import type { LegacySmartReadProfile, TimeBand } from "../readers/paceModel";

/**
 * Word-level help for Smart Read and SpeedRead, and what is left of the old
 * Smart Read profile. That profile lived in this device's local storage only
 * and learned from Smart Read alone; the pace model (readers/paceModel.ts)
 * replaces it, learns from all reading and travels with sync. The old one is
 * read once, to bring its learning over.
 */

export type ReadingTimeBand = TimeBand;

const STORAGE_PREFIX = "leaflet.smart-read.";
const LEGACY_PREFIX = "leaflet.smart-read.v1";
const COMMON_RSVP_WORDS = new Set(
  `
  a about after again against all also am an and any are as at back be because been before being
  between both but by can could day did do does down each even every few first for from get give go
  good had has have he her here him his how i if in into is it its just know like little long look
  made make many may me more most much must my new no not now of off on one only or other our out
  over people read right said same see she should so some still such take than that the their them
  then there these they thing think this those through time to too two under up us use very want was
  way we well were what when where which while who why will with work would year you your
  book chapter character characters fiction story stories world life man woman men women
  `
    .trim()
    .split(/\s+/)
);

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const legacyKey = (kind: "" | ".calibration", userId: string | null) =>
  `${LEGACY_PREFIX}${kind}.${encodeURIComponent(userId?.trim().toLowerCase() || "offline")}`;

const readJson = (key: string) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
};

/**
 * What the old Smart Read had learned on this device, if anything: its profile
 * and the range the reader had set (null when they never changed it). It keyed
 * on the Drive account when there was one, so that is looked for first.
 */
export const readLegacySmartRead = (userId: string | null) => {
  const ids = userId ? [userId, null] : [null];
  for (const id of ids) {
    const profile = readJson(legacyKey("", id)) as LegacySmartReadProfile | null;
    const calibration = readJson(legacyKey(".calibration", id)) as { minWpm?: unknown; maxWpm?: unknown } | null;
    if (profile || calibration) {
      const minWpm = Number(calibration?.minWpm);
      const maxWpm = Number(calibration?.maxWpm);
      return {
        profile,
        limits: Number.isFinite(minWpm) && Number.isFinite(maxWpm) ? { minWpm, maxWpm } : null
      };
    }
  }
  return { profile: null, limits: null };
};

/** Clears Smart Read's local storage: the old profile, and the browser preview's copy of the new one. */
export const clearSmartReadProfiles = () => {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index)
    ).filter((key): key is string => Boolean(key?.startsWith(STORAGE_PREFIX)));
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Ignore storage failures while deleting the rest of the application data.
  }
};

export const getReadingTimeBand = (date = new Date()): ReadingTimeBand => {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
};

export const estimateWordDifficulty = (word: string) => {
  const letters = word.replace(/[^\p{L}]/gu, "");
  const lengthPenalty = Math.max(0, letters.length - 6) * 0.045;
  const syllableGroups = letters.toLowerCase().match(/[aeiouy]+/g)?.length ?? 1;
  const syllablePenalty = Math.max(0, syllableGroups - 2) * 0.055;
  const technicalPenalty = /\d|[_/\\]|[A-Z].*[A-Z]/.test(word) ? 0.12 : 0;
  return clamp(1 + lengthPenalty + syllablePenalty + technicalPenalty, 0.88, 1.65);
};

export const estimateRsvpPauseMultiplier = (word: string, localFrequency = 1) => {
  const normalized = word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (!normalized) return 1;
  if (COMMON_RSVP_WORDS.has(normalized)) return 1;

  let rarity = 0.08;
  if (normalized.length >= 7) rarity += 0.08;
  if (normalized.length >= 10) rarity += 0.12;
  if (normalized.length >= 14) rarity += 0.1;
  if (/\d/.test(word)) rarity += 0.12;
  if (/[A-Z].*[A-Z]/.test(word)) rarity += 0.14;
  if (/[^aeiouy]{4,}/i.test(normalized)) rarity += 0.08;
  if (localFrequency <= 1 && normalized.length >= 5) rarity += 0.08;
  if (localFrequency >= 3) rarity -= Math.min(0.12, (localFrequency - 2) * 0.03);

  return clamp(1 + rarity, 1.04, 1.62);
};
