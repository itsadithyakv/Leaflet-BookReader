import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { BookGrid } from "../components/BookGrid";
import { BookList } from "../components/BookList";
import { isMetadataRetryDue, useLibraryStore } from "../store/libraryStore";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import type { Book, BookFilter } from "@shared/models/book";
import {
  dependencyFreeSummary,
  externalConverterCount,
  formatSummary,
  getBookExtension,
  isImportableExtension
} from "../constants/bookFormats";
import { getSessionProgress, sessionElapsedMs, useHabitStore } from "../store/habitStore";
import { UiIcon } from "../components/UiIcon";
import { MobileComingSoonBanner } from "../components/MobileComingSoonBanner";

const sortBooks = (books: Book[], sort: "recent" | "opened" | "author") => {
  const copy = [...books];
  if (sort === "author") {
    return copy.sort((a, b) => (a.author ?? "").localeCompare(b.author ?? ""));
  }
  if (sort === "opened") {
    return copy.sort((a, b) => {
      const aTime = a.lastOpened ? Date.parse(a.lastOpened) : 0;
      const bTime = b.lastOpened ? Date.parse(b.lastOpened) : 0;
      return bTime - aTime;
    });
  }
  return copy.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
};

const sortOptions: Array<{ value: BookFilter["sort"]; label: string }> = [
  { value: "recent", label: "Recently Added" },
  { value: "opened", label: "Recently Opened" },
  { value: "author", label: "Author (A-Z)" }
];

export type LibraryPageProps = {
  onOpenBook: (book: Book) => void;
  onNavigate: (tab: "library" | "collections" | "social" | "settings") => void;
  showToast: (message: string) => void;
};

const resolveErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
      return maybeMessage;
    }
    if (typeof (error as { toString?: () => string }).toString === "function") {
      const text = (error as { toString: () => string }).toString();
      if (text && text !== "[object Object]") {
        return text;
      }
    }
  }
  return fallback;
};

