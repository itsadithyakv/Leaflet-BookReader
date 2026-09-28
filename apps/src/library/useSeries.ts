import { useLibraryStore } from "../store/libraryStore";
import { librarySeries, type LibrarySeries, type SeriesInfo } from "./series";

/** The library's series, worked out once per library change. */
export const useLibrarySeries = (): LibrarySeries => librarySeries(useLibraryStore((state) => state.books));

/** One book's series, for its card. */
export const useSeriesInfo = (bookId: string): SeriesInfo | null => useLibrarySeries().byBook.get(bookId) ?? null;
