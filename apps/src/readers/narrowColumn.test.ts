import { describe, expect, it } from "vitest";
import {
  NARROW_COLUMN_PX,
  NARROW_CSS,
  applyNarrowBox,
  isNarrowColumn,
  isRaggedQuote,
  isVerseLike,
  markNarrowColumn,
  narrowBox,
  sideCap,
  textColumnWidth,
  type BoxFacts
} from "./narrowColumn";

// A made-up chapter and stylesheet, as a phone's WebView would compute it
// (16px type, a column of 360px), and as a desktop window would (900px):
//
//   <style>
//     .aside-note { margin: 0 30%; text-align: justify; }
//     .poem { width: 40%; }
//   </style>
//   <p class="aside-note">A lantern swung over the quiet harbour wall all night long.</p>
//   <div class="poem">Grey gulls wheel<br/>over the slate roofs<br/>and the tide turns<br/>home again</div>
const block = (over: Partial<BoxFacts> = {}): BoxFacts => ({
  tag: "p",
  chars: 300,
  picture: false,
  fontSize: 16,
  room: 360,
  width: 360,
  marginLeft: 0,
  marginRight: 0,
  paddingLeft: 0,
  paddingRight: 0,
  textIndent: 0,
  display: "block",
  float: "none",
  laidOut: false,
  inset: false,
  name: "",
  breaks: 0,
  rows: 0,
  italic: 0,
  ...over
});

const asideNote = (room: number) =>
  block({ name: "aside-note", chars: 58, room, width: room * 0.4, marginLeft: room * 0.3, marginRight: room * 0.3 });
const poem = (room: number) => block({ tag: "div", name: "poem", chars: 66, room, width: room * 0.4, breaks: 3 });

/** The rules of NARROW_CSS that are not in its fallback for a narrow frame. */
const narrowRules = NARROW_CSS.slice(0, NARROW_CSS.indexOf("@media"));

describe("a narrow column", () => {
  it("is one narrower than 560px", () => {
    expect(NARROW_COLUMN_PX).toBe(560);
    expect(isNarrowColumn(360)).toBe(true);
    expect(isNarrowColumn(559)).toBe(true);
    expect(isNarrowColumn(560)).toBe(false);
    expect(isNarrowColumn(900)).toBe(false);
    expect(isNarrowColumn(0)).toBe(false);
    expect(isNarrowColumn(Number.NaN)).toBe(false);
  });

  it("is measured as the reader sets it", () => {
    // A phone, scrolling: the frame less the reader's gutters.
    expect(textColumnWidth({ pages: false, frame: 412, pad: 20, measure: "100vw", fontSize: 18 })).toBe(372);
    // A desktop window, scrolling, with a line length chosen: the line length.
    expect(textColumnWidth({ pages: false, frame: 1400, pad: 24, measure: "34em", fontSize: 18 })).toBe(612);
    // A narrow desktop window: the window.
    expect(textColumnWidth({ pages: false, frame: 500, pad: 24, measure: "34em", fontSize: 18 })).toBe(452);
    // Pages: epub.js's column.
    expect(textColumnWidth({ pages: true, frame: 900, columnWidth: 420, pad: 24, measure: "100vw", fontSize: 18 })).toBe(420);
  });

  it("is marked on the chapter's document, and a wide one is not", () => {
    const attrs = new Set<string>();
    const doc = {
      documentElement: {
        toggleAttribute: (name: string, on: boolean) => (on ? attrs.add(name) : attrs.delete(name))
      }
    } as unknown as Document;
    markNarrowColumn(doc, 372);
    expect(attrs.has("data-leaflet-narrow")).toBe(true);
    markNarrowColumn(doc, 900);
    expect(attrs.has("data-leaflet-narrow")).toBe(false);
  });
});

