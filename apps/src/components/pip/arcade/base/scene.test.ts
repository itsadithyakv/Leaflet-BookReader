import { describe, expect, it } from "vitest";
import { DEFAULT_SPOTS, PLACED, newBase } from "../../../../pip/base/rules";
import type { CampSummary } from "../../../../services/socialService";
import { DAY_SECONDS, OAK_SHAKE_SECONDS, oakAcornAt, oakShakeOffset, siteAt, fenceLinks, parcelAtPoint, parcelSpots, trophyAtPoint, duskAt, gardenAt, gardenSpot, lookOfBase, lookOfSummary, pipRounds, summaryGuards, summaryLand, summaryWorks } from "./scene";

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
  it("begin in daylight, stay light for nine minutes, turn to night and back, and come round again in twelve", () => {
    expect(DAY_SECONDS).toBe(720);
    expect(duskAt(0)).toBe(0);
    // A visit of a few minutes is by day (it went dark after two, when the day was four minutes long).
    expect(duskAt(5 * 60)).toBe(0);
    expect(duskAt(9 * 60 - 1)).toBe(0);
    expect(duskAt(640)).toBe(1);
    expect(duskAt(DAY_SECONDS)).toBe(0);
    expect(duskAt(DAY_SECONDS + 640)).toBe(1);
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

});

describe("the oak, tapped", () => {
  it("shakes by whole art pixels only, and is still again when its shake is over", () => {
    for (const kind of ["gather", "full"] as const) {
      const seen = new Set<number>();
      for (let age = -0.1; age < 1.2; age += 0.01) seen.add(oakShakeOffset(kind, age));
      expect([...seen].every((dx) => dx === -1 || dx === 0 || dx === 1)).toBe(true);
      expect(seen.has(1) && seen.has(-1)).toBe(true);
      expect(oakShakeOffset(kind, OAK_SHAKE_SECONDS[kind])).toBe(0);
      expect(oakShakeOffset(kind, 5)).toBe(0);
    }
  });

  it("shivers quickly for a gathering, and shakes its head slowly at a full larder", () => {
    const changes = (kind: "gather" | "full") => {
      let count = 0;
      for (let age = 0.005; age < OAK_SHAKE_SECONDS[kind]; age += 0.01) if (oakShakeOffset(kind, age) !== oakShakeOffset(kind, age - 0.01)) count++;
      return count;
    };
    expect(changes("gather")).toBeGreaterThan(changes("full"));
  });

  it("has the acorn that waits on it over the oak itself: a tap on the acorn is a tap on the oak", () => {
    const base = newBase(0, "2026-10-13");
    const acorn = oakAcornAt(base.spots);
    expect(acorn.x).toBe(base.spots.oak[0]);
    expect(acorn.y).toBeLessThan(base.spots.oak[1]);
    expect(siteAt(base.spots, acorn.x, acorn.y + 4)).toBe("oak");
  });

  it("is not shown waiting on a camp pictured elsewhere", () => {
    const look = lookOfBase(newBase(0, "2026-10-13"), 1);
    expect(look.oakReady).toBe(false);
    expect(look.oakFull ?? false).toBe(false);
  });
});
