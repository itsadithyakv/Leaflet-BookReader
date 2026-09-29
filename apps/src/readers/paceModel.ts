/**
 * Reading pace: what Leaflet has learned about how fast this reader reads.
 *
 * Paces are kept "plain": the pace the reader would have on plain prose
 * (difficulty 1). A passage's own pace is that divided by its difficulty, so
 * before a book has taught anything, an easy one is already predicted faster
 * than a demanding one. Each book then learns its own pace, and the reader's
 * overall pace is drawn from all of them, recent books counting most.
 *
 * The profile travels in the sync document (see `sync/reading.rs`), merged
 * part by part: the reader-wide `core`, Dotty's `limits`, and each book.
 * Everything here is pure; callers pass the clock, as the sync merge does.
 */

export type TimeBand = "morning" | "afternoon" | "evening" | "night";
export type DifficultyBand = "easy" | "standard" | "demanding";

export type BookPace = {
  updatedAt: string;
  /** Words a minute on plain text: the pace read, times the text's difficulty. */
  wpm: number;
  /** Minutes of reading behind it. */
  minutes: number;
  /** How hard the book's text is (1 is plain prose), over what has been read. */
  difficulty: number;
  /** Words read in the samples it came from. */
  words: number;
  genres: string[];
  /** Set when the reader chose Dotty's pace for this book themselves. */
  manualAt?: string;
};

export type PaceCore = {
  updatedAt: string;
  /** Where a reader starts before any book has taught anything. */
  base: { wpm: number; minutes: number };
  /** How much faster or slower than usual the reader is at each time of day. */
  timeOfDay: Partial<Record<TimeBand, { ratio: number; minutes: number }>>;
  /** Stops left out of the pace: time to think, or a reader who stepped away. */
  pausesSkipped: number;
};

/** Dotty's range in Smart Read, set by the reader. */
export type PaceLimits = { updatedAt: string; minWpm: number; maxWpm: number };

export type ReadingProfile = {
  version: 2;
  core: PaceCore;
  limits?: PaceLimits;
  books: Record<string, BookPace>;
  /** When the reader last asked Leaflet to forget their pace. */
  resetAt?: string;
};

export type PaceContext = {
  bookId: string;
  genres: string[];
  /** Difficulty of the text being read now (a chapter, or a stretch of it). */
  difficulty: number;
  timeBand: TimeBand;
  now: number;
};

export type PaceSource = "scroll" | "pages" | "guided" | "caught-up";

export type PaceSample = {
  bookId: string;
  genres: string[];
  words: number;
  /** Time spent reading them, with pauses and time away already left out. */
  activeMs: number;
  difficulty: number;
  timeBand: TimeBand;
  at: string;
  source: PaceSource;
};

/** Consecutive samples far off the prediction, and which way. */
export type OutlierStreak = { direction: "slow" | "fast"; count: number } | null;
export type SampleOutcome = "learned" | "too-short" | "pause" | "skim";

const EPOCH = new Date(0).toISOString();
/** Plain-text pace for a reader Leaflet knows nothing about yet. */
export const DEFAULT_PLAIN_WPM = 215;
export const DEFAULT_LIMITS = { minWpm: 90, maxWpm: 700 };
/** A typical book's difficulty, for showing one "words a minute" figure. */
export const TYPICAL_DIFFICULTY = 1.06;
/**
 * Outside this band an observation is not reading: below it the reader was
 * away (or thinking) for most of it, above it the page went past unread.
 */
export const PLAUSIBLE_MIN_WPM = 45;
export const PLAUSIBLE_MAX_WPM = 900;
/** A book's own pace is trusted fully after this much reading in it. */
const BOOK_TRUST_MINUTES = 5;
/** A book's pace follows roughly its most recent this-many minutes. */
const BOOK_MEMORY_MINUTES = 20;
/** Old books count half as much after this many days. */
const RECENCY_HALF_LIFE_DAYS = 120;
/** How much reading a difficulty band, a genre or a time of day needs before it is believed. */
const BAND_PRIOR_MINUTES = 8;
const GENRE_PRIOR_MINUTES = 10;
const TIME_PRIOR_MINUTES = 6;
/** Samples this far off the prediction are set aside as pauses or skimming... */
const SLOW_RATIO = 0.5;
const FAST_RATIO = 2.2;
/** ...unless this many arrive in a row: then it is how this book reads. */
const STEADY_STREAK = 3;
const SOURCE_WEIGHT: Record<PaceSource, number> = {
  scroll: 1,
  pages: 1,
  // Reading at Dotty's pace without correcting it says the pace suits, but it
  // is Dotty's pace, not a measurement, so it counts for less.
  guided: 0.5,
  // Reading ahead of Dotty is a direct measurement, and a deliberate one.
  "caught-up": 1.25
};
/** The most books kept, as in `sync/reading.rs`. */
export const MAX_BOOKS = 400;

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const finite = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const instant = (value: string | undefined) => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};
const later = (a?: string, b?: string) => (!a ? b : !b ? a : instant(a) >= instant(b) ? a : b);

