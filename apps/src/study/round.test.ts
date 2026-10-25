import { describe, expect, it } from "vitest";
import { askInput, fillInput, fromRow, saved, type StudyCard } from "./cards";
import { buildStudyRound, cardBooks, cardsInScope, dueTotals, STUDY_ROUND } from "./round";
import type { QuizWord } from "../components/pip/arcade/quiz/round";

const TODAY = 20_386;
const NOW = "2026-10-25T10:00:00.000Z";

const card = (id: string, bookId: string, box = 0, due: number | null = null): StudyCard => ({
  ...fromRow(saved(null, fillInput({ bookId, cfi: null, chapter: null, p: 0.5 }, "The mitral valve has two cusps.", [[4, 10]], null, `card:${id}`), NOW))!,
  box,
  due
});
const question = (id: string, bookId: string, due: number | null = null): StudyCard => ({
  ...fromRow(saved(null, askInput({ bookId, cfi: null, chapter: null, p: 0.5 }, `Question ${id}?`, "An answer.", null, `card:${id}`), NOW))!,
  due
});
const word = (name: string, due: number | null = null, box = 0): QuizWord & { bookId: string } => ({
  id: `word:en:${name}`,
  word: name,
  meaning: `The meaning of ${name}.`,
  box,
  due,
  bookId: "b1"
});
const WORDS = ["brume", "mizzle", "ephemeral", "sagacious", "quiddity"];

describe("Revise: words and cards in one round", () => {
  const cards = [card("a", "anatomy"), card("b", "anatomy", 2, TODAY + 3), question("c", "physiology", TODAY - 2), card("d", "physiology", 1, TODAY)];

  it("counts what is due across both, words only once there are enough for the quiz", () => {
    expect(dueTotals(WORDS.map((name) => word(name)), cards, TODAY)).toEqual({ words: 5, cards: 3, total: 8 });
    expect(dueTotals([word("brume"), word("mizzle")], cards, TODAY)).toEqual({ words: 0, cards: 3, total: 3 });
  });

  it("all of it mixes words and cards, the due ones first", () => {
    const words = WORDS.map((name, index) => word(name, index < 2 ? null : TODAY + 10, index < 2 ? 0 : 3));
    const round = buildStudyRound(words, cards, { what: "all" }, TODAY, 7);
    expect(round.some((item) => item.type === "word")).toBe(true);
    expect(round.some((item) => item.type === "card")).toBe(true);
    const due = (item: (typeof round)[number]) => (item.type === "card" ? item.card.due === null || item.card.due <= TODAY : item.word.due === null || item.word.due <= TODAY);
    const firstNotDue = round.findIndex((item) => !due(item));
    // Three cards and two words due, then the rest.
    expect(firstNotDue).toBe(5);
    expect(round.slice(firstNotDue).every((item) => !due(item))).toBe(true);
    // Among the due, the first box first.
    expect(round.slice(0, 5).map((item) => (item.type === "card" ? item.card.box : item.word.box))).toEqual([0, 0, 0, 0, 1]);
  });

  it("words alone have no cards, cards alone no words, and one book's only its own", () => {
    const words = WORDS.map((name) => word(name));
    expect(buildStudyRound(words, cards, { what: "words" }, TODAY, 1).every((item) => item.type === "word")).toBe(true);
    const cardsOnly = buildStudyRound(words, cards, { what: "cards", bookId: null }, TODAY, 1);
    expect(cardsOnly).toHaveLength(4);
    expect(cardsOnly.every((item) => item.type === "card")).toBe(true);
    const one = buildStudyRound(words, cards, { what: "cards", bookId: "physiology" }, TODAY, 1);
    expect(one.map((item) => (item.type === "card" ? item.card.id : "")).sort()).toEqual(["card:c", "card:d"]);
    expect(cardsInScope(cards, { what: "cards", bookId: "anatomy" }).map((one) => one.id)).toEqual(["card:a", "card:b"]);
    expect(cardsInScope(cards, { what: "words" })).toEqual([]);
  });

  it("a round is twenty at most, and with nothing due is the soonest due", () => {
    const many = Array.from({ length: 30 }, (_, index) => card(`m${index}`, "anatomy", 2, TODAY + 1 + index));
    const round = buildStudyRound([], many, { what: "cards", bookId: null }, TODAY, 3);
    expect(round).toHaveLength(STUDY_ROUND);
    expect(round[0].type === "card" && round[0].card.id).toBe("card:m0");
  });

  it("lists the books that have cards, the most due first", () => {
    expect(cardBooks(cards, TODAY)).toEqual([
      { bookId: "physiology", count: 2, due: 2 },
      { bookId: "anatomy", count: 2, due: 1 }
    ]);
  });
});
