import type { EarnStatus, PipOverview } from "../../services/pipService";

/**
 * The things earned by reading (Rust's pip/earned.rs decides them): how far
 * along a locked one is, for its tile's hint, and which were earned since this
 * device last showed one, for Pip to show off once.
 */

type Store = Pick<Storage, "getItem" | "setItem">;

/** A thing's earned status, from the overview. */
export const earnedStatus = (overview: PipOverview | null, kind: string, id: string): EarnStatus | undefined =>
  overview?.earned?.find((status) => status.kind === kind && status.id === id);

/** "5/7 days": how far along a locked thing is; null when there is nothing to count (done, once-only, or not earnable yet). */
export const earnedProgress = (status: EarnStatus | undefined): string | null => {
  if (!status || status.done || !status.earnable || !status.unit || status.target <= 1) return null;
  const value = Math.max(0, Math.min(status.target, Math.floor(status.value)));
  return `${value.toLocaleString("en")}/${status.target.toLocaleString("en")} ${status.unit}`;
};

/** A locked tile's hint: what earns it, then how far along it is. */
export const earnedHint = (unlock: string | undefined, status: EarnStatus | undefined) =>
  [unlock, earnedProgress(status)].filter(Boolean).join(" ") || undefined;

const SEEN_KEY = "pip.earnedSeen";
const keyOf = (status: Pick<EarnStatus, "kind" | "id">) => `${status.kind}:${status.id}`;

/** The things this device has already shown off; null when storage is blocked (then nothing is news, so nothing nags). */
const seen = (store: Store | null | undefined): Set<string> | null => {
  try {
    if (!store) return null;
    const kept: unknown = JSON.parse(store.getItem(SEEN_KEY) ?? "[]");
    return new Set(Array.isArray(kept) ? kept.filter((entry): entry is string => typeof entry === "string") : []);
  } catch {
    return null;
  }
};

/** What was earned and not yet shown off on this device, in the order Rust lists them. */
export const newlyEarned = (earned: readonly EarnStatus[] | undefined, store: Store | null | undefined): EarnStatus[] => {
  const shown = seen(store);
  if (!shown || !earned) return [];
  return earned.filter((status) => status.done && !shown.has(keyOf(status)));
};

/** Remembers that these were shown off. */
export const markEarnedSeen = (statuses: readonly EarnStatus[], store: Store | null | undefined) => {
  const shown = seen(store);
  if (!shown || statuses.length === 0) return;
  statuses.forEach((status) => shown.add(keyOf(status)));
  try {
    store?.setItem(SEEN_KEY, JSON.stringify([...shown]));
  } catch {
    // Shown for this visit only.
  }
};
