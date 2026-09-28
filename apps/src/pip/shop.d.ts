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
};

export type Plant = { id: string; name: string; water: number; yield: number; price: number; blurb: string };

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
