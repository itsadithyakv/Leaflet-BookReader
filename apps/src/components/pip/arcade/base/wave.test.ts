import { describe, expect, it } from "vitest";
import { MOUTH_Y, ROLE_OF, TRAIL_Y, sectionsAt, trailOf, trailYAt, wallXAt, waveKinds } from "../../../../pip/base/front";
import { newBase } from "../../../../pip/base/rules";
import { lookOfBase, nightKinds, nightPlanOf, nightStart, walksAt, type CampLook } from "./scene";
import { GATE_THROWS, TICK, healthOf, offBy, planNight, prowlHealth, toughOf, type FrontSetup, type Ring, type Walker } from "./wave";

/** A front as a camp of the fourth chapter or so has it: the wall at 64, the trail out of a Dark Wood 14 deep. */
const front = (level: number, more: Partial<FrontSetup> = {}): FrontSetup => ({
  watch: [],
  posts: [],
  works: [],
  line: 64,
  wall: level > 0,
  all: sectionsAt(level),
  standing: sectionsAt(level),
  gate: level >= 2 ? TRAIL_Y : null,
  level,
  tough: 1,
  trail: trailOf(14, 64),
  blocks: [],
  burrow: 3,
  ...more
});
const LARDER: [number, number] = [164, 82];
const one = (kind: number, start = 0, lane = 0): Walker => ({ kind, start, site: "store", target: LARDER, lane });
const at = (setup: FrontSetup, walkers: Walker[]) => planNight(walkers, [{ at: 0, setup }], 1);
const LOOKOUT: Ring = { x: 90, y: 70, r: 42 };

describe("the trail", () => {
  it("comes out of the Dark Wood at its mouth, and runs to the wall where its gate is", () => {
    const trail = trailOf(14, 64);
    expect(trail[0][0]).toBeLessThan(0);
    expect(trail[0][1]).toBe(MOUTH_Y);
    expect(trail[trail.length - 1]).toEqual([64, TRAIL_Y]);
  });

  it("is where everyone on foot walks until the wall", () => {
    for (const kind of [0, 1, 2, 3, 5, 7]) {
      const plan = at(front(3), [one(kind)]);
      const walk = plan.walks[0];
      for (const [x, y] of walk.path) if (x > 0 && x < 64 - 6) expect(Math.abs(y - trailYAt(trailOf(14, 64), x)), `kind ${kind} at ${x}`).toBeLessThanOrEqual(3);
    }
  });
});

describe("a night's prowlers", () => {
  it("all come out of the trail's mouth, whoever they are", () => {
    const kinds = [0, 1, 2, 3, 4, 5, 6, 7];
    const plan = at(front(2), kinds.map((kind, index) => one(kind, index * 2, (index % 5) - 2)));
    for (const walk of plan.walks) {
      expect(walk.path[0][0], `${walk.role}`).toBeLessThan(0);
      expect(Math.abs(walk.path[0][1] - MOUTH_Y), `${walk.role}`).toBeLessThanOrEqual(2);
    }
  });

  it("have the health of their kind: more in a bigger camp, a brute three times a creeper's, the rest a little more", () => {
    expect(prowlHealth(5)).toBeGreaterThan(prowlHealth(2));
    for (const burrow of [1, 2, 3, 4, 5]) {
      const creeper = healthOf("creeper", burrow);
      expect(healthOf("brute", burrow)).toBeGreaterThanOrEqual(3 * creeper);
      expect(healthOf("bomber", burrow)).toBeGreaterThanOrEqual(creeper);
      expect(healthOf("runner", burrow)).toBeGreaterThan(creeper);
      expect(healthOf("flier", burrow)).toBeGreaterThan(creeper);
      expect(healthOf("digger", burrow)).toBeGreaterThanOrEqual(creeper);
    }
  });

  it("get to the larder of a camp with no wall and nothing that throws, and knock at it", () => {
    const plan = at(front(0), [one(0)]);
    expect(plan.walks[0].falls).toBeNull();
    expect(plan.walks[0].harms).not.toBeNull();
    expect(Math.hypot(plan.walks[0].path[plan.walks[0].path.length - 1][0] - LARDER[0], plan.walks[0].path[plan.walks[0].path.length - 1][1] - LARDER[1])).toBeLessThan(2);
  });

  it("are thrown at by one thrower one at a time, and no oftener than it throws", () => {
    const plan = at(front(0, { watch: [{ x: 50, y: 84, r: 60, every: 1.35 }] }), [one(0, 0, -1), one(0, 0.2, 1), one(0, 0.4, 0)]);
    const throws = plan.walks.flatMap((walk) => walk.shots.map((shot) => walk.start + shot.from)).sort((a, b) => a - b);
    expect(throws.length).toBeGreaterThan(3);
    for (let index = 1; index < throws.length; index++) expect(throws[index] - throws[index - 1]).toBeGreaterThanOrEqual(1.35 - 1e-6);
  });

  it("reach as an oval: as far across the screen as it says, and less far up and down it", () => {
    expect(offBy(30, 0)).toBe(30);
    expect(offBy(0, 18)).toBeCloseTo(30);
  });
});

