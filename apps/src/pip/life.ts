/**
 * Cues for Pip in his house, from outside the scene: a wish granted, the
 * first steps all done. The house scene plays each one the next time Pip is
 * free (after the snack he is eating, the hat he is putting on), so a
 * celebration never cuts another short. Where no house is on screen, the
 * cue goes to the app's own celebration queue instead.
 */
import { usePipStore } from "../store/pipStore";

export type PipCue = { move: string; loops?: number; line?: string | null };

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
  usePipStore.getState().react(cue.move, { loops: cue.loops ?? 1, line: cue.line ?? null });
};
