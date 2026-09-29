import { describe, expect, it } from "vitest";
import {
  createReadingProfile,
  describePace,
  difficultyBand,
  estimateTextDifficulty,
  forgetPace,
  MAX_BOOKS,
  mergeProfiles,
  migrateLegacyProfile,
  normalizeLimits,
  notePause,
  paceLimits,
  predictWpm,
  readerPace,
  recordSample,
  sanitizeProfile,
  setBookPace,
  setLimits,
  type OutlierStreak,
  type PaceContext,
  type PaceSample,
  type ReadingProfile
} from "./paceModel";

const DAY = 86_400_000;
const T0 = Date.parse("2026-09-01T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const context = (bookId: string, difficulty = 1.06, now = T0): PaceContext => ({
  bookId,
  genres: [],
  difficulty,
  timeBand: "morning",
  now
});

/** `minutes` of reading at `wpm` in one book, fed as a run of two-minute samples. */
const readFor = (
  profile: ReadingProfile,
  bookId: string,
  wpm: number,
  minutes: number,
  options: { difficulty?: number; genres?: string[]; start?: number; timeBand?: PaceSample["timeBand"] } = {}
) => {
  let current = profile;
  let streak: OutlierStreak = null;
  const start = options.start ?? T0;
  for (let step = 0; step < minutes / 2; step += 1) {
    const result = recordSample(
      current,
      {
        bookId,
        genres: options.genres ?? [],
        words: Math.round(wpm * 2),
        activeMs: 120_000,
        difficulty: options.difficulty ?? 1.06,
        timeBand: options.timeBand ?? "morning",
        at: iso(start + step * 150_000),
        source: "scroll"
      },
      streak
    );
    current = result.profile;
    streak = result.streak;
  }
  return current;
};

const sample = (overrides: Partial<PaceSample> = {}): PaceSample => ({
  bookId: "dune",
  genres: [],
  words: 400,
  activeMs: 120_000,
  difficulty: 1.06,
  timeBand: "morning",
  at: iso(T0),
  source: "scroll",
  ...overrides
});

describe("predicting a pace", () => {
  it("expects an easy book to read faster than a demanding one before anything is learned", () => {
    const profile = createReadingProfile();
    const easy = predictWpm(profile, context("picture-book", 0.94));
    const hard = predictWpm(profile, context("philosophy", 1.35));
    expect(easy).toBeGreaterThan(hard * 1.3);
  });

  it("keeps every prediction inside Dotty's range", () => {
    const profile = setLimits(createReadingProfile(), { minWpm: 150, maxWpm: 260 }, iso(T0));
    expect(predictWpm(profile, context("a", 0.8))).toBeLessThanOrEqual(260);
    expect(predictWpm(profile, context("b", 1.7))).toBeGreaterThanOrEqual(150);
    expect(predictWpm(profile, context("a", 0.8), { limited: false })).toBeGreaterThan(260);
  });

  it("widens the old 120 to 320 range, so a fast reader is not held back", () => {
    expect(paceLimits(createReadingProfile()).maxWpm).toBeGreaterThanOrEqual(600);
    expect(normalizeLimits({ minWpm: 500, maxWpm: 480 })).toEqual({ minWpm: 500, maxWpm: 540 });
    expect(normalizeLimits({ minWpm: "x", maxWpm: Number.NaN })).toEqual({ minWpm: 90, maxWpm: 700 });
  });
});

