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

  it("moves a screen with the Page keys and to a chapter's or the book's ends with Home and End when scrolling", () => {
    for (const mode of [scroll, { layout: "scroll", mode: "smart" } as const]) {
      expect(actionFor(key("PageDown"), mode)).toBe("screenDown");
      expect(actionFor(key("PageUp"), mode)).toBe("screenUp");
      expect(actionFor(key("Home"), mode)).toBe("chapterStart");
      expect(actionFor(key("End"), mode)).toBe("chapterEnd");
      expect(actionFor(key("Home", { ctrlKey: true }), mode)).toBe("bookStart");
      expect(actionFor(key("End", { ctrlKey: true }), mode)).toBe("bookEnd");
    }
    // Alt with them is the system's.
    expect(actionFor(key("Home", { altKey: true }), scroll)).toBeNull();
  });

  it("goes to the first and last page of the chapter or the book with Home and End with pages", () => {
    // The Page keys turn pages there; Home and End are the same four actions as when scrolling.
    expect(actionFor(key("PageDown"), pages)).toBe("pageNext");
    expect(actionFor(key("Home"), pages)).toBe("chapterStart");
    expect(actionFor(key("End"), pages)).toBe("chapterEnd");
    expect(actionFor(key("Home", { ctrlKey: true }), pages)).toBe("bookStart");
    expect(actionFor(key("End", { ctrlKey: true }), pages)).toBe("bookEnd");
    expect(actionFor(key("End", { altKey: true }), pages)).toBeNull();
    // The sheet says "page" there.
    const rows = (layout: "scroll" | "pages") =>
      shortcutSections({ layout, mode: "standard" })
        .flatMap((section) => section.rows)
        .filter((row) => row.keys.some((shown) => /Home|End/.test(shown)) && !/progress bar/.test(row.label))
        .map((row) => `${row.keys.join("/")}: ${row.label}`);
    expect(rows("pages")).toEqual([
      "Ctrl+Home: The first page of the book",
      "Ctrl+End: The last page of the book",
      "Home: The first page of this chapter",
      "End: The last page of this chapter"
    ]);
    expect(rows("scroll")).toEqual([
      "Ctrl+Home: The start of the book",
      "Ctrl+End: The end of the book",
      "Home: The start of this chapter",
      "End: The end of this chapter"
    ]);
  });

  it("goes a chapter back or on with Ctrl and an arrow in every layout", () => {
    for (const context of [scroll, smart, speed, pages]) {
      expect(actionFor(key("ArrowLeft", { ctrlKey: true }), context)).toBe("chapterPrev");
      expect(actionFor(key("ArrowRight", { ctrlKey: true }), context)).toBe("chapterNext");
      expect(actionFor(key("ArrowLeft", { metaKey: true }), context)).toBe("chapterPrev");
    }
    // The plain arrows keep their own meaning with pages, and Alt is still Back.
    expect(actionFor(key("ArrowLeft"), pages)).toBe("pagePrev");
    expect(actionFor(key("ArrowLeft", { altKey: true }), pages)).toBe("back");
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

  it("shows and hides the chapter list with C, in every layout and mode, and leaves Ctrl+C to copying", () => {
    for (const context of [scroll, pages, { layout: "scroll", mode: "smart" } as const, { layout: "scroll", mode: "speed" } as const]) {
      expect(actionFor(key("c"), context)).toBe("contents");
      expect(actionFor(key("C", { shiftKey: true }), context)).toBe("contents");
      expect(actionFor(key("c", { ctrlKey: true }), context)).toBeNull();
      expect(actionFor(key("c", { metaKey: true }), context)).toBeNull();
      expect(actionFor(key("c", { altKey: true }), context)).toBeNull();
    }
    // The sheet lists it, from the same table.
    for (const context of [scroll, pages]) {
      const rows = shortcutSections(context).flatMap((section) => section.rows);
      expect(rows.find((row) => row.keys.includes("C"))?.label).toBe("Show or hide the chapter list");
    }
  });

  it("leaves the browser's and the system's own chords alone", () => {
    expect(actionFor(key("b", { ctrlKey: true }), scroll)).toBeNull();
    expect(actionFor(key("ArrowUp", { ctrlKey: true }), scroll)).toBeNull();
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
    // Pages has a way to the chapters too, beside its page keys.
    expect(labels(pages)).toContain("Next chapter");
    expect(labels(pages)).toContain("Previous chapter");
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
