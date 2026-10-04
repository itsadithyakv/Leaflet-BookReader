import {
  getDateKey,
  type DayRecord,
  type FocusSessionRecord,
  type FreeReadRecord
} from "../../services/habitService";
import { CLOTH, hash, inkFor, spineHeight, spineWidth } from "./spine";

/**
 * What stands on the session shelf, worked out from the habit snapshot: a row
 * per week, a spine per focus session, and loose pages for each day's reading
 * outside one. Pure, so the shelf's rules can be tested without drawing it.
 */

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PARCHMENT = "#eadfc4";

export const parseDateKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const mondayOf = (date: Date) => addDays(date, -((date.getDay() + 6) % 7));

export const shortDate = (date: Date, withYear = false) =>
  `${date.getDate()} ${MONTHS[date.getMonth()]}${withYear ? ` ${date.getFullYear()}` : ""}`;

export const minutesText = (minutes: number) => {
  const rounded = Math.round(minutes);
  return rounded < 1 ? "under a minute" : `${rounded} min`;
};

export type Spine = {
  /** Its own on the shelf: the session's id, or the day for free reading. */
  id: string;
  /** The focus session it stands for; null for a day's free reading. */
  session: FocusSessionRecord | null;
  minutes: number;
  title: string;
  /** No book to name: a session started without one, or free reading. */
  freeRead: boolean;
  /** A day's reading outside any focus session: loose pages, not a bound book. */
  loose: boolean;
  cloth: string;
  ink: string;
  height: number;
  width: number;
  completed: boolean;
  burned: boolean;
  /** When the session started; for free reading, the day it was read. */
  start: Date;
  /** The focus flower that bloomed in this session, if one did. */
  bloomed: string | null;
  label: string;
};

export type WeekRow = {
  kind: "week";
  key: string;
  label: string;
  spines: Spine[];
  /** Focus sessions among them: the books, as against the loose pages. */
  sessions: number;
  minutes: number;
  /** Of those minutes, the ones read outside a focus session. */
  freeMinutes: number;
  lost: number;
  perfect: boolean;
};
export type GapRow = { kind: "gap"; key: string; weeks: number };
export type Row = WeekRow | GapRow;

/** Free reading shorter than this is not listed: the ledger's own rule (`FREE_READ_MIN_MINUTES`). */
const FREE_READ_MIN_MINUTES = 1;

/**
 * Free reading while a focus session is running. The session's reading goes
 * to the ledger as it is read, but it has no spine until it ends, so until
 * then the snapshot lists it as free reading: loose pages that would vanish
 * when the session was shelved. Its minutes are taken off as the ledger will
 * take them, from today first and then from the day it started.
 */
export const freeReadsBesides = (
  freeReads: FreeReadRecord[],
  running: { startedAt: string; minutes: number } | null,
  today: Date
): FreeReadRecord[] => {
  if (!running || !(running.minutes > 0)) {
    return freeReads;
  }
  const todayKey = getDateKey(today);
  const started = new Date(running.startedAt);
  const startedKey = Number.isNaN(started.getTime()) ? todayKey : getDateKey(started);
  const left = new Map(freeReads.map((free) => [free.dateKey, free.minutes]));
  let owed = running.minutes;
  for (const key of startedKey < todayKey ? [todayKey, startedKey] : [todayKey]) {
    const taken = Math.min(owed, left.get(key) ?? 0);
    left.set(key, (left.get(key) ?? 0) - taken);
    owed -= taken;
  }
  return freeReads
    .map((free) => ({ ...free, minutes: left.get(free.dateKey) ?? 0 }))
    .filter((free) => free.minutes >= FREE_READ_MIN_MINUTES);
};

const isMet = (day: DayRecord) =>
  day.freezeUsed || day.graceUsed || (day.goalMinutes > 0 && day.minutes >= day.goalMinutes);

/**
 * Colours go to books in order of first appearance: each book starts at its
 * hashed slot and takes the next free one, so the first twelve books never
 * collide and a book keeps its colour for as long as its first session exists.
 */
const assignColours = (sessions: FocusSessionRecord[]) => {
  const byBook = new Map<string, string>();
  const used = new Set<number>();
  for (const session of sessions) {
    const key = session.bookId ?? (session.title ? `title:${session.title.trim().toLowerCase()}` : null);
    if (!key || byBook.has(key)) {
      continue;
    }
    const start = hash(key) % CLOTH.length;
    let slot = start;
    if (used.size < CLOTH.length) {
      while (used.has(slot)) {
        slot = (slot + 1) % CLOTH.length;
      }
      used.add(slot);
    }
    byBook.set(key, CLOTH[slot]);
  }
  return byBook;
};

/** A day's free reading as it stands on the shelf: after that day's sessions. */
const looseSpine = (free: FreeReadRecord): { at: number; spine: Spine } => {
  const start = parseDateKey(free.dateKey);
  const spine: Spine = {
    id: `free-${free.dateKey}`,
    session: null,
    minutes: free.minutes,
    title: "Free read",
    freeRead: true,
    loose: true,
    cloth: PARCHMENT,
    ink: inkFor(PARCHMENT),
    height: spineHeight(free.minutes),
    width: spineWidth(free.minutes),
    completed: false,
    burned: false,
    start,
    bloomed: null,
    label: [
      "Free read",
      minutesText(free.minutes),
      `${WEEKDAYS[start.getDay()]} ${shortDate(start)}`,
      "read outside a focus session"
    ].join(", ")
  };
  return { at: addDays(start, 1).getTime() - 1, spine };
};

