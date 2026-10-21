/**
 * For the tests: a camp as one from before chapters (1.5.10) would be, at the
 * burrow's level it has, so that the old gates hold for it (`legacy`), with
 * its chests paid and its goals ticked. The tests of the rest of the rules
 * use it; chapters have their own tests (`chapters.test.ts`).
 */
import { GOALS } from "./chapters";
import type { BaseState } from "./rules";

export const beforeChapters = <T extends BaseState>(state: T): T => ({
  ...state,
  minutes: 0,
  legacy: { burrow: state.levels.burrow },
  chapterSeen: 99,
  chapterPaid: 99,
  goals: GOALS.map((goal) => goal.id)
});
