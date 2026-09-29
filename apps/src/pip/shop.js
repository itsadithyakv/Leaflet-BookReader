/* The Pip shop: everything seeds can buy, and what it costs; and the seeds Pip
 gives back (first steps, the starter chest, sets, the daily wish).

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
import { floorings, hasHouse, houseItems, houseLevels, setStarterPieces, wallpapers } from "./home.js";
import { TREATS } from "./treats.js";
import { LIB } from "./anims.js";

/**
 * What the prices are aiming at, for a reader doing a 20-minute goal most
 * days (about 30 water a day, finished cleanly): the garden yields roughly
 * 10 to 12 seeds a day at its best, goal and streak bonuses about 10 more, so
 * about 150 a week.
 *   common thing  ~ a week      rare  ~ 3 weeks      epic ~ 6 to 8 weeks
 *   legendary     ~ 3 months    a new floor of the house ~ 3 to 6 weeks
 *
 * The first days are quicker, on purpose: a new reader should buy something
 * the first evening. Beside the welcome gift (50) come the starter chest (30,
 * with the first focus session of 5 minutes) and the first steps (100 in
 * all, see GOALS), and the first variant costs 80. One 20-minute session
 * after planting a radish leaves about 138 seeds: enough for a hat, the
 * floor lamp, a snack and the gardener that same evening (the steps pay part
 * of each back). Before, the cheapest variant alone was about 140 minutes of
 * focused reading away. After the first days, the pace above holds: the
 * daily wish (8) is about what the wished thing costs, and sets pay back
 * about a tenth of what their pieces cost.
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
 * The first variant, priced for the first days rather than the first weeks:
 * with the welcome gift, the starter chest and a few first steps it is a
 * reader's first evening of reading. The gardener, for someone who has just
 * planted their first seed. The other Common variants keep their band.
 */
export const FIRST_VARIANT = { id: "gardener", price: 80 };

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
  if (skin.id === FIRST_VARIANT.id) return FIRST_VARIANT.price;
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

// ---- starter pieces -------------------------------------------------------------

/**
 * Decor that comes with a floor, so no floor opens bare. The bedroom's and
 * the garden's are everyone's from the start (beside the bed and the rug,
 * which the art gives away); a new floor's are Pip's the moment it opens.
 * Rust derives that from owning the floor (pip/mod.rs, `owned`), and a piece
 * that comes with a floor is never sold on its own. Each goes into the first
 * free spot on its floor that fits it, in this order (home.js).
 */
export const STARTER_PIECES = {
  bedroom: ["window", "poster", "bookstack"],
  greenhouse: ["wateringcan"],
  kitchen: ["kettle"],
  library: ["ladder"],
  arcade: ["arcadecabinet"],
  workshop: ["toolboard"],
  observatory: ["starmap"]
};
setStarterPieces(STARTER_PIECES);

/**
 * The floor a piece of decor comes with, or null: a starter piece is Pip's
 * once its floor is. Only floors this house has count (without the house
 * art there is no kitchen to come with).
 */
export const comesWith = (itemId, floors = new Set(houseLevels().map((level) => level.id))) => {
  const found = Object.entries(STARTER_PIECES).find(([floor, ids]) => floors.has(floor) && ids.includes(itemId));
  return found ? found[0] : null;
};

/**
 * Whether a piece of decor is a light: a lamp, fairy lights, a lantern or a
 * glowing ceiling light. A stove or an arcade cabinet glows too, but nobody
 * buys one to light the room.
 */
const castsLight = (item) => item.kind === "light" || (item.kind === "ceiling" && Boolean(item.glow));

// ---- rewards --------------------------------------------------------------------
//
// Seeds Pip gives back beside the garden: for a new reader's first steps, the
// starter chest, a finished set and a granted wish. Like prices, the amounts
// live here and Rust holds a copy (catalogue.json); what earns each one is
// decided in Rust (pip/rewards.rs), from the records every device shares, so
// nothing is ever claimed and nothing can pay twice.
//
// An amount may go up in a later version, never down: rewards are recomputed
// from the records, so lowering one would take seeds back from readers who
// already have them (and may have spent them).

/** The starter chest: a gift that opens with the first focus session of a few minutes. */
export const STARTER_CHEST = { seeds: 30, minutes: 5 };

/**
 * A new reader's first steps, in the order Pip suggests them. Each pays once.
 * The ids are Rust's: pip/rewards.rs knows what each one asks for.
 */
export const GOALS = [
  { id: "plant", name: "Plant a seed", hint: "Choose a seed packet for an empty plot in the garden.", seeds: 10 },
  { id: "water", name: "Water it by reading", hint: "Read in a focus session: every minute is water for the garden.", seeds: 10 },
  { id: "read", name: "Meet your reading goal", hint: "Read your daily minutes, any way you like.", seeds: 15 },
  { id: "pick", name: "Pick a plant", hint: "Once it's ripe, select it in the garden.", seeds: 15 },
  { id: "treat", name: "Give Pip a treat", hint: "A snack from Treats costs a few seeds.", seeds: 5 },
  { id: "hat", name: "Buy Pip a hat", hint: "The shop's wardrobe has hats from 25 seeds.", seeds: 20 },
  { id: "lamp", name: "Place a lamp", hint: "A lamp from the shop goes straight into a free spot.", seeds: 25 }
];

