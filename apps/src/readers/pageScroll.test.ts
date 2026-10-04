import { describe, expect, it } from "vitest";
import {
  PAGE_GAP,
  columnHeight,
  currentPageAt,
  isJump,
  layOut,
  pageBox,
  pageIndexAt,
  pageScale,
  pagesNear,
  pagesWanted,
  placeAt,
  planDraw,
  positionOf,
  scrollForAnchor,
  type DrawState
} from "./pageScroll";

/** Ten pages 1,000 tall: page i begins at i * (1000 + gap). */
const even = layOut(10, () => 1000);
const STEP = 1000 + PAGE_GAP;

describe("the column of pages", () => {
  it("gives a page its size at a scale, border included", () => {
    expect(pageBox({ width: 595, height: 842 }, 1.5)).toEqual({ width: 894, height: 1265 });
  });

  it("begins each page a gap after the one before", () => {
    expect(Array.from(even.slice(0, 3))).toEqual([0, STEP, 2 * STEP]);
    expect(columnHeight(even)).toBe(10 * STEP - PAGE_GAP);
    expect(columnHeight(layOut(0, () => 1000))).toBe(0);
  });

  it("lays out pages of different sizes, a landscape page among portrait ones", () => {
    const mixed = layOut(4, (index) => (index === 2 ? 500 : 1000));
    expect(Array.from(mixed)).toEqual([0, STEP, 2 * STEP, 2 * STEP + 500 + PAGE_GAP, 3 * STEP + 500 + PAGE_GAP]);
  });

  it("draws a page too wide for the window at the scale that fits it, under a fit", () => {
    const portrait = { width: 595, height: 842 };
    const landscape = { width: 842, height: 595 };
    // Fit width for the portrait page in a room 878 wide.
    const scale = 878 / 595;
    expect(pageScale(portrait, scale, 878)).toBe(scale);
    expect(pageScale(landscape, scale, 878)).toBeCloseTo(878 / 842, 6);
    expect(pageBox(landscape, pageScale(landscape, scale, 878))).toEqual({ width: 880, height: 622 });
    // A narrower page is not blown up to the window: it keeps the document's scale.
    expect(pageScale({ width: 420, height: 595 }, scale, 878)).toBe(scale);
  });

  it("keeps one scale for every page at a zoom the reader chose", () => {
    const landscape = { width: 842, height: 595 };
    expect(pageScale(landscape, 2, null)).toBe(2);
    expect(pageBox(landscape, pageScale(landscape, 2, null)).width).toBe(1686);
  });

  it("lays out a book of mixed pages with each at its own scale", () => {
    const sizes = [
      { width: 595, height: 842 },
      { width: 842, height: 595 },
      { width: 420, height: 595 },
      { width: 595, height: 842 }
    ];
    const scale = 878 / 595;
    const heights = sizes.map((size) => pageBox(size, pageScale(size, scale, 878)).height);
    expect(heights).toEqual([1244, 622, 880, 1244]);
    const tops = layOut(4, (index) => heights[index]);
    expect(Array.from(tops)).toEqual([0, 1244 + PAGE_GAP, 1866 + 2 * PAGE_GAP, 2746 + 3 * PAGE_GAP, 3990 + 4 * PAGE_GAP]);
    // No page is wider than the room and its border.
    sizes.forEach((size) => expect(pageBox(size, pageScale(size, scale, 878)).width).toBeLessThanOrEqual(880));
  });

  it("finds the page a point is in, the gap after a page counting as that page", () => {
    expect(pageIndexAt(even, 0)).toBe(0);
    expect(pageIndexAt(even, 999)).toBe(0);
    expect(pageIndexAt(even, 1010)).toBe(0);
    expect(pageIndexAt(even, STEP)).toBe(1);
    expect(pageIndexAt(even, -50)).toBe(0);
    expect(pageIndexAt(even, 1e9)).toBe(9);
  });

  it("finds it among a thousand pages without walking them", () => {
    const long = layOut(1200, (index) => 800 + (index % 7) * 30);
    for (const page of [0, 1, 599, 600, 1199]) {
      expect(pageIndexAt(long, long[page])).toBe(page);
      expect(pageIndexAt(long, long[page] + 400)).toBe(page);
    }
  });

  it("names the pages in and near the window", () => {
    // A window 800 tall with its top half way down page 3.
    expect(pagesNear(even, 3 * STEP + 500, 800, 0)).toEqual({ first: 3, last: 4 });
    expect(pagesNear(even, 3 * STEP + 500, 800, 800)).toEqual({ first: 2, last: 5 });
    expect(pagesNear(even, 0, 800, 800)).toEqual({ first: 0, last: 1 });
  });
});

