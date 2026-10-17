import { useEffect, useRef } from "react";

/**
 * A sheet on a phone goes down the way it came up: pulled down by its grip,
 * or anywhere on it while it is scrolled to its top, it follows the finger;
 * let go far enough down (or flicked down) it closes, otherwise it springs
 * back. A drag that starts in the sheet's own scrolling list, scrolled down,
 * or that goes up or sideways, is the list's: the sheet never fights it.
 *
 * One way for all of them: the dialogs drawn as sheets (`SheetHandle`, which
 * every `.sheet-panel` with a grip carries) and the reader's own sheets
 * (readers/text/ReaderToolbar.tsx, PDFs' and comics' in pages/PageReaderView.tsx).
 */

/** How far a finger moves before the drag is the sheet's or the list's. */
export const SHEET_SLOP = 6;

/** The first moves: still deciding, the sheet's to pull, or the list's (or a slider's) to scroll. */
export type SheetDragStart = "wait" | "drag" | "pass";

export const startsSheetDrag = (move: {
  dx: number;
  dy: number;
  /** Started on the grip or the sheet's heading. */
  onGrip: boolean;
  /** A scrolling list under the finger is scrolled down from its top. */
  scrolledDown: boolean;
}): SheetDragStart => {
  const { dx, dy, onGrip, scrolledDown } = move;
  if (Math.hypot(dx, dy) < SHEET_SLOP) return "wait";
  // Sideways is a slider's, a row of chips', or nothing.
  if (Math.abs(dx) > Math.abs(dy)) return "pass";
  if (onGrip) return dy > 0 ? "drag" : "pass";
  if (dy < 0 || scrolledDown) return "pass";
  return "drag";
};

/** How far down a sheet of this height is pulled before letting go closes it. */
export const sheetCloseDistance = (height: number) => Math.min(120, Math.max(64, height * 0.25));

/** Faster than this downward (px per ms) at the moment of letting go is a flick, which closes it. */
export const SHEET_FLICK = 0.5;

/** The finger's speed just before letting go, from its last moves (time in ms, y in px). */
export const flickSpeed = (samples: ReadonlyArray<{ t: number; y: number }>) => {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  // The moves of the last 100 ms, so a pause before letting go is not a flick.
  let first = samples[samples.length - 2];
  for (let at = samples.length - 2; at >= 0 && last.t - samples[at].t <= 100; at -= 1) first = samples[at];
  const ms = last.t - first.t;
  return ms > 0 ? (last.y - first.y) / ms : 0;
};

/** On letting go: close, or spring back. */
export const endsSheetDrag = (pulled: number, speed: number, height: number): "close" | "stay" =>
  pulled >= sheetCloseDistance(height) || (pulled > 16 && speed >= SHEET_FLICK) ? "close" : "stay";

/** What a finger can drag without it being the sheet's: a slider, a field, a list's own handle. */
const KEEPS_ITS_DRAG = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-no-sheet-drag]";