describe("the wall across the trail", () => {
  it("is so many sections by the fence's level, a gate from the second, the whole approach from the fourth", () => {
    expect([1, 2, 3, 4, 5].map((level) => sectionsAt(level).length)).toEqual([3, 5, 6, 7, 7]);
    for (const level of [1, 2, 3, 4, 5]) expect(sectionsAt(level)).toContain(TRAIL_Y);
    expect(Math.min(...sectionsAt(4))).toBe(54);
    expect(Math.max(...sectionsAt(4))).toBe(114);
  });

  it("has to be broken, from its first level: the brambles hem the trail in, and nobody goes round it", () => {
    for (const level of [1, 2, 5]) {
      const walk = at(front(level), [one(1)]).walks[0];
      expect(walk.breaks.length, `level ${level}`).toBeGreaterThan(0);
      expect(walk.path.some(([x, y]) => Math.abs(x - 64) < 10 && (y < 59 || y > 109)), `level ${level}`).toBe(false);
    }
  });

  it("holds a brute up longer the better it is, and a gate longer than a section", () => {
    const held = (level: number) => at(front(level), [one(1)]).walks[0].breaks.reduce((sum, [from, to]) => sum + (to - from), 0);
    expect(held(3)).toBeGreaterThan(held(2));
    expect(held(5)).toBeGreaterThan(held(3));
    for (const level of [2, 3, 4, 5]) expect(toughOf(level, true)).toBeGreaterThan(toughOf(level, false));
    // A brute batters four a second: a level-2 gate is four and a half seconds of it.
    expect(held(2)).toBeGreaterThan(toughOf(2, true) / 4 - 0.5);
  });

  it("lets two batter a section at once, and the rest wait their turn behind them", () => {
    const two = at(front(3), [one(1, 0, -1), one(1, 0, 1)]).breaks[0]?.at ?? Infinity;
    const four = at(front(3), [one(1, 0, -1), one(1, 0, 1), one(1, 0.1, 0), one(1, 0.1, 2)]).breaks[0]?.at ?? Infinity;
    expect(two).toBeLessThan(Infinity);
    expect(four).toBeGreaterThanOrEqual(two - 0.2);
  });

  it("has a gatehouse that throws at whoever is at the wall, quicker the higher the wall, and not once the gate is down", () => {
    expect(GATE_THROWS[1]).toBe(0);
    for (let level = 3; level <= 5; level++) expect(GATE_THROWS[level]).toBeLessThan(GATE_THROWS[level - 1]);
    const brute = at(front(3), [one(1)]).walks[0];
    const fromGate = brute.shots.filter((shot) => Math.abs(shot.fx - wallXAt(64, TRAIL_Y)) < 1);
    expect(fromGate.length).toBeGreaterThan(0);
    // Every stone off it is thrown while the gate stands.
    const down = at(front(3), [one(1)]).breaks.find((entry) => entry.y === TRAIL_Y)?.at ?? Infinity;
    for (const shot of fromGate) expect(brute.start + shot.from).toBeLessThanOrEqual(down + 1e-6);
    expect(at(front(1), [one(1)]).walks[0].shots).toHaveLength(0);
  });

  it("goes down sooner under three than under one, and sooner under a brute than a creeper", () => {
    const alone = at(front(3), [one(0)]).breaks[0]?.at ?? Infinity;
    const three = at(front(3), [one(0, 0, -1), one(0, 0, 0), one(0, 0, 1)]).breaks[0]?.at ?? Infinity;
    const brute = at(front(3), [one(1)]).breaks[0]?.at ?? Infinity;
    expect(three).toBeLessThan(alone);
    expect(brute).toBeLessThan(alone);
  });

  it("is blown open beside the gate by a bomber, and those behind come through the gap", () => {
    const plan = at(front(3), [one(7), one(0, 6)]);
    const bomber = plan.walks[0];
    expect(bomber.blew === 74 || bomber.blew === 94).toBe(true);
    expect(plan.breaks.some((entry) => entry.y === bomber.blew)).toBe(true);
    // The creeper behind him goes in at the gap and not the gate.
    const creeper = plan.walks[1];
    expect(creeper.path.some(([x, y]) => Math.abs(y - bomber.blew!) <= 1 && x > wallXAt(64, bomber.blew!))).toBe(true);
    expect(creeper.harms).not.toBeNull();
  });

  it("stands when a stone thrower sets the bomber off out on the trail", () => {
    const plan = at(front(3, { watch: [{ x: 80, y: 84, r: 50, every: 2.6, hurts: 2, work: 9 }] }), [one(7)]);
    expect(plan.walks[0].blew).toBeNull();
    expect(plan.walks[0].falls).not.toBeNull();
    expect(plan.breaks).toHaveLength(0);
  });

  it("is over in a bound for a runner, and gone under by a digger, and flown over by a flier", () => {
    const runner = at(front(4), [one(5)]).walks[0];
    expect(runner.breaks).toHaveLength(1);
    expect(runner.breaks[0][1] - runner.breaks[0][0]).toBeLessThanOrEqual(0.4 + 1e-6);
    const digger = at(front(5), [one(6)]).walks[0];
    expect(digger.breaks).toHaveLength(0);
    expect(digger.harms).not.toBeNull();
    const flier = at(front(5), [one(4)]).walks[0];
    expect(flier.flies).toBe(true);
    expect(flier.harms).not.toBeNull();
  });
});

