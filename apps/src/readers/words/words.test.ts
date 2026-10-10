import { describe, expect, it } from "vitest";
import { diaryEntries } from "../../pip/diary/entry";
import { diaryFacts, type Clock } from "../../pip/diary/facts";
import { markOf } from "../../pip/diary/source";
import { pinnedNotes } from "../../pip/furnish";
import type { LookupResult } from "../../services/lookupService";
import { entriesOf, isPeopleRow } from "../people/rows";
import { keepable } from "./keep";
import { DOUBLE_CLICK_MS, isDoubleClickedWord } from "./wordPrefs";
import { MAX_MEANING, fromRow, isWordRow, languageKey, recorded, reviewed, wordId, wordsOf, type WordInput, type WordRow } from "./rows";

const NOW = "2026-10-04T10:00:00Z";
const LATER = "2026-10-05T10:00:00Z";

const lookedUp = (word: string, meaning: string, extra: Partial<WordInput> = {}): WordInput => ({
  word,
  language: "en-GB",
  meaning,
  part: "Noun",
  bookId: "b1",
  cfi: "epubcfi(/6/8!/4/2/1:0)",
  chapter: "Chapter 2",
  p: 0.25,
  ...extra
});

describe("a word's row", () => {
  it("is one row a word, by its language, however it is written", () => {
    expect(wordId("  Brume ", "en-GB")).toBe("word:en:brume");
    expect(wordId("BRUME")).toBe("word:en:brume");
    expect(wordId("brume", "fr")).toBe("word:fr:brume");
    expect(wordId("coup  d'état", "fr_FR")).toBe("word:fr:coup d'état");
    expect(languageKey("")).toBe("en");
    expect(languageKey(null)).toBe("en");
    expect(languageKey("pt-BR")).toBe("pt");
  });

  it("holds the word, its meaning, the book and the place, and reads back as it was written", () => {
    const row = recorded(null, lookedUp("  Brume ", " Mist;  fog. "), NOW);
    // The row `commands/words.rs` writes for the same look-up (its JSON holds the same fields, in its own order).
    expect(row).toEqual({
      id: "word:en:brume",
      bookId: "b1",
      kind: "word",
      cfi: "epubcfi(/6/8!/4/2/1:0)",
      text: JSON.stringify({ p: 0.25, m: "Mist; fog.", n: 1, at: NOW, l: "en", pos: "noun" }),
      note: "Brume",
      chapter: "Chapter 2",
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null
    });
    expect(fromRow(row)).toEqual({
      id: "word:en:brume",
      word: "Brume",
      meaning: "Mist; fog.",
      language: "en",
      part: "noun",
      bookId: "b1",
      at: { p: 0.25, cfi: "epubcfi(/6/8!/4/2/1:0)", chapter: "Chapter 2" },
      count: 1,
      lookedUpAt: NOW,
      createdAt: NOW,
      box: 0,
      due: null
    });
  });

  it("counts a second look-up on the same row, moves to the new place, and keeps its box", () => {
    const first = recorded(null, lookedUp("brume", "Mist; fog."), NOW);
    const quizzed = reviewed(first, { id: first.id, box: 2, due: 20_370 }, NOW);
    const second = recorded(quizzed, lookedUp("BRUME", "A mist.", { bookId: "b2", cfi: null, chapter: null, p: 0.9, part: null }), LATER);
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(NOW);
    expect(second.updatedAt).toBe(LATER);
    const word = fromRow(second);
    expect(word).toMatchObject({ count: 2, meaning: "A mist.", bookId: "b2", box: 2, due: 20_370, part: null, lookedUpAt: LATER });
    expect(word?.at).toEqual({ p: 0.9, cfi: null, chapter: null });
    // A word that was removed starts afresh.
    const back = recorded({ ...second, deletedAt: LATER }, lookedUp("brume", "Mist."), "2026-10-07T10:00:00Z");
    expect(fromRow(back)).toMatchObject({ count: 1, box: 0, due: null, createdAt: "2026-10-07T10:00:00Z" });
  });

  it("refuses what is not a word with a meaning and a place", () => {
    for (const bad of [
      lookedUp("  ", "x"),
      lookedUp("x".repeat(81), "x"),
      lookedUp("brume", " \n "),
      lookedUp("brume", "Mist.", { bookId: " " }),
      lookedUp("brume", "Mist.", { p: 1.5 }),
      lookedUp("brume", "Mist.", { p: -0.1 }),
      lookedUp("brume", "Mist.", { p: Number.NaN })
    ]) {
      expect(() => recorded(null, bad, NOW)).toThrow();
    }
    const highlight: WordRow = { id: "word:en:brume", bookId: "b1", kind: "highlight", cfi: "x", text: "words", createdAt: NOW, updatedAt: NOW };
    expect(() => recorded(highlight, lookedUp("brume", "Mist."), NOW)).toThrow();
    expect(() => reviewed(highlight, { id: highlight.id, box: 1, due: 20_000 }, NOW)).toThrow();
    const row = recorded(null, lookedUp("brume", "é".repeat(MAX_MEANING + 40)), NOW);
    expect([...(fromRow(row)?.meaning ?? "")]).toHaveLength(MAX_MEANING);
    for (const review of [
      { id: row.id, box: 6, due: 20_000 },
      { id: row.id, box: -1, due: 20_000 },
      { id: row.id, box: 1.5, due: 20_000 },
      { id: row.id, box: 1, due: -1 }
    ]) {
      expect(() => reviewed(row, review, NOW)).toThrow();
    }
    expect(() => reviewed({ ...row, deletedAt: NOW }, { id: row.id, box: 1, due: 20_000 }, NOW)).toThrow();
  });

  it("leaves out what cannot be read, and lists the most recently looked up first", () => {
    const a = recorded(null, lookedUp("brume", "Mist."), NOW);
    const b = recorded(null, lookedUp("mizzle", "Fine rain."), LATER);
    const rows: WordRow[] = [
      a,
      b,
      { ...recorded(null, lookedUp("gone", "Removed."), LATER), deletedAt: LATER },
      { ...a, id: "word:en:broken", text: "not json" },
      { ...a, id: "word:en:empty", text: "{}" },
      { ...a, id: "word:en:nameless", note: " " },
      { id: "h1", bookId: "b1", kind: "highlight", cfi: "x", text: '{"m":"looks like one"}', note: "word", createdAt: NOW, updatedAt: NOW }
    ];
    expect(wordsOf(rows).map((word) => word.word)).toEqual(["mizzle", "brume"]);
    // A later version's box that this one does not know is the first box, not a crash.
    expect(fromRow({ ...a, text: JSON.stringify({ m: "Mist.", b: 99, d: "soon", n: 0 }) })).toMatchObject({ box: 0, due: null, count: 1 });
  });
});

