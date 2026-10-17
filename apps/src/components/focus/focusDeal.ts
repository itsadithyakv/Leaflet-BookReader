/**
 * Focus, the deal: all reading waters Pip's garden, and a minute read in a
 * focus session waters twice as much (habit/seeds.rs). A session starts in
 * one tap at the reader's usual length: the one last chosen, else their goal.
 */

/** Water a minute read in a focus session pours (habit/seeds.rs), and a plain minute's: half. */
export const FOCUS_WATER_PER_MINUTE = 1.5;
export const PLAIN_WATER_PER_MINUTE = 0.75;

/** The badge's words, on every Focus key and in the wrap-up. */
export const FOCUS_DOUBLE_TIP = "Reading in Focus earns double seeds";

/** The lengths the pickers offer. */
export const FOCUS_LENGTHS = [10, 20, 30, 45] as const;

const LENGTH_KEY = "leaflet.focus.minutes";
const FALLBACK_MINUTES = 20;

const sensible = (minutes: number) => Number.isFinite(minutes) && minutes >= 1 && minutes <= 240;

/** The length a one-tap session runs for: the last one chosen, else the daily goal. */
export const usualFocusMinutes = (goalMinutes: number): number => {
  try {
    const kept = Number(localStorage.getItem(LENGTH_KEY));
    if (sensible(kept)) return Math.round(kept);
  } catch {
    // No storage: the goal decides.
  }
  return sensible(goalMinutes) ? Math.round(goalMinutes) : FALLBACK_MINUTES;
};

/** Keeps a length the reader chose, for the next one-tap session. */
export const rememberFocusMinutes = (minutes: number) => {
  if (!sensible(minutes)) return;
  try {
    localStorage.setItem(LENGTH_KEY, String(Math.round(minutes)));
  } catch {
    // Forgotten next time; the goal stands in.
  }
};

/** The pickers' lengths, with the usual one among them when it is not a standard length. */
export const focusLengthsWith = (minutes: number): number[] =>
  (FOCUS_LENGTHS as readonly number[]).includes(minutes)
    ? [...FOCUS_LENGTHS]
    : [...FOCUS_LENGTHS, minutes].sort((a, b) => a - b);
