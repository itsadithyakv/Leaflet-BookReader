import { describe, expect, it } from "vitest";
import {
  BACK_CHIP_MS,
  CORNER_PX,
  backChipLabel,
  backChipShown,
  bookmarksShowing,
  footerText,
  inBookmarkCorner,
  nextFooterMode,
  readFooterMode,
  shownFooterMode,
  type FooterFacts
} from "./phoneReading";
import { tapAction, tapZone } from "./touchLayout";

const facts = (over: Partial<FooterFacts> = {}): FooterFacts => ({
  chapter: 12,
  book: 340,
  progress: 0.34,
  pageOf: null,
  clock: "9:41",
  clockLeads: false,
  ...over
});

describe("the footer's line", () => {
  it("says the time left in the chapter by default", () => {
    expect(readFooterMode(null)).toBe("chapter");
    expect(readFooterMode("nonsense")).toBe("chapter");
    expect(footerText("chapter", facts())).toBe("12 min left in chapter");
  });

  it("goes chapter, book, place, clock and round again with each tap", () => {
    const f = facts();
    expect(nextFooterMode("chapter", f)).toBe("book");
    expect(nextFooterMode("book", f)).toBe("place");
    expect(nextFooterMode("place", f)).toBe("clock");
    expect(nextFooterMode("clock", f)).toBe("chapter");
    expect(footerText("book", f)).toBe("5 h 40 min left in book");
    expect(footerText("place", f)).toBe("34%");
    expect(footerText("clock", f)).toBe("9:41");
  });

  it("names the page with pages", () => {
    expect(footerText("place", facts({ pageOf: { page: 3, total: 12 } }))).toBe("Page 3 of 12 · 34%");
    // A chapter of one page says just how far.
    expect(footerText("place", facts({ pageOf: { page: 1, total: 1 } }))).toBe("34%");
  });

  it("leads with the time while the status bar is away, and then has no clock of its own", () => {
    const f = facts({ clockLeads: true });
    expect(footerText("chapter", f)).toBe("9:41 · 12 min left in chapter");
    expect(nextFooterMode("place", f)).toBe("chapter");
    expect(footerText("clock", f)).toBe("9:41 · 12 min left in chapter");
  });

  it("skips what it cannot say yet (no reading pace)", () => {
    const f = facts({ chapter: null, book: null });
    expect(shownFooterMode("chapter", f)).toBe("place");
    expect(footerText("chapter", f)).toBe("34%");
    expect(nextFooterMode("place", f)).toBe("clock");
    expect(nextFooterMode("clock", f)).toBe("place");
    expect(footerText("chapter", facts({ chapter: null, book: null, progress: null, clockLeads: true }))).toBe("9:41");
  });
});

describe("the bookmark corner", () => {
  const page = { left: 0, top: 24, width: 412 };

  it("is the top right 56px of the page", () => {
    expect(inBookmarkCorner(412 - 10, 24 + 10, page)).toBe(true);
    expect(inBookmarkCorner(412 - CORNER_PX, 24 + CORNER_PX, page)).toBe(true);
    expect(inBookmarkCorner(412 - CORNER_PX - 1, 30, page)).toBe(false);
    expect(inBookmarkCorner(400, 24 + CORNER_PX + 1, page)).toBe(false);
    // Above the page (the status bar's inset) is not the page.
    expect(inBookmarkCorner(400, 10, page)).toBe(false);
  });

  it("bookmarks on a phone, before the side it is in turns the page", () => {
    const zone = tapZone(400, 0, 412);
    expect(tapAction(zone, "pages", true, true)).toEqual({ kind: "bookmark" });
    expect(tapAction(zone, "scroll", true, true)).toEqual({ kind: "bookmark" });
    // Below the corner the right side turns as before.
    expect(tapAction(zone, "pages", true, false)).toEqual({ kind: "turn", step: 1 });
    // Not on a tablet or with a mouse.
    expect(tapAction(zone, "pages", false, true)).toEqual({ kind: "turn", step: 1 });
  });

  it("finds the bookmarks on the page showing", () => {
    const order = (a: string, b: string) => Number(a) - Number(b);
    const marks = [{ cfi: "5" }, { cfi: "12" }, { cfi: "30" }];
    expect(bookmarksShowing(marks, "10", "20", order)).toEqual([{ cfi: "12" }]);
    expect(bookmarksShowing(marks, "13", "20", order)).toEqual([]);
    expect(bookmarksShowing(marks, "12", null, order)).toEqual([{ cfi: "12" }]);
    expect(bookmarksShowing(marks, null, "20", order)).toEqual([]);
  });
});

describe("the way back after a jump", () => {
  it("names the chapter left, or how far through when the jump stayed in it", () => {
    expect(backChipLabel({ chapter: "Chapter 3", progress: 0.12 }, { chapter: "Chapter 9" })).toBe("Chapter 3");
    expect(backChipLabel({ chapter: "Chapter 3", progress: 0.12 }, { chapter: "Chapter 3" })).toBe("12%");
    expect(backChipLabel({ chapter: null, progress: null }, { chapter: null })).toBe("where you were");
  });

  it("shows for a few seconds after the jump, while there is somewhere to go back to", () => {
    const chip = { at: 1000, from: { chapter: null, progress: 0.4 } };
    expect(backChipShown(chip, 1000, true)).toBe(true);
    expect(backChipShown(chip, 1000 + BACK_CHIP_MS - 1, true)).toBe(true);
    expect(backChipShown(chip, 1000 + BACK_CHIP_MS, true)).toBe(false);
    expect(backChipShown(chip, 1500, false)).toBe(false);
    expect(backChipShown(null, 1500, true)).toBe(false);
  });
});
