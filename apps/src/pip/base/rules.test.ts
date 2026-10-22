import { describe, expect, it } from "vitest";
import {
  fronted,
  BUILDINGS,
  FORKS,
  MAX_LEVEL,
  PURSE_EVERY,
  PURSE_IN_HAND,
  PURSE_MOST,
  QUESTS,
  LIST_MARK,
  WELCOMED,
  advanceList,
  rewardOf,
  nextStep,
  openParcel,
  openParcels,
  parcelsOpenable,
  parcelsBring,
  PARCELS_MOST,
  parcelGives,
  gatherBrings,
  larderRoom,
  oakStatus,
  TALES,
  RAIDS_IN_HAND,
  RAID_EVERY,
  SITES,
  WAGERS_A_DAY,
  YARD_KINDS,
  adopt,
  afterGame,
  afterQuiz,
  atRisk,
  campStructures,
  championName,
  chooseHero,
  fencePieces,
  heroHere,
  heroWith,
  moveSite,
  nightOutcome,
  nightRaiders,
  nightSide,
  placeWall,
  removeWall,
  spotBlocked,
  wallAt,
  wallBlocked,
  DEFAULT_SPOTS,
  LAND,
  blocked,
  build,
  builders,
  campNews,
  campWaits,
  choosePath,
  claimClub,
  claimQuest,
  clearPlot,
  clubBoss,
  charm,
  costOf,
  priceOf,
  ACORNS_A_MINUTE,
  DECOR,
  DECOR_LAND,
  woodAt,
  DECOR_MOST,
  decorBlocked,
  grantWish,
  moveDecor,
  placeDecor,
  removeDecor,
  streakAdds,
  streakNext,
  wishToday,
  finishRaid,
  forkOpen,
  gather,
  hides,
  holds,
  isRaised,
  jobLeft,
  kingClosed,
  levelOf,
  magpies,
  minutesOf,
  newBase,
  nextCamp,
  oakDrops,
  oakHolds,
  oakLooks,
  oakReady,
  offerWasted,
  offers,
  payout,
  placeWager,
  purseLeft,
  questNow,
  raidBlocked,
  raidForecast,
  raidSummary,
  THREE_STAR_BONUS,
  raidsReady,
  raise,
  readBase,
  restIn,
  roadCamp,
  roadDone,
  scoutsOf,
  scoutsSay,
  seasonOf,
  sendRaid,
  settle,
  startRaid,
  takeOffer,
  theKing,
  trained,
  trophyKey,
  usual,
  wagerBlocked,
  wagerTarget,
  type BaseState,
  type BuildingId,
  type Now,
  type Yard
} from "./rules";
import { SIDES, type Result } from "./battle";
import { HEROES, heroOpen, heroWants } from "./heroes";
import { TROPHY_KINDS } from "./trophies";
import { GOALS } from "./chapters";

const DAY = "2026-10-12";
const NEXT_DAY = "2026-10-13";
const at = (minutes: number, day = DAY, lit = false): Now => ({ minutes, day, lit });

/**
 * A bare clearing unless a test says otherwise: the oak a new camp starts with is put in by name. It is a camp from
 * before chapters at the burrow's level it is given (so the old gates hold for it, `legacy`), whose chests are paid and
 * goals ticked: the tests here are of the rest of the rules. Chapters have their own tests (`chapters.test.ts`).
 */
const camp = (change: Partial<BaseState> = {}, levels: Partial<Record<BuildingId, number>> = {}): BaseState => {
  const fresh = newBase(1000, DAY);
  return { ...fresh, minutes: 0, legacy: { burrow: levels.burrow ?? 1 }, chapterSeen: 99, chapterPaid: 99, goals: GOALS.map((goal) => goal.id), ...change, levels: { ...fresh.levels, oak: 0, ...levels } };
};
const yard = (first: Yard, second: Yard = { kind: null, level: 0 }): [Yard, Yard] => [first, second];
const WHOLE: Result = { stars: 3, destroyed: 1, hoards: 1 };
const HALF: Result = { stars: 1, destroyed: 0.5, hoards: 0.5 };
const NOTHING: Result = { stars: 0, destroyed: 0, hoards: 0 };

describe("a new camp", () => {
  it("has a burrow, an oak, a few acorns and nothing else", () => {
    const fresh = newBase(1234.6, DAY);
    expect(fresh.levels).toEqual({ burrow: 1, oak: 1, store: 0, fence: 0, tower: 0, hut: 0 });
    expect(fresh.acorns).toBe(20);
    // Reading done before the camp was made is not owed to it.
    expect(oakReady(fresh, 1234)).toBe(0);
    expect(oakReady(fresh, 1244)).toBe(8);
  });

  it("cannot be spent into a corner: it has nothing to spend on until reading pays, and reading always pays", () => {
    const fresh = newBase(0, DAY);
    // Twenty acorns build nothing: the first thing is to read, and gather.
    expect(SITES.every((site) => blocked(fresh, site, "hive") !== null)).toBe(true);
    // The fence is not a first camp's: it comes with chapter 4. And the burrow is never bought: it follows the chapter.
    expect(blocked({ ...fresh, acorns: 999 }, "fence")).toBe("chapter");
    expect(blocked({ ...fresh, acorns: 9999 }, "burrow")).toBe("chapter");
    expect(blocked(gather(fresh, 120), "store")).toBeNull();
  });

  it("is left alone by the magpies, and has a raid's rest and two paid runs in hand", () => {
    const fresh = newBase(500, DAY);
    expect(magpies(fresh)).toBe(0);
    expect(settle(fresh, at(500, NEXT_DAY)).report).toBeNull();
    expect(raidsReady(fresh, 500)).toBe(1);
    expect(purseLeft(fresh, 500)).toBe(2);
  });
});

describe("building", () => {
  it("is paid for in acorns, its work and all, and stands at once", () => {
    // The oak's first level: 20 acorns of materials and five minutes of work at half an acorn a minute.
    expect(ACORNS_A_MINUTE).toBe(0.5);
    expect(priceOf(camp(), "oak", 1)).toBe(costOf("oak", 1) + 3);
    const rich = camp({ acorns: 30 });
    const done = build(rich, "oak", 1000, undefined, undefined, DAY);
    expect(done.acorns).toBe(30 - priceOf(rich, "oak", 1));
    expect(done.levels.oak).toBe(1);
    expect(done.jobs).toEqual([]);
    expect(done.events[0]).toEqual({ day: DAY, text: "Acorn oak reached level 1." });
    // The oak starts dropping from when it stands.
    expect(oakReady(done, 1000)).toBe(0);
    expect(oakReady(done, 1010)).toBe(8);
    // Without a day it is paid for, and the next look at the camp sees it standing: no reading wanted.
    const paid = build(rich, "oak", 1000);
    expect(paid.jobs).toEqual([{ site: "oak", to: 1, from: 1000, needs: 0 }]);
    expect(settle(paid, at(1000)).levels.oak).toBe(1);
  });

  it("finishes what a camp kept from before was building, whatever reading it still wanted, the same on any device", () => {
    // Kept by 1.5.7: the larder paid for and waiting on 20 minutes of reading, a guardian training, the fence wrecked.
    const kept = camp({ acorns: 40, jobs: [{ site: "store", to: 2, from: 1000, needs: 20 }], drill: { guard: 0, from: 1000, needs: 20 }, wreck: { by: "Tovah", stars: 2, from: 1000, needs: 8 } }, { burrow: 2, store: 1, tower: 1 });
    // Brought up to now on two devices whose reading differs (one has read nothing since; the other, more): the same camp.
    const here = settle(kept, at(1000));
    const there = settle(kept, at(1004, NEXT_DAY));
    for (const after of [here, there]) {
      expect(after.levels.store).toBe(2);
      expect(after.jobs).toEqual([]);
      expect(after.guards[0]).toBe(1);
      expect(after.drill).toBeNull();
      expect(after.wreck).toBeNull();
      // Nothing is taken: not one acorn.
      expect(after.acorns).toBeGreaterThanOrEqual(40);
    }
    expect(here.levels).toEqual(there.levels);
    expect(here.guards).toEqual(there.guards);
    // And it is done once: brought up to now again, nothing more happens.
    expect(settle(here, at(1000)).levels).toEqual(here.levels);
  });

  it("is one thing at a time, never past the burrow, never past the top, never on credit", () => {
    // (One thing at a time only while a thing is paid for and not yet seen standing.)
    expect(blocked(build(camp({ acorns: 60 }), "oak", 1000), "store")).toBe("busy");
    expect(blocked(camp({ acorns: 1000 }, { oak: 1 }), "oak")).toBe("chapter");
    expect(blocked(camp({ acorns: 1000 }, { burrow: 2, oak: 1, store: 1 }), "oak")).toBeNull();
    expect(blocked(camp({ acorns: 1400 }, { burrow: MAX_LEVEL, store: 5 }), "burrow")).toBe("top");
    expect(blocked(camp({ acorns: 3 }), "oak")).toBe("acorns");
    // The burrow goes up with the chapters, for no acorns (1.5.10): nothing buys it.
    expect(blocked(camp({ acorns: 60_000 }), "burrow")).toBe("chapter");
    const poor = camp({ acorns: 3 });
    expect(build(poor, "oak", 1000)).toBe(poor);
  });

  it("never waits for room: the larder has no cap since 1.5.10, and a price is only ever acorns", () => {
    expect(holds(camp())).toBe(Infinity);
    expect(larderRoom(camp({ acorns: 1_000_000 }))).toBe(Infinity);
    for (const building of BUILDINGS.filter((site) => site !== "burrow")) {
      const rich = camp({ acorns: priceOf(camp(), building, 1) }, { burrow: 5, store: 0 });
      expect(blocked(rich, building), building).toBeNull();
    }
  });
});

