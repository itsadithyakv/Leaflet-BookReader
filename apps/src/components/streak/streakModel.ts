import type { DayRecord, HabitSnapshot } from "../../services/habitService";

/**
 * The streak container's pure parts: what the flame chip looks like, the
 * week's bubbles, the next milestone, and which moment (goal met, streak
 * saved, milestone, streak lost) to show once. The streak itself is the
 * engine's (habit/mod.rs); nothing here decides a rule, it only reads the
 * snapshot.
 */

/** Local YYYY-MM-DD of a date (habitService's getDateKey, without the import cycle). */
export const dayKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

/** The date of a YYYY-MM-DD key, at local noon (clear of any daylight-saving hour). */
export const keyDate = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
};

/** The key `days` after (or, negative, before) `key`. */
export const addDays = (key: string, days: number) => {
  const date = keyDate(key);
  date.setDate(date.getDate() + days);
  return dayKey(date);
};

/** The engine's rule (DayRecord::goal_met). */
export const goalMet = (day: Pick<DayRecord, "minutes" | "goalMinutes">) => day.goalMinutes > 0 && day.minutes >= day.goalMinutes;

/** Counts toward a streak: met, or paid for with grace or a freeze (DayRecord::counts). */
export const dayCounts = (day: DayRecord | undefined) => Boolean(day && (goalMet(day) || day.freezeUsed || day.graceUsed));

// ---- The chip ------------------------------------------------------------------------------

/** "lit": today's goal is met. "embers": a streak runs and today is open. "risk": that, late. "out": no streak. */
export type FlameState = "lit" | "embers" | "risk" | "out";

/** From 20:00 a streak with today undone looks at risk; earlier with a daily reminder set earlier. */
export const RISK_FROM = 20 * 60;
/** The engine's "streak at risk" reminder goes out at 22:00 (reminders/mod.rs): never later than that. */
export const RISK_LATEST = 22 * 60;

/** Minutes after local midnight from which an undone day looks at risk. */
export const riskFrom = (reminder: { daily: boolean; dailyAt: number } | null) =>
  Math.min(RISK_LATEST, reminder?.daily ? Math.min(RISK_FROM, reminder.dailyAt + 60) : RISK_FROM);

export const flameState = (
  snapshot: Pick<HabitSnapshot, "streak" | "todayMet">,
  minutesNow: number,
  riskAt: number = RISK_FROM
): FlameState => {
  if (snapshot.todayMet) return "lit";
  if (snapshot.streak <= 0) return "out";
  return minutesNow >= riskAt ? "risk" : "embers";
};

// ---- The week -------------------------------------------------------------------------------

export type BubbleKind = "met" | "frozen" | "grace" | "today" | "missed" | "future";

export type DayBubble = {
  dateKey: string;
  /** M, T, W… */
  letter: string;
  kind: BubbleKind;
  /** Today's share of the goal, 0..1 (1 for a met day). */
  progress: number;
  minutes: number;
};

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** Monday of the week `today` is in. */
export const weekStart = (today: string) => {
  const weekday = (keyDate(today).getDay() + 6) % 7;
  return addDays(today, -weekday);
};

/** This week, Monday first, as seven bubbles. */
export const weekBubbles = (snapshot: Pick<HabitSnapshot, "days" | "todayMinutes" | "goalMinutes" | "todayMet">, today: string): DayBubble[] => {
  const byKey = new Map(snapshot.days.map((day) => [day.dateKey, day]));
  const monday = weekStart(today);
  return LETTERS.map((letter, at) => {
    const key = addDays(monday, at);
    const day = byKey.get(key);
    const minutes = key === today ? snapshot.todayMinutes : (day?.minutes ?? 0);
    if (key > today) return { dateKey: key, letter, kind: "future", progress: 0, minutes: 0 };
    if (key === today) {
      const goal = snapshot.goalMinutes;
      const progress = snapshot.todayMet ? 1 : goal > 0 ? Math.min(1, minutes / goal) : 0;
      return { dateKey: key, letter, kind: snapshot.todayMet ? "met" : "today", progress, minutes };
    }
    if (day && goalMet(day)) return { dateKey: key, letter, kind: "met", progress: 1, minutes };
    if (day?.freezeUsed) return { dateKey: key, letter, kind: "frozen", progress: 0, minutes };
    if (day?.graceUsed) return { dateKey: key, letter, kind: "grace", progress: 0, minutes };
    return { dateKey: key, letter, kind: "missed", progress: 0, minutes };
  });
};

// ---- Milestones -------------------------------------------------------------------------------

export const MILESTONES = [7, 30, 100, 365] as const;

export const isMilestone = (streak: number) =>
  (MILESTONES as readonly number[]).includes(streak) || (streak > 365 && streak % 365 === 0);

/** The next milestone above `streak`, and how far along from the one before it. */
export const nextMilestone = (streak: number) => {
  const target = MILESTONES.find((value) => value > streak) ?? (Math.floor(streak / 365) + 1) * 365;
  const previous = [...MILESTONES].reverse().find((value) => value < target) ?? 0;
  const floor = target > 365 ? target - 365 : previous;
  return { target, left: target - streak, share: Math.max(0, Math.min(1, (streak - floor) / (target - floor))) };
};

