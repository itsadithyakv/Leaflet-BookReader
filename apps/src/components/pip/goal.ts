import type { ShopKind } from "../../pip/shop";

/**
 * The reader's goal: one thing in the shop pinned to the HUD, with how far the
 * seeds have come towards it. A preference of this device, like the floor the
 * reader was last on.
 */
export const GOAL_KEY = "leaflet.pip.goal";

export type PinnedGoal = {
  kind: ShopKind;
  id: string;
  /** Cheered for as affordable already: once, until it slips out of reach again. */
  cheered?: boolean;
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KINDS: readonly string[] = ["skin", "accessory", "room", "style", "treat", "move", "level", "wallpaper", "flooring", "plant", "plot"];

export const readGoal = (store: Store | null | undefined): PinnedGoal | null => {
  try {
    const value = JSON.parse(store?.getItem(GOAL_KEY) ?? "null") as Partial<PinnedGoal> | null;
    if (!value || typeof value.id !== "string" || typeof value.kind !== "string" || !KINDS.includes(value.kind)) return null;
    return { kind: value.kind, id: value.id, cheered: value.cheered === true };
  } catch {
    return null;
  }
};

export const writeGoal = (store: Store | null | undefined, goal: PinnedGoal | null) => {
  try {
    if (goal) store?.setItem(GOAL_KEY, JSON.stringify(goal));
    else store?.removeItem(GOAL_KEY);
  } catch {
    // Kept for this visit only.
  }
};

/** How far the seeds have come: never past the price, and never below nothing. */
export const goalProgress = (price: number, balance: number) => {
  const have = Math.max(0, Math.min(balance, price));
  return { have, price, fraction: price > 0 ? have / price : 1, short: Math.max(0, price - balance), ready: balance >= price };
};

export type GoalEvent = "affordable" | "reached" | null;

/**
 * What happens to the pinned goal now. Bought: it is done, and unpinned.
 * Newly within reach: a cheer, once. Out of reach again (spent elsewhere):
 * it can be cheered for again when it comes back. Otherwise nothing.
 */
export const stepGoal = (goal: PinnedGoal, { owned, ready }: { owned: boolean; ready: boolean }): { goal: PinnedGoal | null; event: GoalEvent } => {
  if (owned) return { goal: null, event: "reached" };
  if (ready && !goal.cheered) return { goal: { ...goal, cheered: true }, event: "affordable" };
  if (!ready && goal.cheered) return { goal: { ...goal, cheered: false }, event: null };
  return { goal, event: null };
};

/** A goal is something to save for: not owned, not a snack bought each time, not free. */
export const canBeGoal = (entry: { owned: boolean; consumable?: boolean; price: number }) => !entry.owned && !entry.consumable && entry.price > 0;
