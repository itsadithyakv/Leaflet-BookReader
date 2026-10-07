import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Keeps the screen on while the page reads itself (Dotty, auto-scroll, word
 * by word): with no key and no mouse, the system takes the reader for away
 * and dims the page under them.
 *
 * In the app the request is Windows' own (`keep_awake`); in a browser it is
 * the screen wake lock, where there is one. Asking twice for the same thing
 * asks once, and nothing here can fail the reading it is for.
 */
type Sentinel = { release: () => Promise<void> };
type WakeLock = { request: (kind: "screen") => Promise<Sentinel> };

let held = false;
let sentinel: Sentinel | null = null;

export const keepAwake = (on: boolean) => {
  if (on === held) {
    return;
  }
  held = on;
  if (isTauri()) {
    void invoke("keep_awake", { on }).catch(() => undefined);
    return;
  }
  const wakeLock = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
  if (on) {
    void wakeLock
      ?.request("screen")
      .then((lock) => {
        // Let go of while this one was being fetched.
        if (held) {
          sentinel = lock;
        } else {
          void lock.release().catch(() => undefined);
        }
      })
      .catch(() => undefined);
  } else {
    void sentinel?.release().catch(() => undefined);
    sentinel = null;
  }
};
