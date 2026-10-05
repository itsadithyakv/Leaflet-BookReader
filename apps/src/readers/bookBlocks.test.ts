import { describe, expect, it } from "vitest";
import {
  breakRoom,
  endsAsSentence,
  entryForLine,
  flattenedList,
  headingSize,
  insetsAreMargins,
  isLoneBullet,
  isParagraphDiv,
  isSetApart,
  keptAlign,
  keptHang,
  keptInset,
  median,
  pictureRoom,
  ruleKind,
  sizedByWindow,
  unsizeCss,
  verseRuns,
  type BlockFacts,
  type VerseLine
} from "./bookBlocks";

// A block as a made-up stylesheet would leave it. The running text is 16px in a column 600px wide.
const block = (over: Partial<BlockFacts> = {}): BlockFacts => ({
  tag: "p",
  leaf: true,
  chars: 400,
  picture: false,
  align: "justify",
  size: 16,
  running: 16,
  marginLeft: 0,
  marginRight: 0,
  marginTop: 0,
  marginBottom: 0,
  textIndent: 16,
  room: 600,
  ...over
});

describe("what the publisher centred or set to the right", () => {
  it("is kept", () => {
    // <p class="cn">1</p> with .cn { text-align: center }
    expect(keptAlign(block({ align: "center", chars: 1 }))).toBe("center");
    expect(keptAlign(block({ align: "-webkit-center", chars: 12 }))).toBe("center");
    // <p class="credit">— from a made-up book</p> with .credit { text-align: right }
    expect(keptAlign(block({ align: "right" }))).toBe("right");
    expect(keptAlign(block({ align: "end" }))).toBe("right");
  });

  it("leaves ordinary paragraphs to the reader's own choice", () => {
    expect(keptAlign(block({ align: "justify" }))).toBeNull();
    expect(keptAlign(block({ align: "left" }))).toBeNull();
    expect(keptAlign(block({ align: "start" }))).toBeNull();
  });

  it("keeps a picture alone in a centred paragraph in the middle", () => {
    // <p class="fig"><img src="title.jpg"/></p>
    expect(keptAlign(block({ align: "center", chars: 0, picture: true }))).toBe("center");
    expect(keptAlign(block({ align: "center", chars: 0, picture: false }))).toBeNull();
    // A centred box of paragraphs: its paragraphs are marked, not the box.
    expect(keptAlign(block({ tag: "div", leaf: false, align: "center" }))).toBeNull();
  });
});

describe("a paragraph that is a heading", () => {
  it("keeps its size, within what a heading has", () => {
    // <p class="ct"><span class="big">The Orchard</span></p> with .big { font-size: 1.29em }
    expect(headingSize(block({ chars: 11, size: 20.67 }))).toBeCloseTo(1.29);
    expect(headingSize(block({ chars: 2, size: 26.67 }))).toBe(1.6);
    expect(headingSize(block({ chars: 30, size: 48 }))).toBe(1.6);
    // A div, in a book of divs.
    expect(headingSize(block({ tag: "div", chars: 8, size: 20.67 }))).toBeCloseTo(1.29);
  });

  it("is short and larger from its first word to its last", () => {
    expect(headingSize(block({ chars: 400, size: 24 }))).toBeNull();
    expect(headingSize(block({ chars: 20, size: 16 }))).toBeNull();
    expect(headingSize(block({ chars: 20, size: 17.6 }))).toBeNull();
    // A raised initial: the first word is large, the last is not, so `size` is the running size.
    expect(headingSize(block({ chars: 120, size: 16 }))).toBeNull();
    expect(headingSize(block({ chars: 0, size: 30 }))).toBeNull();
  });

  it("is not a real heading, nor a box of paragraphs", () => {
    expect(headingSize(block({ tag: "h2", chars: 10, size: 24 }))).toBeNull();
    expect(headingSize(block({ tag: "div", leaf: false, chars: 0, size: 24 }))).toBeNull();
  });

  it("is measured against the book's running text, whatever that is", () => {
    // A book set in `font-size: small` (13px) with titles in `x-large` (24px).
    expect(headingSize(block({ chars: 30, size: 24, running: 13 }))).toBe(1.6);
    expect(headingSize(block({ chars: 30, size: 13, running: 13 }))).toBeNull();
  });
});

