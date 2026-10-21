import { afterEach, describe, expect, it, vi } from "vitest";
import { busyFpsFor, changeGate, frameGate, hidesAt, mostlyHidden, runScene, runWhileShown, sceneGate, solidColour, untilNextArtFrame } from "./frameGate";

/** The times a display gives frames at, for `seconds`, each up to `jitter` ms early or late. */
const refreshes = (hz: number, seconds: number, jitter = 0) => {
  const times: number[] = [];
  let wobble = 0x2545;
  for (let n = 0; n < hz * seconds; n++) {
    wobble = (wobble * 1103515245 + 12345) & 0x7fffffff;
    const off = jitter ? ((wobble / 0x7fffffff) * 2 - 1) * jitter : 0;
    times.push(1000 + (n * 1000) / hz + off);
  }
  return times;
};

const paintsOf = (times: number[], busy: (time: number) => boolean = () => false) => {
  const gate = frameGate();
  return times.filter((time) => gate.due(time, busy(time)));
};

describe("how often an always-moving picture is painted", () => {
  it("is thirty a second or a little under, whatever the display's rate", () => {
    // [refresh rate, paints in a second]: every 2nd frame at 60, 3rd at 90, 4th at 120, 5th at 144.
    for (const [hz, paints] of [
      [30, 30],
      [60, 30],
      [75, 25],
      [90, 30],
      [120, 30],
      [144, 29]
    ] as const) {
      expect(paintsOf(refreshes(hz, 1)).length, `${hz} Hz`).toBe(paints);
    }
  });

  it("paints on every n-th frame, the same n each time, though frames come a little early or late", () => {
    for (const hz of [60, 90, 120, 144]) {
      const times = refreshes(hz, 2, 1.5);
      const painted = paintsOf(times).map((time) => times.indexOf(time));
      const gaps = new Set(painted.slice(1).map((at, index) => at - painted[index]));
      // One gap only: no paint is late by a frame and then early by one, which is a stutter.
      expect([...gaps], `${hz} Hz`).toEqual([Math.ceil((hz / 30) - 0.2)]);
    }
  });

  it("paints every frame while it is busy, and goes back to thirty after", () => {
    const times = refreshes(120, 1);
    const painted = paintsOf(times, (time) => time < 1500);
    // Half a second of every frame (60), then half a second at thirty (15).
    expect(painted.length).toBe(60 + 15);
  });

  it("paints every frame for as long as it was woken for", () => {
    const gate = frameGate();
    const times = refreshes(60, 1);
    gate.wake(1250);
    expect(times.filter((time) => gate.due(time)).length).toBe(15 + 22);
  });

  it("paints the first frame after a reset, and a frame whose clock began again", () => {
    const gate = frameGate();
    expect(gate.due(1000)).toBe(true);
    expect(gate.due(1010)).toBe(false);
    gate.reset();
    expect(gate.due(1012)).toBe(true);
    expect(gate.due(5)).toBe(true);
  });
});

describe("a picture painted only when it would look different", () => {
  it("is painted once for each new thing shown", () => {
    const changed = changeGate();
    expect(["a", "a", "b", "b", "b", "a"].map(changed)).toEqual([true, false, true, false, false, true]);
  });
});

