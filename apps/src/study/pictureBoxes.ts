/**
 * The boxes drawn over a picture for picture cards: from the pointer's place
 * on the screen to fractions of the picture (so a box is right at any zoom,
 * on any screen, on another device), and back.
 *
 * The view is the picture viewer's (readers/imageZoom.ts): the picture's
 * centre sits `x`, `y` pixels from the middle of the stage, drawn at `scale`.
 *
 * Pure.
 */
import type { Point, Size, ZoomView } from "../readers/imageZoom";
import type { Rect } from "./cards";

/** A box smaller than this either way is a slip of the finger, not a label. */
export const MIN_BOX = 0.01;
/** Around the boxes, the part of a PDF's page a card shows: this much of the page more on each side. */
export const CROP_MARGIN = 0.06;
/** A part shown is at least this much of the page either way, so a box is seen with its picture. */
export const MIN_CROP = 0.3;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** A point of the stage (from its top left) on the picture, in fractions of it (outside it: below 0 or above 1). */
export const toPicture = (point: Point, stage: Size, view: ZoomView, natural: Size): Point => ({
  x: (point.x - stage.width / 2 - view.x) / (natural.width * view.scale) + 0.5,
  y: (point.y - stage.height / 2 - view.y) / (natural.height * view.scale) + 0.5
});

/** A part of the picture on the stage, in pixels from its top left. */
export const toStage = (rect: Rect, stage: Size, view: ZoomView, natural: Size): Rect => {
  const width = natural.width * view.scale;
  const height = natural.height * view.scale;
  const left = stage.width / 2 + view.x - width / 2;
  const top = stage.height / 2 + view.y - height / 2;
  return { left: left + rect.left * width, top: top + rect.top * height, width: rect.width * width, height: rect.height * height };
};

/** The box between two corners, inside the picture. */
export const boxBetween = (a: Point, b: Point): Rect => {
  const left = clamp01(Math.min(a.x, b.x));
  const top = clamp01(Math.min(a.y, b.y));
  return { left, top, width: clamp01(Math.max(a.x, b.x)) - left, height: clamp01(Math.max(a.y, b.y)) - top };
};

/** Whether a box drawn is one to keep. */
export const isBox = (rect: Rect) => rect.width >= MIN_BOX && rect.height >= MIN_BOX;

/** The last box (the one on top) under a point of the picture; -1 for none. */
export const boxAt = (point: Point, boxes: Rect[]) => {
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const box = boxes[index];
    if (point.x >= box.left && point.x <= box.left + box.width && point.y >= box.top && point.y <= box.top + box.height) {
      return index;
    }
  }
  return -1;
};

/** A box moved by a step (fractions of the picture), kept inside it. */
export const moveBox = (box: Rect, dx: number, dy: number): Rect => ({
  ...box,
  left: Math.min(1 - box.width, Math.max(0, box.left + dx)),
  top: Math.min(1 - box.height, Math.max(0, box.top + dy))
});

const grow = (start: number, size: number, least: number) => {
  if (size >= least) return { start, size };
  const middle = start + size / 2;
  const from = Math.min(1 - least, Math.max(0, middle - least / 2));
  return { start: from, size: least };
};

/** The part of the picture the stage shows at this view, in fractions of the picture. */
export const visiblePart = (stage: Size, view: ZoomView, natural: Size): Rect =>
  boxBetween(toPicture({ x: 0, y: 0 }, stage, view, natural), toPicture({ x: stage.width, y: stage.height }, stage, view, natural));

/**
 * The part of a PDF's page a card shows: what the reader was looking at
 * when the boxes were kept (zoomed in on a figure, the figure; at the fit,
 * the page), and every box with a margin round it, never less than
 * `MIN_CROP` of the page either way. Null for the whole page (no boxes, or
 * most of it). Not the boxes alone: labels down one side would cut the
 * figure they name out of the card.
 */
