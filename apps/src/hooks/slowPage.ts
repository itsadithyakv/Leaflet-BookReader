/**
 * A page read slowly is reading.
 *
 * The reading heartbeat stops counting when nothing has been touched for
 * IDLE_MS (90 seconds): a book left open is not being read. But a page takes
 * as long as it takes. With pages, a reader at 200 words a minute on a page of
 * 400 touches nothing for two minutes, and was credited three quarters of
 * their time; at 150 words a minute, little more than half.
 *
 * So the quiet time is remembered rather than thrown away, and a deliberate
 * turn of the page claims it: the page was up, Leaflet was in front, and the
 * reader has just shown they were there. One page claims at most
 * SLOW_PAGE_CAP_MS in all, which is as long as the pace tracker will take one
 * page to have been read for. Time with Leaflet behind another window,
 * minimised or asleep is never remembered, so it can never be claimed.
 *
 * Pure: the heartbeat (useReadingHeartbeat) tells it what each beat was, and
 * the readers tell it when a page is turned.
 */

/** The most one page is credited when it was read without touching anything. */
export const SLOW_PAGE_CAP_MS = 240_000;

/** Time on a day (its local date key). */
export type DayTime = { dateKey: string; ms: number };

export type PageStretch = {
  /** Reading counted since the page came up. */
  countedMs: number;
  /** In front and on screen but not counted, nothing having been touched: by the day it fell on, oldest first. */
  quiet: DayTime[];
  /** When time was last counted: a beat, or a turn's own claim. */
  lastCountedAt: number;
};

/** A page has just come up (or the book has just opened). */
export const pageUp = (now: number): PageStretch => ({ countedMs: 0, quiet: [], lastCountedAt: now });

const total = (times: readonly DayTime[]) => times.reduce((sum, time) => sum + time.ms, 0);

/** The newest `ms` of `times`, oldest first. */
const newest = (times: readonly DayTime[], ms: number): DayTime[] => {
  const kept: DayTime[] = [];
  let left = ms;
  for (let index = times.length - 1; index >= 0 && left > 0; index -= 1) {
    const take = Math.min(left, times[index].ms);
    if (take > 0) {
      kept.unshift({ dateKey: times[index].dateKey, ms: take });
      left -= take;
    }
  }
  return kept;
};

/**
 * A beat of the heartbeat ended, `ms` long (never longer than a tick, so a
 * sleeping machine adds one tick at most). `kind` is what it was: "counted"
 * (credited as reading), "quiet" (Leaflet in front and on screen, but nothing
 * touched for too long to count), or "away" (not in front: forgotten).
 */
export const noteBeat = (
  stretch: PageStretch,
  kind: "counted" | "quiet" | "away",
  ms: number,
  now: number,
  dateKey: string,
  cap = SLOW_PAGE_CAP_MS
): PageStretch => {
  if (!(ms > 0) || kind === "away") {
    return stretch;
  }
  if (kind === "counted") {
    return { ...stretch, countedMs: stretch.countedMs + ms, lastCountedAt: now };
  }
  const last = stretch.quiet[stretch.quiet.length - 1];
  const quiet =
    last && last.dateKey === dateKey
      ? [...stretch.quiet.slice(0, -1), { dateKey, ms: last.ms + ms }]
      : [...stretch.quiet, { dateKey, ms }];
  // No more is kept than a page can ever claim.
  return { ...stretch, quiet: newest(quiet, cap) };
};

/**
 * The page is turned at `now`. What the turn claims (by day, oldest first:
 * a page begun before midnight is credited to the day it was read on), and
 * the stretch for the page that has come up.
 *
 * The claim is the quiet time, but never so much that the page is credited
 * more than the cap in all, and never more than the time that has really
 * passed since anything was last counted. The beat in progress is not part
 * of it: the heartbeat counts that itself, the turn having woken it.
 */
export const pageTurned = (stretch: PageStretch, now: number, cap = SLOW_PAGE_CAP_MS): { claim: DayTime[]; next: PageStretch } => {
  const allowed = Math.max(0, Math.min(total(stretch.quiet), cap - stretch.countedMs, now - stretch.lastCountedAt));
  return { claim: newest(stretch.quiet, allowed), next: pageUp(now) };
};
