import { describe, expect, it } from "vitest";
import { SENTENCE_END_PATTERN } from "./pacing";

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
