/** Typed boundary for expedition-art.js: the things Pip brings back from her expeditions, as pixel sprites. */

/** Every find is drawn on a square of this many pixels. */
export declare const FIND_SIZE: number;
/** The ids a sprite is drawn for (expedition.ts's FINDS, one each). */
export declare const FIND_ART_IDS: string[];
export declare function hasFindArt(id: string): boolean;
/** One find as its own FIND_SIZE x FIND_SIZE sprite at frame `f` (12 fps), on a clear ground. */
export declare function renderFind(id: string, f?: number): ImageData;
/** The same shape in one flat colour: a thing not found yet. */
export declare function renderFindSilhouette(id: string, colour?: string): ImageData;

/** A find at half size is this many pixels square: for a display in the room too small for the real thing. */
export declare const FIND_MINI: number;
/** A find in the house's item format (`g` is the room Painter, `f` the frame). */
export type FindSpriteItem = { id: string; w: number; h: number; draw: (g: unknown, f?: number) => unknown };
/** Every find at full size, in the house's item format. */
export declare const FIND_SPRITES: FindSpriteItem[];
/** Every find at half size: its colours and rough shape. */
export declare const FIND_MINIS: FindSpriteItem[];
/** One find at half size, its top left at (x, y), on any Painter. */
export declare function drawFindMini(g: unknown, x: number, y: number, id: string, f?: number): unknown;
/** One find at half size as its own sprite. */
export declare function renderFindMini(id: string, f?: number): ImageData;
