import { create } from "zustand";
import type { Book, BookFilter } from "@shared/models/book";
import { EMPTY_SYNC_STATUS, type DriveSyncStatus, type SyncStatus } from "@shared/sync/types";
import { bookService } from "../services/bookService";
import { syncService } from "../services/syncService";
import { socialService } from "../services/socialService";
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
  /** The last error a sync run produced, so the UI can say what went wrong. */
  syncError: string | null;
  sync: SyncStatus;
  stats: ReadingStats;
  importing: boolean;
  /** Books currently being fetched from the shared store, by id. */
  downloading: string[];
  loadBooks: () => Promise<void>;
  loadStats: () => Promise<void>;
  loadSyncStatus: () => Promise<void>;
  importBooks: () => Promise<void>;
  importPaths: (paths: string[]) => Promise<Book[]>;
  refreshMetadata: (id: string) => Promise<void>;
  fetchCover: (id: string) => Promise<void>;
  openBook: (book: Book) => Promise<void>;
  setFilter: (partial: Partial<BookFilter>) => void;
  startDriveAuth: () => Promise<void>;
  disconnectDrive: () => Promise<void>;
  setDriveCredentials: (clientId: string, clientSecret: string) => Promise<void>;
  clearDriveCredentials: () => Promise<void>;
  setSyncFolder: (path: string | null) => Promise<void>;
  setCloudApi: (url: string) => Promise<void>;
  syncNow: () => Promise<void>;
  /** Backs up soon, coalescing with any other change that lands meanwhile. */
  requestBackup: () => void;
  ensureBookFile: (book: Book) => Promise<Book>;
  deleteBook: (id: string) => Promise<void>;
  refreshMissingMetadata: (books?: Book[]) => Promise<void>;
  /** `position` left undefined keeps the book's current CFI. */
  updateBookProgress: (id: string, progress: number, position?: string | null) => void;
  resetAll: () => void;
};

let syncTimer: ReturnType<typeof setTimeout> | null = null;

