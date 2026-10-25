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
import { FIELD_H, FIELD_W } from "../../../../pip/base/field";
import { BATTLE_GRASS } from "../../../../pip/base-art.js";
import type { GameArt, GameSprite } from "../gameArt";
import { FALL_FRAMES, RUBBLE_VARIANT, fallFrame, type FallKind, type FxState } from "./raidFx";
import { toField, toPicture, type FieldView, type GroundBox, type Orient } from "./raidLayout";
import { KIND_ART } from "./raidWords";

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
  /**
   * The part of the field the room shows where the view is framed on the stronghold (field points): a path whose start
   * is cropped off gets its flag again where it comes into view, so it still reads as coming in from the edge.
   */
  edge?: { x0: number; x1: number; y0: number; y1: number } | null;
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

/** Between two colours (`#rrggbb`), as the art mixes them. */
const mixHex = (a: string, b: string, t: number) => {
  const part = (colour: string, at: number) => parseInt(colour.slice(at, at + 2), 16);
  return "#" + [1, 3, 5].map((at) => Math.round(part(a, at) + (part(b, at) - part(a, at)) * t).toString(16).padStart(2, "0")).join("");
};

/**
 * The water of a ford across the trail (2026-10-25: it was speckled pixel by pixel in four blues with a ragged bank, and
 * read as a noisy blob). Now a pool with a clean edge: a sandy bank, a light rim, one blue deepening toward the middle
 * in two bands, and nothing else; its few ripples are the live picture's (`ripples`), so they can move.
 */
type Stretch = Extract<Zone, { x0: number }>;
const WATER = { bank: "#D9C68E", rim: "#9FDAF2", shallow: "#5FAEE4", deep: "#4596D6" };
/** How far a point of the ford is from its middle, 0 there and 1 at its bank: a rounded box, not an oval, so it fills its stretch. */
const fordReach = (zone: Stretch, x: number, y: number) => {
  const u = Math.abs(x + 0.5 - (zone.x0 + zone.x1 + 1) / 2) / ((zone.x1 - zone.x0 + 1) / 2);
  const v = Math.abs(y + 0.5 - (zone.y0 + zone.y1 + 1) / 2) / ((zone.y1 - zone.y0 + 1) / 2);
  return Math.pow(Math.pow(u, 4) + Math.pow(v, 4), 1 / 4);
};
const water = (ctx: CanvasRenderingContext2D, orient: Orient, zone: Stretch) => {
  for (let y = Math.floor(zone.y0) - 1; y <= zone.y1 + 1; y++) {
    for (let x = Math.floor(zone.x0) - 1; x <= zone.x1 + 1; x++) {
      const d = fordReach(zone, x, y);
      if (d > 1.08) continue;
      ctx.fillStyle = d > 0.97 ? WATER.bank : d > 0.88 ? WATER.rim : d > 0.6 ? WATER.shallow : WATER.deep;
      const at = toPicture({ orient }, x, y);
      ctx.fillRect(at.x, at.y, 1, 1);
    }
  }
};

/**
 * The ford's ripples, on the live picture: a few short pale strokes on the water, each drifting a pixel to and fro
 * about once in two seconds, not together. Still (reduced motion, the lightest tier, a still field), they lie still.
 */
const RIPPLE_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [0.22, 0.3],
  [0.62, 0.22],
  [0.4, 0.55],
  [0.78, 0.6],
  [0.28, 0.78],
  [0.6, 0.84]
];
export const ripples = (ctx: CanvasRenderingContext2D, orient: Orient, zone: Stretch, now: number, still: boolean) => {
  ctx.fillStyle = "#D6F2FF";
  RIPPLE_SPOTS.forEach(([u, v], index) => {
    const shift = still ? 0 : Math.round(Math.sin(now * Math.PI + index * 1.9));
    const x = Math.round(zone.x0 + (zone.x1 - zone.x0) * u) + (orient === "wide" ? shift : 0);
    const y = Math.round(zone.y0 + (zone.y1 - zone.y0) * v) + (orient === "wide" ? 0 : shift);
    if (fordReach(zone, x, y) > 0.7) return;
    // Level on the picture, whichever way the field is turned.
    const at = toPicture({ orient }, x, y);
    ctx.fillRect(Math.round(at.x) - 1, Math.round(at.y), 3, 1);
  });
};

