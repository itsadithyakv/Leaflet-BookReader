import { useCallback, useSyncExternalStore } from "react";

/**
 * The "Keep the words I look up" switch. On unless the reader turns it off
 * (Settings, Reading). Off means a look-up leaves nothing behind, as it did
 * before words were kept; the words already kept stay, and can be removed one
 * by one from "My words".
 *
 * One of the reader's own settings, kept with the others in the webview's
 * storage (`services/deviceData.ts` lists it).
 */
export const WORDS_SWITCH_KEY = "leaflet.reader.keepWords";
const CHANGED = "leaflet:words-switch";

export const wordsSwitchOn = (): boolean => {
  try {
    return localStorage.getItem(WORDS_SWITCH_KEY) !== "0";
  } catch {
    return true;
  }
};

export const setWordsSwitch = (on: boolean) => {
  try {
    if (on) {
      localStorage.removeItem(WORDS_SWITCH_KEY);
    } else {
      localStorage.setItem(WORDS_SWITCH_KEY, "0");
    }
  } catch {
    // Storage that cannot be written: the switch stays as it was.
  }
  // The settings page and an open book are told at once (`storage` only reaches other windows).
  window.dispatchEvent(new Event(CHANGED));
};

/**
 * "Look a word up when I double-click it" (Settings, Reading). On unless the
 * reader turns it off. A double-click on a word selects it, as it always
 * did, and with this on the look-up card opens on it without the Look up
 * button being pressed: its meaning if it is a word, and what the book says
 * of it if it is one of the book's own. It is the one thing that looks a
 * word up without that button, so it has a switch.
 */
export const LOOK_UP_DOUBLE_KEY = "leaflet.reader.lookUpOnDoubleClick";
/** A selection this long after a double-click is still that double-click's (the reader's selection event comes a quarter of a second late). */
export const DOUBLE_CLICK_MS = 900;

export const lookUpOnDoubleClick = (): boolean => {
  try {
    return localStorage.getItem(LOOK_UP_DOUBLE_KEY) !== "0";
  } catch {
    return true;
  }
};

export const setLookUpOnDoubleClick = (on: boolean) => {
  try {
    if (on) {
      localStorage.removeItem(LOOK_UP_DOUBLE_KEY);
    } else {
      localStorage.setItem(LOOK_UP_DOUBLE_KEY, "0");
    }
  } catch {
    // Storage that cannot be written: the switch stays as it was.
  }
  window.dispatchEvent(new Event(CHANGED));
};

/** Whether a selection just made is one word a double-click picked: what the look-up opens on by itself. */
export const isDoubleClickedWord = (text: string, doubleClickedAt: number, now = Date.now()) =>
  now - doubleClickedAt < DOUBLE_CLICK_MS && /^[\p{L}\p{N}][\p{L}\p{N}’'-]*$/u.test(text.trim());

const subscribe = (changed: () => void) => {
  window.addEventListener(CHANGED, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(CHANGED, changed);
    window.removeEventListener("storage", changed);
  };
};

/** The switch and a way to turn it, for whatever shows it. */
export const useWordsSwitch = (): [boolean, (on: boolean) => void] => {
  const on = useSyncExternalStore(subscribe, wordsSwitchOn, () => true);
  const set = useCallback((next: boolean) => setWordsSwitch(next), []);
  return [on, set];
};

export const useLookUpOnDoubleClick = (): [boolean, (on: boolean) => void] => {
  const on = useSyncExternalStore(subscribe, lookUpOnDoubleClick, () => true);
  const set = useCallback((next: boolean) => setLookUpOnDoubleClick(next), []);
  return [on, set];
};
