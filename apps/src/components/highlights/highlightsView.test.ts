import { describe, expect, it } from "vitest";
import type { Book } from "@shared/models/book";
import type { Annotation } from "../../services/annotationService";
import { booksWithHighlights, groupByChapter, orderHighlights, sectionOfCfi } from "./highlightsView";

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

  // A place in section `n` of the book (its `n`th file), as epub.js writes one.
  const at = (section: number, step = 2) => `epubcfi(/6/${(section + 1) * 2}!/4/${step},/1:0,/1:9)`;

  it("keeps two chapters of the same name apart: a chapter is a place", () => {
    // A novel told by its people: "Mara" is the name of chapters 3 and 9, and nothing between is highlighted.
    const groups = groupByChapter([highlight("a", "Mara", at(3)), highlight("b", "Mara", at(3, 8)), highlight("c", "Mara", at(9)), highlight("d", "Mara", at(9, 4))]);
    expect(groups.map((group) => [group.chapter, group.items.map((item) => item.id)])).toEqual([
      ["Mara", ["a", "b"]],
      ["Mara", ["c", "d"]]
    ]);
  });

  it("takes a chapter that runs over two files as one", () => {
    const groups = groupByChapter([highlight("a", "Chapter 4", at(5)), highlight("b", "Chapter 4", at(6)), highlight("c", "Chapter 4", at(7))]);
    expect(groups.map((group) => group.items.length)).toEqual([3]);
  });

  it("goes by the name alone when a place cannot be read", () => {
    expect(groupByChapter([highlight("a", "Mara", at(3)), highlight("b", "Mara", "not a cfi"), highlight("c", "Mara", at(4))]).map((group) => group.items.length)).toEqual([3]);
    expect(groupByChapter([highlight("a", "Mara", "x"), highlight("b", "Mara", "y")]).map((group) => group.items.length)).toEqual([2]);
    // The one whose place is known still parts two chapters either side of it.
    expect(groupByChapter([highlight("a", "Mara", at(3)), highlight("b", "Mara", "not a cfi"), highlight("c", "Mara", at(9))]).map((group) => group.items.length)).toEqual([2, 1]);
    expect(sectionOfCfi(at(0))).toBe(0);
    expect(sectionOfCfi(at(41))).toBe(41);
    expect(sectionOfCfi("epubcfi(/6/14[c07]!/4/2/1:3)")).toBe(6);
    expect(sectionOfCfi("x")).toBeNull();
    expect(sectionOfCfi(null)).toBeNull();
  });

  it("names a set's book once, above its chapters", () => {
    const groups = groupByChapter([
      highlight("a", "The First Book · Mara", at(3)),
      highlight("b", "The First Book · Tomas", at(4)),
      highlight("c", "The First Book · Mara", at(9)),
      highlight("d", "The Second Book", at(40)),
      highlight("e", "The Second Book · Mara", at(44)),
      highlight("f", "The Second Book · Ilse", at(47)),
      // A third book with one chapter highlighted: a book all the same, in a set.
      highlight("g", "The Third Book · Mara", at(80))
    ]);
    expect(groups.map((group) => [group.book ?? null, group.opensBook ?? false, group.chapter])).toEqual([
      ["The First Book", true, "Mara"],
      ["The First Book", false, "Tomas"],
      ["The First Book", false, "Mara"],
      [null, false, "The Second Book"],
      ["The Second Book", true, "Mara"],
      ["The Second Book", false, "Ilse"],
      ["The Third Book", true, "Mara"]
    ]);
  });

  it("does not take a chapter's own title for a book", () => {
    // A made chapter list joins a number and its title the same way.
    const groups = groupByChapter([highlight("a", "Chapter 1 · The Orchard", at(1)), highlight("b", "Chapter 2 · The Ferry", at(1, 90)), highlight("c", "Chapter 2 · The Ferry", at(2))]);
    expect(groups.map((group) => [group.book ?? null, group.chapter, group.items.length])).toEqual([
      [null, "Chapter 1 · The Orchard", 1],
      [null, "Chapter 2 · The Ferry", 2]
    ]);
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
