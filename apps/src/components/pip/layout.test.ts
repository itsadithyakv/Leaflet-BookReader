import { describe, expect, it } from "vitest";
import { LIFT_ARROW, LIFT_STOP, LIFT_TOUCH, floorPoint, liftShowsAll, liftShowsArrows, placeNear } from "./layout";

const screen = { left: 0, top: 0, width: 1000, height: 800 };
const size = { width: 300, height: 150 };

describe("the packet picker over a plot", () => {
  it("sits above the plot, centred on it, pointing down at it", () => {
    const plot = { left: 450, top: 500, width: 100, height: 60 };
    expect(placeNear(plot, size, screen)).toEqual({ left: 350, top: 340, side: "above", tailAt: 50 });
  });

  it("goes below when there is no room above", () => {
    const plot = { left: 450, top: 60, width: 100, height: 60 };
    expect(placeNear(plot, size, screen)).toMatchObject({ top: 130, side: "below" });
  });

  it("slides along to stay on screen, its tail still pointing at the plot", () => {
    const plot = { left: 10, top: 500, width: 80, height: 60 };
    const placed = placeNear(plot, size, screen);
    expect(placed.left).toBe(0);
    expect(placed.tailAt).toBeCloseTo((50 / 300) * 100);
    const right = placeNear({ left: 960, top: 500, width: 40, height: 60 }, size, screen);
    expect(right.left).toBe(700);
    // Never so far along that the tail leaves the bubble.
    expect(right.tailAt).toBe(90);
  });

  it("takes the roomier side, kept on screen, when neither fits", () => {
    const short = { left: 0, top: 0, width: 1000, height: 200 };
    const placed = placeNear({ left: 450, top: 120, width: 100, height: 40 }, size, short);
    expect(placed.side).toBe("above");
    expect(placed.top).toBe(0);
  });

  it("can prefer below", () => {
    const plot = { left: 450, top: 300, width: 100, height: 60 };
    expect(placeNear(plot, size, screen, { prefer: "below" })).toMatchObject({ side: "below", top: 370 });
  });
});

describe("the lift", () => {
  it("shows every floor when the room is tall enough", () => {
    expect(liftShowsAll(2, 300)).toBe(true);
    expect(liftShowsAll(7, 7 * LIFT_STOP + LIFT_ARROW * 2 + 12)).toBe(true);
  });

  it("shows only the floor it is on in a short room", () => {
    expect(liftShowsAll(7, 180)).toBe(false);
    // A phone's room, 120 px tall: up, the floor, down.
    expect(liftShowsAll(2, 120)).toBe(false);
  });

  it("wants 44 px a key under a finger", () => {
    // Three floors and two arrows: 174 px with a pointer, 232 under a finger.
    expect(liftShowsAll(3, 180)).toBe(true);
    expect(liftShowsAll(3, 180, true)).toBe(false);
    expect(liftShowsAll(3, 3 * LIFT_TOUCH + 2 * LIFT_TOUCH + 12, true)).toBe(true);
    expect(LIFT_TOUCH).toBe(44);
  });

  it("showing one floor, drops its arrows under a finger where three 44 px keys do not fit", () => {
    // With a pointer the arrows always fit.
    expect(liftShowsArrows(96)).toBe(true);
    expect(liftShowsArrows(120)).toBe(true);
    // The smallest room (120 px tall, 96 at 125%): the one key, and its list.
    expect(liftShowsArrows(96, true)).toBe(false);
    expect(liftShowsArrows(120, true)).toBe(false);
    expect(liftShowsArrows(143, true)).toBe(false);
    expect(liftShowsArrows(144, true)).toBe(true);
    expect(liftShowsArrows(180, true)).toBe(true);
  });
});

describe("the pointer in the room", () => {
  it("is measured from the room, at the scale the room is drawn at", () => {
    // A room of 240 floor pixels drawn 960 wide, centred in a wider stage: 140 in from the stage.
    const room = { left: 240, top: 150, width: 960 };
    expect(floorPoint({ clientX: 240, clientY: 150 }, room, 240)).toEqual({ x: 0, y: 0 });
    expect(floorPoint({ clientX: 720, clientY: 390 }, room, 240)).toEqual({ x: 120, y: 60 });
    // A half step of scale (3.5 CSS pixels a pixel).
    expect(floorPoint({ clientX: 105 + 35, clientY: 148 + 70 }, { left: 105, top: 148, width: 840 }, 240)).toEqual({ x: 10, y: 20 });
  });

  it("can be outside the room (the hand has left it), and is nowhere in a room with no size", () => {
    expect(floorPoint({ clientX: 0, clientY: 0 }, { left: 240, top: 150, width: 960 }, 240)).toEqual({ x: -60, y: -37.5 });
    expect(floorPoint({ clientX: 10, clientY: 10 }, { left: 0, top: 0, width: 0 }, 240)).toBeNull();
  });
});
