import { describe, expect, it } from "vitest";
import { ANIMALS } from "./guards";
import { HEART_HOURS, MEADOW_MARK, heartsFor, heartsOf, isFond, meadowMark, nextHeartIn, readMeadowMark } from "./fondness";
import { campStructures, fixCost, fronted, holds, keptForm, newBase, nextCamp, readBase, settle, type BaseState, type BuildingId, type Now } from "./rules";
import { beforeChapters } from "./testing";

const DAY = "2026-10-12";
const at = (minutes: number, day = DAY, today = 5): Now => ({ minutes, day, lit: false, today });
const camp = (change: Partial<BaseState> = {}, levels: Partial<Record<BuildingId, number>> = {}): BaseState => {
  const fresh = newBase(1000, DAY);
  return beforeChapters({ ...fresh, ...change, levels: { ...fresh.levels, ...levels } });
};
/** A camp at so many minutes with one animal that came so many minutes before. */
const withAnimal = (animal: number, since: number, change: Partial<BaseState> = {}, levels: Partial<Record<BuildingId, number>> = {}): BaseState => {
  const base = { ...camp({ acorns: 100, camps: 10, ...change }, { burrow: 3, store: 2, fence: 2, hut: 2, ...levels }), minutes: 5000 };
  const animalsFrom = Array.from({ length: ANIMALS.length }, (_, id) => (id === animal ? base.minutes - since : -1));
  return { ...base, animals: [animal], animalsFrom };
};

