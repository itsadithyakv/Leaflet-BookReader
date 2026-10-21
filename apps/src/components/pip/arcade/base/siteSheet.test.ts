import { describe, expect, it } from "vitest";
import { chapterOfBurrow, chapterStartsAt } from "../../../../pip/base/chapters";
import { fronted, hides, newBase, priceOf, type BaseState, type BuildingId } from "../../../../pip/base/rules";
import { levelSays, needsOf, plotChoices, plotComesAt, reachOf, sheetOf, trailWord, whyNot } from "./siteSheet";

const DAY = "2026-10-19";
/** A camp that has read so many minutes, its burrow where that chapter puts it, the oak and the larder built, 55 acorns. */
const camp = (minutes: number, change: Partial<BaseState> = {}, levels: Partial<Record<BuildingId, number>> = {}): BaseState => {
  const base = newBase(minutes, DAY);
  return { ...base, acorns: 55, ...change, levels: { ...base.levels, oak: 1, store: 1, ...levels } };
};

describe("a building's sheet (1.5.10)", () => {
  it("never sells the burrow: it grows with the chapters, and says which chapter raises it next", () => {
    const sheet = sheetOf(camp(0, {}, { burrow: 1 }), "burrow");
    expect(sheet.action).toBeNull();
    expect(sheet.next).toBeNull();
    expect(sheet.grows).toEqual({ chapter: chapterOfBurrow(2), level: 2, title: "Chapter 3: The Lookout" });
    expect(sheetOf(camp(0, {}, { burrow: 5 }), "burrow").grows).toBeNull();
  });

  it("names the chapter a building's next level waits for, met or not, and the acorns as have / need", () => {
    const oak = sheetOf(camp(0, { acorns: 100 }, { burrow: 1 }), "oak");
    expect(oak.next?.price).toBe(priceOf(camp(0), "oak", 2));
    expect(oak.next?.needs).toEqual([
      { id: "chapter", label: "Chapter 3", ok: false, need: 3 },
      { id: "acorns", label: `100 / ${oak.next?.price}`, ok: true, have: 100, need: oak.next?.price }
    ]);
    expect(oak.action?.why).toBe("Comes with chapter 3: keep reading");
  });

  it("says Build for a building not yet up, and that the fence comes with chapter 4", () => {
    const fence = sheetOf(camp(0, { acorns: 100 }, { burrow: 1 }), "fence");
    expect(fence).toMatchObject({ level: 0, now: "Not built yet", action: { label: "Build" } });
    expect(fence.next?.needs.find((need) => need.id === "chapter")).toMatchObject({ label: "Chapter 4", ok: false });
  });

  it("never asks for a bigger larder: nothing has a cap", () => {
    const needs = needsOf(camp(10 * 60, { acorns: 9999 }, { burrow: 3 }), "oak");
    expect(needs.some((need) => (need.id as string) === "larder")).toBe(false);
  });

  it("says when a prowler's knocks are in the way, and nothing is left to build at the top", () => {
    const knocked = camp(10 * 60, { acorns: 999, harm: { oak: 1 } }, { burrow: 3, store: 3 });
    expect(needsOf(knocked, "oak")[0]).toEqual({ id: "fix", label: "Fix it first", ok: false });
    expect(sheetOf(knocked, "oak").action?.why).toBe("A prowler knocked it about: fix it first");
    expect(sheetOf(camp(45 * 60, {}, { burrow: 5, oak: 5 }), "oak").next).toBeNull();
  });

  it("charges less where Pip is happy", () => {
    const at = camp(10 * 60, {}, { burrow: 3 });
    expect(sheetOf(at, "oak", 95).next!.price).toBeLessThan(sheetOf(at, "oak").next!.price);
  });
});

