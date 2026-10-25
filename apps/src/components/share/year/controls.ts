/**
 * How the story is moved through, as Stories are: a tap on the right goes on,
 * on the left goes back; a hold pauses until it is let go; a swipe down
 * closes; a swipe across goes on or back. The arrow keys and Esc on a
 * keyboard. Pure, so the rules are tested without a screen.
 */

export type StoryAction = "next" | "back" | "close" | null;

/** The share of the width, from the left, that goes back: less than half, as the thumb is mostly going on. */
export const BACK_ZONE = 0.3;
/** A press this long is a hold (a pause), not a tap. */
export const HOLD_MS = 220;
/** A drag this far is a swipe. */
export const SWIPE_PX = 64;

/** What a press let go does: where it was, how far it moved, and how long it was held. */
export const releaseAction = (press: { x: number; width: number; dx: number; dy: number; heldMs: number }): StoryAction => {
  const { dx, dy } = press;
  if (dy > SWIPE_PX && dy > Math.abs(dx) * 1.2) {
    return "close";
  }
  if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? "next" : "back";
  }
  // A hold was a pause: letting go only plays on.
  if (press.heldMs >= HOLD_MS || Math.abs(dx) > 12 || Math.abs(dy) > 12) {
    return null;
  }
  return press.width > 0 && press.x / press.width < BACK_ZONE ? "back" : "next";
};

/** What a key does. */
export const keyAction = (key: string): StoryAction => {
  switch (key) {
    case "ArrowRight":
    case "PageDown":
    case " ":
      return "next";
    case "ArrowLeft":
    case "PageUp":
      return "back";
    case "Escape":
      return "close";
    default:
      return null;
  }
};

/** The scene `action` leads to from `at` of `count`; null to close. The last scene stays: it is the one to share. */
export const stepTo = (at: number, count: number, action: Exclude<StoryAction, null>): number | null => {
  if (action === "close") {
    return null;
  }
  if (action === "next") {
    return Math.min(count - 1, at + 1);
  }
  return Math.max(0, at - 1);
};

/**
 * A scene's own clock: the time since it began, less the time it was
 * paused. The count-ups and the pictures read it, so a hold stops them too.
 */
export class SceneClock {
  private began: number;
  private pausedAt: number | null = null;
  private pausedFor = 0;
  constructor(private readonly now: () => number = () => performance.now()) {
    this.began = now();
  }
  get paused() {
    return this.pausedAt !== null;
  }
  pause() {
    if (this.pausedAt === null) {
      this.pausedAt = this.now();
    }
  }
  resume() {
    if (this.pausedAt !== null) {
      this.pausedFor += this.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }
  /** Milliseconds of the scene played. */
  time() {
    return (this.pausedAt ?? this.now()) - this.began - this.pausedFor;
  }
}
