/**
 * Where a raid's field goes on the screen (the Magpie Lands, 2026-10-24): the battle's field of 240 by 120
 * (`battle.ts`) at a whole number of device pixels to each of its pixels, so its pixels stay square. Where the screen is
 * tall (a phone held upright) the field is turned a quarter: the trail comes up from the foot of the screen and the
 * stronghold stands at the top, so it fills the phone as the camp does. The pieces are never turned: they stand upright
 * wherever they are put.
 *
 * (2026-10-25) The view is framed on the stronghold and the last stretch of its approaches (`focusOf`), not the whole
 * field: the field's own edges are mostly empty grass (the paths' first steps, the ground past the camp), and fitting
 * all of it left the stronghold a quarter of a laptop's screen. What the frame leaves out is still there to be looked
 * at: a drag pans over it (`Pan`), and in a fight the camera eases to keep the fighting in view (`follow`).
 *
 * Field points (x, y) are the battle's; picture points are the canvas's, in its own pixels (one to a field unit).
 * Plain numbers: no DOM, no canvas.
 */
import { FIELD_H, FIELD_W } from "../../../../pip/base/field";
import type { Approach, Zone } from "../../../../pip/base/approaches";
import type { Structure } from "../../../../pip/base/battle";
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
 * The ground's picture, which covers the whole room and not only the field (so the raid is never a framed box in the
 * page): the field's pixels lie inside it at (`ox`, `oy`), on the same grid; the rest is the land round the stronghold.
 * `left` and `top` place it in the room, in CSS pixels; `w` and `h` are its own pixels.
 */
export type GroundBox = { ox: number; oy: number; w: number; h: number; left: number; top: number };
/** The most of the room's land drawn on each side, in picture pixels: a soft picture shown small paints no more than it needs. */
const LAND_MOST = 160;
/** With a `pan`, enough land for the room wherever the picture is panned to within it. */
export const groundBox = (view: FieldView, roomW: number, roomH: number, pan: Pan = NO_PAN): GroundBox => {
  const css = view.css > 0 ? view.css : 1;
  const ox = Math.min(LAND_MOST, Math.max(0, Math.ceil((view.left + pan.maxX) / css)));
  const oy = Math.min(LAND_MOST, Math.max(0, Math.ceil((view.top + pan.maxY) / css)));
  const right = Math.min(LAND_MOST, Math.max(0, Math.ceil((roomW - view.left - pan.minX - view.w * css) / css)));
  const bottom = Math.min(LAND_MOST, Math.max(0, Math.ceil((roomH - view.top - pan.minY - view.h * css) / css)));
  return { ox, oy, w: ox + view.w + right, h: oy + view.h + bottom, left: view.left - ox * css, top: view.top - oy * css };
};

// ---- framing on the stronghold, and the camera (2026-10-25) ----------------------------------------------------------

/**
 * Room kept for a fight's bar along the top and its orders along the foot (raid.css), in CSS pixels, so the field is
 * framed between them; on a phone on its side both stand down the right, beside the field.
 */
export const HUD_ROOM = 60;
export const DOCK_ROOM = 80;
export const SIDE_ROOM = 160;

/** A box on the picture, in its own pixels. */
export type PictureBox = { x0: number; y0: number; x1: number; y1: number };

/**
 * How far the picture may be moved from where it was framed, in CSS pixels (its corner at `left + dx`, `top + dy`):
 * never so far that more than `PAN_LAND` of the land past the field's edge comes into the room. Zero both ways along a
 * side where the whole field is in the room already.
 */
export type Pan = { minX: number; maxX: number; minY: number; maxY: number };
export const NO_PAN: Pan = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
/** How much land past the field's edge a pan may bring in, in picture pixels: enough to see a path's first steps whole. */
export const PAN_LAND = 12;

/** How tall each piece stands over its foot on the picture, and how wide it is about it (raid-art.js's sizes). */
const STANDS: Readonly<Record<Structure["kind"], { up: number; half: number }>> = {
  nest: { up: 48, half: 25 },
  perch: { up: 34, half: 11 },
  hoard: { up: 20, half: 12 },
  wall: { up: 22, half: 6 },
  other: { up: 32, half: 14 }
};
/** How much of each approach's path, back from its end, the frame keeps: where its group closes on the camp. */
export const LAST_STRETCH = 44;
/** Grass kept round what is framed, in picture pixels. */
const FRAME_PAD = 4;
/** How much of its grass the frame may lose to be a whole size larger (a share of each side). */
const FRAME_GIVE = 0.05;

