import { describe, expect, it } from "vitest";
import { joinTextItems, type TextItem } from "../pdfText";
import { createPdfSentenceSource, partRects, pageLines, runningLines, EMPTY_RUN, type PdfTextPage } from "./pdfSource";

const WIDTH = 600;
const HEIGHT = 800;
/** Page space to the page as shown: pdf.js's viewport at scale 1 for an upright page. */
const VIEWPORT = [1, 0, 0, -1, 0, HEIGHT];
/** Each letter this wide at size 10. */
const CHAR = 5;

type Line = { text: string; y: number; x?: number; size?: number };

/** A page as pdf.js would give it: a run for each line, `y` down from the top of the page. */
const page = (lines: Line[]): PdfTextPage => {
  const items: Array<Partial<TextItem>> = lines.map((line) => {
    const size = line.size ?? 10;
    return {
      str: line.text,
      transform: [size, 0, 0, size, line.x ?? 50, HEIGHT - line.y],
      width: line.text.length * CHAR * (size / 10),
      height: size,
      hasEOL: true
    };
  });
  return { joined: joinTextItems(items), width: WIDTH, height: HEIGHT, transform: VIEWPORT };
};

/** A full line of body text (500 wide, from 50 to 550). */
const full = (text: string) => text.padEnd(100, " ");

const sourceOf = (pages: Array<PdfTextPage | null>) =>
  createPdfSentenceSource({ pageCount: () => pages.length, readPage: async (at) => pages[at - 1] ?? null });

const said = async (source: ReturnType<typeof sourceOf>, at: number) => ((await source.load(at)) ?? []).map((sentence) => sentence.text);

describe("a PDF's sentences, a page at a time", () => {
  it("reads a sentence split over two pages once, whole, as the first page's", async () => {
    const source = sourceOf([
      page([
        { text: full("It was a dark and stormy night. The rain fell in torrents, except at"), y: 100 },
        { text: full("occasional intervals, when it was checked by a violent gust of wind which"), y: 114 }
      ]),
      page([
        { text: full("swept up the streets. Somewhere a dog barked."), y: 100 },
        { text: "The end.", y: 114 }
      ])
    ]);
    expect(await said(source, 1)).toEqual([
      "It was a dark and stormy night.",
      "The rain fell in torrents, except at occasional intervals, when it was checked by a violent gust of wind which swept up the streets."
    ]);
    expect(await said(source, 2)).toEqual(["Somewhere a dog barked.", "The end."]);
    // The second page reads on from the first: no long pause where the page turns.
    const second = await source.load(2);
    expect(second?.[0].lead).toBe("sentence");
    expect(source.after(1)).toBe(2);
    expect(source.after(2)).toBeNull();
  });

  it("makes a word hyphenated over a line, or over a page, whole again", async () => {
    const source = sourceOf([
      page([{ text: full("The examination of the docu-"), y: 100 }]),
      page([{ text: full("ments took the whole after-"), y: 100 }, { text: "noon.", y: 114 }])
    ]);
    expect(await said(source, 1)).toEqual(["The examination of the documents took the whole afternoon."]);
    expect(await said(source, 2)).toEqual([]);
  });

  it("starts a new paragraph where a line ends a sentence short of the margin", async () => {
    const source = sourceOf([
      page([
        { text: full("He closed the door behind him and walked out into the cold night air"), y: 100 },
        { text: "and was gone.", y: 114 },
        { text: full("Morning came."), y: 128, x: 70 }
      ])
    ]);
    const sentences = (await source.load(1)) ?? [];
    expect(sentences.map((sentence) => sentence.text)).toEqual([
      "He closed the door behind him and walked out into the cold night air and was gone.",
      "Morning came."
    ]);
    expect(sentences[1].lead).toBe("paragraph");
    expect(sentences[0].block).not.toBe(sentences[1].block);
  });

  it("passes over pages with nothing on them, and scanned pages, and reads on after them", async () => {
    const source = sourceOf([
      page([{ text: "One.", y: 100 }]),
      page([]),
      null,
      page([{ text: "Two.", y: 100 }])
    ]);
    expect(await said(source, 1)).toEqual(["One."]);
    expect(await source.load(2)).toEqual([]);
    expect(await source.load(3)).toEqual([]);
    expect(await source.hasText(2)).toBe(false);
    expect(await source.hasText(3)).toBe(false);
    expect(source.after(2)).toBe(3);
    expect(source.after(3)).toBe(4);
    expect(await said(source, 4)).toEqual(["Two."]);
  });

  it("stops at a long run of pages with no words, not reading a scanned book through in search of them", async () => {
    const pages = [page([{ text: "Words.", y: 100 }]), ...Array.from({ length: EMPTY_RUN + 5 }, () => page([]))];
    const source = sourceOf(pages);
    let at: number | null = 2;
    let read = 0;
    while (at !== null && read < pages.length) {
      await source.load(at);
      read += 1;
      at = source.after(at);
    }
    expect(read).toBe(EMPTY_RUN);
    expect(source.stoppedAtGap).toBe(true);
  });

  it("leaves out a running header, a running footer and page numbers, and keeps the text", async () => {
    const book = (number: number, body: string) =>
      page([
        { text: number % 2 ? "CHAPTER ONE: THE STORM" : "THE BOOK OF STORMS", y: 40, x: 200 },
        { text: full(body), y: 100 },
        { text: `${number}`, y: 770, x: 290 }
      ]);
    const source = sourceOf([book(1, "First page."), book(2, "Second page."), book(3, "Third page."), book(4, "Fourth page.")]);
    for (const [at, text] of [
      [1, "First page."],
      [2, "Second page."],
      [3, "Third page."],
      [4, "Fourth page."]
    ] as const) {
      expect(await said(source, at)).toEqual([text]);
    }
  });

  it("finds a header past a blank page, and joins a word hyphenated over the page break under it", async () => {
    const book = (number: number, body: string) =>
      page([
        { text: number % 2 ? "CHAPTER ONE: THE STORM" : "THE BOOK OF STORMS", y: 40, x: 200 },
        { text: full(body), y: 100 },
        { text: `${number}`, y: 770, x: 290 }
      ]);
    const source = sourceOf([
      book(1, "One."),
      book(2, "Two."),
      book(3, "Three."),
      page([]),
      book(5, "The end of the after-"),
      book(6, "noon came quietly.")
    ]);
    expect(await said(source, 5)).toEqual(["The end of the afternoon came quietly."]);
    expect(await said(source, 6)).toEqual([]);
  });

  it("keeps a line at the top of the page that is not on the pages either side", async () => {
    const source = sourceOf([
      page([{ text: "A heading of its own", y: 40, size: 16 }, { text: full("The text of the page, set in its usual size."), y: 100 }]),
      page([{ text: "Another heading", y: 40, size: 16 }, { text: full("More of the text, in the same usual size again."), y: 100 }])
    ]);
    const first = (await source.load(1)) ?? [];
    expect(first.map((sentence) => sentence.text)).toEqual(["A heading of its own", "The text of the page, set in its usual size."]);
    expect(first[0].heading).toBe(true);
    expect(await said(source, 2)).toEqual(["Another heading", "More of the text, in the same usual size again."]);
  });

  it("does not take body text for a header, even at the top of the page", () => {
    const at = (text: string) => ({ lines: pageLines(page([{ text, y: 60 }])), height: HEIGHT });
    expect(runningLines(at("The first line of one page."), [at("The first line of the next.")]).size).toBe(0);
    // A long line is text, wherever it stands.
    const long = "A line far too long to be a running header, which goes on and on across the page and then on some more besides.";
    expect(runningLines(at(long), [at(long)]).size).toBe(0);
  });
});

