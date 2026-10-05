import { describe, expect, it } from "vitest";
import {
  chapterEndFor,
  describeMinutes,
  describeMinutesShort,
  minutesFor,
  roundMinutes,
  steadyMinutes,
  wordsLeft,
  wordsPerByte
} from "./timeLeft";
import type { SectionWeights } from "./progress";

/** A book of a title page, four chapters and notes: the story is sections 1 to 4. */
const bytes = [800, 60_000, 30_000, 90_000, 20_000, 12_000];
const prefix = bytes.reduce<number[]>((sums, size) => [...sums, sums[sums.length - 1] + size], [0]);
const weights: SectionWeights = { bytes, prefix, lo: 1, hi: 4, last: 4 };

describe("time left", () => {
  it("learns the words a byte holds from the chapters counted, not from a title page", () => {
    expect(wordsPerByte(new Map(), bytes)).toBeNull();
    // A title page is all markup: too small to say anything.
    expect(wordsPerByte(new Map([[0, 12]]), bytes)).toBeNull();
    const one = wordsPerByte(new Map([[1, 9000]]), bytes);
    expect(one?.ratio).toBeCloseTo(0.15);
    const two = wordsPerByte(new Map([[1, 9000], [2, 4800]]), bytes);
    expect(two?.ratio).toBeCloseTo(13_800 / 90_000);
    expect(two?.bytes).toBe(90_000);
  });

  it("leaves what is outside the story out of the sample, when told what the story is", () => {
    // The notes (section 5: 12,000 bytes of lists, 900 words) hold far fewer words for their size than a chapter.
    const inStory = (section: number) => section >= 1 && section <= 4;
    const counted = new Map([[1, 9000], [5, 900]]);
    expect(wordsPerByte(counted, bytes)?.ratio).toBeCloseTo(9900 / 72_000);
    expect(wordsPerByte(counted, bytes, null, inStory)?.ratio).toBeCloseTo(0.15);
    // Nothing of the story counted yet: no ratio from the notes alone (the remembered one, when there is one).
    expect(wordsPerByte(new Map([[5, 900]]), bytes, null, inStory)).toBeNull();
    expect(wordsPerByte(new Map([[5, 900]]), bytes, { ratio: 0.16, bytes: 150_000 }, inStory)?.ratio).toBe(0.16);
  });

  it("keeps the ratio from an earlier visit until this one has counted more", () => {
    const remembered = { ratio: 0.16, bytes: 150_000 };
    expect(wordsPerByte(new Map(), bytes, remembered)?.ratio).toBe(0.16);
    expect(wordsPerByte(new Map([[1, 9000]]), bytes, remembered)?.ratio).toBe(0.16);
    expect(wordsPerByte(new Map([[1, 9000], [3, 13_500], [2, 4500]]), bytes, remembered)?.ratio).toBeCloseTo(0.15);
  });

  it("counts the words on the page and estimates the rest from their size", () => {
    // Half way through chapter 2 (section 2), which is counted; the rest are not.
    const left = wordsLeft({ weights, section: 2, within: 0.5, chapterEnd: 2, counted: new Map([[2, 4800]]), ratio: 0.15 });
    expect(left.chapter).toBeCloseTo(2400);
    // The rest of the chapter, then chapters 3 and 4 by size; the notes are not reading left.
    expect(left.book).toBeCloseTo(2400 + 90_000 * 0.15 + 20_000 * 0.15);
  });

  it("follows a chapter over several files", () => {
    const left = wordsLeft({ weights, section: 2, within: 0, chapterEnd: 3, counted: new Map(), ratio: 0.1 });
    expect(left.chapter).toBeCloseTo(3000 + 9000);
  });

  it("stops at the next heading when chapters share a file", () => {
    // Section 3 holds several chapters; the one being read runs from 20% to 50% of it.
    const shared = wordsLeft({ weights, section: 3, within: 0.3, chapterEnd: 3, chapterEndWithin: 0.5, counted: new Map([[3, 10_000]]), ratio: 0.1 });
    expect(shared.chapter).toBeCloseTo(2000);
    // The book is still the rest of the file and what follows.
    expect(shared.book).toBeCloseTo(7000 + 20_000 * 0.1);
    // A heading already passed (or none) is no end: the chapter runs to the end of the file.
    expect(wordsLeft({ weights, section: 3, within: 0.6, chapterEnd: 3, chapterEndWithin: 0.5, counted: new Map([[3, 10_000]]), ratio: 0.1 }).chapter).toBeCloseTo(4000);
    expect(wordsLeft({ weights, section: 3, within: 0.6, chapterEnd: 3, chapterEndWithin: null, counted: new Map([[3, 10_000]]), ratio: 0.1 }).chapter).toBeCloseTo(4000);
  });

  it("counts the head of the next file when the chapter runs into it", () => {
    // The chapter being read ends a quarter of the way down section 4.
    const left = wordsLeft({ weights, section: 3, within: 0.9, chapterEnd: 3, chapterTail: { section: 4, within: 0.25 }, counted: new Map([[3, 10_000]]), ratio: 0.1 });
    expect(left.chapter).toBeCloseTo(1000 + 20_000 * 0.1 * 0.25);
  });

  it("says nothing of the book past the end of the story, and counts the story from front matter", () => {
    expect(wordsLeft({ weights, section: 5, within: 0.2, chapterEnd: 5, counted: new Map(), ratio: 0.1 }).book).toBeNull();
    const front = wordsLeft({ weights, section: 0, within: 0, chapterEnd: 0, counted: new Map(), ratio: 0.1 });
    expect(front.book).toBeCloseTo((800 + 60_000 + 30_000 + 90_000 + 20_000) * 0.1);
  });

  it("finds where a chapter ends from the contents", () => {
    expect(chapterEndFor(2, [1, 2, 4, 5], 5)).toBe(3);
    expect(chapterEndFor(3, [1, 2, 4, 5], 5)).toBe(3);
    expect(chapterEndFor(5, [1, 2, 4, 5], 5)).toBe(5);
    expect(chapterEndFor(2, [], 5)).toBe(5);
  });

  it("rounds to what a reader would say", () => {
    expect(roundMinutes(0.4)).toBe(0);
    expect(roundMinutes(1.2)).toBe(1);
    expect(roundMinutes(7.4)).toBe(7);
    expect(roundMinutes(23)).toBe(25);
    expect(roundMinutes(58)).toBe(60);
    expect(roundMinutes(203)).toBe(200);
    expect(roundMinutes(412)).toBe(420);
    expect(roundMinutes(1130)).toBe(1140);
    expect(roundMinutes(Number.NaN)).toBe(0);
  });

  it("says it honestly", () => {
    expect(describeMinutes(0)).toBe("less than a minute");
    expect(describeMinutes(12)).toBe("about 12 min");
    expect(describeMinutes(60)).toBe("about 1 hour");
    expect(describeMinutes(180)).toBe("about 3 hours");
    expect(describeMinutes(200)).toBe("about 3 h 20 min");
    expect(describeMinutesShort(0)).toBe("<1 min");
    expect(describeMinutesShort(45)).toBe("45 min");
    expect(describeMinutesShort(200)).toBe("3 h 20 min");
    expect(describeMinutesShort(120)).toBe("2 h");
  });

  it("does not twitch when the estimate wobbles across a rounding edge", () => {
    // 22.4 rounds to 20, 22.6 to 25: a chapter loading must not flip it back and forth.
    expect(steadyMinutes(null, 22.4)).toBe(20);
    expect(steadyMinutes(20, 22.6)).toBe(20);
    expect(steadyMinutes(20, 23.4)).toBe(20);
    expect(steadyMinutes(20, 24.5)).toBe(25);
    // The hours: 3 h 20 stays through a few minutes' wobble.
    expect(steadyMinutes(200, 206)).toBe(200);
    expect(steadyMinutes(200, 194)).toBe(200);
  });

  it("comes down as the reader reads, and moves at once after a jump", () => {
    let shown: number | null = null;
    const seen: number[] = [];
    for (let minutes = 14; minutes >= 0; minutes -= 0.5) {
      shown = steadyMinutes(shown, minutes);
      seen.push(shown);
    }
    // Never back up, and every step on the way down is shown.
    expect(seen.every((value, index) => index === 0 || value <= seen[index - 1])).toBe(true);
    expect(seen[0]).toBe(15);
    expect(seen[seen.length - 1]).toBe(0);
    expect(steadyMinutes(15, 140)).toBe(140);
    expect(steadyMinutes(140, 3)).toBe(3);
  });

  it("needs a pace to say anything", () => {
    expect(minutesFor(2400, null)).toBeNull();
    expect(minutesFor(2400, 0)).toBeNull();
    expect(minutesFor(2400, 240)).toBeCloseTo(10);
  });
});
