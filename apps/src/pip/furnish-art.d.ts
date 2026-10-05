/** Typed boundary for furnish-art.js: the art of furnishings in use. */

/** The Window's curtains, `closed` of the way across (0 tied back, 1 shut), on a clear ground. */
export declare function renderCurtains(closed: number, w?: number, h?: number): ImageData;
/** A sprite dimmed as the room's picture dims after dark. */
export declare function dimForNight(image: ImageData): ImageData;

/** The engine's painter, or the room's: the same drawing API. */
type Paints = { rect(x: number, y: number, w: number, h: number, colour: string): unknown };
/**
 * The open book of the reading poses, in `cover`, with a ribbon `progress`
 * (0 to 1) of the way across its pages (none without a `progress`).
 */
export declare function bookInHand(g: Paints, x: number, y: number, o?: { cover?: string; progress?: number | null; flip?: number | null; w?: number; h?: number }): void;
/** The book Pip reads in her house: the reader's current one, or null for the plain red book. */
export declare function setHandBook(book: { cover: string; progress: number } | null): void;
export declare function handBook(): { cover: string; progress: number } | null;
/** The move to play for "read": the same pose, holding that book. "read" itself with none. */
export declare function readingMove(): string;
