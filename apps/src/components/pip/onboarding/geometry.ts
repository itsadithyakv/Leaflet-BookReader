/**
 * Where the guided session's things go on the screen: the hole in the
 * dimming over what is to be tapped, whether a tap may go through, the
 * pointing paw beside it, and Pip's bubble where it covers neither.
 *
 * All in CSS pixels, from rectangles; nothing here touches the page.
 */
import { PLOT_SIZE, THINGS } from "../arcade/base/scene";
import { GAME_W } from "../arcade/games";
import type { Placed } from "../../../pip/base/rules";

export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
/** A box in the clearing's own pixels: its left and top, and its size. */
export type SceneBox = { x: number; y: number; w: number; h: number };

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The room a building takes in the clearing (as `scene.ts` draws and hit-tests it). */
export const siteBox = (site: Placed, spot: readonly [number, number]): SceneBox => {
  const size = PLOT_SIZE[site];
  return { x: Math.round(spot[0] - (size.w * THINGS) / 2), y: spot[1] - size.h * THINGS, w: size.w * THINGS, h: size.h * THINGS };
};

/**
 * The burrow's door, as a finger finds it: the middle of the burrow's
 * front and a little of the grass before it. The door itself is a few
 * pixels of the picture; this is the part of the burrow a tap goes in by
 * (the rest of it still chooses the burrow).
 */
export const doorBox = (spot: readonly [number, number]): SceneBox => ({ x: spot[0] - 6, y: spot[1] - 11, w: 12, h: 13 });
export const inDoor = (spot: readonly [number, number], x: number, y: number) => {
  const box = doorBox(spot);
  return x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
};

/** Grows a box of the clearing by so many of its pixels each way. */
export const grow = (box: SceneBox, by: number): SceneBox => ({ x: box.x - by, y: box.y - by, w: box.w + by * 2, h: box.h + by * 2 });

/**
 * A box of the clearing on the screen: the canvas's own rectangle, and the
 * sky drawn above the clearing (in the clearing's pixels).
 */
export const sceneToScreen = (box: SceneBox, canvas: Pick<Rect, "left" | "top" | "width">, sky = 0): Rect => {
  const scale = canvas.width / GAME_W;
  return { left: canvas.left + box.x * scale, top: canvas.top + (box.y + sky) * scale, width: box.w * scale, height: box.h * scale };
};

/** To whole pixels, outward: a hole is never smaller than what it shows. */
export const whole = (rect: Rect): Rect => {
  const left = Math.floor(rect.left);
  const top = Math.floor(rect.top);
  return { left, top, width: Math.ceil(rect.left + rect.width) - left, height: Math.ceil(rect.top + rect.height) - top };
};

export const pad = (rect: Rect, by: number): Rect => ({ left: rect.left - by, top: rect.top - by, width: rect.width + by * 2, height: rect.height + by * 2 });

export const union = (a: Rect, b: Rect): Rect => {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return { left, top, width: Math.max(a.left + a.width, b.left + b.width) - left, height: Math.max(a.top + a.height, b.top + b.height) - top };
};

export const inRect = (point: Point, rect: Rect) => point.x >= rect.left && point.x < rect.left + rect.width && point.y >= rect.top && point.y < rect.top + rect.height;

export const overlap = (a: Rect, b: Rect) => {
  const wide = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const tall = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return wide > 0 && tall > 0 ? wide * tall : 0;
};

/** Whether a tap at a point is let through to the page: only inside one of the holes. */
export const letThrough = (point: Point, holes: readonly Rect[]) => holes.some((hole) => inRect(point, hole));

export type Side = "above" | "below" | "left" | "right";
export type Placement = { left: number; top: number; side: Side; tailAt: number };

/**
 * Pip's bubble: beside the target, never over it, and over as little as
 * can be of anything else that must be seen (`avoid`: the paw, an open
 * panel's key). Tried above, below, right and left of the target, then in
 * the corners of the bounds; the first that fits inside the bounds and
 * covers nothing wins, else the one that covers least, the target never.
 * `tailAt` is where along its edge the tail points at the target (percent).
 */
