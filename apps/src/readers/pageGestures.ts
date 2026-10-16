import { useEffect, useRef, type RefObject } from "react";
import { swipeTurn } from "./pageTurn";
import { TAP_SIDE_SHARE, tapAction, tapZone } from "./touchLayout";
import type { PageFit } from "./pageZoom";

/**
 * A PDF's or a comic's pages by finger (docs/android.md, "PDFs and comics"):
 * a tap at the side turns, one in the middle brings the chrome; a swipe
 * across turns; two fingers pinch the page larger or smaller about the point
 * between them, and one finger then moves about it (the stage's own scroll);
 * a double tap goes between the whole page and its width, at the tapped spot.
 */

/** A second tap within this long, and this near, is a double tap. */
export const DOUBLE_TAP_MS = 280;
export const DOUBLE_TAP_PX = 32;
/** A finger that moves further than this is not tapping. */
export const TAP_MOVE_PX = 12;
export const TAP_MAX_MS = 450;

export type Point = { x: number; y: number };

/** How far apart two fingers are. */
export const spreadOf = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** The point between two fingers. */
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** The scale a pinch asks for: the scale it began at, by how far the fingers have moved apart. */
export const pinchScale = (startScale: number, startSpread: number, spreadNow: number) =>
  startSpread > 0 && spreadNow > 0 ? startScale * (spreadNow / startSpread) : startScale;

/** A double tap goes between the whole page and its width (and from any other size to the width). */
export const doubleTapFit = (fit: PageFit): PageFit => (fit === "width" ? "page" : "width");

/** Whether a second tap is the other half of a double tap. */
export const isDoubleTap = (first: { at: number; x: number; y: number } | null, second: { at: number; x: number; y: number }) =>
  first !== null && second.at - first.at <= DOUBLE_TAP_MS && Math.hypot(second.x - first.x, second.y - first.y) <= DOUBLE_TAP_PX;

/** What a finger lifted from the stage did: a tap, or nothing of ours (a scroll, a long press, a selection). */
export const isTap = (moved: number, ms: number) => moved <= TAP_MOVE_PX && ms <= TAP_MAX_MS;

export { TAP_SIDE_SHARE };

type GestureOptions = {
  stageRef: RefObject<HTMLElement>;
  /** The gestures are bound while this is true (the book is open and drawn). */
  active: boolean;
  /** One page at a time (taps and swipes turn), or one scroll of pages (taps bring the chrome). */
  paged: boolean;
  rtl: boolean;
  fit: PageFit;
  /** The scale the page is drawn at now, for a pinch to start from. */
  scale: () => number;
  turn: (step: 1 | -1) => void;
  toggleChrome: () => void;
  hideChrome: () => void;
  /** A phone: scrolling, only a tap in the middle brings the chrome (readers/touchLayout.ts, `tapAction`). */
  immersive?: boolean;
  /** A new size about a point of the window: a pinch ("free"), a double tap (a fit). */
  zoomTo: (fit: PageFit, scale: number, about: Point) => void;
};

/** What a press began on that is its own (a link, a control, a highlight, words being selected). */
const OWN = "a, button, input, textarea, select, label, [role='button'], .pdf-link-area";

/**
 * Binds the gestures to the stage, for touch only: a mouse and a pen keep
 * the clicks, the wheel and the keys they had. Returns when the last tap was
 * taken, so the page's own click handler (a comic's) can let it be.
 */
