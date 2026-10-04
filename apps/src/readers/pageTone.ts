/**
 * The page finish, for PDFs.
 *
 * A PDF page is a picture: pdf.js draws it black on white whatever finish the
 * reader chose, so "Dark paper" and "True black" changed everything around
 * the page and left the page itself a white rectangle. Here the drawn page is
 * re-toned to the finish: its paper takes the finish's page colour and its ink
 * the finish's text colour.
 *
 * On a dark finish the lightness of every pixel is turned over while its hue
 * is kept (a blue link stays blue, a red heading red), and photographs are
 * left as they were drawn: a negative of a photograph is no use to anyone.
 * Line art, scans of text and flat-colour charts are turned with the page, so
 * they do not sit on it as white boxes. Pure, so the rules can be tested
 * without a canvas.
 */

import type { ThemeMode } from "../store/appearanceStore";
import { getReaderFinish } from "./finish";
import type { ReaderDisplayMode } from "./readerTypes";

export type Rgb = [number, number, number];

export type PageTone = {
  /** A dark page: lightness is turned over. A light one is only tinted. */
  dark: boolean;
  /** What the page's white becomes. */
  paper: Rgb;
  /** What its black becomes. */
  ink: Rgb;
};

/** A drawn picture's place on the canvas, in canvas pixels. */
export type PixelRect = { x: number; y: number; width: number; height: number };

const parseHex = (hex: string): Rgb => {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value;
  const number = Number.parseInt(full.slice(0, 6), 16);
  return Number.isFinite(number) ? [(number >> 16) & 255, (number >> 8) & 255, number & 255] : [255, 255, 255];
};

/** The tone for a finish, or null where the page is shown as drawn (True white). */
export const pageToneFor = (displayMode: ReaderDisplayMode, theme: ThemeMode): PageTone | null => {
  if (displayMode === "true-white") {
    return null;
  }
  const finish = getReaderFinish(displayMode, theme);
  return {
    dark: finish.themeName === "leaflet-dark",
    paper: parseHex(finish.background),
    ink: parseHex(finish.text)
  };
};

export const toneCss = (colour: Rgb) => `rgb(${colour[0]}, ${colour[1]}, ${colour[2]})`;

/**
 * Re-tones RGBA pixels in place. Dark: each pixel's lightness is turned over
 * with its hue and colourfulness kept (adding the same amount to all three
 * channels moves lightness and nothing else), then white-to-black is laid
 * onto paper-to-ink. Light: black-to-white is laid onto ink-to-paper.
 */
export const tonePixels = (data: Uint8ClampedArray, tone: PageTone) => {
  const [from, to] = tone.dark ? [tone.paper, tone.ink] : [tone.ink, tone.paper];
  const table = [0, 1, 2].map((channel) => {
    const values = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v += 1) {
      values[v] = Math.round(from[channel] + (v * (to[channel] - from[channel])) / 255);
    }
    return values;
  });
  const [red, green, blue] = table;
  if (!tone.dark) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = red[data[i]];
      data[i + 1] = green[data[i + 1]];
      data[i + 2] = blue[data[i + 2]];
    }
    return;
  }
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    const shift = 255 - max - min;
    data[i] = red[r + shift];
    data[i + 1] = green[g + shift];
    data[i + 2] = blue[b + shift];
  }
};

/** Pictures smaller than this on a side (canvas pixels) are turned with the page: bullets, rules, icons. */
export const MIN_PICTURE_SIDE = 40;

const SAMPLES_A_SIDE = 48;
const LUM_BINS = 32;

/**
 * Whether a drawn picture is a photograph (kept as drawn on a dark page) or
 * something that belongs to the page (turned with it).
 *
 * A photograph has tones all the way along: many levels of lightness, each
 * with a fair share of the picture. A scan of text is paper and ink, however
 * yellow the paper or soft the letters; a chart or a diagram is a few flat
 * colours. So: paper-and-ink is never a photograph, and otherwise a picture
 * is one when its lightness is spread over many levels.
 */
export const looksLikePhoto = (data: Uint8ClampedArray, canvasWidth: number, rect: PixelRect) => {
  const bins = new Array<number>(LUM_BINS).fill(0);
  const lums: number[] = [];
  const stepX = Math.max(1, rect.width / SAMPLES_A_SIDE);
  const stepY = Math.max(1, rect.height / SAMPLES_A_SIDE);
  for (let y = rect.y + stepY / 2; y < rect.y + rect.height; y += stepY) {
    for (let x = rect.x + stepX / 2; x < rect.x + rect.width; x += stepX) {
      const i = (Math.floor(y) * canvasWidth + Math.floor(x)) * 4;
      if (i < 0 || i + 2 >= data.length) {
        continue;
      }
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      lums.push(lum);
      bins[Math.min(LUM_BINS - 1, Math.floor((lum / 256) * LUM_BINS))] += 1;
    }
  }
  const counted = lums.length;
  if (counted < 64) {
    return false;
  }
  // The paper: the lightness most of the picture has, give or take a level.
  let mode = 0;
  for (let bin = 1; bin < LUM_BINS; bin += 1) {
    if (bins[bin] > bins[mode]) {
      mode = bin;
    }
  }
  const paper = (bins[mode - 1] ?? 0) + bins[mode] + (bins[mode + 1] ?? 0);
  const paperLum = ((mode + 0.5) * 256) / LUM_BINS;
  const ink = lums.reduce((sum, lum) => sum + (lum < paperLum * 0.5 ? 1 : 0), 0);
  const paperAndInk = paperLum >= 140 && paper / counted >= 0.45 && (paper + ink) / counted >= 0.78;
  if (paperAndInk) {
    return false;
  }
  const levels = bins.reduce((sum, bin) => sum + (bin / counted >= 0.012 ? 1 : 0), 0);
  return levels >= 9;
};

