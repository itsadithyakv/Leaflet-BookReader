import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { playSound } from "../../../../pip/sound";
import { Sprite } from "./Sprite";

/*
 * Acorns coming in, seen (the owner, 2026-10-19: "add collection animations"):
 * whatever brings acorns (the oak, a parcel, Pip's basket, the list, a
 * trophy, the club, a raid) sends a few of them in an arc to the acorn count
 * at the top, and the count goes up as they land, with a little jump. Spent,
 * the count ticks down with a small drop. In Pip's pixel paper: the acorns
 * are the camp's own sprite, at whole device pixels all the way, so a small
 * thing never shimmers; only transform and opacity move. Nothing of it with
 * reduced motion: the count is simply the new one.
 */

/** How long an acorn takes to reach the count, and how far apart they set off. */
export const TRAIL_MS = 560;
export const TRAIL_GAP_MS = 70;
/** The count's own going up (or down), at the least. */
export const COUNT_MS = 320;

export type ClientPoint = { x: number; y: number };

/** How many acorns are seen to fly for so many brought in: one for a few, six at the most. */
export const trailSize = (got: number) => (got <= 0 ? 0 : Math.min(6, 1 + Math.floor(got / 6)));

/** When the first and the last of so many acorns, set off now, land on the count (ms from now). */
export const trailLands = (count: number) => ({ first: TRAIL_MS, last: TRAIL_MS + Math.max(0, count - 1) * TRAIL_GAP_MS });

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Where an acorn on its way is, `t` (0 to 1) of the way along: eased, in an
 * arc that rises `lift` CSS pixels over the straight line, and to the whole
 * device pixel (`dpr` of them to the CSS pixel), never between.
 */
export const trailPoint = (from: ClientPoint, to: ClientPoint, t: number, lift: number, dpr = 1): ClientPoint => {
  const along = Math.max(0, Math.min(1, t));
  const eased = easeInOut(along);
  const x = from.x + (to.x - from.x) * eased;
  const y = from.y + (to.y - from.y) * eased - Math.sin(along * Math.PI) * lift;
  const px = Math.max(1, dpr);
  return { x: Math.round(x * px) / px, y: Math.round(y * px) / px };
};

/** The figure the count shows `t` (0 to 1) of the way from one to the other: whole acorns, quick at first. */
export const countAt = (from: number, to: number, t: number) => {
  const along = Math.max(0, Math.min(1, t));
  return Math.round(from + (to - from) * (1 - (1 - along) ** 2));
};

const stillOnly = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** Acorns into the larder, heard: a patter of them, more for more, the first `after` ms from now (as they land). */
export const acornsSound = (count: number, after = 0) => {
  const drops = Math.min(4, 1 + Math.floor(count / 12));
  for (let drop = 0; drop < drops; drop++) playSound("coin", { delay: Math.max(0, after) + drop * 85, pitch: 1 + drop * 0.1 });
};

/** When acorns on their way will land on the count (performance.now() times), for it to go up as they do. */
export type AcornCue = { first: number; last: number } | null;

/** A small move on an element, by the Web Animations API where there is one (transform and opacity only). */
const nudge = (element: Element | null, frames: Keyframe[], duration: number, easing = "ease-out") => {
  if (!element || stillOnly() || typeof (element as HTMLElement).animate !== "function") return;
  (element as HTMLElement).animate(frames, { duration, easing });
};

