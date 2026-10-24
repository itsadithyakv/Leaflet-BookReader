import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReadAloudMenuRow } from "./ReadAloudMenuRow";
import { pageActionFor, pageShortcutSections, type PageKeyContext } from "../pageReaderKeys";

const controls = (active: boolean) => ({ active, start: () => undefined, stop: () => undefined });
const nothing = () => undefined;

describe("read aloud in the page reader", () => {
  it("is in a PDF's menu, with its key, and on when reading", () => {
    const off = renderToStaticMarkup(<ReadAloudMenuRow kind="pdf" readAloud={controls(false)} onChoose={nothing} touch={false} />);
    expect(off).toContain("Read aloud");
    expect(off).toContain('title="Read aloud (R)"');
    expect(off).toContain('data-on="false"');
    const on = renderToStaticMarkup(<ReadAloudMenuRow kind="pdf" readAloud={controls(true)} onChoose={nothing} touch />);
    expect(on).toContain('data-on="true"');
    // A finger has no keys to be told of.
    expect(on).not.toContain("title=");
  });

  it("is not offered for a comic, which has no words to read", () => {
    expect(renderToStaticMarkup(<ReadAloudMenuRow kind="comic" readAloud={controls(false)} onChoose={nothing} touch={false} />)).toBe("");
  });

  it("is R in a PDF in either layout, and nothing in a comic", () => {
    for (const layout of ["pages", "scroll"] as const) {
      const pdf: PageKeyContext = { kind: "pdf", layout, direction: "ltr" };
      expect(pageActionFor({ key: "r" }, pdf)).toBe("readAloud");
      expect(pageActionFor({ key: "R", shiftKey: true }, pdf)).toBe("readAloud");
      // Ctrl+R stays the window's.
      expect(pageActionFor({ key: "r", ctrlKey: true }, pdf)).toBeNull();
      const reading = pageShortcutSections(pdf).find((section) => section.title === "Reading");
      expect(reading?.rows).toContainEqual({ keys: ["R"], label: "Read aloud from here, or pause it" });
    }
    const comic: PageKeyContext = { kind: "comic", layout: "pages", direction: "ltr" };
    expect(pageActionFor({ key: "r" }, comic)).toBeNull();
    expect(pageShortcutSections(comic).flatMap((section) => section.rows).some((row) => row.keys.includes("R"))).toBe(false);
  });
});
