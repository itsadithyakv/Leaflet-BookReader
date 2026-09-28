/**
 * One 12 fps clock for every Pip on screen.
 *
 * A plain interval, not requestAnimationFrame: a frame loop wakes the page on
 * every display refresh (60 to 144 times a second) only to act on one in five
 * or more of them. This wakes it twelve times a second in total, stops
 * entirely when no sprite is mounted, and pauses while the window is hidden.
 */
const FRAME_MS = 1000 / 12;

type Listener = (tick: number) => void;

const listeners = new Set<Listener>();
let tick = 0;
let interval = 0;

const fire = () => {
  tick += 1;
  listeners.forEach((listener) => listener(tick));
};

const start = () => {
  if (!interval && listeners.size > 0 && !document.hidden) {
    interval = window.setInterval(fire, FRAME_MS);
  }
};

const stop = () => {
  if (interval) {
    window.clearInterval(interval);
    interval = 0;
  }
};

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
}

export const currentTick = () => tick;

export const subscribeTick = (listener: Listener) => {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop();
    }
  };
};

export const TICKS_PER_SECOND = 12;
