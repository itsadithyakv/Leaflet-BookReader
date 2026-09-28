export type ReadingTimeBand = "morning" | "afternoon" | "evening" | "night";

type ReadingPace = {
  wpm: number;
  samples: number;
};

export type SmartReadProfile = {
  version: 1;
  global: ReadingPace;
  genres: Record<string, ReadingPace>;
  timeBands: Record<ReadingTimeBand, ReadingPace>;
  rereadRate: number;
  wordsObserved: number;
  updatedAt: string;
};

export type SmartReadSample = {
  words: number;
  elapsedMs: number;
  genres: string[];
  timeBand: ReadingTimeBand;
  difficulty: number;
  rereads: number;
};

export type SmartReadCalibration = {
  minWpm: number;
  maxWpm: number;
};

const STORAGE_PREFIX = "leaflet.smart-read.v1";
const DEFAULT_WPM = 185;
/**
 * Observations outside this band are not reading. Below it means the reader was
 * left open and the idle gap got counted as reading time; above it means the
 * page was scrolled past rather than read. Both used to be clamped into range,
 * which still dragged the learned pace toward whichever bound they hit.
 */
const PLAUSIBLE_MIN_WPM = 45;
const PLAUSIBLE_MAX_WPM = 900;
export const DEFAULT_SMART_READ_CALIBRATION: SmartReadCalibration = {
  minWpm: 120,
  maxWpm: 320
};
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

const emptyPace = (): ReadingPace => ({ wpm: DEFAULT_WPM, samples: 0 });

const createDefaultProfile = (): SmartReadProfile => ({
  version: 1,
  global: emptyPace(),
  genres: {},
  timeBands: {
    morning: emptyPace(),
    afternoon: emptyPace(),
    evening: emptyPace(),
    night: emptyPace()
  },
  rereadRate: 0,
  wordsObserved: 0,
  updatedAt: new Date(0).toISOString()
});

const profileKey = (userId: string | null) =>
  `${STORAGE_PREFIX}.${encodeURIComponent(userId?.trim().toLowerCase() || "offline")}`;

const calibrationKey = (userId: string | null) =>
  `${STORAGE_PREFIX}.calibration.${encodeURIComponent(userId?.trim().toLowerCase() || "offline")}`;

export const normalizeSmartReadCalibration = (
  value: Partial<SmartReadCalibration> | null | undefined
): SmartReadCalibration => {
  const minWpm = clamp(
    Math.round(Number(value?.minWpm) || DEFAULT_SMART_READ_CALIBRATION.minWpm),
    70,
    480
  );
  const maxWpm = clamp(
    Math.round(Number(value?.maxWpm) || DEFAULT_SMART_READ_CALIBRATION.maxWpm),
    minWpm + 20,
    500
  );
  return { minWpm: Math.min(minWpm, maxWpm - 20), maxWpm };
};

export const loadSmartReadCalibration = (userId: string | null): SmartReadCalibration => {
  try {
    const raw = localStorage.getItem(calibrationKey(userId));
    return raw
      ? normalizeSmartReadCalibration(JSON.parse(raw) as Partial<SmartReadCalibration>)
      : { ...DEFAULT_SMART_READ_CALIBRATION };
  } catch {
    return { ...DEFAULT_SMART_READ_CALIBRATION };
  }
};

export const saveSmartReadCalibration = (
  userId: string | null,
  calibration: SmartReadCalibration
) => {
  const normalized = normalizeSmartReadCalibration(calibration);
  try {
    localStorage.setItem(calibrationKey(userId), JSON.stringify(normalized));
  } catch {
    // Reading should continue if local persistence is unavailable.
  }
  return normalized;
};

const normalizePace = (value: unknown): ReadingPace => {
  const pace = value as Partial<ReadingPace> | null;
  return {
    wpm: clamp(Number(pace?.wpm) || DEFAULT_WPM, 70, 420),
    samples: Math.max(0, Math.round(Number(pace?.samples) || 0))
  };
};

export const loadSmartReadProfile = (userId: string | null): SmartReadProfile => {
  try {
    const raw = localStorage.getItem(profileKey(userId));
    if (!raw) {
      return createDefaultProfile();
    }
    const parsed = JSON.parse(raw) as Partial<SmartReadProfile>;
    if (parsed.version !== 1) {
      return createDefaultProfile();
    }
    const defaults = createDefaultProfile();
    return {
      version: 1,
      global: normalizePace(parsed.global),
      genres: Object.fromEntries(
        Object.entries(parsed.genres ?? {}).map(([genre, pace]) => [
          genre,
          normalizePace(pace)
        ])
      ),
      timeBands: {
        morning: normalizePace(parsed.timeBands?.morning ?? defaults.timeBands.morning),
        afternoon: normalizePace(parsed.timeBands?.afternoon ?? defaults.timeBands.afternoon),
        evening: normalizePace(parsed.timeBands?.evening ?? defaults.timeBands.evening),
        night: normalizePace(parsed.timeBands?.night ?? defaults.timeBands.night)
      },
      rereadRate: clamp(Number(parsed.rereadRate) || 0, 0, 0.6),
      wordsObserved: Math.max(0, Math.round(Number(parsed.wordsObserved) || 0)),
      updatedAt: parsed.updatedAt || defaults.updatedAt
    };
  } catch {
    return createDefaultProfile();
  }
};

