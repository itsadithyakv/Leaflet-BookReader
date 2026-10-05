import { describe, expect, it } from "vitest";
import {
  CONTENTS_VERSION,
  decideContents,
  findChapters,
  fromContentsPage,
  fromHeadings,
  fromPatterns,
  fromSections,
  fromStyled,
  judgeContents,
  keepContents,
  linkResolver,
  matterByText,
  mergeContents,
  numberFrom,
  readHeading,
  readKept,
  styleHints,
  tidyLabel,
  treeOf,
  type OwnEntry,
  type ScannedBlock,
  type ScannedLink,
  type ScannedSection
} from "./autoContents";
import type { TocItem } from "./readerTypes";

// A made-up book, a section at a time: what contentsScan.ts would report of small markup like
//   <h2>One</h2><p>…</p>     or     <p class="ct"><b>Chapter 1.</b></p><p class="ct"><b>The Road</b></p><p>…</p>
// Each line is [text, flags]; flags: h1..h6 (a real heading), b (bold), c (centred), L (larger), ^ (first thing in
// the section), / (after a break), img (its words are a picture's alt), .name (its class), #id.
type Line = [string, string?];
const TEXT = 6000;

const block = (text: string, flags: string, order: number, at: number, section: number): ScannedBlock => {
  const level = /\bh([1-6])\b/.exec(flags);
  const cls = /\.([\w-]+)/.exec(flags)?.[1];
  const id = /#([\w-]+)/.exec(flags)?.[1];
  const tag = level ? `h${level[1]}` : "p";
  return {
    text,
    order,
    tag,
    style: cls ? `${tag}.${cls}` : tag,
    anchor: id ?? `epubcfi(/6/${(section + 1) * 2}!/4/${(order + 1) * 2})`,
    at,
    head: flags.includes("^"),
    marked: Boolean(level),
    level: level ? Number(level[1]) : 0,
    bold: /\bb\b/.test(flags) || Boolean(level),
    centred: /\bc\b/.test(flags),
    larger: /\bL\b/.test(flags),
    afterBreak: flags.includes("/"),
    picture: flags.includes("img")
  };
};

/** A section: its candidate lines (their `order` leaves room for the paragraphs between), its size, more. */
const section = (index: number, lines: Line[], more: Partial<ScannedSection> & { gap?: number } = {}): ScannedSection => {
  const gap = more.gap ?? 20;
  const blocks = lines.map(([text, flags = ""], position) => {
    // "+": straight after the line before it (a title under its number).
    const order = flags.includes("+") ? -1 : position * gap;
    return block(text, flags, order, lines.length > 1 ? position / lines.length : 0, index);
  });
  blocks.forEach((item, position) => {
    if (item.order < 0) {
      item.order = blocks[position - 1].order + 1;
    }
  });
  const styles: Record<string, number> = { p: 60 };
  blocks.forEach((item) => {
    styles[item.style] = (styles[item.style] ?? 0) + 1;
  });
  return { index, href: `text/part${index}.xhtml`, linear: true, chars: TEXT, opening: "It was the first of the month and", type: "", pictures: 0, blocks, styles, links: [], ...more };
};

const cover = (index = 0): ScannedSection => section(index, [], { chars: 0, pictures: 1, opening: "" });
const labels = (entries: Array<{ label: string }>) => entries.map((entry) => entry.label);
const own = (entries: Array<[string, number, string?]>): OwnEntry[] => entries.map(([label, at, anchor]) => ({ label, section: at, anchor: anchor ?? null }));
const placeOf = (href: string) => {
  const [path, anchor] = href.split("#");
  const at = /part(\d+)/.exec(path);
  return { section: at ? Number(at[1]) : undefined, anchor: anchor ?? null };
};

