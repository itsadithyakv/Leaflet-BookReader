/**
 * A week of the diary, summed up for its postcard: the days read, the
 * minutes, the books, and the best line Pip wrote that week.
 *
 * Weeks run Monday to Sunday, as the reading calendar's do.
 *
 * Pure: no clock, no storage.
 */
import type { DiaryEntry } from "./entry";
import type { DayFacts, DiaryFacts } from "./facts";
import { dayKey, dayNumber } from "./seed";

export type WeekDay = {
  dateKey: string;
  minutes: number;
  read: boolean;
  goalMet: boolean;
  /** A day the diary covers: from the first day read to today. */
  inDiary: boolean;
};

export type WeekSummary = {
  /** The Monday and the Sunday. */
  start: string;
  end: string;
  days: WeekDay[];
  daysRead: number;
  minutes: number;
  /** The books read, by name, the most read (in focus sessions) first. */
  books: string[];
  finished: string[];
  sessions: number;
  highlights: number;
  /** The entry worth a postcard, or null in a week with nothing read. */
  best: { dateKey: string; text: string } | null;
};

/** The Monday of the week a day is in. */
export const weekStart = (dateKey: string): string => {
  const day = dayNumber(dateKey);
  // Day 0 (1 January 1970) was a Thursday.
  return dayKey(day - ((((day + 3) % 7) + 7) % 7));
};

/** What makes a day's entry the one to put on the card. */
const LEAD_WORTH: Partial<Record<DiaryEntry["kind"], number>> = { finished: 100, first: 70, big: 45, back: 30 };
const PART_WORTH: Record<string, number> = {
  person: 50,
  record: 45,
  milestone: 40,
  highlight: 35,
  word: 25,
  nod: 20,
  late: 12,
  early: 12,
  clean: 10
};

const worth = (entry: DiaryEntry, facts: DayFacts) =>
  (LEAD_WORTH[entry.kind] ?? 10) +
  entry.parts.reduce((sum, part) => sum + (PART_WORTH[part.kind] ?? 0), 0) +
  Math.min(facts.minutes, 180) / 20;

/** The week beginning on `start` (a Monday), from the diary's facts and entries. */
export const weekSummary = (facts: DiaryFacts, entries: DiaryEntry[], start: string): WeekSummary => {
  const first = dayNumber(start);
  const byDay = new Map(facts.days.map((day) => [day.dateKey, day]));
  const entryOf = new Map(entries.map((entry) => [entry.dateKey, entry]));
  const days: WeekDay[] = [];
  const bookMinutes = new Map<string, number>();
  const finished: string[] = [];
  let best: { dateKey: string; text: string; worth: number } | null = null;
  let sessions = 0;
  let highlights = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const dateKey = dayKey(first + offset);
    const day = byDay.get(dateKey);
    days.push({ dateKey, minutes: day?.minutes ?? 0, read: day?.read ?? false, goalMet: day?.goalMet ?? false, inDiary: Boolean(day) });
    if (!day?.read) {
      continue;
    }
    sessions += day.focus.count;
    highlights += day.highlights.length;
    for (const book of day.books) {
      bookMinutes.set(book.title, (bookMinutes.get(book.title) ?? 0) + book.minutes);
      if (book.finished && !finished.includes(book.title)) {
        finished.push(book.title);
      }
    }
    const entry = entryOf.get(dateKey);
    if (entry && !entry.rest) {
      const value = worth(entry, day);
      if (!best || value > best.worth) {
        best = { dateKey, text: entry.text, worth: value };
      }
    }
  }
  // The most read first; books known only by a mark or a bookmark keep the order they were met in.
  const books = [...bookMinutes.entries()].sort((a, b) => b[1] - a[1]).map(([title]) => title);
  return {
    start,
    end: dayKey(first + 6),
    days,
    daysRead: days.filter((day) => day.read).length,
    minutes: days.reduce((sum, day) => sum + day.minutes, 0),
    books,
    finished,
    sessions,
    highlights,
    best: best ? { dateKey: best.dateKey, text: best.text } : null
  };
};

/** The weeks with anything read in them, oldest first, each by its Monday. */
export const diaryWeeks = (facts: DiaryFacts): string[] => {
  const weeks: string[] = [];
  for (const day of facts.days) {
    if (day.read) {
      const start = weekStart(day.dateKey);
      if (weeks[weeks.length - 1] !== start) {
        weeks.push(start);
      }
    }
  }
  return weeks;
};
