import { describe, expect, it } from "vitest";
import { BATTLE_TICK, Battle } from "../../../../pip/base/battle";
import { group } from "../../../../pip/base/squad";
import type { GameArt } from "../gameArt";
import { FALL_SECONDS, newFx, stepFx, takeEvents } from "./raidFx";
import { groundBox, type FieldView } from "./raidLayout";
import { APPROACH_COLOURS, newLooks, notice, paintGround, paintLive, remember, unitArt, type RaidScene } from "./raidPaint";
import { KIND_ART, KINDS } from "./raidWords";

/**
 * The field as it is painted (raidPaint.ts), on a canvas that only keeps a note of what it was asked: a structure that
 * falls is drawn falling, then as rubble that stays; held still, as rubble at once; and the land is painted round the
 * field on its own pixel grid, not a framed box.
 */

/** A canvas's 2D context that notes each picture drawn (by the sprite it came from) and each rectangle filled. */
const recorder = () => {
  const drawn: string[] = [];
  /** Each picture drawn, and where its corner went. */
  const placed: Array<[string, number, number]> = [];
  let fills = 0;
  const ctx = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "drawImage")
          return (image: { name?: string }, x: number, y: number) => {
            drawn.push(image?.name ?? "?");
            placed.push([image?.name ?? "?", x, y]);
          };
        if (key === "fillRect") return () => void (fills += 1);
        return () => undefined;
      },
      set: () => true
    }
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, drawn, placed, fills: () => fills };
};
/** A context that notes how many little rectangles were filled in each colour, and where. */
const filled = () => {
  const counts = new Map<string, number>();
  const spots = new Map<string, string[]>();
  let style = "";
  const ctx = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "fillRect")
          return (x: number, y: number) => {
            counts.set(style, (counts.get(style) ?? 0) + 1);
            spots.set(style, [...(spots.get(style) ?? []), `${x},${y}`]);
          };
        if (key === "fillStyle") return style;
        return () => undefined;
      },
      set: (_target, key, value) => {
        if (key === "fillStyle") style = String(value);
        return true;
      }
    }
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, by: (colour: string) => counts.get(colour) ?? 0, at: (colour: string) => spots.get(colour) ?? [] };
};
/** Art whose every sprite is a named stand-in, so what was drawn can be read back. */
const art = {
  sprite: (name: string, _frame = 0, options: { variant?: number; rank?: number } = {}) => ({ image: { name: `${name}:${options.variant ?? 0}` }, w: 12, h: 12 })
} as unknown as GameArt;
const VIEW: Pick<FieldView, "orient" | "w" | "h"> = { orient: "wide", w: 240, h: 120 };

const fight = () =>
  new Battle({ n: 4, king: false, capacity: 13, level: 4, kinds: ["sprout", "slinger", "mole"], fast: false, squad: { groups: [group({ sprout: 9, slinger: 2, mole: 1 }, 0)] } });

/** Plays a battle to the first fall, painting as the screen does; returns the scene and the clock then. */
const toFirstFall = (still: boolean) => {
  const battle = fight();
  const fx = newFx(still);
  const looks = newLooks(battle);
  const scene: RaidScene = { battle, art, fx, region: 1, season: 0, marks: { reach: false, chosen: null, targets: [] } };
  let now = 0;
  while (!battle.over && !battle.events.some((event) => event.kind === "down")) {
    remember(looks, battle);
    battle.step(BATTLE_TICK);
    now += BATTLE_TICK;
    takeEvents(fx, battle.events, now, battle.structures);
    notice(looks, scene, now);
    stepFx(fx, BATTLE_TICK, now);
  }
  const down = battle.events.find((event) => event.kind === "down");
  if (!down || down.kind !== "down") throw new Error("nothing fell");
  return { battle, fx, looks, scene, now, id: down.id };
};