describe("readHeading", () => {
  it("reads chapters, parts and numbers alone", () => {
    expect(readHeading("Chapter 12")).toMatchObject({ kind: "chapter", number: 12, label: "Chapter 12" });
    expect(readHeading("CHAPTER TWELVE")).toMatchObject({ kind: "chapter", number: 12 });
    expect(readHeading("Chapter XII: The Road")).toMatchObject({ kind: "chapter", number: 12, label: "Chapter XII", title: "The Road" });
    expect(readHeading("Chapter 1.")).toMatchObject({ kind: "chapter", number: 1, title: "" });
    expect(readHeading("Part Two")).toMatchObject({ kind: "part", number: 2, label: "Part Two" });
    expect(readHeading("BOOK ONE")).toMatchObject({ kind: "part", number: 1 });
    expect(readHeading("The Third Part")).toMatchObject({ kind: "part", number: 3 });
    expect(readHeading("12")).toMatchObject({ kind: "numeral", number: 12 });
    expect(readHeading("XII.")).toMatchObject({ kind: "numeral", number: 12 });
    expect(readHeading("Prologue")).toMatchObject({ kind: "named", label: "Prologue" });
    expect(readHeading("EPILOGUE: Ten Years On")).toMatchObject({ kind: "named", label: "Epilogue", title: "Ten Years On" });
  });

  it("does not read sentences and titles", () => {
    expect(readHeading("Part of the reason he left was the weather")).toBeNull();
    expect(readHeading("Book me a room")).toBeNull();
    expect(readHeading("Part i was told to learn")).toBeNull();
    expect(readHeading("The Road")).toBeNull();
    expect(readHeading("Chapter and verse")).toBeNull();
    expect(readHeading("Politeness.")).toBeNull();
    expect(readHeading("MIX")).toBeNull();
    expect(readHeading("")).toBeNull();
  });

  it("knows numbers written out and in numerals", () => {
    expect(numberFrom("twenty-one")).toBe(21);
    expect(numberFrom("Forty")).toBe(40);
    expect(numberFrom("XLII")).toBe(42);
    expect(numberFrom("iiii")).toBeNull();
    expect(numberFrom("seventh")).toBe(7);
    expect(numberFrom("road")).toBeNull();
  });
});

describe("labels", () => {
  it("does not shout a heading set in capitals", () => {
    expect(tidyLabel("THE SECOND NIGHT")).toBe("The Second Night");
    expect(tidyLabel("A TALE OF THE SEA")).toBe("A Tale of the Sea");
    expect(tidyLabel("CHAPTER XII")).toBe("Chapter XII");
    expect(tidyLabel("The iPhone years")).toBe("The iPhone years");
    expect(tidyLabel("  Two\n  lines ")).toBe("Two lines");
  });

  it("names front and back matter plainly", () => {
    expect(matterByText("CONTENTS")).toEqual({ label: "Contents", side: "front" });
    expect(matterByText("Acknowledgments")).toEqual({ label: "Acknowledgements", side: "back" });
    expect(matterByText("About the Author")).toEqual({ label: "About the author", side: "back" });
    expect(matterByText("Also by Mara Venn")).toEqual({ label: "Also by", side: "back" });
    expect(matterByText("The Index of Refraction")).toBeNull();
    expect(matterByText("Notes from a Small Room")).toBeNull();
  });
});