export const normalizeGenre = (genre: string) => genre.trim().toLowerCase().replace(/\s+/g, " ");

// ---- the profile itself --------------------------------------------------

export const createReadingProfile = (at = EPOCH): ReadingProfile => ({
  version: 2,
  core: { updatedAt: at, base: { wpm: DEFAULT_PLAIN_WPM, minutes: 2 }, timeOfDay: {}, pausesSkipped: 0 },
  books: {}
});

export const normalizeLimits = (value: Partial<{ minWpm: unknown; maxWpm: unknown }> | null | undefined) => {
  const minWpm = clamp(Math.round(finite(value?.minWpm, DEFAULT_LIMITS.minWpm)), 60, 600);
  const maxWpm = clamp(Math.round(finite(value?.maxWpm, DEFAULT_LIMITS.maxWpm)), minWpm + 40, 900);
  return { minWpm, maxWpm };
};

export const paceLimits = (profile: ReadingProfile) => normalizeLimits(profile.limits);

const sanitizeBook = (raw: unknown): BookPace | null => {
  const book = raw as Partial<BookPace> | null;
  if (!book || typeof book !== "object" || typeof book.updatedAt !== "string") {
    return null;
  }
  const wpm = finite(book.wpm, NaN);
  if (!Number.isFinite(wpm) || wpm <= 0) {
    return null;
  }
  return {
    updatedAt: book.updatedAt,
    wpm: clamp(wpm, 40, 1200),
    minutes: clamp(finite(book.minutes, 0), 0, 240),
    difficulty: clamp(finite(book.difficulty, TYPICAL_DIFFICULTY), 0.8, 1.7),
    words: Math.max(0, Math.round(finite(book.words, 0))),
    genres: Array.isArray(book.genres) ? book.genres.filter((genre): genre is string => typeof genre === "string").slice(0, 8) : [],
    ...(typeof book.manualAt === "string" ? { manualAt: book.manualAt } : {})
  };
};

/**
 * A profile from storage, the backend or another device, made safe to use:
 * every number in range, anything unreadable dropped. Null when there is
 * nothing usable at all.
 */
export const sanitizeProfile = (raw: unknown): ReadingProfile | null => {
  const value = raw as Partial<ReadingProfile> | null;
  if (!value || typeof value !== "object" || !value.core || typeof value.core !== "object") {
    return null;
  }
  const core = value.core as Partial<PaceCore>;
  const timeOfDay: PaceCore["timeOfDay"] = {};
  (["morning", "afternoon", "evening", "night"] as TimeBand[]).forEach((band) => {
    const entry = core.timeOfDay?.[band];
    if (entry && Number.isFinite(Number(entry.ratio))) {
      timeOfDay[band] = { ratio: clamp(Number(entry.ratio), 0.6, 1.6), minutes: clamp(finite(entry.minutes, 0), 0, 600) };
    }
  });
  const books: Record<string, BookPace> = {};
  Object.entries(value.books ?? {}).forEach(([id, entry]) => {
    const book = sanitizeBook(entry);
    if (book && id) {
      books[id] = book;
    }
  });
  const limits = value.limits as Partial<PaceLimits> | undefined;
  return tidy({
    version: 2,
    core: {
      updatedAt: typeof core.updatedAt === "string" ? core.updatedAt : EPOCH,
      base: {
        wpm: clamp(finite(core.base?.wpm, DEFAULT_PLAIN_WPM), 60, 700),
        minutes: clamp(finite(core.base?.minutes, 2), 0, 30)
      },
      timeOfDay,
      pausesSkipped: Math.max(0, Math.round(finite(core.pausesSkipped, 0)))
    },
    ...(limits && typeof limits.updatedAt === "string"
      ? { limits: { updatedAt: limits.updatedAt, ...normalizeLimits(limits) } }
      : {}),
    books,
    ...(typeof value.resetAt === "string" ? { resetAt: value.resetAt } : {})
  });
};

