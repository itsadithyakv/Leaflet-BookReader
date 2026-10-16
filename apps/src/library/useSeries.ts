import { useLibraryStore } from "../store/libraryStore";
import { librarySeries, type LibrarySeries, type SeriesInfo } from "./series";

/** The library's series, worked out once per library change. */
export const useLibrarySeries = (): LibrarySeries => librarySeries(useLibraryStore((state) => state.books));

/**
 * One book's series, for its card. Only its own entry is watched (it keeps
 * its identity while unchanged, see `librarySeries`), so a card is not
 * redrawn each time some other book in the library changes.
 */
export const useSeriesInfo = (bookId: string): SeriesInfo | null =>
  useLibraryStore((state) => librarySeries(state.books).byBook.get(bookId) ?? null);
