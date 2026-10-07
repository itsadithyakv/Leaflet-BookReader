/**
 * A goal of books to finish in the year, and how the reader stands against
 * it. The count is of finished dates in the year (`finishedOn`), so a book
 * read again does not count twice in one year or move out of the year it was
 * finished in.
 *
 * The goal is the reader's own and is kept on this device, per year: a goal
 * set for one year says nothing about the next.
 */
import { finishedOn, hasFinished } from "../../constants/books";

const KEY = "leaflet.goal.booksPerYear";
export const MAX_YEAR_GOAL = 365;

type Finishable = Parameters<typeof finishedOn>[0];

/** How many books were finished in `year`. */
export const finishedInYear = (books: Finishable[], year: number) =>
  books.filter((book) => {
    const on = hasFinished(book) ? finishedOn(book) : null;
    return on !== null && new Date(on).getFullYear() === year;
  }).length;

/** A goal as it may be kept: a whole number from 1 to a book a day, or none. */
export const cleanGoal = (value: unknown): number | null => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 1 ? Math.min(MAX_YEAR_GOAL, number) : null;
};

/**
 * A goal as kept: how many books, the day it was set, and how many were
 * finished by then. The pace runs from that day, not from January: a goal of
 * twenty set in October is not eight behind on the day it is set.
 */
export type YearGoal = { goal: number; since: string; had: number };

const dateKey = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

const readAll = (): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const yearGoal = (year: number): YearGoal | null => {
  const kept = readAll()[String(year)];
  // A bare number is a goal from the first days of this feature: since New Year.
  const record = (typeof kept === "object" && kept !== null ? kept : { goal: kept }) as Partial<YearGoal>;
  const goal = cleanGoal(record.goal);
  if (goal === null) {
    return null;
  }
  const since = typeof record.since === "string" && record.since.startsWith(`${year}-`) ? record.since : `${year}-01-01`;
  const had = Number.isFinite(record.had) && (record.had as number) > 0 ? Math.floor(record.had as number) : 0;
  return { goal, since, had };
};

/** Sets the goal (or takes it away) as of `now`, with `finished` books already done this year. */
export const setYearGoal = (year: number, goal: number | null, now: Date, finished: number): YearGoal | null => {
  const all = readAll();
  const kept = cleanGoal(goal);
  const record = kept === null ? null : { goal: kept, since: now.getFullYear() === year ? dateKey(now) : `${year}-01-01`, had: Math.max(0, Math.floor(finished)) };
  if (record === null) {
    delete all[String(year)];
  } else {
    all[String(year)] = record;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Kept for now, then.
  }
  return record;
};

const dayOfYear = (now: Date) => Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 0)) / 86_400_000);
const daysInYear = (year: number) => ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365);

export type GoalStanding = {
  /** How far along, from 0 to 1. */
  share: number;
  /** A few words on the pace; none when there is nothing to say yet. */
  words: string | null;
};

/**
 * Where `finished` books stand against the goal on `now`, for `year`. The
 * pace is what was left to read when the goal was set, spread evenly over
 * what was left of the year; a year that is over has no pace, only a result.
 */
export const goalStanding = (finished: number, kept: YearGoal, year: number, now: Date): GoalStanding => {
  const { goal } = kept;
  const share = Math.max(0, Math.min(1, finished / goal));
  if (finished >= goal) {
    return { share, words: finished > goal ? `${finished - goal} over` : "Done" };
  }
  if (now.getFullYear() !== year) {
    return { share, words: null };
  }
  const [, month, day] = kept.since.split("-").map(Number);
  const from = dayOfYear(new Date(year, (month || 1) - 1, day || 1));
  const left = Math.max(1, daysInYear(year) - from);
  const had = Math.min(kept.had, goal);
  const due = had + ((goal - had) * Math.max(0, dayOfYear(now) - from)) / left;
  const ahead = finished - due;
  // Within a book of the pace is on it: nobody is "0 behind".
  if (Math.abs(ahead) < 1) {
    return { share, words: "On pace" };
  }
  const books = Math.floor(Math.abs(ahead));
  return { share, words: ahead > 0 ? `${books} ahead` : `${books} behind` };
};