/** Drops books from before a reset, and the oldest past the cap, as Rust does. */
const tidy = (profile: ReadingProfile): ReadingProfile => {
  const reset = profile.resetAt ? instant(profile.resetAt) : null;
  let entries = Object.entries(profile.books).filter(([, book]) => reset === null || instant(book.updatedAt) >= reset);
  if (entries.length > MAX_BOOKS) {
    entries = entries
      .sort(([idA, a], [idB, b]) => instant(b.updatedAt) - instant(a.updatedAt) || (idA < idB ? -1 : idA > idB ? 1 : 0))
      .slice(0, MAX_BOOKS);
  }
  return { ...profile, books: Object.fromEntries(entries) };
};

/** The newer of two copies of one part; an exact tie is settled by the content. */
const newer = <T extends { updatedAt: string }>(a: T, b: T) => {
  const difference = instant(a.updatedAt) - instant(b.updatedAt);
  if (difference !== 0) {
    return difference > 0 ? a : b;
  }
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
};

/** Two copies of the profile, merged part by part as `sync/reading.rs` does. */
export const mergeProfiles = (a: ReadingProfile, b: ReadingProfile): ReadingProfile => {
  const books: Record<string, BookPace> = { ...a.books };
  Object.entries(b.books).forEach(([id, book]) => {
    books[id] = books[id] ? newer(books[id], book) : book;
  });
  const limits = a.limits && b.limits ? newer(a.limits, b.limits) : a.limits ?? b.limits;
  const resetAt = later(a.resetAt, b.resetAt);
  return tidy({
    version: 2,
    core: newer(a.core, b.core),
    ...(limits ? { limits } : {}),
    books,
    ...(resetAt ? { resetAt } : {})
  });
};

// ---- difficulty ------------------------------------------------------------

/**
 * How hard a stretch of text is to read, 1 being plain prose: longer, rarer
 * words and longer sentences make it harder. Short sentences (dialogue, a
 * children's book) read faster than their words alone suggest.
 */
export const estimateTextDifficulty = (words: ReadonlyArray<{ difficulty: number; sentenceEnd: boolean; paragraphEnd?: boolean }>) => {
  if (words.length < 30) {
    return TYPICAL_DIFFICULTY;
  }
  let wordTotal = 0;
  let boundaries = 0;
  for (const word of words) {
    wordTotal += word.difficulty;
    if (word.sentenceEnd || word.paragraphEnd) {
      boundaries += 1;
    }
  }
  const averageWord = wordTotal / words.length;
  const averageSentence = words.length / Math.max(1, boundaries);
  const sentenceFactor = 1 + clamp((averageSentence - 14) * 0.012, -0.08, 0.2);
  return clamp(averageWord * sentenceFactor, 0.8, 1.7);
};

export const difficultyBand = (difficulty: number): DifficultyBand =>
  difficulty < 1 ? "easy" : difficulty < 1.15 ? "standard" : "demanding";

/** A typical difficulty inside each band, for showing a band's pace in words a minute. */
const BAND_DIFFICULTY: Record<DifficultyBand, number> = { easy: 0.96, standard: TYPICAL_DIFFICULTY, demanding: 1.24 };

// ---- predicting --------------------------------------------------------------

const recency = (updatedAt: string, now: number) => {
  const ageDays = Math.max(0, now - instant(updatedAt)) / 86_400_000;
  return Math.max(0.15, 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS));
};

/** A weighted average of books' plain paces; zero minutes when none apply. */
const averageOver = (books: BookPace[], now: number) => {
  let total = 0;
  let weight = 0;
  for (const book of books) {
    const w = Math.min(book.minutes, 30) * recency(book.updatedAt, now);
    total += book.wpm * w;
    weight += w;
  }
  return { wpm: weight > 0 ? total / weight : 0, minutes: weight };
};

/** The reader's plain pace across every book, recent ones counting most. */
export const readerPace = (profile: ReadingProfile, now: number) => {
  const { base } = profile.core;
  const books = averageOver(Object.values(profile.books), now);
  const weight = base.minutes + books.minutes;
  return {
    wpm: weight > 0 ? (base.wpm * base.minutes + books.wpm * books.minutes) / weight : base.wpm,
    /** Reading behind it, not counting the starting guess. */
    minutes: books.minutes
  };
};

