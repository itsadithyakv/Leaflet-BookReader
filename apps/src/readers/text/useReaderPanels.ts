import { useEffect, useRef, useState } from "react";
import { TOUR_CONTENTS_STEP, readerTourSeen, readStartMode } from "../ReaderTour";
import { PEEK_MIN_WIDTH, setContentsSeen } from "../contentsPanel";
import { useAmbiencePopoverOpen } from "../../ambience";
import { daysAway, worthRecap } from "../recap/recap";
import type { WithAnnotations, WithCover, WithPages } from "./scope";

/** A book come back to is reminded of this long after it is on the page: after Smart Read has taken its place. */
const RECAP_AFTER_MS = 1500;

/**
 * What opens over the toolbar (the type panel, the ··· menu, the shortcuts
 * sheet), and the walkthrough.
 */
export const useReaderPanels = (reader: WithPages) => {
  const {
    contentsPeekRef, readerDotElementRef, readingModeRef, renditionRef, setSidebarOpen, sidebarPinnedRef,
    sidebarShownRef, updateLastReadMarker
  } = reader;
  const [fontPanelOpen, setFontPanelOpen] = useState(false);
  const fontPanelRef = useRef<HTMLDivElement | null>(null);
  const [morePanelOpen, setMorePanelOpen] = useState(false);
  /** The radio's popover (ambience/ReaderAmbience.tsx), opened from the ··· menu or its mark on the toolbar. */
  const soundPanelOpen = useAmbiencePopoverOpen();
  const morePanelRef = useRef<HTMLDivElement | null>(null);
  const morePanelCloseRef = useRef<number | null>(null);

  /** The keyboard shortcuts sheet ("?", or the ··· menu). */
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsOpenRef = useRef(false);
  shortcutsOpenRef.current = shortcutsOpen;

  /** The walkthrough of Dotty, Smart Read and pausing (first open, or from the ··· menu). */
  const [tourOpen, setTourOpen] = useState(false);

  /**
   * "Where was I?" (readers/recap): showing, and how many days the book had
   * been left when it opened by itself (null when it was asked for).
   */
  const [recap, setRecap] = useState<{ days: number | null } | null>(null);

  /** Which step of the walkthrough is showing (the chapter list's handle is lit on its own step). */
  const [tourStep, setTourStep] = useState(-1);

  /** Lights up the real Dotty while the walkthrough introduces it. */
  const tourStepRef = useRef(-1);
  const spotlightDotty = (step: number) => {
    tourStepRef.current = step;
    setTourStep(step);
    // On the chapter list's own step the list shows itself (where the window
    // has room for it) and goes again with the step; its handle is lit.
    if (step === TOUR_CONTENTS_STEP) {
      setContentsSeen();
      if (window.innerWidth >= PEEK_MIN_WIDTH && !sidebarShownRef.current) {
        contentsPeekRef.current.showing = true;
        setSidebarOpen(true);
      }
    } else if (contentsPeekRef.current.showing) {
      contentsPeekRef.current.showing = false;
      if (!sidebarPinnedRef.current) {
        setSidebarOpen(false);
      }
    }
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

  return {
    fontPanelOpen, setFontPanelOpen, fontPanelRef, morePanelOpen, setMorePanelOpen, soundPanelOpen, morePanelRef,
    morePanelCloseRef, shortcutsOpen, setShortcutsOpen, shortcutsOpenRef, tourOpen, setTourOpen, tourStep,
    spotlightDotty, recap, setRecap
  };
};

/** A click elsewhere in the app shuts the ··· menu and the type panel. */
export const usePanelDismissal = (reader: WithAnnotations) => {
  const {
    fontPanelOpen, fontPanelRef, morePanelCloseRef, morePanelOpen, morePanelRef, setFontPanelOpen, setMorePanelOpen
  } = reader;
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
};

/**
 * The first book opened on this device gets the walkthrough; after that, books
 * open in Smart Read, paused, unless the reader turned that off.
 */
export const useFirstOpen = (reader: WithCover) => {
  const { beginReadingMode, layoutRef, loadError, loading, readingModeRef, setTourOpen } = reader;
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
};

/**
 * A book come back to after some days opens with "Where was I?" (readers/recap).
 * Not one opened at a highlight (that is a look, not a return), nor on a
 * device still being shown round.
 */
export const useRecapOnReturn = (reader: WithCover) => {
  const { book, loadError, loading, openAt, setRecap } = reader;
  const offeredRef = useRef(false);
  useEffect(() => {
    if (loading || loadError || offeredRef.current) {
      return;
    }
    const days = daysAway(book.lastOpened, Date.now());
    if (openAt || !readerTourSeen() || days === null || !worthRecap(book.lastOpened, book.progress ?? 0, Date.now())) {
      return;
    }
    const timer = window.setTimeout(() => {
      offeredRef.current = true;
      setRecap({ days });
    }, RECAP_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [loading, loadError]);
};
