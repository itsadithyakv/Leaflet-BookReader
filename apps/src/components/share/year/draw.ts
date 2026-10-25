/**
 * The story's pictures, drawn on a canvas: the colour field and its grain,
 * the calendar, the months' bars, the hourglass, the shelf, Pip. Each takes
 * `t`, how far its motion has come (0 to 1, 1 the held end), so the scene on
 * screen plays it and the picture to share draws the end of it, with the same
 * code: they cannot drift apart.
 *
 * Only fills, strokes and whole-pixel sprites: no blur and no shadows, which
 * are Leaflet's look and are also what a phone's GPU likes least.
 */
import { LIB, SKINS, dress, renderFrame, resolve, type PipMove, type PipSkin } from "../../../pip/core";
import { MONTHS, type DayShare, type HollowYear, type TimeOfDay } from "../yearReview";
import type { ScenePalette } from "./scenes";

type Context = CanvasRenderingContext2D;
export type Box = { x: number; y: number; width: number; height: number };

export const SANS = '"Segoe UI Variable Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, system-ui, sans-serif';
export const SERIF = 'Georgia, "Iowan Old Style", "Palatino Linotype", "Noto Serif", "Times New Roman", serif';

// ---- Motion -----------------------------------------------------------------

export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
/** Springy but calm: one soft overshoot, settled well before the end. */
export const spring = (t: number) => {
  const x = clamp01(t);
  return x >= 1 ? 1 : 1 - Math.exp(-6.5 * x) * Math.cos(7.5 * x);
};
/**
 * A thing dropped onto something (a book onto a shelf): it falls, lands, and
 * gives one small hop, never sinking through what it lands on.
 */
export const land = (t: number) => {
  const x = clamp01(t);
  return x < 0.6 ? (x / 0.6) * (x / 0.6) : 1 - 0.06 * Math.sin((Math.PI * (x - 0.6)) / 0.4);
};

/** The part of `t` that falls between `from` and `to`, as 0 to 1. */
export const within = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));

