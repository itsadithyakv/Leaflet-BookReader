import { describe, expect, it } from "vitest";
import type { Book } from "@shared/models/book";
import { seeded } from "./behaviour";
import {
  DUSTY_DAYS,
  HANGOVER_MS,
  LAST_STOP_KEY,
  MID_FROM,
  MID_TO,
  REALLY_READ_MS,
  STARTED_AT,
  STOP_FRESH_MS,
  chapterThrough,
  markStopSaid,
  midChapter,
  noteReadingPlace,
  parseStop,
  readStop,
  recordStop,
  stopRemark,
  worldOfBooks,
  type Stop
} from "./readingMoments";

const NOW = Date.parse("2026-10-04T20:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const book = (id: string, over: Partial<Book> = {}): Book => ({
  id,
  title: id,
  author: null,
  genres: [],
  coverUrl: null,
  localPath: "",
  fileHash: id,
  progress: 0,
  lastOpened: null,
  createdAt: ago(90 * DAY),
  ...over
});

/** A shelf that holds a string, as the browser's does. */
const shelf = () => {
  const kept = new Map<string, string>();
  return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), kept };
};

describe("the book last opened", () => {
  it("is the one opened most recently, with its mood and how long ago", () => {
    const world = worldOfBooks(
      [book("Emma", { genres: ["Romance"], lastOpened: ago(3 * DAY), progress: 0.4 }), book("It", { genres: ["Horror"], lastOpened: ago(30 * 60_000), progress: 0.2 }), book("Unread")],
      NOW
    );
    expect(world.book).toEqual({ title: "It", mood: "horror", readAgoMin: 30 });
  });

  it("is nothing in an empty library, or one never opened", () => {
    expect(worldOfBooks([], NOW)).toEqual({ book: null, hangover: null, dusty: null });
    expect(worldOfBooks([book("a"), book("b", { lastOpened: "not a date" })], NOW).book).toBeNull();
  });

  it("has no mood for a book that is none of hers", () => {
    expect(worldOfBooks([book("Cookery", { genres: ["Cooking"], lastOpened: ago(HOUR) })], NOW).book).toEqual({ title: "Cookery", mood: null, readAgoMin: 60 });
  });
});

describe("the book hangover", () => {
  it("is not brought back by opening an old finished book: it goes by when the progress last moved", () => {
    // Finished a month ago, opened again an hour ago for a look.
    expect(worldOfBooks([book("Old", { progress: 1, progressUpdatedAt: ago(30 * DAY), lastOpened: ago(HOUR) })], NOW).hangover).toBeNull();
    // Finished two hours ago; the stamp says so whatever else was opened since.
    const world = worldOfBooks(
      [book("Fresh", { progress: 1, progressUpdatedAt: ago(2 * HOUR), lastOpened: ago(2 * HOUR) }), book("Old", { progress: 1, progressUpdatedAt: ago(30 * DAY), lastOpened: ago(60_000) })],
      NOW
    );
    expect(world.hangover).toEqual({ title: "Fresh" });
    expect(world.book?.title).toBe("Old");
    // To the hour: a day, by the stamp.
    const stamped = (since: number) => worldOfBooks([book("B", { progress: 1, progressUpdatedAt: ago(since), lastOpened: ago(60_000) })], NOW).hangover;
    expect(stamped(HANGOVER_MS - 60_000)).toEqual({ title: "B" });
    expect(stamped(HANGOVER_MS)).toBeNull();
    // A stamp that cannot be read is no stamp: the old rule stands in.
    expect(worldOfBooks([book("B", { progress: 1, progressUpdatedAt: "soon", lastOpened: ago(HOUR) })], NOW).hangover).toEqual({ title: "B" });
    // A clock put back (a stamp in the future): nothing.
    expect(worldOfBooks([book("B", { progress: 1, progressUpdatedAt: ago(-HOUR), lastOpened: ago(HOUR) })], NOW).hangover).toBeNull();
  });

  it("without a stamp falls back on when the book was last opened: a day, and no longer", () => {
    const finished = (since: number) => worldOfBooks([book("Mistborn", { progress: 1, lastOpened: ago(since) })], NOW).hangover;
    expect(finished(5 * 60_000)).toEqual({ title: "Mistborn" });
    expect(finished(HANGOVER_MS - 60_000)).toEqual({ title: "Mistborn" });
    expect(finished(HANGOVER_MS)).toBeNull();
    expect(finished(3 * DAY)).toBeNull();
    expect(HANGOVER_MS).toBe(DAY);
  });

  it("is for a finished book only, by the app's own rule of finished", () => {
    expect(worldOfBooks([book("Nearly", { progress: 0.98, lastOpened: ago(HOUR) })], NOW).hangover).toBeNull();
    expect(worldOfBooks([book("Done", { progress: 0.99, lastOpened: ago(HOUR) })], NOW).hangover).toEqual({ title: "Done" });
  });

  it("is over the one finished last", () => {
    const world = worldOfBooks([book("First", { progress: 1, lastOpened: ago(20 * HOUR) }), book("Second", { progress: 1, lastOpened: ago(2 * HOUR) })], NOW);
    expect(world.hangover).toEqual({ title: "Second" });
  });
});