/**
 * A thorn hedge across the trail (2026-10-26: a patch of dark ground under dark clumps, it read as one dark block, not
 * as brambles). Now the grass shows through all of it: only a scatter of its own darker blades says where the hedge's
 * ground is. On it, brambles (`raidzone` 0 and 4, the second also turned about) in staggered rows with grass between
 * every one, and fallen canes, each with a thorn, in the gaps: the canes' pinks, the pale thorns and the fruit read as
 * bramble on the green, and a thing that will hold and scratch whoever goes through.
 */
const BRAMBLES = [0, 4] as const;
const FALLEN = "#6E2A3C";
export const HEDGE_GROUND = "#5E7032";
const hedge = (ctx: CanvasRenderingContext2D, orient: Orient, zone: Stretch, art: GameArt) => {
  for (let y = Math.floor(zone.y0); y <= zone.y1; y++) {
    for (let x = Math.floor(zone.x0); x <= zone.x1; x++) {
      // Its own ground: one blade in four darker, and none at all toward its rim, so it fades into the grass.
      if (fordReach(zone, x, y) > 0.92 || (x + y * 2) % 4 !== 0 || rand(x * 3.7 + y * 11.1) < 0.35) continue;
      ctx.fillStyle = HEDGE_GROUND;
      const at = toPicture({ orient }, x, y);
      ctx.fillRect(at.x, at.y, 1, 1);
    }
  }
  // Fallen canes in the gaps between the rows: a short dark stroke, a thorn on it.
  for (let row = 0, y = zone.y0 + 4; y <= zone.y1 - 2; row++, y += 9) {
    for (let x = zone.x0 + (row % 2 ? 3 : 9); x <= zone.x1 - 3; x += 14) {
      const at = toPicture({ orient }, x, y);
      const px = Math.round(at.x);
      const py = Math.round(at.y);
      ctx.fillStyle = FALLEN;
      ctx.fillRect(px, py, 3, 1);
      ctx.fillRect(px + 3, py - 1, 1, 1);
      ctx.fillStyle = "#FFF1CF";
      ctx.fillRect(px + 1, py - 1, 1, 1);
    }
  }
  // The brambles, the back rows first, with the grass under each arch.
  const drawn: Array<{ x: number; y: number; variant: number; flip: boolean }> = [];
  for (let row = 0, y = zone.y0 + 8; y <= zone.y1 + 4; row++, y += 9) {
    for (let x = zone.x0 + (row % 2 ? 10 : 3), k = 0; x <= zone.x1 - 1; x += 14, k++) {
      const at = toPicture({ orient }, x, y);
      drawn.push({ x: at.x, y: at.y, variant: BRAMBLES[(row + k) % 2], flip: (row * 3 + k) % 3 === 1 });
    }
  }
  drawn.sort((a, b) => a.y - b.y);
  for (const bush of drawn) {
    const sprite = art.sprite("raidzone", 0, { variant: bush.variant });
    if (sprite) stand(ctx, sprite.image, sprite.w, sprite.h, bush.x, bush.y, bush.flip);
  }
};

/** Which pieces of the map's land (`landbit`) grow round a stronghold of each region: the region's own two. */
const WOODS: ReadonlyArray<readonly number[]> = [[0, 1, 0], [2, 3, 1], [4, 5, 1], [6, 7, 6], [8, 9, 8], [11, 10, 11]];

