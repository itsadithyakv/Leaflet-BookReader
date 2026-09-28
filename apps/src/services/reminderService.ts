import { invoke, isTauri } from "@tauri-apps/api/core";

/** Mirrors `reminders::ReminderSettings`. Everything is off until the reader says yes. */
export type ReminderSettings = {
  daily: boolean;
  /** Minutes after local midnight. Rust keeps it between 07:00 and 22:59. */
  dailyAt: number;
  streakRisk: boolean;
  closeNudge: boolean;
  /** The opt-in question has been asked, so it never is again. */
  asked: boolean;
};

export type ReminderKind = "daily" | "streakRisk" | "close";

export type ReminderStatus = {
  settings: ReminderSettings;
  /** Reminders can be delivered here at all (Windows only). */
  supported: boolean;
  /** The Store (MSIX) build: reminders also arrive with Leaflet closed. */
  whileClosed: boolean;
  /** Windows has notifications for Leaflet turned off. */
  blocked: boolean;
};

export const DEFAULT_REMINDERS: ReminderSettings = {
  daily: false,
  dailyAt: 19 * 60,
  streakRisk: false,
  closeNudge: false,
  asked: false
};

const UNSUPPORTED: ReminderStatus = {
  settings: DEFAULT_REMINDERS,
  supported: false,
  whileClosed: false,
  blocked: false
};

/** "19:00" from 1140, for the time input. */
export const minutesToTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};

export const reminderService = {
  async status(): Promise<ReminderStatus> {
    if (!isTauri()) {
      return UNSUPPORTED;
    }
    return invoke<ReminderStatus>("reminders_get");
  },
  async save(settings: ReminderSettings): Promise<ReminderStatus> {
    if (!isTauri()) {
      return UNSUPPORTED;
    }
    return invoke<ReminderStatus>("reminders_set", { settings });
  },
  /** What the reader is doing: no reminder interrupts a session or an open book. */
  async context(sessionRunning: boolean, bookOpen: boolean, pipMode: string): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await invoke("reminders_context", { sessionRunning, bookOpen, pipMode });
  },
  /** The route a clicked reminder asked for ("continue" or "open"), once. */
  async takeActivation(): Promise<string | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<string | null>("reminders_take_activation");
  },
  async preview(kind: ReminderKind): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await invoke("reminders_preview", { kind });
  }
};
