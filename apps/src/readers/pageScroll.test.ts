import { describe, expect, it } from "vitest";
import {
  PAGE_GAP,
  columnHeight,
  currentPageAt,
  isJump,
  layOut,
  lineKey,
  pageBox,
  pageIndexAt,
  pageScale,
  pagesNear,
  pagesWanted,
  parseLineKey,
  placeAt,
  placeToOpen,
  placeWithin,
  planDraw,
  positionOf,
  scrollForAnchor,
  sharpEnough,
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

describe("the reader's line as a key", () => {
  it("names the page and how far down it, and reads back", () => {
    expect(lineKey(150, 0.42230204)).toBe("150:0.4223");
    expect(parseLineKey("150:0.4223")).toEqual({ page: 150, fraction: 0.4223 });
    expect(parseLineKey(lineKey(1, 0))).toEqual({ page: 1, fraction: 0 });
    expect(parseLineKey(lineKey(600, 1))).toEqual({ page: 600, fraction: 1 });
  });

  it("is the same key for the same line, so two jumps from one line are one place to go back to", () => {
    expect(lineKey(12, 0.33331)).toBe(lineKey(12, 0.33334));
  });

  it("keeps what it is given inside a page", () => {
    expect(lineKey(0, -3)).toBe("1:0");
    expect(lineKey(7.4, 9)).toBe("7:1");
    expect(lineKey(7, Number.NaN)).toBe("7:0");
  });

  it("makes nothing of what is not a line", () => {
    expect(parseLineKey("epubcfi(/6/14!/4/2)")).toBeNull();
    expect(parseLineKey("12")).toBeNull();
    expect(parseLineKey("0:0.5")).toBeNull();
    expect(parseLineKey("3:1.5")).toBeNull();
    expect(parseLineKey(null)).toBeNull();
  });
});

describe("where a book reopens", () => {
  it("is the stored place when it was noted on the page the progress names", () => {
    expect(placeToOpen({ page: 150, fraction: 0.42, extra: 0, current: 150 }, 150)).toEqual({ page: 150, fraction: 0.42, extra: 0 });
    // The top of the window in the gap after the page before.
    expect(placeToOpen({ page: 149, fraction: 1, extra: 6, current: 150 }, 150)).toEqual({ page: 149, fraction: 1, extra: 6 });
  });

  it("keeps a place whose window began several pages back (small pages, a zoom far out)", () => {
    // At 25% on a tall window the line a third down is two or three pages below the top.
    expect(placeToOpen({ page: 147, fraction: 0.6, extra: 0, current: 150 }, 150)).toEqual({ page: 147, fraction: 0.6, extra: 0 });
  });

  it("is the top of the page when the progress has moved on (another device)", () => {
    expect(placeToOpen({ page: 150, fraction: 0.42, extra: 0, current: 150 }, 212)).toEqual({ page: 212, fraction: 0, extra: 0 });
    expect(placeToOpen({ page: 150, fraction: 0.42, extra: 0, current: 150 }, 151)).toEqual({ page: 151, fraction: 0, extra: 0 });
  });

  it("takes a place stored before the page was kept with it by how near it is", () => {
    expect(placeToOpen({ page: 149, fraction: 0.9, extra: 0 }, 150)).toEqual({ page: 149, fraction: 0.9, extra: 0 });
    expect(placeToOpen({ page: 147, fraction: 0.9, extra: 0 }, 150)).toEqual({ page: 150, fraction: 0, extra: 0 });
  });

  it("makes nothing of what is not a place", () => {
    expect(placeToOpen(null, 9)).toEqual({ page: 9, fraction: 0, extra: 0 });
    expect(placeToOpen("page 3", 9)).toEqual({ page: 9, fraction: 0, extra: 0 });
    expect(placeToOpen({ page: 9, fraction: Number.NaN, extra: 0, current: 9 }, 9)).toEqual({ page: 9, fraction: 0, extra: 0 });
  });
});

describe("the place on a page shown on its own", () => {
  it("is how far down the page the top of the window is", () => {
    expect(placeWithin(150, 525, 1244)).toEqual({ page: 150, fraction: 525 / 1244, extra: 0 });
    expect(placeWithin(3, 1244, 1244)).toEqual({ page: 3, fraction: 1, extra: 0 });
  });

  it("is kept in pixels above the page and below it, where the stage's own room is", () => {
    expect(placeWithin(1, -96, 1244)).toEqual({ page: 1, fraction: 0, extra: -96 });
    expect(placeWithin(1, 1250, 1244)).toEqual({ page: 1, fraction: 1, extra: 6 });
  });

  it("means the same in the column: a page closed part way down reopens there in either layout", () => {
    // Page 4 (index 3) of the even column, 250 down it.
    const single = placeWithin(3, 250, 1000);
    expect(single).toEqual(placeAt(even, 3 * STEP + 250));
    expect(positionOf(even, single)).toBe(3 * STEP + 250);
  });

  it("is the top of the page when the page has no size yet", () => {
    expect(placeWithin(7, 300, 0)).toEqual({ page: 7, fraction: 0, extra: 0 });
    expect(placeWithin(7, Number.NaN, 900)).toEqual({ page: 7, fraction: 0, extra: 0 });
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

describe("the page being read is drawn sharper than its neighbours", () => {
  const NEAR = 1 << 23;
  const READING = 1 << 24;
  // A fit-width page on a 4K screen at 200%: 1,428 x 2,020 CSS pixels, 11.5M device pixels wanted.
  const big = { width: 1428, height: 2020 };

  it("is not sharp enough at its neighbours' cap, and is at its own", () => {
    expect(sharpEnough(big, 2, NEAR, READING)).toBe(false);
    expect(sharpEnough(big, 2, READING, READING)).toBe(true);
    // Once drawn sharp it stays good when it is a neighbour again.
    expect(sharpEnough(big, 2, READING, NEAR)).toBe(true);
  });

  it("needs no second drawing where the cap is not met: the same page at 150%, or a smaller one", () => {
    expect(sharpEnough(big, 1.5, NEAR, READING)).toBe(true);
    expect(sharpEnough({ width: 880, height: 1244 }, 2, NEAR, READING)).toBe(true);
  });

  it("is never sharp enough past both caps unless drawn at the higher", () => {
    const poster = { width: 3180, height: 4495 };
    expect(sharpEnough(poster, 1.5, NEAR, READING)).toBe(false);
    expect(sharpEnough(poster, 1.5, READING, READING)).toBe(true);
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
