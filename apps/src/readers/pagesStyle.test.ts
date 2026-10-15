import { describe, expect, it } from "vitest";
import { PHONE_PAGE_GAP, phonePageSides } from "./pagesStyle";

describe("a phone's page margins", () => {
  it("are half the gap a side with no cutout", () => {
    expect(phonePageSides(36, 0, 0)).toEqual({ left: 18, right: 18 });
  });

  it("let a cutout be the margin on its side, and give the gap's worth to the other", () => {
    expect(phonePageSides(36, 52, 0)).toEqual({ left: 0, right: 36 });
    expect(phonePageSides(36, 0, 52)).toEqual({ left: 36, right: 0 });
  });

  it("always add up to the gap, so every page is a whole turn wide", () => {
    for (const [left, right] of [[0, 0], [52, 0], [0, 48], [24, 24]]) {
      const sides = phonePageSides(PHONE_PAGE_GAP, left, right);
      expect(sides.left + sides.right).toBe(PHONE_PAGE_GAP);
    }
  });
});