/**
 * The land round the field, out to the room's edges, so the stronghold stands in the open and not in a box: the
 * field's own grass carried on (its colour by its height on the field, its flecks and tufts), and further out the
 * region's woods, as the map draws them. A pixel grid with the field's: `box` places the field in it.
 */
const paintLand = (ctx: CanvasRenderingContext2D, orient: Orient, box: GroundBox, art: GameArt, season: number, region: number) => {
  const S = BATTLE_GRASS[((season % 4) + 4) % 4] ?? BATTLE_GRASS[0];
  const fieldW = orient === "wide" ? FIELD_W : FIELD_H;
  const fieldH = orient === "wide" ? FIELD_H : FIELD_W;
  const inField = (px: number, py: number) => px >= box.ox && px < box.ox + fieldW && py >= box.oy && py < box.oy + fieldH;
  // The grass's colour runs with the field's height (down the picture wide, across it turned): a row or column at a time.
  const shade = (fieldY: number) => mixHex(S.grass[0], S.grass[1], Math.max(0, Math.min(1, fieldY / (FIELD_H - 1))));
  if (orient === "wide") {
    for (let py = 0; py < box.h; py++) {
      ctx.fillStyle = shade(py - box.oy);
      ctx.fillRect(0, py, box.w, 1);
    }
  } else {
    for (let px = 0; px < box.w; px++) {
      ctx.fillStyle = shade(px - box.ox);
      ctx.fillRect(px, 0, 1, box.h);
    }
  }
  // Its flecks, as the field's own (the same scatter, by the field's own points).
  ctx.fillStyle = S.grass[2];
  for (let py = 0; py < box.h; py++) {
    for (let px = 0; px < box.w; px++) {
      if (inField(px, py)) continue;
      const at = toField({ orient }, px - box.ox, py - box.oy);
      if (rand(at.x * 7.7 + at.y * 31.3 + 2) > 0.975) ctx.fillRect(px, py, 1, 1);
    }
  }
  // Tufts, and the woods further out: a loose grid, each spot shaken, nothing within a few pixels of the field.
  const near = (px: number, py: number, margin: number) => px > box.ox - margin && px < box.ox + fieldW + margin && py > box.oy - margin && py < box.oy + fieldH + margin;
  const woods = WOODS[Math.max(0, Math.min(WOODS.length - 1, region))];
  const pieces: Array<{ x: number; y: number; variant: number }> = [];
  for (let gy = -8; gy < box.h + 16; gy += 10) {
    for (let gx = -8; gx < box.w + 8; gx += 13) {
      const seed = gx * 3.1 + gy * 17.3;
      const x = Math.round(gx + rand(seed) * 9);
      const y = Math.round(gy + rand(seed + 5) * 7);
      if (near(x, y, 2)) continue;
      const deep = !near(x, y, 16);
      if (deep && rand(seed + 9) < 0.5) pieces.push({ x, y, variant: woods[Math.floor(rand(seed + 11) * woods.length)] });
      else if (rand(seed + 13) < 0.5) {
        ctx.fillStyle = rand(seed + 17) < 0.2 ? S.tuft[0] : S.tuft[1];
        ctx.fillRect(x, y, 1, 1);
        ctx.fillRect(x + 1, y - 1, 1, 1);
        ctx.fillRect(x + 2, y, 1, 1);
      }
    }
  }
  pieces.sort((a, b) => a.y - b.y);
  for (const piece of pieces) {
    const sprite = art.sprite("landbit", 0, { variant: piece.variant });
    if (sprite) ctx.drawImage(sprite.image, Math.round(piece.x - sprite.w / 2), Math.round(piece.y - sprite.h));
  }
};

/**
 * The ground for a raid, painted at the field's pixels: the magpies' ground (the art's own, turned with the field), a
 * trampled patch round the camp, each approach as a worn path with its flag where it begins, the thorns, the ford, and
 * where a pit is hidden (a careful eye sees the leaves). `chosen`, the approach picked out, is painted lighter. With a
 * `box`, the canvas covers the room and the land round the field is painted too (`paintLand`).
 */
