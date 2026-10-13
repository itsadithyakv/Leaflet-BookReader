import { afterEach, describe, expect, it } from "vitest";
import { STRETCHES, noteChapter, storyMoved, stretchOf, tellInstead } from "./storyFeed";

describe("the reading, told to the camp", () => {
  const told: Array<[string, number, string]> = [];
  const listen = () => {
    told.length = 0;
    tellInstead((book, stretch, title) => told.push([book, stretch, title]));
  };
  afterEach(() => tellInstead(null));

  it("goes by twentieths of a book that has no chapters to go by", () => {
    listen();
    expect(STRETCHES).toBe(20);
    expect([stretchOf("pdf", 0), stretchOf("pdf", 0.049), stretchOf("pdf", 0.05), stretchOf("pdf", 0.5), stretchOf("pdf", 1)]).toEqual([0, 0, 1, 10, 20]);
    // Out of range is held to the book.
    expect([stretchOf("pdf", -1), stretchOf("pdf", 7)]).toEqual([0, 20]);
  });

  it("goes by the chapter the reader says is on screen, where a book has chapters", () => {
    listen();
    noteChapter("epub", 7, 30);
    expect(stretchOf("epub", 0.9)).toBe(7);
    // A book with none says nothing.
    noteChapter("plain", 0, 0);
    expect(stretchOf("plain", 0.5)).toBe(10);
  });

  it("tells the camp when a book is first seen and when a stretch is finished, not at every page", () => {
    listen();
    storyMoved("book", "A Book", 0.31);
    for (let page = 0; page < 30; page++) storyMoved("book", "A Book", 0.31 + page * 0.001);
    expect(told).toEqual([["book", 6, "A Book"]]);
    storyMoved("book", "A Book", 0.36);
    expect(told).toEqual([
      ["book", 6, "A Book"],
      ["book", 7, "A Book"]
    ]);
    // Back a way, to read something again: nothing.
    storyMoved("book", "A Book", 0.1);
    expect(told).toHaveLength(2);
    // Another book is told of in its own right.
    storyMoved("other", "Other", 0.9);
    expect(told[2]).toEqual(["other", 18, "Other"]);
  });
});
