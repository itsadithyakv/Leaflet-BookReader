/**
 * Painting a raid's field (the Magpie Lands, 2026-10-24; raids-plan.md, section 5), onto two canvases a pixel to
 * each of the field's, laid one over the other and scaled up by the page a whole number of device pixels at a time
 * (`raidLayout.ts`), hard-edged:
 *
 * - the ground: the magpies' grass, the camp's trampled earth, each approach's path with the flag of its colour, the
 *   thorns and the ford. Painted once for a raid (again only when the field is turned), never per frame;
 * - what moves: the stronghold's pieces (cracked as they are hurt, falling their own way, then rubble), the scouts,
 *   the champion, the pebbles, the specks and flights of `raidFx.ts`, and health as pips over whatever is hurt.
 *   Painted only while something moves, at about thirty a second (`frameGate`).
 *
 * Every picture is a sprite the art draws once and keeps (`gameArt`); a fall's pictures are made once from the thing
 * standing (`fallSheet`), and a hit's white flash once from its picture (`flashOf`). Nothing is drawn a pixel at a time
 * in a frame but the specks. Nothing shakes: a hit is a flash and a puff of dust, and the pieces never move but to fall.
 */
import { BATTLE_TICK, type Battle, type Structure, type Unit } from "../../../../pip/base/battle";
import type { Zone } from "../../../../pip/base/approaches";
import type { GameArt, GameSprite } from "../gameArt";
import { FALL_FRAMES, RUBBLE_VARIANT, fallFrame, type FallKind, type FxState } from "./raidFx";
import { toPicture, type FieldView, type Orient } from "./raidLayout";

/** What the field shows besides the battle itself: the scout's and the planner's marks, and the rally's targets. */
export type Marks = {
  /** Each perch's reach, as a dotted ring (scouting and planning). */
  reach: boolean;
  /** The approach picked out (the group being planned goes down it). */
  chosen: number | null;
  /** The structures a tap may pick (a rally, the hero's aim). */
  targets: readonly number[];
};
export const NO_MARKS: Marks = { reach: false, chosen: null, targets: [] };

/** What the field is a picture of. */
export type RaidScene = {
  battle: Battle;
  art: GameArt;
  fx: FxState;
  /** The pennant's colours: the stronghold's region (0 to 5). */
  region: number;
  /** 0 summer to 3 spring: the ground it is fought on. */
  season: number;
  marks: Marks;
};

/** Each approach's colour, by its place: the trail's gold, the ridge's sky, the hollow's rose (`raid-art.js` `FLAG_COLOURS`). */
export const APPROACH_COLOURS = ["#FFD23F", "#4FA8F0", "#F06A9E", "#7CCB5E"] as const;

// ---- pictures made once ---------------------------------------------------------------------------------------

const canvasOf = (w: number, h: number) => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
};

/** A picture's white silhouette, for the short flash of a hit. Made once a picture. */
const flashes = new WeakMap<CanvasImageSource, HTMLCanvasElement | null>();
export const flashOf = (sprite: GameSprite): HTMLCanvasElement | null => {
  if (flashes.has(sprite.image)) return flashes.get(sprite.image) ?? null;
  const made = canvasOf(sprite.w, sprite.h);
  if (made) {
    made.ctx.drawImage(sprite.image, 0, 0);
    made.ctx.globalCompositeOperation = "source-in";
    made.ctx.fillStyle = "#FFF6DF";
    made.ctx.fillRect(0, 0, sprite.w, sprite.h);
  }
  flashes.set(sprite.image, made?.canvas ?? null);
  return made?.canvas ?? null;
};

/** One picture of a fall, and where in it the thing's foot is. */
export type FallPicture = { image: HTMLCanvasElement; ax: number; ay: number };

/**
 * A fall's pictures, from the thing standing: turned over about its foot (a wall section, a perch), burst (a hoard),
 * sunk and spread (the nest, a friend's building), split and flattened (a gate). Drawn at the field's own pixels,
 * nearest pixel, so they stay as crisp as the rest. `side` is the way it goes over: 1 to the right, -1 the left.
 */
