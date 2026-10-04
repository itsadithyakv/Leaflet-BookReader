import { describe, expect, it } from "vitest";
import { readingKeyAction, type StageMetrics } from "./pageKeys";
import {
  PAGE_BINDINGS,
  READING_ACTIONS,
  pageActionFor,
  pageShortcutContext,
  pageShortcutSections,
  worksWhileTyping,
  type KeyPress,
  type PageKeyContext
} from "./pageReaderKeys";

const pdfPages: PageKeyContext = { kind: "pdf", layout: "pages", direction: "ltr" };
const pdfScroll: PageKeyContext = { kind: "pdf", layout: "scroll", direction: "ltr" };
const comic: PageKeyContext = { kind: "comic", layout: "pages", direction: "ltr" };
const manga: PageKeyContext = { kind: "comic", layout: "pages", direction: "rtl" };
const EVERY = [pdfPages, pdfScroll, comic, manga];

const NAMED: Record<string, string> = {
  Space: " ",
  "Page Down": "PageDown",
  "Page Up": "PageUp",
  "↓": "ArrowDown",
  "↑": "ArrowUp",
  "→": "ArrowRight",
  "←": "ArrowLeft",
  Esc: "Escape"
};

/** The key press a key as shown on the sheet stands for: "Ctrl+F", "Shift+Space", "↓", "Ctrl++". */
const pressFor = (shown: string): KeyPress => {
  let rest = shown;
  const press: KeyPress = { key: "" };
  if (rest.startsWith("Ctrl+")) {
    press.ctrlKey = true;
    rest = rest.slice(5);
  }
  if (rest.startsWith("Shift+")) {
    press.shiftKey = true;
    rest = rest.slice(6);
  }
  press.key = NAMED[rest] ?? (rest.length === 1 ? rest.toLowerCase() : rest);
  return press;
};

const rowsOf = (context: PageKeyContext) => pageShortcutSections(context).flatMap((section) => section.rows);

/** A page taller and wider than the window, part way down and across: every reading key has somewhere to go. */
const stage: StageMetrics = {
  scrollTop: 500,
  scrollHeight: 3000,
  clientHeight: 800,
  scrollLeft: 100,
  scrollWidth: 1600,
  clientWidth: 1000
};

