import { readerShape, readLayoutFor, spreadFor } from "../touchLayout";
import { isTouchInput } from "../../platform/device";
import type { ReaderLayout } from "../readerTypes";

/**
 * The page that was, kept on screen while the book is laid out again in
 * another layout (scrolling and pages, one column and a spread). The parsed
 * book is kept (useBookOpening); only epub.js's rendition is made again, and
 * until the new one shows the reader's place the old one stays where it was,
 * drawn as it was, over it: no "Loading book…", no blank page.
 *
 * Kept, it is deaf and mute: the window's resizes no longer lay it out (a
 * phone turning would have cleared it and drawn it again at the new size,
 * which is the blank the reader saw), it fetches no more chapters, and
 * nothing it does is heard as the reader's place. It takes no touches.
 */

export type Ghost = { rendition: unknown; remove: () => void };

/** Marks the kept page's container, which is not the scroll container any more (useReaderScroll). */
export const GHOST_ATTR = "data-leaflet-ghost";

/** How long the kept page takes to fade once the new one is up. */
const FADE_MS = 140;

export const isFrozen = (rendition: unknown) => Boolean((rendition as { __leafletFrozen?: boolean } | null)?.__leafletFrozen);

/** Holds a rendition's page still over the viewer. Null when there is nothing drawn to hold. */
export const freezeRendition = (rendition: any): Ghost | null => {
  const manager = rendition?.manager;
  const container: HTMLElement | undefined = manager?.container;
  if (!manager || !container?.parentElement || isFrozen(rendition)) {
    return null;
  }
  rendition.__leafletFrozen = true;
  const stage = manager.stage;
  if (stage?.resizeFunc) {
    window.removeEventListener("resize", stage.resizeFunc);
  }
  if (stage?.orientationChangeFunc) {
    window.removeEventListener("orientationchange", stage.orientationChangeFunc);
  }
  try {
    manager.removeEventListeners?.();
  } catch {
    // Its scroll listener was never added.
  }
  window.clearTimeout(manager.orientationTimeout);
  window.clearTimeout(manager.resizeTimeout);
  window.clearTimeout(manager.afterScrolled);
  window.clearTimeout(manager.scrollTimeout);
  const mute = () => undefined;
  rendition.emit = mute;
  manager.emit = mute;
  manager.check = () => Promise.resolve(false);
  manager.trim = () => Promise.resolve();

  // Every frame keeps the size it has: the viewer's classes change with the
  // layout (a spread's wide frame would be squeezed to the window).
  const top = container.scrollTop;
  const left = container.scrollLeft;
  const fix = (element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    element.style.setProperty("width", `${box.width}px`, "important");
    element.style.setProperty("height", `${box.height}px`, "important");
  };
  container.querySelectorAll<HTMLElement>(".epub-view, iframe").forEach(fix);
  const box = container.getBoundingClientRect();
  const hold = (name: string, value: string) => container.style.setProperty(name, value, "important");
  hold("position", "absolute");
  hold("top", "0");
  hold("left", "0");
  hold("width", `max(${box.width}px, 100%)`);
  hold("height", `max(${box.height}px, 100%)`);
  hold("z-index", "2");
  hold("overflow", "hidden");
  hold("pointer-events", "none");
  hold("transition", `opacity ${FADE_MS}ms ease`);
  container.setAttribute(GHOST_ATTR, "");
  container.scrollTop = top;
  container.scrollLeft = left;

  let removed = false;
  const remove = () => {
    if (removed) {
      return;
    }
    removed = true;
    const destroy = () => {
      try {
        rendition.destroy();
      } catch {
        // Half built: there was nothing more of it to take down.
      }
      container.remove();
    };
    if (!container.isConnected) {
      destroy();
      return;
    }
    container.style.setProperty("opacity", "0", "important");
    window.setTimeout(destroy, FADE_MS + 20);
  };
  return { rendition, remove };
};

/**
 * Whether the window at this size is laid out otherwise (readers/touchLayout.ts):
 * what a turn of the phone is about to do, known while the resize is still
 * being heard, before epub.js hears it.
 */
export const layoutChangesAt = (
  width: number,
  height: number,
  touch: boolean,
  now: { layout: ReaderLayout; spread: boolean },
  layoutFor: typeof readLayoutFor = readLayoutFor
) => {
  const shape = readerShape(width, height, touch);
  const layout = layoutFor(shape);
  return layout !== now.layout || spreadFor(shape, layout, width, height) !== now.spread;
};

/** The same, for the window as it is now. */
export const windowChangesLayout = (now: { layout: ReaderLayout; spread: boolean }) =>
  typeof window !== "undefined" && layoutChangesAt(window.innerWidth, window.innerHeight, isTouchInput(), now);
