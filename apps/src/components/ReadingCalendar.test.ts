import { describe, expect, it } from "vitest";
import type { DayRecord } from "../services/habitService";
import { dayLevel, isGoalMet } from "./ReadingCalendar";

const day = (minutes: number, goalMinutes: number): DayRecord => ({
  dateKey: "2026-10-02",
  minutes,
  goalMinutes,
  freezeUsed: false,
  graceUsed: false
});

describe("the reading calendar's shading", () => {
  it("shades a day against the goal it was read against, not the goal now", () => {
    // Met at 20 minutes; the goal has since gone up to 60.
    const met = day(25, 20);
    expect(isGoalMet(met)).toBe(true);
    expect(dayLevel(met, 60)).toBe(4);
    // Short of its 60; the goal has since come down to 20.
    const short = day(25, 60);
    expect(isGoalMet(short)).toBe(false);
    expect(dayLevel(short, 20)).toBe(2);
  });

  it("uses the goal now for a day that has none of its own", () => {
    expect(dayLevel(day(10, 0), 20)).toBe(2);
    expect(dayLevel(undefined, 20)).toBe(0);
    expect(dayLevel(day(0, 20), 20)).toBe(0);
  });
});