const sheets = new WeakMap<CanvasImageSource, Map<string, FallPicture[]>>();
const SHAPES: Readonly<Record<FallKind, ReadonlyArray<{ turn: number; sx: number; sy: number }>>> = {
  topple: [
    { turn: 0.18, sx: 1, sy: 1 },
    { turn: 0.5, sx: 1, sy: 0.96 },
    { turn: 0.95, sx: 1, sy: 0.9 },
    { turn: 1.35, sx: 1.04, sy: 0.7 },
    { turn: 1.5, sx: 1.08, sy: 0.45 }
  ],
  tip: [
    { turn: 0.12, sx: 1, sy: 1 },
    { turn: 0.32, sx: 1, sy: 1 },
    { turn: 0.62, sx: 1, sy: 0.98 },
    { turn: 0.98, sx: 1, sy: 0.94 },
    { turn: 1.32, sx: 1.02, sy: 0.8 },
    { turn: 1.52, sx: 1.04, sy: 0.55 }
  ],
  break: [
    { turn: -0.12, sx: 1.04, sy: 0.96 },
    { turn: 0.22, sx: 1.1, sy: 0.82 },
    { turn: 0.5, sx: 1.16, sy: 0.55 },
    { turn: 0.7, sx: 1.2, sy: 0.32 }
  ],
  burst: [
    { turn: 0, sx: 1.14, sy: 0.82 },
    { turn: 0, sx: 0.9, sy: 1.14 },
    { turn: 0, sx: 1.22, sy: 0.6 },
    { turn: 0, sx: 1.3, sy: 0.32 }
  ],
  collapse: [
    { turn: 0, sx: 1.03, sy: 0.9 },
    { turn: 0, sx: 1.07, sy: 0.74 },
    { turn: 0, sx: 1.11, sy: 0.58 },
    { turn: 0, sx: 1.15, sy: 0.42 },
    { turn: 0, sx: 1.18, sy: 0.28 }
  ]
};
export const fallSheet = (sprite: GameSprite, kind: FallKind, side: 1 | -1): FallPicture[] => {
  let kept = sheets.get(sprite.image);
  if (!kept) sheets.set(sprite.image, (kept = new Map()));
  const key = `${kind}|${side}`;
  const found = kept.get(key);
  if (found) return found;
  const made: FallPicture[] = [];
  const reach = Math.ceil(Math.hypot(sprite.w, sprite.h) * 1.3);
  for (const shape of SHAPES[kind].slice(0, FALL_FRAMES[kind])) {
    const room = canvasOf(reach * 2, reach + 4);
    if (!room) break;
    const ax = reach;
    const ay = reach;
    room.ctx.translate(ax, ay);
    room.ctx.rotate(shape.turn * side);
    room.ctx.scale(shape.sx, shape.sy);
    room.ctx.drawImage(sprite.image, -Math.round(sprite.w / 2), -sprite.h + 1);
    made.push({ image: room.canvas, ax, ay });
  }
  kept.set(key, made);
  return made;
};

// ---- the ground ---------------------------------------------------------------------------------------------------

const EARTH = ["#A8916A", "#9A845E", "#B9A27A", "#8C7650"];
const PATH = { rim: "#8C7650", bed: "#C4AE84", worn: "#D6C29A" };

/** Fills the field's pixels within `r` of a field point (on the picture, wherever the field is turned). */
const disc = (ctx: CanvasRenderingContext2D, orient: Orient, x: number, y: number, r: number) => {
  const at = toPicture({ orient }, x, y);
  const cx = Math.round(at.x);
  const cy = Math.round(at.y);
  const reach = Math.ceil(r);
  for (let dy = -reach; dy <= reach; dy++) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
};

/** Along a path of field points, a step at a time. */
const along = (path: ReadonlyArray<{ x: number; y: number }>, each: (x: number, y: number) => void) => {
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k];
    const b = path[k + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let s = 0; s <= steps; s++) each(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
  }
};

const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** The water of a ford across the trail: two blues, a light edge, ripples in rows. */
type Stretch = Extract<Zone, { x0: number }>;
const water = (ctx: CanvasRenderingContext2D, orient: Orient, zone: Stretch) => {
  for (let y = Math.round(zone.y0); y <= zone.y1; y++) {
    for (let x = Math.round(zone.x0); x <= zone.x1; x++) {
      // Ragged at its banks: the corners rounded off.
      const u = (x - (zone.x0 + zone.x1) / 2) / ((zone.x1 - zone.x0) / 2 + 0.5);
      const v = (y - (zone.y0 + zone.y1) / 2) / ((zone.y1 - zone.y0) / 2 + 0.5);
      if (u * u * 0.6 + v * v > 1.02 + (rand(x * 3 + y * 7) - 0.5) * 0.1) continue;
      const edge = u * u * 0.6 + v * v > 0.8;
      ctx.fillStyle = edge ? "#9CD8F0" : (x + y * 3) % 11 === 0 || (x * 2 + y) % 13 === 0 ? "#BDEBFF" : y % 4 === 0 ? "#3E8FD0" : "#4FA0DC";
      const at = toPicture({ orient }, x, y);
      ctx.fillRect(at.x, at.y, 1, 1);
    }
  }
};

