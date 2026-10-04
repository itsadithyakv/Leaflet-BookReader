import { invoke, isTauri } from "@tauri-apps/api/core";

/** One local calendar day in the ledger. */
export type DayRecord = {
  dateKey: string;
  minutes: number;
  goalMinutes: number;
  freezeUsed: boolean;
  graceUsed: boolean;
};

/** One entry on the shelf. `burnedAt` marks a book lost to a broken streak. */
export type FocusSessionRecord = {
  id: string;
  startedAt: string;
  endedAt: string;
  dateKey: string;
  minutes: number;
  bookId: string | null;
  title: string | null;
  notes: string | null;
  endedReason: "completed" | "manual_end";
  clean: boolean;
  styleSeed: string;
  burnedAt: string | null;
  /** The focus flower the session grew (a full-screen session), if any. */
  flower?: string | null;
  /** Whether that flower bloomed: the session completed without leaving. */
  flowerBloomed?: boolean;
};

/**
 * A day's reading outside any focus session. Worked out from the ledger and
 * the shelf (the day's minutes, less its sessions'), never stored.
 */
export type FreeReadRecord = {
  dateKey: string;
  minutes: number;
};

export type HabitSnapshot = {
  streak: number;
  longestStreak: number;
  freezes: number;
  graceAvailable: boolean;
  goalMinutes: number;
  todayMinutes: number;
  todayMet: boolean;
  days: DayRecord[];
  sessions: FocusSessionRecord[];
  /** Each day's reading with no focus session running, oldest first. */
  freeReads: FreeReadRecord[];
  shelfCount: number;
  peakShelf: number;
  /** Set on the one evaluation that detects a break. */
  brokeFrom: number | null;
  /** Ids burned by that evaluation, for the UI to animate. Empty afterwards. */
  justBurned: string[];
  /** Every seed ever earned (Pip's currency; see habit/seeds.rs). The balance is on the Pip tab. */
  seedsEarned: number;
  /** All the water reading has poured on Pip's garden, and the plants ripe to pick. */
  gardenWater: number;
  gardenRipe: number;
};

export type FocusSessionInput = {
  id: string;
  startedAt: string;
  endedAt: string;
  dateKey: string;
  minutes: number;
  bookId?: string | null;
  title?: string | null;
  endedReason: "completed" | "manual_end";
  clean: boolean;
  flower?: string | null;
  flowerBloomed?: boolean;
};

export const EMPTY_SNAPSHOT: HabitSnapshot = {
  streak: 0,
  longestStreak: 0,
  freezes: 0,
  graceAvailable: true,
  goalMinutes: 20,
  todayMinutes: 0,
  todayMet: false,
  days: [],
  sessions: [],
  freeReads: [],
  shelfCount: 0,
  peakShelf: 0,
  brokeFrom: null,
  justBurned: [],
  seedsEarned: 0,
  gardenWater: 0,
  gardenRipe: 0
};

/**
 * The local calendar day. Every habit command is anchored to this rather than
 * to the backend's clock, so the day never rolls over at the wrong hour for
 * readers outside UTC.
 */
export const getDateKey = (value: Date = new Date()) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const habitService = {
  async snapshot(): Promise<HabitSnapshot> {
    if (!isTauri()) {
      return EMPTY_SNAPSHOT;
    }
    return invoke<HabitSnapshot>("habit_snapshot", { todayKey: getDateKey() });
  },
  /**
   * Credits reading time to the day it was read and returns the snapshot,
   * re-evaluated as of today. The day is today, except for time left over
   * from a read that Leaflet was closed in the middle of.
   */
  async creditMinutes(minutes: number, dateKey: string = getDateKey()): Promise<HabitSnapshot | null> {
    if (!isTauri() || minutes <= 0) {
      return null;
    }
    return invoke<HabitSnapshot>("credit_reading_minutes", {
      dateKey,
      minutes,
      todayKey: getDateKey()
    });
  },
  /**
   * Saves the daily goal. It applies to today at once unless today has met
   * the goal it had (lowered to what has been read, today is met now), and
   * the snapshot returned is today's, evaluated after the change.
   */
  async setGoal(minutes: number): Promise<HabitSnapshot | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<HabitSnapshot | null>("set_habit_goal", { minutes, todayKey: getDateKey() });
  },
  async recordSession(session: FocusSessionInput): Promise<HabitSnapshot | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<HabitSnapshot>("record_focus_session", { session });
  },
  async addNote(id: string, notes: string): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await invoke("add_focus_note", { id, notes });
  },
  async importLegacy(payload: {
    goalMinutes: number | null;
    days: DayRecord[];
    sessions: FocusSessionInput[];
  }): Promise<HabitSnapshot | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<HabitSnapshot>("import_legacy_habit", {
      payload,
      todayKey: getDateKey()
    });
  }
};
