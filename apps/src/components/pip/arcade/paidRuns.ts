import { useBaseStore, minutesRead } from "../../../store/baseStore";
import { useHabitStore } from "../../../store/habitStore";
import { PAYING_GAMES, purseLeft, type BaseState, type PayingGame } from "../../../pip/base/rules";

/**
 * Runs of the arcade's games that pay the camp, in hand: one for every ten
 * minutes read, and a new camp starts with two (`newBase`). Shown on the
 * cards as an acorn and a number, so nobody has to find them in a tooltip.
 * Null before the camp is known; nothing for a game that does not pay.
 */
export const paidRuns = (base: BaseState | null, minutes: number, game: string): number | null =>
  base && (PAYING_GAMES as readonly string[]).includes(game) ? purseLeft(base, minutes) : null;

/** `paidRuns` for the camp as it is now. */
export const usePaidRuns = () => {
  const base = useBaseStore((state) => state.base);
  const minutes = useHabitStore((state) => minutesRead(state.snapshot));
  return (game: string) => paidRuns(base, minutes, game as PayingGame);
};