export const buildRows = (
  sessions: FocusSessionRecord[],
  days: DayRecord[],
  bookTitles: Map<string, string>,
  today: Date,
  freeReads: FreeReadRecord[] = []
): Row[] => {
  const sorted = [...sessions].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const colours = assignColours(sorted);
  const dayMap = new Map(days.map((day) => [day.dateKey, day]));

  const weeks = new Map<string, Array<{ at: number; spine: Spine }>>();
  const shelve = (dateKey: string, entry: { at: number; spine: Spine }) => {
    const weekKey = getDateKey(mondayOf(parseDateKey(dateKey)));
    const list = weeks.get(weekKey);
    if (list) {
      list.push(entry);
    } else {
      weeks.set(weekKey, [entry]);
    }
  };

  for (const session of sorted) {
    const bookKey = session.bookId ?? (session.title ? `title:${session.title.trim().toLowerCase()}` : null);
    const freeRead = !bookKey;
    const cloth = freeRead ? PARCHMENT : colours.get(bookKey) ?? CLOTH[0];
    const title = (session.bookId && bookTitles.get(session.bookId)) || session.title || "Free read";
    const start = new Date(session.startedAt);
    const completed = session.endedReason === "completed" && session.clean;
    const burned = Boolean(session.burnedAt);
    const parts = [
      title,
      minutesText(session.minutes),
      `${WEEKDAYS[start.getDay()]} ${shortDate(start)}`,
      completed ? "completed" : "ended early"
    ];
    if (burned) {
      parts.push(`lost when a streak broke on ${shortDate(new Date(session.burnedAt as string), true)}`);
    }
    if (session.notes) {
      parts.push("has a note");
    }
    const bloomed = session.flower && session.flowerBloomed ? session.flower : null;
    if (bloomed) {
      parts.push(`a ${bloomed} bloomed`);
    }
    const spine: Spine = {
      id: session.id,
      session,
      minutes: session.minutes,
      title,
      freeRead,
      loose: false,
      cloth,
      ink: inkFor(cloth),
      height: spineHeight(session.minutes),
      width: spineWidth(session.minutes),
      completed,
      burned,
      start,
      bloomed,
      label: parts.join(", ")
    };
    shelve(session.dateKey, { at: start.getTime() || 0, spine });
  }

  // Reading outside a focus session stands on the shelf too, a day at a time.
  const weekFree = new Map<string, number>();
  for (const free of freeReads) {
    if (!(free.minutes > 0)) {
      continue;
    }
    shelve(free.dateKey, looseSpine(free));
    const weekKey = getDateKey(mondayOf(parseDateKey(free.dateKey)));
    weekFree.set(weekKey, (weekFree.get(weekKey) ?? 0) + free.minutes);
  }

  const weekMinutes = new Map<string, number>();
  let earliest = mondayOf(today);
  for (const day of days) {
    const monday = mondayOf(parseDateKey(day.dateKey));
    const key = getDateKey(monday);
    weekMinutes.set(key, (weekMinutes.get(key) ?? 0) + day.minutes);
    if (monday < earliest) {
      earliest = monday;
    }
  }
  for (const key of weeks.keys()) {
    const monday = parseDateKey(key);
    if (monday < earliest) {
      earliest = monday;
    }
  }

  const todayKey = getDateKey(today);
  const thisMonday = mondayOf(today);
  const rows: Row[] = [];
  let gap = 0;
  let gapKey = "";
  for (let monday = thisMonday, index = 0; monday >= earliest; monday = addDays(monday, -7), index += 1) {
    const key = getDateKey(monday);
    // In the order they were read: a day's free reading after its sessions.
    const spines = (weeks.get(key) ?? []).sort((a, b) => a.at - b.at).map((entry) => entry.spine);
    const minutes = weekMinutes.get(key) ?? 0;
    if (index > 0 && spines.length === 0 && minutes <= 0) {
      if (gap === 0) {
        gapKey = key;
      }
      gap += 1;
      continue;
    }
    if (gap > 0) {
      rows.push({ kind: "gap", key: `gap-${gapKey}`, weeks: gap });
      gap = 0;
    }
    const sunday = addDays(monday, 6);
    const finished = getDateKey(sunday) < todayKey;
    let perfect = finished;
    for (let d = 0; perfect && d < 7; d += 1) {
      const day = dayMap.get(getDateKey(addDays(monday, d)));
      perfect = Boolean(day && isMet(day));
    }
    rows.push({
      kind: "week",
      key,
      label:
        index === 0
          ? "This week"
          : index === 1
            ? "Last week"
            : `Week of ${shortDate(monday, monday.getFullYear() !== today.getFullYear())}`,
      spines,
      sessions: spines.filter((spine) => !spine.loose).length,
      minutes,
      freeMinutes: weekFree.get(key) ?? 0,
      lost: spines.filter((spine) => spine.burned).length,
      perfect
    });
  }
  return rows;
};
