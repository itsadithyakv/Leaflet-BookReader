import { describe, expect, it } from "vitest";
import type { DayRecord } from "../../services/habitService";
import { freezeRefusal } from "../../services/seedService";
import {
  addDays,
  findBreak,
  flameState,
  goalJustMet,
  isMilestone,
  nextMilestone,
  pickStreakMoments,
  pruneSeen,
  riskFrom,
  weekBubbles,
  weekStart,
  type MomentInput
} from "./streakModel";

// A Saturday.
const TODAY = "2026-10-17";

const day = (dateKey: string, minutes: number, extra: Partial<DayRecord> = {}): DayRecord => ({
  dateKey,
  minutes,
  goalMinutes: 20,
  freezeUsed: false,
  graceUsed: false,
  ...extra
});

const met = (key: string) => day(key, 25);
const run = (last: string, length: number) => Array.from({ length }, (_, at) => met(addDays(last, -at)));

const input = (overrides: Omit<Partial<MomentInput>, "snapshot"> & { snapshot?: Partial<MomentInput["snapshot"]> } = {}): MomentInput => ({
  today: TODAY,
  justMet: false,
  pendingBreak: null,
  seen: new Set(),
  ...overrides,
  snapshot: { streak: 0, todayMet: false, days: [], cold: null, ...overrides.snapshot }
});

describe("flameState", () => {
  it("is lit once today is met, whatever the hour", () => {
    expect(flameState({ streak: 4, todayMet: true }, 23 * 60)).toBe("lit");
  });
  it("is embers while a streak runs and today is open, at risk late", () => {
    expect(flameState({ streak: 4, todayMet: false }, 9 * 60)).toBe("embers");
    expect(flameState({ streak: 4, todayMet: false }, 20 * 60)).toBe("risk");
  });
  it("is out with no streak, even late", () => {
    expect(flameState({ streak: 0, todayMet: false }, 23 * 60)).toBe("out");
  });
  it("comes at risk an hour after an early daily reminder, never after 22:00", () => {
    expect(riskFrom(null)).toBe(20 * 60);
    expect(riskFrom({ daily: true, dailyAt: 8 * 60 })).toBe(9 * 60);
    expect(riskFrom({ daily: true, dailyAt: 21 * 60 + 30 })).toBe(20 * 60);
    expect(riskFrom({ daily: false, dailyAt: 8 * 60 })).toBe(20 * 60);
  });
});

describe("weekBubbles", () => {
  it("starts on Monday", () => {
    expect(weekStart(TODAY)).toBe("2026-10-12");
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
    expect(weekStart("2026-10-18")).toBe("2026-10-12");
  });

  it("marks met, frozen, grace, missed, today and future days", () => {
    const days = [
      met("2026-10-12"),
      day("2026-10-13", 0, { freezeUsed: true }),
      day("2026-10-14", 5, { graceUsed: true }),
      day("2026-10-15", 10),
      met("2026-10-16"),
      day(TODAY, 5)
    ];
    const week = weekBubbles({ days, todayMinutes: 5, goalMinutes: 20, todayMet: false }, TODAY);
    expect(week.map((bubble) => bubble.kind)).toEqual(["met", "frozen", "grace", "missed", "met", "today", "future"]);
    expect(week[5].progress).toBe(0.25);
    expect(week.map((bubble) => bubble.letter).join("")).toBe("MTWTFSS");
  });

  it("lights today once it is met", () => {
    const week = weekBubbles({ days: [], todayMinutes: 30, goalMinutes: 20, todayMet: true }, TODAY);
    expect(week[5]).toMatchObject({ kind: "met", progress: 1 });
  });
});

describe("milestones", () => {
  it("knows 7, 30, 100, 365 and every year after", () => {
    expect([7, 30, 100, 365, 730].every(isMilestone)).toBe(true);
    expect([1, 8, 364, 400].some(isMilestone)).toBe(false);
  });
  it("gives the next one and the way there from the last", () => {
    expect(nextMilestone(0)).toEqual({ target: 7, left: 7, share: 0 });
    expect(nextMilestone(7)).toMatchObject({ target: 30, left: 23, share: 0 });
    expect(nextMilestone(65).target).toBe(100);
    expect(nextMilestone(365)).toMatchObject({ target: 730, left: 365, share: 0 });
  });
});

