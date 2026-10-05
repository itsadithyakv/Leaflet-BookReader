import { describe, expect, it } from "vitest";
import { FRAMES, MENU_BOX, SIGN_BOARD, SPRITE, TALLEST, WIDEST, artPx, frameFor, perPixel } from "./geometry";

describe("desktop Pip's window", () => {
  it("draws an art pixel as a whole number of device pixels at every scaling", () => {
    // The same table as Rust's test (desktop_pip/mod.rs), which sizes the window.
    for (const [ratio, expected] of [[1, 2], [1.25, 2], [1.5, 3], [1.75, 3], [2, 4], [2.25, 4], [2.5, 5], [3, 6]] as const) {
      expect(perPixel(ratio)).toBe(expected);
    }
    expect(perPixel(0.3)).toBe(1);
    expect(perPixel(Number.NaN)).toBe(2);
  });

  it("is the sprite's own canvas when it holds only her", () => {
    // PipSprite at 64: floor(64 * ratio / 32) device pixels per art pixel.
    for (const ratio of [1, 1.25, 1.5, 1.75, 2]) {
      const backing = Math.max(1, Math.floor((64 * ratio) / 32 + 1e-6)) * 32;
      expect(perPixel(ratio) * SPRITE).toBe(backing);
      // In CSS pixels the window is that canvas exactly.
      expect(artPx(ratio) * SPRITE * ratio).toBeCloseTo(backing, 9);
    }
  });

  it("keeps her on a whole device pixel in the middle of every frame", () => {
    for (const frame of Object.values(FRAMES)) {
      expect((frame.width - SPRITE) % 2).toBe(0);
      expect(frame.width).toBeLessThanOrEqual(WIDEST);
      expect(frame.height).toBeLessThanOrEqual(TALLEST);
      expect(frame.height).toBeGreaterThanOrEqual(SPRITE);
    }
  });

  it("has room for the sign's board and the menu's box", () => {
    expect(SIGN_BOARD.width).toBeLessThanOrEqual(FRAMES.sign.width);
    expect(SIGN_BOARD.height + SPRITE).toBeLessThanOrEqual(FRAMES.sign.height);
    expect(MENU_BOX.width).toBeLessThanOrEqual(FRAMES.menu.width);
    expect(MENU_BOX.height + SPRITE).toBeLessThanOrEqual(FRAMES.menu.height);
    // At the scalings where an art pixel is fewest CSS pixels (125%, 175%)
    // the menu's box is still wide enough for its longest line.
    expect(MENU_BOX.width * artPx(1.25)).toBeGreaterThanOrEqual(130);
  });

  it("is only as large as what it shows", () => {
    expect(frameFor({ sign: false, menu: false, carried: false })).toEqual(FRAMES.plain);
    expect(frameFor({ sign: true, menu: false, carried: false })).toEqual(FRAMES.sign);
    expect(frameFor({ sign: true, menu: true, carried: false })).toEqual(FRAMES.menu);
    // In the hand she is only herself, whatever was open.
    expect(frameFor({ sign: true, menu: true, carried: true })).toEqual(FRAMES.plain);
  });
});
