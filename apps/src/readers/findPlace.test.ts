import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { EpubCFI } from "epubjs";
import {
  decodeFindPlace, encodeFindPlace, findInBook, findInPieces, flattenPieces, isFindPlace, normalQuery, pickMatch,
  sectionPieces, type TextTreeNode
} from "./findPlace";
import { decodePlace, isPdfPlace } from "./pdfHighlights";
import { findFolded } from "./searchFold";

/** A stand-in for a DOM element: its children linked as the DOM links them. */
const el = (name: string, ...children: TextTreeNode[]): TextTreeNode => {
  children.forEach((child, at) => {
    child.nextSibling = children[at + 1] ?? null;
  });
  return { nodeType: 1, localName: name, firstChild: children[0] ?? null, nextSibling: null };
};
const text = (data: string): TextTreeNode => ({ nodeType: 3, data, firstChild: null, nextSibling: null });

/** The words a match covers, read back out of the pieces it points into. */
const wordsOf = (pieces: (string | null)[], match: { start: { piece: number; offset: number }; end: { piece: number; offset: number } }) => {
  if (match.start.piece === match.end.piece) {
    return (pieces[match.start.piece] ?? "").slice(match.start.offset, match.end.offset);
  }
  const middle = pieces.slice(match.start.piece + 1, match.end.piece).map((piece) => piece ?? "|");
  return [(pieces[match.start.piece] ?? "").slice(match.start.offset), ...middle, (pieces[match.end.piece] ?? "").slice(0, match.end.offset)].join("");
};

describe("a place that is a match of the library's search", () => {
  it("is written down and read back", () => {
    const place = { href: "Text/chapter 07.xhtml", spine: 9, nth: 3, query: "don't look" };
    const stored = encodeFindPlace(place);
    expect(stored).toBe("find:9:3:Text/chapter 07.xhtml\ndon't look");
    expect(decodeFindPlace(stored)).toEqual(place);
  });

  it("keeps an href and words with anything in them", () => {
    for (const place of [
      { href: "a:b/c%20d.html", spine: 0, nth: 0, query: "12:30 — “now”" },
      { href: "../notes/ch#1.xhtml", spine: 120, nth: 41, query: "naïve façade" },
      { href: "第一章.xhtml", spine: 2, nth: 0, query: "灯台" }
    ]) {
      expect(decodeFindPlace(encodeFindPlace(place)), place.href).toEqual(place);
    }
    // The words are one line, spaced as the text is: that is how they are looked for.
    expect(decodeFindPlace(encodeFindPlace({ href: "a.xhtml", spine: 1, nth: 2, query: "  two\n  lines " }))?.query).toBe("two lines");
    expect(encodeFindPlace({ href: "a\n.xhtml", spine: -4, nth: 1.9, query: "ab" })).toBe("find:0:1:a.xhtml\nab");
  });

  it("is not taken for a CFI or a PDF's place, nor they for it", () => {
    const stored = encodeFindPlace({ href: "ch1.xhtml", spine: 1, nth: 0, query: "pdf:7 epubcfi(/6/4!/4)" });
    expect(isFindPlace(stored)).toBe(true);
    expect(stored.startsWith("epubcfi(")).toBe(false);
    expect(isPdfPlace(stored)).toBe(false);
    expect(decodePlace(stored)).toBeNull();
    for (const other of ["epubcfi(/6/4!/4/2,/1:0,/1:5)", "pdf:7", "pdf:1:0,10000,5000,100", "ch1.xhtml", "", null, undefined]) {
      expect(isFindPlace(other), String(other)).toBe(false);
      expect(decodeFindPlace(other), String(other)).toBeNull();
    }
  });

  it("is nothing when it is not whole", () => {
    for (const broken of ["find:", "find:1:2:", "find:1:2:a.xhtml", "find:1:2:a.xhtml\n", "find:1:2:a.xhtml\n   ", "find:x:2:a.xhtml\nab", "find:1:a.xhtml\nab", "find:1:2:\nab"]) {
      expect(decodeFindPlace(broken), broken).toBeNull();
    }
  });
});

