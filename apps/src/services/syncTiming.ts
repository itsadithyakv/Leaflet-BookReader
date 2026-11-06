/**
 * When a sync runs besides at launch and after a change settles
 * (docs/two-devices.md): as the app goes out of sight, and as it comes back.
 *
 * A phone stops an app in the background without warning, so what was read in
 * the last half hour has to leave before then; and a reader who has been on
 * another device wants its place here when they come back. Both are held to a
 * minimum gap, since a window is minimised and restored far more often than a
 * library changes.
 */

/** Going out of sight: not if a sync ran this recently (reading since then is seconds). */
export const SYNC_ON_LEAVING_AFTER_MS = 30_000;
/** Coming back: not if a sync ran this recently (the other device has had no time to write). */
export const SYNC_ON_RETURN_AFTER_MS = 120_000;

/**
 * Whether to sync now. `sinceLastMs` is how long ago a sync was last started
 * (null: not since launch); `configured` is whether there is anywhere to sync to.
 */
export const syncDue = (change: "hidden" | "visible", sinceLastMs: number | null, configured: boolean): boolean => {
  if (!configured) {
    return false;
  }
  if (sinceLastMs === null) {
    return true;
  }
  return sinceLastMs >= (change === "hidden" ? SYNC_ON_LEAVING_AFTER_MS : SYNC_ON_RETURN_AFTER_MS);
};
