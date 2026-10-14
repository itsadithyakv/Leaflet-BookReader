import { describe, expect, it } from "vitest";
import { FOES, WORKS } from "./guards";
import {
  DECOR_FROM,
  FENCE_FROM,
  POSTCARD_FROM,
  PROWLERS_FROM,
  GUARDS_FROM,
  MAX_LEVEL,
  MEADOW_FROM,
  PLOT_FROM,
  blocked,
  build,
  burrowFor,
  campOpens,
  decorOpen,
  magpies,
  meadowOpen,
  moveSite,
  newBase,
  plotOpen,
  settle,
  spotBlocked,
  standing,
  wallBlocked,
  workBlocked,
  type BaseState
} from "./rules";

const DAY = "2026-10-12";
const camp = (burrow: number, more: Partial<BaseState> = {}): BaseState => {
  const base = newBase(0, DAY);
  return { ...base, acorns: 5000, levels: { ...base.levels, burrow, store: 5 }, ...more };
};

describe("the camp's level", () => {
  it("is what brings a plot: none at level 1, one at 2, both at 3", () => {
    expect(standing(camp(1))).not.toContain("yard0");
    expect(standing(camp(1))).not.toContain("yard1");
    expect(standing(camp(2))).toContain("yard0");
    expect(standing(camp(2))).not.toContain("yard1");
    expect(standing(camp(3))).toEqual(expect.arrayContaining(["yard0", "yard1"]));
    expect(PLOT_FROM).toEqual({ yard0: 2, yard1: 3 });
  });

  it("will not have a plot built on before it is there, and says which level it wants", () => {
    expect(blocked(camp(1), "yard0", "hive")).toBe("burrow");
    expect(burrowFor(camp(1), "yard0")).toBe(2);
    expect(blocked(camp(2), "yard0", "hive")).toBeNull();
    expect(blocked(camp(2), "yard1", "well")).toBe("burrow");
    expect(burrowFor(camp(2), "yard1")).toBe(3);
    expect(blocked(camp(3), "yard1", "well")).toBeNull();
    expect(build(camp(2), "yard1", 0, "well")).toEqual(camp(2));
  });

  it("leaves standing a plot that was built on under the old rule", () => {
    const old = camp(2, { yard: [{ kind: "hive", level: 1 }, { kind: "well", level: 1 }] });
    expect(plotOpen(old, "yard1")).toBe(true);
    expect(standing(old)).toContain("yard1");
  });

  it("does not let a plot that is not there get in the way", () => {
    const base = camp(1);
    const [x, y] = base.spots.yard0;
    expect(spotBlocked(base, "hut", x, y)).toBeNull();
    expect(spotBlocked(camp(2), "hut", x, y)).toBe("building");
    const walled = { ...base, levels: { ...base.levels, fence: 1 } };
    expect(wallBlocked(walled, x, y)).toBeNull();
    expect(wallBlocked({ ...walled, levels: { ...walled.levels, burrow: 2 } }, x, y)).toBe("building");
  });

  it("seats a new plot on free ground when something was put where it would have been", () => {
    let base = camp(1);
    const [x, y] = base.spots.yard0;
    base = moveSite(base, "hut", x, y);
    expect(base.spots.hut).toEqual([x, y]);
    // The burrow goes up a level: the reading that finishes it is done.
    base = build(base, "burrow", 0);
    base = settle(base, { minutes: 10_000, day: DAY, lit: false });
    expect(base.levels.burrow).toBe(2);
    expect(base.spots.hut).toEqual([x, y]);
    expect(spotBlocked(base, "yard0", base.spots.yard0[0], base.spots.yard0[1])).toBeNull();
    expect(base.events.some((event) => event.text.startsWith("The camp is level 2. New: a wider clearing, a plot in the yard"))).toBe(true);
  });

  it("opens, at each level, what the list says it does and nothing a level early", () => {
    for (let level = 2; level <= MAX_LEVEL; level += 1) {
      const before = camp(level - 1);
      const now = camp(level);
      const opens = campOpens(level);
      expect(opens.length, `level ${level} opens something`).toBeGreaterThan(0);
      for (const entry of opens) {
        const said = `${entry.name} at level ${level}`;
        if (entry.kind === "plot") {
          const site = level === PLOT_FROM.yard0 ? "yard0" : "yard1";
          expect(plotOpen(before, site), said).toBe(false);
          expect(plotOpen(now, site), said).toBe(true);
        } else if (entry.kind === "decor") {
          expect([decorOpen(before), decorOpen(now)], said).toEqual([false, true]);
          expect(level).toBe(DECOR_FROM);
        } else if (entry.kind === "meadow") {
          expect([meadowOpen(before), meadowOpen(now)], said).toEqual([false, true]);
          expect(level).toBe(MEADOW_FROM);
        } else if (entry.kind === "guards") {
          expect(level, said).toBe(GUARDS_FROM);
        } else if (entry.kind === "work") {
          expect(workBlocked(before, entry.which!), said).toBe("burrow");
          expect(workBlocked(now, entry.which!), said).toBeNull();
        } else if (entry.kind === "foe") {
          // Who comes out of the wood: most kinds from the level prowlers come at all, the mole from 3, Fizzwick from 4.
          expect([PROWLERS_FROM, 3, 4], said).toContain(level);
        } else if (entry.kind === "fence") {
          expect(blocked({ ...before, acorns: 999 }, "fence"), said).toBe("burrow");
          expect(blocked({ ...now, acorns: 999 }, "fence"), said).toBeNull();
          expect(level).toBe(FENCE_FROM);
        } else if (entry.kind === "postcard") {
          expect(level, said).toBe(POSTCARD_FROM);
        }
      }
    }
    // Nothing is left off: every construct and every kind of raider is on some level's list, once.
    const all = [2, 3, 4, 5].flatMap((level) => campOpens(level));
    expect(
      all
        .filter((entry) => entry.kind === "work")
        .map((entry) => entry.which ?? 0)
        .sort((a, b) => a - b)
    ).toEqual(WORKS.map((_, which) => which));
    expect(all.filter((entry) => entry.kind === "foe").map((entry) => entry.name)).toEqual(["Prowlers", "The Rootgnaw", "Fizzwick"]);
    expect(all.filter((entry) => entry.kind === "paths")).toEqual([]);
    expect(all.filter((entry) => entry.kind === "plot")).toHaveLength(2);
    expect(campOpens(1)).toEqual([]);
    // The first raiders come with the same level the list says they do.
    expect(magpies(camp(1))).toBe(0);
    expect(magpies(camp(2))).toBeGreaterThan(0);
  });
});