describe("freezeRefusal", () => {
  const shop = { price: 40, boughtThisMonth: 0, perMonth: 2, held: 0, cap: 2 };
  it("sells one when there is room, the month allows it, and the seeds are there", () => {
    expect(freezeRefusal(shop, 40)).toBeNull();
  });
  it("says why not", () => {
    expect(freezeRefusal({ ...shop, held: 2 }, 100)).toMatch(/most there is room/);
    expect(freezeRefusal({ ...shop, boughtThisMonth: 2 }, 100)).toMatch(/a month/);
    expect(freezeRefusal(shop, 15)).toBe("25 more seeds needed");
    expect(freezeRefusal(undefined, 100)).toMatch(/app/);
  });
});

describe("goalJustMet", () => {
  it("is true only for undone to met on the same day", () => {
    expect(goalJustMet({ todayMet: false }, { todayMet: true }, TODAY, TODAY)).toBe(true);
    expect(goalJustMet(null, { todayMet: true }, null, TODAY)).toBe(false);
    expect(goalJustMet({ todayMet: true }, { todayMet: true }, TODAY, TODAY)).toBe(false);
    expect(goalJustMet({ todayMet: false }, { todayMet: true }, "2026-10-16", TODAY)).toBe(false);
  });
});

describe("findBreak", () => {
  it("finds the first missed day after the last that counted, and the run before it", () => {
    expect(findBreak(run("2026-10-14", 5), TODAY)).toEqual({ day: "2026-10-15", from: 5 });
  });
  it("counts covered days in the run", () => {
    const days = [...run("2026-10-13", 2), day("2026-10-14", 0, { freezeUsed: true }), met("2026-10-15")];
    expect(findBreak(days, TODAY)).toEqual({ day: "2026-10-16", from: 4 });
  });
  it("is nothing on an empty ledger", () => {
    expect(findBreak([], TODAY)).toBeNull();
  });
});