describe("what a look-up leaves to keep", () => {
  const result = (partial: Partial<LookupResult>): LookupResult => ({ term: "x", meaning: null, summary: null, lead: "meaning", missed: [], ...partial });
  const meaning = {
    word: "wandered",
    language: "English",
    entries: [{ partOfSpeech: "Verb", definitions: ["simple past and past participle of wander"] }],
    url: "",
    root: { word: "wander", entries: [{ partOfSpeech: "Verb", definitions: ["To move without purpose or specified destination.", "To stray."] }], url: "" }
  };
  const summary = { title: "Marcus Aurelius", description: "Roman emperor from 161 to 180", extract: "Marcus Aurelius was Roman emperor. He wrote things.", url: "", ambiguous: false };

  it("is the word in its dictionary form with its first meaning", () => {
    expect(keepable(result({ meaning }))).toEqual({ word: "wander", meaning: "To move without purpose or specified destination.", part: "verb" });
    expect(keepable(result({ meaning: { ...meaning, root: null } }))).toEqual({ word: "wandered", meaning: "simple past and past participle of wander", part: "verb" });
  });

  it("is a name and what it is, when that is what the card led with or all there was", () => {
    expect(keepable(result({ meaning, summary, lead: "summary" }))).toEqual({ word: "Marcus Aurelius", meaning: "Roman emperor from 161 to 180", part: null });
    expect(keepable(result({ meaning, summary, lead: "meaning" }))?.word).toBe("wander");
    expect(keepable(result({ summary: { ...summary, description: null } }))?.meaning).toBe("Marcus Aurelius was Roman emperor.");
    // A name several pages share has no one meaning: the word's own is kept, or nothing.
    expect(keepable(result({ meaning, summary: { ...summary, ambiguous: true, extract: "" }, lead: "summary" }))?.word).toBe("wander");
    expect(keepable(result({ summary: { ...summary, ambiguous: true, extract: "" } }))).toBeNull();
  });

  it("is nothing when nothing was found", () => {
    expect(keepable(result({}))).toBeNull();
    expect(keepable(result({ meaning: { ...meaning, root: null, entries: [{ partOfSpeech: "Noun", definitions: ["  "] }] } }))).toBeNull();
  });
});

