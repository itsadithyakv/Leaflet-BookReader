/**
 * When a scene's frame loop takes every frame, and when it looks in only now
 * and then.
 *
 * Pip's house stepped her every frame the display gave, 60 to 120 times a
 * second, while she stood still in her room: each one a pass of style and
 * paint for the page with nothing new in it. At rest her day goes by the
 * clock (the next free moment, a look at her temper, the night's checks), and
 * a look four times a second keeps it; what moves (a walk, a fall, the hand,
 * the ball, a picture swinging) takes every frame again, at once.
 */

/** How often a scene at rest looks in on itself (ms). */
export const REST_LOOK_MS = 250;

/** What Pip in her house does from frame to frame: walks, falls, hangs from the hand, plays catch, hops into bed, is stroked. */
export const HOUSE_MOVING_PHASES: ReadonlySet<string> = new Set(["walk", "fall", "held", "fetch", "carry", "catch", "tuck", "petted"]);

export type HouseMotion = {
  phase: string;
  /** A hand is on her (pressed, maybe about to pick her up or cuddle her). */
  pressed: boolean;
  /** The ball is out: it rolls and bounces by the frame. */
  ball: boolean;
  /** When the pointer last moved over the room (her eyes follow it for a while), or null. */
  pointerAt: number | null;
  /** Something in the furnishings moves (curtains, a picture). */
  furnishing: boolean;
};

/** How long her eyes follow a pointer that has stopped (HouseScene's GAZE_FRESH_MS). */
export const GAZE_FOLLOWS_MS = 2600;

/** Whether the house's loop takes every frame now (else it looks in every `REST_LOOK_MS`). */
export const houseNeedsFrames = (motion: HouseMotion, now: number) =>
  HOUSE_MOVING_PHASES.has(motion.phase) ||
  motion.pressed ||
  motion.ball ||
  motion.furnishing ||
  (motion.pointerAt !== null && now - motion.pointerAt < GAZE_FOLLOWS_MS);

/**
 * A loop that takes frames while `moving()` says so and looks in every
 * `restMs` otherwise; `wake` brings it to frames at once. `step` gets the
 * time (a frame's, or the clock's at a look). Stops while the window is
 * hidden. Returns the stop and the wake.
 */
export const restingLoop = (step: (time: number) => void, moving: (time: number) => boolean, restMs = REST_LOOK_MS) => {
  let raf = 0;
  let timer = 0;
  let ended = false;
  const shown = () => typeof document === "undefined" || document.visibilityState === "visible";
  const schedule = (time: number) => {
    if (ended || raf || timer || !shown()) return;
    if (moving(time)) raf = requestAnimationFrame(frame);
    else timer = window.setTimeout(look, restMs);
  };
  const frame = (time: number) => {
    raf = 0;
    step(time);
    schedule(time);
  };
  const look = () => {
    timer = 0;
    const time = performance.now();
    step(time);
    schedule(time);
  };
  const halt = () => {
    if (raf) cancelAnimationFrame(raf);
    if (timer) window.clearTimeout(timer);
    raf = 0;
    timer = 0;
  };
  const onVisibility = () => {
    if (shown()) wake();
    else halt();
  };
  const wake = () => {
    if (ended || raf || !shown()) return;
    if (timer) {
      window.clearTimeout(timer);
      timer = 0;
    }
    raf = requestAnimationFrame(frame);
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  wake();
  return {
    stop: () => {
      ended = true;
      halt();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    },
    wake
  };
};
