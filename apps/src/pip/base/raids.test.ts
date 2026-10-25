/**
 * Planned raids (the raids plan, 2026-10-24): approaches, quirks and their
 * counters, orders, feats, the squad's room, the forecast, and a raid played
 * again exactly from its plan and orders.
 */
import { describe, expect, it } from "vitest";
import { approachesOf, rollOf } from "./approaches";
import { BATTLE_TICK, Battle, DROP_STRONGHOLD, autoPlay, layout, type ScoutKind, type Setup, type Squad } from "./battle";
import { BELL_SECONDS, FEATS, MISSED, starsOf, type Tally } from "./feats";
import { HEROES, HERO_MOVES, heroTraits } from "./heroes";
import { HELD_LATEST, ordersAt, type Order } from "./orders";
import { QUIRKS, QUIRK_IDS, quirkOf } from "./quirks";
import { checkSquad, forecastInSteps, forecastPlan, naiveSquad, planned, playOut, roomOf, scoutOf } from "./squad";
import { campOfShared, campStructures, finishFriendRaid, finishRaid, newBase, raidForecast, startFriendRaid, startRaid, nextCamp, type BaseState, type SharedCamp } from "./rules";
import { beforeChapters } from "./testing";

const TRAINED_AT: Record<ScoutKind, number> = { sprout: 1, slinger: 2, bomber: 3, mole: 4 };
/** A stronghold's setup at a hut level, as `rules.ts` makes one (no hero, no fork). */
const setupAt = (n: number, hut: number, more: Partial<Setup> = {}): Setup => ({
  n,
  king: false,
  capacity: 5 + 2 * hut,
  level: hut,
  kinds: (Object.keys(TRAINED_AT) as ScoutKind[]).filter((kind) => hut >= TRAINED_AT[kind]),
  fast: false,
  seed: 0,
  hero: null,
  champion: (n + 1) % 3 === 0 ? Math.min(4, Math.floor(n / 3)) : null,
  drop: DROP_STRONGHOLD,
  bombers: hut >= 5 ? 2 : hut >= 3 ? 1 : 0,
  ...more
});
const par = (n: number) => Math.min(5, Math.floor(n / 3) + 1);
const at = (seconds: number) => Math.round(seconds / BATTLE_TICK);
const one = (scouts: Squad["groups"][number]["scouts"], approach: number): Squad => ({ groups: [{ scouts, approach }] });
/** Steps a battle until a time, or its end. */
const until = (battle: Battle, seconds: number) => {
  while (!battle.over && battle.time < seconds) battle.step(BATTLE_TICK);
  return battle;
};
const wayOf = (battle: Battle, kind: "trail" | "ridge" | "hollow") => battle.approaches.findIndex((way) => way.kind === kind);

