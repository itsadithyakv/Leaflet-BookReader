import { describe, expect, it } from "vitest";
import { dayWords, timeWords, yearReview, yearsRead } from "./yearReview";

const day = (dateKey: string, minutes: number) => ({ dateKey, minutes });
const book = (id: string, fields: Partial<{ title: string; author: string | null; genres: string[]; progress: number; progressUpdatedAt: string | null; lastOpened: string | null }>) => ({
  id,
  title: fields.title ?? id,
  author: fields.author ?? null,
  genres: fields.genres ?? [],
  progress: fields.progress ?? 0,
  progressUpdatedAt: fields.progressUpdatedAt ?? null,
  lastOpened: fields.lastOpened ?? null
});
// Local times, as the reader's clock had them.
const at = (month: number, dayOfMonth: number, hour: number, year = 2026) => new Date(year, month - 1, dayOfMonth, hour, 0, 0).toISOString();

describe("a year of reading", () => {
  const days = [
    day("2025-12-31", 50),
    day("2026-01-01", 20),
    day("2026-01-02", 30),
    day("2026-01-03", 0),
    day("2026-03-10", 45),
    day("2026-03-11", 90),
    day("2026-03-12", 15),
    day("2026-12-31", 10),
    day("2027-01-01", 99)
  ];

  it("sums the year's days and no other's", () => {
    const review = yearReview(2026, { days, sessions: [], books: [] });
    expect(review.minutes).toBe(210);
    expect(review.daysRead).toBe(6);
    expect(review.empty).toBe(false);
  });

  it("finds the best day, the longest run of days and the busiest month", () => {
    const review = yearReview(2026, { days, sessions: [], books: [] });
    expect(review.bestDay).toEqual(day("2026-03-11", 90));
    // A day with nothing read ends a run; the run does not reach back into last year.
    expect(review.longestRun).toBe(3);
    expect(review.byMonth[0]).toBe(50);
    expect(review.byMonth[2]).toBe(150);
    expect(review.busiestMonth).toBe(2);
  });

  it("counts a run over a month's end", () => {
    const review = yearReview(2026, { days: [day("2026-02-27", 5), day("2026-02-28", 5), day("2026-03-01", 5), day("2026-03-02", 5)], sessions: [], books: [] });
    expect(review.longestRun).toBe(4);
  });

  it("lists the books finished in the year, the latest first, and counts those read in", () => {
    const books = [
      book("a", { title: "Early", progress: 1, progressUpdatedAt: at(2, 1, 9) }),
      book("b", { title: "Late", progress: 0.995, progressUpdatedAt: at(11, 1, 9) }),
      book("c", { title: "Half", progress: 0.5, progressUpdatedAt: at(6, 1, 9) }),
      book("d", { title: "Last year", progress: 1, progressUpdatedAt: at(6, 1, 9, 2025) }),
      book("e", { title: "Never opened", progress: 0, lastOpened: at(6, 1, 9) }),
      book("f", { title: "Only an opening date", progress: 0.3, lastOpened: at(7, 1, 9) })
    ];
    const review = yearReview(2026, { days, sessions: [], books });
    expect(review.finished.map((item) => item.title)).toEqual(["Late", "Early"]);
    expect(review.booksRead).toBe(4);
  });

  it("names the author and the kind most read, when it is more than one book", () => {
    const books = [
      book("a", { author: "Sanderson", genres: ["Fantasy"], progress: 0.5, progressUpdatedAt: at(2, 1, 9) }),
      book("b", { author: "Sanderson", genres: ["Fantasy", "Epic"], progress: 0.5, progressUpdatedAt: at(3, 1, 9) }),
      book("c", { author: "Herbert", genres: ["Science fiction"], progress: 0.5, progressUpdatedAt: at(4, 1, 9) })
    ];
    const review = yearReview(2026, { days, sessions: [], books });
    expect(review.topAuthor).toBe("Sanderson");
    expect(review.topGenre).toBe("Fantasy");
    expect(yearReview(2026, { days, sessions: [], books: books.slice(1) }).topAuthor).toBeNull();
  });

  it("says when in the day the sessions mostly were, by time and not by count, with enough to go on", () => {
    const sessions = [
      { startedAt: at(1, 5, 7), minutes: 5 },
      { startedAt: at(1, 6, 7), minutes: 5 },
      { startedAt: at(1, 7, 7), minutes: 5 },
      { startedAt: at(1, 8, 20), minutes: 60 },
      { startedAt: at(1, 9, 21), minutes: 45 }
    ];
    expect(yearReview(2026, { days, sessions, books: [] }).timeOfDay).toBe("evening");
    expect(yearReview(2026, { days, sessions: sessions.slice(0, 4), books: [] }).timeOfDay).toBeNull();
    expect(yearReview(2026, { days, sessions, books: [] }).sessions).toBe(5);
  });

  it("is empty for a year with no reading", () => {
    const review = yearReview(2024, { days, sessions: [], books: [] });
    expect(review).toMatchObject({ minutes: 0, daysRead: 0, longestRun: 0, bestDay: null, busiestMonth: null, empty: true });
  });

  it("carries the highlights and words it is given", () => {
    expect(yearReview(2026, { days, sessions: [], books: [], highlights: 12, words: 30 })).toMatchObject({ highlights: 12, words: 30 });
  });
});

describe("the years there is reading in", () => {
  it("are listed the latest first, without those of empty days", () => {
    expect(yearsRead([day("2025-12-31", 50), day("2026-01-01", 20), day("2024-05-05", 0), day("2026-02-01", 1)])).toEqual([2026, 2025]);
  });
});

describe("how the figures are said", () => {
  it("gives time in minutes, then in hours", () => {
    expect(timeWords(1)).toBe("1 minute");
    expect(timeWords(35)).toBe("35 minutes");
    expect(timeWords(95)).toBe("2 hours");
    expect(timeWords(60 * 1234)).toBe((1234).toLocaleString() + " hours");
  });

  it("gives a day without its year", () => {
    expect(dayWords("2026-03-11")).toBe("11 March");
  });
});
