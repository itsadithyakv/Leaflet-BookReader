import { describe, expect, it } from "vitest";
import {
  inPageOrder,
  isBookmarked,
  parsePageBookmarks,
  removeBookmark,
  toggleBookmark,
  type PageBookmark
} from "./pageBookmarks";

const at = new Date("2026-10-04T09:30:00.000Z");

const bookmark = (page: number): PageBookmark => ({
  id: `book-${page}-1`,
  page,
  label: `Page ${page}`,
  createdAt: at.toISOString()
});

describe("bookmarks in the page reader", () => {
  it("bookmarks a page that is not bookmarked", () => {
    const next = toggleBookmark([], "book", 12, at);
    expect(next).toEqual([
      { id: `book-12-${at.getTime()}`, page: 12, label: "Page 12", createdAt: "2026-10-04T09:30:00.000Z" }
    ]);
    expect(isBookmarked(next, 12)).toBe(true);
    expect(isBookmarked(next, 13)).toBe(false);
  });

  it("takes the bookmark off a page that has one, and leaves the others", () => {
    const next = toggleBookmark([bookmark(3), bookmark(12), bookmark(40)], "book", 12, at);
    expect(next.map((entry) => entry.page)).toEqual([3, 40]);
  });

  it("does not change the list it was given", () => {
    const list = [bookmark(3)];
    toggleBookmark(list, "book", 3, at);
    toggleBookmark(list, "book", 4, at);
    expect(list).toEqual([bookmark(3)]);
  });

  it("removes one bookmark by its id", () => {
    expect(removeBookmark([bookmark(3), bookmark(12)], "book-3-1")).toEqual([bookmark(12)]);
    expect(removeBookmark([bookmark(3)], "not-there")).toEqual([bookmark(3)]);
  });

  it("lists them in page order, whenever they were made", () => {
    expect(inPageOrder([bookmark(40), bookmark(3), bookmark(12)]).map((entry) => entry.page)).toEqual([3, 12, 40]);
  });

  it("reads what was stored and leaves out what is not a bookmark", () => {
    expect(parsePageBookmarks([bookmark(3), null, "x", { id: "a", page: "4", label: "Page 4", createdAt: "" }])).toEqual([
      bookmark(3)
    ]);
    expect(parsePageBookmarks(null)).toEqual([]);
    expect(parsePageBookmarks({ page: 3 })).toEqual([]);
  });
});
