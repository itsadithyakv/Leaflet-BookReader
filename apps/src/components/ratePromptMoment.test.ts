import { describe, expect, it } from "vitest";
import { GOOD_SESSION_MINUTES, goodVisit } from "./RatePrompt";

const at = (minutes: number, met = false, day = "2026-10-21") => ({ day, minutes, met });

describe("goodVisit (closing a book read freely)", () => {
  it("is a good moment after a proper sit-down", () => {
    expect(goodVisit(at(10), at(10 + GOOD_SESSION_MINUTES))).toBe(true);
    expect(goodVisit(at(10), at(10 + GOOD_SESSION_MINUTES - 1))).toBe(false);
  });

  it("is a good moment when the day's goal was met during the visit, not when it was met before", () => {
    expect(goodVisit(at(25), at(31, true))).toBe(true);
    expect(goodVisit(at(25, true), at(31, true))).toBe(false);
  });

  it("counts from nothing when the visit ran past midnight", () => {
    expect(goodVisit(at(50, true, "2026-10-20"), at(20, false))).toBe(true);
    expect(goodVisit(at(50, true, "2026-10-20"), at(5, false))).toBe(false);
  });
});
