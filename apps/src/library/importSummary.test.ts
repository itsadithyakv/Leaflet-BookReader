import { describe, expect, it } from "vitest";
import { describeImport, toastMs } from "./importSummary";

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

describe("what an import says when it knows the books and the failures", () => {
  const titled = (id: string, title: string) => ({ id, title });
  const EMPTY = { name: "Night Ferry.epub", reason: "That file is empty (0 bytes), so there is nothing to read." };

  it("names the books the library already had", () => {
    expect(describeImport(1, [titled("a", "Night Ferry")], library("a"), [])).toBe("“Night Ferry” is already in your library.");
    expect(describeImport(2, [titled("a", "Night Ferry"), titled("b", "Salt")], library("a", "b"), [])).toBe(
      "“Night Ferry” and “Salt” are already in your library."
    );
    expect(describeImport(3, [titled("a", "Night Ferry"), titled("b", "Salt"), titled("c", "Tide")], library("a"), [])).toBe(
      "2 books added. “Night Ferry” was already in your library."
    );
    expect(
      describeImport(5, [titled("a", "A"), titled("b", "B"), titled("c", "C"), titled("d", "D"), titled("e", "E")], library("a", "b", "c", "d"), [])
    ).toBe("1 book added. “A”, “B” and 2 others were already in your library.");
    // Two files of one book the library had: named once.
    expect(describeImport(2, [titled("a", "Night Ferry"), titled("a", "Night Ferry")], library("a"), [])).toBe(
      "“Night Ferry” is already in your library."
    );
  });

  it("names each file that was not added, with why", () => {
    expect(describeImport(2, [titled("a", "Salt")], library(), [EMPTY])).toBe(
      "1 book added. “Night Ferry.epub” was not added: That file is empty (0 bytes), so there is nothing to read."
    );
    // A file that failed among others used to be silent in the dialog; alone, it is the whole message.
    expect(describeImport(1, [], library(), [EMPTY])).toBe(
      "Nothing was added. “Night Ferry.epub” was not added: That file is empty (0 bytes), so there is nothing to read."
    );
    // A system's own words get their full stop.
    expect(describeImport(1, [], library(), [{ name: "a.pdf", reason: "It could not be copied into your library: disk full" }])).toBe(
      "Nothing was added. “a.pdf” was not added: It could not be copied into your library: disk full."
    );
  });

  it("names two failures and counts the rest", () => {
    const failed = ["a.epub", "b.epub", "c.epub", "d.epub"].map((name) => ({ name, reason: "It is damaged." }));
    expect(describeImport(5, [titled("z", "Salt")], library(), failed)).toBe(
      "1 book added. “a.epub” was not added: It is damaged. “b.epub” was not added: It is damaged. 2 more files were not added; Settings → About → Copy diagnostics has the details."
    );
    expect(describeImport(3, [], library(), failed.slice(0, 3))).toContain("One more file was not added;");
  });

  it("stays up long enough to be read", () => {
    expect(toastMs("1 book added.")).toBe(2600);
    expect(toastMs("x".repeat(45))).toBe(2600);
    expect(toastMs(describeImport(1, [], library(), [EMPTY]))).toBeGreaterThan(6000);
    expect(toastMs("x".repeat(5000))).toBe(14000);
  });
});