describe("what beats each kind", () => {
  it("a thorn strip cuts every walker on it, and a runner three times as often", () => {
    const strip = front(0, { works: [{ kind: 8, x: 40, y: Math.round(trailYAt(trailOf(14, 64), 40)) }] });
    const creeper = at(strip, [one(0)]).walks[0];
    const runner = at(strip, [one(5)]).walks[0];
    expect(creeper.hurts.length).toBeGreaterThanOrEqual(1);
    // A runner is three times as quick through it and cut far oftener: more cuts for less time in it.
    expect(runner.hurts.length).toBeGreaterThan(creeper.hurts.length);
  });

  it("a pitfall swallows a brute whole, two a night, and the lighter ones walk over it", () => {
    const pit = front(0, { works: [{ kind: 6, x: 40, y: Math.round(trailYAt(trailOf(14, 64), 40)) }] });
    expect(at(pit, [one(1)]).walks[0].falls).not.toBeNull();
    expect(at(pit, [one(0)]).walks[0].falls).toBeNull();
    const brutes = at(pit, [one(1, 0), one(1, 3), one(1, 6)]).walks;
    expect(brutes.filter((walk) => walk.falls !== null)).toHaveLength(2);
  });

  it("a brute is sturdy: a stone is one knock to him however hard it is thrown, and the splash does not touch him", () => {
    const brute = at(front(0, { watch: [{ x: 50, y: 84, r: 60, every: 1.35, hurts: 3, work: 9 }] }), [one(1)]).walks[0];
    const creeper = at(front(0, { watch: [{ x: 50, y: 84, r: 60, every: 1.35, hurts: 3, work: 9 }] }), [one(0)]).walks[0];
    expect(brute.shots.length).toBeGreaterThan(0);
    expect(brute.hurts.length).toBeLessThanOrEqual(brute.shots.length);
    expect(creeper.hurts.length).toBeGreaterThan(creeper.shots.length);
  });

  it("a thumper drums a digger up early, inside its ring, and he is dazed there", () => {
    const thumper = front(3, { works: [{ kind: 2, x: 52, y: 84 }], watch: [LOOKOUT] });
    const digger = at(thumper, [one(6)]).walks[0];
    const plain = at(front(3, { watch: [LOOKOUT] }), [one(6)]).walks[0];
    expect(digger.rose).not.toBeNull();
    expect(digger.rose!).toBeLessThan(plain.rose ?? Infinity);
    // Up under the lookout's eye, and held there a moment: it has him a good deal longer.
    const hits = (walk: typeof digger) => walk.shots.length;
    expect(hits(digger)).toBeGreaterThan(hits(plain));
  });

  it("an archer's nest shoots fliers before anyone else, and twice as hard", () => {
    const nest: Ring = { x: 70, y: 80, r: 40, every: 0.9, work: 10 };
    const plan = at(front(3, { watch: [nest] }), [one(0, 0), one(4, 0.5)]);
    const [creeper, flier] = plan.walks;
    const first = (walk: (typeof plan.walks)[number]) => (walk.shots[0] ? walk.start + walk.shots[0].from : Infinity);
    expect(first(flier)).toBeLessThan(first(creeper));
    // Two off his health a shot.
    const shot = flier.shots[0];
    expect(flier.hurts.filter((when) => Math.abs(when - shot.lands) < 1e-6).length).toBe(2);
  });

  it("a lookout covering the trail sees off a creeper a palisade holds, and one too far from it does not", () => {
    const near = at(front(1, { watch: [LOOKOUT] }), [one(0)]).walks[0];
    const away = at(front(1, { watch: [{ x: 200, y: 110, r: 42 }] }), [one(0)]).walks[0];
    expect(near.falls).not.toBeNull();
    expect(away.harms).not.toBeNull();
  });
});