describe("the yard", () => {
  const ready = camp({ acorns: 300 }, { burrow: 3, store: 3 });

  it("takes two of the four, one of each, and the burrow leads it by a level", () => {
    expect(blocked(camp({ acorns: 300 }, { store: 2 }), "yard0", "hive")).toBe("chapter");
    expect(blocked(ready, "yard0")).toBe("taken");
    const hive = settle(build(ready, "yard0", 1000, "hive"), at(1015));
    expect(hive.yard[0]).toEqual({ kind: "hive", level: 1 });
    expect(blocked(hive, "yard1", "hive")).toBe("taken");
    expect(blocked(hive, "yard1", "well")).toBeNull();
    expect(levelOf(hive, "yard0")).toBe(1);
  });

  it("makes everything cheaper to build from a workshop, more for a bigger one", () => {
    const none = camp({ acorns: 300 }, { burrow: 3, store: 3 });
    const shop = camp({ acorns: 300, yard: yard({ kind: "workshop", level: 1 }) }, { burrow: 3, store: 3 });
    const best = { ...shop, yard: yard({ kind: "workshop", level: 3 }) };
    // The burrow's fourth level: 360 of materials and 35 of work.
    expect(priceOf(none, "burrow", 4)).toBe(395);
    expect(priceOf(shop, "burrow", 4)).toBe(Math.round(395 * 0.95));
    expect(priceOf(best, "burrow", 4)).toBe(Math.round(395 * 0.85));
    const built = build(shop, "fence", 1000, undefined, undefined, DAY);
    expect(built.acorns).toBe(300 - priceOf(shop, "fence", 1));
  });

  it("gives honey each day from the bees, more acorns from a well, and better pay from a stall", () => {
    const bees = camp({ acorns: 0, yard: yard({ kind: "hive", level: 2 }) }, { store: 1 });
    // The bees' honey comes as parcels: one for every level of the hives, each day.
    const morning = settle(bees, at(1000, NEXT_DAY));
    expect(morning.parcels).toBe(2);
    expect(morning.acorns).toBe(0);
    expect(settle(morning, at(1000, NEXT_DAY))).toBe(morning);
    const watered = camp({ yard: yard({ kind: "well", level: 3 }) }, { oak: 2 });
    expect(oakDrops(watered)).toBeCloseTo(13 * 1.45);
    const selling = camp({ yard: yard({ kind: "stall", level: 2 }) });
    expect(payout(selling, "flap", 8)).toBe(12);
    expect(payout(camp(), "flap", 8)).toBe(8);
  });

  it("can be cleared for something else, but not with a job on it", () => {
    const hive = build(ready, "yard0", 1000, "hive");
    expect(clearPlot(hive, "yard0")).toBe(hive);
    const done = settle(hive, at(1015));
    expect(clearPlot(done, "yard0").yard[0]).toEqual({ kind: null, level: 0 });
    expect(clearPlot(done, "oak")).toBe(done);
  });
});

describe("paths", () => {
  it("open at level 3, are free once and cost to change", () => {
    const young = camp({ acorns: 100 }, { oak: 2 });
    expect(forkOpen(young, "oak")).toBe(false);
    expect(choosePath(young, "oak", "a")).toBe(young);
    const grown = camp({ acorns: 100 }, { burrow: 3, oak: 3 });
    expect(forkOpen(grown, "oak")).toBe(true);
    expect(forkOpen(grown, "store")).toBe(false);
    const wide = choosePath(grown, "oak", "a");
    expect(wide.acorns).toBe(100);
    expect(oakHolds(wide)).toBe(195);
    const deep = choosePath(wide, "oak", "b");
    expect(deep.acorns).toBe(40);
    expect(oakDrops(deep)).toBeCloseTo(20 * 1.25);
    expect(choosePath({ ...deep, acorns: 10 }, "oak", "a").forks.oak).toBe("b");
    expect(Object.keys(FORKS)).toEqual(["oak", "tower", "hut"]);
  });
});

describe("the oak", () => {
  it("drops acorns for reading, keeps every one of them however long it waits, and is gathered whole", () => {
    const grown = camp({ oakFrom: 1000, acorns: 0 }, { oak: 1, store: 1 });
    expect(oakReady(grown, 1025)).toBe(20);
    // Nothing expires (1.5.10): a week of reading away is all on the tree.
    expect(oakReady(grown, 9000)).toBe(6400);
    const gathered = gather(grown, 1030);
    expect(gathered.acorns).toBe(24);
    expect(gathered.stats.gathered).toBe(24);
    expect(oakReady(gathered, 1040)).toBe(8);
  });

  it("is only drawn full at what it used to hold: how full it looks, and nothing more", () => {
    const grown = camp({ oakFrom: 0, acorns: 0 }, { oak: 1 });
    expect(oakHolds(grown)).toBe(50);
    expect(oakLooks(grown, 0)).toBe(0);
    expect(oakLooks(grown, 30)).toBeCloseTo(24 / 50);
    expect(oakLooks(grown, 100_000)).toBe(1);
    const gathered = gather(grown, 100_000);
    expect(gathered.acorns).toBe(80_000);
    expect(oakReady(gathered, 100_000)).toBe(0);
  });

  it("loses no more than the odd acorn to the rounding, gathered often or once", () => {
    const grown = camp({ oakFrom: 0, acorns: 0 }, { oak: 2 });
    let often = grown;
    for (let read = 7; read <= 700; read += 7) often = gather(often, read);
    const once = gather(grown, 700);
    expect(once.acorns).toBe(910);
    expect(often.acorns).toBeLessThanOrEqual(once.acorns);
    expect(often.acorns + oakReady(often, 700)).toBeGreaterThanOrEqual(once.acorns - 13);
  });
});

describe("what the oak shows is what a tap on it does", () => {
  // The owner, 2026-10-19, on a phone: "the acorn does not disappear even when I collect it". Since 1.5.10 there is
  // always room, so the oak is ready whenever anything is on it, and bare after a tap.
  const grown = camp({ oakFrom: 0, acorns: 0 }, { oak: 1, store: 1 });

  it("is ready exactly when a tap would bring something in, and never ready just after one", () => {
    for (const acorns of [0, 10, 1399, 1400, 1425, 90_000]) {
      for (const read of [0, 3, 12, 40, 400]) {
        for (const windfall of [0, 6, 40]) {
          const state = { ...grown, acorns, welcome: { ...grown.welcome, windfall } };
          const brings = gatherBrings(state, read, 9, "2026-10-12");
          expect(oakStatus(state, read) === "ready").toBe(brings > 0);
          expect(oakStatus(state, read) === "bare").toBe(brings === 0);
          expect(brings > 0).toBe(oakReady(state, read) > 0);
          // What a tap leaves: an oak with nothing on it.
          const after = gather(state, read, 9, "2026-10-12");
          expect(oakStatus(after, read)).toBe("bare");
          expect(oakReady(after, read)).toBe(0);
        }
      }
    }
  });

  it("takes everything in, however many acorns the camp has: there is no brim", () => {
    const rich = { ...grown, acorns: 5000 };
    expect(oakStatus(rich, 400)).toBe("ready");
    expect(gather(rich, 400).acorns).toBe(5000 + oakReady(rich, 400));
  });

  it("the welcome's shake is taken in whole, with the oak's own", () => {
    const shaken = { ...grown, oakFrom: 400, acorns: 1398, welcome: { ...grown.welcome, windfall: 10 } };
    const after = gather(shaken, 400);
    expect(after.acorns).toBe(1408);
    expect(after.welcome.windfall).toBe(0);
    expect(oakStatus(after, 400)).toBe("bare");
  });

  it("puts a dot on the way in for an oak that looks full, whatever the camp has", () => {
    const full = { ...grown, acorns: 1400 };
    expect(oakReady(full, 100_000)).toBe(80_000);
    expect(campWaits(full, at(100_000))).toBe(true);
    expect(campWaits({ ...full, oakFrom: 100_000 }, at(100_000))).toBe(false);
  });
});

describe("where things stand", () => {
  it("is the reader's to choose: a building moves for nothing, but not onto another, the fence or the edge", () => {
    const state = camp({ acorns: 100 }, { store: 1 });
    expect(state.spots).toEqual(DEFAULT_SPOTS);
    const moved = moveSite(state, "store", 139, 65);
    expect(moved.spots.store).toEqual([140, 66]);
    expect(moved.acorns).toBe(100);
    const [bx, by] = state.spots.burrow;
    expect(spotBlocked(state, "store", bx + 4, by)).toBe("building");
    expect(moveSite(state, "store", bx + 4, by)).toBe(state);
    expect(spotBlocked(state, "store", 2, 80)).toBe("edge");
    expect(spotBlocked(state, "store", 100, LAND.top - 6)).toBe("edge");
    // A building may be put back exactly where it is.
    expect(spotBlocked(state, "burrow", bx, by)).toBeNull();
  });

  it("is a wall across the trail since 1.5.11: raised with the fence, longer with its level, and not laid by hand", () => {
    const none = fronted(camp());
    expect(fencePieces(none)).toBe(0);
    expect(none.walls).toEqual([]);
    const fenced = fronted(camp({}, { fence: 1 }));
    expect(fencePieces(fenced)).toBe(3);
    expect(fenced.walls).toHaveLength(3);
    // All of it on the wall's line, a section every ten up the picture.
    expect(fenced.walls.map(([, y]) => y)).toEqual([74, 84, 94]);
    // Laying, taking up and moving pieces by hand do nothing now.
    expect(placeWall(fenced, 101, 73)).toBe(fenced);
    expect(removeWall(fenced, 0)).toBe(fenced);
    expect(wallBlocked(fenced, 99, 75)).toBe("none");
    // What is taken hold of to slide it is a section of it.
    expect(wallAt(fenced, fenced.walls[1][0], fenced.walls[1][1])).toBe(1);
    expect(fencePieces(fronted(camp({}, { fence: 5 })))).toBe(7);
  });
});

