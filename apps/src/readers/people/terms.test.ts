import { describe, expect, it } from "vitest";
import { nameMatcher } from "./names";
import { DESCRIBES, describes, pickTerm, sentenceOf, statOf, termSummary, termsAt } from "./terms";

const COMMON = new Set("the a an of and when but he she it they you i was is said in at to from his her yes no then".split(" "));
const isCommon = (key: string) => COMMON.has(key);

/** The names the pointer may be on, with the pointer on the first letter of `word`. */
const at = (text: string, word: string, nth = 0) => {
  let from = -1;
  for (let i = 0; i <= nth; i += 1) {
    from = text.indexOf(word, from + 1);
  }
  return termsAt(text, from, isCommon).map((term) => term.text);
};

describe("a word of the book's own, written small", () => {
  const WIKI = new Map([["shelldry", "Shelldry"], ["obligator", "Obligator"], ["then", "Then"]]);
  const ownPage = (key: string) => WIKI.get(key) ?? (key.endsWith("s") ? WIKI.get(key.slice(0, -1)) ?? null : null);
  const text = "“Would you join us for a game of shelldry tomorrow?” Then the obligators left.";
  const on = (word: string) => termsAt(text, text.indexOf(word) + 1, isCommon, ownPage);

  it("is one when the book's wiki has a page for it", () => {
    const from = text.indexOf("shelldry");
    expect(on("shelldry")).toEqual([{ text: "shelldry", start: from, end: from + 8, small: true, page: "Shelldry" }]);
    // As the book writes it, and the page the wiki keeps it under.
    expect(on("obligators").map((term) => [term.text, term.page])).toEqual([["obligators", "Obligator"]]);
  });

  it("is not one without a wiki to say so, on a word the wiki has no page for, or on an everyday word it has", () => {
    expect(termsAt(text, text.indexOf("shelldry") + 1, isCommon)).toEqual([]);
    expect(on("tomorrow")).toEqual([]);
    expect(on("game")).toEqual([]);
    expect(termsAt("He left, and then came back.", 14, isCommon, ownPage)).toEqual([]);
  });

  it("leaves a name a name", () => {
    expect(termsAt("Ash fell. Then Vin watched the flakes.", 16, isCommon, ownPage).map((term) => [term.text, term.small])).toEqual([["Vin", undefined]]);
  });
});

