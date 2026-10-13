import { genreMood } from "../genre";
import { isRaised, type BaseState } from "./rules";

/**
 * The trophies in Pip's camp: one for each book finished, shaped by what
 * kind of book it was. `books.genres` is free-form (whatever the file, an
 * enrichment or the reader said), so this reads those words, as `genre.ts`
 * does for Pip's moods, and falls back to a stack of books.
 */

/** Which trophy: the picture's variant. */
export const TROPHY_KINDS = ["Books", "Fantasy", "Science fiction", "Mystery", "Romance", "Horror", "History", "Science", "Classics", "Adventure", "Young readers"] as const;

/** Said after the moods have had their say; in the order they win. */
const SAYS: ReadonlyArray<[number, RegExp]> = [
  [10, /\bchildren|\bjuvenile|\byoung adult|\bya\b|\bpicture book|\bmiddle grade/],
  [6, /\bhistor|\bbiograph|\bmemoir|\bautobiograph|\bwar\b/],
  [8, /\bclassic|\bpoet|\bdrama\b|\bplays?\b|\bliterary|\bessays?\b/],
  [9, /\badventure|\btravel|\bsea stor|\bnautical|\bpirate|\bexplor|\bwestern/],
  [7, /\bscience\b|\bnon-?fiction|\bphilosoph|\bpsycholog|\bmathemat|\bnature|\bcomput|\btechnolog|\beconom|\bbusiness|\bself-help|\bhealth/]
];

const MOODS = { fantasy: 1, scifi: 2, mystery: 3, romance: 4, horror: 5 } as const;

/** The trophy a book's genres earn it. */
export const trophyKind = (genres: readonly unknown[] | null | undefined): number => {
  const mood = genreMood(genres);
  if (mood) return MOODS[mood];
  const named = (genres ?? []).filter((genre): genre is string => typeof genre === "string").map((genre) => genre.toLowerCase());
  for (const genre of named) {
    for (const [kind, pattern] of SAYS) if (pattern.test(genre)) return kind;
  }
  return 0;
};

type Finished = { id: string; title: string; genres?: readonly unknown[] | null; finishedAt?: string | null; progressUpdatedAt?: string | null; lastOpened?: string | null };

const when = (book: Finished) => book.finishedAt || book.progressUpdatedAt || book.lastOpened || "";

/** The trophies that stand in the camp: the most lately finished of the books that have one, newest first. */
export const trophyRow = (finished: readonly Finished[], base: BaseState, most: number): Array<{ id: string; title: string; kind: number }> =>
  finished
    .filter((book) => isRaised(base, book.id))
    .sort((a, b) => when(b).localeCompare(when(a)))
    .slice(0, most)
    .map((book) => ({ id: book.id, title: book.title, kind: trophyKind(book.genres) }));

/** Finished books whose trophy has not been raised yet, oldest first: each is a gift waiting. */
export const toRaise = (finished: readonly Finished[], base: BaseState): Finished[] =>
  finished.filter((book) => !isRaised(base, book.id)).sort((a, b) => when(a).localeCompare(when(b)));
