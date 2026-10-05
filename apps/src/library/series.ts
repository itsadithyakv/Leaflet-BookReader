import type { Book } from "@shared/models/book";
import { isFinished } from "../constants/books";
import { KNOWN_SERIES, type KnownSeries } from "./knownSeries";

/**
 * Series, worked out from the library.
 *
 * Nothing here is stored. A book's series comes from, in order of trust:
 *
 * 1. **What is stored on the book** (`book.series`): read from the file at
 *    import (Calibre's and EPUB 3's series metadata), or set by the reader.
 *    `""` is the reader saying "not in a series", which stops every guess below.
 * 2. **A title that names it**: "Leviathan Wakes (The Expanse, #1)",
 *    "The Dragon Reborn: Book Three of the Wheel of Time", "Discworld #4 - Mort".
 * 3. **A well-known series** the title and author match (`knownSeries.ts`).
 * 4. **Weaker hints**, which count only once two books agree: a bare number
 *    ("Harry Potter 1 - ..."), "A Jack Reacher Novel", or two books by one
 *    author sharing the start of their titles ("Mistborn: ...").
 *
 * Books are grouped by the series' name (compared loosely), put in order by
 * their number, and each group knows how much of it is read, what is next,
 * and, for a well-known series, which books are not in the library.
 */

export type SeriesStrength = "stated" | "strong" | "weak";

export type SeriesMember = {
  book: Book;
  /** Its number in the series; `null` when nothing says. */
  index: number | null;
};

export type SeriesGroup = {
  key: string;
  name: string;
  author: string | null;
  /** In reading order: by number, then unnumbered by title. */
  members: SeriesMember[];
  /** How many books the series has, when it is a well-known one. */
  total: number | null;
  /** Books of the series not in the library: known titles, or gaps in the numbers. */
  missing: Array<{ index: number; title: string | null }>;
  /** Books read to the end, counting two copies of one book once. */
  finishedCount: number;
  /** How many distinct books of the series are in the library. */
  ownedCount: number;
  /** The first book, in order, not yet finished. */
  next: Book | null;
  /** `next` is untouched and the book before it is finished: the reader is between books. */
  upNext: boolean;
  /**
   * The book that comes after the last one finished is not in the library
   * (book 2, when 1 is read and 3 is here). Then that is what is next, not
   * `next`, and `upNext` is false.
   */
  missingNext: { index: number; title: string | null } | null;
};

export type SeriesInfo = { key: string; name: string; index: number | null };

export type LibrarySeries = {
  groups: SeriesGroup[];
  /** Book id to its series, for badges. Only books in a group, or stated/strong ones. */
  byBook: Map<string, SeriesInfo>;
};

// ---- normalising ------------------------------------------------------------------

/** Lower case, no accents, apostrophes or punctuation, no leading article. */
export const normalizeTitle = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "");

const stripBrackets = (text: string) => text.replace(/\s*[([{][^)\]}]*[)\]}]\s*/g, " ").replace(/\s+/g, " ").trim();

/** The ways one book's title might be compared: whole, before and after a
 * subtitle's colon, and before a " - ". */
export const titleKeys = (title: string): string[] => {
  const base = stripBrackets(title);
  const keys = new Set<string>();
  const add = (value: string) => {
    const key = normalizeTitle(value);
    if (key) {
      keys.add(key);
    }
  };
  add(base);
  const colon = base.indexOf(":");
  if (colon > 0) {
    add(base.slice(0, colon));
    add(base.slice(colon + 1));
  }
  const dash = base.search(/\s[-–—]\s/);
  if (dash > 0) {
    add(base.slice(0, dash));
  }
  return [...keys];
};

/** The first author's surname, lower case: "J. K. Rowling", "Rowling, J.K." and
 * "Rowling & Someone" all give "rowling". */
export const authorKey = (author: string | null | undefined): string | null => {
  if (!author) {
    return null;
  }
  const first = author.split(/;|&|\/|\s+and\s+/i)[0] ?? "";
  const surname = first.includes(",") ? first.split(",")[0] : first.trim().split(/\s+/).pop();
  const key = normalizeTitle(surname ?? "").split(" ").pop() ?? "";
  return key && !["unknown", "anonymous", "various", "author"].includes(key) ? key : null;
};

const KNOWN_BY_KEY = new Map<string, KnownSeries>();
const KNOWN_ALIAS = new Map<string, string>();

const rawSeriesKey = (name: string) =>
  normalizeTitle(stripBrackets(name))
    .replace(/\s+(series|saga|trilogy|sequence|cycle|quartet|books|novels)$/, "")
    .trim();

