import { useCallback, useEffect, useMemo, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getDateKey, useHabitStore } from "../store/habitStore";
import { watchForeground } from "../services/windowService";
import { noteBeat, pageTurned, pageUp } from "./slowPage";

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
 * away from earns nothing, and reading without a timer still counts: it goes
 * to the day's ledger the same way, and the shelf shows what a day read
 * outside its sessions as that day's free read. The session's clock counts
 * the same moments, so a session can no longer claim 175 minutes for ten
 * minutes of reading and a window left open.
 *
 * Reading is: a book open, Leaflet the app in front, and some input in the
 * last IDLE_MS. Each tick credits `min(elapsed, TICK_MS)`, so a sleeping laptop
 * cannot bank hours it never spent, and leaving for another app credits what
 * was read up to that moment and nothing while away.
 *
 * And a page read slowly is reading (hooks/slowPage.ts): the time that went
 * uncounted for want of input, with Leaflet in front, is claimed when the
 * reader turns the page (`pageTurned`), up to four minutes a page in all. It
 * goes to the ledger and the session clock once, the same way a beat does.
 *
 * Returns `markActivity`, with `pageTurned` on it for the readers that turn pages.
 */
export const useReadingHeartbeat = (active: boolean) => {
  const lastActivityRef = useRef(Date.now());
  const lastTickRef = useRef(Date.now());
  const lastFlushRef = useRef(Date.now());
  // The page that is up: what has counted on it, and what went quiet (hooks/slowPage.ts).
  const stretchRef = useRef(pageUp(Date.now()));
  // Whether Leaflet is in front and on screen; set by the effect below.
  const presentRef = useRef<() => boolean>(() => false);

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  /** A deliberate turn of the page (a key, the dock, a click): claims the page's quiet time. */
  const turned = useCallback(() => {
    const now = Date.now();
    const { claim, next } = pageTurned(stretchRef.current, now);
    stretchRef.current = next;
    lastActivityRef.current = now;
    if (!presentRef.current()) {
      return;
    }
    const store = useHabitStore.getState();
    claim.forEach(({ dateKey, ms }) => {
      store.addReading(ms, dateKey);
      store.addSessionReading(ms);
    });
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }

    // The time counted between flushes is held by the store, which keeps it
    // in storage: Leaflet closed mid-read credits it when it next opens.
    const flush = () => {
      lastFlushRef.current = Date.now();
      void useHabitStore.getState().flushReading();
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
    // Either way from the last input: with the clock set back the difference
    // is negative, and an open book left alone would read as in use until
    // the clock caught up.
    const idle = () => Math.abs(Date.now() - lastActivityRef.current) > IDLE_MS;

    /**
     * Ends a beat: its time counts if it was reading, and the next one starts
     * now. `quiet` says a beat that does not count had Leaflet in front all
     * the same (only the input was missing): a page turn may claim it.
     */
    const beat = (reading: boolean, quiet = false) => {
      const now = Date.now();
      const add = Math.min(Math.max(0, now - lastTickRef.current), TICK_MS);
      lastTickRef.current = now;
      stretchRef.current = noteBeat(stretchRef.current, reading ? "counted" : quiet ? "quiet" : "away", add, now, getDateKey());
      if (reading && add > 0) {
        // The day's ledger takes it with or without a session; a running
        // session's clock counts the same moments.
        session().addReading(add);
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
    const present = () => inFront && document.visibilityState === "visible" && (isTauri() || document.hasFocus());
    presentRef.current = present;
    const reading = () => present() && !idle();
    const leave = () => {
      if (!inFront) {
        return;
      }
      // What was read up to this moment counts; the clock holds at once.
      beat(!idle(), true);
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
    stretchRef.current = pageUp(Date.now());
    // A book just opened: the session clock runs from now.
    session().setSessionReading(reading());

    const timer = window.setInterval(() => {
      beat(reading(), present());
      // Either way, for the same reason: a clock set back must not hold the
      // flush off until it catches up (what is held is capped, and the rest lost).
      if (Math.abs(Date.now() - lastFlushRef.current) >= FLUSH_MS) {
        flush();
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(timer);
      events.forEach((name) => window.removeEventListener(name, onActivity));
      document.removeEventListener("visibilitychange", onVisibility);
      stopWatching();
      presentRef.current = () => false;
      // The book closed: what was read since the last beat counts, and the
      // session clock holds until a book is open again.
      if (inFront) {
        beat(reading());
      }
      session().setSessionReading(false);
      // Closing the reader must not throw away the minutes already earned.
      flush();
    };
  }, [active, markActivity]);

  return useMemo(() => Object.assign(() => markActivity(), { pageTurned: turned }), [markActivity, turned]);
};
