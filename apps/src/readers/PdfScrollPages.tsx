import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type RefObject
} from "react";
import { isRenderCancelled, type PageJob, type PdfExtras, type RenderedPage } from "./pageSources";
import { toneCss, type PageTone } from "./pageTone";
import {
  PAGE_GAP,
  columnHeight,
  currentPageAt,
  isJump,
  layOut,
  pageBox,
  pageScale,
  pagesNear,
  pagesWanted,
  placeAt,
  planDraw,
  scrollForAnchor,
  sharpEnough,
  type Anchor,
  type PageSize,
  type Place,
  type StoredPlace
} from "./pageScroll";
import { MAX_CANVAS_PIXELS, canvasPixelRatio, scaleFor, type PageFit } from "./pageZoom";
import type { PdfSearchHit } from "./pdfSearch";
import { currentMark, pageMarks, type MeasureText, type PageRect } from "./pdfText";
import { PdfLinkAreas, bindLinkPointer } from "./PdfLinkAreas";
import type { PageLink } from "./pdfLinks";
import { bindTextSelection } from "./pdfTextLayer";
import { PdfHighlightMarks, type PageHighlight } from "./usePdfNotes";

export { placeToOpen, type StoredPlace } from "./pageScroll";

/**
 * Where the scroll opens. A stored place is where the top of the window was;
 * `atLine` says the place is the reader's line instead (a third of the way
 * down the window), as when the paged layout hands its page over.
 */
export type OpenPlace = StoredPlace & { atLine?: boolean };

export type ScrollPagesHandle = {
  /** Scrolls to a page (from 1): its top, or `fraction` of the way down it, a third down the window. */
  goTo(page: number, fraction?: number): void;
  /** Reads the scroll position now. A scroll event does this; a position set by hand must say so. */
  sync(): void;
  /**
   * Before the pages change size: the point of the document under `about`
   * (the pointer; the reader's line when absent) is to stay where it is.
   */
  holdAt(about?: { x: number; y: number }): void;
  /** The reader's line: the page (from 1) across a third of the way down the window, and how far down it. */
  line(): { page: number; fraction: number } | null;
};

type PdfScrollPagesProps = {
  pdf: PdfExtras;
  pageCount: number;
  actualScale: number;
  /** The scroller: the reader's stage. */
  stageRef: RefObject<HTMLDivElement>;
  fit: PageFit;
  zoom: number;
  tone: PageTone | null;
  /** The room a page has in the stage. */
  measureRoom: () => { availableWidth: number; availableHeight: number };
  /** Bumped when the stage changes size. */
  viewportRevision: number;
  /** Where to open: the top of the window is here, or the reader's line (`atLine`). */
  initialPlace: OpenPlace;
  /** The phrase a search is marking, and the result chosen. */
  searchQuery: string;
  /** The reader's highlights, by page (from 1). */
  highlights?: Map<number, PageHighlight[]>;
  activeHit: PdfSearchHit | null;
  onPage: (page: number) => void;
  /** The scale the pages are at, and the size (at scale 1) it was worked out for. */
  onScale: (scale: number, reference: PageSize) => void;
  /** Where the top of the window is, a moment after the reader stops scrolling and on closing. */
  onPlace: (place: StoredPlace) => void;
  /** The reader scrolled: they are reading. */
  onActivity: () => void;
  /** A link on a page was clicked, or followed from the keyboard. */
  onLink: (link: PageLink) => void;
};

/**
 * A page's canvas holds no more than this many device pixels in this layout,
 * half what a page shown alone may, as several are held at once...
 */
const PAGE_PIXELS = 1 << 23;
/**
 * ...except the page being read (the one across the reader's line), which
 * may hold what a page shown alone may. On a 4K screen at 200% a page at fit
 * width wants 11.5M pixels, and under the lower cap the page being read was
 * drawn at 1.70 device pixels for each of the screen's 2.
 */
const READING_PIXELS = MAX_CANVAS_PIXELS;
/**
 * Everything drawn, and the page being drawn counted twice (its sheet out of
 * sight and the copy toning reads back), stays within this: 50.3M pixels,
 * about 200 MB. It was 33.5M (134 MB) before the page being read was given
 * more; nothing nears it unless a page is large enough to meet the caps.
 */
const PIXEL_BUDGET = 3 << 24;
/** A page's top is put this far below the top of the window by "go to". */
const TOP_INSET = 12;
/** Drawing waits this long after a jump, in case another follows. */
const SETTLE_MS = 140;
const PLACE_SAVE_MS = 400;
const ACTIVITY_EVERY_MS = 4000;
const MARKS_PER_PAGE = 400;

