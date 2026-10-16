import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DECIDE_PX,
  DRAG_SPAN,
  EDGE_SHARE,
  HOLD_MS,
  LIGHT_KEY,
  SCREEN_MIN,
  VEIL_MAX,
  VEIL_SHARE,
  WARM_MAX,
  brightnessOutput,
  classifySwipe,
  dragLevel,
  edgeAt,
  levelFromSystem,
  parseLight,
  percent,
  readLight,
  warmOpacity,
  writeLight
} from "./readingLight";

const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key)
});

const page = { left: 0, top: 40, width: 400, height: 800 };

describe("edgeAt", () => {
  it("gives the left strip to brightness and the right to warmth", () => {
    expect(edgeAt(10, 400, page)).toBe("brightness");
    expect(edgeAt(page.width * EDGE_SHARE - 1, 400, page)).toBe("brightness");
    expect(edgeAt(390, 400, page)).toBe("warmth");
    expect(edgeAt(page.width - page.width * EDGE_SHARE + 1, 400, page)).toBe("warmth");
  });

  it("leaves the middle of the page, and anywhere off it, alone", () => {
    expect(edgeAt(200, 400, page)).toBeNull();
    expect(edgeAt(page.width * EDGE_SHARE + 1, 400, page)).toBeNull();
    expect(edgeAt(10, 20, page)).toBeNull();
    expect(edgeAt(10, 900, page)).toBeNull();
    expect(edgeAt(-5, 400, page)).toBeNull();
  });

  it("measures the strips from the page's own left", () => {
    const beside = { left: 300, top: 0, width: 500, height: 600 };
    expect(edgeAt(310, 300, beside)).toBe("brightness");
    expect(edgeAt(10, 300, beside)).toBeNull();
    expect(edgeAt(790, 300, beside)).toBe("warmth");
  });

  it("keeps the boxes kept for something else (the bookmark corner, the footer)", () => {
    const corner = { left: 344, top: 40, width: 56, height: 56 };
    const footer = { left: 0, top: 800, width: 400, height: 40 };
    expect(edgeAt(390, 50, page, [corner, footer])).toBeNull();
    expect(edgeAt(390, 120, page, [corner, footer])).toBe("warmth");
    expect(edgeAt(10, 820, page, [corner, footer])).toBeNull();
  });

  it("has no strips on a sliver of a page", () => {
    expect(edgeAt(5, 100, { left: 0, top: 0, width: 200, height: 600 })).toBeNull();
  });
});

describe("classifySwipe", () => {
  it("waits for the first few pixels", () => {
    expect(classifySwipe(0, 0, 10)).toBe("wait");
    expect(classifySwipe(3, -(DECIDE_PX - 1), 80)).toBe("wait");
  });

  it("takes a swipe up or down", () => {
    expect(classifySwipe(2, -DECIDE_PX, 80)).toBe("light");
    expect(classifySwipe(-5, 14, 80)).toBe("light");
  });

  it("lets a swipe across (a page turn) and a slanted one go", () => {
    expect(classifySwipe(-DECIDE_PX, 2, 80)).toBe("other");
    expect(classifySwipe(12, 12, 80)).toBe("other");
  });

  it("never takes a press and hold, still or then moved", () => {
    expect(classifySwipe(0, 0, HOLD_MS)).toBe("other");
    expect(classifySwipe(0, -30, HOLD_MS + 100)).toBe("other");
  });
});

describe("dragLevel", () => {
  it("goes up as the finger goes up, the span of the page the whole way", () => {
    expect(dragLevel(0.5, -100, 800)).toBeCloseTo(0.5 + 100 / (800 * DRAG_SPAN), 2);
    expect(dragLevel(0.5, 100, 800)).toBeCloseTo(0.5 - 100 / (800 * DRAG_SPAN), 2);
    expect(dragLevel(0, -800 * DRAG_SPAN, 800)).toBe(1);
  });

  it("stops at none and at all, in whole percents", () => {
    expect(dragLevel(0.9, -2000, 800)).toBe(1);
    expect(dragLevel(0.1, 2000, 800)).toBe(0);
    expect(dragLevel(0.5, -1, 800) * 100).toBe(Math.round(dragLevel(0.5, -1, 800) * 100));
  });

  it("stays where it was on a page with no height", () => {
    expect(dragLevel(0.42, -50, 0)).toBe(0.42);
  });
});