describe("a stronghold's approaches", () => {
  it("are two or three, the trail first, and the same every time it is looked at", () => {
    for (let n = 0; n < 18; n++) {
      const one = new Battle(planned(setupAt(n, par(n)), { groups: [] }));
      const again = new Battle(planned(setupAt(n, par(n)), { groups: [] }));
      expect(one.approaches.length, `stronghold ${n + 1}`).toBeGreaterThanOrEqual(2);
      expect(one.approaches.length).toBeLessThanOrEqual(3);
      expect(one.approaches[0].kind).toBe("trail");
      expect(one.approaches).toEqual(again.approaches);
      expect(one.zones).toEqual(again.zones);
      // Each comes in from the left edge of the field.
      for (const way of one.approaches) expect(way.path[0].x).toBeLessThanOrEqual(8);
    }
    // The King's roost: his second gate's weak one is come at round its own side.
    expect(new Battle(planned(setupAt(13, 5, { king: true, champion: 5 }), { groups: [] })).approaches.some((way) => way.hazard === "gate")).toBe(true);
  });

  it("are worked out from the camp's own number and seed, so camps differ", () => {
    const kinds = new Set(Array.from({ length: 18 }, (_, n) => new Battle(planned(setupAt(n, par(n)), { groups: [] })).approaches.map((way) => way.kind).join("+")));
    expect(kinds.size).toBeGreaterThan(1);
    expect(rollOf(4, 0, false)).toBe(rollOf(4, 0, false));
    expect(rollOf(4, 0, false)).not.toBe(rollOf(4, 7, false));
  });

  it("carry the quirk's hazards across the trail, where everybody comes", () => {
    const hedge = new Battle(planned(setupAt(9, 4), { groups: [] }));
    expect(hedge.quirk).toBe("hedge");
    expect(hedge.approaches[0]).toMatchObject({ kind: "trail", hazard: "hedge", name: "The thorn trail" });
    expect(hedge.zones).toEqual([expect.objectContaining({ kind: "thorns", on: 0 })]);
    const pits = new Battle(planned(setupAt(8, 3), { groups: [] }));
    expect(pits.zones.filter((zone) => zone.kind === "pit")).toHaveLength(2);
    expect(new Battle(planned(setupAt(0, 1), { groups: [] })).zones).toEqual([expect.objectContaining({ kind: "water", on: 0 })]);
  });

  it("are there for a friend's camp too, from its own wall and buildings, with no quirk on them", () => {
    const camp: SharedCamp = {
      levels: { burrow: 3, oak: 2, store: 3, fence: 2, tower: 3, hut: 2 },
      yard: [{ kind: "hive", level: 1 }, { kind: null, level: 0 }],
      spots: { store: [200, 70], tower: [190, 84] }
    };
    const raider = beforeChapters({ ...newBase(0, "2026-10-12"), levels: { burrow: 3, oak: 3, store: 3, fence: 2, tower: 2, hut: 3 } });
    const begun = startFriendRaid(raider, camp, { handle: "tovah", name: "Tovah" }, { minutes: 600, day: "2026-10-12", lit: false }, one({ sprout: 8 }, 1))!;
    expect(begun.raid.setup.squad).toBeDefined();
    expect(begun.raid.setup.quirk).toBeNull();
    const battle = new Battle(begun.raid.setup, begun.raid.structures);
    expect(battle.quirk).toBeNull();
    expect(battle.feat).toBe("whole");
    expect(battle.approaches.map((way) => way.kind)).toEqual(["trail", "ridge", "hollow"]);
    expect(battle.zones).toEqual([]);
    // The trail comes at their gate: the toughest piece of their wall.
    const walls = battle.structures.filter((entry) => entry.kind === "wall");
    const gate = walls.reduce((best, wall) => (wall.max > best.max ? wall : best));
    expect(battle.approaches[0].path[0].y).toBe(gate.y);
    // The same camp, the same ways in.
    expect(approachesOf(campStructures(campOfShared(camp, "2026-10-12"), false), { quirk: null, roll: -1 }).approaches.map((way) => way.path)).toEqual(battle.approaches.map((way) => way.path));
    // And the raid is fought and finished as any friend's raid is.
    const ended = playOut(begun.raid.setup, begun.raid.structures);
    const end = finishFriendRaid(begun.state, begun.raid, ended.result(), "2026-10-12").end;
    expect(end.feat).toBe("whole");
    expect(end.earned).toHaveLength(3);
  });
});

