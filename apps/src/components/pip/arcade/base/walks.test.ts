import { describe, expect, it } from "vitest";
import { clearWay, onWalk, planWalk, shuffled, wayRound, type Block, type Stop } from "./walks";

const inside = (blocks: readonly Block[], x: number, y: number) => blocks.some((block) => ((x - block.x) / block.rx) ** 2 + ((y - block.y) / block.ry) ** 2 < 1);

describe("a way round what stands", () => {
  it("is the straight line when nothing is in it", () => {
    expect(wayRound([20, 80], [200, 100], [])).toEqual([
      [20, 80],
      [200, 100]
    ]);
  });

  it("goes round a building and not through it", () => {
    const blocks: Block[] = [{ x: 120, y: 86, rx: 16, ry: 7 }];
    expect(clearWay(blocks, [60, 86], [180, 86])).toBe(false);
    const way = wayRound([60, 86], [180, 86], blocks);
    expect(way.length).toBeGreaterThan(2);
    expect(way[0]).toEqual([60, 86]);
    expect(way[way.length - 1]).toEqual([180, 86]);
    // Every step of it, walked a pixel at a time, is on open grass.
    for (let point = 1; point < way.length; point++) {
      const [ax, ay] = way[point - 1];
      const [bx, by] = way[point];
      const long = Math.hypot(bx - ax, by - ay);
      for (let gone = 0; gone <= long; gone += 1) {
        expect(inside(blocks, ax + ((bx - ax) * gone) / long, ay + ((by - ay) * gone) / long), `through the building at step ${point}`).toBe(false);
      }
    }
    // And it is a walk, not a tour: no more than half as far again as the crow flies.
    const long = way.slice(1).reduce((sum, to, index) => sum + Math.hypot(to[0] - way[index][0], to[1] - way[index][1]), 0);
    expect(long).toBeLessThan(120 * 1.5);
  });

  it("finds the gap in a run of fence, and goes straight through whatever has no way round", () => {
    const fence: Block[] = [70, 80, 90, 100, 110].map((y) => ({ x: 120, y, rx: 5.5, ry: 6 }));
    const way = wayRound([80, 90], [160, 90], fence);
    expect(way.length).toBeGreaterThan(2);
    // Walled in from edge to edge: there is no way, so it does not stand for ever.
    const wall: Block[] = Array.from({ length: 30 }, (_, index) => ({ x: 120, y: 44 + index * 3, rx: 6, ry: 4 }));
    expect(wayRound([80, 90], [160, 90], wall)).toEqual([
      [80, 90],
      [160, 90]
    ]);
  });
});

describe("a round", () => {
  const stops: Stop[] = [
    { x: 40, y: 90, act: "idle", rest: 2, inside: true },
    { x: 120, y: 100, act: "look", rest: 2 },
    { x: 200, y: 80, act: "yawn", rest: 2 }
  ];
  const plan = planWalk(stops, [{ x: 80, y: 94, rx: 10, ry: 5 }]);

  it("is the same place at the same time, and comes round again", () => {
    expect(onWalk(plan, 7.5, 13)).toEqual(onWalk(plan, 7.5, 13));
    const round = plan.legs.reduce((sum, leg) => sum + leg.long / 13 + leg.stop.rest, 0);
    const now = onWalk(plan, 3, 13);
    const again = onWalk(plan, 3 + round, 13);
    expect(again.x).toBeCloseTo(now.x, 3);
    expect(again.y).toBeCloseTo(now.y, 3);
  });

  it("never jumps: a walker moves no further in a tenth of a second than their pace allows", () => {
    const round = plan.legs.reduce((sum, leg) => sum + leg.long / 13 + leg.stop.rest, 0);
    let last = onWalk(plan, 0, 13);
    for (let tenth = 1; tenth < round * 10; tenth++) {
      const now = onWalk(plan, tenth / 10, 13);
      expect(Math.hypot(now.x - last.x, now.y - last.y), `at ${tenth / 10}s`).toBeLessThan(13 * 0.1 + 0.01);
      last = now;
    }
  });

  it("goes in at a door and is out of sight until it comes out", () => {
    // The last leg ends at the first stop, which is a door.
    const before = plan.legs.slice(0, -1).reduce((sum, leg) => sum + leg.long / 13 + leg.stop.rest, 0) + plan.legs[plan.legs.length - 1].long / 13;
    expect(onWalk(plan, before + 0.01, 13).shown).toBeGreaterThan(0.9);
    expect(onWalk(plan, before + 1, 13).shown).toBe(0);
    expect(onWalk(plan, before + 1.99, 13).shown).toBeGreaterThan(0.9);
    // A stop that is not a door hides nobody.
    const second = plan.legs[0].long / 13 + 1;
    expect(onWalk(plan, second, 13)).toMatchObject({ move: "look", shown: 1 });
  });
});

describe("the order a camp's stops are taken in", () => {
  it("is the same for the same camp, different for another, and loses nothing", () => {
    const list = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffled(list, 42)).toEqual(shuffled(list, 42));
    expect(shuffled(list, 42)).not.toEqual(shuffled(list, 43));
    expect([...shuffled(list, 42)].sort()).toEqual(list);
    expect(list).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
