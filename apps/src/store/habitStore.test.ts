import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { EMPTY_SNAPSHOT, getDateKey, habitService } from "../services/habitService";
import { flowerGrowing, sessionElapsedMs, useHabitStore, wholeTodayMinutes, type ActiveSession } from "./habitStore";

const MINUTE = 60_000;

/** A 20-minute session started 175 minutes ago, the case from the wrap-up screen. */
const session = (over: Partial<ActiveSession> = {}): ActiveSession => ({
  startedAt: new Date(Date.now() - 175 * MINUTE).toISOString(),
  durationMinutes: 20,
  ...over
});

describe("the session clock", () => {
  beforeEach(() => {
    useHabitStore.setState({ activeSession: null, readingAt: null });
  });

  it("counts what was read, not the hours the session sat open", () => {
    useHabitStore.setState({ activeSession: session({ readMs: 0 }) });
    // Ten minutes of heartbeats, then the book goes to the background.
    for (let beat = 0; beat < 40; beat += 1) {
      useHabitStore.getState().addSessionReading(15_000);
    }
    useHabitStore.getState().setSessionReading(false);
    const active = useHabitStore.getState().activeSession as ActiveSession;
    expect(sessionElapsedMs(active)).toBe(10 * MINUTE);
  });

  it("runs smoothly between beats, but never more than one beat ahead", () => {
    const active = session({ readMs: MINUTE });
    const beat = 1_000_000;
    expect(sessionElapsedMs(active, beat + 5_000, beat)).toBe(MINUTE + 5_000);
    // A stalled heartbeat (sleep, a frozen window) cannot run the clock on.
    expect(sessionElapsedMs(active, beat + 10 * MINUTE, beat)).toBe(MINUTE + 15_000);
    // Not reading: the clock holds.
    expect(sessionElapsedMs(active, beat + 5_000, null)).toBe(MINUTE);
  });

  it("starts an older build's session from its old clock, capped at the session's length", () => {
    // The old clock would say 175 minutes; the session is 20 minutes long.
    expect(sessionElapsedMs(session(), Date.now(), null)).toBe(20 * MINUTE);
    useHabitStore.setState({ activeSession: session() });
    useHabitStore.getState().addSessionReading(15_000);
    const active = useHabitStore.getState().activeSession as ActiveSession;
    expect(active.readMs).toBe(20 * MINUTE + 15_000);
  });

  it("holds and runs as reading stops and starts, only with a session going", () => {
    useHabitStore.getState().setSessionReading(true);
    expect(useHabitStore.getState().readingAt).toBeNull();
    useHabitStore.setState({ activeSession: session({ readMs: 0 }) });
    useHabitStore.getState().setSessionReading(true);
    expect(useHabitStore.getState().readingAt).not.toBeNull();
    useHabitStore.getState().setSessionReading(false);
    expect(useHabitStore.getState().readingAt).toBeNull();
  });
});

describe("today's minutes beside the goal", () => {
  it("never reads as the goal while the goal is unmet", () => {
    // 19.6 of 20 minutes: "19 / 20 min", with "1 min to go" beside it.
    expect(wholeTodayMinutes(19.6, false)).toBe(19);
    expect(wholeTodayMinutes(19.6, true)).toBe(20);
    expect(wholeTodayMinutes(20.4, true)).toBe(20);
    expect(wholeTodayMinutes(0.9, false)).toBe(0);
  });
});

/** The store's own storage, in memory: the tests run in Node, which has none. */
const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, String(value)),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear()
  };
};