describe("the book she dusts", () => {
  it("was begun, is not finished, and has not been opened for a fortnight", () => {
    const dusty = (over: Partial<Book>) => worldOfBooks([book("Dune", { progress: 0.3, lastOpened: ago(20 * DAY), ...over })], NOW).dusty;
    expect(dusty({})).toEqual({ title: "Dune", days: 20 });
    expect(dusty({ lastOpened: ago(DUSTY_DAYS * DAY) })).toEqual({ title: "Dune", days: 14 });
    expect(dusty({ lastOpened: ago(DUSTY_DAYS * DAY - HOUR) })).toBeNull();
    // Only looked into: not past the first pages.
    expect(dusty({ progress: STARTED_AT - 0.01 })).toBeNull();
    expect(dusty({ progress: 0 })).toBeNull();
    expect(dusty({ progress: 1 })).toBeNull();
    expect(dusty({ lastOpened: null })).toBeNull();
  });

  it("is at most one: the one most recently put down", () => {
    const world = worldOfBooks(
      [
        book("Old", { progress: 0.5, lastOpened: ago(200 * DAY) }),
        book("Recent", { progress: 0.2, lastOpened: ago(16 * DAY) }),
        book("Older", { progress: 0.7, lastOpened: ago(40 * DAY) }),
        book("Reading", { progress: 0.4, lastOpened: ago(DAY) })
      ],
      NOW
    );
    expect(world.dusty).toEqual({ title: "Recent", days: 16 });
    expect(world.book?.title).toBe("Reading");
  });
});

describe("how far through a chapter", () => {
  // Six sections; the contents open chapters at 1, 2 and 4 (so the second chapter is sections 2 and 3).
  const bytes = [500, 4000, 3000, 1000, 6000, 800];
  const starts = [1, 2, 4];

  it("is the share of the chapter's sections read, by their size", () => {
    expect(chapterThrough(bytes, starts, 1, 0.5)).toBeCloseTo(0.5);
    expect(chapterThrough(bytes, starts, 2, 0)).toBe(0);
    expect(chapterThrough(bytes, starts, 2, 1)).toBeCloseTo(0.75);
    expect(chapterThrough(bytes, starts, 3, 0.5)).toBeCloseTo(3500 / 4000);
    // The last chapter runs to the end of the story, not into the back matter.
    expect(chapterThrough(bytes, starts, 4, 0.5, 4)).toBeCloseTo(0.5);
    expect(chapterThrough(bytes, starts, 4, 0.5)).toBeCloseTo(3000 / 6800);
  });

  it("takes each section as a chapter when the book has no contents", () => {
    expect(chapterThrough(bytes, [], 2, 0.4)).toBeCloseTo(0.4);
  });

  it("says nothing where there is nothing to measure", () => {
    expect(chapterThrough(bytes, starts, 9, 0.5)).toBeNull();
    expect(chapterThrough(bytes, starts, -1, 0.5)).toBeNull();
    expect(chapterThrough([0, 0], [0], 0, 0.5)).toBeNull();
    // A place past the end of a section, or before its start, is held to it.
    expect(chapterThrough(bytes, starts, 1, 7)).toBe(1);
    expect(chapterThrough(bytes, starts, 1, -3)).toBe(0);
  });
});