describe("a stronghold's quirk", () => {
  it("is one of six, always the same for a stronghold, and a second gate only where a camp is walled", () => {
    for (let n = 0; n < 40; n++) {
      expect(QUIRK_IDS).toContain(quirkOf(n, false));
      expect(quirkOf(n, false)).toBe(quirkOf(n, false));
    }
    expect(quirkOf(13, true)).toBe("gate");
    for (let seed = 1; seed < 60; seed++) expect(quirkOf(2, false, seed)).not.toBe("gate");
    for (const quirk of QUIRK_IDS) expect(FEATS[QUIRKS[quirk].feat]).toBeTruthy();
  });

  it("thorn hedge: slow and cuts on the trail; a mole goes under it untouched", () => {
    const battle = new Battle(planned(setupAt(9, 4), { groups: [{ scouts: { sprout: 3 }, approach: 0 }, { scouts: { mole: 2 }, approach: 0 }] }));
    until(battle, 4.5);
    const thorns = battle.zones[0] as { x0: number; x1: number };
    const sprout = battle.units.find((unit) => unit.kind === "sprout")!;
    const mole = battle.units.find((unit) => unit.kind === "mole")!;
    expect(sprout.x).toBeGreaterThan(thorns.x0);
    expect(sprout.cut).toBe(true);
    expect(sprout.hp).toBeLessThan(sprout.max);
    expect(mole.cut).toBeUndefined();
    expect(mole.hp).toBe(mole.max);
  });

  it("thorn hedge's counter: moles down the thorn trail take the feat the plain plan misses", () => {
    const setup = setupAt(9, 4);
    const naive = playOut(planned(setup, naiveSquad(setup))).result();
    expect(naive.missed).toContain("thorns");
    const moles: Squad = { groups: [{ scouts: { mole: 6, sprout: 1 }, approach: 0 }] };
    const countered = playOut(planned(setup, moles, [{ tick: at(10), kind: "rally", group: 0, target: 0 }])).result();
    expect(countered.earned).toEqual([true, true, true]);
    expect(countered.stars).toBeGreaterThan(naive.stars);
  });

  it("watch-crow: with a third of the camp down it calls, and the fallen perches are manned again", () => {
    const setup = setupAt(6, 3);
    const battle = playOut(planned(setup, naiveSquad(setup)));
    expect(battle.crow?.crow).toBe(true);
    expect(battle.crowCalledAt).not.toBeNull();
    expect(battle.events.some((event) => event.kind === "call")).toBe(true);
    expect(battle.result().missed).toContain("crowCalled");
  });

  it("watch-crow's counter: a group rallied at its perch silences it before it calls", () => {
    const setup = setupAt(6, 3);
    const look = new Battle(planned(setup, { groups: [] }));
    const crow = look.crow!.id;
    const battle = playOut(planned(setup, one({ sprout: 11 }, 0), [{ tick: 0, kind: "rally", group: 0, target: crow }, { tick: at(18), kind: "rally", group: 0, target: 0 }]));
    expect(battle.crowFellAt).not.toBeNull();
    expect(battle.crowCalledAt).toBeNull();
    expect(battle.result().missed).not.toContain("crowCalled");
  });

  it("ford: slow for all but moles, so the plain plan misses the bell, and going round makes it", () => {
    const setup = setupAt(7, 3);
    const wading = new Battle(planned(setup, { groups: [{ scouts: { sprout: 1 }, approach: 0 }] }));
    const water = wading.zones[0] as { x0: number; x1: number };
    until(wading, 2);
    while (wading.units[0].x < water.x0 + 2) wading.step(BATTLE_TICK);
    const before = wading.units[0].x;
    wading.step(BATTLE_TICK);
    // A sprout in the water, at a fifth of its pace (20 a second, by hand).
    expect((wading.units[0].x - before) / BATTLE_TICK).toBeCloseTo(20 * 0.2, 0);
    const mole = new Battle(planned(setupAt(9, 4, { quirk: "ford" }), { groups: [{ scouts: { mole: 1 }, approach: 0 }] }));
    const moleWater = mole.zones[0] as { x0: number };
    while (mole.units.length === 0 || mole.units[0].x < moleWater.x0 + 2) mole.step(BATTLE_TICK);
    const from = mole.units[0].x;
    mole.step(BATTLE_TICK);
    expect((mole.units[0].x - from) / BATTLE_TICK).toBeGreaterThan(10);
    const naive = playOut(planned(setup, naiveSquad(setup))).result();
    expect(naive.missed).toContain("bell");
    const good = playOut(planned(setup, one({ sprout: 11 }, 0), [{ tick: 0, kind: "rally", group: 0, target: 0 }]));
    expect(good.nestAt).not.toBeNull();
    expect(good.nestAt!).toBeLessThanOrEqual(BELL_SECONDS);
    expect(good.result().stars).toBe(3);
  });

  it("fog: the perches see less far and peck harder, and slingers walk right up", () => {
    const setup = setupAt(3, 2);
    const plain = layout(3, false, 0, 1).filter((entry) => entry.kind === "perch");
    const foggy = new Battle(planned(setup, { groups: [] })).structures.filter((entry) => entry.kind === "perch");
    expect(foggy[0].range).toBeLessThan(plain[0].range);
    expect(foggy[0].hit).toBeGreaterThan(plain[0].hit);
    const naive = playOut(planned(setup, naiveSquad(setup))).result();
    const slingers = playOut(planned(setup, one({ sprout: 3, slinger: 6 }, 0), [{ tick: at(10), kind: "rally", group: 0, target: 0 }])).result();
    expect(slingers.earned).toEqual([true, true, true]);
    expect(slingers.stars).toBeGreaterThan(naive.stars);
  });

  it("second gate: a wall end to end with a stout gate and a weak one; through the weak one the stout one stands", () => {
    const setup = setupAt(4, 2);
    const look = new Battle(planned(setup, { groups: [] }));
    const walls = look.structures.filter((entry) => entry.kind === "wall");
    expect(Math.min(...walls.map((wall) => wall.y - wall.r))).toBeLessThanOrEqual(14);
    expect(Math.max(...walls.map((wall) => wall.y + wall.r))).toBeGreaterThanOrEqual(116);
    const main = walls.find((wall) => wall.gate === "main")!;
    const postern = walls.find((wall) => wall.gate === "postern")!;
    expect(main.max).toBeGreaterThan(postern.max * 3);
    const weak = look.approaches.findIndex((way) => way.hazard === "gate");
    expect(weak).toBeGreaterThan(0);
    const naive = playOut(planned(setup, naiveSquad(setup))).result();
    expect(naive.missed).toContain("gate");
    const through = playOut(planned(setup, one({ sprout: 9 }, weak)));
    expect(through.structures[main.id].hp).toBeGreaterThan(0);
    expect(through.structures[postern.id].hp).toBe(0);
    expect(through.result().stars).toBe(3);
  });

  it("pitfalls: a pit gives way under whoever is on it; a sprout scrambles out, anyone else is lost", () => {
    const setup = setupAt(8, 3);
    const battle = playOut(planned(setup, { groups: [{ scouts: { slinger: 3, sprout: 2 }, approach: 0 }] }));
    const taken = battle.units.filter((unit) => unit.fell === "pit");
    expect(taken.length).toBeGreaterThan(0);
    expect(taken.every((unit) => unit.kind !== "sprout")).toBe(true);
    expect(battle.events.filter((event) => event.kind === "pit")).toHaveLength(2);
    expect(battle.result().missed).toContain("pits");
  });

  it("pitfalls' counter: sprouts first to spring them, and the rest come after with nobody lost to them", () => {
    const setup = setupAt(8, 3);
    const squad: Squad = { groups: [{ scouts: { sprout: 3 }, approach: 0 }, { scouts: { sprout: 5, slinger: 3 }, approach: 0, held: true }] };
    const battle = playOut(planned(setup, squad, [{ tick: at(6), kind: "release" }]));
    expect(battle.pits.every((state) => state === -1)).toBe(true);
    expect(battle.units.some((unit) => unit.fell === "pit")).toBe(false);
    expect(battle.result().missed).not.toContain("pits");
  });
});