type Drawn = { pixels: number; key: string; cap: number };
/** A page's marks: a list for each match, and whether the last is the end of one begun on the page before. */
type PageMarks = { rects: PageRect[][]; head: boolean };
type Marks = { query: string; pages: Map<number, PageMarks> };

type ScrollPageProps = {
  index: number;
  pageCount: number;
  top: number;
  left: number;
  width: number;
  height: number;
  paper: string | undefined;
  dark: boolean;
  drawn: boolean;
  failed: boolean;
  marks: PageRect[][] | undefined;
  currentMark: number | null;
  links: PageLink[] | undefined;
  /** The reader's highlights on this page (readers/usePdfNotes.tsx). */
  highlights: PageHighlight[] | undefined;
  onLink: (link: PageLink) => void;
  register: (index: number, canvas: HTMLCanvasElement | null, layer: HTMLDivElement | null) => void;
};

const NO_LINKS: PageLink[] = [];

/** One page of the column: its canvas, the search's marks and its text layer. */
const ScrollPage = memo((props: ScrollPageProps) => {
  const { index, register } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const links = props.links ?? NO_LINKS;
  const linksRef = useRef(links);
  linksRef.current = links;
  const onLinkRef = useRef(props.onLink);
  onLinkRef.current = props.onLink;

  // A click on one of the page's links (readers/PdfLinkAreas.tsx).
  useEffect(
    () => (box.current ? bindLinkPointer(box.current, () => linksRef.current, (link) => onLinkRef.current(link)) : undefined),
    []
  );

  useEffect(() => {
    register(index, canvas.current, layer.current);
    const unbind = layer.current ? bindTextSelection(layer.current) : undefined;
    return () => {
      unbind?.();
      register(index, null, null);
    };
  }, [index, register]);

  return (
    <div
      ref={box}
      className="pdf-reader-page pdf-scroll-page"
      data-page={index + 1}
      data-dark={props.dark ? "true" : undefined}
      style={{
        top: props.top,
        left: props.left,
        width: props.width,
        height: props.height,
        background: props.paper
      }}
    >
      <canvas ref={canvas} aria-label={`Page ${index + 1} of ${props.pageCount}`} />
      {/* A page not drawn yet is the colour of the page, with its number:
          a fast scroll on a dark finish does not flash white. */}
      {!props.drawn && (
        <span className="pdf-scroll-page-number" aria-hidden="true">
          {props.failed ? `Page ${index + 1} could not be drawn` : index + 1}
        </span>
      )}
      <div className="pdf-reader-marks" aria-hidden="true">
        {props.marks?.map((rects, nth) =>
          rects.map((rect, part) => (
            <span
              key={`${nth}-${part}`}
              className={`pdf-reader-mark ${props.currentMark === nth ? "is-current" : ""}`}
              style={{
                left: `${rect.left * 100}%`,
                top: `${rect.top * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`
              }}
            />
          ))
        )}
      </div>
      <PdfHighlightMarks highlights={props.highlights} />
      {links.length > 0 && <PdfLinkAreas links={links} onFollow={props.onLink} />}
      <div ref={layer} className="textLayer" />
    </div>
  );
});
ScrollPage.displayName = "ScrollPage";

/**
 * Continuous scrolling for a PDF: all its pages in one column in the reader's
 * stage (readers/pageScroll.ts has the arithmetic and the reasons).
 *
 * Only the pages near the window are in the document. Each takes its real
 * size when it comes near, and the reader's place is put back in the same
 * commit, before anything is painted, so the page does not move under the
 * eye. Pages are drawn one at a time, nearest the reader first, within a
 * budget of pixels; one that has scrolled away before it was drawn is given
 * up, and the furthest are let go of to make room.
 */
