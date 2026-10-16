import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PipSay, type PipSayTail } from "../../PipSay";
import { letThrough, pad, placeBubble, placePaw, union, type Placement, type Rect } from "./geometry";
import "./onboarding.css";

/** The paw's own pixels: a little green paw with a pointing toe, drawn three CSS pixels to its pixel. */
const PAW_PX = 3;
const PAW: readonly string[] = [
  "..11111..",
  ".1222221.",
  "123232321",
  "122222221",
  "122222221",
  ".1222221.",
  "..12221..",
  "...121...",
  "...121...",
  "...131...",
  "....1...."
];
const PAW_W = PAW[0].length * PAW_PX;
const PAW_H = PAW.length * PAW_PX;
const PAW_INK: Record<string, string> = { "1": "#1c261f", "2": "#6aa841", "3": "#b9f0b4" };

const Paw = ({ up }: { up: boolean }) => (
  <svg width={PAW_W} height={PAW_H} viewBox={`0 0 ${PAW[0].length} ${PAW.length}`} shapeRendering="crispEdges" style={up ? { transform: "scaleY(-1)" } : undefined} aria-hidden="true">
    {PAW.flatMap((row, y) =>
      [...row].map((cell, x) => (cell === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={PAW_INK[cell]} />))
    )}
  </svg>
);

const TAIL: Record<Placement["side"], PipSayTail> = { above: "down", below: "up", left: "right", right: "left" };

export type CoachProps = {
  /** The part of the page the tour covers: dimmed, and taps in it kept from the page but for the hole. */
  bounds: Rect;
  /** What is to be tapped, on the screen: lit, outlined, pointed at. Null: nothing in particular. */
  hole: Rect | null;
  /** Whether the rest is dimmed. */
  dim: boolean;
  /** Taps in the hole go through to the page (not in a demo, which only shows). */
  through: boolean;
  /** More places a tap goes through, unlit (the way out of the tab). */
  open?: readonly Rect[];
  /** Taps anywhere else in the bounds: kept from the page; this hears them (Pip's "tap anywhere"). */
  onElsewhere?: () => void;
  /** A tap that went through the hole. */
  onHole?: () => void;
  /** Pip's face, beside her line. */
  face?: ReactNode;
  line: string;
  /** Keys under the line: Next, Skip and so on. */
  keys?: ReactNode;
  /** Things the bubble should not cover besides the hole (an open panel's key). */
  avoid?: readonly Rect[];
  paw?: boolean;
  /** The outline round the hole. */
  ring?: boolean;
  /** Over the page's dialogs (the shop), where the tour only points and keeps nothing from the page. */
  float?: boolean;
};

const pointOf = (event: Event): { x: number; y: number } | null => {
  if ("clientX" in event && typeof (event as MouseEvent).clientX === "number") return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
  const touch = (event as TouchEvent).changedTouches?.[0] ?? (event as TouchEvent).touches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
};

/** A tap the tour makes itself (shutting a panel): let through. */
let passing = false;
export const passThrough = (act: () => void) => {
  passing = true;
  try {
    act();
  } finally {
    passing = false;
  }
};

const BLOCKED = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "touchstart", "touchend", "contextmenu"] as const;

/**
 * One step of Pip's guided session on the screen: the rest of the scene
 * dimmed, what is to be tapped lit with a pixel outline that glows, a paw
 * bobbing a whole pixel at a time beside it, and her one line in her
 * bubble, put where it covers neither. Taps outside the hole never reach
 * the page; the bubble's own keys always work.
 */
