import { describe, expect, it } from "vitest";
import type { Book } from "@shared/models/book";
import { decodeFindPlace } from "../../readers/findPlace";
import { decodePdfFindPlace } from "../../readers/pdfFindPlace";
import type { BookMatches, LibraryMatch, SearchSummary } from "../../services/librarySearchService";
import {
  MAX_QUERY, listResults, matchCount, matchPlace, notSearchedTitle, pageLabel, readUnread, searchable, statusLine, withBook,
  type UnreadSteps
} from "./librarySearch";

const book = (id: string) => ({ id, title: `The ${id}`, author: "Someone", genres: [], coverUrl: null, progress: 0 }) as unknown as Book;
const match = (nth: number, href = "text/ch1.xhtml"): LibraryMatch => ({ href, spine: 3, nth, before: "…up the ", text: "Lighthouse", after: " stairs…" });
const found = (bookId: string, count: number): BookMatches => ({ bookId, count, matches: Array.from({ length: Math.min(count, 5) }, (_, nth) => match(nth)) });
const ids = (results: readonly BookMatches[]) => results.map((item) => `${item.bookId}:${item.count}`);

describe("the words to search every book for", () => {
  it("are worth searching for from two characters", () => {
    expect(searchable("")).toBeNull();
    expect(searchable(" a ")).toBeNull();
    expect(searchable("ab")).toBe("ab");
    expect(searchable("  the   light\thouse ")).toBe("the light house");
  });

  it("are cut where the search cuts them", () => {
    expect(searchable("x".repeat(5000))).toHaveLength(MAX_QUERY);
    expect(searchable(`${"x".repeat(MAX_QUERY - 1)} tail`)).toBe("x".repeat(MAX_QUERY - 1));
  });
});

describe("results as the books are gone through", () => {
  it("keep the book with the most matches first", () => {
    let results: BookMatches[] = [];
    for (const next of [found("b", 2), found("a", 9), found("d", 1), found("c", 4)]) {
      results = withBook(results, next);
    }
    expect(ids(results)).toEqual(["a:9", "c:4", "b:2", "d:1"]);
  });

  it("leave books with as many matches in the order they came", () => {
    const results = [found("first", 3), found("second", 3), found("third", 3)].reduce(withBook, [] as BookMatches[]);
    expect(ids(results)).toEqual(["first:3", "second:3", "third:3"]);
    expect(ids(withBook(results, found("late", 3)))).toEqual(["first:3", "second:3", "third:3", "late:3"]);
  });

  it("count a book told of twice once, and change nothing they were given", () => {
    const before = [found("a", 5), found("b", 2)];
    const after = withBook(before, found("b", 8));
    expect(ids(after)).toEqual(["b:8", "a:5"]);
    expect(ids(before)).toEqual(["a:5", "b:2"]);
  });

  it("are shown beside their books, without one that has left the library", () => {
    const listed = listResults([found("a", 9), found("gone", 4), found("b", 2)], [book("b"), book("a"), book("c")]);
    expect(listed.map((item) => [item.book.title, item.count, item.matches.length])).toEqual([
      ["The a", 9, 5],
      ["The b", 2, 2]
    ]);
    expect(listResults([], [book("a")])).toEqual([]);
  });
});

