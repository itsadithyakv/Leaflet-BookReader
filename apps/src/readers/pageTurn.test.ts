import { describe, expect, it } from "vitest";
import {
  KEY_REPEAT_TURN_MS,
  WHEEL_AT_REST,
  WHEEL_QUIET_MS,
  keyTurns,
  pageAt,
  pageCount,
  pageHolding,
  pageTurnDuration,
  pageTurnTarget,
  strayPageTarget,
  wheelTurn
} from "./pageTurn";

/**
 * A chapter of `pages` pages as the browser holds it: a scroll position lands
 * on device pixels (`scale` 1.25 or 1.5 leaves fractions of a CSS pixel), and
 * cannot go past the content less the container.
 */
const chapter = (pages: number, pageWidth: number, containerWidth: number, scale: number) => {
  const contentWidth = pages * pageWidth;
  const settle = (left: number) =>
    Math.round(Math.min(Math.max(0, left), contentWidth - containerWidth) * scale) / scale;
  return { contentWidth, settle };
};

/** The pages shown, turning forward from the first until the chapter is left. */
const walkForward = (pages: number, pageWidth: number, containerWidth: number, scale: number) => {
  const { contentWidth, settle } = chapter(pages, pageWidth, containerWidth, scale);
  const shown = [1];
  let left = 0;
  for (let turn = 0; turn < pages + 5; turn += 1) {
    const target = pageTurnTarget(left, pageWidth, contentWidth, 1);
    if (target === null) {
      break;
    }
    left = settle(target);
    shown.push(Math.round(left / pageWidth) + 1);
  }
  return shown;
};

/** The same walk by epub.js's own rule (what 1.1 did): a page's width on, if a whole further page fits. */
const walkForwardAsEpubJs = (pages: number, pageWidth: number, containerWidth: number, scale: number) => {
  const { contentWidth, settle } = chapter(pages, pageWidth, containerWidth, scale);
  const shown = [1];
  let left = 0;
  for (let turn = 0; turn < pages + 5; turn += 1) {
    if (!(left + containerWidth + pageWidth <= contentWidth)) {
      break;
    }
    left = settle(left + pageWidth);
    shown.push(Math.round(left / pageWidth) + 1);
  }
  return shown;
};

const upTo = (pages: number) => Array.from({ length: pages }, (_, index) => index + 1);

