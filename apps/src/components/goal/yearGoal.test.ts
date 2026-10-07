import { beforeEach, describe, expect, it } from "vitest";
import { cleanGoal, finishedInYear, goalStanding, setYearGoal, yearGoal } from "./yearGoal";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key)
    }
  });
});

describe("books finished in a year", () => {
  it("goes by the finished date, and by the progress stamp where there is none", () => {
    const books = [
      { progress: 1, finishedAt: "2026-02-01T10:00:00.000Z" },
      // Read again this year: still finished last year, and only then.
      { progress: 0.4, finishedAt: "2025-11-01T10:00:00.000Z", progressUpdatedAt: "2026-03-01T10:00:00.000Z" },
      // Finished before the date was kept.
      { progress: 0.995, progressUpdatedAt: "2026-06-01T10:00:00.000Z" },
      { progress: 0.5, progressUpdatedAt: "2026-06-01T10:00:00.000Z" },
      { progress: 0, finishedAt: "" }
    ];
    expect(finishedInYear(books, 2026)).toBe(2);
    expect(finishedInYear(books, 2025)).toBe(1);
    expect(finishedInYear(books, 2024)).toBe(0);
  });
});

describe("the goal", () => {
  it("is a whole number of books, or none", () => {
    expect(cleanGoal(12)).toBe(12);
    expect(cleanGoal("20")).toBe(20);
    expect(cleanGoal(12.6)).toBe(13);
    expect(cleanGoal(0)).toBeNull();
    expect(cleanGoal(-3)).toBeNull();
    expect(cleanGoal("many")).toBeNull();
    expect(cleanGoal(null)).toBeNull();
    expect(cleanGoal(5000)).toBe(365);
  });

  const october = new Date(2026, 9, 7, 9);

  it("is kept for its own year with the day it was set, and can be taken away", () => {
    expect(yearGoal(2026)).toBeNull();
    expect(setYearGoal(2026, 24, october, 5)).toEqual({ goal: 24, since: "2026-10-07", had: 5 });
    expect(yearGoal(2026)).toEqual({ goal: 24, since: "2026-10-07", had: 5 });
    expect(yearGoal(2027)).toBeNull();
    // Set ahead of its year: its pace starts with the year.
    expect(setYearGoal(2027, 30, october, 0)).toEqual({ goal: 30, since: "2027-01-01", had: 0 });
    expect(setYearGoal(2026, null, october, 5)).toBeNull();
    expect(yearGoal(2026)).toBeNull();
    expect(yearGoal(2027)?.goal).toBe(30);
  });

  it("reads as none when what was kept is not a goal, and a bare number as one set at New Year", () => {
    store.set("leaflet.goal.booksPerYear", "not json");
    expect(yearGoal(2026)).toBeNull();
    store.set("leaflet.goal.booksPerYear", JSON.stringify([1, 2]));
    expect(yearGoal(2026)).toBeNull();
    store.set("leaflet.goal.booksPerYear", JSON.stringify({ 2026: 12, 2025: { goal: 8, since: "2099-01-01", had: -3 } }));
    expect(yearGoal(2026)).toEqual({ goal: 12, since: "2026-01-01", had: 0 });
    // A day that is not in its year, and a count that is not one: New Year, and none.
    expect(yearGoal(2025)).toEqual({ goal: 8, since: "2025-01-01", had: 0 });
  });
});

describe("standing against the goal", () => {
  // Half way through 2026: day 182 of 365.
  const july = new Date(2026, 6, 1, 12);
  const sinceNewYear = (goal: number) => ({ goal, since: "2026-01-01", had: 0 });

  it("says ahead, behind or on pace, in whole books", () => {
    // 24 a year is about 12 due by 1 July.
    expect(goalStanding(12, sinceNewYear(24), 2026, july).words).toBe("On pace");
    expect(goalStanding(15, sinceNewYear(24), 2026, july).words).toBe("3 ahead");
    expect(goalStanding(8, sinceNewYear(24), 2026, july).words).toBe("3 behind");
    expect(goalStanding(11, sinceNewYear(24), 2026, july).words).toBe("On pace");
    expect(goalStanding(12, sinceNewYear(24), 2026, july).share).toBe(0.5);
  });

  it("starts the pace on the day the goal was set, with what was read by then", () => {
    // Twenty for the year, set on 7 October with five read: fifteen to go in 85 days.
    const kept = { goal: 20, since: "2026-10-07", had: 5 };
    expect(goalStanding(5, kept, 2026, new Date(2026, 9, 7, 9)).words).toBe("On pace");
    expect(goalStanding(5, kept, 2026, new Date(2026, 9, 10, 9)).words).toBe("On pace");
    // Half of what was left of the year later: about 12.5 due.
    expect(goalStanding(9, kept, 2026, new Date(2026, 10, 18, 9)).words).toBe("3 behind");
    expect(goalStanding(15, kept, 2026, new Date(2026, 10, 18, 9)).words).toBe("2 ahead");
    // The last day, one short: that is one behind, not "on pace".
    expect(goalStanding(19, kept, 2026, new Date(2026, 11, 31, 9)).words).toBe("1 behind");
  });

  it("says when it is met, and by how much it is passed", () => {
    expect(goalStanding(24, sinceNewYear(24), 2026, july)).toEqual({ share: 1, words: "Done" });
    expect(goalStanding(27, sinceNewYear(24), 2026, july)).toEqual({ share: 1, words: "3 over" });
  });

  it("has no pace for a year that is not this one", () => {
    expect(goalStanding(8, { goal: 24, since: "2025-01-01", had: 0 }, 2025, july)).toEqual({ share: 8 / 24, words: null });
  });

  it("is not behind on the first day", () => {
    expect(goalStanding(0, { goal: 52, since: "2026-01-01", had: 0 }, 2026, new Date(2026, 0, 1, 9)).words).toBe("On pace");
  });
});
