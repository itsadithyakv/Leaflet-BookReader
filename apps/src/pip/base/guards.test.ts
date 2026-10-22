import { describe, expect, it } from "vitest";
import { BATTLE_TICK, Battle } from "./battle";
import { ANIMALS, GUARDIANS, GUARD_COSTS, GUARD_MINUTES, GUARD_MOST } from "./guards";
import {
  fronted,
  BUILDINGS,
  DECOR,
  DECOR_MOST,
  MAX_LEVEL,
  YARD_KINDS,
  YARD_MAX,
  campStructures,
  charm,
  costOf,
  decorBlocked,
  does,
  drillLeft,
  fencePieces,
  fixCost,
  guardAt,
  guardBlocked,
  guardCost,
  guardOf,
  hides,
  holds,
  meadowOpen,
  moveDecor,
  newBase,
  nextCamp,
  nightOutcome,
  nightRaiders,
  nightSide,
  oakDrops,
  oakHolds,
  placeDecor,
  postOpen,
  readBase,
  removeDecor,
  scoutsOf,
  settle,
  sideKnown,
  trainGuard,
  yardDoes,
  type BaseState,
  type BuildingId,
  type Now
} from "./rules";
import { beforeChapters } from "./testing";

const DAY = "2026-10-12";
const at = (minutes: number, day = DAY): Now => ({ minutes, day, lit: false });
const camp = (change: Partial<BaseState> = {}, levels: Partial<Record<BuildingId, number>> = {}): BaseState => {
  const fresh = newBase(1000, DAY);
  return beforeChapters({ ...fresh, ...change, levels: { ...fresh.levels, ...levels } });
};
/** A grown camp with a piece of fence down and a plot of the yard built: every guardian's post is there to be taken. */
const grown = (change: Partial<BaseState> = {}) =>
  fronted(camp({ acorns: 5000, yard: [{ kind: "hive", level: 1 }, { kind: null, level: 0 }], ...change }, { burrow: 4, oak: 3, store: 3, fence: 2, tower: 3, hut: 3 }));
const ranks = (rank: number, only?: number) => GUARDIANS.map((guard) => (only === undefined || guard.id === only ? rank : 0));
const part = (state: BaseState, kind: string, name?: string) => campStructures(state, false).find((entry) => entry.kind === kind && (!name || entry.look?.name === name))!;

describe("every upgrade to a building", () => {
  it("makes the one number that building is for bigger, at every level", () => {
    const level = (building: BuildingId, to: number) => camp({}, { burrow: 5, oak: 1, store: 1, fence: 1, tower: 1, hut: 1, [building]: to });
    const rising = (numbers: number[], what: string) => {
      for (let index = 1; index < numbers.length; index++) expect(numbers[index], `${what}, level ${index + 1}`).toBeGreaterThan(numbers[index - 1]);
    };
    const levels = [1, 2, 3, 4, 5];
    rising(levels.map((to) => oakDrops(level("oak", to))), "what the oak drops");
    rising(levels.map((to) => oakHolds(level("oak", to))), "how full the oak looks");
    rising(levels.map((to) => hides(level("store", to))), "what the larder hides");
    // The wall (1.5.11): longer, then tougher, at every level.
    rising(levels.map((to) => campStructures(fronted(level("fence", to)), false).filter((entry) => entry.kind === "wall").reduce((sum, entry) => sum + entry.max, 0)), "the wall, all told");
    rising(levels.map((to) => part(level("tower", to), "perch").range), "how far the lookout throws");
    rising(levels.map((to) => part(level("tower", to), "perch").hit), "how hard the lookout throws");
    rising(levels.map((to) => scoutsOf(level("hut", to))), "scouts");
    rising(levels.map((to) => part(level("hut", to), "other", "hut").hit), "how hard the hut's roof throws");
    rising(levels.map((to) => part(camp({}, { burrow: to }), "nest").max), "how sturdy the burrow is");
    // And the burrow is what lets everything else rise.
    for (const building of BUILDINGS) {
      rising(levels.map((to) => costOf(building, to)), `what ${building} costs`);
      for (const to of levels) expect(does(building, to), `${building} ${to}`).not.toBe(does(building, to - 1));
    }
    expect(MAX_LEVEL).toBe(5);
  });

  it("is so for the yard too: each of the four, at each of its three levels", () => {
    for (const kind of YARD_KINDS) {
      const said = Array.from({ length: YARD_MAX }, (_, index) => yardDoes(kind, index + 1));
      expect(new Set(said).size, kind).toBe(YARD_MAX);
    }
  });
});

