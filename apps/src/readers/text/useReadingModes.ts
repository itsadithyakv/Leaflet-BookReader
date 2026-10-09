import { useEffect, useRef, useState, type CSSProperties } from "react";
import { watchForeground } from "../../services/windowService";
import { keepAwake } from "../../services/keepAwake";
import { type ReadingMode, type ReaderWord } from "../readerTypes";
import { PAGE_TOP_PAD } from "../finish";
import { rsvpStageVars, rsvpRamp, getPaceFactor, handsFreeCounts, stillTooLong } from "../pacing";
import { predictPlainWpm } from "../paceModel";
import { isPictureGap } from "../smartScroll";
import type { WithChrome, WithCover, WithPanels } from "./scope";

/**
 * Smart Read and SpeedRead as ways of reading: asking for one, starting it
 * from a line, and what SpeedRead's stage is drawn from.
 */
export const useReadingModes = (reader: WithPanels) => {
  const {
    activeWordIndexRef, autoScrollActive, ensureScrollContainer, findNearestWordIndex, fontSizeRef, initialPrefs,
    pendingReadingMode, positionReaderDotAtWord, prepareReaderWords, readerDotAnchorIndexRef, readerDotEnabledRef,
    readerDotOffscreenTimerRef, readerDotUserAnchorUntilRef, readerWordsRef, readingMode, readingWord,
    scheduleReaderWordIndex, setMorePanelOpen, setPendingReadingMode, setReadingMode, setReadingPaused
  } = reader;
  const readingEngineTimerRef = useRef<number | null>(null);

  /** The mode before this one, for what leaving it leaves behind. */
  const modeBeforeRef = useRef<ReadingMode>("standard");
  const speedReadWpmRef = useRef(260);
  const requestedStartIndexRef = useRef<number | null>(null);

  /** Something covers the page (a panel, a selection, the tour): hands-free reading waits. */
  const interruptedRef = useRef(false);

  /** What to tell the reader when they come back, if reading was paused while they were away. */
  const pausedWhileAwayRef = useRef<string | null>(null);
  /** Smart Read starts paused (opening a book in it), for the reader to set off. */
  const startPausedRef = useRef(false);

  const [speedReadWpm, setSpeedReadWpm] = useState(
    Math.min(1000, Math.max(120, initialPrefs?.speedReadWpm ?? 260))
  );

  speedReadWpmRef.current = speedReadWpm;

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
  const rsvpWordsLeft = readingWord ? Math.max(0, readingWord.sectionEnd - readingWord.index - 1) : 0;
  const rsvpMinutesLeft = Math.max(1, Math.round(rsvpWordsLeft / Math.max(60, speedReadWpm)));
  const rsvpProgress = readingWord
    ? (readingWord.index - readingWord.sectionStart + 1) / Math.max(1, readingWord.sectionEnd - readingWord.sectionStart)
    : 0;
  // What sits above the chapter dock (the selection bar, a note) moves up
  // when auto-scroll's or Smart Read's controls are showing in that place.
  const dockAbovePace = (readingMode === "standard" && autoScrollActive) || (readingMode === "smart" && !pendingReadingMode);

  return {
    readingEngineTimerRef, modeBeforeRef, speedReadWpmRef, requestedStartIndexRef, interruptedRef, pausedWhileAwayRef,
    startPausedRef, speedReadWpm, setSpeedReadWpm, requestReadingMode, beginReadingMode, rsvpPivot, rsvpWordStyle,
    rsvpMinutesLeft, rsvpProgress, dockAbovePace
  };
};

/**
 * Keeps the screen on while the page is reading itself: auto-scroll running,
 * or Dotty or word by word not paused. Those pause by themselves when the
 * window is left, and, for a reader who asked for it, when the reader has
 * gone quiet for long enough ("Still reading?"); the screen is let go with
 * them.
 */
export const useAwakeWhileReading = (reader: WithCover) => {
  const { autoScrollActive, readingMode, readingPaused } = reader;
  const reading = autoScrollActive || (readingMode !== "standard" && !readingPaused);
  useEffect(() => {
    keepAwake(reading);
  }, [reading]);
  // Closing the book lets go whatever was playing.
  useEffect(() => () => keepAwake(false), []);
};

