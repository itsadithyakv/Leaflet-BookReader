/**
 * Page-image sources for the page reader.
 *
 * PDFs and comics are the same reading model — a fixed sequence of page images
 * with prev/next and a page list — so they share one view and differ only in
 * where a page's pixels come from.
 */

import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type PageViewport,
  type RenderTask
} from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { invoke } from "@tauri-apps/api/core";
import { bookService } from "../services/bookService";
import {
  clearWhiteGround,
  drawnRect,
  looksLikePhoto,
  tonePixels,
  type PageTone,
  type PixelRect
} from "./pageTone";
import { PDF_ACTUAL_SCALE, canvasPixelRatio, scaleFor, type FitOptions } from "./pageZoom";
import { spreadOf } from "./pageSpread";
import { resolveOutline, type OutlineEntry, type OutlineNode } from "./pdfOutline";
import { joinTextItems, mendDropCaps, type JoinedText, type TextItem } from "./pdfText";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type RenderOptions = FitOptions & {
  /** The page finish to tone a PDF page to (readers/pageTone.ts); null shows it as drawn. Comics are never toned. */
  tone?: PageTone | null;
  /**
   * Two pages side by side (readers/pageSpread.ts), the first on the right
   * when read right to left; null or absent for one page. Comics only.
   */
  spread?: { rtl: boolean } | null;
};

/**
 * What a render drew: the scale it used and its size at scale 1, and the
 * pages it shows when that is not only the one asked for (a comic's facing
 * pages, in reading order).
 */
export type RenderedPage = { scale: number; width: number; height: number; pages?: number[] };

/** A PDF page's text, read once and kept for searching, marking and selecting. */
export type PdfPageText = {
  /** The text as one string, with where each run of it sits (readers/pdfText.ts). */
  joined: JoinedText;
  /** The page as shown at scale 1: its size, and page space to that. */
  width: number;
  height: number;
  transform: number[];
  /** The kind of face (serif, sans-serif, monospace) of each font the runs name. */
  fontFamilies: Record<string, string>;
};

/** What only a PDF has: its own table of contents, and text. */
export type PdfExtras = {
  /**
   * The document's outline as rows with page numbers; empty when it has none.
   * `stillWanted` is asked as it goes; null when it said no.
   */
  outline(stillWanted: () => boolean): Promise<OutlineEntry[] | null>;
  /** A page's text. Kept for a bounded number of pages. */
  pageText(page: number): Promise<PdfPageText>;
  /**
   * Lays the page's text, transparent, over its canvas so it can be selected
   * and copied. `scale` is the one the page was drawn at. Superseded by the
   * next call and by cancelPending(), as a render is.
   */
  layText(page: number, container: HTMLElement, scale: number): Promise<void>;
  /**
   * For continuous scrolling (readers/pageScroll.ts), where several pages are
   * in the document at once, each with a canvas of its own. These three take
   * no part in render()'s single slot: each job is cancelled by itself.
   */
  /** A page's size as shown at scale 1. Asks pdf.js for the page, not for its drawing. */
  pageSize(page: number): Promise<{ width: number; height: number }>;
  /** Draws a page at a scale into its own canvas, which is changed only when the page is finished. */
  draw(page: number, canvas: HTMLCanvasElement, options: DrawOptions): PageJob<RenderedPage>;
  /** layText for a page's own container. */
  layTextOn(page: number, container: HTMLElement, scale: number): PageJob<void>;
};

export type DrawOptions = {
  scale: number;
  tone?: PageTone | null;
  /** The most device pixels the canvas may hold; fewer than a paged page's, as several are held at once. */
  maxPixels?: number;
};

/** Work on one page that can be given up: `promise` then rejects as a cancelled render does. */
export type PageJob<Result> = { promise: Promise<Result>; cancel(): void };

export type PageSource = {
  pageCount: number;
  /** The scale that shows a page at its actual size (readers/pageZoom.ts). */
  actualScale: number;
  /** Draws a 1-based page into the canvas; resolves with the scale actually used. */
  render(page: number, canvas: HTMLCanvasElement, options: RenderOptions): Promise<RenderedPage>;
  /** Aborts an in-flight render so a fast page-turn does not queue up work. */
  cancelPending(): void;
  destroy(): void;
  pdf?: PdfExtras;
};

/**
 * The name pdf.js gives a cancelled render. A render superseded by a newer one
 * before it reached the canvas rejects with the same name, so the view needs
 * only one check to tell "the reader moved on" from a real failure.
 */
const CANCELLED = "RenderingCancelledException";

