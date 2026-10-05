/**
 * What is known about each day, for Pip's diary to be written from.
 *
 * Nothing here is stored. A day's facts are worked out from what the app
 * already keeps and backs up:
 *
 * - the ledger (`reading_days`): the minutes read, the goal that day, a freeze
 *   or grace spent on it;
 * - the shelf (`focus_sessions`): which book a session was for, how long, and
 *   whether it ran to the end without leaving;
 * - the books: how far each is and when it last moved (so the day a book was
 *   finished, or where the bookmark was left, is known for the last day it
 *   moved, and for no day before that);
 * - the annotations, by the day they were made: a highlight, a character
 *   written on a sheet, a word looked up.
 *
 * What is not known is not guessed: there are no page counts anywhere, and a
 * book read with no session, no mark and no progress that day leaves only its
 * minutes.
 *
 * Pure: no clock, no storage. The one thing taken from outside is how an
 * instant falls on the reader's calendar (`clock`).
 */
import { isFinished } from "../../constants/books";
import type { DayRecord, FocusSessionRecord, FreeReadRecord } from "../../services/habitService";
import { nodFor } from "../bookNods";
import { isStreakMilestone } from "../moments";
import { dayKey, dayNumber } from "./seed";

/** A book, as far as the diary needs it. */
export type DiaryBookRow = {
  id: string;
  title: string;
  author?: string | null;
  progress: number;
  /** When `progress` last changed. */
  progressUpdatedAt?: string | null;
  lastOpened?: string | null;
};

/** A highlight, a character or a word, by the day it was made (`commands/diary.rs`). */
export type DiaryMarkRow = {
  id: string;
  bookId: string;
  kind: string;
  /** A highlight's first words, a character's name, the word looked up. */
  words?: string | null;
  /** The row's own JSON, for a character (`p`: how far through the book; `from`: carried from another book). */
  detail?: string | null;
  chapter?: string | null;
  hasPlace: boolean;
  createdAt: string;
};

export type DiarySource = {
  days: DayRecord[];
  sessions: FocusSessionRecord[];
  freeReads: FreeReadRecord[];
  books: DiaryBookRow[];
  marks: DiaryMarkRow[];
};

/** Where an instant falls for the reader: their own calendar day and hour. */
export type Clock = (iso: string) => { dateKey: string; hour: number } | null;

export const localClock: Clock = (iso) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return null;
  }
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return { dateKey: `${at.getFullYear()}-${month}-${day}`, hour: at.getHours() };
};

export type BookOfDay = {
  id: string | null;
  /** As the diary writes it: the name without its subtitle. */
  title: string;
  /** Minutes of focus sessions for it that day (0 when it is known some other way). */
  minutes: number;
  /** Where the bookmark was left, when this is the day the book last moved. */
  percent: number | null;
  /** The book reached its end on this day. */
  finished: boolean;
  /** One of Pip's own lines about this book, when it is one she knows (`bookNods.ts`). */
  nod: string | null;
};

export type DayFacts = {
  dateKey: string;
  /** Whole minutes the ledger holds for the day. */
  minutes: number;
  /** A minute or more was read. */
  read: boolean;
  goal: number;
  goalMet: boolean;
  /** A day not read, kept in the streak by a freeze or by grace. */
  covered: "freeze" | "grace" | null;
  /** The streak as it stood on this day (0 on a day that did not count). */
  run: number;
  /** The run is one of the streak's milestones (3, 7, 10...). */
  milestone: boolean;
  /** The streak passed the longest one before it on this day. */
  record: boolean;
  /** The first day anything was read. */
  first: boolean;
  /** Days since the last day read before this one (1: the day before; 0: there was none). */
  gap: number;
  /** The books known to have been read, the most certain first. */
  books: BookOfDay[];
  focus: { count: number; minutes: number; clean: number };
  /** Minutes read with no focus session running. */
  freeMinutes: number;
  highlights: Array<{ text: string; book: string | null; chapter: string | null }>;
  /** Characters the reader wrote down that day, from places they have read. */
  people: Array<{ name: string; book: string | null }>;
  words: string[];
  /** Something happened between 23:00 and 04:00. */
  late: boolean;
  /** Something happened between 04:00 and 07:00. */
  early: boolean;
};

export type DiaryFacts = {
  /** The first day anything was read: the diary's first page. Null with nothing read yet. */
  first: string | null;
  /** Every day from the first to today, rest days included. */
  days: DayFacts[];
};