describe("the page the reader is on", () => {
  it("is the one across the line a third of the way down the window", () => {
    // The top of the window is 100 above page 4's top: the line, 300 down, is in page 4.
    expect(currentPageAt(even, 4 * STEP - 100, 900)).toBe(4);
    // 400 above: the line is still in page 3.
    expect(currentPageAt(even, 4 * STEP - 400, 900)).toBe(3);
  });

  it("is the first page at the very start and the last at the very end", () => {
    expect(currentPageAt(even, 0, 900)).toBe(0);
    const short = layOut(3, (index) => (index === 2 ? 200 : 1000));
    const end = columnHeight(short) - 900;
    // The last page is too short ever to reach the line.
    expect(pageIndexAt(short, end + 300)).toBe(1);
    expect(currentPageAt(short, end, 900)).toBe(2);
  });
});

describe("keeping the place", () => {
  it("is a page and a share of its height, and comes back to the same point", () => {
    const place = placeAt(even, 3 * STEP + 250);
    expect(place).toEqual({ page: 3, fraction: 0.25, extra: 0 });
    expect(positionOf(even, place)).toBe(3 * STEP + 250);
    const inGap = placeAt(even, 3 * STEP + 1007);
    expect(inGap).toEqual({ page: 3, fraction: 1, extra: 7 });
    expect(positionOf(even, inGap)).toBe(3 * STEP + 1007);
  });

  it("does not move when a page above it takes its real size", () => {
    // The reader's line, a third down a window of 900, is a quarter down page 5.
    const viewHeight = 900;
    const before = 5 * STEP + 250 - viewHeight / 3;
    const anchor = { place: placeAt(even, before + viewHeight / 3), offset: viewHeight / 3 };
    // Pages 1 and 2 turn out to be landscape: 400 tall, not 1,000.
    const sized = layOut(10, (index) => (index === 1 || index === 2 ? 400 : 1000));
    const after = scrollForAnchor(sized, anchor);
    expect(after).toBe(before - 1200);
    // The same point of page 5 is at the same height in the window.
    expect(positionOf(sized, anchor.place) - after).toBe(viewHeight / 3);
  });

  it("keeps the same share of a page whose own size changed", () => {
    const anchor = { place: placeAt(even, 5 * STEP + 500), offset: 300 };
    const sized = layOut(10, (index) => (index === 5 ? 600 : 1000));
    expect(scrollForAnchor(sized, anchor)).toBe(5 * STEP + 300 - 300);
  });

  it("holds a page's top at the top of the window through sizes arriving above it (a jump, a reopening)", () => {
    const anchor = { place: { page: 7, fraction: 0, extra: 0 }, offset: 0 };
    expect(scrollForAnchor(even, anchor)).toBe(7 * STEP);
    const sized = layOut(10, (index) => (index === 6 ? 1400 : 1000));
    expect(scrollForAnchor(sized, anchor)).toBe(7 * STEP + 400);
  });

  it("keeps the place at another zoom", () => {
    const anchor = { place: placeAt(even, 2 * STEP + 400), offset: 250 };
    const zoomed = layOut(10, () => 2000);
    expect(scrollForAnchor(zoomed, anchor)).toBe(2 * (2000 + PAGE_GAP) + 800 - 250);
  });

  it("keeps a place above the first page: the room the scroller has over the column", () => {
    // The window's top 100 above the column, as when a book is at its very start.
    const place = placeAt(even, -100);
    expect(place).toEqual({ page: 0, fraction: 0, extra: -100 });
    expect(scrollForAnchor(even, { place, offset: 0 })).toBe(-100);
  });

  it("takes what was stored, whatever it is", () => {
    expect(positionOf(even, { page: 99, fraction: Number.NaN, extra: Number.NaN })).toBe(9 * STEP);
    expect(positionOf(even, { page: -4, fraction: 7, extra: 0 })).toBe(1000);
  });
});