describe("real headings", () => {
  it("lists the heading each section opens with", () => {
    const book = [cover(), ...[1, 2, 3, 4, 5].map((n) => section(n, [[`The ${["Gate", "Yard", "Well", "Roof", "Road"][n - 1]}`, "h2 ^"]]))];
    const found = fromHeadings(book);
    expect(found?.confident).toBe(true);
    expect(labels(found?.entries ?? [])).toEqual(["The Gate", "The Yard", "The Well", "The Roof", "The Road"]);
    expect(found?.entries[0]).toMatchObject({ section: 1, anchor: null, kind: "chapter" });
  });

  it("joins a number and its title, and folds a subtitle", () => {
    const book = [1, 2, 3].map((n) =>
      section(n, [
        [String(n), "h2 ^"],
        ["MARA", "h2 +"],
        ["A Cold Morning", "h2 +"],
        ["being the first of her letters", "h4 +"]
      ])
    );
    expect(labels(fromHeadings(book)?.entries ?? [])).toEqual(["1 · Mara · A Cold Morning", "2 · Mara · A Cold Morning", "3 · Mara · A Cold Morning"]);
  });

  it("finds every chapter of a book that is one file", () => {
    const book = [cover(), section(1, [["One", "h2 ^ #c1"], ["Two", "h2 #c2"], ["Three", "h2 #c3"], ["Four", "h2 #c4"]], { chars: 90000 })];
    const found = fromHeadings(book);
    expect(found?.confident).toBe(true);
    expect(found?.entries.map((entry) => entry.anchor)).toEqual([null, "c2", "c3", "c4"]);
  });

  it("nests the smaller headings under the larger ones", () => {
    const book = [
      section(1, [["The First Story", "h2 ^"], ["THE FIRST NIGHT", "h5 #n1"]]),
      section(2, [["THE SECOND NIGHT", "h5 ^"]]),
      section(3, [["THE THIRD NIGHT", "h5 ^"]]),
      section(4, [["The Second Story", "h2 ^"]])
    ];
    const found = fromHeadings(book);
    expect(found?.entries.map((entry) => [entry.label, entry.depth])).toEqual([
      ["The First Story", 0],
      ["The First Night", 1],
      ["The Second Night", 1],
      ["The Third Night", 1],
      ["The Second Story", 0]
    ]);
  });

  it("is not sure of two headings in a long book", () => {
    // Two shop signs set as h1 by a careless conversion, in a book of three huge files.
    const book = [section(0, [], { chars: 200000 }), section(1, [["PICKLES", "h1 ^"]], { chars: 10 }), section(2, [["JAMS", "h1 ^"]], { chars: 200000 }), section(3, [], { chars: 240000 })];
    expect(fromHeadings(book)?.confident).toBe(false);
  });

  it("takes a heading picture's words", () => {
    const book = [1, 2, 3].map((n) => section(n, [[`Chapter ${n}`, "h1 ^ img"]]));
    expect(labels(fromHeadings(book)?.entries ?? [])).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"]);
  });
});