const superseded = () => {
  const error = new Error("Rendering superseded by a newer page.");
  error.name = CANCELLED;
  return error;
};

export const isRenderCancelled = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === CANCELLED;

// Built-in CMaps (CJK text) and the standard 14 fonts are served at pdfjs/,
// straight from pdfjs-dist by a plugin in vite.config.js, so they always
// match the installed version.
// Absolute, because the worker resolves a relative URL against its own
// location rather than the page's.
const pdfAssetUrl = (path: string) => new URL(`pdfjs/${path}/`, document.baseURI).href;

/** Sizes the canvas for the device pixel ratio and returns its 2D context. */
const prepareCanvas = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  readBack = false,
  maxPixels?: number
) => {
  const pixelRatio = canvasPixelRatio(width, height, window.devicePixelRatio || 1, maxPixels);
  // A page that is toned is read back and written again: kept in memory
  // rather than on the graphics card, which makes that a copy, not a round trip.
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: readBack });
  if (!context) {
    throw new Error("Page rendering is unavailable in this window.");
  }
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  canvas.style.width = `${Math.floor(width)}px`;
  canvas.style.height = `${Math.floor(height)}px`;
  return { context, pixelRatio };
};

/**
 * Notes where pictures are drawn on a canvas while pdf.js paints a page, by
 * standing in for the context's `drawImage`. That is every place pdf.js puts
 * an image (and a transparency group, which arrives as one picture), at no
 * cost: asking pdf.js for the page's list of operations instead would have it
 * parse the page, and decode every scan, a second time.
 */
const watchPictures = (context: CanvasRenderingContext2D) => {
  const drawn: PixelRect[] = [];
  const native = context.drawImage;
  const own = context as unknown as { drawImage?: unknown };
  own.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
    try {
      const image = args[0] as { width?: number; height?: number };
      const numbers = args.slice(1) as number[];
      // drawImage(image, dx, dy), (image, dx, dy, dw, dh) or (image, sx, sy, sw, sh, dx, dy, dw, dh).
      const [x, y, width, height] =
        numbers.length >= 8
          ? numbers.slice(4, 8)
          : numbers.length >= 4
            ? numbers.slice(0, 4)
            : [numbers[0], numbers[1], Number(image?.width) || 0, Number(image?.height) || 0];
      const rect = drawnRect(context.getTransform(), x, y, width, height, context.canvas.width, context.canvas.height);
      if (rect) {
        drawn.push(rect);
      }
    } catch {
      // Not knowing where one picture went only means it is toned with the page.
    }
    return (native as (...all: unknown[]) => void).apply(context, args);
  };
  return {
    drawn,
    stop: () => {
      delete own.drawImage;
    }
  };
};

/**
 * Tones a finished page to the reader's finish. On a dark finish the pictures
 * that are photographs are put back as they were drawn, less the white ground
 * of one drawn on white (an illuminated initial, an illustration), which
 * would be a bright box on the dark page.
 */
const tonePage = (context: CanvasRenderingContext2D, tone: PageTone, pictures: PixelRect[]) => {
  const { width, height } = context.canvas;
  const page = context.getImageData(0, 0, width, height);
  const photos = tone.dark
    ? pictures
        .filter((rect) => looksLikePhoto(page.data, width, rect))
        .map((rect) => ({ rect, pixels: context.getImageData(rect.x, rect.y, rect.width, rect.height) }))
    : [];
  tonePixels(page.data, tone);
  context.putImageData(page, 0, 0);
  photos.forEach(({ rect, pixels }) => {
    clearWhiteGround(pixels.data, pixels.width, pixels.height, tone.paper);
    context.putImageData(pixels, rect.x, rect.y);
  });
};

