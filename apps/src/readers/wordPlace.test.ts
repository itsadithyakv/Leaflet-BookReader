import { describe, expect, it } from "vitest";
import { indexOfPlace, wordPlace } from "./wordPlace";

describe("finding a word again after the page was laid out afresh", () => {
  it("names a word by its chapter and its number in it", () => {
    // Chapters 11, 12 and 13 on the page, of 5,000, 4,000 and 3,000 words.
    const starts = [0, 5000, 9000];
    const ids = [11, 12, 13];
    expect(wordPlace(0, starts, ids)).toEqual({ section: 11, offset: 0 });
    expect(wordPlace(6200, starts, ids)).toEqual({ section: 12, offset: 1200 });
    expect(wordPlace(9000, starts, ids)).toEqual({ section: 13, offset: 0 });
  });

  it("finds it when the chapter above is no longer loaded", () => {
    // After a resize epub.js rendered chapter 12 again, with 13 below it and
    // nothing above: word 6,200 is now word 1,200.
    const place = wordPlace(6200, [0, 5000, 9000], [11, 12, 13]);
    expect(indexOfPlace(place, [0, 4000], [12, 13], 7000)).toBe(1200);
  });

  it("finds it when a chapter was loaded above", () => {
    const place = wordPlace(1200, [0, 4000], [12, 13]);
    expect(indexOfPlace(place, [0, 5000, 9000], [11, 12, 13], 12000)).toBe(6200);
  });

  it("has no number for a word whose chapter has left the page", () => {
    const place = wordPlace(6200, [0, 5000, 9000], [11, 12, 13]);
    expect(indexOfPlace(place, [0, 3000], [13, 14], 8000)).toBe(-1);
  });

  it("does not reach into the next chapter", () => {
    // The chapter came back shorter (the index stopped at its cap).
    expect(indexOfPlace({ section: 12, offset: 4500 }, [0, 4000], [12, 13], 7000)).toBe(-1);
    expect(indexOfPlace({ section: 13, offset: 3000 }, [0, 4000], [12, 13], 7000)).toBe(-1);
    expect(indexOfPlace({ section: 13, offset: 2999 }, [0, 4000], [12, 13], 7000)).toBe(6999);
  });

  it("has no place without an index", () => {
    expect(wordPlace(10, [], [])).toBeNull();
    expect(wordPlace(-1, [0], [4])).toBeNull();
    // A jump elsewhere forgets which chapters the old numbers were in.
    expect(wordPlace(10, [0, 5000], [])).toBeNull();
    expect(indexOfPlace(null, [0], [4], 100)).toBe(-1);
  });
});
