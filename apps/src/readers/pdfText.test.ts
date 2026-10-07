import { describe, expect, it } from "vitest";
import {
  currentMark,
  findMatches,
  foldAccents,
  hasSearchableText,
  joinTextItems,
  matchAcross,
  matchRects,
  mendDropCaps,
  pageMarks,
  pageMatches,
  searchPattern,
  snippetAt,
  type TextItem
} from "./pdfText";

/** A run of text set at `size` points whose baseline starts at (x, y) in page space. */
const run = (str: string, x: number, y: number, width: number, size = 10, hasEOL = false): TextItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
  hasEOL
});

/** An upright A4-ish page, 600 by 800: page space has its origin bottom left, the page as shown top left. */
const UPRIGHT = [1, 0, 0, -1, 0, 800];

describe("a PDF page's text, joined for searching", () => {
  it("joins runs as they come and breaks the line where the page does", () => {
    const joined = joinTextItems([
      run("Animal ", 100, 700, 40),
      run("Farm", 140, 700, 30, 10, true),
      { str: "", transform: [10, 0, 0, 10, 100, 680], width: 0, height: 0, hasEOL: true },
      run("George Orwell", 100, 680, 80)
    ]);
    expect(joined.text).toBe("Animal Farm\nGeorge Orwell");
    expect(joined.starts).toEqual([0, 7, 12]);
    expect(joined.items.map((item) => item.str)).toEqual(["Animal ", "Farm", "George Orwell"]);
  });

  it("passes over what is not text", () => {
    const joined = joinTextItems([{ type: "beginMarkedContent" } as never, null, run("Word", 0, 0, 20)]);
    expect(joined.text).toBe("Word");
    expect(joined.starts).toEqual([0]);
  });

  it("knows a page of spacing and marks has nothing to search", () => {
    expect(hasSearchableText(" \n • — \n")).toBe(false);
    expect(hasSearchableText("page 3")).toBe(true);
    expect(hasSearchableText("Ünïcödé")).toBe(true);
  });
});

describe("finding a phrase", () => {
  const text = "The pigs had set aside the harness-\nroom as a headquarters.\nALL ANIMALS\nare equal. All animals.";

  it("ignores case", () => {
    expect(findMatches(text, "all animals").map((match) => text.slice(match.start, match.end))).toEqual([
      "ALL ANIMALS",
      "All animals"
    ]);
  });

  it("finds a phrase where its runs were separate and where the line breaks inside it", () => {
    const joined = joinTextItems([run("All ani", 0, 0, 30), run("mals are", 30, 0, 40, 10, true), run("equal", 0, -12, 25)]);
    const [match] = findMatches(joined.text, "animals   are equal");
    expect(joined.text.slice(match.start, match.end)).toBe("animals are\nequal");
  });

  it("finds a word that was hyphenated over the end of a line", () => {
    const [match] = findMatches(text, "harness-room");
    expect(text.slice(match.start, match.end)).toBe("harness-\nroom");
    expect(findMatches("exam-\nple", "example")).toEqual([{ start: 0, end: 9 }]);
  });

  it("finds a word typed without its accents, and one typed with them", () => {
    const menu = "Café Zürich: naïve façade, École. A cafe too.";
    const found = (query: string) => findMatches(menu, query).map((match) => menu.slice(match.start, match.end));
    expect(found("cafe")).toEqual(["Café", "cafe"]);
    expect(found("café")).toEqual(["Café", "cafe"]);
    expect(found("zurich")).toEqual(["Zürich"]);
    expect(found("ECOLE")).toEqual(["École"]);
    expect(found("facade, ecole")).toEqual(["façade, École"]);
  });

  it("folds an accent off one character for one, so a match is where it was found", () => {
    expect(foldAccents("Brontë – Ångström")).toBe("Bronte – Angstrom");
    // Letters that are not a letter and an accent stay themselves.
    expect(foldAccents("Straße æon Søren")).toBe("Straße æon Søren");
    const text = "ééé résumé";
    expect(foldAccents(text)).toHaveLength(text.length);
    expect(findMatches(text, "resume")).toEqual([{ start: 4, end: 10 }]);
  });

  it("finds an apostrophe or a quotation mark straight or curly, whichever was typed", () => {
    const said = "“Don’t,” she said. \"Don't.\" DON‘T";
    const found = (query: string) => findMatches(said, query).map((match) => said.slice(match.start, match.end));
    expect(found("don't")).toEqual(["Don’t", "Don't", "DON‘T"]);
    expect(found("don’t")).toEqual(["Don’t", "Don't", "DON‘T"]);
    expect(found('"don\'t')).toEqual(["“Don’t", "\"Don't"]);
  });

  it("treats what is typed as words, not as a pattern", () => {
    expect(findMatches("cost (a+b)* is $5.00", "(a+b)*")).toEqual([{ start: 5, end: 11 }]);
    expect(findMatches("a.c abc", "a.c")).toEqual([{ start: 0, end: 3 }]);
  });

  it("does not search for less than two characters, or more matches than asked", () => {
    expect(searchPattern(" a ")).toBeNull();
    expect(findMatches(text, "a")).toEqual([]);
    expect(findMatches("aa aa aa aa", "aa", 3)).toHaveLength(3);
    expect(findMatches("", "anything")).toEqual([]);
  });
});