describe("learning from reading", () => {
  it("learns a book's own pace", () => {
    const profile = readFor(createReadingProfile(), "dune", 320, 12);
    expect(predictWpm(profile, context("dune"))).toBeCloseTo(320, -1);
  });

  it("keeps a separate pace for each book", () => {
    let profile = readFor(createReadingProfile(), "thriller", 360, 14);
    profile = readFor(profile, "textbook", 140, 14, { start: T0 + 3_600_000 });
    const now = T0 + 7_200_000;
    expect(predictWpm(profile, context("thriller", 1.06, now))).toBeGreaterThan(300);
    expect(predictWpm(profile, context("textbook", 1.06, now))).toBeLessThan(180);
  });

  it("starts a new book from how this reader reads books of its difficulty", () => {
    // Fast through light books, slow through demanding ones.
    let profile = readFor(createReadingProfile(), "light", 360, 16, { difficulty: 0.95 });
    profile = readFor(profile, "dense", 150, 16, { difficulty: 1.3, start: T0 + 3_600_000 });
    const now = T0 + 7_200_000;
    const nextLight = predictWpm(profile, context("another-light", 0.95, now));
    const nextDense = predictWpm(profile, context("another-dense", 1.3, now));
    // Beyond what the difficulty alone would say (0.95 against 1.3 is 1.37x).
    expect(nextLight / nextDense).toBeGreaterThan(1.6);
  });

  it("starts a new book from books of the same genre", () => {
    let profile = readFor(createReadingProfile(), "romance-1", 380, 16, { genres: ["Romance"] });
    profile = readFor(profile, "history-1", 200, 16, { genres: ["History"], start: T0 + 3_600_000 });
    const now = T0 + 7_200_000;
    const romance = predictWpm(profile, { ...context("romance-2", 1.06, now), genres: ["romance"] });
    const history = predictWpm(profile, { ...context("history-2", 1.06, now), genres: ["history"] });
    expect(romance).toBeGreaterThan(history * 1.15);
  });

  it("does not learn a stop to think as slow reading", () => {
    const profile = readFor(createReadingProfile(), "dune", 250, 12);
    const before = predictWpm(profile, context("dune"));
    // Two minutes in which only 60 words moved: the reader stopped over something.
    const paused = recordSample(profile, sample({ words: 60, at: iso(T0 + 2 * 3_600_000) }));
    expect(paused.outcome).toBe("pause");
    expect(paused.profile.core.pausesSkipped).toBe(profile.core.pausesSkipped + 1);
    expect(predictWpm(paused.profile, context("dune"))).toBeCloseTo(before, 5);
  });

  it("counts stops the trackers left out, without touching any pace", () => {
    const profile = readFor(createReadingProfile(), "dune", 250, 12);
    const counted = notePause(profile, iso(T0 + DAY));
    expect(counted.core.pausesSkipped).toBe(profile.core.pausesSkipped + 1);
    expect(counted.books).toEqual(profile.books);
  });

  it("does learn a pace that stays slow: that is how this book reads", () => {
    let profile = readFor(createReadingProfile(), "dune", 250, 12);
    let streak: OutlierStreak = null;
    const outcomes: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      const result = recordSample(profile, sample({ words: 200, at: iso(T0 + 3_600_000 + step * 150_000) }), streak);
      profile = result.profile;
      streak = result.streak;
      outcomes.push(result.outcome);
    }
    expect(outcomes.slice(0, 2)).toEqual(["pause", "pause"]);
    expect(outcomes[2]).toBe("learned");
    expect(predictWpm(profile, context("dune", 1.06, T0 + 4_000_000))).toBeLessThan(230);
  });

  it("does not learn skimming, nor what is not reading at all", () => {
    const profile = readFor(createReadingProfile(), "dune", 250, 12);
    expect(recordSample(profile, sample({ words: 1400 })).outcome).toBe("skim");
    expect(recordSample(profile, sample({ words: 2000, activeMs: 60_000 })).outcome).toBe("skim");
    expect(recordSample(profile, sample({ words: 40, activeMs: 120_000 })).outcome).toBe("pause");
    expect(recordSample(profile, sample({ words: 10 })).outcome).toBe("too-short");
    expect(recordSample(profile, sample({ activeMs: 3000 })).outcome).toBe("too-short");
  });

  it("learns more slowly from Smart Read's own pace than from free reading", () => {
    const start = readFor(createReadingProfile(), "dune", 250, 6);
    const free = recordSample(start, sample({ words: 700, at: iso(T0 + 3_600_000) })).profile;
    const guided = recordSample(start, sample({ words: 700, at: iso(T0 + 3_600_000), source: "guided" })).profile;
    const now = T0 + 3_700_000;
    expect(predictWpm(free, context("dune", 1.06, now))).toBeGreaterThan(predictWpm(guided, context("dune", 1.06, now)));
  });

  it("learns the time of day the reader reads faster", () => {
    let profile = readFor(createReadingProfile(), "dune", 240, 20, { timeBand: "morning" });
    profile = readFor(profile, "dune", 300, 20, { timeBand: "evening", start: T0 + 3_600_000 });
    const now = T0 + 7_200_000;
    const morning = predictWpm(profile, { ...context("dune", 1.06, now), timeBand: "morning" });
    const evening = predictWpm(profile, { ...context("dune", 1.06, now), timeBand: "evening" });
    expect(evening).toBeGreaterThan(morning);
  });

  it("lets recent books count for more than old ones", () => {
    let profile = readFor(createReadingProfile(), "old", 180, 20);
    profile = readFor(profile, "new", 300, 20, { start: T0 + 365 * DAY });
    expect(readerPace(profile, T0 + 366 * DAY).wpm / 1.06).toBeGreaterThan(260);
  });
});