describe("the page reader's keys and its shortcuts sheet", () => {
  it("does what the sheet says for every key the sheet shows", () => {
    for (const context of EVERY) {
      for (const binding of PAGE_BINDINGS.filter((each) => each.when?.(context) ?? true)) {
        for (const shown of binding.keys) {
          expect([shown, pageActionFor(pressFor(shown), context)]).toEqual([shown, binding.action]);
        }
      }
    }
  });

  it("shows on the sheet every key that does something, and no key twice", () => {
    const keys = [
      ..."abcdefghijklmnopqrstuvwxyz0123456789",
      ..."+-=_?/.,;'[]",
      " ",
      "Escape",
      "Enter",
      "Tab",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Delete",
      "Backspace"
    ];
    for (const context of EVERY) {
      const rows = rowsOf(context);
      const shown = rows.flatMap((row) => row.keys);
      expect(new Set(shown).size).toBe(shown.length);
      const listed = new Set(
        PAGE_BINDINGS.filter((binding) => rows.some((row) => row.keys === binding.keys)).map((binding) => binding.action)
      );
      for (const key of keys) {
        for (const held of [{}, { ctrlKey: true }, { shiftKey: true }, { metaKey: true }, { altKey: true }]) {
          const action = pageActionFor({ key, ...held }, context);
          if (action !== null) {
            expect([key, held, listed.has(action)]).toEqual([key, held, true]);
          }
        }
      }
    }
  });

  it("lists exactly the reading keys the reading arithmetic answers", () => {
    // Every reading key on the sheet is one `readingKeyAction` knows...
    for (const binding of PAGE_BINDINGS.filter((each) => READING_ACTIONS.has(each.action))) {
      for (const shown of binding.keys) {
        expect([shown, readingKeyAction(pressFor(shown), stage) !== null]).toEqual([shown, true]);
      }
    }
    // ...and every key it knows is a reading key in the table.
    for (const key of [" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(readingKeyAction({ key }, stage)).not.toBeNull();
      const action = pageActionFor({ key }, pdfPages);
      expect([key, action !== null && READING_ACTIONS.has(action)]).toEqual([key, true]);
    }
    for (const key of ["a", "Enter", "Tab", "?"]) {
      expect(readingKeyAction({ key }, stage)).toBeNull();
    }
  });

  it("takes the other spellings of a key: = for +, an upper-case letter, Cmd for Ctrl", () => {
    expect(pageActionFor({ key: "=" }, pdfPages)).toBe("zoomIn");
    expect(pageActionFor({ key: "=", ctrlKey: true }, pdfPages)).toBe("zoomIn");
    expect(pageActionFor({ key: "_", ctrlKey: true, shiftKey: true }, pdfPages)).toBe("zoomOut");
    expect(pageActionFor({ key: "G", shiftKey: true }, pdfPages)).toBe("goTo");
    expect(pageActionFor({ key: "f", metaKey: true }, pdfPages)).toBe("search");
    expect(pageActionFor({ key: "Spacebar" }, pdfPages)).toBe("screenDown");
  });

  it("leaves alone what is the window's or the system's", () => {
    expect(pageActionFor({ key: "c", ctrlKey: true }, pdfPages)).toBeNull();
    expect(pageActionFor({ key: "a", ctrlKey: true }, pdfPages)).toBeNull();
    expect(pageActionFor({ key: "ArrowLeft", altKey: true }, pdfPages)).toBeNull();
    expect(pageActionFor({ key: "Escape", altKey: true }, pdfPages)).toBeNull();
    expect(pageActionFor({ key: "f" }, pdfPages)).toBeNull();
    expect(pageActionFor({ key: "Tab" }, pdfPages)).toBeNull();
  });

  it("has no search in a comic", () => {
    expect(pageActionFor({ key: "f", ctrlKey: true }, comic)).toBeNull();
    expect(rowsOf(comic).some((row) => row.keys.includes("Ctrl+F"))).toBe(false);
    expect(rowsOf(pdfPages).some((row) => row.keys.includes("Ctrl+F"))).toBe(true);
  });

  it("says what a key does where the reader is: pages, the scroll, a comic read right to left", () => {
    const label = (context: PageKeyContext, key: string) => rowsOf(context).find((row) => row.keys.includes(key))?.label;
    expect(label(pdfPages, "Space")).toBe("Scroll down a screen; at the bottom of the page, the next page");
    expect(label(pdfScroll, "Space")).toBe("Scroll down a screen");
    expect(label(pdfPages, "→")).toMatch(/^Next page/);
    expect(label(pdfScroll, "→")).toBe("The next page");
    expect(label(manga, "→")).toMatch(/^Previous page/);
    expect(label(manga, "←")).toMatch(/^Next page/);
    expect(label(comic, "Esc")).toBe("Close whatever is open; then leave the comic");
    expect(label(pdfScroll, "B")).toBe("Bookmark the page you are on, or take its bookmark off");
  });

  it("agrees with the reading arithmetic about which side goes on", () => {
    const fits: StageMetrics = { ...stage, scrollLeft: 0, scrollWidth: 1000 };
    for (const context of [comic, manga]) {
      for (const [key, shown] of [
        ["ArrowRight", "→"],
        ["ArrowLeft", "←"]
      ] as const) {
        const turn = readingKeyAction({ key }, fits, context.direction);
        const says = rowsOf(context).find((row) => row.keys.includes(shown))?.label ?? "";
        expect(turn).toMatchObject({ kind: "turn", step: says.startsWith("Next") ? 1 : -1 });
      }
    }
  });

  it("names what the sheet is describing", () => {
    expect(pageShortcutContext(pdfPages)).toBe("PDF · Pages");
    expect(pageShortcutContext(pdfScroll)).toBe("PDF · Scrolling");
    expect(pageShortcutContext(manga)).toBe("Comic · Pages · right to left");
  });

  it("answers the keys held with Ctrl while a field is being typed in, and no others", () => {
    expect(worksWhileTyping({ key: "g", ctrlKey: true })).toBe(true);
    expect(worksWhileTyping({ key: "f", metaKey: true })).toBe(true);
    expect(worksWhileTyping({ key: "g" })).toBe(false);
    expect(worksWhileTyping({ key: " " })).toBe(false);
    expect(worksWhileTyping({ key: "Escape" })).toBe(false);
  });

  it("puts the sections in reading order and leaves none empty", () => {
    expect(pageShortcutSections(pdfPages).map((section) => section.title)).toEqual([
      "Reading",
      "Moving about",
      "Finding and keeping",
      "Page size"
    ]);
    EVERY.forEach((context) => pageShortcutSections(context).forEach((section) => expect(section.rows.length).toBeGreaterThan(0)));
  });
});
