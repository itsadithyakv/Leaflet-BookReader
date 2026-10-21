import { describe, expect, it } from "vitest";
import { band, boundsOf, canPan, cardSide, centredOn, isDrag, rangeOf, rubber, showIn, stepGlide, velocityOf, awayFrom, easeTo, TAP_SLOP, type Glide } from "./camera";

describe("where the camera may go", () => {
  it("is from the picture's left edge to its right, less the screen; a picture smaller than the screen sits in the middle", () => {
    expect(rangeOf(240, 192)).toEqual({ min: 0, max: 48 });
    expect(rangeOf(240, 240)).toEqual({ min: 0, max: 0 });
    expect(rangeOf(100, 120)).toEqual({ min: -10, max: -10 });
    const bounds = boundsOf({ w: 240, h: 120 }, { w: 192, h: 86 });
    expect(bounds).toEqual({ x: { min: 0, max: 48 }, y: { min: 0, max: 34 } });
    expect(canPan(bounds)).toBe(true);
    expect(canPan(boundsOf({ w: 240, h: 120 }, { w: 240, h: 130 }))).toBe(false);
  });

  it("goes a little past an edge for a drag past it, less and less, and never more than the slack", () => {
    const range = { min: 0, max: 48 };
    expect(rubber(20, range, 10)).toBe(20);
    expect(rubber(-1, range, 10)).toBeLessThan(0);
    expect(rubber(-1, range, 10)).toBeGreaterThan(-1);
    // The further the drag, the further it goes, but slower each time and never past the slack.
    const shown = [5, 20, 80, 400, 5000].map((over) => range.max + band(over, 10));
    for (let at = 1; at < shown.length; at++) expect(shown[at]).toBeGreaterThan(shown[at - 1]);
    expect(shown[shown.length - 1]).toBeLessThan(range.max + 10);
    expect(rubber(48 + 80, range, 10) - 48).toBeLessThan(80 / 4);
    expect(band(10, 0)).toBe(0);
  });
});

describe("a press on the picture", () => {
  it("is a tap until it has moved more than a few pixels, and a drag after", () => {
    expect(TAP_SLOP).toBe(8);
    expect(isDrag(3, 4)).toBe(false);
    expect(isDrag(5, 5)).toBe(false);
    expect(isDrag(8, 1)).toBe(true);
    expect(isDrag(0, -9)).toBe(true);
  });

  it("knows how fast the finger was going when it let go, from its last moves", () => {
    expect(velocityOf([])).toEqual({ vx: 0, vy: 0 });
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 50, x: 10, y: 0 },
      { t: 100, x: 30, y: 5 },
      { t: 116, x: 40, y: 5 }
    ];
    const { vx, vy } = velocityOf(samples);
    // Over the last 90 ms or more: from the first sample, 116 ms before the last.
    expect(vx).toBeCloseTo(40 / 116);
    expect(vy).toBeCloseTo(5 / 116);
  });
});

describe("a flick", () => {
  const bounds = { x: { min: 0, max: 48 }, y: { min: 0, max: 34 } };
  const run = (from: Glide, ms = 4000) => {
    let glide = { ...from, done: false };
    const path: number[] = [glide.x];
    for (let time = 0; time < ms && !glide.done; time += 16) {
      glide = stepGlide(glide, bounds, 16, 11);
      path.push(glide.x);
    }
    return { glide, path };
  };

  it("carries on, slows, and stops inside the picture", () => {
    const { glide, path } = run({ x: 10, y: 10, vx: 0.05, vy: 0 });
    expect(glide.done).toBe(true);
    expect(glide.x).toBeGreaterThan(10);
    expect(glide.x).toBeLessThanOrEqual(48);
    // It only ever slows: no step longer than the one before.
    for (let at = 2; at < path.length; at++) expect(Math.abs(path[at] - path[at - 1])).toBeLessThanOrEqual(Math.abs(path[at - 1] - path[at - 2]) + 1e-9);
  });

  it("let go past an edge springs back to it, and a hard flick at an edge runs on past it a little, never past the slack", () => {
    const back = run({ x: -6, y: 40, vx: 0, vy: 0 }).glide;
    expect(back).toMatchObject({ x: 0, y: 34, done: true });
    const { glide, path } = run({ x: 46, y: 10, vx: 0.6, vy: 0 });
    expect(glide.x).toBe(48);
    // Seen to go past (a few art pixels: a band, not a wall), and held within the slack of 11.
    expect(Math.max(...path)).toBeGreaterThan(48 + 3);
    expect(Math.max(...path)).toBeLessThanOrEqual(48 + 11);
  });

  it("is a band a drag can be seen to stretch: a finger 80 px past the edge shows over half the slack", () => {
    expect(band(80, 44)).toBeGreaterThan(22);
    expect(band(80, 44)).toBeLessThan(44);
  });

  it("eases to where it is sent, and arrives", () => {
    let x = 0;
    for (let step = 0; step < 100; step++) x = easeTo(x, 30, 16);
    expect(x).toBe(30);
    expect(easeTo(0, 30, 16)).toBeGreaterThan(0);
    expect(easeTo(0, 30, 16)).toBeLessThan(30);
  });
});

describe("a chosen thing and its card", () => {
  const bounds = { x: { min: 0, max: 48 }, y: { min: 0, max: 34 } };

  it("puts the card on the other half of the screen from the thing", () => {
    expect(cardSide(600, 800)).toBe("left");
    expect(cardSide(200, 800)).toBe("right");
  });

  it("moves the camera only as far as it takes for the thing to be seen beside the card", () => {
    // A screen 192 art px wide, the card on the right taking 77 of it: free from 0 to 115, between the row at the top and the keys.
    const free = { left: 0, top: 12, right: 115, bottom: 74 };
    const cam = { x: 24, y: 20 };
    // In view already: the camera stays.
    expect(showIn({ x: 60, y: 50, w: 20, h: 20 }, cam, free, bounds)).toEqual(cam);
    // Under the card: the camera goes right just enough (the thing's right edge, and a margin, at the card's left).
    const under = showIn({ x: 130, y: 50, w: 20, h: 20 }, cam, free, bounds);
    expect(under.x).toBe(130 + 20 + 4 - 115);
    expect(under.y).toBe(20);
    // As far as the picture goes, and no further.
    expect(showIn({ x: 230, y: 50, w: 20, h: 20 }, cam, free, bounds).x).toBe(48);
    // Too low (under the keys): up, as far as the picture lets it.
    expect(showIn({ x: 60, y: 100, w: 20, h: 20 }, cam, free, bounds).y).toBe(34);
  });

  it("goes home centred on the camp, as far as the picture allows, and knows when it is away", () => {
    expect(centredOn({ x: 120, y: 80 }, { w: 192, h: 86 }, bounds)).toEqual({ x: 24, y: 34 });
    expect(awayFrom({ x: 24, y: 34 }, { x: 25, y: 33 })).toBe(false);
    expect(awayFrom({ x: 4, y: 34 }, { x: 24, y: 34 })).toBe(true);
  });
});
