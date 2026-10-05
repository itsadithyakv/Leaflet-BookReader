import { describe, expect, it } from "vitest";
import { findFolded, foldText, hasMarks } from "./searchFold";

const found = (text: string, query: string) => findFolded(text, query).map(([start, end]) => text.slice(start, end));

describe("search without the accents typed", () => {
  it("finds a word that has them in the book", () => {
    expect(found("The Mirañha people, and the Mirañhas' river.", "miranha")).toEqual(["Mirañha", "Mirañha"]);
    expect(found("A naïve façade", "naive facade")).toEqual(["naïve façade"]);
    expect(found("Émile came. EMILE went.", "emile")).toEqual(["Émile", "EMILE"]);
  });

  it("finds it when the mark is a separate character in the file", () => {
    // "a" followed by a combining tilde, as some files are written.
    const text = "the Mirañha river";
    expect(found(text, "miranha")).toEqual(["Mirañha"]);
    expect(found(text, "Mira")).toEqual(["Mira"]);
    // The match ends after the mark, not before it.
    expect(found(text, "miran")).toEqual(["Mirañ"]);
  });

  it("matches what is typed with a mark only where the book has it", () => {
    expect(found("resume and résumé", "résumé")).toEqual(["résumé"]);
    expect(found("resume and résumé", "resume")).toEqual(["resume", "résumé"]);
    expect(hasMarks("résumé")).toBe(true);
    expect(hasMarks("resume")).toBe(false);
  });

  it("is still a plain search, whatever the case", () => {
    expect(found("The House of Usher; the house fell.", "the house")).toEqual(["The House", "the house"]);
    expect(found("aaa", "aa")).toEqual(["aa", "aa"]);
    expect(found("nothing here", "xyz")).toEqual([]);
    expect(found("anything", "")).toEqual([]);
  });

  it("keeps its places when folding changes the length of the text", () => {
    // "İ" lowers to two characters, "ß" stays one, an emoji is two units.
    const text = "İstanbul 😀 straße café";
    expect(found(text, "cafe")).toEqual(["café"]);
    expect(found(text, "istanbul")).toEqual(["İstanbul"]);
    const folded = foldText("Ça va");
    expect(folded.text).toBe("ca va");
    expect(folded.from).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
