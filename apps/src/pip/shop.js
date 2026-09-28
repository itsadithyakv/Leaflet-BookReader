/* The Pip shop: everything seeds can buy, and what it costs.

 One list, read by three places that must agree:
 - the Pip tab (prices on tiles, what is owned for free);
 - the Rust side, which re-checks every purchase against its own copy of the
   prices (src-tauri/src/pip/catalogue.json), so a price can never be set from
   the webview;
 - the server, which accepts the reader's own Pip as an avatar only in parts it
   knows (server/src/pipParts.json).
 Both copies are generated from this file by scripts/pip-catalogue.mjs (the
 Vite build runs it), so they cannot drift from the art.

 This file is the price authority. The art gives every thing a price, and
 those are read as relative (this hat costs more than that one); the scales
 below turn them into seeds on one economy, paced for a reader who reads about
 20 minutes a day (see PACING).

 Plain JS on purpose: the generator imports it under plain Node. */
import { SKINS } from "./skins.js";
import { ACCESSORIES } from "./accessories.js";
import { ROOM_STYLES } from "./room.js";
import { floorings, hasHouse, houseItems, houseLevels, wallpapers } from "./home.js";
import { TREATS } from "./treats.js";
import { LIB } from "./anims.js";

/**
 * What the prices are aiming at, for a reader doing a 20-minute goal most
 * days (about 30 water a day, finished cleanly): the garden yields roughly
 * 10 to 12 seeds a day at its best, goal and streak bonuses about 10 more, so
 * about 150 a week.
 *   common thing  ~ a week      rare  ~ 3 weeks      epic ~ 6 to 8 weeks
 *   legendary     ~ 3 months    a new floor of the house ~ 3 to 6 weeks
 */
export const PACING = { perWeek: 150 };

const round = (value, step = 10) => Math.max(step, Math.round(value / step) * step);

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
 * The garden's seed packets. A plant ripens on its minutes of focus (water),
 * then is picked for seeds. Longer plants pay better per minute, so planting
 * an oak is a small promise to read this fortnight.
 */
export const PLANTS = [
  { id: "radish", name: "Radish", water: 15, yield: 4, price: 1, blurb: "Quick and crunchy. Ripe in a chapter." },
  { id: "strawberry", name: "Strawberry", water: 30, yield: 9, price: 2, blurb: "A sweet half hour." },
  { id: "sunflower", name: "Sunflower", water: 60, yield: 20, price: 4, blurb: "Follows the light, like a good reader." },
  { id: "rose", name: "Reading Rose", water: 120, yield: 42, price: 8, blurb: "Blooms after a couple of evenings." },
  { id: "pumpkin", name: "Pumpkin", water: 180, yield: 70, price: 12, blurb: "A week of goals, one very round reward." },
  { id: "oak", name: "Oak", water: 600, yield: 260, price: 30, blurb: "Plant it now; harvest it a book later." }
];

/** Plots beyond the free three, bought one after another. */
export const EXTRA_PLOTS = [
  { id: "plot-4", name: "Fourth plot", price: 200 },
  { id: "plot-5", name: "Fifth plot", price: 350 },
  { id: "plot-6", name: "Sixth plot", price: 500 }
];
export const FREE_PLOTS = 3;

/**
 * Achievement skins: shown in the wardrobe as goals, never sold. The art marks
 * them `earnedOnly`; these ids are the fallback, and match the server's
 * long-standing rule that an avatar never passes for an achievement.
 */
const EARNED_SKINS = ["champ", "golden", "rainbow"];
export const isEarnedOnly = (skin) => skin.earnedOnly === true || EARNED_SKINS.includes(skin.id);

// Skins by rarity: each rarity has a band, and within it the art's own prices
// keep their order (the King costs more than the President).
const RARITY_BAND = {
  Starter: [0, 0],
  Common: [120, 200],
  Rare: [400, 520],
  Epic: [900, 1200],
  Seasonal: [600, 600],
  Secret: [1200, 1200],
  Legendary: [1800, 2400]
};
export const skinPrice = (skin) => {
  if (isEarnedOnly(skin)) return 0;
  const band = RARITY_BAND[skin.rarity] ?? RARITY_BAND.Rare;
  if (band[1] === 0) return 0;
  const peers = SKINS.filter((entry) => entry.rarity === skin.rarity && !isEarnedOnly(entry) && typeof entry.price === "number");
  const prices = peers.map((entry) => entry.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const t = typeof skin.price === "number" && hi > lo ? (skin.price - lo) / (hi - lo) : 0.5;
  return round(band[0] + t * (band[1] - band[0]));
};

// Everything else: the art's price times a scale. Free stays free.
const scaled = (price, factor, step = 5) => (price > 0 ? round(price * factor, step) : 0);
export const accessoryPrice = (item) => scaled(item.price ?? 0, 0.5);
export const itemPrice = (item) => scaled(item.price ?? 0, 0.6);
export const finishPrice = (item) => scaled(item.price ?? 0, 0.6);
export const treatPrice = (treat) => (treat.kind === "food" ? scaled(treat.price ?? 0, 0.5, 1) : scaled(treat.price ?? 0, 0.6));

/** Floors of the house: the paid ones step from ~3 to ~6 weeks of reading, in order. */
const FLOOR_PRICES = [450, 550, 650, 750, 900];
const levelPrices = () => {
  const paid = houseLevels().filter((level) => level.price > 0 && !level.earnedOnly);
  return new Map(
    paid.map((level, index) => [level.id, FLOOR_PRICES[Math.min(index, FLOOR_PRICES.length - 1)] + Math.max(0, index - (FLOOR_PRICES.length - 1)) * 150])
  );
};

export const accessories = () => ACCESSORIES;

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
  const bySlot = new Map(accessories().map((item) => [item.id, item.slot]));
  return (outfit || []).filter((id) => bySlot.has(id) && !slotCovered(skin, bySlot.get(id)));
};

