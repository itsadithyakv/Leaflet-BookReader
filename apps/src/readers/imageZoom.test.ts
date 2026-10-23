import { describe, expect, it } from "vitest";
import {
  CLOSE_SWIPE_PX, FIT_MARGIN, MAX_PIXEL_SCALE, centreOf, clampView, closeShade, doubleTapView, fitScale, fitView, fromMiddle,
  gestureView, handoverView, isAtFit, isBigPicture, isCloseSwipe, isViewable, isViewerDoubleTap, isViewerTap, panBy, settleView,
  wheelFactor, zoomAt, zoomLimits, type ZoomView
} from "./imageZoom";

const map = { width: 1600, height: 1200 };
const win = { width: 1024, height: 768 };

describe("looking at a picture", () => {
  it("opens for a picture, not for an ornament or a drop cap", () => {
    expect(isViewable(400, 300)).toBe(true);
    expect(isViewable(32, 32)).toBe(false);
    expect(isViewable(600, 20)).toBe(false);
  });

  it("fits the whole picture in the window, with a little room", () => {
    const scale = fitScale(map, win);
    expect(map.width * scale).toBeLessThanOrEqual(win.width - 2 * FIT_MARGIN + 0.001);
    expect(map.height * scale).toBeLessThanOrEqual(win.height - 2 * FIT_MARGIN + 0.001);
    // A tall picture is held by its height.
    expect(fitScale({ width: 600, height: 2400 }, win)).toBeCloseTo((win.height - 2 * FIT_MARGIN) / 2400);
    // A small one is not blown up past twice its size.
    expect(fitScale({ width: 100, height: 80 }, win)).toBe(2);
    expect(fitView(map, win)).toEqual({ scale: fitScale(map, win), x: 0, y: 0 });
  });

  it("zooms about the pointer: what is under it stays under it", () => {
    const start = fitView(map, win);
    const at = { x: 200, y: -100 };
    const zoomed = zoomAt(start, 2, map, win, at);
    expect(zoomed.scale).toBeCloseTo(start.scale * 2);
    expect(under(zoomed, at).x).toBeCloseTo(under(start, at).x);
    expect(under(zoomed, at).y).toBeCloseTo(under(start, at).y);
  });

  it("stops at the fitted size going out, and at a limit going in", () => {
    const limits = zoomLimits(map, win);
    const fitted = fitView(map, win);
    expect(zoomAt(fitted, 0.5, map, win)).toEqual(fitted);
    let view = fitted;
    for (let step = 0; step < 40; step += 1) {
      view = zoomAt(view, 1.25, map, win);
    }
    expect(view.scale).toBe(limits.max);
    // Past the picture's own pixels, however large it is...
    expect(limits.max).toBeGreaterThanOrEqual(1);
    expect(zoomLimits({ width: 9000, height: 6000 }, { width: 400, height: 800 }).max).toBe(MAX_PIXEL_SCALE);
    // ...and a small or coarse map four times past its fit.
    const coarse = { width: 300, height: 200 };
    const phone = { width: 400, height: 800 };
    expect(zoomLimits(coarse, phone).max).toBeCloseTo(fitScale(coarse, phone) * 4);
  });

  it("keeps a picture that fits in the middle, and a larger one within reach", () => {
    const fitted = fitView(map, win);
    expect(panBy(fitted, 300, 300, map, win)).toEqual(fitted);
    const close = zoomAt(fitted, 4, map, win);
    const dragged = panBy(close, 10_000, -10_000, map, win);
    // Its left edge has reached the window's, and its bottom edge the bottom.
    expect(dragged.x).toBeCloseTo((map.width * close.scale - win.width) / 2);
    expect(dragged.y).toBeCloseTo(-(map.height * close.scale - win.height) / 2);
  });

  it("comes back to the middle when zoomed out again", () => {
    const fitted = fitView(map, win);
    const out = zoomAt(panBy(zoomAt(fitted, 4, map, win), 500, 200, map, win), 0.01, map, win);
    expect(out.scale).toBeCloseTo(fitted.scale);
    expect(Math.abs(out.x)).toBe(0);
    expect(Math.abs(out.y)).toBe(0);
    // A window resized under a zoomed picture pulls it back into reach.
    const small = clampView({ scale: 3, x: 4000, y: 0 }, map, { width: 500, height: 400 });
    expect(small.x).toBeCloseTo((map.width * 3 - 500) / 2);
  });
});