describe("the name under the pointer", () => {
  it("is the word, when the word is a name", () => {
    expect(at("Ash fell. Then Vin watched the flakes.", "Vin")).toEqual(["Vin"]);
  });

  it("is nothing on an ordinary word", () => {
    expect(at("Ash fell. Then Vin watched the flakes.", "watched")).toEqual([]);
    expect(at("Ash fell. Then Vin watched the flakes.", "flakes")).toEqual([]);
  });

  it("is nothing on an everyday word that only starts a sentence", () => {
    expect(at("Ash fell. Then Vin watched the flakes.", "Then")).toEqual([]);
    expect(at("“Yes,” she said.", "Yes")).toEqual([]);
    expect(at("The crew gathered.", "The")).toEqual([]);
  });

  it("offers a word that starts a sentence when it is no everyday word (the counts settle it)", () => {
    expect(at("Ash fell. Kelsier smiled.", "Kelsier")).toEqual(["Kelsier"]);
    expect(at("Ash fell. Suddenly it stopped.", "Suddenly")).toEqual(["Suddenly"]);
  });

  it("takes the run of capitalised words around it, then the word alone", () => {
    expect(at("They feared the Lord Ruler above all.", "Ruler")).toEqual(["Lord Ruler", "Ruler"]);
    expect(at("They met Harry Potter at the gate.", "Harry")).toEqual(["Harry Potter", "Harry"]);
  });

  it("offers a name without the title before it, and never a title alone", () => {
    expect(at("They bowed to Lord Renoux again.", "Renoux")).toEqual(["Lord Renoux", "Renoux"]);
    const text = "They bowed to Lord Renoux again.";
    expect(termsAt(text, text.indexOf("Renoux"), isCommon).map((term) => Boolean(term.titled))).toEqual([true, false]);
    expect(at("They bowed to Lord Renoux again.", "Lord")).toEqual(["Lord Renoux"]);
    expect(at("“Yes, my Lord,” he said.", "Lord")).toEqual([]);
  });

  it("reads through the small words inside a name, from any word of it", () => {
    const text = "He joined the Order of the Phoenix that summer.";
    expect(at(text, "Order")).toEqual(["Order of the Phoenix", "Order"]);
    expect(at(text, "Phoenix")).toEqual(["Order of the Phoenix", "Phoenix"]);
    expect(at(text, "of")).toEqual(["Order of the Phoenix"]);
    expect(at("She worked at the Ministry of Magic.", "Ministry")).toEqual(["Ministry of Magic", "Ministry"]);
  });

  it("does not take a small word that only follows or leads a name", () => {
    expect(at("Vin of course said nothing.", "of")).toEqual([]);
    expect(at("He spoke of Vin.", "of")).toEqual([]);
    expect(at("in the Final Empire", "the")).toEqual([]);
    expect(at("in the Final Empire", "Final")).toEqual(["Final Empire", "Final"]);
  });

  it("stops at punctuation, and at a possessive", () => {
    expect(at("Vin, Kelsier and Sazed waited.", "Kelsier")).toEqual(["Kelsier"]);
    expect(at("It was Kelsier’s plan, all of it.", "Kelsier")).toEqual(["Kelsier"]);
    expect(at("It was Vin's turn.", "Vin")).toEqual(["Vin"]);
  });

  it("offers a name with a possessive inside it, ahead of its parts", () => {
    expect(at("He took the black and joined the Night’s Watch at the Wall.", "Watch")).toEqual(["Night’s Watch", "Watch"]);
    expect(at("He took the black and joined the Night’s Watch at the Wall.", "Night")).toEqual(["Night’s Watch", "Night"]);
    expect(at("They rode for King's Landing at dawn.", "Landing")).toEqual(["King's Landing", "Landing"]);
    expect(at("It was Kelsier’s Survivor legend.", "Survivor")).toEqual(["Kelsier’s Survivor", "Survivor"]);
  });

  it("does not join a sentence's first everyday word to the name after it", () => {
    expect(at("When Vin woke, it was dark.", "Vin")).toEqual(["Vin"]);
    expect(at("The Lord Ruler had won.", "Ruler")).toEqual(["Lord Ruler", "Ruler"]);
  });

  it("reads a chapter's opening capitals as the name is written elsewhere", () => {
    expect(at("VIN SHOT INTO the air.", "VIN")).toEqual(["Vin"]);
    expect(at("VIN SHOT INTO the air.", "THE")).toEqual([]);
  });

  it("takes the pointer at the end of a word as on it", () => {
    const text = "Then Vin watched.";
    expect(termsAt(text, text.indexOf("Vin") + 3, isCommon).map((term) => term.text)).toEqual(["Vin"]);
  });

  it("says where each is in the text", () => {
    const text = "They bowed to Lord Renoux’s men.";
    const [whole, name] = termsAt(text, text.indexOf("Renoux"), isCommon);
    expect(text.slice(whole.start, whole.end)).toBe("Lord Renoux");
    expect(text.slice(name.start, name.end)).toBe("Renoux");
  });

  it("does not look past the line it is on", () => {
    expect(at("The Final\nEmpire stood.", "Empire")).toEqual(["Empire"]);
  });
});

describe("the sentence a name is in", () => {
  const text = "Ash fell from the sky. Vin, a street thief of sixteen, watched it. Nobody spoke.";

  it("is the whole sentence, with the name marked off", () => {
    const start = text.indexOf("Vin");
    expect(sentenceOf(text, 0, start, start + 3)).toMatchObject({
      before: "",
      match: "Vin",
      after: ", a street thief of sixteen, watched it."
    });
  });

  it("does not end at the full stop of a title", () => {
    const line = "He nodded. Then Mr. Potter and Dr. Granger left the room. Silence.";
    const start = line.indexOf("Granger");
    const sentence = sentenceOf(line, 0, start, start + 7);
    expect(`${sentence.before}${sentence.match}${sentence.after}`).toBe("Then Mr. Potter and Dr. Granger left the room.");
  });

  it("keeps closing quotes with the sentence, and stops at a paragraph", () => {
    const line = "“Run!” “Where is Vin?” he asked.\nNobody knew.";
    const start = line.indexOf("Vin");
    const sentence = sentenceOf(line, 0, start, start + 3);
    expect(`${sentence.before}${sentence.match}${sentence.after}`).toBe("“Where is Vin?”");
  });

  it("cuts a very long sentence at whole words, and says so", () => {
    const line = `${"word ".repeat(80)}Vin${" word".repeat(80)}`;
    const start = line.indexOf("Vin");
    const sentence = sentenceOf(line, 0, start, start + 3);
    expect(sentence.before.startsWith("…word")).toBe(true);
    expect(sentence.after.endsWith("word…")).toBe(true);
    expect(sentence.before.length).toBeLessThanOrEqual(241);
  });
});

