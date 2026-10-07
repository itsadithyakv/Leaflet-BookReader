import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyCustomFont,
  customFamily,
  customFontFaceCss,
  customFontId,
  customTypeface,
  isCustomTypeface
} from "./customFonts";
import { FALLBACK_FACE, TYPEFACE_KEY, applyTypeChoice, readTypeface, typeVariables, typefaceStack, type ReaderTypeface } from "./readerTypes";

const ID = "0123456789abcdef";
const OTHER = "fedcba9876543210";
const WOFF2 = "data:font/woff2;base64,d09GMgABAAAAAA==";

describe("a font of the reader's own as a typeface", () => {
  it("is named by the id Rust gave its file, and by nothing else", () => {
    expect(customTypeface(ID)).toBe(`custom:${ID}`);
    expect(customFontId(`custom:${ID}`)).toBe(ID);
    expect(isCustomTypeface(`custom:${ID}`)).toBe(true);
    for (const not of [
      "serif",
      "book",
      "",
      null,
      undefined,
      "custom:",
      `custom:${ID}0`,
      `custom:${ID.slice(1)}`,
      `custom:${ID.toUpperCase()}`,
      `Custom:${ID}`,
      ` custom:${ID}`,
      "custom:../../library.db",
      'custom:0123456789abcde"',
      "custom:0123456789abcde;",
      `custom:${ID}\n`
    ]) {
      expect(customFontId(not)).toBeNull();
    }
    expect(isCustomTypeface("wide")).toBe(false);
  });

  it("is called by its id in a stylesheet, never by its file's name", () => {
    expect(customFamily(ID)).toBe(`"Leaflet font ${ID}"`);
  });
});

describe("the @font-face made for it", () => {
  it("names the family, carries the file and lets the text show before it is read", () => {
    const css = customFontFaceCss(ID, WOFF2);
    expect(css).toBe(`@font-face { font-family: "Leaflet font ${ID}"; src: url("${WOFF2}") format("woff2"); font-display: swap; }`);
  });

  it("says what kind of file it is, from what Rust said", () => {
    const kinds = { ttf: "truetype", otf: "opentype", woff: "woff", woff2: "woff2" };
    for (const [mime, format] of Object.entries(kinds)) {
      expect(customFontFaceCss(ID, `data:font/${mime};base64,AAEAAA==`)).toContain(`format("${format}")`);
    }
  });

  it("is nothing when the font is not there", () => {
    expect(customFontFaceCss(ID, null)).toBe("");
    expect(customFontFaceCss(ID, undefined)).toBe("");
    expect(customFontFaceCss(ID, "")).toBe("");
    expect(customFontFaceCss(ID, "data:font/woff2;base64,")).toBe("");
  });

  it("is nothing for what is not a font's data, or could write past its own rule", () => {
    for (const data of [
      "data:text/html;base64,PGh0bWw+",
      "data:image/png;base64,iVBORw0KGgo=",
      "data:font/collection;base64,dHRjZg==",
      "https://example.com/font.woff2",
      "data:font/woff2,plain",
      ' data:font/woff2;base64,AAEAAA==',
      'data:font/woff2;base64,AAEA"); } body { display: none; } @font-face { src: url("',
      "data:font/woff2;base64,AAEA\\29 ",
      "data:font/woff2;base64,AAEA\nAAEA",
      "data:font/woff2;base64,AAEA AAEA"
    ]) {
      expect(customFontFaceCss(ID, data)).toBe("");
    }
    // Nor for an id that is not one.
    expect(customFontFaceCss('x"; } body { color: red', WOFF2)).toBe("");
    expect(customFontFaceCss("", WOFF2)).toBe("");
  });

  it("takes a font of the largest size without trouble", () => {
    // Ten megabytes as base64: what Rust's limit lets through.
    const big = `data:font/ttf;base64,${"A".repeat(Math.ceil((10 * 1024 * 1024 * 4) / 3))}`;
    const css = customFontFaceCss(ID, big);
    expect(css.length).toBeGreaterThan(big.length);
    expect(customFontFaceCss(ID, `${big}"`)).toBe("");
  });
});

