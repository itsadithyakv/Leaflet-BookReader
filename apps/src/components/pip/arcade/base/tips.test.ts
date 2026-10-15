import { describe, expect, it } from "vitest";
import { forFinger } from "./Tips";

describe("forFinger", () => {
  it("leaves out the keys a tooltip names for the keyboard", () => {
    expect(forFinger("Close (Esc)")).toBe("Close");
    expect(forFinger("Find in the book (Ctrl+F)")).toBe("Find in the book");
    expect(forFinger("Space or ↑ to jump. Esc pauses.")).toBe("Space or ↑ to jump.");
  });

  it("keeps words that only look like keys", () => {
    expect(forFinger("Enter the meadow. Space for three more.")).toBe("Enter the meadow. Space for three more.");
    expect(forFinger("The burrow (level 2) holds more")).toBe("The burrow (level 2) holds more");
  });
});
