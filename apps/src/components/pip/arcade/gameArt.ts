import { LIB, SKINS, dress, renderFrame, renderGameSprite, resolve, type PipGameSprite, type PipMove } from "../../../pip";
import { houseArt } from "../../../pip/home.js";
import "../../../pip/houseArt";

/**
 * Sprites for the arcade games, from games-art.js: Pip's poses (move-shaped,
 * drawn in the reader's own skin and outfit) and the games' sprites (drawn
 * with the room Painter). Each frame is drawn once and kept as a canvas.
 *
 * Anything the art does not have is null, and the game draws a plain
 * stand-in, so a game never breaks on missing art.
 */

export type GameSprite = {
  image: CanvasImageSource;
  w: number;
  h: number;
  /** Hit box inside the sprite, [x, y, w, h]; the whole sprite when absent. */
  box: [number, number, number, number];
};

export type SpriteOpts = { h?: number; top?: boolean; letter?: string; variant?: number };

export type GameArt = {
  /** A sprite by name ("books", "bat", "ground", "pillar"...), or null. */
  sprite: (name: string, frame: number, opts?: SpriteOpts) => GameSprite | null;
  /** Pip in one of the game's poses ("run", "jump"...), or null. */
  pose: (name: string, frame: number) => GameSprite | null;
  /** Pip doing a library move, the stand-in for a missing pose. */
  pip: (move: string, frame: number) => GameSprite;
};

const toCanvas = (image: ImageData) => {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")?.putImageData(image, 0, 0);
  return canvas;
};

type SpriteDef = PipGameSprite & { draw: (...args: unknown[]) => void };
type PoseDef = PipMove & { box?: [number, number, number, number] };

const isSprite = (value: unknown): value is SpriteDef =>
  typeof value === "object" && value !== null && typeof (value as SpriteDef).draw === "function" && typeof (value as SpriteDef).w === "number";

/** Finds a sprite by name anywhere in a game's art (top level or one group down: `obstacles`, `items`). */
const find = (tree: Record<string, unknown>, name: string): SpriteDef | null => {
  if (isSprite(tree[name])) return tree[name] as SpriteDef;
  for (const [key, value] of Object.entries(tree)) {
    if (key === "pip" || typeof value !== "object" || value === null) continue;
    const inner = (value as Record<string, unknown>)[name];
    if (isSprite(inner)) return inner;
  }
  return null;
};

const MOVES = new Map<string, PipMove>(LIB.map((move) => [move.id, move]));

export const gameArt = (gameId: string, skinId: string, outfit: readonly string[]): GameArt => {
  const all = (houseArt("GAME_SPRITES") ?? {}) as Record<string, Record<string, unknown>>;
  const tree = all[gameId] ?? {};
  const poses = (tree.pip ?? {}) as Record<string, PoseDef>;
  const skin = dress(SKINS.find((entry) => entry.id === skinId) ?? SKINS[0], outfit);
  const cache = new Map<string, GameSprite | null>();

  const sprite = (name: string, frame: number, opts: SpriteOpts = {}) => {
    const def = find(tree, name);
    if (!def) return null;
    const looped = def.frames ? frame % def.frames : frame;
    const id = `s|${name}|${looped}|${opts.h ?? ""}|${opts.top ? 1 : 0}|${opts.letter ?? ""}|${opts.variant ?? ""}`;
    if (!cache.has(id)) {
      try {
        const image = renderGameSprite(def, looped, opts);
        const box = def.box ?? [0, 0, image.width, image.height];
        cache.set(id, { image: toCanvas(image), w: image.width, h: image.height, box: [box[0], box[1], box[2], opts.h ? opts.h : box[3]] });
      } catch {
        cache.set(id, null);
      }
    }
    return cache.get(id) ?? null;
  };

  const pose = (name: string, frame: number) => {
    const def = poses[name];
    if (!def || typeof (def as { draw?: unknown }).draw !== "function") return null;
    const looped = frame % Math.max(1, def.loop);
    const id = `p|${name}|${looped}`;
    if (!cache.has(id)) {
      try {
        const image = renderFrame(def, looped, resolve(skin, looped));
        cache.set(id, { image: toCanvas(image), w: 32, h: 32, box: def.box ?? [8, 12, 16, 18] });
      } catch {
        cache.set(id, null);
      }
    }
    return cache.get(id) ?? null;
  };

  const pip = (moveId: string, frame: number) => {
    const move = MOVES.get(moveId) ?? MOVES.get("idle")!;
    const looped = frame % move.loop;
    const id = `m|${move.id}|${looped}`;
    let found = cache.get(id);
    if (!found) {
      found = { image: toCanvas(renderFrame(move, looped, resolve(skin, looped))), w: 32, h: 32, box: [8, 12, 16, 18] };
      cache.set(id, found);
    }
    return found;
  };

  return { sprite, pose, pip };
};