describe("the face a chapter is set in", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("puts the reader's font in front of the book serif, which shows until it arrives and if it never does", () => {
    const face = customTypeface(ID);
    expect(typefaceStack(face)).toBe(`"Leaflet font ${ID}", ${FALLBACK_FACE}`);
    const own = typeVariables({ typeface: face, spacing: "normal", align: "justify" });
    expect(own.variables["--reader-font-family"]).toBe(`"Leaflet font ${ID}", ${FALLBACK_FACE}`);
    expect(own.variables["--reader-font-family"]).toMatch(/, serif$/);
    // Imposed on the running text, as any face the reader chose is.
    expect(own.attributes["data-leaflet-face"]).toBe(face);
  });

  it("leaves the faces that come with the system as they were", () => {
    expect(typefaceStack("book")).toBeNull();
    expect(typefaceStack("serif")).toBe(FALLBACK_FACE);
    expect(typefaceStack("wide")).toContain("Verdana");
    // A typeface that names nothing is the book serif too, not the publisher's.
    expect(typefaceStack("custom:nonsense" as ReaderTypeface)).toBe(FALLBACK_FACE);
    expect(typefaceStack("toString" as ReaderTypeface)).toBe(FALLBACK_FACE);
  });

  it("remembers the reader's font as the typeface, and takes a damaged choice for the default", () => {
    const stored = (value: string) => vi.stubGlobal("localStorage", { getItem: (key: string) => (key === TYPEFACE_KEY ? value : null) });
    stored(`custom:${ID}`);
    expect(readTypeface()).toBe(`custom:${ID}`);
    stored("custom:");
    expect(readTypeface()).toBe("serif");
    stored('custom:"; } body { display: none');
    expect(readTypeface()).toBe("serif");
    stored("sans");
    expect(readTypeface()).toBe("sans");
  });

  it("goes onto a chapter and comes off again with the next choice", () => {
    const set = new Map<string, string>();
    const attributes = new Map<string, string>();
    const root = {
      style: { setProperty: (name: string, value: string) => set.set(name, value) },
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name)
    } as unknown as HTMLElement;
    applyTypeChoice(root, { typeface: customTypeface(ID), spacing: "normal", align: "justify" });
    expect(set.get("--reader-font-family")).toContain(`"Leaflet font ${ID}"`);
    expect(attributes.get("data-leaflet-face")).toBe(`custom:${ID}`);
    applyTypeChoice(root, { typeface: "book", spacing: "normal", align: "justify" });
    expect(attributes.has("data-leaflet-face")).toBe(false);
  });
});

describe("the font's rule in a chapter's document", () => {
  /** As much of a document as the rule needs: a head, and elements found by id. */
  const chapter = () => {
    const head: Array<{ id: string; textContent: string; attributes: Map<string, string>; writes: number }> = [];
    const doc = {
      head: { appendChild: (style: (typeof head)[number]) => head.push(style) },
      getElementById: (id: string) => head.find((style) => style.id === id) ?? null,
      createElement: () => {
        let text = "";
        const style = {
          id: "",
          attributes: new Map<string, string>(),
          writes: 0,
          get textContent() {
            return text;
          },
          set textContent(value: string) {
            text = value;
            style.writes += 1;
          },
          getAttribute: (name: string) => style.attributes.get(name) ?? null,
          setAttribute: (name: string, value: string) => style.attributes.set(name, value),
          remove: () => head.splice(head.indexOf(style), 1)
        };
        return style;
      }
    };
    return { doc: doc as unknown as Document, head };
  };

  it("goes in once, in an element of its own", () => {
    const { doc, head } = chapter();
    const font = { id: ID, css: customFontFaceCss(ID, WOFF2) };
    applyCustomFont(doc, font);
    expect(head).toHaveLength(1);
    expect(head[0].id).toBe("reader-custom-font");
    expect(head[0].textContent).toBe(font.css);
    // Applied again with every change of type: the rule is not written twice.
    applyCustomFont(doc, font);
    applyCustomFont(doc, { ...font });
    expect(head).toHaveLength(1);
    expect(head[0].writes).toBe(1);
  });

  it("is replaced by another font's, and taken out when there is none", () => {
    const { doc, head } = chapter();
    applyCustomFont(doc, { id: ID, css: customFontFaceCss(ID, WOFF2) });
    const other = { id: OTHER, css: customFontFaceCss(OTHER, "data:font/otf;base64,T1RUTw==") };
    applyCustomFont(doc, other);
    expect(head).toHaveLength(1);
    expect(head[0].textContent).toBe(other.css);
    expect(head[0].attributes.get("data-font")).toBe(OTHER);
    applyCustomFont(doc, null);
    expect(head).toHaveLength(0);
    // Nothing to take out is no trouble, and neither is a font with no rule.
    applyCustomFont(doc, null);
    applyCustomFont(doc, { id: ID, css: "" });
    expect(head).toHaveLength(0);
  });

  it("does not stop a chapter that has no head", () => {
    const doc = { head: null, getElementById: () => null, createElement: () => ({ setAttribute: () => undefined }) } as unknown as Document;
    expect(() => applyCustomFont(doc, { id: ID, css: customFontFaceCss(ID, WOFF2) })).not.toThrow();
  });
});
