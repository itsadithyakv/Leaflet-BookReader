import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { BookGrid } from "../components/BookGrid";
import { BookList } from "../components/BookList";
import { isMetadataRetryDue, useLibraryStore } from "../store/libraryStore";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { hasFinished } from "../constants/books";
import type { Book, BookFilter } from "@shared/models/book";
import {
  dependencyFreeSummary,
  externalConverterCount,
  formatSummary,
  getBookExtension,
  isImportableExtension
} from "../constants/bookFormats";
import { flowerGrowing, getSessionProgress, sessionElapsedMs, useHabitStore, type ActiveSession } from "../store/habitStore";
import { UiIcon } from "../components/UiIcon";
import { FocusFlower, flowerCaption, flowerLook } from "../components/FocusFlower";
import { askConfirm } from "../components/ConfirmDialog";
import { MobileComingSoonBanner } from "../components/MobileComingSoonBanner";
import { useAddBooksRequest } from "../hooks/useAddBooksRequest";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { isAndroid, useTouchInput } from "../platform/device";
import { DailyHighlight } from "../components/highlights/DailyHighlight";
import { UpNextStrip } from "../components/UpNextStrip";
import { openHighlightsList, useHighlightsStore } from "../components/highlights/highlightsStore";
import { openLibrarySearch } from "../components/search/librarySearchStore";
import { searchable } from "../components/search/librarySearch";
import { librarySeries, type LibrarySeries } from "../library/series";
import { describeImport } from "../library/importSummary";
import { genreChoices, genreKey, inGenre } from "../library/genres";
import { PhoneFocusStrip, PhoneShelfTools } from "./library/PhoneLibrary";
import { FocusDouble } from "../components/focus/FocusDouble";
import { focusLengthsWith, rememberFocusMinutes, usualFocusMinutes } from "../components/focus/focusDeal";

const byTitle = (a: Book, b: Book) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

