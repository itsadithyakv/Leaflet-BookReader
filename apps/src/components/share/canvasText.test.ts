import { describe, expect, it } from "vitest";
import { clipQuote, fitLine, fitText, wrapLines } from "./canvasText";

/** Ten units a letter: enough to tell a line that fits from one that does not. */
const measure = (text: string) => text.length * 10;
const measureAt = (size: number) => (text: string) => text.length * size * 0.5;

describe("words wrapped to a width", () => {
  it("fill each line as far as they fit", () => {
    expect(wrapLines("one two three four five", 100, measure)).toEqual(["one two", "three four", "five"]);
  });

  it("keep a paragraph's end, and drop spare spaces", () => {
    expect(wrapLines("one  two\n\nthree", 200, measure)).toEqual(["one two", "three"]);
  });

  it("break a word that is longer than any line", () => {
    expect(wrapLines("a supercalifragilistic b", 80, measure)).toEqual(["a", "supercal", "ifragili", "stic b"]);
  });

  it("are none for nothing", () => {
    expect(wrapLines("   ", 100, measure)).toEqual([]);
  });
});

describe("one line", () => {
  it("is cut with an ellipsis when it is too wide", () => {
    expect(fitLine("The Final Empire", 200, measure)).toBe("The Final Empire");
    expect(fitLine("The Final Empire of the Lord Ruler", 200, measure)).toBe("The Final Empire of…");
  });
});

describe("a passage for a picture", () => {
  it("is left alone when it is short, tidied of line breaks", () => {
    expect(clipQuote("One line\nand another.")).toBe("One line and another.");
  });

  it("is cut at a whole word past the limit", () => {
    const cut = clipQuote("word ".repeat(200), 50);
    expect(cut.length).toBeLessThanOrEqual(51);
    expect(cut.endsWith("word…")).toBe(true);
  });
});

describe("the size words are set at", () => {
  it("is the largest at which they fit the box", () => {
    const short = fitText("A short line.", { width: 400, height: 300 }, [60, 40, 20], 1.5, measureAt);
    expect(short.size).toBe(60);
    expect(short.lines).toEqual(["A short line."]);
    const long = fitText("word ".repeat(60).trim(), { width: 400, height: 300 }, [60, 40, 20], 1.5, measureAt);
    expect(long.size).toBe(20);
    expect(long.lines.length * 20 * 1.5).toBeLessThanOrEqual(300);
  });

  it("is the smallest, with what fits and an ellipsis, when nothing fits", () => {
    const fit = fitText("word ".repeat(400).trim(), { width: 400, height: 300 }, [60, 40, 20], 1.5, measureAt);
    expect(fit.size).toBe(20);
    expect(fit.lines).toHaveLength(10);
    expect(fit.lines[9].endsWith("…")).toBe(true);
  });
});
