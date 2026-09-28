import { describe, expect, it } from "vitest";
import { FINISHED_AT, isFinished } from "./books";

describe("isFinished", () => {
  it("counts the last page's 0.99x as finished", () => {
    expect(isFinished(0.995)).toBe(true);
    expect(isFinished(FINISHED_AT)).toBe(true);
    expect(isFinished(1)).toBe(true);
  });

  it("does not count a book still being read", () => {
    expect(isFinished(0.98)).toBe(false);
    expect(isFinished(0)).toBe(false);
    expect(isFinished(null)).toBe(false);
    expect(isFinished(undefined)).toBe(false);
  });
});