describe("a phrase that runs over a page break", () => {
  const first = "R43 the right column\nR44 these are the last words of the\n";
  const second = "first page and they continue here, M1\nM2 the left column";

  it("is found from the foot of one page into the head of the next", () => {
    const across = matchAcross(first, second, "words of the first page")!;
    expect(first.slice(across.start)).toBe("words of the\n");
    expect(second.slice(0, across.end)).toBe("first page");
  });

  it("breaks at a hyphen as a line does", () => {
    const across = matchAcross("the well-known harness-", "room door", "harness-room")!;
    expect(across).toEqual({ start: 15, end: 4 });
    // The spacing a page ends or begins with is not in the way.
    expect(matchAcross("an exam-\n", "\n ple of it", "example")).toEqual({ start: 3, end: 5 });
  });

  it("is not a phrase that is wholly on one of the two pages", () => {
    expect(matchAcross(first, second, "last words")).toBeNull();
    expect(matchAcross(first, second, "first page")).toBeNull();
    expect(matchAcross(first, second, "the first")).not.toBeNull();
    expect(matchAcross("", second, "first page")).toBeNull();
    expect(matchAcross(first, second, "a")).toBeNull();
  });

  it("gives each page its part to mark: the first as its last match, the second as a head", () => {
    const onFirst = pageMatches(first, "the last words of the first page and", Infinity, null, second);
    expect(onFirst.own).toEqual([{ start: first.indexOf("the last"), end: first.length }]);
    expect(onFirst.head).toBeNull();
    const onSecond = pageMatches(second, "the last words of the first page and", Infinity, first, null);
    expect(onSecond.own).toEqual([]);
    expect(second.slice(0, onSecond.head!.end)).toBe("first page and");
  });

  it("puts the part that runs on after the page's own matches", () => {
    const page = "the the\nand the";
    const marked = pageMatches(page, "the", Infinity, null, "ory of it");
    // Three of its own; nothing runs on ("the" + "ory" is not the phrase).
    expect(marked.own).toHaveLength(3);
    const running = pageMatches("the fox and the", "the windmill", Infinity, null, "windmill stood");
    expect(running.own).toEqual([{ start: 12, end: 15 }]);
  });
});

describe("marks for a phrase that runs over a page break", () => {
  const page = (lines: Array<[string, number]>) => ({
    joined: joinTextItems(lines.map(([str, y], index) => run(str, 100, y, str.length * 5, 10, index < lines.length - 1))),
    transform: UPRIGHT,
    width: 600,
    height: 800
  });
  const first = page([
    ["the mill by the hill", 700],
    ["these are the last words of the", 100]
  ]);
  const second = page([
    ["first page and they continue", 700],
    ["the mill again", 680]
  ]);

  it("marks the foot of the first page as the last of its matches, and the head of the next apart", () => {
    const onFirst = pageMarks(first, "words of the first page", 400, null, second.joined.text);
    expect(onFirst.head).toBe(false);
    expect(onFirst.rects).toHaveLength(1);
    // The last line of the page, from "words" to its end.
    expect(onFirst.rects[0][0].top).toBeGreaterThan(0.8);
    const onSecond = pageMarks(second, "words of the first page", 400, first.joined.text, null);
    expect(onSecond.head).toBe(true);
    expect(onSecond.rects).toHaveLength(1);
    expect(onSecond.rects[0][0].top).toBeLessThan(0.2);
    expect(onSecond.rects[0][0].left).toBeCloseTo(100 / 600, 5);
  });

  it("says which mark is the result on show, on both of its pages", () => {
    const onFirst = pageMarks(first, "the mill", 400, null, second.joined.text);
    const onSecond = pageMarks(second, "the mill", 400, first.joined.text, null);
    // "the mill" is once on each page and nowhere across the break.
    expect([onFirst.rects.length, onFirst.head, onSecond.rects.length, onSecond.head]).toEqual([1, false, 1, false]);
    const across = { page: 1, nth: 0, across: true };
    const marksFirst = pageMarks(first, "of the first", 400, null, second.joined.text);
    const marksSecond = pageMarks(second, "of the first", 400, first.joined.text, null);
    expect(currentMark(across, 1, marksFirst)).toBe(0);
    expect(currentMark(across, 2, marksSecond)).toBe(marksSecond.rects.length - 1);
    expect(currentMark(across, 3, marksSecond)).toBeNull();
    // An ordinary result is current on its own page only.
    expect(currentMark({ page: 2, nth: 1 }, 2, marksSecond)).toBe(1);
    expect(currentMark({ page: 1, nth: 0 }, 2, marksSecond)).toBeNull();
    expect(currentMark(null, 2, marksSecond)).toBeNull();
  });
});