describe("a div that is a paragraph", () => {
  it("is one when words stand directly in it", () => {
    // <div class="para"><span>It was late.</span></div>
    expect(isParagraphDiv(block({ tag: "div" }))).toBe(true);
    expect(isParagraphDiv(block({ tag: "div", leaf: false }))).toBe(false);
    // <div class="fig"><img/></div>
    expect(isParagraphDiv(block({ tag: "div", chars: 0, picture: true }))).toBe(false);
    expect(isParagraphDiv(block({ tag: "p" }))).toBe(false);
  });
});

describe("an inset block", () => {
  it("is kept on both sides, as shares of the column", () => {
    // blockquote { margin: 0 1.5em }
    expect(keptInset(block({ marginLeft: 24, marginRight: 24, textIndent: 0 }))).toEqual({ left: 4, right: 4 });
    // .verse { margin: 0 7.5% 0 11.2%; text-indent: -3.7% }: what is left of the margin after the pull.
    expect(keptInset(block({ marginLeft: 67.2, marginRight: 45, textIndent: -22.2 }))).toEqual({ left: 7.5, right: 7.5 });
    // An epigraph in smaller type: .block { font-size: .8em; margin: 0 1.5em } is 19.2px of a 16px book.
    expect(keptInset(block({ marginLeft: 19.2, marginRight: 19.2, textIndent: 0 }))).toEqual({ left: 3.2, right: 3.2 });
    // A rule under a chapter number: margin: .5em 38% 0
    expect(keptInset(block({ marginLeft: 228, marginRight: 228, textIndent: 0 }))).toEqual({ left: 38, right: 38 });
    // A box pushed to the right half: no more than 40% on a side.
    expect(keptInset(block({ marginLeft: 312, marginRight: 0, textIndent: 0 }))).toEqual({ left: 40, right: 0 });
  });

  it("is not a hanging indent, nor a contents page's step", () => {
    // .gloss { margin-left: 1em; text-indent: -1em }
    expect(keptInset(block({ marginLeft: 16, textIndent: -16 }))).toBeNull();
    expect(keptInset(block({ marginLeft: 45, textIndent: -45 }))).toBeNull();
    // .toc2 { margin-left: 1em }
    expect(keptInset(block({ marginLeft: 16, textIndent: 0 }))).toBeNull();
    expect(keptInset(block({ marginLeft: 0, marginRight: 40 }))).toBeNull();
    expect(keptInset(block({ marginLeft: 40, room: 0 }))).toBeNull();
  });

  it("is not the book's own page margin", () => {
    // Every paragraph of a chapter has margin-left: 2em: that is a margin, and the reader has its own.
    expect(insetsAreMargins(18000, 20000)).toBe(true);
    // One letter in a chapter.
    expect(insetsAreMargins(900, 20000)).toBe(false);
    // A part page that is only its epigraph: too short to call it a margin.
    expect(insetsAreMargins(300, 320)).toBe(false);
  });
});

describe("a paragraph set apart by space alone", () => {
  it("is a scene break when it has a line's worth more above it than paragraphs usually do", () => {
    // p { margin: 0 } and p.break { margin-top: 2em }
    expect(isSetApart(32, 0, 16)).toBe(true);
    // p { margin: .3em 0 } and p.sec { margin-top: 4% } (24px of a 600px column)
    expect(isSetApart(24, 4.8, 16)).toBe(true);
    expect(isSetApart(24, 0, 16)).toBe(true);
  });

  it("is not one in a book that spaces every paragraph", () => {
    // p { margin: 0 0 1.3em }
    expect(isSetApart(20.8, 20.8, 16)).toBe(false);
    expect(isSetApart(8, 0, 16)).toBe(false);
    expect(isSetApart(32, 0, 0)).toBe(false);
  });

  it("gets the room the publisher left, between one line's worth and two", () => {
    expect(breakRoom(32, 0, 16)).toBe(2);
    expect(breakRoom(24, 0, 16)).toBe(1.5);
    expect(breakRoom(24, 4.8, 16)).toBe(1.2);
    expect(breakRoom(16, 0, 16)).toBe(1);
    expect(breakRoom(80, 0, 16)).toBe(2);
  });

  it("takes the usual gap from the middle of the book's own", () => {
    expect(median([0, 0, 0, 32, 0, 0])).toBe(0);
    expect(median([20.8, 20.8, 0, 20.8])).toBe(20.8);
    expect(median([])).toBe(0);
  });
});