describe("the line under the search box", () => {
  const results = listResults([found("a", 9), found("b", 1)], [book("a"), book("b")]);

  it("says one short thing whatever the state", () => {
    expect(statusLine({ kind: "idle" }, [])).toBe("Type a word or phrase");
    expect(statusLine({ kind: "searching", done: 0, total: 0 }, [])).toBe("Searching…");
    expect(statusLine({ kind: "searching", done: 3, total: 15 }, results)).toBe("Searching… 3 of 15 books");
    expect(statusLine({ kind: "searching", done: 0, total: 1 }, [])).toBe("Searching… 0 of 1 book");
    expect(statusLine({ kind: "done", skipped: 2, noText: 0 }, [])).toBe("No matches");
    expect(statusLine({ kind: "done", skipped: 0, noText: 0 }, results)).toBe("10 matches in 2 books");
    expect(statusLine({ kind: "done", skipped: 0, noText: 0 }, results.slice(1))).toBe("1 match in 1 book");
    expect(statusLine({ kind: "failed" }, results)).toBe("The search did not finish");
  });

  it("says how many PDFs are still being read", () => {
    expect(statusLine({ kind: "reading", left: 3, fraction: 0 }, results)).toBe("Reading 3 PDFs…");
    expect(statusLine({ kind: "reading", left: 1, fraction: 0.4 }, [])).toBe("Reading 1 PDF…");
  });

  it("keeps what was not searched, and why, for a reader who asks", () => {
    const plain = notSearchedTitle(0);
    expect(plain).toMatch(/^Comics have no text to search\./);
    expect(plain).not.toMatch(/PDF/);
    expect(notSearchedTitle(1)).toBe(`1 PDF is scanned pages, with no text to search. ${plain}`);
    expect(notSearchedTitle(3)).toBe(`3 PDFs are scanned pages, with no text to search. ${plain}`);
  });

  it("counts a match and matches", () => {
    expect([matchCount(0), matchCount(1), matchCount(2)]).toEqual(["0 matches", "1 match", "2 matches"]);
  });
});

describe("a match picked", () => {
  it("is the place the reader is given: its section, which match, and the words", () => {
    const place = matchPlace(match(2, "Text/part one.xhtml"), "don't look");
    expect(place).toBe("find:3:2:Text/part one.xhtml\ndon't look");
    expect(decodeFindPlace(place)).toEqual({ href: "Text/part one.xhtml", spine: 3, nth: 2, query: "don't look" });
    expect(pageLabel(match(2))).toBeNull();
  });

  it("in a PDF is its page, which of the page's matches, and the words", () => {
    const onPage: LibraryMatch = { href: "", spine: 0, nth: 1, page: 1212, before: "…up the ", text: "Lighthouse", after: " stairs…" };
    const place = matchPlace(onPage, "don't look");
    expect(place).toBe("pagefind:1212:1\ndon't look");
    expect(decodePdfFindPlace(place)).toEqual({ page: 1212, nth: 1, query: "don't look" });
    expect(decodeFindPlace(place)).toBeNull();
    expect(pageLabel(onPage)).toBe(`p. ${(1212).toLocaleString()}`);
    expect(pageLabel({ ...onPage, page: 12 })).toBe("p. 12");
  });
});

