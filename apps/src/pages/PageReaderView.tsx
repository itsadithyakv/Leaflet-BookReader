import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Book } from "@shared/models/book";
import { bookService } from "../services/bookService";
import {
  createComicPageSource,
  createPdfPageSource,
  isRenderCancelled,
  type PageSource
} from "../readers/pageSources";
import { pageToneFor, toneCss } from "../readers/pageTone";
import { toolbarTitleClass } from "../readers/titleFit";
import {
  inPageOrder,
  isBookmarked,
  parsePageBookmarks,
  removeBookmark,
  toggleBookmark,
  type PageBookmark
} from "../readers/pageBookmarks";
import {
  clickTurn,
  pagePercent,
  parsePageEntry,
  readingKeyAction,
  sideStep,
  type ReadingDirection
} from "../readers/pageKeys";
import {
  anchoredScroll,
  scaleFor,
  steppedZoom,
  wheelZoom,
  zoomPercent,
  type PageFit
} from "../readers/pageZoom";
import {
  READING_ACTIONS,
  pageActionFor,
  pageShortcutContext,
  pageShortcutSections,
  worksWhileTyping,
  type PageKeyContext
} from "../readers/pageReaderKeys";
import { pagesLabel, roomForSpread, turnFrom } from "../readers/pageSpread";
import { currentOutlineIndex, type OutlineEntry } from "../readers/pdfOutline";
import {
  PdfScrollPages,
  placeToOpen,
  type ScrollPagesHandle,
  type StoredPlace
} from "../readers/PdfScrollPages";
import { PdfSearchPanel } from "../readers/PdfSearchPanel";
import type { PdfSearchHit } from "../readers/pdfSearch";
import { findMatches, matchRects, type MeasureText, type PageRect } from "../readers/pdfText";
import { bindTextSelection } from "../readers/pdfTextLayer";
import { ShortcutsSheet } from "../readers/ShortcutsSheet";
import { UiIcon } from "../components/UiIcon";
import { useAppearanceStore } from "../store/appearanceStore";
import { useLibraryStore } from "../store/libraryStore";
import { useAutoHideChrome } from "../hooks/useAutoHideChrome";
import { useReadingHeartbeat } from "../hooks/useReadingHeartbeat";
import { PipExitGuard, useFocusLockExit } from "../hooks/useFocusLockExit";
import "../readers/pdfTextLayer.css";
import "./PageReaderView.css";

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
  /** How the page is sized (readers/pageZoom.ts). */
  fit?: PageFit;
  /** What `fit` was before there were three of them; still written, for an older Leaflet. */
  fitWidth?: boolean;
  sidebarOpen?: boolean;
  zoom?: number;
  /** A comic read right to left (manga). */
  direction?: ReadingDirection;
  /** A comic shown two pages side by side when the window is wide. */
  twoPages?: boolean;
  /** A PDF a page at a time, or all its pages in one scroll (readers/pageScroll.ts). */
  layout?: PageLayout;
  /** Where the top of the window was in the scroll, to reopen at the same line. */
  place?: StoredPlace;
};

type PageLayout = "pages" | "scroll";

/**
 * A PDF opened for the first time scrolls; one that already has preferences
 * from before there was a choice keeps the pages it was read in. Comics are
 * always paged.
 */
const storedLayout = (preferences: PageReaderPreferences | null, kind: PageReaderKind): PageLayout => {
  if (kind !== "pdf") {
    return "pages";
  }
  if (!preferences) {
    return "scroll";
  }
  return preferences.layout === "scroll" ? "scroll" : "pages";
};

const FITS: PageFit[] = ["width", "page", "actual", "free"];

const storedFit = (preferences: PageReaderPreferences | null): PageFit => {
  if (preferences?.fit && FITS.includes(preferences.fit)) {
    return preferences.fit;
  }
  return preferences?.fitWidth === false ? "free" : "width";
};

/** The search's marks on one page: a list of rectangles for each match, in order. */
type PageMarks = { page: number; rects: PageRect[][] };

const NO_MARKS: PageMarks = { page: 0, rects: [] };

/** A place on the page to keep under a place in the window while the page changes size. */
type ZoomAnchor = { fx: number; fy: number; px: number; py: number };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

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

const readPageBookmarks = (key: string): PageBookmark[] => parsePageBookmarks(readJson<unknown>(key));

// Rows are absolutely positioned so the sidebar can virtualize a
// thousand-page PDF, or a table of contents as long, instead of mounting a
// button for each.
const PAGE_ROW_HEIGHT = 44;
const PAGE_ROW_GAP = 8;
const PAGE_ROW_OVERSCAN = 6;

// Holding an arrow key repeats at 30 turns a second, faster than most pages
// can draw; each turn would cancel the last and nothing would ever appear.
// Repeats are paced so a held key flips through pages visibly.
const KEY_REPEAT_TURN_MS = 150;

/** A search marks at most this many matches on one page. */
const MARKS_PER_PAGE = 400;

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

const FIT_CHOICES: Array<{ fit: PageFit; label: string; hint: string }> = [
  { fit: "width", label: "Width", hint: "Fit the page's width (Ctrl+1)" },
  { fit: "page", label: "Page", hint: "Fit the whole page (Ctrl+2)" },
  { fit: "actual", label: "100%", hint: "Actual size (Ctrl+0)" }
];