export const paintGround = (
  canvas: HTMLCanvasElement,
  view: Pick<FieldView, "orient" | "w" | "h">,
  scene: Pick<RaidScene, "battle" | "art" | "season"> & { region?: number; edge?: RaidScene["edge"] },
  box?: GroundBox
): void => {
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return;
  const { orient } = view;
  const w = box ? box.w : view.w;
  const h = box ? box.h : view.h;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (box) {
    paintLand(ctx, orient, box, scene.art, scene.season, scene.region ?? 0);
    ctx.setTransform(1, 0, 0, 1, box.ox, box.oy);
  }
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
    else hedge(ctx, orient, zone, art);
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
    // Cropped off: the flag again, a little in from the edge of what is shown, on the path.
    const edge = scene.edge;
    if (!edge || start.x >= edge.x0 + 2) return;
    const inView: Array<{ x: number; y: number }> = [];
    along(approach.path, (x, y) => {
      if (x >= edge.x0 + 8 && y >= edge.y0 + 4 && y <= edge.y1 - 2) inView.push({ x, y });
    });
    if (inView.length === 0) return;
    const { x, y } = inView[0];
    const again = toPicture({ orient }, x + 3, y - 6);
    ctx.drawImage(flag.image, Math.round(again.x - flag.w / 2), Math.round(again.y - flag.h + 2));
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
/** How long a scout's health shows after a hit. */
const PIPS_AFTER_HIT_S = 1.2;
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

/**
 * Each unit's picture, by kind: the scouts are the raid's own (`KIND_ART`, outlined dark, a shadow under each, the
 * same pictures as the planner's), the hero the camp's.
 */
export const unitArt = (kind: Unit["kind"], heroId: number): { name: string; variant: number; foot: number; half: number } =>
  kind === "hero" ? { name: "hero", variant: heroId, foot: 1, half: 6 } : { ...KIND_ART[kind], foot: 2, half: kind === "mole" ? 7 : 5 };
/**
 * A scout's group, on the ground round its feet: a ring of its colour (the colour of its path's flag and its chip), as
 * a game marks whose side a piece is on. On the ground, under every scout, so a crowd is a patch of its colour and
 * never a tower of marks over its heads. Ink on the ring's outer edge keeps it off the grass and the trail alike.
 */
const groupRing = (ctx: CanvasRenderingContext2D, x: number, y: number, half: number, colour: string) => {
  const left = Math.round(x - half);
  const top = Math.round(y - 2);
  const w = half * 2;
  ctx.fillStyle = "#141012";
  ctx.fillRect(left + 2, top - 1, w - 4, 1);
  ctx.fillRect(left + 2, top + 4, w - 4, 1);
  ctx.fillRect(left - 1, top + 1, 1, 2);
  ctx.fillRect(left + w, top + 1, 1, 2);
  ctx.fillStyle = colour;
  ctx.fillRect(left + 2, top, w - 4, 1);
  ctx.fillRect(left + 2, top + 3, w - 4, 1);
  ctx.fillRect(left, top + 1, 1, 2);
  ctx.fillRect(left + w - 1, top + 1, 1, 2);
  ctx.fillRect(left + 1, top, 1, 1);
  ctx.fillRect(left + w - 2, top, 1, 1);
  ctx.fillRect(left + 1, top + 3, 1, 1);
  ctx.fillRect(left + w - 2, top + 3, 1, 1);
};
/** A shadow on the ground, for a picture that has none of its own (the hero, the champion). */
const shadowAt = (ctx: CanvasRenderingContext2D, x: number, y: number, half: number) => {
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.fillRect(Math.round(x - half + 1), Math.round(y - 1), half * 2 - 2, 1);
  ctx.fillRect(Math.round(x - half), Math.round(y), half * 2, 1);
};
/** The picture's frame for walking and for striking: eight and twelve a second. */
const WALK_FPS = 8;
const STRIKE_FPS = 12;

type Thing = { y: number; draw: () => void };

/**
 * Where each scout is drawn beside where it stands, in field pixels, by its number (see `paintLive`): a dozen places
 * about it, none of them two the same, so the most a group ever is is a crowd of a dozen, side by side and one behind
 * another. (2026-10-25: a pixel or two apart, a group held up at the ford was one green-and-black lump.)
 */
const SPREAD: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [5, -4],
  [-5, 4],
  [6, 3],
  [-6, -3],
  [1, -7],
  [-1, 7],
  [10, 0],
  [-10, 1],
  [4, 8],
  [-4, -8],
  [11, -6]
];

