import { describe, expect, it } from "vitest";
import { searchPdf, type PdfSearchState } from "./pdfSearch";

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
