import { invoke, isTauri } from "@tauri-apps/api/core";

/** A part of speech and its first few definitions. Plain text, never HTML. */
export type LookupEntry = { partOfSpeech: string; definitions: string[] };

/** The word a form points at ("houses" is the plural of "house"), with its own meaning. */
export type LookupRoot = { word: string; entries: LookupEntry[]; url: string };

export type LookupMeaning = {
  /** The form that was found, which may differ from the selection ("Serendipity" finds "serendipity"). */
  word: string;
  /** The language the word is in, as Wiktionary names it ("English"). */
  language: string;
  entries: LookupEntry[];
  url: string;
  root: LookupRoot | null;
};

export type LookupSummary = {
  title: string;
  /** A few words on what it is. */
  description: string | null;
  /** Empty when `ambiguous`. */
  extract: string;
  url: string;
  /** Several pages share the name; there is only the link to offer. */
  ambiguous: boolean;
};

export type LookupSource = "wiktionary" | "wikipedia";

/** What was found. Finding nothing is an answer: both sides are then null. */
export type LookupResult = {
  term: string;
  meaning: LookupMeaning | null;
  summary: LookupSummary | null;
  /** Which of the two to show first. */
  lead: "meaning" | "summary";
  /** A source that could not be reached while the other answered. */
  missed: LookupSource[];
  /** A canned answer from the browser preview, which has no backend. */
  sample?: boolean;
};

/**
 * Why nothing could be looked up: the selection is empty or too long
 * (`refused`, nothing was sent), neither source could be reached (`offline`),
 * or they answered with something unusable (`unavailable`).
 */
export type LookupFailureKind = "refused" | "offline" | "unavailable";

export class LookupFailure extends Error {
  readonly kind: LookupFailureKind;

  constructor(kind: LookupFailureKind, message: string) {
    super(message);
    this.name = "LookupFailure";
    this.kind = kind;
  }
}

export const LOOKUP_REFUSAL = "Select a word or a short phrase";

/** A selection longer than this is a passage, not something to look up (as in lookup/mod.rs). */
const MAX_WORDS = 6;
const MAX_CHARS = 80;

/**
 * The selection as a term: one space between words, and without the quotation
 * marks, comma or full stop a selection picks up at its ends. Null when there
 * is nothing to look up or too much. The backend applies the same rule; doing
 * it here too means a refusal costs no call and the cache has one key per term.
 */
export const lookupTerm = (selection: string): string | null => {
  const term = selection
    .replace(/[’ʼ‘]/g, "'")
    .replace(/[­​‎‏﻿]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!term || term.split(" ").length > MAX_WORDS || [...term].length > MAX_CHARS) {
    return null;
  }
  return term;
};

/**
 * A web search for the term, for when neither source has it. DuckDuckGo: it
 * needs no account and keeps no search history.
 */
export const webSearchUrl = (term: string) => `https://duckduckgo.com/?q=${encodeURIComponent(term)}`;

/** What Tauri rejects with (the backend's `{ kind, message }`), or anything else, as a failure. */
const toFailure = (cause: unknown): LookupFailure => {
  if (cause instanceof LookupFailure) {
    return cause;
  }
  if (cause && typeof cause === "object") {
    const { kind, message } = cause as { kind?: unknown; message?: unknown };
    if ((kind === "refused" || kind === "offline" || kind === "unavailable") && typeof message === "string") {
      return new LookupFailure(kind, message);
    }
  }
  return new LookupFailure("unavailable", "The lookup didn't work. Try again in a moment.");
};

/** The language as the backend reads it: the tag's first part ("en-US" and "en" are one). */
const languageKey = (language?: string | null) => (language ?? "").trim().toLowerCase().split(/[-_]/)[0];

/**
 * Answers already given this session, so looking the same word up again (or
 * closing the card and reopening it) costs no request. In memory only: what a
 * reader looked up is not written anywhere.
 */
