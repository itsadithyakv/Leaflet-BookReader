import { describe, expect, it } from "vitest";
import type { Entry } from "../../../../readers/people/model";
import { REST_DAYS, answered, askOrder, dueCount, isDue } from "./boxes";
import { BUILTIN_WORDS } from "./builtinWords";
import { MIN_PEOPLE, buildWhoRound, knownPeople, type Sheet } from "./whoQuiz";
import { MIN_WORDS, OPTIONS, ROUND, buildRound, seededRandom, type QuizWord } from "./round";

const TODAY = 20_365;

const word = (name: string, meaning: string, box = 0, due: number | null = null): QuizWord => ({ id: `word:en:${name}`, word: name, meaning, box, due });

const SOME = [
  word("brume", "Mist or fog."),
  word("mizzle", "Fine rain."),
  word("gloaming", "Twilight, dusk."),
  word("skaa", "The working people of the Final Empire."),
  word("atium", "A metal that shows a moment of the future.")
];

describe("the boxes", () => {
  it("move a word up when it is known and back to the first when it is not", () => {
    const fresh = { id: "w", box: 0, due: null };
    expect(answered(fresh, true, TODAY)).toEqual({ id: "w", box: 1, due: TODAY + 1 });
    expect(answered({ id: "w", box: 1, due: TODAY }, true, TODAY)).toEqual({ id: "w", box: 2, due: TODAY + 3 });
    expect(answered({ id: "w", box: 4, due: TODAY }, true, TODAY)).toEqual({ id: "w", box: 5, due: TODAY + 30 });
    // The last box is the last box.
    expect(answered({ id: "w", box: 5, due: TODAY }, true, TODAY)).toEqual({ id: "w", box: 5, due: TODAY + 30 });
    // Wrong: the first box, and asked again at once.
    expect(answered({ id: "w", box: 4, due: TODAY }, false, TODAY)).toEqual({ id: "w", box: 0, due: TODAY });
    expect(answered({ id: "w", box: -3, due: null }, true, TODAY).box).toBe(1);
    expect(REST_DAYS).toHaveLength(6);
    for (let box = 1; box < REST_DAYS.length; box += 1) {
      expect(REST_DAYS[box]).toBeGreaterThan(REST_DAYS[box - 1]);
    }
  });

  it("ask the due words first, the least known of them before the rest", () => {
    const words = [
      { id: "later", box: 3, due: TODAY + 5 },
      { id: "sooner", box: 4, due: TODAY + 1 },
      { id: "overdue", box: 2, due: TODAY - 4 },
      { id: "today", box: 2, due: TODAY },
      { id: "missed", box: 0, due: TODAY - 1 },
      { id: "new", box: 0, due: null }
    ];
    expect(askOrder(words, TODAY).map((entry) => entry.id)).toEqual(["new", "missed", "overdue", "today", "sooner", "later"]);
    expect(dueCount(words, TODAY)).toBe(4);
    expect(isDue(words[0], TODAY)).toBe(false);
    expect(isDue(words[0], TODAY + 5)).toBe(true);
    // Ties are broken by the shuffle it is given, and it does not reorder what is not tied.
    const level = [
      { id: "a", box: 0, due: null },
      { id: "b", box: 0, due: null }
    ];
    expect(askOrder(level, TODAY, (id) => (id === "b" ? 0 : 1)).map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(askOrder(level, TODAY).map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

describe("a round of the word quiz", () => {
  it("is not made from fewer than four words", () => {
    expect(MIN_WORDS).toBe(4);
    expect(buildRound([], TODAY, 1)).toEqual([]);
    expect(buildRound(SOME.slice(0, 3), TODAY, 1)).toEqual([]);
    expect(buildRound(SOME.slice(0, 4), TODAY, 1)).toHaveLength(4);
  });

  it("asks only the reader's own words, each once, with four answers of which one is right", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const round = buildRound(SOME, TODAY, seed);
      expect(round).toHaveLength(SOME.length);
      expect(new Set(round.map((question) => question.id)).size).toBe(round.length);
      expect(round[0].way).toBe("meaning");
      for (const question of round) {
        const target = SOME.find((entry) => entry.id === question.id) as QuizWord;
        expect(target, "a question about a word that is not the reader's").toBeDefined();
        expect(question.options).toHaveLength(OPTIONS);
        expect(new Set(question.options.map((option) => option.toLowerCase())).size).toBe(OPTIONS);
        if (question.way === "meaning") {
          expect(question.prompt).toBe(target.word);
          expect(question.options[question.answer]).toBe(target.meaning);
        } else {
          expect(question.way).toBe("word");
          expect(question.prompt).toBe(target.meaning);
          expect(question.options[question.answer]).toBe(target.word);
        }
      }
    }
  });

  it("is the same round for the same seed, and another for another", () => {
    expect(buildRound(SOME, TODAY, 7)).toEqual(buildRound(SOME, TODAY, 7));
    const rounds = new Set(Array.from({ length: 12 }, (_, seed) => JSON.stringify(buildRound(SOME, TODAY, seed + 1))));
    expect(rounds.size).toBeGreaterThan(6);
    const random = seededRandom(3);
    const drawn = Array.from({ length: 200 }, random);
    expect(Math.min(...drawn)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...drawn)).toBeLessThan(1);
  });

  it("is ten at most, the due words before the ones that are resting", () => {
    const many = Array.from({ length: 30 }, (_, index) => word(`w${index}`, `meaning number ${index}`, index < 12 ? 0 : 3, index < 12 ? null : TODAY + 9));
    for (let seed = 1; seed <= 20; seed += 1) {
      const round = buildRound(many, TODAY, seed);
      expect(round).toHaveLength(ROUND);
      for (const question of round) {
        expect(Number(question.id.replace("word:en:w", ""))).toBeLessThan(12);
      }
    }
    // With plenty of words of the reader's own, the game's are not needed.
    const builtin = new Set(BUILTIN_WORDS.flatMap((entry) => [entry.word, entry.meaning]));
    expect(buildRound(many, TODAY, 5).flatMap((question) => question.options).some((option) => builtin.has(option))).toBe(false);
  });

  it("tops up the wrong answers from its own list when the reader's words would not make three", () => {
    // Four words, three of which were given one and the same meaning.
    const alike = [word("one", "A sample definition."), word("two", "A sample definition."), word("three", "a sample definition."), word("four", "Something else.")];
    const builtin = new Set(BUILTIN_WORDS.flatMap((entry) => [entry.word, entry.meaning]));
    for (let seed = 1; seed <= 30; seed += 1) {
      const round = buildRound(alike, TODAY, seed);
      expect(round).toHaveLength(4);
      for (const question of round) {
        const target = alike.find((entry) => entry.id === question.id) as QuizWord;
        expect(new Set(question.options.map((option) => option.toLowerCase())).size).toBe(OPTIONS);
        // No wrong answer that is also right: no word with the same meaning, no meaning that is the same.
        const alsoRight = alike.filter((entry) => entry.id !== target.id && entry.meaning.toLowerCase() === target.meaning.toLowerCase());
        for (const twin of alsoRight) {
          expect(question.options).not.toContain(twin.word);
        }
        expect(question.options.filter((option) => option.toLowerCase() === target.meaning.toLowerCase()).length).toBeLessThanOrEqual(1);
        expect(question.options.some((option) => builtin.has(option))).toBe(true);
      }
    }
    // One of the game's own words that the reader also has is not offered against itself.
    const mine = [word("lantern", "A light you carry."), ...SOME.slice(0, 3)];
    for (let seed = 1; seed <= 30; seed += 1) {
      for (const question of buildRound(mine, TODAY, seed)) {
        expect(question.options.filter((option) => option === "lantern").length).toBeLessThanOrEqual(1);
        expect(question.options).not.toContain(BUILTIN_WORDS[0].meaning);
      }
    }
  });

  it("has a list of its own with nothing said twice", () => {
    expect(BUILTIN_WORDS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(BUILTIN_WORDS.map((entry) => entry.word)).size).toBe(BUILTIN_WORDS.length);
    expect(new Set(BUILTIN_WORDS.map((entry) => entry.meaning)).size).toBe(BUILTIN_WORDS.length);
  });
});

describe("who is this?", () => {
  const stamp = (p: number) => ({ p, cfi: null, chapter: null });
  const base = (id: string, bookId: string, p: number) => ({ id, bookId, at: stamp(p), createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" });
  const person = (id: string, name: string, p: number, bookId = "b1"): Entry => ({ ...base(id, bookId, p), kind: "person", name });
  const note = (id: string, who: string, text: string, p: number, bookId = "b1"): Entry => ({ ...base(id, bookId, p), kind: "note", person: who, text });

  const MISTBORN: Entry[] = [
    person("vin", "Vin", 0.02),
    note("n1", "vin", "A street thief in Camon's crew.", 0.02),
    note("n2", "vin", "SPOILER: what she turns out to be.", 0.8),
    person("kel", "Kelsier", 0.05),
    note("n3", "kel", "The Survivor of Hathsin. Smiles too much.", 0.05),
    person("sazed", "Sazed", 0.2),
    note("n4", "sazed", "A Terris steward who keeps every religion.", 0.2),
    person("elend", "Elend", 0.3),
    note("n5", "elend", "Reads at balls. Heir to House Venture.", 0.3),
    person("late", "SPOILER PERSON", 0.9),
    note("n6", "late", "SPOILER: someone met near the end.", 0.9),
    // Met early, but nothing written about him yet where the reader is.
    person("ham", "Ham", 0.1),
    note("n7", "ham", "SPOILER: what Ham does later.", 0.7),
    { ...base("a1", "b1", 0.6), kind: "alias", person: "kel", text: "SPOILER NAME", main: true }
  ];
  const sheet = (progress: number, entries = MISTBORN): Sheet => ({ bookId: "b1", title: "Mistborn", progress, entries });

  it("knows only the people met and the notes written by the place the book has been read to", () => {
    expect(knownPeople([sheet(0)])).toEqual([]);
    expect(knownPeople([sheet(0.05)]).map((entry) => entry.name)).toEqual(["Kelsier", "Vin"]);
    const half = knownPeople([sheet(0.5)]);
    expect(half.map((entry) => entry.name).sort()).toEqual(["Elend", "Kelsier", "Sazed", "Vin"]);
    expect(half.find((entry) => entry.id === "vin")?.notes).toEqual(["A street thief in Camon's crew."]);
    expect(JSON.stringify(half)).not.toContain("SPOILER");
    // At the end everything is known, and he is called what he came to be called.
    const end = knownPeople([sheet(1)]);
    expect(end).toHaveLength(6);
    expect(end.find((entry) => entry.id === "kel")?.name).toBe("SPOILER NAME");
  });

  it("never asks about, or offers, anything from further on than the reader is", () => {
    for (const progress of [0.3, 0.5, 0.69, 0.79, 0.89]) {
      const people = knownPeople([sheet(progress)]);
      for (let seed = 1; seed <= 40; seed += 1) {
        const round = buildWhoRound(people, seed);
        expect(round.length).toBeGreaterThan(0);
        for (const question of round) {
          const told = [question.prompt, question.context, ...question.options].join(" | ");
          const ahead = MISTBORN.filter((entry) => entry.at.p > progress);
          for (const entry of ahead) {
            const text = entry.kind === "person" ? entry.name : entry.kind === "note" || entry.kind === "alias" ? entry.text : "";
            expect(told, `seed ${seed} at ${progress}`).not.toContain(text);
          }
        }
      }
    }
  });

  it("is not offered with fewer than four people with a note", () => {
    expect(MIN_PEOPLE).toBe(4);
    expect(buildWhoRound(knownPeople([sheet(0.25)]), 1)).toEqual([]);
    expect(buildWhoRound([], 1)).toEqual([]);
    expect(buildWhoRound(knownPeople([sheet(0.3)]), 1)).toHaveLength(4);
  });

  it("names someone and offers four notes, one of them theirs and none of the others theirs too", () => {
    const dune: Sheet = {
      bookId: "b2",
      title: "Dune",
      progress: 1,
      entries: [person("paul", "Paul", 0.01, "b2"), note("d1", "paul", "The duke's son.", 0.01, "b2"), note("d2", "paul", "Dreams of the desert.", 0.2, "b2")]
    };
    const people = knownPeople([sheet(0.5), dune]);
    expect(people).toHaveLength(5);
    for (let seed = 1; seed <= 60; seed += 1) {
      const round = buildWhoRound(people, seed);
      expect(round).toHaveLength(5);
      expect(new Set(round.map((question) => `${question.context}/${question.id}`)).size).toBe(5);
      for (const question of round) {
        const who = people.find((entry) => entry.id === question.id) as (typeof people)[number];
        expect(question.way).toBe("who");
        expect(question.prompt).toBe(who.name);
        expect(question.context).toBe(who.book);
        expect(question.options).toHaveLength(OPTIONS);
        expect(new Set(question.options).size).toBe(OPTIONS);
        expect(who.notes).toContain(question.options[question.answer]);
        expect(question.options.filter((option) => who.notes.includes(option))).toHaveLength(1);
      }
    }
    expect(buildWhoRound(people, 9)).toEqual(buildWhoRound(people, 9));
  });

  it("keeps a long note to a line", () => {
    const long = "word ".repeat(100);
    const people = knownPeople([sheet(1, [person("p", "Someone", 0), note("n", "p", long, 0)])]);
    expect(people[0].notes[0].length).toBeLessThanOrEqual(140);
    expect(people[0].notes[0].endsWith("…")).toBe(true);
  });
});