describe("lighting a PDF's sentence", () => {
  it("finds a sentence over a page break on both pages, on the lines it is on", async () => {
    const pages = [
      page([
        { text: full("Short one. And here a long"), y: 100 },
        { text: full("one that goes"), y: 114 }
      ]),
      page([{ text: full("over the page. Then more."), y: 100 }])
    ];
    const source = sourceOf(pages);
    const sentences = (await source.load(1)) ?? [];
    const across = sentences[1];
    expect(across.text).toBe("And here a long one that goes over the page.");
    const parts = source.partsOf(1, across.start, across.end);
    expect(parts.map((part) => part.page)).toEqual([1, 2]);
    expect(pages[0].joined.text.slice(parts[0].start, parts[0].end).replace(/\s+/g, " ").trim()).toBe("And here a long one that goes");
    expect(pages[1].joined.text.slice(parts[1].start, parts[1].end)).toBe("over the page.");

    const onFirst = partRects(pages[0], parts[0]);
    // Two lines: the end of the first, and the second.
    expect(onFirst).toHaveLength(2);
    expect(onFirst[0].top).toBeLessThan(onFirst[1].top);
    expect(onFirst[0].left).toBeCloseTo((50 + "Short one. ".length * CHAR) / WIDTH, 2);
    const onSecond = partRects(pages[1], parts[1]);
    expect(onSecond).toHaveLength(1);
    expect(onSecond[0].left).toBeCloseTo(50 / WIDTH, 2);
    expect(onSecond[0].width).toBeCloseTo(("over the page.".length * CHAR) / WIDTH, 2);
  });

  it("finds a word by its offsets in the section's text", async () => {
    const pages = [page([{ text: full("The quick brown fox."), y: 100 }])];
    const source = sourceOf(pages);
    const [sentence] = (await source.load(1)) ?? [];
    const start = sentence.start + "The quick ".length;
    const [part] = source.partsOf(1, start, start + "brown".length);
    expect(pages[0].joined.text.slice(part.start, part.end)).toBe("brown");
  });
});
