import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Hand, SquareDashed } from "lucide-react";
import { UiIcon } from "../components/UiIcon";
import { useBackLayer } from "../platform/back";
import {
  ZOOM_STEP, clampView, fitView, gestureView, settleView, wheelFactor, zoomAt, fromMiddle, centreOf,
  type Point, type Size, type ZoomView
} from "../readers/imageZoom";
import { MAX_GROUP, MAX_LABEL, newCardId, pictureInput, type CardInput, type CardPlace, type PictureCard, type PictureRef, type Rect } from "./cards";
import { boxAt, boxBetween, cropAround, isBox, keepStill, moveBox, toPicture, toStage, visiblePart } from "./pictureBoxes";
import "./study.css";

type Drawn = { id: string | null; rect: Rect; label: string };

type PictureCardMakerProps = {
  /** What to draw on (the page's copy of the picture, or a PDF page drawn for this). */
  src: string;
  alt: string;
  picture: PictureRef;
  place: CardPlace;
  /** A picture's cards being edited: their boxes to start with. */
  existing?: PictureCard[];
  /** Keeps the boxes as cards (and removes those taken off); rejects when it could not. */
  onSave: (save: CardInput[], remove: string[]) => Promise<void>;
  onClose: () => void;
};

/**
 * Picture cards: boxes drawn over the labels of a picture (an anatomy plate,
 * a map), each box a card that covers it in review. Over the whole window,
 * as the picture viewer is; a pinch, two fingers, the wheel and + and - zoom
 * and move it as there. One finger (or the mouse) draws a box; a box pressed
 * is chosen, and dragged moves it. The hand turns one finger into a drag of
 * the picture instead, for a mouse with no wheel.
 *
 * Boxes are kept as fractions of the picture, so they fit it at any zoom and
 * on any screen. Cheap on a slow phone: a gesture redraws at most once a
 * frame, and only the picture and a few boxes.
 */
