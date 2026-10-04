import { describe, expect, it } from "vitest";
import { describeImport } from "./importSummary";

const book = (id: string) => ({ id });
const library = (...ids: string[]) => new Set(ids);

describe("what a drop of files is said to have done", () => {
  it("counts new books", () => {
    expect(describeImport(1, [book("a")], library())).toBe("1 book added.");
    expect(describeImport(3, [book("a"), book("b"), book("c")], library("z"))).toBe("3 books added.");
  });

  it("does not call a book already in the library added", () => {
    expect(describeImport(1, [book("a")], library("a"))).toBe("That book is already in your library.");
    expect(describeImport(2, [book("a"), book("b")], library("a", "b"))).toBe(
      "Those books are already in your library."
    );
    expect(describeImport(3, [book("a"), book("b"), book("c")], library("a"))).toBe(
      "2 books added. 1 was already in your library."
    );
  });

  it("counts the same file dropped twice, or two copies of one book, once", () => {
    expect(describeImport(2, [book("a"), book("a")], library())).toBe("1 book added.");
    expect(describeImport(2, [book("a"), book("a")], library("a"))).toBe("That book is already in your library.");
  });

  it("says how many files could not be read", () => {
    expect(describeImport(3, [book("a"), book("b")], library())).toBe(
      "2 books added. One file couldn't be read; Settings → About → Copy diagnostics has the details."
    );
    expect(describeImport(4, [book("a")], library("a"))).toBe(
      "That book is already in your library. 3 files couldn't be read; Settings → About → Copy diagnostics has the details."
    );
    expect(describeImport(2, [], library())).toBe(
      "Nothing was added. 2 files couldn't be read; Settings → About → Copy diagnostics has the details."
    );
  });
});
