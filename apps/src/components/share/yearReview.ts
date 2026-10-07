/**
 * A year of reading, in the figures Leaflet already keeps: the day ledger
 * (minutes a day), the focus sessions, the books and how far each was read,
 * and the reader's highlights and looked-up words. Nothing new is recorded
 * for it and nothing leaves the device: it is a sum.
 *
 * Pure: records in, figures out.
 */
import { finishedOn, hasFinished } from "../../constants/books";

type Day = { dateKey: string; minutes: number };
type Session = { startedAt: string; minutes: number };
type BookRead = {
  id: string;
  title: string;
  author: string | null;
  genres?: string[];
  progress: number;
  progressUpdatedAt?: string | null;
  finishedAt?: string | null;
  lastOpened: string | null;
};

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export type YearReview = {
  year: number;
  minutes: number;
  daysRead: number;
  /** The most days read in a row, within the year. */
  longestRun: number;
  bestDay: Day | null;
  /** Minutes in each month, January first. */
  byMonth: number[];
  /** The month most was read in (0 for January); null in a year with no reading. */
  busiestMonth: number | null;
  /** Books finished in the year, the latest first. */
  finished: Array<{ title: string; author: string | null }>;
  /** Books read in at all. */
  booksRead: number;
  sessions: number;
  /** When in the day the focus sessions mostly were; null with too few to say. */
  timeOfDay: TimeOfDay | null;
  /** The author most books were read of, when it is more than one book. */
  topAuthor: string | null;
  topGenre: string | null;
  highlights: number;
  words: number;
  /** Nothing was read: there is no review to show. */
  empty: boolean;
};

const inYear = (iso: string | null | undefined, year: number) => {
  if (!iso) {
    return false;
  }
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && date.getFullYear() === year;
};

/** The day after a `YYYY-MM-DD`, as one. */
const nextDay = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(year, month - 1, day + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
};

const most = (values: string[]): { value: string; count: number } | null => {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: { value: string; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) {
      best = { value, count };
    }
  }
  return best;
};

const hourBand = (hour: number): TimeOfDay => (hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 22 ? "evening" : "night");

/** The years there is any reading in, the latest first. */
export const yearsRead = (days: Day[]): number[] => {
  const years = new Set<number>();
  for (const day of days) {
    const year = Number(day.dateKey.slice(0, 4));
    if (day.minutes > 0 && Number.isInteger(year)) {
      years.add(year);
    }
  }
  return [...years].sort((a, b) => b - a);
};

export const yearReview = (
  year: number,
  records: { days: Day[]; sessions: Session[]; books: BookRead[]; highlights?: number; words?: number }
): YearReview => {
  const prefix = `${year}-`;
  const days = records.days.filter((day) => day.dateKey.startsWith(prefix) && day.minutes > 0).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const minutes = Math.round(days.reduce((sum, day) => sum + day.minutes, 0));

  let longestRun = 0;
  let run = 0;
  let previous: string | null = null;
  let bestDay: Day | null = null;
  const byMonth = Array.from({ length: 12 }, () => 0);
  for (const day of days) {
    run = previous !== null && nextDay(previous) === day.dateKey ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
    previous = day.dateKey;
    if (!bestDay || day.minutes > bestDay.minutes) {
      bestDay = day;
    }
    const month = Number(day.dateKey.slice(5, 7)) - 1;
    if (month >= 0 && month < 12) {
      byMonth[month] += day.minutes;
    }
  }
  const top = Math.max(...byMonth);

  // A book counts for the year its reading last moved in; one only opened, the year it was opened.
  const touched = records.books.filter((book) => book.progress > 0 && inYear(book.progressUpdatedAt ?? book.lastOpened, year));
  // Finished in the year by its finished date, which a second reading in a
  // later year does not move (and which is the progress stamp for a book
  // finished before the date was kept).
  const finished = records.books
    .filter((book) => hasFinished(book) && inYear(finishedOn(book), year))
    .sort((a, b) => (finishedOn(b) ?? "").localeCompare(finishedOn(a) ?? ""))
    .map((book) => ({ title: book.title, author: book.author }));

  const sessions = records.sessions.filter((session) => inYear(session.startedAt, year) && session.minutes > 0);
  // By minutes, not by count: an hour in the evening outweighs two five-minute mornings.
  const bands = new Map<TimeOfDay, number>();
  for (const session of sessions) {
    const band = hourBand(new Date(session.startedAt).getHours());
    bands.set(band, (bands.get(band) ?? 0) + session.minutes);
  }
  const timeOfDay = sessions.length >= 5 ? ([...bands].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) : null;

  const author = most(touched.map((book) => (book.author ?? "").trim()).filter(Boolean));
  const genre = most(touched.flatMap((book) => (book.genres ?? []).slice(0, 2)).filter(Boolean));

  return {
    year,
    minutes,
    daysRead: days.length,
    longestRun,
    bestDay,
    byMonth: byMonth.map((value) => Math.round(value)),
    busiestMonth: top > 0 ? byMonth.indexOf(top) : null,
    finished,
    booksRead: touched.length,
    sessions: sessions.length,
    timeOfDay,
    topAuthor: author && author.count >= 2 ? author.value : null,
    topGenre: genre && genre.count >= 2 ? genre.value : null,
    highlights: records.highlights ?? 0,
    words: records.words ?? 0,
    empty: minutes === 0 && finished.length === 0
  };
};

/** "42 hours", "1 hour", "35 minutes": time read, as it is said. */
export const timeWords = (minutes: number) => {
  if (minutes < 90) {
    return `${Math.round(minutes)} ${Math.round(minutes) === 1 ? "minute" : "minutes"}`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours.toLocaleString()} ${hours === 1 ? "hour" : "hours"}`;
};

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "14 March": a day of the year, without the year. */
export const dayWords = (dateKey: string) => {
  const [, month, day] = dateKey.split("-").map(Number);
  return month >= 1 && month <= 12 ? `${day} ${MONTHS[month - 1]}` : dateKey;
};
