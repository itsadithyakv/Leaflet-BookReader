/**
 * The reader's choice about Pip on the desktop, kept by the webview on this
 * device only: it is about this computer's desktop, so it is not synced, and
 * "Delete All Data" removes it (`services/deviceData.ts` lists the same two
 * keys).
 *
 * Both of Leaflet's windows share this storage, which is how "Hide for today"
 * chosen from her own menu is still known after a restart: her page writes
 * the day, and the main window reports it to Rust at the next launch.
 */
import type { PipMode } from "../store/pipStore";

/** "1" when the switch in Settings is on; absent (off) until the reader turns it on. */
export const ENABLED_KEY = "leaflet.desktopPip.enabled";
/** The local day ("2026-03-03") she was hidden for from her menu. */
export const HIDDEN_KEY = "leaflet.desktopPip.hiddenOn";
export const DESKTOP_PIP_KEYS = [ENABLED_KEY, HIDDEN_KEY] as const;

export type DesktopPipChoice = { enabled: boolean; hiddenOn: string | null };

/** What Rust is told (`desktop_pip::Wanted`). */
export type Wanted = { enabled: boolean; hiddenOn: string | null; pipOff: boolean; quiet: boolean };

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The reader's local day, as Rust writes it (`%Y-%m-%d`). */
export const dayKey = (date: Date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const storage = (): Store | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

export const readChoice = (store: Store | null = storage()): DesktopPipChoice => {
  try {
    const hidden = store?.getItem(HIDDEN_KEY) ?? null;
    return { enabled: store?.getItem(ENABLED_KEY) === "1", hiddenOn: hidden !== null && DAY.test(hidden) ? hidden : null };
  } catch {
    return { enabled: false, hiddenOn: null };
  }
};

export const writeEnabled = (on: boolean, store: Store | null = storage()) => {
  try {
    if (on) {
      store?.setItem(ENABLED_KEY, "1");
    } else {
      store?.removeItem(ENABLED_KEY);
    }
  } catch {
    // The choice still applies until Leaflet closes.
  }
};

export const writeHiddenOn = (day: string | null, store: Store | null = storage()) => {
  try {
    if (day) {
      store?.setItem(HIDDEN_KEY, day);
    } else {
      store?.removeItem(HIDDEN_KEY);
    }
  } catch {
    // Only means she is back at the next launch rather than tomorrow.
  }
};

/**
 * What to tell Rust: the choice, with Pip's mode. With Pip off she is off out
 * there too; quiet Pip stands about but does not stroll. A day that is over
 * is not passed on (and Rust would ignore it: it is not today).
 */
export const wantedFrom = (choice: DesktopPipChoice, mode: PipMode, today: string = dayKey()): Wanted => ({
  enabled: choice.enabled,
  hiddenOn: choice.hiddenOn === today ? today : null,
  pipOff: mode === "off",
  quiet: mode === "quiet"
});
