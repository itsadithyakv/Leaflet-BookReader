export { renderFrame } from "./engine.js";
export { SKINS, resolve } from "./skins.js";
import { LIB } from "./anims.js";
export { LIB };

/**
 * The book scenes (51 of them) are only needed now and then, so they load in
 * their own chunk after start-up rather than with the app. Importing the
 * module adds them to LIB; this resolves once that has happened.
 */
let bookScenes = null;
export const loadBookScenes = () => (bookScenes ??= import("./books/index.js").then(() => undefined));
/** Whether a move is registered yet (a book scene may still be loading). */
export const hasMove = (id) => LIB.some((move) => move.id === id);
export { SCENERY } from "./door.js";
export { ACCESSORIES, SLOT_ORDER } from "./accessories.js";
export { ROOM_ITEMS, ROOM_STYLES, ROOM_W, ROOM_H, FLOOR_Y, DAY, skyFrame, renderRoom, renderRoomItem, Painter } from "./room.js";
export { TREATS } from "./treats.js";
export {
  HOUSE_LEVELS,
  WALLPAPERS,
  FLOORS,
  HOUSE_ITEMS,
  NOD_ITEMS,
  ALL_ITEMS,
  placeAt,
  renderLevel,
  renderHouseItem,
  renderSwatch
} from "./house.js";
export { GAME_SPRITES, GAME_POSES, renderGameSprite } from "./games-art.js";
import { dress as wear } from "./accessories.js";

/**
 * The skin wearing the given accessories. With none it is the skin itself,
 * the same object, so a plain Pip's frames stay shared across every sprite.
 */
export const dress = (skin, accessoryIds) => (accessoryIds && accessoryIds.length > 0 ? wear(skin, accessoryIds) : skin);
