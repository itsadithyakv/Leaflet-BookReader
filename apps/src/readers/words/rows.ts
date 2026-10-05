/**
 * Words the reader looked up, as the database keeps them: rows of the
 * annotations table under a kind of their own, `word` (see
 * `commands/words.rs` for why, and for the rules a row is written by).
 *
 * A row's `note` is the word, `cfi` and `chapter` the place it was last
 * looked up at, and `text` a small JSON object with the rest. This file is
 * the only one in the app that knows that shape; everything else works with
 * `SavedWord`.
 *
 * Pure: no storage, no clock.
 */

export const WORD_KIND = "word";

export type WordRow = {
  id: string;
  bookId: string;
  kind: string;
  cfi?: string | null;
  text?: string | null;
  note?: string | null;
  chapter?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

/** What a look-up hands over to be kept: the word, what it means, and where. */
export type WordInput = {
  word: string;
  /** The book's language ("en", "fr-FR"); English when it has none. */
  language?: string | null;
  meaning: string;
  /** Its part of speech, when the answer had one. */
  part?: string | null;
  bookId: string;
  cfi?: string | null;
  chapter?: string | null;
  /** How far through the book, 0..1. */
  p: number;
};

export type SavedWord = {
  id: string;
  word: string;
  /** The short meaning that was shown. */
  meaning: string;
  language: string;
  part: string | null;
  /** The book and the place it was last looked up at. */
  bookId: string;
  at: { p: number; cfi: string | null; chapter: string | null };
  /** How many times it has been looked up. */
  count: number;
  /** When it last was, and when it first was. */
  lookedUpAt: string;
  createdAt: string;
  /** The quiz: the box it is in (0 is the first) and the day it is next due; null until it has been asked. */
  box: number;
  due: number | null;
};

/** A quiz answer: the box a word moves to and the day (a count of days) it is next due. */
export type WordReview = { id: string; box: number; due: number };

export const MAX_WORD = 80;
export const MAX_MEANING = 300;
export const MAX_BOX = 5;
const MAX_DAY = 60_000;

/** Whether a row is a word at all (and not a highlight, a bookmark or a character). */
export const isWordRow = (row: { kind: string }) => row.kind === WORD_KIND;

const tidy = (text: string | null | undefined) => (text ?? "").split(/\s+/).filter(Boolean).join(" ");

/** The language as the look-up reads it: the tag's first part ("en-US" and "en" are one). */
export const languageKey = (language?: string | null) =>
  (language ?? "")
    .trim()
    .split(/[-_]/)[0]
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 8)
    .toLowerCase() || "en";

/** The one row a word has: by its language and the word itself, case aside. */
export const wordId = (word: string, language?: string | null) => `word:${languageKey(language)}:${tidy(word).toLowerCase()}`;

const detailOf = (row: WordRow): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(row.text ?? "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const whole = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;

/**
 * The word a row holds, or null for one that cannot be read (another kind of
 * annotation, a row with no word or no meaning): it is left out rather than
 * guessed at.
 */
export const fromRow = (row: WordRow): SavedWord | null => {
  if (!isWordRow(row) || !row.id || !row.bookId) {
    return null;
  }
  const detail = detailOf(row);
  const word = tidy(row.note);
  const meaning = detail && typeof detail.m === "string" ? tidy(detail.m) : "";
  if (!detail || !word || !meaning) {
    return null;
  }
  const p = typeof detail.p === "number" && Number.isFinite(detail.p) ? Math.min(1, Math.max(0, detail.p)) : 0;
  return {
    id: row.id,
    word,
    meaning,
    language: typeof detail.l === "string" && detail.l ? detail.l : "en",
    part: typeof detail.pos === "string" && detail.pos ? detail.pos : null,
    bookId: row.bookId,
    at: { p, cfi: row.cfi?.trim() ? row.cfi : null, chapter: tidy(row.chapter) || null },
    count: whole(detail.n, 1, Number.MAX_SAFE_INTEGER) ?? 1,
    lookedUpAt: typeof detail.at === "string" && detail.at ? detail.at : row.updatedAt,
    createdAt: row.createdAt,
    box: whole(detail.b, 0, MAX_BOX) ?? 0,
    due: whole(detail.d, 0, MAX_DAY)
  };
};

/** The words in a list of rows, removed and unreadable ones left out, the most recently looked up first. */
export const wordsOf = (rows: WordRow[]): SavedWord[] =>
  rows
    .filter((row) => !row.deletedAt)
    .map(fromRow)
    .filter((word): word is SavedWord => word !== null)
    .sort((a, b) => b.lookedUpAt.localeCompare(a.lookedUpAt) || a.id.localeCompare(b.id));

/**
 * The row a look-up leaves, by the rules of `commands/words.rs` (the browser
 * preview, which has no backend, keeps its words with this). The first time
 * it is the word's row; after that the look-up is counted and the row moves
 * to the new place and the meaning now shown, the quiz's box staying as it
 * was. A word that was removed starts afresh. Throws for what is refused.
 */
export const recorded = (existing: WordRow | null | undefined, input: WordInput, now: string): WordRow => {
  const word = tidy(input.word);
  if (!word || [...word].length > MAX_WORD) {
    throw new Error("That is not a word to keep.");
  }
  const meaning = [...tidy(input.meaning)].slice(0, MAX_MEANING).join("");
  if (!meaning) {
    throw new Error("A word is kept with its meaning.");
  }
  if (!input.bookId.trim()) {
    throw new Error("A word is kept with the book it was looked up in.");
  }
  if (!(input.p >= 0 && input.p <= 1)) {
    throw new Error("A word's place is not in the book.");
  }
  if (existing && !isWordRow(existing)) {
    throw new Error("That id belongs to something else.");
  }
  const known = existing && !existing.deletedAt ? existing : null;
  const detail: Record<string, unknown> = { ...(known ? detailOf(known) ?? {} : {}) };
  detail.p = Math.round(input.p * 1e6) / 1e6;
  detail.m = meaning;
  detail.n = (whole(detail.n, 0, Number.MAX_SAFE_INTEGER) ?? 0) + 1;
  detail.at = now;
  detail.l = languageKey(input.language);
  const part = tidy(input.part).toLowerCase().slice(0, 40);
  if (part) {
    detail.pos = part;
  } else {
    delete detail.pos;
  }
  return {
    id: wordId(word, input.language),
    bookId: input.bookId,
    kind: WORD_KIND,
    cfi: input.cfi?.trim() ? input.cfi : "",
    text: JSON.stringify(detail),
    note: word,
    chapter: tidy(input.chapter).slice(0, 300) || null,
    createdAt: known?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null
  };
};

/** A word's row after a quiz answer: its box and its day, the rest as it was. Throws for what is refused. */
export const reviewed = (row: WordRow, review: WordReview, now: string): WordRow => {
  if (!isWordRow(row) || row.deletedAt) {
    throw new Error("That word is not kept.");
  }
  if (whole(review.box, 0, MAX_BOX) === null || whole(review.due, 0, MAX_DAY) === null) {
    throw new Error("That is not a box a word can be in.");
  }
  return { ...row, text: JSON.stringify({ ...(detailOf(row) ?? {}), b: review.box, d: review.due }), updatedAt: now };
};
