import { describe, expect, it } from "vitest";
import { GOAL_KEY, canBeGoal, goalProgress, readGoal, stepGoal, writeGoal, type PinnedGoal } from "./goal";

const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values
  };
};

describe("the pinned goal's progress", () => {
  it("counts the seeds towards the price", () => {
    expect(goalProgress(200, 50)).toEqual({ have: 50, price: 200, fraction: 0.25, short: 150, ready: false });
  });

  it("is full, and ready, once the seeds are there, however many more there are", () => {
    expect(goalProgress(200, 200)).toMatchObject({ have: 200, fraction: 1, short: 0, ready: true });
    expect(goalProgress(200, 640)).toMatchObject({ have: 200, fraction: 1, short: 0, ready: true });
  });

  it("never shows less than nothing", () => {
    expect(goalProgress(120, -5)).toMatchObject({ have: 0, fraction: 0, short: 125, ready: false });
  });
});

describe("when the goal is cheered for", () => {
  const hat: PinnedGoal = { kind: "accessory", id: "tophat" };

  it("cheers once when it comes within reach", () => {
    const first = stepGoal(hat, { owned: false, ready: true });
    expect(first.event).toBe("affordable");
    expect(first.goal).toEqual({ ...hat, cheered: true });
    const again = stepGoal(first.goal!, { owned: false, ready: true });
    expect(again.event).toBeNull();
    expect(again.goal).toBe(first.goal);
  });

  it("can cheer again after the seeds were spent elsewhere and came back", () => {
    const slipped = stepGoal({ ...hat, cheered: true }, { owned: false, ready: false });
    expect(slipped).toEqual({ goal: { ...hat, cheered: false }, event: null });
    expect(stepGoal(slipped.goal!, { owned: false, ready: true }).event).toBe("affordable");
  });

  it("is done, and unpinned, once it is bought", () => {
    expect(stepGoal({ ...hat, cheered: true }, { owned: true, ready: true })).toEqual({ goal: null, event: "reached" });
  });

  it("does nothing while it is still being saved for", () => {
    expect(stepGoal(hat, { owned: false, ready: false })).toEqual({ goal: hat, event: null });
  });
});

describe("what can be a goal", () => {
  it("is something still to buy once", () => {
    expect(canBeGoal({ owned: false, price: 200 })).toBe(true);
    expect(canBeGoal({ owned: true, price: 200 })).toBe(false);
    // A snack is bought every time it is given: nothing to save for.
    expect(canBeGoal({ owned: false, consumable: true, price: 8 })).toBe(false);
    expect(canBeGoal({ owned: false, price: 0 })).toBe(false);
  });
});

describe("remembering the goal", () => {
  it("keeps it between visits", () => {
    const store = memory();
    writeGoal(store, { kind: "level", id: "kitchen", cheered: true });
    expect(readGoal(store)).toEqual({ kind: "level", id: "kitchen", cheered: true });
    writeGoal(store, null);
    expect(store.values.has(GOAL_KEY)).toBe(false);
    expect(readGoal(store)).toBeNull();
  });

  it("ignores something unreadable rather than failing", () => {
    const store = memory();
    store.setItem(GOAL_KEY, "{not json");
    expect(readGoal(store)).toBeNull();
    store.setItem(GOAL_KEY, JSON.stringify({ kind: "spaceship", id: "x" }));
    expect(readGoal(store)).toBeNull();
    expect(readGoal(null)).toBeNull();
  });

  it("carries on when storage refuses", () => {
    const refusing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      }
    };
    expect(() => writeGoal(refusing, { kind: "move", id: "floss" })).not.toThrow();
    expect(readGoal(refusing)).toBeNull();
  });
});
