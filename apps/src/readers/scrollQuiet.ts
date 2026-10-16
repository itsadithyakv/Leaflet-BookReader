/**
 * Work that can wait until the reader stops scrolling.
 *
 * Scrolling is the compositor's: the page moves under the finger (or the
 * wheel) without the page's own thread. What does need that thread is a
 * chapter arriving below, which has to be laid out and painted before it can
 * be scrolled into, and the frames that follow the scroll. A low-end phone
 * gave a fling's frames to work that could as well have waited: the words of
 * every chapter on the page counted again (a third of a second there) as the
 * next chapter came in, the pictures measured for the viewer, the place
 * worked out afresh at every pause of a slow drag. The text stuttered, or
 * ran into blank page.
 *
 * So that work waits for the scrolling to settle: `quietFor` says how long
 * until it has been still for `quietMs`, and `afterScrollSettles` runs a job
 * then, though never later than `maxWaitMs` after it was asked for (a book
 * scrolled without a pause still gets its words counted).
 *
 * Pure apart from the timers it is given: the reader tells it each scroll.
 */

/** Still for this long, the scrolling has settled (a fling's frames come every 16ms or so; a slow drag's pauses, a few frames). */
export const SCROLL_QUIET_MS = 200;
/** Work put off for the scrolling is done by then whatever happens. */
export const SCROLL_WAIT_MAX_MS = 1500;
/**
 * How long the page is still before epub.js says where it is (its
 * `afterScrolledTimeout`; its own is 10ms, after a 30ms pause). On a phone
 * that draws a frame every 40ms every frame was a pause: the place, the
 * chapter's name, the progress and the footer were all worked out again at
 * each one. Now once a slow drag rests, or a fling ends.
 */
export const RELOCATE_AFTER_SCROLL_MS = 150;
/**
 * And while the page never rests (auto-scroll, Smart Read, a long slow
 * drag), at least this often: those move it a pixel or two every few
 * frames, and the progress, the footer and the saved place would wait for
 * them to stop.
 */
export const RELOCATE_WHILE_SCROLLING_MS = 1000;
/** Faster than this (px a second) is a fling or a quick drag, which ends soon enough: not looked at mid-way (it cost frames). */
export const SLOW_SCROLL_PX_PER_S = 600;

/**
 * Whether to say where the page is now, while it is still scrolling: it has
 * been a while since the last time, and it is moving slowly (read along by
 * auto-scroll or Smart Read, or dragged a line at a time).
 */
export const reportWhileScrolling = (sinceReportMs: number, movedPx: number) =>
  sinceReportMs >= RELOCATE_WHILE_SCROLLING_MS && Math.abs(movedPx) / (sinceReportMs / 1000) < SLOW_SCROLL_PX_PER_S;

export type ScrollQuiet = {
  /** The page scrolled, now. */
  note: (now?: number) => void;
  /** How long until the page will have been still for the quiet span (0: it has). */
  quietIn: (now?: number) => number;
  /** When the page last scrolled (-Infinity: not yet). */
  lastAt: () => number;
};

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const createScrollQuiet = (quietMs = SCROLL_QUIET_MS, now: () => number = clock): ScrollQuiet => {
  let last = Number.NEGATIVE_INFINITY;
  return {
    note: (at = now()) => {
      last = at;
    },
    quietIn: (at = now()) => Math.max(0, last + quietMs - at),
    lastAt: () => last
  };
};

/** The text reader's: one book is open at a time. */
export const readerScroll = createScrollQuiet();

export type SettleOptions = {
  quiet?: ScrollQuiet;
  maxWaitMs?: number;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
};

/**
 * Runs `run` once the scrolling has settled (at once if it has), or
 * `maxWaitMs` after this call at the latest. Returns a cancel.
 */
export const afterScrollSettles = (run: () => void, options: SettleOptions = {}) => {
  const quiet = options.quiet ?? readerScroll;
  const maxWaitMs = options.maxWaitMs ?? SCROLL_WAIT_MAX_MS;
  const now = options.now ?? clock;
  const setTimer = options.setTimer ?? ((job: () => void, ms: number) => window.setTimeout(job, ms));
  const clearTimer = options.clearTimer ?? ((id: number) => window.clearTimeout(id));
  const asked = now();
  let timer: number | null = null;
  let done = false;
  const attempt = () => {
    timer = null;
    if (done) {
      return;
    }
    const at = now();
    const wait = quiet.quietIn(at);
    const left = asked + maxWaitMs - at;
    if (wait > 0 && left > 0) {
      timer = setTimer(attempt, Math.min(wait, left));
      return;
    }
    done = true;
    run();
  };
  attempt();
  return () => {
    done = true;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };
};

/**
 * The delay before `run` should next be looked at for a job first asked for
 * at `askedAt`: 0 when it can go now (the page is still, or it has waited
 * long enough), else how long to wait. For callers that keep their own timer.
 */
export const settleDelay = (askedAt: number, quiet: ScrollQuiet = readerScroll, at = clock(), maxWaitMs = SCROLL_WAIT_MAX_MS) => {
  const wait = quiet.quietIn(at);
  const left = askedAt + maxWaitMs - at;
  return wait > 0 && left > 0 ? Math.min(wait, left) : 0;
};

/**
 * How far below the window the next chapter is fetched, scrolling down.
 * epub.js fetches it within 500px of the end of what is loaded, and only
 * once the scrolling pauses: a fling (a few thousand pixels on a phone) ran
 * into the end of the chapter and stopped dead there while the next was
 * fetched and laid out. Two windows ahead, it is there before the fling
 * gets to it. `null`: epub.js's own rule (near the top of what is loaded,
 * where a larger reach would fetch the chapter before as well).
 */
export const fetchAheadPx = (scrollTop: number, clientHeight: number, screens = 2) => {
  const ahead = Math.round(clientHeight * screens);
  return clientHeight > 0 && ahead > 500 && scrollTop > ahead ? ahead : null;
};