describe("a section's text, as the library's search reads it", () => {
  // The same page as `markup_comes_off_and_the_text_reads_as_on_the_page` in
  // src-tauri/src/search.rs, as a browser would have parsed it: the two must
  // read it the same, or the nth match there is not the nth here.
  const page = el(
    "html",
    el("head", el("title", text("The lighthouse in the head")), el("style", text("p { color: lighthouse }"))),
    el(
      "body",
      el("h1", text("Chapter One")),
      text("\n"),
      el("p", text("The keeper   climbed\n the "), el("em", text("light")), text("house stairs.")),
      el("p", text("“Who’s there?” he said & waited—nothing…")),
      el("script", text("var lighthouse = 1 < 2;")),
      { nodeType: 8, data: " a lighthouse in a comment ", firstChild: null, nextSibling: null },
      el("p", text("café &unknown; 3 < 4"))
    )
  );

  it("leaves out the head, scripts and styles, and parts two blocks with one space", () => {
    const { pieces, nodes } = sectionPieces(page);
    expect(flattenPieces(pieces).text).toBe("Chapter One The keeper climbed the lighthouse stairs. “Who’s there?” he said & waited—nothing… café &unknown; 3 < 4");
    expect(nodes).toHaveLength(pieces.length);
    expect(nodes.filter(Boolean).every((node) => node?.nodeType === 3)).toBe(true);
  });

  it("knows an element by its name, whatever its prefix or case, and reads CDATA as text", () => {
    const odd = el(
      "html",
      el("svg:STYLE", text("lost")),
      { nodeType: 1, nodeName: "XHTML:P", firstChild: text("one"), nextSibling: null },
      el("P", { nodeType: 4, data: "two <b> & three", firstChild: null, nextSibling: null }),
      el("span", text("four")),
      el("b", text("five"))
    );
    expect(flattenPieces(sectionPieces(odd).pieces).text).toBe("one two <b> & three fourfive");
  });

  it("keeps the place of every character", () => {
    const pieces = ["  The  light", null, "house\n", " keeper’s lamp "];
    const flat = flattenPieces(pieces);
    expect(flat.text).toBe("The light house keeper’s lamp");
    expect(flat.piece).toHaveLength(flat.text.length);
    [...flat.text].forEach((char, at) => {
      if (char !== " ") {
        expect(pieces[flat.piece[at]]?.[flat.offset[at]], `${at}`).toBe(char);
      }
    });
  });
});

describe("the words found again in a section", () => {
  it("finds them across an inline element and not across two blocks", () => {
    const pieces = ["A light", "house on the rock.", null, "Light", null, "house apart. The Lighthouse’s lamp."];
    const matches = findInPieces(pieces, "lighthouse");
    expect(matches.map((match) => wordsOf(pieces, match))).toEqual(["lighthouse", "Lighthouse"]);
    expect(matches[0]).toEqual({ start: { piece: 0, offset: 2 }, end: { piece: 1, offset: 5 } });
    expect(matches[1]).toEqual({ start: { piece: 5, offset: 17 }, end: { piece: 5, offset: 27 } });
  });

  it("finds a phrase over a line break in the file and over a paragraph's end", () => {
    const pieces = ["She said\n    don’t", null, null, "look back", null];
    expect(findInPieces(pieces, "said don't look").map((match) => wordsOf(pieces, match))).toEqual(["said\n    don’t||look"]);
    expect(findInPieces(pieces, "  SAID   don't ")).toHaveLength(1);
  });

  it("counts them as the library does: in order, overlapping ones too", () => {
    const pieces = ["aaa", null, "the cat; the CAT", "s; ", "The cat."];
    expect(findInPieces(pieces, "aa")).toHaveLength(2);
    const cats = findInPieces(pieces, "the cat");
    expect(cats.map((match) => match.start)).toEqual([{ piece: 2, offset: 0 }, { piece: 2, offset: 9 }, { piece: 4, offset: 0 }]);
    expect(pickMatch(cats, 1)).toBe(cats[1]);
    // Fewer here than the library counted (the file changed): the first, rather than nowhere.
    expect(pickMatch(cats, 7)).toBe(cats[0]);
    expect(pickMatch([], 0)).toBeNull();
  });

  it("finds nothing where there is nothing", () => {
    expect(findInPieces([], "lighthouse")).toEqual([]);
    expect(findInPieces([null, "  ", null], "lighthouse")).toEqual([]);
    expect(findInPieces(["a lighthouse"], "  ")).toEqual([]);
  });

  it("spaces the words as the text is spaced", () => {
    expect(normalQuery("  the  light\thouse \n")).toBe("the light house");
    expect(normalQuery("   ")).toBe("");
  });
});

