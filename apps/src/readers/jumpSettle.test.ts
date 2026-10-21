import { describe, expect, it } from "vitest";
import { JUMP_HOLD_MAX_MS, JUMP_MAX_MS, JUMP_QUIET_MS, JUMP_TICK_MS, heldScrollTop, holdsPrepend, noteLeft, pinStep, startJump, type JumpHold } from "./jumpSettle";

/**
 * A scrolling page as epub.js keeps one, the chapters in a column: enough of
 * it to hold a jump's place while chapters come in above and below, and to
 * see where the place ends up.
 */
class Page {
  heights: number[];
  scrollTop = 0;
  constructor(heights: number[], readonly window = 812) {
    this.heights = heights;
  }
  top(view: number) {
    return this.heights.slice(0, view).reduce((sum, height) => sum + height, 0);
  }
  /** The browser's own rule: the page cannot scroll past its end. */
  setScroll(at: number) {
    const most = Math.max(0, this.heights.reduce((sum, height) => sum + height, 0) - this.window);
    this.scrollTop = Math.max(0, Math.min(most, at));
  }
  /** How far down the page can be scrolled: its end at the window's foot. */
  most() {
    return Math.max(0, this.heights.reduce((sum, height) => sum + height, 0) - this.window);
  }
  /** Chapters' heights changed below the window: the browser keeps the page within its end. */
  reflow() {
    this.setScroll(this.scrollTop);
  }
  /** A chapter put in above everything (as epub.js prepends), with no height yet. */
  prepend() {
    this.heights.unshift(0);
  }
}

/** Holds a jump's place in `page` (view `target` at the top) through `events` (time → change), looking every tick as the reader does. */
const hold = (page: Page, target: () => number, events: Array<[number, (page: Page) => void]>, until = 8000, handsOnAt = (_now: number) => 5) => {
  let held: JumpHold | null = startJump(0, 5);
  const log: string[] = [];
  let settledAt = -1;
  let doneAt = -1;
  for (let now = 0; now <= until; now += JUMP_TICK_MS) {
    events.filter(([at]) => at > now - JUMP_TICK_MS && at <= now).forEach(([, change]) => change(page));
    if (!held) {
      continue;
    }
    const look = pinStep(held, { now, want: page.top(target()), scrollTop: page.scrollTop, handsOnAt: handsOnAt(now), most: page.most() });
    if (look.put) {
      page.setScroll(page.top(target()));
      log.push(`${now}: put ${page.scrollTop}`);
    }
    if (look.settled) {
      settledAt = now;
    }
    if (look.done) {
      doneAt = now;
      held = null;
      continue;
    }
    held = noteLeft(look.hold, page.scrollTop);
  }
  return { settledAt, doneAt, log };
};

describe("a jump's place, held while the chapters round it come", () => {
  it("keeps the place exact when the chapter above arrives late, its height in two steps that epub.js adds up short", () => {
    // The epigraph gone to (145px) and the chapter after it (11775px).
    const page = new Page([145, 11775]);
    let viewOfTarget = 0;
    const result = hold(page, () => viewOfTarget, [
      // 3 s on, the chapter left (9998px) is put in above, in two steps; epub.js
      // scrolls by what it is told (5147, then 4224: 627 short of the 9998 it is).
      [3000, (p) => {
        p.prepend();
        viewOfTarget = 1;
      }],
      [3100, (p) => {
        p.heights[0] = 5147;
        p.setScroll(p.scrollTop + 5147);
      }],
      [6900, (p) => {
        p.heights[0] = 9998;
        p.setScroll(p.scrollTop + 4224);
      }]
    ]);
    expect(page.scrollTop).toBe(9998);
    expect(result.settledAt).toBeGreaterThanOrEqual(JUMP_QUIET_MS);
    expect(result.doneAt).toBe(-1);
  });

  it("puts the place again when epub.js corrects twice for one change (too far)", () => {
    const page = new Page([0, 145, 11775]);
    page.setScroll(0);
    const result = hold(page, () => 1, [
      [500, (p) => {
        p.heights[0] = 9998;
        // Corrected by two handlers at once.
        p.setScroll(p.scrollTop + 9998 * 2);
      }]
    ]);
    expect(page.scrollTop).toBe(9998);
    expect(result.doneAt).toBe(-1);
  });

  it("keeps putting a place the page falls short of, until the chapter below makes room", () => {
    const page = new Page([20000, 145, 300]);
    hold(page, () => 1, [[900, (p) => (p.heights[2] = 25000)]]);
    expect(page.scrollTop).toBe(20000);
  });

  it("lets the place go at the reader's first touch, and puts nothing after it", () => {
    const page = new Page([145, 11775]);
    let viewOfTarget = 0;
    const result = hold(
      page,
      () => viewOfTarget,
      [
        [2000, (p) => p.setScroll(p.scrollTop + 300)],
        [4000, (p) => {
          p.prepend();
          p.heights[0] = 9000;
          viewOfTarget = 1;
        }]
      ],
      8000,
      (now) => (now >= 1900 ? 99 : 5)
    );
    expect(result.doneAt).toBe(1920);
    // The reader's scroll stands, and the chapter put in above afterwards is not chased.
    expect(page.scrollTop).toBe(300);
  });

  it("lets the place go when something else scrolls the page (Smart Read reading on)", () => {
    const page = new Page([145, 11775]);
    const result = hold(page, () => 0, [[1500, (p) => p.setScroll(p.scrollTop + 547)]]);
    expect(result.doneAt).toBe(1500);
    expect(page.scrollTop).toBe(547);
  });

  it("is let go after a long while whatever happens", () => {
    const page = new Page([145, 11775]);
    const result = hold(page, () => 0, [], JUMP_HOLD_MAX_MS + 200);
    expect(result.doneAt).toBeGreaterThanOrEqual(JUMP_HOLD_MAX_MS);
    expect(result.doneAt).toBeLessThan(JUMP_HOLD_MAX_MS + JUMP_TICK_MS + 1);
  });

  it("waits for a chapter that is not on the page yet", () => {
    let held = startJump(0, 0);
    const first = pinStep(held, { now: 60, want: null, scrollTop: 0, handsOnAt: 0 });
    expect(first).toMatchObject({ put: false, done: false, settled: false });
    held = first.hold;
    expect(pinStep(held, { now: 700, want: 5000, scrollTop: 0, handsOnAt: 0 })).toMatchObject({ put: true, done: false });
  });
});

