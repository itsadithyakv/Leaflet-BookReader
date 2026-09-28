import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Book } from "@shared/models/book";
import { bookService } from "../services/bookService";
import {
  createComicPageSource,
  createPdfPageSource,
  isRenderCancelled,
  type PageSource
} from "../readers/pageSources";
import { getBookExtension } from "../constants/bookFormats";
import { useAppearanceStore } from "../store/appearanceStore";
import { useLibraryStore } from "../store/libraryStore";
import { useAutoHideChrome } from "../hooks/useAutoHideChrome";
import { useReadingHeartbeat } from "../hooks/useReadingHeartbeat";
import { PipExitGuard, useFocusLockExit } from "../hooks/useFocusLockExit";

/** Which page-image kind this book is; decides the source and the wording. */
export type PageReaderKind = "pdf" | "comic";

type PageReaderViewProps = {
  book: Book;
  kind: PageReaderKind;
  onClose: () => void;
};

type ReaderDisplayMode = "paper" | "dark-paper" | "true-white" | "true-black" | "app";

type PageReaderPreferences = {
  displayMode?: ReaderDisplayMode;
  fitWidth?: boolean;
  sidebarOpen?: boolean;
  zoom?: number;
};

type PageBookmark = {
  id: string;
  page: number;
  label: string;
  createdAt: string;
};

const resolveErrorMessage = (error: unknown, kind: PageReaderKind) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return kind === "comic"
    ? "Leaflet could not open this comic."
    : "Leaflet could not open this PDF.";
};

const readJson = <Value,>(key: string): Value | null => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Value) : null;
  } catch {
    return null;
  }
};

const readPageBookmarks = (key: string): PageBookmark[] => {
  const stored = readJson<unknown>(key);
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored.filter(
    (bookmark): bookmark is PageBookmark =>
      Boolean(bookmark) &&
      typeof bookmark === "object" &&
      typeof (bookmark as PageBookmark).id === "string" &&
      Number.isFinite((bookmark as PageBookmark).page) &&
      typeof (bookmark as PageBookmark).label === "string" &&
      typeof (bookmark as PageBookmark).createdAt === "string"
  );
};

// Page rows are absolutely positioned so the sidebar can virtualize a
// thousand-page PDF instead of mounting a button per page.
const PAGE_ROW_HEIGHT = 44;
const PAGE_ROW_GAP = 8;
const PAGE_ROW_OVERSCAN = 6;

// Holding an arrow key repeats at 30 turns a second, faster than most pages
// can draw; each turn would cancel the last and nothing would ever appear.
// Repeats are paced so a held key flips through pages visibly.
const KEY_REPEAT_TURN_MS = 150;

const getDisplayModeClass = (displayMode: ReaderDisplayMode) => {
  if (displayMode === "paper") {
    return "reader-paper-finish";
  }
  if (displayMode === "dark-paper") {
    return "reader-dark-paper-finish";
  }
  if (displayMode === "true-white") {
    return "reader-true-white-finish";
  }
  if (displayMode === "true-black") {
    return "reader-true-black-finish";
  }
  return "";
};

