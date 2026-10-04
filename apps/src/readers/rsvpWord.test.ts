import { describe, expect, it } from "vitest";
import { glyphEm, RSVP_ANCHOR, RSVP_ANCHOR_EM, rsvpExtents, rsvpFit, rsvpPivotIndex } from "./rsvpWord";

/** How far through the word, by width, the middle of its pivot letter is. */
const pivotShare = (text: string) => {
  const widths = Array.from(text, glyphEm);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const pivot = rsvpPivotIndex(text);
  return (widths.slice(0, pivot).reduce((sum, width) => sum + width, 0) + widths[pivot] / 2) / total;
};

describe("the letter SpeedRead holds still", () => {
  it("is the word itself for a letter, and the second letter of a short word", () => {
    expect(rsvpPivotIndex("a")).toBe(0);
    expect(rsvpPivotIndex("I")).toBe(0);
    expect(rsvpPivotIndex("of")).toBe(1);
    expect(rsvpPivotIndex("the")).toBe(1);
    expect(rsvpPivotIndex("house")).toBe(1);
  });

  it("skips opening quotes and brackets", () => {
    expect(rsvpPivotIndex("“Hello")).toBe(2);
    expect(rsvpPivotIndex("(a")).toBe(1);
    expect(rsvpPivotIndex("‘")).toBe(0);
  });

  it("is about a third of the way through a long word, not a quarter", () => {
    // By letter count these used to pivot on the 5th of 15 and of 20 letters.
    for (const word of ["extraordinarily", "responsibilities", "incomprehensibility", "counterrevolutionary", "Allomantically"]) {
      const share = pivotShare(word);
      expect(share).toBeGreaterThan(0.28);
      expect(share).toBeLessThan(0.44);
    }
  });

  it("goes by how wide the letters are, not how many there are", () => {
    // Narrow letters first: the eye's place is more letters in.
    expect(rsvpPivotIndex("illicitly")).toBeGreaterThan(rsvpPivotIndex("mammogram"));
  });

  it("never rests on a hyphen or an apostrophe, or on the first letter of a long word", () => {
    for (const word of ["mother-in-law", "well-being", "wouldn’t’ve", "o’clock-ish", "re-entered"]) {
      const pivot = rsvpPivotIndex(word);
      expect(word[pivot]).toMatch(/[\p{L}\p{N}]/u);
      expect(pivot).toBeGreaterThan(0);
    }
  });

  it("stays inside the word", () => {
    for (const word of ["", "a", "ab", "“", "“a", "-------", "x".repeat(60)]) {
      const pivot = rsvpPivotIndex(word);
      expect(pivot).toBeGreaterThanOrEqual(0);
      expect(pivot).toBeLessThanOrEqual(Math.max(0, word.length - 1));
    }
  });
});

describe("fitting a word to SpeedRead's stage", () => {
  it("leaves ordinary words at full size", () => {
    for (const word of ["the", "reading", "beautiful", "understanding", "extraordinary"]) {
      expect(rsvpFit(word, rsvpPivotIndex(word))).toBe(1);
    }
  });

  it("sets a very long word smaller instead of cutting it off", () => {
    const word = "counterrevolutionaries’,";
    const fit = rsvpFit(word, rsvpPivotIndex(word));
    expect(fit).toBeLessThan(1);
    expect(fit).toBeGreaterThan(0.5);
    // At that size both sides are inside the room either side of the spot.
    const widths = Array.from(word, glyphEm);
    const pivot = rsvpPivotIndex(word);
    const left = widths.slice(0, pivot).reduce((sum, width) => sum + width, 0) + widths[pivot] / 2;
    const right = widths.slice(pivot + 1).reduce((sum, width) => sum + width, 0) + widths[pivot] / 2;
    expect(left * fit).toBeLessThanOrEqual(9 * RSVP_ANCHOR);
    expect(right * fit).toBeLessThanOrEqual(9 * (1 - RSVP_ANCHOR));
  });

  it("counts the punctuation shown after the word", () => {
    const word = "responsibilities";
    expect(rsvpFit(`${word}…”)`, rsvpPivotIndex(word))).toBeLessThanOrEqual(rsvpFit(word, rsvpPivotIndex(word)));
  });

  it("has a floor, so nothing is set too small to read", () => {
    expect(rsvpFit("x".repeat(200), 5)).toBe(0.4);
    expect(rsvpFit("", 0)).toBe(1);
  });
});

describe("how far a word reaches either side of its pivot", () => {
  const byGlyph = (text: string) => Array.from(text).reduce((sum, char) => sum + glyphEm(char), 0);

  it("splits the word at the middle of its pivot letter", () => {
    const word = "reading";
    const pivot = rsvpPivotIndex(word);
    const reach = rsvpExtents(word, pivot, byGlyph);
    expect(reach.left + reach.right).toBeCloseTo(byGlyph(word));
    expect(reach.left).toBeCloseTo(byGlyph(word.slice(0, pivot)) + glyphEm(word[pivot]) / 2);
    // The pivot is left of the middle, so more of the word lies to its right.
    expect(reach.right).toBeGreaterThan(reach.left);
  });

  it("counts the punctuation shown after the word on its right", () => {
    const pivot = rsvpPivotIndex("morning");
    expect(rsvpExtents("morning,”", pivot, byGlyph).right).toBeGreaterThan(rsvpExtents("morning", pivot, byGlyph).right);
    expect(rsvpExtents("morning,”", pivot, byGlyph).left).toBeCloseTo(rsvpExtents("morning", pivot, byGlyph).left);
  });

  it("has an answer for a letter on its own, and for nothing", () => {
    expect(rsvpExtents("a", 0, byGlyph)).toEqual({ left: glyphEm("a") / 2, right: glyphEm("a") / 2 });
    expect(rsvpExtents("", 0, byGlyph)).toEqual({ left: 0, right: 0 });
    // Without a measure it estimates, a little wide rather than a little narrow.
    expect(rsvpExtents("reading", 2).right).toBeGreaterThan(rsvpExtents("reading", 2, byGlyph).right);
  });

  it("holds the pivot of an ordinary word about half an em from the word's middle", () => {
    // Which is why the spot is RSVP_ANCHOR_EM left of the stage's middle.
    const offsets = ["morning", "silence", "window", "letters", "harbour", "village", "question"].map((word) => {
      const reach = rsvpExtents(word, rsvpPivotIndex(word));
      return (reach.right - reach.left) / 2;
    });
    const mean = offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
    expect(Math.abs(mean - RSVP_ANCHOR_EM)).toBeLessThan(0.25);
  });
});
