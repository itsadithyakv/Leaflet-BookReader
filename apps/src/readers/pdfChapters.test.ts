import { describe, expect, it } from "vitest";
import type { PageLink } from "./pdfLinks";
import type { TextItem } from "./pdfText";
import { bodySize, digestPage, findChapters, packChapters, pageLines, readChapters, unpackChapters, type PageFacts } from "./pdfChapters";

// A made-up page, 400 by 600 points. A line is [text, size, how far down its
// baseline is, how far in it starts]; the width is as a face of that size sets it.
const W = 400;
const H = 600;
const VIEW = [1, 0, 0, -1, 0, H];
type Line = [text: string, size: number, down: number, left?: number];

const run = ([text, size, down, left = 40]: Line): TextItem => ({
  str: text,
  transform: [size, 0, 0, size, left, H - down],
  width: Math.min(W - left - 20, text.length * size * 0.5),
  height: size
});
const page = (number: number, lines: Line[], links: PageLink[] = []): PageFacts =>
  digestPage(number, { items: lines.map(run), transform: VIEW, width: W, height: H }, links);

const BODY = 11;
/** A page of running text under a running head, with its number at the foot. */
const textPage = (number: number, head: string | null, first = "and so the afternoon went on as the others had before it, slowly"): PageFacts =>
  page(number, [
    ...(head ? ([[head, 9, 30]] as Line[]) : []),
    [first, BODY, 70],
    ["with nothing to mark one hour off from the next except the light", BODY, 84],
    ["which moved across the floor and up the far wall as it always did", BODY, 98],
    ["until somebody thought to close the shutters against the evening.", BODY, 112],
    [String(number), 9, 570, 190]
  ]);

const titles = (pages: PageFacts[], count = pages.length) => findChapters(pages, count).entries.map((entry) => `${entry.page} ${entry.title}`);

describe("pageLines", () => {
  it("joins the runs of a line, in order down the page", () => {
    const lines = pageLines(
      [
        { str: "second line", transform: [11, 0, 0, 11, 40, 500], width: 60, height: 11 },
        { str: "The", transform: [11, 0, 0, 11, 40, 520], width: 16, height: 11 },
        // A change of face starts a new run; the gap is a space.
        { str: "first", transform: [11, 0, 0, 11, 60, 520], width: 22, height: 11 },
        { str: " line", transform: [11, 0, 0, 11, 82, 520], width: 20, height: 11 },
        { str: "   ", transform: [11, 0, 0, 11, 40, 480], width: 9, height: 11 },
        null
      ],
      VIEW,
      W,
      H
    );
    expect(lines.map((line) => line.text)).toEqual(["The first line", "second line"]);
    expect(lines[0].size).toBe(11);
    expect(lines[0].top).toBeCloseTo((600 - 520 - 11) / 600, 5);
    expect(lines[0].left).toBeCloseTo(0.1, 5);
  });

  it("gives a line the size most of it has, not its drop cap's", () => {
    const lines = pageLines(
      [
        { str: "O", transform: [36, 0, 0, 36, 40, 400], width: 26, height: 36 },
        { str: "n a morning in February the news came", transform: [11, 0, 0, 11, 68, 400], width: 200, height: 11 }
      ],
      VIEW,
      W,
      H
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].size).toBe(11);
  });

  it("makes nothing of a page it cannot place", () => {
    expect(pageLines([{ str: "x", transform: [11, 0, 0, 11, 0, 0], width: 5, height: 11 }], VIEW, 0, 0)).toEqual([]);
    expect(pageLines([{ str: "x" }, { str: "y", transform: [1, 2] }], VIEW, W, H)).toEqual([]);
  });
});

