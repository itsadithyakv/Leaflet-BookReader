import { describe, expect, it } from "vitest";
import { BATTLE_TICK, Battle } from "./battle";
import { BLADES, BLADE_AT_BOND, FOES, LAND_MOST, SCENERY, WORKS, bladeSays } from "./guards";
import { heroTraits } from "./heroes";
import {
  DECOR,
  LAND_LAND,
  armHero,
  bladeOf,
  bladesWon,
  campStructures,
  charm,
  chooseHero,
  finishRaid,
  heroWith,
  landBlocked,
  moveLand,
  newBase,
  nightFoe,
  nightOutcome,
  nightRaiders,
  startFriendRaid,
  placeLand,
  buyWork,
  fronted,
  placeWork,
  seatWork,
  raise,
  readBase,
  removeLand,
  settle,
  startRaid,
  workBlocked,
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
/** A construct set down at a point, as the battle meets it (the front seats them on its slots: `buyWork`, `seatWork`). */
const withWork = (state: BaseState, kind: number, x: number, y: number): BaseState => ({ ...state, works: [...state.works.filter((entry) => entry.kind !== kind), { kind, x, y }] });
const days = Array.from({ length: 200 }, (_, index) => `2027-${String(1 + Math.floor(index / 28)).padStart(2, "0")}-${String(1 + (index % 28)).padStart(2, "0")}`);

describe("landscape", () => {
  it("is set down anywhere in either clearing, for its own sake, and counts for nothing", () => {
    const open = camp({ acorns: 500 }, { burrow: 3 });
    const pond = placeLand(open, 0, 100, 90);
    expect(pond.land).toEqual([{ kind: 0, x: 100, y: 90 }]);
    expect(pond.acorns).toBe(open.acorns - SCENERY[0].cost);
    expect(charm(pond)).toBe(charm(open));
    // A knoll can stand further back than anything else, against the trees; nothing goes off the ground.
    expect(placeLand(open, 2, 120, 10).land[0]).toEqual({ kind: 2, x: 120, y: LAND_LAND.top });
    expect(placeLand(open, 1, 100, 90, "meadow").meadowLand).toHaveLength(1);
    expect(placeLand(camp({ acorns: 500 }, { burrow: 2 }), 1, 100, 90, "meadow").meadowLand).toHaveLength(0);
    expect(moveLand(pond, 0, 60, 70).land[0]).toMatchObject({ x: 60, y: 70 });
    expect(removeLand(pond, 0).land).toEqual([]);
    expect(placeLand({ ...open, acorns: 3 }, 1, 100, 90).land).toEqual([]);
    const full = { ...open, land: Array.from({ length: LAND_MOST }, () => ({ kind: 8, x: 50, y: 80 })) };
    expect(landBlocked(full, 8)).toBe("full");
    expect(landBlocked(full, 8, "meadow")).toBeNull();
    // Nothing of it is in the way of anybody: the camp as the raiders meet it is the same.
    expect(campStructures(pond, false)).toEqual(campStructures(open, false));
  });

  it("is ten things: water and flowers that lie on the ground, and things that stand", () => {
    expect(SCENERY).toHaveLength(10);
    expect(SCENERY.filter((piece) => piece.flat).map((piece) => piece.name)).toEqual(["Pond", "Lake", "Wildflowers", "Stepping stones", "Tall grass"]);
  });
});

describe("the constructs", () => {
  const ready = camp({ acorns: 2000 }, { burrow: 4, store: 3, tower: 2, hut: 2 });

  it("go on the front since 1.5.11: a trap on a spot on the trail, a tower on a pad behind the wall, the rest in the shed", () => {
    // The ward stone is no more (it is the archer's nest now): nobody can have one.
    expect(workBlocked({ ...ready, acorns: 10_000 }, 0)).toBe("chapter");
    expect(workBlocked({ ...ready, acorns: 10 }, 10)).toBe("acorns");
    const set = buyWork(ready, 10);
    expect(set.acorns).toBe(ready.acorns - WORKS[10].cost);
    expect(set.front.pads[0]).toBe(10);
    expect(set.works).toEqual([{ kind: 10, x: set.works[0].x, y: set.works[0].y }]);
    // Behind the wall, by the gate.
    expect(set.works[0].x).toBeGreaterThan(set.front.x);
    // Two of a tower at most, one of anything else.
    const two = buyWork(set, 10);
    expect(workBlocked(two, 10)).toBe("most");
    const trap = buyWork(two, 8);
    expect(workBlocked(trap, 8)).toBe("most");
    // On the trail, in front of the wall.
    const strip = trap.works.find((entry) => entry.kind === 8)!;
    expect(strip.x).toBeLessThan(trap.front.x);
    // Taken off a spot, it goes to the shed, and back on for nothing.
    const off = seatWork(trap, { at: "spot", index: trap.front.spots.indexOf(8) }, -1);
    expect(off.front.shed).toContain(8);
    expect(off.works.some((entry) => entry.kind === 8)).toBe(false);
    const on = seatWork(off, { at: "spot", index: 0 }, 8);
    expect(on.acorns).toBe(off.acorns);
    expect(on.front.shed).not.toContain(8);
    // A trap is not put on a pad, nor a tower on a spot.
    expect(seatWork(on, { at: "pad", index: 0 }, 8)).toBe(on);
    expect(WORKS).toHaveLength(12);
    // (Set down by a point, as before 1.5.11: it goes to the nearest slot of its sort.)
    expect(placeWork(ready, 4, 10, 85).front.spots).toContain(4);
  });

  it("stand in the camp as the raiders meet it, each with the one thing it does", () => {
    let set: BaseState = { ...ready, acorns: 5000, levels: { ...ready.levels, burrow: 5 }, legacy: { burrow: 5 } };
    WORKS.forEach((_, kind) => (set = withWork(set, kind, 30 + kind * 24, 100)));
    const made = campStructures(set, false).filter((entry) => entry.look?.name === "work");
    expect(made.map((entry) => entry.look?.variant)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(made[0].grounds).toBe(WORKS[0].reach);
    expect(made[1].cuts).toBeGreaterThan(0);
    expect(made[2].lures).toBe(true);
    expect(made[3].hides).toBe(true);
    expect(made[4]).toMatchObject({ slows: 0.55, zone: WORKS[4].reach });
    expect(made[5]).toMatchObject({ stings: 5, zone: WORKS[5].reach });
    expect(made[6].traps).toBe(3);
    expect(made[7]).toMatchObject({ rouses: 0.7, zone: WORKS[7].reach });
    // Caltrops lie on the ground and cut; the nest and the stone thrower throw, each its own way; the totem takes the heart out of them.
    expect(made[8]).toMatchObject({ cuts: 3, flat: true });
    expect(made[9]).toMatchObject({ range: WORKS[9].reach, hit: 4 });
    expect(made[10]).toMatchObject({ range: WORKS[10].reach, hit: 2 });
    expect(made[9].every).toBeGreaterThan(made[10].every * 2);
    expect(made[11]).toMatchObject({ daunts: 0.5, zone: WORKS[11].reach });
    expect([made[4].flat, made[6].flat]).toEqual([true, true]);
    // Each comes with a level of the camp, and not before.
    expect(WORKS.map((work) => work.burrow)).toEqual([3, 3, 4, 4, 2, 3, 4, 5, 2, 3, 2, 4]);
  });

  const lone = (laid: BaseState, kind: "sprout" | "mole", x: number, y: number, faction = 0) => {
    const battle = new Battle({ ...nightRaiders(laid), capacity: 1, kinds: [kind], faction }, campStructures(laid, false));
    battle.deploy(kind, x, y);
    return battle;
  };
  const targetOf = (battle: Battle) => {
    battle.step(BATTLE_TICK);
    const target = battle.structures[battle.units[0].target!];
    return target.look?.name === "work" ? WORKS[target.look.variant].name : target.look?.name;
  };
  // The larder at the east, a fence across the way to it, and everything else out of the line.
  const laid = (() => {
    const state = { ...ready, levels: { ...ready.levels, fence: 2 }, spots: { ...ready.spots, store: [200, 90] as [number, number], burrow: [60, 70] as [number, number], hut: [40, 108] as [number, number], tower: [30, 70] as [number, number], oak: [100, 112] as [number, number] } };
    return { ...state, walls: [[170, 94]] as Array<[number, number]> };
  })();

  it("a ward stone grounds the ones on the wing: inside its ring a fence stops them like anybody else", () => {
    expect(targetOf(lone(laid, "mole", 140, 90))).toBe("store");
    const warded = withWork(laid, 0, 150, 104);
    expect(targetOf(lone(warded, "mole", 140, 90))).toBe("fencepiece");
    // And out of its ring they fly as before.
    expect(targetOf(lone(withWork(laid, 0, 30, 110), "mole", 140, 90))).toBe("store");
  });

  it("a thumper draws whoever is on foot, but not the Gilded; and smoke sends them to whatever is nearest", () => {
    const drum = withWork(laid, 2, 110, 110);
    expect(targetOf(lone(drum, "sprout", 130, 80))).toBe("Thumper");
    expect(targetOf(lone(drum, "sprout", 130, 80, 2))).not.toBe("Thumper");
    expect(targetOf(lone(drum, "mole", 130, 80))).toBe("store");
    const smoke = withWork(laid, 3, 30, 112);
    // The burrow is nearer than the larder, and with the larder hidden it is the burrow they go for.
    expect(targetOf(lone(laid, "sprout", 80, 80))).toBe("store");
    expect(targetOf(lone(smoke, "sprout", 80, 80))).toBe("burrow");
  });

  it("a hedge cuts whoever walks through it, and nobody who flies over", () => {
    const hedge = withWork(laid, 1, 140, 90);
    const walker = lone(hedge, "sprout", 140, 92);
    const flier = lone(hedge, "mole", 140, 92);
    for (let tick = 0; tick < 30; tick++) {
      walker.step(BATTLE_TICK);
      flier.step(BATTLE_TICK);
    }
    expect(walker.units[0].hp).toBeLessThan(walker.units[0].max);
    expect(flier.units[0].hp).toBe(flier.units[0].max);
  });
});

describe("who comes by night", () => {
  it("is the magpies for a small camp, and others as it grows, the same all day", () => {
    const small = camp({}, { burrow: 2 });
    expect(new Set(days.map((day) => nightFoe(small, day)))).toEqual(new Set([0]));
    const grown = camp({}, { burrow: 5 });
    const seen = days.map((day) => nightFoe(grown, day));
    expect(new Set(seen)).toEqual(new Set([0, 1, 2, 3, 4]));
    // Magpies as often as all the others together, near enough.
    expect(seen.filter((foe) => foe === 0).length).toBeGreaterThan(days.length * 0.35);
    expect(nightFoe(grown, DAY)).toBe(nightFoe(grown, DAY));
    expect(new Set(days.map((day) => nightFoe(camp({}, { burrow: 3 }), day)))).toEqual(new Set([0, 1]));
    expect(FOES).toHaveLength(5);
  });

  it("are each a different thing to stand against", () => {
    const grown = camp({ camps: 12 }, { burrow: 5, store: 3 });
    const dayOf = (foe: number) => days.find((day) => nightFoe(grown, day) === foe)!;
    const flock = nightRaiders(grown, dayOf(0));
    expect(flock.kinds).toContain("mole");
    // A rabble is a great many; the Gilded are few; nobody but a magpie flies.
    expect(nightRaiders(grown, dayOf(1)).capacity).toBeGreaterThan(flock.capacity);
    expect(nightRaiders(grown, dayOf(2)).capacity).toBeLessThan(flock.capacity / 2);
    for (const foe of [1, 2, 3, 4]) expect(nightRaiders(grown, dayOf(foe))).toMatchObject({ faction: foe, kinds: ["sprout"] });

    const one = (faction: number) => {
      const battle = new Battle({ ...nightRaiders(grown), capacity: 1, kinds: ["sprout"], faction }, campStructures(grown, false));
      battle.deploy("sprout", 10, 100);
      return battle;
    };
    // One of the Gilded is as sturdy as three magpies; one of the Stumbling gets up again, once.
    expect(one(2).units[0].max).toBeGreaterThan(one(0).units[0].max * 3);
    const shambler = one(3);
    shambler.units[0].hp = 0;
    shambler.step(BATTLE_TICK);
    expect(shambler.units[0].hp).toBeGreaterThan(0);
    shambler.units[0].hp = 0;
    shambler.step(BATTLE_TICK);
    expect(shambler.units[0].hp).toBe(0);
    const magpie = one(0);
    magpie.units[0].hp = 0;
    magpie.step(BATTLE_TICK);
    expect(magpie.units[0].hp).toBe(0);
  });
});

describe("a night lost", () => {
  // A camp that will lose: a bold flock, a full larder by itself at the edge, a fence in front of it, things set about.
  const doomed = (() => {
    let state = camp({ acorns: 800, camps: 20, night: "2027-01-01", nightAt: 900 }, { burrow: 5, store: 4, fence: 2 });
    state = { ...state, spots: { ...state.spots, store: [210, 84] }, decor: [{ kind: 13, x: 60, y: 100 }, { kind: 3, x: 100, y: 110 }] };
    return { ...state, walls: Array.from({ length: 6 }, (_, piece): [number, number] => [190, 64 + piece * 10]) };
  })();
  const lostOn = days.find((day) => {
    const night = nightOutcome({ ...doomed, night: day }, day, false)!;
    return !night.held && night.broken.length > 0 && night.emptied;
  })!;

  it("is not fought since 2026-10-15: a day turning leaves the fence, the things set about and the larder as they were", () => {
    expect(lostOn).toBeTruthy();
    const before = { ...doomed, night: lostOn };
    const after = settle(before, at(1000, "2028-06-01"));
    expect(after.report).toBeNull();
    // (The wall is made from the fence's level since 1.5.11: whatever it was, it is that and no worse.)
    expect(after.walls).toEqual(fronted(before).walls);
    expect(after.decor).toEqual(before.decor);
    expect(after.acorns).toBe(before.acorns);
    expect(after.stolen).toBeNull();
    // The night is still marked as through, so that bringing the battle back would not play every night since.
    expect(after.night).toBe("2028-06-01");
  });

  it("left a thing carried off in a camp kept from before: the next raid won brings it home to where it stood", () => {
    const gone = doomed.decor[0];
    const robbed = { ...doomed, decor: doomed.decor.slice(1), stolen: gone };
    const hunting = { ...robbed, levels: { ...robbed.levels, hut: 3 }, raidFrom: 0, acorns: 500 };
    const begun = startRaid(hunting, "camp", at(1000, "2028-06-01"))!;
    const lost = finishRaid(begun.state, begun.raid, { stars: 0, destroyed: 0.1, hoards: 0 }, "2028-06-01");
    expect(lost.state.stolen).toEqual(gone);
    expect(lost.end.home).toBeNull();
    const won = finishRaid(begun.state, begun.raid, { stars: 2, destroyed: 0.7, hoards: 1 }, "2028-06-01");
    expect(won.end.home).toBe(gone.kind);
    expect(won.state.stolen).toBeNull();
    expect(won.state.decor).toContainEqual(gone);
    expect(won.state.events[0].text).toContain(`The ${DECOR[gone.kind].name.toLowerCase()} is home again.`);
  });
});

describe("the blades", () => {
  it("are won from each lord of the magpies the first time he falls, and from the King", () => {
    expect(bladesWon(camp())).toEqual([]);
    expect(bladesWon(camp({ camps: 3 }))).toEqual([0]);
    expect(bladesWon(camp({ camps: 15 }))).toEqual([0, 1, 2, 3, 4]);
    expect(bladesWon(camp({ camps: 300, banners: ["2026-10"] }))).toEqual([0, 1, 2, 3, 4, 5]);
    // The third stronghold is a lord's: taking it is what wins his.
    const ready = camp({ acorns: 300, camps: 2, raidFrom: 0 }, { burrow: 3, hut: 3, store: 2 });
    const begun = startRaid(ready, "camp", at(1000))!;
    const won = finishRaid(begun.state, begun.raid, { stars: 2, destroyed: 0.7, hoards: 1 }, DAY);
    expect(won.end.blade).toBe(0);
    expect(won.state.events[0].text).toMatch(/Thornwhip is the camp's\.$/);
    expect(finishRaid(begun.state, begun.raid, { stars: 0, destroyed: 0.2, hoards: 0 }, DAY).end.blade).toBeNull();
    expect(new Set(BLADES.map((blade) => blade.name)).size).toBe(BLADES.length);
    for (const blade of BLADES) expect(bladeSays(blade).length, blade.name).toBeGreaterThan(5);
  });

  it("are given by a hero who has become a friend: their own", () => {
    const state = raise(raise(camp(), "sea", "A Sea Story", DAY, 9), "any", "A Book", DAY, 0);
    expect(bladesWon(state)).toEqual([]);
    const friend = { ...state, bonds: state.bonds.map((_, hero) => (hero === 2 ? BLADE_AT_BOND : 0)) };
    expect(bladesWon(friend)).toEqual([6]);
    expect(BLADES[6]).toMatchObject({ name: "Undertow", hero: 2 });
  });

  it("are carried by one hero at a time, and change what that hero is on a raid", () => {
    const state = chooseHero(raise(camp({ camps: 9 }), "any", "A Book", DAY, 0), 0);
    expect(bladeOf(state, 0)).toBe(-1);
    expect(armHero(state, 0, 5)).toBe(state);
    const armed = armHero(state, 0, 1);
    expect(bladeOf(armed, 0)).toBe(1);
    const plain = heroTraits(0)!;
    // The Maker's Tooth: a third harder, a tenth frailer.
    expect(heroWith(armed)!.dps).toBeCloseTo(plain.dps * 1.35, 1);
    expect(heroWith(armed)!.hp).toBe(Math.round(plain.hp * 0.9));
    expect(heroWith(armHero(state, 0, 0))!.reach).toBe(plain.reach + 10);
    expect(heroWith(armHero(state, 0, 2))).toMatchObject({ splash: 6 });
    // Given to another, it leaves the first hand; taken away, nobody has it.
    const passed = armHero(armed, 3, 1);
    expect([bladeOf(passed, 0), passed.arms[3]]).toEqual([-1, 1]);
    expect(bladeOf(armHero(armed, 0, -1), 0)).toBe(-1);
    // A camp that no longer has a blade (it cannot happen, but a kept file may say so) does not carry it.
    expect(bladeOf({ ...armed, camps: 0 }, 0)).toBe(-1);
  });
});

describe("a camp kept, with all of this", () => {
  it("comes back as it was, and one kept before reads as having none of it", () => {
    let kept = camp({ acorns: 3000, camps: 9, nightAt: 950 }, { burrow: 4, store: 2 });
    kept = buyWork(placeLand(placeLand(kept, 1, 100, 90), 4, 30, 60, "meadow"), 4);
    kept = { ...armHero(raise(kept, "any", "A Book", DAY, 0), 0, 2), stolen: { kind: 4, x: 50, y: 90 } };
    const back = readBase(JSON.parse(JSON.stringify(kept)))!;
    expect(back.land).toEqual(kept.land);
    expect(back.meadowLand).toEqual(kept.meadowLand);
    expect(back.works).toEqual(kept.works);
    expect(back.arms).toEqual(kept.arms);
    expect(back.nightAt).toBe(950);
    expect(back.stolen).toEqual(kept.stolen);

    const old = JSON.parse(JSON.stringify(newBase(1000, DAY))) as Record<string, unknown>;
    for (const part of ["land", "meadowLand", "works", "arms", "nightAt", "stolen", "front"]) delete old[part];
    const read = readBase(old)!;
    expect(read).toMatchObject({ land: [], meadowLand: [], works: [], nightAt: 0, stolen: null });
    expect(read.arms.every((blade) => blade === -1)).toBe(true);
    // A blade in two hands, and things of no kind are not kept. Two ward stones (kept before 1.5.11) are two
    // archer's nests now; the dread totem a kind of no kind is read as is no more, and paid back.
    const odd = readBase({ ...old, works: [{ kind: 0, x: 50, y: 90 }, { kind: 0, x: 90, y: 90 }, { kind: 99, x: 1, y: 1 }], arms: [1, 1, 99, -5], land: [{ kind: 99, x: 5, y: 5 }, { kind: 2, x: 500, y: 5 }] })!;
    expect([...odd.front.pads, ...odd.front.shed].filter((kind) => kind === 10)).toHaveLength(2);
    expect(odd.acorns).toBe((old.acorns as number) + WORKS[11].cost);
    expect(odd.arms.slice(0, 4)).toEqual([1, -1, 8, -1]);
    expect(odd.land).toEqual([{ kind: 9, x: 6, y: 46 }, { kind: 2, x: 234, y: 46 }]);
  });
});

describe("the newer constructs", () => {
  const ready: BaseState = { ...camp({ acorns: 5000 }, { burrow: 5, store: 3, tower: 2, hut: 2, fence: 2 }) };
  // The larder at the east and everything else out of the line: a walker set down in the west has a straight way to it.
  const laid: BaseState = { ...ready, spots: { ...ready.spots, store: [200, 90], burrow: [60, 66], hut: [40, 112], tower: [30, 66], oak: [90, 112] } };
  const lone = (state: BaseState, kind: "sprout" | "mole", x: number, y: number) => {
    const battle = new Battle({ ...nightRaiders(state), capacity: 1, kinds: [kind], faction: 0 }, campStructures(state, false));
    battle.deploy(kind, x, y);
    return battle;
  };
  const after = (battle: Battle, seconds: number) => {
    for (let gone = 0; gone < seconds; gone += BATTLE_TICK) battle.step(BATTLE_TICK);
    return battle.units[0];
  };

  it("a tanglefoot patch slows whoever walks through it, and nobody who flies over", () => {
    const patch = withWork(laid, 4, 130, 90);
    const free = after(lone(laid, "sprout", 120, 90), 1).x;
    const held = after(lone(patch, "sprout", 120, 90), 1).x;
    expect(free - 120).toBeGreaterThan(1);
    expect(held - 120).toBeLessThan((free - 120) * 0.6);
    // It is walked into, not stopped at.
    const battle = lone(patch, "sprout", 100, 90);
    battle.step(BATTLE_TICK);
    expect(battle.structures[battle.units[0].target!].look?.name).toBe("store");
    expect(after(lone(patch, "mole", 120, 90), 1).x).toBeCloseTo(after(lone(laid, "mole", 120, 90), 1).x, 3);
  });

  it("a hornet jar stings what is on the wing near it, and leaves a walker be", () => {
    const jar = withWork(laid, 5, 130, 104);
    expect(after(lone(jar, "mole", 130, 92), 1).hp).toBeLessThan(after(lone(laid, "mole", 130, 92), 1).hp);
    expect(after(lone(jar, "sprout", 130, 92), 1).hp).toBe(after(lone(laid, "sprout", 130, 92), 1).hp);
    // Out of its reach, nothing.
    expect(after(lone(jar, "mole", 40, 60), 0.5).hp).toBe(after(lone(laid, "mole", 40, 60), 0.5).hp);
  });

  it("a pitfall has the first three on foot who step on it, and then is full", () => {
    const pit = withWork(laid, 6, 130, 90);
    const battle = new Battle({ ...nightRaiders(pit), capacity: 5, kinds: ["sprout"], faction: 0 }, campStructures(pit, false));
    for (let scout = 0; scout < 5; scout++) battle.deploy("sprout", 100 - scout * 4, 90);
    for (let gone = 0; gone < 8; gone += BATTLE_TICK) battle.step(BATTLE_TICK);
    const hole = battle.structures.find((entry) => entry.look?.variant === 6 && entry.look.name === "work")!;
    expect(hole.traps).toBe(0);
    expect(hole.hp).toBe(0);
    expect(battle.units.filter((unit) => unit.hp <= 0).length).toBeGreaterThanOrEqual(3);
    // Nobody made for it: it was stepped on, on the way to the larder.
    expect(battle.units.every((unit) => unit.target === null || battle.structures[unit.target].look?.name !== "work" || battle.structures[unit.target].look?.variant !== 6)).toBe(true);
    // And it is not counted with what there was to pull down.
    expect(battle.result().destroyed).toBeLessThan(0.5);
    // One who flies over is not its business.
    const over = new Battle({ ...nightRaiders(pit), capacity: 1, kinds: ["mole"], faction: 0 }, campStructures(pit, false));
    over.deploy("mole", 126, 90);
    for (let gone = 0; gone < 0.5; gone += BATTLE_TICK) over.step(BATTLE_TICK);
    expect(over.units[0].hp).toBeGreaterThan(0);
  });

  it("a watch bell has the camp throwing oftener while anyone is near it", () => {
    // One on foot by the burrow, which throws: how long it waits before it throws again, with the bell in earshot and without.
    const wait = (state: BaseState) => {
      const battle = lone(state, "sprout", 62, 84);
      const nest = battle.structures.find((entry) => entry.kind === "nest")!;
      let last = nest.cool;
      for (let gone = 0; gone < 4; gone += BATTLE_TICK) {
        battle.step(BATTLE_TICK);
        // It has just thrown: the wait was set again.
        if (nest.cool > last) return nest.cool;
        last = nest.cool;
        battle.units[0].hp = battle.units[0].max;
      }
      return -1;
    };
    const quiet = wait(laid);
    expect(quiet).toBeGreaterThan(0);
    expect(wait(withWork(laid, 7, 74, 92))).toBeCloseTo(quiet * 0.7, 3);
    // Out of earshot it rings for nobody.
    expect(wait(withWork(laid, 7, 220, 110))).toBeCloseTo(quiet, 3);
  });

  it("act on a friend's scouts as they do on the night's raiders", () => {
    // Their larder to the east of where the scouts are put down, the pit on the way to it, and everything else far off.
    const theirs = {
      levels: laid.levels,
      yard: [],
      spots: { ...laid.spots, store: [156, 90] as [number, number], burrow: [222, 66] as [number, number], oak: [222, 110] as [number, number], tower: [226, 88] as [number, number], hut: [190, 64] as [number, number] },
      works: [{ kind: 6, x: 132, y: 90 }]
    };
    const begun = startFriendRaid({ ...ready, raidFrom: 0 }, theirs, { handle: "t", name: "T" }, { minutes: 600, day: "2026-10-13", lit: false })!;
    expect(begun.raid.setup.works).toBe(true);
    // (1.5.11) Their pitfall is on their trail now, and the scouts come down it from the left.
    const pit = begun.raid.structures.find((entry) => entry.look?.name === "work" && entry.look.variant === 6)!;
    expect(pit.x).toBeLessThan(begun.raid.structures.find((entry) => entry.kind === "hoard")!.x);
    const battle = new Battle({ ...begun.raid.setup, capacity: 4, kinds: ["sprout"], hero: null }, begun.raid.structures);
    for (let scout = 0; scout < 4; scout++) battle.deploy("sprout", 8 + scout * 2, pit.y);
    expect(battle.units).toHaveLength(4);
    for (let gone = 0; gone < 4; gone += BATTLE_TICK) battle.step(BATTLE_TICK);
    expect(battle.units.filter((unit) => unit.hp <= 0).length).toBeGreaterThanOrEqual(3);
    expect(battle.structures.find((entry) => entry.look?.name === "work")?.traps).toBe(0);
  });
});