describe("a frame loop that runs while there is something to see", () => {
  let queued: Array<{ id: number; run: (time: number) => void }> = [];
  let nextId = 1;
  let hidden = false;
  let onVisibility: (() => void) | null = null;
  let onView: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
  const install = () => {
    queued = [];
    hidden = false;
    vi.stubGlobal("requestAnimationFrame", (run: (time: number) => void) => {
      const id = nextId++;
      queued.push({ id, run });
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      queued = queued.filter((entry) => entry.id !== id);
    });
    vi.stubGlobal("document", {
      get visibilityState() {
        return hidden ? "hidden" : "visible";
      },
      addEventListener: (_: string, listener: () => void) => {
        onVisibility = listener;
      },
      removeEventListener: () => {
        onVisibility = null;
      }
    });
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
          onView = callback;
        }
        observe() {}
        disconnect() {
          onView = null;
        }
      }
    );
  };
  /** The display's frames at `hz` for `seconds` from `from`. */
  const play = (hz: number, seconds: number, from = 0) => {
    for (let n = 0; n < hz * seconds; n++) {
      const due = queued;
      queued = [];
      for (const entry of due) entry.run(from + (n * 1000) / hz);
    }
  };
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("paints a camp-like scene thirty times a second where it painted at every frame", () => {
    install();
    for (const hz of [60, 120]) {
      // Before: every frame the screen gave was painted.
      let before = 0;
      const stopBefore = runWhileShown({} as Element, () => {
        before += 1;
      });
      play(hz, 1);
      stopBefore();
      // After: the same loop, with the gate.
      const gate = frameGate();
      let after = 0;
      const stopAfter = runWhileShown({} as Element, (time) => {
        if (gate.due(time)) after += 1;
      });
      play(hz, 1);
      stopAfter();
      expect({ hz, before, after }).toEqual({ hz, before: hz, after: 30 });
    }
  });

  it("stops while the window is hidden and while it is out of view, and starts again after", () => {
    install();
    let frames = 0;
    const resumed = vi.fn();
    const stop = runWhileShown({} as Element, () => {
      frames += 1;
    }, resumed);
    play(60, 0.5);
    expect(frames).toBe(30);
    hidden = true;
    onVisibility?.();
    expect(queued).toHaveLength(0);
    play(60, 0.5);
    expect(frames).toBe(30);
    hidden = false;
    onVisibility?.();
    expect(resumed).toHaveBeenCalledTimes(1);
    play(60, 0.5);
    expect(frames).toBe(60);
    onView?.([{ isIntersecting: false }]);
    expect(queued).toHaveLength(0);
    play(60, 0.5);
    expect(frames).toBe(60);
    onView?.([{ isIntersecting: true }]);
    play(60, 0.5);
    expect(frames).toBe(90);
    stop();
    expect(queued).toHaveLength(0);
    expect(onView).toBeNull();
    expect(onVisibility).toBeNull();
  });

  it("is as many paints as changes for a picture quantised to the art's twelve frames", () => {
    install();
    // The quiz card's picture: its art frame and a card lifting to the whole pixel (GamePicker.tsx).
    const changed = changeGate();
    let paints = 0;
    const stop = runWhileShown({} as Element, (time) => {
      const seconds = time / 1000;
      const lift = Math.round(Math.sin(((seconds % 1.4) / 1.4) * Math.PI) * 5);
      if (changed(`${Math.floor(seconds / 1.4) % 3} ${lift} ${Math.floor(seconds * 12)}`)) paints += 1;
    });
    play(120, 2.8);
    stop();
    // 336 frames given; twelve art frames a second and the lifts between them come to under a paint in ten.
    expect(paints).toBeGreaterThan(12 * 2.8);
    expect(paints).toBeLessThan(20 * 2.8);
  });
});

describe("how often the camp is painted (sceneGate)", () => {
  it("at rest, once for each frame of its art: twelve a second, whatever the display", () => {
    for (const hz of [60, 90, 120, 144]) {
      const gate = sceneGate({ artFps: 12, busyFps: null });
      const painted = refreshes(hz, 2).filter((time) => gate.due(time, 1000, false));
      expect(painted.length, `${hz} Hz`).toBe(24);
    }
  });

  it("while touched, every frame; or every other at 120 Hz on a lighter device", () => {
    const full = sceneGate({ artFps: 12, busyFps: busyFpsFor("full") });
    expect(refreshes(120, 1).filter((time) => full.due(time, 1000, true)).length).toBe(120);
    const lite = sceneGate({ artFps: 12, busyFps: busyFpsFor("lite") });
    expect(refreshes(120, 1).filter((time) => lite.due(time, 1000, true)).length).toBe(60);
    const minimal = sceneGate({ artFps: 12, busyFps: busyFpsFor("minimal") });
    expect(refreshes(120, 1).filter((time) => minimal.due(time, 1000, true)).length).toBe(30);
  });

  it("after a busy spell, goes back to the art's frames", () => {
    const gate = sceneGate({ artFps: 12, busyFps: null });
    const painted = refreshes(120, 1).filter((time) => gate.due(time, 1000, time < 1500));
    // Half a second of every frame (60), then the art's frames for the rest of the second (6).
    expect(painted.length).toBeGreaterThanOrEqual(60 + 5);
    expect(painted.length).toBeLessThanOrEqual(60 + 6);
  });

  it("says how long until the art's next frame", () => {
    expect(untilNextArtFrame(1000, 1000, 12)).toBeCloseTo(1000 / 12);
    expect(untilNextArtFrame(1050, 1000, 12)).toBeCloseTo(1000 / 12 - 50);
    expect(untilNextArtFrame(990, 1000, 12)).toBeCloseTo(10);
  });
});

