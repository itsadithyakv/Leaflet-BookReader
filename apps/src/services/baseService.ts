import { invoke, isTauri } from "@tauri-apps/api/core";
import { readBase, type BaseState } from "../pip/base/rules";

/**
 * Where the Hollow (the arcade's building game, `pip/base/rules.ts`) is kept:
 * one settings row, which Rust also carries in the backup (the newest camp
 * wins, as for Pip's look) and sums up for a shared profile. The rules are
 * the app's: Rust keeps what it is handed, after checking it is a small JSON
 * object.
 *
 * The browser preview keeps it in the browser, so the game can be tried there.
 */

const PREVIEW_KEY = "leaflet.pip.base";

export const baseService = {
  /** The kept camp, or null before the first (or when what is kept is not one). */
  async load(): Promise<BaseState | null> {
    try {
      const kept = isTauri() ? await invoke<string | null>("pip_base_load") : localStorage.getItem(PREVIEW_KEY);
      return kept ? readBase(JSON.parse(kept)) : null;
    } catch {
      return null;
    }
  },

  async save(base: BaseState): Promise<void> {
    const kept = JSON.stringify(base);
    if (isTauri()) {
      await invoke("pip_base_save", { base: kept });
      return;
    }
    try {
      localStorage.setItem(PREVIEW_KEY, kept);
    } catch {
      // Kept until the page is closed.
    }
  }
};