/**
 * A group held up at the ford or in the thorns (2026-10-26). There they all go at a fifth or half of their pace, so the
 * ones behind close up on the ones wading, and even spread as above a dozen were a lump in the water. So a scout coming
 * to one is drawn moving out to its own place in a loose formation at the crossing (`formationSlot`), kept by its
 * number, so it never changes and nothing twitches. It moves out into it slowly
 * as it comes down the bank (the group gathers there, spread out, as it waits its turn to wade), and back into file as
 * it comes out on the far side, by where it is and nothing else. A mole goes under both, and is drawn as it goes.
 */
/** How far up the bank (field pixels) a scout starts to move out into its place. */
const RAMP = 14;
/**
 * A scout's place in a crossing's formation, by its number (field pixels): `x`, how far back or on along the trail from
 * its place in the crowd (`SPREAD`), and `y`, its lane, from the trail's middle. A scout is taller than it is wide, so
 * the formation is spread most across the screen: on a wide field, along the trail (five ranks, three lanes); upright,
 * from bank to bank (five lanes, three ranks).
 */
export const formationSlot = (id: number, zone: Stretch, orient: Orient = "wide"): { x: number; y: number } => {
  const half = (zone.y1 - zone.y0) / 2;
  if (orient === "wide") {
    const lane = (id % 3) - 1;
    const rank = Math.floor(id / 3) % 5;
    return { x: [0, 7, -7, 14, -14][rank] + (lane === 0 ? 3 : 0), y: Math.round(lane * Math.max(2, Math.min(8, half - 4))) };
  }
  const lane = (id % 5) - 2;
  const rank = Math.floor(id / 5) % 3;
  return { x: [0, -6, 6][rank] + (lane % 2 === 0 ? 0 : 3), y: Math.round(lane * Math.max(2, Math.min(7, (half - 2) / 2))) };
};
/**
 * How far into its formation a scout at (x, y) is drawn: 0 on its way, 1 at the crossing's middle. It goes evenly, over
 * the bank and half the crossing, so a scout drawn moving back in the formation still goes forward, only more slowly.
 */
