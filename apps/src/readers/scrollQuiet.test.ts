import { describe, expect, it } from "vitest";
import { SCROLL_QUIET_MS, SCROLL_WAIT_MAX_MS, afterScrollSettles, createScrollQuiet, fetchAheadPx, reportWhileScrolling, settleDelay } from "./scrollQuiet";

/** A clock and timers the test moves by hand. */
const fakeTime = () => {
  let at = 0;
  let next = 1;
  const timers = new Map<number, { due: number; run: () => void }>();
  return {
    now: () => at,
    setTimer: (run: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { due: at + ms, run });
      return id;
    },
    clearTimer: (id: number) => {
      timers.delete(id);
    },
    pending: () => timers.size,
    /** Moves the clock on, running each timer as it comes due. */
    advance(ms: number) {
      const end = at + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) break;
        timers.delete(due[0]);
        at = due[1].due;
        due[1].run();
      }
      at = end;
    }
  };
};

describe("the scrolling, settled", () => {
  it("is settled before any scroll, and for the quiet span after each one", () => {
    const quiet = createScrollQuiet(200, () => 0);
    expect(quiet.quietIn(0)).toBe(0);
    quiet.note(1000);
    expect(quiet.quietIn(1000)).toBe(200);
    expect(quiet.quietIn(1150)).toBe(50);
    expect(quiet.quietIn(1200)).toBe(0);
    expect(quiet.lastAt()).toBe(1000);
  });

  it("runs at once when the page is still", () => {
    const time = fakeTime();
    const quiet = createScrollQuiet(SCROLL_QUIET_MS, time.now);
    let runs = 0;
    afterScrollSettles(() => (runs += 1), { quiet, ...time });
    expect(runs).toBe(1);
    expect(time.pending()).toBe(0);
  });

  it("waits through a fling, and runs once it has been still for the quiet span", () => {
    const time = fakeTime();
    const quiet = createScrollQuiet(SCROLL_QUIET_MS, time.now);
    quiet.note(0);
    let ranAt: number | null = null;
    afterScrollSettles(() => (ranAt = time.now()), { quiet, ...time });
    // A fling: a scroll every 16ms for 600ms.
    for (let t = 16; t <= 600; t += 16) {
      time.advance(16);
      quiet.note(time.now());
    }
    expect(ranAt).toBeNull();
    time.advance(SCROLL_QUIET_MS - 1);
    expect(ranAt).toBeNull();
    time.advance(1);
    expect(ranAt).toBe(quiet.lastAt() + SCROLL_QUIET_MS);
  });

  it("never waits longer than the most it was given", () => {
    const time = fakeTime();
    const quiet = createScrollQuiet(SCROLL_QUIET_MS, time.now);
    quiet.note(0);
    let ranAt: number | null = null;
    afterScrollSettles(() => (ranAt = time.now()), { quiet, ...time });
    // Scrolling without a pause (auto-scroll, a long drag).
    for (let t = 0; t < 5000; t += 16) {
      time.advance(16);
      quiet.note(time.now());
    }
    expect(ranAt).not.toBeNull();
    expect(ranAt).toBeLessThanOrEqual(SCROLL_WAIT_MAX_MS);
  });

  it("does nothing once cancelled", () => {
    const time = fakeTime();
    const quiet = createScrollQuiet(SCROLL_QUIET_MS, time.now);
    quiet.note(0);
    let runs = 0;
    const cancel = afterScrollSettles(() => (runs += 1), { quiet, ...time });
    cancel();
    time.advance(5000);
    expect(runs).toBe(0);
    expect(time.pending()).toBe(0);
  });

  it("gives the delay for a caller with its own timer", () => {
    const quiet = createScrollQuiet(200, () => 0);
    expect(settleDelay(0, quiet, 0)).toBe(0);
    quiet.note(100);
    expect(settleDelay(0, quiet, 150)).toBe(150);
    // Asked for long ago: it goes now, scrolling or not.
    expect(settleDelay(-2000, quiet, 150, 1500)).toBe(0);
    // Close to the most it may wait: only what is left of that.
    quiet.note(1400);
    expect(settleDelay(0, quiet, 1450, 1500)).toBe(50);
  });
});

describe("the next chapter, fetched ahead", () => {
  it("reaches two windows below, scrolling through a chapter", () => {
    expect(fetchAheadPx(5000, 835)).toBe(1670);
  });

  it("keeps epub.js's own rule near the top, where it would fetch the chapter before too", () => {
    expect(fetchAheadPx(1000, 835)).toBeNull();
    expect(fetchAheadPx(0, 835)).toBeNull();
  });

  it("keeps it when the window is too small to reach further than epub.js does", () => {
    expect(fetchAheadPx(5000, 200)).toBeNull();
    expect(fetchAheadPx(5000, 0)).toBeNull();
  });
});

describe("where the page is, while it scrolls on", () => {
  it("is said once a second while auto-scroll or Smart Read moves it slowly", () => {
    expect(reportWhileScrolling(1000, 20)).toBe(true);
    expect(reportWhileScrolling(1500, 300)).toBe(true);
  });

  it("waits a second between times", () => {
    expect(reportWhileScrolling(999, 5)).toBe(false);
  });

  it("is left for the end of a fling", () => {
    expect(reportWhileScrolling(1000, 3000)).toBe(false);
    expect(reportWhileScrolling(1200, -2500)).toBe(false);
  });
});
