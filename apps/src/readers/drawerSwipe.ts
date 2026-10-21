import { useEffect, useRef } from "react";
import {
  endsSheetDrag, flickSpeed, SHEET_SLOP, type SheetDragStart
} from "../components/ui/sheetSwipe";

/**
 * The chapter list on a phone goes back the way it came: pushed toward the
 * left edge it follows the finger, and let go far enough (or flicked) it
 * closes, otherwise it springs back. The sheets' swipe (components/ui/
 * sheetSwipe.ts) turned on its side: the same distances and flick. A drag
 * that starts up or down is the list's to scroll, and one to the right is
 * nothing: the drawer never fights either. The ✕ stays.
 */

/** The first moves: still deciding, the drawer's to push away, or the list's. */
export const startsDrawerDrag = (dx: number, dy: number): SheetDragStart => {
  if (Math.hypot(dx, dy) < SHEET_SLOP) return "wait";
  return dx < 0 && Math.abs(dx) > Math.abs(dy) ? "drag" : "pass";
};

/** On letting go, pushed `pushed` px toward the edge at `speed` px a ms: close, or spring back. */
export const endsDrawerDrag = (pushed: number, speed: number, width: number) =>
  endsSheetDrag(pushed, speed, width);

/** What a finger can drag in the list without it being the drawer's. */
const KEEPS_ITS_DRAG = "input, textarea, select, [data-no-sheet-drag]";

const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Listens for the drawer `panel` being swiped away. Returns the detach. */
export const attachDrawerSwipe = (panel: HTMLElement, onClose: () => void) => {
  type Drag = {
    x: number;
    y: number;
    state: SheetDragStart;
    pushed: number;
    /** Distances toward the edge, for `flickSpeed`. */
    samples: Array<{ t: number; y: number }>;
    reduced: boolean;
    id: number;
  };
  let drag: Drag | null = null;

  // Back to where the stylesheet has it, open.
  const settle = () => {
    panel.style.transition = `transform 200ms ${EASE}`;
    panel.style.transform = "";
    window.setTimeout(() => {
      if (!panel.style.transform) panel.style.transition = "";
    }, 220);
  };

  // The rest of the way shut from where the finger left it, then the
  // stylesheet's closed drawer, which is where it already is.
  const close = (reduced: boolean) => {
    if (!reduced) {
      panel.style.transition =
        `transform 160ms ${EASE}, opacity 0.18s ease, visibility 0s linear 160ms`;
      panel.style.transform = "translateX(calc(-100% - 14px))";
      window.setTimeout(() => {
        panel.style.transition = "";
        panel.style.transform = "";
      }, 200);
    }
    onClose();
  };

  const onStart = (event: TouchEvent) => {
    const target = event.target;
    const keeps = !(target instanceof Element) || Boolean(target.closest(KEEPS_ITS_DRAG));
    if (event.touches.length !== 1 || keeps) {
      drag = null;
      return;
    }
    const touch = event.touches[0];
    drag = {
      x: touch.clientX,
      y: touch.clientY,
      state: "wait",
      pushed: 0,
      samples: [{ t: event.timeStamp, y: -touch.clientX }],
      reduced: reducedMotion(),
      id: touch.identifier
    };
  };

  const onMove = (event: TouchEvent) => {
    const held = drag;
    if (!held || held.state === "pass") return;
    const touch = Array.from(event.touches).find((one) => one.identifier === held.id);
    if (!touch) return;
    const dx = touch.clientX - held.x;
    if (held.state === "wait") {
      held.state = startsDrawerDrag(dx, touch.clientY - held.y);
      if (held.state === "pass") {
        drag = null;
        return;
      }
      if (held.state === "wait") return;
      if (!held.reduced) panel.style.transition = "none";
    }
    if (event.cancelable) event.preventDefault();
    held.pushed = Math.max(0, -dx);
    held.samples.push({ t: event.timeStamp, y: -touch.clientX });
    if (held.samples.length > 8) held.samples.shift();
    if (!held.reduced) {
      panel.style.transform = held.pushed > 0 ? `translateX(${-held.pushed}px)` : "";
    }
  };

  const onEnd = () => {
    const held = drag;
    drag = null;
    if (!held || held.state !== "drag") return;
    if (endsDrawerDrag(held.pushed, flickSpeed(held.samples), panel.offsetWidth) === "close") {
      close(held.reduced);
    } else if (!held.reduced) {
      settle();
    }
  };

  const onCancel = () => {
    const held = drag;
    drag = null;
    if (held?.state === "drag" && !held.reduced) settle();
  };

  const start = onStart as EventListener;
  const move = onMove as EventListener;
  panel.addEventListener("touchstart", start, { passive: true });
  // Not passive: once the drag is the drawer's, the list in it must not scroll as well.
  panel.addEventListener("touchmove", move, { passive: false });
  panel.addEventListener("touchend", onEnd);
  panel.addEventListener("touchcancel", onCancel);
  return () => {
    panel.removeEventListener("touchstart", start);
    panel.removeEventListener("touchmove", move);
    panel.removeEventListener("touchend", onEnd);
    panel.removeEventListener("touchcancel", onCancel);
  };
};

/** `attachDrawerSwipe` while `active`, on the drawer `panel` names; with the latest `onClose`. */
export const useDrawerSwipe = (
  panel: () => HTMLElement | null,
  onClose: () => void,
  active: boolean
) => {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    const element = active ? panel() : null;
    if (!element) return undefined;
    return attachDrawerSwipe(element, () => latest.current());
    // `panel` is read as it turns active: the drawer lives as long as the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
};