describe("orders", () => {
  it("are three at the hut's first level and more at the top, and no more are taken than that", () => {
    expect(ordersAt(1)).toBe(3);
    expect(ordersAt(5)).toBeGreaterThan(3);
    const battle = new Battle(planned(setupAt(6, 1), one({ sprout: 7 }, 0)));
    battle.step(BATTLE_TICK);
    for (let index = 0; index < 3; index++) expect(battle.order({ kind: "rally", group: 0, target: 1 + index })).toBe(true);
    expect(battle.order({ kind: "rally", group: 0, target: 0 })).toBe(false);
    expect(battle.ordersLeft).toBe(0);
  });

  it("rally: the group turns from its approach to what it is sent at, and is free again once that falls", () => {
    const setup = setupAt(5, 2);
    const battle = new Battle(planned(setup, { groups: [{ scouts: { sprout: 4 }, approach: 1 }, { scouts: { sprout: 5 }, approach: 0 }] }));
    until(battle, 1);
    const hoard = battle.structures.find((entry) => entry.kind === "hoard")!;
    expect(battle.order({ kind: "rally", group: 0, target: hoard.id })).toBe(true);
    battle.step(BATTLE_TICK);
    // Each makes for it, or for a wall in the way of it.
    for (const unit of battle.units.filter((entry) => entry.band === 0)) expect(unit.target === hoard.id || battle.structures[unit.target ?? -1]?.kind === "wall").toBe(true);
    expect(battle.units.filter((entry) => entry.band === 1).every((unit) => unit.target !== hoard.id || unit.leg! > 1e8)).toBe(true);
    // Nothing to rally at: a wall, something down, a group that is not there.
    expect(battle.order({ kind: "rally", group: 0, target: battle.structures.find((entry) => entry.kind === "wall")!.id })).toBe(false);
    expect(battle.order({ kind: "rally", group: 7, target: hoard.id })).toBe(false);
  });

  it("release: the held group comes out only when it is sent, or by itself at the latest", () => {
    const setup = setupAt(5, 2);
    const squad: Squad = { groups: [{ scouts: { sprout: 4 }, approach: 0 }, { scouts: { sprout: 5 }, approach: 1, held: true }] };
    const held = until(new Battle(planned(setup, squad)), 5);
    expect(held.units.filter((unit) => unit.band === 1)).toHaveLength(0);
    expect(held.order({ kind: "release" })).toBe(true);
    held.step(BATTLE_TICK);
    expect(held.units.filter((unit) => unit.band === 1).length).toBeGreaterThan(0);
    expect(held.order({ kind: "release" })).toBe(false);
    const forgotten = until(new Battle(planned(setup, squad)), HELD_LATEST - 0.5);
    expect(forgotten.units.filter((unit) => unit.band === 1)).toHaveLength(0);
    until(forgotten, HELD_LATEST + 1);
    expect(forgotten.units.filter((unit) => unit.band === 1).length).toBeGreaterThan(0);
  });

  it("the hero's move: one for each hero, once a raid, and each does what it says", () => {
    expect(new Set(HEROES.map((hero) => hero.move)).size).toBe(HEROES.length);
    for (const hero of HEROES) expect(HERO_MOVES[hero.move].name).toBeTruthy();
    // Each hero on stronghold 12 (a keep: a champion, and a wall), sent down the trail with the scouts.
    const moved = (id: number, seconds: number, target?: number) => {
      const battle = new Battle(planned(setupAt(11, 4, { hero: heroTraits(id) }), one({ sprout: 9 }, 0)));
      until(battle, seconds);
      const before = JSON.stringify([battle.structures.map((entry) => entry.hp), battle.units.map((unit) => [unit.hp, unit.x, unit.y]), battle.foe?.hp]);
      const done = battle.order({ kind: "hero", ...(target !== undefined ? { target } : {}) });
      return { battle, done, before };
    };
    const hero = (battle: Battle) => battle.units.find((unit) => unit.kind === "hero")!;
    // Marian: every scout mends.
    {
      const { battle, done } = moved(0, 9);
      expect(done).toBe(true);
      expect(battle.order({ kind: "hero" })).toBe(false);
    }
    // Barnaby: the perches near him are hushed.
    {
      const { battle, done } = moved(1, 7);
      expect(done).toBe(true);
      expect(battle.structures.some((entry) => (entry.hushed ?? 0) > battle.time)).toBe(true);
    }
    // Piers: a wave hits what is near him.
    {
      const { battle, done, before } = moved(2, 6);
      expect(done).toBe(true);
      expect(JSON.stringify([battle.structures.map((entry) => entry.hp), battle.units.map((unit) => [unit.hp, unit.x, unit.y]), battle.foe?.hp])).not.toBe(before);
    }
    // Vess: she vaults to the nest.
    {
      const { battle, done } = moved(3, 1, 0);
      expect(done).toBe(true);
      expect(hero(battle).x).toBeCloseTo(battle.structures[0].x - battle.structures[0].r - 2);
    }
    // Kestrel: the perches in her long reach are hurt.
    {
      const { battle, done } = moved(4, 6);
      expect(done).toBe(true);
      expect(battle.structures.filter((entry) => entry.kind === "perch").some((entry) => entry.hp < entry.max)).toBe(true);
    }
    // Holm: no sentry sees anyone for a while.
    {
      const { battle, done } = moved(5, 6);
      expect(done).toBe(true);
      expect(battle.veiled).toBeGreaterThan(battle.time);
    }
    // Old Mumble: every sentry throws at him.
    {
      const { battle, done } = moved(6, 6);
      expect(done).toBe(true);
      expect(battle.stood).toBeGreaterThan(battle.time);
    }
    // Vega: the wall near her falls.
    {
      const { battle, done } = moved(7, 4.5);
      expect(done).toBe(true);
      expect(battle.structures.some((entry) => entry.kind === "wall" && entry.hp === 0)).toBe(true);
    }
    // Lady Rosalind: the scouts near her take no harm for a while.
    {
      const { battle, done } = moved(8, 5);
      expect(done).toBe(true);
      expect(battle.units.filter((unit) => (unit.shield ?? 0) > battle.time).length).toBeGreaterThan(1);
    }
    // Doctor Marrow: the champion, once he is near, is held and hurt.
    {
      const battle = new Battle(planned(setupAt(11, 4, { hero: heroTraits(9) }), one({ sprout: 9 }, 0)));
      while (!battle.over && !(battle.foe && battle.foe.hp > 0 && battle.units.some((unit) => unit.kind === "hero" && unit.hp > 0 && Math.hypot(unit.x - battle.foe!.x, unit.y - battle.foe!.y) < 30))) battle.step(BATTLE_TICK);
      const hp = battle.foe!.hp;
      expect(battle.order({ kind: "hero" })).toBe(true);
      expect(battle.foe!.hp).toBeLessThan(hp);
      expect(battle.foe!.held).toBeGreaterThan(battle.time);
    }
  });

  it("are nothing in a raid fought by hand, or with nobody to give them to", () => {
    const hand = new Battle(setupAt(3, 2));
    expect(hand.order({ kind: "release" })).toBe(false);
    const noHero = new Battle(planned(setupAt(3, 2), one({ sprout: 9 }, 0)));
    noHero.step(BATTLE_TICK);
    expect(noHero.order({ kind: "hero" })).toBe(false);
    expect(noHero.order({ kind: "release" })).toBe(false);
    expect(noHero.ordersLeft).toBe(3);
  });
});

