import { describe, expect, it } from "vitest";
import { tapPoint } from "./Coach";
import { letThrough } from "./geometry";

/** A key on the screen, as the tour's guard sees what a click landed on. */
const key = { getBoundingClientRect: () => ({ left: 300, top: 200, width: 80, height: 32, right: 380, bottom: 232 }) };
const hole = { left: 296, top: 196, width: 88, height: 40 };

describe("where the tour takes a tap to be", () => {
  it("takes a finger's or a pointer's where it was", () => {
    expect(tapPoint({ type: "pointerdown", clientX: 12, clientY: 40, target: key } as unknown as Event)).toEqual({ x: 12, y: 40 });
    expect(tapPoint({ type: "click", detail: 1, clientX: 320, clientY: 210, target: key } as unknown as Event)).toEqual({ x: 320, y: 210 });
  });

  it("takes a key's own click (Enter, Space, a screen reader) where the key is, not at the window's corner", () => {
    // Chromium's click from the keyboard says 0, 0: a key in the hole was kept from the page for it.
    const point = tapPoint({ type: "click", detail: 0, clientX: 0, clientY: 0, target: key } as unknown as Event);
    expect(point).toEqual({ x: 340, y: 216 });
    expect(letThrough(point!, [hole])).toBe(true);
  });
});
