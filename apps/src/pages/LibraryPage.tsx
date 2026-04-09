import { useEffect, useMemo, useRef, useState } from "react";
import { BookGrid } from "../components/BookGrid";
import { BookList } from "../components/BookList";
import { useLibraryStore } from "../store/libraryStore";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import type { Book, BookFilter } from "@shared/models/book";
import { IMPORTABLE_EXTENSIONS, formatDisplayList } from "../constants/bookFormats";
import { getDateKey, getSessionProgress, isGoalMet, useHabitStore } from "../store/habitStore";

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
  onNavigate: (tab: "library" | "collections" | "analytics" | "settings") => void;
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
  const { books, filters, loading, importing, stats, importBooks, refreshMetadata, fetchCover, setFilter } =
    useLibraryStore();
  const { activeSession, startSession, stopSession, clearSessionShelf, focusSettings, addSessionNote, goal, daily } =
    useHabitStore();
  const [sessionDuration, setSessionDuration] = useState(20);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSessionId, setNoteSessionId] = useState<string | null>(null);
  const todayKey = getDateKey();
  const todayRecord = daily[todayKey];
  const todayMinutes = todayRecord?.minutes ?? 0;
  const goalMet = isGoalMet(goal, todayRecord);
  const goalPercent =
    goal.mode === "minutes" && goal.target > 0
      ? Math.min(100, Math.round((todayMinutes / goal.target) * 100))
      : goalMet
        ? 100
        : 0;
  const [sessionTick, setSessionTick] = useState(0);
  const [sessionRemaining, setSessionRemaining] = useState<number | null>(null);
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
  const streakBadge = stats.streakDays > 0 ? "Streak Active" : "Ritual Ready";

  const handleImport = () => {
    importBooks().catch((error) => {
      showToast(resolveErrorMessage(error, "Import failed. Try again."));
    });
  };

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
    const confirmed = window.confirm(
      "Ending focus now will clear your sessions bookshelf progress. Continue?"
    );
    if (!confirmed) {
      return;
    }
    const sessionId = stopSession({ reason: "manual_end", cleanSession: false });
    clearSessionShelf();
    if (sessionId && focusSettings.sessionNotes) {
      setNoteSessionId(sessionId);
      setNoteText("");
      setNoteModalOpen(true);
    }
  };

  const requestedCovers = useRef(new Set<string>());

  useEffect(() => {
    const missing = books.filter((book) => !book.coverUrl && !requestedCovers.current.has(book.id));
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
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - Date.parse(activeSession.startedAt)) / 1000));
    const remaining = Math.max(0, totalSeconds - elapsedSeconds);
    const minutesLeft = Math.ceil(remaining / 60);
    setSessionRemaining(minutesLeft);
    if (remaining <= 0) {
      const sessionId = stopSession({ reason: "completed", cleanSession: true });
      if (sessionId && focusSettings.sessionNotes) {
        setNoteSessionId(sessionId);
        setNoteText("");
        setNoteModalOpen(true);
      }
    }
  }, [activeSession, sessionTick]);

  return (
    <div className="flex min-h-full flex-col gap-10">
      <div className="md:hidden">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">
            search
          </span>
          <input
            className="w-full rounded-full border border-outline-variant/30 bg-surface-container-lowest py-2.5 pl-12 pr-4 text-sm text-on-surface focus:border-primary/40 focus:outline-none"
            placeholder="Search your archive..."
            type="text"
            value={filters.query}
            onChange={(event) => setFilter({ query: event.target.value })}
          />
        </div>
      </div>

      <section className="grid gap-6 lg:grid-cols-12">
        <div
          className="relative overflow-hidden rounded-3xl border border-outline-variant/10 bg-surface-container-low p-6 lg:col-span-8"
        >
          <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/5 blur-[80px]"></div>
          <div className="relative z-10">
            <div className="relative">
              <div
                className={`transition-all duration-500 ease-out will-change-transform will-change-opacity ${
                  activeSession
                    ? "opacity-0 -translate-y-3 pointer-events-none absolute inset-0"
                    : "opacity-100 translate-y-0"
                }`}
              >
                <div className="grid gap-6 lg:grid-cols-[1fr_0.6fr] lg:items-center">
                  <div>
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-tertiary-container/20 px-3 py-1 text-xs font-bold uppercase tracking-widest text-tertiary">
                      {streakBadge}
                    </div>
                    <h1 className="text-4xl font-headline font-bold md:text-5xl">{streakTitle}</h1>
                  </div>
                </div>
                <div className="mt-3 grid gap-3">
                  <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-outline-variant/20 bg-surface-container-high p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Focus Session</p>
                    <div className="ml-auto flex flex-wrap items-center gap-3">
                      <select
                        className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant"
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
                        className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-on-primary"
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
                <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-on-surface-variant">Focus Mode</p>
                    <h1 className="mt-2 text-4xl font-headline font-bold md:text-5xl">Session Running</h1>
                    <p className="mt-3 text-sm text-on-surface-variant">
                      Stay in the flow. Your focus session is active.
                    </p>
                    <div className="mt-4">
                      <button
                        type="button"
                        className="rounded-full bg-primary px-5 py-2 text-xs font-semibold text-on-primary"
                        onClick={handleEndSession}
                      >
                        End Session
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-start lg:justify-end">
                    <div className="flex flex-col items-center gap-4 rounded-3xl border border-primary/40 bg-primary/10 px-6 py-6 text-center">
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
          type="button"
          className={`relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-outline-variant/40 bg-surface-container-lowest/50 p-8 transition lg:col-span-4 ${
            importing ? "cursor-wait opacity-90" : "cursor-pointer hover:border-primary/40 hover:bg-surface-container-low"
          }`}
          onClick={handleImport}
          disabled={importing}
          aria-busy={importing}
        >
          {importing && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-surface-container-lowest/80 backdrop-blur">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-container-high transition-transform hover:scale-110">
            <span className="material-symbols-outlined text-3xl text-primary">upload_file</span>
          </div>
          <h3 className="text-xl font-headline font-bold">Import Books</h3>
        </button>
      </section>

      {noteModalOpen && noteSessionId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-sm rounded-2xl border border-outline-variant/20 bg-surface-container-low p-6">
            <div className="text-xs uppercase tracking-widest text-on-surface-variant">Session Notes</div>
            <h3 className="mt-2 text-lg font-headline font-bold text-on-surface">Add a quick note</h3>
            <textarea
              className="mt-4 h-28 w-full resize-none rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface"
              placeholder="What did you read or learn?"
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
            />
            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                className="rounded-full border border-outline-variant/30 px-4 py-2 text-xs uppercase tracking-widest text-on-surface-variant transition hover:text-primary"
                onClick={() => {
                  setNoteModalOpen(false);
                  setNoteSessionId(null);
                  setNoteText("");
                }}
              >
                Skip
              </button>
              <button
                type="button"
                className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-on-primary"
                onClick={() => {
                  if (noteText.trim()) {
                    addSessionNote(noteSessionId, noteText.trim());
                  }
                  setNoteModalOpen(false);
                  setNoteSessionId(null);
                  setNoteText("");
                }}
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="flex flex-1 flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 className="text-3xl font-headline font-bold">The Archive</h2>
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
                className={`rounded-lg p-2 transition ${
                  filters.view === "grid"
                    ? "bg-surface-container-high text-primary"
                    : "bg-surface-container-low text-on-surface-variant hover:text-primary"
                }`}
                onClick={() => setFilter({ view: "grid" })}
              >
                <span className="material-symbols-outlined">grid_view</span>
              </button>
              <button
                type="button"
                className={`rounded-lg p-2 transition ${
                  filters.view === "list"
                    ? "bg-surface-container-high text-primary"
                    : "bg-surface-container-low text-on-surface-variant hover:text-primary"
                }`}
                onClick={() => setFilter({ view: "list" })}
              >
                <span className="material-symbols-outlined">list</span>
              </button>
            </div>
            <select
              className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant"
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
              className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant"
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
              className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant"
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
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-3xl border border-outline-variant/20 bg-surface-container-low p-8 text-center text-on-surface-variant">
              <p className="text-lg font-semibold text-on-surface">No books yet</p>
              <p className="max-w-md text-sm">
                Import {formatDisplayList(IMPORTABLE_EXTENSIONS)} files to populate your library.
              </p>
              <button
                className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary"
                type="button"
                onClick={handleImport}
              >
                Import your first book
              </button>
            </div>
          ) : filters.view === "grid" ? (
            <BookGrid books={filteredBooks} onRefresh={refreshMetadata} onOpen={onOpenBook} />
          ) : (
            <BookList books={filteredBooks} onRefresh={refreshMetadata} onOpen={onOpenBook} />
          )}
        </div>
      </section>
    </div>
  );
};
