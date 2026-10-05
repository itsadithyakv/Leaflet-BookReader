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
  /** Where its mini fridge may stand (left edges, best first); empty on a floor without one. */
  fridgeAt: number[];
  /** Where each of its other fixtures may be (top-lefts, best first), by fixture id; empty on a floor without any. */
  fixturesAt: Record<string, Array<[number, number]>>;
  /** The fixture that stands on its fridge (the houseplant), or null. */
  onFridge: string | null;
  /** How the art furnished it, before the reader decorates. */
  defaults: Placement[];
  /** The single room from before the house art, standing in for the house. */
  fallback: boolean;
};

/** `off`: a light drawn switched off (for the scene only; the saved layout has no such thing). */
export type Placement = { slot: string; itemId: string; off?: boolean };
/**
 * A fixture as the floor's picture draws it: which art (the fridge shut, or
 * open; the bookcase), and its top-left in floor pixels. `data` is what it
 * shows (handed to its draw), and `rev` a short name for that data: the
 * scene keeps the frames it has drawn, and draws again when a `rev` changes.
 */
export type Fixture = { itemId: string; x: number; y: number; data?: unknown; rev?: string };
/** `fixtures`: how the floor's fixtures are drawn (for the scene only; left out, they are drawn shut where `placed` leaves room). */
export type LevelDecor = { wallpaper: string | null; floor: string | null; placed: Placement[]; decorated?: boolean; fixtures?: Fixture[] };
export type HouseFinish = { id: string; name?: string; price?: number };

export declare function registerHouseArt(...namespaces: Array<Record<string, unknown> | null | undefined>): void;
/** Registers the decor each floor comes with (shop.js does, on load). */
export declare function setStarterPieces(byLevel: Record<string, string[]>): void;
/** The decor a floor comes with, in the order it is put out. */
export declare function starterPiecesFor(levelId: string): string[];
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
/** The first of `candidates` (left edges) where something `w` wide overlaps nothing in `taken`, or the one that overlaps least; null with no candidates. */
export declare function freeSpot(candidates: readonly number[], w: number, taken: ReadonlyArray<{ x: number; w: number }>): number | null;
/** Where this floor's mini fridge stands with this decor (its box, shut); null on a floor without one. */
export declare function fridgeBox(level: HouseLevel, decor: Pick<LevelDecor, "placed"> | null | undefined): { x: number; y: number; w: number; h: number } | null;
/** The first of `candidates` (top-lefts) where something `w` by `h` overlaps nothing in `taken`, or the one that overlaps least by area; null with no candidates. */
export declare function freePlace(
  candidates: ReadonlyArray<readonly [number, number]>,
  w: number,
  h: number,
  taken: ReadonlyArray<{ x: number; y: number; w: number; h: number }>
): [number, number] | null;
/** A fixture where it is: the box of its art, and `hit`, the part of it that is the thing itself (to choose it by). */
export type FixtureBox = { x: number; y: number; w: number; h: number; hit: { x: number; y: number; w: number; h: number } };
/** Where this floor's other fixtures are with this decor (the bookcase, the calendar, the plant on the fridge...), by fixture id. */
export declare function fixtureBoxes(level: HouseLevel, decor: Pick<LevelDecor, "placed"> | null | undefined): Record<string, FixtureBox>;
/** The floor's fixtures as its picture draws them: the fridge, shut or open, and the rest, each with what it shows (`data`, by fixture id). */
export declare function levelFixtures(level: HouseLevel, decor: Pick<LevelDecor, "placed"> | null | undefined, open?: boolean, data?: Record<string, unknown>): Fixture[];
export declare function renderHouseLevel(level: HouseLevel, frame: number, decor: LevelDecor, night?: boolean, hour?: number, openSky?: boolean): ImageData | null;
/** Where an item is drawn in a slot: its box in the floor's pixels, as the art places it. */
export declare function itemBox(item: PipRoomItem | string, slot: HouseSlot): { x: number; y: number; w: number; h: number } | null;
export declare function renderItem(item: PipRoomItem | string, frame?: number, data?: unknown): ImageData;
export declare function renderFinish(type: "wallpaper" | "floor", id: string, w?: number, h?: number): ImageData | null;
export declare function isGardenLevel(level: { id: string } | null | undefined): boolean;
export declare function skyAt(hour: number): number;
