import { describe, expect, it } from "vitest";
import type { Book } from "@shared/models/book";
import { RETRY_AFTER_MS, duePageCovers, readTried, withTried } from "./pageCoverQueue";

const NOW = Date.parse("2026-10-11T12:00:00Z");

const book = (id: string, more: Partial<Book> = {}): Book =>
  ({
    id,
    title: id,
    author: null,
    genres: [],
    coverUrl: null,
    localPath: `C:\\Books\\${id}.pdf`,
    fileHash: id,
    progress: 0,
    lastOpened: null,
    createdAt: "2026-10-11T10:00:00Z",
    metadataCheckedAt: "2026-10-11T10:01:00Z",
    available: true,
    ...more
  }) as Book;

describe("PDFs owed a cover from their first page", () => {
  it("is a PDF with no cover, once a lookup has had its turn", () => {
    // The reported case: added, looked up (no catalogue knows the scan), never opened.
    expect(duePageCovers([book("scan")], {}, {}, NOW).map((due) => due.id)).toEqual(["scan"]);
    // Looked up this run, with no stamp left: the lookup got no answer.
    const unstamped = book("offline", { metadataCheckedAt: null });
    expect(duePageCovers([unstamped], {}, {}, NOW)).toEqual([]);
    expect(duePageCovers([unstamped], { offline: true }, {}, NOW)).toHaveLength(1);
  });

  it("leaves alone a book with a cover, one that is not a PDF, and one whose file is not here", () => {
    const books = [
      book("has-one", { coverUrl: "C:\\covers\\has-one-cover.jpg" }),
      book("stand-in", { coverUrl: "C:\\covers\\stand-in-page.jpg" }),
      book("epub", { localPath: "C:\\Books\\epub.epub" }),
      book("upper", { localPath: "C:\\Books\\UPPER.PDF" }),
      book("elsewhere", { available: false })
    ];
    expect(duePageCovers(books, {}, {}, NOW).map((due) => due.id)).toEqual(["upper"]);
  });

  it("leaves the book being read to its reader", () => {
    expect(duePageCovers([book("open"), book("shut")], {}, {}, NOW, "open").map((due) => due.id)).toEqual(["shut"]);
  });

  it("does not try a book again for a fortnight, or for ever with the clock set back", () => {
    const books = [book("blank")];
    expect(duePageCovers(books, {}, { blank: NOW - 60_000 }, NOW)).toEqual([]);
    expect(duePageCovers(books, {}, { blank: NOW - RETRY_AFTER_MS }, NOW)).toHaveLength(1);
    expect(duePageCovers(books, {}, { blank: NOW + RETRY_AFTER_MS + 1 }, NOW)).toHaveLength(1);
  });
});

describe("the list of books already tried", () => {
  it("reads only a list it wrote", () => {
    expect(readTried(null)).toEqual({});
    expect(readTried("not json")).toEqual({});
    expect(readTried("[1,2]")).toEqual({});
    expect(readTried('{"a":5,"b":"soon","c":null}')).toEqual({ a: 5 });
  });

  it("forgets books that have left the library", () => {
    expect(withTried({ gone: 1, kept: 2 }, "new", NOW, [{ id: "kept" }, { id: "new" }])).toEqual({ kept: 2, new: NOW });
  });
});
