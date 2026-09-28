/**
 * Page-image sources for the page reader.
 *
 * PDFs and comics are the same reading model — a fixed sequence of page images
 * with prev/next and a page list — so they share one view and differ only in
 * where a page's pixels come from.
 */

import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { invoke } from "@tauri-apps/api/core";
import { bookService } from "../services/bookService";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type RenderOptions = {
  fitWidth: boolean;
  zoom: number;
  availableWidth: number;
};

export type PageSource = {
  pageCount: number;
  /** Draws a 1-based page into the canvas; resolves with the scale actually used. */
  render(page: number, canvas: HTMLCanvasElement, options: RenderOptions): Promise<number>;
  /** Aborts an in-flight render so a fast page-turn does not queue up work. */
  cancelPending(): void;
  destroy(): void;
};

const MAX_FIT_SCALE = 2.4;
const MIN_SCALE = 0.5;

const scaleFor = (naturalWidth: number, options: RenderOptions) =>
  options.fitWidth
    ? Math.min(MAX_FIT_SCALE, Math.max(MIN_SCALE, options.availableWidth / naturalWidth))
    : options.zoom;

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
const prepareCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Page rendering is unavailable in this window.");
  }
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  canvas.style.width = `${Math.floor(width)}px`;
  canvas.style.height = `${Math.floor(height)}px`;
  return { context, pixelRatio };
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

  return {
    pageCount: document.numPages,
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
        const scale = scaleFor(baseViewport.width, options);
        const viewport = page.getViewport({ scale });
        const { context, pixelRatio } = prepareCanvas(canvas, viewport.width, viewport.height);

        task = page.render({
          canvasContext: context,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0]
        });
        renderTask = task;
        await task.promise;
        return scale;
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
    },
    destroy() {
      generation += 1;
      renderTask?.cancel();
      // Teardown runs as the reader closes; a worker that is already gone
      // must not surface as an unhandled rejection.
      document.destroy().catch(() => undefined);
      loadingTask.destroy().catch(() => undefined);
    }
  };
};

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
    async render(pageNumber, canvas, options) {
      const token = ++generation;
      const image = await loadPage(pageNumber);
      if (disposed || token !== generation) {
        throw superseded();
      }
      const scale = scaleFor(image.naturalWidth || 1, options);
      const width = (image.naturalWidth || 1) * scale;
      const height = (image.naturalHeight || 1) * scale;
      const { context, pixelRatio } = prepareCanvas(canvas, width, height);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      context.setTransform(1, 0, 0, 1, 0, 0);

      // Warm the next page so a forward turn feels immediate.
      if (pageNumber < info.pageCount) {
        void loadPage(pageNumber + 1).catch(() => {
          // Prefetch is best-effort.
        });
      }
      return scale;
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