/** A title as Pip would write it: without the subtitle, the series in brackets, or a file's leftovers. */
export const shortTitle = (title: string | null | undefined): string | null => {
  const whole = (title ?? "").replace(/\s+/g, " ").trim();
  if (!whole) {
    return null;
  }
  const cut = whole.split(/\s*(?:[:;(\[]|\s[-–—]\s)/u)[0].trim();
  const name = cut.length >= 2 ? cut : whole;
  return name.length > 44 ? `${name.slice(0, 43).trimEnd()}…` : name;
};

const tidy = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/** How far through its book a character was written down, and whether it came from another book. */
const personDetail = (detail: string | null | undefined): { p: number; carried: boolean } | null => {
  try {
    const parsed: unknown = JSON.parse(detail ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const { p, from } = parsed as { p?: unknown; from?: unknown };
    if (typeof p !== "number" || !Number.isFinite(p)) {
      return null;
    }
    return { p, carried: typeof from === "string" && from.length > 0 };
  } catch {
    return null;
  }
};

const LATE = (hour: number) => hour >= 23 || hour < 4;
const EARLY = (hour: number) => hour >= 4 && hour < 7;
/** Progress is a quotient of sizes: this forgives its rounding, not a page. */
const EPSILON = 1e-6;

/**
 * Every day's facts, from the first day read to `todayKey`.
 */
export const diaryFacts = (source: DiarySource, todayKey: string, clock: Clock = localClock): DiaryFacts => {
  const ledger = new Map<string, DayRecord>();
  for (const day of source.days) {
    ledger.set(day.dateKey, day);
  }
  const today = dayNumber(todayKey);
  const readDays = source.days
    .filter((day) => day.minutes >= 1 && Number.isFinite(dayNumber(day.dateKey)) && dayNumber(day.dateKey) <= today)
    .map((day) => dayNumber(day.dateKey))
    .sort((a, b) => a - b);
  if (readDays.length === 0 || !Number.isFinite(today)) {
    return { first: null, days: [] };
  }
  const first = readDays[0];

  const books = new Map(source.books.map((book) => [book.id, book]));
  const titleOf = (id: string | null | undefined) => (id ? shortTitle(books.get(id)?.title) : null);

  // The shelf, by the day each session is shelved under.
  const sessionsOn = new Map<string, FocusSessionRecord[]>();
  for (const session of source.sessions) {
    if (session.minutes >= 1) {
      sessionsOn.set(session.dateKey, [...(sessionsOn.get(session.dateKey) ?? []), session]);
    }
  }
  const freeOn = new Map(source.freeReads.map((entry) => [entry.dateKey, entry.minutes]));

  // Marks, and the books that moved or were opened, by the day they fall on.
  const marksOn = new Map<string, DiaryMarkRow[]>();
  const hoursOn = new Map<string, number[]>();
  const noteHour = (dateKey: string, hour: number) => hoursOn.set(dateKey, [...(hoursOn.get(dateKey) ?? []), hour]);
  for (const mark of source.marks) {
    const at = clock(mark.createdAt);
    if (at) {
      marksOn.set(at.dateKey, [...(marksOn.get(at.dateKey) ?? []), mark]);
      noteHour(at.dateKey, at.hour);
    }
  }
  const movedOn = new Map<string, DiaryBookRow[]>();
  const openedOn = new Map<string, DiaryBookRow[]>();
  for (const book of source.books) {
    const moved = book.progressUpdatedAt ? clock(book.progressUpdatedAt) : null;
    if (moved && book.progress > 0) {
      movedOn.set(moved.dateKey, [...(movedOn.get(moved.dateKey) ?? []), book]);
      noteHour(moved.dateKey, moved.hour);
    }
    const opened = book.lastOpened ? clock(book.lastOpened) : null;
    if (opened) {
      openedOn.set(opened.dateKey, [...(openedOn.get(opened.dateKey) ?? []), book]);
    }
  }
  for (const [dateKey, list] of sessionsOn) {
    for (const session of list) {
      const started = clock(session.startedAt);
      // A session read across midnight is shelved under the day it ended; its start is the night before.
      if (started && started.dateKey === dateKey) {
        noteHour(dateKey, started.hour);
      }
      const ended = clock(session.endedAt);
      if (ended && ended.dateKey === dateKey) {
        noteHour(dateKey, ended.hour);
      }
    }
  }

  const days: DayFacts[] = [];
  let run = 0;
  /** The longest streak that has ended. */
  let best = 0;
  let lastRead: number | null = null;
  for (let day = first; day <= today; day += 1) {
    const dateKey = dayKey(day);
    const record = ledger.get(dateKey);
    const minutes = Math.floor((record?.minutes ?? 0) + EPSILON);
    const read = minutes >= 1;
    const goal = record?.goalMinutes ?? 0;
    const goalMet = goal > 0 && (record?.minutes ?? 0) >= goal;
    const covered = !goalMet && record?.freezeUsed ? "freeze" : !goalMet && record?.graceUsed ? "grace" : null;
    if (goalMet || covered) {
      run += 1;
    } else {
      // A day that did not count ends the run (today, not yet read, is simply not in one).
      best = Math.max(best, run);
      run = 0;
    }
    // The day a streak passes the longest one before it: once, not every day after.
    const newRecord = goalMet && best >= 2 && run === best + 1;

    // The books: a session names its book; a book that moved, a book marked, a book opened.
    const found = new Map<string, BookOfDay>();
    const add = (id: string | null, rawTitle: string | null | undefined, sessionMinutes = 0) => {
      const title = shortTitle(rawTitle) ?? titleOf(id);
      if (!title) {
        return;
      }
      const key = id ?? `title:${title.toLowerCase()}`;
      const known = found.get(key);
      if (known) {
        known.minutes += sessionMinutes;
        return;
      }
      const row = id ? books.get(id) : undefined;
      const movedToday = Boolean(row && movedOn.get(dateKey)?.includes(row));
      found.set(key, {
        id,
        title,
        minutes: sessionMinutes,
        percent: row && movedToday ? Math.min(100, Math.max(0, Math.round(row.progress * 100))) : null,
        finished: Boolean(row && movedToday && isFinished(row.progress)),
        // The day picks which of her lines, so two days on one book differ.
        nod: nodFor({ title: row?.title ?? rawTitle, author: row?.author }, day * 7)?.line ?? null
      });
    };
    const sessions = sessionsOn.get(dateKey) ?? [];
    for (const session of [...sessions].sort((a, b) => b.minutes - a.minutes || a.id.localeCompare(b.id))) {
      add(session.bookId, session.title ?? books.get(session.bookId ?? "")?.title, Math.floor(session.minutes));
    }
    const marks = marksOn.get(dateKey) ?? [];
    if (read) {
      const byTitle = (a: DiaryBookRow, b: DiaryBookRow) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
      for (const book of [...(movedOn.get(dateKey) ?? [])].sort(byTitle)) {
        add(book.id, book.title);
      }
      for (const mark of marks) {
        add(mark.bookId, books.get(mark.bookId)?.title);
      }
      // Only when nothing surer is known: a book opened is not always a book read.
      if (found.size === 0) {
        for (const book of [...(openedOn.get(dateKey) ?? [])].sort(byTitle)) {
          add(book.id, book.title);
        }
      }
    }

    const people: DayFacts["people"] = [];
    const highlights: DayFacts["highlights"] = [];
    const words: string[] = [];
    for (const mark of marks) {
      const text = tidy(mark.words);
      if (!text) {
        continue;
      }
      if (mark.kind === "highlight") {
        highlights.push({ text, book: titleOf(mark.bookId), chapter: tidy(mark.chapter) || null });
      } else if (mark.kind === "word") {
        if (!words.includes(text)) {
          words.push(text);
        }
      } else if (mark.kind === "person") {
        // Only someone the reader has met: written at a place, in this book,
        // no further on than the book has been read. A sheet brought in from a
        // friend or an earlier book names nobody here.
        const detail = personDetail(mark.detail);
        const book = books.get(mark.bookId);
        if (detail && !detail.carried && mark.hasPlace && book && detail.p <= book.progress + EPSILON) {
          people.push({ name: text.slice(0, 40), book: titleOf(mark.bookId) });
        }
      }
    }

    const hours = hoursOn.get(dateKey) ?? [];
    days.push({
      dateKey,
      minutes,
      read,
      goal,
      goalMet,
      covered,
      run: goalMet || covered ? run : 0,
      milestone: goalMet && isStreakMilestone(run),
      record: newRecord,
      first: day === first,
      gap: read && lastRead !== null ? day - lastRead : 0,
      books: [...found.values()],
      focus: {
        count: sessions.length,
        minutes: Math.floor(sessions.reduce((sum, session) => sum + session.minutes, 0)),
        clean: sessions.filter((session) => session.clean && session.endedReason === "completed").length
      },
      freeMinutes: Math.floor(freeOn.get(dateKey) ?? 0),
      highlights,
      people,
      words,
      late: read && hours.some(LATE),
      early: read && hours.some(EARLY)
    });
    if (read) {
      lastRead = day;
    }
  }
  return { first: dayKey(first), days };
};
