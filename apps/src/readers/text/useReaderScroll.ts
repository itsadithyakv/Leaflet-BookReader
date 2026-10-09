import { useEffect, useRef } from "react";
import { EpubCFI } from "epubjs";
import { handsFreeCounts } from "../pacing";
import { isScrollCorrection } from "../smartScroll";
import { glideFrame, glideSet, startGlide } from "../glide";
import { NOT_HELD, STILL_MS, isOnScrollbar, letGo, pageScrolled, pressOn, type ScrollbarHold } from "../scrollbarHold";
import type { Later, WithCover, WithLook } from "./scope";

/**
 * The scrolling window and the chapters in it: finding it, moving it, and
 * asking for the next chapter.
 */
export const useReaderScroll = (reader: WithLook & Later<"cancelSmartPageTurn" | "readerDotElementRef">) => {
  const { bookRef, layoutRef, navigatingUntilRef, renditionRef, viewerRef } = reader;
  const scrollAdvanceLockRef = useRef(false);
  const scrollAdvanceTimerRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  // The scrollbar held (readers/scrollbarHold.ts): no chapter is fetched
  // under it. The book's own documents call the let-go when the pointer is
  // seen in them with no button down.
  const scrollbarHoldRef = useRef<ScrollbarHold>(NOT_HELD);
  const scrollbarLetGoRef = useRef<() => void>(() => undefined);
  const manualScrollTimerRef = useRef<number | null>(null);
  const programmaticScrollUntilRef = useRef(0);
  const contentWheelHandlerRef = useRef<((deltaY: number) => void) | null>(null);

  /**
   * The chapter on screen that a place belongs to. Scrolling shows several
   * chapters at once, and a place resolved in the wrong one lands on some
   * unrelated line of it rather than nowhere.
   */
  const contentsForCfi = (cfi: string): any[] => {
    const list: any[] = renditionRef.current?.getContents?.() ?? [];
    if (list.length <= 1) {
      return list;
    }
    try {
      const spinePos = (new EpubCFI(cfi) as unknown as { spinePos?: number }).spinePos;
      const own = list.filter((contents) => contents?.sectionIndex === spinePos);
      return own.length > 0 ? own : list;
    } catch {
      return list;
    }
  };

  /** The chapters on the page, top to bottom (scrolling shows several at once). */
  const displayedViews = (): any[] => {
    const views = ((renditionRef.current?.manager as any)?.views?._views ?? []) as any[];
    return views.filter((view) => view?.displayed && view?.element?.isConnected);
  };

  /** A key's scroll on its way: the next press takes over from wherever the page has got to. */
  const keyScrollFrameRef = useRef<number | null>(null);
  const smoothScrollBy = (element: HTMLElement, delta: number) => {
    reader.cancelSmartPageTurn();
    if (keyScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(keyScrollFrameRef.current);
    }
    const duration = 220;
    let startTime: number | null = null;
    // From wherever the page is each frame (readers/glide.ts): a chapter let
    // go above while this runs moves the scroll position, and counting from
    // where the scroll began threw the text a chapter's height on.
    const glide = startGlide(element.scrollTop);

    const tick = (time: number) => {
      if (startTime === null) {
        startTime = time;
      }
      const progress = Math.min(1, (time - startTime) / duration);
      const eased = progress < 0.5
        ? 2 * progress * progress
        : -1 + (4 - 2 * progress) * progress;
      element.scrollTop = glideFrame(glide, element.scrollTop, delta * eased);
      glideSet(glide, element.scrollTop);
      keyScrollFrameRef.current = progress < 1 ? requestAnimationFrame(tick) : null;
    };

    keyScrollFrameRef.current = requestAnimationFrame(tick);
  };

  const isAtScrollBottom = (element: HTMLElement, padding = 6) =>
    element.scrollTop + element.clientHeight >= element.scrollHeight - padding;

  const ensureScrollSpacer = (container: HTMLElement) => {
    const existing = container.querySelector<HTMLElement>("#reader-scroll-spacer");
    if (existing) {
      existing.remove();
    }
  };

  const ensureScrollContainer = () => {
    const container = getScrollContainer();
    if (!container) {
      return null;
    }
    scrollContainerRef.current = container;
    ensureScrollSpacer(container);
    if (reader.readerDotElementRef.current && !container.contains(reader.readerDotElementRef.current)) {
      reader.readerDotElementRef.current.remove();
      reader.readerDotElementRef.current = null;
    }
    // The dot's horizontal position is owned by positionReaderDotAtWord /
    // updateLastReadMarker; resetting it here made it snap on every scroll tick.
    return container;
  };

  /**
   * Scrolling is one continuous book: epub.js adds the next chapter below the
   * one being read as its end comes near, and lets go of chapters left far
   * behind. This asks it to look again, for when the end was reached without
   * the scrolling that makes it look.
   */
  const loadFurther = () => {
    const manager = renditionRef.current?.manager as any;
    try {
      manager?.q?.enqueue?.(() => manager.check?.());
    } catch {
      // The book is closing.
    }
  };

  /** Whether the book goes on after the last chapter on the page. */
  const hasFurtherSection = () =>
    Boolean((renditionRef.current?.manager as any)?.views?.last?.()?.section?.next?.());

  /** Where a chapter on the page starts, in the scrolling container. */
  const sectionTop = (href: string) => {
    const manager = renditionRef.current?.manager as any;
    const section = (bookRef.current as any)?.spine?.get?.(href);
    const element = (section ? manager?.views?.find?.(section) : null)?.element as HTMLElement | undefined;
    return element ? element.offsetTop : null;
  };

  /**
   * The bottom of what is loaded was reached. This used to swap the chapter
   * for the next one, before its last lines (at the very bottom of the
   * window) had been read; now the next chapter simply follows on below.
   */
  const triggerScrollAdvance = () => {
    if (layoutRef.current === "pages" || scrollAdvanceLockRef.current || Date.now() < navigatingUntilRef.current) {
      return;
    }
    scrollAdvanceLockRef.current = true;
    if (scrollAdvanceTimerRef.current) {
      window.clearTimeout(scrollAdvanceTimerRef.current);
    }
    scrollAdvanceTimerRef.current = window.setTimeout(() => {
      scrollAdvanceLockRef.current = false;
    }, 900);
    loadFurther();
  };

  const getScrollContainer = (): HTMLElement | null => {
    const cached = scrollContainerRef.current;
    if (cached && cached.isConnected) {
      return cached;
    }
    const manager = renditionRef.current?.manager as any;
    if (manager?.settings?.fullsize) {
      return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
    }
    if (manager?.container) {
      return manager.container as HTMLElement;
    }
    const root = viewerRef.current;
    if (!root) {
      return null;
    }
    const candidate =
      root.querySelector(".epub-container") ||
      root.querySelector(".epub-view");
    if (candidate) {
      return candidate as HTMLElement;
    }
    if (root.scrollHeight > root.clientHeight + 2) {
      return root;
    }
    return null;
  };

  return {
    scrollAdvanceLockRef, scrollAdvanceTimerRef, scrollContainerRef, scrollbarHoldRef, scrollbarLetGoRef,
    manualScrollTimerRef, programmaticScrollUntilRef, contentWheelHandlerRef, contentsForCfi, displayedViews,
    keyScrollFrameRef, smoothScrollBy, isAtScrollBottom, ensureScrollSpacer, ensureScrollContainer, loadFurther,
    hasFurtherSection, sectionTop, triggerScrollAdvance, getScrollContainer
  };
};

