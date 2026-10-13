import { describe, expect, it } from "vitest";
import { DEFAULT_SPOTS, PLACED, newBase } from "../../../../pip/base/rules";
import type { CampSummary } from "../../../../services/socialService";
import { DAY_SECONDS, GENRE_FOE, SQUAT, fenceLinks, parcelAtPoint, parcelSpots, prowlSpot, trophyAtPoint, duskAt, gardenAt, gardenSpot, offBy, planProwl, prowlHealth, prowlPlanOf, prowlStart, lookOfBase, lookOfSummary, pipRounds, summaryGuards, summaryLand, summaryWorks } from "./scene";

/** A friend's camp as an older app or server gives it: levels and counts, no layout. */
const PLAIN: CampSummary = {
  levels: { burrow: 3, oak: 2, store: 2, fence: 1, tower: 1, hut: 2 },
  yard: [
    { kind: "workshop", level: 1 },
    { kind: null, level: 0 }
  ],
  camps: 7,
  banners: 2,
  trophies: 14
};

const LAYOUT: Required<Pick<CampSummary, "spots" | "walls" | "decor">> = {
  spots: { burrow: [120, 90], oak: [44, 76], store: [176, 70], tower: [200, 100], hut: [64, 104], yard0: [150, 108], yard1: [96, 66] },
  walls: [
    [110, 104],
    [120, 104],
    [130, 104]
  ],
  decor: [
    { kind: 3, x: 30, y: 100 },
    { kind: 0, x: 222, y: 60 }
  ]
};

/** What a server could send that the type says it cannot. */
const odd = (layout: Record<string, unknown>) => ({ ...PLAIN, ...layout }) as unknown as CampSummary;