describe("the nights", () => {
  const kept = (burrow: number, change: Partial<BaseState> = {}) =>
    camp({ acorns: 200, camps: burrow * 2, ...change }, { burrow, oak: burrow, store: burrow, fence: burrow, tower: burrow, hut: burrow });
  const everySide = (state: BaseState, lit: boolean) =>
    ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12"]
      .map((day) => nightOutcome(state, day, lit)!)
      .filter((night, index, all) => all.findIndex((other) => other.side === night.side) === index);

  it("come from a side the day decides, the same all day and not the same every day", () => {
    expect(nightSide(DAY)).toBe(nightSide(DAY));
    const sides = new Set<string>();
    for (let day = 1; day <= 28; day++) sides.add(nightSide(`2026-02-${String(day).padStart(2, "0")}`));
    expect([...sides].sort()).toEqual([...SIDES].sort());
  });

  it("leave a small camp alone, and grow bolder as it prospers", () => {
    expect(nightOutcome(camp({ acorns: 50 }), DAY, false)).toBeNull();
    expect(magpies(kept(2))).toBe(13);
    expect(nightRaiders(kept(2))).toMatchObject({ capacity: 6, kinds: ["sprout"], raiders: true });
    // A bolder flock is more of them, stronger, and some on the wing.
    expect(nightRaiders(kept(5, { camps: 20 }))).toMatchObject({ capacity: 12, level: 5, kinds: ["sprout", "mole"] });
  });

  it("are fought over the camp as it stands: the burrow, the larder, the lookout, the hut and every piece of fence", () => {
    const state = fronted(kept(3));
    const dark = campStructures(state, false);
    expect(dark.map((entry) => entry.kind)).toEqual(["nest", "hoard", "perch", "other", "other", "wall", "wall", "wall", "wall", "wall", "wall"]);
    // The gate is the toughest of the wall.
    const walls = dark.filter((entry) => entry.kind === "wall");
    const gate = walls.find((entry) => entry.y === 84)!;
    expect(walls.every((entry) => entry.max <= gate.max)).toBe(true);
    expect(walls.some((entry) => entry.max < gate.max)).toBe(true);
    expect(dark.find((entry) => entry.kind === "hoard")).toMatchObject({ x: state.spots.store[0], y: state.spots.store[1], look: { name: "store", variant: 3 } });
    const tower = (lit: boolean, fork?: "a" | "b") => campStructures({ ...state, forks: fork ? { tower: fork } : {} }, lit).find((entry) => entry.kind === "perch")!;
    // The lantern lit: the lookout throws further and harder; the great lamp doubles that; slings throw oftener.
    expect(tower(true).range).toBeGreaterThan(tower(false).range);
    expect(tower(true, "a").range).toBeGreaterThan(tower(true).range);
    expect(tower(false, "b").every).toBeLessThan(tower(false).every);
    // A camp with no larder yet is raided for what is in the burrow.
    expect(campStructures(camp({}, { burrow: 2 }), false).map((entry) => entry.kind)).toEqual(["nest"]);
  });

  it("cost by how far the magpies got with the larder, never what it hides, never more than a fifth", () => {
    const neglected = camp({ acorns: 200, camps: 12 }, { burrow: 3, oak: 3, store: 3, fence: 1, tower: 1, hut: 1 });
    const nights = everySide(neglected, false);
    expect(nights).toHaveLength(4);
    expect(nights.some((night) => !night.held)).toBe(true);
    for (const night of nights) {
      expect(night.taken).toBeLessThanOrEqual(40);
      expect(night.held).toBe(night.taken === 0 || night.held);
    }
    const worst = nights.reduce((a, b) => (b.taken > a.taken ? b : a));
    expect(worst.taken).toBe(40);
    // With little more than the larder hides, they take only what shows.
    const poor = { ...neglected, acorns: hides(neglected) + 3 };
    expect(Math.max(...everySide(poor, false).map((night) => night.taken))).toBe(3);
    expect(atRisk(neglected, DAY, false)).toBe(nightOutcome(neglected, DAY, false)!.taken);
  });

  it("go better for a camp that keeps its defences up, and better again with the lantern lit", () => {
    const lost = (state: BaseState, lit: boolean) => everySide(state, lit).reduce((sum, night) => sum + night.taken, 0);
    let neglectedLost = 0;
    let keptLost = 0;
    for (const burrow of [3, 4, 5]) {
      const neglected = camp({ acorns: 200, camps: burrow * 4 }, { burrow, oak: burrow, store: burrow, fence: 1, tower: 1, hut: 1 });
      const looked = kept(burrow, { camps: burrow * 4 });
      expect(lost(looked, false), `burrow ${burrow}`).toBeLessThanOrEqual(lost(neglected, false));
      expect(lost(looked, true), `burrow ${burrow}`).toBeLessThanOrEqual(lost(looked, false));
      neglectedLost += lost(neglected, false);
      keptLost += lost(looked, true);
    }
    // Over every side and whoever comes (a rabble, the Gilded and the rest are not all stopped by the same things).
    // (This night is not fought since 2026-10-15; since 1.5.11 its raiders no longer stall a hair short of what they
    // make for, and they do more harm to either camp. The kept camp still loses less.)
    expect(keptLost).toBeLessThan(neglectedLost);
  }, 30_000);

  it("turn on where the larder stands", () => {
    // The same camp, the same night: the larder by the side they come from, and across the clearing from it.
    const state = kept(3, { camps: 12 });
    const day = ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"].find((entry) => nightSide(entry) === "right")!;
    // (Set where they stand by hand: since 1.5.11 nothing is moved onto the trail's side of the wall.)
    const near = { ...state, spots: { ...state.spots, tower: [30, 100] as [number, number], store: [208, 84] as [number, number] } };
    const far = { ...state, spots: { ...state.spots, oak: [200, 70] as [number, number], store: [40, 84] as [number, number] } };
    expect(nightOutcome(near, day, false)!.taken).toBeGreaterThan(nightOutcome(far, day, false)!.taken);
  });

  it("are not fought since 2026-10-15: a day turning brings no report, takes nothing, and is marked as through", () => {
    // Read for since the night before, and a camp that would lose: still nothing happens to it.
    const weak = camp({ acorns: 200, camps: 12, night: "2026-03-01", nightAt: 900 }, { burrow: 3, oak: 3, store: 3, fence: 1, tower: 1, hut: 1 });
    const back = settle(weak, at(1000, "2026-12-25"));
    expect(back.report).toBeNull();
    expect(back.acorns).toBe(200);
    expect(back.stats.nights).toBe(0);
    expect(back.night).toBe("2026-12-25");
    expect(back.nightAt).toBe(1000);
    expect(settle(back, at(1000, "2026-12-25"))).toBe(back);
    // The rules of the night are still here, for whenever it is wanted back.
    expect(nightOutcome(weak, "2026-03-01", false)).not.toBeNull();
  });
});

describe("heroes", () => {
  it("come to the camp with the kind of book they belong to, or with enough books of any kind", () => {
    const none = Array.from({ length: 11 }, () => 0);
    expect(HEROES.every((hero) => !heroOpen(none, 0, hero.id))).toBe(true);
    // Any finished book brings the Librarian.
    expect(heroOpen(none, 1, 0)).toBe(true);
    const fantasy = none.map((count, kind) => (kind === 1 ? 1 : count));
    expect(heroOpen(fantasy, 1, 1)).toBe(true);
    expect(heroOpen(fantasy, 1, 3)).toBe(false);
    expect(heroOpen(none.map((count, kind) => (kind === 1 ? 3 : count)), 3, 3)).toBe(true);
    // A library whose genres say nothing still gets everyone, in time.
    expect(HEROES.every((hero) => heroOpen(none, 50, hero.id))).toBe(true);
    expect(heroOpen(none, 3, 1)).toBe(false);
    expect(heroOpen(none, 4, 1)).toBe(true);
    for (const hero of HEROES) expect(heroWants(hero, TROPHY_KINDS)).toMatch(/^Finish /);
    expect(new Set(HEROES.map((hero) => hero.name)).size).toBe(HEROES.length);
  });

  it("are brought by trophies raised, one is chosen, and they go on the raid", () => {
    const start = camp({ acorns: 100 }, { hut: 1, store: 1 });
    expect(heroHere(start, 1)).toBe(false);
    expect(chooseHero(start, 1)).toBe(start);
    const read = raise(start, "book-w", "A Wizard's Term", DAY, 1);
    expect(read.shelf[1]).toBe(1);
    expect(heroHere(read, 1)).toBe(true);
    expect(heroHere(read, 0)).toBe(true);
    const chosen = chooseHero(read, 1);
    expect(heroWith(chosen)).toMatchObject({ id: 1, reach: 34 });
    expect(startRaid(chosen, "camp", at(1000))!.raid.setup.hero).toMatchObject({ id: 1 });
    expect(startRaid(read, "camp", at(1000))!.raid.setup.hero).toBeNull();
    expect(chooseHero(chosen, null).hero).toBeNull();
    // Books finished before the camp count by their kinds too.
    expect(adopt(start, [{ id: "a", kind: 5 }, { id: "b", kind: 5 }, { id: "a", kind: 5 }]).shelf[5]).toBe(2);
  });

  it("meet a champion at the last stronghold of each name, and the King's own in his roost", () => {
    expect(nextCamp(camp()).champion).toBeNull();
    expect(nextCamp(camp({ camps: 2 }))).toMatchObject({ champion: 0 });
    expect(championName(nextCamp(camp({ camps: 2 })))).toBe("Scratch the Twig-Tyrant");
    expect(nextCamp(camp({ camps: 5 })).champion).toBe(1);
    expect(nextCamp(camp({ camps: 500 })).champion).toBe(4);
    expect(theKing(camp({ camps: 9 })).champion).toBe(5);
    expect(roadCamp(camp({ camps: 9 }), DAY, 2).champion).toBeNull();
    expect(startRaid(camp({ acorns: 100, camps: 2 }, { hut: 2, store: 1 }), "camp", at(1000))!.raid.setup.champion).toBe(0);
  });
});

