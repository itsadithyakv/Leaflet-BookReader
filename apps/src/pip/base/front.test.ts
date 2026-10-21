import { describe, expect, it } from "vitest";
import { BATTLE_TICK, Battle, DROP_STRONGHOLD, WALL_X, layout } from "./battle";
import { chapterStartsAt } from "./chapters";
import {
  BELL,
  FRONT_MARK,
  LINE_DEFAULT,
  LINE_LEAST,
  LINE_MOST,
  TRAIL_Y,
  WALL_LEAN,
  countRoles,
  frontMark,
  nightBounty,
  padsOpen,
  readFrontMark,
  sectionsAt,
  spotsOpen,
  trapSpots,
  wallXAt
} from "./front";
import { WORKS } from "./guards";
import {
  WELCOMED,
  frontChapter,
  fronted,
  gotThrough,
  keptForm,
  newBase,
  nextCamp,
  nightDue,
  nightOver,
  raidForecast,
  readBase,
  settle,
  startRaid,
  type BaseState
} from "./rules";

const DAY = "2026-10-21";
const at = (minutes: number) => ({ minutes, day: DAY, lit: false });

/** A camp as 1.5.10 kept it: pieces of fence laid by hand here and there, constructs set down anywhere, and no front. */
const before1511 = (change: Record<string, unknown> = {}) => {
  const base = newBase(0, DAY) as unknown as Record<string, unknown>;
  delete base.front;
  return {
    ...base,
    welcome: WELCOMED,
    minutes: chapterStartsAt(8) + 10,
    levels: { burrow: 4, oak: 4, store: 3, fence: 3, tower: 3, hut: 3 },
    walls: [
      [150, 72],
      [160, 72],
      [190, 82],
      [180, 98],
      [140, 86],
      [100, 112]
    ],
    downed: [
      [170, 72],
      [190, 92]
    ],
    gate: [160, 72],
    works: [
      { kind: 1, x: 100, y: 96 }, // a whip-thorn hedge: the thorn strip now
      { kind: 4, x: 200, y: 88 }, // tanglefoot
      { kind: 10, x: 120, y: 66 }, // an archer's nest
      { kind: 0, x: 60, y: 70 }, // a ward stone: an archer's nest now
      { kind: 3, x: 210, y: 60 }, // a smoke brazier: no more, paid back
      { kind: 8, x: 40, y: 90 } // caltrops: the thorn strip, of which there is one already: paid back
    ],
    acorns: 500,
    ...change
  };
};

describe("a camp from before the front, read", () => {
  it("has its wall across the trail at the fence level it had, whole, with the knocked-down pieces as sections down", () => {
    const camp = readBase(before1511())!;
    expect(camp.levels.fence).toBe(3);
    expect(camp.walls.length + camp.downed.length).toBe(sectionsAt(3).length);
    // Two pieces were down: two sections are, the nearest the gate first.
    expect(camp.downed.map(([, y]) => y).sort()).toEqual([74, 84]);
    // Every section on the wall's line.
    for (const [x, y] of [...camp.walls, ...camp.downed]) expect(x).toBe(wallXAt(camp.front.x, y));
  });

  it("puts the wall just left of its leftmost building, so nothing it built is left outside", () => {
    const camp = readBase(before1511({ spots: { ...newBase(0, DAY).spots, oak: [120, 70], hut: [110, 108], store: [170, 82] } }))!;
    for (const site of ["burrow", "oak", "store", "tower", "hut"] as const) {
      const [x, y] = camp.spots[site];
      expect(x, site).toBeGreaterThan(wallXAt(camp.front.x, y));
    }
    // As far right as that allows (and no further than the most it may be).
    expect(camp.front.x).toBeGreaterThan(LINE_DEFAULT);
    expect(camp.front.x).toBeLessThanOrEqual(LINE_MOST);
    // A building far over to the left: the wall stops at the least, and that building is outside it.
    const far = readBase(before1511({ spots: { ...newBase(0, DAY).spots, oak: [30, 70] } }))!;
    expect(far.front.x).toBe(LINE_LEAST);
  });

  it("never moves a building, a decoration or a piece of landscape", () => {
    const raw = before1511({ decor: [{ kind: 2, x: 40, y: 100 }], land: [{ kind: 3, x: 30, y: 60 }] });
    const camp = settle(readBase(raw)!, at(chapterStartsAt(8) + 20));
    expect(camp.spots).toEqual(readBase(raw)!.spots);
    expect(camp.decor).toEqual([{ kind: 2, x: 40, y: 100 }]);
    expect(camp.land).toEqual([{ kind: 3, x: 30, y: 60 }]);
  });

  it("has its constructs as they became, on the front's slots once it is brought up to now, and pays back what is no more", () => {
    const read = readBase(before1511())!;
    // The smoke brazier is no more, and the caltrops are one thorn strip too many: both paid back in full.
    expect(read.acorns).toBe(500 + WORKS[3].cost + WORKS[8].cost);
    expect(read.events[0].text).toMatch(/smoke brazier/);
    const camp = settle(read, at(chapterStartsAt(8) + 20));
    const owned = [...camp.front.spots, ...camp.front.pads, ...camp.front.shed].filter((kind) => kind >= 0).sort((a, b) => a - b);
    expect(owned).toEqual([4, 8, 10, 10]);
    // Chapter 8: three trap spots and two pads, all of them filled from the shed.
    expect(camp.front.spots.filter((kind) => kind >= 0).sort()).toEqual([4, 8]);
    expect(camp.front.pads.filter((kind) => kind >= 0)).toEqual([10, 10]);
    expect(camp.works).toHaveLength(4);
    // And Pip has a word about it, once.
    expect(camp.front.moved).toBe(true);
  });

  it("is read the same every time: nothing is paid back twice", () => {
    const raw = before1511();
    const once = keptForm(readBase(raw)!);
    const twice = readBase(JSON.parse(JSON.stringify(once)))!;
    expect(twice.acorns).toBe(readBase(raw)!.acorns);
    expect(twice.front).toEqual(readBase(raw)!.front);
  });
});