describe("a friend's camp, from their card", () => {
  it("is laid out as its reader has it", () => {
    const look = lookOfSummary({ ...PLAIN, ...LAYOUT }, 1);
    expect(look.spots).toEqual(LAYOUT.spots);
    expect(look.walls).toEqual(LAYOUT.walls);
    expect(look.decor).toEqual(LAYOUT.decor);
    // The rest is as it was: the levels, the yard, and nothing going on.
    expect(look.levels).toEqual(PLAIN.levels);
    expect(look.yard).toEqual(PLAIN.yard);
    expect([look.jobs, look.season, look.night, look.visitor]).toEqual([[], 1, false, false]);
  });

  it("is drawn as a camp begins when the card has no layout", () => {
    const look = lookOfSummary(PLAIN, 0);
    expect(look.spots).toEqual(DEFAULT_SPOTS);
    expect(look.walls).toEqual([]);
    expect(look.decor).toEqual([]);
    for (const none of [null, undefined]) {
      const emptied = lookOfSummary(odd({ spots: none, walls: none, decor: none }), 0);
      expect([emptied.spots, emptied.walls, emptied.decor]).toEqual([DEFAULT_SPOTS, [], []]);
    }
  });

  it("puts a building with no place on the card where it began, and keeps the others", () => {
    const look = lookOfSummary({ ...PLAIN, spots: { oak: [44, 76], yard1: [96, 66] } }, 0);
    expect(look.spots).toEqual({ ...DEFAULT_SPOTS, oak: [44, 76], yard1: [96, 66] });
    expect(Object.keys(look.spots).sort()).toEqual([...PLACED].sort());
  });

  it("takes nothing on trust that is not a place in the scene", () => {
    // A layout of the wrong type altogether.
    for (const garbage of ["a layout", 7, true, [[120, 90]], { length: 3 }]) {
      const look = lookOfSummary(odd({ spots: garbage, walls: garbage === true ? "a fence" : { 0: [110, 104] }, decor: garbage === 7 ? "a pond" : { kind: 1, x: 5, y: 5 } }), 0);
      expect([look.spots, look.walls, look.decor]).toEqual([DEFAULT_SPOTS, [], []]);
    }
    // Places that are not places: each building's loss alone, each entry dropped from its list.
    const look = lookOfSummary(
      odd({
        spots: { burrow: [120, 90], oak: "left", store: [176], tower: [200.5, 100], hut: ["64", 104], yard0: [241, 60], yard1: [96, -1], cellar: [50, 50] },
        walls: [[10, 60], "a wall", [20], [30, 60.5], null, [-1, 60], [240, 120], [0, 121], [Number.NaN, 60], [Infinity, 60], [0, 0]],
        decor: [
          { kind: 9, x: 232, y: 116, name: "Picnic blanket" },
          { kind: 18, x: 50, y: 60 },
          { kind: -1, x: 50, y: 60 },
          { kind: "pond", x: 50, y: 60 },
          { kind: 1.5, x: 50, y: 60 },
          { kind: 2, x: "50", y: 60 },
          { kind: 2, x: 50 },
          { kind: 2, x: 500, y: 60 },
          [2, 50, 60],
          null,
          { kind: 0, x: 8, y: 52 }
        ]
      }),
      0
    );
    expect(look.spots).toEqual({ ...DEFAULT_SPOTS, burrow: [120, 90] });
    expect(look.walls).toEqual([
      [10, 60],
      [240, 120],
      [0, 0]
    ]);
    expect(look.decor).toEqual([
      { kind: 9, x: 232, y: 116 },
      { kind: 0, x: 8, y: 52 }
    ]);
  });

  it("draws no more fence or decorations than a camp can hold", () => {
    const look = lookOfSummary(
      {
        ...PLAIN,
        walls: Array.from({ length: 40 }, (_, piece): [number, number] => [piece, 60]),
        decor: Array.from({ length: 60 }, (_, thing) => ({ kind: thing % 10, x: thing, y: 60 }))
      },
      0
    );
    expect(look.walls).toHaveLength(32);
    expect(look.walls[14]).toEqual([14, 60]);
    expect(look.decor).toHaveLength(24);
    expect(look.decor[23]).toEqual({ kind: 3, x: 23, y: 60 });
  });

  it("posts the guardians the card names, and none when it does not name seven ranks", () => {
    const guards = [3, 0, 2, 0, 1, 0, 0];
    expect(lookOfSummary({ ...PLAIN, guards }, 0).guards).toEqual(guards);
    expect(lookOfSummary({ ...PLAIN, ...LAYOUT, guards: [0, 0, 0, 0, 0, 0, 3] }, 0).guards).toEqual([0, 0, 0, 0, 0, 0, 3]);
    // A card from an older app or server says nothing of them.
    expect("guards" in lookOfSummary(PLAIN, 0)).toBe(false);
    // Not seven, not whole, not a rank, or not a list at all: left out, and the rest of the camp is drawn.
    for (const wrong of [null, undefined, "3020100", 7, true, {}, { length: 7 }, [], [3, 0, 2], [3, 0, 2, 0, 1, 0, 0, 0], [3, 0, 2, 0, 1, 0, 4], [3, 0, 2, 0, 1, 0, -1], [3, 0, 2.5, 0, 1, 0, 0], [3, 0, "2", 0, 1, 0, 0], [3, 0, null, 0, 1, 0, 0], [Number.NaN, 0, 0, 0, 0, 0, 0]]) {
      const look = lookOfSummary(odd({ ...LAYOUT, guards: wrong }), 0);
      expect("guards" in look, JSON.stringify(wrong)).toBe(false);
      expect(look.spots).toEqual(LAYOUT.spots);
    }
    expect(summaryGuards(guards)).toEqual({ guards });
    expect(summaryGuards("guards")).toEqual({});
  });

  it("reads the landscape and the defences a card lists, each held to its own kinds and the scene", () => {
    const land = [
      { kind: 0, x: 20, y: 64 },
      { kind: 9, x: 240, y: 120 }
    ];
    const works = [
      { kind: 2, x: 132, y: 112 },
      { kind: 0, x: 0, y: 0 },
      { kind: 3, x: 60, y: 90 }
    ];
    expect(summaryLand(land)).toEqual(land);
    expect(summaryWorks(works)).toEqual(works);
    // A card with neither, or with something that is not a list, has none.
    for (const none of [undefined, null, "a pond", 7, true, { kind: 0, x: 20, y: 64 }, { 0: { kind: 0, x: 20, y: 64 } }]) {
      expect([summaryLand(none), summaryWorks(none)]).toEqual([[], []]);
    }
    const mixed = [
      { kind: 9, x: 12, y: 70, name: "Pond" },
      { kind: 10, x: 50, y: 60 },
      { kind: -1, x: 50, y: 60 },
      { kind: "pond", x: 50, y: 60 },
      { kind: 0.5, x: 50, y: 60 },
      { kind: 1, x: 50.5, y: 60 },
      { kind: 1, x: "50", y: 60 },
      { kind: 1, y: 60 },
      { kind: 1, x: 241, y: 60 },
      { kind: 1, x: 50, y: -1 },
      [1, 50, 60],
      "a knoll",
      null,
      { kind: 2, x: 8, y: 52 }
    ];
    // Ten kinds of landscape, twelve of defence: a kind past them is dropped, never taken for another.
    expect(summaryLand(mixed)).toEqual([
      { kind: 9, x: 12, y: 70 },
      { kind: 2, x: 8, y: 52 }
    ]);
    expect(summaryWorks(mixed)).toEqual([
      { kind: 9, x: 12, y: 70 },
      { kind: 10, x: 50, y: 60 },
      { kind: 2, x: 8, y: 52 }
    ]);
    expect(summaryWorks([{ kind: 11, x: 50, y: 60 }])).toEqual([{ kind: 11, x: 50, y: 60 }]);
    expect(summaryWorks([{ kind: 12, x: 50, y: 60 }])).toEqual([]);
    // No more than a camp can hold: the first thirty pieces, the first twelve defences.
    const many = Array.from({ length: 50 }, (_, piece) => ({ kind: piece % 4, x: piece, y: 60 }));
    expect(summaryLand(many)).toEqual(many.slice(0, 30));
    expect(summaryWorks(many)).toEqual(many.slice(0, 12));
  });

  it("is still drawn when the card carries landscape and defences", () => {
    const look = lookOfSummary({ ...PLAIN, ...LAYOUT, land: [{ kind: 0, x: 20, y: 64 }], works: [{ kind: 2, x: 132, y: 112 }], guards: [1, 0, 0, 0, 0, 0, 0] }, 2);
    expect([look.spots, look.walls, look.decor]).toEqual([LAYOUT.spots, LAYOUT.walls, LAYOUT.decor]);
    expect(look.guards).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect([look.land, look.works]).toEqual([[{ kind: 0, x: 20, y: 64 }], [{ kind: 2, x: 132, y: 112 }]]);
    const garbled = lookOfSummary(odd({ land: "a pond", works: 7, guards: "none" }), 2);
    expect([garbled.spots, garbled.walls, garbled.decor]).toEqual([DEFAULT_SPOTS, [], []]);
    expect([garbled.land, garbled.works]).toEqual([[], []]);
    // A card from an older app or server lists neither: none of either is drawn.
    const plain = lookOfSummary(PLAIN, 2);
    expect([plain.land, plain.works]).toEqual([[], []]);
  });
});

describe("Pip on her rounds", () => {
  const stops: Array<[number, number]> = [
    [100, 90],
    [40, 90],
    [100, 110]
  ];

  it("is where the clock says: walking from stop to stop, and idling at each", () => {
    const setting = pipRounds(0, stops);
    expect(setting).toMatchObject({ x: 100, y: 90, move: "walk", faceLeft: true });
    // Sixty art pixels at thirteen a second: under way at two seconds, there by five.
    const under = pipRounds(2, stops);
    expect(under.move).toBe("walk");
    expect(under.x).toBeCloseTo(100 - 26);
    const there = pipRounds(5, stops);
    expect(there).toMatchObject({ x: 40, y: 90, faceLeft: false });
    expect(there.move).not.toBe("walk");
  });

  it("moves without a jump from one moment to the next, all the way round", () => {
    let last = pipRounds(0, stops);
    for (let time = 0.05; time < 80; time += 0.05) {
      const now = pipRounds(time, stops);
      expect(Math.hypot(now.x - last.x, now.y - last.y), `at ${time.toFixed(2)}s`).toBeLessThan(1);
      last = now;
    }
  });

  it("is the same round again when it is done, and stands still with nowhere to go", () => {
    expect(pipRounds(3, stops)).toEqual(pipRounds(3, stops));
    expect(pipRounds(12, [[50, 60]])).toMatchObject({ x: 50, y: 60 });
  });
});

