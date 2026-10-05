import { useEffect, useRef, useState } from "react";
import { easeInOutCubic } from "../smartScroll";
import { DOUBLE_CLICK_MS, WHEEL_AT_REST, clickZone, pageAt, pageCount, pageTurnDuration, pageTurnTarget, pressIsClick, strayPageTarget, swipeTurn, wheelTurn } from "../pageTurn";
import { MARK_NAME } from "../people/marks";
import { chapterPageRange } from "../chapterSpan";
import type { Later, WithAnnotations, WithContentsList } from "./scope";

/** Turning pages (the pages layout), and the page showing. */
export const usePageTurning = (reader: WithContentsList & Later<"markReadingActivity">) => {
  const {
    askedEntryRef, awayRef, bookRef, chapterEntryRef, chapterPagesHere, chapterStartsHere, clearSelectionRef,
    closeNoteRef, countPause, expectedWpm, getReaderWordRect, lastHandsOnAtRef, layoutRef, learnPace, markNavigating,
    navigatingUntilRef, noteJumpFromHere, noteRef, pagePaceRef, pageShownRef, progressArmedRef, readerWordsRef,
    releaseUserReadingAnchor, renditionRef, selectionRef, viewerRef
  } = reader;
  /** With pages, the page showing and how many its chapter has, for the dock. */
  const [pageOf, setPageOf] = useState<{ page: number; total: number } | null>(null);

  // Called from epub.js's relocation handler, which is bound once per book.
  const notePageShownRef = useRef<(location: any) => void>(() => undefined);

  /** Words on the page showing now (layout "pages"), from where they sit on screen. */
  const countWordsOnPage = () => {
    const words = readerWordsRef.current;
    const view = viewerRef.current?.getBoundingClientRect();
    if (!view || words.length === 0) {
      return 0;
    }
    // Pages are columns laid side by side, so the words run left to right a
    // page at a time: the first word at or past each edge is found by halving.
    const firstFrom = (x: number) => {
      let low = 0;
      let high = words.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        const rect = getReaderWordRect(words[middle]);
        if (rect && rect.left + rect.width / 2 >= x) {
          high = middle;
        } else {
          low = middle + 1;
        }
      }
      return low;
    };
    return Math.max(0, firstFrom(view.right) - firstFrom(view.left));
  };

  /**
   * A page came up (layout "pages"). When it is the page after the last one,
   * the last one was read: its words over the time it was up. Going back, or
   * jumping from the chapter list, starts the count over.
   */
  const notePageShown = (location: any) => {
    const href = String(location?.start?.href ?? "");
    const page = Number(location?.start?.displayed?.page) || 0;
    const total = Number(location?.start?.displayed?.total) || 0;
    const previous = pageShownRef.current;
    pageShownRef.current = { href, page, total };
    // A chapter asked for by name keeps its page until another page comes up
    // (the jump itself may pass through a page or two on its way).
    const asked = askedEntryRef.current;
    if (asked) {
      const here = `${href}#${page}`;
      if (asked.at === null || Date.now() < navigatingUntilRef.current) {
        asked.at = here;
      } else if (asked.at !== here) {
        askedEntryRef.current = null;
      }
    }
    // For the dock: "12 of 50". Of the chapter's pages, when chapters share a file.
    const counted = (page > 0 && total > 0 ? chapterPagesHere(Number(location?.start?.index), page, total) : null) ?? { page, total };
    setPageOf((shown) =>
      page > 0 && total > 0 ? (shown && shown.page === counted.page && shown.total === counted.total ? shown : counted) : null
    );
    if (!href || !page || awayRef.current) {
      return;
    }
    const now = Date.now();
    const forward =
      previous !== null &&
      now >= navigatingUntilRef.current &&
      ((previous.href === href && page === previous.page + 1) ||
        (previous.href !== href && page === 1 && previous.page >= previous.total));
    const key = `${href}#${page}`;
    const result = pagePaceRef.current.show(key, now, forward, expectedWpm());
    if (result.paused) {
      countPause();
    }
    if (result.sample) {
      learnPace(result.sample.words, result.sample.ms, "pages");
    }
    // Counted once the page's words are indexed (a new chapter is re-indexed).
    // A page of a picture or a title has too few to say anything.
    window.setTimeout(() => {
      const words = countWordsOnPage();
      if (words >= 20) {
        pagePaceRef.current.count(key, words);
      }
    }, 450);
  };
  notePageShownRef.current = notePageShown;

  /** A page sliding across: its frame, where it is going, and the chapter it is sliding in. */
  const pageSlideRef = useRef<{ frame: number; target: number; view: unknown } | null>(null);
  /**
   * Until then, a turn into another chapter is on its way. Turns made
   * meanwhile used to be handed to epub.js one after another (the new chapter
   * has no pages to count yet): a held arrow key ran on through the pages, and
   * past short chapters unseen, after it was let go, by epub.js's own "next"
   * with its skipped last page. They are dropped; a time, not a flag, so a
   * turn that never arrives cannot stop the pages for good.
   */
  const chapterTurnUntilRef = useRef(0);
  /** The one turn pressed while a chapter was on its way, made when it is up. */
  const queuedTurnRef = useRef<1 | -1 | null>(null);
  /**
   * Turns a page (layout "pages"). Through a ref, for the key handler bound
   * once. The page to turn to is worked out here (readers/pageTurn.ts):
   * epub.js's own "next" skipped the last page of a chapter. Within a chapter
   * the page slides across; into another chapter, the new page comes in from
   * the side.
   */
  const turnPage = (direction: 1 | -1, held = false) => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    lastHandsOnAtRef.current = Date.now();
    if (Date.now() < chapterTurnUntilRef.current) {
      // A chapter is on its way in. One press made meanwhile is kept and
      // made when it is up (a reader who presses twice at a chapter's end
      // means two pages); any more are dropped, as they always were, and so
      // are the repeats of a held key, which would run on past short
      // chapters unseen.
      if (!held) {
        queuedTurnRef.current ??= direction;
      }
      return;
    }
    // A page read slowly is reading: the turn claims the time the page was
    // up and nothing was touched (hooks/slowPage.ts), four minutes at most.
    reader.markReadingActivity.pageTurned();
    const manager = rendition.manager as any;
    const container = manager?.container as HTMLElement | undefined;
    const pageWidth = Number(manager?.layout?.delta) || 0;
    if (!container || pageWidth <= 0 || typeof manager?.scrollTo !== "function") {
      void (direction > 0 ? rendition.next() : rendition.prev());
      return;
    }
    // A right-to-left book's pages run the other way: the frame's position
    // counts down from nought. Turned as below it stayed on its first page
    // for good, and epub.js's own "next" stops for good on a chapter's last
    // page on a scaled display (the same fraction of a pixel as ever). The
    // pages are counted the same way, from the other end, without the slide.
    if (manager?.settings?.direction === "rtl") {
      if (manager.settings.rtlScrollType !== "negative") {
        // An engine that counts such a frame some other way: epub.js's turn.
        void (direction > 0 ? rendition.next() : rendition.prev());
        return;
      }
      const page = pageTurnTarget(Math.abs(container.scrollLeft), pageWidth, container.scrollWidth, direction);
      if (page !== null) {
        manager.scrollTo(-page, 0, true);
        void rendition.reportLocation?.();
        return;
      }
      const onward = direction > 0 ? manager.views?.last?.()?.section?.next?.() : null;
      if (onward?.href) {
        markNavigating();
        void rendition.display(onward.href);
      } else if (direction < 0) {
        // Its first page: epub.js goes to the last page of the chapter before.
        void rendition.prev();
      }
      return;
    }
    // The chapter the pages are counted in. A slide belongs to the chapter it
    // started in: once that has been swapped (a jump from the chapter list, a
    // resize), where it was going means nothing in the one now on the page.
    const view = manager.views?.first?.();
    // A turn made while the last is still sliding starts from where that one was going.
    const pending = pageSlideRef.current;
    const sliding = pending && pending.view === view ? pending : null;
    if (pending) {
      window.cancelAnimationFrame(pending.frame);
      pageSlideRef.current = null;
    }
    if (sliding) {
      manager.scrollTo(sliding.target, 0, true);
    }
    const from = sliding ? sliding.target : container.scrollLeft;
    let target = pageTurnTarget(from, pageWidth, container.scrollWidth, direction);
    if (target === null && direction > 0) {
      // The chapter's last page, by the frame's width. Text that grew after
      // the frame was sized (a face or a picture arriving late) runs on past
      // its end, unseen, and the turn would leave it unread: the frame is
      // measured again before the chapter is left.
      try {
        view?.expand?.();
      } catch {
        // The frame's own count stands.
      }
      target = pageTurnTarget(from, pageWidth, container.scrollWidth, direction);
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const beyond =
      target === null
        ? direction > 0
          ? manager.views?.last?.()?.section?.next?.()
          : manager.views?.first?.()?.section?.prev?.()
        : null;
    if (target === null && !beyond) {
      // The first or the last page of the book.
      return;
    }
    // The page is going, and what pointed into it with it: a selection (its
    // bar stayed up over the next page, offering to highlight words no longer
    // there) and a footnote's popup.
    if (selectionRef.current) {
      clearSelectionRef.current();
    }
    if (noteRef.current) {
      closeNoteRef.current();
    }
    if (target === null) {
      const viewer = viewerRef.current;
      if (viewer && !reduced) {
        viewer.dataset.turn = "out";
      }
      const until = Date.now() + 4000;
      chapterTurnUntilRef.current = until;
      queuedTurnRef.current = null;
      const shown = () => {
        chapterTurnUntilRef.current = 0;
        if (!viewer || viewer.dataset.turn !== "out") {
          return;
        }
        viewer.dataset.turn = direction > 0 ? "next" : "prev";
        window.setTimeout(() => {
          if (viewer.dataset.turn !== "out") {
            delete viewer.dataset.turn;
          }
        }, 340);
      };
      const arrived = () => {
        const stillComing = chapterTurnUntilRef.current === until;
        shown();
        // The press made while it was on its way, if there was one.
        const queued = queuedTurnRef.current;
        queuedTurnRef.current = null;
        if (stillComing && queued !== null && renditionRef.current === rendition) {
          turnPageRef.current(queued);
        }
      };
      const failed = () => {
        queuedTurnRef.current = null;
        shown();
      };
      void Promise.resolve(direction > 0 ? rendition.next() : rendition.prev()).then(arrived, failed);
      // The page is hidden until the chapter arrives; one that never does
      // must not leave it hidden (as with the turns dropped meanwhile, and
      // the one kept).
      window.setTimeout(() => {
        if (chapterTurnUntilRef.current === until) {
          failed();
        }
      }, 4000);
      return;
    }
    const duration = pageTurnDuration(reduced);
    if (duration === 0) {
      manager.scrollTo(target, 0, true);
      void rendition.reportLocation?.();
      return;
    }
    let startedAt: number | null = null;
    const step = (time: number) => {
      if (renditionRef.current !== rendition || manager.views?.first?.() !== view) {
        // Another chapter took the page mid-slide (or the book closed): the
        // slide used to carry on in it, and it opened some pages in.
        pageSlideRef.current = null;
        return;
      }
      startedAt ??= time;
      const progress = Math.min(1, (time - startedAt) / duration);
      // Quietly: the place is reported once, when the page has arrived.
      manager.scrollTo(from + (target - from) * easeInOutCubic(progress), 0, true);
      if (progress < 1) {
        pageSlideRef.current = { frame: window.requestAnimationFrame(step), target, view };
        return;
      }
      pageSlideRef.current = null;
      void rendition.reportLocation?.();
    };
    pageSlideRef.current = { frame: window.requestAnimationFrame(step), target, view };
  };
  const turnPageRef = useRef(turnPage);
  turnPageRef.current = turnPage;

  /**
   * Home, End, Ctrl+Home and Ctrl+End with pages: the first or the last page
   * of the chapter on the page, or of the book. Jumps: Back returns. (The
   * chapter is what the dock's "12 of 50" counts: the file, or the entry the
   * reader is in when the contents place several in one file.)
   */
  const goToPageEdge = (edge: "chapterStart" | "chapterEnd" | "bookStart" | "bookEnd") => {
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    const manager = rendition?.manager as any;
    const container = manager?.container as HTMLElement | undefined;
    const pageWidth = Number(manager?.layout?.delta) || 0;
    if (!rendition || !container || pageWidth <= 0 || layoutRef.current !== "pages") {
      return;
    }
    const rtl = manager.settings?.direction === "rtl";
    if (rtl && manager.settings.rtlScrollType !== "negative") {
      return;
    }
    const toLast = edge === "chapterEnd" || edge === "bookEnd";
    /** Home and End: the pages of the chapter the page showing is in, when the contents place several in this file. */
    const chapterRange = () => {
      const section = manager.views?.first?.()?.section?.index;
      if ((edge !== "chapterStart" && edge !== "chapterEnd") || rtl || typeof section !== "number") {
        return null;
      }
      const starts = chapterStartsHere(section);
      const at = pageAt(Math.abs(container.scrollLeft), pageWidth, container.scrollWidth);
      return starts ? chapterPageRange(at.page, at.total, starts, askedEntryRef.current?.entry) : null;
    };
    /** The first or the last page of the chapter on the page; false when it is showing already. */
    const toPage = () => {
      try {
        manager.views?.first?.()?.expand?.();
      } catch {
        // The frame's own count stands.
      }
      // (The chapter's own first or last page, when chapters share the file: readers/chapterSpan.ts.)
      const within = chapterRange();
      const left = within ? ((toLast ? within.last : within.first) - 1) * pageWidth : toLast ? (pageCount(container.scrollWidth, pageWidth) - 1) * pageWidth : 0;
      if (Math.abs(Math.abs(container.scrollLeft) - left) <= 1) {
        return false;
      }
      manager.scrollTo(rtl ? -left : left, 0, true);
      void rendition.reportLocation?.();
      return true;
    };
    const leave = () => {
      if (pageSlideRef.current) {
        window.cancelAnimationFrame(pageSlideRef.current.frame);
        pageSlideRef.current = null;
      }
      noteJumpFromHere();
      if (selectionRef.current) {
        clearSelectionRef.current();
      }
    };
    const here = manager.views?.first?.()?.section;
    const target = edge === "bookStart" ? epub?.spine?.first?.() : edge === "bookEnd" ? epub?.spine?.last?.() : here;
    if (!target?.href) {
      return;
    }
    if (here && target.index === here.index) {
      const at = pageAt(Math.abs(container.scrollLeft), pageWidth, container.scrollWidth);
      const within = chapterRange();
      if (within ? at.page !== (toLast ? within.last : within.first) : toLast ? at.page < at.total : at.page > 1) {
        leave();
        // Home asks for this chapter's start: the page it starts on, shared or not, is its own (see askedEntryRef).
        if (within && edge === "chapterStart") {
          askedEntryRef.current = { entry: chapterEntryRef.current, at: null };
        }
        toPage();
      }
      return;
    }
    leave();
    releaseUserReadingAnchor();
    progressArmedRef.current = true;
    markNavigating();
    void rendition
      .display(target.href)
      .then(() => {
        if (renditionRef.current === rendition && toLast) {
          toPage();
        }
      })
      .catch(() => undefined);
  };

  return {
    pageOf, setPageOf, notePageShownRef, pageSlideRef, chapterTurnUntilRef, queuedTurnRef, turnPage, turnPageRef,
    goToPageEdge
  };
};

