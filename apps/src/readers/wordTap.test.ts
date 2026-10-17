import { afterEach, describe, expect, it, vi } from "vitest";
import { WORD_TAP_MS, dropHeldTap, holdForSecondTap, isQuickTap, isWordDoubleTap, letHeldTapGo, wordAround } from "./wordTap";

const word = (text: string, at: number) => {
  const found = wordAround(text, at);
  return found ? text.slice(found.start, found.end) : null;
};

describe("wordAround", () => {
  it("finds the word a caret is in, before or after a letter", () => {
    expect(word("The lord ruler", 5)).toBe("lord");
    expect(word("The lord ruler", 4)).toBe("lord");
    expect(word("The lord ruler", 8)).toBe("lord");
    expect(word("The lord ruler", 0)).toBe("The");
    expect(word("The lord ruler", 14)).toBe("ruler");
  });

  it("leaves off punctuation and quotation marks", () => {
    expect(word("“Symbols,” she said.", 3)).toBe("Symbols");
    expect(word("said. Then", 2)).toBe("said");
    expect(word("'Hello' he", 2)).toBe("Hello");
    expect(word("the dogs’ bones", 6)).toBe("dogs");
  });

  it("keeps an apostrophe inside a word", () => {
    expect(word("I don't know", 3)).toBe("don't");
    expect(word("Kelsier’s plan", 2)).toBe("Kelsier’s");
  });

  it("stops at a hyphen or a dash", () => {
    expect(word("well-known man", 1)).toBe("well");
    expect(word("well-known man", 7)).toBe("known");
    expect(word("ash—falling", 8)).toBe("falling");
  });

  it("keeps a soft hyphen inside a word, not at its edges", () => {
    expect(word("extra­ordinary day", 2)).toBe("extra­ordinary");
  });

  it("counts digits and letters of any script", () => {
    expect(word("in 1984 then", 4)).toBe("1984");
    expect(word("ein schönes Haus", 6)).toBe("schönes");
    expect(word("日本語 です", 1)).toBe("日本語");
  });

  it("finds nothing between words or in punctuation alone", () => {
    expect(word("a  b", 2)).toBeNull();
    expect(word("— ... —", 3)).toBeNull();
    expect(word("' '", 0)).toBeNull();
    expect(word("", 0)).toBeNull();
  });

  it("counts in UTF-16 units, as the DOM does", () => {
    const text = "😀 word";
    expect(word(text, 4)).toBe("word");
    expect(wordAround(text, 4)).toEqual({ start: 3, end: 7 });
  });
});

describe("isWordDoubleTap", () => {
  const first = { at: 1000, x: 100, y: 200 };
  it("is two taps close in time and place", () => {
    expect(isWordDoubleTap(first, { at: 1000 + WORD_TAP_MS, x: 110, y: 210 })).toBe(true);
    expect(isWordDoubleTap(first, { at: 1150, x: 100, y: 200 })).toBe(true);
  });
  it("is not two taps too far apart in time, or on the page", () => {
    expect(isWordDoubleTap(first, { at: 1001 + WORD_TAP_MS, x: 100, y: 200 })).toBe(false);
    expect(isWordDoubleTap(first, { at: 1100, x: 140, y: 200 })).toBe(false);
    expect(isWordDoubleTap(null, { at: 1100, x: 100, y: 200 })).toBe(false);
    expect(isWordDoubleTap(first, { at: 900, x: 100, y: 200 })).toBe(false);
  });
  it("only counts taps, not holds or drags", () => {
    expect(isQuickTap(120, 3)).toBe(true);
    expect(isQuickTap(500, 3)).toBe(false);
    expect(isQuickTap(120, 20)).toBe(false);
  });
});

describe("the first tap's work, held", () => {
  afterEach(() => vi.useRealTimers());

  it("runs once the moment for a second tap has passed", () => {
    vi.useFakeTimers();
    const key = {};
    const run = vi.fn();
    holdForSecondTap(key, run);
    vi.advanceTimersByTime(WORD_TAP_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is dropped by a double tap", () => {
    vi.useFakeTimers();
    const key = {};
    const run = vi.fn();
    holdForSecondTap(key, run);
    dropHeldTap(key);
    vi.advanceTimersByTime(WORD_TAP_MS * 2);
    expect(run).not.toHaveBeenCalled();
  });

  it("goes at once, and in order, when another tap is not a double", () => {
    vi.useFakeTimers();
    const key = {};
    const order: string[] = [];
    holdForSecondTap(key, () => order.push("first"));
    letHeldTapGo(key);
    holdForSecondTap(key, () => order.push("second"));
    vi.advanceTimersByTime(WORD_TAP_MS * 2);
    expect(order).toEqual(["first", "second"]);
  });
});
