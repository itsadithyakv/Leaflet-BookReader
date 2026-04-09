import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import type { Book } from "@shared/models/book";
import ePub from "epubjs";
import { bookService } from "../services/bookService";
import { useLibraryStore } from "../store/libraryStore";
import { getSessionProgress, useHabitStore } from "../store/habitStore";
import { converterService } from "../services/converterService";
import {
  READABLE_EXTENSIONS,
  formatDisplayList,
  getBookExtension
} from "../constants/bookFormats";

type ReaderViewProps = {
  book: Book;
  onClose: () => void;
};

type TocItem = {
  id?: string;
  label: string;
  href: string;
  subitems?: TocItem[];
};

const flattenToc = (items: TocItem[]) => {
  const result: TocItem[] = [];
  const walk = (list: TocItem[]) => {
    list.forEach((item) => {
      result.push(item);
      if (item.subitems && item.subitems.length > 0) {
        walk(item.subitems);
      }
    });
  };
  walk(items);
  return result;
};

const normalizeLabel = (label: string) => label.toLowerCase().replace(/\s+/g, " ").trim();

const isFrontMatter = (label: string) => {
  const text = normalizeLabel(label);
  const blocked = [
    "title page",
    "copyright",
    "contents",
    "table of contents",
    "dedication",
    "acknowledgments",
    "acknowledgements",
    "foreword",
    "introduction",
    "preface",
    "glossary",
    "index",
    "about the author",
    "maps",
    "map"
  ];
  return blocked.some((entry) => text === entry || text.startsWith(`${entry} `));
};

const isChapterLike = (label: string) => {
  const text = normalizeLabel(label);
  if (isFrontMatter(text)) {
    return false;
  }
  if (/(chapter|book|section)\b/.test(text)) {
    return true;
  }
  if (/^(prologue|epilogue)\b/.test(text)) {
    return true;
  }
  if (/^[ivxlcdm]+\.?$/.test(text)) {
    return true;
  }
  return false;
};