describe("the guardians", () => {
  it("are seven, each with a post of their own at a building of the camp", () => {
    expect(GUARDIANS).toHaveLength(7);
    expect(new Set(GUARDIANS.map((guard) => guard.post)).size).toBe(7);
    expect(new Set(GUARDIANS.map((guard) => guard.name)).size).toBe(7);
    expect(guardAt("tower")?.short).toBe("Halvar");
    expect(guardAt("yard0")).toBe(guardAt("yard1"));
    for (const guard of GUARDIANS) expect(guard.does.length).toBeGreaterThan(10);
  });

  it("come to a camp whose burrow has grown, to a building that is there for them", () => {
    const small = camp({ acorns: 5000 }, { burrow: 2, tower: 3 });
    expect(postOpen(small, 0)).toBe(false);
    expect(guardBlocked(small, 0)).toBe("post");
    const ready = grown();
    for (const guard of GUARDIANS) expect(postOpen(ready, guard.id), guard.name).toBe(true);
    // The lookout's needs a lookout worth standing on; the fence's a piece of fence down; the yard's a plot built.
    expect(postOpen({ ...ready, levels: { ...ready.levels, tower: 1 } }, 0)).toBe(false);
    expect(postOpen({ ...ready, levels: { ...ready.levels, fence: 0 } }, 1)).toBe(false);
    expect(postOpen({ ...ready, yard: [{ kind: null, level: 0 }, { kind: null, level: 0 }] }, 5)).toBe(false);
  });

  it("are paid for in acorns, training and all, and take up their post at once, three ranks each", () => {
    const ready = grown();
    // A rank's price: its acorns and its training's minutes at half an acorn each (130, 323, 640).
    expect([1, 2, 3].map(guardCost)).toEqual([1, 2, 3].map((rank) => GUARD_COSTS[rank] + Math.round(GUARD_MINUTES[rank] / 2)));
    expect(guardBlocked({ ...ready, acorns: guardCost(1) - 1 }, 0)).toBe("acorns");
    const paid = trainGuard(ready, 0, 1000);
    expect(paid.acorns).toBe(ready.acorns - guardCost(1));
    // No reading wanted: the next look at the camp (the store does it straight away) has them at their post.
    expect(drillLeft(paid, 1000)).toBe(0);
    const posted = settle(paid, at(1000));
    expect(guardOf(posted, 0)).toBe(1);
    expect(posted.drill).toBeNull();
    expect(posted.events[0].text).toBe("Halvar Longstride has taken up a post at the camp.");
    let top = posted;
    for (let rank = 2; rank <= GUARD_MOST; rank++) top = settle(trainGuard(top, 0, 1000), at(1000));
    expect(guardOf(top, 0)).toBe(GUARD_MOST);
    expect(guardBlocked(top, 0)).toBe("top");
    expect(top.acorns).toBe(ready.acorns - guardCost(1) - guardCost(2) - guardCost(3));
  });

  it("each do one thing for the camp, and more of it at every rank", () => {
    const with_ = (guard: number, rank: number) => grown({ guards: ranks(rank, guard) });
    const each = (measure: (state: BaseState) => number, guard: number) => [0, 1, 2, 3].map((rank) => measure(with_(guard, rank)));
    const rising = (numbers: number[], who: string) => {
      for (let rank = 1; rank < numbers.length; rank++) expect(numbers[rank], `${who}, rank ${rank}`).toBeGreaterThan(numbers[rank - 1]);
    };
    rising(each((state) => part(state, "perch").range, 0), "Halvar: the lookout's reach");
    rising(each((state) => part(state, "wall").max, 1), "Corwin: a section of the wall");
    rising(each((state) => nightRaiders(state).slowed ?? 0, 2), "Mossgather: how much slower they come");
    rising(each((state) => part(state, "hoard").max, 3), "Dame Berit: the larder");
    rising(each((state) => part(state, "hoard").hit, 4), "Emberling: what the larder breathes");
    rising(each((state) => hides(state), 5), "Pim: what the larder hides");
    // The archer makes everything that throws throw sooner: the wait gets shorter.
    rising(each((state) => -part(state, "perch").every, 6), "Ilsa: the lookout's wait");
    rising(each((state) => -part(state, "nest").every, 6), "Ilsa: the burrow's wait");
    // The dragon goes for the ones on the wing first, and each is seen at their post.
    expect(part(with_(4, 1), "hoard")).toMatchObject({ first: "mole", guard: 4 });
    // Everyone else is a figure of their own in the fight, standing at their signpost, and there only once posted.
    const sentry = (state: BaseState, guard: number) => campStructures(state, false).find((entry) => entry.look?.name === "guardian" && entry.look.variant === guard);
    expect(sentry(with_(0, 1), 0)).toMatchObject({ kind: "other", hit: 2 });
    expect(sentry(with_(0, 3), 0)?.hit).toBe(4);
    expect(sentry(with_(0, 0), 0)).toBeUndefined();
    expect(sentry(with_(4, 2), 4)).toBeUndefined();
  });

  it("hold, all seven together, the nights a camp with none of them loses", () => {
    // A camp that is losing nights: a bold flock, the larder by itself at the east edge.
    const bare = { ...grown({ camps: 20, acorns: 1200 }), spots: { ...grown().spots, store: [206, 84] as [number, number] } };
    const days = Array.from({ length: 24 }, (_, index) => `2027-03-${String(index + 1).padStart(2, "0")}`);
    const lost = (state: BaseState) => days.reduce((sum, day) => sum + nightOutcome(state, day, false)!.taken, 0);
    const guarded = { ...bare, guards: ranks(GUARD_MOST) };
    expect(lost(bare)).toBeGreaterThan(0);
    expect(lost(guarded)).toBeLessThan(lost(bare) / 2);
    // And the magpies are no more for it: a guardian is never a reason for more of them.
    expect(nightRaiders(guarded).capacity).toBe(nightRaiders(bare).capacity);
  }, 30_000);
});

