import { useEffect } from "react";
import type { WithCover, WithModes } from "./scope";

/** What is saved with the book on this device. */
export const useReaderPrefs = (reader: WithModes) => {
  const {
    autoScrollSpeedRef, autoScrollTunedRef, chapterPositionsRef, displayModeRef, fontSizeRef, lastCfiBelowRef,
    lastCfiProgressRef, lastCfiRef, placeFollowsNow, readerDotEnabledRef, sidebarRef, speedReadWpmRef, storageKey,
    storedPlaceRef, wordRatioRef
  } = reader;
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
          cfiBelow: lastCfiBelowRef.current || undefined,
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

  return { persistReaderState };
};

/** Saves them when one of the book's preferences changes. */
export const usePrefsSaving = (reader: WithCover) => {
  const {
    autoScrollSpeed, displayMode, fontSize, fontSizeRef, persistReaderState, sidebarOpen, speedReadWpm, storageKey
  } = reader;
  useEffect(() => {
    try {
      fontSizeRef.current = fontSize;
      persistReaderState();
    } catch {
      // ignore
    }
  }, [fontSize, sidebarOpen, displayMode, autoScrollSpeed, speedReadWpm, storageKey]);
};