describe("findChapters: headings", () => {
  // Sixty pages, a chapter every twelve: "CHAPTER ONE" over a title in two
  // lines, the book's name on the left pages and the chapter's on the right.
  const NAMES = ["The Harbour at Dusk", "A Letter from the North", "What the Tide Brought", "Salt and Iron", "The Last Crossing"];
  const NUMBERS = ["ONE", "TWO", "THREE", "FOUR", "FIVE"];
  const book = () =>
    Array.from({ length: 60 }, (_, index) => {
      const number = index + 1;
      const chapter = Math.floor(index / 12);
      if (index % 12 === 0) {
        return page(number, [
          [`CHAPTER ${NUMBERS[chapter]}`, 13, 110],
          [NAMES[chapter].split(" ").slice(0, 2).join(" "), 24, 160],
          [NAMES[chapter].split(" ").slice(2).join(" "), 24, 190],
          ["T", 36, 270],
          ["he morning came in grey over the water and nobody was about", BODY, 255, 68],
          ["except the man who kept the light, who had not been to bed.", BODY, 269, 68]
        ]);
      }
      return textPage(number, number % 2 === 0 ? `${number} Night Ferry` : `${NAMES[chapter]} ${number}`);
    });

  it("finds a book's chapters by their labels and titles, not its running heads", () => {
    const pages = book();
    expect(bodySize(pages)).toBe(BODY);
    const found = findChapters(pages, 60);
    expect(found.from).toBe("headings");
    expect(found.scan).toBe(false);
    expect(found.entries.map((entry) => `${entry.page} ${entry.title}`)).toEqual([
      "1 CHAPTER ONE: The Harbour at Dusk",
      "13 CHAPTER TWO: A Letter from the North",
      "25 CHAPTER THREE: What the Tide Brought",
      "37 CHAPTER FOUR: Salt and Iron",
      "49 CHAPTER FIVE: The Last Crossing"
    ]);
    expect(found.entries.every((entry) => entry.depth === 0)).toBe(true);
  });

  it("takes in the parts set like chapters that are not numbered, and no section heading", () => {
    const pages = book();
    // A foreword before chapter one would be page 0; put one in place of a text page, and an epilogue.
    pages[5] = page(6, [
      ["An Afterthought", 24, 160],
      ["It was a year before anyone spoke of it again, and then only", BODY, 255]
    ]);
    pages[58] = page(59, [
      ["Acknowledgments", 14, 90],
      ["My thanks to the keeper of the light and to his patient wife.", BODY, 130]
    ]);
    // A section heading that happens to fall at the top of a page: larger than the body, but not a chapter's size.
    pages[20] = page(21, [
      ["What the Tide Brought 21", 9, 30],
      ["The Second Winter", 14, 70],
      ["Nothing was said of it at the time, as nothing ever was there.", BODY, 100]
    ]);
    expect(titles(pages)).toEqual([
      "1 CHAPTER ONE: The Harbour at Dusk",
      "6 An Afterthought",
      "13 CHAPTER TWO: A Letter from the North",
      "25 CHAPTER THREE: What the Tide Brought",
      "37 CHAPTER FOUR: Salt and Iron",
      "49 CHAPTER FIVE: The Last Crossing",
      "59 Acknowledgments"
    ]);
  });

  it("finds chapters that are only a larger line, where they agree in size and height", () => {
    const starts = new Map([
      [3, "The Harbour"],
      [14, "A Letter"],
      [22, "The Tide"],
      [31, "Salt"]
    ]);
    const pages = Array.from({ length: 40 }, (_, index) => {
      const number = index + 1;
      const title = starts.get(number);
      // The running head on the pages after is the chapter's own title, smaller.
      const chapter = [...starts.entries()].filter(([at]) => at <= number).pop()?.[1] ?? null;
      return title
        ? page(number, [
            [title, 20, 120],
            ["It began, as these things do, with a letter that was not meant", BODY, 170]
          ])
        : textPage(number, chapter);
    });
    // A title page: one line far larger than anything, on its own.
    pages[0] = page(1, [["NIGHT FERRY", 40, 250]]);
    expect(titles(pages)).toEqual(["3 The Harbour", "14 A Letter", "22 The Tide", "31 Salt"]);

    // Two of them only: not enough to call chapters.
    const two = pages.map((facts) => (facts.page === 22 || facts.page === 31 ? textPage(facts.page, "A Letter") : facts));
    expect(findChapters(two, 40)).toEqual({ entries: [], from: null, scan: false });

    // The same four at four different heights and sizes: nothing agrees.
    const loose = pages.map((facts) => {
      const title = starts.get(facts.page);
      const at = [...starts.keys()].indexOf(facts.page);
      return title ? page(facts.page, [[title, 16 + at * 5, 60 + at * 90], ["It began, as these things do, with a letter that was not meant", BODY, 420]]) : facts;
    });
    expect(findChapters(loose, 40).entries).toEqual([]);
  });

  it("knows a numbered chapter from a running head, and from a sentence", () => {
    // "Chapter 1" to "Chapter 5" are the same words once the digits are gone,
    // which is how running heads are known; but they are chapters apart.
    const pages = Array.from({ length: 50 }, (_, index) => {
      const number = index + 1;
      return index % 10 === 0
        ? page(number, [
            [`Chapter ${index / 10 + 1}`, BODY, 90],
            ["It began, as these things do, with a letter that was not meant", BODY, 130]
          ])
        : textPage(number, "Night Ferry", number === 17 ? "Chapter 3 had gone badly for everyone, and the fourth promised no" : undefined);
    });
    expect(titles(pages)).toEqual(["1 Chapter 1", "11 Chapter 2", "21 Chapter 3", "31 Chapter 4", "41 Chapter 5"]);
  });

  it("reads a heading whose letters are set apart, as a scan's are", () => {
    const pages = Array.from({ length: 40 }, (_, index) => {
      const number = index + 1;
      return index % 10 === 0
        ? page(number, [
            [`CHAPTER ${["O N E", "T W O", "T H R E E", "F O U R"][index / 10]}`, 13, 110],
            ["The Harbour", 24, 160],
            ["It began, as these things do, with a letter that was not meant", BODY, 255]
          ])
        : textPage(number, "N I G H T  F E R R Y");
    });
    expect(titles(pages)).toEqual(["1 CHAPTER ONE: The Harbour", "11 CHAPTER TWO: The Harbour", "21 CHAPTER THREE: The Harbour", "31 CHAPTER FOUR: The Harbour"]);
    expect(pageLines([run(["O P E N N E S S and A B C, but I a", 11, 100])], VIEW, W, H)[0].text).toBe("OPENNESS and ABC, but I a");
  });

  it("reads a large numeral as a chapter and a small one as the page's number", () => {
    const pages = Array.from({ length: 30 }, (_, index) => {
      const number = index + 1;
      return index % 10 === 0
        ? page(number, [
            [String(number), 9, 30, 190],
            [["I", "II", "III"][index / 10], 22, 120, 190],
            ["It began, as these things do, with a letter that was not meant", BODY, 170],
            ["for him, and which he ought by rights to have handed straight on", BODY, 184],
            ["to the harbour master, who would have known what to make of it,", BODY, 198],
            ["and who was in any case the only man there who could read French.", BODY, 212]
          ])
        : page(number, [
            [String(number), 9, 30, 190],
            ["and so the afternoon went on as the others had before it, slowly", BODY, 70],
            ["with nothing to mark one hour off from the next except the light", BODY, 84]
          ]);
    });
    expect(titles(pages)).toEqual(["1 I", "11 II", "21 III"]);
    // A large figure on a page with nothing else (a half-title, a plate) is not a chapter.
    pages[14] = page(15, [["9", 120, 340, 150]]);
    expect(titles(pages)).toEqual(["1 I", "11 II", "21 III"]);
  });

  it("makes no list for a paper, for slides, or for a short note", () => {
    // A two-column paper: one large title, section headings down the columns.
    const paper = Array.from({ length: 12 }, (_, index) =>
      page(index + 1, [
        ...(index === 0 ? ([["On the Tides of a Small Harbour", 18, 60]] as Line[]) : []),
        ["the level was taken at the quay each hour", 9, 100, 30],
        ["and again at the bar, where the two differ", 9, 100, 210],
        ["2 Method", 10, 300, 30],
        ["by as much as a foot at the springs, and", 9, 320, 30]
      ])
    );
    expect(findChapters(paper, 12).entries).toEqual([]);

    // Slides: every page opens with a large line. The page list is their contents.
    const slides = Array.from({ length: 24 }, (_, index) =>
      page(index + 1, [
        [`Results for quarter ${index + 1}`, 28, 70],
        ["Sales rose in the north and fell in the south", 16, 200]
      ])
    );
    expect(findChapters(slides, 24).entries).toEqual([]);

    const note = [textPage(1, null), textPage(2, null)];
    expect(findChapters(note, 2)).toEqual({ entries: [], from: null, scan: false });
  });

  it("says a scan is a scan", () => {
    const scan = Array.from({ length: 30 }, (_, index) => page(index + 1, []));
    expect(findChapters(scan, 30)).toEqual({ entries: [], from: null, scan: true });
    // A stamp or a page number on a few of its pages does not make it text.
    scan[3] = page(4, [["4", 9, 570]]);
    expect(findChapters(scan, 30).scan).toBe(true);
    expect(findChapters([], 0)).toEqual({ entries: [], from: null, scan: false });
  });
});