const CACHE_LIMIT = 60;
const cache = new Map<string, Promise<LookupResult>>();

const remember = (key: string, answer: Promise<LookupResult>) => {
  cache.delete(key);
  cache.set(key, answer);
  // A Map keeps the order things were put in: the first is the oldest.
  while (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value as string);
  }
};

/**
 * The browser preview has no backend, and its own requests to Wikimedia would
 * not say what the app's do. It answers with a sample, labelled as one, so the
 * card can be tried there. A few terms stand for the other outcomes:
 * "nothing", "offline", "ambiguous" and "plural".
 */
const sample = async (term: string): Promise<LookupResult> => {
  await new Promise((resolve) => window.setTimeout(resolve, 350));
  const key = term.toLowerCase();
  if (key === "offline") {
    throw new LookupFailure("offline", "Couldn't reach Wiktionary or Wikipedia. Check your connection and try again.");
  }
  const page = encodeURIComponent(term.replace(/ /g, "_"));
  const base: LookupResult = { term, meaning: null, summary: null, lead: "meaning", missed: [], sample: true };
  if (key === "nothing") {
    return base;
  }
  const meaning: LookupMeaning = {
    word: term.toLowerCase(),
    language: "English",
    entries: [
      {
        partOfSpeech: "Noun",
        definitions: [
          "A sample definition, standing in for the first sense Wiktionary would give.",
          "A second sense, so the numbering can be seen.",
          "A third, which is as many as each part of speech shows."
        ]
      },
      { partOfSpeech: "Verb", definitions: ["To stand in for a real definition in the browser preview."] }
    ],
    url: `https://en.wiktionary.org/wiki/${page}#English`,
    root:
      key === "plural"
        ? {
            word: "singular",
            entries: [{ partOfSpeech: "Noun", definitions: ["The word this one is a form of, with a meaning of its own."] }],
            url: "https://en.wiktionary.org/wiki/singular#English"
          }
        : null
  };
  const summary: LookupSummary =
    key === "ambiguous"
      ? { title: term, description: null, extract: "", url: `https://en.wikipedia.org/wiki/${page}`, ambiguous: true }
      : {
          title: term,
          description: "Sample summary",
          extract:
            "A sample summary, standing in for the opening paragraph of the Wikipedia page of this name. The browser preview has no backend, so nothing was looked up and nothing was sent anywhere. In the app, this is where a few sentences about the person, place or idea appear.",
          url: `https://en.wikipedia.org/wiki/${page}`,
          ambiguous: false
        };
  const about = term.includes(" ") || /^\p{Lu}/u.test(term);
  return { ...base, meaning, summary, lead: about && !summary.ambiguous ? "summary" : "meaning" };
};

export const lookupService = {
  /**
   * The meaning (Wiktionary) and a summary (Wikipedia) of the selected word or
   * phrase, in the book's language where there is one. Sends the term and
   * nothing else. Rejects with a `LookupFailure`.
   */
  async lookUp(selection: string, language?: string | null): Promise<LookupResult> {
    const term = lookupTerm(selection);
    if (!term) {
      throw new LookupFailure("refused", LOOKUP_REFUSAL);
    }
    const key = `${languageKey(language)}\n${term}`;
    const known = cache.get(key);
    if (known) {
      remember(key, known);
      return known;
    }
    const answer = (
      isTauri() ? invoke<LookupResult>("lookup_term", { term, language: language ?? null }) : sample(term)
    ).catch((cause) => {
      throw toFailure(cause);
    });
    remember(key, answer);
    // Only a whole answer is kept: a failure, or one with a source missing, is asked again.
    answer.then(
      (result) => {
        if (result.missed.length > 0 && cache.get(key) === answer) {
          cache.delete(key);
        }
      },
      () => {
        if (cache.get(key) === answer) {
          cache.delete(key);
        }
      }
    );
    return answer;
  },

  /** Forgets every answer (for tests). */
  forget() {
    cache.clear();
  }
};
