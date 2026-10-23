/**
 * Looking at a picture from the book properly: fitted to the window, then
 * zoomed about the pointer or between the fingers, and dragged around. Pure
 * geometry; the viewer (readers/ImageViewer.tsx) draws it.
 *
 * A view is a scale and an offset: the picture's centre sits `x`, `y` pixels
 * from the middle of the window. Points given to the gestures here are from
 * the middle of the window too (`fromMiddle`).
 */

export type Size = { width: number; height: number };
export type ZoomView = { scale: number; x: number; y: number };
export type Point = { x: number; y: number };

/** A picture smaller than this on the page is an ornament or a drop cap, and opens no viewer. */
export const MIN_VIEWABLE = 48;
export const isViewable = (width: number, height: number) => width >= MIN_VIEWABLE && height >= MIN_VIEWABLE;

/**
 * A picture the page shows much smaller than it is (a map wider than the
 * column, a plate scaled down): it has more to see, and the page marks it
 * with the magnifier chip (readers/pictures.ts).
 */
export const BIG_PICTURE_SHARE = 1.25;
export const isBigPicture = (shown: Size, natural: Size) =>
  shown.width >= 120 &&
  shown.height >= 80 &&
  (natural.width > shown.width * BIG_PICTURE_SHARE || natural.height > shown.height * BIG_PICTURE_SHARE);

/** Room left around a fitted picture, each side. */
export const FIT_MARGIN = 24;
/** One press of + or -, one notch of the wheel. */
export const ZOOM_STEP = 1.25;
/** In at least this far: three screen pixels to one of the picture's, so a map's smallest print can be read. */
export const MAX_PIXEL_SCALE = 3;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The scale at which the whole picture shows. A small picture is not blown up past twice its size. */
export const fitScale = (picture: Size, window: Size) => {
  if (picture.width <= 0 || picture.height <= 0) {
    return 1;
  }
  const room = { width: Math.max(1, window.width - 2 * FIT_MARGIN), height: Math.max(1, window.height - 2 * FIT_MARGIN) };
  return Math.min(room.width / picture.width, room.height / picture.height, 2);
};

/**
 * From the fitted size up past the picture's own pixels (three screen pixels
 * to one), and for a small or coarse picture four times the fit, whichever is
 * further.
 */
export const zoomLimits = (picture: Size, window: Size) => {
  const fit = fitScale(picture, window);
  return { min: fit, max: Math.max(MAX_PIXEL_SCALE, fit * 4) };
};

/** How far the picture's centre may be from the window's on one axis: none while it fits, to its edge when larger. */
const slack = (shown: number, room: number) => Math.max(0, (shown - room) / 2);

/**
 * Keeps the picture in reach: one that fits stays centred, a larger one can
 * be dragged until its edge reaches the window's.
 */
export const clampView = (view: ZoomView, picture: Size, window: Size): ZoomView => {
  const limits = zoomLimits(picture, window);
  const scale = Math.min(limits.max, Math.max(limits.min, view.scale));
  const maxX = slack(picture.width * scale, window.width);
  const maxY = slack(picture.height * scale, window.height);
  return { scale, x: Math.min(maxX, Math.max(-maxX, view.x)), y: Math.min(maxY, Math.max(-maxY, view.y)) };
};

export const fitView = (picture: Size, window: Size): ZoomView => ({ scale: fitScale(picture, window), x: 0, y: 0 });

/** Whether the picture is at (or about) its fitted size. */
export const isAtFit = (view: ZoomView, picture: Size, window: Size) => view.scale <= fitScale(picture, window) * 1.02;

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

/** A point of the window as the views have it: from the window's middle. */
export const fromMiddle = (point: Point, window: Size): Point => ({ x: point.x - window.width / 2, y: point.y - window.height / 2 });

/** The point between the fingers (the one finger, when there is one). */
export const centreOf = (points: Point[]): Point => {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
};

/** How far apart the first two fingers are (0 with fewer). */
export const spreadOf = (points: Point[]) => (points.length < 2 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));

/** While fingers are down the picture may go a little past its limits, and settles back when they lift. */
export const GESTURE_UNDER = 0.7;
export const GESTURE_OVER = 1.25;
/** Past the edge a drag moves the picture this much of the way: it pulls, and comes back. */
export const RUBBER = 0.3;

/**
 * The view while fingers (or the mouse) are on the picture: what was under
 * the point between them where they went down (`from`) stays under that
 * point now (`to`), scaled by how far they have moved apart. One finger
 * drags. Both lists are from the middle of the window, the same length.
 *
 * Nothing jumps when a gesture begins: the picture may be where the page had
 * it (a pinch carried over from the page, off the middle), and only taking it
 * out of the window, or further out than it began, is resisted.
 */
