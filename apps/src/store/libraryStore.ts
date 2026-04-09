import { create } from "zustand";
import type { Book, BookFilter } from "@shared/models/book";
import type { DriveSyncStatus } from "@shared/sync/types";
import { bookService } from "../services/bookService";
import { driveSyncService } from "../services/driveSyncService";
import { statsService, type ReadingStats } from "../services/statsService";

const defaultFilters: BookFilter = {
  query: "",
  author: "all",
  genre: "all",
  sort: "recent",
  view: "grid"
};

type LibraryState = {
  books: Book[];
  filters: BookFilter;
  loading: boolean;
  metadataRefreshing: boolean;
  metadataTotal: number;
  metadataDone: number;
  syncStatus: DriveSyncStatus;
  stats: ReadingStats;
  driveConnected: boolean;
  importing: boolean;
  loadBooks: () => Promise<void>;
  loadStats: () => Promise<void>;
  loadDriveStatus: () => Promise<void>;
  importBooks: () => Promise<void>;
  importPaths: (paths: string[]) => Promise<void>;
  refreshMetadata: (id: string) => Promise<void>;
  fetchCover: (id: string) => Promise<void>;
  openBook: (book: Book) => Promise<void>;
  setFilter: (partial: Partial<BookFilter>) => void;
  startDriveAuth: () => Promise<void>;
  syncNow: () => Promise<void>;
  refreshMissingMetadata: (books?: Book[]) => Promise<void>;
  updateBookProgress: (id: string, progress: number) => void;
  resetAll: () => void;
};

let syncTimer: ReturnType<typeof setTimeout> | null = null;

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  filters: defaultFilters,
  loading: false,
  metadataRefreshing: false,
  metadataTotal: 0,
  metadataDone: 0,
  syncStatus: "idle",
  stats: {
    streakDays: 0,
    totalDays: 0,
    lastReadAt: null,
    daysLast7: 0
  },
  driveConnected: false,
  importing: false,
  async loadBooks() {
    set({ loading: true });
    const books = await bookService.list();
    set({ books, loading: false });
    void get().refreshMissingMetadata(books);
  },
  async loadStats() {
    try {
      const stats = await statsService.getReadingStats();
      set({ stats });
    } catch {
      set({
        stats: {
          streakDays: 0,
          totalDays: 0,
          lastReadAt: null,
          daysLast7: 0
        }
      });
    }
  },
  async loadDriveStatus() {
    try {
      const status = await driveSyncService.status();
      set({ driveConnected: status.connected });
    } catch {
      set({ driveConnected: false });
    }
  },
  async importBooks() {
    set({ importing: true });
    try {
      const imported = await bookService.importFromDialog();
      if (imported.length === 0) {
        return;
      }
      const books = [...get().books, ...imported];
      set({ books });
      scheduleSync(set);
    } finally {
      set({ importing: false });
    }
  },
  async importPaths(paths) {
    set({ importing: true });
    try {
      const imported = await bookService.importPaths(paths);
      if (imported.length === 0) {
        return;
      }
      const books = [...get().books, ...imported];
      set({ books });
      scheduleSync(set);
    } finally {
      set({ importing: false });
    }
  },
  async refreshMetadata(id: string) {
    const updated = await bookService.refreshMetadata(id);
    set({
      books: get().books.map((book) => (book.id === updated.id ? updated : book))
    });
    scheduleSync(set);
  },
  async fetchCover(id: string) {
    const updated = await bookService.fetchCover(id);
    if (!updated) {
      return;
    }
    set({
      books: get().books.map((book) => (book.id === updated.id ? updated : book))
    });
  },
  async openBook(book: Book) {
    const now = new Date().toISOString();
    await bookService.updateProgress(book.id, book.progress);
    set({
      books: get().books.map((existing) =>
        existing.id === book.id ? { ...existing, lastOpened: now } : existing
      )
    });
    void get().loadStats();
  },
  setFilter(partial) {
    set({ filters: { ...get().filters, ...partial } });
  },
  async startDriveAuth() {
    await driveSyncService.startAuth();
    await driveSyncService.waitForAuth();
    set({ driveConnected: true });
    await get().syncNow();
  },
  async syncNow() {
    set({ syncStatus: "syncing" });
    try {
      await driveSyncService.syncNow();
      set({ syncStatus: "success" });
    } catch {
      set({ syncStatus: "error" });
    }
  },
  async refreshMissingMetadata(seed) {
    const all = seed ?? get().books;
    const needsRefresh = all.filter((book) => {
      const missingAuthor = !book.author || book.author.trim().length === 0;
      const missingCover = !book.coverUrl;
      const missingGenres = !book.genres || book.genres.length === 0;
      const noisyTitle = /--|anna.?s archive|isbn/i.test(book.title);
      return missingAuthor || missingCover || missingGenres || noisyTitle;
    });
    if (needsRefresh.length === 0) {
      return;
    }
    set({ metadataRefreshing: true, metadataTotal: needsRefresh.length, metadataDone: 0 });
    let done = 0;
    for (const book of needsRefresh) {
      try {
        const updated = await bookService.refreshMetadata(book.id);
        set({
          books: get().books.map((existing) => (existing.id === updated.id ? updated : existing))
        });
      } catch {
        // ignore refresh errors
      } finally {
        done += 1;
        set({ metadataDone: done });
      }
    }
    set({ metadataRefreshing: false });
  },
  updateBookProgress(id, progress) {
    set({
      books: get().books.map((book) =>
        book.id === id ? { ...book, progress } : book
      )
    });
  },
  resetAll() {
    set({
      books: [],
      filters: defaultFilters,
      loading: false,
      metadataRefreshing: false,
      metadataTotal: 0,
      metadataDone: 0,
      syncStatus: "idle",
      stats: {
        streakDays: 0,
        totalDays: 0,
        lastReadAt: null,
        daysLast7: 0
      },
      driveConnected: false,
      importing: false
    });
  }
}));

function scheduleSync(set: (state: Partial<LibraryState>) => void) {
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(async () => {
    set({ syncStatus: "syncing" });
    try {
      await driveSyncService.syncNow();
      set({ syncStatus: "success" });
    } catch {
      set({ syncStatus: "error" });
    }
  }, 1500);
}
