import { useEffect, useRef } from "react";
import { lineHeightPx } from "../readerTypes";
import { PAGE_TOP_PAD } from "../finish";
import { AUTO_SCROLL_YIELD_BACK_MS, AUTO_SCROLL_YIELD_AHEAD_MS, autoScrollLinesPerMinute } from "../autoScroll";
import { screenStep } from "../smartScroll";
import { keyTurns } from "../pageTurn";
import { actionFor, keyBelongsToControl } from "../readerKeys";
import { escapeTarget } from "../escapeOrder";
import { closeAmbiencePopover } from "../../ambience";
import { SMART_NUDGE } from "./constants";
import type { Later, WithSession } from "./scope";

/**
 * The keyboard: which key does what (readers/readerKeys.ts), and what Escape
 * closes first (readers/escapeOrder.ts).
 */
export const useReaderKeys = (reader: WithSession & Later<"people">) => {
  const {
    addBookmarkRef, autoScrollActive, autoScrollActiveRef, autoScrollSpeedRef, autoScrollYieldUntilRef,
    bookmarkPanelOpen, clearSelection, closeNoteRef, closeSearch, contentsOver, contentsPeekRef, exitGuard,
    fontPanelOpen, fontSizeRef, getScrollContainer, goBackRef, goForwardRef, goNextSection, goPrevSection, goToEdgeRef,
    lastHandsOnAtRef, layoutRef, lookUpShowing, markReadingActivity, morePanelOpen, note, nudgeSmartPaceRef, onClose,
    pendingReadingMode, picture, pictureRef, pinContents, readingMode, readingModeRef, readingPaused, renditionRef,
    requestReadingMode, scrollbarLetGoRef, searchOpen, selection, setAutoScrollActive, setBookmarkPanelOpen,
    setFontPanelOpen, setLookUpCfi, setMorePanelOpen, setPendingReadingMode, setPicture, setReadingPaused,
    setSearchOpen, setShortcutsOpen, setSidebarOpen, setSpeedReadWpm, setTourOpen, shortcutsOpen, shortcutsOpenRef,
    showFocusToastRef, sidebarPinnedRef, smoothScrollBy, soundPanelOpen, speedReadWpmRef, spotlightDotty,
    toggleContentsRef, toggleSmartPlayRef, tourOpen, triggerScrollAdvance, tuneAutoScroll, turnPageRef, typeChoiceRef
  } = reader;
  // Key and wheel input inside the epub.js iframe never reaches this window, so
  // the content documents forward to these (see bindContentInput).
  const readerKeyHandlerRef = useRef<((event: KeyboardEvent) => void) | null>(null);
  /** When a key last turned a page (layout "pages"), for pacing a held key. */
  const lastKeyTurnAtRef = useRef(0);

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
      // (A key is never held up by a scrollbar that was not seen let go.)
      scrollbarLetGoRef.current();
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
        case "contents":
          // The chapter list, to stay until it is shut (readers/contentsPanel.ts).
          if (!event.repeat) {
            toggleContentsRef.current();
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
          // In a right-to-left book the arrows follow the pages, as a click
          // at the side does: Left goes on. Space and Page Down always do.
          const on = action === "pagePrev" ? -1 : 1;
          const mirrored =
            (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
            (renditionRef.current?.manager as any)?.settings?.direction === "rtl";
          turnPageRef.current(mirrored ? (on === 1 ? -1 : 1) : on, event.repeat);
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
        case "scrollUp":
        case "screenDown":
        case "screenUp": {
          const container = getScrollContainer();
          if (!container) {
            return;
          }
          const down = action === "scrollDown" || action === "screenDown";
          if (autoScrollActiveRef.current) {
            autoScrollYieldUntilRef.current = Date.now() + (down ? AUTO_SCROLL_YIELD_AHEAD_MS : AUTO_SCROLL_YIELD_BACK_MS);
          }
          if (down && container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
            triggerScrollAdvance();
            return;
          }
          // An arrow: a fifth of the window. A Page key: a screen, less the
          // toolbar's strip and two lines (readers/smartScroll.ts).
          const step =
            action === "screenDown" || action === "screenUp"
              ? screenStep(container.clientHeight, PAGE_TOP_PAD, lineHeightPx(fontSizeRef.current, typeChoiceRef.current.spacing))
              : Math.max(120, Math.round(container.clientHeight * 0.2));
          if (action === "screenDown" || action === "screenUp") {
            // A screen read slowly and then turned with a Page key is a page
            // turn for reading time, as it is with pages (hooks/slowPage.ts):
            // a full screen of a wide column takes longer than the idle limit.
            markReadingActivity.pageTurned();
          }
          smoothScrollBy(container, step * (down ? 1 : -1));
          return;
        }
        case "chapterStart":
        case "chapterEnd":
        case "bookStart":
        case "bookEnd":
          // Jumps: Back returns (see goToEdgeRef).
          if (!event.repeat) {
            goToEdgeRef.current(action);
          }
          return;
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

  // For the key handler, which is bound once: what Escape closes now, and
  // bookmarking the place (they read this render's state).
  const escapeRef = useRef<(event: KeyboardEvent) => void>(() => undefined);

  /** A held Escape closes one thing: its repeats do nothing until it is let go. */
  const escapeClosedLayerRef = useRef(false);
  /** The progress bar's handle, for Escape (see ProgressBar's holdRef). */
  const seekHoldRef = useRef<{ held: () => boolean; letGo: () => void } | null>(null);

  escapeRef.current = (event) => {
    const layer = escapeTarget({
      picture: picture !== null,
      shortcuts: shortcutsOpen,
      startDialog: pendingReadingMode !== null,
      tour: tourOpen,
      seek: seekHoldRef.current?.held() ?? false,
      character: reader.people.cardOpen,
      lookup: lookUpShowing,
      note: note !== null,
      search: searchOpen,
      typePanel: fontPanelOpen,
      notesPanel: bookmarkPanelOpen,
      moreMenu: morePanelOpen || soundPanelOpen,
      sidePanel: reader.people.panelOpen,
      chapters: contentsOver,
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
        reader.people.closeCard();
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
        // (And not back to the card of the highlight it was opened on.)
        reader.setNotesFocus(null);
        setBookmarkPanelOpen(false);
        break;
      case "moreMenu":
        setMorePanelOpen(false);
        closeAmbiencePopover();
        break;
      case "sidePanel":
        reader.people.closePanel();
        break;
      case "chapters":
        if (sidebarPinnedRef.current) {
          pinContents(false);
        } else {
          contentsPeekRef.current.showing = false;
          setSidebarOpen(false);
        }
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

  return { readerKeyHandlerRef, seekHoldRef };
};
