/**
 * How often a picture that is always moving is painted.
 *
 * A frame loop is given every display refresh, 60 to 144 times a second, and
 * the Hollow's pictures were painted at every one of them. Their art turns
 * twelve times a second; what glides (Pip on her rounds, a leaf, an acorn on
 * its way) glides as smoothly at thirty. So a loop paints when the gate says,
 * and skips the frame otherwise: one paint in two at 60 Hz, one in four at
 * 120. While something is being done to the picture (a drag, a pointer
 * moving over it, a building just chosen bouncing), every frame is painted.
 *
 * What a paint shows is still worked out from the frame's own time, never by
 * counting frames: a skipped frame leaves nothing behind to catch up on.
 *
 * Not the games themselves (GameScreen.tsx): a game reads its keys and moves
 * its pieces at the full rate, and is painted at it.
 */

/** Paints a second, at most, while nothing is being done to the picture. */
export const PAINT_FPS = 30;
/** Before the display's own rate is known (the first frames): how early a frame may come and still be painted, in ms. */
const SLACK_MS = 4;

export type FrameGate = {
  /**
   * Whether the frame the screen gives at `now` (a requestAnimationFrame time, in ms) is to be painted; asked at
   * every frame, painted or not, as it learns the display's rate from them. `busy`: paint it whatever.
   */
  due: (now: number, busy?: boolean) => boolean;
  /** Paint every frame until `until` (ms, by the same clock): for a short effect, or while the picture is being touched. */
  wake: (until: number) => void;
  /** As new: the next frame is painted (when the loop starts again after a pause). */
  reset: () => void;
};

/**
 * A paint falls on every n-th refresh, the same n each time (2 at 60 Hz, 3 at
 * 90, 4 at 120, 5 at 144): n is found from the display's own rate, and a frame
 * half a refresh early or late still counts as the n-th. Asked by the clock
 * alone ("33 ms since the last?") a 60 Hz frame landing a hair short of the
 * mark was skipped, and that paint came a frame late: a stutter.
 */
export const frameGate = (fps = PAINT_FPS): FrameGate => {
  const every = 1000 / fps;
  let last = -Infinity;
  let awake = -Infinity;
  let prev = -Infinity;
  /** The display's time between frames, as it has lately been; 0 until known. */
  let frameMs = 0;
  /** Paint every so many frames. Kept until the display's rate has really changed, so a rate between two never flips. */
  let n = 0;
  return {
    due(now, busy = false) {
      const since = now - prev;
      prev = now;
      // (Not a pause, or a frame the page did not get: those are not the display's rate.)
      if (since > 0 && since < 100) frameMs = frameMs ? frameMs + (since - frameMs) / 8 : since;
      // (A time before the last paint is a clock begun again: painted, and counted from.)
      if (busy || now < awake || now < last) {
        last = now;
        return true;
      }
      if (frameMs) {
        const want = every / frameMs;
        // (A rate halfway between two, as 75 Hz is, takes the fewer paints.)
        if (!n || Math.abs(want - n) > 0.75) n = Math.max(1, Math.round(want + 0.05));
      }
      if (now - last >= (frameMs ? (n - 0.5) * frameMs : every - SLACK_MS)) {
        last = now;
        return true;
      }
      return false;
    },
    wake(until) {
      awake = Math.max(awake, until);
    },
    reset() {
      last = -Infinity;
      awake = -Infinity;
      prev = -Infinity;
    }
  };
};

/**
 * For a picture all of whose motion is to the art's whole pixel and frame:
 * true when what it shows (`key`) is not what it showed last time, so it is
 * painted only when it would look different.
 */
export const changeGate = () => {
  let shown: string | null = null;
  return (key: string) => {
    if (key === shown) return false;
    shown = key;
    return true;
  };
};

/**
 * A frame loop that runs only while there is something to see: stopped while
 * the window is hidden and while `element` is out of view (scrolled away, or
 * on a page that is not shown), started again when it is back. `frame` is
 * called with each frame's time; `resumed` when it starts again after a stop,
 * for the loop to forget the time it was away. Returns the stop.
 */
export const runWhileShown = (element: Element | null, frame: (now: number) => void, resumed?: () => void): (() => void) => {
  let raf = 0;
  let ended = false;
  let visible = typeof document === "undefined" || document.visibilityState !== "hidden";
  // In view until told otherwise: an observer says so once, soon after it starts watching.
  let inView = true;
  const run = (now: number) => {
    raf = 0;
    frame(now);
    if (!ended && raf === 0 && visible && inView) raf = requestAnimationFrame(run);
  };
  const update = () => {
    const on = !ended && visible && inView;
    if (on && raf === 0) {
      resumed?.();
      raf = requestAnimationFrame(run);
    } else if (!on && raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  const onVisibility = () => {
    visible = document.visibilityState !== "hidden";
    update();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  let observer: IntersectionObserver | null = null;
  if (element && typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver((entries) => {
      const latest = entries[entries.length - 1];
      if (!latest) return;
      inView = latest.isIntersecting;
      update();
    });
    observer.observe(element);
  }
  if (visible) raf = requestAnimationFrame(run);
  return () => {
    ended = true;
    cancelAnimationFrame(raf);
    raf = 0;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    observer?.disconnect();
  };
};
