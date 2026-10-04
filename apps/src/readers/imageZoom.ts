/**
 * Looking at a picture from the book properly: fitted to the window, then
 * zoomed about the pointer and dragged around. Pure geometry; the viewer
 * (readers/ImageViewer.tsx) draws it.
 *
 * A view is a scale and an offset: the picture's centre sits `x`, `y` pixels
 * from the middle of the window.
 */

export type Size = { width: number; height: number };
export type ZoomView = { scale: number; x: number; y: number };

/** A picture smaller than this on the page is an ornament or a drop cap, and opens no viewer. */
export const MIN_VIEWABLE = 48;
export const isViewable = (width: number, height: number) => width >= MIN_VIEWABLE && height >= MIN_VIEWABLE;

/** Room left around a fitted picture, each side. */
export const FIT_MARGIN = 24;
/** One press of + or -, one notch of the wheel. */
export const ZOOM_STEP = 1.25;

/** The scale at which the whole picture shows. A small picture is not blown up past twice its size. */
export const fitScale = (picture: Size, window: Size) => {
  if (picture.width <= 0 || picture.height <= 0) {
    return 1;
  }
  const room = { width: Math.max(1, window.width - 2 * FIT_MARGIN), height: Math.max(1, window.height - 2 * FIT_MARGIN) };
  return Math.min(room.width / picture.width, room.height / picture.height, 2);
};

/** From the fitted size up to eight times the picture's own (or the fit, if that is more). */
export const zoomLimits = (picture: Size, window: Size) => {
  const fit = fitScale(picture, window);
  return { min: fit, max: Math.max(8, fit * 4) };
};

/**
 * Keeps the picture in reach: one that fits stays centred, a larger one can
 * be dragged until its edge reaches the window's.
 */
export const clampView = (view: ZoomView, picture: Size, window: Size): ZoomView => {
  const limits = zoomLimits(picture, window);
  const scale = Math.min(limits.max, Math.max(limits.min, view.scale));
  const slack = (shown: number, room: number) => Math.max(0, (shown - room) / 2);
  const maxX = slack(picture.width * scale, window.width);
  const maxY = slack(picture.height * scale, window.height);
  return { scale, x: Math.min(maxX, Math.max(-maxX, view.x)), y: Math.min(maxY, Math.max(-maxY, view.y)) };
};

export const fitView = (picture: Size, window: Size): ZoomView => ({ scale: fitScale(picture, window), x: 0, y: 0 });

/**
 * Zooms by `factor` keeping the point under the pointer where it is. `at` is
 * the pointer from the middle of the window; left out, the middle is kept.
 */
export const zoomAt = (view: ZoomView, factor: number, picture: Size, window: Size, at = { x: 0, y: 0 }): ZoomView => {
  const limits = zoomLimits(picture, window);
  const scale = Math.min(limits.max, Math.max(limits.min, view.scale * factor));
  const ratio = scale / view.scale;
  return clampView({ scale, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio }, picture, window);
};

export const panBy = (view: ZoomView, dx: number, dy: number, picture: Size, window: Size) =>
  clampView({ scale: view.scale, x: view.x + dx, y: view.y + dy }, picture, window);