// Some books simply have no match upstream. Without a cooldown the library
// re-ran those lookups on every launch, forever.
const METADATA_RETRY_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export const isMetadataRetryDue = (book: Book, now = Date.now()) => {
  if (!book.metadataCheckedAt) {
    return true;
  }
  const checkedAt = Date.parse(book.metadataCheckedAt);
  if (!Number.isFinite(checkedAt)) {
    return true;
  }
  return now - checkedAt >= METADATA_RETRY_COOLDOWN_MS;
};

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  filters: defaultFilters,
  loading: false,
  metadataRefreshing: false,
  metadataTotal: 0,
  metadataDone: 0,
  syncStatus: "idle",
  syncError: null,
  sync: EMPTY_SYNC_STATUS,
  stats: {
    streakDays: 0,
    totalDays: 0,
    lastReadAt: null,
    daysLast7: 0
  },
  importing: false,
  downloading: [],
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
  async loadSyncStatus() {
    try {
      set({ sync: await syncService.status() });
    } catch {
      set({ sync: EMPTY_SYNC_STATUS });
    }
  },
  async importBooks() {
    set({ importing: true });
    try {
      const imported = await bookService.importFromDialog();
      if (imported.length === 0) {
        return;
      }
      const books = mergeBooks(get().books, imported);
      set({ books });
      scheduleSync(set, get);
      void get().refreshMissingMetadata(imported);
    } finally {
      set({ importing: false });
    }
  },
  async importPaths(paths) {
    set({ importing: true });
    try {
      const imported = await bookService.importPaths(paths);
      if (imported.length === 0) {
        return [];
      }
      const books = mergeBooks(get().books, imported);
      set({ books });
      scheduleSync(set, get);
      void get().refreshMissingMetadata(imported);
      return imported;
    } finally {
      set({ importing: false });
    }
  },
  async refreshMetadata(id: string) {
    const updated = await bookService.refreshMetadata(id);
    set({ books: replaceBook(get().books, updated) });
    scheduleSync(set, get);
  },
  async fetchCover(id: string) {
    const updated = await bookService.fetchCover(id);
    if (!updated) {
      return;
    }
    set({ books: replaceBook(get().books, updated) });
  },
  /**
   * Fetches a book's bytes if this device only has the entry.
   *
   * Sync moves a kilobyte-sized index everywhere and leaves the files where
   * they are, so a newly connected device is usable at once and pays for a book
   * only when it is opened.
   */
  async ensureBookFile(book: Book) {
    if (book.available !== false) {
      return book;
    }
    set({ downloading: [...get().downloading, book.id] });
    try {
      await syncService.downloadBook(book.id);
      const refreshed = { ...book, available: true };
      set({ books: replaceBook(get().books, refreshed) });
      return refreshed;
    } finally {
      set({ downloading: get().downloading.filter((id) => id !== book.id) });
    }
  },

  async deleteBook(id: string) {
    await syncService.deleteBook(id);
    set({ books: get().books.filter((book) => book.id !== id) });
    scheduleSync(set, get);
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
    // The backend opens the consent page in the system browser and this waits
    // for the loopback callback. It rejects with a reason -- cancelled, timed
    // out, refused -- rather than hanging as the old listener did.
    await syncService.startDriveAuth();
    await syncService.waitForDriveAuth();
    await get().loadSyncStatus();
    await get().syncNow();
  },
  async disconnectDrive() {
    set({ sync: await syncService.disconnectDrive(), syncStatus: "idle", syncError: null });
  },
  async setDriveCredentials(clientId: string, clientSecret: string) {
    set({ sync: await syncService.setDriveCredentials(clientId, clientSecret) });
  },
  async clearDriveCredentials() {
    set({ sync: await syncService.clearDriveCredentials(), syncStatus: "idle", syncError: null });
  },
  async setCloudApi(url: string) {
    const status = await socialService.setApiBase(url);
    if (status) {
      set({ sync: status });
    }
  },
  async setSyncFolder(path: string | null) {
    set({ sync: await syncService.setFolder(path) });
    if (path) {
      await get().syncNow();
    }
  },
  requestBackup() {
    scheduleSync(set, get);
  },
  async syncNow() {
    set({ syncStatus: "syncing", syncError: null });
    try {
      await syncService.syncNow();
      // Sync can add, remove and re-position books, so the library is re-read
      // rather than patched: guessing which rows changed is how the two views
      // drift apart.
      const [books, status] = await Promise.all([bookService.list(), syncService.status()]);
      set({ books, sync: status, syncStatus: "success" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ syncStatus: "error", syncError: message });
      throw error;
    }
  },
  async refreshMissingMetadata(seed) {
    const all = seed ?? get().books;
    const now = Date.now();
    const needsRefresh = all.filter((book) => {
      if (!isMetadataRetryDue(book, now)) {
        return false;
      }
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
      let updated: Book | null = null;
      try {
        updated = await bookService.refreshMetadata(book.id);
      } catch {
        // ignore refresh errors
      }
      done += 1;
      // One store write per book, not two — every write re-renders the library.
      set({
        metadataDone: done,
        books: updated
          ? replaceBook(get().books, updated)
          : get().books
      });
    }
    set({ metadataRefreshing: false });
  },
  updateBookProgress(id, progress, position) {
    set({
      books: get().books.map((book) =>
        book.id === id
          ? { ...book, progress, position: position === undefined ? book.position : position }
          : book
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
      syncError: null,
      sync: EMPTY_SYNC_STATUS,
      stats: {
        streakDays: 0,
        totalDays: 0,
        lastReadAt: null,
        daysLast7: 0
      },
      importing: false,
      downloading: []
    });
  }
}));

function replaceBook(books: Book[], updated: Book) {
  const index = books.findIndex((book) => book.id === updated.id);
  if (index === -1) {
    return books;
  }
  const next = books.slice();
  next[index] = updated;
  return next;
}

function mergeBooks(existing: Book[], imported: Book[]) {
  const byId = new Map(existing.map((book) => [book.id, book]));
  for (const book of imported) {
    byId.set(book.id, book);
  }
  return Array.from(byId.values());
}

/**
 * Publishes local changes shortly after they settle.
 *
 * Debounced because importing ten books fires ten times, and each sync is a
 * full merge round trip.
 */
function scheduleSync(
  set: (state: Partial<LibraryState>) => void,
  get: () => LibraryState
) {
  const { driveConnected, folderPath } = get().sync;
  if (!driveConnected && !folderPath) {
    return;
  }
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(() => {
    void get().syncNow().catch(() => {
      // A background sync failure is already recorded in `syncError`; the user
      // is not interrupted for it.
    });
  }, 1500);
}