describe("the reader's own say", () => {
  it("takes a pace set by hand exactly, at once", () => {
    const profile = readFor(createReadingProfile(), "dune", 250, 12);
    const set = setBookPace(profile, {
      bookId: "dune",
      genres: [],
      wpm: 330,
      difficulty: 1.1,
      timeBand: "morning",
      at: iso(T0 + 3_600_000)
    });
    expect(predictWpm(set, { ...context("dune", 1.1, T0 + 3_600_000) })).toBeCloseTo(330, 0);
    expect(set.books.dune.manualAt).toBe(iso(T0 + 3_600_000));
  });

  it("forgets what it learned but keeps the reader's range", () => {
    let profile = readFor(createReadingProfile(), "dune", 250, 12);
    profile = setLimits(profile, { minWpm: 140, maxWpm: 400 }, iso(T0));
    const forgotten = forgetPace(profile, iso(T0 + DAY));
    expect(forgotten.books).toEqual({});
    expect(forgotten.resetAt).toBe(iso(T0 + DAY));
    expect(paceLimits(forgotten)).toEqual({ minWpm: 140, maxWpm: 400 });
    // A device that missed the reset cannot bring the old books back.
    expect(mergeProfiles(profile, forgotten).books).toEqual({});
  });
});

describe("merging copies from two devices", () => {
  it("keeps each device's books and the newer of everything else", () => {
    const laptop = readFor(createReadingProfile(), "dune", 250, 8);
    const phone = setLimits(readFor(createReadingProfile(), "hobbit", 300, 8, { start: T0 + DAY }), { minWpm: 120, maxWpm: 500 }, iso(T0));
    const merged = mergeProfiles(laptop, phone);
    expect(Object.keys(merged.books).sort()).toEqual(["dune", "hobbit"]);
    expect(merged.core.updatedAt).toBe(phone.core.updatedAt);
    expect(merged.limits?.maxWpm).toBe(500);
    expect(mergeProfiles(phone, laptop)).toEqual(merged);
    expect(mergeProfiles(laptop, merged)).toEqual(merged);
  });

  it("keeps what each device learned about the time of day, and the larger count of stops", () => {
    const shared = createReadingProfile(iso(T0));
    const laptop: ReadingProfile = {
      ...shared,
      core: {
        ...shared.core,
        updatedAt: iso(T0 + DAY),
        timeOfDay: { morning: { ratio: 1.1, minutes: 40 }, night: { ratio: 0.8, minutes: 25 } },
        pausesSkipped: 7
      }
    };
    const phone: ReadingProfile = {
      ...shared,
      core: {
        ...shared.core,
        updatedAt: iso(T0 + 2 * DAY),
        timeOfDay: { evening: { ratio: 0.9, minutes: 30 }, night: { ratio: 0.85, minutes: 12 } },
        pausesSkipped: 4
      }
    };
    const merged = mergeProfiles(laptop, phone);
    expect(merged.core.timeOfDay).toEqual({
      morning: { ratio: 1.1, minutes: 40 },
      evening: { ratio: 0.9, minutes: 30 },
      night: { ratio: 0.8, minutes: 25 }
    });
    expect(merged.core.pausesSkipped).toBe(7);
    expect(merged.core.updatedAt).toBe(phone.core.updatedAt);
    expect(mergeProfiles(phone, laptop)).toEqual(merged);
    expect(mergeProfiles(merged, merged)).toEqual(merged);
  });

  it("takes the newer copy of a book read on both", () => {
    const first = readFor(createReadingProfile(), "dune", 200, 8);
    const later = readFor(createReadingProfile(), "dune", 300, 8, { start: T0 + DAY });
    expect(mergeProfiles(first, later).books.dune).toEqual(later.books.dune);
  });

  it("keeps the most recent books past the cap", () => {
    const profile = createReadingProfile();
    for (let n = 0; n < MAX_BOOKS + 3; n += 1) {
      profile.books[`b${n}`] = { updatedAt: iso(T0 + n * 1000), wpm: 220, minutes: 5, difficulty: 1, words: 1000, genres: [] };
    }
    const merged = mergeProfiles(profile, createReadingProfile());
    expect(Object.keys(merged.books)).toHaveLength(MAX_BOOKS);
    expect(merged.books.b0).toBeUndefined();
    expect(merged.books[`b${MAX_BOOKS + 2}`]).toBeDefined();
  });
});

