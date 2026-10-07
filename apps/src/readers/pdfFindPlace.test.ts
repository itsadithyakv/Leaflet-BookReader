import { describe, expect, it } from "vitest";
import { isKindlePlace } from "../library/kindleClippings";
import { decodeFindPlace, encodeFindPlace, isFindPlace } from "./findPlace";
import { decodePdfFindPlace, encodePdfFindPlace, isPdfFindPlace, matchToShow } from "./pdfFindPlace";
import { decodePlace, encodePlace, isPdfPlace, pagePlace } from "./pdfHighlights";

describe("a place that is a match of the library's search in a PDF", () => {
  it("is written down and read back", () => {
    const place = { page: 212, nth: 3, query: "don't look" };
    const stored = encodePdfFindPlace(place);
    expect(stored).toBe("pagefind:212:3\ndon't look");
    expect(decodePdfFindPlace(stored)).toEqual(place);
  });

  it("keeps words with anything in them", () => {
    for (const place of [
      { page: 1, nth: 0, query: "12:30 — “now”" },
      { page: 19999, nth: 41, query: "naïve façade" },
      { page: 7, nth: 0, query: "灯台" },
      { page: 3, nth: 2, query: "pagefind:9:9 find:1:2:a pdf:4" }
    ]) {
      expect(decodePdfFindPlace(encodePdfFindPlace(place)), place.query).toEqual(place);
    }
    // The words are one line, spaced as they are looked for.
    expect(decodePdfFindPlace(encodePdfFindPlace({ page: 4, nth: 1, query: "  two\n  lines " }))?.query).toBe("two lines");
    // A page is a whole number from 1, and a match from 0.
    expect(encodePdfFindPlace({ page: 0, nth: -3, query: "ab" })).toBe("pagefind:1:0\nab");
    expect(encodePdfFindPlace({ page: 12.9, nth: 1.9, query: "ab" })).toBe("pagefind:12:1\nab");
    expect(encodePdfFindPlace({ page: Number.NaN, nth: Number.NaN, query: "ab" })).toBe("pagefind:1:0\nab");
  });

  it("is not taken for a highlight's place, a match in an EPUB, a CFI or a Kindle location, nor they for it", () => {
    const stored = encodePdfFindPlace({ page: 12, nth: 0, query: "pdf:7 find:1:0:a epubcfi(/6/4!/4)" });
    expect(isPdfFindPlace(stored)).toBe(true);
    expect(isPdfPlace(stored)).toBe(false);
    expect(decodePlace(stored)).toBeNull();
    expect(isFindPlace(stored)).toBe(false);
    expect(decodeFindPlace(stored)).toBeNull();
    expect(isKindlePlace(stored)).toBe(false);
    expect(stored.startsWith("epubcfi(")).toBe(false);
    for (const other of [
      pagePlace(12),
      encodePlace({ page: 12, rects: [{ left: 0.1, top: 0.2, width: 0.5, height: 0.02 }] }),
      encodeFindPlace({ href: "ch1.xhtml", spine: 1, nth: 0, query: "pagefind:12:0" }),
      "epubcfi(/6/4!/4/2,/1:0,/1:5)",
      "kindle:1234",
      "12",
      "",
      null,
      undefined
    ]) {
      expect(isPdfFindPlace(other), String(other)).toBe(false);
      expect(decodePdfFindPlace(other), String(other)).toBeNull();
    }
  });

  it("is nothing when it is damaged", () => {
    for (const damaged of [
      "pagefind:",
      "pagefind:12",
      "pagefind:12:0",
      "pagefind:12:0\n",
      "pagefind:12:0\n   ",
      "pagefind:0:0\nwords",
      "pagefind:-1:0\nwords",
      "pagefind:12\nwords",
      "pagefind:a:b\nwords",
      "pagefind:12:0:extra\nwords",
      "pagefind:1234567890:0\nwords"
    ]) {
      expect(decodePdfFindPlace(damaged), JSON.stringify(damaged)).toBeNull();
    }
  });
});

describe("the match shown on the page", () => {
  it("is the one picked, or the first where the page has fewer than the library counted", () => {
    expect(matchToShow(3, 0)).toBe(0);
    expect(matchToShow(3, 2)).toBe(2);
    expect(matchToShow(3, 3)).toBe(0);
    expect(matchToShow(1, 40)).toBe(0);
  });

  it("is none when the words are not on the page any more", () => {
    expect(matchToShow(0, 0)).toBeNull();
    expect(matchToShow(0, 2)).toBeNull();
  });
});
