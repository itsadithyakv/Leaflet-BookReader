import { useEffect, useRef } from "react";
import { useLibraryStore } from "../../store/libraryStore";
import { getReadingTimeBand } from "../../services/smartReadService";
import { createReadingProfile, mergeProfiles, notePause, predictPlainWpm, predictWpm, recordSample, type OutlierStreak, type PaceSource, type ReadingProfile } from "../paceModel";
import { PagePaceTracker, ScrollPaceTracker } from "../paceTracker";
import { readingProfileService } from "../../services/readingProfileService";
import type { WithAnnotations, WithCore } from "./scope";

/**
 * What Leaflet has learned of this reader's pace (readers/paceModel.ts), and
 * what free reading teaches it.
 */
export const useReadingPace = (reader: WithCore) => {
  const { book } = reader;
  /** Leaflet is not the app in front. */
  const awayRef = useRef(false);

  /** How hard the chapter on screen reads (see paceModel), and its words' average difficulty. */
  const sectionDifficultyRef = useRef(1.06);

  // Free reading teaches the pace too: words passing the reading line as the
  // reader scrolls, or the words on each page they turn.
  const scrollPaceRef = useRef(new ScrollPaceTracker());
  const pagePaceRef = useRef(new PagePaceTracker());
  const pageShownRef = useRef<{ href: string; page: number; total: number } | null>(null);

  // Called from the foreground watcher, bound once.
  const stopFreeReadingRef = useRef<() => void>(() => undefined);
  const savePaceProfileRef = useRef<() => void>(() => undefined);

  // The old, device-only Smart Read profile keyed off the connected Google
  // account; that is where it is looked for when bringing it over.
  const accountEmail = useLibraryStore((state) => state.sync.accountEmail);
  // What Leaflet has learned about this reader's pace (readers/paceModel.ts).
  // It comes from the library, and so from every device the reader syncs;
  // learning here is saved back a few seconds after it changes, and on close.
  const paceProfileRef = useRef<ReadingProfile>(createReadingProfile());
  const paceSaveTimerRef = useRef<number | null>(null);
  const paceStreakRef = useRef<OutlierStreak>(null);

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

  return {
    awayRef, sectionDifficultyRef, scrollPaceRef, pagePaceRef, pageShownRef, stopFreeReadingRef, savePaceProfileRef,
    accountEmail, paceProfileRef, paceSaveTimerRef, paceContext, updatePaceProfile, learnPace, expectedWpm, countPause,
    stopFreeReading
  };
};

/**
 * The pace comes from the library when the book opens, and what this visit
 * taught goes back when it closes.
 */
export const usePaceKeeping = (reader: WithAnnotations) => {
  const {
    accountEmail, finishSmartSession, paceContext, paceProfileRef, paceSaveTimerRef, readingModeRef,
    smartPaceFromModelRef, smartPlainRef, stopFreeReadingRef
  } = reader;
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
};