export const placeBubble = (target: Rect, size: Size, bounds: Rect, avoid: readonly Rect[] = [], gap = 12): Placement => {
  const middleX = target.left + target.width / 2;
  const middleY = target.top + target.height / 2;
  const maxLeft = bounds.left + bounds.width - size.width;
  const maxTop = bounds.top + bounds.height - size.height;
  const along = (low: number, high: number, at: number) => clamp(at, low, Math.max(low, high));
  const beside: Array<{ side: Side; left: number; top: number }> = [
    { side: "above", left: along(bounds.left, maxLeft, middleX - size.width / 2), top: target.top - gap - size.height },
    { side: "below", left: along(bounds.left, maxLeft, middleX - size.width / 2), top: target.top + target.height + gap },
    { side: "right", left: target.left + target.width + gap, top: along(bounds.top, maxTop, middleY - size.height / 2) },
    { side: "left", left: target.left - gap - size.width, top: along(bounds.top, maxTop, middleY - size.height / 2) }
  ];
  // The corners: whichever side of the target each is on, the tail leans that way.
  const corners = [
    [bounds.left, maxTop],
    [maxLeft, maxTop],
    [bounds.left, bounds.top],
    [maxLeft, bounds.top]
  ].map(([left, top]) => ({ side: (top + size.height <= target.top ? "above" : top >= target.top + target.height ? "below" : left + size.width <= target.left ? "left" : "right") as Side, left, top }));
  const fitsIn = (at: { left: number; top: number }) => at.left >= bounds.left - 0.5 && at.top >= bounds.top - 0.5 && at.left <= maxLeft + 0.5 && at.top <= maxTop + 0.5;
  const box = (at: { left: number; top: number }): Rect => ({ left: at.left, top: at.top, width: size.width, height: size.height });
  const clear = pad(target, gap / 2);
  const all = [...beside, ...corners].filter(fitsIn);
  const scored = all
    .map((at, order) => ({ at, order, hits: overlap(box(at), clear), covers: avoid.reduce((sum, rect) => sum + overlap(box(at), rect), 0) }))
    .sort((a, b) => a.hits - b.hits || a.covers - b.covers || a.order - b.order);
  // Too big for the bounds every way: held inside them as well as it can be, below the target if there is room.
  const chosen = scored[0]?.at ?? { side: "below" as Side, left: along(bounds.left, maxLeft, middleX - size.width / 2), top: along(bounds.top, maxTop, target.top + target.height + gap) };
  const left = Math.round(chosen.left);
  const top = Math.round(chosen.top);
  const tailAt =
    chosen.side === "above" || chosen.side === "below"
      ? clamp(((middleX - left) / Math.max(1, size.width)) * 100, 10, 90)
      : clamp(((middleY - top) / Math.max(1, size.height)) * 100, 15, 85);
  return { left, top, side: chosen.side, tailAt };
};

/**
 * The pointing paw: over the target pointing down, or under it pointing up
 * where there is no room above. Whole pixels, so it bobs by whole pixels.
 */
export const placePaw = (target: Rect, size: Size, bounds: Rect, gap = 2, prefer: "above" | "below" = "above"): { left: number; top: number; up: boolean } => {
  const left = Math.round(clamp(target.left + target.width / 2 - size.width / 2, bounds.left, bounds.left + bounds.width - size.width));
  const above = target.top - gap - size.height;
  const below = target.top + target.height + gap;
  // Under a key on a card (1.5.10), so the paw never sits on what the card says above it (the cost, the needs).
  if (prefer === "below" && below + size.height <= bounds.top + bounds.height) return { left, top: Math.round(below), up: true };
  if (above >= bounds.top) return { left, top: Math.round(above), up: false };
  return { left, top: Math.round(Math.min(target.top + target.height + gap, bounds.top + bounds.height - size.height)), up: true };
};

/**
 * Where the whole clearing is on the screen, from its canvas: the canvas's own rectangle where it shows the whole of
 * it, or, where it is a window onto part of it (a phone held sideways, since 1.5.8: BaseScreen's camera), the
 * rectangle the whole would have, as the canvas says in `data-cam-x`, `data-cam-y` (art pixels) and `data-scale`
 * (CSS pixels to an art pixel). What `sceneToScreen` is handed.
 */
export const sceneRectOf = (canvas: HTMLCanvasElement): Pick<Rect, "left" | "top" | "width"> => {
  const rect = canvas.getBoundingClientRect();
  const scale = Number(canvas.dataset.scale);
  if (!Number.isFinite(scale) || scale <= 0) return { left: rect.left, top: rect.top, width: rect.width };
  const camX = Number(canvas.dataset.camX) || 0;
  const camY = Number(canvas.dataset.camY) || 0;
  return { left: rect.left - camX * scale, top: rect.top - camY * scale, width: GAME_W * scale };
};

/** How much of what it must keep clear of a bubble covers: the target, and the rest (`avoid`). */
export const bubbleCovers = (bubble: Rect, target: Rect | null, avoid: readonly Rect[] = []) => ({
  target: target ? overlap(bubble, target) : 0,
  avoid: avoid.reduce((sum, rect) => sum + overlap(bubble, rect), 0)
});

/**
 * Whether Pip's bubble, once it is up, may stay where it is: inside the bounds, and over no more of what it points
 * at, or of anything it must keep clear of, than when it was put there (`was`: none, mostly). A bubble that moved
 * while it was read (the camera easing to the basket, a panel shutting) moved its Next key from under the finger
 * pressing it; so it is placed once, and moved again only when it no longer fits there.
 */
export const bubbleStays = (bubble: Rect, bounds: Rect, target: Rect | null, avoid: readonly Rect[] = [], was = { target: 0, avoid: 0 }) => {
  const inside =
    bubble.left >= bounds.left - 0.5 &&
    bubble.top >= bounds.top - 0.5 &&
    bubble.left + bubble.width <= bounds.left + bounds.width + 0.5 &&
    bubble.top + bubble.height <= bounds.top + bounds.height + 0.5;
  if (!inside) return false;
  const now = bubbleCovers(bubble, target, avoid);
  return now.target <= was.target + 0.5 && now.avoid <= was.avoid + 0.5;
};
