import { useSyncExternalStore } from "react";
import { insetsSettled, isTouchInput, onInsets } from "./device";

/**
 * The shape of the window, for the app around the pages (the reader keeps its
 * own: readers/touchLayout.ts). Set as `html[data-shape]` (`installShellShape`,
 * from main.tsx) and kept as the window changes, so CSS keys on it:
 *
 *   upright   under 768 px wide and taller than 520: the tab bar at the foot
 *   sideways  520 px tall or less: the rail at the side and a slim header (a
 *             phone on its side, or a squat desktop window)
 *   wide      neither: the rail, the full header
 *
 * These were `(max-height: 520px)` and `(max-width: 767px) and (min-height:
 * 521px)` in the stylesheets, which a keyboard got wrong: it makes the window
 * shorter without the phone having turned (the WebView ends at it), so a
 * 412 x 915 phone typing measured 412 x 450 and was laid out as one on its side,
 * the rail for the tab bar. By a finger the height is the steady one
 * (`steadyHeight`): the tallest the window has been at this width. A turn is a
 * new width. Where the screen says it is upright (`screen.orientation`) a
 * window narrower than tall is never on its side either: turned back with the
 * keyboard still up, the first height seen at the new width is a short one.
 * A mouse has no keyboard over the window: there the height is the window's.
 */
export type ShellShape = "upright" | "sideways" | "wide";

/** Sideways at this tall or less (the stylesheets' old `max-height: 520px`). */
export const SIDEWAYS_MAX_HEIGHT = 520;
/** Upright at this wide or less, when not sideways (`max-width: 767px`). */
export const UPRIGHT_MAX_WIDTH = 767;

/**
 * The window's height for its shape: the tallest it has been at this width.
 * A keyboard makes the window shorter without the phone having turned (ours,
 * or another app's: a reply typed into a notification), and a phone upright
 * with one up could measure wider than tall, or a tablet on its side shorter
 * than a phone. A new width (a turn of the screen) starts again.
 */
export type HeightMemory = { width: number; height: number };

export const steadyHeight = (memory: HeightMemory, width: number, height: number): number => {
  if (memory.width !== width) {
    memory.width = width;
    memory.height = height;
    return height;
  }
  memory.height = Math.max(memory.height, height);
  return memory.height;
};

/**
 * The shape for a window `width` by `height` (the steady height, by a finger).
 * `upright`: the screen itself says it is upright (`screen.orientation.type`).
 */
export const shellShape = (width: number, height: number, upright = false): ShellShape => {
  if (height <= SIDEWAYS_MAX_HEIGHT && !(upright && width < height)) return "sideways";
  return width <= UPRIGHT_MAX_WIDTH ? "upright" : "wide";
};

export type ShapeReading = { width: number; height: number; touch: boolean; screenUpright?: boolean };

/** Reads one measurement into `memory` and says the shape: steady by a finger, as measured by a mouse. */
export const readShape = (memory: HeightMemory, reading: ShapeReading): ShellShape => {
  if (!reading.touch) {
    memory.width = 0;
    return shellShape(reading.width, reading.height);
  }
  return shellShape(reading.width, steadyHeight(memory, reading.width, reading.height), reading.screenUpright === true);
};

const heights: HeightMemory = { width: 0, height: 0 };

const screenUpright = () => {
  if (typeof screen === "undefined") return undefined;
  const type = screen.orientation?.type;
  return typeof type === "string" ? type.startsWith("portrait") : undefined;
};

/** The window's shape now. */
export const currentShellShape = (): ShellShape => {
  if (typeof window === "undefined") return "wide";
  return readShape(heights, { width: window.innerWidth, height: window.innerHeight, touch: isTouchInput(), screenUpright: screenUpright() });
};

/**
 * A turn of the screen does not land in one step. While the phone turns, the
 * window passes through sizes that are neither shape (412 x 360, 800 x 412,
 * the old height at the new width) and the screen's own word
 * (`screen.orientation`) can come before or after them; laid out as each came,
 * the shell flashed the other shape's chrome (the leather rail, coming back
 * upright from Pip). So by a finger a new shape is put on only once the
 * window has kept its size for `SHAPE_SETTLE_MS`, or at once when the screen
 * says the same way up as the window (a turn that has landed). A mouse's
 * window is laid out as it is.
 */