/** A factor learned from `minutes` of reading, pulled toward 1 until there is enough. */
const shrink = (ratio: number, minutes: number, prior: number, low: number, high: number) =>
  clamp((clamp(ratio, low, high) * minutes + prior) / (minutes + prior), low, high);

const timeFactor = (profile: ReadingProfile, band: TimeBand) => {
  const entry = profile.core.timeOfDay[band];
  return entry ? shrink(entry.ratio, entry.minutes, TIME_PRIOR_MINUTES, 0.85, 1.15) : 1;
};

/**
 * The plain pace to expect in this book: its own, once it has taught enough
 * (or the reader set it), otherwise the reader's overall pace adjusted by how
 * they read books of this difficulty and genre.
 */
export const predictPlainWpm = (profile: ReadingProfile, context: PaceContext) => {
  const book = profile.books[context.bookId];
  const reader = readerPace(profile, context.now);
  const others = Object.entries(profile.books)
    .filter(([id]) => id !== context.bookId)
    .map(([, entry]) => entry);
  let prior = reader.wpm;
  const band = difficultyBand(book?.difficulty ?? context.difficulty);
  const inBand = averageOver(others.filter((entry) => difficultyBand(entry.difficulty) === band), context.now);
  if (inBand.minutes > 0 && reader.wpm > 0) {
    prior *= shrink(inBand.wpm / reader.wpm, inBand.minutes, BAND_PRIOR_MINUTES, 0.6, 1.6);
  }
  const genres = new Set(context.genres.map(normalizeGenre).filter(Boolean));
  if (genres.size > 0) {
    const inGenre = averageOver(
      others.filter((entry) => entry.genres.some((genre) => genres.has(normalizeGenre(genre)))),
      context.now
    );
    if (inGenre.minutes > 0 && reader.wpm > 0) {
      prior *= shrink(inGenre.wpm / reader.wpm, inGenre.minutes, GENRE_PRIOR_MINUTES, 0.7, 1.4);
    }
  }
  if (!book) {
    return prior;
  }
  const trust = book.manualAt ? 1 : Math.min(1, book.minutes / BOOK_TRUST_MINUTES);
  return book.wpm * trust + prior * (1 - trust);
};

/** A plain pace as words a minute through this text now: within Dotty's limits unless asked otherwise. */
export const wpmFromPlain = (
  profile: ReadingProfile,
  plainWpm: number,
  context: Pick<PaceContext, "difficulty" | "timeBand">,
  options: { limited?: boolean } = {}
) => {
  const raw = (plainWpm * timeFactor(profile, context.timeBand)) / clamp(context.difficulty, 0.8, 1.7);
  if (options.limited === false) {
    return raw;
  }
  const limits = paceLimits(profile);
  return clamp(raw, limits.minWpm, limits.maxWpm);
};

/** The other way: words a minute through this text now, as a plain pace. */
export const plainFromWpm = (profile: ReadingProfile, wpm: number, context: Pick<PaceContext, "difficulty" | "timeBand">) =>
  (wpm * clamp(context.difficulty, 0.8, 1.7)) / timeFactor(profile, context.timeBand);

/** Words a minute to expect for this text now: within Dotty's limits unless asked otherwise. */
export const predictWpm = (profile: ReadingProfile, context: PaceContext, options: { limited?: boolean } = {}) =>
  wpmFromPlain(profile, predictPlainWpm(profile, context), context, options);

// ---- learning ------------------------------------------------------------------

const withCore = (profile: ReadingProfile, change: Partial<PaceCore>, at: string): ReadingProfile => ({
  ...profile,
  core: { ...profile.core, ...change, updatedAt: at }
});

/**
 * Learns from a stretch of reading. Pauses are the hard part: a sample far
 * slower than expected is most likely a stop to think (or a reader who looked
 * away), and one far faster is skimming, so neither is learned. Only when they
 * keep coming the same way is it taken as how this reader reads this book.
 * The caller keeps the streak between samples.
 */
