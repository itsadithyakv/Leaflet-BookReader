import { describe, expect, it } from "vitest";
import { chapterOf } from "../../pip/base/chapters";
import { LEARNT_BOX, dayWords, framing, readerTypeOf, timeComparison, timeWords, yearReview, yearsRead } from "./yearReview";

const day = (dateKey: string, minutes: number) => ({ dateKey, minutes });
const book = (id: string, fields: Partial<{ title: string; author: string | null; genres: string[]; progress: number; progressUpdatedAt: string | null; lastOpened: string | null; finishedAt: string | null }>) => ({
  id,
  title: fields.title ?? id,
  author: fields.author ?? null,
  genres: fields.genres ?? [],
  progress: fields.progress ?? 0,
  progressUpdatedAt: fields.progressUpdatedAt ?? null,
  finishedAt: fields.finishedAt ?? null,
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

  it("keeps a book in the year it was finished when it is read again later", () => {
    const books = [
      // Finished in 2025, half way through a second reading in 2026.
      book("a", { title: "Read twice", progress: 0.5, progressUpdatedAt: at(4, 1, 9), finishedAt: at(8, 1, 9, 2025) }),
      // Marked "not started": no longer finished in any year.
      book("b", { title: "Taken back", progress: 0, progressUpdatedAt: at(4, 2, 9), finishedAt: "" }),
      book("c", { title: "This year", progress: 0.1, progressUpdatedAt: at(9, 1, 9), finishedAt: at(5, 1, 9) })
    ];
    expect(yearReview(2026, { days, sessions: [], books }).finished.map((item) => item.title)).toEqual(["This year"]);
    expect(yearReview(2025, { days, sessions: [], books }).finished.map((item) => item.title)).toEqual(["Read twice"]);
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

// ---- What the story adds to the sums --------------------------------------

const local = (year: number, month: number, dayOfMonth: number) => new Date(year, month - 1, dayOfMonth, 12, 0, 0);
/** Every day from one `YYYY-MM-DD` to another, each with `minutes` read. */
const everyDay = (from: string, to: string, minutes: number) => {
  const out: Array<{ dateKey: string; minutes: number }> = [];
  const [y, m, d] = from.split("-").map(Number);
  for (let date = new Date(y, m - 1, d); ; date.setDate(date.getDate() + 1)) {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    out.push(day(key, minutes));
    if (key >= to) {
      return out;
    }
  }
};
const dayLedger = [day("2025-12-31", 50), day("2026-01-01", 20), day("2026-03-11", 90)];

describe("the stretch the story speaks of", () => {
  const after = local(2027, 1, 3);

  it("is the whole year for a reader who was here before it began", () => {
    const review = yearReview(2026, { days: [day("2025-06-01", 20), day("2026-03-01", 30)], sessions: [], books: [], today: after });
    expect(review.span).toMatchObject({ kind: "year", from: "2026-01-01", to: "2026-12-31", soFar: false, firstMonth: 0, lastMonth: 11 });
    expect(framing(review)).toMatchObject({ big: ["2026", "in pages"], inSpan: "In 2026", mark: "2026 in pages" });
  });

  it("is the months since a reader's first day when they began in September", () => {
    const review = yearReview(2026, { days: everyDay("2026-09-01", "2026-12-31", 20), sessions: [], books: [], today: after });
    expect(review.span).toMatchObject({ kind: "months", from: "2026-09-01", months: 4, firstMonth: 8, lastMonth: 11 });
    expect(review.firstDay).toBe("2026-09-01");
    expect(review.lastDay).toBe("2026-12-31");
    const said = framing(review);
    expect(said.big).toEqual(["4 months", "in pages"]);
    expect(said.inSpan).toBe("In just 4 months");
    expect(said.mark).toBe("4 months in pages · 2026");
    // Per week over the four months, not the twelve.
    expect(review.perWeek).toBe(140);
  });

  it("is weeks for a reader who began in mid-December", () => {
    const review = yearReview(2026, { days: everyDay("2026-12-14", "2026-12-31", 15), sessions: [], books: [], today: after });
    expect(review.span).toMatchObject({ kind: "weeks", days: 18, weeks: 3 });
    expect(framing(review)).toMatchObject({ big: ["First weeks", "in pages"], inSpan: "In just 3 weeks", mark: "First weeks in pages · 2026" });
  });

  it("is days for a reader of a few days", () => {
    const review = yearReview(2026, { days: everyDay("2026-12-29", "2026-12-31", 15), sessions: [], books: [], today: after });
    expect(framing(review)).toMatchObject({ big: ["First days", "in pages"], inSpan: "In just 3 days" });
  });

  it("counts from the first day Leaflet knew of, when that is before the first read", () => {
    const review = yearReview(2026, { days: [day("2026-08-01", 0), ...everyDay("2026-09-01", "2026-12-31", 20)], sessions: [], books: [], today: after });
    expect(review.span).toMatchObject({ kind: "months", from: "2026-08-01", months: 5 });
  });

  it("stays the year for a February start with a gap and a return in September", () => {
    const review = yearReview(2026, {
      days: [...everyDay("2026-02-03", "2026-02-20", 25), ...everyDay("2026-09-10", "2026-10-01", 25)],
      sessions: [],
      books: [],
      today: after
    });
    expect(review.span.kind).toBe("year");
    expect(review.span.from).toBe("2026-02-03");
    expect(framing(review).big[0]).toBe("2026");
  });

  it("is the year so far before 31 December, and a late start's months up to today", () => {
    const early = yearReview(2026, { days: [day("2025-01-01", 5), day("2026-06-01", 30)], sessions: [], books: [], today: local(2026, 10, 25) });
    expect(early.span).toMatchObject({ kind: "year", to: "2026-10-25", soFar: true, lastMonth: 9 });
    expect(framing(early)).toMatchObject({ inSpan: "So far in 2026", mark: "2026 in pages · so far" });
    const late = yearReview(2026, { days: everyDay("2026-08-20", "2026-10-25", 10), sessions: [], books: [], today: local(2026, 10, 25) });
    expect(late.span).toMatchObject({ kind: "months", months: 2, soFar: true, firstMonth: 7, lastMonth: 9 });
    expect(framing(late).eyebrow).toBe("Your first");
    // On the 31st itself the year is whole.
    expect(yearReview(2026, { days: [day("2025-01-01", 5), day("2026-06-01", 30)], sessions: [], books: [], today: local(2026, 12, 31) }).span.soFar).toBe(false);
  });

  it("says a year of a few minutes plainly, with nothing made up", () => {
    const review = yearReview(2026, { days: [day("2025-03-01", 10), day("2026-04-02", 3), day("2026-04-03", 4)], sessions: [], books: [], today: after });
    expect(review).toMatchObject({ minutes: 7, daysRead: 2, longestRun: 2, longestRunFrom: "2026-04-02", empty: false, readerType: null, hollow: null, highlight: null, hardestWord: null });
    expect(review.comparison).toBeNull();
    expect(timeWords(review.minutes)).toBe("7 minutes");
  });
});

describe("the story's other figures", () => {
  it("compares the time honestly: the longest length held twice, rounded to the half under three", () => {
    expect(timeComparison(4)).toBeNull();
    expect(timeComparison(10)).toEqual({ count: 2, says: "about as long as 2 pots of tea, brewed and poured" });
    expect(timeComparison(5 * 60)).toEqual({ count: 2.5, says: "about as long as 2.5 films, back to back" });
    expect(timeComparison(31 * 60)?.says).toBe("about as long as 4 flights from London to New York");
    expect(timeComparison(200 * 60)).toEqual({ count: 2.5, says: "about as long as 2.5 trips to the Moon, the way Apollo 11 went" });
    expect(timeComparison(1000 * 60)).toEqual({ count: 6, says: "about as long as 6 rides on the Trans-Siberian, end to end" });
  });

  it("names a kind of reader from the kind of book read most, or else the time of day", () => {
    expect(readerTypeOf("Detective and mystery stories", null)?.name).toBe("The Night Detective");
    expect(readerTypeOf("Epic Fantasy", "night")?.name).toBe("The Map-Maker");
    expect(readerTypeOf("Science fiction", null)?.id).toBe("stars");
    expect(readerTypeOf("Popular science", null)?.id).toBe("curious");
    expect(readerTypeOf(null, "night")?.name).toBe("The Midnight Owl");
    expect(readerTypeOf("Cookery", null)).toBeNull();
    expect(readerTypeOf(null, null)).toBeNull();
  });

  it("finds the highlight of the year: one with a note first, then the longest that sets well", () => {
    const books = [book("a", { title: "Moby", author: "Melville", progress: 0.5, progressUpdatedAt: at(3, 1, 9) })];
    const marks = [
      { bookId: "a", kind: "highlight", text: "Call me Ishmael.", note: null, createdAt: at(3, 1, 9) },
      { bookId: "a", kind: "highlight", text: "It is not down on any map; true places never are.", note: null, createdAt: at(3, 2, 9) },
      { bookId: "a", kind: "highlight", text: "A short one", note: "loved this", createdAt: at(3, 3, 9) },
      { bookId: "a", kind: "bookmark", text: "not a highlight", note: null, createdAt: at(3, 4, 9) },
      { bookId: "a", kind: "highlight", text: "Last year's", note: "old", createdAt: at(3, 4, 9, 2025) }
    ];
    const review = yearReview(2026, { days: dayLedger, sessions: [], books, marks });
    expect(review.highlights).toBe(3);
    expect(review.highlight).toEqual({ text: "A short one", note: "loved this", title: "Moby", author: "Melville" });
    expect(review.highlightChoices.map((item) => item.text)).toEqual(["A short one", "It is not down on any map; true places never are.", "Call me Ishmael."]);
  });

  it("finds the hardest word: looked up most, else the longest", () => {
    const wordList = [
      { word: "sesquipedalian", meaning: "long-worded", count: 1, createdAt: at(2, 1, 9), lookedUpAt: at(2, 1, 9) },
      { word: "liminal", meaning: "at a threshold", count: 4, createdAt: at(2, 2, 9), lookedUpAt: at(5, 2, 9) },
      { word: "old", meaning: "from before", count: 9, createdAt: at(2, 2, 9, 2024), lookedUpAt: at(2, 2, 9, 2024) }
    ];
    expect(yearReview(2026, { days: dayLedger, sessions: [], books: [], wordList }).hardestWord).toEqual({ word: "liminal", meaning: "at a threshold", count: 4 });
    expect(yearReview(2026, { days: dayLedger, sessions: [], books: [], wordList: [wordList[0], { ...wordList[1], count: 1 }] }).hardestWord?.word).toBe("sesquipedalian");
    expect(yearReview(2026, { days: dayLedger, sessions: [], books: [], wordList }).words).toBe(2);
  });

  it("counts the cards made in the year and those learnt", () => {
    const cards = [
      { createdAt: at(3, 1, 9), updatedAt: at(4, 1, 9), box: 3 },
      { createdAt: at(3, 1, 9), updatedAt: at(4, 1, 9), box: 1 },
      { createdAt: at(3, 1, 9, 2025), updatedAt: at(5, 1, 9), box: 5 },
      { createdAt: at(3, 1, 9, 2025), updatedAt: at(5, 1, 9, 2025), box: 5 }
    ];
    expect(yearReview(2026, { days: dayLedger, sessions: [], books: [], cards })).toMatchObject({ cardsMade: 2, cardsLearnt: 2 });
    expect(LEARNT_BOX).toBe(3);
  });

  it("tells the Hollow's year: the chapters it climbed, its strongholds for the latest year, the year's banners", () => {
    const camp = { minutes: 3000, camps: 4, strongholds: { stars: [3, 2, 0, 1] }, banners: ["2026-03", "2026-07", "2025-11"] };
    const ledger = [day("2026-03-01", 2400), day("2027-01-02", 100)];
    const review = yearReview(2026, { days: ledger, sessions: [], books: [], camp, today: local(2027, 1, 3) });
    expect(review.hollow).toEqual({ chapterFrom: chapterOf(500), chapterTo: chapterOf(2900), strongholds: 4, stars: 6, banners: 2 });
    // An older year: its banners and chapters, but no strongholds (they keep no dates).
    const older = yearReview(2025, { days: [day("2025-05-01", 500), ...ledger], sessions: [], books: [], camp, today: local(2027, 1, 3) });
    expect(older.hollow).toMatchObject({ strongholds: null, stars: null, banners: 1 });
    expect(yearReview(2026, { days: ledger, sessions: [], books: [], camp: null }).hollow).toBeNull();
  });

  it("finds the share of time by the time of day, and the book come back to most", () => {
    const sessions = [
      { startedAt: at(1, 5, 23), minutes: 60, bookId: "a", title: "Dune" },
      { startedAt: at(1, 6, 22), minutes: 30, bookId: "a", title: "Dune" },
      { startedAt: at(1, 7, 23), minutes: 30, bookId: "a", title: "Dune" },
      { startedAt: at(1, 8, 9), minutes: 30, bookId: "b", title: "Emma" },
      { startedAt: at(1, 9, 14), minutes: 50, bookId: "b", title: "Emma" }
    ];
    const review = yearReview(2026, { days: dayLedger, sessions, books: [] });
    expect(review.dayShare).toEqual({ band: "night", percent: 60, bands: { morning: 15, afternoon: 25, evening: 0, night: 60 } });
    expect(review.mostReturned).toEqual({ title: "Dune", days: 3 });
  });
});
