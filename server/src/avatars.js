import { readFileSync } from "node:fs";

/**
 * A reader's avatar: Pip, in a skin, doing a signature move, written
 * `skin.move` (e.g. `wizard.magic`), optionally wearing accessories as a third
 * part joined by `+` (`robot.moonwalk.tophat+scarf`).
 *
 * Two sources feed it:
 * - The signup catalogue (`AVATAR_IDS` below; names and art in
 *   `apps/src/pip/avatars.ts`). Keep the two lists in step;
 *   `test/avatars.test.js` fails when they drift.
 * - The reader's own Pip from the app's Pip tab: any variant, signature move
 *   and outfit from the shop. Those parts come from `pipParts.json`, generated
 *   from the app's shop catalogue by `apps/scripts/pip-catalogue.mjs`.
 *
 * Every part is checked against its own allowlist, so nothing outside the art
 * can be stored or shown. It stays cosmetic: the server does not check that
 * the reader bought what their Pip wears (that is the app's business, and
 * lying about it wins nothing). Earned-only skins (Champ, Golden, Prism) are
 * in neither source, so an avatar never passes for an achievement.
 */

export const AVATAR_IDS = new Set([
  "sprout.read",
  "nightowl.booknap",
  "earlybird.sunbathe",
  "bookworm.speedread",
  "wizard.magic",
  "detective.idea",
  "astronaut.floatnap",
  "cyclist.cycling",
  "frost.tree",
  "sakura.smitten",
  "cactus.boxing",
  "ink.kick",
  "ghost.ghost",
  "classic.robot",
  "autumn.surf",
  "sprout.disco",
  "bookworm.hydrate",
  "earlybird.jog",
  "autumn.sleep",
  "nightowl.airguitar",
  "sakura.cheer"
]);

export const PIP_PARTS = JSON.parse(readFileSync(new URL("./pipParts.json", import.meta.url), "utf8"));

/** Most accessories worn at once: one per slot (head, face, neck, back, hand). */
export const MAX_OUTFIT = 5;
const PART = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_LENGTH = 200;

/**
 * Builds the checker from the parts on offer. Exported so the tests can check
 * the rules against a fixed set of parts, whatever the art currently holds.
 */
export const avatarRules = (parts) => {
  const curated = [...AVATAR_IDS].map((id) => id.split("."));
  const skins = new Set([...curated.map(([skin]) => skin), ...parts.skins]);
  const moves = new Set([...curated.map(([, move]) => move), ...parts.moves]);
  const accessories = new Map(Object.entries(parts.accessories ?? {}));

  /** `{ skin, move, outfit }` for a valid avatar, else null. */
  const parse = (value) => {
    if (typeof value !== "string" || value.length > MAX_LENGTH) {
      return null;
    }
    const pieces = value.split(".");
    if (pieces.length < 2 || pieces.length > 3) {
      return null;
    }
    const [skin, move, worn] = pieces;
    if (!PART.test(skin) || !PART.test(move) || !skins.has(skin) || !moves.has(move)) {
      return null;
    }
    if (worn === undefined) {
      return { skin, move, outfit: [] };
    }
    const outfit = worn.split("+");
    if (outfit.length > MAX_OUTFIT) {
      return null;
    }
    const slots = new Set();
    for (const id of outfit) {
      // An unknown id, an empty piece (`a++b`, a trailing `.`), or two things
      // in one slot (which also rules out wearing one thing twice).
      if (!PART.test(id) || !accessories.has(id) || slots.has(accessories.get(id))) {
        return null;
      }
      slots.add(accessories.get(id));
    }
    return { skin, move, outfit };
  };

  return { parse, skins, moves, accessories };
};

const rules = avatarRules(PIP_PARTS);

export const parseAvatar = rules.parse;

export const isAvatar = (value) => rules.parse(value) !== null;

/** A stored avatar as clients see it: a valid value, or null (the app falls back to the handle's skin). */
export const avatarView = (value) => (isAvatar(value) ? value : null);
