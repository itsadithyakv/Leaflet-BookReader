import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { FOCUS_DOUBLE_TIP, FOCUS_LENGTHS, focusLengthsWith, rememberFocusMinutes, usualFocusMinutes } from "./focusDeal";
import { FocusDouble } from "./FocusDouble";

const memoryStorage = () => {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key)
  };
};

describe("one-tap Focus: the usual length", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("is the daily goal until a length is chosen, and 20 minutes with no goal", () => {
    expect(usualFocusMinutes(25)).toBe(25);
    expect(usualFocusMinutes(0)).toBe(20);
    expect(usualFocusMinutes(Number.NaN)).toBe(20);
  });

  it("is the last length chosen, whatever the goal", () => {
    rememberFocusMinutes(45);
    expect(usualFocusMinutes(20)).toBe(45);
    rememberFocusMinutes(10);
    expect(usualFocusMinutes(20)).toBe(10);
  });

  it("ignores a length that makes no sense", () => {
    rememberFocusMinutes(0);
    rememberFocusMinutes(-5);
    expect(usualFocusMinutes(30)).toBe(30);
    localStorage.setItem("leaflet.focus.minutes", "soon");
    expect(usualFocusMinutes(30)).toBe(30);
  });

  it("falls back to the goal when there is no storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    });
    expect(() => rememberFocusMinutes(30)).not.toThrow();
    expect(usualFocusMinutes(15)).toBe(15);
  });

  it("is always among the picker's lengths", () => {
    expect(focusLengthsWith(20)).toEqual([...FOCUS_LENGTHS]);
    expect(focusLengthsWith(25)).toEqual([10, 20, 25, 30, 45]);
  });
});

describe("the 2× badge", () => {
  it("says the deal in its tooltip, not on the page", () => {
    const markup = renderToStaticMarkup(createElement(FocusDouble));
    expect(markup).toContain(">2×<");
    expect(markup).toContain(`title="${FOCUS_DOUBLE_TIP}"`);
    expect(FOCUS_DOUBLE_TIP).toBe("Reading in Focus earns double seeds");
  });
});
