import { useSyncExternalStore } from "react";

/**
 * What kind of device Leaflet is on, for the phone and tablet layouts: the
 * system (Android or not), the input (a finger or a pointer), and which way
 * up the screen is. Set once at start (`installDeviceSignals`) as attributes
 * on <html>, so CSS can key on them, and kept as they change:
 *
 *   html[data-platform="android"]      the Android app
 *   html[data-input="touch"]           no hover, a coarse pointer (a finger)
 *   html[data-orientation="landscape"] wider than tall
 *
 * Plus the insets the system draws over (status bar, gesture bar, a notch,
 * the keyboard) as CSS variables, `--inset-top/right/bottom/left` and
 * `--inset-keyboard`. They default to the browser's own safe-area values;
 * the Android side sets them from the real window insets (`setInsets`),
 * because the WebView does not always report the status and gesture bars.
 */

export type Orientation = "portrait" | "landscape";
export type Insets = { top: number; right: number; bottom: number; left: number; keyboard?: number };

const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";

export const isAndroid = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/**
 * What to call this device in a sentence ("your library on this ___"): a
 * tablet when the Android screen's short side is 600 dp or more (Android's
 * own line between phones and tablets), a phone below that, and a computer
 * anywhere else.
 */
export const deviceNoun = (): "phone" | "tablet" | "computer" => {
  if (!isAndroid()) return "computer";
  const shortSide = typeof screen === "undefined" ? 0 : Math.min(screen.width, screen.height);
  return shortSide >= 600 ? "tablet" : "phone";
};

export const isTouchInput = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(TOUCH_QUERY).matches;

export const currentOrientation = (): Orientation =>
  typeof window === "undefined" || window.innerWidth >= window.innerHeight ? "landscape" : "portrait";

const listeners = new Set<() => void>();
const changed = () => {
  mark();
  for (const listener of listeners) listener();
};

const mark = () => {
  const root = document.documentElement;
  root.dataset.platform = isAndroid() ? "android" : "desktop";
  root.dataset.input = isTouchInput() ? "touch" : "mouse";
  root.dataset.orientation = currentOrientation();
};

let installed = false;
/** Marks <html> and keeps it marked. Called once, from `main.tsx`. */
export const installDeviceSignals = () => {
  if (installed || typeof window === "undefined") return;
  installed = true;
  mark();
  // A turn of the phone does not always arrive as a window resize (some
  // WebViews, and emulated sizes, change the viewport without one), so the
  // orientation query and the visual viewport are watched as well.
  window.addEventListener("resize", changed);
  window.addEventListener("orientationchange", changed);
  window.visualViewport?.addEventListener("resize", changed);
  window.matchMedia?.("(orientation: landscape)").addEventListener?.("change", changed);
  window.matchMedia?.(TOUCH_QUERY).addEventListener?.("change", changed);
};

/** The system's insets, in CSS px, from the Android side. Anything not given is left as the browser reports it. */
export const setInsets = (insets: Partial<Insets>) => {
  const style = document.documentElement.style;
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const value = insets[side];
    if (typeof value === "number" && Number.isFinite(value)) style.setProperty(`--inset-${side}`, `${Math.max(0, value)}px`);
  }
  if (typeof insets.keyboard === "number" && Number.isFinite(insets.keyboard)) {
    style.setProperty("--inset-keyboard", `${Math.max(0, insets.keyboard)}px`);
    document.documentElement.dataset.keyboard = insets.keyboard > 0 ? "open" : "closed";
  }
};

declare global {
  interface Window {
    /** Called by the Android side whenever the window insets change, and on each page load; see `setInsets`. */
    __leafletInsets?: (insets: Partial<Insets>) => void;
  }
}

if (typeof window !== "undefined") {
  window.__leafletInsets = setInsets;
}

const subscribe = (listener: () => void) => {
  installDeviceSignals();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Which way up the screen is, kept as it turns. */
export const useOrientation = (): Orientation => useSyncExternalStore(subscribe, currentOrientation, () => "landscape");

/** Whether the reader is using a finger: no hover, and a coarse pointer. */
export const useTouchInput = (): boolean => useSyncExternalStore(subscribe, isTouchInput, () => false);
