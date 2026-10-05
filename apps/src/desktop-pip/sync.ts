/**
 * Pip on the desktop, as the main window sees her: the switch in Settings,
 * and keeping Rust told of the reader's choice.
 *
 * Rust (src-tauri/src/desktop_pip) makes and moves her window but stores
 * nothing; the choice is the webview's (setting.ts). So the main window
 * reports it: once at launch, when the switch or Pip's mode changes, and when
 * her own menu changes it from the other window ("Hide for today" arrives
 * here as a storage event).
 */
import { useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { usePipStore, type PipMode } from "../store/pipStore";
import { FEATURES } from "../constants/features";
import { DESKTOP_PIP_KEYS, readChoice, wantedFrom, writeEnabled, writeHiddenOn, type Wanted } from "./setting";

/** Mirrors `desktop_pip::runtime::DesktopPipStatus`. */
export type DesktopPipStatus = {
  /** She can live on this desktop at all (Windows only). */
  supported: boolean;
  enabled: boolean;
  /** She is out there now. */
  out: boolean;
  hiddenToday: boolean;
  sentHome: boolean;
};

export const UNSUPPORTED: DesktopPipStatus = { supported: false, enabled: false, out: false, hiddenToday: false, sentHome: false };

/** How Rust is reached; replaced in the tests. */
export type Reach = {
  available: () => boolean;
  set: (wanted: Wanted, recall: boolean) => Promise<DesktopPipStatus>;
  status: () => Promise<DesktopPipStatus>;
};

// Her window has never been run on a real desktop, so a build has to ask for
// her (`VITE_ENABLE_DESKTOP_PIP`). Without the flag Rust is never told to make
// the window and the switch in Settings is not shown.
const tauriReach: Reach = {
  available: () => FEATURES.desktopPip && isTauri(),
  set: (wanted, recall) => invoke<DesktopPipStatus>("desktop_pip_set", { wanted, recall }),
  status: () => invoke<DesktopPipStatus>("desktop_pip_status")
};

/** The line under the switch: what it does, or why she is not out there. */
export const settingLine = (status: DesktopPipStatus, mode: PipMode) => {
  if (status.enabled && mode === "off") {
    return "Pip is off, so she stays in. Choose Chatty or Quiet above to let her out.";
  }
  if (status.enabled && status.sentHome) {
    return "She's home until you next open Leaflet.";
  }
  if (status.enabled && status.hiddenToday) {
    return "She's hidden for today, and back tomorrow.";
  }
  return "She walks along your taskbar while Leaflet is open, and holds up a sign at your reminder time.";
};

/** Whether "Call Her Back" is offered: she is switched on but was sent away from her own menu. */
export const canRecall = (status: DesktopPipStatus, mode: PipMode) =>
  status.enabled && mode !== "off" && (status.sentHome || status.hiddenToday);

export const createDesktopPip = (reach: Reach, mode: () => PipMode) => {
  let status = UNSUPPORTED;
  const listeners = new Set<() => void>();
  const publish = (next: DesktopPipStatus) => {
    status = next;
    listeners.forEach((listener) => listener());
  };

  /** Tells Rust the choice as it stands. `recall` also brings her back from home. */
  const report = async (recall = false) => {
    if (!reach.available()) {
      return;
    }
    try {
      publish(await reach.set(wantedFrom(readChoice(), mode()), recall));
    } catch {
      // An older or failing backend: the switch is simply not offered.
      publish(UNSUPPORTED);
    }
  };

  return {
    get: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    report,
    /** The switch. Switching on always brings her out, whatever her menu said earlier. */
    async setEnabled(on: boolean) {
      writeEnabled(on);
      if (on) {
        writeHiddenOn(null);
      }
      // The switch moves at once; Rust's answer follows.
      publish({ ...status, enabled: on });
      await report(on);
    },
    /** Back from "home" or "hidden for today". */
    async recall() {
      writeHiddenOn(null);
      await report(true);
    },
    /** What Rust says now, for when Settings opens (her menu may have sent her home since). */
    async refresh() {
      if (!reach.available()) {
        return;
      }
      try {
        publish(await reach.status());
      } catch {
        publish(UNSUPPORTED);
      }
    }
  };
};

export const desktopPip = createDesktopPip(tauriReach, () => usePipStore.getState().mode);

export const useDesktopPip = () => useSyncExternalStore(desktopPip.subscribe, desktopPip.get);

let started = false;

/**
 * Called once as the main window starts (main.tsx). Outside Tauri it does
 * nothing, and nothing on the page shows the switch.
 */
export const startDesktopPip = () => {
  if (started || !isTauri()) {
    return;
  }
  started = true;
  void desktopPip.report();
  usePipStore.subscribe((state, before) => {
    if (state.mode !== before.mode) {
      void desktopPip.report();
    }
  });
  // Her own window shares this storage: "Hide for today" from her menu.
  window.addEventListener("storage", (event) => {
    if (event.key === null || (DESKTOP_PIP_KEYS as readonly string[]).includes(event.key)) {
      void desktopPip.refresh();
    }
  });
};
