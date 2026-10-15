import { describe, expect, it } from "vitest";
import { HOLD_MIN_MS, HOLD_SLACK_PX, selectionIsAccidental, type Press } from "./touchSelect";

const press = (over: Partial<Press> = {}): Press => ({ at: 1000, pointerType: "touch", top: 500, left: 0, ...over });

describe("a selection under a finger", () => {
  it("is the reader's after a hold on a still page", () => {
    expect(selectionIsAccidental(press(), 1000 + 650, { top: 500, left: 0 })).toBe(false);
    expect(selectionIsAccidental(press(), 1000 + 650, { top: 500 + HOLD_SLACK_PX, left: 0 })).toBe(false);
  });

  it("is let go when the page scrolled under the finger", () => {
    expect(selectionIsAccidental(press(), 1000 + 650, { top: 500 + 240, left: 0 })).toBe(true);
    expect(selectionIsAccidental(press(), 1000 + 650, { top: 500 - 90, left: 0 })).toBe(true);
  });

  it("is let go when a swipe turned the page", () => {
    expect(selectionIsAccidental(press({ left: 0 }), 1000 + 900, { top: 500, left: 360 })).toBe(true);
  });

  it("is let go when it came sooner than a hold can make one", () => {
    expect(selectionIsAccidental(press(), 1000 + HOLD_MIN_MS - 1, { top: 500, left: 0 })).toBe(true);
  });

  it("is never judged after a mouse, a pen, no press, or a press long past", () => {
    expect(selectionIsAccidental(press({ pointerType: "mouse" }), 1100, { top: 900, left: 0 })).toBe(false);
    expect(selectionIsAccidental(press({ pointerType: "pen" }), 1100, { top: 900, left: 0 })).toBe(false);
    expect(selectionIsAccidental(null, 1100, { top: 900, left: 0 })).toBe(false);
    expect(selectionIsAccidental(press(), 1000 + 60_000, { top: 900, left: 0 })).toBe(false);
  });
});