describe("findChapters: a contents page of links", () => {
  const link = (down: number, left: number, to: number, width = 60): PageLink => ({
    rect: { left: left / W, top: (down - 11) / H, width: width / W, height: 13 / H },
    label: `Go to page ${to}`,
    target: { kind: "page", page: to, left: null, top: null }
  });
  const contents = () =>
    page(
      2,
      [
        ["Contents", 20, 60],
        ["Night Ferry.......................................1", BODY, 100, 40],
        ["The Harbour.....................................3", BODY, 114, 70],
        ["A Letter............................................9", BODY, 128, 70],
        ["The Tide..........................................17", BODY, 142, 70],
        ["Salt.................................................25", BODY, 156, 70],
        ["Notes..............................................31", BODY, 170, 40]
      ],
      [link(100, 40, 3), link(114, 70, 5), link(128, 70, 11), link(142, 70, 19), link(156, 70, 27), link(170, 40, 33), link(170, 330, 33, 20)]
    );

  it("takes the titles from the lines and the pages from the links", () => {
    const pages = [textPage(1, null), contents(), ...Array.from({ length: 38 }, (_, index) => textPage(index + 3, "Night Ferry"))];
    const found = findChapters(pages, 40);
    expect(found.from).toBe("contents");
    expect(found.entries).toEqual([
      { title: "Night Ferry", page: 3, depth: 0 },
      { title: "The Harbour", page: 5, depth: 1 },
      { title: "A Letter", page: 11, depth: 1 },
      { title: "The Tide", page: 19, depth: 1 },
      { title: "Salt", page: 27, depth: 1 },
      // Two link areas on its line (the title and the page number): one entry.
      { title: "Notes", page: 33, depth: 0 }
    ]);
  });

  it("stops at the end of the list, though the next page has links too", () => {
    // The title page after the contents repeats the chapters as links.
    const again = page(
      3,
      Array.from({ length: 5 }, (_, at): Line => [`Part ${at + 1}`, BODY, 100 + at * 14]),
      [5, 11, 19, 27, 33].map((to, at) => link(100 + at * 14, 40, to))
    );
    const pages = [textPage(1, null), contents(), again, ...Array.from({ length: 37 }, (_, index) => textPage(index + 4, "Night Ferry"))];
    expect(findChapters(pages, 40).entries).toHaveLength(6);
    // A list that does run over two pages is taken whole.
    const second = page(
      3,
      Array.from({ length: 5 }, (_, at): Line => [`Appendix ${at + 1}`, BODY, 100 + at * 14]),
      [34, 35, 36, 37, 38].map((to, at) => link(100 + at * 14, 40, to))
    );
    expect(findChapters([textPage(1, null), contents(), second], 40).entries).toHaveLength(11);
  });

  it("strips page numbers that follow most titles without leaders", () => {
    const plain = page(
      2,
      [
        ["Chapter One 3", BODY, 100],
        ["Chapter Two 9", BODY, 114],
        ["Chapter Three 17", BODY, 128],
        ["Chapter Four 25", BODY, 142],
        ["Afterword 31", BODY, 156]
      ],
      [link(100, 40, 5), link(114, 40, 11), link(128, 40, 19), link(142, 40, 27), link(156, 40, 33)]
    );
    expect(titles([textPage(1, null), plain], 40)).toEqual(["5 Chapter One", "11 Chapter Two", "19 Chapter Three", "27 Chapter Four", "33 Afterword"]);
  });

  it("is not taken in by an index, or by a page with a few links", () => {
    // Links that go back and forth through the book: an index of names.
    const index = page(
      2,
      Array.from({ length: 8 }, (_, at): Line => [`Name ${at}`, BODY, 100 + at * 14]),
      [30, 4, 22, 9, 38, 12, 5, 27].map((to, at) => link(100 + at * 14, 40, to))
    );
    expect(findChapters([textPage(1, null), index], 40).entries).toEqual([]);
    const few = page(2, [["See the map", BODY, 100], ["and the notes", BODY, 114]], [link(100, 40, 30), link(114, 40, 35)]);
    expect(few.contents).toBeUndefined();
    // Links out to the web are not contents.
    const web = page(
      2,
      Array.from({ length: 6 }, (_, at): Line => [`Source ${at}`, BODY, 100 + at * 14]),
      Array.from({ length: 6 }, (_, at): PageLink => ({ ...link(100 + at * 14, 40, 9), target: { kind: "web", url: "https://example.org/" } }))
    );
    expect(web.contents).toBeUndefined();
  });
});

