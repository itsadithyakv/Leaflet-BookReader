import { useSyncExternalStore } from "react";

/**
 * Work that can wait until the app has started: the library drawn, then a
 * moment of quiet. Pip coming out into the app, the lookups for missing
 * covers and authors, the series scan, the backup on launch and the Hollow's
 * dot on the Pip tab all used to run in the same few hundred milliseconds as
 * the first screen, and on a slow phone that was what made it late. They do
 * the same as before, a little after it.
 *
 * `settleStartupWhenIdle` is called by the app once its library has been
 * drawn; `settleStartup` settles at once (and is called after a few seconds
 * whatever happens, so nothing waits for ever). Away from a page (the unit
 * tests) everything is settled from the start.
 */
let settled = typeof window === "undefined";
const waiting = new Set<() => void>();
const watchers = new Set<() => void>();

export const startupSettled = () => settled;

/** Runs `run` once the start is over: now, if it is. Returns a function that cancels it while it waits. */
export const afterStartup = (run: () => void): (() => void) => {
  if (settled) {
    run();
    return () => undefined;
  }
  waiting.add(run);
  return () => {
    waiting.delete(run);
  };
};

/** The start is over: everything waiting for it runs, in the order it asked. */
export const settleStartup = () => {
  if (settled) {
    return;
  }
  settled = true;
  const runs = [...waiting];
  waiting.clear();
  for (const run of runs) {
    try {
      run();
    } catch (error) {
      // One failing must not keep the others waiting.
      console.error(error);
    }
  }
  for (const watcher of [...watchers]) watcher();
};

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
};

/**
 * Settles after the next frame has been drawn and the main thread is idle, or
 * after `latest` ms of not being idle.
 */
export const settleStartupWhenIdle = (latest = 1200) => {
  if (settled || typeof window === "undefined") {
    settleStartup();
    return;
  }
  const idle = (window as IdleWindow).requestIdleCallback;
  // A frame first (requestAnimationFrame), then out of it (a timer): what waits must not be drawn in that frame.
  window.requestAnimationFrame(() =>
    window.setTimeout(() => {
      if (idle) {
        idle(settleStartup, { timeout: latest });
      } else {
        window.setTimeout(settleStartup, 120);
      }
    }, 0)
  );
};

const subscribe = (watcher: () => void) => {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
};

/** Whether the start is over, for a component: false at first, then true for good. */
export const useStartupSettled = () => useSyncExternalStore(subscribe, startupSettled, startupSettled);

/** For the tests: as at the app's start. */
export const resetStartupForTests = (value = false) => {
  settled = value;
  waiting.clear();
};