describe("lines that read as headings", () => {
  // Several chapters to a file, as bold paragraphs with no ids; two chapters lost their "Chapter N." line.
  const huge = (): ScannedSection[] => [
    cover(),
    section(
      1,
      [
        // The book's own list, as plain paragraphs: not headings.
        ["Chapter 1.", ""],
        ["Chapter 2.", ""],
        ["Chapter 3.", ""],
        ["Chapter 1.", "b"],
        ["The Orchard", "b +"],
        // A sign in the story: bold, short, and not a chapter.
        ["Silence.", "b /"],
        ["Order.", "b +"],
        ["Chapter 2.", "b"],
        ["The Ferry", "b +"],
        ["The Long Road North", "b"]
      ],
      { chars: 180000 }
    ),
    section(2, [["Chapter 4.", "b"], ["A Lamp", "b +"], ["Chapter 5.", "b"], ["Salt", "b +"]], { chars: 150000 })
  ];

  it("finds numbered chapters inside a file, with the title on the next line", () => {
    const found = fromPatterns(huge());
    expect(found?.confident).toBe(true);
    expect(labels(found?.entries ?? [])).toEqual(["Chapter 1 · The Orchard", "Chapter 2 · The Ferry", "Chapter 3 · The Long Road North", "Chapter 4 · A Lamp", "Chapter 5 · Salt"]);
  });

  it("lands each on its own line: an id, or a CFI where there is none", () => {
    const found = fromPatterns(huge());
    expect(found?.entries.every((entry) => entry.anchor?.startsWith("epubcfi("))).toBe(true);
    expect(new Set(found?.entries.map((entry) => entry.anchor)).size).toBe(5);
  });

  it("names the book's plain list of chapters, at the head of the first file, as the contents", () => {
    const found = findChapters(huge());
    expect(found.entries.slice(0, 3).map((entry) => [entry.label, entry.section, entry.anchor === null, entry.kind])).toEqual([
      ["Cover", 0, true, "front"],
      ["Contents", 1, true, "front"],
      ["Chapter 1 · The Orchard", 1, false, "chapter"]
    ]);
  });

  it("leaves a sign and the book's plain list out", () => {
    const all = labels(fromPatterns(huge())?.entries ?? []).join(" ");
    expect(all).not.toMatch(/Silence|Order/);
    expect(fromPatterns(huge())?.entries.length).toBe(5);
  });

  it("does not guess when the lines between do not match the numbers missing", () => {
    const book = huge();
    // A second bold line between chapters 2 and 4: one number missing, two candidates.
    book[1].blocks.push(block("Another Bold Line", "b", 500, 0.95, 1));
    expect(labels(fromPatterns(book)?.entries ?? [])).toEqual(["Chapter 1 · The Orchard", "Chapter 2 · The Ferry", "Chapter 4 · A Lamp", "Chapter 5 · Salt"]);
  });

  it("wants numbers that run on", () => {
    // "Chapter 7" quoted in the text, bold; then nothing else.
    const book = [section(1, [["Chapter 7", "b"]]), section(2, []), section(3, [])];
    expect(fromPatterns(book)).toBeNull();
  });

  it("takes a number alone only at the head of a section", () => {
    const heads = [1, 2, 3, 4].map((n) => section(n, [[String(n), "^ c"], ["Winter", "c +"]]));
    expect(labels(fromPatterns(heads)?.entries ?? [])).toEqual(["1 · Winter", "2 · Winter", "3 · Winter", "4 · Winter"]);
    const stray = [section(1, [["1", "c"], ["2", "c"], ["3", "c"]], { chars: 30000 })];
    expect(fromPatterns(stray)).toBeNull();
  });

  it("puts chapters under their parts, and lets the count start again", () => {
    const book = [
      section(1, [["PART ONE", "c ^"]], { chars: 40 }),
      section(2, [["Chapter 1", "c ^"]]),
      section(3, [["Chapter 2", "c ^"]]),
      section(4, [["PART TWO", "c ^"]], { chars: 40 }),
      section(5, [["Chapter 1", "c ^"]]),
      section(6, [["Chapter 2", "c ^"]])
    ];
    const found = fromPatterns(book);
    expect(found?.entries.map((entry) => [entry.label, entry.depth, entry.kind])).toEqual([
      ["Part One", 0, "part"],
      ["Chapter 1", 1, "chapter"],
      ["Chapter 2", 1, "chapter"],
      ["Part Two", 0, "part"],
      ["Chapter 1", 1, "chapter"],
      ["Chapter 2", 1, "chapter"]
    ]);
    expect(treeOf(found?.entries ?? [], book.map((item) => item.href)).map((item) => [item.label, item.subitems?.length])).toEqual([
      ["Part One", 2],
      ["Part Two", 2]
    ]);
  });
});

describe("paragraphs set as headings", () => {
  const styledBook = () => [
    cover(),
    ...[1, 2, 3, 4, 5].map((n) =>
      section(n, [
        [String(n), "^ c .cn"],
        [["Dawn", "Noon", "Dusk", "Night", "Rain"][n - 1], "c L + .ct"],
        // A notice in the middle of the chapter: centred, bold, short. Not a chapter.
        ["NO ENTRY", "c b .sign"]
      ])
    )
  ];

  it("finds a style the book keeps for the head of its sections", () => {
    const found = fromStyled(styledBook());
    expect(found?.confident).toBe(true);
    expect(labels(found?.entries ?? [])).toEqual(["1 · Dawn", "2 · Noon", "3 · Dusk", "4 · Night", "5 · Rain"]);
  });

  it("does not take a centred, bold, short paragraph in the middle of a chapter", () => {
    expect(labels(fromStyled(styledBook())?.entries ?? []).join(" ")).not.toMatch(/ENTRY/i);
    // Nor when the style is the body's own (every paragraph bold, say): it is not kept for heads.
    const plain = [1, 2, 3].map((n) => {
      const one = section(n, [["It was late.", "^ b"]]);
      one.styles = { p: 200 };
      return one;
    });
    expect(fromStyled(plain)).toBeNull();
  });
});

