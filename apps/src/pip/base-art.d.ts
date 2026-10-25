/** Typed boundary for base-art.js: the Hollow's sprites (drawn through games-art.js), and the raid ground's grass. */

/** The magpies' ground in each season (summer to spring): its grass (top, bottom, fleck) and its tufts (light, dark). */
export const BATTLE_GRASS: ReadonlyArray<{ grass: readonly [string, string, string]; tuft: readonly [string, string] }>;

/** Every sprite of the Hollow, by name, for games-art.js. */
export const BASE_SPRITES: Readonly<Record<string, unknown>>;
