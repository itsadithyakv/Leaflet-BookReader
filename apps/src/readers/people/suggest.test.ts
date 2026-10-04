import { describe, expect, it } from "vitest";
import { isCommonWord } from "../../services/smartReadService";
import type { NameEntry } from "./names";
import { nameCounter, suggestNames } from "./suggest";

const TEXT = [
  "Ash fell from the sky. Vin watched the flakes drift, and Vin said nothing. Then Kelsier laughed.",
  "The crew met at dusk. “Lord Renoux will see you,” said Sazed. Vin’s hands shook. Kelsier smiled at Vin.",
  "They rode to Luthadel. In Luthadel the mists came early; from Luthadel no one left. Kelsier led Vin to Lord Renoux.",
  "Sazed bowed. “Mistress Vin,” Sazed said, “Lord Renoux is waiting.” On Monday Kelsier and Sazed left. Then Sazed returned."
];

const names = (texts: string[], known: NameEntry[] = []) => suggestNames(texts, known, isCommonWord);

describe("people so far", () => {
  it("offers the names the book keeps using, most used first, each with a count and nothing else", () => {
    const found = names(TEXT);
    expect(found).toEqual([
      { name: "Vin", count: 6 },
      { name: "Sazed", count: 5 },
      { name: "Kelsier", count: 4 },
      { name: "Lord Renoux", count: 3 }
    ]);
    for (const item of found) {
      expect(Object.keys(item).sort()).toEqual(["count", "name"]);
    }
  });

  it("folds a possessive into the name", () => {
    expect(names(TEXT).find((item) => item.name === "Vin")?.count).toBe(6);
    expect(names(TEXT).some((item) => /s$/.test(item.name) && item.name.startsWith("Vin"))).toBe(false);
  });

  it("leaves out words that only begin sentences, places, days and headings in capitals", () => {
    const found = names([...TEXT, "CHAPTER ONE. PROLOGUE. Then they slept. Then they woke. Then they ate. Then they left."]).map(
      (item) => item.name
    );
    expect(found).not.toContain("Then");
    expect(found).not.toContain("They");
    expect(found).not.toContain("Luthadel");
    expect(found).not.toContain("Monday");
    expect(found).not.toContain("CHAPTER");
    expect(found).not.toContain("Ash");
  });

  it("leaves out things, kinds and ideas, which never say or do anything", () => {
    const text =
      "They feared the Ministry. Vin said the Ministry knew. Kelsier said the Ministry would come. " +
      "She was a Mistborn. He had met a Mistborn once; no Mistborn lived long. " +
      "He studied Allomancy. With Allomancy she could fly. Sazed said Allomancy was old. " +
      "I’ve seen it, Vin said. I’ve heard it. I’ll go, and I’ve gone, and I’ll stay. " +
      "Vin nodded. Then Kelsier smiled. Sazed bowed and Sazed said nothing, and Kelsier laughed.";
    const found = names([text]).map((item) => item.name);
    expect([...found].sort()).toEqual(["Kelsier", "Sazed", "Vin"]);
  });

  it("keeps someone always called by a title, though “the” comes first", () => {
    const text = "They feared the Lord Ruler. The crew hated the Lord Ruler, and the Lord Ruler knew. Vin nodded.";
    expect(names([text]).map((item) => item.name)).toEqual(["Lord Ruler"]);
  });

  it("does not ask for English verbs of a book that has none", () => {
    const text =
      "Hier wohnt Anselm. Wir kennen Anselm gut, und Anselm kennt uns. Dann kam Brunhild, mit Brunhild auch Anselm; und Brunhild blieb.";
    expect(names([text]).map((item) => item.name)).toEqual(["Anselm", "Brunhild"]);
  });

  it("leaves out a word also written small: it is not a name", () => {
    const text = "He met Hope. She saw Hope again. And Hope waved. There was no hope left, they said.";
    expect(names([text]).map((item) => item.name)).not.toContain("Hope");
  });

  it("leaves out anyone already on the sheet, under any of their names", () => {
    const known: NameEntry[] = [
      { text: "Vin", person: "v", exact: true },
      { text: "Lord Renoux", person: "r", exact: true }
    ];
    expect(names(TEXT, known).map((item) => item.name)).toEqual(["Sazed", "Kelsier"]);
  });

  it("needs a name to have come up a few times", () => {
    expect(names(["They met Dockson once. Then Dockson left."])).toEqual([]);
  });

  it("stops at a limit", () => {
    expect(suggestNames(TEXT, [], isCommonWord, 2)).toHaveLength(2);
  });

  it("counts only what it was given: a name from later text is not offered", () => {
    // The reader is at the end of the second chapter; the rest was never handed in.
    const soFar = names(TEXT.slice(0, 2)).map((item) => item.name);
    expect(soFar).toEqual(["Vin"]);
    const partWay = TEXT[3].slice(0, TEXT[3].indexOf("On Monday"));
    const counter = nameCounter(isCommonWord);
    [...TEXT.slice(0, 3), partWay].forEach((text) => counter.add(text));
    expect(counter.result([]).find((item) => item.name === "Sazed")?.count).toBe(3);
  });
});
