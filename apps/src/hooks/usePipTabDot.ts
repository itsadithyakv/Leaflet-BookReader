import { useEffect, useState } from "react";
import { EMPTY_SNAPSHOT } from "../services/habitService";
import { useHabitStore } from "../store/habitStore";

/**
 * The dot on the Pip item of the app's navigation: something waits in the
 * Hollow. The camp and its rules are loaded only after the reading has been,
 * and apart from the app's first screen (`watchPipTab`).
 */
export const usePipTabDot = (): boolean => {
  const [waits, setWaits] = useState(false);
  const known = useHabitStore((state) => state.snapshot !== EMPTY_SNAPSHOT);
  useEffect(() => {
    if (!known) return;
    let stop: (() => void) | null = null;
    let gone = false;
    void import("../components/pip/arcade/base/pipTabWaits")
      .then(({ watchPipTab }) => {
        if (!gone) stop = watchPipTab(setWaits);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      stop?.();
    };
  }, [known]);
  return waits;
};
