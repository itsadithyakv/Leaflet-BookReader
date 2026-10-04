/**
 * The book's pictures, as the picture viewer needs them (readers/ImageViewer.tsx):
 * which ones open it, and what it shows. The address is the one the page
 * already has (epub.js's own copy of the file), so nothing is read again.
 */

import { isViewable } from "./imageZoom";

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
 * pointer can say so. A picture still loading is looked at again when it has.
 */
export const markViewable = (doc: Document) => {
  pictures(doc).forEach((element) => {
    if (element.dataset.leafletZoom || element.closest("a[href]")) {
      return;
    }
    const box = element.getBoundingClientRect();
    if (isViewable(box.width, box.height)) {
      element.dataset.leafletZoom = "1";
    } else if (element.tagName.toLowerCase() === "img" && !(element as HTMLImageElement).complete && !element.dataset.leafletZoomWait) {
      element.dataset.leafletZoomWait = "1";
      element.addEventListener("load", () => markViewable(doc), { once: true });
    }
  });
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