describe("a block the book gives too much room", () => {
  it("has a margin of 30% a side capped, and its width given back", () => {
    const found = narrowBox(asideNote(360));
    // (The reader already gives a paragraph no left margin: only the right one is the book's.)
    expect(found?.marginLeft).toBeUndefined();
    expect(found?.marginRight).toBe("6.75em");
    expect(found?.free).toBe("box");
    // 30% of 360 is 108px; on a narrow column a side has at most 2em or a tenth of it.
    expect(sideCap(16, 360)).toBe(32);
  });

  it("keeps margins on blocks the reader leaves alone, capped", () => {
    // <aside class="aside-note"> is not a paragraph: both sides are the book's.
    const found = narrowBox({ ...asideNote(360), tag: "aside" });
    expect(found?.marginLeft).toBe("6.75em");
    expect(found?.marginRight).toBe("6.75em");
  });

  it("has a poem 40% wide set the column's width, ragged", () => {
    const found = narrowBox(poem(360));
    expect(found?.free).toBe("box");
    expect(found?.lines).toBe(true);
  });

  it("has wide padding, a large indent, a float and an inline-block box reined in", () => {
    const letter = narrowBox(block({ tag: "aside", paddingLeft: 80, paddingRight: 80, textIndent: 64 }));
    expect(letter).toMatchObject({ paddingLeft: "5em", paddingRight: "5em", textIndent: "4em" });
    expect(narrowBox(block({ tag: "div", float: "right", width: 150 }))?.free).toBe("box");
    expect(narrowBox(block({ tag: "div", display: "inline-block", width: 150 }))?.free).toBe("block");
    // A min-width wider than the column.
    expect(narrowBox(block({ tag: "div", width: 480 }))?.free).toBe("box");
  });

  it("leaves small indents, ordinary paragraphs and blockquotes of an em or two alone", () => {
    expect(narrowBox(block())).toBeNull();
    expect(narrowBox(block({ width: 344, marginRight: 16 }))).toBeNull();
    expect(narrowBox(block({ tag: "blockquote", width: 328, marginRight: 32 }))).toBeNull();
    expect(narrowBox(block({ tag: "aside", paddingLeft: 24, textIndent: 24 }))).toBeNull();
    // A raised initial floated beside its paragraph is no box of text.
    expect(narrowBox(block({ tag: "div", chars: 1, float: "left", width: 40 }))).toBeNull();
  });

  it("leaves pictures, and blocks a flex or grid parent lays out, alone", () => {
    expect(narrowBox({ ...poem(360), picture: true })).toBeNull();
    expect(narrowBox({ ...poem(360), name: "", breaks: 0, laidOut: true })).toBeNull();
  });

  it("leaves an inset's margins to the inset's own rules", () => {
    expect(narrowBox(block({ tag: "blockquote", inset: true, width: 280, marginLeft: 40, marginRight: 40 }))).toBeNull();
  });
});

describe("verse", () => {
  it("is told by its short broken lines or its name", () => {
    expect(isVerseLike({ name: "", breaks: 3, chars: 66 })).toBe(true);
    expect(isVerseLike({ name: "poem", breaks: 0, chars: 66 })).toBe(true);
    expect(isVerseLike({ name: "calibre12 epigraph", breaks: 0, chars: 200 })).toBe(true);
    expect(isVerseLike({ name: "z3998:verse", breaks: 0, chars: 200 })).toBe(true);
    // Prose with a break in it, and names that only contain the word.
    expect(isVerseLike({ name: "", breaks: 1, chars: 600 })).toBe(false);
    expect(isVerseLike({ name: "", breaks: 2, chars: 600 })).toBe(false);
    expect(isVerseLike({ name: "reverse", breaks: 0, chars: 100 })).toBe(false);
  });

  it("is a blockquote of short lines, or mostly in italics, set ragged", () => {
    // <blockquote><blockquote><blockquote><p><i>There is an evil feel...</i></p>...</blockquote>...
    const journal = block({ tag: "blockquote", inset: true, chars: 640, rows: 4, italic: 0.97 });
    expect(isRaggedQuote(journal)).toBe(true);
    expect(narrowBox(journal)?.lines).toBe(true);
    // Four lines of verse, each its own paragraph, upright.
    expect(isRaggedQuote(block({ tag: "blockquote", chars: 150, rows: 4 }))).toBe(true);
    // A quoted passage of prose, upright, and a div in italics: as the reader sets them.
    const quoted = block({ tag: "blockquote", chars: 640, rows: 3, italic: 0.1 });
    expect(isRaggedQuote(quoted)).toBe(false);
    expect(isRaggedQuote(block({ tag: "div", chars: 150, rows: 4, italic: 1 }))).toBe(false);
    expect(narrowBox(block({ tag: "blockquote", inset: true, chars: 640, rows: 3 }))).toBeNull();
  });
});