export const cropAround = (boxes: Rect[], seen: Rect | null = null): Rect | null => {
  if (boxes.length === 0) {
    return null;
  }
  let left = clamp01(Math.min(...boxes.map((box) => box.left)) - CROP_MARGIN);
  let top = clamp01(Math.min(...boxes.map((box) => box.top)) - CROP_MARGIN);
  let right = clamp01(Math.max(...boxes.map((box) => box.left + box.width)) + CROP_MARGIN);
  let bottom = clamp01(Math.max(...boxes.map((box) => box.top + box.height)) + CROP_MARGIN);
  if (seen) {
    left = Math.min(left, clamp01(seen.left));
    top = Math.min(top, clamp01(seen.top));
    right = Math.max(right, clamp01(seen.left + seen.width));
    bottom = Math.max(bottom, clamp01(seen.top + seen.height));
  }
  const across = grow(left, right - left, MIN_CROP);
  const down = grow(top, bottom - top, MIN_CROP);
  if (across.size * down.size > 0.85) {
    return null;
  }
  return { left: across.start, top: down.start, width: across.size, height: down.size };
};

/** A box of the picture as a part of what is shown of it (the crop), for drawing it there. */
export const withinCrop = (box: Rect, crop: Rect | null): Rect =>
  crop
    ? {
        left: (box.left - crop.left) / crop.width,
        top: (box.top - crop.top) / crop.height,
        width: box.width / crop.width,
        height: box.height / crop.height
      }
    : box;

/**
 * The view after the stage changes size (the bar under it grows a row, a
 * phone turns, the keyboard comes): the picture stays where it was on the
 * screen, rather than sliding to the new middle under the reader's finger.
 * A box drawn just after is then where the reader saw the label.
 */
export const keepStill = (view: ZoomView, from: Size, to: Size): ZoomView => ({
  ...view,
  x: view.x + (from.width - to.width) / 2,
  y: view.y + (from.height - to.height) / 2
});

/** Around the covered box in review, this much of the box's own size more on each side... */
export const MASK_MARGIN = 0.04;
/** ...and never less than this many pixels, so no anti-aliased edge of a letter peeks out. */
export const MASK_MIN_PX = 2;

/** Where the picture is drawn, in pixels, inside what holds it (its padding and border already counted in `left` and `top`). */
export type Placed = { left: number; top: number; width: number; height: number };

/**
 * The covered box in review, in pixels of what holds the picture: the box
 * (a fraction of the whole picture) placed on the part shown (`crop`, a PDF
 * page's cut-out), at the size the picture is drawn, a margin round it, kept
 * on the picture. The one mapping review uses, so maker and review agree
 * whatever the zoom the box was drawn at, the screen's pixel ratio, or the
 * frame's padding.
 */
export const maskOnImage = (mask: Rect, crop: Rect | null, image: Placed): Rect => {
  const part = withinCrop(mask, crop);
  const left = image.left + part.left * image.width;
  const top = image.top + part.top * image.height;
  const width = part.width * image.width;
  const height = part.height * image.height;
  const across = Math.max(MASK_MIN_PX, width * MASK_MARGIN);
  const down = Math.max(MASK_MIN_PX, height * MASK_MARGIN);
  const x0 = Math.max(image.left, left - across);
  const y0 = Math.max(image.top, top - down);
  const x1 = Math.min(image.left + image.width, left + width + across);
  const y1 = Math.min(image.top + image.height, top + height + down);
  return { left: x0, top: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
};

/**
 * The pixels of a drawn page that make a PDF card's cut-out: where it starts
 * and how large it is, whole pixels (study/pictureSource.ts cuts with these).
 */
export const cropPixels = (sheet: Size, part: Rect) => ({
  x: Math.round(sheet.width * part.left),
  y: Math.round(sheet.height * part.top),
  width: Math.max(1, Math.round(sheet.width * part.width)),
  height: Math.max(1, Math.round(sheet.height * part.height))
});
