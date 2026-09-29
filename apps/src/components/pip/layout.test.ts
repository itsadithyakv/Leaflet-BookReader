import { describe, expect, it } from "vitest";
import { LIFT_ARROW, LIFT_STOP, liftShowsAll, placeNear } from "./layout";

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
});