export const saveSmartReadProfile = (userId: string | null, profile: SmartReadProfile) => {
  try {
    localStorage.setItem(profileKey(userId), JSON.stringify(profile));
  } catch {
    // Reading should continue if local persistence is unavailable.
  }
};

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

export const normalizeGenre = (genre: string) =>
  genre.trim().toLowerCase().replace(/\s+/g, " ");

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

export const getAdaptiveWpm = (
  profile: SmartReadProfile,
  genres: string[],
  timeBand: ReadingTimeBand,
  difficulty: number,
  calibration: SmartReadCalibration = DEFAULT_SMART_READ_CALIBRATION
) => {
  const range = normalizeSmartReadCalibration(calibration);
  const genrePaces = genres
    .map(normalizeGenre)
    .map((genre) => profile.genres[genre])
    .filter((pace): pace is ReadingPace => Boolean(pace));
  const genreWeight = Math.min(0.34, genrePaces.reduce((sum, pace) => sum + pace.samples, 0) * 0.025);
  const genreWpm =
    genrePaces.length > 0
      ? genrePaces.reduce((sum, pace) => sum + pace.wpm, 0) / genrePaces.length
      : profile.global.wpm;
  const timePace = profile.timeBands[timeBand];
  const timeWeight = Math.min(0.24, timePace.samples * 0.025);
  const globalWeight = Math.max(0.42, 1 - genreWeight - timeWeight);
  const learned =
    profile.global.wpm * globalWeight +
    genreWpm * genreWeight +
    timePace.wpm * timeWeight;
  const rereadAdjustment = 1 - Math.min(0.18, profile.rereadRate * 0.4);
  return clamp(
    (learned * rereadAdjustment) / clamp(difficulty, 0.85, 1.7),
    range.minWpm,
    range.maxWpm
  );
};

const updatePace = (current: ReadingPace, observedWpm: number, weight: number): ReadingPace => {
  const confidence = Math.min(18, current.samples);
  const nextWeight = clamp(weight, 0.25, 4);
  return {
    wpm: clamp(
      (current.wpm * confidence + observedWpm * nextWeight) / (confidence + nextWeight),
      70,
      420
    ),
    samples: current.samples + 1
  };
};

export const recordSmartReadSample = (
  profile: SmartReadProfile,
  sample: SmartReadSample
): SmartReadProfile => {
  if (sample.words < 18 || sample.elapsedMs < 5000) {
    return profile;
  }
  const minutes = sample.elapsedMs / 60000;
  const rawWpm = sample.words / Math.max(minutes, 0.08);
  if (!Number.isFinite(rawWpm) || rawWpm < PLAUSIBLE_MIN_WPM || rawWpm > PLAUSIBLE_MAX_WPM) {
    return profile;
  }
  const difficultyAdjustedWpm = clamp(rawWpm * clamp(sample.difficulty, 0.85, 1.7), 70, 420);
  const weight = clamp(sample.words / 180, 0.35, 3);
  const genres = { ...profile.genres };
  sample.genres.map(normalizeGenre).filter(Boolean).forEach((genre) => {
    genres[genre] = updatePace(genres[genre] ?? emptyPace(), difficultyAdjustedWpm, weight * 0.75);
  });
  const timeBands = {
    ...profile.timeBands,
    [sample.timeBand]: updatePace(
      profile.timeBands[sample.timeBand],
      difficultyAdjustedWpm,
      weight * 0.65
    )
  };
  const rereadObservation = clamp(sample.rereads / Math.max(1, sample.words / 100), 0, 0.6);
  const rereadRate =
    profile.wordsObserved === 0
      ? rereadObservation
      : profile.rereadRate * 0.88 + rereadObservation * 0.12;
  return {
    version: 1,
    global: updatePace(profile.global, difficultyAdjustedWpm, weight),
    genres,
    timeBands,
    rereadRate: clamp(rereadRate, 0, 0.6),
    wordsObserved: profile.wordsObserved + sample.words,
    updatedAt: new Date().toISOString()
  };
};
