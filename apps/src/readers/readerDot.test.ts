import { describe, expect, it } from "vitest";
import { dotIsStranded } from "./readerDot";

describe("Dotty and the chapters on the page", () => {
  it("is in place beside a line of a chapter on the page", () => {
    expect(dotIsStranded(36571, [20779, 41677])).toBe(false);
  });

  it("is stranded below a short chapter jumped to from deep in a long one", () => {
    // Deep in a chapter, then the cover (1,028px) from the chapter list: the
    // page scrolled on for 35,000px of nothing, and no chapter followed.
    expect(dotIsStranded(36571, [1028])).toBe(true);
  });

  it("is stranded while the page is being swapped", () => {
    expect(dotIsStranded(36571, [])).toBe(true);
  });

  it("may sit on the last line", () => {
    expect(dotIsStranded(1028, [1028])).toBe(false);
  });
});
