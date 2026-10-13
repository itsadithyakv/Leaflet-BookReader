import type { Spoiler } from "../../services/discussService";

/**
 * Keeping a thread about the end of a book away from a reader who is not
 * there yet.
 *
 * A thread says how far into its book it goes (so far through a book, or up
 * to a book of a series), and the app knows how far this reader is: its
 * library holds their place in every book. So a thread past that place is
 * shown as a cover that says how far it goes, and opens only if the reader
 * asks. Nothing is asked of the server for this, and a reader's place is not
 * sent anywhere to work it out. Pure, so the rule is tested here.
 */

/** How far this reader is in the book a community is about; null when the book is not in their library. */
export type BookPlace = { percent: number; finished: boolean } | null;

/** How far this reader is in a series: the number of the last book they finished (0 for none), null when they have none of it. */
export type SeriesPlace = { finishedThrough: number } | null;

/** A book in the library, as far as a place needs it. */
type Held = { progress?: number | null; finishedAt?: string | null };

const FINISHED_AT = 0.99;

/** The furthest of several copies of one book (an EPUB and a PDF): a reader who finished either has read it. */
export const bookPlace = (copies: Held[]): BookPlace => {
  if (copies.length === 0) {
    return null;
  }
  const finished = copies.some((book) => (book.progress ?? 0) >= FINISHED_AT || Boolean(book.finishedAt));
  const percent = Math.round(Math.max(...copies.map((book) => Math.min(1, Math.max(0, book.progress ?? 0)))) * 100);
  return { percent: finished ? 100 : percent, finished };
};

/** The place in a series, from its books in this library: each with its number and whether it is finished. */
export const seriesPlace = (members: Array<{ index: number | null; finished: boolean }>): SeriesPlace => {
  if (members.length === 0) {
    return null;
  }
  const finished = members.filter((member) => member.finished && member.index !== null).map((member) => member.index as number);
  return { finishedThrough: finished.length > 0 ? Math.floor(Math.max(...finished)) : 0 };
};

/**
 * Whether a thread is past where the reader is. A reader who does not have
 * the book has not read it: everything marked is covered. A thread marked
 * "up to 40%" is open to a reader at 40% or beyond.
 */
export const isPast = (spoiler: Spoiler, place: BookPlace | SeriesPlace): boolean => {
  if (!spoiler) {
    return false;
  }
  if (place === null) {
    return true;
  }
  if ("percent" in spoiler) {
    return "percent" in place ? !place.finished && place.percent < spoiler.percent : true;
  }
  return "finishedThrough" in place ? place.finishedThrough < spoiler.book : true;
};

/** How far a thread goes, in words: on its cover, and beside its title once open. */
export const spoilerText = (spoiler: Spoiler): string | null => {
  if (!spoiler) {
    return null;
  }
  if ("percent" in spoiler) {
    return spoiler.percent >= 100 ? "Spoilers: the whole book" : `Spoilers: the first ${spoiler.percent}%`;
  }
  return spoiler.book >= 99 ? "Spoilers: the whole series" : `Spoilers: up to book ${spoiler.book}`;
};

/** What a new thread can be marked as, for a book: nothing, as far as the writer has read, or all of it. */
export const bookSpoilerChoices = (place: BookPlace): Array<{ label: string; spoiler: Spoiler }> => {
  const choices: Array<{ label: string; spoiler: Spoiler }> = [{ label: "No spoilers", spoiler: null }];
  if (place && !place.finished && place.percent > 0 && place.percent < 100) {
    choices.push({ label: `Up to where I am (${place.percent}%)`, spoiler: { percent: place.percent } });
  }
  choices.push({ label: "The whole book", spoiler: { percent: 100 } });
  return choices;
};

/** And for a series: nothing, up to each of its books, or all of it. */
export const seriesSpoilerChoices = (books: number): Array<{ label: string; spoiler: Spoiler }> => [
  { label: "No spoilers", spoiler: null },
  ...Array.from({ length: Math.max(0, Math.min(40, books)) }, (_, at) => ({ label: `Up to book ${at + 1}`, spoiler: { book: at + 1 } as Spoiler })),
  { label: "The whole series", spoiler: { book: 99 } }
];