/**
 * Watches the scrolling window once the book is up: the reader's own
 * scrolling, the wheel, the scrollbar held, chapters coming and going.
 */
export const useScrollWatch = (reader: WithCover) => {
  const {
    autoScrollActiveRef, book, cancelSmartPageTurn, contentWheelHandlerRef, displayedViews, ensureScrollContainer,
    ensureScrollSpacer, isAtScrollBottom, lastHandsOnAtRef, layoutRef, loadFurther, loading, manualScrollTimerRef,
    markReadingActivity, monitorUserReaderDotVisibility, noteAutoScrollCorrectionRef, observeManualReadingPosition,
    programmaticScrollUntilRef, readingModeRef, renditionRef, scheduleReaderDotUpdate, scheduleReaderWordIndex,
    scrollbarHoldRef, scrollbarLetGoRef, selectionChangedRef, smartManualOverrideUntilRef, triggerScrollAdvance,
    tuckAwayStrandedDot
  } = reader;
  const scrollbarResumeTimerRef = useRef<number | null>(null);
  const lastWheelDownAtRef = useRef(0);
  const lastScrollTopRef = useRef<number | null>(null);

  useEffect(() => {
    let activeContainer: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let framesObserver: MutationObserver | null = null;
    const queueManualObservation = (delay = 160) => {
      if (manualScrollTimerRef.current) {
        window.clearTimeout(manualScrollTimerRef.current);
      }
      manualScrollTimerRef.current = window.setTimeout(() => {
        manualScrollTimerRef.current = null;
        observeManualReadingPosition();
      }, delay);
    };

    // Fetching takes up again by itself once the page has been still, in
    // case the letting go is never reported: asked for a moment after the
    // hold lapses, and again at every scroll while it lasts.
    const armScrollbarResume = () => {
      if (scrollbarResumeTimerRef.current !== null) {
        window.clearTimeout(scrollbarResumeTimerRef.current);
      }
      scrollbarResumeTimerRef.current = window.setTimeout(() => {
        scrollbarResumeTimerRef.current = null;
        loadFurther();
      }, STILL_MS + 60);
    };
    /** Let go (or as good as): fetching goes on from where the thumb was left. */
    const releaseScrollbar = () => {
      if (!scrollbarHoldRef.current.pressed) {
        return;
      }
      scrollbarHoldRef.current = letGo();
      if (scrollbarResumeTimerRef.current !== null) {
        window.clearTimeout(scrollbarResumeTimerRef.current);
        scrollbarResumeTimerRef.current = null;
      }
      loadFurther();
    };
    /** A press on the scrolling container: on its scrollbar when it lands outside the container's own content box. */
    const onContainerPress = (event: PointerEvent) => {
      const container = event.currentTarget as HTMLElement | null;
      // (Measured from the container's own box, not `offsetX`: under a zoomed
      // page that is not always in the same pixels as the client width.)
      const onScrollbar =
        layoutRef.current === "scroll" &&
        container !== null &&
        event.target === container &&
        isOnScrollbar(event.clientX - container.getBoundingClientRect().left - container.clientLeft, container.clientWidth);
      scrollbarHoldRef.current = pressOn(onScrollbar, Date.now());
      if (onScrollbar) {
        armScrollbarResume();
      }
    };
    /** The pointer moving with no button down: whatever was held has been let go. */
    const onPointerAbout = (event: PointerEvent) => {
      if (event.buttons === 0) {
        releaseScrollbar();
      }
    };

    const onWheel = (event: WheelEvent) => {
      // scroll-only mode
      const target = event.currentTarget as HTMLElement;
      if (!target) {
        return;
      }
      handleWheel(target, event.deltaY);
    };

    const handleWheel = (target: HTMLElement, deltaY: number) => {
      markReadingActivity();
      // The wheel is never held up by a scrollbar that was not seen let go.
      releaseScrollbar();
      lastHandsOnAtRef.current = Date.now();
      cancelSmartPageTurn();
      programmaticScrollUntilRef.current = 0;
      if (autoScrollActiveRef.current) {
        noteAutoScrollCorrectionRef.current(target, deltaY);
      }
      if (readingModeRef.current === "smart") {
        smartManualOverrideUntilRef.current = Date.now() + 2200;
      }
      if (deltaY > 0) {
        lastWheelDownAtRef.current = Date.now();
        if (isAtScrollBottom(target, 2)) {
          triggerScrollAdvance();
        }
      }
      queueManualObservation(120);
      scheduleReaderDotUpdate();
    };

    /** A chapter that was in the window at the last scroll, and where its top was in it. */
    let inWindow: { element: HTMLElement; top: number } | null = null;
    const onScroll = (event: Event) => {
      // scroll-only mode
      const target = event.currentTarget as HTMLElement;
      if (!target) {
        return;
      }
      const now = Date.now();
      if (handsFreeCounts(now - lastHandsOnAtRef.current)) {
        markReadingActivity();
      }
      const last = lastScrollTopRef.current ?? target.scrollTop;
      const delta = target.scrollTop - last;
      lastScrollTopRef.current = target.scrollTop;
      // epub.js keeping the text in place as a chapter is let go (or fetched)
      // above the window is no one scrolling (readers/smartScroll.ts:
      // isScrollCorrection): the chapter that was in the window has not moved.
      const boxTop = target.getBoundingClientRect().top;
      const moved = inWindow?.element.isConnected ? inWindow.element.getBoundingClientRect().top - boxTop - inWindow.top : null;
      const corrected = isScrollCorrection(delta, moved);
      const shown = (displayedViews() as any[])
        .map((view) => view?.element as HTMLElement | undefined)
        .find((element) => {
          const box = element?.getBoundingClientRect();
          return Boolean(box && box.bottom - boxTop > 0 && box.top - boxTop < target.clientHeight);
        });
      inWindow = shown ? { element: shown, top: shown.getBoundingClientRect().top - boxTop } : null;
      // A held scrollbar is still being dragged.
      if (scrollbarHoldRef.current.pressed) {
        scrollbarHoldRef.current = pageScrolled(scrollbarHoldRef.current, now);
        armScrollbarResume();
      }
      // Only the reader's own scrolling heads for the next chapter: a Smart
      // Read page step that lands at the bottom still has lines left to read.
      if (delta > 0 && now >= programmaticScrollUntilRef.current) {
        lastWheelDownAtRef.current = now;
      }
      if (isAtScrollBottom(target, 2) && now - lastWheelDownAtRef.current < 700) {
        triggerScrollAdvance();
      }
      if (now >= programmaticScrollUntilRef.current && !corrected) {
        if (readingModeRef.current === "smart") {
          smartManualOverrideUntilRef.current = now + 2200;
        }
        queueManualObservation();
      }
      const manualDotActive = monitorUserReaderDotVisibility(target);
      if (!manualDotActive) {
        scheduleReaderDotUpdate();
      }
    };

    const attach = (container: HTMLElement) => {
      activeContainer = container;
      ensureScrollSpacer(container);
      resizeObserver = new ResizeObserver(() => {
        ensureScrollSpacer(container);
      });
      resizeObserver.observe(container);
      // Chapters come and go under what points into them, and epub.js says
      // nothing when one does. Text selected in a chapter that was let go
      // (scrolled far from, jumped away from, re-laid out by a resize) went
      // with it, and a frame that has gone sends no selectionchange: the
      // offer to highlight it stayed, and hands-free reading waited on it.
      framesObserver = new MutationObserver((records) => {
        selectionChangedRef.current();
        if (records.some((record) => record.target === container)) {
          tuckAwayStrandedDot(container);
        }
      });
      framesObserver.observe(container, { childList: true, subtree: true });
      container.addEventListener("wheel", onWheel, { passive: true });
      container.addEventListener("scroll", onScroll, { passive: true });
      container.addEventListener("pointerdown", onContainerPress, { passive: true });
      window.addEventListener("pointerup", releaseScrollbar);
      window.addEventListener("mouseup", releaseScrollbar);
      window.addEventListener("blur", releaseScrollbar);
      window.addEventListener("pointermove", onPointerAbout, { passive: true });
      scrollbarLetGoRef.current = releaseScrollbar;
      contentWheelHandlerRef.current = (deltaY) => handleWheel(container, deltaY);
    };

    const detach = () => {
      if (!activeContainer) {
        return;
      }
      activeContainer.removeEventListener("wheel", onWheel);
      activeContainer.removeEventListener("scroll", onScroll);
      activeContainer.removeEventListener("pointerdown", onContainerPress);
      window.removeEventListener("pointerup", releaseScrollbar);
      window.removeEventListener("mouseup", releaseScrollbar);
      window.removeEventListener("blur", releaseScrollbar);
      window.removeEventListener("pointermove", onPointerAbout);
      scrollbarLetGoRef.current = () => undefined;
      scrollbarHoldRef.current = NOT_HELD;
      if (scrollbarResumeTimerRef.current !== null) {
        window.clearTimeout(scrollbarResumeTimerRef.current);
        scrollbarResumeTimerRef.current = null;
      }
      contentWheelHandlerRef.current = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      framesObserver?.disconnect();
      framesObserver = null;
      activeContainer = null;
      lastScrollTopRef.current = null;
      if (manualScrollTimerRef.current) {
        window.clearTimeout(manualScrollTimerRef.current);
        manualScrollTimerRef.current = null;
      }
    };

    const onRendered = () => {
      const next = ensureScrollContainer();
      if (!next) {
        return;
      }
      if (activeContainer !== next) {
        detach();
        attach(next);
      } else {
        ensureScrollSpacer(next);
      }
      scheduleReaderWordIndex(true);
    };

    // The rendition is created asynchronously by the load effect, so this must wait
    // for `loading` to clear — otherwise no scroll/wheel listener is ever attached.
    const rendition = renditionRef.current;
    if (loading || !rendition) {
      return;
    }

    const initial = ensureScrollContainer();
    if (initial) {
      attach(initial);
    }
    rendition.on?.("rendered", onRendered);

    return () => {
      rendition.off?.("rendered", onRendered);
      detach();
    };
  }, [book.id, loading]);
};