describe("the reader's own camp, pictured elsewhere", () => {
  it("is shown by day, as it is laid out, with what is going up", () => {
    const base = { ...newBase(0, "2026-10-12"), banners: ["2026-07", "2026-10"], walls: [[120, 94]] as Array<[number, number]> };
    const look = lookOfBase(base, 1);
    expect(look).toMatchObject({ night: false, lit: false, visitor: false, oakReady: false, season: 1 });
    expect(look.spots).toBe(base.spots);
    expect(look.walls).toBe(base.walls);
    // July's banner and October's: summer and autumn.
    expect(look.banners).toEqual([0, 1]);
  });
});

describe("the clearing's own hours", () => {
  it("begin in daylight, turn to night and back, and come round again in four minutes", () => {
    expect(DAY_SECONDS).toBe(240);
    expect(duskAt(0)).toBe(0);
    expect(duskAt(100)).toBe(0);
    expect(duskAt(180)).toBe(1);
    expect(duskAt(DAY_SECONDS)).toBe(0);
    expect(duskAt(DAY_SECONDS + 180)).toBe(1);
    // More of the day is light than dark.
    let dark = 0;
    for (let second = 0; second < DAY_SECONDS; second++) if (duskAt(second) >= 0.5) dark += 1;
    expect(dark).toBeGreaterThan(60);
    expect(dark).toBeLessThan(DAY_SECONDS / 2);
  });

  it("never jump: dusk and dawn are eased, a little at a time", () => {
    for (let tenth = 0; tenth < DAY_SECONDS * 10; tenth++) {
      const step = Math.abs(duskAt((tenth + 1) / 10) - duskAt(tenth / 10));
      expect(step).toBeLessThan(0.02);
    }
  });
});

describe("the garden's bed", () => {
  it("lies by the burrow, on the grass, and goes where the burrow goes", () => {
    const [x, y] = gardenSpot(DEFAULT_SPOTS);
    expect(x).toBeLessThan(DEFAULT_SPOTS.burrow[0]);
    expect(y).toBeGreaterThan(DEFAULT_SPOTS.burrow[1]);
    expect(gardenAt(DEFAULT_SPOTS, x, y - 4)).toBe(true);
    expect(gardenAt(DEFAULT_SPOTS, x + 40, y - 4)).toBe(false);
    const moved = { ...DEFAULT_SPOTS, burrow: [30, 100] as [number, number] };
    const [mx, my] = gardenSpot(moved);
    // At the edge of the clearing it stays on it.
    expect(mx).toBeGreaterThanOrEqual(16);
    expect(my).toBeLessThanOrEqual(116);
  });
});

describe("the prowlers between raids", () => {
  const STORE: [number, number] = [180, 82];
  const far = (plan: { from: [number, number] }) => Math.hypot(STORE[0] - plan.from[0], STORE[1] - plan.from[1]);

  it("have more health in a bigger camp, and get to the larder of a camp that throws nothing", () => {
    expect(prowlHealth(5)).toBeGreaterThan(prowlHealth(2));
    for (let slot = 0; slot < 40; slot++) {
      const plan = planProwl(STORE, 3, [], slot);
      expect(plan.shots).toHaveLength(0);
      expect(plan.falls).toBeNull();
      expect(plan.there).toBeGreaterThan(0);
    }
  });

  it("are hit no oftener than a thrower can throw, each stone taking a moment to land", () => {
    const tower = { x: 170, y: 90, r: 36 };
    for (let slot = 0; slot < 40; slot++) {
      const plan = planProwl(STORE, 3, [tower], slot);
      plan.shots.forEach((shot, index) => {
        expect(shot.lands - shot.from).toBeCloseTo(0.5, 6);
        if (index > 0) expect(shot.from - plan.shots[index - 1].from).toBeGreaterThanOrEqual(1.3);
      });
      expect(plan.shots.length).toBeLessThanOrEqual(plan.health);
    }
  });

  it("are not all stopped by one lookout, and are by a camp that covers the way in from every side", () => {
    // One lookout, off to one side of the larder: it reaches some of the ways in and not others.
    const one = [{ x: 130, y: 96, r: 30 }];
    // The same camp with the burrow, the hut and a guardian throwing as well, about the larder.
    const many = [...one, { x: 180, y: 86, r: 38 }, { x: 205, y: 100, r: 34 }, { x: 160, y: 66, r: 34 }];
    // And with two guardians posted by the larder, who come out and fight.
    const posts = [
      { who: 0, x: 196, y: 84, r: 20, blows: 3 },
      { who: 1, x: 160, y: 96, r: 20, blows: 2 }
    ];
    let lone = 0;
    let thrown = 0;
    let kept = 0;
    const slots = 200;
    for (let slot = 0; slot < slots; slot++) {
      if (planProwl(STORE, 3, one, slot).falls !== null) lone += 1;
      if (planProwl(STORE, 3, many, slot).falls !== null) thrown += 1;
      const guarded = planProwl(STORE, 3, many, slot, posts);
      if (guarded.falls !== null) kept += 1;
      // He is never hurt more than he has health for, and falls when the last of it goes.
      expect(guarded.hurts.length).toBeLessThanOrEqual(guarded.health);
      if (guarded.falls !== null) expect(guarded.hurts[guarded.health - 1]).toBeCloseTo(guarded.falls, 6);
      expect(far(planProwl(STORE, 3, one, slot))).toBeGreaterThan(20);
    }
    expect(lone).toBeLessThan(slots * 0.4);
    expect(thrown).toBeGreaterThan(lone);
    expect(kept).toBeGreaterThanOrEqual(thrown);
    expect(kept).toBeGreaterThan(slots * 0.85);
  });
});

