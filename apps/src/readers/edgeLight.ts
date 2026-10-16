import { classifySwipe, dragLevel, edgeAt, type Box, type LightKind, type SwipeCall } from "./readingLight";
import { releaseLight, setLight, startLevel } from "./readingLightStore";

/**
 * The swipe at the page's edges that sets the light (readers/readingLight.ts),
 * for any reader: bind its handlers to each document a finger can press on
 * (a chapter's frame, the page around it). Touch only: a mouse has the
 * sliders in Text settings.
 *
 * A finger that goes down in a strip is watched for its first `DECIDE_PX`:
 * while it moves that little the page is kept from scrolling under it, then
 * up or down is the light's (the page stays put and the level follows the
 * finger), and anything else is let go to do what it did before (a swipe
 * across turns the page). A finger that rests first is a press and hold, and
 * is never taken; nor is one that starts while something is selected or open
 * over the page.
 */
export type EdgeLightOptions = {
  /** Whether the swipes are wanted now (a touch screen, the book up). */
  enabled: () => boolean;
  /** The page, in the window's coordinates. */
  page: () => Box | null;
  /** Boxes of the page kept for something else (the bookmark corner, the footer). */
  keep?: () => Box[];
  /** Something has the page now (a selection, a card open over it). */
  busy?: (doc: Document | null) => boolean;
};

/** Below this the finger has not moved at all (a tap's tremor), and the page is left alone. */
const STILL_PX = 3;

type Press = {
  kind: LightKind;
  id: number;
  x: number;
  y: number;
  at: number;
  call: SwipeCall;
  height: number;
  /** Where the level stood, and the finger, when the swipe became the light's. */
  from: number;
  fromY: number;
};

const docOf = (target: EventTarget | null): Document | null => {
  const node = target as Node | null;
  if (!node) {
    return null;
  }
  return node.nodeType === 9 ? (node as Document) : node.ownerDocument;
};

/** A point in a frame's document, in the window's coordinates. */
const toWindow = (doc: Document | null, x: number, y: number) => {
  let frame: Element | null = null;
  try {
    frame = doc?.defaultView?.frameElement ?? null;
  } catch {
    frame = null;
  }
  const box = frame?.getBoundingClientRect();
  return { x: x + (box?.left ?? 0), y: y + (box?.top ?? 0) };
};

const touchById = (list: TouchList, id: number) => {
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].identifier === id) {
      return list[index];
    }
  }
  return null;
};

export const edgeLightHandlers = (options: EdgeLightOptions) => {
  let press: Press | null = null;
  const letGo = () => {
    if (press?.call === "light") {
      releaseLight();
    }
    press = null;
  };
  const start = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      letGo();
      return;
    }
    press = null;
    if (!options.enabled()) {
      return;
    }
    const touch = event.changedTouches[0];
    const doc = docOf(event.target);
    const page = options.page();
    if (!touch || !page) {
      return;
    }
    const at = toWindow(doc, touch.clientX, touch.clientY);
    const kind = edgeAt(at.x, at.y, page, options.keep?.() ?? []);
    if (!kind || options.busy?.(doc)) {
      return;
    }
    press = { kind, id: touch.identifier, x: touch.clientX, y: touch.clientY, at: performance.now(), call: "wait", height: page.height, from: 0, fromY: 0 };
  };
  const move = (event: TouchEvent) => {
    if (!press) {
      return;
    }
    if (event.touches.length > 1) {
      letGo();
      return;
    }
    const touch = touchById(event.touches, press.id);
    if (!touch) {
      return;
    }
    const dx = touch.clientX - press.x;
    const dy = touch.clientY - press.y;
    if (press.call === "wait") {
      press.call = classifySwipe(dx, dy, performance.now() - press.at);
      if (press.call === "light") {
        if (options.busy?.(docOf(event.target))) {
          press = null;
          return;
        }
        press.from = startLevel(press.kind);
        press.fromY = touch.clientY;
      }
    }
    if (press.call === "other") {
      press = null;
      return;
    }
    if (press.call === "wait") {
      // Not yet decided: the page must not start scrolling under the finger.
      if (event.cancelable && Math.max(Math.abs(dx), Math.abs(dy)) >= STILL_PX) {
        event.preventDefault();
      }
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    setLight(press.kind, dragLevel(press.from, touch.clientY - press.fromY, press.height), { held: true });
  };
  const end = (event: TouchEvent) => {
    if (press && !touchById(event.touches, press.id)) {
      letGo();
    }
  };
  return { start, move, end, cancel: letGo };
};

export type EdgeLight = ReturnType<typeof edgeLightHandlers>;

/** Binds the handlers to a document or an element; returns the unbinding. */
export const bindEdgeLight = (target: Document | HTMLElement, light: EdgeLight) => {
  const start = light.start as EventListener;
  const move = light.move as EventListener;
  const end = light.end as EventListener;
  target.addEventListener("touchstart", start, { passive: true });
  target.addEventListener("touchmove", move, { passive: false });
  target.addEventListener("touchend", end, { passive: true });
  target.addEventListener("touchcancel", end, { passive: true });
  return () => {
    target.removeEventListener("touchstart", start);
    target.removeEventListener("touchmove", move);
    target.removeEventListener("touchend", end);
    target.removeEventListener("touchcancel", end);
  };
};
