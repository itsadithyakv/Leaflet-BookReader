import { useEffect, useRef } from "react";
import { EpubCFI } from "epubjs";
import { useLibraryStore } from "../../store/libraryStore";
import { endReached, type SectionWeights } from "../progress";
import { PAGE_TOP_PAD } from "../finish";
import { pageAt, pageHolding } from "../pageTurn";
import { readingLineIn } from "../readingPlace";
import { lineAt } from "../lineAt";
import { isLook, placeAtOpen, placeFollows } from "../openAt";
import { decodeFindPlace } from "../findPlace";
import type { WithCover, WithDot } from "./scope";
import { isFrozen, windowChangesLayout } from "./renditionGhost";
import { isTouchInput } from "../../platform/device";
import { keyboardIsOpen } from "../keyboardOpen";
import { SETTLE_HEIGHT_MS, relayoutFor, resizeDuringTurn } from "../relayoutFor";
import { liftReaderVeil, raiseReaderVeil, turnSettleNow } from "../readerVeil";
import { JUMP_TICK_MS, noteLeft, pinStep, startJump } from "../jumpSettle";

/** By finger, a keyboard is up (or coming) for a field outside the book. */
const keyboardOverPage = () => {
  if (!isTouchInput()) return false;
  const active = document.activeElement;
  return keyboardIsOpen() || Boolean(active?.matches?.("input, textarea, [contenteditable=''], [contenteditable='true']"));
};

/**
 * Where the reader is: the reading line, the place saved with the book, a
 * page's place in the pages layout, and going to a place.
 */