export const createPdfPageSource = async (bookId: string): Promise<PageSource> => {
  const buffer = await bookService.readBookBytes(bookId);
  if (buffer.byteLength === 0) {
    throw new Error("The PDF file is empty or unavailable.");
  }
  const loadingTask = getDocument({
    // A view over the IPC buffer, not a copy. pdf.js transfers it to its worker,
    // so nothing else may hold on to `buffer` after this.
    data: new Uint8Array(buffer),
    cMapUrl: pdfAssetUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: pdfAssetUrl("standard_fonts"),
    // The app CSP has no 'unsafe-eval'. Saying so up front skips pdf.js's
    // `new Function` probe, which the CSP would block and report.
    isEvalSupported: false
  });
  const document: PDFDocumentProxy = await loadingTask.promise;
  let renderTask: RenderTask | null = null;
  // Bumped by every render and cancel. A render that finds it moved on after
  // an await stops there, so a page turn during getPage() can never start a
  // second render on the canvas the newer turn is about to use.
  let generation = 0;

  type KeptText = PdfPageText & { content: TextContent; viewport: PageViewport };
  // Text is read a page at a time, when a search or the page in view asks for
  // it. Kept in the order last used and bounded, so searching a long document
  // does not hold all of it.
  const texts = new Map<number, Promise<KeptText>>();
  const readText = (pageNumber: number) => {
    const kept = texts.get(pageNumber);
    if (kept) {
      texts.delete(pageNumber);
      texts.set(pageNumber, kept);
      return kept;
    }
    const reading = (async (): Promise<KeptText> => {
      const page = await document.getPage(pageNumber);
      try {
        const read = await page.getTextContent();
        // A large initial belongs to the word beside it, for the search and
        // for the text layer alike (readers/pdfText.ts).
        const items = mendDropCaps(read.items as Array<Partial<TextItem>>);
        const content = { ...read, items } as TextContent;
        const viewport = page.getViewport({ scale: 1 });
        return {
          content,
          viewport,
          joined: joinTextItems(items),
          width: viewport.width,
          height: viewport.height,
          transform: viewport.transform,
          fontFamilies: Object.fromEntries(
            Object.entries(content.styles ?? {}).map(([name, style]) => [name, style.fontFamily])
          )
        };
      } finally {
        page.cleanup();
      }
    })();
    texts.set(pageNumber, reading);
    reading.catch(() => {
      // A page that failed to read is asked for again next time.
      if (texts.get(pageNumber) === reading) {
        texts.delete(pageNumber);
      }
    });
    while (texts.size > TEXT_CACHE_LIMIT) {
      const oldest = texts.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      texts.delete(oldest);
    }
    return reading;
  };

  let textLayer: TextLayer | null = null;
  // The text layer's own token, for the same reason the render has one.
  let textGeneration = 0;
  const cancelText = () => {
    textGeneration += 1;
    textLayer?.cancel();
    textLayer = null;
  };

  let destroyed = false;
  const sizes = new Map<number, { width: number; height: number }>();

  const draw = (pageNumber: number, canvas: HTMLCanvasElement, options: DrawOptions): PageJob<RenderedPage> => {
    let cancelled = false;
    let task: RenderTask | null = null;
    const gone = () => cancelled || destroyed;
    const promise = (async (): Promise<RenderedPage> => {
      const page = await document.getPage(pageNumber);
      // As in render(): drawn out of sight, toned, and shown when finished.
      const sheet = window.document.createElement("canvas");
      try {
        if (gone()) {
          throw superseded();
        }
        const base = page.getViewport({ scale: 1 });
        sizes.set(pageNumber, { width: base.width, height: base.height });
        const viewport = page.getViewport({ scale: options.scale });
        const tone = options.tone ?? null;
        const { context, pixelRatio } = prepareCanvas(
          sheet,
          viewport.width,
          viewport.height,
          tone !== null,
          options.maxPixels
        );
        const pictures = tone?.dark ? watchPictures(context) : null;
        task = page.render({
          canvasContext: context,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0]
        });
        try {
          await task.promise;
        } finally {
          pictures?.stop();
        }
        if (gone()) {
          throw superseded();
        }
        if (tone) {
          try {
            tonePage(context, tone, pictures?.drawn ?? []);
          } catch {
            // A page too large to read back is shown as drawn rather than not at all.
          }
        }
        const shown = prepareCanvas(canvas, viewport.width, viewport.height, false, options.maxPixels);
        shown.context.drawImage(sheet, 0, 0);
        return { scale: options.scale, width: base.width, height: base.height };
      } finally {
        // The sheet's memory goes now, finished or given up, not at the next collection.
        sheet.width = 0;
        sheet.height = 0;
        page.cleanup();
      }
    })();
    return {
      promise,
      cancel() {
        cancelled = true;
        task?.cancel();
      }
    };
  };

  const layTextOn = (pageNumber: number, container: HTMLElement, scale: number): PageJob<void> => {
    let cancelled = false;
    let layer: TextLayer | null = null;
    const promise = (async () => {
      container.replaceChildren();
      const text = await readText(pageNumber);
      if (cancelled || destroyed) {
        throw superseded();
      }
      container.style.setProperty("--scale-factor", String(scale));
      layer = new TextLayer({
        textContentSource: text.content,
        container,
        viewport: text.viewport.clone({ scale })
      });
      try {
        await layer.render();
      } catch (failure) {
        throw cancelled ? superseded() : failure;
      }
      if (cancelled || destroyed) {
        container.replaceChildren();
        throw superseded();
      }
      // A selection carried on into the next page copies with a line break between the two.
      const lineBreak = window.document.createElement("br");
      lineBreak.setAttribute("role", "presentation");
      container.append(lineBreak);
      const end = window.document.createElement("div");
      end.className = "endOfContent";
      container.append(end);
    })();
    return {
      promise,
      cancel() {
        cancelled = true;
        layer?.cancel();
      }
    };
  };

  const pdf: PdfExtras = {
    async pageSize(pageNumber) {
      const known = sizes.get(pageNumber);
      if (known) {
        return known;
      }
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const size = { width: viewport.width, height: viewport.height };
      sizes.set(pageNumber, size);
      return size;
    },
    draw,
    layTextOn,
    async outline(stillWanted) {
      const nodes = (await document.getOutline()) as OutlineNode[] | null;
      return resolveOutline(
        nodes,
        {
          getDestination: (name) => document.getDestination(name),
          getPageIndex: (ref) => document.getPageIndex(ref)
        },
        document.numPages,
        stillWanted
      );
    },
    pageText: readText,
    async layText(pageNumber, container, scale) {
      cancelText();
      const token = textGeneration;
      container.replaceChildren();
      const text = await readText(pageNumber);
      if (token !== textGeneration) {
        throw superseded();
      }
      // pdf.js sizes and places the layer in multiples of this.
      container.style.setProperty("--scale-factor", String(scale));
      const layer = new TextLayer({
        textContentSource: text.content,
        container,
        viewport: text.viewport.clone({ scale })
      });
      textLayer = layer;
      try {
        await layer.render();
      } catch (failure) {
        if (token !== textGeneration) {
          throw superseded();
        }
        throw failure;
      } finally {
        if (textLayer === layer) {
          textLayer = null;
        }
      }
      if (token !== textGeneration) {
        throw superseded();
      }
      // What a selection is dragged onto past the last word (pdfTextLayer.ts).
      const end = window.document.createElement("div");
      end.className = "endOfContent";
      container.append(end);
    }
  };

  return {
    pageCount: document.numPages,
    actualScale: PDF_ACTUAL_SCALE,
    pdf,
    async render(pageNumber, canvas, options) {
      const token = ++generation;
      const previous = renderTask;
      if (previous) {
        previous.cancel();
        // pdf.js refuses a second render() on a canvas the first still holds.
        await previous.promise.catch(() => undefined);
      }
      if (token !== generation) {
        throw superseded();
      }

      const page = await document.getPage(pageNumber);
      let task: RenderTask | null = null;
      try {
        if (token !== generation) {
          throw superseded();
        }
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = scaleFor(baseViewport, options, PDF_ACTUAL_SCALE);
        const viewport = page.getViewport({ scale });
        const tone = options.tone ?? null;
        // Drawn out of sight and shown when finished. pdf.js paints a page
        // piece by piece: on the canvas in view that was a flash of white
        // before a dark page, and a blank between one page and the next.
        const sheet = window.document.createElement("canvas");
        const { context, pixelRatio } = prepareCanvas(sheet, viewport.width, viewport.height, tone !== null);
        const pictures = tone?.dark ? watchPictures(context) : null;

        task = page.render({
          canvasContext: context,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0]
        });
        renderTask = task;
        try {
          await task.promise;
        } finally {
          pictures?.stop();
        }
        if (token !== generation) {
          throw superseded();
        }
        if (tone) {
          try {
            tonePage(context, tone, pictures?.drawn ?? []);
          } catch {
            // A page too large to read back is shown as drawn rather than not at all.
          }
        }
        const shown = prepareCanvas(canvas, viewport.width, viewport.height);
        shown.context.drawImage(sheet, 0, 0);
        // Let go of the sheet's memory now rather than at the next collection.
        sheet.width = 0;
        sheet.height = 0;
        return { scale, width: baseViewport.width, height: baseViewport.height };
      } finally {
        // Only the render that owns the slot may clear it; a newer one may
        // already have replaced it.
        if (task && renderTask === task) {
          renderTask = null;
        }
        // Drops the page's operator list and decoded images. pdf.js keeps them
        // per page otherwise, so paging through a large scanned PDF grows
        // without bound; a page still being drawn defers this until it is done.
        page.cleanup();
      }
    },
    cancelPending() {
      generation += 1;
      // The slot is left for the render's own finally to clear, so the next
      // render still waits for this one to let go of the canvas.
      renderTask?.cancel();
      cancelText();
    },
    destroy() {
      generation += 1;
      destroyed = true;
      renderTask?.cancel();
      cancelText();
      texts.clear();
      // pdf.js keeps a canvas in the document for measuring the text layer's
      // runs; with no layer being laid, this lets go of it.
      TextLayer.cleanup();
      // Teardown runs as the reader closes; a worker that is already gone
      // must not surface as an unhandled rejection.
      document.destroy().catch(() => undefined);
      loadingTask.destroy().catch(() => undefined);
    }
  };
};

