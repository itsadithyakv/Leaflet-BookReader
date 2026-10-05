import { invoke, isTauri } from "@tauri-apps/api/core";
import { recorded, reviewed, wordId, wordsOf, fromRow, type SavedWord, type WordInput, type WordReview, type WordRow } from "../readers/words/rows";

/**
 * The words the reader looked up: each with the meaning that was shown, the
 * book and the place. Kept in the database beside the highlights (and so in
 * the backup), one row a word, so copies merge word by word.
 *
 * The browser preview has no database; it keeps them in its own storage so
 * the look-up, "My words" and the quiz can be tried (and tested) there.
 */
const PREVIEW_KEY = "leaflet.words.preview";
const previewAll = (): WordRow[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREVIEW_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as WordRow[]) : [];
  } catch {
    return [];
  }
};
const previewWrite = (all: WordRow[]) => {
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(all));
  } catch {
    // The preview only.
  }
};

export const wordService = {
  /** Every word kept, the most recently looked up first. */
  async list(): Promise<SavedWord[]> {
    if (!isTauri()) {
      return wordsOf(previewAll());
    }
    return wordsOf(await invoke<WordRow[]>("words_list"));
  },

  /** Keeps a word that was looked up, or counts another look-up of one already kept. */
  async record(input: WordInput): Promise<SavedWord | null> {
    if (!isTauri()) {
      const all = previewAll();
      const id = wordId(input.word, input.language);
      const row = recorded(all.find((entry) => entry.id === id), input, new Date().toISOString());
      previewWrite([...all.filter((entry) => entry.id !== id), row]);
      return fromRow(row);
    }
    return fromRow(await invoke<WordRow>("word_record", { input }));
  },

  /** The quiz's answers: each word's new box and day. All of them or none. */
  async review(reviews: WordReview[]): Promise<void> {
    if (reviews.length === 0) {
      return;
    }
    if (!isTauri()) {
      const now = new Date().toISOString();
      const all = previewAll();
      const next = new Map(all.map((row) => [row.id, row]));
      for (const review of reviews) {
        const row = next.get(review.id);
        if (!row) {
          throw new Error("That word is not kept.");
        }
        next.set(review.id, reviewed(row, review, now));
      }
      previewWrite([...next.values()]);
      return;
    }
    await invoke("words_review", { reviews });
  },

  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    if (!isTauri()) {
      const gone = new Set(ids);
      previewWrite(previewAll().filter((row) => !gone.has(row.id)));
      return;
    }
    await invoke("words_delete", { ids });
  }
};