describe("reading a stored profile", () => {
  it("refuses what is not a profile, and repairs what is out of range", () => {
    expect(sanitizeProfile(null)).toBeNull();
    expect(sanitizeProfile("text")).toBeNull();
    expect(sanitizeProfile({ books: {} })).toBeNull();
    const repaired = sanitizeProfile({
      version: 2,
      core: { updatedAt: "2026-09-01T00:00:00Z", base: { wpm: 99999, minutes: -4 }, timeOfDay: { evening: { ratio: 9, minutes: 3 } } },
      limits: { updatedAt: "2026-09-01T00:00:00Z", minWpm: 5, maxWpm: 5000 },
      books: {
        good: { updatedAt: "2026-09-01T00:00:00Z", wpm: 250, minutes: 3, difficulty: 7, words: 10, genres: ["x", 4] },
        noStamp: { wpm: 250 },
        noPace: { updatedAt: "2026-09-01T00:00:00Z", wpm: "fast" }
      }
    });
    expect(repaired?.core.base).toEqual({ wpm: 700, minutes: 0 });
    expect(repaired?.core.timeOfDay.evening?.ratio).toBe(1.6);
    expect(repaired && paceLimits(repaired)).toEqual({ minWpm: 60, maxWpm: 900 });
    expect(Object.keys(repaired?.books ?? {})).toEqual(["good"]);
    expect(repaired?.books.good.difficulty).toBe(1.7);
    expect(repaired?.books.good.genres).toEqual(["x"]);
  });

  it("brings over the old Smart Read profile, but not its old default ceiling", () => {
    const legacy = {
      version: 1,
      global: { wpm: 262, samples: 30 },
      timeBands: { evening: { wpm: 290, samples: 6 }, morning: { wpm: 262, samples: 0 } }
    };
    const migrated = migrateLegacyProfile(legacy, null, iso(T0));
    expect(migrated?.core.base).toEqual({ wpm: 262, minutes: 15 });
    expect(migrated?.core.timeOfDay.evening?.ratio).toBeCloseTo(290 / 262, 5);
    expect(migrated?.core.timeOfDay.morning).toBeUndefined();
    expect(migrated && paceLimits(migrated).maxWpm).toBe(700);
    const tuned = migrateLegacyProfile(legacy, { minWpm: 150, maxWpm: 450 }, iso(T0));
    expect(tuned && paceLimits(tuned)).toEqual({ minWpm: 150, maxWpm: 450 });
    expect(migrateLegacyProfile(null, null, iso(T0))).toBeNull();
  });
});

describe("text difficulty", () => {
  const words = (count: number, difficulty: number, sentenceLength: number) =>
    Array.from({ length: count }, (_, index) => ({ difficulty, sentenceEnd: (index + 1) % sentenceLength === 0 }));

  it("rates short words in short sentences easy and long ones in long sentences demanding", () => {
    const children = estimateTextDifficulty(words(300, 1.0, 7));
    const novel = estimateTextDifficulty(words(300, 1.05, 14));
    const academic = estimateTextDifficulty(words(300, 1.14, 30));
    expect(difficultyBand(children)).toBe("easy");
    expect(difficultyBand(novel)).toBe("standard");
    expect(difficultyBand(academic)).toBe("demanding");
    expect(children).toBeLessThan(novel);
    expect(novel).toBeLessThan(academic);
  });

  it("gives a typical rating when there is too little text to tell", () => {
    expect(estimateTextDifficulty(words(10, 1.5, 40))).toBeCloseTo(1.06, 5);
  });
});

describe("the pace card", () => {
  it("reports an overall pace, and per band once a band has enough reading", () => {
    let profile = readFor(createReadingProfile(), "light", 330, 10, { difficulty: 0.95 });
    profile = readFor(profile, "novel", 250, 10, { difficulty: 1.06, start: T0 + 3_600_000 });
    const card = describePace(profile, T0 + 7_200_000);
    expect(card.books).toBe(2);
    expect(card.minutes).toBeGreaterThanOrEqual(19);
    expect(card.bands.easy).toBeGreaterThan(card.bands.standard ?? 0);
    expect(card.bands.demanding).toBeUndefined();
    expect(card.wpm).toBeGreaterThan(200);
  });
});
