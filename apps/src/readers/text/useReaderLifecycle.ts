import { useEffect } from "react";
import { bookService } from "../../services/bookService";
import { recordStop } from "../../pip/readingMoments";
import { NO_JUMPS } from "../jumpHistory";
import { holdsPrepend } from "../jumpSettle";
import { placeOnLeaving } from "../readingPlace";
import type { WithAnnotations, WithKeys } from "./scope";

/** Closing the reader: timers cleared, and the place and progress handed to the library. */
export const useCloseBook = (reader: WithKeys) => {
  const {
    book, checkpointTimerRef, dockAwakeTimerRef, focusToastTimerRef, keyScrollFrameRef, lastCfiProgressRef, lastCfiRef,
    lastComputedProgressRef, manualScrollTimerRef, openedAtPlaceRef, openedAtRef, persistReaderState, placeFollowsNow,
    progressArmedRef, readerDotDragFrameRef, readerDotOffscreenTimerRef, readingEngineTimerRef, scrollAdvanceTimerRef,
    sidebarCloseTimerRef, sidebarOpenTimerRef, smartCatchUpTimerRef, smartScrollFrameRef, updateBookProgress,
    wordIndexTimerRef
  } = reader;
  useEffect(() => {
    /**
     * The app going out of sight (Home, another app over it, a reply typed
     * into a notification) or the page going away: the exact place is saved
     * then, as well as each time the page comes to rest, so that whatever
     * reopens the book (the phone stopping the app meanwhile) reopens it on
     * the line, not where it was last saved. Not while the page is between
     * places (readers/readingPlace.ts: placeOnLeaving). Nothing on the page
     * moves.
     */
    const saveOnLeaving = (event: Event) => {
      if (event.type !== "pagehide" && document.visibilityState !== "hidden") {
        return;
      }
      if (!progressArmedRef.current || !placeFollowsNow()) {
        return;
      }
      const layout = reader.layoutRef.current;
      const line = layout === "scroll" ? reader.readingPlace() : null;
      const carried = reader.carriedPlaceRef.current;
      const cfi = placeOnLeaving({
        layout,
        readingLine: line?.cfi ?? null,
        pagePlace: reader.pagePlaceRef.current?.cfi ?? null,
        carried: layout === "pages" && carried && Date.now() <= carried.until ? carried.cfi : null,
        settling: holdsPrepend(reader.jumpHoldRef.current, Date.now()),
        relaying: reader.relayingRef.current
      });
      if (!cfi) {
        return;
      }
      lastCfiRef.current = cfi;
      reader.lastCfiBelowRef.current = line && line.cfi === cfi ? Math.round(line.below) : 0;
      persistReaderState({ cfi });
      if (lastComputedProgressRef.current >= 0) {
        const progress = Math.min(1, Math.max(0, lastCfiProgressRef.current ?? lastComputedProgressRef.current));
        void bookService.updateProgress(book.id, progress, cfi);
        updateBookProgress(book.id, progress, cfi);
      }
    };
    document.addEventListener("visibilitychange", saveOnLeaving);
    window.addEventListener("pagehide", saveOnLeaving);
    return () => {
      document.removeEventListener("visibilitychange", saveOnLeaving);
      window.removeEventListener("pagehide", saveOnLeaving);
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
      if (keyScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(keyScrollFrameRef.current);
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
      // What Pip is told of this stop (mid-chapter? she will have a word): after reading, not after a look.
      if (progressArmedRef.current) {
        recordStop(book.id, openedAtRef.current);
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
};

/** Another book in the same reader starts from nothing. */
export const useBookChange = (reader: WithAnnotations) => {
  const {
    book, cancelSmartCatchUp, jumpBelowRef, jumpsRef, readerDotAnchorIndexRef, readerDotOffscreenTimerRef,
    readerDotUserAnchorUntilRef, requestedStartIndexRef, sectionWordsRef, setAutoScrollActive, setBookmarkPanelOpen,
    setFontPanelOpen, setJumps, setMorePanelOpen, setPendingReadingMode, setReadingMode, setReadingPaused,
    setReadingWord, shownMinutesRef, smartRereadRef
  } = reader;
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
    jumpBelowRef.current = new Map();
    setJumps({ back: 0, forward: 0 });
    sectionWordsRef.current = new Map();
    shownMinutesRef.current = { chapter: null, book: null };
  }, [book.id]);
};
