import { describe, expect, it } from "vitest";
import type { PersonCard } from "../../services/socialService";
import { joinPages, movedCount, stateAfter, stateOf, tapWants, weekLine } from "./people";

const card = (handle: string, extra: Partial<PersonCard> = {}): PersonCard => ({
  handle,
  displayName: null,
  pipSeed: handle,
  weekMinutes: 30,
  streak: 1,
  ...extra
});

describe("the People tab's rules", () => {
  it("shows what the page did last, else what the server said, else Follow", () => {
    expect(stateOf(card("ana"), {})).toBe("none");
    expect(stateOf(card("ana", { followState: "following" }), {})).toBe("following");
    expect(stateOf(card("ana", { followState: "following" }), { ana: "none" })).toBe("none");
    expect(stateAfter({ following: true })).toBe("following");
    expect(stateAfter({ following: false, requested: true })).toBe("requested");
    expect(stateAfter({ following: false })).toBe("none");
    // A tap follows from Follow, and undoes a follow or a request otherwise.
    expect([tapWants("none"), tapWants("requested"), tapWants("following")]).toEqual([true, false, false]);
  });

  it("joins pages without showing a reader twice", () => {
    expect(joinPages([card("a"), card("b")], [card("b"), card("c"), card("c")]).map((one) => one.handle)).toEqual(["a", "b", "c"]);
  });

  it("says this week's minutes, except for a locked card or one sent without them", () => {
    expect(weekLine(card("a", { weekMinutes: 75 }))).toBe("1h 15m this week");
    expect(weekLine(card("a", { locked: true }))).toBeNull();
    expect(weekLine(card("a", { weekMinutes: Number.NaN }))).toBeNull();
  });

  it("moves the Following count with a follow made or undone here", () => {
    expect(movedCount(5, "none", "following")).toBe(6);
    expect(movedCount(5, "following", "none")).toBe(4);
    expect(movedCount(5, "none", "requested")).toBe(5);
    expect(movedCount(0, "following", "none")).toBe(0);
    expect(movedCount(null, "none", "following")).toBeNull();
  });
});