describe("raids", () => {
  const ready = camp({ acorns: 100 }, { burrow: 2, hut: 2, store: 2 });

  it("need a hut and rested scouts, and nothing else: supplies are free since 1.5.10", () => {
    expect(raidBlocked(camp({ acorns: 500 }), "camp", at(1000))).toBe("hut");
    expect(raidBlocked({ ...ready, acorns: 0 }, "camp", at(1000))).toBeNull();
    expect(raidBlocked({ ...ready, raidFrom: 1000 }, "camp", at(1010))).toBe("rest");
    expect(raidBlocked(ready, "camp", at(1000))).toBeNull();
    expect(startRaid({ ...ready, acorns: 0 }, "camp", at(1000))!.state.acorns).toBe(0);
    for (const plan of [nextCamp(ready), theKing(ready), roadCamp(ready, DAY, 2), nextCamp({ ...ready, camps: 300 })]) expect(plan.cost).toBe(0);
  });

  it("are rested for by reading: a quarter of an hour each, ten in hand at most", () => {
    expect(RAIDS_IN_HAND).toBe(10);
    const tired = { ...ready, raidFrom: 1000 };
    expect(raidsReady(tired, 1014)).toBe(0);
    expect(restIn(tired, 1010)).toBe(5);
    expect(raidsReady(tired, 1015)).toBe(1);
    expect(raidsReady(tired, 5000)).toBe(RAIDS_IN_HAND);
    expect(restIn(tired, 5000)).toBe(0);
    // One spent of a full hand leaves two, and the next is a quarter hour off.
    const spent = startRaid(tired, "camp", at(5000))!.state;
    expect(raidsReady(spent, 5000)).toBe(RAIDS_IN_HAND - 1);
    expect(restIn(spent, 5000)).toBe(RAID_EVERY);
    // One spent of one leaves none, and what was read toward the next is kept.
    const one = startRaid(tired, "camp", at(1022))!.state;
    expect(raidsReady(one, 1022)).toBe(0);
    expect(restIn(one, 1022)).toBe(8);
  });

  it("set out with what the hut has: more scouts and more kinds with its level, two more for a tip", () => {
    expect(scoutsOf(camp())).toBe(0);
    expect(scoutsOf(ready)).toBe(9);
    expect(trained(ready)).toEqual(["sprout", "slinger"]);
    // Puffcaps from the hut's third level (1.5.11), one to a raid, and two at its fifth.
    expect(trained(camp({}, { hut: 3 }))).toEqual(["sprout", "slinger", "bomber"]);
    expect(trained(camp({}, { hut: 4 }))).toEqual(["sprout", "slinger", "bomber", "mole"]);
    // Down the trail, from the left (they used to come in from whichever side did best).
    const plain = startRaid({ ...ready, intel: 1 }, "camp", at(1000))!;
    expect(plain.raid.setup).toEqual({ n: 0, king: false, capacity: 9, level: 2, kinds: ["sprout", "slinger"], fast: false, seed: 0, hero: null, champion: null, drop: 40, bombers: 0 });
    expect(startRaid({ ...ready, levels: { ...ready.levels, hut: 3 } }, "camp", at(1000))!.raid.setup.bombers).toBe(1);
    expect(plain.state.intel).toBe(1);
    expect(plain.state.acorns).toBe(100 - nextCamp(ready).cost);
    const tipped = startRaid({ ...ready, intel: 1, forks: {} }, "camp", at(1000), true)!;
    expect(tipped.raid.setup.capacity).toBe(11);
    expect(tipped.state.intel).toBe(0);
    // A tip asked for with none to spend is just a raid.
    expect(startRaid(ready, "camp", at(1000), true)!.raid.setup.capacity).toBe(9);
  });

  it("bring home what came down, take a camp with a star, and leave it standing without one", () => {
    const begun = startRaid(ready, "camp", at(1000))!;
    const plan = begun.raid.plan;
    const whole = finishRaid(begun.state, begun.raid, WHOLE, DAY);
    // Taken whole: the ladder moves one step (1.5.10: it used to empty the next one too), and a quarter more loot.
    const bonus = Math.round(plan.loot * THREE_STAR_BONUS);
    expect(whole.end).toEqual({ won: true, stars: 3, loot: plan.loot + bonus, name: "The Twig Nest", banner: null, fled: false, bonus, blade: null, home: null });
    expect(whole.state.acorns).toBe(100 + plan.loot + bonus);
    expect(whole.state.camps).toBe(1);
    expect(whole.state.events[0].text).toBe(`Stronghold 1 taken with 3 stars: ${plan.loot + bonus} acorns.`);
    expect(raidSummary(whole.end)).toBe(`You took the Twig Nest: ${plan.loot + bonus} acorns. All three stars: ${bonus} acorns of that is for taking it whole.`);
    expect(whole.state.stats).toMatchObject({ raids: 1, stars: 3 });
    expect(nextCamp(whole.state).loot).toBeGreaterThan(plan.loot);
    const half = finishRaid(begun.state, begun.raid, HALF, DAY);
    expect(half.end).toMatchObject({ won: true, stars: 1, loot: Math.round(plan.loot / 2), fled: false, bonus: 0 });
    expect(half.state.camps).toBe(1);
    // A lord does not run: the stronghold before his is taken alone, however well.
    const second = startRaid({ ...ready, camps: 1 }, "camp", at(1000))!;
    expect(nextCamp({ ...ready, camps: 2 }).champion).not.toBeNull();
    expect(finishRaid(second.state, second.raid, WHOLE, DAY)).toMatchObject({ end: { fled: false }, state: { camps: 2 } });
    const none = finishRaid(begun.state, begun.raid, { stars: 0, destroyed: 0.2, hoards: 0 }, DAY);
    expect(none.end).toMatchObject({ won: false, loot: plan.loot * 0.2 });
    expect(none.state.camps).toBe(0);
    // A raid lost costs the scouts' rest and nothing else.
    expect(none.state.acorns).toBe(100 + plan.loot * 0.2);
    expect(raidSummary(finishRaid(begun.state, begun.raid, NOTHING, DAY).end)).toBe("Beaten back. Nothing lost but the scouts' rest.");
    expect(finishRaid(begun.state, begun.raid, NOTHING, DAY).state.events[0].text).toBe("The raid on stronghold 1 was beaten back.");
  });

  it("bring everything home, however many acorns the camp has, and keep a pack for a raid that is won", () => {
    const full = camp({ acorns: 1400, pack: true }, { hut: 1 });
    const begun = startRaid(full, "camp", at(1000))!;
    expect(begun.raid.plan.loot).toBe(Math.round(20 * 1.5));
    expect(finishRaid(begun.state, begun.raid, WHOLE, DAY).state).toMatchObject({ acorns: 1400 + 30 + 8, pack: false });
    expect(finishRaid(begun.state, begun.raid, NOTHING, DAY).state.pack).toBe(true);
    expect(nextCamp(camp({ forks: { hut: "b" } }, { hut: 3 })).loot).toBe(Math.round(20 * 1.25));
  });

  it("can be sent without the reader, fought by rule, for three quarters of the loot, and never to lose", () => {
    const sent = sendRaid(ready, "camp", at(1000))!;
    expect(sent.end).toMatchObject({ won: true, stars: 3, loot: Math.round(20 * 0.75) + Math.round(20 * 0.25 * 0.75) });
    expect(raidForecast(ready, nextCamp(ready))).toMatchObject({ stars: 3, canSend: true, words: "Your scouts take it whole", brings: sent.end.loot });
    expect(sendRaid(ready, "camp", at(1000))).toEqual(sent);
    expect(sendRaid(camp(), "camp", at(1000))).toBeNull();
    // Far past what the hut can take: the scouts say so, and are not sent (1.5.10: it used to come home with nothing).
    const far = { ...ready, camps: 40 };
    expect(raidForecast(far, nextCamp(far))).toMatchObject({ stars: 0, canSend: false, words: "Too strong for now: bring a hero or build up the hut" });
    expect(sendRaid(far, "camp", at(1000))).toBeNull();
    // It can still be fought.
    expect(startRaid(far, "camp", at(1000))).not.toBeNull();
  });

  it("are there every day on the road: three new camps, each raided once, that move nothing on", () => {
    const state = camp({ acorns: 200, camps: 6, raidFrom: 0 }, { burrow: 3, hut: 3, store: 2 });
    const today = [0, 1, 2].map((slot) => roadCamp(state, DAY, slot));
    expect(today.map((plan) => plan.name)).toEqual(["Stragglers", "A magpie patrol", "A loot caravan"]);
    // As hard as scouts of this hut are a match for, when that is more than the ladder asks; paid by the ladder.
    expect(today.map((plan) => plan.n)).toEqual([8, 11, 12]);
    expect(today.map((plan) => plan.cost)).toEqual([0, 0, 0]);
    expect([0, 1, 2].map((slot) => roadCamp({ ...state, levels: { ...state.levels, hut: 5 } }, DAY, slot).loot)).toEqual(today.map((plan) => plan.loot));
    // A camp a hero has come to meets a road that is ready for one, whoever is chosen to go.
    const famed = raise(state, "book-x", "A Book", DAY, 0);
    expect([0, 1, 2].map((slot) => roadCamp(famed, DAY, slot).n)).toEqual([10, 13, 16]);
    expect([0, 1, 2].map((slot) => roadCamp(chooseHero(famed, 0), DAY, slot).n)).toEqual([10, 13, 16]);
    // Far along the ladder, it is the ladder that sets them: easier than the next stronghold, about as hard, and harder.
    expect([0, 1, 2].map((slot) => roadCamp({ ...state, camps: 20 }, DAY, slot).n)).toEqual([17, 19, 21]);
    expect(today[2].loot).toBeGreaterThan(today[1].loot);
    expect(today[1].loot).toBeGreaterThan(today[0].loot);
    expect(roadCamp(state, DAY, 1)).toEqual(today[1]);
    expect(roadCamp(state, NEXT_DAY, 1).seed).not.toBe(today[1].seed);
    expect(new Set(today.map((plan) => plan.seed)).size).toBe(3);

    const begun = startRaid(state, "wild", at(1000), false, 1)!;
    expect(begun.raid.setup.seed).toBe(today[1].seed);
    const ended = finishRaid(begun.state, begun.raid, WHOLE, DAY);
    expect(ended.state.camps).toBe(6);
    expect(ended.state.stats).toMatchObject({ raids: 1, stars: 3 });
    expect(ended.state.events[0].text).toBe(`A magpie patrol taken with 3 stars: ${today[1].loot} acorns.`);
    // Once each a day: leaving a raid does not get it back.
    expect(raidBlocked(begun.state, "wild", at(1000), 1)).toBe("done");
    expect(raidBlocked(begun.state, "wild", at(1000), 0)).toBeNull();
    expect(raidBlocked(begun.state, "wild", at(1000, NEXT_DAY), 1)).toBeNull();
    expect(roadDone(begun.state, DAY, 1)).toBe(true);
    // A new camp's road is as easy as roads get.
    expect([0, 1, 2].map((slot) => roadCamp(camp(), DAY, slot).n)).toEqual([0, 0, 1]);
  });

  it("are spoken for by the scouts before they set out", () => {
    const state = camp({ acorns: 200 }, { burrow: 2, hut: 2, store: 2 });
    expect(scoutsSay(camp(), nextCamp(camp()))).toBeNull();
    expect(scoutsSay(state, nextCamp(state))).toEqual({ stars: 3, destroyed: 1, hoards: 1 });
    // What they say is what sending them does.
    expect(sendRaid(state, "camp", at(1000))!.end.stars).toBe(3);
    expect(scoutsSay({ ...state, camps: 40 }, nextCamp({ ...state, camps: 40 }))?.stars).toBe(0);
  });

  it("name their camps by tier, the last name for every camp after", () => {
    expect(nextCamp(camp()).name).toBe("The Twig Nest");
    expect(nextCamp(camp({ camps: 3 }))).toMatchObject({ tier: 1, name: "Bramble Roost" });
    expect(nextCamp(camp({ camps: 300 }))).toMatchObject({ tier: 4, name: "The Old Rookery", n: 300, cost: 0 });
  });
});