export const PdfScrollPages = forwardRef<ScrollPagesHandle, PdfScrollPagesProps>((props, handle) => {
  const { pdf, pageCount, actualScale, stageRef, fit, zoom, tone, measureRoom, viewportRevision } = props;
  const columnRef = useRef<HTMLDivElement>(null);
  // The first page's size: what a page not yet seen is taken to be, and what the fits are worked out for.
  const [reference, setReference] = useState<PageSize | null>(null);
  const sizesRef = useRef(new Map<number, PageSize>());
  const askedRef = useRef(new Set<number>());
  const [sizesVersion, bumpSizes] = useReducer((version: number) => version + 1, 0);
  const [near, setNear] = useState({ first: 0, last: 0 });
  const [, bumpDrawn] = useReducer((version: number) => version + 1, 0);
  const [marks, setMarks] = useState<Marks>({ query: "", pages: new Map() });
  const [links, setLinks] = useState<Map<number, PageLink[]>>(() => new Map());

  const canvasesRef = useRef(new Map<number, HTMLCanvasElement>());
  const layersRef = useRef(new Map<number, HTMLDivElement>());
  const drawnRef = useRef(new Map<number, Drawn>());
  const failedRef = useRef(new Set<string>());
  const jobRef = useRef<{ index: number; key: string; cap: number; job: PageJob<RenderedPage> } | null>(null);
  const textJobsRef = useRef(new Map<number, PageJob<void>>());
  const anchorRef = useRef<Anchor | null>(null);
  // Across the page, for a zoom about the pointer: the page under it and how far across.
  const acrossRef = useRef<{ page: number; fraction: number; x: number } | null>(null);
  // The scroll position this component last set, to tell its own scrolls from the reader's.
  const ownScrollRef = useRef<number | null>(null);
  const nearRef = useRef(near);
  const currentRef = useRef(-1);
  const lastTopRef = useRef(0);
  const settleRef = useRef<number | null>(null);
  const placeTimerRef = useRef<number | null>(null);
  const lastActivityRef = useRef(0);
  const shownHitRef = useRef<string | null>(null);
  // Where the top of the window is, kept at every read: what is saved on closing, when the stage is already gone.
  const topPlaceRef = useRef<Place | null>(null);
  const measureContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const openedRef = useRef(false);
  // The scale (and the width no page is drawn past) the pages were last laid out at.
  const scaleKeyRef = useRef<string | null>(null);
  // The column's width, and the scale and room it is the width for.
  const widestRef = useRef({ key: "", width: 0 });
  // The latest callbacks, for listeners and timers that outlive a render.
  const callbacks = useRef(props);
  callbacks.current = props;

  // The document's scale, from its first page; and, under a fit, the width no page is drawn past.
  const { scale, limit } = useMemo(
    () => {
      if (!reference) {
        return { scale: 1, limit: null as number | null };
      }
      const room = measureRoom();
      return {
        scale: scaleFor(reference, { fit, zoom, ...room }, actualScale),
        limit: fit === "width" || fit === "page" ? room.availableWidth : null
      };
    },
    // `viewportRevision` is why the room is measured again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actualScale, fit, measureRoom, reference, viewportRevision, zoom]
  );
  const sizeOf = useCallback(
    (index: number) => sizesRef.current.get(index) ?? reference ?? { width: 1, height: 1 },
    // `sizesVersion` stands for the sizes in the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reference, sizesVersion]
  );
  /** The scale a page is drawn at: the document's, or less for a page too wide for the window (pageScroll.ts). */
  const scaleOf = useCallback((index: number) => pageScale(sizeOf(index), scale, limit), [limit, scale, sizeOf]);
  const boxOf = useCallback((index: number) => pageBox(sizeOf(index), scaleOf(index)), [scaleOf, sizeOf]);
  const tops = useMemo(() => layOut(reference ? pageCount : 0, (index) => boxOf(index).height), [boxOf, pageCount, reference]);
  const toneKey = tone ? `${tone.dark ? "d" : "l"}${tone.paper.join(",")}/${tone.ink.join(",")}` : "none";
  const topsRef = useRef(tops);
  const boxOfRef = useRef(boxOf);
  const scaleOfRef = useRef(scaleOf);
  const toneKeyRef = useRef(toneKey);
  const toneRef = useRef(tone);
  boxOfRef.current = boxOf;
  scaleOfRef.current = scaleOf;
  toneRef.current = tone;
  /** What a page's drawing is for: its scale and the finish. A drawing for another is stale. */
  const keyOf = useCallback((index: number) => `${scaleOfRef.current(index)}|${toneKeyRef.current}`, []);

  /** How far down the stage's content the column begins: the stage's own room above it. */
  const columnTop = useCallback(() => {
    const stage = stageRef.current;
    const column = columnRef.current;
    if (!stage || !column) {
      return 0;
    }
    return column.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop;
  }, [stageRef]);

  /** A page asked for (`goTo`) before the first layout, for that layout to open at. */
  const askedBeforeOpenRef = useRef<{ page: number; fraction: number } | null>(null);
  /** Where the window is put for a page gone to: its top, or a place down it a third of the way down the window. */
  const anchorFor = (page: number, fraction: number): Anchor => {
    const index = Math.min(pageCount, Math.max(1, Math.round(page))) - 1;
    const atStart = index === 0 && fraction <= 0;
    return {
      place: { page: index, fraction, extra: 0 },
      // The very start of the book is the scroller's own start, the room above the first page in view.
      offset: atStart ? columnTop() : fraction > 0 ? (stageRef.current?.clientHeight ?? 0) / 3 : TOP_INSET
    };
  };

  /** The top of the window, down the column. */
  const viewTop = useCallback(() => (stageRef.current?.scrollTop ?? 0) - columnTop(), [columnTop, stageRef]);

  /** The most pixels a page's canvas may hold: more for the page being read. */
  const capOf = useCallback((index: number) => (index === currentRef.current ? READING_PIXELS : PAGE_PIXELS), []);

  /** Whether a drawing made under `cap` is as sharp as the page should now be. */
  const sharp = useCallback(
    (index: number, cap: number) => sharpEnough(boxOfRef.current(index), window.devicePixelRatio || 1, cap, capOf(index)),
    [capOf]
  );

  const pixelsOf = useCallback(
    (index: number) => {
      const box = boxOfRef.current(index);
      const ratio = canvasPixelRatio(box.width, box.height, window.devicePixelRatio || 1, capOf(index));
      return Math.floor(box.width * ratio) * Math.floor(box.height * ratio);
    },
    [capOf]
  );

  const layText = useCallback(
    (index: number) => {
      const layer = layersRef.current.get(index);
      textJobsRef.current.get(index)?.cancel();
      textJobsRef.current.delete(index);
      if (!layer) {
        return;
      }
      const job = pdf.layTextOn(index + 1, layer, scaleOfRef.current(index));
      textJobsRef.current.set(index, job);
      // A page whose text cannot be laid is still a page to read.
      job.promise
        .catch(() => undefined)
        .finally(() => {
          if (textJobsRef.current.get(index) === job) {
            textJobsRef.current.delete(index);
          }
        });
    },
    [pdf]
  );

  const clearText = useCallback((index: number) => {
    textJobsRef.current.get(index)?.cancel();
    textJobsRef.current.delete(index);
    layersRef.current.get(index)?.replaceChildren();
  }, []);

  /** Lets go of a page's drawing: its pixels now, not at the next collection. */
  const release = useCallback(
    (index: number) => {
      const canvas = canvasesRef.current.get(index);
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      drawnRef.current.delete(index);
      clearText(index);
    },
    [clearText]
  );

  /** Draws the next page that needs it, one at a time, nearest the reader first. */
  const pump = useCallback(() => {
    const stage = stageRef.current;
    // A jump is settling: nothing is drawn for places passed on the way.
    if (!stage || settleRef.current !== null) {
      return;
    }
    // A page is drawn once its size is known: drawn at a guess, a landscape
    // page would be drawn twice.
    const wanted = pagesWanted(topsRef.current, viewTop(), stage.clientHeight, nearRef.current).filter(
      (index) =>
        canvasesRef.current.has(index) &&
        sizesRef.current.has(index) &&
        !failedRef.current.has(`${index}|${keyOf(index)}`)
    );
    const running = jobRef.current;
    if (running) {
      if (running.key === keyOf(running.index) && sharp(running.index, running.cap) && wanted.includes(running.index)) {
        return;
      }
      // The page being drawn has scrolled away, or is for a size or finish no
      // longer wanted, or has become the page being read and is owed more pixels.
      jobRef.current = null;
      running.job.cancel();
    }
    const current = Math.max(0, currentRef.current);
    const drawn = new Map<number, number>();
    const fresh = new Set<number>();
    drawnRef.current.forEach((record, index) => {
      drawn.set(index, record.pixels);
      // A page drawn for its neighbours' cap is drawn again when it becomes
      // the one being read, if that would make it sharper; its soft drawing
      // stays up meanwhile. One drawn sharp is good for as long as it is kept.
      if (record.key === keyOf(index) && sharp(index, record.cap)) {
        fresh.add(index);
      }
    });
    const plan = planDraw({
      wanted,
      drawn,
      fresh,
      pixelsOf,
      distanceOf: (index) => Math.abs(index - current),
      budget: PIXEL_BUDGET
    });
    if (plan.release.length > 0) {
      plan.release.forEach(release);
      bumpDrawn();
    }
    if (plan.draw === null) {
      return;
    }
    const index = plan.draw;
    const canvas = canvasesRef.current.get(index);
    if (!canvas) {
      return;
    }
    const key = keyOf(index);
    const cap = capOf(index);
    const job = pdf.draw(index + 1, canvas, {
      scale: scaleOfRef.current(index),
      tone: toneRef.current,
      maxPixels: cap
    });
    jobRef.current = { index, key, cap, job };
    job.promise
      .then((page) => {
        if (jobRef.current?.job !== job) {
          return;
        }
        jobRef.current = null;
        drawnRef.current.set(index, { pixels: canvas.width * canvas.height, key, cap });
        const known = sizesRef.current.get(index);
        if (!known || known.width !== page.width || known.height !== page.height) {
          sizesRef.current.set(index, { width: page.width, height: page.height });
          bumpSizes();
        }
        bumpDrawn();
        layText(index);
        pump();
      })
      .catch((failure) => {
        if (jobRef.current?.job === job) {
          jobRef.current = null;
        }
        if (!isRenderCancelled(failure)) {
          failedRef.current.add(`${index}|${key}`);
          bumpDrawn();
        }
        pump();
      });
  }, [capOf, keyOf, layText, pdf, pixelsOf, release, sharp, stageRef, viewTop]);

  /**
   * Holds drawing back for a moment, because more of the same is likely to
   * follow: a drag of the scrollbar, a pinch, a window being resized. What is
   * drawn meanwhile stays up, stretched to its page.
   */
  const holdDrawing = useCallback(() => {
    if (settleRef.current !== null) {
      window.clearTimeout(settleRef.current);
    }
    jobRef.current?.job.cancel();
    jobRef.current = null;
    settleRef.current = window.setTimeout(() => {
      settleRef.current = null;
      pump();
    }, SETTLE_MS);
  }, [pump]);

  /** Reads where the window is: which pages are near, which page the reader is on, and what to draw. */
  const read = useCallback(
    (byReader: boolean) => {
      const stage = stageRef.current;
      const layout = topsRef.current;
      if (!stage || layout.length < 2) {
        return;
      }
      const top = viewTop();
      const height = stage.clientHeight;
      topPlaceRef.current = placeAt(layout, top);
      const next = pagesNear(layout, top, height, Math.max(height, 600));
      if (next.first !== nearRef.current.first || next.last !== nearRef.current.last) {
        nearRef.current = next;
        setNear(next);
      }
      const current = currentPageAt(layout, top, height);
      if (current !== currentRef.current) {
        currentRef.current = current;
        callbacks.current.onPage(current + 1);
      }
      if (byReader) {
        // The reader's line is what is kept when sizes above it change.
        anchorRef.current = { place: placeAt(layout, top + height / 3), offset: height / 3 };
        acrossRef.current = null;
        const now = performance.now();
        if (now - lastActivityRef.current > ACTIVITY_EVERY_MS) {
          lastActivityRef.current = now;
          callbacks.current.onActivity();
        }
      }
      if (placeTimerRef.current !== null) {
        window.clearTimeout(placeTimerRef.current);
      }
      placeTimerRef.current = window.setTimeout(() => {
        placeTimerRef.current = null;
        const place = topPlaceRef.current;
        if (place) {
          callbacks.current.onPlace({ ...place, page: place.page + 1, current: currentRef.current + 1 });
        }
      }, PLACE_SAVE_MS);
      // A jump (a drag of the scrollbar, a leap to a page) draws nothing
      // until it settles; reading draws as it goes.
      const jumped = isJump(lastTopRef.current, top, height);
      lastTopRef.current = top;
      if (jumped) {
        holdDrawing();
      } else {
        // While a jump is settling this does nothing: a page taking its size
        // on the way must not start the drawing the jump is holding back.
        pump();
      }
    },
    [holdDrawing, pump, stageRef, viewTop]
  );

  /** Puts the point held across the page back under its place in the window; false when none is held. */
  const applyAcross = useCallback(() => {
    const stage = stageRef.current;
    const across = acrossRef.current;
    if (!stage || !across) {
      return false;
    }
    const page = columnRef.current?.querySelector<HTMLElement>(`[data-page="${across.page + 1}"]`);
    if (page) {
      const box = page.getBoundingClientRect();
      stage.scrollLeft += box.left + box.width * across.fraction - across.x;
    }
    return true;
  }, [stageRef]);

  /** Puts the anchored place back at its height in the window. Never animated. */
  const applyAnchor = useCallback(() => {
    const stage = stageRef.current;
    const anchor = anchorRef.current;
    if (!stage || !anchor || topsRef.current.length < 2) {
      return;
    }
    stage.scrollTop = scrollForAnchor(topsRef.current, anchor) + columnTop();
    applyAcross();
    ownScrollRef.current = stage.scrollTop;
  }, [applyAcross, columnTop, stageRef]);

  const register = useCallback(
    (index: number, canvas: HTMLCanvasElement | null, layer: HTMLDivElement | null) => {
      if (canvas && layer) {
        canvasesRef.current.set(index, canvas);
        layersRef.current.set(index, layer);
        // A page has come into the document: it may be the next to draw.
        pump();
        return;
      }
      // The page has left the document: nothing may refer to its canvas or text again.
      if (jobRef.current?.index === index) {
        jobRef.current.job.cancel();
        jobRef.current = null;
      }
      release(index);
      canvasesRef.current.delete(index);
      layersRef.current.delete(index);
      // A page that could not be drawn is tried again when the reader comes
      // back to it: it used to stay "could not be drawn" for the whole
      // sitting, whatever had been wrong, until the zoom or finish changed.
      failedRef.current.forEach((failure) => {
        if (failure.startsWith(`${index}|`)) {
          failedRef.current.delete(failure);
        }
      });
    },
    [pump, release]
  );

  // The first page's size, before anything can be laid out.
  useEffect(() => {
    let wanted = true;
    void pdf
      .pageSize(1)
      .then((size) => {
        if (wanted) {
          sizesRef.current.set(0, size);
          setReference(size);
        }
      })
      .catch(() => {
        // A first page that cannot be read: pages are laid out as A4 and say so one by one.
        if (wanted) {
          setReference({ width: 595, height: 842 });
        }
      });
    return () => {
      wanted = false;
    };
  }, [pdf]);

  // The layout changed (a page took its real size, the zoom, the window): the
  // place is put back before the browser paints, in this same commit.
  useLayoutEffect(() => {
    const toneChanged = toneKeyRef.current !== toneKey;
    topsRef.current = tops;
    toneKeyRef.current = toneKey;
    if (tops.length < 2) {
      return;
    }
    if (!openedRef.current) {
      // Opening: the stored place, with the top of the window on it; or the
      // top of the page, a little below the top of the window (the book's
      // very start being the scroller's own start).
      openedRef.current = true;
      const { initialPlace } = callbacks.current;
      const pageTop = initialPlace.fraction === 0 && initialPlace.extra === 0;
      anchorRef.current = {
        place: { page: initialPlace.page - 1, fraction: initialPlace.fraction, extra: initialPlace.extra },
        offset: initialPlace.atLine
          ? (stageRef.current?.clientHeight ?? 0) / 3
          : !pageTop
            ? 0
            : initialPlace.page <= 1
              ? columnTop()
              : TOP_INSET
      };
      // A page asked for before this first layout (the book opened at a
      // highlight, or at a match of the library's search) is where it opens.
      // The stored place above used to be put over it: the reader found
      // itself where it had stopped reading, not where it had asked to go.
      const asked = askedBeforeOpenRef.current;
      askedBeforeOpenRef.current = null;
      if (asked) {
        anchorRef.current = anchorFor(asked.page, asked.fraction);
      }
    }
    // Text laid for a page's old size would sit off the stretched page until it is redrawn.
    drawnRef.current.forEach((record, index) => {
      if (record.key !== keyOf(index)) {
        clearText(index);
      }
    });
    if (toneChanged) {
      // A page of the old finish is not shown on the new one: blank, in the new page colour, until redrawn.
      [...drawnRef.current.keys()].forEach(release);
      bumpDrawn();
    }
    // A pinch or a window being dragged changes the scale sixty times a
    // second, and each change used to start every page in view drawing again
    // (57 drawings begun in a one-second pinch, none of them finished).
    const scaleKey = `${scale}|${limit}`;
    if (scaleKeyRef.current !== null && scaleKeyRef.current !== scaleKey) {
      holdDrawing();
    }
    scaleKeyRef.current = scaleKey;
    applyAnchor();
    read(false);
    callbacks.current.onScale(scale, reference ?? { width: 595, height: 842 });
  }, [applyAnchor, clearText, columnTop, holdDrawing, keyOf, limit, read, reference, release, scale, stageRef, toneKey, tops]);

  // Pages come into the document as they come near: draw what is new.
  useEffect(() => {
    pump();
  }, [near, pump]);

  // The real sizes of the pages near the window, asked for together and applied
  // together: one correction of the layout, not one a page.
  useEffect(() => {
    if (!reference) {
      return;
    }
    const unknown: number[] = [];
    for (let index = near.first; index <= near.last; index += 1) {
      if (!sizesRef.current.has(index) && !askedRef.current.has(index)) {
        askedRef.current.add(index);
        unknown.push(index);
      }
    }
    if (unknown.length === 0) {
      return;
    }
    void Promise.all(
      unknown.map((index) =>
        pdf.pageSize(index + 1).then(
          (size) => ({ index, size }),
          // A page whose size cannot be read keeps the first page's; drawing it will say what is wrong with it.
          () => ({ index, size: reference })
        )
      )
    ).then((found) => {
      let changed = false;
      found.forEach((entry) => {
        if (sizesRef.current.has(entry.index)) {
          return;
        }
        sizesRef.current.set(entry.index, entry.size);
        if (entry.size.width !== reference.width || entry.size.height !== reference.height) {
          changed = true;
        }
      });
      if (changed) {
        // The layout changes, and the place is put back, in one commit; drawing follows it.
        bumpSizes();
      } else {
        pump();
      }
    });
  }, [near, pdf, pump, reference]);

  // The reader's scrolling. Read at once, in the event: a position read a frame late is a wrong one.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const onScroll = () => {
      const own = ownScrollRef.current !== null && Math.abs(stage.scrollTop - ownScrollRef.current) < 1.5;
      if (!own) {
        ownScrollRef.current = null;
      }
      read(!own);
    };
    stage.addEventListener("scroll", onScroll, { passive: true });
    return () => stage.removeEventListener("scroll", onScroll);
  }, [read, stageRef]);

  // The window changed height without the pages changing size.
  useEffect(() => {
    read(false);
  }, [read, viewportRevision]);

  // The links of the pages in the document; let go of with the page.
  useEffect(() => {
    let stale = false;
    setLinks((held) => {
      let changed = false;
      const kept = new Map<number, PageLink[]>();
      held.forEach((value, index) => {
        if (index >= near.first && index <= near.last) {
          kept.set(index, value);
        } else {
          changed = true;
        }
      });
      return changed ? kept : held;
    });
    for (let index = near.first; index <= near.last; index += 1) {
      void pdf
        .links(index + 1)
        .then((found) => {
          if (stale || found.length === 0) {
            return;
          }
          setLinks((held) => (held.get(index) === found ? held : new Map(held).set(index, found)));
        })
        .catch(() => undefined);
    }
    return () => {
      stale = true;
    };
  }, [near, pdf]);
  const followLink = useCallback((link: PageLink) => callbacks.current.onLink(link), []);

  // What the search found on the pages in the document.
  const { searchQuery, activeHit } = props;
  useEffect(() => {
    if (!searchQuery) {
      setMarks((held) => (held.query === "" && held.pages.size === 0 ? held : { query: "", pages: new Map() }));
      return;
    }
    let stale = false;
    if (!measureContextRef.current) {
      measureContextRef.current = window.document.createElement("canvas").getContext("2d");
    }
    // A phrase may run over a page break, so each page is marked with its neighbours' text to hand.
    const textOf = (page: number) =>
      page >= 1 && page <= pageCount
        ? pdf.pageText(page).then(
            (text) => text.joined.text,
            () => null
          )
        : Promise.resolve(null);
    for (let index = near.first; index <= near.last; index += 1) {
      void Promise.all([pdf.pageText(index + 1), textOf(index), textOf(index + 2)])
        .then(([text, before, after]) => {
          if (stale) {
            return;
          }
          const context = measureContextRef.current;
          let face = "";
          const measure: MeasureText | undefined = context
            ? (piece, item) => {
                const family = text.fontFamilies[item.fontName ?? ""] ?? "sans-serif";
                if (family !== face) {
                  context.font = `16px ${family}`;
                  face = family;
                }
                return context.measureText(piece).width;
              }
            : undefined;
          const found = pageMarks(text, searchQuery, MARKS_PER_PAGE, before, after, measure);
          setMarks((held) => {
            const pages = held.query === searchQuery ? new Map(held.pages) : new Map<number, PageMarks>();
            pages.set(index, found);
            return { query: searchQuery, pages };
          });
        })
        .catch(() => undefined);
    }
    return () => {
      stale = true;
    };
  }, [near, pageCount, pdf, searchQuery]);

  // The result chosen: its page is gone to by the reader's view; here its
  // mark is brought to the reader's line once the page's marks are known.
  useEffect(() => {
    if (!activeHit || marks.query !== searchQuery) {
      return;
    }
    const key = `${activeHit.page}:${activeHit.nth}:${searchQuery}`;
    const rect = marks.pages.get(activeHit.page - 1)?.rects[activeHit.nth]?.[0];
    const stage = stageRef.current;
    if (shownHitRef.current === key || !rect || !stage) {
      return;
    }
    shownHitRef.current = key;
    // On the reader's line, a third of the way down: clear of the toolbar
    // above and the dock below, and the page the dock names is then the
    // result's own. (In the middle of the window, a result near the top of
    // its page left the line on the page before: "Page 399" for a result
    // listed under page 400.)
    anchorRef.current = {
      place: { page: activeHit.page - 1, fraction: rect.top + rect.height / 2, extra: 0 },
      offset: stage.clientHeight / 3
    };
    acrossRef.current = null;
    applyAnchor();
    read(false);
  }, [activeHit, applyAnchor, marks, read, searchQuery, stageRef]);

  useImperativeHandle(
    handle,
    () => ({
      goTo(page, fraction = 0) {
        const stage = stageRef.current;
        if (!stage) {
          return;
        }
        if (!openedRef.current) {
          // Not laid out yet: kept for the first layout, which would undo it.
          askedBeforeOpenRef.current = { page, fraction };
          return;
        }
        anchorRef.current = anchorFor(page, fraction);
        acrossRef.current = null;
        shownHitRef.current = null;
        applyAnchor();
        read(false);
      },
      sync() {
        ownScrollRef.current = null;
        read(true);
      },
      holdAt(about) {
        const stage = stageRef.current;
        if (!stage || topsRef.current.length < 2) {
          return;
        }
        const box = stage.getBoundingClientRect();
        const offset = about ? about.y - box.top : stage.clientHeight / 3;
        const place = placeAt(topsRef.current, viewTop() + offset);
        anchorRef.current = { place, offset };
        acrossRef.current = null;
        // Across the page too: under the pointer, or else the middle of the
        // window. (With no pointer nothing was held across, and a page going
        // from a fit to 100% beside a wider one was left with its right edge
        // off the window.)
        const x = about ? about.x : box.left + stage.clientWidth / 2;
        const page = columnRef.current?.querySelector<HTMLElement>(`[data-page="${place.page + 1}"]`);
        const pageBoxNow = page?.getBoundingClientRect();
        if (pageBoxNow && pageBoxNow.width > 0) {
          acrossRef.current = {
            page: place.page,
            fraction: Math.min(1, Math.max(0, (x - pageBoxNow.left) / pageBoxNow.width)),
            x
          };
        }
      },
      line() {
        const stage = stageRef.current;
        if (!stage || topsRef.current.length < 2) {
          return null;
        }
        const place = placeAt(topsRef.current, viewTop() + stage.clientHeight / 3);
        return { page: place.page + 1, fraction: place.fraction };
      }
    }),
    [applyAnchor, columnTop, pageCount, read, stageRef, viewTop]
  );

  // Closing: nothing drawing, and the place kept to the last scroll.
  useEffect(() => {
    const textJobs = textJobsRef.current;
    return () => {
      jobRef.current?.job.cancel();
      jobRef.current = null;
      textJobs.forEach((job) => job.cancel());
      textJobs.clear();
      if (settleRef.current !== null) {
        window.clearTimeout(settleRef.current);
      }
      if (placeTimerRef.current !== null) {
        window.clearTimeout(placeTimerRef.current);
        placeTimerRef.current = null;
        const place = topPlaceRef.current;
        if (place) {
          callbacks.current.onPlace({ ...place, page: place.page + 1, current: currentRef.current + 1 });
        }
      }
    };
  }, []);

  // How wide the column is: the room, or the widest page met so far at this
  // scale. It only grows: it used to be the widest page in the document just
  // then, and every page is centred in it, so at a chosen zoom the page being
  // read moved sideways (315px, measured) each time a landscape page came
  // near or left. When it does grow, the scroll is moved by the same half.
  const roomWidth = measureRoom().availableWidth;
  const widthKey = `${scale}|${limit}|${roomWidth}`;
  let widest = roomWidth + 2;
  for (let index = near.first; index <= Math.min(near.last, pageCount - 1); index += 1) {
    widest = Math.max(widest, boxOf(index).width);
  }
  widest = Math.max(widest, boxOf(0).width);
  if (widestRef.current.key === widthKey) {
    widest = Math.max(widest, widestRef.current.width);
  }
  useLayoutEffect(() => {
    const held = widestRef.current;
    const stage = stageRef.current;
    // A point already held across the page is put back where it was; with
    // none held, every page has moved right by half of what was added.
    if (stage && held.key === widthKey && widest > held.width && !applyAcross()) {
      stage.scrollLeft += (widest - held.width) / 2;
    }
    widestRef.current = { key: widthKey, width: widest };
  }, [applyAcross, stageRef, widest, widthKey]);

  if (!reference) {
    return null;
  }

  const pages = [];
  for (let index = near.first; index <= Math.min(near.last, pageCount - 1); index += 1) {
    const box = boxOf(index);
    const record = drawnRef.current.get(index);
    pages.push(
      <ScrollPage
        key={index}
        index={index}
        pageCount={pageCount}
        top={tops[index]}
        left={Math.max(0, Math.floor((widest - box.width) / 2))}
        width={box.width}
        height={box.height}
        paper={tone ? toneCss(tone.paper) : undefined}
        dark={tone?.dark ?? false}
        drawn={record !== undefined}
        failed={failedRef.current.has(`${index}|${scaleOf(index)}|${toneKey}`)}
        marks={marks.query === searchQuery ? marks.pages.get(index)?.rects : undefined}
        currentMark={marks.query === searchQuery ? currentMark(activeHit, index + 1, marks.pages.get(index)) : null}
        links={links.get(index)}
        highlights={props.highlights?.get(index + 1)}
        onLink={followLink}
        register={register}
      />
    );
  }

  return (
    <div
      ref={columnRef}
      className="pdf-scroll-column"
      style={{ height: columnHeight(tops, PAGE_GAP), width: widest }}
      data-pages={pageCount}
    >
      {pages}
    </div>
  );
});
PdfScrollPages.displayName = "PdfScrollPages";
