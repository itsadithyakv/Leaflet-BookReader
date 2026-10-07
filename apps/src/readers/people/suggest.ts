/**
 * "People so far": the names the book itself keeps using, offered as
 * one-tap additions. A suggestion is only ever a name and how often it has
 * appeared; and only text up to the place being read is ever counted
 * (`bookText.ts` hands in nothing later).
 *
 * The rule for what a name is, is SpeedRead's (`rsvpHold.ts` `findNames`): a
 * word capitalised in the middle of a sentence and never written small. It is
 * counted here a chapter at a time, so a long book does not hold the page up,
 * and then thinned: places, things and ideas are capitalised too.
 *
 * Pure: text in, names out.
 */
import { nameKey } from "./model";
import type { NameEntry } from "./names";

export type NameSuggestion = { name: string; count: number };

/** Words before a name that go with it: "Lord Renoux" is offered whole. */
export const TITLES = new Set(
  "lord lady ser sir dame king queen prince princess duke duchess count countess baron baroness master mistress maester captain commander general colonel major sergeant lieutenant admiral doctor dr mr mrs ms miss father mother brother sister uncle aunt saint".split(
    " "
  )
);

/** Capitalised mid-sentence, and not people. */
export const NOT_NAMES = new Set(
  "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december god gods lord lady sir madam majesty highness grace english french german spanish latin greek roman christmas easter chapter book part prologue epilogue north south east west mr mrs ms miss dr".split(
    " "
  )
);

/** Words that put what follows somewhere: a name mostly after these is a place. */
export const PLACING = new Set("in at from into near through across toward towards outside inside beyond leaving entering".split(" "));

/** "The Ministry", "a Mistborn": a thing or a kind, not someone (unless a title goes with it: "the Lord Ruler"). */
export const ARTICLES = new Set(["the", "a", "an"]);

/**
 * What people do in a book, right after their name: "Sazed said", "Vin
 * nodded". A place or an idea is not written of this way. English only;
 * a book with none of it at all (another language) is not held to it.
 */
export const ACTS = new Set(
  "said says asked replied answered whispered muttered murmured shouted called cried added continued snapped growled sighed laughed nodded smiled grinned frowned shrugged thought wondered looked glanced turned paused stood sat walked stepped shook raised knew felt saw heard wanted".split(
    " "
  )
);

const WORD = /[\p{L}][\p{L}’'-]*/gu;
/** What an apostrophe adds to a word: "Vin's", "I've", "he'd". */
const ADDED = /[’'](?:s|d|m|t|ll|ve|re)$/iu;
/** The word as counted: small, and without what an apostrophe adds. */
const key = (word: string) =>
  word
    .toLocaleLowerCase()
    .replace(ADDED, "")
    .replace(/[^\p{L}]/gu, "");
const bare = (word: string) => word.replace(ADDED, "").replace(/[’'-]+$/u, "");
const startsUpper = (word: string) => /^\p{Lu}/u.test(word);
const allCapitals = (word: string) => word.length > 1 && word === word.toLocaleUpperCase();

type Seen = {
  /** How it is written, most often. */
  forms: Map<string, number>;
  count: number;
  /** Capitalised in the middle of a sentence. */
  mid: number;
  /** Straight after a word that places things ("in Luthadel"). */
  placed: number;
  /** Straight after "the", "a" or "an". */
  article: number;
  /** Beside a word for what people do ("said", "nodded"). */
  acts: number;
  /** Straight after a title, and which. */
  titled: Map<string, number>;
};

export type NameCounter = {
  /** Counts a stretch of the book's text (a chapter, or the part of one read so far). */
  add: (text: string) => void;
  /** The names so far, most used first, less the ones already on the sheet. */
  result: (known: NameEntry[], limit?: number) => NameSuggestion[];
};

export const nameCounter = (isCommon: (key: string) => boolean): NameCounter => {
  const seen = new Map<string, Seen>();
  const lowerCase = new Set<string>();

  return {
    add: (text) => {
      let previous: { word: string; end: number; name: Seen | null } | null = null;
      for (const match of text.matchAll(WORD)) {
        const word = match[0];
        const at = match.index;
        const k = key(word);
        const between = previous ? text.slice(previous.end, at) : "";
        const before = previous?.word ?? "";
        // Only spaces since the last word: the two go together.
        const joined = /^[ \t]+$/.test(between);
        // Nothing since the last word that ends a sentence or opens speech.
        const midSentence = Boolean(before) && !/[.!?…:;\n“‘"([]/u.test(between);
        // "Vin nodded": the word after a name says something about it.
        if (previous?.name && joined && ACTS.has(word.toLocaleLowerCase())) {
          previous.name.acts += 1;
        }
        previous = { word, end: at + word.length, name: null };
        if (k.length < 3 || isCommon(k)) {
          continue;
        }
        if (!startsUpper(word)) {
          lowerCase.add(k);
          continue;
        }
        if (allCapitals(word)) {
          continue;
        }
        let entry = seen.get(k);
        if (!entry) {
          entry = { forms: new Map(), count: 0, mid: 0, placed: 0, article: 0, acts: 0, titled: new Map() };
          seen.set(k, entry);
        }
        previous.name = entry;
        entry.count += 1;
        const form = bare(word);
        entry.forms.set(form, (entry.forms.get(form) ?? 0) + 1);
        if (midSentence) {
          entry.mid += 1;
        }
        if (before && joined) {
          const led = before.toLocaleLowerCase();
          if (PLACING.has(led)) {
            entry.placed += 1;
          }
          if (ARTICLES.has(led)) {
            entry.article += 1;
          }
          if (TITLES.has(led) && startsUpper(before)) {
            entry.titled.set(before, (entry.titled.get(before) ?? 0) + 1);
          }
        }
      }
    },

    result: (known, limit = 24) => {
      const taken = new Set<string>();
      for (const name of known) {
        nameKey(name.text)
          .split(" ")
          .forEach((part) => taken.add(key(part)));
      }
      const written = [...seen.values()].some((entry) => entry.acts > 0);
      const out: NameSuggestion[] = [];
      for (const [k, entry] of seen) {
        if (entry.mid === 0 || entry.count < 3 || lowerCase.has(k) || taken.has(k) || NOT_NAMES.has(k) || TITLES.has(k)) {
          continue;
        }
        // Mostly "in X", "from X": somewhere, not someone.
        if (entry.placed * 2 > entry.count) {
          continue;
        }
        const form = [...entry.forms].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
        const title = [...entry.titled].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
        // Nearly always with its title: that is their name.
        const titled = Boolean(title && title[1] * 10 >= entry.count * 6);
        // Mostly "the X", "a X": a thing or a kind. Never said or did anything: not someone.
        if (!titled && (entry.article * 2 > entry.count || (written && entry.acts === 0))) {
          continue;
        }
        out.push({ name: titled ? `${title[0]} ${form}` : form, count: entry.count });
      }
      return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit);
    }
  };
};

/** The names in some texts, in one go (for a short book, and for tests). */
export const suggestNames = (
  texts: string[],
  known: NameEntry[],
  isCommon: (key: string) => boolean,
  limit?: number
): NameSuggestion[] => {
  const counter = nameCounter(isCommon);
  texts.forEach((text) => counter.add(text));
  return counter.result(known, limit);
};