export const SHAPE_SETTLE_MS = 180;
/**
 * A turn the app itself makes (a rotation hold taken or let go:
 * platform/android.ts): from that moment until the window has turned, neither
 * shape's way about (the rail, the tab bar) is drawn, `html[data-turning]`.
 * It is over when the new shape is on, when the window has not changed size
 * for `TURN_IDLE_MS` (the phone was that way up already), or at
 * `TURN_WAIT_MS` whatever happens.
 *
 * A turn the app holds the screen to (Pip's sideways, a book's own way up) is
 * sure to come: it is not given up for a still window until the window is
 * that way about (a slow phone took over a second to start turning, and the
 * library was uncovered on its side). A guess (a hold let go on a phone, which
 * is most likely upright again) waits `TURN_GUESS_IDLE_MS` for the window to
 * start turning before it takes the phone to be that way up already.
 */
export const TURN_IDLE_MS = 450;
export const TURN_GUESS_IDLE_MS = 900;
export const TURN_WAIT_MS = 2500;

export type Aspect = "portrait" | "landscape";

/** Which way the window is longer; null when it is square. */
export const aspectOf = (width: number, height: number): Aspect | null => (width === height ? null : width < height ? "portrait" : "landscape");

const screenAspect = (): Aspect | null => {
  const upright = screenUpright();
  return upright === undefined ? null : upright ? "portrait" : "landscape";
};

const listeners = new Set<() => void>();

/** The shape put on (`html[data-shape]`, and what the hooks say); null before the first. */
let shown: ShellShape | null = null;
let settling: ReturnType<typeof setTimeout> | null = null;
let lastSize = "";
type Turn = {
  aspect: Aspect | null;
  /** The screen is held this way: it will turn. (Otherwise `aspect` is a guess, or null.) */
  sure: boolean;
  /** The window has changed size since the turn began. */
  moved: boolean;
  idle: ReturnType<typeof setTimeout>;
  cap: ReturnType<typeof setTimeout>;
};
let turn: Turn | null = null;

const root = () => (typeof document === "undefined" ? null : document.documentElement);

const putOn = (shape: ShellShape) => {
  if (settling !== null) {
    clearTimeout(settling);
    settling = null;
  }
  const changed = shown !== shape;
  shown = shape;
  const html = root();
  if (html && html.dataset.shape !== shape) html.dataset.shape = shape;
  if (changed) for (const listener of listeners) listener();
};

/**
 * The veil over the app while a turn the app made is under way: the page as it was is gone at once (Pip's tab, or
 * the library), and the window passes through sizes and insets that are neither way up (the library laid out on
 * its side in a window already upright, then upright with the bars of a phone on its side). It is the page's own
 * colour, and lifts with a soft blur and fade once the new shape is on and the insets for it have come
 * (`INSETS_WAIT_MS` at most), so what it uncovers is the page as it will stay.
 */
export const INSETS_WAIT_MS = 400;
/** How long the veil takes to lift (device.css `.turn-veil`). */
export const VEIL_LIFT_MS = 280;

type Veil = { node: HTMLElement; lift: (() => void) | null };
let veil: Veil | null = null;

const raf = (run: () => void) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 16);
};

const showVeil = () => {
  if (typeof document === "undefined" || !document.body) return;
  if (veil) {
    // Lifting already: down again, at once.
    veil.lift?.();
    veil.lift = null;
    veil.node.classList.remove("is-lifting");
    return;
  }
  const node = document.createElement("div");
  node.className = "turn-veil";
  node.setAttribute("aria-hidden", "true");
  document.body.appendChild(node);
  veil = { node, lift: null };
};

/** Lifts the veil once the insets are the new shape's, a frame or two after the page has been laid out in it. */
const liftVeil = () => {
  const current = veil;
  if (!current || current.lift) return;
  let done = false;
  let unwatch: () => void = () => undefined;
  let wait: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    done = true;
    unwatch();
    if (wait !== null) clearTimeout(wait);
  };
  current.lift = stop;
  const reveal = () => {
    if (done) return;
    stop();
    // Two frames: the page drawn in its new shape (React renders after the shape's listeners) before it is shown.
    raf(() =>
      raf(() => {
        if (veil !== current || current.lift !== stop) return;
        current.node.classList.add("is-lifting");
        setTimeout(() => {
          if (veil !== current || !current.node.classList.contains("is-lifting")) return;
          current.node.remove();
          veil = null;
        }, VEIL_LIFT_MS + 40);
      })
    );
  };
  if (insetsSettled()) {
    reveal();
    return;
  }
  unwatch = onInsets(() => {
    if (insetsSettled()) reveal();
  });
  wait = setTimeout(reveal, INSETS_WAIT_MS);
};

