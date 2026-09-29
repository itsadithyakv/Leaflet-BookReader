import { create } from "zustand";
import {
  EMPTY_SNAPSHOT,
  getDateKey,
  habitService,
  type FocusSessionRecord,
  type HabitSnapshot
} from "../services/habitService";
import type { FocusFlowerKind } from "../pip/focusFlower.js";
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

/**
 * Why a focus flower wilted: the session ended early, Leaflet was left for
 * another app (or asleep) past AWAY_FREE_MS, Leaflet was closed mid-session,
 * or full screen was turned off.
 */
export type FlowerWilt = "ended" | "away" | "closed" | "unlocked";

/** A session's focus flower (see `ActiveSession.flower`). */
export type FocusFlower = {
  kind: FocusFlowerKind;
  /** Why it wilted, once it has. A wilted flower stays wilted. */
  wilted?: FlowerWilt;
  /** How far the session had grown it when it wilted, 0..1: it is drawn as it was then. */
  at?: number;
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
   * part of reading, twenty minutes of email is not. Superseded by `readMs`;
   * kept for sessions saved by an older build.
   */
  awayMs?: number;
  /**
   * Reading time this session has counted: only time a book was open, the
   * window in front and in use (the reading heartbeat's rule, the same one the
   * daily ledger uses). The session clock is this, not time since Start, so a
   * session left running while Leaflet was closed, asleep or in the background
   * does not claim those hours.
   */
  readMs?: number;
  /**
   * Seeds earned before the session began, so the wrap-up can say what this
   * session (and any goal it met on the way) earned. Absent when the ledger
   * had not loaded yet, or for a session saved by an older build.
   */
  seedsAtStart?: number;
  /** Garden water poured before the session began, for "+N water" at the end. */
  waterAtStart?: number;
  /**
   * The focus flower, planted when a session starts in full screen. It grows
   * as the session is read and blooms when the session completes. Leaving
   * early wilts it (see FlowerWilt); the session itself still counts in full,
   * and nothing the reader already owns is ever harmed.
   */
  flower?: FocusFlower;
};

/** A switch to another app shorter than this is free. */
export const AWAY_FREE_MS = 30_000;

/** How often a running session with a flower notes that Leaflet is still running. */
export const ALIVE_EVERY_MS = 10_000;

const FLOWER_KINDS: FocusFlowerKind[] = ["tulip", "daisy", "sunflower", "rose"];

