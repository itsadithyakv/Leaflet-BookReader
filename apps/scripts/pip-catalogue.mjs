// Writes the two copies of the Pip shop's catalogue that live outside the app:
//
//   src-tauri/src/pip/catalogue.json  prices, which Rust checks every purchase
//                                     against (the webview never names a price)
//   ../server/src/pipParts.json       the parts the server accepts in a
//                                     reader's own-Pip avatar
//
// Both come from src/pip/shop.js, which reads the art modules, so a price or a
// new accessory changes in one place. The Vite build runs this on start (see
// vite.config.js), and writes only when something changed, so the Rust crate
// does not rebuild for nothing.
//
//   node scripts/pip-catalogue.mjs           regenerate
//   node scripts/pip-catalogue.mjs --check   exit 1 if either file is stale
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));

export const RUST_FILE = here("../src-tauri/src/pip/catalogue.json");
export const SERVER_FILE = here("../../server/src/pipParts.json");

/** Art modules that may add floors, wallpapers, floors and game sprites. Keep in step with src/pip/houseArt.ts. */
export const HOUSE_ART = ["house.js", "games-art.js", "games.js", "arcade.js"];

const SLOTS = new Set(["head", "face", "neck", "back", "hand"]);
const ID = /^[a-z][a-z0-9_-]{0,31}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const seedsOk = (value) => Number.isInteger(value) && value > 0;

/**
 * The rewards as Rust reads them (pip/rewards.rs), checked: every set piece
 * and wished-for thing is in the catalogue, so a typo cannot make a set
 * impossible to finish or a wish impossible to grant.
 */
const checkRewards = (shop, items) => {
  const has = (kind, id) => items.some((item) => item.kind === kind && item.id === id);
  const chest = shop.STARTER_CHEST;
  if (!seedsOk(chest.seeds) || !(chest.minutes > 0)) throw new Error("Pip catalogue: the starter chest needs seeds and minutes.");
  const goalIds = new Set();
  for (const goal of shop.GOALS) {
    if (!ID.test(goal.id) || goalIds.has(goal.id)) throw new Error(`Pip catalogue: goal ${goal.id} is not a valid, unique id.`);
    if (!seedsOk(goal.seeds)) throw new Error(`Pip catalogue: goal ${goal.id} pays ${goal.seeds}.`);
    goalIds.add(goal.id);
  }
  const setIds = new Set();
  for (const set of shop.SETS) {
    if (!ID.test(set.id) || setIds.has(set.id)) throw new Error(`Pip catalogue: set ${set.id} is not a valid, unique id.`);
    if (!seedsOk(set.seeds) || set.items.length < 2) throw new Error(`Pip catalogue: set ${set.id} needs pieces and a reward.`);
    for (const id of set.items) {
      if (!has(set.kind, id)) throw new Error(`Pip catalogue: set ${set.id} wants ${set.kind} ${id}, which is not in the catalogue.`);
    }
    setIds.add(set.id);
  }
  const wish = shop.WISH;
  if (!seedsOk(wish.seeds) || !(wish.mood > 0) || wish.eras.length === 0) throw new Error("Pip catalogue: the daily wish needs seeds, mood and a list.");
  wish.eras.forEach((era, index) => {
    if (!DAY.test(era.since) || (index > 0 && era.since <= wish.eras[index - 1].since)) {
      throw new Error(`Pip catalogue: wish era ${era.since} must be a date after the one before it.`);
    }
    for (const kind of ["treat", "plant", "room", "move"]) {
      for (const id of era[kind]) {
        const item = items.find((entry) => entry.kind === kind && entry.id === id);
        if (!item) throw new Error(`Pip catalogue: Pip wishes for ${kind} ${id}, which is not in the catalogue.`);
        // Snacks and packets are bought as they are used; the rest must be for sale.
        const buyable = kind === "treat" || kind === "plant" ? item.consumable : item.price > 0 && !item.freeWith && !item.earnedOnly;
        if (!buyable) throw new Error(`Pip catalogue: Pip wishes for ${kind} ${id}, which cannot be bought that way.`);
      }
    }
  });
  return {
    goals: shop.GOALS.map(({ id, seeds }) => ({ id, seeds })),
    chest: { seeds: chest.seeds, minutes: chest.minutes },
    sets: shop.SETS.map(({ id, kind, items: pieces, seeds, level }) => ({ id, kind, items: pieces, seeds, ...(level ? { level } : {}) })),
    wish: { seeds: wish.seeds, mood: wish.mood, eras: wish.eras }
  };
};

