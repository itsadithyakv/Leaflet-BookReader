import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { Book } from "@shared/models/book";
import ePub, { EpubCFI } from "epubjs";
import { bookService } from "../services/bookService";
import { useLibraryStore } from "../store/libraryStore";
import { useAutoHideChrome } from "../hooks/useAutoHideChrome";
import { getSessionProgress, sessionElapsedMs, useHabitStore } from "../store/habitStore";
import { useReadingHeartbeat } from "../hooks/useReadingHeartbeat";
import { useAppearanceStore, type ThemeMode } from "../store/appearanceStore";
import {
  estimateWordDifficulty,
  estimateRsvpPauseMultiplier,
  getAdaptiveWpm,
  getReadingTimeBand,
  loadSmartReadCalibration,
  loadSmartReadProfile,
  recordSmartReadSample,
  saveSmartReadProfile,
  type SmartReadCalibration,
  type SmartReadProfile
} from "../services/smartReadService";
import { PAPER_GRAIN } from "../constants/textures";
import { UiIcon } from "../components/UiIcon";
import { PipExitGuard, useFocusLockExit } from "../hooks/useFocusLockExit";
import { watchForeground } from "../services/windowService";
import { accountService } from "../services/accountService";
import ztNatureBoldWoff2 from "../assets/fonts/ZTNature-Bold.woff2";
import { formatSummary, getBookExtension, isReadableExtension } from "../constants/bookFormats";
import { buildSectionWeights, isChapterLike, spineIndexForProgress, type SectionWeights } from "../readers/progress";
import { highlightsMarkdown, useAnnotations } from "../readers/useAnnotations";
import { AnnotationsPanel } from "../readers/AnnotationsPanel";
import { SelectionBar } from "../readers/SelectionBar";
import { SearchPanel } from "../readers/SearchPanel";
import type { SearchHit } from "../readers/searchBook";
import { HIGHLIGHT_COLORS } from "../readers/highlightColors";

type ReaderViewProps = {
  book: Book;
  onClose: () => void;
};
import { LAYOUT_KEY, readLayout, type ReaderLayout, type TocItem, type ReaderDisplayMode, type ReadingMode, type ReaderWord, type ReadingWordState, type SmartSession } from "../readers/readerTypes";
import { getReaderFinish, getReaderFinishBackground, PAGE_TOP_PAD } from "../readers/finish";
import { flattenToc } from "../readers/toc";
import { INK_SAMPLE, markInkImages } from "../readers/inkImages";
import { friendlyOpenError } from "../readers/openErrors";
import { AUTO_SCROLL_DEFAULT_KEY, AUTO_SCROLL_YIELD_BACK_MS, AUTO_SCROLL_YIELD_AHEAD_MS, AUTO_SCROLL_TUNE_COOLDOWN_MS, autoScrollLinesPerMinute, autoScrollPixelsPerSecond, readAutoScrollDefault } from "../readers/autoScroll";
import { rsvpPivotIndex, HANDS_FREE_GRACE_MS, READER_BLOCK_SELECTOR, SENTENCE_END_PATTERN, isInlineJoin, getPaceFactor, getPaceScale } from "../readers/pacing";

