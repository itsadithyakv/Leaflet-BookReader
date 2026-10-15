import { describe, expect, it } from "vitest";
import { stripKeyHints } from "./touchTipWords";

describe("stripKeyHints", () => {
  it("leaves out the keys a phone does not have", () => {
    expect(stripKeyHints("Close (Esc)")).toBe("Close");
    expect(stripKeyHints("Search in this book (Ctrl+F)")).toBe("Search in this book");
    expect(stripKeyHints("Contents (C)")).toBe("Contents");
    expect(stripKeyHints("Previous match (Shift+Enter)")).toBe("Previous match");
    expect(stripKeyHints("Back to where you were (Alt+Left)")).toBe("Back to where you were");
    expect(stripKeyHints("Find everywhere (Ctrl+Shift+F)")).toBe("Find everywhere");
    expect(stripKeyHints("Zoom in (+)")).toBe("Zoom in");
    expect(stripKeyHints("Slower (-)")).toBe("Slower");
    expect(stripKeyHints("Fit to the window (0)")).toBe("Fit to the window");
    expect(stripKeyHints("The day read before this one (Left arrow)")).toBe("The day read before this one");
    expect(stripKeyHints("Auto scroll: 12 lines a minute (+ and - to adjust)")).toBe("Auto scroll: 12 lines a minute");
    expect(stripKeyHints("Search · Ctrl+F")).toBe("Search");
  });

  it("keeps the sentence round a hint in the middle", () => {
    expect(stripKeyHints("Pause (Space). Hold the page to make it wait.")).toBe("Pause. Hold the page to make it wait.");
    expect(stripKeyHints("Chapter 3 · open the chapter list (C)")).toBe("Chapter 3 · open the chapter list");
  });

  it("keeps brackets that are words", () => {
    expect(stripKeyHints("Cuddle Pip (or press and hold her)")).toBe("Cuddle Pip (or press and hold her)");
    expect(stripKeyHints("They are all in the (i).")).toBe("They are all in the (i).");
    expect(stripKeyHints("Highlights (3)")).toBe("Highlights (3)");
    expect(stripKeyHints("Section · A")).toBe("Section · A");
  });
});
