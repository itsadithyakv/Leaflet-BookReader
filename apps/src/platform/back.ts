import { useEffect, useRef } from "react";

/**
 * Android's Back (the button, and the swipe in from either edge) closes the
 * top thing on screen, one press at a time, and leaves the app only when
 * there is nothing left to close: a sheet, then the panel under it, then the
 * book, then the page you came from, and only then out.
 *
 * Things that can be closed say so while they are open (`useBackLayer`, or
 * `pushBackLayer` outside React). The newest is closed first. When none is
 * open, the fallbacks are asked newest first (`setBackFallback`): the reader
 * walks its own Escape order and then leaves the book; the app goes back to
 * the Library from another tab. If nothing takes it, `handleBack` answers
 * false and the Android side sends Leaflet to the background, as other apps
 * do from their first screen.
 *
 * On the desktop nothing calls `handleBack`: Escape is handled where it was.
 */

type Layer = { id: number; close: () => void };
type Fallback = { id: number; take: () => boolean };

let next = 1;
const layers: Layer[] = [];
const fallbacks: Fallback[] = [];

/** Registers something open that Back closes. Returns its removal; call it when it closes by any other way. */
export const pushBackLayer = (close: () => void): (() => void) => {
  const id = next++;
  layers.push({ id, close });
  return () => {
    const at = layers.findIndex((layer) => layer.id === id);
    if (at >= 0) layers.splice(at, 1);
  };
};

/** Asked when no layer is open; answers whether it took the press. Returns its removal. */
export const setBackFallback = (take: () => boolean): (() => void) => {
  const id = next++;
  fallbacks.push({ id, take });
  return () => {
    const at = fallbacks.findIndex((fallback) => fallback.id === id);
    if (at >= 0) fallbacks.splice(at, 1);
  };
};

/** One press of Back. True when Leaflet closed something; false when the app itself should go. */
export const handleBack = (): boolean => {
  const top = layers.pop();
  if (top) {
    top.close();
    return true;
  }
  for (let at = fallbacks.length - 1; at >= 0; at -= 1) {
    if (fallbacks[at].take()) return true;
  }
  return false;
};

/** How many layers are open (for tests, and for the Android side to know whether Back is Leaflet's). */
export const openBackLayers = () => layers.length;

/**
 * While `open`, Back calls `close`. The latest `close` is used, so it may be
 * an inline arrow; the layer keeps its place in the order while it stays open.
 */
export const useBackLayer = (open: boolean, close: () => void) => {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return undefined;
    return pushBackLayer(() => latest.current());
  }, [open]);
};

/** Like `useBackLayer`, for a fallback that holds while it is mounted (the reader, the app's tabs). */
export const useBackFallback = (take: () => boolean, active = true) => {
  const latest = useRef(take);
  latest.current = take;
  useEffect(() => {
    if (!active) return undefined;
    return setBackFallback(() => latest.current());
  }, [active]);
};

declare global {
  interface Window {
    /** Called by the Android side on Back; see `handleBack`. */
    __leafletBack?: () => boolean;
  }
}

if (typeof window !== "undefined") {
  window.__leafletBack = handleBack;
}