/** The picture point under a point (from the window's middle), for a view. */
function under(view: ZoomView, at: { x: number; y: number }) {
  return { x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale };
}

describe("a pinch on the picture", () => {
  const phone = { width: 400, height: 800 };

  it("keeps what was between the fingers between them, as they spread and move", () => {
    const start = zoomAt(fitView(map, phone), 2, map, phone);
    const from = [{ x: -40, y: 10 }, { x: 40, y: 10 }];
    const to = [{ x: -90, y: 30 }, { x: 90, y: 30 }];
    const view = gestureView(start, from, to, map, phone);
    expect(view.scale).toBeCloseTo(start.scale * (180 / 80));
    const before = under(start, centreOf(from));
    const after = under(view, centreOf(to));
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("drags with one finger, and pulls back past the edge", () => {
    const start = zoomAt(fitView(map, phone), 4, map, phone);
    const free = gestureView(start, [{ x: 0, y: 0 }], [{ x: 30, y: -20 }], map, phone);
    expect(free.scale).toBe(start.scale);
    expect(free.x).toBeCloseTo(start.x + 30);
    expect(free.y).toBeCloseTo(start.y - 20);
    // Far past the edge it moves a third of the way, and comes to rest at the edge.
    const reach = (map.width * start.scale - phone.width) / 2;
    const far = gestureView(start, [{ x: 0, y: 0 }], [{ x: reach + 300, y: 0 }], map, phone);
    expect(far.x).toBeLessThan(reach + 300);
    expect(far.x).toBeGreaterThan(reach);
    expect(settleView(far, map, phone).x).toBeCloseTo(reach);
  });

  it("goes a little past its limits while held, and settles within them", () => {
    const fitted = fitView(map, phone);
    const out = gestureView(fitted, [{ x: -100, y: 0 }, { x: 100, y: 0 }], [{ x: -20, y: 0 }, { x: 20, y: 0 }], map, phone);
    expect(out.scale).toBeLessThan(fitted.scale);
    expect(settleView(out, map, phone)).toEqual(fitted);
    const limits = zoomLimits(map, phone);
    const close = { scale: limits.max, x: 0, y: 0 };
    const past = gestureView(close, [{ x: -10, y: 0 }, { x: 10, y: 0 }], [{ x: -100, y: 0 }, { x: 100, y: 0 }], map, phone);
    expect(past.scale).toBeGreaterThan(limits.max);
    expect(past.scale).toBeLessThanOrEqual(limits.max * 1.25 + 1e-9);
    // Back to the largest about the fingers: the point between them stays put.
    const at = { x: 30, y: 0 };
    const rest = settleView(past, map, phone, at);
    expect(rest.scale).toBe(limits.max);
    expect(under(rest, at).x).toBeCloseTo(under(past, at).x);
  });
});

describe("a pinch carried over from the page", () => {
  const phone = { width: 400, height: 800 };
  // The map as the page showed it: the column's width, low on the screen.
  const rect = { left: 30, top: 500, width: 340, height: 255 };

  it("starts with the picture exactly where the page had it", () => {
    const view = handoverView(rect, map, phone);
    expect(map.width * view.scale).toBeCloseTo(rect.width);
    expect(view.x + phone.width / 2).toBeCloseTo(rect.left + rect.width / 2);
    expect(view.y + phone.height / 2).toBeCloseTo(rect.top + rect.height / 2);
  });

  it("does not jump on its first move, and zooms about the fingers from there", () => {
    const start = handoverView(rect, map, phone);
    const fingers = [fromMiddle({ x: 150, y: 620 }, phone), fromMiddle({ x: 250, y: 620 }, phone)];
    // The same fingers: the same view, though it is off the middle.
    expect(gestureView(start, fingers, fingers, map, phone)).toEqual(start);
    // Spread, and moved a little towards the middle (further out than it began, it would pull).
    const spread = [fromMiddle({ x: 100, y: 600 }, phone), fromMiddle({ x: 300, y: 600 }, phone)];
    const view = gestureView(start, fingers, spread, map, phone);
    expect(view.scale).toBeCloseTo(start.scale * 2);
    expect(under(view, centreOf(spread)).x).toBeCloseTo(under(start, centreOf(fingers)).x);
    expect(under(view, centreOf(spread)).y).toBeCloseTo(under(start, centreOf(fingers)).y);
  });

  it("comes to rest within reach when let go", () => {
    const start = handoverView(rect, map, phone);
    const rest = settleView(start, map, phone);
    expect(rest).toEqual(clampView(start, map, phone));
    expect(isAtFit(rest, map, phone)).toBe(true);
    expect(rest.x).toBe(0);
    expect(rest.y).toBe(0);
  });
});

describe("taps, the wheel and a swipe in the viewer", () => {
  const phone = { width: 400, height: 800 };

  it("zooms in about a double tap, and back out to the fit", () => {
    const fitted = fitView(map, phone);
    const at = { x: 60, y: -20 };
    const close = doubleTapView(fitted, map, phone, at);
    expect(close.scale).toBeGreaterThanOrEqual(fitted.scale * 2.5 - 1e-9);
    expect(under(close, at).x).toBeCloseTo(under(fitted, at).x);
    expect(doubleTapView(close, map, phone, at)).toEqual(fitted);
    // A coarse little map goes no further than its limit.
    const coarse = { width: 300, height: 200 };
    expect(doubleTapView(fitView(coarse, phone), coarse, phone, at).scale).toBeLessThanOrEqual(zoomLimits(coarse, phone).max);
  });

  it("tells a tap and a double tap", () => {
    expect(isViewerTap(4, 120)).toBe(true);
    expect(isViewerTap(14, 120)).toBe(false);
    expect(isViewerTap(2, 600)).toBe(false);
    const first = { at: 0, x: 100, y: 100 };
    expect(isViewerDoubleTap(null, first)).toBe(false);
    expect(isViewerDoubleTap(first, { at: 250, x: 110, y: 104 })).toBe(true);
    expect(isViewerDoubleTap(first, { at: 400, x: 100, y: 100 })).toBe(false);
    expect(isViewerDoubleTap(first, { at: 100, x: 180, y: 100 })).toBe(false);
  });

  it("zooms a notch of the wheel a step, and a touchpad's pinch in small even steps", () => {
    expect(wheelFactor(-100, 0, false)).toBeCloseTo(1.25);
    expect(wheelFactor(100, 0, false)).toBeCloseTo(0.8);
    expect(wheelFactor(-3, 1, false)).toBeCloseTo(1.25);
    const pinch = wheelFactor(-4, 0, true);
    expect(pinch).toBeGreaterThan(1.02);
    expect(pinch).toBeLessThan(1.1);
  });

  it("closes on a swipe down from the fit, not on a drag across", () => {
    expect(isCloseSwipe(0, CLOSE_SWIPE_PX, 400)).toBe(true);
    expect(isCloseSwipe(0, 60, 80)).toBe(true);
    expect(isCloseSwipe(0, 60, 400)).toBe(false);
    expect(isCloseSwipe(120, 100, 100)).toBe(false);
    expect(isCloseSwipe(0, -200, 100)).toBe(false);
    expect(isCloseSwipe(2, 14, 0, false)).toBe(true);
    expect(closeShade(0, phone)).toBe(1);
    expect(closeShade(10_000, phone)).toBeCloseTo(0.25);
  });
});

describe("a big picture on the page", () => {
  it("is one shown much smaller than it is", () => {
    expect(isBigPicture({ width: 364, height: 243 }, { width: 2400, height: 1600 })).toBe(true);
    expect(isBigPicture({ width: 300, height: 200 }, { width: 300, height: 200 })).toBe(false);
    expect(isBigPicture({ width: 60, height: 60 }, { width: 600, height: 600 })).toBe(false);
  });
});