export const recordSample = (profile: ReadingProfile, sample: PaceSample, streak: OutlierStreak = null) => {
  if (sample.words < 25 || sample.activeMs < 6000) {
    return { profile, outcome: "too-short" as SampleOutcome, streak };
  }
  const raw = sample.words / (sample.activeMs / 60000);
  if (!Number.isFinite(raw) || raw < PLAUSIBLE_MIN_WPM) {
    return {
      profile: withCore(profile, { pausesSkipped: profile.core.pausesSkipped + 1 }, sample.at),
      outcome: "pause" as SampleOutcome,
      streak
    };
  }
  if (raw > PLAUSIBLE_MAX_WPM) {
    return { profile, outcome: "skim" as SampleOutcome, streak };
  }
  const now = instant(sample.at) || Date.now();
  const context: PaceContext = {
    bookId: sample.bookId,
    genres: sample.genres,
    difficulty: sample.difficulty,
    timeBand: sample.timeBand,
    now
  };
  const book = profile.books[sample.bookId];
  const expected = predictWpm(profile, context, { limited: false });
  const ratio = raw / expected;
  const confident = (book?.minutes ?? 0) >= 4 || readerPace(profile, now).minutes + profile.core.base.minutes >= 12;
  let nextStreak: OutlierStreak = null;
  let scale = 1;
  if (confident && (ratio < SLOW_RATIO || ratio > FAST_RATIO)) {
    const direction = ratio < SLOW_RATIO ? "slow" : "fast";
    const count = streak?.direction === direction ? streak.count + 1 : 1;
    nextStreak = { direction, count };
    if (count < STEADY_STREAK) {
      return direction === "slow"
        ? {
            profile: withCore(profile, { pausesSkipped: profile.core.pausesSkipped + 1 }, sample.at),
            outcome: "pause" as SampleOutcome,
            streak: nextStreak
          }
        : { profile, outcome: "skim" as SampleOutcome, streak: nextStreak };
    }
    // A steady change, taken in more carefully than a sample that agrees.
    scale = 0.5;
  }

  const difficulty = clamp(sample.difficulty, 0.8, 1.7);
  const band = timeFactor(profile, sample.timeBand);
  const plain = (raw * difficulty) / band;
  const weight = clamp(sample.activeMs / 60000, 0.1, 4) * SOURCE_WEIGHT[sample.source] * scale;
  const previous: BookPace = book ?? {
    updatedAt: sample.at,
    wpm: plain,
    minutes: 0,
    difficulty,
    words: 0,
    genres: []
  };
  const memory = Math.min(previous.minutes, BOOK_MEMORY_MINUTES);
  const words = previous.words + sample.words;
  const nextBook: BookPace = {
    ...previous,
    updatedAt: sample.at,
    wpm: clamp((previous.wpm * memory + plain * weight) / (memory + weight), 40, 1200),
    minutes: Math.min(240, previous.minutes + weight),
    difficulty: words > 0 ? (previous.difficulty * previous.words + difficulty * sample.words) / words : difficulty,
    words,
    genres: sample.genres.map(normalizeGenre).filter(Boolean).slice(0, 8)
  };

  // Time of day: this sample against the book's own pace, once the book has
  // one worth comparing with. Compared with a first guess instead, it would
  // only learn how wrong the guess was.
  let learned = profile;
  if (book && (book.manualAt || book.minutes >= BOOK_TRUST_MINUTES)) {
    const observedRatio = clamp((raw * difficulty) / book.wpm, 0.6, 1.6);
    const current = profile.core.timeOfDay[sample.timeBand] ?? { ratio: 1, minutes: 0 };
    const timeMemory = Math.min(current.minutes, 30);
    const timeOfDay = {
      ...profile.core.timeOfDay,
      [sample.timeBand]: {
        ratio: (current.ratio * timeMemory + observedRatio * weight) / (timeMemory + weight),
        minutes: Math.min(600, current.minutes + weight)
      }
    };
    learned = withCore(profile, { timeOfDay }, sample.at);
  }

  return {
    profile: tidy({ ...learned, books: { ...profile.books, [sample.bookId]: nextBook } }),
    outcome: "learned" as SampleOutcome,
    streak: nextStreak
  };
};

/** A stop the trackers left out before it reached the model, counted for Settings. */
export const notePause = (profile: ReadingProfile, at: string): ReadingProfile =>
  withCore(profile, { pausesSkipped: profile.core.pausesSkipped + 1 }, at);

/**
 * The reader set Dotty's pace for this book (a nudge, or dragging Dotty). It
 * is taken as said: this book is predicted at exactly this pace from now on,
 * until reading teaches otherwise.
 */