describe("a front changed while the night is on", () => {
  it("is planned again from that moment: the same up to it, and the new front after (a trap put down works at once)", () => {
    const before = front(3, { watch: [] });
    const walkers = [one(1, 0), one(1, 4), one(1, 8)];
    const plain = planNight(walkers, [{ at: 0, setup: before }], 1);
    const pit = { kind: 6, x: 44, y: Math.round(trailYAt(trailOf(14, 64), 44)) };
    const T = 5;
    const changed = planNight(walkers, [{ at: 0, setup: before }, { at: T, setup: { ...before, works: [pit] } }], 1);
    for (let index = 0; index < walkers.length; index++) {
      const a = plain.walks[index];
      const b = changed.walks[index];
      const upTo = Math.max(0, Math.floor((T - walkers[index].start) / TICK));
      expect(b.fars.slice(0, upTo), `walker ${index}`).toEqual(a.fars.slice(0, upTo));
    }
    // Nobody fell in the plain night; in the changed one the pitfall has the two who came to it after it was put down.
    expect(plain.walks.every((walk) => walk.falls === null)).toBe(true);
    expect(changed.walks.filter((walk) => walk.falls !== null).length).toBeGreaterThanOrEqual(1);
    for (const walk of changed.walks) if (walk.falls !== null) expect(walk.start + walk.falls).toBeGreaterThanOrEqual(T);
  });

  it("sends those still on the trail to where the wall now is, when it is slid", () => {
    const here = front(3);
    const slid = { ...front(3), line: 88, trail: trailOf(14, 88) };
    const walkers = [one(0, 0), one(0, 6)];
    const plan = planNight(walkers, [{ at: 0, setup: here }, { at: 2, setup: slid }], 1);
    // The second set out after it was slid: he batters the wall where it is now.
    expect(plan.walks[1].path.some(([x]) => Math.abs(x - (88 - 5)) < 1.5)).toBe(true);
  });
});

