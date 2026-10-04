import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { UiIcon } from "../components/UiIcon";
import { ZOOM_STEP, clampView, fitView, panBy, zoomAt, type Size, type ZoomView } from "./imageZoom";
import "./imageViewer.css";

export type ViewedPicture = {
  /** The picture's address as the book's page has it (epub.js's own copy): nothing is read again. */
  src: string;
  alt: string;
  /** Blended into the page there ("title" or "art", see inkImages), or not an ink picture at all. */
  ink: string | null;
  /** The reader has it shown as drawn in the page. */
  inkOff: boolean;
};

type ImageViewerProps = {
  picture: ViewedPicture;
  /** Blend with the page, or show as drawn there: what a click on an ink picture used to do. */
  onToggleInk: () => void;
  onClose: () => void;
};

/**
 * A picture from the book (a map, an illustration) large over the page:
 * fitted to the window, zoomed with the wheel, a pinch or + and -, dragged to
 * move, closed with Escape or a click beside it. Always shown as drawn.
 */
export const ImageViewer = ({ picture, onToggleInk, onClose }: ImageViewerProps) => {
  const root = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [view, setView] = useState<ZoomView>({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const naturalRef = useRef<Size | null>(null);
  naturalRef.current = natural;
  // Fingers or the mouse on the picture: one drags, two pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(false);
  const [dragging, setDragging] = useState(false);

  const room = (): Size => ({ width: root.current?.clientWidth ?? window.innerWidth, height: root.current?.clientHeight ?? window.innerHeight });
  const change = (next: (view: ZoomView, picture: Size, room: Size) => ZoomView) => {
    const size = naturalRef.current;
    if (size) {
      setView(next(viewRef.current, size, room()));
    }
  };
  const zoom = (factor: number, at?: { x: number; y: number }) => change((current, size, space) => zoomAt(current, factor, size, space, at));
  const fit = () => change((_, size, space) => fitView(size, space));

  // Focus leaves the book for the viewer, so its keys come here.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onResize = () => change((current, size, space) => clampView(current, size, space));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The wheel zooms about the pointer. Bound by hand: React's wheel listener
  // is passive, and the page behind must not scroll.
  useEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoom(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, {
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
      onClose();
    } else if (key === "+" || key === "=") {
      zoom(ZOOM_STEP);
    } else if (key === "-" || key === "_") {
      zoom(1 / ZOOM_STEP);
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

  const spread = () => {
    const [a, b] = Array.from(pointers.current.values());
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const blended = picture.ink !== null && !picture.inkOff;
  const percent = natural ? Math.round(view.scale * 100) : null;
  return (
    <div
      ref={root}
      className="reader-image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={picture.alt ? `Picture: ${picture.alt}` : "Picture"}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        // A click on the backdrop closes; one that ended a drag does not.
        if (event.target === event.currentTarget && !moved.current) {
          onClose();
        }
        moved.current = false;
      }}
    >
      <img
        src={picture.src}
        alt={picture.alt}
        draggable={false}
        className={`reader-image-viewer-picture ${dragging ? "is-dragging" : ""}`}
        style={{
          width: natural ? natural.width : undefined,
          height: natural ? natural.height : undefined,
          transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          visibility: natural ? "visible" : "hidden"
        }}
        onLoad={(event) => {
          const image = event.currentTarget;
          // A picture with no size of its own (some SVG) is given a page's worth.
          const size = { width: image.naturalWidth || 1200, height: image.naturalHeight || 900 };
          setNatural(size);
          setView(fitView(size, room()));
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          moved.current = false;
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const before = pointers.current.get(event.pointerId);
          if (!before) {
            return;
          }
          const apart = spread();
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size >= 2) {
            const now = spread();
            if (apart > 0 && now > 0) {
              zoom(now / apart);
            }
            moved.current = true;
            return;
          }
          const dx = event.clientX - before.x;
          const dy = event.clientY - before.y;
          if (Math.abs(dx) + Math.abs(dy) > 0) {
            moved.current = moved.current || Math.abs(dx) + Math.abs(dy) > 2;
            change((current, size, space) => panBy(current, dx, dy, size, space));
          }
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          setDragging(pointers.current.size > 0);
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          setDragging(pointers.current.size > 0);
        }}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={() => (natural && view.scale > fitView(natural, room()).scale * 1.05 ? fit() : zoom(2))}
      />
      <div className="reader-image-viewer-bar reader-panel reader-border" role="toolbar" aria-label="Picture" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="reader-mini-control" onClick={() => zoom(1 / ZOOM_STEP)} title="Zoom out (-)" aria-label="Zoom out">
          <UiIcon name="minus" size={16} />
        </button>
        <button type="button" className="reader-image-viewer-fit reader-muted" onClick={fit} title="Fit to the window (0)" aria-label="Fit to the window">
          {percent === null ? "…" : `${percent}%`}
        </button>
        <button type="button" className="reader-mini-control" onClick={() => zoom(ZOOM_STEP)} title="Zoom in (+)" aria-label="Zoom in">
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
        <button type="button" className="reader-mini-control" onClick={onClose} title="Close (Esc)" aria-label="Close picture">
          <UiIcon name="close" size={16} />
        </button>
      </div>
    </div>
  );
};