/**
 * The pages layout's own input: a frame the browser moved put back on a whole
 * page, and the clicks, drags and wheel that turn pages.
 */
export const usePageInput = (reader: WithAnnotations) => {
  const {
    book, chapterTurnUntilRef, interruptedRef, layout, layoutRef, loading, morePanelOpen, navigatingUntilRef,
    pageFrame, pageSlideRef, pictureRef, renditionRef, selectionRef, shortcutsOpenRef, soundPanelOpen, turnPageRef,
    viewerRef
  } = reader;
  /** The ··· menu or the radio's controls are open (a click on the page is not a page turn then). */
  const pagesMenuOpenRef = useRef(false);
  pagesMenuOpenRef.current = morePanelOpen || soundPanelOpen;

  // With pages the frame is moved a page at a time, by turnPage and by
  // epub.js. The browser moves it too: to bring into view a link the Tab key
  // reached on another page, or a selection dragged past the page's edge,
  // and it stops wherever that takes it, between two pages (measured: 2.6
  // pages into a chapter of six). It is put back on the nearer whole page
  // (readers/pageTurn.ts, `strayPageTarget`) once it has come to rest and no
  // button is held on the text.
  useEffect(() => {
    const rendition = renditionRef.current;
    const container = (rendition?.manager as any)?.container as HTMLElement | undefined;
    if (loading || layout !== "pages" || !rendition || !container) {
      return;
    }
    let timer = 0;
    let pressed = false;
    const settle = () => {
      timer = 0;
      const frameNow = pageFrame();
      if (renditionRef.current !== rendition || !frameNow || frameNow.container !== container || pageSlideRef.current || pressed) {
        return;
      }
      // A chapter on its way in moves the frame too, and says where it is itself: look again after.
      const now = Date.now();
      if (now < chapterTurnUntilRef.current || now < navigatingUntilRef.current) {
        later();
        return;
      }
      const target = strayPageTarget(container.scrollLeft, frameNow.pageWidth, container.scrollWidth);
      if (target !== null) {
        frameNow.manager.scrollTo(target, 0, true);
      }
      // Another page than the one last told of (the browser can also stop
      // exactly on one): the place, the dock and the progress follow it.
      const page = pageAt(container.scrollLeft, frameNow.pageWidth, container.scrollWidth).page;
      if (target !== null || page !== Number(rendition.location?.start?.displayed?.page)) {
        void rendition.reportLocation?.();
      }
    };
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, 120);
    };
    const onScroll = () => {
      if (!pageSlideRef.current) {
        later();
      }
    };
    // A press, from the button (or finger) going down to its coming up: what
    // a click at the side of the page and a swipe across it are told from.
    let press: { x: number; y: number; at: number; selection: boolean; covered: boolean; sideways: boolean; fingers: number } | null = null;
    const fingersDown = new Set<number>();
    let clickTimer = 0;
    const selecting = (doc: Document | null | undefined) => {
      try {
        const picked = doc?.defaultView?.getSelection?.();
        return Boolean(picked && !picked.isCollapsed && picked.toString().trim());
      } catch {
        return false;
      }
    };
    /** Something is open over the page: a click is for closing it, not for turning. */
    const covered = () => interruptedRef.current || pagesMenuOpenRef.current;
    const down = (event: PointerEvent) => {
      pressed = true;
      // A second press: a double-click, or the start of a selection.
      window.clearTimeout(clickTimer);
      clickTimer = 0;
      if (event.isPrimary) {
        // The first finger of a new touch: any still counted were let go out of sight.
        fingersDown.clear();
      }
      fingersDown.add(event.pointerId);
      if (fingersDown.size > 1) {
        if (press) {
          press.fingers = Math.max(press.fingers, fingersDown.size);
        }
        return;
      }
      const onto = event.target as Node | null;
      let sideways = false;
      for (let over = onto?.nodeType === 1 ? (onto as Element) : null; over && over !== over.ownerDocument.body; over = over.parentElement) {
        const overflow = over.ownerDocument.defaultView?.getComputedStyle(over).overflowX;
        if ((overflow === "auto" || overflow === "scroll") && over.scrollWidth > over.clientWidth + 1) {
          sideways = true;
          break;
        }
      }
      press = {
        x: event.clientX,
        y: event.clientY,
        at: performance.now(),
        selection: selectionRef.current !== null || selecting(onto?.ownerDocument),
        covered: covered(),
        sideways,
        fingers: 1
      };
    };
    const up = (event?: PointerEvent) => {
      pressed = false;
      later();
      if (!event || !fingersDown.delete(event.pointerId)) {
        return;
      }
      // A swipe across the page with a finger or a pen turns it (readers/pageTurn.ts, `swipeTurn`).
      if (event.type !== "pointerup" || fingersDown.size > 0 || !press || renditionRef.current !== rendition || layoutRef.current !== "pages") {
        return;
      }
      const turn = swipeTurn(
        {
          dx: event.clientX - press.x,
          dy: event.clientY - press.y,
          ms: performance.now() - press.at,
          pointers: press.fingers,
          pointerType: event.pointerType,
          taken: press.sideways || press.covered || press.selection || selecting((event.target as Node | null)?.ownerDocument)
        },
        (rendition.manager as any)?.settings?.direction === "rtl"
      );
      if (turn !== null) {
        press = null;
        turnPageRef.current(turn);
      }
    };
    // A click (or a tap) at the side of the page turns it (readers/pageTurn.ts,
    // `clickZone`, `pressIsClick`): the outer sixth each side, and beside the
    // page. Only a click that is nothing else: not a drag or a selection, not
    // on a link, a note, a picture, a marked name, a highlight or a control,
    // and not while something is open over the page. On text it waits out a
    // double-click, which selects a word.
    const OWN_CLICK =
      "a[href], area[href], [role='link'], [role='button'], [role='doc-noteref'], button, input, textarea, select, option, label, summary, details, audio, video, [contenteditable], [onclick], [data-leaflet-zoom]";
    const within = (x: number, y: number, rects: Iterable<DOMRect>, slack = 2) => {
      for (const rect of rects) {
        if (x >= rect.left - slack && x <= rect.right + slack && y >= rect.top - slack && y <= rect.bottom + slack) {
          return true;
        }
      }
      return false;
    };
    /** What of the book's text is under a point of its document: whether any is, and whether it is a name the character tracker marked. */
    const textAt = (doc: Document, x: number, y: number) => {
      try {
        const caret = (doc as any).caretRangeFromPoint?.(x, y) as Range | null;
        const node = caret?.startContainer;
        if (!caret || !node || node.nodeType !== 3) {
          return { text: false, name: false };
        }
        const length = (node as Text).data.length;
        const letters = doc.createRange();
        letters.setStart(node, Math.max(0, caret.startOffset - 1));
        letters.setEnd(node, Math.min(length, caret.startOffset + 1));
        if (!within(x, y, Array.from(letters.getClientRects()))) {
          return { text: false, name: false };
        }
        const marks = (doc.defaultView as any)?.CSS?.highlights?.get?.(MARK_NAME) as Iterable<Range> | undefined;
        let name = false;
        for (const mark of marks ?? []) {
          if (mark.isPointInRange(node, caret.startOffset) && within(x, y, Array.from(mark.getClientRects()))) {
            name = true;
            break;
          }
        }
        return { text: true, name };
      } catch {
        return { text: false, name: false };
      }
    };
    /** Which way a click at this point of the page turns it, if it is in a zone; and the facts of where it landed. */
    const clickPlace = (event: MouseEvent) => {
      const frameNow = (rendition.manager as any)?.container === container ? container : null;
      const onto = event.target as Node | null;
      const target = onto?.nodeType === 1 ? (onto as Element) : (onto?.parentElement ?? null);
      const doc = onto?.ownerDocument ?? null;
      if (!frameNow || !doc || renditionRef.current !== rendition || layoutRef.current !== "pages") {
        return null;
      }
      const inBook = doc !== document;
      const viewer = viewerRef.current;
      // Beside the page, only the bare frame: the dock, a bar or a card there has its own clicks.
      if (!inBook && !(target === pageFrameElement || (viewer && target && viewer.contains(target)))) {
        return null;
      }
      const box = container.getBoundingClientRect();
      const held = inBook ? (doc.defaultView?.frameElement?.getBoundingClientRect() ?? null) : null;
      const x = event.clientX + (held?.left ?? 0);
      const y = event.clientY + (held?.top ?? 0);
      const margin = inBook && doc.body ? parseFloat(doc.defaultView?.getComputedStyle(doc.body).paddingLeft ?? "") || 0 : 0;
      const turn = clickZone(x, box.left, box.width, margin, (rendition.manager as any)?.settings?.direction === "rtl");
      if (turn === null) {
        return null;
      }
      const under = inBook ? textAt(doc, event.clientX, event.clientY) : { text: false, name: false };
      const highlight = viewer ? within(x, y, Array.from(viewer.querySelectorAll(".leaflet-highlight rect"), (mark) => mark.getBoundingClientRect()), 0) : false;
      return { turn, doc, inBook, onText: under.text, claimed: Boolean(target?.closest?.(OWN_CLICK)) || under.name || highlight };
    };
    const onClick = (event: MouseEvent) => {
      const from = press;
      press = null;
      const place = clickPlace(event);
      if (!place) {
        return;
      }
      const plain = pressIsClick({
        button: event.button,
        modified: event.ctrlKey || event.metaKey || event.shiftKey || event.altKey,
        moved: from ? Math.hypot(event.clientX - from.x, event.clientY - from.y) : 0,
        ms: from ? performance.now() - from.at : 0,
        // In the margin every click is its own (see onMouseDown); on text the second of two selects a word.
        count: place.onText ? event.detail || 1 : 1,
        selection: (from?.selection ?? false) || selectionRef.current !== null || selecting(place.doc),
        covered: (from?.covered ?? false) || covered(),
        claimed: event.defaultPrevented || place.claimed
      });
      if (!plain) {
        return;
      }
      const turn = () => {
        clickTimer = 0;
        if (renditionRef.current === rendition && layoutRef.current === "pages" && !covered() && !selecting(place.doc)) {
          turnPageRef.current(place.turn);
        }
      };
      window.clearTimeout(clickTimer);
      if (place.onText) {
        clickTimer = window.setTimeout(turn, DOUBLE_CLICK_MS);
      } else {
        turn();
      }
    };
    // Clicks made quickly in the margin are page turns, one each: the second
    // of them must not select the nearest word of the page that has come up.
    const onMouseDown = (event: MouseEvent) => {
      if (event.detail < 2 || event.button !== 0) {
        return;
      }
      const place = clickPlace(event);
      if (place && place.inBook && !place.onText && !place.claimed) {
        event.preventDefault();
      }
    };
    // The wheel and the trackpad turn pages, one for a gesture however many
    // events it sends (readers/pageTurn.ts, `wheelTurn`). They used to do
    // nothing at all here. Not with Ctrl held (that is zoom), nor over what
    // scrolls by itself (a wide table in the page, a card, a note's popup).
    let wheel = WHEEL_AT_REST;
    const onWheel = (event: WheelEvent) => {
      if (renditionRef.current !== rendition || layoutRef.current !== "pages" || event.ctrlKey || event.defaultPrevented) {
        return;
      }
      if (pictureRef.current || shortcutsOpenRef.current) {
        return;
      }
      const stop = event.currentTarget instanceof Element ? event.currentTarget : null;
      const onto = event.target as Node | null;
      for (let over = onto?.nodeType === 1 ? (onto as Element) : null; over && over !== stop; over = over.parentElement) {
        if (over === over.ownerDocument.body || over === over.ownerDocument.documentElement) {
          break;
        }
        if (over.matches?.('[role="dialog"], [role="alertdialog"]')) {
          return;
        }
        const style = over.ownerDocument.defaultView?.getComputedStyle(over);
        const scrolls = (overflow: string | undefined, content: number, room: number) =>
          (overflow === "auto" || overflow === "scroll") && content > room + 1;
        if (scrolls(style?.overflowY, over.scrollHeight, over.clientHeight) || scrolls(style?.overflowX, over.scrollWidth, over.clientWidth)) {
          return;
        }
      }
      const step = wheelTurn(wheel, performance.now(), event.deltaX, event.deltaY, event.deltaMode);
      wheel = step.gesture;
      if (step.turn !== null) {
        event.preventDefault();
        turnPageRef.current(step.turn);
      }
    };
    // A drag is made, and the wheel turned, in the chapter's own document, which goes with its chapter.
    const bound = new WeakSet<Document>();
    const bind = () => {
      (rendition.getContents?.() ?? []).forEach((contents: any) => {
        const doc = contents?.document as Document | undefined;
        if (!doc || bound.has(doc)) {
          return;
        }
        bound.add(doc);
        doc.addEventListener("pointerdown", down, { passive: true });
        doc.addEventListener("pointerup", up, { passive: true });
        doc.addEventListener("pointercancel", up, { passive: true });
        doc.addEventListener("wheel", onWheel, { passive: false });
        // After the reader's own handlers and the book's links, which run first, capturing (as the names' own does).
        doc.addEventListener("click", onClick);
        doc.addEventListener("mousedown", onMouseDown);
      });
    };
    bind();
    rendition.on?.("rendered", bind);
    const upAnywhere = () => up();
    window.addEventListener("pointerup", upAnywhere);
    container.addEventListener("scroll", onScroll, { passive: true });
    // And beside the page: the reader's own frame, which is wider than the column.
    const pageFrameElement = viewerRef.current?.parentElement ?? null;
    pageFrameElement?.addEventListener("wheel", onWheel, { passive: false });
    pageFrameElement?.addEventListener("pointerdown", down, { passive: true });
    pageFrameElement?.addEventListener("pointerup", up, { passive: true });
    pageFrameElement?.addEventListener("pointercancel", up, { passive: true });
    pageFrameElement?.addEventListener("click", onClick);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clickTimer);
      rendition.off?.("rendered", bind);
      window.removeEventListener("pointerup", upAnywhere);
      container.removeEventListener("scroll", onScroll);
      pageFrameElement?.removeEventListener("wheel", onWheel);
      pageFrameElement?.removeEventListener("pointerdown", down);
      pageFrameElement?.removeEventListener("pointerup", up);
      pageFrameElement?.removeEventListener("pointercancel", up);
      pageFrameElement?.removeEventListener("click", onClick);
    };
  }, [book.id, loading, layout]);
};