describe("the book's own contents page", () => {
  const link = (text: string, to: number, anchor: string | null = null, at: number | null = 0): ScannedLink => ({ text, section: to, anchor, at });
  const paged = () => {
    const page = section(1, [["Contents", "h2 ^"]], { chars: 70, links: [link("Foreword", 2), link("The Gate", 3), link("The Yard", 3, "yard", 0.5), link("The Well", 4), link("The Roof", 5), link("Acknowledgments", 6)] });
    return [cover(), page, section(2, []), section(3, [], { chars: 40000 }), section(4, []), section(5, []), section(6, [], { chars: 900 })];
  };

  it("is the first source: the publisher's titles and targets", () => {
    const found = findChapters(paged());
    expect(found.source).toBe("page");
    expect(found.entries.map((entry) => [entry.label, entry.section, entry.anchor, entry.kind])).toEqual([
      ["Foreword", 2, null, "chapter"],
      ["The Gate", 3, null, "chapter"],
      ["The Yard", 3, "yard", "chapter"],
      ["The Well", 4, null, "chapter"],
      ["The Roof", 5, null, "chapter"],
      ["Acknowledgments", 6, null, "back"]
    ]);
  });

  it("is passed over when its links lead nowhere", () => {
    const book = paged();
    // Every link to the top of one file: anchors lost in a conversion.
    book[1].links = ["One", "Two", "Three", "Four", "Five"].map((text) => link(text, 3, `lost-${text}`, null));
    expect(fromContentsPage(book)).toBeNull();
  });

  it("is not any page with a few links in it", () => {
    const book = paged();
    book[1].chars = 9000;
    expect(fromContentsPage(book)).toBeNull();
  });
});

describe("a section each, when nothing surer is found", () => {
  it("skips the cover and a page that is one picture, and names what it can", () => {
    const book = [
      cover(),
      section(1, [], { chars: 300, opening: "Copyright © 2011 by the author. All rights reserved." }),
      section(2, [], { chars: 0, pictures: 1, opening: "" }),
      section(3, [], { opening: "The rain had stopped by the time we reached the gate and nobody spoke" }),
      section(4, [["A Letter", "^ c"]]),
      section(5, [["Acknowledgments", "^ c"]], { chars: 800 })
    ];
    const found = fromSections(book);
    expect(found.confident).toBe(false);
    expect(found.entries.map((entry) => [entry.label, entry.section, entry.kind])).toEqual([
      ["Cover", 0, "front"],
      ["Copyright", 1, "front"],
      ["Section 1 · The rain had stopped by the…", 3, "chapter"],
      ["Section 2 · A Letter", 4, "chapter"],
      ["Acknowledgements", 5, "back"]
    ]);
  });
});

