import { create } from "zustand";
import {
  EMPTY_SNAPSHOT,
  getDateKey,
  habitService,
  type FocusSessionRecord,
  type HabitSnapshot
} from "../services/habitService";
import { usePipWardrobeStore } from "./pipWardrobeStore";

export { getDateKey };
export type { FocusSessionRecord };

/**
 * Focus settings are pure UI preference and stay local. Everything that earns a
 * streak — the day ledger, the shelf, freezes — now lives in SQLite next to the
 * books, so clearing site data can no longer wipe a reader's history.
 */
export type FocusSettings = {
  goalBinding: boolean;
  kioskMode: boolean;
  checkpointPrompts: boolean;
  sessionNotes: boolean;
};

/** The timer currently running. Ephemeral by nature; not a shelf entry yet. */
export type ActiveSession = {
  startedAt: string;
  durationMinutes: number;
  bookId?: string;
  title?: string;
  /**
   * Time spent in other apps, which the session clock does not count. Only
   * stints longer than AWAY_FREE_MS land here: glancing at a dictionary is
   * part of reading, twenty minutes of email is not.
   */
  awayMs?: number;
  /**
   * Seeds earned before the session began, so the wrap-up can say what this
   * session (and any goal it met on the way) earned. Absent when the ledger
   * had not loaded yet, or for a session saved by an older build.
   */
  seedsAtStart?: number;
  /** Garden water poured before the session began, for "+N water" at the end. */
  waterAtStart?: number;
};

/** A switch to another app shorter than this is free. */
export const AWAY_FREE_MS = 30_000;

/**
 * What a finished session changed, for the wrap-up screen. Taken from the
 * snapshots on either side of recording it, so "goal just met" and "new record"
 * are facts the ledger decided, not guesses from the timer.
 */
export type SessionWrapUp = {
  sessionId: string;
  minutes: number;
  reason: FocusSessionRecord["endedReason"];
  title: string | null;
  todayMinutes: number;
  goalMinutes: number;
  todayMet: boolean;
  goalJustMet: boolean;
  streak: number;
  newRecord: boolean;
  freezes: number;
  /** Seeds this session earned (goal and streak bonuses). */
  seeds: number;
  /** Water this session poured on Pip's garden. */
  water: number;
  /** Plants ripe to pick now, and how many of them this session ripened. */
  ripe: number;
  newlyRipe: number;
};

type HabitState = {
  snapshot: HabitSnapshot;
  loading: boolean;
  activeSession: ActiveSession | null;
  focusSettings: FocusSettings;
  /** Set when an evaluation detects a break, so the UI can show it once. */
  pendingBreak: { brokeFrom: number; burned: string[] } | null;
  /** The session that just ended, until the wrap-up screen is dismissed. */
  wrapUp: SessionWrapUp | null;
  /** When Leaflet lost the foreground during a session; null while in front. */
  awaySince: number | null;

  load: () => Promise<void>;
  creditMinutes: (minutes: number) => Promise<void>;
  setGoalMinutes: (minutes: number) => Promise<void>;
  setFocusSettings: (next: Partial<FocusSettings>) => void;
  startSession: (session: ActiveSession) => void;
  extendSession: (extraMinutes: number) => void;
  /** Leaflet lost (false) or regained (true) the foreground. Returns the stint length on return. */
  setForeground: (inFront: boolean) => number;
  /** Records the session on the shelf and returns its id for the notes prompt. */
  stopSession: (options?: {
    reason?: FocusSessionRecord["endedReason"];
    cleanSession?: boolean;
  }) => Promise<string | null>;
  addSessionNote: (id: string, notes: string) => Promise<void>;
  acknowledgeBreak: () => void;
  dismissWrapUp: () => void;
  resetAll: () => void;
};

/** Under a minute is a mis-tap on Start, not a session worth celebrating. */
const WRAP_UP_MIN_MINUTES = 1;

const SETTINGS_KEY = "leaflet.habit.settings";
const ACTIVE_KEY = "leaflet.habit.active";
const LEGACY_KEY = "leaflet.habit";
const LEGACY_DONE_KEY = "leaflet.habit.migrated";

const defaultFocusSettings: FocusSettings = {
  goalBinding: false,
  kioskMode: false,
  checkpointPrompts: true,
  sessionNotes: true
};

const readJson = <Value,>(key: string): Value | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Value) : null;
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Preferences are best-effort; reading must not depend on them.
  }
};

/**
 * Moves the old `leaflet.habit` blob into the database once.
 *
 * The legacy shape kept `daily` minutes separately from `sessions`, and the two
 * disagreed. Both are imported: the ledger takes the daily minutes (the more
 * complete record), and sessions become shelf entries.
 */
