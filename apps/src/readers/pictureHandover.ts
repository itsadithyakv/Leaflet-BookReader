/**
 * A pinch begun on a picture of the page carries on in the picture viewer
 * (readers/ImageViewer.tsx): the viewer opens with the picture where the page
 * had it, and the same fingers go on zooming it, about the same point.
 *
 * The fingers stay the page's: a touch belongs to the element it went down
 * on, inside the book's frame, however the viewer covers it. So the page
 * hands their moves on (`FingerFeed`), in the window's coordinates, until the
 * last lifts; after that the viewer has touches of its own.
 *
 * Only a touch that starts on a picture is listened to closely (a listener
 * that may cancel a touch makes the browser wait for the page before it
 * scrolls): the text scrolls as it always did, and one finger on a picture
 * scrolls too. Two fingers on a picture are not a scroll (they never were:
 * the WebView does not zoom the page); once they move apart or together the
 * viewer takes them. A page already scrolling under the fingers is left be.
 */

import { spreadOf, type Point, type Size } from "./imageZoom";

/** The fingers' moves, from the page to the viewer. `null` to a listener: all have lifted. */
export type FingerFeed = {
  push: (fingers: Point[]) => void;
  end: () => void;
  listen: (listener: (fingers: Point[] | null) => void) => () => void;
  /** The fingers last handed on (the viewer may mount after a move or two). */
  latest: () => Point[] | null;
  ended: () => boolean;
};

export const fingerFeed = (): FingerFeed => {
  let latest: Point[] | null = null;
  let over = false;
  const listeners = new Set<(fingers: Point[] | null) => void>();
  return {
    push: (fingers) => {
      if (over) return;
      latest = fingers;
      listeners.forEach((listener) => listener(fingers));
    },
    end: () => {
      if (over) return;
      over = true;
      listeners.forEach((listener) => listener(null));
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    latest: () => latest,
    ended: () => over
  };
};

/** What the viewer is handed: where the picture was, how large it is, and the fingers as the pinch began. */
export type PictureHandover = {
  /** The picture on the page, in the window. */
  rect: { left: number; top: number; width: number; height: number };
  natural: Size;
  /** The fingers where the pinch began, in the window. */
  fingers: Point[];
  feed: FingerFeed;
};

/** Two fingers that move apart or together by this much are pinching (less is two fingers resting). */
export const PINCH_START_PX = 8;

export const isPinching = (from: Point[], to: Point[]) =>
  from.length >= 2 && to.length >= 2 && Math.abs(spreadOf(to) - spreadOf(from)) >= PINCH_START_PX;

type TouchList = { length: number; [index: number]: { clientX: number; clientY: number } };

/** A touch event's fingers, in the window (the book's frame sits at `offset` in it). */
export const fingersOf = (touches: TouchList, offset: Point): Point[] => {
  const fingers: Point[] = [];
  for (let index = 0; index < touches.length; index += 1) {
    fingers.push({ x: touches[index].clientX + offset.x, y: touches[index].clientY + offset.y });
  }
  return fingers;
};

const bound = new WeakSet<Element>();

/**
 * Lets a pinch on this picture open the viewer: `open` is asked, and answers
 * whether it took the pinch. Bound once per picture; nothing to undo, the
 * listeners go with the chapter's document.
 */
export const bindPicturePinch = (element: HTMLImageElement, open: (handover: PictureHandover) => boolean) => {
  if (bound.has(element)) {
    return;
  }
  bound.add(element);
  const doc = element.ownerDocument;
  const offset = (): Point => {
    const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
    return { x: frame?.left ?? 0, y: frame?.top ?? 0 };
  };
  /** A touch begun on the picture: the fingers when the second came, and the feed once the viewer has it. */
  let touch: { from: Point[] | null; feed: FingerFeed | null; dead: boolean } | null = null;

  const stop = () => {
    touch = null;
    doc.removeEventListener("touchstart", more, true);
    doc.removeEventListener("touchmove", move, true);
    doc.removeEventListener("touchend", end, true);
    doc.removeEventListener("touchcancel", end, true);
  };
  const listenMoves = () => doc.addEventListener("touchmove", move, { capture: true, passive: false });
  /** Another finger, anywhere on the page. */
  const more = (event: TouchEvent) => {
    if (touch && !touch.feed && !touch.from && event.touches.length >= 2) {
      touch.from = fingersOf(event.touches, offset());
      listenMoves();
    }
  };
  const move = (event: TouchEvent) => {
    if (!touch || touch.dead) {
      return;
    }
    const fingers = fingersOf(event.touches, offset());
    if (touch.feed) {
      // The viewer's now: nothing of the page moves under it.
      if (event.cancelable) event.preventDefault();
      touch.feed.push(fingers);
      return;
    }
    if (fingers.length < 2) {
      return;
    }
    if (!event.cancelable) {
      // The page is scrolling already: these fingers are the scroll's.
      touch.dead = true;
      return;
    }
    event.preventDefault();
    touch.from ??= fingers;
    if (!isPinching(touch.from, fingers)) {
      return;
    }
    const box = element.getBoundingClientRect();
    const natural = { width: element.naturalWidth, height: element.naturalHeight };
    if (!(box.width > 0 && box.height > 0 && natural.width > 0 && natural.height > 0)) {
      touch.dead = true;
      return;
    }
    const at = offset();
    const feed = fingerFeed();
    const taken = open({
      rect: { left: box.left + at.x, top: box.top + at.y, width: box.width, height: box.height },
      natural,
      fingers: touch.from,
      feed
    });
    if (!taken) {
      touch.dead = true;
      return;
    }
    touch.feed = feed;
    feed.push(fingers);
  };
  const end = (event: TouchEvent) => {
    if (!touch) {
      return;
    }
    if (event.touches.length === 0) {
      touch.feed?.end();
      stop();
      return;
    }
    if (touch.feed) {
      touch.feed.push(fingersOf(event.touches, offset()));
    } else if (event.touches.length < 2) {
      touch.from = null;
    }
  };
  // Not passive: a touch begun here may become the viewer's, and must be ours to stop.
  element.addEventListener(
    "touchstart",
    (event: TouchEvent) => {
      if (!touch) {
        doc.addEventListener("touchstart", more, { capture: true, passive: true });
        doc.addEventListener("touchend", end, { capture: true, passive: true });
        doc.addEventListener("touchcancel", end, { capture: true, passive: true });
      }
      if (!touch || event.touches.length === 1) {
        // A new touch (one that ended out of sight is let go).
        touch?.feed?.end();
        touch = { from: null, feed: null, dead: false };
      }
      if (event.touches.length >= 2 && !touch.from && !touch.feed) {
        touch.from = fingersOf(event.touches, offset());
        listenMoves();
      }
    },
    { passive: false }
  );
};
