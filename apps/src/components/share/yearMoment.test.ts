import { describe, expect, it } from "vitest";
import { pipHasToTell, pipYearLine, readIn, yearInSeason } from "./yearMoment";

const on = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour);

describe("when the year is in season", () => {
  it("is from 24 December to 7 January, by the device's own calendar", () => {
    expect(yearInSeason(on(2026, 12, 23, 23))).toBeNull();
    expect(yearInSeason(on(2026, 12, 24, 0))).toBe(2026);
    expect(yearInSeason(on(2026, 12, 31, 23))).toBe(2026);
    expect(yearInSeason(on(2027, 1, 1, 0))).toBe(2026);
    expect(yearInSeason(on(2027, 1, 7, 23))).toBe(2026);
    expect(yearInSeason(on(2027, 1, 8, 0))).toBeNull();
    expect(yearInSeason(on(2026, 6, 24))).toBeNull();
  });

  it("is only for a year with reading in it", () => {
    const days = [{ dateKey: "2026-03-01", minutes: 0 }, { dateKey: "2025-12-31", minutes: 20 }];
    expect(readIn(days, 2026)).toBe(false);
    expect(readIn(days, 2025)).toBe(true);
  });
});

describe("Pip's word about it", () => {
  it("is said once a year", () => {
    expect(pipHasToTell(2026, null)).toBe(true);
    expect(pipHasToTell(2026, "2025")).toBe(true);
    expect(pipHasToTell(2026, "2026")).toBe(false);
  });

  it("is in her voice and fits her bubble", () => {
    const line = pipYearLine(2026);
    expect(line).toBe(line.toLowerCase());
    expect(line.length).toBeLessThanOrEqual(60);
  });
});
