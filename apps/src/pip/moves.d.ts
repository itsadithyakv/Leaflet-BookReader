/** Typed boundary for moves.js (plain JS, like shop.js, which re-exports it). */
import type { PipAccessory, PipSkin } from "./index";

export declare const PREMIUM_MOVES: { id: string; price: number }[];
export declare const FREE_SIGNATURES: string[];
export declare const DEFAULT_SIGNATURE: string;
export declare const DEFAULT_VARIANT: string;
export declare function isEarnedOnly(skin: PipSkin): boolean;
export declare function slotCovered(skin: PipSkin | undefined, slot: PipAccessory["slot"]): boolean;
export declare function visibleOutfit(skinId: string, outfit: readonly string[]): string[];
