/**
 * The reader's orders in a planned raid (the raids plan, 2026-10-24). A
 * raid's fight goes on by itself, as it always has; an order is one tap
 * that turns it, never a timing test:
 *
 * - **rally**: a group turns from its approach to a chosen target;
 * - **release**: the group held back goes in (a held group that is never
 *   released goes in by itself at `HELD_LATEST`, so a scout is never left
 *   standing about);
 * - **the hero's move**: the hero's one big act (`heroes.ts` `HERO_MOVES`).
 *
 * An order is data: the tick it was given at, and what it was. The battle
 * takes them as it steps (`Battle.order` for one given now, `Setup.orders`
 * for a raid played again), so a plan and its orders play out the same
 * every time, and a raid can be watched again exactly as it went.
 */

export type Order =
  /** `target` is a structure's id. */
  | { tick: number; kind: "rally"; group: number; target: number }
  | { tick: number; kind: "release" }
  /** `target`, for a move that is aimed (the leaper's vault), is a structure's id. */
  | { tick: number; kind: "hero"; target?: number };
export type OrderKind = Order["kind"];
/** An order as the reader gives it: the battle stamps the tick. */
export type OrderGiven = Order extends infer O ? (O extends { tick: number } ? Omit<O, "tick"> : never) : never;

/** Orders a raid has, by the hut's level: three to begin with, five at the top. */
const ORDERS_AT = [0, 3, 3, 4, 4, 5];
export const ordersAt = (hutLevel: number) => ORDERS_AT[Math.max(0, Math.min(ORDERS_AT.length - 1, Math.floor(hutLevel)))];

/** Seconds into a raid at which a group held back goes in, if it has not been sent. */
export const HELD_LATEST = 20;