describe("what to draw and what to let go", () => {
  const MEGA = 1_000_000;
  const state = (over: Partial<DrawState>): DrawState => ({
    wanted: [5, 6, 4, 7],
    drawn: new Map(),
    fresh: new Set(),
    pixelsOf: () => 2 * MEGA,
    distanceOf: (page) => Math.abs(page - 5),
    budget: 12 * MEGA,
    ...over
  });

  it("draws the nearest wanted page that is not drawn", () => {
    expect(planDraw(state({}))).toEqual({ draw: 5, release: [] });
    expect(planDraw(state({ drawn: new Map([[5, 2 * MEGA]]), fresh: new Set([5]) }))).toEqual({ draw: 6, release: [] });
  });

  it("has nothing to do when everything wanted is drawn", () => {
    const drawn = new Map([5, 6, 4, 7].map((page) => [page, 2 * MEGA]));
    expect(planDraw(state({ drawn, fresh: new Set(drawn.keys()) }))).toEqual({ draw: null, release: [] });
  });

  it("lets go of the furthest pages first to make room: a drawing page needs its size twice", () => {
    // Five pages held (10M) and 4M needed, with 12M to spend: one page must go, the furthest.
    const drawn = new Map([1, 2, 3, 4, 6].map((page) => [page, 2 * MEGA]));
    expect(planDraw(state({ wanted: [5], drawn, fresh: new Set(drawn.keys()) }))).toEqual({ draw: 5, release: [1] });
  });

  it("never lets go of a nearer page for a further one: that page waits", () => {
    // Zoomed far in: each page is 5M. Pages 5 and 6 are held (10M); page 7 would need 10M more.
    const drawn = new Map([
      [5, 5 * MEGA],
      [6, 5 * MEGA]
    ]);
    const plan = planDraw(state({ wanted: [5, 6, 7], drawn, fresh: new Set([5, 6]), pixelsOf: () => 5 * MEGA }));
    expect(plan).toEqual({ draw: null, release: [] });
  });

  it("always draws the page in view, even alone past the budget", () => {
    expect(planDraw(state({ wanted: [5], pixelsOf: () => 9 * MEGA }))).toEqual({ draw: 5, release: [] });
  });

  it("redraws a page drawn for another zoom, keeping its old canvas until the new one lands", () => {
    const drawn = new Map([
      [5, 2 * MEGA],
      [6, 2 * MEGA]
    ]);
    expect(planDraw(state({ wanted: [5, 6], drawn, fresh: new Set() }))).toEqual({ draw: 5, release: [] });
  });

  it("holds to the budget across a long scroll", () => {
    // Read forward through 300 pages, drawing what the plan says and letting go what it says.
    const drawn = new Map<number, number>();
    let peak = 0;
    for (let current = 0; current < 300; current += 1) {
      const wanted = [current, current + 1, current - 1].filter((page) => page >= 0);
      for (let turn = 0; turn < 6; turn += 1) {
        const plan = planDraw({
          wanted,
          drawn,
          fresh: new Set(drawn.keys()),
          pixelsOf: () => 2.5 * MEGA,
          distanceOf: (page) => Math.abs(page - current),
          budget: 12 * MEGA
        });
        plan.release.forEach((page) => drawn.delete(page));
        if (plan.draw === null) {
          break;
        }
        const held = [...drawn.values()].reduce((sum, pixels) => sum + pixels, 0);
        peak = Math.max(peak, held + 2 * 2.5 * MEGA);
        drawn.set(plan.draw, 2.5 * MEGA);
      }
      // What is in view is always drawn.
      expect(drawn.has(current)).toBe(true);
    }
    expect(peak).toBeLessThanOrEqual(12 * MEGA);
    expect(drawn.size).toBeLessThanOrEqual(4);
  });
});

describe("the pages wanted for a window", () => {
  it("are those in view first, from the reader's page outwards, then those waiting outside", () => {
    // Window 800 tall, its top 700 down page 3: pages 3 and 4 in view; 2 and 5 near.
    const top = 3 * STEP + 700;
    const near = pagesNear(even, top, 800, 800);
    expect(pagesWanted(even, top, 800, near)).toEqual([3, 4, 2, 5]);
  });
});

describe("a jump", () => {
  it("is a move of more than a window at once", () => {
    expect(isJump(0, 400, 900)).toBe(false);
    expect(isJump(0, 5000, 900)).toBe(true);
    expect(isJump(9000, 200, 900)).toBe(true);
  });
});