describe("a rule", () => {
  it("is a blank scene break when the book draws nothing", () => {
    // hr.transition { border: none; height: 2px }
    expect(ruleKind({ border: false, height: 2, filled: false, hidden: false })).toBe("blank");
    expect(ruleKind({ border: true, height: 0, filled: false, hidden: true })).toBe("blank");
  });

  it("is not drawn twice when the book draws it itself", () => {
    // hr { border: 0; height: 1px; background: #999 } under the reader's `border-top: 1px solid`
    expect(ruleKind({ border: true, height: 1, filled: true, hidden: false })).toBe("own");
    // An ornament as a background picture, 20px high, and no border left on it.
    expect(ruleKind({ border: false, height: 20, filled: true, hidden: false })).toBe("plain");
  });

  it("is one line otherwise: the reader's hairline, or the book's own border", () => {
    expect(ruleKind({ border: true, height: 0, filled: false, hidden: false })).toBe("plain");
    expect(ruleKind({ border: true, height: 0, filled: true, hidden: false })).toBe("plain");
  });
});

describe("a list flattened into paragraphs", () => {
  // <p>• The Book</p><p>o</p><p>Chapter 1.</p><p>o</p><p>Chapter 2.</p> ... then the text.
  const page = ["• The Book", "o", "Chapter 1.", "o", "Chapter 2.", "o", "Chapter 3.", "o", "Chapter 4.", "The Book", "by Someone", "It was late when the rain stopped."];

  it("loses its lone bullets and keeps its lines", () => {
    expect(flattenedList(page)).toEqual({ bullets: [1, 3, 5, 7], items: [2, 4, 6, 8] });
  });

  it("knows a bullet from a word", () => {
    expect(isLoneBullet(" o ")).toBe(true);
    expect(isLoneBullet("•")).toBe(true);
    expect(isLoneBullet("–")).toBe(true);
    expect(isLoneBullet("O")).toBe(false);
    expect(isLoneBullet("oh")).toBe(false);
    expect(isLoneBullet("")).toBe(false);
  });

  it("leaves a paragraph that is a lone letter in a story alone", () => {
    // "o" as someone's whole reply, once; and twice.
    expect(flattenedList(["She wrote one letter on the slate.", "o", "Then she rubbed it out.", "He waited."])).toEqual({ bullets: [], items: [] });
    expect(flattenedList(["o", "First.", "o", "Second.", "And then a long paragraph of the story follows on from here."])).toEqual({ bullets: [], items: [] });
  });

  it("wants a short line after each bullet", () => {
    const long = "A paragraph of prose that goes on for more than a line or two, as the paragraphs of a story do, well past eighty characters.";
    expect(flattenedList(["o", long, "o", long, "o", long])).toEqual({ bullets: [], items: [] });
    expect(flattenedList(["o", "o", "o", "o", "o", "o"])).toEqual({ bullets: [], items: [] });
    expect(flattenedList(["*", "One", "*", "Two", "*", "Three", "*"])).toEqual({ bullets: [0, 2, 4], items: [1, 3, 5] });
  });

  it("finds two lists on one page", () => {
    const two = ["o", "A", "o", "B", "o", "C", "Some words between the two lists.", "-", "D", "-", "E", "-", "F"];
    expect(flattenedList(two)).toEqual({ bullets: [0, 2, 4, 7, 9, 11], items: [1, 3, 5, 8, 10, 12] });
  });
});