export const PageReaderView = ({ book, kind, onClose }: PageReaderViewProps) => {
  // Focus lock: leaving the book mid-session takes intent (see the hook).
  const exitGuard = useFocusLockExit(onClose);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentPageButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarOpenTimerRef = useRef<number | null>(null);
  const sidebarCloseTimerRef = useRef<number | null>(null);
  const morePanelCloseRef = useRef<number | null>(null);
  const lastScrolledPageRef = useRef<number | null>(null);
  const pendingProgressRef = useRef<number | null>(null);
  const lastKeyTurnRef = useRef(0);
  const pageListRef = useRef<HTMLDivElement>(null);
  const storageKey = useMemo(() => `leaflet.reader.${book.id}`, [book.id]);
  const bookmarksKey = useMemo(() => `leaflet.bookmarks.${book.id}`, [book.id]);
  const initialPreferences = useMemo(
    () => readJson<PageReaderPreferences>(storageKey),
    [storageKey]
  );

  const [source, setSource] = useState<PageSource | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(initialPreferences?.zoom ?? 1.15);
  const [effectiveZoom, setEffectiveZoom] = useState(initialPreferences?.zoom ?? 1.15);
  const [fitWidth, setFitWidth] = useState(initialPreferences?.fitWidth ?? true);
  const [displayMode, setDisplayMode] = useState<ReaderDisplayMode>(
    initialPreferences?.displayMode ?? "paper"
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [zoomPanelOpen, setZoomPanelOpen] = useState(false);
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false);
  const [morePanelOpen, setMorePanelOpen] = useState(false);
  // Same behaviour as the text reader: the bar gets out of the way of the page.
  const {
    visible: chromeVisible,
    reveal: revealChrome,
    hover: hoverChrome
  } = useAutoHideChrome(zoomPanelOpen || bookmarkPanelOpen || morePanelOpen);
  const [bookmarks, setBookmarks] = useState<PageBookmark[]>(
    () => readPageBookmarks(bookmarksKey)
  );
  const [coverData, setCoverData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from `error`: a page that fails to draw must not take the
  // canvas down with it, or the next page has nothing to draw into.
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [viewportRevision, setViewportRevision] = useState(0);
  const [pageListScrollTop, setPageListScrollTop] = useState(0);
  const [pageListHeight, setPageListHeight] = useState(0);
  const readerTheme = useAppearanceStore((state) => state.theme);
  const toggleTheme = useAppearanceStore((state) => state.toggleTheme);
  const updateBookProgress = useLibraryStore((state) => state.updateBookProgress);
  const markReadingActivity = useReadingHeartbeat(true);

  const pageCount = source?.pageCount ?? 0;
  const visiblePages = useMemo(() => {
    if (pageCount === 0 || pageListHeight === 0) {
      return [];
    }
    const first = Math.max(
      1,
      Math.floor(pageListScrollTop / PAGE_ROW_HEIGHT) + 1 - PAGE_ROW_OVERSCAN
    );
    const last = Math.min(
      pageCount,
      Math.ceil((pageListScrollTop + pageListHeight) / PAGE_ROW_HEIGHT) + PAGE_ROW_OVERSCAN
    );
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
  }, [pageCount, pageListHeight, pageListScrollTop]);
  const progress = useMemo(() => {
    if (pageCount <= 1) {
      return pageCount === 1 ? 1 : 0;
    }
    return (pageNumber - 1) / (pageCount - 1);
  }, [pageCount, pageNumber]);

  const goToPage = useCallback(
    (page: number) => {
      if (pageCount === 0) {
        return;
      }
      markReadingActivity();
      setPageNumber(Math.min(pageCount, Math.max(1, page)));
    },
    [markReadingActivity, pageCount]
  );

  const adjustZoom = useCallback(
    (delta: number) => {
      setFitWidth(false);
      setZoom(Math.min(3, Math.max(0.5, Number((effectiveZoom + delta).toFixed(2)))));
    },
    [effectiveZoom]
  );

  const toggleFitWidth = useCallback(() => {
    if (fitWidth) {
      setZoom(effectiveZoom);
      setFitWidth(false);
      return;
    }
    setFitWidth(true);
  }, [effectiveZoom, fitWidth]);

  const openReaderSidebar = useCallback(() => {
    if (sidebarCloseTimerRef.current) {
      window.clearTimeout(sidebarCloseTimerRef.current);
      sidebarCloseTimerRef.current = null;
    }
    if (sidebarOpenTimerRef.current) {
      window.clearTimeout(sidebarOpenTimerRef.current);
      sidebarOpenTimerRef.current = null;
    }
    setSidebarOpen(true);
  }, []);

  const scheduleReaderSidebarOpen = useCallback(() => {
    if (sidebarCloseTimerRef.current) {
      window.clearTimeout(sidebarCloseTimerRef.current);
      sidebarCloseTimerRef.current = null;
    }
    if (!sidebarOpenTimerRef.current) {
      sidebarOpenTimerRef.current = window.setTimeout(() => {
        setSidebarOpen(true);
        sidebarOpenTimerRef.current = null;
      }, 90);
    }
  }, []);

  const cancelReaderSidebarOpen = useCallback(() => {
    if (sidebarOpenTimerRef.current) {
      window.clearTimeout(sidebarOpenTimerRef.current);
      sidebarOpenTimerRef.current = null;
    }
  }, []);

  const scheduleReaderSidebarClose = useCallback(() => {
    if (sidebarOpenTimerRef.current) {
      window.clearTimeout(sidebarOpenTimerRef.current);
      sidebarOpenTimerRef.current = null;
    }
    if (sidebarCloseTimerRef.current) {
      window.clearTimeout(sidebarCloseTimerRef.current);
    }
    sidebarCloseTimerRef.current = window.setTimeout(() => {
      setSidebarOpen(false);
      sidebarCloseTimerRef.current = null;
    }, 230);
  }, []);

  useEffect(() => {
    let disposed = false;
    let opened: PageSource | null = null;

    setLoading(true);
    setError(null);
    setSource(null);

    const build = kind === "comic" ? createComicPageSource : createPdfPageSource;

    void build(book.id)
      .then((created) => {
        opened = created;
        if (disposed) {
          created.destroy();
          return;
        }
        const restoredPage = Math.min(
          created.pageCount,
          Math.max(1, Math.round(book.progress * Math.max(0, created.pageCount - 1)) + 1)
        );
        setSource(created);
        setPageNumber(restoredPage);
      })
      .catch((loadError) => {
        if (!disposed) {
          setError(resolveErrorMessage(loadError, kind));
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
      opened?.destroy();
    };
  }, [book.id, book.progress, kind]);

  useEffect(() => {
    if (!book.coverUrl) {
      setCoverData(null);
      return;
    }
    let disposed = false;
    void bookService.coverData(book.id).then((data) => {
      if (!disposed) {
        setCoverData(data);
      }
    });
    return () => {
      disposed = true;
    };
  }, [book.coverUrl, book.id]);

  useEffect(() => {
    const stage = scrollRef.current;
    if (!stage || !fitWidth) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setViewportRevision((revision) => revision + 1);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [fitWidth]);

  useEffect(() => {
    // Cleared before the canvas check so a failed page never outlives the
    // turn away from it. `loading` is a dependency because the canvas only
    // mounts once it clears.
    setRenderError(null);
    const canvas = canvasRef.current;
    if (!source || !canvas) {
      return;
    }

    let disposed = false;
    setRendering(true);

    const availableWidth = Math.max(320, (scrollRef.current?.clientWidth ?? 900) - 112);

    void source
      .render(pageNumber, canvas, { fitWidth, zoom, availableWidth })
      .then((scale) => {
        if (disposed) {
          return;
        }
        setEffectiveZoom(scale);
        setRendering(false);
        if (lastScrolledPageRef.current !== pageNumber) {
          lastScrolledPageRef.current = pageNumber;
          scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        }
      })
      .catch((failure) => {
        if (disposed) {
          return;
        }
        setRendering(false);
        // A cancelled render is a page turn overtaking it, not a failure.
        if (!isRenderCancelled(failure)) {
          setRenderError(resolveErrorMessage(failure, kind));
        }
      });

    return () => {
      disposed = true;
      source.cancelPending();
    };
  }, [fitWidth, kind, loading, pageNumber, renderAttempt, source, viewportRevision, zoom]);

  useEffect(() => {
    if (!source) {
      return;
    }
    updateBookProgress(book.id, progress);
    pendingProgressRef.current = progress;
    const handle = window.setTimeout(() => {
      pendingProgressRef.current = null;
      void bookService.updateProgress(book.id, progress);
    }, 600);
    return () => window.clearTimeout(handle);
  }, [book.id, source, progress, updateBookProgress]);

  // Flush whatever the debounce still owes when the reader closes.
  useEffect(() => {
    const bookId = book.id;
    return () => {
      const pending = pendingProgressRef.current;
      if (pending !== null) {
        pendingProgressRef.current = null;
        void bookService.updateProgress(bookId, pending);
      }
    };
  }, [book.id]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ displayMode, fitWidth, sidebarOpen, zoom })
      );
    } catch {
      // Local preferences are optional.
    }
  }, [displayMode, fitWidth, sidebarOpen, storageKey, zoom]);

  useEffect(() => {
    const list = pageListRef.current;
    if (!list) {
      return;
    }
    const measure = () => setPageListHeight(list.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [source]);

  // Scroll the virtual window itself — the active button may not be mounted yet.
  useEffect(() => {
    const list = pageListRef.current;
    if (!sidebarOpen || !list || pageCount === 0) {
      return;
    }
    const top = (pageNumber - 1) * PAGE_ROW_HEIGHT;
    const bottom = top + PAGE_ROW_HEIGHT;
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2 + PAGE_ROW_HEIGHT / 2);
    }
  }, [pageCount, pageNumber, sidebarOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "SELECT") {
        return;
      }
      const step =
        event.key === "ArrowLeft" || event.key === "PageUp"
          ? -1
          : event.key === "ArrowRight" || event.key === "PageDown"
            ? 1
            : 0;
      if (step !== 0) {
        event.preventDefault();
        const now = performance.now();
        if (event.repeat && now - lastKeyTurnRef.current < KEY_REPEAT_TURN_MS) {
          return;
        }
        lastKeyTurnRef.current = now;
        goToPage(pageNumber + step);
      } else if (event.key === "Escape") {
        exitGuard.escape(event);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToPage, exitGuard.escape, pageNumber]);

  useEffect(() => {
    return () => {
      if (sidebarOpenTimerRef.current) {
        window.clearTimeout(sidebarOpenTimerRef.current);
      }
      if (sidebarCloseTimerRef.current) {
        window.clearTimeout(sidebarCloseTimerRef.current);
      }
      if (morePanelCloseRef.current) {
        window.clearTimeout(morePanelCloseRef.current);
      }
    };
  }, []);

  const addBookmark = () => {
    if (bookmarks.some((bookmark) => bookmark.page === pageNumber)) {
      return;
    }
    const nextBookmarks = [
      ...bookmarks,
      {
        id: `${book.id}-${pageNumber}-${Date.now()}`,
        page: pageNumber,
        label: `Page ${pageNumber}`,
        createdAt: new Date().toISOString()
      }
    ];
    setBookmarks(nextBookmarks);
    try {
      window.localStorage.setItem(bookmarksKey, JSON.stringify(nextBookmarks));
    } catch {
      // Bookmarks remain available for this session.
    }
  };

  const displayModeClass = getDisplayModeClass(displayMode);
  const openingLabel = kind === "comic" ? "Opening comic…" : "Opening PDF…";

  return (
    <div
      className={`reader-scope pdf-reader page-reader fixed inset-0 z-50 h-full w-full overflow-hidden reader-bg ${
        chromeVisible ? "" : "reader-chrome-hidden"
      } ${
        readerTheme === "light" ? "reader-light" : ""
      } ${displayModeClass}`}
    >
      <header
        className="reader-toolbar fixed left-0 right-0 top-0 z-50 flex w-full items-center justify-between px-6 py-5 md:px-8"
        onPointerEnter={() => hoverChrome(true)}
        onPointerLeave={() => hoverChrome(false)}
        onFocus={revealChrome}
      >
        <div className="relative flex items-center gap-2 md:gap-4">
          <button
            type="button"
            className="group flex items-center gap-2 transition-all reader-icon reader-hover-accent"
            onClick={() => void exitGuard.requestClose()}
            onMouseEnter={() => exitGuard.guard()}
            title={exitGuard.locked ? "Focus lock is on: leaving ends the session" : undefined}
          >
            <span className="material-symbols-outlined transition-transform group-hover:-translate-x-1 reader-accent">
              arrow_back
            </span>
            <span className="hidden text-xs uppercase tracking-widest reader-accent sm:inline">
              Back to Library
            </span>
          </button>
          <PipExitGuard shown={exitGuard.guardShown} onDone={exitGuard.clearGuard} />
          {/* The page list otherwise opens only from a 6px hover strip, which a
              finger cannot hit and a touch screen cannot reveal. */}
          <button
            type="button"
            className="reader-chapters-toggle reader-icon transition-colors reader-hover-accent"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? "Hide pages" : "Show pages"}
          >
            <span className="material-symbols-outlined">list</span>
          </button>
        </div>

        <div className="absolute left-1/2 hidden -translate-x-1/2 flex-col items-center text-center md:flex">
          <h1 className="max-w-[42vw] truncate font-headline text-xl font-bold reader-accent">
            {book.title}
          </h1>
          <span className="text-xs uppercase tracking-[0.2em] reader-muted">
            {book.author ?? "Unknown author"}
          </span>
        </div>

        <div className="flex items-center gap-4 md:gap-6">
          <button
            className="reader-icon transition-colors reader-hover-accent"
            type="button"
            onClick={() => setZoomPanelOpen((open) => !open)}
            title="Page size"
          >
            <span className="material-symbols-outlined">text_fields</span>
          </button>
          {zoomPanelOpen && (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1 text-xs uppercase tracking-widest reader-panel-soft reader-border">
              <button
                type="button"
                className="rounded-md border px-2 py-1 transition reader-border reader-icon reader-hover-accent"
                onClick={() => adjustZoom(-0.15)}
              >
                A-
              </button>
              <span className="min-w-[48px] text-center">{Math.round(effectiveZoom * 100)}%</span>
              <button
                type="button"
                className="rounded-md border px-2 py-1 transition reader-border reader-icon reader-hover-accent"
                onClick={() => adjustZoom(0.15)}
              >
                A+
              </button>
            </div>
          )}

          <div className="relative">
            <button
              className="reader-icon transition-colors reader-hover-accent"
              type="button"
              onClick={() => setBookmarkPanelOpen((open) => !open)}
              title="Bookmarks"
            >
              <span className="material-symbols-outlined">bookmark</span>
            </button>
            {bookmarkPanelOpen && (
              <div className="absolute right-0 mt-3 w-64 rounded-xl border p-4 text-xs shadow-2xl reader-panel reader-border">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-widest reader-muted">Bookmarks</span>
                  <button
                    type="button"
                    className="rounded-md border px-2 py-1 text-[10px] uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
                    onClick={addBookmark}
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                  {bookmarks.length === 0 && (
                    <div className="rounded-lg border px-3 py-2 text-[11px] reader-border reader-muted reader-pill">
                      No bookmarks yet.
                    </div>
                  )}
                  {bookmarks.map((bookmark) => (
                    <button
                      key={bookmark.id}
                      type="button"
                      className="w-full rounded-lg border px-3 py-2 text-left text-[11px] transition reader-border reader-pill reader-icon reader-hover-accent"
                      onClick={() => {
                        goToPage(bookmark.page);
                        setBookmarkPanelOpen(false);
                      }}
                    >
                      <div className="text-xs font-semibold reader-text-color">{bookmark.label}</div>
                      <div className="text-[10px] uppercase tracking-widest reader-muted">
                        {new Date(bookmark.createdAt).toLocaleDateString()}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div
            className="relative"
            onMouseEnter={() => {
              if (morePanelCloseRef.current) {
                window.clearTimeout(morePanelCloseRef.current);
                morePanelCloseRef.current = null;
              }
              setMorePanelOpen(true);
            }}
            onMouseLeave={() => {
              if (morePanelCloseRef.current) {
                window.clearTimeout(morePanelCloseRef.current);
              }
              morePanelCloseRef.current = window.setTimeout(() => setMorePanelOpen(false), 180);
            }}
          >
            <button
              className="reader-icon transition-colors reader-hover-accent"
              type="button"
              onClick={() => setMorePanelOpen((open) => !open)}
              title="Reader settings"
            >
              <span className="material-symbols-outlined">more_horiz</span>
            </button>
            {morePanelOpen && (
              <div className="absolute right-0 mt-3 w-72 rounded-xl border p-4 text-xs shadow-2xl reader-panel reader-border">
                <div className="text-xs uppercase tracking-widest reader-muted">Reader</div>
                <label className="mt-3 block">
                  <span className="text-[10px] uppercase tracking-widest reader-muted">Page finish</span>
                  <select
                    className="reader-select mt-1.5 w-full"
                    value={displayMode}
                    onChange={(event) => setDisplayMode(event.target.value as ReaderDisplayMode)}
                  >
                    <option value="paper">Warm paper</option>
                    <option value="dark-paper">Dark paper</option>
                    <option value="true-white">True white</option>
                    <option value="true-black">True black</option>
                    <option value="app">Match app theme</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
                  onClick={toggleFitWidth}
                >
                  <span>Fit page width</span>
                  <span className="reader-toggle" data-on={fitWidth} />
                </button>
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
                  onClick={toggleTheme}
                >
                  <span>App theme</span>
                  <span className="reader-toggle" data-on={readerTheme === "light"} />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {/* The top edge of the window: resting the pointer here brings the bar
          back. The page is an iframe, so the bar cannot see the pointer
          arrive over the text; this strip can. */}
      {!chromeVisible && (
        <div className="reader-toolbar-hot-zone" aria-hidden="true" onPointerEnter={() => hoverChrome(true)}>
          <span className="reader-toolbar-handle" />
        </div>
      )}

      <div className="reader-shell">
        <div
          className="reader-sidebar-hot-zone"
          onMouseEnter={scheduleReaderSidebarOpen}
          onMouseLeave={cancelReaderSidebarOpen}
          aria-hidden="true"
        />
        <aside
          aria-hidden={!sidebarOpen}
          onMouseEnter={openReaderSidebar}
          onMouseLeave={scheduleReaderSidebarClose}
          onFocus={openReaderSidebar}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              scheduleReaderSidebarClose();
            }
          }}
          className={`reader-sidebar leather-surface flex w-72 flex-col border-r px-6 py-6 text-sm reader-border ${
            sidebarOpen
              ? "reader-sidebar-open"
              : "reader-sidebar-closed pointer-events-none"
          }`}
        >
          <div className="mb-6">
            {coverData ? (
              <div className="book-cover-frame mb-4 h-44 w-32 overflow-hidden border reader-border">
                <img src={coverData} alt={book.title} className="h-full w-full object-cover" />
              </div>
            ) : (
              <div className="pdf-reader-cover-placeholder book-cover-frame mb-4 flex h-44 w-32 items-center justify-center border reader-border">
                <span className="material-symbols-outlined">
                  {kind === "comic" ? "auto_stories" : "picture_as_pdf"}
                </span>
              </div>
            )}
            <h2 className="font-headline text-lg font-bold reader-text-color">{book.title}</h2>
            <p className="text-xs uppercase tracking-[0.2em] reader-muted">
              {book.author ?? "Unknown author"}
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.3em] reader-muted">Pages</div>
          <div
            ref={pageListRef}
            className="mt-4 flex-1 overflow-y-auto pr-2"
            onScroll={(event) => setPageListScrollTop(event.currentTarget.scrollTop)}
          >
            <div style={{ height: pageCount * PAGE_ROW_HEIGHT, position: "relative" }}>
              {visiblePages.map((page) => (
                <button
                  key={page}
                  ref={page === pageNumber ? currentPageButtonRef : undefined}
                  type="button"
                  style={{
                    position: "absolute",
                    top: (page - 1) * PAGE_ROW_HEIGHT,
                    left: 0,
                    right: 0,
                    height: PAGE_ROW_HEIGHT - PAGE_ROW_GAP
                  }}
                  className={`reader-chapter-link pdf-reader-page-link flex w-full items-center rounded-lg px-3 text-left text-sm transition reader-icon ${
                    page === pageNumber ? "reader-chapter-active font-semibold" : ""
                  }`}
                  onClick={() => {
                    goToPage(page);
                    setSidebarOpen(false);
                  }}
                >
                  Page {page}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Tapping the page is the expected way to dismiss a slide-over, and
            there is no hover-out to close it with on a touch screen. */}
        {sidebarOpen && (
          <button
            type="button"
            className="reader-sidebar-scrim md:hidden"
            aria-label="Close pages"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <main className="reader-main overflow-hidden">
          {error && !loading && (
            <div className="mx-auto mt-24 max-w-2xl rounded-xl border reader-border reader-panel p-6 text-center reader-muted">
              {error}
            </div>
          )}
          {!error && (
            <div className="reader-page-frame relative h-full overflow-hidden">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center gap-3 text-sm reader-panel-soft reader-muted">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  {openingLabel}
                </div>
              )}
              <div ref={scrollRef} className="reader-container pdf-reader-stage h-full w-full overflow-auto">
                {!loading && source && (
                  <div className={`pdf-reader-page ${rendering ? "pdf-reader-page-rendering" : ""}`}>
                    <canvas ref={canvasRef} aria-label={`Page ${pageNumber} of ${pageCount}`} />
                  </div>
                )}
              </div>
              {renderError && (
                <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
                  <div
                    role="alert"
                    className="max-w-md rounded-xl border p-6 text-center text-sm reader-border reader-panel reader-muted"
                  >
                    <p>{renderError}</p>
                    <button
                      type="button"
                      className="mt-4 rounded-md border px-3 py-1.5 text-xs uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
                      onClick={() => setRenderAttempt((attempt) => attempt + 1)}
                    >
                      Retry
                    </button>
                  </div>
                </div>
              )}
              {source && (
                <div className="reader-chapter-dock pointer-events-none absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center">
                  <div className="pointer-events-auto flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs uppercase tracking-widest reader-pill reader-border">
                    <button
                      type="button"
                      className="reader-mini-control"
                      onClick={() => goToPage(pageNumber - 1)}
                      disabled={pageNumber <= 1}
                      title="Previous page"
                    >
                      <span className="material-symbols-outlined text-base">chevron_left</span>
                    </button>
                    <span className="min-w-24 text-center text-[10px] reader-muted">
                      Page {pageNumber} of {pageCount}
                    </span>
                    <button
                      type="button"
                      className="reader-mini-control"
                      onClick={() => goToPage(pageNumber + 1)}
                      disabled={pageNumber >= pageCount}
                      title="Next page"
                    >
                      <span className="material-symbols-outlined text-base">chevron_right</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