/** What hands-free reading is waiting on while something lies over the text. */
export const useReadingHold = (reader: WithChrome) => {
  const {
    bookmarkPanelOpen, contentsOver, fontPanelOpen, interruptedRef, note, notesFocus, pendingReadingMode, people,
    picture, recap, searchOpen, selection, shortcutsOpen, tourOpen
  } = reader;
  // What hands-free reading is waiting on, in words for its controls: they
  // must never show a pace while nothing is moving.
  const holdReason =
    selection !== null
      ? "Text is selected · Esc lets it go"
      : searchOpen
        ? "Search is open"
        : bookmarkPanelOpen || notesFocus !== null
          ? "Notes are open"
          : contentsOver
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
                        : recap !== null
                          ? "Where you are is open"
                          : null;
  // Anything over the text (a selection, search, notes, the chapter list, a
  // dialog) makes auto-scroll and Smart Read wait; they carry on by themselves
  // once it is gone.
  interruptedRef.current =
    selection !== null ||
    searchOpen ||
    bookmarkPanelOpen ||
    notesFocus !== null ||
    contentsOver ||
    tourOpen ||
    fontPanelOpen ||
    note !== null ||
    picture !== null ||
    shortcutsOpen ||
    people.cardOpen ||
    people.panelOpen ||
    recap !== null ||
    pendingReadingMode !== null;

  return { holdReason };
};

/**
 * Runs Smart Read and SpeedRead word by word, and stops everything that
 * moves on its own while Leaflet is not the app in front.
 */
