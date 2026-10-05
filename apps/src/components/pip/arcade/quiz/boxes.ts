/**
 * The quiz's memory: a box per word.
 *
 * A word starts in the first box. Answered right it moves up a box and is
 * left alone for longer; answered wrong it goes back to the first and is
 * asked again next time. Words that are due are asked before words that are
 * not. That is all of it: no scores, no ease factors.
 *
 * The box and the day a word is next due are kept in the word's own row
 * (readers/words/rows.ts), so they travel with the backup.
 *
 * Pure: no clock (the caller says what day it is), no storage.
 */
import { MAX_BOX, type WordReview } from "../../../../readers/words/rows";

/** Days a word rests in each box before it is due again. The first box does not rest. */
export const REST_DAYS = [0, 1, 3, 7, 14, 30] as const;

export type Boxed = { id: string; box: number; due: number | null };

/** Where a word goes after an answer, and the day it is next due. */
export const answered = (word: Boxed, right: boolean, today: number): WordReview => {
  const box = right ? Math.min(MAX_BOX, Math.max(0, word.box) + 1) : 0;
  return { id: word.id, box, due: today + REST_DAYS[box] };
};

/** A word never asked, or whose day has come. */
export const isDue = (word: Boxed, today: number) => word.due === null || word.due <= today;

/**
 * The order to ask in: the words that are due (the lowest box first, then the
 * longest overdue), then the rest by the day they come due. `shuffle` breaks
 * the ties, so words that stand level do not always come in the same order.
 */
export const askOrder = <W extends Boxed>(words: W[], today: number, shuffle: (id: string) => number = () => 0): W[] =>
  [...words].sort((a, b) => {
    const dueA = isDue(a, today);
    const dueB = isDue(b, today);
    if (dueA !== dueB) {
      return dueA ? -1 : 1;
    }
    if (dueA) {
      return a.box - b.box || (a.due ?? -1) - (b.due ?? -1) || shuffle(a.id) - shuffle(b.id) || a.id.localeCompare(b.id);
    }
    return (a.due as number) - (b.due as number) || a.box - b.box || shuffle(a.id) - shuffle(b.id) || a.id.localeCompare(b.id);
  });

/** How many words are due, for the game's tile. */
export const dueCount = (words: Boxed[], today: number) => words.filter((word) => isDue(word, today)).length;
