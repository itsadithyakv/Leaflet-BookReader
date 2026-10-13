import { describe, expect, it } from "vitest";
import { BATTLE_TICK, Battle, FIELD_H, FIELD_W, RAID_SECONDS, SIDES, autoBest, autoPlay, campHas, layout, type Setup, type UnitKind } from "./battle";

const setupOf = (level: number, n: number, change: Partial<Setup> = {}): Setup => ({
  n,
  king: false,
  capacity: 5 + level * 2,
  level,
  kinds: ["sprout", ...(level >= 2 ? ["slinger"] : []), ...(level >= 4 ? ["mole"] : [])] as UnitKind[],
  fast: false,
  ...change
});

const run = (battle: Battle, seconds = RAID_SECONDS + 1) => {
  for (let tick = 0; tick < seconds / BATTLE_TICK && !battle.over; tick++) battle.step(BATTLE_TICK);
};

describe("a camp laid out", () => {
  it("is the same camp every time, and a different one from the next", () => {
    expect(layout(7, false)).toEqual(layout(7, false));
    expect(layout(7, false)).not.toEqual(layout(8, false));
  });

  it("grows: more hoards, then sentries, then a wall, and sturdier all the while", () => {
    expect(campHas(0, false)).toEqual({ hoards: 1, perches: 0, walls: 0 });
    expect(campHas(3, false)).toEqual({ hoards: 2, perches: 1, walls: 0 });
    expect(campHas(4, false).walls).toBe(4);
    expect(campHas(30, false)).toEqual({ hoards: 3, perches: 5, walls: 10 });
    const nest = (n: number) => layout(n, false).find((entry) => entry.kind === "nest")!.max;
    expect(nest(10)).toBeGreaterThan(nest(2));
    // The King's roost has more of everything than the camp of its number.
    expect(campHas(5, true).perches).toBeGreaterThan(campHas(5, false).perches);
    expect(layout(5, true)[0].max).toBeGreaterThan(layout(5, false)[0].max);
  });

  it("fits the field, with room on every side to come at it", () => {
    for (const n of [0, 4, 9, 20, 40]) {
      for (const king of [false, true]) {
        for (const entry of layout(n, king)) {
          expect(entry.x - entry.r, `camp ${n}`).toBeGreaterThanOrEqual(0);
          expect(entry.x + entry.r).toBeLessThanOrEqual(FIELD_W);
          expect(entry.y - entry.r).toBeGreaterThanOrEqual(0);
          expect(entry.y).toBeLessThanOrEqual(FIELD_H);
        }
        const battle = new Battle(setupOf(3, n, { king }));
        expect(battle.canDeploy(10, 60)).toBe(true);
        expect(battle.canDeploy(FIELD_W - 8, 60)).toBe(true);
      }
    }
  });
});

describe("putting scouts down", () => {
  it("is anywhere outside the camp, while there are scouts left", () => {
    const battle = new Battle(setupOf(1, 2));
    const nest = battle.structures[0];
    expect(battle.deploy("sprout", nest.x, nest.y)).toBe(false);
    expect(battle.deploy("sprout", -5, 60)).toBe(false);
    expect(battle.left).toBe(7);
    for (let index = 0; index < 7; index++) expect(battle.deploy("sprout", 20, 40 + index * 5)).toBe(true);
    expect(battle.left).toBe(0);
    expect(battle.deploy("sprout", 20, 60)).toBe(false);
  });

  it("is only of the kinds the hut has trained", () => {
    const green = new Battle(setupOf(1, 0));
    expect(green.deploy("slinger", 20, 60)).toBe(false);
    expect(green.deploy("mole", 20, 60)).toBe(false);
    const old = new Battle(setupOf(4, 0));
    expect(old.deploy("slinger", 20, 60)).toBe(true);
    expect(old.deploy("mole", 20, 60)).toBe(true);
  });
});

