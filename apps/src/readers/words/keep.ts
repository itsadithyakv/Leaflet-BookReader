/**
 * From a look-up to a word worth keeping: which word, and which short line
 * of what was shown stands as its meaning.
 *
 * Pure, but for `keepLookup` at the foot, which does the keeping.
 */
import type { LookupResult } from "../../services/lookupService";
import { wordService } from "../../services/wordService";
import { useLibraryStore } from "../../store/libraryStore";
import { MAX_MEANING, type SavedWord } from "./rows";
import { wordsSwitchOn } from "./wordPrefs";

/** Where in which book a word was looked up. */
export type LookupPlace = { bookId: string; cfi: string | null; chapter: string | null; progress: number };

export type Keepable = { word: string; meaning: string; part: string | null };

/** A summary's first sentence, for a page that has no few-word description. */
const firstSentence = (text: string) => {
  const clean = text.replace(/\s+/g, " ").trim();
  const end = clean.search(/[.!?](\s|$)/);
  return end >= 0 && end < 200 ? clean.slice(0, end + 1) : clean.slice(0, 200);
};

/**
 * What a look-up's answer leaves to keep, or null when it found nothing.
 *
 * - A meaning (Wiktionary): the word in its dictionary form and the first
 *   definition under it. "wandered" is kept as "wander", with what "wander"
 *   means, since "past tense of wander" teaches nothing.
 * - A summary (Wikipedia), when that is what the card led with or all there
 *   was: the page's name and its few-word description, or its first sentence.
 *   A name several pages share has no one meaning and is not kept.
 */
export const keepable = (result: LookupResult): Keepable | null => {
  const summary = result.summary && !result.summary.ambiguous ? result.summary : null;
  const about = summary ? (summary.description ?? "").trim() || firstSentence(summary.extract) : "";
  const fromSummary: Keepable | null = summary && about ? { word: summary.title, meaning: about.slice(0, MAX_MEANING), part: null } : null;

  const meaning = result.meaning;
  const source = meaning ? (meaning.root && meaning.root.entries.length > 0 ? meaning.root : meaning) : null;
  const entry = source?.entries.find((candidate) => candidate.definitions.some((definition) => definition.trim()));
  const definition = entry?.definitions.find((line) => line.trim());
  const fromMeaning: Keepable | null =
    source && entry && definition
      ? { word: source.word, meaning: definition.trim().slice(0, MAX_MEANING), part: entry.partOfSpeech.trim().toLowerCase() || null }
      : null;

  return result.lead === "summary" ? fromSummary ?? fromMeaning : fromMeaning ?? fromSummary;
};

/**
 * Keeps what a look-up found, if the reader keeps their words (the switch in
 * Settings) and there is a book to keep it against. Resolves with the word as
 * kept, or null when nothing was. Never rejects: a word not kept is no reason
 * to trouble a reader who only wanted its meaning.
 */
export const keepLookup = async (result: LookupResult, language: string | null | undefined, place: LookupPlace | null | undefined): Promise<SavedWord | null> => {
  const found = keepable(result);
  if (!found || !place || !wordsSwitchOn()) {
    return null;
  }
  try {
    const saved = await wordService.record({
      ...found,
      language,
      bookId: place.bookId,
      cfi: place.cfi,
      chapter: place.chapter,
      p: Math.min(1, Math.max(0, Number.isFinite(place.progress) ? place.progress : 0))
    });
    // Like a highlight: something to back up.
    useLibraryStore.getState().requestBackup();
    return saved;
  } catch {
    return null;
  }
};
