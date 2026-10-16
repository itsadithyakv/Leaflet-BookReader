import { campWaits, settle } from "../../../../pip/base/rules";
import { campBegun } from "../../../../pip/base/welcome";
import { nowFrom, useBaseStore } from "../../../../store/baseStore";
import { useHabitStore } from "../../../../store/habitStore";

/**
 * Whether something waits in the Hollow, for the dot on the app's own Pip
 * tab: a parcel, Pip's basket, the oak full, a building finished
 * (`campWaits`: what reading brought, never a nudge). Loaded only once the
 * reading has been (`hooks/usePipTabDot.ts`), so a camp is never made with
 * its clocks at no minutes read. Answers the function that stops it.
 */
export const watchPipTab = (tell: (waits: boolean) => void): (() => void) => {
  const look = () => {
    const base = useBaseStore.getState().base;
    if (!campBegun(base)) return tell(false);
    const now = nowFrom(useHabitStore.getState().snapshot);
    tell(campWaits(settle(base, now), now));
  };
  if (!useBaseStore.getState().base) void useBaseStore.getState().open();
  const stopBase = useBaseStore.subscribe((state, previous) => {
    if (state.base !== previous.base) look();
  });
  const stopHabit = useHabitStore.subscribe((state, previous) => {
    if (state.snapshot !== previous.snapshot) look();
  });
  look();
  return () => {
    stopBase();
    stopHabit();
  };
};
