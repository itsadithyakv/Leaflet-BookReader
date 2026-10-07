import { describe, expect, it } from "vitest";
import { LOOK_MS, isLook, placeAtOpen, placeFollows } from "./openAt";
import { encodeFindPlace } from "./findPlace";

describe("a book opened at a highlight", () => {
  it("saves the place as usual in an ordinary visit", () => {
    expect(placeFollows(false, 0)).toBe(true);
    expect(placeFollows(false, 5_000)).toBe(true);
  });

  it("leaves the saved place alone while it is a look", () => {
    expect(placeFollows(true, 0)).toBe(false);
    expect(placeFollows(true, 30_000)).toBe(false);
    expect(placeFollows(true, LOOK_MS - 1)).toBe(false);
  });

  it("follows the reader once they have stayed", () => {
    expect(placeFollows(true, LOOK_MS)).toBe(true);
    expect(placeFollows(true, 10 * 60_000)).toBe(true);
  });
});

describe("a book opened at a match of the library's search", () => {
  const cfi = "epubcfi(/6/14!/4/2/10,/1:0,/1:24)";
  const match = encodeFindPlace({ href: "text/ch7.xhtml", spine: 6, nth: 2, query: "lighthouse" });

  it("has no place to go to until the words are found in the open book", () => {
    expect(placeAtOpen(null)).toBeNull();
    expect(placeAtOpen(cfi)).toBe(cfi);
    // Never handed on as if it were a CFI: the reader holds where the reading stopped meanwhile.
    expect(placeAtOpen(match)).toBeNull();
  });

  it("is a look, like a highlight, once the reader has been taken there", () => {
    expect(isLook(match)).toBe(true);
    expect(isLook(match, true)).toBe(true);
    expect(placeFollows(isLook(match), 0)).toBe(false);
    expect(placeFollows(isLook(match), LOOK_MS - 1)).toBe(false);
    expect(placeFollows(isLook(match), LOOK_MS)).toBe(true);
  });

  it("is an ordinary visit when the book has no such section: the place follows from the start", () => {
    expect(isLook(match, false)).toBe(false);
    expect(placeFollows(isLook(match, false), 0)).toBe(true);
  });

  it("leaves a highlight's look and an ordinary visit as they were", () => {
    expect(isLook(null)).toBe(false);
    expect(isLook(null, false)).toBe(false);
    expect(isLook(cfi)).toBe(true);
    // A highlight whose place no longer resolves is still a look: the book opens near it.
    expect(isLook(cfi, false)).toBe(true);
  });
});
