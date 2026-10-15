import { describe, expect, it } from "vitest";
import { TOUCHED_AWAKE_MS, shouldStayAwake } from "./readerAwake";

const at = 1_000_000;

describe("keeping the screen on while reading", () => {
  it("always while the page reads itself, and only while Leaflet is in sight", () => {
    expect(shouldStayAwake({ playing: true, byTouch: false, touchedAt: 0, now: at, hidden: false })).toBe(true);
    expect(shouldStayAwake({ playing: true, byTouch: true, touchedAt: 0, now: at, hidden: true })).toBe(false);
  });

  it("on a phone, while the book was touched in the last five minutes", () => {
    expect(shouldStayAwake({ playing: false, byTouch: true, touchedAt: at - 1000, now: at, hidden: false })).toBe(true);
    expect(shouldStayAwake({ playing: false, byTouch: true, touchedAt: at - TOUCHED_AWAKE_MS + 1, now: at, hidden: false })).toBe(true);
    expect(shouldStayAwake({ playing: false, byTouch: true, touchedAt: at - TOUCHED_AWAKE_MS, now: at, hidden: false })).toBe(false);
  });

  it("not for a touch on the desktop, where the system sees the mouse and the keys itself", () => {
    expect(shouldStayAwake({ playing: false, byTouch: false, touchedAt: at, now: at, hidden: false })).toBe(false);
  });
});
