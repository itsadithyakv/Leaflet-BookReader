import { useEffect, useRef, type RefObject } from "react";
import { pipEntry, pipExit, type CampLook } from "../arcade/base/scene";
import { useCoachStore } from "./coachStore";
import { doorBox, inDoor, sceneRectOf, sceneToScreen, whole } from "./geometry";
import { STEP, doorOpen } from "./steps";
import { welcome } from "./welcomeApi";

const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** When the reader last came out of the house: a camp that comes up just after has Pip step out of her door. */
let cameOutAt = 0;
export const comingOut = () => {
  cameOutAt = performance.now();
};

/** How the glow on the door goes: four brightnesses up and four down, a step at a time (it never moves, it only glows). */
const GLOW_STEPS = [0.35, 0.55, 0.75, 1, 1, 0.75, 0.55, 0.35];
export const glowAt = (seconds: number) => GLOW_STEPS[Math.floor(seconds * 6) % GLOW_STEPS.length];

/**
 * The burrow as the way into Pip's house. A single tap on its door goes in
 * (the rest of the burrow still chooses it, and twice on it still goes in);
 * so do the keys that say so. Going in, Pip walks to her door and in, and
 * the door opens for her; then the house. Coming out, she steps out of it.
 * With reduced motion it is a cut.
 *
 * The door glows to be found, until this reader has been in by it (and
 * while the tour points at it). Lives in the camp's picture (BaseScreen):
 * it hands the picture what to draw, and says when a tap was the door's.
 */
export const useBurrowDoor = ({
  look,
  onInside,
  canvasRef,
  sky
}: {
  look: CampLook | null;
  onInside?: () => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  sky: number;
}) => {
  /** The picture's clock (seconds, as `extras.time`) when Pip set off for her door; null when she has not. */
  const entering = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  /** And when she came out, if the camp came up as the reader came out of the house. */
  const cameOut = useRef<number | null>(performance.now() - cameOutAt < 1500 ? performance.now() / 1000 : null);
  const lookRef = useRef(look);
  lookRef.current = look;
  const insideRef = useRef(onInside);
  insideRef.current = onInside;
  const skyRef = useRef(sky);
  skyRef.current = sky;

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );
  useEffect(() => {
    const out = cameOut.current;
    const seen = lookRef.current;
    if (out === null || !seen) return;
    // Once she is out and on her round again, the picture forgets she came out.
    const done = window.setTimeout(() => (cameOut.current = null), pipExit(seen, out).total * 1000 + 50);
    return () => window.clearTimeout(done);
  }, []);

  /** Where the door is on the screen just now (the way back out opens there). */
  const doorOnScreen = () => {
    const canvas = canvasRef.current;
    const seen = lookRef.current;
    if (!canvas || !seen) return null;
    return whole(sceneToScreen(doorBox(seen.spots.burrow), sceneRectOf(canvas), skyRef.current));
  };

  const go = () => {
    const seen = lookRef.current;
    if (!insideRef.current || entering.current !== null) return;
    // Out in the meadow (or before the picture is up) there is no door in sight to walk to: straight in.
    if (!seen || seen.area !== "camp") {
      insideRef.current();
      return;
    }
    const coach = useCoachStore.getState();
    coach.knowDoor();
    coach.setDoorAt(doorOnScreen());
    if (reducedMotion()) {
      insideRef.current();
      return;
    }
    const since = performance.now() / 1000;
    entering.current = since;
    cameOut.current = null;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      entering.current = null;
      insideRef.current?.();
    }, pipEntry(seen, since).total * 1000);
  };
  const goRef = useRef(go);
  goRef.current = go;

  // A key that means "in through the door" (the corner's, the burrow card's) has Pip walk in, as a tap on it does.
  useEffect(() => useCoachStore.subscribe((state, before) => state.enterAsked !== before.enterAsked && goRef.current()), []);

  return {
    go,
    /** A tap on the picture: whether it was on the door, and so is going in. */
    tap: (at: { x: number; y: number }) => {
      const seen = lookRef.current;
      const { step } = useCoachStore.getState();
      const demo = welcome.replaying();
      if (!seen || seen.area !== "camp" || !insideRef.current || !doorOpen(step, demo) || !inDoor(seen.spots.burrow, at.x, at.y)) return false;
      go();
      return true;
    },
    /** What the picture draws for the door, at its clock (`time`, seconds; null for a still). */
    extras: (time: number | null) => {
      const { doorKnown, step } = useCoachStore.getState();
      const demo = welcome.replaying();
      const lit = step === STEP.door || (!demo && step === STEP.hat) || (step === null && !doorKnown);
      return {
        entering: entering.current,
        cameOut: cameOut.current,
        doorGlow: lit && entering.current === null ? (time === null ? 1 : glowAt(time)) : 0
      };
    }
  };
};
