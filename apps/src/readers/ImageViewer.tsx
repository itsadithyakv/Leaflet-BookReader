import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { UiIcon } from "../components/UiIcon";
import {
  ZOOM_STEP, clampView, closeShade, doubleTapView, fitView, fromMiddle, gestureView, handoverView, isAtFit, isCloseSwipe,
  isViewerDoubleTap, isViewerTap, panBy, settleView, wheelFactor, zoomAt, centreOf,
  type Point, type Size, type ZoomView
} from "./imageZoom";
import type { PictureHandover } from "./pictureHandover";
import "./imageViewer.css";

export type ViewedPicture = {
  /** The picture's address as the book's page has it (epub.js's own copy): nothing is read again. */
  src: string;
  alt: string;
  /** Blended into the page there ("title" or "art", see inkImages), or not an ink picture at all. */
  ink: string | null;
  /** The reader has it shown as drawn in the page. */
  inkOff: boolean;
  /** Opened by a pinch on the page, which carries on here (readers/pictureHandover.ts). */
  handover?: PictureHandover;
};

type ImageViewerProps = {
  picture: ViewedPicture;
  /** Blend with the page, or show as drawn there: what a click on an ink picture used to do. */
  onToggleInk: () => void;
  onClose: () => void;
};

/** How long the picture eases to rest (a double tap, a settle after a pinch, a swipe away). */
const EASE_MS = 200;

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A picture from the book (a map, an illustration) large over the page:
 * fitted to the window; zoomed with a pinch (about the point between the
 * fingers), a double tap, the wheel or + and -; dragged to move, within
 * reach; closed with Escape, Back, a tap beside it or a swipe down at the
 * fit. Always shown as drawn.
 *
 * Cheap to move on a slow phone: a gesture writes the picture's transform
 * (one write a frame) and the percentage, and nothing of React's runs until
 * it settles.
 */
