import { describe, expect, it } from "vitest";
import { romanValue, speechText, wordEnd, type SpeechContext } from "./speechText";

const say = (text: string, context?: SpeechContext) => speechText(text, context).text;

/** Every character said maps back to a character of the source it could have come from. */
const mapsBack = (source: string, context?: SpeechContext) => {
  const { text, map } = speechText(source, context);
  expect(map.length).toBe(text.length + 1);
  for (let index = 1; index < map.length; index += 1) expect(map[index]).toBeGreaterThanOrEqual(map[index - 1]);
  expect(map[0]).toBeGreaterThanOrEqual(0);
  expect(map[map.length - 1]).toBeLessThanOrEqual(source.length);
  return { text, map };
};

describe("speechText", () => {
  it("leaves plain prose as it is, mapped one to one", () => {
    const source = "It was cold, and the wind blew.";
    const { text, map } = mapsBack(source);
    expect(text).toBe(source);
    expect(map).toEqual(Array.from({ length: source.length + 1 }, (_, index) => index));
  });

  it("joins a drop cap to its word, and maps the word back over both", () => {
    const source = "T he morning was grey.";
    const { text, map } = mapsBack(source, { glue: [1] });
    expect(text).toBe("The morning was grey.");
    // "morning" is where it is on the page.
    const at = text.indexOf("morning");
    expect(source.slice(map[at], map[at + "morning".length])).toBe("morning");
    // Without a drop cap there, a lone letter is a word ("A man walked").
    expect(say("A man walked.")).toBe("A man walked.");
  });

  it("leaves out note markers left in the text", () => {
    expect(say("He said so.[12] Then he left [3] at once.")).toBe("He said so. Then he left at once.");
    expect(say("The word¹ and the other†.")).toBe("The word and the other.");
    // Squared stays (a unit, not a marker); a bracketed word stays.
    expect(say("It was 3 m² [sic] wide.")).toBe("It was 3 m² [sic] wide.");
  });

  it("leaves out scene-break glyphs inside the text", () => {
    expect(say("He slept. * * * Morning came.")).toBe("He slept. Morning came.");
    expect(say("End. ⁂ Begin.")).toBe("End. Begin.");
  });

  it("says a web address as its site", () => {
    expect(say("See https://www.gutenberg.org/ebooks/1342 for more.")).toBe("See gutenberg.org for more.");
    expect(say("Visit www.example.com.")).toBe("Visit example.com.");
    const source = "Go to https://a.example.org/x?y=1 now.";
    const { text, map } = mapsBack(source);
    // The site's light covers the address on the page.
    const at = text.indexOf("a.example.org");
    expect(map[at]).toBe(source.indexOf("https"));
    expect(map[text.indexOf(" now")]).toBe(source.indexOf(" now"));
  });

  it("says dashes as the pause they stand for, and a range of numbers with 'to'", () => {
    expect(say("It was everywhere—in the streets.")).toBe("It was everywhere, in the streets.");
    expect(say("It was — I think — gone.")).toBe("It was, I think, gone.");
    expect(say("“I was going to—” She stopped.")).toBe('"I was going to" She stopped.');
    expect(say("The war of 1914–1918 ended.")).toBe("The war of 1914 to 1918 ended.");
    expect(say("The Franco–Prussian war.")).toBe("The Franco-Prussian war.");
    expect(say("Wait -- what?")).toBe("Wait, what?");
  });

  it("makes quotes, apostrophes, ellipses and spaces plain, and drops what is for the line", () => {
    expect(say("“Don’t,” she said. . . quietly.")).toBe('"Don\'t," she said… quietly.');
    expect(say("extra­ordinary​ things here")).toBe("extraordinary things here");
    expect(say("  two   spaces\n\there  ")).toBe("two spaces here");
  });

  it("puts a paragraph's opening in capitals in ordinary case", () => {
    expect(say("IT WAS THE best of times.", { blockStart: true })).toBe("It was the best of times.");
    expect(say("“WHEN I CAME home, it rained.", { blockStart: true })).toBe('"When I came home, it rained.');
    expect(say("WHEN she came, it rained.", { blockStart: true })).toBe("When she came, it rained.");
    // A short word alone may be a name; a line all in capitals is left; so is the middle of a paragraph.
    expect(say("FBI agents came.", { blockStart: true })).toBe("FBI agents came.");
    expect(say("NO ENTRY.", { blockStart: true })).toBe("NO ENTRY.");
    expect(say("IT WAS THE best of times.")).toBe("IT WAS THE best of times.");
    // Drop cap and small caps together.
    expect(say("T HE MORNING was grey.", { blockStart: true, glue: [1] })).toBe("The morning was grey.");
  });

  it("says Roman numerals as numbers in headings and after Chapter, Part or Book, never a lone I", () => {
    expect(say("CHAPTER XIV", { heading: true })).toBe("Chapter 14");
    // Each word lit where it is: "Chapter" is the word "Chapter", the number its numeral.
    for (const source of ["Chapter VIII", "CHAPTER XXXVIII", "Book III"]) {
      const { text, map } = speechText(source, { heading: true });
      const word = text.slice(0, text.indexOf(" "));
      expect(source.slice(map[0], map[word.length]).toLowerCase()).toBe(word.toLowerCase());
      const number = text.indexOf(" ") + 1;
      expect(source.slice(map[number], map[text.length])).toBe(source.slice(source.indexOf(" ") + 1));
    }
    expect(say("Chapter iv", { heading: true })).toBe("Chapter 4");
    expect(say("XII", { heading: true })).toBe("12");
    expect(say("IV. The Return", { heading: true })).toBe("4. The Return");
    expect(say("I", { heading: true })).toBe("1");
    expect(say("I Am Legend", { heading: true })).toBe("I Am Legend");
    expect(say("THE BOY WHO LIVED", { heading: true })).toBe("The Boy Who Lived");
    expect(say("MIX", { heading: true })).toBe("Mix");
    expect(say("As we saw in Chapter IV, and in Part II.")).toBe("As we saw in Chapter 4, and in Part 2.");
    expect(say("I read the book I wrote.")).toBe("I read the book I wrote.");
    expect(say("Henry VIII was king.")).toBe("Henry VIII was king.");
  });

  it("knows Roman numerals", () => {
    expect(romanValue("XIV")).toBe(14);
    expect(romanValue("mcmxcix")).toBe(1999);
    expect(romanValue("IIII")).toBeNull();
    expect(romanValue("")).toBeNull();
  });

  it("keeps the map exact through every change", () => {
    const sources = [
      "T HE MORNING—cold—was grey.[1] See www.example.com/a?b=c. . . “Fine,” he said¹.",
      "CHAPTER XIV: THE END",
      "Pages 10–12 of 1914–1918 -- extra­ordinary ⁂ end"
    ];
    for (const source of sources) mapsBack(source, { blockStart: true, heading: source.startsWith("CHAPTER"), glue: [1] });
  });
});

describe("wordEnd", () => {
  it("ends a word before the punctuation after it", () => {
    expect(wordEnd("It was cold. Then", 7)).toBe(11);
    expect(wordEnd('"Don\'t," she', 1)).toBe(6);
    expect(wordEnd("word", 0)).toBe(4);
  });
});