export const Coach = ({ bounds, hole, dim, through, open = [], onElsewhere, onHole, face, line, keys, avoid = [], paw = true, ring = true, float = false }: CoachProps) => {
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const sayRef = useRef<HTMLSpanElement | null>(null);
  const [placed, setPlaced] = useState<(Placement & { sayLeft: number; sayWidth: number }) | null>(null);
  const live = useRef({ bounds, hole, through, open, onElsewhere, onHole, float });
  live.current = { bounds, hole, through, open, onElsewhere, onHole, float };

  // Taps: through the hole (and the open places), into the bubble; nowhere else in the bounds.
  useEffect(() => {
    /** What the last press let through the hole landed on. */
    let downOn: EventTarget | null = null;
    const guard = (event: Event) => {
      const now = live.current;
      if (now.float || passing) return;
      if (event.target instanceof Element && event.target.closest(".pip-coach-bubble")) return;
      const point = pointOf(event);
      if (!point) return;
      const inBounds = point.x >= now.bounds.left && point.x < now.bounds.left + now.bounds.width && point.y >= now.bounds.top && point.y < now.bounds.top + now.bounds.height;
      if (!inBounds) return;
      if (now.hole && now.through && letThrough(point, [now.hole])) {
        if (event.type === "pointerdown") {
          downOn = event.target;
          now.onHole?.();
        } else if (event.type === "click" && downOn instanceof Node && event.target instanceof Node && event.target !== downOn && !downOn.contains(event.target)) {
          // A finger's tap on the picture opens a panel under it, and the click the phone sends after it lands on that
          // panel instead (on whatever key is there): it is not let through. Only the thing pressed is tapped.
          event.stopPropagation();
          event.preventDefault();
        }
        return;
      }
      if (letThrough(point, now.open)) return;
      event.stopPropagation();
      if (event.cancelable && event.type !== "pointerdown") event.preventDefault();
      if (event.type === "pointerup") now.onElsewhere?.();
    };
    BLOCKED.forEach((type) => window.addEventListener(type, guard, { capture: true, passive: false }));
    return () => BLOCKED.forEach((type) => window.removeEventListener(type, guard, { capture: true }));
  }, []);

  const pawAt = hole && paw ? placePaw(hole, { width: PAW_W, height: PAW_H }, bounds) : null;
  const pawRect: Rect | null = pawAt ? { left: pawAt.left, top: pawAt.top - PAW_PX, width: PAW_W, height: PAW_H + PAW_PX * 2 } : null;
  const key = `${hole ? [hole.left, hole.top, hole.width, hole.height].join() : "none"}|${[bounds.left, bounds.top, bounds.width, bounds.height].join()}|${line}|${avoid.map((rect) => rect.top).join()}`;

  useLayoutEffect(() => {
    const node = bubbleRef.current;
    if (!node) return;
    const size = { width: node.offsetWidth, height: node.offsetHeight };
    const inside = pad(bounds, -8);
    // With nothing to point at, Pip speaks from the bottom-left corner, out of the way.
    // The paw is part of what is pointed at: the bubble goes beyond it, not round it.
    const pointed = hole && pawRect ? union(hole, pawRect) : hole;
    const target = pointed ?? { left: inside.left + inside.width, top: inside.top, width: 0, height: 0 };
    const at = placeBubble(pad(target, 2), size, inside, avoid, 14);
    const say = sayRef.current;
    const sayLeft = say ? say.offsetLeft : 0;
    const sayWidth = say ? say.offsetWidth : size.width;
    setPlaced((was) => (was && was.left === at.left && was.top === at.top && was.side === at.side && Math.round(was.tailAt) === Math.round(at.tailAt) ? was : { ...at, sayLeft, sayWidth }));
    // The key says when anything that places it has changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The tail points at the middle of the target, along whichever edge of the line it leaves from.
  let tailAt = 50;
  if (placed && hole) {
    if (placed.side === "above" || placed.side === "below") tailAt = Math.max(8, Math.min(92, ((hole.left + hole.width / 2 - placed.left - placed.sayLeft) / Math.max(1, placed.sayWidth)) * 100));
    else tailAt = placed.tailAt;
  }

  return (
    <div className={`pip-coach${float ? " is-float" : ""}`} style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}>
      {dim &&
        (hole ? (
          // The dimming in four pieces round the hole: square, and exactly to the pixel.
          (() => {
            const left = Math.max(0, hole.left - bounds.left);
            const top = Math.max(0, hole.top - bounds.top);
            const right = Math.min(bounds.width, left + hole.width);
            const bottom = Math.min(bounds.height, top + hole.height);
            return [
              { left: 0, top: 0, width: bounds.width, height: top },
              { left: 0, top: bottom, width: bounds.width, height: Math.max(0, bounds.height - bottom) },
              { left: 0, top, width: left, height: bottom - top },
              { left: right, top, width: Math.max(0, bounds.width - right), height: bottom - top }
            ].map((piece, index) => <div key={index} className="pip-coach-scrim" aria-hidden="true" style={piece} />);
          })()
        ) : (
          <div className="pip-coach-scrim" aria-hidden="true" style={{ left: 0, top: 0, width: bounds.width, height: bounds.height }} />
        ))}
      {hole && ring && <div className="pip-coach-ring" aria-hidden="true" style={{ left: hole.left - bounds.left, top: hole.top - bounds.top, width: hole.width, height: hole.height }} />}
      {pawAt && (
        <div className={`pip-coach-paw${pawAt.up ? " is-up" : ""}`} style={{ left: pawAt.left - bounds.left, top: pawAt.top - bounds.top }}>
          <Paw up={pawAt.up} />
        </div>
      )}
      <div
        ref={bubbleRef}
        className="pip-coach-bubble"
        role="dialog"
        aria-label="Pip shows you round"
        style={placed ? { left: placed.left - bounds.left, top: placed.top - bounds.top } : { left: -9999, top: 0 }}
      >
        {face && <span className="pip-coach-face">{face}</span>}
        <PipSay ref={sayRef} key={line} text={line} tail={hole && placed ? TAIL[placed.side] : "left"} tailAt={tailAt} className={hole ? "" : "is-tailless"}>
          {keys}
        </PipSay>
      </div>
    </div>
  );
};