describe("readChapters", () => {
  const facts = (number: number) => textPage(number, "Night Ferry");

  it("reads every page once, in order, letting the window in as it goes", async () => {
    const asked: number[] = [];
    let clock = 0;
    let breaths = 0;
    const found = await readChapters({
      pageCount: 30,
      factsOf: async (number) => {
        asked.push(number);
        clock += 4;
        if (number === 7) {
          throw new Error("a page that cannot be read");
        }
        return facts(number);
      },
      stillWanted: () => true,
      breathe: async () => {
        breaths += 1;
      },
      now: () => clock
    });
    expect(asked).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    expect(found).toEqual({ entries: [], from: null, scan: false });
    // Ten milliseconds of work, then a breath: every third page here.
    expect(breaths).toBe(10);
  });

  it("stops when the book is closed", async () => {
    const asked: number[] = [];
    const found = await readChapters({
      pageCount: 300,
      factsOf: async (number) => {
        asked.push(number);
        return facts(number);
      },
      stillWanted: () => asked.length < 5,
      breathe: async () => undefined
    });
    expect(found).toBeNull();
    expect(asked).toHaveLength(5);
  });
});

describe("keeping what was found", () => {
  const found = {
    entries: [
      { title: "The Harbour", page: 3, depth: 0 },
      { title: "A “Letter”", page: 14, depth: 1 }
    ],
    from: "headings" as const,
    scan: false
  };

  it("comes back as it went in", () => {
    expect(unpackChapters(packChapters(found, 40), 40)).toEqual(found);
    const none = { entries: [], from: null, scan: true };
    expect(unpackChapters(packChapters(none, 40), 40)).toEqual(none);
  });

  it("is not trusted for another file, or when it is not what was written", () => {
    // The same book id with another page count is another file.
    expect(unpackChapters(packChapters(found, 40), 41)).toBeNull();
    expect(unpackChapters(null, 40)).toBeNull();
    expect(unpackChapters("", 40)).toBeNull();
    expect(unpackChapters("not json", 40)).toBeNull();
    expect(unpackChapters("null", 40)).toBeNull();
    expect(unpackChapters(JSON.stringify({ rules: 0, pages: 40, entries: [] }), 40)).toBeNull();
    expect(unpackChapters(JSON.stringify({ rules: 1, pages: 40, from: "headings", entries: [["A page past the end", 99, 0]] }), 40)).toBeNull();
    expect(unpackChapters(JSON.stringify({ rules: 1, pages: 40, from: "headings", entries: [[3, "wrong way round", 0]] }), 40)).toBeNull();
  });
});
