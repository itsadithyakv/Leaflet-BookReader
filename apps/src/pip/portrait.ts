/**
 * Pip as a profile picture: how the 32px sprite is drawn into a round frame.
 *
 * A sprite's canvas is mostly room for props: a standing Pip is 22 by 27 of
 * its 32 pixels. Sized by the canvas, and only at whole device pixels per
 * sprite pixel, a profile picture came out far smaller than its frame: in the
 * header at 125% display scaling, a 32px drawing in a 58px button.
 *
 * A portrait is sized by Pip instead. The scale is the largest whole number
 * at which a standing Pip still fits the frame, and the drawing is centred on
 * its art, not on the canvas. Whatever the pose keeps beyond that (a prop at
 * arm's length) is cropped by the round frame, the way any profile picture is.
 * The scale depends on the frame alone, so every Pip on a board is the same
 * size whatever it is doing.
 *
 * Pure, so the rule can be tested without a canvas; PipSprite draws by it.
 */

/** A sprite's canvas, in sprite pixels. */
export const SPRITE_PX = 32;
/** A standing Pip from the tip of its leaf to its soles, in sprite pixels: what a frame must show. */
export const PORTRAIT_PX = 27;
/** A drawn pixel counts as art from this alpha up; the ground shadow under Pip is fainter. */
const SOLID_ALPHA = 128;
/** The top rows of the art (the leaf's tip, a hat's crown) that a tight frame keeps. */
const HEAD_ROWS = 3;
/** The frame may nick this many of their pixels (the one at the very tip of the leaf). */
const HEAD_NICK = 1;
/** How far, in sprite pixels, the drawing moves down to keep the rest. */
const MAX_DROP = 2;

/** An image as a canvas gives it: RGBA bytes, row by row. */
export type Pixels = { data: ArrayLike<number>; width: number; height: number };
/** Which sprite pixels are drawn, and the box around them (inclusive). */
export type Art = { solid: Uint8Array; left: number; top: number; right: number; bottom: number };

/** Whole device pixels per sprite pixel for a round frame this many device pixels across. */
export const portraitScale = (frame: number) => Math.max(1, Math.floor(frame / PORTRAIT_PX + 1e-6));

/**
 * The art in one frame, or in all of the given frames together: a move that
 * plays is framed by everywhere it goes, so the picture does not shift as it
 * moves. Null when nothing is drawn.
 */
export const artOf = (frames: readonly Pixels[]): Art | null => {
  const solid = new Uint8Array(SPRITE_PX * SPRITE_PX);
  let left = SPRITE_PX;
  let top = SPRITE_PX;
  let right = -1;
  let bottom = -1;
  for (const frame of frames) {
    const width = Math.min(SPRITE_PX, frame.width);
    const height = Math.min(SPRITE_PX, frame.height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (frame.data[(y * frame.width + x) * 4 + 3] < SOLID_ALPHA) {
          continue;
        }
        solid[y * SPRITE_PX + x] = 1;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return right < 0 ? null : { solid, left, top, right, bottom };
};

/**
 * How many pixels of the art, in sprite rows `from` to `to`, a round frame
 * cuts when the sprite's top-left corner is at (x, y) in a canvas `frame`
 * device pixels across. A pixel is cut when any corner of it is outside.
 */
const cutPixels = (art: Art, frame: number, perPixel: number, x: number, y: number, from = art.top, to = art.bottom) => {
  const middle = frame / 2;
  let cut = 0;
  for (let row = from; row <= to; row++) {
    const dy = Math.max(Math.abs(y + row * perPixel - middle), Math.abs(y + (row + 1) * perPixel - middle));
    for (let column = art.left; column <= art.right; column++) {
      if (!art.solid[row * SPRITE_PX + column]) {
        continue;
      }
      const dx = Math.max(Math.abs(x + column * perPixel - middle), Math.abs(x + (column + 1) * perPixel - middle));
      if (Math.hypot(dx, dy) > middle) {
        cut += 1;
      }
    }
  }
  return cut;
};

/**
 * Where the sprite goes in a square canvas `frame` device pixels across (the
 * round frame is the circle inside it): its scale, and its top-left corner in
 * whole device pixels, so every sprite pixel lands on the pixel grid.
 *
 * The middle of the art sits in the middle of the frame, as nearly as whole
 * pixels allow; of the placements either side of that, the one the frame cuts
 * least. When the frame would still cut into the top of the art, the drawing
 * moves down a little if that saves it, so a tight frame trims Pip's feet
 * rather than the crown of its hat. A prop far out to one side that no small
 * move can save is left to the crop.
 */
export const portraitPlacement = (frame: number, art: Art | null) => {
  const perPixel = portraitScale(frame);
  if (!art) {
    const corner = Math.round((frame - SPRITE_PX * perPixel) / 2) + 0;
    return { perPixel, x: corner, y: corner };
  }
  const idealX = frame / 2 - ((art.left + art.right + 1) / 2) * perPixel;
  const idealY = frame / 2 - ((art.top + art.bottom + 1) / 2) * perPixel;
  let best = { x: Math.floor(idealX), y: Math.floor(idealY), cut: Infinity };
  // Lower first, so that of two equal crops the one that shows more head wins.
  for (const y of new Set([Math.ceil(idealY), Math.floor(idealY)])) {
    for (const x of new Set([Math.floor(idealX), Math.ceil(idealX)])) {
      const cut = cutPixels(art, frame, perPixel, x, y);
      if (cut < best.cut) {
        best = { x, y, cut };
      }
    }
  }
  const headEnd = Math.min(art.bottom, art.top + HEAD_ROWS - 1);
  const headCut = (y: number) => cutPixels(art, frame, perPixel, best.x, y, art.top, headEnd);
  let y = best.y;
  if (headCut(y) > HEAD_NICK) {
    for (let drop = 1; drop <= MAX_DROP * perPixel; drop++) {
      if (headCut(best.y + drop) <= HEAD_NICK) {
        y = best.y + drop;
        break;
      }
    }
  }
  // "+ 0" keeps a -0 out of the result.
  return { perPixel, x: best.x + 0, y: y + 0 };
};