const migrateLegacy = async () => {
  if (localStorage.getItem(LEGACY_DONE_KEY)) {
    return null;
  }
  const legacy = readJson<{
    goal?: { mode?: string; target?: number };
    daily?: Record<string, { minutes?: number }>;
    sessions?: Array<{
      id?: string;
      startedAt?: string;
      endedAt?: string;
      durationMinutes?: number;
      bookId?: string;
      title?: string;
      endedReason?: string;
      cleanSession?: boolean;
    }>;
  }>(LEGACY_KEY);

  if (!legacy) {
    localStorage.setItem(LEGACY_DONE_KEY, "1");
    return null;
  }

  // Only a minutes goal survives: nothing in the app has ever counted pages or
  // chapters, so those modes are dropped rather than carried forward as fiction.
  const goalMinutes =
    legacy.goal?.mode === "minutes" && typeof legacy.goal.target === "number"
      ? legacy.goal.target
      : null;

  const days = Object.entries(legacy.daily ?? {}).map(([dateKey, record]) => ({
    dateKey,
    minutes: Math.max(0, Number(record?.minutes) || 0),
    goalMinutes: goalMinutes ?? 20,
    freezeUsed: false,
    graceUsed: false
  }));

  const sessions = (legacy.sessions ?? [])
    .filter((session) => session.id && session.startedAt && session.endedAt)
    .map((session) => ({
      id: session.id as string,
      startedAt: session.startedAt as string,
      endedAt: session.endedAt as string,
      dateKey: getDateKey(new Date(session.endedAt as string)),
      minutes: Math.max(0, Number(session.durationMinutes) || 0),
      bookId: session.bookId ?? null,
      title: session.title ?? null,
      endedReason: (session.endedReason === "completed"
        ? "completed"
        : "manual_end") as "completed" | "manual_end",
      clean: Boolean(session.cleanSession)
    }));

  const snapshot = await habitService.importLegacy({ goalMinutes, days, sessions });
  localStorage.setItem(LEGACY_DONE_KEY, "1");
  return snapshot;
};

