import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALIGN_KEY,
  LINE_HEIGHT,
  SPACING_KEY,
  TYPEFACE_KEY,
  TYPEFACE_STACK,
  applyTypeChoice,
  lineHeightPx,
  readAlign,
  readSpacing,
  readTypeface,
  typeVariables
} from "./readerTypes";

describe("the type a reader chooses", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const storage = (values: Record<string, string>) => ({ getItem: (key: string) => values[key] ?? null });

  it("is what the reader has always had, until they choose otherwise", () => {
    vi.stubGlobal("localStorage", storage({}));
    expect(readTypeface()).toBe("serif");
    expect(readSpacing()).toBe("normal");
    expect(readAlign()).toBe("justify");
    expect(lineHeightPx(18, readSpacing())).toBeCloseTo(18 * 1.8);
  });

  it("remembers each choice, and ignores a value it does not know", () => {
    vi.stubGlobal("localStorage", storage({ [TYPEFACE_KEY]: "wide", [SPACING_KEY]: "airy", [ALIGN_KEY]: "left" }));
    expect(readTypeface()).toBe("wide");
    expect(readSpacing()).toBe("airy");
    expect(readAlign()).toBe("left");
    vi.stubGlobal("localStorage", storage({ [TYPEFACE_KEY]: "comic", [SPACING_KEY]: "2", [ALIGN_KEY]: "right" }));
    expect(readTypeface()).toBe("serif");
    expect(readSpacing()).toBe("normal");
    expect(readAlign()).toBe("justify");
  });

  it("survives storage that cannot be read", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      }
    });
    expect(readTypeface()).toBe("serif");
    expect(readSpacing()).toBe("normal");
    expect(readAlign()).toBe("justify");
  });

  it("gives one line's height for every spacing, in pixels of the type size", () => {
    expect(lineHeightPx(20, "compact")).toBeCloseTo(30);
    expect(lineHeightPx(20, "normal")).toBeCloseTo(36);
    expect(lineHeightPx(20, "airy")).toBeCloseTo(42);
    expect(LINE_HEIGHT.compact).toBeLessThan(LINE_HEIGHT.normal);
    expect(LINE_HEIGHT.normal).toBeLessThan(LINE_HEIGHT.airy);
  });

  it("names system faces only, each ending in a generic family", () => {
    for (const [face, stack] of Object.entries(TYPEFACE_STACK)) {
      if (face === "book") {
        expect(stack).toBeNull();
      } else {
        expect(stack).toMatch(/, (serif|sans-serif)$/);
        expect(stack).not.toMatch(/url\(/);
      }
    }
  });

  it("imposes no face for the book's own, and says so to the stylesheet", () => {
    const own = typeVariables({ typeface: "book", spacing: "normal", align: "justify" });
    expect(own.attributes["data-leaflet-face"]).toBeNull();
    const sans = typeVariables({ typeface: "sans", spacing: "airy", align: "left" });
    expect(sans.attributes["data-leaflet-face"]).toBe("sans");
    expect(sans.variables["--reader-font-family"]).toContain("Segoe UI");
    expect(sans.variables["--reader-line-height"]).toBe("2.1");
    // The start edge, not the left: a right-to-left book keeps its own side.
    expect(sans.variables["--reader-align"]).toBe("start");
    expect(sans.attributes["data-leaflet-align"]).toBe("left");
  });

  it("puts the choice on a chapter, and takes an imposed face off again", () => {
    const set = new Map<string, string>();
    const attributes = new Map<string, string>();
    const root = {
      style: { setProperty: (name: string, value: string) => set.set(name, value) },
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name)
    } as unknown as HTMLElement;
    applyTypeChoice(root, { typeface: "modern", spacing: "compact", align: "justify" });
    expect(attributes.get("data-leaflet-face")).toBe("modern");
    expect(set.get("--reader-line-height")).toBe("1.5");
    applyTypeChoice(root, { typeface: "book", spacing: "compact", align: "justify" });
    expect(attributes.has("data-leaflet-face")).toBe(false);
    expect(attributes.get("data-leaflet-align")).toBe("justify");
  });
});