describe("a planned raid's stars", () => {
  const tally = (more: Partial<Tally> = {}): Tally => ({
    nestDown: true,
    nestAt: 20,
    destroyed: 0.8,
    crowCalled: false,
    crowDown: true,
    crowFirst: true,
    lostToThorns: 0,
    lostToPits: 0,
    perchesStanding: 0,
    gateStanding: true,
    ...more
  });

  it("are the nest, most of it, and the feat, each for itself, and say why one was missed", () => {
    expect(starsOf("crow", tally())).toEqual({ stars: 3, earned: [true, true, true], feat: "crow", missed: [] });
    expect(starsOf("crow", tally({ destroyed: 0.4 }))).toMatchObject({ stars: 2, earned: [true, false, true], missed: ["most"] });
    expect(starsOf("crow", tally({ crowFirst: false, crowCalled: true }))).toMatchObject({ stars: 2, missed: ["crowCalled"] });
    expect(starsOf("crow", tally({ crowFirst: false, crowDown: false }))).toMatchObject({ missed: ["crowStood"] });
    expect(starsOf("thorns", tally({ lostToThorns: 3 }))).toMatchObject({ missed: ["thorns"] });
    expect(starsOf("thorns", tally({ lostToThorns: 2 })).earned[2]).toBe(true);
    expect(starsOf("bell", tally({ nestAt: BELL_SECONDS + 1 }))).toMatchObject({ missed: ["bell"] });
    expect(starsOf("perches", tally({ perchesStanding: 1 }))).toMatchObject({ missed: ["perches"] });
    expect(starsOf("gate", tally({ gateStanding: false }))).toMatchObject({ missed: ["gate"] });
    expect(starsOf("pits", tally({ lostToPits: 1 }))).toMatchObject({ missed: ["pits"] });
    expect(starsOf("whole", tally({ destroyed: 0.9 }))).toMatchObject({ missed: ["whole"] });
    for (const key of ["nest", "most", "crowCalled", "crowStood", "thorns", "bell", "perches", "gate", "pits", "whole", "featNest"] as const) expect(MISSED[key]).toBeTruthy();
  });

  it("count the feat only with the nest taken: a gate left standing by staying at home is no feat", () => {
    expect(starsOf("gate", tally({ nestDown: false, nestAt: null, destroyed: 0.6 }))).toEqual({ stars: 1, earned: [false, true, false], feat: "gate", missed: ["nest", "featNest"] });
    const nobody = playOut(planned(setupAt(4, 2), { groups: [] })).result();
    expect(nobody).toMatchObject({ stars: 0, earned: [false, false, false], feat: "gate", missed: ["nest", "most", "featNest"] });
  });

  it("come with the battle's events: each star as it is earned, and the feat's at the end", () => {
    const setup = setupAt(3, 2);
    const battle = playOut(planned(setup, one({ sprout: 3, slinger: 6 }, 0), [{ tick: at(10), kind: "rally", group: 0, target: 0 }]));
    const stars = battle.events.filter((event) => event.kind === "star");
    expect(stars.map((event) => (event as { star: number }).star).sort()).toEqual([0, 1, 2]);
    const nest = battle.events.find((event) => event.kind === "nest")!;
    expect(stars.find((event) => (event as { star: number }).star === 0)!.tick).toBe(nest.tick);
  });
});

