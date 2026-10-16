import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import type { Rect } from "./geometry";
import "./onboarding.css";

/** Milliseconds the circle takes to close, and again to open: a quarter of a second in all. */
const HALF_MS = 130;
/** The circle's size goes in this many steps: chunky, like the picture, not a smooth zoom. */
const STEPS = 7;

type Iris = { id: number; closeAt: { x: number; y: number }; openAt: { x: number; y: number } | null; swap: () => void };

const useIris = create<{ iris: Iris | null; set: (iris: Iris | null) => void }>((set) => ({ iris: null, set: (iris) => set({ iris }) }));

const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

const middleOf = (rect: Rect | null | undefined) => (rect ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } : null);
let ids = 0;

/**
 * Through the burrow's door: the page closes to a circle on the door, the
 * other side comes up, and opens out from it again. In: closes on the door
 * and opens in the middle of the house. Out: closes on the middle and opens
 * on the door, where Pip is stepping out. With reduced motion, a cut.
 */
export const throughDoor = (way: "in" | "out", swap: () => void, door: Rect | null | undefined) => {
  if (reducedMotion() || typeof window === "undefined") {
    swap();
    return;
  }
  const middle = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
  const at = middleOf(door);
  useIris.getState().set({ id: ++ids, closeAt: way === "in" ? (at ?? middle) : middle, openAt: way === "in" ? middle : at, swap });
};

/** The circle itself, over everything: mounted once on Pip's page. */
export const DoorIris = () => {
  const iris = useIris((state) => state.iris);
  const [shown, setShown] = useState<{ x: number; y: number; r: number } | null>(null);
  const swapped = useRef(0);
  useEffect(() => {
    if (!iris) {
      setShown(null);
      return;
    }
    const far = Math.hypot(window.innerWidth, window.innerHeight);
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const gone = now - started;
      const closing = gone < HALF_MS;
      if (!closing && swapped.current !== iris.id) {
        swapped.current = iris.id;
        iris.swap();
      }
      if (gone >= HALF_MS * 2) {
        useIris.getState().set(null);
        return;
      }
      const along = closing ? 1 - gone / HALF_MS : (gone - HALF_MS) / HALF_MS;
      // To a step, and to the whole pixel.
      const step = Math.round(along * STEPS) / STEPS;
      const at = closing ? iris.closeAt : (iris.openAt ?? iris.closeAt);
      const reach = Math.max(far - Math.min(at.x, at.y), Math.hypot(Math.max(at.x, window.innerWidth - at.x), Math.max(at.y, window.innerHeight - at.y)));
      setShown({ x: at.x, y: at.y, r: Math.round(step * reach) });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [iris]);
  if (!shown) return null;
  return <div className="pip-door-iris" aria-hidden="true" style={{ background: `radial-gradient(circle at ${shown.x}px ${shown.y}px, transparent ${shown.r}px, var(--hud-line) ${shown.r}px)` }} />;
};
