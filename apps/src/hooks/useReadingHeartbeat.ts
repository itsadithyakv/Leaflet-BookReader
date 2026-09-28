import { useCallback, useEffect, useRef } from "react";
import { useHabitStore } from "../store/habitStore";

/** How often the heartbeat considers crediting time. */
const TICK_MS = 15_000;
/**
 * Silence longer than this means the reader was left open rather than read.
 * Matches the spirit of the reader's existing idle guards, which already refuse
 * to treat a long gap between scroll events as reading time.
 */
const IDLE_MS = 90_000;
/** Time is flushed to the database in batches rather than every tick. */
const FLUSH_MS = 60_000;

/**
 * Credits time actually spent reading toward the daily goal.
 *
 * This is the only source of ledger minutes. A focus session labels a span of
 * reading rather than granting time of its own, so a timer you start and walk
 * away from earns nothing, and reading without a timer still counts.
 *
 * Each tick credits `min(elapsed, TICK_MS)` so a sleeping laptop or a
 * backgrounded window cannot bank hours it never spent.
 */
export const useReadingHeartbeat = (active: boolean) => {
  const creditMinutes = useHabitStore((state) => state.creditMinutes);
  const lastActivityRef = useRef(Date.now());
  const lastTickRef = useRef(Date.now());
  const pendingMsRef = useRef(0);
  const lastFlushRef = useRef(Date.now());

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }

    const flush = () => {
      const minutes = pendingMsRef.current / 60000;
      pendingMsRef.current = 0;
      lastFlushRef.current = Date.now();
      if (minutes > 0) {
        void creditMinutes(minutes);
      }
    };

    const onActivity = () => markActivity();
    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "pointermove",
      "keydown",
      "wheel"
    ];
    events.forEach((name) => window.addEventListener(name, onActivity, { passive: true }));

    const onVisibility = () => {
      // Coming back from hidden must not credit the time spent away.
      lastTickRef.current = Date.now();
      if (document.visibilityState === "visible") {
        markActivity();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    lastTickRef.current = Date.now();
    lastActivityRef.current = Date.now();

    const timer = window.setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;

      const idle = now - lastActivityRef.current > IDLE_MS;
      const hidden = document.visibilityState !== "visible";
      if (!idle && !hidden) {
        pendingMsRef.current += Math.min(elapsed, TICK_MS);
      }

      if (now - lastFlushRef.current >= FLUSH_MS) {
        flush();
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(timer);
      events.forEach((name) => window.removeEventListener(name, onActivity));
      document.removeEventListener("visibilitychange", onVisibility);
      // Closing the reader must not throw away the minutes already earned.
      flush();
    };
  }, [active, creditMinutes, markActivity]);

  return markActivity;
};