describe("a line of such a list that names a contents entry", () => {
  const labels = ["Cover", "Contents", "Chapter 1 · The Orchard", "Chapter 2 · The Ferry", "Chapter 10 · Salt", "Chapter 11", "Epilogue: Ten Years On"];

  it("goes to it", () => {
    expect(entryForLine("Chapter 1.", labels)).toBe(2);
    expect(entryForLine(" chapter 2 ", labels)).toBe(3);
    // As it stands in the file: on a line of its own, with the stop.
    expect(entryForLine("\nChapter 2. ", labels)).toBe(3);
    expect(entryForLine("Chapter 10.", labels)).toBe(4);
    expect(entryForLine("Chapter 11.", labels)).toBe(5);
    expect(entryForLine("Epilogue", labels)).toBe(6);
  });

  it("goes nowhere when none matches, or two do", () => {
    expect(entryForLine("Chapter 3.", labels)).toBe(-1);
    expect(entryForLine("Chapter", labels)).toBe(-1);
    expect(entryForLine("", labels)).toBe(-1);
    expect(entryForLine("Chapter 1.", [...labels, "Chapter 1 · Again"])).toBe(-1);
    expect(entryForLine("Chapter 1.", [])).toBe(-1);
  });
});

describe("sizes that depend on the window", () => {
  it("are told from sizes that do not", () => {
    // .cover { height: 95vh }  img.fill { height: 100% }  .logo { height: 3em }
    expect(sizedByWindow("95vh")).toBe(true);
    expect(sizedByWindow("calc(100vh - 2em)")).toBe(true);
    expect(sizedByWindow("98dvh")).toBe(true);
    expect(sizedByWindow("100%")).toBe(false);
    expect(sizedByWindow("3em")).toBe(false);
    expect(sizedByWindow("600px")).toBe(false);
    expect(sizedByWindow("")).toBe(false);
    expect(sizedByWindow(null)).toBe(false);
  });

  it("are undone, once for each selector", () => {
    expect(unsizeCss(["div.cover", "div.cover", " .full "])).toBe("div.cover { height: auto !important; min-height: 0 !important; }\n.full { height: auto !important; min-height: 0 !important; }");
    expect(unsizeCss([])).toBe("");
  });

  it("leave a picture the window's room when scrolling", () => {
    expect(pictureRoom(768, 80, 56)).toBe(632);
    expect(pictureRoom(200, 80, 56)).toBe(160);
  });
});

describe("a hanging indent", () => {
  it("is kept as the book set it: the pull, and what is left of the margin beside it", () => {
    // .gloss { margin-left: 1em; text-indent: -1em } in a 600px column: the whole margin is the pull.
    expect(keptHang(block({ marginLeft: 16, textIndent: -16 }))).toEqual({ hang: 2.7, left: 0, right: 0 });
    // A contents line: .toc { margin-left: 46px; text-indent: -6px }
    expect(keptHang(block({ marginLeft: 46, textIndent: -6 }))).toEqual({ hang: 1, left: 6.7, right: 0 });
    // Verse whose long lines turn over: margin: 0 7.5% 0 11.2%; text-indent: -3.7%
    expect(keptHang(block({ marginLeft: 67.2, marginRight: 45, textIndent: -22.2 }))).toEqual({ hang: 3.7, left: 7.5, right: 7.5 });
  });

  it("is not an ordinary paragraph, nor a first line pulled out past the margin", () => {
    expect(keptHang(block({ marginLeft: 0, textIndent: 16 }))).toBeNull();
    expect(keptHang(block({ marginLeft: 32, textIndent: 0 }))).toBeNull();
    // text-indent: -2em with no margin to hang in: the line would leave the column.
    expect(keptHang(block({ marginLeft: 0, textIndent: -32 }))).toBeNull();
    expect(keptHang(block({ marginLeft: 16, textIndent: -16, room: 0 }))).toBeNull();
  });

  it("pulls back no further than a share of the column", () => {
    expect(keptHang(block({ marginLeft: 300, textIndent: -300 }))?.hang).toBe(15);
  });
});

