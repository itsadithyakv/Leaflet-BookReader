import { useMemo, useRef, useState } from "react";
import ePub from "epubjs";
import { type ReaderDisplayMode, type ReadingMode } from "../readerTypes";
import type { ReaderProps } from "./scope";

/**
 * What every part of the reader holds: the page's elements, the book and its
 * rendition (epub.js), how it is being read, what was saved with the book on
 * this device, and the note shown at the foot of the page.
 */
export const useReaderCore = (reader: ReaderProps) => {
  const { book } = reader;
  const viewerRef = useRef<HTMLDivElement | null>(null);
  // What covers the page's edges (the toolbar, Smart Read's controls, the
  // chapter bar), which Smart Read keeps Dotty's line clear of.
  const toolbarRef = useRef<HTMLElement | null>(null);
  const pacePillRef = useRef<HTMLDivElement | null>(null);
  const chapterDockRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<any>(null);
  const bookRef = useRef<ReturnType<typeof ePub> | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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

  const readingModeRef = useRef<ReadingMode>("standard");

  // Last wheel or key press from the reader's own hands. A scroll event cannot
  // tell auto-scroll or Smart Read from a person, so on its own it kept the
  // heartbeat crediting minutes for a reader who had walked away. Hands-free
  // reading still counts, for a grace window after the last real input.
  const lastHandsOnAtRef = useRef(Date.now());
  const [focusToast, setFocusToast] = useState<string | null>(null);
  const focusToastTimerRef = useRef<number | null>(null);

  // The key handler is bound once; this keeps it calling the current toast.
  const showFocusToastRef = useRef<(message: string, ms?: number) => void>(() => undefined);

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
        cfiBelow?: number;
        chapterPositions?: Record<string, string>;
        wordsPerByte?: { ratio: number; bytes: number };
      };
    } catch {
      return null;
    }
  };

  const initialPrefs = readPrefs();
  const [readingMode, setReadingMode] = useState<ReadingMode>("standard");
  const [pendingReadingMode, setPendingReadingMode] = useState<Exclude<ReadingMode, "standard"> | null>(
    null
  );
  const [readingPaused, setReadingPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  return {
    viewerRef, toolbarRef, pacePillRef, chapterDockRef, renditionRef, bookRef, reloadKey, setReloadKey,
    navigatingUntilRef, markNavigating, readingModeRef, lastHandsOnAtRef, focusToast, focusToastTimerRef,
    showFocusToastRef, storageKey, initialPrefs, readingMode, setReadingMode, pendingReadingMode,
    setPendingReadingMode, readingPaused, setReadingPaused, loading, setLoading, loadError, setLoadError,
    showFocusToast
  };
};
