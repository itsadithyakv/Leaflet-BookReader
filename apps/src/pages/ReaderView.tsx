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
  isCommonWord,
  getReadingTimeBand
} from "../services/smartReadService";
import { PAPER_GRAIN } from "../constants/textures";
import { UiIcon } from "../components/UiIcon";
import { PipExitGuard, useFocusLockExit } from "../hooks/useFocusLockExit";
import { FocusFlower, flowerLook } from "../components/FocusFlower";
import { watchForeground } from "../services/windowService";
import { accountService } from "../services/accountService";
import ztNatureBoldWoff2 from "../assets/fonts/ZTNature-Bold.woff2";
import { formatSummary, getBookExtension, isReadableExtension } from "../constants/bookFormats";
import { buildSectionWeights, isChapterLike, outsideStory, spineIndexForProgress, type SectionWeights } from "../readers/progress";
import { highlightsMarkdown, useAnnotations } from "../readers/useAnnotations";
import { AnnotationsPanel } from "../readers/AnnotationsPanel";
import { SelectionBar } from "../readers/SelectionBar";
import { SearchPanel } from "../readers/SearchPanel";
import type { SearchHit } from "../readers/searchBook";
import { HIGHLIGHT_COLORS } from "../readers/highlightColors";

type ReaderViewProps = {
  book: Book;
  onClose: () => void;
  /** Open at this place (a highlight picked outside the reader) rather than where the reading stopped. */
  openAt?: string | null;
};
import { ALIGN_KEY, FALLBACK_FACE, LAYOUT_KEY, LINE_HEIGHT, MEASURE_KEY, MEASURE_PADDING, SPACING_KEY, TYPEFACE_KEY, applyTypeChoice, lineHeightPx, measureCss, pagesViewerMaxWidth, readAlign, readLayout, readMeasure, readSpacing, readTypeface, type ReaderAlign, type ReaderLayout, type ReaderMeasure, type ReaderSpacing, type ReaderTypeface, type TocItem, type ReaderDisplayMode, type ReadingMode, type ReaderWord, type ReadingWordState, type SmartSession } from "../readers/readerTypes";
import { TypePanel } from "../readers/TypePanel";
import { getReaderFinish, getReaderFinishBackground, PAGE_TOP_PAD } from "../readers/finish";
import { flattenToc } from "../readers/toc";
import { INK_SAMPLE, markInkImages } from "../readers/inkImages";
import { friendlyOpenError } from "../readers/openErrors";
import { AUTO_SCROLL_DEFAULT_KEY, AUTO_SCROLL_YIELD_BACK_MS, AUTO_SCROLL_YIELD_AHEAD_MS, AUTO_SCROLL_TUNE_COOLDOWN_MS, autoScrollLinesPerMinute, autoScrollPixelsPerSecond, autoScrollSpeedForLines, readAutoScrollDefault } from "../readers/autoScroll";
import { rsvpStageVars, noveltyHolds, rsvpRamp, MAX_WORD_HOLD, READER_WORD_PATTERN, HANDS_FREE_GRACE_MS, READER_BLOCK_SELECTOR, SENTENCE_END_PATTERN, isInlineJoin, getPaceFactor, getPaceScale } from "../readers/pacing";
import {
  createReadingProfile,
  estimateTextDifficulty,
  mergeProfiles,
  notePause,
  paceLimits,
  plainFromWpm,
  predictPlainWpm,
  predictWpm,
  readerPace,
  recordSample,
  setBookPace,
  wpmFromPlain,
  type OutlierStreak,
  type PaceSource,
  type ReadingProfile
} from "../readers/paceModel";
import { judgeCatchUp, PagePaceTracker, ScrollPaceTracker } from "../readers/paceTracker";
import { easeInOutCubic, planScrollStep, readingBand, stepDuration, type ReadingArea } from "../readers/smartScroll";
import { ReaderTour, readerTourSeen, readStartMode } from "../readers/ReaderTour";
import { toolbarTitleClass } from "../readers/titleFit";
import { keyTurns, pageTurnDuration, pageTurnTarget } from "../readers/pageTurn";
import { dotIsStranded } from "../readers/readerDot";
import { markOpenings, OPENINGS_CSS } from "../readers/dropCaps";
import { ChapterDock } from "../readers/ChapterDock";
import type { Outlook } from "../readers/ReadingOutlook";
import { chapterEndFor, minutesFor, steadyMinutes, wordsLeft, wordsPerByte } from "../readers/timeLeft";
import { sectionsFromArchive } from "../readers/archiveSections";
import { NO_JUMPS, noteJump, stepBack, stepForward, type JumpHistory } from "../readers/jumpHistory";
import { readingLineIn } from "../readers/readingPlace";
import { isOutsideLink, resolveBookLink } from "../readers/bookLinks";
import { classifyNoteLink, elementById, linkFacts, noteBlockOf, noteText, targetFacts, type NoteRun } from "../readers/footnotes";
import { NotePopover } from "../readers/NotePopover";
import { markViewable, pictureAt, setInkOff } from "../readers/pictures";
import { ImageViewer, type ViewedPicture } from "../readers/ImageViewer";
import { ProgressBar } from "../readers/ProgressBar";
import { fractionAt, seekTarget } from "../readers/seek";
import { actionFor, keyBelongsToControl, shortcutSections } from "../readers/readerKeys";
import { escapeTarget } from "../readers/escapeOrder";
import { ShortcutsSheet } from "../readers/ShortcutsSheet";
import { LookupCard } from "../readers/LookupCard";
import { usePeopleReader } from "../readers/people/usePeopleReader";
import { selectedTextBox } from "../readers/lookupPlacement";
import { placeToSave } from "../readers/readingPlace";
import { placeFollows } from "../readers/openAt";
import { planHighlightDraws } from "../readers/highlightDraws";
import { indexOfPlace, wordPlace, type WordPlace } from "../readers/wordPlace";
import { orderHighlights } from "../components/highlights/highlightsView";
import { readingProfileService } from "../services/readingProfileService";

/** One press of Smart Read's faster or slower: eight percent. */
const SMART_NUDGE = 1.08;
/** Dotty's width, in pixels (its look is in index.css). */
const DOT_SIZE = 7;
/** The most words indexed at once: the chapters on screen, and a neighbour or two. */
const WORD_INDEX_LIMIT = 90000;