describe("brightnessOutput", () => {
  it("follows the system for null", () => {
    expect(brightnessOutput(null, true)).toEqual({ screen: null, veil: 0 });
    expect(brightnessOutput(null, false)).toEqual({ screen: null, veil: 0 });
  });

  it("gives the window the top of the scale, from its least to full", () => {
    expect(brightnessOutput(1, true)).toEqual({ screen: 1, veil: 0 });
    expect(brightnessOutput(VEIL_SHARE, true)).toEqual({ screen: SCREEN_MIN, veil: 0 });
    const middle = brightnessOutput(0.6, true);
    expect(middle.veil).toBe(0);
    expect(middle.screen!).toBeGreaterThan(SCREEN_MIN);
    expect(middle.screen!).toBeLessThan(1);
  });

  it("goes darker than the screen can with the veil below its least", () => {
    expect(brightnessOutput(VEIL_SHARE / 2, true)).toEqual({ screen: SCREEN_MIN, veil: VEIL_MAX / 2 });
    expect(brightnessOutput(0, true)).toEqual({ screen: SCREEN_MIN, veil: VEIL_MAX });
  });

  it("is the veil alone where the window's brightness cannot be set", () => {
    expect(brightnessOutput(1, false)).toEqual({ screen: null, veil: 0 });
    expect(brightnessOutput(0, false)).toEqual({ screen: null, veil: VEIL_MAX });
    expect(brightnessOutput(0.5, false)).toEqual({ screen: null, veil: VEIL_MAX / 2 });
  });

  it("clamps what it is given", () => {
    expect(brightnessOutput(3, true)).toEqual({ screen: 1, veil: 0 });
    expect(brightnessOutput(-1, false)).toEqual({ screen: null, veil: VEIL_MAX });
  });
});

describe("levelFromSystem", () => {
  it("puts the phone's own setting on the window's part of the scale", () => {
    expect(levelFromSystem(1, true)).toBe(1);
    expect(levelFromSystem(SCREEN_MIN, true)).toBe(VEIL_SHARE);
    expect(levelFromSystem(0, true)).toBe(VEIL_SHARE);
    // And back again: the first swipe starts where the screen already is.
    const level = levelFromSystem(0.5, true);
    expect(brightnessOutput(level, true).screen!).toBeCloseTo(0.5, 1);
  });

  it("starts at the top without a window brightness, or before Android has said", () => {
    expect(levelFromSystem(0.3, false)).toBe(1);
    expect(levelFromSystem(null, true)).toBe(1);
    expect(levelFromSystem(Number.NaN, true)).toBe(1);
  });
});

describe("warmth and the pill", () => {
  it("washes up to the strongest amber", () => {
    expect(warmOpacity(0)).toBe(0);
    expect(warmOpacity(1)).toBe(WARM_MAX);
    expect(warmOpacity(2)).toBe(WARM_MAX);
    expect(warmOpacity(0.5)).toBeCloseTo(WARM_MAX / 2, 3);
  });

  it("shows whole percents", () => {
    expect(percent(0)).toBe("0%");
    expect(percent(0.426)).toBe("43%");
    expect(percent(1)).toBe("100%");
  });
});

describe("keeping the light", () => {
  beforeEach(() => stored.clear());

  it("reads nothing kept as the system's brightness and no warmth", () => {
    expect(readLight()).toEqual({ brightness: null, warmth: 0 });
    expect(parseLight("not json")).toEqual({ brightness: null, warmth: 0 });
    expect(parseLight(JSON.stringify({ brightness: "bright", warmth: "warm" }))).toEqual({ brightness: null, warmth: 0 });
  });

  it("keeps a level and a following of the system", () => {
    writeLight({ brightness: 0.35, warmth: 0.6 });
    expect(readLight()).toEqual({ brightness: 0.35, warmth: 0.6 });
    writeLight({ brightness: null, warmth: 0.2 });
    expect(JSON.parse(stored.get(LIGHT_KEY)!)).toEqual({ brightness: "system", warmth: 0.2 });
    expect(readLight()).toEqual({ brightness: null, warmth: 0.2 });
  });

  it("forgets the key when both are back to the default", () => {
    writeLight({ brightness: 0.5, warmth: 0 });
    writeLight({ brightness: null, warmth: 0 });
    expect(stored.has(LIGHT_KEY)).toBe(false);
  });

  it("clamps and rounds what it reads", () => {
    expect(parseLight(JSON.stringify({ brightness: 1.7, warmth: 0.12345 }))).toEqual({ brightness: 1, warmth: 0.12 });
  });
});