export const useReaderPlace = (reader: WithDot) => {
  const {
    book, contentsForCfi, displayedViews, ensureScrollContainer, initialPrefs, jumpHoldRef, lastHandsOnAtRef, layoutRef, loadFurther,
    markNavigating, openAt, programmaticScrollUntilRef, releaseUserReadingAnchor, renditionRef, sectionTop
  } = reader;
  // Seeded from the library, so closing a book before its position is known
  // writes back what was there rather than 0.
  const lastProgressRef = useRef(typeof book.progress === "number" ? book.progress : 0);
  const lastComputedProgressRef = useRef(typeof book.progress === "number" ? book.progress : -1);
  /**
   * Progress is saved only once the position is trustworthy: the saved place
   * was restored, or the reader has moved. Opening a book with no local
   * position (another device, cleared data) used to save ~0 on the first
   * render, and that 0 then synced over the real progress everywhere.
   */
  const progressArmedRef = useRef(false);
  const openedAtRef = useRef(Date.now());

  // Where to reopen: this device's own last line, unless the synced position
  // (read on another device) is further on, or this device has none.
  const lastCfiRef = useRef<string | null>(
    (() => {
      // (A match of the library's search is not a place yet: `soughtRef` below.)
      const picked = placeAtOpen(openAt);
      if (picked) {
        return picked;
      }
      const local = initialPrefs?.cfi ?? null;
      const synced = book.position ?? null;
      if (!synced || synced === local) {
        return local ?? synced;
      }
      if (!local) {
        return synced;
      }
      const localProgress = initialPrefs?.cfiProgress ?? 0;
      return (book.progress ?? 0) > localProgress + 0.002 ? synced : local;
    })()
  );
  const lastCfiProgressRef = useRef<number | null>(initialPrefs?.cfiProgress ?? null);
  /** The reading line as last seen, wherever in the book it is (a look at the map included): what a resize lays the page out round. */
  const shownLineRef = useRef<{ cfi: string; below: number } | null>(null);
  // How far below the reading line the saved line's top was (a line rarely
  // starts exactly there), so a reopened book has it where it was left. It
  // goes with this device's own place, not one from another device.
  const lastCfiBelowRef = useRef(
    lastCfiRef.current !== null && lastCfiRef.current === initialPrefs?.cfi && Number.isFinite(initialPrefs?.cfiBelow)
      ? Math.max(0, Number(initialPrefs?.cfiBelow))
      : 0
  );
  const chapterPositionsRef = useRef<Record<string, string>>(initialPrefs?.chapterPositions ?? {});
  // Opened at a highlight from the library ("Open in book"): a look, until the
  // reader stays (readers/openAt.ts). Meanwhile the saved place and the
  // book's progress stay where the reading stopped, so the next ordinary open
  // resumes there; this is what this device had saved, written back as it was.
  // Opened at a match of the library's search ("Search inside books"): the
  // section and the words, found in the book once it is open (useBookOpening,
  // readers/findPlace.ts) and then cleared, so a book laid out again reopens
  // where the reader is by then. A look like a highlight's.
  const soughtRef = useRef(decodeFindPlace(openAt));
  const openedAtPlaceRef = useRef(isLook(openAt, soughtRef.current !== null));
  const storedPlaceRef = useRef({
    cfi: initialPrefs?.cfi,
    cfiProgress: initialPrefs?.cfiProgress,
    cfiBelow: initialPrefs?.cfiBelow,
    chapterPositions: initialPrefs?.chapterPositions ?? {}
  });
  const placeFollowsNow = () => placeFollows(openedAtPlaceRef.current, Date.now() - openedAtRef.current);
  const updateBookProgress = useLibraryStore((state) => state.updateBookProgress);

  /** Size-weighted progress for this book; null until known, or if unavailable. */
  const sectionWeightsRef = useRef<SectionWeights | null>(null);

  /** The chapter the reading line is in, and where in it (readers/readingPlace.ts). Scrolling only. */
  const readingLine = () => {
    const container = (renditionRef.current?.manager as any)?.container as HTMLElement | undefined;
    if (!container) {
      return null;
    }
    const box = container.getBoundingClientRect();
    const views = displayedViews();
    const boxes = views.map((view) => {
      const rect = (view.element as HTMLElement).getBoundingClientRect();
      return { top: rect.top - box.top, height: rect.height };
    });
    const found = readingLineIn(boxes, PAGE_TOP_PAD, container.clientHeight);
    return found
      ? { view: views[found.index], top: boxes[found.index].top, height: boxes[found.index].height, start: found.start, end: found.end }
      : null;
  };

  /**
   * The place being read: the first line clear of the toolbar, as a CFI, and
   * how far below the reading line its top is (a line rarely starts exactly
   * there). Scrolling only; null when it cannot be read.
   */
  const readingPlace = (): { cfi: string; below: number } | null => {
    const rendition = renditionRef.current;
    if (!rendition || layoutRef.current !== "scroll") {
      return null;
    }
    try {
      const line = readingLine();
      const doc = line?.view?.contents?.document as Document | undefined;
      if (!line || !doc) {
        return null;
      }
      // The line by its first word (readers/lineAt.ts). epub.js's own answer
      // names an earlier line at about a third of scroll positions; it
      // stands in when the chapter has nothing at or below the line.
      const exact = lineAt(doc, line.view.section.cfiBase, line.start);
      if (exact) {
        return { cfi: exact.cfi, below: Math.max(0, line.top + exact.top - PAGE_TOP_PAD) };
      }
      const mapping = (rendition.manager as any)?.mapping;
      const mapped = typeof mapping?.page === "function" ? mapping.page(line.view.contents, line.view.section.cfiBase, line.start, line.end) : null;
      return typeof mapped?.start === "string" ? { cfi: mapped.start, below: 0 } : null;
    } catch {
      return null;
    }
  };

  /**
   * The place being read, as a CFI: the first line clear of the toolbar, which
   * is where a place gone to is put (`clearToolbar`), so going back lands on
   * the very line that was left. With pages, the page's first line.
   */
  const readingPlaceCfi = (): string | null =>
    readingPlace()?.cfi ?? (renditionRef.current?.location?.start?.cfi as string | undefined) ?? null;

  /** The section being read (its spine index), and how far through it the reading line is. */
  const sectionPlace = (): { section: number; within: number } | null => {
    const location = renditionRef.current?.location;
    const index = location?.start?.index;
    if (layoutRef.current === "scroll") {
      const line = readingLine();
      if (line && typeof line.view?.section?.index === "number") {
        return { section: line.view.section.index, within: Math.min(1, Math.max(0, line.start / Math.max(1, line.height))) };
      }
    }
    if (typeof index !== "number") {
      return null;
    }
    const page = Number(location?.start?.displayed?.page) || 1;
    const total = Number(location?.start?.displayed?.total) || 1;
    // The story's last page holds its end: the reader is told 100%, not what
    // was behind them when the page came up (99% on a last chapter of a few
    // pages, on the very page the book ends on).
    if (layoutRef.current === "pages" && page >= total && index === sectionWeightsRef.current?.last) {
      return { section: index, within: 1 };
    }
    return { section: index, within: Math.min(1, Math.max(0, (page - 1) / total)) };
  };

  /**
   * Scrolling: where the bottom of the story's last line is, from the top of
   * the window; null when its chapter is not on the page. (A chapter let go
   * above keeps its box until it is trimmed, so one just scrolled past is
   * still measured.)
   */
  const storyEndBottom = (): number | null => {
    const weights = sectionWeightsRef.current;
    const container = (renditionRef.current?.manager as any)?.container as HTMLElement | undefined;
    if (!weights || !container || layoutRef.current !== "scroll") {
      return null;
    }
    const views = ((renditionRef.current?.manager as any)?.views?._views ?? []) as any[];
    const view = views.find((shown) => shown?.section?.index === weights.last && shown?.element?.isConnected);
    const element = view?.element as HTMLElement | undefined;
    if (!element || element.offsetHeight <= 0) {
      return null;
    }
    const room = (view.contents?.document as Document | undefined)?.querySelector<HTMLElement>("[data-leaflet-end]");
    return element.getBoundingClientRect().bottom - container.getBoundingClientRect().top - (room?.offsetHeight ?? 0);
  };
  /** The story's end was below the window when the page last settled (see endReached). */
  const storyEndWasBelowRef = useRef(false);

  /** Scrolling: whether the story's last line is on screen, or was just scrolled past. The book is read once it is (readers/progress.ts). */
  const storyEndInView = () => {
    const container = (renditionRef.current?.manager as any)?.container as HTMLElement | undefined;
    return container ? endReached(storyEndBottom(), container.clientHeight, storyEndWasBelowRef.current) : false;
  };

  /** Goes to a place and brings it down clear of the toolbar: bookmarks, highlights, back and forward. */
  const goToPlace = (cfi: string, below = 0) => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    // Jumping elsewhere invalidates a pinned Dotty. Without this the pin
    // survives and prepareReaderWords rescales it proportionally into the new
    // section, dropping Dotty at an unrelated line.
    releaseUserReadingAnchor();
    markNavigating();
    beginJump();
    void rendition.display(cfi).then(
      () => {
        if (renditionRef.current === rendition) {
          clearToolbar(cfi, below);
          settleOnPage(cfi);
          // Scrolling: held there while the chapters round it settle.
          pinJump(() => placeTopFor(cfi, below));
        }
      },
      () => undefined
    );
  };

  /** The jump's pin on its way: a newer jump takes over from it. */
  const pinTokenRef = useRef(0);
  /**
   * A jump while scrolling is about to be made: no chapter goes in above the
   * place until it has settled (readers/jumpSettle.ts). Called before epub.js
   * is sent there. With pages, nothing.
   */
  const beginJump = () => {
    if (layoutRef.current !== "scroll") {
      return;
    }
    pinTokenRef.current += 1;
    jumpHoldRef.current = startJump(Date.now(), lastHandsOnAtRef.current);
    reader.pinNowRef.current = null;
    // (Next and previous chapter say again where they are going, after this.)
    reader.navTargetRef.current = null;
  };
  /**
   * Holds the place gone to at the top of the window while the chapters round
   * it come (readers/jumpSettle.ts). `locate` gives the scroll position that
   * puts it there, from where it is now (null while its chapter is not on the
   * page): the page is set by the place, not by adding up what changed above
   * it. First the chapters below; once they have settled, the chapter above,
   * the place still held, until the reader takes the page (a touch, the
   * wheel, a key, or the page scrolled by anything else) or 15 s. It used to
   * be let go after 3 s, and a chapter laid out later than that, above,
   * left the page short. A change above the window is answered at once
   * (`pinNowRef`, called by useBookOpening's watch), not at the next look.
   */
  const pinJump = (locate: () => number | null, onSettled?: () => void) => {
    const rendition = renditionRef.current;
    const container = layoutRef.current === "scroll" ? ensureScrollContainer() : null;
    if (!rendition || !container) {
      jumpHoldRef.current = null;
      return;
    }
    if (!jumpHoldRef.current) {
      beginJump();
    }
    const token = pinTokenRef.current;
    const live = () => token === pinTokenRef.current && jumpHoldRef.current !== null && renditionRef.current === rendition;
    /** One look: puts the place back if it moved; false once the place is let go. */
    const look = () => {
      const hold = jumpHoldRef.current;
      if (!hold || !live()) {
        return false;
      }
      let want: number | null = null;
      try {
        want = locate();
      } catch {
        want = null;
      }
      const step = pinStep(hold, {
        now: Date.now(),
        want,
        scrollTop: container.scrollTop,
        handsOnAt: lastHandsOnAtRef.current,
        most: container.scrollHeight - container.clientHeight
      });
      if (step.done) {
        jumpHoldRef.current = null;
        reader.pinNowRef.current = null;
        loadFurther();
        return false;
      }
      if (step.put && want !== null) {
        // (The page's own move, not the reader's: readers/text/useReaderScroll.ts.)
        programmaticScrollUntilRef.current = Date.now() + 250;
        container.scrollTop = Math.max(0, want);
      }
      // Short of it: the chapters below are not long enough (yet, or again).
      if (want !== null && container.scrollTop < want - 1) {
        loadFurther();
      }
      jumpHoldRef.current = noteLeft(step.hold, container.scrollTop);
      if (step.settled) {
        // The page below has come: now the chapter above, the place still held.
        loadFurther();
        onSettled?.();
      }
      return true;
    };
    reader.pinNowRef.current = () => {
      look();
    };
    const tick = () => {
      if (look()) {
        window.setTimeout(tick, JUMP_TICK_MS);
      }
    };
    tick();
  };

  /** Scrolling: the scroll position that puts a place (a CFI) at the reading line, `below` it; null when its chapter is not on the page. */
  const placeTopFor = (cfi: string, below = 0): number | null => {
    try {
      const spinePos = (new EpubCFI(cfi) as unknown as { spinePos?: number }).spinePos;
      const view = displayedViews().find((shown) => shown?.section?.index === spinePos);
      const element = view?.element as HTMLElement | undefined;
      if (element && view.contents?.range?.(cfi)) {
        const top = Number(view.contents.locationOf(cfi)?.top);
        if (Number.isFinite(top)) {
          return Math.max(0, element.offsetTop + top - PAGE_TOP_PAD - Math.max(0, below));
        }
      }
    } catch {
      // Not on the page.
    }
    return null;
  };

  /**
   * With pages, epub.js finds a place's page from where its first character
   * is drawn. A page that starts in the middle of a paragraph is named by the
   * space that ended the line before, which is drawn on the page before: the
   * place came back a page early. The page shown is the one holding the first
   * word after the place.
   */
  const settleOnPage = (cfi: string) => {
    const rendition = renditionRef.current;
    const manager = rendition?.manager as any;
    const target = pageOfPlace(cfi);
    if (target !== null && Math.abs(target - manager.container.scrollLeft) > 1) {
      manager.scrollTo(target, 0, true);
      void rendition?.reportLocation?.();
    }
  };

  /**
   * With pages, the frame's pages as they stand: the scrolling container and
   * a page's width. Null when there are none to count (scrolling; a book not
   * yet on the page; a right-to-left book, whose pages epub.js counts the
   * other way).
   */
  const pageFrame = () => {
    const manager = renditionRef.current?.manager as any;
    const container = manager?.container as HTMLElement | undefined;
    const pageWidth = Number(manager?.layout?.delta) || 0;
    if (layoutRef.current !== "pages" || !container || pageWidth <= 0 || manager?.settings?.direction === "rtl") {
      return null;
    }
    return { manager, container, pageWidth };
  };

  /**
   * Where the frame goes to show the page holding a place (the page of the
   * first word after it), or null when the place is not in the chapter on the
   * page.
   */
  const pageOfPlace = (cfi: string): number | null => {
    const frameNow = pageFrame();
    if (!frameNow) {
      return null;
    }
    const { container, pageWidth } = frameNow;
    try {
      for (const contents of contentsForCfi(cfi)) {
        const range = contents.range(cfi) as Range | null;
        const frame = contents?.document?.defaultView?.frameElement as HTMLElement | null;
        if (!range || range.startContainer?.nodeType !== 3 || !frame) {
          continue;
        }
        // The first word at or after the place. The space that names a page
        // can be the last of its text node (the page starts with a word in
        // italics, say): the word is then in a node further on.
        const doc = range.startContainer.ownerDocument as Document;
        const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
        walker.currentNode = range.startContainer;
        let node: Text | null = range.startContainer as Text;
        let at = range.startOffset;
        for (let looked = 0; node && looked < 40; looked += 1) {
          while (at < node.data.length && /\s/.test(node.data[at])) {
            at += 1;
          }
          if (at < node.data.length) {
            break;
          }
          node = walker.nextNode() as Text | null;
          at = 0;
        }
        if (!node || at >= node.data.length) {
          continue;
        }
        const word = doc.createRange();
        word.setStart(node, at);
        word.setEnd(node, at + 1);
        const left =
          frame.getBoundingClientRect().left + word.getBoundingClientRect().left - container.getBoundingClientRect().left + container.scrollLeft;
        return pageHolding(left, pageWidth);
      }
    } catch {
      // The page epub.js chose stands.
    }
    return null;
  };

  /**
   * The reader's place with pages: the first word of the page they turned
   * to, and the size the pages were when they did. It is held while the pages
   * are laid out again (the window resized, the type changed, the chapter's
   * fonts arrived), and the page shown afterwards is the one holding it. Each
   * new layout used to start from its own page's first word, which is a
   * little earlier every time: the reader went back three pages over ten
   * changes of type size, and two over eight widths of a window being dragged.
   */
  const pagePlaceRef = useRef<{ cfi: string; section: number; pageWidth: number; height: number } | null>(null);
  /** Layouts on their way: the place is not taken from the pages they pass through. */
  const pageRelayoutsRef = useRef(0);
  /**
   * The reader's place carried across the book being opened again in another
   * layout (a phone turned from pages to a spread, or to scrolling: readers/
   * touchLayout.ts). The book reopens there (lastCfiRef), and with pages it
   * becomes the place again once a page holding it comes up, rather than
   * that page's first word: twenty turns of the phone used to walk the reader
   * back a page each.
   */
  const carriedPlaceRef = useRef<{ cfi: string; until: number } | null>(null);
  const holdPlaceForRelayout = () => {
    // With pages, the reader's place; scrolling, the reading line as it was
    // last seen (lastCfiRef can be a chapter further up the continuous scroll,
    // and by the time a turn of the phone is heard the text has already been
    // laid out again at the new width under the old scroll position).
    const line = layoutRef.current === "scroll" ? (shownLineRef.current ?? readingPlace()) : null;
    const place = line?.cfi ?? (layoutRef.current === "pages" ? pagePlaceRef.current?.cfi : null) ?? lastCfiRef.current;
    if (!place) {
      return;
    }
    lastCfiRef.current = place;
    lastCfiBelowRef.current = line?.below ?? 0;
    carriedPlaceRef.current = { cfi: place, until: Date.now() + 8000 };
  };

  /** Whether the page showing holds a place. */
  const pageHolds = (cfi: string) => {
    const frameNow = pageFrame();
    const target = frameNow ? pageOfPlace(cfi) : null;
    if (!frameNow || target === null) {
      return false;
    }
    const { container, pageWidth } = frameNow;
    return target === (pageAt(container.scrollLeft, pageWidth, container.scrollWidth).page - 1) * pageWidth;
  };

  /**
   * A page came up (layout "pages"); heard before anything else hears of it.
   * Its number is put right (readers/pageTurn.ts, `pageAt`: epub.js's own is
   * one short on a scaled display), and it becomes the reader's place, unless
   * the place they already have is on it.
   *
   * Pages of another size than the place was taken at are a new layout, not
   * a move by the reader (epub.js takes up a new size whenever it is asked
   * where the page is, without going to any place): the page holding the
   * place is shown, which also puts the frame back on a whole page.
   */
  const notePagePlace = (location: any) => {
    const numberFrom = (left: number, width: number, content: number) => {
      const numbered = pageAt(left, width, content);
      for (const end of [location?.start, location?.end]) {
        if (end?.displayed) {
          end.displayed.page = numbered.page;
          end.displayed.total = numbered.total;
        }
      }
    };
    const frameNow = pageFrame();
    if (!frameNow) {
      // A right-to-left book with pages: the same count, from the other end.
      const rtl = renditionRef.current?.manager as any;
      const width = Number(rtl?.layout?.delta) || 0;
      if (layoutRef.current === "pages" && rtl?.container && width > 0 && rtl.settings?.direction === "rtl") {
        numberFrom(Math.abs(rtl.container.scrollLeft), width, rtl.container.scrollWidth);
      }
      return;
    }
    const { manager, container, pageWidth } = frameNow;
    const number = () => numberFrom(container.scrollLeft, pageWidth, container.scrollWidth);
    number();
    const section = typeof location?.start?.index === "number" ? location.start.index : -1;
    const height = container.clientHeight;
    const held = pagePlaceRef.current;
    if (held && held.section === section && (held.pageWidth !== pageWidth || held.height !== height)) {
      pagePlaceRef.current = { ...held, pageWidth, height };
      const target = pageOfPlace(held.cfi);
      if (target !== null && Math.abs(target - container.scrollLeft) > 1) {
        manager.scrollTo(target, 0, true);
        number();
        void renditionRef.current?.reportLocation?.();
      }
      return;
    }
    if (pageRelayoutsRef.current > 0) {
      return;
    }
    // Opened again in another layout: the place it was opened at, once a page holds it.
    const carried = carriedPlaceRef.current;
    if (!held && carried) {
      if (Date.now() > carried.until) {
        carriedPlaceRef.current = null;
      } else if (pageHolds(carried.cfi)) {
        carriedPlaceRef.current = null;
        pagePlaceRef.current = { cfi: carried.cfi, section, pageWidth, height };
        return;
      } else {
        return;
      }
    }
    if (held && held.section === section && pageHolds(held.cfi)) {
      return;
    }
    pagePlaceRef.current =
      typeof location?.start?.cfi === "string" ? { cfi: location.start.cfi, section, pageWidth, height } : null;
  };

  /**
   * Lays the pages out again (`relayout`, given the place to lay them out
   * round) and shows the page holding the reader's place. Scrolling, or with
   * no place yet, it only lays out.
   */
  /** `onShown`: the page is at the place again (with pages), or laid out (scrolling, which puts the line back itself). */
  const relayPages = (relayout: (place: string | null) => void, onShown?: () => void) => {
    const rendition = renditionRef.current;
    const place = layoutRef.current === "pages" ? (pagePlaceRef.current?.cfi ?? null) : null;
    if (!rendition || !place) {
      relayout(null);
      onShown?.();
      return;
    }
    pageRelayoutsRef.current += 1;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        pageRelayoutsRef.current = Math.max(0, pageRelayoutsRef.current - 1);
      }
    };
    // A page that never arrives (the book closing) must not hold the place for good.
    window.setTimeout(release, 4000);
    relayout(place);
    void rendition
      .display(place)
      .then(() => {
        if (renditionRef.current === rendition) {
          settleOnPage(place);
        }
      })
      .then(release, release)
      .then(() => onShown?.());
  };

  /**
   * The type changed under the pages (a size, a face, a spacing): the frame
   * is measured again before the reader's place is looked for in it. epub.js
   * measures only when it is next asked where the page is, and a place past
   * the frame's old end could not be reached until then.
   */
  const measurePagesAgain = () => {
    const manager = renditionRef.current?.manager as any;
    if (layoutRef.current !== "pages" || !manager) {
      return;
    }
    try {
      manager.updateLayout?.();
    } catch {
      // epub.js measures again by itself, a page turn later.
    }
  };

  /**
   * epub.js puts a place it goes to at the very top of the window, and the
   * toolbar floats over the top 76px: a search result (the toolbar stays up
   * while search is open) or a highlight opened from the notes arrived
   * underneath it. The place comes down below it, as a reopened book's does.
   * Scrolling only: a page starts below the toolbar anyway.
   */
  const clearToolbar = (cfi?: string | null, below = 0) => {
    const container = layoutRef.current === "scroll" ? ensureScrollContainer() : null;
    if (!container) {
      return;
    }
    // By where the place is now, not by where epub.js left the page. When it
    // went there the chapter stood alone, and a place in its last screenful
    // was out of reach until the next chapter arrived below: a book closed
    // near a chapter's end (where a reader stops) reopened most of a screen
    // early, as did Back, a bookmark or a search result there.
    const at = cfi ? placeTopFor(cfi, below) : null;
    if (at !== null) {
      container.scrollTop = at;
      return;
    }
    // (Not found: the page stays where epub.js put it, brought down below the toolbar.)
    container.scrollTop = Math.max(0, container.scrollTop - PAGE_TOP_PAD - Math.max(0, below));
  };

  const displayChapter = (href: string, options?: { useSaved?: boolean }) => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    const useSaved = options?.useSaved ?? true;
    releaseUserReadingAnchor();
    const saved = chapterPositionsRef.current[href];
    const target = useSaved && saved ? saved : href;
    progressArmedRef.current = true;
    // An entry with an anchor ("ch34.xhtml#c4") is opened as its file, then
    // scrolled to below: handed the anchor form, epub.js's scrolling mode
    // showed a neighbouring section instead.
    // With pages epub.js finds the anchor's page itself, and there is no
    // scroll position to set afterwards.
    const paged = layoutRef.current === "pages";
    const fileTarget = !useSaved && !paged && target.includes("#") ? target.slice(0, target.indexOf("#")) : target;
    markNavigating();
    if (!useSaved) {
      beginJump();
    }
    void rendition
      .display(fileTarget)
      .then(() => {
        if (useSaved || paged) {
          return;
        }
        const container = ensureScrollContainer();
        if (!container) {
          return;
        }
        const hashAt = target.indexOf("#");
        if (hashAt < 0) {
          // A chapter entry: its top. The chapter before it is on the page
          // above (scrolling runs them together), so the top is where this
          // chapter's own frame starts: held there while the chapters round
          // it settle (readers/jumpSettle.ts).
          pinJump(() => sectionTop(fileTarget));
          return;
        }
        // An entry into the middle of a file (several chapters per file).
        // epub.js loads the file but, in scrolling mode, stays at its top, so
        // the page is taken to the anchor here, just below the floating toolbar.
        const id = decodeURIComponent(target.slice(hashAt + 1));
        pinJump(() => {
          for (const frame of Array.from(container.querySelectorAll("iframe"))) {
            const anchor = frame.contentDocument?.getElementById(id);
            if (anchor) {
              const top =
                anchor.getBoundingClientRect().top + frame.getBoundingClientRect().top - container.getBoundingClientRect().top;
              return Math.max(0, container.scrollTop + top - PAGE_TOP_PAD);
            }
          }
          return null;
        });
      })
      .catch(() => undefined);
  };

  return {
    lastProgressRef, lastComputedProgressRef, progressArmedRef, openedAtRef, lastCfiRef, lastCfiProgressRef,
    shownLineRef, lastCfiBelowRef, chapterPositionsRef, openedAtPlaceRef, soughtRef, storedPlaceRef, placeFollowsNow, carriedPlaceRef,
    updateBookProgress, sectionWeightsRef, readingPlace, readingPlaceCfi, sectionPlace, storyEndBottom,
    storyEndWasBelowRef, storyEndInView, goToPlace, settleOnPage, pageFrame, pagePlaceRef, pageRelayoutsRef, holdPlaceForRelayout,
    notePagePlace, relayPages, measurePagesAgain, clearToolbar, displayChapter, beginJump, pinJump, placeTopFor
  };
};