describe("magpies by night", () => {
  it("make straight for the larder, and what stands in the way has to come down first", () => {
    const state = camp({}, { burrow: 3, store: 2, hut: 2 });
    const open: BaseState = { ...state, spots: { ...state.spots, store: [200, 90], hut: [60, 70] } };
    const blocked: BaseState = { ...state, spots: { ...state.spots, store: [200, 90], hut: [176, 90] } };
    const firstTarget = (laid: BaseState) => {
      const battle = new Battle({ ...nightRaiders(laid), capacity: 1, kinds: ["sprout"] }, campStructures(laid, false));
      // Put down east of the burrow, with a clear run at the larder unless something is stood in it.
      battle.deploy("sprout", 148, 90);
      battle.step(BATTLE_TICK);
      return battle.structures[battle.units[0].target!].look?.name;
    };
    expect(firstTarget(open)).toBe("store");
    expect(firstTarget(blocked)).toBe("hut");
  });
});

describe("the animals", () => {
  const charming = (most: number) => {
    // A windmill is worth ten: as many as it takes, and no thing more.
    const windmill = DECOR.findIndex((thing) => thing.name === "Tiny windmill");
    return camp({ acorns: 100, decor: Array.from({ length: Math.ceil(most / DECOR[windmill].charm) }, (_, index) => ({ kind: windmill, x: 20 + index * 9, y: 100 })) }, { burrow: 3, store: 2, fence: 1 });
  };

  it("come to a camp that is charming enough for them, in turn, and stay when it is less so", () => {
    expect(settle(camp(), at(1000)).animals).toEqual([]);
    for (const animal of ANIMALS) {
      const just = settle(charming(animal.charm), at(1000));
      expect(charm(just)).toBeGreaterThanOrEqual(animal.charm);
      expect(just.animals.includes(animal.id), animal.name).toBe(true);
    }
    const hen = settle(charming(ANIMALS[0].charm), at(1000));
    expect(hen.animals).toEqual([0]);
    expect(hen.events.some((event) => event.text === "A hen has wandered into the meadow, and means to stay.")).toBe(true);
    const stripped = settle({ ...hen, decor: [] }, at(1000));
    expect(charm(stripped)).toBeLessThan(ANIMALS[0].charm);
    expect(stripped.animals).toEqual([0]);
  });

  it("each bring one small good thing", () => {
    const base = camp({ acorns: 100, camps: 10 }, { burrow: 3, store: 2, fence: 1, hut: 2 });
    const has = (animal: number): BaseState => ({ ...base, animals: [animal] });
    // The hen lays once a day on a day there is reading (1.5.11), and the egg comes as a parcel.
    const quiet = camp({ acorns: 100, animals: [0] }, { burrow: 1, store: 2 });
    const reading = (minutes: number, day = DAY): Now => ({ ...at(minutes, day), today: 5 });
    expect(settle(quiet, at(1000)).parcels).toBe(quiet.parcels);
    expect(settle(quiet, { ...at(1000), today: 0 }).parcels).toBe(quiet.parcels);
    const egg = settle(quiet, reading(1000));
    expect(egg.parcels).toBe(quiet.parcels + 1);
    expect(settle(egg, reading(1000)).parcels).toBe(egg.parcels);
    expect(settle(egg, reading(1000, "2026-10-13")).parcels).toBe(egg.parcels + 1);
    expect(nightRaiders(has(1)).capacity).toBe(nightRaiders(base).capacity - 1);
    // The goat leans on the wall (1.5.11: it was two more pieces of fence): a quarter tougher.
    const wall = (state: BaseState) => part(fronted(state), "wall").max;
    expect(wall(has(2))).toBe(Math.round(wall(base) * 1.25));
    expect(fencePieces({ ...has(2), levels: { ...base.levels, fence: 0 } })).toBe(0);
    expect(sideKnown(base)).toBe(false);
    expect(sideKnown(has(3))).toBe(true);
    // The owl keeps watch: mending is a quarter cheaper.
    const knocked: BaseState = { ...base, harm: { store: 2 } };
    expect(fixCost({ ...knocked, animals: [3] }, "store")).toBe(Math.ceil(fixCost(knocked, "store") * 0.75));
    expect(nextCamp(has(4)).loot).toBe(Math.round(nextCamp(base).loot * 1.1));
    expect(holds(has(5))).toBe(Math.round(holds(base) * 1.1));
  });
});

