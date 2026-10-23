/**
 * The book's pictures, as the picture viewer needs them (readers/ImageViewer.tsx):
 * which ones open it, and what it shows. The address is the one the page
 * already has (epub.js's own copy of the file), so nothing is read again.
 */

import { isBigPicture, isViewable } from "./imageZoom";

export type PagePicture = {
  src: string;
  alt: string;
  /** "title" or "art" when it is an ink picture blended into the page (see inkImages), else null. */
  ink: string | null;
  inkOff: boolean;
};

type PictureElement = HTMLImageElement | SVGImageElement;

const sourceOf = (element: PictureElement) =>
  element.tagName.toLowerCase() === "img"
    ? (element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src || ""
    : (element as SVGImageElement).href?.baseVal || element.getAttribute("xlink:href") || element.getAttribute("href") || "";

const pictures = (doc: Document) => Array.from(doc.querySelectorAll<PictureElement>("img, image"));

/**
 * The picture a click landed on, if it is one to look at: not an ornament or
 * a drop cap (under 48 px either way), and not a picture that is a link,
 * which goes where it leads.
 */
export const pictureAt = (target: Element | null): PagePicture | null => {
  const element = target?.closest?.("img, image") as PictureElement | null;
  if (!element || element.closest("a[href]")) {
    return null;
  }
  const box = element.getBoundingClientRect();
  const src = sourceOf(element);
  if (!src || !isViewable(box.width, box.height)) {
    return null;
  }
  return {
    src,
    alt: (element.getAttribute("alt") || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim(),
    ink: element.dataset.leafletInk || null,
    inkOff: element.dataset.leafletInkOff === "1"
  };
};

/**
 * Marks the pictures that open the viewer (`data-leaflet-zoom`), so the
 * pointer can say so, and those the page shows much smaller than they are
 * (`data-leaflet-zoom-big`: a map wider than the column), which carry the
 * magnifier chip (`placeZoomChips`). A picture still loading is looked at
 * again when it has. `onViewable` is told of each picture that opens the
 * viewer, every time (it binds the pinch: readers/pictureHandover.ts).
 */
export const markViewable = (doc: Document, onViewable?: (element: HTMLImageElement) => void) => {
  pictures(doc).forEach((element) => {
    if (element.closest("a[href]")) {
      return;
    }
    const box = element.getBoundingClientRect();
    const img = element.tagName.toLowerCase() === "img" ? (element as HTMLImageElement) : null;
    if (!element.dataset.leafletZoom && isViewable(box.width, box.height)) {
      element.dataset.leafletZoom = "1";
    }
    if (element.dataset.leafletZoom) {
      if (img) {
        const big = img.naturalWidth > 0 && isBigPicture(box, { width: img.naturalWidth, height: img.naturalHeight });
        if (big) {
          img.dataset.leafletZoomBig = "1";
        } else {
          delete img.dataset.leafletZoomBig;
        }
        onViewable?.(img);
      }
    } else if (img && !img.complete && !element.dataset.leafletZoomWait) {
      element.dataset.leafletZoomWait = "1";
      element.addEventListener("load", () => markViewable(doc, onViewable), { once: true });
    }
  });
  placeZoomChips(doc);
};

/** The chip's size, and its room from the picture's corner. */
const CHIP_PX = 26;
const CHIP_INSET = 6;
const chips = new WeakMap<Element, HTMLElement>();
const watched = new WeakSet<Document>();
const MAGNIFIER =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

/**
 * A small magnifier at the bottom right corner of each big picture: says,
 * without words, that it opens larger. It lies beside the chapter's frame,
 * in epub.js's box for it (not in the book's own document, whose text and
 * places it would disturb), over the picture, and lets touches through to
 * it. Placed again whenever the frame or its text changes size.
 */
export const placeZoomChips = (doc: Document) => {
  const frame = doc.defaultView?.frameElement as HTMLElement | null | undefined;
  const holder = frame?.parentElement;
  if (!frame || !holder) {
    return;
  }
  const at = { x: frame.offsetLeft, y: frame.offsetTop };
  pictures(doc).forEach((element) => {
    let chip = chips.get(element);
    const big = element.dataset.leafletZoomBig === "1";
    const box = big ? element.getBoundingClientRect() : null;
    if (!box || !(box.width > 0 && box.height > 0)) {
      if (chip) chip.hidden = true;
      return;
    }
    if (!chip || chip.parentElement !== holder) {
      chip = holder.ownerDocument.createElement("span");
      chip.className = "leaflet-zoom-chip";
      chip.setAttribute("aria-hidden", "true");
      chip.innerHTML = MAGNIFIER;
      holder.appendChild(chip);
      chips.set(element, chip);
    }
    chip.hidden = false;
    chip.style.transform = `translate(${Math.round(at.x + box.right - CHIP_PX - CHIP_INSET)}px, ${Math.round(at.y + box.bottom - CHIP_PX - CHIP_INSET)}px)`;
  });
  if (!watched.has(doc) && typeof ResizeObserver !== "undefined") {
    watched.add(doc);
    let pending = 0;
    const again = () => {
      if (pending) return;
      pending = window.setTimeout(() => {
        pending = 0;
        if (doc.defaultView) placeZoomChips(doc);
      }, 120);
    };
    const outer = new ResizeObserver(again);
    outer.observe(frame);
    const View = (doc.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null)?.ResizeObserver;
    const inner = View && doc.body ? new View(again) : null;
    if (inner && doc.body) {
      inner.observe(doc.body);
    }
    // The chapter going (epub.js lets its frame go): so do the watchers.
    doc.defaultView?.addEventListener(
      "pagehide",
      () => {
        outer.disconnect();
        inner?.disconnect();
        window.clearTimeout(pending);
      },
      { once: true }
    );
  }
};

/**
 * Shows an ink picture as drawn in the page, or blends it again: every copy
 * of it on the pages given (a chapter may have come or gone since the viewer
 * opened, so it is found by its address, not held).
 */
export const setInkOff = (docs: Document[], src: string, off: boolean) => {
  docs.forEach((doc) => {
    pictures(doc).forEach((element) => {
      if (element.dataset.leafletInk && sourceOf(element) === src) {
        element.dataset.leafletInkOff = off ? "1" : "";
      }
    });
  });
};