describe("the Magpie King", () => {
  const ready = camp({ acorns: 300, camps: 10 }, { burrow: 3, hut: 3, store: 3 });

  it("is there from chapter 10 (for a camp from before chapters, once ten camps are beaten), once a day, until the month's banner is won", () => {
    expect(kingClosed(camp({ camps: 9 }), DAY)).toBe("chapter");
    expect(kingClosed(ready, DAY)).toBeNull();
    expect(kingClosed({ ...camp(), legacy: null, minutes: 44 * 60 }, DAY)).toBe("chapter");
    expect(kingClosed({ ...camp(), legacy: null, minutes: 45 * 60 }, DAY)).toBeNull();
    expect(theKing(ready)).toMatchObject({ kind: "king", n: 7, need: 2, loot: 200, cost: 0 });
    // He is as hard as the scouts are strong, not as the ladder is long.
    expect(theKing({ ...ready, camps: 20 }).n).toBe(7);
    expect(theKing({ ...ready, levels: { ...ready.levels, hut: 5 } }).n).toBeGreaterThan(7);
    const begun = startRaid(ready, "king", at(1000))!;
    expect(begun.raid.setup.king).toBe(true);
    expect(kingClosed(begun.state, DAY)).toBe("today");
    expect(kingClosed(begun.state, NEXT_DAY)).toBeNull();
    // One star is not enough for him.
    const close = finishRaid(begun.state, begun.raid, HALF, DAY);
    expect(close.end).toMatchObject({ won: false, banner: null });
    expect(close.state.banners).toEqual([]);
    const won = finishRaid(begun.state, begun.raid, WHOLE, DAY);
    expect(won.end.banner).toBe("2026-10");
    expect(won.state.banners).toEqual(["2026-10"]);
    expect(won.state.camps).toBe(10);
    // And his own blade is the camp's, the first time he falls.
    expect(won.end.blade).toBe(5);
    expect(won.state.events[0].text).toBe("The Magpie King fell. October's banner flies over the camp. Dawnsplitter is the camp's.");
    expect(kingClosed(won.state, "2026-10-30")).toBe("won");
    expect(kingClosed(won.state, "2026-11-01")).toBeNull();
  });

  it("has a season", () => {
    expect(["2026-07-01", "2026-10-12", "2026-01-05", "2026-12-31", "2026-04-20"].map(seasonOf)).toEqual([0, 1, 2, 2, 3]);
  });
});

describe("the arcade's games", () => {
  it("pay by the score, for runs that reading has earned", () => {
    const start = camp({ acorns: 30, purseFrom: 1000 }, { store: 1 });
    expect(purseLeft(start, 1009)).toBe(0);
    expect(afterGame(start, "flap", 20, at(1009))).toMatchObject({ paid: 0 });
    const paid = afterGame(start, "flap", 5, at(1010));
    expect(paid.paid).toBe(5);
    expect(paid.state.acorns).toBe(35);
    expect(purseLeft(paid.state, 1010)).toBe(0);
    expect(afterGame(start, "dash", 100_000, at(1010)).paid).toBe(PURSE_MOST);
    expect(purseLeft(start, 9000)).toBe(PURSE_IN_HAND);
    // A full hand spent leaves four, and the next is ten minutes of reading off.
    const four = afterGame(start, "catch", 40, at(9000)).state;
    expect(purseLeft(four, 9000)).toBe(PURSE_IN_HAND - 1);
    expect(purseLeft(four, 9000 + PURSE_EVERY)).toBe(PURSE_IN_HAND);
  });

  it("never take anything for playing, and a run that paid nothing uses nothing up", () => {
    const start = camp({ acorns: 30, purseFrom: 1000 });
    const flop = afterGame(start, "flap", 0, at(1010));
    expect(flop).toMatchObject({ paid: 0, wager: null });
    expect(flop.state.acorns).toBe(30);
    expect(purseLeft(flop.state, 1010)).toBe(1);
    expect(flop.state.scores.flap).toEqual([0]);
  });

  it("know the reader's usual from the last few scores", () => {
    let state = camp();
    expect(usual(state, "dash")).toBeNull();
    expect(wagerBlocked(state, "dash", 5, DAY)).toBe("usual");
    for (const score of [40, 90, 60]) state = afterGame(state, "dash", score, at(1000)).state;
    expect(usual(state, "dash")).toBe(60);
    expect(wagerTarget(state, "dash")).toBe(61);
    for (const score of [1, 0, 1]) state = afterGame(state, "flap", score, at(1000)).state;
    // Never so low that a wager is a gift.
    expect(usual(state, "flap")).toBe(2);
    for (let run = 0; run < 20; run++) state = afterGame(state, "dash", 500, at(1000)).state;
    expect(state.scores.dash).toHaveLength(7);
    expect(usual(state, "dash")).toBe(500);
  });

  it("can be wagered on: the stake is taken at once, and doubled or lost on the next finished run", () => {
    const known = camp({ acorns: 50, scores: { dash: [40, 90, 60], catch: [], flap: [] }, purseFrom: 1000 }, { store: 1 });
    const placed = placeWager(known, "dash", 10, DAY);
    expect(placed.acorns).toBe(40);
    expect(placed.wager).toEqual({ game: "dash", stake: 10, target: 61 });
    expect(wagerBlocked(placed, "dash", 5, DAY)).toBe("pending");
    // A run of another game leaves it waiting.
    expect(afterGame(placed, "flap", 3, at(1000)).state.wager).not.toBeNull();
    const won = afterGame(placed, "dash", 61, at(1000));
    expect(won.wager).toEqual({ won: true, stake: 10 });
    expect(won.state.acorns).toBe(60);
    expect(won.state.stats.wagers).toBe(1);
    const lost = afterGame(placed, "dash", 60, at(1000));
    expect(lost.wager).toEqual({ won: false, stake: 10 });
    expect(lost.state.acorns).toBe(40);
    expect(placeWager(known, "dash", 7, DAY)).toBe(known);
    expect(wagerBlocked({ ...known, acorns: 3 }, "dash", 5, DAY)).toBe("acorns");
  });

  it("take three wagers a day", () => {
    let state = camp({ acorns: 100, scores: { dash: [], catch: [], flap: [3, 4, 5] } }, { store: 1 });
    for (let wager = 0; wager < WAGERS_A_DAY; wager++) {
      state = afterGame(placeWager(state, "flap", 5, DAY), "flap", 0, at(1000)).state;
    }
    expect(wagerBlocked(state, "flap", 5, DAY)).toBe("day");
    expect(wagerBlocked(state, "flap", 5, NEXT_DAY)).toBeNull();
  });
});

