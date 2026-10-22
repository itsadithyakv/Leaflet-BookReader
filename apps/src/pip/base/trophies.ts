import { genreMood } from "../genre";
import { isRaised, trophyKey, type BaseState } from "./rules";

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

// ---- the meadow's blooms (1.5.11: your reading, made visible) -------------------------------------

/** Each kind's bloom on the Reading Path, in `TROPHY_KINDS` order: our own flowers. */
export const BLOOM_NAMES = ["Pagewort", "Wizard's foxglove", "Star thistle", "Lamplily", "Heartsease", "Bonecup", "Old rose", "Sundial daisy", "Laurel sprig", "Compass bloom", "Kite flower"] as const;

/** A finished book's bloom: its key in the camp's record, its kind, and the book where the library still has it. */
export type Bloom = { key: string; kind: number; title: string | null; author: string | null; on: string | null };
type Library = { id: string; title: string; author?: string | null; genres?: readonly unknown[] | null; finishedAt?: string | null; progressUpdatedAt?: string | null; lastOpened?: string | null };

/**
 * Every trophy the camp has raised, as a bloom, in the order they were raised: each looked up by its key among the
 * finished books. One whose book is no longer in the library is a pagewort, "a book you finished".
 */
export const bloomsOf = (raised: readonly string[], finished: readonly Library[]): Bloom[] => {
  const byKey = new Map(finished.map((book) => [trophyKey(book.id), book] as const));
  return raised.map((key) => {
    const book = byKey.get(key);
    return book
      ? { key, kind: trophyKind(book.genres), title: book.title, author: book.author ?? null, on: book.finishedAt || book.progressUpdatedAt || null }
      : { key, kind: 0, title: null, author: null, on: null };
  });
};

/** Your next bloom, by the reading behind no trophy yet (`trophyBudget`): a sprout, a stem, a bud, about to open. */
export const BUD_STAGES = [30, 60, 90] as const;
export const budStage = (budget: number): number => BUD_STAGES.filter((minutes) => budget >= minutes).length;

/** The Reading Path through the meadow, from the left edge to the stones; the bud at its end. */
export const READING_PATH: ReadonlyArray<readonly [number, number]> = [
  [0, 94],
  [36, 90],
  [78, 96],
  [118, 88],
  [148, 80],
  [170, 74]
];
export const BUD_AT: readonly [number, number] = [174, 76];
/** How far apart blooms are along the path, how far to either side, and how many it holds. */
const BLOOM_EVERY = 7;
const BLOOM_SIDE = 6;
export const PATH_BLOOMS = 48;
/** Older books' wild flowers: two rows at the back of the meadow, a hundred at most. */
export const WILD_MOST = 100;
const WILD_ROWS = [57, 61] as const;
const WILD_FROM = 8;
const WILD_TO = 160;

/** The spots along the path, the one nearest the stones first, each side in turn: whole pixels. */
export const pathSpots = (): Array<[number, number]> => {
  const way = [...READING_PATH].reverse();
  const lens = [0];
  for (let at = 1; at < way.length; at++) lens.push(lens[at - 1] + Math.hypot(way[at][0] - way[at - 1][0], way[at][1] - way[at - 1][1]));
  const spots: Array<[number, number]> = [];
  for (let step = 0; spots.length < PATH_BLOOMS; step++) {
    const far = BLOOM_EVERY / 2 + step * BLOOM_EVERY;
    let piece = 1;
    while (piece < way.length - 1 && lens[piece] < far) piece++;
    const [ax, ay] = way[piece - 1];
    const [bx, by] = way[piece];
    const long = Math.max(1e-6, lens[piece] - lens[piece - 1]);
    const share = Math.min(1, Math.max(0, (far - lens[piece - 1]) / long));
    const x = ax + (bx - ax) * share;
    const y = ay + (by - ay) * share;
    // To either side: across the way, which runs mostly across the picture.
    const nx = -(by - ay) / long;
    const ny = (bx - ax) / long;
    for (const side of [1, -1]) if (spots.length < PATH_BLOOMS) spots.push([Math.round(x + nx * BLOOM_SIDE * side), Math.round(y + ny * BLOOM_SIDE * side)]);
  }
  return spots;
};
const SPOTS = pathSpots();

/** Where the wild flower of an older book stands: two rows across the back, a hundred places. */
export const wildSpot = (slot: number): [number, number] => {
  const row = slot % 2;
  const column = Math.floor(slot / 2);
  const columns = WILD_MOST / 2;
  return [Math.round(WILD_FROM + (column * (WILD_TO - WILD_FROM)) / (columns - 1)) + row, WILD_ROWS[row]];
};

/** The meadow's blooms laid out: the newest nearest the stones along the path, and the older ones gone wild. */
export type BloomPlace = { bloom: number; x: number; y: number; kind: number };
export const bloomPlaces = (blooms: readonly Pick<Bloom, "kind">[]): { path: BloomPlace[]; wild: BloomPlace[]; older: number } => {
  const path: BloomPlace[] = [];
  const wild: BloomPlace[] = [];
  for (let back = 0; back < blooms.length; back++) {
    const index = blooms.length - 1 - back;
    if (back < PATH_BLOOMS) {
      const [x, y] = SPOTS[back];
      path.push({ bloom: index, x, y, kind: blooms[index].kind });
    } else if (back - PATH_BLOOMS < WILD_MOST) {
      const [x, y] = wildSpot(back - PATH_BLOOMS);
      wild.push({ bloom: index, x, y, kind: blooms[index].kind });
    }
  }
  return { path, wild, older: Math.max(0, blooms.length - PATH_BLOOMS) };
};
