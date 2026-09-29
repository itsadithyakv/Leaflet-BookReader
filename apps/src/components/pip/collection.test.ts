import { describe, expect, it } from "vitest";
import { isComplete, tally, tallyLabel, tallyText } from "./collection";

const things = [
  { id: "cookie", owned: false, snack: true },
  { id: "duck", owned: true, snack: false },
  { id: "ball", owned: false, snack: false },
  { id: "kite", owned: true, snack: false }
];

describe("collection counters", () => {
  it("counts what is Pip's out of what there is", () => {
    expect(tally(things, (thing) => thing.owned)).toEqual({ owned: 2, total: 4 });
  });

  it("leaves out what is bought each time", () => {
    const toys = tally(things, (thing) => thing.owned, (thing) => !thing.snack);
    expect(toys).toEqual({ owned: 2, total: 3 });
    expect(tallyText(toys)).toBe("2/3");
    expect(tallyLabel(toys)).toBe("2 of 3 collected");
  });

  it("says when a set is complete", () => {
    const all = tally(things, () => true);
    expect(isComplete(all)).toBe(true);
    expect(tallyLabel(all)).toBe("all 4 collected");
    expect(isComplete({ owned: 0, total: 0 })).toBe(false);
  });
});