/** How many pages' text is kept at once. */
const TEXT_CACHE_LIMIT = 80;

/** Keeps a few decoded pages so paging back and forth does not re-decode. */
const PAGE_CACHE_LIMIT = 6;

export const createComicPageSource = async (bookId: string): Promise<PageSource> => {
  const info = await invoke<{ pageCount: number }>("comic_open", { bookId });
  if (info.pageCount === 0) {
    // No source is handed out, so nothing else would release the index.
    void invoke("comic_close", { bookId }).catch(() => undefined);
    throw new Error("This comic contains no pages.");
  }

  const cache = new Map<number, HTMLImageElement>();
  // Which pages are wider than tall, for those whose pictures have been read:
  // a double page drawn as one picture is shown alone. Kept for the whole
  // comic; it is one flag a page.
  const wide = new Map<number, boolean>();
  let disposed = false;
  // Same role as in the PDF source: a page that finishes decoding after the
  // reader has turned again must not be drawn under the newer page's label.
  let generation = 0;

  const loadPage = async (pageNumber: number) => {
    const cached = cache.get(pageNumber);
    if (cached) {
      return cached;
    }
    const dataUrl = await invoke<string>("comic_page", { bookId, index: pageNumber - 1 });
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Page ${pageNumber} could not be decoded.`));
      image.src = dataUrl;
    });
    cache.set(pageNumber, image);
    wide.set(pageNumber, image.naturalWidth > image.naturalHeight);
    // Evict in insertion order; the reader moves linearly so the oldest entry is
    // the one furthest from where the reader is now.
    while (cache.size > PAGE_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      cache.delete(oldest);
    }
    return image;
  };

  return {
    pageCount: info.pageCount,
    // A comic's actual size is one screen pixel for each pixel of its image.
    actualScale: 1,
    async render(pageNumber, canvas, options) {
      const token = ++generation;
      // Which pages are on show: the one asked for, or it and the page it
      // faces. Working that out reads the pictures it depends on, no others.
      let pages = [pageNumber];
      if (options.spread) {
        for (;;) {
          const answer = spreadOf(pageNumber, info.pageCount, (page) => wide.get(page));
          if ("pages" in answer) {
            pages = answer.pages;
            break;
          }
          await loadPage(answer.need);
          if (disposed || token !== generation) {
            throw superseded();
          }
        }
      }
      const images = await Promise.all(pages.map((page) => loadPage(page)));
      if (disposed || token !== generation) {
        throw superseded();
      }
      // Facing pages are drawn to one height, edge to edge, as in the book.
      const tallest = Math.max(...images.map((image) => image.naturalHeight || 1));
      const widths = images.map((image) => ((image.naturalWidth || 1) * tallest) / (image.naturalHeight || 1));
      const natural = { width: widths.reduce((sum, each) => sum + each, 0), height: tallest };
      const scale = scaleFor(natural, options, 1);
      const width = natural.width * scale;
      const height = natural.height * scale;
      const { context, pixelRatio } = prepareCanvas(canvas, width, height);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      // Left to right on the canvas; read right to left, the first page is on the right.
      const order = images.map((_, index) => index);
      if (options.spread?.rtl) {
        order.reverse();
      }
      let x = 0;
      for (const index of order) {
        context.drawImage(images[index], x, 0, widths[index] * scale, height);
        x += widths[index] * scale;
      }
      context.setTransform(1, 0, 0, 1, 0, 0);

      // Warm what a forward turn shows so it feels immediate.
      const ahead = Math.max(...pages) + 1;
      for (let page = ahead; page < ahead + pages.length && page <= info.pageCount; page += 1) {
        void loadPage(page).catch(() => {
          // Prefetch is best-effort.
        });
      }
      return { scale, ...natural, pages };
    },
    cancelPending() {
      // Decoding itself cannot be cancelled; this only stops its result from
      // being drawn.
      generation += 1;
    },
    destroy() {
      disposed = true;
      generation += 1;
      cache.clear();
      // The backend keeps each open comic's page index; release this reader's
      // hold on it. Best-effort: the app may be closing.
      void invoke("comic_close", { bookId }).catch(() => undefined);
    }
  };
};
