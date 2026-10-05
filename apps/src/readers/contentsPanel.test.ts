import { describe, expect, it } from "vitest";
import { CONTENTS_WIDTH, HANDLE_WIDTH, handleSizeFor, leftOpen, listFitsBeside, marginBesideText, reopensWith, shouldPeek } from "./contentsPanel";

describe("the margin beside the text", () => {
  // Measured in the preview at 18 px type, medium line length (34 em = 612 px).
  it("is just under what the page measures, scrolling and with pages", () => {
    // 800 px wide: the text started 87 px in (scrolling) and 89 px in (pages).
    expect(marginBesideText(800, "medium", 18, "scroll")).toBe(86);
    expect(marginBesideText(800, "medium", 18, "pages")).toBe(86);
  });

  it("grows with the window", () => {
    const widths = [800, 1024, 1366, 1600];
    const scroll = widths.map((width) => marginBesideText(width, "medium", 18, "scroll"));
    expect(scroll).toEqual([86, 198, 369, 486]);
    const pages = widths.map((width) => marginBesideText(width, "medium", 18, "pages"));
    expect(pages).toEqual([86, 198, 369, 486]);
  });

  it("is never less than the page's own gutter", () => {
    expect(marginBesideText(1366, "full", 18, "scroll")).toBe(40);
    expect(marginBesideText(1366, "full", 18, "pages")).toBe(40);
    expect(marginBesideText(800, "wide", 22, "scroll")).toBe(40);
  });

  it("promises only the page's own 24 px on a phone, where scrollbars keep no gutter", () => {
    expect(marginBesideText(600, "wide", 22, "scroll")).toBe(24);
    expect(marginBesideText(360, "medium", 18, "pages")).toBe(24);
    expect(marginBesideText(390, "medium", 18, "scroll")).toBe(24);
    // The handle there is the icon alone, 20 px: inside the 24.
    expect(HANDLE_WIDTH[handleSizeFor(24)]).toBe(20);
  });
});

describe("the handle and the list in that margin", () => {
  it("carries its word wherever the margin holds it, and is never wider than the margin", () => {
    for (const width of [800, 1024, 1366, 1600]) {
      for (const layout of ["scroll", "pages"] as const) {
        for (const measure of ["narrow", "medium", "wide", "full"] as const) {
          const margin = marginBesideText(width, measure, 18, layout);
          expect(HANDLE_WIDTH[handleSizeFor(margin)]).toBeLessThanOrEqual(margin);
        }
      }
    }
    expect(handleSizeFor(40)).toBe("word");
    expect(handleSizeFor(28)).toBe("icon");
  });

  it("holds the open list beside the text only in a wide window", () => {
    expect(listFitsBeside(marginBesideText(1024, "medium", 18, "scroll"))).toBe(false);
    expect(listFitsBeside(marginBesideText(1366, "medium", 18, "scroll"))).toBe(true);
    expect(listFitsBeside(marginBesideText(1280, "wide", 18, "scroll"))).toBe(false);
    expect(listFitsBeside(marginBesideText(1600, "wide", 18, "pages"))).toBe(true);
    expect(listFitsBeside(CONTENTS_WIDTH)).toBe(true);
  });

  it("comes back open with the book only where it fits beside the text", () => {
    expect(reopensWith(true, 369)).toBe(true);
    expect(reopensWith(true, 198)).toBe(false);
    expect(reopensWith(false, 486)).toBe(false);
  });
});

describe("the one showing, and what was left", () => {
  it("shows itself once, in a window wide enough", () => {
    expect(shouldPeek(false, 1024)).toBe(true);
    expect(shouldPeek(true, 1024)).toBe(false);
    expect(shouldPeek(false, 640)).toBe(false);
  });

  it("takes the book's own answer before the device's", () => {
    // (No storage in the test: the device has no answer, which reads as shut.)
    expect(leftOpen(true)).toBe(true);
    expect(leftOpen(false)).toBe(false);
    expect(leftOpen(undefined)).toBe(false);
  });
});