export const gestureView = (start: ZoomView, from: Point[], to: Point[], picture: Size, window: Size): ZoomView => {
  const limits = zoomLimits(picture, window);
  const before = spreadOf(from);
  const now = spreadOf(to);
  const factor = before > 0 && now > 0 ? now / before : 1;
  const low = Math.min(limits.min, start.scale) * GESTURE_UNDER;
  const high = Math.max(limits.max, start.scale) * GESTURE_OVER;
  const scale = clamp(start.scale * factor, low, high);
  const ratio = scale / start.scale;
  const c0 = centreOf(from);
  const c1 = centreOf(to);
  const raw = { x: c1.x - (c0.x - start.x) * ratio, y: c1.y - (c0.y - start.y) * ratio };
  const pull = (value: number, reach: number) => {
    const past = Math.abs(value) - reach;
    return past <= 0 ? value : Math.sign(value) * (reach + past * RUBBER);
  };
  // Free within the window (a picture smaller than it goes anywhere in it, a
  // larger one to its edges), and as far out as it began.
  const reach = (shown: number, room: number, began: number) => Math.max(Math.abs(shown - room) / 2, Math.abs(began));
  return {
    scale,
    x: pull(raw.x, reach(picture.width * scale, window.width, start.x)),
    y: pull(raw.y, reach(picture.height * scale, window.height, start.y))
  };
};

/**
 * Where the picture comes to rest once the fingers lift: within its limits
 * (zoomed back about `at`, the last point between the fingers, when it went
 * past the largest), and within reach.
 */
export const settleView = (view: ZoomView, picture: Size, window: Size, at: Point = { x: 0, y: 0 }): ZoomView => {
  const limits = zoomLimits(picture, window);
  if (view.scale > limits.max) {
    const ratio = limits.max / view.scale;
    return clampView({ scale: limits.max, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio }, picture, window);
  }
  return clampView(view, picture, window);
};

/**
 * A double tap: from the fit, in about the tapped point (two and a half
 * times the fit, or the picture's own pixels when they are not far beyond
 * that); from any closer view, back to the fit.
 */
export const doubleTapView = (view: ZoomView, picture: Size, window: Size, at: Point): ZoomView => {
  const fit = fitScale(picture, window);
  if (view.scale > fit * 1.05) {
    return fitView(picture, window);
  }
  const limits = zoomLimits(picture, window);
  const target = Math.min(limits.max, Math.max(fit * 2.5, Math.min(1, fit * 4)));
  return zoomAt(view, target / view.scale, picture, window, at);
};

/**
 * How much a turn of the wheel zooms. A mouse sends a notch at a time (about
 * 100 px) and is one step; a touchpad's pinch (the wheel with Ctrl, as the
 * browser sends it) a stream of small ones, each worth more.
 */
export const wheelFactor = (deltaY: number, deltaMode: number, pinch: boolean) => {
  const pixels = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 800 : deltaY;
  return clamp(Math.exp(-pixels * (pinch ? 0.01 : 0.0025)), 1 / ZOOM_STEP, ZOOM_STEP);
};

/**
 * The view that shows the picture exactly where the page has it (`rect`, in
 * the window): where a pinch begun on the page carries on from.
 */
export const handoverView = (
  rect: { left: number; top: number; width: number; height: number },
  picture: Size,
  window: Size
): ZoomView => ({
  scale: picture.width > 0 ? rect.width / picture.width : 1,
  x: rect.left + rect.width / 2 - window.width / 2,
  y: rect.top + rect.height / 2 - window.height / 2
});

/** A second tap within this long, and this near, is a double tap. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 32;
/** A press that moves less than this, and lifts this soon, is a tap. */
export const TAP_MOVE_PX = 10;
export const TAP_MS = 350;

export const isViewerTap = (moved: number, ms: number) => moved < TAP_MOVE_PX && ms < TAP_MS;

export const isViewerDoubleTap = (first: { at: number; x: number; y: number } | null, second: { at: number; x: number; y: number }) =>
  first !== null && second.at - first.at <= DOUBLE_TAP_MS && Math.hypot(second.x - first.x, second.y - first.y) <= DOUBLE_TAP_PX;

/** A drag down from the fitted picture closes it, past this far, or a quick flick. */
export const CLOSE_SWIPE_PX = 110;

/** Whether a drag at the fit is a swipe down to close (or, said early, is heading that way: `committed` false). */
export const isCloseSwipe = (dx: number, dy: number, ms: number, committed = true) => {
  if (dy <= 0 || dy < Math.abs(dx) * 1.2) {
    return false;
  }
  if (!committed) {
    return dy > TAP_MOVE_PX;
  }
  return dy >= CLOSE_SWIPE_PX || (dy >= 40 && dy / Math.max(1, ms) > 0.5);
};

/** How faded the room round the picture is, swiping it away: 1 (none) to 0.25. */
export const closeShade = (dy: number, window: Size) => 1 - 0.75 * clamp(dy / Math.max(1, window.height * 0.45), 0, 1);
