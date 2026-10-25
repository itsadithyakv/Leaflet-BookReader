import { invoke, isTauri } from "@tauri-apps/api/core";
import { cardsOf, reviewed, saved, type CardInput, type CardReview, type CardRow, type StudyCard } from "../study/cards";

/**
 * Study cards (docs/design/study-plan.md): kept in the database beside the
 * highlights and the words (and so in the backup and both syncs), one row a
 * card, so copies merge card by card.
 *
 * The browser preview has no database; it keeps them in its own storage so
 * cards can be made, revised (and tested) there.
 */
const PREVIEW_KEY = "leaflet.cards.preview";
const previewAll = (): CardRow[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREVIEW_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as CardRow[]) : [];
  } catch {
    return [];
  }
};
const previewWrite = (all: CardRow[]) => {
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(all));
  } catch {
    // The preview only.
  }
};

export const cardService = {
  /** Every card kept, the newest first. */
  async list(): Promise<StudyCard[]> {
    if (!isTauri()) {
      return cardsOf(previewAll());
    }
    return cardsOf(await invoke<CardRow[]>("cards_list"));
  },

  /** Makes cards, or edits them: all of them or none (a picture's boxes are saved together). */
  async save(cards: CardInput[]): Promise<StudyCard[]> {
    if (cards.length === 0) {
      return [];
    }
    if (!isTauri()) {
      const now = new Date().toISOString();
      const next = new Map(previewAll().map((row) => [row.id, row]));
      const rows = cards.map((card) => saved(next.get(card.id), card, now));
      rows.forEach((row) => next.set(row.id, row));
      previewWrite([...next.values()]);
      return cardsOf(rows);
    }
    return cardsOf(await invoke<CardRow[]>("cards_save", { cards }));
  },

  /** A review's answers: each card's new box and day. All of them or none. */
  async review(reviews: CardReview[]): Promise<void> {
    if (reviews.length === 0) {
      return;
    }
    if (!isTauri()) {
      const now = new Date().toISOString();
      const next = new Map(previewAll().map((row) => [row.id, row]));
      for (const review of reviews) {
        const row = next.get(review.id);
        if (!row) {
          throw new Error("That card is not kept.");
        }
        next.set(review.id, reviewed(row, review, now));
      }
      previewWrite([...next.values()]);
      return;
    }
    await invoke("cards_review", { reviews });
  },

  /** Removes cards: each is left as a tombstone (so the removal reaches the other copies), and can be put back. */
  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    if (!isTauri()) {
      const gone = new Set(ids);
      const now = new Date().toISOString();
      previewWrite(previewAll().map((row) => (gone.has(row.id) && !row.deletedAt ? { ...row, updatedAt: now, deletedAt: now } : row)));
      return;
    }
    await invoke("cards_delete", { ids });
  },

  /** The undo of `remove`: the cards come back as they were, the review's box included (`commands/cards.rs`). */
  async restore(ids: string[]): Promise<StudyCard[]> {
    if (ids.length === 0) {
      return [];
    }
    if (!isTauri()) {
      const back = new Set(ids);
      const now = new Date().toISOString();
      const all = previewAll().map((row) => (back.has(row.id) && row.deletedAt ? { ...row, updatedAt: now, deletedAt: null } : row));
      previewWrite(all);
      return cardsOf(all.filter((row) => back.has(row.id)));
    }
    return cardsOf(await invoke<CardRow[]>("cards_restore", { ids }));
  }
};
