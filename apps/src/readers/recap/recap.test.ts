import { describe, expect, it } from "vitest";
import { awayWords, daysAway, lastLines, worthRecap } from "./recap";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe("how long a book has been left", () => {
  it("is counted in whole days", () => {
    expect(daysAway(ago(0.4), NOW)).toBe(0);
    expect(daysAway(ago(3.9), NOW)).toBe(3);
    expect(daysAway(ago(40), NOW)).toBe(40);
  });

  it("is unknown for a book never opened, or a date that cannot be read", () => {
    expect(daysAway(null, NOW)).toBeNull();
    expect(daysAway("not a date", NOW)).toBeNull();
    // A clock put back: not "minus two days".
    expect(daysAway(ago(-2), NOW)).toBeNull();
  });

  it("is said as someone would say it", () => {
    expect([1, 3, 13, 14, 30, 59, 60, 200, 400, 800].map(awayWords)).toEqual([
      "a day",
      "3 days",
      "13 days",
      "2 weeks",
      "4 weeks",
      "8 weeks",
      "2 months",
      "7 months",
      "over a year",
      "2 years"
    ]);
  });
});

describe("a book to be reminded of", () => {
  it("is one left three days or more, part read", () => {
    expect(worthRecap(ago(3), 0.4, NOW)).toBe(true);
    expect(worthRecap(ago(90), 0.02, NOW)).toBe(true);
  });

  it("is not one read yesterday, never opened, hardly begun or finished", () => {
    expect(worthRecap(ago(1), 0.4, NOW)).toBe(false);
    expect(worthRecap(null, 0.4, NOW)).toBe(false);
    expect(worthRecap(ago(30), 0.001, NOW)).toBe(false);
    expect(worthRecap(ago(30), 1, NOW)).toBe(false);
  });
});

describe("the last lines read", () => {
  it("are the end of what was read, from the start of a sentence", () => {
    const text = `${"An earlier sentence that will not fit in the card at all. ".repeat(10)}She waited by the gate. Nobody came. Then the lamps went out.`;
    expect(lastLines(text, 70)).toEqual(["She waited by the gate. Nobody came. Then the lamps went out."]);
  });

  it("keep a paragraph's end as a break, so speech reads as speech", () => {
    const text = `${"Filler words here. ".repeat(20)}\n“Are you coming?” she asked.\n“No,” he said. “Not tonight.”`;
    expect(lastLines(text, 80)).toEqual(["Filler words here.", "“Are you coming?” she asked.", "“No,” he said. “Not tonight.”"]);
  });

  it("start at a paragraph when that comes before any sentence does", () => {
    const text = `${"filler ".repeat(40)}no stop here\nShe waited by the gate. Nobody came.`;
    expect(lastLines(text, 50)).toEqual(["She waited by the gate. Nobody came."]);
  });

  it("are all of it when little has been read", () => {
    expect(lastLines("Chapter One\nIt began with rain.")).toEqual(["Chapter One", "It began with rain."]);
  });

  it("start at a whole word, and say so, when no sentence begins in reach", () => {
    const lines = lastLines(`${"word ".repeat(200)}end`, 50);
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith("…word")).toBe(true);
    expect(lines[0].endsWith("end")).toBe(true);
    expect(lines[0].length).toBeLessThanOrEqual(52);
  });

  it("are none before the first word", () => {
    expect(lastLines("")).toEqual([]);
    expect(lastLines("  \n ")).toEqual([]);
  });

  it("are tidied of the book's own line breaks inside a paragraph's spaces", () => {
    expect(lastLines("One  two\tthree.   Four.")).toEqual(["One two three. Four."]);
  });
});
