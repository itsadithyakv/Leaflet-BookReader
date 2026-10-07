/**
 * A Kindle's clippings (kindleClippings.ts), brought to the books the library
 * has: which book each is from, and the highlights they become.
 *
 * A book is found by its title, and by its author when both the Kindle and
 * the library name one. The Kindle writes "Voss, Maren" where the library has
 * "Maren Voss", adds the series in brackets, and one of the two often has a
 * subtitle the other has not; all of that is allowed for. Nothing else is: a
 * highlight filed under the wrong book is worse than one not brought over, so
 * a title that fits two books of the library is left out and said to be.
 *
 * Each clipping becomes a highlight whose id comes from its book, its place
 * and its words. The same file imported again makes the same ids, and what is
 * already there is left exactly as it is: nothing added, nothing changed (a
 * note or a colour edited since stays edited).
 *
 * Pure but for `planKindleImport`, which is handed the way to ask what a book
 * already has.
 */
import type { Book } from "@shared/models/book";
import type { AnnotationInput } from "../services/annotationService";
import { kindlePlace, parseClippings, textHash, type KindleBook, type KindleClipping } from "./kindleClippings";
import { authorKey, normalizeTitle } from "./series";

// ---- finding the book ---------------------------------------------------------------

/** "(The Tide Cycle Book 2)", "[Kindle Edition]": not part of the name. */
const stripBrackets = (text: string) => text.replace(/\s*[([{][^)\]}]*[)\]}]\s*/g, " ").replace(/\s+/g, " ").trim();

/** Letters and digits of any alphabet, lower case, no accents. */
const wideKey = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * How titles are compared: as the series are (`normalizeTitle`). That keeps
 * only a to z, which leaves nothing of a title in another alphabet (or only
 * its number, the same for every "... 2"); such a title is compared by all of
 * its letters instead.
 */
const titleKey = (text: string) => {
  const wide = wideKey(text);
  return /[^a-z0-9 ]/.test(wide) ? wide : normalizeTitle(text);
};

type Forms = {
  /** The whole title. */
  whole: string;
  /** What comes before its subtitle (a colon, or a dash with spaces round it); null when it has none. */
  main: string | null;
};

const formsOf = (title: string): Forms => {
  const base = stripBrackets(title) || title;
  const whole = titleKey(base);
  const cut = base.search(/:|\s[-–—]\s/);
  const main = cut > 0 ? titleKey(base.slice(0, cut)) : "";
  return { whole, main: main && main !== whole ? main : null };
};

/**
 * The names an author line can be known by: each author's surname, and for
 * "Voss, Maren" both words (a comma also sits between two authors, and
 * nothing says which this is). Single letters are initials, and no name.
 */
const authorNames = (author: string | null | undefined): Set<string> => {
  const names = new Set<string>();
  for (const one of (author ?? "").split(/;|&|\/|\s+and\s+/i)) {
    for (const piece of one.includes(",") ? [one, ...one.split(",")] : [one]) {
      const key = authorKey(piece);
      if (key && key.length > 1) {
        names.add(key);
      }
    }
  }
  return names;
};

/** Two author lines may be the same writer: they share a name, or one of them names nobody. */
const sameAuthor = (a: Set<string>, b: Set<string>) => a.size === 0 || b.size === 0 || [...a].some((name) => b.has(name));

type Shelved = { book: Book; forms: Forms; authors: Set<string> };

const shelve = (library: Book[]): Shelved[] =>
  library.map((book) => ({ book, forms: formsOf(book.title), authors: authorNames(book.author) }));

/**
 * The library's book a Kindle title is: the one with the same title, or,
 * when none has, the one that is the same but for a subtitle only one side
 * has ("The Salt Road" and "The Salt Road: A Novel"). Two subtitles that
 * differ are two books. "ambiguous" when more than one book fits.
 */
const find = (title: string, author: string | null, shelf: Shelved[]): Book | "ambiguous" | null => {
  const forms = formsOf(title);
  if (!forms.whole) {
    return null;
  }
  const authors = authorNames(author);
  const fits = shelf.filter((entry) => entry.forms.whole && sameAuthor(authors, entry.authors));
  const exact = fits.filter((entry) => entry.forms.whole === forms.whole);
  const found =
    exact.length > 0
      ? exact
      : fits.filter(
          (entry) =>
            (forms.main === null && entry.forms.main === forms.whole) || (entry.forms.main === null && forms.main === entry.forms.whole)
        );
  return found.length === 0 ? null : found.length === 1 ? found[0].book : "ambiguous";
};

/** The book of the library a Kindle title belongs to; "ambiguous" when two fit, null when none does. */
export const findKindleBook = (title: string, author: string | null, library: Book[]) => find(title, author, shelve(library));

export type KindleMatch = { book: Book; clippings: KindleClipping[] };

/** A book of the Kindle's that was not brought over. */
export type KindleMiss = {
  title: string;
  author: string | null;
  /** How many clippings it has. */
  count: number;
  /** The library has more than one book it could be (two copies, two editions): none is guessed at. */
  ambiguous: boolean;
};

