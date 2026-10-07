import { useCallback, useSyncExternalStore } from "react";

/**
 * The reader's choices for "Characters" (Settings, Reading), kept with its
 * other settings in the webview's storage (`services/deviceData.ts` lists
 * them).
 *
 * The switch: whether the reader keeps track of the people in a book. On
 * unless the reader turns it off (it was off by default until 1.3, when it
 * could not be found). Off means nothing is read from the database, nothing
 * is marked in the text and there is no card, peek or panel; a sheet already
 * written is kept, and is there again when the switch goes back on.
 *
 * Resting the pointer on a name: whether that shows what the book has said
 * of it. On unless turned off.
 *
 * The wiki: whether a fan wiki's summary may be fetched for a name, and
 * when. It is the one part of all this that goes online and the one part
 * that can spoil, so it waits to be asked unless the reader says otherwise.
 */
export const PEOPLE_SWITCH_KEY = "leaflet.reader.characters";
export const PEOPLE_HOVER_KEY = "leaflet.reader.charactersHover";
export const PEOPLE_WIKI_KEY = "leaflet.reader.charactersWiki";
const CHANGED = "leaflet:people-switch";

/** `ask`: fetched when its button is pressed. `auto`: fetched with the peek. `off`: never, and no button. */
export type WikiMode = "ask" | "auto" | "off";

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Storage that cannot be written: the choice stays as it was.
  }
  // The settings page and an open book are told at once (`storage` only reaches other windows).
  window.dispatchEvent(new Event(CHANGED));
};

export const peopleSwitchOn = (): boolean => read(PEOPLE_SWITCH_KEY) !== "0";
export const setPeopleSwitch = (on: boolean) => write(PEOPLE_SWITCH_KEY, on ? null : "0");

export const peopleHoverOn = (): boolean => read(PEOPLE_HOVER_KEY) !== "0";
export const setPeopleHover = (on: boolean) => write(PEOPLE_HOVER_KEY, on ? null : "0");

export const wikiMode = (): WikiMode => {
  const kept = read(PEOPLE_WIKI_KEY);
  return kept === "auto" || kept === "off" ? kept : "ask";
};
export const setWikiMode = (mode: WikiMode) => write(PEOPLE_WIKI_KEY, mode === "ask" ? null : mode);

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
  const on = useSyncExternalStore(subscribe, peopleSwitchOn, () => true);
  const set = useCallback((next: boolean) => setPeopleSwitch(next), []);
  return [on, set];
};

export const usePeopleHover = (): [boolean, (on: boolean) => void] => {
  const on = useSyncExternalStore(subscribe, peopleHoverOn, () => true);
  const set = useCallback((next: boolean) => setPeopleHover(next), []);
  return [on, set];
};

export const useWikiMode = (): [WikiMode, (mode: WikiMode) => void] => {
  const mode = useSyncExternalStore(subscribe, wikiMode, () => "ask" as WikiMode);
  const set = useCallback((next: WikiMode) => setWikiMode(next), []);
  return [mode, set];
};