describe("a sentence that says what a name is", () => {
  it("is one that introduces it", () => {
    expect(describes("", " was a thief, and a good one, though she would never have said so.")).toBeGreaterThanOrEqual(DESCRIBES);
    expect(describes("", ", the leader of the crew, grinned at them from the doorway.")).toBeGreaterThanOrEqual(DESCRIBES);
    expect(describes("They were ruled by a man called ", ", who had lived a thousand years.")).toBeGreaterThanOrEqual(DESCRIBES);
    expect(describes("Her brother, ", ", had always said that anyone would betray her.")).toBeGreaterThanOrEqual(DESCRIBES);
    expect(describes("They rode for the city of ", ", which lay three days to the north.")).toBeGreaterThanOrEqual(DESCRIBES);
    expect(describes("The man, ", ", was shorter than the other, with a squarish face.")).toBeGreaterThanOrEqual(DESCRIBES);
    expect(describes("By day, ", " was a blackened city, scorched by soot and red sunlight.")).toBeGreaterThanOrEqual(DESCRIBES);
  });

  it("is not one where something else is what is spoken of", () => {
    // About the keep, the street, the servants: not about the name.
    expect(describes("Any family with a keep in ", " was considered to be a great house.")).toBeLessThan(DESCRIBES);
    expect(describes("The cobbled street felt muffled to ", ", the shifting mists making everything damp.")).toBeLessThan(DESCRIBES);
    expect(describes("When she asked after ", ", the servants sent her to the kitchens at once.")).toBeLessThan(DESCRIBES);
    expect(describes("She shot a glance at ", ", who was laughing at one of his own jokes.")).toBeLessThan(DESCRIBES);
    expect(describes("They were carried to a storeroom along the base of the ", ", a dark cold cell chiseled from the ice.")).toBeLessThan(DESCRIBES);
    expect(describes("“", " is my prisoner,” she told him as they went down the tower stairs.")).toBeLessThan(DESCRIBES);
    expect(describes("", ", yes, his name is Yoren.")).toBeLessThan(DESCRIBES);
  });

  it("is not one that speaks to them, lists them, or asks", () => {
    expect(describes("In the future, ", ", perhaps you should try to be a little less charming.”")).toBeLessThan(DESCRIBES);
    expect(describes("“Even among the nobility, ", ", it is rare,” he said.")).toBeLessThan(DESCRIBES);
    expect(describes("The meeting had ended a short time earlier, ", ", Ham, and Yeden leaving to think.")).toBeLessThan(DESCRIBES);
    expect(describes("“Is one of them named ", "?”")).toBeLessThan(DESCRIBES);
    expect(describes("For a man of rank, your Lord ", " has remarkably poor taste.")).toBeLessThan(DESCRIBES);
  });

  it("is not one that only uses it", () => {
    expect(describes("", " nodded and walked on down the quiet street.")).toBeLessThan(DESCRIBES);
    expect(describes("“Come here, ", ".”")).toBeLessThan(DESCRIBES);
    expect(describes("He took ", "’s arm and led her out of the room at once.")).toBeLessThan(DESCRIBES);
  });
});

