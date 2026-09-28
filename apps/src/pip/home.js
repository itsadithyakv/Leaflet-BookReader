/* Pip's house, as the app and the shop see it: the floors, what can go where,
 and how a floor is drawn with the reader's things in it.

 The art lives in room.js and house.js (floors, wallpapers, floors, decor) and
 games-art.js. It is drawn in parallel with the app, so this module reads it
 through one registration (`registerHouseArt`) and normalises what it finds.
 With no house art at all there is one floor, the bedroom from room.js, with
 each item in the spot the room art gave it, so the Pip tab is whole at every
 step.

 Plain JS, like shop.js: the catalogue generator imports it under Node.

 The contract with house.js:
   HOUSE_LEVELS  [{ id, name, w, h, floorY, price, unlock: { after, sessions },
                    unlockText, night, wallpaper, floor, blurb,
                    slots: [{ id, fits, x, y, w, h }] }]
     fits: "ceiling" | "wall" | "window" | "top" | "stand" | "rug"; (x, y) is
     the anchor: ceiling top-centre, wall/window centre, the rest bottom-centre.
   renderLevel(levelId, f, { wallpaper, floor, placed: [{ slot, itemId }], night })
   ALL_ITEMS / HOUSE_ITEMS  { id, name, kind, fits: [slot types], level, price, w, h, nod? }
   WALLPAPERS, FLOORS  [{ id, name, price }]; renderSwatch(type, id, w, h, f)
   renderHouseItem(item, f) */
import * as roomArt from "./room.js";

let art = { ...roomArt };

/**
 * Registers the house and game art modules the app found (house.js and so on).
 * Later modules win over room.js for any name both export.
 */
export const registerHouseArt = (...namespaces) => {
  art = Object.assign({ ...roomArt }, ...namespaces.filter(Boolean));
};

/** One export from the house art, or undefined while it has not landed. */
export const houseArt = (name) => art[name];

const list = (value) => (Array.isArray(value) ? value : []);

/** True once the art has real floors; false for the single-room fallback. */
export const hasHouse = () => list(art.HOUSE_LEVELS).length > 0;

// ---- the garden ----------------------------------------------------------------
//
// The garden is where seeds come from (plants watered by reading), so it is
// free and sits right after the bedroom, whatever the art prices it at. The
// art calls it the greenhouse; a floor named "garden" would do as well.

const GARDEN_IDS = ["garden", "greenhouse"];
export const isGardenLevel = (level) => Boolean(level) && GARDEN_IDS.includes(level.id);

// ---- items ----------------------------------------------------------------------

