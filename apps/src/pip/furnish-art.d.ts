/** Typed boundary for furnish-art.js: the art of furnishings in use. */

/** The Window's curtains, `closed` of the way across (0 tied back, 1 shut), on a clear ground. */
export declare function renderCurtains(closed: number, w?: number, h?: number): ImageData;
/** A sprite dimmed as the room's picture dims after dark. */
export declare function dimForNight(image: ImageData): ImageData;
