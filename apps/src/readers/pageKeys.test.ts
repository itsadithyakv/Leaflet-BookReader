import { describe, expect, it } from "vitest";
import { clickTurn, pagePercent, parsePageEntry, readingKeyAction, sideStep, type StageMetrics } from "./pageKeys";

/** A window 800 tall on a page 2,000 tall, as wide as the window unless said. */
const stage = (scrollTop: number, more: Partial<StageMetrics> = {}): StageMetrics => ({
  scrollTop,
  scrollHeight: 2000,
  clientHeight: 800,
  scrollLeft: 0,
  scrollWidth: 1000,
  clientWidth: 1000,
  ...more
});

const fits = stage(0, { scrollHeight: 800 });

describe("the reading keys on a page taller than the window", () => {
  it("scrolls with Space and Page Down, leaving a little of the last screen in view", () => {
    expect(readingKeyAction({ key: " " }, stage(0))).toEqual({ kind: "scroll", top: 688 });
    expect(readingKeyAction({ key: "PageDown" }, stage(100))).toEqual({ kind: "scroll", top: 788 });
  });

  it("stops at the bottom before it turns", () => {
    expect(readingKeyAction({ key: " " }, stage(900))).toEqual({ kind: "scroll", top: 1200 });
    expect(readingKeyAction({ key: " " }, stage(1200))).toEqual({ kind: "turn", step: 1, land: "top" });
    // A scroll position a fraction of a pixel short of the end is the end.
    expect(readingKeyAction({ key: "PageDown" }, stage(1198.6))).toEqual({ kind: "turn", step: 1, land: "top" });
  });

  it("goes back with Shift+Space and Page Up, to the bottom of the page before", () => {
    expect(readingKeyAction({ key: " ", shiftKey: true }, stage(1000))).toEqual({ kind: "scroll", top: 312 });
    expect(readingKeyAction({ key: "PageUp" }, stage(300))).toEqual({ kind: "scroll", top: 0 });
    expect(readingKeyAction({ key: "PageUp" }, stage(0))).toEqual({ kind: "turn", step: -1, land: "bottom" });
  });

  it("scrolls a line with the up and down arrows and turns at the ends", () => {
    expect(readingKeyAction({ key: "ArrowDown" }, stage(0))).toEqual({ kind: "scroll", top: 80 });
    expect(readingKeyAction({ key: "ArrowUp" }, stage(50))).toEqual({ kind: "scroll", top: 0 });
    expect(readingKeyAction({ key: "ArrowDown" }, stage(1200))).toEqual({ kind: "turn", step: 1, land: "top" });
    expect(readingKeyAction({ key: "ArrowUp" }, stage(0))).toEqual({ kind: "turn", step: -1, land: "bottom" });
  });
});

describe("the reading keys on a page that fits", () => {
  it("turns at once", () => {
    expect(readingKeyAction({ key: " " }, fits)).toEqual({ kind: "turn", step: 1, land: "top" });
    expect(readingKeyAction({ key: "ArrowDown" }, fits)).toEqual({ kind: "turn", step: 1, land: "top" });
    expect(readingKeyAction({ key: "ArrowRight" }, fits)).toEqual({ kind: "turn", step: 1, land: "top" });
    expect(readingKeyAction({ key: "ArrowLeft" }, fits)).toEqual({ kind: "turn", step: -1, land: "top" });
  });

  it("goes to the first and last page with Home and End", () => {
    expect(readingKeyAction({ key: "Home" }, stage(500))).toEqual({ kind: "goto", page: "first" });
    expect(readingKeyAction({ key: "End" }, stage(500))).toEqual({ kind: "goto", page: "last" });
  });

  it("leaves other keys alone", () => {
    expect(readingKeyAction({ key: "a" }, fits)).toBeNull();
    expect(readingKeyAction({ key: "Tab" }, fits)).toBeNull();
  });
});

describe("the left and right arrows", () => {
  const wide = (scrollLeft: number) => stage(0, { scrollLeft, scrollWidth: 1500 });

  it("scroll a page wider than the window across before they turn it", () => {
    expect(readingKeyAction({ key: "ArrowRight" }, wide(0))).toEqual({ kind: "scroll", left: 80 });
    expect(readingKeyAction({ key: "ArrowRight" }, wide(460))).toEqual({ kind: "scroll", left: 500 });
    expect(readingKeyAction({ key: "ArrowRight" }, wide(500))).toEqual({ kind: "turn", step: 1, land: "top" });
    expect(readingKeyAction({ key: "ArrowLeft" }, wide(30))).toEqual({ kind: "scroll", left: 0 });
    expect(readingKeyAction({ key: "ArrowLeft" }, wide(0))).toEqual({ kind: "turn", step: -1, land: "top" });
  });

  it("do not count a pixel or two of overhang as a page to scroll", () => {
    expect(readingKeyAction({ key: "ArrowRight" }, stage(0, { scrollWidth: 1002 }))).toEqual({
      kind: "turn",
      step: 1,
      land: "top"
    });
  });

  it("swap in a comic read right to left", () => {
    expect(readingKeyAction({ key: "ArrowLeft" }, fits, "rtl")).toEqual({ kind: "turn", step: 1, land: "top" });
    expect(readingKeyAction({ key: "ArrowRight" }, fits, "rtl")).toEqual({ kind: "turn", step: -1, land: "top" });
    // Down is still on.
    expect(readingKeyAction({ key: " " }, fits, "rtl")).toEqual({ kind: "turn", step: 1, land: "top" });
  });
});

describe("the sides of the page", () => {
  it("the right side goes on, and the left in a right-to-left comic", () => {
    expect(sideStep("right", "ltr")).toBe(1);
    expect(sideStep("left", "ltr")).toBe(-1);
    expect(sideStep("right", "rtl")).toBe(-1);
    expect(sideStep("left", "rtl")).toBe(1);
  });

  it("a click on the left or right third turns, and the middle does nothing", () => {
    expect(clickTurn(0.1, "ltr")).toBe(-1);
    expect(clickTurn(0.5, "ltr")).toBe(0);
    expect(clickTurn(0.9, "ltr")).toBe(1);
    expect(clickTurn(0.1, "rtl")).toBe(1);
    expect(clickTurn(0.9, "rtl")).toBe(-1);
  });
});

describe("going to a page", () => {
  it("takes a page number, kept inside the document", () => {
    expect(parsePageEntry("12", 300)).toBe(12);
    expect(parsePageEntry(" 7 ", 300)).toBe(7);
    expect(parsePageEntry("0", 300)).toBe(1);
    expect(parsePageEntry("999", 300)).toBe(300);
  });

  it("takes a percentage of the way through", () => {
    expect(parsePageEntry("0%", 301)).toBe(1);
    expect(parsePageEntry("50%", 301)).toBe(151);
    expect(parsePageEntry("100 %", 301)).toBe(301);
    expect(parsePageEntry("250%", 301)).toBe(301);
  });

  it("refuses what is not a page", () => {
    expect(parsePageEntry("", 300)).toBeNull();
    expect(parsePageEntry("twelve", 300)).toBeNull();
    expect(parsePageEntry("-3", 300)).toBeNull();
    expect(parsePageEntry("1.5", 300)).toBeNull();
    expect(parsePageEntry("12", 0)).toBeNull();
  });

  it("says how far through a page is, as the progress saved does", () => {
    expect(pagePercent(1, 300)).toBe(0);
    expect(pagePercent(300, 300)).toBe(100);
    expect(pagePercent(12, 300)).toBe(4);
    expect(pagePercent(1, 1)).toBe(100);
    expect(pagePercent(1, 0)).toBe(0);
  });
});
