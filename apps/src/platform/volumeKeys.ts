import { useEffect, useSyncExternalStore } from "react";
import { android, onAndroid } from "./android";

/**
 * On Android, the volume keys turn the open book's pages (and so does a
 * Bluetooth page-turner, which sends the same keys): down goes on, up goes
 * back. Only while a book is open and the setting is on; anywhere else they
 * change the volume as ever.
 *
 * The Android side (`MainActivity.dispatchKeyEvent`) swallows them while the
 * page has said so (`android.volumePageTurns`), and calls
 * `window.__leafletPageKey`, which presses Page Down or Page Up: the key both
 * readers already turn a page with, whichever way the book runs (an arrow
 * would go the wrong way in a right-to-left book), and which scrolls a screen
 * when the book is scrolled rather than paged.
 */

export type PageKeyDirection = "next" | "prev";

const KEY = "leaflet.volumeKeys";

const readOn = () => {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
};

let on = readOn();
const listeners = new Set<() => void>();

/** Whether the volume keys turn pages (on by default). */
export const volumeKeysTurnPages = () => on;

/** Turns the setting on or off, for this device. */
export const setVolumeKeysTurnPages = (next: boolean) => {
  on = next;
  try {
    localStorage.setItem(KEY, next ? "on" : "off");
  } catch {
    // Remembered for this session only.
  }
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The switch, for Settings: `[on, setOn]`. */
export const useVolumeKeysTurnPages = (): [boolean, (next: boolean) => void] => [
  useSyncExternalStore(subscribe, volumeKeysTurnPages, () => true),
  setVolumeKeysTurnPages
];

/** Whether the volume keys should be Leaflet's now. */
export const volumeKeysWanted = (state: { android: boolean; setting: boolean; bookOpen: boolean }) =>
  state.android && state.setting && state.bookOpen;

/** The key a volume key stands for: Page Down goes on in every book and layout, Page Up goes back. */
export const pageKeyFor = (direction: PageKeyDirection): "PageDown" | "PageUp" => (direction === "next" ? "PageDown" : "PageUp");

/**
 * Presses the page key on the window, where both readers listen. Not on the
 * focused element: a slider or a tab the keyboard is on would take Page Down
 * as its own.
 */
export const pressPageKey = (direction: PageKeyDirection, target: EventTarget = window) => {
  const key = pageKeyFor(direction);
  target.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, code: key, bubbles: true, cancelable: true }));
};

declare global {
  interface Window {
    /** Called by the Android side for a volume key while a book is open; see `pressPageKey`. */
    __leafletPageKey?: (direction: PageKeyDirection) => void;
  }
}

/** Whether the reader is typing (search, a note): a volume key then turns nothing. */
export const typingIn = (element: Element | null) =>
  !!element && (/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || (element as HTMLElement).isContentEditable === true);

if (typeof window !== "undefined") {
  window.__leafletPageKey = (direction) => {
    if (typeof document !== "undefined" && typingIn(document.activeElement)) return;
    pressPageKey(direction === "prev" ? "prev" : "next");
  };
}

/** Gives the volume keys to the book while `bookOpen` (and the setting is on); back to the volume otherwise. */
export const useVolumePageTurns = (bookOpen: boolean) => {
  const [setting] = useVolumeKeysTurnPages();
  const wanted = volumeKeysWanted({ android: onAndroid(), setting, bookOpen });
  useEffect(() => {
    if (!onAndroid()) return undefined;
    void android.volumePageTurns(wanted);
    if (!wanted) return undefined;
    return () => {
      void android.volumePageTurns(false);
    };
  }, [wanted]);
};
