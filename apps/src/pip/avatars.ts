/**
 * The avatars a reader picks when they make an account: Pip in one skin,
 * doing one signature move, with a small personality to go with it.
 *
 * An avatar is stored and sent as `skin.move` (e.g. `wizard.magic`); that
 * string is the whole id. The server keeps its own copy of the ids
 * (`server/src/avatars.js`) and refuses anything else; its tests fail when the
 * two lists drift, so add or remove an avatar in both places.
 *
 * Earned-only skins (Champ, Golden, Prism) stay achievements and are never
 * offered here. Moves are ones that loop in place and read at 40px.
 */

import { ACCESSORIES, LIB, SKINS } from "./index";
import { visibleOutfit } from "./shop";

export type Avatar = {
  /** `skin.move`, as stored on the account. */
  id: string;
  skin: string;
  move: string;
  name: string;
  /** A few words of personality, shown under the name. */
  blurb: string;
};

const entry = (id: string, name: string, blurb: string): Avatar => {
  const [skin, move] = id.split(".");
  return { id, skin, move, name, blurb };
};

export const AVATARS: Avatar[] = [
  entry("sprout.read", "Page Turner", "one more chapter, always"),
  entry("nightowl.booknap", "Night Owl", "reads past midnight"),
  entry("earlybird.sunbathe", "Early Bird", "first light, first page"),
  entry("bookworm.speedread", "Bookworm", "a book a day, minimum"),
  entry("wizard.magic", "Spellbinder", "pulls stories out of hats"),
  entry("detective.idea", "Sleuth", "solved it by chapter three"),
  entry("astronaut.floatnap", "Space Cadet", "drifts off mid-galaxy"),
  entry("cyclist.cycling", "Tour de Page", "pedals through the pages"),
  entry("frost.tree", "Cool Head", "calm as fresh snow"),
  entry("sakura.smitten", "Hopeless Romantic", "swoons at every ending"),
  entry("cactus.boxing", "Prickly Critic", "fights for every star"),
  entry("ink.kick", "Noir", "smooth, dark, a little dramatic"),
  entry("ghost.ghost", "Boo", "reads by candlelight"),
  entry("classic.robot", "Cartridge", "an 8-bit bookworm"),
  entry("autumn.surf", "Binge Surfer", "rides the next-chapter wave"),
  entry("sprout.disco", "Party Animal", "celebrates every chapter"),
  entry("bookworm.hydrate", "Scholar", "water first, then words"),
  entry("earlybird.jog", "Morning Runner", "laps before pages"),
  entry("autumn.sleep", "Cozy Maple", "blanket, tea, nap"),
  entry("nightowl.airguitar", "Headbanger", "reads with the volume up"),
  entry("sakura.cheer", "Cheerleader", "roots for every reader")
];

const BY_ID = new Map(AVATARS.map((avatar) => [avatar.id, avatar]));

/** The catalogue entry for a stored id, or null for none or one this build does not know. */
export const avatarById = (id: string | null | undefined): Avatar | null => (id ? BY_ID.get(id) ?? null : null);

/**
 * What an avatar shows: a skin, a move, and any accessories worn.
 *
 * Besides the catalogue above, a reader can wear their own Pip from the Pip
 * tab: `variant.signature`, plus `.acc+acc` when it wears accessories (e.g.
 * `robot.moonwalk.tophat+scarf`). The server checks each part against its own
 * allowlist (`server/src/avatars.js`). Builds from before the Pip tab look
 * these up in the catalogue, find nothing, and fall back to the handle's skin,
 * so the extension is safe to roll out one side at a time.
 */
export type AvatarLook = { skin: string; move: string; outfit: string[] };

const SKIN_IDS = new Set(SKINS.map((skin) => skin.id));
const MOVE_IDS = new Set(LIB.map((move) => move.id));

/** The look for a stored avatar, or null for none or one this build cannot draw. */
export const parseAvatar = (id: string | null | undefined): AvatarLook | null => {
  const picked = avatarById(id);
  if (picked) {
    return { skin: picked.skin, move: picked.move, outfit: [] };
  }
  const parts = id?.split(".") ?? [];
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const [skin, move, worn] = parts;
  if (!SKIN_IDS.has(skin) || !MOVE_IDS.has(move)) {
    return null;
  }
  const known = new Set(ACCESSORIES.map((item) => item.id));
  // An accessory this build does not have yet is left off rather than
  // throwing the whole avatar away.
  const outfit = worn ? worn.split("+").filter((item) => known.has(item)) : [];
  return { skin, move, outfit };
};

/** The avatar value for the reader's own Pip: only what actually shows on the variant. */
export const ownPipAvatar = (variant: string, signature: string, outfit: readonly string[]) => {
  const worn = visibleOutfit(variant, outfit);
  return worn.length > 0 ? `${variant}.${signature}.${worn.join("+")}` : `${variant}.${signature}`;
};

/** A random avatar, to preselect in the signup form. */
export const randomAvatar = () => AVATARS[Math.floor(Math.random() * AVATARS.length)];
