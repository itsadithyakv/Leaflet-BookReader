import { useEffect, useMemo, useRef, useState } from "react";
import { readLayout, readMeasure, type TocItem } from "../readerTypes";
import { readerTourSeen } from "../ReaderTour";
import { seekTarget } from "../seek";
import { PEEK_MS, contentsSeen, leftOpen, listFitsBeside, marginBesideText, reopensWith, saveLeftOpen, setContentsSeen, shouldPeek } from "../contentsPanel";
import type { Later, WithAnnotations, WithNotes } from "./scope";

/**
 * The chapter list: opened on purpose it stays, opened from the window's
 * edge it goes when the pointer does.
 */
export const useContentsList = (reader: WithNotes & Later<"persistReaderState">) => {
  const {
    askedEntryRef, contents, displayChapter, fontSize, goToPlace, initialPrefs, layout, layoutRef, measure,
    noteJumpFromHere, outlook, sectionWeightsRef, toc
  } = reader;
  const sidebarOpenTimerRef = useRef<number | null>(null);
  const sidebarCloseTimerRef = useRef<number | null>(null);

  // The chapter list (readers/contentsPanel.ts). Opened on purpose (its
  // handle, the toolbar, the dock, the C key) it is pinned: it stays until it
  // is shut, and the choice is remembered. Opened by resting the pointer on
  // the window's edge it goes when the pointer does. A list left open comes
  // back open with the book where it fits beside the text.
  const [sidebarPinned, setSidebarPinned] = useState(() =>
    reopensWith(leftOpen(initialPrefs?.sidebarOpen), marginBesideText(window.innerWidth, readMeasure(), initialPrefs?.fontSize ?? 18, readLayout()))
  );
  const [sidebarOpen, setSidebarOpen] = useState(sidebarPinned);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);

  // Whether the reader left the list open, as saved with the book.
  const sidebarRef = useRef(leftOpen(initialPrefs?.sidebarOpen));

  // The margin beside the text (readers/contentsPanel.ts): what the handle on
  // the edge may be, and whether the open list is beside the text or over it.
  // Beside it, a list left open holds nothing up.
  const textMargin = marginBesideText(windowWidth, measure, fontSize, layout);
  const contentsBeside = sidebarOpen && sidebarPinned && listFitsBeside(textMargin);
  const contentsOver = sidebarOpen && !contentsBeside;

  // The chapter list of a set says how each book in it stands: from the place the progress stands for.
  const contentsPlace = useMemo(() => {
    const weights = sectionWeightsRef.current;
    return weights && contents.books.length > 0 && outlook.progress !== null ? seekTarget(weights, outlook.progress) : null;
  }, [outlook.progress, contents]);
  // A row of the list was chosen. The list stays when it is pinned beside the text; over the text it has done its work.
  const goToContentsEntryRef = useRef<(item: TocItem) => void>(() => undefined);
  goToContentsEntryRef.current = (item) => {
    noteJumpFromHere();
    // (With pages, the chapter asked for is named on the page it starts on: see askedEntryRef.)
    askedEntryRef.current = layoutRef.current === "pages" && toc.indexOf(item) >= 0 ? { entry: toc.indexOf(item), at: null } : null;
    if (item.cfi) {
      // An entry that is a place in its file, not an id (a made chapter list).
      goToPlace(item.cfi);
    } else {
      displayChapter(item.href, { useSaved: false });
    }
    if (!(sidebarPinnedRef.current && listFitsBeside(textMargin))) {
      contentsPeekRef.current.showing = false;
      setSidebarPinned(false);
      setSidebarOpen(false);
    }
  };
  const goToContentsEntry = useRef((item: TocItem) => goToContentsEntryRef.current(item)).current;

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
    // A list opened on purpose stays; one that showed itself goes with its own timer.
    if (sidebarPinnedRef.current || contentsPeekRef.current.showing) {
      return;
    }
    sidebarCloseTimerRef.current = window.setTimeout(() => {
      setSidebarOpen(false);
      sidebarCloseTimerRef.current = null;
    }, 220);
  };

  const sidebarPinnedRef = useRef(sidebarPinned);
  sidebarPinnedRef.current = sidebarPinned;
  const sidebarShownRef = useRef(sidebarOpen);
  sidebarShownRef.current = sidebarOpen;
  /** The one time the list shows itself (readers/contentsPanel.ts): whether it is doing so now, and its timers. */
  const contentsPeekRef = useRef<{ showing: boolean; timers: number[] }>({ showing: false, timers: [] });

  /** Opens or shuts the chapter list on purpose: it stays as put, and the choice is remembered for this book and this device. */
  const pinContents = (open: boolean) => {
    cancelReaderSidebarOpen();
    if (sidebarCloseTimerRef.current) {
      window.clearTimeout(sidebarCloseTimerRef.current);
      sidebarCloseTimerRef.current = null;
    }
    contentsPeekRef.current.showing = false;
    setSidebarPinned(open);
    setSidebarOpen(open);
    sidebarRef.current = open;
    saveLeftOpen(open);
    try {
      reader.persistReaderState();
    } catch {
      // The choice holds for this visit.
    }
  };
  /** The handle, the toolbar button, the dock's chapter name and the C key: shut when it is open and pinned, else open and pin it. */
  const toggleContents = () => pinContents(!(sidebarShownRef.current && sidebarPinnedRef.current));
  const toggleContentsRef = useRef(toggleContents);
  toggleContentsRef.current = toggleContents;

  return {
    sidebarOpenTimerRef, sidebarCloseTimerRef, sidebarPinned, sidebarOpen, setSidebarOpen, setWindowWidth, sidebarRef,
    textMargin, contentsBeside, contentsOver, contentsPlace, goToContentsEntry, openReaderSidebar,
    scheduleReaderSidebarOpen, cancelReaderSidebarOpen, scheduleReaderSidebarClose, sidebarPinnedRef, sidebarShownRef,
    contentsPeekRef, pinContents, toggleContents, toggleContentsRef
  };
};

/**
 * The list showing itself once on this device's first book, and the width of
 * the window it has to fit beside.
 */
export const useContentsListShowing = (reader: WithAnnotations) => {
  const {
    contentsPeekRef, loading, setSidebarOpen, setWindowWidth, sidebarPinnedRef, sidebarShownRef, tourOpen
  } = reader;
  // The first book opened on this device: the list shows itself for a moment
  // and tucks away again, so the reader sees where it lives. Once, ever (the
  // walkthrough's own step about the list counts), and not in a window too
  // narrow for it.
  useEffect(() => {
    // (Not while the walkthrough is still to come or is showing: it has a step for the list, and this waits for it to close.)
    if (loading || tourOpen || !readerTourSeen() || !shouldPeek(contentsSeen(), window.innerWidth)) {
      return;
    }
    setContentsSeen();
    const peek = contentsPeekRef.current;
    peek.timers.push(
      window.setTimeout(() => {
        if (!sidebarShownRef.current) {
          peek.showing = true;
          setSidebarOpen(true);
        }
      }, 700),
      window.setTimeout(() => {
        if (peek.showing) {
          peek.showing = false;
          if (!sidebarPinnedRef.current) {
            setSidebarOpen(false);
          }
        }
      }, 700 + PEEK_MS)
    );
  }, [loading, tourOpen]);
  useEffect(
    () => () => {
      contentsPeekRef.current.timers.forEach((timer) => window.clearTimeout(timer));
    },
    []
  );

  // How wide the margin beside the text is: what the handle may be, and whether the open list covers the text.
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
};