/**
 * The ground for a raid, painted at the field's pixels: the magpies' ground (the art's own, turned with the field), a
 * trampled patch round the camp, each approach as a worn path with its flag where it begins, the thorns, the ford, and
 * where a pit is hidden (a careful eye sees the leaves). `chosen`, the approach picked out, is painted lighter.
 */
export const paintGround = (canvas: HTMLCanvasElement, view: Pick<FieldView, "orient" | "w" | "h">, scene: Pick<RaidScene, "battle" | "art" | "season">): void => {
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return;
  const { orient } = view;
  if (canvas.width !== view.w || canvas.height !== view.h) {
    canvas.width = view.w;
    canvas.height = view.h;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const { battle, art } = scene;
  const ground = art.sprite("battleground", 0, { variant: scene.season % 4 });
  if (ground) {
    if (orient === "wide") ctx.drawImage(ground.image, 0, 0);
    else {
      // Turned a quarter, as the field is: its left edge at the foot.
      ctx.save();
      ctx.translate(0, view.h);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(ground.image, 0, 0);
      ctx.restore();
    }
  } else {
    ctx.fillStyle = "#8AB05E";
    ctx.fillRect(0, 0, view.w, view.h);
  }
  // The camp's ground, trampled bare round the nest.
  const nest = battle.structures.find((entry) => entry.kind === "nest") ?? battle.structures[0];
  if (nest && !battle.setup.works) {
    for (let y = Math.floor(nest.y - 44); y <= nest.y + 44; y++) {
      for (let x = Math.floor(nest.x - 62); x <= nest.x + 62; x++) {
        const u = (x - nest.x) / 60;
        const v = (y - nest.y) / 42;
        const d = u * u + v * v + (rand(x * 12.9 + y * 78.2) - 0.5) * 0.18;
        if (d > 1) continue;
        const n = rand(x * 7.7 + y * 31.3 + 2);
        // Its edge dithered into the grass, every other pixel.
        if (d > 0.9 && (x + y) % 2 === 0) continue;
        ctx.fillStyle = d > 0.9 ? EARTH[1] : n > 0.93 ? EARTH[3] : n < 0.08 ? EARTH[2] : d > 0.6 ? EARTH[1] : EARTH[0];
        const at = toPicture({ orient }, x, y);
        ctx.fillRect(at.x, at.y, 1, 1);
      }
    }
  }
  // The approaches: a rim, a bed, a worn middle; the one picked out a little lighter.
  battle.approaches.forEach((approach) => {
    ctx.fillStyle = PATH.rim;
    along(approach.path, (x, y) => disc(ctx, orient, x, y, 5));
  });
  battle.approaches.forEach((approach) => {
    ctx.fillStyle = PATH.bed;
    along(approach.path, (x, y) => disc(ctx, orient, x, y, 4));
  });
  battle.approaches.forEach((approach) => {
    ctx.fillStyle = PATH.worn;
    let step = 0;
    along(approach.path, (x, y) => {
      if (step++ % 3 !== 0) disc(ctx, orient, x, y + ((step >> 2) % 2 ? 1 : -1), 0.6);
    });
  });
  // The hazards on the trail.
  for (const zone of battle.zones) {
    if (zone.kind === "pit") {
      const leaves = art.sprite("raidzone", 0, { variant: 1 });
      const at = toPicture({ orient }, zone.x, zone.y);
      if (leaves) ctx.drawImage(leaves.image, Math.round(at.x - leaves.w / 2), Math.round(at.y - leaves.h + 4));
    } else if (zone.kind === "water") water(ctx, orient, zone);
    else {
      const clump = art.sprite("raidzone", 0, { variant: 0 });
      for (let y = zone.y0; y <= zone.y1 - 4; y += 7) {
        for (let x = zone.x0 + ((y / 7) % 2 ? 4 : 0); x <= zone.x1 - 4; x += 9) {
          const at = toPicture({ orient }, x, y + 6);
          if (clump) ctx.drawImage(clump.image, Math.round(at.x - clump.w / 2), Math.round(at.y - clump.h));
        }
      }
    }
  }
  for (const zone of battle.zones) {
    if (zone.kind !== "water") continue;
    if (!("x0" in zone)) continue;
    const reeds = art.sprite("raidzone", 0, { variant: 3 });
    if (!reeds) continue;
    for (const [x, y] of [
      [zone.x0 + 2, zone.y0 - 1],
      [zone.x1 - 2, zone.y1 + 3],
      [zone.x1 - 6, zone.y0 - 2]
    ]) {
      const at = toPicture({ orient }, x, y);
      ctx.drawImage(reeds.image, Math.round(at.x - reeds.w / 2), Math.round(at.y - reeds.h));
    }
  }
  // Each approach's flag where it begins, in its colour.
  battle.approaches.forEach((approach, index) => {
    const flag = art.sprite("raidflag", 0, { variant: index % APPROACH_COLOURS.length });
    const start = approach.path[0];
    if (!flag || !start) return;
    const at = toPicture({ orient }, start.x + 3, start.y - 6);
    ctx.drawImage(flag.image, Math.round(at.x - flag.w / 2), Math.round(at.y - flag.h + 2));
  });
};

// ---- what moves -----------------------------------------------------------------------------------------------------

/** What the field remembers from one paint to the next, to see a thing hit or a perch throw. */
export type Looks = {
  hp: number[];
  hitAt: number[];
  dustAt: number[];
  cool: number[];
  threwAt: number[];
  unitHp: Map<number, number>;
  unitHitAt: Map<number, number>;
  /** Which way each scout faces: kept until it has clearly turned, so it never flickers. */
  facing: Map<number, boolean>;
  before: WeakMap<object, { x: number; y: number }>;
};
export const newLooks = (battle: Battle): Looks => ({
  hp: battle.structures.map((entry) => entry.hp),
  hitAt: battle.structures.map(() => -9),
  dustAt: battle.structures.map(() => -9),
  cool: battle.structures.map((entry) => entry.cool),
  threwAt: battle.structures.map(() => -9),
  unitHp: new Map(),
  unitHitAt: new Map(),
  facing: new Map(),
  before: new WeakMap()
});

/** A perch's tell: how long before it throws it winds up, and how long it is seen throwing. */
export const WIND_S = 0.35;
const THROW_S = 0.2;
const FLASH_S = 0.09;
/** At most so often a thing hit flashes, and puffs dust: a sprout at a wall strikes every step, and a flash then would strobe. */
const FLASH_EVERY = 0.45;
const DUST_EVERY = 0.35;

/** Remembers where each moving thing stood before the step under way, so it can be drawn part of the way on. */
export const remember = (looks: Looks, battle: Battle) => {
  for (const unit of battle.units) looks.before.set(unit, { x: unit.x, y: unit.y });
  if (battle.foe) looks.before.set(battle.foe, { x: battle.foe.x, y: battle.foe.y });
};

/**
 * What the steps just taken did, for the picture: a thing hit (its flash and its dust, now and then), a perch that has
 * just thrown. `still`: no flashes, no dust.
 */
export const notice = (looks: Looks, scene: RaidScene, now: number) => {
  const { battle, fx } = scene;
  battle.structures.forEach((entry, index) => {
    const had = looks.hp[index] ?? entry.hp;
    if (entry.hp < had && entry.hp > 0) {
      const share = (had - entry.hp) / Math.max(1, entry.max);
      if (!fx.still && now - looks.hitAt[index] > FLASH_EVERY && share > 0.05) looks.hitAt[index] = now;
      if (!fx.still && now - looks.dustAt[index] > DUST_EVERY && fx.specks.length < 120) {
        looks.dustAt[index] = now;
        fx.specks.push({ kind: "dust", x: entry.x + (rand(now * 31 + index) - 0.5) * entry.r, y: entry.y + entry.r * 0.4, z: 2, vx: (rand(now * 7 + index) - 0.5) * 16, vy: 0, vz: 14, age: 0, life: 0.45, colour: "#E4D6B0", bounces: 0 });
      }
    }
    looks.hp[index] = entry.hp;
    if (entry.every > 0 && entry.cool > (looks.cool[index] ?? 0) + 0.05) looks.threwAt[index] = now;
    looks.cool[index] = entry.cool;
  });
  for (const unit of battle.units) {
    const had = looks.unitHp.get(unit.id) ?? unit.hp;
    if (!fx.still && unit.hp < had - 1 && now - (looks.unitHitAt.get(unit.id) ?? -9) > 0.3) looks.unitHitAt.set(unit.id, now);
    looks.unitHp.set(unit.id, unit.hp);
  }
};

const UNIT_ART: Record<Unit["kind"], string> = { sprout: "scout", slinger: "slinger", mole: "mole", bomber: "puffcap", hero: "hero" };
/** The picture's frame for walking and for striking: eight and twelve a second. */
const WALK_FPS = 8;
const STRIKE_FPS = 12;

type Thing = { y: number; draw: () => void };

/** A sprite stood with its foot at a picture point, whole pixels, turned to face left if asked. */
const stand = (ctx: CanvasRenderingContext2D, image: CanvasImageSource, w: number, h: number, x: number, y: number, flip = false) => {
  const left = Math.round(x - w / 2);
  const top = Math.round(y - h);
  if (!flip) {
    ctx.drawImage(image, left, top);
    return;
  }
  ctx.save();
  ctx.translate(left + w, top);
  ctx.scale(-1, 1);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
};

/** Health as pips over what is hurt: so many whole ones, the rest empty. */
const pips = (ctx: CanvasRenderingContext2D, x: number, y: number, share: number, count: number, ours: boolean) => {
  const filled = Math.max(1, Math.ceil(share * count - 1e-6));
  const wide = count * 3 - 1;
  const left = Math.round(x - wide / 2);
  const top = Math.round(y);
  ctx.fillStyle = "#1A1A22";
  ctx.fillRect(left - 1, top - 1, wide + 2, 4);
  for (let k = 0; k < count; k++) {
    ctx.fillStyle = k < filled ? (ours ? "#7BE07B" : "#FF8A5C") : "#4A3A3A";
    ctx.fillRect(left + k * 3, top, 2, 2);
  }
};

/** A dotted ring of field units about a field point, on the picture. */
const ring = (ctx: CanvasRenderingContext2D, orient: Orient, x: number, y: number, r: number, colour: string, every = 4) => {
  const steps = Math.max(16, Math.round(r * 2.4));
  ctx.fillStyle = colour;
  for (let k = 0; k < steps; k++) {
    if (k % every >= every / 2) continue;
    const angle = (k / steps) * Math.PI * 2;
    const at = toPicture({ orient }, x + Math.cos(angle) * r, y + Math.sin(angle) * r);
    ctx.fillRect(Math.round(at.x), Math.round(at.y), 1, 1);
  }
};

/** How a structure is drawn standing: its sprite (and frame), by kind. */
const standingSprite = (scene: RaidScene, entry: Structure, now: number, looks: Looks, orient: Orient): GameSprite | null => {
  const { art, battle, fx } = scene;
  const rank = fx.cracks.get(entry.id) ?? 0;
  if (entry.look) return art.sprite(entry.look.name, 0, { variant: entry.look.variant });
  switch (entry.kind) {
    case "nest":
      return battle.setup.king ? art.sprite("king", 0) : art.sprite("raidnest", 0, { variant: scene.region, rank });
    case "hoard":
      return art.sprite("raidhoard", 0, { rank });
    case "perch": {
      const hushed = entry.hushed !== undefined && entry.hushed > battle.time;
      const threw = now - (looks.threwAt[entry.id] ?? -9) < THROW_S;
      const near = !hushed && entry.cool > 0 && entry.cool <= WIND_S && battle.units.some((unit) => unit.hp > 0 && Math.hypot(unit.x - entry.x, unit.y - entry.y) <= entry.range + entry.r + 4);
      return art.sprite("raidperch", threw ? 2 : near ? 1 : 0, { variant: entry.crow ? 1 : 0, rank });
    }
    case "wall":
      // Across the picture where the field is turned upright, up it where it lies wide.
      return art.sprite("raidwall", 0, { variant: (entry.gate === "main" ? 1 : entry.gate === "postern" ? 2 : 0) + (orient === "wide" ? 3 : 0), rank });
    default:
      return art.sprite("raidrubble", 0, { variant: RUBBLE_VARIANT.building });
  }
};

/** What a fallen structure leaves, drawn. */
const rubbleSprite = (scene: RaidScene, entry: Structure): GameSprite | null => {
  const kind = scene.fx.rubble.get(entry.id);
  if (kind === "king" || (!kind && entry.kind === "nest" && scene.battle.setup.king)) return scene.art.sprite("kingdown", 0);
  const variant = kind ? RUBBLE_VARIANT[kind] : entry.look ? RUBBLE_VARIANT.building : entry.kind === "wall" ? (entry.gate ? RUBBLE_VARIANT.gate : RUBBLE_VARIANT.wall) : entry.kind === "perch" ? RUBBLE_VARIANT.perch : entry.kind === "hoard" ? RUBBLE_VARIANT.hoard : entry.kind === "nest" ? RUBBLE_VARIANT.nest : RUBBLE_VARIANT.building;
  return scene.art.sprite("raidrubble", 0, { variant });
};

/** Where a structure's foot is on the picture: a stronghold's pieces stand a little forward of their middle. */
const footOf = (orient: Orient, entry: Structure) => {
  const at = toPicture({ orient }, entry.x, entry.y);
  return { x: at.x, y: at.y + (entry.look ? 0 : Math.round(entry.r * 0.45)) };
};

/**
 * Paints what moves onto the picture's canvas at `now` (the screen's clock, seconds). `blend`: how far into the
 * step under way the battle is, for the scouts drawn part way on.
 */
export const paintLive = (ctx: CanvasRenderingContext2D, view: Pick<FieldView, "orient" | "w" | "h">, scene: RaidScene, looks: Looks, now: number, blend: number): void => {
  const { orient } = view;
  const { battle, art, fx, marks } = scene;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, view.w, view.h);
  const still = fx.still;
  const at = (thing: { x: number; y: number }) => {
    const from = looks.before.get(thing);
    return from && !battle.over ? { x: from.x + (thing.x - from.x) * blend, y: from.y + (thing.y - from.y) * blend } : { x: thing.x, y: thing.y };
  };

  // On the ground: the pits that have given way.
  battle.zones.forEach((zone, index) => {
    if (zone.kind !== "pit" || !fx.sprung.has(index)) return;
    const hole = art.sprite("raidzone", 0, { variant: 2 });
    const spot = toPicture({ orient }, zone.x, zone.y);
    if (hole) ctx.drawImage(hole.image, Math.round(spot.x - hole.w / 2), Math.round(spot.y - hole.h + 4));
  });
  // The approach picked out: its path dotted bright.
  if (marks.chosen !== null && battle.approaches[marks.chosen]) {
    ctx.fillStyle = APPROACH_COLOURS[marks.chosen % APPROACH_COLOURS.length];
    let step = 0;
    along(battle.approaches[marks.chosen].path, (x, y) => {
      if (step++ % 4 < 2) {
        const spot = toPicture({ orient }, x, y);
        ctx.fillRect(Math.round(spot.x), Math.round(spot.y), 1, 1);
      }
    });
  }
  // Each perch's reach, scouted.
  if (marks.reach) {
    for (const entry of battle.structures) {
      if (entry.hp <= 0 || entry.range <= 0) continue;
      ring(ctx, orient, entry.x, entry.y, entry.range + entry.r, entry.kind === "nest" ? "#FFB08A" : entry.crow ? "#C9B6FF" : "#FFF6C2", 6);
    }
  }
  // What a tap may pick: a ring about each.
  for (const id of marks.targets) {
    const entry = battle.structures[id];
    if (entry && entry.hp > 0) ring(ctx, orient, entry.x, entry.y, entry.r + 4, "#FFFFFF", 2);
  }

  const things: Thing[] = [];
  const bars: Array<() => void> = [];
  for (const entry of battle.structures) {
    if (entry.flat || entry.traps !== undefined) continue;
    const foot = footOf(orient, entry);
    const fall = fx.falls.get(entry.id);
    const frame = fall ? fallFrame(fall, now) : null;
    if (entry.hp <= 0 || (fall && frame === null && fx.rubble.has(entry.id))) {
      if (fall && frame !== null) {
        const source = standingSprite(scene, { ...entry, hp: entry.max }, now, looks, orient);
        const side: 1 | -1 = orient === "wide" ? 1 : entry.id % 2 ? 1 : -1;
        const picture = source ? fallSheet(entry.kind === "perch" && !entry.look ? (art.sprite("raidperch", 3, { variant: entry.crow ? 1 : 0 }) ?? source) : source, fall.kind, side)[frame] : null;
        if (picture) things.push({ y: foot.y, draw: () => ctx.drawImage(picture.image, Math.round(foot.x - picture.ax), Math.round(foot.y - picture.ay)) });
        continue;
      }
      const rubble = rubbleSprite(scene, entry);
      // Rubble lies flat: under everything still standing.
      if (rubble) things.push({ y: foot.y - 1000, draw: () => stand(ctx, rubble.image, rubble.w, rubble.h, foot.x, foot.y + 2) });
      continue;
    }
    const sprite = standingSprite(scene, entry, now, looks, orient);
    things.push({
      y: foot.y,
      draw: () => {
        if (!sprite) {
          ctx.fillStyle = "#5E3A1F";
          ctx.fillRect(Math.round(foot.x - entry.r), Math.round(foot.y - entry.r * 2), entry.r * 2, entry.r * 2);
          return;
        }
        stand(ctx, sprite.image, sprite.w, sprite.h, foot.x, foot.y);
        if (!still && now - (looks.hitAt[entry.id] ?? -9) < FLASH_S) {
          const white = flashOf(sprite);
          if (white) {
            ctx.globalAlpha = 0.75;
            stand(ctx, white, sprite.w, sprite.h, foot.x, foot.y);
            ctx.globalAlpha = 1;
          }
        }
        if (entry.hp < entry.max) {
          const count = entry.kind === "nest" ? 5 : entry.kind === "wall" ? 3 : 4;
          bars.push(() => pips(ctx, foot.x, foot.y - sprite.h - 3, entry.hp / entry.max, count, false));
        }
      }
    });
  }

  for (const unit of battle.units) {
    if (unit.hp <= 0) continue;
    const spot = at(unit);
    const picture = toPicture({ orient }, spot.x, spot.y);
    // Facing: where it is going, on the picture, kept until that is clearly the other way.
    const target = unit.target !== null ? battle.structures[unit.target] : null;
    const towards = target ? toPicture({ orient }, target.x, target.y).x - picture.x : 0;
    const was = looks.facing.get(unit.id) ?? true;
    const right = towards > 2 ? true : towards < -2 ? false : was;
    looks.facing.set(unit.id, right);
    things.push({
      y: picture.y,
      draw: () => {
        const name = UNIT_ART[unit.kind];
        const frame = Math.floor(now * (unit.busy ? STRIKE_FPS : WALK_FPS) + unit.id * 1.7);
        const sprite = art.sprite(name, frame, unit.kind === "hero" ? { variant: battle.setup.hero?.id ?? 0 } : {});
        if (!sprite) {
          ctx.fillStyle = unit.kind === "mole" ? "#6B4A2E" : "#4FBF5A";
          ctx.fillRect(Math.round(picture.x - 3), Math.round(picture.y - 7), 6, 7);
          return;
        }
        stand(ctx, sprite.image, sprite.w, sprite.h, picture.x, picture.y + 1, !right);
        if (!still && now - (looks.unitHitAt.get(unit.id) ?? -9) < FLASH_S) {
          const white = flashOf(sprite);
          if (white) {
            ctx.globalAlpha = 0.7;
            stand(ctx, white, sprite.w, sprite.h, picture.x, picture.y + 1, !right);
            ctx.globalAlpha = 1;
          }
        }
        if (unit.hp < unit.max) bars.push(() => pips(ctx, picture.x, picture.y - sprite.h - 2, unit.hp / unit.max, unit.kind === "hero" ? 4 : 3, true));
      }
    });
  }

  const foe = battle.foe;
  if (foe && foe.hp > 0) {
    const spot = at(foe);
    const picture = toPicture({ orient }, spot.x, spot.y);
    things.push({
      y: picture.y,
      draw: () => {
        const sprite = art.sprite("champion", Math.floor(now * (foe.busy ? STRIKE_FPS : WALK_FPS)), { variant: foe.variant });
        if (!sprite) return;
        const faces = orient === "wide" ? foe.left : foe.home.y > spot.y;
        stand(ctx, sprite.image, sprite.w, sprite.h, picture.x, picture.y + 1, !faces);
        if (foe.hp < foe.max) bars.push(() => pips(ctx, picture.x, picture.y - sprite.h - 2, foe.hp / foe.max, 5, false));
      }
    });
  }

  things.sort((a, b) => a.y - b.y);
  for (const thing of things) thing.draw();

  // The pebbles in the air, each in a small arc from its thrower's hand to its mark.
  const pebble = art.sprite("pebble", 0);
  for (const shot of battle.shots) {
    const t = Math.min(1, shot.t + (battle.over ? 0 : blend * BATTLE_TICK * 5));
    const from = shot.ours ? { x: shot.x0, y: shot.y0 + 8, z: 8 } : { x: shot.x0, y: shot.y0 + 17, z: 17 };
    const to = shot.ours ? { x: shot.x1, y: shot.y1 + 8, z: 8 } : { x: shot.x1, y: shot.y1 + 6, z: 6 };
    const spot = toPicture({ orient }, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    const z = from.z + (to.z - from.z) * t + Math.sin(t * Math.PI) * 6;
    if (pebble) ctx.drawImage(pebble.image, Math.round(spot.x - 2), Math.round(spot.y - z - 2));
    else {
      ctx.fillStyle = "#E8E8F0";
      ctx.fillRect(Math.round(spot.x), Math.round(spot.y - z), 2, 2);
    }
  }

  // Specks: dust, splinters, twigs, feathers, acorns.
  const acorn = art.sprite("acorn", 0);
  for (const speck of fx.specks) {
    const spot = toPicture({ orient }, speck.x, speck.y);
    const fade = speck.kind === "acorn" ? 1 : Math.max(0, 1 - speck.age / speck.life);
    if (fade <= 0) continue;
    ctx.globalAlpha = speck.kind === "dust" ? fade * 0.8 : fade;
    if (speck.kind === "acorn" && acorn) ctx.drawImage(acorn.image, 0, 0, acorn.w, acorn.h, Math.round(spot.x - 3), Math.round(spot.y - speck.z - 5), 6, 6);
    else {
      ctx.fillStyle = speck.colour;
      const long = speck.kind === "splinter" || speck.kind === "twig" ? 2 : 1;
      ctx.fillRect(Math.round(spot.x), Math.round(spot.y - speck.z), long, speck.kind === "dust" ? 2 : 1);
    }
  }
  ctx.globalAlpha = 1;

  // Flights: the sentry off its fallen perch (or back to it), the crow's squawk, a star, an order's flag.
  for (const flight of fx.flights) {
    const t = Math.max(0, Math.min(1, (now - flight.at) / flight.seconds));
    const base = toPicture({ orient }, flight.x, flight.y);
    if (flight.kind === "flee" || flight.kind === "manned") {
      const bird = art.sprite("magpie", Math.floor(now * 12));
      if (!bird) continue;
      // Up and away from the trail; or the reverse, coming in to land.
      const u = flight.kind === "flee" ? t : 1 - t;
      const away = orient === "wide" ? { x: 40, y: -10 } : { x: 12, y: -40 };
      const x = base.x + away.x * u * u;
      const y = base.y - 24 - 34 * u + away.y * u;
      ctx.globalAlpha = flight.kind === "flee" ? Math.min(1, (1 - t) * 3) : Math.min(1, t * 3 + 0.2);
      stand(ctx, bird.image, bird.w, bird.h, x, y, flight.kind === "flee" ? orient === "wide" : false);
      ctx.globalAlpha = 1;
    } else if (flight.kind === "squawk") {
      // A burst over the crow's perch: "!" in a paper bubble, up for a moment.
      const x = Math.round(base.x + 6);
      const y = Math.round(base.y - 40 - Math.min(1, t * 6) * 2);
      ctx.fillStyle = "#1A1A22";
      ctx.fillRect(x - 1, y - 1, 9, 10);
      ctx.fillStyle = "#FFF6DF";
      ctx.fillRect(x, y, 7, 8);
      ctx.fillStyle = "#C8453B";
      ctx.fillRect(x + 3, y + 1, 1, 4);
      ctx.fillRect(x + 3, y + 6, 1, 1);
    } else if (flight.kind === "star") {
      const x = Math.round(base.x);
      const y = Math.round(base.y - 40 - t * 12);
      ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
      const size = t < 0.15 ? 2 : 3;
      ctx.fillStyle = "#1A1A22";
      ctx.fillRect(x - size - 1, y - 1, size * 2 + 3, 3);
      ctx.fillRect(x - 1, y - size - 1, 3, size * 2 + 3);
      ctx.fillStyle = "#FFD23F";
      ctx.fillRect(x - size, y, size * 2 + 1, 1);
      ctx.fillRect(x, y - size, 1, size * 2 + 1);
      ctx.fillStyle = "#FFF6C2";
      ctx.fillRect(x, y, 1, 1);
      ctx.globalAlpha = 1;
    } else {
      const flag = art.sprite("raidflag", 0, { variant: 0 });
      if (!flag) continue;
      ctx.globalAlpha = t > 0.6 ? (1 - t) / 0.4 : 1;
      stand(ctx, flag.image, flag.w, flag.h, base.x, base.y - 26 + Math.round(Math.min(1, t * 5) * 4));
      ctx.globalAlpha = 1;
    }
  }

  for (const bar of bars) bar();
};
