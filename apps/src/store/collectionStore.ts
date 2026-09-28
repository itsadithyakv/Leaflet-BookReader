import { create } from "zustand";
import { collectionService, type Collection } from "../services/collectionService";
import { useLibraryStore } from "./libraryStore";

/**
 * The reader's own collections. Every change is saved at once and backed up
 * soon after, like the rest of the library.
 */
type CollectionState = {
  collections: Collection[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (name: string, bookIds?: string[]) => Promise<Collection>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Adds the book, or takes it out if it is already in. */
  toggleBook: (id: string, bookId: string) => Promise<void>;
  addBooks: (id: string, bookIds: string[]) => Promise<void>;
  removeBook: (id: string, bookId: string) => Promise<void>;
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const useCollectionStore = create<CollectionState>((set, get) => {
  const replace = (saved: Collection) => {
    const exists = get().collections.some((item) => item.id === saved.id);
    set({
      collections: exists
        ? get().collections.map((item) => (item.id === saved.id ? saved : item))
        : [...get().collections, saved]
    });
    useLibraryStore.getState().requestBackup();
  };
  const update = async (id: string, change: (collection: Collection) => Partial<Collection>) => {
    const current = get().collections.find((item) => item.id === id);
    if (!current) {
      return;
    }
    const next = { ...current, ...change(current) };
    replace(await collectionService.save({ id, name: next.name, bookIds: next.bookIds }));
  };

  return {
    collections: [],
    loaded: false,
    async load() {
      try {
        set({ collections: await collectionService.list(), loaded: true });
      } catch {
        set({ loaded: true });
      }
    },
    async create(name, bookIds = []) {
      const saved = await collectionService.save({ id: newId(), name, bookIds });
      replace(saved);
      return saved;
    },
    rename(id, name) {
      return update(id, () => ({ name }));
    },
    async remove(id) {
      await collectionService.remove(id);
      set({ collections: get().collections.filter((item) => item.id !== id) });
      useLibraryStore.getState().requestBackup();
    },
    toggleBook(id, bookId) {
      return update(id, (collection) => ({
        bookIds: collection.bookIds.includes(bookId)
          ? collection.bookIds.filter((item) => item !== bookId)
          : [...collection.bookIds, bookId]
      }));
    },
    addBooks(id, bookIds) {
      return update(id, (collection) => ({ bookIds: [...collection.bookIds, ...bookIds] }));
    },
    removeBook(id, bookId) {
      return update(id, (collection) => ({ bookIds: collection.bookIds.filter((item) => item !== bookId) }));
    }
  };
});

// A sync can bring collections made or changed on another device.
useLibraryStore.subscribe((state, previous) => {
  if (state.syncStatus === "success" && previous.syncStatus !== "success" && useCollectionStore.getState().loaded) {
    void useCollectionStore.getState().load();
  }
});
