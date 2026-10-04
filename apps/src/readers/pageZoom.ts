/**
 * How large a page is drawn in the page reader.
 *
 * Three fits and a free zoom, as a PDF reader has them: the page's width to
 * the window's, the whole page inside the window, the page at its actual
 * size, or whatever the reader zoomed to. A "scale" here is what the page
 * sources draw with: CSS pixels per PDF point, or per pixel of a comic's
 * image. Percentages shown to the reader are of the actual size, so 100% is
 * the size the page was made to be.
 */

export type PageFit = "width" | "page" | "actual" | "free";

export type FitOptions = {
  fit: PageFit;
  /** The scale used when `fit` is "free". */
  zoom: number;
  /** The room the page has, in CSS pixels. */
  availableWidth: number;
  availableHeight: number;
};

/** A PDF point is 1/72 inch and a CSS pixel 1/96: this scale shows a PDF page at the size it prints. */
export const PDF_ACTUAL_SCALE = 96 / 72;

/** A small page is not blown up past this to fill a wide window. */
const MAX_FIT_SCALE = 2.4;
const MIN_FIT_SCALE = 0.05;
/** Free zoom, as multiples of the actual size. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/** One press of + or -, and one notch of the wheel at most. */
export const ZOOM_STEP = 1.2;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export const clampZoom = (scale: number, actualScale: number) =>
  Number(clamp(scale, MIN_ZOOM * actualScale, MAX_ZOOM * actualScale).toFixed(3));

/** The scale a page of this natural size is drawn at. */
export const scaleFor = (
  natural: { width: number; height: number },
  options: FitOptions,
  actualScale: number
) => {
  const width = Math.max(1, natural.width);
  const height = Math.max(1, natural.height);
  if (options.fit === "width") {
    return clamp(options.availableWidth / width, MIN_FIT_SCALE, MAX_FIT_SCALE);
  }
  if (options.fit === "page") {
    return clamp(
      Math.min(options.availableWidth / width, options.availableHeight / height),
      MIN_FIT_SCALE,
      MAX_FIT_SCALE
    );
  }
  if (options.fit === "actual") {
    return actualScale;
  }
  return clampZoom(Number.isFinite(options.zoom) && options.zoom > 0 ? options.zoom : actualScale, actualScale);
};

/** The scale one step in (1) or out (-1) from `scale`. */
export const steppedZoom = (scale: number, direction: 1 | -1, actualScale: number) =>
  clampZoom(direction > 0 ? scale * ZOOM_STEP : scale / ZOOM_STEP, actualScale);

/**
 * The scale after a turn of the wheel with Ctrl held. A mouse wheel sends a
 * notch at a time (deltaY about 100) and a touchpad pinch a stream of small
 * ones; both come out even, and no single event moves more than one step.
 */
export const wheelZoom = (scale: number, deltaY: number, actualScale: number) => {
  const factor = clamp(Math.exp(-deltaY * 0.0018), 1 / ZOOM_STEP, ZOOM_STEP);
  return clampZoom(scale * factor, actualScale);
};

/** What the reader is shown: the scale as a percentage of the actual size. */
export const zoomPercent = (scale: number, actualScale: number) => Math.round((scale / actualScale) * 100);

/**
 * How many device pixels a canvas may hold per CSS pixel. A page zoomed far
 * in on a dense screen would otherwise ask for a canvas of hundreds of
 * megabytes (and the toned copy of it again); past the budget the page is
 * drawn a little softer instead of not at all.
 */
export const MAX_CANVAS_PIXELS = 1 << 24;

export const canvasPixelRatio = (
  width: number,
  height: number,
  devicePixelRatio: number,
  maxPixels = MAX_CANVAS_PIXELS
) => {
  const wanted = Math.max(1, devicePixelRatio || 1);
  const area = Math.max(1, width * height);
  return Math.min(wanted, Math.sqrt(maxPixels / area));
};

/**
 * Keeps the place while the page changes size: the scroll position that puts
 * the same point of the page (`fraction` of its width or height) back under
 * the same point of the window (`offset` from the stage's edge).
 * `pageStart` is where the page begins inside the scrolling content.
 */
export const anchoredScroll = (pageStart: number, pageSize: number, fraction: number, offset: number) =>
  Math.max(0, pageStart + pageSize * fraction - offset);
