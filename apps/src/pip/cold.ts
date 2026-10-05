/**
 * Pip's cold, in words and as a number to draw from.
 *
 * A broken streak used to burn the newest books on the shelf. It burns
 * nothing now: when a streak of three days or more breaks, Pip catches a cold,
 * and the reader nurses her back by reading (the daily goal met on any day
 * since cures it; it passes by itself after three days). Whether she has one
 * is decided in Rust from the ledger (`habit::cold`, habit/mod.rs) and comes
 * with the habit snapshot as `cold`. Nothing here decides anything: it only
 * says those numbers aloud, as pip/mood.ts does for the mood. Pure, so the
 * wording is tested (cold.test.ts).
 *
 * The cold does not touch the mood: not its number, its drift or what reading
 * adds to it. It is shown beside the mood as its own thing.
 */
import type { PipCold } from "../services/habitService";
import { WEEKDAYS, parseDateKey, shortDate } from "../components/shelf/rows";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** However nearly cured, a cold still shows this much: a sniffle. */
const SNIFFLE = 0.15;

/**
 * How bad it is, for drawing: 0 when she is well, else from 1 (nothing read
 * today) down towards a sniffle as today's reading nears the goal. At the
 * goal the snapshot has no cold at all.
 */
export const coldLevel = (cold: PipCold | null | undefined): number =>
  cold ? Math.max(SNIFFLE, Math.min(1, 1 - cold.cure)) : 0;

/** "Sat 10 Oct", from a ledger day. */
const dayWords = (dateKey: string) => {
  const date = parseDateKey(dateKey);
  return Number.isNaN(date.getTime()) ? dateKey : `${WEEKDAYS[date.getDay()]} ${shortDate(date)}`;
};

export type ColdWords = {
  /** "Pip has a cold." */
  headline: string;
  /** Why: the streak that ended, and that nothing was taken for it. */
  why: string;
  /** What cures it, with today's numbers. */
  lift: string;
  /** That it passes by itself, and when. */
  passes: string;
  /** That it is not her mood. */
  mood: string;
};

/** The cold explained: for the mood panel, or anywhere it is shown. */
export const coldWords = (cold: PipCold): ColdWords => {
  const left = Math.max(1, Math.round(cold.minutesLeftToday));
  return {
    headline: "Pip has a cold.",
    why: `Your ${cold.brokeFrom}-day streak ended on ${dayWords(cold.since)}. Nothing was taken from your shelf for it: she caught a cold instead.`,
    lift:
      cold.cure > 0
        ? `She is ${Math.floor(cold.cure * 100)}% of the way better. ${plural(left, "more minute")} of reading today, in a focus session or not, and the cold is gone.`
        : `Read ${plural(left, "minute")} today (your daily goal), in a focus session or not, and the cold is gone.`,
    passes: cold.daysLeft <= 1 ? "It passes by itself tomorrow." : `It passes by itself in ${cold.daysLeft} days.`,
    mood: "A cold is not her mood: it lowers nothing and takes nothing."
  };
};

/**
 * What the end of a session says about the cold: that its reading cured it,
 * or how much more today would. Null when there is nothing to say.
 */
export const coldAfterSession = (cold: PipCold | null | undefined, cured: boolean): string | null => {
  if (cured) {
    return "Pip's cold is gone. Your reading nursed her back.";
  }
  if (!cold) {
    return null;
  }
  const left = Math.max(1, Math.round(cold.minutesLeftToday));
  return `Pip still has a cold. ${plural(left, "more minute")} of reading today and she is better.`;
};

/** Things she says with a cold, and once it is gone: lower case, short enough for her bubble. */
export const COLD_LINES = [
  "achoo.",
  "i hab a code.",
  "it's just a sniffle.",
  "read to me? it helps.",
  "one chapter. doctor's orders."
] as const;
export const CURED_LINES = ["all better. you read me well.", "the cold's gone. thank you."] as const;