/** Everything for the house: the bedroom's things and every floor's. */
export const roomItems = () => houseItems();
export const treats = () => TREATS;
/**
 * The single room's wall-and-floor schemes. Once the house has floors, each
 * floor takes a wallpaper and a flooring instead (home.js), and these retire.
 */
export const roomStyles = () => (hasHouse() ? [] : ROOM_STYLES);

// ---- book nods ------------------------------------------------------------------

const words = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Whether a house item's book nod is a book in the reader's library. A nod
 * names its book loosely (a title, or `{ title, author }`, or a pattern), so
 * this matches like Pip's book scenes do: on the title, ignoring case and
 * punctuation, either way round.
 */
export const nodMatches = (nod, book) => {
  if (!nod || !book?.title) return false;
  if (nod instanceof RegExp) return nod.test(book.title);
  const title = words(book.title);
  const wanted = words(typeof nod === "object" ? nod.title ?? nod.book ?? "" : nod);
  if (wanted.length < 3 || title.length < 3) return false;
  if (typeof nod === "object" && nod.author && book.author && !words(book.author).includes(words(nod.author))) return false;
  // Whole words only, so "Emma" is not found in "Gemma".
  const within = (outer, inner) => ` ${outer} `.includes(` ${inner} `);
  return within(title, wanted) || (title.length >= 6 && within(wanted, title));
};

const moveName = (id) => LIB.find((move) => move.id === id)?.name ?? id;

/**
 * Every priced thing, flattened: `{ kind, id, name, price, ... }`.
 *
 * kind: "skin" | "accessory" | "room" | "style" | "treat" | "move" | "level"
 * | "wallpaper" | "flooring" | "plant" | "plot". A floor of the house is a
 * "level". Free things (price 0) are owned from the start, except achievement
 * skins. Food and seed packets are `consumable`: bought each time. Everything
 * else is bought once; `requires` names what must be owned first (the floor
 * below), `sessions` how many focus sessions first.
 */
export const catalogue = () => {
  const floors = levelPrices();
  return [
    ...SKINS.map((skin) => ({
      kind: "skin",
      id: skin.id,
      name: skin.name,
      price: skinPrice(skin),
      earnedOnly: isEarnedOnly(skin)
    })),
    ...accessories().map((item) => ({ kind: "accessory", id: item.id, name: item.name, price: accessoryPrice(item), slot: item.slot })),
    ...roomItems().map((item) => ({
      kind: "room",
      id: item.id,
      name: item.name,
      price: item.starter ? 0 : itemPrice(item),
      roomKind: item.kind,
      ...(item.nod ? { nod: item.nod } : {})
    })),
    ...roomStyles().map((style) => ({ kind: "style", id: style.id, name: style.name ?? style.id, price: style.price ?? 0 })),
    ...houseLevels().map((level) => ({
      kind: "level",
      id: level.id,
      name: level.name,
      price: floors.get(level.id) ?? 0,
      earnedOnly: level.earnedOnly,
      ...(level.requires ? { requires: level.requires } : {}),
      ...(level.sessions ? { sessions: level.sessions } : {})
    })),
    ...wallpapers().map((paper) => ({ kind: "wallpaper", id: paper.id, name: paper.name ?? paper.id, price: finishPrice(paper) })),
    ...floorings().map((floor) => ({ kind: "flooring", id: floor.id, name: floor.name ?? floor.id, price: finishPrice(floor) })),
    ...treats().map((treat) => ({
      kind: "treat",
      id: treat.id,
      name: treat.name,
      price: treatPrice(treat),
      consumable: treat.kind === "food",
      mood: treat.mood ?? 0,
      move: treat.move
    })),
    ...PLANTS.map((plant) => ({ kind: "plant", id: plant.id, name: plant.name, price: plant.price, consumable: true, water: plant.water, yield: plant.yield })),
    ...EXTRA_PLOTS.map((plot, index) => ({
      kind: "plot",
      id: plot.id,
      name: plot.name,
      price: plot.price,
      ...(index > 0 ? { requires: EXTRA_PLOTS[index - 1].id } : {})
    })),
    ...FREE_SIGNATURES.map((id) => ({ kind: "move", id, name: moveName(id), price: 0 })),
    ...PREMIUM_MOVES.map((move) => ({ kind: "move", id: move.id, name: moveName(move.id), price: move.price }))
  ];
};

/** One catalogue entry, for its price. Built once: the catalogue does not change while the app runs. */
let byKey = null;
export const catalogueItem = (kind, id) => {
  if (!byKey) byKey = new Map(catalogue().map((item) => [`${item.kind}:${item.id}`, item]));
  return byKey.get(`${kind}:${id}`) ?? null;
};