describe("the battle's events", () => {
  it("tell of cracks, falls, a perch's magpie, a hoard's loot, the wall, the crow, a pit and an order", () => {
    const crow = playOut(planned(setupAt(6, 3), naiveSquad(setupAt(6, 3))));
    const kinds = new Set(crow.events.map((event) => event.kind));
    for (const kind of ["hurt", "down", "flee", "spill", "breach", "call", "manned", "star"] as const) expect(kinds, kind).toContain(kind);
    const spill = crow.events.find((event) => event.kind === "spill") as { loot: number };
    expect(spill.loot).toBeGreaterThan(0);
    expect(spill.loot).toBeLessThan(1);
    // Each event's tick is one the battle stepped through, in order.
    const ticks = crow.events.map((event) => event.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(crow.ticks);
    const pits = playOut(planned(setupAt(8, 3), naiveSquad(setupAt(8, 3))));
    expect(pits.events.some((event) => event.kind === "pit")).toBe(true);
    // A raid fought by hand has them too (but no stars of the new kind, and no orders).
    const hand = new Battle(setupAt(0, 1));
    for (let index = 0; index < 7; index++) hand.deploy("sprout", 20, 50 + index * 3);
    until(hand, 60);
    expect(hand.events.some((event) => event.kind === "nest")).toBe(true);
    expect(hand.events.some((event) => event.kind === "star" || event.kind === "order")).toBe(false);
  });
});

describe("a planned raid played again", () => {
  it("is the same raid, to the last event, from its plan and the orders given in it", () => {
    const setup = setupAt(11, 4, { hero: heroTraits(4) });
    const squad: Squad = { groups: [{ scouts: { sprout: 6, mole: 2 }, approach: 0, hero: true }, { scouts: { sprout: 3 }, approach: 1, held: true }] };
    const live = new Battle(planned(setup, squad));
    // Orders as a reader gives them, between steps.
    while (!live.over) {
      if (live.ticks === at(3)) live.order({ kind: "rally", group: 0, target: 0 });
      if (live.ticks === at(5)) live.order({ kind: "release" });
      if (live.ticks === at(7)) live.order({ kind: "hero" });
      live.step(BATTLE_TICK);
    }
    expect(live.given.map((order) => order.kind)).toEqual(["rally", "release", "hero"]);
    // Each order given is in the events, at its tick.
    expect(live.events.filter((event) => event.kind === "order").map((event) => event.tick)).toEqual([at(3), at(5), at(7)]);
    const replay = { ...planned(setup, squad), orders: live.given };
    const again = playOut(replay);
    expect(again.result()).toEqual(live.result());
    expect(again.events).toEqual(live.events);
    expect(again.units).toEqual(live.units);
    // And by rule, as a raid sent without anyone is played.
    expect(autoPlay(replay)).toEqual(live.result());
    expect(playOut(replay).events).toEqual(again.events);
  });

  it("is shaken a little by a jitter, and the same for the same jitter", () => {
    const setup = planned(setupAt(9, 4), naiveSquad(setupAt(9, 4)));
    expect(playOut({ ...setup, jitter: 2 }).events).toEqual(playOut({ ...setup, jitter: 2 }).events);
    expect(playOut({ ...setup, jitter: 2 }).events).not.toEqual(playOut({ ...setup, jitter: 0 }).events);
  });
});

describe("a squad", () => {
  const setup = setupAt(6, 3);

  it("takes room by kind: a sprout or a slinger one place, a mole or a Puffcap two", () => {
    expect(roomOf({ groups: [{ scouts: { sprout: 2, slinger: 1, mole: 1, bomber: 1 }, approach: 0 }] })).toBe(2 + 1 + 2 + 2);
  });

  it("is checked against the hut: its room, its kinds, its Puffcaps, the camp's approaches, one held group", () => {
    const ways = new Battle(planned(setup, { groups: [] })).approaches.length;
    expect(checkSquad(setup, naiveSquad(setup), ways)).toEqual([]);
    expect(checkSquad(setup, one({ sprout: setup.capacity + 1 }, 0), ways)).toEqual(["room"]);
    expect(checkSquad(setup, one({ mole: 1 }, 0), ways)).toEqual(["kind"]);
    expect(checkSquad(setup, one({ bomber: 2 }, 0), ways)).toEqual(["bombers"]);
    expect(checkSquad(setup, one({ sprout: 2 }, ways), ways)).toEqual(["approach"]);
    expect(checkSquad(setup, { groups: [{ scouts: { sprout: 2 }, approach: 0, held: true }, { scouts: { sprout: 2 }, approach: 0, held: true }] }, ways)).toEqual(["held"]);
    expect(checkSquad(setup, { groups: [] }, ways)).toEqual(["empty"]);
    expect(checkSquad(setup, { groups: [{ scouts: {}, approach: 0 }] }, ways)).toEqual(["empty"]);
    expect(checkSquad(setup, { groups: Array.from({ length: 5 }, () => ({ scouts: { sprout: 1 }, approach: 0 })) }, ways)).toEqual(["groups"]);
  });

  it("is held to the hut in the battle too: what does not fit stays at home", () => {
    const battle = playOut(planned(setup, one({ sprout: 30, mole: 4 }, 0)));
    expect(battle.units.filter((unit) => unit.kind === "sprout")).toHaveLength(setup.capacity);
    expect(battle.units.some((unit) => unit.kind === "mole")).toBe(false);
  });

  it("by default is the plain mix in one group down the trail, within the room", () => {
    for (let hut = 1; hut <= 5; hut++) {
      const at = setupAt(6, hut);
      const squad = naiveSquad(at);
      expect(squad.groups).toHaveLength(1);
      expect(squad.groups[0].approach).toBe(0);
      expect(checkSquad(at, squad, 2)).toEqual([]);
      expect(roomOf(squad)).toBe(at.capacity);
    }
  });
});

describe("a plan's forecast", () => {
  it("says the likely stars, with the worst and best of a few shaken runs, and costs nothing the second time", () => {
    const setup = planned(setupAt(9, 4), naiveSquad(setupAt(9, 4)));
    const forecast = forecastPlan(setup);
    expect(forecast.low).toBeLessThanOrEqual(forecast.likely);
    expect(forecast.likely).toBeLessThanOrEqual(forecast.high);
    expect(forecast.earned.every((share) => share >= 0 && share <= 1)).toBe(true);
    expect(forecastPlan(setup)).toBe(forecast);
    const good = forecastPlan(planned(setupAt(9, 4), one({ mole: 6, sprout: 1 }, 0), [{ tick: at(10), kind: "rally", group: 0, target: 0 }]));
    expect(good.likely).toBeGreaterThan(forecast.likely);
  });

  it("can be worked a run at a time, to the same figures, and keeps them with the rest", () => {
    const setup = planned(setupAt(7, 3), naiveSquad(setupAt(7, 3)));
    const step = forecastInSteps(setup);
    expect(step()).toBeNull();
    expect(step()).toBeNull();
    const said = step();
    expect(said).not.toBeNull();
    // The same as all at once, and kept: asked again, all at once or a run at a time, it is not run again.
    expect(forecastPlan(setup)).toBe(said);
    expect(forecastInSteps(setup)()).toBe(said);
  });
});

describe("the camp's rules, with a planned raid", () => {
  const DAY = "2026-10-12";
  const now = { minutes: 1000, day: DAY, lit: false };
  const ready = beforeChapters({ ...newBase(0, DAY), acorns: 100, raidFrom: 0, levels: { burrow: 3, oak: 1, store: 1, fence: 0, tower: 0, hut: 3 } } as BaseState);

  it("set out with the squad, the stronghold's quirk, and finish with which stars and why", () => {
    const squad = naiveSquad({ capacity: 11, kinds: ["sprout", "slinger", "bomber"], bombers: 1 });
    const begun = startRaid(ready, "camp", now, false, 0, squad)!;
    expect(begun.raid.setup.squad).toEqual(squad);
    expect(begun.raid.setup.quirk).toBe(quirkOf(0, false));
    const battle = playOut(begun.raid.setup);
    const ended = finishRaid(begun.state, begun.raid, battle.result(), DAY);
    expect(ended.end.stars).toBe(battle.result().stars);
    expect(ended.end.earned).toEqual(battle.result().earned);
    expect(ended.end.feat).toBe("bell");
    expect(ended.end.missed).toEqual(battle.result().missed);
    // Without a squad it is a raid fought by hand, as before.
    expect(startRaid(ready, "camp", now)!.raid.setup.squad).toBeUndefined();
  });

  it("forecast a plan coarsely, and a raid by hand as before", () => {
    const squad = naiveSquad({ capacity: 11, kinds: ["sprout", "slinger", "bomber"], bombers: 1 });
    const forecast = raidForecast(ready, nextCamp(ready), squad);
    expect(forecast.band).toBeDefined();
    expect(forecast.band!.low).toBeLessThanOrEqual(forecast.stars);
    expect(raidForecast(ready, nextCamp(ready)).band).toBeUndefined();
    expect(scoutOf(startRaid(ready, "camp", now, false, 0, squad)!.raid.setup).featWords).toBe(FEATS.bell);
  });
});
