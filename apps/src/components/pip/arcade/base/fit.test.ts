import { describe, expect, it } from "vitest";
import { WASTE_ALLOWED, fitPicture } from "./fit";

describe("how big the camp's picture is shown", () => {
  it("is a whole number of screen pixels to each of its own where that nearly fills the room", () => {
    // 240 wide in a room of 730: three to one is 720, all but the room.
    expect(fitPicture(240, 120, 730, 600)).toEqual({ css: 3, backing: 3, crisp: true });
    // On a dense screen the whole number is of screen pixels, not of CSS ones.
    expect(fitPicture(240, 120, 600, 600, 1.5)).toEqual({ css: 2, backing: 3, crisp: true });
  });

  it("fills a narrow room instead of leaving a third of it empty", () => {
    // 240 wide in a room of 420: one to one would be barely half of it.
    const narrow = fitPicture(240, 120, 420, 600);
    expect(narrow.crisp).toBe(false);
    expect(narrow.css).toBeCloseTo(1.75);
    // Drawn at the next whole size up, and brought down from there.
    expect(narrow.backing).toBe(2);
    expect(240 * narrow.css).toBeCloseTo(420);
  });

  it("keeps to whole pixels up to the waste it is allowed, and not past it", () => {
    const just = fitPicture(100, 50, 200 / (1 - WASTE_ALLOWED) - 1, 1000);
    expect(just).toMatchObject({ css: 2, crisp: true });
    const past = fitPicture(100, 50, 200 / (1 - WASTE_ALLOWED) + 2, 1000);
    expect(past.crisp).toBe(false);
    expect(past.css).toBeGreaterThan(2);
  });

  it("is held by the room's height as well as its width", () => {
    expect(fitPicture(240, 120, 2000, 250).css).toBeCloseTo(2, 0);
    expect(fitPicture(240, 120, 2000, 250).css * 120).toBeLessThanOrEqual(250);
  });

  it("still shows a picture in a room smaller than it", () => {
    const tiny = fitPicture(240, 120, 180, 600);
    expect(tiny).toMatchObject({ backing: 1, crisp: false });
    expect(tiny.css).toBeCloseTo(0.75);
  });
});

describe("a picture that is the page", () => {
  it("fills the room exactly when told no room may be wasted", () => {
    const filled = fitPicture(240, 120, 1162, 719, 1, 0);
    expect(filled.css).toBeCloseTo(1162 / 240, 6);
    expect(filled.backing).toBe(5);
    expect(filled.crisp).toBe(false);
    // A room that is a whole size is still drawn hard-edged.
    expect(fitPicture(240, 120, 960, 600, 1, 0)).toEqual({ css: 4, backing: 4, crisp: true });
  });
});