describe("what the book says of a name so far", () => {
  const find = nameMatcher([
    { text: "Vin", person: "?", exact: true },
    { text: "Luthadel", person: "place", exact: true }
  ]);
  const ONE = "Ash fell on Luthadel. In Luthadel nobody looked up. Then Vin watched the flakes drift. “Quiet, Vin.”";
  const TWO = "The crew met at dusk. Vin was a thief, small for her age and quick. Kelsier said Vin nodded. Vin smiled.";

  it("counts it, names where it first came up, and prefers the line that introduces it", () => {
    const summary = termSummary([statOf(1, TWO, find, "?", "vin"), statOf(0, ONE, find, "?", "vin")]);
    expect(summary.count).toBe(5);
    expect(summary.sections).toBe(2);
    expect(summary.first).toMatchObject({ section: 0, before: "Then ", after: " watched the flakes drift." });
    expect(summary.about).toMatchObject({ section: 1, before: "", after: " was a thief, small for her age and quick." });
    expect(summary.described).toBe(true);
    expect(summary.named).toBe(true);
  });

  it("falls back on the first mention when the book has not said what it is", () => {
    const summary = termSummary([statOf(0, ONE, find, "?", "vin")]);
    expect(summary.described).toBe(false);
    expect(summary.about).toEqual(summary.first);
  });

  it("tells someone from somewhere by how they are written of", () => {
    expect(termSummary([statOf(0, ONE, find, "?", null), statOf(1, TWO, find, "?", null)]).kind).toBe("person");
    expect(termSummary([statOf(0, ONE, find, "place", null), statOf(1, "They rode from Luthadel. In Luthadel it rained.", find, "place", null)]).kind).toBe("place");
  });

  it("does not take a word the book also writes small for a name", () => {
    const text = "Suddenly it stopped. Suddenly she ran. He turned suddenly, and suddenly it was dark, quite suddenly.";
    const sudden = nameMatcher([{ text: "Suddenly", person: "?", exact: true }]);
    expect(termSummary([statOf(0, text, sudden, "?", "suddenly")]).named).toBe(false);
  });

  it("does not take a word that is only ever capitalised at the start of a sentence for a name", () => {
    const text = "Suddenly it stopped. Suddenly she ran.";
    const sudden = nameMatcher([{ text: "Suddenly", person: "?", exact: true }]);
    const summary = termSummary([statOf(0, text, sudden, "?", "suddenly")]);
    expect(summary.count).toBe(2);
    expect(summary.named).toBe(false);
  });

  it("takes a word the book also writes small for a name when it is given its capital often enough", () => {
    const text = `${"They climbed the Wall and looked down from the Wall. ".repeat(5)}${"A wall is a wall, and that wall was a wall like any wall. ".repeat(6)}`;
    const wall = nameMatcher([{ text: "Wall", person: "?", exact: true }]);
    const summary = termSummary([statOf(0, text, wall, "?", "wall")]);
    expect(summary.count).toBe(10);
    expect(summary.named).toBe(true);
  });

  it("is empty for a name the text does not hold", () => {
    const nobody = nameMatcher([{ text: "Sazed", person: "?", exact: true }]);
    expect(termSummary([statOf(0, ONE, nobody, "?", "sazed")])).toMatchObject({ count: 0, first: null, about: null, named: false });
  });
});

describe("which of the names under the pointer the book really uses", () => {
  it("is the longest the book has written three times", () => {
    // "Night's Watch" and "Watch": the short one is written alone more often, and is still not what is meant.
    expect(pickTerm([60, 130])).toBe(0);
    expect(pickTerm([40, 45])).toBe(0);
    expect(pickTerm([3, 5000])).toBe(0);
  });

  it("is the shorter when the longer is a chance meeting of words", () => {
    expect(pickTerm([2, 900])).toBe(1);
    expect(pickTerm([1, 50])).toBe(1);
  });

  it("is the name without its title, unless the book hardly writes one without the other", () => {
    // "Master Kelsier" and "Kelsier"; "Lord Ruler" and "Ruler".
    expect(pickTerm([5, 900], [true, false])).toBe(1);
    expect(pickTerm([300, 310], [true, false])).toBe(0);
    // "Lord Eddard Stark", "Eddard Stark", "Stark": the man, not his house.
    expect(pickTerm([20, 60, 700], [true, false, false])).toBe(1);
  });

  it("is none when none has been written twice", () => {
    expect(pickTerm([1, 1])).toBe(-1);
    expect(pickTerm([])).toBe(-1);
  });
});