export const formationShare = (zone: Stretch, x: number, y: number): number => {
  if (y < zone.y0 - 4 || y > zone.y1 + 4) return 0;
  const mid = (zone.x0 + zone.x1) / 2;
  const into = (x - (zone.x0 - RAMP)) / (mid - (zone.x0 - RAMP));
  const out = (zone.x1 + RAMP - x) / (zone.x1 + RAMP - mid);
  return Math.max(0, Math.min(1, into, out));
};
/** Where a scout is drawn beside where it stands, in field pixels: its place in a crowd, or in a crossing's formation. */
export const drawnOffset = (battle: Pick<Battle, "zones">, unit: Pick<Unit, "id" | "kind">, x: number, y: number, orient: Orient = "wide"): { x: number; y: number } => {
  const [sx, sy] = SPREAD[unit.id % SPREAD.length];
  if (unit.kind === "mole") return { x: sx, y: sy };
  for (const zone of battle.zones) {
    if (zone.kind === "pit") continue;
    const share = formationShare(zone, x, y);
    if (share <= 0) continue;
    const slot = formationSlot(unit.id, zone, orient);
    return { x: sx + slot.x * share, y: sy + (slot.y - sy) * share };
  }
  return { x: sx, y: sy };
};

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
  // The ford's ripples: moving only while the fight does.
  for (const zone of battle.zones) if (zone.kind === "water") ripples(ctx, orient, zone, now, still || battle.over);
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
  /** The groups' rings, on the ground: drawn before anything stands on it. */
  const rings: Array<() => void> = [];
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
    // A group comes out a step apart and walks its path in file: drawn as they stand they are one blob. Each is drawn
    // a few pixels to one side of where it is, always the same for it (by its number), so a group reads as a crowd.
    // At a crossing, its place in the group's formation there (`drawnOffset`).
    const shift = drawnOffset(battle, unit, spot.x, spot.y, orient);
    const picture = toPicture({ orient }, spot.x + shift.x, spot.y + shift.y);
    // Facing: where it is going, on the picture, kept until that is clearly the other way.
    const target = unit.target !== null ? battle.structures[unit.target] : null;
    const towards = target ? toPicture({ orient }, target.x, target.y).x - picture.x : 0;
    const was = looks.facing.get(unit.id) ?? true;
    const right = towards > 2 ? true : towards < -2 ? false : was;
    looks.facing.set(unit.id, right);
    // Its group's colour on the ground round its feet, so it is clear which group is where.
    const band = unit.band !== undefined ? battle.bands[unit.band] : undefined;
    if (band) {
      const half = unitArt(unit.kind, 0).half;
      rings.push(() => groupRing(ctx, picture.x, picture.y, half, APPROACH_COLOURS[band.via % APPROACH_COLOURS.length]));
    }
    things.push({
      y: picture.y,
      draw: () => {
        const look = unitArt(unit.kind, battle.setup.hero?.id ?? 0);
        const frame = Math.floor(now * (unit.busy ? STRIKE_FPS : WALK_FPS) + unit.id * 1.7);
        const sprite = art.sprite(look.name, frame, { variant: look.variant });
        if (!sprite) {
          ctx.fillStyle = unit.kind === "mole" ? "#6B4A2E" : "#4FBF5A";
          ctx.fillRect(Math.round(picture.x - 3), Math.round(picture.y - 7), 6, 7);
          return;
        }
        const foot = picture.y + look.foot;
        if (unit.kind === "hero") shadowAt(ctx, picture.x, picture.y, 5);
        stand(ctx, sprite.image, sprite.w, sprite.h, picture.x, foot, !right);
        if (!still && now - (looks.unitHitAt.get(unit.id) ?? -9) < FLASH_S) {
          const white = flashOf(sprite);
          if (white) {
            ctx.globalAlpha = 0.7;
            stand(ctx, white, sprite.w, sprite.h, picture.x, foot, !right);
            ctx.globalAlpha = 1;
          }
        }

        // A crowd of scouts each with its pips is a tower of them: a scout's show for a moment after it is hit, or
        // while it is badly hurt; the hero's whenever it is hurt.
        const share = unit.hp / unit.max;
        const lately = now - (looks.unitHitAt.get(unit.id) ?? -9) < PIPS_AFTER_HIT_S;
        if (share < 1 && (unit.kind === "hero" || lately || share <= 1 / 3)) bars.push(() => pips(ctx, picture.x, picture.y - sprite.h - 2, share, unit.kind === "hero" ? 4 : 3, true));
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
        shadowAt(ctx, picture.x, picture.y, 6);
        stand(ctx, sprite.image, sprite.w, sprite.h, picture.x, picture.y + 1, !faces);
        if (foe.hp < foe.max) bars.push(() => pips(ctx, picture.x, picture.y - sprite.h - 2, foe.hp / foe.max, 5, false));
      }
    });
  }

  for (const ring of rings) ring();
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
