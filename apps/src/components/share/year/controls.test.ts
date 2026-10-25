import { describe, expect, it } from "vitest";
import { HOLD_MS, SceneClock, keyAction, releaseAction, stepTo } from "./controls";

const tap = (x: number, extra: Partial<Parameters<typeof releaseAction>[0]> = {}) => releaseAction({ x, width: 400, dx: 0, dy: 0, heldMs: 80, ...extra });

describe("moving through the story", () => {
  it("goes on with a tap on the right, back with one on the left", () => {
    expect(tap(300)).toBe("next");
    expect(tap(150)).toBe("next");
    expect(tap(40)).toBe("back");
  });

  it("only plays on when a hold is let go", () => {
    expect(tap(300, { heldMs: HOLD_MS })).toBeNull();
    expect(tap(40, { heldMs: 900 })).toBeNull();
  });

  it("closes with a swipe down, and goes on or back with one across", () => {
    expect(tap(200, { dy: 140, dx: 10 })).toBe("close");
    expect(tap(200, { dx: -120, dy: 8 })).toBe("next");
    expect(tap(200, { dx: 120, dy: 8 })).toBe("back");
    // A drag that is neither is nothing, not a tap.
    expect(tap(200, { dx: 30, dy: 30 })).toBeNull();
  });

  it("answers the keys", () => {
    expect(keyAction("ArrowRight")).toBe("next");
    expect(keyAction(" ")).toBe("next");
    expect(keyAction("ArrowLeft")).toBe("back");
    expect(keyAction("Escape")).toBe("close");
    expect(keyAction("a")).toBeNull();
  });

  it("stays on the last scene (the one to share) and the first", () => {
    expect(stepTo(3, 5, "next")).toBe(4);
    expect(stepTo(4, 5, "next")).toBe(4);
    expect(stepTo(0, 5, "back")).toBe(0);
    expect(stepTo(2, 5, "close")).toBeNull();
  });
});

describe("a scene's clock", () => {
  it("stops while it is held, and goes on from where it was", () => {
    let now = 1000;
    const clock = new SceneClock(() => now);
    now = 1500;
    expect(clock.time()).toBe(500);
    clock.pause();
    now = 4000;
    expect(clock.time()).toBe(500);
    expect(clock.paused).toBe(true);
    clock.resume();
    now = 4200;
    expect(clock.time()).toBe(700);
  });
});
