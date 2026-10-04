import { useCallback, useSyncExternalStore } from "react";

/**
 * The "Characters" switch: whether the reader keeps track of the people in a
 * book. Off unless the reader turns it on (Settings, Reading). Off means
 * nothing is read from the database, nothing is marked in the text and there
 * is no card or panel; a sheet already written is kept, and is there again
 * when the switch goes back on.
 *
 * One of the reader's own settings, kept with the others in the webview's
 * storage (`services/deviceData.ts` lists it).
 */
export const PEOPLE_SWITCH_KEY = "leaflet.reader.characters";
const CHANGED = "leaflet:people-switch";

export const peopleSwitchOn = (): boolean => {
  try {
    return localStorage.getItem(PEOPLE_SWITCH_KEY) === "1";
  } catch {
    return false;
  }
};

export const setPeopleSwitch = (on: boolean) => {
  try {
    if (on) {
      localStorage.setItem(PEOPLE_SWITCH_KEY, "1");
    } else {
      localStorage.removeItem(PEOPLE_SWITCH_KEY);
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
export const usePeopleSwitch = (): [boolean, (on: boolean) => void] => {
  const on = useSyncExternalStore(subscribe, peopleSwitchOn, () => false);
  const set = useCallback((next: boolean) => setPeopleSwitch(next), []);
  return [on, set];
};