/** A scroller between the finger and the sheet (the sheet included) that is not at its top. */
const scrolledBetween = (target: Element, panel: HTMLElement) => {
  for (let element: Element | null = target; element; element = element.parentElement) {
    if (element instanceof HTMLElement && element.scrollTop > 0) {
      const overflow = getComputedStyle(element).overflowY;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
    if (element === panel) break;
  }
  return false;
};

/** A touch within the top of a sheet, where its grip is drawn. */
export const onTopEdge = (panel: HTMLElement, y: number) => y - panel.getBoundingClientRect().top <= 32;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export type SheetSwipeOptions = {
  /** The sheet a touch at this element is in, or null when it is in none that closes by a swipe now. */
  panelFor: (target: Element) => HTMLElement | null;
  /**
   * Whether a touch here is on the sheet's grip or heading (pulls even when
   * its list is scrolled down). By default: its top 32 px, where the grip is.
   */
  onGrip?: (target: Element, panel: HTMLElement, y: number) => boolean;
  /** Closes the sheet. When it is still there afterwards, it springs back. */
  onClose: (panel: HTMLElement) => void;
};

/** Listens for sheet swipes under `root`. Returns the detach. */
export const attachSheetSwipe = (root: HTMLElement | Document, options: SheetSwipeOptions) => {
  type Drag = {
    panel: HTMLElement;
    x: number;
    y: number;
    onGrip: boolean;
    scrolledDown: boolean;
    state: SheetDragStart;
    pulled: number;
    samples: Array<{ t: number; y: number }>;
    reduced: boolean;
    id: number;
  };
  let drag: Drag | null = null;

  const settle = (panel: HTMLElement) => {
    panel.style.transition = `transform 200ms ${EASE}`;
    panel.style.transform = "";
    window.setTimeout(() => {
      if (!panel.style.transform) panel.style.transition = "";
    }, 220);
  };

  const close = (held: Drag) => {
    const { panel, reduced } = held;
    const done = () => {
      options.onClose(panel);
      // Still there (it would not close): back up it goes.
      window.setTimeout(() => {
        if (panel.isConnected) settle(panel);
      }, 30);
    };
    if (reduced) {
      done();
      return;
    }
    panel.style.transition = `transform 160ms ${EASE}`;
    panel.style.transform = `translateY(${panel.offsetHeight}px)`;
    window.setTimeout(done, 150);
  };

  const onStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      drag = null;
      return;
    }
    const target = event.target as Element | null;
    if (!target || !(target instanceof Element) || target.closest(KEEPS_ITS_DRAG)) return;
    const panel = options.panelFor(target);
    if (!panel) return;
    const touch = event.touches[0];
    drag = {
      panel,
      x: touch.clientX,
      y: touch.clientY,
      onGrip: options.onGrip ? options.onGrip(target, panel, touch.clientY) : onTopEdge(panel, touch.clientY),
      scrolledDown: scrolledBetween(target, panel),
      state: "wait",
      pulled: 0,
      samples: [{ t: event.timeStamp, y: touch.clientY }],
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
    const dy = touch.clientY - held.y;
    if (held.state === "wait") {
      held.state = startsSheetDrag({ dx, dy, onGrip: held.onGrip, scrolledDown: held.scrolledDown });
      if (held.state === "pass") {
        drag = null;
        return;
      }
      if (held.state === "wait") return;
      if (!held.reduced) held.panel.style.transition = "none";
    }
    if (event.cancelable) event.preventDefault();
    held.pulled = Math.max(0, dy);
    held.samples.push({ t: event.timeStamp, y: touch.clientY });
    if (held.samples.length > 8) held.samples.shift();
    if (!held.reduced) held.panel.style.transform = held.pulled > 0 ? `translateY(${held.pulled}px)` : "";
  };

  const onEnd = () => {
    const held = drag;
    drag = null;
    if (!held || held.state !== "drag") return;
    if (endsSheetDrag(held.pulled, flickSpeed(held.samples), held.panel.offsetHeight) === "close") {
      close(held);
    } else if (!held.reduced) {
      settle(held.panel);
    }
  };

  const onCancel = () => {
    const held = drag;
    drag = null;
    if (held?.state === "drag" && !held.reduced) settle(held.panel);
  };

  const start = onStart as EventListener;
  const move = onMove as EventListener;
  root.addEventListener("touchstart", start, { passive: true });
  // Not passive: once the drag is the sheet's, the list under it must not scroll as well.
  root.addEventListener("touchmove", move, { passive: false });
  root.addEventListener("touchend", onEnd);
  root.addEventListener("touchcancel", onCancel);
  return () => {
    root.removeEventListener("touchstart", start);
    root.removeEventListener("touchmove", move);
    root.removeEventListener("touchend", onEnd);
    root.removeEventListener("touchcancel", onCancel);
  };
};

/**
 * `attachSheetSwipe` for a component's life. `root` is read once mounted; the
 * latest options are used, so they may be inline.
 */
export const useSheetSwipe = (root: () => HTMLElement | Document | null, options: SheetSwipeOptions, active = true) => {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!active) return undefined;
    const element = root();
    if (!element || typeof element.addEventListener !== "function") return undefined;
    return attachSheetSwipe(element, {
      panelFor: (target) => latest.current.panelFor(target),
      onGrip: (target, panel, y) => (latest.current.onGrip ?? ((_, on, at) => onTopEdge(on, at)))(target, panel, y),
      onClose: (panel) => latest.current.onClose(panel)
    });
    // `root` is read once: the element it names lives as long as the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
};
