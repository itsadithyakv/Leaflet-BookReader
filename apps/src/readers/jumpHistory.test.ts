import { describe, expect, it } from "vitest";
import { JUMP_LIMIT, NO_JUMPS, noteJump, stepBack, stepForward } from "./jumpHistory";

describe("back to where you were", () => {
  it("remembers the line a jump left, and returns to it", () => {
    const jumped = noteJump(NO_JUMPS, "cfi-a");
    expect(jumped.back).toEqual(["cfi-a"]);
    const back = stepBack(jumped, "cfi-footnote");
    expect(back?.target).toBe("cfi-a");
    expect(back?.history.back).toEqual([]);
    // Going back is not a new place to come back from: it is what forward returns to.
    expect(back?.history.forward).toEqual(["cfi-footnote"]);
  });

  it("goes forward again, and back once more, to the exact lines", () => {
    const back = stepBack(noteJump(NO_JUMPS, "a"), "note");
    const forward = stepForward(back!.history, "a");
    expect(forward?.target).toBe("note");
    expect(forward?.history).toEqual({ back: ["a"], forward: [] });
    expect(stepBack(forward!.history, "note")?.target).toBe("a");
  });

  it("returns through several jumps in order, latest first", () => {
    let history = NO_JUMPS;
    for (const place of ["a", "b", "c"]) {
      history = noteJump(history, place);
    }
    const first = stepBack(history, "d");
    const second = stepBack(first!.history, first!.target);
    const third = stepBack(second!.history, second!.target);
    expect([first?.target, second?.target, third?.target]).toEqual(["c", "b", "a"]);
    expect(stepBack(third!.history, "a")).toBeNull();
    expect(third?.history.forward).toEqual(["d", "c", "b"]);
  });

  it("lets go of what lay forward when a new jump is made", () => {
    const back = stepBack(noteJump(NO_JUMPS, "a"), "note");
    const jumped = noteJump(back!.history, "a2");
    expect(jumped).toEqual({ back: ["a2"], forward: [] });
    expect(stepForward(jumped, "x")).toBeNull();
  });

  it("keeps a short stack: the oldest places go first", () => {
    let history = NO_JUMPS;
    for (let index = 0; index < JUMP_LIMIT + 5; index += 1) {
      history = noteJump(history, `place-${index}`);
    }
    expect(history.back).toHaveLength(JUMP_LIMIT);
    expect(history.back[0]).toBe("place-5");
    expect(history.back[JUMP_LIMIT - 1]).toBe(`place-${JUMP_LIMIT + 4}`);
  });

  it("adds nothing for a place it does not know, or the same line twice", () => {
    expect(noteJump(NO_JUMPS, null)).toBe(NO_JUMPS);
    const once = noteJump(NO_JUMPS, "a");
    expect(noteJump(once, "a").back).toEqual(["a"]);
    // Back with nowhere known to return forward to still goes back.
    const back = stepBack(once, null);
    expect(back?.target).toBe("a");
    expect(back?.history.forward).toEqual([]);
  });

  it("has nowhere to go with no jumps made", () => {
    expect(stepBack(NO_JUMPS, "a")).toBeNull();
    expect(stepForward(NO_JUMPS, "a")).toBeNull();
  });
});