describe("the words around a match", () => {
  const text =
    "Mr. Jones, of the Manor Farm, had locked the hen-houses for the night,\nbut was too drunk to remember to shut the pop-holes. With the ring of light from his lantern";

  it("gives the match with what comes before and after, on one line", () => {
    const [match] = findMatches(text, "too drunk");
    const snippet = snippetAt(text, match, 24);
    expect(snippet.match).toBe("too drunk");
    expect(snippet.before.startsWith("…")).toBe(true);
    expect(snippet.before.endsWith("but was ")).toBe(true);
    expect(snippet.after.startsWith(" to remember")).toBe(true);
    expect(snippet.after.endsWith("…")).toBe(true);
    expect(`${snippet.before}${snippet.match}${snippet.after}`).not.toMatch(/\n/);
  });

  it("does not mark a cut where the text itself begins or ends", () => {
    const [first] = findMatches(text, "Mr. Jones");
    expect(snippetAt(text, first, 20).before).toBe("");
    const [last] = findMatches(text, "his lantern");
    expect(snippetAt(text, last, 20).after).toBe("");
  });

  it("cuts at a word, not through one", () => {
    const [match] = findMatches(text, "locked");
    const snippet = snippetAt(text, match, 12);
    expect(snippet.before).toBe("…Farm, had ");
    expect(snippet.after).toBe(" the…");
  });
});

describe("where a match is on the page", () => {
  it("covers the part of a run the match is in", () => {
    // Ten characters over 100 units: "2345" is four tenths of the way along, four tenths wide.
    const joined = joinTextItems([run("0123456789", 100, 700, 100)]);
    const [rect] = matchRects(joined, { start: 2, end: 6 }, UPRIGHT, 600, 800);
    expect(rect.left).toBeCloseTo(120 / 600, 5);
    expect(rect.width).toBeCloseTo(40 / 600, 5);
    // The baseline is at 700 from the bottom, so 100 from the top; the box reaches above and a little below it.
    expect(rect.top * 800).toBeLessThan(100 - 7);
    expect((rect.top + rect.height) * 800).toBeGreaterThan(100 + 1);
    expect((rect.top + rect.height) * 800).toBeLessThan(100 + 4);
  });

  it("uses the width of the letters when it is told them", () => {
    const joined = joinTextItems([run("iiiiWWWW", 0, 400, 100)]);
    const narrowAndWide = (text: string) => Array.from(text).reduce((sum, char) => sum + (char === "W" ? 3 : 1), 0);
    const [rect] = matchRects(joined, { start: 4, end: 8 }, UPRIGHT, 600, 800, narrowAndWide);
    expect(rect.left * 600).toBeCloseTo(25, 5);
    expect(rect.width * 600).toBeCloseTo(75, 5);
  });

  it("joins runs on one line into one stretch and starts another on the next line", () => {
    const joined = joinTextItems([
      run("All ", 100, 700, 20),
      run("animals", 120, 700, 40, 10, true),
      run("are equal", 100, 688, 50)
    ]);
    const [match] = findMatches(joined.text, "all animals are");
    const rects = matchRects(joined, match, UPRIGHT, 600, 800);
    expect(rects).toHaveLength(2);
    expect(rects[0].left * 600).toBeCloseTo(100, 5);
    expect(rects[0].width * 600).toBeCloseTo(60, 5);
    expect(rects[1].top).toBeGreaterThan(rects[0].top);
    // "are" is three of nine characters.
    expect(rects[1].width * 600).toBeCloseTo(50 / 3, 5);
  });

  it("follows a page that is shown turned", () => {
    // A page turned a quarter: page space (x, y) is shown at (y, x) on an 800 by 600 page.
    const turned = [0, 1, 1, 0, 0, 0];
    const joined = joinTextItems([run("0123456789", 100, 700, 100)]);
    const [rect] = matchRects(joined, { start: 0, end: 10 }, turned, 800, 600);
    // The run goes along x in page space, so down the page as shown.
    expect(rect.height * 600).toBeCloseTo(100, 5);
    expect(rect.top * 600).toBeCloseTo(100, 5);
    expect(rect.width * 800).toBeGreaterThan(9);
    expect(rect.width * 800).toBeLessThan(13);
  });

  it("gives nothing for a run with no size, or a match elsewhere", () => {
    const joined = joinTextItems([run("vertical", 10, 10, 0), run("text", 10, 30, 20)]);
    expect(matchRects(joined, { start: 0, end: 8 }, UPRIGHT, 600, 800)).toEqual([]);
    expect(matchRects(joined, { start: 40, end: 44 }, UPRIGHT, 600, 800)).toEqual([]);
    expect(matchRects(joined, { start: 8, end: 12 }, UPRIGHT, 0, 0)).toEqual([]);
  });
});