/** Each Kindle book with the library's book it is, and those with none. Two Kindle titles for one book (two editions read) are one match. */
export const matchClippings = (read: KindleBook[], library: Book[]): { matched: KindleMatch[]; missed: KindleMiss[] } => {
  const shelf = shelve(library);
  const matched = new Map<string, KindleMatch>();
  const missed: KindleMiss[] = [];
  for (const { title, author, clippings } of read) {
    const book = find(title, author, shelf);
    if (book === null || book === "ambiguous") {
      missed.push({ title, author, count: clippings.length, ambiguous: book === "ambiguous" });
      continue;
    }
    const match = matched.get(book.id) ?? { book, clippings: [] };
    match.clippings.push(...clippings);
    matched.set(book.id, match);
  }
  return { matched: [...matched.values()], missed };
};

// ---- the highlights they become -----------------------------------------------------

/** The colour a highlight from a Kindle is given: the reader's default. */
export const KINDLE_COLOR = "yellow";

/** Where the list of highlights files it: the Kindle's page or location, for want of a chapter. */
const labelOf = (clipping: KindleClipping) =>
  clipping.page ? `Page ${clipping.page}` : clipping.location !== null ? `Location ${clipping.location}` : "Kindle";

/**
 * The Kindle's date as the database keeps times. The Kindle writes its own
 * clock with no zone, so it is read as this device's; a date that cannot be
 * right (after now) is dropped, and the highlight is dated when it is imported.
 */
const madeAt = (addedAt: string | null, now: number): string | undefined => {
  const time = addedAt ? new Date(addedAt).getTime() : Number.NaN;
  return Number.isFinite(time) && time <= now ? new Date(time).toISOString() : undefined;
};

/** A clipping's id in a book: always the same for the same book, place and words. */
export const kindleId = (bookId: string, clipping: KindleClipping) =>
  `kindle-${textHash(`${bookId}\n${kindlePlace(clipping)}\n${clipping.text}`)}`;

/** A book's clippings as highlights to save, each once. */
export const kindleAnnotations = (bookId: string, clippings: KindleClipping[], now = Date.now()): AnnotationInput[] => {
  const made = new Map<string, AnnotationInput>();
  for (const clipping of clippings) {
    const id = kindleId(bookId, clipping);
    made.set(id, {
      id,
      bookId,
      kind: "highlight",
      cfi: kindlePlace(clipping),
      text: clipping.text || null,
      note: clipping.note,
      color: KINDLE_COLOR,
      chapter: labelOf(clipping),
      createdAt: madeAt(clipping.addedAt, now)
    });
  }
  return [...made.values()];
};

export type KindlePlan = {
  /** What importing would add. */
  fresh: AnnotationInput[];
  /** How many books those are for. */
  books: number;
  /** Highlights of the file the library has already (it was imported before). */
  had: number;
  missed: KindleMiss[];
};

/**
 * What importing a file would do. `idsIn` answers which annotations a book
 * has now; what is there already is not in `fresh`.
 */
export const planKindleImport = async (
  file: string,
  library: Book[],
  idsIn: (bookId: string) => Promise<Iterable<string>>,
  now = Date.now()
): Promise<KindlePlan> => {
  const { matched, missed } = matchClippings(parseClippings(file), library);
  const fresh: AnnotationInput[] = [];
  let books = 0;
  let had = 0;
  for (const { book, clippings } of matched) {
    const all = kindleAnnotations(book.id, clippings, now);
    const there = new Set(await idsIn(book.id));
    const added = all.filter((item) => !there.has(item.id));
    fresh.push(...added);
    books += added.length > 0 ? 1 : 0;
    had += all.length - added.length;
  }
  return { fresh, books, had, missed };
};

const count = (number: number, one: string) => `${number} ${one}${number === 1 ? "" : "s"}`;

/**
 * The plan's first words, for the reader to say yes or no to: "128 highlights
 * for 6 books". What is already here and what was not found are counted
 * beside it, so with nothing to add it only says so.
 */
export const planLine = (plan: KindlePlan): string => {
  if (plan.fresh.length > 0) {
    return `${count(plan.fresh.length, "highlight")} for ${count(plan.books, "book")}`;
  }
  if (plan.had > 0) {
    return "Nothing new";
  }
  return plan.missed.length > 0 ? "Nothing to import" : "No highlights in that file";
};

/** How many titles a tooltip names before it counts the rest. */
const NAMED = 24;

/** The books not brought over, one to a line, for a tooltip. */
export const missedTitles = (missed: KindleMiss[]): string => {
  const lines = missed
    .slice(0, NAMED)
    .map((miss) => `${miss.title}${miss.author ? ` (${miss.author})` : ""}${miss.ambiguous ? ": more than one book it could be" : ""}`);
  if (missed.length > NAMED) {
    lines.push(`and ${missed.length - NAMED} more`);
  }
  return lines.join("\n");
};
