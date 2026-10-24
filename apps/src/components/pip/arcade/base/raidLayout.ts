/**
 * Where a raid's field goes on the screen (the Magpie Lands, 2026-10-24): the battle's field of 240 by 120
 * (`battle.ts`), as large as the room lets it be at a whole number of device pixels to each of its pixels, so it is
 * never a small framed box and its pixels stay square. Where the screen is tall (a phone held upright) the field is
 * turned a quarter: the trail comes up from the foot of the screen and the stronghold stands at the top, so it fills
 * the phone as the camp does. The pieces are never turned: they stand upright wherever they are put.
 *
 * Field points (x, y) are the battle's; picture points are the canvas's, in its own pixels (one to a field unit).
 * Plain numbers: no DOM, no canvas.
 */
import { FIELD_H, FIELD_W } from "../../../../pip/base/field";
import { fitPicture } from "./fit";

export type Orient = "wide" | "tall";

export type FieldView = {
  orient: Orient;
  /** The picture, in its own pixels: 240 by 120, or 120 by 240 turned. */
  w: number;
  h: number;
  /** CSS pixels to each of its pixels, and device pixels (a whole number where `crisp`). */
  css: number;
  backing: number;
  crisp: boolean;
  /** Where the picture's top-left corner is in the room, in CSS pixels. */
  left: number;
  top: number;
};

/** Room kept clear of the picture, in CSS pixels: what lies over the room's edges (the bar along the top, a panel). */
export type Clear = { top: number; right: number; bottom: number; left: number };
export const NO_CLEAR: Clear = { top: 0, right: 0, bottom: 0, left: 0 };

/** How much of the room a whole-pixel size may leave empty before the field is sized to fill it instead. */
const WASTE = 0.5;
/** Turned upright where the room is this much taller than wide. */
const TALL_FROM = 1.15;

/**
 * The field for a room of `w` by `h` CSS pixels at `ratio` device pixels to each. `clear` is kept free where it can
 * be; `lean` puts the picture to one side of what is left rather than in its middle (a panel open on the other).
 */
export const fieldView = (w: number, h: number, ratio: number, clear: Clear = NO_CLEAR, lean: "middle" | "start" = "middle"): FieldView => {
  const dpr = ratio > 0 ? ratio : 1;
  const roomW = Math.max(60, w - clear.left - clear.right);
  const roomH = Math.max(60, h - clear.top - clear.bottom);
  const orient: Orient = h > w * TALL_FROM ? "tall" : "wide";
  const pw = orient === "wide" ? FIELD_W : FIELD_H;
  const ph = orient === "wide" ? FIELD_H : FIELD_W;
  const fit = fitPicture(pw, ph, roomW, roomH, dpr, WASTE);
  const shownW = pw * fit.css;
  const shownH = ph * fit.css;
  // Whole CSS pixels for the corner, so the device pixels line up with the picture's.
  const snap = (value: number) => Math.round(value * dpr) / dpr;
  const left = lean === "start" ? clear.left + Math.max(0, Math.min(roomW - shownW, 8)) : clear.left + (roomW - shownW) / 2;
  const top = clear.top + (roomH - shownH) / 2;
  return { orient, w: pw, h: ph, css: fit.css, backing: fit.backing, crisp: fit.crisp, left: snap(left), top: snap(top) };
};

/**
 * The field beside a panel (the scout's card, the planner): where the panel takes the right of a wide room (the foot of
 * a tall one), the field may run under it by `spare` field units, the far end of the picture where nothing stands
 * (past the camp, wide; the paths' first steps, tall), if that makes it a whole size larger.
 */
export const fieldViewBeside = (w: number, h: number, ratio: number, clear: Clear, spare: number): FieldView => {
  const dpr = ratio > 0 ? ratio : 1;
  let best = fieldView(w, h, ratio, clear);
  for (let step = 1; step <= 3; step++) {
    const css = (best.backing + 1) / dpr;
    const loose = best.orient === "wide" ? { ...clear, right: Math.max(8, clear.right - spare * css) } : { ...clear, bottom: Math.max(8, clear.bottom - spare * css) };
    const next = fieldView(w, h, ratio, loose);
    if (next.backing <= best.backing) break;
    best = next;
  }
  return best;
};

/** A field point on the picture. */
export const toPicture = (view: Pick<FieldView, "orient">, x: number, y: number): { x: number; y: number } =>
  view.orient === "wide" ? { x, y } : { x: y, y: FIELD_W - x };

/** A picture point on the field. */
export const toField = (view: Pick<FieldView, "orient">, px: number, py: number): { x: number; y: number } =>
  view.orient === "wide" ? { x: px, y: py } : { x: FIELD_W - py, y: px };

/** A field point in the room, in CSS pixels (for what is laid over the picture: a tag, a button). */
export const toRoom = (view: FieldView, x: number, y: number): { left: number; top: number } => {
  const at = toPicture(view, x, y);
  return { left: view.left + at.x * view.css, top: view.top + at.y * view.css };
};

/** A point in the room (CSS pixels) on the field; null off the picture. */
export const roomToField = (view: FieldView, left: number, top: number): { x: number; y: number } | null => {
  const px = (left - view.left) / view.css;
  const py = (top - view.top) / view.css;
  if (px < 0 || py < 0 || px > view.w || py > view.h) return null;
  return toField(view, px, py);
};

/** How far a point is from a path of points (field units). */
export const offPath = (path: ReadonlyArray<{ x: number; y: number }>, x: number, y: number): number => {
  let best = Infinity;
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k];
    const b = path[k + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length));
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.y + dy * t - y));
  }
  return path.length === 1 ? Math.hypot(path[0].x - x, path[0].y - y) : best;
};

/**
 * Where an approach's tag sits: along its path, short of where it ends, so it never sits on the camp; each a little
 * further along than the one before (`index`), so where the paths run close (the field turned upright) the tags do
 * not sit on one another.
 */
export const tagPoint = (path: ReadonlyArray<{ x: number; y: number }>, index = 0): { x: number; y: number } => {
  if (path.length === 0) return { x: 20, y: 64 };
  if (path.length === 1) return path[0];
  // Between a third and two thirds of the way along its first leg: in the open, between the edge and the wall.
  const a = path[0];
  const b = path[1];
  const t = 0.34 + (index % 3) * 0.16;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
};
