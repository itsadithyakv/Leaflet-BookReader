import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/** As long as the Hollow's and TouchTips' hold, so every hold in the app feels the same. */
export const LONG_PRESS_MS = 450;
const DRIFT = 10;

/**
 * Press and hold with a finger (a mouse has its right button): after
 * `LONG_PRESS_MS` without moving, `onHold` runs, and the click and the
 * system's menu that the same press would bring are swallowed. Spread the
 * result on the element; mark it `data-long-press` so TouchTips leaves it be.
 */
export const useLongPress = (onHold: () => void) => {
  const latest = useRef(onHold);
  latest.current = onHold;
  const timer = useRef(0);
  const from = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    window.clearTimeout(timer.current);
    from.current = null;
  };

  return {
    "data-long-press": "",
    onPointerDown: (event: ReactPointerEvent) => {
      fired.current = false;
      cancel();
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      from.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        from.current = null;
        try {
          navigator.vibrate?.(8);
        } catch {
          // No buzz where the system does not allow one.
        }
        latest.current();
        // After, so a click `onHold` sends (to open a menu) is not the one swallowed.
        fired.current = true;
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      const start = from.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRIFT) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: { preventDefault: () => void }) => {
      if (from.current || fired.current) event.preventDefault();
    },
    onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (fired.current) {
        fired.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };
};
