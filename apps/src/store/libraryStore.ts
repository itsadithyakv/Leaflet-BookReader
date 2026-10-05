import { create } from "zustand";
import type { Book, BookFilter } from "@shared/models/book";
import { EMPTY_SYNC_STATUS, type DriveSyncStatus, type SyncStatus } from "@shared/sync/types";
import { bookService, type ImportOutcome } from "../services/bookService";
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
  /** Through the file dialog. What happened, for the library to say; `null` when nothing was chosen. */
  importBooks: () => Promise<ImportOutcome | null>;
  /** The books that came in ("Open with"). Rejects with the last file's reason when none did. */
  importPaths: (paths: string[]) => Promise<Book[]>;
  /** `importPaths`, with the files that were not added and why (a drop on the window). */
  importFiles: (paths: string[]) => Promise<ImportOutcome>;
  refreshMetadata: (id: string) => Promise<void>;
  fetchCover: (id: string) => Promise<void>;
  /** A PDF's first page as the cover of a book that has none (`bookService.savePageCover`). */
  savePageCover: (id: string, image: string) => Promise<void>;
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
  /** See `bookService.setSeries`. */
  setSeries: (id: string, series: string | null, seriesIndex: number | null) => Promise<void>;
  /** `position` left undefined keeps the book's current CFI. */
  updateBookProgress: (id: string, progress: number, position?: string | null) => void;
  resetAll: () => void;
};

let syncTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Imports in flight. Counted, because the dialog, a drop and "Open with" can
 * overlap: with a plain flag, the first to finish said importing was over
 * while another was still copying a book in.
 */
let importsRunning = 0;
let seriesScanned = false;

// Some books simply have no match upstream. Without a cooldown the library
// re-ran those lookups on every launch, forever.
const METADATA_RETRY_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
/** Metadata lookups running at once. Open Library asks clients to be gentle. */
const METADATA_CONCURRENCY = 3;
/** How often finished lookups are written to the library while a refresh runs. */
const METADATA_FLUSH_MS = 400;

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
    if (!seriesScanned) {
      // Books imported before series were read have theirs read once, here.
      seriesScanned = true;
      bookService
        .scanSeries()
        .then(async (found) => {
          if (found > 0) {
            set({ books: await bookService.list() });
          }
        })
        .catch(() => {
          // Tried again next launch.
          seriesScanned = false;
        });
    }
  },
  async setSeries(id, series, seriesIndex) {
    const updated = await bookService.setSeries(id, series, seriesIndex);
    // The preview has no database: the change lives in memory.
    const current = get().books.find((book) => book.id === id);
    const next = updated ?? (current ? { ...current, series, seriesIndex } : null);
    if (next) {
      set({ books: replaceBook(get().books, next) });
      scheduleSync(set, get);
    }
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
    importsRunning += 1;
    set({ importing: true });
    try {
      const outcome = await bookService.importFromDialog();
      if (outcome && outcome.books.length > 0) {
        takeIn(outcome.books, set, get);
      }
      return outcome;
    } finally {
      importsRunning -= 1;
      set({ importing: importsRunning > 0 });
    }
  },
  async importPaths(paths) {
    const outcome = await get().importFiles(paths);
    // As the backend's own `import_books` answers: an error only when nothing came in.
    if (outcome.books.length === 0 && outcome.failed.length > 0) {
      throw outcome.failed[outcome.failed.length - 1].reason;
    }
    return outcome.books;
  },
  async importFiles(paths) {
    importsRunning += 1;
    set({ importing: true });
    try {
      const outcome = await bookService.importPaths(paths);
      if (outcome.books.length > 0) {
        takeIn(outcome.books, set, get);
      }
      return outcome;
    } finally {
      importsRunning -= 1;
      set({ importing: importsRunning > 0 });
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
  async savePageCover(id, image) {
    const updated = await bookService.savePageCover(id, image);
    const current = get().books.find((book) => book.id === id);
    // Only the cover is taken: the book has been read on while it was saved.
    if (updated?.coverUrl && current && !current.coverUrl) {
      set({ books: replaceBook(get().books, { ...current, coverUrl: updated.coverUrl }) });
    }
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
    // A few lookups at a time, and the library updated in batches: one at a
    // time with a store write per book re-rendered a large library hundreds
    // of times, and one slow lookup held up every book behind it.
    let done = 0;
    let waiting: Book[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      const batch = waiting;
      waiting = [];
      set({
        metadataDone: done,
        books: batch.reduce((books, updated) => replaceBook(books, updated), get().books)
      });
    };
    const queue = [...needsRefresh];
    const worker = async () => {
      for (let book = queue.shift(); book; book = queue.shift()) {
        try {
          const updated = await bookService.refreshMetadata(book.id);
          if (updated) {
            waiting.push(updated);
          }
        } catch {
          // A book without a match keeps what it has; it is retried after the cooldown.
        }
        done += 1;
        flushTimer ??= setTimeout(flush, METADATA_FLUSH_MS);
      }
    };
    await Promise.all(Array.from({ length: Math.min(METADATA_CONCURRENCY, needsRefresh.length) }, worker));
    if (flushTimer) {
      clearTimeout(flushTimer);
    }
    flush();
    set({ metadataRefreshing: false });
  },
  updateBookProgress(id, progress, position) {
    // Stamped as the database stamps it (db `update_progress`): only when the
    // place really moved, so this copy says the same as the next one loaded.
    const moved = (book: Book) => Math.abs((book.progress ?? 0) - progress) > 1e-6 || (position != null && position !== book.position);
    set({
      books: get().books.map((book) =>
        book.id === id
          ? {
              ...book,
              progress,
              position: position === undefined ? book.position : position,
              progressUpdatedAt: moved(book) ? new Date().toISOString() : book.progressUpdatedAt
            }
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

/** Books an import brought back, into the library: shown, backed up, and looked up. */
function takeIn(imported: Book[], set: (state: Partial<LibraryState>) => void, get: () => LibraryState) {
  set({ books: mergeBooks(get().books, imported) });
  scheduleSync(set, get);
  void get().refreshMissingMetadata(imported);
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
