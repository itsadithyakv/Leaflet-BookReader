import { describe, expect, it } from "vitest";
import { titleSizeClass, toolbarTitleClass } from "./titleFit";

describe("the title in the reader's toolbar", () => {
  it("is set large when it is short", () => {
    expect(titleSizeClass("The Final Empire")).toBe("text-xl");
    expect(titleSizeClass("  Dune  ")).toBe("text-xl");
  });

  it("is set smaller the longer it is", () => {
    expect(titleSizeClass("Game of Thrones Boxed Set: A Game of Thrones")).toBe("text-base");
    expect(
      titleSizeClass("The Communist Manifesto in Plain and Simple English (A Modern Translation and the Original Version)")
    ).toBe("text-sm");
  });

  it("stays on one line whatever its length", () => {
    for (const title of ["Dune", "A".repeat(50), "A".repeat(300), ""]) {
      expect(toolbarTitleClass(title)).toContain("truncate");
      expect(toolbarTitleClass(title)).toContain("max-w-");
    }
  });
});
