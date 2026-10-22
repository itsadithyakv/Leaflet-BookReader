/**
 * When a sync runs besides at launch and after a change settles
 * (docs/two-devices.md): as the app goes out of sight, as it comes back, and
 * before a book is opened.
 *
 * A phone stops an app in the background without warning, so what was read in
 * the last half hour has to leave before then; and a reader who has been on
 * another device wants its place here when they come back. Each is held to a
 * minimum gap, since a window is minimised and restored far more often than a
 * library changes.
 */
import type { SyncStatus } from "@shared/sync/types";
import { useLibraryStore } from "../store/libraryStore";
import { pushHold } from "./pushHold";

/** Going out of sight: not if a sync ran this recently (reading since then is seconds). */
export const SYNC_ON_LEAVING_AFTER_MS = 30_000;
/** Coming back: not if a sync ran this recently (the other device has had no time to write). */
export const SYNC_ON_RETURN_AFTER_MS = 120_000;
/** Opening a book: a pull first, unless one ran this recently. */
export const PULL_BEFORE_OPEN_AFTER_MS = 60_000;
/** How long opening a book waits for that pull (no signal on a train must not keep the book shut). */
export const PULL_BEFORE_OPEN_WAIT_MS = 5_000;

export type SyncMoment = "hidden" | "visible" | "open";

const GAP: Record<SyncMoment, number> = {
  hidden: SYNC_ON_LEAVING_AFTER_MS,
  visible: SYNC_ON_RETURN_AFTER_MS,
  open: PULL_BEFORE_OPEN_AFTER_MS
};

/**
 * Whether to sync now. `sinceLastMs` is how long ago a sync was last started
 * (null: not since launch); `configured` is whether there is anywhere to sync to;
 * `waiting`, whether highlights or notes made in an open book are waiting to go
 * up (services/pushHold): going out of sight never keeps them waiting.
 */
export const syncDue = (moment: SyncMoment, sinceLastMs: number | null, configured: boolean, waiting = false): boolean => {
  if (!configured) {
    return false;
  }
  if (sinceLastMs === null || (moment === "hidden" && waiting)) {
    return true;
  }
  return sinceLastMs >= GAP[moment];
};

/** When a sync was last started, whatever asked for it (null: not since launch). */
let lastStartedAt: number | null = null;
let watching = false;

/**
 * Whether there is anywhere to sync to. Never while this library belongs to
 * another Leaflet account than the one signed in: sync is paused for it, and
 * a run would only say so.
 */
export const syncConfigured = (sync: SyncStatus): boolean => {
  if (sync.library?.standing === "other") return false;
  return sync.driveConnected || Boolean(sync.folderPath) || Boolean(sync.accountBackup);
};

const configured = () => syncConfigured(useLibraryStore.getState().sync);

/** Notes every sync's start, whoever asked for it. */
const watchStarts = () => {
  if (watching) return;
  watching = true;
  useLibraryStore.subscribe((state, previous) => {
    if (state.syncStatus === "syncing" && previous.syncStatus !== "syncing") {
      lastStartedAt = Date.now();
    }
  });
};

/** Runs a sync for this moment if one is due; resolves when it ends (failures are kept in `syncError`). */
export const syncFor = async (moment: SyncMoment, now = Date.now()): Promise<void> => {
  watchStarts();
  const { syncStatus, syncNow } = useLibraryStore.getState();
  if (syncStatus === "syncing") {
    await untilSettled();
    // Going out of sight with highlights still waiting (made after the run
    // under way had read the library): they go now, not at the next launch.
    if (moment === "hidden" && pushHold.waiting()) {
      await useLibraryStore.getState().syncNow().catch(() => {});
    }
    return;
  }
  if (!syncDue(moment, lastStartedAt === null ? null : now - lastStartedAt, configured(), pushHold.waiting())) {
    return;
  }
  // Started at once, not after a timer: on the way to the background the
  // page may be paused before a timer fires. The work itself is in Rust and
  // runs on whatever the page does.
  await syncNow().catch(() => {
    // Recorded in `syncError`, as a background sync's failure is.
  });
};

/** Resolves when the sync under way ends. */
const untilSettled = () =>
  new Promise<void>((resolve) => {
    const stop = useLibraryStore.subscribe((state) => {
      if (state.syncStatus !== "syncing") {
        stop();
        resolve();
      }
    });
  });

/** A pull before a book opens, waited for at most a few seconds. */
export const pullBeforeOpen = (wait = PULL_BEFORE_OPEN_WAIT_MS): Promise<void> =>
  Promise.race([syncFor("open"), new Promise<void>((resolve) => setTimeout(resolve, wait))]);

/**
 * Syncs as the app goes out of sight (the phone may stop it any time after)
 * and pulls as it comes back. Call once, from the app's root; answers the
 * function that stops it.
 */
export const watchSyncMoments = (): (() => void) => {
  watchStarts();
  const onVisibility = () => void syncFor(document.visibilityState === "hidden" ? "hidden" : "visible");
  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
};