for (const known of KNOWN_SERIES) {
  const key = rawSeriesKey(known.name);
  KNOWN_BY_KEY.set(key, known);
  for (const alias of known.aliases ?? []) {
    KNOWN_ALIAS.set(rawSeriesKey(alias), key);
  }
}

/** How series names are compared: "The Hunger Games Trilogy" and "Hunger Games" are one. */
export const seriesKey = (name: string) => {
  const key = rawSeriesKey(name);
  return KNOWN_ALIAS.get(key) ?? key;
};

// ---- reading a title ----------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10
};
const NUM = `(\\d{1,3}(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).join("|")})`;
const toNumber = (text: string) => NUMBER_WORDS[text.toLowerCase()] ?? Number(text);
const KEYWORD = `(?:#\\s*|book\\s+|vol(?:ume)?\\.?\\s*|no\\.?\\s*|part\\s+)`;

/** "(The Expanse, #1)", "[Wheel of Time 03]", "(Discworld Book 4)". */
const BRACKETED = new RegExp(`[(\\[]\\s*([^()\\[\\]]*?[a-z][^()\\[\\]]*?)\\s*(?:,\\s*|\\s+)${KEYWORD}?${NUM}\\s*[)\\]]\\s*$`, "i");
/** "...: Book Three of the Wheel of Time", "(Book 3 in The Expanse)". */
const BOOK_OF = new RegExp(`(?:^|[:\\-–—,(]\\s*)(?:book|volume|vol\\.?|part)\\s+${NUM}\\s+(?:of|in)\\s+(.+?)\\)?\\s*$`, "i");
/** "Discworld #4 - Mort", "The Expanse, Book 2: Caliban's War". */
const KEYWORD_PREFIX = new RegExp(`^(.*?[a-z].*?)[,:]?\\s+${KEYWORD}${NUM}\\s*(?:[:\\-–—.]\\s*(.+))?$`, "i");
/** "Harry Potter 1 - The Philosopher's Stone". Weak: "Apollo 13: ..." looks the same. */
const BARE_PREFIX = /^(.*?[a-z].*?)\s+(\d{1,2})\s*[:\-–—]\s+(.+)$/i;
/** "Killing Floor: A Jack Reacher Novel". Weak. */
const A_NOVEL = /[:\-–—(]\s*an?\s+((?:[^\s)]+\s+){0,3}?[^\s)]+)\s+(?:novel|mystery|thriller|romance|adventure|book)\)?\s*$/i;

type Guess = { name: string; index: number | null; strength: SeriesStrength };

const sane = (index: number) => Number.isFinite(index) && index >= 0 && index < 1000;

/**
 * Words that number a book without naming its series. "The Final Empire
 * (Book 1)" used to be book 1 of a series called "Book", and every title
 * ending "(Book 2)" or "(Volume 2)" joined it.
 */
