/**
 * What "Revise" asks: words, cards, or both, in one round. Cards use the
 * word quiz's boxes and rest days (components/pip/arcade/quiz/boxes.ts); the
 * words are asked as the word quiz asks them (round.ts there), and only once
 * the reader has enough of them to make the quiz's four answers.
 *
 * Pure: the day and the seed are handed in.
 */
import { askOrder, dueCount, isDue, type Boxed } from "../components/pip/arcade/quiz/boxes";
import { MIN_WORDS, buildRound, seededRandom, shuffled, type Question, type QuizWord } from "../components/pip/arcade/quiz/round";
import type { StudyCard } from "./cards";

/** A round of cards (or of cards and words) is longer than the word quiz's ten: studying is not a game between chapters. */
export const STUDY_ROUND = 20;

/** What to revise: everything, the words alone, or the cards (of every book, or of one). */
export type ReviseScope = { what: "all" } | { what: "words" } | { what: "cards"; bookId: string | null };

export type StudyItem<W extends QuizWord = QuizWord> = { type: "card"; card: StudyCard } | { type: "word"; question: Question; word: W };

/** The cards a scope asks. */
export const cardsInScope = (cards: StudyCard[], scope: ReviseScope) =>
  scope.what === "words" ? [] : scope.what === "cards" && scope.bookId ? cards.filter((card) => card.bookId === scope.bookId) : cards;

/** The words a scope asks (none until there are enough for the quiz). */
export const wordsInScope = <W extends QuizWord>(words: W[], scope: ReviseScope) =>
  scope.what === "cards" || words.length < MIN_WORDS ? [] : words;

/** What is due today, as the Library's key says it. Words count only once there is a quiz to play. */
export const dueTotals = (words: Boxed[], cards: StudyCard[], today: number) => {
  const dueWords = words.length >= MIN_WORDS ? dueCount(words, today) : 0;
  const dueCards = dueCount(cards, today);
  return { words: dueWords, cards: dueCards, total: dueWords + dueCards };
};

/** Each book's cards and how many are due, for "Cards from one book", most due first. */
export const cardBooks = (cards: StudyCard[], today: number) => {
  const books = new Map<string, { bookId: string; count: number; due: number }>();
  for (const card of cards) {
    const book = books.get(card.bookId) ?? { bookId: card.bookId, count: 0, due: 0 };
    book.count += 1;
    if (isDue(card, today)) book.due += 1;
    books.set(card.bookId, book);
  }
  return [...books.values()].sort((a, b) => b.due - a.due || b.count - a.count || a.bookId.localeCompare(b.bookId));
};

/**
 * A round: up to twenty, the due ones first (the lowest box first, then the
 * longest overdue), words and cards mixed by the same rule. With nothing
 * due it is the ones that come due soonest, so a round can always be played.
 */
export const buildStudyRound = <W extends QuizWord>(words: W[], cards: StudyCard[], scope: ReviseScope, today: number, seed: number): StudyItem<W>[] => {
  const random = seededRandom(seed ^ 0x5eed);
  const asked = cardsInScope(cards, scope);
  const questions = buildRound(wordsInScope(words, scope), today, seed);
  const byId = new Map(words.map((word) => [word.id, word]));
  const items: Array<StudyItem<W> & Boxed> = [
    ...asked.map((card) => ({ type: "card" as const, card, id: card.id, box: card.box, due: card.due })),
    ...questions.flatMap((question) => {
      const word = byId.get(question.id);
      return word ? [{ type: "word" as const, question, word, id: `w:${word.id}`, box: word.box, due: word.due }] : [];
    })
  ];
  const ties = new Map(shuffled(items, random).map((item, index) => [item.id, index]));
  return askOrder(items, today, (id) => ties.get(id) ?? 0)
    .slice(0, STUDY_ROUND)
    .map((item) => (item.type === "card" ? { type: "card", card: item.card } : { type: "word", question: item.question, word: item.word }));
};
