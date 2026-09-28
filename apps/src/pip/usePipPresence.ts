import { useEffect } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useHabitStore } from "../store/habitStore";

/** Pip dozes off once nobody has touched the app for this long... */
const DOZE_AFTER_MS = 4 * 60_000;
/** ...or this long late at night, when a nap is more in character. */
const DOZE_AFTER_NIGHT_MS = 60_000;

const isNight = (date = new Date()) => date.getHours() >= 23 || date.getHours() < 6;

/**
 * Whether Pip has dozed off: after a while with no pointer, key or wheel input
 * anywhere in the app, and awake again at the first touch. One set of window
 * listeners for the whole app, however many places ask.
 */
const useDoze = create<{ dozing: boolean }>(() => ({ dozing: false }));
let dozeWatching = false;
const watchForDoze = () => {
  if (dozeWatching || typeof window === "undefined") {
    return;
  }
  dozeWatching = true;
  let lastInput = Date.now();
  const onInput = () => {
    lastInput = Date.now();
    if (useDoze.getState().dozing) {
      useDoze.setState({ dozing: false });
    }
  };
  for (const type of ["pointermove", "pointerdown", "keydown", "wheel"]) {
    window.addEventListener(type, onInput, { passive: true, capture: true });
  }
  window.setInterval(() => {
    const limit = isNight() ? DOZE_AFTER_NIGHT_MS : DOZE_AFTER_MS;
    if (!useDoze.getState().dozing && Date.now() - lastInput > limit) {
      useDoze.setState({ dozing: true });
    }
  }, 15_000);
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Pip's resting state. The pose is the status: reading (a session is running),
 * asleep (you have been away a while), sunbathing (goal met), or idle and busy
 * with its own things. Every stage shows the same one.
 *
 * Pip used to sleep whenever nothing had been read today, which on most days
 * meant asleep all morning and never wandering; now it naps when you do.
 */
export const usePipPresence = () => {
  const { snapshot, activeSession } = useHabitStore(
    useShallow((state) => ({ snapshot: state.snapshot, activeSession: state.activeSession }))
  );
  useEffect(watchForDoze, []);
  const dozing = useDoze((state) => state.dozing);
  const asleep = !activeSession && dozing;
  const left = Math.max(0, Math.ceil(snapshot.goalMinutes - snapshot.todayMinutes));
  // Dozing late at night means a proper bed; by day, a nap where it stands.
  const base = activeSession ? "read" : asleep ? (isNight() ? "bedsleep" : "sleep") : snapshot.todayMet ? "sunbathe" : "idle";
  const line = activeSession
    ? "reading with you. i'll be quiet."
    : asleep
      ? "zzz… oh! you're back."
      : snapshot.todayMet
        ? "goal met. soaking up the sun."
        : `${plural(left, "minute")} to go. i believe in you.`;
  return { snapshot, activeSession, asleep, left, base, line };
};
