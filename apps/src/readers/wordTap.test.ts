import { describe, expect, it } from "vitest";
import { wordAround } from "./wordTap";

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
