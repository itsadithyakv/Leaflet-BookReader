import { describe, expect, it } from "vitest";
import { blanked, isHidden, mergeRanges, parts, plainPassage, toggleWord, tokens } from "./fillIn";

describe("a fill-in card's words", () => {
  const passage = "The left ventricle pumps blood into the aorta, via the aortic valve (3.5 cm²).";

  it("are words, not the punctuation beside them", () => {
    const words = tokens(passage).map((token) => token.text);
    expect(words).toContain("aorta");
    expect(words).not.toContain("aorta,");
    expect(words).toContain("3.5");
    expect(words).toContain("cm²");
    expect(tokens("don't end-to-end T4 café").map((token) => token.text)).toEqual(["don't", "end-to-end", "T4", "café"]);
    const at = tokens(passage).find((token) => token.text === "aorta")!;
    expect(passage.slice(at.start, at.end)).toBe("aorta");
  });

  it("tapped, are hidden, and tapped again shown; neighbours make one blank", () => {
    const words = tokens(passage);
    const word = (text: string) => words.find((token) => token.text === text)!;
    let hidden = toggleWord(passage, [], word("left"));
    expect(hidden).toEqual([[4, 8]]);
    hidden = toggleWord(passage, hidden, word("ventricle"));
    expect(hidden).toEqual([[4, 18]]);
    expect(passage.slice(...hidden[0])).toBe("left ventricle");
    hidden = toggleWord(passage, hidden, word("aorta"));
    expect(hidden).toHaveLength(2);
    expect(isHidden(word("aorta"), hidden)).toBe(true);
    // A comma between two words keeps them two blanks.
    hidden = toggleWord(passage, hidden, word("via"));
    expect(hidden).toHaveLength(3);
    hidden = toggleWord(passage, hidden, word("left"));
    expect(passage.slice(...hidden[0])).toBe("ventricle");
    expect(isHidden(word("left"), hidden)).toBe(false);
  });

  it("show in review as blanks, and in the export as [...]", () => {
    const hidden = toggleWord(passage, [], tokens(passage).find((token) => token.text === "aorta")!);
    const laid = parts(passage, hidden);
    expect(laid.filter((part) => part.hidden).map((part) => part.text)).toEqual(["aorta"]);
    expect(laid.map((part) => part.text).join("")).toBe(passage);
    expect(blanked(passage, hidden)).toBe("The left ventricle pumps blood into the [...], via the aortic valve (3.5 cm²).");
  });

  it("ranges merge when they touch, and keep their order", () => {
    expect(mergeRanges([[10, 12], [0, 3], [3, 5], [11, 14], [20, 20]])).toEqual([[0, 5], [10, 14]]);
    expect(plainPassage("  The\n mitral\tvalve ")).toBe("The mitral valve");
  });
});