describe("turning pages", () => {
  it("counts a chapter's pages from its columns", () => {
    expect(pageCount(5892, 1473)).toBe(4);
    // A chapter shorter than the screen is still one page.
    expect(pageCount(1474, 1473)).toBe(1);
    expect(pageCount(900, 0)).toBe(1);
  });

  it("goes on to the last page of a chapter", () => {
    // Four pages of 1473px in a container a pixel wider: epub.js's own test
    // (2946 + 1474 + 1473 <= 5892) fails here and skipped the last page.
    expect(pageTurnTarget(2946, 1473, 5892, 1)).toBe(4419);
  });

  it("lands on the page's exact place, whatever the last turn left over", () => {
    // On a scaled display each turn can stop a fraction further on. epub.js's
    // test (2947.2 + 1473 + 1473 <= 5892) fails here too.
    expect(pageTurnTarget(2947.2, 1473, 5892, 1)).toBe(4419);
    expect(pageTurnTarget(2945.4, 1473, 5892, -1)).toBe(1473);
  });

  it("leaves the chapter only from its last and first pages", () => {
    expect(pageTurnTarget(4419, 1473, 5892, 1)).toBeNull();
    // The last page cannot scroll quite as far when the container is wider than a page.
    expect(pageTurnTarget(4418, 1473, 5892, 1)).toBeNull();
    expect(pageTurnTarget(0, 1473, 5892, -1)).toBeNull();
    expect(pageTurnTarget(1473, 1473, 5892, -1)).toBe(0);
  });

  it("turns from a position between pages to the next whole page", () => {
    expect(pageTurnTarget(1400, 1473, 5892, 1)).toBe(2946);
    expect(pageTurnTarget(1500, 1473, 5892, -1)).toBe(0);
  });

  it("shows every page of a chapter, one a turn, whatever the width and the display's scaling", () => {
    for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
      for (const pageWidth of [677, 1248, 1473, 415, 1001]) {
        for (const pages of [1, 2, 3, 19, 40]) {
          // The container as wide as a page, or a pixel wider.
          for (const extra of [0, 1]) {
            expect(walkForward(pages, pageWidth, pageWidth + extra, scale)).toEqual(upTo(pages));
          }
        }
      }
    }
  });

  it("is where 1.1 skipped the last page: epub.js's own rule, on a scaled display", () => {
    // 150% scaling, pages 677px wide: the scroll position of the 18th of 19
    // pages lands a third of a pixel on (11509.33), a whole further page no
    // longer "fits", and the turn went to the next chapter without the 19th.
    expect(walkForwardAsEpubJs(19, 677, 677, 1.5)).toEqual(upTo(18));
    expect(walkForward(19, 677, 677, 1.5)).toEqual(upTo(19));
    // A container a pixel wider than a page: the same, at any scaling.
    expect(walkForwardAsEpubJs(19, 1248, 1249, 1)).toEqual(upTo(18));
    expect(walkForward(19, 1248, 1249, 1)).toEqual(upTo(19));
    // With nothing a fraction off, epub.js's rule shows them all.
    expect(walkForwardAsEpubJs(19, 1248, 1248, 1.5)).toEqual(upTo(19));
  });

  it("turns back through every page from the last", () => {
    for (const scale of [1, 1.25, 1.5]) {
      for (const pageWidth of [677, 1248, 1001]) {
        const pages = 19;
        const { contentWidth, settle } = chapter(pages, pageWidth, pageWidth + 1, scale);
        // Where a turn back into the chapter lands: its last page.
        let left = settle(contentWidth - pageWidth);
        const shown = [Math.round(left / pageWidth) + 1];
        for (let turn = 0; turn < pages + 5; turn += 1) {
          const target = pageTurnTarget(left, pageWidth, contentWidth, -1);
          if (target === null) {
            break;
          }
          left = settle(target);
          shown.push(Math.round(left / pageWidth) + 1);
        }
        expect(shown).toEqual(upTo(pages).reverse());
      }
    }
  });

  it("numbers the page showing, whatever the display's scaling", () => {
    // epub.js's own numbering: the scroll position rounded down to a page.
    const asEpubJs = (left: number, pageWidth: number) => Math.floor(left / pageWidth) + 1;
    for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
      for (const pageWidth of [677, 678, 1248, 1473, 415, 1001]) {
        for (const pages of [1, 2, 6, 19, 40]) {
          const { contentWidth, settle } = chapter(pages, pageWidth, pageWidth, scale);
          for (let page = 1; page <= pages; page += 1) {
            expect(pageAt(settle((page - 1) * pageWidth), pageWidth, contentWidth)).toEqual({ page, total: pages });
          }
        }
      }
    }
    // Measured in the preview at 150%, six pages of 677px: the last page sits
    // at 3384.67 (it cannot scroll to 3385.33), and epub.js called it page 5.
    expect(asEpubJs(3384.67, 677)).toBe(5);
    expect(pageAt(3384.67, 677, 4062)).toEqual({ page: 6, total: 6 });
    // At 125% the second page sits at 676.8: epub.js called it page 1.
    const { settle } = chapter(6, 677, 677, 1.25);
    expect(settle(677)).toBeCloseTo(676.8);
    expect(asEpubJs(settle(677), 677)).toBe(1);
    expect(pageAt(settle(677), 677, 4062).page).toBe(2);
    // A chapter of one page is on its last page.
    expect(pageAt(0, 677, 677)).toEqual({ page: 1, total: 1 });
    expect(pageAt(0, 0, 677)).toEqual({ page: 1, total: 1 });
  });

  it("finds the page that holds a place", () => {
    expect(pageHolding(0, 677)).toBe(0);
    expect(pageHolding(676, 677)).toBe(677);
    expect(pageHolding(28, 677)).toBe(0);
    // The first word of the fourth page, drawn 28px into it.
    expect(pageHolding(3 * 677 + 28, 677)).toBe(2031);
    // Drawn a fraction of a pixel short of its page.
    expect(pageHolding(2030.6, 677)).toBe(2031);
    expect(pageHolding(-3, 677)).toBe(0);
    expect(pageHolding(500, 0)).toBe(0);
  });

  it("brings a frame left between two pages back onto a whole one", () => {
    // Measured: focus moved to a link on the fourth of six pages, and the
    // browser scrolled the frame to 1763.33, 2.6 pages in.
    expect(strayPageTarget(1763.33, 677, 4062)).toBe(2031);
    expect(strayPageTarget(3114, 677, 4062)).toBe(3385);
    // On a page already, give or take what a scaled display leaves.
    expect(strayPageTarget(2031, 677, 4062)).toBeNull();
    expect(strayPageTarget(2031.33, 677, 4062)).toBeNull();
    expect(strayPageTarget(3384.67, 677, 4062)).toBeNull();
    expect(strayPageTarget(0, 677, 677)).toBeNull();
    // Never past the chapter's last page.
    expect(strayPageTarget(3900, 677, 4062)).toBe(3385);
    expect(strayPageTarget(100, 0, 4062)).toBeNull();
  });

  it("turns one page for a press, and paces a held key", () => {
    // A press of its own, however soon after the last.
    expect(keyTurns(false, 0)).toBe(true);
    expect(keyTurns(false, 20)).toBe(true);
    // A held key repeats every 33ms or so: most repeats turn nothing.
    expect(keyTurns(true, 33)).toBe(false);
    expect(keyTurns(true, KEY_REPEAT_TURN_MS - 1)).toBe(false);
    expect(keyTurns(true, KEY_REPEAT_TURN_MS)).toBe(true);
    // Held for a second: the press, then a turn every fifth repeat.
    let last = 0;
    let turns = 0;
    for (let at = 0; at <= 1000; at += 33) {
      if (keyTurns(at > 0, at - last)) {
        last = at;
        turns += 1;
      }
    }
    expect(turns).toBe(7);
  });

  describe("the wheel", () => {
    /** The pages turned by a run of wheel events, each `[at, deltaY, deltaX?, deltaMode?]`. */
    const turned = (events: Array<[number, number, number?, number?]>) => {
      let gesture = WHEEL_AT_REST;
      const turns: number[] = [];
      for (const [at, deltaY, deltaX = 0, deltaMode = 0] of events) {
        const step = wheelTurn(gesture, at, deltaX, deltaY, deltaMode);
        gesture = step.gesture;
        if (step.turn !== null) {
          turns.push(step.turn);
        }
      }
      return turns;
    };

    it("turns one page for a notch", () => {
      expect(turned([[1000, 100]])).toEqual([1]);
      expect(turned([[1000, -100]])).toEqual([-1]);
      // A wheel that reports lines, not pixels.
      expect(turned([[1000, 3, 0, 1]])).toEqual([1]);
    });

    it("turns one page for a flick on a trackpad, inertia and all", () => {
      // Twenty events over 600 ms, dying away, down to fractions of a pixel.
      const flick: Array<[number, number]> = Array.from({ length: 20 }, (_, index) => [1000 + index * 30, 60 * 0.8 ** index]);
      expect(flick[19][0] - flick[0][0]).toBe(570);
      expect(flick[19][1]).toBeLessThan(1);
      expect(turned(flick)).toEqual([1]);
      // A long spin of a free wheel: one page, however long it runs.
      expect(turned(Array.from({ length: 60 }, (_, index) => [1000 + index * 40, 100] as [number, number]))).toEqual([1]);
    });

    it("turns again for a second notch once the wheel has been quiet", () => {
      expect(turned([[1000, 100], [1400, 100]])).toEqual([1, 1]);
      expect(turned([[1000, 100], [1000 + WHEEL_QUIET_MS, 100]])).toEqual([1, 1]);
      // Too soon: still the same gesture, and it keeps the quiet from starting.
      expect(turned([[1000, 100], [1200, 100], [1400, 100]])).toEqual([1]);
      expect(turned([[1000, 100], [1200, 100], [1400, 100], [1700, 100]])).toEqual([1, 1]);
    });

    it("does not turn back for a wheel that changes its mind mid-gesture", () => {
      // Down, then up within the quiet: one page on. Up again after it: one back.
      expect(turned([[1000, 100], [1100, -100]])).toEqual([1]);
      expect(turned([[1000, 100], [1100, -100], [1500, -100]])).toEqual([1, -1]);
      expect(turned([[1000, 100], [1400, -100], [1800, 100], [2200, -100]])).toEqual([1, -1, 1, -1]);
    });

    it("leaves a resting finger alone", () => {
      expect(turned([[1000, 1]])).toEqual([]);
      expect(turned([[1000, 2], [1900, -1], [2800, 3]])).toEqual([]);
      // Slow, steady movement adds up to a turn.
      expect(turned([[1000, 3], [1050, 3], [1100, 3], [1150, 3]])).toEqual([1]);
      // Jitter either way does not.
      expect(turned([[1000, 3], [1050, -3], [1100, 3], [1150, -3]])).toEqual([]);
      expect(turned([[1000, 0]])).toEqual([]);
    });

    it("goes by the way the wheel moved more", () => {
      // A swipe sideways: right is on, left is back.
      expect(turned([[1000, 5, 80]])).toEqual([1]);
      expect(turned([[1000, -5, -80]])).toEqual([-1]);
      expect(turned([[1000, 80, -20]])).toEqual([1]);
    });
  });

  it("has nowhere to go without a page width", () => {
    expect(pageTurnTarget(0, 0, 5892, 1)).toBeNull();
  });

  it("does not animate for a reader who asked for less motion", () => {
    expect(pageTurnDuration(true)).toBe(0);
    expect(pageTurnDuration(false)).toBeGreaterThan(0);
  });
});