describe("a drop cap", () => {
  // As pdf.js reads a paragraph opened by a 48 pt "T" (Times, 29.3 wide) with
  // three 12 pt lines set beside it: the letter's baseline is the third line's.
  const cap = (hasEOL = false) => run("T", 72, 700, 29.3, 48, hasEOL);
  const lines = [
    run("he pigs had set aside the harness-room", 104, 728, 190, 12, true),
    run("for themselves. Here, in the evenings,", 104, 714, 185, 12, true),
    run("blacksmithing, carpentering and other", 104, 700, 180, 12, true),
    run("from books which they had brought.", 72, 686, 170, 12)
  ];
  const endOfLine = { str: "", transform: [12, 0, 0, 12, 104, 728], width: 0, height: 0, hasEOL: true };

  it("is one word with the letters beside it, however the page ended the line after it", () => {
    for (const items of [
      [cap(), ...lines],
      [cap(true), ...lines],
      [cap(), endOfLine, ...lines],
      [cap(true), { type: "endMarkedContent" } as never, endOfLine, ...lines]
    ]) {
      const joined = joinTextItems(mendDropCaps(items));
      expect(joined.text.startsWith("The pigs had set aside")).toBe(true);
      expect(findMatches(joined.text, "the pigs")).toEqual([{ start: 0, end: 8 }]);
    }
  });

  it("keeps the rest of the page as it came", () => {
    const items = [cap(true), endOfLine, ...lines];
    const mended = mendDropCaps(items);
    expect(mended).toHaveLength(items.length - 1);
    expect(mended.slice(1)).toEqual(lines);
    // The list given is not changed.
    expect(items[0].hasEOL).toBe(true);
    expect(joinTextItems(mended).text).toBe(
      "The pigs had set aside the harness-room\nfor themselves. Here, in the evenings,\nblacksmithing, carpentering and other\nfrom books which they had brought."
    );
  });

  it("is marked whole when found: the large letter and the letters beside it", () => {
    const joined = joinTextItems(mendDropCaps([cap(true), ...lines]));
    const [match] = findMatches(joined.text, "the");
    const rects = matchRects(joined, match, UPRIGHT, 600, 800);
    expect(rects).toHaveLength(2);
    // The "T": 29.3 wide from x = 72, and as tall as a 48 pt letter.
    expect(rects[0].left * 600).toBeCloseTo(72, 5);
    expect(rects[0].width * 600).toBeCloseTo(29.3, 5);
    expect(rects[0].height * 800).toBeGreaterThan(40);
    // "he", small, on the first line, to the right of it.
    expect(rects[1].left * 600).toBeCloseTo(104, 5);
    expect(rects[1].height * 800).toBeLessThan(15);
  });

  it("is also a raised initial, on the line's own baseline", () => {
    const joined = joinTextItems(mendDropCaps([run("O", 72, 700, 26, 36, true), run("nce upon a time", 99, 700, 80, 12)]));
    expect(joined.text).toBe("Once upon a time");
  });

  it("is not a heading over a paragraph, a large word before a space, or a letter far from the line", () => {
    // A heading: large, but the text after it starts below and back at the margin.
    const heading = [run("Chapter I", 72, 740, 120, 24, true), run("Mr. Jones, of the Manor Farm", 72, 700, 150, 12)];
    expect(joinTextItems(mendDropCaps(heading)).text).toBe("Chapter I\nMr. Jones, of the Manor Farm");
    // A large first word followed by a space: the page's own break stands.
    const word = [run("ONCE", 72, 700, 90, 36, true), run(" upon a time", 162, 720, 60, 12)];
    expect(joinTextItems(mendDropCaps(word)).text).toBe("ONCE\n upon a time");
    const spaced = [run("A", 72, 700, 26, 36, true), run(" ", 98, 720, 3, 12), run("long time ago", 101, 720, 70, 12)];
    expect(joinTextItems(mendDropCaps(spaced)).text).toBe("A\n long time ago");
    // A page number in the margin, large, with body text far to its right.
    const far = [run("7", 30, 700, 12, 24, true), run("the windmill", 104, 710, 60, 12)];
    expect(joinTextItems(mendDropCaps(far)).text).toBe("7\nthe windmill");
    // Two runs of the same size are never a drop cap.
    const same = [run("T", 72, 700, 7, 12, true), run("he", 79, 700, 10, 12)];
    expect(joinTextItems(mendDropCaps(same)).text).toBe("T\nhe");
  });
});
