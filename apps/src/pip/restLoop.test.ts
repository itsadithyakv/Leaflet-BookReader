import { afterEach, describe, expect, it, vi } from "vitest";
import { GAZE_FOLLOWS_MS, REST_LOOK_MS, houseNeedsFrames, restingLoop, type HouseMotion } from "./restLoop";

const still: HouseMotion = { phase: "rest", pressed: false, ball: false, pointerAt: null, furnishing: false };

describe("when Pip's house takes every frame", () => {
  it("does at rest, asleep, mid-act or out of the room only when something else moves", () => {
    for (const phase of ["rest", "sleep", "act", "doing", "fidget", "errand", "land", "out"]) {
      expect(houseNeedsFrames({ ...still, phase }, 0), phase).toBe(false);
    }
    expect(houseNeedsFrames({ ...still, ball: true }, 0)).toBe(true);
    expect(houseNeedsFrames({ ...still, pressed: true }, 0)).toBe(true);
    expect(houseNeedsFrames({ ...still, furnishing: true }, 0)).toBe(true);
    expect(houseNeedsFrames({ ...still, phase: "out", ball: true }, 0)).toBe(true);
  });

  it("does while she walks, falls, hangs from the hand, plays, hops into bed or is stroked", () => {
    for (const phase of ["walk", "fall", "held", "fetch", "carry", "catch", "tuck", "petted"]) {
      expect(houseNeedsFrames({ ...still, phase }, 0), phase).toBe(true);
    }
  });

  it("does while her eyes follow a pointer, and stops when it has been still long enough", () => {
    expect(houseNeedsFrames({ ...still, pointerAt: 1000 }, 1000 + GAZE_FOLLOWS_MS - 1)).toBe(true);
    expect(houseNeedsFrames({ ...still, pointerAt: 1000 }, 1000 + GAZE_FOLLOWS_MS)).toBe(false);
  });
});

describe("a loop that rests between looks", () => {
  let frames: Array<{ id: number; run: (time: number) => void }> = [];
  let timers: Array<{ id: number; at: number; run: () => void }> = [];
  let clock = 0;
  let nextId = 1;
  const install = () => {
    frames = [];
    timers = [];
    clock = 0;
    vi.stubGlobal("requestAnimationFrame", (run: (time: number) => void) => {
      const id = nextId++;
      frames.push({ id, run });
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames = frames.filter((entry) => entry.id !== id);
    });
    vi.stubGlobal("window", {
      setTimeout: (run: () => void, ms: number) => {
        const id = nextId++;
        timers.push({ id, at: clock + ms, run });
        return id;
      },
      clearTimeout: (id: number) => {
        timers = timers.filter((entry) => entry.id !== id);
      }
    });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  };
  /** A display at `hz` for `ms`: frames asked for are given, timers run when due. */
  const play = (hz: number, ms: number) => {
    const end = clock + ms;
    while (clock < end) {
      clock += 1000 / hz;
      const due = frames;
      frames = [];
      for (const entry of due) entry.run(clock);
      const ready = timers.filter((entry) => entry.at <= clock);
      timers = timers.filter((entry) => entry.at > clock);
      for (const entry of ready) entry.run();
    }
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("looks in four times a second at rest, where it took 120 frames a second", () => {
    install();
    const step = vi.fn();
    const loop = restingLoop(step, () => false);
    play(120, 1000);
    // The first frame, then a look every REST_LOOK_MS.
    expect(step.mock.calls.length).toBeLessThanOrEqual(1 + 1000 / REST_LOOK_MS);
    expect(step.mock.calls.length).toBeGreaterThanOrEqual(1000 / REST_LOOK_MS);
    loop.stop();
  });

  it("takes every frame while something moves, and is woken to them at once", () => {
    install();
    let moving = false;
    const step = vi.fn();
    const loop = restingLoop(step, () => moving);
    play(120, 100);
    const resting = step.mock.calls.length;
    moving = true;
    loop.wake();
    play(120, 500);
    expect(step.mock.calls.length - resting).toBeGreaterThanOrEqual(59);
    moving = false;
    const before = step.mock.calls.length;
    play(120, 1000);
    expect(step.mock.calls.length - before).toBeLessThanOrEqual(6);
    loop.stop();
    const stopped = step.mock.calls.length;
    play(120, 1000);
    expect(step.mock.calls.length).toBe(stopped);
  });
});