describe("a prowler at a building", () => {
  const STORE: [number, number] = [180, 82];

  it("is at it a while before it is the worse for it, and is not if he is felled first", () => {
    for (let slot = 0; slot < 60; slot++) {
      const free = planProwl(STORE, 3, [], slot);
      expect(free.harms).not.toBeNull();
      expect(free.harms! - free.there).toBeCloseTo(4.4, 1);
      // One of the camp's people hears him at it and comes: with blows enough, he is felled and nothing is harmed.
      const met = planProwl(STORE, 3, [], slot, [{ who: 103, x: 170, y: 90, r: 20, blows: 4, roams: true }]);
      expect(met.duel?.who).toBe(103);
      expect(met.falls).not.toBeNull();
      expect(met.harms).toBeNull();
    }
  });

  it("is not come to from further off than he can be heard", () => {
    for (let slot = 0; slot < 40; slot++) {
      const plan = planProwl(STORE, 3, [], slot, [{ who: 101, x: 40, y: 112, r: 4, blows: 2, roams: true }]);
      // Somebody a long way off, whom he does not pass: nobody comes, and the building is the worse for it.
      if (plan.duel === null) expect(plan.harms).not.toBeNull();
      else {
        // Whoever came, saw him from no further off than that: where he was when they set out.
        const [x, y] = prowlSpot(plan, plan.fars[Math.min(plan.fars.length - 1, Math.round(plan.duel.from / 0.1))]);
        expect(Math.hypot(x - 40, y - 112)).toBeLessThanOrEqual(95.5);
      }
    }
  });

  it("comes out of the wood out of sight, whichever side it is", () => {
    for (let slot = 0; slot < 80; slot++) {
      const [x, y] = prowlStart(slot).from;
      expect(x < -8 || x > 248 || y < 50 || y > 160, `slot ${slot} starts at ${x},${y}`).toBe(true);
    }
  });

  it("has a mind of its own about what to make for, and a poorly watched building is found", () => {
    const base = newBase(0, "2026-10-13");
    // The oak off by itself at the far end, where nothing reaches.
    const look = lookOfBase({ ...base, levels: { burrow: 3, oak: 3, store: 3, fence: 1, tower: 3, hut: 2 }, spots: { ...base.spots, oak: [40, 70] } }, 1);
    // Everything but the oak is watched.
    const watch = [
      { x: look.spots.store[0], y: look.spots.store[1], r: 30 },
      { x: look.spots.tower[0], y: look.spots.tower[1], r: 30 },
      { x: look.spots.burrow[0], y: look.spots.burrow[1], r: 30 },
      { x: look.spots.hut[0], y: look.spots.hut[1], r: 30 }
    ];
    const made: Record<string, number> = {};
    let walks = 0;
    for (let slot = 0; slot < 4000 && walks < 300; slot++) {
      const plan = prowlPlanOf(look, watch, slot);
      if (!plan) continue;
      walks += 1;
      made[plan.site] = (made[plan.site] ?? 0) + 1;
    }
    // More than one thing is made for, the larder among them, and the oak a good deal: it is what nobody watches.
    expect(Object.keys(made).length).toBeGreaterThanOrEqual(3);
    expect(made.store ?? 0).toBeGreaterThan(20);
    expect(made.oak ?? 0).toBeGreaterThan(walks * 0.3);
  });
});

