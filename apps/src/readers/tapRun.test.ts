import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TAP_RUN_MS,
  countTap,
  endTapRun,
  finishTapRun,
  glidingAt,
  holdTapRun,
  isPageTap,
  tapsSoFar
} from "./tapRun";
import { runAction, tapAction } from "./touchLayout";

describe("a tap, told from a scroll", () => {
  const still = { moved: 2, ms: 120, scrolled: false, gliding: false };

  it("is short and still, on a page that is not moving", () => {
    expect(isPageTap(still)).toBe(true);
  });

  it("is not a finger that moved, or was held", () => {
    expect(isPageTap({ ...still, moved: 10 })).toBe(false);
    expect(isPageTap({ ...still, moved: 9 })).toBe(true);
    expect(isPageTap({ ...still, ms: 300 })).toBe(false);
  });

  it("is not a touch the page scrolled under, however little the finger moved", () => {
    expect(isPageTap({ ...still, scrolled: true })).toBe(false);
  });

  it("is not a touch that only stopped a gliding page", () => {
    expect(glidingAt(1000, 950)).toBe(true);
    expect(glidingAt(1000, 850)).toBe(false);
    expect(isPageTap({ ...still, gliding: glidingAt(1000, 960) })).toBe(false);
  });
});

describe("a run of taps", () => {
  let key: object;
  beforeEach(() => {
    vi.useFakeTimers();
    key = {};
  });
  afterEach(() => vi.useRealTimers());

  const tap = (at: number, x = 200, y = 400) => ({ at, x, y });

  it("does one tap's work once no second comes", () => {
    const act = vi.fn();
    expect(countTap(key, tap(0))).toBe(1);
    holdTapRun(key, act);
    vi.advanceTimersByTime(TAP_RUN_MS - 1);
    expect(act).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(act).toHaveBeenCalledWith(1);
    expect(tapsSoFar(key)).toBe(0);
  });

  it("counts two taps near each other as one run, and waits for a third", () => {
    const act = vi.fn();
    countTap(key, tap(0));
    holdTapRun(key, act);
    vi.advanceTimersByTime(150);
    expect(countTap(key, tap(150, 215, 410))).toBe(2);
    holdTapRun(key, act);
    vi.advanceTimersByTime(TAP_RUN_MS - 1);
    expect(act).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith(2);
  });

  it("ends at the third, which is the word's", () => {
    const act = vi.fn();
    countTap(key, tap(0));
    holdTapRun(key, act);
    countTap(key, tap(150));
    holdTapRun(key, act);
    expect(countTap(key, tap(300))).toBe(3);
    // The word is selected: nothing the first two would do is done.
    endTapRun(key);
    vi.advanceTimersByTime(TAP_RUN_MS * 2);
    expect(act).not.toHaveBeenCalled();
    // And a fourth begins a run of its own.
    expect(countTap(key, tap(400))).toBe(1);
  });

  it("starts again for a tap far away, or late, doing the first run's work at once", () => {
    const first = vi.fn();
    countTap(key, tap(0));
    holdTapRun(key, first);
    expect(countTap(key, tap(100, 260, 400))).toBe(1);
    expect(first).toHaveBeenCalledWith(1);
    const second = vi.fn();
    holdTapRun(key, second);
    vi.advanceTimersByTime(TAP_RUN_MS + 50);
    expect(second).toHaveBeenCalledWith(1);
    expect(countTap(key, tap(100 + TAP_RUN_MS + 60))).toBe(1);
  });

  it("is over at once for a scroll", () => {
    const act = vi.fn();
    countTap(key, tap(0));
    holdTapRun(key, act);
    finishTapRun(key);
    expect(act).toHaveBeenCalledWith(1);
  });
});

describe("what a run does", () => {
  it("brings the menu for two taps, anywhere, and not for one in the middle", () => {
    const middle = tapAction(0, "scroll", true);
    expect(runAction(middle, 1)).toEqual({ kind: "none" });
    expect(runAction(middle, 2)).toEqual({ kind: "chrome" });
    expect(runAction(tapAction(1, "scroll", true), 2)).toEqual({ kind: "chrome" });
    // A tablet scrolling: a tap anywhere was the menu's.
    expect(runAction(tapAction(1, "scroll", false), 1)).toEqual({ kind: "none" });
  });

  it("keeps one tap's own meaning at a side and in the corner", () => {
    expect(runAction(tapAction(1, "scroll", true), 1)).toEqual({ kind: "hide" });
    expect(runAction(tapAction(1, "pages", true), 1)).toEqual({ kind: "turn", step: 1 });
    expect(runAction(tapAction(1, "scroll", true, true), 1)).toEqual({ kind: "bookmark" });
  });

  it("leaves three to the word", () => {
    expect(runAction(tapAction(0, "pages", true), 3)).toEqual({ kind: "none" });
  });
});