export const useReadingEngine = (reader: WithCover) => {
  const {
    activeWordIndexRef, autoScrollActiveRef, autoScrollHeldRef, awayRef, book, buildReadingWordState,
    cancelSmartCatchUp, ensureScrollContainer, findNearestWordIndex, finishSmartSession, getReaderWordRect,
    hasFurtherSection, holdPill, interruptedRef, lastHandsOnAtRef, learnPace, loadedEndTop, loadFurther,
    markReadingActivity, modeBeforeRef, paceContext, paceProfileRef, pausedWhileAwayRef, persistReaderState,
    positionReaderDotAtWord, prepareReaderWords, programmaticScrollUntilRef, readerDotAnchorIndexRef, readerDotEnabled,
    readerDotOffscreenTimerRef, readerDotUserAnchorUntilRef, readerWordsRef, readerWordsStale, readingEngineTimerRef,
    readingMode, readingModeRef, readingPaceScaleRef, readingPaused, readingPausedRef, removeLastReadMarker,
    renditionRef, requestedStartIndexRef, restAtPicture, savePaceProfileRef, scrollWordIntoReadingBand,
    sectionWordDifficultyRef, setAutoScrollActive, setReadingPaused, setReadingWord, setSmartAtPicture, setSmartWpm,
    showFocusToast, showFocusToastRef, smartManualOverrideUntilRef, smartPaceFromModelRef, smartPicturePassedRef,
    smartPictureRef, smartPlainRef, smartRereadRef, smartSessionRef, smartStepHoldUntilRef, smartWpmNow, speedReadWpm,
    speedReadWpmRef, startPausedRef, stopFreeReading, stopFreeReadingRef, stopWaitingForReread, updateLastReadMarker,
    wordIndexTimerRef
  } = reader;
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
    smartPictureRef.current = null;
    smartPicturePassedRef.current = null;
    setSmartAtPicture(false);
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
    holdPill(startPaused && readingMode === "smart");
    if (readingEngineTimerRef.current) {
      window.clearTimeout(readingEngineTimerRef.current);
      readingEngineTimerRef.current = null;
    }
    const cameFrom = modeBeforeRef.current;
    modeBeforeRef.current = readingMode;
    if (readingMode === "standard") {
      finishSmartSession();
      setReadingWord(null);
      // Leaving SpeedRead or Smart Read: Dotty stays beside the last word
      // read, for a minute, so the eye finds the place on the page. It used
      // to go straight to the last visible line, most of a screen below.
      const lastRead = readerWordsRef.current[Math.max(0, activeWordIndexRef.current - 1)];
      if (cameFrom !== "standard" && readerDotEnabled && lastRead?.iframe.isConnected) {
        readerDotUserAnchorUntilRef.current = Date.now() + 60_000;
        positionReaderDotAtWord(Math.max(0, activeWordIndexRef.current - 1));
        return;
      }
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
    // The word last read in this run: a picture is rested at only when the
    // reading has come down to it, not when it starts just below one.
    let lastRead: ReaderWord | null = null;
    const schedule = (delay: number) => {
      if (stopped) return;
      readingEngineTimerRef.current = window.setTimeout(() => {
        if (stopped || readingModeRef.current === "standard") return;
        // Smart Read waits, without counting the time, while a hand is on the
        // page, the reader went back to reread, a panel or selection covers
        // the text, or a page step is settling.
        // Resting at a picture, unless the reading has gone elsewhere since
        // (a jump, another chapter): then there is nothing to rest at.
        const resting = smartPictureRef.current;
        if (resting) {
          const last = readerWordsRef.current[activeWordIndexRef.current - 1];
          if (readingModeRef.current !== "smart" || !last || last.node !== resting.before.node || last.start !== resting.before.start) {
            smartPictureRef.current = null;
            setSmartAtPicture(false);
          }
        }
        const waiting =
          readingModeRef.current === "smart" &&
          (autoScrollHeldRef.current ||
            smartRereadRef.current ||
            smartPictureRef.current !== null ||
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
        // A picture between the word just read and this one (a full-page map
        // between two chapters, a plate): Smart Read rests at it until the
        // reader goes on. It used to pass it in the one step that carried the
        // page to the next word, in under a second.
        const previous = index > 0 ? words[index - 1] : undefined;
        const passed = smartPicturePassedRef.current;
        if (
          mode === "smart" &&
          previous &&
          lastRead &&
          previous.node === lastRead.node &&
          previous.start === lastRead.start &&
          !(passed && passed.node === previous.node && passed.start === previous.start)
        ) {
          const before = getReaderWordRect(previous);
          const after = getReaderWordRect(word);
          const container = ensureScrollContainer();
          if (
            before &&
            after &&
            container &&
            isPictureGap(before.top + before.height, after.top, container.clientHeight) &&
            restAtPicture(previous)
          ) {
            schedule(180);
            return;
          }
        }
        // Playing hands-free counts as reading for the same grace window as
        // auto-scroll. Past it, for a reader who asked for that, pause rather
        // than play on to an empty room: a reader who stepped away comes back
        // to the word they left on. Otherwise it reads on, and the minutes
        // stop being counted an hour after the last touch (readers/pacing.ts).
        const quiet = now - lastHandsOnAtRef.current;
        if (stillTooLong(quiet)) {
          readingPausedRef.current = true;
          setReadingPaused(true);
          showFocusToast("Still reading? Press Space to carry on.");
          schedule(180);
          return;
        }
        if (handsFreeCounts(quiet)) {
          markReadingActivity();
        }
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
        lastRead = word;
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
        // The chapter's words have run out and a picture follows (a chapter
        // that is all picture, a plate at a chapter's end): Smart Read rests
        // at it until the reader goes on, and only then looks further.
        if (readingModeRef.current === "smart") {
          if (smartPictureRef.current || readingPausedRef.current) {
            readingEngineTimerRef.current = window.setTimeout(waitForMore, 250);
            return;
          }
          const words = readerWordsRef.current;
          const last = words[words.length - 1];
          const container = ensureScrollContainer();
          const read = last ? getReaderWordRect(last) : null;
          const end = loadedEndTop();
          const passed = smartPicturePassedRef.current;
          if (
            last &&
            read &&
            container &&
            end !== null &&
            !(passed && passed.node === last.node && passed.start === last.start) &&
            isPictureGap(read.top + read.height - container.getBoundingClientRect().top, end, container.clientHeight) &&
            restAtPicture(last)
          ) {
            readingEngineTimerRef.current = window.setTimeout(waitForMore, 250);
            return;
          }
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
};
