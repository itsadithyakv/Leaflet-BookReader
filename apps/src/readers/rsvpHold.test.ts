import { describe, expect, it } from "vitest";
import { findNames, holdKey, noveltyHolds, RAMP_WORDS, rsvpRamp, type HoldWord } from "./rsvpHold";

const COMMON = new Set("the a an and of to in was is he she it her his said at on had then with but not you i what".split(" "));
const isCommon = (key: string) => COMMON.has(key);

/** Words as the reader indexes them: letters only, with what follows each kept beside it. */
const wordsOf = (text: string): HoldWord[] => {
  const matches = Array.from(text.matchAll(/[\p{L}\p{N}]+(?:[’'\-.,][\p{L}\p{N}]+)*/gu));
  return matches.map((match, index) => {
    const end = (match.index ?? 0) + match[0].length;
    const trailing = text.slice(end, matches[index + 1]?.index ?? text.length);
    return {
      text: match[0],
      trailing,
      sentenceEnd: /[.!?…]["”’)]*\s*$/.test(trailing) || /[.!?…]["”’)]*\s/.test(trailing),
      paragraphEnd: trailing.includes("\n")
    };
  });
};

const holdsOf = (text: string) => {
  const words = wordsOf(text);
  const holds = noveltyHolds(words, isCommon);
  return words.map((word, index) => [word.text, holds[index]] as const);
};

describe("which words are names", () => {
  it("finds a word capitalised mid-sentence and never written small", () => {
    const names = findNames(wordsOf("Then he saw Sansa at the gate. Then Sansa laughed, and the gate shut."), isCommon);
    expect([...names]).toEqual(["sansa"]);
  });

  it("does not take the start of a sentence, or of speech, for a name", () => {
    const names = findNames(wordsOf("Kelsier smiled. “Perhaps,” he said, “Nothing is certain.” Nothing was."), isCommon);
    expect(names.has("perhaps")).toBe(false);
    expect(names.has("nothing")).toBe(false);
    // Only ever at a sentence's start: not known to be a name.
    expect(names.has("kelsier")).toBe(false);
  });

  it("is not fooled by a word that is also written small", () => {
    const names = findNames(wordsOf("He walked to the Wall. A wall of ice, the wall of the north."), isCommon);
    expect(names.has("wall")).toBe(false);
  });

  it("ignores headings and openings set in capitals", () => {
    const names = findNames(wordsOf("Read on to CHAPTER ONE. ASH FELL from the sky."), isCommon);
    expect(names.size).toBe(0);
  });

  it("counts a possessive with its name", () => {
    expect(holdKey("Vin’s")).toBe("vin");
    expect(holdKey("Jon's")).toBe("jon");
    const names = findNames(wordsOf("It was Vin’s coat. She gave Vin the coat."), isCommon);
    expect([...names]).toEqual(["vin"]);
  });
});

describe("how much longer a new word is held", () => {
  it("holds a name longest when it is introduced, less the next times, then not at all", () => {
    const holds = holdsOf(
      "He met Sansa at the gate. He said to Sansa, then to Sansa again, and to Sansa once more, and Sansa left."
    ).filter(([text]) => text === "Sansa");
    expect(holds.map(([, hold]) => hold)).toEqual([0.9, 0.45, 0.2, 0, 0]);
  });

  it("gives everyday words nothing", () => {
    for (const [text, hold] of holdsOf("He said it was the end of it, and she said it was not.")) {
      if (COMMON.has(text.toLocaleLowerCase())) {
        expect(hold).toBe(0);
      }
    }
  });

  it("holds a long uncommon word the first time and a little the second", () => {
    const holds = holdsOf("It was an atium bead. The obligator watched the obligator, and the obligator bowed.").filter(
      ([text]) => text === "obligator"
    );
    expect(holds.map(([, hold]) => hold)).toEqual([0.3, 0.12, 0]);
  });

  it("holds a figure every time", () => {
    const holds = holdsOf("In 1984 he had 1,200 coins, and in 1984 she had 3.5 more, and 12 less.");
    const figure = (text: string) => holds.filter(([word]) => word === text).map(([, hold]) => hold);
    expect(figure("1984")).toEqual([0.35, 0.35]);
    expect(figure("1,200")).toEqual([0.35]);
    expect(figure("3.5")).toEqual([0.35]);
    expect(figure("12")).toEqual([0]);
  });

  it("gives one hold for each word, whatever the text", () => {
    expect(noveltyHolds([], isCommon)).toEqual([]);
    const odd: HoldWord[] = [{ text: "—", trailing: "", sentenceEnd: false, paragraphEnd: false }];
    expect(noveltyHolds(odd, isCommon)).toEqual([0]);
  });
});

describe("setting off after Play", () => {
  it("starts slower and reaches the chosen pace in a few words", () => {
    expect(rsvpRamp(0)).toBeCloseTo(1.8);
    for (let shown = 1; shown <= RAMP_WORDS; shown += 1) {
      expect(rsvpRamp(shown)).toBeLessThan(rsvpRamp(shown - 1));
    }
    expect(rsvpRamp(RAMP_WORDS)).toBe(1);
    expect(rsvpRamp(500)).toBe(1);
    expect(rsvpRamp(Number.NaN)).toBe(1);
  });
});

describe("words that are capitalised but are not names", () => {
  it("does not take I’m, I’ll, I’d or I’ve for a character being introduced", () => {
    const text = "Then Vin said I’m going, and I’ll be back. She knew I’d wait and I’ve waited. Vin left.";
    const names = findNames(wordsOf(text), isCommon);
    expect(names.has("vin")).toBe(true);
    for (const key of ["im", "ill", "id", "ive"]) {
      expect(names.has(key)).toBe(false);
    }
    const held = new Map(holdsOf(text));
    expect(held.get("I’m")).toBe(0);
    expect(held.get("I’ll")).toBe(0);
  });
});
