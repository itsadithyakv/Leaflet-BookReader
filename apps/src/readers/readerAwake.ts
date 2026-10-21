import { useEffect, useRef } from "react";
import { keepAwake } from "../services/keepAwake";
import { isAndroid, isTouchInput } from "../platform/device";

/**
 * The screen stays on while a book is read (docs/android.md, "Dotty,
 * SpeedRead, auto-scroll"): always while the page reads itself, and on a
 * phone also while the book is open and was touched in the last three
 * minutes, since a page read slowly sends the phone nothing (five until
 * 1.5.9: the owner found the screen stayed on too long once paused). Never while
 * Leaflet is out of sight, and never once the book is closed.
 */
export const TOUCHED_AWAKE_MS = 3 * 60 * 1000;

/** How often the touched-lately rule is looked at again. */
export const AWAKE_CHECK_MS = 30 * 1000;

export type AwakeFacts = {
  /** Dotty, SpeedRead or auto-scroll is running. */
  playing: boolean;
  /** The touched-lately rule applies (a phone or a tablet). */
  byTouch: boolean;
  /** When the page was last touched (a tap, a scroll, a key), in ms. */
  touchedAt: number;
  now: number;
  /** Leaflet is out of sight (another app, the screen off). */
  hidden: boolean;
};

export const shouldStayAwake = ({ playing, byTouch, touchedAt, now, hidden }: AwakeFacts) =>
  !hidden && (playing || (byTouch && now - touchedAt < TOUCHED_AWAKE_MS));

/**
 * Keeps the screen on by those rules for as long as the reader is mounted.
 * `touchedAt` is read when it is needed (the readers keep it in a ref: a
 * touch on the book's text, which is in a frame of its own, never reaches
 * this window); a touch or a key in the window counts too.
 */
export const useReaderAwake = (playing: boolean, touchedAt: () => number = () => 0) => {
  const ownTouchRef = useRef(Date.now());
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const touchedAtRef = useRef(touchedAt);
  touchedAtRef.current = touchedAt;
  const checkRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const byTouch = isAndroid() || isTouchInput();
    const check = () => {
      keepAwake(
        shouldStayAwake({
          playing: playingRef.current,
          byTouch,
          touchedAt: Math.max(ownTouchRef.current, touchedAtRef.current() || 0),
          now: Date.now(),
          hidden: typeof document !== "undefined" && document.visibilityState === "hidden"
        })
      );
    };
    checkRef.current = check;
    // A touch in the window counts at once (and is asked about at once only
    // when it may change the answer, not on every scroll event); one in the
    // book's own frame is in `touchedAt`, read on the next look.
    const touchedNow = () => {
      const was = Date.now() - ownTouchRef.current;
      ownTouchRef.current = Date.now();
      if (was > AWAKE_CHECK_MS) {
        check();
      }
    };
    const timer = window.setInterval(check, AWAKE_CHECK_MS);
    window.addEventListener("pointerdown", touchedNow, { passive: true, capture: true });
    window.addEventListener("keydown", touchedNow, { capture: true });
    window.addEventListener("wheel", touchedNow, { passive: true, capture: true });
    document.addEventListener("visibilitychange", check);
    check();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", touchedNow, { capture: true });
      window.removeEventListener("keydown", touchedNow, { capture: true });
      window.removeEventListener("wheel", touchedNow, { capture: true });
      document.removeEventListener("visibilitychange", check);
      keepAwake(false);
    };
  }, []);

  // Dotty starting or stopping is a change straight away.
  useEffect(() => {
    checkRef.current();
  }, [playing]);
};