describe("stopped mid-chapter", () => {
  const stop = (over: Partial<Stop> = {}): Stop => ({ book: "b", at: NOW - 10 * 60_000, through: 0.5, readMs: 20 * 60_000, ...over });

  it("is a stop past a chapter's opening and not near its end, after really reading", () => {
    expect(midChapter(stop())).toBe(true);
    expect(midChapter(stop({ through: MID_FROM }))).toBe(true);
    expect(midChapter(stop({ through: MID_TO }))).toBe(true);
    expect(midChapter(stop({ through: MID_FROM - 0.01 }))).toBe(false);
    expect(midChapter(stop({ through: 0.9 }))).toBe(false);
    expect(midChapter(stop({ through: 1 }))).toBe(false);
    expect(midChapter(stop({ readMs: REALLY_READ_MS - 1 }))).toBe(false);
    expect(midChapter(stop({ readMs: REALLY_READ_MS }))).toBe(true);
  });

  it("gets a word on the next visit within the hour, once", () => {
    const rand = seeded(2);
    expect(stopRemark(stop(), NOW, rand)).toBeTruthy();
    expect(stopRemark(stop({ at: NOW - STOP_FRESH_MS }), NOW, rand)).toBeTruthy();
    expect(stopRemark(stop({ at: NOW - STOP_FRESH_MS - 1 }), NOW, rand)).toBeNull();
    expect(stopRemark(stop({ said: true }), NOW, rand)).toBeNull();
    expect(stopRemark(stop({ through: 0.95 }), NOW, rand)).toBeNull();
    expect(stopRemark(null, NOW, rand)).toBeNull();
    // A clock put back: nothing, rather than a remark about the future.
    expect(stopRemark(stop({ at: NOW + 60_000 }), NOW, rand)).toBeNull();
  });

  it("is said a few ways, short, in her own lower case, and the owner's line is one of them", () => {
    const rand = seeded(5);
    const said = new Set(Array.from({ length: 120 }, () => stopRemark(stop(), NOW, rand) as string));
    expect(said.size).toBeGreaterThanOrEqual(4);
    expect(said).toContain("you stopped *there*?");
    for (const line of said) {
      expect(line).toBe(line.toLowerCase());
      expect(line.replace(/\*/g, "").length).toBeLessThanOrEqual(44);
      expect(line).not.toMatch(/should|lazy|shame|disappoint/);
    }
  });

  it("is left by the reader on closing, from where the reading line was", () => {
    const kept = shelf();
    noteReadingPlace("b", 0.4123456);
    recordStop("b", NOW - 25 * 60_000, NOW, kept);
    expect(readStop(kept)).toEqual({ book: "b", at: NOW, through: 0.412, readMs: 25 * 60_000 });
    expect([...kept.kept.keys()]).toEqual([LAST_STOP_KEY]);
    // Said once: the record remembers.
    markStopSaid(readStop(kept) as Stop, kept);
    expect(readStop(kept)?.said).toBe(true);
    expect(stopRemark(readStop(kept), NOW + 60_000, seeded(1))).toBeNull();
  });

  it("leaves nothing when the place is not known, or is another book's", () => {
    const kept = shelf();
    recordStop("b", NOW - HOUR, NOW, kept);
    noteReadingPlace("b", null);
    recordStop("b", NOW - HOUR, NOW, kept);
    noteReadingPlace("other", 0.5);
    recordStop("b", NOW - HOUR, NOW, kept);
    expect(kept.kept.size).toBe(0);
    // And the place is used once: a second close of the same book writes nothing new.
    noteReadingPlace("b", 0.5);
    recordStop("b", NOW - HOUR, NOW, kept);
    recordStop("b", NOW - HOUR, NOW + 5, kept);
    expect(readStop(kept)?.at).toBe(NOW);
  });

  it("reads back only what it wrote", () => {
    expect(parseStop(null)).toBeNull();
    expect(parseStop("")).toBeNull();
    expect(parseStop("{")).toBeNull();
    expect(parseStop("null")).toBeNull();
    expect(parseStop(JSON.stringify({ book: "b", at: "soon", through: 0.5, readMs: 1 }))).toBeNull();
    expect(parseStop(JSON.stringify({ book: 4, at: 1, through: 0.5, readMs: 1 }))).toBeNull();
    expect(parseStop(JSON.stringify({ book: "b", at: 1, through: 0.5, readMs: 2, extra: true }))).toEqual({ book: "b", at: 1, through: 0.5, readMs: 2 });
    // A shelf that cannot be read holds no stop.
    expect(readStop({ getItem: () => { throw new Error("no"); } })).toBeNull();
    expect(readStop(null)).toBeNull();
  });
});