describe("the focus flower", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    useHabitStore.setState({ activeSession: null, readingAt: null, awaySince: null, wrapUp: null });
    useHabitStore.getState().setFocusSettings({ kioskMode: false });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const start = (fullScreen: boolean) => {
    useHabitStore.getState().setFocusSettings({ kioskMode: fullScreen });
    useHabitStore.getState().startSession({ startedAt: new Date().toISOString(), durationMinutes: 20 });
    return useHabitStore.getState().activeSession as ActiveSession;
  };
  const flower = () => useHabitStore.getState().activeSession?.flower;
  const awayFor = (ms: number) => {
    useHabitStore.getState().setForeground(false);
    useHabitStore.setState({ awaySince: Date.now() - ms });
    useHabitStore.getState().setForeground(true);
  };

  it("is planted only by a session started in full screen", () => {
    expect(start(false).flower).toBeUndefined();
    useHabitStore.setState({ activeSession: null });
    expect(start(true).flower?.kind).toMatch(/^(tulip|daisy|sunflower|rose)$/);
    // Turning full screen on mid-session does not plant one late.
    useHabitStore.setState({ activeSession: null });
    start(false);
    useHabitStore.getState().setFocusSettings({ kioskMode: true });
    expect(flower()).toBeUndefined();
  });

  it("starts a session's clock at nothing read", () => {
    expect(start(false).readMs).toBe(0);
  });

  it("blooms when the session completes, and wilts when it ends early", async () => {
    start(true);
    useHabitStore.getState().addSessionReading(20 * MINUTE);
    await useHabitStore.getState().stopSession({ reason: "completed", cleanSession: true });
    expect(useHabitStore.getState().wrapUp?.flower).toMatchObject({ bloomed: true });
    expect(useHabitStore.getState().wrapUp?.blooms).toBe(1);

    start(true);
    useHabitStore.getState().addSessionReading(8 * MINUTE);
    await useHabitStore.getState().stopSession({ reason: "manual_end", cleanSession: false });
    expect(useHabitStore.getState().wrapUp?.flower).toMatchObject({ bloomed: false, wilted: "ended" });
    // Drawn as far as it had grown: 8 of 20 minutes.
    expect(useHabitStore.getState().wrapUp?.flower?.at).toBeCloseTo(0.4);
  });

  it("forgives a glance away, not a stint in another app, and a wilt lasts", async () => {
    start(true);
    awayFor(10_000);
    expect(flowerGrowing(useHabitStore.getState().activeSession)).toBe(true);
    awayFor(45_000);
    expect(flower()?.wilted).toBe("away");
    // Finishing the session afterwards does not bring it back.
    useHabitStore.getState().addSessionReading(20 * MINUTE);
    await useHabitStore.getState().stopSession({ reason: "completed", cleanSession: true });
    expect(useHabitStore.getState().wrapUp?.flower).toMatchObject({ bloomed: false, wilted: "away" });
  });

  it("wilts when full screen goes off mid-session", () => {
    start(true);
    useHabitStore.getState().setFocusSettings({ kioskMode: false });
    expect(flower()?.wilted).toBe("unlocked");
  });

  it("survives a quick restart, not Leaflet closed for longer", async () => {
    start(true);
    localStorage.setItem("leaflet.habit.aliveAt", String(Date.now() - 5_000));
    await useHabitStore.getState().resumeSession();
    expect(flowerGrowing(useHabitStore.getState().activeSession)).toBe(true);
    localStorage.setItem("leaflet.habit.aliveAt", String(Date.now() - 5 * MINUTE));
    await useHabitStore.getState().resumeSession();
    expect(flower()?.wilted).toBe("closed");
  });

  it("notices when the computer slept through a session", () => {
    start(true);
    useHabitStore.getState().keepAlive();
    expect(flowerGrowing(useHabitStore.getState().activeSession)).toBe(true);
    localStorage.setItem("leaflet.habit.aliveAt", String(Date.now() - 2 * MINUTE));
    useHabitStore.getState().keepAlive();
    expect(flower()?.wilted).toBe("away");
  });
});

