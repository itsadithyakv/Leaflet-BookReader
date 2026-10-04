/**
 * Pip and the walls of the window: what a thrown Pip does when it reaches one.
 *
 * Thrown hard at a wall, well above the floor, Pip grabs it and slides down
 * to the floor; otherwise it bounces off. Pure, so the rule
 * can be tested without a window: PipWorld runs it on every frame of a flight.
 */

/** Collision half-width of Pip's body at 64px, in CSS pixels. */
export const HALF_W = 18;
/** Into a wall faster than this (CSS pixels a second), Pip grabs it. */
export const CLING_SPEED = 950;
/**
 * How long a wall grab lasts before Pip lets go: it doesn't, it slides down
 * to the floor. That is what it always looked like, by accident (it let go
 * after 1.4 seconds and grabbed again the next frame, see meetWall); the slide
 * is kept, without the frame of falling between grabs.
 */
export const CLING_MS = Number.POSITIVE_INFINITY;
/** Closer to the floor than this there is no wall left to hold. */
const CLING_ROOM = 60;
/** How much of its speed Pip keeps when it bounces off a wall. */
const WALL_BOUNCE = 0.45;

export type Walls = { left: number; right: number; floor: number };
/** Where Pip ends up, the speed it is left with, and the wall it grabbed (0: none). */
export type WallMeeting = { x: number; vx: number; cling: -1 | 0 | 1 };

/** Holding a wall, Pip hugs it: closer than its half-width, so the body overlaps the edge. */
export const clingX = (side: -1 | 1, walls: Walls) => (side < 0 ? walls.left + HALF_W * 0.7 : walls.right - HALF_W * 0.7);

/**
 * A flying Pip at (x, y) moving sideways at vx, against the walls.
 *
 * A grab takes all of the throw: Pip is left with no sideways speed. It used
 * to keep it, and the hold is inside the wall's reach, so the frame after Pip
 * let go it was still "flying into the wall at speed" and grabbed it again.
 * That showed one frame of the fall every 1.4 seconds, all the way down the
 * wall, and ended with a kick off the wall at the bottom. A grab also needs
 * Pip to be moving into the wall, not merely fast beside it.
 *
 * `leftWall` is false while Pip is still coming out of its home, which sits
 * beyond the left wall.
 */
export const meetWall = (x: number, y: number, vx: number, walls: Walls, leftWall = true): WallMeeting => {
  const canHold = y < walls.floor - CLING_ROOM;
  let at = x;
  let speed = vx;
  if (leftWall && at - HALF_W < walls.left) {
    if (speed < -CLING_SPEED && canHold) {
      return { x: clingX(-1, walls), vx: 0, cling: -1 };
    }
    at = walls.left + HALF_W;
    speed = Math.abs(speed) * WALL_BOUNCE;
  }
  if (at + HALF_W > walls.right) {
    if (speed > CLING_SPEED && canHold) {
      return { x: clingX(1, walls), vx: 0, cling: 1 };
    }
    at = walls.right - HALF_W;
    speed = 0 - Math.abs(speed) * WALL_BOUNCE;
  }
  return { x: at, vx: speed, cling: 0 };
};
