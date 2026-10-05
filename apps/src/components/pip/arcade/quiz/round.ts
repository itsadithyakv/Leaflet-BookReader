/**
 * The word quiz: a round of questions made from the words the reader looked
 * up. Pip holds up a word and the reader picks its meaning from four, or she
 * reads out a meaning and the reader picks the word.
 *
 * Every question is about one of the reader's own words. The wrong answers
 * are their other words (or those words' meanings), topped up from a small
 * list of the game's own while the reader has only a few. Which words come
 * up is the boxes' business (boxes.ts): the due ones first.
 *
 * Pure: the day and the seed are handed in.
 */
import { askOrder, type Boxed } from "./boxes";
import { BUILTIN_WORDS } from "./builtinWords";

/** Questions in a round. Short on purpose: a game between chapters. */
export const ROUND = 10;
/** Fewer words than this and there is no game yet: four answers need four words. */
export const MIN_WORDS = 4;
export const OPTIONS = 4;
/** While the reader has fewer words than this, the game's own are mixed into the wrong answers. */
const OWN_WORDS_ENOUGH = 8;

export type QuizWord = Boxed & { word: string; meaning: string };

export type Question = {
  /** The word (or, in "Who is this?", the person) it is about. */
  id: string;
  /** What the reader picks: the word's meaning, the word itself, or the note about a person. */
  way: "meaning" | "word" | "who";
  /** What Pip holds up. */
  prompt: string;
  /** A line under it: the book a person is from. */
  context?: string;
  options: string[];
  /** Which of the options is right. */
  answer: number;
};

/** A small seeded generator (mulberry32): the same seed, the same round. */
export const seededRandom = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const shuffled = <T,>(items: readonly T[], random: () => number): T[] => {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [list[index], list[other]] = [list[other], list[index]];
  }
  return list;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The first `count` of `candidates` that differ from each other and from everything in `taken`. */
export const distinct = (candidates: readonly string[], taken: readonly string[], count: number): string[] => {
  const picked: string[] = [];
  for (const candidate of candidates) {
    if (picked.length >= count) {
      break;
    }
    if (candidate.trim() && ![...taken, ...picked].some((other) => same(other, candidate))) {
      picked.push(candidate);
    }
  }
  return picked;
};

/** The options in a seeded order, and where the right one landed. */
export const laidOut = (right: string, wrong: string[], random: () => number) => {
  const options = shuffled([right, ...wrong], random);
  return { options, answer: options.indexOf(right) };
};

/**
 * A round: up to ten of the reader's words, the due ones first, each asked
 * one way or the other. Empty with fewer than four words (the game then says
 * how to get some).
 */
export const buildRound = (
  words: QuizWord[],
  today: number,
  seed: number,
  filler: ReadonlyArray<{ word: string; meaning: string }> = BUILTIN_WORDS
): Question[] => {
  if (words.length < MIN_WORDS) {
    return [];
  }
  const random = seededRandom(seed);
  const ties = new Map(shuffled(words, random).map((word, index) => [word.id, index]));
  const asked = askOrder(words, today, (id) => ties.get(id) ?? 0).slice(0, ROUND);
  // The game's own words, less any the reader already has.
  const spare = filler.filter((entry) => !words.some((word) => same(word.word, entry.word)));
  const questions: Question[] = [];
  for (const [index, target] of asked.entries()) {
    // The first is always a word held up; after that either way.
    const way = index === 0 || random() < 0.5 ? "meaning" : "word";
    // A word that means the same as this one is no wrong answer to either question.
    const others = words.filter((word) => word.id !== target.id && !same(word.word, target.word) && !same(word.meaning, target.meaning));
    const extra = spare.filter((entry) => !same(entry.word, target.word) && !same(entry.meaning, target.meaning));
    const mixed = words.length < OWN_WORDS_ENOUGH ? shuffled([...others, ...extra], random) : [...shuffled(others, random), ...shuffled(extra, random)];
    const right = way === "meaning" ? target.meaning : target.word;
    const wrong = distinct(mixed.map((entry) => (way === "meaning" ? entry.meaning : entry.word)), [right], OPTIONS - 1);
    if (wrong.length < OPTIONS - 1) {
      continue;
    }
    questions.push({ id: target.id, way, prompt: way === "meaning" ? target.word : target.meaning, ...laidOut(right, wrong, random) });
  }
  return questions;
};
