import { invoke, isTauri } from "@tauri-apps/api/core";
import { android, onAndroid } from "../platform/android";
import type { Announcement } from "./adminService";

/**
 * Telling readers a newer Leaflet is out. The Microsoft Store updates most
 * installs by itself, but not all of them and not soon; so the owner says on
 * the server, from the admin panel, which version is newest (and a line about
 * it), and every app asks now and then and offers the update to a reader who
 * is behind. Asked for without an account: most readers have none.
 */

/**
 * The owner's announcements come in the same answer, when there are any
 * (`announcements.ts`); a server from before them never sends the field.
 */
export type UpdateNotice = { version: string | null; note: string | null; at: string | null; announcements?: Announcement[] };

/**
 * One answer shared for a few minutes: the update card and the announcements
 * both want it, a few seconds apart, and one request does for both.
 */
const SHARED_MS = 5 * 60_000;
let shared: { at: number; answer: Promise<UpdateNotice | null> } | null = null;

/** The parts of a version as numbers ("1.4.2" is [1, 4, 2]); null for anything else. */
export const versionParts = (version: string | null | undefined): number[] | null => {
  const match = /^\s*v?(\d{1,4}(?:\.\d{1,4}){0,3})\s*$/.exec(version ?? "");
  return match ? match[1].split(".").map(Number) : null;
};

/** Whether `latest` is a later version than `mine` (a missing part counts as 0: 1.4 is 1.4.0). Never, if either will not read. */
export const isNewer = (latest: string | null | undefined, mine: string | null | undefined): boolean => {
  const a = versionParts(latest);
  const b = versionParts(mine);
  if (!a || !b) return false;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
};

export const updateService = {
  /** What the server says is newest; null when it cannot be asked (the browser preview, no server, offline). */
  async notice(): Promise<UpdateNotice | null> {
    if (!isTauri()) return null;
    if (shared && Date.now() - shared.at < SHARED_MS) return shared.answer;
    const answer = invoke<UpdateNotice>("update_notice").catch(() => null);
    shared = { at: Date.now(), answer };
    const found = await answer;
    // A failure is not kept: the next ask tries again.
    if (!found) shared = null;
    return found;
  },

  /** For the owner's page and tests: the next ask goes to the server. */
  forgetNotice() {
    shared = null;
  },

  /** This app's own version, as packaged. */
  async mine(): Promise<string | null> {
    if (!isTauri()) return null;
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    } catch {
      return null;
    }
  },

  /** Leaflet's page in the store it came from (Google Play on Android, the Microsoft Store elsewhere), where an update is one press. */
  async openStore(): Promise<void> {
    if (onAndroid()) {
      await android.openStore();
      return;
    }
    if (isTauri()) await invoke("open_store_page");
  },

  /** The owner's: say which version is newest, with a line about it; no version takes the notice down. */
  async setNotice(version: string | null, note: string | null): Promise<UpdateNotice> {
    shared = null;
    return invoke<UpdateNotice>("discuss", { route: "admin_set_notice", args: { version, note } });
  }
};
