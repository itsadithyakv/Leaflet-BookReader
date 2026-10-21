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
export const runWhileShown = (element: Element | null, frame: (now: number) => void, resumed?: () => void): (() => void) =>
  runScene(element, frame, { resumed }).stop;

export type SceneLoop = {
  stop: () => void;
  /** Something has started moving: frames from the next one, not from when the loop meant to look again. */
  wake: () => void;
};

/** Below this, a rest between frames is not worth a timer: the next frame is asked for. */
const NAP_MIN_MS = 20;
/** How often a scene that can be covered looks to see whether it is (`coveredMuch`). */
export const COVER_LOOK_MS = 600;

/**
 * `runWhileShown`, for a scene that knows when it next has something to show.
 * `frame` may return how long (ms) until it next needs a frame: the loop then
 * sleeps on a timer rather than taking every frame the display gives, each of
 * which costs the page a pass of style and paint even when nothing is drawn
 * (on a phone at 120 Hz, a fifth of a core at rest). `wake` brings it back
 * early. With `cover`, the loop also stops while something is laid over most
 * of `element` (a sheet, a dialog: `coveredMuch`), looked at every
 * `COVER_LOOK_MS`.
 */
export const runScene = (
  element: Element | null,
  frame: (now: number) => number | void,
  options: { resumed?: () => void; cover?: boolean } = {}
): SceneLoop => {
  let raf = 0;
  let nap = 0;
  let ended = false;
  let visible = typeof document === "undefined" || document.visibilityState !== "hidden";
  // In view until told otherwise: an observer says so once, soon after it starts watching.
  let inView = true;
  let uncovered = true;
  const running = () => !ended && visible && inView && uncovered;
  const run = (now: number) => {
    raf = 0;
    const rest = frame(now);
    if (!running() || raf !== 0 || nap !== 0) return;
    if (typeof rest === "number" && rest >= NAP_MIN_MS) {
      // (Woken when the rest is up, not before: the frame asked for then comes just after it, and is the one it was for.)
      nap = window.setTimeout(() => {
        nap = 0;
        if (running() && raf === 0) raf = requestAnimationFrame(run);
      }, rest);
    } else {
      raf = requestAnimationFrame(run);
    }
  };
  const halt = () => {
    if (raf !== 0) cancelAnimationFrame(raf);
    if (nap !== 0) window.clearTimeout(nap);
    raf = 0;
    nap = 0;
  };
  const update = () => {
    const on = running();
    if (on && raf === 0 && nap === 0) {
      options.resumed?.();
      raf = requestAnimationFrame(run);
    } else if (!on) {
      halt();
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
  let coverTimer = 0;
  if (options.cover && element) {
    coverTimer = window.setInterval(() => {
      // (Not while the window is hidden or the picture scrolled away: there is nothing to ask then.)
      if (ended || !visible || !inView) return;
      const free = !coveredMuch(element);
      if (free !== uncovered) {
        uncovered = free;
        update();
      }
    }, COVER_LOOK_MS);
  }
  if (visible) raf = requestAnimationFrame(run);
  return {
    stop: () => {
      ended = true;
      halt();
      if (coverTimer) window.clearInterval(coverTimer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    },
    wake: () => {
      if (!running()) return;
      if (nap !== 0) {
        window.clearTimeout(nap);
        nap = 0;
      }
      if (raf === 0) raf = requestAnimationFrame(run);
    }
  };
};

/** The points `coveredMuch` asks about, as shares of the picture's width and height: three by three, in from the edges. */
const COVER_GRID = [0.17, 0.5, 0.83];
/** Laid over more than this share of those points, a picture is covered. */
export const COVERED_SHARE = 0.5;
/** Smaller than this share of the picture, what is over it is a button, a badge, Pip's word: it hides nothing. */
export const COVER_MIN_SHARE = 0.2;

/**
 * Whether what is at one of the points hides the picture there: something
 * other than the picture, not a small thing over it (`COVER_MIN_SHARE`), and
 * not see-through (a scrim that lets it show, a layer that only catches the
 * pointer). `hit` is null where the picture itself is what shows.
 */
export const hidesAt = (hit: { area: number; solid: boolean } | null, pictureArea: number): boolean =>
  hit !== null && hit.solid && hit.area >= pictureArea * COVER_MIN_SHARE;

/** Whether most of the points hide the picture. */
export const mostlyHidden = (hides: readonly boolean[]) => hides.length > 0 && hides.filter(Boolean).length / hides.length > COVERED_SHARE;

/** Whether a colour (as computed: `rgb(...)`, `rgba(...)`, `transparent`) is mostly opaque. */
export const solidColour = (colour: string) => {
  if (colour === "transparent" || colour === "") return false;
  const parts = /\(([^)]*)\)/.exec(colour)?.[1].split(/[\s,/]+/).filter(Boolean) ?? [];
  if (parts.length < 4) return true;
  const alpha = parts[3];
  return (alpha.endsWith("%") ? parseFloat(alpha) / 100 : parseFloat(alpha)) >= 0.6;
};

const solidStyle = (style: CSSStyleDeclaration) =>
  solidColour(style.backgroundColor) || style.backgroundImage !== "none" || (style.backdropFilter !== "" && style.backdropFilter !== "none" && style.backdropFilter !== undefined);

/**
 * Whether something is laid over most of `element` (a sheet up over the camp, a
 * dialog, the battle): asked at a few points, by what the page would hit
 * there. What hides a point is the outermost thing at it that does not hold the
 * picture, measured whole; it must be big and solid (`hidesAt`).
 */
export const coveredMuch = (element: Element): boolean => {
  if (typeof document === "undefined" || typeof document.elementFromPoint !== "function") return false;
  const box = element.getBoundingClientRect();
  const left = Math.max(0, box.left);
  const top = Math.max(0, box.top);
  const right = Math.min(window.innerWidth, box.right);
  const bottom = Math.min(window.innerHeight, box.bottom);
  if (right <= left || bottom <= top) return false;
  const pictureArea = (right - left) * (bottom - top);
  const hides: boolean[] = [];
  for (const fy of COVER_GRID) {
    for (const fx of COVER_GRID) {
      const at = document.elementFromPoint(left + (right - left) * fx, top + (bottom - top) * fy);
      if (!at || at === element || element.contains(at)) {
        hides.push(false);
        continue;
      }
      // Up from what was hit (short of what holds the picture) to the first thing there with a solid face: the sheet,
      // the dialog, or only a HUD's button. How much of the picture that thing covers is what counts.
      let solid: Element | null = null;
      for (let node: Element | null = at; node && !node.contains(element); node = node.parentElement) {
        if (solidStyle(getComputedStyle(node))) {
          solid = node;
          break;
        }
      }
      if (!solid) {
        hides.push(false);
        continue;
      }
      const r = solid.getBoundingClientRect();
      const area = Math.max(0, Math.min(right, r.right) - Math.max(left, r.left)) * Math.max(0, Math.min(bottom, r.bottom) - Math.max(top, r.top));
      hides.push(hidesAt({ area, solid: true }, pictureArea));
    }
  }
  return mostlyHidden(hides);
};

/**
 * When a scene next has something to show, at rest: the start of its next art
 * frame (`artFps` a second, counted from `started`), in ms from `now`.
 */
export const untilNextArtFrame = (now: number, started: number, artFps: number) => {
  const every = 1000 / artFps;
  const into = (((now - started) % every) + every) % every;
  return every - into;
};

/**
 * How often a scene is painted (the Hollow's camp): at rest, when its art
 * turns to a new frame (`artFps`, twelve a second; what glides there moves a
 * whole pixel at a time, and at that rate keeps step with the art), and while
 * something is being done to it at `busyFps` (every frame the display gives
 * when null). It used to be thirty a second at rest, whatever changed: two
 * paints in five of the same art frame.
 */
export const sceneGate = (options: { artFps: number; busyFps: number | null }) => {
  const busyGate = options.busyFps === null ? null : frameGate(options.busyFps);
  let shownArt = Number.NaN;
  return {
    /** Whether to paint the frame at `now` (the loop's clock began at `started`); `busy`: something is being done to the picture. */
    due(now: number, started: number, busy: boolean) {
      const art = Math.floor(((now - started) / 1000) * options.artFps);
      // (The busy gate is asked at every frame, painted or not: it learns the display's rate from them.)
      const onCue = busyGate ? busyGate.due(now) : true;
      if (busy) {
        if (!onCue) return false;
        shownArt = art;
        return true;
      }
      if (art === shownArt) return false;
      shownArt = art;
      return true;
    },
    reset() {
      busyGate?.reset();
      shownArt = Number.NaN;
    }
  };
};

/** The cap on a scene's busy paints by how much the device is given to draw (`html[data-perf]`, platform/perfTier.ts). */
export const busyFpsFor = (tier: string | undefined): number | null => (tier === "minimal" ? 30 : tier === "lite" ? 60 : null);
