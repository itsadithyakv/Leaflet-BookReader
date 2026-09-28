/**
 * One 12 fps clock for every Pip on screen.
 *
 * A requestAnimationFrame loop per sprite would wake the page once per sprite
 * per display frame; this wakes it twelve times a second in total, and stops
 * entirely when no sprite is mounted. The browser already pauses it in a hidden
 * window, so a minimised Leaflet costs nothing.
 */
const FRAME_MS = 1000 / 12;

type Listener = (tick: number) => void;

const listeners = new Set<Listener>();
let tick = 0;
let last = 0;
let raf = 0;

const loop = (time: number) => {
  if (time - last >= FRAME_MS) {
    last = time;
    tick += 1;
    listeners.forEach((listener) => listener(tick));
  }
  raf = requestAnimationFrame(loop);
};

export const currentTick = () => tick;

export const subscribeTick = (listener: Listener) => {
  listeners.add(listener);
  if (!raf) {
    raf = requestAnimationFrame(loop);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
};

export const TICKS_PER_SECOND = 12;
