/** Typed boundary for shop.js (plain JS so the catalogue generator can run it under Node). */
import type { PipAccessory, PipRoomItem, PipRoomStyle, PipSkin, PipTreat } from "./index";

export type ShopKind = "skin" | "accessory" | "room" | "style" | "treat" | "move" | "level" | "wallpaper" | "flooring" | "plant" | "plot";

export type ShopItem = {
  kind: ShopKind;
  id: string;
  name: string;
  /** In seeds; 0 means owned from the start (achievement skins aside). */
  price: number;
  earnedOnly?: boolean;
  slot?: PipAccessory["slot"];
  roomKind?: PipRoomItem["kind"];
  /** Food: bought each time it is given. */
  consumable?: boolean;
  mood?: number;
  move?: string;
  /** Owned first: the floor below, the plot before. */
  requires?: string;
  /** Focus sessions done first. */
  sessions?: number;
  /** A plant: minutes of focus to ripen, and the seeds it gives. */
  water?: number;
  yield?: number;
  /** The book a house item nods to. */
  nod?: string;
  /** A room item that lights a room (a lamp, fairy lights, a lantern). */
  light?: boolean;
  /** A floor's starter piece: Pip's once that floor (a level id) is, never sold on its own. */
  freeWith?: string;
};

export type Plant = { id: string; name: string; water: number; yield: number; price: number; blurb: string };

/** One of a new reader's first steps. `id` is Rust's (pip/rewards.rs). */
export type GoalDef = { id: string; name: string; hint: string; seeds: number };
/** A set: own every piece for `seeds`. `level` marks a floor's decor set. */
export type SetDef = { id: string; name: string; kind: ShopKind; items: string[]; seeds: number; level?: string };
/** One era of Pip's wishes: the lists a day's wish is chosen from, from `since` on. */
export type WishEra = { since: string; treat: string[]; plant: string[]; room: string[]; move: string[] };

export declare const FIRST_VARIANT: { id: string; price: number };
export declare const STARTER_PIECES: Record<string, string[]>;
export declare function comesWith(itemId: string, floors?: Set<string>): string | null;
export declare const STARTER_CHEST: { seeds: number; minutes: number };
export declare const GOALS: GoalDef[];
export declare const SETS: SetDef[];
export declare const WISH: { seeds: number; mood: number; eras: WishEra[] };

export declare const PREMIUM_MOVES: { id: string; price: number }[];
export declare const FREE_SIGNATURES: string[];
export declare const DEFAULT_SIGNATURE: string;
export declare const DEFAULT_VARIANT: string;
export declare const PACING: { perWeek: number };
export declare const PLANTS: Plant[];
export declare const EXTRA_PLOTS: Array<{ id: string; name: string; price: number }>;
export declare const FREE_PLOTS: number;
export declare function accessoryPrice(item: PipAccessory): number;
export declare function itemPrice(item: PipRoomItem): number;
export declare function treatPrice(treat: PipTreat): number;
export declare function nodMatches(nod: unknown, book: { title?: string | null; author?: string | null } | null | undefined): boolean;
export declare function catalogueItem(kind: ShopKind, id: string): ShopItem | null;
export declare function isEarnedOnly(skin: PipSkin): boolean;
export declare function skinPrice(skin: PipSkin): number;
export declare function accessories(): PipAccessory[];
export declare function slotCovered(skin: PipSkin | undefined, slot: PipAccessory["slot"]): boolean;
export declare function visibleOutfit(skinId: string, outfit: readonly string[]): string[];
export declare function roomItems(): PipRoomItem[];
export declare function treats(): PipTreat[];
export declare function roomStyles(): PipRoomStyle[];
export declare function catalogue(): ShopItem[];
