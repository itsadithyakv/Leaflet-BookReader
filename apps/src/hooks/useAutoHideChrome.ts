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
 * - on a touch screen, a tap in the middle of the page (`toggle`, from the
 *   reader's own taps: readers/touchLayout.ts). It stays until the next such
 *   tap or a page turned (`hide`); a touch that turns a page or scrolls does
 *   not bring it.
 * Moving the mouse over the page, scrolling and reading keys do not bring it
 * back: that is reading, and a bar that popped up for it was a distraction.
 *
 * `pinned` keeps it up regardless: hiding the bar while one of its own panels
 * is open would take the panel with it.
 */
export const useAutoHideChrome = (pinned: boolean) => {
  const [visible, setVisible] = useState(true);
  const visibleRef = useRef(true);
  visibleRef.current = visible;
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

  /**
   * The pointer is on the bar (true) or has left it (false). A finger's
   * enter and leave come with every tap and mean nothing: the bar would go
   * a moment after any of its buttons was pressed.
   */
  const hover = useCallback(
    (on: boolean, pointerType?: string) => {
      if (pointerType === "touch") {
        return;
      }
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

  /** A tap in the middle of the page: the chrome comes, or goes. Brought this way it stays. */
  const toggle = useCallback(() => {
    clear();
    if (visibleRef.current && !pinnedRef.current) {
      setVisible(false);
    } else {
      setVisible(true);
    }
  }, []);

  /** A page turned by a finger, or text being selected: the chrome goes (unless a panel of its own is open). */
  const hide = useCallback(() => {
    clear();
    if (!pinnedRef.current) {
      setVisible(false);
    }
  }, []);

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

  useEffect(() => clear, []);

  return { visible, reveal, hover, toggle, hide };
};
