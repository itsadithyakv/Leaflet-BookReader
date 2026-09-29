import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flowerGrowing, sessionElapsedMs, useHabitStore, type ActiveSession } from "./habitStore";

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
