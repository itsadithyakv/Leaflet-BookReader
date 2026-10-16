import { useCallback, useEffect, useRef, useState } from "react";

/** How long the toolbar stays after opening a book. */
const FIRST_HIDE_MS = 2600;
/** How long it lingers after the pointer leaves it. */
const LINGER_MS = 900;

/** What can happen to the chrome (`chromeAfter`). */
export type ChromeEvent =
  /** A tap in the middle of the page. */
  | "toggle"
  /** A page turned by a finger, a tap at a side, text being selected, Android's Back. */
  | "hide"
  /** The pointer at the top edge, keyboard focus into the bar. */
  | "reveal"
  /** One of the chrome's own panels opened (or the tour, or a book that could not open). */
  | "pin";

/**
 * Whether the chrome shows after `event`. `pinned`: one of its own panels is
 * open, and hiding the chrome would take the panel with it. `immersive`: a
 * phone (readers/touchLayout.ts, `isPhoneShape`), where the chrome comes only
 * for a tap in the middle of the page, and goes only for another, a page
 * turned or Back; nothing brings it by itself and no timer sends it away.
 */
export const chromeAfter = (visible: boolean, event: ChromeEvent, context: { pinned: boolean; immersive: boolean }): boolean => {
  switch (event) {
    case "toggle":
      return context.pinned ? true : !visible;
    case "hide":
      return context.pinned ? visible : false;
    case "reveal":
      return context.immersive ? visible : true;
    case "pin":
      return true;
  }
};

/** Whether the chrome shows as a book opens: on a phone the page is all there is, until a tap in the middle asks. */
export const chromeAtOpen = (immersive: boolean) => !immersive;

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
 *
 * `immersive` (a phone): the book opens with no chrome at all, and only the
 * middle tap brings it (`chromeAfter`); it then stays, a panel opened from it
 * and closed again included, until another middle tap, a page turned, or
 * Android's Back, which sends it away before it leaves the book.
 */
export const useAutoHideChrome = (pinned: boolean, immersive = false) => {
  const [visible, setVisible] = useState(() => chromeAtOpen(immersive));
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const timerRef = useRef<number | null>(null);
  const hoveringRef = useRef(false);
  // Read inside listeners without re-subscribing them on every toggle.
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const immersiveRef = useRef(immersive);
  immersiveRef.current = immersive;

  const clear = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const step = useCallback((event: ChromeEvent) => {
    setVisible((now) => chromeAfter(now, event, { pinned: pinnedRef.current, immersive: immersiveRef.current }));
  }, []);

  const hideAfter = useCallback((ms: number) => {
    clear();
    // On a phone nothing sends the chrome away by itself.
    if (pinnedRef.current || hoveringRef.current || immersiveRef.current) {
      return;
    }
    timerRef.current = window.setTimeout(() => setVisible(false), ms);
  }, []);

  /** Shows the bar, then hides it again unless something keeps it up. Not on a phone: there only the middle tap brings it. */
  const reveal = useCallback(() => {
    if (immersiveRef.current) {
      return;
    }
    step("reveal");
    hideAfter(FIRST_HIDE_MS);
  }, [hideAfter, step]);

  /**
   * The pointer is on the bar (true) or has left it (false). A finger's
   * enter and leave come with every tap and mean nothing: the bar would go
   * a moment after any of its buttons was pressed.
   */
  const hover = useCallback(
    (on: boolean, pointerType?: string) => {
      if (pointerType === "touch" || immersiveRef.current) {
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
    step("toggle");
  }, [step]);

  /** A page turned by a finger, or text being selected: the chrome goes (unless a panel of its own is open). */
  const hide = useCallback(() => {
    clear();
    step("hide");
  }, [step]);

  useEffect(() => {
    // A pinned panel cancels any pending hide, and arms a fresh one the moment
    // the panel closes (not on a phone: the chrome stays until asked away).
    if (pinned) {
      step("pin");
      clear();
      return;
    }
    hideAfter(FIRST_HIDE_MS);
    return clear;
  }, [pinned, hideAfter, step]);

  useEffect(() => clear, []);

  return {
    visible,
    reveal,
    hover,
    toggle,
    hide,
    /**
     * Android's Back sends the chrome away before it leaves the book (on a
     * phone). Asked by the readers' own Back order once nothing else is open,
     * so a panel or the chapter list closes first, then the chrome, then the
     * book. Not while it is pinned: Back is the pinning panel's then.
     */
    backHides: immersive && visible && !pinned
  };
};