export const LibraryPage = ({ onOpenBook, onNavigate, showToast }: LibraryPageProps) => {
  const { books, filters, loading, importing, stats, importBooks, importPaths, refreshMetadata, fetchCover, deleteBook, setFilter } =
    useLibraryStore(
      useShallow((state) => ({
        books: state.books,
        filters: state.filters,
        loading: state.loading,
        importing: state.importing,
        stats: state.stats,
        importBooks: state.importBooks,
        importPaths: state.importPaths,
        refreshMetadata: state.refreshMetadata,
        deleteBook: state.deleteBook,
        fetchCover: state.fetchCover,
        setFilter: state.setFilter
      }))
    );
  const { activeSession, startSession, stopSession, snapshot } =
    useHabitStore(
      useShallow((state) => ({
        activeSession: state.activeSession,
        startSession: state.startSession,
        stopSession: state.stopSession,
        snapshot: state.snapshot
      }))
    );
  const [sessionDuration, setSessionDuration] = useState(20);
  const todayMinutes = snapshot.todayMinutes;
  const goalMet = snapshot.todayMet;
  const goalPercent =
    snapshot.goalMinutes > 0
      ? Math.min(100, Math.round((todayMinutes / snapshot.goalMinutes) * 100))
      : 0;
  const [sessionTick, setSessionTick] = useState(0);
  const [sessionRemaining, setSessionRemaining] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const importDropRef = useRef<HTMLButtonElement>(null);
  const focusProgress = activeSession ? getSessionProgress(activeSession) : 0;
  const focusPercent = Math.min(100, Math.round(focusProgress * 100));
  const debouncedQuery = useDebouncedValue(filters.query, 250);

  const authors = useMemo(() => {
    return Array.from(new Set(books.map((book) => book.author).filter(Boolean))) as string[];
  }, [books]);

  const genres = useMemo(() => {
    const all = books.flatMap((book) => book.genres ?? []);
    return Array.from(new Set(all));
  }, [books]);

  const filteredBooks = useMemo(() => {
    let result = books;
    if (filters.author !== "all") {
      result = result.filter((book) => book.author === filters.author);
    }
    if (filters.genre !== "all") {
      result = result.filter((book) => book.genres?.includes(filters.genre));
    }
    if (debouncedQuery.trim().length > 0) {
      const query = debouncedQuery.toLowerCase();
      result = result.filter((book) => {
        const haystack = `${book.title} ${book.author ?? ""} ${book.genres.join(" ")}`.toLowerCase();
        return haystack.includes(query);
      });
    }
    return sortBooks(result, filters.sort);
  }, [books, filters.author, filters.genre, filters.sort, debouncedQuery]);

  const totalBooks = books.length;
  const finishedBooks = books.filter((book) => book.progress >= 1).length;
  const streakTitle = stats.streakDays > 0 ? `${stats.streakDays} Day Streak!` : "Start Your Streak";

  const handleImport = () => {
    importBooks().catch((error) => {
      showToast(resolveErrorMessage(error, "Import failed. Try again."));
    });
  };

  /**
   * Removes a book everywhere. The row is tombstoned rather than dropped, so
   * the removal reaches the reader's other devices instead of being undone by
   * them on the next sync.
   */
  const handleRemoveBook = (book: Book) => {
    deleteBook(book.id)
      .then(() => showToast(`Removed ${book.title}.`))
      .catch((error) => showToast(resolveErrorMessage(error, "Could not remove that book.")));
  };

  const isOverImportArea = useCallback((x: number, y: number) => {
    const dropArea = importDropRef.current;
    if (!dropArea) {
      return false;
    }
    const scale = window.devicePixelRatio || 1;
    const pointX = x / scale;
    const pointY = y / scale;
    const bounds = dropArea.getBoundingClientRect();
      return (
      pointX >= bounds.left &&
      pointX <= bounds.right &&
      pointY >= bounds.top &&
      pointY <= bounds.bottom
    );
  }, []);

  const importDroppedPaths = useCallback(
    (paths: string[]) => {
      if (importing) {
        return;
      }
      const supported = paths.filter((path) => isImportableExtension(getBookExtension(path)));
      if (supported.length === 0) {
        showToast(`Choose a supported book file — ${formatSummary()}.`);
        return;
      }
      importPaths(supported)
        .then(() => showToast(`${supported.length} book${supported.length === 1 ? "" : "s"} added.`))
        .catch((error) => {
          showToast(resolveErrorMessage(error, "Import failed. Try again."));
        });
    },
    [importPaths, importing, showToast]
  );

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (disposed) {
          return;
        }
        const payload = event.payload;
        if (payload.type === "leave") {
          setDropActive(false);
          return;
        }
        if (payload.type === "enter" || payload.type === "over") {
          setDropActive(isOverImportArea(payload.position.x, payload.position.y));
          return;
        }

        const shouldImport = isOverImportArea(payload.position.x, payload.position.y);
        setDropActive(false);
        if (shouldImport) {
          importDroppedPaths(payload.paths);
        }
      })
      .then((stopListening) => {
        if (disposed) {
          stopListening();
          return;
        }
        unlisten = stopListening;
      })
      .catch(() => {
        setDropActive(false);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [importDroppedPaths, isOverImportArea]);

  const handleStartSession = () => {
    if (activeSession) {
      return;
    }
    startSession({
      startedAt: new Date().toISOString(),
      durationMinutes: sessionDuration
    });
  };

  const handleEndSession = () => {
    // The wrap-up screen (mounted in App) takes it from here, note included.
    void stopSession({ reason: "manual_end", cleanSession: false });
  };

  const requestedCovers = useRef(new Set<string>());

  useEffect(() => {
    const now = Date.now();
    const missing = books.filter(
      (book) =>
        !book.coverUrl && !requestedCovers.current.has(book.id) && isMetadataRetryDue(book, now)
    );
    missing.slice(0, 3).forEach((book) => {
      requestedCovers.current.add(book.id);
      fetchCover(book.id).catch(() => {
        // offline or unavailable; will retry on next launch
      });
    });
  }, [books, fetchCover]);

  useEffect(() => {
    if (!activeSession) {
      setSessionRemaining(null);
      return;
    }
    const timer = window.setInterval(() => {
      setSessionTick((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeSession]);

  useEffect(() => {
    if (!activeSession) {
      setSessionRemaining(null);
      return;
    }
    const totalSeconds = activeSession.durationMinutes * 60;
    const elapsedSeconds = Math.round(sessionElapsedMs(activeSession) / 1000);
    const remaining = Math.max(0, totalSeconds - elapsedSeconds);
    const minutesLeft = Math.ceil(remaining / 60);
    setSessionRemaining(minutesLeft);
    if (remaining <= 0) {
      void stopSession({ reason: "completed", cleanSession: true });
    }
  }, [activeSession, sessionTick]);

  return (
    <div className="flex min-h-full flex-col gap-10">
      <div className="md:hidden">
        <div className="relative">
          <UiIcon
            name="search"
            size={19}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant"
          />
          <input
            className="inset-field w-full py-2.5 pl-12 pr-4 text-sm text-on-surface focus:border-primary/40 focus:outline-none"
            placeholder="Search your archive..."
            type="text"
            value={filters.query}
            onChange={(event) => setFilter({ query: event.target.value })}
          />
        </div>
      </div>

      <MobileComingSoonBanner />

      <section className="grid min-w-0 gap-6 xl:grid-cols-12">
        {/* clip, not hidden: the resting and running layers are stacked, and an
            overflow-hidden box is still scrollable, so focusing Pip's button
            scrolled the card to reveal the taller hidden layer. */}
        <div
          className="paper-surface relative min-w-0 overflow-clip rounded-xl p-6 xl:col-span-8"
        >
          <div className="relative z-10">
            <div className="relative">
              <div
                className={`transition-all duration-500 ease-out will-change-transform will-change-opacity ${
                  activeSession
                    ? "opacity-0 -translate-y-3 pointer-events-none absolute inset-0"
                    : "opacity-100 translate-y-0"
                }`}
              >
                <div className="min-w-0">
                  <div>
                    <h1 className="page-title text-4xl md:text-5xl">{streakTitle}</h1>
                  </div>
                </div>
                <div className="mt-3 grid gap-3">
                  <div className="inset-field flex min-w-0 flex-wrap items-center gap-4 p-3" data-tour="session">
                    <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Focus Session</p>
                    <div className="ml-auto flex flex-wrap items-center gap-3">
                      <select
                        className="inset-field px-3 py-2 text-xs text-on-surface-variant"
                        value={sessionDuration}
                        onChange={(event) => setSessionDuration(Number(event.target.value))}
                        disabled={Boolean(activeSession)}
                      >
                        <option value={10}>10 min</option>
                        <option value={20}>20 min</option>
                        <option value={30}>30 min</option>
                        <option value={45}>45 min</option>
                      </select>
                      <button
                        type="button"
                        className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold"
                        onClick={handleStartSession}
                      >
                        Start Session
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div
                className={`transition-all duration-500 ease-out will-change-transform will-change-opacity ${
                  activeSession
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-3 pointer-events-none absolute inset-0"
                }`}
              >
                <div className="grid min-w-0 gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-on-surface-variant">Focus Mode</p>
                    <h1 className="page-title mt-2 text-4xl md:text-5xl">Session Running</h1>
                    <p className="mt-3 text-sm text-on-surface-variant">
                      Stay in the flow. Your focus session is active.
                    </p>
                    <div className="mt-4">
                      <button
                        type="button"
                        className="tactile-button tactile-button-primary px-5 py-2 text-xs font-semibold"
                        onClick={handleEndSession}
                      >
                        End Session
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-start lg:justify-end">
                    <div className="paper-surface-raised flex flex-col items-center gap-4 border-primary/40 bg-primary/10 px-6 py-6 text-center">
                      <div className="relative flex h-32 w-32 items-center justify-center">
                        <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
                          <circle
                            cx="60"
                            cy="60"
                            r="46"
                            stroke="currentColor"
                            strokeWidth="8"
                            className="text-outline-variant/30"
                            fill="transparent"
                          />
                          <circle
                            cx="60"
                            cy="60"
                            r="46"
                            stroke="currentColor"
                            strokeWidth="8"
                            className="text-primary"
                            fill="transparent"
                            strokeDasharray={`${(focusPercent / 100) * 289} 289`}
                            strokeLinecap="round"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-sm uppercase tracking-widest text-on-surface-variant">
                        <span className="text-2xl font-semibold text-primary">
                          {sessionRemaining ?? sessionDuration}m
                        </span>
                          <span className="text-[11px] text-on-surface-variant/70">remaining</span>
                        </div>
                      </div>
                      <div className="text-[11px] uppercase tracking-widest text-on-surface-variant">
                        {focusPercent}% complete
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <button
          ref={importDropRef}
          data-tour="import"
          type="button"
          className={`import-drop-zone paper-surface relative flex min-w-0 flex-col items-center justify-center p-8 xl:col-span-4 ${
            importing
              ? "cursor-wait opacity-90"
              : dropActive
                ? "import-drop-zone-active"
                : "cursor-pointer"
          }`}
          onClick={handleImport}
          disabled={importing}
          aria-busy={importing}
          data-drag-active={dropActive}
        >
          {importing && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-surface-container-lowest/90">
              <div className="import-book-icon import-book-icon-loading" aria-hidden="true">
                <UiIcon name="book-add" size={29} strokeWidth={1.8} />
              </div>
            </div>
          )}
          <div className="import-book-icon mb-5" aria-hidden="true">
            <UiIcon name="book-add" size={30} strokeWidth={1.8} />
          </div>
          <h3 className="page-title text-2xl">Import Books</h3>
          <p className="mt-2 max-w-xs text-center text-sm text-on-surface-variant">
            Drop a book here, or click to browse
          </p>
          <p className="mt-3 max-w-xs text-center text-xs leading-5 text-on-surface-variant/75">
            {dependencyFreeSummary()} open straight away.
            <br />
            {externalConverterCount()} more formats need the optional converter.
          </p>
        </button>
      </section>


      <section className="flex flex-1 flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 className="page-title text-4xl">The Archive</h2>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-on-surface-variant">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary"></span>
                {totalBooks} Total Books
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-tertiary"></span>
                {finishedBooks} Finished
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="key-button"
                onClick={() => setFilter({ view: "grid" })}
                aria-label="Grid view"
                aria-pressed={filters.view === "grid"}
              >
                <UiIcon name="grid" size={18} />
              </button>
              <button
                type="button"
                className="key-button"
                onClick={() => setFilter({ view: "list" })}
                aria-label="List view"
                aria-pressed={filters.view === "list"}
              >
                <UiIcon name="list" size={18} />
              </button>
            </div>
            <select
              className="inset-field px-3 py-2 text-xs text-on-surface-variant"
              value={filters.author}
              onChange={(event) => setFilter({ author: event.target.value })}
            >
              <option value="all">All authors</option>
              {authors.map((author) => (
                <option key={author} value={author}>
                  {author}
                </option>
              ))}
            </select>
            <select
              className="inset-field px-3 py-2 text-xs text-on-surface-variant"
              value={filters.genre}
              onChange={(event) => setFilter({ genre: event.target.value })}
            >
              <option value="all">All genres</option>
              {genres.map((genre) => (
                <option key={genre} value={genre}>
                  {genre}
                </option>
              ))}
            </select>
            <select
              className="inset-field px-3 py-2 text-xs text-on-surface-variant"
              value={filters.sort}
              onChange={(event) => setFilter({ sort: event.target.value as BookFilter["sort"] })}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 min-h-[480px]">
          {loading ? (
            <div className="flex h-full items-center justify-center text-on-surface-variant">
              Loading your library...
            </div>
          ) : filteredBooks.length === 0 ? (
            <div className="paper-surface flex h-full flex-col items-center justify-center gap-3 rounded-xl p-8 text-center text-on-surface-variant">
              <p className="text-lg font-semibold text-on-surface">No books yet</p>
              <p className="max-w-md text-sm">
                Import {dependencyFreeSummary()} and more to populate your library.
              </p>
              <button
                className="tactile-button tactile-button-primary px-4 py-2 text-sm font-semibold"
                type="button"
                onClick={handleImport}
              >
                Import your first book
              </button>
            </div>
          ) : filters.view === "grid" ? (
            <BookGrid books={filteredBooks} onRefresh={refreshMetadata} onOpen={onOpenBook} />
          ) : (
            <BookList
              books={filteredBooks}
              onRefresh={refreshMetadata}
              onOpen={onOpenBook}
              onRemove={handleRemoveBook}
            />
          )}
        </div>
      </section>
    </div>
  );
};
