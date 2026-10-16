/**
 * The guided first session's view of the welcome (owned by `pip/base/welcome.ts`
 * and `store/baseStore.ts`): the camp's `welcome`, the sync guard, and the
 * store's actions, in one place.
 */
import { useBaseStore } from "../../../store/baseStore";
import type { BaseState, CampWelcome } from "../../../pip/base/rules";

export type { CampWelcome };

/** The camp's welcome, or null before there is a camp. */
export const welcomeOf = (base: BaseState | null | undefined): CampWelcome | null => base?.welcome ?? null;

/** Whether the first sync pull is over (or there is no sync): before it, a fresh camp may not be the reader's real one. */
export const useWelcomeReady = () => useBaseStore((state) => state.welcomeReady);

/** The replay from the (i), and its step: a demonstration, kept out of the camp. Null when none is under way. */
export const useReplay = () => useBaseStore((state) => state.tutorialReplay);

const store = () => useBaseStore.getState();

export const welcome = {
  openBasket: () => store().openWelcomeBasket(),
  paw: (target: string) => store().spendPaw(target),
  /** In a replay, the replay's step; otherwise the camp's. */
  setStep: (step: number) => store().setTutorialStep(step),
  /** In a replay, its end; otherwise the session's (finished or skipped). */
  finish: (skipped: boolean) => store().finishTutorial(skipped),
  replay: () => store().replayTutorial(),
  replaying: () => store().tutorialReplay !== null
};
