import { describe, expect, it } from "vitest";
import type { Book } from "@shared/models/book";
import { decodeFindPlace } from "../../readers/findPlace";
import type { BookMatches, LibraryMatch } from "../../services/librarySearchService";
import { MAX_QUERY, listResults, matchCount, matchPlace, searchable, statusLine, withBook } from "./librarySearch";

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
    expect(statusLine({ kind: "done", skipped: 2 }, [])).toBe("No matches");
    expect(statusLine({ kind: "done", skipped: 0 }, results)).toBe("10 matches in 2 books");
    expect(statusLine({ kind: "done", skipped: 0 }, results.slice(1))).toBe("1 match in 1 book");
    expect(statusLine({ kind: "failed" }, results)).toBe("The search did not finish");
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
  });
});
