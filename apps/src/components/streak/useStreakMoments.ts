import { useEffect, useState } from "react";
import { create } from "zustand";
import { EMPTY_SNAPSHOT, getDateKey, type HabitSnapshot } from "../../services/habitService";
import { useAccountStore } from "../../store/accountStore";
import { useHabitStore } from "../../store/habitStore";
import { goalJustMet, pickStreakMoments, pruneSeen, type StreakMoment } from "./streakModel";

/**
 * The streak container's open state and the one moment on screen, shared by
 * the chip (which lights up for a goal met), the panel and the moment card.
 */
type StreakUi = {
  open: boolean;
  moment: StreakMoment | null;
  setOpen: (open: boolean) => void;
  dismissMoment: () => void;
};

export const useStreakUi = create<StreakUi>((set) => ({
  open: false,
  moment: null,
  setOpen: (open) => set({ open }),
  dismissMoment: () => set({ moment: null })
}));

// ---- Seen markers ---------------------------------------------------------------------------

const SEEN_KEY = "leaflet.streak.seen";

/** Each reader's own markers: by Leaflet account when signed in, else this device's. */
const seenKey = (account: string | null) => `${SEEN_KEY}.${account ?? "local"}`;

export const readSeen = (account: string | null): Set<string> => {
  try {
    const raw = localStorage.getItem(seenKey(account));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
};

export const markSeen = (account: string | null, keys: string[], today = getDateKey()) => {
  const seen = readSeen(account);
  keys.forEach((key) => seen.add(key));
  try {
    localStorage.setItem(seenKey(account), JSON.stringify(pruneSeen(seen, today)));
  } catch {
    // A moment shown twice is the worst of it.
  }
};

// ---- The hook -------------------------------------------------------------------------------

/**
 * Watches the habit store and puts the next streak moment due on screen,
 * once: each is marked seen the moment it shows. `paused` holds them back
 * (a book open, the session wrap-up up, the panel open) until it clears.
 */
export const useStreakMoments = (paused: boolean) => {
  const snapshot = useHabitStore((state) => state.snapshot);
  const pendingBreak = useHabitStore((state) => state.pendingBreak);
  const account = useAccountStore((state) => state.status.account?.id ?? null);
  const moment = useStreakUi((state) => state.moment);
  // The day the goal was met in front of the reader, kept until its moment can show.
  const [goalDay, setGoalDay] = useState<string | null>(null);

  useEffect(() => {
    let previous: HabitSnapshot | null = null;
    let previousDay: string | null = null;
    const look = (next: HabitSnapshot) => {
      // The empty snapshot is "not loaded yet": a goal met earlier today is not news on open.
      if (next === EMPTY_SNAPSHOT) return;
      const today = getDateKey();
      if (goalJustMet(previous, next, previousDay, today)) setGoalDay(today);
      previous = next;
      previousDay = today;
    };
    look(useHabitStore.getState().snapshot);
    return useHabitStore.subscribe((state, before) => {
      if (state.snapshot !== before.snapshot) look(state.snapshot);
    });
  }, []);

  useEffect(() => {
    if (paused || moment || snapshot === EMPTY_SNAPSHOT) return;
    const today = getDateKey();
    const [next] = pickStreakMoments({
      today,
      snapshot,
      justMet: goalDay === today,
      pendingBreak,
      seen: readSeen(account)
    });
    if (!next) return;
    markSeen(account, next.keys, today);
    useStreakUi.setState({ moment: next });
  }, [paused, moment, snapshot, pendingBreak, goalDay, account]);
};
