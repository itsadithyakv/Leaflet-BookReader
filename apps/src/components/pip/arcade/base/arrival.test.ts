import { describe, expect, it } from "vitest";
import { chapterStartsAt } from "../../../../pip/base/chapters";
import { RAID_EVERY, newBase, oakHolds, readBase, seeArrival, type BaseState } from "../../../../pip/base/rules";
import { ARRIVAL_MS, PAGES_MOST, arrivalOf, barFillAt, pageStarts, pagesFor } from "./arrival";
import { fillOf } from "./chapterWords";
import { clearOfCovers, trailPoint } from "./collect";

const DAY = "2026-10-12";
/** A camp read to `seen` minutes when last arrived at, its oak and raids counted from there. */
const camp = (seen: number, change: Partial<BaseState> = {}): BaseState => ({ ...newBase(seen, DAY), minutes: seen, seenAt: seen, ...change });

describe("arriving after reading", () => {
  it("sends up a page for every quarter hour or so, six at most; three on the lighter tier, none on the lightest or with motion still", () => {
    expect(pagesFor(4, "full")).toBe(0);
    expect(pagesFor(5, "full")).toBe(1);
    expect(pagesFor(15, "full")).toBe(2);
    expect(pagesFor(60, "full")).toBe(5);
    expect(pagesFor(600, "full")).toBe(PAGES_MOST.full);
    expect(pagesFor(600, "lite")).toBe(3);
    expect(pagesFor(600, "minimal")).toBe(0);
    expect(pagesFor(600, "full", true)).toBe(0);
    expect(pageStarts(3)).toEqual([0, ARRIVAL_MS.gap, 2 * ARRIVAL_MS.gap]);
  });

  it("is nothing for a few minutes, and once seen is not seen again", () => {
    const base = camp(600);
    expect(arrivalOf(base, 604, "full", false, true)).toBeNull();
    const after = arrivalOf(base, 640, "full", false, true)!;
    expect(after.delta).toBe(40);
    const seen = seeArrival(base, 640);
    expect(seen.seenAt).toBe(640);
    expect(seeArrival(seen, 640)).toBe(seen);
    expect(seeArrival(seen, 600)).toBe(seen);
    expect(arrivalOf(seen, 640, "full", false, true)).toBeNull();
  });

  it("peels a page off to the Raid key only when the scouts got more rest, and to the meadow only when the bud grew", () => {
    const base = camp(600, { raidFrom: 600 - RAID_EVERY, claimed: 600 });
    // Under a quarter hour more: the scouts are not rested for another yet, and the bud has not grown.
    const little = arrivalOf(base, 606, "full", false, true)!;
    expect(little.toRaid).toBe(false);
    expect(little.toMeadow).toBe(false);
    const more = arrivalOf(base, 640, "full", false, true)!;
    expect(more.after.raids).toBeGreaterThan(more.before.raids);
    expect(more.toRaid).toBe(true);
    expect(more.after.bud).toBeGreaterThan(more.before.bud);
    expect(more.toMeadow).toBe(true);
    // Not to a meadow that is not open; and nothing peels off where nothing flies.
    expect(arrivalOf(base, 640, "full", false, false)!.toMeadow).toBe(false);
    expect(arrivalOf(base, 640, "minimal", false, true)!.toRaid).toBe(false);
  });

  it("steps the chapter bar up to where the reading has it, and through a chapter crossed (into the volumes too)", () => {
    const base = camp(200);
    const plain = arrivalOf(base, 260, "full", false, true)!;
    expect(plain.crossed).toBe(false);
    const end = ARRIVAL_MS.bar + ARRIVAL_MS.fly + ARRIVAL_MS.fill;
    expect(barFillAt(plain, 0)).toBe(fillOf(plain.before.part));
    expect(barFillAt(plain, end)).toBe(fillOf(plain.after.part));
    for (let t = 0; t <= end + 100; t += 37) expect(Number.isInteger(barFillAt(plain, t))).toBe(true);
    const into = chapterStartsAt(11);
    const crossing = arrivalOf(camp(into - 30), into + 30, "full", false, true)!;
    expect(crossing.crossed).toBe(true);
    expect(crossing.after.chapter).toBe(11);
    expect(barFillAt(crossing, ARRIVAL_MS.bar + ARRIVAL_MS.fly + ARRIVAL_MS.fill + 10)).toBe(44);
    expect(barFillAt(crossing, crossing.ends)).toBe(fillOf(crossing.after.part));
    expect(crossing.ends).toBeGreaterThan(plain.ends);
    // With nothing flying, the bar is at once where it ends.
    expect(barFillAt(arrivalOf(base, 260, "minimal", false, true)!, 0)).toBe(fillOf(plain.after.part));
  });

  it("says the oak is full after a long time away, never a figure of thousands", () => {
    const away = camp(600, { oakFrom: 600 });
    const long = arrivalOf(away, 600 + 60 * 60, "full", false, true)!;
    expect(long.since.oakFull).toBe(true);
    expect(long.since.oak).toBeLessThanOrEqual(oakHolds(away));
    const short = arrivalOf(away, 620, "full", false, true)!;
    expect(short.since.oakFull).toBe(false);
    expect(short.since.oak).toBeGreaterThan(0);
  });

  it("starts an older camp where its reading is, so it does not arrive with everything it ever read", () => {
    const old = JSON.parse(JSON.stringify(camp(900)));
    delete old.seenAt;
    const read = readBase(old)!;
    expect(read.seenAt).toBe(read.minutes);
    expect(arrivalOf(read, read.minutes, "full", false, true)).toBeNull();
  });

  it("flies its pages on whole device pixels", () => {
    for (const dpr of [1, 2, 2.75]) {
      for (let t = 0; t <= 1; t += 0.07) {
        const at = trailPoint({ x: 10.3, y: 200.7 }, { x: 300.2, y: 40.9 }, t, 30, dpr);
        expect(Math.abs(at.x * dpr - Math.round(at.x * dpr))).toBeLessThan(1e-6);
        expect(Math.abs(at.y * dpr - Math.round(at.y * dpr))).toBeLessThan(1e-6);
      }
    }
  });
});

describe("where the pages land", () => {
  const box = (left: number, top: number, w: number, h: number) => ({ getBoundingClientRect: () => ({ left, top, right: left + w, bottom: top + h, width: w, height: h }) }) as unknown as Element;
  const canvas = box(0, 0, 844, 390);

  it("is never under Pip's line: just below it, or beside it where there is no room below", () => {
    const say = box(60, 40, 380, 70);
    const landed = clearOfCovers({ x: 120, y: 80 }, [say], canvas)!;
    expect(landed.y).toBeGreaterThan(110 + 10);
    expect(landed.x).toBe(120);
    const low = box(60, 300, 380, 85);
    const beside = clearOfCovers({ x: 120, y: 340 }, [low], canvas)!;
    expect(beside.x).toBeGreaterThan(440);
    // Nothing over it: where it was.
    expect(clearOfCovers({ x: 600, y: 200 }, [say], canvas)).toEqual({ x: 600, y: 200 });
    expect(clearOfCovers(null, [say], canvas)).toBeNull();
  });
});