describe("the visitor", () => {
  it("has a sack of acorns and two other things, the same all day and not the same every day", () => {
    const state = camp();
    const today = offers(state, DAY)!;
    expect(today).toHaveLength(3);
    expect(today[0]).toMatchObject({ id: "sack", does: "6 acorns" });
    expect(new Set(today.map((offer) => offer.id)).size).toBe(3);
    expect(offers(state, DAY)).toEqual(today);
    const seen = new Set<string>();
    for (let day = 1; day <= 28; day++) seen.add(offers(state, `2026-02-${String(day).padStart(2, "0")}`)!.map((offer) => offer.id).join());
    expect(seen.size).toBeGreaterThan(4);
  });

  it("gives one thing a day", () => {
    const state = camp({ acorns: 10 });
    const taken = takeOffer(state, "sack", at(1000));
    expect(taken.acorns).toBe(16);
    expect(offers(taken, DAY)).toBeNull();
    expect(takeOffer(taken, "sack", at(1000))).toBe(taken);
    expect(offers(taken, NEXT_DAY)).not.toBeNull();
  });

  it("gives each of the others its own use, and none that would be wasted", () => {
    const dayWith = (id: string, state: BaseState) => {
      for (let day = 1; day <= 28; day++) {
        const key = `2026-03-${String(day).padStart(2, "0")}`;
        if (offers(state, key)!.some((offer) => offer.id === id)) return key;
      }
      throw new Error(`no day offers ${id}`);
    };
    const busy = build(camp({ acorns: 100 }, { store: 1, tower: 1 }), "hut", 1000);
    expect(takeOffer(busy, "tip", at(1000, dayWith("tip", busy))).intel).toBe(1);
    expect(takeOffer(busy, "hand", at(1000, dayWith("hand", busy))).jobs[0].needs).toBe(0);
    const oilDay = dayWith("oil", busy);
    expect(takeOffer(busy, "oil", at(1000, oilDay)).oil).toBe(oilDay);
    expect(takeOffer(busy, "pack", at(1000, dayWith("pack", busy))).pack).toBe(true);
    expect(offerWasted(camp(), "hand")).toBe("Nothing is going up");
    expect(offerWasted(camp(), "oil")).not.toBeNull();
    expect(offerWasted(camp({ intel: 3 }), "tip")).not.toBeNull();
    // There is always room for a sack (1.5.10).
    expect(offerWasted(camp({ acorns: 1400 }), "sack")).toBeNull();
    const idle = camp();
    expect(takeOffer(idle, "hand", at(1000, dayWith("hand", idle)))).toBe(idle);
  });
});

describe("a reading streak", () => {
  it("makes the gathering richer, more the longer it has run", () => {
    expect([0, 2, 3, 7, 14, 30, 400].map(streakAdds)).toEqual([0, 0, 0.1, 0.2, 0.3, 0.5, 0.5]);
    expect([0, 3, 29, 30].map(streakNext)).toEqual([3, 7, 30, null]);
    const grown = camp({ oakFrom: 1000, acorns: 0 }, { oak: 1, store: 1 });
    expect(gather(grown, 1050).acorns).toBe(40);
    expect(gather(grown, 1050, 7).acorns).toBe(48);
    expect(gather(grown, 1050, 30).acorns).toBe(60);
    // The tree is emptied the same either way: the streak adds, it does not take.
    expect(oakReady(gather(grown, 1050, 30), 1050)).toBe(0);
  });
});

describe("Pip's wish", () => {
  it("is for reading, the same all day, granted once it has come true, once a day", () => {
    const state = camp({ acorns: 0 });
    const idle = wishToday(state, at(1000))!;
    expect(idle.done).toBe(false);
    expect(wishToday(state, at(1000))).toEqual(idle);
    expect(grantWish(state, at(1000))).toBe(state);
    const read: Now = { ...at(1000), today: 60, goalMet: true };
    const wish = wishToday(state, read)!;
    expect(wish.done).toBe(true);
    const granted = grantWish(state, read);
    expect(granted.acorns).toBe(wish.reward);
    expect(wishToday(granted, read)).toBeNull();
    expect(grantWish(granted, read)).toBe(granted);
    expect(wishToday(granted, { ...read, day: NEXT_DAY })).not.toBeNull();
  });

  it("is a different wish on different days, every one of them reading, and worth more on a streak", () => {
    const state = camp();
    const seen = new Set<string>();
    for (let day = 1; day <= 28; day++) seen.add(wishToday(state, at(1000, `2026-02-${String(day).padStart(2, "0")}`))!.text);
    expect(seen.size).toBeGreaterThanOrEqual(4);
    for (const text of seen) expect(text).toMatch(/[Rr]ead/);
    const plain = wishToday(state, at(1000))!.reward;
    expect(wishToday(state, { ...at(1000), streak: 30 })!.reward).toBe(Math.round(plain * 1.5));
  });
});

describe("things set about the clearing", () => {
  it("are bought, set down where pointed, moved for nothing and taken away for nothing back", () => {
    // Not before their chapter (5), or a camp from before chapters at level 2.
    expect(decorBlocked(camp({ acorns: 50 }), 0)).toBe("chapter");
    expect(placeDecor(camp({ acorns: 50 }), 0, 100, 80).decor).toEqual([]);
    const state = camp({ acorns: 50 }, { burrow: 2 });
    const placed = placeDecor(state, 0, 100.4, 80.6);
    expect(placed.acorns).toBe(50 - DECOR[0].cost);
    expect(placed.decor).toEqual([{ kind: 0, x: 100, y: 81 }]);
    const moved = moveDecor(placed, 0, -50, 500);
    // To the edge of what the camp has cleared: the wood still stands beyond it.
    expect(moved.decor[0]).toEqual({ kind: 0, x: DECOR_LAND.left + woodAt(placed.levels.burrow), y: DECOR_LAND.bottom });
    expect(moved.acorns).toBe(placed.acorns);
    expect(removeDecor(moved, 0)).toMatchObject({ decor: [], acorns: placed.acorns });
    expect(placeDecor(state, 99, 10, 60)).toBe(state);
    expect(decorBlocked(camp({ acorns: 1 }, { burrow: 2 }), 3)).toBe("acorns");
    expect(decorBlocked({ ...state, decor: Array.from({ length: DECOR_MOST }, () => ({ kind: 0, x: 50, y: 60 })) }, 0)).toBe("full");
  });

  it("lend the camp charm, with its trophies and banners, and a charming camp is brought a fuller sack", () => {
    const plain = camp();
    expect(charm(plain)).toBe(0);
    const pretty = { ...plain, decor: [{ kind: 3, x: 50, y: 60 }, { kind: 6, x: 80, y: 60 }], banners: ["2026-10"], raised: ["a", "b", "c"] };
    expect(charm(pretty)).toBe(6 + 4 + 5 + 3);
    expect(offers(pretty, DAY)![0].does).toBe("7 acorns");
  });
});

describe("the word quiz", () => {
  it("gives a tip for seven right of ten, once a day, up to three", () => {
    expect(afterQuiz(camp(), 6, 10, DAY).intel).toBe(0);
    expect(afterQuiz(camp(), 4, 4, DAY).intel).toBe(0);
    const tipped = afterQuiz(camp(), 7, 10, DAY);
    expect(tipped.intel).toBe(1);
    expect(afterQuiz(tipped, 10, 10, DAY)).toBe(tipped);
    expect(afterQuiz(tipped, 10, 10, NEXT_DAY).intel).toBe(2);
    expect(afterQuiz(camp({ intel: 3 }), 10, 10, DAY).intel).toBe(3);
  });
});

describe("trophies", () => {
  it("are given to the books already finished without a gift, and raised for a gift after", () => {
    const start = camp({ acorns: 0 });
    const adopted = adopt(start, [{ id: "book-a", kind: 0 }, { id: "book-b", kind: 2 }]);
    expect(adopted.raised).toHaveLength(2);
    expect(adopted.acorns).toBe(0);
    expect(adopt(adopted, [{ id: "book-c", kind: 0 }])).toBe(adopted);
    expect(isRaised(adopted, "book-a")).toBe(true);
    const raised = raise(adopted, "book-c", "The Hobbit", DAY);
    expect(raised.acorns).toBe(15);
    expect(raised.events[0].text).toBe("A trophy for “The Hobbit”.");
    expect(raise(raised, "book-c", "The Hobbit", DAY)).toBe(raised);
  });

  it("keep a short key, not the book's own id", () => {
    const id = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    expect(trophyKey(id).length).toBeLessThanOrEqual(7);
    expect(trophyKey(id)).toBe(trophyKey(id));
    expect(trophyKey(id)).not.toBe(trophyKey(`${id}x`));
    expect(JSON.stringify(adopt(camp(), [{ id, kind: 0 }]))).not.toContain(id);
  });
});

describe("the club's boss", () => {
  it("is beaten by the members' week together, and shared once a club a week", () => {
    expect(clubBoss([30, 20], 0)).toMatchObject({ need: 120, done: 50, beaten: false });
    expect(clubBoss([100, 40, 60], 0)).toMatchObject({ need: 180, done: 180, beaten: true, reward: 60 });
    expect(clubBoss([500], 0).beaten).toBe(false);
    expect(clubBoss([100, 100], 120)).toMatchObject({ need: 240, beaten: false });
    const claimed = claimClub(camp({ acorns: 0 }), "club1", "2026-W42", 50, DAY);
    expect(claimed.acorns).toBe(50);
    expect(claimClub(claimed, "club1", "2026-W42", 50, DAY)).toBe(claimed);
    expect(claimClub(claimed, "club1", "2026-W43", 50, DAY).acorns).toBe(100);
  });
});