export const ReaderView = ({ book, onClose }: ReaderViewProps) => {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<any>(null);
  const bookRef = useRef<ReturnType<typeof ePub> | null>(null);
  const relocateHandlerRef = useRef<((location: { start?: { percentage?: number } }) => void) | null>(null);
  // Seeded from the library, so closing a book before its position is known
  // writes back what was there rather than 0.
  const lastProgressRef = useRef(typeof book.progress === "number" ? book.progress : 0);
  const lastProgressAtRef = useRef(0);
  const lastComputedProgressRef = useRef(typeof book.progress === "number" ? book.progress : -1);
  /**
   * Progress is saved only once the position is trustworthy: the saved place
   * was restored, or the reader has moved. Opening a book with no local
   * position (another device, cleared data) used to save ~0 on the first
   * render, and that 0 then synced over the real progress everywhere.
   */
  const progressArmedRef = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);
  const lastMarkerRef = useRef<string | null>(null);
  const scrollAdvanceLockRef = useRef(false);
  /**
   * Until then, the app itself is moving the page (a chapter jump, a bookmark,
   * restoring your place, reflowing after a font change). While the content
   * is swapped the scroll position jumps, which looked exactly like scrolling
   * to the bottom, and "next chapter" fired and beat the jump: picking
   * Chapter 4 from the list landed on Chapter 2.
   */
  const navigatingUntilRef = useRef(0);
  const markNavigating = (ms = 1500) => {
    navigatingUntilRef.current = Date.now() + ms;
  };
  const scrollAdvanceTimerRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const lastWheelDownAtRef = useRef(0);
  const lastScrollTopRef = useRef<number | null>(null);
  const autoScrollLastTimeRef = useRef<number | null>(null);
  const autoScrollCarryRef = useRef(0);
  const readerDotTimerRef = useRef<number | null>(null);
  const readerDotRetryTimerRef = useRef<number | null>(null);
  const wordIndexTimerRef = useRef<number | null>(null);
  const sidebarOpenTimerRef = useRef<number | null>(null);
  const sidebarCloseTimerRef = useRef<number | null>(null);
  const manualScrollTimerRef = useRef<number | null>(null);
  const readerDotDragFrameRef = useRef<number | null>(null);
  const readerDotOffscreenTimerRef = useRef<number | null>(null);
  const readerDotRetryRef = useRef<{ cfi: string; count: number }>({ cfi: "", count: 0 });
  const readerDotElementRef = useRef<HTMLElement | null>(null);
  const readerDotEnabledRef = useRef(true);
  const readingEngineTimerRef = useRef<number | null>(null);
  const readingModeRef = useRef<ReadingMode>("standard");
  const readingPausedRef = useRef(false);
  const speedReadWpmRef = useRef(260);
  const readerWordsRef = useRef<ReaderWord[]>([]);
  const readingPaceScaleRef = useRef({ speed: 1, smart: 1 });
  const activeWordIndexRef = useRef(0);
  const readerDotAnchorIndexRef = useRef<number | null>(null);
  const readerDotUserAnchorUntilRef = useRef(0);
  const requestedStartIndexRef = useRef<number | null>(null);
  const programmaticScrollUntilRef = useRef(0);
  const smartManualOverrideUntilRef = useRef(0);
  const smartPaceBiasRef = useRef(1);
  const smartAheadTimerRef = useRef<number | null>(null);
  const smartAheadTargetIndexRef = useRef<number | null>(null);
  const smartSessionRef = useRef<SmartSession | null>(null);
  const manualReadingRef = useRef<{ index: number; at: number } | null>(null);
  const activeSession = useHabitStore((state) => state.activeSession);
  const focusSettings = useHabitStore((state) => state.focusSettings);
  const stopSession = useHabitStore((state) => state.stopSession);
  const extendSession = useHabitStore((state) => state.extendSession);
  // Credits time toward the daily goal while this reader is open and in use.
  const markReadingActivity = useReadingHeartbeat(true);
  // Last wheel or key press from the reader's own hands. A scroll event cannot
  // tell auto-scroll or Smart Read from a person, so on its own it kept the
  // heartbeat crediting minutes for a reader who had walked away. Hands-free
  // reading still counts, for a grace window after the last real input.
  const lastHandsOnAtRef = useRef(Date.now());
  const openedAtRef = useRef(Date.now());
  // Key and wheel input inside the epub.js iframe never reaches this window, so
  // the content documents forward to these (see bindContentInput).
  const readerKeyHandlerRef = useRef<((event: KeyboardEvent) => void) | null>(null);
  const contentWheelHandlerRef = useRef<((deltaY: number) => void) | null>(null);
  const [coffeeProgress, setCoffeeProgress] = useState(0);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [checkpointLevel, setCheckpointLevel] = useState<0.5 | 0.9 | 1 | null>(null);
  const checkpointTimerRef = useRef<number | null>(null);
  const [focusToast, setFocusToast] = useState<string | null>(null);
  const focusToastTimerRef = useRef<number | null>(null);
  // Bound into the book's iframes and listeners once; they read live state
  // through these.
  const holdAutoScrollRef = useRef<(held: boolean) => void>(() => undefined);
  const noteAutoScrollCorrectionRef = useRef<(container: HTMLElement, deltaY: number) => void>(
    () => undefined
  );
  // The key handler is bound once; this keeps it calling the current toast.
  const showFocusToastRef = useRef<(message: string) => void>(() => undefined);
  const checkpointRef = useRef(0);
  const sessionStartRef = useRef<string | null>(null);

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
    // The 100% checkpoint was opened by the effect above in this same commit;
    // its state update has not landed yet, but its timer has. Without this the
    // session stopped before "Continue +10 min" could ever be pressed.
    if (checkpointRef.current === 1 && checkpointTimerRef.current) {
      return;
    }
    const totalSeconds = activeSession.durationMinutes * 60;
    const elapsedSeconds = Math.round(sessionElapsedMs(activeSession) / 1000);
    if (elapsedSeconds >= totalSeconds) {
      handleStopSession({ reason: "completed", cleanSession: true });
    }
  }, [activeSession, checkpointOpen, checkpointLevel, coffeeProgress]);

  const handleStopSession = (options?: { reason?: "completed" | "manual_end"; cleanSession?: boolean }) => {
    // The wrap-up screen (mounted in App, above the reader) takes it from
    // here, note included.
    void stopSession(options);
  };

  // Focus lock: leaving the book mid-session takes intent (see the hook).
  const exitGuard = useFocusLockExit(onClose);

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
      // Typing in the session note (or any field) owns the keyboard: Space must
      // type a space, arrows move the caret, and Escape must not close the
      // reader and throw the note away.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest?.('[role="alertdialog"]'))
      ) {
        return;
      }
      // Dotty's own slider handles ArrowUp/Down and prevents default; the page
      // must not also scroll or change section underneath it.
      if (event.defaultPrevented) {
        return;
      }
      lastHandsOnAtRef.current = Date.now();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.key === "Escape") {
        if (selectionRef.current) {
          clearSelectionRef.current();
          return;
        }
        exitGuard.escape(event);
        return;
      }
      if (layoutRef.current === "pages" && ["ArrowRight", "ArrowLeft", "PageDown", "PageUp", " "].includes(event.key)) {
        event.preventDefault();
        turnPageRef.current(event.key === "ArrowLeft" || event.key === "PageUp" || (event.key === " " && event.shiftKey) ? -1 : 1);
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
      if (event.key === "+" || event.key === "=" || event.key === "-" || event.key === "_") {
        const faster = event.key === "+" || event.key === "=";
        event.preventDefault();
        if (readingModeRef.current === "standard") {
          const next = Math.min(100, Math.max(0, autoScrollSpeedRef.current + (faster ? 5 : -5)));
          setAutoScrollSpeed(next);
          showFocusToastRef.current(`Auto-scroll ${autoScrollLinesPerMinute(next)} lines/min`);
        } else if (readingModeRef.current === "speed") {
          const next = Math.min(1000, Math.max(120, speedReadWpmRef.current + (faster ? 20 : -20)));
          setSpeedReadWpm(next);
          showFocusToastRef.current(`${next} words/min`);
        }
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const container = getScrollContainer();
        if (!container) {
          return;
        }
        if (autoScrollActiveRef.current) {
          autoScrollYieldUntilRef.current =
            Date.now() + (event.key === "ArrowUp" ? AUTO_SCROLL_YIELD_BACK_MS : AUTO_SCROLL_YIELD_AHEAD_MS);
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
        event.preventDefault();
        if (readingModeRef.current === "standard") {
          setAutoScrollActive((prev) => !prev);
        } else {
          setReadingPaused((prev) => !prev);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    readerKeyHandlerRef.current = onKey;
    return () => {
      window.removeEventListener("keydown", onKey);
      if (readerKeyHandlerRef.current === onKey) {
        readerKeyHandlerRef.current = null;
      }
    };
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (scrollAdvanceTimerRef.current) {
        window.clearTimeout(scrollAdvanceTimerRef.current);
      }
      if (readingEngineTimerRef.current) {
        window.clearTimeout(readingEngineTimerRef.current);
      }
      if (wordIndexTimerRef.current) {
        window.clearTimeout(wordIndexTimerRef.current);
      }
      if (sidebarOpenTimerRef.current) {
        window.clearTimeout(sidebarOpenTimerRef.current);
      }
      if (sidebarCloseTimerRef.current) {
        window.clearTimeout(sidebarCloseTimerRef.current);
      }
      if (manualScrollTimerRef.current) {
        window.clearTimeout(manualScrollTimerRef.current);
      }
      if (readerDotDragFrameRef.current) {
        window.cancelAnimationFrame(readerDotDragFrameRef.current);
      }
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
      }
      if (smartAheadTimerRef.current) {
        window.clearTimeout(smartAheadTimerRef.current);
      }
      if (checkpointTimerRef.current) {
        window.clearTimeout(checkpointTimerRef.current);
      }
      if (focusToastTimerRef.current) {
        window.clearTimeout(focusToastTimerRef.current);
      }
      if (lastComputedProgressRef.current >= 0) {
        const progress = Math.min(1, Math.max(0, lastComputedProgressRef.current));
        // The exact line goes along only once the position is trustworthy;
        // otherwise this is just "opened and closed", which keeps what synced.
        const position = progressArmedRef.current ? lastCfiRef.current : null;
        void bookService.updateProgress(book.id, progress, position ?? undefined);
        updateBookProgress(book.id, progress, position ?? undefined);
      }
    };
  }, []);

  const storageKey = useMemo(() => `leaflet.reader.${book.id}`, [book.id]);
  const readPrefs = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as {
        fontSize?: number;
        sidebarOpen?: boolean;
        displayMode?: ReaderDisplayMode;
        autoScrollSpeed?: number;
        speedReadWpm?: number;
        readerDotEnabled?: boolean;
        cfi?: string;
        cfiProgress?: number;
        chapterPositions?: Record<string, string>;
      };
    } catch {
      return null;
    }
  };

  const initialPrefs = readPrefs();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [fontSize, setFontSize] = useState(initialPrefs?.fontSize ?? 18);
  const fontSizeRef = useRef(fontSize);
  const sidebarRef = useRef(sidebarOpen);
  const [fontPanelOpen, setFontPanelOpen] = useState(false);
  const [autoScrollActive, setAutoScrollActive] = useState(false);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(
    () => initialPrefs?.autoScrollSpeed ?? readAutoScrollDefault()
  );
  // Auto-scroll steps aside, without stopping, while a hand is on the page:
  // held down (hold to pause), or scrolling by hand (it yields, then resumes
  // from wherever the reader left it).
  const autoScrollActiveRef = useRef(false);
  const autoScrollHeldRef = useRef(false);
  const [autoScrollHeld, setAutoScrollHeld] = useState(false);
  const autoScrollYieldUntilRef = useRef(0);
  // Hand scrolling during auto-scroll is a correction: ahead means too slow,
  // back means too fast. Bursts are summed, then retune the speed a notch.
  const autoScrollCorrectionRef = useRef({ net: 0, lastAt: 0 });
  const autoScrollTunedAtRef = useRef(0);
  const [displayMode, setDisplayMode] = useState<ReaderDisplayMode>(
    initialPrefs?.displayMode ?? "paper"
  );
  const [readingMode, setReadingMode] = useState<ReadingMode>("standard");
  const [pendingReadingMode, setPendingReadingMode] = useState<Exclude<ReadingMode, "standard"> | null>(
    null
  );
  const [readingPaused, setReadingPaused] = useState(false);
  const [speedReadWpm, setSpeedReadWpm] = useState(
    Math.min(1000, Math.max(120, initialPrefs?.speedReadWpm ?? 260))
  );
  const [readingWord, setReadingWord] = useState<ReadingWordState | null>(null);
  const [adaptiveWpm, setAdaptiveWpm] = useState(185);
  const readerTheme = useAppearanceStore((state) => state.theme);
  const displayModeRef = useRef<ReaderDisplayMode>(displayMode);
  const readerThemeRef = useRef(readerTheme);
  const autoScrollSpeedRef = useRef(autoScrollSpeed);
  // Keep the mirrors current during render so long-lived callbacks created inside
  // the load effect (relocation handler, epub content hook) never read stale prefs.
  displayModeRef.current = displayMode;
  readerThemeRef.current = readerTheme;
  autoScrollSpeedRef.current = autoScrollSpeed;
  autoScrollActiveRef.current = autoScrollActive;
  speedReadWpmRef.current = speedReadWpm;
  const toggleTheme = useAppearanceStore((state) => state.toggleTheme);
  // Calibration is per reader. It keys off the connected Google account when
  // there is one, and is device-local otherwise -- it used to key off whatever
  // had been typed into a sign-in modal that verified nothing.
  const accountEmail = useLibraryStore((state) => state.sync.accountEmail);
  const smartProfileRef = useRef<SmartReadProfile>(loadSmartReadProfile(accountEmail));
  const smartCalibrationRef = useRef<SmartReadCalibration>(
    loadSmartReadCalibration(accountEmail)
  );
  const [morePanelOpen, setMorePanelOpen] = useState(false);
  const morePanelRef = useRef<HTMLDivElement | null>(null);
  const morePanelCloseRef = useRef<number | null>(null);
  const [readerDotEnabled, setReaderDotEnabled] = useState(initialPrefs?.readerDotEnabled ?? true);
  // Scrolling (the default) or turning pages. A preference of this device,
  // shared by every book; changing it rebuilds the page.
  const [layout, setLayout] = useState<ReaderLayout>(readLayout);
  const layoutRef = useRef<ReaderLayout>(layout);
  layoutRef.current = layout;
  const paged = layout === "pages";
  const chooseLayout = (next: ReaderLayout) => {
    if (next === layout) {
      return;
    }
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // This session only.
    }
    if (next === "pages") {
      // Auto-scroll, Smart Read and SpeedRead are built on scrolling.
      setAutoScrollActive(false);
      setReadingMode("standard");
    }
    setLayout(next);
    setReloadKey((key) => key + 1);
  };
  // Sync during render: the load effect runs before the [readerDotEnabled]
  // effect, and would otherwise create a dot the user had switched off.
  readerDotEnabledRef.current = readerDotEnabled && layout === "scroll";
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The toolbar steps out of the way while reading. It stays put whenever one of
  // its own panels is open, which would otherwise vanish along with it. The
  // chapter list is not one of them: it opens on its own, under a hidden bar.
  /** Text selected in the page, offered for highlighting. */
  const [selection, setSelection] = useState<{ cfi: string; text: string } | null>(null);
  /** A highlight whose note the notes panel opens on (tapped in the page). */
  const [notesFocus, setNotesFocus] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const {
    visible: chromeVisible,
    reveal: revealChrome,
    hover: hoverChrome
  } = useAutoHideChrome(
    fontPanelOpen || bookmarkPanelOpen || morePanelOpen || searchOpen || selection !== null || loading || loadError !== null
  );
  // The page renders inside an epub.js iframe, and events there do not reach
  // this document — so without binding into it, a tap on the text could never
  // bring the toolbar back on a touch screen.
  const revealChromeRef = useRef(revealChrome);
  revealChromeRef.current = revealChrome;
  // Bookmarks and highlights, kept in the database (and the backup).
  const annotations = useAnnotations(book.id);
  // For the key handler, which is bound once.
  const selectionRef = useRef<{ cfi: string; text: string } | null>(null);
  const clearSelectionRef = useRef<() => void>(() => undefined);
  const { bookmarks, highlights } = annotations;

  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocIndexByHref, setTocIndexByHref] = useState<Record<string, number>>({});
  const [tocLabelByHref, setTocLabelByHref] = useState<Record<string, string>>({});
  // Where to reopen: this device's own last line, unless the synced position
  // (read on another device) is further on, or this device has none.
  const lastCfiRef = useRef<string | null>(
    (() => {
      const local = initialPrefs?.cfi ?? null;
      const synced = book.position ?? null;
      if (!synced || synced === local) {
        return local ?? synced;
      }
      if (!local) {
        return synced;
      }
      const localProgress = initialPrefs?.cfiProgress ?? 0;
      return (book.progress ?? 0) > localProgress + 0.002 ? synced : local;
    })()
  );
  const lastCfiProgressRef = useRef<number | null>(initialPrefs?.cfiProgress ?? null);
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
  /** Size-weighted progress for this book; null until known, or if unavailable. */
  const sectionWeightsRef = useRef<SectionWeights | null>(null);


  useEffect(() => {
    setBookmarkPanelOpen(false);
    setFontPanelOpen(false);
    setAutoScrollActive(false);
    setReadingMode("standard");
    setPendingReadingMode(null);
    setReadingPaused(false);
    setReadingWord(null);
    readerDotAnchorIndexRef.current = null;
    readerDotUserAnchorUntilRef.current = 0;
    if (readerDotOffscreenTimerRef.current) {
      window.clearTimeout(readerDotOffscreenTimerRef.current);
      readerDotOffscreenTimerRef.current = null;
    }
    requestedStartIndexRef.current = null;
    smartPaceBiasRef.current = 1;
    smartAheadTargetIndexRef.current = null;
    if (smartAheadTimerRef.current) {
      window.clearTimeout(smartAheadTimerRef.current);
      smartAheadTimerRef.current = null;
    }
    setMorePanelOpen(false);
  }, [book.id]);

  useEffect(() => {
    smartProfileRef.current = loadSmartReadProfile(accountEmail);
    smartCalibrationRef.current = loadSmartReadCalibration(accountEmail);
  }, [accountEmail]);

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
    // With pages, epub.js sizes and pads the columns itself; forcing a full
    // width here would collapse them into one long page.
    if (!rendition?.themes || layoutRef.current === "pages") {
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

  const openReaderSidebar = () => {
    if (sidebarOpenTimerRef.current) {
      window.clearTimeout(sidebarOpenTimerRef.current);
      sidebarOpenTimerRef.current = null;
    }
    if (sidebarCloseTimerRef.current) {
      window.clearTimeout(sidebarCloseTimerRef.current);
      sidebarCloseTimerRef.current = null;
    }
    setSidebarOpen(true);
  };

  const scheduleReaderSidebarOpen = () => {
    if (sidebarOpen || sidebarOpenTimerRef.current) {
      return;
    }
    sidebarOpenTimerRef.current = window.setTimeout(() => {
      sidebarOpenTimerRef.current = null;
      openReaderSidebar();
    }, 240);
  };

  const cancelReaderSidebarOpen = () => {
    if (!sidebarOpenTimerRef.current) {
      return;
    }
    window.clearTimeout(sidebarOpenTimerRef.current);
    sidebarOpenTimerRef.current = null;
  };

  const scheduleReaderSidebarClose = () => {
    cancelReaderSidebarOpen();
    if (sidebarCloseTimerRef.current) {
      window.clearTimeout(sidebarCloseTimerRef.current);
    }
    sidebarCloseTimerRef.current = window.setTimeout(() => {
      setSidebarOpen(false);
      sidebarCloseTimerRef.current = null;
    }, 220);
  };

  const ensureSingleScrollContainer = () => {
    if (layoutRef.current === "pages") {
      return;
    }
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
    if (layoutRef.current === "pages") {
      return;
    }
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

  const getReaderWordRect = (word: ReaderWord) => {
    try {
      const range = word.node.ownerDocument.createRange();
      range.setStart(word.node, word.start);
      range.setEnd(word.node, word.end);
      const rects = range.getClientRects();
      const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        return null;
      }
      const iframeRect = word.iframe.getBoundingClientRect();
      return {
        top: iframeRect.top + rect.top,
        left: iframeRect.left + rect.left,
        width: rect.width,
        height: rect.height
      };
    } catch {
      return null;
    }
  };

  const findNearestWordIndex = (targetRatio = 0.38) => {
    const words = readerWordsRef.current;
    const container = ensureScrollContainer();
    if (!container || words.length === 0) {
      return 0;
    }
    const containerRect = container.getBoundingClientRect();
    const targetTop = containerRect.top + containerRect.height * targetRatio;
    let nearestIndex = activeWordIndexRef.current;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let low = 0;
    let high = words.length - 1;
    while (low <= high) {
      const index = Math.floor((low + high) / 2);
      const rect = getReaderWordRect(words[index]);
      if (!rect) {
        low = index + 1;
        continue;
      }
      const distance = Math.abs(rect.top + rect.height / 2 - targetTop);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
      if (rect.top + rect.height / 2 < targetTop) {
        low = index + 1;
      } else {
        high = index - 1;
      }
    }
    return nearestIndex;
  };

  const buildReadingWordState = (index: number): ReadingWordState | null => {
    const words = readerWordsRef.current;
    const word = words[index];
    if (!word) return null;
    const contextStart = Math.floor(index / 42) * 42;
    return {
      index,
      total: words.length,
      text: word.text,
      punctuation: word.trailing.trim(),
      contextStart,
      context: words.slice(contextStart, contextStart + 42).map((entry, offset) => ({
        text: entry.text,
        trailing: entry.trailing,
        index: contextStart + offset
      }))
    };
  };

  const applyUserReadingAnchor = (
    index: number,
    options?: { commitPaceFrom?: number }
  ) => {
    const words = readerWordsRef.current;
    if (words.length === 0) return;
    if (readerDotOffscreenTimerRef.current) {
      window.clearTimeout(readerDotOffscreenTimerRef.current);
      readerDotOffscreenTimerRef.current = null;
    }
    const clampedIndex = Math.min(words.length - 1, Math.max(0, index));
    readerDotAnchorIndexRef.current = clampedIndex;
    readerDotUserAnchorUntilRef.current = Number.POSITIVE_INFINITY;
    activeWordIndexRef.current = clampedIndex;
    programmaticScrollUntilRef.current = 0;
    smartManualOverrideUntilRef.current = Date.now() + 2200;

    // Only a completed gesture adjusts the pace, and it is measured from where
    // the gesture started rather than from the previous animation frame.
    const paceOrigin = options?.commitPaceFrom;
    if (paceOrigin !== undefined && readingModeRef.current === "smart") {
      const delta = clampedIndex - paceOrigin;
      if (Math.abs(delta) >= 8) {
        const adjustment = Math.min(0.08, Math.max(0.012, Math.abs(delta) / 1400));
        smartPaceBiasRef.current = Math.min(
          1.3,
          Math.max(0.72, smartPaceBiasRef.current + (delta > 0 ? adjustment : -adjustment))
        );
        if (delta < 0 && smartSessionRef.current) {
          smartSessionRef.current.rereads += Math.max(1, Math.round(Math.abs(delta) / 80));
        }
      }
    }

    if (readingModeRef.current !== "standard") {
      setReadingWord(buildReadingWordState(clampedIndex));
    }
    positionReaderDotAtWord(clampedIndex);
  };

  const makeReaderDotInteractive = (element: HTMLElement, container: HTMLElement) => {
    if (!element.querySelector(".reader-dot-sparks")) {
      const sparks = element.ownerDocument.createElement("span");
      sparks.className = "reader-dot-sparks";
      sparks.setAttribute("aria-hidden", "true");
      for (let index = 1; index <= 5; index += 1) {
        const spark = element.ownerDocument.createElement("span");
        spark.className = `reader-dot-spark reader-dot-spark-${index}`;
        sparks.appendChild(spark);
      }
      element.appendChild(sparks);
    }
    if (element.dataset.interactive === "true") return;
    element.dataset.interactive = "true";
    element.tabIndex = 0;
    element.setAttribute("role", "slider");
    element.setAttribute("aria-label", "Dotty reading position");
    element.setAttribute("aria-orientation", "vertical");
    element.setAttribute("aria-valuemin", "1");
    element.title = "Drag Dotty to choose your reading start line";
    element.style.pointerEvents = "auto";

    let dragging = false;
    let pendingClientY = 0;
    let gestureStartIndex = 0;
    const moveToClientY = (clientY: number, commit = false) => {
      const rect = container.getBoundingClientRect();
      const ratio = Math.min(0.98, Math.max(0.02, (clientY - rect.top) / Math.max(1, rect.height)));
      applyUserReadingAnchor(
        findNearestWordIndex(ratio),
        commit ? { commitPaceFrom: gestureStartIndex } : undefined
      );
    };
    element.onpointerdown = (event) => {
      dragging = true;
      gestureStartIndex = readerDotAnchorIndexRef.current ?? activeWordIndexRef.current;
      pendingClientY = event.clientY;
      element.classList.add("reader-dot-dragging");
      element.dataset.dragging = "true";
      element.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    element.onpointermove = (event) => {
      if (!dragging) return;
      pendingClientY = event.clientY;
      if (readerDotDragFrameRef.current) return;
      readerDotDragFrameRef.current = window.requestAnimationFrame(() => {
        readerDotDragFrameRef.current = null;
        moveToClientY(pendingClientY);
      });
    };
    element.onpointerup = (event) => {
      if (!dragging) return;
      dragging = false;
      element.classList.remove("reader-dot-dragging");
      delete element.dataset.dragging;
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      moveToClientY(event.clientY, true);
    };
    element.onpointercancel = () => {
      dragging = false;
      element.classList.remove("reader-dot-dragging");
      delete element.dataset.dragging;
    };
    element.onkeydown = (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 8 : -8;
      const from = readerDotAnchorIndexRef.current ?? activeWordIndexRef.current;
      applyUserReadingAnchor(from + step, { commitPaceFrom: from });
    };
  };

  const positionReaderDotAtWord = (index: number) => {
    if (!readerDotEnabledRef.current) return;
    const word = readerWordsRef.current[index];
    const container = ensureScrollContainer();
    if (!word || !container) return;
    const rect = getReaderWordRect(word);
    if (!rect) return;
    const containerRect = container.getBoundingClientRect();
    const documentTop = rect.top - containerRect.top + container.scrollTop;
    const iframeRect = word.iframe.getBoundingClientRect();
    const body = word.node.ownerDocument.body;
    const computedPadding = Number.parseFloat(
      body ? word.node.ownerDocument.defaultView?.getComputedStyle(body).paddingLeft || "0" : "0"
    );
    const textLeft =
      iframeRect.left + (Number.isFinite(computedPadding) ? computedPadding : 24);
    const left = Math.max(7, textLeft - containerRect.left - 18);
    const dot =
      readerDotElementRef.current && container.contains(readerDotElementRef.current)
        ? readerDotElementRef.current
        : (() => {
            const element = document.createElement("div");
            element.id = "reader-lastline-dot";
            element.className = "reader-dot";
            element.style.position = "absolute";
            element.style.width = "10px";
            element.style.height = "10px";
            element.style.borderRadius = "9999px";
            element.style.pointerEvents = "none";
            element.style.opacity = "0";
            element.style.transition =
              "top 0.32s ease, left 0.32s ease, opacity 0.2s ease, transform 0.16s ease";
            element.style.zIndex = "50";
            container.appendChild(element);
            readerDotElementRef.current = element;
            makeReaderDotInteractive(element, container);
            return element;
          })();
    makeReaderDotInteractive(dot, container);
    dot.style.left = `${left}px`;
    dot.style.top = `${Math.max(6, documentTop + rect.height / 2 - 5)}px`;
    dot.style.opacity = "1";
    dot.setAttribute("aria-valuenow", `${index + 1}`);
    dot.setAttribute("aria-valuemax", `${readerWordsRef.current.length}`);
    readerDotAnchorIndexRef.current = index;
  };

  const monitorUserReaderDotVisibility = (container: HTMLElement) => {
    if (
      readingModeRef.current !== "standard" ||
      Date.now() >= readerDotUserAnchorUntilRef.current
    ) {
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      return false;
    }
    const dot = readerDotElementRef.current;
    if (!dot || !container.contains(dot)) {
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      return false;
    }
    if (dot.dataset.dragging === "true") {
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      return true;
    }
    const dotRect = dot.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const edgeTolerance = 2;
    const isOffscreen =
      dotRect.bottom < containerRect.top - edgeTolerance ||
      dotRect.top > containerRect.bottom + edgeTolerance;
    if (!isOffscreen) {
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      return true;
    }

    if (!readerDotOffscreenTimerRef.current) {
      readerDotOffscreenTimerRef.current = window.setTimeout(() => {
        readerDotOffscreenTimerRef.current = null;
        if (
          readingModeRef.current !== "standard" ||
          !readerDotEnabledRef.current ||
          Date.now() >= readerDotUserAnchorUntilRef.current
        ) {
          return;
        }
        const currentDot = readerDotElementRef.current;
        const currentContainer = scrollContainerRef.current;
        if (!currentDot || !currentContainer || !currentContainer.contains(currentDot)) {
          return;
        }
        const currentDotRect = currentDot.getBoundingClientRect();
        const currentContainerRect = currentContainer.getBoundingClientRect();
        const stillOffscreen =
          currentDotRect.bottom < currentContainerRect.top - edgeTolerance ||
          currentDotRect.top > currentContainerRect.bottom + edgeTolerance;
        if (!stillOffscreen) {
          return;
        }

        readerDotUserAnchorUntilRef.current = 0;
        readerDotAnchorIndexRef.current = null;
        const location = renditionRef.current?.location;
        const cfi = location?.end?.cfi ?? location?.start?.cfi;
        if (!cfi) {
          return;
        }
        updateLastReadMarker(cfi);
        const resetDot = readerDotElementRef.current;
        if (!resetDot) {
          return;
        }
        resetDot.classList.remove("reader-dot-reacquired");
        void resetDot.offsetWidth;
        resetDot.classList.add("reader-dot-reacquired");
        resetDot.title = "Dotty is following the last visible line";
        const onResetAnimationEnd = (event: AnimationEvent) => {
          if (event.target !== resetDot || event.animationName !== "readerDotReacquire") {
            return;
          }
          resetDot.classList.remove("reader-dot-reacquired");
          resetDot.removeEventListener("animationend", onResetAnimationEnd);
        };
        resetDot.addEventListener("animationend", onResetAnimationEnd);
      }, 5000);
    }
    return true;
  };

  const scrollWordIntoReadingBand = (index: number) => {
    if (
      readingModeRef.current === "smart" &&
      (Date.now() < smartManualOverrideUntilRef.current ||
        (smartAheadTargetIndexRef.current !== null &&
          index < smartAheadTargetIndexRef.current - 6))
    ) {
      return;
    }
    const word = readerWordsRef.current[index];
    const container = ensureScrollContainer();
    if (!word || !container) return;
    const rect = getReaderWordRect(word);
    if (!rect) return;
    const containerRect = container.getBoundingClientRect();
    const relativeTop = rect.top - containerRect.top;
    const lowerBand = container.clientHeight * (readingModeRef.current === "speed" ? 0.7 : 0.64);
    if (relativeTop > lowerBand) {
      programmaticScrollUntilRef.current = Date.now() + 850;
      container.scrollTo({
        top: Math.max(0, container.scrollTop + relativeTop - container.clientHeight * 0.38),
        behavior: "smooth"
      });
    }
  };

  const prepareReaderWords = (startAtViewport = false) => {
    const rendition = renditionRef.current;
    const previousWordCount = readerWordsRef.current.length;
    const previousAnchor = readerDotAnchorIndexRef.current;
    const preserveUserAnchor =
      Date.now() < readerDotUserAnchorUntilRef.current &&
      previousAnchor !== null &&
      previousWordCount > 0;
    const previousDocument = readerWordsRef.current[0]?.node.ownerDocument ?? null;
    const words: ReaderWord[] = [];
    // Parallel to `words`: the block element each word sits in.
    const blocks: Array<Element | null> = [];
    const contentsList = rendition?.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document as Document | undefined;
      const iframe =
        (contents?.iframe as HTMLIFrameElement | undefined) ??
        (doc?.defaultView?.frameElement as HTMLIFrameElement | null);
      if (!doc?.body || !iframe) return;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && words.length < 30000) {
        const textNode = node as Text;
        const parent = textNode.parentElement;
        const hidden =
          !parent ||
          Boolean(parent.closest("script, style, noscript, svg, [aria-hidden='true']")) ||
          parent.hidden;
        if (!hidden && textNode.data.trim()) {
          const block = parent.closest(READER_BLOCK_SELECTOR);
          const matches = Array.from(
            textNode.data.matchAll(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu)
          );
          // Text before the first word here (". Then", or a node that is only
          // punctuation) belongs to the previous word when it sits in the same
          // block -- "<em>no</em>. Then" used to lose its sentence end.
          const previous = words[words.length - 1];
          const previousInBlock =
            previous && previous.iframe === iframe && blocks[blocks.length - 1] === block;
          const leadingEnd = matches[0]?.index ?? textNode.data.length;
          if (previousInBlock && leadingEnd > 0) {
            previous.trailing += textNode.data.slice(0, leadingEnd);
            previous.sentenceEnd = SENTENCE_END_PATTERN.test(`${previous.text}${previous.trailing}`);
          }
          matches.forEach((match, matchIndex) => {
            const start = match.index ?? 0;
            const text = match[0];
            const end = start + text.length;
            const nextStart = matches[matchIndex + 1]?.index ?? textNode.data.length;
            const trailing = textNode.data.slice(end, nextStart);
            // A word split across inline nodes ("<span>T</span>he", a styled
            // syllable) is one word, not two flashes.
            const last = words[words.length - 1];
            if (
              matchIndex === 0 &&
              start === 0 &&
              previousInBlock &&
              last &&
              last.trailing === "" &&
              last.end === last.node.data.length &&
              isInlineJoin(last.node, textNode)
            ) {
              last.text += text;
              last.trailing = trailing;
              last.difficulty = estimateWordDifficulty(last.text);
              last.sentenceEnd = SENTENCE_END_PATTERN.test(`${last.text}${trailing}`);
              return;
            }
            words.push({
              text,
              trailing,
              node: textNode,
              start,
              end,
              difficulty: estimateWordDifficulty(text),
              rsvpPauseMultiplier: 1,
              sentenceEnd: SENTENCE_END_PATTERN.test(`${text}${trailing}`),
              paragraphEnd: false,
              iframe
            });
            blocks.push(block);
          });
        }
        node = walker.nextNode();
      }
    });
    // A paragraph ends where the next word is in another block. Checking the
    // text node's siblings instead paused for a paragraph after every <em>.
    words.forEach((word, index) => {
      word.paragraphEnd = Boolean(blocks[index]) && blocks[index + 1] !== blocks[index];
    });
    const localFrequency = new Map<string, number>();
    words.forEach((word) => {
      const normalized = word.text.toLocaleLowerCase();
      localFrequency.set(normalized, (localFrequency.get(normalized) ?? 0) + 1);
    });
    words.forEach((word) => {
      word.rsvpPauseMultiplier = estimateRsvpPauseMultiplier(
        word.text,
        localFrequency.get(word.text.toLocaleLowerCase()) ?? 1
      );
    });
    readingPaceScaleRef.current = {
      speed: getPaceScale(words, "speed"),
      smart: getPaceScale(words, "smart")
    };
    readerWordsRef.current = words;
    manualReadingRef.current = null;
    // Re-indexing the same section (font size, re-render) must not move an
    // RSVP or Smart Read position; only a new section starts over.
    const keepReadingPosition =
      readingModeRef.current !== "standard" &&
      previousWordCount > 0 &&
      words.length > 0 &&
      previousDocument === words[0].node.ownerDocument;
    const nextIndex = keepReadingPosition
      ? Math.round(
          (activeWordIndexRef.current / Math.max(1, previousWordCount - 1)) *
            Math.max(0, words.length - 1)
        )
      : preserveUserAnchor
      ? Math.round((previousAnchor / Math.max(1, previousWordCount - 1)) * Math.max(0, words.length - 1))
      : startAtViewport && words.length > 0
        ? findNearestWordIndex()
        : Math.min(activeWordIndexRef.current, Math.max(0, words.length - 1));
    activeWordIndexRef.current = Math.min(Math.max(0, nextIndex), Math.max(0, words.length - 1));
    readerDotAnchorIndexRef.current = activeWordIndexRef.current;
    if (readingModeRef.current !== "standard" && words.length > 0) {
      setReadingWord(buildReadingWordState(activeWordIndexRef.current));
    } else if (readerDotEnabledRef.current && words.length > 0) {
      window.requestAnimationFrame(() => positionReaderDotAtWord(activeWordIndexRef.current));
    }
  };

  const scheduleReaderWordIndex = (startAtViewport = false, delay = 180) => {
    if (wordIndexTimerRef.current) {
      window.clearTimeout(wordIndexTimerRef.current);
    }
    wordIndexTimerRef.current = window.setTimeout(() => {
      wordIndexTimerRef.current = null;
      try {
        prepareReaderWords(startAtViewport);
      } catch {
        readerWordsRef.current = [];
      }
    }, delay);
  };

  // A gap longer than this between scroll observations means the reader was
  // left open, not that the page took that long to read.
  const MAX_OBSERVED_READING_GAP_MS = 4 * 60 * 1000;

  const saveObservedReading = (fromIndex: number, toIndex: number, elapsedMs: number, rereads = 0) => {
    const words = readerWordsRef.current;
    const count = Math.abs(toIndex - fromIndex);
    if (count < 18 || elapsedMs < 5000 || words.length === 0) return;
    if (elapsedMs > MAX_OBSERVED_READING_GAP_MS) return;
    const start = Math.min(fromIndex, toIndex);
    const end = Math.min(words.length, Math.max(fromIndex, toIndex));
    const sampleWords = words.slice(start, end);
    const difficulty =
      sampleWords.reduce((sum, word) => sum + word.difficulty, 0) / Math.max(1, sampleWords.length);
    const next = recordSmartReadSample(smartProfileRef.current, {
      words: count,
      elapsedMs,
      genres: book.genres,
      timeBand: getReadingTimeBand(),
      difficulty,
      rereads
    });
    smartProfileRef.current = next;
    saveSmartReadProfile(accountEmail, next);
  };

  const cancelSmartAheadTracking = () => {
    if (smartAheadTimerRef.current) {
      window.clearTimeout(smartAheadTimerRef.current);
      smartAheadTimerRef.current = null;
    }
    smartAheadTargetIndexRef.current = null;
    smartManualOverrideUntilRef.current = Date.now() + 650;
  };

  const scheduleSmartAheadBoost = (viewportIndex: number) => {
    smartAheadTargetIndexRef.current = Math.max(
      smartAheadTargetIndexRef.current ?? viewportIndex,
      viewportIndex
    );
    smartManualOverrideUntilRef.current = Number.POSITIVE_INFINITY;
    if (smartAheadTimerRef.current) {
      return;
    }
    smartAheadTimerRef.current = window.setTimeout(() => {
      smartAheadTimerRef.current = null;
      if (readingModeRef.current !== "smart") {
        smartAheadTargetIndexRef.current = null;
        return;
      }
      const currentViewportIndex = findNearestWordIndex();
      const currentDotIndex = activeWordIndexRef.current;
      const lead = currentViewportIndex - currentDotIndex;
      if (lead < 12) {
        cancelSmartAheadTracking();
        return;
      }
      smartAheadTargetIndexRef.current = currentViewportIndex;
      const words = readerWordsRef.current;
      const calibration = smartCalibrationRef.current;
      const difficulty = words[currentDotIndex]?.difficulty ?? 1;
      const baseWpm = getAdaptiveWpm(
        smartProfileRef.current,
        book.genres,
        getReadingTimeBand(),
        difficulty,
        calibration
      );
      const catchUpWpm = Math.min(
        calibration.maxWpm,
        Math.max(baseWpm * 1.3, baseWpm + Math.min(150, lead * 0.85))
      );
      smartPaceBiasRef.current = Math.max(
        1,
        Math.min(2.2, catchUpWpm / Math.max(1, baseWpm))
      );
      setAdaptiveWpm(Math.round(catchUpWpm));
    }, 2200);
  };

  const observeManualReadingPosition = () => {
    if (Date.now() < programmaticScrollUntilRef.current || readerWordsRef.current.length === 0) {
      return;
    }
    const now = Date.now();
    const index = findNearestWordIndex();
    const previous = manualReadingRef.current;
    if (previous && now - previous.at >= 4500) {
      if (index >= previous.index) {
        saveObservedReading(previous.index, index, now - previous.at);
      } else {
        const session = smartSessionRef.current;
        if (session) {
          session.rereads += Math.max(1, Math.round((previous.index - index) / 80));
          activeWordIndexRef.current = index;
        }
      }
    }
    if (readingModeRef.current === "smart") {
      const lead = index - activeWordIndexRef.current;
      if (lead >= 12) {
        scheduleSmartAheadBoost(index);
      } else if (
        smartAheadTargetIndexRef.current !== null &&
        lead <= 6
      ) {
        cancelSmartAheadTracking();
      } else if (lead <= -12) {
        cancelSmartAheadTracking();
        smartPaceBiasRef.current = Math.max(0.72, smartPaceBiasRef.current * 0.9);
      }
    } else if (readingModeRef.current === "speed") {
      activeWordIndexRef.current = index;
      setReadingWord(buildReadingWordState(index));
    }
    manualReadingRef.current = { index, at: now };
  };

  const updateLastReadMarker = (cfi: string) => {
    if (!readerDotEnabledRef.current) {
      return;
    }
    if (Date.now() < readerDotUserAnchorUntilRef.current) {
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
        const trackLeft = clamp(textLeft - 18, 6, Math.max(6, containerWidth - 10));
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
                el.style.transition =
                  "top 0.4s ease, left 0.4s ease, opacity 0.3s ease, transform 0.16s ease";
                el.style.zIndex = "50";
                el.style.transform = "translateX(0)";
                container.appendChild(el);
                readerDotElementRef.current = el;
                makeReaderDotInteractive(el, container);
                return el;
              })();
        makeReaderDotInteractive(dot, container);

        if (dot.dataset.fixedLeft !== `${target.left}`) {
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
      if (readerDotRetryTimerRef.current) {
        window.clearTimeout(readerDotRetryTimerRef.current);
      }
      readerDotRetryTimerRef.current = window.setTimeout(() => {
        readerDotRetryTimerRef.current = null;
        updateLastReadMarker(cfi);
      }, 260);
    }
  };

  const removeLastReadMarker = () => {
    if (readerDotTimerRef.current) {
      window.clearTimeout(readerDotTimerRef.current);
    }
    if (readerDotRetryTimerRef.current) {
      window.clearTimeout(readerDotRetryTimerRef.current);
      readerDotRetryTimerRef.current = null;
    }
    if (readerDotOffscreenTimerRef.current) {
      window.clearTimeout(readerDotOffscreenTimerRef.current);
      readerDotOffscreenTimerRef.current = null;
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
    if (existing) {
      existing.remove();
    }
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
    // The dot's horizontal position is owned by positionReaderDotAtWord /
    // updateLastReadMarker; resetting it here made it snap on every scroll tick.
    return container;
  };

  const scheduleReaderDotUpdate = () => {
    if (!readerDotEnabledRef.current || readingModeRef.current !== "standard") {
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
    if (layoutRef.current === "pages" || scrollAdvanceLockRef.current || Date.now() < navigatingUntilRef.current) {
      return;
    }
    scrollAdvanceLockRef.current = true;
    if (scrollAdvanceTimerRef.current) {
      window.clearTimeout(scrollAdvanceTimerRef.current);
    }
    scrollAdvanceTimerRef.current = window.setTimeout(() => {
      scrollAdvanceLockRef.current = false;
    }, 900);
    // A beat at the top of a new chapter, so auto-scroll never carries its
    // heading off the screen before it has been seen.
    autoScrollYieldUntilRef.current = Date.now() + 1500;
    goNextSection();
  };

  const persistReaderState = (override?: Partial<{
    cfi: string;
    cfiProgress: number;
    chapterPositions: Record<string, string>;
  }>) => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          fontSize: fontSizeRef.current,
          sidebarOpen: sidebarRef.current,
          displayMode: displayModeRef.current,
          autoScrollSpeed: autoScrollSpeedRef.current,
          speedReadWpm: speedReadWpmRef.current,
          readerDotEnabled: readerDotEnabledRef.current,
          cfi: override?.cfi ?? lastCfiRef.current ?? undefined,
          cfiProgress: override?.cfiProgress ?? lastCfiProgressRef.current ?? undefined,
          chapterPositions: override?.chapterPositions ?? chapterPositionsRef.current
        })
      );
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
    void annotations
      .addBookmark(cfi, label || null)
      .then(() => showFocusToast("Bookmarked."))
      .catch(() => showFocusToast("Couldn't save the bookmark."));
  };

  // ---- highlights and notes --------------------------------------------------

  /** Highlights in reading order, for the notes panel and the export. */
  /** Turns a page (layout "pages"). Through a ref, for the key handler bound once. */
  const turnPage = (direction: 1 | -1) => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    lastHandsOnAtRef.current = Date.now();
    void (direction > 0 ? rendition.next() : rendition.prev());
  };
  const turnPageRef = useRef(turnPage);
  turnPageRef.current = turnPage;

  const orderedHighlights = useMemo(() => {
    const cfi = new EpubCFI();
    return [...highlights].sort((a, b) => {
      try {
        return cfi.compare(a.cfi, b.cfi);
      } catch {
        return a.createdAt.localeCompare(b.createdAt);
      }
    });
  }, [highlights]);

  /**
   * Highlights drawn over the page by epub.js, which keeps them across the
   * sections it renders. Keyed by id and colour, so a recoloured one is
   * redrawn; cleared when the book is reloaded.
   */
  const appliedHighlightsRef = useRef(new Map<string, string>());
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition?.annotations || loading) {
      return;
    }
    const applied = appliedHighlightsRef.current;
    const wanted = new Map(highlights.map((item) => [`${item.id}|${item.color ?? "yellow"}`, item]));
    applied.forEach((cfi, key) => {
      if (!wanted.has(key)) {
        try {
          rendition.annotations.remove(cfi, "highlight");
        } catch {
          // Already gone with its section.
        }
        applied.delete(key);
      }
    });
    wanted.forEach((item, key) => {
      if (applied.has(key)) {
        return;
      }
      const colour = HIGHLIGHT_COLORS[item.color ?? "yellow"] ?? HIGHLIGHT_COLORS.yellow;
      try {
        rendition.annotations.highlight(
          item.cfi,
          { id: item.id },
          () => {
            setNotesFocus(item.id);
            setBookmarkPanelOpen(true);
          },
          "leaflet-highlight",
          { fill: colour.fill, "fill-opacity": "0.32" }
        );
        applied.set(key, item.cfi);
      } catch {
        // A place from another edition of the book: skipped, still listed.
      }
    });
  }, [highlights, loading]);

  const clearSelection = () => {
    (renditionRef.current?.getContents?.() ?? []).forEach((contents: any) => {
      contents?.window?.getSelection?.()?.removeAllRanges?.();
    });
    setSelection(null);
  };

  const selectionChapter = () => {
    const href = renditionRef.current?.location?.start?.href;
    return (href ? tocLabelByHref[href] : null) ?? chapterLabel ?? null;
  };

  const highlightSelection = (color: string, withNote = false) => {
    if (!selection) {
      return;
    }
    const picked = selection;
    clearSelection();
    void annotations
      .addHighlight(picked.cfi, picked.text, selectionChapter(), color)
      .then((saved) => {
        if (withNote) {
          setNotesFocus(saved.id);
          setBookmarkPanelOpen(true);
        }
      })
      .catch(() => showFocusToast("Couldn't save the highlight."));
  };

  const copySelection = () => {
    if (selection) {
      void navigator.clipboard.writeText(selection.text).then(
        () => showFocusToast("Copied."),
        () => showFocusToast("Couldn't copy.")
      );
    }
    clearSelection();
  };

  selectionRef.current = selection;
  clearSelectionRef.current = clearSelection;

  const exportHighlights = () => {
    void navigator.clipboard.writeText(highlightsMarkdown(book.title, book.author, orderedHighlights)).then(
      () => showFocusToast("Highlights copied as Markdown."),
      () => showFocusToast("Couldn't copy.")
    );
  };

  // ---- search ------------------------------------------------------------------

  /** The chapter a section falls under: the last contents entry at or before it. */
  const chapterOfSection = (section: number) => {
    let label: string | null = null;
    let best = -1;
    for (const item of toc) {
      const index = spineIndexByHrefRef.current[item.href.split("#")[0]];
      if (typeof index === "number" && index <= section && index >= best) {
        best = index;
        label = item.label;
      }
    }
    return label;
  };

  const searchMarkRef = useRef<{ cfi: string; timer: number } | null>(null);
  /** Jumps to a search result and marks the words there for a few seconds. */
  const openSearchHit = (hit: SearchHit) => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    releaseUserReadingAnchor();
    markNavigating();
    void rendition.display(hit.cfi).then(() => {
      const previous = searchMarkRef.current;
      if (previous) {
        window.clearTimeout(previous.timer);
        try {
          rendition.annotations.remove(previous.cfi, "highlight");
        } catch {
          // Gone with its section.
        }
      }
      try {
        rendition.annotations.highlight(hit.cfi, {}, undefined, "leaflet-search-hit", { fill: "#f5b800", "fill-opacity": "0.55" });
      } catch {
        return;
      }
      const timer = window.setTimeout(() => {
        try {
          rendition.annotations.remove(hit.cfi, "highlight");
        } catch {
          // Gone with its section.
        }
        searchMarkRef.current = null;
      }, 4000);
      searchMarkRef.current = { cfi: hit.cfi, timer };
    });
  };

  // Drops a user-placed Dotty pin so automatic tracking resumes.
  const releaseUserReadingAnchor = () => {
    readerDotUserAnchorUntilRef.current = 0;
    readerDotAnchorIndexRef.current = null;
    if (readerDotOffscreenTimerRef.current) {
      window.clearTimeout(readerDotOffscreenTimerRef.current);
      readerDotOffscreenTimerRef.current = null;
    }
  };

  const openBookmark = (cfi: string) => {
    if (!renditionRef.current) {
      return;
    }
    setBookmarkPanelOpen(false);
    // Jumping elsewhere invalidates a pinned Dotty. Without this the pin
    // survives and prepareReaderWords rescales it proportionally into the new
    // section, dropping Dotty at an unrelated line. displayChapter already does
    // this; the bookmark path did not.
    releaseUserReadingAnchor();
    markNavigating();
    void renditionRef.current.display(cfi);
  };

  const displayChapter = (href: string, options?: { useSaved?: boolean }) => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    const useSaved = options?.useSaved ?? true;
    releaseUserReadingAnchor();
    const saved = chapterPositionsRef.current[href];
    const target = useSaved && saved ? saved : href;
    progressArmedRef.current = true;
    // An entry with an anchor ("ch34.xhtml#c4") is opened as its file, then
    // scrolled to below: handed the anchor form, epub.js's scrolling mode
    // showed a neighbouring section instead.
    const fileTarget = !useSaved && target.includes("#") ? target.slice(0, target.indexOf("#")) : target;
    markNavigating();
    void rendition
      .display(fileTarget)
      .then(() => {
        if (useSaved) {
          return;
        }
        const container = ensureScrollContainer();
        if (!container) {
          return;
        }
        const hashAt = target.indexOf("#");
        if (hashAt < 0) {
          // A chapter entry: its top.
          container.scrollTop = 0;
          return;
        }
        // An entry into the middle of a file (several chapters per file).
        // epub.js loads the file but, in scrolling mode, stays at its top, so
        // scroll to the anchor ourselves, just below the floating toolbar.
        const id = decodeURIComponent(target.slice(hashAt + 1));
        const toAnchor = () => {
          for (const frame of Array.from(container.querySelectorAll("iframe"))) {
            const anchor = frame.contentDocument?.getElementById(id);
            if (anchor) {
              const top =
                anchor.getBoundingClientRect().top + frame.getBoundingClientRect().top - container.getBoundingClientRect().top;
              container.scrollTop = Math.max(0, container.scrollTop + top - PAGE_TOP_PAD);
              return;
            }
          }
        };
        // epub.js settles the new section at its top a moment after display
        // resolves, so the jump is made again once that has happened.
        toAnchor();
        requestAnimationFrame(toAnchor);
        window.setTimeout(toAnchor, 250);
      })
      .catch(() => undefined);
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
    // Closing the book (or opening another) mid-load must stop this one:
    // otherwise it kept parsing a whole book nobody was looking at.
    let cancelled = false;

    if (!localPath) {
      setLoadError("Missing book file.");
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const ext = getBookExtension(localPath);
        if (ext && !isReadableExtension(ext)) {
          setLoadError(`This reader supports ${formatSummary()} files.`);
          setLoading(false);
          return;
        }
        let buffer: ArrayBuffer;
        if (isTauri()) {
          // Raw bytes straight from the backend: no base64 round trip, which
          // used to cost four to five times the book's size in memory.
          buffer = await bookService.readBookBytes(book.id);
          if (cancelled) {
            return;
          }
        } else {
          const source = localPath;
          const response = await fetch(source);
          if (!response.ok) {
            throw new Error("fetch failed");
          }
          buffer = await response.arrayBuffer();
        }
        if (cancelled) {
          return;
        }

        if (bookRef.current) {
          bookRef.current.destroy();
          bookRef.current = null;
        }

        let epub: ReturnType<typeof ePub>;
        try {
          epub = ePub(buffer);
        } catch {
          setLoadError(
            ext && ext !== "epub"
              ? `Leaflet converted this ${ext.toUpperCase()} file but could not read the result. Re-import the book and try again.`
              : "This file is not a readable EPUB. It may be damaged."
          );
          setLoading(false);
          return;
        }
        bookRef.current = epub;

        if (!viewerRef.current) {
          throw new Error("Reader container not ready.");
        }

        const rendition = epub.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%"
        });
        renditionRef.current = rendition;
        // Development only: lets a console (or a test driving the reader) see epub.js's state.
        if (import.meta.env.DEV) {
          (window as unknown as { __leafletRendition?: unknown }).__leafletRendition = rendition;
        }
        appliedHighlightsRef.current.clear();
        setSelection(null);

        rendition.hooks?.content?.register((contents: any) => {
          const doc = contents?.document;
          if (!doc) {
            return;
          }
          const pad = 24;
          doc.documentElement.style.setProperty("--reader-content-pad", `${pad}px`);
          doc.documentElement.setAttribute("data-leaflet-layout", layoutRef.current);
          if (!doc.getElementById("reader-font-scale")) {
            const style = doc.createElement("style");
            style.id = "reader-font-scale";
            style.textContent = `
              @font-face { font-family: "ZT Nature"; src: url("${ztNatureBoldWoff2}") format("woff2"); font-display: swap; font-weight: 700; }
              :root { --reader-font-size: ${fontSizeRef.current}px; }
              html { font-size: var(--reader-font-size) !important; transition: padding 0.25s ease; }
              /* Scrolling: the text fills the width. Pages: epub.js sets the
                 body's width for its columns, which this must not override. */
              html:not([data-leaflet-layout="pages"]), html:not([data-leaflet-layout="pages"]) body { width: 100% !important; max-width: 100% !important; }
              body { font-size: 1em !important; margin: 0 !important; padding-top: ${PAGE_TOP_PAD}px !important; padding-left: var(--reader-content-pad, 24px) !important; padding-right: var(--reader-content-pad, 24px) !important; text-align: justify !important; text-justify: inter-word !important; hyphens: auto; box-sizing: border-box; transition: padding 0.25s ease; }
              body > *:first-child { margin-top: 0 !important; padding-top: 0 !important; }
              /* One reading size for running text, whatever the publisher
                 set; headings, footnote markers and small print keep their
                 proportions (a blanket rule made headings body-sized and
                 footnote numbers full-sized). */
              body :where(p, div, span, li, blockquote, td, th, dd, dt, a, em, i, b, strong, cite, section, article, font) { font-size: inherit !important; }
              body * { line-height: inherit; box-sizing: border-box; max-width: 100% !important; }
              h1 { font-size: 1.6em !important; }
              h2 { font-size: 1.4em !important; }
              h3 { font-size: 1.22em !important; }
              h4, h5, h6 { font-size: 1.08em !important; }
              sup, sub { font-size: 0.72em !important; line-height: 0 !important; }
              small { font-size: 0.86em !important; }
              body > * { max-width: 100% !important; }
              p { text-align: justify !important; text-justify: inter-word !important; hyphens: auto; text-indent: 0 !important; margin-left: 0 !important; margin-bottom: 1.6em !important; }
              /* Scene breaks, epigraphs and title lines the book centres stay centred. */
              p[align="center"], p.center, p.centered, p[style*="text-align: center"], p[style*="text-align:center"],
              div[align="center"] p, .center p, .centered p { text-align: center !important; }
              /* On a dark page, text the publisher coloured dark (common in
                 InDesign exports) takes the page's ink, links the accent,
                 and boxes lose light backgrounds that would glare. */
              html[data-reader-dark="1"] body :where(div, span, em, i, b, strong, small, cite, section, article, figcaption, sup, sub, font, dfn, abbr) { color: inherit !important; }
              html[data-reader-dark="1"] body a { color: #8cc95a !important; }
              html[data-reader-dark="1"] body :where(div, section, article, aside, p, blockquote, table, tr, td, th) { background-color: transparent !important; }
              p, div, section, article, blockquote, li { text-indent: 0 !important; margin-left: 0 !important; }
              h1, h2, h3, h4, h5, h6 { font-family: "ZT Nature", "Segoe UI", sans-serif !important; font-weight: 700 !important; letter-spacing: -0.01em; }
              html[data-reader-finish="paper"] body { color: #30291f !important; }
              html[data-reader-finish="paper"] p,
              html[data-reader-finish="paper"] li,
              html[data-reader-finish="paper"] blockquote,
              html[data-reader-finish="paper"] td,
              html[data-reader-finish="paper"] dd {
                color: rgba(43, 36, 27, 0.96) !important;
                text-shadow:
                  0.18px 0 rgba(32, 25, 18, 0.42),
                  -0.12px 0.16px rgba(82, 65, 43, 0.2);
                filter: contrast(1.035);
              }
              html[data-reader-finish="paper"] h1,
              html[data-reader-finish="paper"] h2,
              html[data-reader-finish="paper"] h3,
              html[data-reader-finish="paper"] h4,
              html[data-reader-finish="paper"] h5,
              html[data-reader-finish="paper"] h6 {
                color: #2b3a2c !important;
                text-shadow: 0.22px 0.18px rgba(45, 35, 24, 0.28);
              }
              html[data-reader-finish="paper"] ::selection { background: rgba(30, 111, 66, 0.25); }
              html[data-reader-finish="dark-paper"] body { color: #eeeae0 !important; }
              html[data-reader-finish="dark-paper"] p,
              html[data-reader-finish="dark-paper"] li,
              html[data-reader-finish="dark-paper"] blockquote,
              html[data-reader-finish="dark-paper"] td,
              html[data-reader-finish="dark-paper"] dd {
                color: rgba(238, 234, 224, 0.96) !important;
                text-shadow:
                  0.16px 0 rgba(255, 255, 255, 0.12),
                  -0.12px 0.16px rgba(0, 0, 0, 0.46);
                filter: contrast(1.04);
              }
              html[data-reader-finish="dark-paper"] h1,
              html[data-reader-finish="dark-paper"] h2,
              html[data-reader-finish="dark-paper"] h3,
              html[data-reader-finish="dark-paper"] h4,
              html[data-reader-finish="dark-paper"] h5,
              html[data-reader-finish="dark-paper"] h6 {
                color: #d9f4e2 !important;
                text-shadow: 0.2px 0.18px rgba(0, 0, 0, 0.55);
              }
              html[data-reader-finish="dark-paper"] ::selection { background: rgba(114, 171, 68, 0.34); }
              html[data-reader-finish="true-white"] body,
              html[data-reader-finish="true-white"] p,
              html[data-reader-finish="true-white"] li,
              html[data-reader-finish="true-white"] blockquote,
              html[data-reader-finish="true-white"] td,
              html[data-reader-finish="true-white"] dd {
                color: #090a09 !important;
                text-shadow: none !important;
                filter: none !important;
              }
              html[data-reader-finish="true-white"] h1,
              html[data-reader-finish="true-white"] h2,
              html[data-reader-finish="true-white"] h3,
              html[data-reader-finish="true-white"] h4,
              html[data-reader-finish="true-white"] h5,
              html[data-reader-finish="true-white"] h6 {
                color: #090a09 !important;
                text-shadow: none !important;
              }
              html[data-reader-finish="true-white"] ::selection { background: rgba(79, 123, 55, 0.24); }
              html[data-reader-finish="true-black"] body,
              html[data-reader-finish="true-black"] p,
              html[data-reader-finish="true-black"] li,
              html[data-reader-finish="true-black"] blockquote,
              html[data-reader-finish="true-black"] td,
              html[data-reader-finish="true-black"] dd {
                color: #f2f1eb !important;
                text-shadow: none !important;
                filter: none !important;
              }
              html[data-reader-finish="true-black"] h1,
              html[data-reader-finish="true-black"] h2,
              html[data-reader-finish="true-black"] h3,
              html[data-reader-finish="true-black"] h4,
              html[data-reader-finish="true-black"] h5,
              html[data-reader-finish="true-black"] h6 {
                color: #f2f1eb !important;
                text-shadow: none !important;
              }
              html[data-reader-finish="true-black"] ::selection { background: rgba(114, 171, 68, 0.42); }
              /* Ink-on-white pictures (see markInkImages) take the page's
                 colour: on a light page the white multiplies into the paper;
                 on a dark page only headings and ornaments are inverted to
                 white ink and screened onto the page. Maps and drawings stay
                 as drawn. A click toggles the original. */
              html[data-reader-dark="0"] [data-leaflet-ink]:not([data-leaflet-ink-off="1"]) { mix-blend-mode: multiply; }
              html[data-reader-dark="1"] [data-leaflet-ink="title"]:not([data-leaflet-ink-off="1"]) {
                filter: invert(1) hue-rotate(180deg) brightness(0.92);
                mix-blend-mode: screen;
              }
              [data-leaflet-ink] { cursor: pointer; }
            `;
            doc.head.appendChild(style);
          } else {
            doc.documentElement.style.setProperty("--reader-font-size", `${fontSizeRef.current}px`);
            doc.documentElement.style.setProperty("--reader-content-pad", `${pad}px`);
          }
          // Scrolling only: clipping the width would hide a paginated
          // chapter's columns from epub.js, which would then see one page.
          if (layoutRef.current !== "pages") {
            doc.documentElement.style.overflow = "visible";
            doc.body.style.overflow = "visible";
            doc.documentElement.style.overflowX = "hidden";
            doc.body.style.overflowX = "hidden";
          }
          const currentDisplayMode = displayModeRef.current;
          const currentReaderTheme = readerThemeRef.current;
          const finish = getReaderFinish(currentDisplayMode, currentReaderTheme);
          const finishBackground = getReaderFinishBackground(finish);
          doc.documentElement.dataset.readerFinish = currentDisplayMode;
          doc.documentElement.dataset.readerDark = finish.themeName === "leaflet-dark" ? "1" : "0";
          markInkImages(doc);
          doc.documentElement.style.backgroundColor = finish.background;
          doc.body.style.backgroundColor = finish.background;
          doc.documentElement.style.backgroundImage = finishBackground;
          doc.body.style.backgroundImage = finishBackground;
          doc.documentElement.style.backgroundSize = "auto";
          doc.body.style.backgroundSize = "auto";
        });

        rendition.themes.register("leaflet-dark", {
          html: {
            background: "#202227",
            color: "#f7f9fc",
            overflowX: "hidden"
          },
          body: {
            background: "#202227",
            color: "#f7f9fc",
            lineHeight: "1.8",
            fontFamily: "Georgia, Cambria, 'Times New Roman', serif",
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
            background: "#edeae2",
            color: "#16191e",
            overflowX: "hidden"
          },
          body: {
            background: "#edeae2",
            color: "#16191e",
            lineHeight: "1.8",
            fontFamily: "Georgia, Cambria, 'Times New Roman', serif",
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
        const initialFinish = getReaderFinish(displayModeRef.current, readerThemeRef.current);
        rendition.themes.select(initialFinish.themeName);
        rendition.themes.override("background", initialFinish.background);
        rendition.themes.override("color", initialFinish.text);
        applyReaderTypography();
        applyReaderInsets();
        const initialFlow = layoutRef.current === "pages" ? "paginated" : "scrolled-doc";
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
        if (cancelled) {
          return;
        }
        const spineIndexByHref: Record<string, number> = {};
        const spineItems = epub.spine?.items ?? [];
        spineItems.forEach((item: any, idx: number) => {
          if (item?.href) {
            spineIndexByHref[item.href] = idx;
          }
        });
        // TOC links are written relative to the table of contents file, but
        // sections are named relative to the package file. When the two live
        // in different folders (nav in Text/, chapters beside it), the raw
        // links matched nothing: chapter entries did nothing when clicked,
        // and progress had no chapters to count.
        const packaging = (epub as unknown as { packaging?: { navPath?: string; ncxPath?: string } }).packaging;
        const tocFile = packaging?.navPath || packaging?.ncxPath || "";
        const tocDir = tocFile.includes("/") ? tocFile.slice(0, tocFile.lastIndexOf("/") + 1) : "";
        const resolveTocHref = (href: string) => {
          const hashAt = href.indexOf("#");
          const path = hashAt >= 0 ? href.slice(0, hashAt) : href;
          const fragment = hashAt >= 0 ? href.slice(hashAt) : "";
          if (!path || spineIndexByHref[path] !== undefined || /^[a-z]+:/i.test(path)) {
            return href;
          }
          const parts: string[] = [];
          for (const part of `${tocDir}${path}`.split("/")) {
            if (part === "..") {
              parts.pop();
            } else if (part && part !== ".") {
              parts.push(part);
            }
          }
          const joined = parts.join("/");
          let decoded = joined;
          try {
            decoded = decodeURIComponent(joined);
          } catch {
            // A stray "%" in a file name: the raw form is the only candidate.
          }
          const candidates = [joined, decoded];
          const match = candidates.find((candidate) => spineIndexByHref[candidate] !== undefined);
          return match ? `${match}${fragment}` : href;
        };
        const flatToc = flattenToc(navigation.toc).map((item) => ({ ...item, href: resolveTocHref(item.href) }));
        setToc(flatToc);
        const chapterToc = flatToc.filter((item) => isChapterLike(item.label));
        const indexMap: Record<string, number> = {};
        const labelMap: Record<string, string> = {};
        // Chapters are counted per section file: a location reports its file,
        // never the anchor inside it, so the keys drop the "#...".
        let dedupIndex = 0;
        const seenHrefs = new Set<string>();
        chapterToc.forEach((item) => {
          const file = item.href.split("#")[0];
          if (seenHrefs.has(file)) {
            return;
          }
          seenHrefs.add(file);
          indexMap[file] = dedupIndex;
          labelMap[file] = item.label;
          dedupIndex += 1;
        });
        setTocIndexByHref(indexMap);
        setTocLabelByHref(labelMap);
        spineIndexByHrefRef.current = spineIndexByHref;
        chapterSpineIndicesRef.current = Object.keys(indexMap)
          .map((href) => spineIndexByHref[href])
          .filter((value) => typeof value === "number")
          .sort((a, b) => (a as number) - (b as number)) as number[];

        // Section sizes, for progress by how much has been read. A quick call
        // (the archive's directory only); without it, the older estimates below.
        sectionWeightsRef.current = null;
        try {
          const sections = await bookService.epubSections(book.id);
          if (cancelled) {
            return;
          }
          sectionWeightsRef.current = buildSectionWeights(
            spineItems.map((item: any) => String(item?.href ?? "")),
            sections,
            flatToc,
            (href) => spineIndexByHref[href.split("#")[0]]
          );
        } catch {
          sectionWeightsRef.current = null;
        }

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

            const weights = sectionWeightsRef.current;
            if (weights && typeof spineIndex === "number" && spineIndex < weights.bytes.length) {
              if (spineIndex < weights.lo) {
                return 0;
              }
              // Past the story is back matter: a footnote link into it is not
              // finishing the book, so progress stays where the reading was.
              if (spineIndex > weights.hi) {
                return null;
              }
              const within = sectionProgress();
              if (spineIndex >= weights.last && within >= 0.98) {
                return 1;
              }
              const span = weights.prefix[weights.hi + 1] - weights.prefix[weights.lo];
              const read = weights.prefix[spineIndex] - weights.prefix[weights.lo] + within * weights.bytes[spineIndex];
              return Math.min(1, Math.max(0, read / span));
            }

            if (chapterTotal > 0 && typeof chapterIndex === "number") {
              // Past the last chapter is back matter: endnotes, acknowledgements.
              // A footnote link into it is not finishing the book, so the
              // progress stays where the reading was.
              if (typeof spineIndex === "number" && typeof lastChapterSpine === "number" && spineIndex > lastChapterSpine) {
                return null;
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

            // Unknown (epub.js is still indexing the book): better to save
            // nothing than a 0 that overwrites real progress.
            return null;
          };

          const percentage = resolveProgress();
          if (percentage !== null) {
            lastCfiProgressRef.current = percentage;
          }
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
            persistReaderState({
              cfi: location.start.cfi,
              chapterPositions: chapterPositionsRef.current
            });
          }

          // no auto-advance in scroll mode

          if (!progressArmedRef.current && lastHandsOnAtRef.current > openedAtRef.current) {
            progressArmedRef.current = true;
          }
          const shouldUpdateProgress =
            percentage !== null &&
            progressArmedRef.current &&
            (Math.abs(percentage - lastProgressRef.current) >= 0.005 || now - lastProgressAtRef.current >= 10000);

          if (shouldUpdateProgress && percentage !== null) {
            lastProgressRef.current = percentage;
            lastProgressAtRef.current = now;
            const position = location?.start?.cfi ?? null;
            lastCfiProgressRef.current = percentage;
            void bookService.updateProgress(book.id, percentage, position);
            updateBookProgress(book.id, percentage, position ?? undefined);
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
        // Selected text is offered for highlighting (the selection bar).
        rendition.on("selected", (cfiRange: string, contents: any) => {
          const text = String(contents?.window?.getSelection?.()?.toString?.() ?? "")
            .replace(/\s+/g, " ")
            .trim();
          if (text) {
            setSelection({ cfi: cfiRange, text });
          }
        });
        const bindChromeReveal = () => {
          (rendition.getContents?.() ?? []).forEach((contents: any) => {
            const doc = contents?.document as Document | undefined;
            if (!doc || (doc as any).__leafletChromeBound) {
              return;
            }
            (doc as any).__leafletChromeBound = true;
            const handsOn = () => {
              lastHandsOnAtRef.current = Date.now();
              markReadingActivity();
            };
            doc.addEventListener(
              "pointerdown",
              (event) => {
                handsOn();
                if (event.pointerType === "touch") {
                  revealChromeRef.current();
                }
                holdAutoScrollRef.current(true);
              },
              { passive: true }
            );
            // Web links in a book open in the browser. epub.js marks them
            // target=_blank, which the sandboxed page silently blocks, so
            // they used to do nothing. Links within the book are left to
            // epub.js, which turns them into jumps.
            doc.addEventListener(
              "click",
              (event) => {
                const anchor = (event.target as Element | null)?.closest?.("a[href]");
                const href = anchor?.getAttribute("href") ?? "";
                if (!/^https?:\/\//i.test(href)) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                const secure = href.replace(/^http:\/\//i, "https://");
                accountService.openLink(secure).catch(() => showFocusToastRef.current("Couldn't open that link."));
              },
              true
            );
            // Hold to pause: auto-scroll waits while a finger or button is
            // down on the text (which is also when a passage is being selected).
            const release = () => holdAutoScrollRef.current(false);
            doc.addEventListener("pointerup", release, { passive: true });
            doc.addEventListener("pointercancel", release, { passive: true });
            // Once the text has been clicked the iframe owns focus, and Space,
            // arrows and Escape stopped working in every mode.
            doc.addEventListener("keydown", (event) => {
              handsOn();
              readerKeyHandlerRef.current?.(event);
            });
            // Wheeling over the text scrolls the outer container but the wheel
            // event itself stays in here; without it, manual reading stopped
            // earning time five minutes after the reader opened.
            doc.addEventListener(
              "wheel",
              (event) => {
                handsOn();
                contentWheelHandlerRef.current?.(event.deltaY);
              },
              { passive: true }
            );
            doc.addEventListener("pointermove", () => markReadingActivity(), { passive: true });
          });
        };
        bindChromeReveal();
        rendition.on?.("rendered", () => {
          applyReaderTypography();
          ensureSingleScrollContainer();
          ensureScrollContainer();
          scheduleReaderWordIndex(true);
          bindChromeReveal();
          // Images have their final addresses by now; check any the first
          // pass couldn't read.
          (rendition.getContents?.() ?? []).forEach((contents: any) => {
            if (contents?.document) {
              markInkImages(contents.document);
            }
          });
        });

        applyReaderInsets();
        // The saved place, if it still resolves. A stale or broken position
        // used to reject here and the book never opened again.
        markNavigating(2500);
        const restored = lastCfiRef.current
          ? await rendition.display(lastCfiRef.current).then(
              () => true,
              () => false
            )
          : false;
        if (cancelled) {
          return;
        }
        if (restored) {
          progressArmedRef.current = true;
          // epub.js puts the saved line at the very top, under the toolbar.
          const container = ensureScrollContainer();
          if (container) {
            container.scrollTop = Math.max(0, container.scrollTop - PAGE_TOP_PAD);
          }
        } else {
          // No local position (another device, cleared data): start at the
          // chapter the synced progress points into, rather than page one.
          const progress = typeof book.progress === "number" ? book.progress : 0;
          const chapters = chapterSpineIndicesRef.current;
          const weights = sectionWeightsRef.current;
          const midway = progress > 0.01 && progress < 0.995;
          const spineIndex =
            midway && weights
              ? spineIndexForProgress(weights, progress)
              : midway && chapters.length > 1
                ? chapters[Math.min(chapters.length - 1, Math.floor(progress * chapters.length))]
                : null;
          const href = spineIndex !== null ? epub.spine?.items?.[spineIndex]?.href : null;
          await (href ? rendition.display(href) : rendition.display()).catch(() => rendition.display());
          if (progress <= 0.001) {
            progressArmedRef.current = true;
          }
        }
        if (cancelled) {
          return;
        }
        scheduleReaderWordIndex(true);
        setLoading(false);
        // Indexing the whole book (for progress in books without usable
        // chapters) waits until the first page is up, and runs when idle.
        // With section sizes known, progress needs no index at all; this is
        // for the books where they could not be read.
        const locations = epub.locations;
        if (!sectionWeightsRef.current && locations && typeof locations.generate === "function") {
          const start = () => {
            if (!cancelled) {
              void locations.generate(1600);
            }
          };
          if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(start, { timeout: 4000 });
          } else {
            window.setTimeout(start, 1200);
          }
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setLoadError(friendlyOpenError(error instanceof Error ? error.message : String(error ?? "")));
        setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
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
  }, [book.id, localPath, reloadKey]);

  useEffect(() => {
    if (loading) return;
    const viewer = viewerRef.current;
    const rendition = renditionRef.current;
    if (!viewer || !rendition?.resize) return;

    let frame = 0;
    const syncViewport = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const width = Math.max(1, Math.round(viewer.clientWidth));
        const height = Math.max(1, Math.round(viewer.clientHeight));
        rendition.resize(width, height);
        ensureSingleScrollContainer();
        // Reflow moves the anchored word; the marker has to follow it. RSVP has
        // no Dotty (repositioning here used to recreate it), and an unpinned
        // Dotty in standard mode follows the last visible line, not a word.
        const mode = readingModeRef.current;
        if (readerDotEnabledRef.current && readerWordsRef.current.length > 0 && mode !== "speed") {
          const pinned = Date.now() < readerDotUserAnchorUntilRef.current;
          if (mode === "smart" || pinned) {
            positionReaderDotAtWord(readerDotAnchorIndexRef.current ?? activeWordIndexRef.current);
          } else {
            scheduleReaderDotUpdate();
          }
        }
      });
    };
    const observer = new ResizeObserver(syncViewport);
    observer.observe(viewer);
    syncViewport();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [book.id, loading]);

  // flip mode removed; scroll flow is initialized during load

  useEffect(() => {
    displayModeRef.current = displayMode;
    readerThemeRef.current = readerTheme;
    if (!renditionRef.current?.themes) {
      return;
    }
    const finish = getReaderFinish(displayMode, readerTheme);
    renditionRef.current.themes.select(finish.themeName);
    renditionRef.current.themes.override("background", finish.background);
    renditionRef.current.themes.override("color", finish.text);
    const finishBackground = getReaderFinishBackground(finish);
    const contentsList = renditionRef.current.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document;
      if (!doc) {
        return;
      }
      doc.documentElement.style.backgroundColor = finish.background;
      doc.body.style.backgroundColor = finish.background;
      doc.documentElement.dataset.readerFinish = displayMode;
      doc.documentElement.dataset.readerDark = finish.themeName === "leaflet-dark" ? "1" : "0";
      doc.documentElement.style.backgroundImage = finishBackground;
      doc.body.style.backgroundImage = finishBackground;
      doc.documentElement.style.backgroundSize = "auto";
      doc.body.style.backgroundSize = "auto";
      doc.documentElement.style.color = finish.text;
      doc.body.style.color = finish.text;
    });
    if (readerDotEnabled) {
      ensureScrollContainer();
      scheduleReaderDotUpdate();
    }
    persistReaderState();
  }, [readerTheme, displayMode]);

  useEffect(() => {
    let activeContainer: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const queueManualObservation = (delay = 160) => {
      if (manualScrollTimerRef.current) {
        window.clearTimeout(manualScrollTimerRef.current);
      }
      manualScrollTimerRef.current = window.setTimeout(() => {
        manualScrollTimerRef.current = null;
        observeManualReadingPosition();
      }, delay);
    };

    const onWheel = (event: WheelEvent) => {
      // scroll-only mode
      const target = event.currentTarget as HTMLElement;
      if (!target) {
        return;
      }
      handleWheel(target, event.deltaY);
    };

    const handleWheel = (target: HTMLElement, deltaY: number) => {
      markReadingActivity();
      lastHandsOnAtRef.current = Date.now();
      programmaticScrollUntilRef.current = 0;
      if (autoScrollActiveRef.current) {
        noteAutoScrollCorrectionRef.current(target, deltaY);
      }
      if (readingModeRef.current === "smart") {
        smartManualOverrideUntilRef.current = Date.now() + 2200;
      }
      if (deltaY > 0) {
        lastWheelDownAtRef.current = Date.now();
        if (isAtScrollBottom(target, 2)) {
          triggerScrollAdvance();
        }
      }
      queueManualObservation(120);
      scheduleReaderDotUpdate();
    };

    const onScroll = (event: Event) => {
      // scroll-only mode
      const target = event.currentTarget as HTMLElement;
      if (!target) {
        return;
      }
      const now = Date.now();
      if (now - lastHandsOnAtRef.current < HANDS_FREE_GRACE_MS) {
        markReadingActivity();
      }
      const last = lastScrollTopRef.current ?? target.scrollTop;
      const delta = target.scrollTop - last;
      lastScrollTopRef.current = target.scrollTop;
      if (delta > 0) {
        lastWheelDownAtRef.current = now;
      }
      if (isAtScrollBottom(target, 2) && now - lastWheelDownAtRef.current < 700) {
        triggerScrollAdvance();
      }
      if (now >= programmaticScrollUntilRef.current) {
        if (readingModeRef.current === "smart") {
          smartManualOverrideUntilRef.current = now + 2200;
        }
        queueManualObservation();
      }
      const manualDotActive = monitorUserReaderDotVisibility(target);
      if (!manualDotActive) {
        scheduleReaderDotUpdate();
      }
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
      contentWheelHandlerRef.current = (deltaY) => handleWheel(container, deltaY);
    };

    const detach = () => {
      if (!activeContainer) {
        return;
      }
      activeContainer.removeEventListener("wheel", onWheel);
      activeContainer.removeEventListener("scroll", onScroll);
      contentWheelHandlerRef.current = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      activeContainer = null;
      lastScrollTopRef.current = null;
      if (manualScrollTimerRef.current) {
        window.clearTimeout(manualScrollTimerRef.current);
        manualScrollTimerRef.current = null;
      }
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
      scheduleReaderWordIndex(true);
    };

    // The rendition is created asynchronously by the load effect, so this must wait
    // for `loading` to clear — otherwise no scroll/wheel listener is ever attached.
    const rendition = renditionRef.current;
    if (loading || !rendition) {
      return;
    }

    const initial = ensureScrollContainer();
    if (initial) {
      attach(initial);
    }
    rendition.on?.("rendered", onRendered);

    return () => {
      rendition.off?.("rendered", onRendered);
      detach();
    };
  }, [book.id, loading]);

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
    // Starting (or retuning) is deliberate, so the hands-free window restarts.
    lastHandsOnAtRef.current = Date.now();

    const tick = (time: number) => {
      if (!autoScrollActive) {
        return;
      }
      const now = Date.now();
      // Nobody has touched the page for a while: stop rather than scroll a
      // chapter past an empty chair (and stop crediting minutes for it).
      if (now - lastHandsOnAtRef.current >= HANDS_FREE_GRACE_MS) {
        setAutoScrollActive(false);
        showFocusToastRef.current("Auto-scroll paused. Still reading? Press Space.");
        return;
      }
      if (autoScrollHeldRef.current || now < autoScrollYieldUntilRef.current) {
        autoScrollLastTimeRef.current = time;
        autoScrollCarryRef.current = 0;
        autoScrollRafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (autoScrollLastTimeRef.current === null) {
        autoScrollLastTimeRef.current = time;
      }
      const deltaSeconds = Math.min(0.2, (time - autoScrollLastTimeRef.current) / 1000);
      autoScrollLastTimeRef.current = time;
      const before = container.scrollTop;
      const speedPxPerSecond = autoScrollPixelsPerSecond(autoScrollSpeed, fontSizeRef.current);
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

  const finishSmartSession = () => {
    const session = smartSessionRef.current;
    smartSessionRef.current = null;
    if (!session) return;
    const wordsRead = Math.max(0, session.furthestIndex - session.startIndex);
    const averageDifficulty =
      session.difficultyTotal / Math.max(1, session.difficultySamples);
    const next = recordSmartReadSample(smartProfileRef.current, {
      words: wordsRead,
      elapsedMs: session.activeMs,
      genres: book.genres,
      timeBand: getReadingTimeBand(new Date(session.startedAt)),
      difficulty: averageDifficulty || 1,
      rereads: session.rereads
    });
    smartProfileRef.current = next;
    saveSmartReadProfile(accountEmail, next);
  };

  // The speed a reader settles on becomes the starting speed for other books.
  useEffect(() => {
    try {
      localStorage.setItem(AUTO_SCROLL_DEFAULT_KEY, String(autoScrollSpeed));
    } catch {
      // A preference; losing it only means starting from the default.
    }
  }, [autoScrollSpeed]);

  // A hold that ends outside the book (over the toolbar, off the window) must
  // still let go, or auto-scroll would wait forever.
  useEffect(() => {
    if (!autoScrollHeld) {
      return;
    }
    const release = () => holdAutoScrollRef.current(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("blur", release);
    };
  }, [autoScrollHeld]);

  useEffect(() => {
    if (!autoScrollActive) {
      holdAutoScrollRef.current(false);
    }
  }, [autoScrollActive]);

  // Nothing moves on its own while Leaflet is in the background: coming back
  // to find auto-scroll three pages on, or RSVP a chapter ahead, loses the
  // place. Resuming is left to the reader, who needs a moment to find the line.
  useEffect(
    () =>
      watchForeground((inFront) => {
        if (inFront) {
          return;
        }
        if (autoScrollActiveRef.current) {
          setAutoScrollActive(false);
          showFocusToastRef.current("Auto-scroll paused while you were away. Space to carry on.");
        } else if (readingModeRef.current !== "standard" && !readingPausedRef.current) {
          readingPausedRef.current = true;
          setReadingPaused(true);
          showFocusToastRef.current("Paused while you were away. Space to carry on.");
        }
      }),
    []
  );

  useEffect(() => {
    readingPausedRef.current = readingPaused;
    // Resuming is always deliberate, by key or by the play button, so it
    // restarts the hands-free window; otherwise the idle pause would fire again
    // on the next word.
    if (!readingPaused) {
      lastHandsOnAtRef.current = Date.now();
    }
  }, [readingPaused]);

  useEffect(() => {
    speedReadWpmRef.current = speedReadWpm;
    persistReaderState();
  }, [speedReadWpm]);

  useEffect(() => {
    readingModeRef.current = readingMode;
    if (readingMode !== "smart") {
      if (smartAheadTimerRef.current) {
        window.clearTimeout(smartAheadTimerRef.current);
        smartAheadTimerRef.current = null;
      }
      smartAheadTargetIndexRef.current = null;
      smartManualOverrideUntilRef.current = 0;
    }
    if (readingMode !== "standard" && readerDotOffscreenTimerRef.current) {
      window.clearTimeout(readerDotOffscreenTimerRef.current);
      readerDotOffscreenTimerRef.current = null;
    }
    setAutoScrollActive(false);
    setReadingPaused(false);
    readingPausedRef.current = false;
    if (readingEngineTimerRef.current) {
      window.clearTimeout(readingEngineTimerRef.current);
      readingEngineTimerRef.current = null;
    }
    if (readingMode === "standard") {
      finishSmartSession();
      setReadingWord(null);
      const cfi = renditionRef.current?.location?.end?.cfi ?? renditionRef.current?.location?.start?.cfi;
      if (readerDotEnabled && cfi) updateLastReadMarker(cfi);
      return;
    }

    prepareReaderWords(false);
    const requestedStart = requestedStartIndexRef.current;
    const anchoredStart = readerDotAnchorIndexRef.current;
    const availableWords = readerWordsRef.current.length;
    activeWordIndexRef.current = Math.min(
      Math.max(
        0,
        requestedStart ?? anchoredStart ?? (availableWords > 0 ? findNearestWordIndex() : 0)
      ),
      Math.max(0, availableWords - 1)
    );
    requestedStartIndexRef.current = null;
    readerDotAnchorIndexRef.current = activeWordIndexRef.current;
    setReadingWord(buildReadingWordState(activeWordIndexRef.current));
    if (readingMode === "smart") {
      smartPaceBiasRef.current = 1;
      smartAheadTargetIndexRef.current = null;
      const now = Date.now();
      smartSessionRef.current = {
        startedAt: now,
        activeMs: 0,
        lastTickAt: now,
        startIndex: activeWordIndexRef.current,
        furthestIndex: activeWordIndexRef.current,
        difficultyTotal: 0,
        difficultySamples: 0,
        rereads: 0
      };
    } else {
      finishSmartSession();
      removeLastReadMarker();
    }

    let stopped = false;
    const schedule = (delay: number) => {
      if (stopped) return;
      readingEngineTimerRef.current = window.setTimeout(() => {
        if (stopped || readingModeRef.current === "standard") return;
        if (readingPausedRef.current) {
          if (smartSessionRef.current) {
            smartSessionRef.current.lastTickAt = Date.now();
          }
          schedule(180);
          return;
        }
        const words = readerWordsRef.current;
        if (words.length === 0) {
          prepareReaderWords(true);
          schedule(500);
          return;
        }
        if (activeWordIndexRef.current >= words.length) {
          // The last word has had its full time on screen; move on.
          continueInNextSection();
          return;
        }
        const index = Math.max(0, activeWordIndexRef.current);
        const word = words[index];
        const now = Date.now();
        const mode = readingModeRef.current;
        // Playing hands-free counts as reading for the same grace window as
        // auto-scroll. Past it, pause rather than play on to an empty room:
        // playback and credited time then always agree, and a reader who
        // stepped away comes back to the word they left on.
        if (now - lastHandsOnAtRef.current >= HANDS_FREE_GRACE_MS) {
          readingPausedRef.current = true;
          setReadingPaused(true);
          showFocusToast("Still reading? Press Space to carry on.");
          schedule(180);
          return;
        }
        markReadingActivity();
        let wpm = speedReadWpmRef.current;
        if (mode === "smart") {
          const calibration = smartCalibrationRef.current;
          const baseWpm = getAdaptiveWpm(
            smartProfileRef.current,
            book.genres,
            getReadingTimeBand(),
            word.difficulty,
            calibration
          );
          wpm = Math.min(
            calibration.maxWpm,
            Math.max(calibration.minWpm, baseWpm * smartPaceBiasRef.current)
          );
          const aheadTarget = smartAheadTargetIndexRef.current;
          if (aheadTarget !== null && index >= aheadTarget - 6) {
            cancelSmartAheadTracking();
            smartPaceBiasRef.current = Math.max(1, smartPaceBiasRef.current * 0.82);
          } else if (aheadTarget === null && smartPaceBiasRef.current > 1) {
            smartPaceBiasRef.current =
              1 + (smartPaceBiasRef.current - 1) * 0.985;
          }
          if (index % 8 === 0) setAdaptiveWpm(Math.round(wpm));
          const session = smartSessionRef.current;
          if (session) {
            session.activeMs += Math.min(2500, Math.max(0, now - session.lastTickAt));
            session.lastTickAt = now;
            session.furthestIndex = Math.max(session.furthestIndex, index);
            session.difficultyTotal += word.difficulty;
            session.difficultySamples += 1;
          }
          positionReaderDotAtWord(index);
        } else {
          // Only RSVP renders the word; in Smart Read this re-rendered the
          // whole reader on every word for nothing.
          setReadingWord(buildReadingWordState(index));
        }
        scrollWordIntoReadingBand(index);

        activeWordIndexRef.current = index + 1;
        const paceMode = mode === "speed" ? "speed" : "smart";
        const paceDelay =
          (60000 / Math.max(70, wpm)) *
          getPaceFactor(word, paceMode) *
          readingPaceScaleRef.current[paceMode];
        schedule(Math.round(paceDelay));
      }, delay);
    };

    const startSmartSessionAt = (index: number) => {
      const startedAt = Date.now();
      smartSessionRef.current = {
        startedAt,
        activeMs: 0,
        lastTickAt: startedAt,
        startIndex: index,
        furthestIndex: index,
        difficultyTotal: 0,
        difficultySamples: 0,
        rereads: 0
      };
    };

    // Advances to the next section and resumes at its first word once it has
    // actually rendered. A fixed 1.1s wait used to re-index the old section on a
    // slow render (and skip a chapter), start ~40% down the new page, stall on
    // image-only sections, and loop the last page forever at the end of a book.
    const continueInNextSection = () => {
      finishSmartSession();
      const before = renditionRef.current?.location;
      const fromHref = before?.start?.href ?? before?.end?.href ?? null;
      goNextSection();
      let attempts = 0;
      const waitForSection = () => {
        if (stopped || readingModeRef.current === "standard") return;
        const location = renditionRef.current?.location;
        const href = location?.start?.href ?? location?.end?.href ?? null;
        if (href === fromHref) {
          attempts += 1;
          if (attempts < 12) {
            readingEngineTimerRef.current = window.setTimeout(waitForSection, 250);
            return;
          }
          // Nothing came next: this is the end of the book.
          activeWordIndexRef.current = Math.max(0, readerWordsRef.current.length - 1);
          readingPausedRef.current = true;
          setReadingPaused(true);
          showFocusToast("End of book");
          schedule(180);
          return;
        }
        if (wordIndexTimerRef.current) {
          window.clearTimeout(wordIndexTimerRef.current);
          wordIndexTimerRef.current = null;
        }
        prepareReaderWords(false);
        if (readerWordsRef.current.length === 0) {
          continueInNextSection();
          return;
        }
        activeWordIndexRef.current = 0;
        readerDotAnchorIndexRef.current = 0;
        if (readingModeRef.current === "smart") {
          startSmartSessionAt(0);
        } else {
          setReadingWord(buildReadingWordState(0));
        }
        schedule(readingModeRef.current === "smart" ? 1400 : 700);
      };
      readingEngineTimerRef.current = window.setTimeout(waitForSection, 400);
    };

    schedule(readingMode === "smart" ? 2400 : 650);
    return () => {
      stopped = true;
      if (readingEngineTimerRef.current) {
        window.clearTimeout(readingEngineTimerRef.current);
        readingEngineTimerRef.current = null;
      }
      if (readingMode === "smart") finishSmartSession();
    };
  }, [readingMode, book.id]);

  const getScrollContainer = (): HTMLElement | null => {
    const cached = scrollContainerRef.current;
    if (cached && cached.isConnected) {
      return cached;
    }
    const manager = renditionRef.current?.manager as any;
    if (manager?.settings?.fullsize) {
      return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
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
        markNavigating();
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
      fontSizeRef.current = fontSize;
      sidebarRef.current = sidebarOpen;
      persistReaderState();
    } catch {
      // ignore
    }
  }, [fontSize, sidebarOpen, displayMode, autoScrollSpeed, speedReadWpm, storageKey]);

  const appliedFontSizeRef = useRef(fontSize);
  useEffect(() => {
    if (!renditionRef.current?.themes?.fontSize) {
      applyReaderTypography();
      return;
    }
    // Bigger or smaller text changes the chapter's height while the scroll
    // position stays put, so the page jumped by hundreds of pixels. Note the
    // line in view first, and return to it once the text has reflowed.
    const rendition = renditionRef.current;
    const changed = appliedFontSizeRef.current !== fontSize;
    appliedFontSizeRef.current = fontSize;
    const anchor: string | undefined = changed ? rendition.location?.start?.cfi : undefined;
    fontSizeRef.current = fontSize;
    applyReaderTypography();
    applyReaderInsets();
    if (anchor) {
      requestAnimationFrame(() => {
        markNavigating();
        void rendition
          .display(anchor)
          .then(() => {
            const container = ensureScrollContainer();
            if (container) {
              container.scrollTop = Math.max(0, container.scrollTop - PAGE_TOP_PAD);
            }
          })
          .catch(() => undefined);
      });
    }
    scheduleReaderWordIndex(true);
    persistReaderState();
  }, [fontSize]);

  useEffect(() => {
    readerDotEnabledRef.current = readerDotEnabled && layout === "scroll";
    persistReaderState();
    if (!readerDotEnabled) {
      removeLastReadMarker();
      return;
    }
    if (readingModeRef.current === "smart") {
      positionReaderDotAtWord(activeWordIndexRef.current);
      return;
    }
    if (readingModeRef.current === "speed") {
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

  const resolvedCover = coverFallback ?? coverSrc;
  const requestReadingMode = (nextMode: ReadingMode) => {
    if (nextMode === "standard") {
      readerDotUserAnchorUntilRef.current = 0;
      readerDotAnchorIndexRef.current = null;
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      setPendingReadingMode(null);
      setReadingMode("standard");
      return;
    }
    scheduleReaderWordIndex(true, 0);
    setReadingPaused(true);
    setPendingReadingMode(nextMode);
    setMorePanelOpen(false);
  };

  const beginReadingMode = (
    mode: Exclude<ReadingMode, "standard">,
    source: "dot" | "viewport" | "chapter"
  ) => {
    prepareReaderWords(false);
    const wordCount = readerWordsRef.current.length;
    let startIndex = 0;
    if (source === "dot") {
      startIndex = readerDotAnchorIndexRef.current ?? findNearestWordIndex();
    } else if (source === "viewport") {
      startIndex = findNearestWordIndex();
    }
    startIndex = Math.min(Math.max(0, startIndex), Math.max(0, wordCount - 1));
    requestedStartIndexRef.current = startIndex;
    activeWordIndexRef.current = startIndex;
    readerDotAnchorIndexRef.current = startIndex;
    readerDotUserAnchorUntilRef.current = Date.now() + 5 * 60 * 1000;
    if (readerDotEnabledRef.current && wordCount > 0) {
      positionReaderDotAtWord(startIndex);
    }
    setPendingReadingMode(null);
    setReadingMode(mode);
  };

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
  // The optimal recognition point: the letter the eye should land on, a little
  // left of centre. It stays pinned to the same spot on screen word after
  // word, so the eye never has to move; only the letters around it change.
  const rsvpPivot = readingWord ? rsvpPivotIndex(readingWord.text) : 0;
  // RSVP takes its colours from the page, not the app: a true-black page gets
  // a dark stage even when the rest of Leaflet is light, and the paper finish
  // stays paper when the app is dark.
  const rsvpFinish = getReaderFinish(displayMode, readerTheme);
  const rsvpDark = rsvpFinish.themeName === "leaflet-dark";
  // The page's own colours, for everything around the book text (its gutters,
  // the scrollbar, the frame), which otherwise followed the app's theme and
  // showed as pale strips beside a dark page.
  const pageStyle = {
    "--reader-page-bg": rsvpFinish.background,
    "--reader-page-ink": rsvpFinish.text,
    colorScheme: rsvpDark ? "dark" : "light"
  } as CSSProperties;
  const rsvpStyle = {
    "--rsvp-bg": rsvpFinish.background,
    "--rsvp-text": rsvpFinish.text,
    "--rsvp-accent": rsvpDark ? "#8cc95a" : "#0b7a45"
  } as CSSProperties;
  const rsvpWordsLeft = readingWord ? Math.max(0, readingWord.total - readingWord.index - 1) : 0;
  const rsvpMinutesLeft = Math.max(1, Math.round(rsvpWordsLeft / Math.max(60, speedReadWpm)));
  const rsvpProgress = readingWord ? (readingWord.index + 1) / Math.max(1, readingWord.total) : 0;
  const showFocusToast = (message: string) => {
    setFocusToast(message);
    if (focusToastTimerRef.current) {
      window.clearTimeout(focusToastTimerRef.current);
    }
    focusToastTimerRef.current = window.setTimeout(() => {
      setFocusToast(null);
    }, 2400);
  };
  showFocusToastRef.current = showFocusToast;

  holdAutoScrollRef.current = (held: boolean) => {
    if (held && !autoScrollActiveRef.current) {
      return;
    }
    if (autoScrollHeldRef.current === held) {
      return;
    }
    autoScrollHeldRef.current = held;
    setAutoScrollHeld(held);
    if (!held) {
      // A short breath after letting go, so the line being read stays put.
      autoScrollYieldUntilRef.current = Math.max(autoScrollYieldUntilRef.current, Date.now() + 400);
    }
  };

  /**
   * Hand scrolling while auto-scroll runs. Auto-scroll yields (longer when
   * going back: that is re-reading), and a consistent correction retunes it.
   */
  noteAutoScrollCorrectionRef.current = (container: HTMLElement, deltaY: number) => {
    const now = Date.now();
    autoScrollYieldUntilRef.current =
      now + (deltaY < 0 ? AUTO_SCROLL_YIELD_BACK_MS : AUTO_SCROLL_YIELD_AHEAD_MS);
    const correction = autoScrollCorrectionRef.current;
    if (now - correction.lastAt > 1500) {
      correction.net = 0;
    }
    correction.net += deltaY;
    correction.lastAt = now;
    if (now - autoScrollTunedAtRef.current < AUTO_SCROLL_TUNE_COOLDOWN_MS) {
      return;
    }
    const page = Math.max(200, container.clientHeight);
    const step = correction.net > page * 0.5 ? 4 : correction.net < -page * 0.35 ? -5 : 0;
    if (step === 0) {
      return;
    }
    correction.net = 0;
    autoScrollTunedAtRef.current = now;
    const next = Math.min(100, Math.max(0, autoScrollSpeedRef.current + step));
    if (next === autoScrollSpeedRef.current) {
      return;
    }
    setAutoScrollSpeed(next);
    showFocusToast(
      step > 0
        ? `Reading ahead? Sped up to ${autoScrollLinesPerMinute(next)} lines/min`
        : `Scrolling back? Slowed to ${autoScrollLinesPerMinute(next)} lines/min`
    );
  };


  return (
    <div
      className={`reader-scope fixed inset-0 z-50 h-full w-full overflow-hidden reader-bg ${
        chromeVisible ? "" : "reader-chrome-hidden"
      } ${
        isLight ? "reader-light" : ""
      } ${displayMode === "paper" ? "reader-paper-finish" : ""} ${
        displayMode === "dark-paper" ? "reader-dark-paper-finish" : ""
      } ${
        displayMode === "true-white" ? "reader-true-white-finish" : ""
      } ${
        displayMode === "true-black" ? "reader-true-black-finish" : ""
      } ${
        readingMode === "speed" ? "reader-speed-active" : ""
      }`}
      style={pageStyle}
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
            {/* The label is the first thing to drop on a narrow toolbar; the
                arrow carries the meaning on its own. */}
            <span className="hidden text-xs uppercase tracking-widest reader-accent sm:inline">
              Back to Library
            </span>
          </button>
          <PipExitGuard shown={exitGuard.guardShown} onDone={exitGuard.clearGuard} />
          {/* The chapter list otherwise opens only from a 6px hover strip,
              which a finger cannot hit and a touch screen cannot reveal. */}
          <button
            type="button"
            className="reader-chapters-toggle reader-icon transition-colors reader-hover-accent"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? "Hide chapters" : "Show chapters"}
          >
            <span className="material-symbols-outlined">list</span>
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
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1 text-xs uppercase tracking-widest reader-panel-soft reader-border">
              <button
                type="button"
                className="rounded-md border px-2 py-1 transition reader-border reader-icon reader-hover-accent"
                onClick={() => setFontSize((size) => Math.max(14, size - 2))}
              >
                A-
              </button>
              <span className="min-w-[40px] text-center">{fontSize}px</span>
              <button
                type="button"
                className="rounded-md border px-2 py-1 transition reader-border reader-icon reader-hover-accent"
                onClick={() => setFontSize((size) => Math.min(32, size + 2))}
              >
                A+
              </button>
            </div>
          )}
          <button
            className="reader-icon transition-colors reader-hover-accent"
            type="button"
            onClick={() => setSearchOpen((open) => !open)}
            title="Search in this book (Ctrl+F)"
            aria-label="Search in this book"
          >
            <UiIcon name="search" size={22} />
          </button>
          <div className="relative">
            <button
              className="reader-icon transition-colors reader-hover-accent"
              type="button"
              onClick={() => {
                setNotesFocus(null);
                setBookmarkPanelOpen((prev) => !prev);
              }}
              title="Bookmarks and highlights"
              aria-label="Bookmarks and highlights"
            >
              <span className="material-symbols-outlined">bookmark</span>
            </button>
            {bookmarkPanelOpen && (
              <AnnotationsPanel
                key={notesFocus ?? "notes"}
                bookmarks={bookmarks}
                highlights={orderedHighlights}
                focusId={notesFocus}
                onAddBookmark={addBookmark}
                onOpen={openBookmark}
                onRemove={(id) => void annotations.remove(id)}
                onSaveNote={(id, note) => void annotations.update(id, { note: note || null })}
                onExport={exportHighlights}
              />
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
                className="absolute right-0 mt-3 w-72 rounded-xl border p-4 text-xs shadow-2xl reader-panel reader-border"
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
                <div className="mt-3">
                  <span className="text-[10px] uppercase tracking-widest reader-muted">Layout</span>
                  <div className="mt-1.5 grid grid-cols-2 gap-1" role="radiogroup" aria-label="Layout">
                    {(["scroll", "pages"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={layout === option}
                        className={`reader-notes-tab ${layout === option ? "is-active" : ""}`}
                        onClick={() => chooseLayout(option)}
                      >
                        {option === "scroll" ? "Scroll" : "Pages"}
                      </button>
                    ))}
                  </div>
                </div>
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
                <label className="mt-3 block">
                  <span className="text-[10px] uppercase tracking-widest reader-muted">Reading mode</span>
                  <select
                    className="reader-select mt-1.5 w-full"
                    value={readingMode}
                    onChange={(event) => requestReadingMode(event.target.value as ReadingMode)}
                  >
                    <option value="standard">Standard</option>
                    <option value="smart" disabled={paged}>
                      Smart Read{paged ? " (scroll layout)" : ""}
                    </option>
                    <option value="speed" disabled={paged}>
                      SpeedRead (RSVP){paged ? " (scroll layout)" : ""}
                    </option>
                  </select>
                </label>
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
                  onClick={toggleTheme}
                >
                  <span>App theme</span>
                  <span className="reader-toggle" data-on={readerTheme === "light"} />
                </button>
                {readingMode === "standard" && !paged && (
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
                      title={`Auto scroll: ${autoScrollLinesPerMinute(autoScrollSpeed)} lines a minute (+ and - to adjust)`}
                    />
                    <span className="ml-auto tabular-nums reader-muted">
                      {autoScrollLinesPerMinute(autoScrollSpeed)} lines/min
                    </span>
                  </div>
                </div>
                )}
                {readingMode === "smart" && (
                  <div className="mt-3 rounded-lg border px-3 py-3 reader-border reader-pill">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest reader-muted">Adaptive pace</div>
                        <div className="mt-1 text-sm font-semibold reader-text-color">~{adaptiveWpm} WPM</div>
                      </div>
                      <button
                        type="button"
                        className="reader-mini-control"
                        onClick={() => setReadingPaused((paused) => !paused)}
                      >
                        <span className="material-symbols-outlined text-base">
                          {readingPaused ? "play_arrow" : "pause"}
                        </span>
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed reader-muted">
                      Learns from page timing, pauses, rereading, genre, time of day and word difficulty.
                    </p>
                  </div>
                )}
                {readingMode === "speed" && (
                  <div className="mt-3 rounded-lg border px-3 py-3 reader-border reader-pill">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] uppercase tracking-widest reader-muted">RSVP speed</div>
                      <button
                        type="button"
                        className="reader-mini-control"
                        onClick={() => setReadingPaused((paused) => !paused)}
                      >
                        <span className="material-symbols-outlined text-base">
                          {readingPaused ? "play_arrow" : "pause"}
                        </span>
                      </button>
                    </div>
                    <input
                      type="range"
                      min={120}
                      max={1000}
                      step={10}
                      value={speedReadWpm}
                      onChange={(event) => setSpeedReadWpm(Number(event.target.value))}
                      className="mt-3 h-1 w-full cursor-pointer accent-current"
                      title={`SpeedRead ${speedReadWpm} words per minute`}
                    />
                    <div className="mt-2 text-right text-[10px] tabular-nums reader-muted">{speedReadWpm} WPM</div>
                    <p className="mt-2 text-[10px] leading-relaxed reader-muted">
                      Timing automatically eases for uncommon, technical and unfamiliar words.
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
                  onClick={() => setReaderDotEnabled((prev) => !prev)}
                >
                  <span>Dotty</span>
                  <span className="reader-toggle" data-on={readerDotEnabled} />
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
            <div>
            {resolvedCover && (
              <div className="book-cover-frame mb-4 h-44 w-32 overflow-hidden border reader-border">
                <img src={resolvedCover} alt={book.title} className="h-full w-full object-cover" onError={handleCoverError} />
              </div>
            )}
            <h2 className="font-headline text-lg font-bold reader-text-color">{book.title}</h2>
            <p className="text-xs uppercase tracking-[0.2em] reader-muted">
              {book.author ?? "Unknown author"}
            </p>
            </div>
          </div>
          <div className="text-xs uppercase tracking-[0.3em] reader-muted">Chapters</div>
          <div className="mt-4 flex-1 overflow-y-auto pr-2">
            {toc.length === 0 && (
              <div className="text-xs reader-muted">
                {loading ? "Loading chapters..." : "No chapters found."}
              </div>
            )}
            {toc.map((item) => {
              const active = currentHref ? item.href.split("#")[0] === currentHref : false;
              return (
              <button
                key={`${item.href}-${item.label}`}
                type="button"
                className={`reader-chapter-link mb-2 w-full rounded-lg px-3 py-2 text-left text-sm transition reader-icon ${
                  active ? "reader-chapter-active font-semibold" : ""
                }`}
                onClick={() => {
                  displayChapter(item.href, { useSaved: false });
                  setSidebarOpen(false);
                }}
              >
                <span>{item.label}</span>
              </button>
              );
            })}
          </div>
        </aside>

        {/* Tapping the page is the expected way to dismiss a slide-over, and
            there is no hover-out to close it with on a touch screen. */}
        {sidebarOpen && (
          <button
            type="button"
            className="reader-sidebar-scrim md:hidden"
            aria-label="Close chapters"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <main className="reader-main overflow-hidden">
          {loadError && (
            <div className="mx-auto mt-28 max-w-lg rounded-xl border reader-border reader-panel p-6 text-center" role="alert">
              <p className="text-sm leading-relaxed reader-text-color">{loadError}</p>
              <div className="mt-5 flex justify-center gap-3">
                <button type="button" className="rounded-lg border px-4 py-2 text-xs uppercase tracking-widest reader-border reader-pill reader-icon" onClick={onClose}>
                  Back to library
                </button>
                <button
                  type="button"
                  className="rounded-lg border px-4 py-2 text-xs uppercase tracking-widest reader-border reader-pill reader-accent"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  Try again
                </button>
              </div>
            </div>
          )}
          {!loadError && (
            <div className="reader-page-frame relative h-full overflow-hidden">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center text-sm reader-panel-soft reader-muted">
                  Loading book...
                </div>
              )}
              <div
                ref={viewerRef}
                className={`reader-container ${paged ? "reader-pages" : "reader-scroll"} h-full w-full overflow-hidden overscroll-x-none`}
              />
              {readingMode === "speed" && readingWord && (
                <div
                  className={`reader-rsvp-stage pointer-events-none absolute inset-0 z-20 ${
                    rsvpDark ? "is-dark" : "is-light"
                  } ${readingPaused ? "is-paused" : ""}`}
                  style={rsvpStyle}
                >
                  <div className="reader-rsvp-reticle" aria-hidden="true">
                    <span className="reader-rsvp-guide" />
                    <div className="reader-rsvp-line">
                      <span className="reader-rsvp-pre">{readingWord.text.slice(0, rsvpPivot)}</span>
                      <span className="reader-rsvp-focus">{readingWord.text[rsvpPivot]}</span>
                      <span className="reader-rsvp-post">
                        {readingWord.text.slice(rsvpPivot + 1)}
                        <span className="reader-rsvp-punct">{readingWord.punctuation}</span>
                      </span>
                    </div>
                    <span className="reader-rsvp-guide" />
                  </div>

                  {/* Keyed on the pace, so changing it shows the row again
                      and restarts its fade. */}
                  <div key={speedReadWpm} className="reader-rsvp-meta">
                    <span className="reader-rsvp-meta-label tabular-nums">{speedReadWpm} wpm</span>
                    <span className="reader-rsvp-progress" aria-hidden="true">
                      <i style={{ transform: `scaleX(${rsvpProgress})` }} />
                    </span>
                    <span className="reader-rsvp-meta-label tabular-nums">~{rsvpMinutesLeft} min left in chapter</span>
                  </div>

                  <div key={readingWord.contextStart} className="reader-rsvp-context">
                    {readingWord.context.map((word) => (
                      <span
                        key={`${word.index}-${word.text}`}
                        className={
                          word.index === readingWord.index
                            ? "reader-rsvp-current"
                            : word.index < readingWord.index
                              ? "reader-rsvp-read"
                              : ""
                        }
                      >
                        {word.text}
                        {word.trailing || " "}
                      </span>
                    ))}
                  </div>

                  <div className="reader-rsvp-controls pointer-events-auto" role="group" aria-label="SpeedRead">
                    <button
                      type="button"
                      className="reader-rsvp-button"
                      onClick={() => setSpeedReadWpm((value) => Math.max(120, value - 20))}
                      title="Slower (-)"
                      aria-label="Slower"
                    >
                      <UiIcon name="minus" size={16} />
                    </button>
                    <button
                      type="button"
                      className="reader-rsvp-play"
                      onClick={() => setReadingPaused((value) => !value)}
                      title={readingPaused ? "Resume (Space)" : "Pause (Space)"}
                      aria-label={readingPaused ? "Resume" : "Pause"}
                    >
                      <UiIcon name={readingPaused ? "play" : "pause"} size={18} />
                    </button>
                    <button
                      type="button"
                      className="reader-rsvp-button"
                      onClick={() => setSpeedReadWpm((value) => Math.min(1000, value + 20))}
                      title="Faster (+)"
                      aria-label="Faster"
                    >
                      <UiIcon name="plus" size={16} />
                    </button>
                    {readingPaused && <span className="reader-rsvp-hint">Paused · Space to resume</span>}
                  </div>
                </div>
              )}
              {selection && (
                <div className="absolute bottom-16 left-1/2 z-40 -translate-x-1/2">
                  <SelectionBar
                    text={selection.text}
                    onHighlight={(color) => highlightSelection(color)}
                    onNote={() => highlightSelection("yellow", true)}
                    onCopy={copySelection}
                    onDismiss={clearSelection}
                  />
                </div>
              )}
              <div className="reader-chapter-dock pointer-events-none absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center">
                <div className="pointer-events-auto flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs uppercase tracking-widest reader-pill reader-border">
                  <button
                    type="button"
                    className="reader-mini-control"
                    onClick={paged ? () => turnPage(-1) : goPrevSection}
                    title={paged ? "Previous page (Left arrow)" : "Previous chapter"}
                    aria-label={paged ? "Previous page" : "Previous chapter"}
                  >
                    <span className="material-symbols-outlined text-base">chevron_left</span>
                  </button>
                  <span className="text-[10px] reader-muted">
                    {formatChapterDisplay()}
                  </span>
                  <button
                    type="button"
                    className="reader-mini-control"
                    onClick={paged ? () => turnPage(1) : goNextSection}
                    title={paged ? "Next page (Right arrow or Space)" : "Next chapter"}
                    aria-label={paged ? "Next page" : "Next chapter"}
                  >
                    <span className="material-symbols-outlined text-base">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {searchOpen && bookRef.current && (
        <SearchPanel book={bookRef.current} chapterOf={chapterOfSection} onOpen={openSearchHit} onClose={() => setSearchOpen(false)} />
      )}

      {pendingReadingMode && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-6">
          <div className="reader-panel reader-border w-full max-w-md rounded-2xl border p-6 shadow-2xl">
            <div className="text-[10px] uppercase tracking-[0.22em] reader-muted">
              {pendingReadingMode === "speed" ? "SpeedRead" : "Smart Read"}
            </div>
            <h2 className="mt-2 font-headline text-xl font-bold reader-text-color">
              Where should reading begin?
            </h2>
            <p className="mt-2 text-sm leading-relaxed reader-muted">
              Drag Dotty beside any line, then start from that exact position.
            </p>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                className="reader-start-choice reader-start-choice-primary"
                onClick={() => beginReadingMode(pendingReadingMode, "dot")}
              >
                <span className="material-symbols-outlined">adjust</span>
                <span>
                  <strong>Start at Dotty</strong>
                  <small>Use the line currently marked in the book</small>
                </span>
              </button>
              <button
                type="button"
                className="reader-start-choice"
                onClick={() => beginReadingMode(pendingReadingMode, "viewport")}
              >
                <span className="material-symbols-outlined">center_focus_strong</span>
                <span>
                  <strong>Start at current view</strong>
                  <small>Use the line near the centre of the page</small>
                </span>
              </button>
              <button
                type="button"
                className="reader-start-choice"
                onClick={() => beginReadingMode(pendingReadingMode, "chapter")}
              >
                <span className="material-symbols-outlined">first_page</span>
                <span>
                  <strong>Start at chapter beginning</strong>
                  <small>Begin from the first indexed word</small>
                </span>
              </button>
            </div>
            <button
              type="button"
              className="reader-start-cancel mt-4 w-full py-2 text-xs uppercase tracking-widest reader-muted transition"
              onClick={() => {
                setPendingReadingMode(null);
                setReadingPaused(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
            className="rounded-xl border p-4 text-left shadow-2xl reader-panel reader-border"
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
                  className="rounded-md border px-3 py-1 text-[10px] uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
                  onClick={handleCheckpointContinue}
                >
                  Continue +10 min
                </button>
              )}
              {checkpointLevel === 1 ? (
                <button
                  type="button"
                  className="tactile-button tactile-button-primary rounded-md px-3 py-1 text-[10px] font-semibold"
                  onClick={handleCheckpointEnd}
                >
                  End Session
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-md border px-3 py-1 text-[10px] uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
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

      {/* Auto-scroll's own control while it runs: the toolbar hides itself
          while reading, and pausing should never mean hunting for a menu. */}
      {readingMode === "standard" && autoScrollActive && (
        <div
          className={`reader-autoscroll-pill reader-panel reader-border ${chromeVisible || autoScrollHeld ? "is-awake" : ""}`}
          role="group"
          aria-label="Auto scroll"
        >
          <button
            type="button"
            className="reader-autoscroll-button reader-icon reader-hover-accent"
            onClick={() => setAutoScrollSpeed((value) => Math.max(0, value - 5))}
            title="Slower (-)"
            aria-label="Slower"
          >
            <UiIcon name="minus" size={16} />
          </button>
          <button
            type="button"
            className="reader-autoscroll-main reader-accent"
            onClick={() => setAutoScrollActive(false)}
            title="Pause (Space)"
          >
            <UiIcon name={autoScrollHeld ? "hand" : "pause"} size={16} />
            <span className="tabular-nums">
              {autoScrollHeld ? "Holding" : `${autoScrollLinesPerMinute(autoScrollSpeed)} lines/min`}
            </span>
          </button>
          <button
            type="button"
            className="reader-autoscroll-button reader-icon reader-hover-accent"
            onClick={() => setAutoScrollSpeed((value) => Math.min(100, value + 5))}
            title="Faster (+)"
            aria-label="Faster"
          >
            <UiIcon name="plus" size={16} />
          </button>
          <span className="reader-autoscroll-hint reader-muted">Space pauses · hold the page to wait</span>
        </div>
      )}

      {focusToast && (
        <div className="fixed bottom-6 right-6 z-[60]">
          <div className="rounded-full border px-4 py-2 text-[10px] uppercase tracking-widest shadow-xl reader-panel reader-border reader-muted">
            {focusToast}
          </div>
        </div>
      )}

    </div>
  );
};