/**
 * Sets: own every piece for a bonus of about a tenth of what they cost. A set
 * never changes once it has shipped (a reader who finished it would lose the
 * bonus when a piece was added); a new idea is a new set.
 *
 * The outfits take one piece per slot, so a whole set can be worn at once.
 * `level` marks a floor's decor set, which the whole house sells.
 */
export const SETS = [
  { id: "bookworm", name: "Bookworm", kind: "accessory", items: ["roundglasses", "scarf", "bookbag", "book"], seeds: 20 },
  { id: "party", name: "Party Animal", kind: "accessory", items: ["partyhat", "glasses3d", "bowtie", "balloon"], seeds: 20 },
  { id: "sweetheart", name: "Sweetheart", kind: "accessory", items: ["bow", "heartglasses", "bell", "lollipop"], seeds: 20 },
  { id: "bloom", name: "In Bloom", kind: "accessory", items: ["flower", "blush", "lei", "sunflower"], seeds: 15 },
  { id: "explorer", name: "Explorer", kind: "accessory", items: ["cap", "shades", "bandana", "backpack"], seeds: 25 },
  { id: "dapper", name: "Dapper", kind: "accessory", items: ["tophat", "monocle", "tie", "umbrella"], seeds: 35 },
  { id: "starlight", name: "Starlight", kind: "accessory", items: ["halo", "starglasses", "fairywings", "sparkler"], seeds: 50 },
  { id: "royal", name: "Royalty", kind: "accessory", items: ["crown", "necklace", "cape", "wand"], seeds: 60 },
  // The bedroom's own pieces, sold in every build.
  { id: "reading-corner", name: "Reading Corner", kind: "room", items: ["armchair", "lamp", "clock"], seeds: 35 },
  { id: "cosy-evening", name: "Cosy Evening", kind: "room", items: ["fireplace", "fairylights", "beanbag", "catbed"], seeds: 90 },
  // A floor's own set, starter piece included.
  { id: "greenhouse", name: "Greenhouse", kind: "room", level: "greenhouse", items: ["wateringcan", "tulips", "bonsai", "gnome", "sunflowers", "hangingplant", "mushroomlamp"], seeds: 50 },
  { id: "kitchen", name: "Kitchen", kind: "room", level: "kitchen", items: ["kettle", "fridge", "stove", "kitchentable", "fruitbowl", "toaster"], seeds: 70 },
  { id: "library", name: "Library", kind: "room", level: "library", items: ["ladder", "tallshelf", "readingchair", "lectern", "grandfatherclock"], seeds: 80 },
  { id: "arcade", name: "Attic Arcade", kind: "room", level: "arcade", items: ["arcadecabinet", "tvconsole", "controller", "clawmachine", "jukebox", "discoball"], seeds: 110 },
  { id: "workshop", name: "Workshop", kind: "room", level: "workshop", items: ["toolboard", "workbench", "robotbuddy"], seeds: 60 },
  { id: "observatory", name: "Observatory", kind: "room", level: "observatory", items: ["starmap", "telescope", "orrery"], seeds: 90 }
];

/**
 * Pip's daily wish: one small thing a day, chosen by Rust from the date and
 * these lists (pip/rewards.rs). Granting it the same day (a snack given, a
 * packet planted, a piece or a move bought) cheers Pip up and pays a few
 * seeds. Snacks and packets are cheap; a piece or a move is wished for only
 * while Pip does not have it, and each is one a reader could save for in a
 * few days.
 *
 * The lists are frozen from their `since` day: changing one would change what
 * Pip wished for on days gone by, and so the seeds granting it paid. A new
 * list is a new era, from its first day; and what is on a list stays for sale.
 */
export const WISH = {
  seeds: 8,
  mood: 10,
  eras: [
    {
      since: "2026-09-29",
      treat: ["apple", "cookie", "watermelon", "tea", "donut", "cocoa", "cupcake", "pizza", "icecream"],
      plant: ["radish", "strawberry", "sunflower", "rose"],
      room: ["lamp", "plant", "clock", "beanbag"],
      move: ["tapdance", "floss", "airguitar", "robot", "cycling"]
    }
  ]
};

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
 * below), `sessions` how many focus sessions first. A room item with
 * `freeWith` is a floor's starter piece: owned with that floor, never sold
 * (its price says what it is worth); `light` marks decor that lights a room.
 */
export const catalogue = () => {
  const floors = levelPrices();
  const levelIds = new Set(houseLevels().map((level) => level.id));
  return [
    ...SKINS.map((skin) => ({
      kind: "skin",
      id: skin.id,
      name: skin.name,
      price: skinPrice(skin),
      earnedOnly: isEarnedOnly(skin)
    })),
    ...accessories().map((item) => ({ kind: "accessory", id: item.id, name: item.name, price: accessoryPrice(item), slot: item.slot })),
    ...roomItems().map((item) => {
      const freeWith = item.starter ? null : comesWith(item.id, levelIds);
      return {
        kind: "room",
        id: item.id,
        name: item.name,
        price: item.starter ? 0 : itemPrice(item),
        roomKind: item.kind,
        ...(castsLight(item) ? { light: true } : {}),
        ...(freeWith ? { freeWith } : {}),
        ...(item.nod ? { nod: item.nod } : {})
      };
    }),
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
