import { describe, expect, it } from "vitest";
import { LIFT_CLEAR, NO_PAD, PAD_STEP, fillPlace, floorSpan, outOfNotch, roomPad, roomSpan, sceneScale } from "./sceneFit";

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

describe("the room as the whole screen (a phone on its side)", () => {
  it("is whole, crisp and in the middle of what the controls leave clear", () => {
    // A Pixel 7 on its side (915 x 412 at 2.625, a 28 px status bar): the clear box under the HUD, between the lift and the rail.
    const box = { width: 915 - 60 - 96, height: 412 - 74 - 6 };
    const per = sceneScale(W, H, box.width, box.height, 2.625);
    expect(Number.isInteger(per)).toBe(true);
    const scale = per / 2.625;
    expect(H * scale).toBeLessThanOrEqual(box.height);
    expect(W * scale).toBeLessThanOrEqual(box.width);
    const place = fillPlace(W * scale, H * scale, box.width, box.height, 2.625);
    expect(place.left).toBeGreaterThanOrEqual(0);
    expect(place.top).toBeGreaterThanOrEqual(0);
    expect(Math.abs(place.left * 2 + W * scale - box.width)).toBeLessThanOrEqual(1);
  });

  it("draws the room's picture on to the stage's edges each side, in steps, never smaller once drawn", () => {
    // 800 x 369 at 3: a room of 560 x 280 CSS px at (124, 66), 7 device pixels (2.33 CSS) an art pixel.
    const scale = 7 / 3;
    const room = { left: 124, top: 66, width: 240 * scale, height: 120 * scale };
    const pad = roomPad({ width: 800, height: 369 }, room, scale);
    for (const side of [pad.left, pad.right, pad.top, pad.bottom]) expect(side % PAD_STEP).toBe(0);
    // It reaches the stage's edges: nothing of the stage is left undrawn.
    expect(room.left - pad.left * scale).toBeLessThanOrEqual(0);
    expect(room.left + room.width + pad.right * scale).toBeGreaterThanOrEqual(800);
    expect(room.top - pad.top * scale).toBeLessThanOrEqual(0);
    expect(room.top + room.height + pad.bottom * scale).toBeGreaterThanOrEqual(369);
    // Less than a step over.
    expect(room.left - pad.left * scale).toBeGreaterThan(-PAD_STEP * scale);
    // A drawer opened (the room moved left) and shut again: what was drawn still reaches, and is not drawn again smaller.
    const moved = roomPad({ width: 800, height: 369 }, { ...room, left: 40 }, scale, pad);
    expect(moved.left).toBe(pad.left);
    expect(moved.right).toBeGreaterThan(pad.right);
    expect(roomPad({ width: 800, height: 369 }, room, scale, moved)).toEqual(moved);
    expect(roomPad({ width: 800, height: 369 }, { ...room, left: 0, top: 0, width: 800, height: 369 }, scale)).toEqual(NO_PAD);
  });

  it("gives Pip the floor from the screen's left gutter to short of the rail, in the room's own pixels", () => {
    const scale = 2;
    const room = { left: 120, top: 70 };
    const box = { left: 60, top: 70, right: 704, bottom: 353 };
    const lift = { left: 8, top: 72, right: 52, bottom: 176 };
    const span = floorSpan(box, lift, room, scale, 240, { left: 64, right: 56, top: 40, bottom: 8 });
    expect(span.left).toBe((8 - 120) / 2);
    expect(span.right).toBe((704 - 120) / 2);
    expect(span.notch).toEqual({ x: (52 + LIFT_CLEAR - 120) / 2, y: (176 + LIFT_CLEAR - 70) / 2 });
    expect(span.edge).toBe(240 + 56);
    // No lift: the box's own left.
    expect(floorSpan(box, null, room, scale, 240, NO_PAD).left).toBe((60 - 120) / 2);
    // Alone (framed), wall to wall.
    expect(roomSpan(240)).toEqual({ left: 0, right: 240, notch: null, edge: 240 });
  });

  it("keeps Pip out of the lift's corner in the air, out the short way, and leaves her be anywhere else", () => {
    const notch = { x: -20, y: 50 };
    // On the floor under the lift: clear.
    expect(outOfNotch({ x: -50, y: 109, vx: -40, vy: 0 }, notch)).toBeNull();
    // Right of it, high up: clear.
    expect(outOfNotch({ x: 0, y: 40, vx: -40, vy: 0 }, notch)).toBeNull();
    // Flying in from the right, high: off its side like a wall.
    const side = outOfNotch({ x: -6, y: 40, vx: -60, vy: 10 }, notch);
    expect(side).toEqual({ x: -4, y: 40, vx: 60 * 0.55, vy: 10 });
    // Thrown up from under it: off its foot like a ceiling.
    const under = outOfNotch({ x: -50, y: 78, vx: 0, vy: -90 }, notch);
    expect(under).toEqual({ x: -50, y: 80, vx: 0, vy: 90 * 0.55 });
    expect(outOfNotch({ x: -50, y: 40, vx: 0, vy: 0 }, null)).toBeNull();
  });
});