describe("a prowler and the constructs", () => {
  const STORE: [number, number] = [180, 82];
  /** A point so far along the way the prowler of a slot takes to the larder. */
  const onWay = (slot: number, share: number) => {
    const [x, y] = prowlStart(slot).from;
    return { x: x + (STORE[0] - x) * share, y: y + (STORE[1] - y) * share };
  };
  /** The first so many slots whose prowler is of a sort: the plain ones who walk and carry a club, the ones on the wing, and the three who have a way of their own. */
  const pick = (count: number, sort: (kind: number) => boolean) => {
    const found: number[] = [];
    for (let slot = 0; found.length < count; slot++) if (sort(prowlStart(slot).kind)) found.push(slot);
    return found;
  };
  const walkers = (count: number) => pick(count, (kind) => kind <= 3);
  const fliers = (count: number) => pick(count, (kind) => kind === 4);
  const squirrels = (count: number) => pick(count, (kind) => kind === 5);
  const moles = (count: number) => pick(count, (kind) => kind === 6);
  const fizzers = (count: number) => pick(count, (kind) => kind === 7);

  it("is slowed by a patch of tanglefoot in his way, and so is longer getting there", () => {
    for (const slot of walkers(30)) {
      const free = planProwl(STORE, 3, [], slot);
      const held = planProwl(STORE, 3, [], slot, [], [{ kind: 4, ...onWay(slot, 0.6) }]);
      expect(held.there, `slot ${slot}`).toBeGreaterThan(free.there + 1);
    }
  });

  it("is cut by a hedge he walks through, again and again while he is in it", () => {
    for (const slot of walkers(30)) {
      const plan = planProwl(STORE, 3, [], slot, [], [{ kind: 1, ...onWay(slot, 0.6) }]);
      expect(plan.hurts.length, `slot ${slot}`).toBeGreaterThanOrEqual(1);
      expect(plan.hurts.length).toBeLessThanOrEqual(plan.health);
    }
  });

  it("is had by a pitfall about one time in two, and that is the end of him there", () => {
    let fell = 0;
    const slots = 200;
    for (const slot of walkers(slots)) {
      const plan = planProwl(STORE, 3, [], slot, [], [{ kind: 6, ...onWay(slot, 0.6) }]);
      if (plan.falls !== null) {
        fell += 1;
        expect(plan.harms).toBeNull();
        expect(plan.falls).toBeLessThan(plan.there);
      }
    }
    expect(fell).toBeGreaterThan(slots * 0.35);
    expect(fell).toBeLessThan(slots * 0.65);
  });

  it("is thrown at oftener with the watch bell ringing for him", () => {
    const tower = { x: STORE[0] - 10, y: STORE[1] + 6, r: 34 };
    let more = 0;
    for (let slot = 0; slot < 60; slot++) {
      // A good deal of health, so that it is the throwing that is counted and not how soon he fell.
      const quiet = planProwl(STORE, 40, [tower], slot);
      const rung = planProwl(STORE, 40, [tower], slot, [], [{ kind: 7, x: STORE[0], y: STORE[1] + 4 }]);
      expect(rung.shots.length).toBeGreaterThanOrEqual(quiet.shots.length);
      if (rung.shots.length > quiet.shots.length) more += 1;
    }
    expect(more).toBeGreaterThan(40);
  });

  /** A fence all the way round the larder, on the grid a fence is laid on: there is no way to it but over. */
  const RING: Array<[number, number]> = [
    ...[160, 170, 180, 190, 200].flatMap((x): Array<[number, number]> => [
      [x, 64],
      [x, 104]
    ]),
    ...[74, 84, 94].flatMap((y): Array<[number, number]> => [
      [160, y],
      [200, y]
    ])
  ];

  it("has to get over a fence that is in his way all round, and is longer about it the better the fence", () => {
    for (const slot of walkers(30)) {
      const free = planProwl(STORE, 3, [], slot);
      const low = planProwl(STORE, 3, [], slot, [], [], { pieces: RING, level: 1 });
      const high = planProwl(STORE, 3, [], slot, [], [], { pieces: RING, level: 5 });
      expect(free.breaks).toEqual([]);
      // Over it where he meets it: one piece, or two where he comes between a pair of them.
      expect(low.breaks.length, `slot ${slot}`).toBeGreaterThanOrEqual(1);
      expect(low.breaks.length).toBeLessThanOrEqual(2);
      expect(low.there).toBeGreaterThan(free.there + 1.8);
      expect(high.there).toBeGreaterThan(low.there + 2);
    }
  });

  it("walks round a piece of fence that is not a wall", () => {
    for (const slot of walkers(30)) {
      const at = onWay(slot, 0.6);
      const lone = planProwl(STORE, 3, [], slot, [], [], { pieces: [[at.x, at.y - 2]], level: 5 });
      expect(lone.breaks, `slot ${slot}`).toEqual([]);
      // And is hardly longer about it.
      expect(lone.there - planProwl(STORE, 3, [], slot).there).toBeLessThan(1.5);
    }
  });

  it("goes round to the gate when it is not far, and is twice as long getting through it", () => {
    let through = 0;
    for (const slot of walkers(60)) {
      // The gate on whichever side he comes from, so that it is never far round.
      const [fx, fy] = prowlStart(slot).from;
      const gate: [number, number] = Math.abs(fx - STORE[0]) > Math.abs(fy - STORE[1]) * 2 ? [fx < STORE[0] ? 160 : 200, 84] : [180, fy < STORE[1] ? 64 : 104];
      const climbed = planProwl(STORE, 3, [], slot, [], [], { pieces: RING, level: 2 });
      const gated = planProwl(STORE, 3, [], slot, [], [], { pieces: RING, level: 2, gate });
      if (gated.breaks.length !== 1) continue;
      const held = gated.breaks[0][1] - gated.breaks[0][0];
      // Twice what a piece of a fence of that level holds him.
      if (Math.abs(held - 2 * (1.4 + 2 * 0.6)) < 1e-6) {
        through += 1;
        // He was at the gate when he was held, not at some other piece.
        const far = gated.fars[Math.round(gated.breaks[0][0] / 0.1)];
        const [x, y] = prowlSpot(gated, far);
        expect(Math.hypot(x - gate[0], y - (gate[1] + 2)), `slot ${slot}`).toBeLessThanOrEqual(5.6);
        expect(gated.there).toBeGreaterThan(climbed.there);
      }
    }
    expect(through).toBeGreaterThan(40);
  });

  it("is given longer under what throws by a fence, which is what a fence is for", () => {
    let more = 0;
    for (const slot of walkers(40)) {
      const tower = { x: STORE[0], y: STORE[1], r: 40 };
      const bare = planProwl(STORE, 40, [tower], slot);
      const walled = planProwl(STORE, 40, [tower], slot, [], [], { pieces: RING, level: 3 });
      expect(walled.shots.length).toBeGreaterThanOrEqual(bare.shots.length);
      if (walled.shots.length > bare.shots.length) more += 1;
    }
    expect(more).toBeGreaterThan(30);
  });

  it("goes round water and a knoll, and never through them", () => {
    let turned = 0;
    let tried = 0;
    for (const slot of walkers(80)) {
      const at = onWay(slot, 0.5);
      // A lake across his way, where a lake can be: on the grass, not off the edge of the picture.
      if (at.x < 26 || at.x > 214 || at.y < 64 || at.y > 104) continue;
      tried += 1;
      const lake = { x: at.x, y: at.y, rx: 16, ry: 8 };
      const plan = planProwl(STORE, 3, [], slot, [], [], null, { blocks: [lake] });
      const straight = planProwl(STORE, 3, [], slot);
      if (plan.path.length > 2) turned += 1;
      expect(plan.long).toBeGreaterThanOrEqual(straight.long - 1e-6);
      // Nowhere on his way is he in it.
      for (let far = 0; far <= plan.long; far += 2) {
        const [x, y] = prowlSpot(plan, far);
        expect(((x - lake.x) / lake.rx) ** 2 + ((y - lake.y) / lake.ry) ** 2, `slot ${slot} at ${far}`).toBeGreaterThanOrEqual(0.97);
      }
      // One on the wing goes straight over it.
      expect(planProwl(STORE, 3, [], fliers(1)[0], [], [], null, { blocks: [lake] }).path).toHaveLength(2);
    }
    expect(tried).toBeGreaterThan(20);
    expect(turned).toBeGreaterThan(tried * 0.9);
  });

  it("is of the kind the book being read brings, three times in ten", () => {
    let fizz = 0;
    let plain = 0;
    const slots = 1000;
    for (let slot = 0; slot < slots; slot++) {
      if (prowlStart(slot, 9, 7).kind === 7) fizz += 1;
      if (prowlStart(slot, 9).kind === 7) plain += 1;
    }
    // One in eight of them anyway; with a book that brings him, three in ten more of the rest.
    expect(plain).toBeGreaterThan(slots * 0.08);
    expect(plain).toBeLessThan(slots * 0.17);
    expect(fizz).toBeGreaterThan(slots * 0.33);
    expect(fizz).toBeLessThan(slots * 0.46);
    // Not to a camp too small for him, whatever is being read.
    for (let slot = 0; slot < 200; slot++) expect(prowlStart(slot, 3, 7).kind).not.toBe(7);
    expect(GENRE_FOE).toHaveLength(11);
    expect(GENRE_FOE[0]).toBeNull();
  });

  it("goes over all of it on the wing: fence, hedge, tanglefoot, pitfall and caltrops", () => {
    for (const slot of fliers(20)) {
      const at = onWay(slot, 0.6);
      const free = planProwl(STORE, 3, [], slot);
      expect(free.flies).toBe(true);
      const over = planProwl(STORE, 3, [], slot, [], [1, 4, 6, 8].map((kind) => ({ kind, ...at })), { pieces: [[at.x, at.y - 2]], level: 5 });
      expect([over.hurts, over.breaks, over.there]).toEqual([[], [], free.there]);
      // And is quicker about getting there than one on foot from the same place would be.
      expect(free.there).toBeLessThan(free.long / 13 - 0.5);
    }
  });

  it("is brought down by a ward stone, and then the hedge has him like anybody", () => {
    for (const slot of fliers(20)) {
      const at = onWay(slot, 0.6);
      const down = planProwl(STORE, 3, [], slot, [], [
        { kind: 0, ...at },
        { kind: 1, ...at }
      ]);
      expect(down.hurts.length, `slot ${slot}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("is stung by hornets on the wing, and not on foot", () => {
    for (const slot of fliers(20)) expect(planProwl(STORE, 3, [], slot, [], [{ kind: 5, ...onWay(slot, 0.6) }]).hurts.length, `slot ${slot}`).toBeGreaterThanOrEqual(1);
    for (const slot of walkers(20)) expect(planProwl(STORE, 3, [], slot, [], [{ kind: 5, ...onWay(slot, 0.6) }]).hurts).toEqual([]);
  });

  it("is not met with a blade while he is in the air, and is with a bow", () => {
    for (const slot of fliers(20)) {
      const at = onWay(slot, 0.5);
      const blade = planProwl(STORE, 3, [], slot, [{ who: 1, x: at.x, y: at.y, r: 14, blows: 4 }]);
      // He went over the head of the one with a blade: if they fight him at all, it is once he has landed.
      if (blade.duel) expect(blade.duel.from).toBeGreaterThanOrEqual(blade.there - 0.11);
      const bow = planProwl(STORE, 3, [], slot, [{ who: 0, x: at.x, y: at.y, r: 14, blows: 4, ranged: true }]);
      expect(bow.duel?.ranged).toBe(true);
      expect(bow.duel!.from).toBeLessThan(bow.there);
    }
  });

  it("is hurt the once by caltrops, and is turned by a dread totem about one time in three", () => {
    for (const slot of walkers(30)) expect(planProwl(STORE, 9, [], slot, [], [{ kind: 8, ...onWay(slot, 0.6) }]).hurts).toHaveLength(1);
    let turned = 0;
    const slots = 300;
    for (let slot = 0; slot < slots; slot++) {
      const plan = planProwl(STORE, 3, [], slot, [], [{ kind: 11, ...onWay(slot, 0.6) }]);
      if (plan.falls !== null) {
        turned += 1;
        expect(plan.harms).toBeNull();
      }
    }
    expect(turned).toBeGreaterThan(slots * 0.22);
    expect(turned).toBeLessThan(slots * 0.46);
  });

  it("is thrown at by the constructs that throw, each in its own time and as hard as it throws", () => {
    for (const slot of walkers(20)) {
      const at = onWay(slot, 0.7);
      const stone = planProwl(STORE, 40, [{ x: at.x, y: at.y, r: 44, every: 2.6, hurts: 2 }], slot);
      const nest = planProwl(STORE, 40, [{ x: at.x, y: at.y, r: 30, every: 1, hurts: 1 }], slot);
      expect(stone.shots.length).toBeGreaterThan(0);
      expect(stone.hurts).toHaveLength(stone.shots.length * 2);
      expect(nest.hurts).toHaveLength(nest.shots.length);
      stone.shots.forEach((shot, index) => index > 0 && expect(shot.from - stone.shots[index - 1].from).toBeGreaterThanOrEqual(2.55));
      nest.shots.forEach((shot, index) => index > 0 && expect(shot.from - nest.shots[index - 1].from).toBeGreaterThanOrEqual(0.95));
    }
  });

  it("is run out to at a pace, and never met in less time than the ground between takes", () => {
    for (let slot = 0; slot < 60; slot++) {
      const plan = planProwl(STORE, 3, [], slot, [{ who: 3, x: 150, y: 100, r: 20, blows: 4 }]);
      if (!plan.duel || plan.duel.ranged) continue;
      const off = Math.hypot(plan.duel.x - plan.duel.px, plan.duel.y - plan.duel.py);
      expect(plan.duel.run, `slot ${slot}`).toBeGreaterThanOrEqual(off / 38 - 1e-6);
      expect(plan.duel.blows[0]).toBeGreaterThan(plan.duel.from + plan.duel.run);
    }
  });

  it("reaches as an oval: as far across the screen as it says, and less far up and down it", () => {
    expect(offBy(30, 0)).toBe(30);
    expect(offBy(0, 30 * SQUAT)).toBeCloseTo(30, 6);
    expect(SQUAT).toBeLessThan(1);
    // A thrower beside his way has him; the same thrower as far above his way does not.
    let beside = 0;
    let above = 0;
    for (const slot of walkers(40)) {
      const at = onWay(slot, 0.5);
      const start = prowlStart(slot).from;
      // Only the ones coming in from the side: their way is across the screen, and "above" is off it.
      if (Math.abs(start[1] - STORE[1]) > 25) continue;
      if (planProwl(STORE, 40, [{ x: at.x + 22, y: at.y, r: 24 }], slot).shots.length > 0) beside += 1;
      if (planProwl(STORE, 40, [{ x: at.x, y: at.y - 22, r: 24 }], slot).shots.length > 0) above += 1;
    }
    expect(beside).toBeGreaterThan(0);
    expect(above).toBeLessThan(beside);
  });

  it("has a squirrel who is quick, half as sturdy, and over a fence in a bound", () => {
    for (const slot of squirrels(12)) {
      const plan = planProwl(STORE, 5, [], slot);
      expect(plan.kind).toBe(5);
      expect(plan.health).toBe(Math.ceil(prowlHealth(5) / 2));
      // Quicker than anyone on foot could be over the same ground.
      expect(plan.there).toBeLessThan(plan.long / 13 - 1);
      const at = onWay(slot, 0.6);
      const fenced = planProwl(STORE, 5, [], slot, [], [], { pieces: [[at.x, at.y - 2]], level: 5 });
      expect(fenced.there - plan.there).toBeLessThan(0.5);
    }
  });

  it("has a mole who comes under the fence and under what throws, and up only near what he came for", () => {
    for (const slot of moles(20)) {
      const at = onWay(slot, 0.3);
      const plan = planProwl(STORE, 5, [{ x: at.x, y: at.y, r: 16 }], slot, [], [{ kind: 1, ...at }], { pieces: [[at.x, at.y - 2]], level: 5 });
      expect(plan.kind).toBe(6);
      // One who comes out of the wood right beside the larder is up at once: there is no way to be under.
      if (plan.long < 80) continue;
      // Nothing on the way had him: not the fence, the hedge or the thrower.
      expect([plan.breaks, plan.hurts, plan.shots]).toEqual([[], [], []]);
      expect(plan.rose).not.toBeNull();
      expect(plan.rose!).toBeGreaterThan(plan.there - 3);
      // A thumper on his way has him up where it is, and then the thrower beside it has him.
      const drummed = planProwl(STORE, 5, [{ x: at.x, y: at.y, r: 30 }], slot, [], [{ kind: 2, ...at }]);
      expect(drummed.rose!).toBeLessThan(plan.rose!);
      expect(drummed.shots.length).toBeGreaterThan(0);
    }
  });

  it("has Fizzwick, who is not long about it, goes off, and is no trouble if he is stopped first", () => {
    for (const slot of fizzers(12)) {
      const free = planProwl(STORE, 5, [], slot);
      expect([free.kind, free.pops]).toEqual([7, true]);
      expect(free.harms! - free.there).toBeCloseTo(1.8, 1);
      // Slower than the rest on his way there.
      expect(free.there).toBeGreaterThan(free.long / 13);
      const stopped = planProwl(STORE, 5, [{ x: STORE[0], y: STORE[1], r: 60 }, { x: STORE[0] - 20, y: STORE[1], r: 60 }, { x: STORE[0] + 20, y: STORE[1], r: 60 }], slot);
      expect(stopped.falls).not.toBeNull();
      expect(stopped.harms).toBeNull();
    }
    // Neither he nor the mole comes to a small camp.
    for (let slot = 0; slot < 200; slot++) {
      expect(prowlStart(slot, 2).kind).not.toBe(6);
      expect(prowlStart(slot, 3).kind).not.toBe(7);
    }
  });

  it("comes oftener in winter, by day and by night", () => {
    const base = newBase(0, "2026-10-13");
    const camp = { ...base, levels: { burrow: 3, oak: 3, store: 3, fence: 1, tower: 3, hut: 2 } };
    const count = (season: number) => {
      const look = lookOfBase(camp, season);
      let walks = 0;
      for (let slot = 0; slot < 300; slot++) if (prowlPlanOf(look, [], slot)) walks += 1;
      return walks;
    };
    expect(count(2)).toBeGreaterThan(count(0) * 1.2);
    expect(count(1)).toBe(count(0));
  });

  it("is after what the camp lives on: the squirrel the oak, the mole the larder", () => {
    const base = newBase(0, "2026-10-13");
    const look = lookOfBase({ ...base, levels: { burrow: 5, oak: 3, store: 3, fence: 1, tower: 3, hut: 2 } }, 0);
    // Watched alike everywhere, so that nobody is drawn by an unwatched building.
    const watch = PLACED.map((site) => ({ x: look.spots[site][0], y: look.spots[site][1], r: 20 }));
    const made: Record<number, Record<string, number>> = {};
    for (let slot = 0; slot < 3000; slot++) {
      const plan = prowlPlanOf(look, watch, slot);
      if (!plan) continue;
      made[plan.kind] ??= {};
      made[plan.kind][plan.site] = (made[plan.kind][plan.site] ?? 0) + 1;
    }
    const most = (kind: number) => Object.entries(made[kind] ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
    expect([most(5), most(6), most(4), most(3)]).toEqual(["oak", "store", "store", "oak"]);
  });
});

describe("who answers a prowler", () => {
  const STORE: [number, number] = [180, 82];

  it("is a guardian only on the ground about their post: they do not leave it for a building across the camp", () => {
    let fought = 0;
    for (let slot = 0; slot < 80; slot++) {
      // A guardian a long way from the larder, and from every way in to it.
      const far = planProwl(STORE, 3, [], slot, [{ who: 3, x: 60, y: 112, r: 20, blows: 4 }]);
      if (far.duel) {
        fought += 1;
        // If they fought him at all, it was because he walked through their ground on his way.
        expect(far.duel.from).toBeLessThan(far.there);
      } else expect(far.harms).not.toBeNull();
      // The same one posted by the larder has whoever comes to it, whichever side of it he comes to.
      const by = planProwl(STORE, 3, [], slot, [{ who: 3, x: 178, y: 86, r: 20, blows: 4 }]);
      expect(by.duel?.who, `slot ${slot}`).toBe(3);
    }
    expect(fought).toBeLessThan(30);
  });

  it("is one of the camp's people wherever he gets to, turn and turn about", () => {
    const people = [0, 1, 2].map((hero) => ({ who: 100 + hero, x: 116 + hero * 4, y: 104, r: 22, blows: 2, roams: true }));
    const went = new Set<number>();
    for (let slot = 0; slot < 60; slot++) {
      const plan = planProwl(STORE, 3, [], slot, people);
      expect(plan.duel, `slot ${slot}`).not.toBeNull();
      went.add(plan.duel!.who);
      // Whoever went was whoever's turn it was, unless he walked into somebody on his way.
      if (plan.duel!.from >= plan.there) expect(plan.duel!.who).toBe(100 + (slot % 3));
    }
    // Everybody has a turn.
    expect([...went].sort()).toEqual([100, 101, 102]);
  });
});

describe("what can be tapped in the camp", () => {
  it("is each parcel that came from the reading, by the burrow, and no more than there are", () => {
    const base = newBase(0, "2026-10-13");
    const none = lookOfBase(base, 1);
    expect(parcelSpots(none)).toEqual([]);
    const look = lookOfBase({ ...base, parcels: 4 }, 1);
    const spots = parcelSpots(look);
    expect(spots).toHaveLength(4);
    for (const [x, y] of spots) {
      expect(parcelAtPoint(look, x, y - 2)).toBe(true);
      expect(Math.hypot(x - look.spots.burrow[0], y - look.spots.burrow[1])).toBeLessThan(40);
    }
    expect(parcelAtPoint(look, 20, 60)).toBe(false);
    expect(parcelSpots(lookOfBase({ ...base, parcels: 99 }, 1))).toHaveLength(6);
  });

  it("is each trophy standing, by where it stands", () => {
    const base = newBase(0, "2026-10-13");
    const look = { ...lookOfBase(base, 1), trophies: [1, 3, 0] };
    const found = new Set<number>();
    for (let x = 0; x < 240; x += 2) for (let y = 50; y < 120; y += 2) found.add(trophyAtPoint(look, x, y));
    expect([...found].sort((a, b) => a - b)).toEqual([-1, 0, 1, 2]);
    expect(trophyAtPoint({ ...look, trophies: [] }, 120, 90)).toBe(-1);
  });
});

describe("a fence that goes up the picture, or across it on the slant", () => {
  const STORE: [number, number] = [180, 82];

  it("is joined to the piece behind it, and on the diagonal where it is not joined round the corner", () => {
    // One behind another.
    expect(fenceLinks([[100, 94], [100, 84], [100, 74]])).toEqual([
      [100, 94, 100, 84],
      [100, 84, 100, 74]
    ]);
    // On the slant, either way.
    expect(fenceLinks([[100, 94], [110, 84]])).toEqual([[100, 94, 110, 84]]);
    expect(fenceLinks([[100, 94], [90, 84]])).toEqual([[100, 94, 90, 84]]);
    // Side by side they meet already.
    expect(fenceLinks([[100, 94], [110, 94]])).toEqual([]);
    // Round a corner the two ends are joined by the corner, not across it.
    expect(fenceLinks([[100, 94], [110, 94], [110, 84]])).toEqual([[110, 94, 110, 84]]);
    // Too far apart to be a join.
    expect(fenceLinks([[100, 94], [120, 74]])).toEqual([]);
  });

  it("is not slipped through between two pieces on the slant", () => {
    // A fence all round the larder with every piece of it on the diagonal from the next.
    const diamond: Array<[number, number]> = [[180, 64], [190, 74], [200, 84], [190, 94], [180, 104], [170, 94], [160, 84], [170, 74]];
    expect(fenceLinks(diamond)).toHaveLength(8);
    let slot = 0;
    for (let tried = 0; tried < 40; slot++) {
      if (prowlStart(slot).kind > 3) continue;
      tried += 1;
      const plan = planProwl(STORE, 3, [], slot, [], [], { pieces: diamond, level: 2 });
      // There is no way in but over it.
      expect(plan.breaks.length, `slot ${slot}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("the camp's people, whose job it is", () => {
  const STORE: [number, number] = [180, 82];
  const hero = { who: 104, x: 150, y: 100, r: 22, blows: 3, roams: true };

  it("go out to meet a prowler as soon as he is in sight, and do not wait for him to be at a building", () => {
    let met = 0;
    let tried = 0;
    for (let slot = 0; tried < 60; slot++) {
      // The ones on foot: one on the wing cannot be met until he lands, and the mole not until he is up.
      if (prowlStart(slot).kind > 3) continue;
      tried += 1;
      const plan = planProwl(STORE, 3, [], slot, [hero]);
      expect(plan.duel?.who, `slot ${slot}`).toBe(104);
      // They set out before he had got to the larder.
      expect(plan.duel!.from).toBeLessThan(plan.there);
      // And were as long getting to him as it is far, not there in no time.
      expect(plan.duel!.run).toBeGreaterThanOrEqual(0.5);
      expect(plan.duel!.blows[0]).toBeGreaterThanOrEqual(plan.duel!.from + plan.duel!.run);
      if (plan.duel!.from + plan.duel!.run < plan.there - 0.2) met += 1;
    }
    // Most of them are met on the way, short of what they came for.
    expect(met).toBeGreaterThan(40);
  });

  it("see off, alone, what comes to a small camp, and not what comes to a big one", () => {
    let small = 0;
    let big = 0;
    for (let slot = 0, tried = 0; tried < 60; slot++) {
      if (prowlStart(slot).kind > 3) continue;
      tried += 1;
      if (planProwl(STORE, 2, [], slot, [hero]).falls !== null) small += 1;
      if (planProwl(STORE, 5, [], slot, [hero]).falls !== null) big += 1;
    }
    expect(small).toBe(60);
    expect(big).toBe(0);
  });

  it("are not doubled up on: a guardian whose ground he crosses has him, and nobody else comes as well", () => {
    for (let slot = 0, tried = 0; tried < 30; slot++) {
      if (prowlStart(slot).kind > 3) continue;
      tried += 1;
      const plan = planProwl(STORE, 3, [], slot, [{ who: 3, x: 178, y: 86, r: 20, blows: 4 }, hero]);
      expect(plan.duel).not.toBeNull();
      expect(plan.hurts.length).toBeLessThanOrEqual(plan.health);
    }
  });
});

describe("how often they come", () => {
  it("is a few in each of the camp's days, not a stream of them", () => {
    const base = newBase(0, "2026-10-13");
    const look = lookOfBase({ ...base, levels: { burrow: 3, oak: 3, store: 3, fence: 1, tower: 3, hut: 2 } }, 0);
    // Ten of the camp's four-minute days.
    let walks = 0;
    for (let slot = 0; slot < (DAY_SECONDS / 8) * 10; slot++) if (prowlPlanOf(look, [], slot)) walks += 1;
    expect(walks / 10).toBeGreaterThanOrEqual(4);
    expect(walks / 10).toBeLessThanOrEqual(8);
  });
});
