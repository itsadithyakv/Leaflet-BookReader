/**
 * The camera over the Hollow on a phone: which part of the clearing the
 * screen shows, and how a finger moves it.
 *
 * On a phone held sideways the picture is drawn a little larger than the
 * screen (`PHONE_ZOOM`), so the camp is big enough to tap and there is some
 * of it to either side to go and look at. A drag moves the camera; it goes a
 * little past the edge of the picture, harder the further it goes (the
 * rubber band), and springs back when let go; a flick carries on and slows.
 * A press that has not moved more than `TAP_SLOP` is a tap, and chooses what
 * is under it; one held still for `HOLD_MS` takes hold of it, to move it.
 *
 * All of it in the picture's own pixels (art pixels), from the top left of
 * the whole picture, sky and all; the scene is drawn shifted by the camera
 * (BaseScreen), never laid out again. Nothing here touches the page.
 */

export type Size = { w: number; h: number };
export type Range = { min: number; max: number };
export type Bounds = { x: Range; y: Range };
export type Point = { x: number; y: number };
/** A thing in the picture: its left, top and size, in art pixels. */
export type Box = { x: number; y: number; w: number; h: number };
/** The camera and how fast it is going, in art pixels and art pixels a millisecond. */
export type Glide = { x: number; y: number; vx: number; vy: number };

/** How much larger than the screen the picture is drawn on a phone held sideways. */
export const PHONE_ZOOM = 1.25;
/** CSS pixels a press may move and still be a tap. */
export const TAP_SLOP = 8;
/** How long a press is held still before it takes hold of what is under it. */
export const HOLD_MS = 380;
/** How far past the edge of the picture a drag may take the camera, at most, in CSS pixels. */
export const SLACK_CSS = 44;
/** Two taps this close in time (ms) and place (CSS px) on open ground are a double tap: the camera goes home. */
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_SLOP = 28;
/** How quickly a flick slows (ms for it to fall to a third or so), how quickly the camera is pulled back inside, and eases to where it is sent. */
const FRICTION_MS = 325;
const SPRING_MS = 110;
const EASE_MS = 150;
/** Slower than this (art px a ms) a glide has stopped. */
const STILL = 0.004;

export const clamp = (value: number, range: Range) => Math.max(range.min, Math.min(range.max, value));

/** Where the camera may go along one side: from 0 to as far as leaves the picture's far edge at the screen's; a picture smaller than the screen is held in the middle. */
export const rangeOf = (content: number, view: number): Range => (content >= view ? { min: 0, max: content - view } : { min: (content - view) / 2, max: (content - view) / 2 });

export const boundsOf = (content: Size, view: Size): Bounds => ({ x: rangeOf(content.w, view.w), y: rangeOf(content.h, view.h) });

/** Whether there is anything to move to: the picture is larger than the screen one way or the other. */
export const canPan = (bounds: Bounds) => bounds.x.max - bounds.x.min > 0.5 || bounds.y.max - bounds.y.min > 0.5;

/** How far past an edge the camera shows for a drag that far past it: less and less, never more than `slack`. */
// (Half the finger's way at first, then less: at 0.55 a hard drag past the edge moved it so little on a phone that it
// read as a wall, not a band.)
export const band = (over: number, slack: number) => (slack <= 0 || over <= 0 ? 0 : slack * (1 - 1 / (over / slack + 1)));

/** Where a drag that would take the camera to `value` leaves it: there, inside the range; past it, held back by the band. */
export const rubber = (value: number, range: Range, slack: number) => {
  if (value < range.min) return range.min - band(range.min - value, slack);
  if (value > range.max) return range.max + band(value - range.max, slack);
  return value;
};

/** Whether a press that has moved this far (CSS px) is a drag, not a tap. */
export const isDrag = (dx: number, dy: number, slop = TAP_SLOP) => Math.hypot(dx, dy) > slop;

/** A move of the finger, kept for working out how fast it was going when it let go. */
export type Sample = { t: number; x: number; y: number };

