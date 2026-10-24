/**
 * A stronghold's quirk (the raids plan, 2026-10-24): the one thing about it
 * that makes it a small puzzle, and the one thing that beats it.
 *
 * Every stronghold has exactly one, and always the same one, so a reader who
 * has lost to it once knows what to bring the next time. The early ones are
 * the ones the hut's first kinds can answer: the thorn hedge waits for the
 * moles (hut level 4), the fog for the slingers (level 2), and the pits for
 * a party with something in it besides sprouts (level 2), since a sprout
 * scrambles out of a pit. A camp met on the road has one by its
 * seed; a friend's camp has none (its own constructs are its quirk).
 *
 * This is the table and the words. What each one does in the fight is in
 * `battle.ts` (the quirk's figures are there, beside the rest), and where it
 * lies on the field is in `approaches.ts`.
 */
import type { Feat } from "./feats";

export type Quirk = "hedge" | "crow" | "ford" | "fog" | "gate" | "pits";
export const QUIRK_IDS: readonly Quirk[] = ["hedge", "crow", "ford", "fog", "gate", "pits"];

export type QuirkInfo = {
  name: string;
  /** What it does, in a few words. */
  does: string;
  /** What beats it, in a few words. */
  beats: string;
  /** The stronghold's third star. */
  feat: Feat;
};

export const QUIRKS: Readonly<Record<Quirk, QuirkInfo>> = {
  hedge: { name: "Thorn hedge", does: "The trail runs through thorns: slow, and they cut", beats: "Moles go under it", feat: "thorns" },
  crow: { name: "Watch-crow", does: "With a third of its camp down, it calls a second flight", beats: "Silence its perch first", feat: "crow" },
  ford: { name: "Ford", does: "The trail crosses water: slow for all but moles", beats: "Send moles that way, or go round", feat: "bell" },
  fog: { name: "Fog", does: "The perches see less far, and peck hard up close", beats: "Slingers walk right up", feat: "perches" },
  gate: { name: "Second gate", does: "A wall end to end, a stout gate and a weak one", beats: "Split the force, and use the weak gate", feat: "gate" },
  pits: { name: "Pitfalls", does: "Hidden holes on the trail take whoever is on them; a sprout scrambles out", beats: "Sprouts first to spring them", feat: "pits" }
};

/**
 * The ladder's quirks, stronghold by stronghold, for the five regions (three
 * each, the third a lord's keep). Each region's are ones its hut can answer:
 * region one has sprouts alone, so a ford to go round, a crow to rally at and
 * a second gate to find the weak one of; the hedge comes with the moles.
 */
const LADDER: readonly Quirk[] = [
  // The Twig Nest woods (hut 1: sprouts)
  "ford",
  "crow",
  "gate",
  // Bramble Roost (hut 2: slingers)
  "fog",
  "gate",
  "pits",
  // The Tin Hoard hills (hut 3: Puffcaps)
  "crow",
  "ford",
  "pits",
  // Crow's Corner (hut 4: moles)
  "hedge",
  "fog",
  "crow",
  // The Old Rookery (hut 5)
  "hedge",
  "pits",
  "ford"
];
/** Past the fifteenth, the Far Rookeries go round them all, so each comes back every six. */
const FAR: readonly Quirk[] = ["gate", "hedge", "crow", "fog", "pits", "ford"];
/** The Magpie King's roost: a stone wall end to end, and two gates in it. */
export const KING_QUIRK: Quirk = "gate";

/** A raid's quirk, from its plan (`rules.ts` `RaidPlan`): the King's, a stronghold's (a replay's too), or a road camp's. */
export const quirkOfPlan = (plan: { kind: string; n: number; seed: number }): Quirk | null => quirkOf(plan.n, plan.kind === "king", plan.seed);

/**
 * A camp's quirk: a stronghold's by its place on the ladder (seed 0), the
 * King's, or a road camp's by its seed. Null for nothing (no camp yet).
 */
export const quirkOf = (n: number, king: boolean, seed = 0): Quirk | null => {
  if (king) return KING_QUIRK;
  const at = Math.max(0, Math.floor(n));
  if (seed === 0) return at < LADDER.length ? LADDER[at] : FAR[(at - LADDER.length) % FAR.length];
  // A camp on the road: any of them, by its seed, but no second gate before a camp is big enough to be walled.
  const among = at >= 4 ? QUIRK_IDS : QUIRK_IDS.filter((quirk) => quirk !== "gate");
  return among[(Math.imul(seed >>> 0, 2654435761) >>> 0) % among.length];
};