describe("the marks", () => {
  it("carry the book's lengths for the rules to cap", () => {
    const props = new Map<string, string>();
    const attrs = new Map<string, string>();
    const element = {
      style: { setProperty: (name: string, value: string) => props.set(name, value) },
      setAttribute: (name: string, value: string) => attrs.set(name, value)
    } as unknown as HTMLElement;
    applyNarrowBox(element, narrowBox(poem(360)));
    expect(attrs.get("data-leaflet-box")).toBe("free");
    expect(attrs.get("data-leaflet-lines")).toBe("1");
    applyNarrowBox(element, narrowBox({ ...asideNote(360), tag: "aside" }));
    expect(attrs.get("data-leaflet-box")).toBe("ml mr in free");
    expect(props.get("--leaflet-box-ml")).toBe("6.75em");
    expect(props.get("--leaflet-box-mr")).toBe("6.75em");
  });
});

describe("the rules", () => {
  it("apply to a narrow column only", () => {
    const selectors = narrowRules
      .split("}")
      .map((rule) => rule.split("{")[0].trim())
      .filter(Boolean)
      .flatMap((list) => list.split(/,\s*\n/).map((one) => one.trim()));
    expect(selectors.length).toBeGreaterThan(5);
    selectors.forEach((selector) => expect(selector.startsWith("html[data-leaflet-narrow] body")).toBe(true));
    // And, scrolling, a frame narrower than a narrow column.
    expect(NARROW_CSS).toContain('@media (max-width: 559.98px) {\n  html:not([data-leaflet-layout="pages"]) body [data-leaflet-inset]');
  });

  it("cap a side at 2em or a tenth of the column, and the book's own lengths below that stand", () => {
    expect(narrowRules).toContain("html[data-leaflet-narrow] body [data-leaflet-box~=\"mr\"] { margin-right: min(var(--leaflet-box-mr, 0px), 2em, 10%) !important; }");
    expect(narrowRules).toContain("html[data-leaflet-narrow] body [data-leaflet-box~=\"pl\"] { padding-left: min(var(--leaflet-box-pl, 0px), 2em, 10%) !important; }");
    expect(narrowRules).toContain("text-indent: clamp(-2em, var(--leaflet-box-ti, 0px), 2em) !important;");
  });

  it("cap the book's insets, and an inset inside an inset adds nothing", () => {
    // A Kindle book's indent: <blockquote><blockquote><blockquote>, each kept as an inset (bookBlocks.ts).
    expect(narrowRules).toContain(
      "html[data-leaflet-narrow] body [data-leaflet-inset] { margin-left: min(var(--leaflet-inset-left, 5%), 2em, 10%) !important; margin-right: min(var(--leaflet-inset-right, 0%), 2em, 10%) !important; }"
    );
    expect(narrowRules).toContain(
      'html[data-leaflet-narrow] body :is([data-leaflet-inset], [data-leaflet-hang], [data-leaflet-box~="in"]) :is([data-leaflet-inset], [data-leaflet-box~="mr"]) { margin-right: 0 !important; }'
    );
  });

  it("give a sized, floated or inline-block text box the column's width", () => {
    expect(narrowRules).toContain(
      'html[data-leaflet-narrow] body [data-leaflet-box~="free"] { width: auto !important; min-width: 0 !important; max-width: 100% !important; float: none !important; }'
    );
    expect(narrowRules).toContain('html[data-leaflet-narrow] body [data-leaflet-box~="block"] { display: block !important; }');
  });

  it("set verse ragged, unless the book centred it", () => {
    expect(narrowRules).toMatch(
      /html\[data-leaflet-narrow\] body \[data-leaflet-lines\]:not\(\[data-leaflet-set\]\),\s*html\[data-leaflet-narrow\] body \[data-leaflet-lines\] :where\(p, div\):not\(\[data-leaflet-set\]\),/
    );
  });

  it("set the text of an inset inside an inset ragged, unless the book centred it", () => {
    const nested = "html[data-leaflet-narrow] body [data-leaflet-inset] [data-leaflet-inset]";
    expect(narrowRules).toContain(`${nested}:not([data-leaflet-set]),`);
    expect(narrowRules).toContain(
      `${nested} :where(p, div):not([data-leaflet-set]) {
    text-align: start !important;`
    );
  });

  it("never touch pictures, tables or the reader's own margins", () => {
    expect(NARROW_CSS).not.toMatch(/\b(img|svg|table|td|ul|ol|li)\b/);
    expect(NARROW_CSS).not.toMatch(/body\s*\{/);
    expect(NARROW_CSS).not.toContain("--reader-");
  });
});
