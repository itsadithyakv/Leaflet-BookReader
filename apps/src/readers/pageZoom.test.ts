import { describe, expect, it } from "vitest";
import {
  MAX_CANVAS_PIXELS,
  MAX_ZOOM,
  MIN_ZOOM,
  PDF_ACTUAL_SCALE,
  anchoredScroll,
  canvasPixelRatio,
  clampZoom,
  scaleFor,
  steppedZoom,
  wheelZoom,
  zoomPercent,
  type FitOptions
} from "./pageZoom";

const a4 = { width: 595, height: 842 };
const room = (fit: FitOptions["fit"], zoom = 1.15): FitOptions => ({
  fit,
  zoom,
  availableWidth: 900,
  availableHeight: 700
});

describe("how large a page is drawn", () => {
  it("fits the page's width to the room", () => {
    expect(scaleFor(a4, room("width"), PDF_ACTUAL_SCALE)).toBeCloseTo(900 / 595, 6);
  });

  it("fits the whole page: whichever of width and height is the tighter", () => {
    expect(scaleFor(a4, room("page"), PDF_ACTUAL_SCALE)).toBeCloseTo(700 / 842, 6);
    const landscape = { width: 842, height: 400 };
    expect(scaleFor(landscape, room("page"), PDF_ACTUAL_SCALE)).toBeCloseTo(900 / 842, 6);
  });

  it("shows a PDF at the size it prints, and a comic pixel for pixel", () => {
    expect(scaleFor(a4, room("actual"), PDF_ACTUAL_SCALE)).toBeCloseTo(96 / 72, 6);
    expect(scaleFor({ width: 1600, height: 2400 }, room("actual"), 1)).toBe(1);
  });

  it("uses the reader's own zoom when free, kept between a quarter and four times the actual size", () => {
    expect(scaleFor(a4, room("free", 1.5), PDF_ACTUAL_SCALE)).toBe(1.5);
    expect(scaleFor(a4, room("free", 99), PDF_ACTUAL_SCALE)).toBeCloseTo(MAX_ZOOM * PDF_ACTUAL_SCALE, 3);
    expect(scaleFor(a4, room("free", 0.01), PDF_ACTUAL_SCALE)).toBeCloseTo(MIN_ZOOM * PDF_ACTUAL_SCALE, 3);
    expect(scaleFor(a4, room("free", Number.NaN), PDF_ACTUAL_SCALE)).toBeCloseTo(PDF_ACTUAL_SCALE, 3);
  });

  it("does not blow a small page up to fill a wide window", () => {
    expect(scaleFor({ width: 100, height: 150 }, room("width"), 1)).toBe(2.4);
  });

  it("brings a large scan down to the window rather than past its edge", () => {
    // A comic page 3,000 pixels wide in a 900 pixel room.
    expect(scaleFor({ width: 3000, height: 4500 }, room("width"), 1)).toBeCloseTo(0.3, 6);
  });
});

describe("zooming", () => {
  it("steps in and out by the same amount, so out undoes in", () => {
    const zoomedIn = steppedZoom(1, 1, 1);
    expect(zoomedIn).toBeCloseTo(1.2, 3);
    expect(steppedZoom(zoomedIn, -1, 1)).toBeCloseTo(1, 3);
  });

  it("stops at the ends", () => {
    expect(steppedZoom(MAX_ZOOM, 1, 1)).toBe(MAX_ZOOM);
    expect(steppedZoom(MIN_ZOOM, -1, 1)).toBe(MIN_ZOOM);
    expect(clampZoom(10, PDF_ACTUAL_SCALE)).toBeCloseTo(4 * PDF_ACTUAL_SCALE, 3);
  });

  it("zooms in when the wheel is turned away, and out when towards", () => {
    expect(wheelZoom(1, -100, 1)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100, 1)).toBeLessThan(1);
    expect(wheelZoom(1, 0, 1)).toBe(1);
  });

  it("moves no more than one step for one turn, however hard the wheel reports it", () => {
    expect(wheelZoom(1, -5000, 1)).toBeCloseTo(1.2, 3);
    expect(wheelZoom(1, 5000, 1)).toBeCloseTo(1 / 1.2, 3);
  });

  it("moves a little for each small move of a pinch", () => {
    const pinched = wheelZoom(1, -4, 1);
    expect(pinched).toBeGreaterThan(1);
    expect(pinched).toBeLessThan(1.02);
  });

  it("shows the scale as a percentage of the actual size", () => {
    expect(zoomPercent(PDF_ACTUAL_SCALE, PDF_ACTUAL_SCALE)).toBe(100);
    expect(zoomPercent(2, PDF_ACTUAL_SCALE)).toBe(150);
    expect(zoomPercent(0.5, 1)).toBe(50);
  });
});

describe("a canvas within the memory budget", () => {
  it("uses the screen's own density for a page of ordinary size", () => {
    expect(canvasPixelRatio(900, 1270, 2)).toBe(2);
    expect(canvasPixelRatio(900, 1270, 1)).toBe(1);
    // A screen that reports less than one is treated as one.
    expect(canvasPixelRatio(900, 1270, 0.5)).toBe(1);
  });

  it("draws a page zoomed far in a little softer rather than past the budget", () => {
    const ratio = canvasPixelRatio(3173, 4490, 2);
    expect(ratio).toBeLessThan(2);
    expect(3173 * 4490 * ratio * ratio).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1);
  });
});

describe("keeping the place while the page changes size", () => {
  it("puts the same point of the page back under the same point of the window", () => {
    // The page starts 56px into the content. The reader was looking at the
    // point 40% down a page 1,000 tall, 300px below the top of the window.
    const before = anchoredScroll(56, 1000, 0.4, 300);
    expect(before).toBe(156);
    // Zoomed to twice the size, that point is 800 down the page.
    expect(anchoredScroll(56, 2000, 0.4, 300)).toBe(556);
  });

  it("does not scroll before the start", () => {
    expect(anchoredScroll(56, 400, 0.1, 500)).toBe(0);
  });
});
