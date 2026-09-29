import { describe, expect, it } from "vitest";
import { sceneScale } from "./sceneFit";

// A floor of the house: 240 by 120 art pixels.
const W = 240;
const H = 120;

describe("how big the house is drawn", () => {
  it("fills an 820 px window with a half step rather than leaving it half empty", () => {
    // 820 wide: the rail, the page's gutters and the lift leave about 650.
    expect(sceneScale(W, H, 650, 600)).toBe(2.5);
    expect(W * sceneScale(W, H, 650, 600)).toBe(600);
  });

  it("takes half steps at 1024 and 1280 too", () => {
    expect(sceneScale(W, H, 854, 520)).toBe(3.5);
    expect(sceneScale(W, H, 1118, 556)).toBe(4.5);
  });

  it("keeps whole steps when they fit exactly", () => {
    expect(sceneScale(W, H, 1440, 720)).toBe(6);
    expect(sceneScale(W, H, 1459, 900)).toBe(6);
  });

  it("is limited by the height on a wide, short window", () => {
    expect(sceneScale(W, H, 1600, 400)).toBe(3);
    expect(sceneScale(W, H, 1600, 430)).toBe(3.5);
  });

  it("allows 1.5 but nothing between one and one and a half", () => {
    expect(sceneScale(W, H, 370, 400)).toBe(1.5);
    expect(sceneScale(W, H, 300, 400)).toBe(1);
  });

  it("never draws smaller than one device pixel a pixel", () => {
    expect(sceneScale(W, H, 100, 40)).toBe(1);
  });

  it("counts in device pixels on a scaled display", () => {
    // 125% scaling: 480 CSS px is 600 device px, two and a half a pixel.
    expect(sceneScale(W, H, 480, 400, 1.25)).toBe(2.5);
    // A phone at 3x: 290 CSS px is 870 device px.
    expect(sceneScale(W, H, 290, 400, 3)).toBe(3.5);
  });
});