const sortBooks = (books: Book[], sort: BookFilter["sort"], series: LibrarySeries) => {
  const copy = [...books];
  if (sort === "title") {
    return copy.sort(byTitle);
  }
  if (sort === "author") {
    return copy.sort((a, b) => (a.author ?? "").localeCompare(b.author ?? "") || byTitle(a, b));
  }
  if (sort === "series") {
    // Each series together and in order, series A-Z; books in none after them.
    return copy.sort((a, b) => {
      const sa = series.byBook.get(a.id);
      const sb = series.byBook.get(b.id);
      if (!sa || !sb) {
        return sa ? -1 : sb ? 1 : byTitle(a, b);
      }
      return (
        sa.name.localeCompare(sb.name) ||
        (sa.index ?? Number.POSITIVE_INFINITY) - (sb.index ?? Number.POSITIVE_INFINITY) ||
        byTitle(a, b)
      );
    });
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
  { value: "title", label: "Title (A-Z)" },
  { value: "author", label: "Author (A-Z)" },
  { value: "series", label: "Series" }
];

export type LibraryPageProps = {
  onOpenBook: (book: Book) => void;
  onNavigate: (tab: "library" | "collections" | "social" | "settings") => void;
  showToast: (message: string) => void;
  /** Starts a focus session of this many minutes on the book being read (App's one-tap Focus). */
  onStartFocus?: (minutes: number) => void;
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

/**
 * Takes a layer that is drawn but hidden out of the tab order and away from
 * screen readers. Spread on, and as a string: React 18 does not know `inert`,
 * and drops an attribute it does not know when its value is `true`.
 */
const inertWhen = (hidden: boolean) => (hidden ? { inert: "" } : {});

/**
 * The running session's ring: the time left, how far through it is, and its
 * flower. The second's tick is kept in here, so the page and every book on it
 * are not drawn again each second. It also ends a session that has run out.
 */
const SessionRing = ({ session, sessionDuration }: { session: ActiveSession | null; sessionDuration: number }) => {
  const stopSession = useHabitStore((state) => state.stopSession);
  const [sessionTick, setSessionTick] = useState(0);
  const [sessionRemaining, setSessionRemaining] = useState<number | null>(null);
  const focusProgress = session ? getSessionProgress(session) : 0;
  const focusPercent = Math.min(100, Math.round(focusProgress * 100));

  useEffect(() => {
    if (!session) {
      setSessionRemaining(null);
      return;
    }
    const timer = window.setInterval(() => {
      setSessionTick((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!session) {
      setSessionRemaining(null);
      return;
    }
    const totalSeconds = session.durationMinutes * 60;
    const elapsedSeconds = Math.round(sessionElapsedMs(session) / 1000);
    const remaining = Math.max(0, totalSeconds - elapsedSeconds);
    const minutesLeft = Math.ceil(remaining / 60);
    setSessionRemaining(minutesLeft);
    if (remaining <= 0) {
      void stopSession({ reason: "completed", cleanSession: true });
    }
  }, [session, sessionTick]);

  return (
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
        {session?.flower ? (
          // A session in full screen grows its flower inside the ring.
          <div className="absolute inset-0 flex items-center justify-center pb-1">
            <FocusFlower
              kind={session.flower.kind}
              {...flowerLook(session.flower, focusProgress)}
              box={72}
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-sm uppercase tracking-widest text-on-surface-variant">
            <span className="text-2xl font-semibold text-primary">
              {sessionRemaining ?? sessionDuration}m
            </span>
            <span className="text-[11px] text-on-surface-variant/70">remaining</span>
          </div>
        )}
      </div>
      <div className="text-[11px] uppercase tracking-widest text-on-surface-variant">
        {session?.flower ? `${sessionRemaining ?? sessionDuration}m left · ` : ""}
        {focusPercent}% complete
      </div>
      {session?.flower && (
        <p className="max-w-[13rem] text-[11px] leading-snug text-on-surface-variant">
          {flowerCaption(session.flower, focusProgress)}
        </p>
      )}
    </div>
  );
};

export const LibraryPage = ({ onOpenBook, onNavigate, showToast, onStartFocus }: LibraryPageProps) => {
  const { books, filters, loading, importing, importBooks, importFiles, refreshMetadata, fetchCover, setFilter } =
    useLibraryStore(
      useShallow((state) => ({
        books: state.books,
        filters: state.filters,
        loading: state.loading,
        importing: state.importing,
        importBooks: state.importBooks,
        importFiles: state.importFiles,
        refreshMetadata: state.refreshMetadata,
        fetchCover: state.fetchCover,
        setFilter: state.setFilter
      }))
    );
  // The session clock runs only while a book is open and being read.
  const sessionReading = useHabitStore((state) => state.readingAt !== null);
  const { activeSession, startSession, stopSession, snapshot } =
    useHabitStore(
      useShallow((state) => ({
        activeSession: state.activeSession,
        startSession: state.startSession,
        stopSession: state.stopSession,
        snapshot: state.snapshot
      }))
    );
  // Full screen for sessions (Settings calls it focus lock): chosen right
  // where a session starts, since it is what plants a focus flower.
  const fullScreen = useHabitStore((state) => state.focusSettings.kioskMode);
  const setFocusSettings = useHabitStore((state) => state.setFocusSettings);
  // The usual length (the last chosen, else the goal), so Start is one tap.
  const [chosenDuration, setChosenDuration] = useState<number | null>(null);
  const sessionDuration = chosenDuration ?? usualFocusMinutes(snapshot.goalMinutes);
  const setSessionDuration = (minutes: number) => {
    setChosenDuration(minutes);
    rememberFocusMinutes(minutes);
  };
  const todayMinutes = snapshot.todayMinutes;
  const goalMet = snapshot.todayMet;
  const goalPercent =
    snapshot.goalMinutes > 0
      ? Math.min(100, Math.round((todayMinutes / snapshot.goalMinutes) * 100))
      : 0;
  const [dropActive, setDropActive] = useState(false);
  const importDropRef = useRef<HTMLButtonElement>(null);
  const debouncedQuery = useDebouncedValue(filters.query, 250);

  const authors = useMemo(() => {
    return Array.from(new Set(books.map((book) => book.author).filter(Boolean))) as string[];
  }, [books]);

  // One for each genre, however its books spell it ("Sci-fi", "Science Fiction"), as on the Collections page's tiles.
  const genres = useMemo(() => genreChoices(books), [books]);

  const series = librarySeries(books);
  const filteredBooks = useMemo(() => {
    let result = books;
    if (filters.author !== "all") {
      result = result.filter((book) => book.author === filters.author);
    }
    if (filters.genre !== "all") {
      const genre = genreKey(filters.genre);
      result = result.filter((book) => inGenre(book, genre));
    }
    if (debouncedQuery.trim().length > 0) {
      const query = debouncedQuery.toLowerCase();
      result = result.filter((book) => {
        const haystack = `${book.title} ${book.author ?? ""} ${book.genres.join(" ")} ${series.byBook.get(book.id)?.name ?? ""}`.toLowerCase();
        return haystack.includes(query);
      });
    }
    return sortBooks(result, filters.sort, series);
  }, [books, filters.author, filters.genre, filters.sort, debouncedQuery, series]);

  // Highlights across the library, for the button that lists them. Counted
  // again whenever the library changes (a sync can bring highlights with it);
  // the app counts again when a book is closed.
  const highlightCounts = useHighlightsStore((state) => state.counts);
  const loadHighlightCounts = useHighlightsStore((state) => state.loadCounts);
  useEffect(() => {
    void loadHighlightCounts();
  }, [books, loadHighlightCounts]);
  const highlightTotal = useMemo(
    () => books.reduce((sum, book) => sum + (highlightCounts[book.id] ?? 0), 0),
    [books, highlightCounts]
  );

  const totalBooks = books.length;
  // A count goes by `hasFinished`, as Social's does: a book read once and begun again still counts.
  const finishedBooks = books.filter(hasFinished).length;
  /** No books at all (not merely none matching): the page leads with importing. */
  const libraryEmpty = !loading && totalBooks === 0;
  /** The words in the search box, when there are enough of them to look for inside the books (the app only). */
  const insideQuery = isTauri() && totalBooks > 0 ? searchable(filters.query) : null;
  const filtersNarrowed =filters.author !== "all" || filters.genre !== "all";
  // The streak everything else shows (goal days in a row, by the reader's own
  // day). This used to count days a book was opened, by UTC day, and read
  // "Start Your Streak" until a book was opened today.
  const streakTitle = snapshot.streak > 0 ? `${snapshot.streak} Day Streak!` : "Start Your Streak";
  // The streak itself is the header's flame chip (components/streak); this card says where today stands.
  const minutesLeft = Math.max(0, Math.ceil(snapshot.goalMinutes - todayMinutes));
  const todayTitle = goalMet ? "Today's goal met" : todayMinutes > 0 ? `${minutesLeft} min to go today` : "Read today";

  const handleImport = () => {
    // What the library held before, so a book it already had is not called added.
    const known = new Set(useLibraryStore.getState().books.map((book) => book.id));
    importBooks()
      // The dialog used to say nothing: not what came in, and not that a file
      // among them had failed. It says what a drop says. Closed with nothing
      // chosen, there is nothing to say.
      .then((outcome) => {
        if (outcome) {
          showToast(describeImport(outcome.asked, outcome.books, known, outcome.failed));
        }
      })
      .catch((error) => {
        showToast(resolveErrorMessage(error, "Import failed. Try again."));
      });
  };

  // The header's + (a phone held sideways) asks for the same.
  useAddBooksRequest(() => {
    if (!importing) {
      handleImport();
    }
  });
  const touch = useTouchInput();
  // A phone has a + of its own (over the tab bar upright, in the header
  // sideways), so once there are books the big import box gives its screen to them.
  const phoneShape = useMediaQuery("(max-width: 767px) and (min-height: 521px), (max-height: 520px)");
  const importBox = libraryEmpty || !phoneShape;
  // A phone by a finger: the streak and session in a slim card, the shelf's filters behind one key
  // (pages/library/PhoneLibrary.tsx). A small desktop window keeps the full ones.
  const phone = touch && phoneShape;

  /** A book's ⋯ menu removed it (the menu asks first, and has no toast of its own). */
  const sayRemoved = useCallback((title: string) => showToast(`Removed ${title}.`), [showToast]);

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
      // What the library held before, so a book it already had is not called added.
      const known = new Set(useLibraryStore.getState().books.map((book) => book.id));
      // All of them, not only the ones Leaflet opens: a picture or a zip dropped
      // among the books is then named as not added, where it used to vanish.
      importFiles(paths)
        .then((outcome) => showToast(describeImport(outcome.asked, outcome.books, known, outcome.failed)))
        .catch((error) => {
          showToast(resolveErrorMessage(error, "Import failed. Try again."));
        });
    },
    [importFiles, importing, showToast]
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
    if (onStartFocus) {
      onStartFocus(sessionDuration);
      return;
    }
    startSession({
      startedAt: new Date().toISOString(),
      durationMinutes: sessionDuration
    });
  };

  const handleEndSession = async () => {
    // A flower still growing wilts if the session ends early: say so first.
    const session = useHabitStore.getState().activeSession;
    if (session?.flower && flowerGrowing(session)) {
      const confirmed = await askConfirm({
        title: "End the session early?",
        body: `Your ${session.flower.kind} wilts if you stop now. The minutes you read still count.`,
        confirmLabel: "End session",
        cancelLabel: "Keep reading",
        danger: true,
        pip: "sob"
      });
      if (!confirmed || !useHabitStore.getState().activeSession) {
        return;
      }
    }
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

  // On a phone: one key in the search row at rest, a slim card while a session runs (PhoneLibrary).
  const focusStrip = (
    <PhoneFocusStrip
      streakTitle={streakTitle}
      session={activeSession}
      reading={sessionReading}
      duration={sessionDuration}
      setDuration={setSessionDuration}
      fullScreen={fullScreen}
      toggleFullScreen={() => setFocusSettings({ kioskMode: !fullScreen })}
      onStart={handleStartSession}
      onEnd={() => void handleEndSession()}
    />
  );

  return (
    <div className={`library-page dock-clear mx-auto flex min-h-full w-full max-w-[2240px] flex-col ${phone ? "gap-5" : "gap-10"}`}>
      {/* From md the header carries search: a phone on its side keeps only the Focus key here. */}
      <div className={phone ? "phone-search-row" : "md:hidden"}>
        <div className="relative min-w-0 flex-1 md:hidden">
          <UiIcon
            name="search"
            size={19}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant"
          />
          <input
            className="inset-field w-full py-2.5 pl-12 pr-4 text-sm text-on-surface focus:border-primary/40 focus:outline-none"
            placeholder="Search your library…"
            aria-label="Search your library"
            type="search"
            enterKeyHint="search"
            // It searches as it is typed: the phone's search key only puts the keyboard away.
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            value={filters.query}
            onChange={(event) => setFilter({ query: event.target.value })}
          />
        </div>
        {phone && !activeSession && focusStrip}
      </div>

      {/* News about the phone app can wait until there is a library to carry over. */}
      {!libraryEmpty && !isAndroid() && <MobileComingSoonBanner />}

      {/* A running session is a slim card under the search; at rest the key is in the search row. */}
      {phone && activeSession && focusStrip}

      {/* Side by side wherever the rail is: stacked, the pair is 456 px tall and
          pushes the first row of covers off a laptop's first screen. */}
      {(!phone || importBox) && (
      <section className="grid min-w-0 gap-6 md:grid-cols-12">
        {/* clip, not hidden: the resting and running layers are stacked, and an
            overflow-hidden box is still scrollable, so focusing Pip's button
            scrolled the card to reveal the taller hidden layer. */}
        {!phone && (
        <div
          className={`paper-surface relative min-w-0 overflow-clip rounded-xl p-6 ${libraryEmpty ? "order-2 md:col-span-5 xl:col-span-4" : "md:col-span-7 xl:col-span-8"}`}
        >
          <div className="relative z-10">
            <div className="relative">
              <div
                {...inertWhen(Boolean(activeSession))}
                className={`transition-all duration-500 ease-out will-change-transform will-change-opacity ${
                  activeSession
                    ? "opacity-0 -translate-y-3 pointer-events-none absolute inset-0"
                    : "opacity-100 translate-y-0"
                }`}
              >
                <div className="min-w-0">
                  <div>
                    <h1 className="page-title library-hero-title text-4xl md:text-5xl">{todayTitle}</h1>
                    <div
                      className="mt-3 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-surface-container-highest"
                      title={`${Math.round(todayMinutes)} of ${snapshot.goalMinutes} minutes today`}
                      aria-hidden="true"
                    >
                      <div className="h-full rounded-full bg-primary/80 transition-[width] duration-500" style={{ width: `${goalPercent}%` }} />
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-3">
                  <div className="inset-field flex min-w-0 flex-wrap items-center gap-4 p-3" data-tour="session">
                    <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Focus Session</p>
                    <div className="ml-auto flex flex-wrap items-center gap-3">
                      <select
                        className="inset-field px-3 py-2 text-xs text-on-surface-variant"
                        aria-label="Session length"
                        value={sessionDuration}
                        onChange={(event) => setSessionDuration(Number(event.target.value))}
                        disabled={Boolean(activeSession)}
                      >
                        {focusLengthsWith(sessionDuration).map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutes} min
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={fullScreen}
                        className="focus-fullscreen-switch"
                        onClick={() => setFocusSettings({ kioskMode: !fullScreen })}
                        title="Read in full screen and grow a focus flower. It blooms if you stay until the session ends."
                      >
                        <span className="focus-fullscreen-track" aria-hidden="true" />
                        Full screen
                      </button>
                      <button
                        type="button"
                        className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold"
                        onClick={handleStartSession}
                      >
                        Start Session
                        <FocusDouble />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div
                {...inertWhen(!activeSession)}
                className={`transition-all duration-500 ease-out will-change-transform will-change-opacity ${
                  activeSession
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-3 pointer-events-none absolute inset-0"
                }`}
              >
                {/* The ring keeps its own width beside the words from 960 px, where the
                    panel has room for both. An empty library gives this panel a third
                    of the row: too narrow, so the ring goes under the words. */}
                <div
                  className={`grid min-w-0 gap-6 [@media(min-width:960px)]:items-center ${libraryEmpty ? "" : "[@media(min-width:960px)]:grid-cols-[minmax(0,1fr)_auto]"}`}
                >
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-on-surface-variant">Focus Mode</p>
                    <h1 className="page-title library-hero-title mt-2 text-4xl md:text-5xl">Session Running</h1>
                    <p className="mt-3 text-sm text-on-surface-variant">
                      {sessionReading
                        ? "Stay in the flow. Your focus session is active."
                        : "The timer runs while you read. Open a book to carry on."}
                    </p>
                    <div className="mt-4">
                      <button
                        type="button"
                        className="tactile-button tactile-button-primary px-5 py-2 text-xs font-semibold"
                        onClick={() => void handleEndSession()}
                      >
                        End Session
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-start [@media(min-width:960px)]:justify-end">
                    <SessionRing session={activeSession} sessionDuration={sessionDuration} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        {importBox && (
        <button
          ref={importDropRef}
          data-tour="import"
          type="button"
          className={`import-drop-zone paper-surface relative flex min-w-0 flex-col items-center justify-center p-8 ${libraryEmpty ? "order-1 md:col-span-7 xl:col-span-8" : "md:col-span-5 xl:col-span-4"} ${
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
          <h3 className="page-title text-2xl">{libraryEmpty ? "Add your first book" : "Import Books"}</h3>
          <p className="mt-2 max-w-xs text-center text-sm text-on-surface-variant">
            {touch ? "Tap to add books" : "Drop a book here, or click to browse"}
          </p>
          {/* With books to show, a window short of height drops this line (index.css). */}
          <p className={`mt-3 max-w-xs text-center text-xs leading-5 text-on-surface-variant/75 ${libraryEmpty ? "" : "import-formats"}`}>
            {dependencyFreeSummary()} open straight away.
            <br />
            {/* A phone has no converter; its own Kindle reader takes most MOBI and AZW3 books. */}
            {isAndroid() ? "Kindle books (MOBI, AZW3) open too." : `${externalConverterCount()} more formats need the optional converter.`}
          </p>
        </button>
        )}
      </section>
      )}

      <UpNextStrip onOpen={onOpenBook} onSeeAll={() => onNavigate("collections")} />

      {/* One of the reader's own highlights, once a day; nothing when there are none. */}
      {!libraryEmpty && <DailyHighlight />}

      <section className="flex flex-1 flex-col gap-6">
        {phone ? (
          // Pip does not perch on the first row of books under this: on a phone it is too close, and she covered the count.
          <div className="flex items-center justify-between gap-3" data-pip-keep-clear>
            <div className="min-w-0">
              <h2 className="page-title text-3xl">Library</h2>
              <p className="mt-1 truncate text-xs text-on-surface-variant">
                {totalBooks} {totalBooks === 1 ? "book" : "books"} · {finishedBooks} finished

              </p>
            </div>
            {!libraryEmpty && (
              <PhoneShelfTools
                filters={filters}
                setFilter={setFilter}
                authors={authors}
                genres={genres}
                genreValue={filters.genre === "all" ? "all" : genreKey(filters.genre)}
                sortOptions={sortOptions}
                highlightTotal={highlightTotal}
                openHighlights={openHighlightsList}
              />
            )}
          </div>
        ) : (
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 className="page-title text-4xl">Library</h2>
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
          <div className="library-toolbar flex flex-wrap items-center gap-3">
            {/* Every highlight in the library, by book, without opening one. */}
            {!libraryEmpty && (
              <button
                type="button"
                className="tactile-button flex items-center gap-2 px-3 py-2 text-xs font-semibold"
                onClick={openHighlightsList}
                title="The text you have highlighted, book by book"
              >
                <UiIcon name="highlight" size={16} />
                Highlights
                {highlightTotal > 0 && <span className="tabular-nums text-on-surface-variant">{highlightTotal}</span>}
              </button>
            )}
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
            {/* A select is as wide as its longest option: one author with a long
                name used to push the page sideways. */}
            <select
              className="inset-field max-w-[9rem] truncate px-3 py-2 text-xs text-on-surface-variant"
              aria-label="Author"
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
              className="inset-field max-w-[9rem] truncate px-3 py-2 text-xs text-on-surface-variant"
              aria-label="Genre"
              value={filters.genre === "all" ? "all" : genreKey(filters.genre)}
              onChange={(event) => setFilter({ genre: event.target.value })}
            >
              <option value="all">All genres</option>
              {genres.map((genre) => (
                <option key={genre.key} value={genre.key}>
                  {genre.name}
                </option>
              ))}
            </select>
            <select
              className="inset-field px-3 py-2 text-xs text-on-surface-variant"
              aria-label="Sort by"
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
        )}

        {/* The search box finds books by title and author; this looks for the
            same words inside them. In the app only: the browser preview has no
            files to read. */}
        {insideQuery && (
          <button
            type="button"
            className="-my-2 flex max-w-full items-center gap-2 self-start rounded-lg px-2 py-1.5 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => openLibrarySearch(insideQuery)}
            title="Looks for these words in the text of every book"
          >
            <UiIcon name="search" size={15} className="shrink-0" />
            <span className="min-w-0 truncate">Search inside books for “{insideQuery}”</span>
          </button>
        )}

        <div className="flex-1 min-h-[480px]">
          {loading ? (
            <div className="flex h-full items-center justify-center text-on-surface-variant">
              Loading your library...
            </div>
          ) : libraryEmpty ? (
            // The import box above is the one way in; a second button here made three.
            <div className="paper-surface flex h-full flex-col items-center justify-center gap-2 rounded-xl p-8 text-center text-on-surface-variant">
              <p className="text-lg font-semibold text-on-surface">Your books will appear here</p>
              <p className="max-w-md text-sm">
                {touch ? `${dependencyFreeSummary()} open straight away.` : `${dependencyFreeSummary()} open straight away; drop one anywhere on this page.`}
              </p>
            </div>
          ) : filteredBooks.length === 0 ? (
            <div className="paper-surface flex h-full flex-col items-center justify-center gap-3 rounded-xl p-8 text-center text-on-surface-variant">
              <p className="text-lg font-semibold text-on-surface">No matches</p>
              <p className="max-w-md text-sm">
                {filters.query.trim()
                  ? `No book in your library matches “${filters.query.trim()}”${filtersNarrowed ? " with these filters" : ""}.`
                  : "No book in your library matches these filters."}
              </p>
              <button
                className="tactile-button px-4 py-2 text-sm font-semibold"
                type="button"
                onClick={() => setFilter({ query: "", author: "all", genre: "all" })}
              >
                Clear search and filters
              </button>
            </div>
          ) : filters.view === "grid" ? (
            <BookGrid books={filteredBooks} onRefresh={refreshMetadata} onOpen={onOpenBook} onRemoved={sayRemoved} />
          ) : (
            <BookList books={filteredBooks} onRefresh={refreshMetadata} onOpen={onOpenBook} onRemoved={sayRemoved} />
          )}
        </div>
      </section>

      {/* Upright in a narrow desktop window: a round + over the foot of the page. On a phone by a finger
          the + is in the header instead (App.tsx), where nothing on the shelf can sit under it. */}
      <button
        type="button"
        className="add-books-fab"
        data-tour={importBox ? undefined : "import"}
        onClick={handleImport}
        disabled={importing}
        aria-label="Add books"
        title="Add books"
      >
        <UiIcon name="plus" size={26} strokeWidth={2.2} />
      </button>
    </div>
  );
};
