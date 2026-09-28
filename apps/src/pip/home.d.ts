/** Typed boundary for home.js: Pip's house, normalised from whatever house art has landed. */
import type { PipRoomItem } from "./index";

export type SlotFits = "ceiling" | "wall" | "window" | "top" | "stand" | "rug";

export type HouseSlot = {
  id: string;
  fits: SlotFits;
  name: string | null;
  /** The slot's box in the floor's pixels, top-left (from the art's anchor). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** In the single-room fallback, each spot takes one particular item. */
  only: string | null;
};

export type HouseLevel = {
  id: string;
  name: string;
  blurb: string | null;
  price: number;
  /** Unlocked by reading, not bought; `unlock` says how. */
  earnedOnly: boolean;
  /** The floor that must be open first. */
  requires: string | null;
  /** Focus sessions done before it opens. */
  sessions: number;
  unlock: string | null;
  w: number;
  h: number;
  floorY: number;
  /** Where Pip's feet go while it walks about. */
  walkY: number;
  /** Always dark: lights glow. */
  night: boolean;
  slots: HouseSlot[];
  /** The mini-games live on this floor. */
  arcade: boolean;
  /** Pip's garden: plots watered by reading. */
  garden: boolean;
  /** How the art furnished it, before the reader decorates. */
  defaults: Placement[];
  /** The single room from before the house art, standing in for the house. */
  fallback: boolean;
};

export type Placement = { slot: string; itemId: string };
export type LevelDecor = { wallpaper: string | null; floor: string | null; placed: Placement[]; decorated?: boolean };
export type HouseFinish = { id: string; name?: string; price?: number };

export declare function registerHouseArt(...namespaces: Array<Record<string, unknown> | null | undefined>): void;
export declare function houseArt(name: string): unknown;
export declare function hasHouse(): boolean;
export declare function houseItems(): PipRoomItem[];
export declare function fitsSlot(item: PipRoomItem, slot: HouseSlot, levelId?: string): boolean;
export declare function houseLevels(): HouseLevel[];
export declare function wallpapers(): HouseFinish[];
export declare function floorings(): HouseFinish[];
export declare function slotKey(levelId: string, slotId: string): string;
export declare const WALLPAPER: string;
export declare const FLOOR: string;
export declare function levelDecor(layout: Record<string, string> | null | undefined, level: HouseLevel): LevelDecor;
export declare function withLevelDecor(layout: Record<string, string> | null | undefined, level: HouseLevel, decor: LevelDecor): Record<string, string>;
export declare function placements(layout: Record<string, string> | null | undefined): Map<string, string>;
export declare function renderHouseLevel(level: HouseLevel, frame: number, decor: LevelDecor, night?: boolean): ImageData | null;
export declare function renderItem(item: PipRoomItem | string, frame?: number): ImageData;
export declare function renderFinish(type: "wallpaper" | "floor", id: string, w?: number, h?: number): ImageData | null;
export declare function isGardenLevel(level: { id: string } | null | undefined): boolean;
export declare function skyAt(hour: number): number;