describe("the front, kept", () => {
  const camp = (): BaseState => {
    let s = settle(readBase(before1511())!, at(chapterStartsAt(8) + 20));
    s = { ...s, front: { ...s.front, held: 7 } };
    return s;
  };

  it("comes back as it was", () => {
    const s = camp();
    const back = readBase(JSON.parse(JSON.stringify(keptForm(s))))!;
    expect(back.front).toEqual({ ...s.front });
    expect(back.works).toEqual(s.works);
  });

  it("survives a save by a build that knows nothing of it: its mark in what every build keeps has it", () => {
    const s = camp();
    const saved = JSON.parse(JSON.stringify(keptForm(s))) as Record<string, unknown>;
    // An older build drops what it does not know, and the second archer's nest with it (it kept one of each).
    delete saved.front;
    saved.works = (saved.works as Array<{ kind: number }>).filter((entry, index, all) => all.findIndex((other) => other.kind === entry.kind) === index);
    const back = readBase(saved)!;
    expect(back.front.pads).toEqual(s.front.pads);
    expect(back.front.spots).toEqual(s.front.spots);
    expect(back.front.held).toBe(7);
    // And nothing was paid back for it.
    expect(back.acorns).toBe(s.acorns);
  });

  it("keeps its mark short enough for any build to keep", () => {
    const s = camp();
    const crowded = { ...s.front, x: 104, set: true, shed: [10, 10, 9, 9, 8, 4, 6, 2], bell: true, held: 99999 };
    const mark = frontMark(crowded);
    expect(mark.startsWith(FRONT_MARK)).toBe(true);
    expect(mark.length).toBeLessThanOrEqual(80);
    expect(readFrontMark([mark])).toMatchObject({ x: 104, set: true, bell: true, held: 99999 });
  });
});

describe("the front's slots", () => {
  it("open with the chapters: a trap with the fence, a tower with the archer's nest, three of each by the tenth", () => {
    expect([3, 4, 5, 6, 7, 8, 9, 10].map(spotsOpen)).toEqual([0, 1, 1, 2, 2, 3, 3, 3]);
    expect([3, 4, 5, 6, 7, 8, 9, 10].map(padsOpen)).toEqual([0, 0, 1, 1, 1, 2, 2, 3]);
  });

  it("lie on the trail in front of the wall (the traps), and behind it (the towers)", () => {
    for (const line of [44, 64, 104]) {
      const spots = trapSpots(14, line);
      for (const [x] of spots) {
        expect(x).toBeLessThan(line);
        expect(x).toBeGreaterThan(14);
      }
    }
    let s = fronted({ ...newBase(chapterStartsAt(10) + 5, DAY), minutes: chapterStartsAt(10) + 5, acorns: 10_000, levels: { burrow: 5, oak: 5, store: 5, fence: 5, tower: 5, hut: 5 } });
    expect(frontChapter(s)).toBeGreaterThanOrEqual(10);
    s = { ...s };
    for (const [x, y] of s.walls) expect(x).toBe(s.front.x + Math.round((TRAIL_Y - y) * WALL_LEAN));
  });
});

