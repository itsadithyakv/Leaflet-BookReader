/** Typed boundary for raid-art.js: the raid field's sprites (drawn through base-art.js and games-art.js). */

/** Every raid sprite, by name: `raidperch`, `raidwall`, ... `raidunit` (the reader's scouts). */
export const RAID_SPRITES: Readonly<Record<string, unknown>>;

/** Each group's colours, light and dark, by its place: the trail's gold, then sky, rose and leaf. */
export const FLAG_COLOURS: ReadonlyArray<readonly [string, string]>;
