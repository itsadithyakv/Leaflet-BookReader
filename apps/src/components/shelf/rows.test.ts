import { describe, expect, it } from "vitest";
import type { DayRecord, FocusSessionRecord } from "../../services/habitService";
import { buildRows, freeReadsBesides, type WeekRow } from "./rows";

/** Saturday 3 October 2026: its week began on Monday 28 September. */
const TODAY = new Date(2026, 9, 3, 12, 0);

const day = (dateKey: string, minutes: number): DayRecord => ({
  dateKey,
  minutes,
  goalMinutes: 20,
  freezeUsed: false,
  graceUsed: false
});

const session = (id: string, dateKey: string, hour: number, minutes: number): FocusSessionRecord => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const startedAt = new Date(y, m - 1, d, hour, 0);
  return {
    id,
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + minutes * 60_000).toISOString(),
    dateKey,
    minutes,
    bookId: "book-1",
    title: "Middlemarch",
    notes: null,
    endedReason: "completed",
    clean: true,
    styleSeed: id,
    burnedAt: null
  };
};

const weeksOf = (rows: ReturnType<typeof buildRows>) => rows.filter((row): row is WeekRow => row.kind === "week");

describe("free reading on the session shelf", () => {
  it("shelves a day read with no focus session as loose pages", () => {
    // The reported case: a long read the evening before, no timer started.
    const rows = buildRows([], [day("2026-10-02", 95)], new Map(), TODAY, [{ dateKey: "2026-10-02", minutes: 95 }]);
    const [week] = weeksOf(rows);
    expect(week.label).toBe("This week");
    expect(week.minutes).toBe(95);
    expect(week.freeMinutes).toBe(95);
    expect(week.sessions).toBe(0);
    expect(week.spines).toHaveLength(1);
    expect(week.spines[0]).toMatchObject({
      id: "free-2026-10-02",
      session: null,
      loose: true,
      title: "Free read",
      minutes: 95,
      completed: false,
      burned: false
    });
    expect(week.spines[0].label).toBe("Free read, 95 min, Fri 2 Oct, read outside a focus session");
  });

  it("stands a day's free reading after that day's sessions, and apart from them", () => {
    const sessions = [session("s-evening", "2026-10-02", 20, 25), session("s-next", "2026-10-03", 9, 20)];
    const days = [day("2026-10-02", 65), day("2026-10-03", 20)];
    const [week] = weeksOf(buildRows(sessions, days, new Map(), TODAY, [{ dateKey: "2026-10-02", minutes: 40 }]));
    expect(week.spines.map((spine) => spine.id)).toEqual(["s-evening", "free-2026-10-02", "s-next"]);
    expect(week.spines.map((spine) => spine.loose)).toEqual([false, true, false]);
    // Spines are the focus sessions; the free read is counted on its own.
    expect(week.sessions).toBe(2);
    expect(week.freeMinutes).toBe(40);
    expect(week.minutes).toBe(85);
  });

  it("leaves a week read only in sessions as it was", () => {
    const sessions = [session("s1", "2026-10-01", 18, 30)];
    const [week] = weeksOf(buildRows(sessions, [day("2026-10-01", 30)], new Map(), TODAY, []));
    expect(week.spines).toHaveLength(1);
    expect(week.spines[0]).toMatchObject({ id: "s1", loose: false, completed: true, title: "Middlemarch" });
    expect(week.freeMinutes).toBe(0);
  });

  it("puts free reading from an earlier week on that week's row", () => {
    const days = [day("2026-09-22", 30), day("2026-10-02", 10)];
    const free = [
      { dateKey: "2026-09-22", minutes: 30 },
      { dateKey: "2026-10-02", minutes: 10 }
    ];
    const weeks = weeksOf(buildRows([], days, new Map(), TODAY, free));
    expect(weeks.map((week) => week.label)).toEqual(["This week", "Last week"]);
    expect(weeks[1].spines.map((spine) => spine.id)).toEqual(["free-2026-09-22"]);
    expect(weeks[1].freeMinutes).toBe(30);
  });
});

describe("free reading while a focus session runs", () => {
  const startedAt = new Date(2026, 9, 3, 11, 30).toISOString();

  it("does not list the running session's reading as free reading", () => {
    // Twelve minutes into a session, all of them in the ledger and none on the shelf yet.
    const free = [
      { dateKey: "2026-10-02", minutes: 40 },
      { dateKey: "2026-10-03", minutes: 12 }
    ];
    expect(freeReadsBesides(free, { startedAt, minutes: 12.2 }, TODAY)).toEqual([{ dateKey: "2026-10-02", minutes: 40 }]);
    // With no session, or one that has read nothing, it is the ledger's list.
    expect(freeReadsBesides(free, null, TODAY)).toBe(free);
    expect(freeReadsBesides(free, { startedAt, minutes: 0 }, TODAY)).toBe(free);
  });

  it("keeps what was read before the session started", () => {
    const free = [{ dateKey: "2026-10-03", minutes: 42 }];
    expect(freeReadsBesides(free, { startedAt, minutes: 12 }, TODAY)).toEqual([{ dateKey: "2026-10-03", minutes: 30 }]);
  });

  it("takes a session read across midnight from today, then from the day it started", () => {
    const lastNight = new Date(2026, 9, 2, 23, 45).toISOString();
    const free = [
      { dateKey: "2026-10-02", minutes: 45 },
      { dateKey: "2026-10-03", minutes: 10 }
    ];
    expect(freeReadsBesides(free, { startedAt: lastNight, minutes: 25 }, TODAY)).toEqual([
      { dateKey: "2026-10-02", minutes: 30 }
    ]);
  });
});
