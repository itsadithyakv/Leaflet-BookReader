import { describe, expect, it } from "vitest";
import { hitsInPageOrder, nextHitIndex, searchPdf, type PdfSearchHit, type PdfSearchState } from "./pdfSearch";

/** A document of pages of text, noting which pages were read. */
const documentOf = (pages: string[]) => {
  const read: number[] = [];
  return {
    read,
    pageCount: pages.length,
    textOf: async (page: number) => {
      read.push(page);
      return pages[page - 1];
    }
  };
};

const live = () => new AbortController().signal;

describe("searching a PDF", () => {
  it("lists every match with its page, its place among that page's matches, and the words around it", async () => {
    const doc = documentOf(["Four legs good, two legs bad.", "No text here about it.", "FOUR LEGS GOOD, said the sheep."]);
    const found = await searchPdf("legs", { ...doc, signal: live() });
    expect(found.hits.map((hit) => [hit.page, hit.nth])).toEqual([
      [1, 0],
      [1, 1],
      [3, 0]
    ]);
    expect(found.hits[1].snippet).toEqual({ before: "Four legs good, two ", match: "legs", after: " bad." });
    expect(found.hits[2].snippet.match).toBe("LEGS");
    expect(found.fraction).toBe(1);
    expect(found.sawText).toBe(true);
    expect(found.capped).toBe(false);
  });

  it("reads a page at a time and tells of results as they come", async () => {
    const doc = documentOf(Array.from({ length: 40 }, (_, index) => (index === 2 ? "the windmill" : "nothing")));
    const seen: Array<[number, number]> = [];
    await searchPdf("windmill", {
      ...doc,
      signal: live(),
      onProgress: (state) => seen.push([doc.read.length, state.hits.length])
    });
    // The first result is told when page 3 has been read, not when all 40 have.
    expect(seen[0]).toEqual([3, 1]);
    expect(doc.read).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
  });

  it("stops reading when it is cancelled", async () => {
    const doc = documentOf(Array.from({ length: 800 }, () => "boxer"));
    const controller = new AbortController();
    let last: PdfSearchState | null = null;
    await searchPdf("boxer", {
      ...doc,
      signal: controller.signal,
      limit: 5000,
      onProgress: (state) => {
        last = state;
        if (state.hits.length === 3) {
          controller.abort();
        }
      }
    });
    expect(doc.read.length).toBe(3);
    expect(last!.hits.length).toBe(3);
  });

  it("stops at the limit and says the list is cut short", async () => {
    const doc = documentOf(Array.from({ length: 50 }, () => "clover clover clover"));
    const found = await searchPdf("clover", { ...doc, signal: live(), limit: 10 });
    expect(found.hits).toHaveLength(10);
    expect(found.capped).toBe(true);
    expect(doc.read.length).toBe(4);
  });

  it("begins at the reader's page and comes round to the pages before it", async () => {
    const doc = documentOf(["clover", "hay", "clover", "clover", "hay"]);
    const found = await searchPdf("clover", { ...doc, signal: live(), from: 3 });
    expect(doc.read).toEqual([3, 4, 5, 1, 2]);
    expect(found.hits.map((hit) => hit.page)).toEqual([3, 4, 1]);
    expect(found.fraction).toBe(1);
    expect(found.capped).toBe(false);
  });

  it("cut short, has what comes next from where the reader is, not the start of the book", async () => {
    // A word on every page of 600, the reader on page 400: the first 200 used
    // to be pages 1 to 200, none of them anywhere near.
    const doc = documentOf(Array.from({ length: 600 }, () => "windmill"));
    const found = await searchPdf("windmill", { ...doc, signal: live(), limit: 200, from: 400 });
    expect(found.capped).toBe(true);
    expect(found.hits[0].page).toBe(400);
    expect(found.hits[199].page).toBe(599);
  });

  it("takes a page outside the document as its nearest end", async () => {
    const doc = documentOf(["a b", "c d", "e f"]);
    await searchPdf("zz", { ...doc, signal: live(), from: 99 });
    expect(doc.read).toEqual([3, 1, 2]);
    doc.read.length = 0;
    await searchPdf("zz", { ...doc, signal: live(), from: Number.NaN });
    expect(doc.read).toEqual([1, 2, 3]);
  });

  it("finds a phrase that runs over a page break, and lists it under the page it begins on", async () => {
    const doc = documentOf(["one two\nthese are the last words of the\n", "first page and they continue", "the first page again"]);
    const found = await searchPdf("words of the first page", { ...doc, signal: live() });
    expect(found.hits.map((hit) => [hit.page, hit.nth, hit.across ?? false])).toEqual([[1, 0, true]]);
    expect(found.hits[0].snippet.match).toBe("words of the first page");
    // A phrase wholly on a page is that page's, once.
    const whole = await searchPdf("first page", { ...doc, signal: live() });
    expect(whole.hits.map((hit) => [hit.page, hit.nth, hit.across ?? false])).toEqual([
      [2, 0, false],
      [3, 0, false]
    ]);
  });

  it("numbers a match that runs on after the page's own matches", async () => {
    const doc = documentOf(["the mill and the", "mill stood"]);
    const found = await searchPdf("the mill", { ...doc, signal: live() });
    expect(found.hits.map((hit) => [hit.page, hit.nth, hit.across ?? false])).toEqual([
      [1, 0, false],
      [1, 1, true]
    ]);
  });

  it("finds one across the break before the page it began on, having come round", async () => {
    const doc = documentOf(["hay", "ends with the wind", "mill begins here", "hay"]);
    const found = await searchPdf("windmill", { ...doc, signal: live(), from: 3 });
    expect(doc.read).toEqual([3, 4, 1, 2]);
    expect(found.hits.map((hit) => [hit.page, hit.across ?? false])).toEqual([]);
    const hyphened = await searchPdf("the wind mill", { ...doc, signal: live(), from: 3 });
    expect(hyphened.hits.map((hit) => [hit.page, hit.across ?? false])).toEqual([[2, true]]);
    // The last page and the first are not neighbours.
    const round = await searchPdf("hay hay", { ...doc, signal: live() });
    expect(round.hits).toEqual([]);
  });

  it("tells a scan, which has no text, from a document where the phrase is not found", async () => {
    const scan = await searchPdf("napoleon", { ...documentOf(["", " \n ", ""]), signal: live() });
    expect(scan.hits).toEqual([]);
    expect(scan.sawText).toBe(false);
    const text = await searchPdf("napoleon", { ...documentOf(["", "Snowball", ""]), signal: live() });
    expect(text.hits).toEqual([]);
    expect(text.sawText).toBe(true);
  });

  it("carries on past a page whose text cannot be read", async () => {
    const found = await searchPdf("mollie", {
      pageCount: 3,
      textOf: async (page) => {
        if (page === 2) {
          throw new Error("damaged page");
        }
        return "Mollie";
      },
      signal: live()
    });
    expect(found.hits.map((hit) => hit.page)).toEqual([1, 3]);
  });

  it("does not read the document for a phrase too short to search for", async () => {
    const doc = documentOf(["a b c"]);
    const found = await searchPdf("a", { ...doc, signal: live() });
    expect(found.hits).toEqual([]);
    expect(doc.read).toEqual([]);
  });

  it("lets the window breathe during a long run of pages already read", async () => {
    const doc = documentOf(Array.from({ length: 30 }, () => "hay"));
    let clock = 0;
    let breaths = 0;
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((callback: () => void) => {
      breaths += 1;
      return realSetTimeout(callback, 0);
    }) as typeof setTimeout;
    try {
      // Each page takes 5ms of this clock: a pause is due every third page.
      await searchPdf("hay", { ...doc, signal: live(), now: () => (clock += 5) });
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    expect(breaths).toBeGreaterThan(5);
    expect(breaths).toBeLessThan(30);
  });
});

describe("stepping through what was found", () => {
  const hit = (page: number, nth = 0): PdfSearchHit => ({ page, nth, snippet: { before: "", match: "x", after: "" } });
  // As a search begun on page 400 finds them: on to the end, then round to the start.
  const found = [hit(400), hit(400, 1), hit(520), hit(7), hit(120)];
  const ordered = hitsInPageOrder(found);

  it("lists the results in page order", () => {
    expect(ordered.map((each) => [each.page, each.nth])).toEqual([
      [7, 0],
      [120, 0],
      [400, 0],
      [400, 1],
      [520, 0]
    ]);
    // The search's own list is left as it was.
    expect(found[0].page).toBe(400);
  });

  it("starts from the reader's page: Enter to the first result on or after it", () => {
    expect(nextHitIndex(ordered, null, 1, 400)).toBe(2);
    expect(nextHitIndex(ordered, null, 1, 121)).toBe(2);
    expect(nextHitIndex(ordered, null, 1, 1)).toBe(0);
    // Past the last result, round to the first.
    expect(nextHitIndex(ordered, null, 1, 560)).toBe(0);
  });

  it("starts from the reader's page going back: Shift+Enter to the last result before it", () => {
    expect(nextHitIndex(ordered, null, -1, 400)).toBe(1);
    expect(nextHitIndex(ordered, null, -1, 600)).toBe(4);
    // Before the first result, round to the last.
    expect(nextHitIndex(ordered, null, -1, 3)).toBe(4);
  });

  it("goes on from the result on show, round the ends", () => {
    expect(nextHitIndex(ordered, hit(400), 1, 1)).toBe(3);
    expect(nextHitIndex(ordered, hit(520), 1, 1)).toBe(0);
    expect(nextHitIndex(ordered, hit(7), -1, 1)).toBe(4);
    // A result no longer in the list (the phrase changed) is no place to go on from.
    expect(nextHitIndex(ordered, hit(33), 1, 130)).toBe(2);
  });

  it("has nowhere to go with nothing found", () => {
    expect(nextHitIndex([], null, 1, 10)).toBe(-1);
  });
});
