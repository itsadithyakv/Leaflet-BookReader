import { describe, expect, it } from "vitest";
import { newBase } from "../../../pip/base/rules";
import { lookOfBase, pipEntering, pipEntry, pipExit, pipExiting } from "../arcade/base/scene";
import { glowAt } from "./useBurrowDoor";

const look = () => lookOfBase({ ...newBase(0, "2026-10-16"), levels: { burrow: 2, oak: 1, store: 1, fence: 0, tower: 0, hut: 0 } }, 1);

describe("Pip through her door", () => {
  it("walks to her door at a pace a person could keep, then goes in as it opens", () => {
    const camp = look();
    for (const since of [0, 7.3, 31, 140]) {
      const entry = pipEntry(camp, since);
      expect(entry.total).toBeLessThanOrEqual(2.5);
      // No slide: from close by a brisk walk; from far off a run, whose steps keep up (pipEntering's age), never a glide.
      if (entry.long > 0) {
        const pace = entry.long / entry.walk;
        expect(pace).toBeLessThanOrEqual(Math.max(13 * 1.8, 240 / 2) + 1e-6);
        const early = pipEntering(entry, 0.1);
        expect(early.age / 0.1).toBeCloseTo(Math.max(1, pace / 13), 5);
      }
      const door = entry.path[entry.path.length - 1];
      // (Already at home, there is only the door to open.)
      if (entry.walk > 0.3) expect(pipEntering(entry, 0).door).toBe(0);
      const there = pipEntering(entry, entry.walk + 0.01);
      expect([there.x, there.y]).toEqual(door);
      expect(there.door).toBe(2);
      expect(pipEntering(entry, entry.total).shown).toBe(0);
    }
  });

  it("comes out of the open door and walks on to where her round has her, with no jump", () => {
    const camp = look();
    const exit = pipExit(camp, 50);
    const start = pipExiting(exit, 0);
    expect(start.door).toBe(2);
    expect(start.shown).toBe(0);
    expect(pipExiting(exit, 0.3).shown).toBeGreaterThan(0.5);
    const end = pipExiting(exit, exit.total - 1e-6);
    expect(Math.hypot(end.x - exit.there.x, end.y - exit.there.y)).toBeLessThan(0.5);
    expect(pipExiting(exit, exit.total).door).toBe(0);
  });

  it("glows by steps of brightness only", () => {
    const seen = new Set<number>();
    for (let t = 0; t < 3; t += 0.01) seen.add(glowAt(t));
    expect(seen.size).toBeLessThanOrEqual(4);
    for (const value of seen) expect(value).toBeGreaterThan(0);
  });
});