describe("reading held for the ledger", () => {
  const PENDING_KEY = "leaflet.habit.pendingReading";
  const store = () => useHabitStore.getState();
  let credit: MockInstance<typeof habitService.creditMinutes>;

  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    useHabitStore.setState({ activeSession: null, readingAt: null, pendingReading: null, snapshot: EMPTY_SNAPSHOT });
    credit = vi.spyOn(habitService, "creditMinutes").mockResolvedValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("counts reading with no focus session running", async () => {
    // A minute of heartbeats in an open book, no timer started.
    for (let beat = 0; beat < 4; beat += 1) {
      store().addReading(15_000);
      store().addSessionReading(15_000);
    }
    expect(store().activeSession).toBeNull();
    expect(store().pendingReading).toEqual({ dateKey: getDateKey(), ms: 60_000 });
    await store().flushReading();
    expect(credit).toHaveBeenCalledTimes(1);
    expect(credit).toHaveBeenCalledWith(1, getDateKey());
    expect(store().pendingReading).toBeNull();
  });

  it("takes the ledger's answer, free reading included", async () => {
    const freeReads = [{ dateKey: getDateKey(), minutes: 12 }];
    credit.mockResolvedValue({ ...EMPTY_SNAPSHOT, todayMinutes: 12, freeReads });
    store().addReading(60_000);
    await store().flushReading();
    expect(store().snapshot.todayMinutes).toBe(12);
    expect(store().snapshot.freeReads).toEqual(freeReads);
  });

  it("credits the same time once when two flushes overlap", async () => {
    store().addReading(60_000);
    await Promise.all([store().flushReading(), store().flushReading()]);
    expect(credit).toHaveBeenCalledTimes(1);
  });

  it("holds the time for the next flush when the ledger cannot be written", async () => {
    credit.mockRejectedValueOnce(new Error("database is locked"));
    store().addReading(30_000);
    await store().flushReading();
    expect(store().pendingReading).toEqual({ dateKey: getDateKey(), ms: 30_000 });
    store().addReading(15_000);
    await store().flushReading();
    expect(credit).toHaveBeenLastCalledWith(0.75, getDateKey());
    expect(store().pendingReading).toBeNull();
  });

  it("credits reading before midnight to the day it was read", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 2, 23, 59, 50));
    store().addReading(15_000);
    vi.setSystemTime(new Date(2026, 9, 3, 0, 0, 5));
    store().addReading(15_000);
    expect(credit).toHaveBeenCalledWith(0.25, "2026-10-02");
    expect(store().pendingReading).toEqual({ dateKey: "2026-10-03", ms: 15_000 });
  });

  it("keeps the time in storage, so Leaflet closed mid-read credits it when it next opens", async () => {
    store().addReading(45_000);
    expect(JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null")).toEqual({ dateKey: getDateKey(), ms: 45_000 });

    // Leaflet opens again: a new store, the same storage.
    vi.resetModules();
    const service = await import("../services/habitService");
    const relaunchCredit = vi.spyOn(service.habitService, "creditMinutes").mockResolvedValue(null);
    const relaunched = (await import("./habitStore")).useHabitStore;
    expect(relaunched.getState().pendingReading).toEqual({ dateKey: getDateKey(), ms: 45_000 });
    await relaunched.getState().load();
    expect(relaunchCredit).toHaveBeenCalledWith(0.75, getDateKey());
    expect(relaunched.getState().pendingReading).toBeNull();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("credits a leftover minute before the streak is judged on launch", async () => {
    // The minute that met yesterday's goal: judged without it, yesterday
    // costs grace or a freeze, or the shelf.
    const snapshot = vi.spyOn(habitService, "snapshot").mockResolvedValue(EMPTY_SNAPSHOT);
    useHabitStore.setState({ pendingReading: { dateKey: "2026-10-02", ms: 45_000 } });
    await store().load();
    expect(credit).toHaveBeenCalledWith(0.75, "2026-10-02");
    expect(credit.mock.invocationCallOrder[0]).toBeLessThan(snapshot.mock.invocationCallOrder[0]);
  });

  it("shows a streak found broken by a credit, not only by opening Leaflet", async () => {
    // Leaflet sat open for days: the first minute read is what asks the ledger.
    useHabitStore.setState({ pendingBreak: null });
    credit.mockResolvedValue({ ...EMPTY_SNAPSHOT, brokeFrom: 5 });
    store().addReading(60_000);
    await store().flushReading();
    expect(store().pendingBreak).toEqual({ brokeFrom: 5 });
  });

  it("counts the held reading before a session is recorded, and shows it with the wrap-up", async () => {
    // A 20-minute session against a 20-minute goal: 19 minutes are in the
    // ledger and the last one is still held when the session completes.
    let ledger = 19;
    const answer = () => ({ ...EMPTY_SNAPSHOT, todayMinutes: ledger, todayMet: ledger >= 20 });
    useHabitStore.setState({ snapshot: answer(), wrapUp: null, pendingBreak: null });
    credit.mockImplementation(async (minutes) => {
      ledger += minutes;
      return answer();
    });
    const record = vi.spyOn(habitService, "recordSession").mockImplementation(async () => answer());
    // Goal met with no wrap-up up is what sets off the other celebration.
    let metWithoutWrapUp = false;
    const stop = useHabitStore.subscribe((state) => {
      metWithoutWrapUp = metWithoutWrapUp || (state.snapshot.todayMet && !state.wrapUp);
    });

    store().startSession({ startedAt: new Date().toISOString(), durationMinutes: 20 });
    store().addSessionReading(20 * MINUTE);
    store().addReading(MINUTE);
    await store().stopSession({ reason: "completed", cleanSession: true });
    stop();

    expect(credit.mock.invocationCallOrder[0]).toBeLessThan(record.mock.invocationCallOrder[0]);
    expect(store().wrapUp).toMatchObject({ todayMinutes: 20, todayMet: true, goalJustMet: true });
    expect(store().snapshot.todayMet).toBe(true);
    expect(metWithoutWrapUp).toBe(false);
    expect(store().pendingReading).toBeNull();
  });

  it("says in the wrap-up that a session's reading cured Pip's cold, however the goal was met", async () => {
    const ill = { since: "2026-10-01", brokeFrom: 5, cure: 0.5, minutesLeftToday: 10, daysLeft: 3 };
    let ledger = 10;
    const answer = () => ({ ...EMPTY_SNAPSHOT, todayMinutes: ledger, todayMet: ledger >= 20, cold: ledger >= 20 ? null : ill });
    useHabitStore.setState({ snapshot: answer(), wrapUp: null, pendingBreak: null });
    credit.mockImplementation(async (minutes) => {
      ledger += minutes;
      return answer();
    });
    vi.spyOn(habitService, "recordSession").mockImplementation(async () => answer());

    // The goal is met by a flush in the middle of the session, as it usually
    // is: by the time the session stops, the snapshot already has no cold.
    store().startSession({ startedAt: new Date().toISOString(), durationMinutes: 20 });
    store().addReading(10 * MINUTE);
    await store().flushReading();
    expect(store().snapshot.cold).toBeNull();
    store().addSessionReading(12 * MINUTE);
    await store().stopSession({ reason: "completed", cleanSession: true });
    expect(store().wrapUp).toMatchObject({ cold: null, coldCured: true });

    // The next session the same day has nothing to cure.
    store().startSession({ startedAt: new Date().toISOString(), durationMinutes: 20 });
    store().addSessionReading(5 * MINUTE);
    await store().stopSession({ reason: "manual_end", cleanSession: false });
    expect(store().wrapUp).toMatchObject({ cold: null, coldCured: false });
  });

  it("says in the wrap-up how far the cure has come when the session did not finish it", async () => {
    const ill = { since: "2026-10-01", brokeFrom: 5, cure: 0.4, minutesLeftToday: 12, daysLeft: 2 };
    const answer = { ...EMPTY_SNAPSHOT, todayMinutes: 8, cold: ill };
    useHabitStore.setState({ snapshot: answer, wrapUp: null, pendingBreak: null });
    credit.mockResolvedValue(answer);
    vi.spyOn(habitService, "recordSession").mockResolvedValue(answer);
    store().startSession({ startedAt: new Date().toISOString(), durationMinutes: 20 });
    store().addSessionReading(8 * MINUTE);
    await store().stopSession({ reason: "manual_end", cleanSession: false });
    expect(store().wrapUp).toMatchObject({ cold: ill, coldCured: false });
  });

  it("takes the ledger's answer to a goal change, a break it found included", async () => {
    // Lowered to what has been read, today is met on the change itself.
    useHabitStore.setState({ pendingBreak: null });
    const answer = { ...EMPTY_SNAPSHOT, goalMinutes: 20, todayMinutes: 26, todayMet: true };
    const setGoal = vi.spyOn(habitService, "setGoal").mockResolvedValue({ ...answer, brokeFrom: 3 });
    const snapshot = vi.spyOn(habitService, "snapshot").mockResolvedValue(answer);
    await store().setGoalMinutes(20);
    expect(setGoal).toHaveBeenCalledWith(20);
    expect(setGoal.mock.invocationCallOrder[0]).toBeLessThan(snapshot.mock.invocationCallOrder[0]);
    expect(store().snapshot.todayMet).toBe(true);
    expect(store().pendingBreak).toEqual({ brokeFrom: 3 });
  });

  it("asks the ledger again once the day has changed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 2, 22, 0));
    const snapshot = vi
      .spyOn(habitService, "snapshot")
      .mockResolvedValue({ ...EMPTY_SNAPSHOT, todayMinutes: 25, todayMet: true });
    await store().load();
    await store().refreshForNewDay();
    expect(snapshot).toHaveBeenCalledTimes(1);

    // Left open overnight: 25 minutes and "goal met" were yesterday's.
    vi.setSystemTime(new Date(2026, 9, 3, 7, 0));
    snapshot.mockResolvedValue(EMPTY_SNAPSHOT);
    await store().refreshForNewDay();
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(store().snapshot.todayMet).toBe(false);
    await store().refreshForNewDay();
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("does not take a leftover it cannot read, or more than the ledger takes at once", async () => {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ dateKey: "yesterday", ms: 60_000 }));
    vi.resetModules();
    expect((await import("./habitStore")).useHabitStore.getState().pendingReading).toBeNull();

    localStorage.setItem(PENDING_KEY, JSON.stringify({ dateKey: "2026-10-02", ms: 9_000_000 }));
    vi.resetModules();
    expect((await import("./habitStore")).useHabitStore.getState().pendingReading).toEqual({
      dateKey: "2026-10-02",
      ms: 15 * MINUTE
    });
  });
});