const endTurn = () => {
  if (!turn) return;
  clearTimeout(turn.idle);
  clearTimeout(turn.cap);
  turn = null;
  const html = root();
  if (html) delete html.dataset.turning;
  // Whatever the window is now, it is shown so.
  if (typeof window !== "undefined") putOn(currentShellShape());
  liftVeil();
};

const idleTimer = (): ReturnType<typeof setTimeout> =>
  setTimeout(
    () => {
      // Held one way: still the other way about, it has not turned yet.
      if (turn?.sure && turn.aspect && typeof window !== "undefined" && aspectOf(window.innerWidth, window.innerHeight) !== turn.aspect) {
        turn.idle = idleTimer();
        return;
      }
      endTurn();
    },
    turn && !turn.sure && turn.aspect && !turn.moved ? TURN_GUESS_IDLE_MS : TURN_IDLE_MS
  );

const mark = () => {
  const measured = currentShellShape();
  if (shown === null || !isTouchInput()) {
    endTurn();
    putOn(measured);
    return;
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const size = `${width}x${height}`;
  const resized = size !== lastSize;
  lastSize = size;
  // Still turning: the wait for a still window starts again.
  if (turn && resized) {
    turn.moved = true;
    clearTimeout(turn.idle);
    turn.idle = idleTimer();
  }
  if (measured === shown) {
    if (settling !== null) {
      clearTimeout(settling);
      settling = null;
    }
    return;
  }
  const aspect = aspectOf(width, height);
  // Turning the way the app asked: a window still the other way about is on its way there.
  if (turn?.aspect && aspect !== turn.aspect) return;
  if (aspect !== null && screenAspect() === aspect) {
    putOn(measured);
    endTurn();
    return;
  }
  if (settling !== null) clearTimeout(settling);
  settling = setTimeout(() => {
    settling = null;
    putOn(currentShellShape());
    endTurn();
  }, SHAPE_SETTLE_MS);
};

/**
 * The app is about to turn the screen (or let it turn): `aspect` is the way
 * it will be, null when it is the phone's to say (a hold let go). Until it
 * has turned, the shell draws neither shape's way about, and a window still
 * the other way is not taken for the new shape, and the veil is over the app
 * (`showVeil`). Platform/android.ts calls it as a rotation hold changes, on
 * Android only; `guess`: the way it will most likely be, not a hold.
 */
export const expectTurn = (aspect: Aspect | null, how: { guess?: boolean } = {}) => {
  if (typeof window === "undefined" || !isTouchInput()) return;
  installShellShape();
  // Held the way the window already is (and the shape put on for it), with no other turn under way: nothing turns.
  // (The rail and the tab bar were taken away for TURN_IDLE_MS for nothing.)
  if (!turn && aspect !== null && aspectOf(window.innerWidth, window.innerHeight) === aspect && shown === currentShellShape()) return;
  showVeil();
  if (turn) {
    clearTimeout(turn.idle);
    clearTimeout(turn.cap);
  }
  const cap = setTimeout(endTurn, TURN_WAIT_MS);
  turn = { aspect, sure: aspect !== null && !how.guess, moved: false, idle: cap, cap };
  turn.idle = idleTimer();
  const html = root();
  if (html) html.dataset.turning = aspect ?? "any";
};

let installed = false;
/** Marks <html> with `data-shape` and keeps it marked. Called once, from `main.tsx`. */
export const installShellShape = () => {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;
  lastSize = `${window.innerWidth}x${window.innerHeight}`;
  mark();
  // As platform/device.ts: a turn does not always arrive as a window resize.
  window.addEventListener("resize", mark);
  window.addEventListener("orientationchange", mark);
  window.visualViewport?.addEventListener("resize", mark);
  window.matchMedia?.("(orientation: landscape)").addEventListener?.("change", mark);
  window.matchMedia?.("(hover: none) and (pointer: coarse)").addEventListener?.("change", mark);
  if (typeof screen !== "undefined") screen.orientation?.addEventListener?.("change", mark);
};

const subscribe = (listener: () => void) => {
  installShellShape();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The shape the shell is laid out in: as `html[data-shape]` says (a turn under way still the old one). */
export const shownShellShape = (): ShellShape => shown ?? currentShellShape();

/** The window's shape, kept as it changes (and as `html[data-shape]` says). */
export const useShellShape = (): ShellShape => useSyncExternalStore(subscribe, shownShellShape, () => "wide");

/**
 * Whether the window's shape is one of `shapes`, kept as it changes. False
 * without a window, as a media query is (`useMediaQuery`).
 */
export const useShellShapeIs = (...shapes: ShellShape[]): boolean =>
  useSyncExternalStore(
    subscribe,
    () => shapes.includes(shownShellShape()),
    () => false
  );
