/**
 * The few words the raid screens use (the Magpie Lands, 2026-10-24): each kind of scout's name and picture, each
 * approach's short name, what a structure is called on a button, and each problem with a squad as a mark. Kept here
 * so the plan, the battle and the end card say the same thing the same way. No standing explanations: these are
 * names, and the marks' few words go behind a tooltip.
 */
import type { Approach } from "../../../../pip/base/approaches";
import type { ScoutKind, Structure } from "../../../../pip/base/battle";
import type { SquadProblem } from "../../../../pip/base/squad";

export const KIND_NAMES: Readonly<Record<ScoutKind, string>> = { sprout: "Scouts", slinger: "Slingers", mole: "Moles", bomber: "Puffcaps" };
export const KIND_ONE: Readonly<Record<ScoutKind, string>> = { sprout: "Scout", slinger: "Slinger", mole: "Mole", bomber: "Puffcap" };
/**
 * Each kind's picture: the raid's own scouts (raid-art.js `raidunit`), the same in the field, the planner and the
 * fight's chips, so a kind is known by the one picture wherever it is.
 */
export const KIND_ART: Readonly<Record<ScoutKind, { name: string; variant: number }>> = {
  sprout: { name: "raidunit", variant: 0 },
  slinger: { name: "raidunit", variant: 1 },
  mole: { name: "raidunit", variant: 2 },
  bomber: { name: "raidunit", variant: 3 }
};
/** In the order the planner lists them. */
export const KINDS: readonly ScoutKind[] = ["sprout", "slinger", "mole", "bomber"];

/**
 * An approach in a word: "Trail", "Ridge", "Hollow"; a trail by what lies on it where that is what it is called ("The
 * ford" is "Ford", "The thorn trail" "Thorns"), so a group's chip says what its path's tag says.
 */
export const approachShort = (approach: Pick<Approach, "kind"> & Partial<Pick<Approach, "hazard">> | undefined) =>
  !approach
    ? "?"
    : approach.kind === "trail" && approach.hazard === "ford"
      ? "Ford"
      : approach.kind === "trail" && approach.hazard === "hedge"
        ? "Thorns"
        : approach.kind[0].toUpperCase() + approach.kind.slice(1);

/** A structure as a button says it: "the nest", "a hoard", "the watch-crow's perch". */
export const structureName = (entry: Structure, king = false): string =>
  entry.kind === "nest"
    ? king
      ? "the King's roost"
      : entry.look
        ? `the ${entry.look.name}`
        : "the nest"
    : entry.look
      ? `the ${entry.look.name}`
      : entry.kind === "hoard"
        ? "a hoard"
        : entry.kind === "perch"
          ? entry.crow
            ? "the watch-crow's perch"
            : "a perch"
          : entry.kind === "wall"
            ? entry.gate === "main"
              ? "the stout gate"
              : entry.gate === "postern"
                ? "the weak gate"
                : "the wall"
            : "a building";

/** Each problem with a squad, as its mark's tooltip. */
export const PROBLEM_WORDS: Readonly<Record<SquadProblem, string>> = {
  room: "More than the hut has room for",
  kind: "The hut has not trained that kind yet",
  bombers: "More Puffcaps than the hut trains",
  approach: "No such way in",
  held: "Only one group can wait",
  empty: "Nobody in it",
  groups: "Four groups at most"
};