describe("an animal's hearts", () => {
  it("are earned at 3, 10 and 25 hours read since it came, and never lost", () => {
    expect(HEART_HOURS).toEqual([3, 10, 25]);
    expect([0, 179, 180, 599, 600, 1499, 1500, 99_999].map(heartsFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    const hen = withAnimal(0, 0);
    expect(heartsOf(hen, 0)).toBe(0);
    expect(heartsOf(hen, 0, hen.minutes + 600)).toBe(2);
    expect(nextHeartIn(hen, 0)).toBe(180);
    expect(nextHeartIn(hen, 0, hen.minutes + 1500)).toBeNull();
    // An animal not here has none; a camp that has none of the field reads as none.
    expect(heartsOf(hen, 1, hen.minutes + 9999)).toBe(0);
    expect(heartsOf({ ...hen, animalsFrom: undefined as unknown as number[] }, 0, hen.minutes + 9999)).toBe(0);
  });

  it("are counted from when the animal came: `settle` writes it down, and a new heart is a line in the journal", () => {
    const base = camp({ animals: [], decor: Array.from({ length: 12 }, (_, index) => ({ kind: 10, x: 40 + index * 12, y: 100 })) }, { burrow: 4, store: 2 });
    const came = settle(base, at(base.minutes + 10));
    expect(came.animals.length).toBeGreaterThan(0);
    for (const animal of came.animals) expect(came.animalsFrom[animal]).toBe(base.minutes + 10);
    for (const animal of ANIMALS) if (!came.animals.includes(animal.id)) expect(came.animalsFrom[animal.id]).toBe(-1);
    const later = settle(came, at(came.minutes + 180));
    expect(heartsOf(later, came.animals[0])).toBe(1);
    expect(later.events.some((event) => /has a home in the meadow/.test(event.text))).toBe(true);
    // A camp from before them: its animals start counting where its reading is.
    const old = settle({ ...came, animalsFrom: [] }, at(came.minutes));
    for (const animal of came.animals) expect(old.animalsFrom[animal]).toBe(came.minutes);
  });
});

describe("each animal's good thing", () => {
  it("doubles at three hearts, and not before", () => {
    const two = (animal: number, change: Partial<BaseState> = {}) => withAnimal(animal, 600, change);
    const three = (animal: number, change: Partial<BaseState> = {}) => withAnimal(animal, 1500, change);
    expect(isFond(two(0), 0)).toBe(false);
    expect(isFond(three(0), 0)).toBe(true);
    const none = { ...camp({ acorns: 100, camps: 10 }, { burrow: 3, store: 2, fence: 2, hut: 2 }), minutes: 5000 };
    // The tortoise: the larder a tenth, then a fifth more.
    expect(holds(two(5))).toBe(Math.round(holds(none) * 1.1));
    expect(holds(three(5))).toBe(Math.round(holds(none) * 1.2));
    // The fox: loot.
    expect(nextCamp(two(4)).loot).toBe(Math.round(nextCamp(none).loot * 1.1));
    expect(nextCamp(three(4)).loot).toBe(Math.round(nextCamp(none).loot * 1.2));
    // The owl: mending a quarter off, then half.
    const knocked = { harm: { store: 2 } } as Partial<BaseState>;
    expect(fixCost(two(3, knocked), "store")).toBe(Math.ceil(fixCost({ ...none, ...knocked }, "store") * 0.75));
    expect(fixCost(three(3, knocked), "store")).toBe(Math.ceil(fixCost({ ...none, ...knocked }, "store") * 0.5));
    // The goat: the wall a quarter longer, then half as long again.
    const wall = (state: BaseState) => campStructures(fronted(state), false).find((entry) => entry.kind === "wall")!.max;
    expect(wall(two(2))).toBe(Math.round(wall(none) * 1.25));
    expect(wall(three(2))).toBe(Math.round(wall(none) * 1.5));
  });

  it("the hen lays on a day there is reading, once a day: two eggs once she is fond of the camp", () => {
    const hen = withAnimal(0, 600);
    expect(settle(hen, at(hen.minutes, DAY, 0)).parcels).toBe(hen.parcels);
    const laid = settle(hen, at(hen.minutes));
    expect(laid.parcels).toBe(hen.parcels + 1);
    expect(settle(laid, at(laid.minutes)).parcels).toBe(laid.parcels);
    const fond = withAnimal(0, 1500);
    expect(settle(fond, at(fond.minutes)).parcels).toBe(fond.parcels + 2);
  });
});

describe("the meadow's mark", () => {
  it("is short, and reads back what it wrote", () => {
    const mark = meadowMark(12345, [100, -1, 2000, -1, -1, 99_999]);
    expect(mark.startsWith(MEADOW_MARK)).toBe(true);
    expect(mark.length).toBeLessThanOrEqual(80);
    expect(readMeadowMark(["oak", mark])).toEqual({ seenAt: 12345, animalsFrom: [100, -1, 2000, -1, -1, 99_999] });
    expect(readMeadowMark(["oak"])).toBeNull();
    expect(readMeadowMark([`${MEADOW_MARK}zz`])).toBeNull();
  });

  it("keeps when the camp was arrived at and when each animal came, through a save by a build that knows neither", () => {
    const base: BaseState = { ...withAnimal(2, 700), seenAt: 900 };
    const saved = JSON.parse(JSON.stringify(keptForm(base)));
    // A 1.5.9 build: what it does not know is gone, `taught` is kept as it is.
    delete saved.seenAt;
    delete saved.animalsFrom;
    const back = readBase(saved)!;
    expect(back.seenAt).toBe(900);
    expect(back.animalsFrom).toEqual(base.animalsFrom);
    expect(back.taught.some((entry) => entry.startsWith(MEADOW_MARK))).toBe(false);
    // The fields win over the mark where both are there.
    const both = readBase({ ...JSON.parse(JSON.stringify(keptForm(base))), seenAt: 950 })!;
    expect(both.seenAt).toBe(950);
    // And with neither, a camp starts where its reading is.
    const none = JSON.parse(JSON.stringify(base));
    delete none.seenAt;
    delete none.animalsFrom;
    const fresh = readBase(none)!;
    expect(fresh.seenAt).toBe(fresh.minutes);
    expect(fresh.animalsFrom[2]).toBe(fresh.minutes);
    expect(fresh.animalsFrom[0]).toBe(-1);
  });
});
