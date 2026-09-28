import { useCallback, useEffect, useRef, useState } from "react";

/** How long the toolbar stays after opening a book. */
const FIRST_HIDE_MS = 2600;
/** How long it lingers after the pointer leaves it. */
const LINGER_MS = 900;

/**
 * Hides the reader's toolbar while reading, and brings it back on demand.
 *
 * A reader wants the page, not the chrome. The bar floats over the page (it
 * never resizes it, so the text does not reflow when it comes and goes) and
 * returns only on a deliberate signal:
 * - the pointer reaching the top edge of the window (`reveal`, from a hot
 *   strip the reader draws there), staying while the pointer is on the bar;
 * - keyboard focus moving into the bar;
 * - a tap, on a touch screen, where there is no pointer to aim.
 * Moving the mouse over the page, scrolling and reading keys do not bring it
 * back: that is reading, and a bar that popped up for it was a distraction.
 *
 * `pinned` keeps it up regardless: hiding the bar while one of its own panels
 * is open would take the panel with it.
 */
export const useAutoHideChrome = (pinned: boolean) => {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<number | null>(null);
  const hoveringRef = useRef(false);
  // Read inside listeners without re-subscribing them on every toggle.
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  const clear = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const hideAfter = useCallback((ms: number) => {
    clear();
    if (pinnedRef.current || hoveringRef.current) {
      return;
    }
    timerRef.current = window.setTimeout(() => setVisible(false), ms);
  }, []);

  /** Shows the bar, then hides it again unless something keeps it up. */
  const reveal = useCallback(() => {
    setVisible(true);
    hideAfter(FIRST_HIDE_MS);
  }, [hideAfter]);

  /** The pointer is on the bar (true) or has left it (false). */
  const hover = useCallback(
    (on: boolean) => {
      hoveringRef.current = on;
      if (on) {
        clear();
        setVisible(true);
      } else {
        hideAfter(LINGER_MS);
      }
    },
    [hideAfter]
  );

  useEffect(() => {
    // A pinned panel cancels any pending hide, and arms a fresh one the moment
    // the panel closes.
    if (pinned) {
      setVisible(true);
      clear();
      return;
    }
    hideAfter(FIRST_HIDE_MS);
    return clear;
  }, [pinned, hideAfter]);

  useEffect(() => {
    // A tap brings the bar back on a touch screen only; a mouse aims for the
    // top edge instead, and a click on the page is selecting text or reading.
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        reveal();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      clear();
    };
  }, [reveal]);

  return { visible, reveal, hover };
};
