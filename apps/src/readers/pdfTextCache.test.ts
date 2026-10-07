import { describe, expect, it } from "vitest";
import { MAX_CHARS, MAX_PAGES, collectPdfText, fitToKeep, mayFail, readPdfText } from "./pdfTextCache";

const now = () => 0;
const breathe = () => Promise.resolve();

describe("a PDF's text, made fit to keep", () => {
  it("is kept as it came when it is within the limits", () => {
    const pages = ["The keeper climbed\nthe stairs.", "", "naïve café 灯台 😀"];
    expect(fitToKeep(pages)).toEqual(pages);
    expect(fitToKeep([])).toEqual([]);
  });

  it("has no more pages or characters than are kept", () => {
    const many = Array.from({ length: MAX_PAGES + 3 }, (_, at) => String(at));
    expect(fitToKeep(many)).toHaveLength(MAX_PAGES);
    const kept = fitToKeep(["a".repeat(MAX_CHARS - 4), "bcdefgh", "after"]);
    expect(kept.map((page) => page.length)).toEqual([MAX_CHARS - 4, 4, 0]);
    expect(kept[1]).toBe("bcde");
  });

  it("has no half of a pair of characters, which could not be handed over", () => {
    expect(fitToKeep(["a\uD83Db", "\uDE00 c", "whole 😀 pair"])).toEqual(["a�b", "� c", "whole 😀 pair"]);
    // Cut at the limit in the middle of a pair.
    const kept = fitToKeep(["a".repeat(MAX_CHARS - 1), "😀"]);
    expect(kept[1]).toBe("�");
    expect(() => JSON.parse(JSON.stringify(kept[1]))).not.toThrow();
  });
});

describe("the text the reader's own pass over a PDF reads", () => {
  it("is whole once every page has been put, in order whatever order they came in", () => {
    const text = collectPdfText(3);
    text.put(2, "two");
    expect(text.whole()).toBeNull();
    text.put(3, "");
    text.put(1, "one");
    expect(text.whole()).toEqual(["one", "two", ""]);
  });

  it("is nothing while a page is missing, so a pass cut short keeps nothing", () => {
    const text = collectPdfText(4);
    [1, 2, 4].forEach((page) => text.put(page, `page ${page}`));
    expect(text.whole()).toBeNull();
    // A page put twice is one page, and one the PDF does not have is none.
    text.put(2, "again");
    text.put(0, "none");
    text.put(5, "none");
    text.put(1.5, "none");
    expect(text.whole()).toBeNull();
    text.put(3, "page 3");
    expect(text.whole()).toEqual(["page 1", "again", "page 3", "page 4"]);
    expect(collectPdfText(0).whole()).toBeNull();
  });
});

describe("reading a PDF's text for the search", () => {
  it("reads every page in order, one at a time, and tells of each", async () => {
    const asked: number[] = [];
    const told: string[] = [];
    let reading = 0;
    const pages = await readPdfText({
      pageCount: 4,
      textOf: async (page) => {
        expect(reading).toBe(0);
        reading += 1;
        await Promise.resolve();
        reading -= 1;
        asked.push(page);
        return page === 3 ? "" : `Page ${page} of the long book.`;
      },
      stillWanted: () => true,
      onPage: (done, total) => told.push(`${done}/${total}`),
      breathe,
      now
    });
    expect(asked).toEqual([1, 2, 3, 4]);
    expect(pages).toEqual(["Page 1 of the long book.", "Page 2 of the long book.", "", "Page 4 of the long book."]);
    expect(told).toEqual(["1/4", "2/4", "3/4", "4/4"]);
  });

  it("keeps a scan as pages with nothing on them", async () => {
    expect(await readPdfText({ pageCount: 3, textOf: async () => "", stillWanted: () => true, breathe, now })).toEqual(["", "", ""]);
    expect(await readPdfText({ pageCount: 0, textOf: async () => "never asked", stillWanted: () => true, breathe, now })).toEqual([]);
  });

  it("stops when it is called off, and gives nothing", async () => {
    let wanted = true;
    const asked: number[] = [];
    const pages = await readPdfText({
      pageCount: 50,
      textOf: async (page) => {
        asked.push(page);
        wanted = page < 3;
        return "text";
      },
      stillWanted: () => wanted,
      breathe,
      now
    });
    expect(pages).toBeNull();
    expect(asked).toEqual([1, 2, 3]);
    // Called off on the last page: still nothing, not a book that looks whole.
    wanted = true;
    expect(await readPdfText({ pageCount: 2, textOf: async (page) => ((wanted = page < 2), "text"), stillWanted: () => wanted, breathe, now })).toBeNull();
  });

  it("takes a page that cannot be read for an empty one, but not many of them", async () => {
    const flaky = (bad: number[]) => async (page: number) => {
      if (bad.includes(page)) {
        throw new Error("unreadable");
      }
      return `page ${page}`;
    };
    expect(await readPdfText({ pageCount: 5, textOf: flaky([2, 4]), stillWanted: () => true, breathe, now })).toEqual(["page 1", "", "page 3", "", "page 5"]);
    await expect(readPdfText({ pageCount: 5, textOf: flaky([1, 2, 4]), stillWanted: () => true, breathe, now })).rejects.toThrow("could not be read");
    // A long PDF may lose one page in fifty.
    expect([mayFail(1), mayFail(100), mayFail(150), mayFail(1000)]).toEqual([2, 2, 3, 20]);
    const bad = Array.from({ length: 20 }, (_, at) => at * 7 + 1);
    expect(await readPdfText({ pageCount: 1000, textOf: flaky(bad), stillWanted: () => true, breathe, now })).toHaveLength(1000);
    await expect(readPdfText({ pageCount: 1000, textOf: flaky([...bad, 999]), stillWanted: () => true, breathe, now })).rejects.toThrow();
  });

  it("does not throw for pages that failed because the reading was called off", async () => {
    let wanted = true;
    const pages = await readPdfText({
      pageCount: 5,
      textOf: async (page) => {
        // The third failure is one more than a PDF of five pages may have.
        wanted = page < 3;
        throw new Error("the document was let go of");
      },
      stillWanted: () => wanted,
      breathe,
      now
    });
    expect(pages).toBeNull();
  });

  it("reads no further than what is kept", async () => {
    const asked: number[] = [];
    const big = "x".repeat(MAX_CHARS / 2);
    const pages = await readPdfText({ pageCount: 9, textOf: async (page) => (asked.push(page), big), stillWanted: () => true, breathe, now });
    expect(asked).toEqual([1, 2]);
    expect(pages?.map((page) => page.length)).toEqual([MAX_CHARS / 2, MAX_CHARS / 2]);
  });

  it("lets the window have a turn while it reads", async () => {
    let clock = 0;
    let breaths = 0;
    await readPdfText({
      pageCount: 10,
      textOf: async () => ((clock += 5), "text"),
      stillWanted: () => true,
      breathe: async () => void (breaths += 1),
      now: () => clock
    });
    // Five milliseconds a page, a breath every twelve: after every third page.
    expect(breaths).toBe(3);
  });
});
