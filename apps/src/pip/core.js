/**
 * Pip himself: the sprite engine, skins, moves and accessories. What every Pip
 * on screen needs, and all that loads with the app.
 *
 * The full entry point (`./index.js`) adds the house (its floors, 171 decor
 * items, wallpapers), the room and the arcade art. Importing that from start-up
 * code put all of it in the app's first download; only the Pip tab and the
 * arcade need it, and they load it with themselves.
 */
export { renderFrame } from "./engine.js";
export { SKINS, resolve } from "./skins.js";
import { LIB } from "./anims.js";
export { LIB };
export { SCENERY } from "./door.js";
export { ACCESSORIES, SLOT_ORDER } from "./accessories.js";
import { dress as wear } from "./accessories.js";

/**
 * The book scenes (71 of them) are only needed now and then, so they load in
 * their own chunk after start-up rather than with the app. Importing the
 * module adds them to LIB; this resolves once that has happened.
 */
let bookScenes = null;
export const loadBookScenes = () => (bookScenes ??= import("./books/index.js").then(() => undefined));
/** Whether a move is registered yet (a book scene may still be loading). */
export const hasMove = (id) => LIB.some((move) => move.id === id);

/**
 * The skin wearing the given accessories. With none it is the skin itself,
 * the same object, so a plain Pip's frames stay shared across every sprite.
 */
export const dress = (skin, accessoryIds) => (accessoryIds && accessoryIds.length > 0 ? wear(skin, accessoryIds) : skin);
