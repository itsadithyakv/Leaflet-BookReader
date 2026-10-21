import { describe, expect, it } from "vitest";
import { chromeAfter, chromeAtOpen, type ChromeEvent } from "../hooks/useAutoHideChrome";
import { isPhoneShape, readerShape, systemBarsHidden, tapAction, tapZone } from "./touchLayout";

/** A tap at `x` on a page 0..412 wide (a phone held upright), as the readers work it out. */
const tapOnPhone = (x: number, layout: "pages" | "scroll", rtl = false) => tapAction(tapZone(x, 0, 412, rtl), layout, true);

describe("a tap on a phone's page", () => {
  it("brings the chrome only from the middle third, paginated or scrolling", () => {
    for (const layout of ["pages", "scroll"] as const) {
      expect(tapOnPhone(206, layout)).toEqual({ kind: "chrome" });
      expect(tapOnPhone(140, layout)).toEqual({ kind: "chrome" });
      expect(tapOnPhone(270, layout)).toEqual({ kind: "chrome" });
    }
  });

  it("turns the page at a side, with pages", () => {
    expect(tapOnPhone(20, "pages")).toEqual({ kind: "turn", step: -1 });
    expect(tapOnPhone(400, "pages")).toEqual({ kind: "turn", step: 1 });
    // A right-to-left book turns the other way.
    expect(tapOnPhone(400, "pages", true)).toEqual({ kind: "turn", step: -1 });
  });

  it("scrolling, at a side only sends the chrome away, never brings it", () => {
    expect(tapOnPhone(20, "scroll")).toEqual({ kind: "hide" });
    expect(tapOnPhone(400, "scroll")).toEqual({ kind: "hide" });
  });

  it("on a tablet, scrolling, still toggles the chrome anywhere", () => {
    expect(tapAction(tapZone(20, 0, 900), "scroll")).toEqual({ kind: "chrome" });
    expect(tapAction(tapZone(880, 0, 900), "scroll", false)).toEqual({ kind: "chrome" });
  });

  it("is a phone's either way up, and not a tablet's or a mouse's", () => {
    expect(isPhoneShape(readerShape(412, 915, true))).toBe(true);
    expect(isPhoneShape(readerShape(740, 360, true))).toBe(true);
    expect(isPhoneShape(readerShape(1280, 800, true))).toBe(false);
    expect(isPhoneShape(readerShape(412, 915, false))).toBe(false);
  });
});

describe("the chrome's state", () => {
  const phone = { pinned: false, immersive: true };
  const desktop = { pinned: false, immersive: false };
  const run = (events: ChromeEvent[], context = phone, from = chromeAtOpen(context.immersive)) =>
    events.reduce((visible, event) => chromeAfter(visible, event, context), from);

  it("is away as a book opens on a phone, and up on a desktop", () => {
    expect(chromeAtOpen(true)).toBe(false);
    expect(chromeAtOpen(false)).toBe(true);
  });

  it("comes and goes with each middle tap on a phone", () => {
    expect(run(["toggle"])).toBe(true);
    expect(run(["toggle", "toggle"])).toBe(false);
    expect(run(["toggle", "toggle", "toggle"])).toBe(true);
  });

  it("goes for a page turned, a side tap or Back, and stays away", () => {
    expect(run(["toggle", "hide"])).toBe(false);
    expect(run(["hide"])).toBe(false);
  });

  it("is not brought by the pointer or focus on a phone, as it is on a desktop", () => {
    expect(run(["reveal"])).toBe(false);
    expect(run(["reveal"], desktop, false)).toBe(true);
  });

  it("stays up while one of its own panels is open, whatever is tapped", () => {
    const pinned = { pinned: true, immersive: true };
    expect(chromeAfter(false, "pin", pinned)).toBe(true);
    expect(chromeAfter(true, "toggle", pinned)).toBe(true);
    expect(chromeAfter(true, "hide", pinned)).toBe(true);
    // Closed again, the chrome is still there until the reader taps.
    expect(chromeAfter(true, "toggle", phone)).toBe(false);
  });
});

describe("the system's bars", () => {
  it("are away for the whole book on an upright phone, so the text never moves under a tap", () => {
    expect(systemBarsHidden("upright", false)).toBe(true);
  });

  it("are away for the whole book on its side too, so a tap never lays the pages out again", () => {
    expect(systemBarsHidden("sideways", false)).toBe(true);
  });

  it("stay on a tablet and a desktop, except under focus lock", () => {
    expect(systemBarsHidden("tablet", false)).toBe(false);
    expect(systemBarsHidden("desktop", false)).toBe(false);
    expect(systemBarsHidden("desktop", true)).toBe(true);
  });
});