/**
 * A window resized lays the page out round the reading line. By a finger a
 * new width is a turn: under the veil, laid out once the window has settled,
 * and uncovered once the place is back (readers/relayoutFor.ts, `resizeDuringTurn`).
 */
export const useResizeRelayout = (reader: WithCover) => {
  const {
    book, clearToolbar, ensureSingleScrollContainer, layoutRef, loading, markNavigating, refreshReaderDot, relayPages,
    renditionRef, shownLineRef, viewerRef
  } = reader;
  useEffect(() => {
    if (loading) return;
    const viewer = viewerRef.current;
    const rendition = renditionRef.current;
    if (!viewer || !rendition?.resize) return;

    let frame = 0;
    /** A change of height, with pages, waiting to have held (readers/relayoutFor.ts). */
    let settleTimer = 0;
    /** A turn, waiting for the window to keep its size. */
    let turnTimer = 0;
    // The book was laid out at this size a moment ago. Telling epub.js the
    // size again made it clear the page (it measures the scrolling layout a
    // scrollbar narrower, so the two never agreed) with no place yet known to
    // put back: the book opened blank.
    let laidOut = { width: Math.round(viewer.clientWidth), height: Math.round(viewer.clientHeight) };
    // epub.js hears the window's resize itself, and lays the book out again
    // at any new size: not for a keyboard over the page (below), and by a
    // finger not at all (a turn is laid out once, below). Nor, by a finger,
    // does it hear the screen's own turn ("orientationchange"), which it laid
    // out at once and again half a second later, at whatever size the window
    // had reached by then.
    const stage = (rendition as any).manager?.stage;
    const ownResize = stage?.resizeFunc as ((...args: unknown[]) => void) | undefined;
    const ownTurn = stage?.orientationChangeFunc as ((...args: unknown[]) => void) | undefined;
    const touch = isTouchInput();
    /** Tells epub.js how tall the window is now, without laying anything out again (readers/relayoutFor.ts). */
    const refreshBounds = () => {
      const manager = (rendition as any).manager;
      try {
        if (manager && typeof manager.bounds === "function") {
          manager._bounds = manager.bounds();
        }
      } catch {
        // Measured again at the next layout.
      }
    };
    const heldResize = (...args: unknown[]) => {
      const now = { width: Math.round(viewer.clientWidth), height: Math.round(viewer.clientHeight) };
      // Scrolling, a change of height is not epub.js's to lay out again
      // (it emptied the page and went back to its last place: a search
      // result snapped back as the keyboard went down); with pages, the
      // keyboard coming up is not either. By a finger a new width is a
      // turn, laid out once it has settled (below).
      if (touch || relayoutFor(layoutRef.current, laidOut, now, keyboardOverPage()) !== "relayout") {
        refreshBounds();
        return;
      }
      ownResize?.(...args);
    };
    if (ownResize) {
      window.removeEventListener("resize", ownResize);
      stage.resizeFunc = heldResize;
      window.addEventListener("resize", heldResize);
    }
    if (touch && ownTurn) {
      window.removeEventListener("orientationchange", ownTurn);
    }
    const viewerSize = () => ({ width: Math.max(1, Math.round(viewer.clientWidth)), height: Math.max(1, Math.round(viewer.clientHeight)) });
    /** The turn has settled: laid out once, at the size it ended at, and uncovered once the place is back. */
    const endTurn = () => {
      turnTimer = 0;
      if (isFrozen(rendition) || renditionRef.current !== rendition) {
        return;
      }
      // The turn changes the layout itself (pages become a spread, or stop
      // being one): the book is drawn anew for it (useShapeLayout), which
      // uncovers the page once it is up. Laying this one out first was work
      // thrown away.
      if (windowChangesLayout({ layout: layoutRef.current, spread: reader.spreadRef.current })) {
        return;
      }
      const now = viewerSize();
      if (now.width === laidOut.width && now.height === laidOut.height) {
        // Turned and back again: nothing to lay out.
        liftReaderVeil();
        return;
      }
      relayoutNow(now.width, now.height, () => liftReaderVeil());
    };
    const syncViewport = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        // A page held on screen while the book is laid out anew is not laid out again (renditionGhost.ts).
        if (isFrozen(rendition) || renditionRef.current !== rendition) {
          return;
        }
        const { width, height } = viewerSize();
        // A phone's keyboard, come up for a note or a search, makes the page
        // shorter (Android resizes it to end at the keyboard): with pages the
        // book stays laid out as it was, under the keyboard, and is just as
        // it was when the keyboard goes. Scrolling, no change of height is
        // laid out again: the lines are where they were (readers/relayoutFor.ts).
        const need = resizeDuringTurn(
          relayoutFor(layoutRef.current, laidOut, { width, height }, keyboardOverPage()),
          touch,
          turnTimer !== 0
        );
        if (need === "none") {
          return;
        }
        if (need === "turn") {
          raiseReaderVeil(viewer);
          window.clearTimeout(settleTimer);
          settleTimer = 0;
          window.clearTimeout(turnTimer);
          turnTimer = window.setTimeout(endTurn, turnSettleNow());
          return;
        }
        if (need === "bounds") {
          laidOut = { width, height };
          refreshBounds();
          return;
        }
        if (need === "settle") {
          // Pages, a change of height not known to be our keyboard: laid out
          // once it has held, and not at all if it has gone back (a keyboard
          // from another app's notification came and went). The page stays
          // as it was meanwhile, under it.
          window.clearTimeout(settleTimer);
          settleTimer = window.setTimeout(() => {
            settleTimer = 0;
            const now = viewerSize();
            if (now.width === laidOut.width && now.height === laidOut.height) {
              return;
            }
            relayoutNow(now.width, now.height);
          }, SETTLE_HEIGHT_MS);
          return;
        }
        window.clearTimeout(settleTimer);
        settleTimer = 0;
        relayoutNow(width, height);
      });
    };
    /** Lays the book out again at this size, round the reader's place. `onShown`: the place is back on the page. */
    const relayoutNow = (width: number, height: number, onShown?: () => void) => {
      if (isFrozen(rendition) || renditionRef.current !== rendition) {
        return;
      }
      laidOut = { width, height };
      // With pages, round the reader's place (see pagePlaceRef): epub.js
      // would lay out round the first word of the page showing.
      // Scrolling, round the reading line as it was last seen (the text
      // may already have moved under the old scroll position by now).
      const held = layoutRef.current === "scroll" ? shownLineRef.current : null;
      relayPages((place) => (rendition as any).resize(width, height, place ?? held?.cfi ?? undefined), held ? undefined : onShown);
      if (held) {
        // epub.js puts the line at the top of the window, and cannot reach
        // one in a chapter's last screenful while the chapter stands alone:
        // it goes back to the reading line once the page is drawn again.
        markNavigating();
        reader.beginJump();
        void rendition.display(held.cfi).then(
          () => {
            if (renditionRef.current !== rendition) {
              return;
            }
            clearToolbar(held.cfi, held.below);
            reader.pinJump(() => reader.placeTopFor(held.cfi, held.below), onShown);
            // The pin puts the line back at its first look; the chapters
            // round it come in after without moving it (readers/keepStill.ts),
            // so the page is uncovered without waiting for them.
            if (onShown) {
              window.setTimeout(onShown, UNCOVER_AFTER_PIN_MS);
            }
          },
          () => onShown?.()
        );
      }
      ensureSingleScrollContainer();
      // Reflow moves the anchored word; the marker has to follow it.
      refreshReaderDot();
    };
    const observer = new ResizeObserver(() => {
      // A new width by a finger is a turn: covered now, before the frame is
      // drawn at it (the observer is heard before the paint), and laid out
      // once it has settled (syncViewport).
      if (touch && !isFrozen(rendition) && renditionRef.current === rendition && Math.round(viewer.clientWidth) !== laidOut.width) {
        raiseReaderVeil(viewer);
      }
      syncViewport();
    });
    observer.observe(viewer);
    syncViewport();
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.clearTimeout(turnTimer);
      observer.disconnect();
      if (ownResize && stage.resizeFunc === heldResize) {
        window.removeEventListener("resize", heldResize);
        stage.resizeFunc = ownResize;
        if (!isFrozen(rendition)) window.addEventListener("resize", ownResize);
      }
      if (touch && ownTurn && !isFrozen(rendition)) {
        window.addEventListener("orientationchange", ownTurn);
      }
    };
  }, [book.id, loading]);
};

/** Scrolling, a turn's page is uncovered this long after the reading line is pinned back (two or three of the pin's looks). */
const UNCOVER_AFTER_PIN_MS = 80;
