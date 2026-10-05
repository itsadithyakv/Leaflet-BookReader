/**
 * Cues for Pip in his house, from outside the scene: a wish granted, the
 * first steps all done. The house scene plays each one the next time Pip is
 * free (after the snack he is eating, the hat he is putting on), so a
 * celebration never cuts another short. Where no house is on screen, the
 * cue goes to the app's own celebration queue instead.
 */
import { usePipStore } from "../store/pipStore";

export type PipCue = {
  move: string;
  loops?: number;
  line?: string | null;
  /** Only for a Pip in her house (a move from house-moves.js, a remark about the room): dropped when no house is on screen. */
  houseOnly?: boolean;
};

type Listener = (cue: PipCue) => void;

const listeners = new Set<Listener>();

/** For the house scene: hears every cue. Returns the unsubscribe. */
export const onPipCue = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Asks Pip to do something when he is next free. */
export const cuePip = (cue: PipCue) => {
  if (listeners.size > 0) {
    listeners.forEach((listener) => listener(cue));
    return;
  }
  if (cue.houseOnly) return;
  usePipStore.getState().react(cue.move, { loops: cue.loops ?? 1, line: cue.line ?? null });
};

/** Has Pip say a line when he is next free, with a small shift of his weight: for a remark that needs no move of its own. */
export const pipSays = (line: string, houseOnly = true) => cuePip({ move: "shift", loops: 1, line, houseOnly });