/**
 * What a raid's view is framed on, on the picture turned as `orient` says. `core`: the stronghold's pieces standing
 * (each as tall as its picture) and the last stretch of each approach, which the view is sized to hold. `all`: that and
 * the hazards further out on the trail (the ford, the thorns, the pits), which it holds too where it can, and leans
 * toward where it cannot. `keep`: the stronghold's pieces alone, which are never cut short where they fit. A little
 * grass round each.
 */
export type Focus = { core: PictureBox; all: PictureBox; keep: PictureBox };
export const focusOf = (orient: Orient, structures: readonly Structure[], approaches: readonly Pick<Approach, "path">[], zones: readonly Zone[] = []): Focus => {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const take = (x: number, y: number) => {
    box.x0 = Math.min(box.x0, x);
    box.x1 = Math.max(box.x1, x);
    box.y0 = Math.min(box.y0, y);
    box.y1 = Math.max(box.y1, y);
  };
  const field = (x: number, y: number) => {
    const at = toPicture({ orient }, x, y);
    take(at.x, at.y);
  };
  for (const entry of structures) {
    if (entry.flat || entry.traps !== undefined) continue;
    const at = toPicture({ orient }, entry.x, entry.y);
    const size = STANDS[entry.kind] ?? STANDS.other;
    const half = Math.max(entry.r, size.half);
    take(at.x - half, at.y - size.up);
    take(at.x + half, at.y + Math.max(3, entry.r * 0.6));
  }
  const fieldW = orient === "wide" ? FIELD_W : FIELD_H;
  const fieldH = orient === "wide" ? FIELD_H : FIELD_W;
  const keep = Number.isFinite(box.x0)
    ? { x0: Math.max(0, Math.floor(box.x0 - 1)), y0: Math.max(0, Math.floor(box.y0 - 1)), x1: Math.min(fieldW, Math.ceil(box.x1 + 1)), y1: Math.min(fieldH, Math.ceil(box.y1 + 1)) }
    : { x0: 0, y0: 0, x1: 0, y1: 0 };
  for (const approach of approaches) {
    // Back from the end of the path, LAST_STRETCH of it.
    const path = approach.path;
    if (path.length === 0) continue;
    field(path[path.length - 1].x, path[path.length - 1].y);
    let left = LAST_STRETCH;
    for (let k = path.length - 1; k > 0 && left > 0; k--) {
      const a = path[k];
      const b = path[k - 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const t = length > 0 ? Math.min(1, left / length) : 1;
      field(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      left -= length;
    }
  }
  const pw = fieldW;
  const ph = fieldH;
  const padded = (): PictureBox =>
    Number.isFinite(box.x0)
      ? {
          x0: Math.max(0, Math.floor(box.x0 - FRAME_PAD)),
          y0: Math.max(0, Math.floor(box.y0 - FRAME_PAD)),
          x1: Math.min(pw, Math.ceil(box.x1 + FRAME_PAD)),
          y1: Math.min(ph, Math.ceil(box.y1 + FRAME_PAD))
        }
      : { x0: 0, y0: 0, x1: pw, y1: ph };
  const core = padded();
  for (const zone of zones) {
    if ("x0" in zone) {
      field(zone.x0, zone.y0);
      field(zone.x1, zone.y1);
    } else {
      field(zone.x - 8, zone.y - 6);
      field(zone.x + 8, zone.y + 6);
    }
  }
  return { core, all: padded(), keep };
};

/** A view framed on part of the field, and how far it may be panned from there. */
export type FramedView = FieldView & { pan: Pan; focus: PictureBox };

/**
 * The field for a room of `w` by `h` CSS pixels, framed on `focus` (worked out for the way the picture is turned): as
 * large as a whole number of device pixels lets its core fit the room left `clear` (losing a little of its grass at
 * most), and never smaller than the whole field would be. Along each side, all of the focus in the middle of the clear
 * room where it fits; where it does not, the core kept in and the rest of the room given to the way the scouts come
 * (the left of a wide field, the foot of an upright one). The field always covers the clear room; under a card or a
 * bar, past its edge, the land round it (`groundBox`) shows.
 */
export const framedView = (w: number, h: number, ratio: number, clear: Clear, focus: (orient: Orient) => Focus): FramedView => {
  const dpr = ratio > 0 ? ratio : 1;
  const roomW = Math.max(60, w - clear.left - clear.right);
  const roomH = Math.max(60, h - clear.top - clear.bottom);
  const orient: Orient = h > w * TALL_FROM ? "tall" : "wide";
  const pw = orient === "wide" ? FIELD_W : FIELD_H;
  const ph = orient === "wide" ? FIELD_H : FIELD_W;
  const { core, all, keep } = focus(orient);
  const whole = fitPicture(pw, ph, roomW, roomH, dpr, WASTE);
  const give = 1 - FRAME_GIVE * 2;
  const framed = fitPicture(Math.max(20, (core.x1 - core.x0) * give), Math.max(20, (core.y1 - core.y0) * give), roomW, roomH, dpr, WASTE);
  const fit = framed.css >= whole.css ? framed : whole;
  const shownW = pw * fit.css;
  const shownH = ph * fit.css;
  const snap = (value: number) => Math.round(value * dpr) / dpr;
  /**
   * Along one side, where the picture's edge goes. `campLow`: the camp is at the low end of this side (an upright
   * field's top), so what does not fit is given to the high end, where the scouts come from; else the other way.
   */
  const place = (start: number, room: number, shown: number, c0: number, c1: number, a0: number, a1: number, k0: number, k1: number, approachSide: boolean, campLow: boolean) => {
    if (shown <= room) return start + (room - shown) / 2;
    const size = room / fit.css;
    let from: number;
    if (a1 - a0 <= size) from = (a0 + a1) / 2 - size / 2;
    else if (!approachSide) from = (c0 + c1) / 2 - size / 2;
    else from = campLow ? Math.min(c0, a1 - size) : Math.max(c1 - size, a0);
    // What the core gives up to fit is grass and the paths' far ends, never a piece of the stronghold.
    if (k1 - k0 <= size) from = Math.max(k1 - size, Math.min(k0, from));
    // The field over all of the clear room; past its edge, under a card or a bar, the land round it is enough.
    return Math.min(start, Math.max(start + room - shown, start - from * fit.css));
  };
  const left = snap(place(clear.left, roomW, shownW, core.x0, core.x1, all.x0, all.x1, keep.x0, keep.x1, orient === "wide", false));
  const top = snap(place(clear.top, roomH, shownH, core.y0, core.y1, all.y0, all.y1, keep.y0, keep.y1, orient === "tall", true));
  const land = PAN_LAND * fit.css;
  const range = (at: number, full: number, shown: number): [number, number] => {
    // Shown no larger than the room: it stays where it was put.
    if (shown <= full) return [0, 0];
    return [Math.min(0, snap(full - land - shown - at)), Math.max(0, snap(land - at))];
  };
  const [minX, maxX] = range(left, w, shownW);
  const [minY, maxY] = range(top, h, shownH);
  return { orient, w: pw, h: ph, css: fit.css, backing: fit.backing, crisp: fit.crisp, left, top, pan: { minX, maxX, minY, maxY }, focus: core };
};

/** A pan kept within its range, at whole device pixels so the picture's pixels stay on the screen's. */
export const clampPan = (pan: Pan, dx: number, dy: number, ratio = 1): { dx: number; dy: number } => {
  const dpr = ratio > 0 ? ratio : 1;
  const snap = (value: number) => Math.round(value * dpr) / dpr;
  return { dx: snap(Math.max(pan.minX, Math.min(pan.maxX, dx))), dy: snap(Math.max(pan.minY, Math.min(pan.maxY, dy))) };
};

/**
 * Where the camera wants the picture in a fight, as a pan from where it was framed: the stronghold (`keep`, picture
 * pixels) always in the clear part of the room (`window`, CSS pixels in the room: between the bars), and as much of
 * the fighting (`want`, the scouts on the field) as fits beside it, the ones closing on the camp first. Nothing to
 * follow: where it was framed.
 */
export const follow = (
  view: FramedView,
  window: { left: number; top: number; right: number; bottom: number },
  keep: PictureBox,
  want: PictureBox | null,
  ratio = 1
): { dx: number; dy: number } => {
  if (!want) return { dx: 0, dy: 0 };
  const css = view.css;
  /** Along one side, where the window starts on the picture: as framed, moved just enough. `campHigh`: the camp is that way. */
  const along = (home: number, size: number, k0: number, k1: number, w0: number, w1: number, campHigh: boolean) => {
    let start = home;
    // The far scouts may be left out, never the ones closing on the camp.
    if (campHigh) {
      if (w0 < start) start = w0;
      if (w1 > start + size) start = w1 - size;
    } else {
      if (w1 > start + size) start = w1 - size;
      if (w0 < start) start = w0;
    }
    // The stronghold over all.
    return Math.max(Math.min(start, k0), k1 - size);
  };
  const homeX = (window.left - view.left) / css;
  const homeY = (window.top - view.top) / css;
  // Wide, the paths come in from the left and the camp is to their right; upright, they come up from the foot.
  const x = along(homeX, (window.right - window.left) / css, keep.x0, keep.x1, want.x0, want.x1, true);
  const y = along(homeY, (window.bottom - window.top) / css, keep.y0, keep.y1, want.y0, want.y1, view.orient === "wide");
  return clampPan(view.pan, (homeX - x) * css, (homeY - y) * css, ratio);
};

/** How slowly the camera eases (seconds to come most of the way), and the fastest it ever goes, in CSS pixels a second. */
export const CAMERA_EASE_S = 0.9;
export const CAMERA_MOST = 160;
/** One step of the camera toward where it wants to be: eased, slow, at whole device pixels; still within a pixel of it. */
export const easeCamera = (at: { dx: number; dy: number }, to: { dx: number; dy: number }, dt: number, ratio = 1): { dx: number; dy: number } => {
  const dpr = ratio > 0 ? ratio : 1;
  const k = 1 - Math.exp(-Math.max(0, dt) / CAMERA_EASE_S);
  const most = CAMERA_MOST * Math.max(0, dt);
  const step = (from: number, target: number) => {
    const gap = target - from;
    if (Math.abs(gap) * dpr < 1) return from;
    const move = Math.min(Math.abs(gap), most, Math.max(1 / dpr, Math.abs(gap) * k));
    return Math.round((from + Math.sign(gap) * move) * dpr) / dpr;
  };
  return { dx: step(at.dx, to.dx), dy: step(at.dy, to.dy) };
};

/** The part of the field the room shows (field points), the picture panned by (`dx`, `dy`). */
export const shownOnField = (view: FieldView, roomW: number, roomH: number, dx = 0, dy = 0): { x0: number; x1: number; y0: number; y1: number } => {
  const a = toField(view, (0 - view.left - dx) / view.css, (0 - view.top - dy) / view.css);
  const b = toField(view, (roomW - view.left - dx) / view.css, (roomH - view.top - dy) / view.css);
  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
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
export const tagPoint = (path: ReadonlyArray<{ x: number; y: number }>, index = 0, shown?: { x0: number; x1: number; y0: number; y1: number }): { x: number; y: number } => {
  if (path.length === 0) return { x: 20, y: 64 };
  if (path.length === 1) return path[0];
  // Between a third and two thirds of the way along its first leg: in the open, between the edge and the wall.
  const a = path[0];
  const b = path[1];
  const t = 0.34 + (index % 3) * 0.16;
  const open = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  // (2026-10-25) Where the view is framed on the stronghold, that can be out of sight (cropped, or under the planner):
  // then a little way on from where the path comes into view, never on its last steps to the camp.
  const inside = (point: { x: number; y: number }, margin: number) =>
    !shown || (point.x >= shown.x0 + margin && point.x <= shown.x1 - margin && point.y >= shown.y0 + margin * 0.6 && point.y <= shown.y1 - margin * 0.6);
  if (inside(open, 14)) return open;
  const steps: Array<{ x: number; y: number }> = [];
  for (let k = 0; k + 1 < path.length; k++) {
    const from = path[k];
    const to = path[k + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
    for (let s = 0; s < n; s++) steps.push({ x: from.x + ((to.x - from.x) * s) / n, y: from.y + ((to.y - from.y) * s) / n });
  }
  const first = steps.findIndex((point) => inside(point, 14));
  if (first < 0) return open;
  const last = Math.max(first, steps.length - 16);
  return steps[Math.min(last, first + 4 + (index % 3) * 10)];
};