describe("a scene loop that sleeps between the frames it paints", () => {
  let queued: Array<{ id: number; run: (time: number) => void }> = [];
  let timers: Array<{ id: number; at: number; run: () => void; every?: number }> = [];
  let clock = 0;
  let nextId = 1;
  const install = () => {
    queued = [];
    timers = [];
    clock = 0;
    vi.stubGlobal("requestAnimationFrame", (run: (time: number) => void) => {
      const id = nextId++;
      queued.push({ id, run });
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      queued = queued.filter((entry) => entry.id !== id);
    });
    const clear = (id: number) => {
      timers = timers.filter((entry) => entry.id !== id);
    };
    vi.stubGlobal("window", {
      setTimeout: (run: () => void, ms: number) => {
        const id = nextId++;
        timers.push({ id, at: clock + ms, run });
        return id;
      },
      clearTimeout: clear,
      setInterval: (run: () => void, ms: number) => {
        const id = nextId++;
        timers.push({ id, at: clock + ms, run, every: ms });
        return id;
      },
      clearInterval: clear
    });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined });
  };
  const play = (hz: number, seconds: number) => {
    for (let n = 0; n < hz * seconds; n++) {
      clock += 1000 / hz;
      const due = queued;
      queued = [];
      for (const entry of due) entry.run(clock);
      const ready = timers.filter((entry) => entry.at <= clock);
      for (const entry of ready) {
        if (entry.every) entry.at += entry.every;
        else timers = timers.filter((other) => other !== entry);
        entry.run();
      }
    }
  };
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is given a dozen frames a second at rest where it took every one (120)", () => {
    install();
    const gate = sceneGate({ artFps: 12, busyFps: null });
    let frames = 0;
    let paints = 0;
    const loop = runScene({} as Element, (time) => {
      frames += 1;
      if (gate.due(time, 0, false)) paints += 1;
      return untilNextArtFrame(time, 0, 12);
    });
    play(120, 2);
    expect(paints).toBeGreaterThanOrEqual(23);
    expect(paints).toBeLessThanOrEqual(25);
    // A frame or two more than paints at most: each one it is given is one it paints.
    expect(frames).toBeLessThanOrEqual(paints + 2);
    loop.stop();
  });

  it("takes every frame again from the moment it is woken, while the picture is busy", () => {
    install();
    let busy = false;
    let frames = 0;
    const loop = runScene({} as Element, (time) => {
      frames += 1;
      return busy ? undefined : untilNextArtFrame(time, 0, 12);
    });
    play(120, 1);
    const resting = frames;
    busy = true;
    loop.wake();
    play(120, 1);
    expect(frames - resting).toBe(120);
    loop.stop();
    const stopped = frames;
    play(120, 1);
    expect(frames).toBe(stopped);
  });
});

describe("whether something is laid over the picture", () => {
  it("counts a big solid thing, not a button, Pip's word or a see-through scrim", () => {
    expect(hidesAt(null, 1000)).toBe(false);
    expect(hidesAt({ area: 600, solid: true }, 1000)).toBe(true);
    expect(hidesAt({ area: 100, solid: true }, 1000)).toBe(false);
    expect(hidesAt({ area: 1000, solid: false }, 1000)).toBe(false);
  });

  it("is covered when more than half the points are", () => {
    expect(mostlyHidden([true, true, true, true, true, false, false, false, false])).toBe(true);
    expect(mostlyHidden([true, true, true, true, false, false, false, false, false])).toBe(false);
    expect(mostlyHidden([])).toBe(false);
  });

  it("reads a background colour as solid, or as one the picture shows through", () => {
    expect(solidColour("rgb(250, 245, 230)")).toBe(true);
    expect(solidColour("rgba(0, 0, 0, 0.4)")).toBe(false);
    expect(solidColour("rgba(255, 255, 255, 0.92)")).toBe(true);
    expect(solidColour("rgb(0 0 0 / 30%)")).toBe(false);
    expect(solidColour("transparent")).toBe(false);
  });
});