describe("pickStreakMoments", () => {
  it("shows the goal met just now, once", () => {
    const now = input({ justMet: true, snapshot: { streak: 4, todayMet: true, days: run(TODAY, 4) } });
    expect(pickStreakMoments(now)).toEqual([{ kind: "goal", keys: [`goal:${TODAY}`], streak: 4 }]);
    expect(pickStreakMoments({ ...now, seen: new Set([`goal:${TODAY}`]) })).toEqual([]);
  });

  it("never shows a goal moment while today is undone", () => {
    expect(pickStreakMoments(input({ justMet: true, snapshot: { streak: 4, todayMet: false, days: run(addDays(TODAY, -1), 4) } }))).toEqual([]);
  });

  it("does not call a goal met earlier (opened with it done) news", () => {
    expect(pickStreakMoments(input({ snapshot: { streak: 4, todayMet: true, days: run(TODAY, 4) } }))).toEqual([]);
  });

  it("shows yesterday saved by a freeze, once per saved day", () => {
    const days = [...run("2026-10-15", 3), day("2026-10-16", 0, { freezeUsed: true })];
    const due = pickStreakMoments(input({ snapshot: { streak: 4, todayMet: false, days } }));
    expect(due).toEqual([{ kind: "saved", keys: ["saved:2026-10-16"], days: ["2026-10-16"], by: "freeze", streak: 4 }]);
    expect(pickStreakMoments(input({ snapshot: { streak: 4, todayMet: false, days }, seen: new Set(due[0].keys) }))).toEqual([]);
  });

  it("says grace when grace covered the day, and folds two saved days into one moment", () => {
    const days = [...run("2026-10-14", 3), day("2026-10-15", 0, { graceUsed: true }), day("2026-10-16", 0, { freezeUsed: true })];
    const [moment] = pickStreakMoments(input({ snapshot: { streak: 5, todayMet: false, days } }));
    expect(moment).toMatchObject({ kind: "saved", by: "freeze", days: ["2026-10-15", "2026-10-16"] });
    const graceOnly = [...run("2026-10-15", 3), day("2026-10-16", 0, { graceUsed: true })];
    expect(pickStreakMoments(input({ snapshot: { streak: 4, todayMet: false, days: graceOnly } }))[0]).toMatchObject({ by: "grace" });
  });

  it("leaves an old saved day alone", () => {
    const days = [met("2026-10-01"), day("2026-10-02", 0, { freezeUsed: true }), ...run("2026-10-16", 14)];
    expect(pickStreakMoments(input({ snapshot: { streak: 16, todayMet: false, days } }))).toEqual([]);
  });

  it("shows a lost streak once, gently, and not a one-day one", () => {
    const days = run("2026-10-14", 6);
    const due = pickStreakMoments(input({ snapshot: { streak: 0, todayMet: false, days } }));
    expect(due).toEqual([{ kind: "lost", keys: ["lost:2026-10-15"], from: 6, day: "2026-10-15" }]);
    expect(pickStreakMoments(input({ snapshot: { streak: 0, todayMet: false, days }, seen: new Set(["lost:2026-10-15"]) }))).toEqual([]);
    expect(pickStreakMoments(input({ snapshot: { streak: 0, todayMet: false, days: [met("2026-10-14")] } }))).toEqual([]);
  });

  it("takes the break's day and length from Pip's cold and the store's notice when they have them", () => {
    const cold = { since: "2026-10-16", brokeFrom: 9, cure: 0, minutesLeftToday: 20, daysLeft: 2 };
    const [moment] = pickStreakMoments(input({ pendingBreak: { brokeFrom: 9 }, snapshot: { streak: 0, todayMet: false, days: run("2026-10-15", 3), cold } }));
    expect(moment).toEqual({ kind: "lost", keys: ["lost:2026-10-16"], from: 9, day: "2026-10-16" });
  });

  it("does not mourn a streak broken long ago, or once a new day is met", () => {
    expect(pickStreakMoments(input({ snapshot: { streak: 0, todayMet: false, days: run("2026-09-01", 10) } }))).toEqual([]);
    expect(pickStreakMoments(input({ snapshot: { streak: 1, todayMet: true, days: [...run("2026-10-14", 6), met(TODAY)] } }))).toEqual([]);
  });

  it("celebrates a milestone once, in place of the goal that made it", () => {
    const now = input({ justMet: true, snapshot: { streak: 7, todayMet: true, days: run(TODAY, 7) } });
    const due = pickStreakMoments(now);
    expect(due).toEqual([{ kind: "milestone", keys: [`milestone:7:${TODAY}`, `goal:${TODAY}`], milestone: 7, streak: 7 }]);
    expect(pickStreakMoments({ ...now, seen: new Set(due[0].keys) })).toEqual([]);
  });

  it("celebrates a milestone reached yesterday on the first open after it", () => {
    const due = pickStreakMoments(input({ snapshot: { streak: 30, todayMet: false, days: run("2026-10-16", 30) } }));
    expect(due).toEqual([{ kind: "milestone", keys: ["milestone:30:2026-10-16"], milestone: 30, streak: 30 }]);
  });

  it("puts a saved day before the milestone it carried the streak to", () => {
    const days = [...run("2026-10-15", 6), day("2026-10-16", 0, { freezeUsed: true })];
    expect(pickStreakMoments(input({ snapshot: { streak: 7, todayMet: false, days } })).map((moment) => moment.kind)).toEqual(["saved", "milestone"]);
  });
});

describe("pruneSeen", () => {
  it("keeps the last 60 days of markers", () => {
    expect(pruneSeen(["goal:2026-10-17", "saved:2026-08-01", "milestone:7:2026-10-10", "junk"], TODAY)).toEqual([
      "goal:2026-10-17",
      "milestone:7:2026-10-10"
    ]);
  });
});
