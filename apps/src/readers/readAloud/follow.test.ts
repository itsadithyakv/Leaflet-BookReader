import { describe, expect, it } from "vitest";
import { BRING_TO, HANDS_ON_MS, movedByReader, OWN_MOVE_MS, pageMove, scrollTarget } from "./follow";

describe("following the voice", () => {
  it("stops following when the reader's own hands moved the page, not when the voice did", () => {
    const now = 100_000;
    // The voice scrolled a moment ago: its own move.
    expect(movedByReader({ now, ownMoveUntil: now + OWN_MOVE_MS, handsOnAt: now - 10 })).toBe(false);
    // A wheel or a finger just now, and the page moved: theirs.
    expect(movedByReader({ now, ownMoveUntil: now - 1, handsOnAt: now - 200 })).toBe(true);
    // The page moved with nobody's hands on it (a chapter laid out anew): still following.
    expect(movedByReader({ now, ownMoveUntil: now - 1, handsOnAt: now - HANDS_ON_MS - 1 })).toBe(false);
  });

  it("scrolls only when the sentence leaves the upper middle of the window, and brings it back there", () => {
    const view = { viewHeight: 1000, scrollTop: 5000 };
    expect(scrollTarget({ ...view, top: 300, bottom: 360 })).toBeNull();
    // Below the band: brought up to a little under a third of the way down.
    expect(scrollTarget({ ...view, top: 700, bottom: 760 })).toBe(5000 + 700 - 1000 * BRING_TO);
    // Above it (under the toolbar): brought down.
    expect(scrollTarget({ ...view, top: 40, bottom: 80 })).toBe(5000 + 40 - 300);
    // A tall sentence that starts in the band is left alone.
    expect(scrollTarget({ ...view, top: 250, bottom: 900 })).toBeNull();
    expect(scrollTarget({ viewHeight: 1000, scrollTop: 0, top: 100, bottom: 130 })).toBe(0);
    expect(scrollTarget({ viewHeight: 0, scrollTop: 0, top: 100, bottom: 130 })).toBeNull();
  });

  it("turns the page once the sentence has moved past it, and jumps for anything further", () => {
    expect(pageMove({ left: 120, width: 800 })).toBe("stay");
    expect(pageMove({ left: 830, width: 800 })).toBe("next");
    expect(pageMove({ left: 2500, width: 800 })).toBe("jump");
    expect(pageMove({ left: -400, width: 800 })).toBe("jump");
    // Right to left, the next page is to the left.
    expect(pageMove({ left: -400, width: 800, rtl: true })).toBe("next");
  });
});