export const ReaderView = ({ book, onClose, openAt = null }: ReaderViewProps) => {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  // What covers the page's edges (the toolbar, Smart Read's controls, the
  // chapter bar), which Smart Read keeps Dotty's line clear of.
  const toolbarRef = useRef<HTMLElement | null>(null);
  const pacePillRef = useRef<HTMLDivElement | null>(null);
  const chapterDockRef = useRef<HTMLDivElement | null>(null);
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
  // Scrolling shows several chapters at once (the one being read and its
  // neighbours): the frames the words came from, and where each one's words
  // start, so "this chapter" still means something.
  const wordFramesRef = useRef<HTMLIFrameElement[]>([]);
  const wordSectionStartsRef = useRef<number[]>([]);
  // Which chapter of the book each of those is, and where in their chapters
  // the word being read and a pinned Dotty were: how they are found again
  // when the page is laid out afresh (readers/wordPlace.ts).
  const wordSectionIdsRef = useRef<number[]>([]);
  const keptWordPlaceRef = useRef<{ active: WordPlace | null; anchor: WordPlace | null } | null>(null);
  const readingPaceScaleRef = useRef({ speed: 1, smart: 1 });
  const activeWordIndexRef = useRef(0);
  const readerDotAnchorIndexRef = useRef<number | null>(null);
  const readerDotUserAnchorUntilRef = useRef(0);
  const requestedStartIndexRef = useRef<number | null>(null);
  const programmaticScrollUntilRef = useRef(0);
  const smartManualOverrideUntilRef = useRef(0);
  /** Smart Read's pace as a plain pace (see paceModel). It carries on across chapters. */
  const smartPlainRef = useRef(0);
  /** The reader scrolled back above Dotty to reread: Dotty waits for them. */
  const smartRereadRef = useRef(false);
  /** The reader scrolled on past Dotty: a catch-up is due once the scrolling settles. */
  const smartReaderAheadRef = useRef(false);
  const smartCatchUpTimerRef = useRef<number | null>(null);
  /** Dotty holds its word while a page step scrolls, and for a beat after. */
  const smartStepHoldUntilRef = useRef(0);
  const smartScrollFrameRef = useRef<number | null>(null);
  const smartSessionRef = useRef<SmartSession | null>(null);
  /** Something covers the page (a panel, a selection, the tour): hands-free reading waits. */
  const interruptedRef = useRef(false);
  /** Leaflet is not the app in front. */
  const awayRef = useRef(false);
  /** What to tell the reader when they come back, if reading was paused while they were away. */
  const pausedWhileAwayRef = useRef<string | null>(null);
  /** Smart Read starts paused (opening a book in it), for the reader to set off. */
  const startPausedRef = useRef(false);
  /** How hard the chapter on screen reads (see paceModel), and its words' average difficulty. */
  const sectionDifficultyRef = useRef(1.06);
  const sectionWordDifficultyRef = useRef(1);
  // Free reading teaches the pace too: words passing the reading line as the
  // reader scrolls, or the words on each page they turn.
  const scrollPaceRef = useRef(new ScrollPaceTracker());
  const pagePaceRef = useRef(new PagePaceTracker());
  const pageShownRef = useRef<{ href: string; page: number; total: number } | null>(null);
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
  /** When a key last turned a page (layout "pages"), for pacing a held key. */
  const lastKeyTurnAtRef = useRef(0);
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
  const showFocusToastRef = useRef<(message: string, ms?: number) => void>(() => undefined);
  const nudgeSmartPaceRef = useRef<(factor: number) => void>(() => undefined);
  const toggleSmartPlayRef = useRef<() => void>(() => undefined);
  // Called from epub.js's relocation handler, which is bound once per book.
  const notePageShownRef = useRef<(location: any) => void>(() => undefined);
  // Called from the foreground watcher, bound once.
  const stopFreeReadingRef = useRef<() => void>(() => undefined);
  const savePaceProfileRef = useRef<() => void>(() => undefined);
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
      // A picture or the shortcuts sheet is open over the page: its keys
      // are its own. Escape still comes through, for when the keyboard is
      // somewhere else (in the book's text).
      if ((pictureRef.current || shortcutsOpenRef.current) && event.key !== "Escape") {
        return;
      }
      // A button, a slider or a radio the keyboard is on takes its own keys:
      // Space used to start auto-scroll instead of pressing the button.
      let focusVisible = false;
      try {
        focusVisible = Boolean(target?.matches?.(":focus-visible"));
      } catch {
        // An older engine: treat it as reached by the mouse.
      }
      if (keyBelongsToControl(event, target ? { tag: target.tagName ?? "", role: target.getAttribute?.("role") ?? "", focusVisible } : null)) {
        return;
      }
      lastHandsOnAtRef.current = Date.now();
      // What the key does here comes from the one table the shortcuts sheet
      // is drawn from (readers/readerKeys.ts).
      const action = actionFor(event, { layout: layoutRef.current, mode: readingModeRef.current });
      if (action === null) {
        return;
      }
      if (action === "escape") {
        escapeRef.current(event);
        return;
      }
      event.preventDefault();
      switch (action) {
        case "search":
          setSearchOpen(true);
          return;
        case "back":
        case "forward":
          // Back to where a jump left off, and forward again (readers/jumpHistory.ts).
          if (!event.repeat) {
            (action === "back" ? goBackRef : goForwardRef).current();
          }
          return;
        case "shortcuts":
          if (!event.repeat) {
            setShortcutsOpen((open) => !open);
          }
          return;
        case "bookmark":
          if (!event.repeat) {
            addBookmarkRef.current();
          }
          return;
        case "pageNext":
        case "pagePrev": {
          // One press, one page; a held key is paced (readers/pageTurn.ts).
          const pressedAt = performance.now();
          if (!keyTurns(event.repeat, pressedAt - lastKeyTurnAtRef.current)) {
            return;
          }
          lastKeyTurnAtRef.current = pressedAt;
          turnPageRef.current(action === "pagePrev" ? -1 : 1);
          return;
        }
        case "chapterNext":
        case "chapterPrev":
          if (!event.repeat) {
            (action === "chapterNext" ? goNextSection : goPrevSection)();
          }
          return;
        case "faster":
        case "slower": {
          // (Scrolling only. With pages nothing is paced: the keys used to
          // change auto-scroll's speed unseen, which also fixed it for this
          // book, so it no longer started at the reader's own pace.)
          const faster = action === "faster";
          if (readingModeRef.current === "standard") {
            const next = Math.min(100, Math.max(0, autoScrollSpeedRef.current + (faster ? 5 : -5)));
            tuneAutoScroll(next);
            showFocusToastRef.current(`Auto-scroll ${autoScrollLinesPerMinute(next)} lines/min`);
          } else if (readingModeRef.current === "speed") {
            const next = Math.min(1000, Math.max(120, speedReadWpmRef.current + (faster ? 20 : -20)));
            setSpeedReadWpm(next);
            showFocusToastRef.current(`${next} words/min`);
          } else {
            nudgeSmartPaceRef.current(faster ? SMART_NUDGE : 1 / SMART_NUDGE);
          }
          return;
        }
        case "scrollDown":
        case "scrollUp": {
          const container = getScrollContainer();
          if (!container) {
            return;
          }
          const down = action === "scrollDown";
          if (autoScrollActiveRef.current) {
            autoScrollYieldUntilRef.current = Date.now() + (down ? AUTO_SCROLL_YIELD_AHEAD_MS : AUTO_SCROLL_YIELD_BACK_MS);
          }
          if (down && container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
            triggerScrollAdvance();
            return;
          }
          smoothScrollBy(container, Math.max(120, Math.round(container.clientHeight * 0.2)) * (down ? 1 : -1));
          return;
        }
        case "playPause":
          if (readingModeRef.current === "standard") {
            setAutoScrollActive((prev) => !prev);
          } else if (readingModeRef.current === "smart") {
            toggleSmartPlayRef.current();
          } else {
            setReadingPaused((prev) => !prev);
          }
          return;
        default:
          return;
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
      if (smartCatchUpTimerRef.current) {
        window.clearTimeout(smartCatchUpTimerRef.current);
      }
      if (smartScrollFrameRef.current) {
        window.cancelAnimationFrame(smartScrollFrameRef.current);
      }
      if (checkpointTimerRef.current) {
        window.clearTimeout(checkpointTimerRef.current);
      }
      if (focusToastTimerRef.current) {
        window.clearTimeout(focusToastTimerRef.current);
      }
      if (dockAwakeTimerRef.current) {
        window.clearTimeout(dockAwakeTimerRef.current);
      }
      if (lastComputedProgressRef.current >= 0) {
        // A look at a highlight that turned into reading, with no move since
        // to save it: the place and its progress go together, here and in
        // this device's own record.
        const stayed = openedAtPlaceRef.current && progressArmedRef.current && placeFollowsNow();
        if (stayed) {
          persistReaderState();
        }
        const progress = Math.min(
          1,
          Math.max(0, stayed ? (lastCfiProgressRef.current ?? lastComputedProgressRef.current) : lastComputedProgressRef.current)
        );
        // The exact line goes along only once the position is trustworthy;
        // otherwise this is just "opened and closed", which keeps what synced.
        // A look at a highlight keeps it too.
        const position = progressArmedRef.current && placeFollowsNow() ? lastCfiRef.current : null;
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
        autoScrollTuned?: boolean;
        speedReadWpm?: number;
        readerDotEnabled?: boolean;
        cfi?: string;
        cfiProgress?: number;
        chapterPositions?: Record<string, string>;
        wordsPerByte?: { ratio: number; bytes: number };
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
  const fontPanelRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollActive, setAutoScrollActive] = useState(false);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(
    () => initialPrefs?.autoScrollSpeed ?? readAutoScrollDefault()
  );
  // Whether the reader has set auto-scroll's speed in this book. Until they
  // do, it starts at their own reading pace (see autoScrollSpeedForPace). A
  // book opened before this was remembered keeps the speed it had.
  const autoScrollTunedRef = useRef(
    initialPrefs ? (initialPrefs.autoScrollTuned ?? initialPrefs.autoScrollSpeed !== undefined) : false
  );
  const autoScrollPacedRef = useRef(false);
  /** Auto-scroll running with no correction: a pace the reader keeps up with. */
  const autoScrollRunRef = useRef({ ms: 0, px: 0 });
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
  /** Dotty's pace in Smart Read, for its controls. */
  const [smartWpm, setSmartWpm] = useState(0);
  /** Smart Read is waiting for a reader who went back to reread. */
  const [smartWaiting, setSmartWaiting] = useState(false);
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
  // The old, device-only Smart Read profile keyed off the connected Google
  // account; that is where it is looked for when bringing it over.
  const accountEmail = useLibraryStore((state) => state.sync.accountEmail);
  // What Leaflet has learned about this reader's pace (readers/paceModel.ts).
  // It comes from the library, and so from every device the reader syncs;
  // learning here is saved back a few seconds after it changes, and on close.
  const paceProfileRef = useRef<ReadingProfile>(createReadingProfile());
  const paceSaveTimerRef = useRef<number | null>(null);
  const paceStreakRef = useRef<OutlierStreak>(null);
  /** Smart Read's pace is still the model's own guess: the reader has not corrected it this time. */
  const smartPaceFromModelRef = useRef(true);
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
  // How long a line may run (readers/readerTypes.ts): the text in a column on
  // a wide window. A preference of this device, like the layout.
  const [measure, setMeasure] = useState<ReaderMeasure>(readMeasure);
  const measureRef = useRef<ReaderMeasure>(measure);
  measureRef.current = measure;
  const chooseMeasure = (next: ReaderMeasure) => {
    try {
      localStorage.setItem(MEASURE_KEY, next);
    } catch {
      // This session only.
    }
    setMeasure(next);
  };
  // The face, the line spacing and the alignment (readers/readerTypes.ts):
  // preferences of this device too. Read through a ref by the chapters'
  // stylesheet hook and by everything that counts in lines.
  const [typeface, setTypeface] = useState<ReaderTypeface>(readTypeface);
  const [spacing, setSpacing] = useState<ReaderSpacing>(readSpacing);
  const [align, setAlign] = useState<ReaderAlign>(readAlign);
  const typeChoiceRef = useRef({ typeface, spacing, align });
  typeChoiceRef.current = { typeface, spacing, align };
  const keepChoice = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // This session only.
    }
  };
  const chooseTypeface = (next: ReaderTypeface) => {
    keepChoice(TYPEFACE_KEY, next);
    setTypeface(next);
  };
  const chooseSpacing = (next: ReaderSpacing) => {
    keepChoice(SPACING_KEY, next);
    setSpacing(next);
  };
  const chooseAlign = (next: ReaderAlign) => {
    keepChoice(ALIGN_KEY, next);
    setAlign(next);
  };
  /** One line of the book's text, in pixels: the one place its height is worked out. */
  const linePx = () => lineHeightPx(fontSizeRef.current, typeChoiceRef.current.spacing);
  /** The column for the book's stylesheet. Pages narrow the viewer instead: their frame spans every column. */
  const bookMeasureCss = () => measureCss(layoutRef.current === "pages" ? "full" : measureRef.current);
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
  /** Words the search panel opens with ("Search in this book" from the selection bar); empty for Ctrl+F. */
  const [searchSeed, setSearchSeed] = useState("");
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchSeed("");
  };
  /**
   * The look-up card (readers/LookupCard.tsx). It holds the selection's CFI,
   * not a flag, so a card can never show for a selection that has gone or
   * changed.
   */
  const [lookUpCfi, setLookUpCfi] = useState<string | null>(null);
  /** The keyboard shortcuts sheet ("?", or the ··· menu). */
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsOpenRef = useRef(false);
  shortcutsOpenRef.current = shortcutsOpen;
  // For the key handler, which is bound once: what Escape closes now, and
  // bookmarking the place (they read this render's state).
  const escapeRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  const addBookmarkRef = useRef<() => void>(() => undefined);
  /** A held Escape closes one thing: its repeats do nothing until it is let go. */
  const escapeClosedLayerRef = useRef(false);
  /** The progress bar's handle, for Escape (see ProgressBar's holdRef). */
  const seekHoldRef = useRef<{ held: () => boolean; letGo: () => void } | null>(null);
  /** The walkthrough of Dotty, Smart Read and pausing (first open, or from the ··· menu). */
  const [tourOpen, setTourOpen] = useState(false);
  // Characters (readers/people): who is who, as far as the reader has got.
  // Everything it is handed is asked for when needed, so it can sit up here.
  const people = usePeopleReader({
    ready: !loading && loadError === null,
    bookId: book.id,
    book: bookRef.current,
    rendition: renditionRef.current,
    place: () => ({
      progress: lastCfiProgressRef.current ?? book.progress ?? 0,
      cfi: lastCfiRef.current,
      chapter: chapterLabel
    }),
    chapterOf: (section) => chapterOfSection(section),
    // Through the reader's own jump, so Back returns to where the card was opened.
    goTo: (cfi) => {
      noteJumpFromHere();
      goToPlace(cfi);
    },
    toast: (message) => showFocusToastRef.current(message),
    covered: () =>
      searchOpen ||
      bookmarkPanelOpen ||
      sidebarOpen ||
      tourOpen ||
      fontPanelOpen ||
      note !== null ||
      picture !== null ||
      shortcutsOpen ||
      pendingReadingMode !== null
  });
  // For the development hook on the window (see where the rendition is made).
  const peopleMarkedRef = useRef(people.marked);
  peopleMarkedRef.current = people.marked;
  const {
    visible: chromeVisible,
    reveal: revealChrome,
    hover: hoverChrome
  } = useAutoHideChrome(
    fontPanelOpen ||
      bookmarkPanelOpen ||
      morePanelOpen ||
      searchOpen ||
      tourOpen ||
      people.cardOpen ||
      people.panelOpen ||
      selection !== null ||
      loading ||
      loadError !== null
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
  // Called from the book's own documents, which are bound once.
  const selectionChangedRef = useRef<() => void>(() => undefined);
  const { bookmarks, highlights } = annotations;

  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocIndexByHref, setTocIndexByHref] = useState<Record<string, number>>({});
  const [tocLabelByHref, setTocLabelByHref] = useState<Record<string, string>>({});
  // Where to reopen: this device's own last line, unless the synced position
  // (read on another device) is further on, or this device has none.
  const lastCfiRef = useRef<string | null>(
    (() => {
      if (openAt) {
        return openAt;
      }
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
  // Opened at a highlight from the library ("Open in book"): a look, until the
  // reader stays (readers/openAt.ts). Meanwhile the saved place and the
  // book's progress stay where the reading stopped, so the next ordinary open
  // resumes there; this is what this device had saved, written back as it was.
  const openedAtPlaceRef = useRef(openAt !== null);
  const storedPlaceRef = useRef({
    cfi: initialPrefs?.cfi,
    cfiProgress: initialPrefs?.cfiProgress,
    chapterPositions: initialPrefs?.chapterPositions ?? {}
  });
  const placeFollowsNow = () => placeFollows(openedAtPlaceRef.current, Date.now() - openedAtRef.current);
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
  // For the time left (readers/timeLeft.ts): the words counted in each section
  // seen, the words a byte has held (remembered with the book, so the
  // estimate does not start over each visit), and where chapters start.
  const sectionWordsRef = useRef(new Map<number, number>());
  const wordRatioRef = useRef<{ ratio: number; bytes: number } | null>(
    typeof initialPrefs?.wordsPerByte?.ratio === "number" && typeof initialPrefs?.wordsPerByte?.bytes === "number"
      ? initialPrefs.wordsPerByte
      : null
  );
  const tocSpineStartsRef = useRef<number[]>([]);
  const shownMinutesRef = useRef<{ chapter: number | null; book: number | null }>({ chapter: null, book: null });
  /** How far through the book, and how long is left: shown in the chapter dock. */
  const [outlook, setOutlook] = useState<Outlook>({
    progress: typeof book.progress === "number" ? book.progress : null,
    chapter: null,
    book: null
  });
  // Called from epub.js's relocation handler and the word index, both bound once.
  const updateOutlookRef = useRef<() => void>(() => undefined);
  // Back to where you were (readers/jumpHistory.ts): the lines left by jumps,
  // for this visit. The counts are what the dock draws.
  const jumpsRef = useRef<JumpHistory>(NO_JUMPS);
  const [jumps, setJumps] = useState({ back: 0, forward: 0 });
  /** The dock is awake for a moment after a jump, so the way back is seen. */
  const [dockAwake, setDockAwake] = useState(false);
  const dockAwakeTimerRef = useRef<number | null>(null);
  // For the key handler and the book's own documents, bound once.
  const goBackRef = useRef<() => void>(() => undefined);
  const goForwardRef = useRef<() => void>(() => undefined);
  const followBookLinkRef = useRef<(anchor: Element, sectionIndex: number | undefined) => void>(() => undefined);
  /**
   * A footnote shown in place (readers/footnotes.ts): its words, and where it
   * is for "Go to note". Plain text only, so it outlives the chapter it was
   * read from.
   */
  const [note, setNote] = useState<{ href: string; marker: string; paragraphs: NoteRun[][]; truncated: boolean } | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;
  /** Counts note look-ups: one that comes back after another was asked for is dropped. */
  const noteRequestRef = useRef(0);
  const closeNoteRef = useRef<() => void>(() => undefined);
  /** A picture from the book, opened large (readers/ImageViewer.tsx). */
  const [picture, setPicture] = useState<ViewedPicture | null>(null);
  const pictureRef = useRef(picture);
  pictureRef.current = picture;
  const openPictureRef = useRef<(found: ViewedPicture) => void>(() => undefined);
  /** The progress bar shows with the dock; it can be used once the sections' sizes are known. */
  const [dockNear, setDockNear] = useState(false);
  const [canSeek, setCanSeek] = useState(false);


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
    cancelSmartCatchUp();
    smartRereadRef.current = false;
    setMorePanelOpen(false);
    // Another book: its own places and its own words.
    jumpsRef.current = NO_JUMPS;
    setJumps({ back: 0, forward: 0 });
    sectionWordsRef.current = new Map();
    shownMinutesRef.current = { chapter: null, book: null };
  }, [book.id]);

  useEffect(() => {
    let cancelled = false;
    readingProfileService
      .load(accountEmail)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        // Anything learned in the moment before it arrived is kept.
        paceProfileRef.current = mergeProfiles(loaded, paceProfileRef.current);
        // Smart Read may have started on the first guess; the reader's own pace replaces it.
        if (readingModeRef.current === "smart" && smartPaceFromModelRef.current) {
          smartPlainRef.current = predictPlainWpm(paceProfileRef.current, paceContext());
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accountEmail]);

  // Closing the book keeps what this visit taught, and hands it to sync.
  useEffect(
    () => () => {
      stopFreeReadingRef.current();
      finishSmartSession();
      if (paceSaveTimerRef.current) {
        window.clearTimeout(paceSaveTimerRef.current);
        paceSaveTimerRef.current = null;
      }
      void readingProfileService.save(paceProfileRef.current).catch(() => undefined);
    },
    []
  );

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

  // The type panel hangs under its button, over the page: a click anywhere
  // else in the app closes it, as the ··· menu's does.
  useEffect(() => {
    if (!fontPanelOpen) {
      return;
    }
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (fontPanelRef.current && target && !fontPanelRef.current.contains(target)) {
        setFontPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [fontPanelOpen]);


  const applyReaderInsets = () => {
    const rendition = renditionRef.current;
    // With pages, epub.js sizes and pads the columns itself; forcing a full
    // width here would collapse them into one long page.
    if (!rendition?.themes || layoutRef.current === "pages") {
      return;
    }
    rendition.themes.override("padding-left", MEASURE_PADDING);
    rendition.themes.override("padding-right", MEASURE_PADDING);
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
      // epub.js keeps the text still itself when a chapter loads in above or
      // is let go; the browser doing the same would move it twice.
      container.style.setProperty("overflow-anchor", "none");
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
    rendition.themes.override("line-height", String(LINE_HEIGHT[typeChoiceRef.current.spacing]));
    rendition.themes.override("font-weight", "400");

    const contentsList = rendition.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document;
      if (!doc) {
        return;
      }
      doc.documentElement.style.setProperty("--reader-font-size", `${fontSizeRef.current}px`);
      doc.documentElement.style.setProperty("--reader-measure", bookMeasureCss());
      applyTypeChoice(doc.documentElement, typeChoiceRef.current);
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
      if (!word.iframe.isConnected) {
        return null;
      }
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
    const span = sectionSpan(index);
    return {
      index,
      total: words.length,
      sectionStart: span.start,
      sectionEnd: span.end,
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
      noteSmartDrag(paceOrigin, clampedIndex);
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

  /** Dotty's element, made on first use. Its look, and its glide from line to line, are in index.css. */
  const ensureReaderDot = (container: HTMLElement) => {
    const existing = readerDotElementRef.current;
    if (existing && container.contains(existing)) {
      makeReaderDotInteractive(existing, container);
      return existing;
    }
    const element = document.createElement("div");
    element.id = "reader-lastline-dot";
    element.className = "reader-dot";
    element.style.position = "absolute";
    element.style.width = `${DOT_SIZE}px`;
    element.style.height = `${DOT_SIZE}px`;
    element.style.pointerEvents = "none";
    element.style.opacity = "0";
    element.style.zIndex = "50";
    container.appendChild(element);
    readerDotElementRef.current = element;
    makeReaderDotInteractive(element, container);
    return element;
  };

  /**
   * Puts Dotty beside a line. It glides there, except across a long way (a
   * jump elsewhere, or a chapter loading in above and moving the text): a
   * glide then was a streak down the page.
   */
  const moveReaderDot = (dot: HTMLElement, container: HTMLElement, top: number, left: number) => {
    const from = Number.parseFloat(dot.style.top);
    const far = !Number.isFinite(from) || Math.abs(top - from) > container.clientHeight * 0.9;
    if (far) {
      dot.style.transition = "none";
    }
    dot.style.left = `${left}px`;
    dot.style.top = `${top}px`;
    dot.style.opacity = "1";
    if (far) {
      void dot.offsetWidth;
      dot.style.transition = "";
    }
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
    const dot = ensureReaderDot(container);
    moveReaderDot(dot, container, Math.max(6, documentTop + rect.height / 2 - DOT_SIZE / 2), left);
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

  /**
   * The part of the page Smart Read reads in: below the toolbar when it is
   * showing, above Smart Read's own controls (or the chapter bar), in lines of
   * the current type. Measured every time, so a resized window, a new font
   * size or the toolbar coming back are all simply taken into account.
   */
  const readingArea = (container: HTMLElement): ReadingArea => {
    const box = container.getBoundingClientRect();
    const toolbar = toolbarRef.current?.getBoundingClientRect();
    const controls = (pacePillRef.current ?? chapterDockRef.current)?.getBoundingClientRect();
    return {
      height: container.clientHeight,
      lineHeight: linePx(),
      topInset: Math.max(8, toolbar ? toolbar.bottom - box.top : 0),
      bottomInset: Math.max(12, controls ? box.bottom - controls.top + 8 : 0)
    };
  };

  /**
   * Smart Read turns the page: one smooth step that brings Dotty's line up to
   * the top (see readers/smartScroll.ts). Dotty holds its word while the page
   * moves, and a moment after, so the eye can find the line again.
   */
  const turnSmartPage = (container: HTMLElement, delta: number) => {
    const start = container.scrollTop;
    const target = Math.min(Math.max(0, start + delta), Math.max(0, container.scrollHeight - container.clientHeight));
    const distance = target - start;
    if (Math.abs(distance) < 2) {
      // The end of the chapter: nothing further to scroll to.
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const duration = stepDuration(distance, reduced);
    const now = Date.now();
    programmaticScrollUntilRef.current = now + duration + 250;
    smartStepHoldUntilRef.current = now + duration + 350;
    if (smartScrollFrameRef.current) {
      window.cancelAnimationFrame(smartScrollFrameRef.current);
      smartScrollFrameRef.current = null;
    }
    if (duration === 0) {
      container.scrollTop = target;
      return;
    }
    let startedAt: number | null = null;
    const frame = (time: number) => {
      startedAt ??= time;
      const progress = Math.min(1, (time - startedAt) / duration);
      container.scrollTop = start + distance * easeInOutCubic(progress);
      smartScrollFrameRef.current = progress < 1 ? window.requestAnimationFrame(frame) : null;
    };
    smartScrollFrameRef.current = window.requestAnimationFrame(frame);
  };

  /**
   * The reader's own scrolling wins over a page step on its way. The step used
   * to go on setting the page every frame and undo the reader's scroll, which
   * hid the very reading-ahead that Dotty should catch up with.
   */
  const cancelSmartPageTurn = () => {
    if (smartScrollFrameRef.current) {
      window.cancelAnimationFrame(smartScrollFrameRef.current);
      smartScrollFrameRef.current = null;
      programmaticScrollUntilRef.current = 0;
      smartStepHoldUntilRef.current = 0;
    }
  };

  const scrollWordIntoReadingBand = (index: number) => {
    const mode = readingModeRef.current;
    // The reader is scrolling, is ahead of Dotty, or went back to reread: the
    // page is theirs until that settles.
    if (
      mode === "smart" &&
      (Date.now() < smartManualOverrideUntilRef.current || smartReaderAheadRef.current || smartRereadRef.current)
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
    if (mode === "smart") {
      const delta = planScrollStep(relativeTop, relativeTop + rect.height, readingArea(container));
      if (delta !== null) {
        turnSmartPage(container, delta);
      }
      return;
    }
    // SpeedRead keeps the page behind it roughly in step, for when it stops.
    const lowerBand = container.clientHeight * 0.7;
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
    const previousWords = readerWordsRef.current;
    const previousWordCount = previousWords.length;
    const previousAnchor = readerDotAnchorIndexRef.current;
    const preserveUserAnchor =
      Date.now() < readerDotUserAnchorUntilRef.current &&
      previousAnchor !== null &&
      previousWordCount > 0;
    // The words being read and pinned, to find again below: chapters come and
    // go above and below as the reader scrolls, so a word's number changes
    // while the word stays where it is.
    const previousActive = activeWordIndexRef.current;
    const previousActiveWord = Math.min(previousActive, previousWordCount - 1);
    const activeWordBefore = previousWords[previousActiveWord];
    const anchorWordBefore = previousAnchor !== null ? previousWords[previousAnchor] : undefined;
    // The same two as places in the book (readers/wordPlace.ts), for when the
    // page was laid out afresh and its words are new nodes. Kept across an
    // index taken while the page was empty, half way through the swap.
    if (previousWordCount > 0) {
      const startsBefore = wordSectionStartsRef.current;
      const idsBefore = wordSectionIdsRef.current;
      keptWordPlaceRef.current = {
        active: wordPlace(previousActiveWord, startsBefore, idsBefore),
        anchor: preserveUserAnchor && previousAnchor !== null ? wordPlace(previousAnchor, startsBefore, idsBefore) : null
      };
    }
    const keptPlace = keptWordPlaceRef.current;
    const words: ReaderWord[] = [];
    // Parallel to `words`: the block element each word sits in.
    const blocks: Array<Element | null> = [];
    const frames: HTMLIFrameElement[] = [];
    const sectionStarts: number[] = [];
    const sectionIds: number[] = [];
    const contentsList = rendition?.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document as Document | undefined;
      const iframe =
        (contents?.iframe as HTMLIFrameElement | undefined) ??
        (doc?.defaultView?.frameElement as HTMLIFrameElement | null);
      if (!doc?.body || !iframe) return;
      frames.push(iframe);
      sectionStarts.push(words.length);
      // A chapter epub.js gave no number matches none (NaN is never found).
      sectionIds.push(Number(contents?.sectionIndex ?? Number.NaN));
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && words.length < WORD_INDEX_LIMIT) {
        const textNode = node as Text;
        const parent = textNode.parentElement;
        const hidden =
          !parent ||
          Boolean(parent.closest("script, style, noscript, svg, [aria-hidden='true']")) ||
          parent.hidden;
        if (!hidden && textNode.data.trim()) {
          const block = parent.closest(READER_BLOCK_SELECTOR);
          const matches = Array.from(
            textNode.data.matchAll(READER_WORD_PATTERN)
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
    // A name being introduced, a word new to this chapter and a figure are
    // held longer in SpeedRead, less each time they come round again.
    noveltyHolds(words, isCommonWord).forEach((hold, index) => {
      if (hold > 0) {
        words[index].rsvpPauseMultiplier = Math.min(MAX_WORD_HOLD, words[index].rsvpPauseMultiplier + hold);
      }
    });
    const indexOfWord = (word: ReaderWord | undefined) =>
      word ? words.findIndex((entry) => entry.node === word.node && entry.start >= word.start) : -1;
    const activeNow = indexOfWord(activeWordBefore);
    // The text being read is still on the page (a new type size, a
    // re-render, or a neighbouring chapter loading or leaving).
    const sameText = activeNow >= 0;
    const smartSession = readingModeRef.current === "smart" ? smartSessionRef.current : null;
    if (smartSession && !sameText && smartSession.acceptedMs > 0) {
      // Smart Read went elsewhere by some other way than reading there: what
      // was read at Dotty's pace is kept (at the old text's difficulty), and
      // the pace is measured afresh below.
      learnPace(smartSession.acceptedWords, smartSession.acceptedMs, "guided");
    }
    // How hard this text reads sets its pace (easy text faster, dense text
    // slower); each word's own difficulty then spreads the time within it.
    sectionDifficultyRef.current = estimateTextDifficulty(words);
    sectionWordDifficultyRef.current =
      words.length > 0 ? words.reduce((sum, word) => sum + word.difficulty, 0) / words.length : 1;
    readingPaceScaleRef.current = {
      speed: getPaceScale(words, "speed"),
      smart: getPaceScale(words, "smart", sectionWordDifficultyRef.current)
    };
    readerWordsRef.current = words;
    wordFramesRef.current = frames;
    wordSectionStartsRef.current = sectionStarts;
    wordSectionIdsRef.current = sectionIds;
    // Each chapter's words, for the time left. An index cut short (a very
    // long page) says nothing true of its last chapter.
    if (words.length < WORD_INDEX_LIMIT) {
      sectionIds.forEach((id, at) => {
        const count = (sectionStarts[at + 1] ?? words.length) - sectionStarts[at];
        if (Number.isFinite(id) && count > 0) {
          sectionWordsRef.current.set(id, count);
        }
      });
    }
    // Re-indexing the same text must not move an RSVP or Smart Read position;
    // only going elsewhere starts over.
    const keepReadingPosition = readingModeRef.current !== "standard" && sameText;
    // A resize makes epub.js render the chapters again: the word being read
    // (or pinned) is there, but as a new node, and is found by its place in
    // its chapter. Smart Read used to carry on from 38% down the window, or
    // from the first word on the page.
    const refound = sameText ? -1 : indexOfPlace(keptPlace?.active ?? null, sectionStarts, sectionIds, words.length);
    let anchorNow = preserveUserAnchor ? indexOfWord(anchorWordBefore) : -1;
    if (anchorNow < 0 && Date.now() < readerDotUserAnchorUntilRef.current) {
      anchorNow = indexOfPlace(keptPlace?.anchor ?? null, sectionStarts, sectionIds, words.length);
    }
    // There was a word being read and it has left the page (its chapter was
    // let go, or the reader jumped elsewhere): reading goes on from what is
    // on screen. Its old number, kept, named some unrelated word.
    const lost = !sameText && refound < 0 && (previousWordCount > 0 || keptPlace !== null);
    const lastIndex = Math.max(0, words.length - 1);
    if (keepReadingPosition) {
      // One past the last word means "all of it is read": kept as that.
      activeWordIndexRef.current = Math.min(words.length, activeNow + (previousActive - previousActiveWord));
    } else {
      const nextIndex =
        anchorNow >= 0
          ? anchorNow
          : refound >= 0
            ? refound
            : (startAtViewport || lost) && words.length > 0
              ? findNearestWordIndex()
              : sameText
                ? activeNow
                : activeWordIndexRef.current;
      activeWordIndexRef.current = Math.min(Math.max(0, nextIndex), lastIndex);
    }
    readerDotAnchorIndexRef.current = Math.min(activeWordIndexRef.current, lastIndex);
    if (smartSession) {
      if (sameText) {
        // Where the reader and Dotty last agreed moved along with the rest.
        smartSession.anchorIndex = Math.max(0, smartSession.anchorIndex + (activeNow - previousActiveWord));
      } else {
        agreeWithReader(activeWordIndexRef.current);
      }
    }
    if (readingModeRef.current !== "standard" && words.length > 0) {
      setReadingWord(buildReadingWordState(Math.min(activeWordIndexRef.current, lastIndex)));
      if (readingModeRef.current === "smart") {
        positionReaderDotAtWord(readerDotAnchorIndexRef.current);
      }
    } else if (readerDotEnabledRef.current && words.length > 0) {
      if (readerDotElementRef.current) {
        // Dotty is already beside a line, and stays with it.
        refreshReaderDot(true);
      } else {
        window.requestAnimationFrame(() => positionReaderDotAtWord(activeWordIndexRef.current));
      }
    }
    updateOutlookRef.current();
  };

  /**
   * Whether the words indexed are still the ones on the page. Scrolling loads
   * the next chapter and lets go of those left behind, and the words of a
   * chapter that has gone have no place on screen.
   */
  const readerWordsStale = () => {
    const frames = wordFramesRef.current;
    const shown = (renditionRef.current?.getContents?.() ?? []).length;
    return shown !== frames.length || frames.some((frame) => !frame.isConnected);
  };

  /** Where, in the word index, the chapter a word is in starts and ends. */
  const sectionSpan = (index: number) => {
    const starts = wordSectionStartsRef.current;
    let at = 0;
    for (let i = 0; i < starts.length; i += 1) {
      if (starts[i] <= index) {
        at = i;
      }
    }
    return { start: starts[at] ?? 0, end: starts[at + 1] ?? readerWordsRef.current.length };
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

  // ---- reading pace ------------------------------------------------------------

  /** What the pace model needs to know about where the reader is. */
  const paceContext = () => ({
    bookId: book.id,
    genres: book.genres,
    difficulty: sectionDifficultyRef.current,
    timeBand: getReadingTimeBand(),
    now: Date.now()
  });

  const savePaceProfile = () => {
    if (paceSaveTimerRef.current) {
      window.clearTimeout(paceSaveTimerRef.current);
      paceSaveTimerRef.current = null;
    }
    void readingProfileService
      .save(paceProfileRef.current)
      .then((stored) => {
        // What was learned while the save was on its way is kept too.
        paceProfileRef.current = mergeProfiles(stored, paceProfileRef.current);
      })
      .catch(() => undefined);
  };
  savePaceProfileRef.current = savePaceProfile;

  const updatePaceProfile = (next: ReadingProfile) => {
    paceProfileRef.current = next;
    // Coalesced: an hour in Smart Read learns something every few minutes.
    paceSaveTimerRef.current ??= window.setTimeout(savePaceProfile, 5000);
  };

  /** Learns from a stretch of reading; pauses and skimming are left out (see paceModel). */
  const learnPace = (words: number, activeMs: number, source: PaceSource) => {
    const result = recordSample(
      paceProfileRef.current,
      {
        bookId: book.id,
        genres: book.genres,
        words,
        activeMs,
        difficulty: sectionDifficultyRef.current,
        timeBand: getReadingTimeBand(),
        at: new Date().toISOString(),
        source
      },
      paceStreakRef.current
    );
    paceStreakRef.current = result.streak;
    if (result.profile !== paceProfileRef.current) {
      updatePaceProfile(result.profile);
    }
  };

  /** The pace the model expects here, for telling a stop to think from reading. */
  const expectedWpm = () => predictWpm(paceProfileRef.current, paceContext(), { limited: false });

  /** A stop to think the trackers left out, counted for the pace card in Settings. */
  const countPause = () => updatePaceProfile(notePause(paceProfileRef.current, new Date().toISOString()));

  /** Free reading stopped (auto-scroll, another mode, another app, the book closing): keep what it taught. */
  const stopFreeReading = () => {
    const scrolled = scrollPaceRef.current.stop();
    if (scrolled) {
      learnPace(scrolled.words, scrolled.ms, "scroll");
    }
    const paged = pagePaceRef.current.stop();
    if (paged) {
      learnPace(paged.words, paged.ms, "pages");
    }
    pageShownRef.current = null;
  };
  stopFreeReadingRef.current = stopFreeReading;

  /**
   * Words per line of scrolling in this chapter: all its words over all its
   * height in lines, headings, pictures and paragraph gaps included, since
   * auto-scroll moves through those too. A screenful was a poor guide: the
   * top of a chapter is mostly heading. A wide window fits far more words on
   * a line than a narrow one.
   */
  const measureWordsPerLine = () => {
    const words = readerWordsRef.current;
    const container = ensureScrollContainer();
    if (!container || words.length < 50) {
      return null;
    }
    // The height of the chapters the words came from; the page may also hold
    // the empty place of a chapter that scrolled out of reach.
    const frames = wordFramesRef.current;
    const height = frames.reduce((sum, frame) => sum + frame.getBoundingClientRect().height, 0);
    const lines = Math.max(0, height - PAGE_TOP_PAD * frames.length) / linePx();
    const perLine = lines >= 4 ? words.length / lines : 0;
    return perLine >= 2 && perLine <= 60 ? perLine : null;
  };

  /** Auto-scroll's slider position for this reader's pace here, or null while that is unknown. */
  const autoScrollSpeedForPace = () => {
    const profile = paceProfileRef.current;
    if (readerPace(profile, Date.now()).minutes < 5 && !profile.books[book.id]) {
      return null;
    }
    const perLine = measureWordsPerLine();
    return perLine ? autoScrollSpeedForLines(predictWpm(profile, paceContext()) / perLine) : null;
  };

  /** The reader's own change to auto-scroll's speed: kept for this book, not overridden by the pace. */
  const tuneAutoScroll = (next: number | ((value: number) => number)) => {
    autoScrollTunedRef.current = true;
    autoScrollRunRef.current = { ms: 0, px: 0 };
    setAutoScrollSpeed(next);
  };

  /**
   * Auto-scroll left to run without a correction is a pace the reader keeps
   * up with: learned as Smart Read's is, counting for less than a measurement.
   */
  const commitAutoScrollRun = () => {
    const run = autoScrollRunRef.current;
    autoScrollRunRef.current = { ms: 0, px: 0 };
    const perLine = run.ms >= 60_000 ? measureWordsPerLine() : null;
    if (perLine) {
      learnPace(Math.round((run.px / linePx()) * perLine), run.ms, "guided");
    }
  };

  /** Words on the page showing now (layout "pages"), from where they sit on screen. */
  const countWordsOnPage = () => {
    const words = readerWordsRef.current;
    const view = viewerRef.current?.getBoundingClientRect();
    if (!view || words.length === 0) {
      return 0;
    }
    // Pages are columns laid side by side, so the words run left to right a
    // page at a time: the first word at or past each edge is found by halving.
    const firstFrom = (x: number) => {
      let low = 0;
      let high = words.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        const rect = getReaderWordRect(words[middle]);
        if (rect && rect.left + rect.width / 2 >= x) {
          high = middle;
        } else {
          low = middle + 1;
        }
      }
      return low;
    };
    return Math.max(0, firstFrom(view.right) - firstFrom(view.left));
  };

  /**
   * A page came up (layout "pages"). When it is the page after the last one,
   * the last one was read: its words over the time it was up. Going back, or
   * jumping from the chapter list, starts the count over.
   */
  const notePageShown = (location: any) => {
    const href = String(location?.start?.href ?? "");
    const page = Number(location?.start?.displayed?.page) || 0;
    const total = Number(location?.start?.displayed?.total) || 0;
    const previous = pageShownRef.current;
    pageShownRef.current = { href, page, total };
    if (!href || !page || awayRef.current) {
      return;
    }
    const now = Date.now();
    const forward =
      previous !== null &&
      now >= navigatingUntilRef.current &&
      ((previous.href === href && page === previous.page + 1) ||
        (previous.href !== href && page === 1 && previous.page >= previous.total));
    const key = `${href}#${page}`;
    const result = pagePaceRef.current.show(key, now, forward, expectedWpm());
    if (result.paused) {
      countPause();
    }
    if (result.sample) {
      learnPace(result.sample.words, result.sample.ms, "pages");
    }
    // Counted once the page's words are indexed (a new chapter is re-indexed).
    // A page of a picture or a title has too few to say anything.
    window.setTimeout(() => {
      const words = countWordsOnPage();
      if (words >= 20) {
        pagePaceRef.current.count(key, words);
      }
    }, 450);
  };
  notePageShownRef.current = notePageShown;

  // ---- Smart Read: the reader's own say ------------------------------------------

  const cancelSmartCatchUp = () => {
    if (smartCatchUpTimerRef.current) {
      window.clearTimeout(smartCatchUpTimerRef.current);
      smartCatchUpTimerRef.current = null;
    }
    smartReaderAheadRef.current = false;
  };

  /** Dotty's pace now, in words a minute through the chapter on screen. */
  const smartWpmNow = () => wpmFromPlain(paceProfileRef.current, smartPlainRef.current, paceContext());

  /**
   * The reader and Dotty agree on where the reading is: the reader's own pace
   * is measured from here, and the stretch read at Dotty's pace without a
   * correction starts over.
   */
  const agreeWithReader = (index: number) => {
    const session = smartSessionRef.current;
    if (!session) {
      return;
    }
    session.anchorIndex = index;
    session.anchorActiveMs = session.activeMs;
    session.acceptedWords = 0;
    session.acceptedMs = 0;
  };

  const moveSmartDotty = (index: number) => {
    const words = readerWordsRef.current;
    if (words.length === 0) {
      return;
    }
    const clamped = Math.min(words.length - 1, Math.max(0, index));
    activeWordIndexRef.current = clamped;
    readerDotAnchorIndexRef.current = clamped;
    agreeWithReader(clamped);
    positionReaderDotAtWord(clamped);
  };

  const stopWaitingForReread = () => {
    if (smartRereadRef.current) {
      smartRereadRef.current = false;
      setSmartWaiting(false);
    }
  };

  /**
   * The reader set Dotty's pace (the − and + controls, or a drag). It is used
   * at once and remembered as this book's pace, on every device.
   */
  const setSmartPace = (wpm: number) => {
    const profile = paceProfileRef.current;
    const context = paceContext();
    const limits = paceLimits(profile);
    const next = Math.round(Math.min(limits.maxWpm, Math.max(limits.minWpm, wpm)));
    smartPlainRef.current = plainFromWpm(profile, next, context);
    smartPaceFromModelRef.current = false;
    updatePaceProfile(
      setBookPace(profile, {
        bookId: book.id,
        genres: book.genres,
        wpm: next,
        difficulty: context.difficulty,
        timeBand: context.timeBand,
        at: new Date().toISOString()
      })
    );
    setSmartWpm(next);
    agreeWithReader(activeWordIndexRef.current);
    showFocusToast(
      wpm > limits.maxWpm + 1
        ? `That's Dotty's top speed, ${next} wpm. Raise it in Settings.`
        : wpm < limits.minWpm - 1
          ? `That's Dotty's slowest, ${next} wpm. Lower it in Settings.`
          : `Dotty: ${next} words a minute`
    );
  };

  const nudgeSmartPace = (factor: number) => {
    if (readingModeRef.current === "smart") {
      setSmartPace(smartWpmNow() * factor);
    }
  };
  nudgeSmartPaceRef.current = nudgeSmartPace;

  /** Space, or the play button: go on after a reread, otherwise pause or carry on. */
  const toggleSmartPlay = () => {
    if (smartRereadRef.current) {
      stopWaitingForReread();
      smartManualOverrideUntilRef.current = 0;
      readingPausedRef.current = false;
      setReadingPaused(false);
      return;
    }
    setReadingPaused((paused) => !paused);
  };
  toggleSmartPlayRef.current = toggleSmartPlay;

  /**
   * The reader read on past Dotty (it went off the top of the page). Dotty moves
   * to them, and when they were reading faster than it was going, takes up most
   * of their pace, which is learned too. Dotty used to crawl after them, capped
   * at a speed they had already passed, and never caught up.
   */
  const catchUpToReader = () => {
    smartCatchUpTimerRef.current = null;
    smartReaderAheadRef.current = false;
    const container = ensureScrollContainer();
    const session = smartSessionRef.current;
    if (!container || !session || readingModeRef.current !== "smart") {
      return;
    }
    // Dotty may have walked back into view by now, but the reader is still
    // further on. (Scrolling back to Dotty cancels this: see noteSmartScroll.)
    const area = readingArea(container);
    // A reader who scrolled on picks up near the top of what came into view.
    // It is a guess; dragging Dotty to the line puts it exactly.
    const line = readingBand(area).top + area.lineHeight / 2;
    const readerIndex = findNearestWordIndex(line / Math.max(1, container.clientHeight));
    if (readerIndex <= activeWordIndexRef.current) {
      return;
    }
    const dottyWpm = smartWpmNow();
    const read = readerIndex - session.anchorIndex;
    const activeMs = session.activeMs - session.anchorActiveMs;
    const verdict = judgeCatchUp({ words: read, activeMs, dottyWpm });
    if (verdict.kind === "faster") {
      // Most of the way; if that is still too slow, the next catch-up closes the rest.
      const reached = dottyWpm + (verdict.wpm - dottyWpm) * 0.8;
      smartPlainRef.current = plainFromWpm(paceProfileRef.current, reached, paceContext());
      smartPaceFromModelRef.current = false;
      learnPace(read, activeMs, "caught-up");
      const pace = Math.round(smartWpmNow());
      setSmartWpm(pace);
      showFocusToast(`You're ahead of Dotty. Speeding up to ${pace} wpm.`);
    } else {
      showFocusToast("Dotty caught up with you.");
    }
    moveSmartDotty(readerIndex);
  };

  /**
   * The reader scrolled in Smart Read. Dotty gone off the top means they read
   * on ahead of it: once the scrolling settles, Dotty catches up. Dotty gone
   * off the bottom means they went back to reread: Dotty waits for them, and
   * the wait is not counted as reading slowly.
   */
  const noteSmartScroll = () => {
    const container = ensureScrollContainer();
    const word = readerWordsRef.current[activeWordIndexRef.current];
    const rect = word ? getReaderWordRect(word) : null;
    if (!container || !rect || !smartSessionRef.current) {
      return;
    }
    const area = readingArea(container);
    const lineTop = rect.top - container.getBoundingClientRect().top;
    // Dotty's line not wholly in view at the top is behind the reader: the same
    // test the page steps use, so the two never pull the page opposite ways.
    if (lineTop < area.topInset) {
      stopWaitingForReread();
      smartReaderAheadRef.current = true;
      if (smartCatchUpTimerRef.current) {
        window.clearTimeout(smartCatchUpTimerRef.current);
      }
      smartCatchUpTimerRef.current = window.setTimeout(catchUpToReader, 1500);
      return;
    }
    cancelSmartCatchUp();
    if (lineTop > area.height - area.bottomInset) {
      if (!smartRereadRef.current) {
        smartRereadRef.current = true;
        setSmartWaiting(true);
      }
    } else if (smartRereadRef.current) {
      // Back at Dotty: carry on, after a moment to find the line.
      stopWaitingForReread();
      smartStepHoldUntilRef.current = Date.now() + 700;
    }
  };

  /**
   * The reader dragged Dotty in Smart Read. Ahead: they are further on than
   * Dotty, and it takes up their pace if they were faster. Back a line or two:
   * Dotty was a little fast. Back further: rereading, or picking up after a
   * pause, which says nothing about the pace.
   */
  const noteSmartDrag = (from: number, to: number) => {
    const session = smartSessionRef.current;
    if (!session) {
      return;
    }
    cancelSmartCatchUp();
    stopWaitingForReread();
    const delta = to - from;
    if (delta >= 10) {
      const dottyWpm = smartWpmNow();
      const verdict = judgeCatchUp({
        words: to - session.anchorIndex,
        activeMs: session.activeMs - session.anchorActiveMs,
        dottyWpm
      });
      if (verdict.kind === "faster") {
        setSmartPace(dottyWpm + (verdict.wpm - dottyWpm) * 0.6);
      }
    } else if (delta <= -10 && delta >= -40) {
      setSmartPace(smartWpmNow() / 1.06);
    }
    agreeWithReader(to);
  };

  const observeManualReadingPosition = () => {
    if (Date.now() < programmaticScrollUntilRef.current) {
      return;
    }
    if (readerWordsStale()) {
      prepareReaderWords(false);
    }
    if (readerWordsRef.current.length === 0) {
      return;
    }
    const mode = readingModeRef.current;
    if (mode === "smart") {
      noteSmartScroll();
      return;
    }
    const index = findNearestWordIndex();
    if (mode === "speed") {
      activeWordIndexRef.current = index;
      setReadingWord(buildReadingWordState(index));
      return;
    }
    // Free reading teaches the pace. Not while auto-scroll moves the page (that
    // is its pace, not the reader's), and a jump elsewhere starts over.
    if (autoScrollActiveRef.current || awayRef.current || layoutRef.current === "pages") {
      return;
    }
    if (Date.now() < navigatingUntilRef.current) {
      stopFreeReading();
      return;
    }
    // Counted within the chapter the line is in: chapters above come and go,
    // which renumbers every word on the page.
    const section = readerWordsRef.current[index]?.node.ownerDocument ?? null;
    const result = scrollPaceRef.current.observe(index - sectionSpan(index).start, Date.now(), section, expectedWpm());
    if (result.paused) {
      countPause();
    }
    if (result.sample) {
      learnPace(result.sample.words, result.sample.ms, "scroll");
    }
  };

  /**
   * The chapter on screen that a place belongs to. Scrolling shows several
   * chapters at once, and a place resolved in the wrong one lands on some
   * unrelated line of it rather than nowhere.
   */
  const contentsForCfi = (cfi: string): any[] => {
    const list: any[] = renditionRef.current?.getContents?.() ?? [];
    if (list.length <= 1) {
      return list;
    }
    try {
      const spinePos = (new EpubCFI(cfi) as unknown as { spinePos?: number }).spinePos;
      const own = list.filter((contents) => contents?.sectionIndex === spinePos);
      return own.length > 0 ? own : list;
    } catch {
      return list;
    }
  };

  // ---- where the reader is ------------------------------------------------------

  /** The chapters on the page, top to bottom (scrolling shows several at once). */
  const displayedViews = (): any[] => {
    const views = ((renditionRef.current?.manager as any)?.views?._views ?? []) as any[];
    return views.filter((view) => view?.displayed && view?.element?.isConnected);
  };

  /** The chapter the reading line is in, and where in it (readers/readingPlace.ts). Scrolling only. */
  const readingLine = () => {
    const container = (renditionRef.current?.manager as any)?.container as HTMLElement | undefined;
    if (!container) {
      return null;
    }
    const box = container.getBoundingClientRect();
    const views = displayedViews();
    const boxes = views.map((view) => {
      const rect = (view.element as HTMLElement).getBoundingClientRect();
      return { top: rect.top - box.top, height: rect.height };
    });
    const found = readingLineIn(boxes, PAGE_TOP_PAD, container.clientHeight);
    return found ? { view: views[found.index], height: boxes[found.index].height, start: found.start, end: found.end } : null;
  };

  /**
   * The place being read, as a CFI: the first line clear of the toolbar, which
   * is where a place gone to is put (`clearToolbar`), so going back lands on
   * the very line that was left. With pages, the page's first line.
   */
  const readingPlaceCfi = (): string | null => {
    const rendition = renditionRef.current;
    const fallback: string | null = rendition?.location?.start?.cfi ?? null;
    if (!rendition || layoutRef.current !== "scroll") {
      return fallback;
    }
    try {
      const mapping = (rendition.manager as any)?.mapping;
      const line = readingLine();
      if (!line?.view?.contents || typeof mapping?.page !== "function") {
        return fallback;
      }
      const mapped = mapping.page(line.view.contents, line.view.section.cfiBase, line.start, line.end);
      return typeof mapped?.start === "string" ? mapped.start : fallback;
    } catch {
      return fallback;
    }
  };

  /** The section being read (its spine index), and how far through it the reading line is. */
  const sectionPlace = (): { section: number; within: number } | null => {
    const location = renditionRef.current?.location;
    const index = location?.start?.index;
    if (layoutRef.current === "scroll") {
      const line = readingLine();
      if (line && typeof line.view?.section?.index === "number") {
        return { section: line.view.section.index, within: Math.min(1, Math.max(0, line.start / Math.max(1, line.height))) };
      }
    }
    if (typeof index !== "number") {
      return null;
    }
    const page = Number(location?.start?.displayed?.page) || 1;
    const total = Number(location?.start?.displayed?.total) || 1;
    return { section: index, within: Math.min(1, Math.max(0, (page - 1) / total)) };
  };

  /**
   * How far through the book, and how long is left in the chapter and the
   * book at this reader's pace (readers/timeLeft.ts). Nothing is said of time
   * until there is a pace to go on: this book's own, or five minutes of
   * reading anywhere.
   */
  const updateOutlook = () => {
    const weights = sectionWeightsRef.current;
    const place = sectionPlace();
    const profile = paceProfileRef.current;
    const paceKnown = Boolean(profile.books[book.id]) || readerPace(profile, Date.now()).minutes >= 5;
    let chapter: number | null = null;
    let whole: number | null = null;
    const ratio = weights ? wordsPerByte(sectionWordsRef.current, weights.bytes, wordRatioRef.current) : null;
    if (ratio) {
      wordRatioRef.current = ratio;
    }
    if (weights && place && ratio && paceKnown && place.section < weights.bytes.length) {
      const left = wordsLeft({
        weights,
        section: place.section,
        within: place.within,
        chapterEnd: chapterEndFor(place.section, tocSpineStartsRef.current, weights.bytes.length - 1),
        counted: sectionWordsRef.current,
        ratio: ratio.ratio
      });
      const wpm = predictWpm(profile, paceContext(), { limited: false });
      const chapterMinutes = minutesFor(left.chapter, wpm);
      const bookMinutes = left.book === null ? null : minutesFor(left.book, wpm);
      chapter = chapterMinutes === null ? null : steadyMinutes(shownMinutesRef.current.chapter, chapterMinutes);
      whole = bookMinutes === null ? null : steadyMinutes(shownMinutesRef.current.book, bookMinutes);
    }
    shownMinutesRef.current = { chapter, book: whole };
    // Within the story, by the reading line: the bar's handle then sits
    // exactly where a place it went to is. Front and back matter show what
    // the book's progress is (they do not move it).
    const progress =
      weights && place && place.section >= weights.lo && place.section <= weights.hi
        ? fractionAt(weights, place.section, place.within)
        : (lastCfiProgressRef.current ?? (lastComputedProgressRef.current >= 0 ? lastComputedProgressRef.current : null));
    const percent = (value: number | null) => (value === null ? null : Math.round(value * 100));
    setOutlook((shown) =>
      shown.chapter === chapter && shown.book === whole && percent(shown.progress) === percent(progress)
        ? shown
        : { progress, chapter, book: whole }
    );
  };
  updateOutlookRef.current = updateOutlook;

  // ---- back to where you were -------------------------------------------------------

  const applyJumps = (next: JumpHistory) => {
    jumpsRef.current = next;
    setJumps({ back: next.back.length, forward: next.forward.length });
  };

  /**
   * The reader is about to be taken elsewhere (a link, a chapter from the
   * list, a search result, a bookmark, the progress bar): the line being left
   * is kept, and the dock wakes for a moment to offer the way back. Called
   * before the jump, while the place is still on the page.
   */
  const noteJumpFromHere = () => {
    // Going elsewhere: a note shown here has nothing more to say.
    noteRequestRef.current += 1;
    setNote(null);
    const before = jumpsRef.current;
    const next = noteJump(before, readingPlaceCfi());
    if (next === before) {
      return;
    }
    applyJumps(next);
    setDockAwake(true);
    if (dockAwakeTimerRef.current) {
      window.clearTimeout(dockAwakeTimerRef.current);
    }
    dockAwakeTimerRef.current = window.setTimeout(() => {
      dockAwakeTimerRef.current = null;
      setDockAwake(false);
    }, 6000);
  };

  /** Goes to a place and brings it down clear of the toolbar: bookmarks, highlights, back and forward. */
  const goToPlace = (cfi: string) => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    // Jumping elsewhere invalidates a pinned Dotty. Without this the pin
    // survives and prepareReaderWords rescales it proportionally into the new
    // section, dropping Dotty at an unrelated line.
    releaseUserReadingAnchor();
    markNavigating();
    void rendition.display(cfi).then(
      () => {
        if (renditionRef.current === rendition) {
          clearToolbar();
          settleOnPage(cfi);
        }
      },
      () => undefined
    );
  };

  /**
   * With pages, epub.js finds a place's page from where its first character
   * is drawn. A page that starts in the middle of a paragraph is named by the
   * space that ended the line before, which is drawn on the page before: the
   * place came back a page early. The page shown is the one holding the first
   * word after the place.
   */
  const settleOnPage = (cfi: string) => {
    const rendition = renditionRef.current;
    const manager = rendition?.manager as any;
    const container = manager?.container as HTMLElement | undefined;
    const pageWidth = Number(manager?.layout?.delta) || 0;
    if (layoutRef.current !== "pages" || !container || pageWidth <= 0 || manager?.settings?.direction === "rtl") {
      return;
    }
    try {
      for (const contents of contentsForCfi(cfi)) {
        const range = contents.range(cfi) as Range | null;
        const node = range?.startContainer;
        const frame = contents?.document?.defaultView?.frameElement as HTMLElement | null;
        if (!range || !node || node.nodeType !== 3 || !frame) {
          continue;
        }
        const text = (node as Text).data;
        let at = range.startOffset;
        while (at < text.length && /\s/.test(text[at])) {
          at += 1;
        }
        if (at >= text.length) {
          continue;
        }
        const word = (node.ownerDocument as Document).createRange();
        word.setStart(node, at);
        word.setEnd(node, at + 1);
        const left =
          frame.getBoundingClientRect().left + word.getBoundingClientRect().left - container.getBoundingClientRect().left + container.scrollLeft;
        const target = Math.floor((left + 1) / pageWidth) * pageWidth;
        if (Math.abs(target - container.scrollLeft) > 1) {
          manager.scrollTo(target, 0, true);
          void rendition.reportLocation?.();
        }
        return;
      }
    } catch {
      // The page epub.js chose stands.
    }
  };

  const goBack = () => {
    const step = stepBack(jumpsRef.current, readingPlaceCfi());
    if (step) {
      applyJumps(step.history);
      goToPlace(step.target);
    }
  };
  const goForward = () => {
    const step = stepForward(jumpsRef.current, readingPlaceCfi());
    if (step) {
      applyJumps(step.history);
      goToPlace(step.target);
    }
  };
  goBackRef.current = goBack;
  goForwardRef.current = goForward;

  /**
   * A link within the book was clicked (from the book's own documents, bound
   * once). It is a jump like any other: the line left is kept, and the place
   * is gone to the reader's way, clear of the toolbar. epub.js's own handling
   * went to the very top of the window, and in the scrolling layout showed a
   * neighbouring section for a link into the middle of a file.
   */
  followBookLinkRef.current = (anchor, sectionIndex) => {
    const epub = bookRef.current as any;
    const section = typeof sectionIndex === "number" ? epub?.spine?.get?.(sectionIndex) : null;
    const link = resolveBookLink(anchor.getAttribute("href") ?? "", String(section?.href ?? ""));
    const targetSection = link ? epub?.spine?.get?.(link.path) : null;
    if (!link || !targetSection) {
      return;
    }
    const jump = () => {
      noteJumpFromHere();
      displayChapter(link.href, { useSaved: false });
    };
    if (!link.id) {
      jump();
      return;
    }
    // A note reference shows its note here instead of leaving the page
    // (readers/footnotes.ts); anything else is a jump, as it always was.
    const facts = linkFacts(anchor);
    const request = (noteRequestRef.current += 1);
    const show = (target: Element | null) => {
      if (request !== noteRequestRef.current || bookRef.current !== epub) {
        return;
      }
      const isNote = target !== null && classifyNoteLink({ ...facts, target: targetFacts(target) }) === "note";
      const text = isNote && target ? noteText(noteBlockOf(target)) : null;
      if (!text || text.paragraphs.length === 0) {
        jump();
        return;
      }
      if (selectionRef.current) {
        clearSelectionRef.current();
      }
      setNote({ href: link.href, marker: facts.text.trim(), ...text });
    };
    try {
      if (targetSection.index === sectionIndex) {
        show(elementById(anchor.ownerDocument, link.id));
        return;
      }
      // Another file: on the page already (scrolling shows several chapters),
      // or read through epub.js and let go again.
      const shown = (renditionRef.current?.manager as any)?.views?.find?.(targetSection)?.contents?.document as Document | undefined;
      if (shown) {
        show(elementById(shown, link.id));
        return;
      }
      void Promise.resolve(targetSection.load(epub.load.bind(epub)))
        .then(
          (root: Element | undefined) => {
            const doc: Document | undefined = targetSection.document ?? root?.ownerDocument;
            show(doc ? elementById(doc, link.id) : null);
          },
          () => show(null)
        )
        .then(() => {
          try {
            targetSection.unload?.();
          } catch {
            // Already let go.
          }
        });
    } catch {
      jump();
    }
  };
  closeNoteRef.current = () => {
    noteRequestRef.current += 1;
    setNote(null);
  };
  const goToNote = () => {
    const open = noteRef.current;
    if (!open) {
      return;
    }
    noteJumpFromHere();
    displayChapter(open.href, { useSaved: false });
  };

  // ---- pictures ---------------------------------------------------------------------

  openPictureRef.current = (found) => {
    closeNoteRef.current();
    setPicture(found);
  };
  /** "Show as drawn" / "Blend with page", from the viewer: every copy of the picture on the page. */
  const togglePictureInk = () => {
    const open = pictureRef.current;
    if (!open) {
      return;
    }
    const docs = ((renditionRef.current?.getContents?.() ?? []) as any[])
      .map((contents) => contents?.document as Document | undefined)
      .filter((doc): doc is Document => Boolean(doc));
    setInkOff(docs, open.src, !open.inkOff);
    setPicture({ ...open, inkOff: !open.inkOff });
  };

  // ---- anywhere in the book ------------------------------------------------------------

  /** The chapter a fraction of the book falls in, for the progress bar's label. */
  const chapterAtFraction = (fraction: number) => {
    const weights = sectionWeightsRef.current;
    return weights ? chapterOfSection(seekTarget(weights, fraction).section) : null;
  };

  /**
   * Goes to a fraction of the way through the book (the progress bar): the
   * section it falls in by the sections' sizes, then as far through that
   * section, by its height on the page or by its pages. A jump like any
   * other: Back returns.
   */
  const seekTo = (fraction: number) => {
    const weights = sectionWeightsRef.current;
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    if (!weights || !rendition) {
      return;
    }
    const { section, within } = seekTarget(weights, fraction);
    const target = epub?.spine?.get?.(section);
    if (!target?.href) {
      return;
    }
    noteJumpFromHere();
    releaseUserReadingAnchor();
    progressArmedRef.current = true;
    markNavigating();
    void rendition
      .display(target.href)
      .then(() => {
        if (renditionRef.current !== rendition) {
          return;
        }
        const manager = rendition.manager as any;
        if (layoutRef.current === "pages") {
          const container = manager?.container as HTMLElement | undefined;
          const pageWidth = Number(manager?.layout?.delta) || 0;
          if (!container || pageWidth <= 0 || manager?.settings?.direction === "rtl") {
            return;
          }
          const pages = Math.max(1, Math.round(container.scrollWidth / pageWidth));
          const page = Math.min(pages - 1, Math.floor(within * pages));
          if (page > 0) {
            manager.scrollTo(page * pageWidth, 0, true);
            void rendition.reportLocation?.();
          }
          return;
        }
        const container = ensureScrollContainer();
        if (!container) {
          return;
        }
        // The chapter's frame is found again each time: the one above it
        // takes its real height a moment after it loads.
        const place = () => {
          const element = manager?.views?.find?.(target)?.element as HTMLElement | undefined;
          if (!element || renditionRef.current !== rendition) {
            return;
          }
          container.scrollTop = Math.max(element.offsetTop, element.offsetTop + within * element.offsetHeight - PAGE_TOP_PAD);
        };
        place();
        requestAnimationFrame(place);
        window.setTimeout(place, 250);
      })
      .catch(() => undefined);
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
    const contentsList = contentsForCfi(cfi);
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
            lineTop + container.scrollTop + rect.height / 2 - DOT_SIZE / 2,
            6,
            Math.max(6, container.scrollHeight - 10)
          ),
          left: trackLeft
        };

        moveReaderDot(ensureReaderDot(container), container, target.top, target.left);
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
    cancelSmartPageTurn();
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

  /**
   * Dotty sits in the scrolling container at a height in the book. When the
   * chapters under it went (a jump elsewhere), it stayed where it had been,
   * which could be far below the end of what the page now holds: the page
   * then scrolled on into blank space down to it, and epub.js, taking that
   * for text still to come, did not fetch the next chapter. It waits out of
   * the way until it is placed again.
   */
  const tuckAwayStrandedDot = (container: HTMLElement) => {
    const dot = readerDotElementRef.current;
    if (!dot || dot.parentElement !== container) {
      return;
    }
    const chapterEnds = Array.from(container.children)
      .filter((child) => child !== dot)
      .map((child) => (child as HTMLElement).offsetTop + (child as HTMLElement).offsetHeight);
    if (!dotIsStranded(dot.offsetTop + dot.offsetHeight, chapterEnds)) {
      return;
    }
    dot.style.transition = "none";
    dot.style.top = `${-4 * DOT_SIZE}px`;
    dot.style.opacity = "0";
    void dot.offsetWidth;
    dot.style.transition = "";
  };

  /**
   * The text moved under Dotty (a resize, a new type size or line length):
   * Dotty follows it. RSVP has no Dotty (repositioning here used to recreate
   * it), and an unpinned Dotty in standard mode follows the last visible line,
   * not a word. That follow waits for scrolling to settle; `now` is for a
   * change the reader just made, which should not leave Dotty stranded for
   * two seconds.
   */
  const refreshReaderDot = (now = false) => {
    const mode = readingModeRef.current;
    if (!readerDotEnabledRef.current || readerWordsRef.current.length === 0 || mode === "speed") {
      return;
    }
    const pinned = Date.now() < readerDotUserAnchorUntilRef.current;
    if (mode === "smart" || pinned) {
      positionReaderDotAtWord(readerDotAnchorIndexRef.current ?? activeWordIndexRef.current);
      return;
    }
    const location = renditionRef.current?.location;
    const cfi = location?.end?.cfi ?? location?.start?.cfi;
    if (now && mode === "standard" && cfi) {
      updateLastReadMarker(cfi);
    } else {
      scheduleReaderDotUpdate();
    }
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

  /**
   * Scrolling is one continuous book: epub.js adds the next chapter below the
   * one being read as its end comes near, and lets go of chapters left far
   * behind. This asks it to look again, for when the end was reached without
   * the scrolling that makes it look.
   */
  const loadFurther = () => {
    const manager = renditionRef.current?.manager as any;
    try {
      manager?.q?.enqueue?.(() => manager.check?.());
    } catch {
      // The book is closing.
    }
  };

  /** Whether the book goes on after the last chapter on the page. */
  const hasFurtherSection = () =>
    Boolean((renditionRef.current?.manager as any)?.views?.last?.()?.section?.next?.());

  /** Where a chapter on the page starts, in the scrolling container. */
  const sectionTop = (href: string) => {
    const manager = renditionRef.current?.manager as any;
    const section = (bookRef.current as any)?.spine?.get?.(href);
    const element = (section ? manager?.views?.find?.(section) : null)?.element as HTMLElement | undefined;
    return element ? element.offsetTop : null;
  };

  /**
   * The bottom of what is loaded was reached. This used to swap the chapter
   * for the next one, before its last lines (at the very bottom of the
   * window) had been read; now the next chapter simply follows on below.
   */
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
    loadFurther();
  };

  const persistReaderState = (override?: Partial<{
    cfi: string;
    cfiProgress: number;
    chapterPositions: Record<string, string>;
  }>) => {
    // A look at a highlight leaves the saved place as it was (see storedPlaceRef).
    const place = placeFollowsNow()
      ? {
          cfi: override?.cfi ?? lastCfiRef.current ?? undefined,
          cfiProgress: override?.cfiProgress ?? lastCfiProgressRef.current ?? undefined,
          chapterPositions: override?.chapterPositions ?? chapterPositionsRef.current
        }
      : storedPlaceRef.current;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          fontSize: fontSizeRef.current,
          sidebarOpen: sidebarRef.current,
          displayMode: displayModeRef.current,
          autoScrollSpeed: autoScrollSpeedRef.current,
          autoScrollTuned: autoScrollTunedRef.current,
          speedReadWpm: speedReadWpmRef.current,
          readerDotEnabled: readerDotEnabledRef.current,
          wordsPerByte: wordRatioRef.current ?? undefined,
          ...place
        })
      );
    } catch {
      // ignore
    }
  };


  const addBookmark = () => {
    const location = renditionRef.current?.location;
    // The line under the toolbar, which is where an opened bookmark is put.
    const cfi = readingPlaceCfi() ?? location?.start?.cfi;
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
  addBookmarkRef.current = addBookmark;

  // ---- highlights and notes --------------------------------------------------

  /** Highlights in reading order, for the notes panel and the export. */
  /** A page sliding across: its frame, where it is going, and the chapter it is sliding in. */
  const pageSlideRef = useRef<{ frame: number; target: number; view: unknown } | null>(null);
  /**
   * Until then, a turn into another chapter is on its way. Turns made
   * meanwhile used to be handed to epub.js one after another (the new chapter
   * has no pages to count yet): a held arrow key ran on through the pages, and
   * past short chapters unseen, after it was let go, by epub.js's own "next"
   * with its skipped last page. They are dropped; a time, not a flag, so a
   * turn that never arrives cannot stop the pages for good.
   */
  const chapterTurnUntilRef = useRef(0);
  /**
   * Turns a page (layout "pages"). Through a ref, for the key handler bound
   * once. The page to turn to is worked out here (readers/pageTurn.ts):
   * epub.js's own "next" skipped the last page of a chapter. Within a chapter
   * the page slides across; into another chapter, the new page comes in from
   * the side.
   */
  const turnPage = (direction: 1 | -1) => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    lastHandsOnAtRef.current = Date.now();
    if (Date.now() < chapterTurnUntilRef.current) {
      return;
    }
    const manager = rendition.manager as any;
    const container = manager?.container as HTMLElement | undefined;
    const pageWidth = Number(manager?.layout?.delta) || 0;
    if (!container || pageWidth <= 0 || typeof manager?.scrollTo !== "function") {
      void (direction > 0 ? rendition.next() : rendition.prev());
      return;
    }
    // The chapter the pages are counted in. A slide belongs to the chapter it
    // started in: once that has been swapped (a jump from the chapter list, a
    // resize), where it was going means nothing in the one now on the page.
    const view = manager.views?.first?.();
    // A turn made while the last is still sliding starts from where that one was going.
    const pending = pageSlideRef.current;
    const sliding = pending && pending.view === view ? pending : null;
    if (pending) {
      window.cancelAnimationFrame(pending.frame);
      pageSlideRef.current = null;
    }
    if (sliding) {
      manager.scrollTo(sliding.target, 0, true);
    }
    const from = sliding ? sliding.target : container.scrollLeft;
    const target = pageTurnTarget(from, pageWidth, container.scrollWidth, direction);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (target === null) {
      const edge = direction > 0 ? manager.views?.last?.() : manager.views?.first?.();
      const beyond = direction > 0 ? edge?.section?.next?.() : edge?.section?.prev?.();
      if (!beyond) {
        // The first or the last page of the book.
        return;
      }
      const viewer = viewerRef.current;
      if (viewer && !reduced) {
        viewer.dataset.turn = "out";
      }
      chapterTurnUntilRef.current = Date.now() + 4000;
      const shown = () => {
        chapterTurnUntilRef.current = 0;
        if (!viewer || viewer.dataset.turn !== "out") {
          return;
        }
        viewer.dataset.turn = direction > 0 ? "next" : "prev";
        window.setTimeout(() => {
          if (viewer.dataset.turn !== "out") {
            delete viewer.dataset.turn;
          }
        }, 340);
      };
      void Promise.resolve(direction > 0 ? rendition.next() : rendition.prev()).then(shown, shown);
      return;
    }
    const duration = pageTurnDuration(reduced);
    if (duration === 0) {
      manager.scrollTo(target, 0, true);
      void rendition.reportLocation?.();
      return;
    }
    let startedAt: number | null = null;
    const step = (time: number) => {
      if (renditionRef.current !== rendition || manager.views?.first?.() !== view) {
        // Another chapter took the page mid-slide (or the book closed): the
        // slide used to carry on in it, and it opened some pages in.
        pageSlideRef.current = null;
        return;
      }
      startedAt ??= time;
      const progress = Math.min(1, (time - startedAt) / duration);
      // Quietly: the place is reported once, when the page has arrived.
      manager.scrollTo(from + (target - from) * easeInOutCubic(progress), 0, true);
      if (progress < 1) {
        pageSlideRef.current = { frame: window.requestAnimationFrame(step), target, view };
        return;
      }
      pageSlideRef.current = null;
      void rendition.reportLocation?.();
    };
    pageSlideRef.current = { frame: window.requestAnimationFrame(step), target, view };
  };
  const turnPageRef = useRef(turnPage);
  turnPageRef.current = turnPage;

  // One whose place cannot be read comes last (see orderHighlights): settled
  // pair by pair, it scrambled the order of the rest.
  const orderedHighlights = useMemo(() => {
    const cfi = new EpubCFI();
    return orderHighlights(highlights, (a, b) => cfi.compare(a, b));
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
    // One mark per place: two highlights of the same words share it (see
    // readers/highlightDraws.ts).
    const plan = planHighlightDraws(
      applied,
      Array.from(wanted, ([key, item]) => ({ key, cfi: item.cfi }))
    );
    plan.remove.forEach((key) => {
      const cfi = applied.get(key);
      if (cfi !== undefined) {
        try {
          rendition.annotations.remove(cfi, "highlight");
        } catch {
          // Already gone with its section.
        }
      }
      applied.delete(key);
    });
    plan.draw.forEach((key) => {
      const item = wanted.get(key);
      if (!item) {
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
        } else {
          // Where it went, for a reader who has not yet found the list.
          showFocusToast("Highlighted. Your highlights are under the bookmark icon.", 3200);
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
  // A click elsewhere in the text lets a selection go, and the offer to
  // highlight it must go too. It used to stay, out of sight, and auto-scroll
  // and Smart Read waited on it for good while still showing their pace.
  selectionChangedRef.current = () => {
    if (!selectionRef.current) {
      return;
    }
    const stillSelected = (renditionRef.current?.getContents?.() ?? []).some((contents: any) => {
      const picked = contents?.window?.getSelection?.();
      return Boolean(picked && !picked.isCollapsed && String(picked).trim());
    });
    if (!stillSelected) {
      setSelection(null);
    }
  };
  // What hands-free reading is waiting on, in words for its controls: they
  // must never show a pace while nothing is moving.
  const holdReason =
    selection !== null
      ? "Text is selected · Esc lets it go"
      : searchOpen
        ? "Search is open"
        : bookmarkPanelOpen
          ? "Notes are open"
          : sidebarOpen
            ? "Chapters are open"
            : tourOpen
              ? "The walkthrough is open"
              : fontPanelOpen
                ? "Text settings are open"
                : note !== null
                  ? "A note is open"
                  : picture !== null
                    ? "A picture is open"
                    : shortcutsOpen
                      ? "Keyboard shortcuts are open"
                      : people.cardOpen || people.panelOpen
                        ? "Characters are open"
                        : null;
  // Anything over the text (a selection, search, notes, the chapter list, a
  // dialog) makes auto-scroll and Smart Read wait; they carry on by themselves
  // once it is gone.
  interruptedRef.current =
    selection !== null ||
    searchOpen ||
    bookmarkPanelOpen ||
    sidebarOpen ||
    tourOpen ||
    fontPanelOpen ||
    note !== null ||
    picture !== null ||
    shortcutsOpen ||
    people.cardOpen ||
    people.panelOpen ||
    pendingReadingMode !== null;

  // ---- Escape closes the nearest thing first ---------------------------------------
  // The order is readers/escapeOrder.ts; this says what is open and how each
  // closes. Anything new laid over the text belongs in both lists here and in
  // `interruptedRef` above.
  const lookUpShowing = selection !== null && lookUpCfi === selection.cfi;
  escapeRef.current = (event) => {
    const layer = escapeTarget({
      picture: picture !== null,
      shortcuts: shortcutsOpen,
      startDialog: pendingReadingMode !== null,
      tour: tourOpen,
      seek: seekHoldRef.current?.held() ?? false,
      character: people.cardOpen,
      lookup: lookUpShowing,
      note: note !== null,
      search: searchOpen,
      typePanel: fontPanelOpen,
      notesPanel: bookmarkPanelOpen,
      moreMenu: morePanelOpen,
      sidePanel: people.panelOpen,
      chapters: sidebarOpen,
      selection: selection !== null,
      speedRead: readingMode === "speed",
      playing: (readingMode === "standard" && autoScrollActive) || (readingMode === "smart" && !readingPaused)
    });
    if (layer === "exit") {
      // The same held key that just closed something does not go on to leave the book.
      if (event.repeat && escapeClosedLayerRef.current) {
        return;
      }
      escapeClosedLayerRef.current = false;
      exitGuard.escape(event);
      return;
    }
    event.preventDefault();
    if (event.repeat) {
      return;
    }
    escapeClosedLayerRef.current = true;
    switch (layer) {
      case "picture":
        setPicture(null);
        break;
      case "shortcuts":
        setShortcutsOpen(false);
        break;
      case "startDialog":
        setPendingReadingMode(null);
        setReadingPaused(false);
        break;
      case "tour":
        spotlightDotty(-1);
        setTourOpen(false);
        break;
      case "seek":
        seekHoldRef.current?.letGo();
        break;
      case "character":
        people.closeCard();
        break;
      case "lookup":
        setLookUpCfi(null);
        break;
      case "note":
        closeNoteRef.current();
        break;
      case "search":
        closeSearch();
        break;
      case "typePanel":
        setFontPanelOpen(false);
        break;
      case "notesPanel":
        setBookmarkPanelOpen(false);
        break;
      case "moreMenu":
        setMorePanelOpen(false);
        break;
      case "sidePanel":
        people.closePanel();
        break;
      case "chapters":
        setSidebarOpen(false);
        break;
      case "selection":
        clearSelection();
        break;
      case "speedRead":
        requestReadingMode("standard");
        break;
      case "playing":
        if (readingMode === "standard") {
          setAutoScrollActive(false);
        } else {
          setReadingPaused(true);
        }
        break;
      default:
        break;
    }
  };

  /** "Search in this book", from the selection bar: the search panel opens on the selected words. */
  const searchBookFor = (text: string) => {
    setSearchSeed(text);
    clearSelection();
    setSearchOpen(true);
  };

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

  /**
   * epub.js puts a place it goes to at the very top of the window, and the
   * toolbar floats over the top 76px: a search result (the toolbar stays up
   * while search is open) or a highlight opened from the notes arrived
   * underneath it. The place comes down below it, as a reopened book's does.
   * Scrolling only: a page starts below the toolbar anyway.
   */
  const clearToolbar = () => {
    const container = layoutRef.current === "scroll" ? ensureScrollContainer() : null;
    if (container) {
      container.scrollTop = Math.max(0, container.scrollTop - PAGE_TOP_PAD);
    }
  };

  const searchMarkRef = useRef<{ cfi: string; timer: number } | null>(null);
  /** Jumps to a search result and marks the words there for a few seconds. */
  const openSearchHit = (hit: SearchHit) => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    noteJumpFromHere();
    releaseUserReadingAnchor();
    markNavigating();
    void rendition.display(hit.cfi).then(() => {
      if (renditionRef.current !== rendition) {
        return;
      }
      clearToolbar();
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
    // Going elsewhere: the word that was being read is not looked for again
    // when its chapter comes back onto the page beside the new place.
    wordSectionIdsRef.current = [];
    keptWordPlaceRef.current = null;
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
    noteJumpFromHere();
    goToPlace(cfi);
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
    // With pages epub.js finds the anchor's page itself, and there is no
    // scroll position to set afterwards.
    const paged = layoutRef.current === "pages";
    const fileTarget = !useSaved && !paged && target.includes("#") ? target.slice(0, target.indexOf("#")) : target;
    markNavigating();
    void rendition
      .display(fileTarget)
      .then(() => {
        if (useSaved || paged) {
          return;
        }
        const container = ensureScrollContainer();
        if (!container) {
          return;
        }
        const hashAt = target.indexOf("#");
        if (hashAt < 0) {
          // A chapter entry: its top. The chapter before it is on the page
          // above (scrolling runs them together), so the top is where this
          // chapter's own frame starts, and is found again once the one
          // above has settled.
          const toTop = () => {
            container.scrollTop = sectionTop(fileTarget) ?? 0;
          };
          toTop();
          requestAnimationFrame(toTop);
          window.setTimeout(toTop, 250);
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

        // Scrolling is one continuous book: the chapters follow each other
        // down the page, fetched as the reading nears them. It used to be a
        // chapter at a time, swapped for the next at its last line.
        const rendition = epub.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%",
          ...(layoutRef.current === "pages" ? {} : { manager: "continuous", flow: "scrolled" })
        });
        renditionRef.current = rendition;
        // epub.js decides which chapters to fetch from a scroll position it
        // remembers from the last scroll event, a frame behind the page. Just
        // after a chapter loaded in above (and the page was moved down to
        // keep the text still) it still read "at the top", and fetched the
        // chapter before that one too. It is told where the page really is.
        void (rendition as any).started?.then(() => {
          const manager = rendition.manager as any;
          if (manager?.name !== "continuous" || typeof manager.check !== "function") {
            return;
          }
          const check = manager.check.bind(manager);
          manager.check = (...args: unknown[]) => {
            if (manager.container && !manager.settings?.fullsize) {
              manager.scrollTop = manager.container.scrollTop;
            }
            return check(...args);
          };
        });
        // Development only: lets a console (or a test driving the reader) see epub.js's state.
        if (import.meta.env.DEV) {
          (window as unknown as { __leafletRendition?: unknown }).__leafletRendition = rendition;
          // And the reader's own: the words indexed, the one being read, the pace's scale.
          (window as unknown as { __leafletReader?: unknown }).__leafletReader = {
            words: () => readerWordsRef.current,
            active: () => activeWordIndexRef.current,
            paceScale: () => readingPaceScaleRef.current,
            // Chapters held and names marked by the characters feature.
            people: () => peopleMarkedRef.current()
          };
        }
        appliedHighlightsRef.current.clear();
        setSelection(null);
        // A note or a picture from the page that is going (its address dies with the book).
        noteRequestRef.current += 1;
        setNote(null);
        setPicture(null);
        setCanSeek(false);

        rendition.hooks?.content?.register((contents: any) => {
          const doc = contents?.document;
          if (!doc) {
            return;
          }
          const pad = 24;
          doc.documentElement.style.setProperty("--reader-content-pad", `${pad}px`);
          doc.documentElement.style.setProperty("--reader-measure", bookMeasureCss());
          applyTypeChoice(doc.documentElement, typeChoiceRef.current);
          doc.documentElement.setAttribute("data-leaflet-layout", layoutRef.current);
          if (!doc.getElementById("reader-font-scale")) {
            // The book's drop caps and opening small capitals are found
            // first, while the publisher's own sizes can still be read: the
            // rules below give running text one size (readers/dropCaps.ts).
            try {
              markOpenings(doc);
            } catch {
              // An opening left unmarked is set at body size, as it was.
            }
            const style = doc.createElement("style");
            style.id = "reader-font-scale";
            style.textContent = `
              @font-face { font-family: "ZT Nature"; src: url("${ztNatureBoldWoff2}") format("woff2"); font-display: swap; font-weight: 700; }
              :root { --reader-font-size: ${fontSizeRef.current}px; }
              html { font-size: var(--reader-font-size) !important; }
              /* A new line length eases in, but only once the chapter has
                 settled (see the end of this hook). */
              html[data-leaflet-settled], html[data-leaflet-settled] body { transition: padding 0.25s ease; }
              /* Scrolling: the text fills the width. Pages: epub.js sets the
                 body's width for its columns, which this must not override. */
              html:not([data-leaflet-layout="pages"]), html:not([data-leaflet-layout="pages"]) body { width: 100% !important; max-width: 100% !important; }
              body { font-size: 1em !important; margin: 0 !important; padding-top: ${PAGE_TOP_PAD}px !important; padding-left: ${MEASURE_PADDING} !important; padding-right: ${MEASURE_PADDING} !important; text-align: var(--reader-align, justify) !important; text-justify: inter-word !important; hyphens: auto; line-height: var(--reader-line-height, 1.8) !important; box-sizing: border-box; }
              /* The face (readers/readerTypes.ts). A book that names none is
                 set in the book serif; a face the reader chose is imposed on
                 the running text, and "the book's own" imposes nothing. Code
                 keeps its fixed width, headings their own face (below). */
              :where(body) { font-family: ${FALLBACK_FACE}; }
              html[data-leaflet-face] body,
              html[data-leaflet-face] body :where(p, div, span, li, blockquote, td, th, dd, dt, a, em, i, b, strong, cite, section, article, font):not(:where(pre, code, kbd, samp, tt) *) { font-family: var(--reader-font-family) !important; }
              body > *:first-child { margin-top: 0 !important; padding-top: 0 !important; }
              /* One reading size for running text, whatever the publisher
                 set; headings, footnote markers and small print keep their
                 proportions (a blanket rule made headings body-sized and
                 footnote numbers full-sized). */
              body :where(p, div, span, li, blockquote, td, th, dd, dt, a, em, i, b, strong, cite, section, article, font) { font-size: inherit !important; }
              body * { line-height: inherit; box-sizing: border-box; max-width: 100% !important; }
              /* One line spacing for running text too, the reader's: a
                 publisher's own (often tighter) would leave the setting
                 doing nothing, and every count made in lines wrong. */
              body :where(p, div, span, li, blockquote, td, th, dd, dt, a, em, i, b, strong, cite, section, article, font) { line-height: inherit !important; }
              h1 { font-size: 1.6em !important; }
              h2 { font-size: 1.4em !important; }
              h3 { font-size: 1.22em !important; }
              h4, h5, h6 { font-size: 1.08em !important; }
              sup, sub { font-size: 0.72em !important; line-height: 0 !important; }
              small { font-size: 0.86em !important; }
              body > * { max-width: 100% !important; }
              p { text-align: var(--reader-align, justify) !important; text-justify: inter-word !important; hyphens: auto; text-indent: 0 !important; margin-left: 0 !important; margin-bottom: 1.6em !important; }
              /* A ragged right edge needs no broken words. */
              html[data-leaflet-align="left"] body, html[data-leaflet-align="left"] body * { -webkit-hyphens: manual !important; hyphens: manual !important; }
              /* Scene breaks, epigraphs and title lines the book centres stay centred. */
              p[align="center"], p.center, p.centered, p[style*="text-align: center"], p[style*="text-align:center"],
              div[align="center"] p, .center p, .centered p { text-align: center !important; }
              /* On a dark page, text the publisher coloured dark (common in
                 InDesign exports) takes the page's ink, links the accent,
                 and boxes lose light backgrounds that would glare. */
              html[data-reader-dark="1"] body :where(div, span, em, i, b, strong, small, cite, section, article, figcaption, sup, sub, font, dfn, abbr) { color: inherit !important; }
              /* Links only. Books mark page breaks with empty anchors
                 (<a id="page12"/>); read as HTML those never close, and the
                 paragraph after each one ended up inside it, in the accent. */
              html[data-reader-dark="1"] body a:any-link { color: #8cc95a !important; }
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
                 as drawn. The picture viewer switches a picture back. */
              html[data-reader-dark="0"] [data-leaflet-ink]:not([data-leaflet-ink-off="1"]) { mix-blend-mode: multiply; }
              html[data-reader-dark="1"] [data-leaflet-ink="title"]:not([data-leaflet-ink-off="1"]) {
                filter: invert(1) hue-rotate(180deg) brightness(0.92);
                mix-blend-mode: screen;
              }
              /* A picture that opens in the viewer (readers/pictures.ts). */
              [data-leaflet-zoom] { cursor: zoom-in; }
              ${OPENINGS_CSS}
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
          markViewable(doc);
          doc.documentElement.style.backgroundColor = finish.background;
          doc.body.style.backgroundColor = finish.background;
          doc.documentElement.style.backgroundImage = finishBackground;
          doc.body.style.backgroundImage = finishBackground;
          doc.documentElement.style.backgroundSize = "auto";
          doc.body.style.backgroundSize = "auto";
          // The frame was sized before these styles and the theme's went in,
          // and they make a chapter two or three times as long. epub.js
          // measures again a frame later, but goes to the place asked for
          // first: a place further down than the old length was out of
          // reach, so a saved place, a bookmark or a search result deep in a
          // chapter opened somewhere else in it, or on a blank page. The
          // frame takes its real size now.
          try {
            (rendition.manager as any)?.views?.forEach?.((view: any) => {
              if (view?.contents === contents) {
                view.expand?.();
              }
            });
          } catch {
            // epub.js measures again by itself.
          }
          // Only from here does a change of line length ease in. Easing the
          // padding as the chapter arrived went on moving every line for a
          // quarter of a second after the place had been gone to.
          void doc.body.offsetHeight;
          doc.documentElement.setAttribute("data-leaflet-settled", "1");
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
        const initialFlow = layoutRef.current === "pages" ? "paginated" : "scrolled";
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
        // A section outside the reading order (linear="no": often the cover,
        // or a file of notes) is a dead end to epub.js: it has no next and no
        // previous. Opened from the chapter list or a link, nothing followed
        // it down the page, auto-scroll and Smart Read announced the end of
        // the book there, and with pages it could not be turned away from. It
        // leads on to the reading order around it; reading through the book
        // still passes it by.
        const sections: any[] = (epub.spine as any)?.spineItems ?? [];
        sections.forEach((section, at) => {
          if (!section || section.linear) {
            return;
          }
          const towards = (step: 1 | -1) => () => {
            for (let i = at + step; i >= 0 && i < sections.length; i += step) {
              if (sections[i]?.linear) {
                return sections[i];
              }
            }
            return undefined;
          };
          section.next = towards(1);
          section.prev = towards(-1);
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
        // Labels come with the file's own line breaks and indentation, which
        // went into every bookmark and highlight made under them.
        const flatToc = flattenToc(navigation.toc).map((item) => ({
          ...item,
          label: item.label.replace(/\s+/g, " ").trim(),
          href: resolveTocHref(item.href)
        }));
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

        tocSpineStartsRef.current = flatToc
          .map((item) => spineIndexByHref[item.href.split("#")[0]])
          .filter((value): value is number => typeof value === "number");

        // Section sizes, for progress by how much has been read. A quick call
        // (the archive's directory only); without it, the older estimates below.
        sectionWeightsRef.current = null;
        try {
          let sections = await bookService.epubSections(book.id).catch(() => []);
          if (cancelled) {
            return;
          }
          // No backend (the browser preview), or it could not read them: the
          // sizes are in the copy of the archive epub.js already holds.
          if (sections.length === 0) {
            sections = sectionsFromArchive(epub);
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
        setCanSeek(sectionWeightsRef.current !== null);

        const onRelocated = (location: any) => {
          // A look at the map or the notes from the middle of the story
          // (readers/progress.ts: outsideStory): the progress and the saved
          // place stay where the reading is. Front matter used to read as
          // 0%, and closing the book there saved it.
          let lookingOutside = false;
          const outside = (side: "front" | "back") => {
            const known = lastCfiProgressRef.current ?? (lastComputedProgressRef.current >= 0 ? lastComputedProgressRef.current : 0);
            const rule = outsideStory(side, known);
            lookingOutside = !rule.placeFollows;
            return rule.progress;
          };
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
                return outside("front");
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
                return outside("front");
              }
              // Past the story is back matter: a footnote link into it is not
              // finishing the book, so progress stays where the reading was.
              if (spineIndex > weights.hi) {
                return outside("back");
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
                return outside("back");
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
          // The place saved is the reading line (readers/readingPlace.ts),
          // the height a reopened book puts it back at. It used to be the
          // line at the very top, under the toolbar: put back 80px lower,
          // the line then at the top was saved, and a book reopened without
          // scrolling crept back some seventy pixels each time.
          const savedCfi = lookingOutside
            ? null
            : placeToSave(
                layoutRef.current,
                layoutRef.current === "scroll" ? readingPlaceCfi() : null,
                (location?.start?.cfi as string | undefined) ?? null
              );
          if (location?.start?.cfi) {
            const href = location?.start?.href;
            if (href) {
              chapterPositionsRef.current = {
                ...chapterPositionsRef.current,
                [href]: location.start.cfi
              };
            }
            if (savedCfi) {
              lastCfiRef.current = savedCfi;
              persistReaderState({ cfi: savedCfi, chapterPositions: chapterPositionsRef.current });
            } else {
              persistReaderState({ chapterPositions: chapterPositionsRef.current });
            }
          }

          // no auto-advance in scroll mode

          if (!progressArmedRef.current && lastHandsOnAtRef.current > openedAtRef.current) {
            progressArmedRef.current = true;
          }
          // A look at a highlight (opened from the library) is not reading on
          // from there: the book's progress and place wait until it is.
          const shouldUpdateProgress =
            percentage !== null &&
            progressArmedRef.current &&
            placeFollowsNow() &&
            (Math.abs(percentage - lastProgressRef.current) >= 0.005 || now - lastProgressAtRef.current >= 10000);

          if (shouldUpdateProgress && percentage !== null) {
            lastProgressRef.current = percentage;
            lastProgressAtRef.current = now;
            const position = savedCfi ?? location?.start?.cfi ?? null;
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
          // Turning pages is reading too, and teaches the pace.
          if (layoutRef.current === "pages") {
            notePageShownRef.current(location);
          }
          updateOutlookRef.current();
        };
        relocateHandlerRef.current = onRelocated;
        rendition.on("relocated", onRelocated);
        // Selected text is offered for highlighting (the selection bar).
        rendition.on("selected", (cfiRange: string, contents: any) => {
          const text = String(contents?.window?.getSelection?.()?.toString?.() ?? "")
            .replace(/\s+/g, " ")
            .trim();
          if (text) {
            // A note and the selection bar share a place: one at a time.
            closeNoteRef.current();
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
            let pressedAt = 0;
            doc.addEventListener(
              "pointerdown",
              (event) => {
                handsOn();
                pressedAt = Date.now();
                if (event.pointerType === "touch") {
                  revealChromeRef.current();
                }
                holdAutoScrollRef.current(true);
                // A click on the page lets a note go (a click on another
                // note reference then opens that one).
                if (noteRef.current) {
                  closeNoteRef.current();
                }
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
                if (anchor && href.trim() && !isOutsideLink(href)) {
                  // A link within the book: a jump the reader can come back
                  // from, made the reader's own way (see followBookLinkRef).
                  event.preventDefault();
                  event.stopPropagation();
                  followBookLinkRef.current(anchor, contents?.sectionIndex);
                  return;
                }
                if (!anchor) {
                  // A picture opens large (readers/ImageViewer.tsx). A long
                  // press is holding the page still, not asking to look.
                  const found = Date.now() - pressedAt < 700 ? pictureAt(event.target as Element | null) : null;
                  if (found) {
                    event.preventDefault();
                    openPictureRef.current(found);
                  }
                  return;
                }
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
            doc.addEventListener("selectionchange", () => selectionChangedRef.current());
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
              markViewable(contents.document);
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
          // With pages, a place in the middle of a paragraph opened a page early.
          if (lastCfiRef.current) {
            settleOnPage(lastCfiRef.current);
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
      // What was on its way in the page that is going: a page mid-slide, a
      // turn into another chapter (which hides the page until it arrives, and
      // would leave the next one hidden), a search result's mark.
      if (pageSlideRef.current) {
        window.cancelAnimationFrame(pageSlideRef.current.frame);
        pageSlideRef.current = null;
      }
      chapterTurnUntilRef.current = 0;
      if (viewerRef.current) {
        delete viewerRef.current.dataset.turn;
      }
      if (searchMarkRef.current) {
        window.clearTimeout(searchMarkRef.current.timer);
        searchMarkRef.current = null;
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
    // The book was laid out at this size a moment ago. Telling epub.js the
    // size again made it clear the page (it measures the scrolling layout a
    // scrollbar narrower, so the two never agreed) with no place yet known to
    // put back: the book opened blank.
    let laidOut = { width: Math.round(viewer.clientWidth), height: Math.round(viewer.clientHeight) };
    const syncViewport = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const width = Math.max(1, Math.round(viewer.clientWidth));
        const height = Math.max(1, Math.round(viewer.clientHeight));
        if (width === laidOut.width && height === laidOut.height) {
          return;
        }
        laidOut = { width, height };
        rendition.resize(width, height);
        ensureSingleScrollContainer();
        // Reflow moves the anchored word; the marker has to follow it.
        refreshReaderDot();
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
    let framesObserver: MutationObserver | null = null;
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
      cancelSmartPageTurn();
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
      // Only the reader's own scrolling heads for the next chapter: a Smart
      // Read page step that lands at the bottom still has lines left to read.
      if (delta > 0 && now >= programmaticScrollUntilRef.current) {
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
      // Chapters come and go under what points into them, and epub.js says
      // nothing when one does. Text selected in a chapter that was let go
      // (scrolled far from, jumped away from, re-laid out by a resize) went
      // with it, and a frame that has gone sends no selectionchange: the
      // offer to highlight it stayed, and hands-free reading waited on it.
      framesObserver = new MutationObserver((records) => {
        selectionChangedRef.current();
        if (records.some((record) => record.target === container)) {
          tuckAwayStrandedDot(container);
        }
      });
      framesObserver.observe(container, { childList: true, subtree: true });
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
      framesObserver?.disconnect();
      framesObserver = null;
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
      autoScrollPacedRef.current = false;
      commitAutoScrollRun();
      return;
    }

    const container = ensureScrollContainer();
    if (!container) {
      return;
    }

    autoScrollLastTimeRef.current = null;
    // Starting (or retuning) is deliberate, so the hands-free window restarts.
    lastHandsOnAtRef.current = Date.now();
    // What the reader read by hand until now is theirs; from here the page moves at auto-scroll's pace.
    stopFreeReadingRef.current();
    // In a book where the reader never set its speed, auto-scroll starts at
    // their own pace, in lines by what a line holds on this screen. A fixed
    // lines-a-minute default ran far too fast on a wide window.
    if (!autoScrollTunedRef.current && !autoScrollPacedRef.current) {
      autoScrollPacedRef.current = true;
      const paced = autoScrollSpeedForPace();
      if (paced !== null && paced !== autoScrollSpeed) {
        // This runs again at the new speed.
        setAutoScrollSpeed(paced);
        showFocusToastRef.current(`Auto-scroll at your pace: ${autoScrollLinesPerMinute(paced)} lines/min`);
        return;
      }
    }

    const tick = (time: number) => {
      if (!autoScrollActive) {
        return;
      }
      const now = Date.now();
      // Nobody has touched the page for a while: stop rather than scroll a
      // chapter past an empty chair (and stop crediting minutes for it).
      if (now - lastHandsOnAtRef.current >= HANDS_FREE_GRACE_MS) {
        // The last stretch was probably an empty chair, not a pace kept up with.
        autoScrollRunRef.current = { ms: 0, px: 0 };
        setAutoScrollActive(false);
        showFocusToastRef.current("Auto-scroll paused. Still reading? Press Space.");
        return;
      }
      // A hand on the page, a correction settling, or a panel or selection over the text: wait.
      if (autoScrollHeldRef.current || now < autoScrollYieldUntilRef.current || interruptedRef.current) {
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
      const speedPxPerSecond = autoScrollPixelsPerSecond(autoScrollSpeed, linePx());
      autoScrollCarryRef.current += speedPxPerSecond * deltaSeconds;
      const move = Math.floor(autoScrollCarryRef.current);
      if (move > 0) {
        container.scrollTop = before + move;
        // What the page really moved: on a display scaled to 150% a step of
        // one pixel lands on the next device pixel, a third further, and
        // "35 lines a minute" ran at 47. Counting the step asked for hid it.
        const moved = container.scrollTop - before;
        const counted = moved > 0 ? moved : move;
        autoScrollCarryRef.current -= counted;
        autoScrollRunRef.current.px += counted;
      }
      autoScrollRunRef.current.ms += deltaSeconds * 1000;
      if (autoScrollRunRef.current.ms >= 3 * 60_000) {
        commitAutoScrollRun();
      }
      if (container.scrollTop === before && isAtScrollBottom(container, 2)) {
        if (hasFurtherSection()) {
          triggerScrollAdvance();
        } else if (move > 0) {
          setAutoScrollActive(false);
          showFocusToastRef.current("That's the end of the book.");
          return;
        }
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
    cancelSmartCatchUp();
    if (!session) return;
    // A stretch read at Dotty's pace without correcting it says the pace suits.
    // It is Dotty's pace rather than a measurement, so it counts for less.
    if (session.acceptedMs > 0) {
      learnPace(session.acceptedWords, session.acceptedMs, "guided");
    }
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
  // The note saying so waits for them to come back: shown as they left, it
  // was gone before they could see it.
  useEffect(
    () =>
      watchForeground((inFront) => {
        awayRef.current = !inFront;
        if (inFront) {
          const note = pausedWhileAwayRef.current;
          pausedWhileAwayRef.current = null;
          if (note) {
            showFocusToastRef.current(note, 5000);
          }
          return;
        }
        // Time away is not reading: what was read until now is kept, and saved.
        stopFreeReadingRef.current();
        savePaceProfileRef.current();
        if (autoScrollActiveRef.current) {
          setAutoScrollActive(false);
          pausedWhileAwayRef.current = "Auto-scroll paused while you were away. Space to carry on.";
        } else if (readingModeRef.current !== "standard" && !readingPausedRef.current) {
          readingPausedRef.current = true;
          setReadingPaused(true);
          pausedWhileAwayRef.current = "Paused while you were away. Space to carry on.";
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
      cancelSmartCatchUp();
      stopWaitingForReread();
      smartManualOverrideUntilRef.current = 0;
    }
    if (readingMode !== "standard") {
      // Hands-free from here: what was read by hand until now is kept.
      stopFreeReading();
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
    }
    setAutoScrollActive(false);
    const startPaused = startPausedRef.current;
    startPausedRef.current = false;
    setReadingPaused(startPaused);
    readingPausedRef.current = startPaused;
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

    const startSmartSessionAt = (index: number) => {
      const startedAt = Date.now();
      smartSessionRef.current = {
        startedAt,
        activeMs: 0,
        lastTickAt: startedAt,
        anchorIndex: index,
        anchorActiveMs: 0,
        acceptedWords: 0,
        acceptedMs: 0
      };
    };

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
      // Dotty sets off at this reader's pace for this book, as learned on
      // every device; the reader's corrections change it as they go.
      smartPaceFromModelRef.current = true;
      smartPlainRef.current = predictPlainWpm(paceProfileRef.current, paceContext());
      setSmartWpm(Math.round(smartWpmNow()));
      startSmartSessionAt(activeWordIndexRef.current);
    } else {
      finishSmartSession();
      removeLastReadMarker();
    }

    let stopped = false;
    // Words shown since SpeedRead set off or was last resumed: the first few
    // are held longer (rsvpRamp), so the eye is on the spot before the pace is.
    let shownSincePlay = 0;
    const schedule = (delay: number) => {
      if (stopped) return;
      readingEngineTimerRef.current = window.setTimeout(() => {
        if (stopped || readingModeRef.current === "standard") return;
        // Smart Read waits, without counting the time, while a hand is on the
        // page, the reader went back to reread, a panel or selection covers
        // the text, or a page step is settling.
        const waiting =
          readingModeRef.current === "smart" &&
          (autoScrollHeldRef.current ||
            smartRereadRef.current ||
            interruptedRef.current ||
            Date.now() < smartStepHoldUntilRef.current);
        if (readingPausedRef.current || waiting) {
          if (smartSessionRef.current) {
            smartSessionRef.current.lastTickAt = Date.now();
          }
          shownSincePlay = 0;
          schedule(180);
          return;
        }
        if (readerWordsStale()) {
          prepareReaderWords(false);
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
          wpm = smartWpmNow();
          if (index % 8 === 0) setSmartWpm(Math.round(wpm));
          const session = smartSessionRef.current;
          if (session) {
            // The first word's wait is Smart Read setting off, not reading.
            const first = session.activeMs === 0 && session.acceptedWords === 0;
            const step = first ? 0 : Math.min(2500, Math.max(0, now - session.lastTickAt));
            session.activeMs += step;
            session.acceptedMs += step;
            session.acceptedWords += 1;
            session.lastTickAt = now;
            // A long stretch at Dotty's pace is learned as it goes, not only at the end.
            if (session.acceptedMs >= 4 * 60_000) {
              learnPace(session.acceptedWords, session.acceptedMs, "guided");
              session.acceptedWords = 0;
              session.acceptedMs = 0;
            }
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
          getPaceFactor(word, paceMode, sectionWordDifficultyRef.current) *
          readingPaceScaleRef.current[paceMode] *
          (mode === "speed" ? rsvpRamp(shownSincePlay) : 1);
        shownSincePlay += 1;
        schedule(Math.round(paceDelay));
      }, delay);
    };

    // Every word on the page has been read. The next chapter follows on below
    // (epub.js fetches it as the reading nears it), so reading carries on into
    // it once its words are there; this asks for it in case it was not fetched.
    const continueInNextSection = () => {
      let attempts = 0;
      const waitForMore = () => {
        if (stopped || readingModeRef.current === "standard") return;
        if (wordIndexTimerRef.current) {
          window.clearTimeout(wordIndexTimerRef.current);
          wordIndexTimerRef.current = null;
        }
        prepareReaderWords(false);
        if (activeWordIndexRef.current < readerWordsRef.current.length) {
          // A beat at the new chapter's heading.
          schedule(readingModeRef.current === "smart" ? 1200 : 600);
          return;
        }
        attempts += 1;
        if (hasFurtherSection() && attempts < 40) {
          loadFurther();
          if (attempts % 4 === 0) {
            // A chapter that is all picture has no words: go on past it.
            const container = ensureScrollContainer();
            if (container) {
              programmaticScrollUntilRef.current = Date.now() + 500;
              container.scrollTop += container.clientHeight * 0.8;
            }
          }
          readingEngineTimerRef.current = window.setTimeout(waitForMore, 250);
          return;
        }
        // Nothing came next: this is the end of the book.
        readingPausedRef.current = true;
        setReadingPaused(true);
        showFocusToast("End of book");
        schedule(180);
      };
      loadFurther();
      readingEngineTimerRef.current = window.setTimeout(waitForMore, 200);
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
    // A chapter skipped is a jump: the line left can be come back to.
    noteJumpFromHere();
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
    noteJumpFromHere();
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
  const appliedMeasureRef = useRef(measure);
  const appliedTypeRef = useRef(`${typeface}|${spacing}|${align}`);
  useEffect(() => {
    if (!renditionRef.current?.themes?.fontSize) {
      applyReaderTypography();
      return;
    }
    // Bigger or smaller text, a longer or shorter line, another face, line
    // spacing or alignment: each changes the chapter's height while the
    // scroll position stays put, so the page jumped by hundreds of pixels.
    // Note the line in view first, and return to it once the text has
    // reflowed.
    const rendition = renditionRef.current;
    const typeNow = `${typeface}|${spacing}|${align}`;
    const changed =
      appliedFontSizeRef.current !== fontSize || appliedMeasureRef.current !== measure || appliedTypeRef.current !== typeNow;
    appliedFontSizeRef.current = fontSize;
    appliedMeasureRef.current = measure;
    appliedTypeRef.current = typeNow;
    if (changed) {
      // Auto-scroll's run so far was counted in lines of the old height.
      autoScrollRunRef.current = { ms: 0, px: 0 };
    }
    const anchor: string | undefined = changed ? (readingPlaceCfi() ?? undefined) : undefined;
    fontSizeRef.current = fontSize;
    applyReaderTypography();
    applyReaderInsets();
    let resettle: number | null = null;
    if (anchor) {
      // The line that was under the toolbar goes back there.
      const restore = () => {
        if (renditionRef.current !== rendition) {
          return;
        }
        markNavigating();
        // Scrolling: the chapters take their new heights now, not a frame
        // later. Going to a line beyond a chapter's old end made epub.js take
        // the chapter for one scrolled out of reach and let go of it, leaving
        // a blank where the text had been.
        if (layoutRef.current === "scroll") {
          try {
            (rendition.manager as any)?.views?.forEach?.((view: any) => {
              if (view?.displayed) {
                view.expand?.();
              }
            });
          } catch {
            // The line is found again below either way.
          }
        }
        void rendition.display(anchor).then(
          () => {
            if (renditionRef.current === rendition) {
              clearToolbar();
              settleOnPage(anchor);
            }
          },
          () => undefined
        );
      };
      requestAnimationFrame(restore);
      // And once more when the column's padding has eased into place, which
      // moves the line again.
      resettle = window.setTimeout(restore, 330);
    }
    scheduleReaderWordIndex(true);
    persistReaderState();
    // The column's padding eases over a quarter of a second (see the book's
    // stylesheet), and Dotty was placed against where it started: place it
    // again once the text has settled.
    const settle = window.setTimeout(() => refreshReaderDot(true), 400);
    return () => {
      window.clearTimeout(settle);
      if (resettle !== null) {
        window.clearTimeout(resettle);
      }
    };
  }, [fontSize, measure, typeface, spacing, align]);

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

  // The first book opened on this device gets the walkthrough. After that,
  // books open in Smart Read, paused at the reader's line, unless they turned
  // that off.
  const openingHandledRef = useRef(false);
  useEffect(() => {
    if (loading || loadError || openingHandledRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      openingHandledRef.current = true;
      if (!readerTourSeen()) {
        setTourOpen(true);
      } else if (readStartMode() === "smart" && layoutRef.current === "scroll" && readingModeRef.current === "standard") {
        beginReadingMode("smart", "top", { paused: true });
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [loading, loadError]);

  /** Lights up the real Dotty while the walkthrough introduces it. */
  const tourStepRef = useRef(-1);
  const spotlightDotty = (step: number) => {
    tourStepRef.current = step;
    if (step === 0 && !readerDotElementRef.current && readingModeRef.current === "standard") {
      const location = renditionRef.current?.location;
      const cfi = location?.end?.cfi ?? location?.start?.cfi;
      if (cfi) {
        updateLastReadMarker(cfi);
      }
    }
    const apply = () => readerDotElementRef.current?.classList.toggle("reader-dot-spotlight", tourStepRef.current === 0);
    apply();
    // Dotty may take a moment to find its line on a page that has just opened.
    window.setTimeout(apply, 600);
  };

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
    source: "dot" | "viewport" | "chapter" | "top",
    options?: { paused?: boolean }
  ) => {
    prepareReaderWords(false);
    const wordCount = readerWordsRef.current.length;
    let startIndex = 0;
    if (source === "dot") {
      startIndex = readerDotAnchorIndexRef.current ?? findNearestWordIndex();
    } else if (source === "viewport") {
      startIndex = findNearestWordIndex();
    } else if (source === "top") {
      // A reopened book puts the reader's line at the top, just under the toolbar.
      const height = ensureScrollContainer()?.clientHeight ?? 0;
      startIndex = findNearestWordIndex(height > 0 ? (PAGE_TOP_PAD + fontSizeRef.current) / height : 0.1);
    }
    startPausedRef.current = options?.paused ?? false;
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
  // left of the word's middle. It stays pinned to the same spot on screen word
  // after word, so the eye never has to move; only the letters around it
  // change. The spot is left of the stage's middle, so the word as a whole
  // sits across the middle, and a word too long for the room either side of
  // the spot is set smaller instead of being cut off.
  // (The spot is a fixed distance left of the middle in the stage's own type,
  // and the fit is by the word's real width against the stage's real width:
  // readers/rsvpMeasure.ts.)
  const rsvpStage = readingWord ? rsvpStageVars(readingWord.text, readingWord.punctuation) : null;
  const rsvpPivot = rsvpStage?.pivot ?? 0;
  const rsvpWordStyle = (rsvpStage?.style ?? {}) as CSSProperties;
  // RSVP takes its colours from the page, not the app: a true-black page gets
  // a dark stage even when the rest of Leaflet is light, and the paper finish
  // stays paper when the app is dark.
  const rsvpFinish = getReaderFinish(displayMode, readerTheme);
  const rsvpDark = rsvpFinish.themeName === "leaflet-dark";
  // The page's own colours, for everything around the book text (its gutters,
  // the scrollbar, the frame), which otherwise followed the app's theme and
  // showed as pale strips beside a dark page.
  // The paper's grain too: with lines capped, the room either side of a
  // centred page shows, and a flat frame beside grained paper read as a seam.
  const pageStyle = {
    "--reader-page-bg": rsvpFinish.background,
    "--reader-page-texture": getReaderFinishBackground(rsvpFinish),
    "--reader-page-ink": rsvpFinish.text,
    colorScheme: rsvpDark ? "dark" : "light"
  } as CSSProperties;
  const rsvpStyle = {
    "--rsvp-bg": rsvpFinish.background,
    "--rsvp-text": rsvpFinish.text,
    "--rsvp-accent": rsvpDark ? "#8cc95a" : "#0b7a45"
  } as CSSProperties;
  const rsvpWordsLeft = readingWord ? Math.max(0, readingWord.sectionEnd - readingWord.index - 1) : 0;
  const rsvpMinutesLeft = Math.max(1, Math.round(rsvpWordsLeft / Math.max(60, speedReadWpm)));
  const rsvpProgress = readingWord
    ? (readingWord.index - readingWord.sectionStart + 1) / Math.max(1, readingWord.sectionEnd - readingWord.sectionStart)
    : 0;
  // What sits above the chapter dock (the selection bar, a note) moves up
  // when auto-scroll's or Smart Read's controls are showing in that place.
  const dockAbovePace = (readingMode === "standard" && autoScrollActive) || (readingMode === "smart" && !pendingReadingMode);
  const showFocusToast = (message: string, ms = 2400) => {
    setFocusToast(message);
    if (focusToastTimerRef.current) {
      window.clearTimeout(focusToastTimerRef.current);
    }
    focusToastTimerRef.current = window.setTimeout(() => {
      setFocusToast(null);
    }, ms);
  };
  showFocusToastRef.current = showFocusToast;

  // Hold to wait: a finger or the mouse held down on the text stops auto-scroll
  // and Smart Read's Dotty alike (a stop to think), until it lets go.
  holdAutoScrollRef.current = (held: boolean) => {
    if (held && !autoScrollActiveRef.current && readingModeRef.current !== "smart") {
      return;
    }
    if (autoScrollHeldRef.current === held) {
      return;
    }
    autoScrollHeldRef.current = held;
    setAutoScrollHeld(held);
    if (held) {
      // A hand on the page stops a page step too, where it is.
      cancelSmartPageTurn();
    } else {
      // A short breath after letting go, so the line being read stays put.
      autoScrollYieldUntilRef.current = Math.max(autoScrollYieldUntilRef.current, Date.now() + 400);
      smartStepHoldUntilRef.current = Math.max(smartStepHoldUntilRef.current, Date.now() + 400);
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
    // A correction: the pace so far was not quite the reader's.
    autoScrollRunRef.current = { ms: 0, px: 0 };
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
    tuneAutoScroll(next);
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
        ref={toolbarRef}
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
          <h1 className={toolbarTitleClass(book.title)} title={book.title}>
            {book.title}
          </h1>
          <span className="text-xs uppercase tracking-[0.2em] reader-muted">
            {book.author ?? "Unknown author"}
          </span>
        </div>
        <div className="flex items-center gap-4 md:gap-6">
          <div className="relative" ref={fontPanelRef}>
            <button
              className="reader-icon transition-colors reader-hover-accent"
              type="button"
              onClick={() => setFontPanelOpen((prev) => !prev)}
              title="Text: size, line length, typeface, spacing"
              aria-label="Text settings"
              aria-expanded={fontPanelOpen}
            >
              <span className="material-symbols-outlined">text_fields</span>
            </button>
            {fontPanelOpen && (
              <TypePanel
                fontSize={fontSize}
                onFontSize={setFontSize}
                measure={measure}
                onMeasure={chooseMeasure}
                typeface={typeface}
                onTypeface={chooseTypeface}
                spacing={spacing}
                onSpacing={chooseSpacing}
                align={align}
                onAlign={chooseAlign}
              />
            )}
          </div>
          <button
            className="reader-icon transition-colors reader-hover-accent"
            type="button"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            title="Search in this book (Ctrl+F)"
            aria-label="Search in this book"
          >
            <UiIcon name="search" size={22} />
          </button>
          {people.enabled && (
            <button
              className="reader-icon transition-colors reader-hover-accent"
              type="button"
              onClick={() => {
                if (people.panelOpen) {
                  people.closePanel();
                } else {
                  // The two panels share a corner.
                  closeSearch();
                  people.openPanel();
                }
              }}
              title="Characters"
              aria-label="Characters"
              aria-haspopup="dialog"
              aria-expanded={people.panelOpen}
            >
              <UiIcon name="people" size={22} />
            </button>
          )}
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
                      onChange={(event) => tuneAutoScroll(Number(event.target.value))}
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
                        <div className="text-[10px] uppercase tracking-widest reader-muted">Dotty's pace</div>
                        <div className="mt-1 text-sm font-semibold tabular-nums reader-text-color">~{smartWpm} wpm</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="reader-mini-control"
                          onClick={() => nudgeSmartPace(1 / SMART_NUDGE)}
                          title="Slower (-)"
                          aria-label="Slower"
                        >
                          <UiIcon name="minus" size={14} />
                        </button>
                        <button
                          type="button"
                          className="reader-mini-control"
                          onClick={toggleSmartPlay}
                          title={readingPaused || smartWaiting ? "Carry on (Space)" : "Pause (Space)"}
                          aria-label={readingPaused || smartWaiting ? "Carry on" : "Pause"}
                        >
                          <span className="material-symbols-outlined text-base">
                            {readingPaused || smartWaiting ? "play_arrow" : "pause"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="reader-mini-control"
                          onClick={() => nudgeSmartPace(SMART_NUDGE)}
                          title="Faster (+)"
                          aria-label="Faster"
                        >
                          <UiIcon name="plus" size={14} />
                        </button>
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed reader-muted">
                      Your pace for this book, learned from all your reading on every device: how hard the text is,
                      the time of day, and each correction you make. Stops to think are left out.
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
                <button
                  type="button"
                  className="mt-2 w-full py-1.5 text-center text-[10px] uppercase tracking-widest transition reader-muted reader-hover-accent"
                  onClick={() => {
                    setMorePanelOpen(false);
                    setTourOpen(true);
                  }}
                >
                  How Dotty works
                </button>
                <button
                  type="button"
                  className="w-full py-1.5 text-center text-[10px] uppercase tracking-widest transition reader-muted reader-hover-accent"
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

      <div className="reader-shell">
        <div
          className="reader-sidebar-hot-zone"
          onMouseEnter={scheduleReaderSidebarOpen}
          onMouseLeave={cancelReaderSidebarOpen}
          aria-hidden="true"
        />
        <button
          type="button"
          className={`reader-sidebar-tab ${sidebarOpen ? "is-hidden" : ""}`}
          onClick={openReaderSidebar}
          onMouseEnter={scheduleReaderSidebarOpen}
          onMouseLeave={cancelReaderSidebarOpen}
          aria-label="Show chapters"
          aria-expanded={sidebarOpen}
          title="Chapters"
          tabIndex={sidebarOpen ? -1 : 0}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            chevron_right
          </span>
        </button>
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
                  noteJumpFromHere();
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
                style={
                  paged && pagesViewerMaxWidth(measure, fontSize) !== null
                    ? { maxWidth: pagesViewerMaxWidth(measure, fontSize) ?? undefined, marginInline: "auto" }
                    : undefined
                }
              />
              {readingMode === "speed" && readingWord && (
                <div
                  className={`reader-rsvp-stage pointer-events-none absolute inset-0 z-20 ${
                    rsvpDark ? "is-dark" : "is-light"
                  } ${readingPaused ? "is-paused" : ""}`}
                  style={rsvpStyle}
                >
                  <div className="reader-rsvp-reticle" style={rsvpWordStyle} aria-hidden="true">
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
              {(selection || people.card) && (
                <div className={`reader-selection-dock ${dockAbovePace ? "is-above-pace" : ""}`}>
                  {/* The cards first: each places itself against the dock, above the bar. */}
                  {selection && lookUpShowing && (
                    <LookupCard
                      term={selection.text}
                      language={(bookRef.current as any)?.packaging?.metadata?.language}
                      avoid={() => selectedTextBox(renditionRef.current?.getContents?.() ?? [])}
                      onClose={() => setLookUpCfi(null)}
                    />
                  )}
                  {people.card}
                  {selection && (
                    <SelectionBar
                      text={selection.text}
                      onHighlight={(color) => highlightSelection(color)}
                      onNote={() => highlightSelection("yellow", true)}
                      onCopy={copySelection}
                      onDismiss={clearSelection}
                      onLookUp={() => {
                        people.closeCard();
                        setLookUpCfi((open) => (open === selection.cfi ? null : selection.cfi));
                      }}
                      lookUpOpen={lookUpShowing}
                      onWhoIs={
                        people.enabled
                          ? () => {
                              setLookUpCfi(null);
                              if (people.cardOpen) {
                                people.closeCard();
                              } else {
                                people.askWhoIs(selection.text, selection.cfi);
                              }
                            }
                          : undefined
                      }
                      whoIsOpen={people.cardOpen}
                      onSearchBook={() => searchBookFor(selection.text)}
                    />
                  )}
                </div>
              )}
              {/* A footnote, in the selection bar's place: the two are never up together. */}
              {note && !selection && !people.card && (
                <div className={`reader-selection-dock ${dockAbovePace ? "is-above-pace" : ""}`}>
                  <NotePopover
                    marker={note.marker}
                    paragraphs={note.paragraphs}
                    truncated={note.truncated}
                    onGoTo={goToNote}
                    onClose={closeNoteRef.current}
                  />
                </div>
              )}
              {/* Before the dock: while its handle is held the dock steps aside (see progressBar.css). */}
              {canSeek && outlook.progress !== null && !loading && (
                <ProgressBar
                  value={outlook.progress}
                  chapterAt={chapterAtFraction}
                  onSeek={seekTo}
                  shown={dockNear || dockAwake}
                  holdRef={seekHoldRef}
                />
              )}
              <ChapterDock
                ref={chapterDockRef}
                paged={paged}
                label={formatChapterDisplay()}
                onPrev={paged ? () => turnPage(-1) : goPrevSection}
                onNext={paged ? () => turnPage(1) : goNextSection}
                outlook={outlook}
                canGoBack={jumps.back > 0}
                canGoForward={jumps.forward > 0}
                onBack={goBack}
                onForward={goForward}
                awake={dockAwake}
                onNearChange={setDockNear}
              />
            </div>
          )}
        </main>
      </div>

      {picture && <ImageViewer picture={picture} onToggleInk={togglePictureInk} onClose={() => setPicture(null)} />}

      {shortcutsOpen && (
        <ShortcutsSheet
          context={`${paged ? "Pages" : "Scrolling"} · ${
            readingMode === "smart" ? "Smart Read" : readingMode === "speed" ? "SpeedRead" : "Standard reading"
          }`}
          sections={shortcutSections({ layout, mode: readingMode })}
          onClose={() => setShortcutsOpen(false)}
        />
      )}

      {people.panel}

      {searchOpen && bookRef.current && (
        <SearchPanel
          key={searchSeed}
          initialQuery={searchSeed}
          book={bookRef.current}
          chapterOf={chapterOfSection}
          onOpen={openSearchHit}
          onClose={closeSearch}
        />
      )}

      {tourOpen && (
        <ReaderTour
          paged={paged}
          onStep={spotlightDotty}
          onClose={() => {
            spotlightDotty(-1);
            setTourOpen(false);
          }}
          onTrySmartRead={() => requestReadingMode("smart")}
        />
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

      {activeSession?.flower ? (
        // A session started in full screen grows its flower here instead.
        <div className="leaflet-flower">
          <FocusFlower kind={activeSession.flower.kind} {...flowerLook(activeSession.flower, coffeeProgress)} box={72} />
        </div>
      ) : activeSession && (
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
          className={`reader-autoscroll-pill reader-panel reader-border ${
            chromeVisible || autoScrollHeld || holdReason ? "is-awake" : ""
          }`}
          role="group"
          aria-label="Auto scroll"
        >
          <button
            type="button"
            className="reader-autoscroll-button reader-icon reader-hover-accent"
            onClick={() => tuneAutoScroll((value) => Math.max(0, value - 5))}
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
            <UiIcon name={autoScrollHeld || holdReason ? "hand" : "pause"} size={16} />
            <span className="tabular-nums">
              {autoScrollHeld ? "Holding" : holdReason ? "On hold" : `${autoScrollLinesPerMinute(autoScrollSpeed)} lines/min`}
            </span>
          </button>
          <button
            type="button"
            className="reader-autoscroll-button reader-icon reader-hover-accent"
            onClick={() => tuneAutoScroll((value) => Math.min(100, value + 5))}
            title="Faster (+)"
            aria-label="Faster"
          >
            <UiIcon name="plus" size={16} />
          </button>
          <span className="reader-autoscroll-hint reader-muted">
            {holdReason ?? "Space pauses · hold the page to wait"}
          </span>
        </div>
      )}

      {/* Smart Read's own controls, for the same reason: pausing, and Dotty's
          pace, should never mean hunting for a menu. */}
      {readingMode === "smart" && !pendingReadingMode && (
        <div
          ref={pacePillRef}
          className={`reader-autoscroll-pill reader-panel reader-border ${
            chromeVisible || autoScrollHeld || readingPaused || smartWaiting || holdReason ? "is-awake" : ""
          }`}
          role="group"
          aria-label="Smart Read"
        >
          <button
            type="button"
            className="reader-autoscroll-button reader-icon reader-hover-accent"
            onClick={() => nudgeSmartPace(1 / SMART_NUDGE)}
            title="Slower (-)"
            aria-label="Slower"
          >
            <UiIcon name="minus" size={16} />
          </button>
          <button
            type="button"
            className="reader-autoscroll-main reader-accent"
            onClick={toggleSmartPlay}
            title={readingPaused || smartWaiting ? "Carry on (Space)" : "Pause (Space)"}
          >
            <UiIcon
              name={readingPaused || smartWaiting ? "play" : autoScrollHeld || holdReason ? "hand" : "pause"}
              size={16}
            />
            <span className="tabular-nums">
              {readingPaused
                ? "Paused"
                : smartWaiting
                  ? "Waiting for you"
                  : autoScrollHeld
                    ? "Holding"
                    : holdReason
                      ? "On hold"
                      : `${smartWpm} wpm`}
            </span>
          </button>
          <button
            type="button"
            className="reader-autoscroll-button reader-icon reader-hover-accent"
            onClick={() => nudgeSmartPace(SMART_NUDGE)}
            title="Faster (+)"
            aria-label="Faster"
          >
            <UiIcon name="plus" size={16} />
          </button>
          <span className="reader-autoscroll-hint reader-muted">
            {readingPaused
              ? "Space to carry on"
              : smartWaiting
                ? "Scroll back to Dotty, or Space to go on"
                : holdReason ?? "Space pauses · read ahead and Dotty catches up"}
          </span>
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