describe("a raid", () => {
  it("is the same raid for the same scouts put down the same way", () => {
    expect(autoPlay(setupOf(3, 9), "top")).toEqual(autoPlay(setupOf(3, 9), "top"));
  });

  it("with nobody sent ends with nothing, and at once", () => {
    const battle = new Battle(setupOf(2, 3, { capacity: 0 }));
    battle.step(BATTLE_TICK);
    expect(battle.over).toBe(true);
    expect(battle.result()).toEqual({ stars: 0, destroyed: 0, hoards: 0 });
  });

  it("takes the first camp whole, even with the greenest scouts", () => {
    expect(autoPlay(setupOf(1, 0))).toEqual({ stars: 3, destroyed: 1, hoards: 1 });
  });

  it("is over when the camp is down, the scouts are, or the time is", () => {
    const won = new Battle(setupOf(5, 0));
    for (let index = 0; index < 10; index++) won.deploy("sprout", 100, 40 + index * 4);
    run(won);
    expect(won.over).toBe(true);
    expect(won.time).toBeLessThan(RAID_SECONDS);

    const lost = new Battle(setupOf(1, 30));
    expect(lost.deploy("sprout", 10, 64)).toBe(true);
    // The rest are held back: the raid goes on until they are sent, or the time is up.
    run(lost, 30);
    expect(lost.units[0].hp).toBe(0);
    expect(lost.over).toBe(false);
    run(lost);
    expect(lost.over).toBe(true);
    expect(lost.time).toBeGreaterThanOrEqual(RAID_SECONDS);
    expect(lost.result().stars).toBe(0);
  });

  it("gives a star for half the camp, one for the nest, and one for all of it", () => {
    const battle = new Battle(setupOf(5, 2));
    const [nest, ...rest] = battle.structures.filter((entry) => entry.kind !== "wall");
    expect(battle.result().stars).toBe(0);
    // The nest counts as two of the camp's buildings: here two of five.
    nest.hp = 0;
    expect(battle.result()).toMatchObject({ stars: 1, destroyed: 0.4 });
    rest[0].hp = 0;
    expect(battle.result()).toMatchObject({ stars: 2, destroyed: 0.6 });
    for (const entry of rest) entry.hp = 0;
    expect(battle.result()).toEqual({ stars: 3, destroyed: 1, hoards: 1 });
  });

  it("gives its first star to scouts who cannot crack the nest, for the rest of the camp", () => {
    const battle = new Battle(setupOf(3, 10));
    const rest = battle.structures.filter((entry) => entry.kind !== "wall" && entry.kind !== "nest");
    // Three hoards and four sentries about a nest: half the camp is five of them down.
    expect(rest).toHaveLength(7);
    rest.slice(0, 4).forEach((entry) => (entry.hp = 0));
    expect(battle.result().stars).toBe(0);
    rest[4].hp = 0;
    expect(battle.result()).toMatchObject({ stars: 1, destroyed: 5 / 9 });
  });
});

describe("the scouts", () => {
  it("pull down a wall that is in the way, and a mole goes under it", () => {
    const camp = setupOf(4, 8);
    const walls = layout(8, false).filter((entry) => entry.kind === "wall");
    const middle = walls[Math.floor(walls.length / 2)];
    const sprout = new Battle(camp);
    sprout.deploy("sprout", middle.x - 30, middle.y);
    const mole = new Battle(camp);
    mole.deploy("mole", middle.x - 30, middle.y);
    for (let tick = 0; tick < 4 / BATTLE_TICK; tick++) {
      sprout.step(BATTLE_TICK);
      mole.step(BATTLE_TICK);
    }
    expect(sprout.structures.some((entry) => entry.kind === "wall" && entry.hp < entry.max)).toBe(true);
    expect(mole.structures.every((entry) => entry.kind !== "wall" || entry.hp === entry.max)).toBe(true);
    // And the mole is making for a hoard, not the nearest thing.
    expect(mole.structures[mole.units[0].target!].kind).toBe("hoard");
  });

  it("are thrown at by a sentry in reach", () => {
    const battle = new Battle(setupOf(2, 1));
    const perch = battle.structures.find((entry) => entry.kind === "perch")!;
    battle.deploy("sprout", perch.x - perch.r - 18, perch.y);
    for (let tick = 0; tick < 3 / BATTLE_TICK; tick++) battle.step(BATTLE_TICK);
    expect(battle.units[0].hp).toBeLessThan(battle.units[0].max);
  });

  it("are stronger from a better hut, and quicker as runners", () => {
    const hp = (level: number) => {
      const battle = new Battle(setupOf(level, 0));
      battle.deploy("sprout", 20, 60);
      return battle.units[0].max;
    };
    expect(hp(5)).toBeGreaterThan(hp(1));
    const reached = (fast: boolean) => {
      const battle = new Battle(setupOf(1, 0, { fast }));
      battle.deploy("sprout", 10, 64);
      for (let tick = 0; tick < 2 / BATTLE_TICK; tick++) battle.step(BATTLE_TICK);
      return battle.units[0].x;
    };
    expect(reached(true)).toBeGreaterThan(reached(false));
  });
});

