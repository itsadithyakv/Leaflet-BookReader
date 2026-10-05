/**
 * The sizes of desktop Pip's window. Rust places and sizes the window
 * (`src-tauri/src/desktop_pip/mod.rs` has the same numbers: SPRITE, WIDEST,
 * TALLEST, `per_pixel`); the page only says what the window has to hold.
 *
 * Everything is in art pixels: the sprite is 32 of them square, and one art
 * pixel is a whole number of device pixels at any scaling. So a window of
 * 64 by 48 art pixels is exactly that many times the sprite's own pixel, and
 * Pip, centred in it, lands on a whole device pixel.
 */

/** The sprite, in art pixels. */
export const SPRITE = 32;
/** The largest the window gets: the menu, open above her. */
export const WIDEST = 88;
export const TALLEST = 84;

export type Frame = { width: number; height: number };

/** The placard's board, set on top of the sprite (its post is in the sprite: moves.js, "holdup"). */
export const SIGN_BOARD = { width: 62, height: 15 };
/** The menu's box, and the gap between it and her leaf. */
export const MENU_BOX = { width: 86, height: 48 };

export const FRAMES = {
  plain: { width: SPRITE, height: SPRITE },
  sign: { width: 64, height: SPRITE + SIGN_BOARD.height + 1 },
  menu: { width: WIDEST, height: TALLEST }
} as const satisfies Record<string, Frame>;

/**
 * Device pixels per art pixel at a device pixel ratio. The sum PipSprite does
 * for a 64px sprite (`pixelScale`), and the one Rust does to size the window.
 */
export const perPixel = (ratio: number) => Math.max(1, Math.floor(2 * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1) + 1e-6));

/** CSS pixels per art pixel: what the page multiplies its art-pixel sizes by. */
export const artPx = (ratio: number) => perPixel(ratio) / (Number.isFinite(ratio) && ratio > 0 ? ratio : 1);

/** What the window must hold now. Carried or falling she is only herself. */
export const frameFor = (showing: { sign: boolean; menu: boolean; carried: boolean }): Frame =>
  showing.carried ? FRAMES.plain : showing.menu ? FRAMES.menu : showing.sign ? FRAMES.sign : FRAMES.plain;