describe("what a level up lets you see", () => {
  it("says the larder keeps more safe once prowlers come, and never speaks of prowlers before", () => {
    const early = camp(30, {}, { burrow: 1 });
    expect(levelSays(early, "store", 2)).toBe("A bigger larder");
    expect(sheetOf(early, "store").now).not.toMatch(/prowler/i);
    const later = camp(4 * 60, {}, { burrow: 2 });
    expect(levelSays(later, "store", 2)).toBe(`Keeps ${hides({ ...later, levels: { ...later.levels, store: 2 } })} acorns safe from prowlers (now ${hides(later)})`);
  });

  it("counts the oak's acorns and the scouts, not bare numbers of reach", () => {
    const at = camp(10 * 60, {}, { burrow: 3, hut: 1 });
    expect(levelSays(at, "oak", 2)).toMatch(/^Drops \d+ acorns every 10 minutes read \(now \d+\)$/);
    expect(levelSays(at, "hut", 2)).toMatch(/^\d+ more scouts, each stronger/);
  });

  it("draws the lookout's next reach further than its reach now", () => {
    const at = camp(10 * 60, {}, { burrow: 3, tower: 1 });
    const now = reachOf(at, "tower", 1);
    const next = reachOf(at, "tower", 2);
    expect(now && next && next.r > now.r).toBe(true);
    expect(levelSays(at, "tower", 2)).toMatch(/^Throws further/);
  });
});

describe("a plot of the yard", () => {
  it("is not there before its chapter, and says the chapter that brings it", () => {
    expect(plotComesAt(camp(0, {}, { burrow: 1 }), "yard0")).toBe(5);
    expect(plotComesAt(camp(10 * 60, {}, { burrow: 3 }), "yard0")).toBeNull();
    expect(plotComesAt(camp(10 * 60, {}, { burrow: 3 }), "yard1")).toBe(9);
    expect(plotComesAt(camp(0), "oak")).toBeNull();
  });

  it("empty, offers each thing it could be, with what it does, its price and why not", () => {
    const empty = camp(10 * 60, { acorns: 100 }, { burrow: 3 });
    expect(sheetOf(empty, "yard0")).toMatchObject({ name: "Empty plot", action: null, next: { brings: "Choose what goes up here", needs: [] } });
    const choices = plotChoices(empty, "yard0");
    expect(choices.map((choice) => choice.kind)).toEqual(["workshop", "hive", "well"]);
    expect(choices[0]).toMatchObject({ name: "Workshop", does: "Everything costs 5% less to build", why: null });
    expect(whyNot(camp(10 * 60, { acorns: 10 }, { burrow: 3 }), "yard0", "hive")).toBe(`${choices[1].price - 10} more acorns`);
  });
});

describe("a building's sheet, and the trail (1.5.11)", () => {
  // A camp of the fifth chapter: prowlers come down the trail, and the wall stands across it.
  const front = (spots: Partial<BaseState["spots"]> = {}) => fronted({ ...camp(chapterStartsAt(5) + 5, {}, { burrow: 3, tower: 2, hut: 1, fence: 2 }), spots: { ...newBase(0, DAY).spots, ...spots } });

  it("says a lookout covers the trail when its reach takes the trail in, and is too far from it when not", () => {
    const near = front({ tower: [88, 76] });
    expect(trailWord(near, "tower")).toBe("covers");
    expect(sheetOf(near, "tower").now).toMatch(/covers the trail/);
    const far = front({ tower: [200, 108] });
    expect(trailWord(far, "tower")).toBe("far");
    expect(sheetOf(far, "tower").now).toMatch(/too far from the trail/);
  });

  it("says a building standing on the trail's side of the wall is outside it", () => {
    const camp = front();
    const outside = { ...camp, spots: { ...camp.spots, hut: [camp.front.x - 20, 100] as [number, number] } };
    expect(trailWord(outside, "hut")).toBe("outside");
    expect(sheetOf(outside, "hut").now).toMatch(/outside the wall/);
  });

  it("says what a level of the wall brings: more sections, a gate, stone", () => {
    expect(levelSays(front(), "fence", 3)).toMatch(/1 more section/);
    expect(levelSays({ ...front(), levels: { ...front().levels, fence: 1 } }, "fence", 2)).toMatch(/with a gate/);
    expect(levelSays({ ...front(), levels: { ...front().levels, fence: 3, burrow: 4 } }, "fence", 4)).toMatch(/in stone/);
  });
});
