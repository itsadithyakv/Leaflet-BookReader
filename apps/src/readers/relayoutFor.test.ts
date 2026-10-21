import { describe, expect, it } from "vitest";
import { relayoutFor, resizeDuringTurn } from "./relayoutFor";

const phone = { width: 375, height: 812 };
const keyboard = { width: 375, height: 480 };

describe("what a change of the window's size asks of the book", () => {
  it("asks nothing of a size that did not change", () => {
    expect(relayoutFor("scroll", phone, { ...phone }, false)).toBe("none");
    expect(relayoutFor("pages", phone, { ...phone }, false)).toBe("none");
  });

  it("scrolling, never lays the book out again for a change of height: a search result tapped with the keyboard up stays put as it goes down", () => {
    expect(relayoutFor("scroll", phone, keyboard, true)).toBe("bounds");
    expect(relayoutFor("scroll", keyboard, phone, false)).toBe("bounds");
    // The system bars, or the window dragged taller.
    expect(relayoutFor("scroll", phone, { width: 375, height: 860 }, false)).toBe("bounds");
  });

  it("lays the book out again for a new width (a turn of the phone, a window dragged wider)", () => {
    expect(relayoutFor("scroll", phone, { width: 812, height: 375 }, false)).toBe("relayout");
    expect(relayoutFor("pages", phone, { width: 812, height: 375 }, false)).toBe("relayout");
  });

  it("with pages, does nothing for our own keyboard coming up, and waits for any other change of height to hold", () => {
    expect(relayoutFor("pages", phone, keyboard, true)).toBe("none");
    // Another app's keyboard (a reply to a notification), or the window made shorter: wait and see.
    expect(relayoutFor("pages", phone, keyboard, false)).toBe("settle");
    expect(relayoutFor("pages", keyboard, phone, false)).toBe("settle");
  });

  it("does not depend on knowing the keyboard is up, scrolling (focus is in another app's reply)", () => {
    for (const keyboardUp of [true, false]) {
      expect(relayoutFor("scroll", phone, keyboard, keyboardUp)).toBe("bounds");
      expect(relayoutFor("scroll", keyboard, phone, keyboardUp)).toBe("bounds");
    }
  });
});

describe("a turn of the screen, by a finger", () => {
  it("waits under the veil for a new width, and is laid out once at the end", () => {
    const turned = relayoutFor("scroll", phone, { width: 812, height: 375 }, false);
    expect(resizeDuringTurn(turned, true, false)).toBe("turn");
    expect(resizeDuringTurn(relayoutFor("pages", phone, { width: 812, height: 375 }, false), true, false)).toBe("turn");
  });

  it("takes every change while it waits as part of it, a change of height too (the bars coming back)", () => {
    const bars = relayoutFor("pages", { width: 812, height: 360 }, { width: 812, height: 375 }, false);
    expect(bars).toBe("settle");
    expect(resizeDuringTurn(bars, true, true)).toBe("turn");
    expect(resizeDuringTurn(relayoutFor("scroll", { width: 812, height: 360 }, { width: 812, height: 375 }, false), true, true)).toBe("turn");
    expect(resizeDuringTurn("none", true, true)).toBe("none");
  });

  it("leaves a keyboard alone, and a mouse's window as it was", () => {
    expect(resizeDuringTurn(relayoutFor("scroll", phone, keyboard, true), true, false)).toBe("bounds");
    expect(resizeDuringTurn(relayoutFor("pages", phone, keyboard, true), true, false)).toBe("none");
    expect(resizeDuringTurn("relayout", false, false)).toBe("relayout");
    expect(resizeDuringTurn("settle", false, true)).toBe("settle");
  });
});