/** The count jumps a little as acorns land on it. */
export const bumpCount = (element: Element | null) =>
  nudge(element, [{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-3px) scale(1.2)", offset: 0.35 }, { transform: "translateY(0) scale(1)" }], 320, "cubic-bezier(0.3, 1.7, 0.5, 1)");
/** And sinks a little as they are spent. */
export const dropCount = (element: Element | null) =>
  nudge(element, [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(3px)", opacity: 0.6, offset: 0.4 }, { transform: "translateY(0)", opacity: 1 }], 300);
/** The larder is full: its count gives a little shake of its head. */
export const shakeFull = (element: Element | null) =>
  nudge(element, [{ transform: "translateX(0)" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(-2px)" }, { transform: "translateX(0)" }], 380);

/**
 * The acorn count at the top of the camp: the figure as it goes up or down,
 * rather than as it is at once. Going up, it waits for what is on its way
 * (`cue`, set by whoever sent it) and counts up as it lands; any other
 * change is counted at once. Its own state, so the camp is not drawn again
 * for every figure.
 */
export const AcornCount = ({ value, cue, className = "" }: { value: number; cue: React.MutableRefObject<AcornCue>; className?: string }) => {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const strongRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    const show = (figure: number) => {
      shownRef.current = figure;
      setShown(figure);
    };
    if (stillOnly()) {
      cue.current = null;
      show(value);
      return;
    }
    const up = value > from;
    let frame = 0;
    let begin = -1;
    let end = 0;
    let moved = false;
    const step = (time: number) => {
      if (begin < 0) {
        // Read on the first frame, not at once: what sent the acorns may say so just after the camp has changed.
        const lands = up ? cue.current : null;
        cue.current = null;
        begin = lands && lands.first > time ? lands.first : time;
        end = begin + Math.max(COUNT_MS, lands ? lands.last - lands.first + 120 : COUNT_MS);
      }
      if (time >= begin && !moved) {
        moved = true;
        (up ? bumpCount : dropCount)(strongRef.current);
      }
      if (time >= begin) {
        const figure = countAt(from, value, (time - begin) / (end - begin));
        if (figure !== shownRef.current) show(figure);
        if (time >= end) {
          show(value);
          return;
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // Where frames are not painted (a hidden page), the figure is still the right one soon after.
    const sure = window.setTimeout(() => {
      cancelAnimationFrame(frame);
      show(value);
    }, TRAIL_MS + 6 * TRAIL_GAP_MS + COUNT_MS + 600);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(sure);
    };
  }, [value, cue]);
  return (
    <strong ref={strongRef} className={`pip-acorn-count ${className}`}>
      {shown}
    </strong>
  );
};

type Flying = { id: number; from: ClientPoint; to: ClientPoint; start: number; lift: number };
export type AcornTrailsHandle = {
  /** Sends `got` acorns' worth from one place on the screen to another; says when they land, or null when nothing flies. */
  send: (from: ClientPoint, to: ClientPoint, got: number) => AcornCue;
};

/**
 * The acorns on their way to the count: laid over the whole page (they fly
 * out of the picture to the top of it), and painted by one loop of frames,
 * each acorn moved by its transform to the whole device pixel.
 */
export const AcornTrails = forwardRef<AcornTrailsHandle>(function AcornTrails(_, ref) {
  const [flying, setFlying] = useState<Flying[]>([]);
  const nodes = useRef(new Map<number, HTMLSpanElement>());
  const next = useRef(1);
  useImperativeHandle(ref, () => ({
    send(from, to, got) {
      const count = trailSize(got);
      if (count === 0 || stillOnly()) return null;
      const now = performance.now();
      const reach = Math.hypot(to.x - from.x, to.y - from.y);
      const lift = Math.max(24, Math.min(90, reach * 0.28));
      const sent = Array.from({ length: count }, (_, index) => ({
        id: next.current++,
        // A little apart where they set off, so they read as several.
        from: { x: from.x + ((index % 3) - 1) * 5, y: from.y - (index % 2) * 3 },
        to,
        start: now + index * TRAIL_GAP_MS,
        lift: lift + (index % 3) * 6
      }));
      setFlying((was) => [...was.filter((entry) => performance.now() - entry.start < TRAIL_MS), ...sent]);
      const lands = trailLands(count);
      return { first: now + lands.first, last: now + lands.last };
    }
  }));
  useEffect(() => {
    if (flying.length === 0) return;
    let frame = 0;
    const paint = (time: number) => {
      const dpr = window.devicePixelRatio || 1;
      let left = 0;
      for (const entry of flying) {
        const node = nodes.current.get(entry.id);
        const t = (time - entry.start) / TRAIL_MS;
        if (t < 1) left++;
        if (!node) continue;
        const at = trailPoint(entry.from, entry.to, t, entry.lift, dpr);
        node.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`;
        // In as it sets off, and gone as it lands.
        node.style.opacity = t <= 0 || t >= 1 ? "0" : String(Math.min(1, t / 0.12, (1 - t) / 0.12));
      }
      if (left > 0) frame = requestAnimationFrame(paint);
      else setFlying([]);
    };
    frame = requestAnimationFrame(paint);
    // Should frames stop (a hidden page), the acorns are let go all the same.
    const sure = window.setTimeout(() => setFlying([]), TRAIL_MS + 8 * TRAIL_GAP_MS + 800);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(sure);
    };
  }, [flying]);
  if (flying.length === 0 || typeof document === "undefined") return null;
  return createPortal(
    <div className="pip-acorn-trails" aria-hidden="true">
      {flying.map((entry) => (
        <span
          key={entry.id}
          className="pip-acorn-trail"
          ref={(node) => {
            if (node) nodes.current.set(entry.id, node);
            else nodes.current.delete(entry.id);
          }}
        >
          <Sprite name="acorn" box={16} />
        </span>
      ))}
    </div>,
    document.body
  );
});
