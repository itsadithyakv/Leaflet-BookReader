import { describe, expect, it } from "vitest";
import { SENTENCE_END_PATTERN, handsFreeCounts, stillTooLong } from "./pacing";

const ends = (text: string, trailing: string) => SENTENCE_END_PATTERN.test(`${text}${trailing}`);

describe("where a sentence ends", () => {
  it("is a full stop, a question or an exclamation mark, with any closing quotes", () => {
    expect(ends("done", ". ")).toBe(true);
    expect(ends("done", "?")).toBe(true);
    expect(ends("go", "!” ")).toBe(true);
    expect(ends("go", ".) ")).toBe(true);
  });

  it("is still an end when speech opens straight after it", () => {
    // `said. “I will`: the opening quote is carried by the word before.
    expect(ends("said", ". “")).toBe(true);
    expect(ends("smiled", ". ‘")).toBe(true);
    expect(ends("end", ".” “")).toBe(true);
    expect(ends("note", ". (")).toBe(true);
  });

  it("is an end when closed by a single quote", () => {
    expect(ends("go", ".’ ")).toBe(true);
  });

  it("is not a comma, a dash, or a quote opening mid-sentence", () => {
    expect(ends("said", ", “")).toBe(false);
    expect(ends("then", " “")).toBe(false);
    expect(ends("said", "— ")).toBe(false);
    expect(ends("word", " ")).toBe(false);
  });
});

describe("a reader gone still", () => {
  const minutes = (count: number) => count * 60_000;

  it("is read on to unless they asked for the pause", () => {
    expect(stillTooLong(minutes(4), true)).toBe(false);
    expect(stillTooLong(minutes(5), true)).toBe(true);
    for (const quiet of [minutes(5), minutes(90), minutes(600)]) {
      expect(stillTooLong(quiet, false)).toBe(false);
    }
  });

  it("is credited for as long as the page would have paused, or an hour without the pause", () => {
    expect([handsFreeCounts(minutes(4), true), handsFreeCounts(minutes(5), true)]).toEqual([true, false]);
    expect([handsFreeCounts(minutes(59), false), handsFreeCounts(minutes(60), false)]).toEqual([true, false]);
  });
});
