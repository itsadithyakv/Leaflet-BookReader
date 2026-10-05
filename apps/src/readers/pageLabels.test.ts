import { describe, expect, it } from "vitest";
import { entryFor, goToHint, pageName, pageTitle, parsePageEntry, placeLabel, printedNumber, usefulLabels } from "./pageLabels";

// A book of 20 pages: a cover and a blank, a preface in roman numerals, then
// the text from 1; and the last two leaves with no number of their own.
const BOOK = ["Cover", "", "i", "ii", "iii", "iv", ...Array.from({ length: 12 }, (_, index) => String(index + 1)), "", ""];

describe("which labels are worth showing", () => {
  it("takes a document's labels when they say more than 1, 2, 3", () => {
    expect(usefulLabels(BOOK, 20)).toEqual(BOOK);
    // Made tidy: one line each, of a sane length.
    expect(usefulLabels([" i ", "ii\n", "x".repeat(60)], 3)).toEqual(["i", "ii", "x".repeat(24)]);
  });

  it("is nothing for a document without them, or whose labels are the page numbers", () => {
    expect(usefulLabels(null, 20)).toBeNull();
    expect(usefulLabels(undefined, 20)).toBeNull();
    expect(usefulLabels(["1", "2", "3"], 3)).toBeNull();
    expect(usefulLabels(["", "", ""], 3)).toBeNull();
    // Not one a page: not this document's.
    expect(usefulLabels(["i", "ii"], 3)).toBeNull();
    expect(usefulLabels("i,ii,iii", 3)).toBeNull();
    expect(usefulLabels([], 0)).toBeNull();
    // Anything that is not text is a page without a label.
    expect(usefulLabels(["i", 2, null], 3)).toEqual(["i", "", ""]);
  });
});

describe("what a page is called", () => {
  it("is its printed number where it has one that differs from its place", () => {
    expect(printedNumber(BOOK, 1)).toBe("Cover");
    expect(printedNumber(BOOK, 2)).toBeNull();
    expect(printedNumber(BOOK, 4)).toBe("ii");
    expect(printedNumber(BOOK, 7)).toBe("1");
    expect(printedNumber(BOOK, 99)).toBeNull();
    expect(printedNumber(null, 4)).toBeNull();
    // The same number printed as its place in the file: nothing more to say.
    expect(printedNumber(["i", "2", "3"], 2)).toBeNull();
    expect(pageName(BOOK, 4)).toBe("ii");
    expect(pageName(BOOK, 2)).toBe("2");
    expect(pageName(null, 4)).toBe("4");
  });

  it("says both in the dock: what is printed, and where that is in the file", () => {
    expect(placeLabel(12, 20, BOOK)).toBe("Page 6 (12 of 20)");
    expect(placeLabel(4, 20, BOOK)).toBe("Page ii (4 of 20)");
    // A page named in a word is called by it.
    expect(placeLabel(1, 20, BOOK)).toBe("Cover (1 of 20)");
    expect(pageTitle(BOOK, 1)).toBe("Cover");
    expect(pageTitle(BOOK, 4)).toBe("Page ii");
    expect(pageTitle(["A", "B-12", "xxxviii"], 2)).toBe("Page B-12");
    expect(pageTitle(["A", "B-12", "xxxviii"], 3)).toBe("Page xxxviii");
    expect(pageTitle(null, 9)).toBe("Page 9");
    // No number of its own, and a document with no labels: as it always was.
    expect(placeLabel(20, 20, BOOK)).toBe("Page 20 of 20");
    expect(placeLabel(12, 20, null)).toBe("Page 12 of 20");
  });
});

describe("go to page", () => {
  it("takes a printed number first: a plain number that is printed on a page goes to that page", () => {
    expect(parsePageEntry("6", 20, BOOK)).toBe(12);
    expect(parsePageEntry("1", 20, BOOK)).toBe(7);
    expect(parsePageEntry(" 12 ", 20, BOOK)).toBe(18);
    expect(parsePageEntry("ii", 20, BOOK)).toBe(4);
    expect(parsePageEntry("II", 20, BOOK)).toBe(4);
    expect(parsePageEntry("cover", 20, BOOK)).toBe(1);
  });

  it("takes # and a number for a page of the file, whatever is printed on it", () => {
    expect(parsePageEntry("#6", 20, BOOK)).toBe(6);
    expect(parsePageEntry("# 1", 20, BOOK)).toBe(1);
    expect(parsePageEntry("#99", 20, BOOK)).toBe(20);
    expect(parsePageEntry("#0", 20, BOOK)).toBe(1);
    // Without labels it is the same page as the bare number.
    expect(parsePageEntry("#6", 20)).toBe(6);
  });

  it("takes a plain number no page has printed on it as a page of the file", () => {
    // 13 to 20 are printed nowhere: the last leaves are reached by their place.
    expect(parsePageEntry("19", 20, BOOK)).toBe(19);
    expect(parsePageEntry("500", 20, BOOK)).toBe(20);
  });

  it("goes to the first of two pages with one number", () => {
    const twoParts = ["1", "2", "3", "1", "2", "3"];
    expect(usefulLabels(twoParts, 6)).toEqual(twoParts);
    expect(parsePageEntry("2", 6, twoParts)).toBe(2);
    expect(parsePageEntry("#5", 6, twoParts)).toBe(5);
  });

  it("takes a percentage, and refuses what is none of these", () => {
    expect(parsePageEntry("50%", 21, BOOK.concat("x"))).toBe(11);
    expect(parsePageEntry("0%", 20, BOOK)).toBe(1);
    expect(parsePageEntry("100 %", 20, BOOK)).toBe(20);
    for (const entry of ["", "  ", "xiv", "-3", "3.5", "page 3", "#", "#x", "%"]) {
      expect([entry, parsePageEntry(entry, 20, BOOK)]).toEqual([entry, null]);
    }
    expect(parsePageEntry("3", 0, BOOK)).toBeNull();
  });

  it("is unchanged for a document without labels", () => {
    expect(parsePageEntry("6", 20)).toBe(6);
    expect(parsePageEntry("6", 20, null)).toBe(6);
    expect(parsePageEntry("40%", 11)).toBe(5);
    expect(parsePageEntry("99", 20)).toBe(20);
    expect(parsePageEntry("ii", 20)).toBeNull();
  });

  it("opens holding the page in view, written so that Enter stays on it", () => {
    expect(entryFor(12, 20, BOOK)).toBe("6");
    expect(entryFor(4, 20, BOOK)).toBe("ii");
    // No number of its own: "2" would go to the page that has 2 printed on it.
    expect(entryFor(2, 20, BOOK)).toBe("#2");
    expect(entryFor(19, 20, BOOK)).toBe("19");
    // The second page to carry a number: the number alone leads to the first.
    expect(entryFor(5, 6, ["1", "2", "3", "1", "2", "3"])).toBe("#5");
    expect(entryFor(12, 20, null)).toBe("12");
    for (let page = 1; page <= 20; page += 1) {
      expect(parsePageEntry(entryFor(page, 20, BOOK), 20, BOOK)).toBe(page);
    }
  });

  it("says what the field takes", () => {
    expect(goToHint(20, null)).toBe("Go to page, 1 to 20. Enter goes, Escape cancels");
    expect(goToHint(20, BOOK)).toBe(
      "Go to page: a printed page number (Cover to 12), or # and a number for a page of the file, 1 to 20. Enter goes, Escape cancels"
    );
  });
});
