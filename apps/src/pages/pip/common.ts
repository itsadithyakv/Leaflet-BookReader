import { LIB, ROOM_ITEMS } from "../../pip";
import { PLANTS, catalogueItem, type ShopKind } from "../../pip/shop";

/**
 * What the Pip tab's parts share: a few rules of the page, Pip's stock
 * lines, and small helpers. The tab itself is PipPage.tsx; its hooks and
 * panels live beside this file.
 */

/**
 * Below this Pip mopes (a droopy leaf, a sigh). Nothing more: no nagging.
 * The mood's drift stops at 40 (habit/seeds.rs `MOOD_DRIFT_FLOOR`), so time
 * alone never brings her here: only a mood that was already this low.
 */
export const MOOD_LOW = 20;
/**
 * Without the full house (FEATURES.fullPipHouse), the shop's decor is the
 * bedroom's own twenty pieces; the rest of the catalogue waits for later.
 */
export const STARTER_DECOR = new Set(ROOM_ITEMS.map((item) => item.id));

export type Drawer = "things" | "garden" | "me" | "mood";
export type FinishPanel = "wallpaper" | "flooring";

export const THANKS = ["ooh. thank you!", "for me? you shouldn't have.", "i love it."];
export const PLACED = ["perfect.", "ooh, cosy.", "that goes there.", "home sweet home."];

export const moveName = (id: string) => LIB.find((move) => move.id === id)?.name ?? id;
export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
export const pickOne = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];
export const plantInfo = (id: string) => PLANTS.find((plant) => plant.id === id);
export const priceOf = (kind: ShopKind, id: string) => catalogueItem(kind, id)?.price ?? 0;
/** "a Cookie", "an Oak". */
export const aOrAn = (name: string) => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;

/** The mood in a word (pip/mood.ts, which also says why). */
export { moodWord } from "../../pip/mood";

export const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