// ---- Moments, once ----------------------------------------------------------------------------

export type StreakMoment =
  /** Today's goal was met just now. */
  | { kind: "goal"; keys: string[]; streak: number }
  /** A missed day was covered: by a freeze, or by the streak's free grace day. */
  | { kind: "saved"; keys: string[]; days: string[]; by: "freeze" | "grace"; streak: number }
  | { kind: "milestone"; keys: string[]; milestone: number; streak: number }
  /** The streak broke; `from` is how long it ran. */
  | { kind: "lost"; keys: string[]; from: number; day: string };

/** How far back a saved day or a break is still news. */
export const SAVED_WITHIN = 3;
export const LOST_WITHIN = 14;
/** A streak of one day lost is not worth a moment. */
export const LOST_MIN = 2;

/** The goal went from undone to met on the same day, in front of the reader. */
export const goalJustMet = (
  previous: Pick<HabitSnapshot, "todayMet"> | null,
  next: Pick<HabitSnapshot, "todayMet">,
  previousDay: string | null,
  today: string
) => Boolean(previous && previousDay === today && !previous.todayMet && next.todayMet);

/**
 * The break the ledger shows, when today is undone and no streak runs: the
 * first day missed after the last day that counted, and how long the run
 * ending there was.
 */
export const findBreak = (days: DayRecord[], today: string): { day: string; from: number } | null => {
  const byKey = new Map(days.map((day) => [day.dateKey, day]));
  let cursor = addDays(today, -1);
  const earliest = days.reduce((min, day) => (day.dateKey < min ? day.dateKey : min), today);
  while (cursor >= earliest && !dayCounts(byKey.get(cursor))) {
    cursor = addDays(cursor, -1);
  }
  if (cursor < earliest) return null;
  let from = 0;
  for (let at = cursor; dayCounts(byKey.get(at)); at = addDays(at, -1)) from += 1;
  return { day: addDays(cursor, 1), from };
};

export type MomentInput = {
  today: string;
  snapshot: Pick<HabitSnapshot, "streak" | "todayMet" | "days" | "cold">;
  /** The goal was met just now (goalJustMet). */
  justMet: boolean;
  /** The store's notice of a break, from the evaluation that found it. */
  pendingBreak: { brokeFrom: number } | null;
  seen: ReadonlySet<string>;
};

/** Every moment due, in the order to show them. Each one's `keys` are marked seen once it has shown. */
export const pickStreakMoments = ({ today, snapshot, justMet, pendingBreak, seen }: MomentInput): StreakMoment[] => {
  const moments: StreakMoment[] = [];

  // Saved: a recent day the ledger paid for. Several at once are one moment.
  const savedDays = snapshot.days
    .filter((day) => (day.freezeUsed || day.graceUsed) && day.dateKey < today && day.dateKey >= addDays(today, -SAVED_WITHIN))
    .filter((day) => !seen.has(`saved:${day.dateKey}`))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  if (savedDays.length > 0 && snapshot.streak > 0) {
    moments.push({
      kind: "saved",
      keys: savedDays.map((day) => `saved:${day.dateKey}`),
      days: savedDays.map((day) => day.dateKey),
      by: savedDays.some((day) => day.freezeUsed) ? "freeze" : "grace",
      streak: snapshot.streak
    });
  }

  // Lost: no streak, today undone, and a run that ended recently.
  if (snapshot.streak === 0 && !snapshot.todayMet) {
    const found = findBreak(snapshot.days, today);
    const day = snapshot.cold?.since ?? found?.day ?? null;
    const from = pendingBreak?.brokeFrom ?? snapshot.cold?.brokeFrom ?? found?.from ?? 0;
    if (day && day >= addDays(today, -LOST_WITHIN) && from >= LOST_MIN && !seen.has(`lost:${day}`)) {
      moments.push({ kind: "lost", keys: [`lost:${day}`], from, day });
    }
  }

  // Milestone: the streak stands on one, reached today or (today still open) yesterday.
  const reached = snapshot.todayMet ? today : addDays(today, -1);
  const milestoneKey = `milestone:${snapshot.streak}:${reached}`;
  const goalKey = `goal:${today}`;
  if (snapshot.streak > 0 && isMilestone(snapshot.streak) && !seen.has(milestoneKey)) {
    moments.push({
      kind: "milestone",
      // The goal met that made it is part of the celebration, not a second one.
      keys: justMet ? [milestoneKey, goalKey] : [milestoneKey],
      milestone: snapshot.streak,
      streak: snapshot.streak
    });
  } else if (justMet && snapshot.todayMet && !seen.has(goalKey)) {
    moments.push({ kind: "goal", keys: [goalKey], streak: snapshot.streak });
  }

  return moments;
};

/** Seen markers worth keeping: the ones from the last `days` days (each key ends in its date). */
export const pruneSeen = (keys: Iterable<string>, today: string, days = 60) => {
  const oldest = addDays(today, -days);
  return [...keys].filter((key) => {
    const date = key.slice(-10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= oldest;
  });
};
