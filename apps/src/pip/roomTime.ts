/**
 * The two things on Pip's wall that tell the time: a calendar that is the
 * reading calendar (today's date, and a mark for each day of this month the
 * goal was met), and a clock that tells the real time and, while a focus
 * session runs, how much of it is left. The rules, pure (roomTime.test.ts);
 * the art is in pip/house-fixtures.js. Nothing is stored: the calendar is the
 * habit ledger's days, the clock the session the reader started.
 */

/** What the calendar needs of a day in the ledger. */
export type LedgerDay = { dateKey: string; minutes: number; goalMinutes: number; freezeUsed: boolean; graceUsed: boolean };

/** The wall calendar as its art draws it: this month, a square a day. */
export type CalendarArt = {
  /** Today's date in the month, 1 to 31. */
  date: number;
  /** How many squares in before the 1st (weeks begin on Monday, as the app's do). */
  lead: number;
  /** Days in the month. */
  length: number;
  /** The dates the goal was met by reading, and those a freeze or grace kept. */
  met: number[];
  kept: number[];
};

const pad = (value: number) => String(value).padStart(2, "0");

export const calendarArt = (days: readonly LedgerDay[], now: Date): CalendarArt => {
  const year = now.getFullYear();
  const month = now.getMonth();
  const prefix = `${year}-${pad(month + 1)}-`;
  const met: number[] = [];
  const kept: number[] = [];
  for (const day of days) {
    if (!day.dateKey.startsWith(prefix)) continue;
    const date = Number(day.dateKey.slice(prefix.length));
    if (!Number.isInteger(date) || date < 1 || date > 31) continue;
    if (day.goalMinutes > 0 && day.minutes >= day.goalMinutes) met.push(date);
    else if (day.freezeUsed || day.graceUsed) kept.push(date);
  }
  return {
    date: now.getDate(),
    lead: (new Date(year, month, 1).getDay() + 6) % 7,
    length: new Date(year, month + 1, 0).getDate(),
    met: met.sort((a, b) => a - b),
    kept: kept.sort((a, b) => a - b)
  };
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** How the calendar stands, for its label: the day, and the month so far. */
export const calendarWords = (art: CalendarArt, now: Date) => {
  const met = art.met.length;
  return `${WEEKDAYS[now.getDay()]} ${art.date} ${MONTHS[now.getMonth()]}, goal met on ${met} day${met === 1 ? "" : "s"} this month`;
};

/** What Pip says, looking at it. */
export const calendarLines = (art: CalendarArt): string[] => {
  const met = art.met.length;
  const today = art.met.includes(art.date);
  return [
    met === 0 ? "a fresh month. all those empty squares." : met === 1 ? "one day marked. a start." : `${met} days marked this month.`,
    today ? "today's square is done." : "today's square is still empty.",
    "what day is it? ...oh."
  ];
};

// ---- the clock ---------------------------------------------------------------------------

/** What the clock needs of a running focus session: how long it was set for, and how much has been read. */
export type Running = { durationMinutes: number; elapsedMs: number };

/** The clock as its art draws it: the hour hand's place (0 to 12, in hours), the minute, and the session's minutes left (null: none running). */
export type ClockArt = { hour: number; minute: number; left: number | null };

/** Whole minutes left in a session, counting a minute begun as one left; 0 once it has run out. */
export const minutesLeft = (running: Running) => Math.max(0, Math.ceil((running.durationMinutes * 60_000 - running.elapsedMs) / 60_000));

export const clockArt = (now: Date, running: Running | null): ClockArt => ({
  hour: Number(((now.getHours() % 12) + now.getMinutes() / 60).toFixed(2)),
  minute: now.getMinutes(),
  left: running ? minutesLeft(running) : null
});

/** The time as a clock face says it: "14:05". */
export const clockTime = (now: Date) => `${pad(now.getHours())}:${pad(now.getMinutes())}`;

const minutes = (count: number) => `${count} minute${count === 1 ? "" : "s"}`;

/** What the session has left, in words; null with none running. */
export const sessionWords = (left: number | null) => (left === null ? null : left === 0 ? "your focus session has run its time" : `${minutes(left)} left in your focus session`);

/** How the clock stands, for its label. */
export const clockWords = (now: Date, left: number | null) => {
  const session = sessionWords(left);
  return `${clockTime(now)}${session ? `, ${session}` : ""}`;
};

/**
 * How much of the face the session's wedge covers, 0 to 1, clockwise from
 * twelve: the minutes left out of sixty, as a kitchen timer shows them (a
 * session of more than an hour fills the face until its last hour).
 */
export const wedge = (left: number | null) => (left === null ? 0 : Math.min(1, left / 60));

/** What Pip says, squinting up at it. */
export const clockLines = (now: Date, left: number | null): string[] =>
  left !== null && left > 0
    ? ["shh. focus time.", `${left} to go. you can do it.`]
    : [now.getHours() >= 22 || now.getHours() < 5 ? "is that the time? goodness." : "is that the time?", "the little hand is on... hm.", "tick. tock. tick."];