describe("a camp's sentries", () => {
  const hits = (n: number) => layout(n, false).filter((entry) => entry.kind === "perch").map((entry) => entry.hit);

  it("grow by one every third camp, and the new one is green for its first two", () => {
    // Camp 4 is the first with two: the second throws softer than the first, and by camp 6 as hard.
    const [old, green] = hits(4);
    expect(green).toBeLessThan(old * 0.5);
    expect(hits(5)[1]).toBeGreaterThan(hits(5)[0] * 0.6);
    expect(hits(6)[1]).toBe(hits(6)[0]);
    // Once a camp has all the sentries it will ever have, none is green.
    expect(new Set(hits(30)).size).toBe(1);
  });
});

describe("a champion", () => {
  const held = (n = 5) => new Battle(setupOf(3, n, { champion: 1 }));

  it("stands before the nest of a camp that has one, and not otherwise", () => {
    expect(new Battle(setupOf(3, 5)).foe).toBeNull();
    expect(held().foe).toMatchObject({ variant: 1 });
  });

  it("is set on by every scout close by, not fought one at a time", () => {
    const fight = (scouts: number) => {
      const battle = held();
      const foe = battle.foe!;
      // Put down where he will come out to them, and well away from the sentries' side.
      for (let index = 0; index < scouts; index++) battle.deploy("sprout", foe.x - 40, foe.y + (index - scouts / 2) * 2);
      for (let tick = 0; tick < 12 / BATTLE_TICK && foe.hp > 0; tick++) battle.step(BATTLE_TICK);
      return foe.max - foe.hp;
    };
    // Six scouts do far more to him than one does six times over, since all six are at him at once.
    expect(fight(6)).toBeGreaterThan(fight(1) * 3);
  });
});

describe("a hero who mends", () => {
  it("mends one scout at a time: the worst hurt near her", () => {
    const battle = new Battle(setupOf(3, 0, { hero: { id: 8, hp: 70, dps: 6, speed: 0, reach: 3, heals: 9 } }));
    battle.deploy("hero", 30, 60);
    battle.deploy("sprout", 32, 60);
    battle.deploy("sprout", 34, 60);
    const [, worse, better] = battle.units;
    worse.hp = worse.max - 30;
    better.hp = better.max - 10;
    battle.step(1);
    expect(worse.hp).toBe(worse.max - 21);
    expect(better.hp).toBe(better.max - 10);
  });
});

describe("how hard the ladder is, played by rule", () => {
  // The numbers were set against this table: each hut level opens some camps to a raid
  // played without thought, and the best side takes a camp or two more than the near one.
  const reach = (level: number, play: (setup: Setup) => { stars: number }) => {
    let last = -1;
    // Every other camp: the whole ladder for five huts from four sides is a great many raids.
    for (let n = 0; n <= 40; n += 2) if (play(setupOf(level, n)).stars >= 1) last = n;
    return last;
  };

  it("opens more camps with every level of the hut", () => {
    const byLevel = [1, 2, 3, 4, 5].map((level) => reach(level, autoBest));
    for (let index = 1; index < byLevel.length; index++) expect(byLevel[index], `${byLevel}`).toBeGreaterThanOrEqual(byLevel[index - 1]);
    expect(byLevel[0]).toBeGreaterThanOrEqual(3);
    expect(byLevel[4]).toBeGreaterThanOrEqual(15);
    // And it does end: no hut takes every camp there could ever be.
    expect(autoBest(setupOf(5, 80)).stars).toBe(0);
  }, 30_000);

  it("rewards the side that is chosen", () => {
    let better = 0;
    for (let n = 3; n <= 30; n++) {
      const sides = SIDES.map((side) => autoPlay(setupOf(3, n), side).destroyed);
      if (Math.max(...sides) > Math.min(...sides)) better += 1;
    }
    expect(better).toBeGreaterThan(10);
  });
});
