import { create } from "zustand";

/**
 * "Search inside books": the words its dialog opens on, or null when it is
 * shut. Kept apart from the dialog, which loads on demand, so the library
 * page can ask for it without bringing it along (as the Highlights dialog
 * and the quote card are).
 */
type LibrarySearchState = { query: string | null };

export const useLibrarySearchStore = create<LibrarySearchState>(() => ({ query: null }));

export const openLibrarySearch = (query: string) => useLibrarySearchStore.setState({ query: query.trim() });
export const closeLibrarySearch = () => useLibrarySearchStore.setState({ query: null });