describe("PDFs the search had no text for", () => {
  const none: SearchSummary = { books: [], searched: 1, skipped: 0, noText: 0, unread: [], stopped: false };
  /** The steps, with a note of each one taken. PDFs named "locked" cannot be read; "scan" has no text; "empty" has no match. */
  const steps = (over: Partial<UnreadSteps> = {}) => {
    const taken: string[] = [];
    const kept = new Map<string, string[]>();
    const all: UnreadSteps = {
      read: async (id, onPage) => {
        taken.push(`read ${id}`);
        if (id.startsWith("locked")) {
          throw new Error("This PDF is locked.");
        }
        onPage(1, 2);
        onPage(2, 2);
        return id === "scan" ? ["", ""] : [`Page one of ${id}.`, "The lighthouse."];
      },
      save: async (id, pages) => {
        taken.push(`save ${id}`);
        kept.set(id, pages);
      },
      search: async (id) => {
        taken.push(`search ${id}`);
        if (id === "scan") {
          return { ...none, searched: 0, skipped: 1, noText: 1 };
        }
        return id === "empty" ? none : { ...none, books: [found(id, 2)] };
      },
      stillWanted: () => true,
      unreadable: new Set<string>(),
      onProgress: (left, fraction) => taken.push(`${left} left, ${Math.round(fraction * 100)}%`),
      onBook: (book) => taken.push(`found ${book.bookId}:${book.count}`),
      ...over
    };
    return { all, taken, kept };
  };

  it("are read one at a time, each kept and then searched by itself", async () => {
    const { all, taken, kept } = steps();
    expect(await readUnread(["a", "b"], all)).toEqual({ skipped: 0, noText: 0, stopped: false });
    expect(taken).toEqual([
      "2 left, 0%", "read a", "2 left, 25%", "2 left, 50%", "save a", "search a", "found a:2",
      "1 left, 50%", "read b", "1 left, 75%", "1 left, 100%", "save b", "search b", "found b:2"
    ]);
    expect(kept.get("a")).toEqual(["Page one of a.", "The lighthouse."]);
  });

  it("count a scan as not searched, with no text, and a PDF without the words as searched", async () => {
    const { all, taken, kept } = steps();
    expect(await readUnread(["scan", "empty"], all)).toEqual({ skipped: 1, noText: 1, stopped: false });
    // The scan is kept all the same, as empty pages: it is not read again.
    expect(kept.get("scan")).toEqual(["", ""]);
    expect(taken.filter((step) => step.startsWith("found"))).toEqual([]);
  });

  it("count one that cannot be read as not searched, and do not try it again", async () => {
    const { all, taken } = steps();
    expect(await readUnread(["locked", "a"], all)).toEqual({ skipped: 1, noText: 0, stopped: false });
    expect(taken).not.toContain("save locked");
    expect(taken).not.toContain("search locked");
    expect(taken).toContain("found a:2");
    expect([...all.unreadable]).toEqual(["locked"]);

    // The next search: counted, not read.
    const again = steps({ unreadable: all.unreadable });
    expect(await readUnread(["locked", "locked too", "a"], again.all)).toEqual({ skipped: 2, noText: 0, stopped: false });
    expect(again.taken.filter((step) => step.startsWith("read"))).toEqual(["read locked too", "read a"]);
    expect(again.taken[0]).toBe("2 left, 0%");
  });

  it("count one whose text could not be kept as not searched", async () => {
    const { all, taken } = steps({ save: async () => Promise.reject(new Error("The disk is full.")) });
    expect(await readUnread(["a"], all)).toEqual({ skipped: 1, noText: 0, stopped: false });
    expect(taken).not.toContain("search a");
    // Kept, it seemed, and still named as unread by the search after.
    const named = steps({ search: async (id) => ({ ...none, searched: 0, unread: [id] }) });
    expect(await readUnread(["a"], named.all)).toEqual({ skipped: 1, noText: 0, stopped: false });
  });

  it("stop where they are when the dialog is shut or the words change, and keep nothing half read", async () => {
    // Called off while the first is being read: the reading gives nothing.
    let wanted = true;
    const during = steps({
      stillWanted: () => wanted,
      read: async () => {
        wanted = false;
        return null;
      }
    });
    expect(await readUnread(["a", "b"], during.all)).toBeNull();
    expect(during.taken).toEqual(["2 left, 0%"]);
    expect(during.kept.size).toBe(0);

    // Called off after the first was kept: it stays kept, the second is not begun.
    wanted = true;
    const after = steps({ stillWanted: () => wanted });
    after.all.save = async (id, pages) => {
      after.kept.set(id, pages);
      wanted = false;
    };
    expect(await readUnread(["a", "b"], after.all)).toBeNull();
    expect([...after.kept.keys()]).toEqual(["a"]);
    expect(after.taken.some((step) => step.includes(" b"))).toBe(false);

    // A reading that fails because it was called off is not a PDF that cannot be read.
    wanted = true;
    const failing = steps({
      stillWanted: () => wanted,
      read: async () => {
        wanted = false;
        throw new Error("The document was let go of.");
      }
    });
    expect(await readUnread(["a"], failing.all)).toBeNull();
    expect(failing.all.unreadable.size).toBe(0);
  });

  it("say so when the search of one was stopped by something else", async () => {
    const { all } = steps({ search: async () => ({ ...none, stopped: true }) });
    expect(await readUnread(["a", "b"], all)).toEqual({ skipped: 0, noText: 0, stopped: true });
  });

  it("have nothing to add when there are none", async () => {
    const { all, taken } = steps();
    expect(await readUnread([], all)).toEqual({ skipped: 0, noText: 0, stopped: false });
    expect(taken).toEqual([]);
  });
});