export const setBookPace = (
  profile: ReadingProfile,
  change: { bookId: string; genres: string[]; wpm: number; difficulty: number; timeBand: TimeBand; at: string }
): ReadingProfile => {
  const difficulty = clamp(change.difficulty, 0.8, 1.7);
  const plain = (clamp(change.wpm, 40, 1000) * difficulty) / timeFactor(profile, change.timeBand);
  const previous = profile.books[change.bookId];
  return tidy({
    ...profile,
    books: {
      ...profile.books,
      [change.bookId]: {
        updatedAt: change.at,
        wpm: clamp(plain, 40, 1200),
        minutes: Math.max(previous?.minutes ?? 0, BOOK_TRUST_MINUTES),
        difficulty: previous?.difficulty ?? difficulty,
        words: previous?.words ?? 0,
        genres: change.genres.map(normalizeGenre).filter(Boolean).slice(0, 8),
        manualAt: change.at
      }
    }
  });
};

export const setLimits = (profile: ReadingProfile, limits: { minWpm: number; maxWpm: number }, at: string): ReadingProfile => ({
  ...profile,
  limits: { updatedAt: at, ...normalizeLimits(limits) }
});

/** Forgets everything learned (Dotty's range is the reader's own, so it stays). */
export const forgetPace = (profile: ReadingProfile, at: string): ReadingProfile => ({
  ...createReadingProfile(at),
  ...(profile.limits ? { limits: profile.limits } : {}),
  resetAt: at
});

// ---- for Settings --------------------------------------------------------------

/** What the pace card shows: one overall figure and, where known, one per band. */
export const describePace = (profile: ReadingProfile, now: number) => {
  const reader = readerPace(profile, now);
  const books = Object.values(profile.books);
  const bands: Partial<Record<DifficultyBand, number>> = {};
  (["easy", "standard", "demanding"] as DifficultyBand[]).forEach((band) => {
    const inBand = averageOver(books.filter((book) => difficultyBand(book.difficulty) === band), now);
    if (inBand.minutes >= 3) {
      bands[band] = Math.round(inBand.wpm / BAND_DIFFICULTY[band]);
    }
  });
  return {
    wpm: Math.round(reader.wpm / TYPICAL_DIFFICULTY),
    minutes: Math.round(books.reduce((sum, book) => sum + book.minutes, 0)),
    books: books.filter((book) => book.minutes >= 1).length,
    bands,
    pausesSkipped: profile.core.pausesSkipped
  };
};

// ---- the old Smart Read profile ------------------------------------------------

type LegacyPace = { wpm?: number; samples?: number };
export type LegacySmartReadProfile = {
  version?: number;
  global?: LegacyPace;
  timeBands?: Partial<Record<TimeBand, LegacyPace>>;
};

/**
 * Brings over what the old, device-only Smart Read profile had learned: its
 * overall pace becomes the starting point, its time-of-day paces the time
 * factors. Its limits come over only if the reader had changed them; the old
 * default ceiling (320) was what kept Dotty from ever catching a fast reader.
 */
export const migrateLegacyProfile = (
  legacy: LegacySmartReadProfile | null,
  savedLimits: { minWpm: number; maxWpm: number } | null,
  at: string
): ReadingProfile | null => {
  const samples = finite(legacy?.global?.samples, 0);
  if ((!legacy || legacy.version !== 1 || samples <= 0) && !savedLimits) {
    return null;
  }
  const profile = createReadingProfile(at);
  if (legacy && legacy.version === 1 && samples > 0) {
    const globalWpm = clamp(finite(legacy.global?.wpm, DEFAULT_PLAIN_WPM), 70, 420);
    profile.core.base = { wpm: globalWpm, minutes: clamp(samples, 2, 15) };
    (["morning", "afternoon", "evening", "night"] as TimeBand[]).forEach((band) => {
      const pace = legacy.timeBands?.[band];
      const bandSamples = finite(pace?.samples, 0);
      if (pace && bandSamples > 0) {
        profile.core.timeOfDay[band] = {
          ratio: clamp(finite(pace.wpm, globalWpm) / globalWpm, 0.6, 1.6),
          minutes: Math.min(15, bandSamples)
        };
      }
    });
  }
  return savedLimits ? setLimits(profile, savedLimits, at) : profile;
};