export const PictureCardMaker = ({ src, alt, picture, place, existing = [], onSave, onClose }: PictureCardMakerProps) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState<Size>({ width: window.innerWidth, height: window.innerHeight });
  const [natural, setNatural] = useState<Size | null>(null);
  const [view, setView] = useState<ZoomView>({ scale: 1, x: 0, y: 0 });
  const [boxes, setBoxes] = useState<Drawn[]>(() =>
    [...existing].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((card) => ({ id: card.id, rect: card.mask, label: card.label }))
  );
  const [chosen, setChosen] = useState<number>(-1);
  const [panning, setPanning] = useState(false);
  const [sketch, setSketch] = useState<Rect | null>(null);
  const [info, setInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const titleId = useId();
  const labelId = useId();
  const group = useRef(existing[0]?.group ?? newCardId().slice(5)).current;

  // What the pointers do, between frames (state is written once a frame).
  const viewRef = useRef(view);
  viewRef.current = view;
  const naturalRef = useRef(natural);
  naturalRef.current = natural;
  const stageSizeRef = useRef(stage);
  stageSizeRef.current = stage;
  const pointers = useRef(new Map<number, Point>());
  type Gesture =
    | { kind: "zoom"; start: ZoomView; from: Point[] }
    | { kind: "draw"; from: Point; to: Point }
    | { kind: "move"; index: number; origin: Point; delta: Point; start: Rect };
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);

  useBackLayer(true, onClose);

  // The stage's size, now and whenever the window turns or resizes.
  useLayoutEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    const measure = () => {
      const next = { width: node.clientWidth, height: node.clientHeight };
      const before = stageSizeRef.current;
      if (next.width === before.width && next.height === before.height) return;
      // The picture stays where it is on the screen (the bar grew a row, the phone turned):
      // a box drawn next goes where the reader saw the label.
      if (naturalRef.current) setView((now) => clampView(keepStill(now, before, next), naturalRef.current as Size, next));
      stageSizeRef.current = next;
      setStage(next);
    };
    measure();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    watch?.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      watch?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    stageRef.current?.focus({ preventScroll: true });
    return () => window.cancelAnimationFrame(frame.current);
  }, []);

  // The wheel zooms about the pointer. Bound by hand: React's wheel listener is passive.
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const size = naturalRef.current;
      if (!size) return;
      const box = node.getBoundingClientRect();
      const at = { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 };
      setView((now) => zoomAt(now, wheelFactor(event.deltaY, event.deltaMode, event.ctrlKey), size, stageSizeRef.current, at));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  /** A pointer in the stage's own space: from the inside of its border, where the picture and boxes are placed. */
  const local = (event: { clientX: number; clientY: number }): Point => {
    const node = stageRef.current;
    const box = node?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0) - (node?.clientLeft ?? 0), y: event.clientY - (box?.top ?? 0) - (node?.clientTop ?? 0) };
  };
  const onPicture = (point: Point) => (naturalRef.current ? toPicture(point, stageSizeRef.current, viewRef.current, naturalRef.current) : point);

  const beginZoom = () => {
    const points = [...pointers.current.values()].map((point) => fromMiddle(point, stageSizeRef.current));
    gesture.current = { kind: "zoom", start: viewRef.current, from: points };
    setSketch(null);
  };

  const follow = () => {
    frame.current = 0;
    const now = gesture.current;
    const size = naturalRef.current;
    if (!now || !size) return;
    const points = [...pointers.current.values()];
    if (now.kind === "zoom") {
      const to = points.map((point) => fromMiddle(point, stageSizeRef.current));
      if (to.length === now.from.length) setView(gestureView(now.start, now.from, to, size, stageSizeRef.current));
    } else if (now.kind === "draw") {
      setSketch(boxBetween(now.from, now.to));
    } else {
      const { delta, index: moving, start } = now;
      setBoxes((list) => list.map((box, index) => (index === moving ? { ...box, rect: moveBox(start, delta.x, delta.y) } : box)));
    }
  };
  const schedule = () => {
    if (!frame.current) frame.current = window.requestAnimationFrame(follow);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!natural || (event.pointerType === "mouse" && event.button !== 0)) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Already let go.
    }
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size > 1 || panning) {
      // Two fingers (or the hand): the picture moves, whatever one finger began.
      if (gesture.current?.kind === "move") {
        const { index, start } = gesture.current;
        setBoxes((list) => list.map((box, at) => (at === index ? { ...box, rect: start } : box)));
      }
      beginZoom();
      return;
    }
    const at = onPicture(point);
    const hit = boxAt(at, boxes.map((box) => box.rect));
    if (hit >= 0) {
      setChosen(hit);
      gesture.current = { kind: "move", index: hit, origin: at, delta: { x: 0, y: 0 }, start: boxes[hit].rect };
      return;
    }
    gesture.current = { kind: "draw", from: at, to: at };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    const now = gesture.current;
    if (now?.kind === "draw") {
      now.to = onPicture(point);
    } else if (now?.kind === "move") {
      const at = onPicture(point);
      now.delta = { x: at.x - now.origin.x, y: at.y - now.origin.y };
    }
    schedule();
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    window.cancelAnimationFrame(frame.current);
    frame.current = 0;
    const now = gesture.current;
    const size = naturalRef.current;
    if (now?.kind === "zoom") {
      if (pointers.current.size > 0) {
        beginZoom();
        return;
      }
      gesture.current = null;
      if (size) {
        const last = local(event);
        setView((current) => settleView(current, size, stageSizeRef.current, fromMiddle(centreOf([last]), stageSizeRef.current)));
      }
      return;
    }
    gesture.current = null;
    if (now?.kind === "draw") {
      const rect = boxBetween(now.from, onPicture(local(event)));
      setSketch(null);
      if (!isBox(rect)) {
        // A tap beside every box: none is chosen.
        setChosen(-1);
        return;
      }
      if (boxes.length >= MAX_GROUP) {
        setSaid(`A picture can have ${MAX_GROUP} boxes at most.`);
        return;
      }
      setBoxes((list) => [...list, { id: null, rect, label: "" }]);
      setChosen(boxes.length);
      setSaid(null);
    } else if (now?.kind === "move") {
      follow();
    }
  };

  const zoom = (factor: number) => natural && setView((now) => zoomAt(now, factor, natural, stage));
  const fit = () => natural && setView(fitView(natural, stage));
  const removeChosen = () => {
    if (chosen < 0) return;
    setBoxes((list) => list.filter((_, index) => index !== chosen));
    setChosen(-1);
  };

  const save = async () => {
    if (boxes.length === 0 || busy) return;
    setBusy(true);
    setSaid(null);
    const rects = boxes.map((box) => box.rect);
    // A PDF's page is shown cut to what the reader was looking at and every box; a book's picture whole.
    const crop = picture.kind === "pdf" && natural ? cropAround(rects, visiblePart(stageSizeRef.current, viewRef.current, natural)) : null;
    const inputs = boxes.map((box) => pictureInput(place, picture, box.rect, box.label, group, crop, box.id ?? undefined));
    const kept = new Set(boxes.map((box) => box.id).filter(Boolean));
    const removed = existing.map((card) => card.id).filter((id) => !kept.has(id));
    try {
      await onSave(inputs, removed);
    } catch {
      setSaid("Those cards couldn't be kept. Try again.");
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const typing = (event.target as HTMLElement).tagName === "INPUT";
    if (event.key === "Escape") {
      event.preventDefault();
      if (chosen >= 0 && !typing) setChosen(-1);
      else onClose();
    } else if (typing) {
      if (event.key === "Enter") (event.target as HTMLInputElement).blur();
    } else if ((event.key === "Delete" || event.key === "Backspace") && chosen >= 0) {
      event.preventDefault();
      removeChosen();
    } else if (event.key === "+" || event.key === "=") {
      zoom(ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      zoom(1 / ZOOM_STEP);
    } else if (event.key === "0") {
      fit();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      void save();
    }
  };

  const shown = natural ? toStage({ left: 0, top: 0, width: 1, height: 1 }, stage, view, natural) : null;
  const chosenBox = chosen >= 0 ? boxes[chosen] : null;

  return (
    <div className="study-picture-maker" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <h2 id={titleId} className="sr-only">
        Make picture cards{alt ? `: ${alt}` : ""}
      </h2>
      <div
        ref={stageRef}
        className={`study-picture-stage ${panning ? "is-panning" : ""}`}
        tabIndex={-1}
        aria-label="The picture: drag to draw a box over a label"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="study-picture-image"
          style={
            natural && shown
              ? { left: shown.left, top: shown.top, width: shown.width, height: shown.height, visibility: "visible" }
              : { visibility: "hidden" }
          }
          onLoad={(event) => {
            const size = { width: event.currentTarget.naturalWidth || 1200, height: event.currentTarget.naturalHeight || 900 };
            setNatural(size);
            setView(fitView(size, stageSizeRef.current));
          }}
        />
        {natural &&
          boxes.map((box, index) => {
            const at = toStage(box.rect, stage, view, natural);
            return (
              <div
                key={box.id ?? `new-${index}`}
                className="study-picture-box"
                data-chosen={index === chosen || undefined}
                style={{ left: at.left, top: at.top, width: at.width, height: at.height }}
                aria-hidden="true"
              >
                <span className="study-picture-box-number">{index + 1}</span>
              </div>
            );
          })}
        {natural && sketch && (
          <div className="study-picture-box is-sketch" aria-hidden="true" style={toStage(sketch, stage, view, natural)} />
        )}
      </div>

      <div className="study-picture-bar" role="toolbar" aria-label="Picture cards">
        <div className="study-picture-tools">
          <button
            type="button"
            className="study-picture-key"
            aria-pressed={!panning}
            onClick={() => setPanning(false)}
            title="Draw boxes (one finger draws, two move the picture)"
            aria-label="Draw boxes"
          >
            <SquareDashed size={17} aria-hidden="true" />
          </button>
          <button type="button" className="study-picture-key" aria-pressed={panning} onClick={() => setPanning(true)} title="Move the picture" aria-label="Move the picture">
            <Hand size={17} aria-hidden="true" />
          </button>
          <button type="button" className="study-picture-key" onClick={() => zoom(1 / ZOOM_STEP)} title="Zoom out (-)" aria-label="Zoom out">
            <UiIcon name="minus" size={16} />
          </button>
          <button type="button" className="study-picture-key is-wide" onClick={fit} title="Fit to the window (0)" aria-label="Fit to the window">
            {natural ? `${Math.round(view.scale * 100)}%` : "…"}
          </button>
          <button type="button" className="study-picture-key" onClick={() => zoom(ZOOM_STEP)} title="Zoom in (+)" aria-label="Zoom in">
            <UiIcon name="plus" size={16} />
          </button>
          <button
            type="button"
            className="study-picture-key"
            onClick={() => setInfo((open) => !open)}
            aria-expanded={info}
            title="How picture cards work"
            aria-label="How picture cards work"
          >
            <UiIcon name="info" size={16} />
          </button>
        </div>

        {info && (
          <p className="study-picture-info">
            Drag over each label to box it; every box is a card. Review covers one box at a time and shows the rest. Pinch or two fingers move
            the picture; press a box to choose it, drag it to move it.
            {picture.kind === "pdf" ? " A card shows the part of the page in view when you make it (zoom in on the figure first), and all its boxes." : ""}
          </p>
        )}

        <div className="study-picture-chosen">
          {chosenBox ? (
            <>
              <label htmlFor={labelId} className="study-picture-count">
                Box {chosen + 1}
              </label>
              <input
                id={labelId}
                className="study-picture-label"
                value={chosenBox.label}
                maxLength={MAX_LABEL}
                placeholder="What's under it (optional)"
                onChange={(event) => {
                  const label = event.target.value;
                  setBoxes((list) => list.map((box, index) => (index === chosen ? { ...box, label } : box)));
                }}
              />
              <button type="button" className="study-picture-key" onClick={removeChosen} title="Remove this box (Delete)" aria-label={`Remove box ${chosen + 1}`}>
                <UiIcon name="trash" size={16} />
              </button>
            </>
          ) : (
            <span className="study-picture-count" role="status">
              {said ?? (boxes.length === 0 ? "No boxes yet" : `${boxes.length} ${boxes.length === 1 ? "box" : "boxes"}`)}
            </span>
          )}
        </div>

        <div className="study-picture-end">
          <button type="button" className="study-picture-key is-text" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="study-picture-key is-text is-primary"
            onClick={() => void save()}
            disabled={boxes.length === 0 || busy}
            title="Keep the boxes as cards (Ctrl+Enter)"
          >
            {existing.length > 0 ? "Save" : boxes.length > 1 ? `Make ${boxes.length} cards` : "Make card"}
          </button>
        </div>
      </div>
      {/* Said after a save fails, or past the limit, where it can be seen with a box chosen. */}
      {said && chosenBox && (
        <p className="study-picture-said" role="alert">
          {said}
        </p>
      )}
    </div>
  );
};