describe("a night watched", () => {
  const ready = () => fronted({ ...newBase(0, DAY), welcome: WELCOMED, minutes: chapterStartsAt(5), levels: { burrow: 3, oak: 3, store: 3, fence: 2, tower: 3, hut: 2 } });

  it("counts, the first after some reading: held, it is one more night held and a few acorns; any other is for the show", () => {
    const s = ready();
    const read = chapterStartsAt(5) + 30;
    expect(nightDue(s, read)).toBe(true);
    const held = nightOver(s, true, read, DAY);
    expect(held.bounty).toBe(nightBounty(5));
    expect(held.state.front.held).toBe(1);
    expect(held.state.acorns).toBe(s.acorns + nightBounty(5));
    // Another the same visit, with no reading since: nothing.
    expect(nightDue(held.state, read)).toBe(false);
    expect(nightOver(held.state, true, read, DAY).state).toBe(held.state);
    // Lost, it counts too (no bounty, no night held), and the next waits for some reading.
    const lost = nightOver(s, false, read, DAY);
    expect(lost.bounty).toBe(0);
    expect(lost.state.front.held).toBe(0);
    expect(nightDue(lost.state, read + 1)).toBe(true);
  });

  it("is a little: the bounty is small beside the oak", () => {
    for (let chapter = 3; chapter <= 12; chapter++) expect(nightBounty(chapter)).toBeLessThanOrEqual(25);
  });

  it("has Pip say a word, once, about what beats a kind that got through", () => {
    const s = gotThrough(ready(), "bomber");
    expect(s.front.through).toEqual(["bomber"]);
    expect(gotThrough(s, "bomber")).toBe(s);
  });

  it("counts who is coming by kind, for the chip", () => {
    expect(countRoles([0, 0, 7, 5, 0, 3])).toEqual([
      { role: "creeper", kind: 0, count: 4 },
      { role: "runner", kind: 5, count: 1 },
      { role: "bomber", kind: 7, count: 1 }
    ]);
  });
});

describe("raids down a stronghold's trail", () => {
  const camp = (hut: number, n = 6) => ({ ...newBase(0, DAY), welcome: WELCOMED, levels: { burrow: 5, oak: 5, store: 5, fence: 5, tower: 5, hut }, camps: n, minutes: 3000 });

  it("put scouts down only in the strip down the left of the field, and not in among the camp", () => {
    const raid = startRaid(camp(3), "camp", { minutes: 3000, day: DAY, lit: false })!;
    const battle = new Battle(raid.raid.setup);
    expect(battle.canDeploy(DROP_STRONGHOLD - 2, 60)).toBe(true);
    expect(battle.canDeploy(DROP_STRONGHOLD + 2, 60)).toBe(false);
    expect(battle.canDeploy(200, 110)).toBe(false);
  });

  it("have a stronghold's wall straight across its trail's side, with a way round its top and its foot", () => {
    const walls = layout(8, false).filter((entry) => entry.kind === "wall");
    expect(walls.length).toBeGreaterThan(0);
    for (const wall of walls) expect(wall.x).toBe(WALL_X);
    const ys = walls.map((wall) => wall.y);
    expect(Math.min(...ys)).toBeGreaterThan(20);
    expect(Math.max(...ys)).toBeLessThan(108);
    // The gate, across the trail, is the toughest of it.
    const gate = walls.reduce((best, wall) => (wall.max > best.max ? wall : best));
    expect(Math.abs(gate.y - 64)).toBeLessThanOrEqual(5);
  });

  it("have Puffcaps from the hut's third level, and a Puffcap blows a wall open", () => {
    const setup = startRaid(camp(3, 8), "camp", { minutes: 3000, day: DAY, lit: false })!.raid.setup;
    expect(setup.kinds).toContain("bomber");
    expect(setup.bombers).toBe(1);
    const battle = new Battle(setup);
    expect(battle.deploy("bomber", 30, 64)).toBe(true);
    // One only.
    expect(battle.deploy("bomber", 30, 70)).toBe(false);
    for (let tick = 0; tick < 8 / BATTLE_TICK; tick++) battle.step(BATTLE_TICK);
    expect(battle.structures.some((entry) => entry.kind === "wall" && entry.hp <= 0)).toBe(true);
    expect(battle.units[0].blew).toBe(true);
  });

  it("are forecast sanely: taken whole early, too strong late, and a better hut takes more of the ladder", () => {
    const firstMiss = (hut: number) => {
      for (let n = 0; n < 40; n += 2) if (raidForecast(camp(hut, n), nextCamp(camp(hut, n))).stars < 3) return n;
      return 40;
    };
    const misses = [1, 2, 3, 4, 5].map(firstMiss);
    for (let hut = 1; hut < misses.length; hut++) expect(misses[hut]).toBeGreaterThanOrEqual(misses[hut - 1]);
    expect(misses[0]).toBeGreaterThanOrEqual(5);
    for (const hut of [1, 2, 3, 4, 5]) expect(raidForecast(camp(hut, 39), nextCamp(camp(hut, 39))).stars).toBeLessThan(3);
    // Not taken whole: one thing that would help.
    const hard = raidForecast(camp(1, 12), nextCamp(camp(1, 12)));
    expect(hard.hint).toBeTruthy();
    expect(raidForecast(camp(5, 0), nextCamp(camp(5, 0))).hint).toBeNull();
    // (The bell is had once, on the gate.)
    expect(WORKS[BELL].retired).toBeFalsy();
  }, 30_000);
});
