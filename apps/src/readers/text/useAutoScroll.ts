import { useEffect, useRef, useState } from "react";
import { PAGE_TOP_PAD } from "../finish";
import { AUTO_SCROLL_DEFAULT_KEY, AUTO_SCROLL_YIELD_BACK_MS, AUTO_SCROLL_YIELD_AHEAD_MS, AUTO_SCROLL_TUNE_COOLDOWN_MS, autoScrollLinesPerMinute, autoScrollPixelsPerSecond, autoScrollSpeedForLines, readAutoScrollDefault } from "../autoScroll";
import { HANDS_FREE_GRACE_MS } from "../pacing";
import { predictWpm, readerPace } from "../paceModel";
import type { Later, WithCover, WithWords } from "./scope";

/** Auto-scroll: its speed, the hand that holds it, and the corrections that retune it. */
export const useAutoScroll = (reader: WithWords & Later<"cancelSmartPageTurn" | "smartStepHoldUntilRef">) => {
  const {
    book, ensureScrollContainer, initialPrefs, learnPace, linePx, paceContext, paceProfileRef, readerWordsRef,
    readingModeRef, showFocusToast, wordFramesRef
  } = reader;
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollLastTimeRef = useRef<number | null>(null);
  const autoScrollCarryRef = useRef(0);

  // Bound into the book's iframes and listeners once; they read live state
  // through these.
  const holdAutoScrollRef = useRef<(held: boolean) => void>(() => undefined);
  const noteAutoScrollCorrectionRef = useRef<(container: HTMLElement, deltaY: number) => void>(
    () => undefined
  );

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
  // Counts changes of pace made by hand: each one shows the pace control
  // again for a moment (it fades out while reading is left alone).
  const [paceTouched, setPaceTouched] = useState(0);
  const autoScrollYieldUntilRef = useRef(0);
  // Hand scrolling during auto-scroll is a correction: ahead means too slow,
  // back means too fast. Bursts are summed, then retune the speed a notch.
  const autoScrollCorrectionRef = useRef({ net: 0, lastAt: 0 });
  const autoScrollTunedAtRef = useRef(0);
  const autoScrollSpeedRef = useRef(autoScrollSpeed);
  autoScrollSpeedRef.current = autoScrollSpeed;
  autoScrollActiveRef.current = autoScrollActive;

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
    setPaceTouched((count) => count + 1);
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
      reader.cancelSmartPageTurn();
    } else {
      // A short breath after letting go, so the line being read stays put.
      autoScrollYieldUntilRef.current = Math.max(autoScrollYieldUntilRef.current, Date.now() + 400);
      reader.smartStepHoldUntilRef.current = Math.max(reader.smartStepHoldUntilRef.current, Date.now() + 400);
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

  return {
    autoScrollRafRef, autoScrollLastTimeRef, autoScrollCarryRef, holdAutoScrollRef, noteAutoScrollCorrectionRef,
    autoScrollActive, setAutoScrollActive, autoScrollSpeed, setAutoScrollSpeed, autoScrollTunedRef, autoScrollPacedRef,
    autoScrollRunRef, autoScrollActiveRef, autoScrollHeldRef, autoScrollHeld, paceTouched, setPaceTouched,
    autoScrollYieldUntilRef, autoScrollSpeedRef, autoScrollSpeedForPace, tuneAutoScroll, commitAutoScrollRun
  };
};

/** Runs auto-scroll, and lets go of it. */
export const useAutoScrollEngine = (reader: WithCover) => {
  const {
    autoScrollActive, autoScrollCarryRef, autoScrollHeld, autoScrollHeldRef, autoScrollLastTimeRef, autoScrollPacedRef,
    autoScrollRafRef, autoScrollRunRef, autoScrollSpeed, autoScrollSpeedForPace, autoScrollTunedRef,
    autoScrollYieldUntilRef, book, commitAutoScrollRun, ensureScrollContainer, hasFurtherSection, holdAutoScrollRef,
    interruptedRef, isAtScrollBottom, lastHandsOnAtRef, linePx, setAutoScrollActive, setAutoScrollSpeed,
    showFocusToastRef, stopFreeReadingRef, triggerScrollAdvance
  } = reader;
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
};