describe("whether the book's own contents will do", () => {
  const chapters = () => [cover(), ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => section(n, [[`Chapter ${n}`, "h2 ^"]]))];

  it("replaces contents that say nothing", () => {
    const found = findChapters(chapters());
    expect(judgeContents([], chapters(), found).use).toBe("made");
    expect(judgeContents(own([["Start", 0]]), chapters(), found)).toEqual({ use: "made", reason: "one entry" });
    expect(judgeContents(own([["A", 1], ["B", 1], ["C", 1]]), chapters(), found).use).toBe("made");
    expect(judgeContents(own([["Cover", 0], ["Title Page", 0, "t"], ["Copyright", 0, "c"]]), chapters(), found).use).toBe("made");
  });

  it("leaves an honest short list alone", () => {
    // A novella in three parts, three files, three entries.
    const novella = [cover(), section(1, [["Part One", "h2 ^"]]), section(2, [["Part Two", "h2 ^"]]), section(3, [["Part Three", "h2 ^"]])];
    const found = findChapters(novella);
    expect(judgeContents(own([["Part One", 1], ["Part Two", 2], ["Part Three", 3]]), novella, found).use).toBe("own");
    // Full contents, and chapters with sections of their own inside them: still the book's.
    const full = chapters();
    full[3].blocks.push(block("A Digression", "h2 #dig", 40, 0.5, 3));
    expect(judgeContents(own(full.slice(1).map((item) => [`Chapter ${item.index}`, item.index] as [string, number])), full, findChapters(full)).use).toBe("own");
  });

  it("adds to contents that are real but thin", () => {
    // Two parts listed; eight chapters open eight files.
    const verdict = judgeContents(own([["Cover", 0], ["Chapter 1", 1], ["Chapter 5", 5]]), chapters(), findChapters(chapters()));
    expect(verdict.use).toBe("merged");
  });

  it("keeps the book's own when the finder is not sure", () => {
    const vague = [cover(), section(1, [], { chars: 90000 }), section(2, [], { chars: 90000 }), section(3, [], { chars: 90000 })];
    expect(judgeContents(own([["Book One", 1], ["Book Two", 3]]), vague, findChapters(vague)).use).toBe("own");
  });
});

describe("the list", () => {
  it("keeps thin contents as the top level, with what was found beneath", () => {
    const book = [
      cover(),
      section(1, [["The First Story", "h2 ^"], ["THE FIRST NIGHT", "h5 #n1"]]),
      section(2, [["THE SECOND NIGHT", "h5 ^"]]),
      section(3, [["THE THIRD NIGHT", "h5 ^"]]),
      section(4, [["MORNING", "h5 ^"]]),
      section(5, [["The Second Story", "h2 ^"]]),
      section(6, [["ABOUT THE AUTHOR", "h5 ^"], ["HER OTHER BOOKS", "h5 #more"]], { chars: 900 })
    ];
    const mine: TocItem[] = [
      { label: "Cover", href: "text/part0.xhtml" },
      { label: "The First Story", href: "text/part1.xhtml" },
      { label: "The Second Story", href: "text/part5.xhtml" },
      { label: "About the Author", href: "text/part6.xhtml" }
    ];
    const decision = decideContents(mine, placeOf, book);
    expect(decision.use).toBe("merged");
    expect(decision.toc.map((item) => item.label)).toEqual(["Cover", "The First Story", "The Second Story", "About the Author"]);
    expect(decision.toc[1].subitems?.map((item) => [item.label, item.href])).toEqual([
      ["The First Night", "text/part1.xhtml#n1"],
      ["The Second Night", "text/part2.xhtml"],
      ["The Third Night", "text/part3.xhtml"],
      ["Morning", "text/part4.xhtml"]
    ]);
    // Nothing under front or back matter, and nothing twice.
    expect(decision.toc[3].subitems ?? []).toEqual([]);
    expect(decision.toc[2].subitems ?? []).toEqual([]);
  });

  it("does not add what the book already lists", () => {
    const entries = findChapters([cover(), ...[1, 2, 3].map((n) => section(n, [[`Chapter ${n}`, "h2 ^"]]))]).entries;
    const mine: TocItem[] = [{ label: "One", href: "text/part1.xhtml" }, { label: "Two", href: "text/part2.xhtml" }];
    const merged = mergeContents(mine, placeOf, entries, ["text/part0.xhtml", "text/part1.xhtml", "text/part2.xhtml", "text/part3.xhtml"]);
    expect(merged.map((item) => [item.label, (item.subitems ?? []).map((sub) => sub.label)])).toEqual([
      ["One", []],
      ["Two", ["Chapter 3"]]
    ]);
  });

  it("makes a list for a book with one entry, front matter named and the cover first", () => {
    const book = [cover(), section(1, [["Copyright", "^ c"]], { chars: 500 }), ...[2, 3, 4, 5].map((n) => section(n, [[`Chapter ${n - 1}`, "h2 ^"]]))];
    const decision = decideContents([{ label: "Start", href: "text/part0.xhtml" }], placeOf, book);
    expect(decision).toMatchObject({ use: "made", source: "headings" });
    expect(decision.toc.map((item) => item.label)).toEqual(["Cover", "Copyright", "Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4"]);
    expect(decision.toc[2].href).toBe("text/part2.xhtml");
  });

  it("falls back to sections, and says so, when it finds no headings", () => {
    const book = [cover(), section(1, [], { chars: 90000 }), section(2, [], { chars: 90000 })];
    const decision = decideContents([], placeOf, book);
    expect(decision).toMatchObject({ use: "made", source: "sections" });
    expect(decision.toc.map((item) => item.label)).toEqual(["Cover", "Section 1 · It was the first of the…", "Section 2 · It was the first of the…"]);
  });
});

