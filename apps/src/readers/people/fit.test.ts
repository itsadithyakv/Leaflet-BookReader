import { describe, expect, it } from "vitest";
import { scrollToShow } from "./fit";

describe("scrollToShow", () => {
  const view = { top: 100, bottom: 400 };

  it("leaves a field that shows whole where it is", () => {
    expect(scrollToShow({ top: 200, bottom: 240 }, view)).toBe(0);
  });

  it("scrolls down to a field the keyboard's shorter window left below the list", () => {
    // The list now ends at 400; the field is at 420 to 460.
    expect(scrollToShow({ top: 420, bottom: 460 }, view)).toBe(68);
  });

  it("scrolls up to a field above the list's top", () => {
    expect(scrollToShow({ top: 60, bottom: 100 }, view)).toBe(-48);
  });

  it("shows the top of a field taller than the room", () => {
    expect(scrollToShow({ top: 150, bottom: 600 }, view)).toBe(42);
  });
});
