/**
 * The leaderboard resets weekly, so every row has to agree on which week it is.
 *
 * ISO weeks. A reader's minutes are summed over the Monday–Sunday of their own
 * *local* calendar — that is what the app shows them — so the client sends the
 * week key it summed over, and the server only checks that it is well formed
 * and plausible (within a week of the server's own UTC week, which covers every
 * time zone). Stamping the server's UTC week instead put a reader in UTC+13
 * into last week's board every Monday morning.
 */

export const WEEK_KEY_PATTERN = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;

export function isoWeekKey(date = new Date()) {
  // Shift to the Thursday of this week: ISO weeks belong to the year holding
  // their Thursday, which is what makes the turn of the year come out right.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function isWeekKey(value) {
  return typeof value === "string" && WEEK_KEY_PATTERN.test(value);
}

/** The week keys a client anywhere on Earth could legitimately be in now. */
export function plausibleWeekKeys(now = new Date()) {
  const day = 24 * 60 * 60 * 1000;
  // ±14 hours covers UTC-12 … UTC+14; a day either side is simpler and safe.
  return new Set([
    isoWeekKey(new Date(now.getTime() - day)),
    isoWeekKey(now),
    isoWeekKey(new Date(now.getTime() + day))
  ]);
}

export const DAY_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const utcDayKey = (date) => date.toISOString().slice(0, 10);

/** A local calendar day, `YYYY-MM-DD`, that some clock on Earth could be in now. */
export function isPlausibleDayKey(value, now = new Date()) {
  if (typeof value !== "string" || !DAY_KEY_PATTERN.test(value)) {
    return false;
  }
  const day = 24 * 60 * 60 * 1000;
  return [now.getTime() - day, now.getTime(), now.getTime() + day]
    .map((time) => utcDayKey(new Date(time)))
    .includes(value);
}

/**
 * Whether a week is over for everyone, in every time zone. Week keys sort as
 * strings (`2026-W09` < `2026-W10` < `2027-W01`), so "before the earliest week
 * a clock could still be in" is a string comparison.
 */
export function weekIsOver(weekKey, now = new Date()) {
  const earliest = [...plausibleWeekKeys(now)].sort()[0];
  return weekKey < earliest;
}
