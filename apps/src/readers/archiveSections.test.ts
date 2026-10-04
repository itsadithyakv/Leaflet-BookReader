import { describe, expect, it } from "vitest";
import { sectionsFromArchive } from "./archiveSections";

const zipOf = (files: Record<string, number>) => ({
  file: (path: string) => (path in files ? { _data: { uncompressedSize: files[path] } } : null)
});

describe("section sizes from the open book", () => {
  it("reads each section's size from the archive's directory", () => {
    const book = {
      archive: { zip: zipOf({ "OEBPS/ch1.xhtml": 4000, "OEBPS/ch2.xhtml": 9000, "OEBPS/cover.xhtml": 300 }) },
      spine: {
        spineItems: [
          { href: "cover.xhtml", url: "/OEBPS/cover.xhtml", linear: false },
          { href: "ch1.xhtml", url: "/OEBPS/ch1.xhtml", linear: true },
          { href: "ch2.xhtml", url: "/OEBPS/ch2.xhtml", linear: true }
        ]
      }
    };
    expect(sectionsFromArchive(book)).toEqual([
      { href: "cover.xhtml", bytes: 300, linear: false },
      { href: "ch1.xhtml", bytes: 4000, linear: true },
      { href: "ch2.xhtml", bytes: 9000, linear: true }
    ]);
  });

  it("finds a file whose name is escaped in the book", () => {
    const book = {
      archive: { zip: zipOf({ "Text/chapter one.html": 5000 }) },
      spine: { spineItems: [{ href: "Text/chapter%20one.html", url: "/Text/chapter%20one.html", linear: true }] }
    };
    expect(sectionsFromArchive(book)).toEqual([{ href: "Text/chapter%20one.html", bytes: 5000, linear: true }]);
  });

  it("has nothing to say of a book that is not an archive, or a file it cannot find", () => {
    expect(sectionsFromArchive(null)).toEqual([]);
    expect(sectionsFromArchive({ spine: { spineItems: [{ href: "a", url: "/a" }] } })).toEqual([]);
    const book = { archive: { zip: zipOf({}) }, spine: { spineItems: [{ href: "a.html", url: "/a.html", linear: true }] } };
    expect(sectionsFromArchive(book)).toEqual([]);
  });
});
