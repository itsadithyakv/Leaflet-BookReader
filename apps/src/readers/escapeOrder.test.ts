import { describe, expect, it } from "vitest";
import { ESCAPE_ORDER, escapeTarget, type EscapeLayer } from "./escapeOrder";

/** Presses Escape until the book is left, and says what each press closed. */
const presses = (open: EscapeLayer[]) => {
  const state = Object.fromEntries(open.map((layer) => [layer, true])) as Partial<Record<EscapeLayer, boolean>>;
  const closed: string[] = [];
  for (let press = 0; press < 30; press += 1) {
    const target = escapeTarget(state);
    closed.push(target);
    if (target === "exit") {
      break;
    }
    state[target] = false;
  }
  return closed;
};

describe("what Escape closes", () => {
  it("leaves the book only when nothing is open", () => {
    expect(escapeTarget({})).toBe("exit");
    expect(escapeTarget({ search: false, selection: false })).toBe("exit");
  });

  it("closes an open panel, not the book", () => {
    for (const layer of ["search", "notesPanel", "chapters", "typePanel", "moreMenu", "startDialog"] as const) {
      expect(presses([layer])).toEqual([layer, "exit"]);
    }
  });

  it("closes the panel, then lets the selection go, then leaves", () => {
    expect(presses(["selection", "search"])).toEqual(["search", "selection", "exit"]);
    expect(presses(["chapters", "selection"])).toEqual(["chapters", "selection", "exit"]);
  });

  it("closes the look-up card before the selection it belongs to", () => {
    expect(presses(["selection", "lookup"])).toEqual(["lookup", "selection", "exit"]);
    expect(presses(["selection", "character"])).toEqual(["character", "selection", "exit"]);
  });

  it("closes what is over everything first", () => {
    expect(presses(["search", "picture", "selection"])).toEqual(["picture", "search", "selection", "exit"]);
    expect(presses(["note", "shortcuts"])).toEqual(["shortcuts", "note", "exit"]);
    expect(presses(["tour", "chapters"])).toEqual(["tour", "chapters", "exit"]);
  });

  it("lets go of the progress bar's handle before closing anything else", () => {
    expect(presses(["note", "seek"])).toEqual(["seek", "note", "exit"]);
  });

  it("stops what is playing before leaving, after everything over the text is gone", () => {
    expect(presses(["playing"])).toEqual(["playing", "exit"]);
    expect(presses(["speedRead", "playing"])).toEqual(["speedRead", "playing", "exit"]);
    expect(presses(["playing", "selection", "notesPanel"])).toEqual(["notesPanel", "selection", "playing", "exit"]);
  });

  it("has every layer in its order once", () => {
    expect(new Set(ESCAPE_ORDER).size).toBe(ESCAPE_ORDER.length);
    expect(presses([...ESCAPE_ORDER])).toEqual([...ESCAPE_ORDER, "exit"]);
  });
});