export const PageReaderView = ({ book, kind, onClose }: PageReaderViewProps) => {
  // Focus lock: leaving the book mid-session takes intent (see the hook).
  const exitGuard = useFocusLockExit(onClose);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const goToInputRef = useRef<HTMLInputElement>(null);
  const sidebarOpenTimerRef = useRef<number | null>(null);
  const sidebarCloseTimerRef = useRef<number | null>(null);
  const morePanelCloseRef = useRef<number | null>(null);
  const lastScrolledPageRef = useRef<number | null>(null);
  const pendingProgressRef = useRef<number | null>(null);
  const lastKeyTurnRef = useRef(0);
  const pageListRef = useRef<HTMLDivElement>(null);
  // Which end of the next page to show: the top, or the bottom when the
  // reader came to it going backwards.
  const landRef = useRef<"top" | "bottom">("top");
  // The size of the page on show at scale 1, and the scale it is (or is about
  // to be) shown at. Refs, because zooming reads them between renders.
  const naturalRef = useRef<{ width: number; height: number } | null>(null);
  const scaleRef = useRef(1);
  const anchorRef = useRef<ZoomAnchor | null>(null);
  const measureContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const shownHitRef = useRef<string | null>(null);
  const storageKey = useMemo(() => `leaflet.reader.${book.id}`, [book.id]);
  const bookmarksKey = useMemo(() => `leaflet.bookmarks.${book.id}`, [book.id]);
  const initialPreferences = useMemo(
    () => readJson<PageReaderPreferences>(storageKey),
    [storageKey]
  );

  const [source, setSource] = useState<PageSource | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  // The page the canvas shows; behind `pageNumber` while the next is drawn.
  const [drawnPage, setDrawnPage] = useState(0);
  const [zoom, setZoom] = useState(initialPreferences?.zoom ?? 1.15);
  const [effectiveZoom, setEffectiveZoom] = useState(initialPreferences?.zoom ?? 1.15);
  const [fit, setFit] = useState<PageFit>(() => storedFit(initialPreferences));
  const [displayMode, setDisplayMode] = useState<ReaderDisplayMode>(
    initialPreferences?.displayMode ?? "paper"
  );
  const [direction, setDirection] = useState<ReadingDirection>(
    kind === "comic" && initialPreferences?.direction === "rtl" ? "rtl" : "ltr"
  );
  const [twoPages, setTwoPages] = useState(kind === "comic" && initialPreferences?.twoPages === true);
  const [layout, setLayout] = useState<PageLayout>(() => storedLayout(initialPreferences, kind));
  const scrollPagesRef = useRef<ScrollPagesHandle>(null);
  // Where the scroll was last, as stored; and where the scroll opens, set when the book (or the layout) does.
  const placeRef = useRef<StoredPlace | null>(initialPreferences?.place ?? null);
  const [openPlace, setOpenPlace] = useState<StoredPlace | null>(null);
  // The pages the canvas shows, and the page they were drawn for: a comic's
  // facing pages are two.
  const [shown, setShown] = useState<{ for: number; pages: number[] }>({ for: 0, pages: [] });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // What the sidebar lists. Not chosen yet: the PDF's contents when it has any.
  const [sidebarTab, setSidebarTab] = useState<"contents" | "pages" | null>(null);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [zoomPanelOpen, setZoomPanelOpen] = useState(false);
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false);
  const [morePanelOpen, setMorePanelOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeHit, setActiveHit] = useState<PdfSearchHit | null>(null);
  const [marks, setMarks] = useState<PageMarks>(NO_MARKS);
  const [goToOpen, setGoToOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [goToEntry, setGoToEntry] = useState("");
  // Same behaviour as the text reader: the bar gets out of the way of the page.
  const {
    visible: chromeVisible,
    reveal: revealChrome,
    hover: hoverChrome
  } = useAutoHideChrome(zoomPanelOpen || bookmarkPanelOpen || morePanelOpen || searchOpen);
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
  // The finish reaches the page itself (readers/pageTone.ts): a PDF used to
  // stay a white rectangle in the middle of a dark reader. A comic is art,
  // and is shown as drawn.
  const tone = useMemo(
    () => (kind === "pdf" ? pageToneFor(displayMode, readerTheme) : null),
    [displayMode, kind, readerTheme]
  );

  const pdf = source?.pdf ?? null;
  const scrolling = layout === "scroll" && kind === "pdf";
  // What the keys do depends on these; the handler and the shortcuts sheet read the same table.
  const keyContext = useMemo<PageKeyContext>(
    () => ({ kind, layout: scrolling ? "scroll" : "pages", direction }),
    [direction, kind, scrolling]
  );
  const spreadRtl = twoPages && direction === "rtl";
  const pageCount = source?.pageCount ?? 0;
  const actualScale = source?.actualScale ?? 1;
  const tab = outline.length > 0 ? (sidebarTab ?? "contents") : "pages";
  const currentEntry = useMemo(() => currentOutlineIndex(outline, pageNumber), [outline, pageNumber]);
  const rowCount = tab === "contents" ? outline.length : pageCount;
  const activeRow = tab === "contents" ? currentEntry : pageNumber - 1;
  const visibleRows = useMemo(() => {
    if (rowCount === 0 || pageListHeight === 0) {
      return [];
    }
    const first = Math.max(0, Math.floor(pageListScrollTop / PAGE_ROW_HEIGHT) - PAGE_ROW_OVERSCAN);
    const last = Math.min(
      rowCount - 1,
      Math.ceil((pageListScrollTop + pageListHeight) / PAGE_ROW_HEIGHT) + PAGE_ROW_OVERSCAN
    );
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
  }, [rowCount, pageListHeight, pageListScrollTop]);
  // What is on show for the page asked for: itself, until its facing page is drawn with it.
  const shownPages = useMemo(
    () => (shown.for === pageNumber && shown.pages.length > 0 ? shown.pages : [pageNumber]),
    [pageNumber, shown]
  );
  // The furthest page on show: with the last two pages side by side, the book is finished.
  const reachedPage = Math.max(pageNumber, ...shownPages);
  const progress = useMemo(() => {
    if (pageCount <= 1) {
      return pageCount === 1 ? 1 : 0;
    }
    return (reachedPage - 1) / (pageCount - 1);
  }, [pageCount, reachedPage]);
  const percent = pagePercent(reachedPage, pageCount);
  const pageBookmarked = isBookmarked(bookmarks, pageNumber);
  const orderedBookmarks = useMemo(() => inPageOrder(bookmarks), [bookmarks]);

  const goToPage = useCallback(
    (page: number, land: "top" | "bottom" = "top") => {
      if (pageCount === 0) {
        return;
      }
      markReadingActivity();
      landRef.current = land;
      const target = Math.min(pageCount, Math.max(1, page));
      setPageNumber(target);
      if (scrolling) {
        // In the scroll, going to a page is scrolling to it.
        scrollPagesRef.current?.goTo(target);
      }
    },
    [markReadingActivity, pageCount, scrolling]
  );

  /** Turns on from the last page on show, or back from the first. */
  const turnPage = useCallback(
    (step: 1 | -1, land: "top" | "bottom" = "top") => {
      const next = turnFrom(shownPages, step);
      if (next >= 1 && next <= pageCount) {
        goToPage(next, land);
      }
    },
    [goToPage, pageCount, shownPages]
  );

  /** The room the page has: the stage, less its padding and the page's own border. */
  const measureRoom = useCallback(() => {
    const stage = scrollRef.current;
    if (!stage) {
      return { availableWidth: 788, availableHeight: 600 };
    }
    const style = window.getComputedStyle(stage);
    const px = (value: string) => Number.parseFloat(value) || 0;
    return {
      availableWidth: Math.max(320, stage.clientWidth - px(style.paddingLeft) - px(style.paddingRight) - 2),
      availableHeight: Math.max(240, stage.clientHeight - px(style.paddingTop) - px(style.paddingBottom) - 2)
    };
  }, []);

  /** Puts the anchored point of the page back where it was in the window. */
  const restoreAnchor = useCallback(() => {
    const anchor = anchorRef.current;
    const stage = scrollRef.current;
    const canvas = canvasRef.current;
    if (!anchor || !stage || !canvas) {
      return;
    }
    const stageBox = stage.getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
    stage.scrollLeft = anchoredScroll(box.left - stageBox.left + stage.scrollLeft, box.width, anchor.fx, anchor.px);
    stage.scrollTop = anchoredScroll(box.top - stageBox.top + stage.scrollTop, box.height, anchor.fy, anchor.py);
  }, []);

  /**
   * Changes how the page is sized without losing the place: the point of the
   * page under `about` (the pointer, or the middle of the window) stays under
   * it. The page drawn is stretched to its new size at once and drawn sharp a
   * moment later, so zooming answers the wheel rather than the render.
   */
  const setView = useCallback(
    (nextFit: PageFit, nextZoom: number, about?: { x: number; y: number }) => {
      const stage = scrollRef.current;
      const canvas = canvasRef.current;
      const natural = naturalRef.current;
      if (nextFit === fit && nextZoom === zoom) {
        return;
      }
      if (scrolling) {
        // The column keeps the place itself: the point under the pointer, or the reader's line.
        scrollPagesRef.current?.holdAt(about);
        if (natural && source) {
          // Known at once, so a second notch of the wheel in the same moment goes on from the first.
          scaleRef.current = scaleFor(natural, { fit: nextFit, zoom: nextZoom, ...measureRoom() }, source.actualScale);
        }
        setFit(nextFit);
        setZoom(nextZoom);
        return;
      }
      if (stage && canvas && natural && source) {
        const stageBox = stage.getBoundingClientRect();
        const box = canvas.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
          const x = about?.x ?? stageBox.left + stage.clientWidth / 2;
          const y = about?.y ?? stageBox.top + stage.clientHeight / 2;
          anchorRef.current = {
            fx: clamp01((x - box.left) / box.width),
            fy: clamp01((y - box.top) / box.height),
            px: x - stageBox.left,
            py: y - stageBox.top
          };
          const scale = scaleFor(natural, { fit: nextFit, zoom: nextZoom, ...measureRoom() }, source.actualScale);
          canvas.style.width = `${Math.floor(natural.width * scale)}px`;
          canvas.style.height = `${Math.floor(natural.height * scale)}px`;
          scaleRef.current = scale;
          // The text laid over the page is for its old size.
          textLayerRef.current?.replaceChildren();
          restoreAnchor();
        }
      }
      setFit(nextFit);
      setZoom(nextZoom);
    },
    [fit, measureRoom, restoreAnchor, scrolling, source, zoom]
  );

  const zoomBy = useCallback(
    (step: 1 | -1) => setView("free", steppedZoom(scaleRef.current, step, actualScale)),
    [actualScale, setView]
  );

  const chooseFit = useCallback(
    (next: PageFit) => setView(next, next === "free" ? scaleRef.current : zoom),
    [setView, zoom]
  );

  const saveBookmarks = useCallback(
    (next: PageBookmark[]) => {
      setBookmarks(next);
      try {
        window.localStorage.setItem(bookmarksKey, JSON.stringify(next));
      } catch {
        // Bookmarks remain available for this session.
      }
    },
    [bookmarksKey]
  );

  const toggleCurrentBookmark = useCallback(() => {
    if (pageCount === 0) {
      return;
    }
    saveBookmarks(toggleBookmark(bookmarks, book.id, pageNumber));
  }, [book.id, bookmarks, pageCount, pageNumber, saveBookmarks]);

  const openGoTo = useCallback(() => {
    if (pageCount === 0) {
      return;
    }
    setGoToEntry(String(pageNumber));
    setGoToOpen(true);
  }, [pageCount, pageNumber]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setSearchFocusToken((token) => token + 1);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setActiveHit(null);
  }, []);

  const openHit = useCallback(
    (hit: PdfSearchHit) => {
      shownHitRef.current = null;
      setActiveHit(hit);
      goToPage(hit.page);
    },
    [goToPage]
  );

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
        setOpenPlace(placeToOpen(placeRef.current, restoredPage));
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

  // The PDF's own table of contents. The one thing read from the whole
  // document on opening; a book closed meanwhile stops the lookups.
  useEffect(() => {
    setOutline([]);
    if (!pdf) {
      return;
    }
    let wanted = true;
    void pdf
      .outline(() => wanted)
      .then((entries) => {
        if (wanted && entries && entries.length > 0) {
          setOutline(entries);
        }
      })
      .catch(() => {
        // A PDF whose outline cannot be read is one without an outline.
      });
    return () => {
      wanted = false;
    };
  }, [pdf]);

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
    // A fit follows the window, and so does whether two pages have room.
    if (!stage || (fit !== "width" && fit !== "page" && !twoPages && !scrolling)) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setViewportRevision((revision) => revision + 1);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [fit, scrolling, twoPages]);

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
    // The last page's text must not be selectable over the next page's picture.
    textLayerRef.current?.replaceChildren();

    const room = measureRoom();
    const spread =
      kind === "comic" && twoPages && roomForSpread(room.availableWidth, room.availableHeight)
        ? { rtl: direction === "rtl" }
        : null;

    void source
      .render(pageNumber, canvas, { fit, zoom, ...room, tone, spread })
      .then((drawn) => {
        if (disposed) {
          return;
        }
        naturalRef.current = { width: drawn.width, height: drawn.height };
        scaleRef.current = drawn.scale;
        setEffectiveZoom(drawn.scale);
        setDrawnPage(pageNumber);
        setShown({ for: pageNumber, pages: drawn.pages ?? [pageNumber] });
        setRendering(false);
        const stage = scrollRef.current;
        if (stage && lastScrolledPageRef.current !== pageNumber) {
          // A new page is shown from its top, or from its bottom when the
          // reader came back to it; a right-to-left page starts at its right.
          lastScrolledPageRef.current = pageNumber;
          stage.scrollTop = landRef.current === "bottom" ? stage.scrollHeight : 0;
          stage.scrollLeft = direction === "rtl" ? stage.scrollWidth : 0;
          landRef.current = "top";
        } else {
          restoreAnchor();
        }
        anchorRef.current = null;
        const layer = textLayerRef.current;
        if (source.pdf && layer) {
          // A page whose text cannot be laid is still a page to read.
          void source.pdf.layText(pageNumber, layer, drawn.scale).catch(() => undefined);
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
    // `direction` decides where a new page starts, which needs no redraw; and
    // which side the first of two pages is on, which does (`spreadRtl`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fit,
    kind,
    loading,
    measureRoom,
    pageNumber,
    renderAttempt,
    restoreAnchor,
    scrolling,
    source,
    spreadRtl,
    tone,
    twoPages,
    viewportRevision,
    zoom
  ]);

  // Selecting text on the page (readers/pdfTextLayer.ts).
  useEffect(() => {
    const layer = textLayerRef.current;
    if (!pdf || !layer) {
      return;
    }
    return bindTextSelection(layer);
  }, [loading, pdf, scrolling]);

  // What the search found on the page in view, as rectangles over it.
  useEffect(() => {
    // In the scroll each page in the column marks its own.
    if (!pdf || !searchQuery || scrolling) {
      setMarks(NO_MARKS);
      return;
    }
    let stale = false;
    if (!measureContextRef.current) {
      measureContextRef.current = window.document.createElement("canvas").getContext("2d");
    }
    void pdf
      .pageText(pageNumber)
      .then((text) => {
        if (stale) {
          return;
        }
        // How far along a run a match begins is judged by the width of the
        // letters before it, in the run's own kind of face: nearer than
        // counting them, and the same as the text layer's selection.
        const context = measureContextRef.current;
        let face = "";
        const measure: MeasureText | undefined = context
          ? (piece, item) => {
              const family = text.fontFamilies[item.fontName ?? ""] ?? "sans-serif";
              if (family !== face) {
                context.font = `16px ${family}`;
                face = family;
              }
              return context.measureText(piece).width;
            }
          : undefined;
        const rects = findMatches(text.joined.text, searchQuery, MARKS_PER_PAGE).map((match) =>
          matchRects(text.joined, match, text.transform, text.width, text.height, measure)
        );
        setMarks({ page: pageNumber, rects });
      })
      .catch(() => {
        if (!stale) {
          setMarks(NO_MARKS);
        }
      });
    return () => {
      stale = true;
    };
  }, [pageNumber, pdf, scrolling, searchQuery]);

  // The result chosen is brought into view on a page too large for the window.
  useEffect(() => {
    if (rendering || !activeHit || activeHit.page !== drawnPage || marks.page !== drawnPage) {
      return;
    }
    const key = `${activeHit.page}:${activeHit.nth}:${searchQuery}`;
    const rect = marks.rects[activeHit.nth]?.[0];
    const stage = scrollRef.current;
    const canvas = canvasRef.current;
    if (shownHitRef.current === key || !rect || !stage || !canvas) {
      return;
    }
    shownHitRef.current = key;
    const stageBox = stage.getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
    const top = box.top - stageBox.top + rect.top * box.height;
    const bottom = top + rect.height * box.height;
    const left = box.left - stageBox.left + rect.left * box.width;
    const right = left + rect.width * box.width;
    // Clear of the toolbar above and the dock below.
    if (top < 96 || bottom > stage.clientHeight - 72) {
      stage.scrollTop = Math.max(0, stage.scrollTop + (top + bottom) / 2 - stage.clientHeight / 2);
    }
    if (left < 24 || right > stage.clientWidth - 24) {
      stage.scrollLeft = Math.max(0, stage.scrollLeft + (left + right) / 2 - stage.clientWidth / 2);
    }
  }, [activeHit, drawnPage, marks, rendering, searchQuery]);

  // Ctrl + wheel zooms about the pointer. Not passive: the window's own zoom
  // must not happen as well.
  const setViewRef = useRef(setView);
  setViewRef.current = setView;
  useEffect(() => {
    const stage = scrollRef.current;
    if (!stage || !source) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      // A wheel that reports lines rather than pixels moves about 33px a line.
      const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
      setViewRef.current("free", wheelZoom(scaleRef.current, delta, source.actualScale), {
        x: event.clientX,
        y: event.clientY
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [error, source]);

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
        JSON.stringify({
          displayMode,
          fit,
          fitWidth: fit === "width",
          sidebarOpen,
          zoom,
          ...(kind === "comic" ? { direction, twoPages } : { layout }),
          ...(placeRef.current ? { place: placeRef.current } : {})
        })
      );
    } catch {
      // Local preferences are optional.
    }
  }, [direction, displayMode, fit, kind, layout, sidebarOpen, storageKey, twoPages, zoom]);

  /** Where the scroll is, kept beside the book's other preferences as it moves and on closing. */
  const savePlace = useCallback(
    (place: StoredPlace) => {
      placeRef.current = place;
      try {
        const stored = readJson<PageReaderPreferences>(storageKey) ?? {};
        window.localStorage.setItem(storageKey, JSON.stringify({ ...stored, place }));
      } catch {
        // Local preferences are optional.
      }
    },
    [storageKey]
  );

  const noteScale = useCallback((scale: number, reference: { width: number; height: number }) => {
    scaleRef.current = scale;
    naturalRef.current = reference;
    setEffectiveZoom(scale);
  }, []);

  /** Pages or scroll: the page in view stays the page in view. */
  const chooseLayout = useCallback(
    (next: PageLayout) => {
      if (next === "scroll") {
        setOpenPlace({ page: pageNumber, fraction: 0, extra: 0 });
      } else {
        // The page is drawn afresh and shown from its top.
        lastScrolledPageRef.current = null;
      }
      setLayout(next);
    },
    [pageNumber]
  );

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
    if (!sidebarOpen || !list || rowCount === 0) {
      return;
    }
    const top = Math.max(0, activeRow) * PAGE_ROW_HEIGHT;
    const bottom = top + PAGE_ROW_HEIGHT;
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2 + PAGE_ROW_HEIGHT / 2);
    }
    // Told directly as well: the list changed (contents to pages) under the
    // same scroll position, and that sends no scroll event.
    setPageListScrollTop(list.scrollTop);
  }, [activeRow, rowCount, sidebarOpen, tab]);

  useEffect(() => {
    if (goToOpen) {
      goToInputRef.current?.focus();
      goToInputRef.current?.select();
    }
  }, [goToOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // The shortcuts sheet is over the page: a key behind it does nothing.
      // Escape closes the sheet, and only the sheet (it does so itself when
      // it has the keyboard; this is for when something else has).
      if (shortcutsOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setShortcutsOpen(false);
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || Boolean(target?.isContentEditable);
      // Which key does what is one table, which the shortcuts sheet is drawn from (readers/pageReaderKeys.ts).
      const pressed = pageActionFor(event, keyContext);
      // Find, go to, bookmark and zoom with Ctrl answer from anywhere, a
      // field included; a key typed in a field is the field's. Ctrl+C and
      // the rest are the window's.
      if (!pressed || (typing && !worksWhileTyping(event))) {
        return;
      }
      if (pressed === "escape") {
        // Escape closes what is open before it leaves the book.
        if (searchOpen) {
          closeSearch();
        } else if (zoomPanelOpen || bookmarkPanelOpen || morePanelOpen) {
          setZoomPanelOpen(false);
          setBookmarkPanelOpen(false);
          setMorePanelOpen(false);
        } else {
          exitGuard.escape(event);
        }
        return;
      }
      // Space and Enter on a button press the button.
      const onControl = tag === "BUTTON" || tag === "A" || tag === "SUMMARY";
      if (onControl && (event.key === " " || event.key === "Enter")) {
        return;
      }
      if (!READING_ACTIONS.has(pressed)) {
        event.preventDefault();
        if (pressed === "search") {
          openSearch();
        } else if (pressed === "goTo") {
          openGoTo();
        } else if (pressed === "bookmark") {
          toggleCurrentBookmark();
        } else if (pressed === "shortcuts") {
          setShortcutsOpen(true);
        } else if (pressed === "zoomIn") {
          zoomBy(1);
        } else if (pressed === "zoomOut") {
          zoomBy(-1);
        } else if (pressed === "fitActual") {
          chooseFit("actual");
        } else if (pressed === "fitWidth") {
          chooseFit("width");
        } else if (pressed === "fitPage") {
          chooseFit("page");
        }
        return;
      }
      // A reading key: what it does depends on where the page is (readers/pageKeys.ts).
      const stage = scrollRef.current;
      if (!stage) {
        return;
      }
      const action = readingKeyAction(event, stage, direction);
      if (!action) {
        return;
      }
      event.preventDefault();
      if (action.kind === "scroll") {
        markReadingActivity();
        if (action.top !== undefined) {
          stage.scrollTop = action.top;
        }
        if (action.left !== undefined) {
          stage.scrollLeft = action.left;
        }
        // The column is told at once; the scroll event says the same a moment later.
        scrollPagesRef.current?.sync();
        return;
      }
      if (scrolling && action.kind === "turn" && event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        // The end of the scroll: there is no further page to turn to.
        return;
      }
      if (action.kind === "goto") {
        goToPage(action.page === "first" ? 1 : pageCount);
        return;
      }
      const now = performance.now();
      if (event.repeat && now - lastKeyTurnRef.current < KEY_REPEAT_TURN_MS) {
        return;
      }
      lastKeyTurnRef.current = now;
      turnPage(action.step, action.land);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    bookmarkPanelOpen,
    chooseFit,
    closeSearch,
    direction,
    exitGuard.escape,
    goToPage,
    markReadingActivity,
    morePanelOpen,
    openGoTo,
    openSearch,
    keyContext,
    pageCount,
    scrolling,
    searchOpen,
    shortcutsOpen,
    toggleCurrentBookmark,
    turnPage,
    zoomBy,
    zoomPanelOpen
  ]);

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

  const submitGoTo = () => {
    const page = parsePageEntry(goToEntry, pageCount);
    if (page === null) {
      return;
    }
    setGoToOpen(false);
    goToPage(page);
  };

  const displayModeClass = getDisplayModeClass(displayMode);
  const openingLabel = kind === "comic" ? "Opening comic…" : "Opening PDF…";
  const goToInvalid = goToEntry.trim().length > 0 && parsePageEntry(goToEntry, pageCount) === null;
  const leftStep = sideStep("left", direction);
  const rightStep = sideStep("right", direction);
  const canStep = (step: 1 | -1) => {
    const next = turnFrom(shownPages, step);
    return next >= 1 && next <= pageCount;
  };
  const placeLabel = pagesLabel(shownPages, pageCount);
  const stepTitle = (step: 1 | -1) => (step > 0 ? "Next page" : "Previous page");
  const chapterOf = (page: number) => {
    const index = currentOutlineIndex(outline, page);
    return index >= 0 ? outline[index].title : null;
  };
  // Marks are for the page the canvas shows, which is the page before until the next is drawn.
  const shownMarks = marks.page === drawnPage ? marks.rects : [];

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
            aria-label={
              outline.length > 0
                ? sidebarOpen
                  ? "Hide contents and pages"
                  : "Show contents and pages"
                : sidebarOpen
                  ? "Hide pages"
                  : "Show pages"
            }
          >
            <span className="material-symbols-outlined">list</span>
          </button>
        </div>

        <div className="absolute left-1/2 hidden -translate-x-1/2 flex-col items-center text-center md:flex">
          <h1 className={toolbarTitleClass(book.title)} title={book.title}>
            {book.title}
          </h1>
          <span className="text-xs uppercase tracking-[0.2em] reader-muted">
            {book.author ?? "Unknown author"}
          </span>
        </div>

        <div className="flex items-center gap-4 md:gap-6">
          {/* A comic is pictures: there is no text in it to search. */}
          {pdf && (
            <button
              className="reader-icon transition-colors reader-hover-accent"
              type="button"
              onClick={() => (searchOpen ? closeSearch() : openSearch())}
              title="Search in this PDF (Ctrl+F)"
              aria-label="Search in this PDF"
              aria-expanded={searchOpen}
            >
              <UiIcon name="search" size={22} />
            </button>
          )}

          <div className="relative">
            <button
              className="reader-icon transition-colors reader-hover-accent"
              type="button"
              onClick={() => setZoomPanelOpen((open) => !open)}
              title="Page size"
              aria-label="Page size"
              aria-expanded={zoomPanelOpen}
            >
              <span className="material-symbols-outlined">text_fields</span>
            </button>
            {zoomPanelOpen && (
              <div
                className="absolute right-0 mt-3 w-64 rounded-xl border p-4 text-xs shadow-2xl reader-panel reader-border"
                role="group"
                aria-label="Page size"
              >
                <div className="text-xs uppercase tracking-widest reader-muted">Page size</div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="reader-mini-control"
                    onClick={() => zoomBy(-1)}
                    aria-label="Zoom out"
                    title="Zoom out (-)"
                  >
                    <UiIcon name="minus" size={16} />
                  </button>
                  <span className="min-w-[56px] text-center text-sm tabular-nums reader-text-color" aria-live="polite">
                    {zoomPercent(effectiveZoom, actualScale)}%
                  </span>
                  <button
                    type="button"
                    className="reader-mini-control"
                    onClick={() => zoomBy(1)}
                    aria-label="Zoom in"
                    title="Zoom in (+)"
                  >
                    <UiIcon name="plus" size={16} />
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  {FIT_CHOICES.map((choice) => (
                    <button
                      key={choice.fit}
                      type="button"
                      className="page-reader-fit"
                      aria-pressed={fit === choice.fit}
                      title={choice.hint}
                      aria-label={choice.hint}
                      onClick={() => chooseFit(choice.fit)}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[10px] leading-relaxed reader-muted">
                  Ctrl + wheel zooms about the pointer.
                </p>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              className={`reader-icon transition-colors reader-hover-accent ${pageBookmarked ? "page-reader-toolbar-on" : ""}`}
              type="button"
              onClick={() => setBookmarkPanelOpen((open) => !open)}
              title="Bookmarks (B bookmarks this page)"
              aria-label={pageBookmarked ? "Bookmarks: this page is bookmarked" : "Bookmarks"}
              aria-expanded={bookmarkPanelOpen}
            >
              <span className="material-symbols-outlined">bookmark</span>
            </button>
            {bookmarkPanelOpen && (
              <div className="absolute right-0 mt-3 w-72 rounded-xl border p-4 text-xs shadow-2xl reader-panel reader-border">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-widest reader-muted">Bookmarks</span>
                  <button
                    type="button"
                    className="rounded-md border px-2 py-1 text-[10px] uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
                    onClick={toggleCurrentBookmark}
                    aria-pressed={pageBookmarked}
                    title={pageBookmarked ? "Remove this page's bookmark (B)" : "Bookmark this page (B)"}
                  >
                    {pageBookmarked ? "Remove this page" : "Add this page"}
                  </button>
                </div>
                <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                  {orderedBookmarks.length === 0 && (
                    <li className="rounded-lg border px-3 py-2 text-[11px] reader-border reader-muted reader-pill">
                      No bookmarks yet. Press B on a page to keep it.
                    </li>
                  )}
                  {orderedBookmarks.map((bookmark) => {
                    const here = bookmark.page === pageNumber;
                    const chapter = chapterOf(bookmark.page);
                    return (
                      <li key={bookmark.id} className="flex items-stretch gap-1.5">
                        <button
                          type="button"
                          className="page-reader-bookmark min-w-0 flex-1 rounded-lg border px-3 py-2 text-left text-[11px] transition reader-border reader-pill reader-icon reader-hover-accent"
                          aria-current={here ? "page" : undefined}
                          onClick={() => {
                            goToPage(bookmark.page);
                            setBookmarkPanelOpen(false);
                          }}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-semibold reader-text-color">{bookmark.label}</span>
                            <span className="text-[10px] uppercase tracking-widest reader-muted">
                              {here ? "You are here" : `${pagePercent(bookmark.page, pageCount)}%`}
                            </span>
                          </div>
                          {chapter && <div className="mt-0.5 truncate text-[11px] reader-muted">{chapter}</div>}
                          <div className="mt-0.5 text-[10px] uppercase tracking-widest reader-muted">
                            {new Date(bookmark.createdAt).toLocaleDateString()}
                          </div>
                        </button>
                        <button
                          type="button"
                          className="reader-notes-remove flex items-center px-1.5"
                          aria-label={`Remove the bookmark on page ${bookmark.page}`}
                          title="Remove bookmark"
                          onClick={() => saveBookmarks(removeBookmark(bookmarks, bookmark.id))}
                        >
                          <UiIcon name="trash" size={15} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
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
              aria-label="Reader settings"
              aria-expanded={morePanelOpen}
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
                  onClick={() => chooseFit(fit === "width" ? "free" : "width")}
                  aria-pressed={fit === "width"}
                >
                  <span>Fit page width</span>
                  <span className="reader-toggle" data-on={fit === "width"} />
                </button>
                {kind === "pdf" && (
                  <button
                    type="button"
                    className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
                    onClick={() => chooseLayout(scrolling ? "pages" : "scroll")}
                    aria-pressed={scrolling}
                    title="All the pages in one scroll, or one page at a time"
                  >
                    <span>Continuous scrolling</span>
                    <span className="reader-toggle" data-on={scrolling} />
                  </button>
                )}
                {kind === "comic" && (
                  <button
                    type="button"
                    className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
                    onClick={() => setDirection((current) => (current === "rtl" ? "ltr" : "rtl"))}
                    aria-pressed={direction === "rtl"}
                    title="Reading direction: for manga, the right side goes on"
                  >
                    <span>Read right to left</span>
                    <span className="reader-toggle" data-on={direction === "rtl"} />
                  </button>
                )}
                {kind === "comic" && (
                  <button
                    type="button"
                    className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
                    onClick={() => setTwoPages((on) => !on)}
                    aria-pressed={twoPages}
                    title="Facing pages side by side when the window is wide; a cover or a double page is shown alone"
                  >
                    <span>Two pages side by side</span>
                    <span className="reader-toggle" data-on={twoPages} />
                  </button>
                )}
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
                  onClick={toggleTheme}
                >
                  <span>App theme</span>
                  <span className="reader-toggle" data-on={readerTheme === "light"} />
                </button>
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon reader-hover-accent"
                  onClick={() => {
                    setMorePanelOpen(false);
                    setShortcutsOpen(true);
                  }}
                >
                  Keyboard shortcuts (?)
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

      {shortcutsOpen && (
        <ShortcutsSheet
          context={pageShortcutContext(keyContext)}
          sections={pageShortcutSections(keyContext)}
          onClose={() => setShortcutsOpen(false)}
        />
      )}

      {searchOpen && pdf && (
        <PdfSearchPanel
          pageCount={pageCount}
          textOf={(page) => pdf.pageText(page).then((text) => text.joined.text)}
          active={activeHit}
          focusToken={searchFocusToken}
          onQuery={setSearchQuery}
          onOpen={openHit}
          onClose={closeSearch}
        />
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
          {outline.length > 0 ? (
            <div className="page-reader-tabs" role="tablist" aria-label="What the list shows">
              {(["contents", "pages"] as const).map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  className="page-reader-tab"
                  aria-selected={tab === name}
                  onClick={() => setSidebarTab(name)}
                >
                  {name === "contents" ? "Contents" : "Pages"}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-xs uppercase tracking-[0.3em] reader-muted">Pages</div>
          )}
          <div
            ref={pageListRef}
            className="mt-4 flex-1 overflow-y-auto pr-2"
            onScroll={(event) => setPageListScrollTop(event.currentTarget.scrollTop)}
          >
            <div style={{ height: rowCount * PAGE_ROW_HEIGHT, position: "relative" }}>
              {visibleRows.map((row) => {
                const entry = tab === "contents" ? outline[row] : null;
                const page = entry ? entry.page : row + 1;
                const active = row === activeRow;
                return (
                  <button
                    key={`${tab}-${row}`}
                    type="button"
                    style={{
                      position: "absolute",
                      top: row * PAGE_ROW_HEIGHT,
                      left: 0,
                      right: 0,
                      height: PAGE_ROW_HEIGHT - PAGE_ROW_GAP,
                      // A section sits in from its chapter.
                      paddingLeft: entry ? 12 + Math.min(entry.depth, 4) * 12 : undefined
                    }}
                    className={`reader-chapter-link pdf-reader-page-link flex w-full items-center rounded-lg px-3 text-left text-sm transition reader-icon ${
                      active ? "reader-chapter-active font-semibold" : ""
                    }`}
                    aria-current={active ? (entry ? "location" : "page") : undefined}
                    title={entry ? `${entry.title} (page ${entry.page})` : undefined}
                    onClick={() => {
                      goToPage(page);
                      setSidebarOpen(false);
                    }}
                  >
                    {entry ? (
                      <>
                        <span className="page-reader-outline-title">{entry.title}</span>
                        <span className="page-reader-outline-page">{entry.page}</span>
                      </>
                    ) : (
                      `Page ${page}`
                    )}
                  </button>
                );
              })}
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
              <div
                ref={scrollRef}
                className={`reader-container pdf-reader-stage h-full w-full overflow-auto ${
                  scrolling ? "pdf-scroll-stage" : ""
                }`}
              >
                {!loading && source && pdf && scrolling && openPlace && (
                  <PdfScrollPages
                    ref={scrollPagesRef}
                    pdf={pdf}
                    pageCount={pageCount}
                    actualScale={actualScale}
                    stageRef={scrollRef}
                    fit={fit}
                    zoom={zoom}
                    tone={tone}
                    measureRoom={measureRoom}
                    viewportRevision={viewportRevision}
                    initialPlace={openPlace}
                    searchQuery={searchQuery}
                    activeHit={activeHit}
                    onPage={setPageNumber}
                    onScale={noteScale}
                    onPlace={savePlace}
                    onActivity={markReadingActivity}
                  />
                )}
                {!loading && source && !scrolling && (
                  <div
                    className={`pdf-reader-page ${rendering ? "pdf-reader-page-rendering" : ""} ${
                      kind === "comic" ? "is-clickable" : ""
                    }`}
                    style={tone ? { background: toneCss(tone.paper) } : undefined}
                    data-dark={tone?.dark ? "true" : undefined}
                    onClick={
                      kind === "comic"
                        ? (event) => {
                            // A comic has no text to select: a click on the
                            // left or right third of the page turns it.
                            const box = event.currentTarget.getBoundingClientRect();
                            const step = box.width > 0 ? clickTurn((event.clientX - box.left) / box.width, direction) : 0;
                            if (step !== 0) {
                              turnPage(step);
                            }
                          }
                        : undefined
                    }
                  >
                    <canvas ref={canvasRef} aria-label={placeLabel} />
                    {pdf && (
                      <>
                        <div className="pdf-reader-marks" aria-hidden="true">
                          {shownMarks.map((rects, nth) =>
                            rects.map((rect, part) => (
                              <span
                                key={`${nth}-${part}`}
                                className={`pdf-reader-mark ${
                                  activeHit && activeHit.page === drawnPage && activeHit.nth === nth ? "is-current" : ""
                                }`}
                                style={{
                                  left: `${rect.left * 100}%`,
                                  top: `${rect.top * 100}%`,
                                  width: `${rect.width * 100}%`,
                                  height: `${rect.height * 100}%`
                                }}
                              />
                            ))
                          )}
                        </div>
                        <div ref={textLayerRef} className="textLayer" />
                      </>
                    )}
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
                      onClick={() => turnPage(leftStep)}
                      disabled={!canStep(leftStep)}
                      title={stepTitle(leftStep)}
                      aria-label={stepTitle(leftStep)}
                    >
                      <span className="material-symbols-outlined text-base">chevron_left</span>
                    </button>
                    {goToOpen ? (
                      <form
                        className="flex items-center gap-1.5 text-[10px] reader-muted"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitGoTo();
                        }}
                      >
                        <label htmlFor="page-reader-goto">Page</label>
                        <input
                          id="page-reader-goto"
                          ref={goToInputRef}
                          className="page-reader-goto"
                          inputMode="numeric"
                          autoComplete="off"
                          value={goToEntry}
                          aria-invalid={goToInvalid}
                          aria-label={`Go to page, 1 to ${pageCount}. Enter goes, Escape cancels`}
                          onChange={(event) => setGoToEntry(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.stopPropagation();
                              setGoToOpen(false);
                            }
                          }}
                          onBlur={() => setGoToOpen(false)}
                        />
                        <span>of {pageCount}</span>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="page-reader-place"
                        onClick={openGoTo}
                        title="Go to a page (G)"
                        aria-label={`${placeLabel}, ${percent}% through. Go to a page`}
                      >
                        {placeLabel} · {percent}%
                      </button>
                    )}
                    <button
                      type="button"
                      className="reader-mini-control"
                      onClick={() => turnPage(rightStep)}
                      disabled={!canStep(rightStep)}
                      title={stepTitle(rightStep)}
                      aria-label={stepTitle(rightStep)}
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