/** A small seeded random, so a picture comes out the same every time it is drawn. */
export const seeded = (seed: number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const withAlpha = (hex: string, alpha: number) => {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
};
export { withAlpha as alpha };

// ---- The field ----------------------------------------------------------------

const grains = new Map<string, HTMLCanvasElement | null>();

/**
 * A tile of fine paper grain: specks of light on a dark field, of dark on a
 * light one, made once. Drawn over the field as a pattern; on screen it is
 * the same tile as a CSS background.
 */
export const grainTile = (dark: boolean): HTMLCanvasElement | null => {
  const key = dark ? "dark" : "light";
  if (grains.has(key)) {
    return grains.get(key) ?? null;
  }
  let tile: HTMLCanvasElement | null = null;
  try {
    tile = document.createElement("canvas");
    tile.width = 180;
    tile.height = 180;
    const context = tile.getContext("2d");
    if (!context) {
      tile = null;
    } else {
      const image = context.createImageData(180, 180);
      const random = seeded(dark ? 7 : 11);
      for (let at = 0; at < image.data.length; at += 4) {
        const speck = random();
        const shade = dark ? 255 : 30;
        image.data[at] = shade;
        image.data[at + 1] = shade;
        image.data[at + 2] = shade;
        // Most of the tile is clear; a few specks, a few fewer darker ones.
        image.data[at + 3] = speck > 0.94 ? 28 : speck > 0.72 ? 11 : 0;
      }
      context.putImageData(image, 0, 0);
    }
  } catch {
    tile = null;
  }
  grains.set(key, tile);
  return tile;
};

/** The grain as a CSS background, for the scenes on screen. */
export const grainUrl = (dark: boolean): string | null => {
  try {
    return grainTile(dark)?.toDataURL("image/png") ?? null;
  } catch {
    return null;
  }
};

/** A scene's colour field: the wash, a soft light from the top, and the grain. */
export const paintField = (context: Context, width: number, height: number, palette: ScenePalette, grainScale = 1) => {
  const wash = context.createLinearGradient(0, 0, 0, height);
  wash.addColorStop(0, palette.field[0]);
  wash.addColorStop(1, palette.field[1]);
  context.fillStyle = wash;
  context.fillRect(0, 0, width, height);
  const light = context.createRadialGradient(width * 0.5, height * 0.18, 0, width * 0.5, height * 0.18, Math.max(width, height) * 0.75);
  light.addColorStop(0, palette.dark ? "rgba(255, 251, 240, 0.10)" : "rgba(255, 255, 255, 0.35)");
  light.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = light;
  context.fillRect(0, 0, width, height);
  const tile = grainTile(palette.dark);
  if (tile) {
    const pattern = context.createPattern(tile, "repeat");
    if (pattern) {
      pattern.setTransform?.(new DOMMatrix().scale(grainScale));
      context.fillStyle = pattern;
      context.fillRect(0, 0, width, height);
    }
  }
};

// ---- The Leaflet mark -------------------------------------------------------------

/** Pip with a book, the logo, as runs of pixels on its 32-pixel grid ([x, y, length]): brand/logo/pip-logo-mono-*.svg. */
const MARK: Array<[number, number, number]> = [
  [19, 2, 1], [17, 3, 4], [16, 4, 6], [15, 5, 3], [19, 5, 3], [15, 6, 3], [19, 6, 2], [14, 7, 3], [18, 7, 3], [14, 8, 3], [18, 8, 3],
  [14, 9, 2], [17, 9, 3], [15, 10, 1], [17, 10, 2], [13, 11, 2], [18, 11, 1], [11, 12, 10], [10, 13, 2], [13, 13, 9], [9, 14, 2],
  [14, 14, 9], [8, 15, 3], [14, 15, 4], [20, 15, 4], [7, 16, 5], [14, 16, 4], [20, 16, 5], [7, 17, 5], [14, 17, 4], [20, 17, 5],
  [7, 18, 5], [14, 18, 4], [20, 18, 5], [7, 19, 18], [7, 20, 7], [15, 20, 2], [18, 20, 7], [8, 21, 5], [19, 21, 5], [8, 22, 4],
  [18, 22, 6], [7, 23, 1], [24, 23, 1], [6, 24, 3], [23, 24, 3], [5, 25, 2], [11, 25, 5], [17, 25, 4], [25, 25, 2], [6, 26, 4],
  [15, 26, 1], [22, 26, 4], [6, 27, 4], [11, 27, 5], [17, 27, 4], [22, 27, 4], [6, 28, 4], [15, 28, 1], [22, 28, 4], [7, 29, 2],
  [15, 29, 1], [23, 29, 2], [8, 30, 16], [9, 31, 1], [22, 31, 1]
];

/** The mark and the word "Leaflet" beside it, its pixels `scale` device pixels each; returns its width. */
export const drawMark = (context: Context, x: number, y: number, scale: number, color: string, align: "left" | "right" = "left") => {
  const px = Math.max(1, Math.round(scale));
  const size = px * 32;
  const font = Math.round(size * 0.5);
  context.font = `700 ${font}px ${SANS}`;
  const word = context.measureText("Leaflet").width;
  const width = size + px * 3 + word;
  const left = Math.round(align === "right" ? x - width : x);
  const top = Math.round(y);
  context.fillStyle = color;
  for (const [mx, my, length] of MARK) {
    context.fillRect(left + mx * px, top + my * px, length * px, px);
  }
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillText("Leaflet", left + size + px * 3, top + size * 0.6);
  context.textBaseline = "alphabetic";
  return width;
};

// ---- Pip --------------------------------------------------------------------------

const moveOf = (id: string): PipMove => LIB.find((move) => move.id === id) ?? LIB.find((move) => move.id === "idle") ?? LIB[0];
const looks = new Map<string, PipSkin>();
export const pipLook = (skinId = "sprout", outfit: readonly string[] = []) => {
  const key = `${skinId}|${outfit.join("+")}`;
  let look = looks.get(key);
  if (!look) {
    look = dress(SKINS.find((skin) => skin.id === skinId) ?? SKINS[0], outfit);
    looks.set(key, look);
  }
  return look;
};

let scratch: HTMLCanvasElement | null = null;
const frames = new Map<string, ImageData>();
const FRAMES_KEPT = 600;
/** One of Pip's frames, put on a 32-pixel canvas to be drawn larger. A light rim keeps her clear of a dark field. */
export const pipFrame = (moveId: string, frame: number | "poster", skinId?: string, outfit?: readonly string[], rim?: string | null) => {
  const move = moveOf(moveId);
  const at = frame === "poster" ? move.poster : ((frame % move.loop) + move.loop) % move.loop;
  const look = pipLook(skinId, outfit);
  // Each frame is a pure function of the move, the look and the frame: made once, then kept (a scene shows a few dozen).
  const key = `${move.id}|${at}|${skinId ?? ""}|${(outfit ?? []).join("+")}|${rim ?? ""}`;
  let image = frames.get(key);
  if (!image) {
    image = renderFrame(move, at, resolve(look, at), rim ? { rim } : null);
    if (frames.size >= FRAMES_KEPT) frames.clear();
    frames.set(key, image);
  }
  if (!scratch) {
    scratch = document.createElement("canvas");
    scratch.width = 32;
    scratch.height = 32;
  }
  scratch.getContext("2d")?.putImageData(image, 0, 0);
  return scratch;
};

/** Pip at a whole number of pixels per pixel of hers, the top left of her 32-pixel square at (x, y). */
export const drawPip = (context: Context, x: number, y: number, scale: number, moveId: string, skinId?: string, outfit?: readonly string[], rim?: string | null) => {
  const px = Math.max(1, Math.floor(scale));
  const frame = pipFrame(moveId, "poster", skinId, outfit, rim);
  context.imageSmoothingEnabled = false;
  context.drawImage(frame, Math.round(x), Math.round(y), px * 32, px * 32);
  context.imageSmoothingEnabled = true;
};

// ---- The scenes' pictures ---------------------------------------------------------

/** Rounded rectangle, filled. */
/** A rounded rectangle added to the path being made, so many can be filled at once. */
const traceRound = (context: Context, x: number, y: number, width: number, height: number, radius: number) => {
  const r = Math.min(radius, width / 2, height / 2);
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
};

const roundRect = (context: Context, x: number, y: number, width: number, height: number, radius: number) => {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
};

const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

/**
 * The year's calendar, its days lighting up one after another as a heat map,
 * then the longest run traced in gold. Only the months the story speaks of,
 * as many to a row as makes the days largest in the room.
 */
export const drawCalendar = (
  context: Context,
  box: Box,
  data: { year: number; months: number[]; days: Array<{ dateKey: string; minutes: number }>; runFrom: string | null; runLength: number },
  t: number,
  palette: ScenePalette
) => {
  const count = data.months.length;
  const cellFor = (columns: number) => {
    const rows = Math.ceil(count / columns);
    const gapX = box.width * 0.05;
    const monthWidth = (box.width - gapX * (columns - 1)) / columns;
    return Math.min(monthWidth / 7.4, (box.height / rows) / 8.6);
  };
  let columns = 1;
  for (const tried of [1, 2, 3, 4, 6]) {
    if (tried <= count && cellFor(tried) > cellFor(columns) + 0.01) columns = tried;
  }
  const rows = Math.ceil(count / columns);
  const cell = cellFor(columns);
  const label = Math.max(9, cell * 0.95);
  const monthHeight = label * 1.5 + cell * 1.05 * 6;
  const gapX = box.width * 0.05;
  const gapY = rows > 1 ? Math.min(cell * 1.6, (box.height - monthHeight * rows) / (rows - 1)) : 0;
  const blockWidth = cell * 7.4 * columns + gapX * (columns - 1);
  const left = box.x + (box.width - blockWidth) / 2;
  const top = box.y + Math.max(0, (box.height - monthHeight * rows - gapY * (rows - 1)) / 2);
  const minutes = new Map(data.days.map((day) => [day.dateKey, day.minutes]));
  const most = Math.max(30, ...data.days.map((day) => day.minutes));
  const run = new Set<string>();
  if (data.runFrom && data.runLength >= 3) {
    const [y, m, d] = data.runFrom.split("-").map(Number);
    for (let at = 0; at < data.runLength; at++) {
      const date = new Date(y, m - 1, d + at);
      run.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
    }
  }
  const totalDays = data.months.reduce((sum, month) => sum + daysInMonth(data.year, month), 0);
  const lit = within(t, 0, 0.72) * totalDays;
  const gold = easeOut(within(t, 0.7, 1));
  let index = 0;
  // Every cell of one look goes into one path and is filled once: a year is 365 of them, drawn every frame while
  // they light, and one fill a look (rather than one a day) is what keeps that smooth on a phone.
  const looks = new Map<string, Array<[number, number, number]>>();
  const add = (look: string, x: number, y: number, size: number) => {
    const list = looks.get(look) ?? [];
    list.push([x, y, size]);
    looks.set(look, list);
  };
  const traced: Array<[number, number, number]> = [];
  const size = cell * 0.86;
  context.fillStyle = withAlpha(palette.soft, 0.9);
  context.font = `600 ${label}px ${SANS}`;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  data.months.forEach((month, at) => {
    const column = at % columns;
    const row = Math.floor(at / columns);
    const mx = left + column * (cell * 7.4 + gapX);
    const my = top + row * (monthHeight + gapY);
    context.fillText(MONTHS[month].slice(0, 3).toUpperCase(), mx, my + label * 0.9);
    // Weeks start on Monday.
    const offset = (new Date(data.year, month, 1).getDay() + 6) % 7;
    const days = daysInMonth(data.year, month);
    for (let day = 1; day <= days; day++) {
      const slot = offset + day - 1;
      const cx = mx + (slot % 7) * cell * 1.05;
      const cy = my + label * 1.5 + Math.floor(slot / 7) * cell * 1.05;
      const key = `${data.year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const read = minutes.get(key) ?? 0;
      const shown = clamp01(lit - index);
      index += 1;
      const inRun = run.has(key) && gold > 0;
      if (read > 0 && shown > 0) {
        // The strength in ten steps: a look each.
        const strength = Math.round((0.38 + 0.62 * Math.min(1, read / most)) * shown * 10) / 10;
        const grow = 0.6 + 0.4 * shown;
        add(`${inRun ? "gold" : "lit"}|${strength}`, cx + (size * (1 - grow)) / 2, cy + (size * (1 - grow)) / 2, size * grow);
      } else {
        add("empty", cx, cy, size);
      }
      if (inRun) traced.push([cx - cell * 0.06, cy - cell * 0.06, size + cell * 0.12]);
    }
  });
  for (const [look, cells] of looks) {
    const [kind, strength] = look.split("|");
    if (kind === "empty") {
      // The empty days are faint: plain squares, which cost a phone far less than rounded ones.
      context.fillStyle = withAlpha(palette.ink, 0.08);
      for (const [x, y, side] of cells) context.fillRect(x + side * 0.04, y + side * 0.04, side * 0.92, side * 0.92);
      continue;
    }
    context.fillStyle = kind === "empty" ? withAlpha(palette.ink, 0.08) : kind === "gold" ? mix(palette.accent, palette.glow, gold) : palette.accent;
    context.globalAlpha = kind === "empty" ? 1 : Number(strength);
    context.beginPath();
    for (const [x, y, side] of cells) traceRound(context, x, y, side, side, side * 0.22);
    context.fill();
  }
  context.globalAlpha = 1;
  if (traced.length > 0) {
    context.strokeStyle = withAlpha(palette.glow, gold);
    context.lineWidth = Math.max(1.5, cell * 0.12);
    context.beginPath();
    for (const [x, y, side] of traced) traceRound(context, x, y, side, side, size * 0.3);
    context.stroke();
  }
};

const mix = (from: string, to: string, amount: number) => {
  const a = from.replace("#", "");
  const b = to.replace("#", "");
  const channel = (at: number) => Math.round(parseInt(a.slice(at, at + 2), 16) * (1 - amount) + parseInt(b.slice(at, at + 2), 16) * amount);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
};

/** The months as bars rising in turn, the busiest last and in the glow. */
export const drawBars = (context: Context, box: Box, data: { months: number[]; byMonth: number[]; busiest: number | null }, t: number, palette: ScenePalette) => {
  const count = data.months.length;
  const gap = box.width * (count > 8 ? 0.022 : 0.04);
  const bar = (box.width - gap * (count - 1)) / count;
  const labelSize = Math.max(10, Math.min(bar * 0.62, box.height * 0.07));
  const chartHeight = box.height - labelSize * 2.2;
  const most = Math.max(1, ...data.months.map((month) => data.byMonth[month]));
  // The others rise in month order over the first part; the busiest last.
  const order = data.months.filter((month) => month !== data.busiest);
  data.months.forEach((month, at) => {
    const busiest = month === data.busiest;
    const turn = busiest ? order.length : order.indexOf(month);
    const step = 0.55 / Math.max(1, order.length);
    const grow = busiest ? spring(within(t, 0.55, 0.95)) : spring(within(t, turn * step, turn * step + 0.32));
    const minutes = data.byMonth[month];
    const full = minutes > 0 ? Math.max(bar * 0.4, (minutes / most) * chartHeight) : bar * 0.18;
    const height = full * grow;
    const x = box.x + at * (bar + gap);
    const y = box.y + chartHeight - height;
    context.fillStyle = busiest ? palette.glow : withAlpha(palette.ink, minutes > 0 ? 0.28 : 0.1);
    roundRect(context, x, y, bar, Math.max(0, height), Math.min(bar * 0.3, 14));
    context.fill();
    context.fillStyle = withAlpha(palette.ink, busiest ? 1 : 0.6);
    context.font = `${busiest ? 700 : 500} ${labelSize}px ${SANS}`;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.fillText(count > 6 ? MONTHS[month][0] : MONTHS[month].slice(0, 3), x + bar / 2, box.y + chartHeight + labelSize * 1.5);
  });
  context.textAlign = "left";
};

export const drawHourglass = (context: Context, box: Box, t: number, palette: ScenePalette) => {
  const height = Math.min(box.height * 0.92, box.width * 1.4);
  const width = height * 0.58;
  const x = box.x + (box.width - width) / 2;
  const y = box.y + (box.height - height) / 2;
  const cap = height * 0.05;
  const neck = width * 0.06;
  const mid = y + height / 2;
  const inner = { top: y + cap, bottom: y + height - cap };
  const run = easeOut(within(t, 0.05, 0.9));
  const left = x + width * 0.14;
  const right = x + width * 0.86;
  const glass = (context2: Context) => {
    context2.beginPath();
    context2.moveTo(left, inner.top);
    context2.lineTo(right, inner.top);
    context2.bezierCurveTo(right + width * 0.02, mid - height * 0.14, x + width / 2 + neck, mid - height * 0.05, x + width / 2 + neck, mid);
    context2.bezierCurveTo(x + width / 2 + neck, mid + height * 0.05, right + width * 0.02, mid + height * 0.14, right, inner.bottom);
    context2.lineTo(left, inner.bottom);
    context2.bezierCurveTo(left - width * 0.02, mid + height * 0.14, x + width / 2 - neck, mid + height * 0.05, x + width / 2 - neck, mid);
    context2.bezierCurveTo(x + width / 2 - neck, mid - height * 0.05, left - width * 0.02, mid - height * 0.14, left, inner.top);
    context2.closePath();
  };
  context.save();
  glass(context);
  context.fillStyle = withAlpha(palette.ink, 0.06);
  context.fill();
  context.clip();
  context.fillStyle = palette.accent;
  // The top's sand sinks towards the neck...
  const topLevel = inner.top + (mid - inner.top) * (0.22 + 0.78 * run);
  context.fillRect(x, topLevel, width, mid - topLevel);
  // ...and the bottom's mound rises.
  const mound = (inner.bottom - mid) * (0.1 + 0.55 * run);
  context.beginPath();
  context.moveTo(x, inner.bottom);
  context.lineTo(x, inner.bottom - mound * 0.6);
  context.quadraticCurveTo(x + width / 2, inner.bottom - mound * 1.4, x + width, inner.bottom - mound * 0.6);
  context.lineTo(x + width, inner.bottom);
  context.closePath();
  context.fill();
  // The thread of sand between, while it runs.
  if (run < 0.999) {
    context.fillRect(x + width / 2 - neck * 0.2, mid, neck * 0.4, inner.bottom - mound - mid);
  }
  context.restore();
  glass(context);
  context.strokeStyle = withAlpha(palette.ink, 0.55);
  context.lineWidth = Math.max(2, width * 0.018);
  context.stroke();
  // The frame: caps and two turned posts.
  context.fillStyle = palette.ink;
  roundRect(context, x, y, width, cap, cap * 0.45);
  context.fill();
  roundRect(context, x, y + height - cap, width, cap, cap * 0.45);
  context.fill();
  const post = Math.max(3, width * 0.035);
  context.fillRect(x + width * 0.04, y + cap, post, height - cap * 2);
  context.fillRect(x + width * 0.96 - post, y + cap, post, height - cap * 2);
};

/** A book's cover where there is no picture of one: a cloth colour from its title, bands, the title set small, the author under. */
const CLOTHS = ["#2e6136", "#8a2f4a", "#24345e", "#b8742a", "#4a3672", "#1f6f78", "#7a2e12", "#3f5a44", "#a8455a"];
const hash = (text: string) => {
  let value = 2166136261;
  for (let at = 0; at < text.length; at++) {
    value = Math.imul(value ^ text.charCodeAt(at), 16777619);
  }
  return value >>> 0;
};

/** Words set in lines of at most `width`, the font shrunk until its longest word fits; at most `most` lines. */
const setWords = (context: Context, text: string, width: number, size: number, smallest: number, font: (size: number) => string, most: number) => {
  let at = size;
  const words = text.split(/\s+/).filter(Boolean);
  for (; at > smallest; at -= 1) {
    context.font = font(at);
    if (words.every((word) => context.measureText(word).width <= width)) break;
  }
  context.font = font(at);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const tried = line ? `${line} ${word}` : word;
    if (context.measureText(tried).width > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = tried;
    }
  }
  if (line) lines.push(line);
  if (lines.length > most) {
    lines.length = most;
    lines[most - 1] = `${lines[most - 1].replace(/\s+\S*$/, "")}…`;
  }
  return { size: at, lines };
};

/**
 * Covers drawn once at a size and kept: the shelf draws them every frame while
 * they drop, and setting a title is the costly part. (Not where there is no
 * document to make a canvas in: then each is drawn as it is needed.)
 */
const covers = new Map<string, HTMLCanvasElement>();
const COVERS_KEPT = 40;

const drawCover = (context: Context, x: number, y: number, width: number, height: number, book: { id: string; title: string; author?: string }, cover: CanvasImageSource | null) => {
  const ratio = Math.max(1, Math.min(3, context.getTransform?.()?.a ?? 1));
  const w = Math.round(width * ratio);
  const h = Math.round(height * ratio);
  const key = `${book.id}|${w}x${h}|${book.title}|${book.author ?? ""}|${cover ? "picture" : "cloth"}`;
  let kept = covers.get(key) ?? null;
  if (!kept && typeof document !== "undefined" && w > 0 && h > 0) {
    const made = document.createElement("canvas");
    made.width = w;
    made.height = h;
    const own = made.getContext("2d");
    if (own) {
      own.scale(ratio, ratio);
      paintCover(own, 0, 0, width, height, book, cover);
      if (covers.size >= COVERS_KEPT) covers.clear();
      covers.set(key, made);
      kept = made;
    }
  }
  if (kept) {
    // On whole pixels, so the kept picture is not resampled soft.
    context.drawImage(kept, Math.round(x * ratio) / ratio, Math.round(y * ratio) / ratio, w / ratio, h / ratio);
  } else {
    paintCover(context, x, y, width, height, book, cover);
  }
};

const paintCover = (context: Context, x: number, y: number, width: number, height: number, book: { id: string; title: string; author?: string }, cover: CanvasImageSource | null) => {
  const radius = width * 0.04;
  context.save();
  roundRect(context, x, y, width, height, radius);
  context.clip();
  if (cover) {
    context.drawImage(cover, x, y, width, height);
  } else {
    const cloth = CLOTHS[hash(book.id) % CLOTHS.length];
    context.fillStyle = cloth;
    context.fillRect(x, y, width, height);
    context.fillStyle = "rgba(255, 251, 240, 0.18)";
    context.fillRect(x, y + height * 0.1, width, height * 0.025);
    context.fillRect(x, y + height * 0.87, width, height * 0.025);
    context.fillStyle = "rgba(0, 0, 0, 0.18)";
    context.fillRect(x, y, width * 0.07, height);
    const room = width * 0.78;
    const middle = x + width * 0.535;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    if (book.title) {
      context.fillStyle = "#fffbf0";
      const set = setWords(context, book.title, room, Math.round(width * 0.135), Math.round(width * 0.075), (size) => `700 ${size}px ${SERIF}`, 4);
      set.lines.forEach((text, at) => context.fillText(text, middle, y + height * 0.27 + at * set.size * 1.18));
    }
    if (book.author) {
      context.fillStyle = "rgba(255, 251, 240, 0.72)";
      const set = setWords(context, book.author, room, Math.round(width * 0.075), Math.round(width * 0.055), (size) => `500 ${size}px ${SANS}`, 2);
      const base = y + height * 0.82 - (set.lines.length - 1) * set.size * 1.2;
      set.lines.forEach((text, at) => context.fillText(text, middle, base + at * set.size * 1.2));
    }
    context.textAlign = "left";
  }
  context.restore();
};

/** The year's finished books dropping onto shelves one after another, as many to a shelf as makes them largest in the room. */
export const drawShelf = (
  context: Context,
  box: Box,
  books: Array<{ id: string; title: string; author?: string }>,
  covers: Map<string, CanvasImageSource>,
  t: number,
  palette: ScenePalette
) => {
  const count = Math.min(books.length, 9);
  if (count === 0) return;
  const gap = box.width * 0.045;
  const sizeFor = (perRow: number) => {
    const rows = Math.ceil(count / perRow);
    const rowHeight = box.height / rows;
    return Math.min(rowHeight * 0.8, ((box.width * 0.92 - gap * (perRow - 1)) / perRow) * 1.5, box.width * 0.4 * 1.5);
  };
  let perRow = 1;
  for (let tried = 1; tried <= count; tried++) {
    if (sizeFor(tried) > sizeFor(perRow) + 0.5) perRow = tried;
  }
  const rows = Math.ceil(count / perRow);
  const rowHeight = box.height / rows;
  const coverHeight = sizeFor(perRow);
  const coverWidth = coverHeight / 1.5;
  const rowUsed = coverHeight / 0.8;
  const top = box.y + (box.height - rowUsed * rows) / 2;
  for (let row = 0; row < rows; row++) {
    const shelfY = top + rowUsed * (row + 1) - rowUsed * 0.1;
    const inRow = Math.min(perRow, count - row * perRow);
    const rowWidth = inRow * coverWidth + (inRow - 1) * gap;
    const left = box.x + (box.width - rowWidth) / 2;
    const shelfWidth = Math.min(box.width * 0.96, rowWidth + coverWidth * 0.7);
    // The shelf itself: a board with a lip.
    const board = Math.max(4, coverHeight * 0.05);
    context.fillStyle = withAlpha(palette.ink, 0.22);
    roundRect(context, box.x + (box.width - shelfWidth) / 2, shelfY, shelfWidth, board, board * 0.4);
    context.fill();
    context.fillStyle = withAlpha(palette.ink, 0.1);
    context.fillRect(box.x + (box.width - shelfWidth * 0.94) / 2, shelfY + board, shelfWidth * 0.94, board * 0.7);
    for (let at = 0; at < inRow; at++) {
      const index = row * perRow + at;
      const step = 0.7 / Math.max(1, count);
      const drop = land(within(t, index * step, index * step + 0.4));
      if (drop <= 0) continue;
      const x = left + at * (coverWidth + gap);
      const y = shelfY - coverHeight - (1 - drop) * rowHeight * 0.9;
      context.globalAlpha = clamp01(drop * 3);
      drawCover(context, x, y, coverWidth, coverHeight, books[index], covers.get(books[index].id) ?? null);
      context.globalAlpha = 1;
    }
  }
};

const BAND_NAMES: Record<TimeOfDay, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };

/**
 * The day as an arc from morning to night: four bands along it, each as
 * thick as its share of the reading and named with it, the reader's own in
 * the accent, and the sun (or the moon) travelling to it.
 */
export const drawDayArc = (context: Context, box: Box, share: DayShare, t: number, palette: ScenePalette) => {
  const label = Math.max(11, Math.min(box.width * 0.04, 30));
  // The bands' names go in a row under the horizon; the arc has the rest.
  const under = label * 3.6;
  const radius = Math.min(box.width * 0.44, (box.height - under) * 0.9);
  const cx = box.x + box.width / 2;
  const cy = box.y + (box.height - under + radius) / 2;
  const bands: TimeOfDay[] = ["morning", "afternoon", "evening", "night"];
  const grow = easeOut(within(t, 0, 0.6));
  const words = easeOut(within(t, 0.45, 0.85));
  bands.forEach((band, at) => {
    const from = Math.PI + (at / 4) * Math.PI + 0.03;
    const to = Math.PI + ((at + 1) / 4) * Math.PI - 0.03;
    const end = from + (to - from) * grow;
    const own = band === share.band;
    context.beginPath();
    context.arc(cx, cy, radius, from, end);
    context.strokeStyle = own ? palette.accent : withAlpha(palette.ink, 0.34);
    context.lineWidth = Math.max(3, radius * (0.035 + 0.2 * (share.bands[band] / 100)));
    context.lineCap = "round";
    context.stroke();
    // Its name and share, in the row under the horizon.
    if (words > 0) {
      const lx = box.x + box.width * (0.125 + at * 0.25);
      const ly = cy + label * 2;
      context.globalAlpha = words;
      context.textAlign = "center";
      context.fillStyle = own ? palette.ink : withAlpha(palette.ink, 0.75);
      context.font = `${own ? 700 : 500} ${label}px ${SANS}`;
      context.fillText(BAND_NAMES[band], lx, ly);
      context.font = `${own ? 800 : 600} ${label * 1.05}px ${SANS}`;
      context.fillText(`${share.bands[band]}%`, lx, ly + label * 1.25);
      context.globalAlpha = 1;
    }
  });
  context.textAlign = "left";
  context.lineCap = "butt";
  // The horizon.
  context.fillStyle = withAlpha(palette.ink, 0.35);
  context.fillRect(box.x + box.width * 0.04, cy + radius * 0.02, box.width * 0.92, Math.max(2, radius * 0.012));
  const index = bands.indexOf(share.band);
  const travel = spring(within(t, 0.35, 1));
  const angle = Math.PI + 0.05 + ((index + 0.5) / 4) * Math.PI * travel;
  const sx = cx + Math.cos(angle) * radius * 0.62;
  const sy = cy + Math.sin(angle) * radius * 0.62;
  const size = radius * 0.15;
  context.fillStyle = palette.glow;
  if (share.band === "night" || share.band === "evening") {
    // The moon: a crescent, its outer edge a circle and its inner an ellipse.
    context.save();
    context.translate(sx, sy);
    context.rotate(-0.5);
    context.beginPath();
    context.arc(0, 0, size, -Math.PI / 2, Math.PI / 2, true);
    context.ellipse(0, 0, size * 0.42, size, 0, Math.PI / 2, (Math.PI * 3) / 2, false);
    context.closePath();
    context.fill();
    context.restore();
  } else {
    context.beginPath();
    context.arc(sx, sy, size * 0.7, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = palette.glow;
    context.lineWidth = Math.max(2, size * 0.16);
    context.lineCap = "round";
    for (let ray = 0; ray < 8; ray++) {
      const a = (ray / 8) * Math.PI * 2;
      context.beginPath();
      context.moveTo(sx + Math.cos(a) * size * 1.0, sy + Math.sin(a) * size * 1.0);
      context.lineTo(sx + Math.cos(a) * size * 1.4, sy + Math.sin(a) * size * 1.4);
      context.stroke();
    }
    context.lineCap = "butt";
  }
};

/** A rosette behind Pip when she is dressed as the reader's kind: it turns a little as it opens. */
export const drawRosette = (context: Context, box: Box, t: number, palette: ScenePalette) => {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const grow = spring(within(t, 0, 0.6));
  const radius = Math.min(box.width, box.height) * 0.46 * grow;
  if (radius <= 0) return;
  const turn = easeOut(t) * 0.35;
  const points = 18;
  context.beginPath();
  for (let at = 0; at <= points * 2; at++) {
    const a = turn + (at / (points * 2)) * Math.PI * 2;
    const r = at % 2 === 0 ? radius : radius * 0.86;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (at === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
  context.fillStyle = withAlpha(palette.accent, 0.22);
  context.fill();
  context.beginPath();
  context.arc(cx, cy, radius * 0.74, 0, Math.PI * 2);
  context.fillStyle = withAlpha(palette.accent, 0.3);
  context.fill();
  context.strokeStyle = withAlpha(palette.ink, 0.5);
  context.lineWidth = Math.max(1.5, radius * 0.012);
  context.setLineDash([radius * 0.04, radius * 0.04]);
  context.beginPath();
  context.arc(cx, cy, radius * 0.66, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);
};

/** A stack of books lying one on another, dropping in, their titles on the spines: the author's, or the one come back to. */
export const drawStack = (context: Context, box: Box, titles: string[], t: number, palette: ScenePalette, seed: string) => {
  const random = seeded(hash(seed));
  const books = Math.max(3, Math.min(6, titles.length));
  const thick = Math.min(box.height / (books + 1.2), box.width * 0.17);
  const width = Math.min(box.width * 0.9, thick * 6.4);
  const top = box.y + (box.height - books * thick) / 2;
  for (let at = 0; at < books; at++) {
    // The bottom book first.
    const index = books - 1 - at;
    const shift = (random() - 0.5) * width * 0.12;
    const narrower = width * (0.86 + random() * 0.14);
    const drop = land(within(t, at * 0.1, at * 0.1 + 0.45));
    if (drop <= 0) continue;
    const y = top + index * thick - (1 - drop) * box.height * 0.5;
    const x = box.x + (box.width - narrower) / 2 + shift;
    const cloth = CLOTHS[(hash(seed) + at * 3) % CLOTHS.length];
    context.globalAlpha = clamp01(drop * 3);
    context.fillStyle = cloth;
    roundRect(context, x, y, narrower, thick * 0.94, thick * 0.12);
    context.fill();
    context.fillStyle = "rgba(255, 251, 240, 0.3)";
    context.fillRect(x + narrower * 0.06, y, thick * 0.12, thick * 0.94);
    context.fillRect(x + narrower * 0.94 - thick * 0.12, y, thick * 0.12, thick * 0.94);
    const title = titles[at] ?? "";
    if (title) {
      context.fillStyle = "#fffbf0";
      context.textAlign = "center";
      context.textBaseline = "middle";
      let size = Math.round(thick * 0.36);
      context.font = `700 ${size}px ${SERIF}`;
      while (size > 8 && context.measureText(title).width > narrower * 0.72) {
        size -= 1;
        context.font = `700 ${size}px ${SERIF}`;
      }
      let shown = title;
      while (shown.length > 2 && context.measureText(shown).width > narrower * 0.72) shown = `${shown.slice(0, -2)}…`;
      context.fillText(shown, x + narrower / 2, y + thick * 0.48);
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
    } else {
      context.fillStyle = "rgba(255, 251, 240, 0.55)";
      context.fillRect(x + narrower * 0.3, y + thick * 0.42, narrower * 0.4, thick * 0.1);
    }
    context.globalAlpha = 1;
  }
};

/** The Hollow's road of chapters, climbing: from where the year began to where it ended, the King's banners flying at the top. */
export const drawChapterRoad = (context: Context, box: Box, hollow: HollowYear, t: number, palette: ScenePalette) => {
  const span = Math.max(1, hollow.chapterTo - hollow.chapterFrom);
  const stops = Math.min(8, span + 1);
  const points = Array.from({ length: stops }, (_, at) => {
    const f = stops === 1 ? 1 : at / (stops - 1);
    return {
      x: box.x + box.width * (0.5 + Math.sin(f * Math.PI * 1.5 + 0.3) * 0.28),
      y: box.y + box.height * (0.88 - f * 0.74),
      chapter: Math.round(hollow.chapterFrom + f * span)
    };
  });
  // The road, drawn as far as the climb has come.
  const climb = easeOut(within(t, 0.05, 0.8));
  context.strokeStyle = withAlpha(palette.ink, 0.25);
  context.lineWidth = Math.max(3, box.width * 0.022);
  context.lineCap = "round";
  context.setLineDash([box.width * 0.012, box.width * 0.03]);
  context.beginPath();
  points.forEach((point, at) => (at === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
  context.stroke();
  context.setLineDash([]);
  context.strokeStyle = palette.accent;
  context.beginPath();
  const reach = climb * (points.length - 1);
  points.forEach((point, at) => {
    if (at > Math.ceil(reach)) return;
    const prev = points[at - 1];
    if (at === 0) context.moveTo(point.x, point.y);
    else if (at <= reach) context.lineTo(point.x, point.y);
    else context.lineTo(prev.x + (point.x - prev.x) * (reach - (at - 1)), prev.y + (point.y - prev.y) * (reach - (at - 1)));
  });
  context.stroke();
  context.lineCap = "butt";
  const node = Math.max(6, box.width * 0.03);
  points.forEach((point, at) => {
    const lit = reach >= at - 0.001;
    const ends = at === 0 || at === points.length - 1;
    const pop = spring(within(t, 0.05 + (at / stops) * 0.75, 0.3 + (at / stops) * 0.75));
    const r = (ends ? node * 2.1 : node) * (lit ? 0.75 + 0.25 * pop : 0.75);
    context.beginPath();
    context.arc(point.x, point.y, r, 0, Math.PI * 2);
    context.fillStyle = lit ? palette.accent : withAlpha(palette.ink, 0.25);
    context.fill();
    if (ends) {
      context.fillStyle = lit ? palette.field[1] : palette.ink;
      context.font = `800 ${Math.round(r * 0.95)}px ${SANS}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(point.chapter), point.x, point.y + r * 0.05);
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
    }
  });
  // The banners won, flying beside the top.
  const top = points[points.length - 1];
  const banners = Math.min(hollow.banners, 5);
  const pole = node * 5;
  for (let at = 0; at < banners; at++) {
    const rise = spring(within(t, 0.78 + at * 0.04, 1));
    if (rise <= 0) continue;
    const side = top.x > box.x + box.width / 2 ? -1 : 1;
    const bx = top.x + side * (node * 3.6 + at * node * 2.4);
    const by = top.y - pole * 0.65;
    context.fillStyle = withAlpha(palette.ink, 0.7);
    context.fillRect(bx, by, Math.max(2, node * 0.3), pole);
    context.fillStyle = palette.glow;
    const lift = pole * (1 - rise) * 0.5;
    context.beginPath();
    context.moveTo(bx, by + lift);
    context.lineTo(bx + node * 1.9, by + pole * 0.17 + lift);
    context.lineTo(bx, by + pole * 0.34 + lift);
    context.closePath();
    context.fill();
  }
};