export const useHabitStore = create<HabitState>((set, get) => ({
  snapshot: EMPTY_SNAPSHOT,
  loading: false,
  activeSession: readJson<ActiveSession>(ACTIVE_KEY),
  focusSettings: { ...defaultFocusSettings, ...(readJson<FocusSettings>(SETTINGS_KEY) ?? {}) },
  pendingBreak: null,
  wrapUp: null,
  awaySince: null,

  async load() {
    set({ loading: true });
    try {
      const migrated = await migrateLegacy();
      const snapshot = migrated ?? (await habitService.snapshot());
      set({ snapshot, loading: false });
      if (snapshot.brokeFrom !== null) {
        set({ pendingBreak: { brokeFrom: snapshot.brokeFrom, burned: snapshot.justBurned } });
      }
    } catch {
      set({ loading: false });
    }
  },

  async creditMinutes(minutes) {
    const snapshot = await habitService.creditMinutes(minutes).catch(() => null);
    if (snapshot) {
      set({ snapshot });
    }
  },

  async setGoalMinutes(minutes) {
    await habitService.setGoal(minutes).catch(() => undefined);
    await get().load();
  },

  setFocusSettings(next) {
    const focusSettings = { ...get().focusSettings, ...next };
    set({ focusSettings });
    writeJson(SETTINGS_KEY, focusSettings);
  },

  startSession(session) {
    const { snapshot } = get();
    const next =
      session.seedsAtStart === undefined && snapshot !== EMPTY_SNAPSHOT
        ? { ...session, seedsAtStart: snapshot.seedsEarned, waterAtStart: snapshot.gardenWater }
        : session;
    set({ activeSession: next });
    writeJson(ACTIVE_KEY, next);
  },

  setForeground(inFront) {
    const { activeSession, awaySince } = get();
    if (!inFront) {
      if (activeSession && awaySince === null) {
        set({ awaySince: Date.now() });
      }
      return 0;
    }
    if (awaySince === null) {
      return 0;
    }
    const stint = Date.now() - awaySince;
    set({ awaySince: null });
    if (activeSession && stint >= AWAY_FREE_MS) {
      const next = { ...activeSession, awayMs: (activeSession.awayMs ?? 0) + stint };
      set({ activeSession: next });
      writeJson(ACTIVE_KEY, next);
    }
    return stint;
  },

  extendSession(extraMinutes) {
    const active = get().activeSession;
    if (!active) {
      return;
    }
    const next = { ...active, durationMinutes: Math.max(1, active.durationMinutes + extraMinutes) };
    set({ activeSession: next });
    writeJson(ACTIVE_KEY, next);
  },

  async stopSession(options) {
    const active = get().activeSession;
    if (!active) {
      return null;
    }
    const before = get().snapshot;
    const endedAt = new Date();
    const minutes = sessionElapsedMs(active, endedAt.getTime(), get().awaySince) / 60000;
    const id = `session-${endedAt.getTime()}-${Math.round(Math.random() * 1000)}`;

    set({ activeSession: null, awaySince: null });
    try {
      localStorage.removeItem(ACTIVE_KEY);
    } catch {
      // ignore
    }

    const snapshot = await habitService
      .recordSession({
        id,
        startedAt: active.startedAt,
        endedAt: endedAt.toISOString(),
        dateKey: getDateKey(endedAt),
        minutes,
        bookId: active.bookId ?? null,
        title: active.title ?? null,
        endedReason: options?.reason ?? "manual_end",
        clean: options?.cleanSession ?? true
      })
      .catch(() => null);

    const after = snapshot ?? before;
    const wrapUp: SessionWrapUp | null =
      minutes >= WRAP_UP_MIN_MINUTES
        ? {
            sessionId: id,
            minutes,
            reason: options?.reason ?? "manual_end",
            title: active.title ?? null,
            todayMinutes: after.todayMinutes,
            goalMinutes: after.goalMinutes,
            todayMet: after.todayMet,
            goalJustMet: !before.todayMet && after.todayMet,
            streak: after.streak,
            newRecord: after.streak > 1 && after.streak > before.longestStreak,
            freezes: after.freezes,
            seeds: Math.max(0, after.seedsEarned - (active.seedsAtStart ?? before.seedsEarned)),
            water: Math.max(0, Math.round(after.gardenWater - (active.waterAtStart ?? before.gardenWater))),
            ripe: after.gardenRipe,
            newlyRipe: Math.max(0, after.gardenRipe - before.gardenRipe)
          }
        : null;
    // One update, so anything watching for "goal met" sees the wrap-up in the
    // same render and leaves the celebration to it.
    set({ ...(snapshot ? { snapshot } : {}), wrapUp });
    // The session changed the seed balance and cheered Pip up.
    void usePipWardrobeStore.getState().load();
    return id;
  },

  dismissWrapUp() {
    set({ wrapUp: null });
  },

  async addSessionNote(id, notes) {
    await habitService.addNote(id, notes).catch(() => undefined);
    await get().load();
  },

  acknowledgeBreak() {
    set({ pendingBreak: null });
  },

  resetAll() {
    try {
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(LEGACY_KEY);
      localStorage.removeItem(LEGACY_DONE_KEY);
    } catch {
      // ignore
    }
    set({
      snapshot: EMPTY_SNAPSHOT,
      activeSession: null,
      focusSettings: defaultFocusSettings,
      pendingBreak: null,
      wrapUp: null,
      awaySince: null
    });
    // The shop's tables were cleared with the rest: Pip starts over too.
    void usePipWardrobeStore.getState().load();
    try {
      localStorage.removeItem("leaflet.pip.seedsExplained");
    } catch {
      // ignore
    }
  }
}));

/**
 * Reading time on the session clock: wall-clock time since the start (so it
 * survives sleep and re-render) minus time spent in other apps, including a
 * long stint that is still going on.
 */
export const sessionElapsedMs = (
  session: ActiveSession,
  now = Date.now(),
  awaySince: number | null = useHabitStore.getState().awaySince
) => {
  const ongoing = awaySince !== null && now - awaySince >= AWAY_FREE_MS ? now - awaySince : 0;
  return Math.max(0, now - Date.parse(session.startedAt) - (session.awayMs ?? 0) - ongoing);
};

/** How far through its planned length the running session is, 0..1. */
export const getSessionProgress = (session?: ActiveSession | null) => {
  if (!session) {
    return 0;
  }
  const totalSeconds = session.durationMinutes * 60;
  if (totalSeconds <= 0) {
    return 0;
  }
  return Math.min(1, sessionElapsedMs(session) / 1000 / totalSeconds);
};

export const addDays = (value: Date, offset: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + offset);
  return next;
};

export const buildDateRange = (days: number) => {
  const today = new Date();
  return Array.from({ length: days }).map((_, index) =>
    getDateKey(addDays(today, -(days - 1 - index)))
  );
};

/** Days on the shelf, newest first, excluding books lost to a broken streak. */
export const shelfSessions = (snapshot: HabitSnapshot) =>
  snapshot.sessions.filter((session) => !session.burnedAt);