describe("who comes on a night", () => {
  it("is the same night every time it is asked", () => {
    expect(waveKinds(8, 7, 3)).toEqual(waveKinds(8, 7, 3));
    expect(waveKinds(8, 7, 3)).not.toEqual(waveKinds(8, 7, 4));
  });

  it("is a few, more as the chapters go on, one more in winter, and never more than ten", () => {
    expect(waveKinds(2, 1, 0)).toHaveLength(0);
    expect(waveKinds(3, 1, 0)).toHaveLength(2);
    expect(waveKinds(10, 1, 0)).toHaveLength(5);
    expect(waveKinds(10, 1, 0, true)).toHaveLength(6);
    expect(waveKinds(40, 1, 0, true).length).toBeLessThanOrEqual(10);
    for (let chapter = 4; chapter <= 20; chapter++) expect(waveKinds(chapter, 1, 0).length).toBeGreaterThanOrEqual(waveKinds(chapter - 1, 1, 0).length);
  });

  it("brings each kind only from its chapter, never more than half that are not creepers, and a creeper first", () => {
    for (let chapter = 3; chapter <= 12; chapter++) {
      for (let night = 0; night < 30; night++) {
        const kinds = waveKinds(chapter, 11, night);
        const roles = kinds.map((kind) => ROLE_OF[kind]);
        expect(ROLE_OF[kinds[0]]).toBe("creeper");
        expect(roles.filter((role) => role !== "creeper").length).toBeLessThanOrEqual(Math.floor(kinds.length / 2) + 1);
        if (chapter < 8) expect(roles).not.toContain("bomber");
        if (chapter < 7) expect(roles).not.toContain("digger");
        if (chapter < 5) expect(roles).not.toContain("flier");
      }
    }
  });

  it("brings the book's kind oftener, and the Frostwights in winter", () => {
    const bombers = (favoured: number | null) => Array.from({ length: 200 }, (_, night) => waveKinds(9, 3, night, false, favoured).filter((kind) => kind === 7).length).reduce((a, b) => a + b, 0);
    expect(bombers(7)).toBeGreaterThan(bombers(null));
    expect(waveKinds(6, 3, 1, true)).toContain(3);
  });
});

describe("the camp's nights, on its own clock", () => {
  const camp = (): CampLook => {
    const base = newBase(0, "2026-10-13");
    const look = lookOfBase({ ...base, levels: { burrow: 4, oak: 3, store: 3, fence: 3, tower: 3, hut: 3 } }, 0);
    return { ...look, line: 64, prowlers: true, wave: { seed: 5, chapter: 8 } };
  };

  it("are planned once, and a front that has not changed is the same plan", () => {
    const look = camp();
    const plan = nightPlanOf(look, [LOOKOUT], 0, nightStart(0) + 3);
    expect(plan).not.toBeNull();
    expect(nightPlanOf({ ...look }, [LOOKOUT], 0, nightStart(0) + 10)).toBe(plan);
    expect(plan!.walks.map((walk) => walk.kind)).toEqual(nightKinds(look, 0));
  });

  it("have everyone, by day and by night, come out of the trail's mouth", () => {
    const look = camp();
    for (let clock = 0; clock < 1500; clock += 20) for (const walk of walksAt(look, [LOOKOUT], clock)) expect(walk.path[0][0], walk.id).toBeLessThan(0);
  });

  it("are a few by day and a band at a time by night, not a stream of them", () => {
    const look = camp();
    const ids = new Set<string>();
    for (let clock = 0; clock < 720; clock += 4) for (const walk of walksAt(look, [LOOKOUT], clock)) ids.add(walk.id);
    const day = [...ids].filter((id) => id.startsWith("d")).length;
    const night = [...ids].filter((id) => id.startsWith("n")).length;
    expect(day).toBeGreaterThanOrEqual(2);
    expect(day).toBeLessThanOrEqual(6);
    expect(night).toBe(nightKinds(look, 0).length);
  });

  it("are planned quickly enough for a phone: a night of twelve in a few milliseconds", () => {
    const setup = front(4, { watch: [LOOKOUT, { x: 80, y: 70, r: 30, every: 0.9, work: 10 }, { x: 80, y: 100, r: 44, every: 2.6, hurts: 2, work: 9 }], works: [{ kind: 8, x: 40, y: 84 }, { kind: 4, x: 30, y: 86 }] });
    const walkers = waveKinds(12, 9, 0, true).map((kind, index) => one(kind, Math.floor(index / 3) * 13 + (index % 3) * 1.8, (index % 5) - 2));
    planNight(walkers, [{ at: 0, setup }], 1);
    const from = performance.now();
    for (let run = 0; run < 5; run++) planNight(walkers, [{ at: 0, setup }], run);
    const each = (performance.now() - from) / 5;
    // Measured at about 2 to 6 ms on a desktop; the bound is loose for a slow test machine.
    expect(each).toBeLessThan(60);
  });
});