/** Study cards fanned out like a hand from a point low in the room, the learnt ones ticked at their corners. */
export const drawDeck = (context: Context, box: Box, made: number, learnt: number, t: number, palette: ScenePalette) => {
  const cards = Math.max(3, Math.min(7, Math.max(made, learnt)));
  const ticked = made > 0 ? Math.max(learnt > 0 ? 1 : 0, Math.round((Math.min(learnt, made) / made) * cards)) : cards;
  const step = 0.17;
  const reach = ((cards - 1) / 2) * step;
  const height = Math.min(box.height * 0.82, (box.width * 0.46) / (Math.sin(reach) + 0.36));
  const width = height * 0.7;
  const pivotX = box.x + box.width / 2;
  const pivotY = box.y + box.height * 0.5 + height * 0.5;
  const spread = spring(within(t, 0.05, 0.75));
  for (let at = 0; at < cards; at++) {
    const angle = (at - (cards - 1) / 2) * step * spread;
    context.save();
    context.translate(pivotX, pivotY);
    context.rotate(angle);
    const x = -width / 2;
    const y = -height;
    context.fillStyle = "#fffbf0";
    roundRect(context, x, y, width, height, width * 0.08);
    context.fill();
    context.strokeStyle = withAlpha(palette.ink, 0.22);
    context.lineWidth = Math.max(1.5, width * 0.012);
    context.stroke();
    context.fillStyle = withAlpha(palette.ink, 0.13);
    for (let line = 0; line < 3; line++) {
      context.fillRect(x + width * 0.3, y + height * (0.12 + line * 0.09), width * (line === 2 ? 0.34 : 0.56), height * 0.035);
    }
    const tickFrom = 0.55 + (at / cards) * 0.3;
    if (at < ticked && t >= tickFrom) {
      const pop = spring(within(t, tickFrom, tickFrom + 0.2));
      const r = width * 0.1 * pop;
      const tx = x + width * 0.15;
      const ty = y + width * 0.15;
      context.fillStyle = palette.accent;
      context.beginPath();
      context.arc(tx, ty, r, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#fffbf0";
      context.lineWidth = Math.max(1.5, r * 0.24);
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(tx - r * 0.42, ty);
      context.lineTo(tx - r * 0.08, ty + r * 0.34);
      context.lineTo(tx + r * 0.46, ty - r * 0.32);
      context.stroke();
      context.lineCap = "butt";
    }
    context.restore();
  }
};

/** Pages lifted out of the book, as they hang at the opening's end, around Pip and clear of her (the moving ones are `Particles.tsx`'s). */
export const drawRestingPages = (context: Context, box: Box, palette: ScenePalette, seed = 2026, opacity = 1) => {
  const random = seeded(seed);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const count = 10;
  for (let at = 0; at < count; at++) {
    const angle = (at / count) * Math.PI * 2 + random() * 0.4;
    const reach = 0.36 + random() * 0.12;
    const x = cx + Math.cos(angle) * box.width * reach;
    const y = cy + Math.sin(angle) * box.height * reach * 0.9;
    const size = Math.min(box.width, box.height * 0.7) * (0.06 + random() * 0.045);
    context.save();
    context.translate(x, y);
    context.rotate((random() - 0.5) * 1.1);
    context.globalAlpha = opacity * (0.55 + random() * 0.4);
    context.fillStyle = at % 4 === 0 ? palette.accent : "#fffbf0";
    context.fillRect(-size / 2, -size * 0.65, size, size * 1.3);
    context.fillStyle = withAlpha(palette.field[1], 0.35);
    context.fillRect(-size * 0.32, -size * 0.35, size * 0.64, size * 0.07);
    context.fillRect(-size * 0.32, -size * 0.1, size * 0.64, size * 0.07);
    context.fillRect(-size * 0.32, size * 0.15, size * 0.4, size * 0.07);
    context.restore();
  }
  context.globalAlpha = 1;
};

/** Confetti as it lies at the summary's end. */
export const drawRestingConfetti = (context: Context, box: Box, palette: ScenePalette, seed = 12, count = 34) => {
  const random = seeded(seed);
  const colours = [palette.accent, palette.glow, "#fffbf0", "#72ab44", "#b5d294"];
  for (let at = 0; at < count; at++) {
    const x = box.x + random() * box.width;
    const y = box.y + random() * box.height;
    const size = box.width * (0.008 + random() * 0.012);
    context.save();
    context.translate(x, y);
    context.rotate(random() * Math.PI);
    context.globalAlpha = 0.55 + random() * 0.4;
    context.fillStyle = colours[at % colours.length];
    context.fillRect(-size, -size * 0.45, size * 2, size * 0.9);
    context.restore();
  }
  context.globalAlpha = 1;
};
