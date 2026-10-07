import { create } from "zustand";
import type { Quote } from "./quoteCard";

/**
 * What the reader has asked to make a picture of: a highlighted passage
 * (`QuoteCardDialog`) or their year of reading (`YearReviewDialog`). Kept
 * apart from the dialogs so a reader's card or a page can ask without
 * bringing the drawing code along.
 */
type ShareState = {
  quote: Quote | null;
  /** The year whose review is showing; null when it is shut. */
  year: number | null;
};

export const useShareStore = create<ShareState>(() => ({ quote: null, year: null }));

/** Offers a passage as a picture. */
export const openQuoteCard = (quote: Quote) => {
  if (quote.text.trim()) {
    useShareStore.setState({ quote });
  }
};
export const closeQuoteCard = () => useShareStore.setState({ quote: null });

/** Opens the year in review. */
export const openYearReview = (year: number) => useShareStore.setState({ year });
export const closeYearReview = () => useShareStore.setState({ year: null });
