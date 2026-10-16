import { create } from "zustand";
import type { Rect } from "./geometry";

const KNOWN_KEY = "leaflet.pip.doorKnown";

const readKnown = () => {
  try {
    return window.localStorage.getItem(KNOWN_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * What the guided session and the burrow's door share across the page,
 * none of it kept with the camp: the step the tour is showing (for the
 * door, which opens to a single tap only once the tour has got to it), a
 * request to go in (from a key, so Pip walks in as from a tap on the door),
 * and whether this reader has been in through the door yet (its glow).
 */
type CoachStore = {
  /** The tour's step while it is on screen; null when it is not. */
  step: number | null;
  setStep: (step: number | null) => void;
  /** Bumped by a key that means "in through the door": the camp's picture has Pip walk in. */
  enterAsked: number;
  askEnter: () => void;
  /** Been in by the door on this device: the glow on it is for the first visit. */
  doorKnown: boolean;
  knowDoor: () => void;
  /** Where the door was on the screen when Pip last went in: the way back out opens there. */
  doorAt: Rect | null;
  setDoorAt: (rect: Rect | null) => void;
  /** The oak was tapped during its step (a tap that brought nothing still counts as done). */
  oakTapped: boolean;
  tapOak: (on: boolean) => void;
};

export const useCoachStore = create<CoachStore>((set, get) => ({
  step: null,
  setStep: (step) => {
    if (get().step !== step) set({ step });
  },
  enterAsked: 0,
  askEnter: () => set((state) => ({ enterAsked: state.enterAsked + 1 })),
  doorKnown: readKnown(),
  knowDoor: () => {
    if (get().doorKnown) return;
    try {
      window.localStorage.setItem(KNOWN_KEY, "1");
    } catch {
      // Not kept: the glow comes back next time, and that is all.
    }
    set({ doorKnown: true });
  },
  doorAt: null,
  setDoorAt: (doorAt) => set({ doorAt }),
  oakTapped: false,
  tapOak: (oakTapped) => set({ oakTapped })
}));