/** A pixel of white ground: light, and with no colour to speak of. */
const isGround = (r: number, g: number, b: number) => {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  return min >= 232 && max - min <= 20;
};

/** How much of a picture's edge must be white for it to count as drawn on white. */
const GROUND_EDGE_SHARE = 0.7;

/**
 * A picture kept as drawn on a dark page (a photograph, an illuminated
 * initial, an illustration) is put back with its own colours. One drawn on a
 * white ground would then sit in a bright white box on the dark page. Here
 * the white the picture stands on is given the page's colour instead: where
 * most of the picture's edge is white, the white that reaches the edge
 * becomes `paper`, and the drawing is left alone. White the edge does not
 * reach (an eye, a highlight) is part of the drawing and stays. The drawing's
 * outermost pixels, which were smoothed against white, are smoothed against
 * the page instead, so no white fringe is left round it.
 *
 * `data` is the picture's own pixels (RGBA, `width` by `height`), changed in
 * place. Returns false, and changes nothing, for a picture that fills its
 * frame (a photograph to its edges).
 */
export const clearWhiteGround = (data: Uint8ClampedArray, width: number, height: number, paper: Rgb) => {
  if (width < 3 || height < 3 || data.length < width * height * 4) {
    return false;
  }
  const groundAt = (index: number) => isGround(data[index * 4], data[index * 4 + 1], data[index * 4 + 2]);
  // 1 where the ground has been reached from the edge.
  const cleared = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let queued = 0;
  let edge = 0;
  let edgeGround = 0;
  const seed = (index: number) => {
    edge += 1;
    if (groundAt(index)) {
      edgeGround += 1;
      if (cleared[index] === 0) {
        cleared[index] = 1;
        queue[queued] = index;
        queued += 1;
      }
    }
  };
  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  if (edgeGround / edge < GROUND_EDGE_SHARE) {
    return false;
  }
  const reach = (index: number) => {
    if (cleared[index] === 0 && groundAt(index)) {
      cleared[index] = 1;
      queue[queued] = index;
      queued += 1;
    }
  };
  for (let next = 0; next < queued; next += 1) {
    const index = queue[next];
    const x = index % width;
    if (x > 0) {
      reach(index - 1);
    }
    if (x < width - 1) {
      reach(index + 1);
    }
    if (index >= width) {
      reach(index - width);
    }
    if (index < width * (height - 1)) {
      reach(index + width);
    }
  }
  for (let index = 0; index < cleared.length; index += 1) {
    if (cleared[index] === 1) {
      data[index * 4] = paper[0];
      data[index * 4 + 1] = paper[1];
      data[index * 4 + 2] = paper[2];
      continue;
    }
    // The rim of the drawing: a pixel beside the ground was smoothed with
    // white. Its lowest channel says how much white is in it (exactly, for a
    // pure colour); that much of it becomes the page instead.
    const x = index % width;
    const y = (index - x) / width;
    let beside = false;
    for (let dy = -1; dy <= 1 && !beside; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && cleared[ny * width + nx] === 1) {
          beside = true;
          break;
        }
      }
    }
    if (!beside) {
      continue;
    }
    const at = index * 4;
    const white = Math.min(data[at], data[at + 1], data[at + 2]);
    if (white < 48) {
      continue;
    }
    const share = white / 255;
    data[at] = Math.round(data[at] - share * (255 - paper[0]));
    data[at + 1] = Math.round(data[at + 1] - share * (255 - paper[1]));
    data[at + 2] = Math.round(data[at + 2] - share * (255 - paper[2]));
  }
  return true;
};

/**
 * Where a picture drawn at (x, y, width, height) under a canvas transform
 * lands, as a whole-pixel rectangle clipped to the canvas, or null when it is
 * off it or too small to be a picture worth keeping.
 */
export const drawnRect = (
  matrix: { a: number; b: number; c: number; d: number; e: number; f: number },
  x: number,
  y: number,
  width: number,
  height: number,
  canvasWidth: number,
  canvasHeight: number
): PixelRect | null => {
  const corners = [
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height]
  ].map(([px, py]) => [matrix.a * px + matrix.c * py + matrix.e, matrix.b * px + matrix.d * py + matrix.f]);
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(canvasWidth, Math.ceil(Math.max(...xs)));
  const bottom = Math.min(canvasHeight, Math.ceil(Math.max(...ys)));
  if (!(right - left >= MIN_PICTURE_SIDE) || !(bottom - top >= MIN_PICTURE_SIDE)) {
    return null;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
};
