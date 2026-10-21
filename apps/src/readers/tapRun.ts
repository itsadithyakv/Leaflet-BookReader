/**
 * A finger's taps on the text reader's page (docs/android.md, "The reader").
 *
 * A tap is told from a scroll before anything else: a scroll whose finger
 * barely moved, or a touch that only stopped a gliding page, came through as
 * a tap and brought the menu up for a moment. Then the taps that land
 * together make a run, and the run says what is meant: one tap is the
 * page's own (a turn at a side with pages, the bookmark corner, a pause of
 * what reads on by itself), two bring the menu or send it away, and three
 * select the word (as a press and hold does). What one or two taps do waits
 * a moment, for the next tap of the run.
 */

/** A finger that moves this far between down and up is not tapping. */
export const TAP_MOVE_PX = 10;
/** Held this long it is not a tap (a hold selects, or stops the page). */
export const TAP_HOLD_MS = 300;
/** The page counts as still moving this long after its last scroll. */
export const GLIDE_QUIET_MS = 100;

/** What is known of a press, from the finger going down to its coming up. */
export type PressFacts = {
  /** How far the finger moved, in CSS px. */
  moved: number;
  /** How long it was down, in ms. */
  ms: number;
  /** The page scrolled while it was down. */
  scrolled: boolean;
  /** The page was still moving (a fling) when it went down. */
  gliding: boolean;
};

/** Whether a press was a tap: short, still, and on a page that was not moving. */
export const isPageTap = ({ moved, ms, scrolled, gliding }: PressFacts) =>
  moved < TAP_MOVE_PX && ms < TAP_HOLD_MS && !scrolled && !gliding;

/** Whether the page was moving at `at`, its last scroll at `scrolledAt` (both ms on one clock). */
export const glidingAt = (at: number, scrolledAt: number) => at - scrolledAt < GLIDE_QUIET_MS;

/** The next tap of a run comes within this long of the one before. */
export const TAP_RUN_MS = 280;
/** And lands this near the run's first. */
export const TAP_RUN_PX = 30;
/** The most taps a run has: the third selects the word, and nothing waits after it. */
export const TAP_RUN_MAX = 3;

export type Tap = { at: number; x: number; y: number };

/** Whether `tap` goes on the run that began at `first` and last had `last`. */
export const continuesRun = (first: Tap, last: Tap, tap: Tap) =>
  tap.at >= last.at &&
  tap.at - last.at <= TAP_RUN_MS &&
  Math.hypot(tap.x - first.x, tap.y - first.y) <= TAP_RUN_PX;

type Run = {
  taps: number;
  first: Tap;
  last: Tap;
  /** What the run does once it is over, by how many taps it had. */
  act: ((taps: number) => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
};

/** One run under way a reader (keyed by its rendition). */
const runs = new WeakMap<object, Run>();

const arm = (key: object, run: Run) => {
  if (run.timer !== null) globalThis.clearTimeout(run.timer);
  run.timer = run.act
    ? globalThis.setTimeout(() => {
        if (runs.get(key) === run) runs.delete(key);
        run.act?.(run.taps);
      }, TAP_RUN_MS)
    : null;
};

/** The run is over now: what it does is done at once (a tap elsewhere, a scroll). */
export const finishTapRun = (key: object) => {
  const run = runs.get(key);
  if (!run) return;
  runs.delete(key);
  if (run.timer !== null) globalThis.clearTimeout(run.timer);
  run.act?.(run.taps);
};

/** The run is over and does nothing more (its word was selected, its page turned). */
export const endTapRun = (key: object) => {
  const run = runs.get(key);
  if (!run) return;
  runs.delete(key);
  if (run.timer !== null) globalThis.clearTimeout(run.timer);
};

/** A tap: counted on the run under way, or the first of a new one. Returns the run's taps now. */
export const countTap = (key: object, tap: Tap): number => {
  const run = runs.get(key);
  if (run && run.taps < TAP_RUN_MAX && continuesRun(run.first, run.last, tap)) {
    run.taps += 1;
    run.last = tap;
    arm(key, run);
    return run.taps;
  }
  finishTapRun(key);
  runs.set(key, { taps: 1, first: tap, last: tap, act: null, timer: null });
  return 1;
};

/**
 * What the run does once no more taps come: `act(taps)`, a moment after the
 * last. Called for each tap that has work (the latest `act` is the one done).
 */
export const holdTapRun = (key: object, act: (taps: number) => void) => {
  const run = runs.get(key);
  if (!run) {
    const now = { at: 0, x: 0, y: 0 };
    const fresh: Run = { taps: 1, first: now, last: now, act, timer: null };
    runs.set(key, fresh);
    arm(key, fresh);
    return;
  }
  run.act = act;
  arm(key, run);
};

/** How many taps the run under way has (0: none). */
export const tapsSoFar = (key: object) => runs.get(key)?.taps ?? 0;

/** Clicks that were not taps (a scroll, a held finger, a stopped glide): the page passes them by. */
const notTaps = new WeakSet<Event>();

export const markNotTap = (event: Event) => {
  notTaps.add(event);
};

export const isNotTap = (event: Event) => notTaps.has(event);