describe("kept for next time", () => {
  it("is read back for the same book and the same finder only", () => {
    const decision = decideContents([], placeOf, [cover(), ...[1, 2, 3].map((n) => section(n, [[`Chapter ${n}`, "h2 ^"]]))]);
    const raw = JSON.stringify(keepContents(decision, 4, { "text/part1.xhtml#x": 0.5 }));
    expect(readKept(raw, 4)).toMatchObject({ use: "made", source: "headings", within: { "text/part1.xhtml#x": 0.5 } });
    expect(readKept(raw, 5)).toBeNull();
    expect(readKept(raw.replace(`"v":${CONTENTS_VERSION}`, `"v":${CONTENTS_VERSION + 1}`), 4)).toBeNull();
    expect(readKept("{not json", 4)).toBeNull();
    expect(readKept(null, 4)).toBeNull();
    // The book's own contents: only the verdict is kept.
    const kept = keepContents({ use: "own", reason: "", source: null, toc: [{ label: "x", href: "y" }], within: {} }, 4, {});
    expect(kept.toc).toBeNull();
    expect(readKept(JSON.stringify(kept), 4)).toMatchObject({ use: "own", toc: null });
  });
});

describe("what the stylesheets and links say", () => {
  it("reads a class's weight, alignment and size", () => {
    const hints = styleHints(`
      /* chapter title */
      p.ct, .cn { text-align: center; font-size: 1.4em }
      .b { font-weight: bold }
      .pb { page-break-before: always }
      .tx { text-indent: 1em; font-size: small }
      div > p.x { font-weight: 700 }
    `);
    expect(hints.get("ct")).toEqual({ bold: false, centred: true, larger: true, breaks: false });
    expect(hints.get("cn")?.centred).toBe(true);
    expect(hints.get("b")?.bold).toBe(true);
    expect(hints.get("pb")?.breaks).toBe(true);
    expect(hints.has("tx")).toBe(false);
    expect(hints.has("x")).toBe(false);
  });

  it("resolves a link from the file it is written in", () => {
    const index = (path: string) => ({ "text/part2.xhtml": 2, "cover.xhtml": 0, "text/a b.xhtml": 5 })[path];
    const from = linkResolver("text/toc.xhtml", index);
    expect(from("part2.xhtml#c%201")).toEqual({ section: 2, anchor: "c 1" });
    expect(from("../cover.xhtml")).toEqual({ section: 0, anchor: null });
    expect(from("a%20b.xhtml")).toEqual({ section: 5, anchor: null });
    expect(from("https://example.com/x")).toBeNull();
    expect(from("missing.xhtml")).toBeNull();
  });
});
