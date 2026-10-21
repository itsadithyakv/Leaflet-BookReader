import { describe, expect, it } from "vitest";
import { layoutChangesAt } from "./renditionGhost";

describe("a turn of the phone that lays the book out again", () => {
  it("is not one when scrolling: the layout is kept both ways, and only the width changes", () => {
    expect(layoutChangesAt(915, 412, true, { layout: "scroll", spread: false })).toBe(false);
    expect(layoutChangesAt(412, 915, true, { layout: "scroll", spread: false })).toBe(false);
  });

  it("is one when pages become a spread on its side, or one column upright again", () => {
    expect(layoutChangesAt(915, 412, true, { layout: "pages", spread: false })).toBe(true);
    expect(layoutChangesAt(412, 915, true, { layout: "pages", spread: true })).toBe(true);
    expect(layoutChangesAt(915, 412, true, { layout: "pages", spread: true })).toBe(false);
  });

  it("is one when a tablet with pages turns on its side, or back upright", () => {
    expect(layoutChangesAt(1280, 800, true, { layout: "pages", spread: false })).toBe(true);
    expect(layoutChangesAt(800, 1280, true, { layout: "pages", spread: true })).toBe(true);
    expect(layoutChangesAt(800, 1280, true, { layout: "scroll", spread: false })).toBe(false);
  });

  it("never happens on a desktop window being resized", () => {
    expect(layoutChangesAt(700, 400, false, { layout: "scroll", spread: false })).toBe(false);
    expect(layoutChangesAt(700, 400, false, { layout: "pages", spread: false })).toBe(false);
  });
});