describe("words beside everything else in the annotations", () => {
  const clock: Clock = (iso) => ({ dateKey: iso.slice(0, 10), hour: Number(iso.slice(11, 13)) });
  const row = recorded(null, lookedUp("Brume", "Mist; fog."), NOW);

  it("is the word the diary says was looked up", () => {
    // The row as it is written is the row the diary reads: its `note` is the word.
    const mark = markOf(row);
    expect(mark).toMatchObject({ kind: "word", words: "Brume", bookId: "b1", createdAt: NOW });
    const facts = diaryFacts(
      {
        days: [{ dateKey: "2026-10-04", minutes: 25, goalMinutes: 20, freezeUsed: false, graceUsed: false }],
        sessions: [],
        freeReads: [],
        books: [{ id: "b1", title: "Mistborn", progress: 0.3 }],
        marks: mark ? [mark] : []
      },
      "2026-10-04",
      clock
    );
    expect(facts.days[0].words).toEqual(["Brume"]);
    const [entry] = diaryEntries(facts, "2026-10-04");
    expect(entry.parts.map((part) => part.kind)).toContain("word");
    expect(entry.text).toContain("“Brume”");
    // The book it was looked up in is the day's book.
    expect(facts.days[0].books.map((book) => book.title)).toEqual(["Mistborn"]);
    // Looked up again another day, it is still the first day's word; removed, it is no day's.
    expect(markOf(recorded(row, lookedUp("brume", "Mist."), LATER))?.createdAt).toBe(NOW);
    expect(markOf({ ...row, deletedAt: LATER })).toBeNull();
  });

  it("is no highlight, no bookmark and no character to the code that reads those", () => {
    expect(isWordRow(row)).toBe(true);
    expect(isWordRow({ kind: "highlight" })).toBe(false);
    expect(isWordRow({ kind: "person" })).toBe(false);
    // The character sheets.
    expect(isPeopleRow(row)).toBe(false);
    expect(entriesOf([row])).toEqual([]);
    // The notes on Pip's fridge (her latest highlights): a word has text and a place, and is still not one.
    const asAnnotation = row as unknown as Parameters<typeof pinnedNotes>[0][number];
    expect(pinnedNotes([asAnnotation])).toEqual([]);
    // And a character is no word.
    expect(fromRow({ ...row, kind: "person" })).toBeNull();
  });
});

describe("what a list of annotations can carry", () => {
  it("is told apart by kind, so a word or a character is never taken for a highlight", async () => {
    const { isAnnotation } = await import("../../services/annotationService");
    const base = { id: "x", bookId: "b1", cfi: "epubcfi(/6/2)", createdAt: NOW, updatedAt: NOW };
    expect(isAnnotation({ ...base, kind: "highlight" })).toBe(true);
    expect(isAnnotation({ ...base, kind: "bookmark" })).toBe(true);
    for (const kind of ["word", "person", "person.note", "person.link", "person.group", "something-newer"]) {
      expect(isAnnotation({ ...base, kind }), kind).toBe(false);
    }
  });
});

describe("a word picked by a double-click", () => {
  it("is one word, selected just after the double-click", () => {
    const at = 1_000_000;
    expect(isDoubleClickedWord("shelldry", at, at + 260)).toBe(true);
    expect(isDoubleClickedWord(" Kelsier ", at, at + 260)).toBe(true);
    expect(isDoubleClickedWord("mother-in-law", at, at + 260)).toBe(true);
    // A phrase dragged over, a mark of punctuation, and a selection made long after.
    expect(isDoubleClickedWord("a game of shelldry", at, at + 260)).toBe(false);
    expect(isDoubleClickedWord("—", at, at + 260)).toBe(false);
    expect(isDoubleClickedWord("shelldry", at, at + DOUBLE_CLICK_MS)).toBe(false);
    expect(isDoubleClickedWord("shelldry", 0, at)).toBe(false);
  });
});