describe("an apostrophe or a quotation mark, typed or typographic", () => {
  const found = (words: string, query: string) => findFolded(words, query).map(([start, end]) => words.slice(start, end));

  it("is found either way round", () => {
    expect(found("He said don’t, then don't, then DON‘T.", "don't")).toEqual(["don’t", "don't", "DON‘T"]);
    expect(found("He said don’t, then don't.", "don’t")).toEqual(["don’t", "don't"]);
    expect(found("“Quite so,” she said. \"Quite so.\"", "\"quite so")).toEqual(["“Quite so", "\"Quite so"]);
  });

  it("leaves the places of the rest where they were", () => {
    expect(found("l’été à l’hôtel", "l'ete")).toEqual(["l’été"]);
    expect(found("l’été à l’hôtel", "l’hôtel")).toEqual(["l’hôtel"]);
  });
});

describe("a match found again in a book open in epub.js", () => {
  // A section as epub.js holds it once loaded: a parsed document, and CFIs
  // written by epub.js's own EpubCFI. (The parser is the one epub.js itself
  // falls back to; it has no Range, so one is stood in with the four things
  // EpubCFI reads from it.)
  const BASE = "/6/8";
  // (The app's typings for epub.js know only the CFI read from a string.)
  const Cfi = EpubCFI as unknown as new (from: unknown, base: string) => { toString(): string };
  const parents =(node: Node | null) => {
    const chain: Node[] = [];
    for (let at = node; at; at = at.parentNode) {
      chain.unshift(at);
    }
    return chain;
  };
  const rangeIn = () => {
    const range = {
      startContainer: null as Node | null,
      startOffset: 0,
      endContainer: null as Node | null,
      endOffset: 0,
      collapsed: false,
      commonAncestorContainer: null as Node | null,
      setStart(node: Node, offset: number) {
        range.startContainer = node;
        range.startOffset = offset;
      },
      setEnd(node: Node, offset: number) {
        range.endContainer = node;
        range.endOffset = offset;
        const from = parents(range.startContainer);
        const to = parents(node);
        range.commonAncestorContainer = from.filter((step, at) => to[at] === step).pop() ?? null;
      },
      collapse() {
        range.setEnd(range.startContainer as Node, range.startOffset);
        range.collapsed = true;
      }
    };
    return range;
  };
  const sectionOf = (markup: string) => {
    const doc = new DOMParser().parseFromString(markup, "application/xhtml+xml") as unknown as Document;
    (doc as unknown as { createRange: () => unknown }).createRange = rangeIn;
    const state = { loads: 0, unloads: 0 };
    const section = {
      document: undefined as Document | undefined,
      load: async () => {
        state.loads += 1;
        section.document = doc;
      },
      unload: () => {
        state.unloads += 1;
      },
      // As epub.js's Section writes them.
      cfiFromRange: (range: unknown) => new Cfi(range, BASE).toString(),
      cfiFromElement: (element: unknown) => new Cfi(element, BASE).toString()
    };
    return { section, state, doc };
  };
  const bookOf = (sections: Record<string, unknown>, byIndex: unknown[] = []) => ({
    load: () => undefined,
    spine: { get: (target: string | number) => (typeof target === "number" ? byIndex[target] : sections[target]) ?? null }
  });
  /** The words between a range CFI's two ends, read back out of the document by epub.js's own steps. */
  const wordsAt = (doc: Document, cfi: string) => {
    const parsed = new EpubCFI(cfi) as unknown as {
      path: { steps: { index: number; type: string }[] };
      start: { steps: { index: number; type: string }[]; terminal: { offset: number } };
      end: { steps: { index: number; type: string }[]; terminal: { offset: number } };
    };
    const walk = (steps: { index: number; type: string }[]) => {
      // (A CFI's steps start from the root element.)
      let node: Node = doc.documentElement;
      for (const step of steps) {
        const children = Array.from({ length: node.childNodes.length }, (_, at) => node.childNodes[at]);
        node = children.filter((child) => child.nodeType === (step.type === "text" ? 3 : 1))[step.index];
      }
      return node;
    };
    const from = walk([...parsed.path.steps, ...parsed.start.steps]);
    const to = walk([...parsed.path.steps, ...parsed.end.steps]);
    if (from === to) {
      return (from as Text).data.slice(parsed.start.terminal.offset, parsed.end.terminal.offset);
    }
    return `${(from as Text).data.slice(parsed.start.terminal.offset)}…${(to as Text).data.slice(0, parsed.end.terminal.offset)}`;
  };

  const PAGE = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>The lighthouse in the head</title><style>p { color: lighthouse }</style></head>
  <body>
    <h1>The Lighthouse</h1>
    <p>A light<b>house</b> on the rock.</p>
    <p>She said don’t look, <!-- lighthouse --> and the <i>lighthouse</i> went dark.</p>
  </body>
</html>`;

  it("is the picked match, as a CFI of the words themselves", async () => {
    const { section, state, doc } = sectionOf(PAGE);
    const book = bookOf({ "text/ch7.xhtml": section });
    const places = await Promise.all([0, 1, 2].map((nth) => findInBook(book, { href: "text/ch7.xhtml", spine: 6, nth, query: "lighthouse" })));
    expect(places.map((place) => place?.found)).toEqual([true, true, true]);
    expect(places.map((place) => wordsAt(doc, place?.cfi ?? ""))).toEqual(["Lighthouse", "light…house", "lighthouse"]);
    expect(places.every((place) => place?.cfi.startsWith(`epubcfi(${BASE}!/4/`))).toBe(true);
    // The head's title is not a match, and the section is let go each time.
    expect(new Set(places.map((place) => place?.cfi)).size).toBe(3);
    expect(state).toEqual({ loads: 3, unloads: 3 });
  });

  it("finds a typed apostrophe where the book has a curly one", async () => {
    const { section, doc } = sectionOf(PAGE);
    const place = await findInBook(bookOf({ "text/ch7.xhtml": section }), { href: "text/ch7.xhtml", spine: 6, nth: 0, query: "said don't look" });
    expect(place?.found).toBe(true);
    expect(wordsAt(doc, place?.cfi ?? "")).toBe("said don’t look");
  });

  it("is the start of the section when the words are not there", async () => {
    const { section } = sectionOf(PAGE);
    const place = await findInBook(bookOf({ "text/ch7.xhtml": section }), { href: "text/ch7.xhtml", spine: 6, nth: 0, query: "no such words" });
    // Its first word: the heading's, in the body's first element.
    expect(place).toEqual({ cfi: `epubcfi(${BASE}!/4/2/1:0)`, found: false });
    // A section with no words at all is its body.
    const picture = sectionOf(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Plate</title></head><body> <img src="a.jpg"/> </body></html>`);
    const nowhere = await findInBook(bookOf({ "plate.xhtml": picture.section }), { href: "plate.xhtml", spine: 0, nth: 0, query: "lighthouse" });
    expect(nowhere?.found).toBe(false);
    expect(nowhere?.cfi.startsWith(`epubcfi(${BASE}!/`)).toBe(true);
  });

  it("knows the section by its place in the spine when its name is not the book's", async () => {
    const { section } = sectionOf(PAGE);
    const place = await findInBook(bookOf({}, [null, section]), { href: "elsewhere.xhtml", spine: 1, nth: 0, query: "rock" });
    expect(place?.found).toBe(true);
  });

  it("is nowhere when the book has no such section, or the section will not load", async () => {
    expect(await findInBook(bookOf({}), { href: "gone.xhtml", spine: 40, nth: 0, query: "lighthouse" })).toBeNull();
    expect(await findInBook(null, { href: "gone.xhtml", spine: 0, nth: 0, query: "lighthouse" })).toBeNull();
    const broken = { load: async () => Promise.reject(new Error("no")), unload: () => undefined };
    expect(await findInBook(bookOf({ "a.xhtml": broken }), { href: "a.xhtml", spine: 0, nth: 0, query: "lighthouse" })).toBeNull();
  });
});
