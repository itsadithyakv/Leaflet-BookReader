import { describe, expect, it } from "vitest";
import { BATTLE_TICK, Battle, type BattleEvent, type Structure } from "../../../../pip/base/battle";
import { group } from "../../../../pip/base/squad";
import { FALL_SECONDS, fallFrame, fallOf, moving, newFx, rubbleOf, stepFx, takeEvents } from "./raidFx";

/** The raid's events as the field shows them (raidFx.ts): each kind of thing falls its own way and leaves rubble. */

const at = (id: number, kind: Structure["kind"], more: Partial<Structure> = {}): Structure => ({ id, kind, x: 100 + id, y: 60, r: 5, hp: 0, max: 60, range: 0, hit: 0, every: 0, cool: 0, ...more });
const STRUCTURES: Structure[] = [at(0, "nest", { r: 14 }), at(1, "hoard"), at(2, "perch"), at(3, "wall"), at(4, "wall", { gate: "main" }), at(5, "other", { look: { name: "hut", variant: 2 } })];

describe("a raid's events, as the field shows them", () => {
  it("falls each kind of structure its own way, and leaves its own rubble", () => {
    expect([fallOf("wall"), fallOf("wall", "main"), fallOf("perch"), fallOf("hoard"), fallOf("nest"), fallOf("other", undefined, true)]).toEqual(["topple", "break", "tip", "burst", "collapse", "collapse"]);
    expect([rubbleOf("wall"), rubbleOf("wall", "postern"), rubbleOf("perch"), rubbleOf("hoard"), rubbleOf("nest"), rubbleOf("nest", undefined, false, true), rubbleOf("hoard", undefined, true)]).toEqual([
      "wall",
      "gate",
      "perch",
      "hoard",
      "nest",
      "king",
      "building"
    ]);
  });

  it("maps each event: cracks, falls with their specks, the magpie flying off, acorns hopping, the call, a pit, the stars", () => {
    const fx = newFx(false);
    const events: BattleEvent[] = [
      { tick: 1, kind: "hurt", id: 1, structure: "hoard", x: 101, y: 60, cracks: 1 },
      { tick: 2, kind: "hurt", id: 1, structure: "hoard", x: 101, y: 60, cracks: 2 },
      { tick: 3, kind: "spill", id: 1, x: 101, y: 60, loot: 0.2 },
      { tick: 3, kind: "down", id: 1, structure: "hoard", x: 101, y: 60 },
      { tick: 4, kind: "flee", id: 2, x: 102, y: 60 },
      { tick: 4, kind: "down", id: 2, structure: "perch", x: 102, y: 60 },
      { tick: 5, kind: "breach", id: 4, x: 104, y: 60, gate: "main" },
      { tick: 5, kind: "down", id: 4, structure: "wall", x: 104, y: 60 },
      { tick: 6, kind: "call", id: 2, x: 102, y: 60 },
      { tick: 7, kind: "pit", zone: 1, x: 50, y: 64, took: 1 },
      { tick: 8, kind: "nest", id: 0, x: 100, y: 60 },
      { tick: 8, kind: "down", id: 0, structure: "nest", x: 100, y: 60 },
      { tick: 8, kind: "star", star: 0 }
    ];
    takeEvents(fx, events.slice(0, 2), 0, STRUCTURES);
    expect(fx.cracks.get(1)).toBe(2);
    takeEvents(fx, events, 1, STRUCTURES);
    expect(fx.read).toBe(events.length);
    // Down: its crack gone, its fall begun, its rubble waiting.
    expect(fx.cracks.has(1)).toBe(false);
    expect(fx.falls.get(1)).toEqual({ kind: "burst", at: 1, seconds: FALL_SECONDS.burst });
    expect(fx.falls.get(2)?.kind).toBe("tip");
    expect(fx.falls.get(4)?.kind).toBe("break");
    expect(fx.falls.get(0)?.kind).toBe("collapse");
    expect([...fx.rubble.entries()]).toEqual([
      [1, "hoard"],
      [2, "perch"],
      [4, "gate"],
      [0, "nest"]
    ]);
    // Acorns out of the hoard, twigs and feathers out of the nest, splinters out of the gate.
    expect(fx.specks.some((speck) => speck.kind === "acorn" && speck.vx < 0)).toBe(true);
    expect(fx.specks.some((speck) => speck.kind === "feather")).toBe(true);
    expect(fx.specks.some((speck) => speck.kind === "twig")).toBe(true);
    expect(fx.specks.some((speck) => speck.kind === "splinter")).toBe(true);
    expect(fx.flights.map((flight) => flight.kind)).toEqual(["flee", "squawk", "star"]);
    expect(fx.sprung.has(1)).toBe(true);
    expect(fx.stars).toEqual([true, false, false]);
    expect(new Set(fx.cues)).toEqual(new Set(["crumble", "coin", "squeak", "caw", "pop", "star"]));
  });

  it("plays each fall once and never loops: its pictures in order, then the rubble, which stays", () => {
    const fx = newFx(false);
    takeEvents(fx, [{ tick: 0, kind: "down", id: 3, structure: "wall", x: 103, y: 60 }], 2, STRUCTURES);
    const fall = fx.falls.get(3)!;
    const frames = [2, 2.12, 2.22, 2.32, 2.45].map((now) => fallFrame(fall, now));
    expect(frames).toEqual([0, 1, 2, 3, 4]);
    expect(fallFrame(fall, 2.5)).toBeNull();
    expect(fallFrame(fall, 60)).toBeNull();
    // Long after, the rubble is still there; and with the specks settled and spent, nothing is moving.
    for (let k = 0; k < 120; k++) stepFx(fx, 1 / 30, 2 + k / 30);
    expect(fx.rubble.get(3)).toBe("wall");
    expect(moving(fx, 10)).toBe(false);
  });

  it("clears a perch's rubble when the watch-crow's second flight mans it again", () => {
    const fx = newFx(false);
    takeEvents(fx, [{ tick: 0, kind: "down", id: 2, structure: "perch", x: 102, y: 60 }], 0, STRUCTURES);
    takeEvents(fx, [{ tick: 0, kind: "down", id: 2, structure: "perch", x: 102, y: 60 }, { tick: 9, kind: "manned", id: 2, x: 102, y: 60 }], 3, STRUCTURES);
    expect(fx.rubble.has(2)).toBe(false);
    expect(fx.falls.has(2)).toBe(false);
    expect(fx.flights.some((flight) => flight.kind === "manned")).toBe(true);
  });

  it("with motion kept still, shows every event at its end: rubble at once, no specks, no flights", () => {
    const fx = newFx(true);
    takeEvents(
      fx,
      [
        { tick: 0, kind: "spill", id: 1, x: 101, y: 60, loot: 0.2 },
        { tick: 0, kind: "down", id: 1, structure: "hoard", x: 101, y: 60 },
        { tick: 0, kind: "flee", id: 2, x: 102, y: 60 },
        { tick: 0, kind: "down", id: 2, structure: "perch", x: 102, y: 60 },
        { tick: 1, kind: "pit", zone: 0, x: 50, y: 64, took: 2 },
        { tick: 2, kind: "star", star: 1 }
      ],
      5,
      STRUCTURES
    );
    expect(fallFrame(fx.falls.get(1)!, 5)).toBeNull();
    expect(fallFrame(fx.falls.get(2)!, 5)).toBeNull();
    expect(fx.rubble.get(1)).toBe("hoard");
    expect(fx.specks).toHaveLength(0);
    expect(fx.flights).toHaveLength(0);
    expect(fx.sprung.has(0)).toBe(true);
    expect(fx.stars).toEqual([false, true, false]);
    expect(moving(fx, 5)).toBe(false);
  });

  it("reads a real raid's log through to its end, and keeps the rubble of everything that fell", () => {
    const setup = { n: 4, king: false, capacity: 13, level: 4, kinds: ["sprout", "slinger", "mole"] as const, fast: false, squad: { groups: [group({ sprout: 9, slinger: 2, mole: 1 }, 0)] } };
    const battle = new Battle({ ...setup, kinds: [...setup.kinds] });
    const fx = newFx(false);
    let now = 0;
    while (!battle.over) {
      battle.step(BATTLE_TICK);
      now += BATTLE_TICK;
      takeEvents(fx, battle.events, now, battle.structures);
      stepFx(fx, BATTLE_TICK, now);
    }
    const fallen = battle.structures.filter((entry) => entry.hp <= 0).map((entry) => entry.id);
    expect(fallen.length).toBeGreaterThan(0);
    for (const id of fallen) expect(fx.rubble.has(id), `rubble of ${id}`).toBe(true);
    expect(fx.read).toBe(battle.events.length);
  });
});
