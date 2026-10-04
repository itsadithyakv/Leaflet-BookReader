import { create } from "zustand";
import { annotationService } from "../../services/annotationService";

/**
 * What the Highlights dialog is showing: the books that have highlights, or
 * one book's. `fromList` gives a book's view a way back to the list.
 */
export type HighlightsView = { kind: "books" } | { kind: "book"; bookId: string; fromList: boolean };

type HighlightsState = {
  view: HighlightsView | null;
  /** Highlights per book id. A book with none is not in it. */
  counts: Record<string, number>;
  loadCounts: () => Promise<void>;
};

/**
 * Kept apart from the dialog, which loads on demand (it brings epub.js along
 * to sort highlights into reading order): the library and a book's menu only
 * need the counts and a way to open it.
 */
export const useHighlightsStore = create<HighlightsState>((set) => ({
  view: null,
  counts: {},
  async loadCounts() {
    try {
      const counts = await annotationService.highlightCounts();
      set({ counts: Object.fromEntries(counts.map((item) => [item.bookId, item.count])) });
    } catch {
      // The counts shown stay as they were; the dialog still lists what it can load.
    }
  }
}));

/** Opens one book's highlights. */
export const openHighlights = (bookId: string) =>
  useHighlightsStore.setState({ view: { kind: "book", bookId, fromList: false } });

/** Opens the list of books that have highlights. */
export const openHighlightsList = () => useHighlightsStore.setState({ view: { kind: "books" } });

export const showHighlightsView = (view: HighlightsView | null) => useHighlightsStore.setState({ view });
