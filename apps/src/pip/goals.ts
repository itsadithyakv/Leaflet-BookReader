/**
 * The first steps as the Pip tab shows them, and which rewards are new.
 *
 * Rust decides what is done and what it pays (pip/rewards.rs, from records
 * every device shares); this only lays it out: the starter chest and the
 * first steps as a checklist with the next one picked out, and, for the
 * celebrations, which rewards have come in since this device last showed
 * them. That last part is a preference of this device (what it has already
 * celebrated), never a claim: the seeds are in the balance either way.
 */
import { GOALS, SETS, STARTER_CHEST } from "./shop";
import type { ChestStatus, GoalStatus, SetStatus } from "../services/pipService";

/** One line of the checklist. */
export type GoalRow = {
  /** "chest", or the first step's id. */
  id: string;
  name: string;
  hint: string;
  seeds: number;
  done: boolean;
  /** The first not done: the one Pip suggests next. */
  next: boolean;
};

/** What the checklist is read from (a slice of the overview). */
export type GoalsInput = { goals: GoalStatus[]; chest: ChestStatus; sets?: SetStatus[] };

/**
 * The checklist: the first steps in the order Pip suggests them, with the
 * starter chest after the first (planting is quick, in the app; the first
 * focus session then opens the chest and waters the seed together). A step
 * Rust knows and the app does not (a newer build's) keeps its id for a name.
 */
export const goalRows = (input: GoalsInput | null | undefined): GoalRow[] => {
  if (!input) return [];
  const rows: GoalRow[] = input.goals.map((goal) => {
    const copy = GOALS.find((entry) => entry.id === goal.id);
    return { id: goal.id, name: copy?.name ?? goal.id, hint: copy?.hint ?? "", seeds: goal.seeds, done: goal.done, next: false };
  });
  if (input.chest.seeds > 0) {
    rows.splice(Math.min(1, rows.length), 0, {
      id: "chest",
      name: "Open the starter chest",
      hint: `Finish a focus session of ${input.chest.minutes || STARTER_CHEST.minutes} minutes or more.`,
      seeds: input.chest.seeds,
      done: input.chest.open,
      next: false
    });
  }
  const next = rows.find((row) => !row.done);
  if (next) next.next = true;
  return rows;
};

/** How far along the checklist is, and the seeds still to come from it. */
export const goalProgress = (rows: GoalRow[]) => ({
  done: rows.filter((row) => row.done).length,
  of: rows.length,
  earned: rows.filter((row) => row.done).reduce((sum, row) => sum + row.seeds, 0),
  left: rows.filter((row) => !row.done).reduce((sum, row) => sum + row.seeds, 0)
});

/** A reward that has come in: a first step, the chest, a set. */
export type RewardMoment = { key: string; kind: "goal" | "chest" | "set"; id: string; label: string; seeds: number };

/** Every reward earned so far, keyed ("goal:plant", "chest", "set:bookworm"). */
export const earnedRewards = (input: GoalsInput | null | undefined): RewardMoment[] => {
  if (!input) return [];
  const out: RewardMoment[] = [];
  for (const goal of input.goals) {
    if (goal.done) out.push({ key: `goal:${goal.id}`, kind: "goal", id: goal.id, label: GOALS.find((entry) => entry.id === goal.id)?.name ?? goal.id, seeds: goal.seeds });
  }
  // In the checklist's place: after the first step.
  if (input.chest.open && input.chest.seeds > 0) {
    const at = out.length > 0 && out[0].id === input.goals[0]?.id ? 1 : 0;
    out.splice(at, 0, { key: "chest", kind: "chest", id: "chest", label: "Starter chest", seeds: input.chest.seeds });
  }
  for (const set of input.sets ?? []) {
    if (set.done) out.push({ key: `set:${set.id}`, kind: "set", id: set.id, label: `${SETS.find((entry) => entry.id === set.id)?.name ?? set.id} set`, seeds: set.seeds });
  }
  return out;
};

/**
 * The rewards earned since `seen` (the keys this device has celebrated), in
 * the checklist's order. With nothing seen yet (this device's first look
 * since rewards arrived), everything earned is new: a reader who had done
 * it all before gets one "you've been busy" rather than nothing.
 */
export const newRewards = (seen: readonly string[] | null, input: GoalsInput | null | undefined): RewardMoment[] => {
  const known = new Set(seen ?? []);
  return earnedRewards(input).filter((reward) => !known.has(reward.key));
};

/** Seeds across some rewards. */
export const rewardSeeds = (rewards: readonly RewardMoment[]) => rewards.reduce((sum, reward) => sum + reward.seeds, 0);