describe("the meadow", () => {
  it("opens with the burrow, and takes its own things, as many again as the camp", () => {
    expect(meadowOpen(camp({}, { burrow: 2 }))).toBe(false);
    const open = camp({ acorns: 9999 }, { burrow: 3 });
    expect(meadowOpen(open)).toBe(true);
    expect(placeDecor(camp({ acorns: 9999 }, { burrow: 2 }), 0, 100, 100, "meadow").meadow).toEqual([]);
    const set = placeDecor(open, 3, 100, 100, "meadow");
    expect(set.meadow).toEqual([{ kind: 3, x: 100, y: 100 }]);
    expect(set.decor).toEqual([]);
    expect(set.acorns).toBe(open.acorns - DECOR[3].cost);
    expect(charm(set)).toBe(DECOR[3].charm);
    expect(moveDecor(set, 0, 60, 90, "meadow").meadow[0]).toMatchObject({ x: 60, y: 90 });
    expect(removeDecor(set, 0, "meadow").meadow).toEqual([]);
    // Full in the camp is not full in the meadow.
    const full: BaseState = { ...open, decor: Array.from({ length: DECOR_MOST }, () => ({ kind: 0, x: 50, y: 80 })) };
    expect(decorBlocked(full, 0)).toBe("full");
    expect(decorBlocked(full, 0, "meadow")).toBeNull();
  });

  it("has eighteen kinds of thing to set down, the dearer the more charming", () => {
    expect(DECOR).toHaveLength(18);
    expect(new Set(DECOR.map((thing) => thing.name)).size).toBe(18);
    for (const thing of DECOR) expect(thing.cost / thing.charm, thing.name).toBeLessThanOrEqual(15);
  });
});

describe("a camp kept, with guardians and animals", () => {
  it("comes back as it was, and one kept before them reads as having none", () => {
    const kept = { ...grown({ guards: [3, 0, 2, 0, 1, 0, 0], drill: { guard: 3, from: 990, needs: 20 }, animals: [0, 2], meadow: [{ kind: 13, x: 80, y: 90 }], eggDay: DAY }) };
    const back = readBase(JSON.parse(JSON.stringify(kept)))!;
    expect(back.guards).toEqual(kept.guards);
    expect(back.drill).toEqual(kept.drill);
    expect(back.animals).toEqual([0, 2]);
    expect(back.meadow).toEqual(kept.meadow);
    expect(back.eggDay).toBe(DAY);
    // The goat's two pieces are kept with the rest of the fence.
    const fenced = { ...kept, walls: Array.from({ length: fencePieces(kept) }, (_, index) => [20 + index * 10, 94] as [number, number]) };
    expect(readBase(JSON.parse(JSON.stringify(fenced)))!.walls).toHaveLength(fencePieces(kept));

    const old = JSON.parse(JSON.stringify(newBase(1000, DAY))) as Record<string, unknown>;
    for (const part of ["guards", "drill", "animals", "meadow", "eggDay"]) delete old[part];
    expect(readBase(old)).toMatchObject({ guards: [0, 0, 0, 0, 0, 0, 0], drill: null, animals: [], meadow: [], eggDay: null });
    expect(readBase({ ...old, guards: [9, -2, "x"], animals: [0, 0, 99, -1], drill: { guard: 99, from: 1, needs: 20 } })).toMatchObject({ guards: [3, 0, 0, 0, 0, 0, 0], animals: [0, 5], drill: { guard: 6, from: 1, needs: 20 } });
    expect(nightSide(DAY)).toBeTruthy();
  });
});
