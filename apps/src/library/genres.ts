import type { Book } from "@shared/models/book";
import { isFinished } from "../constants/books";
import { CLOTH, hash } from "../components/shelf/spine";

/**
 * The library by genre, for the Collections page's wall of genre tiles.
 *
 * A genre used to be a chip that sent the reader off to the library with a
 * filter set. Here each is a shelf of its own: the books that carry the
 * genre, the ones being read first. Worked out on the spot from the genres
 * the books already have (their own, or a lookup's), never stored.
 */
export type GenreShelf = {
  /**
   * The genre in lower case, trimmed: what "Fantasy" and "fantasy " share.
   * Another name for the same genre ("Sci-fi") has the key of the genre it
   * is a name for ("science fiction").
   */
  key: string;
  /** As most of its books spell it; the genre's own name before another name for it. */
  name: string;
  books: Book[];
};

/**
 * Other names for one genre, each in lower case, with the key of the genre
 * it stands with. Only names that can mean nothing else: "Sci-fi" and
 * "Science Fiction" were two tiles with half the books on each.
 */
const SAME_GENRE = new Map<string, string>([
  ["sci-fi", "science fiction"],
  ["sci fi", "science fiction"],
  ["scifi", "science fiction"],
  ["sf", "science fiction"],
  ["science-fiction", "science fiction"],
  ["ya", "young adult"],
  ["young-adult", "young adult"],
  ["non-fiction", "nonfiction"],
  ["non fiction", "nonfiction"],
  ["biographies", "biography"],
  ["biography & autobiography", "biography"]
]);

/** The key of the shelf a genre stands on, from its name as a book spells it (trimmed). */
const keyOf = (name: string) => {
  const spelt = name.toLowerCase();
  return SAME_GENRE.get(spelt) ?? spelt;
};

/**
 * The key of the genre a book's spelling of it stands with: "Sci-fi ",
 * "sci-fi" and "Science  Fiction" all give "science fiction". What the
 * library's genre filter holds and matches by.
 */
export const genreKey = (name: string) => keyOf(name.trim().replace(/\s+/g, " "));

/** The commonest spelling; of two as common, the one that sorts first, so it never flips. */
const commonest = (spellings: Array<[string, number]>) => [...spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

const time = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Being read (0), not started (1), finished (2): the order a genre's books stand in. */
const stage = (book: Book) => (isFinished(book.progress) ? 2 : (book.progress ?? 0) > 0 ? 0 : 1);

/** Being read first, most recently opened first; then the unread, newest first; then the finished. */
const byReading = (a: Book, b: Book) =>
  stage(a) - stage(b) || time(b.lastOpened) - time(a.lastOpened) || time(b.createdAt) - time(a.createdAt) || a.title.localeCompare(b.title);

/** Each genre's books and the ways they spell it, by key, in the order the genres are first met. */
const gathered = (books: Book[]) => {
  const found = new Map<string, { spellings: Map<string, number>; books: Book[] }>();
  for (const book of books) {
    const seen = new Set<string>();
    for (const genre of book.genres ?? []) {
      const name = genre.trim().replace(/\s+/g, " ");
      const key = keyOf(name);
      // A book that names a genre twice ("Fantasy", "fantasy", or "Sci-fi" and "Science Fiction") is in it once.
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const entry = found.get(key) ?? { spellings: new Map<string, number>(), books: [] };
      entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1);
      entry.books.push(book);
      found.set(key, entry);
    }
  }
  return found;
};

/**
 * The genre's own name where a book has it ("Science Fiction"), however many say "Sci-fi":
 * the tile is not renamed by the next book. Where none has, what the books say.
 */
const nameOf = (key: string, spelt: Map<string, number>) => {
  const spellings = [...spelt.entries()];
  const own = spellings.filter(([name]) => name.toLowerCase() === key);
  return commonest(own.length > 0 ? own : spellings);
};

/**
 * Every genre in the library with its books, the genre with most books
 * first. A book with several genres stands in each; one with none is in no
 * genre (it is on the shelves all the same).
 */
export const genreShelves = (books: Book[]): GenreShelf[] =>
  [...gathered(books).entries()]
    .map(([key, entry]) => ({ key, name: nameOf(key, entry.spellings), books: [...entry.books].sort(byReading) }))
    .sort((a, b) => b.books.length - a.books.length || a.name.localeCompare(b.name));

/**
 * The genres to choose from in the library's filter: one for each genre
 * however its books spell it, named as its tile is, in the order the library
 * first meets them. `key` is what the filter holds.
 */
export const genreChoices = (books: Book[]): Array<{ key: string; name: string }> =>
  [...gathered(books).entries()].map(([key, entry]) => ({ key, name: nameOf(key, entry.spellings) }));

/** Whether a book is in the genre with this key (`genreKey`), under any of its spellings. */
export const inGenre = (book: Book, key: string) => (book.genres ?? []).some((genre) => genreKey(genre) === key);

/**
 * A colour for each genre's tile, from the cloths the session shelf binds its
 * books in. Each genre starts at the slot its name hashes to and takes the
 * next free one, so neighbours on the wall differ until every colour is out,
 * and a genre keeps its colour while the genres ahead of it stay the same.
 */
export const genreColours = (shelves: GenreShelf[]): Map<string, string> => {
  const colours = new Map<string, string>();
  const used = new Set<number>();
  for (const shelf of shelves) {
    let slot = hash(`genre:${shelf.key}`) % CLOTH.length;
    if (used.size < CLOTH.length) {
      while (used.has(slot)) {
        slot = (slot + 1) % CLOTH.length;
      }
      used.add(slot);
    }
    colours.set(shelf.key, CLOTH[slot]);
  }
  return colours;
};

/** The book whose cover stands on a genre's tile: the first that has one, else the first. */
export const faceOf = (shelf: GenreShelf): Book | null => shelf.books.find((book) => Boolean(book.coverUrl)) ?? shelf.books[0] ?? null;
