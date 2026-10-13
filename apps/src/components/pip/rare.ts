/**
 * Rare things open at a reader's level (pip/shop.js RARE_LEVELS). The level
 * itself is Rust's, from the seeds ever earned, and arrives on the overview;
 * Rust refuses a purchase below it. This is only what the shop says about it,
 * and it says little: "Level 8" on the tile, the rest in a tooltip.
 */

/** The reader's level as the overview has it; 1 where it has none (an older Rust side, the browser preview). */
export const readerLevel = (overview: { level?: { level: number } | null } | null | undefined) => {
  const level = Math.floor(Number(overview?.level?.level));
  return Number.isFinite(level) && level >= 1 ? level : 1;
};

export const levelLabel = (gate: number) => `Level ${gate}`;

/** The whole of it, for a tooltip. */
export const levelHint = (gate: number) => `Opens at level ${gate}. Seeds you earn count, spent or not.`;

/** Why a thing that opens at `gate` cannot be bought at `level`, or null when it can (or has no gate). */
export const levelLock = (gate: number | null | undefined, level: number) =>
  gate && level < gate ? { text: levelLabel(gate), hint: levelHint(gate) } : null;

/** The heading rare things are listed under in a shop tab. */
export const RARE_GROUP = "Rare";

/**
 * The order of a tab with rare things in it: everything else first, as it
 * was, then the rare ones by the level they open at (a ladder to look up),
 * whether owned or not.
 */
export const rareLast =
  <T extends { level?: number | null }>(otherwise: (a: T, b: T) => number) =>
  (a: T, b: T) => {
    const rareA = a.level ?? 0;
    const rareB = b.level ?? 0;
    if (!rareA && !rareB) return otherwise(a, b);
    if (!rareA || !rareB) return rareA ? 1 : -1;
    return rareA - rareB || otherwise(a, b);
  };
