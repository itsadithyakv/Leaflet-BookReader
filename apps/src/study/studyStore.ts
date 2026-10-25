import { create } from "zustand";
import type { SavedWord } from "../readers/words/rows";
import { cardService } from "../services/cardService";
import { wordService } from "../services/wordService";
import type { PictureRef, StudyCard } from "./cards";
import type { ReviseScope } from "./round";

/**
 * Study cards' and the word quiz's state that the rest of the app needs
 * without loading either: what is kept (for the Library's "Revise · 12 due"
 * and a book's menu), whether Revise is open and on what, and a card being
 * made in the reader. The overlays themselves load on demand
 * (components/pip/arcade/quiz/ReviseWords.tsx, study/CardMaker.tsx,
 * study/PictureCardMaker.tsx).
 */

/** What Revise is showing: a round to choose (and on what), or one book's cards. */
export type StudyView = { page: "revise"; scope?: ReviseScope } | { page: "cards"; bookId: string };

/** A highlight to make a card of, as the reader has it. */
export type HighlightSource = { id: string; text: string; note: string | null; cfi: string; chapter: string | null };

/** A card being made in the reader: from a highlight, or from a picture (an EPUB's, or a PDF's page). */
export type MakeRequest =
  | { from: "highlight"; bookId: string; p: number; highlight: HighlightSource; kind?: "fill" | "ask" }
  | {
      from: "picture";
      bookId: string;
      picture: PictureRef;
      /** What to draw on: the page's own copy of the picture, or a PDF page drawn for this. */
      src: string;
      /** The maker lets go of `src` when it closes (a PDF page drawn for it). */
      ownsSrc?: boolean;
      alt: string;
      at: { cfi: string | null; chapter: string | null; p: number };
    };

type StudyState = {
  view: StudyView | null;
  /** What is kept, or null until it has been read. */
  words: SavedWord[] | null;
  cards: StudyCard[] | null;
  making: MakeRequest | null;
};

export const useStudyStore = create<StudyState>(() => ({ view: null, words: null, cards: null, making: null }));

/** Reads the cards again (after a change made somewhere that does not hold the list). */
export const loadCards = () =>
  cardService.list().then(
    (cards) => {
      useStudyStore.setState({ cards });
      return cards;
    },
    () => useStudyStore.getState().cards ?? []
  );

export const loadWords = () =>
  wordService.list().then(
    (words) => {
      useStudyStore.setState({ words });
      return words;
    },
    () => useStudyStore.getState().words ?? []
  );

export const setStudyCards = (cards: StudyCard[]) => useStudyStore.setState({ cards });
export const setStudyWords = (words: SavedWord[]) => useStudyStore.setState({ words });

/** Opens Revise (the Library's key), on a round to choose or one already chosen. */
export const openRevise = (scope?: ReviseScope) => useStudyStore.setState({ view: { page: "revise", scope } });
/** Opens a book's cards (its menu, its highlights). */
export const openBookCards = (bookId: string) => useStudyStore.setState({ view: { page: "cards", bookId } });
export const closeStudy = () => useStudyStore.setState({ view: null });

/** "Make a card", in the reader. */
export const makeCard = (request: MakeRequest) => useStudyStore.setState({ making: request });
export const closeCardMaker = () => useStudyStore.setState({ making: null });

/** How many cards a book has, for its menu; 0 until they have been read. */
export const cardCount = (cards: StudyCard[] | null, bookId: string) => (cards ?? []).filter((card) => card.bookId === bookId).length;
