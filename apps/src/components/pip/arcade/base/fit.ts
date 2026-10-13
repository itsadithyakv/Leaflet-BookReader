/**
 * How big a pixel picture is shown in the room there is for it.
 *
 * Pixel art looks best at a whole number of screen pixels to each of its
 * own, and that is what it gets wherever that nearly fills the room. In a
 * narrow window it does not: the next whole size down can leave a third of
 * the width empty, and the picture is then too small to point at. There it
 * is sized to fill the room instead, drawn at the next whole size up and
 * brought down smoothly, so every pixel is still the same size as its
 * neighbours and only a little soft at its edge.
 */

export type Fit = {
  /** CSS pixels to each art pixel: the size on the page. */
  css: number;
  /** Canvas pixels to each art pixel, a whole number: the size it is drawn at. */
  backing: number;
  /** Drawn at the very size it is shown: its pixels are left hard-edged. */
  crisp: boolean;
};

/** How much of the room a whole-pixel size may leave empty before the picture is sized to fill it. */
export const WASTE_ALLOWED = 0.25;

export const fitPicture = (artWidth: number, artHeight: number, boxWidth: number, boxHeight: number, ratio = 1, waste = WASTE_ALLOWED): Fit => {
  const scale = ratio > 0 ? ratio : 1;
  // Screen pixels to each art pixel, were the picture to fill the room exactly.
  const exact = Math.max(0.1, Math.min((boxWidth * scale) / artWidth, (boxHeight * scale) / artHeight));
  const whole = Math.floor(exact + 1e-6);
  if (whole >= 1 && whole >= exact * (1 - waste)) return { css: whole / scale, backing: whole, crisp: true };
  return { css: exact / scale, backing: Math.max(1, Math.ceil(exact - 1e-6)), crisp: false };
};

/** The room's ratio, where there is a window to ask. */
export const screenRatio = () => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

/** Readies a canvas of that fit for drawing in art pixels: everything drawn after is that many times as large, with hard edges. */
export const drawAt = (ctx: CanvasRenderingContext2D, fit: Fit) => {
  ctx.setTransform(fit.backing, 0, 0, fit.backing, 0, 0);
  ctx.imageSmoothingEnabled = false;
};
