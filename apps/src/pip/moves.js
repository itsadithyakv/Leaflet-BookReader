/* The moves the shop sells, the look every reader starts with, and what shows of a
 look (achievement skins, accessories a variant covers). Apart from the catalogue
 (shop.js, which re-exports them all), so that what needs only these at the app's
 start (the wardrobe's store, the profile picture in the header) does not bring the
 whole shop, the house and the treats into the app's first download. */
import { SKINS } from "./skins.js";
import { ACCESSORIES } from "./accessories.js";

/**
 * The cooler moves, sold as "Moves". Owning one makes it a signature idle
 * (and the profile picture's move), and adds it to Pip's free-time hobbies.
 * Celebrations triggered by reading still play any move for free, and so do
 * the book scenes: a reader never has to pay for Pip to cheer them on.
 */
export const PREMIUM_MOVES = [
  { id: "tapdance", price: 60 },
  { id: "floss", price: 60 },
  { id: "airguitar", price: 90 },
  { id: "robot", price: 90 },
  { id: "cycling", price: 90 },
  { id: "kick", price: 120 },
  { id: "disco", price: 120 },
  { id: "surf", price: 150 },
  { id: "kickflip", price: 150 },
  { id: "magic", price: 180 },
  { id: "moonwalk", price: 220 },
  { id: "headspin", price: 220 },
  { id: "fireworks", price: 260 },
  { id: "backflip", price: 300 },
  { id: "blastoff", price: 360 }
];

/** Signature idles every reader has from the start. */
export const FREE_SIGNATURES = ["read", "sunbathe", "tree", "jog", "idea", "hydrate", "cheer"];
export const DEFAULT_SIGNATURE = "read";
export const DEFAULT_VARIANT = "sprout";

/**
 * Achievement skins: shown in the wardrobe as goals, never sold. The art marks
 * them `earnedOnly`; these ids are the fallback, and match the server's
 * long-standing rule that an avatar never passes for an achievement.
 */
const EARNED_SKINS = ["champ", "golden", "rainbow"];
export const isEarnedOnly = (skin) => skin.earnedOnly === true || EARNED_SKINS.includes(skin.id);

// A variant that dresses a slot itself (a hat, glasses, a collar, a cape) says
// so with a flag; the wardrobe's `dress` leaves that slot's accessory off.
const SLOT_FLAG = { head: "hat", face: "face", neck: "neck", back: "back" };

/** Whether the variant's own outfit already fills this accessory slot. */
export const slotCovered = (skin, slot) => Boolean(skin && SLOT_FLAG[slot] && skin[SLOT_FLAG[slot]]);

/**
 * The accessories that actually show on a variant, in the order given:
 * unknown ids and ones whose slot the variant covers are left off. The
 * equipped outfit keeps them, so switching back to a plainer variant brings
 * them back; the profile picture uses only what shows.
 */
export const visibleOutfit = (skinId, outfit) => {
  const skin = SKINS.find((entry) => entry.id === skinId);
  const bySlot = new Map(ACCESSORIES.map((item) => [item.id, item.slot]));
  return (outfit || []).filter((id) => bySlot.has(id) && !slotCovered(skin, bySlot.get(id)));
};