export const ReaderView = ({ book, onClose }: ReaderViewProps) => {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<any>(null);
  const bookRef = useRef<ReturnType<typeof ePub> | null>(null);
  const relocateHandlerRef = useRef<((location: { start?: { percentage?: number } }) => void) | null>(null);
  const lastProgressRef = useRef(0);
  const lastProgressAtRef = useRef(0);
  const lastComputedProgressRef = useRef(-1);
  const lastMarkerRef = useRef<string | null>(null);
  const scrollAdvanceLockRef = useRef(false);
  const scrollAdvanceTimerRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const lastWheelDownAtRef = useRef(0);
  const lastScrollTopRef = useRef<number | null>(null);
  const autoScrollLastTimeRef = useRef<number | null>(null);
  const autoScrollCarryRef = useRef(0);
  const readerDotTimerRef = useRef<number | null>(null);
  const readerDotRetryRef = useRef<{ cfi: string; count: number }>({ cfi: "", count: 0 });
  const readerDotElementRef = useRef<HTMLElement | null>(null);
  const sidebarAnimTimerRef = useRef<number | null>(null);
  const sidebarUiTimerRef = useRef<number | null>(null);
  const activeSession = useHabitStore((state) => state.activeSession);
  const focusSettings = useHabitStore((state) => state.focusSettings);
  const stopSession = useHabitStore((state) => state.stopSession);
  const clearSessionShelf = useHabitStore((state) => state.clearSessionShelf);
  const extendSession = useHabitStore((state) => state.extendSession);
  const addSessionNote = useHabitStore((state) => state.addSessionNote);
  const [coffeeProgress, setCoffeeProgress] = useState(0);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [checkpointLevel, setCheckpointLevel] = useState<0.5 | 0.9 | 1 | null>(null);
  const checkpointTimerRef = useRef<number | null>(null);
  const [focusToast, setFocusToast] = useState<string | null>(null);
  const focusToastTimerRef = useRef<number | null>(null);
  const checkpointRef = useRef(0);
  const sessionStartRef = useRef<string | null>(null);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSessionId, setNoteSessionId] = useState<string | null>(null);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);

  useEffect(() => {
    if (!activeSession) {
      setCoffeeProgress(0);
      return undefined;
    }
    const timer = window.setInterval(() => {
      setCoffeeProgress(getSessionProgress(activeSession));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [activeSession]);

  useEffect(() => {
    const startedAt = activeSession?.startedAt ?? null;
    if (sessionStartRef.current !== startedAt) {
      sessionStartRef.current = startedAt;
      checkpointRef.current = 0;
      setCheckpointOpen(false);
      setCheckpointLevel(null);
      if (checkpointTimerRef.current) {
        window.clearTimeout(checkpointTimerRef.current);
        checkpointTimerRef.current = null;
      }
    }
  }, [activeSession?.startedAt]);

  useEffect(() => {
    if (!activeSession || !focusSettings.checkpointPrompts) {
      if (checkpointTimerRef.current) {
        window.clearTimeout(checkpointTimerRef.current);
        checkpointTimerRef.current = null;
      }
      return;
    }
    const progress = getSessionProgress(activeSession);
    const nextCheckpoint =
      checkpointRef.current < 0.5 && progress >= 0.5
        ? 0.5
        : checkpointRef.current < 0.9 && progress >= 0.9
          ? 0.9
          : checkpointRef.current < 1 && progress >= 1
            ? 1
            : null;

    if (nextCheckpoint) {
      checkpointRef.current = nextCheckpoint;
      setCheckpointLevel(nextCheckpoint);
      setCheckpointOpen(true);
      if (checkpointTimerRef.current) {
        window.clearTimeout(checkpointTimerRef.current);
      }
      const timeout = nextCheckpoint === 1 ? 10000 : 8000;
      checkpointTimerRef.current = window.setTimeout(() => {
        setCheckpointOpen(false);
        if (nextCheckpoint === 1 && activeSession) {
          const progressNow = getSessionProgress(activeSession);
          if (progressNow >= 0.999) {
            handleStopSession({ reason: "completed", cleanSession: true });
          }
        }
        checkpointTimerRef.current = null;
      }, timeout);
    }
  }, [activeSession, focusSettings.checkpointPrompts, coffeeProgress]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }
    if (checkpointOpen && checkpointLevel === 1) {
      return;
    }
    const totalSeconds = activeSession.durationMinutes * 60;
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - Date.parse(activeSession.startedAt)) / 1000));
    if (elapsedSeconds >= totalSeconds) {
      handleStopSession({ reason: "completed", cleanSession: true });
    }
  }, [activeSession, checkpointOpen, checkpointLevel, coffeeProgress]);

  const handleStopSession = (options?: { reason?: "completed" | "manual_end"; cleanSession?: boolean }) => {
    if (options?.reason === "manual_end") {
      const confirmed = window.confirm(
        "Ending focus now will clear your sessions bookshelf progress. Continue?"
      );
      if (!confirmed) {
        return;
      }
    }
    const sessionId = stopSession(options);
    if (options?.reason === "manual_end") {
      clearSessionShelf();
    }
    if (sessionId && focusSettings.sessionNotes) {
      setNoteSessionId(sessionId);
      setNoteText("");
      setNoteModalOpen(true);
    }
  };

  const handleCheckpointContinue = () => {
    if (checkpointLevel === 1) {
      extendSession(10);
      checkpointRef.current = 0.9;
    }
    if (checkpointTimerRef.current) {
      window.clearTimeout(checkpointTimerRef.current);
      checkpointTimerRef.current = null;
    }
    setCheckpointOpen(false);
  };

  const handleCheckpointEnd = () => {
    if (checkpointTimerRef.current) {
      window.clearTimeout(checkpointTimerRef.current);
      checkpointTimerRef.current = null;
    }
    setCheckpointOpen(false);
    handleStopSession({ reason: "completed", cleanSession: true });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowRight") {
        if (event.repeat) {
          return;
        }
        event.preventDefault();
        goNextSection();
        return;
      }
      if (event.key === "ArrowLeft") {
        if (event.repeat) {
          return;
        }
        event.preventDefault();
        goPrevSection();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const container = getScrollContainer();
        if (!container) {
          return;
        }
        if (event.key === "ArrowDown") {
          const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
          if (atBottom) {
            goNextSection();
            event.preventDefault();
            return;
          }
        }
        const delta = Math.max(120, Math.round(container.clientHeight * 0.2));
        const direction = event.key === "ArrowDown" ? 1 : -1;
        smoothScrollBy(container, delta * direction);
        event.preventDefault();
      }
      if (event.code === "Space") {
        if ((event.target as HTMLElement | null)?.tagName === "INPUT") {
          return;
        }
        event.preventDefault();
        setAutoScrollActive((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (scrollAdvanceTimerRef.current) {
        window.clearTimeout(scrollAdvanceTimerRef.current);
      }
      if (sidebarAnimTimerRef.current) {
        window.clearTimeout(sidebarAnimTimerRef.current);
      }
      if (sidebarUiTimerRef.current) {
        window.clearTimeout(sidebarUiTimerRef.current);
      }
      if (checkpointTimerRef.current) {
        window.clearTimeout(checkpointTimerRef.current);
      }
      if (focusToastTimerRef.current) {
        window.clearTimeout(focusToastTimerRef.current);
      }
      if (lastComputedProgressRef.current >= 0) {
        const progress = Math.min(1, Math.max(0, lastComputedProgressRef.current));
        void bookService.updateProgress(book.id, progress);
        updateBookProgress(book.id, progress);
      }
    };
  }, []);

  const storageKey = useMemo(() => `leaflet.reader.${book.id}`, [book.id]);
  const bookmarksKey = useMemo(() => `leaflet.bookmarks.${book.id}`, [book.id]);
  const readPrefs = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as {
        fontSize?: number;
        sidebarOpen?: boolean;
        cfi?: string;
        chapterPositions?: Record<string, string>;
      };
    } catch {
      return null;
    }
  };

  const initialPrefs = readPrefs();
  const [sidebarOpen, setSidebarOpen] = useState(initialPrefs?.sidebarOpen ?? true);
  const [fontSize, setFontSize] = useState(initialPrefs?.fontSize ?? 18);
  const fontSizeRef = useRef(fontSize);
  const sidebarRef = useRef(sidebarOpen);
  const [fontPanelOpen, setFontPanelOpen] = useState(false);
  const [autoScrollActive, setAutoScrollActive] = useState(false);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(45);
  const [readerTheme, setReaderTheme] = useState<"dark" | "light">("dark");
  const [morePanelOpen, setMorePanelOpen] = useState(false);
  const morePanelRef = useRef<HTMLDivElement | null>(null);
  const morePanelCloseRef = useRef<number | null>(null);
  const [readerDotEnabled, setReaderDotEnabled] = useState(true);
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<
    Array<{ id: string; cfi: string; label: string; createdAt: string }>
  >([]);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocIndexByHref, setTocIndexByHref] = useState<Record<string, number>>({});
  const [tocLabelByHref, setTocLabelByHref] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastCfiRef = useRef<string | null>(initialPrefs?.cfi ?? null);
  const chapterPositionsRef = useRef<Record<string, string>>(initialPrefs?.chapterPositions ?? {});
  const [chapterIndex, setChapterIndex] = useState<number>(0);
  const [chapterLabel, setChapterLabel] = useState<string>("Chapter");
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const chapterLabelHasNumber = (label: string) => /(?:^|\s)(\d+|[ivxlcdm]+)\b/i.test(label);
  const formatChapterDisplay = () => {
    if (!chapterLabel) {
      return `Chapter ${chapterIndex + 1}`;
    }
    if (chapterLabelHasNumber(chapterLabel)) {
      return chapterLabel;
    }
    return `${chapterLabel} ${chapterIndex + 1}`;
  };

  const coverSrc = useMemo(() => {
    if (!book.coverUrl) {
      return null;
    }
    return book.coverUrl.startsWith("http") ? book.coverUrl : null;
  }, [book.coverUrl]);

  const [coverFallback, setCoverFallback] = useState<string | null>(null);
  const coverTriedRef = useRef(false);
  const updateBookProgress = useLibraryStore((state) => state.updateBookProgress);
  const spineIndexByHrefRef = useRef<Record<string, number>>({});
  const chapterSpineIndicesRef = useRef<number[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(bookmarksKey);
      if (!raw) {
        setBookmarks([]);
        return;
      }
      const parsed = JSON.parse(raw) as Array<{ id: string; cfi: string; label: string; createdAt: string }>;
      setBookmarks(Array.isArray(parsed) ? parsed : []);
    } catch {
      setBookmarks([]);
    }
  }, [bookmarksKey]);

  useEffect(() => {
    setBookmarkPanelOpen(false);
    setFontPanelOpen(false);
    setAutoScrollActive(false);
    setMorePanelOpen(false);
  }, [book.id]);

  useEffect(() => {
    if (!morePanelOpen) {
      return;
    }
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (morePanelRef.current && target && !morePanelRef.current.contains(target)) {
        setMorePanelOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [morePanelOpen]);

  useEffect(() => {
    return () => {
      if (morePanelCloseRef.current) {
        window.clearTimeout(morePanelCloseRef.current);
      }
    };
  }, []);


  const applyReaderInsets = () => {
    const rendition = renditionRef.current;
    if (!rendition?.themes) {
      return;
    }
    rendition.themes.override("padding-left", "var(--reader-content-pad, 24px)");
    rendition.themes.override("padding-right", "var(--reader-content-pad, 24px)");
    rendition.themes.override("margin-left", "0px");
    rendition.themes.override("margin-right", "0px");
    rendition.themes.override("max-width", "100%");
    rendition.themes.override("width", "100%");
    rendition.themes.override("box-sizing", "border-box");
  };

  const freezeReaderLayout = () => {
    if (sidebarAnimTimerRef.current) {
      window.clearTimeout(sidebarAnimTimerRef.current);
      sidebarAnimTimerRef.current = null;
    }
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }
    const rect = viewer.getBoundingClientRect();
    if (!rect.width) {
      return;
    }
    viewer.style.width = `${rect.width}px`;
    viewer.style.maxWidth = `${rect.width}px`;
    viewer.style.transition = "none";
    sidebarAnimTimerRef.current = window.setTimeout(() => {
      viewer.style.width = "100%";
      viewer.style.maxWidth = "100%";
      viewer.style.transition = "";
      sidebarAnimTimerRef.current = null;
      const container = viewerRef.current;
      if (container && renditionRef.current?.resize) {
        renditionRef.current.resize(container.clientWidth, container.clientHeight);
      }
    }, 480);
  };

  const handleToggleSidebar = () => {
    freezeReaderLayout();
    setSidebarAnimating(true);
    if (sidebarUiTimerRef.current) {
      window.clearTimeout(sidebarUiTimerRef.current);
    }
    sidebarUiTimerRef.current = window.setTimeout(() => {
      setSidebarAnimating(false);
      sidebarUiTimerRef.current = null;
    }, 520);
    window.requestAnimationFrame(() => {
      setSidebarOpen((prev) => !prev);
    });
  };

  const ensureSingleScrollContainer = () => {
    const manager = renditionRef.current?.manager as any;
    const container = manager?.container as HTMLElement | undefined;
    if (container) {
      container.style.overflowY = "auto";
      container.style.overflowX = "hidden";
      container.style.height = "100%";
      container.style.width = "100%";
      container.style.position = "relative";
    }
    if (viewerRef.current) {
      viewerRef.current.style.overflowY = "hidden";
      viewerRef.current.style.overflowX = "hidden";
    }
  };

  const applyReaderTypography = () => {
    const rendition = renditionRef.current;
    if (!rendition?.themes) {
      return;
    }
    rendition.themes.override("line-height", "1.8");
    rendition.themes.override("font-weight", "400");

    const contentsList = rendition.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document;
      if (!doc) {
        return;
      }
      doc.documentElement.style.setProperty("--reader-font-size", `${fontSizeRef.current}px`);
    });
  };

  const applyContentFlowStyles = () => {
    const rendition = renditionRef.current;
    const contentsList = rendition?.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document;
      if (!doc) {
        return;
      }
      doc.documentElement.style.overflow = "visible";
      doc.body.style.overflow = "visible";
      doc.documentElement.style.overflowX = "hidden";
      doc.body.style.overflowX = "hidden";
    });
  };

  const updateLastReadMarker = (cfi: string) => {
    if (!readerDotEnabled) {
      return;
    }
    const rendition = renditionRef.current;
    if (!rendition?.getContents) {
      return;
    }
    const contentsList = rendition.getContents();
    if (readerDotRetryRef.current.cfi !== cfi) {
      readerDotRetryRef.current = { cfi, count: 0 };
    }
    let found = false;

    for (const contents of contentsList) {
      try {
        const container = ensureScrollContainer();
        if (!container) {
          continue;
        }
        const range = contents.range(cfi);
        if (!range) {
          continue;
        }
        const rects = range.getClientRects();
        const rect =
          rects && rects.length > 0
            ? rects[rects.length - 1]
            : range.getBoundingClientRect();
        if (!rect || rect.height === 0) {
          continue;
        }
        const iframe =
          (contents?.iframe as HTMLIFrameElement | undefined) ??
          (contents?.document?.defaultView?.frameElement as HTMLIFrameElement | undefined);
        if (!iframe) {
          continue;
        }
        const iframeRect = iframe.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const lineTop = iframeRect.top + rect.top - containerRect.top;
        const doc = contents?.document;
        const computedPad = doc?.body
          ? Number.parseFloat(doc.defaultView?.getComputedStyle(doc.body).paddingLeft || "0")
          : 0;
        const pad = Number.isFinite(computedPad) && computedPad > 0 ? computedPad : 24;
        const clamp = (value: number, min: number, max: number) =>
          Math.min(max, Math.max(min, value));
        const containerWidth = container.clientWidth || containerRect.width;
        const textLeft = iframeRect.left - containerRect.left + pad;
        const trackLeft = clamp(textLeft - 12, 6, Math.max(6, containerWidth - 10));
        const target = {
          top: clamp(
            lineTop + container.scrollTop + rect.height / 2 - 6,
            6,
            Math.max(6, container.scrollHeight - 10)
          ),
          left: trackLeft
        };

        const existing = readerDotElementRef.current;
        const dot =
          existing && container.contains(existing)
            ? existing
            : (() => {
                const el = document.createElement("div");
                el.id = "reader-lastline-dot";
                el.className = "reader-dot";
                el.style.position = "absolute";
                el.style.width = "10px";
                el.style.height = "10px";
                el.style.borderRadius = "9999px";
                el.style.pointerEvents = "none";
                el.style.opacity = "0";
                el.style.transition = "top 0.4s ease, left 0.4s ease, opacity 0.3s ease";
                el.style.zIndex = "50";
                el.style.transform = "translateX(0)";
                container.appendChild(el);
                readerDotElementRef.current = el;
                return el;
              })();

        if (!dot.dataset.fixedLeft) {
          dot.style.left = `${target.left}px`;
          dot.dataset.fixedLeft = `${target.left}`;
        } else if (dot.dataset.fixedLeft !== `${target.left}`) {
          dot.style.left = `${target.left}px`;
          dot.dataset.fixedLeft = `${target.left}`;
        }
        dot.style.top = `${target.top}px`;
        dot.style.opacity = "1";
        lastMarkerRef.current = cfi;
        readerDotRetryRef.current = { cfi, count: 0 };
        found = true;
        break;
      } catch {
        // ignore range errors
      }
    }

    if (!found && readerDotRetryRef.current.count < 3) {
      readerDotRetryRef.current.count += 1;
      window.setTimeout(() => {
        updateLastReadMarker(cfi);
      }, 260);
    }
  };

  const removeLastReadMarker = () => {
    if (readerDotTimerRef.current) {
      window.clearTimeout(readerDotTimerRef.current);
    }
    readerDotTimerRef.current = null;
    readerDotRetryRef.current = { cfi: "", count: 0 };
    if (readerDotElementRef.current) {
      readerDotElementRef.current.remove();
      readerDotElementRef.current = null;
    }
    lastMarkerRef.current = null;
  };

  const smoothScrollBy = (element: HTMLElement, delta: number) => {
    const start = element.scrollTop;
    const target = start + delta;
    const duration = 220;
    let startTime: number | null = null;

    const tick = (time: number) => {
      if (startTime === null) {
        startTime = time;
      }
      const progress = Math.min(1, (time - startTime) / duration);
      const eased = progress < 0.5
        ? 2 * progress * progress
        : -1 + (4 - 2 * progress) * progress;
      element.scrollTop = start + (target - start) * eased;
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  };

  const isAtScrollBottom = (element: HTMLElement, padding = 6) =>
    element.scrollTop + element.clientHeight >= element.scrollHeight - padding;

  const ensureScrollSpacer = (container: HTMLElement) => {
    const existing = container.querySelector<HTMLElement>("#reader-scroll-spacer");
    const heightPx = Math.max(120, Math.round(container.clientHeight * 0.5));
    if (existing) {
      existing.style.height = `${heightPx}px`;
      if (existing.parentElement === container && container.lastElementChild !== existing) {
        container.appendChild(existing);
      }
      return;
    }
    const spacer = container.ownerDocument.createElement("div");
    spacer.id = "reader-scroll-spacer";
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.height = `${heightPx}px`;
    spacer.style.width = "1px";
    spacer.style.display = "block";
    container.appendChild(spacer);
  };

  const ensureScrollContainer = () => {
        const container = getScrollContainer();
        if (!container) {
          return null;
        }
        scrollContainerRef.current = container;
        ensureScrollSpacer(container);
    if (readerDotElementRef.current && !container.contains(readerDotElementRef.current)) {
      readerDotElementRef.current.remove();
      readerDotElementRef.current = null;
    }
    if (readerDotElementRef.current) {
      readerDotElementRef.current.style.left = "8px";
      readerDotElementRef.current.dataset.fixedLeft = "";
    }
    return container;
  };

  const scheduleReaderDotUpdate = () => {
    if (!readerDotEnabled) {
      return;
    }
    if (readerDotTimerRef.current) {
      window.clearTimeout(readerDotTimerRef.current);
    }
    readerDotTimerRef.current = window.setTimeout(() => {
      const location = renditionRef.current?.location;
      const cfi = location?.end?.cfi ?? location?.start?.cfi;
      if (cfi) {
        updateLastReadMarker(cfi);
      }
    }, 2000);
  };

  const triggerScrollAdvance = () => {
    if (scrollAdvanceLockRef.current) {
      return;
    }
    scrollAdvanceLockRef.current = true;
    if (scrollAdvanceTimerRef.current) {
      window.clearTimeout(scrollAdvanceTimerRef.current);
    }
    scrollAdvanceTimerRef.current = window.setTimeout(() => {
      scrollAdvanceLockRef.current = false;
    }, 900);
    goNextSection();
  };

  const persistReaderState = (override?: Partial<{
    cfi: string;
    chapterPositions: Record<string, string>;
  }>) => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          fontSize: fontSizeRef.current,
          sidebarOpen: sidebarRef.current,
          cfi: override?.cfi ?? lastCfiRef.current ?? undefined,
          chapterPositions: override?.chapterPositions ?? chapterPositionsRef.current
        })
      );
    } catch {
      // ignore
    }
  };

  const saveBookmarks = (next: Array<{ id: string; cfi: string; label: string; createdAt: string }>) => {
    setBookmarks(next);
    try {
      localStorage.setItem(bookmarksKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const addBookmark = () => {
    const location = renditionRef.current?.location;
    const cfi = location?.start?.cfi;
    if (!cfi) {
      return;
    }
    const href = location?.start?.href;
    const label = href ? tocLabelByHref[href] ?? chapterLabel : chapterLabel;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      cfi,
      label: label || "Bookmark",
      createdAt: new Date().toISOString()
    };
    saveBookmarks([entry, ...bookmarks]);
  };

  const openBookmark = (cfi: string) => {
    if (!renditionRef.current) {
      return;
    }
    setBookmarkPanelOpen(false);
    void renditionRef.current.display(cfi);
  };

  const displayChapter = (href: string, options?: { useSaved?: boolean }) => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    const useSaved = options?.useSaved ?? true;
    const saved = chapterPositionsRef.current[href];
    const target = useSaved && saved ? saved : href;
    void rendition.display(target).then(() => {
      if (!useSaved) {
        const container = ensureScrollContainer();
        if (container) {
          container.scrollTop = 0;
        }
      }
    });
  };

  useEffect(() => {
    coverTriedRef.current = false;
    setCoverFallback(null);
  }, [book.id, book.coverUrl]);

  useEffect(() => {
    if (!isTauri() || !book.coverUrl || book.coverUrl.startsWith("http")) {
      return;
    }
    void bookService.coverData(book.id).then((data) => {
      if (data) {
        setCoverFallback(data);
      }
    });
  }, [book.id, book.coverUrl]);

  const localPath =
    (book as { localPath?: string; local_path?: string }).localPath ??
    (book as { localPath?: string; local_path?: string }).local_path ??
    "";

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    setToc([]);

    if (!localPath) {
      setLoadError("Missing book file.");
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const ext = getBookExtension(localPath);
        if (ext && !READABLE_EXTENSIONS.includes(ext) && ext !== "mobi" && ext !== "azw3") {
          const supported = formatDisplayList(READABLE_EXTENSIONS);
          setLoadError(`This reader supports ${supported} files only.`);
          setLoading(false);
          return;
        }
        if (isTauri() && ext !== "epub") {
          const installed = await converterService.status().catch(() => false);
          if (!installed) {
            setLoadError("Converter not installed. Install it in Settings to open this file.");
            setLoading(false);
            return;
          }
        }
        let buffer: ArrayBuffer;
        if (isTauri()) {
          const base64 = await bookService.readBookBytes(book.id);
          if (!base64) {
            throw new Error("Unable to read the book file. Make sure you're running the desktop app.");
          }
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          buffer = bytes.buffer;
        } else {
          const source = localPath;
          const response = await fetch(source);
          if (!response.ok) {
            throw new Error("fetch failed");
          }
          buffer = await response.arrayBuffer();
        }

        if (bookRef.current) {
          bookRef.current.destroy();
          bookRef.current = null;
        }

        let epub: ReturnType<typeof ePub>;
        try {
          epub = ePub(buffer);
        } catch (error) {
          const supported = formatDisplayList(READABLE_EXTENSIONS);
          if (ext && ext !== "epub") {
            setLoadError(
              `Conversion failed for ${ext.toUpperCase()}. Reinstall the converter in Settings and try again.`
            );
          } else {
            const suffix = ext ? ` ${ext.toUpperCase()} files can be imported, but aren't readable yet.` : "";
            setLoadError(`This reader currently supports ${supported} files only.${suffix}`);
          }
          setLoading(false);
          return;
        }
        bookRef.current = epub;
        if (epub.locations && typeof epub.locations.generate === "function") {
          void epub.locations.generate(1600);
        }

        if (!viewerRef.current) {
          throw new Error("Reader container not ready.");
        }

        const rendition = epub.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%"
        });
        renditionRef.current = rendition;

        rendition.hooks?.content?.register((contents: any) => {
          const doc = contents?.document;
          if (!doc) {
            return;
          }
          const pad = sidebarOpen ? 28 : 16;
          doc.documentElement.style.setProperty("--reader-content-pad", `${pad}px`);
          if (!doc.getElementById("reader-font-scale")) {
            const style = doc.createElement("style");
            style.id = "reader-font-scale";
            style.textContent = `
              :root { --reader-font-size: ${fontSizeRef.current}px; }
              html { font-size: var(--reader-font-size) !important; width: 100% !important; max-width: 100% !important; transition: padding 0.25s ease; }
              body { font-size: 1em !important; margin: 0 !important; padding-left: var(--reader-content-pad, 24px) !important; padding-right: var(--reader-content-pad, 24px) !important; text-align: justify !important; text-justify: inter-word !important; hyphens: auto; width: 100% !important; max-width: 100% !important; box-sizing: border-box; transition: padding 0.25s ease; }
              body > *:first-child { margin-top: 0 !important; padding-top: 0 !important; }
              body * { font-size: inherit !important; line-height: inherit; box-sizing: border-box; max-width: 100% !important; }
              body > * { max-width: 100% !important; }
              p { text-align: justify !important; text-justify: inter-word !important; hyphens: auto; text-indent: 0 !important; margin-left: 0 !important; margin-bottom: 1.6em !important; }
              p, div, section, article, blockquote, li { text-indent: 0 !important; margin-left: 0 !important; }
            `;
            doc.head.appendChild(style);
          } else {
            doc.documentElement.style.setProperty("--reader-font-size", `${fontSizeRef.current}px`);
            doc.documentElement.style.setProperty("--reader-content-pad", `${pad}px`);
          }
          doc.documentElement.style.overflow = "visible";
          doc.body.style.overflow = "visible";
          doc.documentElement.style.overflowX = "hidden";
          doc.body.style.overflowX = "hidden";
        });

        rendition.themes.register("leaflet-dark", {
          html: {
            background: "#000000",
            color: "#ffffff",
            overflowX: "hidden"
          },
          body: {
            background: "#000000",
            color: "#ffffff",
            lineHeight: "1.8",
            fontFamily: "'Inter', sans-serif",
            margin: "0 auto",
            width: "100%",
            padding: "0",
            maxWidth: "100%",
            overflowX: "hidden"
          },
          "*": {
            boxSizing: "border-box",
            maxWidth: "100%"
          },
          p: {
            margin: "0 0 1.6em 0",
            textAlign: "justify",
            textIndent: "0"
          },
          span: {
            fontSize: "inherit"
          },
          div: {
            fontSize: "inherit"
          },
          li: {
            marginBottom: "0.6em"
          },
          h1: { fontSize: "1.6em", margin: "2.2em 0 0.6em 0", paddingTop: "0.4em", borderTop: "1px solid rgba(255,255,255,0.08)" },
          h2: { fontSize: "1.45em", margin: "2em 0 0.6em 0", paddingTop: "0.4em", borderTop: "1px solid rgba(255,255,255,0.08)" },
          h3: { fontSize: "1.3em", margin: "1.6em 0 0.5em 0" },
          h4: { fontSize: "1.2em", margin: "0 0 0.5em 0" },
          h5: { fontSize: "1.1em", margin: "0 0 0.4em 0" },
          h6: { fontSize: "1.05em", margin: "0 0 0.4em 0" },
          hr: { border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "2em 0" },
          img: {
            maxWidth: "100%",
            height: "auto"
          },
          svg: {
            maxWidth: "100%",
            height: "auto"
          },
          table: {
            width: "100%",
            maxWidth: "100%",
            display: "block",
            overflowX: "auto"
          },
          pre: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          },
          code: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          }
        });
        rendition.themes.register("leaflet-light", {
          html: {
            background: "#ffffff",
            color: "#1b1b1f",
            overflowX: "hidden"
          },
          body: {
            background: "#ffffff",
            color: "#1b1b1f",
            lineHeight: "1.8",
            fontFamily: "'Inter', sans-serif",
            margin: "0 auto",
            width: "100%",
            padding: "0",
            maxWidth: "100%",
            overflowX: "hidden"
          },
          "*": {
            boxSizing: "border-box",
            maxWidth: "100%"
          },
          p: {
            margin: "0 0 1.6em 0",
            textAlign: "justify",
            textIndent: "0"
          },
          span: {
            fontSize: "inherit"
          },
          div: {
            fontSize: "inherit"
          },
          li: {
            marginBottom: "0.6em"
          },
          h1: { fontSize: "1.6em", margin: "2.2em 0 0.6em 0", paddingTop: "0.4em", borderTop: "1px solid rgba(15,15,16,0.12)" },
          h2: { fontSize: "1.45em", margin: "2em 0 0.6em 0", paddingTop: "0.4em", borderTop: "1px solid rgba(15,15,16,0.12)" },
          h3: { fontSize: "1.3em", margin: "1.6em 0 0.5em 0" },
          h4: { fontSize: "1.2em", margin: "0 0 0.5em 0" },
          h5: { fontSize: "1.1em", margin: "0 0 0.4em 0" },
          h6: { fontSize: "1.05em", margin: "0 0 0.4em 0" },
          hr: { border: "none", borderTop: "1px solid rgba(15,15,16,0.12)", margin: "2em 0" },
          img: {
            maxWidth: "100%",
            height: "auto"
          },
          svg: {
            maxWidth: "100%",
            height: "auto"
          },
          table: {
            width: "100%",
            maxWidth: "100%",
            display: "block",
            overflowX: "auto"
          },
          pre: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          },
          code: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          }
        });
        rendition.themes.select(readerTheme === "light" ? "leaflet-light" : "leaflet-dark");
        applyReaderTypography();
        applyReaderInsets();
        const initialFlow = "scrolled-doc";
        const initialSpread = "none";
        rendition.flow(initialFlow);
        const manager = rendition.manager as any;
        if (manager?.settings) {
          manager.settings.flow = initialFlow;
          manager.settings.spread = initialSpread;
        }
        if (typeof rendition.spread === "function") {
          rendition.spread(initialSpread);
        }
        ensureSingleScrollContainer();

        const navigation = await epub.loaded.navigation;
        const flatToc = flattenToc(navigation.toc);
        setToc(flatToc);
        const chapterToc = flatToc.filter((item) => isChapterLike(item.label));
        const indexMap: Record<string, number> = {};
        const labelMap: Record<string, string> = {};
        const spineIndexByHref: Record<string, number> = {};
        const spineItems = epub.spine?.items ?? [];
        spineItems.forEach((item: any, idx: number) => {
          if (item?.href) {
            spineIndexByHref[item.href] = idx;
          }
        });
        let dedupIndex = 0;
        const seenHrefs = new Set<string>();
        chapterToc.forEach((item) => {
          if (seenHrefs.has(item.href)) {
            return;
          }
          seenHrefs.add(item.href);
          indexMap[item.href] = dedupIndex;
          labelMap[item.href] = item.label;
          dedupIndex += 1;
        });
        setTocIndexByHref(indexMap);
        setTocLabelByHref(labelMap);
        spineIndexByHrefRef.current = spineIndexByHref;
        chapterSpineIndicesRef.current = Object.keys(indexMap)
          .map((href) => spineIndexByHref[href])
          .filter((value) => typeof value === "number")
          .sort((a, b) => (a as number) - (b as number)) as number[];

        const onRelocated = (location: any) => {
          const resolveProgress = () => {
            const href = location?.start?.href ?? location?.end?.href;
            const spineIndex = typeof location?.start?.index === "number"
              ? location.start.index
              : typeof location?.end?.index === "number"
                ? location.end.index
                : href
                  ? spineIndexByHrefRef.current[href]
                  : undefined;

            const chapterSpineIndices = chapterSpineIndicesRef.current;
            const chapterTotal = chapterSpineIndices.length;
            const firstChapterSpine = chapterTotal > 0 ? chapterSpineIndices[0] : undefined;
            const lastChapterSpine = chapterTotal > 0 ? chapterSpineIndices[chapterTotal - 1] : undefined;

            if (chapterTotal > 0 && typeof spineIndex === "number" && typeof firstChapterSpine === "number") {
              if (spineIndex < firstChapterSpine) {
                return 0;
              }
            }

            let chapterIndex = href && indexMap[href] !== undefined ? indexMap[href] : undefined;
            if (chapterIndex === undefined && typeof spineIndex === "number" && chapterTotal > 0) {
              for (let i = 0; i < chapterSpineIndices.length; i += 1) {
                if (spineIndex >= chapterSpineIndices[i]) {
                  chapterIndex = i;
                } else {
                  break;
                }
              }
            }

            const sectionProgress = () => {
              const displayed = location?.start?.displayed ?? location?.end?.displayed;
              if (displayed?.page && displayed?.total && displayed.total > 1) {
                const ratio = displayed.page / displayed.total;
                if (Number.isFinite(ratio)) {
                  return Math.min(1, Math.max(0, ratio));
                }
              }
              return 0;
            };

            if (chapterTotal > 0 && typeof chapterIndex === "number") {
              if (typeof spineIndex === "number" && typeof lastChapterSpine === "number" && spineIndex > lastChapterSpine) {
                return 1;
              }
              const within = sectionProgress();
              if (chapterIndex >= chapterTotal - 1 && within >= 0.98) {
                return 1;
              }
              const progress = (chapterIndex + within) / chapterTotal;
              return Math.min(1, Math.max(0, progress));
            }

            const cfi = location?.start?.cfi ?? location?.end?.cfi;
            const locations = bookRef.current?.locations;
            if (cfi && locations?.percentageFromCfi) {
              const percent = locations.percentageFromCfi(cfi);
              if (typeof percent === "number" && Number.isFinite(percent)) {
                return Math.min(1, Math.max(0, percent));
              }
            }

            const direct = location?.start?.percentage ?? location?.end?.percentage;
            if (typeof direct === "number" && Number.isFinite(direct)) {
              return Math.min(1, Math.max(0, direct));
            }

            return 0;
          };

          const percentage = resolveProgress();
          const now = Date.now();
          if (location?.start?.cfi) {
            lastCfiRef.current = location.start.cfi;
            const href = location?.start?.href;
            if (href) {
              chapterPositionsRef.current = {
                ...chapterPositionsRef.current,
                [href]: location.start.cfi
              };
            }
            try {
              localStorage.setItem(
                storageKey,
                JSON.stringify({
                  fontSize: fontSizeRef.current,
                  sidebarOpen: sidebarRef.current,
                  cfi: location.start.cfi,
                  chapterPositions: chapterPositionsRef.current
                })
              );
            } catch {
              // ignore storage errors
            }
          }

          // no auto-advance in scroll mode

          const shouldUpdateProgress =
            Math.abs(percentage - lastProgressRef.current) >= 0.005 ||
            now - lastProgressAtRef.current >= 10000;

          if (shouldUpdateProgress) {
            lastProgressRef.current = percentage;
            lastProgressAtRef.current = now;
            void bookService.updateProgress(book.id, percentage);
            updateBookProgress(book.id, percentage);
            lastComputedProgressRef.current = percentage;
          }

          const href = location?.start?.href;
          if (href && indexMap[href] !== undefined) {
            setChapterIndex(indexMap[href]);
            setChapterLabel(labelMap[href] ?? "Chapter");
          }
          if (href) {
            setCurrentHref(href);
          }

          scheduleReaderDotUpdate();
          scrollAdvanceLockRef.current = false;

        };
        relocateHandlerRef.current = onRelocated;
        rendition.on("relocated", onRelocated);
        rendition.on?.("rendered", () => {
          applyReaderTypography();
          ensureSingleScrollContainer();
          ensureScrollContainer();
        });

        if (lastCfiRef.current) {
          await rendition.display(lastCfiRef.current);
        } else {
          await rendition.display();
        }
        applyReaderInsets();
        setLoading(false);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load book.");
        setLoading(false);
      }
    };

    load();

    return () => {
      if (renditionRef.current && relocateHandlerRef.current) {
        renditionRef.current.off("relocated", relocateHandlerRef.current);
      }
      removeLastReadMarker();
      if (renditionRef.current) {
        renditionRef.current.destroy();
        renditionRef.current = null;
      }
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
      }
    };
  }, [book.id, localPath]);

  // flip mode removed; scroll flow is initialized during load

  useEffect(() => {
    if (!renditionRef.current?.themes) {
      return;
    }
    const themeName = readerTheme === "light" ? "leaflet-light" : "leaflet-dark";
    renditionRef.current.themes.select(themeName);
    const themeBg = readerTheme === "light" ? "#ffffff" : "#000000";
    const themeText = readerTheme === "light" ? "#1b1b1f" : "#ffffff";
    renditionRef.current.themes.override("background", themeBg);
    renditionRef.current.themes.override("color", themeText);
    const contentsList = renditionRef.current.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document;
      if (!doc) {
        return;
      }
      doc.documentElement.style.background = themeBg;
      doc.body.style.background = themeBg;
      doc.documentElement.style.color = themeText;
      doc.body.style.color = themeText;
    });
    if (readerDotEnabled) {
      ensureScrollContainer();
      scheduleReaderDotUpdate();
    }
  }, [readerTheme]);

  useEffect(() => {
    let activeContainer: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const onWheel = (event: WheelEvent) => {
      // scroll-only mode
      const target = event.currentTarget as HTMLElement;
      if (!target) {
        return;
      }
      if (event.deltaY > 0) {
        lastWheelDownAtRef.current = Date.now();
        if (isAtScrollBottom(target, 2)) {
          triggerScrollAdvance();
        }
      }
      scheduleReaderDotUpdate();
    };

    const onScroll = (event: Event) => {
      // scroll-only mode
      const target = event.currentTarget as HTMLElement;
      if (!target) {
        return;
      }
      const now = Date.now();
      const last = lastScrollTopRef.current ?? target.scrollTop;
      const delta = target.scrollTop - last;
      lastScrollTopRef.current = target.scrollTop;
      if (delta > 0) {
        lastWheelDownAtRef.current = now;
      }
      if (isAtScrollBottom(target, 2) && now - lastWheelDownAtRef.current < 700) {
        triggerScrollAdvance();
      }
      scheduleReaderDotUpdate();
    };

    const attach = (container: HTMLElement) => {
      activeContainer = container;
      ensureScrollSpacer(container);
      resizeObserver = new ResizeObserver(() => {
        ensureScrollSpacer(container);
      });
      resizeObserver.observe(container);
      container.addEventListener("wheel", onWheel, { passive: true });
      container.addEventListener("scroll", onScroll, { passive: true });
    };

    const detach = () => {
      if (!activeContainer) {
        return;
      }
      activeContainer.removeEventListener("wheel", onWheel);
      activeContainer.removeEventListener("scroll", onScroll);
      resizeObserver?.disconnect();
      resizeObserver = null;
      activeContainer = null;
      lastScrollTopRef.current = null;
    };

    const onRendered = () => {
      const next = ensureScrollContainer();
      if (!next) {
        return;
      }
      if (activeContainer !== next) {
        detach();
        attach(next);
      } else {
        ensureScrollSpacer(next);
      }
    };

    const initial = ensureScrollContainer();
    if (initial) {
      attach(initial);
    }
    renditionRef.current?.on?.("rendered", onRendered);

    return () => {
      renditionRef.current?.off?.("rendered", onRendered);
      detach();
    };
  }, [book.id]);

  useEffect(() => {
    if (!autoScrollActive) {
      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      autoScrollLastTimeRef.current = null;
      autoScrollCarryRef.current = 0;
      return;
    }

    const container = ensureScrollContainer();
    if (!container) {
      return;
    }

    autoScrollLastTimeRef.current = null;

    const tick = (time: number) => {
      if (!autoScrollActive) {
        return;
      }
      if (autoScrollLastTimeRef.current === null) {
        autoScrollLastTimeRef.current = time;
      }
      const deltaSeconds = Math.min(0.2, (time - autoScrollLastTimeRef.current) / 1000);
      autoScrollLastTimeRef.current = time;
      const before = container.scrollTop;
      const normalized = Math.min(100, Math.max(0, autoScrollSpeed)) / 100;
      const speedPxPerSecond = 16 + normalized * 220;
      autoScrollCarryRef.current += speedPxPerSecond * deltaSeconds;
      const move = Math.floor(autoScrollCarryRef.current);
      if (move > 0) {
        autoScrollCarryRef.current -= move;
        container.scrollTop = before + move;
      }
      if (container.scrollTop === before && isAtScrollBottom(container, 2)) {
        triggerScrollAdvance();
      }
      autoScrollRafRef.current = requestAnimationFrame(tick);
    };

    autoScrollRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      autoScrollLastTimeRef.current = null;
      autoScrollCarryRef.current = 0;
    };
  }, [autoScrollActive, autoScrollSpeed, book.id]);

  const getScrollContainer = () => {
    const cached = scrollContainerRef.current;
    if (cached && cached.isConnected) {
      return cached;
    }
    const manager = renditionRef.current?.manager as any;
    if (manager?.settings?.fullsize) {
      return document.scrollingElement ?? document.documentElement;
    }
    if (manager?.container) {
      return manager.container as HTMLElement;
    }
    const root = viewerRef.current;
    if (!root) {
      return null;
    }
    const candidate =
      root.querySelector(".epub-container") ||
      root.querySelector(".epub-view");
    if (candidate) {
      return candidate as HTMLElement;
    }
    if (root.scrollHeight > root.clientHeight + 2) {
      return root;
    }
    return null;
  };

  const isSkippableSpine = (item: any) => {
    if (!item) {
      return true;
    }
    if (item.linear === "no") {
      return true;
    }
    const rawProps = item.properties ?? [];
    const props = Array.isArray(rawProps)
      ? rawProps
      : typeof rawProps === "string"
        ? rawProps.split(" ")
        : [];
    if (props.some((prop: string) => ["nav", "cover", "cover-image"].includes(prop))) {
      return true;
    }
    const media = item?.mime ?? item?.mediaType ?? "";
    if (media && !media.includes("xhtml") && !media.includes("html") && !media.includes("svg+xml")) {
      return true;
    }
    return !item.href;
  };

  const getLocationIndex = (href?: string) => {
    const location = renditionRef.current?.location;
    if (typeof location?.start?.index === "number") {
      return location.start.index;
    }
    if (typeof location?.end?.index === "number") {
      return location.end.index;
    }
    if (href && spineIndexByHrefRef.current[href] !== undefined) {
      return spineIndexByHrefRef.current[href];
    }
    return undefined;
  };

  const getSpineIndex = (href?: string) => {
    const location = renditionRef.current?.location;
    const key = href ?? location?.start?.href ?? location?.end?.href;
    return getLocationIndex(key);
  };

  const displaySpine = (startIndex: number, direction: 1 | -1) => {
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    const spineItems = epub?.spine?.items;
    if (!rendition || !Array.isArray(spineItems)) {
      return false;
    }
    let index = startIndex;
    while (index >= 0 && index < spineItems.length) {
      const item = spineItems[index];
      if (!isSkippableSpine(item)) {
        void rendition.display(item.href);
        return true;
      }
      index += direction;
    }
    return false;
  };

  const displayNextSpine = (href?: string) => {
    const index = getSpineIndex(href);
    if (typeof index !== "number") {
      return false;
    }
    return displaySpine(index + 1, 1);
  };

  const displayPrevSpine = (href?: string) => {
    const index = getSpineIndex(href);
    if (typeof index !== "number") {
      return false;
    }
    return displaySpine(index - 1, -1);
  };

  const goNextSection = () => {
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    const location = rendition?.location;
    const index = location?.start?.index ?? location?.end?.index;
    const href = location?.start?.href ?? location?.end?.href;
    if (href && epub?.spine?.get) {
      const current = epub.spine.get(href);
      const next = current?.next ? current.next() : null;
      if (next?.href) {
        displayChapter(next.href, { useSaved: false });
        return;
      }
    }
    if (typeof index === "number" && displaySpine(index + 1, 1)) {
      return;
    }
    void rendition?.next();
  };

  const goPrevSection = () => {
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    const location = rendition?.location;
    const index = location?.start?.index ?? location?.end?.index;
    const href = location?.start?.href ?? location?.end?.href;
    if (href && epub?.spine?.get) {
      const current = epub.spine.get(href);
      const prev = current?.prev ? current.prev() : null;
      if (prev?.href) {
        displayChapter(prev.href, { useSaved: false });
        return;
      }
    }
    if (typeof index === "number" && displaySpine(index - 1, -1)) {
      return;
    }
    void rendition?.prev();
  };

  // no auto-advance listeners in scroll mode

  useEffect(() => {
    try {
      persistReaderState();
    } catch {
      // ignore
    }
  }, [fontSize, sidebarOpen, storageKey]);

  useEffect(() => {
    if (!renditionRef.current?.themes?.fontSize) {
      applyReaderTypography();
      return;
    }
    fontSizeRef.current = fontSize;
    applyReaderTypography();
    applyReaderInsets();
    persistReaderState();
  }, [fontSize]);

  useEffect(() => {
    applyReaderInsets();
    persistReaderState();
    const contentsList = renditionRef.current?.getContents?.() ?? [];
    const pad = sidebarOpen ? 28 : 16;
    contentsList.forEach((contents: any) => {
      const doc = contents?.document;
      if (!doc) {
        return;
      }
      doc.documentElement.style.setProperty("--reader-content-pad", `${pad}px`);
    });
    if (readerDotElementRef.current) {
      readerDotElementRef.current.dataset.fixedLeft = "";
    }
  }, [sidebarOpen]);

  useEffect(() => {
    if (lastCfiRef.current) {
      scheduleReaderDotUpdate();
    }
  }, [sidebarOpen]);

  useEffect(() => {
    if (!readerDotEnabled) {
      removeLastReadMarker();
      return;
    }
    const location = renditionRef.current?.location;
    const cfi = location?.end?.cfi ?? location?.start?.cfi;
    if (cfi) {
      updateLastReadMarker(cfi);
    }
    scheduleReaderDotUpdate();
  }, [readerDotEnabled]);

  useEffect(() => {
    fontSizeRef.current = fontSize;
  }, [fontSize]);

  useEffect(() => {
    sidebarRef.current = sidebarOpen;
  }, [sidebarOpen]);

  const resolvedCover = coverFallback ?? coverSrc;
  const handleCoverError = () => {
    if (coverTriedRef.current) {
      return;
    }
    coverTriedRef.current = true;
    void bookService.coverData(book.id).then((data) => {
      if (data) {
        setCoverFallback(data);
      }
    });
  };
  const isLight = readerTheme === "light";
  const showFocusToast = (message: string) => {
    setFocusToast(message);
    if (focusToastTimerRef.current) {
      window.clearTimeout(focusToastTimerRef.current);
    }
    focusToastTimerRef.current = window.setTimeout(() => {
      setFocusToast(null);
    }, 2400);
  };

  return (
    <div
      className={`reader-scope fixed inset-0 z-50 h-full w-full overflow-hidden reader-bg ${isLight ? "reader-light" : ""}`}
    >
      <header className="fixed left-0 right-0 top-0 z-50 flex w-full items-center justify-between px-6 py-6 md:px-8 reader-panel-soft transition-all duration-300">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full border reader-border reader-icon transition reader-hover-accent"
            onClick={handleToggleSidebar}
          >
            <span className="material-symbols-outlined">
              {sidebarOpen ? "dock_to_left" : "dock_to_right"}
            </span>
          </button>
          <button
            type="button"
            className="group flex items-center gap-2 transition-all reader-icon reader-hover-accent"
            onClick={onClose}
          >
            <span className="material-symbols-outlined transition-transform group-hover:-translate-x-1 reader-accent">
              arrow_back
            </span>
            <span className="text-xs uppercase tracking-widest reader-accent">Back to Library</span>
          </button>
        </div>
        <div className="absolute left-1/2 hidden -translate-x-1/2 flex-col items-center text-center md:flex">
          <h1 className="font-headline text-xl font-bold reader-accent">{book.title}</h1>
          <span className="text-xs uppercase tracking-[0.2em] reader-muted">
            {book.author ?? "Unknown author"}
          </span>
        </div>
        <div className="flex items-center gap-4 md:gap-6">
          <button
            className="reader-icon transition-colors reader-hover-accent"
            type="button"
            onClick={() => setFontPanelOpen((prev) => !prev)}
          >
            <span className="material-symbols-outlined">text_fields</span>
          </button>
          {fontPanelOpen && (
            <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs uppercase tracking-widest reader-panel-soft reader-border">
              <button
                type="button"
                className="rounded-full border px-2 py-1 transition reader-border reader-icon reader-hover-accent"
                onClick={() => setFontSize((size) => Math.max(14, size - 2))}
              >
                A-
              </button>
              <span className="min-w-[40px] text-center">{fontSize}px</span>
              <button
                type="button"
                className="rounded-full border px-2 py-1 transition reader-border reader-icon reader-hover-accent"
                onClick={() => setFontSize((size) => Math.min(32, size + 2))}
              >
                A+
              </button>
            </div>
          )}
          <div className="relative">
            <button
              className="reader-icon transition-colors reader-hover-accent"
              type="button"
              onClick={() => setBookmarkPanelOpen((prev) => !prev)}
            >
              <span className="material-symbols-outlined">bookmark</span>
            </button>
            {bookmarkPanelOpen && (
              <div className="absolute right-0 mt-3 w-64 rounded-2xl border p-4 text-xs shadow-2xl reader-panel reader-border">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-widest reader-muted">Bookmarks</span>
                  <button
                    type="button"
                    className="rounded-full border px-2 py-1 text-[10px] uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
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
                      onClick={() => openBookmark(bookmark.cfi)}
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
            ref={morePanelRef}
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
              morePanelCloseRef.current = window.setTimeout(() => {
                setMorePanelOpen(false);
              }, 180);
            }}
          >
            <button
              className="reader-icon transition-colors reader-hover-accent"
              type="button"
              onClick={() => setMorePanelOpen((prev) => !prev)}
            >
              <span className="material-symbols-outlined">more_horiz</span>
            </button>
            {morePanelOpen && (
              <div
                className="absolute right-0 mt-3 w-56 rounded-2xl border p-4 text-xs shadow-2xl reader-panel reader-border"
                onMouseEnter={() => {
                  if (morePanelCloseRef.current) {
                    window.clearTimeout(morePanelCloseRef.current);
                    morePanelCloseRef.current = null;
                  }
                }}
                onMouseLeave={() => {
                  if (morePanelCloseRef.current) {
                    window.clearTimeout(morePanelCloseRef.current);
                  }
                  morePanelCloseRef.current = window.setTimeout(() => {
                    setMorePanelOpen(false);
                  }, 180);
                }}
              >
                <div className="text-xs uppercase tracking-widest reader-muted">Reader</div>
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
                  onClick={() => setReaderTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                >
                  <span>Light mode</span>
                  <span className="reader-toggle" data-on={readerTheme === "light"} />
                </button>
                <div className="mt-3 rounded-lg border px-3 py-2 reader-border reader-pill">
                  <div className="text-[10px] uppercase tracking-widest reader-muted">Auto scroll</div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-full border transition reader-border reader-icon reader-hover-accent"
                      onClick={() => setAutoScrollActive((prev) => !prev)}
                      title={autoScrollActive ? "Pause auto scroll" : "Start auto scroll"}
                    >
                      <span className="material-symbols-outlined text-sm">
                        {autoScrollActive ? "pause" : "play_arrow"}
                      </span>
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={autoScrollSpeed}
                      onChange={(event) => setAutoScrollSpeed(Number(event.target.value))}
                      className="h-1 w-24 cursor-pointer accent-current"
                      title={`Auto scroll speed ${autoScrollSpeed}`}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
                  onClick={() => setReaderDotEnabled((prev) => !prev)}
                >
                  <span>Reader dot</span>
                  <span className="reader-toggle" data-on={readerDotEnabled} />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div
        className={`reader-shell flex h-full pt-24 md:pt-24 ${sidebarOpen ? "gap-2" : "gap-0"} ${
          sidebarAnimating ? "reader-animating" : ""
        }`}
      >
        <aside
          className={`reader-sidebar hidden min-w-0 flex-col border-r text-sm md:flex reader-border reader-panel-soft ${
            sidebarOpen
              ? "reader-sidebar-open w-72 px-6 py-6 opacity-100"
              : "reader-sidebar-closed w-0 overflow-hidden px-0 py-0 border-transparent opacity-0 pointer-events-none"
          }`}
        >
          <div className="mb-6">
            {resolvedCover && (
              <div className="mb-4 h-44 w-32 overflow-hidden rounded-xl border reader-border">
                <img src={resolvedCover} alt={book.title} className="h-full w-full object-cover" onError={handleCoverError} />
              </div>
            )}
            <h2 className="font-headline text-lg font-bold reader-text-color">{book.title}</h2>
            <p className="text-xs uppercase tracking-[0.2em] reader-muted">
              {book.author ?? "Unknown author"}
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.3em] reader-muted">Chapters</div>
          <div className="mt-4 flex-1 overflow-y-auto pr-2">
            {toc.length === 0 && (
              <div className="text-xs reader-muted">
                {loading ? "Loading chapters..." : "No chapters found."}
              </div>
            )}
            {toc.map((item) => {
              const active = currentHref ? item.href === currentHref : false;
              return (
              <button
                key={`${item.href}-${item.label}`}
                type="button"
                className={`mb-2 w-full rounded-lg px-3 py-2 text-left text-sm transition reader-icon reader-hover-bg reader-hover-accent ${
                  active ? "font-semibold text-primary" : ""
                }`}
                onClick={() => displayChapter(item.href)}
              >
                <span className="relative inline-flex w-full flex-col gap-2">
                  <span>{item.label}</span>
                  <span
                    className={`h-[2px] rounded-full bg-primary/80 transition-all duration-300 ease-out ${
                      active ? "w-12 opacity-100" : "w-2 opacity-0"
                    }`}
                  />
                </span>
              </button>
              );
            })}
          </div>
        </aside>

        <main className="reader-main flex-1 overflow-hidden">
          {loadError && (
            <div className="mx-auto mt-24 max-w-2xl rounded-2xl border reader-border reader-panel p-6 text-center reader-muted">
              {loadError}
            </div>
          )}
          {!loadError && (
            <div className="relative h-full overflow-hidden">
              {sidebarAnimating && <div className="reader-transition-mask" />}
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center text-sm reader-panel-soft reader-muted">
                  Loading book...
                </div>
              )}
              <div
                ref={viewerRef}
                className="reader-container reader-scroll h-full w-full overflow-hidden overscroll-x-none"
              />
              <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center">
                <div className="pointer-events-auto flex items-center gap-4 rounded-full border px-4 py-2 text-xs uppercase tracking-widest reader-pill reader-border">
                  <button
                    type="button"
                    className="rounded-full border px-3 py-1 transition reader-border reader-icon reader-hover-accent"
                    onClick={goPrevSection}
                  >
                    <span className="material-symbols-outlined text-base">chevron_left</span>
                  </button>
                  <span className="text-[10px] reader-muted">
                    {formatChapterDisplay()}
                  </span>
                  <button
                    type="button"
                    className="rounded-full border px-3 py-1 transition reader-border reader-icon reader-hover-accent"
                    onClick={goNextSection}
                  >
                    <span className="material-symbols-outlined text-base">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {activeSession && (
        <div className={`leaflet-mug ${coffeeProgress >= 0.99 ? "leaflet-mug-done" : ""}`}>
          <div className="leaflet-mug-cup">
            <div
              className="leaflet-mug-coffee"
              style={{ height: `${Math.min(100, Math.round(coffeeProgress * 100))}%` }}
            />
            <div className="leaflet-mug-handle" />
          </div>
          {coffeeProgress > 0.2 && (
            <div className="leaflet-mug-steam" />
          )}
          {coffeeProgress > 0.5 && (
            <div className="leaflet-mug-steam" />
          )}
          {coffeeProgress > 0.75 && (
            <div className="leaflet-mug-steam" />
          )}
        </div>
      )}

      {checkpointOpen && checkpointLevel && (
        <div className="fixed bottom-6 right-6 z-[70] w-full max-w-xs">
          <div
            className="rounded-2xl border p-4 text-left shadow-2xl backdrop-blur reader-panel reader-border"
            onMouseEnter={() => {
              if (checkpointTimerRef.current) {
                window.clearTimeout(checkpointTimerRef.current);
                checkpointTimerRef.current = null;
              }
            }}
            onMouseLeave={() => {
              if (!checkpointTimerRef.current) {
                checkpointTimerRef.current = window.setTimeout(() => {
                  setCheckpointOpen(false);
                }, 6000);
              }
            }}
          >
            <div className="text-[10px] uppercase tracking-widest reader-muted">Focus Checkpoint</div>
            <h3 className="mt-2 text-sm font-headline font-bold reader-text-color">
              {checkpointLevel === 0.5
                ? "Halfway There"
                : checkpointLevel === 0.9
                  ? "Almost Done"
                  : "Session Complete"}
            </h3>
            <p className="mt-1 text-xs reader-muted">
              {checkpointLevel === 1
                ? "Great session. Continue or end and save your progress."
                : "Nice work. Keep the momentum going."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {checkpointLevel === 1 && (
                <button
                  type="button"
                  className="rounded-full border px-3 py-1 text-[10px] uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
                  onClick={handleCheckpointContinue}
                >
                  Continue +10 min
                </button>
              )}
              {checkpointLevel === 1 ? (
                <button
                  type="button"
                  className="rounded-full bg-primary px-3 py-1 text-[10px] font-semibold text-on-primary"
                  onClick={handleCheckpointEnd}
                >
                  End Session
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-full border px-3 py-1 text-[10px] uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
                  onClick={() => {
                    if (checkpointTimerRef.current) {
                      window.clearTimeout(checkpointTimerRef.current);
                      checkpointTimerRef.current = null;
                    }
                    setCheckpointOpen(false);
                  }}
                >
                  Keep Reading
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {focusToast && (
        <div className="fixed bottom-6 right-6 z-[60]">
          <div className="rounded-full border px-4 py-2 text-[10px] uppercase tracking-widest shadow-xl reader-panel reader-border reader-muted">
            {focusToast}
          </div>
        </div>
      )}

      {noteModalOpen && noteSessionId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-6">
          <div className="w-full max-w-sm rounded-2xl border p-6 reader-panel reader-border">
            <div className="text-xs uppercase tracking-widest reader-muted">Session Notes</div>
            <h3 className="mt-2 text-lg font-headline font-bold reader-text-color">Add a quick note</h3>
            <textarea
              className="mt-4 h-28 w-full resize-none rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
              placeholder="What did you read or learn?"
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
            />
            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                className="rounded-full border px-4 py-2 text-xs uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
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
    </div>
  );
};