/** How fast the finger was going at the end, from the samples of the last `within` ms (in the samples' own units a ms). */
export const velocityOf = (samples: readonly Sample[], within = 90): { vx: number; vy: number } => {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  const first = [...samples].reverse().find((sample) => last.t - sample.t >= within) ?? samples[0];
  const dt = last.t - first.t;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
};

/** One axis of a glide, `dt` ms on: a flick slows; past the edge it runs on a little (never more than `slack`), is caught and pulled back in. */
const stepAxis = (pos: number, vel: number, range: Range, dt: number, slack: number): [number, number] => {
  const edge = clamp(pos, range);
  if (pos !== edge) {
    // Outside: whatever speed it had dies quickly, and it is drawn back to the edge.
    const slowed = vel * Math.exp(-dt / 40);
    const moved = pos + slowed * dt;
    const held = Math.max(range.min - slack, Math.min(range.max + slack, moved));
    const back = edge + (held - edge) * Math.exp(-dt / SPRING_MS);
    return Math.abs(back - edge) < 0.02 ? [edge, 0] : [back, held === moved ? slowed : 0];
  }
  const next = pos + vel * dt;
  return [next, vel * Math.exp(-dt / FRICTION_MS)];
};

/** The camera `dt` ms on, after it was let go: and whether it has come to rest (inside the picture, and still). */
export const stepGlide = (glide: Glide, bounds: Bounds, dt: number, slack = Infinity): Glide & { done: boolean } => {
  const step = Math.max(0, Math.min(64, dt));
  const [x, vx] = stepAxis(glide.x, glide.vx, bounds.x, step, slack);
  const [y, vy] = stepAxis(glide.y, glide.vy, bounds.y, step, slack);
  const inside = x === clamp(x, bounds.x) && y === clamp(y, bounds.y);
  const done = inside && Math.abs(vx) < STILL && Math.abs(vy) < STILL;
  return { x, y, vx: done ? 0 : vx, vy: done ? 0 : vy, done };
};

/** Eased `dt` ms of the way from `from` to `to`; there, once it is within a hair. */
export const easeTo = (from: number, to: number, dt: number, tau = EASE_MS) => {
  const next = to + (from - to) * Math.exp(-Math.max(0, dt) / tau);
  return Math.abs(next - to) < 0.02 ? to : next;
};

/** The camera centred on a point, as far as the picture allows: where it is at first, and where a double tap sends it. */
export const centredOn = (focus: Point, view: Size, bounds: Bounds): Point => ({ x: clamp(focus.x - view.w / 2, bounds.x), y: clamp(focus.y - view.h / 2, bounds.y) });

/** The part of the screen that is free to look through, in art pixels from the screen's top left. */
export type Free = { left: number; top: number; right: number; bottom: number };

/**
 * The camera moved as little as it needs to be for a thing to be seen in the
 * free part of the screen (beside the card, under the row along the top,
 * above the keys at the foot), as far as the picture allows. Unmoved when it
 * is seen already.
 */
export const showIn = (thing: Box, cam: Point, free: Free, bounds: Bounds, margin = 4): Point => {
  const along = (start: number, size: number, from: number, to: number, at: number) => {
    const low = start - margin - from;
    const high = start + size + margin - to;
    // Too big for the room: its middle in the middle.
    if (to - from < size + margin * 2) return start + size / 2 - (from + to) / 2;
    if (at > low) return low;
    if (at < high) return high;
    return at;
  };
  return {
    x: clamp(along(thing.x, thing.w, free.left, free.right, cam.x), bounds.x),
    y: clamp(along(thing.y, thing.h, free.top, free.bottom, cam.y), bounds.y)
  };
};

/** Which side a card goes, for a thing at this x on a screen this wide: the other half, so it never covers the thing. */
export const cardSide = (screenX: number, screenWidth: number): "left" | "right" => (screenX > screenWidth / 2 ? "left" : "right");

/** Whether the camera has been moved off where it sits at home, by more than a little (in art px). */
export const awayFrom = (cam: Point, home: Point, by = 6) => Math.hypot(cam.x - home.x, cam.y - home.y) > by;
