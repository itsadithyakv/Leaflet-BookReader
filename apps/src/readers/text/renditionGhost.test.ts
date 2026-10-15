import { describe, expect, it } from "vitest";
import { layoutChangesAt } from "./renditionGhost";
import { layoutForShape, type ReaderShape } from "../touchLayout";

const stored = (upright: string | null, sideways: string | null) => (shape: ReaderShape) => layoutForShape(shape, { upright, sideways });

describe("a turn of the phone that lays the book out again", () => {
  it("is known from the new size: upright scrolling to a sideways spread, and back", () => {
    const defaults = stored(null, null);
    expect(layoutChangesAt(915, 412, true, { layout: "scroll", spread: false }, defaults)).toBe(true);
    expect(layoutChangesAt(412, 915, true, { layout: "pages", spread: true }, defaults)).toBe(true);
  });

  it("is not one when both ways up keep the same layout", () => {
    const scrolling = stored("scroll", "scroll");
    expect(layoutChangesAt(915, 412, true, { layout: "scroll", spread: false }, scrolling)).toBe(false);
    expect(layoutChangesAt(412, 915, true, { layout: "scroll", spread: false }, scrolling)).toBe(false);
  });

  it("is one when pages become a spread", () => {
    const pages = stored("pages", "pages");
    expect(layoutChangesAt(915, 412, true, { layout: "pages", spread: false }, pages)).toBe(true);
    expect(layoutChangesAt(915, 412, true, { layout: "pages", spread: true }, pages)).toBe(false);
  });

  it("never happens on a desktop window being resized", () => {
    expect(layoutChangesAt(700, 400, false, { layout: "scroll", spread: false }, stored(null, null))).toBe(false);
  });
});
