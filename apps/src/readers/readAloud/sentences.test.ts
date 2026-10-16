import { describe, expect, it } from "vitest";
import { cutLong, LONG_SENTENCE, splitSentences } from "./sentences";

const split = (text: string) => splitSentences(text).map(({ start, end }) => text.slice(start, end));

describe("splitSentences", () => {
  it("ends sentences at full stops, questions and exclamations", () => {
    expect(split("It was cold. Was it? Yes! Quite.")).toEqual(["It was cold.", "Was it?", "Yes!", "Quite."]);
  });

  it("keeps titles, initials and dotted abbreviations inside the sentence", () => {
    expect(split("Mr. Smith met Dr. Jones at St. Paul's. They spoke.")).toEqual(["Mr. Smith met Dr. Jones at St. Paul's.", "They spoke."]);
    expect(split("J. R. R. Tolkien wrote it. Then he slept.")).toEqual(["J. R. R. Tolkien wrote it.", "Then he slept."]);
    expect(split("Bring tea, e.g. green or black. Thanks.")).toEqual(["Bring tea, e.g. green or black.", "Thanks."]);
    expect(split("It weighed 3.5 kg. Heavy.")).toEqual(["It weighed 3.5 kg.", "Heavy."]);
  });

  it("keeps closing quotes with their sentence, and a quote followed by its speaker as one", () => {
    expect(split("“Stop!” he said. “Now.” She left.")).toEqual(["“Stop!” he said.", "“Now.”", "She left."]);
    expect(split('"Is it you?" asked Vin. "Yes."')).toEqual(['"Is it you?" asked Vin.', '"Yes."']);
    expect(split("He nodded (slowly.) Then went.")).toEqual(["He nodded (slowly.)", "Then went."]);
  });

  it("reads an ellipsis on into a lower-case word, and ends at one before a capital", () => {
    expect(split("Well… perhaps not. Fine.")).toEqual(["Well… perhaps not.", "Fine."]);
    expect(split("He waited... Nothing came.")).toEqual(["He waited...", "Nothing came."]);
    expect(split("And then . . . Silence.")).toEqual(["And then . . .", "Silence."]);
  });

  it("never reads a line break on into the next block", () => {
    expect(split("Chapter One\nThe ash fell")).toEqual(["Chapter One", "The ash fell"]);
  });

  it("leaves out runs with no words (a scene break), and trims space", () => {
    expect(split("  One.  \n* * *\n  Two.")).toEqual(["One.", "Two."]);
  });

  it("does not cut inside a web address or a number", () => {
    expect(split("See www.example.com for more. Done.")).toEqual(["See www.example.com for more.", "Done."]);
  });

  it("ends at the stops of a script written without spaces", () => {
    expect(split("今日は雨です。明日は晴れ。")).toEqual(["今日は雨です。", "明日は晴れ。"]);
  });

  it("cuts a very long sentence at a break near its middle", () => {
    const half = "word ".repeat(40).trim();
    const text = `${half}; ${half}.`;
    const parts = split(text);
    expect(text.length).toBeGreaterThan(LONG_SENTENCE);
    expect(parts).toEqual([`${half};`, `${half}.`]);
    // A long sentence with nowhere good to cut is still cut.
    const solid = "x".repeat(LONG_SENTENCE * 2 + 10);
    expect(cutLong(solid, { start: 0, end: solid.length }).length).toBeGreaterThan(1);
  });
});
