import { useEffect, useRef, useState } from "react";
import { type ReaderWord, type SmartSession } from "../readerTypes";
import { paceLimits, plainFromWpm, setBookPace, wpmFromPlain } from "../paceModel";
import { judgeCatchUp } from "../paceTracker";
import { easeInOutCubic, lineInArea, pastPictureGap, planScrollStep, readingBand, stepDuration, type ReadingArea } from "../smartScroll";
import { glideFrame, glideSet, startGlide } from "../glide";
import type { Later, WithAuto, WithKeys } from "./scope";

/** What this reaches that hooks called after it add (scope.ts). */
type SmartLater = Later<
  | "readerDotAnchorIndexRef" | "positionReaderDotAtWord" | "readerDotElementRef" | "moveReaderDot"
>;

/**
 * Smart Read: Dotty's pace and the reader's own say in it (scrolling ahead,
 * going back to reread, dragging Dotty, a picture in the way).
 */
export const useSmartRead = (reader: WithAuto & SmartLater) => {
  const {
    activeWordIndexRef, autoScrollActiveRef, awayRef, book, buildReadingWordState, chapterDockRef, countPause,
    displayedViews, ensureScrollContainer, expectedWpm, findNearestWordIndex, getReaderWordRect, lastHandsOnAtRef,
    layoutRef, learnPace, linePx, navigatingUntilRef, paceContext, pacePillRef, paceProfileRef, prepareReaderWords,
    programmaticScrollUntilRef, readerWordsRef, readerWordsStale, readingModeRef, scrollPaceRef, sectionSpan,
    setPaceTouched, setReadingPaused, setReadingWord, showFocusToast, stopFreeReading, toolbarRef, updatePaceProfile,
    wordIndexMissesView
  } = reader;
  const readingPausedRef = useRef(false);
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
  const nudgeSmartPaceRef = useRef<(factor: number) => void>(() => undefined);
  const toggleSmartPlayRef = useRef<() => void>(() => undefined);

  // A book opened in Smart Read starts paused, with its pill up saying so.
  // On a cover or a contents page there is nothing to set off: the pill is
  // held back until the reading line is in the story (see `releasePill`).
  const [pillHeld, setPillHeld] = useState(false);
  const pillHeldRef = useRef(false);
  const holdPill = (held: boolean) => {
    if (pillHeldRef.current !== held) {
      pillHeldRef.current = held;
      setPillHeld(held);
    }
  };

  /** Dotty's pace in Smart Read, for its controls. */
  const [smartWpm, setSmartWpm] = useState(0);
  /** Smart Read is waiting for a reader who went back to reread. */
  const [smartWaiting, setSmartWaiting] = useState(false);
  /**
   * Smart Read is resting at a picture (or any stretch with no words taller
   * than half the window: readers/smartScroll.ts) until the reader goes on.
   * The ref holds the last word read before it; `passed` is the last such
   * word gone on from, so the same picture is not stopped at twice.
   */
  const [smartAtPicture, setSmartAtPicture] = useState(false);
  const smartPictureRef = useRef<{ before: ReaderWord } | null>(null);
  const smartPicturePassedRef = useRef<ReaderWord | null>(null);

  /** Smart Read's pace is still the model's own guess: the reader has not corrected it this time. */
  const smartPaceFromModelRef = useRef(true);

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
    // From wherever the page is each frame (readers/glide.ts): a chapter let
    // go above mid-step moves the scroll position, and a step that counted
    // from where it began threw the text a chapter's height on.
    const glide = startGlide(start);
    const frame = (time: number) => {
      startedAt ??= time;
      const progress = Math.min(1, (time - startedAt) / duration);
      container.scrollTop = glideFrame(glide, container.scrollTop, distance * easeInOutCubic(progress));
      glideSet(glide, container.scrollTop);
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
    reader.readerDotAnchorIndexRef.current = clamped;
    agreeWithReader(clamped);
    reader.positionReaderDotAtWord(clamped);
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
      setPaceTouched((count) => count + 1);
    }
  };
  nudgeSmartPaceRef.current = nudgeSmartPace;

  /** Going on from a picture Smart Read stopped at: by Space, the play button, or scrolling past it by hand. */
  const goOnFromPicture = () => {
    const held = smartPictureRef.current;
    if (!held) {
      return false;
    }
    smartPicturePassedRef.current = held.before;
    smartPictureRef.current = null;
    setSmartAtPicture(false);
    lastHandsOnAtRef.current = Date.now();
    return true;
  };

  /**
   * Smart Read comes to rest at a picture after the word `before`: the last
   * line read goes to the top of the reading area, the picture under it, and
   * Dotty beside the picture's top. False when that line cannot be found.
   */
  const restAtPicture = (before: ReaderWord) => {
    const container = ensureScrollContainer();
    const rect = getReaderWordRect(before);
    if (!container || !rect) {
      return false;
    }
    smartPictureRef.current = { before };
    setSmartAtPicture(true);
    const lineTop = rect.top - container.getBoundingClientRect().top;
    placeDotAtPicture();
    turnSmartPage(container, lineTop - readingBand(readingArea(container)).top);
    return true;
  };

  /** Dotty beside the top of the picture Smart Read is resting at: half a line under the last line read. */
  const placeDotAtPicture = () => {
    const container = ensureScrollContainer();
    const before = smartPictureRef.current?.before;
    const rect = before ? getReaderWordRect(before) : null;
    const dot = reader.readerDotElementRef.current;
    if (!container || !rect || !dot) {
      return false;
    }
    const lineTop = rect.top - container.getBoundingClientRect().top;
    reader.moveReaderDot(dot, container, container.scrollTop + lineTop + rect.height + linePx() * 0.5, Number.parseFloat(dot.style.left) || 7);
    return true;
  };

  /** Where the chapters on the page end, from the top of the window: the foot of a stretch with no words after the last word. */
  const loadedEndTop = () => {
    const container = ensureScrollContainer();
    const view = displayedViews().pop();
    const last = view?.element as HTMLElement | undefined;
    if (!container || !last) {
      return null;
    }
    // (Less the room kept below the last line of the book, which is no picture.)
    const room = (view.contents?.document as Document | undefined)?.querySelector<HTMLElement>("[data-leaflet-end]")?.offsetHeight ?? 0;
    return last.getBoundingClientRect().bottom - room - container.getBoundingClientRect().top;
  };

  /**
   * Dotty is below the page: the reader went back above it, or it ran on
   * without them. Space (or the play button) then reads from what they are
   * looking at: Dotty comes up to the first line of the reading area, where
   * it can be seen and dragged to the very line. False when Dotty is not
   * below the page.
   *
   * Space used to carry on from Dotty, and the next page step took the page
   * down to it: with Dotty out of sight there was no way to say "I am here".
   * Going on from Dotty is still there: scroll down to it and it carries on.
   */
  const readFromHere = () => {
    if (readerWordsStale() || wordIndexMissesView()) {
      prepareReaderWords(false);
    }
    const container = ensureScrollContainer();
    const words = readerWordsRef.current;
    if (!container || words.length === 0 || !smartSessionRef.current) {
      return false;
    }
    // Where Dotty is: the last line read when it rests at a picture (the word
    // to read next is then below the picture), otherwise the word it is on.
    const resting = smartPictureRef.current;
    const place = resting?.before ?? words[Math.min(activeWordIndexRef.current, words.length - 1)];
    const rect = place ? getReaderWordRect(place) : null;
    if (!rect) {
      return false;
    }
    const area = readingArea(container);
    if (lineInArea(rect.top - container.getBoundingClientRect().top, area) !== "below") {
      return false;
    }
    // The same line a catch-up takes the reader to be on: near the top.
    const line = readingBand(area).top + area.lineHeight / 2;
    const index = findNearestWordIndex(line / Math.max(1, container.clientHeight));
    if (index >= activeWordIndexRef.current) {
      return false;
    }
    cancelSmartCatchUp();
    cancelSmartPageTurn();
    stopWaitingForReread();
    if (resting) {
      smartPictureRef.current = null;
      setSmartAtPicture(false);
    }
    // Going back says nothing about the pace: it is measured afresh from here.
    moveSmartDotty(index);
    smartManualOverrideUntilRef.current = 0;
    // A beat for the eye to find Dotty before it sets off.
    smartStepHoldUntilRef.current = Date.now() + 1200;
    lastHandsOnAtRef.current = Date.now();
    showFocusToast("Dotty came back to you.");
    return true;
  };

  /** Space, or the play button: read from here when Dotty is below the page, otherwise pause or carry on. */
  const toggleSmartPlay = () => {
    if (readFromHere()) {
      readingPausedRef.current = false;
      setReadingPaused(false);
      return;
    }
    if (goOnFromPicture()) {
      smartManualOverrideUntilRef.current = 0;
      readingPausedRef.current = false;
      setReadingPaused(false);
      return;
    }
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
    // Resting at a picture: the word to read next is below it, off the foot
    // of the window (or in a chapter not yet on the page), which is not the
    // reader going back to reread. Scrolling the text after the picture into
    // the reading area is them going on.
    if (smartPictureRef.current) {
      const afterTop = container ? (rect ? rect.top - container.getBoundingClientRect().top : loadedEndTop()) : null;
      if (container && afterTop !== null && pastPictureGap(afterTop, readingArea(container)) && goOnFromPicture()) {
        smartStepHoldUntilRef.current = Date.now() + 700;
      }
      return;
    }
    if (!container || !rect || !smartSessionRef.current) {
      return;
    }
    const area = readingArea(container);
    const where = lineInArea(rect.top - container.getBoundingClientRect().top, area);
    // Dotty's line not wholly in view at the top is behind the reader: the same
    // test the page steps use, so the two never pull the page opposite ways.
    if (where === "above") {
      stopWaitingForReread();
      smartReaderAheadRef.current = true;
      if (smartCatchUpTimerRef.current) {
        window.clearTimeout(smartCatchUpTimerRef.current);
      }
      smartCatchUpTimerRef.current = window.setTimeout(catchUpToReader, 1500);
      return;
    }
    cancelSmartCatchUp();
    if (where === "below") {
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
    if (readerWordsStale() || wordIndexMissesView()) {
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

  return {
    readingPausedRef, smartManualOverrideUntilRef, smartPlainRef, smartRereadRef, smartCatchUpTimerRef,
    smartStepHoldUntilRef, smartScrollFrameRef, smartSessionRef, nudgeSmartPaceRef, toggleSmartPlayRef, pillHeld,
    pillHeldRef, holdPill, smartWpm, setSmartWpm, smartWaiting, smartAtPicture, setSmartAtPicture, smartPictureRef,
    smartPicturePassedRef, smartPaceFromModelRef, cancelSmartPageTurn, scrollWordIntoReadingBand, cancelSmartCatchUp,
    smartWpmNow, agreeWithReader, stopWaitingForReread, nudgeSmartPace, restAtPicture, placeDotAtPicture, loadedEndTop,
    toggleSmartPlay, noteSmartDrag, observeManualReadingPosition, finishSmartSession
  };
};

/** Once the reader has set Smart Read off, its pill is theirs again wherever they are. */
export const usePillRelease = (reader: WithKeys) => {
  const { holdPill, readingPaused } = reader;
  // Once the reader has set Smart Read off, the pill is theirs again wherever they are.
  useEffect(() => {
    if (!readingPaused) {
      holdPill(false);
    }
  }, [readingPaused]);
};
