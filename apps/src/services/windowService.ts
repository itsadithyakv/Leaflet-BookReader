import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * The app window: fullscreen for focus lock, and whether Leaflet is the app in
 * front. Failures are swallowed on purpose; a window that will not go
 * fullscreen must never stop a session from starting.
 */
export const setAppFullscreen = async (on: boolean) => {
  try {
    if (isTauri()) {
      const win = getCurrentWindow();
      if ((await win.isFullscreen()) !== on) {
        await win.setFullscreen(on);
      }
      return;
    }
    if (on && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
    } else if (!on && document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch {
    // Declined by the OS or the browser; the session carries on windowed.
  }
};

/**
 * Calls `onChange(false)` when Leaflet stops being the app in front (another
 * app, minimised, the lock screen) and `onChange(true)` when it is back.
 *
 * Inside Tauri this is the OS window focus. The DOM's own `blur` cannot be
 * used: it also fires when the reader clicks into the book, which lives in an
 * iframe. Returns an unsubscribe function.
 */
export const watchForeground = (onChange: (inFront: boolean) => void) => {
  let last = true;
  const emit = (inFront: boolean) => {
    if (inFront !== last) {
      last = inFront;
      onChange(inFront);
    }
  };
  if (isTauri()) {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    getCurrentWindow()
      .onFocusChanged(({ payload }) => emit(payload))
      .then((stop) => {
        if (cancelled) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }
  const onVisibility = () => emit(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
};
