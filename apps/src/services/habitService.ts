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
  /** Credits reading time to today and returns the re-evaluated snapshot. */
  async creditMinutes(minutes: number): Promise<HabitSnapshot | null> {
    if (!isTauri() || minutes <= 0) {
      return null;
    }
    return invoke<HabitSnapshot>("credit_reading_minutes", {
      dateKey: getDateKey(),
      minutes
    });
  },
  async setGoal(minutes: number): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await invoke("set_habit_goal", { minutes });
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