export const usePageGestures = (options: GestureOptions) => {
  const latest = useRef(options);
  latest.current = options;
  const tappedAtRef = useRef(0);

  useEffect(() => {
    const stage = options.stageRef.current;
    if (!stage || !options.active) {
      return undefined;
    }
    const fingers = new Map<number, Point>();
    let press: { x: number; y: number; at: number; fingers: number; own: boolean } | null = null;
    let pinch: { spread: number; scale: number } | null = null;
    let lastTap: { at: number; x: number; y: number } | null = null;
    let tapTimer = 0;

    const selecting = () => {
      const picked = document.getSelection();
      return Boolean(picked && !picked.isCollapsed && picked.toString().trim());
    };

    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch") {
        return;
      }
      fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (fingers.size === 1) {
        press = {
          x: event.clientX,
          y: event.clientY,
          at: performance.now(),
          fingers: 1,
          own: Boolean((event.target as Element | null)?.closest?.(OWN)) || selecting()
        };
        pinch = null;
        return;
      }
      if (press) {
        press.fingers = Math.max(press.fingers, fingers.size);
      }
      if (fingers.size === 2) {
        const [a, b] = [...fingers.values()];
        pinch = { spread: spreadOf(a, b), scale: latest.current.scale() };
        window.clearTimeout(tapTimer);
        lastTap = null;
      }
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !fingers.has(event.pointerId)) {
        return;
      }
      fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && fingers.size >= 2) {
        const [a, b] = [...fingers.values()];
        const scale = pinchScale(pinch.scale, pinch.spread, spreadOf(a, b));
        if (Math.abs(scale - latest.current.scale()) / Math.max(0.01, latest.current.scale()) > 0.01) {
          latest.current.zoomTo("free", scale, midpoint(a, b));
        }
      }
    };

    const up = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !fingers.has(event.pointerId)) {
        return;
      }
      fingers.delete(event.pointerId);
      if (fingers.size > 0) {
        return;
      }
      pinch = null;
      const begun = press;
      press = null;
      if (!begun || event.type !== "pointerup" || begun.fingers > 1 || begun.own) {
        return;
      }
      const options = latest.current;
      const dx = event.clientX - begun.x;
      const dy = event.clientY - begun.y;
      const ms = performance.now() - begun.at;
      // A swipe across the page turns it, when the page is not wider than the
      // window (then a finger moves about the page instead).
      if (options.paged && stage.scrollWidth <= stage.clientWidth + 1) {
        const turn = swipeTurn({ dx, dy, ms, pointers: 1, pointerType: "touch", taken: selecting() }, options.rtl);
        if (turn !== null) {
          tappedAtRef.current = Date.now();
          options.hideChrome();
          options.turn(turn);
          return;
        }
      }
      if (!isTap(Math.hypot(dx, dy), ms) || selecting()) {
        return;
      }
      tappedAtRef.current = Date.now();
      const box = stage.getBoundingClientRect();
      const zone = tapZone(event.clientX, box.left, box.width, options.rtl);
      const action = tapAction(zone, options.paged ? "pages" : "scroll", options.immersive ?? false);
      const here = { at: performance.now(), x: event.clientX, y: event.clientY };
      if (isDoubleTap(lastTap, here)) {
        window.clearTimeout(tapTimer);
        lastTap = null;
        options.zoomTo(doubleTapFit(options.fit), options.scale(), { x: event.clientX, y: event.clientY });
        return;
      }
      if (action.kind === "turn") {
        // At the side a tap turns at once: two quick taps are two pages.
        lastTap = null;
        options.hideChrome();
        options.turn(action.step);
        return;
      }
      if (action.kind === "hide") {
        // Scrolling on a phone, at a side: the chrome goes (after the wait for a double tap, which still zooms).
        lastTap = here;
        window.clearTimeout(tapTimer);
        tapTimer = window.setTimeout(() => {
          lastTap = null;
          latest.current.hideChrome();
        }, DOUBLE_TAP_MS);
        return;
      }
      // In the middle it waits a moment, for a second tap.
      lastTap = here;
      window.clearTimeout(tapTimer);
      tapTimer = window.setTimeout(() => {
        lastTap = null;
        latest.current.toggleChrome();
      }, DOUBLE_TAP_MS);
    };

    stage.addEventListener("pointerdown", down, { passive: true });
    stage.addEventListener("pointermove", move, { passive: true });
    stage.addEventListener("pointerup", up, { passive: true });
    stage.addEventListener("pointercancel", up, { passive: true });
    return () => {
      window.clearTimeout(tapTimer);
      stage.removeEventListener("pointerdown", down);
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerup", up);
      stage.removeEventListener("pointercancel", up);
    };
  }, [options.active, options.stageRef]);

  /** Whether a click just now was a finger's tap these gestures took. */
  return () => Date.now() - tappedAtRef.current < 600;
};
