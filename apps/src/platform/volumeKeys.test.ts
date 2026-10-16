import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionFor } from "../readers/readerKeys";
import { pageActionFor } from "../readers/pageReaderKeys";

// No DOM here: the window is a bare EventTarget, and a key event an Event with a key.
class FakeKeyboardEvent extends Event {
  key: string;
  code: string;
  constructor(type: string, init: { key: string; code?: string; bubbles?: boolean; cancelable?: boolean }) {
    super(type, init);
    this.key = init.key;
    this.code = init.code ?? "";
  }
}
const stored = new Map<string, string>();
const fakeWindow = new EventTarget() as EventTarget & { __leafletPageKey?: (direction: "next" | "prev") => void };
vi.stubGlobal("window", fakeWindow);
vi.stubGlobal("KeyboardEvent", FakeKeyboardEvent);
vi.stubGlobal("localStorage", {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value)
});
vi.mock("./android", () => ({ android: { volumePageTurns: async () => undefined }, onAndroid: () => true }));

const { pageKeyFor, pressPageKey, setVolumeKeysTurnPages, typingIn, volumeKeysTurnPages, volumeKeysWanted } = await import("./volumeKeys");

const pressed = (run: () => void) => {
  const keys: string[] = [];
  const listen = (event: Event) => keys.push(`${event.type}:${(event as FakeKeyboardEvent).key}`);
  fakeWindow.addEventListener("keydown", listen);
  fakeWindow.addEventListener("keyup", listen);
  run();
  fakeWindow.removeEventListener("keydown", listen);
  fakeWindow.removeEventListener("keyup", listen);
  return keys;
};

describe("volume keys turn pages", () => {
  beforeEach(() => {
    stored.clear();
  });

  it("is on by default, and remembers being turned off", () => {
    expect(volumeKeysTurnPages()).toBe(true);
    setVolumeKeysTurnPages(false);
    expect(volumeKeysTurnPages()).toBe(false);
    expect(stored.get("leaflet.volumeKeys")).toBe("off");
    setVolumeKeysTurnPages(true);
    expect(stored.get("leaflet.volumeKeys")).toBe("on");
  });

  it("takes the keys only on Android, with the setting on, while a book is open", () => {
    expect(volumeKeysWanted({ android: true, setting: true, bookOpen: true })).toBe(true);
    expect(volumeKeysWanted({ android: true, setting: true, bookOpen: false })).toBe(false);
    expect(volumeKeysWanted({ android: true, setting: false, bookOpen: true })).toBe(false);
    expect(volumeKeysWanted({ android: false, setting: true, bookOpen: true })).toBe(false);
  });

  it("presses Page Down for the next page and Page Up for the one before, on the window", () => {
    expect(pressed(() => pressPageKey("next"))).toEqual(["keydown:PageDown", "keyup:PageDown"]);
    expect(pressed(() => pressPageKey("prev"))).toEqual(["keydown:PageUp", "keyup:PageUp"]);
  });

  it("answers the Android side's call, anything but 'prev' going on", () => {
    expect(typeof fakeWindow.__leafletPageKey).toBe("function");
    expect(pressed(() => fakeWindow.__leafletPageKey?.("next"))).toEqual(["keydown:PageDown", "keyup:PageDown"]);
    expect(pressed(() => fakeWindow.__leafletPageKey?.("prev"))).toEqual(["keydown:PageUp", "keyup:PageUp"]);
    expect(pressed(() => (fakeWindow.__leafletPageKey as (direction: string) => void)("sideways"))).toEqual([
      "keydown:PageDown",
      "keyup:PageDown"
    ]);
  });

  it("goes on in a right-to-left book too, and scrolls a screen when the book is scrolled", () => {
    const next = { key: pageKeyFor("next") };
    const prev = { key: pageKeyFor("prev") };
    for (const rtl of [false, true]) {
      expect(actionFor(next, { layout: "pages", mode: "standard", rtl })).toBe("pageNext");
      expect(actionFor(prev, { layout: "pages", mode: "standard", rtl })).toBe("pagePrev");
    }
    expect(actionFor(next, { layout: "scroll", mode: "standard" })).toBe("screenDown");
    expect(actionFor(prev, { layout: "scroll", mode: "standard" })).toBe("screenUp");
    // PDFs and comics: a screen down, and at the foot of the page the next one, either way the pages run.
    for (const direction of ["ltr", "rtl"] as const) {
      expect(pageActionFor(next, { kind: "comic", layout: "pages", direction })).toBe("screenDown");
      expect(pageActionFor(prev, { kind: "comic", layout: "pages", direction })).toBe("screenUp");
    }
  });
});

describe("typing", () => {
  it("leaves the page alone while a field or an editable note has the focus", () => {
    const element = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as Element;
    expect(typingIn(element("INPUT"))).toBe(true);
    expect(typingIn(element("TEXTAREA"))).toBe(true);
    expect(typingIn(element("DIV", true))).toBe(true);
    expect(typingIn(element("BUTTON"))).toBe(false);
    expect(typingIn(element("BODY"))).toBe(false);
    expect(typingIn(null)).toBe(false);
  });
});
