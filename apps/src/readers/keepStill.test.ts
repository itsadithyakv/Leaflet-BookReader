import { describe, expect, it } from "vitest";
import { aboveWindow, aboveWindowPrepended } from "./keepStill";

describe("a chapter above the window that changes height", () => {
  it("is above the window when its bottom was at or above the window's top", () => {
    // 0..20000 tall, the window from 25000: a picture in it grew it by 300.
    expect(aboveWindow(0, 20300, 300, 25000)).toBe(true);
    // Its bottom was at the window's top exactly.
    expect(aboveWindow(0, 25300, 300, 25000)).toBe(true);
    // Shrunk by 200.
    expect(aboveWindow(0, 19800, -200, 25000)).toBe(true);
  });

  it("is the reader's to see when the window shows any of it", () => {
    expect(aboveWindow(0, 25600, 300, 25000)).toBe(false);
    expect(aboveWindow(26000, 4000, 300, 25000)).toBe(false);
  });

  it("leaves a chapter drawn for the first time be: it had no height above the window", () => {
    // A jump's chapter, alone at the top of the page with the window on it.
    expect(aboveWindow(0, 30000, 30000, 0)).toBe(false);
    expect(aboveWindow(0, 30000, 30000, 5000)).toBe(false);
  });

  it("asks for nothing when it did not change", () => {
    expect(aboveWindow(0, 20000, 0, 25000)).toBe(false);
  });
});

describe("a chapter put in above the window", () => {
  it("keeps the text still as it is first drawn, from no height at the top of the page", () => {
    expect(aboveWindowPrepended(0, 25000, 25000, 0)).toBe(true);
    expect(aboveWindowPrepended(0, 25000, 25000, 300)).toBe(true);
  });

  it("keeps it still for a later change while it is above the window", () => {
    expect(aboveWindowPrepended(0, 25300, 300, 26000)).toBe(true);
  });

  it("leaves it be once the window is in it: a change below the line being read must not throw the page on", () => {
    expect(aboveWindowPrepended(0, 26588, 1588, 23000)).toBe(false);
  });
});