describe("verse", () => {
  // A made-up line as the book sets it. The running text is 16px.
  const line = (over: Partial<VerseLine> = {}): VerseLine => ({ chars: 30, gap: 0, textIndent: 0, set: true, endsSentence: false, other: false, ...over });
  const prose = (): VerseLine => line({ chars: 400, textIndent: 16, set: false, endsSentence: true });

  it("is a run of short inset lines with nothing between them", () => {
    // <p class="p">…</p> <p class="vf">…</p><p class="v">…</p><p class="v">…</p><p class="vl">…</p> <p class="p">…</p>
    const page = [prose(), line({ gap: 20 }), line(), line(), line(), prose()];
    expect(verseRuns(page, 16, true)).toEqual([{ from: 1, to: 4, stanzas: [] }]);
  });

  it("keeps the gap between stanzas", () => {
    // Two stanzas of three; the second starts with .vf { margin-top: 1.26em }.
    const song = [line(), line(), line(), line({ gap: 20.2 }), line(), line()];
    expect(verseRuns(song, 16, true)).toEqual([{ from: 0, to: 5, stanzas: [{ line: 3, gap: 1.3 }] }]);
  });

  it("takes a centred couplet, and a poem in a book that does not indent its prose", () => {
    expect(verseRuns([line(), line()], 16, false)).toEqual([{ from: 0, to: 1, stanzas: [] }]);
  });

  it("does not take dialogue in short paragraphs", () => {
    // An indented book: each remark has the prose's first-line indent.
    const said = () => line({ chars: 12, textIndent: 16, set: false, endsSentence: true });
    expect(verseRuns([prose(), said(), said(), said(), said(), prose()], 16, true)).toEqual([]);
    // A book that spaces its paragraphs instead: each remark has the prose's gap above it.
    const spaced = () => line({ chars: 12, gap: 16, set: false, endsSentence: true });
    expect(verseRuns([spaced(), spaced(), spaced(), spaced()], 16, false)).toEqual([]);
    // A book with neither indent nor gap gives nothing to tell them by: left alone.
    const bare = () => line({ chars: 12, set: false, endsSentence: true });
    expect(verseRuns([bare(), bare(), bare(), bare()], 16, false)).toEqual([]);
    // And in an indented book, three unindented remarks that end as sentences are still remarks.
    expect(verseRuns([bare(), bare(), bare()], 16, true)).toEqual([]);
  });

  it("takes three unindented lines that do not end as sentences, in a book that indents its prose", () => {
    const bare = (ends = false) => line({ set: false, endsSentence: ends });
    expect(verseRuns([prose(), bare(), bare(), bare(true), prose()], 16, true)).toEqual([{ from: 1, to: 3, stanzas: [] }]);
    // Two are not enough when nothing sets them off.
    expect(verseRuns([prose(), bare(), bare(), prose()], 16, true)).toEqual([]);
  });

  it("does not take inset paragraphs that the book sets apart from one another", () => {
    // A letter of short paragraphs, each with a gap above it.
    expect(verseRuns([line({ gap: 16 }), line({ gap: 16 }), line({ gap: 16 })], 16, true)).toEqual([]);
  });

  it("leaves headings, contents lines, long lines and blocks that are not paragraphs out", () => {
    expect(verseRuns([line({ other: true }), line({ other: true }), line({ other: true })], 16, true)).toEqual([]);
    expect(verseRuns([line({ chars: 300 }), line({ chars: 300 })], 16, true)).toEqual([]);
    // A picture between two pairs of lines: two runs.
    expect(verseRuns([line(), line(), null, line(), line()], 16, true)).toEqual([
      { from: 0, to: 1, stanzas: [] },
      { from: 3, to: 4, stanzas: [] }
    ]);
    // A single line is a line.
    expect(verseRuns([prose(), line(), prose()], 16, true)).toEqual([]);
  });

  it("knows how a sentence ends", () => {
    expect(endsAsSentence("He left.")).toBe(true);
    expect(endsAsSentence("“Did he?”")).toBe(true);
    expect(endsAsSentence("and the river ran on,")).toBe(false);
    expect(endsAsSentence("O my son")).toBe(false);
  });
});
