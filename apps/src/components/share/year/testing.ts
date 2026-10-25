/**
 * Years to test the story with: a full one, a late starter's, a small one and
 * an empty one, summed by the real `yearReview` from made-up records. For
 * tests only.
 */
import { yearReview, type YearReview } from "../yearReview";

const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const iso = (year: number, month: number, day: number, hour = 21) => new Date(year, month - 1, day, hour).toISOString();

/** Every day from `from` to `to` (inclusive, `YYYY-MM-DD`), every `every`th with `minutes` read. */
export const readingDays = (from: string, to: string, minutes: number, every = 1) => {
  const days: Array<{ dateKey: string; minutes: number }> = [];
  const [y, m, d] = from.split("-").map(Number);
  let at = 0;
  for (let date = new Date(y, m - 1, d); key(date) <= to; date.setDate(date.getDate() + 1), at++) {
    if (at % every === 0) days.push({ dateKey: key(date), minutes });
  }
  return days;
};

const BOOKS = [
  { id: "b1", title: "The Hound of the Baskervilles", author: "Arthur Conan Doyle", genres: ["Mystery"] },
  { id: "b2", title: "A Study in Scarlet", author: "Arthur Conan Doyle", genres: ["Mystery"] },
  { id: "b3", title: "Moby-Dick", author: "Herman Melville", genres: ["Adventure"] }
];

/** A reader here since before the year, with something for every scene. */
export const fullYear = (today = new Date(2027, 0, 3)): YearReview =>
  yearReview(2026, {
    days: [{ dateKey: "2025-05-01", minutes: 30 }, ...readingDays("2026-01-01", "2026-12-31", 40, 2), ...readingDays("2026-07-01", "2026-07-20", 50)],
    sessions: Array.from({ length: 12 }, (_, at) => ({ startedAt: iso(2026, 1 + at, 5, at % 3 === 0 ? 8 : 21), minutes: 40, bookId: "b1", title: "The Hound of the Baskervilles" })),
    books: BOOKS.map((book, at) => ({ ...book, progress: 1, progressUpdatedAt: iso(2026, 3 + at, 1), finishedAt: iso(2026, 3 + at, 1), lastOpened: iso(2026, 3 + at, 1) })),
    marks: [{ bookId: "b3", kind: "highlight", text: "It is not down in any map; true places never are.", note: "the whole year", createdAt: iso(2026, 6, 3) }],
    wordList: [{ word: "susurrus", meaning: "a soft rustling", count: 3, createdAt: iso(2026, 9, 2), lookedUpAt: iso(2026, 9, 4) }],
    cards: [{ createdAt: iso(2026, 4, 1), updatedAt: iso(2026, 5, 1), box: 4 }],
    camp: { minutes: 9000, camps: 3, strongholds: { stars: [3, 2, 1] }, banners: ["2026-05"] },
    today
  });

/** A reader who began on 1 September. */
export const lateYear = (today = new Date(2027, 0, 3)): YearReview =>
  yearReview(2026, {
    days: readingDays("2026-09-01", "2026-12-31", 30),
    sessions: [],
    books: [{ ...BOOKS[0], progress: 1, progressUpdatedAt: iso(2026, 11, 1), finishedAt: iso(2026, 11, 1), lastOpened: iso(2026, 11, 1) }],
    today
  });

/** A few minutes on a couple of days, from a reader here before. */
export const smallYear = (): YearReview =>
  yearReview(2026, { days: [{ dateKey: "2025-03-01", minutes: 10 }, { dateKey: "2026-04-02", minutes: 6 }, { dateKey: "2026-04-03", minutes: 9 }], sessions: [], books: [], today: new Date(2027, 0, 3) });

export const emptyYear = (): YearReview => yearReview(2024, { days: [{ dateKey: "2026-04-02", minutes: 6 }], sessions: [], books: [], today: new Date(2027, 0, 3) });
