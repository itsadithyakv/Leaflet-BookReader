import { describe, expect, it } from "vitest";
import type { Book } from "@shared/models/book";
import type { Annotation } from "../../services/annotationService";
import { booksWithHighlights, groupByChapter, orderHighlights } from "./highlightsView";

const highlight = (id: string, chapter: string | null, cfi = id, createdAt = "2026-09-28T10:00:00Z"): Annotation => ({
  id,
  bookId: "b",
  kind: "highlight",
  cfi,
  text: id,
  chapter,
  color: "yellow",
  createdAt,
  updatedAt: createdAt
});

const book = (id: string, title: string, lastOpened: string | null): Book => ({
  id,
  title,
  author: null,
  genres: [],
  coverUrl: null,
  localPath: `/books/${id}.epub`,
  fileHash: id,
  progress: 0,
  lastOpened,
  createdAt: "2026-01-01T00:00:00Z"
});

describe("orderHighlights", () => {
  it("puts highlights in reading order, not the order they were made", () => {
    const made = [highlight("c", null, "3"), highlight("a", null, "1"), highlight("b", null, "2")];
    const ordered = orderHighlights(made, (a, b) => Number(a) - Number(b));
    expect(ordered.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(made.map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("falls back to which was made first when places cannot be compared", () => {
    const ordered = orderHighlights(
      [highlight("later", null, "x", "2026-09-29T10:00:00Z"), highlight("earlier", null, "y", "2026-09-28T10:00:00Z")],
      () => {
        throw new Error("unreadable CFI");
      }
    );
    expect(ordered.map((item) => item.id)).toEqual(["earlier", "later"]);
  });
});

describe("orderHighlights with a place that cannot be read", () => {
  // epub.js throws on a CFI it cannot parse, whichever side it is on.
  const compare = (a: string, b: string) => {
    if (Number.isNaN(Number(a)) || Number.isNaN(Number(b))) {
      throw new Error("unreadable CFI");
    }
    return Number(a) - Number(b);
  };
  // In the book: first, then second. Made: second, then the broken one, then first.
  const first = highlight("first", null, "1", "2026-09-30T10:00:00Z");
  const second = highlight("second", null, "2", "2026-09-28T10:00:00Z");
  const broken = highlight("broken", null, "not-a-cfi", "2026-09-29T10:00:00Z");

  it("keeps the readable ones in reading order, whatever order the list arrives in", () => {
    const arrivals = [
      [first, second, broken],
      [first, broken, second],
      [second, first, broken],
      [second, broken, first],
      [broken, first, second],
      [broken, second, first]
    ];
    for (const arrival of arrivals) {
      expect(orderHighlights(arrival, compare).map((item) => item.id)).toEqual(["first", "second", "broken"]);
    }
  });

  it("lists the unreadable ones last, oldest first, and settles a tie the same way every time", () => {
    const older = highlight("older", null, "epubcfi(", "2026-09-01T10:00:00Z");
    const twin = highlight("twin", null, "1", "2026-09-30T10:00:00Z");
    const expected = ["first", "twin", "older", "broken"];
    expect(orderHighlights([broken, twin, older, first], compare).map((item) => item.id)).toEqual(expected);
    expect(orderHighlights([first, older, twin, broken], compare).map((item) => item.id)).toEqual(expected);
  });
});

describe("groupByChapter", () => {
  it("groups neighbours under their chapter, in order", () => {
    const groups = groupByChapter([highlight("a", "Chapter 1"), highlight("b", "Chapter 1"), highlight("c", "Chapter 2")]);
    expect(groups.map((group) => [group.chapter, group.items.map((item) => item.id)])).toEqual([
      ["Chapter 1", ["a", "b"]],
      ["Chapter 2", ["c"]]
    ]);
  });

  it("keeps a highlight with no chapter with the one before it", () => {
    const groups = groupByChapter([highlight("a", null), highlight("b", "Chapter 1"), highlight("c", null), highlight("d", "")]);
    expect(groups.map((group) => [group.chapter, group.items.map((item) => item.id)])).toEqual([
      [null, ["a"]],
      ["Chapter 1", ["b", "c", "d"]]
    ]);
  });

  it("takes labels that read the same as one chapter, and a blank one as none", () => {
    const groups = groupByChapter([
      highlight("a", "Chapter 1"),
      highlight("b", "Chapter 1 "),
      highlight("c", "Chapter\n      1"),
      highlight("d", "   "),
      highlight("e", "Chapter 2")
    ]);
    expect(groups.map((group) => [group.chapter, group.items.map((item) => item.id)])).toEqual([
      ["Chapter 1", ["a", "b", "c", "d"]],
      ["Chapter 2", ["e"]]
    ]);
  });

  it("has no groups for no highlights", () => {
    expect(groupByChapter([])).toEqual([]);
  });
});

describe("booksWithHighlights", () => {
  it("lists only library books that have highlights, the most recently read first", () => {
    const books = [
      book("old", "Old", "2026-08-01T00:00:00Z"),
      book("none", "None", "2026-09-30T00:00:00Z"),
      book("new", "New", "2026-09-01T00:00:00Z"),
      book("unopened", "Unopened", null)
    ];
    const listed = booksWithHighlights(books, { old: 2, new: 5, unopened: 1, gone: 9 });
    expect(listed.map((item) => [item.book.id, item.count])).toEqual([
      ["new", 5],
      ["old", 2],
      ["unopened", 1]
    ]);
  });
});