describe("Pip's list", () => {
  it("is kept up for older builds: ticked off by itself once a thing is done, and paying nothing (the chapter's goals pay)", () => {
    const fresh = camp({ acorns: 0 });
    expect(fresh.taught).toContain(LIST_MARK);
    expect(questNow(fresh)).toMatchObject({ index: 0, done: false });
    expect(advanceList(fresh, DAY)).toBe(fresh);
    const gathered = gather({ ...fresh, oakFrom: 0, levels: { ...fresh.levels, oak: 1 } }, 1000);
    expect(questNow(gathered)?.done).toBe(true);
    const ticked = advanceList(gathered, DAY);
    expect(ticked.quest).toBe(1);
    expect(ticked.acorns).toBe(gathered.acorns);
    expect(questNow(ticked)?.quest.text).toBe("Build a larder");
    // By hand it is the same: ticked, and nothing paid.
    expect(claimQuest(gathered, DAY)).toMatchObject({ quest: 1, acorns: gathered.acorns });
  });

  it("follows the burrow: a first camp is the oak, the larder, the welcome basket and the burrow's level 2, then the hut and the lookout", () => {
    expect(QUESTS.slice(0, 6).map((quest) => quest.id)).toEqual(["oak", "larder", "basket", "burrow2", "hut", "lookout"]);
    // Raising the burrow closes each group, and the levels come in order.
    expect(QUESTS.filter((quest) => quest.raise !== undefined).map((quest) => quest.raise)).toEqual([2, 3, 4, 5]);
    expect(new Set(QUESTS.map((quest) => quest.id)).size).toBe(QUESTS.length);
    // Nothing on it asks for what is gone: the night, the paths, wagers, the King.
    for (const quest of QUESTS) expect(quest.text).not.toMatch(/night|path|wager|King/);
  });

  it("can be finished by a camp that has done everything", () => {
    let done = camp({
      acorns: 0,
      camps: 25,
      banners: ["2026-10"],
      yard: yard({ kind: "hive", level: 1 }),
      stats: { gathered: 5, raids: 25, stars: 60, nights: 3, wagers: 2 },
      guards: [3, 1, 1, 1, 1, 1, 1],
      animals: [0, 1, 2, 3, 4, 5],
      works: [{ kind: 4, x: 100, y: 100 }],
      welcome: WELCOMED
    }, { burrow: 5, oak: 3, store: 5, fence: 1, tower: 1, hut: 1 });
    // (The fence is a wall across the trail since 1.5.11: it stands as soon as it is built; and a construct is on the front.)
    done = fronted({ ...done, front: { ...done.front, spots: [4, -1, -1] } });
    for (let index = 0; index < QUESTS.length; index++) {
      expect(questNow(done)?.done, QUESTS[index].text).toBe(true);
      done = claimQuest(done, DAY);
    }
    expect(questNow(done)).toBeNull();
    expect(claimQuest(done, DAY)).toBe(done);
  });

  it("passes over, without a reward, what a camp kept from before the list was rewritten has already done", () => {
    // A camp on the old list: its index pointed at the old fifth step, and it has a larder, a hut and a lookout.
    const old = { ...camp({ acorns: 0, quest: 4, stats: { gathered: 50, raids: 0, stars: 0, nights: 0, wagers: 0 } }, { oak: 1, store: 1, hut: 1, tower: 1 }), taught: [] };
    const moved = advanceList(old, DAY);
    expect(moved.taught).toContain(LIST_MARK);
    // From index 4 of the list now (the hut, done; the lookout, done), it stops at the fence, not done, and nothing is paid.
    expect(moved.quest).toBe(6);
    expect(moved.acorns).toBe(0);
    // Past the end of the new list, it is done with it.
    expect(advanceList({ ...old, quest: 22 }, DAY).quest).toBe(QUESTS.length);
    // An index past the end is read back as it was kept.
    expect(readBase(JSON.parse(JSON.stringify({ ...old, quest: 22 })))!.quest).toBe(22);
  });

  it("moves a camp from the list before 1.5.5 to the first thing it was not paid for, and never pays twice", () => {
    // On the old list it had been paid for the oak, the larder, the hut and the lookout (index 4: the burrow's level 2 next).
    const old = { ...camp({ acorns: 0, quest: 4, stats: { gathered: 50, raids: 0, stars: 0, nights: 0, wagers: 0 } }, { oak: 1, store: 1, hut: 1, tower: 1 }), taught: ["list2"], welcome: WELCOMED };
    const moved = advanceList(old, DAY);
    expect(moved.taught).toContain(`${LIST_MARK}:4`);
    // The basket (none for an old camp) is passed, and it stops at the burrow's level 2.
    expect(QUESTS[moved.quest].id).toBe("burrow2");
    expect(moved.acorns).toBe(0);
    // The burrow raised: the hut and the lookout are ticked off, and nothing is paid (1.5.10: the list pays nothing).
    const raised = advanceList({ ...moved, levels: { ...moved.levels, burrow: 2 } }, DAY);
    expect(QUESTS[raised.quest].id).toBe("fence");
    expect(raised.acorns).toBe(0);
    expect(rewardOf(raised, QUESTS.find((quest) => quest.id === "hut")!)).toBe(0);
    // A camp that was further on: paid for everything to the yard (index 9), the burrow's level 3 next.
    const far = advanceList({ ...old, quest: 9 }, DAY);
    expect(QUESTS[far.quest].id).toBe("burrow2");
    expect(rewardOf(far, QUESTS.find((quest) => quest.id === "yard")!)).toBe(30 - 30);
    expect(rewardOf(far, QUESTS.find((quest) => quest.id === "guardian")!)).toBe(60);
    // A new camp is paid for everything.
    expect(rewardOf(camp(), QUESTS[4])).toBe(QUESTS[4].reward);
  });

  it("waits at the welcome basket until it is opened, and pays nothing for it", () => {
    const base = camp({ acorns: 0, stats: { gathered: 5, raids: 0, stars: 0, nights: 0, wagers: 0 } }, { store: 1 });
    const waiting = { ...base, welcome: { given: true, basketOpened: false } } as BaseState;
    const at = advanceList(waiting, DAY);
    expect(QUESTS[at.quest].id).toBe("basket");
    const opened = advanceList({ ...at, welcome: { given: true, basketOpened: true } } as BaseState, DAY);
    expect(QUESTS[opened.quest].id).toBe("burrow2");
    expect(opened.acorns).toBe(at.acorns);
  });
});

describe("nothing promised that would not arrive", () => {
  it("nothing waits for room: parcels open however many acorns the camp has, and Open all opens them all", () => {
    const state = camp({ parcels: 7, oakFrom: 0, acorns: 1399 }, { oak: 2, store: 1 });
    expect(openParcel(state).acorns).toBe(1399 + parcelGives(state));
    expect(parcelsOpenable(state)).toBe(7);
    const all = openParcels(state);
    expect(all.parcels).toBe(0);
    expect(all.acorns - state.acorns).toBe(parcelsBring(state));
    expect(parcelsBring(state)).toBe(7 * parcelGives(state));
    // The oak: what the button says is what comes in, streak and season counted.
    for (const acorns of [0, 1397, 1400, 50_000]) {
      const before = { ...state, acorns };
      expect(gather(before, 1100, 14, "2026-10-12").acorns - before.acorns).toBe(gatherBrings(before, 1100, 14, "2026-10-12"));
    }
  });

  it("parcels wait in their dozens: up to 99, never six", () => {
    expect(PARCELS_MOST).toBe(99);
    let state = camp({ parcels: 0 }, { oak: 1 });
    for (let day = 1; day <= 20; day++) state = settle(state, { ...at(1000, `2026-11-${String(day).padStart(2, "0")}`), goalMet: true });
    expect(state.parcels).toBe(20);
    expect(readBase(JSON.parse(JSON.stringify({ ...state, parcels: 80 })))!.parcels).toBe(80);
  });
});

describe("the one next thing", () => {
  it("is always there, says where it is done, and is said as reading while what it asks for goes up", () => {
    const states: BaseState[] = [
      newBase(0, DAY),
      { ...newBase(0, DAY), oakFrom: -20 },
      build(camp({ acorns: 100 }, { oak: 1 }), "store", 1000),
      camp({ acorns: 5000, quest: 9 }, { burrow: 3, oak: 3, store: 4, fence: 2, tower: 2, hut: 2 }),
      camp({ acorns: 0, quest: QUESTS.length }, { burrow: 5, oak: 5, store: 5, fence: 5, tower: 5, hut: 5 }),
      camp({ acorns: 9999, quest: QUESTS.length }, { burrow: 2, oak: 1, store: 5 }),
      build(camp({ acorns: 9999, quest: QUESTS.length }, { burrow: 2, oak: 1, store: 5 }), "burrow", 1000)
    ];
    for (const state of states) {
      const next = nextStep(state, 1000);
      expect(next.text.length).toBeGreaterThan(5);
      expect([...SITES, "raids", "meadow"]).toContain(next.at);
    }
    expect(nextStep(newBase(0, DAY), 0).text).toBe("Tap the oak to take in its acorns");
    expect(nextStep({ ...newBase(0, DAY), oakFrom: -20 }, 0).text).toBe("Tap the oak to take in its acorns");
    // A larder kept from before 1.5.8, still waiting on reading, and it is what the list asks for: said as reading
    // until the camp is next brought up to now (which finishes it).
    const going = camp({ acorns: 100, quest: 1, jobs: [{ site: "store", to: 1, from: 1000, needs: 5 }] }, { oak: 1 });
    expect(nextStep(going, 1002).text).toBe("Read 3 more minutes: the larder is finished");
    expect(nextStep(settle(going, at(1002)), 1002).text).not.toMatch(/^Read/);
    // The list done: whatever is cheapest to build next, or reading.
    expect(nextStep(camp({ acorns: 9999, quest: QUESTS.length }, { burrow: 2, oak: 1, store: 5 }), 1000).text).toMatch(/^(Build|Raise) /);
    expect(nextStep(camp({ acorns: 0, quest: QUESTS.length }, { burrow: 5, oak: 5, store: 5, fence: 5, tower: 5, hut: 5 }), 1000).text).toMatch(/^Read \d+ h/);
  });
});

