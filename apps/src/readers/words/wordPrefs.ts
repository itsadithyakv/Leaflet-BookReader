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
