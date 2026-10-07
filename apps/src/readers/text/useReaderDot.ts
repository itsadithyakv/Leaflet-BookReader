import { useEffect, useRef, useState } from "react";
import { dotIsStranded, dragEdgeSpeed } from "../readerDot";
import { type ReaderWord } from "../readerTypes";
import type { WithCover, WithSmart } from "./scope";

/** Dotty's width, in pixels (its look is in index.css). */
const DOT_SIZE = 7;

/**
 * Dotty: the dot that marks the line. Where it sits, the reader moving it, and
 * the mark left on the last line read.
 */
export const useReaderDot = (reader: WithSmart) => {
  const {
    activeWordIndexRef, buildReadingWordState, cancelSmartPageTurn, contentsForCfi, ensureScrollContainer,
    findNearestWordIndex, getReaderWordRect, initialPrefs, keptWordPlaceRef, layout, linePx, loadFurther,
    noteSmartDrag, programmaticScrollUntilRef, readerWordsRef, readingModeRef, renditionRef, scrollContainerRef,
    setReadingWord, smartManualOverrideUntilRef, wordSectionIdsRef
  } = reader;
  const lastMarkerRef = useRef<string | null>(null);
  const readerDotTimerRef = useRef<number | null>(null);
  const readerDotRetryTimerRef = useRef<number | null>(null);
  const readerDotDragFrameRef = useRef<number | null>(null);
  const readerDotOffscreenTimerRef = useRef<number | null>(null);
  const readerDotRetryRef = useRef<{ cfi: string; count: number }>({ cfi: "", count: 0 });
  const readerDotElementRef = useRef<HTMLElement | null>(null);
  const readerDotEnabledRef = useRef(true);
  const readerDotAnchorIndexRef = useRef<number | null>(null);
  const readerDotUserAnchorUntilRef = useRef(0);
  const [readerDotEnabled, setReaderDotEnabled] = useState(initialPrefs?.readerDotEnabled ?? true);

  // Sync during render: the load effect runs before the [readerDotEnabled]
  // effect, and would otherwise create a dot the user had switched off.
  readerDotEnabledRef.current = readerDotEnabled && layout === "scroll";

  const applyUserReadingAnchor = (
    index: number,
    options?: { commitPaceFrom?: number }
  ) => {
    const words = readerWordsRef.current;
    if (words.length === 0) return;
    if (readerDotOffscreenTimerRef.current) {
      window.clearTimeout(readerDotOffscreenTimerRef.current);
      readerDotOffscreenTimerRef.current = null;
    }
    const clampedIndex = Math.min(words.length - 1, Math.max(0, index));
    readerDotAnchorIndexRef.current = clampedIndex;
    readerDotUserAnchorUntilRef.current = Number.POSITIVE_INFINITY;
    activeWordIndexRef.current = clampedIndex;
    programmaticScrollUntilRef.current = 0;
    smartManualOverrideUntilRef.current = Date.now() + 2200;

    // Only a completed gesture adjusts the pace, and it is measured from where
    // the gesture started rather than from the previous animation frame.
    const paceOrigin = options?.commitPaceFrom;
    if (paceOrigin !== undefined && readingModeRef.current === "smart") {
      noteSmartDrag(paceOrigin, clampedIndex);
    }

    if (readingModeRef.current !== "standard") {
      setReadingWord(buildReadingWordState(clampedIndex));
    }
    positionReaderDotAtWord(clampedIndex);
  };

  const makeReaderDotInteractive = (element: HTMLElement, container: HTMLElement) => {
    if (!element.querySelector(".reader-dot-sparks")) {
      const sparks = element.ownerDocument.createElement("span");
      sparks.className = "reader-dot-sparks";
      sparks.setAttribute("aria-hidden", "true");
      for (let index = 1; index <= 5; index += 1) {
        const spark = element.ownerDocument.createElement("span");
        spark.className = `reader-dot-spark reader-dot-spark-${index}`;
        sparks.appendChild(spark);
      }
      element.appendChild(sparks);
    }
    if (element.dataset.interactive === "true") return;
    element.dataset.interactive = "true";
    element.tabIndex = 0;
    element.setAttribute("role", "slider");
    element.setAttribute("aria-label", "Dotty reading position");
    element.setAttribute("aria-orientation", "vertical");
    element.setAttribute("aria-valuemin", "1");
    element.title = "Drag Dotty to your line. Hold it at the top or bottom of the page to go further.";
    element.style.pointerEvents = "auto";

    let dragging = false;
    let pendingClientY = 0;
    // The word the drag began on, not its number: a drag that scrolls the
    // page brings chapters in above, which renumbers every word on it.
    let gestureStart: ReaderWord | undefined;
    // Held against the top or bottom of the window, the page scrolls under
    // Dotty (readers/readerDot.ts), so it can be carried to a line that is
    // not on screen. It used to stop at the window's first or last line.
    let edgeFrame: number | null = null;
    let edgeAt = 0;
    let edgeCarry = 0;
    let edgeAskedAt = 0;
    let edgeScrolled = false;
    const moveToClientY = (clientY: number, commit = false) => {
      const rect = container.getBoundingClientRect();
      // A line's height in from the top and the bottom: the line nearest the
      // very edge is half off the page, and Dotty put there was out of sight.
      const edge = Math.min(rect.height / 2, Math.max(rect.height * 0.02, linePx()));
      const within = Math.min(rect.height - edge, Math.max(edge, clientY - rect.top));
      const index = findNearestWordIndex(within / Math.max(1, rect.height));
      if (commit) {
        const began = gestureStart;
        const from = began
          ? readerWordsRef.current.findIndex((word) => word.node === began.node && word.start === began.start)
          : -1;
        // (Its chapter gone from the page: a long way, which says nothing about the pace.)
        applyUserReadingAnchor(index, { commitPaceFrom: from >= 0 ? from : index });
      } else {
        applyUserReadingAnchor(index);
      }
      // Scrolling the drag did is the drag's, not the reader reading on or
      // going back, while word of it is still arriving. (Placing Dotty
      // clears this, so it is said again after each placing.)
      if (edgeScrolled) {
        programmaticScrollUntilRef.current = Date.now() + 250;
      }
    };
    const stopEdgeScroll = () => {
      if (edgeFrame !== null) {
        window.cancelAnimationFrame(edgeFrame);
        edgeFrame = null;
      }
      edgeAt = 0;
      edgeCarry = 0;
    };
    const edgeStep = (time: number) => {
      edgeFrame = null;
      const rect = container.getBoundingClientRect();
      const speed = dragging ? dragEdgeSpeed(pendingClientY, rect.top, rect.bottom) : 0;
      if (speed === 0) {
        stopEdgeScroll();
        return;
      }
      const elapsed = edgeAt ? Math.min(64, Math.max(0, time - edgeAt)) : 16;
      edgeAt = time;
      // Whole pixels, the rest carried over: a slow scroll is under one a frame.
      const wanted = (speed * elapsed) / 1000 + edgeCarry;
      const step = Math.trunc(wanted);
      edgeCarry = wanted - step;
      if (step !== 0) {
        const before = container.scrollTop;
        container.scrollTop = before + step;
        if (container.scrollTop !== before) {
          edgeScrolled = true;
          moveToClientY(pendingClientY);
        } else if (Date.now() - edgeAskedAt > 400) {
          // At the end of what is on the page: the chapter beyond is asked for.
          edgeAskedAt = Date.now();
          loadFurther();
        }
      }
      edgeFrame = window.requestAnimationFrame(edgeStep);
    };
    const startEdgeScroll = () => {
      if (edgeFrame !== null) return;
      const rect = container.getBoundingClientRect();
      if (dragEdgeSpeed(pendingClientY, rect.top, rect.bottom) === 0) return;
      cancelSmartPageTurn();
      edgeFrame = window.requestAnimationFrame(edgeStep);
    };

    element.onpointerdown = (event) => {
      dragging = true;
      edgeScrolled = false;
      gestureStart = readerWordsRef.current[readerDotAnchorIndexRef.current ?? activeWordIndexRef.current];
      pendingClientY = event.clientY;
      element.classList.add("reader-dot-dragging");
      element.dataset.dragging = "true";
      element.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    element.onpointermove = (event) => {
      if (!dragging) return;
      pendingClientY = event.clientY;
      startEdgeScroll();
      if (readerDotDragFrameRef.current) return;
      readerDotDragFrameRef.current = window.requestAnimationFrame(() => {
        readerDotDragFrameRef.current = null;
        moveToClientY(pendingClientY);
      });
    };
    element.onpointerup = (event) => {
      if (!dragging) return;
      dragging = false;
      stopEdgeScroll();
      element.classList.remove("reader-dot-dragging");
      delete element.dataset.dragging;
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      moveToClientY(event.clientY, true);
    };
    element.onpointercancel = () => {
      dragging = false;
      stopEdgeScroll();
      element.classList.remove("reader-dot-dragging");
      delete element.dataset.dragging;
    };
    element.onkeydown = (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 8 : -8;
      const from = readerDotAnchorIndexRef.current ?? activeWordIndexRef.current;
      applyUserReadingAnchor(from + step, { commitPaceFrom: from });
    };
  };

  /** Dotty's element, made on first use. Its look, and its glide from line to line, are in index.css. */
  const ensureReaderDot = (container: HTMLElement) => {
    const existing = readerDotElementRef.current;
    if (existing && container.contains(existing)) {
      makeReaderDotInteractive(existing, container);
      return existing;
    }
    const element = document.createElement("div");
    element.id = "reader-lastline-dot";
    element.className = "reader-dot";
    element.style.position = "absolute";
    element.style.width = `${DOT_SIZE}px`;
    element.style.height = `${DOT_SIZE}px`;
    element.style.pointerEvents = "none";
    element.style.opacity = "0";
    element.style.zIndex = "50";
    container.appendChild(element);
    readerDotElementRef.current = element;
    makeReaderDotInteractive(element, container);
    return element;
  };

  /**
   * Puts Dotty beside a line. It glides there, except across a long way (a
   * jump elsewhere, or a chapter loading in above and moving the text): a
   * glide then was a streak down the page.
   */
  const moveReaderDot = (dot: HTMLElement, container: HTMLElement, top: number, left: number) => {
    const from = Number.parseFloat(dot.style.top);
    const far = !Number.isFinite(from) || Math.abs(top - from) > container.clientHeight * 0.9;
    if (far) {
      dot.style.transition = "none";
    }
    dot.style.left = `${left}px`;
    dot.style.top = `${top}px`;
    dot.style.opacity = "1";
    if (far) {
      void dot.offsetWidth;
      dot.style.transition = "";
    }
  };

  const positionReaderDotAtWord = (index: number) => {
    if (!readerDotEnabledRef.current) return;
    const word = readerWordsRef.current[index];
    const container = ensureScrollContainer();
    if (!word || !container) return;
    const rect = getReaderWordRect(word);
    if (!rect) return;
    const containerRect = container.getBoundingClientRect();
    const documentTop = rect.top - containerRect.top + container.scrollTop;
    const iframeRect = word.iframe.getBoundingClientRect();
    const body = word.node.ownerDocument.body;
    const computedPadding = Number.parseFloat(
      body ? word.node.ownerDocument.defaultView?.getComputedStyle(body).paddingLeft || "0" : "0"
    );
    const textLeft =
      iframeRect.left + (Number.isFinite(computedPadding) ? computedPadding : 24);
    const left = Math.max(7, textLeft - containerRect.left - 18);
    const dot = ensureReaderDot(container);
    moveReaderDot(dot, container, Math.max(6, documentTop + rect.height / 2 - DOT_SIZE / 2), left);
    dot.setAttribute("aria-valuenow", `${index + 1}`);
    dot.setAttribute("aria-valuemax", `${readerWordsRef.current.length}`);
    readerDotAnchorIndexRef.current = index;
  };

  const monitorUserReaderDotVisibility = (container: HTMLElement) => {
    if (
      readingModeRef.current !== "standard" ||
      Date.now() >= readerDotUserAnchorUntilRef.current
    ) {
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      return false;
    }
    const dot = readerDotElementRef.current;
    if (!dot || !container.contains(dot)) {
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      return false;
    }
    if (dot.dataset.dragging === "true") {
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      return true;
    }
    const dotRect = dot.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const edgeTolerance = 2;
    const isOffscreen =
      dotRect.bottom < containerRect.top - edgeTolerance ||
      dotRect.top > containerRect.bottom + edgeTolerance;
    if (!isOffscreen) {
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      return true;
    }

    if (!readerDotOffscreenTimerRef.current) {
      readerDotOffscreenTimerRef.current = window.setTimeout(() => {
        readerDotOffscreenTimerRef.current = null;
        if (
          readingModeRef.current !== "standard" ||
          !readerDotEnabledRef.current ||
          Date.now() >= readerDotUserAnchorUntilRef.current
        ) {
          return;
        }
        const currentDot = readerDotElementRef.current;
        const currentContainer = scrollContainerRef.current;
        if (!currentDot || !currentContainer || !currentContainer.contains(currentDot)) {
          return;
        }
        const currentDotRect = currentDot.getBoundingClientRect();
        const currentContainerRect = currentContainer.getBoundingClientRect();
        const stillOffscreen =
          currentDotRect.bottom < currentContainerRect.top - edgeTolerance ||
          currentDotRect.top > currentContainerRect.bottom + edgeTolerance;
        if (!stillOffscreen) {
          return;
        }

        readerDotUserAnchorUntilRef.current = 0;
        readerDotAnchorIndexRef.current = null;
        const location = renditionRef.current?.location;
        const cfi = location?.end?.cfi ?? location?.start?.cfi;
        if (!cfi) {
          return;
        }
        updateLastReadMarker(cfi);
        const resetDot = readerDotElementRef.current;
        if (!resetDot) {
          return;
        }
        resetDot.classList.remove("reader-dot-reacquired");
        void resetDot.offsetWidth;
        resetDot.classList.add("reader-dot-reacquired");
        resetDot.title = "Dotty is following the last visible line";
        const onResetAnimationEnd = (event: AnimationEvent) => {
          if (event.target !== resetDot || event.animationName !== "readerDotReacquire") {
            return;
          }
          resetDot.classList.remove("reader-dot-reacquired");
          resetDot.removeEventListener("animationend", onResetAnimationEnd);
        };
        resetDot.addEventListener("animationend", onResetAnimationEnd);
      }, 5000);
    }
    return true;
  };

  const updateLastReadMarker = (cfi: string) => {
    if (!readerDotEnabledRef.current) {
      return;
    }
    if (Date.now() < readerDotUserAnchorUntilRef.current) {
      return;
    }
    const rendition = renditionRef.current;
    if (!rendition?.getContents) {
      return;
    }
    const contentsList = contentsForCfi(cfi);
    if (readerDotRetryRef.current.cfi !== cfi) {
      readerDotRetryRef.current = { cfi, count: 0 };
    }
    let found = false;

    for (const contents of contentsList) {
      try {
        const container = ensureScrollContainer();
        if (!container) {
          continue;
        }
        const range = contents.range(cfi);
        if (!range) {
          continue;
        }
        const rects = range.getClientRects();
        const rect =
          rects && rects.length > 0
            ? rects[rects.length - 1]
            : range.getBoundingClientRect();
        if (!rect || rect.height === 0) {
          continue;
        }
        const iframe =
          (contents?.iframe as HTMLIFrameElement | undefined) ??
          (contents?.document?.defaultView?.frameElement as HTMLIFrameElement | undefined);
        if (!iframe) {
          continue;
        }
        const iframeRect = iframe.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const lineTop = iframeRect.top + rect.top - containerRect.top;
        const doc = contents?.document;
        const computedPad = doc?.body
          ? Number.parseFloat(doc.defaultView?.getComputedStyle(doc.body).paddingLeft || "0")
          : 0;
        const pad = Number.isFinite(computedPad) && computedPad > 0 ? computedPad : 24;
        const clamp = (value: number, min: number, max: number) =>
          Math.min(max, Math.max(min, value));
        const containerWidth = container.clientWidth || containerRect.width;
        const textLeft = iframeRect.left - containerRect.left + pad;
        const trackLeft = clamp(textLeft - 18, 6, Math.max(6, containerWidth - 10));
        const target = {
          top: clamp(
            lineTop + container.scrollTop + rect.height / 2 - DOT_SIZE / 2,
            6,
            Math.max(6, container.scrollHeight - 10)
          ),
          left: trackLeft
        };

        moveReaderDot(ensureReaderDot(container), container, target.top, target.left);
        lastMarkerRef.current = cfi;
        readerDotRetryRef.current = { cfi, count: 0 };
        found = true;
        break;
      } catch {
        // ignore range errors
      }
    }

    if (!found && readerDotRetryRef.current.count < 3) {
      readerDotRetryRef.current.count += 1;
      if (readerDotRetryTimerRef.current) {
        window.clearTimeout(readerDotRetryTimerRef.current);
      }
      readerDotRetryTimerRef.current = window.setTimeout(() => {
        readerDotRetryTimerRef.current = null;
        updateLastReadMarker(cfi);
      }, 260);
    }
  };

  const removeLastReadMarker = () => {
    if (readerDotTimerRef.current) {
      window.clearTimeout(readerDotTimerRef.current);
    }
    if (readerDotRetryTimerRef.current) {
      window.clearTimeout(readerDotRetryTimerRef.current);
      readerDotRetryTimerRef.current = null;
    }
    if (readerDotOffscreenTimerRef.current) {
      window.clearTimeout(readerDotOffscreenTimerRef.current);
      readerDotOffscreenTimerRef.current = null;
    }
    readerDotTimerRef.current = null;
    readerDotRetryRef.current = { cfi: "", count: 0 };
    if (readerDotElementRef.current) {
      readerDotElementRef.current.remove();
      readerDotElementRef.current = null;
    }
    lastMarkerRef.current = null;
  };

  /**
   * Dotty sits in the scrolling container at a height in the book. When the
   * chapters under it went (a jump elsewhere), it stayed where it had been,
   * which could be far below the end of what the page now holds: the page
   * then scrolled on into blank space down to it, and epub.js, taking that
   * for text still to come, did not fetch the next chapter. It waits out of
   * the way until it is placed again.
   */
  const tuckAwayStrandedDot = (container: HTMLElement) => {
    const dot = readerDotElementRef.current;
    if (!dot || dot.parentElement !== container) {
      return;
    }
    const chapterEnds = Array.from(container.children)
      .filter((child) => child !== dot)
      .map((child) => (child as HTMLElement).offsetTop + (child as HTMLElement).offsetHeight);
    if (!dotIsStranded(dot.offsetTop + dot.offsetHeight, chapterEnds)) {
      return;
    }
    dot.style.transition = "none";
    dot.style.top = `${-4 * DOT_SIZE}px`;
    dot.style.opacity = "0";
    void dot.offsetWidth;
    dot.style.transition = "";
  };

  /**
   * The text moved under Dotty (a resize, a new type size or line length):
   * Dotty follows it. RSVP has no Dotty (repositioning here used to recreate
   * it), and an unpinned Dotty in standard mode follows the last visible line,
   * not a word. That follow waits for scrolling to settle; `now` is for a
   * change the reader just made, which should not leave Dotty stranded for
   * two seconds.
   */
  const refreshReaderDot = (now = false) => {
    const mode = readingModeRef.current;
    if (!readerDotEnabledRef.current || readerWordsRef.current.length === 0 || mode === "speed") {
      return;
    }
    const pinned = Date.now() < readerDotUserAnchorUntilRef.current;
    if (mode === "smart" || pinned) {
      positionReaderDotAtWord(readerDotAnchorIndexRef.current ?? activeWordIndexRef.current);
      return;
    }
    const location = renditionRef.current?.location;
    const cfi = location?.end?.cfi ?? location?.start?.cfi;
    if (now && mode === "standard" && cfi) {
      updateLastReadMarker(cfi);
    } else {
      scheduleReaderDotUpdate();
    }
  };

  const scheduleReaderDotUpdate = () => {
    if (!readerDotEnabledRef.current || readingModeRef.current !== "standard") {
      return;
    }
    if (readerDotTimerRef.current) {
      window.clearTimeout(readerDotTimerRef.current);
    }
    readerDotTimerRef.current = window.setTimeout(() => {
      const location = renditionRef.current?.location;
      const cfi = location?.end?.cfi ?? location?.start?.cfi;
      if (cfi) {
        updateLastReadMarker(cfi);
      }
    }, 2000);
  };

  // Drops a user-placed Dotty pin so automatic tracking resumes.
  const releaseUserReadingAnchor = () => {
    readerDotUserAnchorUntilRef.current = 0;
    readerDotAnchorIndexRef.current = null;
    // Going elsewhere: the word that was being read is not looked for again
    // when its chapter comes back onto the page beside the new place.
    wordSectionIdsRef.current = [];
    keptWordPlaceRef.current = null;
    if (readerDotOffscreenTimerRef.current) {
      window.clearTimeout(readerDotOffscreenTimerRef.current);
      readerDotOffscreenTimerRef.current = null;
    }
  };

  return {
    readerDotDragFrameRef, readerDotOffscreenTimerRef, readerDotElementRef, readerDotEnabledRef,
    readerDotAnchorIndexRef, readerDotUserAnchorUntilRef, readerDotEnabled, setReaderDotEnabled, moveReaderDot,
    positionReaderDotAtWord, monitorUserReaderDotVisibility, updateLastReadMarker, removeLastReadMarker,
    tuckAwayStrandedDot, refreshReaderDot, scheduleReaderDotUpdate, releaseUserReadingAnchor
  };
};

/** Dotty switched on or off. */
export const useDotSwitch = (reader: WithCover) => {
  const {
    activeWordIndexRef, layout, persistReaderState, positionReaderDotAtWord, readerDotEnabled, readerDotEnabledRef,
    readingModeRef, removeLastReadMarker, renditionRef, scheduleReaderDotUpdate, updateLastReadMarker
  } = reader;
  useEffect(() => {
    readerDotEnabledRef.current = readerDotEnabled && layout === "scroll";
    persistReaderState();
    if (!readerDotEnabled) {
      removeLastReadMarker();
      return;
    }
    if (readingModeRef.current === "smart") {
      positionReaderDotAtWord(activeWordIndexRef.current);
      return;
    }
    if (readingModeRef.current === "speed") {
      removeLastReadMarker();
      return;
    }
    const location = renditionRef.current?.location;
    const cfi = location?.end?.cfi ?? location?.start?.cfi;
    if (cfi) {
      updateLastReadMarker(cfi);
    }
    scheduleReaderDotUpdate();
  }, [readerDotEnabled]);
};