describe("a camp kept before the simplifying (2026-10-15)", () => {
  /** A camp with every part of the state set, the parts no longer played among them, as a 1.4 build would have kept it. */
  const everything = (): BaseState => {
    let kept = camp(
      {
        acorns: 400,
        camps: 7,
        intel: 2,
        oil: "2026-10-11",
        pack: true,
        visitor: "2026-10-11",
        quizDay: "2026-10-11",
        kingDay: "2026-10-01",
        wild: { day: "2026-10-11", done: [0, 2] },
        wishDay: "2026-10-11",
        decor: [{ kind: 3, x: 100, y: 100 }],
        purse: { day: "2026-10-11", wagers: 2 },
        wager: { game: "flap", stake: 5, target: 6 },
        scores: { dash: [10, 20, 30], catch: [4], flap: [1, 2, 3] },
        quest: 12,
        stats: { gathered: 900, raids: 9, stars: 20, nights: 4, wagers: 1, seenOff: 0 },
        story: { book: "abc", mark: 3, from: 900 },
        parcels: 2,
        prowled: { day: "2026-10-11", knocks: 1, thefts: 0 },
        taught: ["oak", "build"],
        hero: 0,
        banners: ["2026-09"],
        clubWins: ["club|2026-W41"],
        report: { day: "2026-10-11", held: false, count: 12, lit: true, side: "left", foe: 1, felled: 1, stolen: 3 },
        events: [{ day: "2026-10-11", text: "Something happened." }],
        dewDay: "2026-10-11",
        bonds: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        wants: { day: "2026-10-11", done: [0], won: [], set: [2] },
        trip: { from: 990, needs: 30 },
        tales: [1, 5],
        guards: [2, 0, 1, 0, 0, 0, 0],
        drill: { guard: 2, from: 995, needs: 45 },
        animals: [0, 3],
        animalsFrom: [0, -1, -1, 0, -1, -1],
        seenAt: 0,
        meadow: [{ kind: 1, x: 60, y: 90 }],
        eggDay: "2026-10-11",
        land: [{ kind: 0, x: 200, y: 80 }],
        works: [{ kind: 4, x: 100, y: 100 }],
        arms: [0, -1, -1, -1, -1, -1, -1, -1, -1, -1],
        nightAt: 990,
        harm: { store: 1 },
        rivals: { day: "2026-10-11", raided: ["tovah"] },
        wreck: { by: "Tovah", stars: 1, from: 995, needs: 4 },
        stolen: { kind: 2, x: 140, y: 100 }
      },
      { burrow: 3, oak: 3, store: 3, fence: 2, tower: 3, hut: 3 }
    );
    kept = { ...kept, forks: { tower: "b" }, gate: null, walls: [[100, 64], [110, 64]], posts: { 0: [120, 90] } };
    return kept;
  };
  const HIDDEN = ["intel", "oil", "pack", "visitor", "quizDay", "kingDay", "wild", "purse", "wager", "scores", "report", "dewDay", "bonds", "wants", "forks", "stolen", "banners", "clubWins"] as const;
  /** What a friend's card is drawn from (Rust's `camp_summary`): it must keep its shape. */
  const SUMMARY = ["levels", "yard", "camps", "banners", "raised", "spots", "walls", "decor", "land", "works", "guards", "posts"] as const;

  it("loads, and is written back as it was read", () => {
    const kept = JSON.parse(JSON.stringify(everything()));
    const read = readBase(kept)!;
    expect(read).not.toBeNull();
    expect(read.v).toBe(2);
    // All of it as it was, but the front (1.5.11): brought onto it, the wall and the constructs are where the front
    // has them, and anything paid back is in the larder.
    const FRONT = ["front", "walls", "gate", "works", "downed", "acorns", "events"];
    const without = (camp: Record<string, unknown>) => Object.fromEntries(Object.entries(camp).filter(([key]) => !FRONT.includes(key)));
    expect(without(JSON.parse(JSON.stringify(read)))).toEqual(without(kept));
    expect(read.acorns).toBeGreaterThanOrEqual(kept.acorns);
  });

  it("keeps every part that is no longer played, and what a friend's card shows, through a day of being looked at", () => {
    const read = readBase(JSON.parse(JSON.stringify(everything())))!;
    const after = settle(read, { minutes: 1000, day: "2026-10-12", lit: false, goalMet: false, at: 0 });
    for (const part of HIDDEN) expect(after[part], part).toEqual(read[part]);
    // The guardian that was training has done (1.5.8: training is paid in acorns, at once); the rest of the card stands.
    for (const part of SUMMARY) expect(after[part], part).toEqual(part === "guards" ? [2, 0, 2, 0, 0, 0, 0] : read[part]);
    expect(after.drill).toBeNull();
    expect(after.wreck).toBeNull();
    // And it is put on the new list, once, without being paid for what it had done.
    expect(after.taught).toEqual([...read.taught, LIST_MARK]);
    expect(after.acorns).toBe(read.acorns);
    // Written and read again, nothing moves.
    expect(readBase(JSON.parse(JSON.stringify(after)))).toEqual(after);
  });
});

describe("a camp read back", () => {
  it("comes back as it was kept", () => {
    let kept = camp({ acorns: 200, intel: 2, pack: true, banners: ["2026-09"], yard: yard({ kind: "workshop", level: 1 }) }, { burrow: 3, store: 2, tower: 3 });
    kept = choosePath(kept, "tower", "b");
    kept = build(build(kept, "fence", 1005), "yard1", 1005, "well");
    kept = placeWager({ ...kept, scores: { dash: [], catch: [], flap: [3, 4, 5] } }, "flap", 5, DAY);
    kept = settle(kept, at(1005, NEXT_DAY));
    expect(readBase(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
  });

  it("carries over a camp of the first version", () => {
    const first = {
      v: 1,
      acorns: 131,
      levels: { burrow: 2, oak: 1, store: 1, fence: 0, tower: 0, hut: 1 },
      job: { building: "fence", to: 1, from: 40, needs: 5 },
      oakFrom: 35,
      camps: 2,
      tries: 4,
      night: DAY,
      events: [{ kind: "built", day: DAY, building: "oak", level: 1 }]
    };
    const carried = readBase(first)!;
    expect(carried.v).toBe(2);
    expect(carried).toMatchObject({ acorns: 131, camps: 2, oakFrom: 35, adopted: false });
    expect(carried.jobs).toEqual([{ site: "fence", to: 1, from: 40, needs: 5 }]);
    expect(carried.yard).toEqual(yard({ kind: null, level: 0 }));
    // Its scouts start rested for one raid; the old log, in another shape, is let go.
    expect(raidsReady(carried, 35)).toBe(1);
    expect(carried.events).toEqual([]);
  });

  it("is refused when it is not one, and mended where it can be", () => {
    expect(readBase(null)).toBeNull();
    expect(readBase("camp")).toBeNull();
    expect(readBase({ v: 3 })).toBeNull();
    expect(readBase({ ...camp(), acorns: "lots" })).toBeNull();
    expect(readBase({ ...camp(), levels: { burrow: 1 } })).toBeNull();
    const mended = readBase({
      ...camp(),
      acorns: 9e12,
      levels: { burrow: 0, oak: 99, store: -3, fence: 1.9, tower: 0, hut: 0 },
      yard: [{ kind: "hive", level: 9 }, { kind: "hive", level: 1 }, { kind: "well", level: 1 }],
      forks: { oak: "a", tower: "a", hut: "z" },
      jobs: [{ site: "oak", to: 3, from: 10, needs: 0 }, { site: "nowhere" }],
      intel: 50,
      wager: { game: "chess", stake: 5, target: 3 },
      events: [{ day: DAY, text: "Fine." }, { day: DAY }, "x"]
    })!;
    // Nothing caps the acorns since 1.5.10, but a number past belief is held to a billion.
    expect(mended.acorns).toBe(1_000_000_000);
    expect(mended.levels).toEqual({ burrow: 1, oak: MAX_LEVEL, store: 0, fence: 1, tower: 0, hut: 0 });
    // One of each kind in the yard; a path only for a building tall enough; no job that is not the next level.
    expect(mended.yard).toEqual(yard({ kind: "hive", level: 3 }));
    expect(mended.forks).toEqual({ oak: "a" });
    expect(mended.jobs).toEqual([]);
    expect(mended.intel).toBe(3);
    expect(mended.wager).toBeNull();
    expect(mended.events).toEqual([{ day: DAY, text: "Fine." }]);
    expect(YARD_KINDS).toHaveLength(4);
  });

  it("starts its counts again when the reading total is lower than it was", () => {
    const begun = build(camp({ oakFrom: 1000, raidFrom: 990, purseFrom: 995, acorns: 50 }, { oak: 1 }), "store", 1000);
    const restored = settle(begun, at(400));
    expect(restored).toMatchObject({ oakFrom: 400, raidFrom: 400, purseFrom: 400 });
    // What was paid for stands, whatever the reading total says.
    expect(restored.levels.store).toBe(1);
  });
});

describe("what the camp says elsewhere", () => {
  it("is a line at the end of a session, when there is one to say", () => {
    const quiet = camp();
    expect(campNews(quiet, 1000)).toBeNull();
    const built = build(camp({ oakFrom: 1000, acorns: 100 }, { oak: 1, store: 1 }), "hut", 1000, undefined, undefined, DAY);
    expect(campNews(built, 1001)).toBeNull();
    expect(campNews(built, 1003)).toBe("2 acorns on the oak.");
    expect(campNews(built, 1030)).toBe("24 acorns on the oak.");
  });

  it("says whether anything is waiting: only what reading has brought", () => {
    const quiet = camp();
    expect(campWaits(quiet, at(1000))).toBe(false);
    // Fence built and not put down, a hedgehog not seen, a day turned: none of them a dot (since 2026-10-15).
    expect(campWaits({ ...quiet, visitor: null, night: "2020-01-01", levels: { ...quiet.levels, burrow: 3, fence: 1 } }, at(1000))).toBe(false);
    expect(campWaits({ ...build({ ...quiet, acorns: 100 }, "hut", 1000) }, at(1005))).toBe(true);
    expect(campWaits({ ...quiet, levels: { ...quiet.levels, oak: 1 }, oakFrom: 0 }, at(5000))).toBe(true);
    expect(campWaits({ ...quiet, parcels: 1 }, at(1000))).toBe(true);
  });
});