/** A flower still growing: planted, and not wilted. */
export const flowerGrowing = (session: ActiveSession | null | undefined) =>
  Boolean(session?.flower && !session.flower.wilted);

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
  /** The focus flower's fate, for a session started in full screen. */
  flower: (FocusFlower & { bloomed: boolean }) | null;
  /** Focus flowers bloomed so far, this one included. */
  blooms: number;
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
  /**
   * When the reading heartbeat last counted time for the session, while it is
   * reading; null when it is not (no book open, idle, or away). The session
   * clock adds the time since then, so it runs smoothly between beats.
   */
  readingAt: number | null;

  load: () => Promise<void>;
  creditMinutes: (minutes: number) => Promise<void>;
  setGoalMinutes: (minutes: number) => Promise<void>;
  setFocusSettings: (next: Partial<FocusSettings>) => void;
  startSession: (session: ActiveSession) => void;
  extendSession: (extraMinutes: number) => void;
  /** Leaflet lost (false) or regained (true) the foreground. Returns the stint length on return. */
  setForeground: (inFront: boolean) => number;
  /** The reading heartbeat counted `ms` of reading: it goes on the running session's clock. */
  addSessionReading: (ms: number) => void;
  /** Reading started (a book opened) or stopped (idle, away, closed): the session clock runs or holds. */
  setSessionReading: (reading: boolean) => void;
  /**
   * On launch: a flower left growing while Leaflet was closed wilts (unless
   * it was back within AWAY_FREE_MS), and a session left running on an
   * earlier day ends with what was read.
   */
  resumeSession: () => Promise<void>;
  /** Wilts the running session's flower. True when it was growing until now. */
  wiltFlower: (reason: FlowerWilt) => boolean;
  /**
   * Leaflet is running a session with a growing flower: noted every
   * ALIVE_EVERY_MS. A gap past AWAY_FREE_MS (the computer asleep) wilts it.
   */
  keepAlive: () => void;
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
/** When Leaflet last noted it was running a session with a growing flower. */
const ALIVE_KEY = "leaflet.habit.aliveAt";
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
  readingAt: null,

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
    // Full screen off mid-session: the flower it was growing wilts.
    if (get().focusSettings.kioskMode && !focusSettings.kioskMode) {
      get().wiltFlower("unlocked");
    }
    set({ focusSettings });
    writeJson(SETTINGS_KEY, focusSettings);
  },

  startSession(session) {
    const { snapshot, focusSettings } = get();
    // The clock starts at nothing read: it runs only while a book is read, so
    // the walk from Start to a book is not counted.
    let next: ActiveSession = { ...session, readMs: session.readMs ?? 0 };
    if (next.seedsAtStart === undefined && snapshot !== EMPTY_SNAPSHOT) {
      next = { ...next, seedsAtStart: snapshot.seedsEarned, waterAtStart: snapshot.gardenWater };
    }
    // Starting in full screen plants a flower. One started without it has
    // none, and turning full screen on later does not plant one: a bloom is
    // for a whole session in focus.
    if (focusSettings.kioskMode && !next.flower) {
      next = { ...next, flower: { kind: FLOWER_KINDS[Math.floor(Math.random() * FLOWER_KINDS.length)] } };
      writeJson(ALIVE_KEY, Date.now());
    }
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
      // Away past the free stint: a flower growing in full screen wilts.
      get().wiltFlower("away");
    }
    return stint;
  },

  addSessionReading(ms) {
    const active = get().activeSession;
    if (!active || ms <= 0) {
      return;
    }
    // A session from an older build has no reading count yet: it starts from
    // its old clock, capped at its length, so an upgrade cannot inflate it.
    const base = active.readMs ?? legacyElapsedMs(active);
    const next = { ...active, readMs: base + ms };
    set({ activeSession: next, readingAt: Date.now() });
    writeJson(ACTIVE_KEY, next);
  },

  setSessionReading(reading) {
    if (!get().activeSession) {
      return;
    }
    if (!reading) {
      if (get().readingAt !== null) {
        set({ readingAt: null });
      }
    } else if (get().readingAt === null) {
      set({ readingAt: Date.now() });
    }
  },

  async resumeSession() {
    const active = get().activeSession;
    if (!active) {
      return;
    }
    if (flowerGrowing(active)) {
      const aliveAt = readJson<number>(ALIVE_KEY);
      if (aliveAt === null || Date.now() - aliveAt > AWAY_FREE_MS) {
        get().wiltFlower("closed");
      }
    }
    const started = new Date(active.startedAt);
    if (Number.isNaN(started.getTime()) || getDateKey(started) === getDateKey(new Date())) {
      return;
    }
    await get().stopSession({ reason: "manual_end", cleanSession: false });
  },

  wiltFlower(reason) {
    const active = get().activeSession;
    if (!active?.flower || active.flower.wilted) {
      return false;
    }
    const next = { ...active, flower: { ...active.flower, wilted: reason, at: getSessionProgress(active) } };
    set({ activeSession: next });
    writeJson(ACTIVE_KEY, next);
    return true;
  },

  keepAlive() {
    if (!flowerGrowing(get().activeSession)) {
      return;
    }
    const now = Date.now();
    const last = readJson<number>(ALIVE_KEY);
    // The note is due every ALIVE_EVERY_MS; missing it by AWAY_FREE_MS means
    // Leaflet was not running (asleep, suspended) for that long.
    if (last !== null && now - last > ALIVE_EVERY_MS + AWAY_FREE_MS) {
      get().wiltFlower("away");
      return;
    }
    writeJson(ALIVE_KEY, now);
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
    // What was read, and never more than the session's own length.
    const minutes = Math.min(active.durationMinutes, sessionElapsedMs(active, endedAt.getTime(), get().readingAt) / 60000);
    const id = `session-${endedAt.getTime()}-${Math.round(Math.random() * 1000)}`;
    const reason = options?.reason ?? "manual_end";
    // The flower blooms when the session ran its course with it growing;
    // ending early wilts it, and one that wilted on the way stays wilted.
    const flower: FocusFlower | null = active.flower
      ? active.flower.wilted || reason === "completed"
        ? active.flower
        : { ...active.flower, wilted: "ended", at: Math.min(1, minutes / Math.max(1, active.durationMinutes)) }
      : null;
    const bloomed = Boolean(flower && !flower.wilted);

    set({ activeSession: null, awaySince: null, readingAt: null });
    try {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(ALIVE_KEY);
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
        endedReason: reason,
        clean: options?.cleanSession ?? true,
        flower: flower?.kind ?? null,
        flowerBloomed: bloomed
      })
      .catch(() => null);

    const after = snapshot ?? before;
    const wrapUp: SessionWrapUp | null =
      minutes >= WRAP_UP_MIN_MINUTES
        ? {
            sessionId: id,
            minutes,
            reason,
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
            newlyRipe: Math.max(0, after.gardenRipe - before.gardenRipe),
            flower: flower ? { ...flower, bloomed } : null,
            // Counted from the shelf when the ledger recorded this session;
            // without it (a browser build) this bloom is added by hand.
            blooms:
              countBlooms(after) + (bloomed && !after.sessions.some((session) => session.id === id) ? 1 : 0)
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
      localStorage.removeItem(ALIVE_KEY);
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
      awaySince: null,
      readingAt: null
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

/** Longest stretch the clock runs ahead of the heartbeat (one beat), so a stall cannot run it on. */
const LIVE_MAX_MS = 15_000;

/**
 * The old clock, for a session saved by an older build: time since the start
 * minus time away, capped at the session's length. It counted hours with
 * Leaflet closed, which is why it is no longer the clock.
 */
function legacyElapsedMs(session: ActiveSession) {
  return Math.min(session.durationMinutes * 60_000, Math.max(0, Date.now() - Date.parse(session.startedAt) - (session.awayMs ?? 0)));
}

/**
 * Reading time on the session clock: what the reading heartbeat has counted,
 * plus the moments since its last beat while reading is going on. Time with
 * no book open, idle, away, asleep or with Leaflet closed does not count.
 */
export const sessionElapsedMs = (
  session: ActiveSession,
  now = Date.now(),
  readingAt: number | null = useHabitStore.getState().readingAt
) => {
  const counted = session.readMs ?? legacyElapsedMs(session);
  const live = readingAt !== null ? Math.min(LIVE_MAX_MS, Math.max(0, now - readingAt)) : 0;
  return counted + live;
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

/**
 * Focus flowers bloomed, ever. A bloom stays counted even if a broken streak
 * later scorches its book: the flower was grown.
 */
export const countBlooms = (snapshot: HabitSnapshot) =>
  snapshot.sessions.filter((session) => session.flower && session.flowerBloomed).length;
