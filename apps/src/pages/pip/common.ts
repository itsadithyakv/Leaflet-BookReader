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
 * bedroom's own twenty pieces (those of them this house has a floor for) and
 * the chosen others below; the rest of the catalogue waits for later.
 */
export const STARTER_DECOR = new Set(ROOM_ITEMS.map((item) => item.id));
/**
 * And, with them, the house's other pieces that a bedroom and a garden have
 * somewhere to put (pip/house.js: all but the three toys were drawn and
 * priced all along, at prices Rust already held): the ones that go on any
 * floor, and the garden's own. Named one by one, not worked out from
 * where each fits, so a piece added to the art later is not on sale until
 * someone says so here. What is left out: every other floor's pieces (the
 * kitchen's, the library's, the arcade's, the workshop's, the observatory's),
 * which this house has no floor for; each floor's starter piece, which comes
 * with its floor and is never sold; the book nods, which have a tab of their
 * own in the whole house; and the garden's Lily Pond, which lies on the lawn
 * where the plots' furrows are drawn across it.
 *
 * Only ever added to: a piece taken off this list would still be owned by
 * whoever bought it, but nobody else could finish a set it is part of (the
 * Greenhouse set can now be finished here, as it always could in the whole
 * house: pip/shop.js, `SETS`).
 */
export const MORE_DECOR: ReadonlySet<string> = new Set([
  // Hung from the ceiling.
  "paperlantern",
  "hangingbulb",
  "chandelier",
  "ceilingfan",
  "skylight",
  "hangingplant",
  // On the wall, and in it.
  "stringlights",
  "neonread",
  "wallsconce",
  "trophywall",
  "roundwindow",
  "archedwindow",
  "baywindow",
  // On a shelf, or the floor.
  "lavalamp",
  "candles",
  "fishbowl",
  "cattower",
  "piano",
  // The toys, drawn for this: a trampoline she bounces on, a music box, a bubble machine.
  "trampoline",
  "musicbox",
  "bubblemachine",
  // The garden's.
  "mushroomlamp",
  "tulips",
  "bonsai",
  "gnome",
  "sunflowers",
  "hammock"
]);
/** Whether the shop sells a piece of decor in a house without all its floors (book nods apart: they are never among these). */
export const onShelf = (itemId: string) => STARTER_DECOR.has(itemId) || MORE_DECOR.has(itemId);

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