describe("QA round 4: next chapter to Part Three's page, 775 px short", () => {
  // From chapter 27, › to the part's title page (100px), its first chapter's
  // epigraph (300px) and the chapter (28000px) below it. On a phone 775px
  // tall. The chapter left (27, 30833px) comes in above after the page
  // below has settled, and epub.js scrolls by one step of 17005px for it,
  // short of its height. Then, past the 15 s the place used to be held for,
  // the chapters below are let go and fetched again (drawn from no height):
  // the browser drops the page to its new end, 30833 - 775 = 30058, up in
  // chapter 27. The device stayed there.
  it("holds the part's page at the top through all of it, to the pixel", () => {
    const page = new Page([100, 300, 28000], 775);
    let target = 0;
    const result = hold(
      page,
      () => target,
      [
        // The page below settled; the chapter left arrives above.
        [700, (p) => {
          p.prepend();
          target = 1;
        }],
        [2500, (p) => {
          p.heights[0] = 30833;
          p.setScroll(p.scrollTop + 17005);
        }],
        // The page and the chapters below it let go and drawn again from nothing: the page drops to its end.
        [16500, (p) => {
          p.heights[1] = 0;
          p.heights[2] = 0;
          p.heights[3] = 0;
          p.reflow();
        }],
        [16600, (p) => expect(p.scrollTop).toBe(30058)],
        [18000, (p) => {
          p.heights[1] = 100;
          p.heights[2] = 300;
          p.heights[3] = 28000;
        }]
      ],
      20000
    );
    expect(page.scrollTop).toBe(30833);
    expect(result.doneAt).toBe(-1);
  });

  it("still lets the place go for the reader's touch at any time", () => {
    const page = new Page([30833, 100, 300, 28000], 775);
    page.setScroll(30833);
    const result = hold(page, () => 1, [[17000, (p) => p.setScroll(p.scrollTop - 900)]], 20000, (now) => (now >= 17000 ? 99 : 5));
    expect(result.doneAt).toBe(17040);
    expect(page.scrollTop).toBe(30833 - 900);
  });
});

describe("chapters above held off while a jump settles", () => {
  it("holds them until the page below has settled, or a short while at most", () => {
    expect(holdsPrepend(null, 0)).toBe(false);
    let held = startJump(1000, 0);
    expect(holdsPrepend(held, 1000)).toBe(true);
    // Settled: the place stayed put a moment.
    let look = pinStep(held, { now: 1060, want: 400, scrollTop: 400, handsOnAt: 0 });
    held = noteLeft(look.hold, 400);
    look = pinStep(held, { now: 1060 + JUMP_QUIET_MS + 60, want: 400, scrollTop: 400, handsOnAt: 0 });
    expect(look.settled).toBe(true);
    expect(holdsPrepend(look.hold, 1060 + JUMP_QUIET_MS + 60)).toBe(false);
    // Never past the short while.
    expect(holdsPrepend(startJump(1000, 0), 1000 + JUMP_MAX_MS)).toBe(false);
  });

  it("tells epub.js the page is further down than its reach for the chapter above", () => {
    expect(heldScrollTop(0, 500)).toBe(501);
    expect(heldScrollTop(0, 1624)).toBe(1625);
    expect(heldScrollTop(30000, 500)).toBe(30000);
    expect(heldScrollTop(0, 0)).toBe(1);
  });
});
