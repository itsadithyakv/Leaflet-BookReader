import { describe, expect, it } from "vitest";
import { READER_BINDINGS, actionFor, keyBelongsToControl, shortcutSections, type KeyPress, type ReaderKeyContext } from "./readerKeys";

const scroll: ReaderKeyContext = { layout: "scroll", mode: "standard" };
const smart: ReaderKeyContext = { layout: "scroll", mode: "smart" };
const speed: ReaderKeyContext = { layout: "scroll", mode: "speed" };
const pages: ReaderKeyContext = { layout: "pages", mode: "standard" };
const key = (name: string, extra: Partial<KeyPress> = {}): KeyPress => ({ key: name, code: name === " " ? "Space" : name, ...extra });

describe("the reader's keys", () => {
  it("turns pages with the arrows, the Page keys and Space in the pages layout", () => {
    expect(actionFor(key("ArrowRight"), pages)).toBe("pageNext");
    expect(actionFor(key("PageDown"), pages)).toBe("pageNext");
    expect(actionFor(key(" "), pages)).toBe("pageNext");
    expect(actionFor(key("ArrowLeft"), pages)).toBe("pagePrev");
    expect(actionFor(key("PageUp"), pages)).toBe("pagePrev");
    expect(actionFor(key(" ", { shiftKey: true }), pages)).toBe("pagePrev");
  });

  it("changes chapter, scrolls and plays in the scrolling layout", () => {
    expect(actionFor(key("ArrowRight"), scroll)).toBe("chapterNext");
    expect(actionFor(key("ArrowLeft"), scroll)).toBe("chapterPrev");
    expect(actionFor(key("ArrowDown"), scroll)).toBe("scrollDown");
    expect(actionFor(key("ArrowUp"), scroll)).toBe("scrollUp");
    expect(actionFor(key(" "), scroll)).toBe("playPause");
    expect(actionFor(key("+"), scroll)).toBe("faster");
    expect(actionFor(key("="), scroll)).toBe("faster");
    expect(actionFor(key("-"), smart)).toBe("slower");
  });

  it("paces nothing with pages: + and - and the vertical arrows are left alone", () => {
    for (const name of ["+", "=", "-", "_", "ArrowDown", "ArrowUp"]) {
      expect(actionFor(key(name), pages)).toBeNull();
    }
  });

  it("goes back and forward with Alt and an arrow in every layout, ahead of the arrow's own meaning", () => {
    for (const context of [scroll, pages, smart, speed]) {
      expect(actionFor(key("ArrowLeft", { altKey: true }), context)).toBe("back");
      expect(actionFor(key("ArrowRight", { altKey: true }), context)).toBe("forward");
    }
  });

  it("bookmarks with B or Ctrl+D, searches with Ctrl+F, and shows the sheet with ?", () => {
    for (const context of [scroll, pages]) {
      expect(actionFor(key("b"), context)).toBe("bookmark");
      expect(actionFor(key("B", { shiftKey: true }), context)).toBe("bookmark");
      expect(actionFor(key("d", { ctrlKey: true }), context)).toBe("bookmark");
      expect(actionFor(key("f", { ctrlKey: true }), context)).toBe("search");
      expect(actionFor(key("f", { metaKey: true }), context)).toBe("search");
      expect(actionFor(key("?", { shiftKey: true }), context)).toBe("shortcuts");
      expect(actionFor(key("Escape"), context)).toBe("escape");
    }
  });

  it("leaves the browser's and the system's own chords alone", () => {
    expect(actionFor(key("b", { ctrlKey: true }), scroll)).toBeNull();
    expect(actionFor(key("ArrowRight", { ctrlKey: true }), scroll)).toBeNull();
    expect(actionFor(key(" ", { ctrlKey: true }), scroll)).toBeNull();
    expect(actionFor(key("d"), scroll)).toBeNull();
    expect(actionFor(key("f"), scroll)).toBeNull();
    expect(actionFor(key("Tab"), scroll)).toBeNull();
  });

  it("lists on the sheet exactly the keys that are bound here, in the reader's words for this mode", () => {
    for (const context of [scroll, smart, speed, pages]) {
      const sections = shortcutSections(context);
      const listed = sections.filter((section) => section.title !== "Elsewhere").flatMap((section) => section.rows);
      const bound = READER_BINDINGS.filter((binding) => binding.when?.(context) ?? true);
      expect(listed).toHaveLength(bound.length);
      for (const binding of bound) {
        expect(listed.some((row) => row.keys === binding.keys && row.label === binding.label(context))).toBe(true);
      }
    }
    const labels = (context: ReaderKeyContext) => shortcutSections(context).flatMap((section) => section.rows.map((row) => row.label));
    expect(labels(scroll)).toContain("Start auto-scroll, or pause it");
    expect(labels(smart)).toContain("Pause Smart Read, or carry on");
    expect(labels(speed)).toContain("SpeedRead 20 words a minute faster");
    expect(labels(pages)).toContain("Next page");
    expect(labels(pages)).not.toContain("Next chapter");
    expect(labels(pages).some((label) => /Dotty/.test(label))).toBe(false);
  });

  it("says what every listed key does: no row without keys or words", () => {
    for (const section of shortcutSections(scroll)) {
      for (const row of section.rows) {
        expect(row.keys.length).toBeGreaterThan(0);
        expect(row.label.length).toBeGreaterThan(3);
      }
    }
  });
});

describe("keys that belong to a focused control", () => {
  const button = { tag: "BUTTON", role: "", focusVisible: true };

  it("lets Space and Enter press a button the keyboard reached", () => {
    expect(keyBelongsToControl(key(" "), button)).toBe(true);
    expect(keyBelongsToControl(key("Enter"), button)).toBe(true);
    expect(keyBelongsToControl(key(" "), { tag: "div", role: "radio", focusVisible: true })).toBe(true);
  });

  it("keeps Space for reading after a button was only clicked", () => {
    expect(keyBelongsToControl(key(" "), { ...button, focusVisible: false })).toBe(false);
    expect(keyBelongsToControl(key(" "), null)).toBe(false);
  });

  it("leaves the arrows to a slider or a radio group, and to the reader on a plain button", () => {
    expect(keyBelongsToControl(key("ArrowRight"), { tag: "div", role: "slider", focusVisible: true })).toBe(true);
    expect(keyBelongsToControl(key("Home"), { tag: "div", role: "slider", focusVisible: true })).toBe(true);
    expect(keyBelongsToControl(key("ArrowDown"), { tag: "button", role: "radio", focusVisible: true })).toBe(true);
    expect(keyBelongsToControl(key("ArrowRight"), button)).toBe(false);
  });

  it("never takes Escape, or a chord, from the reader", () => {
    expect(keyBelongsToControl(key("Escape"), button)).toBe(false);
    expect(keyBelongsToControl(key("ArrowLeft", { altKey: true }), { tag: "div", role: "slider", focusVisible: true })).toBe(false);
    expect(keyBelongsToControl(key("b"), button)).toBe(false);
  });
});