export const ImageViewer = ({ picture, onToggleInk, onClose }: ImageViewerProps) => {
  const root = useRef<HTMLDivElement | null>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const shade = useRef<HTMLDivElement | null>(null);
  const label = useRef<HTMLButtonElement | null>(null);
  // Read once: a pinch from the page hands over where the picture was.
  const handover = useRef(picture.handover ?? null).current;
  const [natural, setNatural] = useState<Size | null>(handover?.natural ?? null);
  const naturalRef = useRef<Size | null>(natural);
  naturalRef.current = natural;
  const room = (): Size => ({ width: root.current?.clientWidth ?? window.innerWidth, height: root.current?.clientHeight ?? window.innerHeight });
  const viewRef = useRef<ZoomView>(
    handover ? handoverView(handover.rect, handover.natural, { width: window.innerWidth, height: window.innerHeight }) : { scale: 1, x: 0, y: 0 }
  );
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const easeTimer = useRef(0);
  const closing = useRef(false);

  /** Puts the picture where `view` says: the transform only (and the percentage). */
  const draw = (view: ZoomView, ease = false) => {
    viewRef.current = view;
    const img = image.current;
    if (!img) {
      return;
    }
    const easing = ease && !reducedMotion();
    img.classList.toggle("is-easing", easing);
    window.clearTimeout(easeTimer.current);
    if (easing) {
      easeTimer.current = window.setTimeout(() => img.classList.remove("is-easing"), EASE_MS + 40);
    }
    img.style.transform = `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    if (label.current && naturalRef.current) {
      label.current.textContent = `${Math.round(view.scale * 100)}%`;
    }
  };
  const fade = (amount: number, ease = false) => {
    const backdrop = shade.current;
    if (backdrop) {
      backdrop.classList.toggle("is-easing", ease && !reducedMotion());
      backdrop.style.opacity = amount >= 1 ? "" : String(amount);
    }
  };
  const change = (next: (view: ZoomView, picture: Size, room: Size) => ZoomView, ease = false) => {
    const size = naturalRef.current;
    if (size) {
      draw(next(viewRef.current, size, room()), ease);
    }
  };
  const zoom = (factor: number, at?: Point, ease = false) => change((current, size, space) => zoomAt(current, factor, size, space, at), ease);
  const fit = () => change((_, size, space) => fitView(size, space), true);
  const close = () => {
    if (!closing.current) {
      closing.current = true;
      closeRef.current();
    }
  };

  // ---- Fingers and the mouse: one drags, two pinch (and a pinch from the page carries on). ----

  /** The gesture under way: the view and the fingers (from the window's middle) it began from. */
  const gesture = useRef<{
    start: ZoomView;
    from: Point[];
    /** At the fit with one finger: a drag down closes. */
    canSwipe: boolean;
    swiping: boolean;
    at: number;
  } | null>(null);
  const fingers = useRef(new Map<number, Point>());
  const frame = useRef(0);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const press = useRef<{ at: number; x: number; y: number; many: boolean } | null>(null);
  const closeOnClick = useRef(false);

  const begin = (points: Point[], swipes = false) => {
    const size = naturalRef.current;
    const space = room();
    const start = viewRef.current;
    gesture.current = {
      start,
      from: points.map((point) => fromMiddle(point, space)),
      canSwipe: swipes && Boolean(size) && points.length === 1 && isAtFit(start, size as Size, space),
      swiping: false,
      at: performance.now()
    };
    image.current?.classList.add("is-moving");
    image.current?.classList.remove("is-easing");
  };
  /** Follows the fingers (window points). Another finger down or up begins again from here. */
  const follow = (points: Point[]) => {
    const size = naturalRef.current;
    const now = gesture.current;
    if (!size || !now || points.length === 0) {
      return;
    }
    if (points.length !== now.from.length) {
      begin(points);
      return;
    }
    const space = room();
    const to = points.map((point) => fromMiddle(point, space));
    if (now.canSwipe && points.length === 1) {
      const dx = to[0].x - now.from[0].x;
      const dy = to[0].y - now.from[0].y;
      if (!now.swiping && isCloseSwipe(dx, dy, 0, false)) {
        now.swiping = true;
      }
      if (now.swiping) {
        draw({ ...now.start, y: now.start.y + Math.max(0, dy) });
        fade(closeShade(Math.max(0, dy), space));
        return;
      }
    }
    draw(gestureView(now.start, now.from, to, size, space));
  };
  /** The fingers lifted: the picture comes to rest (or, swiped down far enough, goes). */
  const settle = (last: Point[]) => {
    const size = naturalRef.current;
    const now = gesture.current;
    gesture.current = null;
    image.current?.classList.remove("is-moving");
    if (!size || !now) {
      return;
    }
    const space = room();
    if (now.swiping) {
      const lastPoint = last[0] ? fromMiddle(last[0], space) : now.from[0];
      const dx = lastPoint.x - now.from[0].x;
      const dy = lastPoint.y - now.from[0].y;
      if (isCloseSwipe(dx, dy, performance.now() - now.at)) {
        if (reducedMotion()) {
          close();
          return;
        }
        draw({ ...viewRef.current, y: viewRef.current.y + space.height * 0.6 }, true);
        fade(0, true);
        window.setTimeout(close, EASE_MS);
        return;
      }
      fade(1, true);
      draw(now.start, true);
      return;
    }
    const at = last.length > 0 ? fromMiddle(centreOf(last), space) : undefined;
    const rest = settleView(viewRef.current, size, space, at);
    const current = viewRef.current;
    if (rest.scale !== current.scale || rest.x !== current.x || rest.y !== current.y) {
      draw(rest, true);
    }
    fade(1);
  };
  const schedule = () => {
    if (frame.current) {
      return;
    }
    frame.current = window.requestAnimationFrame(() => {
      frame.current = 0;
      follow(Array.from(fingers.current.values()));
    });
  };

  // A pinch begun on the page: the picture starts where the page had it, and the same fingers go on.
  useEffect(() => {
    if (!handover) {
      return undefined;
    }
    // From the page's picture every time (React may run this twice in a row).
    viewRef.current = handoverView(handover.rect, handover.natural, room());
    begin(handover.fingers);
    draw(viewRef.current);
    let last: Point[] = handover.feed.latest() ?? handover.fingers;
    let pending = 0;
    const onFingers = (points: Point[] | null) => {
      if (points === null) {
        window.cancelAnimationFrame(pending);
        pending = 0;
        // The last move first: the picture rests from where the fingers left it.
        follow(last);
        settle(last);
        return;
      }
      if (pending && points.length !== last.length) {
        // A finger lifted (or came) before the last move was drawn: that move first.
        window.cancelAnimationFrame(pending);
        pending = 0;
        follow(last);
      }
      last = points;
      if (!pending) {
        pending = window.requestAnimationFrame(() => {
          pending = 0;
          follow(last);
        });
      }
    };
    const stop = handover.feed.listen(onFingers);
    if (handover.feed.ended()) {
      settle(last);
    } else {
      follow(last);
    }
    return () => {
      stop();
      window.cancelAnimationFrame(pending);
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    closeOnClick.current = false;
    if ((event.target as Element).closest?.(".reader-image-viewer-bar") || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Already let go.
    }
    if (frame.current) {
      // A move still waiting for its frame is drawn before another finger joins.
      window.cancelAnimationFrame(frame.current);
      frame.current = 0;
      follow(Array.from(fingers.current.values()));
    }
    fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (fingers.current.size === 1) {
      press.current = { at: performance.now(), x: event.clientX, y: event.clientY, many: false };
      // A finger (or a pen) at the fit can swipe the picture away; the mouse only moves it.
      begin([{ x: event.clientX, y: event.clientY }], event.pointerType !== "mouse");
    } else {
      if (press.current) press.current.many = true;
      follow(Array.from(fingers.current.values()));
    }
    image.current?.classList.add("is-dragging");
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!fingers.current.has(event.pointerId)) {
      return;
    }
    fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    schedule();
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!fingers.current.has(event.pointerId)) {
      return;
    }
    const lifted = { x: event.clientX, y: event.clientY };
    const before = Array.from(fingers.current.values());
    fingers.current.delete(event.pointerId);
    window.cancelAnimationFrame(frame.current);
    frame.current = 0;
    // The last move first (it may still be waiting for its frame).
    follow(before);
    if (fingers.current.size > 0) {
      // A finger stays: the gesture goes on from where it is.
      follow(Array.from(fingers.current.values()));
      return;
    }
    image.current?.classList.remove("is-dragging");
    const pressed = press.current;
    press.current = null;
    const tapped =
      event.type === "pointerup" &&
      pressed !== null &&
      !pressed.many &&
      isViewerTap(Math.hypot(lifted.x - pressed.x, lifted.y - pressed.y), performance.now() - pressed.at);
    // At rest within reach (a tap that slid a little comes back too).
    settle(before);
    if (!tapped) {
      return;
    }
    const box = image.current?.getBoundingClientRect();
    const onPicture = Boolean(box && lifted.x >= box.left && lifted.x <= box.right && lifted.y >= box.top && lifted.y <= box.bottom);
    if (!onPicture) {
      // Beside the picture: closes, on the click that follows (closed here, the
      // tap's click would land on the page underneath and turn it).
      closeOnClick.current = true;
      return;
    }
    const here = { at: performance.now(), x: lifted.x, y: lifted.y };
    if (isViewerDoubleTap(lastTap.current, here)) {
      lastTap.current = null;
      change((current, size, space) => doubleTapView(current, size, space, fromMiddle(lifted, space)), true);
      return;
    }
    lastTap.current = here;
  };

  // Focus leaves the book for the viewer, so its keys come here.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onResize = () => change((current, size, space) => clampView(current, size, space));
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.cancelAnimationFrame(frame.current);
      window.clearTimeout(easeTimer.current);
    };
  }, []);

  // The wheel zooms about the pointer (with Ctrl, a touchpad's pinch, finer).
  // Bound by hand: React's wheel listener is passive, and the page behind must not scroll.
  useEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoom(wheelFactor(event.deltaY, event.deltaMode, event.ctrlKey), {
        x: event.clientX - box.left - box.width / 2,
        y: event.clientY - box.top - box.height / 2
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = 80;
    const pan = (dx: number, dy: number) => change((current, size, space) => panBy(current, dx, dy, size, space));
    const key = event.key;
    if (key === "Tab") {
      // Tab moves among the viewer's own buttons.
      return;
    }
    if ((key === "Enter" || key === " ") && (event.target as HTMLElement).tagName === "BUTTON") {
      // A button of the viewer's is being pressed; nothing behind hears it.
      event.stopPropagation();
      return;
    }
    event.stopPropagation();
    if (key === "Escape") {
      close();
    } else if (key === "+" || key === "=") {
      zoom(ZOOM_STEP, undefined, true);
    } else if (key === "-" || key === "_") {
      zoom(1 / ZOOM_STEP, undefined, true);
    } else if (key === "0") {
      fit();
    } else if (key === "ArrowLeft") {
      pan(step, 0);
    } else if (key === "ArrowRight") {
      pan(-step, 0);
    } else if (key === "ArrowUp") {
      pan(0, step);
    } else if (key === "ArrowDown") {
      pan(0, -step);
    } else {
      // Nothing of the reader's (Space, B, ?) acts behind the viewer.
      event.preventDefault();
      return;
    }
    event.preventDefault();
  };

  const blended = picture.ink !== null && !picture.inkOff;
  return (
    <div
      ref={root}
      className={`reader-image-viewer ${handover ? "is-handed" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={picture.alt ? `Picture: ${picture.alt}` : "Picture"}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={() => {
        if (closeOnClick.current) {
          close();
        }
      }}
    >
      <div ref={shade} className="reader-image-viewer-shade" aria-hidden="true" />
      <img
        ref={(element) => {
          image.current = element;
          // Drawn where it is at once (a pinch from the page): React never writes the transform.
          if (element && !element.style.transform && naturalRef.current) {
            draw(viewRef.current);
          }
        }}
        src={picture.src}
        alt={picture.alt}
        draggable={false}
        // Carried over from the page, it must be there on the first frame.
        decoding={handover ? "sync" : "async"}
        className="reader-image-viewer-picture"
        style={{
          width: natural ? natural.width : undefined,
          height: natural ? natural.height : undefined,
          visibility: natural ? "visible" : "hidden"
        }}
        onLoad={(event) => {
          if (naturalRef.current) {
            return;
          }
          const img = event.currentTarget;
          // A picture with no size of its own (some SVG) is given a page's worth.
          const size = { width: img.naturalWidth || 1200, height: img.naturalHeight || 900 };
          naturalRef.current = size;
          setNatural(size);
          draw(fitView(size, room()));
        }}
      />
      <div className="reader-image-viewer-bar reader-panel reader-border" role="toolbar" aria-label="Picture">
        <button type="button" className="reader-mini-control" onClick={() => zoom(1 / ZOOM_STEP, undefined, true)} title="Zoom out (-)" aria-label="Zoom out">
          <UiIcon name="minus" size={16} />
        </button>
        <button ref={label} type="button" className="reader-image-viewer-fit reader-muted" onClick={fit} title="Fit to the window (0)" aria-label="Fit to the window">
          {natural ? `${Math.round(viewRef.current.scale * 100)}%` : "…"}
        </button>
        <button type="button" className="reader-mini-control" onClick={() => zoom(ZOOM_STEP, undefined, true)} title="Zoom in (+)" aria-label="Zoom in">
          <UiIcon name="plus" size={16} />
        </button>
        {picture.ink !== null && (
          <button
            type="button"
            className="reader-notes-action"
            onClick={onToggleInk}
            aria-pressed={blended}
            title={blended ? "In the page, show this picture as it was drawn" : "In the page, let this picture take the page's colour"}
          >
            {blended ? "Show as drawn" : "Blend with page"}
          </button>
        )}
        <button type="button" className="reader-mini-control" onClick={close} title="Close (Esc)" aria-label="Close picture">
          <UiIcon name="close" size={16} />
        </button>
      </div>
    </div>
  );
};