const NOT_A_SERIES = new Set(["book", "bk", "vol", "volume", "part", "pt", "no", "number", "issue", "edition", "ed", "version", "chapter", "season", "episode"]);
const named = (name: string) => !NOT_A_SERIES.has(name.trim().toLowerCase().replace(/[.#]+$/, ""));

/** What the title says about its series, if anything. */
export const seriesFromTitle = (title: string): Guess | null => {
  let match = BRACKETED.exec(title);
  if (match && sane(toNumber(match[2])) && named(match[1])) {
    return { name: match[1].trim(), index: toNumber(match[2]), strength: "strong" };
  }
  match = BOOK_OF.exec(title);
  if (match && sane(toNumber(match[1]))) {
    return { name: match[2].trim(), index: toNumber(match[1]), strength: "strong" };
  }
  match = KEYWORD_PREFIX.exec(title);
  if (match && sane(toNumber(match[2]))) {
    return { name: match[1].trim(), index: toNumber(match[2]), strength: "strong" };
  }
  match = BARE_PREFIX.exec(title);
  if (match) {
    return { name: match[1].trim(), index: Number(match[2]), strength: "weak" };
  }
  match = A_NOVEL.exec(title);
  if (match) {
    return { name: match[1].trim(), index: null, strength: "weak" };
  }
  return null;
};

/** A well-known series this book is in, by its title and author. */
export const knownSeriesFor = (title: string, author: string | null | undefined): Guess | null => {
  const keys = titleKeys(title);
  const surname = authorKey(author);
  for (const known of KNOWN_SERIES) {
    if (surname ? !known.authors.includes(surname) : false) {
      continue;
    }
    const position = knownPosition(known, keys);
    // With no author, only a title long enough to be unmistakable matches:
    // "Eclipse" alone is not Twilight.
    if (position !== null && (surname || keys[0].split(" ").length >= 3)) {
      return { name: known.name, index: position, strength: "strong" };
    }
  }
  return null;
};

const knownTitleKeys = new Map<KnownSeries, string[][]>();
const keysOfKnown = (known: KnownSeries) => {
  let keys = knownTitleKeys.get(known);
  if (!keys) {
    keys = known.books.map((entry) => (Array.isArray(entry) ? entry : [entry]).map(normalizeTitle));
    knownTitleKeys.set(known, keys);
  }
  return keys;
};

/** A title's number in a known series (1-based), or `null`. */
const knownPosition = (known: KnownSeries, keys: string[]): number | null => {
  const books = keysOfKnown(known);
  for (let position = 0; position < books.length; position += 1) {
    if (books[position].some((title) => keys.includes(title))) {
      return position + 1;
    }
  }
  return null;
};

/** The shared start of titles by one author: before a colon, or before " and the ". */
const PREFIX_STOP = new Set(["complete", "collected", "selected", "best", "stories", "short stories", "novel", "book", "volume", "part", "works"]);
const titlePrefixes = (title: string): string[] => {
  const base = stripBrackets(title);
  const out: string[] = [];
  const colon = base.indexOf(":");
  if (colon > 0) {
    out.push(base.slice(0, colon).trim());
  }
  const joined = /^(.+?)\s+(?:and|&)\s+the\s+/i.exec(base);
  if (joined && joined[1].trim().split(/\s+/).length >= 2) {
    out.push(joined[1].trim());
  }
  return out.filter((prefix) => {
    const key = normalizeTitle(prefix);
    return key.length >= 4 && !PREFIX_STOP.has(key) && !/^(complete|collected|selected|the best)\b/.test(key);
  });
};

// ---- grouping -------------------------------------------------------------------------

/** One book's best guess, or "none" when the reader said it is in no series. */
export const guessSeries = (book: Book): Guess | "none" | null => {
  if (book.series === "") {
    return "none";
  }
  if (book.series) {
    return { name: book.series, index: book.seriesIndex ?? null, strength: "stated" };
  }
  const fromTitle = seriesFromTitle(book.title);
  if (fromTitle?.strength === "strong") {
    return fromTitle;
  }
  return knownSeriesFor(book.title, book.author) ?? fromTitle;
};

const mostCommon = <T,>(values: T[]): T | null => {
  const counts = new Map<T, number>();
  let best: T | null = null;
  let bestCount = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
};

type Draft = { names: string[]; members: Array<SeriesMember & { strength: SeriesStrength }> };

export const buildSeries = (books: Book[]): LibrarySeries => {
  const drafts = new Map<string, Draft>();
  const add = (key: string, name: string, member: SeriesMember, strength: SeriesStrength) => {
    if (!key) {
      return;
    }
    const draft = drafts.get(key) ?? { names: [], members: [] };
    draft.names.push(name);
    draft.members.push({ ...member, strength });
    drafts.set(key, draft);
  };

  const unplaced: Book[] = [];
  for (const book of books) {
    const guess = guessSeries(book);
    if (guess === "none") {
      continue;
    }
    if (!guess) {
      unplaced.push(book);
      continue;
    }
    add(seriesKey(guess.name), guess.name, { book, index: guess.index }, guess.strength);
  }

  // Two or more books by one author sharing the start of their titles.
  const byAuthor = new Map<string, Book[]>();
  for (const book of unplaced) {
    const surname = authorKey(book.author);
    if (surname) {
      byAuthor.set(surname, [...(byAuthor.get(surname) ?? []), book]);
    }
  }
  for (const authored of byAuthor.values()) {
    if (authored.length < 2) {
      continue;
    }
    const prefixed = new Map<string, { name: string; books: Book[] }>();
    for (const book of authored) {
      for (const prefix of titlePrefixes(book.title)) {
        const key = seriesKey(prefix);
        const entry = prefixed.get(key) ?? { name: prefix, books: [] };
        entry.books.push(book);
        prefixed.set(key, entry);
      }
    }
    const placed = new Set<string>();
    // The prefix most books share first, so a book joins its biggest group.
    for (const [key, entry] of [...prefixed.entries()].sort((a, b) => b[1].books.length - a[1].books.length)) {
      const members = entry.books.filter((book) => !placed.has(book.id));
      if (members.length < 2) {
        continue;
      }
      for (const book of members) {
        placed.add(book.id);
        add(key, entry.name, { book, index: null }, "weak");
      }
    }
  }

  const groups: SeriesGroup[] = [];
  const byBook = new Map<string, SeriesInfo>();
  for (const [key, draft] of drafts) {
    const known = KNOWN_BY_KEY.get(key) ?? null;
    const alone = draft.members.length < 2;
    if (alone && draft.members[0].strength === "weak") {
      continue;
    }
    const members: SeriesMember[] = draft.members.map(({ book, index }) => ({
      book,
      // A well-known series numbers the books that did not say.
      index: index ?? (known ? knownPosition(known, titleKeys(book.title)) : null)
    }));
    members.sort(
      (a, b) =>
        (a.index ?? Number.POSITIVE_INFINITY) - (b.index ?? Number.POSITIVE_INFINITY) ||
        a.book.title.localeCompare(b.book.title)
    );
    const name = known?.name ?? mostCommon(draft.names) ?? key;
    for (const member of members) {
      byBook.set(member.book.id, { key, name, index: member.index });
    }
    if (alone) {
      continue;
    }

    // Two copies of one book (an EPUB and a PDF) are one book here.
    const slot = (member: SeriesMember) => (member.index === null ? `id:${member.book.id}` : `n:${member.index}`);
    const finishedSlots = new Set(members.filter((member) => isFinished(member.book.progress)).map(slot));
    const ownedSlots = new Set(members.map(slot));
    // Two copies of one book are not a series (they are on the duplicates shelf).
    if (ownedSlots.size < 2) {
      continue;
    }
    const nextIndex = members.findIndex((member) => !finishedSlots.has(slot(member)));
    const next = nextIndex >= 0 ? members[nextIndex].book : null;

    const owned = new Set(members.map((member) => member.index).filter((index): index is number => index !== null));
    let missing: SeriesGroup["missing"] = [];
    if (known) {
      missing = known.books
        .map((entry, position) => ({ index: position + 1, title: Array.isArray(entry) ? entry[0] : entry }))
        .filter((entry) => !owned.has(entry.index));
    } else if (owned.size >= 2) {
      const whole = [...owned].filter(Number.isInteger);
      const highest = Math.max(...whole);
      if (whole.length >= 2 && highest <= 60) {
        for (let index = 1; index < highest; index += 1) {
          if (!owned.has(index)) {
            missing.push({ index, title: null });
          }
        }
      }
    }

    // What comes after the last finished book, if the library does not have it.
    const finishedIndices = members
      .filter((member) => member.index !== null && isFinished(member.book.progress))
      .map((member) => member.index as number);
    const nextIndexNumber = nextIndex >= 0 ? members[nextIndex].index : null;
    const missingNext =
      finishedIndices.length > 0 && (next === null || (next.progress ?? 0) === 0)
        ? missing.find(
            (entry) => entry.index > Math.max(...finishedIndices) && (nextIndexNumber === null || entry.index < nextIndexNumber)
          ) ?? null
        : null;

    groups.push({
      key,
      name,
      author: mostCommon(members.map((member) => member.book.author).filter((author): author is string => Boolean(author))),
      members,
      total: known ? known.books.length : null,
      missing,
      finishedCount: finishedSlots.size,
      ownedCount: ownedSlots.size,
      next,
      upNext:
        missingNext === null &&
        next !== null &&
        (next.progress ?? 0) === 0 &&
        members.slice(0, nextIndex).some((member) => isFinished(member.book.progress)),
      missingNext
    });
  }

  // Series being read first, then untouched ones, then finished ones; by name within each.
  groups.sort((a, b) => {
    const active = (group: SeriesGroup) =>
      group.next === null
        ? 2
        : group.members.some((member) => (member.book.progress ?? 0) > 0)
          ? 0
          : 1;
    return active(a) - active(b) || a.name.localeCompare(b.name);
  });
  return { groups, byBook };
};

/** "Book 3", "Book 2.5", or nothing. */
export const seriesNumberLabel = (index: number | null) => (index === null ? null : `Book ${Number(index.toFixed(2))}`);

let cached: { books: Book[]; result: LibrarySeries } | null = null;

/** `buildSeries`, worked out once per library change and shared by every card. */
export const librarySeries = (books: Book[]): LibrarySeries => {
  if (cached?.books !== books) {
    cached = { books, result: buildSeries(books) };
  }
  return cached.result;
};
