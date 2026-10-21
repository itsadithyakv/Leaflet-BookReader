import { describe, expect, it, vi } from "vitest";
import { layoutCache, setStyle } from "./layoutCache";

describe("what the page measures for Pip, kept for a moment", () => {
  it("is measured once in a quarter second, however often it is asked for (a throw asks every frame)", () => {
    let now = 1000;
    const cache = layoutCache(250, () => now);
    const read = vi.fn(() => ({ top: 64 }));
    for (let frame = 0; frame < 15; frame++) {
      expect(cache.get("bounds", read)).toEqual({ top: 64 });
      now += 1000 / 60;
    }
    // 15 frames at 60 Hz is 250 ms: measured at the first and once more as the quarter second ran out.
    expect(read).toHaveBeenCalledTimes(1);
    cache.get("bounds", read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("is measured again after a scroll or a resize forgets it, and each thing on its own key", () => {
    let now = 0;
    const cache = layoutCache(250, () => now);
    let top = 10;
    const bounds = () => ({ top });
    expect(cache.get("bounds", bounds).top).toBe(10);
    top = 40;
    now = 100;
    expect(cache.get("bounds", bounds).top).toBe(10);
    expect(cache.get("ledges", () => [top])).toEqual([40]);
    cache.forget();
    expect(cache.get("bounds", bounds).top).toBe(40);
    top = 70;
    cache.drop("bounds");
    expect(cache.get("bounds", bounds).top).toBe(70);
    expect(cache.get("ledges", () => [0])).toEqual([0]);
  });

  it("does not trust what it kept from a clock that has gone backwards", () => {
    let now = 500;
    const cache = layoutCache(250, () => now);
    cache.get("home", () => 1);
    now = 100;
    expect(cache.get("home", () => 2)).toBe(2);
  });
});

describe("a style written only when it changes", () => {
  it("writes a new value, not the same one again", () => {
    const setProperty = vi.fn();
    const element = { style: { setProperty } };
    expect(setStyle(element, "transform", "translate3d(1px, 2px, 0)")).toBe(true);
    expect(setStyle(element, "transform", "translate3d(1px, 2px, 0)")).toBe(false);
    expect(setStyle(element, "z-index", "57")).toBe(true);
    expect(setStyle(element, "transform", "translate3d(1px, 3px, 0)")).toBe(true);
    expect(setProperty.mock.calls).toEqual([
      ["transform", "translate3d(1px, 2px, 0)"],
      ["z-index", "57"],
      ["transform", "translate3d(1px, 3px, 0)"]
    ]);
  });

  it("keeps what it wrote apart for each element (a new one, as a layer change makes, starts clean)", () => {
    const one = { style: { setProperty: vi.fn() } };
    const other = { style: { setProperty: vi.fn() } };
    setStyle(one, "display", "none");
    setStyle(other, "display", "none");
    expect(one.style.setProperty).toHaveBeenCalledTimes(1);
    expect(other.style.setProperty).toHaveBeenCalledTimes(1);
  });
});