/** The catalogue as the two files hold it, validated. Throws on data that would break a purchase. */
export const buildCatalogue = async () => {
  const shop = await import(pathToFileURL(here("../src/pip/shop.js")).href);
  // The house and game art arrive as their own modules; the app finds them
  // with import.meta.glob (src/pip/houseArt.ts), this with a plain import.
  const home = await import(pathToFileURL(here("../src/pip/home.js")).href);
  const extras = [];
  for (const name of HOUSE_ART) {
    const file = here(`../src/pip/${name}`);
    if (existsSync(file)) extras.push(await import(pathToFileURL(file).href));
  }
  home.registerHouseArt(...extras);
  const { LIB } = await import(pathToFileURL(here("../src/pip/anims.js")).href);
  const items = shop.catalogue();

  const seen = new Set();
  const warnings = [];
  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) throw new Error(`Pip catalogue: ${key} is listed twice.`);
    seen.add(key);
    // Ids travel in avatar strings (`skin.move.a+b`), so they stay in a safe alphabet.
    if (!ID.test(item.id)) throw new Error(`Pip catalogue: ${key} is not a valid id (a-z, 0-9, _ and -).`);
    if (!Number.isInteger(item.price) || item.price < 0) throw new Error(`Pip catalogue: ${key} has price ${item.price}.`);
    if (item.kind === "accessory" && !SLOTS.has(item.slot)) throw new Error(`Pip catalogue: ${key} has slot ${item.slot}.`);
    const move = item.kind === "move" ? item.id : item.kind === "treat" ? item.move : null;
    if (move && !LIB.some((entry) => entry.id === move)) warnings.push(`${key} plays "${move}", which is not a move yet.`);
    if (item.freeWith && !items.some((other) => other.kind === "level" && other.id === item.freeWith)) {
      throw new Error(`Pip catalogue: ${key} comes with the floor "${item.freeWith}", which is not in the house.`);
    }
  }
  const rewards = checkRewards(shop, items);

  const rust = {
    note: "Generated by apps/scripts/pip-catalogue.mjs from apps/src/pip/shop.js. Do not edit.",
    items: items.map((item) => ({
      kind: item.kind,
      id: item.id,
      price: item.price,
      ...(item.earnedOnly ? { earnedOnly: true } : {}),
      ...(item.consumable ? { consumable: true } : {}),
      ...(item.kind === "accessory" ? { slot: item.slot } : {}),
      ...(item.kind === "treat" ? { mood: item.mood ?? 0 } : {}),
      ...(item.requires ? { requires: item.requires } : {}),
      ...(item.sessions ? { sessions: item.sessions } : {}),
      ...(item.kind === "plant" ? { water: item.water, yield: item.yield } : {}),
      ...(item.light ? { light: true } : {}),
      ...(item.freeWith ? { freeWith: item.freeWith } : {})
    })),
    ...rewards
  };

  const server = {
    note: "Generated by apps/scripts/pip-catalogue.mjs. The parts a reader's own Pip avatar may use.",
    skins: items.filter((item) => item.kind === "skin" && !item.earnedOnly).map((item) => item.id),
    moves: items.filter((item) => item.kind === "move").map((item) => item.id),
    accessories: Object.fromEntries(items.filter((item) => item.kind === "accessory").map((item) => [item.id, item.slot]))
  };

  return { rust, server, warnings };
};

// One item per line: readable diffs when a price changes.
const format = (value) => {
  const lines = Object.entries(value).map(([key, entry]) => {
    if (Array.isArray(entry) && entry.length > 0 && typeof entry[0] === "object") {
      return `  ${JSON.stringify(key)}: [\n${entry.map((item) => `    ${JSON.stringify(item)}`).join(",\n")}\n  ]`;
    }
    return `  ${JSON.stringify(key)}: ${JSON.stringify(entry)}`;
  });
  return `{\n${lines.join(",\n")}\n}\n`;
};

/** Regenerates both files (or, with `check`, only reports which are stale). Returns the stale paths. */
export const writeCatalogue = async ({ check = false, log = console } = {}) => {
  const { rust, server, warnings } = await buildCatalogue();
  warnings.forEach((warning) => log.warn(`pip catalogue: ${warning}`));
  const targets = [[RUST_FILE, format(rust)]];
  // The server is its own package; it may not be checked out next to the app.
  if (existsSync(here("../../server/src"))) {
    targets.push([SERVER_FILE, format(server)]);
  }
  const stale = [];
  for (const [file, text] of targets) {
    const current = existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
    if (current === text) continue;
    stale.push(file);
    if (!check) writeFileSync(file, text);
  }
  return stale;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  const stale = await writeCatalogue({ check });
  if (check && stale.length > 0) {
    console.error(`Stale Pip catalogue: ${stale.join(", ")}. Run node scripts/pip-catalogue.mjs.`);
    process.exit(1);
  }
  console.log(stale.length ? `pip catalogue: wrote ${stale.join(", ")}` : "pip catalogue: up to date");
}
