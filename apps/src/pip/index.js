// Everything Pip: himself (core.js) plus the room, the house and the arcade.
// Start-up code imports ./core.js instead, so the house art loads only with
// the Pip tab and the arcade.
export { renderFrame, SKINS, resolve, LIB, SCENERY, ACCESSORIES, SLOT_ORDER, loadBookScenes, hasMove, dress } from "./core.js";
export { ROOM_ITEMS, ROOM_STYLES, ROOM_W, ROOM_H, FLOOR_Y, DAY, skyFrame, renderRoom, renderRoomItem, Painter } from "./room.js";
export { TREATS } from "./treats.js";
export {
  HOUSE_LEVELS,
  WALLPAPERS,
  FLOORS,
  HOUSE_ITEMS,
  NOD_ITEMS,
  ALL_ITEMS,
  FIXTURES,
  placeAt,
  renderLevel,
  renderHouseItem,
  renderSwatch
} from "./house.js";
export { GAME_SPRITES, GAME_POSES, renderGameSprite } from "./games-art.js";
// Pip's moves for life in the house (watching the pointer, being petted,
// fetching the ball): registered into LIB as this loads, with the Pip tab.
import "./house-moves.js";
