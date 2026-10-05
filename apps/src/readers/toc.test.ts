import { describe, expect, it } from "vitest";
import { tocEntryAt, tocPlace, type TocPlace } from "./toc";

const never = () => false;
const always = () => true;

describe("the contents entry a place is under", () => {
  // Cover (0, not listed), Dedication 1, Prologue 2, Part One 3, Chapter 1 4 (two files: 4, 5), Chapter 2 6, Notes 7.
  const book: TocPlace[] = [1, 2, 3, 4, 6, 7].map((spine) => ({ spine, anchor: null }));

  it("is the entry that opens the section being read, whatever it is called", () => {
    expect(tocEntryAt(book, 1, never)).toBe(0);
    expect(tocEntryAt(book, 3, never)).toBe(2);
    expect(tocEntryAt(book, 7, never)).toBe(5);
  });

  it("is the chapter before, in a file the contents do not list", () => {
    expect(tocEntryAt(book, 5, never)).toBe(3);
  });

  it("is nothing before the first entry", () => {
    expect(tocEntryAt(book, 0, never)).toBe(-1);
    expect(tocEntryAt([], 3, always)).toBe(-1);
  });

  it("follows the reading line through a file that holds several chapters", () => {
    const shared: TocPlace[] = [
      { spine: 2, anchor: null },
      { spine: 3, anchor: "c1" },
      { spine: 3, anchor: "c2" },
      { spine: 3, anchor: "c3" }
    ];
    // Above the first anchor of the file: still under the entry before.
    expect(tocEntryAt(shared, 3, never)).toBe(0);
    expect(tocEntryAt(shared, 3, (anchor) => anchor === "c1")).toBe(1);
    expect(tocEntryAt(shared, 3, (anchor) => anchor !== "c3")).toBe(2);
    // Past the file: its last chapter.
    expect(tocEntryAt(shared, 4, never)).toBe(3);
  });

  it("passes over entries that lead nowhere in the book", () => {
    expect(tocEntryAt([{ spine: 1, anchor: null }, { spine: undefined, anchor: null }], 2, never)).toBe(0);
  });

  it("reads a contents link as a file and an anchor", () => {
    const spineIndexOf = (file: string) => (file === "Text/ch3.xhtml" ? 3 : undefined);
    expect(tocPlace("Text/ch3.xhtml", spineIndexOf)).toEqual({ spine: 3, anchor: null });
    expect(tocPlace("Text/ch3.xhtml#part%202", spineIndexOf)).toEqual({ spine: 3, anchor: "part 2" });
    expect(tocPlace("missing.xhtml#x", spineIndexOf)).toEqual({ spine: undefined, anchor: "x" });
  });

  it("follows the reading line through a file whose chapters are places, not ids", () => {
    // A chapter list made for a book with none: three chapters in one file, each a CFI.
    const spineIndexOf = (file: string) => (file === "book.xhtml" ? 3 : file === "front.xhtml" ? 2 : undefined);
    const made: TocPlace[] = [
      tocPlace("front.xhtml", spineIndexOf),
      tocPlace("book.xhtml", spineIndexOf, "epubcfi(/6/8!/4/2)"),
      tocPlace("book.xhtml", spineIndexOf, "epubcfi(/6/8!/4/40)"),
      tocPlace("book.xhtml", spineIndexOf, "epubcfi(/6/8!/4/90)")
    ];
    expect(made[1]).toEqual({ spine: 3, anchor: null, cfi: "epubcfi(/6/8!/4/2)" });
    const asked: string[] = [];
    const reached = (place: string) => {
      asked.push(place);
      return place !== "epubcfi(/6/8!/4/90)";
    };
    expect(tocEntryAt(made, 3, reached)).toBe(2);
    expect(asked).toEqual(["epubcfi(/6/8!/4/2)", "epubcfi(/6/8!/4/40)", "epubcfi(/6/8!/4/90)"]);
    expect(tocEntryAt(made, 3, never)).toBe(0);
    expect(tocEntryAt(made, 4, never)).toBe(3);
    // An entry with an anchor keeps its anchor; a CFI given with it is not needed.
    expect(tocPlace("book.xhtml#c2", spineIndexOf, "epubcfi(/6/8!/4/40)")).toEqual({ spine: 3, anchor: "c2" });
  });
});
