import { useCallback, useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useHabitStore } from "../store/habitStore";
import { watchForeground } from "../services/windowService";

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
 * Credits time actually spent reading toward the daily goal, and runs a focus
 * session's clock on the same time.
 *
 * This is the only source of ledger minutes. A focus session labels a span of
 * reading rather than granting time of its own, so a timer you start and walk
 * away from earns nothing, and reading without a timer still counts. The
 * session's clock counts the same moments, so a session can no longer claim
 * 175 minutes for ten minutes of reading and a window left open.
 *
 * Reading is: a book open, Leaflet the app in front, and some input in the
 * last IDLE_MS. Each tick credits `min(elapsed, TICK_MS)`, so a sleeping laptop
 * cannot bank hours it never spent, and leaving for another app credits what
 * was read up to that moment and nothing while away.
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

    const session = () => useHabitStore.getState();
    const idle = () => Date.now() - lastActivityRef.current > IDLE_MS;

    /** Ends a beat: its time counts if it was reading, and the next one starts now. */
    const beat = (reading: boolean) => {
      const now = Date.now();
      const add = Math.min(Math.max(0, now - lastTickRef.current), TICK_MS);
      lastTickRef.current = now;
      if (reading && add > 0) {
        pendingMsRef.current += add;
        session().addSessionReading(add);
      } else {
        session().setSessionReading(false);
      }
    };

    // Leaflet in front. Inside Tauri the OS window's focus says so; the DOM's
    // own blur cannot, since it also fires when the reader clicks into the
    // book, which lives in an iframe. A browser has only the page's focus,
    // which does count focus inside the iframe.
    let inFront = true;
    const reading = () =>
      inFront && document.visibilityState === "visible" && (isTauri() || document.hasFocus()) && !idle();
    const leave = () => {
      if (!inFront) {
        return;
      }
      // What was read up to this moment counts; the clock holds at once.
      beat(!idle());
      inFront = false;
      session().setSessionReading(false);
    };
    const back = () => {
      if (inFront) {
        return;
      }
      inFront = true;
      // The time away was not reading.
      lastTickRef.current = Date.now();
      markActivity();
      session().setSessionReading(document.visibilityState === "visible");
    };
    const stopWatching = watchForeground((front) => (front ? back() : leave()));
    const onVisibility = () => (document.visibilityState === "visible" ? back() : leave());
    document.addEventListener("visibilitychange", onVisibility);

    lastTickRef.current = Date.now();
    lastActivityRef.current = Date.now();
    // A book just opened: the session clock runs from now.
    session().setSessionReading(reading());

    const timer = window.setInterval(() => {
      beat(reading());
      if (Date.now() - lastFlushRef.current >= FLUSH_MS) {
        flush();
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(timer);
      events.forEach((name) => window.removeEventListener(name, onActivity));
      document.removeEventListener("visibilitychange", onVisibility);
      stopWatching();
      // The book closed: what was read since the last beat counts, and the
      // session clock holds until a book is open again.
      if (inFront) {
        beat(reading());
      }
      session().setSessionReading(false);
      // Closing the reader must not throw away the minutes already earned.
      flush();
    };
  }, [active, creditMinutes, markActivity]);

  return markActivity;
};