/** Everything that can go in the house: the room's items and the house's. */
export const houseItems = () => {
  const seen = new Set();
  const out = [];
  for (const item of [...list(art.ALL_ITEMS), ...list(art.ROOM_ITEMS), ...list(art.HOUSE_ITEMS), ...list(art.NOD_ITEMS)]) {
    if (item && item.id && !seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
};

/** The slot types an item goes in, from what it says or, failing that, what it is. */
const fitsOf = (item) => {
  if (Array.isArray(item.fits)) return item.fits;
  if (typeof item.fits === "string") return [item.fits];
  if (item.kind === "window") return ["window"];
  if (item.kind === "ceiling") return ["ceiling"];
  if (item.kind === "floor") return ["rug"];
  if (item.mount === "wall" || item.kind === "wall") return ["wall"];
  return ["stand"];
};

/** Whether an item may go in this slot on this floor. */
export const fitsSlot = (item, slot, levelId) => {
  if (slot.only && slot.only !== item.id) return false;
  const home = item.level;
  if (home && home !== "any" && levelId) {
    // "garden" and "greenhouse" name the same floor.
    const same = home === levelId || (GARDEN_IDS.includes(home) && GARDEN_IDS.includes(levelId));
    if (!same) return false;
  }
  return fitsOf(item).includes(slot.fits);
};

// ---- floors -------------------------------------------------------------------------

/** A slot's box (top-left, size) from its anchor, for hotspots over the art. */
const slotBox = (slot) => {
  const w = slot.w ?? 20;
  const h = slot.h ?? 20;
  if (slot.fits === "ceiling") return { x: slot.x - w / 2, y: slot.y, w, h };
  if (slot.fits === "wall" || slot.fits === "window") return { x: slot.x - w / 2, y: slot.y - h / 2, w, h };
  return { x: slot.x - w / 2, y: slot.y - h, w, h };
};

const normaliseSlot = (slot, index) => {
  const fits = slot.fits ?? slot.kind ?? "stand";
  const box = slotBox({ ...slot, fits });
  return { id: String(slot.id ?? `slot-${index}`), fits, name: slot.name ?? null, ...box, only: slot.only ?? null };
};

/** Starter things (free, `starter`) go in the first slot on their floor that fits. */
const starterPlacements = (level, slots) => {
  const taken = new Set();
  const out = [];
  for (const item of houseItems().filter((entry) => entry.starter)) {
    const target = slots.find((slot) => !taken.has(slot.id) && fitsSlot(item, slot, level.id));
    if (target) {
      taken.add(target.id);
      out.push({ slot: target.id, itemId: item.id });
    }
  }
  return out;
};

const normaliseLevel = (level) => {
  const garden = isGardenLevel(level);
  const w = level.w ?? 240;
  const h = level.h ?? 120;
  const floorY = level.floorY ?? Math.round(h * 0.8);
  const slots = list(level.slots).map(normaliseSlot);
  const unlock = level.unlock && typeof level.unlock === "object" ? level.unlock : {};
  return {
    id: level.id,
    name: garden ? "Garden" : level.name ?? level.id,
    blurb: garden ? "Plots watered by your reading. Harvest what ripens for seeds." : level.blurb ?? null,
    price: garden ? 0 : typeof level.price === "number" ? level.price : 0,
    earnedOnly: false,
    // The floor below must be open first, and so many focus sessions done.
    requires: garden ? null : unlock.after ?? null,
    sessions: garden ? 0 : unlock.sessions ?? 0,
    unlock: garden ? "Yours from day one." : level.unlockText ?? null,
    w,
    h,
    floorY,
    // Where Pip's feet go: a little way into the floor, so it stands in the room.
    walkY: Math.min(h - 3, floorY + Math.round((h - floorY) * 0.55)),
    night: Boolean(level.night),
    slots,
    arcade: Boolean(level.arcade || /arcade/i.test(level.id)),
    garden,
    defaults: [],
    fallback: false
  };
};

/** The single room from before the house had floors: every item in its own spot. */
const fallbackBedroom = () => {
  const w = art.ROOM_W ?? 160;
  const h = art.ROOM_H ?? 96;
  const slots = list(art.ROOM_ITEMS).map((item) => ({
    id: item.id,
    fits: fitsOf(item)[0],
    name: item.name,
    x: item.at?.[0] ?? 0,
    y: item.at?.[1] ?? 0,
    w: item.w,
    h: item.h,
    only: item.id
  }));
  return {
    id: "bedroom",
    name: "Bedroom",
    blurb: "Where Pip naps between chapters.",
    price: 0,
    earnedOnly: false,
    requires: null,
    sessions: 0,
    unlock: null,
    w,
    h,
    floorY: art.FLOOR_Y ?? 66,
    walkY: 91,
    night: false,
    slots,
    arcade: false,
    garden: false,
    defaults: list(art.ROOM_ITEMS)
      .filter((item) => item.starter || item.price === 0)
      .map((item) => ({ slot: item.id, itemId: item.id })),
    fallback: true
  };
};

/** Before the house art: a plain garden floor, drawn by garden.js. */
const fallbackGarden = () => ({
  ...fallbackBedroom(),
  id: "garden",
  name: "Garden",
  blurb: "Plots watered by your reading. Harvest what ripens for seeds.",
  slots: [],
  defaults: [],
  garden: true
});

/**
 * Every floor of the house, bottom first: the bedroom, then the garden, then
 * the rest in the art's order. The first two are free.
 */
export const houseLevels = () => {
  if (!hasHouse()) return [fallbackBedroom(), fallbackGarden()];
  const levels = list(art.HOUSE_LEVELS).map(normaliseLevel);
  const garden = levels.find((level) => level.garden);
  const ordered = garden ? [levels[0], garden, ...levels.slice(1).filter((level) => level !== garden)] : levels;
  // A floor that followed the garden in the art now follows whatever was before it.
  const ids = ordered.map((level) => level.id);
  for (const level of ordered) {
    if (level.requires && garden && level.requires === garden.id) {
      const index = ids.indexOf(level.id);
      level.requires = ids[index - 1] ?? null;
    }
    level.defaults = level.fallback ? level.defaults : starterPlacements(level, level.slots);
  }
  return ordered;
};

export const wallpapers = () => (hasHouse() ? list(art.WALLPAPERS) : []);
export const floorings = () => (hasHouse() ? list(art.FLOORS ?? art.FLOORINGS) : []);

// ---- the layout ------------------------------------------------------------------
//
// Rust stores one map for the whole house (see pip/mod.rs, `check_look`):
//   `level/slot` -> room item, `level/@wallpaper`, `level/@floor`, and, from
//   the single-room layout, `item` -> item (the bedroom, each item in its spot).

export const slotKey = (levelId, slotId) => `${levelId}/${slotId}`;
export const WALLPAPER = "@wallpaper";
export const FLOOR = "@floor";

/** A floor's decor from the house layout: its wallpaper, floor and placed things. */
export const levelDecor = (layout, level) => {
  const prefix = `${level.id}/`;
  const placed = [];
  let wallpaper = null;
  let floor = null;
  let any = false;
  for (const [key, value] of Object.entries(layout || {})) {
    if (key.startsWith(prefix)) {
      any = true;
      const part = key.slice(prefix.length);
      if (part === WALLPAPER) wallpaper = value;
      else if (part === FLOOR) floor = value;
      else placed.push({ slot: part, itemId: value });
    } else if (level.fallback && !key.includes("/")) {
      any = true;
      placed.push({ slot: key, itemId: value });
    }
  }
  // A floor nobody has decorated yet starts as the art furnished it.
  return { wallpaper, floor, placed: any ? placed : level.defaults.slice(), decorated: any };
};

/**
 * The house layout with one floor's decor replaced. Keys from the old single
 * room are dropped once the house has real floors: they named the bedroom's
 * spots, which the house's bedroom does not have.
 */
export const withLevelDecor = (layout, level, decor) => {
  const prefix = `${level.id}/`;
  const next = {};
  for (const [key, value] of Object.entries(layout || {})) {
    if (key.startsWith(prefix)) continue;
    if (!key.includes("/") && (level.fallback || hasHouse())) continue;
    next[key] = value;
  }
  if (decor.wallpaper) next[prefix + WALLPAPER] = decor.wallpaper;
  if (decor.floor) next[prefix + FLOOR] = decor.floor;
  for (const { slot, itemId } of decor.placed) next[prefix + slot] = itemId;
  return next;
};

/** Where each placed item is now (item id -> "level/slot"), across the house. */
export const placements = (layout) => {
  const out = new Map();
  for (const [key, value] of Object.entries(layout || {})) {
    if (!key.includes("@")) out.set(value, key.includes("/") ? key : slotKey("bedroom", key));
  }
  return out;
};

// ---- drawing ------------------------------------------------------------------------

/** A floor with its decor, as w x h ImageData. Null for a floor another module draws (the fallback garden). */
export const renderHouseLevel = (level, frame, decor, night) => {
  if (!level.fallback && typeof art.renderLevel === "function") {
    return art.renderLevel(level.id, frame, {
      wallpaper: decor.wallpaper ?? undefined,
      floor: decor.floor ?? undefined,
      placed: decor.placed,
      // Always-dark floors stay dark; the rest dim in the evening and lamps glow.
      night: level.night || Boolean(night)
    });
  }
  if (level.garden) return null;
  const byId = new Map(list(art.ROOM_ITEMS).map((item) => [item.id, item]));
  const placed = decor.placed
    .map(({ itemId }) => byId.get(itemId))
    .filter(Boolean)
    .map((item) => ({ id: item.id, x: item.at[0], y: item.at[1] }));
  return art.renderRoom(decor.wallpaper ?? "cozy", frame, placed);
};

/** One house item as its own sprite. */
export const renderItem = (item, frame = 0) =>
  typeof art.renderHouseItem === "function" ? art.renderHouseItem(item, frame) : art.renderRoomItem(item, frame);

/** A wallpaper or floor swatch for a shop tile, or null without the art. */
export const renderFinish = (type, id, w = 32, h = 32) =>
  typeof art.renderSwatch === "function" ? art.renderSwatch(type, id, w, h, 0) : null;

/** The frame at which a window shows this hour's sky, if the art has windows. */
export const skyAt = (hour) => (typeof art.skyFrame === "function" ? art.skyFrame(hour) : 0);
