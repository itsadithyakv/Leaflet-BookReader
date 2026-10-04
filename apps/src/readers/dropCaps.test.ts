import { describe, expect, it } from "vitest";
import { classifyOpening, hintsDropCap, hintsSmallCaps, keptLeading, keptSize, type OpeningCandidate } from "./dropCaps";

/** An inline element at the start of a paragraph, as the publisher styled it. */
const element = (over: Partial<OpeningCandidate>): OpeningCandidate => ({
  text: "T",
  atStart: true,
  sizeRatio: 1,
  floated: false,
  smallCapsVariant: false,
  upperTransform: false,
  hint: "",
  ...over
});

describe("a chapter's opening", () => {
  it("knows <span class=\"dropcap\">T</span>he by its size and its float, whatever its class", () => {
    // .dropcap { float: left; font-size: 3.4em }
    expect(classifyOpening(element({ sizeRatio: 3.4, floated: true, hint: "dropcap" }))).toBe("dropcap");
    // The same with a class that says nothing: .x1 { float: left; font-size: 48px }
    expect(classifyOpening(element({ text: "A", sizeRatio: 3, floated: true, hint: "x1" }))).toBe("dropcap");
  });

  it("knows a floated bold, and a raised initial that is only larger", () => {
    // <b style="float:left;font-size:300%">W</b>hen
    expect(classifyOpening(element({ text: "W", sizeRatio: 3, floated: true }))).toBe("dropcap");
    // <big class="raised">O</big>nce: not floated, 2.6 times the size
    expect(classifyOpening(element({ text: "O", sizeRatio: 2.6 }))).toBe("dropcap");
  });

  it("takes a quote mark with the letter, and a class name when the styles say nothing", () => {
    expect(classifyOpening(element({ text: "“I", sizeRatio: 3.4, floated: true }))).toBe("dropcap");
    expect(classifyOpening(element({ text: "Q", hint: "calibre7 drop-cap" }))).toBe("dropcap");
    expect(classifyOpening(element({ text: "Q", hint: "initial" }))).toBe("dropcap");
  });

  it("leaves an ordinary bold or italic first word alone", () => {
    // <b>The</b> answer: three letters, but no larger than its paragraph and not floated.
    expect(classifyOpening(element({ text: "The" }))).toBeNull();
    expect(classifyOpening(element({ text: "A" }))).toBeNull();
    // Slightly larger is emphasis, not a cap.
    expect(classifyOpening(element({ text: "A", sizeRatio: 1.2 }))).toBeNull();
    // A large word is not a cap either.
    expect(classifyOpening(element({ text: "Once", sizeRatio: 3, floated: true }))).toBeNull();
  });

  it("leaves anything that is not at the start of its paragraph", () => {
    expect(classifyOpening(element({ atStart: false, sizeRatio: 3, floated: true, hint: "dropcap" }))).toBeNull();
    expect(classifyOpening(element({ text: "in the summer", atStart: false, smallCapsVariant: true }))).toBeNull();
  });

  it("has nothing to mark for ::first-letter: there is no element", () => {
    // <p class="fl">Letters arrived…</p> begins with text; a wrapper around
    // the whole paragraph is far too long to be an opening.
    expect(classifyOpening(element({ text: "Letters arrived every evening by the market road. ".repeat(4), sizeRatio: 1 }))).toBeNull();
  });

  it("knows a first few words in small capitals, real or made of smaller capitals", () => {
    expect(classifyOpening(element({ text: "The forest path", smallCapsVariant: true }))).toBe("smallcaps");
    // .sc { text-transform: uppercase; font-size: 0.8em }
    expect(classifyOpening(element({ text: "ll through the winter", sizeRatio: 0.8, upperTransform: true, hint: "sc" }))).toBe("smallcaps");
    // Typed in capitals and set smaller.
    expect(classifyOpening(element({ text: "IN THE SUMMER", sizeRatio: 0.82 }))).toBe("smallcaps");
    // Smaller, and named for what it is.
    expect(classifyOpening(element({ text: "he morning", sizeRatio: 0.85, hint: "smallcaps" }))).toBe("smallcaps");
  });

  it("does not take smaller or capital text alone for small capitals", () => {
    expect(classifyOpening(element({ text: "a quiet aside", sizeRatio: 0.8 }))).toBeNull();
    expect(classifyOpening(element({ text: "NASA REPORTS", sizeRatio: 1 }))).toBeNull();
    expect(classifyOpening(element({ text: "x".repeat(120), smallCapsVariant: true }))).toBeNull();
  });

  it("reads class names without mistaking one for the other", () => {
    expect(hintsDropCap("dropcap")).toBe(true);
    expect(hintsDropCap("para drop-cap3")).toBe(true);
    expect(hintsDropCap("caption")).toBe(false);
    expect(hintsDropCap("small-cap")).toBe(false);
    expect(hintsSmallCaps("smallcaps")).toBe(true);
    expect(hintsSmallCaps("calibre1 sc")).toBe(true);
    expect(hintsSmallCaps("misc")).toBe(false);
  });

  it("keeps the size as a multiple of the reading size, within what a page can hold", () => {
    expect(keptSize("dropcap", 3.4)).toBeCloseTo(3.4);
    expect(keptSize("dropcap", 12)).toBe(6);
    // Floated but no larger: nothing is shrunk.
    expect(keptSize("dropcap", 0.9)).toBe(1);
    expect(keptSize("smallcaps", 0.8)).toBeCloseTo(0.8);
    expect(keptSize("smallcaps", 0.2)).toBe(0.6);
    expect(keptSize("smallcaps", Number.NaN)).toBe(1);
  });

  it("gives a cap a line of its own height, not the paragraph's", () => {
    // The publisher's own: kept.
    expect(keptLeading(0.8, true)).toBeCloseTo(0.8);
    // Inherited from a paragraph at 1.8: brought down, or the cap holds five lines away.
    expect(keptLeading(1.8, true)).toBe(1.15);
    // A floated cap with no height would have the text run over it.
    expect(keptLeading(0, true)).toBe(0.6);
    // A raised initial may have none: it must not push its line down.
    expect(keptLeading(0, false)).toBe(0);
  });
});
