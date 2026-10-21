import { describe, expect, it } from "vitest";
import { WELCOMED, newBase, readBase, type BaseState } from "../../../../pip/base/rules";
import { learnt, noTips } from "../../../../pip/base/tips";
import { MAP_COACH, coachDue, coachSteps } from "./mapCoach";

const DAY = "2026-10-19";
/** A camp from before 1.5.8: welcomed long ago, Pip's tour over. */
const kept = (): BaseState => ({ ...newBase(1000, DAY), welcome: WELCOMED });

describe("the Hollow's three pointers", () => {
  it("are drag, tap a building, and the acorns, the first only where the picture can be moved", () => {
    expect(coachSteps(true).map((step) => step.id)).toEqual(["drag", "tap", "acorns"]);
    expect(coachSteps(false).map((step) => step.id)).toEqual(["tap", "acorns"]);
    expect(coachSteps(true)[0].text).toBe("Drag to look around");
  });

  it("come once to a camp from before, and never again once seen, on any device the camp goes to", () => {
    const camp = kept();
    expect(coachDue(camp)).toBe(true);
    const seen = learnt(camp, MAP_COACH);
    expect(seen.taught).toContain(MAP_COACH);
    expect(coachDue(seen)).toBe(false);
    // Kept with the camp: read back elsewhere, still seen.
    expect(coachDue(readBase(JSON.parse(JSON.stringify(seen))))).toBe(false);
    // Seen twice is seen once.
    expect(learnt(seen, MAP_COACH)).toBe(seen);
  });

  it("wait while Pip's guided first visit is on, and stay away from a camp that asked for no tips", () => {
    const fresh = newBase(1000, DAY);
    const touring = { ...fresh, welcome: { ...fresh.welcome, given: true, tutorial: { ...fresh.welcome.tutorial, done: false } } };
    expect(coachDue(touring)).toBe(false);
    expect(coachDue(noTips(kept()))).toBe(false);
    expect(coachDue(null)).toBe(false);
  });
});
