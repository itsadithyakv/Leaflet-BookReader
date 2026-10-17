import { describe, expect, it } from "vitest";
import { defaultStartMode } from "./ReaderTour";

describe("how books open where the reader has not chosen", () => {
  it("scrolls by finger on a phone, and opens in Smart Read on a computer", () => {
    expect(defaultStartMode(true)).toBe("standard");
    expect(defaultStartMode(false)).toBe("smart");
  });
});