describe("the raid's field, painted", () => {
  it("draws a structure falling, then its rubble, which stays for the rest of the raid", () => {
    const { fx, looks, scene, now, id } = toFirstFall(false);
    expect(fx.rubble.has(id)).toBe(true);
    const rubble = (drawn: string[]) => drawn.filter((name) => name.startsWith("raidrubble") || name.startsWith("kingdown")).length;
    // Falling: not yet the rubble.
    const falling = recorder();
    paintLive(falling.ctx, VIEW, scene, looks, now + 0.01, 1);
    expect(rubble(falling.drawn)).toBe(0);
    // Once the fall is over, the rubble; and still there long after.
    for (const at of [now + 1, now + 20]) {
      const after = recorder();
      paintLive(after.ctx, VIEW, scene, looks, at, 1);
      expect(rubble(after.drawn), `rubble at ${at}`).toBeGreaterThan(0);
    }
    expect(FALL_SECONDS.collapse).toBeLessThan(1);
  });

  it("held still (reduced motion, the lightest tier), shows the rubble the moment a thing falls", () => {
    const { looks, scene, now } = toFirstFall(true);
    const at = recorder();
    paintLive(at.ctx, VIEW, scene, looks, now, 1);
    expect(at.drawn.some((name) => name.startsWith("raidrubble"))).toBe(true);
    expect(scene.fx.specks).toHaveLength(0);
  });

  it("puts health over what is hurt only", () => {
    const battle = fight();
    const scene: RaidScene = { battle, art, fx: newFx(true), region: 1, season: 0, marks: { reach: false, chosen: null, targets: [] } };
    const whole = recorder();
    paintLive(whole.ctx, VIEW, scene, newLooks(battle), 0, 1);
    battle.structures[1].hp = battle.structures[1].max / 2;
    const hurt = recorder();
    paintLive(hurt.ctx, VIEW, scene, newLooks(battle), 0, 1);
    // A backing and four pips more for the one hurt hoard or perch (three for a wall, five for the nest).
    expect(hurt.fills() - whole.fills()).toBeGreaterThanOrEqual(4);
  });

  it("paints the land round the field out to the room's edges, on the field's own pixels", () => {
    const view: FieldView = { orient: "wide", w: 240, h: 120, css: 4, backing: 4, crisp: true, left: 144, top: 72 };
    const box = groundBox(view, 1248, 626);
    expect(box).toMatchObject({ ox: 36, oy: 18, w: 36 + 240 + 36, h: 18 + 120 + 19 });
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
    const sized = { width: 0, height: 0 };
    const { ctx, drawn, fills } = recorder();
    const canvas = { getContext: () => ctx, set width(value: number) { sized.width = value; }, get width() { return sized.width; }, set height(value: number) { sized.height = value; }, get height() { return sized.height; } } as unknown as HTMLCanvasElement;
    paintGround(canvas, view, { battle: fight(), art, season: 1, region: 1 }, box);
    expect(sized).toEqual({ width: box.w, height: box.h });
    // The region's woods (its own two pieces of the map's land) stand round it, and the field's ground in the middle.
    expect(drawn.filter((name) => name === "landbit:2" || name === "landbit:3").length).toBeGreaterThan(4);
    expect(drawn).toContain("battleground:1");
    expect(fills()).toBeGreaterThan(box.h);
  });

  it("draws each kind as the raid's own scout, the very picture the planner and the chips show", () => {
    const battle = fight();
    for (let k = 0; k < 60; k++) battle.step(BATTLE_TICK);
    const scene: RaidScene = { battle, art, fx: newFx(true), region: 1, season: 0, marks: { reach: false, chosen: null, targets: [] } };
    const { ctx, drawn } = recorder();
    paintLive(ctx, VIEW, scene, newLooks(battle), 1, 1);
    for (const kind of KINDS) expect(unitArt(kind, 0)).toMatchObject(KIND_ART[kind]);
    const out = new Set(battle.units.filter((unit) => unit.hp > 0 && unit.kind !== "hero").map((unit) => unit.kind as (typeof KINDS)[number]));
    expect([...out].sort()).toEqual(["mole", "slinger", "sprout"]);
    for (const kind of out) expect(drawn, kind).toContain(`${KIND_ART[kind].name}:${KIND_ART[kind].variant}`);
    // The four kinds, four pictures.
    expect(new Set(KINDS.map((kind) => KIND_ART[kind].variant)).size).toBe(4);
    expect(drawn.some((name) => name.startsWith("scout:") || name.startsWith("slinger:") || name.startsWith("puffcap:"))).toBe(false);
  });

  it("rings each scout's feet in its group's colour, the colour of its path's flag and its chip", () => {
    const battle = new Battle({
      n: 4,
      king: false,
      capacity: 13,
      level: 4,
      kinds: ["sprout", "slinger", "mole"],
      fast: false,
      squad: { groups: [group({ sprout: 5 }, 0), group({ sprout: 4 }, 1)] }
    });
    for (let k = 0; k < 30; k++) battle.step(BATTLE_TICK);
    const scene: RaidScene = { battle, art, fx: newFx(true), region: 1, season: 0, marks: { reach: false, chosen: null, targets: [] } };
    const fills = filled();
    paintLive(fills.ctx, VIEW, scene, newLooks(battle), 1, 1);
    for (const band of battle.bands) {
      const colour = APPROACH_COLOURS[band.via % APPROACH_COLOURS.length];
      const out = battle.units.filter((unit) => unit.hp > 0 && unit.band !== undefined && battle.bands[unit.band] === band).length;
      expect(out, "scouts out").toBeGreaterThan(0);
      // Eight strokes of the colour to a ring.
      expect(fills.by(colour), colour).toBeGreaterThanOrEqual(out * 8);
    }
  });

  it("draws a scout where it stands at every frame: nothing twitches while the battle stands still", () => {
    const battle = fight();
    for (let k = 0; k < 40; k++) battle.step(BATTLE_TICK);
    const scene: RaidScene = { battle, art, fx: newFx(true), region: 1, season: 0, marks: { reach: false, chosen: null, targets: [] } };
    const looks = newLooks(battle);
    const at = (now: number) => {
      const { ctx, placed } = recorder();
      paintLive(ctx, VIEW, scene, looks, now, 1);
      return placed.filter(([name]) => name.startsWith("raidunit")).map(([, x, y]) => `${x},${y}`);
    };
    const first = at(2);
    expect(first.length).toBeGreaterThan(0);
    for (const now of [2.05, 2.4, 3.1]) expect(at(now)).toEqual(first);
  });

  it("paints the ford calm: its ripples drift only while the fight goes on, and lie still otherwise", () => {
    const ford = new Battle({ n: 7, king: false, capacity: 13, level: 4, kinds: ["sprout"], fast: false, squad: { groups: [group({ sprout: 6 }, 0)] } });
    expect(ford.zones.some((zone) => zone.kind === "water")).toBe(true);
    const ripplesAt = (still: boolean, now: number) => {
      const scene: RaidScene = { battle: ford, art, fx: newFx(still), region: 2, season: 0, marks: { reach: false, chosen: null, targets: [] } };
      const fills = filled();
      paintLive(fills.ctx, VIEW, scene, newLooks(ford), now, 1);
      return fills.at("#D6F2FF").join(" ");
    };
    expect(ripplesAt(false, 0.1)).not.toEqual(ripplesAt(false, 0.6));
    expect(ripplesAt(true, 0.1)).toEqual(ripplesAt(true, 0.6));
    expect(ripplesAt(true, 0.1).length).toBeGreaterThan(0);
  });

  it("flags each path again where it comes into view, when the view leaves its start out", () => {
    const battle = fight();
    const flags = (edge: RaidScene["edge"]) => {
      const sized = { width: 0, height: 0 };
      const { ctx, drawn } = recorder();
      const canvas = { getContext: () => ctx, set width(value: number) { sized.width = value; }, get width() { return sized.width; }, set height(value: number) { sized.height = value; }, get height() { return sized.height; } } as unknown as HTMLCanvasElement;
      paintGround(canvas, VIEW, { battle, art, season: 0, region: 1, edge });
      return drawn.filter((name) => name.startsWith("raidflag")).length;
    };
    expect(flags(null)).toBe(battle.approaches.length);
    expect(flags({ x0: 40, x1: 240, y0: 0, y1: 120 })).toBe(battle.approaches.length * 2);
  });
});
