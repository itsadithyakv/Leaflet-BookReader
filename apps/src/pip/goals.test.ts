import { describe, expect, it } from "vitest";
import { earnedRewards, goalProgress, goalRows, newRewards, rewardSeeds, type GoalsInput } from "./goals";
import { GOALS, SETS, STARTER_CHEST } from "./shop";

/** The overview's rewards for a reader who has done `done`. */
const input = (done: string[] = [], chestOpen = false, setsDone: string[] = []): GoalsInput => ({
  goals: GOALS.map((goal) => ({ id: goal.id, done: done.includes(goal.id), seeds: goal.seeds })),
  chest: { open: chestOpen, seeds: STARTER_CHEST.seeds, minutes: STARTER_CHEST.minutes },
  sets: SETS.map((set) => ({ id: set.id, kind: set.kind, have: 0, of: set.items.length, done: setsDone.includes(set.id), seeds: set.seeds, level: set.level ?? null }))
});

describe("the first steps checklist", () => {
  it("lists the steps in Pip's order, the chest after the first, the first one next", () => {
    const rows = goalRows(input());
    const [first, ...rest] = GOALS.map((goal) => goal.id);
    expect(rows.map((row) => row.id)).toEqual([first, "chest", ...rest]);
    expect(rows.filter((row) => row.next).map((row) => row.id)).toEqual([first]);
    expect(rows[1].hint).toContain(`${STARTER_CHEST.minutes} minutes`);
  });

  it("picks out the first step not yet done, whatever order they were done in", () => {
    const rows = goalRows(input(["plant", "read", "hat"], true));
    expect(rows.find((row) => row.next)?.id).toBe("water");
    expect(rows.filter((row) => row.done).map((row) => row.id)).toEqual(["plant", "chest", "read", "hat"]);
    expect(goalRows(input(["plant"])).find((row) => row.next)?.id).toBe("chest");
  });

  it("has nothing next once everything is done", () => {
    const rows = goalRows(input(GOALS.map((goal) => goal.id), true));
    expect(rows.some((row) => row.next)).toBe(false);
    const progress = goalProgress(rows);
    expect(progress.done).toBe(progress.of);
    expect(progress.left).toBe(0);
    expect(progress.earned).toBe(STARTER_CHEST.seeds + GOALS.reduce((sum, goal) => sum + goal.seeds, 0));
  });

  it("counts what is left to earn", () => {
    const progress = goalProgress(goalRows(input(["plant"])));
    expect(progress.done).toBe(1);
    expect(progress.left).toBe(STARTER_CHEST.seeds + GOALS.filter((goal) => goal.id !== "plant").reduce((sum, goal) => sum + goal.seeds, 0));
  });

  it("keeps a step it does not know (a newer build's) under its id", () => {
    const rows = goalRows({ ...input(), goals: [{ id: "moonshot", done: false, seeds: 5 }] });
    expect(rows.find((row) => row.id === "moonshot")?.name).toBe("moonshot");
  });

  it("is empty before the overview arrives", () => {
    expect(goalRows(null)).toEqual([]);
  });
});

describe("rewards to celebrate", () => {
  it("are the ones earned since this device last celebrated, in the checklist's order", () => {
    const before = earnedRewards(input(["plant"])).map((reward) => reward.key);
    const fresh = newRewards(before, input(["plant", "water"], true));
    expect(fresh.map((reward) => reward.key)).toEqual(["chest", "goal:water"]);
    expect(rewardSeeds(fresh)).toBe(STARTER_CHEST.seeds + (GOALS.find((goal) => goal.id === "water")?.seeds ?? 0));
  });

  it("include a finished set, by its name", () => {
    const fresh = newRewards([], input([], false, ["bookworm"]));
    expect(fresh).toEqual([{ key: "set:bookworm", kind: "set", id: "bookworm", label: "Bookworm set", seeds: 20 }]);
  });

  it("are everything earned on a device's first look", () => {
    expect(newRewards(null, input(["plant", "pick"], true)).map((reward) => reward.key)).toEqual(["goal:plant", "chest", "goal:pick"]);
    expect(newRewards(null, input([], true)).map((reward) => reward.key)).toEqual(["chest"]);
    expect(newRewards(null, input())).toEqual([]);
  });

  it("never repeat once seen", () => {
    const all = input(GOALS.map((goal) => goal.id), true, ["royal"]);
    expect(newRewards(earnedRewards(all).map((reward) => reward.key), all)).toEqual([]);
  });
});
