import { describe, expect, it } from "vitest";
import { adopt, newBase, raise } from "./rules";
import { TROPHY_KINDS, toRaise, trophyKind, trophyRow } from "./trophies";

describe("the trophy a book earns", () => {
  it("is shaped by what kind of book it was", () => {
    expect(trophyKind(["Epic fantasy"])).toBe(1);
    expect(trophyKind(["Science Fiction"])).toBe(2);
    expect(trophyKind(["Detective and mystery stories"])).toBe(3);
    expect(trophyKind(["Romance"])).toBe(4);
    expect(trophyKind(["Horror"])).toBe(5);
    expect(trophyKind(["Biography & Autobiography"])).toBe(6);
    expect(trophyKind(["Popular science"])).toBe(7);
    expect(trophyKind(["Poetry"])).toBe(8);
    expect(trophyKind(["Sea stories"])).toBe(9);
    expect(trophyKind(["Juvenile Fiction"])).toBe(10);
    expect(TROPHY_KINDS).toHaveLength(11);
  });

  it("is a stack of books when the genres say nothing, or there are none", () => {
    expect(trophyKind(["Fiction"])).toBe(0);
    expect(trophyKind([])).toBe(0);
    expect(trophyKind(null)).toBe(0);
    expect(trophyKind([42, null])).toBe(0);
  });

  it("goes by the genre listed first", () => {
    expect(trophyKind(["History", "Adventure"])).toBe(6);
    expect(trophyKind(["Adventure", "History"])).toBe(9);
    // A mood wins over the rest, as it does for Pip.
    expect(trophyKind(["Young adult", "Fantasy"])).toBe(1);
  });
});

describe("the trophies in the camp", () => {
  const books = [
    { id: "a", title: "Dune", genres: ["Science fiction"], finishedAt: "2026-01-05T10:00:00Z" },
    { id: "b", title: "Emma", genres: ["Classics"], finishedAt: "2026-03-01T10:00:00Z" },
    { id: "c", title: "Dracula", genres: ["Horror"], finishedAt: "2026-02-01T10:00:00Z" }
  ];

  it("are the latest finished of the books that have one, newest first", () => {
    const base = adopt(newBase(0, "2026-10-12"), [{ id: "a", kind: 2 }, { id: "b", kind: 8 }]);
    expect(trophyRow(books, base, 8)).toEqual([
      { id: "b", title: "Emma", kind: 8 },
      { id: "a", title: "Dune", kind: 2 }
    ]);
    expect(trophyRow(books, base, 1)).toHaveLength(1);
  });

  it("wait to be raised, oldest first, for a book finished since", () => {
    const base = adopt(newBase(0, "2026-10-12"), [{ id: "a", kind: 2 }]);
    expect(toRaise(books, base).map((book) => book.title)).toEqual(["Dracula", "Emma"]);
    expect(toRaise(books, raise(base, "c", "Dracula", "2026-10-12")).map((book) => book.title)).toEqual(["Emma"]);
  });
});
