import { describe, expect, it } from "vitest";
import { placeCard } from "./cardPlace";

const window1024 = { left: 8, top: 8, width: 1008, height: 752 };
const overlaps = (a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

describe("where a room card goes", () => {
  it("is above its thing when it fits there, pointing at it", () => {
    const anchor = { left: 600, top: 500, width: 40, height: 40 };
    const place = placeCard(anchor, { width: 300, height: 200 }, window1024);
    expect(place).toMatchObject({ side: "above", top: 500 - 8 - 200, left: 620 - 150, tailAt: 50 });
  });

  it("is below when there is no room above", () => {
    const anchor = { left: 600, top: 100, width: 40, height: 40 };
    expect(placeCard(anchor, { width: 300, height: 200 }, window1024)).toMatchObject({ side: "below", top: 148 });
  });

  it("is beside its thing, not over it, when it is too tall for either", () => {
    // The bookcase in a 1024 x 768 window, and a card of seven books.
    const anchor = { left: 322, top: 281, width: 91, height: 154 };
    const size = { width: 300, height: 360 };
    const place = placeCard(anchor, size, window1024);
    expect(place.side).toBe("beside");
    expect(place.left).toBe(322 + 91 + 8);
    expect(overlaps({ left: place.left, top: place.top, ...size }, anchor)).toBe(false);
    // Level with its middle, and on screen.
    expect(place.top).toBe(281 + 77 - 180);
    expect(place.top + size.height).toBeLessThanOrEqual(760);
    // Against the right edge: on its left instead.
    const far = placeCard({ ...anchor, left: 900 }, size, window1024);
    expect(far).toMatchObject({ side: "beside", left: 900 - 8 - 300 });
    // Near the top: slid down to stay on screen.
    expect(placeCard({ ...anchor, top: 20 }, { width: 300, height: 700 }, window1024).top).toBe(8);
  });

  it("goes where there is most room when it fits nowhere, and stays on screen", () => {
    const narrow = { left: 8, top: 8, width: 344, height: 624 };
    const place = placeCard({ left: 120, top: 250, width: 90, height: 150 }, { width: 300, height: 360 }, narrow);
    expect(place.side).not.toBe("beside");
    expect(place.left).toBeGreaterThanOrEqual(8);
    expect(place.left + 300).toBeLessThanOrEqual(352);
    expect(place.top).toBeGreaterThanOrEqual(8);
    expect(place.top + 360).toBeLessThanOrEqual(632);
  });
});
